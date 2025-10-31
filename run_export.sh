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

# DOCS: 
# - https://www.catastro.hacienda.gob.es/webinspire/documentos/Conjuntos%20de%20datos.pdf
# - https://www.catastro.hacienda.gob.es/webinspire/index.html

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
              ELSE 'yes' 
            END AS building,
            CASE WHEN conditionofConstruction == 'ruin' THEN 'yes' ELSE NULL END AS ruins,
            CASE WHEN conditionofConstruction == 'declined' THEN 'yes' ELSE NULL END AS abandoned 
          FROM Building
          WHERE currentUse IS NOT NULL"
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
            CASE WHEN numberOfFloorsBelowGround > 0 THEN numberOfFloorsBelowGround ELSE NULL END as \"building:levels:underground\"
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

# merge all geojsons
FILE="$OUTDIR/combined_buildings.geojson"
npx mapshaper -quiet \
  -i "$OUTDIR/Building.geojson" -i "$OUTDIR/BuildingPart.geojson" -i "$OUTDIR/OtherConstruction.geojson" \
  -merge-layers target=Building,BuildingPart,OtherConstruction force \
  -clean allow-overlaps snap-interval=0.000001 \
  -o format=geojson "$FILE"

ogr2ogr -f SQLite "$OUTDIR/db.sqlite" "$FILE" -dsco SPATIALITE=YES

# apply SQL logic to clean features
spatialite -silent "$OUTDIR/db.sqlite" <<SQL
-- Delete building or its parts whenever are out of the bbox
WITH bbox AS (
  SELECT ST_GeomFromText(
    'POLYGON((${MINLON} ${MINLAT}, ${MAXLON} ${MINLAT}, ${MAXLON} ${MAXLAT}, ${MINLON} ${MAXLAT}, ${MINLON} ${MINLAT}))',
    ${T_SRS#EPSG:}
  ) AS geom
)
DELETE FROM combined_buildings AS cb
WHERE
  EXISTS (
    SELECT 1
    FROM combined_buildings AS b, bbox
    WHERE b.building IS NOT NULL
      AND NOT ST_Within(b.geometry, bbox.geom)
      AND (
        ST_Equals(b.geometry, cb.geometry)
        OR ST_Within(cb.geometry, b.geometry)
      )
  )
  OR (
    cb."building:part" IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM combined_buildings AS b2, bbox
      WHERE b2.building IS NOT NULL
        AND NOT ST_Within(b2.geometry, bbox.geom)
        AND ST_Within(cb.geometry, b2.geometry)
    )
  );

-- Remove building:parts that are not inside any building
DELETE FROM combined_buildings AS p
WHERE p."building:part" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM combined_buildings AS b
      WHERE b.building IS NOT NULL
        AND ST_Within(p.geometry, b.geometry)
  );

-- Compute maximum building:levels from inner parts
UPDATE combined_buildings AS b
SET "building:levels" = (
    SELECT MAX(CAST(p."building:levels" AS INTEGER))
    FROM combined_buildings AS p
    WHERE p."building:part" IS NOT NULL
      AND ST_Within(p.geometry, b.geometry)
)
WHERE b.building IS NOT NULL;

-- If there is only one part identical to the building itself, then copy the attributes
UPDATE combined_buildings
SET
    "building:levels:underground" = p."building:levels:underground",
    "building:levels" = p."building:levels"
FROM combined_buildings AS p
WHERE combined_buildings.building IS NOT NULL
  AND p."building:part" IS NOT NULL
  AND ST_Equals(combined_buildings.geometry, p.geometry);

-- Delete the copied parts and building:levels=0 as not possible
DELETE FROM combined_buildings
WHERE
  (
    "building:part" IS NOT NULL
    AND EXISTS (
        SELECT 1
        FROM combined_buildings AS b
        WHERE b.building IS NOT NULL
          AND ST_Equals(b.geometry, combined_buildings.geometry)
    )
  )
  OR
  (
    CAST("building:levels" AS INTEGER) = 0
  );
SQL

ogr2ogr -f GeoJSON "${FILE}.1" "$OUTDIR/db.sqlite"

# delete null properties
jq -c '(.features[] | .properties) |= with_entries(select(.value != null))' "${FILE}.1" > "$FILE"

echo "$FILE"
