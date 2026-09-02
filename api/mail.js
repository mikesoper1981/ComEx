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
<body style="margin:0;padding:0;background-color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f172a" style="background-color:#0f172a;">
    <tr>
      <td align="center" bgcolor="#0f172a" style="background-color:#0f172a;padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b1220" style="width:100%;max-width:560px;background-color:#0b1220;">
          <tr>
            <td bgcolor="#0b1220" style="background-color:#0b1220;padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:20px;font-weight:700;">
              ComEx
            </td>
          </tr>
          <tr>
            <td bgcolor="#0b1220" style="background-color:#0b1220;padding:0 28px 24px;font-family:Arial,Helvetica,sans-serif;color:#cbd5e1;font-size:13px;">
              Commercial Excellence Hub
            </td>
          </tr>
          <tr>
            <td bgcolor="#0b1220" style="background-color:#0b1220;padding:0 28px 28px;font-family:Arial,Helvetica,sans-serif;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td bgcolor="#0b1220" style="background-color:#0b1220;padding:0 28px 24px;font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:11px;line-height:1.5;">
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
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#60a5fa" style="background-color:#60a5fa;margin:0 0 22px;">
    <tr>
      <td style="padding:1px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1e293b" style="background-color:#1e293b;">
          <tr>
            <td style="padding:10px 16px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function credentialRow(label, value) {
  return `<tr>
    <td style="padding:8px 0;color:#93c5fd;font-size:12px;font-weight:700;width:150px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(label)}</td>
    <td style="padding:8px 0;color:#ffffff;font-size:14px;font-family:Consolas,Monaco,monospace;">${escapeHtml(value)}</td>
  </tr>`;
}

function ctaButton(url, label) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(label)}</a>
  <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;word-break:break-all;">
    <a href="${escapeHtml(url)}" style="color:#7dd3fc;text-decoration:underline;">${escapeHtml(url)}</a>
  </p>`;
}

function welcomeEmail({ name, username, password, loginUrl }) {
  const url = loginUrl || appLoginUrl();
  const bodyHtml = `
    <p style="margin:0 0 12px;color:#ffffff;font-size:18px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Welcome to ComEx</p>
    <p style="margin:0 0 20px;color:#cbd5e1;font-size:14px;line-height:1.55;font-family:Arial,Helvetica,sans-serif;">
      Hi ${escapeHtml(name || username)}, your account is ready. Sign in with the details below.
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

function stellaIntakeUrl({ fileId, fileName, loginUrl } = {}) {
  const base = String(loginUrl || appLoginUrl() || '').replace(/\/$/, '');
  if (!base) return '';
  const q = new URLSearchParams({ open: 'stella-intake' });
  if (fileId) q.set('file', String(fileId));
  if (fileName) q.set('fileName', String(fileName));
  return `${base}/?${q.toString()}`;
}

function stellaIntakeEmail({ name, files, intakeUrl }) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && (f.file || f.name));
  const items = list.map((f) => {
    const reason = f.action === 'replaced_schema'
      ? 'columns changed — confirm the stored context still applies'
      : 'new file — answer intake questions, including any joins';
    return `<li style="margin:0 0 8px;color:#e2e8f0;font-size:14px;line-height:1.45;">${escapeHtml(f.file || f.name)} — ${escapeHtml(reason)}</li>`;
  }).join('');
  const url = intakeUrl || stellaIntakeUrl(list[0] || {});
  const bodyHtml = `
    <p style="margin:0 0 12px;color:#ffffff;font-size:18px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Stella intake needed</p>
    <p style="margin:0 0 16px;color:#cbd5e1;font-size:14px;line-height:1.55;font-family:Arial,Helvetica,sans-serif;">
      Hi ${escapeHtml(name || 'there')}, a scheduled import is waiting for you in Stella Insights. Open the intake assistant to answer the questions for:
    </p>
    <ul style="margin:0 0 22px;padding-left:20px;font-family:Arial,Helvetica,sans-serif;">${items}</ul>
    ${url ? ctaButton(url, 'Open intake assistant') : '<p style="color:#cbd5e1;font-size:14px;">Sign in to ComEx → Settings → Stella Insights → Files.</p>'}
  `;
  const first = list[0]?.file || list[0]?.name || 'a Stella file';
  return {
    subject: list.length > 1
      ? `Stella intake needed (${list.length} files)`
      : `Stella intake needed: ${first}`,
    html: wrapEmail({
      title: 'Stella intake needed',
      preheader: `Answer intake questions for ${first}.`,
      bodyHtml,
    }),
  };
}

function resetEmail({ name, username, password, loginUrl }) {
  const url = loginUrl || appLoginUrl();
  const bodyHtml = `
    <p style="margin:0 0 12px;color:#ffffff;font-size:18px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Password reset</p>
    <p style="margin:0 0 20px;color:#cbd5e1;font-size:14px;line-height:1.55;font-family:Arial,Helvetica,sans-serif;">
      Hi ${escapeHtml(name || username)}, here is a one-time password for ComEx. It expires in 24 hours and you will be asked to choose a new password when you sign in.
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
  stellaIntakeEmail,
  stellaIntakeUrl,
  sendEmail,
};
