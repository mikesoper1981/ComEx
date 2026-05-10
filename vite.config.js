import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      // Local dev: run `vercel dev` (default http://127.0.0.1:3000) so /api/chat is available.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
})