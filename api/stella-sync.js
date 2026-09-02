/**
 * Stella scheduled inbox sync.
 *
 * POST  session (authHeaders)  — Run now for the signed-in user
 * GET/POST  Authorization: Bearer CRON_SECRET  — walk enabled schedules
 *
 * Inbox: companies/<slug>/users/<display>/stella/inbox/
 * After import: stella/processed/YYYY-MM-DD/
 *
 * Same file_name → replace rows, keep context_qa. New name → new table + intake pending.
 */

const crypto = require('crypto');
const {
  sessionUserFromRequest,
  loadAccounts,
  downloadObject,
  uploadObject,
  supabaseConfig,
  storageFolder,
  isEmail,
} = require('./accounts-store');
const { userObjectPrefix } = require('./company');
const stellaQuery = require('./stella-query');
const stellaFiles = require('./stella-files');
const { sendEmail, stellaIntakeEmail, stellaIntakeUrl, appLoginUrl } = require('./mail');

const STORAGE_BUCKETS = ['intelligence', 'stella-data'];
const TABULAR_EXT = /\.(csv|xlsx|xls|json)$/i;

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

function bearerToken(req) {
  const h = req?.headers?.authorization || req?.headers?.Authorization || '';
  return String(h).replace(/^Bearer\s+/i, '').trim();
}

function isCronRequest(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  return bearerToken(req) === secret;
}

