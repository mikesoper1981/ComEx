/**
 * Read/write intelligence/users/<display name>/{settings|chats}.json using the
 * service-role key so Storage RLS cannot drop Standard User saves.
 *
 * GET  /api/user-settings?userId=&userName=&file=settings.json|chats.json|chats-index.json
 * POST /api/user-settings { userId, userName, file, document }
 *
 *   SUPABASE_URL         (falls back to VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_KEY
 */

const { loadAccounts, findAccount, storageFolder, isMissingStorageObject } = require('./accounts-store');

function allowedUserFile(raw) {
  const name = String(raw || 'settings.json').trim().toLowerCase();
  if (name === 'chats.json') return 'chats.json';
  if (name === 'chats-index.json') return 'chats-index.json';
  return 'settings.json';
}

function chatHasUserContent(messages) {
  return (Array.isArray(messages) ? messages : []).some(
    (m) => m && m.role === 'user' && String(m.content || '').trim(),
  );
}

function deriveChatTitle(messages) {
  const userMsg = (Array.isArray(messages) ? messages : []).find(
    (m) => m && m.role === 'user' && String(m.content || '').trim(),
  );
  if (!userMsg) return 'Chat';
  const t = String(userMsg.content).replace(/\s+/g, ' ').trim();
  return t.length > 52 ? `${t.slice(0, 50)}…` : t;
}

/** Hub list payload — no message bodies, workflow extracts, or uploads. */
function chatsIndexFromDocument(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const chats = Array.isArray(doc.chats) ? doc.chats : [];
  return {
    userId: doc.userId || null,
    updatedAt: doc.updatedAt || new Date().toISOString(),
    activeChatId: doc.activeChatId || null,
    userName: doc.userName || undefined,
    chats: chats.filter((c) => c && c.id).slice(0, 25).map((c) => ({
      id: c.id,
      title: c.title || deriveChatTitle(c.messages),
      createdAt: c.createdAt || null,
      updatedAt: c.updatedAt || null,
      module: c.module || null,
      hasWorkflow: !!(c.currentWorkflow),
      hasUserContent: c.hasUserContent === true || chatHasUserContent(c.messages),
    })).filter((c) => c.hasUserContent !== false),
  };
}

async function downloadStorageJson(supabaseUrl, serviceKey, writePath) {
  const url = `${supabaseUrl}/storage/v1/object/intelligence/${encodeObjectPath(writePath)}`;
  const upstream = await fetch(url, { headers: storageHeaders(serviceKey) });
  const text = await upstream.text();
  const parsed = parseJsonSafe(text);
  return { upstream, text, parsed };
}

async function uploadStorageJson(supabaseUrl, serviceKey, writePath, document) {
  const body = JSON.stringify(document);
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
  return upstream;
}

function objectPath(user, file) {
  return `users/${storageFolder(user)}/${allowedUserFile(file)}`;
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
  let file = 'settings.json';

  if (req.method === 'GET') {
    userId = String(req.query?.userId || '');
    userName = String(req.query?.userName || '');
    file = allowedUserFile(req.query?.file);
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
    file = allowedUserFile(body?.file);
    document = body?.document;
    if (!document || typeof document !== 'object') {
      return res.status(400).json({ error: { message: 'document is required' } });
    }
  } else {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  try {
    const accounts = await loadAccounts();
    const user = findAccount(accounts, userId, userName);
    if (!user) {
      return res.status(400).json({ error: { message: 'Unknown user' } });
    }
    const folderUser = { id: user.id, name: String(userName || user.name) };
    const writePath = objectPath(folderUser, file);
    if (req.method === 'GET') {
      const { upstream, text, parsed } = await downloadStorageJson(supabaseUrl, serviceKey, writePath);
      if (parsed && typeof parsed === 'object' && upstream.ok) {
        return res.status(200).json({ path: writePath, document: parsed });
      }
      if (file === 'chats-index.json' && isMissingStorageObject(upstream.status, parsed, text)) {
        const chatsPath = objectPath(folderUser, 'chats.json');
        const chats = await downloadStorageJson(supabaseUrl, serviceKey, chatsPath);
        if (chats.parsed && typeof chats.parsed === 'object' && chats.upstream.ok) {
          const index = chatsIndexFromDocument(chats.parsed);
          if (index) {
            uploadStorageJson(supabaseUrl, serviceKey, writePath, index).catch(() => {});
            return res.status(200).json({ path: writePath, document: index, derived: true });
          }
        }
      }
      if (isMissingStorageObject(upstream.status, parsed, text)) {
        return res.status(404).json({ error: { message: `${file} not found` }, path: writePath });
      }
      if (!upstream.ok) {
        const message = parsed?.message || parsed?.error || text || 'Download failed';
        return res.status(upstream.status).json({ error: { message } });
      }
      return res.status(404).json({ error: { message: `${file} not found` }, path: writePath });
    }

    const upstream = await uploadStorageJson(supabaseUrl, serviceKey, writePath, document);
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
