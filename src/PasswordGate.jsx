import { useState } from 'react';
import { KeyRound, Lock, Mail } from 'lucide-react';
import { SESSION_UNLOCKED_KEY, SESSION_TOKEN_KEY, setCurrentUser, setSessionToken } from './auth';

function loginUrl() {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

export default function PasswordGate({ children }) {
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(SESSION_UNLOCKED_KEY) === '1'
      && !!sessionStorage.getItem(SESSION_TOKEN_KEY)
  );
  const [step, setStep] = useState('login');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changeToken, setChangeToken] = useState('');
  const [pendingUser, setPendingUser] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  if (unlocked) {
    return children;
  }

  const completeLogin = (data) => {
    setSessionToken(data.token);
    setCurrentUser(data.user);
    setUnlocked(true);
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setChangeToken('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const identity = login.trim();
    const secret = password.trim();
    if (!identity || !secret) {
      setError('Enter your username or email, and your password.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', login: identity, password: secret, loginUrl: loginUrl() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message || 'Incorrect username/email or password.');
      }
      if (data?.mustChangePassword && data?.changeToken) {
        setChangeToken(data.changeToken);
        setPendingUser(data.user || null);
        setStep('change');
        setPassword('');
        setNotice('Enter a new password to finish signing in.');
        return;
      }
      if (!data?.user || !data?.token) {
        throw new Error(data?.error?.message || 'Incorrect username/email or password.');
      }
      completeLogin(data);
    } catch (err) {
      setError(err?.message || 'Incorrect username/email or password.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    const identity = login.trim();
    if (!identity) {
      setError('Enter your username or email.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-password', login: identity, loginUrl: loginUrl() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || 'Could not send reset email.');
      setNotice(data?.message || 'If that account has an email on file, a one-time password has been sent.');
      setStep('login');
    } catch (err) {
      setError(err?.message || 'Could not send reset email.');
    } finally {
      setBusy(false);
    }
  };

  const handleChange = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${changeToken}`,
        },
        body: JSON.stringify({ action: 'change-password', password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.user || !data?.token) {
        throw new Error(data?.error?.message || 'Could not update password.');
      }
      completeLogin(data);
    } catch (err) {
      setError(err?.message || 'Could not update password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-sm border border-blue-400/30 rounded-2xl p-8 shadow-xl shadow-blue-950/40">
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-blue-400/25 flex items-center justify-center">
            {step === 'forgot' ? <Mail className="w-7 h-7 text-blue-400" aria-hidden />
              : step === 'change' ? <KeyRound className="w-7 h-7 text-cyan-400" aria-hidden />
              : <Lock className="w-7 h-7 text-blue-400" aria-hidden />}
          </div>
        </div>
        <h1 className="text-xl font-semibold text-center text-white tracking-tight mb-1">
          {step === 'forgot' ? 'Reset password' : step === 'change' ? 'Choose a new password' : 'Sign in'}
        </h1>
        <p className="text-sm text-blue-200/70 text-center mb-6">
          {step === 'forgot'
            ? 'We will email a one-time password if that account has an address on file.'
            : step === 'change'
              ? `Hi ${pendingUser?.name || 'there'}. This password can only be used once.`
              : 'Enter your username or email, then your password.'}
        </p>

        {step === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="app-login" className="sr-only">Username or email</label>
              <input
                id="app-login"
                type="text"
                autoComplete="username"
                value={login}
                onChange={(e) => { setLogin(e.target.value); if (error) setError(''); }}
                placeholder="Username or email"
                className="w-full bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="app-password" className="sr-only">Password</label>
              <input
                id="app-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                placeholder="Password"
                className="w-full bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            {error ? <p className="text-sm text-amber-300/90 text-center" role="alert">{error}</p> : null}
            {notice ? <p className="text-sm text-emerald-300/90 text-center">{notice}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white border border-blue-400/40 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              {busy ? 'Signing in…' : 'Continue'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('forgot'); setError(''); setNotice(''); }}
              className="w-full text-sm text-cyan-300/80 hover:text-cyan-200"
            >
              Forgot password?
            </button>
          </form>
        )}

        {step === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-4">
            <div>
              <label htmlFor="reset-login" className="sr-only">Username or email</label>
              <input
                id="reset-login"
                type="text"
                autoComplete="username"
                value={login}
                onChange={(e) => { setLogin(e.target.value); if (error) setError(''); }}
                placeholder="Username or email"
                className="w-full bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            {error ? <p className="text-sm text-amber-300/90 text-center" role="alert">{error}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white border border-blue-400/40 transition-colors"
            >
              {busy ? 'Sending…' : 'Send one-time password'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('login'); setError(''); }}
              className="w-full text-sm text-cyan-300/80 hover:text-cyan-200"
            >
              Back to sign in
            </button>
          </form>
        )}

        {step === 'change' && (
          <form onSubmit={handleChange} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="sr-only">New password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); if (error) setError(''); }}
                placeholder="New password (min 8 characters)"
                className="w-full bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="sr-only">Confirm password</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(''); }}
                placeholder="Confirm new password"
                className="w-full bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            {error ? <p className="text-sm text-amber-300/90 text-center" role="alert">{error}</p> : null}
            {notice ? <p className="text-sm text-emerald-300/90 text-center">{notice}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white border border-blue-400/40 transition-colors"
            >
              {busy ? 'Saving…' : 'Save password and continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
