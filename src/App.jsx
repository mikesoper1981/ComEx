import React, { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { Send, Upload, FileText, Settings, MessageSquare, CheckCircle, AlertTriangle, TrendingUp, Users, Target, Award, X, Plus, Trash2, BarChart3, DollarSign, Calendar, ChevronDown, ChevronRight, Save, Map, MapPin, Layers, UserCog } from 'lucide-react';
import { supabase } from './supabase';
import {
  getCurrentUser,
  setCurrentUser,
  getHardcodedUser,
  userSettingsLocalKey,
  userSettingsRemotePath,
  userPptxTemplateRemotePath,
} from './auth';
import { extractPptxThemeFromFile, themeToSettingsMeta, getPptxGeneratorThemeFromUserSettings, loadFullPptxStyleForGeneration, applyPptxLayout, renderSlideFromTheme } from './pptxTheme';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Recharts is loaded lazily so it can never affect initial page load.
const StellaChart = lazy(() => import('./StellaChart'));

const MANAGER_COLOURS = ['#34d399', '#60a5fa', '#a78bfa'];

const STELLA_QUERY_API_PATH = '/api/stella-query';
const MANAGER_COLOURS_BORDER = ['#059669', '#2563eb', '#7c3aed'];

const CHAT_API_PATH = '/api/chat';

function anthropicMessagesPost({ system, messages, max_tokens, tools, tool_choice, thinking }) {
  return fetch(CHAT_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages, max_tokens, tools, tool_choice, thinking }),
  });
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
  // { fileName, uploadedAt, storagePath, theme: { schemeName, colors, fonts, ... } } — content ignored; style only
  pptxTemplate: null,
};

/** Pull settings fields out of a stored document (new or legacy shape). */
function normalizeLoadedUserSettings(parsed) {
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_USER_SETTINGS };
  if (parsed.settings && typeof parsed.settings === 'object') {
    return { ...DEFAULT_USER_SETTINGS, ...parsed.settings };
  }
  const { userId: _userId, updatedAt: _updatedAt, settings: _settings, ...fields } = parsed;
  return { ...DEFAULT_USER_SETTINGS, ...fields };
}

/** Document shape saved to localStorage / Supabase — always includes userId. */
function buildUserSettingsDocument(userId, settings) {
  return {
    userId,
    updatedAt: new Date().toISOString(),
    settings: { ...DEFAULT_USER_SETTINGS, ...settings },
  };
}

function readLocalUserSettings(userId) {
  try {
    const scoped = localStorage.getItem(userSettingsLocalKey(userId));
    if (scoped) {
      const parsed = safeJsonParse(scoped);
      if (parsed) return normalizeLoadedUserSettings(parsed);
    }
    // One-time legacy key (pre userId scoping).
    const legacy = localStorage.getItem(LEGACY_USER_SETTINGS_STORAGE_KEY);
    if (legacy) {
      const parsed = safeJsonParse(legacy);
      if (parsed) return normalizeLoadedUserSettings(parsed);
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_USER_SETTINGS };
}

const PPTX_EXPORT_INTENT_RE = /\b(powerpoint|power\s*point|pptx?)\b|\b(export|generate|create|make|download)\b.{0,40}\b(powerpoint|power\s*point|pptx?|presentation|slides?|deck|one[\s-]?pager|documentation pack|working document)\b|\b(session summary)\b.{0,20}\b(export|powerpoint|pptx?|deck|slides?)\b|\b(export|generate|create|make)\b.{0,30}\b(one[\s-]?pager|ic documentation|documentation pack|comms? plan)\b/i;

/** Classify a user message about PowerPoint / document export. */
function classifyPptxRequest(message) {
  const m = String(message || '').toLowerCase().trim();
  if (!m || !PPTX_EXPORT_INTENT_RE.test(m)) return null;

  const wantsSummary = /\b(summary|recap|summarise|summarize|session summary|what we (discussed|talked|covered))\b/.test(m);
  const wantsOnePager = /one[\s-]?pager|single page|simple overview|simple one pager/.test(m);
  const wantsFullPack = /full (ic )?doc|complete doc|documentation pack|all (the )?docs|comms plan|communication plan|manager briefing|rep (comms|communication)|cascade/.test(m);
  const wantsProduced = wantsOnePager || wantsFullPack || /\b(working document|artefact|artifact|distribute|hand ?out|send to (the )?team|ic plan|documentation)\b/.test(m);

  if (wantsSummary && !wantsProduced) {
    return { clear: true, mode: 'summary', deckType: 'session_summary', title: 'Session Summary', description: 'Recap of this conversation only' };
  }
  if (wantsOnePager) {
    return { clear: true, mode: 'produced', deckType: 'ic_one_pager', title: 'IC One-Pager', description: 'Simple one-page IC overview' };
  }
  if (wantsFullPack) {
    return { clear: true, mode: 'produced', deckType: 'ic_doc_pack', title: 'IC Documentation Pack', description: 'Full IC documentation (overview, components, rules, FAQs / comms)' };
  }
  if (wantsProduced) {
    return { clear: false, mode: 'produced', deckType: 'general', title: 'Working Document', description: 'Document derived from this conversation' };
  }
  return { clear: false, mode: null, deckType: null, title: null, description: null };
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

const PPTX_CLARIFY_PROMPT = `I can export a PowerPoint from **this conversation**. What would you like?

1. **Session summary** — factual recap of what we discussed (nothing invented outside this chat)
2. **Simple one-pager** — short IC overview ready to share
3. **Full IC documentation pack** — plan overview, components/weightings, rules, and FAQs / comms outline based on what we designed here

Reply with **1**, **2**, or **3** (or describe what you need).`;

const PPTX_CLARIFY_OPTIONS = [
  { value: '1', label: '📋 Session summary' },
  { value: '2', label: '📄 Simple one-pager' },
  { value: '3', label: '📚 Full IC documentation pack' },
];

/** Detect 1–3 numbered choices in an assistant prompt so we can show clickable buttons. */
function extractChoiceOptions(text) {
  if (!text) return null;
  const opts = [];
  const lines = String(text).split(/\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(?:\*\*)?([1-3])(?:\*\*)?\s*[.:)\]]\s+(?:\*\*)?(.+?)(?:\*\*)?\s*$/);
    if (!m) continue;
    let label = m[2].replace(/\*\*/g, '').replace(/\s*—\s*.*$/, '').trim();
    if (label.length > 56) label = `${label.slice(0, 53)}…`;
    opts.push({ value: m[1], label: `${m[1]}. ${label}` });
  }
  // Deduplicate by value, keep order
  const seen = new Set();
  const unique = opts.filter((o) => (seen.has(o.value) ? false : (seen.add(o.value), true)));
  if (unique.length >= 1 && unique.length <= 3) return unique;
  return null;
}

