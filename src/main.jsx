import { Component, StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import PasswordGate from './PasswordGate.jsx'

const App = lazy(() => import('./App.jsx'))

class RootErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error) {
    console.error('ComEx failed to load:', error)
  }
  render() {
    if (this.state.error) {
      const msg = String(this.state.error?.stack || this.state.error?.message || this.state.error)
      return (
        <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', padding: 24, fontFamily: 'sans-serif' }}>
          <h1 style={{ color: '#f87171', fontSize: 20, marginBottom: 12 }}>ComEx failed to load</h1>
          <p style={{ color: '#94a3b8', marginBottom: 16 }}>Refresh the page. If this stays, copy the text below.</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#020617', padding: 16, borderRadius: 8, border: '1px solid #1e293b' }}>{msg}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootErrorBoundary>
      <PasswordGate>
        <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0f172a' }} />}>
          <App />
        </Suspense>
      </PasswordGate>
    </RootErrorBoundary>
  </StrictMode>,
)
