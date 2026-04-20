// Inicializa mapa centrado en España
var map = L.map('map').setView([36.5, -6.0], 6);

const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 20 }).addTo(map)
const baseLayers = {
  'OpenStreetMap': osm
};

const catastroWMS = L.tileLayer.wms('https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx?', {
    layers: 'Catastro',
    format: 'image/jpeg',
    transparent: true,
    attribution: 'Catastro',
    maxZoom: 20
  })
const overlays = {
  'PNOA': L.tileLayer('https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{-y}.jpeg', { attribution: 'PNOA', maxZoom: 20 }),
  'Catastro': catastroWMS,
}

// Handle Catastro tiles errors
const errorPopup = L.popup({ closeButton: true, autoClose: true });
catastroWMS.on('tileerror', function() {
  const errorMessage = "Las teselas de Catastro devuelven error. ¿Estás intentando acceder desde fuera de España?";
  errorPopup.setContent(errorMessage).setLatLng(map.getCenter());
  map.addLayer(errorPopup);
});

L.control.layers(baseLayers, overlays).addTo(map);

var drawnLayer = null;
var drawnItems = new L.FeatureGroup().addTo(map);
var drawControl = new L.Control.Draw({
  draw: { rectangle: true, polygon: false, polyline: false, circle: false, marker: false, circlemarker: false },
});
map.addControl(drawControl);

const search = new GeoSearch.GeoSearchControl({
  provider: new GeoSearch.OpenStreetMapProvider(),
});
map.addControl(search);

const github = L.control({ position: 'topleft' });
const GITHUB_URL = "https://github.com/OSM-es/descarga-catastro"
github.onAdd = function () {
  this._div = L.DomUtil.create('div', 'leaflet-control-zoom leaflet-bar');
  this._div.innerHTML = `<a class="github" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 16 16">
<path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
</svg></a>`;
  return this._div;
}
github.addTo(map);

// key en sessionStorage
const MAP_VIEW = 'descarga-catastro_mapview';

// parsea hash #map=zoom/lat/lng (acepta zoom entero)
function parseHashMap() {
  const hash = window.location.hash;
  if (!hash) return null;

  const match = hash.match(
    /^#map=(\d+)\/([-+]?\d+(?:\.\d+)?)\/([-+]?\d+(?:\.\d+)?)/
  );
  if (!match) return null;

  const zoom = Number(match[1]);
  const lat  = Number(match[2]);
  const lng  = Number(match[3]);

  if (![zoom, lat, lng].every(Number.isFinite)) return null;

  return { center: [lat, lng], zoom };
}

// establece vista inicial: hash -> default
function initMapFromHash() {
  const hashState = parseHashMap();

  if (hashState) {
    const { center, zoom } = hashState;
    map.setView(center, zoom);
    return;
  }

  updateHash();
}

// actualiza hash al mover/zoom (4 decimales)
function updateHash() {
  const { lat, lng } = map.getCenter();
  const zoom = map.getZoom();

  function fmt(v, decimals = 4) {
    // redondea a 'decimals' y quita ceros/trailing decimal point
    return (Math.round(v * Math.pow(10, decimals)) / Math.pow(10, decimals)).toString();
  }

  const hash = `#map=${zoom}/${fmt(lat)}/${fmt(lng)}`;
  history.replaceState(null, "", hash);
}

// hook eventos (debounced)
function attachHashSync(map) {
  let timer = null;
  function debounced() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { updateHash(); timer = null; }, 200);
  }
  map.on('moveend', debounced);
  map.on('zoomend', debounced);
}

// inicializa
initMapFromHash();
attachHashSync(map);

