/** Territory file layout inference and Leaflet map HTML (coords come from the server). */

export const TERRITORY_COLOURS = [
  '#34d399', '#60a5fa', '#a78bfa', '#f59e0b', '#f472b6',
  '#22d3ee', '#fb7185', '#a3e635', '#818cf8', '#38bdf8',
  '#c084fc', '#fbbf24',
];

export const TERRITORY_COLOURS_BORDER = [
  '#059669', '#2563eb', '#7c3aed', '#d97706', '#db2777',
  '#0891b2', '#e11d48', '#65a30d', '#4f46e5', '#0284c7',
  '#9333ea', '#ca8a04',
];

const GEO_KINDS = new Set(['postcode', 'zip', 'city', 'county', 'region']);

function colKey(c) {
  return `${c?.original || ''} ${c?.name || ''}`.toLowerCase();
}

function pickColumn(columns, predicates) {
  const cols = Array.isArray(columns) ? columns : [];
  for (const pred of predicates) {
    const hit = cols.find((c) => pred.test(colKey(c)));
    if (hit) return hit.name || hit.original || '';
  }
  return '';
}

export function looksLikeUkPostcode(value) {
  const t = String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(t)) return true;
  if (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(t)) return true;
  return false;
}

export function looksLikeUsZip(value) {
  const t = String(value || '').trim();
  const digits = t.replace(/\D/g, '');
  return /^\d{5}(-\d{4})?$/.test(t) || digits.length === 4 || digits.length === 5;
}

export function normalizeUkPostcode(value) {
  const t = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(t)) {
    return `${t.slice(0, -3)} ${t.slice(-3)}`;
  }
  return String(value || '').trim().toUpperCase();
}

export function normalizeMapLayout(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const col = (v) => String(v || '').trim().replace(/[^a-zA-Z0-9_]/g, '');
  const out = {};
  const team = col(raw.teamColumn || raw.team_column);
  const territory = col(raw.territoryColumn || raw.territory_column);
  const geo = col(raw.geoColumn || raw.geo_column);
  const rep = col(raw.repColumn || raw.rep_column);
  const kind = String(raw.geoKind || raw.geo_kind || '').trim().toLowerCase();
  const country = String(raw.country || '').trim().slice(0, 80);
  if (team) out.teamColumn = team;
  if (territory) out.territoryColumn = territory;
  if (geo) out.geoColumn = geo;
  if (rep) out.repColumn = rep;
  if (GEO_KINDS.has(kind)) out.geoKind = kind;
  if (country) out.country = country;
  return Object.keys(out).length ? out : null;
}

function inferGeoKind(geoColumn, columns, sampleRows) {
  const col = (columns || []).find((c) => c.name === geoColumn || c.original === geoColumn);
  const key = colKey(col || { name: geoColumn });
  if (/\b(post.?code|postal.?code)\b/.test(key)) return 'postcode';
  if (/\b(zip.?code|zip)\b/.test(key)) return 'zip';
  if (/\b(city|town)\b/.test(key)) return 'city';
  if (/\b(county|counties)\b/.test(key)) return 'county';
  if (/\b(region|state|province|area)\b/.test(key)) return 'region';
  const values = (sampleRows || []).map((r) => r?.[geoColumn] ?? r?.[col?.original]).filter((v) => v != null && v !== '');
  if (!values.length) return 'region';
  const ukHits = values.filter(looksLikeUkPostcode).length;
  const zipHits = values.filter(looksLikeUsZip).length;
  if (ukHits >= Math.max(3, values.length * 0.4)) return 'postcode';
  if (zipHits >= Math.max(3, values.length * 0.4)) return 'zip';
  return 'region';
}

function inferCountry(geoKind, geoColumn, sampleRows) {
  if (geoKind === 'postcode') return 'United Kingdom';
  if (geoKind === 'zip') return 'United States';
  const blob = (sampleRows || []).slice(0, 40).map((r) => String(r?.[geoColumn] || '')).join(' ').toLowerCase();
  if (/\b(yorkshire|surrey|kent|fife|lothian|glasgow|manchester|birmingham)\b/.test(blob)) return 'United Kingdom';
  return '';
}

