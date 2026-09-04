/**
 * Territory map API — teams, grouped geo points, and cached Nominatim geocoding.
 *
 * POST { action: 'teams', tableName, layout }
 * POST { action: 'map', tableName, layout, team, geocode }
 *
 * Tables: company schema territory_data_* (or stella_data_*).
 * Cache:  company schema geocode_cache (created on first use).
 */

const { sessionUserFromRequest } = require('./accounts-store');
const { companyPgSchema, resolveUserCompany, ensureCompanyPgSchema, isCompanyPgSchema } = require('./company');
const { withPg, quoteIdent, DATA_TABLE_RE, quoteDataTable } = require('./stella-db');

const GEOCODE_BATCH = 8;
const UNIQUE_GEO_CAP = 350;
const GROUP_ROW_CAP = 1200;
const NOMINATIM_PAUSE_MS = 1100;
const GEO_KINDS = new Set(['postcode', 'zip', 'city', 'county', 'region']);

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return { error: 'Invalid JSON body' };
    }
  }
  return { body: body && typeof body === 'object' ? body : {} };
}

function requireCompanySchema(schema) {
  if (!isCompanyPgSchema(schema)) {
    throw new Error('Territory data must use a company schema');
  }
  return quoteIdent(schema);
}

function quoteCol(name) {
  const n = String(name || '').replace(/"/g, '');
  if (!n || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)) throw new Error('Invalid column name');
  return `"${n}"`;
}

function normalizeLayout(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const col = (v) => String(v || '').trim().replace(/[^a-zA-Z0-9_]/g, '');
  const kind = String(src.geoKind || src.geo_kind || '').trim().toLowerCase();
  return {
    teamColumn: col(src.teamColumn || src.team_column),
    territoryColumn: col(src.territoryColumn || src.territory_column),
    geoColumn: col(src.geoColumn || src.geo_column),
    geoKind: GEO_KINDS.has(kind) ? kind : 'region',
    country: String(src.country || '').trim().slice(0, 80),
    repColumn: col(src.repColumn || src.rep_column),
  };
}

function looksLikeUkPostcode(value) {
  const t = String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  return /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(t) || /^[A-Z]{1,2}\d[A-Z\d]?$/.test(t);
}

function normalizeUkPostcode(value) {
  const t = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(t)) {
    return `${t.slice(0, -3)} ${t.slice(-3)}`;
  }
  return String(value || '').trim().toUpperCase();
}

function outwardPostcode(value) {
  const full = normalizeUkPostcode(value);
  const parts = full.split(/\s+/);
  if (parts.length === 2) return parts[0];
  return full;
}

function normalizeGeoValue(raw, kind) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (kind === 'zip') {
    const digits = s.replace(/\D/g, '');
    if (digits.length === 4) return digits.padStart(5, '0');
    if (digits.length >= 5) return digits.slice(0, 5);
    return s;
  }
  if (kind === 'postcode') return normalizeUkPostcode(s);
  return s;
}

function defaultCountry(kind, layoutCountry, sampleGeo) {
  if (layoutCountry) return layoutCountry;
  if (kind === 'postcode' || looksLikeUkPostcode(sampleGeo)) return 'United Kingdom';
  if (kind === 'zip') return 'United States';
  return '';
}

function searchQuery(geo, kind, country) {
  const place = String(geo || '').trim();
  if (!place) return '';
  if (country) return `${place}, ${country}`;
  return place;
}

