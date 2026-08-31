import { createRequire } from 'node:module'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const require = createRequire(import.meta.url)

/** Serve /api/chat from Vite so local Admin/Workflow agent calls work without `vercel dev`. */
function localChatApiPlugin() {
  return {
    name: 'local-chat-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '')
      if (env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
      }
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        if (req.method !== 'POST' || !(url === '/api/chat' || url.startsWith('/api/chat?'))) {
          return next()
        }
        if (!process.env.ANTHROPIC_API_KEY) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY is not configured' } }))
          return
        }
        const chunks = []
        try {
          for await (const chunk of req) chunks.push(chunk)
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: { message: 'Could not read body' } }))
          return
        }
        let body = {}
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }))
          return
        }
        const handler = require('./api/chat.js')
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
          await handler({ method: 'POST', body }, mockRes)
        } catch (err) {
          if (!res.headersSent) {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              error: { message: err instanceof Error ? err.message : 'Chat handler failed' },
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
