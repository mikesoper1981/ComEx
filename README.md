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
| `SMTP_USER` | Server (`api/mail.js`) | Hotmail/Outlook address used to send welcome and reset emails, e.g. `you@hotmail.com`. |
| `SMTP_PASS` | Server (`api/mail.js`) | Hotmail **app password** (not your normal login password). Create one at [account.microsoft.com/security](https://account.microsoft.com/security). |
| `SMTP_HOST` | Server (`api/mail.js`) | Optional. Defaults to `smtp-mail.outlook.com`. |
| `SMTP_PORT` | Server (`api/mail.js`) | Optional. Defaults to `587`. |
| `EMAIL_FROM` | Server (`api/mail.js`) | From address. For Hotmail this should match `SMTP_USER`, e.g. `ComEx <you@hotmail.com>`. |
| `RESEND_API_KEY` | Server (`api/mail.js`) | Optional. Used only if SMTP is not set. |
| `APP_URL` | Server (`api/mail.js`) | Public login URL included in emails (falls back to the request origin). |
| `ANTHROPIC_API_KEY` | Server (`api/chat.js`) | Anthropic API key for all AI calls |
| `SUPABASE_URL` | Server (`api/stella-query.js`, `api/user-settings.js`) | Supabase URL (falls back to `VITE_SUPABASE_URL`) |
| `SUPABASE_SERVICE_KEY` | Server (`api/stella-query.js`, `api/user-settings.js`, `api/users.js`) | Supabase **service_role** key. Server-side only — must NEVER be exposed to the browser. Used for Stella Insights, user JSON, and the account registry (`intelligence/accounts.json`) with hashed passwords. |

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
