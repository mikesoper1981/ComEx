/**
 * Stella Insights — tenant-scoped SQL and table RPCs.
 *
 * POST { sql }                    run a single SELECT in the caller's company schema
 * POST { action: 'create', tableName, columns }
 * POST { action: 'insert', tableName, rows }
 * POST { action: 'drop', tableName }
 * POST { action: 'replace', tableName, columns, rows }  drop + create + insert (no stacked rows)
 * POST { action: 'move', tableName }   move public.stella_data_* into the company schema
 *
 * Schema is always derived from the signed-in user's company. The client cannot
 * choose another tenant's schema.
 *
 * Required environment variables:
 *   - SUPABASE_URL          (falls back to VITE_SUPABASE_URL)
 *   - SUPABASE_SERVICE_KEY  (the service_role key — server-side only)
 *   - AUTH_SECRET           (session tokens)
 */

const { sessionUserFromRequest } = require('./accounts-store');
const { companyPgSchema, resolveUserCompany, ensureCompanyPgSchema } = require('./company');

const TABLE_NAME_RE = /^stella_data_[a-z0-9_]+$/;

function isSelectOnly(sql) {
  if (typeof sql !== 'string') return false;
  const cleaned = sql.trim();
  if (!/^select\s/i.test(cleaned)) return false;
  if (/;\s*\S/.test(cleaned)) return false;
  if (/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy)\b/i.test(cleaned)) return false;
  return true;
}

function hasForeignSchema(sql, schema) {
  if (/\bpublic\s*\./i.test(sql)) return true;
  const hits = String(sql || '').match(/\bc_[a-z0-9_]+\s*\./gi) || [];
  return hits.some((hit) => hit.replace(/\s*\./g, '').toLowerCase() !== String(schema || '').toLowerCase());
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

async function supabaseRpc(supabaseUrl, serviceKey, fn, args) {
  const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(args),
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

async function rpcWithSchema(supabaseUrl, serviceKey, fn, withSchema, withoutSchema) {
  const first = await supabaseRpc(supabaseUrl, serviceKey, fn, withSchema);
  if (first.ok) return first;
  const msg = String(first.data?.message || first.data?.code || '');
  const missing = /PGRST202|could not find|schema cache|does not exist/i.test(msg);
  if (!missing || !withoutSchema) return first;
  return supabaseRpc(supabaseUrl, serviceKey, fn, withoutSchema);
}

function rpcError(result) {
  const data = result?.data || {};
  return data.message || data.error || data.hint || 'Query failed';
}

const INSERT_BATCH = 500;

function tableColumns(body) {
  const columns = Array.isArray(body.columns) ? body.columns : body.p_columns;
  return Array.isArray(columns) ? columns : [];
}

function tableRows(body) {
  const rows = Array.isArray(body.rows) ? body.rows : body.p_rows;
  return Array.isArray(rows) ? rows : [];
}

async function rpcCreateTable(supabaseUrl, serviceKey, schema, tableName, columns) {
  return rpcWithSchema(
    supabaseUrl,
    serviceKey,
    'stella_create_table',
    { p_table_name: tableName, p_columns: columns, p_schema: schema },
    { p_table_name: tableName, p_columns: columns },
  );
}

async function rpcInsertRows(supabaseUrl, serviceKey, schema, tableName, rows) {
  return rpcWithSchema(
    supabaseUrl,
    serviceKey,
    'stella_insert_rows',
    { p_table_name: tableName, p_rows: rows, p_schema: schema },
    { p_table_name: tableName, p_rows: rows },
  );
}

async function rpcDropTable(supabaseUrl, serviceKey, schema, tableName) {
  return rpcWithSchema(
    supabaseUrl,
    serviceKey,
    'stella_drop_table',
    { p_table_name: tableName, p_schema: schema },
    { p_table_name: tableName },
  );
}

async function insertRowsBatched(supabaseUrl, serviceKey, schema, tableName, rows) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk = rows.slice(i, i + INSERT_BATCH);
    const result = await rpcInsertRows(supabaseUrl, serviceKey, schema, tableName, chunk);
    if (!result.ok) return result;
  }
  return { ok: true, status: 200, data: { ok: true } };
}

