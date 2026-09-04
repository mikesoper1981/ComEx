/**
 * Stella Insights file registry.
 * Always c_<slug>.stella_files in the company schema. New rows are never
 * written to public.stella_files (that table is only a template / leftover
 * source that is copied into the company schema on first use).
 *
 * GET  /api/stella-files
 * POST { action: 'insert', record }
 * POST { action: 'update', id, patch }
 * POST { action: 'delete', id }
 */

const { sessionUserFromRequest } = require('./accounts-store');
const { companySlug, companyPgSchema, resolveUserCompany, ensureCompanyPgSchema } = require('./company');
const { getLastEnsureError, withPg, quoteIdent } = require('./stella-db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_FIELDS = [
  'file_name', 'file_type', 'storage_path', 'table_name',
  'columns', 'row_count', 'summary', 'context_qa', 'uploaded_at',
];

function supabaseConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  return { supabaseUrl, serviceKey };
}

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

function orgIdForUser(user) {
  const id = String(user?.id || '').trim();
  const slug = companySlug(resolveUserCompany(user));
  return id ? `company:${slug}:user:${id}` : `company:${slug}`;
}

function orgCandidates(user) {
  const id = String(user?.id || '').trim();
  return [...new Set([
    orgIdForUser(user),
    id ? `user:${id}` : '',
  ].filter(Boolean))];
}

function uploaderFields(user) {
  const id = String(user?.id || '').trim();
  const name = String(user?.name || '').trim() || id;
  return {
    uploaded_by: id || null,
    uploaded_by_name: name || null,
  };
}

function pickRecord(raw, { includeOrg } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(src, key) && src[key] !== undefined) out[key] = src[key];
  }
  if (includeOrg) {
    out.org_id = includeOrg.org_id;
    out.company_slug = includeOrg.company_slug;
  }
  return out;
}

const JSON_FIELDS = new Set(['columns', 'context_qa']);

function toPgRecord(record) {
  const out = {};
  for (const [key, val] of Object.entries(record || {})) {
    if (val === undefined) continue;
    out[key] = JSON_FIELDS.has(key) && val !== null && typeof val === 'object'
      ? JSON.stringify(val)
      : val;
  }
  return out;
}

function parseJsonFields(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const key of JSON_FIELDS) {
    let cur = out[key];
    for (let i = 0; i < 2; i += 1) {
      if (typeof cur !== 'string') break;
      const t = cur.trim();
      if (!t || (t[0] !== '{' && t[0] !== '[' && t[0] !== '"')) break;
      try { cur = JSON.parse(t); } catch { break; }
    }
    out[key] = cur;
  }
  return out;
}

async function listByOrgPg(schema, orgIds) {
  const q = quoteIdent(schema);
  const orgs = Array.isArray(orgIds) ? orgIds.filter(Boolean) : [orgIds].filter(Boolean);
  if (!orgs.length) return [];
  const result = await withPg((client) => client.query(
    `select * from ${q}.stella_files where org_id = any($1::text[]) order by uploaded_at asc`,
    [orgs],
  ));
  return (result.rows || []).map(parseJsonFields);
}

async function insertPg(schema, record) {
  const row = toPgRecord(record);
  const q = quoteIdent(schema);
  const keys = Object.keys(row);
  const cols = keys.map((k) => `"${k.replace(/"/g, '')}"`).join(', ');
  const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
  const result = await withPg((client) => client.query(
    `insert into ${q}.stella_files (${cols}) values (${vals}) returning *`,
    keys.map((k) => row[k]),
  ));
  return result.rows[0] ? parseJsonFields(result.rows[0]) : null;
}

async function updatePg(schema, id, orgId, patch) {
  const row = toPgRecord(patch);
  const q = quoteIdent(schema);
  const keys = Object.keys(row);
  if (!keys.length) return 0;
  const sets = keys.map((k, i) => `"${k.replace(/"/g, '')}" = $${i + 1}`).join(', ');
  const result = await withPg((client) => client.query(
    `update ${q}.stella_files set ${sets} where id = $${keys.length + 1} and org_id = $${keys.length + 2}`,
    [...keys.map((k) => row[k]), id, orgId],
  ));
  return result.rowCount || 0;
}

async function deletePg(schema, id, orgId) {
  const q = quoteIdent(schema);
  const result = await withPg((client) => client.query(
    `delete from ${q}.stella_files where id = $1 and org_id = $2`,
    [id, orgId],
  ));
  return result.rowCount || 0;
}

function schemaUnavailable(schema) {
  const detail = getLastEnsureError();
  return {
    error: detail
      ? `Company schema ${schema} is not available (${detail})`
      : `Company schema ${schema} is not available`,
    status: 503,
  };
}

async function listFilesForUser(user) {
  const schema = companyPgSchema(resolveUserCompany(user));
  const schemaReady = await ensureCompanyPgSchema(schema);
  if (!schemaReady) {
    return { files: [], schema, schemaReady: false };
  }
  try {
    const rows = await listByOrgPg(schema, orgCandidates(user));
    return { files: rows, schema, schemaReady: true };
  } catch (err) {
    console.warn('Company registry list failed', err?.message || err);
    return {
      error: err instanceof Error ? err.message : 'Could not load files',
      status: 502,
      files: [],
      schema,
      schemaReady: true,
    };
  }
}