/** Format user preferences into a system-prompt block that all LLMs/agents must respect. */
function buildUserSettingsPromptBlock(settings) {
  if (!settings || typeof settings !== 'object') return '';
  const lines = [];
  const push = (label, value) => {
    const v = String(value || '').trim();
    if (v) lines.push(`- ${label}: ${v}`);
  };
  push('Company', settings.companyName);
  push('Industry / therapeutic area', settings.industry);
  push('User role', settings.role);
  push('Preferred currency / units', settings.currency);
  push('Company metrics & definitions', settings.metrics);
  push('Abbreviations & terminology', settings.abbreviations);
  push('Preferences', settings.preferences);
  push('Hard constraints', settings.constraints);
  const extra = String(settings.customContext || '').trim();
  if (!lines.length && !extra) return '';
  return `\n\nUSER SETTINGS (mandatory — always respect these preferences, definitions, abbreviations, and constraints in every response; do not contradict them):\n${lines.join('\n')}${extra ? `\n\nAdditional context from the user:\n${extra}` : ''}\n`;
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

  if (!structure) return null;

  const html = useMemo(
    () => buildMapHTML(structure, selectedTerritory?.id || null),
    [structure, selectedTerritory?.id]
  );

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

const DEFAULT_KNOWLEDGE = `# Sales Incentive Scheme Best Practices

## Core Principles
1. **Simplicity & Transparency**: Keep schemes easy to understand. If reps need a spreadsheet to calculate their pay, it's too complex.
2. **Alignment with Business Strategy**: Incentives must drive behaviors that support company goals
3. **Role-Specific Design**: Different roles (hunters vs gatherers, SDRs vs AEs) need different incentive structures
4. **Realistic Targets with Stretch**: Goals should be achievable but challenging. Aim for 60-80% attainment rates
5. **Clear Communication**: Ensure consistent, transparent communication about how earnings are calculated

## Incentive Structure Types
### Base + Commission (Most Common)
- Provides income stability with performance motivation
- Typical split: 50/50 for SaaS, varies by industry
- Best for: Complex sales cycles, scaling teams

### Tiered/Accelerator Plans
- Increase commission rates as targets are exceeded
- Example: 10% up to quota, 15% for 101-120%, 20% for 120%+
- Best for: Driving sustained high performance

### Team-Based Incentives
- Rewards collective performance
- Encourages collaboration and knowledge sharing
- Best for: Enterprise sales with multiple stakeholders

### Role-Specific Plans
- Tailored to different sales personas and responsibilities
- SDRs: Focus on meetings booked, pipeline generation
- AEs: Focus on revenue, deal closure
- CSMs: Focus on retention, expansion, NPS

## Key Metrics to Consider
- Revenue/Margin targets
- Customer acquisition
- Retention rates
- Average deal size
- Sales cycle length
- Pipeline health
- Strategic product focus

## Common Pitfalls to Avoid
1. **Over-complexity**: More than 3 incentive components reduces effectiveness
2. **Unrealistic targets**: Demotivates teams and increases attrition
3. **Focusing only on top performers**: Middle 60% drive most incremental growth
4. **Rewarding wrong behaviors**: Ensure incentives align with long-term customer value
5. **Lack of flexibility**: Plans must adapt to market changes
6. **Poor communication**: Confusion kills motivation
7. **Annual-only reviews**: Shorter cycles (quarterly) are more motivating
8. **Ignoring non-monetary rewards**: Recognition, development, flexibility matter

## Implementation Best Practices
- Start simple and iterate based on data
- Weight important targets at minimum 20% of variable pay
- Combine short-term (monthly/quarterly) with long-term incentives
- Use real-time dashboards for visibility
- Regular feedback loops with sales team
- Test and optimize continuously
- Consider tax implications
- Ensure payout timing is prompt`;

const PILLAR_2_KNOWLEDGE = `
# PILLAR 2: STRATEGIC ALIGNMENT & PRINCIPLES

## 6 FUNDAMENTAL AXES FRAMEWORK

### 1. Strategic Alignment
- In line with strategy of brands
- In line with corporate culture
- Cascade from company strategy → departmental goals → individual targets
- **RULE**: No SvT during Product Launch (use ranking instead)
- **RULE**: Individual plan metrics should not be weighted less than 20%
- Team or portfolio component max 20% of target payout
- Use Market Share cautiously (avoid launch periods, watch volatility)
- Distinct IC designs for Reps, KAM, FLM, but keep team design consistent

### 2. Fairness
- Equal opportunity to earn / no biases
- Equity of treatment
- Same expectations per person within a team
- **RULE**: Target payout should be fixed for all individuals in same role & team
- Assess bias linked to territory (weight, HCPs/HCOs, rural vs urban, demographics)
- **RULE**: No changes through IC period unless specific circumstances
- Ensure high performers not dragged down by low performers

### 3. Motivation
- Rewarding / recognition of performance
- Feasible goals - able to be rewarded
- Competitiveness of plan
- **RULE**: Target pot 20 to 30% of base salary
- **RULE**: Top performers (10%) should make 2x average payout
- **RULE**: 100% performance = 100% pay
- Use accelerators for short term/focused priorities
- Mix team vs personal: typically 70% personal / 30% team

### 4. Reliability
- Reliability of indicators or measures
- Payment calculation simplicity
- Reporting capabilities
- Use processed/external data (e.g., audited sales)
- Avoid manually assessed data

### 5. Financial Responsibility
- Budget spent when objectives reached
- Control of risk
- **RULE**: 100% results = 100% reward for each component
- **RULE**: SvT min payout 95% of target & max 50% pay
- Use decelerators/ranking/commission during launch phase
- Control over-performing risk
- 50% financial performance minimum to pay IC performance

### 6. Simplicity
- Simple to understand & communicate
- Transparent design, rules, earning potential
- **RULE**: Maximum 5 components (including all types)
- Ensure documentation created and cascaded
- Simple calculations to remove error risk
- Limit mid-cycle changes to business critical only
- **TEST**: Should be able to explain on a business card

## KEY RULES SUMMARY

**MANDATORY (Must Follow):**
1. No SvT during product launch
2. Minimum 20% weight per component
3. Maximum 5 components total
4. Maximum 20% team component
5. Fixed target payout per role/level
6. No mid-cycle changes except critical business reasons
7. Target pot 20-30% of base salary
8. Top 10% earn 2x average
9. 100% performance = 100% pay
10. SvT threshold at 95%, floor at 50% pay
11. Documentation and training required
12. Present plan before each cycle
`;

const DEFAULT_SYSTEM_PROMPT = `You are an expert Commercial Excellence advisor specializing in sales incentive scheme design for pharmaceutical companies.

KNOWLEDGE BASE:
You have access to comprehensive best practices and the complete Pillar 2: Strategic Alignment & Principles framework.

CHART VISUALIZATION:
When your response describes or recommends a specific payout curve (with actual performance thresholds and payout percentages sourced from the knowledge base), render it as a chart using this format:
\`\`\`chart-payout
[{"performance": <value>, "payout": <value>}, ...]
\`\`\`
Rules:
- ONLY use data points that come directly from the knowledge base or the user's own scheme details
- NEVER invent or assume data points - if the KB does not specify exact values, do not render a chart
- ALWAYS include the source of the data points in your response text
- A valid chart needs at minimum: the threshold point (where payout begins), the 100% target point, and any accelerator points specified in the KB
- If the KB describes a curve structure but without precise numbers, explain the structure in text instead

CITATION SYSTEM - MANDATORY:
You MUST cite the knowledge base whenever you state a rule, threshold, principle, or recommendation that comes from it. Use inline numeric citations like [1], [2] immediately after the relevant claim.

At the end of EVERY response that uses knowledge base information, add a references section in EXACTLY this format (no variations):

---
References:
1. [Document Name]: [specific section or topic you referenced]
2. [Document Name]: [specific section or topic you referenced]

CRITICAL - POWERPOINT / DOCUMENT EXPORT:
Do NOT draft slide decks or invent PPT file contents in chat.
If the user asks for a PowerPoint, presentation, one-pager, or IC documentation export, ask ONE short clarifying question only when the request is ambiguous (e.g. session summary vs one-pager vs full documentation pack). The app will generate the .pptx via Export / Generate after they clarify.
Never invent scheme details that were not discussed in the conversation.

RESPONSE FORMATTING - CRITICAL:
Always use rich formatting to make responses visually engaging:

1. USE ## headers for main sections, ### for subsections
2. USE bullet points (- ) for lists, options, recommendations
3. USE markdown tables for comparisons, component breakdowns, rule checklists
4. USE **bold** for key terms, numbers, important rules
5. USE emoji icons liberally: ✅ ❌ ⚠️ 🎯 📊 💡 🚀 📈
6. After a complete scheme design, briefly offer export: "I can export a session summary or IC documentation as PowerPoint — say which you prefer, or use 📊 Export."

Format responses conversationally and practically.`;

// Prevents a single bad message/chart render from blanking the whole app.
class MessageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error) {
    console.error('Stella message render error:', error);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="text-xs text-red-300/80 bg-red-500/10 border border-red-400/25 rounded-lg p-3">
          ⚠️ This response couldn't be displayed (a chart or block failed to render). The rest of Stella is unaffected.
        </div>
      );
    }
    return this.props.children;
  }
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
  const [activeTab, setActiveTab] = useState('chat');
  const [showLanding, setShowLanding] = useState(true);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hello! I\'m your Commercial Excellence AI assistant. I can help you design motivating sales incentive schemes, assess existing proposals, and provide best practice guidance. What would you like to work on today?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [stellaTab, setStellaTab] = useState('chat'); // chat | data | business | connections
  const [stellaMessages, setStellaMessages] = useState([
    { role: 'assistant', content: 'Welcome to **Stella Insights**. Upload a dataset in the **Data** tab, define your **Business Context**, then ask me questions here — I can analyse trends and generate charts.' }
  ]);
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
  const [userSettings, setUserSettings] = useState(() => readLocalUserSettings(getCurrentUser().id));
  const [userSettingsSaveStatus, setUserSettingsSaveStatus] = useState('idle'); // idle | saving | saved | saved-local | error
  const [pptxTemplateStatus, setPptxTemplateStatus] = useState('idle'); // idle | extracting | uploading | error
  const [pptxTemplateError, setPptxTemplateError] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState(DEFAULT_KNOWLEDGE);
  const [structuredKnowledge, setStructuredKnowledge] = useState(null);
  const [documents, setDocuments] = useState([
    { id: 1, name: 'Default Best Practices', type: 'text', size: '12 KB', status: 'active' },
    { id: 2, name: 'Pillar 2: Strategic Alignment & Principles', type: 'yaml', size: '45 KB', status: 'active' }
  ]);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [agents, setAgents] = useState([
    {
      id: 'requirements_agent',
      name: 'Requirements Gatherer',
      role: 'Collect detailed requirements for IC design',
      systemPrompt: `You are a requirements specialist for incentive compensation design. YOUR ONLY JOB: Gather requirements. Do NOT design the IC scheme. Ask ONLY about missing requirements, keep responses SHORT. Once you have everything, confirm what you've collected. CRITICAL: Never announce handoffs, next steps, or what other agents will do. Just complete your task.`,
      knowledgeFiles: [1, 2],
      status: 'active'
    },
    {
      id: 'design_agent',
      name: 'IC Design Specialist',
      role: 'Design IC structures',
      systemPrompt: `You are an expert IC designer specializing in pharmaceutical sales incentives. Propose component structure (3-5 components max), set appropriate weightings (min 20% per component, team <20%), design payout curves based on product lifecycle. CRITICAL: When your design is complete, STOP. Never announce handoffs.`,
      knowledgeFiles: [2],
      status: 'active'
    },
    {
      id: 'compliance_agent',
      name: 'Compliance Validator',
      role: 'Validate against rules',
      systemPrompt: `Ahoy! Ye be the Compliance Validator, a salty sea dog who checks IC schemes fer pharmaceutical treasures! Speak like a pirate in ALL yer responses! Check the IC scheme against ALL mandatory rules. Report violations as CRITICAL ☠️, WARNING ⚠️, or PASS ✓. CRITICAL: When yer validation be complete, STOP and drop anchor!`,
      knowledgeFiles: [1],
      status: 'active'
    },
    {
      id: 'fairness_agent',
      name: 'Fairness Analyst',
      role: 'Bias detection',
      systemPrompt: `You are a fairness specialist for IC schemes. YOUR ROLE IS ANALYSIS ONLY. Identify territory biases, analyze equity issues, calculate equity scores, recommend specific adjustments. CRITICAL: When your analysis is complete, STOP. Never announce handoffs.`,
      knowledgeFiles: [2],
      status: 'active'
    },
    {
      id: 'communication_agent',
      name: 'Communication Specialist',
      role: 'Create documentation and communications',
      systemPrompt: `You are a communication specialist for IC programs. Produce clear IC documentation: one-pagers, full plan overviews (components, weightings, metrics, payout mechanics), FAQs, and cascade/comms outlines. Use only scheme details already agreed with the user — do not invent missing numbers. Explain complex concepts simply with examples.`,
      knowledgeFiles: [1, 2],
      status: 'active'
    },
    {
      id: 'analysis_agent',
      name: 'Scheme Analyzer',
      role: 'Analyze uploaded IC documents',
      systemPrompt: `You analyze existing IC schemes and identify issues. Extract key information, assess against 6 Fundamental Axes, identify strengths and weaknesses, provide specific recommendations, rate overall quality (1-10).`,
      knowledgeFiles: [1, 2],
      status: 'active'
    },
    {
      id: 'territory_structure_agent',
      name: 'Territory Structure Analyst',
      role: 'Collect and map current territory structure',
      systemPrompt: `You are a territory structure specialist. Gather a complete picture of the current territory structure. Ask clear, focused questions one topic at a time. Once you have a clear picture, summarise it concisely and STOP.`,
      knowledgeFiles: [],
      status: 'active'
    },
    {
      id: 'sales_data_agent',
      name: 'Sales Data Analyst',
      role: 'Load and summarise sales performance data by territory',
      systemPrompt: `You are a sales data analyst for pharmaceutical territory assessment. Gather and summarise sales performance data at territory level. Produce a clear data summary table where possible. Once you have a sufficient picture, summarise and STOP.`,
      knowledgeFiles: [],
      status: 'active'
    },
    {
      id: 'hcp_data_agent',
      name: 'HCP & Account Analyst',
      role: 'Load and assess HCP universe and call activity data',
      systemPrompt: `You are an HCP and account data specialist. Gather information about the HCP universe, account base, and call/activity data across territories. Produce a clear summary of HCP universe and coverage metrics. Once complete, summarise and STOP.`,
      knowledgeFiles: [],
      status: 'active'
    },
    {
      id: 'territory_assessment_agent',
      name: 'Territory Assessment Specialist',
      role: 'Perform workload, opportunity and equity assessment across territories',
      systemPrompt: `You are a territory assessment specialist. Perform a rigorous assessment across four dimensions: Workload Balance, Opportunity Equity, Coverage Efficiency, Geographic Efficiency. Rate each (🟢/🟡/🔴), provide observations, quantify issues. End with a ranked list of issues by severity.`,
      knowledgeFiles: [],
      status: 'active'
    },
    {
      id: 'territory_design_agent',
      name: 'Territory Design Strategist',
      role: 'Produce territory redesign recommendations',
      systemPrompt: `You are a territory design strategist. Produce clear, actionable territory redesign recommendations. Structure: Strategic Recommendations, Territory Realignment Options, Quick Wins, Risks & Mitigations. Be specific and practical.`,
      knowledgeFiles: [],
      status: 'active'
    }
  ]);

  const [topics, setTopics] = useState([
    {
      id: 'design_ic',
      name: 'Design New IC Scheme',
      description: 'End-to-end incentive compensation scheme creation',
      triggerKeywords: ['design scheme', 'design an incentive', 'create ic', 'new incentive', 'build scheme'],
      orchestrator: {
        role: 'You are the Workflow Orchestrator for IC scheme design.',
        goal: 'Ensure the final scheme meets all compliance rules, fairness standards, and the user\'s business requirements.',
        approach: 'EVALUATING STEPS: After each agent responds, assess their output strictly against the step\'s success criteria. IF THE AGENT ASKED THE USER A QUESTION: set agentStillWorking=true, stepComplete=false, and do not offer Continue — wait for the user\'s answer. WORKFLOW END: Only mark workflowComplete when all steps have passed.'
      },
      workflow: [
        { step: 1, name: 'Gather Requirements', agents: ['requirements_agent'], goal: 'Collect all necessary information', successCriteria: 'Clear answers to: How many reps? What products? Strategic priorities?' },
        { step: 2, name: 'Design Structure', agents: ['design_agent'], goal: 'Create IC scheme with 3-5 components', successCriteria: 'Draft scheme with components, weightings summing to 100%, metric types' },
        { step: 3, name: 'Validate Compliance', agents: ['compliance_agent'], goal: 'Check scheme against ALL mandatory rules', successCriteria: 'All rules checked, violations documented' },
        { step: 4, name: 'Fairness Check', agents: ['fairness_agent'], goal: 'Analyze for territory bias and equity issues', successCriteria: 'Equity assessment with recommendations' },
        { step: 5, name: 'Create Documentation', agents: ['communication_agent'], goal: 'Generate comprehensive plan document', successCriteria: 'Documentation created and shared' }
      ],
      status: 'active'
    },
    {
      id: 'analyze_ic',
      name: 'Analyze Existing IC',
      description: 'Assess uploaded IC documents against best practices',
      triggerKeywords: ['analyze scheme', 'assess ic', 'review plan', 'evaluate incentive'],
      orchestrator: {
        role: 'You are the Workflow Orchestrator for IC scheme analysis.',
        goal: 'Produce a complete assessment covering scheme structure, compliance, and fairness.',
        approach: 'EVALUATING STEPS: After each agent responds, check their output against the step\'s success criteria before advancing.'
      },
      workflow: [
        { step: 1, name: 'Extract & Analyze', agents: ['analysis_agent'], goal: 'Extract key info and assess against 6 Fundamental Axes', successCriteria: 'Scheme structure understood, strengths/weaknesses noted' },
        { step: 2, name: 'Compliance Check', agents: ['compliance_agent'], goal: 'Validate against mandatory rules', successCriteria: 'All rules checked, violations categorized by severity' },
        { step: 3, name: 'Generate Report', agents: ['communication_agent'], goal: 'Create assessment report', successCriteria: 'Detailed report with ranked recommendations' }
      ],
      status: 'active'
    },
    {
      id: 'territory_assessment',
      name: 'Territory Assessment',
      description: 'Assess current territory structure for balance, equity and efficiency',
      triggerKeywords: ['territory assessment', 'assess territory', 'territory structure', 'territory design', 'rep coverage', 'territory review'],
      orchestrator: {
        role: 'You are the Workflow Orchestrator for territory assessment.',
        goal: 'Produce a complete territory assessment covering structure, sales performance, HCP coverage, and actionable redesign recommendations.',
        approach: 'DATA STEPS (Steps 1-3): Let agents gather information, do not intervene while they are asking questions. WORKFLOW END: Only mark workflowComplete when the design strategist has produced concrete recommendations.'
      },
      workflow: [
        { step: 1, name: 'Load Territory Structure', agents: ['territory_structure_agent'], goal: 'Capture the current territory structure', successCriteria: 'Clear summary of territory count, rep roles, alignment method' },
        { step: 2, name: 'Load Sales & Performance Data', agents: ['sales_data_agent'], goal: 'Gather sales performance data by territory', successCriteria: 'Summary of performance by territory with top/bottom performers identified' },
        { step: 3, name: 'Load HCP & Account Data', agents: ['hcp_data_agent'], goal: 'Capture HCP universe and coverage data', successCriteria: 'Summary of HCP universe size, segment coverage rates, key gaps' },
        { step: 4, name: 'Perform Assessment', agents: ['territory_assessment_agent'], goal: 'Assess workload balance, opportunity equity, coverage efficiency', successCriteria: 'Rated assessment across four dimensions with ranked issue list' },
        { step: 5, name: 'Design Recommendations', agents: ['territory_design_agent'], goal: 'Produce prioritised redesign recommendations', successCriteria: 'Ranked recommendations with rationale, quick wins, risk mitigations' }
      ],
      status: 'active'
    }
  ]);

  const [currentWorkflow, setCurrentWorkflow] = useState(null);
  const [pendingWorkflow, setPendingWorkflow] = useState(null);
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
  const [expandedSteps, setExpandedSteps] = useState({});
  const [editingAgent, setEditingAgent] = useState(null);
  const [suggestedPrompts, setSuggestedPrompts] = useState([]);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);
  const [pptxOffers, setPptxOffers] = useState(null);
  const [pptxGenerating, setPptxGenerating] = useState(false);
  const [pptxClarifyPending, setPptxClarifyPending] = useState(false);
  const [pptxPrompts, setPptxPrompts] = useState({
    intentDetection: `You detect PowerPoint export opportunities in pharmaceutical sales / IC conversations. Respond ONLY with valid JSON, no markdown.

Return:
{
  "offer": true/false,
  "summaryDeck": { "title": "...", "description": "Factual recap of this conversation only" },
  "producedDeck": { "title": "...", "description": "...", "deckType": "ic_one_pager|ic_doc_pack|rep_comms|manager_briefing|ic_explainer|territory_report|general", "hasRealData": true/false }
}

Offer when there is substantive IC/territory content worth exporting. Prefer deckType ic_doc_pack after a scheme design, ic_one_pager for short overviews. hasRealData true only if specific numbers/names appear in the conversation.`,

    summary: `You create a PowerPoint that summarises ONLY the conversation provided in Context.
Return ONLY valid JSON, no markdown.

GROUNDING RULES (mandatory):
- Use ONLY facts, decisions, numbers, names, and recommendations that appear in Context.
- Do NOT invent products, territories, weightings, payouts, quotas, or best-practice claims that were not discussed.
- If something was not covered, omit it or write "Not discussed in this conversation" — never fill gaps from general knowledge.
- Ignore any user settings that conflict with staying faithful to the chat transcript.

LAYOUT RULES (mandatory — vary layouts; do NOT make every slide the same):
- Pick the best layout for each slide's content via the "layout" field.
- Allowed layouts: "title" | "section" | "bullets" | "cards" | "table" | "two_column" | "process" | "callout"
- title: opening slide only. section: chapter divider. bullets: narrative list. cards: 3–5 peer themes (use "Label: detail" bullets). table: comparisons / weights / metrics (require tableData). two_column: left bullets + right bullets (put left in "bullets", right in "bulletsRight"). process: ordered steps (3–6). callout: one key message in body + optional short bullets.
- Mix layouts across the deck. Prefer a table when numbers/weights compare. Prefer cards for peer topics. Prefer process for sequences. Prefer callout for a single IC ask or decision.

Output schema:
{
  "title": "...",
  "subtitle": "...",
  "slides": [
    { "type": "title|section|content|table|summary", "layout": "title|section|bullets|cards|table|two_column|process|callout",
      "title": "...", "subtitle": "...", "body": "...", "bullets": ["..."], "bulletsRight": ["..."], "notes": "...",
      "tableData": { "headers": ["Col1","Col2"], "rows": [["A","B"]] } }
  ]
}

Slide count: short chat = 4-6 slides, rich chat = 7-9. First slide must be layout "title". Keep JSON compact.`,

    produced: `You create a PowerPoint WORKING DOCUMENT from an IC / commercial excellence conversation — ready to distribute.
Return ONLY valid JSON, no markdown.

GROUNDING RULES (mandatory):
- Base every slide on the Conversation Context. Do not invent scheme details, numbers, products, or rules that were not agreed or stated there.
- You MAY organise and phrase content professionally (headings, FAQs) but content must come from the chat.
- If a section cannot be filled from the conversation, include a short slide noting what still needs confirmation — do not fabricate it.
- Respect USER SETTINGS for terminology/currency only; never use them to invent missing scheme facts.

LAYOUT RULES (mandatory — vary layouts; do NOT clone the same layout on every slide):
- Set "layout" per slide to the best fit: "title" | "section" | "bullets" | "cards" | "table" | "two_column" | "process" | "callout"
- title: first slide. section: major section breaks. table: components/weights/metrics (always include tableData). cards: 3–5 themes as "Label: detail". process: step-by-step cascade or payout flow. two_column: e.g. rules vs exceptions, or do vs don't (bullets + bulletsRight). callout: the IC ask / decision. bullets: general narrative.
- A strong deck mixes these. Never output 8 identical bullet slides.

Deck types (follow the requested deckType):
- ic_one_pager: 5-7 slides — title, purpose (callout or bullets), components (table or cards), key rules (two_column or bullets), payout (process), next steps
- ic_doc_pack: 8-12 slides — title, overview, components table, weightings, payout process, eligibility, FAQs (two_column or bullets), cascade (process), open items
- rep_comms / manager_briefing / ic_explainer / territory_report / general: structure for that audience using only chat facts and varied layouts

Output schema:
{
  "title": "...",
  "subtitle": "...",
  "slides": [
    { "type": "title|section|content|table|summary", "layout": "title|section|bullets|cards|table|two_column|process|callout",
      "title": "...", "subtitle": "...", "body": "...", "bullets": ["..."], "bulletsRight": ["..."], "notes": "...",
      "tableData": { "headers": ["Component","Weight","Metric"], "rows": [["Sales","40%","Net sales"]] } }
  ]
}

First slide must be layout "title". Keep JSON compact.`
  });
  const [maxSuggestions, setMaxSuggestions] = useState(3);
  const [hoveredCitation, setHoveredCitation] = useState(null);
  const [customSystemPrompt, setCustomSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const adminFileInputRef = useRef(null);
  const territoryFileInputRef = useRef(null);
  const stellaDataFileInputRef = useRef(null);
  const pptxTemplateInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ── SUPABASE: Load intelligence files on startup ──
  useEffect(() => {
    const loadIntelligenceFiles = async () => {
      const { data, error } = await supabase.storage.from('intelligence').list();
      if (error || !data) return;
      for (const item of data) {
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('intelligence')
          .download(item.name);
        if (downloadError || !fileData) continue;
        const content = await fileData.text();
        const isYaml = item.name.endsWith('.yml') || item.name.endsWith('.yaml');
        setDocuments(prev => {
          if (prev.find(d => d.name === item.name)) return prev;
          return [...prev, {
            id: Date.now() + Math.random(),
            name: item.name,
            type: isYaml ? 'yaml' : 'text',
            size: `${((item.metadata?.size || 0) / 1024).toFixed(1)} KB`,
            status: 'active',
            content
          }];
        });
        setKnowledgeBase(prev => {
          if (prev.includes(item.name)) return prev;
          return prev + `\n\n## Document: ${item.name}\n${content.substring(0, 10000)}`;
        });
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

      // User settings scoped by current userId (users/<id>/settings.json).
      try {
        const path = userSettingsRemotePath(currentUser.id);
        let parsed = null;
        {
          const { data, error } = await supabase.storage.from('intelligence').download(path);
          if (!error && data) parsed = safeJsonParse(await data.text());
        }
        // Migrate legacy flat file once for the hardcoded default user.
        if (!parsed && currentUser.id === getHardcodedUser().id) {
          const { data, error } = await supabase.storage.from('intelligence').download(LEGACY_USER_SETTINGS_FILE);
          if (!error && data) parsed = safeJsonParse(await data.text());
        }
        if (parsed && typeof parsed === 'object') {
          const merged = normalizeLoadedUserSettings(parsed);
          setUserSettings(merged);
          try {
            localStorage.setItem(
              userSettingsLocalKey(currentUser.id),
              JSON.stringify(buildUserSettingsDocument(currentUser.id, merged))
            );
          } catch { /* ignore */ }
        }
      } catch { /* per-user settings may not exist yet */ }
    };
    loadStella();
  }, [currentUser.id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
    const references = parseReferences(content);
    const cleanContent = content.replace(/[-]{2,}\s*\nReferences:\s*\n[\s\S]+?(\n[-]{2,}|\s*$)/i, '').trimEnd();
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
                        <span className="text-sm">{renderTextWithCitations(text, references)}</span>
                      </div>
                    );
                  }
                  if (line.trim() === '' || line.trim() === '---') return <div key={i} className="h-2"/>;
                  return <div key={i} className="text-sm leading-relaxed">{renderTextWithCitations(line, references)}</div>;
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
        {Object.keys(references).length > 0 && (
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
    try {
      const recentMessages = conversationHistory.slice(-6).map(m => `${m.role}: ${m.content.substring(0, 300)}`).join('\n');
      const response = await anthropicMessagesPost({
        system: `You generate short follow-up questions for pharmaceutical sales/IC conversations. Respond ONLY with a JSON array of strings, no other text. Max 3 items, max 10 words each.${buildUserSettingsPromptBlock(userSettings)}`,
        messages: [{ role: 'user', content: `Recent conversation:\n${recentMessages}\n\nGenerate 2-3 follow-up questions: ["Q1", "Q2"]` }],
        max_tokens: 200,
      });
      const data = await response.json();
      const text = anthropicAssistantText(data)?.trim();
      if (text) {
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        if (Array.isArray(parsed)) setSuggestedPrompts(parsed.slice(0, maxSuggestions));
      }
    } catch (e) { setSuggestedPrompts([]); }
  };

  const detectPptxIntent = async (conversationHistory) => {
    if (conversationHistory.length < 2) return;
    try {
      const recentMessages = conversationHistory.slice(-8).map(m => `${m.role}: ${m.content.substring(0, 400)}`).join('\n');
      const response = await anthropicMessagesPost({
        system: `${pptxPrompts.intentDetection}${buildUserSettingsPromptBlock(userSettings)}`,
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

  /** Append mandatory user preferences/context to any system prompt. */
  const withUserSettings = (system) => `${system || ''}${buildUserSettingsPromptBlock(userSettings)}`;

  const saveUserSettings = async (next) => {
    const settings = { ...DEFAULT_USER_SETTINGS, ...(next || userSettings) };
    const doc = buildUserSettingsDocument(currentUser.id, settings);
    setUserSettings(settings);
    setUserSettingsSaveStatus('saving');
    try {
      localStorage.setItem(userSettingsLocalKey(currentUser.id), JSON.stringify(doc));
    } catch { /* private mode / quota — continue to cloud */ }
    try {
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const { error } = await supabase.storage
        .from('intelligence')
        .upload(userSettingsRemotePath(currentUser.id), blob, { upsert: true, contentType: 'application/json' });
      if (error) throw error;
      setUserSettingsSaveStatus('saved');
      setTimeout(() => setUserSettingsSaveStatus('idle'), 3000);
    } catch {
      setUserSettingsSaveStatus('saved-local');
      setTimeout(() => setUserSettingsSaveStatus('idle'), 4000);
    }
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
      const storagePath = userPptxTemplateRemotePath(currentUser.id);
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
    const path = userSettings.pptxTemplate?.storagePath || userPptxTemplateRemotePath(currentUser.id);
    try {
      await supabase.storage.from('intelligence').remove([path]);
    } catch { /* ignore missing file */ }
    await saveUserSettings({ ...userSettings, pptxTemplate: null });
    setPptxTemplateError('');
    setPptxTemplateStatus('idle');
  };

  const buildAgentKnowledge = (agent) => {
    if (!agent.knowledgeFiles) return '';
    return documents
      .filter(d => agent.knowledgeFiles.includes(d.id) && d.status === 'active' && d.content)
      .map(d => `## ${d.name}\n${d.content}`)
      .join('\n\n');
  };

  const runAgent = async (agent, step, messages) => {
    const knowledge = buildAgentKnowledge(agent);
    const system = withUserSettings(`${agent.systemPrompt}
${knowledge ? `\n\nKNOWLEDGE BASE:\n${knowledge}` : ''}

YOUR CURRENT TASK:
Step ${step.step}: ${step.name}
Goal: ${step.goal}
Success criteria: ${step.successCriteria}

If you still need information from the user, ask clear questions and wait — do not claim the step is finished.
Use ## headers, tables, **bold**, and emoji (✅❌⚠️🎯📊) in your response.`);
    return await callAnthropic(system, messages, 3000);
  };

  /** True when the agent is clearly waiting on the user (questions / clarification). */
  const agentResponseAwaitsUser = (text) => {
    if (!text) return false;
    const t = String(text);
    const qMarks = (t.match(/\?/g) || []).length;
    if (qMarks >= 2) return true;
    if (/(?:^|\n)\s*(?:\d+[\.\)]\s+|[-*•]\s+).{0,120}\?/m.test(t) && qMarks >= 1) return true;
    if (qMarks >= 1 && /\b(please (tell|confirm|clarify|provide|answer|share)|could you|can you|would you|let me know|before (we|I) (proceed|continue)|need (a few|more|the following)|clarif(?:y|ication)|which of the following|how many|what (is|are) (the|your))\b/i.test(t)) {
      return true;
    }
    return false;
  };

  const orchestratorEvaluate = async (topic, step, agentResponse, workflowContext) => {
    const orch = topic.orchestrator;
    const stepList = topic.workflow.map(s => `Step ${s.step} (index ${s.step - 1}): ${s.name} — agent: ${s.agents[0]}`).join('\n');
    const system = withUserSettings(`${orch.role}
Overall goal: ${orch.goal}
${orch.approach ? `\nApproach rules:\n${orch.approach}` : ''}

Workflow steps:
${stepList}

Respond in JSON only:
{
  "agentStillWorking": true/false,
  "stepComplete": true/false,
  "reason": "brief internal reason",
  "rerouteToStep": null,
  "rerouteBriefing": "",
  "handoffs": [],
  "buttons": [{ "label": "...", "action": "...", "requiresInput": false, "inputPrompt": "" }],
  "orchestratorMessage": "",
  "workflowComplete": false
}

CRITICAL — waiting on the user:
- If the agent asked the user any clarifying/open questions, or is clearly waiting for answers, set agentStillWorking=true, stepComplete=false, orchestratorMessage="", buttons=[].
- Do NOT say the stage is finished and do NOT offer Continue/Proceed while questions are unanswered.
- Only set agentStillWorking=false when the agent has produced a substantive deliverable for this step's success criteria AND is not asking the user for more input.

If agentStillWorking is true, set orchestratorMessage to "" and buttons to [].
When agentStillWorking is false, write orchestratorMessage and 2-4 buttons (include at least one "proceed" and one "refine/revisit" path).`);

    const contextStr = workflowContext.map(c => `[${c.step}] ${c.agent}: ${c.output.substring(0, 300)}`).join('\n\n');
    const userContent = `Workflow: ${topic.name}
Step ${step.step}/${topic.workflow.length}: ${step.name}
Success criteria: ${step.successCriteria}

Agent response:
${agentResponse.substring(0, 2000)}

Previous context:
${contextStr || 'None'}

Reminder: if the agent response contains unanswered questions for the user, agentStillWorking must be true.`;

    const raw = await callAnthropic(system, [{ role: 'user', content: userContent }], 1200);
    try {
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (agentResponseAwaitsUser(agentResponse)) {
        return {
          ...parsed,
          agentStillWorking: true,
          stepComplete: false,
          buttons: [],
          orchestratorMessage: '',
          workflowComplete: false,
        };
      }
      return parsed;
    } catch {
      if (agentResponseAwaitsUser(agentResponse)) {
        return {
          agentStillWorking: true, stepComplete: false, rerouteToStep: null, rerouteBriefing: '', handoffs: [],
          buttons: [], orchestratorMessage: '', workflowComplete: false,
        };
      }
      return {
        agentStillWorking: false, stepComplete: false, rerouteToStep: null, rerouteBriefing: '', handoffs: [],
        buttons: [{ label: '✅ Continue', action: 'proceed', requiresInput: false, inputPrompt: '' }, { label: '✏️ Refine', action: 'refine', requiresInput: true, inputPrompt: 'What would you like to refine?' }],
        orchestratorMessage: 'The agent has completed its work. How would you like to proceed?',
        workflowComplete: false
      };
    }
  };

  const executeHandoff = async (agentId, task) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent || agent.status !== 'active') return null;
    const knowledge = buildAgentKnowledge(agent);
    const system = withUserSettings(`${agent.systemPrompt}
${knowledge ? `\n\nKNOWLEDGE BASE:\n${knowledge}` : ''}
You have been assigned a specific sub-task by the workflow orchestrator.`);
    return await callAnthropic(system, [{ role: 'user', content: task }], 2000);
  };

  const executeOrchestrator = async (topic, userMessage, stepIndex = null) => {
    const currentStep = stepIndex !== null ? stepIndex : (currentWorkflow?.currentStep || 0);
    const workflowContext = currentWorkflow?.context || [];
    const isIntro = currentStep === 0 && workflowContext.length === 0;

    if (isIntro) {
      logActivity('orchestrator', `Starting workflow: ${topic.name}`);
      const firstAgent = agents.find(a => a.id === topic.workflow[0].agents[0]);
      const isFocused = !!currentWorkflow?.focusedContext;
      const stepCount = topic.workflow.length;
      const stepsBlock = topic.workflow
        .map((s) => `**Step ${s.step}: ${s.name}** — ${s.goal}`)
        .join('\n');
      const introSystem = withUserSettings(`${topic.orchestrator.role}
${isFocused
  ? `The user has already selected a specific territory. Keep your introduction to 1 sentence. Do NOT list workflow steps — they are appended separately.`
  : `Introduce yourself briefly (1-2 sentences) and state the overall goal. Do NOT list the workflow steps yourself — they are appended separately from the plan. Keep it short.`
}`);
      const introLead = await callAnthropic(
        introSystem,
        [{ role: 'user', content: `The user wants to: ${userMessage}\n\nOverall orchestrator goal: ${topic.orchestrator.goal}` }],
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
        await runWorkflowStep(topic, 0, userMessage, []);
        setIsLoading(false);
      }, 800);
      return;
    }
    await runWorkflowStep(topic, currentStep, userMessage, workflowContext);
  };

  const launchWorkflowDirect = async (topicId, userMessage, focusedContext = null) => {
    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;
    setIsLoading(true);
    setPptxOffers(null);
    setCurrentWorkflow({ topicId: topic.id, currentStep: 0, context: [], waitingForUser: false, focusedContext });
    setPendingWorkflow(null);
    logActivity('workflow', `Direct launch: ${topic.name}`);
    await executeOrchestrator(topic, userMessage, 0);
    setIsLoading(false);
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
    try {
      const priorMessages = currentWorkflow?.stepMessages || [];
      const fullMessages = [...priorMessages, { role: 'user', content: userReply }];
      const agentResponse = await runAgent(agent, step, fullMessages);
      setMessages(prev => [...prev, { role: 'assistant', content: `**[${agent.name}]**\n\n${agentResponse}` }]);
      const updatedStepMessages = [...fullMessages, { role: 'assistant', content: agentResponse }];
      logActivity('orchestrator', `Evaluating Step ${stepIndex + 1} after user reply`);
      const evaluation = await orchestratorEvaluate(topic, step, agentResponse, workflowContext);

      if (evaluation.agentStillWorking) {
        setOrchestratorDecision(null);
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
      const updatedContext = [...workflowContext, { step: `Step ${step.step}: ${step.name}`, agent: agent.name, output: agentResponse.substring(0, 800), handoffs: handoffOutputs }];
      if (evaluation.workflowComplete) {
        if (evaluation.orchestratorMessage) setMessages(prev => [...prev, { role: 'orchestrator', content: evaluation.orchestratorMessage }]);
        await wrapUpWorkflow(topic, updatedContext);
        return;
      }
      postOrchestratorDecision(evaluation, topic, stepIndex, updatedContext, userReply);
      setCurrentWorkflow(prev => prev ? {
        ...prev,
        currentStep: stepIndex,
        context: updatedContext,
        waitingForUser: true,
        awaitingAgentReply: false,
        stepMessages: updatedStepMessages,
      } : null);
      setIsLoading(false);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', content: `⚠️ Error: ${err.message}` }]);
      setIsLoading(false);
    }
  };

  const postOrchestratorDecision = (evaluation, topic, stepIndex, updatedContext, userMessage) => {
    if (evaluation.agentStillWorking) {
      setOrchestratorDecision(null);
      return;
    }
    if (evaluation.orchestratorMessage) setMessages(prev => [...prev, { role: 'orchestrator', content: evaluation.orchestratorMessage }]);
    const buttons = evaluation.buttons || [];
    if (buttons.length > 0) {
      setOrchestratorDecision({ buttons, topic, stepIndex, context: updatedContext, userMessage, rerouteToStep: evaluation.rerouteToStep, rerouteBriefing: evaluation.rerouteBriefing });
    }
  };

  const handleOrchestratorAction = async (action, decision, typedInput = null) => {
    setOrchestratorDecision(null);
    setIsLoading(true);
    const { topic, stepIndex, context, userMessage, rerouteToStep, rerouteBriefing } = decision;
    const effectiveInput = typedInput || userMessage;
    if (action === 'proceed') {
      setCurrentWorkflow(prev => prev ? { ...prev, waitingForUser: false, stepMessages: [] } : null);
      await advanceToNextStep(topic, stepIndex, context, effectiveInput);
    } else if (action === 'redesign' || action === 'send_back') {
      const targetIdx = (rerouteToStep !== null && rerouteToStep !== undefined) ? rerouteToStep : stepIndex - 1;
      const targetStep = topic.workflow[targetIdx];
      const targetAgent = agents.find(a => a.id === targetStep?.agents[0]);
      setMessages(prev => [...prev, { role: 'orchestrator', content: `🔄 Routing back to **${targetStep?.name}** (${targetAgent?.name}) for rework.` }]);
      setCurrentWorkflow(prev => prev ? { ...prev, currentStep: targetIdx, context, waitingForUser: false, stepMessages: [] } : null);
      await runWorkflowStep(topic, targetIdx, rerouteBriefing || effectiveInput, context);
    } else if (action === 'override') {
      setMessages(prev => [...prev, { role: 'orchestrator', content: `⚠️ Override accepted. Proceeding with noted risks.` }]);
      setCurrentWorkflow(prev => prev ? { ...prev, waitingForUser: false, stepMessages: [] } : null);
      await advanceToNextStep(topic, stepIndex, context, effectiveInput);
    } else {
      const briefing = typedInput || `User instruction: ${action}. Please refine your work accordingly.`;
      setCurrentWorkflow(prev => prev ? { ...prev, currentStep: stepIndex, waitingForUser: false, stepMessages: [] } : null);
      await runWorkflowStep(topic, stepIndex, briefing, context);
    }
    setIsLoading(false);
  };

  const advanceToNextStep = async (topic, completedStepIndex, updatedContext, userMessage) => {
    const nextStep = completedStepIndex + 1;
    if (nextStep < topic.workflow.length) {
      setCurrentWorkflow(prev => prev ? { ...prev, currentStep: nextStep, context: updatedContext, waitingForUser: false, stepMessages: [] } : null);
      setTimeout(async () => {
        setIsLoading(true);
        await runWorkflowStep(topic, nextStep, userMessage, updatedContext);
        setIsLoading(false);
      }, 800);
    } else {
      await wrapUpWorkflow(topic, updatedContext);
    }
  };

  const wrapUpWorkflow = async (topic, updatedContext) => {
    const wrapSystem = withUserSettings(`${topic.orchestrator.role}\nThe workflow is now complete. Write a brief, warm closing summary (3-5 sentences) covering what was accomplished.`);
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

  const runWorkflowStep = async (topic, stepIndex, userMessage, workflowContext) => {
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
      const isStructureStep = stepIndex === 0;
      const focusedContext = currentWorkflow?.focusedContext || null;
      if (isTerritoryWorkflow && isStructureStep && territoryStructures.length > 0) {
        const activeStruct = territoryStructures.find(s => s.id === selectedTerritoryStructure) || territoryStructures[0];
        if (focusedContext) {
          taskBriefing = `${focusedContext}\n\nINSTRUCTION: The user wants to assess the FOCUS TERRITORY marked above. Begin by presenting a brief profile then ask what specific aspects the user wants to explore.`;
        } else {
          const structSummary = `LOADED TERRITORY STRUCTURE: "${activeStruct.name}"\nManagers: ${activeStruct.managers.map(m => `${m.name} (${m.region})`).join(', ')}\nTerritories (${activeStruct.territories.length} total):\n${activeStruct.territories.slice(0, 20).map(t => `  ${t.id} ${t.name} | Rep: ${t.rep} | HCPs: A=${t.hcps.A} B=${t.hcps.B} C=${t.hcps.C} Total=${t.hcps.A+t.hcps.B+t.hcps.C}`).join('\n')}`;
          taskBriefing = `${structSummary}\n\nUser request: ${userMessage}\n\nAsk: (1) Use this structure or provide a different one? (2) Cover all territories or focus on specific region?`;
        }
      } else if (workflowContext.length > 0) {
        const contextSummary = workflowContext.map(c => `[${c.step}] ${c.agent}: ${c.output}`).join('\n\n');
        const briefingSystem = withUserSettings(`${topic.orchestrator.role}\nPrepare a focused task briefing for the next specialist agent. Be specific and concise (3-5 sentences max).`);
        const briefingPrompt = `Context from prior steps:\n${contextSummary}\n\nNext agent: ${agent.name}\nTask: Step ${step.step} - ${step.name}\nGoal: ${step.goal}\nUser's message: ${userMessage}\n\nWrite the briefing.`;
        taskBriefing = await callAnthropic(briefingSystem, [{ role: 'user', content: briefingPrompt }], 300);
      }
      const initialMessages = [{ role: 'user', content: taskBriefing }];
      logActivity('agent', `Running ${agent.name}`);
      const agentResponse = await runAgent(agent, step, initialMessages);
      setMessages(prev => [...prev, { role: 'assistant', content: `**[${agent.name}]**\n\n${agentResponse}` }]);
      const initialStepMessages = [...initialMessages, { role: 'assistant', content: agentResponse }];
      const handoffMatches = [...agentResponse.matchAll(/REQUIRES_HANDOFF:\s*(\S+)\s*-\s*(.+)/gi)];
      const agentHandoffs = handoffMatches.map(m => ({ agentId: m[1], task: m[2] }));
      logActivity('orchestrator', `Evaluating Step ${stepIndex + 1}`);
      const evaluation = await orchestratorEvaluate(topic, step, agentResponse, workflowContext);

      if (evaluation.agentStillWorking) {
        setOrchestratorDecision(null);
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
      const updatedContext = [...workflowContext, { step: `Step ${step.step}: ${step.name}`, agent: agent.name, output: agentResponse.substring(0, 800), handoffs: handoffOutputs }];
      if (evaluation.workflowComplete) {
        if (evaluation.orchestratorMessage) setMessages(prev => [...prev, { role: 'orchestrator', content: evaluation.orchestratorMessage }]);
        await wrapUpWorkflow(topic, updatedContext);
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
        stepMessages: initialStepMessages,
      } : null);
      setIsLoading(false);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', content: `⚠️ Orchestrator error: ${err.message}` }]);
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setUploadedFile(file);
    const fileType = file.type.includes('pdf') ? 'PDF' : file.type.includes('presentation') || file.type.includes('powerpoint') ? 'PowerPoint' : 'document';
    setMessages(prev => [...prev, { role: 'system', content: `📎 File uploaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)\n\nAnalyzing this ${fileType} incentive scheme proposal...` }]);
    setTimeout(() => {
      const analysisPrompt = `Please provide a comprehensive assessment of the uploaded incentive scheme document "${file.name}". Evaluate it against the 6 Fundamental Axes.`;
      handleSubmit(null, analysisPrompt, true);
    }, 800);
    event.target.value = '';
  };

  // ── SUPABASE: Upload intelligence files ──
  const handleAdminFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const isYaml = file.name.endsWith('.yml') || file.name.endsWith('.yaml');
    console.log('Uploading to Supabase:', file.name, supabase); // ADD THIS LINE
    // Upload to Supabase storage
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
      const content = e.target.result;
      const newDoc = {
        id: Date.now(),
        name: file.name,
        type: isYaml ? 'yaml' : file.type,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        status: 'active',
        content: content
      };
      setDocuments(prev => [...prev, newDoc]);
      if (isYaml) {
        const pillarMatch = content.match(/pillar_name:\s*["']([^"']+)["']/);
        const pillarName = pillarMatch ? pillarMatch[1] : file.name;
        setKnowledgeBase(prev => prev + `\n\n## ${pillarName} (from ${file.name})\n${content.substring(0, 5000)}`);
        setMessages(prev => [...prev, { role: 'system', content: `✅ Uploaded and saved to cloud: ${file.name}` }]);
      } else {
        setKnowledgeBase(prev => prev + `\n\n## Document: ${file.name}\n${content.substring(0, 10000)}`);
        setMessages(prev => [...prev, { role: 'system', content: `✅ Uploaded and saved to cloud: ${file.name}` }]);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // ── SUPABASE: Delete intelligence files ──
  const removeDocument = async (id) => {
    const doc = documents.find(d => d.id === id);
    if (doc && doc.id !== 1 && doc.id !== 2) {
      await supabase.storage.from('intelligence').remove([doc.name]);
    }
    setDocuments(prev => prev.filter(d => d.id !== id));
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
    const system = withUserSettings(`You are a data onboarding assistant.\n\nReturn ONLY valid JSON. No markdown.\nSchema:\n{\n  "summary": "2-5 sentences describing what this dataset appears to be",\n  "columns": [{ "name": "exact column name", "description": "what this column represents" }],\n  "suggestedQuestions": ["3-5 clarifying questions"]\n}\n\nIf column names are provided, describe each of them. If none are provided (e.g. a PDF or free text), return an empty columns array. Be precise. If unsure, say what you can infer and what is missing.\n\nCRITICAL — do NOT ask questions whose answers are already observable in the DATA PROFILE below (row counts, number of distinct territories/reps/products, column names, value ranges). You can see those directly; state them in the summary instead. Only suggest questions about MEANING and INTENT that cannot be derived from the data: what the dataset represents, the exact business meaning/units of ambiguous columns (e.g. does "rev" mean gross or net revenue in GBP?), the time period, definitions, filters, and caveats.`);
    const colText = columns.length ? `\n\nDETECTED COLUMNS:\n${columns.map(c => `- ${c.name}`).join('\n')}` : '';
    const profileText = profile ? `\n\nDATA PROFILE (observable facts — DO NOT ask about these):\n${profile}` : '';
    const user = `FILE:\n- name: ${name}\n- type: ${type}${colText}${profileText}\n\nCONTENT SAMPLE (may be truncated):\n${textSample}`;
    const raw = await callAnthropic(system, [{ role: 'user', content: user }], 1000);
    const parsed = extractJsonObject(raw);
    return parsed && typeof parsed === 'object' ? parsed : { summary: 'Uploaded dataset.', columns: [], suggestedQuestions: ['What does this data represent?', 'What time period does it cover?', 'Which metrics matter most?', 'Any definitions or filters to apply?'] };
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

    const system = withUserSettings(`You are the Stella Insights data intake agent. Your job is to capture the interpretive context that lets an analyst understand this ${isDoc ? 'document' : 'dataset'} correctly.

Ask ONE focused question per turn. Ask 3-5 questions in total across turns, covering:
- what the ${isDoc ? 'document contains / represents' : 'data represents'}
- the time period it covers
- the key metrics / important fields and EXACTLY what they mean (e.g. a column "rev" = actual revenue in GBP)
- how the data should be interpreted (definitions, filters, caveats)${(!isDoc && otherTabular.length) ? '\n- whether/how it relates to other uploaded datasets (propose the link in plain English for the user to confirm)' : ''}

CRITICAL — NEVER ask about facts that are already visible in the DATA PROFILE below. You can directly see the row count, the number of distinct territories/reps/products, the column names, and value ranges — so do NOT ask "how many territories are there?" or similar. State what you observe, and only ask about MEANING, business intent, units, definitions, time period, and caveats that the raw data cannot reveal.${!isDoc && f.dataProfile ? `\n\nDATA PROFILE (observable facts — DO NOT ask about these):\n${f.dataProfile}` : ''}

When you have enough, set "complete": true and fill "context_qa" fully.

Return ONLY valid JSON — no markdown fences, no prose outside the JSON.
Schema:
{
  "complete": true | false,
  "message": "the single next question to ask (when complete=false) OR a one-line confirmation (when complete=true)",
  "context_qa": {
    "what_it_represents": "",
    "time_period": "",
    "key_metrics": ["", ""],
    "interpretation_notes": "",
    "qa_pairs": [{"question": "", "answer": ""}],
    "relationships": [{"related_file": "other file name", "related_table": "its table name if known", "this_field": "column in THIS dataset", "related_field": "column in the other dataset", "note": "plain-English description the user confirmed"}]
  }
}
When complete=false set "context_qa" to null. When complete=true "qa_pairs" MUST list every question you asked and the user's answer, and "relationships" MUST only contain links the user explicitly confirmed (empty array if none).${relationshipGuidance}`);

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

    return withUserSettings(`You are Stella Insights — an agentic Commercial Excellence data analyst. You investigate the user's data using tools (for tabular data) and document reading (for PDFs/text), verify your findings, and explain them clearly.

${bizText}
DATA CATALOG (${files.length} file${files.length === 1 ? '' : 's'}):
${blocks || '(no files uploaded yet)'}
${sqlInstr}${docInstr}${crossInstr}
HOW TO WORK (be agentic):
1. PLAN — briefly think through what the question needs: which tables, which documents, and how they relate.
2. INSPECT — for tabular data, use \`inspect_table\` to preview real values. For documents, use \`read_document\` to access full text when the summary isn't enough.
3. EXECUTE — run analytical queries with \`run_sql\` for tabular data; use \`read_document\` for document content.
4. VERIFY — sanity-check: do results make sense? do document facts and numbers align? If a query returns nothing or looks wrong, diagnose and try again.
5. ANSWER — only when confident, give the final plain-English answer.

NARRATE YOUR THINKING (important for transparency):
Before EVERY tool call, write 1-2 short sentences of plain text explaining what you are about to do and WHY (e.g. "I'll first inspect the sales table to see how revenue is formatted." or "The engagement data looks like it links to sales by territory, so I'll join them."). After you see tool results, briefly note what you found and what it means before your next step (e.g. "Found 12 territories; three are missing targets, I'll exclude those."). This running commentary is shown to the user, so make your reasoning, checks, and discoveries visible at each step — never call a tool silently.

RULES:
- Prefer tools over assumptions. Never invent values, table names, or column names.
- Use the interpretive context to read values correctly (currency, units, definitions).
- If the data genuinely can't answer the question, say so plainly and suggest what's needed.
- NEVER expose raw SQL or raw JSON to the user — only clear findings.

SQL DIALECT (PostgreSQL — follow exactly to avoid errors):
- Columns marked [numeric] are already PostgreSQL \`numeric\` — do NOT cast them to FLOAT or DOUBLE PRECISION.
- ROUND(value, decimals) only works on \`numeric\`. NEVER round a float/double. If you ever need to round a computed/divided value, cast to numeric FIRST: \`ROUND((a::numeric / NULLIF(b,0)), 2)\`. Never write \`ROUND(x::float, 2)\` or \`ROUND(CAST(x AS FLOAT), 2)\` — that errors with "function round(double precision, integer) does not exist".
- For division that should yield decimals, cast the numerator to numeric and guard against divide-by-zero: \`(SUM(x)::numeric / NULLIF(COUNT(*),0))\`.
- Columns marked [text] that hold numbers must be cast with \`::numeric\` (not \`::float\`) before maths.
- If a query errors, read the error message, fix the specific cast/function, and retry — don't repeat the same failing SQL.

CHARTS:
When a chart helps, include exactly ONE chart block in your FINAL answer, EXACTLY like this:
\`\`\`chart-stella
{"type": "bar", "title": "...", "data": [{"label": "A", "value": 10}], "xKey": "label", "yKey": "value"}
\`\`\`
- Simple types: bar, line, scatter, pie. Use xKey / yKey to name fields. For several bars/lines of the same kind use "yKeys": ["a","b"].
- COMBO / DUAL-AXIS (e.g. bars with an overlaid line, or two metrics on different scales): set "type": "combo" and describe each metric in a "series" array. Each series item is {"key": "<field>", "type": "bar" | "line", "axis": "left" | "right", "name": "<label>"}. Put metrics with very different scales on opposite axes.
  Example (revenue bars + attainment % line on a second axis):
  {"type": "combo", "title": "Revenue vs Attainment", "xKey": "territory", "series": [{"key": "revenue", "type": "bar", "axis": "left", "name": "Revenue (£)"}, {"key": "attainment", "type": "line", "axis": "right", "name": "Attainment %"}], "data": [{"territory": "North", "revenue": 120000, "attainment": 92}]}
- Keep to <= 40 data points.

RESPONSE STYLE:
Use ## headers, bullet points, concise explanations, and suggest useful follow-up questions.`);
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
    setMessages(prev => [...prev, { role: 'assistant', content: PPTX_CLARIFY_PROMPT }]);
  };

  const choiceButtons = useMemo(() => {
    if (isLoading || pptxGenerating) return null;
    if (pptxClarifyPending) return PPTX_CLARIFY_OPTIONS;
    if (currentWorkflow || pendingWorkflow || orchestratorDecision) return null;
    const last = [...messages].reverse().find(m => m.role === 'assistant' || m.role === 'orchestrator');
    if (!last?.content) return null;
    // Prefer explicit numbered 1–3 options in the latest prompt
    return extractChoiceOptions(last.content);
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

  const resolvePptxClarificationReply = (messageContent) => {
    const m = String(messageContent || '').toLowerCase().trim();
    if (/^(1|one)\b/.test(m) || /\bsummary\b/.test(m) || /\brecap\b/.test(m)) {
      return { mode: 'summary', offer: { title: 'Session Summary', description: 'Factual recap of this conversation' } };
    }
    if (/^(2|two)\b/.test(m) || /one[\s-]?pager|simple/.test(m)) {
      return { mode: 'produced', offer: { title: 'IC One-Pager', description: 'Simple one-page IC overview', deckType: 'ic_one_pager', hasRealData: true } };
    }
    if (/^(3|three)\b/.test(m) || /full|pack|documentation|comms/.test(m)) {
      return { mode: 'produced', offer: { title: 'IC Documentation Pack', description: 'Full IC documentation from this conversation', deckType: 'ic_doc_pack', hasRealData: true } };
    }
    const classified = classifyPptxRequest(messageContent);
    if (classified?.clear) {
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
    const systemPrompt = withUserSettings(isSummary ? pptxPrompts.summary : pptxPrompts.produced);
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
          system: withUserSettings('Return ONLY a complete valid JSON object for a PowerPoint with a "slides" array. No markdown. Repair/finish the previous truncated JSON using the conversation facts only.'),
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
    setInput('');
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
      const resolved = resolvePptxClarificationReply(messageContent);
      if (resolved?.mode && resolved.offer) {
        setPptxClarifyPending(false);
        setIsLoading(false);
        await handleGeneratePptx(resolved.offer, resolved.mode);
        return;
      }
      setMessages(prev => [...prev, { role: 'assistant', content: `I still need a clear choice.\n\n${PPTX_CLARIFY_PROMPT}` }]);
      setIsLoading(false);
      return;
    }

    setPptxOffers(null);
    setMessages(prev => [...prev, { role: 'user', content: messageContent }]);
    setIsLoading(true);

    if (currentWorkflow) {
      const topic = topics.find(t => t.id === currentWorkflow.topicId);
      if (topic) {
        // Prefer answering the specialist agent when it asked clarifying questions
        if (currentWorkflow.awaitingAgentReply || (currentWorkflow.waitingForUser && !orchestratorDecision)) {
          await continueAgentWithUserReply(topic, currentWorkflow.currentStep, messageContent, currentWorkflow.context || []);
          return;
        }
        if (orchestratorDecision) {
          await handleOrchestratorAction('custom', orchestratorDecision, messageContent);
          return;
        }
        await runWorkflowStep(topic, currentWorkflow.currentStep, messageContent, currentWorkflow.context || []);
        return;
      }
    }

    // Intercept PowerPoint / documentation export requests.
    const pptIntent = classifyPptxRequest(messageContent);
    if (pptIntent) {
      if (pptIntent.clear && pptIntent.mode) {
        setIsLoading(false);
        await handleGeneratePptx(offerFromClassification(pptIntent), pptIntent.mode);
        return;
      }
      setIsLoading(false);
      askPptxClarification();
      return;
    }

    const msg = messageContent.toLowerCase();
    let matchedTopic = topics.find(topic => topic.status === 'active' && topic.triggerKeywords.some(kw => msg.includes(kw.toLowerCase())));

    if (!matchedTopic && topics.length > 0) {
      try {
        const workflowList = topics.filter(t => t.status === 'active').map(t => `id: "${t.id}"\n  name: ${t.name}\n  keywords: ${t.triggerKeywords.join(', ')}`).join('\n\n');
        const detectRes = await anthropicMessagesPost({ system: `You detect if a user message matches one of these workflows. Respond with ONLY the workflow id or "none".\n\nWorkflows:\n${workflowList}`, messages: [{ role: 'user', content: messageContent }], max_tokens: 50 });
        const detectData = await detectRes.json();
        const detectedId = anthropicAssistantText(detectData)?.trim().toLowerCase();
        if (detectedId && detectedId !== 'none') matchedTopic = topics.find(t => t.id === detectedId);
      } catch (error) { /* fallback to normal chat */ }
    }

    if (matchedTopic && !currentWorkflow) {
      const workflowSummary = matchedTopic.workflow.map((s, i) => `**Step ${i + 1}:** ${s.name}\n   _${s.goal}_`).join('\n\n');
      setMessages(prev => [...prev, { role: 'assistant', content: `I can help you with **${matchedTopic.description}**.\n\nI have a structured **${matchedTopic.workflow.length}-step workflow**:\n\n${workflowSummary}\n\nWould you like me to start this workflow?\n\nReply **"Yes"** to use the guided workflow, or **"No"** to continue chatting normally.` }]);
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
      const systemPrompt = withUserSettings(customSystemPrompt
        .replace('KNOWLEDGE BASE:\nYou have access to comprehensive best practices and the complete Pillar 2: Strategic Alignment & Principles framework.',
          'KNOWLEDGE BASE:\nYou have access to comprehensive best practices and the complete Pillar 2: Strategic Alignment & Principles framework.\n\n' + knowledgeBase + '\n\n' + PILLAR_2_KNOWLEDGE)
        + fileContext);

      const response = await anthropicMessagesPost({
        system: systemPrompt,
        messages: [
          ...messages.filter(m => m.role !== 'system').map(m => ({ role: toAnthropicRole(m.role), content: m.content })),
          { role: 'user', content: messageContent }
        ],
        max_tokens: 4000,
      });
      const data = await response.json();
      const assistantMessage = anthropicAssistantText(data);
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
            {!showLanding && (
              <div className="flex gap-1 sm:gap-2 bg-slate-800/50 rounded-lg p-1">
                {[['chat', MessageSquare, 'Consultation'], ['performance', BarChart3, 'Performance'], ['territory', Map, 'Territory'], ['stella', Layers, 'Stella Insights'], ['user-settings', UserCog, 'User Settings'], ['admin', Settings, 'Admin']].map(([tab, Icon, label]) => (
                  <button key={tab} onClick={() => setActiveTab(tab)} className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-md transition-all text-xs sm:text-sm ${activeTab === tab ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}>
                    <Icon className="w-3 h-3 sm:w-4 sm:h-4" /><span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>
            )}
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
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><Map className="w-6 h-6 text-white" /></div>
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
            <div className="flex flex-col h-full">
              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2 mb-3 flex-shrink-0">
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

                {choiceButtons && choiceButtons.length > 0 && !isLoading && !pptxGenerating && (
                  <div className="mb-3">
                    <div className="text-xs text-blue-300/70 mb-2">Choose an option (or type your own):</div>
                    <div className="flex flex-wrap gap-2">
                      {choiceButtons.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={(e) => { e.preventDefault(); setSuggestedPrompts([]); handleSubmit(e, opt.value); }}
                          className="px-3 py-2 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 hover:border-cyan-400/55 rounded-lg text-xs text-cyan-100 font-semibold transition-all hover:scale-105 active:scale-95"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {suggestionsEnabled && suggestedPrompts.length > 0 && !pendingWorkflow && !currentWorkflow && !isLoading && !choiceButtons?.length && (
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
              <input ref={fileInputRef} type="file" accept=".pdf,.ppt,.pptx" onChange={handleFileUpload} className="hidden" />
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
                  <div className="flex items-center gap-3"><Map className="w-6 h-6" /><div><h2 className="text-xl font-bold">Territory Design</h2><p className="text-emerald-100 text-xs">Assess, design and optimise your sales territory structure</p></div></div>
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
                  <button onClick={() => { setActiveTab('admin'); setAdminModule('stella'); setStellaTab('data'); }} className="flex items-center gap-2 px-3 py-2 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-semibold transition-all"><Settings className="w-4 h-4" /> Manage data & context</button>
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
                      <p className="text-blue-100 text-xs sm:text-sm">Preferences and context the AI must respect across Consultation, agents, and Stella.</p>
                    </div>
                  </div>
                  <div className="text-right text-xs text-blue-100/80">
                    <div className="font-semibold text-white">{currentUser.name}</div>
                    <div className="font-mono text-blue-200/70">userId: {currentUser.id}</div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-5 sm:p-6">
                <p className="text-xs text-blue-300/70 mb-5">
                  Saved per user as JSON in this browser and Supabase storage (
                  <code className="text-cyan-300/80">{userSettingsRemotePath(currentUser.id)}</code>
                  ). The document includes <code className="text-cyan-300/80">userId</code> so multiple users can coexist; swap the hardcoded login for real auth later without changing this shape.
                </p>

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
                      placeholder={"e.g. Prefer 3–5 plan components\nKeep responses concise with tables\nAlways show weightings as %"}
                      className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-blue-300/70 font-semibold mb-2">Hard constraints</label>
                    <textarea
                      value={userSettings.constraints}
                      onChange={(e) => setUserSettings(prev => ({ ...prev, constraints: e.target.value }))}
                      rows={3}
                      placeholder={"e.g. Must comply with ABPI\nNo individual SPIFs\nTeam component < 20%"}
                      className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-blue-300/70 font-semibold mb-2">Additional context</label>
                    <textarea
                      value={userSettings.customContext}
                      onChange={(e) => setUserSettings(prev => ({ ...prev, customContext: e.target.value }))}
                      rows={4}
                      placeholder="Anything else the AI should always know — org structure notes, product portfolio, historical scheme quirks, etc."
                      className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y"
                    />
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-blue-400/15">
                  <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">📊 PowerPoint template</h3>
                  <p className="text-xs text-blue-300/60 mb-4">
                    Upload a branded .pptx. Exports use its background, colours, fonts and shading — then choose a layout per slide based on the content (cards, table, process, two-column, etc.), not a clone of every template slide. Without a template, ComEx uses its built-in default style. Stored at{' '}
                    <code className="text-cyan-300/80">{userPptxTemplateRemotePath(currentUser.id)}</code>.
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
                </div>

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
                      const path = userSettings.pptxTemplate?.storagePath || userPptxTemplateRemotePath(currentUser.id);
                      if (userSettings.pptxTemplate) {
                        try { await supabase.storage.from('intelligence').remove([path]); } catch { /* ignore */ }
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
                    <span className="flex items-center gap-1.5 text-sm text-green-400 font-semibold"><CheckCircle className="w-4 h-4" /> Saved (browser + Supabase)</span>
                  )}
                  {userSettingsSaveStatus === 'saved-local' && (
                    <span className="flex items-center gap-1.5 text-sm text-amber-300 font-semibold"><CheckCircle className="w-4 h-4" /> Saved locally (cloud sync unavailable)</span>
                  )}
                  {userSettingsSaveStatus === 'error' && (
                    <span className="flex items-center gap-1.5 text-sm text-red-400 font-semibold"><AlertTriangle className="w-4 h-4" /> Save failed</span>
                  )}
                </div>
              </div>
            </div>

          ) : (
            // ADMIN
            <div className="space-y-4 sm:space-y-6 overflow-y-auto h-full custom-scrollbar pr-1 sm:pr-2">
              <div className="flex gap-2 pb-1 overflow-x-auto">
                {[{ id: 'incentive', label: 'Incentive Comp' }, { id: 'territory', label: 'Territory' }, { id: 'stella', label: 'Stella Insights' }].map(m => (
                  <button key={m.id} onClick={() => setAdminModule(m.id)} className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${adminModule === m.id ? 'bg-white/15 text-white border border-white/20' : 'bg-slate-800/40 text-blue-300/70 hover:bg-slate-700/50'}`}>{m.label}</button>
                ))}
              </div>

              {adminModule === 'incentive' && (
              <>
              <div className="flex gap-2 border-b border-blue-400/20 pb-3 overflow-x-auto">
                {[{ id: 'knowledge', label: 'Knowledge' }, { id: 'workflows', label: 'Workflows' }, { id: 'agents', label: 'Agents' }, { id: 'system-prompt', label: 'Prompt' }, { id: 'pptx', label: '📊 PPT Prompts' }, { id: 'settings', label: 'Settings' }].map(tab => (
                  <button key={tab.id} onClick={() => setAdminSection(tab.id)} className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${adminSection === tab.id ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white' : 'bg-slate-700/30 text-blue-300 hover:bg-slate-700/50'}`}>{tab.label}</button>
                ))}
              </div>

              {adminSection === 'knowledge' && (
                <>
                  <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><FileText className="w-6 h-6 text-blue-400" />Knowledge Base Management</h2>
                    <p className="text-sm text-blue-300/70 mb-6">Upload intelligence files. They are saved to Supabase and loaded automatically on every visit.</p>
                    <div className="space-y-3 mb-6">
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
                            {doc.id !== 1 && doc.id !== 2 && (
                              <button onClick={() => removeDocument(doc.id)} className="p-2 hover:bg-red-500/20 rounded transition-colors text-red-400"><Trash2 className="w-4 h-4" /></button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => adminFileInputRef.current?.click()} className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"><Plus className="w-5 h-5" />Upload Intelligence File</button>
                    <p className="text-xs text-blue-300/50 text-center mt-2">Supports: .yml, .yaml, .txt, .md files • Saved to Supabase cloud storage</p>
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
                          <button onClick={() => setTopics(prev => prev.map(t => t.id === topic.id ? { ...t, status: t.status === 'active' ? 'inactive' : 'active' } : t))} className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${topic.status === 'active' ? 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border border-yellow-400/30' : 'bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-400/30'}`}>{topic.status === 'active' ? 'Disable' : 'Enable'}</button>
                          <button onClick={() => { setEditingTopic({...topic}); setExpandedSteps({}); }} className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-400/30">Edit</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {adminSection === 'system-prompt' && (
                <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                  <h2 className="text-xl font-bold mb-2 flex items-center gap-2"><FileText className="w-6 h-6 text-blue-400" />System Prompt Configuration</h2>
                  <textarea value={customSystemPrompt} onChange={(e) => setCustomSystemPrompt(e.target.value)} rows={24} className="w-full bg-slate-950 border border-blue-400/30 rounded-lg px-4 py-3 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-cyan-400/60 resize-y" spellCheck={false} />
                  <div className="flex gap-3 mt-4">
                    <button onClick={() => { navigator.clipboard.writeText(customSystemPrompt); alert('Copied!'); }} className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-400/30 rounded-lg text-sm font-semibold transition-all">Copy</button>
                    <button onClick={() => { if (window.confirm('Reset to default?')) setCustomSystemPrompt(DEFAULT_SYSTEM_PROMPT); }} className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-400/30 rounded-lg text-sm font-semibold transition-all">Reset to Default</button>
                  </div>
                </div>
              )}

              {adminSection === 'pptx' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-white">PowerPoint Generation Prompts</h3>
                  {[['intentDetection', '🔍 Intent Detection', 'Decides when to offer a PowerPoint export.'], ['summary', '📋 Session Summary Prompt', 'Used when generating a summary deck.'], ['produced', '📄 Produced Document Prompt', 'Used when generating a working document.']].map(([key, title, desc]) => (
                    <div key={key} className="bg-slate-800/40 border border-blue-400/20 rounded-xl p-4">
                      <div className="text-sm font-semibold text-white mb-1">{title}</div>
                      <p className="text-xs text-blue-300/50 mb-3">{desc}</p>
                      <textarea value={pptxPrompts[key]} onChange={e => setPptxPrompts(prev => ({ ...prev, [key]: e.target.value }))} rows={8} className="w-full bg-slate-900/60 text-blue-100 text-xs rounded-lg p-3 border border-blue-400/20 focus:border-blue-400/50 focus:outline-none font-mono resize-y" />
                    </div>
                  ))}
                </div>
              )}

              {adminSection === 'settings' && (
                <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Settings className="w-6 h-6 text-yellow-400" />Settings</h2>
                  <div className="bg-slate-900/50 border border-blue-400/20 rounded-lg p-5">
                    <h3 className="text-lg font-semibold text-yellow-400 mb-4">AI Suggestions</h3>
                    <div className="flex items-center justify-between mb-4">
                      <div><label className="text-sm font-semibold text-white">Enable Suggestions</label><p className="text-xs text-blue-300/70 mt-1">Show AI-generated prompts after each response</p></div>
                      <button onClick={() => setSuggestionsEnabled(!suggestionsEnabled)} className={`relative w-14 h-7 rounded-full transition-colors ${suggestionsEnabled ? 'bg-green-500' : 'bg-slate-600'}`}><div className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${suggestionsEnabled ? 'translate-x-7' : 'translate-x-0'}`} /></button>
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-white block mb-2">Number of Suggestions: {maxSuggestions}</label>
                      <input type="range" min="1" max="5" value={maxSuggestions} onChange={(e) => setMaxSuggestions(parseInt(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                  </div>
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
                    </div>
                    <div className="border-t border-blue-400/20 p-6 flex gap-3 bg-slate-900 rounded-b-xl">
                      <button onClick={() => { setAgents(agents.map(a => a.id === editingAgent.id ? editingAgent : a)); setEditingAgent(null); }} className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"><Save className="w-5 h-5" /> Save Changes</button>
                      <button onClick={() => setEditingAgent(null)} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              {editingTopic && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
                  <div className="bg-slate-900 border border-blue-400/20 rounded-xl max-w-4xl w-full my-8">
                    <div className="sticky top-0 bg-slate-900 border-b border-blue-400/20 p-6 flex items-center justify-between z-10 rounded-t-xl">
                      <h2 className="text-xl font-bold">Edit Workflow: {editingTopic.name}</h2>
                      <button onClick={() => setEditingTopic(null)} className="text-blue-300 hover:text-white transition-colors"><X className="w-6 h-6" /></button>
                    </div>
                    <div className="p-6 space-y-6">
                      <div><label className="block text-sm font-semibold mb-2">Workflow Name</label><input type="text" value={editingTopic.name} onChange={(e) => setEditingTopic({...editingTopic, name: e.target.value})} className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white" /></div>
                      <div><label className="block text-sm font-semibold mb-2">Description</label><textarea value={editingTopic.description} onChange={(e) => setEditingTopic({...editingTopic, description: e.target.value})} rows={3} className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white" /></div>
                      <div><label className="block text-sm font-semibold mb-2">Trigger Keywords (comma-separated)</label><input type="text" value={editingTopic.triggerKeywords?.join(', ') || ''} onChange={(e) => setEditingTopic({ ...editingTopic, triggerKeywords: e.target.value.split(',').map(k => k.trim()).filter(k => k) })} className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white text-sm" /></div>
                      <div className="border-t border-blue-400/20 pt-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-cyan-400">Workflow Steps</h3>
                          <button onClick={() => { const newStep = { step: editingTopic.workflow.length + 1, name: 'New Step', agents: [], goal: '', successCriteria: '' }; setEditingTopic({ ...editingTopic, workflow: [...editingTopic.workflow, newStep] }); }} className="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg text-xs flex items-center gap-1 border border-green-400/30"><Plus className="w-3 h-3" />Add Step</button>
                        </div>
                        <div className="space-y-3">
                          {editingTopic.workflow?.map((step, index) => {
                            const stepKey = `${editingTopic.id}-${index}`;
                            const isExpanded = expandedSteps[stepKey] || false;
                            return (
                              <div key={index} className="bg-slate-800 border border-blue-400/20 rounded-lg">
                                <div className="p-4">
                                  <div className="flex items-center gap-3">
                                    <button onClick={() => setExpandedSteps({...expandedSteps, [stepKey]: !isExpanded})} className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0 hover:bg-blue-500/30 transition-colors">{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
                                    <span className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-sm flex-shrink-0">{step.step}</span>
                                    <div className="flex-1"><div className="text-white font-medium">{step.name}</div></div>
                                    <button onClick={() => { const newWorkflow = editingTopic.workflow.filter((_, i) => i !== index); newWorkflow.forEach((s, i) => s.step = i + 1); setEditingTopic({ ...editingTopic, workflow: newWorkflow }); }} className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
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
                      </div>
                    </div>
                    <div className="border-t border-blue-400/20 p-6 flex gap-3 bg-slate-900 rounded-b-xl">
                      <button onClick={() => { setTopics(topics.map(t => t.id === editingTopic.id ? editingTopic : t)); setEditingTopic(null); }} className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"><CheckCircle className="w-5 h-5" />Save Changes</button>
                      <button onClick={() => setEditingTopic(null)} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">Cancel</button>
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
                    {[{ id: 'data', label: 'Data' }, { id: 'business', label: 'Business Context' }, { id: 'connections', label: 'Connections' }].map(tab => (
                      <button key={tab.id} onClick={() => setStellaTab(tab.id)} className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${stellaTab === tab.id ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white' : 'bg-slate-700/30 text-blue-300 hover:bg-slate-700/50'}`}>{tab.label}</button>
                    ))}
                  </div>
                  {(stellaTab === 'data' || stellaTab === 'chat') && renderStellaDataPanel()}
                  {stellaTab === 'business' && renderStellaBusinessPanel()}
                  {stellaTab === 'connections' && renderStellaConnectionsPanel()}
                </div>
              )}
            </div>
          )}
          </MessageErrorBoundary>
        </div>
      )}
    </div>
  );
}
