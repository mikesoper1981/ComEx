/**
 * Stella Insights file registry.
 * Lives in the company schema (c_<slug>.stella_files). public.stella_files is
 * only a fallback for older rows until they are copied across.
 *
 * GET  /api/stella-files
 * POST { action: 'insert', record }
 * POST { action: 'update', id, patch }
 * POST { action: 'delete', id }
 */

const { sessionUserFromRequest } = require('./accounts-store');
const { companySlug, companyPgSchema, resolveUserCompany, companySchemaPresent, ensureCompanyPgSchema } = require('./company');
const { getLastEnsureError, withPg, quoteIdent } = require('./stella-db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_FIELDS = [
  'file_name', 'file_type', 'storage_path', 'table_name',
  'columns', 'row_count', 'summary', 'context_qa',
];

function supabaseConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  return { supabaseUrl, serviceKey };
}

function restHeaders(serviceKey, extra = {}) {
  return {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  };
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

function pickRecord(raw, { includeOrg } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key];
  }
  if (includeOrg) {
    out.org_id = includeOrg.org_id;
    out.company_slug = includeOrg.company_slug;
  }
  return out;
}

async function restJson(method, path, { body } = {}) {
  const { supabaseUrl, serviceKey } = supabaseConfig();
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: restHeaders(serviceKey),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  return { ok: res.ok, status: res.status, data };
}

async function listByOrg(orgId) {
  const path = `stella_files?org_id=eq.${encodeURIComponent(orgId)}&select=*&order=uploaded_at.asc`;
  const result = await restJson('GET', path);
  if (!result.ok) {
    return { error: result.data?.message || result.data?.hint || 'Could not load files', status: result.status };
  }
  return { rows: Array.isArray(result.data) ? result.data : [] };
}

async function patchByFilter(filter, patch) {
  return restJson('PATCH', `stella_files?${filter}`, { body: patch });
}

async function listByOrgPg(schema, orgId) {
  const q = quoteIdent(schema);
  const result = await withPg((client) => client.query(
    `select * from ${q}.stella_files where org_id = $1 order by uploaded_at asc`,
    [orgId],
  ));
  return result.rows || [];
}

async function insertPg(schema, record) {
  const q = quoteIdent(schema);
  const keys = Object.keys(record);
  const cols = keys.map((k) => `"${k.replace(/"/g, '')}"`).join(', ');
  const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
  const result = await withPg((client) => client.query(
    `insert into ${q}.stella_files (${cols}) values (${vals}) returning *`,
    keys.map((k) => record[k]),
  ));
  return result.rows[0] || null;
}

async function updatePg(schema, id, orgId, patch) {
  const q = quoteIdent(schema);
  const keys = Object.keys(patch);
  if (!keys.length) return true;
  const sets = keys.map((k, i) => `"${k.replace(/"/g, '')}" = $${i + 1}`).join(', ');
  await withPg((client) => client.query(
    `update ${q}.stella_files set ${sets} where id = $${keys.length + 1} and org_id = $${keys.length + 2}`,
    [...keys.map((k) => patch[k]), id, orgId],
  ));
  return true;
}

