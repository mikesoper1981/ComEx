/**
 * Session identity. Passwords are verified server-side (/api/users login)
 * and never stored in the client bundle.
 */

export const SESSION_UNLOCKED_KEY = 'comex_app_unlocked';
export const SESSION_USER_KEY = 'comex_current_user';
export const SESSION_TOKEN_KEY = 'comex_auth_token';

function envStr(key, fallback) {
  const v = String(import.meta.env[key] ?? '').trim();
  return v || fallback;
}

/** Directory seed / admin fallback. Passwords are not included. */
export const HARDCODED_USERS = [
  {
    id: envStr('VITE_APP_USER_ID', 'default'),
    name: envStr('VITE_APP_USER_NAME', 'Admin'),
    role: 'admin',
  },
  {
    id: envStr('VITE_APP_USER2_ID', 'consultant'),
    name: envStr('VITE_APP_USER2_NAME', 'Standard User'),
    role: 'user',
  },
  {
    id: envStr('VITE_APP_USER3_ID', 'oscar'),
    name: envStr('VITE_APP_USER3_NAME', 'Oscar'),
    role: 'user',
  },
];

export function getHardcodedUser() {
  const u = HARDCODED_USERS[0] || {};
  return {
    id: String(u.id || 'default'),
    name: String(u.name || 'Admin'),
    role: u.role === 'admin' ? 'admin' : 'user',
  };
}

export function findHardcodedUser(id) {
  return HARDCODED_USERS.find((u) => u.id === String(id || '')) || null;
}

export function isAdminUser(user) {
  if (String(user?.role || '') === 'admin') return true;
  const listed = findHardcodedUser(user?.id);
  return listed?.role === 'admin';
}

function sanitizeUser(user) {
  const listed = findHardcodedUser(user?.id);
  return {
    id: String(user?.id || listed?.id || 'default'),
    name: String(user?.name || listed?.name || user?.id || 'User'),
    role: user?.role === 'admin' || listed?.role === 'admin' ? 'admin' : 'user',
  };
}

export function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem(SESSION_USER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && parsed.id) {
      return sanitizeUser(parsed);
    }
  } catch {
    /* ignore */
  }
  return getHardcodedUser();
}

export function setCurrentUser(user) {
  const next = sanitizeUser(user);
  sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(next));
  sessionStorage.setItem(SESSION_UNLOCKED_KEY, '1');
  return next;
}

export function setSessionToken(token) {
  if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, String(token));
  else sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

export function getSessionToken() {
  return sessionStorage.getItem(SESSION_TOKEN_KEY) || '';
}

export function authHeaders(extra = {}) {
  const token = getSessionToken();
  return token
    ? { ...extra, Authorization: `Bearer ${token}` }
    : { ...extra };
}

export function clearCurrentUser() {
  sessionStorage.removeItem(SESSION_USER_KEY);
  sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

export function userSettingsLocalKey(userId) {
  return `comex-user-settings:${userId}`;
}

/** Storage folder is the account display name (e.g. "Standard User"), not the internal id. */
export function userStorageFolder(userOrName) {
  try {
    const raw = userOrName && typeof userOrName === 'object'
      ? (userOrName.name || userOrName.id)
      : userOrName;
    const folder = String(raw || '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    return folder || 'user';
  } catch {
    return 'user';
  }
}

export function userSettingsRemotePath(userOrName) {
  return `users/${userStorageFolder(userOrName)}/settings.json`;
}

/** Chat transcripts — sibling of settings.json, not mixed into user preferences. */
export function userChatsRemotePath(userOrName) {
  return `users/${userStorageFolder(userOrName)}/chats.json`;
}

/** Slim hub list (titles/dates only) — sibling of chats.json. */
export function userChatsIndexRemotePath(userOrName) {
  return `users/${userStorageFolder(userOrName)}/chats-index.json`;
}

export function chatsIndexLocalKey(userId) {
  return `comex-chats-index:${userId}`;
}

/** Named path first, then older users/<id>/settings.json for migration. */
export function userSettingsRemotePathCandidates(user) {
  const named = userSettingsRemotePath(user);
  const id = String(user?.id || '').trim();
  const byId = id ? `users/${id}/settings.json` : '';
  return byId && byId !== named ? [named, byId] : [named];
}

/** Shared Admin / product intelligence (agents, workflows, prompts). Not per-user. */
export function productIntelligenceLocalKey() {
  return 'comex-product-intelligence';
}

export function productIntelligenceRemotePath() {
  return 'product.json';
}

export function userPptxTemplateRemotePath(userOrName) {
  return `users/${userStorageFolder(userOrName)}/pptx-template.pptx`;
}

/** Per-user IC proposal uploads (Assess Proposal). */
export function userProposalRemotePath(userOrName, fileName) {
  const safe = String(fileName || 'proposal')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'proposal';
  return `users/${userStorageFolder(userOrName)}/proposals/${Date.now()}_${safe}`;
}

/** Folder for this user's Stella file uploads (CSV/PDF/etc.). */
export function userStellaStoragePrefix(userOrName) {
  return `users/${userStorageFolder(userOrName)}/stella/`;
}

/** Per-user module context originals (strategy decks, territory Excel, etc.). */
export function userModuleContextRemotePath(userOrName, moduleId, fileName) {
  const mod = String(moduleId || 'context').replace(/[^\w-]+/g, '') || 'context';
  const safe = String(fileName || 'file')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'file';
  return `users/${userStorageFolder(userOrName)}/context/${mod}/${Date.now()}_${safe}`;
}
