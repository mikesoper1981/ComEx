/**
 * Transactional email via Gmail SMTP, or Resend if SMTP is not set.
 *
 * SMTP (Gmail): SMTP_USER, SMTP_PASS, EMAIL_FROM (must match the Gmail account)
 * Resend:       RESEND_API_KEY, EMAIL_FROM
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
<body style="margin:0;padding:0;background-color:#000000;color:#ffffff;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#000000;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color:#000000;">
    <tr>
      <td align="center" bgcolor="#000000" style="background-color:#000000;padding:32px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" bgcolor="#2563eb" style="width:100%;max-width:520px;background-color:#2563eb;">
          <tr>
            <td bgcolor="#2563eb" style="background-color:#2563eb;padding:22px 24px 8px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:22px;font-weight:700;">
              ComEx
            </td>
          </tr>
          <tr>
            <td bgcolor="#2563eb" style="background-color:#2563eb;padding:0 24px 20px;font-family:Arial,Helvetica,sans-serif;color:#dbeafe;font-size:12px;font-weight:700;">
              Commercial Excellence Hub
            </td>
          </tr>
          <tr>
            <td bgcolor="#2563eb" style="background-color:#2563eb;padding:0 24px 24px;font-family:Arial,Helvetica,sans-serif;">
              ${bodyHtml}
            </td>
          </tr>
        </table>
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;">
          <tr>
            <td align="center" bgcolor="#000000" style="background-color:#000000;padding:16px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;">
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
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1d4ed8" style="background-color:#1d4ed8;margin:0 0 20px;">
    <tr>
      <td style="padding:12px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>
      </td>
    </tr>
  </table>`;
}

function credentialRow(label, value) {
  return `<tr>
    <td style="padding:8px 0;color:#bfdbfe;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;width:150px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(label)}</td>
    <td style="padding:8px 0;color:#ffffff;font-size:16px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(value)}</td>
  </tr>`;
}

function ctaButton(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td bgcolor="#000000" style="background-color:#000000;">
        <a href="${escapeHtml(url)}" style="display:inline-block;background-color:#000000;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;font-family:Arial,Helvetica,sans-serif;padding:12px 22px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>
  <p style="margin:12px 0 0;color:#dbeafe;font-size:12px;word-break:break-all;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(url)}</p>`;
}

function welcomeEmail({ name, username, password, loginUrl }) {
  const url = loginUrl || appLoginUrl();
  const bodyHtml = `
    <p style="margin:0 0 8px;color:#dbeafe;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">Welcome</p>
    <p style="margin:0 0 12px;color:#ffffff;font-size:22px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Your ComEx account is ready</p>
    <p style="margin:0 0 20px;color:#dbeafe;font-size:14px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
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
    <p style="margin:0 0 8px;color:#dbeafe;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">Password reset</p>
    <p style="margin:0 0 12px;color:#ffffff;font-size:22px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Your one-time password</p>
    <p style="margin:0 0 20px;color:#dbeafe;font-size:14px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
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
