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

function remoteBgUrl(loginUrl) {
  const base = appLoginUrl(loginUrl);
  return base ? `${base}/email/bg.png` : '';
}

function emailAttachments() {
  try {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.join(__dirname, 'email-bg.png'),
      path.join(__dirname, '..', 'public', 'email', 'bg.png'),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) return [];
    return [{
      filename: 'bg.png',
      content: fs.readFileSync(file),
      contentType: 'image/png',
      cid: 'comex-bg',
      contentDisposition: 'inline',
    }];
  } catch {
    return [];
  }
}

function wrapEmail({ title, preheader, bodyHtml, loginUrl }) {
  const font = 'Arial, Helvetica, sans-serif';
  const cidBg = 'cid:comex-bg';
  const httpsBg = remoteBgUrl(loginUrl);
  const cssBg = httpsBg || cidBg;
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>${escapeHtml(title)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    body, table, td, a, p, div { font-family: ${font}; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#1e3a8a;color:#e2e8f0;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#1e3a8a;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1e3a8a" style="background-color:#1e3a8a;">
    <tr>
      <td align="center" valign="top" bgcolor="#1e3a8a" background="${escapeHtml(cidBg)}" style="background-color:#1e3a8a;background-image:url('${escapeHtml(cssBg)}');background-repeat:repeat;background-position:center top;padding:40px 16px;">
        <!--[if gte mso 9]>
        <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;">
          <v:fill type="frame" src="${escapeHtml(httpsBg || cidBg)}" color="#1e3a8a" />
          <v:textbox inset="0,0,0,0">
        <![endif]-->
        <table role="presentation" width="448" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:448px;">
          <tr>
            <td bgcolor="#60a5fa" style="background-color:#60a5fa;padding:1px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f172a" style="background-color:#0f172a;">
                <tr>
                  <td align="center" bgcolor="#0f172a" style="background-color:#0f172a;padding:32px 28px;font-family:${font};">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" bgcolor="#1e293b" width="56" style="background-color:#1e293b;">
                      <tr>
                        <td align="center" valign="middle" bgcolor="#1e293b" height="56" width="56" style="background-color:#1e293b;color:#60a5fa;font-family:${font};font-size:20px;font-weight:bold;height:56px;width:56px;">C</td>
                      </tr>
                    </table>
                    ${bodyHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table role="presentation" width="448" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:448px;">
          <tr>
            <td align="center" style="padding:18px 8px 8px;font-family:${font};font-size:11px;line-height:16px;color:#bfdbfe;">This email was sent by ComEx. If you were not expecting it, you can ignore it.</td>
          </tr>
        </table>
        <!--[if gte mso 9]>
          </v:textbox>
        </v:rect>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function credentialRow(label, value) {
  const font = 'Arial, Helvetica, sans-serif';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
    <tr>
      <td align="left" style="padding:0 0 6px;font-family:${font};font-size:12px;font-weight:bold;color:#7dd3fc;">${escapeHtml(label)}</td>
    </tr>
    <tr>
      <td bgcolor="#60a5fa" style="background-color:#60a5fa;padding:1px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111827">
          <tr>
            <td align="left" bgcolor="#111827" style="background-color:#111827;padding:12px 16px;font-family:${font};font-size:14px;font-weight:bold;color:#f8fafc;">${escapeHtml(value)}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function ctaButton(url, label) {
  const font = 'Arial, Helvetica, sans-serif';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" bgcolor="#2563eb" style="background-color:#2563eb;">
        <a href="${escapeHtml(url)}" style="display:block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-family:${font};font-weight:bold;font-size:14px;padding:14px 20px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

function welcomeEmail({ name, username, password, loginUrl }) {
  const url = loginUrl || appLoginUrl();
  const font = 'Arial, Helvetica, sans-serif';
  const bodyHtml = `
    <p style="margin:20px 0 6px;font-family:${font};color:#f8fafc;font-size:20px;font-weight:bold;text-align:center;">Welcome</p>
    <p style="margin:0 0 22px;font-family:${font};color:#bfdbfe;font-size:14px;line-height:21px;text-align:center;">
      Hi ${escapeHtml(name || username)}, your account is ready. Sign in with this one-time password, then choose a new one.
    </p>
    ${credentialRow('Username', username)}
    ${credentialRow('One-time password', password)}
    ${ctaButton(url, 'Continue')}
  `;
  return {
    subject: 'Your ComEx account',
    html: wrapEmail({
      title: 'Your ComEx account',
      preheader: 'Your one-time password for the Commercial Excellence Hub.',
      bodyHtml,
      loginUrl: url,
    }),
  };
}

function resetEmail({ name, username, password, loginUrl }) {
  const url = loginUrl || appLoginUrl();
  const font = 'Arial, Helvetica, sans-serif';
  const bodyHtml = `
    <p style="margin:20px 0 6px;font-family:${font};color:#f8fafc;font-size:20px;font-weight:bold;text-align:center;">Reset password</p>
    <p style="margin:0 0 22px;font-family:${font};color:#bfdbfe;font-size:14px;line-height:21px;text-align:center;">
      Hi ${escapeHtml(name || username)}, this one-time password expires in 24 hours. You will be asked to choose a new password when you sign in.
    </p>
    ${credentialRow('Username', username)}
    ${credentialRow('One-time password', password)}
    ${ctaButton(url, 'Continue')}
  `;
  return {
    subject: 'Your ComEx one-time password',
    html: wrapEmail({
      title: 'Your ComEx one-time password',
      preheader: 'Use this one-time password, then set a new one when you sign in.',
      bodyHtml,
      loginUrl: url,
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

async function sendViaSmtp({ to, from, subject, html, attachments }) {
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
  await transporter.sendMail({ from, to, subject, html, attachments: attachments || [] });
}

async function sendViaResend({ to, from, subject, html, attachments }) {
  const apiKey = envStr('RESEND_API_KEY');
  const payload = {
    from,
    to: [to],
    subject,
    html,
  };
  if (attachments && attachments.length) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
      content_id: a.cid,
      content_type: a.contentType,
    }));
  }
  const upstream = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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
  const attachments = emailAttachments();
  const smtpUser = envStr('SMTP_USER');
  const smtpPass = envStr('SMTP_PASS');
  if (smtpUser && smtpPass) {
    if (!from) throw new Error('EMAIL_FROM or SMTP_USER is not configured');
    await sendViaSmtp({ to, from, subject, html, attachments });
    return;
  }
  if (envStr('RESEND_API_KEY')) {
    if (!from) throw new Error('EMAIL_FROM is not configured');
    await sendViaResend({ to, from, subject, html, attachments });
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
