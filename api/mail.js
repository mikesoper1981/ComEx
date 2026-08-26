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
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f172a;color:#e2e8f0;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0f172a;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="background-color:#0f172a;background-image:linear-gradient(135deg,#0f172a,#1e3a8a,#0f172a);">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <tr>
            <td bgcolor="#2563eb" width="50%" style="background-color:#2563eb;padding:18px 22px;">
              <div style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.03em;">ComEx</div>
            </td>
            <td bgcolor="#06b6d4" width="50%" style="background-color:#06b6d4;padding:18px 22px;text-align:right;">
              <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:12px;font-weight:700;">Commercial Excellence Hub</div>
            </td>
          </tr>
          <tr>
            <td colspan="2" bgcolor="#1e293b" style="background-color:#1e293b;border:1px solid #60a5fa;border-top:0;padding:28px 26px 12px;font-family:Arial,Helvetica,sans-serif;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td colspan="2" bgcolor="#1e293b" style="background-color:#1e293b;border:1px solid #60a5fa;border-top:0;padding:0 26px 22px;font-family:Arial,Helvetica,sans-serif;color:#7dd3fc;font-size:11px;line-height:1.5;">
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

function credentialBox(rowsHtml) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="background-color:#0f172a;border:1px solid #38bdf8;margin:0 0 22px;">
    <tr>
      <td width="8" bgcolor="#22d3ee" style="background-color:#22d3ee;width:8px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:10px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
      </td>
    </tr>
  </table>`;
}

function credentialRow(label, value) {
  return `<tr>
    <td style="padding:8px 0;color:#22d3ee;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;width:140px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(label)}</td>
    <td style="padding:8px 0;color:#ffffff;font-size:16px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(value)}</td>
  </tr>`;
}

function ctaButton(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0">
    <tr>
      <td bgcolor="#2563eb" style="background-color:#2563eb;">
        <a href="${escapeHtml(url)}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;font-family:Arial,Helvetica,sans-serif;padding:13px 22px;">${escapeHtml(label)}</a>
      </td>
      <td bgcolor="#06b6d4" style="background-color:#06b6d4;">
        <a href="${escapeHtml(url)}" style="display:inline-block;background-color:#06b6d4;color:#0f172a;text-decoration:none;font-weight:700;font-size:14px;font-family:Arial,Helvetica,sans-serif;padding:13px 16px;">→</a>
      </td>
    </tr>
  </table>
  <p style="margin:14px 0 0;color:#7dd3fc;font-size:12px;word-break:break-all;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(url)}</p>`;
}

function welcomeEmail({ name, username, password, loginUrl }) {
  const url = loginUrl || appLoginUrl();
  const bodyHtml = `
    <p style="margin:0 0 8px;color:#22d3ee;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Welcome</p>
    <p style="margin:0 0 12px;color:#ffffff;font-size:22px;font-weight:700;">Your ComEx account is ready</p>
    <p style="margin:0 0 20px;color:#bfdbfe;font-size:14px;line-height:1.6;">
      Hi ${escapeHtml(name || username)}, sign in with the one-time password below. You will be asked to choose a new password as soon as you log in.
    </p>
    ${credentialBox(`${credentialRow('Username', username)}${credentialRow('One-time password', password)}`)}
    ${ctaButton(url, 'Open ComEx')}
  `;
  return {
    subject: 'Your ComEx account',
    html: wrapEmail({
      title: 'Your ComEx account',
      preheader: 'Your one-time password for the Commercial Excellence Hub.',
      bodyHtml,
    }),
  };
}

function resetEmail({ name, username, password, loginUrl }) {
  const url = loginUrl || appLoginUrl();
  const bodyHtml = `
    <p style="margin:0 0 8px;color:#22d3ee;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Password reset</p>
    <p style="margin:0 0 12px;color:#ffffff;font-size:22px;font-weight:700;">Your one-time password</p>
    <p style="margin:0 0 20px;color:#bfdbfe;font-size:14px;line-height:1.6;">
      Hi ${escapeHtml(name || username)}, this password expires in 24 hours. You will be asked to choose a new password when you sign in.
    </p>
    ${credentialBox(`${credentialRow('Username', username)}${credentialRow('One-time password', password)}`)}
    ${ctaButton(url, 'Sign in to ComEx')}
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
  return envStr('SMTP_HOST', 'smtp.gmail.com').toLowerCase();
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
    throw new Error('Hotmail/Outlook has disabled password SMTP. Use a Gmail address with an app password.');
  }
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    throw new Error('nodemailer is not installed');
  }
  const user = envStr('SMTP_USER');
  const pass = envStr('SMTP_PASS').replace(/\s+/g, '');
  const host = smtpHost();
  const port = Number(envStr('SMTP_PORT', '587')) || 587;
  const transporter = nodemailer.createTransport(
    host.includes('gmail.com')
      ? { service: 'gmail', auth: { user, pass } }
      : {
        host,
        port,
        secure: port === 465,
        requireTLS: port !== 465,
        auth: { user, pass },
      },
  );
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
  const smtpUser = envStr('SMTP_USER');
  const smtpPass = envStr('SMTP_PASS');
  if (smtpUser && smtpPass) {
    if (!from) throw new Error('EMAIL_FROM or SMTP_USER is not configured');
    await sendViaSmtp({ to, from, subject, html });
    return;
  }
  if (envStr('RESEND_API_KEY')) {
    if (!from) throw new Error('EMAIL_FROM is not configured');
    await sendViaResend({ to, from, subject, html });
    return;
  }
  throw new Error('Email is not configured. Set SMTP_USER and SMTP_PASS for Gmail, or RESEND_API_KEY.');
}

module.exports = {
  appLoginUrl,
  welcomeEmail,
  resetEmail,
  sendEmail,
};