// Helpers: haversine distance (m)
function toRad(deg) { return deg * Math.PI / 180; }
function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var dLat = toRad(lat2 - lat1);
  var dLon = toRad(lon2 - lon1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Estima área rectangular en m² usando distances N-S y E-W en el centro lat
function estimateRectArea(lonWest, latSouth, lonEast, latNorth) {
  var midLon = (lonWest + lonEast) / 2;
  var h = haversine(latSouth, midLon, latNorth, midLon);
  var midLat = (latSouth + latNorth) / 2;
  var w = haversine(midLat, lonWest, midLat, lonEast);
  return w * h;
}

function setSpanValue(id, val) {
  var span = document.getElementById(id);
  var hidden = document.getElementById(id + '_input');
  if (!span || !hidden) return;
  if (val == null || !Number.isFinite(+val)) {
    span.textContent = span.getAttribute('data-placeholder') || '—';
    span.classList.add('empty');
    hidden.value = '';
  } else {
    span.textContent = (typeof val === 'number') ? val.toFixed(6) : String(val);
    span.classList.remove('empty');
    hidden.value = span.textContent;
  }
}

function setInputsFromBounds(bounds) {
  var xmin = bounds.getWest();
  var ymin = bounds.getSouth();
  var xmax = bounds.getEast();
  var ymax = bounds.getNorth();

  setSpanValue('xmin', xmin);
  setSpanValue('ymin', ymin);
  setSpanValue('xmax', xmax);
  setSpanValue('ymax', ymax);

  updateAreaInfo();
}

map.on(L.Draw.Event.CREATED, function (e) {
  if (drawnLayer) { map.removeLayer(drawnLayer); }
  drawnLayer = e.layer.addTo(map);
  setInputsFromBounds(drawnLayer.getBounds());
});

function readCoords() {
  var xmin = parseFloat(document.getElementById('xmin_input').value);
  var ymin = parseFloat(document.getElementById('ymin_input').value);
  var xmax = parseFloat(document.getElementById('xmax_input').value);
  var ymax = parseFloat(document.getElementById('ymax_input').value);
  return { xmin: xmin, ymin: ymin, xmax: xmax, ymax: ymax };
}

function updateAreaInfo() {
  var coords = readCoords();
  var xmin = coords.xmin, ymin = coords.ymin, xmax = coords.xmax, ymax = coords.ymax;
  var areaText = document.getElementById('areaInfo');
  var tooLarge = document.getElementById('tooLarge');
  var exportBtn = document.getElementById('exportBtn');
  var josmBtn = document.getElementById('josmBtn');

  if (![xmin, ymin, xmax, ymax].every(function (v) { return Number.isFinite(v); })) {
    areaText.textContent = 'Área estimada: —';
    tooLarge.style.display = 'none';
    exportBtn.disabled = false;
    josmBtn.disabled = false;
    return;
  }

  var area = estimateRectArea(xmin, ymin, xmax, ymax);
  var areaKm2 = area / 1e6;
  areaText.textContent = 'Área estimada: ' + areaKm2.toFixed(4) + ' km²';

  if (area > 0.5e6) {
    tooLarge.style.display = 'block';
    exportBtn.disabled = true;
    josmBtn.disabled = true;
  } else {
    tooLarge.style.display = 'none';
    exportBtn.disabled = false;
    josmBtn.disabled = false;
  }
}

// Modal helpers and fake progress
function showModal() {
  document.getElementById('modalOverlay').style.display = 'flex';
  startProgress();
}
function hideModal() {
  document.getElementById('modalOverlay').style.display = 'none';
  stopProgress();
}

document.getElementById('copyBtn').addEventListener('click', function () {
  var coords = readCoords();
  if (![coords.xmin, coords.ymin, coords.xmax, coords.ymax].every(function (v) { return Number.isFinite(v); })) {
    return;
  }
  var text = [coords.xmin, coords.ymin, coords.xmax, coords.ymax].join(" ");
  navigator.clipboard.writeText(text).catch(function (err) {
    console.error('No se pudo copiar: ', err);
  });
});

let progressTimer = null;
function startProgress() {
  const fill = document.getElementById('progressFill');
  let pct = 0;
  fill.style.width = '0%';
  progressTimer = setInterval(() => {
    pct += Math.random() * 8;
    if (pct > 95) pct = 95;
    fill.style.width = pct.toFixed(1) + '%';
  }, 400);
}
function stopProgress() {
  clearInterval(progressTimer);
  document.getElementById('progressFill').style.width = '100%';
}

document.getElementById('bboxForm').addEventListener('submit', async function (ev) {
  ev.preventDefault();

  var xmin = parseFloat(document.getElementById('xmin_input').value);
  var ymin = parseFloat(document.getElementById('ymin_input').value);
  var xmax = parseFloat(document.getElementById('xmax_input').value);
  var ymax = parseFloat(document.getElementById('ymax_input').value);

  if (![xmin, ymin, xmax, ymax].every(function (v) { return Number.isFinite(v); })) {
    alert('Coordenadas inválidas.');
    return;
  }

  var area = estimateRectArea(xmin, ymin, xmax, ymax);
  if (area > 0.5e6) {
    alert('Acércate — el área máxima permitida es 0.5 km².');
    return;
  }

  showModal();
  const form = ev.target;
  // FormData ya incluirá los hidden inputs
  const data = new URLSearchParams(new FormData(form));

  try {
    const resp = await fetch('/export', {
      method: 'POST',
      body: data
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(txt || 'Server error');
    }

    const j = await resp.json();
    if (!j.ok || !j.publicUrl) throw new Error('No public URL returned');

    if (document.activeElement.dataset.action  === 'josm') {
      const josmUrl = `http://127.0.0.1:8111/import?new_layer=true&changeset_tags=source=Dirección General del Catastro|created_by=${GITHUB_URL}|hashtags=catastro-es&url=${j.publicUrl}`;
      window.open(josmUrl);
    } else {
      // trigger download
      const a = document.createElement('a');
      a.href = j.publicUrl;
      a.download = j.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch (err) {
    alert('Error: ' + (err.message || err));
  } finally {
    hideModal();
  }
});