function encodeObjectPath(path) {
  return String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function defaultInboxSchedule() {
  return {
    id: 'inbox',
    source: 'inbox',
    enabled: false,
    frequency: 'daily',
    lastRunAt: '',
    lastStatus: '',
    lastFile: '',
    lastInboxAt: '',
  };
}

function mergeSchedule(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const freq = String(src.frequency || '').trim().toLowerCase();
  return {
    ...defaultInboxSchedule(),
    id: String(src.id || 'inbox'),
    source: String(src.source || 'inbox'),
    enabled: src.enabled === true,
    frequency: freq === 'hourly' || freq === 'weekly' ? freq : 'daily',
    lastRunAt: String(src.lastRunAt || ''),
    lastStatus: String(src.lastStatus || ''),
    lastFile: String(src.lastFile || ''),
    lastInboxAt: String(src.lastInboxAt || ''),
  };
}

function connectionsFromDoc(doc) {
  const settings = doc && typeof doc === 'object'
    ? (doc.settings && typeof doc.settings === 'object' ? doc.settings : doc)
    : {};
  const raw = settings.stellaConnections && typeof settings.stellaConnections === 'object'
    ? settings.stellaConnections
    : {};
  const list = Array.isArray(raw.schedules) ? raw.schedules.map(mergeSchedule) : [];
  if (!list.some((s) => s.id === 'inbox' || s.source === 'inbox')) {
    list.unshift(defaultInboxSchedule());
  }
  return { ...raw, schedules: list };
}

function inboxSchedule(connections) {
  const list = connections?.schedules || [];
  return list.find((s) => s.id === 'inbox' || s.source === 'inbox') || defaultInboxSchedule();
}

function patchSchedule(connections, nextSchedule) {
  const list = [...(connections.schedules || [])];
  const idx = list.findIndex((s) => s.id === nextSchedule.id || s.source === 'inbox');
  if (idx >= 0) list[idx] = nextSchedule;
  else list.unshift(nextSchedule);
  return { ...connections, schedules: list };
}

function settingsPathCandidates(user) {
  return [...new Set([
    `${userObjectPrefix(user)}/settings.json`,
    `users/${storageFolder(user)}/settings.json`,
  ])];
}

async function loadSettingsDoc(user) {
  for (const path of settingsPathCandidates(user)) {
    try {
      const doc = await downloadObject(path);
      if (doc && typeof doc === 'object') return { path, doc };
    } catch {
      /* try next */
    }
  }
  return { path: settingsPathCandidates(user)[0], doc: null };
}

function writeSettingsDoc(existing, user, connections) {
  const prev = existing && typeof existing === 'object' ? existing : {};
  const prevSettings = prev.settings && typeof prev.settings === 'object'
    ? prev.settings
    : (() => {
        const { userId: _id, updatedAt: _at, settings: _s, userName: _n, ...fields } = prev;
        return Object.keys(fields).length ? fields : {};
      })();
  return {
    ...prev,
    userId: user.id,
    userName: user.name,
    updatedAt: new Date().toISOString(),
    settings: {
      ...prevSettings,
      stellaConnections: connections,
    },
  };
}

function scheduleIsDue(schedule, now, { force } = {}) {
  if (force) return true;
  if (!schedule.enabled) return false;
  const last = Date.parse(schedule.lastRunAt || '') || 0;
  const elapsed = now - last;
  if (schedule.frequency === 'hourly') return elapsed >= 55 * 60 * 1000;
  if (schedule.frequency === 'weekly') return elapsed >= 6.5 * 24 * 60 * 60 * 1000;
  return elapsed >= 20 * 60 * 60 * 1000;
}

function inboxPrefix(user) {
  return `${userObjectPrefix(user)}/stella/inbox`;
}

function processedPrefix(user, dayIso) {
  const day = String(dayIso || new Date().toISOString()).slice(0, 10);
  return `${userObjectPrefix(user)}/stella/processed/${day}`;
}

function fileKind(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'excel';
  if (lower.endsWith('.json')) return 'json';
  return '';
}

function basenameOf(pathOrName) {
  return String(pathOrName || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
}

function namesMatch(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function nanoId(len = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += chars[bytes[i] % chars.length];
  return out;
}

function safeColumnName(name, index, used) {
  let base = String(name == null ? '' : name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base || /^[0-9]/.test(base)) base = `col_${base || index + 1}`;
  base = base.slice(0, 55);
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}_${n++}`;
  used.add(candidate);
  return candidate;
}

function inferColumnType(values) {
  let seen = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    seen += 1;
    const num = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
    if (!Number.isFinite(num)) return 'text';
  }
  return seen > 0 ? 'numeric' : 'text';
}

function coerceValue(v, type) {
  if (v === null || v === undefined || v === '') return null;
  if (type === 'numeric') {
    const num = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(num) ? num : null;
  }
  return typeof v === 'string' ? v : String(v);
}

function buildTabularPayload(records) {
  const clean = (records || []).filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  const originalCols = [];
  const seenCols = new Set();
  for (const r of clean) {
    for (const k of Object.keys(r)) {
      if (!seenCols.has(k)) {
        seenCols.add(k);
        originalCols.push(k);
      }
    }
  }
  const used = new Set();
  const columns = originalCols.map((orig, i) => {
    const values = clean.map((r) => r[orig]);
    return {
      original: orig,
      name: safeColumnName(orig, i, used),
      type: inferColumnType(values),
      description: '',
    };
  });
  const rows = clean.map((r) => {
    const row = {};
    for (const c of columns) row[c.name] = coerceValue(r[c.original], c.type);
    return row;
  });
  return { columns, rows, rowCount: rows.length };
}

function parseTabular(fileName, buffer) {
  const kind = fileKind(fileName);
  if (!kind || !buffer) return null;
  if (kind === 'json') {
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(buffer).toString('utf8'));
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    const records = parsed.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
    return records.length ? buildTabularPayload(records) : null;
  }
  const XLSX = require('xlsx');
  let wb;
  if (kind === 'csv') {
    wb = XLSX.read(Buffer.from(buffer).toString('utf8'), { type: 'string' });
  } else {
    wb = XLSX.read(buffer, { type: 'buffer' });
  }
  const sheetName = wb.SheetNames?.[0];
  const ws = sheetName ? wb.Sheets[sheetName] : null;
  const records = ws ? XLSX.utils.sheet_to_json(ws, { defval: null }) : [];
  if (!Array.isArray(records) || !records.length) return null;
  return buildTabularPayload(records);
}

function columnsChanged(existing, incoming) {
  const a = (existing || []).map((c) => String(c?.name || '').toLowerCase()).filter(Boolean).sort();
  const b = (incoming || []).map((c) => String(c?.name || '').toLowerCase()).filter(Boolean).sort();
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return true;
  }
  const typeByName = new Map(
    (existing || []).map((c) => [String(c?.name || '').toLowerCase(), c?.type === 'numeric' ? 'numeric' : 'text']),
  );
  for (const c of incoming || []) {
    const name = String(c?.name || '').toLowerCase();
    const prev = typeByName.get(name);
    const next = c?.type === 'numeric' ? 'numeric' : 'text';
    if (prev && prev !== next) return true;
  }
  return false;
}

function slimColumns(columns) {
  return (columns || []).map((c) => ({
    name: c.name,
    type: c.type === 'numeric' ? 'numeric' : 'text',
  }));
}

function storageHeaders(serviceKey, extra = {}) {
  return {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    ...extra,
  };
}

async function listBucketPrefix(bucket, prefix) {
  const { supabaseUrl, serviceKey } = supabaseConfig();
  if (!supabaseUrl || !serviceKey) return [];
  const url = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/list/${bucket}`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: storageHeaders(serviceKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      prefix: String(prefix || '').replace(/^\/+|\/+$/g, ''),
      limit: 1000,
      offset: 0,
    }),
  });
  const text = await upstream.text();
  if (!upstream.ok) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [];
}