/** Shared by /api/stella-query and scheduled inbox sync (cron impersonates a user). */
async function executeTableAction(user, body) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl) return { status: 500, json: { error: { message: 'SUPABASE_URL is not configured' } } };
  if (!serviceKey) return { status: 500, json: { error: { message: 'SUPABASE_SERVICE_KEY is not configured' } } };
  if (!user) return { status: 401, json: { error: { message: 'Sign in required' } } };

  const schema = companyPgSchema(resolveUserCompany(user));
  const action = String(body.action || (body.sql ? 'query' : '')).trim().toLowerCase();
  if (action === 'create' || action === 'insert' || action === 'move' || action === 'drop' || action === 'replace') {
    await ensureCompanyPgSchema(schema);
  }
  const tableName = String(body.tableName || body.p_table_name || '').trim();

  if (action === 'query' || action === '') {
    const sql = body.sql;
    if (!isSelectOnly(sql)) {
      return { status: 400, json: { error: { message: 'Only a single SELECT statement is allowed' } } };
    }
    if (hasForeignSchema(sql, schema)) {
      return { status: 400, json: { error: { message: 'Queries cannot reference another company schema' } } };
    }
    const result = await rpcWithSchema(
      supabaseUrl,
      serviceKey,
      'stella_run_select',
      { query: sql, p_schema: schema },
      { query: sql },
    );
    if (!result.ok) {
      return { status: result.status, json: { error: { message: rpcError(result) } } };
    }
    const rows = Array.isArray(result.data) ? result.data : (result.data == null ? [] : result.data);
    return { status: 200, json: { rows, schema } };
  }

  if (!TABLE_NAME_RE.test(tableName)) {
    return { status: 400, json: { error: { message: 'Invalid table name' } } };
  }

  if (action === 'create') {
    const columns = tableColumns(body);
    if (!columns.length) {
      return { status: 400, json: { error: { message: 'columns are required' } } };
    }
    const result = await rpcCreateTable(supabaseUrl, serviceKey, schema, tableName, columns);
    if (!result.ok) {
      return { status: result.status, json: { error: { message: rpcError(result) } } };
    }
    return { status: 200, json: { ok: true, schema } };
  }

  if (action === 'insert') {
    const rows = tableRows(body);
    if (!rows.length) {
      return { status: 400, json: { error: { message: 'rows are required' } } };
    }
    const result = await insertRowsBatched(supabaseUrl, serviceKey, schema, tableName, rows);
    if (!result.ok) {
      return { status: result.status, json: { error: { message: rpcError(result) } } };
    }
    return { status: 200, json: { ok: true, schema } };
  }

  if (action === 'drop') {
    const result = await rpcDropTable(supabaseUrl, serviceKey, schema, tableName);
    if (!result.ok) {
      return { status: result.status, json: { error: { message: rpcError(result) } } };
    }
    return { status: 200, json: { ok: true, schema } };
  }

  if (action === 'replace') {
    const columns = tableColumns(body);
    const rows = tableRows(body);
    if (!columns.length) {
      return { status: 400, json: { error: { message: 'columns are required' } } };
    }
    if (!rows.length) {
      return { status: 400, json: { error: { message: 'rows are required' } } };
    }
    const dropped = await rpcDropTable(supabaseUrl, serviceKey, schema, tableName);
    if (!dropped.ok) {
      return { status: dropped.status, json: { error: { message: rpcError(dropped) } } };
    }
    const created = await rpcCreateTable(supabaseUrl, serviceKey, schema, tableName, columns);
    if (!created.ok) {
      return { status: created.status, json: { error: { message: rpcError(created) } } };
    }
    const inserted = await insertRowsBatched(supabaseUrl, serviceKey, schema, tableName, rows);
    if (!inserted.ok) {
      return { status: inserted.status, json: { error: { message: rpcError(inserted) } } };
    }
    return { status: 200, json: { ok: true, schema, replaced: true, rowCount: rows.length } };
  }

  if (action === 'move') {
    const result = await supabaseRpc(supabaseUrl, serviceKey, 'stella_move_table', {
      p_table_name: tableName,
      p_schema: schema,
    });
    if (!result.ok) {
      const msg = String(result.data?.message || result.data?.code || '');
      if (/PGRST202|could not find|schema cache|does not exist/i.test(msg)) {
        return { status: 200, json: { ok: true, skipped: true, schema } };
      }
      return { status: result.status, json: { error: { message: rpcError(result) } } };
    }
    return { status: 200, json: { ok: true, schema } };
  }

  return { status: 400, json: { error: { message: 'Unknown action' } } };
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
    const result = await executeTableAction(user, parsed.body);
    return res.status(result.status).json(result.json);
  } catch (err) {
    return res.status(502).json({
      error: { message: err instanceof Error ? err.message : 'Upstream request failed' },
    });
  }
}

handler.executeTableAction = executeTableAction;
module.exports = handler;
