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
| `SMTP_USER` | Server (`api/mail.js`) | Gmail address that sends welcome and reset emails, e.g. `you@gmail.com`. |
| `SMTP_PASS` | Server (`api/mail.js`) | Gmail **app password** (16 characters). Not your normal Gmail password. |
| `EMAIL_FROM` | Server (`api/mail.js`) | From address, e.g. `ComEx <you@gmail.com>`. Must match `SMTP_USER` for Gmail. |
| `RESEND_API_KEY` | Server (`api/mail.js`) | Optional. Used only if Gmail SMTP is not set. |
| `APP_URL` | Server (`api/mail.js`) | Public login URL included in emails (falls back to the request origin). |
| `ANTHROPIC_API_KEY` | Server (`api/chat.js`) | Anthropic API key for all AI calls |
| `SUPABASE_URL` | Server (`api/stella-query.js`, `api/user-settings.js`) | Supabase URL (falls back to `VITE_SUPABASE_URL`) |
| `SUPABASE_SERVICE_KEY` | Server (`api/stella-query.js`, `api/user-settings.js`, `api/users.js`) | Supabase **service_role** key. Server-side only — must NEVER be exposed to the browser. Used for Stella Insights, user JSON, and the account registry (`intelligence/accounts.json`) with hashed passwords. |
| `DATABASE_URL` or `SUPABASE_DB_PASSWORD` | Server (`api/stella-db.js`) | Optional. Lets the app create company Postgres schemas when you add a company. `DATABASE_URL` is the URI from Supabase → Settings → Database. `SUPABASE_DB_PASSWORD` is the database password (used with `SUPABASE_URL`). Not needed if the Vercel Supabase integration already set `POSTGRES_URL`. |

## Gmail email

Welcome and password-reset mail can send from a Gmail account:

1. Google Account → [Security](https://myaccount.google.com/security) → turn on **2-Step Verification**.
2. [App passwords](https://myaccount.google.com/apppasswords) → create one named ComEx → copy the 16-character code.
3. In Vercel set `SMTP_USER` (your Gmail), `SMTP_PASS` (the app password, spaces optional), and `EMAIL_FROM` to `ComEx <you@gmail.com>`.
4. Redeploy.

Do not use your normal Gmail password. Hotmail SMTP will not work.

## Stella Insights setup

Company Postgres schemas (`c_pharmaco`, `c_comex`, …) and Stella helper
functions are created by the app when someone from that company signs in,
or when you add a user for that company. Dataset tables live in the
company schema — pick it in the Table Editor dropdown (not `public`).
There is nothing to run in the SQL editor.

`public.stella_files` has row-level security per company. The browser
anon key cannot read another tenant’s registry; the app loads files
through `/api/stella-files` using the signed-in session.

If schemas are not appearing, set `DATABASE_URL` to the **session pooler**
URI (Connect → Session pooler, host `*.pooler.supabase.com`) or set
`SUPABASE_DB_PASSWORD`. Vercel cannot use the direct `db.*.supabase.co`
host. Sign in once after a redeploy, then refresh the Table Editor.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
