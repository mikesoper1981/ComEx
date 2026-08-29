/**
 * Company Postgres schemas. Created by the app when a company is added.
 * Helpers are installed automatically — no SQL editor.
 *
 * Vercel cannot reach Supabase's direct host (db.*.supabase.co, IPv6).
 * Prefer DATABASE_URL (session pooler) or build a pooler URI from
 * VITE_SUPABASE_URL + SUPABASE_DB_PASSWORD.
 */

const { companyPgSchema, isCompanyPgSchema } = require('./company');
const BOOTSTRAP_SQL = require('./stella-bootstrap-sql');

let bootstrapped = false;
let bootstrapInFlight = null;
const ensuredSchemas = new Set();
let workingConnectionString = null;
let lastEnsureError = '';

const POOLER_REGIONS = [
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'us-east-1',
  'us-west-1',
  'ap-southeast-1',
];

function supabaseRest() {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  return { supabaseUrl, serviceKey };
}

function withSsl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/[?&]sslmode=/i.test(u)) return u;
  return `${u}${u.includes('?') ? '&' : '?'}sslmode=require`;
}

function redact(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '');
  if (code === '28P01' || /password authentication failed/i.test(msg)) {
    return 'Postgres rejected the password. Check DATABASE_URL and SUPABASE_DB_PASSWORD.';
  }
  if (code === 'ETIMEDOUT' || code === 'ENETUNREACH' || /timeout|timed out/i.test(msg)) {
    return 'Could not reach Postgres from the server. DATABASE_URL must be the session pooler URI (pooler.supabase.com), not db.….supabase.co.';
  }
  if (code === 'ENOTFOUND' || /getaddrinfo/i.test(msg)) {
    return 'Postgres host was not found. Check DATABASE_URL.';
  }
  if (/No database URL/i.test(msg)) {
    return 'No DATABASE_URL or SUPABASE_DB_PASSWORD on the server.';
  }
  if (/pg is not installed/i.test(msg)) {
    return 'Postgres client is missing on the server.';
  }
  const slim = msg.replace(/postgresql:\/\/[^@\s]+@/gi, 'postgresql://***@').slice(0, 180);
  return slim || 'Could not create the company schema.';
}

function connectionCandidates() {
  const seen = new Set();
  const out = [];
  const add = (url, timeoutMs) => {
    const u = withSsl(url);
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push({ url: u, timeoutMs: timeoutMs || 8000 });
  };

  if (workingConnectionString) add(workingConnectionString, 8000);

  for (const u of [
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DIRECT_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.SUPABASE_DB_URL,
  ]) {
    add(u, 8000);
  }

  const password = process.env.SUPABASE_DB_PASSWORD || process.env.POSTGRES_PASSWORD || '';
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const ref = String(supabaseUrl).match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (password && ref) {
    const enc = encodeURIComponent(password);
    const pooledUser = `postgres.${ref}`;
    for (const region of POOLER_REGIONS) {
      add(`postgresql://${pooledUser}:${enc}@aws-0-${region}.pooler.supabase.com:5432/postgres`, 4000);
    }
    add(`postgresql://postgres:${enc}@db.${ref}.supabase.co:5432/postgres`, 2000);
  }
  return out;
}

async function withPg(fn) {
  let Client;
  try {
    ({ Client } = require('pg'));
  } catch {
    throw new Error('pg is not installed');
  }
  const urls = connectionCandidates();
  if (!urls.length) {
    throw new Error('No database URL');
  }
  let lastErr;
  for (const { url, timeoutMs } of urls) {
    const client = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: timeoutMs,
    });
    let connected = false;
    try {
      await client.connect();
      connected = true;
      const result = await fn(client);
      workingConnectionString = url;
      return result;
    } catch (err) {
      lastErr = err;
      console.warn(
        'Stella Postgres',
        connected ? 'query' : 'connect',
        'failed',
        err?.code || '',
        String(err?.message || err).replace(/postgresql:\/\/[^@\s]+@/gi, 'postgresql://***@').slice(0, 220),
      );
      if (connected) break;
    } finally {
      await client.end().catch(() => {});
    }
  }
  throw lastErr || new Error('Could not connect to Postgres');
}

async function supabaseRpc(fn, args) {
  const { supabaseUrl, serviceKey } = supabaseRest();
  if (!supabaseUrl || !serviceKey) return { ok: false, status: 0 };
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(args || {}),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.warn('Stella RPC failed', fn, res.status, String(text || '').slice(0, 300));
    }
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.warn('Stella RPC error', fn, err?.message || err);
    return { ok: false, status: 0 };
  }
}

async function bootstrapViaPg() {
  if (bootstrapped) return true;
  if (bootstrapInFlight) return bootstrapInFlight;
  bootstrapInFlight = (async () => {
    await withPg(async (client) => {
      await client.query(BOOTSTRAP_SQL);
    });
    bootstrapped = true;
    return true;
  })();
  try {
    return await bootstrapInFlight;
  } catch (err) {
    bootstrapInFlight = null;
    throw err;
  }
}

async function createSchemaViaPg(schema) {
  await bootstrapViaPg();
  await withPg(async (client) => {
    await client.query('select public.stella_ensure_schema($1)', [schema]);
  });
}

/**
 * Create c_<company> (and install Stella helpers / company RLS if needed).
 * Safe to call repeatedly.
 */
async function ensureCompanyPgSchema(companyOrSchema) {
  const raw = String(companyOrSchema || '').trim();
  const schema = isCompanyPgSchema(raw) ? raw : companyPgSchema(raw);
  if (!isCompanyPgSchema(schema)) {
    lastEnsureError = 'Invalid company schema name.';
    return false;
  }
  if (ensuredSchemas.has(schema) && bootstrapped) {
    lastEnsureError = '';
    return true;
  }

  lastEnsureError = '';
  try {
    await bootstrapViaPg();
  } catch (err) {
    lastEnsureError = redact(err);
    console.warn('Could not bootstrap Stella tenant SQL', lastEnsureError);
  }

  let ok = false;
  const rpc = await supabaseRpc('stella_ensure_schema', { p_schema: schema });
  if (rpc.ok) {
    ok = true;
    lastEnsureError = '';
  } else {
    try {
      await createSchemaViaPg(schema);
      ok = true;
      lastEnsureError = '';
    } catch (err) {
      lastEnsureError = lastEnsureError || redact(err);
      console.warn('Could not create company schema', schema, lastEnsureError);
    }
  }

  const lockdown = await supabaseRpc('stella_apply_tenant_security', {});
  if (lockdown.ok) bootstrapped = true;

  if (ok) ensuredSchemas.add(schema);
  return ok;
}

async function ensureAllCompanySchemas(companies) {
  const names = [...new Set((companies || []).map((c) => String(c || '').trim()).filter(Boolean))];
  const results = await Promise.all(names.map((c) => ensureCompanyPgSchema(c)));
  return names.length === 0 || results.some(Boolean);
}

function getLastEnsureError() {
  return lastEnsureError;
}

module.exports = {
  ensureCompanyPgSchema,
  ensureAllCompanySchemas,
  getLastEnsureError,
};
