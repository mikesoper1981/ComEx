/**
 * Read/write intelligence/users/<display name>/settings.json using the
 * service-role key so Storage RLS cannot drop Standard User saves.
 *
 * GET  /api/user-settings?userId=&userName=
 * POST /api/user-settings { userId, userName, document }
 *
 *   SUPABASE_URL         (falls back to VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_KEY
 */

function envStr(key, fallback) {
  const v = String(process.env[key] || '').trim();
  return v || fallback;
}

function listedUsers() {
  return [
    { id: envStr('VITE_APP_USER_ID', 'default'), name: envStr('VITE_APP_USER_NAME', 'Admin') },
    { id: envStr('VITE_APP_USER2_ID', 'consultant'), name: envStr('VITE_APP_USER2_NAME', 'Standard User') },
  ];
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

function resolveUser(userId, userName) {
  const listed = listedUsers();
  return listed.find((u) => u.id === String(userId || ''))
    || listed.find((u) => u.name === String(userName || ''))
    || null;
}

function objectPaths(user) {
  const named = `users/${storageFolder(user)}/settings.json`;
  const byId = `users/${String(user.id || '').trim()}/settings.json`;
  return byId && byId !== named ? [named, byId] : [named];
}

function encodeObjectPath(path) {
  return String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function storageHeaders(serviceKey, extra = {}) {
  return {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    ...extra,
  };
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    return res.status(500).json({ error: { message: 'SUPABASE_URL is not configured' } });
  }
  if (!serviceKey) {
    return res.status(500).json({ error: { message: 'SUPABASE_SERVICE_KEY is not configured' } });
  }

  let userId = '';
  let userName = '';
  let document = null;

  if (req.method === 'GET') {
    userId = String(req.query?.userId || '');
    userName = String(req.query?.userName || '');
  } else if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body || '{}');
      } catch {
        return res.status(400).json({ error: { message: 'Invalid JSON body' } });
      }
    }
    userId = String(body?.userId || '');
    userName = String(body?.userName || '');
    document = body?.document;
    if (!document || typeof document !== 'object') {
      return res.status(400).json({ error: { message: 'document is required' } });
    }
  } else {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const user = resolveUser(userId, userName);
  if (!user) {
    return res.status(400).json({ error: { message: 'Unknown user' } });
  }
  const folderUser = { id: user.id, name: String(userName || user.name) };

  const paths = objectPaths(folderUser);
  const writePath = paths[0];

  try {
    if (req.method === 'GET') {
      for (const path of paths) {
        const url = `${supabaseUrl}/storage/v1/object/intelligence/${encodeObjectPath(path)}`;
        const upstream = await fetch(url, { headers: storageHeaders(serviceKey) });
        if (upstream.status === 404) continue;
        const text = await upstream.text();
        if (!upstream.ok) {
          const parsed = parseJsonSafe(text);
          const message = parsed?.message || parsed?.error || text || 'Download failed';
          return res.status(upstream.status).json({ error: { message } });
        }
        const parsed = parseJsonSafe(text);
        if (parsed && typeof parsed === 'object') return res.status(200).json(parsed);
      }
      return res.status(404).json({ error: { message: 'settings.json not found' } });
    }

    const body = JSON.stringify(document, null, 2);
    const url = `${supabaseUrl}/storage/v1/object/intelligence/${encodeObjectPath(writePath)}`;
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
      const message = parsed?.message || parsed?.error || text || 'Upload failed';
      return res.status(upstream.status).json({ error: { message: String(message).slice(0, 500) } });
    }
    return res.status(200).json({ ok: true, path: writePath });
  } catch (err) {
    return res.status(502).json({
      error: { message: err instanceof Error ? err.message : 'Storage request failed' },
    });
  }
};