function cacheKey(kind, country, geo) {
  return `${kind || 'region'}|${String(country || '').toLowerCase()}|${String(geo || '').toLowerCase()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureGeocodeCache(schema) {
  const q = requireCompanySchema(schema);
  await withPg((client) => client.query(`
    create table if not exists ${q}.geocode_cache (
      query_key text primary key,
      query_text text,
      lat double precision,
      lng double precision,
      display_name text,
      status text,
      geojson jsonb,
      updated_at timestamptz default now()
    )
  `));
  await withPg((client) => client.query(
    `alter table ${q}.geocode_cache add column if not exists geojson jsonb`,
  ));
}

async function tableColumns(schema, tableName) {
  const { rows } = await withPg((client) => client.query(
    `select column_name from information_schema.columns
     where table_schema = $1 and table_name = $2`,
    [schema, tableName],
  ));
  return new Set((rows || []).map((r) => String(r.column_name)));
}

async function nominatimSearch(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&polygon_geojson=1`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en',
      'User-Agent': 'ComEx-TerritoryMap/1.0 (https://github.com/mikesoper1981/ComEx)',
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => []);
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) return null;
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    display_name: String(hit.display_name || '').slice(0, 240),
    geojson: geometryFromNominatim(hit),
  };
}

function capRing(ring, maxPts = 80) {
  if (!Array.isArray(ring) || ring.length <= maxPts) return ring;
  const step = Math.ceil(ring.length / maxPts);
  const out = ring.filter((_, i) => i % step === 0);
  const first = ring[0];
  const last = out[out.length - 1];
  if (first && (!last || last[0] !== first[0] || last[1] !== first[1])) out.push(first);
  return out;
}

function geometryFromNominatim(hit) {
  const g = hit?.geojson;
  if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
    if (g.type === 'Polygon') return { type: 'Polygon', coordinates: (g.coordinates || []).map((r) => capRing(r)) };
    return { type: 'MultiPolygon', coordinates: (g.coordinates || []).map((poly) => (poly || []).map((r) => capRing(r))) };
  }
  const bb = hit?.boundingbox;
  if (Array.isArray(bb) && bb.length === 4) {
    const south = parseFloat(bb[0]);
    const north = parseFloat(bb[1]);
    const west = parseFloat(bb[2]);
    const east = parseFloat(bb[3]);
    if ([south, north, west, east].every(Number.isFinite) && (north - south) > 0.015 && (east - west) > 0.015) {
      return {
        type: 'Polygon',
        coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
      };
    }
  }
  return null;
}

async function loadCached(schema, keys) {
  if (!keys.length) return new Map();
  const q = requireCompanySchema(schema);
  const { rows } = await withPg((client) => client.query(
    `select query_key, lat, lng, display_name, status, geojson from ${q}.geocode_cache where query_key = any($1::text[])`,
    [keys],
  ));
  const map = new Map();
  for (const row of rows || []) {
    map.set(row.query_key, row);
  }
  return map;
}

async function upsertCache(schema, rows) {
  if (!rows.length) return;
  const q = requireCompanySchema(schema);
  await withPg((client) => client.query(
    `insert into ${q}.geocode_cache (query_key, query_text, lat, lng, display_name, status, geojson, updated_at)
     select query_key, query_text, lat, lng, display_name, status, geojson, now()
     from jsonb_to_recordset($1::jsonb) as x(
       query_key text, query_text text, lat double precision, lng double precision, display_name text, status text, geojson jsonb
     )
     on conflict (query_key) do update set
       query_text = excluded.query_text,
       lat = excluded.lat,
       lng = excluded.lng,
       display_name = excluded.display_name,
       status = excluded.status,
       geojson = excluded.geojson,
       updated_at = now()`,
    [JSON.stringify(rows)],
  ));
}

async function geocodeMisses(schema, misses, kind, country) {
  const written = [];
  for (let i = 0; i < misses.length && i < GEOCODE_BATCH; i += 1) {
    const item = misses[i];
    const queries = [searchQuery(item.geo, kind, country)];
    if (kind === 'postcode' && item.geo.includes(' ')) {
      queries.push(searchQuery(outwardPostcode(item.geo), kind, country || 'United Kingdom'));
    }
    let hit = null;
    for (const q of queries.filter(Boolean)) {
      hit = await nominatimSearch(q);
      if (hit) break;
      await sleep(NOMINATIM_PAUSE_MS);
    }
    written.push({
      query_key: item.key,
      query_text: queries[0] || item.geo,
      lat: hit?.lat ?? null,
      lng: hit?.lng ?? null,
      display_name: hit?.display_name || '',
      status: hit ? 'ok' : 'miss',
      geojson: hit?.geojson || null,
    });
    if (i < misses.length - 1) await sleep(NOMINATIM_PAUSE_MS);
  }
  await upsertCache(schema, written);
  return written;
}

