/**
 * Temporary hardcoded auth until real multi-user login exists.
 * PasswordGate validates VITE_APP_PASSWORD; the signed-in user identity
 * below is what User Settings (and later per-user data) are keyed by.
 */

export const SESSION_UNLOCKED_KEY = 'comex_app_unlocked';
export const SESSION_USER_KEY = 'comex_current_user';

/** Add more users here when you introduce real login / multiple passwords. */
export const HARDCODED_USERS = [
  {
    id: String(import.meta.env.VITE_APP_USER_ID || 'default').trim() || 'default',
    name: String(import.meta.env.VITE_APP_USER_NAME || 'Default User').trim() || 'Default User',
  },
];

export function getHardcodedUser() {
  return HARDCODED_USERS[0];
}

export function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem(SESSION_USER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && parsed.id) {
      return {
        id: String(parsed.id),
        name: String(parsed.name || parsed.id),
      };
    }
  } catch {
    /* ignore */
  }
  return getHardcodedUser();
}

export function setCurrentUser(user) {
  const next = {
    id: String(user?.id || getHardcodedUser().id),
    name: String(user?.name || user?.id || getHardcodedUser().name),
  };
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
