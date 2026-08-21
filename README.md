# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Environment variables

Set these in your local `.env` and in your Vercel project settings:

| Variable | Where it runs | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Browser | Supabase anon key (used by `src/supabase.js`) |
| `VITE_APP_PASSWORD` | Server (seed) | Initial admin password, hashed into `intelligence/accounts.json` on first boot. Not used for login after that. |
| `VITE_APP_USER_ID` | Browser / seed | Admin user id (default `default`) |
| `VITE_APP_USER_NAME` | Browser / seed | Admin display name (default `Admin`) |
| `VITE_APP_USER2_ID` | Seed | Second user id (default `consultant`) |
| `VITE_APP_USER2_NAME` | Seed | Second user display name (default `Standard User`) |
| `VITE_APP_USER2_PASSWORD` | Server (seed) | Initial password for seeded standard users (falls back to `VITE_APP_PASSWORD`) |
| `VITE_APP_USER3_ID` | Seed | Third user id (default `oscar`) |
| `VITE_APP_USER_EMAIL` | Seed | Optional email for the seeded admin (only used when `accounts.json` is first created). |
| `VITE_APP_USER2_EMAIL` | Seed | Optional email for the seeded standard user. |
| `VITE_APP_USER3_EMAIL` | Seed | Optional email for the seeded Oscar user. |
| `AUTH_SECRET` | Server (`api/users.js`) | Optional HMAC secret for login tokens. Falls back to `SUPABASE_SERVICE_KEY`. |
| `MS_CLIENT_ID` | Server (`api/mail.js`) | Azure app ID for sending mail from Hotmail via Microsoft Graph. |
| `MS_REFRESH_TOKEN` | Server (`api/mail.js`) | Refresh token from `node scripts/outlook-mail-auth.mjs`. |
| `MS_TENANT` | Server (`api/mail.js`) | Optional. Defaults to `consumers` (personal Hotmail/Outlook). |
| `SMTP_USER` / `SMTP_PASS` | Server (`api/mail.js`) | Gmail or other SMTP that still allows app passwords. Hotmail password SMTP is blocked by Microsoft. |
| `EMAIL_FROM` | Server (`api/mail.js`) | From address for SMTP/Resend. Graph sends as the signed-in Hotmail account. |
| `RESEND_API_KEY` | Server (`api/mail.js`) | Optional fallback if Graph/SMTP are not set. |
| `APP_URL` | Server (`api/mail.js`) | Public login URL included in emails (falls back to the request origin). |
| `ANTHROPIC_API_KEY` | Server (`api/chat.js`) | Anthropic API key for all AI calls |
| `SUPABASE_URL` | Server (`api/stella-query.js`, `api/user-settings.js`) | Supabase URL (falls back to `VITE_SUPABASE_URL`) |
| `SUPABASE_SERVICE_KEY` | Server (`api/stella-query.js`, `api/user-settings.js`, `api/users.js`) | Supabase **service_role** key. Server-side only — must NEVER be exposed to the browser. Used for Stella Insights, user JSON, and the account registry (`intelligence/accounts.json`) with hashed passwords. |

## Hotmail / Outlook email

Microsoft has disabled password SMTP for Hotmail (`535 5.7.139`). Mail is sent with Microsoft Graph instead:

1. [Azure app registration](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → New registration. Choose personal Microsoft accounts. Under Authentication, enable **Allow public client flows**. Add Graph delegated permissions `Mail.Send` and `offline_access`.
2. Run `node scripts/outlook-mail-auth.mjs <client-id>`, sign in with Hotmail, and copy the printed values into Vercel: `MS_CLIENT_ID`, `MS_REFRESH_TOKEN`, `MS_TENANT=consumers`.
3. Redeploy. You can remove `SMTP_PASS`.

## Stella Insights setup

Run `supabase/stella_setup.sql` once in the Supabase SQL editor. It creates the
`stella_files` registry table, the read-only `stella_run_select` executor, the
dynamic-table helper functions (`stella_create_table`, `stella_insert_rows`,
`stella_drop_table`), and the `stella-data` storage bucket.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
