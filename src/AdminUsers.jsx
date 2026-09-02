import { Fragment, useEffect, useState } from 'react';
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
  liftStellaGenericIntoUserSettings,
} from './stellaUserSettings';
import { formatMemoryStamp, describeObsoleteReason, memoryUsage } from './chatMemory';
import { defaultCompanyForRole } from './company';

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

function workflowStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'Completed';
  if (s === 'declined') return 'Declined';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'running') return 'In progress';
  if (s === 'offered') return 'Offered';
  return status || 'Unknown';
}

function workflowStatusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'text-emerald-300 bg-emerald-500/15 border-emerald-400/25';
  if (s === 'declined') return 'text-amber-200 bg-amber-500/15 border-amber-400/25';
  if (s === 'cancelled') return 'text-slate-300 bg-slate-500/20 border-slate-400/25';
  if (s === 'running') return 'text-cyan-200 bg-cyan-500/15 border-cyan-400/25';
  return 'text-blue-200 bg-blue-500/15 border-blue-400/25';
}

function workflowTriggerLabel(trigger) {
  const t = String(trigger || '').toLowerCase();
  if (t === 'keyword') return 'Keyword / phrase';
  if (t === 'context') return 'Conversation context';
  if (t === 'file') return 'File upload';
  if (t === 'direct') return 'Started from UI';
  if (t === 'offer-accepted') return 'Accepted offer';
  return trigger || 'Trigger not recorded';
}

function describeHistoryTrigger(run) {
  const reason = String(run?.triggerReason || '').trim();
  if (reason) return reason;
  const phrase = String(run?.triggerPhrase || '').trim();
  if (phrase) return `Keyword / phrase: “${phrase}”`;
  const kind = workflowTriggerLabel(run?.trigger);
  const text = String(run?.triggerText || '').trim();
  if (text && kind && kind !== 'Trigger not recorded') return `${kind}: ${text}`;
  if (text) return text;
  return 'Trigger not recorded';
}

function summarizeWorkflowStatus(byStatus) {
  const parts = [];
  const order = ['completed', 'declined', 'cancelled', 'running', 'offered'];
  for (const key of order) {
    const n = Number(byStatus?.[key] || 0);
    if (n) parts.push(`${n} ${workflowStatusLabel(key).toLowerCase()}`);
  }
  return parts.join(' · ') || 'none';
}

