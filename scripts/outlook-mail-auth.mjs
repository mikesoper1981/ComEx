/**
 * One-time Hotmail/Outlook sign-in. Prints a refresh token for Vercel MS_REFRESH_TOKEN.
 *
 * 1. Azure Portal → App registrations → New registration
 *    - Supported accounts: personal Microsoft accounts only (or "any org + personal")
 *    - Authentication → Allow public client flows: Yes
 *    - API permissions → Microsoft Graph delegated: Mail.Send, offline_access
 * 2. Copy the Application (client) ID
 * 3. Run:  node scripts/outlook-mail-auth.mjs YOUR_CLIENT_ID
 * 4. Open the URL, sign in with Hotmail, then paste the printed token into Vercel
 */

const clientId = String(process.argv[2] || process.env.MS_CLIENT_ID || '').trim();
const tenant = String(process.argv[3] || process.env.MS_TENANT || 'consumers').trim();
const scope = 'https://graph.microsoft.com/Mail.Send offline_access';

if (!clientId) {
  console.error('Usage: node scripts/outlook-mail-auth.mjs <MS_CLIENT_ID>');
  process.exit(1);
}

const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const start = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: clientId, scope }),
});
const challenge = await start.json();
if (!start.ok) {
  console.error(challenge.error_description || challenge.error || challenge);
  process.exit(1);
}

console.log('\nSign in with your Hotmail account:');
console.log(`  ${challenge.verification_uri}`);
console.log(`  Code: ${challenge.user_code}\n`);

const intervalMs = Math.max(5, Number(challenge.interval) || 5) * 1000;
const deadline = Date.now() + (Number(challenge.expires_in) || 900) * 1000;

while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, intervalMs));
  const poll = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: challenge.device_code,
    }),
  });
  const data = await poll.json();
  if (data.access_token && data.refresh_token) {
    console.log('Success. Add these in Vercel → Environment Variables:\n');
    console.log(`MS_CLIENT_ID=${clientId}`);
    console.log(`MS_TENANT=${tenant}`);
    console.log(`MS_REFRESH_TOKEN=${data.refresh_token}\n`);
    process.exit(0);
  }
  if (data.error === 'authorization_pending' || data.error === 'slow_down') continue;
  console.error(data.error_description || data.error || data);
  process.exit(1);
}

console.error('Timed out waiting for sign-in.');
process.exit(1);
