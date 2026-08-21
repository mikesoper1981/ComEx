import { useEffect, useState } from 'react';
import { AlertTriangle, KeyRound, Mail, Plus, Trash2, Users } from 'lucide-react';
import { authHeaders } from './auth';

function formatLogin(iso) {
  if (!iso) return 'Never';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Never';
    return d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Never';
  }
}

export default function AdminUsers({ currentUserId }) {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [editEmail, setEditEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordUser, setPasswordUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  const load = async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await fetch('/api/users?action=list', { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || `Could not load users (${res.status})`);
      setUsers(Array.isArray(data.users) ? data.users : []);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(err?.message || 'Could not load users');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const call = async (payload) => {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`);
    return data;
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await call({
        action: 'create',
        name,
        email,
        password,
        role,
        loginUrl: window.location.origin,
      });
      setName('');
      setEmail('');
      setPassword('');
      setRole('user');
      setNotice(
        data?.emailSent
          ? 'User created and welcome email sent.'
          : `User created, but the welcome email was not sent${data?.emailError ? `: ${data.emailError}` : '.'}`
      );
      await load();
    } catch (err) {
      setError(err?.message || 'Could not create user');
    } finally {
      setBusy(false);
    }
  };

  const handleSetPassword = async (e) => {
    e.preventDefault();
    if (!passwordUser) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await call({
        action: 'set-password',
        userId: passwordUser.id,
        password: newPassword,
        email: editEmail,
      });
      setPasswordUser(null);
      setNewPassword('');
      setEditEmail('');
      setNotice(`Account updated for ${passwordUser.name}.`);
      await load();
    } catch (err) {
      setError(err?.message || 'Could not update password');
    } finally {
      setBusy(false);
    }
  };

  const handleSendReset = async (user) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await call({ action: 'send-reset', userId: user.id, loginUrl: window.location.origin });
      setNotice(`One-time password emailed to ${user.email || user.name}.`);
    } catch (err) {
      setError(err?.message || 'Could not send reset email');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (user) => {
    if (user.id === currentUserId) return;
    const ok = window.confirm(`Remove ${user.name}? Their settings and chat history will be deleted.`);
    if (!ok) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await call({ action: 'delete', userId: user.id });
      setNotice(`${user.name} removed.`);
      await load();
    } catch (err) {
      setError(err?.message || 'Could not remove user');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
        <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
          <Users className="w-6 h-6 text-cyan-400" /> Users
        </h2>
        <p className="text-sm text-blue-300/70 mb-5">
          Create and remove accounts. New users receive a welcome email with the login URL, username, and password. Passwords are hashed on the server.
        </p>

        <form onSubmit={handleCreate} className="bg-slate-900/40 border border-blue-400/20 rounded-xl p-4 mb-6 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-xs text-blue-300/70 font-semibold mb-1.5">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane"
              className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-blue-300/70 font-semibold mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              autoComplete="off"
              className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-blue-300/70 font-semibold mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              autoComplete="new-password"
              className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-blue-300/70 font-semibold mb-1.5">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full bg-slate-900/50 text-white border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={busy || name.trim().length < 2 || !email.includes('@') || password.length < 8}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Create
          </button>
        </form>

        {error && (
          <div className="mb-4 text-sm text-red-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 text-sm text-emerald-300">{notice}</div>
        )}

        {passwordUser && (
          <form onSubmit={handleSetPassword} className="mb-6 bg-slate-900/50 border border-cyan-400/25 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs text-blue-300/70 font-semibold mb-1.5">
                Email for {passwordUser.name}
              </label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs text-blue-300/70 font-semibold mb-1.5">
                New password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep current"
                autoComplete="new-password"
                className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
              />
            </div>
            <button
              type="submit"
              disabled={busy || (newPassword.length > 0 && newPassword.length < 8) || (!editEmail.trim() && !newPassword)}
              className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/30 text-cyan-200 text-sm font-semibold rounded-lg disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setPasswordUser(null); setNewPassword(''); setEditEmail(''); }}
              className="px-4 py-2 bg-slate-700/60 text-slate-200 text-sm font-semibold rounded-lg"
            >
              Cancel
            </button>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-blue-300/50 border-b border-blue-400/15">
                <th className="pb-2 pr-3 font-semibold">User</th>
                <th className="pb-2 pr-3 font-semibold">Role</th>
                <th className="pb-2 pr-3 font-semibold">Last login</th>
                <th className="pb-2 pr-3 font-semibold text-right">Chats (7d)</th>
                <th className="pb-2 pr-3 font-semibold text-right">New convos (7d)</th>
                <th className="pb-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' && (
                <tr>
                  <td colSpan={6} className="py-6 text-blue-300/50">Loading users…</td>
                </tr>
              )}
              {status === 'ready' && users.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-blue-300/50">No users yet.</td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="border-b border-blue-400/10">
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-white">{u.name}</div>
                    <div className="text-[11px] text-blue-300/70">{u.email || 'No email'}</div>
                    <div className="text-[11px] text-blue-300/40 font-mono">{u.id}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${u.role === 'admin' ? 'bg-amber-500/15 text-amber-300 border border-amber-400/25' : 'bg-slate-700/50 text-blue-200 border border-blue-400/15'}`}>
                      {u.role === 'admin' ? 'Admin' : 'User'}
                    </span>
                    {u.mustChangePassword ? (
                      <div className="text-[11px] text-cyan-300/80 mt-1">Must change password</div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 text-blue-100/80 whitespace-nowrap">{formatLogin(u.lastLoginAt)}</td>
                  <td className="py-3 pr-3 text-right font-semibold text-white">{u.messagesLast7Days ?? 0}</td>
                  <td className="py-3 pr-3 text-right font-semibold text-white">{u.conversationsLast7Days ?? 0}</td>
                  <td className="py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={busy || !u.email}
                        onClick={() => handleSendReset(u)}
                        className="px-2.5 py-1.5 bg-slate-700/50 hover:bg-slate-600/50 border border-blue-400/20 rounded-lg text-xs text-blue-200 font-semibold inline-flex items-center gap-1 disabled:opacity-30"
                      >
                        <Mail className="w-3.5 h-3.5" /> Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => { setPasswordUser(u); setNewPassword(''); setEditEmail(u.email || ''); setNotice(''); }}
                        className="px-2.5 py-1.5 bg-slate-700/50 hover:bg-slate-600/50 border border-blue-400/20 rounded-lg text-xs text-blue-200 font-semibold inline-flex items-center gap-1"
                      >
                        <KeyRound className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        type="button"
                        disabled={u.id === currentUserId}
                        onClick={() => handleRemove(u)}
                        className="px-2.5 py-1.5 bg-red-500/15 hover:bg-red-500/25 border border-red-400/25 rounded-lg text-xs text-red-300 font-semibold inline-flex items-center gap-1 disabled:opacity-30"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-blue-300/40 mt-3">
          Chats (7d) counts messages in the last 7 days. New convos (7d) counts conversations started in that window, regardless of how many messages they contain.
        </p>
      </div>
    </div>
  );
}
