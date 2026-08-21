/**
 * Transactional email via Hotmail/Outlook SMTP, or Resend if SMTP is not set.
 *
 * SMTP (Hotmail): SMTP_USER, SMTP_PASS, EMAIL_FROM (defaults to SMTP_USER)
 * Resend:        RESEND_API_KEY, EMAIL_FROM
 */

function envStr(key, fallback = '') {
  const v = String(process.env[key] || '').trim();
  return v || fallback;
}

function appLoginUrl(fallback) {
  return envStr('APP_URL') || envStr('VITE_APP_URL') || String(fallback || '').replace(/\/$/, '') || '';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapEmail({ title, preheader, bodyHtml }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0b1220;border:1px solid rgba(96,165,250,0.28);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(90deg,#2563eb,#0891b2);padding:20px 28px;">
              <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.02em;">ComEx</div>
              <div style="color:#dbeafe;font-size:13px;margin-top:4px;">Commercial Excellence Hub</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;color:#64748b;font-size:11px;line-height:1.5;">
              This email was sent by ComEx. If you were not expecting it, you can ignore it.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function credentialRow(label, value) {
  return `<tr>
    <td style="padding:8px 0;color:#93c5fd;font-size:12px;font-weight:700;width:120px;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:8px 0;color:#ffffff;font-size:14px;font-family:Consolas,Monaco,monospace;">${escapeHtml(value)}</td>
  </tr>`;
}

function welcomeEmail({ name, username, password, loginUrl }) {
  const url = loginUrl || appLoginUrl();
  const bodyHtml = `
    <p style="margin:0 0 12px;color:#ffffff;font-size:18px;font-weight:700;">Welcome to ComEx</p>
    <p style="margin:0 0 20px;color:#cbd5e1;font-size:14px;line-height:1.55;">
      Hi ${escapeHtml(name || username)}, your account is ready. Sign in with the details below.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid rgba(96,165,250,0.22);border-radius:12px;padding:4px 16px;margin-bottom:22px;">
      ${credentialRow('Username', username)}
      ${credentialRow('Password', password)}
    </table>
    <a href="${escapeHtml(url)}" style="display:inline-block;background:linear-gradient(90deg,#3b82f6,#06b6d4);color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px;">
      Open ComEx
    </a>
    <p style="margin:16px 0 0;color:#64748b;font-size:12px;word-break:break-all;">${escapeHtml(url)}</p>
  `;
  return {
    subject: 'Your ComEx account',
    html: wrapEmail({
      title: 'Your ComEx account',
      preheader: 'Your login details for the Commercial Excellence Hub.',
      bodyHtml,
    }),
  };
}

function resetEmail({ name, username, password, loginUrl }) {
  const url = loginUrl || appLoginUrl();
  const bodyHtml = `
    <p style="margin:0 0 12px;color:#ffffff;font-size:18px;font-weight:700;">Password reset</p>
    <p style="margin:0 0 20px;color:#cbd5e1;font-size:14px;line-height:1.55;">
      Hi ${escapeHtml(name || username)}, here is a one-time password for ComEx. It expires in 24 hours and you will be asked to choose a new password when you sign in.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid rgba(96,165,250,0.22);border-radius:12px;padding:4px 16px;margin-bottom:22px;">
      ${credentialRow('Username', username)}
      ${credentialRow('One-time password', password)}
    </table>
    <a href="${escapeHtml(url)}" style="display:inline-block;background:linear-gradient(90deg,#3b82f6,#06b6d4);color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px;">
      Sign in to ComEx
    </a>
    <p style="margin:16px 0 0;color:#64748b;font-size:12px;word-break:break-all;">${escapeHtml(url)}</p>
  `;
  return {
    subject: 'Your ComEx one-time password',
    html: wrapEmail({
      title: 'Your ComEx one-time password',
      preheader: 'Use this one-time password, then set a new one when you sign in.',
      bodyHtml,
    }),
  };
}

function fromAddress() {
  return envStr('EMAIL_FROM') || envStr('SMTP_USER');
}

function smtpHost() {
  return envStr('SMTP_HOST', 'smtp-mail.outlook.com').toLowerCase();
}

function isOutlookMailbox() {
  const host = smtpHost();
  const user = envStr('SMTP_USER').toLowerCase();
  return /outlook\.com|hotmail\.com|live\.com|office365\.com|microsoft\.com/.test(host)
    || /@(outlook|hotmail|live|msn)\./.test(user);
}

function graphTenant() {
  return envStr('MS_TENANT', 'consumers');
}

async function graphAccessToken() {
  const clientId = envStr('MS_CLIENT_ID');
  const refreshToken = envStr('MS_REFRESH_TOKEN');
  if (!clientId || !refreshToken) return '';
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/Mail.Send offline_access',
  });
  const secret = envStr('MS_CLIENT_SECRET');
  if (secret) body.set('client_secret', secret);
  const upstream = await fetch(`https://login.microsoftonline.com/${graphTenant()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await upstream.text();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { /* ignore */ }
  if (!upstream.ok || !parsed.access_token) {
    throw new Error(parsed.error_description || parsed.error || 'Could not refresh Microsoft Graph token');
  }
  return parsed.access_token;
}

async function sendViaGraph({ to, subject, html }) {
  const token = await graphAccessToken();
  const upstream = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!upstream.ok) {
    const text = await upstream.text();
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed?.error?.message || parsed?.error_description || text;
    } catch { /* keep text */ }
    throw new Error(String(message).slice(0, 400));
  }
}

async function sendViaSmtp({ to, from, subject, html }) {
  if (isOutlookMailbox()) {
    throw new Error('Hotmail/Outlook has disabled password SMTP (error 535 5.7.139). Set MS_CLIENT_ID and MS_REFRESH_TOKEN, or use Gmail SMTP / Resend.');
  }
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    throw new Error('nodemailer is not installed');
  }
  const user = envStr('SMTP_USER');
  const pass = envStr('SMTP_PASS');
  const host = smtpHost();
  const port = Number(envStr('SMTP_PORT', '587')) || 587;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
  });
  await transporter.sendMail({ from, to, subject, html });
}

async function sendViaResend({ to, from, subject, html }) {
  const apiKey = envStr('RESEND_API_KEY');
  const upstream = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed?.message || parsed?.error || text;
    } catch { /* keep text */ }
    throw new Error(String(message).slice(0, 400));
  }
}

async function sendEmail({ to, subject, html }) {
  if (!to) throw new Error('No email address');
  const from = fromAddress();
  if (envStr('RESEND_API_KEY')) {
    if (!from) throw new Error('EMAIL_FROM is not configured');
    await sendViaResend({ to, from, subject, html });
    return;
  }
  throw new Error('Email is not configured. Set RESEND_API_KEY and EMAIL_FROM in Vercel.');
}

module.exports = {
  appLoginUrl,
  welcomeEmail,
  resetEmail,
  sendEmail,
};
