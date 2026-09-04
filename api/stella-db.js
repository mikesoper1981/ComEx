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

/** Split SQL so node-pg can run it. Extended protocol rejects multi-statement strings. */
function splitSqlStatements(sql) {
  const out = [];
  let cur = '';
  const s = String(sql || '');
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '-' && s[i + 1] === '-') {
      const end = s.indexOf('\n', i);
      i = end === -1 ? s.length : end;
      continue;
    }
    if (s[i] === "'") {
      cur += s[i];
      i += 1;
      while (i < s.length) {
        cur += s[i];
        if (s[i] === "'" && s[i + 1] === "'") {
          cur += s[i + 1];
          i += 2;
          continue;
        }
        if (s[i] === "'") break;
        i += 1;
      }
      continue;
    }
    if (s[i] === '$' && s[i + 1] === '$') {
      const end = s.indexOf('$$', i + 2);
      cur += s.slice(i, end === -1 ? s.length : end + 2);
      i = end === -1 ? s.length : end + 1;
      continue;
    }
    if (s[i] === ';') {
      const stmt = cur.trim();
      if (stmt) out.push(stmt);
      cur = '';
      continue;
    }
    cur += s[i];
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

async function applyBootstrapSql(client) {
  for (const stmt of splitSqlStatements(BOOTSTRAP_SQL)) {
    try {
      await client.query(stmt);
    } catch (err) {
      console.warn('Stella bootstrap statement failed', String(err?.message || err).slice(0, 220));
    }
  }
}

