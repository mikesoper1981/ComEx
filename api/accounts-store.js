/**
 * Shared account registry for /api/users and /api/user-settings.
 * Passwords are scrypt hashes in intelligence/accounts.json (service-role only).
 */

const crypto = require('crypto');

const ACCOUNTS_PATH = 'accounts.json';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function envStr(key, fallback = '') {
  const v = String(process.env[key] || '').trim();
  return v || fallback;
}

function supabaseConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  return { supabaseUrl, serviceKey };
}

function storageHeaders(serviceKey, extra = {}) {
  return {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    ...extra,
  };
}

function encodeObjectPath(path) {
  return String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isMissingStorageObject(status, parsed, text) {
  if (Number(status) === 404) return true;
  const code = parsed?.statusCode ?? parsed?.status;
  if (String(code) === '404') return true;
  if (String(parsed?.error || '').toLowerCase() === 'not_found') return true;
  return /object not found/i.test(String(parsed?.message || text || ''));
}

function tokenSecret() {
  return envStr('AUTH_SECRET') || envStr('SUPABASE_SERVICE_KEY');
}

function storageFolder(userOrName) {
  const raw = userOrName && typeof userOrName === 'object'
    ? (userOrName.name || userOrName.id)
    : userOrName;
  const folder = String(raw || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return folder || 'user';
}

function slugId(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || `user-${Date.now().toString(36)}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (!salt.length || !expected.length) return false;
  const actual = crypto.scryptSync(String(password), salt, expected.length, { N, r, p });
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user.id),
    name: String(user.name || user.id),
    email: String(user.email || ''),
    role: user.role === 'admin' ? 'admin' : 'user',
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null,
    mustChangePassword: !!user.mustChangePassword,
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

function seedUsersFromEnv() {
  const now = new Date().toISOString();
  const adminPassword = envStr('VITE_APP_PASSWORD');
  const user2Password = envStr('VITE_APP_USER2_PASSWORD', adminPassword);
  const rows = [
    {
      id: envStr('VITE_APP_USER_ID', 'default'),
      name: envStr('VITE_APP_USER_NAME', 'Admin'),
      role: 'admin',
      email: envStr('VITE_APP_USER_EMAIL'),
      password: adminPassword,
    },
    {
      id: envStr('VITE_APP_USER2_ID', 'consultant'),
      name: envStr('VITE_APP_USER2_NAME', 'Standard User'),
      role: 'user',
      email: envStr('VITE_APP_USER2_EMAIL'),
      password: user2Password,
    },
    {
      id: envStr('VITE_APP_USER3_ID', 'oscar'),
      name: envStr('VITE_APP_USER3_NAME', 'Oscar'),
      role: 'user',
      email: envStr('VITE_APP_USER3_EMAIL'),
      password: user2Password,
    },
  ];
  return rows
    .filter((u) => u.id && u.name && u.password)
    .map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      email: normalizeEmail(u.email),
      passwordHash: hashPassword(u.password),
      createdAt: now,
      lastLoginAt: null,
      mustChangePassword: false,
      otpExpiresAt: null,
      loginHistory: [],
    }));
}

async function downloadObject(path) {
  const { supabaseUrl, serviceKey } = supabaseConfig();
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase is not configured');
  }
  const url = `${supabaseUrl}/storage/v1/object/intelligence/${encodeObjectPath(path)}`;
  const upstream = await fetch(url, { headers: storageHeaders(serviceKey) });
  const text = await upstream.text();
  const parsed = parseJsonSafe(text);
  if (isMissingStorageObject(upstream.status, parsed, text)) return null;
  if (!upstream.ok) {
    throw new Error(parsed?.message || parsed?.error || text || 'Download failed');
  }
  return parsed;
}

async function uploadObject(path, doc) {
  const { supabaseUrl, serviceKey } = supabaseConfig();
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase is not configured');
  }
  const body = JSON.stringify(doc, null, 2);
  const url = `${supabaseUrl}/storage/v1/object/intelligence/${encodeObjectPath(path)}`;
  const headers = storageHeaders(serviceKey, {
    'Content-Type': 'application/json',
    'x-upsert': 'true',
    'cache-control': '0',
  });
  let upstream = await fetch(url, { method: 'POST', headers, body });
  if (!upstream.ok) {
    upstream = await fetch(url, { method: 'PUT', headers, body });
  }
  if (!upstream.ok) {
    const text = await upstream.text();
    const parsed = parseJsonSafe(text);
    throw new Error(parsed?.message || parsed?.error || text || 'Upload failed');
  }
}

function joinStoragePath(prefix, name) {
  const n = String(name || '').replace(/^\/+/, '');
  if (!n) return '';
  if (n.startsWith('users/')) return n.replace(/\/+/g, '/');
  const base = String(prefix || '').replace(/\/+$/, '');
  return `${base}/${n}`.replace(/\/+/g, '/');
}

async function listObjects(prefix) {
  const { supabaseUrl, serviceKey } = supabaseConfig();
  if (!supabaseUrl || !serviceKey) return [];
  const url = `${supabaseUrl}/storage/v1/object/list/intelligence`;
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
  const parsed = parseJsonSafe(text);
  return Array.isArray(parsed) ? parsed : [];
}

async function listObjectsRecursive(prefix) {
  const root = String(prefix || '').replace(/\/+$/, '');
  const files = [];
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const folder = queue.shift();
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    const items = await listObjects(folder);
    for (const item of items) {
      const name = String(item?.name || '');
      if (!name || name === '.emptyFolderPlaceholder') continue;
      const full = joinStoragePath(folder, name);
      if (!full || seen.has(full)) continue;
      const isFolder = item.id == null;
      if (isFolder) {
        queue.push(full);
      } else {
        files.push(full);
        seen.add(full);
      }
    }
  }
  return files;
}

function extraPathsFromSettings(doc) {
  const settings = doc && typeof doc === 'object'
    ? (doc.settings && typeof doc.settings === 'object' ? doc.settings : doc)
    : {};
  const out = [];
  const pptx = settings.pptxTemplate?.storagePath;
  if (pptx) out.push(String(pptx));
  const buckets = settings.moduleContext && typeof settings.moduleContext === 'object'
    ? Object.values(settings.moduleContext)
    : [];
  for (const bucket of buckets) {
    for (const file of bucket?.files || []) {
      if (file?.storagePath) {
        out.push(String(file.storagePath));
        out.push(`${file.storagePath}.extracted.txt`);
      }
    }
  }
  return out;
}

async function removeObjects(paths) {
  const unique = [...new Set((paths || []).map((p) => String(p || '').replace(/^\/+/, '')).filter(Boolean))];
  if (!unique.length) return;
  const { supabaseUrl, serviceKey } = supabaseConfig();
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase is not configured');
  }
  const headers = storageHeaders(serviceKey, { 'Content-Type': 'application/json' });
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    let upstream = await fetch(`${supabaseUrl}/storage/v1/object/intelligence`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ prefixes: chunk }),
    });
    if (!upstream.ok) {
      upstream = await fetch(`${supabaseUrl}/storage/v1/object/remove/intelligence`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prefixes: chunk }),
      });
    }
    if (!upstream.ok) {
      const text = await upstream.text();
      const parsed = parseJsonSafe(text);
      throw new Error(parsed?.message || parsed?.error || text || 'Could not delete user files');
    }
  }
}

async function loadAccounts() {
  const doc = await downloadObject(ACCOUNTS_PATH);
  if (doc && Array.isArray(doc.users) && doc.users.length) {
    return {
      updatedAt: doc.updatedAt || new Date().toISOString(),
      users: doc.users.map((u) => ({
        id: String(u.id || ''),
        name: String(u.name || u.id || 'User'),
        role: u.role === 'admin' ? 'admin' : 'user',
        email: normalizeEmail(u.email),
        passwordHash: String(u.passwordHash || ''),
        createdAt: u.createdAt || null,
        lastLoginAt: u.lastLoginAt || null,
        mustChangePassword: !!u.mustChangePassword,
        otpExpiresAt: u.otpExpiresAt || null,
        loginHistory: Array.isArray(u.loginHistory) ? u.loginHistory : [],
      })).filter((u) => u.id),
    };
  }
  const seeded = {
    updatedAt: new Date().toISOString(),
    users: seedUsersFromEnv(),
  };
  if (seeded.users.length) {
    await uploadObject(ACCOUNTS_PATH, seeded);
  }
  return seeded;
}

async function saveAccounts(doc) {
  const next = {
    updatedAt: new Date().toISOString(),
    users: (doc.users || []).map((u) => ({
      id: String(u.id),
      name: String(u.name || u.id),
      role: u.role === 'admin' ? 'admin' : 'user',
      email: normalizeEmail(u.email),
      passwordHash: String(u.passwordHash || ''),
      createdAt: u.createdAt || new Date().toISOString(),
      lastLoginAt: u.lastLoginAt || null,
      mustChangePassword: !!u.mustChangePassword,
      otpExpiresAt: u.otpExpiresAt || null,
      loginHistory: Array.isArray(u.loginHistory) ? u.loginHistory : [],
    })),
  };
  await uploadObject(ACCOUNTS_PATH, next);
  return next;
}

function findAccount(accounts, userId, userName, email) {
  const users = accounts?.users || [];
  const login = String(userId || userName || email || '').trim();
  if (!login) return null;
  const loginLower = login.toLowerCase();
  const emailLower = normalizeEmail(email || (isEmail(login) ? login : ''));
  return users.find((u) => u.id === login)
    || users.find((u) => String(u.name || '').toLowerCase() === loginLower)
    || users.find((u) => String(u.id || '').toLowerCase() === loginLower)
    || (emailLower ? users.find((u) => normalizeEmail(u.email) === emailLower) : null)
    || null;
}

function issueToken(user, extra = {}) {
  const secret = tokenSecret();
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  const payload = {
    sub: String(user.id),
    name: String(user.name),
    role: user.role === 'admin' ? 'admin' : 'user',
    purpose: extra.purpose || 'session',
    exp: Date.now() + (extra.ttlMs || TOKEN_TTL_MS),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return { token: `${body}.${sig}`, expiresAt: payload.exp };
}

function verifyToken(raw) {
  const secret = tokenSecret();
  if (!secret) return null;
  const text = String(raw || '').replace(/^Bearer\s+/i, '').trim();
  const [body, sig] = text.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.sub || Number(payload.exp) < Date.now()) return null;
    return {
      id: String(payload.sub),
      name: String(payload.name || payload.sub),
      role: payload.role === 'admin' ? 'admin' : 'user',
      purpose: payload.purpose || 'session',
    };
  } catch {
    return null;
  }
}

function createdAtFromChatId(id) {
  const m = String(id || '').match(/^chat_([0-9a-z]+)_/i);
  if (!m) return 0;
  const n = parseInt(m[1], 36);
  return Number.isFinite(n) && n > 1e11 ? n : 0;
}

function dayKeyLondon(ms) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function messageTime(m, chat, index) {
  const stamped = Date.parse(m?.at || '');
  if (Number.isFinite(stamped)) return stamped;
  const created = Date.parse(chat?.createdAt || '') || createdAtFromChatId(chat?.id);
  const msgs = Array.isArray(chat?.messages) ? chat.messages : [];
  if (index === msgs.length - 1) {
    const updated = Date.parse(chat?.updatedAt || '');
    if (Number.isFinite(updated)) return updated;
  }
  return created || 0;
}

function usageForCalendarDay(doc, dayKey) {
  const chats = Array.isArray(doc?.chats) ? doc.chats : [];
  let questions = 0;
  let conversations = 0;
  for (const chat of chats) {
    const msgs = Array.isArray(chat.messages) ? chat.messages : [];
    let questionsThisChat = 0;
    msgs.forEach((m, i) => {
      if (m?.role !== 'user') return;
      const t = messageTime(m, chat, i);
      if (t && dayKeyLondon(t) === dayKey) questionsThisChat += 1;
    });
    if (questionsThisChat > 0) {
      conversations += 1;
      questions += questionsThisChat;
    }
  }
  return { chats: questions, conversations };
}

function normalizeLoginHistory(raw, lastLoginAt) {
  const list = (Array.isArray(raw) ? raw : [])
    .map((e) => {
      const at = typeof e === 'string' ? e : e?.at;
      const t = Date.parse(at || '');
      return Number.isFinite(t) ? { at: new Date(t).toISOString() } : null;
    })
    .filter(Boolean);
  if (!list.length && lastLoginAt && Date.parse(lastLoginAt)) {
    list.push({ at: new Date(lastLoginAt).toISOString() });
  }
  return list.slice(-40);
}

function recordLogin(user) {
  const at = new Date().toISOString();
  user.lastLoginAt = at;
  const hist = normalizeLoginHistory(user.loginHistory, null);
  hist.push({ at });
  user.loginHistory = hist.slice(-40);
}

function buildLoginHistory(user, chatsDoc) {
  const hist = normalizeLoginHistory(user.loginHistory, user.lastLoginAt);
  const byDay = new Map();
  for (const entry of hist) {
    const t = Date.parse(entry.at);
    if (!Number.isFinite(t)) continue;
    const key = dayKeyLondon(t);
    const prev = byDay.get(key);
    if (!prev || t > prev.t) byDay.set(key, { at: entry.at, t, dayKey: key });
  }
  return [...byDay.values()]
    .sort((a, b) => b.t - a.t)
    .slice(0, 10)
    .map((row) => {
      const usage = usageForCalendarDay(chatsDoc, row.dayKey);
      return {
        at: row.at,
        dayKey: row.dayKey,
        chats: usage.chats,
        conversations: usage.conversations,
      };
    });
}

async function loginHistoryForUser(user) {
  let doc = null;
  try {
    doc = await downloadObject(`users/${storageFolder(user)}/chats.json`);
  } catch {
    doc = null;
  }
  return buildLoginHistory(user, doc);
}

function usageFromChatsDocument(doc) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const chats = Array.isArray(doc?.chats) ? doc.chats : [];
  let messagesLast7Days = 0;
  let conversationsLast7Days = 0;
  for (const chat of chats) {
    const created = Date.parse(chat.createdAt || '') || createdAtFromChatId(chat.id);
    const msgs = Array.isArray(chat.messages) ? chat.messages : [];
    let questionsThisChat = 0;
    msgs.forEach((m, i) => {
      if (m?.role !== 'user') return;
      const stamped = Date.parse(m.at || '');
      const t = Number.isFinite(stamped)
        ? stamped
        : (i === msgs.length - 1 ? Date.parse(chat.updatedAt || '') : created);
      if (Number.isFinite(t) && t >= since) questionsThisChat += 1;
    });
    if (questionsThisChat > 0) {
      conversationsLast7Days += 1;
      messagesLast7Days += questionsThisChat;
    }
  }
  return { messagesLast7Days, conversationsLast7Days };
}

async function usageForUser(user) {
  const folder = storageFolder(user);
  try {
    const doc = await downloadObject(`users/${folder}/chats.json`);
    return usageFromChatsDocument(doc);
  } catch {
    return { messagesLast7Days: 0, conversationsLast7Days: 0 };
  }
}

async function deleteUserFolder(user) {
  const named = storageFolder(user);
  const prefixes = [`users/${named}`];
  const id = String(user?.id || '').trim();
  if (id && id !== named) prefixes.push(`users/${id}`);

  const paths = [];
  for (const prefix of prefixes) {
    const settingsDoc = await downloadObject(`${prefix}/settings.json`).catch(() => null);
    paths.push(...extraPathsFromSettings(settingsDoc));
    paths.push(
      `${prefix}/settings.json`,
      `${prefix}/chats.json`,
      `${prefix}/pptx-template.pptx`,
    );
    paths.push(...await listObjectsRecursive(prefix));
  }
  await removeObjects(paths);
}

function restHeaders(serviceKey) {
  return {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function removeFromBucket(bucket, paths) {
  const unique = [...new Set((paths || []).map((p) => String(p || '').replace(/^\/+/, '')).filter(Boolean))];
  if (!unique.length) return;
  const { supabaseUrl, serviceKey } = supabaseConfig();
  if (!supabaseUrl || !serviceKey) return;
  const headers = storageHeaders(serviceKey, { 'Content-Type': 'application/json' });
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    let upstream = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ prefixes: chunk }),
    });
    if (!upstream.ok) {
      await fetch(`${supabaseUrl}/storage/v1/object/remove/${bucket}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prefixes: chunk }),
      }).catch(() => null);
    }
  }
}

