import { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { Send, Upload, FileText, Settings, MessageSquare, CheckCircle, AlertTriangle, TrendingUp, Users, Target, Award, X, Plus, Trash2, BarChart3, DollarSign, Calendar, ChevronDown, ChevronRight, Save, Map as MapIcon, MapPin, Layers, UserCog, History, LogOut } from 'lucide-react';
import { supabase } from './supabase';
import {
  getCurrentUser,
  setCurrentUser,
  getHardcodedUser,
  HARDCODED_USERS,
  isAdminUser,
  clearCurrentUser,
  userSettingsLocalKey,
  userSettingsRemotePath,
  userChatsRemotePath,
  userSettingsRemotePathCandidates,
  userStorageFolder,
  userPptxTemplateRemotePath,
  userProposalRemotePath,
  productIntelligenceLocalKey,
  productIntelligenceRemotePath,
} from './auth';
import { extractPptxThemeFromFile, themeToSettingsMeta, getPptxGeneratorThemeFromUserSettings, loadFullPptxStyleForGeneration, applyPptxLayout, renderSlideFromTheme } from './pptxTheme';
import { DEFAULT_PPTX_CONTEXT, getPptxContext, mergePptxContext } from './defaultPptxContext';
import AdminUsers from './AdminUsers';
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_PPTX_CLARIFY,
  DEFAULT_ORCHESTRATOR_PROMPTS,
  mergeIntelligenceContext,
  mergeTopics,
  fillTemplate,
  KNOWLEDGE_SEED_FILES,
  isKnowledgeStorageFile,
  buildKnowledgeBaseFromDocuments,
} from './defaults';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import {
  detectContextFileKind,
  extractSpreadsheetText,
  mergeModuleContext,
  mergeModuleContextPreferRich,
  serializeModuleContextForPersist,
  upsertModuleContextFile,
  patchModuleContextFile,
  removeModuleContextFile,
  formatModuleContextPromptBlock,
  listModuleContextBlocks,
  isThinContextExtract,
  knowledgeStemPattern,
  isEmptyContextValue,
  compactCapturedContext,
} from './moduleContext';

// Recharts is loaded lazily so it can never affect initial page load.
const StellaChart = lazy(() => import('./StellaChart'));

const MANAGER_COLOURS = ['#34d399', '#60a5fa', '#a78bfa'];

const STELLA_QUERY_API_PATH = '/api/stella-query';
const MANAGER_COLOURS_BORDER = ['#059669', '#2563eb', '#7c3aed'];

const CHAT_API_PATH = '/api/chat';

function stripKnowledgeCitations(text, extraNames = []) {
  let t = String(text || '');
  t = t.replace(/[-]{2,}\s*\nReferences:\s*\n[\s\S]*$/i, '');
  t = t.replace(/\n+#{0,3}\s*References:\s*\n(?:\s*\d+\.\s+.+\n?)*/gi, '\n');
  t = t.replace(/\s*\[\d+\]/g, '');
  t = t.replace(/\b[\w./-]+\.(?:md|ya?ml|txt)\b/gi, '');
  const stemRe = knowledgeStemPattern([...(KNOWLEDGE_SEED_FILES || []), ...extraNames]);
  if (stemRe) t = t.replace(stemRe, '');
  t = t.replace(/\bBest-practice guidance \d+\b/gi, '');
  return t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function looksLikeIntelligenceRef(text, extraNames = []) {
  const p = String(text || '');
  if (/\.(md|ya?ml|txt)\b/i.test(p)) return true;
  if (/\b(knowledge[- ]base file|intelligence file|document name|source filename|knowledge file)\b/i.test(p)) return true;
  if (/\bbest-practice guidance \d+\b/i.test(p)) return true;
  if (/\breferences?\s*:/i.test(p)) return true;
  if (/\[\d+\]/.test(p)) return true;
  const stemRe = knowledgeStemPattern([...(KNOWLEDGE_SEED_FILES || []), ...extraNames]);
  return !!(stemRe && stemRe.test(p));
}

function isSensibleSuggestion(text, extraNames = []) {
  const p = String(text || '').replace(/\s+/g, ' ').trim();
  if (p.length < 8 || p.length > 160) return false;
  if (looksLikeIntelligenceRef(p, extraNames)) return false;
  if (/^\s*[1-9]\s*[=:).\-]/.test(p)) return false;
  if (/\?/.test(p)) return true;
  if (/^(i|we|let'?s|please|help|tell|give|make|build|explain|summarize|summarise|check|recommend|propose|create|generate|list|outline|walk|rewrite|tighten|model|simulate|flag|identify|approve|export|assess|review|design|compare|add|change|update|draft|show|run|continue|move|apply|calculate|estimate|how|what|why|could|would|should|can)\b/i.test(p)) return true;
  return p.split(/\s+/).length >= 4;
}

const SUGGESTION_STOPWORDS = new Set([
  'about', 'after', 'also', 'based', 'been', 'being', 'could', 'does', 'from', 'have', 'into', 'just',
  'like', 'make', 'more', 'need', 'please', 'should', 'some', 'than', 'that', 'them', 'then', 'they',
  'this', 'using', 'want', 'were', 'what', 'when', 'which', 'will', 'with', 'would', 'your', 'their',
  'here', 'there', 'these', 'those', 'next', 'help', 'tell', 'show', 'give', 'how', 'why',
]);

function significantTokens(text) {
  const matches = String(text || '').toLowerCase().match(/[a-z][a-z0-9%-]{3,}|[0-9]+(?:\.[0-9]+)?%?/g) || [];
  return new Set(matches.filter((w) => !SUGGESTION_STOPWORDS.has(w)));
}

function isConversationGrounded(suggestion, convoTokens) {
  if (!convoTokens || convoTokens.size < 4) return true;
  const sugTokens = significantTokens(suggestion);
  let overlap = 0;
  for (const t of sugTokens) {
    if (convoTokens.has(t)) overlap += 1;
  }
  return overlap >= 1;
}

function excerptForSuggestions(text, max = 1200) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const head = Math.floor(max * 0.55);
  const tail = max - head - 20;
  return `${t.slice(0, head)}\n…\n${t.slice(-tail)}`;
}

function anthropicMessagesPost({ system, messages, max_tokens, tools, tool_choice, thinking, signal }) {
  return fetch(CHAT_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages, max_tokens, tools, tool_choice, thinking }),
    signal,
  });
}

async function withAbortTimeout(ms, work) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await work(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

function anthropicAssistantText(data) {
  return data?.content?.map(i => (i.type === 'text' ? i.text : '')).join('\n') || '';
}

function toAnthropicRole(role) {
  if (role === 'orchestrator') return 'assistant';
  if (role === 'user' || role === 'assistant') return role;
  return 'user';
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function extractJsonObject(text) {
  if (!text) return null;
  const direct = safeJsonParse(String(text).trim());
  if (direct) return direct;

  const fencedMatch = String(text).match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    const fenced = safeJsonParse(fencedMatch[1].trim());
    if (fenced) return fenced;
  }

  const source = String(text);
  const firstBrace = source.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < source.length; i++) {
    const ch = source[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = source.slice(firstBrace, i + 1);
        const parsed = safeJsonParse(candidate);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

// Remove any SQL blocks so they are never shown to the end user.
function stellaStripSqlBlocks(text) {
  return String(text || '')
    .replace(/```sql-query[\s\S]*?```/gi, '')
    .replace(/```sql[\s\S]*?```/gi, '')
    .trim();
}

function sanitizeStorageName(name) {
  return String(name || 'file')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || 'file';
}

const STELLA_STORAGE_CANDIDATES = [
  { bucket: 'stella-data', prefix: 'stella/' },
  { bucket: 'intelligence', prefix: 'stella/' },
];

const LEGACY_USER_SETTINGS_STORAGE_KEY = 'comex-user-settings';
const LEGACY_USER_SETTINGS_FILE = 'user-settings.json';

const RESPONSE_LENGTH_MIN = 1;
const RESPONSE_LENGTH_MAX = 3;
const DEFAULT_RESPONSE_LENGTH = 2;

/** Length/mode of chat/agent replies. Three distinct shapes — not small length tweaks. */
const RESPONSE_LENGTH_LEVELS = [
  {
    value: 1,
    id: 'executive',
    label: 'Executive',
    hint: 'Decide now. Verdict, then a tight table or icon bullets — formatted, not a wall of text.',
    instruction: `MODE: board briefing. Short, but still visually formatted — never a plain paragraph.
HARD TARGET: 80–150 words of prose (tables do not count against this).
SHAPE (use exactly this, nothing else):
1) Verdict — one bold sentence, with a status icon (✅ / ⚠️ / 🎯).
2) Put numbers, options, thresholds, or component splits in a compact markdown table. If there are no numbers to tabulate, use at most 5 icon bullets instead.
Then stop.
MUST: tables, icons, and **bold** on the decision and key figures. Clean and scannable.
MUST NOT: how-to steps, rationale, examples, trade-offs, definitions, impact, or extra prose around the table.`,
  },
  {
    value: 2,
    id: 'standard',
    label: 'Standard',
    hint: 'Working recommendation. What to do, how, and a short because — no walkthrough.',
    instruction: `MODE: working recommendation to a competent colleague. The middle ground — clearly longer than Executive, clearly not a tutorial.
HARD TARGET: 250–450 words.
SHAPE (use exactly this):
1) Verdict — bold the decision, optional status icon.
2) How — the working steps, design, or numbers. Use a table for options, weights, or thresholds.
3) Because — one short paragraph total so they can stand behind the choice. Not a point-by-point essay.
MUST: tables/icons/bold where they help scanning.
MUST NOT: a worked example, a walkthrough, a trade-off lesson, or an “impact if you get this wrong” tutorial. Those belong to Teaching. Do not shrink to an Executive briefing.`,
  },
  {
    value: 3,
    id: 'teaching',
    label: 'Teaching',
    hint: 'Explain it. Why it matters, the impact, and a concrete example.',
    instruction: `MODE: a proper explanation — not a briefing and not a padded Standard reply. Walk the thinking through.
HARD TARGET: 650–1100 words, or as long as the explanation needs.
For every important recommendation or concept, cover:
1) What it is — plain language; define a term if it would otherwise be ambiguous.
2) Why it matters — what it does for the business, the field force, or governance.
3) Impact — what goes well if you get it right, and what breaks (cost, fairness, compliance, sales behaviour, credibility) if you get it wrong or skip it.
4) A concrete example in this context.
5) What to watch for — the usual pitfall and what to do instead.
Structure with short headings so it is scannable. Write as a clear explainer, not a beginner class and not a lecture about being new.`,
  },
];

function normalizeResponseLength(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'executive') return 1;
  if (s === 'standard') return 2;
  if (s === 'teaching') return 3;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_RESPONSE_LENGTH;
  const rounded = Math.round(n);
  // Legacy 5-stop slider: 1 Exec, 2 Brief, 3 Standard, 4 Expanded, 5 Teaching
  if (rounded <= 1) return 1;
  if (rounded >= 4) return 3;
  return 2;
}

function storedResponseLength(raw) {
  return RESPONSE_LENGTH_LEVELS[normalizeResponseLength(raw) - 1].id;
}

function getResponseLengthLevel(settings) {
  const value = normalizeResponseLength(settings?.responseLength);
  return RESPONSE_LENGTH_LEVELS[value - 1];
}

function formatResponseLengthPrompt(settings) {
  const level = getResponseLengthLevel(settings);
  return `RESPONSE LENGTH — MATCH THIS LEVEL STRICTLY (chat and agent replies the user reads, including Stella).
The three levels are different kinds of reply, not small length tweaks. Do not drift toward a generic mid-length answer.
1 Executive = verdict + table/icon bullets (no how, no why). 2 Standard = what + how + a short because (no example walkthrough). 3 Teaching = explain: why it matters, impact, and a concrete example.
RICH FORMAT AT EVERY LEVEL, including Executive: markdown tables for numbers/comparisons, emoji icons (✅ ⚠️ 🎯 📊) on key points, **bold** on the decision and figures. Short does not mean plain text — keep it scannable and clean, with no extra prose.
Never omit a needed fact, number, question, or recommendation to hit a word target — cut explanation, not substance.

Current setting: ${level.value} of ${RESPONSE_LENGTH_MAX} — ${level.label}.
${level.instruction}

Do not apply this to exported PowerPoint/document content, structured JSON, classification, extraction, or schema-only tasks; those must follow their specified format and stay compact.`;
}

/** Scale a user-facing token budget with the length slider (1 ≈ 40% of base, 3 ≈ 175%). */
function scaleUserFacingMaxTokens(base, settings) {
  const n = normalizeResponseLength(settings?.responseLength);
  const t = (n - 1) / (RESPONSE_LENGTH_MAX - 1);
  const factor = 0.4 + t * 1.35;
  return Math.max(700, Math.min(8192, Math.round(Number(base) * factor)));
}

const DEFAULT_USER_SETTINGS = {
  companyName: '',
  industry: '',
  role: '',
  currency: 'GBP',
  metrics: '',
  abbreviations: '',
  preferences: '',
  constraints: '',
  customContext: '',
  memory: [],
  responseLength: 'standard',
  moduleContext: mergeModuleContext({}),
  // { fileName, uploadedAt, storagePath, theme: { schemeName, colors, fonts, ... } } — content ignored; style only
  pptxTemplate: null,
};

function mergeProductIntelligence(raw = {}) {
  return {
    ...mergeIntelligenceContext(raw),
    pptxContext: mergePptxContext(raw.pptxContext),
  };
}

function extractProductIntelligence(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.intelligence && typeof raw.intelligence === 'object'
    ? raw.intelligence
    : (raw.settings && typeof raw.settings === 'object' ? raw.settings : raw);
  if (!(src.agents || src.topics || src.systemPrompt || src.workflowRuntime || src.stellaPrompts || src.pptxContext)) {
    return null;
  }
  return mergeProductIntelligence(src);
}

function mergeUserSettingsFields(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    companyName: String(src.companyName || ''),
    industry: String(src.industry || ''),
    role: String(src.role || ''),
    currency: String(src.currency || DEFAULT_USER_SETTINGS.currency),
    metrics: String(src.metrics || ''),
    abbreviations: String(src.abbreviations || ''),
    preferences: String(src.preferences || ''),
    constraints: String(src.constraints || ''),
    customContext: String(src.customContext || ''),
    memory: normalizeMemoryItems(src.memory),
    responseLength: storedResponseLength(src.responseLength),
    moduleContext: mergeModuleContext(src.moduleContext),
    pptxTemplate: src.pptxTemplate || null,
  };
}

/** Pull settings fields out of a stored document (new or legacy shape). */
function normalizeLoadedUserSettings(parsed) {
  if (!parsed || typeof parsed !== 'object') return mergeUserSettingsFields({});
  const raw = parsed.settings && typeof parsed.settings === 'object'
    ? parsed.settings
    : (() => {
        const { userId: _userId, updatedAt: _updatedAt, settings: _settings, ...fields } = parsed;
        return fields;
      })();
  return mergeUserSettingsFields(raw);
}

/** Document shape saved to intelligence/users/<name>/settings.json (preferences only). */
function buildUserSettingsDocument(userId, settings, { userName = '' } = {}) {
  const merged = mergeUserSettingsFields(settings || {});
  const doc = {
    userId,
    updatedAt: new Date().toISOString(),
    settings: {
      ...merged,
      moduleContext: serializeModuleContextForPersist(merged.moduleContext),
    },
  };
  if (userName) doc.userName = userName;
  return doc;
}

/** Document shape saved to intelligence/users/<name>/chats.json. */
function buildUserChatsDocument(userId, { chats = [], activeChatId = null, userName = '' } = {}) {
  const doc = {
    userId,
    updatedAt: new Date().toISOString(),
    chats: normalizeStoredChats(chats),
    activeChatId: activeChatId || null,
  };
  if (userName) doc.userName = userName;
  return doc;
}

function userJsonRemotePath(user, file) {
  return file === 'chats.json' ? userChatsRemotePath(user) : userSettingsRemotePath(user);
}

async function uploadUserJsonDirect(user, doc, file = 'settings.json') {
  const path = userJsonRemotePath(user, file);
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const opts = { upsert: true, contentType: 'application/json', cacheControl: '0' };
  const { error } = await supabase.storage.from('intelligence').upload(path, blob, opts);
  if (!error) return;
  const { error: updateError } = await supabase.storage.from('intelligence').update(path, blob, opts);
  if (updateError) throw updateError;
}

/** Create or overwrite settings.json / chats.json via the service-role API. */
async function uploadUserJson(user, doc, file = 'settings.json') {
  try {
    const res = await fetch('/api/user-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user?.id,
        userName: user?.name,
        file,
        document: doc,
      }),
    });
    if (res.ok) return;
    if (res.status === 404) {
      await uploadUserJsonDirect(user, doc, file);
      return;
    }
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || `Could not save ${file} (${res.status})`);
  } catch (err) {
    if (err?.name === 'TypeError' || /failed to fetch/i.test(String(err?.message || ''))) {
      await uploadUserJsonDirect(user, doc, file);
      return;
    }
    throw err;
  }
}

async function downloadUserJsonDocument(user, file = 'settings.json') {
  const path = userJsonRemotePath(user, file);
  const q = new URLSearchParams({
    userId: String(user?.id || ''),
    userName: String(user?.name || ''),
    file,
  });
  try {
    const res = await fetch(`/api/user-settings?${q}`);
    if (res.ok) {
      const payload = await res.json();
      const doc = payload?.document && typeof payload.document === 'object'
        ? payload.document
        : (payload && typeof payload === 'object' && !payload.error ? payload : null);
      if (doc) return doc;
    } else if (res.status === 404) {
      return null;
    } else {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error?.message || `Could not load ${file} (${res.status})`);
    }
  } catch (err) {
    if (err?.message && /Could not load /i.test(err.message)) throw err;
  }
  try {
    const { data, error } = await supabase.storage.from('intelligence').download(path);
    if (!error && data) {
      const parsed = safeJsonParse(await data.text());
      if (parsed) return parsed;
    }
  } catch { /* missing file */ }
  return null;
}

const userJsonUploadSlots = new Map();

function userJsonUploadSlotKey(user, file = 'settings.json') {
  return `${String(user?.id || userStorageFolder(user))}:${file}`;
}

function lastUserSettingsUploadError(user) {
  return userJsonUploadSlots.get(userJsonUploadSlotKey(user, 'settings.json'))?.lastError || '';
}

/**
 * Single-flight flush per user+file. Payload is built when the write runs so a
 * chat autosave cannot overwrite a newer settings snapshot (and vice versa).
 */
function queueUserJsonUpload(user, file, docOrBuilder) {
  const key = userJsonUploadSlotKey(user, file);
  let slot = userJsonUploadSlots.get(key);
  if (!slot) {
    slot = { builder: null, lastError: '', chain: Promise.resolve() };
    userJsonUploadSlots.set(key, slot);
  }
  slot.builder = typeof docOrBuilder === 'function' ? docOrBuilder : () => docOrBuilder;
  slot.chain = slot.chain.then(async () => {
    let ok = true;
    slot.lastError = '';
    while (slot.builder) {
      const build = slot.builder;
      slot.builder = null;
      let toWrite;
      try {
        toWrite = build();
      } catch (err) {
        ok = false;
        slot.lastError = err?.message || String(err);
        continue;
      }
      try {
        await uploadUserJson(user, toWrite, file);
        slot.lastError = '';
      } catch (err) {
        ok = false;
        slot.lastError = err?.message || String(err);
        console.warn(`Could not save ${userJsonRemotePath(user, file)}:`, slot.lastError);
      }
    }
    return ok;
  });
  return slot.chain;
}

function queueUserSettingsUpload(user, docOrBuilder) {
  return queueUserJsonUpload(user, 'settings.json', docOrBuilder);
}

function queueUserChatsUpload(user, docOrBuilder) {
  return queueUserJsonUpload(user, 'chats.json', docOrBuilder);
}

function buildProductIntelligenceDocument(intel) {
  return {
    updatedAt: new Date().toISOString(),
    intelligence: mergeProductIntelligence(intel),
  };
}

function readLocalProductIntelligence() {
  try {
    const parsed = safeJsonParse(localStorage.getItem(productIntelligenceLocalKey()));
    const fromProduct = extractProductIntelligence(parsed);
    if (fromProduct) return fromProduct;
  } catch { /* ignore */ }
  return mergeProductIntelligence({});
}

const MAX_STORED_CHATS = 25;
const MAX_STORED_MESSAGES = 80;
const MAX_VISIBLE_CHATS = 5;

const CHAT_MODULE_META = {
  incentives: { id: 'incentives', label: 'Incentives', tab: 'chat' },
  territory: { id: 'territory', label: 'Territory', tab: 'territory' },
  stella: { id: 'stella', label: 'Stella Insights', tab: 'stella' },
};

function inferChatModule({ currentWorkflow } = {}) {
  const topic = String(currentWorkflow?.topicId || '');
  if (topic.includes('territory')) return 'territory';
  if (topic.includes('stella')) return 'stella';
  return 'incentives';
}

function chatModuleMeta(chat) {
  return CHAT_MODULE_META[chat?.module] || CHAT_MODULE_META.incentives;
}

function upsertChatInPlace(list, snap) {
  const arr = [...(list || [])];
  const i = arr.findIndex((c) => c.id === snap.id);
  if (i >= 0) arr[i] = { ...arr[i], ...snap, module: snap.module || arr[i].module || 'incentives' };
  else arr.unshift(snap);
  return arr.slice(0, MAX_STORED_CHATS);
}

function recentChats(list) {
  return (list || [])
    .filter((c) => chatHasUserContent(c.messages))
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, MAX_VISIBLE_CHATS);
}

function newChatId() {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createdAtFromChatId(id) {
  const m = String(id || '').match(/^chat_([0-9a-z]+)_/i);
  if (!m) return '';
  const n = parseInt(m[1], 36);
  if (!Number.isFinite(n) || n < 1e11) return '';
  try {
    return new Date(n).toISOString();
  } catch {
    return '';
  }
}

function deriveChatTitle(messages) {
  const userMsg = (messages || []).find((m) => m.role === 'user' && String(m.content || '').trim());
  if (!userMsg) return 'New chat';
  const t = String(userMsg.content).replace(/\s+/g, ' ').trim();
  return t.length > 52 ? `${t.slice(0, 50)}…` : t;
}

function chatHasUserContent(messages) {
  return (Array.isArray(messages) ? messages : []).some((m) => m.role === 'user' && String(m.content || '').trim());
}

function sanitizeMessageForStorage(m, { stampNow = false } = {}) {
  if (!m || typeof m !== 'object') return null;
  const out = {
    role: m.role,
    content: String(m.content || '').slice(0, 20000),
  };
  if (m.at) out.at = m.at;
  else if (stampNow) out.at = new Date().toISOString();
  if (Array.isArray(m.imagePreviews) && m.imagePreviews.length) {
    out.imagePreviews = m.imagePreviews.slice(0, 24).map((img) => ({
      name: img.name,
      included: !!img.included,
      pending: false,
      purpose: img.purpose || img.kind,
      reason: img.reason,
      sourceFormat: img.sourceFormat || null,
      bytes: img.bytes || 0,
    }));
  }
  return out;
}

function serializeChatSnapshot({ id, title, updatedAt, createdAt, messages, currentWorkflow, pendingWorkflow, uploadedFile, module }) {
  const cid = id || newChatId();
  const now = new Date().toISOString();
  const list = messages || [];
  const safeMessages = list.slice(-MAX_STORED_MESSAGES).map((m, i, arr) => (
    sanitizeMessageForStorage(m, { stampNow: i === arr.length - 1 && !m?.at })
  )).filter(Boolean);
  return {
    id: cid,
    title: title && title !== 'New chat' ? title : deriveChatTitle(safeMessages),
    createdAt: createdAt || createdAtFromChatId(cid) || now,
    updatedAt: updatedAt || now,
    module: module || inferChatModule({ currentWorkflow }),
    messages: safeMessages,
    currentWorkflow: currentWorkflow
      ? {
          topicId: currentWorkflow.topicId,
          currentStep: currentWorkflow.currentStep || 0,
          waitingForUser: !!currentWorkflow.waitingForUser,
          awaitingAgentReply: !!currentWorkflow.awaitingAgentReply,
          focusedContext: String(currentWorkflow.focusedContext || '').slice(0, 80000),
          context: (currentWorkflow.context || []).slice(-8).map((c) => ({
            step: c.step,
            agent: c.agent,
            output: String(c.output || '').slice(0, 18000),
            handoffs: (c.handoffs || []).slice(0, 6).map((h) => ({
              agent: h.agent,
              output: String(h.output || '').slice(0, 1500),
            })),
          })),
          stepMessages: (currentWorkflow.stepMessages || []).slice(-12).map((m) => ({
            role: m.role,
            content: String(m.content || '').slice(0, 8000),
          })),
        }
      : null,
    pendingWorkflow: pendingWorkflow || null,
    uploadedFile: uploadedFile
      ? (() => {
          const extractedText = String(uploadedFile.extractedText || '').slice(0, 40000);
          const visionExtract = String(uploadedFile.visionExtract || '').slice(0, 20000);
          const structuredExtract = String(uploadedFile.structuredExtract || '').slice(0, 15000);
          const captured = compactCapturedContext(uploadedFile.capturedContext);
          const rec = {
            name: uploadedFile.name,
            fileType: uploadedFile.fileType,
          };
          if (uploadedFile.storagePath) rec.storagePath = uploadedFile.storagePath;
          if (uploadedFile.storageBucket && uploadedFile.storagePath) rec.storageBucket = uploadedFile.storageBucket;
          if (!isEmptyContextValue(extractedText)) rec.extractedText = extractedText;
          if (!isEmptyContextValue(visionExtract)) rec.visionExtract = visionExtract;
          if (!isEmptyContextValue(structuredExtract)) rec.structuredExtract = structuredExtract;
          if (uploadedFile.imageCount) rec.imageCount = uploadedFile.imageCount;
          if (captured) rec.capturedContext = captured;
          return rec;
        })()
      : null,
  };
}

function normalizeStoredChats(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && c.id && Array.isArray(c.messages))
    .slice(0, MAX_STORED_CHATS)
    .map((c) => ({
      ...c,
      title: c.title || deriveChatTitle(c.messages),
      updatedAt: c.updatedAt || new Date().toISOString(),
      module: c.module || inferChatModule(c),
    }));
}

function extractChatsFromDocument(parsed) {
  if (!parsed || typeof parsed !== 'object') return { chats: [], activeChatId: null };
  const chats = normalizeStoredChats(parsed.chats || parsed.settings?.chats);
  const activeChatId = parsed.activeChatId || parsed.settings?.activeChatId || null;
  return { chats, activeChatId };
}

function consultationWelcome() {
  try {
    const text = readLocalProductIntelligence()?.welcomeMessages?.consultation;
    return { role: 'assistant', content: text || 'How can I help?' };
  } catch {
    return { role: 'assistant', content: 'How can I help?' };
  }
}

function formatChatTime(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function buildPptxConversationContext(messageList, { maxMessages = 30, maxCharsPerMsg = 1800 } = {}) {
  return (messageList || [])
    .filter(m => ['user', 'assistant', 'orchestrator'].includes(m.role) && m.content)
    .slice(-maxMessages)
    .map(m => `${m.role}: ${String(m.content).substring(0, maxCharsPerMsg)}`)
    .join('\n\n');
}

function parsePptxSlidePayload(raw, fallbackTitle) {
  const cleaned = String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const tryBuild = (parsed) => {
    if (!parsed) return null;
    if (Array.isArray(parsed)) return { title: fallbackTitle, subtitle: '', slides: parsed };
    if (Array.isArray(parsed.slides)) return { title: parsed.title || fallbackTitle, subtitle: parsed.subtitle || '', slides: parsed.slides };
    const key = Object.keys(parsed).find(k => Array.isArray(parsed[k]) && parsed[k][0]?.type);
    if (key) return { title: parsed.title || fallbackTitle, subtitle: parsed.subtitle || '', slides: parsed[key] };
    return null;
  };

  let slideData = tryBuild(safeJsonParse(cleaned)) || tryBuild(extractJsonObject(cleaned));
  if (slideData?.slides?.length) return slideData;

  // Truncation repair: close the last complete slide object.
  const lastObj = cleaned.lastIndexOf('},');
  const lastArr = cleaned.lastIndexOf('}]');
  const cut = Math.max(lastObj, lastArr);
  if (cut > 100) {
    const repaired = cleaned.substring(0, cut + 1) + (cleaned.includes('"slides"') ? ']}' : ']');
    slideData = tryBuild(safeJsonParse(repaired)) || tryBuild(extractJsonObject(repaired));
    if (slideData?.slides?.length) return slideData;
  }
  return null;
}

/** Ensure produced IC decks include a dense one-pager slide (slide 2). */
function ensureIcOnePagerSlide(slideData, { force = false } = {}) {
  if (!slideData || !Array.isArray(slideData.slides) || !slideData.slides.length) return slideData;
  const slides = [...slideData.slides];
  const hasOnePager = slides.some((s) => {
    const layout = String(s?.layout || '').toLowerCase();
    const type = String(s?.type || '').toLowerCase();
    return layout === 'one_pager' || type === 'one_pager' || type === 'one-pager' || /one[\s-]?pager/i.test(String(s?.title || ''));
  });
  if (hasOnePager) {
    // Normalize existing one-pager to layout one_pager
    return {
      ...slideData,
      slides: slides.map((s) => {
        const layout = String(s?.layout || '').toLowerCase();
        const type = String(s?.type || '').toLowerCase();
        if (layout === 'one_pager' || type === 'one_pager' || type === 'one-pager' || /one[\s-]?pager/i.test(String(s?.title || ''))) {
          return { ...s, layout: 'one_pager', type: s.type || 'one_pager' };
        }
        return s;
      }),
    };
  }
  if (!force) return slideData;

  // Build from the richest table + bullets already in the deck
  const withTable = slides.find((s) => s?.tableData?.headers?.length && s?.tableData?.rows?.length);
  const withRules = slides.find((s) => (s?.bulletsRight?.length || s?.bullets?.length) && s !== withTable);
  const purposeSlide = slides.find((s) => s?.body && String(s.body).length > 20) || slides[1] || slides[0];
  const onePager = {
    type: 'one_pager',
    layout: 'one_pager',
    title: 'IC Scheme One-Pager',
    subtitle: 'Scheme at a glance',
    body: purposeSlide?.body || purposeSlide?.subtitle || 'Incentive scheme overview from this conversation.',
    tableData: withTable?.tableData || {
      headers: ['Component', 'Weight', 'Metric'],
      rows: (withTable?.bullets || slides.flatMap((s) => s.bullets || [])).slice(0, 5).map((b) => {
        const parts = String(b).split(':');
        return parts.length > 1 ? [parts[0].trim(), '', parts.slice(1).join(':').trim()] : [String(b), '', ''];
      }),
    },
    bulletsRight: withRules?.bulletsRight?.length
      ? withRules.bulletsRight
      : (withRules?.bullets || []).slice(0, 5),
    payout: slides.find((s) => /payout|attainment|mechanics/i.test(String(s?.title || '')))?.body || '',
    payoutBullets: slides.find((s) => /payout|attainment|mechanics/i.test(String(s?.title || '')))?.bullets?.slice(0, 4) || [],
  };

  const insertAt = String(slides[0]?.layout || slides[0]?.type || '').toLowerCase() === 'title' ? 1 : 0;
  slides.splice(insertAt, 0, onePager);
  return { ...slideData, slides };
}

/** Detect numbered 1–9 closed choices (not open clarifying questions). */
function extractChoiceOptions(text) {
  if (!text) return null;
  const opts = [];
  const lines = String(text).split(/\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(?:\*\*)?([1-9])(?:\*\*)?\s*[.:)\]]\s+(?:\*\*)?(.+?)(?:\*\*)?\s*$/);
    if (!m) continue;
    let label = m[2].replace(/\*\*/g, '').replace(/\s*—\s*.*$/, '').trim();
    if (label.length > 72) label = `${label.slice(0, 69)}…`;
    opts.push({ value: m[1], label: `${m[1]}. ${label}`, asks: /\?/.test(label) });
  }
  const seen = new Set();
  const unique = opts.filter((o) => (seen.has(o.value) ? false : (seen.add(o.value), true)));
  if (unique.length < 1 || unique.length > 9) return null;
  // Open clarifying questions (1. What is…?) are NOT clickable choices — user types 1 = …
  if (unique.filter((o) => o.asks).length >= Math.ceil(unique.length / 2)) return null;
  return unique.map(({ value, label }) => ({ value, label }));
}

/** True when the assistant asked numbered clarifying questions the user must answer themselves. */
function hasNumberedClarifyingQuestions(text) {
  if (!text) return false;
  const numberedQs = [...String(text).matchAll(/(?:^|\n)\s*(?:\*\*)?([1-9])(?:\*\*)?\s*[.:)\]]\s+.+\?/gm)];
  return numberedQs.length >= 1;
}

/** Format user preferences into a system-prompt block that all LLMs/agents must respect. */
function buildUserSettingsPromptBlock(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const lines = [];
  const push = (label, value) => {
    if (isEmptyContextValue(value)) return;
    lines.push(`- ${label}: ${String(value).trim()}`);
  };
  push('Company', s.companyName);
  push('Industry / therapeutic area', s.industry);
  push('User role', s.role);
  push('Preferred currency / units', s.currency);
  push('Company metrics & definitions', s.metrics);
  push('Abbreviations & terminology', s.abbreviations);
  push('Preferences', s.preferences);
  push('Hard constraints', s.constraints);
  const extra = isEmptyContextValue(s.customContext) ? '' : String(s.customContext).trim();
  const memoryBlock = formatMemoryPromptBlock(s);
  const lengthBlock = formatResponseLengthPrompt(s);
  const identity = `${lines.join('\n')}${extra ? `\n\nAdditional context from the user:\n${extra}` : ''}${memoryBlock}`;
  return `\n\nUSER SETTINGS (mandatory — always respect these preferences, definitions, abbreviations, constraints, and response length in every response; do not contradict them):\n${identity ? `${identity}\n\n` : ''}${lengthBlock}\n`;
}

const MEMORY_CAP = 30;
const MEMORY_TEXT_MAX = 280;

function normalizeMemoryItems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const text = String(item?.text || (typeof item === 'string' ? item : ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MEMORY_TEXT_MAX);
    if (!text || text.length < 12 || isEmptyContextValue(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: String(item?.id || `mem_${out.length + 1}`),
      text,
      module: ['incentives', 'territory', 'stella'].includes(item?.module) ? item.module : '',
      updatedAt: item?.updatedAt || new Date().toISOString(),
    });
    if (out.length >= MEMORY_CAP) break;
  }
  return out;
}

function mergeMemoryFacts(existing, incoming, { module = '' } = {}) {
  const base = normalizeMemoryItems(existing);
  const now = new Date().toISOString();
  for (const raw of incoming || []) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_TEXT_MAX);
    if (text.length < 12 || isEmptyContextValue(text)) continue;
    const key = text.toLowerCase();
    const dup = base.findIndex((m) => {
      const t = m.text.toLowerCase();
      return t === key || t.includes(key) || key.includes(t);
    });
    if (dup >= 0) {
      base[dup] = {
        ...base[dup],
        text: text.length >= base[dup].text.length ? text : base[dup].text,
        module: module || base[dup].module,
        updatedAt: now,
      };
      continue;
    }
    base.unshift({
      id: `mem_${Date.now()}_${stellaNanoId(4)}`,
      text,
      module,
      updatedAt: now,
    });
  }
  return normalizeMemoryItems(base).slice(0, MEMORY_CAP);
}

function formatMemoryPromptBlock(settings) {
  const items = normalizeMemoryItems(settings?.memory);
  if (!items.length) return '';
  let body = items.map((m) => `- ${m.text}`).join('\n');
  if (body.length > 3500) body = `${body.slice(0, 3500)}\n- [… older remembered facts omitted …]`;
  return `\n\nREMEMBERED FROM PRIOR CHATS (facts the user already confirmed — clarifying answers, plan rules, definitions. Use them. Do not re-ask unless the user contradicts them):\n${body}`;
}

function shouldHarvestChatMemory(_assistantText, userText) {
  const user = String(userText || '').trim();
  if (user.length < 8) return false;
  if (/^(y|yes|yeah|yep|sure|ok|okay|start|go|continue|proceed|no|cancel|thanks|thank you)[\s.!]*$/i.test(user)) return false;
  return true;
}

// Short, URL/identifier-safe random id (used for stella_data_<id> tables).
function stellaNanoId(len = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const rand = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? crypto.getRandomValues(new Uint32Array(len))
    : null;
  for (let i = 0; i < len; i++) {
    const n = rand ? rand[i] : Math.floor(Math.random() * chars.length);
    out += chars[n % chars.length];
  }
  return out;
}

// Turn an arbitrary header into a safe, unique snake_case Postgres identifier.
function stellaSafeColumnName(name, index, used) {
  let base = String(name == null ? '' : name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base || /^[0-9]/.test(base)) base = `col_${base || index + 1}`;
  base = base.slice(0, 55);
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}_${n++}`;
  used.add(candidate);
  return candidate;
}

function stellaInferColumnType(values) {
  let seen = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    seen += 1;
    const num = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
    if (!Number.isFinite(num)) return 'text';
  }
  return seen > 0 ? 'numeric' : 'text';
}

function stellaCoerceValue(v, type) {
  if (v === null || v === undefined || v === '') return null;
  if (type === 'numeric') {
    const num = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(num) ? num : null;
  }
  return typeof v === 'string' ? v : String(v);
}

// Given an array of plain-object records, build typed columns + normalized rows.
function stellaBuildTabularPayload(records) {
  const clean = (records || []).filter(r => r && typeof r === 'object' && !Array.isArray(r));
  const originalCols = [];
  const seenCols = new Set();
  for (const r of clean) {
    for (const k of Object.keys(r)) {
      if (!seenCols.has(k)) { seenCols.add(k); originalCols.push(k); }
    }
  }
  const used = new Set();
  const columns = originalCols.map((orig, i) => {
    const values = clean.map(r => r[orig]);
    return { original: orig, name: stellaSafeColumnName(orig, i, used), type: stellaInferColumnType(values), description: '' };
  });
  const rows = clean.map(r => {
    const row = {};
    for (const c of columns) row[c.name] = stellaCoerceValue(r[c.original], c.type);
    return row;
  });
  return { columns, rows, rowCount: rows.length };
}

// Extract text from a PDF in the browser (best-effort). Accepts File or Blob.
async function stellaExtractPdfText(fileOrBlob) {
  const pdfjs = await import('pdfjs-dist');
  try { pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl; } catch { /* ignore */ }
  const buf = await fileOrBlob.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const maxPages = Math.min(doc.numPages, 120);
  let text = '';
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map(it => (it.str || '')).join(' ') + '\n';
    if (text.length > 250000) break;
  }
  return text.trim();
}

/** Extract readable text from a .pptx (slide XML <a:t> runs). */
async function extractPptxPlainText(fileOrBlob) {
  const zip = await JSZip.loadAsync(await fileOrBlob.arrayBuffer());
  const slidePaths = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/i)?.[1] || '0', 10);
      const nb = parseInt(b.match(/slide(\d+)/i)?.[1] || '0', 10);
      return na - nb;
    });
  const parts = [];
  for (const path of slidePaths) {
    const xml = await zip.file(path).async('text');
    const runs = [...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([^<]*)<\/(?:\w+:)?t>/g)].map((m) => m[1]);
    const slideText = runs.join(' ').replace(/\s+/g, ' ').trim();
    if (slideText) {
      const num = path.match(/slide(\d+)/i)?.[1] || String(parts.length + 1);
      parts.push(`--- Slide ${num} ---\n${slideText}`);
    }
  }
  return parts.join('\n\n').trim();
}

async function extractProposalText(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.pdf') || file?.type?.includes('pdf')) {
    return stellaExtractPdfText(file);
  }
  if (name.endsWith('.pptx') || file?.type?.includes('presentation')) {
    return extractPptxPlainText(file);
  }
  if (name.endsWith('.ppt')) {
    throw new Error('Legacy .ppt is not supported — please upload .pptx, PDF, or Excel.');
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv') || file?.type?.includes('spreadsheet') || file?.type?.includes('excel') || file?.type?.includes('csv')) {
    return extractSpreadsheetText(file);
  }
  // Plain text fallback
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').trim());
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

function uint8ToBase64(buf) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function rasterMediaType(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
}

const VISION_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Downscale to JPEG so vision requests stay under Vercel body limits and do not hang. */
async function shrinkProposalImageForVision(img, { maxSide = 1280, quality = 0.72 } = {}) {
  if (!img?.base64) return null;
  const rawType = String(img.mediaType || 'image/png').toLowerCase();
  const inType = VISION_MEDIA_TYPES.has(rawType) ? rawType : 'image/png';
  try {
    const binary = atob(img.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: inType });
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width || maxSide, bitmap.height || maxSide));
    const w = Math.max(1, Math.round((bitmap.width || maxSide) * scale));
    const h = Math.max(1, Math.round((bitmap.height || maxSide) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return VISION_MEDIA_TYPES.has(rawType) ? { ...img, mediaType: inType } : null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const b64 = dataUrl.split(',')[1];
    if (!b64) return VISION_MEDIA_TYPES.has(rawType) ? { ...img, mediaType: inType } : null;
    return {
      ...img,
      mediaType: 'image/jpeg',
      base64: b64,
      bytes: Math.round(b64.length * 0.75),
    };
  } catch {
    return VISION_MEDIA_TYPES.has(rawType) ? { ...img, mediaType: inType } : null;
  }
}

function readRasterDimensions(buf, mediaType) {
  if (!buf || buf.length < 24) return null;
  if (mediaType === 'image/png' || (buf[0] === 0x89 && buf[1] === 0x50)) {
    const w = ((buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19]) >>> 0;
    const h = ((buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23]) >>> 0;
    if (w > 0 && h > 0 && w < 30000 && h < 30000) return { width: w, height: h };
  }
  if (mediaType === 'image/jpeg' || (buf[0] === 0xff && buf[1] === 0xd8)) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        const h = (buf[i + 5] << 8) | buf[i + 6];
        const w = (buf[i + 7] << 8) | buf[i + 8];
        if (w > 0 && h > 0) return { width: w, height: h };
        break;
      }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      i += 2 + Math.max(len, 2);
    }
  }
  return null;
}

/** Map media filename → slide placement hints (size, master vs content). */
async function buildPptxImageUsageMap(zip) {
  const usage = {};
  const partPaths = [
    ...Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n)),
    ...Object.keys(zip.files).filter((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/i.test(n)),
    ...Object.keys(zip.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i.test(n)),
  ];
  for (const partPath of partPaths) {
    const onMaster = /slideMasters|slideLayouts/i.test(partPath);
    const relsPath = partPath.replace(/^(ppt\/[^/]+)\/([^/]+)$/, '$1/_rels/$2.rels');
    const rels = {};
    try {
      const relsXml = await zip.file(relsPath).async('text');
      for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
        rels[m[1]] = m[2].replace(/^\.\.\//, 'ppt/');
      }
    } catch { /* no rels */ }
    try {
      const xml = await zip.file(partPath).async('text');
      for (const block of xml.matchAll(/<p:pic[\s\S]*?<\/p:pic>/gi)) {
        const pic = block[0];
        const rId = pic.match(/r:embed="([^"]+)"/i)?.[1];
        if (!rId || !rels[rId]) continue;
        const name = rels[rId].split('/').pop();
        const cx = parseInt(pic.match(/<a:ext[^>]*cx="(\d+)"/i)?.[1] || '0', 10);
        const cy = parseInt(pic.match(/<a:ext[^>]*cy="(\d+)"/i)?.[1] || '0', 10);
        const x = parseInt(pic.match(/<a:off[^>]*x="(-?\d+)"/i)?.[1] || '0', 10);
        const y = parseInt(pic.match(/<a:off[^>]*y="(-?\d+)"/i)?.[1] || '0', 10);
        if (!usage[name]) usage[name] = { placements: [], onMaster: false };
        if (onMaster) usage[name].onMaster = true;
        usage[name].placements.push({ cx, cy, x, y, part: partPath });
      }
    } catch { /* ignore part */ }
  }
  return usage;
}

const SLIDE_EMU_W = 12192000;
const SLIDE_EMU_H = 6858000;
const SLIDE_EMU_AREA = SLIDE_EMU_W * SLIDE_EMU_H;

function heuristicImagePurpose(img, usageEntry) {
  const dims = img.dimensions;
  const pxArea = dims ? dims.width * dims.height : 0;

  if (pxArea > 0 && pxArea < 100 * 100 && img.bytes < 20000) {
    return { purpose: 'icon', relevant: false, reason: 'Tiny pixel dimensions — icon or bullet art' };
  }

  const placements = usageEntry?.placements || [];
  if (placements.length) {
    const p = placements.reduce((best, cur) => ((cur.cx * cur.cy) > (best.cx * best.cy) ? cur : best), placements[0]);
    const areaRatio = (p.cx * p.cy) / SLIDE_EMU_AREA;
    const maxSide = Math.max(p.cx, p.cy);
    const minSide = Math.min(p.cx, p.cy);

    const isConvertedVector = /^(emf|wmf|svg)$/i.test(img.sourceFormat || img.convertedFrom || '');

    if (areaRatio > 0.82) {
      // Full-slide pasted payout scales / Excel screenshots look like "backgrounds" by size.
      // Only skip true master chrome; send content-slide full images to the classifier.
      if (usageEntry.onMaster && !isConvertedVector && img.bytes < 80000) {
        return { purpose: 'decorative', relevant: false, reason: 'Full-slide master graphic — likely theme background' };
      }
      return null;
    }
    if (usageEntry.onMaster && areaRatio > 0.25 && !isConvertedVector && img.bytes < 40000) {
      return { purpose: 'decorative', relevant: false, reason: 'Large image on slide master/layout — theme decoration' };
    }
    if (areaRatio < 0.025 && img.bytes < 60000 && maxSide < 1200000) {
      return { purpose: 'logo', relevant: false, reason: 'Small header/corner placement — likely logo or badge' };
    }
    if (areaRatio < 0.012 && minSide < 400000) {
      return { purpose: 'logo', relevant: false, reason: 'Very small on-slide footprint — logo/icon' };
    }
  } else if (img.bytes < 6000) {
    return { purpose: 'icon', relevant: false, reason: 'Small embedded asset with no meaningful slide footprint' };
  }

  // Large size alone is NOT proof of scheme content (stock photos are often large).
  // Always send ambiguous images to the vision classifier.
  return null;
}

const SCHEME_IMAGE_PURPOSES = new Set([
  'payment_scale', 'table', 'chart', 'scheme_diagram', 'scheme_content',
  'eligibility', 'process', 'comms', 'governance', 'timeline', 'org_chart', 'other_ic',
  'strategy', 'products', 'map', 'diagram', 'org',
]);
const IGNORE_IMAGE_PURPOSES = new Set(['logo', 'decorative', 'stock_photo', 'icon']);

function normalizeImageClassification(row, fallbackName) {
  const purpose = String(row?.purpose || 'other').toLowerCase().replace(/\s+/g, '_');
  const rawRel = row?.relevant;
  const reason = String(row?.reason || '').trim();
  const unsureFlag = rawRel === 'unsure' || rawRel === 'maybe' || row?.unsure === true
    || String(row?.confidence || '').toLowerCase() === 'low';

  if (IGNORE_IMAGE_PURPOSES.has(purpose) && !unsureFlag && rawRel !== true) {
    return { purpose, relevant: false, unsure: false, reason: reason || 'Not scheme-relevant', name: fallbackName };
  }
  if (SCHEME_IMAGE_PURPOSES.has(purpose) || rawRel === true) {
    return { purpose, relevant: true, unsure: false, reason: reason || 'Scheme content', name: fallbackName };
  }
  if (unsureFlag || purpose === 'other' || rawRel == null) {
    return {
      purpose: purpose === 'other' ? 'other_ic' : purpose,
      relevant: false,
      unsure: true,
      reason: reason || 'Unclear — confirm with user',
      name: fallbackName,
    };
  }
  return { purpose, relevant: false, unsure: false, reason: reason || 'Not scheme-relevant', name: fallbackName };
}

function parseJsonArrayFromModel(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Classify proposal images by purpose; filter out logos, decoration, icons.
 * Returns images to send to full vision extract plus ignored inventory for chat previews.
 */
async function filterProposalImagesByPurpose(images, classifyPrompt, usageMap = {}) {
  if (!images?.length) return { relevant: [], unsure: [], ignored: [], classifications: [] };

  const needsVision = [];
  const decided = [];

  for (const img of images) {
    const usageEntry = usageMap[img.name];
    const heuristic = heuristicImagePurpose(img, usageEntry);
    if (heuristic) {
      decided.push({ img, purpose: heuristic.purpose, relevant: heuristic.relevant, reason: heuristic.reason });
    } else {
      needsVision.push(img);
    }
  }

  const preparedVision = [];
  for (const img of needsVision) {
    const shrunk = await shrinkProposalImageForVision(img);
    if (shrunk) preparedVision.push({ orig: img, send: shrunk });
    else {
      decided.push({
        img,
        purpose: 'other_ic',
        relevant: false,
        unsure: true,
        reason: 'Could not prepare image for classification',
      });
    }
  }

  const batchSize = 2;
  for (let i = 0; i < preparedVision.length; i += batchSize) {
    const batch = preparedVision.slice(i, i + batchSize);
    const content = [
      ...batch.map((item) => ({
        type: 'image',
        source: { type: 'base64', media_type: item.send.mediaType, data: item.send.base64 },
      })),
      {
        type: 'text',
        text: `Classify these ${batch.length} image(s). Filenames in order: ${batch.map((item) => item.orig.name).join(', ')}.

Follow the system instructions for what counts as relevant.
relevant=true when the image carries useful content the text layer would miss.
relevant=false only for logos, decoration, stock photos, icons.
relevant="unsure" if it might contain useful content but you cannot tell — the user will confirm.`,
      },
    ];
    try {
      const res = await withAbortTimeout(25000, (signal) => anthropicMessagesPost({
        system: classifyPrompt,
        messages: [{ role: 'user', content }],
        max_tokens: 1200,
        signal,
      }));
      if (!res.ok) throw new Error(`Classify ${res.status}`);
      const data = await res.json();
      const parsed = parseJsonArrayFromModel(anthropicAssistantText(data));
      const byName = Object.fromEntries(
        (Array.isArray(parsed) ? parsed : []).map((row) => [String(row.name || '').toLowerCase(), row]),
      );
      for (let bi = 0; bi < batch.length; bi++) {
        const img = batch[bi].orig;
        const row = byName[img.name.toLowerCase()]
          || byName[img.name.split('.')[0].toLowerCase()]
          || (Array.isArray(parsed) ? parsed[bi] : null);
        if (row) {
          const norm = normalizeImageClassification(row, img.name);
          const converted = /^(emf|wmf)$/i.test(img.sourceFormat || img.convertedFrom || '');
          if (!norm.relevant && !norm.unsure && converted && (img.bytes || 0) > 8000) {
            decided.push({
              img,
              purpose: 'chart',
              relevant: true,
              unsure: false,
              reason: 'Converted EMF/WMF chart — included for extract',
            });
          } else {
            decided.push({
              img,
              purpose: norm.purpose,
              relevant: norm.relevant,
              unsure: !!norm.unsure,
              reason: norm.reason,
            });
          }
        } else {
          decided.push({
            img,
            purpose: 'other_ic',
            relevant: false,
            unsure: true,
            reason: 'No classification — confirm with user',
          });
        }
      }
    } catch (err) {
      console.warn('Image purpose classification failed:', err);
      for (const item of batch) {
        const img = item.orig;
        const tiny = (img.bytes || 0) < 8000;
        decided.push({
          img,
          purpose: tiny ? 'icon' : 'other_ic',
          relevant: false,
          unsure: !tiny,
          reason: tiny ? 'Classification failed — tiny asset ignored' : 'Classification failed — confirm with user',
        });
      }
    }
  }

  const relevant = decided.filter((d) => d.relevant && !d.unsure).map((d) => d.img);
  const unsure = decided.filter((d) => d.unsure).map((d) => ({
    ...d.img,
    purpose: d.purpose,
    reason: d.reason,
    unsure: true,
  }));
  const ignored = decided.filter((d) => !d.relevant && !d.unsure).map((d) => ({
    name: d.img.name,
    bytes: d.img.bytes,
    included: false,
    reason: d.reason,
    kind: IGNORE_IMAGE_PURPOSES.has(d.purpose) ? d.purpose : 'decorative',
    purpose: d.purpose,
    src: `data:${d.img.mediaType};base64,${d.img.base64}`,
  }));

  return {
    relevant,
    unsure,
    ignored,
    classifications: decided.map((d) => ({
      name: d.img.name,
      purpose: d.purpose,
      relevant: d.relevant,
      unsure: !!d.unsure,
      reason: d.reason,
    })),
  };
}

function purposeLabel(purpose) {
  const map = {
    payment_scale: 'Payout scale',
    table: 'Table',
    chart: 'Chart',
    scheme_diagram: 'Scheme diagram',
    scheme_content: 'Scheme content',
    eligibility: 'Eligibility',
    process: 'Process',
    comms: 'Comms',
    governance: 'Governance',
    timeline: 'Timeline',
    org_chart: 'Org / roles',
    strategy: 'Strategy',
    products: 'Products',
    map: 'Map / territory',
    diagram: 'Diagram',
    other_ic: 'Possible scheme content',
    logo: 'Logo',
    decorative: 'Decorative',
    stock_photo: 'Stock photo',
    icon: 'Icon',
    other: 'Other',
    vector: 'Convert failed',
  };
  return map[purpose] || purpose || 'Unknown';
}

function buildProposalImagePreviews(included, unsure, skipped) {
  return [
    ...(included || []).map((img) => ({
      name: img.name,
      bytes: img.bytes,
      included: true,
      pending: false,
      purpose: img.purpose || 'scheme_content',
      reason: img.reason,
      sourceFormat: img.sourceFormat || img.convertedFrom || null,
      src: `data:${img.mediaType};base64,${img.base64}`,
    })),
    ...(unsure || []).map((img) => ({
      name: img.name,
      bytes: img.bytes,
      included: false,
      pending: true,
      purpose: img.purpose || 'other_ic',
      reason: img.reason,
      sourceFormat: img.sourceFormat || img.convertedFrom || null,
      src: `data:${img.mediaType};base64,${img.base64}`,
    })),
    ...(skipped || []).map((s) => ({
      name: s.name,
      bytes: s.bytes || 0,
      included: false,
      pending: false,
      reason: s.reason,
      kind: s.kind,
      purpose: s.purpose,
      src: s.src,
    })),
  ];
}

/** Pull numeric/category caches from native PowerPoint chart XML (not an image). */
function parsePptxChartXml(xml, chartName) {
  const seriesBlocks = [...String(xml).matchAll(/<c:ser\b[\s\S]*?<\/c:ser>/gi)];
  if (!seriesBlocks.length) return null;
  const lines = [`Chart: ${chartName}`];
  seriesBlocks.forEach((m, idx) => {
    const block = m[0];
    const title =
      block.match(/<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>/i)?.[1]
      || block.match(/<a:t>([^<]*)<\/a:t>/i)?.[1]
      || `Series ${idx + 1}`;
    const catBlock = block.match(/<c:cat>[\s\S]*?<\/c:cat>/i)?.[0] || '';
    const valBlock = block.match(/<c:val>[\s\S]*?<\/c:val>/i)?.[0] || '';
    const cats = [...catBlock.matchAll(/<c:v>([^<]*)<\/c:v>/gi)].map((x) => x[1].trim()).filter(Boolean);
    const vals = [...valBlock.matchAll(/<c:v>([^<]*)<\/c:v>/gi)].map((x) => x[1].trim()).filter(Boolean);
    if (!vals.length && !cats.length) return;
    lines.push(`  ${title}:`);
    const n = Math.max(cats.length, vals.length);
    for (let i = 0; i < n; i++) {
      lines.push(`    ${cats[i] || `pt${i + 1}`}: ${vals[i] ?? '—'}`);
    }
  });
  return lines.length > 1 ? lines.join('\n') : null;
}

/** Native charts + embedded Excel workbooks inside a .pptx (payment scales often live here, not as PNGs). */
async function extractPptxStructuredExtras(zip) {
  const notes = [];
  const parts = [];

  const chartPaths = Object.keys(zip.files)
    .filter((n) => /^ppt\/charts\/chart\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/chart(\d+)/i)?.[1] || '0', 10);
      const nb = parseInt(b.match(/chart(\d+)/i)?.[1] || '0', 10);
      return na - nb;
    });
  for (const path of chartPaths) {
    try {
      const xml = await zip.file(path).async('text');
      const parsed = parsePptxChartXml(xml, path.split('/').pop());
      if (parsed) parts.push(parsed);
    } catch { /* ignore one chart */ }
  }
  if (chartPaths.length) {
    notes.push(parts.length
      ? `Parsed ${parts.length} native PowerPoint chart(s) for numeric series.`
      : `Found ${chartPaths.length} chart XML file(s) but no readable series caches.`);
  }

  const embPaths = Object.keys(zip.files).filter((n) =>
    /^ppt\/embeddings\//i.test(n) && /\.xlsx?$/i.test(n) && !zip.files[n].dir,
  );
  if (embPaths.length) {
    try {
      const xlsxMod = await import('xlsx');
      const XLSX = xlsxMod?.default || xlsxMod;
      for (const path of embPaths.slice(0, 4)) {
        const buf = await zip.file(path).async('arraybuffer');
        const wb = XLSX.read(buf, { type: 'array' });
        const sheetName = wb.SheetNames?.[0];
        if (!sheetName) continue;
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
        const preview = rows.slice(0, 40).map((r) => (Array.isArray(r) ? r.join('\t') : String(r))).join('\n');
        if (preview.trim()) {
          parts.push(`Embedded workbook ${path.split('/').pop()} (sheet "${sheetName}"):\n${preview}`);
        }
      }
      notes.push(`Read ${Math.min(embPaths.length, 4)} embedded Excel workbook(s) from the deck.`);
    } catch (err) {
      notes.push(`Embedded Excel found but could not be parsed (${err.message || 'xlsx error'}).`);
    }
  }

  return { text: parts.join('\n\n').trim(), notes };
}

function dataUrlToProposalImage(dataUrl, name, { sourceFormat = null } = {}) {
  const m = String(dataUrl || '').match(/^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i);
  if (!m) return null;
  const mediaType = m[1].toLowerCase();
  const base64 = m[2];
  const bytes = Math.round(base64.length * 0.75);
  // Decode a few header bytes for dimensions when possible
  let dimensions = null;
  try {
    const head = Uint8Array.from(atob(base64.slice(0, 64)), (c) => c.charCodeAt(0));
    dimensions = readRasterDimensions(head, mediaType);
  } catch { /* ignore */ }
  return {
    name,
    mediaType,
    base64,
    bytes,
    dimensions,
    sourceFormat,
    convertedFrom: sourceFormat,
  };
}

/** Rasterise SVG → PNG via browser Image + canvas (vision cannot ingest SVG). */
async function convertSvgToPngDataUrl(svgTextOrBuf, { maxSide = 1600 } = {}) {
  let svgText = typeof svgTextOrBuf === 'string'
    ? svgTextOrBuf
    : new TextDecoder('utf-8').decode(svgTextOrBuf);
  if (!/<svg[\s>]/i.test(svgText)) return null;
  if (!svgText.includes('xmlns')) {
    svgText = svgText.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('SVG decode failed'));
      el.src = objectUrl;
    });
    let w = img.naturalWidth || img.width || 800;
    let h = img.naturalHeight || img.height || 600;
    if (!w || !h) { w = 800; h = 600; }
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Convert EMF/WMF/SVG media bytes to a PNG proposal image for vision. */
async function convertVectorMediaToPng(path, buf) {
  const name = path.split('/').pop();
  const ext = name.split('.').pop().toLowerCase();
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  if (ext === 'svg') {
    const dataUrl = await convertSvgToPngDataUrl(buf);
    if (!dataUrl) return null;
    return dataUrlToProposalImage(dataUrl, name, { sourceFormat: 'svg' });
  }

  if (ext === 'emf' || ext === 'wmf') {
    const mod = await import('emf-converter');
    const convert = ext === 'wmf'
      ? (mod.convertWmfToDataUrl || mod.default?.convertWmfToDataUrl)
      : (mod.convertEmfToDataUrl || mod.default?.convertEmfToDataUrl);
    if (!convert) return null;
    const dataUrl = await convert(ab, { maxWidth: 1600, maxHeight: 1600, dpiScale: 2 });
    if (!dataUrl) return null;
    return dataUrlToProposalImage(dataUrl, name, { sourceFormat: ext });
  }

  return null;
}

/**
 * Extract embedded images from a .pptx (pasted Excel tables, charts, screenshots).
 * Prefers the largest rasters (payment scales are usually big screenshots, not tiny icons).
 * EMF/WMF/SVG are rasterised to PNG so vision can read them.
 * Also inventories skipped media so the chat can show what was NOT sent to vision.
 */
async function extractPptxEmbeddedImages(fileOrBlob, { maxImages = 24, minBytes = 1200 } = {}) {
  const zip = await JSZip.loadAsync(await fileOrBlob.arrayBuffer());
  const usageMap = await buildPptxImageUsageMap(zip);
  const mediaPaths = Object.keys(zip.files).filter((n) => /^ppt\/media\//i.test(n) && !zip.files[n].dir);
  const vectorPaths = mediaPaths.filter((n) => /\.(emf|wmf|svg)$/i.test(n));
  const rasterPaths = mediaPaths.filter((n) => /\.(png|jpe?g|gif|webp)$/i.test(n));
  const otherPaths = mediaPaths.filter((n) => !vectorPaths.includes(n) && !rasterPaths.includes(n));

  const skipped = [];
  for (const path of otherPaths) {
    skipped.push({
      name: path.split('/').pop(),
      bytes: 0,
      reason: 'Unsupported media type for vision',
      kind: 'other',
    });
  }

  const candidates = [];
  for (const path of rasterPaths) {
    const entry = zip.file(path);
    if (!entry) continue;
    const buf = await entry.async('uint8array');
    if (!buf) continue;
    const mediaType = rasterMediaType(path);
    if (buf.byteLength < minBytes) {
      skipped.push({
        name: path.split('/').pop(),
        bytes: buf.byteLength,
        reason: `Too small (< ${minBytes} B) — treated as icon/decoration`,
        kind: 'tiny',
      });
      continue;
    }
    candidates.push({
      name: path.split('/').pop(),
      mediaType,
      base64: uint8ToBase64(buf),
      bytes: buf.byteLength,
      dimensions: readRasterDimensions(buf, mediaType),
    });
  }

  let vectorConverted = 0;
  let vectorFailed = 0;
  for (const path of vectorPaths) {
    const entry = zip.file(path);
    if (!entry) continue;
    const buf = await entry.async('uint8array');
    if (!buf) continue;
    const name = path.split('/').pop();
    try {
      const converted = await convertVectorMediaToPng(path, buf);
      if (converted && converted.base64) {
        candidates.push(converted);
        vectorConverted += 1;
      } else {
        vectorFailed += 1;
        skipped.push({
          name,
          bytes: buf.byteLength,
          reason: 'Could not rasterise EMF/WMF/SVG for vision',
          kind: 'vector',
        });
      }
    } catch (err) {
      console.warn('Vector convert failed:', name, err);
      vectorFailed += 1;
      skipped.push({
        name,
        bytes: buf.byteLength,
        reason: `Vector convert failed: ${err.message || 'error'}`,
        kind: 'vector',
      });
    }
  }

  candidates.sort((a, b) => b.bytes - a.bytes);

  const structured = await extractPptxStructuredExtras(zip);

  const notes = [...(structured.notes || [])];
  if (vectorConverted) {
    notes.push(`Rasterised ${vectorConverted} EMF/WMF/SVG graphic(s) to PNG for vision.`);
  }
  if (vectorFailed) {
    notes.push(`${vectorFailed} vector graphic(s) could not be converted — try exporting the slide as PDF.`);
  }
  if (candidates.length === 0 && rasterPaths.length === 0 && vectorPaths.length === 0 && mediaPaths.length === 0) {
    notes.push('No embedded images found in the PowerPoint media folder.');
  } else if (candidates.length === 0 && (rasterPaths.length > 0 || vectorPaths.length > 0)) {
    notes.push('Embedded graphics were too small or failed conversion — none sent to vision.');
  } else if (candidates.length) {
    notes.push(`Found ${candidates.length} image(s) after raster conversion; classifying purpose before vision read.`);
  }

  return { candidates, skipped, notes, structuredText: structured.text || '', usageMap };
}

/** Render PDF pages to JPEG for vision (tables/charts that aren't in the text layer). */
async function extractPdfPageImages(fileOrBlob, { maxPages = 12, scale = 1.5 } = {}) {
  const pdfjs = await import('pdfjs-dist');
  try { pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl; } catch { /* ignore */ }
  const buf = await fileOrBlob.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const limit = Math.min(doc.numPages, maxPages);
  const out = [];
  const skipped = [];
  for (let p = 1; p <= limit; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1];
    if (base64) {
      out.push({
        name: `page-${p}.jpg`,
        mediaType: 'image/jpeg',
        base64,
        bytes: Math.round(base64.length * 0.75),
      });
    }
  }
  for (let p = limit + 1; p <= doc.numPages; p++) {
    skipped.push({ name: `page-${p}`, bytes: 0, reason: `Beyond first ${maxPages} pages rendered for vision`, kind: 'capped' });
  }
  const notes = out.length
    ? [`Rendered ${out.length} of ${doc.numPages} PDF page(s); classifying purpose before vision read.`]
    : ['PDF page render produced no images.'];
  return { candidates: out, skipped, notes, structuredText: '', usageMap: {} };
}

async function finalizeProposalImages(extracted, classifyPrompt, { maxImages = 24 } = {}) {
  const candidates = extracted.candidates || extracted.images || [];
  const skipped = [...(extracted.skipped || [])];
  const usageMap = extracted.usageMap || {};

  const { relevant, unsure = [], ignored, classifications } = await filterProposalImagesByPurpose(
    candidates,
    classifyPrompt,
    usageMap,
  );

  const classByName = Object.fromEntries(classifications.map((c) => [c.name, c]));
  const images = relevant.slice(0, maxImages);
  for (const img of relevant.slice(maxImages)) {
    skipped.push({
      name: img.name,
      bytes: img.bytes,
      reason: `Relevant but beyond ${maxImages}-image extract limit`,
      kind: 'capped',
      purpose: classByName[img.name]?.purpose,
    });
  }

  return {
    images,
    unsure,
    skipped: [...skipped, ...ignored],
    classifications,
    notes: extracted.notes || [],
    structuredText: extracted.structuredText || '',
  };
}

async function extractProposalImages(file, { textLength = 0 } = {}) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.pdf') || file?.type?.includes('pdf')) {
    const maxPages = textLength < 400 ? 14 : textLength < 2000 ? 10 : 8;
    return extractPdfPageImages(file, { maxPages, scale: textLength < 400 ? 1.6 : 1.4 });
  }
  if (name.endsWith('.pptx') || file?.type?.includes('presentation')) {
    return extractPptxEmbeddedImages(file);
  }
  return { candidates: [], skipped: [], notes: [], structuredText: '', usageMap: {} };
}

/**
 * Send proposal images to the vision model (prompt from workflowRuntime.proposalImageInterpretPrompt).
 * Shrinks, sends one at a time, and times out so large decks cannot stall Assess IC.
 */
async function interpretProposalImages(images, systemPrompt, { onProgress, maxImages = 8 } = {}) {
  if (!images?.length) return '';
  const prepared = [];
  for (const img of images.slice(0, maxImages)) {
    const shrunk = await shrinkProposalImageForVision(img);
    if (shrunk) prepared.push({ name: img.name || shrunk.name, ...shrunk });
  }
  const parts = [];
  for (let i = 0; i < prepared.length; i++) {
    const img = prepared[i];
    onProgress?.(i + 1, prepared.length, img.name);
    try {
      const res = await withAbortTimeout(25000, (signal) => anthropicMessagesPost({
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } },
            {
              type: 'text',
              text: `Extract ALL readable IC content from image "${img.name}". Capture payout scales, tables, charts, diagrams, process/eligibility/comms graphics, plus key points / message.`,
            },
          ],
        }],
        max_tokens: 2500,
        signal,
      }));
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Vision API ${res.status}: ${errText.substring(0, 180)}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || 'Vision extraction failed');
      const text = anthropicAssistantText(data)?.trim();
      if (text) parts.push(`### ${img.name}\n${text}`);
    } catch (err) {
      const why = err?.name === 'AbortError' ? 'timed out' : (err.message || 'failed');
      parts.push(`### ${img.name}\n(Could not read this image: ${why})`);
    }
  }
  if (images.length > maxImages) {
    parts.push(`(${images.length - maxImages} further image(s) skipped to keep extract moving)`);
  }
  return parts.join('\n\n').trim();
}

function stellaExtractedTextPath(storagePath) {
  return storagePath ? `${storagePath}.extracted.txt` : null;
}

// Compact, human-readable preview of query result rows for the reasoning trail.
function stellaPreviewRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 'No rows returned.';
  const preview = rows.slice(0, 5).map(r => {
    if (r && typeof r === 'object') {
      return Object.entries(r)
        .map(([k, v]) => `${k}: ${v === null || v === undefined ? '—' : v}`)
        .join('  |  ');
    }
    return String(r);
  });
  const more = rows.length > 5 ? `\n… and ${rows.length - 5} more row${rows.length - 5 === 1 ? '' : 's'}` : '';
  return preview.join('\n') + more;
}

// Observable profile of parsed tabular records: distinct counts, ranges, samples.
// Used so the intake agent doesn't ask about facts it can directly see in the data.
function stellaProfileRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return '';
  const rowCount = records.length;
  const headers = Object.keys(records[0] || {});
  const lines = [`Total rows: ${rowCount}`, `Columns (${headers.length}): ${headers.join(', ')}`, '', 'Per-column profile:'];
  for (const h of headers) {
    const values = records.map(r => r?.[h]).filter(v => v !== null && v !== undefined && v !== '');
    const distinct = new globalThis.Set(values.map(v => String(v)));
    const nums = values.map(v => Number(String(v).replace(/[,\s%£$€]/g, ''))).filter(Number.isFinite);
    const isNumeric = values.length > 0 && nums.length >= values.length * 0.8;
    if (isNumeric && nums.length) {
      const min = Math.min(...nums), max = Math.max(...nums);
      const sum = nums.reduce((a, b) => a + b, 0);
      lines.push(`- ${h} [numeric]: ${distinct.size} distinct, min ${min}, max ${max}, avg ${(sum / nums.length).toFixed(2)}`);
    } else {
      const samples = [...distinct].slice(0, 8);
      const suffix = distinct.size > samples.length ? `, e.g. ${samples.join(', ')}…` : (samples.length ? `: ${samples.join(', ')}` : '');
      lines.push(`- ${h} [categorical]: ${distinct.size} distinct value${distinct.size === 1 ? '' : 's'}${suffix}`);
    }
  }
  return lines.join('\n');
}

// Human-readable rendering of the structured context_qa JSON for prompts.
function stellaFormatContextQa(ctx) {
  if (!ctx || typeof ctx !== 'object') return '(no interpretive context captured yet)';
  const lines = [];
  if (ctx.what_it_represents) lines.push(`What it represents: ${ctx.what_it_represents}`);
  if (ctx.time_period) lines.push(`Time period: ${ctx.time_period}`);
  if (Array.isArray(ctx.key_metrics) && ctx.key_metrics.length) lines.push(`Key metrics: ${ctx.key_metrics.join(', ')}`);
  else if (ctx.key_metrics) lines.push(`Key metrics: ${ctx.key_metrics}`);
  if (ctx.interpretation_notes) lines.push(`Interpretation notes: ${ctx.interpretation_notes}`);
  if (Array.isArray(ctx.relationships) && ctx.relationships.length) {
    lines.push('Confirmed relationships to other datasets:');
    ctx.relationships.forEach(r => {
      if (!r) return;
      const target = r.related_table || r.related_file;
      if (!target) return;
      const join = (r.this_field && r.related_field) ? ` (join this.${r.this_field} = ${target}.${r.related_field})` : '';
      lines.push(`  - Relates to ${target}${join}${r.note ? ` — ${r.note}` : ''}`);
    });
  }
  if (Array.isArray(ctx.qa_pairs) && ctx.qa_pairs.length) {
    lines.push('Intake Q&A:');
    ctx.qa_pairs.forEach(qa => { if (qa && (qa.question || qa.answer)) lines.push(`  Q: ${qa.question || ''}\n  A: ${qa.answer || ''}`); });
  }
  return lines.length ? lines.join('\n') : '(no interpretive context captured yet)';
}

// Map a stella_files DB row into the local file object used by the UI.
function stellaMapRegistryRow(row) {
  const ctx = row.context_qa && typeof row.context_qa === 'object' ? row.context_qa : null;
  const qa = ctx && Array.isArray(ctx.qa_pairs) ? ctx.qa_pairs : [];
  const intakeMessages = qa.flatMap(p => [
    ...(p && p.question ? [{ role: 'assistant', content: p.question }] : []),
    ...(p && p.answer ? [{ role: 'user', content: p.answer }] : []),
  ]);
  return {
    id: row.id,
    dbId: row.id,
    name: row.file_name,
    fileType: row.file_type,
    type: row.file_type,
    tableName: row.table_name || null,
    storagePath: row.storage_path || null,
    textStoragePath: row.storage_path ? stellaExtractedTextPath(row.storage_path) : null,
    storageBucket: null,
    columns: Array.isArray(row.columns) ? row.columns : [],
    rowCount: row.row_count ?? null,
    summary: row.summary || '',
    capturedContext: ctx,
    intakeMessages,
    intakeComplete: !!ctx,
    uploadedAt: row.uploaded_at,
    size: row.row_count != null ? `${row.row_count} rows` : '',
    processing: false,
  };
}

function guessCountry(structure) {
  const name = (structure.name || '').toLowerCase();
  if (name.includes('uk') || name.includes('united kingdom') || name.includes('britain')) return 'United Kingdom';
  if (name.includes('france') || name.includes('french')) return 'France';
  if (name.includes('germany')) return 'Germany';
  if (name.includes('spain')) return 'Spain';
  if (name.includes('italy')) return 'Italy';
  const counties = structure.territories.flatMap(t => t.counties || []).join(' ').toLowerCase();
  if (counties.includes('yorkshire') || counties.includes('surrey') || counties.includes('kent') || counties.includes('fife')) return 'United Kingdom';
  return '';
}

function buildMapHTML(structure, selectedTerritoryId) {
  const country = guessCountry(structure);
  const managerIds = structure.managers.map(m => m.id);

  const territoryData = structure.territories.map(t => {
    const mgrIdx = managerIds.indexOf(t.managerId);
    const mgr = structure.managers.find(m => m.id === t.managerId);
    return {
      id: t.id,
      name: t.name,
      rep: t.rep,
      manager: mgr?.name || '',
      region: mgr?.region || '',
      managerId: t.managerId,
      mgrIdx,
      colour: MANAGER_COLOURS[mgrIdx] || '#94a3b8',
      border: MANAGER_COLOURS_BORDER[mgrIdx] || '#475569',
      counties: t.counties || [],
      hcps: t.hcps,
      total: t.hcps.A + t.hcps.B + t.hcps.C,
      selected: t.id === selectedTerritoryId,
      searchTerm: (t.counties?.[0] || t.name) + (country ? `, ${country}` : ''),
    };
  });

  const managersData = structure.managers.map((m, i) => ({
    name: m.name,
    region: m.region,
    colour: MANAGER_COLOURS[i] || '#94a3b8',
  }));

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0f172a; font-family: system-ui, sans-serif; }
    #map { width: 100%; height: 100%; }
    .legend {
      background: rgba(15,23,42,0.92);
      border: 1px solid rgba(96,165,250,0.25);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 11px;
      line-height: 1.6;
      backdrop-filter: blur(4px);
    }
    .legend-title { color: #60a5fa; font-weight: 700; font-size: 10px; letter-spacing: .05em; margin-bottom: 6px; }
    .legend-item { display: flex; align-items: center; gap: 7px; color: #cbd5e1; margin-bottom: 3px; }
    .legend-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
    .legend-sub { color: #64748b; font-size: 10px; margin-top: 6px; padding-top: 6px; border-top: 1px solid #1e293b; }
    #progress {
      position: fixed; inset: 0; background: #0f172a;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 12px; z-index: 9999;
    }
    #progress-text { color: #94a3b8; font-size: 13px; }
    #progress-bar-wrap { width: 200px; height: 5px; background: #1e293b; border-radius: 999px; overflow: hidden; }
    #progress-bar { height: 100%; background: #60a5fa; border-radius: 999px; transition: width 0.3s; width: 0%; }
    .spinner { width: 28px; height: 28px; border: 2.5px solid #1e3a5f; border-top-color: #60a5fa; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .leaflet-popup-content-wrapper { background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .leaflet-popup-content { margin: 10px 14px; }
    .popup-title { font-weight: 700; font-size: 13px; color: #0f172a; margin-bottom: 4px; }
    .popup-rep { font-size: 11px; color: #475569; margin-bottom: 2px; }
    .popup-hcps { display: flex; gap: 10px; font-size: 11px; margin-top: 6px; }
    .popup-counties { font-size: 10px; color: #94a3b8; margin-top: 5px; }
  </style>
</head>
<body>
  <div id="progress">
    <div class="spinner"></div>
    <div id="progress-text">Locating territories…</div>
    <div id="progress-bar-wrap"><div id="progress-bar"></div></div>
  </div>
  <div id="map"></div>

  <script>
    const territories = ${JSON.stringify(territoryData)};
    const managers = ${JSON.stringify(managersData)};

    const map = L.map('map', { zoomControl: true });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    map.setView([54, -2], 6);

    async function geocode(query) {
      try {
        const r = await fetch(
          'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) + '&format=json&limit=1',
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'TerritoryMapApp/1.0' } }
        );
        const d = await r.json();
        return d[0] ? [parseFloat(d[0].lat), parseFloat(d[0].lon)] : null;
      } catch { return null; }
    }

    async function loadMarkers() {
      const bounds = [];
      const bar = document.getElementById('progress-bar');
      const txt = document.getElementById('progress-text');
      let done = 0;

      for (const t of territories) {
        const searchTerms = [...(t.counties.slice(0,3)), t.name].map(s => s + ', ' + '${country}');
        let coords = null;
        for (const term of searchTerms) {
          coords = await geocode(term);
          if (coords) break;
          await new Promise(r => setTimeout(r, 150));
        }

        if (coords) {
          bounds.push(coords);
          const total = t.total;
          const r = Math.max(16, Math.min(34, 10 + total / 13));
          const isSelected = t.selected;

          const icon = L.divIcon({
            className: '',
            iconSize: [r*2, r*2],
            iconAnchor: [r, r],
            html: \`<div style="
              width:\${r*2}px;height:\${r*2}px;border-radius:50%;
              background:\${isSelected ? t.colour : t.colour + '77'};
              border:\${isSelected ? 3 : 1.5}px solid \${t.border};
              display:flex;align-items:center;justify-content:center;
              box-shadow:\${isSelected ? '0 0 14px ' + t.colour + '99' : '0 2px 6px rgba(0,0,0,0.4)'};
              cursor:pointer;
            "><span style="font-size:\${r>22?9:7}px;font-weight:700;color:\${isSelected?'#fff':t.colour};text-shadow:0 1px 3px #000c;">\${t.id}</span></div>\`
          });

          const marker = L.marker(coords, { icon });
          marker.bindPopup(\`
            <div class="popup-title">\${t.id} — \${t.name}</div>
            <div class="popup-rep">Rep: \${t.rep}</div>
            <div class="popup-rep">Manager: \${t.manager} (\${t.region})</div>
            <div class="popup-hcps">
              <span style="color:#059669;font-weight:600;">A: \${t.hcps.A}</span>
              <span style="color:#2563eb;font-weight:600;">B: \${t.hcps.B}</span>
              <span style="color:#64748b;font-weight:600;">C: \${t.hcps.C}</span>
              <span style="font-weight:700;">= \${total} HCPs</span>
            </div>
            \${t.counties.length ? '<div class="popup-counties">' + t.counties.join(', ') + '</div>' : ''}
          \`, { maxWidth: 260 });

          marker.on('click', () => {
            window.parent.postMessage({ type: 'territory-select', id: t.id }, '*');
          });

          marker.addTo(map);
        }

        done++;
        const pct = Math.round(done / territories.length * 100);
        bar.style.width = pct + '%';
        txt.textContent = 'Locating territories… ' + pct + '%';
      }

      document.getElementById('progress').style.display = 'none';

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 9 });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 8);
      }

      const legend = L.control({ position: 'bottomleft' });
      legend.onAdd = () => {
        const div = L.DomUtil.create('div', 'legend');
        div.innerHTML = '<div class="legend-title">MANAGERS</div>' +
          managers.map(m => \`<div class="legend-item"><div class="legend-dot" style="background:\${m.colour}"></div><span>\${m.name} — \${m.region}</span></div>\`).join('') +
          '<div class="legend-sub">Circle size = total HCPs<br>Click marker to inspect</div>';
        return div;
      };
      legend.addTo(map);
    }

    loadMarkers();
  <\/script>
</body>
</html>`;
}

function TerritoryMap({ structure, selectedTerritory, onSelectTerritory }) {
  const iframeRef = useRef(null);
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    setIframeKey(k => k + 1);
  }, [structure?.name]);

  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'territory-select') {
        const t = structure?.territories.find(t => t.id === event.data.id);
        if (t) onSelectTerritory(selectedTerritory?.id === t.id ? null : t);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [structure, selectedTerritory, onSelectTerritory]);

  const html = useMemo(
    () => (structure ? buildMapHTML(structure, selectedTerritory?.id || null) : ''),
    [structure, selectedTerritory?.id]
  );

  if (!structure) return null;

  return (
    <div className="rounded-xl overflow-hidden border border-blue-400/20" style={{ height: 520 }}>
      <iframe
        key={iframeKey}
        ref={iframeRef}
        srcDoc={html}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        sandbox="allow-scripts allow-same-origin allow-popups"
        title="Territory Map"
      />
    </div>
  );
}

const MOCK_PERFORMANCE = {
  rep: {
    name: "Sarah Johnson",
    territory: "UK & Ireland Enterprise",
    role: "Senior Account Executive",
    teamQuota: 500000,
    individualQuota: 125000
  },
  q1Performance: {
    actualRevenue: 98750,
    targetRevenue: 125000,
    attainmentPercent: 79,
    deals: {
      closed: 8,
      target: 10
    },
    pipeline: 187500,
    avgDealSize: 12343
  },
  monthlyData: [
    { month: 'Jan', revenue: 28500, target: 41667, deals: 2 },
    { month: 'Feb', revenue: 35250, target: 41667, deals: 3 },
    { month: 'Mar', revenue: 35000, target: 41667, deals: 3 }
  ],
  earnings: {
    baseSalary: 15000,
    commission: 7900,
    accelerator: 0,
    totalEarnings: 22900,
    projectedQ1Total: 23500
  },
  incentiveScheme: {
    type: "Base + Tiered Commission",
    baseCommission: "8% up to 100% quota",
    tier1: "12% for 100-120% quota",
    tier2: "15% for 120%+ quota",
    payoutFrequency: "Quarterly with monthly advances"
  }
};

// Prevents a single bad message/chart render from blanking the whole app.
function MessageErrorBoundary({ children }) {
  return children;
}

function contextBlocksFromFile(f) {
  return listModuleContextBlocks(f);
}

function EditableContextBlock({ label, value, question, answer, qa, line, onSave, onDelete }) {
  const [text, setText] = useState(value || '');
  const [q, setQ] = useState(question || '');
  const [a, setA] = useState(answer || '');
  useEffect(() => { setText(value || ''); }, [value]);
  useEffect(() => { setQ(question || ''); setA(answer || ''); }, [question, answer]);
  const fieldClass = 'w-full bg-slate-800/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-400';
  return (
    <div className="bg-slate-800/40 border border-blue-400/20 rounded-lg p-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-[11px] font-semibold text-blue-200">{label}</div>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDelete}
          className="p-1 hover:bg-red-500/20 rounded text-red-400"
          title="Remove this context"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {qa ? (
        <div className="space-y-1.5">
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => { if (q !== (question || '') || a !== (answer || '')) onSave({ question: q, answer: a }); }}
            rows={2}
            placeholder="Question"
            className={`${fieldClass} resize-y`}
          />
          <textarea
            value={a}
            onChange={(e) => setA(e.target.value)}
            onBlur={() => { if (q !== (question || '') || a !== (answer || '')) onSave({ question: q, answer: a }); }}
            rows={2}
            placeholder="Answer"
            className={`${fieldClass} resize-y`}
          />
        </div>
      ) : line ? (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { if (text !== (value || '')) onSave(text); }}
          className={fieldClass}
        />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { if (text !== (value || '')) onSave(text); }}
          rows={3}
          className={`${fieldClass} resize-y`}
        />
      )}
    </div>
  );
}

export default function CommercialExcellenceApp() {
  // Ensure older sessions (unlocked before userId existed) still have an identity.
  const [currentUser] = useState(() => {
    const existing = getCurrentUser();
    if (existing?.id) {
      setCurrentUser(existing);
      return existing;
    }
    return setCurrentUser(getHardcodedUser());
  });
  const isAdmin = isAdminUser(currentUser);
  const [activeTab, setActiveTab] = useState('chat');
  const [showLanding, setShowLanding] = useState(true);
  const [chatSessions, setChatSessions] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState(() => [consultationWelcome()]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentWorkflow, setCurrentWorkflow] = useState(null);
  const [pendingWorkflow, setPendingWorkflow] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [stellaTab, setStellaTab] = useState('chat'); // chat | data | business | connections
  const [stellaMessages, setStellaMessages] = useState(() => [{
    role: 'assistant',
    content: readLocalProductIntelligence()?.welcomeMessages?.stella || 'Ask a question about your uploaded datasets.',
  }]);
  const [stellaInput, setStellaInput] = useState('');
  const [stellaIsLoading, setStellaIsLoading] = useState(false);
  const [stellaDataFiles, setStellaDataFiles] = useState([]); // { id, name, type, size, uploadedAt, storageBucket, storagePath, metaPath, summary, capturedContext, intakeMessages }
  const [activeStellaDataId, setActiveStellaDataId] = useState(null);
  const [stellaIntakeInput, setStellaIntakeInput] = useState('');
  const [stellaBusinessContext, setStellaBusinessContext] = useState({
    companyName: '',
    industry: '',
    keyGoals: '',
    keyMetrics: '',
    terminology: '',
  });
  const [stellaBizSaveStatus, setStellaBizSaveStatus] = useState('idle'); // idle | saving | saved | error
  const [userSettings, setUserSettings] = useState(() => mergeUserSettingsFields({}));
  const [productIntel, setProductIntel] = useState(() => readLocalProductIntelligence());
  const [userSettingsSaveStatus, setUserSettingsSaveStatus] = useState('idle'); // idle | saving | saved | saved-local | error
  const [userSettingsCloudError, setUserSettingsCloudError] = useState('');
  const [userSettingsPane, setUserSettingsPane] = useState('general'); // general | incentives | stella
  const [pptxTemplateStatus, setPptxTemplateStatus] = useState('idle'); // idle | extracting | uploading | error
  const [pptxTemplateError, setPptxTemplateError] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [structuredKnowledge, setStructuredKnowledge] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [knowledgeLoadStatus, setKnowledgeLoadStatus] = useState('idle'); // idle | loading | ready | error
  const [imageLightbox, setImageLightbox] = useState(null); // { src, name, purpose, reason, included }
  const [pendingImageReview, setPendingImageReview] = useState(null); // pause ingest until user confirms unsure images
  const pendingImageReviewRef = useRef(null);
  const proposalIngestRunningRef = useRef(false);
  const [pendingProposalIntake, setPendingProposalIntake] = useState(null);
  const pendingProposalIntakeRef = useRef(null);
  const [contextIngestJob, setContextIngestJob] = useState(null);
  const contextIngestJobRef = useRef(null);
  const [activeContextFileId, setActiveContextFileId] = useState(null);
  const [contextIntakeInput, setContextIntakeInput] = useState('');
  const [contextIntakeBusy, setContextIntakeBusy] = useState(false);
  const [contextEditSaveStatus, setContextEditSaveStatus] = useState('idle');
  const chatSessionsRef = useRef(chatSessions);
  const activeChatIdRef = useRef(activeChatId);
  const messagesRef = useRef(messages);
  const currentWorkflowRef = useRef(currentWorkflow);
  const pendingWorkflowRef = useRef(pendingWorkflow);
  const uploadedFileRef = useRef(uploadedFile);
  const userSettingsRef = useRef(userSettings);
  const persistChatsTimerRef = useRef(null);
  const skipChatPersistRef = useRef(false);
  const userSettingsReadyRef = useRef(false);
  const harvestMemoryBusyRef = useRef(false);
  const [chatHistoryCollapsed, setChatHistoryCollapsed] = useState(() => {
    try { return localStorage.getItem('comex-chat-history-collapsed') === '1'; } catch { return false; }
  });
  const [mobileChatHistoryOpen, setMobileChatHistoryOpen] = useState(false);
  const toggleChatHistoryCollapsed = () => {
    setChatHistoryCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem('comex-chat-history-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };
  const [agents, setAgents] = useState(() => readLocalProductIntelligence().agents);

  const [topics, setTopics] = useState(() => readLocalProductIntelligence().topics);

  const [orchestratorDecision, setOrchestratorDecision] = useState(null);
  const [pendingButtonAction, setPendingButtonAction] = useState(null);
  const [selectedTerritoryStructure, setSelectedTerritoryStructure] = useState(null);
  const [selectedTerritory, setSelectedTerritory] = useState(null);
  const [territoryView, setTerritoryView] = useState('map');
  const [territoryStructures, setTerritoryStructures] = useState([
    {
      id: 'uk_primary_care_2025',
      name: 'UK Primary Care 2025',
      uploadedAt: '2025-01-15',
      managers: [
        { id: 'mgr1', name: 'Sarah Mitchell', region: 'North' },
        { id: 'mgr2', name: 'James Thornton', region: 'Midlands & Wales' },
        { id: 'mgr3', name: 'Rachel Davies', region: 'South' }
      ],
      territories: [
        { id: 'T01', name: 'Scotland North', rep: 'Ewan Fraser', managerId: 'mgr1', counties: ['Highland','Moray','Aberdeenshire','Aberdeen City'], hcps: { A: 18, B: 42, C: 95 }, notes: 'Large geography, low density' },
        { id: 'T02', name: 'Scotland Central', rep: 'Fiona Campbell', managerId: 'mgr1', counties: ['Glasgow City','Lanarkshire','Renfrewshire','East Dunbartonshire'], hcps: { A: 34, B: 78, C: 140 }, notes: 'Urban core, high HCP density' },
        { id: 'T03', name: 'Scotland East', rep: 'Alasdair Murray', managerId: 'mgr1', counties: ['Edinburgh','Lothian','Fife','Dundee City'], hcps: { A: 29, B: 61, C: 118 }, notes: 'Mixed urban/suburban' },
        { id: 'T04', name: 'North East England', rep: 'Derek Armstrong', managerId: 'mgr1', counties: ['Northumberland','Tyne and Wear','Durham','Tees Valley'], hcps: { A: 31, B: 69, C: 122 }, notes: 'Industrial corridor' },
        { id: 'T05', name: 'Yorkshire North', rep: 'Helen Booth', managerId: 'mgr1', counties: ['North Yorkshire','East Riding','York'], hcps: { A: 27, B: 58, C: 104 }, notes: 'Rural/market towns' },
        { id: 'T06', name: 'Yorkshire South & West', rep: 'Marcus Singh', managerId: 'mgr1', counties: ['West Yorkshire','South Yorkshire'], hcps: { A: 38, B: 84, C: 152 }, notes: 'Dense urban, Leeds/Sheffield' },
        { id: 'T07', name: 'North West', rep: 'Claire Donnelly', managerId: 'mgr2', counties: ['Greater Manchester','Cheshire','Halton','Warrington'], hcps: { A: 41, B: 91, C: 165 }, notes: 'Manchester metro focus' },
        { id: 'T08', name: 'Lancashire & Cumbria', rep: 'Tom Whitfield', managerId: 'mgr2', counties: ['Lancashire','Cumbria'], hcps: { A: 24, B: 53, C: 98 }, notes: 'Mixed density' },
        { id: 'T09', name: 'East Midlands', rep: 'Priya Patel', managerId: 'mgr2', counties: ['Nottinghamshire','Derbyshire','Leicestershire','Rutland'], hcps: { A: 33, B: 72, C: 131 }, notes: '' },
        { id: 'T10', name: 'West Midlands', rep: 'David Okafor', managerId: 'mgr2', counties: ['West Midlands','Staffordshire','Shropshire'], hcps: { A: 39, B: 87, C: 158 }, notes: 'Birmingham metro' },
        { id: 'T11', name: 'Wales North & Mid', rep: 'Sian Hughes', managerId: 'mgr2', counties: ['Gwynedd','Conwy','Denbighshire','Powys','Ceredigion'], hcps: { A: 16, B: 38, C: 82 }, notes: 'Sparse, bilingual territory' },
        { id: 'T12', name: 'Wales South', rep: 'Gareth Evans', managerId: 'mgr2', counties: ['Cardiff','Swansea','Newport','Vale of Glamorgan','Rhondda Cynon Taf'], hcps: { A: 28, B: 63, C: 114 }, notes: 'Urban South Wales' },
        { id: 'T13', name: 'East of England North', rep: 'Lucy Hargreaves', managerId: 'mgr3', counties: ['Lincolnshire','Northamptonshire','Cambridgeshire'], hcps: { A: 26, B: 57, C: 103 }, notes: '' },
        { id: 'T14', name: 'East of England South', rep: 'Ben Cartwright', managerId: 'mgr3', counties: ['Norfolk','Suffolk','Essex North'], hcps: { A: 23, B: 51, C: 96 }, notes: 'Coastal/rural' },
        { id: 'T15', name: 'London North', rep: 'Amara Diallo', managerId: 'mgr3', counties: ['Enfield','Haringey','Barnet','Brent','Harrow'], hcps: { A: 44, B: 98, C: 178 }, notes: 'High density, diverse' },
        { id: 'T16', name: 'London Central', rep: 'Oliver Stratton', managerId: 'mgr3', counties: ['Westminster','Camden','Islington','Hackney','Tower Hamlets'], hcps: { A: 47, B: 104, C: 189 }, notes: 'Highest density territory' },
        { id: 'T17', name: 'London South', rep: 'Natasha Brown', managerId: 'mgr3', counties: ['Lambeth','Southwark','Lewisham','Greenwich','Bromley'], hcps: { A: 42, B: 93, C: 171 }, notes: '' },
        { id: 'T18', name: 'London West & Surrey', rep: 'Daniel Chu', managerId: 'mgr3', counties: ['Richmond','Kingston','Hounslow','Surrey'], hcps: { A: 36, B: 80, C: 147 }, notes: 'Affluent suburban' },
        { id: 'T19', name: 'South East', rep: 'Emma Patterson', managerId: 'mgr3', counties: ['Kent','East Sussex','West Sussex'], hcps: { A: 32, B: 71, C: 129 }, notes: 'Coastal & commuter belt' },
        { id: 'T20', name: 'South West', rep: 'James Worthington', managerId: 'mgr3', counties: ['Hampshire','Dorset','Wiltshire','Somerset','Devon','Cornwall'], hcps: { A: 30, B: 67, C: 121 }, notes: 'Large geography, lower density' }
      ]
    }
  ]);
  const [activityLog, setActivityLog] = useState([]);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [adminSection, setAdminSection] = useState('knowledge');
  const [adminModule, setAdminModule] = useState('incentive'); // incentive | territory | stella
  const [editingWorkflowId, setEditingWorkflowId] = useState(null);
  const [editingTopic, setEditingTopic] = useState(null);
  const [editingTopicTab, setEditingTopicTab] = useState('basics'); // basics | orchestrator | steps
  const [expandedSteps, setExpandedSteps] = useState({});
  const [editingAgent, setEditingAgent] = useState(null);
  const [suggestedPrompts, setSuggestedPrompts] = useState([]);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(() => readLocalProductIntelligence().suggestions.enabled);
  const [maxSuggestions, setMaxSuggestions] = useState(() => readLocalProductIntelligence().suggestions.max);
  const [customSystemPrompt, setCustomSystemPrompt] = useState(() => readLocalProductIntelligence().systemPrompt);
  const [pptxOffers, setPptxOffers] = useState(null);
  const [pptxGenerating, setPptxGenerating] = useState(false);
  const [pptxClarifyPending, setPptxClarifyPending] = useState(false);
  const [hoveredCitation, setHoveredCitation] = useState(null);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const adminFileInputRef = useRef(null);
  const territoryFileInputRef = useRef(null);
  const stellaDataFileInputRef = useRef(null);
  const pptxTemplateInputRef = useRef(null);
  const moduleContextFileInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ── SUPABASE: Load intelligence knowledge files on every visit ──
  useEffect(() => {
    const applyDocs = (docs) => {
      setDocuments(docs);
      setKnowledgeBase(buildKnowledgeBaseFromDocuments(docs));
      setKnowledgeLoadStatus('ready');
    };

    const toDoc = (name, content, sizeBytes = 0) => {
      const isYaml = /\.ya?ml$/i.test(name);
      return {
        id: name,
        name,
        type: isYaml ? 'yaml' : 'text',
        size: `${(Number(sizeBytes || 0) / 1024).toFixed(1)} KB`,
        status: 'active',
        content,
        fromStorage: true,
      };
    };

    const ensureSeedFiles = async (existingNames) => {
      for (const fileName of KNOWLEDGE_SEED_FILES) {
        if (existingNames.has(fileName)) continue;
        try {
          const res = await fetch(`/knowledge/${fileName}`);
          if (!res.ok) continue;
          const text = await res.text();
          const blob = new Blob([text], { type: 'text/markdown' });
          await supabase.storage.from('intelligence').upload(fileName, blob, {
            upsert: true,
            contentType: 'text/markdown',
          });
          existingNames.add(fileName);
        } catch { /* seed optional if storage/public file unavailable */ }
      }
    };

    const loadIntelligenceFiles = async () => {
      setKnowledgeLoadStatus('loading');
      try {
        const { data, error } = await supabase.storage.from('intelligence').list('', { limit: 200 });
        if (error) throw error;
        const names = new Set(
          (data || [])
            .map((item) => item.name)
            .filter((n) => isKnowledgeStorageFile(n))
        );
        await ensureSeedFiles(names);

        const { data: listed } = await supabase.storage.from('intelligence').list('', { limit: 200 });
        const knowledgeItems = (listed || []).filter((item) => isKnowledgeStorageFile(item.name));
        const docs = [];
        for (const item of knowledgeItems) {
          const { data: fileData, error: downloadError } = await supabase.storage
            .from('intelligence')
            .download(item.name);
          if (downloadError || !fileData) continue;
          const content = await fileData.text();
          docs.push(toDoc(item.name, content, item.metadata?.size || content.length));
        }
        applyDocs(docs);
      } catch (e) {
        console.warn('Knowledge load failed:', e);
        setKnowledgeLoadStatus('error');
        // Fallback: try public seed files directly (no storage)
        try {
          const docs = [];
          for (const fileName of KNOWLEDGE_SEED_FILES) {
            const res = await fetch(`/knowledge/${fileName}`);
            if (!res.ok) continue;
            const content = await res.text();
            docs.push(toDoc(fileName, content, content.length));
          }
          if (docs.length) applyDocs(docs);
        } catch { /* leave empty */ }
      }
    };
    loadIntelligenceFiles();
  }, []);

  // ── SUPABASE: Load Stella registry + business context on startup ──
  useEffect(() => {
    const loadStella = async () => {
      // File registry (stella_files table).
      try {
        const { data, error } = await supabase
          .from('stella_files')
          .select('*')
          .eq('org_id', 'default')
          .order('uploaded_at', { ascending: true });
        if (!error && Array.isArray(data)) {
          const mapped = data.map(stellaMapRegistryRow);
          setStellaDataFiles(prev => {
            const existing = new Set(prev.map(f => f.dbId).filter(Boolean));
            return [...prev, ...mapped.filter(f => !existing.has(f.dbId))];
          });
        }
      } catch { /* stella_files table may not exist yet */ }

      // Business context (persisted as JSON in storage).
      for (const candidate of STELLA_STORAGE_CANDIDATES) {
        try {
          const { data, error } = await supabase.storage.from(candidate.bucket).download(`${candidate.prefix}business-context.json`);
          if (error || !data) continue;
          const parsed = safeJsonParse(await data.text());
          if (parsed && typeof parsed === 'object') { setStellaBusinessContext(prev => ({ ...prev, ...parsed })); break; }
        } catch { /* try next candidate */ }
      }

      // Shared product intelligence (admin-owned). Fall back to admin user JSON once, then factory defaults.
      try {
        let intelParsed = null;
        {
          const { data, error } = await supabase.storage.from('intelligence').download(productIntelligenceRemotePath());
          if (!error && data) intelParsed = safeJsonParse(await data.text());
        }
        let intel = extractProductIntelligence(intelParsed);
        let migratedFromUser = false;
        if (!intel) {
          const admin = HARDCODED_USERS.find((u) => u.role === 'admin') || getHardcodedUser();
          const adminCandidates = [
            ...userSettingsRemotePathCandidates(admin),
            ...(currentUser.id === admin.id ? [LEGACY_USER_SETTINGS_FILE] : []),
          ];
          for (const candidate of adminCandidates) {
            try {
              const { data, error } = await supabase.storage.from('intelligence').download(candidate);
              if (error || !data) continue;
              intel = extractProductIntelligence(safeJsonParse(await data.text()));
              if (intel) {
                migratedFromUser = true;
                break;
              }
            } catch { /* try next */ }
          }
        }
        if (intel) {
          const mergedIntel = mergeProductIntelligence(intel);
          setProductIntel(mergedIntel);
          setAgents(mergedIntel.agents);
          setTopics(mergedIntel.topics);
          setCustomSystemPrompt(mergedIntel.systemPrompt);
          setSuggestionsEnabled(!!mergedIntel.suggestions.enabled);
          setMaxSuggestions(mergedIntel.suggestions.max);
          try {
            localStorage.setItem(productIntelligenceLocalKey(), JSON.stringify(buildProductIntelligenceDocument(mergedIntel)));
          } catch { /* ignore */ }
          if (!intelParsed && migratedFromUser) {
            try {
              const blob = new Blob([JSON.stringify(buildProductIntelligenceDocument(mergedIntel), null, 2)], { type: 'application/json' });
              await supabase.storage.from('intelligence').upload(
                productIntelligenceRemotePath(),
                blob,
                { upsert: true, contentType: 'application/json' },
              );
            } catch { /* first-time seed is best-effort */ }
          }
        }
      } catch { /* product intel falls back to factory defaults */ }

      // User settings: intelligence/users/<display name>/settings.json
      // Chat history:  intelligence/users/<display name>/chats.json
      try {
        try {
          localStorage.removeItem(userSettingsLocalKey(currentUser.id));
          localStorage.removeItem(LEGACY_USER_SETTINGS_STORAGE_KEY);
          Object.keys(localStorage)
            .filter((k) => k.startsWith('comex-user-settings'))
            .forEach((k) => localStorage.removeItem(k));
        } catch { /* ignore */ }
        const parsed = await downloadUserJsonDocument(currentUser, 'settings.json');
        const chatsParsed = await downloadUserJsonDocument(currentUser, 'chats.json');
        if (parsed && typeof parsed === 'object') {
          const remoteSettings = normalizeLoadedUserSettings(parsed);
          const liveSettings = mergeUserSettingsFields(userSettingsRef.current);
          const merged = {
            ...remoteSettings,
            moduleContext: mergeModuleContextPreferRich(liveSettings.moduleContext, remoteSettings.moduleContext),
          };
          setUserSettings(merged);
          userSettingsRef.current = merged;
        }
        let remoteChats = [];
        let remoteActive = null;
        let migratedChats = false;
        if (chatsParsed && typeof chatsParsed === 'object') {
          ({ chats: remoteChats, activeChatId: remoteActive } = extractChatsFromDocument(chatsParsed));
        } else {
          const fromSettings = extractChatsFromDocument(parsed);
          remoteChats = fromSettings.chats;
          remoteActive = fromSettings.activeChatId;
          migratedChats = remoteChats.length > 0;
        }
        skipChatPersistRef.current = true;
        setChatSessions(remoteChats);
        chatSessionsRef.current = remoteChats;
        if (remoteChats.length) {
          const pick = remoteChats.find((c) => c.id === remoteActive) || remoteChats[0];
          setActiveChatId(pick.id);
          activeChatIdRef.current = pick.id;
          if (pick.messages?.length) setMessages(pick.messages);
          setCurrentWorkflow(pick.currentWorkflow || null);
          setPendingWorkflow(pick.pendingWorkflow || null);
          setUploadedFile(pick.uploadedFile || null);
        } else {
          setActiveChatId(null);
          activeChatIdRef.current = null;
          setMessages([consultationWelcome()]);
          setCurrentWorkflow(null);
          setPendingWorkflow(null);
          setUploadedFile(null);
        }
        setTimeout(() => { skipChatPersistRef.current = false; }, 0);
        if (migratedChats) {
          try {
            await queueUserChatsUpload(currentUser, () => buildUserChatsDocument(
              currentUser.id,
              {
                chats: chatSessionsRef.current,
                activeChatId: activeChatIdRef.current,
                userName: currentUser.name,
              },
            ));
            if (parsed && typeof parsed === 'object') {
              await queueUserSettingsUpload(currentUser, () => buildUserSettingsDocument(
                currentUser.id,
                mergeUserSettingsFields(userSettingsRef.current),
                { userName: currentUser.name },
              ));
            }
          } catch { /* one-time split is best-effort */ }
        }
      } catch (err) {
        setUserSettingsCloudError(err?.message || 'Could not load settings.json');
      }
      userSettingsReadyRef.current = true;
    };
    loadStella();
  }, [currentUser.id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    messagesRef.current = messages;
    currentWorkflowRef.current = currentWorkflow;
    pendingWorkflowRef.current = pendingWorkflow;
    uploadedFileRef.current = uploadedFile;
    userSettingsRef.current = userSettings;
    activeChatIdRef.current = activeChatId;
    chatSessionsRef.current = chatSessions;
  });

  useEffect(() => {
    if (!isAdmin && activeTab === 'admin') {
      setActiveTab('chat');
      setShowLanding(true);
    }
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!userSettingsReadyRef.current) return;
    if (skipChatPersistRef.current) return;
    if (!chatHasUserContent(messages) && !currentWorkflow) return;
    if (persistChatsTimerRef.current) clearTimeout(persistChatsTimerRef.current);
    persistChatsTimerRef.current = setTimeout(async () => {
      const id = activeChatIdRef.current || newChatId();
      if (!activeChatIdRef.current) {
        activeChatIdRef.current = id;
        setActiveChatId(id);
      }
      const existing = (chatSessionsRef.current || []).find((c) => c.id === id);
      const sameThread = existing && (existing.messages || []).length === (messagesRef.current || []).length
        && String(existing.messages?.[existing.messages.length - 1]?.content || '') === String(messagesRef.current?.[messagesRef.current.length - 1]?.content || '');
      const snap = serializeChatSnapshot({
        id,
        messages: messagesRef.current,
        currentWorkflow: currentWorkflowRef.current,
        pendingWorkflow: pendingWorkflowRef.current,
        uploadedFile: uploadedFileRef.current,
        module: existing?.module,
        createdAt: existing?.createdAt,
        updatedAt: sameThread ? existing.updatedAt : undefined,
      });
      const next = upsertChatInPlace(chatSessionsRef.current, snap);
      chatSessionsRef.current = next;
      setChatSessions(next);
      try {
        await queueUserChatsUpload(currentUser, () => buildUserChatsDocument(
          currentUser.id,
          {
            chats: chatSessionsRef.current,
            activeChatId: activeChatIdRef.current,
            userName: currentUser.name,
          },
        ));
      } catch { /* next save retries */ }
    }, 1200);
    return () => clearTimeout(persistChatsTimerRef.current);
  }, [messages, currentWorkflow, pendingWorkflow, uploadedFile]);

  const handleCancelWorkflow = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const confirmed = window.confirm('Cancel this workflow and return to normal chat?');
    if (confirmed) {
      setCurrentWorkflow(null);
      setPendingWorkflow(null);
      setIsLoading(false);
      setMessages(prev => [...prev, { role: 'system', content: '❌ Workflow cancelled. Returning to normal chat mode.' }]);
    }
  };

  const logActivity = (type, action, details = {}) => {
    setActivityLog(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      type, action, details
    }].slice(-10));
  };

  const parseReferences = (fullText) => {
    const refs = {};
    const match = fullText.match(/[-]{2,}\s*\nReferences:\s*\n([\s\S]+?)(\n[-]{2,}|\s*$)/i);
    if (match) {
      match[1].split('\n').forEach(line => {
        const m = line.match(/^(\d+)\.\s+(.+)$/);
        if (m) refs[m[1]] = m[2].trim();
      });
    }
    return refs;
  };

  const renderTextWithCitations = (text, references = {}) => {
    const parts = text.split(/(\[\d+\])/g);
    const hasCitations = parts.some(p => /^\[\d+\]$/.test(p));
    if (!hasCitations) return <span>{text}</span>;
    return (
      <span>
        {parts.map((part, i) => {
          const cm = part.match(/^\[(\d+)\]$/);
          if (cm) {
            const refNum = cm[1];
            const refText = references[refNum];
            return (
              <sup key={i}
                className="text-cyan-400 hover:text-cyan-300 cursor-help font-semibold mx-0.5 relative"
                onMouseEnter={(e) => {
                  const rect = e.target.getBoundingClientRect();
                  setHoveredCitation({ num: refNum, text: refText, x: rect.left + rect.width / 2, y: rect.bottom });
                }}
                onMouseLeave={() => setHoveredCitation(null)}
              >[{refNum}]</sup>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </span>
    );
  };

  const renderPayoutCurveChart = (curveData) => {
    if (!Array.isArray(curveData) || curveData.length === 0) return null;
    const W = 800, H = 300, PAD_L = 80, PAD_R = 20, PAD_T = 20, PAD_B = 40;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    const xMax = Math.ceil(Math.max(150, ...curveData.map(p => p.performance)) / 50) * 50;
    const yMax = Math.ceil(Math.max(150, ...curveData.map(p => p.payout)) / 50) * 50;
    const thresholdPerf = (curveData.find(p => p.payout > 0) || curveData[0]).performance;
    const xMin = Math.max(0, Math.floor((thresholdPerf - 10) / 25) * 25);
    const toX = (v) => PAD_L + ((v - xMin) / (xMax - xMin)) * chartW;
    const toY = (v) => PAD_T + chartH - (v / yMax) * chartH;
    const fullLine = [{ performance: thresholdPerf, payout: 0 }, ...curveData];
    const xTicks = Array.from({ length: Math.floor((xMax - xMin) / 25) + 1 }, (_, i) => xMin + i * 25);
    const yTicks = Array.from({ length: Math.floor(yMax / 50) + 1 }, (_, i) => i * 50);
    return (
      <div className="bg-slate-900/50 border border-blue-400/30 rounded-lg p-4 my-4">
        <h3 className="text-base font-semibold text-cyan-400 mb-3">💹 Payout Curve</h3>
        <div className="overflow-x-auto">
          <div className="bg-slate-800/50 rounded p-2 mb-4" style={{ minWidth: '500px', height: '300px' }}>
            <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
              {yTicks.map(v => <line key={v} x1={PAD_L} y1={toY(v)} x2={W - PAD_R} y2={toY(v)} stroke="#334155" strokeWidth="0.5"/>)}
              {xTicks.map(v => <line key={v} x1={toX(v)} y1={PAD_T} x2={toX(v)} y2={PAD_T + chartH} stroke="#334155" strokeWidth="0.5"/>)}
              <line x1={PAD_L} y1={PAD_T + chartH} x2={W - PAD_R} y2={PAD_T + chartH} stroke="#94a3b8" strokeWidth="2"/>
              <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + chartH} stroke="#94a3b8" strokeWidth="2"/>
              {yTicks.map(v => <text key={v} x={PAD_L - 8} y={toY(v) + 4} textAnchor="end" fill="#94a3b8" fontSize="11">{v}%</text>)}
              {xTicks.filter(v => v % 25 === 0).map(v => <text key={v} x={toX(v)} y={PAD_T + chartH + 16} textAnchor="middle" fill="#94a3b8" fontSize="11">{v}%</text>)}
              <text x={PAD_L + chartW / 2} y={H - 2} textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="bold">Performance (% of Quota)</text>
              <text x="12" y={PAD_T + chartH / 2} textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="bold" transform={`rotate(-90,12,${PAD_T + chartH / 2})`}>Payout (%)</text>
              <line x1={toX(100)} y1={PAD_T} x2={toX(100)} y2={PAD_T + chartH} stroke="#10b981" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7"/>
              <line x1={PAD_L} y1={toY(100)} x2={W - PAD_R} y2={toY(100)} stroke="#10b981" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7"/>
              <text x={toX(100) + 4} y={PAD_T + 14} fill="#10b981" fontSize="11" fontWeight="bold">100% Target</text>
              <polyline points={fullLine.map(p => `${toX(p.performance)},${toY(p.payout)}`).join(' ')} fill="none" stroke="#22d3ee" strokeWidth="3"/>
              {curveData.map((p, i) => {
                const color = p.payout === 0 ? '#ef4444' : p.payout < 100 ? '#eab308' : p.payout === 100 ? '#10b981' : '#22d3ee';
                return <circle key={i} cx={toX(p.performance)} cy={toY(p.payout)} r="6" fill={color} stroke="#1e293b" strokeWidth="2"/>;
              })}
            </svg>
          </div>
        </div>
        <table className="w-full border-collapse border border-blue-400/30 rounded text-xs">
          <thead className="bg-blue-500/20">
            <tr>
              <th className="border border-blue-400/30 px-3 py-2 text-left text-blue-300">Performance %</th>
              <th className="border border-blue-400/30 px-3 py-2 text-left text-blue-300">Payout %</th>
              <th className="border border-blue-400/30 px-3 py-2 text-left text-blue-300">Status</th>
            </tr>
          </thead>
          <tbody>
            {curveData.map((p, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-slate-800/30' : 'bg-slate-800/50'}>
                <td className="border border-blue-400/30 px-3 py-1.5">{p.performance}%</td>
                <td className="border border-blue-400/30 px-3 py-1.5 font-semibold">{p.payout}%</td>
                <td className="border border-blue-400/30 px-3 py-1.5">
                  {p.payout === 0 ? <span className="text-red-400">❌ No Payout</span> :
                   p.payout < 100 ? <span className="text-yellow-400">📊 Below Target</span> :
                   p.payout === 100 ? <span className="text-green-400">✅ On Target</span> :
                   <span className="text-cyan-400">🚀 Accelerator</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderRechartsChart = (spec) => {
    if (!spec || typeof spec !== 'object') return null;
    return (
      <MessageErrorBoundary>
        <Suspense fallback={<div className="bg-slate-900/50 border border-blue-400/30 rounded-lg p-4 my-4 text-xs text-blue-300/70">Loading chart…</div>}>
          <StellaChart spec={spec} />
        </Suspense>
      </MessageErrorBoundary>
    );
  };

  const formatMarkdown = (content) => {
    const hideCitations = !isAdmin;
    const source = hideCitations ? stripKnowledgeCitations(content) : content;
    const references = hideCitations ? {} : parseReferences(source);
    const cleanContent = source.replace(/[-]{2,}\s*\nReferences:\s*\n[\s\S]+?(\n[-]{2,}|\s*$)/i, '').trimEnd();
    const chartMatch = cleanContent.match(/```chart-payout\n([\s\S]+?)\n```/);
    if (chartMatch) {
      try {
        const chartData = JSON.parse(chartMatch[1]);
        const textWithoutChart = cleanContent.replace(/```chart-payout\n[\s\S]+?\n```/, '').trim();
        return (
          <div className="space-y-2">
            {renderPayoutCurveChart(chartData)}
            {textWithoutChart && <div>{formatMarkdown(textWithoutChart)}</div>}
          </div>
        );
      } catch(e) { /* fall through */ }
    }
    const rechartsMatch = cleanContent.match(/```chart-recharts\n([\s\S]+?)\n```/);
    if (rechartsMatch) {
      try {
        const spec = JSON.parse(rechartsMatch[1]);
        const textWithoutChart = cleanContent.replace(/```chart-recharts\n[\s\S]+?\n```/, '').trim();
        return (
          <div className="space-y-2">
            {renderRechartsChart(spec)}
            {textWithoutChart && <div>{formatMarkdown(textWithoutChart)}</div>}
          </div>
        );
      } catch (e) { /* fall through */ }
    }
    const stellaChartMatch = cleanContent.match(/```chart-stella\s*([\s\S]+?)```/);
    if (stellaChartMatch) {
      try {
        const spec = JSON.parse(stellaChartMatch[1].trim());
        const textWithoutChart = cleanContent.replace(/```chart-stella\s*[\s\S]+?```/, '').trim();
        return (
          <div className="space-y-2">
            {renderRechartsChart(spec)}
            {textWithoutChart && <div>{formatMarkdown(textWithoutChart)}</div>}
          </div>
        );
      } catch (e) { /* fall through */ }
    }
    const lines = cleanContent.split('\n');
    const elements = [];
    let tableLines = [];
    let textLines = [];
    const flushText = () => { if (textLines.length > 0) { elements.push({ type: 'text', lines: [...textLines] }); textLines = []; } };
    const flushTable = () => { if (tableLines.length > 0) { elements.push({ type: 'table', lines: [...tableLines] }); tableLines = []; } };
    for (const line of lines) {
      if (line.includes('|') && line.split('|').length >= 3) { flushText(); tableLines.push(line); }
      else { flushTable(); textLines.push(line); }
    }
    flushText(); flushTable();
    const inlineFormat = (text) =>
      text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code class="bg-slate-700 px-1 rounded text-cyan-300 text-xs">$1</code>');
    return (
      <div className="space-y-1">
        {elements.map((el, idx) => {
          if (el.type === 'table') {
            const rows = el.lines.filter(l => !l.match(/^[\s\-:|]+$/)).map(l => l.split('|').map(c => c.trim()).filter(c => c.length > 0)).filter(r => r.length > 0);
            if (rows.length === 0) return null;
            const [header, ...body] = rows;
            return (
              <div key={idx} className="overflow-x-auto my-3">
                <table className="min-w-full border-collapse border border-blue-400/30 rounded-lg overflow-hidden text-sm">
                  <thead className="bg-blue-500/20">
                    <tr>{header.map((h, i) => (<th key={i} className="border border-blue-400/30 px-3 py-2 text-left font-semibold text-blue-300 whitespace-nowrap" dangerouslySetInnerHTML={{ __html: inlineFormat(h) }} />))}</tr>
                  </thead>
                  <tbody>
                    {body.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-slate-800/30' : 'bg-slate-800/50'}>
                        {row.map((cell, j) => (<td key={j} className="border border-blue-400/30 px-3 py-2 text-sm align-top" dangerouslySetInnerHTML={{ __html: inlineFormat(cell) }} />))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          } else {
            return (
              <div key={idx} className="space-y-1">
                {el.lines.map((line, i) => {
                  if (line.startsWith('### ')) return <h3 key={i} className="text-base font-bold text-cyan-300 mt-3 mb-1" dangerouslySetInnerHTML={{ __html: inlineFormat(line.slice(4)) }} />;
                  if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-bold text-cyan-400 mt-4 mb-1 border-b border-cyan-400/20 pb-1" dangerouslySetInnerHTML={{ __html: inlineFormat(line.slice(3)) }} />;
                  if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold text-white mt-4 mb-2" dangerouslySetInnerHTML={{ __html: inlineFormat(line.slice(2)) }} />;
                  if (line.match(/^(\s*[-*+]|\s*\d+\.)\s/)) {
                    const indent = line.match(/^(\s*)/)[1].length;
                    const text = line.replace(/^(\s*[-*+]|\s*\d+\.)\s/, '');
                    return (
                      <div key={i} className="flex gap-2 leading-relaxed" style={{ paddingLeft: `${indent * 4}px` }}>
                        <span className="text-cyan-400 flex-shrink-0 mt-0.5">•</span>
                        <span className="text-sm">{hideCitations ? text : renderTextWithCitations(text, references)}</span>
                      </div>
                    );
                  }
                  if (line.trim() === '' || line.trim() === '---') return <div key={i} className="h-2"/>;
                  return <div key={i} className="text-sm leading-relaxed">{hideCitations ? line : renderTextWithCitations(line, references)}</div>;
                })}
              </div>
            );
          }
        })}
        {hoveredCitation && hoveredCitation.text && (
          <div className="fixed z-50 bg-slate-800 border border-cyan-400/50 rounded-lg p-3 shadow-xl max-w-sm pointer-events-none"
            style={{ left: `${hoveredCitation.x}px`, top: `${hoveredCitation.y + 10}px`, transform: 'translateX(-50%)' }}>
            <div className="text-xs text-cyan-300 font-semibold mb-1">Reference [{hoveredCitation.num}]</div>
            <div className="text-sm text-slate-200">{hoveredCitation.text}</div>
          </div>
        )}
        {Object.keys(references).length > 0 && isAdmin && (
          <div className="mt-4 pt-4 border-t border-slate-700">
            <div className="text-sm font-semibold text-cyan-400 mb-2">📚 References</div>
            <div className="space-y-1 text-xs text-slate-400">
              {Object.entries(references).map(([num, text]) => (
                <div key={num} className="flex gap-2">
                  <span className="text-cyan-400 font-semibold min-w-[20px]">[{num}]</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const generateSuggestions = async (conversationHistory) => {
    if (!suggestionsEnabled || conversationHistory.length === 0) { setSuggestedPrompts([]); return; }
    // Never invent answers while an agent is waiting on clarifying questions
    if (currentWorkflow?.awaitingAgentReply || currentWorkflow?.waitingForUser || pendingProposalIntake) {
      setSuggestedPrompts([]);
      return;
    }
    const lastAssistant = [...conversationHistory].reverse().find((m) => m.role === 'assistant' || m.role === 'orchestrator' || m.role === 'agent');
    if (hasNumberedClarifyingQuestions(lastAssistant?.content)) {
      setSuggestedPrompts([]);
      return;
    }
    try {
      const knowledgeNames = (documents || []).map((d) => d.name).filter(Boolean);
      const thread = conversationHistory.filter((m) =>
        m && (m.role === 'user' || m.role === 'assistant' || m.role === 'orchestrator' || m.role === 'agent') && m.content,
      );
      const recentMessages = thread.slice(-10).map((m) => {
        const body = excerptForSuggestions(stripKnowledgeCitations(String(m.content || ''), knowledgeNames), 1100);
        return `${m.role}: ${body}`;
      }).join('\n\n');
      const lastUser = [...thread].reverse().find((m) => m.role === 'user');
      const lastUserText = excerptForSuggestions(stripKnowledgeCitations(String(lastUser?.content || ''), knowledgeNames), 800);
      const lastAsstText = excerptForSuggestions(stripKnowledgeCitations(String(lastAssistant?.content || ''), knowledgeNames), 1100);
      const convoTokens = significantTokens(`${lastUserText}\n${lastAsstText}\n${recentMessages}`);
      const n = Math.min(Math.max(1, maxSuggestions), 5);
      const sug = getIntel().suggestions;
      const response = await anthropicMessagesPost({
        system: `${fillTemplate(sug.systemPrompt, { n })}

Never mention knowledge-file names, .md/.yml titles, citation numbers, or a References section.
Do not suggest generic incentive or territory topics that are not already in this thread.`,
        messages: [{
          role: 'user',
          content: `${fillTemplate(sug.userPromptTemplate, { recent: recentMessages, n })}

User's latest message:
${lastUserText || '(none)'}

Assistant's latest reply:
${lastAsstText || '(none)'}

Return ${n} clickable follow-ups that continue this thread. Each must mention a concrete detail from the messages above.`,
        }],
        max_tokens: 400,
      });
      const data = await response.json();
      const text = anthropicAssistantText(data)?.trim();
      if (text) {
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        if (Array.isArray(parsed)) {
          const cleaned = parsed
            .map((p) => stripKnowledgeCitations(String(p || ''), knowledgeNames).replace(/\s+/g, ' ').trim())
            .filter((p) => isSensibleSuggestion(p, knowledgeNames) && isConversationGrounded(p, convoTokens));
          setSuggestedPrompts(cleaned.slice(0, n));
        }
      }
    } catch (e) { setSuggestedPrompts([]); }
  };

  const detectPptxIntent = async (conversationHistory) => {
    if (conversationHistory.length < 2) return;
    try {
      const recentMessages = conversationHistory.slice(-8).map(m => `${m.role}: ${m.content.substring(0, 400)}`).join('\n');
      const pptxCtx = getPptxContext(productIntel);
      const response = await anthropicMessagesPost({
        system: `${pptxCtx.intentDetection}${buildUserSettingsPromptBlock(userSettings)}`,
        messages: [{ role: 'user', content: `Conversation:\n${recentMessages}` }],
        max_tokens: 400,
      });
      const data = await response.json();
      const text = anthropicAssistantText(data)?.trim();
      if (text) {
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        if (parsed.offer && (parsed.summaryDeck || parsed.producedDeck)) {
          setPptxOffers({ summary: parsed.summaryDeck || null, produced: parsed.producedDeck || null });
        }
      }
    } catch (e) { console.warn('detectPptxIntent error:', e); }
  };

  const lastMessageRef = useRef(0);
  useEffect(() => {
    if (currentWorkflow) return;
    const substantiveMessages = messages.filter(m =>
      (m.role === 'assistant' || m.role === 'orchestrator') &&
      m.content?.length > 200 &&
      !m.content.includes('Would you like me to start this workflow') &&
      !m.content.includes('want to start this workflow') &&
      !m.content.includes('shall we begin')
    );
    if (substantiveMessages.length < 2) return;
    if (substantiveMessages.length === lastMessageRef.current) return;
    lastMessageRef.current = substantiveMessages.length;
    const timer = setTimeout(() => {
      if (!isLoading && !currentWorkflow) detectPptxIntent(messages);
    }, 2000);
    return () => clearTimeout(timer);
  }, [messages, isLoading, currentWorkflow]);

  const callAnthropic = async (system, messages, maxTokens = 1000) => {
    const res = await anthropicMessagesPost({ system, messages, max_tokens: maxTokens });
    if (!res.ok) { const errText = await res.text(); throw new Error(`API error ${res.status}: ${errText.substring(0, 200)}`); }
    const data = await res.json();
    if (data.error) throw new Error(`Anthropic error: ${data.error.message || JSON.stringify(data.error)}`);
    return anthropicAssistantText(data);
  };

  const harvestChatMemory = async (assistantText, userText) => {
    if (harvestMemoryBusyRef.current || !userSettingsReadyRef.current) return;
    if (!shouldHarvestChatMemory(assistantText, userText)) return;
    harvestMemoryBusyRef.current = true;
    try {
      const raw = await callAnthropic(
        `You extract durable memory for a commercial-excellence copilot.
From the exchange, list facts the USER stated that should be remembered in later chats.
Include volunteered facts (e.g. "our products are X"), answers to clarifying questions, plan rules, metrics, dates, roles, constraints, and preferences.
Skip greetings, "yes start the workflow", process chatter, the assistant's own advice, and unanswered questions.
Return JSON only: {"facts":["..."]}. Max 5 facts. Each fact one short sentence. If nothing durable, {"facts":[]}.`,
        [{
          role: 'user',
          content: `Recent assistant message (may be empty):\n${String(assistantText || '').slice(0, 2500)}\n\nUser said:\n${String(userText || '').slice(0, 2500)}`,
        }],
        400,
      );
      const parsed = safeJsonParse(String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim());
      const facts = Array.isArray(parsed?.facts) ? parsed.facts : [];
      if (!facts.length) return;
      const memory = mergeMemoryFacts(userSettingsRef.current.memory, facts, { module: resolvePromptModule() });
      const settings = mergeUserSettingsFields({ ...userSettingsRef.current, memory });
      setUserSettings(settings);
      userSettingsRef.current = settings;
      await queueUserSettingsUpload(currentUser, () => buildUserSettingsDocument(
        currentUser.id,
        mergeUserSettingsFields(userSettingsRef.current),
        { userName: currentUser.name },
      ));
    } catch { /* memory is best-effort */ }
    harvestMemoryBusyRef.current = false;
  };

  /** Append mandatory user preferences/context to any system prompt. */
  const resolvePromptModule = () => {
    if (activeTab === 'stella') return 'stella';
    if (activeTab === 'territory') return 'territory';
    const topic = String(currentWorkflow?.topicId || '');
    if (topic.includes('territory')) return 'territory';
    if (topic.includes('stella')) return 'stella';
    return 'incentives';
  };

  const withUserSettings = (system, { moduleContext = true } = {}) => {
    let prompt = String(system || '');
    if (!isAdmin) {
      prompt = prompt.replace(
        /CITATION SYSTEM[\s\S]*?(?=\nCRITICAL - POWERPOINT|\nRESPONSE FORMATTING)/i,
        `CITATION SYSTEM:
Do not cite sources. Never name knowledge files, intelligence documents, or filenames. Do not use [1]/[2] markers or a References section. Apply best-practice knowledge silently.\n\n`
      );
      prompt = prompt.replace(/ALWAYS include the source of the data points in your response text/gi, 'Do not name the source of data points');
      prompt = prompt.replace(/loaded from intelligence files/gi, 'best-practice guidance');
    }
    const moduleBlock = moduleContext
      ? formatModuleContextPromptBlock(userSettings, resolvePromptModule())
      : '';
    const base = `${prompt}${buildUserSettingsPromptBlock(userSettings)}${moduleBlock}`;
    if (isAdmin) return base;
    return `${base}

END-USER MODE: Never cite or name knowledge files, intelligence documents, or source filenames. Do not use [1]/[2] markers or a References section. Apply best-practice knowledge in your reasoning without mentioning where it came from.`;
  };

  const getIntel = () => mergeProductIntelligence({
    ...productIntel,
    systemPrompt: customSystemPrompt,
    agents,
    topics,
    suggestions: {
      ...(productIntel.suggestions || {}),
      enabled: suggestionsEnabled,
      max: maxSuggestions,
    },
  });
  const getWorkflowRuntime = () => getIntel().workflowRuntime;
  const getPptxClarify = () => getIntel().pptxClarify;
  const getStellaPrompts = () => getIntel().stellaPrompts;

  /** Persist Admin intelligence into the shared product JSON (not per-user). */
  const persistIntelligenceSettings = async (overrides = {}) => {
    const intel = mergeProductIntelligence({
      ...productIntel,
      systemPrompt: customSystemPrompt,
      agents,
      topics,
      suggestions: {
        ...(productIntel.suggestions || {}),
        enabled: suggestionsEnabled,
        max: maxSuggestions,
      },
      ...overrides,
    });
    setProductIntel(intel);
    setAgents(intel.agents);
    setTopics(intel.topics);
    setCustomSystemPrompt(intel.systemPrompt);
    setSuggestionsEnabled(!!intel.suggestions.enabled);
    setMaxSuggestions(intel.suggestions.max);
    const doc = buildProductIntelligenceDocument(intel);
    setUserSettingsSaveStatus('saving');
    try {
      localStorage.setItem(productIntelligenceLocalKey(), JSON.stringify(doc));
    } catch { /* ignore */ }
    try {
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const { error } = await supabase.storage
        .from('intelligence')
        .upload(productIntelligenceRemotePath(), blob, { upsert: true, contentType: 'application/json' });
      if (error) throw error;
      setUserSettingsSaveStatus('saved');
      setTimeout(() => setUserSettingsSaveStatus('idle'), 3000);
    } catch {
      setUserSettingsSaveStatus('saved-local');
      setTimeout(() => setUserSettingsSaveStatus('idle'), 4000);
    }
    return intel;
  };

  const saveUserSettings = async (next) => {
    const incoming = next || {};
    const settings = mergeUserSettingsFields({
      ...userSettingsRef.current,
      ...incoming,
    });
    const liveSnap = serializeChatSnapshot({
      id: activeChatIdRef.current || newChatId(),
      messages: messagesRef.current,
      currentWorkflow: currentWorkflowRef.current,
      pendingWorkflow: pendingWorkflowRef.current,
      uploadedFile: uploadedFileRef.current,
      module: (chatSessionsRef.current || []).find((c) => c.id === (activeChatIdRef.current))?.module,
      createdAt: (chatSessionsRef.current || []).find((c) => c.id === (activeChatIdRef.current))?.createdAt,
    });
    const liveChats = chatHasUserContent(liveSnap.messages)
      ? upsertChatInPlace(chatSessionsRef.current, liveSnap)
      : (chatSessionsRef.current || []);
    setUserSettings(settings);
    userSettingsRef.current = settings;
    setUserSettingsSaveStatus('saving');
    try {
      if (liveChats !== chatSessionsRef.current) {
        chatSessionsRef.current = liveChats;
        setChatSessions(liveChats);
      }
      void queueUserChatsUpload(currentUser, () => buildUserChatsDocument(
        currentUser.id,
        {
          chats: chatSessionsRef.current?.length ? chatSessionsRef.current : liveChats,
          activeChatId: activeChatIdRef.current || liveSnap.id,
          userName: currentUser.name,
        },
      ));
      const ok = await queueUserSettingsUpload(currentUser, () => buildUserSettingsDocument(
        currentUser.id,
        mergeUserSettingsFields(userSettingsRef.current),
        { userName: currentUser.name },
      ));
      if (!ok) {
        const msg = lastUserSettingsUploadError(currentUser) || 'Could not save settings.json';
        setUserSettingsCloudError(msg);
        setUserSettingsSaveStatus('error');
        setTimeout(() => setUserSettingsSaveStatus('idle'), 8000);
        return;
      }
      setUserSettingsCloudError('');
      setUserSettingsSaveStatus('saved');
      setTimeout(() => setUserSettingsSaveStatus('idle'), 3000);
    } catch (err) {
      console.warn('User settings save failed:', err?.message || err);
      setUserSettingsCloudError(err?.message || String(err));
      setUserSettingsSaveStatus('error');
      setTimeout(() => setUserSettingsSaveStatus('idle'), 8000);
    }
  };

  const persistChatList = async (list, activeId) => {
    if (!userSettingsReadyRef.current) return;
    try {
      await queueUserChatsUpload(currentUser, () => buildUserChatsDocument(
        currentUser.id,
        {
          chats: list,
          activeChatId: activeId,
          userName: currentUser.name,
        },
      ));
    } catch { /* next save retries */ }
  };

  const flushActiveChat = ({ preserveUpdatedAt = false } = {}) => {
    const id = activeChatIdRef.current || newChatId();
    if (!activeChatIdRef.current) {
      activeChatIdRef.current = id;
      setActiveChatId(id);
    }
    const existing = (chatSessionsRef.current || []).find((c) => c.id === id);
    const snap = serializeChatSnapshot({
      id,
      messages: messagesRef.current,
      currentWorkflow: currentWorkflowRef.current,
      pendingWorkflow: pendingWorkflowRef.current,
      uploadedFile: uploadedFileRef.current,
      module: existing?.module,
      createdAt: existing?.createdAt,
      updatedAt: preserveUpdatedAt ? existing?.updatedAt : undefined,
    });
    const next = chatHasUserContent(snap.messages)
      ? upsertChatInPlace(chatSessionsRef.current, snap)
      : (chatSessionsRef.current || []).filter((c) => c.id !== snap.id);
    chatSessionsRef.current = next;
    setChatSessions(next);
    return { list: next, activeId: id, snap };
  };

  const resetLiveChat = (id, snapshot = null) => {
    skipChatPersistRef.current = true;
    setActiveChatId(id);
    activeChatIdRef.current = id;
    setMessages(snapshot?.messages?.length ? snapshot.messages : [consultationWelcome(currentUser.id)]);
    setCurrentWorkflow(snapshot?.currentWorkflow || null);
    setPendingWorkflow(snapshot?.pendingWorkflow || null);
    setUploadedFile(snapshot?.uploadedFile || null);
    setOrchestratorDecision(null);
    setPendingButtonAction(null);
    setPendingImageReview(null);
    pendingImageReviewRef.current = null;
    setInput('');
    setSuggestedPrompts([]);
    setPptxOffers(null);
    setPptxClarifyPending(false);
    setIsLoading(false);
    setShowLanding(false);
    setActiveTab('chat');
    setTimeout(() => { skipChatPersistRef.current = false; }, 0);
  };

  const startNewChat = () => {
    const { list } = flushActiveChat();
    const id = newChatId();
    resetLiveChat(id);
    persistChatList(list, id);
    setMobileChatHistoryOpen(false);
  };

  const continueChat = (chatId) => {
    if (chatId === activeChatIdRef.current) {
      const current = (chatSessionsRef.current || []).find((c) => c.id === chatId);
      setShowLanding(false);
      setActiveTab(chatModuleMeta(current).tab);
      setMobileChatHistoryOpen(false);
      return;
    }
    const { list } = flushActiveChat({ preserveUpdatedAt: true });
    const found = list.find((c) => c.id === chatId) || (chatSessionsRef.current || []).find((c) => c.id === chatId);
    if (!found) return;
    resetLiveChat(found.id, found);
    persistChatList(list, found.id);
    const tab = chatModuleMeta(found).tab;
    setActiveTab(tab);
    setMobileChatHistoryOpen(false);
  };

  const deleteChat = (chatId, event) => {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const next = (chatSessionsRef.current || []).filter((c) => c.id !== chatId);
    chatSessionsRef.current = next;
    setChatSessions(next);
    if (activeChatIdRef.current === chatId) {
      const id = newChatId();
      resetLiveChat(id);
      persistChatList(next, id);
      return;
    }
    persistChatList(next, activeChatIdRef.current);
  };

  const handleSignOut = () => {
    flushActiveChat();
    persistChatList(chatSessionsRef.current, activeChatIdRef.current);
    clearCurrentUser();
    window.location.reload();
  };

  const handlePptxTemplateUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const name = String(file.name || '').toLowerCase();
    if (!name.endsWith('.pptx')) {
      setPptxTemplateError('Please upload a .pptx PowerPoint file.');
      setPptxTemplateStatus('error');
      return;
    }
    setPptxTemplateError('');
    setPptxTemplateStatus('extracting');
    try {
      const theme = await extractPptxThemeFromFile(file);
      setPptxTemplateStatus('uploading');
      const storagePath = userPptxTemplateRemotePath(currentUser);
      const { error: upErr } = await supabase.storage
        .from('intelligence')
        .upload(storagePath, file, { upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
      if (upErr) throw upErr;

      const pptxTemplate = {
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        storagePath,
        storageBucket: 'intelligence',
        theme: themeToSettingsMeta(theme),
      };
      await saveUserSettings({ ...userSettings, pptxTemplate });
      setPptxTemplateStatus('idle');
    } catch (e) {
      console.error('PPTX template upload failed:', e);
      setPptxTemplateError(e.message || 'Failed to process PowerPoint template');
      setPptxTemplateStatus('error');
    }
  };

  const handleRemovePptxTemplate = async () => {
    const path = userSettings.pptxTemplate?.storagePath || userPptxTemplateRemotePath(currentUser);
    try {
      await supabase.storage.from('intelligence').remove([path]);
    } catch { /* ignore missing file */ }
    await saveUserSettings({ ...userSettings, pptxTemplate: null });
    setPptxTemplateError('');
    setPptxTemplateStatus('idle');
  };

  const buildAgentKnowledge = (agent) => {
    const keys = agent.knowledgeFiles || [];
    if (!keys.length) return '';
    const active = documents.filter((d) => d.status === 'active' && d.content);
    const selected = keys.includes('*')
      ? active
      : active.filter((d) => keys.some((k) => d.name === k || d.name.endsWith(`/${k}`) || d.id === k));
    return selected.map((d, i) => `${isAdmin ? `## ${d.name}` : `## Best-practice guidance ${i + 1}`}\n${d.content}`).join('\n\n');
  };

  const runAgent = async (agent, step, messages, { autoAdvance = false } = {}) => {
    const knowledge = buildAgentKnowledge(agent);
    const rt = getWorkflowRuntime();
    const taskBlock = fillTemplate(rt.agentTaskWrapper, {
      stepNumber: step.step,
      stepName: step.name,
      stepGoal: step.goal,
      successCriteria: step.successCriteria,
    });
    const clarifyingPolicy = autoAdvance
      ? (rt.autoAdvanceClarifyingPolicy || '')
      : (rt.waitForClarifyingPolicy || '');
    const system = withUserSettings(`${agent.systemPrompt}
${knowledge ? `\n\nKNOWLEDGE BASE:\n${knowledge}` : ''}

${taskBlock}

${clarifyingPolicy}`);
    return await callAnthropic(system, messages, scaleUserFacingMaxTokens(3000, userSettings));
  };

  const normalizeOrchestratorAction = (action) => {
    const a = String(action || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
    if (['proceed', 'continue', 'next', 'advance', 'approve', 'accept', 'yes', 'ok', 'okay', 'go', 'go_ahead', 'move_on', 'confirm'].includes(a)) {
      return 'proceed';
    }
    if (['override', 'force', 'ignore_risk', 'ignore'].includes(a)) return 'override';
    if (['redesign', 'send_back', 'rollback', 'rework', 'restart'].includes(a)) return 'redesign';
    if (['refine', 'revise', 'edit', 'update', 'custom', 'change', 'tweak', 'adjust'].includes(a)) return 'refine';
    return a || 'proceed';
  };

  /** True when the agent is clearly waiting on the user (clarifying questions). */
  const agentResponseAwaitsUser = (text) => {
    if (!text) return false;
    const t = String(text);
    // Numbered clarifying list with at least one question mark (1. …? 2. …?)
    const numberedQs = [...t.matchAll(/(?:^|\n)\s*(?:\*\*)?([1-9])(?:\*\*)?\s*[.:)\]]\s+.+\?/gm)];
    if (numberedQs.length >= 1) return true;
    // Explicit "waiting on you" phrasing near a question
    if (/\b(please (tell|confirm|clarify|provide|answer|share|reply)|before (we|I) (proceed|continue)|I need (you to|a few|more|the following)|clarif(?:y|ication) (questions?|needed)|which of the following)\b/i.test(t)
      && (t.match(/\?/g) || []).length >= 1) {
      return true;
    }
    // Trailing single ask after a short response (not a long report that mentions "what's working")
    const trimmed = t.trim();
    if (trimmed.length < 900 && /\?\s*$/.test(trimmed) && (trimmed.match(/\?/g) || []).length <= 2) {
      return true;
    }
    return false;
  };

  const normalizeOrchestratorEvaluation = (evaluation, topic, stepIndex) => {
    const isLastStep = stepIndex >= (topic.workflow?.length || 1) - 1;
    const ev = evaluation && typeof evaluation === 'object' ? { ...evaluation } : {};
    // Never end the whole workflow before the last specialist has run
    if (!isLastStep) ev.workflowComplete = false;

    // Auto-advance: never block on clarifying questions — continue with available info
    if (topic.autoAdvance && ev.agentStillWorking) {
      ev.agentStillWorking = false;
      ev.stepComplete = true;
      if (!ev.orchestratorMessage) {
        ev.orchestratorMessage = isLastStep
          ? 'Continuing with evidenced information only (information gaps flagged — no assumptions). Wrapping up…'
          : 'Continuing with evidenced information only (information gaps flagged — no assumptions). Advancing to the next specialist…';
      }
    }

    if (ev.agentStillWorking) {
      ev.stepComplete = false;
      ev.buttons = [];
      ev.orchestratorMessage = '';
      ev.workflowComplete = false;
      return ev;
    }
    // Intermediate steps: ensure a clear proceed path to the next agent
    if (!isLastStep && !topic.autoAdvance) {
      const buttons = Array.isArray(ev.buttons) ? [...ev.buttons] : [];
      const hasProceed = buttons.some((b) => normalizeOrchestratorAction(b.action) === 'proceed');
      if (!hasProceed) {
        buttons.unshift({ label: '✅ Continue to next step', action: 'proceed', requiresInput: false, inputPrompt: '' });
      }
      if (!buttons.some((b) => normalizeOrchestratorAction(b.action) === 'refine')) {
        buttons.push({ label: '✏️ Refine', action: 'refine', requiresInput: true, inputPrompt: 'What would you like to refine?' });
      }
      ev.buttons = buttons;
      if (!ev.orchestratorMessage) {
        const next = topic.workflow[stepIndex + 1];
        ev.orchestratorMessage = next
          ? `Step ${stepIndex + 1} is done. Next up: **${next.name}** (${next.goal}).`
          : (topic.orchestrator?.evalFallbackMessage || DEFAULT_ORCHESTRATOR_PROMPTS.evalFallbackMessage);
      }
    }
    return ev;
  };

  const orchestratorEvaluate = async (topic, step, agentResponse, workflowContext, stepIndex = 0) => {
    const orch = topic.orchestrator || {};
    const stepList = topic.workflow.map(s => `Step ${s.step} (index ${s.step - 1}): ${s.name} — agent: ${s.agents[0]}`).join('\n');
    const isLastStep = stepIndex >= topic.workflow.length - 1;
    const evaluatePrompt = orch.evaluatePrompt || DEFAULT_ORCHESTRATOR_PROMPTS.evaluatePrompt;
    const system = withUserSettings(`${orch.role}
Overall goal: ${orch.goal}
${orch.approach ? `\nApproach rules:\n${orch.approach}` : ''}

Workflow steps:
${stepList}

${evaluatePrompt}`);

    const contextStr = workflowContext.map(c => `[${c.step}] ${c.agent}: ${c.output.substring(0, 300)}`).join('\n\n');
    const userContent = `Workflow: ${topic.name}
Current step: ${step.step} of ${topic.workflow.length} — ${step.name}
Is last step: ${isLastStep ? 'YES' : 'NO (more specialists must still run)'}
Auto-advance: ${topic.autoAdvance ? 'YES (do not wait — continue using only evidenced facts; flag missing info as gaps; NEVER invent or assume)' : 'NO (wait if clarifying questions are unanswered)'}
Success criteria for THIS step only: ${step.successCriteria}

Agent response:
${agentResponse.substring(0, 2000)}

Previous context:
${contextStr || 'None'}

Rules:
- If Auto-advance is YES: set agentStillWorking=false even if gaps were flagged — the pipeline continues. Gaps are findings, not reasons to invent facts.
- If Auto-advance is NO and the agent asked unanswered clarifying questions, agentStillWorking=true.
- workflowComplete may be true ONLY when Is last step is YES and this step's success criteria are met (or best-effort deliverable under auto-advance, with gaps listed).
- If Is last step is NO, workflowComplete MUST be false.`;

    const raw = await callAnthropic(system, [{ role: 'user', content: userContent }], 1200);
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (!topic.autoAdvance && agentResponseAwaitsUser(agentResponse)) {
        parsed = {
          ...parsed,
          agentStillWorking: true,
          stepComplete: false,
          buttons: [],
          orchestratorMessage: '',
          workflowComplete: false,
        };
      }
    } catch {
      if (!topic.autoAdvance && agentResponseAwaitsUser(agentResponse)) {
        parsed = {
          agentStillWorking: true, stepComplete: false, rerouteToStep: null, rerouteBriefing: '', handoffs: [],
          buttons: [], orchestratorMessage: '', workflowComplete: false,
        };
      } else {
        parsed = {
          agentStillWorking: false, stepComplete: true, rerouteToStep: null, rerouteBriefing: '', handoffs: [],
          buttons: [{ label: '✅ Continue', action: 'proceed', requiresInput: false, inputPrompt: '' }, { label: '✏️ Refine', action: 'refine', requiresInput: true, inputPrompt: 'What would you like to refine?' }],
          orchestratorMessage: orch.evalFallbackMessage || DEFAULT_ORCHESTRATOR_PROMPTS.evalFallbackMessage,
          workflowComplete: false,
        };
      }
    }
    return normalizeOrchestratorEvaluation(parsed, topic, stepIndex);
  };

  const executeHandoff = async (agentId, task) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent || agent.status !== 'active') return null;
    const knowledge = buildAgentKnowledge(agent);
    const system = withUserSettings(`${agent.systemPrompt}
${knowledge ? `\n\nKNOWLEDGE BASE:\n${knowledge}` : ''}
${getWorkflowRuntime().handoffAddon}`);
    return await callAnthropic(system, [{ role: 'user', content: task }], scaleUserFacingMaxTokens(2000, userSettings));
  };

  const executeOrchestrator = async (topic, userMessage, stepIndex = null, focusedContextOverride = null) => {
    const currentStep = stepIndex !== null ? stepIndex : (currentWorkflow?.currentStep || 0);
    const workflowContext = currentWorkflow?.context || [];
    const focusedContext = focusedContextOverride ?? currentWorkflow?.focusedContext ?? null;
    const isIntro = currentStep === 0 && workflowContext.length === 0;

    if (isIntro) {
      logActivity('orchestrator', `Starting workflow: ${topic.name}`);
      const firstAgent = agents.find(a => a.id === topic.workflow[0].agents[0]);
      const isFocused = !!focusedContext;
      const stepCount = topic.workflow.length;
      const stepsBlock = topic.workflow
        .map((s) => `**Step ${s.step}: ${s.name}** — ${s.goal}`)
        .join('\n');
      const orch = topic.orchestrator || {};
      const introInstr = isFocused
        ? (orch.introFocused || DEFAULT_ORCHESTRATOR_PROMPTS.introFocused)
        : (orch.introFull || DEFAULT_ORCHESTRATOR_PROMPTS.introFull);
      const introSystem = withUserSettings(`${orch.role}
${introInstr}`);
      const introLead = await callAnthropic(
        introSystem,
        [{ role: 'user', content: `The user wants to: ${userMessage}\n\nOverall orchestrator goal: ${orch.goal}` }],
        400,
      );
      const handoff = `I'll now hand you to **${firstAgent?.name || 'the first specialist'}** to begin.`;
      const introResponse = isFocused
        ? `${introLead}\n\n${handoff}`
        : `${introLead}\n\n**Full plan (${stepCount} steps):**\n\n${stepsBlock}\n\n${handoff}`;
      setMessages(prev => [...prev, { role: 'orchestrator', content: introResponse }]);
      setIsLoading(false);
      setTimeout(async () => {
        setIsLoading(true);
        try {
          await runWorkflowStep(topic, 0, userMessage, [], focusedContext);
        } catch (err) {
          setMessages((prev) => [...prev, {
            role: 'system',
            content: `⚠️ Workflow step failed: ${err.message || 'Unknown error'}`,
          }]);
        } finally {
          setIsLoading(false);
        }
      }, 800);
      return;
    }
    await runWorkflowStep(topic, currentStep, userMessage, workflowContext, focusedContext);
  };

  const launchWorkflowDirect = async (topicId, userMessage, focusedContext = null) => {
    const topic = topics.find(t => t.id === topicId);
    if (!topic) {
      setMessages((prev) => [...prev, {
        role: 'system',
        content: `⚠️ Cannot start workflow \`${topicId}\` — it is missing from settings.`,
      }]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setPptxOffers(null);
    setCurrentWorkflow({ topicId: topic.id, currentStep: 0, context: [], waitingForUser: false, focusedContext });
    setPendingWorkflow(null);
    logActivity('workflow', `Direct launch: ${topic.name}`);
    try {
      await executeOrchestrator(topic, userMessage, 0, focusedContext);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'system',
        content: `⚠️ Could not start workflow: ${err.message || 'Unknown error'}`,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const continueAgentWithUserReply = async (topic, stepIndex, userReply, workflowContext) => {
    const step = topic.workflow[stepIndex];
    const agentId = step.agents[0];
    const agent = agents.find(a => a.id === agentId);
    if (!agent || agent.status !== 'active') {
      setMessages(prev => [...prev, { role: 'system', content: `⚠️ Agent "${agentId}" not available` }]);
      setIsLoading(false);
      return;
    }
    logActivity('agent', `${agent.name} continuing conversation`);
    const priorAsk = [...(currentWorkflow?.stepMessages || []), ...(messagesRef.current || [])]
      .reverse()
      .find((m) => m.role === 'assistant' || m.role === 'orchestrator');
    void harvestChatMemory(priorAsk?.content, userReply);
    try {
      const priorMessages = currentWorkflow?.stepMessages || [];
      const fullMessages = [...priorMessages, { role: 'user', content: userReply }];
      const agentResponse = await runAgent(agent, step, fullMessages, { autoAdvance: !!topic.autoAdvance });
      setMessages(prev => [...prev, { role: 'assistant', content: `**[${agent.name}]**\n\n${agentResponse}` }]);
      const updatedStepMessages = [...fullMessages, { role: 'assistant', content: agentResponse }];
      logActivity('orchestrator', `Evaluating Step ${stepIndex + 1} after user reply`);
      const evaluation = await orchestratorEvaluate(topic, step, agentResponse, workflowContext, stepIndex);

      if (evaluation.agentStillWorking && !topic.autoAdvance) {
        setOrchestratorDecision(null);
        setSuggestedPrompts([]);
        setCurrentWorkflow(prev => prev ? {
          ...prev,
          currentStep: stepIndex,
          waitingForUser: true,
          awaitingAgentReply: true,
          stepMessages: updatedStepMessages,
        } : null);
        setIsLoading(false);
        return;
      }

      const handoffMatches = [...agentResponse.matchAll(/REQUIRES_HANDOFF:\s*(\S+)\s*-\s*(.+)/gi)];
      const allHandoffs = [...handoffMatches.map(m => ({ agentId: m[1], task: m[2] })), ...(evaluation.handoffs || [])];
      const handoffOutputs = [];
      for (const handoff of allHandoffs) {
        const handoffAgent = agents.find(a => a.id === handoff.agentId);
        if (!handoffAgent) continue;
        setMessages(prev => [...prev, { role: 'orchestrator', content: `🔀 **Routing to ${handoffAgent.name}:** ${handoff.task}` }]);
        const handoffResponse = await executeHandoff(handoff.agentId, handoff.task);
        if (handoffResponse) {
          setMessages(prev => [...prev, { role: 'assistant', content: `**[${handoffAgent.name}]**\n\n${handoffResponse}` }]);
          handoffOutputs.push({ agent: handoffAgent.name, output: handoffResponse.substring(0, 500) });
        }
      }
      const updatedContext = [...workflowContext, {
        step: `Step ${step.step}: ${step.name}`,
        agent: agent.name,
        output: agentResponse.substring(0, topic.id === 'analyze_ic' ? 20000 : 12000),
        handoffs: handoffOutputs,
      }];
      await finishWorkflowStep(
        evaluation,
        topic,
        stepIndex,
        updatedContext,
        userReply,
        updatedStepMessages,
        currentWorkflow?.focusedContext ?? null,
      );
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', content: `⚠️ Error: ${err.message}` }]);
      setIsLoading(false);
    }
  };

  /** Map a free-text reply to an orchestrator decision action while Continue buttons are showing. */
  const resolveOrchestratorTypedAction = (text, decision) => {
    const t = String(text || '').trim();
    const lower = t.toLowerCase();
    if (/^(y|yes|yeah|yep|sure|ok|okay|continue|proceed|next|go ahead|looks good|lgtm|approve|approved|move on|sounds good)[\s.!]*$/i.test(lower)) {
      return 'proceed';
    }
    for (const btn of decision?.buttons || []) {
      const label = String(btn.label || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      if (label && lower.includes(label)) return normalizeOrchestratorAction(btn.action);
      const act = normalizeOrchestratorAction(btn.action);
      if (act === 'proceed' && /\b(continue|proceed|next|approve)\b/i.test(lower) && t.length < 80) return 'proceed';
    }
    if (/\b(refine|revise|change|redo|redesign|update|tweak|adjust|instead)\b/i.test(lower)) return 'refine';
    // Short affirmative-ish → advance; longer text is feedback to refine the current step
    if (t.length <= 24) return 'proceed';
    return 'refine';
  };

  const postOrchestratorDecision = (evaluation, topic, stepIndex, updatedContext, userMessage) => {
    if (evaluation.agentStillWorking) {
      setOrchestratorDecision(null);
      return;
    }
    if (evaluation.orchestratorMessage) setMessages(prev => [...prev, { role: 'orchestrator', content: evaluation.orchestratorMessage }]);
    const buttons = (evaluation.buttons || []).map((btn) => ({
      ...btn,
      action: normalizeOrchestratorAction(btn.action),
    }));
    if (buttons.length > 0) {
      setOrchestratorDecision({
        buttons,
        topic,
        stepIndex,
        context: updatedContext,
        userMessage,
        rerouteToStep: evaluation.rerouteToStep,
        rerouteBriefing: evaluation.rerouteBriefing,
      });
    }
  };

  /** After a step finishes (not waiting on clarifying answers): wrap up, auto-advance, or show Continue. */
  const finishWorkflowStep = async (evaluation, topic, stepIndex, updatedContext, userMessage, stepMessages, focusedContext = null) => {
    const isLastStep = stepIndex >= topic.workflow.length - 1;
    if (evaluation.workflowComplete && isLastStep) {
      if (evaluation.orchestratorMessage) setMessages(prev => [...prev, { role: 'orchestrator', content: evaluation.orchestratorMessage }]);
      await wrapUpWorkflow(topic, updatedContext);
      return;
    }
    // Auto-advance pipelines: always continue to next step or wrap up — never pause for Continue / clarifying
    if (topic.autoAdvance) {
      setOrchestratorDecision(null);
      if (isLastStep) {
        if (evaluation.orchestratorMessage) setMessages(prev => [...prev, { role: 'orchestrator', content: evaluation.orchestratorMessage }]);
        await wrapUpWorkflow(topic, updatedContext);
        return;
      }
      const next = topic.workflow[stepIndex + 1];
      setMessages(prev => [...prev, {
        role: 'orchestrator',
        content: evaluation.orchestratorMessage
          || `✅ Step ${stepIndex + 1} complete. Advancing to **${next?.name}**…`,
      }]);
      setCurrentWorkflow(prev => prev ? {
        ...prev,
        currentStep: stepIndex,
        context: updatedContext,
        waitingForUser: false,
        awaitingAgentReply: false,
        stepMessages: [],
        focusedContext: focusedContext ?? prev.focusedContext,
      } : null);
      await advanceToNextStep(topic, stepIndex, updatedContext, userMessage, focusedContext);
      return;
    }
    logActivity('orchestrator', `Step ${stepIndex + 1} awaiting user decision`);
    postOrchestratorDecision(evaluation, topic, stepIndex, updatedContext, userMessage);
    setCurrentWorkflow(prev => prev ? {
      ...prev,
      currentStep: stepIndex,
      context: updatedContext,
      waitingForUser: true,
      awaitingAgentReply: false,
      stepMessages: stepMessages || [],
      focusedContext: focusedContext ?? prev.focusedContext,
    } : null);
    setIsLoading(false);
  };

  const handleOrchestratorAction = async (action, decision, typedInput = null) => {
    setOrchestratorDecision(null);
    setIsLoading(true);
    const { topic, stepIndex, context, userMessage, rerouteToStep, rerouteBriefing } = decision;
    const effectiveInput = typedInput || userMessage;
    const focusedContext = currentWorkflow?.focusedContext ?? null;
    const normalized = normalizeOrchestratorAction(action);
    if (normalized === 'proceed') {
      setCurrentWorkflow(prev => prev ? { ...prev, waitingForUser: false, awaitingAgentReply: false, stepMessages: [] } : null);
      await advanceToNextStep(topic, stepIndex, context, effectiveInput, focusedContext);
    } else if (normalized === 'redesign' || normalized === 'send_back') {
      const targetIdx = (rerouteToStep !== null && rerouteToStep !== undefined) ? rerouteToStep : Math.max(0, stepIndex - 1);
      const targetStep = topic.workflow[targetIdx];
      const targetAgent = agents.find(a => a.id === targetStep?.agents[0]);
      setMessages(prev => [...prev, { role: 'orchestrator', content: `🔄 Routing back to **${targetStep?.name}** (${targetAgent?.name}) for rework.` }]);
      setCurrentWorkflow(prev => prev ? { ...prev, currentStep: targetIdx, context, waitingForUser: false, awaitingAgentReply: false, stepMessages: [] } : null);
      await runWorkflowStep(topic, targetIdx, rerouteBriefing || effectiveInput, context, focusedContext);
    } else if (normalized === 'override') {
      setMessages(prev => [...prev, { role: 'orchestrator', content: `⚠️ Override accepted. Proceeding with noted risks.` }]);
      setCurrentWorkflow(prev => prev ? { ...prev, waitingForUser: false, awaitingAgentReply: false, stepMessages: [] } : null);
      await advanceToNextStep(topic, stepIndex, context, effectiveInput, focusedContext);
    } else {
      // refine / unknown → rework current step with the user's feedback (never silently "continue")
      const briefing = typedInput
        ? `User feedback on this step — revise accordingly:\n${typedInput}`
        : `User instruction: ${action}. Please refine your work accordingly.`;
      setMessages(prev => [...prev, { role: 'orchestrator', content: `✏️ Refining **${topic.workflow[stepIndex]?.name || 'this step'}** with your feedback.` }]);
      setCurrentWorkflow(prev => prev ? { ...prev, currentStep: stepIndex, waitingForUser: false, awaitingAgentReply: false, stepMessages: [] } : null);
      await runWorkflowStep(topic, stepIndex, briefing, context, focusedContext);
    }
    setIsLoading(false);
  };

  const advanceToNextStep = async (topic, completedStepIndex, updatedContext, userMessage, focusedContext = null) => {
    const nextStep = completedStepIndex + 1;
    if (nextStep < topic.workflow.length) {
      setCurrentWorkflow(prev => prev ? {
        ...prev,
        currentStep: nextStep,
        context: updatedContext,
        waitingForUser: false,
        stepMessages: [],
        focusedContext: focusedContext ?? prev.focusedContext,
      } : null);
      setTimeout(async () => {
        setIsLoading(true);
        await runWorkflowStep(topic, nextStep, userMessage, updatedContext, focusedContext);
        setIsLoading(false);
      }, 800);
    } else {
      await wrapUpWorkflow(topic, updatedContext);
    }
  };

  const wrapUpWorkflow = async (topic, updatedContext) => {
    const wrapSystem = withUserSettings(`${topic.orchestrator?.role || ''}\n${topic.orchestrator?.wrapUpPrompt || DEFAULT_ORCHESTRATOR_PROMPTS.wrapUpPrompt}`);
    const wrapSummary = await callAnthropic(wrapSystem, [{ role: 'user', content: `Completed: ${topic.name}\n${updatedContext.map(c => `${c.step}: ${c.output.substring(0, 150)}`).join('\n')}` }], 300);
    setMessages(prev => {
      const updated = [...prev, { role: 'orchestrator', content: wrapSummary }];
      setTimeout(() => generateSuggestions(updated), 800);
      return updated;
    });
    setMessages(prev => [...prev, { role: 'system', content: `✅ **Workflow complete** — ${topic.workflow.length} steps finished.` }]);
    setCurrentWorkflow(null);
    setIsLoading(false);
  };

  const runWorkflowStep = async (topic, stepIndex, userMessage, workflowContext, focusedContextOverride = null) => {
    const step = topic.workflow[stepIndex];
    const agentId = step.agents[0];
    const agent = agents.find(a => a.id === agentId);
    if (!agent || agent.status !== 'active') {
      setMessages(prev => [...prev, { role: 'system', content: `⚠️ Agent "${agentId}" not available` }]);
      setIsLoading(false);
      return;
    }
    logActivity('orchestrator', `Step ${stepIndex + 1}/${topic.workflow.length}: briefing ${agent.name}`);
    setMessages(prev => [...prev, { role: 'system', content: `📍 **Step ${step.step}/${topic.workflow.length}: ${step.name}** — 🤖 ${agent.name}` }]);
    try {
      let taskBriefing = userMessage;
      const isTerritoryWorkflow = topic.id === 'territory_assessment';
      const isAnalyzeWorkflow = topic.id === 'analyze_ic';
      const isStructureStep = stepIndex === 0;
      const focusedContext = focusedContextOverride ?? currentWorkflow?.focusedContext ?? null;
      if (isAnalyzeWorkflow && focusedContext) {
        if (isStructureStep) {
          taskBriefing = `${focusedContext}

User request: ${userMessage}

INSTRUCTION: This is ONLY Step 1 of 4 (Extract & Analyze). Your job:
1) Extract scheme structure from the uploaded proposal (text + any image/table/payout-scale extracts)
2) Assess against the 6 Fundamental Axes / best practices
3) Note strengths and gaps briefly — treat missing payment-scale evidence as an information gap if images were not readable

Do NOT run a full compliance checklist (Step 2), narrative report (Step 3), or recommendations table (Step 4). Stop when extract + axes assessment is done.
${topic.autoAdvance
  ? 'AUTO-ADVANCE is ON: do not ask clarifying questions and wait. Use ONLY facts evidenced in the document/images. NEVER invent or assume missing details — list INFORMATION GAPS (treat material gaps as critical findings) and continue.'
  : 'Only ask short numbered clarifying questions for gaps that are truly missing from the extracted text (user will reply 1 = … 2 = …).'}`;
        } else {
          // Pass prior step outputs DIRECTLY — do not rely on a short orchestrator rebrief (it drops findings).
          const perStepCap = agentId === 'assessment_summary_agent' ? 18000 : 10000;
          const priorFindings = (workflowContext || []).map((c) => {
            const body = String(c.output || '').slice(0, perStepCap);
            const handoffs = (c.handoffs || []).map((h) => `  - ${h.agent}: ${String(h.output || '').slice(0, 800)}`).join('\n');
            return `### ${c.step} — ${c.agent}\n${body}${handoffs ? `\nHandoffs:\n${handoffs}` : ''}`;
          }).join('\n\n');
          const proposalBundle = String(focusedContext || '');
          const textPart = proposalBundle.match(/EXTRACTED DOCUMENT \/ SLIDE TEXT:[\s\S]*?(?=\n\nEXTRACTED FROM |\s*$)/)?.[0]
            || proposalBundle.slice(0, 12000);
          const visionPart = proposalBundle.match(/EXTRACTED FROM SCHEME IMAGES[\s\S]*$/)?.[0]
            || proposalBundle.match(/EXTRACTED FROM NATIVE CHARTS[\s\S]*$/)?.[0]
            || '';
          const structuredPart = proposalBundle.match(/EXTRACTED FROM NATIVE CHARTS \/ EMBEDDED SPREADSHEETS[\s\S]*?(?=\n\nEXTRACTED FROM SCHEME IMAGES|\s*$)/)?.[0] || '';
          const proposalExcerpt = [
            textPart.slice(0, 14000),
            structuredPart.slice(0, 8000),
            visionPart.slice(0, 14000),
          ].filter(Boolean).join('\n\n');

          const isFinalSummary = agentId === 'assessment_summary_agent' || stepIndex === (topic.workflow.length - 1);
          const stepInstruction = isFinalSummary
            ? `INSTRUCTION: This is the FINAL step (Assessment Summary). You HAVE prior specialist outputs below — use them.
1) Write a short executive summary of findings (strengths, weaknesses, compliance issues, information gaps).
2) Produce a markdown Recommendations table: | Priority | Recommendation | Rationale / explanation | Evidence basis | Severity if unaddressed |
3) Include INFORMATION GAPS as recommendation rows when material facts were missing.
4) End with Next actions.
Do NOT claim you lack prior context if PRIOR STEP FINDINGS is non-empty. Do NOT invent numbers not present in findings or proposal extracts.`
            : `INSTRUCTION: This is Step ${step.step} of ${topic.workflow.length} (${step.name}).
Goal: ${step.goal}
Success criteria: ${step.successCriteria}
Use PRIOR STEP FINDINGS and the proposal extracts. Do not repeat earlier steps wholesale; advance this step's goal. Never invent missing scheme details — flag INFORMATION GAPS.`;

          taskBriefing = `User request: ${userMessage}

## PRIOR STEP FINDINGS (authoritative inputs from earlier specialists)
${priorFindings || '(none yet)'}

## UPLOADED PROPOSAL EXTRACTS (slide text + scheme images/charts)
${proposalExcerpt || '(no proposal extract)'}

${stepInstruction}`;
        }
      } else if (isTerritoryWorkflow && isStructureStep && territoryStructures.length > 0) {
        const activeStruct = territoryStructures.find(s => s.id === selectedTerritoryStructure) || territoryStructures[0];
        if (focusedContext) {
          taskBriefing = `${focusedContext}\n\nINSTRUCTION: The user wants to assess the FOCUS TERRITORY marked above. Begin by presenting a brief profile then ask what specific aspects the user wants to explore.`;
        } else {
          const structSummary = `LOADED TERRITORY STRUCTURE: "${activeStruct.name}"\nManagers: ${activeStruct.managers.map(m => `${m.name} (${m.region})`).join(', ')}\nTerritories (${activeStruct.territories.length} total):\n${activeStruct.territories.slice(0, 20).map(t => `  ${t.id} ${t.name} | Rep: ${t.rep} | HCPs: A=${t.hcps.A} B=${t.hcps.B} C=${t.hcps.C} Total=${t.hcps.A+t.hcps.B+t.hcps.C}`).join('\n')}`;
          taskBriefing = `${structSummary}\n\nUser request: ${userMessage}\n\nAsk: (1) Use this structure or provide a different one? (2) Cover all territories or focus on specific region?`;
        }
      } else if (workflowContext.length > 0) {
        const contextSummary = workflowContext.map(c => `[${c.step}] ${c.agent}: ${c.output}`).join('\n\n');
        const briefingSystem = withUserSettings(`${topic.orchestrator?.role || ''}\n${topic.orchestrator?.briefingPrompt || DEFAULT_ORCHESTRATOR_PROMPTS.briefingPrompt}`);
        const briefingPrompt = `Context from prior steps:\n${contextSummary}\n\nNext agent: ${agent.name}\nTask: Step ${step.step} - ${step.name}\nGoal: ${step.goal}\nUser's message: ${userMessage}\n\nWrite the briefing.`;
        taskBriefing = await callAnthropic(briefingSystem, [{ role: 'user', content: briefingPrompt }], 300);
      }
      const initialMessages = [{ role: 'user', content: taskBriefing }];
      logActivity('agent', `Running ${agent.name}`);
      const agentResponse = await runAgent(agent, step, initialMessages, { autoAdvance: !!topic.autoAdvance });
      setMessages(prev => [...prev, { role: 'assistant', content: `**[${agent.name}]**\n\n${agentResponse}` }]);
      const initialStepMessages = [...initialMessages, { role: 'assistant', content: agentResponse }];
      const handoffMatches = [...agentResponse.matchAll(/REQUIRES_HANDOFF:\s*(\S+)\s*-\s*(.+)/gi)];
      const agentHandoffs = handoffMatches.map(m => ({ agentId: m[1], task: m[2] }));
      logActivity('orchestrator', `Evaluating Step ${stepIndex + 1}`);
      const evaluation = await orchestratorEvaluate(topic, step, agentResponse, workflowContext, stepIndex);

      if (evaluation.agentStillWorking && !topic.autoAdvance) {
        setOrchestratorDecision(null);
        setSuggestedPrompts([]);
        logActivity('orchestrator', `Step ${stepIndex + 1} waiting for user answers`);
        setCurrentWorkflow(prev => prev ? {
          ...prev,
          currentStep: stepIndex,
          waitingForUser: true,
          awaitingAgentReply: true,
          stepMessages: initialStepMessages,
        } : null);
        setIsLoading(false);
        return;
      }

      const allHandoffs = [...agentHandoffs, ...(evaluation.handoffs || [])];
      const handoffOutputs = [];
      for (const handoff of allHandoffs) {
        const handoffAgent = agents.find(a => a.id === handoff.agentId);
        if (!handoffAgent) continue;
        logActivity('orchestrator', `Routing to ${handoffAgent.name}`);
        setMessages(prev => [...prev, { role: 'orchestrator', content: `🔀 **Routing to ${handoffAgent.name}:** ${handoff.task}` }]);
        const handoffResponse = await executeHandoff(handoff.agentId, handoff.task);
        if (handoffResponse) {
          setMessages(prev => [...prev, { role: 'assistant', content: `**[${handoffAgent.name}]**\n\n${handoffResponse}` }]);
          handoffOutputs.push({ agent: handoffAgent.name, output: handoffResponse.substring(0, 500) });
        }
      }
      const updatedContext = [...workflowContext, {
        step: `Step ${step.step}: ${step.name}`,
        agent: agent.name,
        output: agentResponse.substring(0, isAnalyzeWorkflow ? 20000 : 12000),
        handoffs: handoffOutputs,
      }];
      await finishWorkflowStep(evaluation, topic, stepIndex, updatedContext, userMessage, initialStepMessages, focusedContext);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', content: `⚠️ Orchestrator error: ${err.message}` }]);
      setIsLoading(false);
    }
  };

  const moduleLabelFor = (id) => CHAT_MODULE_META[id]?.label || id;

  const extractDocumentForIngest = async (file, { classifyPrompt, onStatus } = {}) => {
    const { kind, label } = detectContextFileKind(file);
    if (kind === 'ppt') throw new Error('Legacy .ppt is not supported — please upload .pptx, PDF, or Excel.');
    onStatus?.(`Extracting text from **${file.name}**…`);
    let extractedText = '';
    if (kind === 'excel' || kind === 'csv') extractedText = String(await extractSpreadsheetText(file) || '').trim();
    else extractedText = String(await extractProposalText(file) || '').trim();

    let included = [];
    let unsure = [];
    let skipped = [];
    let imageNotes = [];
    let structuredText = '';
    if (kind === 'pdf' || kind === 'pptx') {
      onStatus?.('Scanning embedded images — keeping useful content, skipping logos/decoration…');
      try {
        const extracted = await extractProposalImages(file, { textLength: extractedText.length });
        const finalized = await finalizeProposalImages(
          extracted,
          classifyPrompt || withUserSettings(getWorkflowRuntime().proposalImageClassifyPrompt, { moduleContext: false }),
        );
        const images = finalized.images || [];
        unsure = finalized.unsure || [];
        skipped = finalized.skipped || [];
        const classifications = finalized.classifications || [];
        imageNotes = finalized.notes || [];
        structuredText = finalized.structuredText || '';
        const classByName = Object.fromEntries(classifications.map((c) => [c.name, c]));
        included = images.map((img) => ({
          ...img,
          purpose: classByName[img.name]?.purpose || img.purpose || 'scheme_content',
          reason: classByName[img.name]?.reason || img.reason,
        }));
      } catch (err) {
        imageNotes = [err.message || 'Image scan skipped'];
      }
    }
    return { kind, fileType: label, extractedText, structuredText, included, unsure, skipped, imageNotes };
  };

  const runContextIntakeTurn = async ({ extractBlob, moduleLabel: label, intakeMessages }) => {
    const rt = getWorkflowRuntime();
    const system = fillTemplate(rt.contextIntakePrompt, { moduleLabel: label });
    const convo = [
      { role: 'user', content: `THIS FILE ONLY (do not ask about anything else):\n${String(extractBlob || '').slice(0, 16000)}` },
      ...(intakeMessages || []).map((m) => ({ role: toAnthropicRole(m.role), content: m.content })),
    ];
    let parsed = {};
    let raw = '';
    try {
      raw = await callAnthropic(system, convo, 900);
      parsed = extractJsonObject(raw) || {};
    } catch { /* fall through */ }
    const message = parsed.message
      || (parsed.complete ? 'Thanks — I have enough context to use this file.' : (String(raw).trim() || 'Is anything in this file still unclear?'));
    return {
      complete: !!parsed.complete,
      message,
      context_qa: parsed.context_qa || null,
    };
  };

  const summarizeContextFile = async ({ name, extractBlob, moduleId, columns = [] }) => {
    const fallback = { summary: '', columns: [], suggestedQuestions: [] };
    if (isThinContextExtract(extractBlob, name)) return fallback;
    const rt = getWorkflowRuntime();
    const system = fillTemplate(rt.contextContentSummaryPrompt, {
      moduleLabel: moduleLabelFor(moduleId),
    });
    const colText = columns.length ? `\n\nDETECTED COLUMNS:\n${columns.map((c) => `- ${c.name}`).join('\n')}` : '';
    const raw = await callAnthropic(system, [{
      role: 'user',
      content: `FILE NAME: ${name}\nStored under: ${moduleLabelFor(moduleId)} (storage location only — not a topic to ask about).${colText}\n\nFILE CONTENTS:\n${String(extractBlob || '').slice(0, 18000)}`,
    }], 1000);
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const questions = (Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions : [])
      .map((q) => String(q || '').replace(/\s+/g, ' ').trim())
      .filter((q) => q.length >= 8 && !isEmptyContextValue(q))
      .slice(0, 5);
    const columnsOut = (Array.isArray(parsed.columns) ? parsed.columns : [])
      .filter((c) => c && !isEmptyContextValue(c.name));
    const summary = isEmptyContextValue(parsed.summary) ? '' : String(parsed.summary).trim();
    return { summary, columns: columnsOut, suggestedQuestions: questions };
  };

  const completeProposalIngest = async (job) => {
    setIsLoading(true);
    pendingImageReviewRef.current = null;
    setPendingImageReview(null);
    let visionText = '';
    let visionError = '';
    try {
      const file = job?.file;
      const fileType = job?.fileType;
      const extractedText = job?.extractedText || '';
      const structuredText = job?.structuredText || '';
      const imageNotes = job?.imageNotes || [];
      const images = Array.isArray(job?.images) ? job.images : (job?.included || []);
      const skipped = job?.skipped || [];
      if (!file) throw new Error('Proposal file was lost before processing finished. Please upload again.');
      const imageCount = images.length;
      const ignoredPurposeCount = (skipped || []).filter((s) =>
        ['logo', 'decorative', 'icon', 'stock_photo'].includes(s.kind || s.purpose),
      ).length;
      const imagePreviews = buildProposalImagePreviews(images, [], skipped);
      const imageInventoryLines = imagePreviews.map((img) => {
        const flag = img.included ? 'INCLUDED' : 'SKIPPED';
        const purpose = purposeLabel(img.purpose || img.kind);
        const from = img.sourceFormat ? ` from ${String(img.sourceFormat).toUpperCase()}` : '';
        const why = img.reason ? ` — ${img.reason}` : '';
        return `- [${flag}] ${img.name} (${purpose}${from}${img.bytes ? `, ${Math.round(img.bytes / 1024)}KB` : ''})${why}`;
      });

      if (images.length) {
        try {
          setMessages((prev) => [...prev, {
            role: 'system',
            content: `🖼️ Extracting content and key points from **${Math.min(images.length, 8)}** scheme image(s)…`,
          }]);
          visionText = await interpretProposalImages(
            images,
            withUserSettings(getWorkflowRuntime().proposalImageInterpretPrompt, { moduleContext: false }),
            {
              onProgress: (n, total, name) => {
                setMessages((prev) => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  if (last?.role === 'system' && String(last.content || '').includes('Extracting content')) {
                    copy[copy.length - 1] = {
                      ...last,
                      content: `🖼️ Reading image **${n}/${total}** (${name})…`,
                    };
                    return copy;
                  }
                  return [...prev, { role: 'system', content: `🖼️ Reading image **${n}/${total}** (${name})…` }];
                });
              },
            },
          );
        } catch (visionErr) {
          visionError = visionErr.message || 'vision failed';
          console.warn('Proposal image interpretation failed:', visionErr);
          setMessages((prev) => [...prev, {
            role: 'system',
            content: `⚠️ Image reading skipped: ${visionError}. Continuing with text extract.`,
          }]);
        }
      }

      if ((!extractedText || extractedText.length < 40) && !visionText && !structuredText) {
        setMessages((prev) => [...prev, {
          role: 'system',
          content: '⚠️ Little text or image content was readable. Starting **Assess IC** with whatever was extracted.',
        }]);
      }

      const storagePath = userProposalRemotePath(currentUser, file.name);
      const { error: uploadError } = await supabase.storage
        .from('intelligence')
        .upload(storagePath, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
      if (uploadError) throw new Error(uploadError.message || 'Cloud upload failed');

      try {
        const combinedPersist = [
          [
            '=== EXTRACT META ===',
            `File: ${file.name}`,
            `Type: ${fileType}`,
            `Scheme images sent to vision: ${imageCount}`,
            `Non-scheme images ignored: ${ignoredPurposeCount}`,
            imageNotes.length ? `Notes: ${imageNotes.join(' ')}` : null,
            visionError ? `Vision error: ${visionError}` : null,
          ].filter(Boolean).join('\n'),
          extractedText
            ? `=== DOCUMENT / SLIDE TEXT ===\n${extractedText}`
            : '=== DOCUMENT / SLIDE TEXT ===\n(none — screenshot/chart content would appear in vision/chart sections)',
          structuredText
            ? `=== NATIVE CHARTS / EMBEDDED SPREADSHEETS ===\n${structuredText}`
            : null,
          `=== IMAGE INVENTORY ===\n${imageInventoryLines.length ? imageInventoryLines.join('\n') : '(no embedded images found)'}`,
          visionText
            ? `=== IMAGE / VISION EXTRACT (content, key points, message) ===\n${visionText}`
            : `=== IMAGE / VISION EXTRACT (content, key points, message) ===\n(none — ${imageCount ? 'vision returned empty text' : ignoredPurposeCount ? 'all images were classified as logo/decoration/icon and not sent to vision' : visionError || 'no scheme-relevant images were sent to vision'})`,
        ].filter(Boolean).join('\n\n');
        const textBlob = new Blob([combinedPersist], { type: 'text/plain' });
        const { error: extractUploadError } = await supabase.storage
          .from('intelligence')
          .upload(`${storagePath}.extracted.txt`, textBlob, { upsert: true, contentType: 'text/plain' });
        if (extractUploadError) throw new Error(extractUploadError.message);
      } catch (persistErr) {
        setMessages((prev) => [...prev, {
          role: 'system',
          content: `⚠️ Saved the original file but could not write the extract sidecar: ${persistErr.message || persistErr}. Assessment will still use in-memory extracts.`,
        }]);
      }

      const cappedText = extractedText.length > 70000
        ? `${extractedText.slice(0, 70000)}\n\n[… truncated for model context …]`
        : extractedText;
      const cappedVision = visionText.length > 40000
        ? `${visionText.slice(0, 40000)}\n\n[… vision extract truncated …]`
        : visionText;
      const cappedStructured = structuredText.length > 30000
        ? `${structuredText.slice(0, 30000)}\n\n[… structured extract truncated …]`
        : structuredText;

      const focusedContext = [
        'UPLOADED IC PROPOSAL (source of truth for this analysis)',
        `File: ${file.name}`,
        `Type: ${fileType}`,
        `Slide/document text chars: ${cappedText.length}`,
        imageCount ? `Scheme-relevant images interpreted: ${imageCount}` : 'Scheme-relevant images interpreted: 0',
        ignoredPurposeCount ? `Non-scheme images ignored: ${ignoredPurposeCount} (logos, decoration, icons)` : null,
        imageNotes.length ? `Image notes: ${imageNotes.join(' ')}` : null,
        '',
        'Use BOTH sections below: slide text AND image/chart extracts. Do not ignore either source.',
        '',
        cappedText
          ? `EXTRACTED DOCUMENT / SLIDE TEXT:\n${cappedText}`
          : null,
        cappedStructured
          ? `\n\nEXTRACTED FROM NATIVE CHARTS / EMBEDDED SPREADSHEETS (payment-scale series often live here):\n${cappedStructured}`
          : null,
        cappedVision
          ? `\n\nEXTRACTED FROM SCHEME IMAGES — CONTENT / KEY POINTS / MESSAGE (payout scales, tables, diagrams, comms, process):\n${cappedVision}`
          : null,
      ].filter((line) => line != null).join('\n');

      setUploadedFile({
        name: file.name,
        size: file.size,
        fileType,
        storagePath,
        storageBucket: 'intelligence',
        ...(!isEmptyContextValue(cappedText) ? { extractedText: cappedText } : {}),
        ...(!isEmptyContextValue(cappedVision) ? { visionExtract: cappedVision } : {}),
        ...(!isEmptyContextValue(cappedStructured) ? { structuredExtract: cappedStructured } : {}),
        ...(imageCount ? { imageCount } : {}),
        uploadedAt: new Date().toISOString(),
      });

      const bits = [
        cappedText ? `${Math.round(cappedText.length / 1000)}k text` : null,
        cappedVision ? `${Math.round(cappedVision.length / 1000)}k image extract` : null,
        imageCount ? `${imageCount} scheme image${imageCount === 1 ? '' : 's'}` : null,
        cappedStructured ? 'charts/Excel parsed' : null,
      ].filter(Boolean).join(', ');

      setMessages((prev) => [...prev, {
        role: 'system',
        content: `✅ Proposal saved (${bits || 'minimal extract'}). Checking whether anything still needs clarifying…`,
      }]);

      const launchArgs = {
        topicId: 'analyze_ic',
        userMessage: 'Assess my IC using the uploaded proposal. Use BOTH the extracted slide/document text AND any scheme image extracts — do not ask the user to restate details already present in either source.',
        focusedContext,
      };
      await beginProposalIntake({
        fileName: file.name,
        focusedContext,
        extractBlob: [cappedText, cappedStructured, cappedVision].filter(Boolean).join('\n\n'),
        launchArgs,
      });
    } catch (err) {
      setUploadedFile(null);
      setMessages((prev) => [...prev, {
        role: 'system',
        content: `❌ Could not process proposal: ${err.message || 'Unknown error'}`,
      }]);
      setIsLoading(false);
    }
  };

  const finishProposalIntakeAndLaunch = async (intake, capturedContext) => {
    pendingProposalIntakeRef.current = null;
    setPendingProposalIntake(null);
    const ctx = compactCapturedContext(capturedContext) || {};
    const qa = Array.isArray(ctx.qa_pairs)
      ? ctx.qa_pairs.filter((p) => p?.question || p?.answer).map((p) => `Q: ${p.question}\nA: ${p.answer}`).join('\n')
      : '';
    const clarifications = [
      !isEmptyContextValue(ctx.what_it_represents) ? `Represents: ${ctx.what_it_represents}` : '',
      !isEmptyContextValue(ctx.time_period) ? `Time period: ${ctx.time_period}` : '',
      ctx.key_metrics?.length ? `Key fields: ${ctx.key_metrics.filter((m) => !isEmptyContextValue(m)).join('; ')}` : '',
      !isEmptyContextValue(ctx.interpretation_notes) ? `Notes: ${ctx.interpretation_notes}` : '',
      qa ? `User clarifications:\n${qa}` : '',
    ].filter(Boolean).join('\n');
    setUploadedFile((prev) => (prev ? { ...prev, capturedContext: Object.keys(ctx).length ? ctx : undefined } : prev));
    const focusedContext = clarifications
      ? `${intake.focusedContext}\n\nUSER CLARIFICATIONS ON THIS PROPOSAL:\n${clarifications}`
      : intake.focusedContext;
    setMessages((prev) => [...prev, { role: 'user', content: 'Assess my IC' }]);
    await launchWorkflowDirect(intake.launchArgs.topicId, intake.launchArgs.userMessage, focusedContext);
  };

  const beginProposalIntake = async ({ fileName, focusedContext, extractBlob, launchArgs }) => {
    let onboarding = { summary: '', suggestedQuestions: [] };
    try {
      onboarding = await summarizeContextFile({
        name: fileName,
        extractBlob,
        moduleId: 'incentives',
      });
    } catch { /* continue without questions */ }
    const questions = Array.isArray(onboarding.suggestedQuestions) ? onboarding.suggestedQuestions.slice(0, 5) : [];
    if (!questions.length) {
      setMessages((prev) => [...prev, {
        role: 'system',
        content: 'Extract is clear enough — starting **Analyze Existing IC**.',
      }]);
      setMessages((prev) => [...prev, { role: 'user', content: 'Assess my IC' }]);
      await launchWorkflowDirect(launchArgs.topicId, launchArgs.userMessage, focusedContext);
      return;
    }
    const assistantMsg = `I've saved **${fileName}** and read the text/images.\n\n${onboarding.summary || ''}\n\nA few clarifications before I assess it:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nYou can answer them together or one at a time.`;
    const intake = {
      fileName,
      focusedContext,
      extractBlob,
      launchArgs,
      summary: onboarding.summary || '',
      intakeMessages: [{ role: 'assistant', content: assistantMsg }],
    };
    pendingProposalIntakeRef.current = intake;
    setPendingProposalIntake(intake);
    setMessages((prev) => [...prev, { role: 'assistant', content: assistantMsg }]);
    setIsLoading(false);
  };

  const continueProposalIntake = async (userText) => {
    const intake = pendingProposalIntakeRef.current || pendingProposalIntake;
    if (!intake) return;
    const nextMessages = [...(intake.intakeMessages || []), { role: 'user', content: userText }];
    setIsLoading(true);
    let launched = false;
    try {
      const result = await runContextIntakeTurn({
        extractBlob: intake.extractBlob,
        moduleLabel: 'Incentive Compensation proposal',
        intakeMessages: nextMessages,
      });
      const withAssistant = [...nextMessages, { role: 'assistant', content: result.message }];
      setMessages((prev) => [...prev, { role: 'assistant', content: result.message }]);
      if (result.complete) {
        launched = true;
        await finishProposalIntakeAndLaunch({ ...intake, intakeMessages: withAssistant }, result.context_qa);
        return;
      }
      const next = { ...intake, intakeMessages: withAssistant };
      pendingProposalIntakeRef.current = next;
      setPendingProposalIntake(next);
    } catch (err) {
      launched = true;
      setMessages((prev) => [...prev, { role: 'system', content: `⚠️ Could not continue intake: ${err.message || 'error'}. Starting the assessment with the extract.` }]);
      await finishProposalIntakeAndLaunch(intake, null);
    } finally {
      if (!launched) setIsLoading(false);
    }
  };

  const persistContextFiles = async (nextModuleContext) => {
    await saveUserSettings({ moduleContext: mergeModuleContext(nextModuleContext) });
  };

  const interpretContextImages = async (images, onStatus) => {
    if (!images?.length) return '';
    onStatus?.(`Reading ${Math.min(images.length, 8)} image(s)…`);
    return interpretProposalImages(
      images,
      withUserSettings(getWorkflowRuntime().contextImageInterpretPrompt, { moduleContext: false }),
      {
        onProgress: (n, total, name) => onStatus?.(`Reading image ${n}/${total} (${name})…`),
      },
    );
  };

  const completeModuleContextIngest = async (job) => {
    const moduleId = job.moduleId || 'incentives';
    const file = job.file;
    const extractedText = job.extractedText || '';
    const structuredText = job.structuredText || '';
    const images = Array.isArray(job.images) ? job.images : (job.included || []);
    const fileId = job.fileId || `ctx_${Date.now()}_${stellaNanoId()}`;
    let visionText = '';
    try {
      if (images.length) visionText = await interpretContextImages(images, job.onStatus);
    } catch (err) {
      job.onStatus?.(`Image reading skipped: ${err.message || 'vision failed'}`);
    }

    const extractBlob = [extractedText, structuredText, visionText].filter((t) => !isEmptyContextValue(t)).join('\n\n');
    let onboarding = { summary: '', suggestedQuestions: [] };
    if (!isThinContextExtract(extractBlob, file.name)) {
      try {
        onboarding = await summarizeContextFile({ name: file.name, extractBlob, moduleId });
      } catch { /* keep fallback */ }
    }
    const questions = Array.isArray(onboarding.suggestedQuestions) ? onboarding.suggestedQuestions.slice(0, 5) : [];
    const summaryLine = onboarding.summary ? `\n\n${onboarding.summary}` : '';
    const assistantMsg = questions.length
      ? `✅ Uploaded **${file.name}** for ${moduleLabelFor(moduleId)}.${summaryLine}\n\nTo use this correctly I need a little context:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nYou can answer them together or one at a time.`
      : `✅ Uploaded **${file.name}** for ${moduleLabelFor(moduleId)}.${summaryLine}`;
    const rec = {
      id: fileId,
      name: file.name,
      fileType: job.fileType,
      sizeLabel: `${(file.size / 1024).toFixed(1)} KB`,
      uploadedAt: new Date().toISOString(),
      summary: onboarding.summary,
      extractedText,
      visionExtract: visionText,
      structuredExtract: structuredText,
      imageCount: images.length,
      intakeMessages: [{ role: 'assistant', content: assistantMsg }],
      intakeComplete: true,
    };
    const nextCtx = upsertModuleContextFile(userSettingsRef.current.moduleContext, moduleId, rec);
    await persistContextFiles(nextCtx);
    setActiveContextFileId(fileId);
    contextIngestJobRef.current = null;
    setContextIngestJob(null);
    if (questions.length === 0) {
      job.onStatus?.('Stored — no extra questions needed.');
    }
  };

  const continueModuleContextIntake = async (moduleId, fileId, userText) => {
    const files = userSettingsRef.current.moduleContext?.[moduleId]?.files || [];
    const rec = files.find((f) => f.id === fileId);
    if (!rec) return;
    if (rec.intakeComplete) {
      setContextIntakeBusy(true);
      try {
        await appendContextFileNote(moduleId, fileId, userText);
      } finally {
        setContextIntakeBusy(false);
      }
      return;
    }
    const nextMessages = [...(rec.intakeMessages || []), { role: 'user', content: userText }];
    setContextIntakeBusy(true);
    const optimistic = patchModuleContextFile(userSettingsRef.current.moduleContext, moduleId, fileId, { intakeMessages: nextMessages });
    setUserSettings((prev) => ({ ...prev, moduleContext: optimistic }));
    try {
      const result = await runContextIntakeTurn({
        extractBlob: [rec.extractedText, rec.structuredExtract, rec.visionExtract].filter((t) => !isEmptyContextValue(t)).join('\n\n'),
        moduleLabel: moduleLabelFor(moduleId),
        intakeMessages: nextMessages,
      });
      const withAssistant = [...nextMessages, { role: 'assistant', content: result.message }];
      const patched = patchModuleContextFile(optimistic, moduleId, fileId, {
        intakeMessages: withAssistant,
        intakeComplete: true,
        capturedContext: result.complete ? (result.context_qa || rec.capturedContext) : rec.capturedContext,
      });
      await persistContextFiles(patched);
    } catch (err) {
      const patched = patchModuleContextFile(optimistic, moduleId, fileId, {
        intakeMessages: [...nextMessages, { role: 'system', content: `⚠️ ${err.message || 'Intake failed'}` }],
      });
      await persistContextFiles(patched);
    } finally {
      setContextIntakeBusy(false);
      setContextIntakeInput('');
    }
  };

  const applyContextUnsureImageDecision = async (nameOrAll, include) => {
    const prev = contextIngestJobRef.current || contextIngestJob;
    if (!prev) return;
    let included = [...(prev.included || [])];
    let unsure = [...(prev.unsure || [])];
    let skipped = [...(prev.skipped || [])];
    const decide = (img, keep) => {
      if (keep) included.push(img);
      else {
        skipped.push({
          ...img,
          kind: 'skipped_by_user',
          reason: 'User skipped',
          included: false,
          src: img.src || (img.base64 ? `data:${img.mediaType};base64,${img.base64}` : undefined),
        });
      }
    };
    if (nameOrAll === '*') {
      unsure.forEach((img) => decide(img, include));
      unsure = [];
    } else {
      const img = unsure.find((i) => i.name === nameOrAll);
      if (!img) return;
      decide(img, include);
      unsure = unsure.filter((i) => i.name !== nameOrAll);
    }
    const next = { ...prev, included, unsure, skipped };
    if (unsure.length) {
      contextIngestJobRef.current = next;
      setContextIngestJob(next);
      return;
    }
    contextIngestJobRef.current = next;
    setContextIngestJob({ ...next, processing: true });
    try {
      await completeModuleContextIngest({ ...next, images: included });
    } catch (err) {
      contextIngestJobRef.current = null;
      setContextIngestJob({ ...next, processing: false, error: err.message || 'Upload failed' });
    }
  };

  const handleModuleContextUpload = async (event, moduleId) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const fileId = `ctx_${Date.now()}_${stellaNanoId()}`;
    const placeholder = {
      id: fileId,
      name: file.name,
      fileType: detectContextFileKind(file).label,
      sizeLabel: `${(file.size / 1024).toFixed(1)} KB`,
      processing: true,
      intakeComplete: false,
      intakeMessages: [{ role: 'assistant', content: `⏳ Processing **${file.name}**…` }],
    };
    const optimistic = upsertModuleContextFile(userSettingsRef.current.moduleContext, moduleId, placeholder);
    setUserSettings((prev) => ({ ...prev, moduleContext: optimistic }));
    setActiveContextFileId(fileId);
    setUserSettingsPane(moduleId === 'stella' ? 'stella' : moduleId === 'territory' ? 'territory' : 'incentives');
    try {
      const extracts = await extractDocumentForIngest(file, {
        classifyPrompt: withUserSettings(getWorkflowRuntime().contextImageClassifyPrompt, { moduleContext: false }),
        onStatus: (msg) => {
          setUserSettings((prev) => ({
            ...prev,
            moduleContext: patchModuleContextFile(prev.moduleContext, moduleId, fileId, {
              intakeMessages: [{ role: 'assistant', content: `⏳ ${msg}` }],
            }),
          }));
        },
      });
      const job = {
        moduleId,
        fileId,
        file,
        fileType: extracts.fileType,
        extractedText: extracts.extractedText,
        structuredText: extracts.structuredText,
        imageNotes: extracts.imageNotes,
        included: extracts.included,
        unsure: extracts.unsure,
        skipped: extracts.skipped,
        onStatus: (msg) => {
          setUserSettings((prev) => ({
            ...prev,
            moduleContext: patchModuleContextFile(prev.moduleContext, moduleId, fileId, {
              intakeMessages: [{ role: 'assistant', content: `⏳ ${msg}` }],
            }),
          }));
        },
      };
      if (extracts.unsure.length) {
        contextIngestJobRef.current = job;
        setContextIngestJob(job);
        setUserSettings((prev) => ({
          ...prev,
          moduleContext: patchModuleContextFile(prev.moduleContext, moduleId, fileId, {
            intakeMessages: [{
              role: 'assistant',
              content: `🖼️ **${extracts.unsure.length}** image(s) need a yes/no — include any that carry useful context. Click a thumbnail to enlarge.`,
            }],
          }),
        }));
        return;
      }
      await completeModuleContextIngest({ ...job, images: extracts.included });
    } catch (err) {
      const failed = patchModuleContextFile(userSettingsRef.current.moduleContext, moduleId, fileId, {
        processing: false,
        intakeMessages: [{ role: 'system', content: `❌ Could not process ${file.name}: ${err.message || 'error'}` }],
      });
      await persistContextFiles(failed);
    }
  };

  const handleRemoveModuleContextFile = async (moduleId, fileId) => {
    const rec = (userSettingsRef.current.moduleContext?.[moduleId]?.files || []).find((f) => f.id === fileId);
    if (rec?.storagePath) {
      try {
        await supabase.storage.from('intelligence').remove([rec.storagePath, `${rec.storagePath}.extracted.txt`]);
      } catch { /* ignore */ }
    }
    const next = removeModuleContextFile(userSettingsRef.current.moduleContext, moduleId, fileId);
    await persistContextFiles(next);
    if (activeContextFileId === fileId) setActiveContextFileId(null);
  };

  const persistContextBlock = async (moduleId, fileId, blockId, nextValue, remove = false) => {
    const rec = (userSettingsRef.current.moduleContext?.[moduleId]?.files || []).find((f) => f.id === fileId);
    if (!rec) return;
    const empty = remove || (
      nextValue && typeof nextValue === 'object'
        ? isEmptyContextValue(nextValue.question) && isEmptyContextValue(nextValue.answer)
        : isEmptyContextValue(nextValue)
    );
    const ctx = { ...(rec.capturedContext || {}) };
    const patch = { intakeComplete: true };
    if (blockId === 'summary') patch.summary = empty ? '' : nextValue;
    else if (blockId === 'extractedText') patch.extractedText = empty ? '' : nextValue;
    else if (blockId === 'structuredExtract') patch.structuredExtract = empty ? '' : nextValue;
    else if (blockId === 'visionExtract') patch.visionExtract = empty ? '' : nextValue;
    else if (blockId === 'represents') patch.capturedContext = { ...ctx, what_it_represents: empty ? '' : nextValue };
    else if (blockId === 'period') patch.capturedContext = { ...ctx, time_period: empty ? '' : nextValue };
    else if (blockId === 'interpretation') patch.capturedContext = { ...ctx, interpretation_notes: empty ? '' : nextValue };
    else if (blockId === 'metrics') {
      const metrics = empty ? [] : String(nextValue || '').split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
      patch.capturedContext = { ...ctx, key_metrics: metrics };
    } else if (blockId.startsWith('qa:')) {
      const idx = Number(blockId.slice(3));
      const qa = [...(ctx.qa_pairs || [])];
      if (empty || idx < 0 || idx >= qa.length) qa.splice(idx, 1);
      else qa[idx] = { question: nextValue.question || '', answer: nextValue.answer || '' };
      patch.capturedContext = { ...ctx, qa_pairs: qa };
    } else if (blockId.startsWith('note:')) {
      const nid = blockId.slice(5);
      const notes = [...(rec.notes || [])];
      patch.notes = empty
        ? notes.filter((n) => n.id !== nid)
        : notes.map((n) => (n.id === nid ? { ...n, text: nextValue } : n));
    } else {
      return;
    }
    setContextEditSaveStatus('saving');
    try {
      await persistContextFiles(patchModuleContextFile(userSettingsRef.current.moduleContext, moduleId, fileId, patch));
      setContextEditSaveStatus('saved');
      setTimeout(() => setContextEditSaveStatus('idle'), 2500);
    } catch {
      setContextEditSaveStatus('error');
    }
  };

  const appendContextFileNote = async (moduleId, fileId, note) => {
    const rec = (userSettingsRef.current.moduleContext?.[moduleId]?.files || []).find((f) => f.id === fileId);
    if (!rec || !note) return;
    const patched = patchModuleContextFile(userSettingsRef.current.moduleContext, moduleId, fileId, {
      notes: [...(rec.notes || []), { id: `note_${Date.now()}`, text: note }],
      intakeMessages: [...(rec.intakeMessages || []), { role: 'user', content: note }],
      intakeComplete: true,
    });
    await persistContextFiles(patched);
    setContextIntakeInput('');
  };

  const renderModuleContextPanel = (moduleId) => {
    const files = userSettings.moduleContext?.[moduleId]?.files || [];
    const active = files.find((f) => f.id === activeContextFileId) || files[files.length - 1] || null;
    const contextBlocks = active && !active.processing ? contextBlocksFromFile(active) : [];
    const job = (contextIngestJob?.moduleId === moduleId) ? contextIngestJob : null;
    const imagePreviews = (job && !job.processing && (job.unsure?.length || job.included?.length || job.skipped?.length))
      ? buildProposalImagePreviews(job.included || [], job.unsure || [], job.skipped || [])
      : [];
    const pendingImageCount = imagePreviews.filter((img) => img.pending).length;
    const openContextImageLightbox = (img) => {
      if (!img?.src) return;
      setImageLightbox({
        src: img.src,
        name: img.name,
        purpose: img.purpose || img.kind,
        reason: img.reason,
        included: img.included,
        pending: !!img.pending,
        sourceFormat: img.sourceFormat,
        contextReview: true,
      });
    };
    return (
      <div className="mt-8 pt-6 border-t border-blue-400/15">
        <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" /> {moduleLabelFor(moduleId)} context files
        </h3>
        <p className="text-xs text-blue-300/60 mb-2">
          Upload a file and use the chat to add more context. Detected content from the file appears below so you can confirm, edit, or remove it. Only those saved fields are sent to the AI as guidance in {moduleLabelFor(moduleId)}.
        </p>
        <p className="text-[11px] text-blue-300/45 mb-4">
          File only: <code className="text-cyan-300/70">intelligence/{userSettingsRemotePath(currentUser)}</code>.
          {' '}Created if missing, overwritten on each save. Not stored in the browser.
          {userSettingsSaveStatus === 'saved' && (
            <span className="block mt-1 text-emerald-300/80">settings.json updated.</span>
          )}
          {userSettingsSaveStatus === 'error' && (
            <span className="block mt-1 text-red-300">
              Could not write settings.json{userSettingsCloudError ? `: ${userSettingsCloudError}` : ''}.
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <button
            type="button"
            onClick={() => {
              moduleContextFileInputRef.current?.setAttribute('data-module', moduleId);
              moduleContextFileInputRef.current?.click();
            }}
            disabled={!!job?.processing || files.some((f) => f.processing)}
            className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/30 rounded-lg text-xs text-cyan-100 font-semibold disabled:opacity-50 flex items-center gap-2"
          >
            <Upload className="w-3.5 h-3.5" /> Upload context file
          </button>
          <span className="text-[11px] text-blue-300/50">PowerPoint, PDF, Excel, CSV, or text</span>
        </div>
        {job?.error && (
          <div className="mb-3 text-xs text-red-300 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {job.error}</div>
        )}
        {imagePreviews.length > 0 && (
          <div className="mb-4 bg-slate-900/40 border border-amber-400/25 rounded-xl p-4">
            <div className="text-xs font-semibold text-amber-200 mb-1">
              {pendingImageCount > 0
                ? `${pendingImageCount} image${pendingImageCount === 1 ? '' : 's'} might contain useful context — click to enlarge, then include or skip.`
                : 'Review extracted images. Click a thumbnail to enlarge.'}
            </div>
            <p className="text-[11px] text-blue-300/55 mb-3">
              Auto-kept images are marked included. Logos and decoration are skipped. Anything unclear waits for you.
            </p>
            <div className="flex flex-wrap gap-2">
              {imagePreviews.map((img, i) => (
                <figure
                  key={`${img.name}-${i}`}
                  role={img.src ? 'button' : undefined}
                  tabIndex={img.src ? 0 : undefined}
                  onClick={() => openContextImageLightbox(img)}
                  onKeyDown={(e) => {
                    if (!img.src) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openContextImageLightbox(img);
                    }
                  }}
                  className={`rounded-lg overflow-hidden border text-left ${img.src ? 'cursor-zoom-in hover:ring-2 hover:ring-cyan-400/50' : ''} ${
                    img.pending
                      ? 'border-amber-400/70 bg-amber-950/40'
                      : img.included
                      ? 'border-emerald-400/40 bg-slate-900/40'
                      : ['logo', 'decorative', 'icon', 'stock_photo'].includes(img.kind || img.purpose)
                        ? 'border-slate-500/50 bg-slate-900/30'
                        : 'border-amber-400/40 bg-amber-950/30'
                  }`}
                  title={img.src ? `Click to enlarge — ${img.pending ? (img.reason || 'Confirm') : img.included ? (img.reason || 'Included') : (img.reason || 'Skipped')}` : (img.reason || 'Skipped')}
                >
                  {img.src ? (
                    <img
                      src={img.src}
                      alt={img.name}
                      className={`block h-20 w-auto max-w-[140px] object-contain bg-slate-950/50 ${img.included || img.pending ? '' : 'opacity-60 grayscale-[35%]'}`}
                    />
                  ) : (
                    <div className="h-20 w-[120px] flex items-center justify-center px-2 text-[10px] text-amber-200/90 text-center leading-snug">
                      {img.kind === 'vector' ? 'Convert failed' : (img.reason || 'Skipped')}
                    </div>
                  )}
                  <figcaption className="px-1.5 py-1 text-[10px] leading-tight text-slate-300 max-w-[140px]">
                    <div className="truncate">{img.pending ? '? ' : img.included ? '✓ ' : '✗ '}{img.name}</div>
                    <div className={`truncate ${img.pending ? 'text-amber-300' : img.included ? 'text-emerald-300/90' : 'text-slate-400'}`}>
                      {purposeLabel(img.purpose || img.kind)}
                      {img.sourceFormat ? ` · from ${String(img.sourceFormat).toUpperCase()}` : ''}
                      {img.bytes ? ` · ${(img.bytes / 1024).toFixed(0)}KB` : ''}
                    </div>
                    {img.pending && (
                      <div className="flex gap-1 mt-1">
                        <button
                          type="button"
                          className="flex-1 px-1 py-0.5 rounded bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100 text-[10px] font-semibold"
                          onClick={(e) => { e.stopPropagation(); applyContextUnsureImageDecision(img.name, true); }}
                        >
                          Include
                        </button>
                        <button
                          type="button"
                          className="flex-1 px-1 py-0.5 rounded bg-slate-600/60 hover:bg-slate-500/70 text-slate-100 text-[10px] font-semibold"
                          onClick={(e) => { e.stopPropagation(); applyContextUnsureImageDecision(img.name, false); }}
                        >
                          Skip
                        </button>
                      </div>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
            {pendingImageCount > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" onClick={() => applyContextUnsureImageDecision('*', true)} className="px-3 py-1.5 bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400/40 rounded-lg text-xs text-emerald-100 font-semibold">Include all unsure</button>
                <button type="button" onClick={() => applyContextUnsureImageDecision('*', false)} className="px-3 py-1.5 bg-slate-600/50 hover:bg-slate-500/60 border border-slate-400/30 rounded-lg text-xs text-slate-100 font-semibold">Skip all unsure</button>
              </div>
            )}
          </div>
        )}
        {files.length === 0 ? (
          <div className="text-xs text-blue-300/50 bg-slate-900/30 border border-dashed border-blue-400/20 rounded-xl p-4">No context files yet for this module.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              {files.map((f) => (
                <div key={f.id} className={`w-full bg-slate-900/40 border rounded-xl p-3 ${active?.id === f.id ? 'border-cyan-400/50' : 'border-blue-400/20'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => setActiveContextFileId(f.id)} className="min-w-0 text-left flex-1">
                      <div className="text-sm font-semibold text-white truncate">{f.name}</div>
                      <div className="text-[11px] text-blue-300/55 mt-0.5">{f.fileType}{f.sizeLabel ? ` · ${f.sizeLabel}` : ''}{f.imageCount ? ` · ${f.imageCount} image${f.imageCount === 1 ? '' : 's'}` : ''}</div>
                      {f.summary && <div className="text-[11px] text-blue-200/75 mt-1 line-clamp-2">{f.summary}</div>}
                    </button>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {f.processing ? (
                        job?.fileId === f.id && pendingImageCount > 0 ? (
                          <span className="px-2 py-0.5 bg-amber-500/15 text-amber-200 text-[10px] rounded border border-amber-400/25">Confirm images</span>
                        ) : (
                          <span className="px-2 py-0.5 bg-amber-500/15 text-amber-200 text-[10px] rounded border border-amber-400/25">Processing</span>
                        )
                      ) : f.intakeComplete ? (
                        <span className="px-2 py-0.5 bg-green-500/20 text-green-300 text-[10px] rounded border border-green-400/30">Ready</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-yellow-500/15 text-yellow-200 text-[10px] rounded border border-yellow-400/25">Intake</span>
                      )}
                      <button type="button" onClick={() => handleRemoveModuleContextFile(moduleId, f.id)} className="p-1 hover:bg-red-500/20 rounded text-red-400" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-slate-900/40 border border-blue-400/20 rounded-xl p-4">
              {!active ? (
                <div className="text-xs text-blue-300/50">Select a file to review or add context.</div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs font-bold text-white">{active.intakeComplete ? 'Add context' : 'Intake'}</div>
                  <div className="max-h-[240px] overflow-y-auto custom-scrollbar space-y-2">
                    {(active.intakeMessages || []).map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[95%] px-3 py-2 rounded-xl text-xs ${m.role === 'user' ? 'bg-gradient-to-br from-cyan-500 to-blue-500 text-white' : m.role === 'system' ? 'bg-yellow-500/15 border border-yellow-400/25 text-yellow-200' : 'bg-slate-800/60 border border-blue-400/20 text-blue-100'}`}>
                          <span className="whitespace-pre-wrap">{m.content}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!active.processing && (
                    <div className="flex gap-2">
                      <textarea
                        value={contextIntakeInput}
                        onChange={(e) => setContextIntakeInput(e.target.value)}
                        placeholder={active.intakeComplete ? 'Add further context for this file…' : 'Answer the intake questions…'}
                        rows={2}
                        className="flex-1 bg-slate-800/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-400 resize-none"
                      />
                      <button
                        type="button"
                        disabled={!contextIntakeInput.trim() || contextIntakeBusy}
                        onClick={() => continueModuleContextIntake(moduleId, active.id, contextIntakeInput.trim())}
                        className="px-3 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 disabled:opacity-40 text-white font-semibold rounded-lg text-xs flex items-center gap-1"
                      >
                        <Send className="w-3.5 h-3.5" /> {active.intakeComplete ? 'Add' : 'Send'}
                      </button>
                    </div>
                  )}
                  {contextBlocks.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-blue-400/15">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-semibold text-blue-200">Detected & saved context</div>
                        {contextEditSaveStatus === 'saving' && <span className="text-[11px] text-blue-300/70">Saving…</span>}
                        {contextEditSaveStatus === 'saved' && <span className="text-[11px] text-green-400 font-semibold">Saved</span>}
                        {contextEditSaveStatus === 'error' && <span className="text-[11px] text-red-400 font-semibold">Save failed</span>}
                      </div>
                      {contextBlocks.map((b) => (
                        <EditableContextBlock
                          key={b.id}
                          label={b.label}
                          value={b.value}
                          question={b.question}
                          answer={b.answer}
                          qa={!!b.qa}
                          line={!!b.line}
                          onSave={(val) => persistContextBlock(moduleId, active.id, b.id, val)}
                          onDelete={() => persistContextBlock(moduleId, active.id, b.id, '', true)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const applyUnsureImageDecision = async (nameOrAll, include) => {
    const prev = pendingImageReviewRef.current || pendingImageReview;
    if (!prev) return;
    let included = [...(prev.included || [])];
    let unsure = [...(prev.unsure || [])];
    let skipped = [...(prev.skipped || [])];

    const decide = (img, keep) => {
      if (keep) included.push(img);
      else {
        skipped.push({
          name: img.name,
          bytes: img.bytes || 0,
          included: false,
          reason: 'User skipped — not scheme-relevant',
          kind: 'skipped_by_user',
          purpose: img.purpose || 'other_ic',
          src: `data:${img.mediaType};base64,${img.base64}`,
        });
      }
    };

    if (nameOrAll === '*') {
      unsure.forEach((img) => decide(img, include));
      unsure = [];
    } else {
      const img = unsure.find((i) => i.name === nameOrAll);
      if (!img) return;
      decide(img, include);
      unsure = unsure.filter((i) => i.name !== nameOrAll);
    }

    const next = { ...prev, included, unsure, skipped };
    if (unsure.length) {
      pendingImageReviewRef.current = next;
      setPendingImageReview(next);
      const previews = buildProposalImagePreviews(included, unsure, skipped);
      setMessages((msgs) => {
        const copy = [...msgs];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].imageReviewPending) {
            copy[i] = {
              ...copy[i],
              content: `🖼️ **${included.length}** scheme image(s) will be extracted. **${unsure.length}** still need a yes/no — include any that carry IC context.`,
              imagePreviews: previews,
            };
            break;
          }
        }
        return copy;
      });
      return;
    }
    if (proposalIngestRunningRef.current) return;
    proposalIngestRunningRef.current = true;
    pendingImageReviewRef.current = null;
    setPendingImageReview(null);
    setIsLoading(true);
    setMessages((msgs) => {
      const copy = [...msgs];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].imageReviewPending) {
          copy[i] = {
            ...copy[i],
            content: `🖼️ **${included.length}** scheme image(s) selected for extract.`,
            imageReviewPending: false,
          };
          break;
        }
      }
      return [...copy, {
        role: 'system',
        content: `▶️ Confirmed **${included.length}** image(s). Continuing Assess IC…`,
      }];
    });
    try {
      await completeProposalIngest({ ...next, images: included });
    } catch (err) {
      setIsLoading(false);
      setMessages((prevMsgs) => [...prevMsgs, {
        role: 'system',
        content: `❌ Could not continue after image review: ${err.message || 'Unknown error'}`,
      }]);
    } finally {
      proposalIngestRunningRef.current = false;
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const fileType = detectContextFileKind(file).label;

    setShowLanding(false);
    setActiveTab('chat');
    setIsLoading(true);
    setMessages((prev) => [...prev, {
      role: 'system',
      content: `📎 Processing **${file.name}** (${(file.size / 1024).toFixed(1)} KB) — extracting text, images, and saving to cloud…`,
    }]);

    try {
      const extractedRaw = await extractProposalText(file);
      const extractedText = String(extractedRaw || '').trim();

      setMessages((prev) => [...prev, {
        role: 'system',
        content: '🖼️ Scanning embedded images — detecting IC content vs logos/decoration…',
      }]);

      try {
        const extracted = await extractProposalImages(file, { textLength: extractedText.length });
        const finalized = await finalizeProposalImages(
          extracted,
          withUserSettings(getWorkflowRuntime().proposalImageClassifyPrompt, { moduleContext: false }),
        );
        const images = finalized.images || [];
        const unsure = finalized.unsure || [];
        const skipped = finalized.skipped || [];
        const classifications = finalized.classifications || [];
        const imageNotes = finalized.notes || [];
        const structuredText = finalized.structuredText || '';

        const classByName = Object.fromEntries(classifications.map((c) => [c.name, c]));
        const included = images.map((img) => ({
          ...img,
          purpose: classByName[img.name]?.purpose || img.purpose || 'scheme_content',
          reason: classByName[img.name]?.reason || img.reason,
        }));
        const ignoredPurpose = skipped.filter((s) =>
          ['logo', 'decorative', 'icon', 'stock_photo'].includes(s.kind || s.purpose),
        );
        const imagePreviews = buildProposalImagePreviews(included, unsure, skipped);

        if (included.length || unsure.length || skipped.length || structuredText) {
          setMessages((prev) => [...prev, {
            role: 'system',
            content: unsure.length
              ? `🖼️ **${included.length}** scheme image(s) will be extracted. **${unsure.length}** might contain IC context — include any that matter (diagrams, comms, process, tables — not only payout scales).`
              : included.length
                ? `🖼️ **Scheme images for vision:** ${included.length} included${ignoredPurpose.length ? `, ${ignoredPurpose.length} ignored as logo/decoration` : ''}${structuredText ? '; also parsed native charts / embedded Excel' : ''}.${imageNotes.length ? `\n_${imageNotes.join(' ')}_` : ''}`
                : `⚠️ **No scheme-relevant images** for vision${ignoredPurpose.length ? ` (${ignoredPurpose.length} logo/decorative images ignored)` : ''}${structuredText ? '; using native chart / Excel extracts instead' : ''}.${imageNotes.length ? `\n_${imageNotes.join(' ')}_` : ''}`,
            imagePreviews,
            imageReviewPending: unsure.length > 0,
          }]);
        }

        if (unsure.length) {
          const job = {
            file,
            fileType,
            extractedText,
            structuredText,
            imageNotes,
            included,
            unsure,
            skipped,
          };
          pendingImageReviewRef.current = job;
          setPendingImageReview(job);
          setIsLoading(false);
          return;
        }

        await completeProposalIngest({
          file,
          fileType,
          extractedText,
          structuredText,
          imageNotes,
          images: included,
          skipped,
        });
        return;
      } catch (visionErr) {
        console.warn('Proposal image interpretation failed:', visionErr);
        setMessages((prev) => [...prev, {
          role: 'system',
          content: `⚠️ Image reading skipped: ${visionErr.message || 'vision failed'}. Continuing with text extract.`,
        }]);
        await completeProposalIngest({
          file,
          fileType,
          extractedText,
          structuredText: '',
          imageNotes: [],
          images: [],
          skipped: [],
        });
      }
    } catch (err) {
      setUploadedFile(null);
      setMessages((prev) => [...prev, {
        role: 'system',
        content: `❌ Could not process proposal: ${err.message || 'Unknown error'}`,
      }]);
      setIsLoading(false);
    }
  };

  // ── SUPABASE: Upload intelligence files ──
  const handleAdminFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!isKnowledgeStorageFile(file.name)) {
      setMessages(prev => [...prev, { role: 'system', content: '❌ Knowledge files must be .md, .txt, .yml, or .yaml' }]);
      event.target.value = '';
      return;
    }
    const { error } = await supabase.storage
      .from('intelligence')
      .upload(file.name, file, { upsert: true });

    if (error) {
      console.error('Supabase upload error:', error);
      setMessages(prev => [...prev, { role: 'system', content: `❌ Upload failed: ${error.message}` }]);
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = String(e.target.result || '');
      const isYaml = /\.ya?ml$/i.test(file.name);
      const newDoc = {
        id: file.name,
        name: file.name,
        type: isYaml ? 'yaml' : 'text',
        size: `${(file.size / 1024).toFixed(1)} KB`,
        status: 'active',
        content,
        fromStorage: true,
      };
      setDocuments((prev) => {
        const next = [...prev.filter((d) => d.name !== file.name), newDoc];
        setKnowledgeBase(buildKnowledgeBaseFromDocuments(next));
        return next;
      });
      setMessages(prev => [...prev, { role: 'system', content: `✅ Uploaded and saved to cloud: ${file.name}` }]);
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // ── SUPABASE: Delete intelligence files ──
  const removeDocument = async (id) => {
    const doc = documents.find(d => d.id === id || d.name === id);
    if (!doc) return;
    try {
      await supabase.storage.from('intelligence').remove([doc.name]);
    } catch { /* ignore */ }
    setDocuments((prev) => {
      const next = prev.filter((d) => d.id !== doc.id && d.name !== doc.name);
      setKnowledgeBase(buildKnowledgeBaseFromDocuments(next));
      return next;
    });
  };

  // ── STELLA: Supabase storage helpers ──
  const stellaResolveStoragePath = (candidate, path) => `${candidate.prefix}${path}`;

  const stellaUploadToStorage = async (path, blobOrFile, contentType) => {
    let lastErr = null;
    for (const candidate of STELLA_STORAGE_CANDIDATES) {
      try {
        const objectPath = stellaResolveStoragePath(candidate, path);
        const { error } = await supabase.storage
          .from(candidate.bucket)
          .upload(objectPath, blobOrFile, { upsert: true, contentType });
        if (!error) return { bucket: candidate.bucket, objectPath };
        lastErr = error;
      } catch (e) { lastErr = e; }
    }
    throw new Error(lastErr?.message || 'Upload failed');
  };

  const stellaDownloadJson = async (bucket, path) => {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) throw error || new Error('Download failed');
    return safeJsonParse(await data.text());
  };

  const reloadStellaBusinessContextFromSupabase = async () => {
    for (const candidate of STELLA_STORAGE_CANDIDATES) {
      try {
        const parsed = await stellaDownloadJson(candidate.bucket, stellaResolveStoragePath(candidate, 'business-context.json'));
        if (parsed && typeof parsed === 'object') {
          setStellaBusinessContext(prev => ({ ...prev, ...parsed }));
          return parsed;
        }
      } catch {
        // try next candidate
      }
    }
    return null;
  };

  // ── STELLA: DB registry (stella_files) + local state helpers ──
  const stellaPatchLocal = (fileId, patch) =>
    setStellaDataFiles(prev => prev.map(f => (f.id === fileId ? { ...f, ...patch } : f)));

  const stellaReloadRegistry = async () => {
    try {
      const { data, error } = await supabase
        .from('stella_files')
        .select('*')
        .eq('org_id', 'default')
        .order('uploaded_at', { ascending: true });
      if (error || !Array.isArray(data)) return null;
      const mapped = data.map(stellaMapRegistryRow);
      setStellaDataFiles(prev => {
        const prevById = new globalThis.Map(prev.filter(f => f.dbId).map(f => [f.dbId, f]));
        const merged = mapped.map(m => {
          const p = prevById.get(m.dbId);
          // Keep a live (unsaved) intake conversation if it's ahead of the DB copy.
          if (p && !p.intakeComplete && (p.intakeMessages?.length || 0) > (m.intakeMessages?.length || 0)) {
            return { ...m, intakeMessages: p.intakeMessages, capturedContext: p.capturedContext || m.capturedContext };
          }
          return m;
        });
        const temps = prev.filter(f => !f.dbId);
        return [...merged, ...temps];
      });
      return mapped;
    } catch {
      return null;
    }
  };

  const stellaInsertRegistry = async (record) => {
    const { data, error } = await supabase
      .from('stella_files')
      .insert({ org_id: 'default', ...record })
      .select()
      .single();
    if (error) throw new Error(`Registry insert failed: ${error.message}`);
    return data;
  };

  const stellaUpdateRegistry = async (dbId, patch) => {
    if (!dbId) return;
    const { error } = await supabase.from('stella_files').update(patch).eq('id', dbId);
    if (error) throw new Error(`Registry update failed: ${error.message}`);
  };

  // Create a dynamic stella_data_* table via RPC and load rows in batches.
  const stellaCreateAndLoadTable = async (tableName, columns, rows) => {
    const cols = columns.map(c => ({ name: c.name, type: c.type }));
    const { error: createErr } = await supabase.rpc('stella_create_table', { p_table_name: tableName, p_columns: cols });
    if (createErr) throw new Error(`Table create failed: ${createErr.message}`);
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error: insErr } = await supabase.rpc('stella_insert_rows', { p_table_name: tableName, p_rows: batch });
      if (insErr) throw new Error(`Row insert failed: ${insErr.message}`);
    }
  };

  const stellaRemoveStorage = async (objectPath) => {
    if (!objectPath) return;
    const rel = objectPath.replace(/^stella\//, '');
    const paths = [...new Set([objectPath, rel, `stella/${rel}`])];
    for (const candidate of STELLA_STORAGE_CANDIDATES) {
      for (const p of paths) {
        try { await supabase.storage.from(candidate.bucket).remove([p]); } catch { /* ignore */ }
        try { await supabase.storage.from(candidate.bucket).remove([stellaResolveStoragePath(candidate, rel)]); } catch { /* ignore */ }
      }
    }
  };

  // Download a blob from Stella storage (tries path variants across candidate buckets).
  const stellaDownloadStorageBlob = async (objectPath) => {
    if (!objectPath) return null;
    const rel = objectPath.replace(/^stella\//, '');
    const paths = [...new Set([objectPath, rel, `stella/${rel}`])];
    for (const candidate of STELLA_STORAGE_CANDIDATES) {
      for (const p of paths) {
        try {
          const { data, error } = await supabase.storage.from(candidate.bucket).download(p);
          if (!error && data) return data;
        } catch { /* try next */ }
        try {
          const { data, error } = await supabase.storage.from(candidate.bucket).download(stellaResolveStoragePath(candidate, rel));
          if (!error && data) return data;
        } catch { /* try next */ }
      }
    }
    return null;
  };

  // Fetch full document text (extracted .txt companion, or re-extract legacy PDFs).
  const stellaFetchDocumentText = async (fileRecord) => {
    const textPath = fileRecord.textStoragePath || stellaExtractedTextPath(fileRecord.storagePath);
    if (textPath) {
      const blob = await stellaDownloadStorageBlob(textPath);
      if (blob) {
        const text = await blob.text();
        if (text.trim()) return text;
      }
    }
    const kind = fileRecord.fileType || fileRecord.type;
    if (fileRecord.storagePath && kind === 'pdf') {
      const raw = await stellaDownloadStorageBlob(fileRecord.storagePath);
      if (raw) {
        try { return await stellaExtractPdfText(raw); } catch { /* fall through */ }
      }
    }
    if (fileRecord.storagePath && (kind === 'text' || kind === 'txt' || kind === 'md')) {
      const raw = await stellaDownloadStorageBlob(fileRecord.storagePath);
      if (raw) return raw.text();
    }
    return null;
  };

  // Normalize the intake agent's context_qa into the canonical shape.
  const normalizeContextQa = (ctx, intakeMessages) => {
    const base = ctx && typeof ctx === 'object' ? ctx : {};
    let qa = Array.isArray(base.qa_pairs) ? base.qa_pairs.filter(p => p && (p.question || p.answer)) : [];
    if (!qa.length) {
      const msgs = intakeMessages || [];
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].role === 'assistant') {
          const ans = msgs.slice(i + 1).find(m => m.role === 'user');
          if (ans) qa.push({ question: msgs[i].content, answer: ans.content });
        }
      }
    }
    const relationships = Array.isArray(base.relationships)
      ? base.relationships.filter(r => r && (r.related_file || r.related_table)).map(r => ({
          related_file: r.related_file || '',
          related_table: r.related_table || '',
          this_field: r.this_field || '',
          related_field: r.related_field || '',
          note: r.note || '',
        }))
      : [];
    return {
      what_it_represents: base.what_it_represents || '',
      time_period: base.time_period || '',
      key_metrics: Array.isArray(base.key_metrics) ? base.key_metrics : (base.key_metrics ? [String(base.key_metrics)] : []),
      interpretation_notes: base.interpretation_notes || '',
      qa_pairs: qa,
      relationships,
    };
  };

  const stellaSaveBusinessContext = async (next) => {
    setStellaBusinessContext(next);
    setStellaBizSaveStatus('saving');
    try {
      const payload = new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' });
      await stellaUploadToStorage('business-context.json', payload, 'application/json');
      await reloadStellaBusinessContextFromSupabase();
      setStellaBizSaveStatus('saved');
      setTimeout(() => setStellaBizSaveStatus('idle'), 3000);
    } catch (e) {
      setStellaBizSaveStatus('error');
      setStellaMessages(prev => [...prev, { role: 'system', content: `⚠️ Could not persist business context to Supabase: ${e.message}` }]);
    }
  };

  // ── STELLA: File parsing ──
  const stellaReadAsText = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target.result || ''));
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsText(file);
  });

  const stellaBuildContentSummary = async ({ name, type, textSample, columns = [], profile = '' }) => {
    const system = withUserSettings(getStellaPrompts().contentSummary);
    const colText = columns.length ? `\n\nDETECTED COLUMNS:\n${columns.map(c => `- ${c.name}`).join('\n')}` : '';
    const profileText = profile ? `\n\nDATA PROFILE (observable facts — DO NOT ask about these):\n${profile}` : '';
    const user = `FILE:\n- name: ${name}\n- type: ${type}${colText}${profileText}\n\nCONTENT SAMPLE (may be truncated):\n${textSample}`;
    const raw = await callAnthropic(system, [{ role: 'user', content: user }], 1000);
    const parsed = extractJsonObject(raw);
    return parsed && typeof parsed === 'object' ? parsed : { summary: 'Uploaded dataset.', columns: [], suggestedQuestions: [] };
  };

  // Runs one intake turn for the given (up-to-date) file object.
  const stellaIntakeNextTurn = async (f) => {
    if (!f) return;
    const isDoc = !f.tableName;

    // Other tabular datasets this file could relate to (for AI-suggested joins).
    const otherTabular = (stellaDataFiles || []).filter(x => x.id !== f.id && x.tableName);
    const otherFilesBlob = otherTabular.length
      ? otherTabular.map(x => `- "${x.name}" (table ${x.tableName}) columns: ${(x.columns || []).map(c => c.name).join(', ') || '(unknown)'}`).join('\n')
      : '(no other datasets uploaded yet)';
    const relationshipGuidance = (!isDoc && otherTabular.length)
      ? `\n\nRELATIONSHIPS: Other datasets already exist (listed below). Based on the column names, if this dataset looks like it could be linked to any of them, propose the likely link in PLAIN ENGLISH and ask the user to confirm it makes sense — never ask them for technical join syntax. Example: "It looks like this sales file links to your Targets file by territory — is that right?". Capture any confirmed links in context_qa.relationships.\n\nOTHER DATASETS:\n${otherFilesBlob}`
      : '';

    const system = withUserSettings(fillTemplate(getStellaPrompts().intake, {
      kind: isDoc ? 'document' : 'dataset',
      kindSubject: isDoc ? 'document contains / represents' : 'data represents',
      relationshipBullet: (!isDoc && otherTabular.length) ? '\n- whether/how it relates to other uploaded datasets (propose the link in plain English for the user to confirm)' : '',
      dataProfile: (!isDoc && f.dataProfile) ? `\n\nDATA PROFILE (observable facts — DO NOT ask about these):\n${f.dataProfile}` : '',
      relationshipGuidance,
    }));

    const colsBlob = Array.isArray(f.columns) && f.columns.length
      ? f.columns.map(c => `- ${c.name}${c.type ? ` [${c.type}]` : ''}${c.description ? `: ${c.description}` : ''}`).join('\n')
      : '(no columns — this is a document)';
    const contextBlob = `FILE: "${f.name}" (type: ${f.fileType || f.type})\nSUMMARY: ${f.summary || ''}\nCOLUMNS:\n${colsBlob}`;
    const convo = [
      { role: 'user', content: `You are onboarding: "${f.name}".\n\n${contextBlob}` },
      ...((f.intakeMessages || []).map(m => ({ role: toAnthropicRole(m.role), content: m.content }))),
    ];

    let parsed = null;
    let raw = '';
    try {
      raw = await callAnthropic(system, convo, 900);
      parsed = extractJsonObject(raw);
    } catch { /* fall through to fallback handling */ }

    // Robust fallback: if we couldn't parse JSON, treat the raw text as the next question.
    const complete = !!(parsed && parsed.complete);
    const assistantMessage =
      (parsed && parsed.message) ||
      (complete ? 'Thanks — I have enough context to interpret this now.' : (String(raw).trim() || 'Could you tell me what this represents, the time period it covers, and the key metrics involved?'));

    const nextIntakeMessages = [...(f.intakeMessages || []), { role: 'assistant', content: assistantMessage }];

    if (complete) {
      const ctx = normalizeContextQa(parsed.context_qa, nextIntakeMessages);
      stellaPatchLocal(f.id, { intakeMessages: nextIntakeMessages, capturedContext: ctx, intakeComplete: true });
      try {
        await stellaUpdateRegistry(f.dbId, { context_qa: ctx });
      } catch (e) {
        setStellaMessages(prev => [...prev, { role: 'system', content: `⚠️ Could not save captured context: ${e.message}` }]);
      }
    } else {
      stellaPatchLocal(f.id, { intakeMessages: nextIntakeMessages });
    }
  };

  // Parse a tabular file (CSV / Excel / JSON array) into plain-object records.
  const stellaParseTabular = async (file, kind) => {
    if (kind === 'json') {
      const txt = await stellaReadAsText(file);
      const parsedJson = safeJsonParse(txt);
      if (Array.isArray(parsedJson)) return parsedJson.filter(r => r && typeof r === 'object' && !Array.isArray(r));
      return null; // not an array of objects → treat as a document
    }
    const xlsxMod = await import('xlsx');
    const XLSX = xlsxMod?.default || xlsxMod;
    let wb;
    if (kind === 'csv') {
      const txt = await stellaReadAsText(file);
      wb = XLSX.read(txt, { type: 'string' });
    } else {
      const buf = await file.arrayBuffer();
      wb = XLSX.read(buf, { type: 'array' });
    }
    const sheetName = wb.SheetNames?.[0];
    const ws = sheetName ? wb.Sheets[sheetName] : null;
    return ws ? XLSX.utils.sheet_to_json(ws, { defval: null }) : [];
  };

  const handleStellaDataUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const tempId = `tmp_${Date.now()}_${Math.random()}`;
    const lower = file.name.toLowerCase();
    const kind =
      lower.endsWith('.csv') ? 'csv'
      : (lower.endsWith('.xlsx') || lower.endsWith('.xls')) ? 'excel'
      : lower.endsWith('.json') ? 'json'
      : lower.endsWith('.pdf') ? 'pdf'
      : 'text';

    setStellaDataFiles(prev => [...prev, {
      id: tempId, dbId: null, name: file.name, type: kind, fileType: kind,
      size: `${(file.size / 1024).toFixed(1)} KB`, columns: [], rowCount: null,
      summary: '', capturedContext: null, tableName: null, storagePath: null, storageBucket: null,
      intakeMessages: [{ role: 'assistant', content: `⏳ Processing **${file.name}**…` }],
      intakeComplete: false, processing: true,
    }]);
    setActiveStellaDataId(tempId);
    setStellaTab('data');

    try {
      let tableName = null;
      let storagePath = null;
      let storageBucket = null;
      let columns = [];
      let rowCount = null;
      let sampleText = '';
      let dataProfile = '';

      // Decide flow: tabular (→ dynamic table) vs document (→ storage).
      let records = null;
      if (kind === 'csv' || kind === 'excel' || kind === 'json') {
        records = await stellaParseTabular(file, kind);
      }

      const isTabular = Array.isArray(records) && records.length > 0;

      if (isTabular) {
        // ── Tabular flow: create a dynamic table and load all rows ──
        const payload = stellaBuildTabularPayload(records);
        columns = payload.columns;
        rowCount = payload.rowCount;
        tableName = `stella_data_${stellaNanoId()}`;
        await stellaCreateAndLoadTable(tableName, payload.columns, payload.rows);
        sampleText = JSON.stringify(records.slice(0, 30), null, 2).substring(0, 16000);
        dataProfile = stellaProfileRecords(records);
      } else {
        // ── Document flow: upload raw file + persist full extracted text ──
        const cleanName = sanitizeStorageName(file.name);
        const objectRelPath = `data_${Date.now()}_${cleanName}`;
        let fullDocumentText = '';
        if (kind === 'pdf') {
          try { fullDocumentText = await stellaExtractPdfText(file); }
          catch { fullDocumentText = ''; }
          if (!fullDocumentText) fullDocumentText = `PDF document "${file.name}". Text could not be automatically extracted; please describe its contents in the intake questions.`;
        } else {
          fullDocumentText = await stellaReadAsText(file);
        }
        sampleText = fullDocumentText.substring(0, 18000);
        const up = await stellaUploadToStorage(objectRelPath, file, file.type || undefined);
        storagePath = up.objectPath;
        storageBucket = up.bucket;
        if (fullDocumentText.trim()) {
          await stellaUploadToStorage(`${objectRelPath}.extracted.txt`, new Blob([fullDocumentText], { type: 'text/plain' }), 'text/plain');
        }
      }

      // AI: plain-English summary + column descriptions.
      const onboarding = await stellaBuildContentSummary({
        name: file.name,
        type: kind,
        textSample: sampleText,
        columns: columns.map(c => ({ name: c.original || c.name })),
        profile: dataProfile,
      });
      const summary = onboarding.summary || (isTabular ? 'Uploaded dataset.' : 'Uploaded document.');

      // Merge AI column descriptions back onto the typed columns.
      let mergedColumns = columns;
      if (isTabular && Array.isArray(onboarding.columns) && onboarding.columns.length) {
        mergedColumns = columns.map(c => {
          const match = onboarding.columns.find(oc => (oc.name || '').toLowerCase() === String(c.original || c.name).toLowerCase());
          return match ? { ...c, description: match.description || '' } : c;
        });
      }

      // Persist a registry row (context_qa filled in once intake completes).
      const dbRow = await stellaInsertRegistry({
        file_name: file.name,
        file_type: kind,
        storage_path: storagePath,
        table_name: tableName,
        columns: mergedColumns,
        row_count: rowCount,
        summary,
        context_qa: null,
      });
      const dbId = dbRow?.id || tempId;

      // Opening intake message (asks 3-5 questions to seed the conversation).
      const questions = Array.isArray(onboarding.suggestedQuestions) ? onboarding.suggestedQuestions.slice(0, 5) : [];
      const colLine = mergedColumns.length ? `\n\n**Columns:** ${mergedColumns.map(c => c.name).join(', ')}` : '';
      const assistantMsg = `✅ Uploaded: **${file.name}**\n\n${summary}${colLine}\n\nTo interpret this correctly I need a little context. Let's start:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nYou can answer them all together or one at a time.`;

      const finalFile = {
        id: dbId, dbId,
        name: file.name, type: kind, fileType: kind,
        size: rowCount != null ? `${rowCount} rows` : `${(file.size / 1024).toFixed(1)} KB`,
        columns: mergedColumns, rowCount,
        summary, capturedContext: null, dataProfile,
        tableName, storagePath, storageBucket,
        textStoragePath: storagePath ? stellaExtractedTextPath(storagePath) : null,
        intakeMessages: [{ role: 'assistant', content: assistantMsg }],
        intakeComplete: false, processing: false,
        uploadedAt: dbRow?.uploaded_at || new Date().toISOString(),
      };
      setStellaDataFiles(prev => prev.map(f => (f.id === tempId ? finalFile : f)));
      setActiveStellaDataId(prev => (prev === tempId ? dbId : prev));
    } catch (e) {
      setStellaDataFiles(prev => prev.map(f => f.id === tempId
        ? { ...f, processing: false, intakeMessages: [{ role: 'system', content: `❌ Upload failed: ${e.message}` }] }
        : f));
    } finally {
      event.target.value = '';
    }
  };

  const handleStellaIntakeSend = async () => {
    const fileId = activeStellaDataId;
    const current = stellaDataFiles.find(x => x.id === fileId);
    const msg = stellaIntakeInput.trim();
    if (!current || !msg || current.processing) return;
    setStellaIntakeInput('');
    const updated = { ...current, intakeMessages: [...(current.intakeMessages || []), { role: 'user', content: msg }] };
    stellaPatchLocal(fileId, { intakeMessages: updated.intakeMessages });
    await stellaIntakeNextTurn(updated);
  };

  const handleStellaDeleteFile = async (fileId) => {
    const f = stellaDataFiles.find(x => x.id === fileId);
    if (!f) return;
    if (!window.confirm(`Delete "${f.name}" and its captured context? This cannot be undone.`)) return;
    try {
      if (f.dbId) await supabase.from('stella_files').delete().eq('id', f.dbId);
    } catch (e) {
      setStellaMessages(prev => [...prev, { role: 'system', content: `⚠️ Could not remove "${f.name}" from the registry: ${e.message}` }]);
    }
    try { if (f.tableName) await supabase.rpc('stella_drop_table', { p_table_name: f.tableName }); } catch { /* ignore */ }
    await stellaRemoveStorage(f.storagePath);
    if (f.storagePath) await stellaRemoveStorage(stellaExtractedTextPath(f.storagePath));
    setStellaDataFiles(prev => prev.filter(x => x.id !== fileId));
    setActiveStellaDataId(prev => (prev === fileId ? null : prev));
  };

  // ── STELLA: Reusable admin panels ──
  const renderStellaDataPanel = () => (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="w-full lg:w-2/5">
        <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-white">Datasets</div>
              <div className="text-xs text-blue-300/60 mt-1">Upload CSV, JSON, Excel, PDF, or plain text. Stella will capture context via intake questions.</div>
            </div>
            <button onClick={() => stellaDataFileInputRef.current?.click()} className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all flex items-center gap-2 text-sm">
              <Upload className="w-4 h-4" /> Upload
            </button>
            <input ref={stellaDataFileInputRef} type="file" accept=".csv,.json,.xlsx,.xls,.pdf,.txt,.md" onChange={handleStellaDataUpload} className="hidden" />
          </div>
        </div>

        <div className="space-y-3">
          {stellaDataFiles.length === 0 && (
            <div className="bg-slate-800/20 border border-slate-700/40 rounded-xl p-5 text-sm text-blue-300/60">
              No datasets uploaded yet. Upload a file to begin intake.
            </div>
          )}
          {stellaDataFiles.map(f => (
            <div key={f.id} className={`w-full bg-slate-800/30 border rounded-xl p-4 transition-all ${activeStellaDataId === f.id ? 'border-cyan-400/60 bg-cyan-500/10' : 'border-blue-400/20 hover:border-blue-400/40'}`}>
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => setActiveStellaDataId(f.id)} className="min-w-0 text-left flex-1">
                  <div className="text-sm font-semibold text-white truncate">{f.name}</div>
                  <div className="text-xs text-blue-300/60 mt-1">{f.size} • {f.type || 'file'}{Array.isArray(f.columns) && f.columns.length ? ` • ${f.columns.length} cols` : ''}</div>
                  {f.summary && <div className="text-xs text-blue-200/80 mt-2 line-clamp-3">{f.summary}</div>}
                </button>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  {f.capturedContext ? (
                    <span className="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded border border-green-400/30">Context captured</span>
                  ) : (
                    <span className="px-2 py-1 bg-yellow-500/15 text-yellow-200 text-xs rounded border border-yellow-400/25">Intake pending</span>
                  )}
                  <button onClick={() => handleStellaDeleteFile(f.id)} className="p-1.5 hover:bg-red-500/20 rounded transition-colors text-red-400" title="Delete file and context"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="w-full lg:w-3/5">
        <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-5">
          <div className="text-sm font-bold text-white mb-1">Intake assistant</div>
          <div className="text-xs text-blue-300/60 mb-4">Answer a few questions so Stella can interpret your dataset correctly.</div>

          {(() => {
            const f = stellaDataFiles.find(x => x.id === activeStellaDataId);
            if (!f) return <div className="text-sm text-blue-300/60">Select a dataset on the left.</div>;
            const intake = f.intakeMessages || [];
            return (
              <div className="space-y-3">
                <div className="bg-slate-900/40 border border-blue-400/15 rounded-xl p-4 max-h-[420px] overflow-y-auto custom-scrollbar space-y-3">
                  {intake.length === 0 ? (
                    <div className="text-sm text-blue-300/60">Upload processing…</div>
                  ) : intake.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[90%] px-3 py-2 rounded-xl text-sm ${m.role === 'user' ? 'bg-gradient-to-br from-cyan-500 to-blue-500 text-white' : m.role === 'system' ? 'bg-yellow-500/15 border border-yellow-400/25 text-yellow-200' : 'bg-slate-800/60 border border-blue-400/20 text-blue-100'}`}>
                        {m.role === 'user' ? <span className="whitespace-pre-wrap">{m.content}</span> : <MessageErrorBoundary>{formatMarkdown(m.content)}</MessageErrorBoundary>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <textarea value={stellaIntakeInput} onChange={(e) => setStellaIntakeInput(e.target.value)} placeholder="Answer the intake questions…" className="flex-1 bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors resize-none" rows={2} />
                  <button onClick={handleStellaIntakeSend} disabled={!stellaIntakeInput.trim()} className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:opacity-40 text-white font-semibold rounded-lg transition-all flex items-center gap-2 text-sm">
                    <Send className="w-4 h-4" /> Send
                  </button>
                </div>

                {Array.isArray(f.columns) && f.columns.length > 0 && (
                  <details className="bg-slate-900/40 border border-blue-400/15 rounded-xl overflow-hidden">
                    <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold text-blue-300 hover:bg-slate-800/40 flex items-center gap-2">
                      <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" /> Detected fields ({f.columns.length})
                    </summary>
                    <div className="px-4 pb-4 space-y-1">
                      {f.columns.map((c, i) => (
                        <div key={i} className="text-[11px] text-blue-200/80"><span className="text-cyan-300 font-semibold">{c.name}</span>{c.type ? <span className="text-blue-400/50"> [{c.type}]</span> : null}{c.description ? ` — ${c.description}` : ''}</div>
                      ))}
                    </div>
                  </details>
                )}

                {f.capturedContext && (
                  <details className="bg-emerald-500/10 border border-emerald-400/20 rounded-xl overflow-hidden">
                    <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold text-emerald-300 hover:bg-emerald-500/10 flex items-center gap-2">
                      <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" /> Captured context
                    </summary>
                    <pre className="px-4 pb-4 text-[11px] text-emerald-200/90 whitespace-pre-wrap">{JSON.stringify(f.capturedContext, null, 2)}</pre>
                  </details>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );

  const renderStellaBusinessPanel = () => (
    <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
      <h3 className="text-lg font-bold text-white mb-2">Business Context</h3>
      <p className="text-xs text-blue-300/60 mb-6">This context is injected into every Stella chat prompt.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-blue-300/70 font-semibold mb-2">Company name</label>
          <input value={stellaBusinessContext.companyName} onChange={(e) => setStellaBusinessContext(prev => ({ ...prev, companyName: e.target.value }))} className="w-full bg-slate-900/50 text-white border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-blue-300/70 font-semibold mb-2">Industry</label>
          <input value={stellaBusinessContext.industry} onChange={(e) => setStellaBusinessContext(prev => ({ ...prev, industry: e.target.value }))} className="w-full bg-slate-900/50 text-white border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs text-blue-300/70 font-semibold mb-2">Key goals</label>
          <textarea value={stellaBusinessContext.keyGoals} onChange={(e) => setStellaBusinessContext(prev => ({ ...prev, keyGoals: e.target.value }))} rows={3} className="w-full bg-slate-900/50 text-white border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs text-blue-300/70 font-semibold mb-2">Key metrics</label>
          <textarea value={stellaBusinessContext.keyMetrics} onChange={(e) => setStellaBusinessContext(prev => ({ ...prev, keyMetrics: e.target.value }))} rows={3} className="w-full bg-slate-900/50 text-white border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs text-blue-300/70 font-semibold mb-2">Terminology / definitions</label>
          <textarea value={stellaBusinessContext.terminology} onChange={(e) => setStellaBusinessContext(prev => ({ ...prev, terminology: e.target.value }))} rows={4} className="w-full bg-slate-900/50 text-white border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y" />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-6">
        <button onClick={() => stellaSaveBusinessContext(stellaBusinessContext)} disabled={stellaBizSaveStatus === 'saving'} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:opacity-50 text-white font-semibold rounded-lg transition-all flex items-center gap-2">
          <Save className="w-4 h-4" /> {stellaBizSaveStatus === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => stellaSaveBusinessContext({ companyName: '', industry: '', keyGoals: '', keyMetrics: '', terminology: '' })} className="px-5 py-2.5 bg-slate-700/60 hover:bg-slate-600/60 text-slate-200 font-semibold rounded-lg transition-all border border-slate-500/30">
          Reset
        </button>
        {stellaBizSaveStatus === 'saved' && (
          <span className="flex items-center gap-1.5 text-sm text-green-400 font-semibold"><CheckCircle className="w-4 h-4" /> Saved to Supabase</span>
        )}
        {stellaBizSaveStatus === 'error' && (
          <span className="flex items-center gap-1.5 text-sm text-red-400 font-semibold"><AlertTriangle className="w-4 h-4" /> Save failed — see chat</span>
        )}
      </div>
    </div>
  );

  const renderStellaConnectionsPanel = () => (
    <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
      <h3 className="text-lg font-bold text-white mb-2">Connections</h3>
      <p className="text-xs text-blue-300/60 mb-6">Direct connectors (APIs / databases / CRM) will be enabled here in a future release.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { name: 'Salesforce' },
          { name: 'Veeva' },
          { name: 'SAP' },
          { name: 'Power BI' },
          { name: 'Google Analytics' },
          { name: 'Databricks' },
        ].map(c => (
          <div key={c.name} className="bg-slate-800/20 border border-slate-700/50 rounded-2xl p-5 opacity-60">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-bold text-slate-200">{c.name}</div>
                <div className="text-xs text-slate-400 mt-1">Connector</div>
              </div>
              <span className="px-2 py-1 bg-slate-700/50 text-slate-300 text-xs rounded border border-slate-600/50">Coming Soon</span>
            </div>
            <div className="mt-4 text-xs text-slate-400/80">Authentication, schema mapping, and scheduled sync will be available.</div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── STELLA: Chat prompt builder + submit ──
  const buildStellaSystemPrompt = (filesArg) => {
    const files = Array.isArray(filesArg) ? filesArg : (stellaDataFiles || []);
    const biz = stellaBusinessContext || {};
    const bizText = `BUSINESS CONTEXT:\n- Company: ${biz.companyName || '(not set)'}\n- Industry: ${biz.industry || '(not set)'}\n- Key goals: ${biz.keyGoals || '(not set)'}\n- Key metrics: ${biz.keyMetrics || '(not set)'}\n- Terminology/definitions: ${biz.terminology || '(not set)'}\n`;

    const tabular = files.filter(f => f.tableName);
    const docs = files.filter(f => !f.tableName);

    const blocks = files.map((f, i) => {
      const cols = Array.isArray(f.columns) && f.columns.length
        ? f.columns.map(c => `    - ${c.name}${c.original && c.original !== c.name ? ` (source header: "${c.original}")` : ''} [${c.type || 'text'}]${c.description ? `: ${c.description}` : ''}`).join('\n')
        : '    (no columns — this is a document)';
      const location = f.tableName
        ? `SQL table: ${f.tableName}`
        : `Document (use read_document tool for full text; path: ${f.storagePath || 'n/a'})`;
      const ctx = stellaFormatContextQa(f.capturedContext).split('\n').map(l => `    ${l}`).join('\n');
      return `FILE ${i + 1}: ${f.name}\n- Type: ${f.fileType || f.type || 'file'}\n- ${location}${f.rowCount != null ? `\n- Rows: ${f.rowCount}` : ''}\n- Summary: ${f.summary || '(none)'}\n- Columns:\n${cols}\n- Interpretive context:\n${ctx}`;
    }).join('\n\n');

    const tableList = tabular.length ? tabular.map(t => t.tableName).join(', ') : '(none)';
    const sqlInstr = tabular.length
      ? `\nTABULAR DATA (query with tools):\n- Query tables using the \`run_sql\` tool (single SELECT only). Available tables: ${tableList}.\n- Use \`inspect_table\` to preview a table's real values/formats before writing analytical queries.\n- Reference the EXACT (safe) column names shown above, not the original headers.\n- To combine datasets, JOIN across tables using the confirmed relationships above (or a sensible key if none is confirmed — state the assumption).\n`
      : '';
    const docList = docs.length ? docs.map(d => `"${d.name}"`).join(', ') : '(none)';
    const docInstr = docs.length
      ? `\nDOCUMENTS (PDF / text):\n- Full text is available via the \`read_document\` tool. Documents: ${docList}.\n- Use \`read_document\` when you need specific facts, quotes, or details from a PDF/text file — not just the summary above.\n`
      : '';
    const crossInstr = (tabular.length && docs.length)
      ? `\nCROSS-SOURCE QUESTIONS:\nMany questions combine tabular data (sales, engagement metrics in SQL) with document context (policies, reports, PDFs). For these:\n1. Use \`read_document\` to pull relevant passages from PDFs/text files\n2. Use \`inspect_table\` / \`run_sql\` for quantitative data\n3. Synthesise both in your answer — explicitly connect numbers to document context\n4. Verify that findings from each source align before answering\n`
      : '';

    return withUserSettings(fillTemplate(getStellaPrompts().analyst, {
      bizText,
      fileCount: files.length,
      filePlural: files.length === 1 ? '' : 's',
      blocks: blocks || '(no files uploaded yet)',
      sqlInstr,
      docInstr,
      crossInstr,
    }));
  };

  const stellaRunQuery = async (sql) => {
    const res = await fetch(STELLA_QUERY_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Query failed (${res.status})`);
    return Array.isArray(data.rows) ? data.rows : [];
  };

  // Tools the Stella agent can call during its investigation loop.
  const STELLA_TOOLS = [
    {
      name: 'run_sql',
      description: 'Execute a single read-only SQL SELECT against the uploaded datasets and return matching rows as JSON. Only SELECT is allowed. Use exact table and column names from the data catalog. Use JOINs to combine datasets.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'A single SQL SELECT statement.' } },
        required: ['query'],
      },
    },
    {
      name: 'inspect_table',
      description: 'Preview a dataset table (up to 8 sample rows) to understand its real values, formats and categories before writing analytical queries.',
      input_schema: {
        type: 'object',
        properties: { table: { type: 'string', description: 'Exact table name from the data catalog.' } },
        required: ['table'],
      },
    },
    {
      name: 'read_document',
      description: 'Read the full text of an uploaded PDF or text document by exact file name from the data catalog. Use when you need specific details, quotes, or facts from a document — especially when combining document content with tabular SQL results.',
      input_schema: {
        type: 'object',
        properties: {
          file_name: { type: 'string', description: 'Exact file name from the data catalog (e.g. "Q1 Engagement Report.pdf").' },
          search_hint: { type: 'string', description: 'Optional keyword or topic to focus on when scanning a long document.' },
        },
        required: ['file_name'],
      },
    },
  ];

  // Execute a tool call requested by the agent; returns { text, step }.
  const runStellaTool = async (name, input, knownTables, files) => {
    if (name === 'inspect_table') {
      const table = String(input?.table || '').trim();
      if (!knownTables.includes(table)) {
        return { text: `Unknown table "${table}". Available: ${knownTables.join(', ') || '(none)'}.`, step: { type: 'error', label: `Inspect ${table}`, detail: 'Unknown table' } };
      }
      try {
        const rows = await stellaRunQuery(`SELECT * FROM ${table} LIMIT 8`);
        const cols = rows.length ? Object.keys(rows[0]) : [];
        return {
          text: `Sample rows from ${table} (up to 8):\n${JSON.stringify(rows).slice(0, 6000)}`,
          step: { type: 'inspect', label: `Inspected ${table}`, detail: cols.length ? `Columns: ${cols.join(', ')}` : `${rows.length} sample row${rows.length === 1 ? '' : 's'}`, result: stellaPreviewRows(rows) },
        };
      } catch (err) {
        return { text: `Could not inspect ${table}: ${err.message}`, step: { type: 'error', label: `Inspect ${table}`, detail: err.message } };
      }
    }
    if (name === 'run_sql') {
      const query = String(input?.query || '').trim();
      try {
        const rows = await stellaRunQuery(query);
        return {
          text: `Rows (${rows.length}):\n${JSON.stringify(rows).slice(0, 10000)}`,
          step: { type: 'query', label: 'Ran query', detail: query, resultCount: rows.length, result: stellaPreviewRows(rows) },
        };
      } catch (err) {
        return { text: `Query failed: ${err.message}`, step: { type: 'error', label: 'Query failed', detail: `${query}\n→ ${err.message}` } };
      }
    }
    if (name === 'read_document') {
      const fileName = String(input?.file_name || '').trim();
      const hint = String(input?.search_hint || '').trim().toLowerCase();
      const doc = (files || []).find(f => !f.tableName && f.name.toLowerCase() === fileName.toLowerCase())
        || (files || []).find(f => !f.tableName && f.name.toLowerCase().includes(fileName.toLowerCase()));
      if (!doc) {
        const available = (files || []).filter(f => !f.tableName).map(f => f.name).join(', ') || '(none)';
        return { text: `Document "${fileName}" not found. Available documents: ${available}`, step: { type: 'error', label: 'Document not found', detail: fileName } };
      }
      try {
        let text = await stellaFetchDocumentText(doc);
        if (!text || !text.trim()) {
          return { text: `No extractable text found for "${doc.name}". Use the summary and intake context from the catalog.`, step: { type: 'error', label: `Read ${doc.name}`, detail: 'No text extracted' } };
        }
        const TOOL_CHAR_CAP = 55000;
        let excerpt = text;
        let truncated = false;
        if (hint && text.length > 8000) {
          const paras = text.split(/\n{2,}/);
          const hits = paras.filter(p => p.toLowerCase().includes(hint));
          if (hits.length) excerpt = hits.join('\n\n');
        }
        if (excerpt.length > TOOL_CHAR_CAP) {
          excerpt = excerpt.slice(0, TOOL_CHAR_CAP);
          truncated = true;
        }
        return {
          text: `Full text of "${doc.name}"${hint ? ` (filtered by: ${hint})` : ''}${truncated ? ' [truncated]' : ''}:\n\n${excerpt}`,
          step: { type: 'document', label: `Read ${doc.name}`, detail: `${excerpt.length.toLocaleString()} characters${truncated ? ' (truncated)' : ''}${hint ? ` · hint: ${hint}` : ''}` },
        };
      } catch (err) {
        return { text: `Could not read "${doc.name}": ${err.message}`, step: { type: 'error', label: `Read ${doc.name}`, detail: err.message } };
      }
    }
    return { text: `Unknown tool: ${name}`, step: { type: 'error', label: `Unknown tool ${name}`, detail: '' } };
  };

  // Collapsible "How Stella worked this out" reasoning trail.
  const renderStellaSteps = (steps) => {
    const iconFor = (t) => (t === 'query' ? '🔎' : t === 'inspect' ? '👁' : t === 'document' ? '📄' : t === 'error' ? '⚠️' : '🧠');
    return (
      <details className="mt-3 bg-slate-900/50 border border-blue-400/20 rounded-lg overflow-hidden">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-cyan-300/90 hover:bg-slate-800/50 flex items-center gap-2">
          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" /> How Stella worked this out ({steps.length} step{steps.length === 1 ? '' : 's'})
        </summary>
        <ol className="px-3 pb-3 pt-1 space-y-2 list-none">
          {steps.map((s, i) => (
            <div key={i} className="text-[11px] text-blue-200/80 border-l-2 border-blue-400/25 pl-2.5">
              <div className="font-semibold text-blue-100/90">{i + 1}. {iconFor(s.type)} {s.label}{typeof s.resultCount === 'number' ? ` — ${s.resultCount} row${s.resultCount === 1 ? '' : 's'}` : ''}</div>
              {s.detail && (s.type === 'thought'
                ? <div className="mt-0.5 whitespace-pre-wrap text-blue-200/85 leading-relaxed">{s.detail}</div>
                : <pre className="mt-0.5 whitespace-pre-wrap text-blue-300/70 bg-slate-950/40 rounded px-2 py-1 overflow-x-auto">{s.detail}</pre>)}
              {s.result && <pre className="mt-1 whitespace-pre-wrap text-emerald-200/70 bg-emerald-950/20 border border-emerald-400/15 rounded px-2 py-1 overflow-x-auto">{s.result}</pre>}
            </div>
          ))}
        </ol>
      </details>
    );
  };

  const handleStellaChatSubmit = async (e) => {
    if (e) e.preventDefault();
    const messageContent = stellaInput.trim();
    if (!messageContent || stellaIsLoading) return;
    setStellaIsLoading(true);
    setStellaMessages(prev => [...prev, { role: 'user', content: messageContent }]);
    setStellaInput('');
    try {
      // Always build the prompt from the freshest registry.
      const registry = await stellaReloadRegistry();
      const files = registry || stellaDataFiles;
      const knownTables = files.filter(f => f.tableName).map(f => f.tableName);
      const systemPrompt = buildStellaSystemPrompt(files);

      // Prior turns as plain strings; the agent loop uses structured content.
      const convo = [
        ...stellaMessages.filter(m => m.role !== 'system').map(m => ({ role: toAnthropicRole(m.role), content: m.content })),
        { role: 'user', content: messageContent },
      ];

      const steps = [];
      let finalText = '';
      const MAX_STEPS = 8;

      for (let round = 0; round < MAX_STEPS; round++) {
        const resp = await anthropicMessagesPost({
          system: systemPrompt,
          messages: convo,
          tools: STELLA_TOOLS,
          max_tokens: 5000,
          thinking: { type: 'enabled', budget_tokens: 2500 },
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message);

        const content = Array.isArray(data.content) ? data.content : [];
        const thinkingParts = content
          .filter(b => (b.type === 'thinking' || b.type === 'redacted_thinking'))
          .map(b => (b.type === 'redacted_thinking' ? '(internal reasoning)' : b.thinking))
          .filter(Boolean);
        const textParts = content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        const toolUses = content.filter(b => b.type === 'tool_use');

        // Capture the model's actual extended-thinking reasoning for the trail.
        thinkingParts.forEach((t, idx) => {
          const detail = String(t).trim();
          if (detail) steps.push({ type: 'thought', label: (round === 0 && idx === 0) ? 'Plan' : 'Reasoning', detail });
        });
        // Capture any narrated commentary that accompanies a tool call.
        if (textParts && toolUses.length) {
          steps.push({ type: 'thought', label: 'Note', detail: textParts });
        }

        if (data.stop_reason !== 'tool_use' || !toolUses.length) {
          finalText = textParts || finalText;
          break;
        }

        // Record the assistant turn (must include the tool_use blocks verbatim).
        convo.push({ role: 'assistant', content });

        // Execute each requested tool and feed results back.
        const toolResults = [];
        for (const tu of toolUses) {
          const { text, step } = await runStellaTool(tu.name, tu.input, knownTables, files);
          steps.push(step);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: text });
        }
        convo.push({ role: 'user', content: toolResults });

        // On the last allowed round, force a plain-text final answer next.
        if (round === MAX_STEPS - 1) {
          const wrapResp = await anthropicMessagesPost({
            system: systemPrompt,
            messages: [...convo, { role: 'user', content: 'Please give your final answer now based on what you found.' }],
            max_tokens: 4000,
            thinking: { type: 'enabled', budget_tokens: 2000 },
          });
          const wrapData = await wrapResp.json();
          if (!wrapData.error) finalText = anthropicAssistantText(wrapData) || finalText;
        }
      }

      const cleaned = stellaStripSqlBlocks(finalText) || finalText || 'I couldn\'t find enough to answer that from the available data.';
      setStellaMessages(prev => [...prev, { role: 'assistant', content: cleaned, steps }]);
    } catch (error) {
      setStellaMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Error: Unable to process request.\n\n${error?.message || 'Unknown error'}` }]);
    } finally {
      setStellaIsLoading(false);
    }
  };

  const askPptxClarification = () => {
    setPptxClarifyPending(true);
    setPptxOffers(null);
    setSuggestedPrompts([]);
    setMessages(prev => [...prev, { role: 'assistant', content: getPptxClarify().prompt }]);
  };

  const choiceButtons = useMemo(() => {
    if (isLoading || pptxGenerating) return null;
    if (pptxClarifyPending) return getPptxClarify().options;
    if (currentWorkflow?.awaitingAgentReply) return null;
    if (currentWorkflow || pendingWorkflow || orchestratorDecision) return null;
    const list = Array.isArray(messages) ? messages : [];
    const last = [...list].reverse().find(m => m.role === 'assistant' || m.role === 'orchestrator');
    if (!last?.content) return null;
    if (hasNumberedClarifyingQuestions(last.content)) return null;
    return extractChoiceOptions(last.content);
  }, [messages, pptxClarifyPending, isLoading, pptxGenerating, currentWorkflow, pendingWorkflow, orchestratorDecision]);

  const clarifyingReplyHint = useMemo(() => {
    if (isLoading || pptxGenerating) return false;
    if (currentWorkflow?.awaitingAgentReply) return true;
    if (currentWorkflow || pendingWorkflow || orchestratorDecision || pptxClarifyPending) return false;
    const list = Array.isArray(messages) ? messages : [];
    const last = [...list].reverse().find((m) => m.role === 'assistant' || m.role === 'orchestrator');
    return hasNumberedClarifyingQuestions(last?.content);
  }, [messages, pptxClarifyPending, isLoading, pptxGenerating, currentWorkflow, pendingWorkflow, orchestratorDecision]);

  const offerFromClassification = (classified) => {
    if (!classified) return null;
    if (classified.mode === 'summary') {
      return {
        title: classified.title || 'Session Summary',
        description: classified.description || 'Factual recap of this conversation',
      };
    }
    return {
      title: classified.title || 'Working Document',
      description: classified.description || 'Document based on this conversation',
      deckType: classified.deckType || 'general',
      hasRealData: true,
    };
  };

  /** Route a user message using pptxContext.messageClassify from settings JSON (no hardcoded intent rules). */
  const classifyUserMessageIntent = async (messageContent) => {
    const text = String(messageContent || '').trim();
    if (!text) return { kind: 'none' };
    try {
      const pptxCtx = getPptxContext(productIntel);
      const raw = await callAnthropic(
        `${pptxCtx.messageClassify}${buildUserSettingsPromptBlock(userSettings)}`,
        [{ role: 'user', content: `User message:\n${text}` }],
        350,
      );
      const parsed = extractJsonObject(raw)
        || safeJsonParse(String(raw || '').replace(/```json|```/gi, '').trim());
      if (!parsed || typeof parsed !== 'object') return { kind: 'none' };
      const kind = String(parsed.kind || 'none').toLowerCase();
      if (kind === 'assessment') return { kind: 'assessment' };
      if (kind === 'export') {
        const mode = parsed.mode === 'summary' || parsed.mode === 'produced' ? parsed.mode : null;
        return {
          kind: 'export',
          clear: !!parsed.clear && !!mode,
          mode,
          deckType: parsed.deckType || null,
          title: parsed.title || null,
          description: parsed.description || null,
        };
      }
      return { kind: 'none' };
    } catch (e) {
      console.warn('classifyUserMessageIntent error:', e);
      return { kind: 'none' };
    }
  };

  const resolvePptxClarificationReply = async (messageContent) => {
    const m = String(messageContent || '').toLowerCase().trim();
    // Structural mapping to the numbered clarify UI options (labels live in settings pptxClarify).
    if (/^(1|one)\b/.test(m)) {
      return { mode: 'summary', offer: { title: 'Session Summary', description: 'Factual recap of this conversation' } };
    }
    if (/^(2|two)\b/.test(m)) {
      return { mode: 'produced', offer: { title: 'IC One-Pager', description: 'Simple one-page IC overview', deckType: 'ic_one_pager', hasRealData: true } };
    }
    if (/^(3|three)\b/.test(m)) {
      return { mode: 'produced', offer: { title: 'IC Documentation Pack', description: 'Full IC documentation from this conversation', deckType: 'ic_doc_pack', hasRealData: true } };
    }
    const classified = await classifyUserMessageIntent(messageContent);
    if (classified.kind === 'export' && classified.clear && classified.mode) {
      return { mode: classified.mode, offer: offerFromClassification(classified) };
    }
    return null;
  };

  const handleGeneratePptx = async (offer, mode = 'summary') => {
    const savedOffers = pptxOffers;
    setPptxOffers(null);
    setPptxClarifyPending(false);
    setPptxGenerating(true);

    const isSummary = mode === 'summary';
    const deckType = offer?.deckType || (isSummary ? 'session_summary' : 'general');
    const conversationContext = buildPptxConversationContext(messages);
    const pptxCtx = getPptxContext(productIntel);
    const systemPrompt = withUserSettings(isSummary ? pptxCtx.summary : pptxCtx.produced);
    const userContent = [
      `Export mode: ${isSummary ? 'SESSION SUMMARY (chat facts only)' : 'PRODUCED WORKING DOCUMENT'}`,
      `Requested title: "${offer?.title || (isSummary ? 'Session Summary' : 'Working Document')}"`,
      `deckType: ${deckType}`,
      `hasRealData hint: ${offer?.hasRealData ? 'true' : 'false'}`,
      '',
      'Conversation Context (ONLY source of truth — do not invent beyond this):',
      conversationContext || '(empty conversation)',
    ].join('\n');

    try {
      if (!conversationContext.trim()) {
        throw new Error('No conversation content to export yet. Continue the discussion, then try again.');
      }

      const res = await anthropicMessagesPost({
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        max_tokens: isSummary ? 4096 : 8192,
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API error ${res.status}: ${errText.substring(0, 200)}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(`API error: ${data.error.message || JSON.stringify(data.error)}`);

      let raw = anthropicAssistantText(data)?.trim() || '';
      if (!raw) throw new Error('Empty response from API');

      let slideData = parsePptxSlidePayload(raw, offer?.title || 'PowerPoint');

      // If truncated, ask the model to finish a complete JSON payload.
      if (!slideData?.slides?.length && (raw.length > 1500 || /slides/i.test(raw))) {
        const contRes = await anthropicMessagesPost({
          system: withUserSettings(getWorkflowRuntime().pptxRepairPrompt),
          messages: [{
            role: 'user',
            content: `Finish this PowerPoint JSON. Mode=${isSummary ? 'summary' : 'produced'}, deckType=${deckType}, title="${offer?.title || ''}".\n\nPartial output:\n${raw.slice(-3500)}\n\nConversation Context:\n${conversationContext.slice(0, 12000)}`,
          }],
          max_tokens: 8192,
        });
        if (contRes.ok) {
          const contData = await contRes.json();
          const contRaw = anthropicAssistantText(contData)?.trim() || '';
          if (contRaw) {
            raw = contRaw;
            slideData = parsePptxSlidePayload(contRaw, offer?.title || 'PowerPoint');
          }
        }
      }

      if (!slideData?.slides?.length) throw new Error('Could not parse slide JSON from the model response');

      const wantsOnePager = !isSummary || /incentive|scheme|component|weighting|payout|ic\b/i.test(conversationContext.slice(0, 6000));
      slideData = ensureIcOnePagerSlide(slideData, { force: wantsOnePager });

      const getPptxGen = () => window.PptxGenJS || window.pptxgen || window.PptxGenJs;
      if (!getPptxGen()) {
        await new Promise((resolve, reject) => {
          const urls = ['https://unpkg.com/pptxgenjs@3.12.0/dist/pptxgen.bundle.js', 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'];
          let tried = 0;
          const tryNext = () => {
            if (tried >= urls.length) { reject(new Error('Could not load PptxGenJS')); return; }
            const script = document.createElement('script');
            script.src = urls[tried++];
            script.onload = () => { if (getPptxGen()) resolve(); else tryNext(); };
            script.onerror = tryNext;
            document.head.appendChild(script);
          };
          tryNext();
        });
      }
      const PptxGenJS = getPptxGen();
      if (!PptxGenJS) throw new Error('PptxGenJS library not available');

      const pptx = new PptxGenJS();
      const theme = await loadFullPptxStyleForGeneration(userSettings, supabase);
      applyPptxLayout(pptx, theme);
      pptx.title = slideData.title || offer?.title || 'PowerPoint';

      const slides = Array.isArray(slideData.slides) ? slideData.slides.filter(s => s && (s.type || s.title)) : [];
      if (!slides.length) throw new Error('No slides returned');

      slides.forEach((slide, idx) => {
        slide.bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
        slide.bulletsRight = Array.isArray(slide.bulletsRight) ? slide.bulletsRight : [];
        slide.dataPoints = Array.isArray(slide.dataPoints) ? slide.dataPoints : [];
        if (!slide.type) slide.type = idx === 0 ? 'title' : 'content';
        renderSlideFromTheme(pptx, theme, slide, idx);
      });

      const fileName = (slideData.title || offer?.title || 'powerpoint').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      await pptx.writeFile({ fileName: `${fileName}.pptx` });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `📊 **PowerPoint generated** — "${slideData.title || offer?.title}" (${slides.length} slides${isSummary ? ', conversation summary' : `, ${deckType}`}). Check your downloads folder.`,
      }]);
    } catch (e) {
      console.error('PPTX generation error:', e);
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Could not generate PowerPoint: ${e.message || 'Unknown error'}. You can try again, or tell me whether you want a **session summary**, **one-pager**, or **full documentation pack**.` }]);
      if (savedOffers) setPptxOffers(savedOffers);
    } finally {
      setPptxGenerating(false);
    }
  };

  const startPptxExportFromUi = () => {
    // Ambiguous export from the button → clarify in main chat.
    askPptxClarification();
  };

  const handleTerritoryStructureUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!parsed.name || !parsed.territories) { alert('Invalid territory structure file.'); return; }
        const newStructure = { ...parsed, id: `ts_${Date.now()}`, uploadedAt: new Date().toISOString().split('T')[0] };
        setTerritoryStructures(prev => [...prev, newStructure]);
        setSelectedTerritoryStructure(newStructure.id);
      } catch { alert('Could not parse file. Please upload a valid JSON territory structure.'); }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleSubmit = async (e, overrideInput = null, isFileAnalysis = false) => {
    if (e) e.preventDefault();
    const messageContent = overrideInput || input.trim();
    if (!messageContent || isLoading) return;

    if (pendingImageReview?.unsure?.length && !currentWorkflow) {
      setInput('');
      const lower = messageContent.toLowerCase().trim();
      setMessages((prev) => [...prev, { role: 'user', content: messageContent }]);
      const wantsProceed = /\b(include all|all of them|yes all|keep all|assess|analyze|analyse|continue|proceed|start workflow|go ahead)\b/.test(lower)
        || lower === 'all' || lower === 'yes' || lower === 'y';
      if (wantsProceed) {
        await applyUnsureImageDecision('*', true);
        return;
      }
      if (/\b(skip all|ignore all|none|no all)\b/.test(lower) || lower === 'none' || lower === 'no') {
        await applyUnsureImageDecision('*', false);
        return;
      }
      const named = pendingImageReview.unsure.find((img) => lower.includes(String(img.name || '').toLowerCase()));
      if (named) {
        const keep = !/\b(skip|ignore|drop|no)\b/.test(lower);
        await applyUnsureImageDecision(named.name, keep);
        return;
      }
      setMessages((prev) => [...prev, {
        role: 'system',
        content: 'Reply **include all** or **skip all**, or use the Include / Skip buttons on each thumbnail.',
      }]);
      return;
    }

    if ((pendingProposalIntakeRef.current || pendingProposalIntake) && !currentWorkflow) {
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', content: messageContent }]);
      await continueProposalIntake(messageContent);
      return;
    }

    setInput('');
    // Capture before clearing — needed to route Continue / typed replies correctly
    const pendingDecision = orchestratorDecision;
    setOrchestratorDecision(null);
    setPendingButtonAction(null);

    // Resolve pending PPT export clarification before normal chat routing.
    if (pptxClarifyPending && !currentWorkflow) {
      setMessages(prev => [...prev, { role: 'user', content: messageContent }]);
      const lower = messageContent.toLowerCase();
      if (/\b(cancel|never mind|no thanks|forget it)\b/.test(lower)) {
        setPptxClarifyPending(false);
        setMessages(prev => [...prev, { role: 'assistant', content: 'No problem — export cancelled. You can use **📊 Export as PowerPoint** again whenever you want.' }]);
        setIsLoading(false);
        return;
      }
      const resolved = await resolvePptxClarificationReply(messageContent);
      if (resolved?.mode && resolved.offer) {
        setPptxClarifyPending(false);
        setIsLoading(false);
        await handleGeneratePptx(resolved.offer, resolved.mode);
        return;
      }
      setMessages(prev => [...prev, { role: 'assistant', content: `I still need a clear choice.\n\n${getPptxClarify().prompt}` }]);
      setIsLoading(false);
      return;
    }

    setPptxOffers(null);
    setMessages(prev => [...prev, { role: 'user', content: messageContent }]);
    setIsLoading(true);

    // Uploaded IC proposal → always Analyze Existing IC workflow (never PPT export).
    if (isFileAnalysis && !currentWorkflow) {
      const analyzeTopic = topics.find((t) => t.id === 'analyze_ic');
      if (analyzeTopic) {
        const fileName = uploadedFile?.name;
        const workflowMessage = fileName
          ? `Assess my IC. The user uploaded "${fileName}" for assessment against best practices and the 6 Fundamental Axes. Extract the scheme from that proposal and analyse it.`
          : messageContent;
        setPendingWorkflow(null);
        setPptxClarifyPending(false);
        await launchWorkflowDirect('analyze_ic', workflowMessage);
        return;
      }
    }

    if (currentWorkflow) {
      const topic = topics.find(t => t.id === currentWorkflow.topicId);
      if (topic) {
        // Agent still collecting answers — keep talking to that specialist
        if (currentWorkflow.awaitingAgentReply) {
          await continueAgentWithUserReply(topic, currentWorkflow.currentStep, messageContent, currentWorkflow.context || []);
          return;
        }
        // Stage-complete decision pending — map typed "yes/continue" to proceed, not a silent redesign
        if (pendingDecision) {
          const action = resolveOrchestratorTypedAction(messageContent, pendingDecision);
          await handleOrchestratorAction(action, pendingDecision, messageContent);
          return;
        }
        if (currentWorkflow.waitingForUser) {
          await continueAgentWithUserReply(topic, currentWorkflow.currentStep, messageContent, currentWorkflow.context || []);
          return;
        }
        await runWorkflowStep(topic, currentWorkflow.currentStep, messageContent, currentWorkflow.context || []);
        return;
      }
    }

    // PPT export vs IC assessment — classified via settings pptxContext.messageClassify (not hardcoded regex).
    if (!isFileAnalysis) {
      const routed = await classifyUserMessageIntent(messageContent);
      if (routed.kind === 'export') {
        if (routed.clear && routed.mode) {
          setIsLoading(false);
          await handleGeneratePptx(offerFromClassification(routed), routed.mode);
          return;
        }
        setIsLoading(false);
        askPptxClarification();
        return;
      }
      if (routed.kind === 'assessment' && !currentWorkflow) {
        const analyzeTopic = topics.find((t) => t.id === 'analyze_ic');
        if (analyzeTopic) {
          setPendingWorkflow(null);
          await launchWorkflowDirect('analyze_ic', messageContent);
          return;
        }
      }
    }

    const msg = messageContent.toLowerCase();
    let matchedTopic = topics.find(topic => topic.status === 'active' && topic.triggerKeywords.some(kw => msg.includes(kw.toLowerCase())));

    if (!matchedTopic && topics.length > 0) {
      try {
        const workflowList = topics.filter(t => t.status === 'active').map(t => `id: "${t.id}"\n  name: ${t.name}\n  keywords: ${t.triggerKeywords.join(', ')}`).join('\n\n');
        const detectRes = await anthropicMessagesPost({ system: fillTemplate(getWorkflowRuntime().matchDetectorPrompt, { workflowList }), messages: [{ role: 'user', content: messageContent }], max_tokens: 50 });
        const detectData = await detectRes.json();
        const detectedId = anthropicAssistantText(detectData)?.trim().toLowerCase();
        if (detectedId && detectedId !== 'none') matchedTopic = topics.find(t => t.id === detectedId);
      } catch (error) { /* fallback to normal chat */ }
    }

    if (matchedTopic && !currentWorkflow) {
      const workflowSummary = matchedTopic.workflow.map((s, i) => `**Step ${i + 1}:** ${s.name}\n   _${s.goal}_`).join('\n\n');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: fillTemplate(getWorkflowRuntime().offerTemplate, {
          description: matchedTopic.description,
          stepCount: matchedTopic.workflow.length,
          workflowSummary,
        }),
      }]);
      setPendingWorkflow(matchedTopic.id);
      setIsLoading(false);
      return;
    }

    if (pendingWorkflow && (msg.includes('yes') || msg.includes('start'))) {
      const topic = topics.find(t => t.id === pendingWorkflow);
      if (topic) {
        setPptxOffers(null);
        setCurrentWorkflow({ topicId: topic.id, currentStep: 0, context: [], waitingForUser: false });
        setPendingWorkflow(null);
        await executeOrchestrator(topic, messageContent, 0);
        return;
      }
    }

    if (pendingWorkflow && (msg.includes('no') || msg.includes('cancel'))) {
      setPendingWorkflow(null);
      setMessages(prev => [...prev, { role: 'assistant', content: 'No problem! How else can I help you?' }]);
      setIsLoading(false);
      return;
    }

    try {
      const fileContext = isFileAnalysis && uploadedFile ? `\n\nCONTEXT: The user has just uploaded a file named "${uploadedFile.name}" for assessment.` : '';
      const kbRaw = knowledgeBase || buildKnowledgeBaseFromDocuments(documents);
      const kb = isAdmin
        ? kbRaw
        : (documents || [])
          .filter((d) => d.status === 'active' && d.content)
          .map((d, i) => `## Best-practice guidance ${i + 1}\n${d.content}`)
          .join('\n\n');
      const systemPrompt = withUserSettings(customSystemPrompt
        .replace(
          'KNOWLEDGE BASE:\nYou have access to comprehensive best practices and the complete Pillar 2: Strategic Alignment & Principles framework.',
          kb
            ? (isAdmin
              ? `KNOWLEDGE BASE (loaded from intelligence files):\n${kb}`
              : `KNOWLEDGE BASE (best-practice guidance — never name source files):\n${kb}`)
            : 'KNOWLEDGE BASE:\nNo knowledge files are loaded yet. Answer from conversation context and user settings only.'
        )
        + fileContext);

      const response = await anthropicMessagesPost({
        system: systemPrompt,
        messages: [
          ...messages.filter(m => m.role !== 'system').map(m => ({ role: toAnthropicRole(m.role), content: m.content })),
          { role: 'user', content: messageContent }
        ],
        max_tokens: scaleUserFacingMaxTokens(4000, userSettings),
      });
      const data = await response.json();
      const assistantMessage = anthropicAssistantText(data);
      const priorAsk = [...messages].reverse().find((m) => m.role === 'assistant' || m.role === 'orchestrator');
      if (!isFileAnalysis) void harvestChatMemory(priorAsk?.content, messageContent);
      setMessages(prev => {
        const updated = [...prev, { role: 'assistant', content: assistantMessage }];
        setTimeout(() => generateSuggestions(updated), 500);
        return updated;
      });
      setUploadedFile(null);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error: Unable to process request. Please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-blue-400/30 bg-slate-900/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={() => setShowLanding(true)} className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-blue-400 to-cyan-400 rounded-lg flex items-center justify-center hover:opacity-80 transition-opacity">
                <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-slate-900" />
              </button>
              <div>
                <button onClick={() => setShowLanding(true)} className="text-left hover:opacity-80 transition-opacity">
                  <h1 className="text-lg sm:text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">Commercial Excellence Hub</h1>
                </button>
                {showLanding && <p className="text-xs text-blue-300/70 hidden sm:block">Field & Commercial Excellence Platform</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {!showLanding && (activeTab === 'chat' || activeTab === 'performance') && (
                <div className="flex gap-1 sm:gap-2 bg-slate-800/50 rounded-lg p-1">
                  {[['chat', MessageSquare, 'Consultation'], ['performance', BarChart3, 'Performance']].map(([tab, Icon, label]) => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-md transition-all text-xs sm:text-sm ${activeTab === tab ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}>
                      <Icon className="w-3 h-3 sm:w-4 sm:h-4" /><span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                title="User settings"
                onClick={() => { setShowLanding(false); setActiveTab('user-settings'); }}
                className={`h-11 sm:h-12 px-3 sm:px-3.5 rounded-lg flex items-center justify-center gap-2 border transition-all ${!showLanding && activeTab === 'user-settings' ? 'bg-blue-500 border-blue-400 text-white' : 'bg-slate-800/60 border-blue-400/20 text-blue-200 hover:bg-slate-700/70 hover:border-blue-400/40'}`}
              >
                <UserCog className="w-5 h-5 sm:w-6 sm:h-6" />
                <span className="hidden sm:inline text-sm font-semibold">Settings</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  title="Admin"
                  onClick={() => { setShowLanding(false); setActiveTab('admin'); }}
                  className={`h-11 sm:h-12 w-11 sm:w-12 rounded-lg flex items-center justify-center border transition-all ${!showLanding && activeTab === 'admin' ? 'bg-blue-500 border-blue-400 text-white' : 'bg-slate-800/60 border-blue-400/20 text-blue-200 hover:bg-slate-700/70 hover:border-blue-400/40'}`}
                >
                  <Settings className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              )}
              <div className="hidden sm:flex flex-col items-end leading-tight ml-3 sm:ml-6 pl-3 sm:pl-6 border-l border-blue-400/25">
                <span className="text-xs font-semibold text-white max-w-[140px] truncate">{currentUser.name}</span>
                <span className="text-[10px] text-blue-300/60">{isAdmin ? 'Admin' : 'User'}</span>
              </div>
              <button
                type="button"
                title="Sign out"
                onClick={handleSignOut}
                className="h-11 sm:h-12 w-11 sm:w-12 rounded-lg flex items-center justify-center border bg-slate-800/60 border-blue-400/20 text-blue-200 hover:bg-slate-700/70 hover:border-blue-400/40 transition-all"
              >
                <LogOut className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Landing Page */}
      {showLanding ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">Commercial Excellence Hub</h2>
            <p className="text-blue-300/70 text-lg max-w-2xl mx-auto">AI-powered tools for field and commercial excellence. Select a topic to get started.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <button onClick={() => { setShowLanding(false); setActiveTab('chat'); }} className="text-left bg-slate-800/60 hover:bg-slate-700/60 border border-blue-400/30 hover:border-blue-400/60 rounded-2xl p-6 transition-all group hover:shadow-xl hover:shadow-blue-500/10 hover:-translate-y-0.5">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><DollarSign className="w-6 h-6 text-white" /></div>
              <h3 className="font-bold text-white text-base mb-1">Incentive Compensation</h3>
              <p className="text-xs text-blue-300/60 leading-relaxed">Design, assess and optimise sales incentive schemes.</p>
              <div className="mt-4 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span className="text-xs text-emerald-400">Active</span></div>
            </button>
            <button onClick={() => { setShowLanding(false); setActiveTab('territory'); }} className="text-left bg-slate-800/60 hover:bg-slate-700/60 border border-emerald-400/30 hover:border-emerald-400/60 rounded-2xl p-6 transition-all group hover:shadow-xl hover:shadow-emerald-500/10 hover:-translate-y-0.5">
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><MapIcon className="w-6 h-6 text-white" /></div>
              <h3 className="font-bold text-white text-base mb-1">Territory Design</h3>
              <p className="text-xs text-blue-300/60 leading-relaxed">Assess and optimise territory structures.</p>
              <div className="mt-4 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span className="text-xs text-emerald-400">Active</span></div>
            </button>
            <button onClick={() => { setShowLanding(false); setActiveTab('stella'); setStellaTab('chat'); }} className="text-left bg-slate-800/60 hover:bg-slate-700/60 border border-cyan-400/30 hover:border-cyan-400/60 rounded-2xl p-6 transition-all group hover:shadow-xl hover:shadow-cyan-500/10 hover:-translate-y-0.5">
              <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><Layers className="w-6 h-6 text-white" /></div>
              <h3 className="font-bold text-white text-base mb-1">Stella Insights</h3>
              <p className="text-xs text-blue-300/60 leading-relaxed">Chat with your data, run analysis and generate charts.</p>
              <div className="mt-4 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span className="text-xs text-emerald-400">Active</span></div>
            </button>
            {[{ icon: BarChart3, label: 'Sales Performance', desc: 'Track and benchmark rep performance.' }, { icon: Target, label: 'Targeting & Segmentation', desc: 'Build and refine HCP target lists.' }, { icon: Users, label: 'Workforce Planning', desc: 'Model headcount and deployment.' }, { icon: Calendar, label: 'Business Planning', desc: 'Align field activity with strategy.' }, { icon: Award, label: 'Customer Engagement', desc: 'Design multi-channel engagement plans.' }, { icon: TrendingUp, label: 'Market Access', desc: 'Formulary positioning and payer strategy.' }].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="text-left bg-slate-800/30 border border-slate-700/40 rounded-2xl p-6 opacity-50 cursor-not-allowed">
                <div className="w-12 h-12 bg-slate-700/50 rounded-xl flex items-center justify-center mb-4"><Icon className="w-6 h-6 text-slate-500" /></div>
                <h3 className="font-bold text-slate-400 text-base mb-1">{label}</h3>
                <p className="text-xs text-slate-500/70 leading-relaxed">{desc}</p>
                <div className="mt-4 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-slate-600" /><span className="text-xs text-slate-500">Coming soon</span></div>
              </div>
            ))}
          </div>

          {recentChats(chatSessions).length > 0 && (
            <div className="mt-10">
              <div className="flex items-center gap-2 mb-1">
                <History className="w-5 h-5 text-cyan-300" />
                <h3 className="text-lg font-semibold text-white">Recent chats</h3>
              </div>
              <p className="text-[11px] text-blue-300/45 mb-4">
                From <code className="text-cyan-300/70">intelligence/{userChatsRemotePath(currentUser)}</code> only.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {recentChats(chatSessions).map((chat) => {
                  const mod = chatModuleMeta(chat);
                  return (
                  <div
                    key={chat.id}
                    className="text-left bg-slate-800/50 hover:bg-slate-700/55 border border-blue-400/20 hover:border-blue-400/45 rounded-xl p-4 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" onClick={() => continueChat(chat.id)} className="min-w-0 text-left flex-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300/90 mb-1">{mod.label}</div>
                        <div className="text-sm font-semibold text-white truncate">{chat.title || 'Chat'}</div>
                        <div className="text-[11px] text-blue-300/60 mt-1">
                          {formatChatTime(chat.updatedAt)}
                          {chat.currentWorkflow ? ' · Workflow in progress' : ''}
                          {chat.id === activeChatId ? ' · Current' : ''}
                        </div>
                        <div className="mt-3 text-xs text-cyan-300/80 font-semibold">Continue →</div>
                      </button>
                      <button
                        type="button"
                        title="Delete chat"
                        onClick={(e) => deleteChat(chat.id, e)}
                        className="p-1 rounded text-slate-500 hover:text-red-300 hover:bg-red-500/15 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 h-[calc(100vh-80px)] sm:h-[calc(100vh-100px)] overflow-hidden">
          <MessageErrorBoundary fallback={
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md text-center bg-red-500/10 border border-red-400/25 rounded-xl p-6">
                <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
                <div className="text-sm font-semibold text-red-200 mb-1">Something went wrong rendering this view</div>
                <div className="text-xs text-red-300/70">Try switching tabs or reloading the page. Other areas of the app still work.</div>
              </div>
            </div>
          }>
          {activeTab === 'chat' ? (
            <div className="flex gap-3 h-full min-h-0">
              {mobileChatHistoryOpen && (
                <div className="md:hidden fixed inset-0 z-50">
                  <button
                    type="button"
                    className="absolute inset-0 bg-slate-950/70"
                    aria-label="Close chat history"
                    onClick={() => setMobileChatHistoryOpen(false)}
                  />
                  <aside className="absolute inset-y-0 left-0 w-[min(20rem,88vw)] bg-slate-900 border-r border-blue-400/25 flex flex-col shadow-2xl">
                    <div className="p-3 border-b border-blue-400/15 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-200">
                        <History className="w-3.5 h-3.5" /> Chats
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={startNewChat}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-[11px] text-blue-100 font-semibold"
                        >
                          <Plus className="w-3 h-3" /> New
                        </button>
                        <button
                          type="button"
                          title="Close"
                          onClick={() => setMobileChatHistoryOpen(false)}
                          className="p-1 rounded-md text-blue-300/70 hover:text-blue-100 hover:bg-slate-700/50"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                      {recentChats(chatSessions).length === 0 && (
                        <div className="text-[11px] text-blue-300/50 px-2 py-3">No saved chats yet. Start a conversation and it will appear here.</div>
                      )}
                      {recentChats(chatSessions).map((chat) => {
                        const mod = chatModuleMeta(chat);
                        return (
                          <div
                            key={chat.id}
                            className={`flex items-start gap-1 rounded-lg border ${chat.id === activeChatId ? 'bg-blue-500/20 border-blue-400/40' : 'border-transparent hover:bg-slate-700/40 hover:border-blue-400/20'}`}
                          >
                            <button
                              type="button"
                              onClick={() => continueChat(chat.id)}
                              className="flex-1 min-w-0 text-left px-2.5 py-2"
                            >
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300/80">{mod.label}</div>
                              <div className="text-xs font-semibold text-white truncate">{chat.title || 'Chat'}</div>
                              <div className="text-[10px] text-blue-300/55 mt-0.5">
                                {formatChatTime(chat.updatedAt)}
                                {chat.currentWorkflow ? ' · in progress' : ''}
                              </div>
                            </button>
                            <button
                              type="button"
                              title="Delete"
                              onClick={(e) => deleteChat(chat.id, e)}
                              className="mt-1.5 mr-1 p-1 rounded text-slate-400 hover:text-red-300"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </aside>
                </div>
              )}
              {chatHistoryCollapsed ? (
                <aside className="hidden md:flex w-10 flex-col flex-shrink-0 bg-slate-800/40 border border-blue-400/20 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    title="Show chat history"
                    onClick={toggleChatHistoryCollapsed}
                    className="flex-1 flex flex-col items-center gap-2 py-3 text-blue-200 hover:bg-slate-700/40"
                  >
                    <History className="w-4 h-4" />
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </aside>
              ) : (
              <aside className="hidden md:flex w-56 lg:w-64 flex-col flex-shrink-0 bg-slate-800/40 border border-blue-400/20 rounded-xl overflow-hidden">
                <div className="p-3 border-b border-blue-400/15 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-200">
                    <History className="w-3.5 h-3.5" /> Chats
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={startNewChat}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-[11px] text-blue-100 font-semibold"
                    >
                      <Plus className="w-3 h-3" /> New
                    </button>
                    <button
                      type="button"
                      title="Collapse chat history"
                      onClick={toggleChatHistoryCollapsed}
                      className="p-1 rounded-md text-blue-300/70 hover:text-blue-100 hover:bg-slate-700/50"
                    >
                      <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                  {recentChats(chatSessions).length === 0 && (
                    <div className="text-[11px] text-blue-300/50 px-2 py-3">No saved chats yet. Start a conversation and it will appear here.</div>
                  )}
                  {recentChats(chatSessions).map((chat) => {
                    const mod = chatModuleMeta(chat);
                    return (
                    <div
                      key={chat.id}
                      className={`group flex items-start gap-1 rounded-lg border ${chat.id === activeChatId ? 'bg-blue-500/20 border-blue-400/40' : 'border-transparent hover:bg-slate-700/40 hover:border-blue-400/20'}`}
                    >
                      <button
                        type="button"
                        onClick={() => continueChat(chat.id)}
                        className="flex-1 min-w-0 text-left px-2.5 py-2"
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300/80">{mod.label}</div>
                        <div className="text-xs font-semibold text-white truncate">{chat.title || 'Chat'}</div>
                        <div className="text-[10px] text-blue-300/55 mt-0.5">
                          {formatChatTime(chat.updatedAt)}
                          {chat.currentWorkflow ? ' · in progress' : ''}
                        </div>
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={(e) => deleteChat(chat.id, e)}
                        className="mt-1.5 mr-1 p-1 rounded text-slate-500 hover:text-red-300 opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    );
                  })}
                </div>
              </aside>
              )}
              <div className="flex flex-col h-full min-w-0 flex-1">
              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2 mb-3 flex-shrink-0">
                <button type="button" onClick={() => setMobileChatHistoryOpen(true)} className="md:hidden flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/60 hover:bg-blue-500/20 border border-blue-400/40 rounded-lg text-xs text-blue-100 font-semibold">
                  <History className="w-3.5 h-3.5" /> Chats{recentChats(chatSessions).length ? ` (${recentChats(chatSessions).length})` : ''}
                </button>
                <button type="button" onClick={startNewChat} className="md:hidden flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/40 rounded-lg text-xs text-blue-100 font-semibold"><Plus className="w-3.5 h-3.5" /> New chat</button>
                <button onClick={() => setInput('I need to design an incentive scheme for a team of 10 AEs.')} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/60 hover:bg-blue-500/20 border border-blue-400/25 hover:border-blue-400/50 rounded-lg text-xs text-blue-300 hover:text-blue-200 transition-all"><Target className="w-3.5 h-3.5" /> Design New Scheme</button>
                <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/60 hover:bg-cyan-500/20 border border-cyan-400/25 hover:border-cyan-400/50 rounded-lg text-xs text-cyan-300 hover:text-cyan-200 transition-all"><Upload className="w-3.5 h-3.5" /> Assess Proposal</button>
                <button onClick={() => setInput('What are the key principles for designing effective sales incentive schemes?')} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/60 hover:bg-purple-500/20 border border-purple-400/25 hover:border-purple-400/50 rounded-lg text-xs text-purple-300 hover:text-purple-200 transition-all"><Award className="w-3.5 h-3.5" /> Best Practices</button>
              </div>

              {/* Activity Log */}
              {activityLog.length > 0 && (
                <div className="bg-slate-800/50 border border-purple-400/30 rounded-xl mb-3 overflow-hidden flex-shrink-0">
                  <button type="button" onClick={() => setShowActivityLog(!showActivityLog)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/50 transition-colors">
                    <div className="flex items-center gap-2"><div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div><span className="font-semibold text-purple-400">System Activity</span></div>
                  </button>
                  {showActivityLog && (
                    <div className="px-4 pb-3 space-y-2">
                      {activityLog.slice(-5).reverse().map((log, i) => (
                        <div key={i} className="text-xs bg-slate-900/50 rounded p-2"><div className="text-purple-300">{log.timestamp} - {log.action}</div></div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Workflow Status Banner */}
              {currentWorkflow && (
                <div className="bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border border-blue-400/40 rounded-xl p-3 sm:p-4 mb-3 sm:mb-4 flex-shrink-0">
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-500 rounded-full flex items-center justify-center animate-pulse"><Target className="w-4 h-4 sm:w-6 sm:h-6 text-white" /></div>
                      <div>
                        <div className="text-xs sm:text-sm font-semibold text-blue-300">🔵 Workflow Active</div>
                        <div className="text-sm sm:text-lg font-bold text-white">{topics.find(t => t.id === currentWorkflow.topicId)?.name || 'Unknown'}</div>
                      </div>
                    </div>
                    <button type="button" onClick={handleCancelWorkflow} className="px-2 sm:px-4 py-1.5 sm:py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-400/50 text-red-300 rounded-lg transition-all text-xs sm:text-sm font-semibold cursor-pointer hover:scale-105">
                      <span className="hidden sm:inline">✕ Cancel Workflow</span><span className="sm:hidden">✕</span>
                    </button>
                  </div>
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-blue-300 font-medium">Step {currentWorkflow.currentStep + 1} of {topics.find(t => t.id === currentWorkflow.topicId)?.workflow.length || 0}</span>
                      <span className="text-cyan-300 font-bold">{Math.round(((currentWorkflow.currentStep + 1) / (topics.find(t => t.id === currentWorkflow.topicId)?.workflow.length || 1)) * 100)}% Complete</span>
                    </div>
                    <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                      <div className="bg-gradient-to-r from-blue-500 to-cyan-500 h-full transition-all duration-500" style={{ width: `${((currentWorkflow.currentStep + 1) / (topics.find(t => t.id === currentWorkflow.topicId)?.workflow.length || 1)) * 100}%` }}></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 overflow-x-auto pb-2">
                    {topics.find(t => t.id === currentWorkflow.topicId)?.workflow.map((step, idx) => (
                      <div key={idx} className={`flex items-center gap-2 px-3 py-2 rounded-lg flex-shrink-0 transition-all ${idx < currentWorkflow.currentStep ? 'bg-green-500/20 border border-green-400/40' : idx === currentWorkflow.currentStep ? 'bg-cyan-500/30 border border-cyan-400/60 ring-2 ring-cyan-400/30' : 'bg-slate-700/30 border border-slate-600/40'}`}>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${idx < currentWorkflow.currentStep ? 'bg-green-500 text-white' : idx === currentWorkflow.currentStep ? 'bg-cyan-500 text-white' : 'bg-slate-600 text-slate-400'}`}>{idx < currentWorkflow.currentStep ? '✓' : step.step}</div>
                        <div className="text-xs">
                          <div className={`font-semibold ${idx < currentWorkflow.currentStep ? 'text-green-300' : idx === currentWorkflow.currentStep ? 'text-cyan-300' : 'text-slate-400'}`}>{step.name}</div>
                          {idx === currentWorkflow.currentStep && <div className="text-cyan-400/70 text-xs">← Active</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages Area */}
              <div className="flex-1 bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6 overflow-y-auto space-y-4 custom-scrollbar mb-4 min-h-0">
                {messages.map((message, index) => (
                  <div key={index} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${message.role === 'user' ? 'bg-gradient-to-br from-cyan-400 to-blue-400' : message.role === 'system' ? 'bg-gradient-to-br from-yellow-400 to-orange-400' : message.role === 'orchestrator' ? 'bg-gradient-to-br from-purple-500 to-pink-500' : 'bg-gradient-to-br from-blue-400 to-purple-400'}`}>
                      {message.role === 'user' ? <Users className="w-5 h-5 text-slate-900" /> : message.role === 'system' ? <FileText className="w-5 h-5 text-slate-900" /> : message.role === 'orchestrator' ? <Target className="w-5 h-5 text-slate-900" /> : <TrendingUp className="w-5 h-5 text-slate-900" />}
                    </div>
                    <div className={`flex-1 ${message.role === 'user' ? 'text-right' : ''}`}>
                      <div className={`inline-block max-w-[85%] px-4 py-3 rounded-2xl ${message.role === 'user' ? 'bg-gradient-to-br from-cyan-500 to-blue-500 text-white' : message.role === 'system' ? 'bg-yellow-500/20 border border-yellow-400/30 text-yellow-200' : message.role === 'orchestrator' ? 'bg-purple-500/20 border border-purple-400/40 text-purple-200' : 'bg-slate-700/50 border border-blue-400/20 text-blue-100'}`}>
                        <div className="text-sm leading-relaxed">
                          {message.role === 'user' ? <span className="whitespace-pre-wrap">{message.content}</span> : formatMarkdown(message.content)}
                        </div>
                        {Array.isArray(message.imagePreviews) && message.imagePreviews.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {message.imagePreviews.map((img, i) => (
                              <figure
                                key={`${img.name}-${i}`}
                                role={img.src ? 'button' : undefined}
                                tabIndex={img.src ? 0 : undefined}
                                onClick={() => {
                                  if (!img.src) return;
                                  setImageLightbox({
                                    src: img.src,
                                    name: img.name,
                                    purpose: img.purpose || img.kind,
                                    reason: img.reason,
                                    included: img.included,
                                    sourceFormat: img.sourceFormat,
                                  });
                                }}
                                onKeyDown={(e) => {
                                  if (!img.src) return;
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setImageLightbox({
                                      src: img.src,
                                      name: img.name,
                                      purpose: img.purpose || img.kind,
                                      reason: img.reason,
                                      included: img.included,
                                      sourceFormat: img.sourceFormat,
                                    });
                                  }
                                }}
                                className={`rounded-lg overflow-hidden border text-left ${img.src ? 'cursor-zoom-in hover:ring-2 hover:ring-cyan-400/50' : ''} ${
                                  img.pending
                                    ? 'border-amber-400/70 bg-amber-950/40'
                                    : img.included
                                    ? 'border-emerald-400/40 bg-slate-900/40'
                                    : ['logo', 'decorative', 'icon', 'stock_photo'].includes(img.kind || img.purpose)
                                      ? 'border-slate-500/50 bg-slate-900/30'
                                      : 'border-amber-400/40 bg-amber-950/30'
                                }`}
                                title={img.src ? `Click to enlarge — ${img.pending ? (img.reason || 'Confirm') : img.included ? (img.reason || 'Included') : (img.reason || 'Skipped')}` : (img.reason || 'Skipped')}
                              >
                                {img.src ? (
                                  <img
                                    src={img.src}
                                    alt={img.name}
                                    className={`block h-20 w-auto max-w-[140px] object-contain bg-slate-950/50 ${img.included || img.pending ? '' : 'opacity-60 grayscale-[35%]'}`}
                                  />
                                ) : (
                                  <div className="h-20 w-[120px] flex items-center justify-center px-2 text-[10px] text-amber-200/90 text-center leading-snug">
                                    {img.kind === 'vector' ? 'Convert failed' : (img.reason || 'Skipped')}
                                  </div>
                                )}
                                <figcaption className="px-1.5 py-1 text-[10px] leading-tight text-slate-300 max-w-[140px]">
                                  <div className="truncate">{img.pending ? '? ' : img.included ? '✓ ' : '✗ '}{img.name}</div>
                                  <div className={`truncate ${img.pending ? 'text-amber-300' : img.included ? 'text-emerald-300/90' : 'text-slate-400'}`}>
                                    {purposeLabel(img.purpose || img.kind)}
                                    {img.sourceFormat ? ` · from ${String(img.sourceFormat).toUpperCase()}` : ''}
                                    {img.bytes ? ` · ${(img.bytes / 1024).toFixed(0)}KB` : ''}
                                  </div>
                                  {img.pending && (
                                    <div className="flex gap-1 mt-1">
                                      <button
                                        type="button"
                                        className="flex-1 px-1 py-0.5 rounded bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100 text-[10px] font-semibold"
                                        onClick={(e) => { e.stopPropagation(); applyUnsureImageDecision(img.name, true); }}
                                      >
                                        Include
                                      </button>
                                      <button
                                        type="button"
                                        className="flex-1 px-1 py-0.5 rounded bg-slate-600/60 hover:bg-slate-500/70 text-slate-100 text-[10px] font-semibold"
                                        onClick={(e) => { e.stopPropagation(); applyUnsureImageDecision(img.name, false); }}
                                      >
                                        Skip
                                      </button>
                                    </div>
                                  )}
                                </figcaption>
                              </figure>
                            ))}
                          </div>
                        )}
                        {message.imageReviewPending && pendingImageReview?.unsure?.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => applyUnsureImageDecision('*', true)}
                              className="px-3 py-1.5 bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400/40 rounded-lg text-xs text-emerald-100 font-semibold"
                            >
                              Include all unsure
                            </button>
                            <button
                              type="button"
                              onClick={() => applyUnsureImageDecision('*', false)}
                              className="px-3 py-1.5 bg-slate-600/50 hover:bg-slate-500/60 border border-slate-400/30 rounded-lg text-xs text-slate-100 font-semibold"
                            >
                              Skip all unsure
                            </button>
                          </div>
                        )}
                        {index === messages.length - 1 && pendingWorkflow && message.content.includes('Would you like me to start this workflow') && (
                          <div className="flex gap-2 mt-4">
                            <button onClick={(e) => { e.preventDefault(); setInput(''); handleSubmit(e, 'Yes'); }} className="flex-1 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-semibold rounded-lg transition-all">✅ Yes, Start Workflow</button>
                            <button onClick={(e) => { e.preventDefault(); setInput(''); handleSubmit(e, 'No'); }} className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-all">💬 No, Just Chat</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-slate-900" /></div>
                    <div className="flex-1">
                      <div className="inline-block px-4 py-3 rounded-2xl bg-slate-700/50 border border-blue-400/20">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0s'}}></span>
                          <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></span>
                          <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="flex-shrink-0">
                {orchestratorDecision && !isLoading && (
                  <div className="mb-3 p-3 bg-slate-800/60 border border-blue-400/30 rounded-xl">
                    {pendingButtonAction ? (
                      <div>
                        <div className="text-xs text-blue-300/70 mb-2">{pendingButtonAction.btn.inputPrompt}</div>
                        <div className="flex gap-2">
                          <input autoFocus type="text" placeholder="Type your response..." className="flex-1 bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && e.target.value.trim()) { const val = e.target.value.trim(); setPendingButtonAction(null); setOrchestratorDecision(null); handleOrchestratorAction(pendingButtonAction.btn.action, pendingButtonAction.decision, val); }
                              if (e.key === 'Escape') setPendingButtonAction(null);
                            }} />
                          <button onClick={() => setPendingButtonAction(null)} className="px-3 py-2 bg-slate-700/50 hover:bg-slate-600/50 border border-slate-500/30 rounded-lg text-xs text-slate-400 hover:text-slate-300 transition-all">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-xs text-blue-300/70 mb-2">Choose how to proceed:</div>
                        <div className="flex flex-wrap gap-2">
                          {(orchestratorDecision.buttons || []).map((btn, idx) => {
                            const isPrimary = btn.action === 'proceed';
                            const isDanger = btn.action === 'override' || btn.action === 'redesign';
                            const cls = isPrimary ? "px-4 py-2 bg-green-500/20 hover:bg-green-500/30 border border-green-400/40 rounded-lg text-sm text-green-300 hover:text-green-200 transition-all" : isDanger ? "px-4 py-2 bg-red-500/15 hover:bg-red-500/25 border border-red-400/30 rounded-lg text-sm text-red-300 hover:text-red-200 transition-all" : "px-4 py-2 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded-lg text-sm text-blue-200 hover:text-blue-100 transition-all";
                            return (
                              <button key={idx} className={cls} onClick={() => {
                                if (btn.requiresInput) { setPendingButtonAction({ btn, decision: orchestratorDecision }); }
                                else { setOrchestratorDecision(null); handleOrchestratorAction(btn.action, orchestratorDecision); }
                              }}>{btn.label}</button>
                            );
                          })}
                          <div className="w-full text-xs text-blue-300/40 mt-1">or type your own response below</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {pptxGenerating && (
                  <div className="mb-3 px-3 py-2 bg-violet-900/30 border border-violet-400/30 rounded-xl flex items-center gap-3 text-sm text-violet-300">
                    <div className="w-4 h-4 border-2 border-violet-400/40 border-t-violet-400 rounded-full animate-spin flex-shrink-0" />
                    Generating PowerPoint…
                  </div>
                )}

                {pptxOffers && !currentWorkflow && !pptxGenerating && (
                  <div className="mb-3 bg-slate-800/60 border border-violet-400/25 rounded-xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-violet-400/15 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-violet-300/70 font-semibold"><span>📊</span> Export as PowerPoint</div>
                      <button onClick={() => setPptxOffers(null)} className="text-slate-500 hover:text-slate-300 transition-all"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-violet-400/15">
                      {pptxOffers.summary && (
                        <div className="p-3 flex flex-col gap-2">
                          <div className="text-xs font-semibold text-violet-200">📋 Session Summary</div>
                          <div className="text-xs text-slate-400 flex-1">{pptxOffers.summary.title}</div>
                          <div className="text-[10px] text-slate-500">Facts from this chat only</div>
                          <button onClick={() => handleGeneratePptx(pptxOffers.summary, 'summary')} className="mt-1 px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/35 border border-violet-400/30 rounded-lg text-xs text-violet-200 font-semibold transition-all">✨ Generate</button>
                        </div>
                      )}
                      {pptxOffers.produced && (
                        <div className="p-3 flex flex-col gap-2">
                          <div className="text-xs font-semibold text-emerald-300">📄 Working Document</div>
                          <div className="text-xs text-slate-400 flex-1">{pptxOffers.produced.title}</div>
                          <div className="text-[10px] text-slate-500">{pptxOffers.produced.deckType === 'ic_one_pager' ? 'One-pager' : pptxOffers.produced.deckType === 'ic_doc_pack' ? 'Full IC pack' : 'Based on this conversation'}</div>
                          <button
                            onClick={() => {
                              const dt = pptxOffers.produced.deckType;
                              if (!dt || dt === 'general') {
                                askPptxClarification();
                              } else {
                                handleGeneratePptx(pptxOffers.produced, 'produced');
                              }
                            }}
                            className="mt-1 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/30 rounded-lg text-xs text-emerald-200 font-semibold transition-all"
                          >
                            ✨ Generate
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {!currentWorkflow && !pptxOffers && !pptxGenerating && !pptxClarifyPending && messages.filter(m => m.role === 'assistant' || m.role === 'orchestrator').length > 0 && (
                  <div className="mb-3 flex justify-end">
                    <button onClick={startPptxExportFromUi} className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-400/20 hover:border-violet-400/40 rounded-lg text-xs text-violet-300/60 hover:text-violet-300 transition-all">
                      📊 Export as PowerPoint
                    </button>
                  </div>
                )}

                {clarifyingReplyHint && !isLoading && !pptxGenerating && (
                  <div className="mb-3 text-xs text-blue-300/70 bg-slate-800/40 border border-blue-400/20 rounded-lg px-3 py-2">
                    Reply with your answers by number, e.g. <span className="text-cyan-300 font-mono">1 = …</span>  <span className="text-cyan-300 font-mono">2 = …</span>
                  </div>
                )}

                {choiceButtons && choiceButtons.length > 0 && !isLoading && !pptxGenerating && (
                  <div className="mb-3">
                    <div className="text-xs text-blue-300/70 mb-2">Choose an option (or type your own):</div>
                    <div className="flex flex-wrap gap-2">
                      {choiceButtons.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={(e) => { e.preventDefault(); setSuggestedPrompts([]); handleSubmit(e, opt.value); }}
                          className="px-3 py-2 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 hover:border-cyan-400/55 rounded-lg text-xs text-cyan-100 font-semibold transition-all hover:scale-105 active:scale-95 text-left max-w-full"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {suggestionsEnabled && suggestedPrompts.length > 0 && !pendingWorkflow && !currentWorkflow && !pendingImageReview && !pendingProposalIntake && !isLoading && !choiceButtons?.length && !clarifyingReplyHint && (
                  <div className="mb-3">
                    <div className="text-xs text-blue-300/70 mb-2 flex items-center gap-2"><span>💡 Suggested next steps:</span></div>
                    <div className="flex flex-wrap gap-2">
                      {suggestedPrompts.map((prompt, idx) => (
                        <button key={idx} onClick={(e) => { e.preventDefault(); setSuggestedPrompts([]); handleSubmit(e, prompt); }} className="px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 hover:border-blue-400/50 rounded-lg text-xs text-blue-200 hover:text-blue-100 transition-all hover:scale-105 active:scale-95">{prompt}</button>
                      ))}
                    </div>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="bg-slate-800/50 backdrop-blur-sm border border-blue-400/20 rounded-xl p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <div className="flex-1">
                      <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }} placeholder="Describe your incentive scenario or ask a question..." className="w-full bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 sm:px-4 py-2 sm:py-3 text-sm outline-none focus:border-blue-400 transition-colors resize-none" rows={2} disabled={isLoading} />
                    </div>
                    <div className="flex gap-2 sm:gap-3 sm:items-end">
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="flex-1 sm:flex-none px-4 py-3 bg-slate-700 hover:bg-slate-600 text-cyan-400 rounded-lg transition-all border border-cyan-400/30 hover:border-cyan-400/50" disabled={isLoading}><Upload className="w-5 h-5 mx-auto" /></button>
                      <button type="submit" onClick={(e) => { if (input.trim()) handleSubmit(e); }} disabled={isLoading || !input.trim()} className="flex-1 sm:flex-none px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"><Send className="w-5 h-5" /><span className="hidden sm:inline">Send</span></button>
                    </div>
                  </div>
                </form>
              </div>
              <input ref={fileInputRef} type="file" accept=".pdf,.ppt,.pptx,.xlsx,.xls,.csv,.txt,.md" onChange={handleFileUpload} className="hidden" />
            </div>
            </div>

          ) : activeTab === 'performance' ? (
            <div className="space-y-6 overflow-y-auto h-full custom-scrollbar pr-2">
              <div className="bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl p-6 text-white shadow-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">{MOCK_PERFORMANCE.rep.name}</h2>
                    <p className="text-blue-100 text-sm">{MOCK_PERFORMANCE.rep.role}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold">{MOCK_PERFORMANCE.q1Performance.attainmentPercent}%</div>
                    <div className="text-sm text-blue-100">Quota Attainment</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { icon: DollarSign, color: 'green', label: 'Revenue YTD', value: `£${(MOCK_PERFORMANCE.q1Performance.actualRevenue/1000).toFixed(0)}K`, sub: `of £${(MOCK_PERFORMANCE.rep.individualQuota/1000).toFixed(0)}K target` },
                  { icon: Target, color: 'cyan', label: 'Deals Closed', value: MOCK_PERFORMANCE.q1Performance.deals.closed, sub: `of ${MOCK_PERFORMANCE.q1Performance.deals.target} target` },
                  { icon: TrendingUp, color: 'purple', label: 'Pipeline', value: `£${(MOCK_PERFORMANCE.q1Performance.pipeline/1000).toFixed(0)}K`, sub: '1.5x coverage' },
                  { icon: Award, color: 'green', label: 'Est. Earnings', value: `£${(MOCK_PERFORMANCE.earnings.totalEarnings/1000).toFixed(1)}K`, sub: 'Q1 Total' }
                ].map(({ icon: Icon, color, label, value, sub }) => (
                  <div key={label} className={`bg-slate-800/50 backdrop-blur-sm border border-${color}-400/20 rounded-xl p-4`}>
                    <div className="flex items-center gap-2 mb-2"><Icon className={`w-5 h-5 text-${color}-400`} /><span className="text-xs text-blue-300/70">{label}</span></div>
                    <div className="text-2xl font-bold text-white">{value}</div>
                    <div className="text-xs text-blue-300/60 mt-1">{sub}</div>
                  </div>
                ))}
              </div>
              <div className="bg-slate-800/50 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                <h3 className="text-lg font-bold mb-4">Your Incentive Scheme</h3>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(MOCK_PERFORMANCE.incentiveScheme).map(([key, value]) => (
                    <div key={key} className="bg-slate-700/30 rounded-lg p-4">
                      <div className="text-xs text-blue-300/70 mb-1 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                      <div className="text-sm font-semibold text-white">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          ) : activeTab === 'territory' ? (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl p-4 text-white shadow-xl flex-shrink-0 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3"><MapIcon className="w-6 h-6" /><div><h2 className="text-xl font-bold">Territory Design</h2><p className="text-emerald-100 text-xs">Assess, design and optimise your sales territory structure</p></div></div>
                  <button onClick={() => territoryFileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold transition-all"><Upload className="w-4 h-4" /> Upload Structure</button>
                  <input ref={territoryFileInputRef} type="file" accept=".json" onChange={handleTerritoryStructureUpload} className="hidden" />
                </div>
              </div>

              {territoryStructures.length > 0 && (
                <div className="flex-shrink-0 mb-3 flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-blue-300/70 whitespace-nowrap">Loaded:</span>
                  <div className="flex gap-2 flex-wrap flex-1">
                    {territoryStructures.map(s => (
                      <button key={s.id} onClick={() => { setSelectedTerritoryStructure(s.id); setSelectedTerritory(null); }} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${selectedTerritoryStructure === s.id ? 'bg-emerald-500/30 border-emerald-400/60 text-emerald-300' : 'bg-slate-800/50 border-blue-400/20 text-blue-300 hover:border-blue-400/40'}`}>{s.name}</button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setTerritoryView('map')} className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${territoryView === 'map' ? 'bg-blue-500/30 border-blue-400/60 text-blue-200' : 'bg-slate-800/50 border-slate-600 text-slate-400 hover:text-slate-300'}`}>🗺 Map</button>
                    <button onClick={() => setTerritoryView('list')} className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${territoryView === 'list' ? 'bg-blue-500/30 border-blue-400/60 text-blue-200' : 'bg-slate-800/50 border-slate-600 text-slate-400 hover:text-slate-300'}`}>☰ List</button>
                  </div>
                </div>
              )}

              {(() => {
                const activeStructure = territoryStructures.find(s => s.id === selectedTerritoryStructure) || territoryStructures[0];
                if (!activeStructure) return <div className="flex-1 flex items-center justify-center text-blue-300/50 text-sm">No territory structure loaded.</div>;
                return (
                  <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
                    <div className={`overflow-y-auto custom-scrollbar ${selectedTerritory ? 'w-1/2' : 'w-full'} transition-all`}>
                      {territoryView === 'map' ? (
                        <div className="bg-slate-800/40 border border-blue-400/20 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-blue-300/70 font-semibold">{activeStructure.name} — {activeStructure.territories.length} territories</span>
                            <span className="text-xs text-blue-300/40">{activeStructure.managers.length} managers · Click a territory to inspect</span>
                          </div>
                          <TerritoryMap structure={activeStructure} selectedTerritory={selectedTerritory} onSelectTerritory={setSelectedTerritory} />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {activeStructure.managers.map((mgr, mgrIdx) => (
                            <div key={mgr.id} className="bg-slate-800/40 border border-blue-400/20 rounded-xl overflow-hidden">
                              <div className="px-4 py-2 flex items-center gap-2" style={{ background: `${MANAGER_COLOURS[mgrIdx]}18` }}>
                                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: MANAGER_COLOURS[mgrIdx] }} />
                                <span className="text-sm font-semibold text-white">{mgr.name}</span>
                                <span className="text-xs text-blue-300/60">— {mgr.region}</span>
                                <span className="ml-auto text-xs text-blue-300/40">{activeStructure.territories.filter(t => t.managerId === mgr.id).length} territories</span>
                              </div>
                              <div className="divide-y divide-slate-700/40">
                                {activeStructure.territories.filter(t => t.managerId === mgr.id).map(t => (
                                  <div key={t.id} onClick={() => setSelectedTerritory(selectedTerritory?.id === t.id ? null : t)} className={`px-4 py-2.5 cursor-pointer transition-all flex items-center gap-3 ${selectedTerritory?.id === t.id ? 'bg-blue-500/10' : 'hover:bg-slate-700/30'}`}>
                                    <span className="text-xs font-bold text-blue-400 w-8 flex-shrink-0">{t.id}</span>
                                    <div className="flex-1 min-w-0"><div className="text-sm text-white truncate">{t.name}</div><div className="text-xs text-blue-300/50 truncate">{t.rep}</div></div>
                                    <div className="flex gap-2 text-xs flex-shrink-0">
                                      <span className="text-emerald-400 font-semibold">A:{t.hcps.A}</span>
                                      <span className="text-blue-400">B:{t.hcps.B}</span>
                                      <span className="text-slate-400">C:{t.hcps.C}</span>
                                      <span className="text-white font-bold ml-1">{t.hcps.A+t.hcps.B+t.hcps.C}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {selectedTerritory && (() => {
                      const mgr = activeStructure.managers.find(m => m.id === selectedTerritory.managerId);
                      const mgrIdx = activeStructure.managers.indexOf(mgr);
                      const total = selectedTerritory.hcps.A + selectedTerritory.hcps.B + selectedTerritory.hcps.C;
                      return (
                        <div className="w-1/2 overflow-y-auto custom-scrollbar">
                          <div className="bg-slate-800/60 border border-blue-400/30 rounded-xl p-4 space-y-4">
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">{selectedTerritory.id}</span>
                                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: `${MANAGER_COLOURS[mgrIdx]}22`, color: MANAGER_COLOURS[mgrIdx] }}>{mgr?.name}</span>
                                </div>
                                <h3 className="text-lg font-bold text-white">{selectedTerritory.name}</h3>
                                <p className="text-sm text-blue-300/70">Rep: {selectedTerritory.rep}</p>
                              </div>
                              <button onClick={() => setSelectedTerritory(null)} className="text-slate-500 hover:text-slate-300 transition-all flex-shrink-0"><X className="w-4 h-4" /></button>
                            </div>
                            <div>
                              <div className="text-xs text-blue-300/60 mb-2 font-semibold uppercase tracking-wide">HCP Universe</div>
                              {[['A — High value prescribers', selectedTerritory.hcps.A, '#34d399'], ['B — Medium value', selectedTerritory.hcps.B, '#60a5fa'], ['C — Low / awareness', selectedTerritory.hcps.C, '#64748b']].map(([label, count, colour]) => {
                                const pct = Math.round(count / total * 100);
                                return (
                                  <div key={label} className="mb-2">
                                    <div className="flex justify-between text-xs mb-1"><span className="text-blue-200/80">{label}</span><span className="font-bold" style={{ color: colour }}>{count} ({pct}%)</span></div>
                                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: colour }} /></div>
                                  </div>
                                );
                              })}
                              <div className="mt-2 pt-2 border-t border-slate-700/50 flex justify-between text-xs"><span className="text-blue-300/60">Total HCPs</span><span className="text-white font-bold">{total}</span></div>
                            </div>
                            <div>
                              <div className="text-xs text-blue-300/60 mb-2 font-semibold uppercase tracking-wide">Counties / Areas</div>
                              <div className="flex flex-wrap gap-1">{selectedTerritory.counties.map(c => (<span key={c} className="text-xs bg-slate-700/60 text-blue-200/70 px-2 py-0.5 rounded-full">{c}</span>))}</div>
                            </div>
                            {selectedTerritory.notes && (<div className="bg-amber-500/10 border border-amber-400/20 rounded-lg p-3"><div className="text-xs text-amber-400 font-semibold mb-1">Notes</div><p className="text-xs text-amber-200/80">{selectedTerritory.notes}</p></div>)}
                            <button onClick={() => {
                              const t = selectedTerritory;
                              const mgr = activeStructure.managers.find(m => m.id === t.managerId);
                              const allTerritories = activeStructure.territories;
                              const totalHCPs = allTerritories.map(x => x.hcps.A + x.hcps.B + x.hcps.C);
                              const avgTotal = Math.round(totalHCPs.reduce((a,b) => a+b,0) / allTerritories.length);
                              const mgrTerritories = allTerritories.filter(x => x.managerId === t.managerId);
                              const avgMgrTotal = Math.round(mgrTerritories.map(x => x.hcps.A+x.hcps.B+x.hcps.C).reduce((a,b)=>a+b,0) / mgrTerritories.length);
                              const focusTotal = t.hcps.A + t.hcps.B + t.hcps.C;
                              const allTerritoriesStr = allTerritories.map(x => { const xTotal = x.hcps.A+x.hcps.B+x.hcps.C; const xMgr = activeStructure.managers.find(m=>m.id===x.managerId); return `  ${x.id === t.id ? '>>> FOCUS: ' : ''}${x.id} ${x.name} | Rep: ${x.rep} | Manager: ${xMgr?.name} | HCPs: A=${x.hcps.A} B=${x.hcps.B} C=${x.hcps.C} Total=${xTotal}${x.id === t.id ? ' <<<' : ''}`; }).join('\n');
                              const focusedContext = `TERRITORY ASSESSMENT — FOCUS TERRITORY: ${t.id} ${t.name}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nFOCUS TERRITORY DETAIL:\n  ID: ${t.id} | Name: ${t.name}\n  Rep: ${t.rep} | Manager: ${mgr?.name} (${mgr?.region})\n  Counties: ${t.counties.join(', ')}\n  HCPs: Segment A=${t.hcps.A}, B=${t.hcps.B}, C=${t.hcps.C}, Total=${focusTotal}\n  ${t.notes ? `Notes: ${t.notes}` : ''}\n\nBENCHMARKS:\n  National avg total HCPs: ${avgTotal}\n  Manager region avg (${mgr?.region}): ${avgMgrTotal}\n  Focus vs national: ${focusTotal > avgTotal ? '+' : ''}${focusTotal - avgTotal} (${Math.round((focusTotal/avgTotal-1)*100)}%)\n  Focus vs region: ${focusTotal > avgMgrTotal ? '+' : ''}${focusTotal - avgMgrTotal} (${Math.round((focusTotal/avgMgrTotal-1)*100)}%)\n\nALL TERRITORIES:\n${allTerritoriesStr}`;
                              setActiveTab('chat');
                              setTimeout(() => launchWorkflowDirect('territory_assessment', `Assess territory ${t.id} — ${t.name}`, focusedContext), 100);
                            }} className="w-full py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 rounded-lg text-sm text-emerald-300 font-semibold transition-all">🔍 Assess this territory →</button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              <div className="flex-shrink-0 mt-3 grid grid-cols-3 gap-3">
                <button onClick={() => { setActiveTab('chat'); setTimeout(() => launchWorkflowDirect('territory_assessment', 'I want to run a territory assessment'), 100); }} className="py-2.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/25 hover:border-emerald-400/45 rounded-xl text-sm text-emerald-300 font-semibold transition-all flex items-center justify-center gap-2"><Target className="w-4 h-4" /> Territory Assessment</button>
                <button onClick={() => { setActiveTab('chat'); setTimeout(() => handleSubmit(null, 'I want to design new territories'), 100); }} className="py-2.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/25 hover:border-blue-400/45 rounded-xl text-sm text-blue-300 font-semibold transition-all flex items-center justify-center gap-2"><MapPin className="w-4 h-4" /> New Territory Design</button>
                <button onClick={() => { setActiveTab('chat'); setTimeout(() => handleSubmit(null, 'I want to set up a new field team'), 100); }} className="py-2.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/25 hover:border-violet-400/45 rounded-xl text-sm text-violet-300 font-semibold transition-all flex items-center justify-center gap-2"><Users className="w-4 h-4" /> New Team Setup</button>
              </div>
            </div>

          ) : activeTab === 'stella' ? (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl p-4 text-white shadow-xl flex-shrink-0 mb-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <Layers className="w-6 h-6" />
                    <div>
                      <h2 className="text-xl font-bold">Stella Insights</h2>
                      <p className="text-cyan-100 text-xs">Chat with your data — analyse trends and chart insights</p>
                    </div>
                  </div>
                  {isAdmin && (
                  <button onClick={() => { setActiveTab('admin'); setAdminModule('stella'); setStellaTab('data'); }} className="flex items-center gap-2 px-3 py-2 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-semibold transition-all"><Settings className="w-4 h-4" /> Manage data & context</button>
                  )}
                </div>
              </div>

              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6 overflow-y-auto space-y-4 custom-scrollbar mb-4 min-h-0">
                  {stellaMessages.map((message, index) => (
                    <div key={index} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${message.role === 'user' ? 'bg-gradient-to-br from-cyan-400 to-blue-400' : message.role === 'system' ? 'bg-gradient-to-br from-yellow-400 to-orange-400' : 'bg-gradient-to-br from-blue-400 to-purple-400'}`}>
                        {message.role === 'user' ? <Users className="w-5 h-5 text-slate-900" /> : message.role === 'system' ? <FileText className="w-5 h-5 text-slate-900" /> : <Layers className="w-5 h-5 text-slate-900" />}
                      </div>
                      <div className={`flex-1 ${message.role === 'user' ? 'text-right' : ''}`}>
                        <div className={`inline-block max-w-[85%] px-4 py-3 rounded-2xl ${message.role === 'user' ? 'bg-gradient-to-br from-cyan-500 to-blue-500 text-white' : message.role === 'system' ? 'bg-yellow-500/20 border border-yellow-400/30 text-yellow-200' : 'bg-slate-700/50 border border-blue-400/20 text-blue-100'}`}>
                          <div className="text-sm leading-relaxed">
                            {message.role === 'user' ? <span className="whitespace-pre-wrap">{message.content}</span> : <MessageErrorBoundary>{formatMarkdown(message.content)}</MessageErrorBoundary>}
                          </div>
                          {message.role === 'assistant' && Array.isArray(message.steps) && message.steps.length > 0 && renderStellaSteps(message.steps)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {stellaIsLoading && (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 flex items-center justify-center"><Layers className="w-5 h-5 text-slate-900" /></div>
                      <div className="flex-1">
                        <div className="inline-block px-4 py-3 rounded-2xl bg-slate-700/50 border border-blue-400/20">
                          <div className="flex gap-1">
                            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0s'}}></span>
                            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></span>
                            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <form onSubmit={handleStellaChatSubmit} className="bg-slate-800/50 backdrop-blur-sm border border-blue-400/20 rounded-xl p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <div className="flex-1">
                      <textarea
                        value={stellaInput}
                        onChange={(e) => setStellaInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleStellaChatSubmit(e); } }}
                        placeholder="Ask a question about your uploaded datasets…"
                        className="w-full bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 sm:px-4 py-2 sm:py-3 text-sm outline-none focus:border-blue-400 transition-colors resize-none"
                        rows={2}
                        disabled={stellaIsLoading}
                      />
                    </div>
                    <div className="flex gap-2 sm:gap-3 sm:items-end">
                      <button type="submit" disabled={stellaIsLoading || !stellaInput.trim()} className="flex-1 sm:flex-none px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"><Send className="w-5 h-5" /><span className="hidden sm:inline">Send</span></button>
                    </div>
                  </div>
                </form>
              </div>
            </div>

          ) : activeTab === 'user-settings' ? (
            <div className="overflow-y-auto h-full custom-scrollbar pr-1 sm:pr-2 space-y-4">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-4 sm:p-5 text-white shadow-xl">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/15 rounded-lg flex items-center justify-center"><UserCog className="w-5 h-5" /></div>
                    <div>
                      <h2 className="text-xl font-bold">User Settings</h2>
                    </div>
                  </div>
                  <div className="text-right text-xs text-blue-100/80">
                    <div className="font-semibold text-white">{currentUser.name}</div>
                    <div className="font-mono text-blue-200/70">userId: {currentUser.id}</div>
                  </div>
                </div>
              </div>

              <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1 w-fit">
                {[['general', 'General'], ['incentives', 'Incentives'], ['territory', 'Territory'], ['stella', 'Stella Insights']].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setUserSettingsPane(id)}
                    className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-all ${userSettingsPane === id ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-5 sm:p-6">
                {userSettingsPane === 'general' && (
                  <>
                    <p className="text-xs text-blue-300/70 mb-5">
                      These apply across the hub. Saved per named account in Supabase Storage bucket
                      {' '}<code className="text-cyan-300/80">intelligence</code>
                      {' '}→ <code className="text-cyan-300/80">users/{userStorageFolder(currentUser)}/settings.json</code>.
                      {' '}Chat history is a sibling file <code className="text-cyan-300/80">users/{userStorageFolder(currentUser)}/chats.json</code>.
                    </p>
                    {(() => {
                      const lengthLevel = getResponseLengthLevel(userSettings);
                      return (
                        <div className="mb-6 bg-slate-900/40 border border-blue-400/20 rounded-xl p-4 sm:p-5">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <label htmlFor="response-length" className="block text-sm font-semibold text-white">Response length</label>
                              <p className="text-xs text-blue-300/60 mt-1">
                                How chat and agent replies are written. Executive = decide. Standard = recommend. Teaching = explain with why, impact, and an example.
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm font-bold text-cyan-300">{lengthLevel.label}</div>
                              <div className="text-[10px] text-blue-300/50">{lengthLevel.value} of {RESPONSE_LENGTH_MAX}</div>
                            </div>
                          </div>
                          <input
                            id="response-length"
                            type="range"
                            min={RESPONSE_LENGTH_MIN}
                            max={RESPONSE_LENGTH_MAX}
                            step={1}
                            value={lengthLevel.value}
                            onChange={(e) => setUserSettings((prev) => ({
                              ...prev,
                              responseLength: storedResponseLength(e.target.value),
                            }))}
                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                            aria-valuemin={RESPONSE_LENGTH_MIN}
                            aria-valuemax={RESPONSE_LENGTH_MAX}
                            aria-valuenow={lengthLevel.value}
                            aria-valuetext={lengthLevel.label}
                          />
                          <div className="flex justify-between mt-2">
                            {RESPONSE_LENGTH_LEVELS.map((level) => (
                              <button
                                key={level.value}
                                type="button"
                                onClick={() => setUserSettings((prev) => ({ ...prev, responseLength: level.id }))}
                                className={`text-[10px] sm:text-xs font-semibold px-0.5 sm:px-1 ${level.value === lengthLevel.value ? 'text-cyan-300' : 'text-blue-300/40 hover:text-blue-200/70'}`}
                              >
                                {level.label}
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-blue-200/70 mt-3">{lengthLevel.hint}</p>
                        </div>
                      );
                    })()}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-blue-300/70 font-semibold mb-2">Company name</label>
                        <input
                          value={userSettings.companyName}
                          onChange={(e) => setUserSettings(prev => ({ ...prev, companyName: e.target.value }))}
                          placeholder="e.g. Acme Pharma UK"
                          className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-blue-300/70 font-semibold mb-2">Industry / therapeutic area</label>
                        <input
                          value={userSettings.industry}
                          onChange={(e) => setUserSettings(prev => ({ ...prev, industry: e.target.value }))}
                          placeholder="e.g. Specialty pharma — oncology"
                          className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-blue-300/70 font-semibold mb-2">Your role</label>
                        <input
                          value={userSettings.role}
                          onChange={(e) => setUserSettings(prev => ({ ...prev, role: e.target.value }))}
                          placeholder="e.g. Incentive Compensation Manager"
                          className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-blue-300/70 font-semibold mb-2">Preferred currency / units</label>
                        <input
                          value={userSettings.currency}
                          onChange={(e) => setUserSettings(prev => ({ ...prev, currency: e.target.value }))}
                          placeholder="e.g. GBP, % of target"
                          className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs text-blue-300/70 font-semibold mb-2">Company metrics &amp; definitions</label>
                        <textarea
                          value={userSettings.metrics}
                          onChange={(e) => setUserSettings(prev => ({ ...prev, metrics: e.target.value }))}
                          rows={3}
                          placeholder={"e.g. Attainment = actual / quota\nPrimary KPI = Net Sales\nQuota year = calendar year"}
                          className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs text-blue-300/70 font-semibold mb-2">Abbreviations &amp; terminology</label>
                        <textarea
                          value={userSettings.abbreviations}
                          onChange={(e) => setUserSettings(prev => ({ ...prev, abbreviations: e.target.value }))}
                          rows={4}
                          placeholder={"e.g. AE = Account Executive\nKAM = Key Account Manager\nSPIFF = Short-term incentive / contest"}
                          className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs text-blue-300/70 font-semibold mb-2">Preferences</label>
                        <textarea
                          value={userSettings.preferences}
                          onChange={(e) => setUserSettings(prev => ({ ...prev, preferences: e.target.value }))}
                          rows={3}
                          placeholder={"e.g. Prefer tables over long paragraphs, UK spelling"}
                          className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs text-blue-300/70 font-semibold mb-2">Hard constraints</label>
                        <textarea
                          value={userSettings.constraints}
                          onChange={(e) => setUserSettings(prev => ({ ...prev, constraints: e.target.value }))}
                          rows={3}
                          placeholder={"e.g. Must comply with ABPI"}
                          className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs text-blue-300/70 font-semibold mb-2">Additional context</label>
                        <textarea
                          value={userSettings.customContext}
                          onChange={(e) => setUserSettings(prev => ({ ...prev, customContext: e.target.value }))}
                          rows={4}
                          placeholder="Anything else the AI should always know across tools."
                          className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs text-blue-300/70 font-semibold mb-2">Remembered from chats</label>
                        <p className="text-[11px] text-blue-300/45 mb-2">
                          Short facts from chat, in addition to the settings fields above and any uploaded context files. Not the full transcript.
                        </p>
                        {(userSettings.memory || []).length === 0 ? (
                          <div className="text-xs text-blue-300/40 border border-blue-400/15 rounded-lg px-3 py-2">Nothing remembered yet.</div>
                        ) : (
                          <ul className="space-y-2">
                            {(userSettings.memory || []).map((item) => (
                              <li key={item.id} className="flex items-start gap-2 bg-slate-900/40 border border-blue-400/15 rounded-lg px-3 py-2">
                                <span className="flex-1 text-xs text-slate-200 leading-relaxed">{item.text}</span>
                                <button
                                  type="button"
                                  onClick={() => saveUserSettings({
                                    memory: (userSettings.memory || []).filter((m) => m.id !== item.id),
                                  })}
                                  className="text-blue-300/50 hover:text-red-300 p-0.5"
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
                  </>
                )}

                {userSettingsPane === 'incentives' && (
                  <>
                    <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">📊 PowerPoint template</h3>
                    <p className="text-xs text-blue-300/60 mb-4">
                      Used when exporting Incentive Compensation decks. Upload a branded .pptx — exports take its colours, fonts and background. Without a template, ComEx uses the default style. Stored at{' '}
                      <code className="text-cyan-300/80">{userPptxTemplateRemotePath(currentUser)}</code>.
                    </p>
                    {userSettings.pptxTemplate ? (
                      <div className="bg-slate-900/40 border border-blue-400/20 rounded-xl p-4 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white">{userSettings.pptxTemplate.fileName}</div>
                            <div className="text-xs text-blue-300/50 mt-0.5">
                              Theme: {userSettings.pptxTemplate.theme?.schemeName || 'Custom'}
                              {userSettings.pptxTemplate.theme?.fonts?.heading ? ` · ${userSettings.pptxTemplate.theme.fonts.heading}` : ''}
                              {userSettings.pptxTemplate.theme?.typography?.titleFontSize ? ` · title ${userSettings.pptxTemplate.theme.typography.titleFontSize}pt` : ''}
                              {userSettings.pptxTemplate.theme?.logoCount ? ` · ${userSettings.pptxTemplate.theme.logoCount} logo(s)` : ''}
                              {userSettings.pptxTemplate.uploadedAt ? ` · ${new Date(userSettings.pptxTemplate.uploadedAt).toLocaleDateString('en-GB')}` : ''}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => pptxTemplateInputRef.current?.click()}
                              disabled={pptxTemplateStatus === 'extracting' || pptxTemplateStatus === 'uploading'}
                              className="px-3 py-1.5 bg-slate-700/60 hover:bg-slate-600/60 text-slate-200 text-xs font-semibold rounded-lg border border-slate-500/30 disabled:opacity-50"
                            >
                              Replace
                            </button>
                            <button
                              type="button"
                              onClick={handleRemovePptxTemplate}
                              className="px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-semibold rounded-lg border border-red-400/25"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        {(() => {
                          const gen = getPptxGeneratorThemeFromUserSettings(userSettings);
                          const meta = userSettings.pptxTemplate?.theme?.blueprintMeta;
                          const swatches = [
                            ['Brand', gen.bgDark],
                            ['Accent', gen.accent],
                            ['Subtitle', gen.subtitleColor],
                            ['Title', gen.textOnDark],
                            ['Body', gen.textOnLight],
                          ].filter(([, hex]) => hex);
                          return (
                            <div className="flex flex-wrap gap-3 items-center">
                              {swatches.map(([label, hex]) => (
                                <div key={label} className="flex items-center gap-2 text-xs text-blue-200/70">
                                  <span className="w-6 h-6 rounded border border-white/20 shadow-inner" style={{ backgroundColor: `#${hex}` }} title={`#${hex}`} />
                                  <span>{label} <span className="text-blue-300/40 font-mono">#{hex}</span></span>
                                </div>
                              ))}
                              {userSettings.pptxTemplate?.theme?.hasBackgroundImage && (
                                <span className="text-[10px] text-cyan-300/80 font-semibold">Background from template ✓</span>
                              )}
                              {meta && (
                                <span className="text-[10px] text-cyan-300/80 font-semibold">
                                  {meta.cardColumnCount || 0} columns · {meta.chromeShapeCount || 0} shapes
                                </span>
                              )}
                              {gen.slideWidth && gen.slideHeight && (
                                <span className="text-[10px] text-emerald-400/80 font-semibold">
                                  {gen.slideWidth}&quot;×{gen.slideHeight}&quot;
                                  {gen.headingFont ? ` · ${gen.headingFont}` : ''}
                                  {gen.titleFontSize ? ` ${gen.titleFontSize}pt` : ''}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="bg-slate-900/30 border border-dashed border-blue-400/25 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="text-xs text-blue-300/60">No template uploaded — exports use the default navy / cyan ComEx style.</div>
                        <button
                          type="button"
                          onClick={() => pptxTemplateInputRef.current?.click()}
                          disabled={pptxTemplateStatus === 'extracting' || pptxTemplateStatus === 'uploading'}
                          className="px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/30 rounded-lg text-xs text-violet-200 font-semibold disabled:opacity-50 flex items-center gap-2"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          {pptxTemplateStatus === 'extracting' ? 'Reading theme…' : pptxTemplateStatus === 'uploading' ? 'Uploading…' : 'Upload .pptx template'}
                        </button>
                      </div>
                    )}
                    {pptxTemplateStatus === 'error' && pptxTemplateError && (
                      <div className="mt-2 text-xs text-red-300 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {pptxTemplateError}</div>
                    )}
                    <input ref={pptxTemplateInputRef} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={handlePptxTemplateUpload} className="hidden" />
                    {renderModuleContextPanel('incentives')}
                  </>
                )}

                {userSettingsPane === 'territory' && (
                  <>
                    <p className="text-xs text-blue-300/70 mb-2">Background for Territory work — alignments, team lists, maps, and similar files.</p>
                    {renderModuleContextPanel('territory')}
                  </>
                )}

                {userSettingsPane === 'stella' && (
                  <>
                    <p className="text-xs text-blue-300/70 mb-2">
                      Optional background for Stella Insights (strategy notes, definitions). Tabular datasets still upload in the Stella <span className="text-cyan-300">Data</span> tab.
                    </p>
                    {renderModuleContextPanel('stella')}
                  </>
                )}

                <input
                  ref={moduleContextFileInputRef}
                  type="file"
                  accept=".pdf,.ppt,.pptx,.xlsx,.xls,.csv,.txt,.md,.json"
                  className="hidden"
                  onChange={(e) => {
                    const raw = e.target.getAttribute('data-module') || userSettingsPane;
                    const id = ['incentives', 'territory', 'stella'].includes(raw) ? raw : 'incentives';
                    handleModuleContextUpload(e, id);
                  }}
                />

                <div className="flex flex-wrap items-center gap-3 mt-6">
                  <button
                    onClick={() => saveUserSettings(userSettings)}
                    disabled={userSettingsSaveStatus === 'saving'}
                    className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:opacity-50 text-white font-semibold rounded-lg transition-all flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" /> {userSettingsSaveStatus === 'saving' ? 'Saving…' : 'Save settings'}
                  </button>
                  <button
                    onClick={async () => {
                      const path = userSettings.pptxTemplate?.storagePath || userPptxTemplateRemotePath(currentUser);
                      if (userSettings.pptxTemplate) {
                        try { await supabase.storage.from('intelligence').remove([path]); } catch { /* ignore */ }
                      }
                      const contextPaths = Object.values(userSettings.moduleContext || {})
                        .flatMap((bucket) => bucket?.files || [])
                        .flatMap((f) => (f.storagePath ? [f.storagePath, `${f.storagePath}.extracted.txt`] : []));
                      if (contextPaths.length) {
                        try { await supabase.storage.from('intelligence').remove(contextPaths); } catch { /* ignore */ }
                      }
                      setPptxTemplateError('');
                      setPptxTemplateStatus('idle');
                      await saveUserSettings({ ...DEFAULT_USER_SETTINGS });
                    }}
                    className="px-5 py-2.5 bg-slate-700/60 hover:bg-slate-600/60 text-slate-200 font-semibold rounded-lg transition-all border border-slate-500/30"
                  >
                    Reset
                  </button>
                  {userSettingsSaveStatus === 'saved' && (
                    <span className="flex items-center gap-1.5 text-sm text-green-400 font-semibold"><CheckCircle className="w-4 h-4" /> Saved to settings.json</span>
                  )}
                  {userSettingsSaveStatus === 'error' && (
                    <span className="flex items-center gap-1.5 text-sm text-red-400 font-semibold"><AlertTriangle className="w-4 h-4" /> {userSettingsCloudError || 'Save failed'}</span>
                  )}
                </div>
              </div>
            </div>

          ) : isAdmin ? (
            // ADMIN
            <div className="space-y-4 sm:space-y-6 overflow-y-auto h-full custom-scrollbar pr-1 sm:pr-2">
              <div className="flex gap-2 pb-1 overflow-x-auto">
                {[{ id: 'incentive', label: 'Incentive Comp' }, { id: 'territory', label: 'Territory' }, { id: 'stella', label: 'Stella Insights' }, { id: 'users', label: 'Users' }].map(m => (
                  <button key={m.id} onClick={() => setAdminModule(m.id)} className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${adminModule === m.id ? 'bg-white/15 text-white border border-white/20' : 'bg-slate-800/40 text-blue-300/70 hover:bg-slate-700/50'}`}>{m.label}</button>
                ))}
              </div>

              {adminModule === 'incentive' && (
              <>
              <div className="flex gap-2 border-b border-blue-400/20 pb-3 overflow-x-auto">
                {[{ id: 'knowledge', label: 'Knowledge' }, { id: 'workflows', label: 'Workflows' }, { id: 'agents', label: 'Agents' }, { id: 'system-prompt', label: 'Prompt' }, { id: 'pptx', label: '📊 PPT' }, { id: 'runtime', label: 'Runtime' }, { id: 'settings', label: 'Settings' }].map(tab => (
                  <button key={tab.id} onClick={() => setAdminSection(tab.id)} className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${adminSection === tab.id ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white' : 'bg-slate-700/30 text-blue-300 hover:bg-slate-700/50'}`}>{tab.label}</button>
                ))}
              </div>

              {adminSection === 'knowledge' && (
                <>
                  <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><FileText className="w-6 h-6 text-blue-400" />Knowledge Base Management</h2>
                    <p className="text-sm text-blue-300/70 mb-2">
                      Knowledge is <span className="text-cyan-300 font-semibold">not hardcoded</span>. Files in the Supabase <code className="text-cyan-300/80">intelligence</code> bucket are loaded on every visit and injected into chat/agents.
                    </p>
                    <p className="text-xs text-blue-300/50 mb-6">
                      Status: {knowledgeLoadStatus === 'loading' ? 'Loading…' : knowledgeLoadStatus === 'ready' ? `${documents.length} file(s) loaded` : knowledgeLoadStatus === 'error' ? 'Storage error (tried public seed fallback)' : 'Idle'}
                    </p>
                    <div className="space-y-3 mb-6">
                      {documents.length === 0 && (
                        <div className="text-xs text-amber-300/80 bg-amber-500/10 border border-amber-400/20 rounded-lg p-3">
                          No knowledge files loaded yet. Upload .md / .txt / .yml files below (seed files: {KNOWLEDGE_SEED_FILES.join(', ')}).
                        </div>
                      )}
                      {documents.map(doc => (
                        <div key={doc.id} className="flex items-center justify-between bg-slate-700/30 border border-blue-400/20 rounded-lg p-4 hover:border-blue-400/40 transition-all">
                          <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-blue-400" />
                            <div>
                              <div className="font-medium text-sm">{doc.name}</div>
                              <div className="text-xs text-blue-300/50">{doc.size} • {doc.status}{doc.type === 'yaml' && <span className="ml-2 px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded text-xs">YAML</span>}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded border border-green-400/30 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Active</span>
                            <button onClick={() => removeDocument(doc.id)} className="p-2 hover:bg-red-500/20 rounded transition-colors text-red-400"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => adminFileInputRef.current?.click()} className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"><Plus className="w-5 h-5" />Upload Intelligence File</button>
                    <p className="text-xs text-blue-300/50 text-center mt-2">Supports: .yml, .yaml, .txt, .md • Saved to Supabase and reloaded every visit</p>
                    <input ref={adminFileInputRef} type="file" accept=".yml,.yaml,.txt,.md" onChange={handleAdminFileUpload} className="hidden" />
                  </div>
                </>
              )}

              {adminSection === 'agents' && (
                <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Users className="w-6 h-6 text-purple-400" />Specialist Agents</h2>
                  <div className="space-y-3">
                    {agents.map(agent => (
                      <div key={agent.id} className="bg-slate-700/30 border border-purple-400/20 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div><div className="font-semibold text-purple-300">{agent.name}</div><div className="text-xs text-blue-300/60 mt-1">{agent.role}</div></div>
                          <span className={`px-2 py-1 text-xs rounded ${agent.status === 'active' ? 'bg-green-500/20 text-green-400 border border-green-400/30' : 'bg-gray-500/20 text-gray-400 border border-gray-400/30'}`}>{agent.status}</span>
                        </div>
                        <div className="flex gap-2 pt-3 border-t border-purple-400/20">
                          <button onClick={() => setEditingAgent({...agent})} className="flex-1 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-400/30 rounded-lg text-sm font-semibold transition-all">Edit</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {adminSection === 'workflows' && (
                <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Target className="w-6 h-6 text-cyan-400" />Workflows</h2>
                  <div className="space-y-4">
                    {topics.map(topic => (
                      <div key={topic.id} className="bg-slate-700/30 border border-cyan-400/20 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1 mr-3"><div className="font-semibold text-cyan-300">{topic.name}</div><div className="text-xs text-blue-300/60 mt-1">{topic.description}</div></div>
                          <span className={`px-2 py-1 text-xs rounded ${topic.status === 'active' ? 'bg-green-500/20 text-green-400 border border-green-400/30' : 'bg-gray-500/20 text-gray-400 border border-gray-400/30'}`}>{topic.status}</span>
                        </div>
                        <div className="space-y-1 mt-3 pl-3 border-l-2 border-cyan-400/30">
                          {topic.workflow.map((step, idx) => (
                            <div key={idx} className="text-xs"><span className="text-cyan-400 font-medium">Step {step.step}:</span><span className="text-blue-300/80 ml-2">{step.name}</span></div>
                          ))}
                        </div>
                        <div className="flex gap-2 mt-4 pt-4 border-t border-cyan-400/20">
                          <button onClick={async () => {
                            const next = topics.map(t => t.id === topic.id ? { ...t, status: t.status === 'active' ? 'inactive' : 'active' } : t);
                            setTopics(next);
                            await persistIntelligenceSettings({ topics: next });
                          }} className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${topic.status === 'active' ? 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border border-yellow-400/30' : 'bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-400/30'}`}>{topic.status === 'active' ? 'Disable' : 'Enable'}</button>
                          <button onClick={() => {
                            const hydrated = mergeTopics([topic])[0];
                            setEditingTopic(hydrated);
                            setEditingTopicTab('orchestrator');
                            setExpandedSteps({});
                          }} className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-400/30">Edit</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {adminSection === 'system-prompt' && (
                <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                  <h2 className="text-xl font-bold mb-2 flex items-center gap-2"><FileText className="w-6 h-6 text-blue-400" />System Prompt Configuration</h2>
                  <p className="text-xs text-blue-300/55 mb-3">Saved to the shared product JSON — used by all users, not stored in their settings.</p>
                  <textarea value={customSystemPrompt} onChange={(e) => setCustomSystemPrompt(e.target.value)} rows={24} className="w-full bg-slate-950 border border-blue-400/30 rounded-lg px-4 py-3 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-cyan-400/60 resize-y" spellCheck={false} />
                  <div className="flex flex-wrap gap-3 mt-4">
                    <button onClick={() => persistIntelligenceSettings({ systemPrompt: customSystemPrompt })} disabled={userSettingsSaveStatus === 'saving'} className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"><Save className="w-4 h-4" />{userSettingsSaveStatus === 'saving' ? 'Saving…' : 'Save'}</button>
                    <button onClick={() => { navigator.clipboard.writeText(customSystemPrompt); alert('Copied!'); }} className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-400/30 rounded-lg text-sm font-semibold transition-all">Copy</button>
                    <button onClick={() => { if (window.confirm('Reset to default?')) setCustomSystemPrompt(DEFAULT_SYSTEM_PROMPT); }} className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-400/30 rounded-lg text-sm font-semibold transition-all">Reset to Default</button>
                  </div>
                </div>
              )}

              {adminSection === 'pptx' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-white">PowerPoint context</h3>
                    <p className="text-xs text-blue-300/55 mt-1">
                      Export prompts and clarify copy for IC consultation. Template upload stays in User Settings. Saved to the shared product JSON.
                    </p>
                  </div>
                  {[['intentDetection', 'Offer Detection (after chat)', 'Decides when to offer a PowerPoint export.'], ['messageClassify', 'Message Classify (export vs assess)', 'Routes typed messages: export, assessment, or neither.'], ['summary', 'Session Summary', 'Used when generating a summary deck.'], ['produced', 'Produced Document', 'Used when generating a working document.']].map(([key, title, desc]) => (
                    <div key={key} className="bg-slate-800/40 border border-blue-400/20 rounded-xl p-4">
                      <div className="text-sm font-semibold text-white mb-1">{title}</div>
                      <p className="text-xs text-blue-300/50 mb-3">{desc}</p>
                      <textarea
                        value={productIntel.pptxContext?.[key] ?? ''}
                        onChange={e => setProductIntel(prev => ({
                          ...prev,
                          pptxContext: { ...mergePptxContext(prev.pptxContext), [key]: e.target.value },
                        }))}
                        rows={8}
                        className="w-full bg-slate-900/60 text-blue-100 text-xs rounded-lg p-3 border border-blue-400/20 focus:border-blue-400/50 focus:outline-none font-mono resize-y"
                      />
                    </div>
                  ))}
                  <div className="bg-slate-800/40 border border-blue-400/20 rounded-xl p-4">
                    <div className="text-sm font-semibold text-white mb-1">PPT clarify prompt</div>
                    <p className="text-xs text-blue-300/50 mb-3">Shown when the user wants an export but has not chosen summary / one-pager / full pack.</p>
                    <textarea
                      value={productIntel.pptxClarify?.prompt ?? ''}
                      onChange={(e) => setProductIntel(prev => ({
                        ...prev,
                        pptxClarify: { ...(prev.pptxClarify || {}), prompt: e.target.value },
                      }))}
                      rows={8}
                      className="w-full bg-slate-900/60 text-blue-100 text-xs rounded-lg p-3 border border-blue-400/20 focus:border-blue-400/50 focus:outline-none font-mono resize-y"
                    />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => persistIntelligenceSettings({
                        pptxContext: productIntel.pptxContext,
                        pptxClarify: productIntel.pptxClarify,
                      })}
                      disabled={userSettingsSaveStatus === 'saving'}
                      className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:opacity-50 text-white font-semibold rounded-lg transition-all flex items-center gap-2"
                    >
                      <Save className="w-4 h-4" /> {userSettingsSaveStatus === 'saving' ? 'Saving…' : 'Save PowerPoint context'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setProductIntel(prev => ({
                        ...prev,
                        pptxContext: { ...DEFAULT_PPTX_CONTEXT },
                        pptxClarify: { ...DEFAULT_PPTX_CLARIFY, options: DEFAULT_PPTX_CLARIFY.options.map((o) => ({ ...o })) },
                      }))}
                      className="px-5 py-2.5 bg-slate-700/60 hover:bg-slate-600/60 text-slate-200 font-semibold rounded-lg border border-slate-500/30"
                    >
                      Restore factory defaults
                    </button>
                    {userSettingsSaveStatus === 'saved' && (
                      <span className="flex items-center gap-1.5 text-sm text-green-400 font-semibold"><CheckCircle className="w-4 h-4" /> Saved</span>
                    )}
                    {userSettingsSaveStatus === 'saved-local' && (
                      <span className="flex items-center gap-1.5 text-sm text-amber-300 font-semibold"><CheckCircle className="w-4 h-4" /> Saved locally</span>
                    )}
                  </div>
                </div>
              )}

              {adminSection === 'settings' && (
                <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6 space-y-6">
                  <h2 className="text-xl font-bold flex items-center gap-2"><Settings className="w-6 h-6 text-yellow-400" />Settings</h2>
                  <div className="bg-slate-900/50 border border-blue-400/20 rounded-lg p-5">
                    <h3 className="text-lg font-semibold text-yellow-400 mb-4">AI Suggestions</h3>
                    <div className="flex items-center justify-between mb-4">
                      <div><label className="text-sm font-semibold text-white">Enable Suggestions</label><p className="text-xs text-blue-300/70 mt-1">Show AI next-step chips after each response (phrased as user messages)</p></div>
                      <button onClick={() => setSuggestionsEnabled(!suggestionsEnabled)} className={`relative w-14 h-7 rounded-full transition-colors ${suggestionsEnabled ? 'bg-green-500' : 'bg-slate-600'}`}><div className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${suggestionsEnabled ? 'translate-x-7' : 'translate-x-0'}`} /></button>
                    </div>
                    <div className="mb-4">
                      <label className="text-sm font-semibold text-white block mb-2">Number of Suggestions: {maxSuggestions}</label>
                      <input type="range" min="1" max="5" value={maxSuggestions} onChange={(e) => setMaxSuggestions(parseInt(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div className="mb-3">
                      <label className="text-xs text-blue-300/70 font-semibold mb-1 block">Suggestions system prompt</label>
                      <textarea
                        value={productIntel.suggestions?.systemPrompt ?? ''}
                        onChange={(e) => setProductIntel(prev => ({ ...prev, suggestions: { ...prev.suggestions, systemPrompt: e.target.value } }))}
                        rows={8}
                        className="w-full bg-slate-950 border border-blue-400/30 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono resize-y"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => persistIntelligenceSettings()}
                      disabled={userSettingsSaveStatus === 'saving'}
                      className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" /> {userSettingsSaveStatus === 'saving' ? 'Saving…' : 'Save settings'}
                    </button>
                  </div>
                </div>
              )}

              {adminSection === 'runtime' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-white">Runtime prompts & copy</h3>
                    <p className="text-xs text-blue-300/55 mt-1">
                      Incentive Comp shared glue — welcome, workflow match/offer, agent wrappers, proposal vision, PPT repair. Orchestrator prompts live on each workflow (Workflows → Edit).
                    </p>
                  </div>
                  {[
                    ['welcomeMessages.consultation', 'Consultation welcome'],
                    ['workflowRuntime.matchDetectorPrompt', 'Workflow match detector'],
                    ['workflowRuntime.offerTemplate', 'Workflow offer template'],
                    ['workflowRuntime.agentTaskWrapper', 'Agent task wrapper'],
                    ['workflowRuntime.waitForClarifyingPolicy', 'Wait-for-answers policy (auto-advance off)'],
                    ['workflowRuntime.autoAdvanceClarifyingPolicy', 'Auto-advance policy (do not wait)'],
                    ['workflowRuntime.handoffAddon', 'Handoff add-on'],
                    ['workflowRuntime.proposalImageInterpretPrompt', 'Proposal image / vision extract'],
                    ['workflowRuntime.proposalImageClassifyPrompt', 'Proposal image purpose classifier'],
                    ['workflowRuntime.pptxRepairPrompt', 'PPT JSON repair'],
                  ].map(([path, title]) => {
                    const [root, key] = path.split('.');
                    const value = productIntel?.[root]?.[key] ?? '';
                    return (
                      <div key={path} className="bg-slate-800/40 border border-blue-400/20 rounded-xl p-4">
                        <div className="text-sm font-semibold text-white mb-2">{title}</div>
                        <textarea
                          value={value}
                          onChange={(e) => setProductIntel(prev => ({
                            ...prev,
                            [root]: { ...(prev[root] || {}), [key]: e.target.value },
                          }))}
                          rows={6}
                          className="w-full bg-slate-900/60 text-blue-100 text-xs rounded-lg p-3 border border-blue-400/20 focus:border-blue-400/50 focus:outline-none font-mono resize-y"
                        />
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => persistIntelligenceSettings({
                      welcomeMessages: productIntel.welcomeMessages,
                      workflowRuntime: productIntel.workflowRuntime,
                      suggestions: productIntel.suggestions,
                    })}
                    disabled={userSettingsSaveStatus === 'saving'}
                    className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" /> {userSettingsSaveStatus === 'saving' ? 'Saving…' : 'Save runtime context'}
                  </button>
                </div>
              )}

              {editingAgent && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
                  <div className="bg-slate-900 border border-blue-400/20 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto my-8">
                    <div className="sticky top-0 bg-slate-900 border-b border-blue-400/20 p-6 flex items-center justify-between z-10 rounded-t-xl">
                      <h2 className="text-xl font-bold">Edit Agent: {editingAgent.name}</h2>
                      <button onClick={() => setEditingAgent(null)} className="text-blue-300 hover:text-white transition-colors"><X className="w-6 h-6" /></button>
                    </div>
                    <div className="p-6 space-y-6">
                      <div><label className="block text-sm font-semibold mb-2">Agent Name</label><input type="text" value={editingAgent.name} onChange={(e) => setEditingAgent({...editingAgent, name: e.target.value})} className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white" /></div>
                      <div><label className="block text-sm font-semibold mb-2">Role</label><input type="text" value={editingAgent.role} onChange={(e) => setEditingAgent({...editingAgent, role: e.target.value})} className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white" /></div>
                      <div><label className="block text-sm font-semibold mb-2">System Prompt</label><textarea value={editingAgent.systemPrompt} rows={15} onChange={(e) => setEditingAgent({...editingAgent, systemPrompt: e.target.value})} className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white font-mono text-sm" /></div>
                      <div>
                        <label className="block text-sm font-semibold mb-2">Knowledge files</label>
                        <p className="text-xs text-blue-300/50 mb-2">Select intelligence files from the loaded knowledge base to pass as guidance to this agent.</p>
                        {documents.length === 0 ? (
                          <div className="text-xs text-amber-300/80 bg-amber-500/10 border border-amber-400/20 rounded-lg p-3">
                            No knowledge files loaded yet. Upload files in Admin → Knowledge first.
                          </div>
                        ) : (
                          <div className="bg-slate-800 border border-blue-400/30 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                            <label className="flex items-center gap-2 text-sm text-cyan-200 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={(editingAgent.knowledgeFiles || []).includes('*')}
                                onChange={(e) => setEditingAgent({
                                  ...editingAgent,
                                  knowledgeFiles: e.target.checked ? ['*'] : [],
                                })}
                                className="rounded border-blue-400/40"
                              />
                              All loaded knowledge files
                            </label>
                            <div className="border-t border-blue-400/15 pt-2 space-y-1.5">
                              {documents.map((doc) => {
                                const all = (editingAgent.knowledgeFiles || []).includes('*');
                                const checked = all || (editingAgent.knowledgeFiles || []).includes(doc.name);
                                return (
                                  <label key={doc.name} className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      disabled={all}
                                      checked={checked}
                                      onChange={(e) => {
                                        const prev = (editingAgent.knowledgeFiles || []).filter((f) => f !== '*');
                                        const next = e.target.checked
                                          ? [...new Set([...prev, doc.name])]
                                          : prev.filter((f) => f !== doc.name);
                                        setEditingAgent({ ...editingAgent, knowledgeFiles: next });
                                      }}
                                      className="rounded border-blue-400/40"
                                    />
                                    <span className="truncate">{doc.name}</span>
                                    <span className="text-[10px] text-blue-300/40 ml-auto flex-shrink-0">{doc.size}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-blue-400/20 p-6 flex gap-3 bg-slate-900 rounded-b-xl">
                      <button onClick={async () => {
                        const next = agents.map(a => a.id === editingAgent.id ? editingAgent : a);
                        setAgents(next);
                        setEditingAgent(null);
                        await persistIntelligenceSettings({ agents: next });
                      }} className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"><Save className="w-5 h-5" /> Save Changes</button>
                      <button onClick={() => setEditingAgent(null)} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              {editingTopic && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center z-[60] p-4 overflow-y-auto">
                  <div className="bg-slate-900 border border-cyan-400/30 rounded-xl max-w-4xl w-full my-6 shadow-2xl shadow-cyan-500/10">
                    <div className="sticky top-0 bg-slate-900 border-b border-blue-400/20 p-4 sm:p-5 z-10 rounded-t-xl space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-xl font-bold">Edit Workflow: {editingTopic.name}</h2>
                        <button type="button" onClick={() => { setEditingTopic(null); setEditingTopicTab('basics'); }} className="text-blue-300 hover:text-white transition-colors"><X className="w-6 h-6" /></button>
                      </div>
                      <div className="flex gap-2 overflow-x-auto">
                        {[['basics', 'Basics'], ['orchestrator', 'Orchestrator'], ['steps', 'Steps']].map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setEditingTopicTab(id)}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${editingTopicTab === id ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white' : 'bg-slate-800 text-blue-300 hover:bg-slate-700'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="p-5 sm:p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                      {editingTopicTab === 'basics' && (
                        <>
                          <div><label className="block text-sm font-semibold mb-2">Workflow Name</label><input type="text" value={editingTopic.name} onChange={(e) => setEditingTopic({...editingTopic, name: e.target.value})} className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white" /></div>
                          <div><label className="block text-sm font-semibold mb-2">Description</label><textarea value={editingTopic.description} onChange={(e) => setEditingTopic({...editingTopic, description: e.target.value})} rows={3} className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white" /></div>
                          <div><label className="block text-sm font-semibold mb-2">Trigger Keywords (comma-separated)</label><input type="text" value={editingTopic.triggerKeywords?.join(', ') || ''} onChange={(e) => setEditingTopic({ ...editingTopic, triggerKeywords: e.target.value.split(',').map(k => k.trim()).filter(k => k) })} className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white text-sm" /></div>
                          <label className="flex items-start gap-2 text-sm text-blue-100 cursor-pointer">
                            <input type="checkbox" checked={!!editingTopic.autoAdvance} onChange={(e) => setEditingTopic({ ...editingTopic, autoAdvance: e.target.checked })} className="rounded border-blue-400/40 mt-0.5" />
                            <span>
                              <span className="font-semibold">Auto-advance</span>
                              <span className="block text-xs text-blue-300/60 mt-0.5">
                                {editingTopic.autoAdvance
                                  ? 'On: continue through all agents without waiting. Never invent missing facts — flag them as information gaps (often critical in an assessment).'
                                  : 'Off: if an agent asks clarifying questions, the workflow waits until the user answers before continuing.'}
                              </span>
                            </span>
                          </label>
                        </>
                      )}

                      {editingTopicTab === 'orchestrator' && (
                        <div className="space-y-4">
                          <p className="text-xs text-cyan-200/70 bg-cyan-500/10 border border-cyan-400/20 rounded-lg p-3">
                            Orchestrator prompts for <strong>this workflow only</strong> (role, rules, intro, briefing, evaluate, wrap-up). These are not in Runtime.
                          </p>
                          {[
                            ['role', 'Role', 2],
                            ['goal', 'Goal', 2],
                            ['approach', 'Approach / rules', 5],
                            ['introFull', 'Intro (full workflow)', 3],
                            ['introFocused', 'Intro (focused / pre-selected)', 2],
                            ['briefingPrompt', 'Step briefing prompt', 3],
                            ['evaluatePrompt', 'Step evaluate prompt (JSON decision)', 10],
                            ['wrapUpPrompt', 'Wrap-up prompt', 3],
                            ['evalFallbackMessage', 'Fallback message when evaluate fails', 2],
                          ].map(([key, label, rows]) => (
                            <div key={key}>
                              <label className="text-xs text-blue-300/70 block mb-1 font-semibold">{label}</label>
                              <textarea
                                value={editingTopic.orchestrator?.[key] || ''}
                                onChange={(e) => setEditingTopic({
                                  ...editingTopic,
                                  orchestrator: { ...(editingTopic.orchestrator || {}), [key]: e.target.value },
                                })}
                                rows={rows}
                                className="w-full bg-slate-800 border border-cyan-400/25 rounded-lg px-3 py-2 text-white text-sm font-mono"
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {editingTopicTab === 'steps' && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-cyan-400">Workflow Steps</h3>
                            <button type="button" onClick={() => { const newStep = { step: (editingTopic.workflow?.length || 0) + 1, name: 'New Step', agents: [], goal: '', successCriteria: '' }; setEditingTopic({ ...editingTopic, workflow: [...(editingTopic.workflow || []), newStep] }); }} className="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg text-xs flex items-center gap-1 border border-green-400/30"><Plus className="w-3 h-3" />Add Step</button>
                          </div>
                          {editingTopic.workflow?.map((step, index) => {
                            const stepKey = `${editingTopic.id}-${index}`;
                            const isExpanded = expandedSteps[stepKey] || false;
                            return (
                              <div key={index} className="bg-slate-800 border border-blue-400/20 rounded-lg">
                                <div className="p-4">
                                  <div className="flex items-center gap-3">
                                    <button type="button" onClick={() => setExpandedSteps({...expandedSteps, [stepKey]: !isExpanded})} className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0 hover:bg-blue-500/30 transition-colors">{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
                                    <span className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-sm flex-shrink-0">{step.step}</span>
                                    <div className="flex-1"><div className="text-white font-medium">{step.name}</div></div>
                                    <button type="button" onClick={() => { const newWorkflow = editingTopic.workflow.filter((_, i) => i !== index); newWorkflow.forEach((s, i) => s.step = i + 1); setEditingTopic({ ...editingTopic, workflow: newWorkflow }); }} className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                                  </div>
                                </div>
                                {isExpanded && (
                                  <div className="border-t border-blue-400/20 p-4 space-y-3">
                                    <div><label className="text-xs text-blue-300/70 block mb-1">Step Name:</label><input type="text" value={step.name} onChange={(e) => { const nw = [...editingTopic.workflow]; nw[index] = {...nw[index], name: e.target.value}; setEditingTopic({...editingTopic, workflow: nw}); }} className="w-full bg-slate-700 border border-blue-400/30 rounded px-3 py-2 text-white text-sm" /></div>
                                    <div><label className="text-xs text-blue-300/70 block mb-1">Goal:</label><textarea value={step.goal || ''} onChange={(e) => { const nw = [...editingTopic.workflow]; nw[index] = {...nw[index], goal: e.target.value}; setEditingTopic({...editingTopic, workflow: nw}); }} className="w-full bg-slate-700 border border-blue-400/30 rounded px-3 py-2 text-white text-sm" rows={2} /></div>
                                    <div><label className="text-xs text-blue-300/70 block mb-1">Success Criteria:</label><input type="text" value={step.successCriteria || ''} onChange={(e) => { const nw = [...editingTopic.workflow]; nw[index] = {...nw[index], successCriteria: e.target.value}; setEditingTopic({...editingTopic, workflow: nw}); }} className="w-full bg-slate-700 border border-blue-400/30 rounded px-3 py-2 text-white text-sm" /></div>
                                    <div><label className="text-xs text-blue-300/70 block mb-1">Assigned Agent:</label><select value={step.agents?.[0] || ''} onChange={(e) => { const nw = [...editingTopic.workflow]; nw[index] = {...nw[index], agents: e.target.value ? [e.target.value] : []}; setEditingTopic({...editingTopic, workflow: nw}); }} className="w-full bg-slate-700 border border-blue-400/30 rounded px-3 py-2 text-white text-sm"><option value="">Select an agent...</option>{agents.map(agent => (<option key={agent.id} value={agent.id}>{agent.name}</option>))}</select></div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-blue-400/20 p-4 sm:p-5 flex gap-3 bg-slate-900 rounded-b-xl">
                      <button type="button" onClick={async () => {
                        const next = topics.map(t => t.id === editingTopic.id ? editingTopic : t);
                        setTopics(next);
                        setEditingTopic(null);
                        setEditingTopicTab('basics');
                        await persistIntelligenceSettings({ topics: next });
                      }} className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"><CheckCircle className="w-5 h-5" />Save Changes</button>
                      <button type="button" onClick={() => { setEditingTopic(null); setEditingTopicTab('basics'); }} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">Cancel</button>
                    </div>
                  </div>
                </div>
              )}
              </>
              )}

              {adminModule === 'territory' && (
                <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6 text-sm text-blue-300/70">
                  Territory admin settings will appear here. Territory structures are currently managed directly in the <span className="text-cyan-300 font-semibold">Territory</span> tab.
                </div>
              )}

              {adminModule === 'stella' && (
                <div className="space-y-4">
                  <div className="flex gap-2 border-b border-blue-400/20 pb-3 overflow-x-auto">
                    {[{ id: 'data', label: 'Data' }, { id: 'business', label: 'Business Context' }, { id: 'connections', label: 'Connections' }, { id: 'prompts', label: 'Prompts' }].map(tab => (
                      <button key={tab.id} onClick={() => setStellaTab(tab.id)} className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${stellaTab === tab.id ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white' : 'bg-slate-700/30 text-blue-300 hover:bg-slate-700/50'}`}>{tab.label}</button>
                    ))}
                  </div>
                  {(stellaTab === 'data' || stellaTab === 'chat') && renderStellaDataPanel()}
                  {stellaTab === 'business' && renderStellaBusinessPanel()}
                  {stellaTab === 'connections' && renderStellaConnectionsPanel()}
                  {stellaTab === 'prompts' && (
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-lg font-bold text-white">Stella prompts</h3>
                        <p className="text-xs text-blue-300/55 mt-1">
                          Welcome message and AI prompts for data intake / analysis. Stored in the shared product JSON — separate from Incentive Comp runtime.
                        </p>
                      </div>
                      {[
                        ['welcomeMessages.stella', 'Welcome message'],
                        ['stellaPrompts.contentSummary', 'Content summary'],
                        ['stellaPrompts.intake', 'Intake'],
                        ['stellaPrompts.analyst', 'Analyst'],
                      ].map(([path, title]) => {
                        const [root, key] = path.split('.');
                        const value = productIntel?.[root]?.[key] ?? '';
                        return (
                          <div key={path} className="bg-slate-800/40 border border-cyan-400/20 rounded-xl p-4">
                            <div className="text-sm font-semibold text-white mb-2">{title}</div>
                            <textarea
                              value={value}
                              onChange={(e) => setProductIntel(prev => ({
                                ...prev,
                                [root]: { ...(prev[root] || {}), [key]: e.target.value },
                              }))}
                              rows={8}
                              className="w-full bg-slate-900/60 text-blue-100 text-xs rounded-lg p-3 border border-cyan-400/20 focus:border-cyan-400/50 focus:outline-none font-mono resize-y"
                            />
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => persistIntelligenceSettings({
                          welcomeMessages: productIntel.welcomeMessages,
                          stellaPrompts: productIntel.stellaPrompts,
                        })}
                        disabled={userSettingsSaveStatus === 'saving'}
                        className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50"
                      >
                        <Save className="w-4 h-4" /> {userSettingsSaveStatus === 'saving' ? 'Saving…' : 'Save Stella prompts'}
                      </button>
                      {userSettingsSaveStatus === 'saved' && (
                        <span className="flex items-center gap-1.5 text-sm text-green-400 font-semibold"><CheckCircle className="w-4 h-4" /> Saved</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {adminModule === 'users' && (
                <AdminUsers currentUserId={currentUser.id} />
              )}
            </div>
          ) : null}
          </MessageErrorBoundary>
        </div>
      )}

      {imageLightbox?.src && (
        <div
          className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${imageLightbox.name}`}
          onClick={() => setImageLightbox(null)}
        >
          <div
            className="relative max-w-5xl w-full max-h-[90vh] bg-slate-900 border border-blue-400/30 rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-blue-400/20">
              <div className="min-w-0">
                <div className="font-semibold text-white truncate">{imageLightbox.name}</div>
                <div className="text-xs text-slate-300 mt-0.5">
                  {imageLightbox.pending
                    ? '? Needs confirmation'
                    : imageLightbox.included
                      ? '✓ Included for vision'
                      : '✗ Ignored'}
                  {' · '}
                  {purposeLabel(imageLightbox.purpose)}
                  {imageLightbox.sourceFormat ? ` · from ${String(imageLightbox.sourceFormat).toUpperCase()}` : ''}
                  {imageLightbox.reason ? ` — ${imageLightbox.reason}` : ''}
                </div>
                {imageLightbox.pending && imageLightbox.contextReview && (
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      className="px-3 py-1 rounded-lg bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100 text-xs font-semibold"
                      onClick={() => {
                        applyContextUnsureImageDecision(imageLightbox.name, true);
                        setImageLightbox(null);
                      }}
                    >
                      Include
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1 rounded-lg bg-slate-600/60 hover:bg-slate-500/70 text-slate-100 text-xs font-semibold"
                      onClick={() => {
                        applyContextUnsureImageDecision(imageLightbox.name, false);
                        setImageLightbox(null);
                      }}
                    >
                      Skip
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setImageLightbox(null)}
                className="flex-shrink-0 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                aria-label="Close preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-auto max-h-[calc(90vh-4.5rem)] bg-slate-950/60 flex items-center justify-center">
              <img
                src={imageLightbox.src}
                alt={imageLightbox.name}
                className="max-w-full max-h-[75vh] object-contain rounded-md"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
