import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const require = createRequire(import.meta.url)

const LOCAL_API_HANDLERS = {
  '/api/chat': './api/chat.js',
  '/api/territory': './api/territory.js',
  '/api/stella-query': './api/stella-query.js',
  '/api/user-settings': './api/user-settings.js',
}

const LOCAL_API_POST_ONLY = new Set(['/api/chat', '/api/territory', '/api/stella-query'])

const LOCAL_API_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'AUTH_SECRET',
  'SUPABASE_DB_PASSWORD',
  'POSTGRES_PASSWORD',
  'DATABASE_URL',
  'POSTGRES_URL',
]

function parseLocalApiQuery(url) {
  try {
    return Object.fromEntries(new URL(url, 'http://localhost').searchParams.entries())
  } catch {
    return {}
  }
}

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const out = {}
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"'))
      || (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

/** Fill process.env from .env files. Skip empty values so a blank .env.local cannot wipe real keys. */
function applyLocalApiEnv(root) {
  const merged = {}
  for (const name of ['.env', '.env.development', '.env.local', '.env.development.local']) {
    const parsed = parseDotEnv(path.join(root, name))
    for (const [key, value] of Object.entries(parsed)) {
      if (String(value || '').trim()) merged[key] = value
    }
  }
  for (const key of LOCAL_API_ENV_KEYS) {
    if (String(process.env[key] || '').trim()) continue
    const fromFile = String(merged[key] || '').trim()
    if (fromFile) process.env[key] = fromFile
  }
}

/** Serve selected /api routes from Vite so local work does not depend on `vercel dev`. */
function localChatApiPlugin() {
  return {
    name: 'local-chat-api',
    configureServer(server) {
      applyLocalApiEnv(server.config.root)
      // `vercel env pull` writes VERCEL=1 into .env.local. That is not a hosted
      // deploy — keep local-dev sessions working while APIs run inside Vite.
      process.env.COMEX_LOCAL_API = '1'
      delete process.env.VERCEL
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || ''
        const path = rawUrl.split('?')[0]
        const handlerPath = LOCAL_API_HANDLERS[path]
        if (!handlerPath) return next()
        if (LOCAL_API_POST_ONLY.has(path) && req.method !== 'POST') return next()
        if (path === '/api/user-settings' && req.method !== 'GET' && req.method !== 'POST') return next()
        if (path === '/api/chat' && !process.env.ANTHROPIC_API_KEY) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY is not configured' } }))
          return
        }
        let body = {}
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const chunks = []
          try {
            for await (const chunk of req) chunks.push(chunk)
          } catch {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: { message: 'Could not read body' } }))
            return
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          } catch {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }))
            return
          }
        }
        const resolved = require.resolve(handlerPath)
        delete require.cache[resolved]
        try { delete require.cache[require.resolve('./api/accounts-store.js')] } catch { /* ignore */ }
        const handler = require(handlerPath)
        const mockReq = {
          method: req.method,
          body,
          query: parseLocalApiQuery(rawUrl),
          headers: req.headers || {},
          url: rawUrl,
        }
        const mockRes = {
          statusCode: 200,
          setHeader(key, value) {
            res.setHeader(key, value)
          },
          status(code) {
            this.statusCode = code
            return this
          },
          json(data) {
            if (!res.headersSent) {
              res.statusCode = this.statusCode
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(data))
            }
          },
        }
        try {
          await handler(mockReq, mockRes)
        } catch (err) {
          if (!res.headersSent) {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              error: { message: err instanceof Error ? err.message : 'API handler failed' },
            }))
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    localChatApiPlugin(),
    react(),
    tailwindcss(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // Other /api routes still go to `vercel dev` when it is running.
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (res && !res.headersSent && typeof res.writeHead === 'function') {
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                error: { message: err?.message || 'Local API is not reachable' },
              }))
            }
          })
        },
      },
    },
  },
})
