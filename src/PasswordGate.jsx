import { useState } from 'react';
import { Lock } from 'lucide-react';
import {
  SESSION_UNLOCKED_KEY,
  getHardcodedUser,
  setCurrentUser,
} from './auth';

export default function PasswordGate({ children }) {
  const expected = import.meta.env.VITE_APP_PASSWORD;
  const hardcodedUser = getHardcodedUser();

  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(SESSION_UNLOCKED_KEY) === '1'
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (unlocked) {
    return children;
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    const a = password.trim();
    const b = String(expected ?? '').trim();
    if (a === b) {
      // Bind session to the hardcoded user so settings/data can be scoped by userId.
      setCurrentUser(hardcodedUser);
      setUnlocked(true);
      setError('');
      setPassword('');
    } else {
      setError('Incorrect password. Try again.');
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-sm border border-blue-400/30 rounded-2xl p-8 shadow-xl shadow-blue-950/40">
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-blue-400/25 flex items-center justify-center">
            <Lock className="w-7 h-7 text-blue-400" aria-hidden />
          </div>
        </div>
        <h1 className="text-xl font-semibold text-center text-white tracking-tight mb-1">
          Sign in
        </h1>
        <p className="text-sm text-blue-200/70 text-center mb-2">
          Enter the app password to continue.
        </p>
        <p className="text-xs text-blue-300/50 text-center mb-6">
          Signing in as <span className="text-blue-200/80 font-medium">{hardcodedUser.name}</span>
          <span className="text-blue-300/40"> ({hardcodedUser.id})</span>
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="app-password" className="sr-only">
              Password
            </label>
            <input
              id="app-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError('');
              }}
              placeholder="Password"
              className="w-full bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
          {error ? (
            <p className="text-sm text-amber-300/90 text-center" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="w-full py-3 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white border border-blue-400/40 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:ring-offset-2 focus:ring-offset-slate-900"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
