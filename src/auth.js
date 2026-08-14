/**
 * Temporary hardcoded auth until real multi-user login exists.
 * PasswordGate validates per-user passwords; identity is what User Settings,
 * chat history, and later per-user data are keyed by.
 */

export const SESSION_UNLOCKED_KEY = 'comex_app_unlocked';
export const SESSION_USER_KEY = 'comex_current_user';

function envStr(key, fallback) {
  const v = String(import.meta.env[key] ?? '').trim();
  return v || fallback;
}

/** Add more users here when you introduce real login. First user is admin. */
export const HARDCODED_USERS = [
  {
    id: envStr('VITE_APP_USER_ID', 'default'),
    name: envStr('VITE_APP_USER_NAME', 'Admin'),
    role: 'admin',
    password: envStr('VITE_APP_PASSWORD', ''),
  },
  {
    id: envStr('VITE_APP_USER2_ID', 'consultant'),
    name: envStr('VITE_APP_USER2_NAME', 'Consultant'),
    role: 'user',
    password: envStr('VITE_APP_USER2_PASSWORD', envStr('VITE_APP_PASSWORD', '')),
  },
];

export function getHardcodedUser() {
  return sanitizeUser(HARDCODED_USERS[0]);
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
    id: String(user?.id || listed?.id || getHardcodedUser().id),
    name: String(user?.name || listed?.name || user?.id || 'User'),
    role: listed?.role || (user?.role === 'admin' ? 'admin' : 'user'),
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

export function clearCurrentUser() {
  sessionStorage.removeItem(SESSION_USER_KEY);
  sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
}

export function userSettingsLocalKey(userId) {
  return `comex-user-settings:${userId}`;
}

export function userSettingsRemotePath(userId) {
  return `users/${userId}/settings.json`;
}

export function userPptxTemplateRemotePath(userId) {
  return `users/${userId}/pptx-template.pptx`;
}

/** Per-user IC proposal uploads (Assess Proposal). */
export function userProposalRemotePath(userId, fileName) {
  const safe = String(fileName || 'proposal')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'proposal';
  return `users/${userId}/proposals/${Date.now()}_${safe}`;
}

/** Per-user module context originals (strategy decks, territory Excel, etc.). */
export function userModuleContextRemotePath(userId, moduleId, fileName) {
  const mod = String(moduleId || 'context').replace(/[^\w-]+/g, '') || 'context';
  const safe = String(fileName || 'file')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'file';
  return `users/${userId}/context/${mod}/${Date.now()}_${safe}`;
}
