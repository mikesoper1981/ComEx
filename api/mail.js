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
  const font = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  return `<!DOCTYPE html>
<html style="height:100%;">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;height:100%;min-height:100%;background-color:#0f172a;color:#e2e8f0;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="height:100%;min-height:100%;background-color:#0f172a;background-image:linear-gradient(to bottom right,#0f172a,#1e3a8a,#0f172a);">
    <tr>
      <td align="center" valign="middle" bgcolor="#0f172a" style="padding:48px 16px;font-family:${font};background-color:#0f172a;background-image:linear-gradient(to bottom right,#0f172a,#1e3a8a,#0f172a);">
        <table role="presentation" width="448" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="max-width:448px;width:100%;background-color:#0f172a;border:1px solid #60a5fa;border-radius:16px;">
          <tr>
            <td style="padding:32px;text-align:center;">
              <div style="display:inline-block;width:56px;height:56px;line-height:56px;margin:0 auto 24px;border-radius:16px;background-color:#1e293b;border:1px solid #3b82f6;color:#60a5fa;font-size:20px;font-weight:600;">C</div>
              ${bodyHtml}
            </td>
          </tr>
        </table>
        <div style="color:#93c5fd;font-size:11px;font-family:${font};padding:20px 16px 0;text-align:center;opacity:0.65;">This email was sent by ComEx. If you were not expecting it, you can ignore it.</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function credentialBox(rowsHtml) {
  return `<div style="text-align:left;margin:0 0 20px;">${rowsHtml}</div>`;
}

function credentialRow(label, value) {
  return `<div style="margin:0 0 12px;">
    <div style="color:#93c5fd;font-size:12px;font-weight:600;margin:0 0 6px;">${escapeHtml(label)}</div>
    <div style="background-color:#0f172a;border:1px solid #60a5fa;border-radius:8px;padding:12px 16px;color:#ffffff;font-size:14px;font-weight:500;">${escapeHtml(value)}</div>
  </div>`;
}

function ctaButton(url, label) {
  return `<a href="${escapeHtml(url)}" style="display:block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px;padding:12px 16px;border-radius:8px;border:1px solid #60a5fa;text-align:center;">${escapeHtml(label)}</a>`;
}

function welcomeEmail({ name, username, password, loginUrl }) {
  const url = loginUrl || appLoginUrl();
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#ffffff;font-size:20px;font-weight:600;letter-spacing:-0.025em;text-align:center;">Welcome</p>
    <p style="margin:0 0 24px;color:#bfdbfe;font-size:14px;line-height:1.5;text-align:center;opacity:0.8;">
      Hi ${escapeHtml(name || username)}, your account is ready. Sign in with this one-time password, then choose a new one.
    </p>
    ${credentialBox(`${credentialRow('Username', username)}${credentialRow('One-time password', password)}`)}
    ${ctaButton(url, 'Continue')}
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
    <p style="margin:0 0 4px;color:#ffffff;font-size:20px;font-weight:600;letter-spacing:-0.025em;text-align:center;">Reset password</p>
    <p style="margin:0 0 24px;color:#bfdbfe;font-size:14px;line-height:1.5;text-align:center;opacity:0.8;">
      Hi ${escapeHtml(name || username)}, this one-time password expires in 24 hours. You will be asked to choose a new password when you sign in.
    </p>
    ${credentialBox(`${credentialRow('Username', username)}${credentialRow('One-time password', password)}`)}
    ${ctaButton(url, 'Continue')}
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
