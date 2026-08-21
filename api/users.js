/**
 * User directory, login, and admin user management.
 *
 * GET  /api/users?action=list
 * POST /api/users { action: 'login', login, password }
 * POST /api/users { action: 'create', name, email, password, role, loginUrl }
 * POST /api/users { action: 'set-password', userId, password }
 * POST /api/users { action: 'delete', userId }
 * POST /api/users { action: 'reset-password', login, loginUrl }
 * POST /api/users { action: 'change-password', password }  (change-password Bearer)
 */

const {
  loadAccounts,
  saveAccounts,
  findAccount,
  hashPassword,
  verifyPassword,
  publicUser,
  issueToken,
  verifyToken,
  slugId,
  usageForUser,
  deleteUserFolder,
  normalizeEmail,
  isEmail,
  generateTempPassword,
} = require('./accounts-store');
const { appLoginUrl, welcomeEmail, resetEmail, sendEmail } = require('./mail');

const OTP_TTL_MS = 24 * 60 * 60 * 1000;

function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? body : {};
}

function bearerUser(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  return verifyToken(header);
}

function requireAdmin(req, res) {
  const user = bearerUser(req);
  if (!user || user.role !== 'admin' || user.purpose === 'change-password') {
    res.status(401).json({ error: { message: 'Admin sign-in required' } });
    return null;
  }
  return user;
}

