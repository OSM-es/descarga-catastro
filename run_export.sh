#!/bin/bash
set -e

if [ "$#" -ne 4 ]; then
  echo "Uso: $0 minLon minLat maxLon maxLat"
  exit 1
fi

MINLON=$1
MINLAT=$2
MAXLON=$3
MAXLAT=$4
S_SRS=EPSG:3857
T_SRS=EPSG:4326

read XMIN YMIN < <(echo "$MINLON $MINLAT" | cs2cs +init=${T_SRS} +to +init=${S_SRS} -f "%.3f" | awk '{print $1, $2}')
read XMAX YMAX < <(echo "$MAXLON $MAXLAT" | cs2cs +init=${T_SRS} +to +init=${S_SRS} -f "%.3f" | awk '{print $1, $2}')

BBOX="${XMIN},${YMIN},${XMAX},${YMAX}"
WFS_BUILDINGS="http://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx?service=wfs&version=2&request=GetFeature&bbox=$BBOX&srsname=${S_SRS}"
WFS_ADDRESSES="http://ovc.catastro.meh.es/INSPIRE/wfsAD.aspx?service=wfs&version=2&request=GetFeature&bbox=$BBOX&srsname=${S_SRS}"
OUTDIR=$(mktemp -d)

# DOCS: https://www.catastro.hacienda.gob.es/webinspire/documentos/Conjuntos%20de%20datos.pdf

curl --silent --output "$OUTDIR/Building.gml" "$WFS_BUILDINGS&typenames=bu:Building"
if ! ogrinfo -ro -so "$OUTDIR/Building.gml" Building >/dev/null 2>&1 ; then
  echo '{"type":"FeatureCollection","features":[]}' > "$OUTDIR/Building.geojson"
else
  ogr2ogr -f GeoJSON -s_srs ${S_SRS} -t_srs ${T_SRS} -nln Building -spat $XMIN $YMIN $XMAX $YMAX -skipfailures -explodecollections \
    "$OUTDIR/Building.geojson" "$OUTDIR/Building.gml" \
    -dialect sqlite \
    -sql "SELECT 
            geometry,
            CASE 
              WHEN currentUse == '1_residential' THEN 'residential'
              WHEN currentUse == '2_agriculture' THEN 'barn'
              WHEN currentUse == '3_industrial' THEN 'industrial'
              WHEN currentUse == '4_1_office' THEN 'office'
              WHEN currentUse == '4_2_retail' THEN 'retail'
              WHEN currentUse == '4_3_publicServices' THEN 'public'
              ELSE NULL 
            END AS building
          FROM Building"
fi

curl --silent --output "$OUTDIR/BuildingPart.gml" "$WFS_BUILDINGS&typenames=bu:BuildingPart"
if ! ogrinfo -ro -so "$OUTDIR/BuildingPart.gml" BuildingPart >/dev/null 2>&1 ; then
  echo '{"type":"FeatureCollection","features":[]}' > "$OUTDIR/BuildingPart.geojson"
else
  ogr2ogr -f GeoJSON -s_srs ${S_SRS} -t_srs ${T_SRS} -nln BuildingPart -spat $XMIN $YMIN $XMAX $YMAX -skipfailures \
    "$OUTDIR/BuildingPart.geojson" "$OUTDIR/BuildingPart.gml" \
    -dialect sqlite \
    -sql "SELECT 
            geometry,
            'yes' as \"building:part\",
            numberOfFloorsAboveGround as \"building:levels\",
            CASE WHEN numberOfFloorsBelowGround > 0 THEN numberOfFloorsBelowGround ELSE NULL END as \"building:levels:underground\",
            CASE WHEN heightBelowGround > 0 THEN heightBelowGround ELSE NULL END as min_height
          FROM BuildingPart"
fi

curl --silent --output "$OUTDIR/OtherConstruction.gml" "$WFS_BUILDINGS&typenames=bu:OtherConstruction"
if ! ogrinfo -ro -so "$OUTDIR/OtherConstruction.gml" OtherConstruction >/dev/null 2>&1 ; then
  echo '{"type":"FeatureCollection","features":[]}' > "$OUTDIR/OtherConstruction.geojson"
else
  ogr2ogr -f GeoJSON -s_srs ${S_SRS} -t_srs ${T_SRS} -nln OtherConstruction -spat $XMIN $YMIN $XMAX $YMAX -skipfailures \
    "$OUTDIR/OtherConstruction.geojson" "$OUTDIR/OtherConstruction.gml" \
    -sql "SELECT 'swimming_pool' as leisure FROM OtherConstruction WHERE constructionNature = 'openAirPool'"
fi

# todo
curl --silent --output "$OUTDIR/Address.gml" "$WFS_ADDRESSES&typenames=ad:address"
if ! ogrinfo -ro -so "$OUTDIR/Address.gml" Address >/dev/null 2>&1 ; then
  echo '{"type":"FeatureCollection","features":[]}' > "$OUTDIR/Address.geojson"
else
  ogr2ogr -f GeoJSON -s_srs ${S_SRS} -t_srs ${T_SRS} -nln Address -spat $XMIN $YMIN $XMAX $YMAX -skipfailures \
    "$OUTDIR/Address.geojson" "$OUTDIR/Address.gml"
fi

# Merge all geojsons
FILE="$OUTDIR/combined_buildings.geojson"
npx mapshaper -quiet \
  -i "$OUTDIR/Building.geojson" -i "$OUTDIR/BuildingPart.geojson" -i "$OUTDIR/OtherConstruction.geojson" \
  -merge-layers target=Building,BuildingPart,OtherConstruction force \
  -clean allow-overlaps snap-interval=0.000001 \
  -simplify dp 75% \
  -o format=geojson "$FILE"

# Combine duplicated geometries, delete null properties, and clean object
jq -c '
  .features |= (
    sort_by(.geometry | tojson)
    | group_by(.geometry | tojson)
    | map({
        type: "Feature",
        geometry: .[0].geometry,
        properties: (
          [ .[].properties ]
          | add
          | to_entries
          | group_by(.key)
          | map({
              key: .[0].key,
              value: (
                [.[].value]
                | unique
                | if length == 1 then .[0] else . end
              )
            })
          | from_entries
        )
      })
  )
' "$FILE" \
| jq -c 'walk(if type == "object" then with_entries(select(.value != null)) else . end)' \
| jq -c '
  .features |= map(
    .properties |= if has("building") then del(."building:part") else . end
  )
' > "${FILE}.1" && mv "${FILE}.1" "$FILE"

echo "$FILE"