async function listInboxFiles(user) {
  const prefix = inboxPrefix(user);
  const found = [];
  const seen = new Set();
  for (const bucket of STORAGE_BUCKETS) {
    const items = await listBucketPrefix(bucket, prefix);
    for (const item of items) {
      const name = String(item?.name || '');
      if (!name || name === '.emptyFolderPlaceholder') continue;
      if (item.id == null && !TABULAR_EXT.test(name)) continue;
      if (!TABULAR_EXT.test(name)) continue;
      const full = `${prefix}/${basenameOf(name)}`.replace(/\/+/g, '/');
      if (seen.has(full.toLowerCase())) continue;
      seen.add(full.toLowerCase());
      found.push({
        bucket,
        path: full,
        name: basenameOf(name),
        updatedAt: item.updated_at || item.created_at || '',
        key,
      });
    }
  }
  found.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  return found;
}

async function downloadStorageBytes(bucket, path) {
  const { supabaseUrl, serviceKey } = supabaseConfig();
  const url = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${encodeObjectPath(path)}`;
  const upstream = await fetch(url, { headers: storageHeaders(serviceKey) });
  if (!upstream.ok) return null;
  const buf = Buffer.from(await upstream.arrayBuffer());
  return buf.length ? buf : null;
}

async function uploadStorageBytes(bucket, path, buffer, contentType) {
  const { supabaseUrl, serviceKey } = supabaseConfig();
  const url = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${encodeObjectPath(path)}`;
  const headers = storageHeaders(serviceKey, {
    'Content-Type': contentType || 'application/octet-stream',
    'x-upsert': 'true',
    'cache-control': '0',
  });
  let upstream = await fetch(url, { method: 'POST', headers, body: buffer });
  if (!upstream.ok) {
    upstream = await fetch(url, { method: 'PUT', headers, body: buffer });
  }
  return upstream.ok;
}

async function deleteStorageObject(bucket, path) {
  const { supabaseUrl, serviceKey } = supabaseConfig();
  const headers = storageHeaders(serviceKey, { 'Content-Type': 'application/json' });
  const url = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}`;
  let upstream = await fetch(url, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ prefixes: [path] }),
  });
  if (!upstream.ok) {
    upstream = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/remove/${bucket}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prefixes: [path] }),
    });
  }
  return upstream.ok;
}

async function moveInboxObject(item, destPath) {
  const { supabaseUrl, serviceKey } = supabaseConfig();
  const moveUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/move`;
  const moved = await fetch(moveUrl, {
    method: 'POST',
    headers: storageHeaders(serviceKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      bucketId: item.bucket,
      sourceKey: item.path,
      destinationKey: destPath,
    }),
  });
  if (moved.ok) return destPath;
  const bytes = await downloadStorageBytes(item.bucket, item.path);
  if (!bytes) return null;
  const uploaded = await uploadStorageBytes(item.bucket, destPath, bytes, guessContentType(item.name));
  if (!uploaded) return null;
  await deleteStorageObject(item.bucket, item.path);
  return destPath;
}

function guessContentType(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}

async function tableAction(user, payload) {
  const result = await stellaQuery.executeTableAction(user, payload);
  if (!result || result.status >= 400) {
    const msg = result?.json?.error?.message || 'Table operation failed';
    throw new Error(msg);
  }
  return result.json;
}

function findExistingByName(files, fileName) {
  const want = basenameOf(fileName);
  return (files || []).find((row) => namesMatch(basenameOf(row.file_name), want) && row.table_name) || null;
}

