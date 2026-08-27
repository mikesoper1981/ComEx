import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, History, Mail, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { authHeaders } from './auth';
import {
  GENERAL_SETTINGS_DEFAULTS,
  RESPONSE_LENGTH_OPTIONS,
  mergeGeneralIntoDocument,
  pickGeneralSettings,
  pickMemoryItems,
} from './userGeneralSettings';
import {
  DEFAULT_STELLA_BUSINESS_CONTEXT,
  mergeStellaBusinessContext,
  pickStellaBusinessContext,
} from './stellaUserSettings';

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

function formatDay(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Europe/London',
    });
  } catch {
    return iso;
  }
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/London',
    });
  } catch {
    return '';
  }
}

export default function AdminUsers({ currentUserId, onGeneralSettingsSaved }) {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [busy, setBusy] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editEmail, setEditEmail] = useState('');
  const [editGeneral, setEditGeneral] = useState(GENERAL_SETTINGS_DEFAULTS);
  const [editStellaBiz, setEditStellaBiz] = useState(DEFAULT_STELLA_BUSINESS_CONTEXT);
  const [editMemory, setEditMemory] = useState([]);
  const [editDoc, setEditDoc] = useState(null);
  const [editStatus, setEditStatus] = useState('idle');
  const [historyUser, setHistoryUser] = useState(null);
  const [historyDays, setHistoryDays] = useState([]);
  const [historyStatus, setHistoryStatus] = useState('idle');
  const [pendingDelete, setPendingDelete] = useState(null);

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
        role,
        loginUrl: window.location.origin,
      });
      setName('');
      setEmail('');
      setRole('user');
      setNotice(
        data?.emailSent
          ? 'User created. A one-time password has been emailed; they must change it on first sign-in.'
          : `User created, but the welcome email was not sent${data?.emailError ? `: ${data.emailError}` : '.'}`
      );
      await load();
    } catch (err) {
      setError(err?.message || 'Could not create user');
    } finally {
      setBusy(false);
    }
  };

  const setGeneralField = (key, value) => {
    setEditGeneral((prev) => ({ ...prev, [key]: value }));
  };

  const openEdit = async (user) => {
    setEditUser(user);
    setEditEmail(user.email || '');
    setEditGeneral({ ...GENERAL_SETTINGS_DEFAULTS });
    setEditStellaBiz({ ...DEFAULT_STELLA_BUSINESS_CONTEXT });
    setEditMemory([]);
    setEditDoc(null);
    setEditStatus('loading');
    setError('');
    setNotice('');
    try {
      const q = new URLSearchParams({
        userId: user.id,
        userName: user.name,
        file: 'settings.json',
      });
      const res = await fetch(`/api/user-settings?${q}`);
      if (res.status === 404) {
        setEditDoc(null);
        setEditGeneral({ ...GENERAL_SETTINGS_DEFAULTS });
        setEditStellaBiz({ ...DEFAULT_STELLA_BUSINESS_CONTEXT });
        setEditMemory([]);
        setEditStatus('ready');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data?.error?.message || `Could not load settings (${res.status})`;
        if (/object not found/i.test(message)) {
          setEditDoc(null);
          setEditGeneral({ ...GENERAL_SETTINGS_DEFAULTS });
          setEditStellaBiz({ ...DEFAULT_STELLA_BUSINESS_CONTEXT });
          setEditMemory([]);
          setEditStatus('ready');
          return;
        }
        throw new Error(message);
      }
      const doc = data?.document && typeof data.document === 'object' ? data.document : data;
      setEditDoc(doc);
      setEditGeneral(pickGeneralSettings(doc));
      setEditStellaBiz(pickStellaBusinessContext(doc));
      setEditMemory(pickMemoryItems(doc));
      setEditStatus('ready');
    } catch (err) {
      setEditStatus('error');
      setError(err?.message || 'Could not load settings');
    }
  };

  const closeEdit = () => {
    setEditUser(null);
    setEditEmail('');
    setEditGeneral({ ...GENERAL_SETTINGS_DEFAULTS });
    setEditStellaBiz({ ...DEFAULT_STELLA_BUSINESS_CONTEXT });
    setEditMemory([]);
    setEditDoc(null);
    setEditStatus('idle');
    setError('');
  };

  const persistUserSettings = async (user, document) => {
    const res = await fetch('/api/user-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.id,
        userName: user.name,
        file: 'settings.json',
        document,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Could not save settings (${res.status})`);
    return document;
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editUser) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const nextEmail = editEmail.trim();
      const prevEmail = String(editUser.email || '').trim();
      if (nextEmail && nextEmail !== prevEmail) {
        await call({
          action: 'set-password',
          userId: editUser.id,
          email: nextEmail,
        });
      }
      const document = mergeGeneralIntoDocument(editDoc, editGeneral, editUser, editMemory, {
        stellaBusinessContext: mergeStellaBusinessContext(editStellaBiz),
      });
      await persistUserSettings(editUser, document);
      onGeneralSettingsSaved?.(editUser.id, {
        ...editGeneral,
        memory: editMemory,
        stellaBusinessContext: mergeStellaBusinessContext(editStellaBiz),
      });
      const savedName = editUser.name;
      closeEdit();
      setNotice(`Updated ${savedName}. Settings now apply for that account.`);
      await load();
    } catch (err) {
      setError(err?.message || 'Could not save user');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMemory = async (item) => {
    if (!editUser) return;
    const nextMemory = editMemory.filter((m) => m.id !== item.id);
    setBusy(true);
    setError('');
    try {
      const document = mergeGeneralIntoDocument(editDoc, pickGeneralSettings(editDoc), editUser, nextMemory);
      await persistUserSettings(editUser, document);
      setEditDoc(document);
      setEditMemory(nextMemory);
      onGeneralSettingsSaved?.(editUser.id, { ...pickGeneralSettings(editDoc), memory: nextMemory });
    } catch (err) {
      setError(err?.message || 'Could not remove memory');
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

  const handleRemove = (user) => {
    if (user.id === currentUserId) return;
    setError('');
    setNotice('');
    setPendingDelete(user);
  };

  const confirmRemove = async () => {
    const user = pendingDelete;
    if (!user) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await call({ action: 'delete', userId: user.id, userName: user.name });
      setPendingDelete(null);
      setNotice(
        data?.warning
          ? `${user.name} was removed. ${data.warning}`
          : `${user.name} removed, including chat history, settings, and uploaded context.`
      );
      await load();
    } catch (err) {
      setError(err?.message || 'Could not remove user');
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (user) => {
    setHistoryUser(user);
    setHistoryDays([]);
    setHistoryStatus('loading');
    setError('');
    try {
      const q = new URLSearchParams({ action: 'login-history', userId: user.id, userName: user.name });
      const res = await fetch(`/api/users?${q}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || 'Could not load login history');
      setHistoryDays(Array.isArray(data.days) ? data.days : []);
      setHistoryStatus('ready');
    } catch (err) {
      setHistoryStatus('error');
      setError(err?.message || 'Could not load login history');
    }
  };

  if (historyUser) {
    return (
      <div className="space-y-4">
        <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
          <button
            type="button"
            onClick={() => { setHistoryUser(null); setHistoryDays([]); setHistoryStatus('idle'); setError(''); }}
            className="mb-4 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-600/50 border border-blue-400/20 rounded-lg text-xs text-blue-200 font-semibold inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to users
          </button>
          <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
            <History className="w-6 h-6 text-cyan-400" /> Login history
          </h2>
          <p className="text-sm text-blue-300/70 mb-5">
            {historyUser.name}{historyUser.email ? ` · ${historyUser.email}` : ''} — last 10 login days
          </p>
          {error && (
            <div className="mb-4 text-sm text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-blue-300/50 border-b border-blue-400/15">
                  <th className="pb-2 pr-3 font-semibold">Day</th>
                  <th className="pb-2 pr-3 font-semibold">Time</th>
                  <th className="pb-2 pr-3 font-semibold text-right">Unique chats</th>
                  <th className="pb-2 font-semibold text-right">Conversations</th>
                </tr>
              </thead>
              <tbody>
                {historyStatus === 'loading' && (
                  <tr>
                    <td colSpan={4} className="py-6 text-blue-300/50">Loading history…</td>
                  </tr>
                )}
                {historyStatus === 'ready' && historyDays.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-blue-300/50">No logins recorded yet.</td>
                  </tr>
                )}
                {historyDays.map((row) => (
                  <tr key={row.at} className="border-b border-blue-400/10">
                    <td className="py-3 pr-3 font-semibold text-white whitespace-nowrap">{formatDay(row.at)}</td>
                    <td className="py-3 pr-3 text-blue-100/80">{formatTime(row.at)}</td>
                    <td className="py-3 pr-3 text-right font-semibold text-white">{row.chats ?? 0}</td>
                    <td className="py-3 text-right font-semibold text-white">{row.conversations ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (editUser) {
    const fieldClass = 'w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400';
    const labelClass = 'block text-xs text-blue-300/70 font-semibold mb-2';
    return (
      <div className="space-y-4">
        <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
          <button
            type="button"
            onClick={closeEdit}
            className="mb-4 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-600/50 border border-blue-400/20 rounded-lg text-xs text-blue-200 font-semibold inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to users
          </button>
          <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
            <Pencil className="w-6 h-6 text-cyan-400" /> Edit user
          </h2>
          <p className="text-sm text-blue-300/70 mb-5">
            {editUser.name}{editUser.email ? ` · ${editUser.email}` : ''} — email, General, and Stella Insights settings for this account
          </p>
          {error && (
            <div className="mb-4 text-sm text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}
          {editStatus === 'loading' && (
            <p className="text-sm text-blue-300/50">Loading settings…</p>
          )}
          {editStatus === 'error' && (
            <button
              type="button"
              onClick={() => openEdit(editUser)}
              className="px-4 py-2 bg-slate-700/60 text-slate-200 text-sm font-semibold rounded-lg"
            >
              Retry
            </button>
          )}
          {editStatus === 'ready' && (
            <form onSubmit={handleSaveEdit} className="space-y-6">
              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="name@company.com"
                  className={fieldClass}
                />
              </div>

              <div>
                <h3 className="text-sm font-bold text-white mb-1">General settings</h3>
                <p className="text-xs text-blue-300/60 mb-4">
                  Same fields as User Settings → General. Saved for {editUser.name}; they take effect the next time that user loads the hub.
                </p>
                <div className="mb-6 bg-slate-900/40 border border-blue-400/20 rounded-xl p-4">
                  <label className="block text-sm font-semibold text-white mb-1">Response length</label>
                  <p className="text-xs text-blue-300/60 mb-3">
                    How chat and agent replies are written. Executive = decide. Standard = recommend. Teaching = explain.
                  </p>
                  <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1 w-fit">
                    {RESPONSE_LENGTH_OPTIONS.map((level) => (
                      <button
                        key={level.id}
                        type="button"
                        onClick={() => setGeneralField('responseLength', level.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${editGeneral.responseLength === level.id ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Company name</label>
                    <input
                      value={editGeneral.companyName}
                      onChange={(e) => setGeneralField('companyName', e.target.value)}
                      placeholder="e.g. Acme Pharma UK"
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Industry / therapeutic area</label>
                    <input
                      value={editGeneral.industry}
                      onChange={(e) => setGeneralField('industry', e.target.value)}
                      placeholder="e.g. Specialty pharma — oncology"
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Role</label>
                    <input
                      value={editGeneral.role}
                      onChange={(e) => setGeneralField('role', e.target.value)}
                      placeholder="e.g. Incentive Compensation Manager"
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Preferred currency / units</label>
                    <input
                      value={editGeneral.currency}
                      onChange={(e) => setGeneralField('currency', e.target.value)}
                      placeholder="e.g. GBP, % of target"
                      className={fieldClass}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Company metrics &amp; definitions</label>
                    <textarea
                      value={editGeneral.metrics}
                      onChange={(e) => setGeneralField('metrics', e.target.value)}
                      rows={3}
                      placeholder={'e.g. Attainment = actual / quota'}
                      className={`${fieldClass} resize-y`}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Abbreviations &amp; terminology</label>
                    <textarea
                      value={editGeneral.abbreviations}
                      onChange={(e) => setGeneralField('abbreviations', e.target.value)}
                      rows={4}
                      placeholder={'e.g. AE = Account Executive'}
                      className={`${fieldClass} resize-y`}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Preferences</label>
                    <textarea
                      value={editGeneral.preferences}
                      onChange={(e) => setGeneralField('preferences', e.target.value)}
                      rows={3}
                      placeholder="e.g. Prefer tables over long paragraphs, UK spelling"
                      className={`${fieldClass} resize-y`}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Hard constraints</label>
                    <textarea
                      value={editGeneral.constraints}
                      onChange={(e) => setGeneralField('constraints', e.target.value)}
                      rows={3}
                      placeholder="e.g. Must comply with ABPI"
                      className={`${fieldClass} resize-y`}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Additional context</label>
                    <textarea
                      value={editGeneral.customContext}
                      onChange={(e) => setGeneralField('customContext', e.target.value)}
                      rows={4}
                      placeholder="Anything else the AI should always know across tools."
                      className={`${fieldClass} resize-y`}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Remembered from chats</label>
                    <p className="text-[11px] text-blue-300/45 mb-2">
                      Short facts stored for this user. Remove one and it stops applying immediately.
                    </p>
                    {editMemory.length === 0 ? (
                      <div className="text-xs text-blue-300/40 border border-blue-400/15 rounded-lg px-3 py-2">Nothing remembered yet.</div>
                    ) : (
                      <ul className="space-y-2">
                        {editMemory.map((item) => (
                          <li key={item.id} className="flex items-start gap-2 bg-slate-900/40 border border-blue-400/15 rounded-lg px-3 py-2">
                            <span className="flex-1 text-xs text-slate-200 leading-relaxed">{item.text}</span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleRemoveMemory(item)}
                              className="text-blue-300/50 hover:text-red-300 p-0.5 disabled:opacity-40"
                              aria-label="Forget this fact"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-white mb-1">Stella Insights</h3>
                <p className="text-xs text-blue-300/60 mb-4">
                  Business context for this account. Dataset files and connectors are uploaded from that user&apos;s User Settings → Stella Insights → Connections.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Company name</label>
                    <input
                      value={editStellaBiz.companyName}
                      onChange={(e) => setEditStellaBiz((prev) => ({ ...prev, companyName: e.target.value }))}
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Industry</label>
                    <input
                      value={editStellaBiz.industry}
                      onChange={(e) => setEditStellaBiz((prev) => ({ ...prev, industry: e.target.value }))}
                      className={fieldClass}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Key goals</label>
                    <textarea
                      value={editStellaBiz.keyGoals}
                      onChange={(e) => setEditStellaBiz((prev) => ({ ...prev, keyGoals: e.target.value }))}
                      rows={3}
                      className={`${fieldClass} resize-y`}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Key metrics</label>
                    <textarea
                      value={editStellaBiz.keyMetrics}
                      onChange={(e) => setEditStellaBiz((prev) => ({ ...prev, keyMetrics: e.target.value }))}
                      rows={3}
                      className={`${fieldClass} resize-y`}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Terminology / definitions</label>
                    <textarea
                      value={editStellaBiz.terminology}
                      onChange={(e) => setEditStellaBiz((prev) => ({ ...prev, terminology: e.target.value }))}
                      rows={4}
                      className={`${fieldClass} resize-y`}
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy || editStatus === 'error'}
                  className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg"
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={closeEdit}
                  className="px-4 py-2 bg-slate-700/60 text-slate-200 text-sm font-semibold rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
        <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
          <Users className="w-6 h-6 text-cyan-400" /> Users
        </h2>
        <p className="text-sm text-blue-300/70 mb-5">
          Create and remove accounts. New users get a one-time password by email and must choose a new one on first sign-in.
        </p>

        <form onSubmit={handleCreate} className="bg-slate-900/40 border border-blue-400/20 rounded-xl p-4 mb-6 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs text-blue-300/70 font-semibold mb-1.5">Username</label>
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
            disabled={busy || name.trim().length < 2 || !email.includes('@')}
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

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-blue-300/50 border-b border-blue-400/15">
                <th className="pb-2 pr-3 font-semibold">User</th>
                <th className="pb-2 pr-3 font-semibold">Role</th>
                <th className="pb-2 pr-3 font-semibold">Last login</th>
                <th className="pb-2 pr-3 font-semibold text-right">Chats (7d)</th>
                <th className="pb-2 pr-3 font-semibold text-right">Conversations (7d)</th>
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
                  <td className="py-3 pr-3 whitespace-nowrap">
                    {u.lastLoginAt ? (
                      <button
                        type="button"
                        onClick={() => openHistory(u)}
                        className="text-cyan-300 hover:text-cyan-200 underline decoration-cyan-400/40 underline-offset-2 font-medium"
                      >
                        {formatLogin(u.lastLoginAt)}
                      </button>
                    ) : (
                      <span className="text-blue-100/50">Never</span>
                    )}
                  </td>
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
                        onClick={() => openEdit(u)}
                        className="px-2.5 py-1.5 bg-slate-700/50 hover:bg-slate-600/50 border border-blue-400/20 rounded-lg text-xs text-blue-200 font-semibold inline-flex items-center gap-1"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
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
      </div>
      {pendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-red-400/30 rounded-2xl p-6 shadow-xl shadow-black/40">
            <h3 className="text-lg font-bold text-white mb-2">Remove {pendingDelete.name}?</h3>
            <p className="text-sm text-blue-100/80 mb-3">
              This permanently deletes their account. They will no longer be able to sign in, and all of their data across the hub will be removed:
            </p>
            <ul className="text-sm text-blue-100/75 space-y-1.5 mb-4 list-disc pl-5">
              <li>Chat history and conversations</li>
              <li>General settings and remembered facts</li>
              <li>Stella Insights business context, uploaded files, and connections</li>
              <li>PowerPoint template and proposal uploads</li>
              <li>Login history for this account</li>
            </ul>
            <p className="text-xs text-red-300/90 mb-5">This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPendingDelete(null)}
                className="px-4 py-2 bg-slate-700/60 text-slate-200 text-sm font-semibold rounded-lg disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirmRemove}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg disabled:opacity-40"
              >
                {busy ? 'Removing…' : 'Remove user and all data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