async function distinctTeams(schema, tableName, layout) {
  const q = requireCompanySchema(schema);
  const t = quoteDataTable(tableName);
  if (!layout.teamColumn) return [];
  const col = quoteCol(layout.teamColumn);
  const { rows } = await withPg((client) => client.query(
    `select distinct ${col}::text as team
     from ${q}.${t}
     where ${col} is not null and btrim(${col}::text) <> ''
     order by 1
     limit 80`,
  ));
  return (rows || []).map((r) => String(r.team || '').trim()).filter(Boolean);
}

function collapseGrouped(rows, kind) {
  const unique = new Set(rows.map((r) => r.geo).filter(Boolean));
  if (unique.size <= UNIQUE_GEO_CAP) {
    return { rows, collapsed: null };
  }
  if (kind === 'postcode') {
    const byKey = new Map();
    for (const r of rows) {
      const geo = outwardPostcode(r.geo);
      const key = `${r.team}||${r.territory}||${geo}`;
      const prev = byKey.get(key);
      if (prev) prev.count += r.count;
      else byKey.set(key, { ...r, geo, count: r.count });
    }
    const collapsed = [...byKey.values()];
    const still = new Set(collapsed.map((r) => r.geo));
    if (still.size <= UNIQUE_GEO_CAP) return { rows: collapsed, collapsed: 'outward' };
  }
  const byTerr = new Map();
  for (const r of rows) {
    const key = `${r.team}||${r.territory}`;
    const prev = byTerr.get(key);
    if (prev) {
      prev.count += r.count;
      if (!prev.geo && r.geo) prev.geo = r.geo;
    } else {
      byTerr.set(key, { ...r });
    }
  }
  return { rows: [...byTerr.values()], collapsed: 'territory' };
}

async function groupedPoints(schema, tableName, layout, team) {
  const q = requireCompanySchema(schema);
  const t = quoteDataTable(tableName);
  const geoCol = quoteCol(layout.geoColumn);
  const terrExpr = layout.territoryColumn
    ? `${quoteCol(layout.territoryColumn)}::text`
    : `${geoCol}::text`;
  const teamExpr = layout.teamColumn
    ? `${quoteCol(layout.teamColumn)}::text`
    : `''`;
  const params = [];
  const where = [`${geoCol} is not null`, `btrim(${geoCol}::text) <> ''`];
  if (layout.teamColumn && team) {
    params.push(team);
    where.push(`${quoteCol(layout.teamColumn)}::text = $${params.length}`);
  }
  const sql = `
    select ${teamExpr} as team,
           ${terrExpr} as territory,
           btrim(${geoCol}::text) as geo,
           count(*)::int as n
    from ${q}.${t}
    where ${where.join(' and ')}
    group by 1, 2, 3
    order by n desc
    limit ${GROUP_ROW_CAP}
  `;
  const { rows } = await withPg((client) => client.query(sql, params));
  const mapped = (rows || []).map((r) => ({
    team: String(r.team || '').trim(),
    territory: String(r.territory || '').trim() || String(r.geo || '').trim(),
    geo: normalizeGeoValue(r.geo, layout.geoKind),
    count: Number(r.n) || 0,
  })).filter((r) => r.geo);
  return collapseGrouped(mapped, layout.geoKind);
}

