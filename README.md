# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Environment variables

Set these in your local `.env` and in your Vercel project settings:

| Variable | Where it runs | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Browser | Supabase anon key (used by `src/supabase.js`) |
| `VITE_APP_PASSWORD` | Browser | Password for the admin user |
| `VITE_APP_USER_ID` | Browser | Admin user id (default `default`) |
| `VITE_APP_USER_NAME` | Browser | Admin display name (default `Admin`) |
| `VITE_APP_USER2_ID` | Browser | Second (non-admin) user id (default `consultant`) |
| `VITE_APP_USER2_NAME` | Browser | Second user display name (default `Standard User`). This name is also the Supabase folder: `intelligence/users/<name>/settings.json` |
| `VITE_APP_USER2_PASSWORD` | Browser | Password for the second user (falls back to `VITE_APP_PASSWORD`) |
| `ANTHROPIC_API_KEY` | Server (`api/chat.js`) | Anthropic API key for all AI calls |
| `SUPABASE_URL` | Server (`api/stella-query.cjs`) | Supabase URL (falls back to `VITE_SUPABASE_URL`) |
| `SUPABASE_SERVICE_KEY` | Server (`api/stella-query.cjs`) | Supabase **service_role** key. Server-side only — must NEVER be exposed to the browser. Used solely to run validated read-only `SELECT` queries for Stella Insights. |

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