function resolveLoginUrl(req, body) {
  const fromBody = String(body?.loginUrl || '').trim().replace(/\/$/, '');
  if (fromBody) return fromBody;
  const origin = String(req.headers?.origin || req.headers?.referer || '').replace(/\/$/, '');
  if (origin && /^https?:\/\//i.test(origin)) {
    try {
      return new URL(origin).origin;
    } catch {
      /* ignore */
    }
  }
  return appLoginUrl();
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const action = String(req.query?.action || 'list');
      if (action === 'directory' || action === 'list') {
        if (!requireAdmin(req, res)) return;
        const accounts = await loadAccounts();
        const users = [];
        for (const u of accounts.users || []) {
          const usage = await usageForUser(u);
          users.push({
            ...publicUser(u),
            ...usage,
          });
        }
        return res.status(200).json({ users });
      }
      return res.status(400).json({ error: { message: 'Unknown action' } });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: { message: 'Method not allowed' } });
    }

    const body = readBody(req);
    if (!body) {
      return res.status(400).json({ error: { message: 'Invalid JSON body' } });
    }
    const action = String(body.action || '');
    const loginUrl = resolveLoginUrl(req, body);

    if (action === 'login') {
      const accounts = await loadAccounts();
      const login = String(body.login || body.userId || body.userName || body.email || '');
      const user = findAccount(accounts, login, login, login);
      const password = String(body.password || '');
      if (!user || !user.passwordHash || !password || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: { message: 'Incorrect username/email or password.' } });
      }
      if (user.otpExpiresAt && Date.parse(user.otpExpiresAt) < Date.now() && user.mustChangePassword) {
        return res.status(401).json({ error: { message: 'That one-time password has expired. Request a new reset.' } });
      }
      if (user.mustChangePassword) {
        const { token, expiresAt } = issueToken(user, { purpose: 'change-password', ttlMs: 30 * 60 * 1000 });
        return res.status(200).json({
          mustChangePassword: true,
          changeToken: token,
          expiresAt,
          user: publicUser(user),
        });
      }
      user.lastLoginAt = new Date().toISOString();
      await saveAccounts(accounts);
      const { token, expiresAt } = issueToken(user);
      return res.status(200).json({
        user: publicUser(user),
        token,
        expiresAt,
      });
    }

    if (action === 'reset-password') {
      const login = String(body.login || body.email || body.userName || '').trim();
      const accounts = await loadAccounts();
      const user = findAccount(accounts, login, login, login);
      if (user && user.email) {
        const temp = generateTempPassword();
        const mail = resetEmail({
          name: user.name,
          username: user.name,
          password: temp,
          loginUrl,
        });
        try {
          await sendEmail({ to: user.email, ...mail });
        } catch (err) {
          return res.status(502).json({ error: { message: err?.message || 'Could not send reset email' } });
        }
        user.passwordHash = hashPassword(temp);
        user.mustChangePassword = true;
        user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
        await saveAccounts(accounts);
      }
      return res.status(200).json({
        ok: true,
        message: 'If that account has an email on file, a one-time password has been sent.',
      });
    }

    if (action === 'change-password') {
      const session = bearerUser(req);
      if (!session || session.purpose !== 'change-password') {
        return res.status(401).json({ error: { message: 'Password change session required' } });
      }
      const password = String(body.password || '');
      if (password.length < 8) {
        return res.status(400).json({ error: { message: 'Password must be at least 8 characters' } });
      }
      const accounts = await loadAccounts();
      const user = findAccount(accounts, session.id, session.name);
      if (!user) {
        return res.status(404).json({ error: { message: 'User not found' } });
      }
      user.passwordHash = hashPassword(password);
      user.mustChangePassword = false;
      user.otpExpiresAt = null;
      user.lastLoginAt = new Date().toISOString();
      await saveAccounts(accounts);
      const { token, expiresAt } = issueToken(user);
      return res.status(200).json({
        user: publicUser(user),
        token,
        expiresAt,
      });
    }

    const admin = requireAdmin(req, res);
    if (!admin) return;

    if (action === 'create') {
      const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      const role = body.role === 'admin' ? 'admin' : 'user';
      if (name.length < 2) {
        return res.status(400).json({ error: { message: 'Name must be at least 2 characters' } });
      }
      if (!isEmail(email)) {
        return res.status(400).json({ error: { message: 'A valid email is required' } });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: { message: 'Password must be at least 8 characters' } });
      }
      const accounts = await loadAccounts();
      let id = slugId(name);
      const ids = new Set((accounts.users || []).map((u) => u.id));
      const names = new Set((accounts.users || []).map((u) => String(u.name || '').toLowerCase()));
      const emails = new Set((accounts.users || []).map((u) => normalizeEmail(u.email)).filter(Boolean));
      if (names.has(name.toLowerCase())) {
        return res.status(400).json({ error: { message: 'A user with that name already exists' } });
      }
      if (emails.has(email)) {
        return res.status(400).json({ error: { message: 'A user with that email already exists' } });
      }
      let n = 2;
      while (ids.has(id)) {
        id = `${slugId(name)}-${n}`;
        n += 1;
      }
      const created = {
        id,
        name,
        email,
        role,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
        mustChangePassword: false,
        otpExpiresAt: null,
      };
      accounts.users.push(created);
      await saveAccounts(accounts);
      let emailSent = false;
      let emailError = '';
      try {
        const mail = welcomeEmail({
          name,
          username: name,
          password,
          loginUrl,
        });
        await sendEmail({ to: email, ...mail });
        emailSent = true;
      } catch (err) {
        emailError = err?.message || 'Could not send welcome email';
      }
      return res.status(200).json({
        user: publicUser(created),
        emailSent,
        emailError,
      });
    }

    if (action === 'set-password') {
      const password = String(body.password || '');
      const emailRaw = body.email != null ? String(body.email).trim() : '';
      if (password && password.length < 8) {
        return res.status(400).json({ error: { message: 'Password must be at least 8 characters' } });
      }
      if (!password && !emailRaw) {
        return res.status(400).json({ error: { message: 'Provide an email or a new password' } });
      }
      const accounts = await loadAccounts();
      const user = findAccount(accounts, body.userId, body.userName);
      if (!user) {
        return res.status(404).json({ error: { message: 'User not found' } });
      }
      if (emailRaw) {
        const email = normalizeEmail(emailRaw);
        if (!isEmail(email)) {
          return res.status(400).json({ error: { message: 'A valid email is required' } });
        }
        const taken = (accounts.users || []).some((u) => u.id !== user.id && normalizeEmail(u.email) === email);
        if (taken) {
          return res.status(400).json({ error: { message: 'A user with that email already exists' } });
        }
        user.email = email;
      }
      if (password) {
        user.passwordHash = hashPassword(password);
        user.mustChangePassword = false;
        user.otpExpiresAt = null;
      }
      await saveAccounts(accounts);
      return res.status(200).json({ ok: true, user: publicUser(user) });
    }

    if (action === 'send-reset') {
      const accounts = await loadAccounts();
      const user = findAccount(accounts, body.userId, body.userName);
      if (!user) {
        return res.status(404).json({ error: { message: 'User not found' } });
      }
      if (!user.email) {
        return res.status(400).json({ error: { message: 'This user has no email on file' } });
      }
      const temp = generateTempPassword();
      const mail = resetEmail({
        name: user.name,
        username: user.name,
        password: temp,
        loginUrl,
      });
      await sendEmail({ to: user.email, ...mail });
      user.passwordHash = hashPassword(temp);
      user.mustChangePassword = true;
      user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
      await saveAccounts(accounts);
      return res.status(200).json({ ok: true, user: publicUser(user) });
    }

    if (action === 'delete') {
      const accounts = await loadAccounts();
      const user = findAccount(accounts, body.userId, body.userName);
      if (!user) {
        return res.status(404).json({ error: { message: 'User not found' } });
      }
      if (user.id === admin.id) {
        return res.status(400).json({ error: { message: 'You cannot remove your own account' } });
      }
      const admins = (accounts.users || []).filter((u) => u.role === 'admin');
      if (user.role === 'admin' && admins.length <= 1) {
        return res.status(400).json({ error: { message: 'Cannot remove the last admin' } });
      }
      accounts.users = (accounts.users || []).filter((u) => u.id !== user.id);
      await saveAccounts(accounts);
      try {
        await deleteUserFolder(user);
      } catch {
        /* folder cleanup is best-effort */
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: { message: 'Unknown action' } });
  } catch (err) {
    return res.status(502).json({
      error: { message: err instanceof Error ? err.message : 'User request failed' },
    });
  }
};