async function executeTerritoryAction(user, body) {
  const action = String(body.action || 'map').trim().toLowerCase();
  const tableName = String(body.tableName || '').trim();
  if (!DATA_TABLE_RE.test(tableName)) {
    return { status: 400, json: { error: { message: 'Invalid table name' } } };
  }
  const layout = normalizeLayout(body.layout);
  if (action !== 'teams' && !layout.geoColumn) {
    return { status: 400, json: { error: { message: 'A geography column is required to map this file' } } };
  }

  const company = resolveUserCompany(user);
  const schema = companyPgSchema(company);
  const ok = await ensureCompanyPgSchema(company);
  if (!ok) {
    return { status: 503, json: { error: { message: 'Company database schema is not ready' } } };
  }

  const cols = await tableColumns(schema, tableName);
  if (!cols.size) {
    return { status: 404, json: { error: { message: 'Territory table not found' } } };
  }
  for (const key of ['teamColumn', 'territoryColumn', 'geoColumn', 'repColumn']) {
    if (layout[key] && !cols.has(layout[key])) {
      return { status: 400, json: { error: { message: `Column ${layout[key]} is not in this table` } } };
    }
  }

  const teams = await distinctTeams(schema, tableName, layout);
  if (action === 'teams') {
    return { status: 200, json: { teams, layout } };
  }

  const teamFilter = String(body.team || '').trim();
  const { rows: grouped, collapsed } = await groupedPoints(schema, tableName, layout, teamFilter);
  const country = defaultCountry(layout.geoKind, layout.country, grouped[0]?.geo);
  const uniqueGeos = [...new Map(grouped.map((r) => [cacheKey(layout.geoKind, country, r.geo), r.geo])).entries()]
    .map(([key, geo]) => ({ key, geo }));

  await ensureGeocodeCache(schema);
  const cached = await loadCached(schema, uniqueGeos.map((g) => g.key));
  const misses = uniqueGeos.filter((g) => {
    const hit = cached.get(g.key);
    return !hit || (hit.status !== 'ok' && hit.status !== 'miss');
  });

  const shouldGeocode = body.geocode !== false;
  if (shouldGeocode && misses.length) {
    const written = await geocodeMisses(schema, misses, layout.geoKind, country);
    for (const row of written) cached.set(row.query_key, row);
  }

  const remaining = uniqueGeos.filter((g) => {
    const hit = cached.get(g.key);
    return !hit || (hit.status !== 'ok' && hit.status !== 'miss');
  }).length;

  const points = [];
  let geocoded = 0;
  for (const row of grouped) {
    const key = cacheKey(layout.geoKind, country, row.geo);
    const hit = cached.get(key);
    const lat = hit?.lat != null ? Number(hit.lat) : null;
    const lng = hit?.lng != null ? Number(hit.lng) : null;
    const okHit = hit?.status === 'ok' && Number.isFinite(lat) && Number.isFinite(lng);
    if (okHit) geocoded += 1;
    points.push({
      id: `${row.territory}::${row.geo}`,
      team: row.team,
      territory: row.territory,
      geo: row.geo,
      count: row.count,
      lat: okHit ? lat : null,
      lng: okHit ? lng : null,
      geojson: okHit ? (hit.geojson || null) : null,
    });
  }

  return {
    status: 200,
    json: {
      teams,
      points,
      pending: remaining,
      geocoded,
      uniqueGeos: uniqueGeos.length,
      collapsed,
      country,
      layout,
    },
  };
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }
  const user = await sessionUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: { message: 'Sign in required' } });
  }
  const parsed = parseBody(req);
  if (parsed.error) {
    return res.status(400).json({ error: { message: parsed.error } });
  }
  try {
    const result = await executeTerritoryAction(user, parsed.body);
    return res.status(result.status).json(result.json);
  } catch (err) {
    return res.status(502).json({
      error: { message: err instanceof Error ? err.message : 'Upstream request failed' },
    });
  }
}

handler.executeTerritoryAction = executeTerritoryAction;
module.exports = handler;
