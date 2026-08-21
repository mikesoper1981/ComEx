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

async function listObjects(prefix) {
  const { supabaseUrl, serviceKey } = supabaseConfig();
  const url = `${supabaseUrl}/storage/v1/object/list/intelligence`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: storageHeaders(serviceKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix, limit: 1000 }),
  });
  const text = await upstream.text();
  if (!upstream.ok) return [];
  const parsed = parseJsonSafe(text);
  return Array.isArray(parsed) ? parsed : [];
}

async function removeObjects(paths) {
  if (!paths.length) return;
  const { supabaseUrl, serviceKey } = supabaseConfig();
  const url = `${supabaseUrl}/storage/v1/object/remove/intelligence`;
  await fetch(url, {
    method: 'POST',
    headers: storageHeaders(serviceKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: paths }),
  });
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
  const folder = storageFolder(user);
  const prefix = `users/${folder}`;
  const items = await listObjects(`${prefix}/`);
  const paths = items.map((item) => {
    const name = String(item.name || '');
    if (!name) return '';
    return name.startsWith('users/') ? name : `${prefix}/${name}`;
  }).filter(Boolean);
  const known = [`${prefix}/settings.json`, `${prefix}/chats.json`, `${prefix}/pptx-template.pptx`];
  const unique = [...new Set([...known, ...paths])];
  await removeObjects(unique);
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
  isMissingStorageObject,
};