async function bootstrapViaPg() {
  if (bootstrapped) return true;
  if (bootstrapInFlight) return bootstrapInFlight;
  bootstrapInFlight = (async () => {
    await withPg((client) => applyBootstrapSql(client));
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

const DATA_TABLE_RE = /^(stella_data_|territory_data_)[a-z0-9_]+$/;

function quoteDataTable(name) {
  if (!DATA_TABLE_RE.test(String(name || ''))) {
    throw new Error('Invalid table name');
  }
  return `"${name}"`;
}

async function sharedStellaFilesColumns(client, schema) {
  const { rows } = await client.query(
    `select c.column_name
     from information_schema.columns c
     join information_schema.columns p
       on p.column_name = c.column_name
     where c.table_schema = $1 and c.table_name = 'stella_files'
       and p.table_schema = 'public' and p.table_name = 'stella_files'
     order by c.ordinal_position`,
    [schema],
  );
  return rows.map((r) => `"${String(r.column_name).replace(/"/g, '')}"`).filter((c) => c !== '""');
}

async function ensureStellaFilesColumns(client, schema) {
  const targets = ['public'];
  if (isCompanyPgSchema(schema)) targets.push(schema);
  for (const sch of targets) {
    const exists = await client.query('select to_regclass($1) is not null as ok', [`${sch}.stella_files`]);
    if (!exists.rows[0]?.ok) continue;
    const q = sch === 'public' ? '"public"' : quoteIdent(sch);
    await client.query(`alter table ${q}.stella_files add column if not exists uploaded_by text`);
    await client.query(`alter table ${q}.stella_files add column if not exists uploaded_by_name text`);
    await client.query(
      `update ${q}.stella_files
       set uploaded_by = regexp_replace(org_id, '^.*user:', '')
       where coalesce(uploaded_by, '') = ''
         and org_id ~ 'user:'`,
    );
  }
}

async function detachFilesInheritance(client, schema) {
  const q = quoteIdent(schema);
  await client.query(`
    do $body$
    begin
      if exists (
        select 1
        from pg_inherits
        where inhrelid = to_regclass('${q}.stella_files')
          and inhparent = 'public.stella_files'::regclass
      ) then
        execute 'alter table ${q}.stella_files no inherit public.stella_files';
      end if;
    exception when others then
      null;
    end
    $body$;
  `);
}

async function moveExtractTable(client, schema, tableName) {
  if (!DATA_TABLE_RE.test(String(tableName || ''))) return;
  const q = quoteIdent(schema);
  const t = quoteDataTable(tableName);
  const pub = await client.query('select to_regclass($1) is not null as ok', [`public.${tableName}`]);
  const company = await client.query('select to_regclass($1) is not null as ok', [`${schema}.${tableName}`]);
  const pubOk = !!pub.rows[0]?.ok;
  const companyOk = !!company.rows[0]?.ok;
  if (pubOk && !companyOk) {
    await client.query(`alter table public.${t} set schema ${q}`);
    return;
  }
  if (pubOk && companyOk) {
    const count = await client.query(`select count(*)::int as n from ${q}.${t}`);
    if (!count.rows[0]?.n) {
      await client.query(`insert into ${q}.${t} select * from public.${t}`);
    }
    await client.query(`drop table public.${t}`);
  }
}

/**
 * Copy leftover public.stella_files / public.stella_data_* into the company
 * schema, then remove those leftovers from public. Called on every list/upload
 * so PharmaCo (c_pharmaco) stays current even if older code wrote public.
 */
async function migratePublicStellaIntoCompany(schema, { orgIds } = {}) {
  if (!isCompanyPgSchema(schema)) return;
  const q = quoteIdent(schema);
  const slug = slugFromSchema(schema);
  const orgs = [...new Set((Array.isArray(orgIds) ? orgIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  await withPg(async (client) => {
    await ensureStellaFilesColumns(client, schema);
    const pub = await client.query(`select to_regclass('public.stella_files') is not null as ok`);
    if (pub.rows[0]?.ok) {
      await client.query(`create table if not exists ${q}.stella_files (like public.stella_files including all)`);
      await detachFilesInheritance(client, schema);
      const cols = await sharedStellaFilesColumns(client, schema);
      if (cols.length) {
        const colList = cols.join(', ');
        const updates = cols
          .filter((c) => c !== '"id"')
          .map((c) => `${c} = excluded.${c}`)
          .join(', ');
        const storageMatch = cols.includes('"storage_path"')
          ? ' or storage_path like $4'
          : '';
        const matchSql = cols.includes('"company_slug"')
          ? `(company_slug = $1 or org_id like $2 or ($3::text[] <> '{}' and org_id = any($3::text[]))${storageMatch})`
          : `(org_id like $2 or ($3::text[] <> '{}' and org_id = any($3::text[]))${storageMatch})`;
        const copyParams = [slug, `company:${slug}:%`, orgs, `companies/${slug}/%`];
        const copySql = updates
          ? `insert into ${q}.stella_files (${colList})
             select ${colList} from public.stella_files
             where ${matchSql}
             on conflict (id) do update set ${updates}`
          : `insert into ${q}.stella_files (${colList})
             select ${colList} from public.stella_files
             where ${matchSql}
             on conflict (id) do nothing`;
        try {
          await client.query(copySql, copyParams);
        } catch (err) {
          console.warn('Company registry copy used insert-only', err?.message || err);
          await client.query(
            `insert into ${q}.stella_files (${colList})
             select ${colList} from public.stella_files
             where ${matchSql}
               and id not in (select id from ${q}.stella_files)`,
            copyParams,
          );
        }
        await client.query(
          `delete from public.stella_files
           where id in (select id from ${q}.stella_files)
             and ${matchSql}`,
          copyParams,
        );
      }
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
          company_slug text,
          uploaded_by text,
          uploaded_by_name text
        )
      `);
    }

    const tables = await client.query(
      `select distinct table_name
       from ${q}.stella_files
       where table_name ~ '^stella_data_[a-z0-9_]+$'`,
    );
    for (const row of tables.rows || []) {
      try {
        await moveExtractTable(client, schema, row.table_name);
      } catch (err) {
        console.warn('Could not move leftover public extract table', row.table_name, err?.message || err);
      }
    }
  });
}

async function ensureCompanyFilesTable(schema, extra = {}) {
  await migratePublicStellaIntoCompany(schema, extra);
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

  // Cheap path: company schema already exists — skip bootstrap SQL and leftover
  // public-table copies. Those only matter on first create.
  try {
    const { schemaOk, filesOk } = await inspectCompanySchema(schema);
    if (schemaOk && filesOk) {
      ensuredSchemas.add(schema);
      return true;
    }
    if (schemaOk) {
      try {
        await ensureCompanyFilesTable(schema);
      } catch (err) {
        console.warn('Could not ensure company file registry', schema, err?.message || err);
        if (!filesOk) {
          lastEnsureError = lastEnsureError || redact(err);
          return false;
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
  migratePublicStellaIntoCompany,
  getLastEnsureError,
  withPg,
  quoteIdent,
  quoteDataTable,
  DATA_TABLE_RE,
};