async function deletePg(schema, id, orgId) {
  const q = quoteIdent(schema);
  await withPg((client) => client.query(
    `delete from ${q}.stella_files where id = $1 and org_id = $2`,
    [id, orgId],
  ));
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const { supabaseUrl, serviceKey } = supabaseConfig();
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: { message: 'Supabase is not configured' } });
  }

  const user = await sessionUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: { message: 'Sign in required' } });
  }

  const slug = companySlug(resolveUserCompany(user));
  const userOrg = orgIdForUser(user);
  const schema = companyPgSchema(resolveUserCompany(user));

  const parsed = req.method === 'GET' ? { body: {} } : parseBody(req);
  if (parsed.error) {
    return res.status(400).json({ error: { message: parsed.error } });
  }
  const body = parsed.body;
  const action = String(req.method === 'GET' ? 'list' : (body.action || 'list')).trim().toLowerCase();
  const schemaReady = action === 'insert'
    ? await ensureCompanyPgSchema(schema)
    : await companySchemaPresent(schema);

  try {
    if (req.method === 'GET' || action === 'list') {
      if (user.role === 'admin') {
        const own = await listByOrg(userOrg);
        if (own.error) return res.status(own.status || 502).json({ error: { message: own.error } });
        if (!own.rows.length) {
          const legacy = await listByOrg('default');
          if (!legacy.error && legacy.rows.length) {
            await patchByFilter(
              `org_id=eq.${encodeURIComponent('default')}`,
              { org_id: userOrg, company_slug: slug },
            );
          }
        }
      }

      let rows = [];
      let sourceOrg = '';
      for (const org of orgCandidates(user)) {
        let listed = { rows: [] };
        if (schemaReady) {
          try {
            listed = { rows: await listByOrgPg(schema, org) };
          } catch {
            listed = await listByOrg(org);
          }
        } else {
          listed = await listByOrg(org);
        }
        if (listed.error) return res.status(listed.status || 502).json({ error: { message: listed.error } });
        if (listed.rows.length) {
          rows = listed.rows;
          sourceOrg = org;
          break;
        }
      }
      if (sourceOrg && sourceOrg !== userOrg) {
        await patchByFilter(
          `org_id=eq.${encodeURIComponent(sourceOrg)}`,
          { org_id: userOrg, company_slug: slug },
        );
        rows = rows.map((row) => ({ ...row, org_id: userOrg, company_slug: slug }));
      }
      return res.status(200).json({
        files: rows,
        schema,
        company: slug,
        schemaReady: !!schemaReady,
        schemaError: schemaReady ? '' : (getLastEnsureError() || ''),
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: { message: 'Method not allowed' } });
    }

    if (action === 'insert') {
      const record = pickRecord(body.record, { includeOrg: { org_id: userOrg, company_slug: slug } });
      if (!record.file_name) {
        return res.status(400).json({ error: { message: 'file_name is required' } });
      }
      if (schemaReady) {
        try {
          const row = await insertPg(schema, record);
          if (row) return res.status(200).json({ file: row });
        } catch (err) {
          console.warn('Company registry insert failed, trying public', err?.message || err);
        }
      }
      let result = await restJson('POST', 'stella_files', { body: record });
      if (!result.ok && /company_slug/i.test(JSON.stringify(result.data || {}))) {
        const { company_slug: _slug, ...withoutSlug } = record;
        result = await restJson('POST', 'stella_files', { body: withoutSlug });
      }
      if (!result.ok) {
        return res.status(result.status).json({
          error: { message: result.data?.message || result.data?.hint || 'Registry insert failed' },
        });
      }
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      return res.status(200).json({ file: row });
    }

    if (action === 'update') {
      const id = String(body.id || '').trim();
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: { message: 'Invalid file id' } });
      }
      const patch = pickRecord(body.patch);
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: { message: 'Nothing to update' } });
      }
      const filter = `id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(userOrg)}`;
      if (schemaReady) {
        try {
          await updatePg(schema, id, userOrg, patch);
          return res.status(200).json({ ok: true });
        } catch (err) {
          console.warn('Company registry update failed, trying public', err?.message || err);
        }
      }
      const result = await patchByFilter(filter, patch);
      if (!result.ok) {
        return res.status(result.status).json({
          error: { message: result.data?.message || result.data?.hint || 'Registry update failed' },
        });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const id = String(body.id || '').trim();
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: { message: 'Invalid file id' } });
      }
      if (schemaReady) {
        try {
          await deletePg(schema, id, userOrg);
          return res.status(200).json({ ok: true });
        } catch (err) {
          console.warn('Company registry delete failed, trying public', err?.message || err);
        }
      }
      const result = await restJson(
        'DELETE',
        `stella_files?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(userOrg)}`,
      );
      if (!result.ok) {
        return res.status(result.status).json({
          error: { message: result.data?.message || result.data?.hint || 'Registry delete failed' },
        });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: { message: 'Unknown action' } });
  } catch (err) {
    return res.status(502).json({
      error: { message: err instanceof Error ? err.message : 'Upstream request failed' },
    });
  }
};
