import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PasswordGate from './PasswordGate.jsx'

const rootEl = document.getElementById('root')

try {
  createRoot(rootEl).render(
    <StrictMode>
      <PasswordGate>
        <App />
      </PasswordGate>
    </StrictMode>,
  )
  window.__comexBooted = true
} catch (err) {
  const msg = String(err?.stack || err?.message || err)
  rootEl.innerHTML = `<div style="min-height:100vh;background:#0f172a;color:#e2e8f0;padding:24px;font-family:sans-serif"><h1 style="color:#f87171;font-size:20px">ComEx failed to load</h1><pre style="white-space:pre-wrap;font-size:12px">${msg.replace(/</g, '&lt;')}</pre></div>`
}
