/**
 * Stella Insights — tenant-scoped SQL and table RPCs.
 *
 * POST { sql }                    run a single SELECT in the caller's company schema
 * POST { action: 'create', tableName, columns }
 * POST { action: 'insert', tableName, rows }
 * POST { action: 'drop', tableName }
 * POST { action: 'replace', tableName, columns, rows }  drop + create + insert (no stacked rows)
 * POST { action: 'move', tableName }   move leftover public.stella_data_* into the company schema
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
const { companyPgSchema, resolveUserCompany, ensureCompanyPgSchema, isCompanyPgSchema } = require('./company');
const { withPg, quoteIdent, DATA_TABLE_RE } = require('./stella-db');

const TABLE_NAME_RE = DATA_TABLE_RE;
const SELECT_RESULT_CAP = 500;

function capSelectSql(sql) {
  const cleaned = String(sql || '').trim().replace(/;+\s*$/, '');
  return `SELECT * FROM (${cleaned}) AS _stella_cap LIMIT ${SELECT_RESULT_CAP}`;
}

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

function rpcError(result) {
  const data = result?.data || {};
  return data.message || data.error || data.hint || 'Query failed';
}

function requireCompanySchema(schema) {
  if (!isCompanyPgSchema(schema)) {
    throw new Error('Stella data must use a company schema');
  }
  return quoteIdent(schema);
}

function quoteTable(tableName) {
  if (!TABLE_NAME_RE.test(tableName)) throw new Error('Invalid table name');
  return `"${tableName}"`;
}

function quoteCol(name) {
  const n = String(name || '').replace(/"/g, '');
  if (!n || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)) throw new Error('Invalid column name');
  return `"${n}"`;
}

async function pgCreateTable(schema, tableName, columns) {
  const q = requireCompanySchema(schema);
  const defs = (columns || []).map((c) => {
    const type = String(c?.type || '').toLowerCase() === 'numeric' ? 'numeric' : 'text';
    return `${quoteCol(c.name)} ${type}`;
  }).join(', ');
  if (!defs) throw new Error('columns are required');
  await withPg((client) => client.query(
    `create table if not exists ${q}.${quoteTable(tableName)} (${defs})`,
  ));
}

async function pgInsertRows(schema, tableName, rows) {
  const q = requireCompanySchema(schema);
  const t = quoteTable(tableName);
  await withPg((client) => client.query(
    `insert into ${q}.${t} select * from jsonb_populate_recordset(null::${q}.${t}, $1::jsonb)`,
    [JSON.stringify(rows)],
  ));
}

async function pgDropTable(schema, tableName) {
  const q = requireCompanySchema(schema);
  await withPg((client) => client.query(`drop table if exists ${q}.${quoteTable(tableName)}`));
}

async function pgRunSelect(schema, sql) {
  const q = requireCompanySchema(schema);
  const result = await withPg(async (client) => {
    await client.query(`set search_path to ${q}`);
    return client.query(sql);
  });
  const rows = result.rows || [];
  return rows.length > SELECT_RESULT_CAP ? rows.slice(0, SELECT_RESULT_CAP) : rows;
}

async function pgMoveTable(schema, tableName) {
  const q = requireCompanySchema(schema);
  const t = quoteTable(tableName);
  await withPg(async (client) => {
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
  });
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

async function rpcOnlyWithSchema(supabaseUrl, serviceKey, fn, args) {
  return supabaseRpc(supabaseUrl, serviceKey, fn, args);
}

async function rpcCreateTable(supabaseUrl, serviceKey, schema, tableName, columns) {
  return rpcOnlyWithSchema(supabaseUrl, serviceKey, 'stella_create_table', {
    p_table_name: tableName,
    p_columns: columns,
    p_schema: schema,
  });
}

async function rpcInsertRows(supabaseUrl, serviceKey, schema, tableName, rows) {
  return rpcOnlyWithSchema(supabaseUrl, serviceKey, 'stella_insert_rows', {
    p_table_name: tableName,
    p_rows: rows,
    p_schema: schema,
  });
}

async function rpcDropTable(supabaseUrl, serviceKey, schema, tableName) {
  return rpcOnlyWithSchema(supabaseUrl, serviceKey, 'stella_drop_table', {
    p_table_name: tableName,
    p_schema: schema,
  });
}

async function insertRowsBatched(supabaseUrl, serviceKey, schema, tableName, rows) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk = rows.slice(i, i + INSERT_BATCH);
    try {
      await pgInsertRows(schema, tableName, chunk);
      continue;
    } catch (err) {
      console.warn('PG insert failed, trying company-schema RPC', err?.message || err);
    }
    const result = await rpcInsertRows(supabaseUrl, serviceKey, schema, tableName, chunk);
    if (!result.ok) return result;
  }
  return { ok: true, status: 200, data: { ok: true } };
}

async function companyTableOp(pgFn, rpcFn) {
  try {
    await pgFn();
    return { ok: true, status: 200, data: { ok: true } };
  } catch (err) {
    console.warn('Company-schema PG failed, trying RPC with schema', err?.message || err);
    return rpcFn();
  }
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
  if (action === 'create' || action === 'insert' || action === 'move' || action === 'drop' || action === 'replace' || action === 'query' || action === '') {
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
    try {
      const rows = await pgRunSelect(schema, capSelectSql(sql));
      return { status: 200, json: { rows, schema, truncated: Array.isArray(rows) && rows.length >= SELECT_RESULT_CAP } };
    } catch (err) {
      console.warn('Company-schema SELECT failed, trying RPC with schema', err?.message || err);
    }
    const result = await rpcOnlyWithSchema(supabaseUrl, serviceKey, 'stella_run_select', {
      query: capSelectSql(sql),
      p_schema: schema,
    });
    if (!result.ok) {
      return { status: result.status, json: { error: { message: rpcError(result) } } };
    }
    const rows = Array.isArray(result.data) ? result.data : (result.data == null ? [] : result.data);
    const capped = Array.isArray(rows) ? rows.slice(0, SELECT_RESULT_CAP) : [];
    return { status: 200, json: { rows: capped, schema, truncated: capped.length >= SELECT_RESULT_CAP } };
  }

  if (!TABLE_NAME_RE.test(tableName)) {
    return { status: 400, json: { error: { message: 'Invalid table name' } } };
  }

  if (action === 'create') {
    const columns = tableColumns(body);
    if (!columns.length) {
      return { status: 400, json: { error: { message: 'columns are required' } } };
    }
    const result = await companyTableOp(
      () => pgCreateTable(schema, tableName, columns),
      () => rpcCreateTable(supabaseUrl, serviceKey, schema, tableName, columns),
    );
    if (!result.ok) {
      return { status: result.status, json: { error: { message: rpcError(result) } } };
    }
    try { await pgMoveTable(schema, tableName); } catch (err) {
      console.warn('Could not move leftover public extract table', tableName, err?.message || err);
    }
    return { status: 200, json: { ok: true, schema } };
  }

  if (action === 'insert') {
    const rows = tableRows(body);
    if (!rows.length) {
      return { status: 400, json: { error: { message: 'rows are required' } } };
    }
    try { await pgMoveTable(schema, tableName); } catch (err) {
      console.warn('Could not move leftover public extract table', tableName, err?.message || err);
    }
    const result = await insertRowsBatched(supabaseUrl, serviceKey, schema, tableName, rows);
    if (!result.ok) {
      return { status: result.status, json: { error: { message: rpcError(result) } } };
    }
    return { status: 200, json: { ok: true, schema } };
  }

  if (action === 'drop') {
    const result = await companyTableOp(
      () => pgDropTable(schema, tableName),
      () => rpcDropTable(supabaseUrl, serviceKey, schema, tableName),
    );
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
    const dropped = await companyTableOp(
      () => pgDropTable(schema, tableName),
      () => rpcDropTable(supabaseUrl, serviceKey, schema, tableName),
    );
    if (!dropped.ok) {
      return { status: dropped.status, json: { error: { message: rpcError(dropped) } } };
    }
    const created = await companyTableOp(
      () => pgCreateTable(schema, tableName, columns),
      () => rpcCreateTable(supabaseUrl, serviceKey, schema, tableName, columns),
    );
    if (!created.ok) {
      return { status: created.status, json: { error: { message: rpcError(created) } } };
    }
    try { await pgMoveTable(schema, tableName); } catch (err) {
      console.warn('Could not move leftover public extract table', tableName, err?.message || err);
    }
    const inserted = await insertRowsBatched(supabaseUrl, serviceKey, schema, tableName, rows);
    if (!inserted.ok) {
      return { status: inserted.status, json: { error: { message: rpcError(inserted) } } };
    }
    return { status: 200, json: { ok: true, schema, replaced: true, rowCount: rows.length } };
  }

  if (action === 'move') {
    try {
      await pgMoveTable(schema, tableName);
      return { status: 200, json: { ok: true, schema } };
    } catch (err) {
      console.warn('Company-schema move failed, trying RPC with schema', err?.message || err);
    }
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
