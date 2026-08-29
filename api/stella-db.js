/**
 * Company Postgres schemas. Created on first Stella file load/upload, and
 * only if the namespace is not already present. Helpers are installed
 * automatically — no SQL editor.
 *
 * Vercel is IPv4-only. Never use db.*.supabase.co (IPv6). Connect through
 * the session pooler, passing the password as a field so special characters
 * cannot break the URI host.
 */

const { companyPgSchema, isCompanyPgSchema } = require('./company');
const BOOTSTRAP_SQL = require('./stella-bootstrap-sql');

let bootstrapped = false;
let bootstrapInFlight = null;
const ensuredSchemas = new Set();
let workingConfig = null;
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

function envPassword() {
  return String(process.env.SUPABASE_DB_PASSWORD || process.env.POSTGRES_PASSWORD || '').trim();
}

function projectRef() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  return String(supabaseUrl).match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] || '';
}

function stripEnv(raw) {
  return String(raw || '').trim().replace(/^['"]|['"]$/g, '');
}

function isDirectSupabaseHost(host) {
  return /^db\.[a-z0-9]+\.supabase\.co$/i.test(String(host || ''));
}

function redact(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '');
  if (code === '28P01' || /password authentication failed/i.test(msg)) {
    return 'Postgres rejected the password. Check SUPABASE_DB_PASSWORD matches the database password (and DATABASE_URL if you set one).';
  }
  if (code === 'ETIMEDOUT' || code === 'ENETUNREACH' || /timeout|timed out/i.test(msg)) {
    return 'Could not reach the session pooler from Vercel. Confirm DATABASE_URL uses *.pooler.supabase.com.';
  }
  if (code === 'ENOTFOUND' || /getaddrinfo/i.test(msg)) {
    return 'Could not resolve the pooler host. DATABASE_URL must use *.pooler.supabase.com (not db.….supabase.co), without quotes.';
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

function errorRank(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  if (code === '28P01' || /password authentication failed/i.test(msg)) return 4;
  if (code === 'ETIMEDOUT' || /timeout|timed out/i.test(msg)) return 3;
  if (code === 'ENOTFOUND' || /getaddrinfo/i.test(msg)) return 1;
  return 2;
}

function keepErr(prev, next) {
  if (!next) return prev;
  if (!prev) return next;
  return errorRank(next) > errorRank(prev) ? next : prev;
}

function configFromUrl(raw) {
  let s = stripEnv(raw);
  if (!s) return null;
  const password = envPassword();
  if (password && /\[YOUR-PASSWORD\]/i.test(s)) {
    s = s.replace(/\[YOUR-PASSWORD\]/gi, encodeURIComponent(password));
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (isDirectSupabaseHost(u.hostname)) return null;
    const cfg = {
      host: u.hostname,
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || '') || password,
      database: decodeURIComponent((u.pathname || '/postgres').replace(/^\//, '')) || 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    };
    if (!cfg.host || !cfg.user) return null;
    return cfg;
  } catch {
    return null;
  }
}

function poolerConfigs() {
  const password = envPassword();
  const ref = projectRef();
  if (!password || !ref) return [];
  const out = [];
  for (const region of POOLER_REGIONS) {
    for (const host of [
      `aws-0-${region}.pooler.supabase.com`,
      `aws-${region}.pooler.supabase.com`,
    ]) {
      out.push({
        host,
        port: 5432,
        user: `postgres.${ref}`,
        password,
        database: 'postgres',
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 4000,
      });
    }
  }
  return out;
}

function connectionCandidates() {
  const seen = new Set();
  const out = [];
  const add = (cfg) => {
    if (!cfg?.host) return;
    if (isDirectSupabaseHost(cfg.host)) return;
    const key = `${cfg.host}|${cfg.port}|${cfg.user}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cfg);
  };

  if (workingConfig) add(workingConfig);

  const fromEnv = [];
  for (const raw of [
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DIRECT_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.SUPABASE_DB_URL,
  ]) {
    const cfg = configFromUrl(raw);
    if (cfg) {
      add(cfg);
      fromEnv.push(cfg);
    }
  }

  if (fromEnv.length) {
    const password = envPassword();
    if (password && fromEnv[0].host) {
      add({
        ...fromEnv[0],
        password,
        connectionTimeoutMillis: 8000,
      });
    }
  } else {
    for (const cfg of poolerConfigs()) add(cfg);
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
  const configs = connectionCandidates();
  if (!configs.length) {
    throw new Error('No database URL');
  }
  let lastErr;
  for (const cfg of configs) {
    const client = new Client(cfg);
    let connected = false;
    try {
      await client.connect();
      connected = true;
      const result = await fn(client);
      workingConfig = cfg;
      return result;
    } catch (err) {
      lastErr = keepErr(lastErr, err);
      console.warn(
        'Stella Postgres',
        connected ? 'query' : 'connect',
        'failed',
        cfg.host,
        err?.code || '',
        String(err?.message || err).replace(/postgresql:\/\/[^@\s]+@/gi, 'postgresql://***@').slice(0, 180),
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
      const { rows } = await client.query(
        `select to_regprocedure('public.stella_ensure_schema(text)') is not null as ok`,
      );
      if (!rows[0]?.ok) {
        await client.query(BOOTSTRAP_SQL);
      }
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

function quoteIdent(name) {
  if (!isCompanyPgSchema(name) && name !== 'public') {
    throw new Error('Invalid identifier');
  }
  return `"${String(name).replace(/"/g, '""')}"`;
}

function slugFromSchema(schema) {
  return String(schema || '').replace(/^c_/, '');
}

async function ensureCompanyFilesTable(schema) {
  if (!isCompanyPgSchema(schema)) return;
  const q = quoteIdent(schema);
  const slug = slugFromSchema(schema);
  await withPg(async (client) => {
    const pub = await client.query(`select to_regclass('public.stella_files') is not null as ok`);
    if (pub.rows[0]?.ok) {
      await client.query(`create table if not exists ${q}.stella_files (like public.stella_files including all)`);
      await client.query(
        `insert into ${q}.stella_files
         select * from public.stella_files
         where company_slug = $1
            or org_id like $2
         on conflict (id) do nothing`,
        [slug, `company:${slug}:%`],
      );
    } else {
      await client.query(`
        create table if not exists ${q}.stella_files (
          id uuid primary key default gen_random_uuid(),
          org_id text default 'default',
          file_name text,
          file_type text,
          storage_path text,
          table_name text,
          columns jsonb,
          row_count integer,
          summary text,
          context_qa jsonb,
          uploaded_at timestamptz default now(),
          company_slug text
        )
      `);
    }
  });
}

async function createSchemaViaPg(schema) {
  await bootstrapViaPg();
  await withPg(async (client) => {
    await client.query('select public.stella_ensure_schema($1)', [schema]);
  });
}

function resolveSchemaName(companyOrSchema) {
  const raw = String(companyOrSchema || '').trim();
  return isCompanyPgSchema(raw) ? raw : companyPgSchema(raw);
}

async function inspectCompanySchema(schema) {
  const { rows } = await withPg((client) => client.query(
    `select
       exists(select 1 from pg_namespace where nspname = $1) as schema_ok,
       to_regclass(($1 || '.stella_files')::text) is not null as files_ok`,
    [schema],
  ));
  return {
    schemaOk: !!rows[0]?.schema_ok,
    filesOk: !!rows[0]?.files_ok,
  };
}

/** True when c_<company> already exists. Does not create anything. */
async function companySchemaPresent(companyOrSchema) {
  const schema = resolveSchemaName(companyOrSchema);
  if (!isCompanyPgSchema(schema)) return false;
  if (ensuredSchemas.has(schema)) return true;
  try {
    const { schemaOk } = await inspectCompanySchema(schema);
    lastEnsureError = '';
    return schemaOk;
  } catch (err) {
    lastEnsureError = redact(err);
    return false;
  }
}

/**
 * Create c_<company> only if it is missing (first Stella file load/upload).
 * If the namespace already exists, this is a cheap existence check.
 */
async function ensureCompanyPgSchema(companyOrSchema) {
  const schema = resolveSchemaName(companyOrSchema);
  if (!isCompanyPgSchema(schema)) {
    lastEnsureError = 'Invalid company schema name.';
    return false;
  }
  if (ensuredSchemas.has(schema)) {
    lastEnsureError = '';
    return true;
  }

  lastEnsureError = '';
  try {
    const { schemaOk, filesOk } = await inspectCompanySchema(schema);
    if (schemaOk) {
      if (!filesOk) {
        try {
          await ensureCompanyFilesTable(schema);
        } catch (err) {
          console.warn('Could not ensure company file registry', schema, err?.message || err);
        }
      }
      ensuredSchemas.add(schema);
      return true;
    }
  } catch (err) {
    lastEnsureError = redact(err);
  }

  try {
    await bootstrapViaPg();
  } catch (err) {
    lastEnsureError = lastEnsureError || redact(err);
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

  if (ok) {
    try {
      await ensureCompanyFilesTable(schema);
    } catch (err) {
      console.warn('Could not ensure company file registry', schema, err?.message || err);
    }
    ensuredSchemas.add(schema);
  }
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
  companySchemaPresent,
  ensureCompanyPgSchema,
  ensureAllCompanySchemas,
  ensureCompanyFilesTable,
  getLastEnsureError,
  withPg,
  quoteIdent,
};