async function importInboxFile(user, item, existingFiles) {
  const bytes = await downloadStorageBytes(item.bucket, item.path);
  if (!bytes) throw new Error(`Could not download ${item.name}`);
  const payload = parseTabular(item.name, bytes);
  if (!payload || !payload.rowCount) {
    throw new Error(`${item.name} is not a tabular CSV, Excel, or JSON array`);
  }
  const dest = `${processedPrefix(user)}/${item.name}`.replace(/\/+/g, '/');
  const existing = findExistingByName(existingFiles, item.name);
  const schemaChanged = existing ? columnsChanged(existing.columns, payload.columns) : false;

  let outcome;
  if (existing && existing.table_name) {
    await tableAction(user, {
      action: 'replace',
      tableName: existing.table_name,
      columns: slimColumns(payload.columns),
      rows: payload.rows,
    });
    const patch = {
      columns: payload.columns,
      row_count: payload.rowCount,
      storage_path: dest,
      uploaded_at: new Date().toISOString(),
      file_type: fileKind(item.name) || existing.file_type,
    };
    if (schemaChanged && existing.context_qa && typeof existing.context_qa === 'object') {
      patch.context_qa = { ...existing.context_qa, schema_changed: true };
    }
    const updated = await stellaFiles.updateFileForUser(user, existing.id, patch);
    if (updated.error) throw new Error(updated.error);
    outcome = {
      action: schemaChanged ? 'replaced_schema' : 'replaced',
      file: item.name,
      fileId: existing.id || '',
      tableName: existing.table_name,
      rowCount: payload.rowCount,
      storagePath: dest,
    };
  } else {
    const tableName = `stella_data_${nanoId()}`;
    await tableAction(user, {
      action: 'create',
      tableName,
      columns: slimColumns(payload.columns),
    });
    await tableAction(user, {
      action: 'insert',
      tableName,
      rows: payload.rows,
    });
    const inserted = await stellaFiles.insertFileForUser(user, {
      file_name: item.name,
      file_type: fileKind(item.name) || 'csv',
      storage_path: dest,
      table_name: tableName,
      columns: payload.columns,
      row_count: payload.rowCount,
      summary: 'Imported from the scheduled inbox.',
      context_qa: null,
    });
    if (inserted.error) throw new Error(inserted.error);
    outcome = {
      action: 'created',
      file: item.name,
      fileId: inserted.file?.id || '',
      tableName,
      rowCount: payload.rowCount,
      storagePath: dest,
    };
  }

  const movedPath = await moveInboxObject(item, dest);
  if (!movedPath) {
    const uploaded = await uploadStorageBytes(item.bucket, dest, bytes, guessContentType(item.name));
    if (uploaded) await deleteStorageObject(item.bucket, item.path);
  }
  return outcome;
}