async function deleteUserStellaData(user) {
  const { supabaseUrl, serviceKey } = supabaseConfig();
  const userId = String(user?.id || '').trim();
  if (!supabaseUrl || !serviceKey || !userId) return;
  const orgId = `user:${userId}`;
  const headers = restHeaders(serviceKey);
  const listUrl = `${supabaseUrl}/rest/v1/stella_files?org_id=eq.${encodeURIComponent(orgId)}&select=id,table_name,storage_path`;
  const listRes = await fetch(listUrl, { headers }).catch(() => null);
  const files = listRes && listRes.ok ? await listRes.json().catch(() => []) : [];
  const storagePaths = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (file?.table_name) {
      await fetch(`${supabaseUrl}/rest/v1/rpc/stella_drop_table`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_table_name: file.table_name }),
      }).catch(() => null);
    }
    if (file?.storage_path) {
      storagePaths.push(String(file.storage_path));
      storagePaths.push(`${file.storage_path}.extracted.txt`);
    }
  }
  await fetch(`${supabaseUrl}/rest/v1/stella_files?org_id=eq.${encodeURIComponent(orgId)}`, {
    method: 'DELETE',
    headers,
  }).catch(() => null);
  const folder = `users/${storageFolder(user)}/stella`;
  storagePaths.push(folder);
  await removeFromBucket('intelligence', storagePaths);
  await removeFromBucket('stella-data', storagePaths);
}

module.exports = {
  envStr,
  supabaseConfig,
  storageFolder,
  slugId,
  hashPassword,
  verifyPassword,
  publicUser,
  normalizeEmail,
  isEmail,
  generateTempPassword,
  loadAccounts,
  saveAccounts,
  findAccount,
  issueToken,
  verifyToken,
  usageForUser,
  deleteUserFolder,
  deleteUserStellaData,
  isMissingStorageObject,
  recordLogin,
  loginHistoryForUser,
};