export default function AdminUsers({ currentUserId, onGeneralSettingsSaved }) {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [company, setCompany] = useState('PharmaCo');
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
  const [expandedHistoryDay, setExpandedHistoryDay] = useState(null);
  const [historyRunDetail, setHistoryRunDetail] = useState(null);
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
        company,
        loginUrl: window.location.origin,
      });
      setName('');
      setEmail('');
      setRole('user');
      setCompany('PharmaCo');
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
      const lifted = liftStellaGenericIntoUserSettings({
        ...pickGeneralSettings(doc),
        memory: pickMemoryItems(doc),
        stellaBusinessContext: pickStellaBusinessContext(doc),
      });
      setEditDoc(doc);
      setEditGeneral(pickGeneralSettings({ settings: lifted.settings }));
      setEditStellaBiz(mergeStellaBusinessContext(lifted.settings.stellaBusinessContext));
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
        stellaBusinessContext: mergeStellaBusinessContext({ keyGoals: editStellaBiz.keyGoals }),
      });
      await persistUserSettings(editUser, document);
      onGeneralSettingsSaved?.(editUser.id, {
        ...editGeneral,
        memory: editMemory,
        stellaBusinessContext: mergeStellaBusinessContext({ keyGoals: editStellaBiz.keyGoals }),
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
    setExpandedHistoryDay(null);
    setHistoryRunDetail(null);
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
            onClick={() => { setHistoryUser(null); setHistoryDays([]); setHistoryStatus('idle'); setExpandedHistoryDay(null); setHistoryRunDetail(null); setError(''); }}
            className="mb-4 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-600/50 border border-blue-400/20 rounded-lg text-xs text-blue-200 font-semibold inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to users
          </button>
          <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
            <History className="w-6 h-6 text-cyan-400" /> Login history
          </h2>
          <p className="text-sm text-blue-300/70 mb-5">
            {historyUser.name}{historyUser.email ? ` · ${historyUser.email}` : ''} — last 10 days with a login or chat activity, including volume and workflow triggers
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
                  <th className="pb-2 pr-3 font-semibold text-right">Conversations</th>
                  <th className="pb-2 font-semibold text-right">Workflows</th>
                </tr>
              </thead>
              <tbody>
                {historyStatus === 'loading' && (
                  <tr>
                    <td colSpan={5} className="py-6 text-blue-300/50">Loading history…</td>
                  </tr>
                )}
                {historyStatus === 'ready' && historyDays.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-blue-300/50">No login or chat activity recorded yet.</td>
                  </tr>
                )}
                {historyDays.map((row) => {
                  const dayKey = row.dayKey || row.at;
                  const expanded = expandedHistoryDay === dayKey;
                  const runs = Array.isArray(row.workflowRuns) ? row.workflowRuns : [];
                  return (
                    <Fragment key={dayKey}>
                      <tr className="border-b border-blue-400/10">
                        <td className="py-3 pr-3 font-semibold text-white whitespace-nowrap">{formatDay(row.at)}</td>
                        <td className="py-3 pr-3 text-blue-100/80">{formatTime(row.at)}</td>
                        <td className="py-3 pr-3 text-right font-semibold text-white">{row.chats ?? 0}</td>
                        <td className="py-3 pr-3 text-right font-semibold text-white">{row.conversations ?? 0}</td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedHistoryDay(expanded ? null : dayKey);
                              setHistoryRunDetail(null);
                            }}
                            className="inline-flex flex-col items-end gap-0.5 text-right hover:opacity-90"
                          >
                            <span className="font-semibold text-white underline decoration-cyan-400/40 underline-offset-2">
                              {row.workflows ?? 0}
                            </span>
                            <span className="text-[10px] text-blue-300/55 font-normal normal-case tracking-normal">
                              {summarizeWorkflowStatus(row.workflowByStatus)}
                            </span>
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-blue-400/10">
                          <td colSpan={5} className="pb-4 pt-1">
                            <div className="bg-slate-900/40 border border-blue-400/15 rounded-xl p-3 space-y-2">
                              <div className="text-[11px] uppercase tracking-wide text-blue-300/50 font-semibold">Workflow activity</div>
                              {runs.length === 0 ? (
                                <p className="text-xs text-blue-300/50">No workflow offers or runs recorded for this day.</p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {runs.map((run, idx) => (
                                    <li key={run.id || `${dayKey}-${idx}`}>
                                      <button
                                        type="button"
                                        onClick={() => setHistoryRunDetail(run)}
                                        className="w-full text-left px-3 py-2 rounded-lg bg-slate-800/50 hover:bg-slate-800/80 border border-blue-400/10 hover:border-cyan-400/30 transition-all"
                                      >
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-sm font-semibold text-white">{run.topicName || 'Workflow'}</span>
                                          <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${workflowStatusClass(run.status)}`}>
                                            {workflowStatusLabel(run.status)}
                                          </span>
                                          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-blue-400/25 text-blue-200/80">
                                            {workflowTriggerLabel(run.trigger)}
                                          </span>
                                          <span className="text-[11px] text-blue-300/55">{formatTime(run.at)}</span>
                                        </div>
                                        <div className="text-xs text-blue-200/70 mt-1 line-clamp-2">
                                          {describeHistoryTrigger(run)}
                                        </div>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {historyRunDetail && (
                                <div className="mt-3 px-3 py-3 rounded-lg bg-slate-800/70 border border-cyan-400/20 text-sm space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="font-semibold text-white">{historyRunDetail.topicName || 'Workflow'}</div>
                                    <button
                                      type="button"
                                      onClick={() => setHistoryRunDetail(null)}
                                      className="text-blue-300/50 hover:text-white"
                                      aria-label="Close workflow detail"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <div className="flex flex-wrap gap-2 text-xs">
                                    <span className={`px-1.5 py-0.5 rounded border ${workflowStatusClass(historyRunDetail.status)}`}>
                                      {workflowStatusLabel(historyRunDetail.status)}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded border border-blue-400/25 text-blue-200/80">
                                      {workflowTriggerLabel(historyRunDetail.trigger)}
                                    </span>
                                  </div>
                                  {historyRunDetail.triggerPhrase ? (
                                    <div>
                                      <div className="text-[11px] uppercase tracking-wide text-blue-300/50 mb-1">Matched phrase</div>
                                      <p className="text-blue-100/90">“{historyRunDetail.triggerPhrase}”</p>
                                    </div>
                                  ) : null}
                                  <div>
                                    <div className="text-[11px] uppercase tracking-wide text-blue-300/50 mb-1">What triggered it</div>
                                    <p className="text-blue-100/90 whitespace-pre-wrap">{describeHistoryTrigger(historyRunDetail)}</p>
                                  </div>
                                  {historyRunDetail.triggerText && historyRunDetail.triggerText !== describeHistoryTrigger(historyRunDetail) ? (
                                    <div>
                                      <div className="text-[11px] uppercase tracking-wide text-blue-300/50 mb-1">User message</div>
                                      <p className="text-blue-100/90 whitespace-pre-wrap">{historyRunDetail.triggerText}</p>
                                    </div>
                                  ) : null}
                                  <div className="text-xs text-blue-300/60">
                                    Chat: {historyRunDetail.chatTitle || historyRunDetail.chatId || 'Unknown'}
                                    {historyRunDetail.at ? ` · ${formatDay(historyRunDetail.at)} ${formatTime(historyRunDetail.at)}` : ''}
                                    {historyRunDetail.completedAt ? ` · ended ${formatTime(historyRunDetail.completedAt)}` : ''}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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
            {editUser.name}{editUser.email ? ` · ${editUser.email}` : ''}{editUser.company ? ` · ${editUser.company}` : ''} — email, General (shared company/industry/terminology), and Stella analysis goals
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
                <label className={labelClass}>Company</label>
                <input
                  value={editUser.company || ''}
                  readOnly
                  className={`${fieldClass} opacity-70 cursor-default`}
                />
                <p className="text-[11px] text-blue-300/45 mt-1">
                  Tenant for this account’s files and Stella tables. Set when the user is created.
                </p>
              </div>

              <div>
                <h3 className="text-sm font-bold text-white mb-1">General settings</h3>
                <p className="text-xs text-blue-300/60 mb-4">
                  Same fields as User Settings → General, including company, industry, metrics, and terminology used by Stella. Saved for {editUser.name}; they take effect the next time that user loads the hub.
                </p>
                <div className="mb-6 bg-slate-900/40 border border-blue-400/20 rounded-xl p-4">
                  <label className="block text-sm font-semibold text-white mb-1">Hub-wide answer detail</label>
                  <p className="text-xs text-blue-300/60 mb-3">
                    Default across Incentive chat, workflows, Territory, and Stella for this account. Executive = decide. Standard = recommend. Teaching = explain. A workflow step or agent that specifies its own length (for example 300 words) keeps that limit.
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
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <label className={labelClass}>Remembered from chats</label>
                      {(() => {
                        const usage = memoryUsage(editMemory);
                        return (
                          <span className="text-[10px] text-blue-300/50 whitespace-nowrap">
                            {usage.used} of {usage.cap} · {usage.pctLabel} full
                          </span>
                        );
                      })()}
                    </div>
                    <div className="h-1 rounded-full bg-slate-800 overflow-hidden mb-3">
                      <div
                        className="h-full bg-cyan-400/70 rounded-full"
                        style={{ width: `${Math.min(100, memoryUsage(editMemory).pct)}%` }}
                      />
                    </div>
                    <label className="flex items-start gap-2 mb-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editGeneral.memoryEnabled !== false}
                        onChange={(e) => setGeneralField('memoryEnabled', e.target.checked)}
                        className="rounded border-blue-400/40 mt-0.5"
                      />
                      <span className="text-[11px] text-blue-300/70 leading-relaxed">
                        Remember key facts from this user&apos;s chats. Unique to this account and stored in their settings.json. When off, facts are kept but not sent to the AI.
                      </span>
                    </label>
                    <p className="text-[11px] text-blue-300/45 mb-2">
                      Captured from this user&apos;s own chats (not by opening this screen). File intake answers, joins, and column notes stay on the file — they are not added here. You can turn memory off or delete a fact.
                    </p>
                    {editGeneral.memoryEnabled === false && (
                      <div className="text-xs text-amber-200/70 border border-amber-400/20 rounded-lg px-3 py-2 mb-2">
                        Chat memory is off — existing facts are not passed as context.
                      </div>
                    )}
                    {editMemory.length === 0 ? (
                      <div className={`text-xs text-blue-300/40 border border-blue-400/15 rounded-lg px-3 py-2 ${editGeneral.memoryEnabled === false ? 'opacity-40' : ''}`}>Nothing remembered yet.</div>
                    ) : (
                      <ul className={`space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1 ${editGeneral.memoryEnabled === false ? 'opacity-40 grayscale' : ''}`}>
                        {editMemory.map((item) => {
                          const reason = describeObsoleteReason(item, editMemory);
                          return (
                          <li key={item.id} className={`flex items-start gap-2 bg-slate-900/40 border rounded-lg px-3 py-2 ${item.status === 'obsolete' ? 'border-slate-500/20 opacity-80' : 'border-blue-400/15'}`}>
                            <span className="flex-1 min-w-0">
                              <span className="block text-xs leading-relaxed text-slate-200">
                                {item.status === 'obsolete' ? (
                                  <>
                                    <span className="text-slate-400 line-through">{item.text}</span>
                                    <span className="ml-2 text-[10px] text-amber-300/80 uppercase tracking-wide font-semibold">obsolete</span>
                                  </>
                                ) : item.text}
                              </span>
                              <span className="block text-[10px] text-blue-300/45 mt-1">
                                {item.createdAt ? `Added ${formatMemoryStamp(item.createdAt)}` : 'Added date not recorded'}
                                {item.status === 'obsolete' && item.obsoleteAt ? ` · Obsolete ${formatMemoryStamp(item.obsoleteAt)}` : ''}
                              </span>
                              {item.status === 'obsolete' && reason ? (
                                <span className="block text-[10px] text-amber-200/75 mt-0.5">{reason}</span>
                              ) : null}
                            </span>
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
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-white mb-1">Stella Insights</h3>
                <p className="text-xs text-blue-300/60 mb-4">
                  Company, industry, metrics, and terminology are in General above. This is only what Stella should focus on when analysing this user&apos;s data. Dataset files and connectors are uploaded from that user&apos;s User Settings → Stella Insights → Connections.
                </p>
                <div>
                  <label className={labelClass}>Key goals for Stella</label>
                  <textarea
                    value={editStellaBiz.keyGoals}
                    onChange={(e) => setEditStellaBiz((prev) => ({ ...prev, keyGoals: e.target.value }))}
                    rows={4}
                    placeholder="e.g. Spot underperforming territories, explain mix vs price"
                    className={`${fieldClass} resize-y`}
                  />
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

        <form onSubmit={handleCreate} className="bg-slate-900/40 border border-blue-400/20 rounded-xl p-4 mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-xs text-blue-300/70 font-semibold mb-1.5">Username</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane"
              className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </div>
          <div className="lg:col-span-2">
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
            <label className="block text-xs text-blue-300/70 font-semibold mb-1.5">Company</label>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. PharmaCo"
              className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-blue-300/70 font-semibold mb-1.5">Role</label>
            <select
              value={role}
              onChange={(e) => {
                const next = e.target.value;
                setRole(next);
                setCompany((current) => {
                  const fromRole = defaultCompanyForRole(next);
                  if (current === defaultCompanyForRole(role) || !String(current || '').trim()) return fromRole;
                  return current;
                });
              }}
              className="w-full bg-slate-900/50 text-white border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={busy || name.trim().length < 2 || !email.includes('@') || company.trim().length < 2}
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
                <th className="pb-2 pr-3 font-semibold">Company</th>
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
                  <td colSpan={7} className="py-6 text-blue-300/50">Loading users…</td>
                </tr>
              )}
              {status === 'ready' && users.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-blue-300/50">No users yet.</td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="border-b border-blue-400/10">
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-white">{u.name}</div>
                    <div className="text-[11px] text-blue-300/70">{u.email || 'No email'}</div>
                    <div className="text-[11px] text-blue-300/40 font-mono">{u.id}</div>
                  </td>
                  <td className="py-3 pr-3 text-blue-100/80 whitespace-nowrap">{u.company || '—'}</td>
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