async function notifyStellaIntake(user, pending) {
  if (!pending.length) return { emailed: false };
  const to = String(user?.email || '').trim();
  if (!isEmail(to)) {
    return { emailed: false, error: 'No email on this account' };
  }
  const base = appLoginUrl();
  if (!base) {
    return { emailed: false, error: 'APP_URL is not configured' };
  }
  const first = pending[0];
  const intakeUrl = stellaIntakeUrl({
    fileId: first.fileId,
    fileName: first.file,
    loginUrl: base,
  });
  try {
    const mail = stellaIntakeEmail({
      name: user.name,
      files: pending,
      intakeUrl,
    });
    await sendEmail({ to, ...mail });
    return { emailed: true };
  } catch (err) {
    console.warn('Stella intake email failed:', err?.message || err);
    return { emailed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function syncUserInbox(user, { force = false } = {}) {
  const loaded = await loadSettingsDoc(user);
  let connections = connectionsFromDoc(loaded.doc);
  let schedule = inboxSchedule(connections);
  const now = Date.now();
  if (!scheduleIsDue(schedule, now, { force })) {
    return {
      skipped: true,
      reason: schedule.enabled ? 'not_due' : 'disabled',
      schedule,
    };
  }

  const listed = await stellaFiles.listFilesForUser(user);
  if (listed.error) {
    throw new Error(listed.error);
  }
  const existingFiles = listed.files || [];
  const inbox = await listInboxFiles(user);
  const lastSeen = Date.parse(schedule.lastInboxAt || '') || 0;
  const pending = force
    ? inbox
    : inbox.filter((item) => (Date.parse(item.updatedAt || '') || 0) > lastSeen);

  const results = [];
  let newestSeen = schedule.lastInboxAt || '';
  let lastFile = schedule.lastFile || '';

  if (!pending.length) {
    schedule = {
      ...schedule,
      lastRunAt: new Date().toISOString(),
      lastStatus: inbox.length ? 'No new inbox files' : 'Inbox empty',
    };
    connections = patchSchedule(connections, schedule);
    await uploadObject(loaded.path, writeSettingsDoc(loaded.doc, user, connections));
    return { skipped: false, imported: [], results, schedule };
  }

  for (const item of pending) {
    try {
      const outcome = await importInboxFile(user, item, existingFiles);
      if (outcome.action === 'created') {
        existingFiles.push({
          file_name: item.name,
          table_name: outcome.tableName,
          columns: [],
        });
      }
      results.push({
        file: item.name,
        fileId: outcome.fileId || '',
        action: outcome.action,
        tableName: outcome.tableName,
        rowCount: outcome.rowCount,
        status: outcome.action === 'replaced_schema'
          ? `Replaced ${item.name} — columns changed, confirm intake in Files.`
          : outcome.action === 'created'
            ? `Imported ${item.name} — intake pending.`
            : '',
      });
      lastFile = item.name;
      if (item.updatedAt && item.updatedAt > newestSeen) newestSeen = item.updatedAt;
    } catch (err) {
      results.push({
        file: item.name,
        action: 'error',
        status: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const errors = results.filter((r) => r.action === 'error');
  const schemaHits = results.filter((r) => r.action === 'replaced_schema');
  const createdHits = results.filter((r) => r.action === 'created');
  const intakeHits = [...createdHits, ...schemaHits];
  const ok = results.filter((r) => r.action === 'replaced' || r.action === 'created' || r.action === 'replaced_schema');
  let lastStatus = '';
  if (errors.length && !ok.length) {
    lastStatus = errors[0].status || 'Sync failed';
  } else {
    const bits = [];
    if (ok.length) bits.push(`${ok.length} imported`);
    if (intakeHits.length) bits.push(`${intakeHits.length} need intake`);
    if (errors.length) bits.push(`${errors.length} failed`);
    lastStatus = bits.join(' · ') || 'Done';
  }

  schedule = {
    ...schedule,
    lastRunAt: new Date().toISOString(),
    lastStatus,
    lastFile,
    lastInboxAt: newestSeen || schedule.lastInboxAt,
  };
  connections = patchSchedule(connections, schedule);
  await uploadObject(loaded.path, writeSettingsDoc(loaded.doc, user, connections));
  const notice = await notifyStellaIntake(user, intakeHits);
  return { skipped: false, results, schedule, emailed: notice.emailed, emailError: notice.error || '' };
}

async function runCron() {
  const accounts = await loadAccounts();
  const users = accounts?.users || [];
  const ran = [];
  for (const user of users) {
    try {
      const loaded = await loadSettingsDoc(user);
      const connections = connectionsFromDoc(loaded.doc);
      const schedule = inboxSchedule(connections);
      if (!schedule.enabled) continue;
      const result = await syncUserInbox(user, { force: false });
      ran.push({ userId: user.id, name: user.name, ...result });
    } catch (err) {
      ran.push({
        userId: user.id,
        name: user.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { ok: true, mode: 'cron', accounts: ran.length, results: ran };
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  try {
    if (isCronRequest(req)) {
      const payload = await runCron();
      return res.status(200).json(payload);
    }

    if (req.method !== 'POST') {
      return res.status(401).json({ error: { message: 'Sign in required' } });
    }

    const user = await sessionUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: { message: 'Sign in required' } });
    }
    const parsed = parseBody(req);
    if (parsed.error) {
      return res.status(400).json({ error: { message: parsed.error } });
    }
    const result = await syncUserInbox(user, { force: true });
    return res.status(200).json({ ok: true, mode: 'run-now', ...result });
  } catch (err) {
    return res.status(502).json({
      error: { message: err instanceof Error ? err.message : 'Sync failed' },
    });
  }
}

module.exports = handler;