export function inferTerritoryLayout(columns, sampleRows = []) {
  const teamColumn = pickColumn(columns, [
    /\b(team|field.?force|sales.?force|franchise|business.?unit|\bbu\b)\b/,
  ]);
  const territoryColumn = pickColumn(columns, [
    /\b(territory|terr_?id|brick|sales.?area|sales.?region)\b/,
  ]);
  let geoColumn = pickColumn(columns, [
    /\b(post.?code|postal.?code|zip.?code|zip)\b/,
    /\b(city|town)\b/,
    /\b(county|counties|region|state|province)\b/,
  ]);
  if (!geoColumn && territoryColumn) geoColumn = territoryColumn;
  const geoKind = geoColumn ? inferGeoKind(geoColumn, columns, sampleRows) : 'region';
  const repColumn = pickColumn(columns, [
    /\b(rep|representative|salesperson|account.?exec)\b/,
  ]);
  const country = inferCountry(geoKind, geoColumn, sampleRows);
  return normalizeMapLayout({
    teamColumn,
    territoryColumn,
    geoColumn,
    geoKind,
    repColumn,
    country,
  }) || {};
}

export function scoreTerritorySheet(columns, sampleRows = []) {
  const layout = inferTerritoryLayout(columns, sampleRows);
  let score = 0;
  if (layout.geoColumn) score += 4;
  if (layout.territoryColumn) score += 3;
  if (layout.teamColumn) score += 2;
  if (layout.geoKind === 'postcode' || layout.geoKind === 'zip') score += 2;
  return score;
}

export function mergeTerritoryLayout(base, overlay) {
  const a = normalizeMapLayout(base) || {};
  const b = normalizeMapLayout(overlay) || {};
  return normalizeMapLayout({ ...a, ...b }) || a;
}

export function territoryColourFor(index) {
  const i = Math.abs(Number(index) || 0) % TERRITORY_COLOURS.length;
  return {
    colour: TERRITORY_COLOURS[i],
    border: TERRITORY_COLOURS_BORDER[i],
  };
}

export function hashTerritoryColour(label) {
  const s = String(label || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h) + s.charCodeAt(i);
  return territoryColourFor(Math.abs(h));
}

export function formatTerritoryAssessContext({ file, team, territory, points = [] }) {
  const rows = (points || []).filter((p) => !territory || p.territory === territory.territory || p.id === territory.id);
  const geos = [...new Set(rows.map((p) => p.geo).filter(Boolean))];
  const count = rows.reduce((n, p) => n + (Number(p.count) || 0), 0);
  const allTerritories = [...new Set((points || []).map((p) => p.territory).filter(Boolean))];
  return [
    `TERRITORY ASSESSMENT — FOCUS: ${territory?.territory || territory?.id || 'selected'}`,
    `File: ${file?.name || ''}`,
    team ? `Team: ${team}` : '',
    `Rows in focus: ${count}`,
    geos.length ? `Geo keys: ${geos.slice(0, 40).join(', ')}${geos.length > 40 ? '…' : ''}` : '',
    `Territories in view (${allTerritories.length}): ${allTerritories.slice(0, 40).join(', ')}`,
  ].filter(Boolean).join('\n');
}