async function insertFileForUser(user, recordInput) {
  const slug = companySlug(resolveUserCompany(user));
  const userOrg = orgIdForUser(user);
  const schema = companyPgSchema(resolveUserCompany(user));
  const schemaReady = await ensureCompanyPgSchema(schema);
  const record = {
    ...pickRecord(recordInput, { includeOrg: { org_id: userOrg, company_slug: slug } }),
    ...uploaderFields(user),
  };
  if (!record.file_name) {
    return { error: 'file_name is required', status: 400 };
  }
  if (!record.storage_path) {
    return { error: 'storage_path is required', status: 400 };
  }
  if (!schemaReady) return schemaUnavailable(schema);
  try {
    const row = await insertPg(schema, record);
    if (row) return { file: row, schema, company: slug };
  } catch (err) {
    console.warn('Company registry insert failed, retrying without optional columns', err?.message || err);
    try {
      const {
        company_slug: _slug,
        uploaded_by: _by,
        uploaded_by_name: _byName,
        ...withoutOptional
      } = record;
      const row = await insertPg(schema, withoutOptional);
      if (row) return { file: row, schema, company: slug };
      return { error: err?.message || 'Registry insert returned no row', status: 502 };
    } catch (err2) {
      return { error: err2?.message || err?.message || 'Registry insert failed', status: 502 };
    }
  }
  return { error: 'Registry insert returned no row', status: 502 };
}

async function updateFileForUser(user, id, patchInput) {
  const schema = companyPgSchema(resolveUserCompany(user));
  const schemaReady = await ensureCompanyPgSchema(schema);
  if (!UUID_RE.test(String(id || '').trim())) {
    return { error: 'Invalid file id', status: 400 };
  }
  const patch = pickRecord(patchInput);
  if (!Object.keys(patch).length) {
    return { error: 'Nothing to update', status: 400 };
  }
  if (!schemaReady) return schemaUnavailable(schema);
  let lastErr = null;
  for (const org of orgCandidates(user)) {
    try {
      const n = await updatePg(schema, id, org, patch);
      if (n) return { ok: true };
    } catch (err) {
      lastErr = err;
      console.warn('Company registry update failed', err?.message || err);
    }
  }
  return {
    error: lastErr?.message || 'Registry update did not match a company-schema row',
    status: lastErr ? 502 : 404,
  };
}

async function deleteFileForUser(user, id) {
  const schema = companyPgSchema(resolveUserCompany(user));
  const schemaReady = await ensureCompanyPgSchema(schema);
  if (!schemaReady) return schemaUnavailable(schema);
  for (const org of orgCandidates(user)) {
    try {
      const n = await deletePg(schema, id, org);
      if (n) return { ok: true };
    } catch (err) {
      console.warn('Company registry delete failed', err?.message || err);
      return { error: err?.message || 'Registry delete failed', status: 502 };
    }
  }
  return { ok: true };
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const { supabaseUrl, serviceKey } = supabaseConfig();
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: { message: !serviceKey ? 'SUPABASE_SERVICE_KEY is not configured. Add it to .env.local from Vercel (Production), then restart the dev server.' : 'SUPABASE_URL is not configured' } });
  }

  const user = await sessionUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: { message: 'Sign in required' } });
  }

  const slug = companySlug(resolveUserCompany(user));
  const schema = companyPgSchema(resolveUserCompany(user));

  const parsed = req.method === 'GET' ? { body: {} } : parseBody(req);
  if (parsed.error) {
    return res.status(400).json({ error: { message: parsed.error } });
  }
  const body = parsed.body;
  const action = String(req.method === 'GET' ? 'list' : (body.action || 'list')).trim().toLowerCase();

  try {
    if (req.method === 'GET' || action === 'list') {
      const listed = await listFilesForUser(user);
      if (listed.error) {
        return res.status(listed.status || 502).json({ error: { message: listed.error } });
      }
      return res.status(200).json({
        files: listed.files || [],
        schema: listed.schema || schema,
        company: slug,
        schemaReady: !!listed.schemaReady,
        schemaError: listed.schemaReady ? '' : (getLastEnsureError() || ''),
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: { message: 'Method not allowed' } });
    }

    if (action === 'insert') {
      const inserted = await insertFileForUser(user, body.record);
      if (inserted.error) {
        return res.status(inserted.status || 502).json({ error: { message: inserted.error } });
      }
      return res.status(200).json({
        file: inserted.file,
        schema,
        company: slug,
        schemaReady: true,
      });
    }

    if (action === 'update') {
      const updated = await updateFileForUser(user, body.id, body.patch);
      if (updated.error) {
        return res.status(updated.status || 502).json({ error: { message: updated.error } });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const id = String(body.id || '').trim();
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: { message: 'Invalid file id' } });
      }
      const deleted = await deleteFileForUser(user, id);
      if (deleted.error) {
        return res.status(deleted.status || 502).json({ error: { message: deleted.error } });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: { message: 'Unknown action' } });
  } catch (err) {
    return res.status(502).json({
      error: { message: err instanceof Error ? err.message : 'Upstream request failed' },
    });
  }
}

handler.listFilesForUser = listFilesForUser;
handler.insertFileForUser = insertFileForUser;
handler.updateFileForUser = updateFileForUser;
handler.deleteFileForUser = deleteFileForUser;
module.exports = handler;
