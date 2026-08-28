/**
 * Company Postgres schemas. Created by the app when a company is added.
 * Helpers are installed automatically — no SQL editor.
 */

const { companyPgSchema, isCompanyPgSchema } = require('./company');
const BOOTSTRAP_SQL = require('./stella-bootstrap-sql');

let bootstrapped = false;
let bootstrapInFlight = null;

function supabaseRest() {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  return { supabaseUrl, serviceKey };
}

function connectionUrls() {
  const listed = [
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DIRECT_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.SUPABASE_DB_URL,
  ].map((u) => String(u || '').trim()).filter(Boolean);

  const password = process.env.SUPABASE_DB_PASSWORD || process.env.POSTGRES_PASSWORD || '';
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const ref = String(supabaseUrl).match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (password && ref) {
    const enc = encodeURIComponent(password);
    listed.push(`postgresql://postgres:${enc}@db.${ref}.supabase.co:5432/postgres`);
  }
  return [...new Set(listed)];
}

async function withPg(fn) {
  let Client;
  try {
    ({ Client } = require('pg'));
  } catch {
    throw new Error('pg is not installed');
  }
  const urls = connectionUrls();
  if (!urls.length) {
    throw new Error('No database URL');
  }
  let lastErr;
  for (const connectionString of urls) {
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      try {
        return await fn(client);
      } finally {
        await client.end().catch(() => {});
      }
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => {});
    }
  }
  throw lastErr || new Error('Could not connect to Postgres');
}

async function rpcEnsureSchema(schema) {
  const { supabaseUrl, serviceKey } = supabaseRest();
  if (!supabaseUrl || !serviceKey) return false;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/stella_ensure_schema`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ p_schema: schema }),
    });
    return res.ok;
  } catch {
    return false;
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
 * Create c_<company> (and install Stella helpers if needed).
 * Safe to call repeatedly.
 */
async function ensureCompanyPgSchema(companyOrSchema) {
  const raw = String(companyOrSchema || '').trim();
  const schema = isCompanyPgSchema(raw) ? raw : companyPgSchema(raw);
  if (!isCompanyPgSchema(schema)) return false;

  if (await rpcEnsureSchema(schema)) {
    bootstrapped = true;
    return true;
  }

  try {
    await createSchemaViaPg(schema);
    return true;
  } catch (err) {
    console.warn('Could not create company schema', schema, err?.message || err);
    return false;
  }
}

module.exports = {
  ensureCompanyPgSchema,
};