export function buildTerritoryPointsMapHTML(points, selectedId) {
  const mapped = (points || [])
    .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p) => {
      const colours = hashTerritoryColour(p.territory || p.id);
      return {
        id: p.id,
        territory: p.territory || '',
        team: p.team || '',
        geo: p.geo || '',
        count: Number(p.count) || 0,
        lat: Number(p.lat),
        lng: Number(p.lng),
        colour: colours.colour,
        border: colours.border,
        selected: p.id === selectedId || p.territory === selectedId,
      };
    });

  const legendItems = [];
  const seen = new Set();
  for (const p of mapped) {
    const key = p.territory || p.id;
    if (seen.has(key)) continue;
    seen.add(key);
    legendItems.push({ name: key, colour: p.colour });
    if (legendItems.length >= 12) break;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0f172a; font-family: system-ui, sans-serif; }
    #map { width: 100%; height: 100%; }
    .legend {
      background: rgba(15,23,42,0.92);
      border: 1px solid rgba(96,165,250,0.25);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 11px;
      line-height: 1.6;
      backdrop-filter: blur(4px);
      max-height: 220px;
      overflow: auto;
    }
    .legend-title { color: #60a5fa; font-weight: 700; font-size: 10px; letter-spacing: .05em; margin-bottom: 6px; }
    .legend-item { display: flex; align-items: center; gap: 7px; color: #cbd5e1; margin-bottom: 3px; }
    .legend-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
    .legend-sub { color: #64748b; font-size: 10px; margin-top: 6px; padding-top: 6px; border-top: 1px solid #1e293b; }
    .leaflet-popup-content-wrapper { background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .leaflet-popup-content { margin: 10px 14px; }
    .popup-title { font-weight: 700; font-size: 13px; color: #0f172a; margin-bottom: 4px; }
    .popup-rep { font-size: 11px; color: #475569; margin-bottom: 2px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const points = ${JSON.stringify(mapped)};
    const legendItems = ${JSON.stringify(legendItems)};
    const esc = (v) => String(v || '').replace(/[&<>]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));
    const map = L.map('map', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    map.setView([54, -2], 6);
    const bounds = [];
    const counts = points.map((p) => p.count);
    const minC = counts.length ? Math.min.apply(null, counts.concat([1])) : 1;
    const maxC = counts.length ? Math.max.apply(null, counts.concat([1])) : 1;
    for (const p of points) {
      const span = Math.max(1, maxC - minC);
      const r = Math.max(10, Math.min(28, 10 + ((p.count - minC) / span) * 16));
      const icon = L.divIcon({
        className: '',
        iconSize: [r*2, r*2],
        iconAnchor: [r, r],
        html: '<div style="width:' + (r*2) + 'px;height:' + (r*2) + 'px;border-radius:50%;background:' + (p.selected ? p.colour : p.colour + '99') + ';border:' + (p.selected ? 3 : 1.5) + 'px solid ' + p.border + ';box-shadow:' + (p.selected ? '0 0 14px ' + p.colour + '99' : '0 2px 6px rgba(0,0,0,0.4)') + ';cursor:pointer;"></div>'
      });
      const marker = L.marker([p.lat, p.lng], { icon });
      marker.bindPopup(
        '<div class="popup-title">' + esc(p.territory || p.geo) + '</div>' +
        (p.team ? '<div class="popup-rep">Team: ' + esc(p.team) + '</div>' : '') +
        (p.geo ? '<div class="popup-rep">' + esc(p.geo) + '</div>' : '') +
        '<div class="popup-rep">Rows: ' + p.count + '</div>',
        { maxWidth: 260 }
      );
      marker.on('click', () => {
        window.parent.postMessage({ type: 'territory-select', id: p.id, territory: p.territory }, '*');
      });
      marker.addTo(map);
      bounds.push([p.lat, p.lng]);
    }
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 9 });
    else if (bounds.length === 1) map.setView(bounds[0], 8);
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'legend');
      div.innerHTML = '<div class="legend-title">TERRITORIES</div>' +
        legendItems.map((m) => '<div class="legend-item"><div class="legend-dot" style="background:' + m.colour + '"></div><span>' + esc(m.name) + '</span></div>').join('') +
        '<div class="legend-sub">Circle size = row count<br>Click a marker to inspect</div>';
      return div;
    };
    legend.addTo(map);
  <\/script>
</body>
</html>`;
}

export function layoutNeedsConfirm(layout) {
  const l = normalizeMapLayout(layout) || {};
  return !(l.geoColumn && l.geoKind);
}
