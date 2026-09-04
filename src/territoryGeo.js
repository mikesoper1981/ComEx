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
  const teamName = String(raw.teamName || raw.team_name || '').trim().slice(0, 80);
  if (team) out.teamColumn = team;
  if (territory) out.territoryColumn = territory;
  if (geo) out.geoColumn = geo;
  if (rep) out.repColumn = rep;
  if (GEO_KINDS.has(kind)) out.geoKind = kind;
  if (country) out.country = country;
  if (teamName) out.teamName = teamName;
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

export function isRosterLikeColumn(colName, sampleRows = []) {
  const key = String(colName || '').toLowerCase();
  if (/\b(rep|representative|salesperson|employee|person|forename|surname|full.?name)\b/.test(key)) return true;
  const vals = [...new Set((sampleRows || []).map((r) => String(r?.[colName] ?? '').trim()).filter(Boolean))];
  if (vals.length >= 8 && vals.length >= Math.max(6, (sampleRows || []).length * 0.35)) return true;
  const people = vals.filter((v) => /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(v) || /\b(mr|mrs|ms|dr)\b/i.test(v)).length;
  return vals.length >= 3 && people >= vals.length * 0.5;
}

export function extractTerritoryTeamName(answer) {
  const t = String(answer || '').trim().replace(/^["']|["']$/g, '');
  if (!t || t.length > 80) return '';
  if (/^(yes|y|ok|okay|correct|no|nope)\b/i.test(t)) return '';
  if (/^\d+$/.test(t)) return '';
  const m = t.match(/(?:team(?:\s+name)?|field\s*force|call(?:ed)?(?:\s+it)?|name(?:\s+it)?|it(?:'s| is))\s*(?:is|:)?\s+(.+)/i);
  const raw = (m ? m[1] : t).replace(/[.?!]+$/, '').trim();
  if (!raw || raw.length < 2) return '';
  if (!m && /\b(tab|sheet|column|postcode|zip|geo)\b/i.test(raw)) return '';
  if (raw.split(/\s+/).length > 10) return '';
  return raw.slice(0, 80);
}

export function shouldSplitByTeamColumn(layout, teams) {
  const list = Array.isArray(teams) ? teams : [];
  if (!layout?.teamColumn) return false;
  if (layout.repColumn && layout.teamColumn === layout.repColumn) return false;
  if (list.length < 2 || list.length > 12) return false;
  return true;
}

export function inferTerritoryLayout(columns, sampleRows = []) {
  let teamColumn = pickColumn(columns, [
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
  let repColumn = pickColumn(columns, [
    /\b(rep|representative|salesperson|account.?exec)\b/,
  ]);
  if (teamColumn && isRosterLikeColumn(teamColumn, sampleRows)) {
    if (!repColumn) repColumn = teamColumn;
    teamColumn = '';
  }
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

export function findTerritoryHeaderRow(aoa, maxScan = 30) {
  const rows = Array.isArray(aoa) ? aoa : [];
  let best = { i: 0, score: -1 };
  const limit = Math.min(rows.length, maxScan);
  for (let i = 0; i < limit; i += 1) {
    const filled = (rows[i] || []).map((c) => String(c ?? '').trim()).filter(Boolean);
    if (filled.length < 2) continue;
    const numeric = filled.filter((c) => /^[\d.,%£$€-]+$/.test(c)).length;
    if (numeric >= filled.length * 0.6) continue;
    const named = filled.filter((c) => /[A-Za-z]{2,}/.test(c)).length;
    const score = filled.length * 2 + named;
    if (score > best.score) best = { i, score };
  }
  return best.score >= 0 ? best.i : 0;
}

export function aoaToRecords(aoa) {
  const rows = Array.isArray(aoa) ? aoa : [];
  if (!rows.length) return { records: [], headerRow: 1, headers: [] };
  const headerIdx = findTerritoryHeaderRow(rows);
  const used = new Set();
  const headers = (rows[headerIdx] || []).map((c, i) => {
    const base = String(c ?? '').trim() || `column_${i + 1}`;
    let key = base;
    let n = 2;
    while (used.has(key)) {
      key = `${base}_${n}`;
      n += 1;
    }
    used.add(key);
    return key;
  });
  const records = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    if (!row.some((c) => String(c ?? '').trim() !== '')) continue;
    const rec = {};
    let any = false;
    headers.forEach((key, j) => {
      const v = row[j];
      rec[key] = v == null || String(v).trim() === '' ? null : v;
      if (rec[key] != null) any = true;
    });
    if (any) records.push(rec);
  }
  return { records, headerRow: headerIdx + 1, headers };
}

export function matchTerritorySheetName(answer, sheets = []) {
  const list = Array.isArray(sheets) ? sheets : [];
  const t = String(answer || '').trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (!t || !list.length) return '';
  const exact = list.find((s) => String(s.name || '').toLowerCase() === t);
  if (exact) return exact.name;
  const contained = list.filter((s) => {
    const n = String(s.name || '').toLowerCase();
    return n && (t.includes(n) || n.includes(t));
  });
  if (contained.length === 1) return contained[0].name;
  const quoted = t.match(/["']([^"']+)["']/);
  if (quoted) {
    const hit = list.find((s) => String(s.name || '').toLowerCase() === quoted[1].toLowerCase());
    if (hit) return hit.name;
  }
  const num = t.match(/\b(?:sheet|tab)\s*(\d+)\b/) || t.match(/^\s*(\d+)[\.)]?\s*$/);
  if (num) {
    const i = Number(num[1]) - 1;
    if (list[i]) return list[i].name;
  }
  return '';
}

function crossLngLat(o, a, b) {
  return (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
}

export function convexHullLatLng(points) {
  const uniq = [];
  const seen = new Set();
  for (const p of points || []) {
    const lat = Number(p?.[0]);
    const lng = Number(p?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const k = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push([lat, lng]);
  }
  if (uniq.length <= 2) return uniq;
  const sorted = [...uniq].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && crossLngLat(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && crossLngLat(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function capGeoJson(geometry, maxRing = 80) {
  if (!geometry || typeof geometry !== 'object') return null;
  const capRing = (ring) => {
    if (!Array.isArray(ring) || ring.length <= maxRing) return ring;
    const step = Math.ceil(ring.length / maxRing);
    const out = ring.filter((_, i) => i % step === 0);
    const first = ring[0];
    const last = out[out.length - 1];
    if (first && (!last || last[0] !== first[0] || last[1] !== first[1])) out.push(first);
    return out;
  };
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: (geometry.coordinates || []).map(capRing) };
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: (geometry.coordinates || []).map((poly) => (poly || []).map(capRing)) };
  }
  return null;
}

export function groupTerritoryShapes(points) {
  const byKey = new Map();
  for (const p of points || []) {
    const key = p.territory || p.id;
    if (!key) continue;
    let g = byKey.get(key);
    if (!g) {
      g = {
        id: p.id || key,
        territory: key,
        team: p.team || '',
        count: 0,
        geos: [],
        coords: [],
        polygons: [],
      };
      byKey.set(key, g);
    }
    g.count += Number(p.count) || 0;
    if (p.geo && !g.geos.includes(p.geo)) g.geos.push(p.geo);
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) g.coords.push([lat, lng]);
    const geom = capGeoJson(typeof p.geojson === 'string' ? (() => { try { return JSON.parse(p.geojson); } catch { return null; } })() : p.geojson);
    if (geom) g.polygons.push(geom);
  }
  return [...byKey.values()].map((g) => {
    const colours = hashTerritoryColour(g.territory);
    const hull = convexHullLatLng(g.coords);
    const lat = g.coords.length ? g.coords.reduce((s, c) => s + c[0], 0) / g.coords.length : null;
    const lng = g.coords.length ? g.coords.reduce((s, c) => s + c[1], 0) / g.coords.length : null;
    return {
      id: g.id,
      territory: g.territory,
      team: g.team,
      count: g.count,
      geos: g.geos,
      colour: colours.colour,
      border: colours.border,
      hull: hull.length >= 2 ? hull : [],
      polygons: g.polygons,
      lat,
      lng,
    };
  }).filter((g) => g.polygons.length || g.hull.length || (Number.isFinite(g.lat) && Number.isFinite(g.lng)));
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
  const shapes = groupTerritoryShapes(points).map((g) => ({
    ...g,
    selected: g.id === selectedId || g.territory === selectedId,
  }));
  const legendItems = shapes.slice(0, 12).map((s) => ({ name: s.territory, colour: s.colour }));
  const payload = JSON.stringify(shapes).replace(/</g, '\\u003c');

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
    const shapes = ${payload};
    const legendItems = ${JSON.stringify(legendItems)};
    const esc = (v) => String(v || '').replace(/[&<>]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));
    const map = L.map('map', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    map.setView([54, -2], 6);
    const bounds = [];
    const remember = (layer) => {
      const b = layer.getBounds && layer.getBounds();
      if (b && b.isValid()) bounds.push(b);
    };
    for (const s of shapes) {
      const fill = s.selected ? 0.55 : 0.32;
      const weight = s.selected ? 3 : 1.5;
      const popup = '<div class="popup-title">' + esc(s.territory) + '</div>' +
        (s.team ? '<div class="popup-rep">Team: ' + esc(s.team) + '</div>' : '') +
        (s.geos && s.geos.length ? '<div class="popup-rep">' + esc(s.geos.slice(0, 8).join(', ')) + (s.geos.length > 8 ? '…' : '') + '</div>' : '') +
        '<div class="popup-rep">Rows: ' + s.count + '</div>';
      const onClick = () => {
        window.parent.postMessage({ type: 'territory-select', id: s.id, territory: s.territory }, '*');
      };
      let drawn = false;
      if (s.hull && s.hull.length >= 3) {
        const layer = L.polygon(s.hull, { color: s.border, weight, fillColor: s.colour, fillOpacity: fill });
        layer.bindPopup(popup, { maxWidth: 260 });
        layer.on('click', onClick);
        layer.addTo(map);
        remember(layer);
        drawn = true;
      } else if (s.polygons && s.polygons.length) {
        for (const geom of s.polygons) {
          const layer = L.geoJSON(geom, {
            style: { color: s.border, weight, fillColor: s.colour, fillOpacity: fill },
          });
          layer.bindPopup(popup, { maxWidth: 260 });
          layer.on('click', onClick);
          layer.addTo(map);
          remember(layer);
          drawn = true;
        }
      } else if (s.hull && s.hull.length === 2) {
        const layer = L.polyline(s.hull, { color: s.colour, weight: 8, opacity: 0.85 });
        layer.bindPopup(popup, { maxWidth: 260 });
        layer.on('click', onClick);
        layer.addTo(map);
        remember(layer);
        drawn = true;
      }
      if (!drawn && Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
        const layer = L.circle([s.lat, s.lng], {
          radius: 7000,
          color: s.border,
          weight,
          fillColor: s.colour,
          fillOpacity: fill,
        });
        layer.bindPopup(popup, { maxWidth: 260 });
        layer.on('click', onClick);
        layer.addTo(map);
        remember(layer);
      }
    }
    const valid = bounds.filter((b) => b && b.isValid && b.isValid());
    if (valid.length > 1) {
      const all = valid[0];
      for (let i = 1; i < valid.length; i += 1) all.extend(valid[i]);
      map.fitBounds(all, { padding: [40, 40], maxZoom: 9 });
    } else if (valid.length === 1) {
      map.fitBounds(valid[0], { padding: [40, 40], maxZoom: 10 });
    }
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'legend');
      div.innerHTML = '<div class="legend-title">TERRITORIES</div>' +
        legendItems.map((m) => '<div class="legend-item"><div class="legend-dot" style="background:' + m.colour + '"></div><span>' + esc(m.name) + '</span></div>').join('') +
        '<div class="legend-sub">Shapes follow the confirmed geography<br>Click a territory to inspect</div>';
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
