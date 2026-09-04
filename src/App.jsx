import { useState, useRef, useEffect, useMemo, lazy, Suspense, Component } from 'react';
import { createPortal } from 'react-dom';
import { Send, Upload, FileText, Settings, MessageSquare, CheckCircle, AlertTriangle, TrendingUp, Users, Target, Award, X, Plus, Trash2, BarChart3, DollarSign, Calendar, ChevronDown, ChevronRight, Save, Map as MapIcon, MapPin, Layers, UserCog, History, LogOut, Link2, Maximize2, Minimize2, Undo2, Sparkles, Clock, Play } from 'lucide-react';
import ExcelExportButton from './ExcelExportButton';
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
  userChatsIndexRemotePath,
  chatsIndexLocalKey,
  userSettingsRemotePathCandidates,
  userJsonRemotePathCandidates,
  userStorageFolder,
  userPptxTemplateRemotePath,
  userProposalRemotePath,
  userStellaStoragePrefix,
  productIntelligenceLocalKey,
  productIntelligenceRemotePath,
  authHeaders,
} from './auth';
import {
  resolveUserCompany,
  companyPgSchema,
} from './company';
import {
  STELLA_CONNECTORS,
  STELLA_SCHEDULE_FREQUENCIES,
  mergeStellaBusinessContext,
  mergeStellaConnections,
  stellaBusinessContextIsEmpty,
  liftStellaGenericIntoUserSettings,
  stellaOrgIdForUser,
  stellaOrgIdCandidates,
  stellaInboxSchedule,
} from './stellaUserSettings';
import {
  MEMORY_HARVEST_SYSTEM,
  MEMORY_BACKFILL_SYSTEM,
  normalizeMemoryItems,
  mergeMemoryFacts,
  formatMemoryPromptBlock,
  shouldHarvestChatMemory,
  parseMemoryFacts,
  parseMemoryHarvest,
  parseJsonArray,
  compactChatsForMemory,
  memoryBackfillNeeded,
  buildHarvestExchange,
  buildBackfillExchange,
  isMemoryEnabled,
  memorySignature,
  applyMemoryConfirmation,
  factsAreSimilar,
  factsAreExclusiveConflict,
  isMemoryEnrichmentFact,
  activeMemoryItems,
  formatMemoryStamp,
  describeObsoleteReason,
  memoryUsage,
  filterMemoryFacts,
  isDurableMemoryFact,
  isExplicitRememberRequest,
  isFileOrIntakeMemoryFact,
  stripFileIntakeFromMemory,
  userAssertsIdentityReplacement,
} from './chatMemory';
import { extractPptxThemeFromFile, themeToSettingsMeta, getPptxGeneratorThemeFromUserSettings, loadFullPptxStyleForGeneration, applyPptxLayout, renderSlideFromTheme } from './pptxTheme';
import { DEFAULT_PPTX_CONTEXT, getPptxContext, mergePptxContext } from './defaultPptxContext';
import AdminUsers from './AdminUsers';
import ContextMap from './ContextMap';
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
  mergeKnowledgeAccess,
  knowledgeFileFlags,
  filterKnowledgeDocuments,
  WORKFLOW_BUILDER_WELCOME,
  WORKFLOW_BUILDER_WELCOME_EDIT,
  buildWorkflowBuilderCatalog,
  buildWorkflowBuilderSystemPrompt,
  interpretWorkflowBuilderReply,
  applyWorkflowBuilderDraft,
  summarizeWorkflowDraft,
  slugifyId,
  normalizeTriggerMode,
  triggerModeLabel,
  workflowAllowsKeywordTrigger,
  workflowAllowsContextTrigger,
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
  formatLinkedModulesPromptBlock,
  formatStellaFileIndex,
  formatStellaFileContextCard,
  formatModuleContextCard,
  findStellaFile,
  findHubContextFile,
  listHubContextFiles,
  mergeModuleConnections,
  toggleModuleConnection,
  connectedModuleIds,
  connectedComponentIds,
  modulesAreConnected,
  MODULE_CONTEXT_LABELS,
  isThinContextExtract,
  knowledgeStemPattern,
  isEmptyContextValue,
  compactCapturedContext,
  harvestModuleCapturedContext,
  intakePairFact,
  contextFileExtractBlob,
} from './moduleContext';
import {
  inferTerritoryLayout,
  mergeTerritoryLayout,
  normalizeMapLayout,
  buildTerritoryPointsMapHTML,
  hashTerritoryColour,
  formatTerritoryAssessContext,
  scoreTerritorySheet,
} from './territoryGeo';

// Recharts is loaded lazily so it can never affect initial page load.
const StellaChart = lazy(() => import('./StellaChart'));

const STELLA_QUERY_API_PATH = '/api/stella-query';
const STELLA_FILES_API_PATH = '/api/stella-files';
const STELLA_SYNC_API_PATH = '/api/stella-sync';
const TERRITORY_API_PATH = '/api/territory';

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
  if (p.length < 16 || p.length > 160) return false;
  if (looksLikeIntelligenceRef(p, extraNames)) return false;
  if (/^\s*[1-9]\s*[=:).\-]/.test(p)) return false;
  if (/^(yes|no|y|n|ok|okay|option\s*[a-d1-9])\b/i.test(p)) return false;
  if (looksLikeInfoRequest(p)) return false;
  if (/\?/.test(p) && looksLikeInfoRequest(p)) return false;
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

function toAnthropicHistory(messages) {
  const out = [];
  for (const m of messages || []) {
    const role = m.role === 'assistant' ? 'assistant' : (m.role === 'user' ? 'user' : null);
    if (!role) continue;
    const content = String(m.content || '').trim();
    if (!content) continue;
    if (!out.length && role === 'assistant') continue;
    if (out.length && out[out.length - 1].role === role) {
      out[out.length - 1] = { role, content: `${out[out.length - 1].content}\n\n${content}` };
    } else {
      out.push({ role, content });
    }
  }
  return out;
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

function intakeChatLooksLikeJson(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.startsWith('{') || t.startsWith('[') || /^```(?:json)?/i.test(t)) return true;
  if (/"complete"\s*:/.test(t) && (/"context_qa"\s*:/.test(t) || /"key_facts"\s*:/.test(t))) return true;
  if (/"what_it_represents"\s*:/.test(t) && /"key_facts"\s*:/.test(t)) return true;
  return false;
}

function stripJsonFromIntakeMessage(text) {
  let t = String(text || '').trim();
  t = t.replace(/```json[\s\S]*?```/gi, '').trim();
  const appended = t.search(/\n\s*\{/);
  if (appended !== -1 && /"complete"\s*:|"context_qa"\s*:|"key_facts"\s*:|"qa_pairs"\s*:/.test(t.slice(appended))) {
    t = t.slice(0, appended).trim();
  }
  return intakeChatLooksLikeJson(t) ? '' : t;
}

/** Visible intake chat must never be the model's JSON payload. */
function humanIntakeAssistantLine(parsed, raw, fallback) {
  const field = parsed?.message;
  const fromField = typeof field === 'string' ? field : '';
  const stripped = stripJsonFromIntakeMessage(fromField);
  if (stripped) return stripped;
  const strippedRaw = stripJsonFromIntakeMessage(raw);
  if (strippedRaw) return strippedRaw;
  return String(fallback || '').trim();
}

function displayIntakeChatContent(content, { complete, fileName, moduleLabel } = {}) {
  const raw = String(content || '');
  const stripped = stripJsonFromIntakeMessage(raw);
  if (stripped) return stripped;
  if (!intakeChatLooksLikeJson(raw)) return raw;
  return complete
    ? contextFileAddedConfirm(fileName, moduleLabel)
    : 'I have a few clarifying questions — please reply below.';
}

function pickIntakeContextQa(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const qa = parsed.context_qa;
  if (qa && typeof qa === 'object' && !Array.isArray(qa)) return qa;
  if (parsed.key_facts || parsed.what_it_represents || parsed.qa_pairs || parsed.key_metrics || parsed.time_period) {
    const { complete: _c, message: _m, context_qa: _qa, ...rest } = parsed;
    return rest;
  }
  return null;
}

function contextFileAddedConfirm(fileName, moduleLabel) {
  const name = String(fileName || 'this file').trim() || 'this file';
  const where = String(moduleLabel || 'module').trim() || 'module';
  return `Thanks — **${name}** is now added to ${where} context.`;
}

function parseContextSummaryResponse(raw) {
  const parsed = extractJsonObject(raw);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  const facts = [];
  const match = String(raw || '').match(/"key_facts"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
  if (match) {
    for (const item of match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)) {
      const t = item[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();
      if (t) facts.push(t);
    }
  }
  if (!facts.length) return null;
  return { summary: '', what_it_represents: '', time_period: '', key_facts: facts, key_metrics: [], suggestedQuestions: [] };
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
  if (rounded <= 1) return 1;
  if (rounded === 2) return 2;
  // New 3-stop slider: 3 = Teaching. Legacy 5-stop: 4–5 = Teaching.
  if (rounded >= 3) return 3;
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
  return `RESPONSE LENGTH — MATCH THIS LEVEL STRICTLY for every reply the user reads: free chat, Stella, workflow specialist steps, orchestrator intro/wrap-up, and agent handoffs.
The three levels are different kinds of reply, not small length tweaks. Do not drift toward a generic mid-length answer.
1 Executive = verdict + table/icon bullets (no how, no why). 2 Standard = what + how + a short because (no example walkthrough). 3 Teaching = explain: why it matters, impact, and a concrete example.
RICH FORMAT AT EVERY LEVEL, including Executive: markdown tables for numbers/comparisons, emoji icons (✅ ⚠️ 🎯 📊) on key points, **bold** on the decision and figures. Short does not mean plain text — keep it scannable and clean, with no extra prose.
Never omit a needed fact, number, question, or recommendation to hit a word target — cut explanation, not substance.

Current setting: ${level.value} of ${RESPONSE_LENGTH_MAX} — ${level.label}.
${level.instruction}

This is the hub-wide default. EXCEPTION: if this role, workflow step, or task specifies an explicit length (for example "300 words", "max 5 sentences"), follow that specification exactly — do not expand it to Teaching or shrink it to Executive. Vague "keep short" without a number still follows this setting. Numbered clarifying questions stay compact. Do not apply this to exported PowerPoint/document content, structured JSON, classification, extraction, or schema-only tasks; those must follow their specified format and stay compact.`;
}

/** Final-word reminder so workflow agents do not ignore the slider — unless the task itself sets a word/length cap. */
function formatResponseLengthOverride(settings) {
  const level = getResponseLengthLevel(settings);
  return `USER ANSWER DETAIL (mandatory for this reply unless the role/step specifies an explicit length such as "300 words"): ${level.label} — ${level.value} of ${RESPONSE_LENGTH_MAX}.
Write the user-visible output at this level only. Ignore vague "keep SHORT" / "full pack" length hints in your role. If this task specifies a word count, sentence cap, or similar, follow that instead. Clarifying-question lists stay short. JSON, extraction, and classification stay compact and complete.`;
}

/** True when a role/step/task sets its own length (word count etc.) — that beats the hub slider. */
function systemHasExplicitLengthSpec(text) {
  const stripped = String(text || '')
    .replace(/USER ANSWER DETAIL[\s\S]{0,500}/gi, ' ')
    .replace(/Match USER ANSWER DETAIL[\s\S]{0,400}/gi, ' ')
    .replace(/RESPONSE LENGTH[\s\S]{0,1200}/gi, ' ');
  return /\b\d{2,4}\s*words?\b/i.test(stripped)
    || /\b(no more than|not more than|at most|maximum of|max(?:imum)?|up to|exactly)\s+\d{1,3}\s*(sentences?|paragraphs?|bullets?)\b/i.test(stripped)
    || /\bkeep (this |your |the )?(answer|response|summary|output|write-?up) (to|under|below) \d/i.test(stripped);
}

function resolveUserFacingMaxTokens(base, settings, systemText = '') {
  if (systemHasExplicitLengthSpec(systemText)) {
    const match = String(systemText || '').match(/\b(\d{2,4})\s*words?\b/i);
    if (match) {
      const words = Number(match[1]);
      if (Number.isFinite(words) && words > 0) {
        return Math.max(500, Math.min(8192, Math.round(words * 1.7) + 250));
      }
    }
    return Math.max(500, Math.min(8192, Math.round(Number(base) || 1600)));
  }
  return scaleUserFacingMaxTokens(base, settings);
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
  memoryEnabled: true,
  responseLength: 'standard',
  moduleContext: mergeModuleContext({}),
  moduleConnections: [],
  // { fileName, uploadedAt, storagePath, theme: { schemeName, colors, fonts, ... } } — content ignored; style only
  pptxTemplate: null,
  stellaBusinessContext: mergeStellaBusinessContext({}),
  stellaConnections: mergeStellaConnections({}),
  contextMapLayout: { nodes: {} },
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
  if (!(src.agents || src.topics || src.systemPrompt || src.workflowRuntime || src.stellaPrompts || src.pptxContext || src.knowledgeAccess)) {
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
    memoryEnabled: src.memoryEnabled !== false,
    responseLength: storedResponseLength(src.responseLength),
    moduleContext: mergeModuleContext(src.moduleContext),
    moduleConnections: mergeModuleConnections(src.moduleConnections),
    pptxTemplate: src.pptxTemplate || null,
    stellaBusinessContext: mergeStellaBusinessContext(src.stellaBusinessContext),
    stellaConnections: mergeStellaConnections(src.stellaConnections),
    contextMapLayout: (src.contextMapLayout && typeof src.contextMapLayout === 'object')
      ? { nodes: src.contextMapLayout.nodes && typeof src.contextMapLayout.nodes === 'object' ? src.contextMapLayout.nodes : {} }
      : { nodes: {} },
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

/** Titles and dates only — what the hub page needs to render Recent chats. */
function buildUserChatsIndexDocument(userId, { chats = [], activeChatId = null, userName = '' } = {}) {
  const doc = {
    userId,
    updatedAt: new Date().toISOString(),
    activeChatId: activeChatId || null,
    chats: (chats || []).slice(0, MAX_STORED_CHATS).map((c) => ({
      id: c.id,
      title: c.title || deriveChatTitle(c.messages),
      createdAt: c.createdAt || createdAtFromChatId(c.id) || null,
      updatedAt: c.updatedAt || null,
      module: c.module || inferChatModule(c),
      hasWorkflow: !!(c.currentWorkflow || c.hasWorkflow),
      hasUserContent: c.hasUserContent === true || chatHasUserContent(c.messages),
    })).filter((c) => c.id && c.hasUserContent),
  };
  if (userName) doc.userName = userName;
  return doc;
}

function userJsonRemotePath(user, file) {
  if (file === 'chats.json') return userChatsRemotePath(user);
  if (file === 'chats-index.json') return userChatsIndexRemotePath(user);
  return userSettingsRemotePath(user);
}

async function uploadUserJsonDirect(user, doc, file = 'settings.json') {
  const path = userJsonRemotePath(user, file);
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
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
    if (res.status === 404 || res.status >= 500) {
      await uploadUserJsonDirect(user, doc, file);
      return;
    }
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || `Could not save ${file} (${res.status})`);
  } catch (err) {
    if (err?.name === 'TypeError' || /failed to fetch|not reachable|502/i.test(String(err?.message || ''))) {
      await uploadUserJsonDirect(user, doc, file);
      return;
    }
    throw err;
  }
}

async function downloadUserJsonDocument(user, file = 'settings.json') {
  const q = new URLSearchParams({
    userId: String(user?.id || ''),
    userName: String(user?.name || ''),
    file,
  });
  const isChatsFile = file === 'chats.json' || file === 'chats-index.json';
  let apiDoc = null;
  try {
    const res = await fetch(`/api/user-settings?${q}`);
    if (res.ok) {
      const payload = await res.json();
      apiDoc = payload?.document && typeof payload.document === 'object'
        ? payload.document
        : (payload && typeof payload === 'object' && !payload.error ? payload : null);
    } else if (res.status === 404) {
      apiDoc = null;
    } else if (res.status < 500) {
      const data = await res.json().catch(() => ({}));
      const message = data?.error?.message || `Could not load ${file} (${res.status})`;
      if (/object not found/i.test(message)) apiDoc = null;
      else throw new Error(message);
    }
  } catch (err) {
    if (err?.message && /Could not load /i.test(err.message)) throw err;
  }
  if (apiDoc && (!isChatsFile || storedChatCount(apiDoc) > 0)) return apiDoc;

  const pickRicher = (current, next) => {
    if (!next || typeof next !== 'object') return current;
    if (!current) return next;
    return storedChatCount(next) > storedChatCount(current) ? next : current;
  };

  let best = apiDoc;
  for (const candidate of userJsonRemotePathCandidates(user, file)) {
    try {
      const { data, error } = await supabase.storage.from('intelligence').download(candidate);
      if (error || !data) continue;
      const parsed = safeJsonParse(await data.text());
      if (!parsed || typeof parsed !== 'object') continue;
      if (!isChatsFile) return parsed;
      best = pickRicher(best, parsed);
    } catch { /* try next path */ }
  }
  if (isChatsFile && file === 'chats-index.json' && storedChatCount(best) === 0) {
    for (const candidate of userJsonRemotePathCandidates(user, 'chats.json')) {
      try {
        const { data, error } = await supabase.storage.from('intelligence').download(candidate);
        if (error || !data) continue;
        const parsed = safeJsonParse(await data.text());
        if (storedChatCount(parsed) > storedChatCount(best)) {
          best = buildUserChatsIndexDocument(parsed.userId, parsed);
        }
      } catch { /* try next path */ }
    }
  }
  return best;
}

function storedChatCount(parsed) {
  if (!parsed || typeof parsed !== 'object') return 0;
  const chats = parsed.chats || parsed.settings?.chats;
  return Array.isArray(chats) ? chats.filter((c) => c && c.id).length : 0;
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
  const buildChats = () => (typeof docOrBuilder === 'function' ? docOrBuilder() : docOrBuilder);
  queueUserJsonUpload(user, 'chats-index.json', () => {
    const doc = buildChats() || {};
    const cached = readCachedChatIndex(user?.id);
    const chats = unionChats(doc.chats, cached.chats);
    const index = buildUserChatsIndexDocument(doc.userId, { ...doc, chats });
    writeCachedChatIndex(user?.id, index);
    return index;
  });
  return queueUserJsonUpload(user, 'chats.json', buildChats);
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
  incentives: {
    id: 'incentives',
    label: 'Incentive Compensation',
    tab: 'chat',
    badge: 'bg-sky-500/35 text-sky-50 border-sky-200/55',
    accent: 'border-l-sky-400',
    bar: 'bg-sky-400',
  },
  territory: {
    id: 'territory',
    label: 'Territory Design',
    tab: 'territory',
    badge: 'bg-emerald-500/35 text-emerald-50 border-emerald-200/55',
    accent: 'border-l-emerald-400',
    bar: 'bg-emerald-400',
  },
  stella: {
    id: 'stella',
    label: 'Stella Insights',
    tab: 'stella',
    badge: 'bg-cyan-400/35 text-cyan-50 border-cyan-100/60',
    accent: 'border-l-cyan-300',
    bar: 'bg-cyan-300',
  },
};

const ACTIVE_HUB_MODULES = [
  {
    id: 'incentives',
    tab: 'chat',
    settingsPane: 'incentives',
    title: 'Incentive Compensation',
    short: 'Incentives',
    desc: 'Design, assess and optimise sales incentive schemes.',
    Icon: DollarSign,
    fill: '#38bdf8',
    angle: (5 * Math.PI) / 6,
    ring: 'border-blue-400/30 hover:border-blue-400/60',
    shadow: 'hover:shadow-blue-500/10',
    iconBg: 'bg-gradient-to-br from-blue-500 to-cyan-500',
  },
  {
    id: 'territory',
    tab: 'territory',
    settingsPane: 'territory',
    title: 'Territory Design',
    short: 'Territory',
    desc: 'Assess and optimise territory structures.',
    Icon: MapIcon,
    fill: '#34d399',
    angle: -Math.PI / 2,
    ring: 'border-emerald-400/30 hover:border-emerald-400/60',
    shadow: 'hover:shadow-emerald-500/10',
    iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-500',
  },
  {
    id: 'stella',
    tab: 'stella',
    settingsPane: 'stella',
    title: 'Stella Insights',
    short: 'Stella',
    desc: 'Chat with your data, run analysis and generate charts.',
    Icon: Layers,
    fill: '#22d3ee',
    angle: Math.PI / 6,
    ring: 'border-cyan-400/30 hover:border-cyan-400/60',
    shadow: 'hover:shadow-cyan-500/10',
    iconBg: 'bg-gradient-to-br from-cyan-500 to-blue-500',
    goalsKey: 'keyGoals',
    dataFiles: true,
  },
];

function inferChatModule({ currentWorkflow } = {}) {
  const topic = String(currentWorkflow?.topicId || '');
  if (topic.includes('territory')) return 'territory';
  if (topic.includes('stella')) return 'stella';
  return 'incentives';
}

function chatModuleMeta(chat) {
  return CHAT_MODULE_META[chat?.module] || CHAT_MODULE_META.incentives;
}

function chatModuleBadge(chatOrMeta) {
  const mod = chatOrMeta?.label ? chatOrMeta : chatModuleMeta(chatOrMeta);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium tracking-wide border ${mod.badge}`}>
      {mod.label}
    </span>
  );
}

function upsertChatInPlace(list, snap) {
  const arr = [...(list || [])];
  const i = arr.findIndex((c) => c.id === snap.id);
  if (i >= 0) arr[i] = { ...arr[i], ...snap, module: snap.module || arr[i].module || 'incentives' };
  else arr.unshift(snap);
  return arr.slice(0, MAX_STORED_CHATS);
}

function chatIsListed(c) {
  if (!c?.id) return false;
  if (c.hasUserContent === false) return false;
  if (c.hasUserContent === true) return true;
  return chatHasUserContent(c.messages);
}

function recentChats(list) {
  return (list || [])
    .filter(chatIsListed)
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, MAX_VISIBLE_CHATS);
}

function sidebarChats(list) {
  return (list || [])
    .filter(chatIsListed)
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, MAX_STORED_CHATS);
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

function chatMessageCount(c) {
  return Array.isArray(c?.messages) ? c.messages.length : 0;
}

function preferRicherChat(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const aMsgs = chatMessageCount(a);
  const bMsgs = chatMessageCount(b);
  const richer = aMsgs >= bMsgs ? a : b;
  const other = richer === a ? b : a;
  const aT = String(a.updatedAt || '');
  const bT = String(b.updatedAt || '');
  const titleA = String(a.title || '').trim();
  const titleB = String(b.title || '').trim();
  const genericTitle = (t) => !t || t === 'New chat' || t === 'Chat';
  const title = !genericTitle(titleA) && (genericTitle(titleB) || aMsgs >= bMsgs)
    ? titleA
    : (!genericTitle(titleB) ? titleB : (titleA || titleB));
  return {
    ...other,
    ...richer,
    title: title || richer.title || other.title,
    createdAt: richer.createdAt || other.createdAt,
    updatedAt: aT >= bT ? (a.updatedAt || b.updatedAt) : (b.updatedAt || a.updatedAt),
    hasUserContent: a.hasUserContent === true || b.hasUserContent === true
      || chatHasUserContent(a.messages)
      || chatHasUserContent(b.messages),
    messages: aMsgs >= bMsgs ? (a.messages || []) : (b.messages || []),
    currentWorkflow: richer.currentWorkflow || other.currentWorkflow || null,
    module: richer.module || other.module,
  };
}

function unionChats(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const c of list || []) {
      if (!c?.id) continue;
      byId.set(c.id, preferRicherChat(c, byId.get(c.id)));
    }
  }
  return [...byId.values()]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, MAX_STORED_CHATS);
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
  if (m.kind) out.kind = m.kind;
  if (Array.isArray(m.steps) && m.steps.length) {
    out.steps = m.steps.slice(0, 16).map((s) => ({
      type: s.type || '',
      label: s.label || '',
      detail: String(s.detail || '').slice(0, 800),
      resultCount: s.resultCount,
    }));
  }
  return out;
}

function serializeChatSnapshot({ id, title, updatedAt, createdAt, messages, currentWorkflow, pendingWorkflow, uploadedFile, module, workflowRuns, previousMessages }) {
  const cid = id || newChatId();
  const now = new Date().toISOString();
  const list = messages || [];
  const prevLen = Array.isArray(previousMessages) ? previousMessages.length : 0;
  const sliced = list.slice(-MAX_STORED_MESSAGES);
  const slicedOffset = Math.max(0, list.length - sliced.length);
  const safeMessages = sliced.map((m, i) => (
    sanitizeMessageForStorage(m, { stampNow: !m?.at && (slicedOffset + i) >= prevLen })
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
    workflowRuns: Array.isArray(workflowRuns) ? workflowRuns.slice(-20) : [],
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

function normalizeChatIndexEntries(raw) {
  const chats = Array.isArray(raw?.chats) ? raw.chats : (Array.isArray(raw) ? raw : []);
  return chats.filter((c) => c && c.id).slice(0, MAX_STORED_CHATS).map((c) => ({
    id: c.id,
    title: c.title || deriveChatTitle(c.messages) || 'Chat',
    createdAt: c.createdAt || createdAtFromChatId(c.id) || '',
    updatedAt: c.updatedAt || '',
    module: c.module || inferChatModule(c),
    hasWorkflow: !!(c.hasWorkflow || c.currentWorkflow),
    hasUserContent: c.hasUserContent !== false,
    currentWorkflow: c.currentWorkflow || null,
    messages: Array.isArray(c.messages) ? c.messages : [],
    messagesLoaded: Array.isArray(c.messages) && c.messages.length > 0,
  }));
}

function extractChatIndexFromDocument(parsed) {
  if (!parsed || typeof parsed !== 'object') return { chats: [], activeChatId: null };
  if (Array.isArray(parsed.chats) && parsed.chats.some((c) => Array.isArray(c?.messages) && c.messages.length)) {
    const full = extractChatsFromDocument(parsed);
    return {
      chats: normalizeChatIndexEntries(buildUserChatsIndexDocument(parsed.userId, full)),
      activeChatId: full.activeChatId,
    };
  }
  return {
    chats: normalizeChatIndexEntries(parsed),
    activeChatId: parsed.activeChatId || null,
  };
}

function writeCachedChatIndex(userId, index) {
  try {
    const chats = normalizeChatIndexEntries(index);
    if (!chats.length) return;
    localStorage.setItem(chatsIndexLocalKey(userId), JSON.stringify({
      updatedAt: index?.updatedAt || new Date().toISOString(),
      activeChatId: index?.activeChatId || null,
      chats,
    }));
  } catch { /* quota / private mode */ }
}

function readCachedChatIndex(userId) {
  try {
    const parsed = safeJsonParse(localStorage.getItem(chatsIndexLocalKey(userId)));
    if (!parsed || typeof parsed !== 'object') return { chats: [], activeChatId: null };
    return {
      chats: normalizeChatIndexEntries(parsed),
      activeChatId: parsed.activeChatId || null,
    };
  } catch {
    return { chats: [], activeChatId: null };
  }
}

function consultationWelcome() {
  try {
    const text = readLocalProductIntelligence()?.welcomeMessages?.consultation;
    return { role: 'assistant', content: text || 'How can I help?' };
  } catch {
    return { role: 'assistant', content: 'How can I help?' };
  }
}

function stellaWelcome() {
  try {
    const text = readLocalProductIntelligence()?.welcomeMessages?.stella;
    return { role: 'assistant', content: text || 'Ask a question about your uploaded datasets.' };
  } catch {
    return { role: 'assistant', content: 'Ask a question about your uploaded datasets.' };
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
  const source = String(text);
  const tail = source.length > 1400 ? source.slice(-1400) : source;
  const numberedQs = [...tail.matchAll(/(?:^|\n)\s*(?:\*\*)?([1-9])(?:\*\*)?\s*[.:)\]]\s+.+\?/gm)];
  return numberedQs.length >= 1;
}

function pendingWorkflowId(pending) {
  if (!pending) return '';
  if (typeof pending === 'string') return pending;
  return String(pending.topicId || pending.id || '');
}

function matchTopicByTriggers(topics, message) {
  const msg = String(message || '').toLowerCase();
  if (msg.length < 8) return null;
  for (const topic of topics || []) {
    if (topic.status !== 'active') continue;
    if (!workflowAllowsKeywordTrigger(topic)) continue;
    const kws = Array.isArray(topic.triggerKeywords) ? topic.triggerKeywords : [];
    const matchedKeywords = kws
      .map((kw) => String(kw || '').trim())
      .filter((k) => k.length >= 4 && msg.includes(k.toLowerCase()));
    if (matchedKeywords.length) return { topic, matchedKeywords };
  }
  return null;
}

function buildWorkflowTriggerRecord({ trigger, phrase, message, reason } = {}) {
  const t = String(trigger || '').trim();
  const p = String(phrase || '').trim();
  const msg = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const why = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  let triggerReason = '';
  if (t === 'keyword') triggerReason = p ? `Keyword / phrase: “${p}”` : 'Keyword / phrase match';
  else if (t === 'context') triggerReason = why ? `Conversation context: ${why}` : 'Conversation context';
  else if (t === 'file') triggerReason = msg ? `File upload — ${msg}` : 'File upload';
  else if (t === 'direct') triggerReason = msg ? `Started from UI — ${msg}` : 'Started from UI';
  else triggerReason = why || msg || (t ? `Trigger: ${t}` : 'Trigger not recorded');
  return {
    trigger: t,
    triggerPhrase: p,
    triggerReason,
    triggerText: msg,
  };
}

function isWorkflowAccept(text) {
  const t = String(text || '').trim();
  return /^(y|yes|yeah|yep|sure|ok|okay|start)([\s.!,'"]|$)/i.test(t)
    || /\b(start (the )?workflow|yes,? start)\b/i.test(t);
}

function isWorkflowDecline(text) {
  const t = String(text || '').trim();
  return /^(n|no|nope|nah|cancel)([\s.!,'"]|$)/i.test(t)
    || /\b(just chat|don'?t (want|start)|not now|no thanks|no workflow)\b/i.test(t);
}

function isMemoryConfirmAccept(text) {
  const t = String(text || '').trim();
  return /^(y|yes|yeah|yep|sure|ok|okay)([\s.!,'"]*)$/i.test(t)
    || /^(yes[, ]+)?(update|replace)(\s+(it|memory|the fact))?([\s.!,'"]*)$/i.test(t);
}

function isMemoryConfirmDecline(text) {
  const t = String(text || '').trim();
  return /^(n|no|nope|nah)([\s.!,'"]*)$/i.test(t)
    || /^(keep|keep it|keep existing)([\s.!,'"]*)$/i.test(t);
}

function memoryConfirmThreadOf(pending) {
  return pending && pending.thread === 'stella' ? 'stella' : 'chat';
}

function matchConflictingMemory(existingActive, { existingId = '', existingText = '', proposed = '' } = {}) {
  const list = Array.isArray(existingActive) ? existingActive : [];
  const proposedText = String(proposed || '').trim();
  if (proposedText && isMemoryEnrichmentFact(proposedText)) return null;
  if (existingId) {
    const byId = list.find((m) => m.id === existingId);
    if (byId && (!proposedText || byId.text.toLowerCase() !== proposedText.toLowerCase())) {
      if (factsAreExclusiveConflict(byId.text, proposedText)) return byId;
    }
  }
  const named = String(existingText || '').trim();
  if (named) {
    const byNamed = list.find((m) => m.text.toLowerCase() === named.toLowerCase() || factsAreSimilar(m.text, named));
    if (byNamed && (!proposedText || byNamed.text.toLowerCase() !== proposedText.toLowerCase())) {
      if (factsAreExclusiveConflict(byNamed.text, proposedText)) return byNamed;
    }
  }
  if (!proposedText) return null;
  return list.find((m) => (
    m.text.toLowerCase() !== proposedText.toLowerCase()
    && factsAreExclusiveConflict(m.text, proposedText)
  )) || null;
}

function looksLikeMemoryCorrection(text, { force = false } = {}) {
  const t = String(text || '').trim();
  if (t.length > 280) return false;
  if (force) return t.length >= 8;
  if (t.length < 16) return false;
  if (/\?/.test(t)) return false;
  if (/^\d+(\s*[=.].*)?$/.test(t)) return false;
  if (looksLikeInfoRequest(t)) return false;
  if (/^(compare|explain|show|draft|continue|apply|summarise|summarize|walk|list|outline|how |what |why |could |would |should |can |please |let'?s )\b/i.test(t)) return false;
  return true;
}

function userMessageJustifiesMemoryConflict(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isExplicitRememberRequest(t)) return true;
  if (/\?/.test(t)) return false;
  if (looksLikeInfoRequest(t)) return false;
  return looksLikeMemoryCorrection(t) || userAssertsIdentityReplacement(t);
}

function isClosedChoicePrompt(text) {
  const source = String(text || '');
  const tail = source.length > 1400 ? source.slice(-1400) : source;
  return /\b(reply with|choose|select|pick one|which of the following|option [123]|press [123]|tap [123])\b/i.test(tail);
}

function lastConversationalMessage(messages) {
  const list = (Array.isArray(messages) ? messages : []).filter((m) => (
    m && (m.role === 'user' || m.role === 'assistant' || m.role === 'orchestrator')
    && String(m.content || '').trim()
  ));
  return list[list.length - 1] || null;
}

function isAskingForNumberedReplies(text) {
  if (!hasNumberedClarifyingQuestions(text)) return false;
  const source = String(text || '');
  const tail = source.length > 1600 ? source.slice(-1600) : source;
  if (/\b1\s*=|\breply as\s*1\b|\banswers? by number\b/i.test(tail)) return true;
  const numberedQs = [...tail.matchAll(/(?:^|\n)\s*(?:\*\*)?([1-9])(?:\*\*)?\s*[.:)\]]\s+.{8,240}\?/gm)];
  return numberedQs.length >= 2;
}

function unansweredNumberedClarify(messages) {
  const last = lastConversationalMessage(messages);
  if (!last || last.role === 'user') return false;
  return isAskingForNumberedReplies(last.content);
}

function looksLikeInfoRequest(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  return /^(what is your|what's your|which of your|how many|how much|please (provide|share|upload|tell|send)|can you (tell me|share|provide|upload)|could you (tell me|share|provide)|do you have|what('s| is) the (current|actual)|i need (the|your))\b/i.test(t)
    || /\b(please (provide|share|upload)|tell me (your|the missing)|what('s| is) missing)\b/i.test(t);
}

/** Format user preferences into a system-prompt block that all LLMs/agents must respect. */
function buildUserSettingsPromptBlock(settings, { moduleId = '', applyResponseLength = true } = {}) {
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
  const linkedIds = moduleId ? connectedComponentIds(s.moduleConnections, moduleId) : [];
  const memoryBlock = formatMemoryPromptBlock(s, { moduleId, linkedIds });
  const lengthBlock = applyResponseLength ? formatResponseLengthPrompt(s) : '';
  const identity = `${lines.join('\n')}${extra ? `\n\nAdditional context from the user:\n${extra}` : ''}${memoryBlock}`;
  return `\n\nUSER SETTINGS (mandatory — always respect these preferences, definitions, abbreviations, constraints${applyResponseLength ? ', and response length' : ''} in every response; do not contradict them):\n${identity ? `${identity}\n\n` : ''}${lengthBlock}\n`;
}

function stellaNormalizeIntakeQuestions(raw) {
  const list = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' && raw.trim() ? [raw] : []);
  return list
    .map((q) => {
      if (q && typeof q === 'object') {
        return String(q.question || q.text || q.q || '').replace(/\s+/g, ' ').trim();
      }
      return String(q || '').replace(/\s+/g, ' ').trim();
    })
    .filter((q) => q.length >= 8)
    .slice(0, 5);
}

function stellaIntakeQuestionLooksIrrelevant(q) {
  const t = String(q || '').toLowerCase();
  if (!t) return true;
  return /\b(incentive scheme|quota|payout|commission|how should (we|i|stella|an analyst) (analys|interpret|use)|linked to (other )?modules?|connected modules?|stay independent|connect(ed)? to those modules)\b/i.test(t);
}

function contextIntakeQuestionLooksOffTopic(q) {
  const t = String(q || '').toLowerCase();
  if (!t) return true;
  if (stellaIntakeQuestionLooksIrrelevant(q)) return true;
  return /\b(scheme design|salary|variable mix|fixed.?variable|on-target|\bote\b|pay mix|target incentive|how (should|would|do) (we|i|you) (design|structure|set)|which plan, product, or audience|which plan\/product)\b/i.test(t);
}

const CONTEXT_FILE_CONFIRM_QUESTION = 'If any year, product name, figure, or label in this file is still unclear, which one should I treat as the source of truth? Otherwise reply that the capture looks correct.';

function stripOffTopicIntakeQuestions(message) {
  const t = String(message || '').trim();
  if (!t) return t;
  const kept = [];
  for (const line of t.split('\n')) {
    const m = line.match(/^\s*(?:\d+[\.)]|[-*])\s+(.+)$/);
    if (m && contextIntakeQuestionLooksOffTopic(m[1])) continue;
    kept.push(line);
  }
  let n = 1;
  return kept
    .map((line) => {
      if (/^\s*(?:\d+[\.)]|[-*])\s+/.test(line)) {
        const body = line.replace(/^\s*(?:\d+[\.)]|[-*])\s+/, '');
        return `${n++}. ${body}`;
      }
      return line;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function intakeMessageLooksLikeAsk(message) {
  const t = String(message || '').trim();
  if (!t) return false;
  if (/\bnow added to\b/i.test(t) || /\bis now added\b/i.test(t)) return false;
  return /[?？]/.test(t) || /\n\s*1[\.)]\s/.test(t);
}

function isModuleContextCaptured(file) {
  if (!file || file.processing) return false;
  if (file.intakeComplete) return true;
  const msgs = Array.isArray(file.intakeMessages) ? file.intakeMessages : [];
  if (!msgs.some((m) => m.role === 'user')) return false;
  const last = [...msgs].reverse().find((m) => m.role === 'assistant' || m.role === 'user');
  if (!last || last.role === 'user') return false;
  return !intakeMessageLooksLikeAsk(last.content);
}

function pickStellaIntakeQuestions(onboarding) {
  const raw = onboarding && typeof onboarding === 'object' ? onboarding : {};
  return stellaNormalizeIntakeQuestions(
    raw.suggestedQuestions != null ? raw.suggestedQuestions : raw.questions
  ).filter((q) => !stellaIntakeQuestionLooksIrrelevant(q));
}

function stellaEnsureQuestionMark(text) {
  const t = String(text || '').trim();
  if (!t) return t;
  if (/[?？]\s*$/.test(t)) return t;
  return `${t.replace(/[.!]\s*$/, '')}?`;
}

function formatStellaIntakeQuestionList(questions) {
  const list = (questions || []).map((q) => String(q || '').trim()).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  const body = list.map((q, i) => `${i + 1}. ${stellaEnsureQuestionMark(q)}`).join('\n\n');
  return `${body}\n\nReply as 1= … 2= … or answer them together.`;
}

function stellaNormJoinToken(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const STELLA_JOIN_SAMPLE_CAP = 48;
const STELLA_JOIN_SAMPLE_LEN = 80;
/** Rows pulled from Postgres for join/profile samples — hard cap, not “a % of the table”. */
const STELLA_SQL_SAMPLE_ROWS = 64;
/** Max rows scanned in-browser when profiling an upload. Total rowCount is still the full file. */
const STELLA_PROFILE_SCAN_CAP = 2000;

function stellaNormJoinValue(v) {
  return String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, STELLA_JOIN_SAMPLE_LEN);
}

function stellaNormJoinValueKey(v) {
  return stellaNormJoinValue(v).toLowerCase();
}

function stellaJoinValueKeys(v) {
  const raw = stellaNormJoinValueKey(v);
  if (!raw) return [];
  const keys = [raw];
  const compact = raw.replace(/[^a-z0-9]/g, '');
  if (compact && compact !== raw) keys.push(compact);
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = String(Number(raw));
    if (n !== raw && n !== 'NaN') keys.push(n);
  }
  return keys;
}

function stellaLooksLikeDateValue(s) {
  const t = String(s || '').trim();
  if (!t || t.length < 6) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(t)) return true;
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t) && /\d{2,4}/.test(t)) return true;
  return Number.isFinite(Date.parse(t)) && /[-/]/.test(t);
}

function stellaProfileColumnValues(values) {
  const filled = (values || []).filter((v) => v !== null && v !== undefined && v !== '');
  const filledCount = filled.length;
  const allDistinct = new Set();
  const samples = [];
  for (const v of filled) {
    const key = stellaNormJoinValueKey(v);
    if (!key || allDistinct.has(key)) continue;
    allDistinct.add(key);
    if (samples.length < STELLA_JOIN_SAMPLE_CAP) samples.push(stellaNormJoinValue(v));
  }
  const distinctCount = allDistinct.size;
  const strs = filled.map((v) => String(v).trim());
  const nums = strs.map((s) => Number(String(s).replace(/[,\s%£$€]/g, ''))).filter(Number.isFinite);
  const numericRatio = filledCount ? nums.length / filledCount : 0;
  const dateRatio = filledCount ? strs.filter(stellaLooksLikeDateValue).length / filledCount : 0;
  const uniqRatio = filledCount ? distinctCount / filledCount : 0;
  const hasDecimal = strs.some((s) => /\d+\.\d+/.test(s));
  const avgLen = strs.length ? strs.reduce((a, s) => a + s.length, 0) / strs.length : 0;

  let kind = 'text';
  let pattern = '';
  if (!filledCount) {
    kind = 'empty';
  } else if (dateRatio >= 0.7) {
    kind = 'date';
    pattern = 'date';
  } else if (numericRatio >= 0.85) {
    if (hasDecimal || (uniqRatio < 0.55 && distinctCount > 20)) {
      kind = 'measure';
      pattern = 'numeric';
    } else if (uniqRatio >= 0.85 && distinctCount >= 8) {
      kind = 'id';
      pattern = 'numeric-id';
    } else if (distinctCount <= 80) {
      kind = 'code';
      pattern = 'numeric-code';
    } else {
      kind = 'id';
      pattern = 'numeric-id';
    }
  } else if (distinctCount <= 80 && avgLen <= 24) {
    kind = 'code';
    pattern = 'token';
  } else if (avgLen <= 64 && uniqRatio >= 0.7) {
    kind = 'id';
    pattern = 'text-id';
  } else {
    kind = 'name';
    pattern = 'text';
  }

  let cardinality = 'high';
  if (distinctCount <= 12) cardinality = 'low';
  else if (distinctCount <= 80 || uniqRatio < 0.2) cardinality = 'medium';
  else if (uniqRatio >= 0.85) cardinality = 'unique';

  return { samples, distinctCount, filledCount, cardinality, kind, pattern };
}

function stellaApplyRowSampleToColumns(columns, rows) {
  if (!Array.isArray(columns) || !columns.length || !Array.isArray(rows) || !rows.length) return columns;
  return columns.map((c) => {
    if (Array.isArray(c?.samples) && c.samples.length && c.kind) return c;
    const values = rows.map((r) => {
      if (!r || typeof r !== 'object') return undefined;
      if (c.name && r[c.name] !== undefined) return r[c.name];
      if (c.original && r[c.original] !== undefined) return r[c.original];
      return undefined;
    });
    return { ...c, ...stellaProfileColumnValues(values) };
  });
}

function stellaPreviewRowsFromData(rows, limit = 3) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.slice(0, limit).map((r) => {
    if (r && typeof r === 'object' && !Array.isArray(r)) return r;
    return { value: r };
  });
}

function stellaPreviewRowsFromColumns(columns, limit = 3) {
  const cols = Array.isArray(columns) ? columns.filter((c) => c && (c.name || c.original)) : [];
  if (!cols.length) return [];
  const n = Math.min(limit, Math.max(0, ...cols.map((c) => (Array.isArray(c.samples) ? c.samples.length : 0))));
  if (!n) return [];
  return Array.from({ length: n }, (_, i) => {
    const row = {};
    for (const c of cols) {
      const key = c.name || c.original;
      row[key] = Array.isArray(c.samples) ? (c.samples[i] ?? '') : '';
    }
    return row;
  });
}

function stellaFileNeedsValueProfile(file) {
  const cols = Array.isArray(file?.columns) ? file.columns : [];
  if (!file?.tableName || !cols.length) return false;
  return cols.some((c) => !Array.isArray(c?.samples) || !c.samples.length);
}

function stellaColumnJoinMeta(col) {
  const name = String(col?.name || '').trim();
  const original = String(col?.original || '').trim();
  return {
    name,
    original,
    type: col?.type || '',
    description: String(col?.description || '').trim(),
    samples: Array.isArray(col?.samples) ? col.samples.slice(0, STELLA_JOIN_SAMPLE_CAP) : [],
    distinctCount: Number(col?.distinctCount) || 0,
    filledCount: Number(col?.filledCount) || 0,
    cardinality: col?.cardinality || '',
    kind: col?.kind || '',
    pattern: col?.pattern || '',
  };
}

const STELLA_MEASURE_JOIN_TOKENS = /^(value|amount|revenue|rev|sales|qty|quantity|count|actual|target|attainment|percent|pct|score|rate|volume|unit|units|uom|pack|packsize|calls|cost|price|margin|total|sum)$/;
const STELLA_MEASURE_NAME_HINT = /(unit|units|uom|qty|quantity|volume|revenue|amount|sales|packsize|attainment|percent|margin)(s|sold|pack|value|count)?$/;
const STELLA_DATE_JOIN_TOKENS = /^(date|dt|day|month|quarter|qtr|year|yr|week|wk|period|time)$/;
const STELLA_JOIN_FAMILIES = [
  { id: 'territory', tokens: ['territory', 'territories', 'terr', 'geo', 'geography', 'region', 'area', 'brick', 'postcode', 'zipcode', 'zip', 'alignment'] },
  { id: 'product', tokens: ['product', 'products', 'brand', 'sku', 'molecule', 'item'] },
  { id: 'customer', tokens: ['customer', 'account', 'hcp', 'npi', 'prescriber', 'client'] },
  { id: 'rep', tokens: ['rep', 'reps', 'salesperson', 'ae', 'kam', 'employee'] },
  { id: 'specialty', tokens: ['specialty', 'speciality'] },
];
const STELLA_ENTITY_JOIN_FAMILIES = new Set(['territory', 'product', 'customer', 'rep', 'specialty']);
const STELLA_FACT_FILE_KINDS = [
  { id: 'sales', tokens: ['sales', 'sale', 'revenue', 'actuals', 'performance'] },
  { id: 'orders', tokens: ['orders', 'order'] },
  { id: 'transactions', tokens: ['transactions', 'transaction', 'txn'] },
  { id: 'invoices', tokens: ['invoices', 'invoice'] },
  { id: 'calls', tokens: ['calls', 'call', 'activity', 'activities'] },
  { id: 'visits', tokens: ['visits', 'visit'] },
  { id: 'shipments', tokens: ['shipments', 'shipment'] },
  { id: 'claims', tokens: ['claims', 'claim', 'rx', 'prescriptions', 'prescription'] },
  { id: 'engagements', tokens: ['engagements', 'engagement', 'interactions', 'interaction', 'touchpoints', 'touchpoint'] },
];
const STELLA_DIM_FILE_HINTS = new Set([
  'list', 'master', 'lookup', 'reference', 'dim', 'dimension',
  'directory', 'roster', 'catalog', 'catalogue',
]);
const STELLA_FACT_GRAIN_STEMS = new Set([
  'transaction', 'txn', 'trans', 'invoice', 'sale', 'sales', 'order', 'orders',
  'call', 'activity', 'visit', 'shipment', 'claim', 'receipt', 'line', 'record',
  'engagement', 'engagements', 'interaction', 'touchpoint',
]);
const STELLA_FACT_KIND_STEMS = new Set(
  STELLA_FACT_FILE_KINDS.flatMap((k) => k.tokens.map((t) => stellaNormJoinToken(t)).filter((t) => t.length >= 3))
);

function stellaLooksLikePeriodToken(t) {
  const s = String(t || '').toLowerCase();
  if (/^(20\d{2}|19\d{2})$/.test(s)) return true;
  if (/^2[0-9]$/.test(s)) return true;
  if (/^(fy|cy|ye)(20|21|22|23|24|25|26|27|28|29|\d{2})$/.test(s)) return true;
  if (/^q[1-4]$/.test(s) || /^h[12]$/.test(s)) return true;
  return /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|ytd|mtd)$/.test(s);
}

function stellaJoinFamilyFromBlobs(blobs) {
  const list = (blobs || []).filter(Boolean);
  if (list.some((b) => STELLA_MEASURE_JOIN_TOKENS.test(b))) return null;
  if (list.some((b) => STELLA_DATE_JOIN_TOKENS.test(b))) return 'date';
  for (const fam of STELLA_JOIN_FAMILIES) {
    for (const t of fam.tokens) {
      const nt = stellaNormJoinToken(t);
      if (nt.length < 3) continue;
      if (list.some((b) => b === nt || b.includes(nt))) return fam.id;
    }
  }
  return null;
}

function stellaJoinFamily(col) {
  if (col?.kind === 'date') return 'date';
  // Prefer the column name/header. Descriptions often mention other entities
  // and must not reclassify the key.
  const fromName = stellaJoinFamilyFromBlobs([col?.name, col?.original].map(stellaNormJoinToken));
  if (fromName) return fromName;
  return stellaJoinFamilyFromBlobs([col?.description].map(stellaNormJoinToken));
}

function stellaIdStem(col) {
  const t = stellaNormJoinToken(col?.name || col?.original || (typeof col === 'string' ? col : ''));
  if (!t) return '';
  return t.replace(/(uuid|code|key|id)$/g, '');
}

const STELLA_GENERIC_ROW_ID_NAMES = new Set([
  'id', 'pk', 'pkey', 'primarykey', 'index', 'seq', 'sequence',
  'uuid', 'guid', 'uid', 'recordid', 'rowid', 'lineid',
  'rowkey', 'rownum', 'rownumber', 'lineno', 'linenumber',
  'surrogatekey', 'ordinal', 'identity', 'autonumber', 'autoincrement',
  'rowindex', 'key',
]);
const STELLA_GENERIC_ID_STEMS = new Set([
  '', 'id', 'record', 'row', 'line', 'pk', 'pkey', 'index', 'seq', 'sequence',
  'uuid', 'guid', 'uid', 'u', 'p', 'key', 'num', 'number',
]);

/** True for a column that looks like a table's own row identity (id, record_id, uuid), not entity keys like territory_id. */
function stellaLooksLikeGenericRowId(col) {
  if (stellaJoinFamily(col)) return false;
  const n = stellaNormJoinToken(col?.name || col?.original || (typeof col === 'string' ? col : ''));
  if (!n) return false;
  if (STELLA_GENERIC_ROW_ID_NAMES.has(n)) return true;
  return STELLA_GENERIC_ID_STEMS.has(stellaIdStem(col));
}

/** Transaction/document grain IDs (transaction_id, invoice_id, sale_id, sales_id) plus generic row IDs. Entity FKs like product_id are excluded. */
function stellaLooksLikeFactGrainId(col, file) {
  if (stellaJoinFamily(col)) return false;
  if (stellaLooksLikeGenericRowId(col)) return true;
  const stem = stellaIdStem(col);
  if (stem && (STELLA_FACT_GRAIN_STEMS.has(stem) || STELLA_FACT_KIND_STEMS.has(stem))) return true;
  const n = stellaNormJoinToken(col?.name || col?.original || (typeof col === 'string' ? col : ''));
  if (n && STELLA_FACT_KIND_STEMS.has(n)) return true;
  if (file) {
    const kind = stellaFileJoinRole(file).kind;
    const kindN = stellaNormJoinToken(kind);
    if (kindN && (stem === kindN || stem === `${kindN}s` || n === `${kindN}id` || n === `${kindN}sid`)) return true;
  }
  return false;
}

function stellaFileJoinTokens(file, namesOnly = false) {
  const bits = namesOnly
    ? [file?.name, file?.originalName]
    : [file?.name, file?.originalName, file?.capturedContext?.what_it_represents, file?.summary];
  const tokens = [];
  for (const bit of bits) {
    const stripped = String(bit || '')
      .replace(/\.[a-z0-9]{1,5}$/i, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    for (const t of stripped.toLowerCase().split(/[^a-z0-9]+/)) {
      if (!t || t.length < 2) continue;
      if (/^stella/.test(t) || t === 'xlsx' || t === 'csv' || t === 'xls' || t === 'txt') continue;
      tokens.push(t);
    }
  }
  return tokens;
}

function stellaMatchJoinFamilyId(tokens, families) {
  const list = Array.isArray(tokens) ? tokens : [];
  for (const fam of families) {
    for (const raw of fam.tokens) {
      const nt = stellaNormJoinToken(raw);
      if (nt.length < 3) continue;
      if (list.some((t) => t === nt || t.includes(nt))) return fam.id;
    }
  }
  return null;
}

function stellaFileColumnFamily(file) {
  const cols = Array.isArray(file?.columns) ? file.columns : [];
  const counts = new Map();
  for (const c of cols) {
    const fam = stellaJoinFamily(c);
    if (!fam || fam === 'date' || !STELLA_ENTITY_JOIN_FAMILIES.has(fam)) continue;
    counts.set(fam, (counts.get(fam) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [fam, n] of counts) {
    if (n > bestN) { best = fam; bestN = n; }
  }
  return best;
}

/** Classify a file as fact/sales-like, a dimension/entity list, or unknown. */
function stellaFileJoinRole(file) {
  if (!file) return { role: 'unknown', family: null, kind: null };
  const nameTokens = stellaFileJoinTokens(file, true);
  const allTokens = stellaFileJoinTokens(file, false);
  const nameFamily = stellaMatchJoinFamilyId(nameTokens, STELLA_JOIN_FAMILIES);
  const family = nameFamily || stellaMatchJoinFamilyId(allTokens, STELLA_JOIN_FAMILIES) || stellaFileColumnFamily(file);
  const nameKind = stellaMatchJoinFamilyId(nameTokens, STELLA_FACT_FILE_KINDS);
  const kind = nameKind || (nameFamily ? null : stellaMatchJoinFamilyId(allTokens, STELLA_FACT_FILE_KINDS));
  const dimHint = nameTokens.some((t) => STELLA_DIM_FILE_HINTS.has(t));
  const periodHint = nameTokens.some(stellaLooksLikePeriodToken);
  const cols = Array.isArray(file.columns) ? file.columns : [];
  const measureCount = cols.filter((c) => stellaLooksLikeMeasureCol(c)).length;
  if (dimHint && family && !nameKind) return { role: 'dimension', family, kind: null };
  if (dimHint && family) return { role: 'dimension', family, kind };
  if (kind) return { role: 'fact', family, kind };
  if (periodHint && measureCount >= 1) return { role: 'fact', family, kind: kind || 'sales' };
  if (family) {
    if (measureCount >= 1 && !nameFamily) return { role: 'fact', family, kind: null };
    return { role: 'dimension', family, kind: null };
  }
  if (measureCount >= 1 && periodHint) return { role: 'fact', family: null, kind: 'sales' };
  if (measureCount >= 2) return { role: 'fact', family: null, kind: null };
  return { role: 'unknown', family: null, kind: null };
}

function stellaFilesBothFactLike(fileA, fileB) {
  return stellaFileJoinRole(fileA).role === 'fact' && stellaFileJoinRole(fileB).role === 'fact';
}

function stellaFileHasEntityToken(file, stemOrFamily) {
  const needle = stellaNormJoinToken(stemOrFamily);
  if (!needle || needle.length < 3) return false;
  const tokens = stellaFileJoinTokens(file);
  if (tokens.some((t) => t === needle || t.includes(needle))) return true;
  const role = stellaFileJoinRole(file);
  if (role.family && (role.family === needle || stellaNormJoinToken(role.family) === needle)) return true;
  for (const fam of STELLA_JOIN_FAMILIES) {
    if (fam.id !== needle && !fam.tokens.some((t) => stellaNormJoinToken(t) === needle)) continue;
    if (role.family === fam.id) return true;
    if (fam.tokens.some((t) => {
      const nt = stellaNormJoinToken(t);
      return nt.length >= 3 && tokens.some((x) => x === nt || x.includes(nt));
    })) return true;
  }
  return false;
}

/**
 * Classic warehouse PK→FK: products.id (or record_id) matching sales.product_id.
 * The generic-ID side must look like that entity (filename / role), not a fact table's own row id.
 */
function stellaLooksLikePkFkPair(a, b, fileA, fileB) {
  const aGen = stellaLooksLikeGenericRowId(a);
  const bGen = stellaLooksLikeGenericRowId(b);
  if (aGen === bGen) return null;
  const fkCol = aGen ? b : a;
  const pkFile = aGen ? fileA : fileB;
  const fkFam = stellaJoinFamily(fkCol);
  const fkStem = stellaIdStem(fkCol);
  if (fkFam === 'date') return null;
  const namedEntity = !!(fkFam && STELLA_ENTITY_JOIN_FAMILIES.has(fkFam));
  const namedStem = !!(fkStem && fkStem.length >= 3 && !STELLA_GENERIC_ID_STEMS.has(fkStem) && !STELLA_FACT_GRAIN_STEMS.has(fkStem));
  if (!namedEntity && !namedStem) return null;
  const pkRole = stellaFileJoinRole(pkFile);
  if (pkRole.role === 'fact') return null;
  if (pkFile) {
    const matchesFamily = (fkFam && pkRole.family === fkFam)
      || stellaFileHasEntityToken(pkFile, fkFam || fkStem)
      || stellaFileHasEntityToken(pkFile, fkStem);
    if (!matchesFamily) return null;
  }
  return { family: fkFam || fkStem, stem: fkStem || fkFam };
}

function stellaFilesLookLikeSameFactSeries(fileA, fileB) {
  if (!fileA || !fileB) return false;
  if (stellaFilesBothFactLike(fileA, fileB)) return true;
  const aTok = stellaFileJoinTokens(fileA, true);
  const bTok = stellaFileJoinTokens(fileB, true);
  const aPeriod = aTok.some(stellaLooksLikePeriodToken);
  const bPeriod = bTok.some(stellaLooksLikePeriodToken);
  if (!aPeriod || !bPeriod) return false;
  const core = (tokens) => tokens.filter((t) => !stellaLooksLikePeriodToken(t) && !/^\d+$/.test(t)).sort().join('|');
  const aCore = core(aTok);
  const bCore = core(bTok);
  if (aCore && aCore === bCore) return true;
  const roleA = stellaFileJoinRole(fileA);
  const roleB = stellaFileJoinRole(fileB);
  if (roleA.kind && roleA.kind === roleB.kind) return true;
  return roleA.role === 'fact' || roleB.role === 'fact';
}

function stellaShouldBlockFactGrainJoin(a, b, fileA, fileB) {
  if (stellaLooksLikePkFkPair(a, b, fileA, fileB)) return false;
  const aGrain = stellaLooksLikeFactGrainId(a, fileA);
  const bGrain = stellaLooksLikeFactGrainId(b, fileB);
  if (!aGrain && !bGrain) return false;
  const roleA = stellaFileJoinRole(fileA);
  const roleB = stellaFileJoinRole(fileB);
  const bothDimSameFamily = roleA.role === 'dimension' && roleB.role === 'dimension'
    && roleA.family && roleA.family === roleB.family;
  if (bothDimSameFamily && stellaLooksLikeGenericRowId(a) && stellaLooksLikeGenericRowId(b)) return false;
  if (aGrain && bGrain) return true;
  if (stellaFilesLookLikeSameFactSeries(fileA, fileB) || stellaFilesBothFactLike(fileA, fileB)) return true;
  if (!fileA && !fileB) return stellaLooksLikeGenericRowId(a) && stellaLooksLikeGenericRowId(b);
  return false;
}

function stellaFindJoinColumn(file, hint) {
  const cols = (Array.isArray(file?.columns) ? file.columns : []).map(stellaColumnJoinMeta).filter((c) => c.name);
  const resolved = stellaResolveJoinField(file, hint);
  const h = stellaNormJoinToken(resolved || hint);
  return cols.find((c) => stellaNormJoinToken(c.name) === h || stellaNormJoinToken(c.original) === h)
    || { name: resolved || String(hint || '').trim(), original: '', type: '' };
}

function stellaLooksLikeMeasureCol(col) {
  const blobs = [col?.name, col?.original, col?.description].map(stellaNormJoinToken).filter(Boolean);
  if (blobs.some((b) => b === 'id' || /(uuid|guid|id|code|key|uid)$/.test(b))) {
    if (!blobs.some((b) => /^(unit|units|qty|quantity|volume|amount|sales|revenue)/.test(b))) return false;
  }
  if (col?.kind === 'measure') return true;
  if (blobs.some((b) => STELLA_MEASURE_JOIN_TOKENS.test(b))) return true;
  return blobs.some((b) => STELLA_MEASURE_NAME_HINT.test(b));
}

/** True for columns you would actually JOIN on in a warehouse (entity keys / dimension PKs), not measures. */
function stellaLooksLikeJoinKeyCol(col, file) {
  if (!col || stellaLooksLikeMeasureCol(col)) return false;
  const fam = stellaJoinFamily(col);
  if (fam === 'date' || STELLA_ENTITY_JOIN_FAMILIES.has(fam)) return true;
  const role = file ? stellaFileJoinRole(file) : null;
  if (stellaLooksLikeGenericRowId(col)) {
    if (role?.role === 'fact') return false;
    if (role?.role === 'dimension') return true;
    return false;
  }
  if (stellaLooksLikeFactGrainId(col, file)) {
    return role?.role === 'dimension';
  }
  const n = stellaNormJoinToken(col?.name || col?.original);
  if (!n) return false;
  if (/(uuid|guid|key|code|id)$/.test(n)) {
    if (role?.role === 'fact') return false;
    return true;
  }
  return col?.kind === 'id';
}

function stellaJoinKindPhrase(col, asMeasure) {
  if (asMeasure || col?.kind === 'measure') return 'a measure (values like revenue or qty, not a join key)';
  if (col?.kind === 'date') return 'dates';
  if (col?.kind === 'id') return 'identifiers';
  if (col?.kind === 'code') return 'codes';
  if (col?.kind === 'name') return 'names / labels';
  if (col?.kind === 'text') return 'text';
  return col?.kind ? String(col.kind) : 'unknown values';
}

function stellaJoinKindsCompatible(aKind, bKind) {
  const a = String(aKind || '');
  const b = String(bKind || '');
  if (!a || !b || a === 'empty' || b === 'empty') return true;
  if (a === b) return true;
  const keys = new Set(['id', 'code', 'name']);
  if (keys.has(a) && keys.has(b)) return true;
  if (a === 'measure' || b === 'measure') return a === b;
  if (a === 'date' || b === 'date') return a === b;
  return true;
}

function stellaJoinValueOverlap(a, b) {
  const aS = Array.isArray(a?.samples) ? a.samples : [];
  const bS = Array.isArray(b?.samples) ? b.samples : [];
  if (!aS.length || !bS.length) {
    return { hits: 0, ratio: 0, smaller: 0, examples: [], compared: false };
  }
  const bKeys = new Set();
  for (const v of bS) stellaJoinValueKeys(v).forEach((k) => bKeys.add(k));
  const examples = [];
  let hits = 0;
  for (const v of aS) {
    const keys = stellaJoinValueKeys(v);
    if (keys.some((k) => bKeys.has(k))) {
      hits += 1;
      if (examples.length < 4) examples.push(stellaNormJoinValue(v));
    }
  }
  const smaller = Math.min(aS.length, bS.length);
  return {
    hits,
    ratio: smaller ? Math.min(1, hits / smaller) : 0,
    smaller,
    examples,
    compared: true,
  };
}

function stellaJoinTypeBucket(type) {
  const t = String(type || '').toLowerCase();
  if (/date|time|timestamp/.test(t)) return 'date';
  if (/int|numeric|float|double|number|decimal|real/.test(t)) return 'number';
  if (/bool/.test(t)) return 'bool';
  return t ? 'text' : '';
}

function stellaJoinTypesCompatible(aType, bType) {
  const a = stellaJoinTypeBucket(aType);
  const b = stellaJoinTypeBucket(bType);
  if (!a || !b) return true;
  if (a === b) return true;
  if ((a === 'text' && b === 'number') || (a === 'number' && b === 'text')) return true;
  if ((a === 'date' && b === 'text') || (a === 'text' && b === 'date')) return true;
  return false;
}

function stellaScoreJoinColumns(a, b, fileA, fileB) {
  const warnings = [];
  const aN = stellaNormJoinToken(a?.name);
  const bN = stellaNormJoinToken(b?.name);
  const aO = stellaNormJoinToken(a?.original);
  const bO = stellaNormJoinToken(b?.original);
  const fa = stellaJoinFamily(a);
  const fb = stellaJoinFamily(b);
  const aMeas = stellaLooksLikeMeasureCol(a);
  const bMeas = stellaLooksLikeMeasureCol(b);
  const typeOk = stellaJoinTypesCompatible(a?.type, b?.type);
  const kindOk = stellaJoinKindsCompatible(a?.kind, b?.kind);
  const overlap = stellaJoinValueOverlap(a, b);
  const strongOverlap = overlap.compared && overlap.hits >= 2 && overlap.ratio >= 0.25;
  const someOverlap = overlap.compared && overlap.hits >= 1 && overlap.ratio >= 0.08;
  const lowCard = (a?.cardinality === 'low' || a?.cardinality === 'medium')
    && (b?.cardinality === 'low' || b?.cardinality === 'medium');
  const pkfk = stellaLooksLikePkFkPair(a, b, fileA, fileB);
  const blockFactGrain = stellaShouldBlockFactGrainJoin(a, b, fileA, fileB);
  const roleA = stellaFileJoinRole(fileA);
  const roleB = stellaFileJoinRole(fileB);
  const bothDimSameFamily = roleA.role === 'dimension' && roleB.role === 'dimension'
    && roleA.family && roleA.family === roleB.family;
  const sharedEntity = !!(fa && fb && fa === fb && STELLA_ENTITY_JOIN_FAMILIES.has(fa));

  let score = 0;
  let reason = '';
  if (strongOverlap) {
    score = overlap.ratio >= 0.5 ? 94 : 82;
    reason = `${overlap.hits} matching values in both columns`;
  } else if (someOverlap) {
    score = 72;
    reason = 'some matching values';
  }
  if (aN && aN === bN) {
    if (!score) { score = 100; reason = sharedEntity ? `shared ${fa} key` : 'same column name'; }
    else score = Math.max(score, 88);
    if (sharedEntity) reason = `shared ${fa} key`;
  } else if (aO && bO && aO === bO) {
    if (!score) { score = 90; reason = sharedEntity ? `shared ${fa} key` : 'same source header'; }
    else score = Math.max(score, 86);
    if (sharedEntity) reason = `shared ${fa} key`;
  } else if (fa && fb && fa === fb) {
    if (!score) { score = 70; reason = `shared ${fa} key`; }
    else score = Math.max(score, 70);
    if (STELLA_ENTITY_JOIN_FAMILIES.has(fa)) reason = `shared ${fa} key`;
  } else if (pkfk) {
    if (!score) { score = 84; reason = `dimension ${pkfk.family} key`; }
    else score = Math.max(score, 84);
    if (!reason) reason = `dimension ${pkfk.family} key`;
  } else if (!score) {
    const sa = stellaIdStem(a);
    const sb = stellaIdStem(b);
    const grainStem = stellaLooksLikeFactGrainId(a, fileA) || stellaLooksLikeFactGrainId(b, fileB)
      || STELLA_FACT_GRAIN_STEMS.has(sa) || STELLA_FACT_GRAIN_STEMS.has(sb)
      || STELLA_FACT_KIND_STEMS.has(sa) || STELLA_FACT_KIND_STEMS.has(sb);
    const genericStem = stellaLooksLikeGenericRowId(a) || stellaLooksLikeGenericRowId(b)
      || STELLA_GENERIC_ID_STEMS.has(sa) || STELLA_GENERIC_ID_STEMS.has(sb);
    const aId = /id$/.test(aN) || aN === 'id' || /id$/.test(aO);
    const bId = /id$/.test(bN) || bN === 'id' || /id$/.test(bO);
    if (!grainStem && !genericStem && aId && bId && sa && sa === sb && sa.length >= 3) {
      score = 80;
      reason = 'shared ID';
    } else if (genericStem && aN === 'id' && bN === 'id' && bothDimSameFamily) {
      score = 80;
      reason = 'shared dimension key';
    }
  }

  if (aMeas && bMeas && fa !== 'date' && fb !== 'date' && a?.kind !== 'date' && b?.kind !== 'date') {
    warnings.push('Both columns look like measures (revenue, qty, units, amounts), not keys to join on.');
    score = Math.min(score, 12);
    if (!reason) reason = 'both look like measures, not join keys';
  } else if (aMeas || bMeas) {
    warnings.push(`One column looks like ${stellaJoinKindPhrase(a, aMeas)} and the other like ${stellaJoinKindPhrase(b, bMeas)}. Measures are not join keys even when the numbers overlap.`);
    score = Math.min(score, 14);
    if (!reason) reason = 'measure vs key';
  }
  const aKey = stellaLooksLikeJoinKeyCol(a, fileA);
  const bKey = stellaLooksLikeJoinKeyCol(b, fileB);
  const aGeneric = stellaLooksLikeGenericRowId(a);
  const bGeneric = stellaLooksLikeGenericRowId(b);
  if (blockFactGrain) {
    warnings.push('These look like each file\'s own row/transaction IDs, not shared entity keys. Two sales files should join on shared dimension/entity IDs — not id, record_id, or transaction_id.');
    score = Math.min(score, 12);
    if (!reason || reason === 'same column name' || reason === 'shared ID' || reason === 'same source header' || reason === 'shared dimension key') {
      reason = 'fact-table row/transaction IDs, not entity keys';
    }
  } else if (pkfk) {
    if (!reason || reason === 'same column name') reason = `dimension ${pkfk.family} key`;
  } else if ((aGeneric || bGeneric) && !bothDimSameFamily) {
    warnings.push('These look like generic record/row IDs (id, record_id, uuid), not a matching entity key.');
    score = Math.min(score, 12);
    if (!reason || reason === 'same column name' || reason === 'shared ID' || reason === 'same source header') {
      reason = 'generic row IDs, not entity keys';
    }
  } else if (!aKey || !bKey) {
    warnings.push('These are not entity keys you would join in a database (shared dimension/entity IDs). Same type or matching numbers is not enough.');
    score = Math.min(score, 16);
    if (!reason) reason = 'not a database join key';
  }
  if (fa && fb && fa !== fb) {
    warnings.push(`These look like different business keys (${fa} vs ${fb}).`);
    score = Math.min(score, 12);
    if (!reason || reason === 'measure vs key') reason = `different key types (${fa} vs ${fb})`;
  }
  if (!kindOk && !strongOverlap) {
    warnings.push(`Column contents look different (${a?.kind || 'unknown'} vs ${b?.kind || 'unknown'}).`);
    score = Math.min(score, 25);
    if (!reason) reason = 'different kinds of values';
  }
  if (!typeOk) {
    warnings.push(`Data types look different (${a?.type || 'unknown'} vs ${b?.type || 'unknown'}).`);
    if (score < 100) score = Math.min(score, 50);
  }
  if (overlap.compared && overlap.hits === 0 && (overlap.smaller >= 3 || (a?.samples?.length && b?.samples?.length))) {
    if (sharedEntity) {
      warnings.push('Sampled rows do not overlap yet — the key names still match, so these can be used to group or compare (e.g. territory across years).');
    } else {
      warnings.push(lowCard
        ? 'Sample values do not overlap — these look like different lists.'
        : 'No matching values in the sampled rows. Names can still match, but the contents do not look shared.');
      score = Math.min(score, lowCard ? 22 : 48);
      if (!reason || reason === 'measure vs key') reason = 'values do not overlap';
    }
  } else if (overlap.compared && overlap.ratio < 0.08 && overlap.smaller >= 4 && !strongOverlap && !sharedEntity) {
    warnings.push('Almost no shared values in the sampled rows.');
    score = Math.min(score, 52);
  }

  if (!warnings.length && !score) {
    warnings.push('Column names, types, and sample values do not look like the same key.');
  }

  let verdict = 'ok';
  if (score < 40) verdict = 'block';
  else if (score < 70 || (warnings.length && !sharedEntity)) verdict = 'warn';
  else if (warnings.length && sharedEntity && score >= 70) verdict = 'ok';
  if (!sharedEntity && !strongOverlap && (warnings.length >= 2 || (overlap.compared && overlap.hits === 0 && overlap.smaller >= 3))) {
    verdict = 'block';
  }
  if (!reason) reason = score ? 'possible join key' : 'column names, types, and values do not match';
  return { score, reason, typeOk, kindOk, overlap, verdict, warnings };
}

function stellaAssessJoin(fromFile, toFile, thisField, relatedField) {
  const a = stellaFindJoinColumn(fromFile, thisField);
  const b = stellaFindJoinColumn(toFile, relatedField);
  const scored = stellaScoreJoinColumns(a, b, fromFile, toFile);
  const examples = scored.overlap?.examples?.length
    ? ` e.g. ${scored.overlap.examples.join(', ')}`
    : '';
  return {
    ...scored,
    thisLabel: `${thisField}${a.type ? ` [${a.type}]` : ''}${a.kind ? ` · ${a.kind}` : ''}`,
    thatLabel: `${relatedField}${b.type ? ` [${b.type}]` : ''}${b.kind ? ` · ${b.kind}` : ''}`,
    examples,
    thisField,
    thatField: relatedField,
    thisFile: fromFile?.name || 'File',
    thatFile: toFile?.name || 'File',
    thisType: a.type || '',
    thatType: b.type || '',
    thisKind: a.kind || '',
    thatKind: b.kind || '',
    thisSamples: Array.isArray(a.samples) ? a.samples.slice(0, 3) : [],
    thatSamples: Array.isArray(b.samples) ? b.samples.slice(0, 3) : [],
  };
}

function StellaJoinColumnPreview({ fileName, field, type, kind, samples }) {
  const list = (samples || []).map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, 3);
  return (
    <div className="bg-slate-950/55 border border-white/10 rounded-lg px-3 py-2.5 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-blue-300/50 font-semibold truncate">{fileName || 'File'}</div>
      <div className="text-xs text-white font-semibold mt-0.5 truncate" title={field}>{field}</div>
      <div className="text-[10px] text-cyan-200/75 mt-0.5">
        {[type, kind].filter(Boolean).join(' · ') || 'type unknown'}
      </div>
      {list.length ? (
        <ul className="mt-2 space-y-0.5">
          {list.map((v, i) => (
            <li key={`${v}-${i}`} className="text-[11px] text-slate-200 font-mono truncate" title={v}>{v}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-blue-300/45 mt-2">No sample values yet</p>
      )}
    </div>
  );
}

function stellaFilterJoinRels(rels, thisFile, otherFiles) {
  const keep = [];
  const dropped = [];
  const others = otherFiles || [];
  for (const r of rels || []) {
    if (!r) continue;
    const other = others.find((f) => (
      (r.related_table && f.tableName === r.related_table)
      || (r.related_file && String(f.name || '').toLowerCase() === String(r.related_file || '').toLowerCase())
    ));
    if (!other) {
      dropped.push({ r, why: 'could not match the other file' });
      continue;
    }
    const assessed = stellaAssessJoin(thisFile, other, r.this_field, r.related_field);
    if (assessed.verdict === 'block' || stellaShouldBlockFactGrainJoin(
      stellaFindJoinColumn(thisFile, r.this_field),
      stellaFindJoinColumn(other, r.related_field),
      thisFile,
      other,
    )) {
      dropped.push({ r, why: (assessed.warnings || []).filter(Boolean).join(' ') || assessed.reason });
    } else {
      keep.push(r);
    }
  }
  return { keep, dropped };
}

function stellaGuessJoinCandidates(thisFile, otherFiles) {
  const others = (otherFiles || []).filter((f) => f && f.id !== thisFile?.id && f.tableName);
  const dimByFamily = new Map();
  for (const f of others) {
    const role = stellaFileJoinRole(f);
    if (role.role === 'dimension' && role.family) dimByFamily.set(role.family, f.id);
  }
  const thisRole = stellaFileJoinRole(thisFile);
  if (thisRole.role === 'dimension' && thisRole.family && !dimByFamily.has(thisRole.family)) {
    dimByFamily.set(thisRole.family, thisFile.id);
  }
  const thisCols = (thisFile?.columns || []).map(stellaColumnJoinMeta).filter((c) => c.name);
  const ranked = [];
  for (const other of others) {
    const otherCols = (other.columns || []).map(stellaColumnJoinMeta).filter((c) => c.name);
    for (const a of thisCols) {
      for (const b of otherCols) {
        const scored = stellaScoreJoinColumns(a, b, thisFile, other);
        const fam = stellaJoinFamily(a);
        const famB = stellaJoinFamily(b);
        const sharedEntity = fam && fam === famB && STELLA_ENTITY_JOIN_FAMILIES.has(fam);
        if (fam && famB && fam !== famB) continue;
        if (scored.verdict === 'block') continue;
        if (scored.verdict !== 'ok' && !sharedEntity) continue;
        if (stellaShouldBlockFactGrainJoin(a, b, thisFile, other)) continue;
        const pkfk = stellaLooksLikePkFkPair(a, b, thisFile, other);
        if (!pkfk && (!stellaLooksLikeJoinKeyCol(a, thisFile) || !stellaLooksLikeJoinKeyCol(b, other))) continue;
        const otherRole = stellaFileJoinRole(other);
        // Suppress fact↔fact (or unknown↔fact) entity-key links when a proper master/dimension
        // list already exists for that family. E.g. if a territory structure file is loaded,
        // don't also propose linking 2024 sales to 2025 sales on territory_id — both should
        // link structurally to the master list instead.
        const thisIsFact = thisRole.role === 'fact' || thisRole.role === 'unknown';
        const otherIsFact2 = otherRole.role === 'fact' || otherRole.role === 'unknown';
        if (
          fam
          && dimByFamily.has(fam)
          && thisIsFact
          && otherIsFact2
        ) continue;
        // linkType:
        //  'structural' = one file IS the master list that defines what the ID means
        //                 (e.g. territories.csv defines territory_id → sales references it)
        //                 Requires one side to be explicitly classified as 'dimension' —
        //                 'unknown' role alone is NOT enough to call a link structural.
        //  'comparison' = both files are transactions/events (or unclassified) and share the
        //                 key so queries can group or compare across them (2024 vs 2025 sales,
        //                 sales vs HCP engagements, etc.)
        const oneIsDimension = otherRole.role === 'dimension' || thisRole.role === 'dimension';
        const otherIsFact = otherRole.role === 'fact' || thisRole.role === 'fact';
        const isDimLink = oneIsDimension && (otherIsFact || pkfk);
        const linkType = isDimLink ? 'structural' : 'comparison';
        ranked.push({
          related_file: other.name,
          related_table: other.tableName,
          related_id: other.id,
          this_field: a.name,
          related_field: b.name,
          this_header: a.original || a.name,
          related_header: b.original || b.name,
          reason: scored.reason,
          linkType,
          family: sharedEntity ? fam : (fam || famB || ''),
          score: scored.score + (otherRole.role === 'dimension' && fam && dimByFamily.get(fam) === other.id ? 8 : 0),
          overlapHits: scored.overlap?.hits || 0,
        });
      }
    }
  }
  ranked.sort((x, y) => y.score - x.score);
  const seenPair = new Set();
  const seenThis = new Set();
  const seenRelated = new Set();
  const seenFamily = new Set();
  const out = [];
  for (const row of ranked) {
    const pair = `${row.related_id}|${String(row.this_field || '').toLowerCase()}|${String(row.related_field || '').toLowerCase()}`;
    if (seenPair.has(pair)) continue;
    // One column on this file maps to at most one column on the other file.
    const thisKey = `${row.related_id}|this|${String(row.this_field || '').toLowerCase()}`;
    const relKey = `${row.related_id}|rel|${String(row.related_field || '').toLowerCase()}`;
    if (seenThis.has(thisKey) || seenRelated.has(relKey)) continue;
    // One entity-family join per file pair — a key maps to the matching key,
    // not to another attribute on the same master file.
    const fam = String(row.family || '');
    if (fam && STELLA_ENTITY_JOIN_FAMILIES.has(fam)) {
      const famKey = `${row.related_id}|fam|${fam}`;
      if (seenFamily.has(famKey)) continue;
      seenFamily.add(famKey);
    }
    seenPair.add(pair);
    seenThis.add(thisKey);
    seenRelated.add(relKey);
    out.push(row);
  }
  return out;
}

function stellaJoinQuestion(candidates, otherFiles) {
  const others = (otherFiles || []).filter((f) => f?.tableName);
  if (!others.length) return '';
  if (candidates.length) {
    // Separate structural links (master list ↔ transactions) from comparison links (transactions ↔ transactions)
    const structural = candidates.filter((c) => c.linkType === 'structural');
    const comparison = candidates.filter((c) => c.linkType !== 'structural');

    const formatLine = (c) => {
      const thisCol = `\`${c.this_field}\`${c.this_header && c.this_header !== c.this_field ? ` ("${c.this_header}")` : ''}`;
      const relCol = `\`${c.related_field}\`${c.related_header && c.related_header !== c.related_field ? ` ("${c.related_header}")` : ''}`;
      return `- **${c.related_file}**: ${thisCol} ↔ ${relCol}`;
    };

    const parts = [];

    if (structural.length) {
      parts.push(
        `**Structural links** — one file is the master list that defines what these IDs mean; `
        + `the other references them. Stella uses these to enrich your data with names, labels, or attributes:\n`
        + structural.map(formatLine).join('\n')
      );
    }

    if (comparison.length) {
      parts.push(
        `**Comparison links** — both files are transaction or activity datasets with no master list to join through. `
        + `The ideal setup is to upload the relevant master/reference list for these IDs so both files can link *through* that master — `
        + `but without one, Stella can still use these shared IDs to group or compare across the files `
        + `(e.g. 2024 vs 2025 performance by territory). `
        + `Each file's own row/record IDs are *not* linked — those are independent and mean nothing across files:\n`
        + comparison.map(formatLine).join('\n')
        + `\n\n_If you have the relevant master/reference list for these IDs, upload that and these links will be replaced by proper structural joins._`
      );
    }

    parts.push(`Are these links correct? Add any I missed, or say "not linked" if any should be removed.`);
    return parts.join('\n\n');
  }
  const names = others.map((f) => `**${f.name}**`).join(', ');
  return `Does this file share shared entity IDs with ${names}?\n\nThe strongest links are **structural** — where one file is a master/reference list for these IDs and this file references those IDs. If you upload that kind of master/reference file, Stella will link everything through it.\n\nWithout a master/reference list, Stella can still link two transaction files on shared IDs for comparison queries (e.g. year-over-year) — but this is a fallback, not a true join.\n\nNote: each file's own row or record IDs are always independent — never link those across files. If these files are completely unrelated, just say so.`;
}

function stellaLooksLikeJoinDecline(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[\u2018\u2019`]/g, "'");
  if (!t) return false;
  const compact = t.replace(/'/g, '');
  if (/^(n|no|nope|nah|wrong|skip|none|neither|dont|do not)[\s.!?]*$/i.test(compact)) return true;
  return /\b(unrelated|do not join|don't join|dont join|no (?:common|shared|link|join|connection)|not (?:those|that|linked|related|joined|connected)|separate files|should not be joined|skip (?:those|them)|reject|no thanks)\b/i.test(t);
}

function stellaLooksLikeJoinAccept(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (stellaLooksLikeJoinDecline(t)) return false;
  if (/^(y|yes|yeah|yep|correct|that's right|thats right|right|ok|okay)[\s.!]*$/i.test(t)) return true;
  return /\b(join (them|on|by)|they (do )?join|same (key|id|territory|product)|linked by|yes[, ]+(they |it )?(join|link))\b/i.test(t);
}

function stellaIntakeAskedJoin(messages) {
  return (messages || []).some((m) => (
    m?.role === 'assistant'
    && /\b(join|joined|share an id, territory|correct keys|should not be joined)\b/i.test(String(m.content || ''))
  ));
}

function stellaResolveJoinField(file, hint) {
  const cols = (file?.columns || []).map(stellaColumnJoinMeta).filter((c) => c.name);
  const h = stellaNormJoinToken(hint);
  if (!h) return '';
  const exact = cols.find((c) => stellaNormJoinToken(c.name) === h || stellaNormJoinToken(c.original) === h);
  if (exact) return exact.name;
  const contains = cols.find((c) => {
    const n = stellaNormJoinToken(c.name);
    const o = stellaNormJoinToken(c.original);
    return (n && (n.includes(h) || h.includes(n))) || (o && (o.includes(h) || h.includes(o)));
  });
  return contains ? contains.name : String(hint || '').trim();
}

function stellaFileColumnNames(file) {
  const cols = Array.isArray(file?.columns) ? file.columns : [];
  return cols.map((c) => {
    if (typeof c === 'string') return c.trim();
    return String(c?.name || c?.original || '').trim();
  }).filter(Boolean);
}

function stellaRelMatches(rel, otherFile, thisField, relatedField) {
  if (!rel || !otherFile) return false;
  const table = String(rel.related_table || '').toLowerCase();
  const name = String(rel.related_file || '').toLowerCase();
  const otherTable = String(otherFile.tableName || '').toLowerCase();
  const otherName = String(otherFile.name || '').toLowerCase();
  const otherHit = (table && otherTable && table === otherTable)
    || (name && otherName && name === otherName);
  if (!otherHit) return false;
  return String(rel.this_field || '').toLowerCase() === String(thisField || '').toLowerCase()
    && String(rel.related_field || '').toLowerCase() === String(relatedField || '').toLowerCase();
}

function stellaMutateRelationships(ctx, otherFile, thisField, relatedField, type, thisFile) {
  const base = (ctx && typeof ctx === 'object') ? { ...ctx } : {};
  let rels = Array.isArray(base.relationships) ? [...base.relationships] : [];
  if (type === 'remove') {
    rels = rels.filter((r) => !stellaRelMatches(r, otherFile, thisField, relatedField));
  } else {
    rels = stellaDedupeRelationships([
      ...rels,
      {
        related_file: otherFile.name || '',
        related_table: otherFile.tableName || '',
        this_field: thisField,
        related_field: relatedField,
        note: 'Linked on the connection map',
        link_type: stellaJoinLinkType(thisFile, otherFile),
      },
    ]);
  }
  return { ...base, relationships: rels };
}

function stellaCapturedContextIsEmpty(ctx) {
  if (!ctx || typeof ctx !== 'object') return true;
  const maps = Array.isArray(ctx.name_maps) ? ctx.name_maps : [];
  const rels = Array.isArray(ctx.relationships) ? ctx.relationships : [];
  const qa = Array.isArray(ctx.qa_pairs) ? ctx.qa_pairs : [];
  const metrics = Array.isArray(ctx.key_metrics) ? ctx.key_metrics : [];
  return !String(ctx.what_it_represents || '').trim()
    && !String(ctx.time_period || '').trim()
    && !String(ctx.interpretation_notes || '').trim()
    && !metrics.some((m) => String(m || '').trim())
    && !maps.length
    && !rels.length
    && !qa.some((p) => p && (intakePairFact(p) || p.question || p.answer));
}

function stellaDedupeRelationships(list) {
  const seen = new Set();
  const out = [];
  for (const r of list || []) {
    if (!r) continue;
    const key = `${String(r.related_table || r.related_file || '').toLowerCase()}|${r.this_field}|${r.related_field}`;
    if (!r.related_file && !r.related_table) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function stellaNormalizeStoredRelationships(raw, thisFile, otherFiles) {
  const others = otherFiles || [];
  return stellaDedupeRelationships((Array.isArray(raw) ? raw : []).map((r) => {
    if (!r || typeof r !== 'object') return null;
    const relatedName = String(r.related_file || '').trim();
    const relatedTable = String(r.related_table || '').trim();
    const other = others.find((f) => (
      (relatedTable && f.tableName === relatedTable)
      || (relatedName && String(f.name || '').toLowerCase() === relatedName.toLowerCase())
    ));
    const thisField = stellaResolveJoinField(thisFile, r.this_field);
    const relatedField = other ? stellaResolveJoinField(other, r.related_field) : String(r.related_field || '').trim();
    if (!thisField || !relatedField) return null;
    return {
      related_file: other?.name || relatedName,
      related_table: other?.tableName || relatedTable,
      this_field: thisField,
      related_field: relatedField,
      note: String(r.note || '').trim(),
      link_type: r.link_type || r.linkType || (other ? stellaJoinLinkType(thisFile, other) : 'comparison'),
    };
  }).filter(Boolean));
}

function stellaFormatConfirmedJoins(files) {
  const lines = [];
  const seen = new Set();
  for (const f of files || []) {
    const rels = f?.capturedContext?.relationships;
    if (!Array.isArray(rels) || !f.tableName) continue;
    for (const r of rels) {
      if (!r?.this_field || !r?.related_field) continue;
      const left = `${f.tableName}.${r.this_field}`;
      const rightTable = r.related_table || r.related_file;
      if (!rightTable) continue;
      const right = `${rightTable}.${r.related_field}`;
      const pair = [left, right].sort().join(' = ');
      if (seen.has(pair)) continue;
      seen.add(pair);
      const label = r.related_file ? ` (${f.name} ↔ ${r.related_file})` : '';
      lines.push(`- ${left} = ${right}${label}${r.note ? ` — ${r.note}` : ''}`);
    }
  }
  return lines.join('\n');
}

function stellaFileShortName(name) {
  const raw = String(name || 'File').trim();
  if (raw.length <= 28) return raw;
  const dot = raw.lastIndexOf('.');
  if (dot > 8 && dot < raw.length - 1) {
    const stem = raw.slice(0, dot);
    const ext = raw.slice(dot);
    return `${stem.slice(0, 18)}…${ext}`;
  }
  return `${raw.slice(0, 25)}…`;
}

function stellaJoinLinkType(fromFile, toFile) {
  const a = stellaFileJoinRole(fromFile);
  const b = stellaFileJoinRole(toFile);
  if ((a.role === 'dimension' && b.role === 'fact') || (a.role === 'fact' && b.role === 'dimension')) return 'structural';
  return 'comparison';
}

function stellaJoinTypeStroke(joinType, { hot = false, selected = false } = {}) {
  if (hot) return 'rgb(248, 113, 113)';
  if (joinType === 'structural') return selected ? 'rgb(251, 191, 36)' : 'rgba(251, 191, 36, 0.88)';
  return selected ? 'rgb(34, 211, 238)' : 'rgba(34, 211, 238, 0.75)';
}

function stellaJoinTypeDash(joinType) {
  return joinType === 'structural' ? undefined : '7 5';
}

function stellaJoinTypeLabel(joinType, count = 1) {
  if (joinType === 'mixed') return count === 1 ? 'Joins' : `${count} joins`;
  if (joinType === 'structural') return count === 1 ? 'Structural' : `${count} structural`;
  return count === 1 ? 'Comparison' : `${count} comparison`;
}

/** Undirected join graph from intake-confirmed relationships. Multiple keys between the same pair stay as separate edges. */
function stellaBuildFileLinkGraph(files) {
  const list = (files || []).filter((f) => f && !f.processing);
  const nodes = list.map((f) => ({
    id: f.id,
    name: f.name || 'File',
    tableName: f.tableName || '',
    intakeComplete: !!(f.intakeComplete || f.capturedContext),
    columns: stellaFileColumnNames(f),
    joinCount: 0,
    partners: new Set(),
  }));
  const byTable = new Map();
  const byName = new Map();
  for (const f of list) {
    if (f.tableName) byTable.set(String(f.tableName).toLowerCase(), f.id);
    byName.set(String(f.name || '').toLowerCase(), f.id);
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  const seen = new Set();
  for (const f of list) {
    const rels = Array.isArray(f.capturedContext?.relationships) ? f.capturedContext.relationships : [];
    for (const r of rels) {
      if (!r) continue;
      const otherId = (
        (r.related_table && byTable.get(String(r.related_table).toLowerCase()))
        || (r.related_file && byName.get(String(r.related_file).toLowerCase()))
      );
      if (!otherId || otherId === f.id) continue;
      const thisField = String(r.this_field || '').trim();
      const relatedField = String(r.related_field || '').trim();
      if (!thisField || !relatedField) continue;
      const pair = [f.id, otherId].sort().join('|');
      const joinKey = [thisField, relatedField].map((s) => s.toLowerCase()).sort().join('=');
      const edgeKey = `${pair}|${joinKey}`;
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      const other = list.find((x) => x.id === otherId);
      edges.push({
        from: f.id,
        to: otherId,
        thisField,
        relatedField,
        note: String(r.note || '').trim(),
        label: `${thisField} ↔ ${relatedField}`,
        fromName: f.name,
        toName: other?.name || r.related_file || r.related_table,
        joinType: r.link_type || r.linkType || stellaJoinLinkType(f, other),
      });
      const a = nodeById.get(f.id);
      const b = nodeById.get(otherId);
      if (a) a.partners.add(otherId);
      if (b) b.partners.add(f.id);
    }
  }
  for (const n of nodes) {
    n.joinCount = n.partners.size;
    n.partners = [...n.partners];
  }
  return { nodes, edges };
}

function stellaFileGraphLayout(nodes, width, height) {
  const n = nodes.length;
  if (!n) return [];
  const cx = width / 2;
  const cy = height / 2;
  if (n === 1) return [{ ...nodes[0], x: cx, y: cy }];
  if (n === 2) {
    const gap = Math.min(width * 0.28, 200);
    return [
      { ...nodes[0], x: cx - gap, y: cy },
      { ...nodes[1], x: cx + gap, y: cy },
    ];
  }
  const r = Math.min(width, height) * 0.34;
  return nodes.map((node, i) => {
    const a = -Math.PI / 2 + ((2 * Math.PI) * i) / n;
    return { ...node, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function stellaJoinCurvePath(a, b, index, total) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const offset = (index - (total - 1) / 2) * 36;
  const cx = mx + nx * offset;
  const cy = my + ny * (offset || (total > 1 ? 0 : 18));
  return {
    d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
    lx: (a.x + 2 * cx + b.x) / 4,
    ly: (a.y + 2 * cy + b.y) / 4,
  };
}

const STELLA_CARD_W = 196;
const STELLA_HEADER_H = 46;
const STELLA_ROW_H = 20;

function stellaJoinFieldsForNode(nodeId, edges) {
  const fields = [];
  const seen = new Set();
  for (const e of edges || []) {
    if (e.from === nodeId && e.thisField && !seen.has(e.thisField.toLowerCase())) {
      seen.add(e.thisField.toLowerCase());
      fields.push(e.thisField);
    }
    if (e.to === nodeId && e.relatedField && !seen.has(e.relatedField.toLowerCase())) {
      seen.add(e.relatedField.toLowerCase());
      fields.push(e.relatedField);
    }
  }
  return fields;
}

function stellaFieldsForNode(node, edges) {
  const joinFields = stellaJoinFieldsForNode(node.id, edges);
  const seen = new Set(joinFields.map((f) => f.toLowerCase()));
  const rest = (node.columns || []).filter((c) => !seen.has(String(c).toLowerCase()));
  return [...joinFields, ...rest];
}

function stellaCardSize(expanded, fieldCount) {
  if (!expanded) return { w: STELLA_CARD_W, h: STELLA_HEADER_H };
  const rows = Math.max(fieldCount, 1);
  return { w: STELLA_CARD_W, h: STELLA_HEADER_H + 10 + rows * STELLA_ROW_H + 8 };
}

function stellaFieldAnchor(node, fieldName, side) {
  const i = Math.max(0, (node.fields || []).findIndex((f) => f === fieldName));
  const { w, h } = stellaCardSize(true, node.fields?.length || 1);
  return {
    x: side === 'right' ? node.x + w / 2 : node.x - w / 2,
    y: node.y - h / 2 + STELLA_HEADER_H + 10 + i * STELLA_ROW_H + STELLA_ROW_H / 2,
  };
}

function stellaJoinActionLabel(action) {
  if (!action) return '';
  const left = action.fromName || 'File';
  const right = action.toName || 'File';
  const a = action.thisField || 'field';
  const b = action.relatedField || 'field';
  return `${left}: ${a}  ↔  ${right}: ${b}`;
}

function StellaFileConnectionMap({ files, activeId, onSelectFile, onJoinChange, onRequestRemoveJoin, onUndoJoin, joinUndo, joinConfirmOpen }) {
  const graph = useMemo(() => stellaBuildFileLinkGraph(files || []), [files]);
  const fileById = useMemo(() => new Map((files || []).map((f) => [f.id, f])), [files]);
  const nodeIds = graph.nodes.map((n) => n.id).join('|');
  const [large, setLarge] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [pos, setPos] = useState({});
  const [joinLine, setJoinLine] = useState(null);
  const [joinFrom, setJoinFrom] = useState(null);
  const [joinHover, setJoinHover] = useState(null);
  const [hoverJoin, setHoverJoin] = useState('');
  const [showStructuralJoins, setShowStructuralJoins] = useState(true);
  const [showComparisonJoins, setShowComparisonJoins] = useState(true);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const joinDragRef = useRef(null);

  useEffect(() => {
    setPos((prev) => {
      let changed = false;
      const next = { ...prev };
      const laid = stellaFileGraphLayout(graph.nodes, 1000, 560);
      for (const n of laid) {
        if (next[n.id]) continue;
        next[n.id] = { x: n.x / 1000, y: n.y / 560 };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [nodeIds, graph]);

  useEffect(() => {
    if (!large) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (joinConfirmOpen) return;
      setLarge(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [large, joinConfirmOpen]);

  const width = large ? 1400 : 900;
  const height = large ? 820 : (graph.nodes.length <= 2 ? 320 : graph.nodes.length <= 4 ? 400 : 460);
  const pairBuckets = new Map();
  for (const e of graph.edges) {
    const key = [e.from, e.to].sort().join('|');
    if (!pairBuckets.has(key)) pairBuckets.set(key, []);
    pairBuckets.get(key).push(e);
  }
  const isolated = graph.nodes.filter((n) => n.joinCount === 0);
  const pending = graph.nodes.filter((n) => !n.intakeComplete);
  const pairCount = pairBuckets.size;

  const laid = graph.nodes.map((n) => {
    const p = pos[n.id] || { x: 0.5, y: 0.5 };
    const fields = stellaFieldsForNode(n, graph.edges);
    const isOpen = expanded.has(n.id);
    const size = stellaCardSize(isOpen, fields.length);
    return {
      ...n,
      fields,
      expanded: isOpen,
      x: 24 + p.x * (width - 48),
      y: 24 + p.y * (height - 48),
      w: size.w,
      h: size.h,
    };
  });
  const posMap = new Map(laid.map((n) => [n.id, n]));

  const clientToSvg = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const loc = pt.matrixTransform(ctm.inverse());
    return { x: loc.x, y: loc.y };
  };

  const clientToFrac = (clientX, clientY) => {
    const loc = clientToSvg(clientX, clientY);
    if (!loc) return null;
    return {
      x: Math.min(0.96, Math.max(0.04, loc.x / width)),
      y: Math.min(0.96, Math.max(0.04, loc.y / height)),
    };
  };

  const fieldAtSvg = (x, y) => {
    for (const n of laid) {
      if (!n.expanded || !n.fields.length) continue;
      const left = n.x - n.w / 2;
      const top = n.y - n.h / 2;
      for (let i = 0; i < n.fields.length; i += 1) {
        const fy = top + STELLA_HEADER_H + 10 + i * STELLA_ROW_H;
        if (x >= left && x <= left + n.w && y >= fy && y <= fy + STELLA_ROW_H) {
          return { id: n.id, field: n.fields[i] };
        }
      }
    }
    return null;
  };

  const nodeAtSvg = (x, y) => {
    for (const n of laid) {
      const left = n.x - n.w / 2;
      const top = n.y - n.h / 2;
      if (x >= left && x <= left + n.w && y >= top && y <= top + n.h) return n;
    }
    return null;
  };

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const opening = !next.has(id);
      if (opening) {
        next.add(id);
        const node = graph.nodes.find((n) => n.id === id);
        for (const pid of node?.partners || []) next.add(pid);
      } else {
        next.delete(id);
      }
      return next;
    });
    onSelectFile?.(id);
  };

  const onPointerDown = (ev, id) => {
    if (ev.button !== 0 || joinDragRef.current) return;
    ev.preventDefault();
    ev.stopPropagation();
    const frac = clientToFrac(ev.clientX, ev.clientY);
    const cur = pos[id] || { x: 0.5, y: 0.5 };
    dragRef.current = {
      id,
      moved: false,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      origin: cur,
      grab: frac,
    };
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
  };

  const beginFieldJoin = (ev, nodeId, field) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    try { ev.currentTarget.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
    const loc = clientToSvg(ev.clientX, ev.clientY);
    const node = posMap.get(nodeId);
    joinDragRef.current = { fromId: nodeId, field };
    setJoinFrom({ id: nodeId, field });
    setJoinHover(null);
    setJoinLine({
      x1: node ? stellaFieldAnchor(node, field, 'right').x : loc?.x || 0,
      y1: node ? stellaFieldAnchor(node, field, 'right').y : loc?.y || 0,
      x2: loc?.x || 0,
      y2: loc?.y || 0,
    });
  };

  const onPointerMove = (ev) => {
    if (joinDragRef.current) {
      const loc = clientToSvg(ev.clientX, ev.clientY);
      if (!loc) return;
      const hit = fieldAtSvg(loc.x, loc.y);
      const valid = !!(hit && hit.id !== joinDragRef.current.fromId);
      let verdict = 'ok';
      if (valid) {
        const fromFile = fileById.get(joinDragRef.current.fromId);
        const toFile = fileById.get(hit.id);
        if (fromFile && toFile) {
          verdict = stellaAssessJoin(fromFile, toFile, joinDragRef.current.field, hit.field).verdict;
        }
      }
      const nextHover = valid ? { id: hit.id, field: hit.field, verdict } : null;
      setJoinHover((prev) => (
        prev?.id === nextHover?.id && prev?.field === nextHover?.field && prev?.verdict === nextHover?.verdict
          ? prev
          : nextHover
      ));
      const fromNode = posMap.get(joinDragRef.current.fromId);
      const toNode = valid ? posMap.get(hit.id) : null;
      const aRight = fromNode && toNode ? fromNode.x <= toNode.x : true;
      const fromPt = fromNode
        ? stellaFieldAnchor(fromNode, joinDragRef.current.field, aRight ? 'right' : 'left')
        : loc;
      const toPt = toNode && valid
        ? stellaFieldAnchor(toNode, hit.field, aRight ? 'left' : 'right')
        : loc;
      setJoinLine({ x1: fromPt.x, y1: fromPt.y, x2: toPt.x, y2: toPt.y });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const dist = Math.hypot(ev.clientX - drag.startClientX, ev.clientY - drag.startClientY);
    if (dist > 5) drag.moved = true;
    if (!drag.moved) return;
    const frac = clientToFrac(ev.clientX, ev.clientY);
    if (!frac || !drag.grab) return;
    const nx = Math.min(0.96, Math.max(0.04, drag.origin.x + (frac.x - drag.grab.x)));
    const ny = Math.min(0.96, Math.max(0.04, drag.origin.y + (frac.y - drag.grab.y)));
    setPos((prev) => ({ ...prev, [drag.id]: { x: nx, y: ny } }));
  };

  const finishJoinDrag = (ev) => {
    const drag = joinDragRef.current;
    joinDragRef.current = null;
    setJoinLine(null);
    setJoinFrom(null);
    setJoinHover(null);
    if (!drag) return;
    const loc = clientToSvg(ev.clientX, ev.clientY);
    if (!loc) return;
    const hit = fieldAtSvg(loc.x, loc.y);
    if (hit && hit.id !== drag.fromId) {
      setExpanded((prev) => new Set([...prev, drag.fromId, hit.id]));
      onJoinChange?.({
        type: 'add',
        fromId: drag.fromId,
        toId: hit.id,
        thisField: drag.field,
        relatedField: hit.field,
      });
      return;
    }
    const node = nodeAtSvg(loc.x, loc.y);
    if (node && node.id !== drag.fromId && !node.expanded) {
      setExpanded((prev) => new Set([...prev, drag.fromId, node.id]));
    }
  };

  const onPointerUp = (ev, id) => {
    if (joinDragRef.current) {
      finishJoinDrag(ev);
      return;
    }
    const drag = dragRef.current;
    const moved = !!(drag && drag.moved);
    dragRef.current = null;
    try { ev.currentTarget.releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
    if (!moved) toggleExpand(id);
  };

  const removeJoin = (edge) => {
    onRequestRemoveJoin?.({
      fromId: edge.from,
      toId: edge.to,
      thisField: edge.thisField,
      relatedField: edge.relatedField,
    });
  };

  const joinTypeToggles = (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-pressed={showStructuralJoins}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowStructuralJoins((v) => !v); }}
        className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold border ${showStructuralJoins ? 'border-amber-400/50 text-amber-100' : 'border-white/10 text-blue-300/35'}`}
        title={showStructuralJoins ? 'Hide structural joins' : 'Show structural joins'}
      >
        <span className="w-5 border-t-2 border-amber-400" /> Structural
      </button>
      <button
        type="button"
        aria-pressed={showComparisonJoins}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowComparisonJoins((v) => !v); }}
        className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold border ${showComparisonJoins ? 'border-cyan-400/50 text-cyan-100' : 'border-white/10 text-blue-300/35'}`}
        title={showComparisonJoins ? 'Hide comparison joins' : 'Show comparison joins'}
      >
        <span className="w-5 border-t border-dashed border-cyan-400" /> Comparison
      </button>
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-2">
      {joinUndo && onUndoJoin ? (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUndoJoin(); }}
          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-amber-100 bg-slate-900/60 border border-amber-400/30 hover:bg-amber-500/15 flex items-center gap-1.5"
          title={`Undo: ${stellaJoinActionLabel(joinUndo)}`}
        >
          <Undo2 className="w-3.5 h-3.5" />
          Undo
        </button>
      ) : null}
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLarge((v) => !v); }}
        className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-cyan-200 bg-slate-900/60 border border-cyan-400/25 hover:bg-cyan-500/15 flex items-center gap-1.5"
        title={large ? 'Close large view' : 'Open larger view'}
      >
        {large ? <X className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        {large ? 'Close' : 'Larger view'}
      </button>
    </div>
  );

  const drawCanvas = (isLarge) => (
    <div className={`bg-slate-950/40 border border-blue-400/15 rounded-xl overflow-hidden relative ${isLarge ? 'h-full' : ''}`}>
      <svg
        ref={isLarge === large ? svgRef : undefined}
        viewBox={`0 0 ${width} ${height}`}
        className={isLarge ? 'w-full h-full' : 'w-full h-auto max-h-[460px]'}
        role="img"
        aria-label="File connection map"
        onPointerMove={onPointerMove}
        onPointerUp={(ev) => {
          if (joinDragRef.current) finishJoinDrag(ev);
          else dragRef.current = null;
        }}
      >
        {Array.from(pairBuckets.values()).map((bucket) => {
          const visibleBucket = bucket.filter((k) => (
            (k.joinType === 'structural' ? showStructuralJoins : showComparisonJoins)
          ));
          if (!visibleBucket.length) return null;
          const e0 = visibleBucket[0];
          const a = posMap.get(e0.from);
          const b = posMap.get(e0.to);
          if (!a || !b) return null;
          const pairKey = `${[e0.from, e0.to].sort().join('|')}${isLarge ? '-lg' : ''}`;
          const eitherOpen = a.expanded || b.expanded;
          const types = new Set(visibleBucket.map((k) => k.joinType || 'comparison'));
          const bundleType = types.size === 1 ? [...types][0] : 'mixed';
          const selectedPair = activeId === a.id || activeId === b.id;
          if (!eitherOpen) {
            const curve = stellaJoinCurvePath(a, b, 0, 1);
            const bundleKey = `bundle|${pairKey}`;
            const hot = hoverJoin === bundleKey;
            const stroke = hot ? 'rgb(34, 211, 238)' : stellaJoinTypeStroke(bundleType === 'mixed' ? 'comparison' : bundleType, { selected: selectedPair });
            const dash = hot ? undefined : stellaJoinTypeDash(bundleType === 'mixed' ? 'comparison' : bundleType);
            const label = stellaJoinTypeLabel(bundleType, visibleBucket.length);
            const joinHints = visibleBucket.map((k) => `${k.joinType === 'structural' ? 'Structural' : 'Comparison'}: ${k.label || `${k.thisField} ↔ ${k.relatedField}`}`).join('\n');
            const badgeFill = bundleType === 'structural' ? 'rgba(69, 26, 3, 0.94)' : 'rgba(8, 47, 73, 0.92)';
            const badgeStroke = bundleType === 'structural' ? 'rgba(252, 211, 77, 0.7)' : 'rgba(103, 232, 249, 0.45)';
            const badgeText = bundleType === 'structural' ? 'fill-amber-50' : 'fill-cyan-50';
            return (
              <g key={pairKey}>
                <path
                  d={curve.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  className="cursor-pointer"
                  onPointerEnter={() => setHoverJoin(bundleKey)}
                  onPointerLeave={() => setHoverJoin((prev) => (prev === bundleKey ? '' : prev))}
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    setExpanded((prev) => new Set([...prev, a.id, b.id]));
                    onSelectFile?.(a.id);
                  }}
                >
                  <title>{`${label} — click to expand\n${joinHints}`}</title>
                </path>
                <path d={curve.d} fill="none" stroke={stroke} strokeWidth={hot ? 2.8 : (visibleBucket.length > 1 ? 2.4 : 1.8)} strokeDasharray={dash} className="pointer-events-none" />
                <rect
                  x={curve.lx - Math.max(28, label.length * 3.4 + 8)}
                  y={curve.ly - 16}
                  width={Math.max(56, label.length * 6.8 + 16)}
                  height={16}
                  rx={4}
                  fill={badgeFill}
                  stroke={badgeStroke}
                  strokeWidth={1}
                  className="pointer-events-none"
                />
                <text
                  x={curve.lx}
                  y={curve.ly - 5}
                  textAnchor="middle"
                  className={badgeText}
                  style={{ fontSize: 10, fontWeight: 700 }}
                >
                  {label}
                </text>
              </g>
            );
          }
          return (
            <g key={pairKey}>
              {visibleBucket.map((k, i) => {
                const fromNode = posMap.get(k.from) || a;
                const toNode = posMap.get(k.to) || b;
                const fromRight = fromNode.x <= toNode.x;
                const fromPt = fromNode.expanded
                  ? stellaFieldAnchor(fromNode, k.thisField, fromRight ? 'right' : 'left')
                  : fromNode;
                const toPt = toNode.expanded
                  ? stellaFieldAnchor(toNode, k.relatedField, fromRight ? 'left' : 'right')
                  : toNode;
                const curve = stellaJoinCurvePath(fromPt, toPt, i, visibleBucket.length);
                const joinKey = `${k.from}|${k.to}|${k.thisField}|${k.relatedField}`;
                const hot = hoverJoin === joinKey;
                const joinType = k.joinType || 'comparison';
                const stroke = stellaJoinTypeStroke(joinType, { hot, selected: selectedPair });
                const dash = hot ? undefined : stellaJoinTypeDash(joinType);
                return (
                  <g key={`${k.thisField}-${k.relatedField}`}>
                    <path
                      d={curve.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      className="cursor-pointer"
                      onPointerEnter={() => setHoverJoin(joinKey)}
                      onPointerLeave={() => setHoverJoin((prev) => (prev === joinKey ? '' : prev))}
                      onClick={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        removeJoin(k);
                      }}
                    >
                      <title>Click to remove {joinType === 'structural' ? 'structural' : 'comparison'} join {k.thisField} ↔ {k.relatedField}</title>
                    </path>
                    <path d={curve.d} fill="none" stroke={stroke} strokeWidth={hot ? 2.6 : 1.8} strokeDasharray={dash} className="pointer-events-none" />
                    {fromNode.expanded ? (
                      <circle cx={fromPt.x} cy={fromPt.y} r={3.2} fill={stroke} className="pointer-events-none" />
                    ) : null}
                    {toNode.expanded ? (
                      <circle cx={toPt.x} cy={toPt.y} r={3.2} fill={stroke} className="pointer-events-none" />
                    ) : null}
                  </g>
                );
              })}
            </g>
          );
        })}
        {laid.map((n) => {
          const selected = activeId === n.id;
          const linked = n.joinCount > 0;
          const x = n.x - n.w / 2;
          const y = n.y - n.h / 2;
          const joinSet = new Set(stellaJoinFieldsForNode(n.id, graph.edges).map((f) => f.toLowerCase()));
          const isFromCard = joinFrom?.id === n.id;
          const isToCard = joinHover?.id === n.id;
          const toLooksBad = isToCard && joinHover?.verdict && joinHover.verdict !== 'ok';
          return (
            <g
              key={`${n.id}${isLarge ? '-lg' : ''}`}
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={(ev) => onPointerDown(ev, n.id)}
              onPointerMove={onPointerMove}
              onPointerUp={(ev) => onPointerUp(ev, n.id)}
            >
              <rect
                x={x}
                y={y}
                width={n.w}
                height={n.h}
                rx={10}
                fill={toLooksBad ? 'rgb(66, 32, 6)' : isToCard ? 'rgb(6, 40, 32)' : isFromCard ? 'rgb(8, 47, 73)' : selected ? 'rgb(8, 47, 73)' : 'rgba(15, 23, 42, 0.96)'}
                stroke={toLooksBad ? 'rgb(251, 191, 36)' : isToCard ? 'rgb(52, 211, 153)' : isFromCard ? 'rgb(34, 211, 238)' : selected ? 'rgb(34, 211, 238)' : linked ? 'rgba(52, 211, 153, 0.55)' : 'rgba(148, 163, 184, 0.35)'}
                strokeWidth={isFromCard || isToCard || selected ? 2.4 : 1.2}
                strokeDasharray={linked || !n.intakeComplete || isFromCard || isToCard ? undefined : '4 3'}
              />
              <text x={n.x} y={y + 18} textAnchor="middle" className="fill-white" style={{ fontSize: 11, fontWeight: 700 }}>
                {stellaFileShortName(n.name)}
              </text>
              <text
                x={n.x}
                y={y + 34}
                textAnchor="middle"
                className={linked ? 'fill-emerald-300' : 'fill-slate-400'}
                style={{ fontSize: 9 }}
              >
                {!n.intakeComplete
                  ? 'Intake pending'
                  : n.expanded
                    ? `${n.fields.length} column${n.fields.length === 1 ? '' : 's'} · drag a field to join`
                    : (linked ? 'Connected · click to expand' : 'Not joined · click to expand')}
              </text>
              {n.expanded && (
                n.fields.length
                  ? n.fields.map((field, i) => {
                    const joined = joinSet.has(field.toLowerCase());
                    const isFrom = joinFrom?.id === n.id && joinFrom.field === field;
                    const isTo = joinHover?.id === n.id && joinHover.field === field;
                    const toBad = isTo && joinHover?.verdict && joinHover.verdict !== 'ok';
                    const fy = y + STELLA_HEADER_H + 10 + i * STELLA_ROW_H;
                    return (
                      <g
                        key={field}
                        className="cursor-crosshair"
                        onPointerDown={(ev) => beginFieldJoin(ev, n.id, field)}
                      >
                        <rect
                          x={x + 6}
                          y={fy}
                          width={n.w - 12}
                          height={STELLA_ROW_H - 1}
                          rx={4}
                          fill={isFrom ? 'rgba(34, 211, 238, 0.45)' : toBad ? 'rgba(251, 191, 36, 0.45)' : isTo ? 'rgba(52, 211, 153, 0.5)' : joined ? 'rgba(8, 145, 178, 0.25)' : 'transparent'}
                          stroke={isFrom ? 'rgb(34, 211, 238)' : toBad ? 'rgb(251, 191, 36)' : isTo ? 'rgb(52, 211, 153)' : 'none'}
                          strokeWidth={isFrom || isTo ? 1.6 : 0}
                        />
                        <text
                          x={n.x}
                          y={fy + 14}
                          textAnchor="middle"
                          className={isFrom ? 'fill-cyan-50' : toBad ? 'fill-amber-50' : isTo ? 'fill-emerald-50' : joined ? 'fill-cyan-100' : 'fill-slate-300'}
                          style={{ fontSize: 10, fontWeight: isFrom || isTo ? 700 : 400, fontFamily: 'ui-monospace, monospace' }}
                        >
                          {field.length > 24 ? `${field.slice(0, 22)}…` : field}
                        </text>
                      </g>
                    );
                  })
                  : (
                    <text x={n.x} y={y + STELLA_HEADER_H + 22} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 10 }}>
                      No columns to join
                    </text>
                  )
              )}
            </g>
          );
        })}
        {joinLine ? (
          <g className="pointer-events-none">
            <path
              d={`M ${joinLine.x1} ${joinLine.y1} L ${joinLine.x2} ${joinLine.y2}`}
              fill="none"
              stroke={!joinHover ? 'rgb(34, 211, 238)' : joinHover.verdict === 'ok' ? 'rgb(52, 211, 153)' : 'rgb(251, 191, 36)'}
              strokeWidth={joinHover ? 2.8 : 2}
              strokeDasharray={joinHover && joinHover.verdict === 'ok' ? undefined : '6 4'}
            />
            <circle cx={joinLine.x1} cy={joinLine.y1} r={5} fill="rgb(34, 211, 238)" />
            {joinHover ? (
              <>
                <circle cx={joinLine.x2} cy={joinLine.y2} r={5} fill={joinHover.verdict === 'ok' ? 'rgb(52, 211, 153)' : 'rgb(251, 191, 36)'} />
                <text
                  x={(joinLine.x1 + joinLine.x2) / 2}
                  y={(joinLine.y1 + joinLine.y2) / 2 - 10}
                  textAnchor="middle"
                  className={joinHover.verdict === 'ok' ? 'fill-emerald-100' : 'fill-amber-100'}
                  style={{ fontSize: 11, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}
                >
                  {joinFrom?.field} → {joinHover.field}
                </text>
              </>
            ) : (
              <circle cx={joinLine.x2} cy={joinLine.y2} r={4} fill="rgb(34, 211, 238)" />
            )}
          </g>
        ) : null}
      </svg>
    </div>
  );

  const overlay = large ? createPortal(
    <div
      className="fixed inset-0 z-[200] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
      onClick={() => setLarge(false)}
    >
      <div
        className="w-full max-w-[1400px] h-[min(92vh,920px)] bg-slate-900 border border-cyan-400/25 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-blue-400/15">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <Link2 className="w-4 h-4 text-cyan-300" /> How files connect
            <span className="text-xs font-normal text-blue-300/60">Click a field line to remove</span>
            {joinTypeToggles}
          </div>
          {toolbar}
        </div>
        <div className="flex-1 min-h-0 p-4 overflow-hidden">
          {drawCanvas(true)}
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <details className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-5 mb-4 group">
        <summary className="cursor-pointer list-none flex items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <ChevronRight className="w-4 h-4 text-cyan-300 transition-transform group-open:rotate-90" />
              <Link2 className="w-4 h-4 text-cyan-300" /> How files connect
            </div>
            <p className="text-xs text-blue-300/60 mt-1">
              {pairCount
                ? `${pairCount} connection${pairCount === 1 ? '' : 's'}. Amber solid = structural; cyan dashed = comparison. Expand to see field joins.`
                : 'No connections yet. Expand, then drag a field onto another file to link them.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {toolbar}
            <div className="text-right text-[10px] text-blue-300/50">
              <div>{pairCount} connection{pairCount === 1 ? '' : 's'}</div>
              <div>{isolated.length} unconnected</div>
            </div>
          </div>
        </summary>

        <p className="text-xs text-blue-300/60 mt-3 mb-3">
          Click a table to list columns. Drag a field onto another table to create a join. Amber solid lines are structural (master/reference → dataset). Cyan dashed lines are comparison links.
        </p>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          {joinTypeToggles}
        </div>
        {drawCanvas(false)}
        {isolated.length > 0 && (
          <p className="text-xs text-blue-300/55 mt-3">
            {isolated.map((n) => n.name).join(', ')}
            {isolated.length === 1 ? ' has' : ' have'} no confirmed connection
            {pending.length ? ' — finish intake, or drag fields here to link them.' : '.'}
          </p>
        )}
      </details>
      {overlay}
    </>
  );
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
    return { original: orig, name: stellaSafeColumnName(orig, i, used), type: stellaInferColumnType(values), description: '', ...stellaProfileColumnValues(values) };
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
    ...d.img,
    included: false,
    reason: d.reason,
    kind: IGNORE_IMAGE_PURPOSES.has(d.purpose) ? d.purpose : 'decorative',
    purpose: d.purpose,
    src: imageDataUrl(d.img),
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

function imageDataUrl(img) {
  if (img?.src) return img.src;
  if (img?.base64) return `data:${img.mediaType || 'image/png'};base64,${img.base64}`;
  return undefined;
}

function imageWithBlob(img) {
  if (!img || typeof img !== 'object') return null;
  if (img.base64) return { ...img, src: imageDataUrl(img) };
  const src = String(img.src || '');
  const m = src.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return { ...img, src: src || undefined };
  return { ...img, mediaType: img.mediaType || m[1], base64: img.base64 || m[2], src };
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
      src: imageDataUrl(img),
      base64: img.base64,
      mediaType: img.mediaType,
    })),
    ...(unsure || []).map((img) => ({
      name: img.name,
      bytes: img.bytes,
      included: false,
      pending: true,
      purpose: img.purpose || 'other_ic',
      reason: img.reason,
      sourceFormat: img.sourceFormat || img.convertedFrom || null,
      src: imageDataUrl(img),
      base64: img.base64,
      mediaType: img.mediaType,
    })),
    ...(skipped || []).map((s) => {
      const blob = imageWithBlob(s) || s;
      return {
        name: blob.name,
        bytes: blob.bytes || 0,
        included: false,
        pending: false,
        reason: blob.reason,
        kind: blob.kind,
        purpose: blob.purpose,
        src: imageDataUrl(blob),
        base64: blob.base64,
        mediaType: blob.mediaType,
      };
    }),
  ];
}

function compactImageInventory(included, unsure, skipped) {
  const row = (img, status) => {
    const name = String(img?.name || '').trim();
    if (!name) return null;
    const purpose = String(img.purpose || img.kind || '').trim();
    const reason = String(img.reason || '').trim();
    return {
      name,
      status,
      ...(purpose ? { purpose } : {}),
      ...(reason ? { reason: reason.slice(0, 200) } : {}),
    };
  };
  return [
    ...(included || []).map((img) => row(img, 'included')),
    ...(unsure || []).map((img) => row(img, 'pending')),
    ...(skipped || []).map((img) => row(img, 'skipped')),
  ].filter(Boolean).slice(0, 80);
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
      ...img,
      reason: `Relevant but beyond ${maxImages}-image extract limit`,
      kind: 'capped',
      purpose: classByName[img.name]?.purpose,
      included: false,
      src: imageDataUrl(img),
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
  const sample = rowCount > STELLA_PROFILE_SCAN_CAP ? records.slice(0, STELLA_PROFILE_SCAN_CAP) : records;
  const headers = Object.keys(records[0] || {});
  const lines = [
    `Total rows: ${rowCount}`,
    `Columns (${headers.length}): ${headers.join(', ')}`,
  ];
  if (sample.length < rowCount) {
    lines.push(`Column profile from the first ${sample.length} rows (table is larger — query SQL for full-table stats).`);
  }
  lines.push('', 'Per-column profile:');
  for (const h of headers) {
    const values = sample.map(r => r?.[h]).filter(v => v !== null && v !== undefined && v !== '');
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

function stellaClipNamePart(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/^[«"']+|[»"'.]+$/g, '').slice(0, 80);
}

function stellaNormalizeNameMaps(raw) {
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item) continue;
    const from = stellaClipNamePart(item.from || item.local || item.source || item.alias);
    const to = stellaClipNamePart(item.to || item.global || item.canonical || item.target || item.maps_to);
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue;
    const key = `${from.toLowerCase()}=>${to.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const note = stellaClipNamePart(item.note);
    out.push(note ? { from, to, note } : { from, to });
  }
  return out;
}

function stellaExtractNameMapsFromText(text) {
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  if (src.length < 12) return [];
  const found = [];
  const push = (from, to, note) => {
    stellaNormalizeNameMaps([{ from, to, note }]).forEach((m) => found.push(m));
  };
  const patterns = [
    /["']?([^"'.,;:]{2,80}?)["']?\s+is the\s+(.{0,40}?)name for\s+["']?([^"'.,;:]{2,80}?)["']?(?:[.,;]|$)/gi,
    /["']?([^"'.,;:]{2,80}?)["']?\s+(?:maps?|mapped)\s+to\s+["']?([^"'.,;:]{2,80}?)["']?(?:[.,;]|$)/gi,
    /["']?([^"'.,;:]{2,80}?)["']?\s+is also (?:known as|called)\s+["']?([^"'.,;:]{2,80}?)["']?(?:[.,;]|$)/gi,
    /["']?([^"'.,;:]{2,80}?)["']?\s+and\s+["']?([^"'.,;:]{2,80}?)["']?\s+are the same (?:product|brand|sku)/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(src))) {
      if (match.length >= 4 && match[3] && re === patterns[0]) push(match[1], match[3], match[2] ? String(match[2]).trim() : '');
      else push(match[1], match[2], '');
    }
  }
  return stellaNormalizeNameMaps(found);
}

function stellaCollectNameMaps(ctx, intakeMessages = []) {
  const blobs = [];
  const base = ctx && typeof ctx === 'object' ? ctx : {};
  const fromModel = stellaNormalizeNameMaps(base.name_maps || base.aliases || base.value_maps);
  if (base.interpretation_notes) blobs.push(base.interpretation_notes);
  (Array.isArray(base.qa_pairs) ? base.qa_pairs : []).forEach((p) => {
    if (p?.answer) blobs.push(p.answer);
    if (p?.question && p?.answer) blobs.push(`${p.question} ${p.answer}`);
  });
  (intakeMessages || []).forEach((m) => {
    if (m?.role === 'user' && m.content) blobs.push(m.content);
  });
  return stellaNormalizeNameMaps([
    ...fromModel,
    ...blobs.flatMap((t) => stellaExtractNameMapsFromText(t)),
  ]);
}

function stellaNameMapFact(map) {
  if (!map?.from || !map?.to) return '';
  const note = String(map.note || '').trim().replace(/\s*name$/i, '');
  if (note) return `${map.from} is the ${note} name for ${map.to}`.replace(/\s+/g, ' ').trim();
  return `${map.from} is the same product as ${map.to}`;
}

function factsFromStellaCapturedContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return [];
  const facts = [];
  const push = (raw) => {
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 280);
    if (text.length >= 12) facts.push(text);
  };
  for (const map of stellaCollectNameMaps(ctx)) {
    push(stellaNameMapFact(map));
  }
  push(ctx.interpretation_notes);
  push(ctx.what_it_represents);
  const period = String(ctx.time_period || '').trim();
  if (period.length >= 8) push(`This file covers ${period}`);
  (Array.isArray(ctx.key_facts) ? ctx.key_facts : []).forEach((m) => push(m));
  (Array.isArray(ctx.key_metrics) ? ctx.key_metrics : []).forEach((m) => push(m));
  (Array.isArray(ctx.qa_pairs) ? ctx.qa_pairs : []).forEach((p) => {
    push(intakePairFact(p));
  });
  (Array.isArray(ctx.relationships) ? ctx.relationships : []).forEach((r) => {
    const tf = String(r?.this_field || '').trim();
    const rf = String(r?.related_field || '').trim();
    const other = String(r?.related_table || r?.related_file || '').trim();
    if (tf && rf) push(`Join ${tf} to ${rf}${other ? ` on ${other}` : ''}`);
  });
  return facts;
}

function factsFromStellaFiles(files) {
  return (Array.isArray(files) ? files : []).flatMap((f) => {
    const extra = [];
    const name = String(f?.name || '').trim();
    if (name.length >= 4) extra.push(`Uploaded file ${name}`);
    const table = String(f?.tableName || '').trim();
    if (table) extra.push(`SQL table ${table}`);
    return [...extra, ...factsFromStellaCapturedContext(f?.capturedContext)];
  });
}

// Human-readable rendering of the structured context_qa JSON for prompts.
function stellaFormatContextQa(ctx) {
  if (!ctx || typeof ctx !== 'object') return '(no interpretive context captured yet)';
  const lines = [];
  const maps = stellaCollectNameMaps(ctx);
  if (maps.length) {
    lines.push('NAME MAPS (authoritative — treat these as the same product; apply in queries, do not re-ask, do not ask to update chat memory):');
    maps.forEach((m) => {
      lines.push(`  - "${m.from}" = "${m.to}"${m.note ? ` (${m.note})` : ''}`);
    });
  }
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
    const facts = ctx.qa_pairs.map((p) => intakePairFact(p)).filter(Boolean);
    if (facts.length) {
      lines.push('Intake facts:');
      facts.forEach((fact) => lines.push(`  - ${fact}`));
    }
  }
  return lines.length ? lines.join('\n') : '(no interpretive context captured yet)';
}

function stellaContextText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  const s = String(value).trim();
  return s ? s : '';
}

function InlineCapturedText({ value, onSave, line }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || '');
  useEffect(() => { setText(value || ''); }, [value]);
  if (!onSave) return <span className="whitespace-pre-wrap break-words">{value}</span>;
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left w-full whitespace-pre-wrap break-words hover:bg-white/5 rounded px-0.5 -mx-0.5"
        title="Click to edit"
      >
        {value}
      </button>
    );
  }
  const shared = 'w-full bg-slate-950/50 text-emerald-50 border border-emerald-400/30 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-emerald-400';
  const commit = () => {
    setEditing(false);
    if (text !== (value || '')) onSave(text);
  };
  if (line) {
    return (
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className={shared}
      />
    );
  }
  return (
    <textarea
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
      rows={3}
      className={`${shared} resize-y`}
    />
  );
}

function StellaCapturedContextView({ ctx, onPatch, onRemoveJoin }) {
  if (!ctx || typeof ctx !== 'object') {
    return <p className="text-xs text-emerald-200/70">No captured facts yet.</p>;
  }
  const maps = stellaCollectNameMaps(ctx);
  const metrics = stellaContextText(ctx.key_metrics);
  const metricList = Array.isArray(metrics) ? metrics : (metrics ? [metrics] : []);
  const factRaw = stellaContextText(ctx.key_facts);
  const factList = Array.isArray(factRaw) ? factRaw : (factRaw ? [factRaw] : []);
  const rels = (Array.isArray(ctx.relationships) ? ctx.relationships : []).filter((r) => r && (r.related_file || r.related_table));
  const qa = (Array.isArray(ctx.qa_pairs) ? ctx.qa_pairs : []).filter((p) => p && (intakePairFact(p) || p.question || p.answer));
  const represents = String(ctx.what_it_represents || '').trim();
  const period = String(ctx.time_period || '').trim();
  const notes = String(ctx.interpretation_notes || '').trim();
  const hasAny = represents || period || factList.length || metricList.length || notes || maps.length || rels.length || qa.length;
  if (!hasAny) {
    return <p className="text-xs text-emerald-200/70">No captured facts yet.</p>;
  }

  const editable = typeof onPatch === 'function';
  const Remove = ({ onClick, label }) => (
    editable ? (
      <button
        type="button"
        onClick={onClick}
        className="p-0.5 rounded text-red-400/80 hover:text-red-300 hover:bg-red-500/15 shrink-0"
        title={label || 'Remove this'}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    ) : null
  );

  const Section = ({ title, onRemove, children }) => (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-400/80">{title}</div>
        {onRemove ? <Remove onClick={onRemove} label={`Remove ${title.toLowerCase()}`} /> : null}
      </div>
      <div className="text-xs text-emerald-50/95 leading-relaxed">{children}</div>
    </div>
  );

  const patchList = (key, list) => onPatch({ ...ctx, [key]: list });

  return (
    <div className="px-4 pb-4 space-y-3">
      {editable ? (
        <div className="flex items-center justify-between gap-2 pb-1">
          <p className="text-[11px] text-emerald-200/60">Click text to update. Remove anything that is wrong — it will stop being used.</p>
          <button
            type="button"
            onClick={() => onPatch(null)}
            className="text-[11px] font-semibold text-red-300 hover:text-red-200"
          >
            Remove all
          </button>
        </div>
      ) : null}
      {represents ? (
        <Section title="What this file is" onRemove={() => onPatch({ ...ctx, what_it_represents: '' })}>
          <InlineCapturedText value={represents} onSave={editable ? (v) => onPatch({ ...ctx, what_it_represents: v }) : undefined} line />
        </Section>
      ) : null}
      {period ? (
        <Section title="Time period" onRemove={() => onPatch({ ...ctx, time_period: '' })}>
          <InlineCapturedText value={period} onSave={editable ? (v) => onPatch({ ...ctx, time_period: v }) : undefined} line />
        </Section>
      ) : null}
      {factList.length ? (
        <Section title="Key facts" onRemove={() => onPatch({ ...ctx, key_facts: [] })}>
          <ul className="list-disc pl-4 space-y-1">
            {factList.map((m, i) => (
              <li key={`${m}-${i}`} className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <InlineCapturedText
                    value={m}
                    onSave={editable ? (v) => patchList('key_facts', factList.map((x, idx) => (idx === i ? v : x)).filter((x) => String(x || '').trim())) : undefined}
                    line
                  />
                </div>
                <Remove onClick={() => patchList('key_facts', factList.filter((_, idx) => idx !== i))} label="Remove this fact" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {metricList.length ? (
        <Section title="Columns / contents" onRemove={() => onPatch({ ...ctx, key_metrics: [] })}>
          <ul className="list-disc pl-4 space-y-1">
            {metricList.map((m, i) => (
              <li key={`${m}-${i}`} className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <InlineCapturedText
                    value={m}
                    onSave={editable ? (v) => patchList('key_metrics', metricList.map((x, idx) => (idx === i ? v : x)).filter((x) => String(x || '').trim())) : undefined}
                    line
                  />
                </div>
                <Remove onClick={() => patchList('key_metrics', metricList.filter((_, idx) => idx !== i))} label="Remove this field" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {notes ? (
        <Section title="How to read it" onRemove={() => onPatch({ ...ctx, interpretation_notes: '' })}>
          <InlineCapturedText value={notes} onSave={editable ? (v) => onPatch({ ...ctx, interpretation_notes: v }) : undefined} />
        </Section>
      ) : null}
      {maps.length ? (
        <Section title="Same product, different names">
          <ul className="space-y-1">
            {maps.map((m, i) => (
              <li key={`${m.from}-${m.to}-${i}`} className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-cyan-200 font-semibold">{m.from}</span>
                  <span className="text-emerald-300/50"> is </span>
                  <span className="text-cyan-200 font-semibold">{m.to}</span>
                  {m.note ? <span className="text-emerald-200/60"> — {m.note}</span> : null}
                </div>
                <Remove
                  onClick={() => onPatch({ ...ctx, name_maps: maps.filter((_, idx) => idx !== i) })}
                  label="Remove this name map"
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {rels.length ? (
        <Section title="Joins to other files">
          <ul className="space-y-1.5">
            {rels.map((r, i) => {
              const target = r.related_file || r.related_table || 'another file';
              const join = (r.this_field && r.related_field)
                ? `${r.this_field} matches ${r.related_field}`
                : '';
              return (
                <li key={`${target}-${r.this_field}-${i}`} className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-cyan-200 font-semibold">{target}</span>
                    {join ? <span className="text-emerald-200/80"> — {join}</span> : null}
                    {r.note ? <div className="text-emerald-200/60 mt-0.5">{r.note}</div> : null}
                  </div>
                  <Remove
                    onClick={() => (onRemoveJoin ? onRemoveJoin(r) : onPatch({
                      ...ctx,
                      relationships: rels.filter((_, idx) => idx !== i),
                    }))}
                    label="Remove this join"
                  />
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
      {qa.length ? (
        <Section title="Intake facts">
          <ol className="space-y-2">
            {qa.map((p, i) => {
              const fact = intakePairFact(p);
              if (!fact) return null;
              return (
                <li key={i} className="bg-slate-950/35 border border-emerald-400/15 rounded-lg px-3 py-2 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <InlineCapturedText
                      value={fact}
                      onSave={editable ? (v) => onPatch({
                        ...ctx,
                        qa_pairs: qa.map((row, idx) => (idx === i ? { ...row, fact: v, answer: v } : row)),
                      }) : undefined}
                    />
                  </div>
                  <Remove
                    onClick={() => onPatch({ ...ctx, qa_pairs: qa.filter((_, idx) => idx !== i) })}
                    label="Remove this fact"
                  />
                </li>
              );
            })}
          </ol>
        </Section>
      ) : null}
    </div>
  );
}

// Map a stella_files DB row into the local file object used by the UI.
function stellaSchemaStatusFromPayload(payload) {
  const name = typeof payload?.schema === 'string' ? payload.schema.trim() : '';
  if (!name) return null;
  return {
    name,
    company: typeof payload?.company === 'string' ? payload.company.trim() : '',
    ready: payload.schemaReady !== false,
    error: typeof payload.schemaError === 'string' ? payload.schemaError.trim() : '',
  };
}

function stellaParseRegistryJson(val) {
  let cur = val;
  for (let i = 0; i < 2; i += 1) {
    if (typeof cur !== 'string') break;
    const t = cur.trim();
    if (!t || (t[0] !== '{' && t[0] !== '[' && t[0] !== '"')) break;
    try { cur = JSON.parse(t); } catch { break; }
  }
  return cur;
}

function stellaColumnsForRegistry(columns) {
  return (Array.isArray(columns) ? columns : []).map((c) => ({
    name: c?.name || '',
    original: c?.original || c?.name || '',
    type: c?.type || '',
    description: c?.description || '',
    kind: c?.kind || '',
    samples: Array.isArray(c?.samples) ? c.samples.slice(0, 8) : [],
  }));
}

function stellaMergeRegistryFiles(prev, mapped) {
  const prevList = Array.isArray(prev) ? prev : [];
  const mappedList = Array.isArray(mapped) ? mapped : [];
  const prevById = new globalThis.Map(prevList.filter((f) => f.dbId).map((f) => [f.dbId, f]));
  const merged = mappedList.map((m) => {
    const p = prevById.get(m.dbId);
    const keepLive = p && !p.intakeComplete && (p.intakeMessages?.length || 0) > (m.intakeMessages?.length || 0);
    const next = keepLive
      ? { ...m, intakeMessages: p.intakeMessages, capturedContext: p.capturedContext || m.capturedContext }
      : m;
    return {
      ...next,
      previewRows: (p?.previewRows?.length ? p.previewRows : next.previewRows) || [],
      extractedText: p?.extractedText || next.extractedText || '',
      columns: (Array.isArray(p?.columns) && p.columns.some((c) => c?.samples?.length)
        && !(next.columns || []).some((c) => c?.samples?.length))
        ? p.columns
        : next.columns,
      processing: p?.processing || next.processing,
    };
  });
  const mappedIds = new Set(mappedList.map((m) => m.dbId).filter(Boolean));
  const keepLocal = prevList.filter((f) => {
    if (!f) return false;
    if (!f.dbId) return true;
    return !mappedIds.has(f.dbId);
  });
  return [...merged, ...keepLocal];
}

function stellaMapRegistryRow(row) {
  const parsedCtx = stellaParseRegistryJson(row.context_qa);
  const rawCtx = parsedCtx && typeof parsedCtx === 'object' && !Array.isArray(parsedCtx) ? parsedCtx : null;
  const parsedColumns = stellaParseRegistryJson(row.columns);
  const maps = rawCtx ? stellaCollectNameMaps(rawCtx) : [];
  const ctx = rawCtx && maps.length ? { ...rawCtx, name_maps: maps } : rawCtx;
  const schemaChanged = !!(ctx && ctx.schema_changed);
  const qa = ctx && Array.isArray(ctx.qa_pairs) ? ctx.qa_pairs : [];
  let intakeMessages = qa.flatMap(p => [
    ...(p && p.question ? [{ role: 'assistant', content: p.question }] : []),
    ...(p && p.answer ? [{ role: 'user', content: p.answer }] : []),
  ]);
  if (schemaChanged) {
    intakeMessages = [
      { role: 'assistant', content: 'This file was refreshed from the inbox with different columns. Confirm the context still applies, then send a short reply to complete intake.' },
      ...intakeMessages,
    ];
  } else if (!ctx && /scheduled inbox/i.test(String(row.summary || ''))) {
    intakeMessages = [
      { role: 'assistant', content: `⏳ Assessing **${row.file_name}** from the inbox…` },
    ];
  }
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
    uploadedBy: row.uploaded_by || null,
    uploadedByName: row.uploaded_by_name || null,
    columns: Array.isArray(parsedColumns) ? parsedColumns : [],
    previewRows: stellaPreviewRowsFromColumns(Array.isArray(parsedColumns) ? parsedColumns : [], 3),
    rowCount: row.row_count ?? null,
    summary: row.summary || '',
    capturedContext: ctx,
    intakeMessages,
    intakeComplete: !!ctx && !schemaChanged,
    uploadedAt: row.uploaded_at,
    size: row.row_count != null ? `${row.row_count} rows` : '',
    processing: false,
  };
}

function stellaFileNeedsOpeningIntake(f) {
  if (!f || f.processing || f.intakeComplete) return false;
  const msgs = f.intakeMessages || [];
  const first = String(msgs[0]?.content || '');
  if (/I assessed this file from its contents/i.test(first) || /^✅ /.test(first)) return false;
  if (stellaIntakeAskedJoin(msgs)) return false;
  const schemaStub = !!(f.capturedContext && f.capturedContext.schema_changed)
    || /refreshed from the inbox with different columns/i.test(first);
  if (msgs.some((m) => m?.role === 'user') && !schemaStub) return false;
  const scheduledStub = /scheduled inbox/i.test(String(f.summary || ''))
    || /Imported from the scheduled inbox/i.test(first)
    || /Assessing \*\*.*from the inbox/i.test(first);
  return scheduledStub || schemaStub;
}

function stellaIntakeNeedsJsonSalvage(f) {
  if (!f || f.processing || f.intakeComplete) return false;
  const msgs = Array.isArray(f.intakeMessages) ? f.intakeMessages : [];
  if (!msgs.some((m) => m?.role === 'user')) return false;
  const last = [...msgs].reverse().find((m) => m?.role === 'assistant');
  return !!(last && intakeChatLooksLikeJson(last.content));
}

function TerritoryMap({ points, selectedTerritory, onSelectTerritory }) {
  const iframeRef = useRef(null);
  const [iframeKey, setIframeKey] = useState(0);
  const selectedId = selectedTerritory?.id || selectedTerritory?.territory || null;

  useEffect(() => {
    const sig = (points || []).map((p) => `${p.id}:${Number(p.lat)}:${Number(p.lng)}`).join('|');
    setIframeKey((k) => k + 1);
    void sig;
  }, [points]);

  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type !== 'territory-select') return;
      const hit = (points || []).find((p) => p.id === event.data.id || p.territory === event.data.territory);
      if (hit) onSelectTerritory(selectedTerritory?.id === hit.id ? null : hit);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [points, selectedTerritory, onSelectTerritory]);

  const html = useMemo(
    () => (points?.length ? buildTerritoryPointsMapHTML(points, selectedId) : ''),
    [points, selectedId],
  );

  if (!points?.length) return null;

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
class MessageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ComEx render error:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = String(this.state.error?.message || this.state.error);
    const retry = (
      <button
        type="button"
        onClick={() => this.setState({ error: null })}
        className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-500/80 hover:bg-red-500"
      >
        Try again
      </button>
    );
    if (this.props.fallback) {
      return (
        <div>
          {this.props.fallback}
          <pre className="mt-3 text-[11px] text-red-200/85 whitespace-pre-wrap font-mono">{message}</pre>
          {retry}
        </div>
      );
    }
    return (
      <div className="text-xs text-red-300">
        Could not render this. {message}
        {retry}
      </div>
    );
  }
}

/** Runs a render callback as a child so errors are caught by MessageErrorBoundary. */
function StellaSafePanel({ render }) {
  return render();
}

function PayoutCurveChart({ curveData }) {
  const chartRef = useRef(null);
  if (!Array.isArray(curveData) || curveData.length === 0) return null;
  const W = 800, H = 300, PAD_L = 80, PAD_R = 20, PAD_T = 20, PAD_B = 40;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const xMax = Math.ceil(Math.max(150, ...curveData.map((p) => p.performance)) / 50) * 50;
  const yMax = Math.ceil(Math.max(150, ...curveData.map((p) => p.payout)) / 50) * 50;
  const thresholdPerf = (curveData.find((p) => p.payout > 0) || curveData[0]).performance;
  const xMin = Math.max(0, Math.floor((thresholdPerf - 10) / 25) * 25);
  const toX = (v) => PAD_L + ((v - xMin) / (xMax - xMin)) * chartW;
  const toY = (v) => PAD_T + chartH - (v / yMax) * chartH;
  const fullLine = [{ performance: thresholdPerf, payout: 0 }, ...curveData];
  const xTicks = Array.from({ length: Math.floor((xMax - xMin) / 25) + 1 }, (_, i) => xMin + i * 25);
  const yTicks = Array.from({ length: Math.floor(yMax / 50) + 1 }, (_, i) => i * 50);
  const exportRows = curveData.map((p) => ({
    'Performance %': p.performance,
    'Payout %': p.payout,
    Status: p.payout === 0 ? 'No Payout' : p.payout < 100 ? 'Below Target' : p.payout === 100 ? 'On Target' : 'Accelerator',
  }));
  return (
    <div className="bg-slate-900/50 border border-blue-400/30 rounded-lg p-4 my-4 min-w-0 max-w-full overflow-x-hidden">
      <h3 className="text-base font-semibold text-cyan-400 mb-3">💹 Payout Curve</h3>
      <div ref={chartRef} className="bg-slate-800/50 rounded p-2 mb-4 w-full min-w-0" style={{ height: '280px' }}>
          <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
            {yTicks.map((v) => <line key={v} x1={PAD_L} y1={toY(v)} x2={W - PAD_R} y2={toY(v)} stroke="#334155" strokeWidth="0.5" />)}
            {xTicks.map((v) => <line key={v} x1={toX(v)} y1={PAD_T} x2={toX(v)} y2={PAD_T + chartH} stroke="#334155" strokeWidth="0.5" />)}
            <line x1={PAD_L} y1={PAD_T + chartH} x2={W - PAD_R} y2={PAD_T + chartH} stroke="#94a3b8" strokeWidth="2" />
            <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + chartH} stroke="#94a3b8" strokeWidth="2" />
            {yTicks.map((v) => <text key={v} x={PAD_L - 8} y={toY(v) + 4} textAnchor="end" fill="#94a3b8" fontSize="11">{v}%</text>)}
            {xTicks.filter((v) => v % 25 === 0).map((v) => <text key={v} x={toX(v)} y={PAD_T + chartH + 16} textAnchor="middle" fill="#94a3b8" fontSize="11">{v}%</text>)}
            <text x={PAD_L + chartW / 2} y={H - 2} textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="bold">Performance (% of Quota)</text>
            <text x="12" y={PAD_T + chartH / 2} textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="bold" transform={`rotate(-90,12,${PAD_T + chartH / 2})`}>Payout (%)</text>
            <line x1={toX(100)} y1={PAD_T} x2={toX(100)} y2={PAD_T + chartH} stroke="#10b981" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7" />
            <line x1={PAD_L} y1={toY(100)} x2={W - PAD_R} y2={toY(100)} stroke="#10b981" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7" />
            <text x={toX(100) + 4} y={PAD_T + 14} fill="#10b981" fontSize="11" fontWeight="bold">100% Target</text>
            <polyline points={fullLine.map((p) => `${toX(p.performance)},${toY(p.payout)}`).join(' ')} fill="none" stroke="#22d3ee" strokeWidth="3" />
            {curveData.map((p, i) => {
              const color = p.payout === 0 ? '#ef4444' : p.payout < 100 ? '#eab308' : p.payout === 100 ? '#10b981' : '#22d3ee';
              return <circle key={i} cx={toX(p.performance)} cy={toY(p.payout)} r="6" fill={color} stroke="#1e293b" strokeWidth="2" />;
            })}
          </svg>
        </div>
      <table className="w-full table-fixed border-collapse border border-blue-400/30 rounded text-xs">
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
      <div className="flex justify-end mt-1.5">
        <ExcelExportButton
          rows={exportRows}
          sheetName="Payout curve"
          filename="payout-curve"
          label="Export this chart to Excel"
          chartRef={chartRef}
        />
      </div>
    </div>
  );
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

function readStellaIntakeDeepLink() {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search);
    const open = String(q.get('open') || '').trim().toLowerCase();
    const fileId = String(q.get('file') || q.get('stellaIntake') || '').trim();
    const fileName = String(q.get('fileName') || '').trim();
    if (open !== 'stella-intake' && !q.has('stellaIntake') && !fileId) return null;
    return { fileId, fileName };
  } catch {
    return null;
  }
}

function clearStellaIntakeDeepLink() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    ['open', 'file', 'fileName', 'stellaIntake'].forEach((key) => url.searchParams.delete(key));
    const next = `${url.pathname}${url.search}${url.hash}` || '/';
    window.history.replaceState({}, '', next);
  } catch { /* ignore */ }
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
  const [activeTab, setActiveTab] = useState(() => (readStellaIntakeDeepLink() ? 'user-settings' : 'chat'));
  const [showLanding, setShowLanding] = useState(() => !readStellaIntakeDeepLink());
  const [chatSessions, setChatSessions] = useState(() => readCachedChatIndex(currentUser.id).chats);
  const [activeChatId, setActiveChatId] = useState(() => readCachedChatIndex(currentUser.id).activeChatId || null);
  const [chatIndexLoading, setChatIndexLoading] = useState(() => !readCachedChatIndex(currentUser.id).chats.length);
  const [openingChatId, setOpeningChatId] = useState(null);
  const [messages, setMessages] = useState(() => [consultationWelcome()]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentWorkflow, setCurrentWorkflow] = useState(null);
  const [pendingWorkflow, setPendingWorkflow] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [stellaSettingsTab, setStellaSettingsTab] = useState('connections'); // connections | goals
  const [stellaConnectionsTab, setStellaConnectionsTab] = useState('files'); // files | connector id
  const [stellaFilesInnerTab, setStellaFilesInnerTab] = useState('list'); // list | schedule
  const [stellaMessages, setStellaMessages] = useState(() => [stellaWelcome()]);
  const [stellaInput, setStellaInput] = useState('');
  const [stellaIsLoading, setStellaIsLoading] = useState(false);
  const [stellaDataFiles, setStellaDataFiles] = useState([]); // { id, name, type, size, uploadedAt, storageBucket, storagePath, metaPath, summary, capturedContext, intakeMessages }
  const [stellaTenantSchema, setStellaTenantSchema] = useState(null); // { name, ready }
  const [stellaJoinPending, setStellaJoinPending] = useState(null);
  const [stellaJoinUndo, setStellaJoinUndo] = useState(null);
  useEffect(() => {
    if (!stellaJoinPending) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setStellaJoinPending(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stellaJoinPending]);
  const [activeStellaDataId, setActiveStellaDataId] = useState(null);
  const [stellaIntakeInput, setStellaIntakeInput] = useState('');
  const [stellaIntakeMinimized, setStellaIntakeMinimized] = useState(false);
  const [stellaBusinessContext, setStellaBusinessContext] = useState(() => mergeStellaBusinessContext({}));
  const [stellaBizSaveStatus, setStellaBizSaveStatus] = useState('idle'); // idle | saving | saved | error
  const [userSettings, setUserSettings] = useState(() => mergeUserSettingsFields({}));
  const [productIntel, setProductIntel] = useState(() => readLocalProductIntelligence());
  const [userSettingsSaveStatus, setUserSettingsSaveStatus] = useState('idle'); // idle | saving | saved | saved-local | error
  const [userSettingsCloudError, setUserSettingsCloudError] = useState('');
  const [userSettingsPane, setUserSettingsPane] = useState(() => (
    readStellaIntakeDeepLink() ? 'stella' : 'general'
  ));
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
  const [pendingModuleContextIntake, setPendingModuleContextIntake] = useState(null);
  const pendingModuleContextIntakeRef = useRef(null);
  const [contextIngestJob, setContextIngestJob] = useState(null);
  const contextIngestJobRef = useRef(null);
  const [contextImagePreviewsByFile, setContextImagePreviewsByFile] = useState({}); // { [fileId]: previews[] } session-only clickable thumbs
  const contextImageAssetsRef = useRef({}); // { [fileId]: { included, unsure, skipped } } blobs for toggling use
  const [contextImageBusy, setContextImageBusy] = useState(null); // { fileId, name }
  const [activeContextFileId, setActiveContextFileId] = useState(null);
  const [contextIntakeInput, setContextIntakeInput] = useState('');
  const [contextIntakeByFile, setContextIntakeByFile] = useState({});
  const [contextIntakeBusy, setContextIntakeBusy] = useState(false);
  const [contextEditSaveStatus, setContextEditSaveStatus] = useState('idle');
  const [contextFileDeleteConfirm, setContextFileDeleteConfirm] = useState(null);
  const [landingLinkDrag, setLandingLinkDrag] = useState(null);
  const [landingCardRects, setLandingCardRects] = useState({});
  const [landingLinkNotice, setLandingLinkNotice] = useState('');
  const landingBoardRef = useRef(null);
  const landingCardRefs = useRef({});
  const chatSessionsRef = useRef(chatSessions);
  const activeChatIdRef = useRef(activeChatId);
  const messagesRef = useRef(messages);
  const stellaMessagesRef = useRef(stellaMessages);
  const activeTabRef = useRef('chat');
  const currentWorkflowRef = useRef(currentWorkflow);
  const pendingWorkflowRef = useRef(pendingWorkflow);
  const uploadedFileRef = useRef(uploadedFile);
  const userSettingsRef = useRef(userSettings);
  const stellaDataFilesRef = useRef(stellaDataFiles);
  const runWithStellaDataToolsRef = useRef(null);
  const stellaHydrateColumnProfilesRef = useRef(async () => {});
  const persistChatsTimerRef = useRef(null);
  const persistStellaChatsTimerRef = useRef(null);
  const skipChatPersistRef = useRef(false);
  const chatsBodiesRef = useRef([]);
  const chatsFullLoadedRef = useRef(false);
  const chatsFullPromiseRef = useRef(null);
  const userSettingsReadyRef = useRef(false);
  const harvestMemoryBusyRef = useRef(false);
  const harvestMemoryPendingRef = useRef(null);
  const memoryBackfillDoneRef = useRef(false);
  const pendingMemoryConfirmRef = useRef(null);
  const memoryResumeRef = useRef(null);
  const memoryCustomForcedRef = useRef(false);
  const skipMemoryHarvestRef = useRef(false);
  const stellaResumeRef = useRef(null);
  const declinedWorkflowIdsRef = useRef(new Set());
  const [pendingMemoryConfirm, setPendingMemoryConfirm] = useState(null);
  const memoryPendingFor = (thread) => {
    const pending = pendingMemoryConfirmRef.current || pendingMemoryConfirm;
    if (!pending) return null;
    return memoryConfirmThreadOf(pending) === thread ? pending : null;
  };
  const [memoryCustomOpen, setMemoryCustomOpen] = useState(false);
  const [memoryCustomDraft, setMemoryCustomDraft] = useState('');
  const memoryCustomInputRef = useRef(null);
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
  const [chatToolsCollapsed, setChatToolsCollapsed] = useState(() => {
    try { return localStorage.getItem('comex-chat-tools-collapsed') === '1'; } catch { return false; }
  });
  const [mobileChatToolsOpen, setMobileChatToolsOpen] = useState(false);
  const toggleChatToolsCollapsed = () => {
    setChatToolsCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem('comex-chat-tools-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };
  const [agents, setAgents] = useState(() => readLocalProductIntelligence().agents);

  const [topics, setTopics] = useState(() => readLocalProductIntelligence().topics);

  const [orchestratorDecision, setOrchestratorDecision] = useState(null);
  const [pendingButtonAction, setPendingButtonAction] = useState(null);
  const [selectedTerritoryFileId, setSelectedTerritoryFileId] = useState(null);
  const [selectedTerritoryTeam, setSelectedTerritoryTeam] = useState('');
  const [selectedTerritory, setSelectedTerritory] = useState(null);
  const [territoryView, setTerritoryView] = useState('map');
  const [territoryMapPayload, setTerritoryMapPayload] = useState(null);
  const [territoryMapBusy, setTerritoryMapBusy] = useState(false);
  const [territoryMapError, setTerritoryMapError] = useState('');
  const [territoryIntakeInput, setTerritoryIntakeInput] = useState('');
  const [territoryIntakeBusy, setTerritoryIntakeBusy] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [adminSection, setAdminSection] = useState('knowledge');
  const [adminModule, setAdminModule] = useState('incentive'); // incentive | territory | stella
  const [editingWorkflowId, setEditingWorkflowId] = useState(null);
  const [editingTopic, setEditingTopic] = useState(null);
  const [editingTopicTab, setEditingTopicTab] = useState('basics'); // basics | orchestrator | steps
  const [expandedSteps, setExpandedSteps] = useState({});
  const [editingAgent, setEditingAgent] = useState(null);
  const [wfBuilderMessages, setWfBuilderMessages] = useState([]);
  const [wfBuilderInput, setWfBuilderInput] = useState('');
  const [wfBuilderLoading, setWfBuilderLoading] = useState(false);
  const [wfBuilderDraft, setWfBuilderDraft] = useState(null);
  const [wfBuilderReady, setWfBuilderReady] = useState(false);
  const [wfBuilderFocusId, setWfBuilderFocusId] = useState('');
  const [wfBuilderIntent, setWfBuilderIntent] = useState('create');
  const [wfBuilderOpen, setWfBuilderOpen] = useState(false);
  const [wfBuilderError, setWfBuilderError] = useState('');
  const [wfBuilderApplying, setWfBuilderApplying] = useState(false);
  const [wfBuilderThinking, setWfBuilderThinking] = useState('');
  const wfBuilderEndRef = useRef(null);
  const wfBuilderPanelRef = useRef(null);
  const wfBuilderChatRef = useRef(null);
  const wfListRef = useRef(null);
  const wfCardRefs = useRef({});
  const [wfSavedId, setWfSavedId] = useState('');
  const [suggestedPrompts, setSuggestedPrompts] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(() => readLocalProductIntelligence().suggestions.enabled);
  const [maxSuggestions, setMaxSuggestions] = useState(() => readLocalProductIntelligence().suggestions.max);
  const [customSystemPrompt, setCustomSystemPrompt] = useState(() => readLocalProductIntelligence().systemPrompt);
  const [pptxOffers, setPptxOffers] = useState(null);
  const [pptxGenerating, setPptxGenerating] = useState(false);
  const [pptxClarifyPending, setPptxClarifyPending] = useState(false);
  const [toolsPptxPick, setToolsPptxPick] = useState(false);
  const [hoveredCitation, setHoveredCitation] = useState(null);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const adminFileInputRef = useRef(null);
  const territoryFileInputRef = useRef(null);
  const territoryMapAbortRef = useRef(0);
  const stellaDataFileInputRef = useRef(null);
  const [stellaSyncBusy, setStellaSyncBusy] = useState(false);
  const stellaIntakeDeepLinkRef = useRef(readStellaIntakeDeepLink());
  const stellaOpeningIntakeBusyRef = useRef(new Set());
  const pptxTemplateInputRef = useRef(null);
  const moduleContextFileInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const el = wfBuilderChatRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [wfBuilderMessages, wfBuilderLoading, wfBuilderThinking, wfBuilderDraft]);

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

  const applyChatIndex = (indexChats, remoteActive) => {
    skipChatPersistRef.current = true;
    const cached = readCachedChatIndex(currentUser.id);
    const chats = unionChats(indexChats, cached.chats);
    if (!chats.length) {
      setChatIndexLoading(false);
      setTimeout(() => { skipChatPersistRef.current = false; }, 0);
      return;
    }
    remoteActive = remoteActive || cached.activeChatId;
    chatSessionsRef.current = chats;
    setChatSessions(chats);
    writeCachedChatIndex(currentUser.id, { chats, activeChatId: remoteActive });
    const pick = chats.find((c) => c.id === remoteActive) || chats.find((c) => c.id === activeChatIdRef.current) || chats[0];
    setActiveChatId(pick.id);
    activeChatIdRef.current = pick.id;
    setChatIndexLoading(false);
    setTimeout(() => { skipChatPersistRef.current = false; }, 0);
  };

  const ensureFullChatsLoaded = () => {
    if (chatsFullLoadedRef.current) return Promise.resolve(chatsBodiesRef.current);
    if (chatsFullPromiseRef.current) return chatsFullPromiseRef.current;
    chatsFullPromiseRef.current = (async () => {
      const chatsParsed = await downloadUserJsonDocument(currentUser, 'chats.json');
      let remoteChats = [];
      let remoteActive = activeChatIdRef.current;
      if (chatsParsed && typeof chatsParsed === 'object') {
        ({ chats: remoteChats, activeChatId: remoteActive } = extractChatsFromDocument(chatsParsed));
      }
      const liveId = activeChatIdRef.current;
      const cached = readCachedChatIndex(currentUser.id);
      const merged = unionChats(
        remoteChats,
        chatSessionsRef.current,
        cached.chats,
        chatsBodiesRef.current,
      );
      chatsBodiesRef.current = merged;
      chatsFullLoadedRef.current = true;
      skipChatPersistRef.current = true;
      chatSessionsRef.current = merged;
      setChatSessions(merged);
      writeCachedChatIndex(currentUser.id, { chats: merged, activeChatId: remoteActive || liveId || cached.activeChatId });
      setTimeout(() => { skipChatPersistRef.current = false; }, 0);
      return merged;
    })().catch((err) => {
      chatsFullPromiseRef.current = null;
      throw err;
    });
    return chatsFullPromiseRef.current;
  };

  const runMemoryBackfillIfNeeded = async () => {
    if (memoryBackfillDoneRef.current) return;
    if (!memoryBackfillNeeded(userSettingsRef.current.memory, chatsBodiesRef.current, userSettingsRef.current)) {
      memoryBackfillDoneRef.current = true;
      return;
    }
    memoryBackfillDoneRef.current = true;
    try {
      const blob = compactChatsForMemory(chatsBodiesRef.current);
      const raw = await callAnthropic(
        MEMORY_BACKFILL_SYSTEM,
        [{ role: 'user', content: buildBackfillExchange(blob, userSettingsRef.current.memory) }],
        800,
      );
      const facts = filterMemoryFacts(parseMemoryFacts(raw))
        .filter((f) => !isFileOrIntakeMemoryFact(f));
      if (facts.length) {
        const before = memorySignature(userSettingsRef.current.memory);
        const memory = mergeMemoryFacts(userSettingsRef.current.memory, facts);
        if (memorySignature(memory) !== before) {
          const nextSettings = mergeUserSettingsFields({ ...userSettingsRef.current, memory });
          setUserSettings(nextSettings);
          userSettingsRef.current = nextSettings;
          await queueUserSettingsUpload(currentUser, () => buildUserSettingsDocument(
            currentUser.id,
            mergeUserSettingsFields(userSettingsRef.current),
            { userName: currentUser.name },
          ));
        }
      }
    } catch (err) {
      console.warn('Chat memory backfill failed:', err?.message || err);
    }
  };

  // ── SUPABASE: Load Stella registry + product intel + user settings on startup ──
  useEffect(() => {
    const loadStella = async () => {
      userSettingsReadyRef.current = false;
      memoryBackfillDoneRef.current = false;
      chatsFullLoadedRef.current = false;
      chatsFullPromiseRef.current = null;
      chatsBodiesRef.current = [];
      chatSessionsRef.current = [];

      const loadStellaFiles = async () => {
      // File registry (stella_files table), scoped to this company + user.
      try {
        let data = [];
        try {
          const res = await fetch(STELLA_FILES_API_PATH, {
            headers: authHeaders({ 'Content-Type': 'application/json' }),
          });
          if (res.ok) {
            const payload = await res.json().catch(() => ({}));
            const schemaStatus = stellaSchemaStatusFromPayload(payload);
            if (schemaStatus) setStellaTenantSchema(schemaStatus);
            data = Array.isArray(payload.files) ? payload.files : [];
          }
        } catch {
          /* company-schema API is required — do not read public.stella_files */
        }
        if (data.length) {
          const mapped = data.map(stellaMapRegistryRow);
          setStellaDataFiles(prev => {
            const existing = new Set(prev.map(f => f.dbId).filter(Boolean));
            const next = [...prev, ...mapped.filter(f => !existing.has(f.dbId))];
            stellaDataFilesRef.current = next;
            return next;
          });
          const tables = [...new Set(mapped.map((f) => f.tableName).filter(Boolean))];
          void Promise.all(tables.map((tableName) => fetch(STELLA_QUERY_API_PATH, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ action: 'move', tableName }),
          }).catch(() => null)));
          void stellaHydrateColumnProfilesRef.current?.(mapped, { persist: false });
          return mapped;
        }
      } catch { /* stella_files table may not exist yet */ }
      return [];
      };

      const loadProductIntel = async () => {
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
      };

      const loadUserJson = async () => {
      // User settings: intelligence/companies/<slug>/users/<display name>/settings.json
      // Chat hub list: intelligence/companies/<slug>/users/<display name>/chats-index.json
      try {
        try {
          localStorage.removeItem(userSettingsLocalKey(currentUser.id));
          localStorage.removeItem(LEGACY_USER_SETTINGS_STORAGE_KEY);
          Object.keys(localStorage)
            .filter((k) => k.startsWith('comex-user-settings'))
            .forEach((k) => localStorage.removeItem(k));
        } catch { /* ignore */ }
        const [parsed, indexParsed] = await Promise.all([
          downloadUserJsonDocument(currentUser, 'settings.json'),
          downloadUserJsonDocument(currentUser, 'chats-index.json'),
        ]);
        let merged = mergeUserSettingsFields(userSettingsRef.current);
        if (parsed && typeof parsed === 'object') {
          const remoteSettings = normalizeLoadedUserSettings(parsed);
          const liveSettings = mergeUserSettingsFields(userSettingsRef.current);
          merged = {
            ...remoteSettings,
            moduleContext: mergeModuleContextPreferRich(liveSettings.moduleContext, remoteSettings.moduleContext),
          };
        }
        let biz = mergeStellaBusinessContext(merged.stellaBusinessContext);
        let migratedStellaBiz = false;
        if (stellaBusinessContextIsEmpty(biz)) {
          for (const candidate of STELLA_STORAGE_CANDIDATES) {
            try {
              const { data, error } = await supabase.storage.from(candidate.bucket).download(`${candidate.prefix}business-context.json`);
              if (error || !data) continue;
              const parsedBiz = safeJsonParse(await data.text());
              if (parsedBiz && typeof parsedBiz === 'object' && !stellaBusinessContextIsEmpty(parsedBiz)) {
                biz = mergeStellaBusinessContext(parsedBiz);
                merged = { ...merged, stellaBusinessContext: biz };
                migratedStellaBiz = true;
                break;
              }
            } catch { /* try next candidate */ }
          }
        }
        const lifted = liftStellaGenericIntoUserSettings({ ...merged, stellaBusinessContext: biz });
        merged = lifted.settings;
        biz = mergeStellaBusinessContext(merged.stellaBusinessContext);
        const tenantCompany = resolveUserCompany(currentUser);
        let filledCompany = false;
        if (!String(merged.companyName || '').trim() && tenantCompany) {
          merged = { ...merged, companyName: tenantCompany };
          filledCompany = true;
        }
        if (migratedStellaBiz || lifted.changed || filledCompany) {
          try {
            await queueUserSettingsUpload(currentUser, () => buildUserSettingsDocument(
              currentUser.id,
              mergeUserSettingsFields(merged),
              { userName: currentUser.name },
            ));
          } catch { /* one-time migrate is best-effort */ }
        }
        setUserSettings(merged);
        userSettingsRef.current = merged;
        setStellaBusinessContext(biz);
        let indexChats = [];
        let remoteActive = null;
        let migratedChats = false;
        if (indexParsed && typeof indexParsed === 'object') {
          ({ chats: indexChats, activeChatId: remoteActive } = extractChatIndexFromDocument(indexParsed));
        }
        if (indexChats.length) {
          applyChatIndex(indexChats, remoteActive);
        } else {
          const fromSettings = extractChatIndexFromDocument(parsed);
          indexChats = fromSettings.chats;
          remoteActive = fromSettings.activeChatId || remoteActive;
          migratedChats = indexChats.length > 0;
          if (migratedChats) applyChatIndex(indexChats, remoteActive);
          else {
            try {
              await ensureFullChatsLoaded();
              setChatIndexLoading(false);
            } catch {
              const cached = readCachedChatIndex(currentUser.id);
              if (cached.chats.length) applyChatIndex(cached.chats, cached.activeChatId);
              else setChatIndexLoading(false);
            }
          }
        }
        if (migratedChats) {
          try {
            await ensureFullChatsLoaded();
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
        setChatIndexLoading(false);
        setUserSettingsCloudError(err?.message || 'Could not load settings.json');
      }
      };

      const userJsonDone = loadUserJson();
      const restDone = Promise.all([loadStellaFiles(), loadProductIntel()]);
      await userJsonDone;
      userSettingsReadyRef.current = true;
      const pendingHarvest = harvestMemoryPendingRef.current;
      harvestMemoryPendingRef.current = null;
      if (pendingHarvest) void harvestChatMemory(pendingHarvest.assistantText, pendingHarvest.userText, pendingHarvest.recentTurns);
      void ensureFullChatsLoaded()
        .then(() => runMemoryBackfillIfNeeded())
        .then(() => sweepChatMemoryOfFileContext(factsFromStellaFiles(stellaDataFilesRef.current)))
        .catch((err) => console.warn('Chat transcripts load failed:', err?.message || err));
      const [mappedFiles] = await restDone;
      void sweepChatMemoryOfFileContext(factsFromStellaFiles(mappedFiles || stellaDataFilesRef.current));
    };
    loadStella();
  }, [currentUser.id]);

  const openStellaIntakeAssistant = (fileHint) => {
    setShowLanding(false);
    setActiveTab('user-settings');
    setUserSettingsPane('stella');
    setStellaSettingsTab('connections');
    setStellaConnectionsTab('files');
    setStellaFilesInnerTab('list');
    setStellaIntakeMinimized(false);
    const files = stellaDataFilesRef.current || [];
    const wantId = String(fileHint?.fileId || fileHint?.id || '').trim();
    const wantName = String(fileHint?.fileName || fileHint?.file || fileHint?.name || '').trim().toLowerCase();
    const match = files.find((f) => f && (f.dbId === wantId || f.id === wantId))
      || files.find((f) => wantName && String(f.name || '').trim().toLowerCase() === wantName)
      || files.find((f) => f && !f.intakeComplete && !f.processing);
    if (match) {
      setActiveStellaDataId(match.id);
      setStellaIntakeMinimized(false);
    }
  };

  useEffect(() => {
    const link = stellaIntakeDeepLinkRef.current;
    if (!link || !currentUser?.id) return undefined;
    setShowLanding(false);
    setActiveTab('user-settings');
    setUserSettingsPane('stella');
    setStellaSettingsTab('connections');
    setStellaConnectionsTab('files');
    setStellaFilesInnerTab('list');
    return undefined;
  }, [currentUser.id]);

  useEffect(() => {
    const link = stellaIntakeDeepLinkRef.current;
    if (!link) return;
    const files = stellaDataFiles || [];
    if (!files.length && !link.fileId && !link.fileName) return;
    const wantId = String(link.fileId || '').trim();
    const wantName = String(link.fileName || '').trim().toLowerCase();
    const match = files.find((f) => f && (f.dbId === wantId || f.id === wantId))
      || files.find((f) => wantName && String(f.name || '').trim().toLowerCase() === wantName)
      || files.find((f) => f && !f.intakeComplete && !f.processing);
    if (!match && files.length === 0) return;
    if (match) {
      setActiveStellaDataId(match.id);
      setStellaIntakeMinimized(false);
    }
    stellaIntakeDeepLinkRef.current = null;
    clearStellaIntakeDeepLink();
  }, [stellaDataFiles, currentUser.id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, stellaMessages, activeTab]);

  useEffect(() => {
    setSuggestionsOpen(false);
  }, [suggestedPrompts]);

  useEffect(() => {
    messagesRef.current = messages;
    stellaMessagesRef.current = stellaMessages;
    activeTabRef.current = activeTab;
    currentWorkflowRef.current = currentWorkflow;
    pendingWorkflowRef.current = pendingWorkflow;
    uploadedFileRef.current = uploadedFile;
    userSettingsRef.current = userSettings;
    stellaDataFilesRef.current = stellaDataFiles;
    activeChatIdRef.current = activeChatId;
    chatSessionsRef.current = chatSessions;
  });

  useEffect(() => {
    const f = (stellaDataFilesRef.current || []).find((x) => x.id === activeStellaDataId);
    setStellaIntakeMinimized(!!(f && !f.processing && f.intakeComplete));
  }, [activeStellaDataId]);

  useEffect(() => {
    if (!isAdmin && activeTab === 'admin') {
      setActiveTab('chat');
      setShowLanding(true);
    }
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!userSettingsReadyRef.current) return;
    if (skipChatPersistRef.current) return;
    if (activeTabRef.current === 'stella') return;
    if (!chatHasUserContent(messages) && !currentWorkflow) return;
    if (persistChatsTimerRef.current) clearTimeout(persistChatsTimerRef.current);
    persistChatsTimerRef.current = setTimeout(async () => {
      try {
        await ensureFullChatsLoaded();
      } catch {
        return;
      }
      if (!chatsFullLoadedRef.current) return;
      let id = activeChatIdRef.current || newChatId();
      let existing = (chatSessionsRef.current || []).find((c) => c.id === id);
      if (existing && (existing.module || inferChatModule(existing)) === 'stella') {
        id = newChatId();
        existing = undefined;
      }
      if (activeChatIdRef.current !== id) {
        activeChatIdRef.current = id;
        setActiveChatId(id);
      }
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
        workflowRuns: existing?.workflowRuns,
        previousMessages: existing?.messages,
      });
      const next = upsertChatInPlace(unionChats(chatSessionsRef.current, chatsBodiesRef.current), snap);
      chatSessionsRef.current = next;
      chatsBodiesRef.current = unionChats(chatsBodiesRef.current, next);
      setChatSessions(next);
      const toSave = mergeChatListForPersist(next);
      if (!toSave.length && (next.filter(chatIsListed).length || readCachedChatIndex(currentUser.id).chats.length)) return;
      try {
        await queueUserChatsUpload(currentUser, () => buildUserChatsDocument(
          currentUser.id,
          {
            chats: toSave,
            activeChatId: activeChatIdRef.current,
            userName: currentUser.name,
          },
        ));
      } catch { /* next save retries */ }
    }, 1200);
    return () => clearTimeout(persistChatsTimerRef.current);
  }, [messages, currentWorkflow, pendingWorkflow, uploadedFile]);

  useEffect(() => {
    if (!userSettingsReadyRef.current) return;
    if (skipChatPersistRef.current) return;
    if (activeTabRef.current !== 'stella') return;
    if (!chatHasUserContent(stellaMessages)) return;
    if (persistStellaChatsTimerRef.current) clearTimeout(persistStellaChatsTimerRef.current);
    persistStellaChatsTimerRef.current = setTimeout(async () => {
      try {
        await ensureFullChatsLoaded();
      } catch {
        return;
      }
      if (!chatsFullLoadedRef.current) return;
      let id = activeChatIdRef.current || newChatId();
      let existing = (chatSessionsRef.current || []).find((c) => c.id === id);
      if (existing && (existing.module || inferChatModule(existing)) !== 'stella') {
        id = newChatId();
        existing = undefined;
      }
      if (activeChatIdRef.current !== id) {
        activeChatIdRef.current = id;
        setActiveChatId(id);
      }
      const sameThread = existing && (existing.messages || []).length === (stellaMessagesRef.current || []).length
        && String(existing.messages?.[existing.messages.length - 1]?.content || '') === String(stellaMessagesRef.current?.[stellaMessagesRef.current.length - 1]?.content || '');
      const snap = serializeChatSnapshot({
        id,
        messages: stellaMessagesRef.current,
        currentWorkflow: null,
        pendingWorkflow: null,
        uploadedFile: null,
        module: 'stella',
        createdAt: existing?.createdAt,
        updatedAt: sameThread ? existing.updatedAt : undefined,
        workflowRuns: existing?.workflowRuns,
        previousMessages: existing?.messages,
      });
      const next = upsertChatInPlace(unionChats(chatSessionsRef.current, chatsBodiesRef.current), snap);
      chatSessionsRef.current = next;
      chatsBodiesRef.current = unionChats(chatsBodiesRef.current, next);
      setChatSessions(next);
      const toSave = mergeChatListForPersist(next);
      if (!toSave.length && (next.filter(chatIsListed).length || readCachedChatIndex(currentUser.id).chats.length)) return;
      try {
        await queueUserChatsUpload(currentUser, () => buildUserChatsDocument(
          currentUser.id,
          {
            chats: toSave,
            activeChatId: activeChatIdRef.current,
            userName: currentUser.name,
          },
        ));
      } catch { /* next save retries */ }
    }, 1200);
    return () => clearTimeout(persistStellaChatsTimerRef.current);
  }, [stellaMessages]);

  const patchWorkflowRun = (patch) => {
    const id = activeChatIdRef.current;
    if (!id || !patch) return;
    const existing = (chatSessionsRef.current || []).find((c) => c.id === id);
    const runs = Array.isArray(existing?.workflowRuns) ? [...existing.workflowRuns] : [];
    const now = new Date().toISOString();
    const matchIdx = runs.findIndex((r) =>
      (patch.id && r.id === patch.id)
      || (patch.topicId && r.topicId === patch.topicId && (r.status === 'offered' || r.status === 'running')),
    );
    if (matchIdx >= 0) {
      const nextPatch = { ...patch };
      if (!nextPatch.trigger) delete nextPatch.trigger;
      if (!nextPatch.triggerPhrase) delete nextPatch.triggerPhrase;
      if (!nextPatch.triggerReason) delete nextPatch.triggerReason;
      if (nextPatch.triggerText === undefined || nextPatch.triggerText === '') delete nextPatch.triggerText;
      runs[matchIdx] = {
        ...runs[matchIdx],
        ...nextPatch,
        at: runs[matchIdx].at || now,
        completedAt: ['completed', 'declined', 'cancelled'].includes(patch.status) ? (patch.completedAt || now) : runs[matchIdx].completedAt,
      };
    } else {
      runs.unshift({
        id: patch.id || `wf_${Date.now().toString(36)}`,
        topicId: patch.topicId || '',
        topicName: patch.topicName || patch.topicId || 'Workflow',
        status: patch.status || 'offered',
        trigger: patch.trigger || '',
        triggerPhrase: patch.triggerPhrase || '',
        triggerReason: patch.triggerReason || '',
        triggerText: String(patch.triggerText || '').slice(0, 500),
        at: patch.at || now,
        completedAt: patch.completedAt || null,
        chatId: id,
        chatTitle: existing?.title || '',
      });
    }
    const snap = serializeChatSnapshot({
      id,
      title: existing?.title,
      messages: messagesRef.current,
      currentWorkflow: currentWorkflowRef.current,
      pendingWorkflow: pendingWorkflowRef.current,
      uploadedFile: uploadedFileRef.current,
      module: existing?.module,
      createdAt: existing?.createdAt,
      workflowRuns: runs.slice(0, 20),
      previousMessages: existing?.messages,
    });
    const next = upsertChatInPlace(chatSessionsRef.current, snap);
    chatSessionsRef.current = next;
    setChatSessions(next);
  };

  const handleCancelWorkflow = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const confirmed = window.confirm('Cancel this workflow and return to normal chat?');
    if (confirmed) {
      const topicId = currentWorkflowRef.current?.topicId;
      patchWorkflowRun({ topicId, status: 'cancelled' });
      setCurrentWorkflow(null);
      setPendingWorkflow(null);
      setIsLoading(false);
      setMessages(prev => [...prev, { role: 'system', content: '❌ Workflow cancelled. Returning to normal chat mode. We can keep talking about what you were working on.' }]);
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

  const renderPayoutCurveChart = (curveData) => <PayoutCurveChart curveData={curveData} />;

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

  const parseChartSpec = (raw) => {
    const text = String(raw || '').trim();
    const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
    const direct = tryParse(text);
    if (direct) return direct;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const sliced = text.slice(start, end + 1);
    return tryParse(sliced) || tryParse(sliced.replace(/,\s*([}\]])/g, '$1'));
  };

  const formatMarkdown = (content) => {
    const hideCitations = !isAdmin;
    const raw = typeof content === 'string' ? content : (content == null ? '' : String(content));
    const source = hideCitations ? stripKnowledgeCitations(raw) : raw;
    const references = hideCitations ? {} : parseReferences(source);
    const cleanContent = String(source || '').replace(/[-]{2,}\s*\nReferences:\s*\n[\s\S]+?(\n[-]{2,}|\s*$)/i, '').trimEnd();
    const chartMatch = cleanContent.match(/```chart-payout\n([\s\S]+?)\n```/);
    if (chartMatch) {
      try {
        const chartData = JSON.parse(chartMatch[1]);
        const textWithoutChart = cleanContent.replace(/```chart-payout\n[\s\S]+?\n```/, '').trim();
        return (
          <div className="space-y-2 chat-fit min-w-0 max-w-full">
            {renderPayoutCurveChart(chartData)}
            {textWithoutChart && <div>{formatMarkdown(textWithoutChart)}</div>}
          </div>
        );
      } catch(e) { /* fall through */ }
    }
    const rechartsMatch = cleanContent.match(/```chart-recharts\n([\s\S]+?)\n```/);
    if (rechartsMatch) {
      const spec = parseChartSpec(rechartsMatch[1]);
      if (spec) {
        const textWithoutChart = cleanContent.replace(/```chart-recharts\n[\s\S]+?\n```/, '').trim();
        return (
          <div className="space-y-2 chat-fit min-w-0 max-w-full">
            {renderRechartsChart(spec)}
            {textWithoutChart && <div>{formatMarkdown(textWithoutChart)}</div>}
          </div>
        );
      }
    }
    const stellaChartMatch = cleanContent.match(/```chart-stella\s*([\s\S]+?)```/);
    if (stellaChartMatch) {
      const spec = parseChartSpec(stellaChartMatch[1]);
      if (spec) {
        const textWithoutChart = cleanContent.replace(/```chart-stella\s*[\s\S]+?```/, '').trim();
        return (
          <div className="space-y-2 chat-fit min-w-0 max-w-full">
            {renderRechartsChart(spec)}
            {textWithoutChart && <div>{formatMarkdown(textWithoutChart)}</div>}
          </div>
        );
      }
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
      <div className="space-y-1 chat-fit">
        {elements.map((el, idx) => {
          if (el.type === 'table') {
            const rows = el.lines.filter(l => !l.match(/^[\s\-:|]+$/)).map(l => l.split('|').map(c => c.trim()).filter(c => c.length > 0)).filter(r => r.length > 0);
            if (rows.length === 0) return null;
            const [header, ...body] = rows;
            const exportRows = [header, ...body];
            return (
              <div key={idx} className="my-3 min-w-0 max-w-full">
                <table className="w-full table-fixed border-collapse border border-blue-400/30 rounded-lg overflow-hidden text-sm">
                  <thead className="bg-blue-500/20">
                    <tr>{header.map((h, i) => (<th key={i} className="border border-blue-400/30 px-2 py-2 text-left font-semibold text-blue-300 break-words" dangerouslySetInnerHTML={{ __html: inlineFormat(h) }} />))}</tr>
                  </thead>
                  <tbody>
                    {body.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-slate-800/30' : 'bg-slate-800/50'}>
                        {row.map((cell, j) => (<td key={j} className="border border-blue-400/30 px-2 py-2 text-sm align-top break-words" dangerouslySetInnerHTML={{ __html: inlineFormat(cell) }} />))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-end mt-1.5">
                  <ExcelExportButton
                    rows={exportRows}
                    sheetName={header[0] || 'Table'}
                    filename={header.filter(Boolean).slice(0, 4).join(' ') || 'table'}
                    label="Export this table to Excel"
                  />
                </div>
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
                      <div key={i} className="flex gap-2 leading-relaxed min-w-0" style={{ paddingLeft: `${indent * 4}px` }}>
                        <span className="text-cyan-400 flex-shrink-0 mt-0.5">•</span>
                        <span className="text-sm min-w-0 break-words">{hideCitations ? text : renderTextWithCitations(text, references)}</span>
                      </div>
                    );
                  }
                  if (line.trim() === '' || line.trim() === '---') return <div key={i} className="h-2"/>;
                  return <div key={i} className="text-sm leading-relaxed break-words">{hideCitations ? line : renderTextWithCitations(line, references)}</div>;
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

  const generateSuggestions = async (conversationHistory, { thread = 'chat' } = {}) => {
    if (!suggestionsEnabled || conversationHistory.length === 0) { setSuggestedPrompts([]); return; }
    // Never invent answers while an agent is waiting on clarifying questions
    if (currentWorkflow?.awaitingAgentReply || currentWorkflow?.waitingForUser || pendingProposalIntake || memoryPendingFor(thread)) {
      setSuggestedPrompts([]);
      return;
    }
    const lastAssistant = [...conversationHistory].reverse().find((m) => m.role === 'assistant' || m.role === 'orchestrator' || m.role === 'agent');
    if (hasNumberedClarifyingQuestions(lastAssistant?.content) || /Would you like me to start this workflow|remembered facts|update memory/i.test(lastAssistant?.content || '') || isPptxClarifyContent(lastAssistant?.content)) {
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

Return ${n} clickable follow-ups. Each must be a complete next message the user would type (a sentence), not a numbered option, not yes/no, and not a request for missing information. Each must mention a concrete detail from the messages above.`,
        }],
        max_tokens: 400,
      });
      const data = await response.json();
      const text = anthropicAssistantText(data)?.trim();
      if (text) {
        let parsed = null;
        try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch { parsed = parseJsonArray(text); }
        if (Array.isArray(parsed)) {
          const cleaned = parsed
            .map((p) => stripKnowledgeCitations(String(p || ''), knowledgeNames).replace(/\s+/g, ' ').trim())
            .filter((p) => isSensibleSuggestion(p, knowledgeNames) && isConversationGrounded(p, convoTokens) && !looksLikeInfoRequest(p));
          setSuggestedPrompts(cleaned.slice(0, n));
        }
      }
    } catch (e) { setSuggestedPrompts([]); }
  };

  const detectPptxIntent = async (conversationHistory, thread = 'chat') => {
    if (conversationHistory.length < 2) return;
    try {
      const recentMessages = conversationHistory.slice(-8).map(m => `${m.role}: ${m.content.substring(0, 400)}`).join('\n');
      const pptxCtx = getPptxContext(productIntel);
      const response = await anthropicMessagesPost({
        system: `${pptxCtx.intentDetection}${buildUserSettingsPromptBlock(userSettings, { moduleId: resolvePromptModule(), applyResponseLength: false })}`,
        messages: [{ role: 'user', content: `Conversation:\n${recentMessages}` }],
        max_tokens: 400,
      });
      const data = await response.json();
      const text = anthropicAssistantText(data)?.trim();
      if (text) {
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        if (parsed.offer && (parsed.summaryDeck || parsed.producedDeck)) {
          setPptxOffers({ thread, summary: parsed.summaryDeck || null, produced: parsed.producedDeck || null });
        }
      }
    } catch (e) { console.warn('detectPptxIntent error:', e); }
  };

  const lastMessageRef = useRef(0);
  useEffect(() => {
    if (activeTab === 'stella' || currentWorkflow) return;
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
      if (!isLoading && !currentWorkflow) detectPptxIntent(messages, 'chat');
    }, 2000);
    return () => clearTimeout(timer);
  }, [messages, isLoading, currentWorkflow, activeTab]);

  const callAnthropic = async (system, messages, maxTokens = 1000) => {
    const res = await anthropicMessagesPost({ system, messages, max_tokens: maxTokens });
    if (!res.ok) {
      const errText = await res.text();
      let detail = (errText || '').slice(0, 240);
      try {
        const parsed = JSON.parse(errText);
        detail = parsed?.error?.message || parsed?.message || detail;
      } catch { /* keep detail */ }
      throw new Error(`API error ${res.status}: ${detail || 'request failed'}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(`Anthropic error: ${data.error.message || JSON.stringify(data.error)}`);
    return anthropicAssistantText(data);
  };

  const harvestChatMemory = async (assistantText, userText, recentTurns = [], { thread = 'chat' } = {}) => {
    const memThread = thread === 'stella' ? 'stella' : 'chat';
    if (!isMemoryEnabled(userSettingsRef.current)) return { conflict: false };
    if (memoryConfirmThreadOf(pendingMemoryConfirmRef.current) === memThread && pendingMemoryConfirmRef.current) {
      return { conflict: true };
    }
    if (!shouldHarvestChatMemory(assistantText, userText)) return { conflict: false };
    let spins = 0;
    while (harvestMemoryBusyRef.current && spins < 80) {
      await new Promise((r) => setTimeout(r, 50));
      spins += 1;
      if (memoryConfirmThreadOf(pendingMemoryConfirmRef.current) === memThread && pendingMemoryConfirmRef.current) {
        return { conflict: true };
      }
    }
    if (!userSettingsReadyRef.current || harvestMemoryBusyRef.current) {
      harvestMemoryPendingRef.current = { assistantText, userText, recentTurns, thread };
      return { conflict: false };
    }
    harvestMemoryBusyRef.current = true;
    let openedConflict = false;
    try {
      const raw = await callAnthropic(
        MEMORY_HARVEST_SYSTEM,
        [{
          role: 'user',
          content: buildHarvestExchange({
            assistantText,
            userText,
            recentTurns,
            existingMemory: userSettingsRef.current.memory,
            knownFileFacts: factsFromStellaFiles(stellaDataFilesRef.current),
          }),
        }],
        500,
      );
      const fileFacts = factsFromStellaFiles(stellaDataFilesRef.current);
      const { facts: harvestedFacts, conflicts: harvestedConflicts } = parseMemoryHarvest(raw);
      const allowExplicit = isExplicitRememberRequest(userText);
      const existingActive = activeMemoryItems({ memory: userSettingsRef.current.memory });
      const facts = [];
      const conflicts = [];
      const keepFact = (fact) => (
        !isFileOrIntakeMemoryFact(fact)
        && !fileFacts.some((k) => factsAreSimilar(k, fact))
      );
      for (const conflict of harvestedConflicts || []) {
        if (!conflict?.proposed || !isDurableMemoryFact(conflict.proposed, { allowExplicit }) || !keepFact(conflict.proposed)) continue;
        const matched = matchConflictingMemory(existingActive, conflict);
        if (matched) {
          conflicts.push({
            ...conflict,
            existingId: matched.id,
            existingText: matched.text,
          });
        } else {
          facts.push(conflict.proposed);
        }
      }
      for (const fact of filterMemoryFacts(harvestedFacts, { allowExplicit })) {
        if (!keepFact(fact)) continue;
        const matched = matchConflictingMemory(existingActive, { proposed: fact });
        if (matched) {
          if (!conflicts.some((c) => (c.existingId && c.existingId === matched.id) || factsAreSimilar(c.proposed, fact))) {
            conflicts.push({
              existingId: matched.id,
              existingText: matched.text,
              proposed: fact,
              question: `I currently remember: "${matched.text}". Should I update memory to: "${fact}"?`,
            });
          }
        } else if (!facts.some((f) => factsAreSimilar(f, fact))) {
          facts.push(fact);
        }
      }
      const newFacts = facts.filter((f) => {
        const proposed = conflicts[0]?.proposed;
        return !proposed || (!factsAreSimilar(f, proposed) && String(f).toLowerCase() !== String(conflicts[0]?.existingText || '').toLowerCase());
      });
      if (newFacts.length) {
        const before = memorySignature(userSettingsRef.current.memory);
        const memory = mergeMemoryFacts(userSettingsRef.current.memory, newFacts, { module: memThread === 'stella' ? 'stella' : resolvePromptModule() });
        if (memorySignature(memory) !== before) {
          const settings = mergeUserSettingsFields({ ...userSettingsRef.current, memory });
          setUserSettings(settings);
          userSettingsRef.current = settings;
          await queueUserSettingsUpload(currentUser, () => buildUserSettingsDocument(
            currentUser.id,
            mergeUserSettingsFields(userSettingsRef.current),
            { userName: currentUser.name },
          ));
        }
      }
      const conflict = conflicts.find((c) => c.proposed && c.existingText);
      if (conflict && userMessageJustifiesMemoryConflict(userText) && !pendingMemoryConfirmRef.current) {
        const existing = String(conflict.existingText || '').trim();
        const proposed = String(conflict.proposed || '').trim();
        const question = `Should I update a remembered fact?\n\n**Currently:** ${existing}\n**Update to:** ${proposed}`;
        const pending = { ...conflict, extraFacts: [], thread: memThread };
        pendingMemoryConfirmRef.current = pending;
        setPendingMemoryConfirm(pending);
        setMemoryCustomOpen(false);
        setMemoryCustomDraft(proposed);
        setSuggestedPrompts([]);
        const append = thread === 'stella' ? setStellaMessages : setMessages;
        append((prev) => [...prev, { role: 'assistant', content: question, kind: 'memory-confirm' }]);
        openedConflict = true;
      }
    } catch (err) {
      console.warn('Chat memory harvest failed:', err?.message || err);
    }
    harvestMemoryBusyRef.current = false;
    const pending = harvestMemoryPendingRef.current;
    harvestMemoryPendingRef.current = null;
    if (pending && (pending.userText !== userText || pending.assistantText !== assistantText) && !pendingMemoryConfirmRef.current) {
      void harvestChatMemory(pending.assistantText, pending.userText, pending.recentTurns, { thread: pending.thread || 'chat' });
    }
    return { conflict: openedConflict || !!(pendingMemoryConfirmRef.current && memoryConfirmThreadOf(pendingMemoryConfirmRef.current) === memThread) };
  };

  const persistConfirmedMemory = async (nextMemory) => {
    const settings = mergeUserSettingsFields({ ...userSettingsRef.current, memory: nextMemory });
    setUserSettings(settings);
    userSettingsRef.current = settings;
    await queueUserSettingsUpload(currentUser, () => buildUserSettingsDocument(
      currentUser.id,
      mergeUserSettingsFields(userSettingsRef.current),
      { userName: currentUser.name },
    ));
  };

  const sweepChatMemoryOfFileContext = async (fileFacts = []) => {
    if (!userSettingsReadyRef.current) return;
    const before = userSettingsRef.current.memory;
    const next = stripFileIntakeFromMemory(before, fileFacts);
    if (memorySignature(next) === memorySignature(before)) return;
    await persistConfirmedMemory(next);
  };

  const applyPendingMemoryDecision = async (action, customText = '') => {
    const pending = pendingMemoryConfirmRef.current;
    if (!pending) return;
    const extra = (pending.extraFacts || []).filter((f) => f && !isFileOrIntakeMemoryFact(f));
    const memModule = pending.thread === 'stella' ? 'stella' : resolvePromptModule();
    let next = userSettingsRef.current.memory;
    if (action === 'accept') {
      const proposed = String(pending.proposed || '').trim();
      next = applyMemoryConfirmation(
        next,
        { ...pending, accept: true, reason: proposed ? `Replaced by “${proposed}”` : '' },
        { module: memModule },
      );
    } else if (action === 'custom') {
      const custom = String(customText || '').trim();
      next = applyMemoryConfirmation(
        next,
        { ...pending, proposed: custom, accept: true, reason: custom ? `User confirmed: “${custom}”` : '' },
        { module: memModule },
      );
    }
    if (extra.length) next = mergeMemoryFacts(next, extra, { module: memModule });
    await persistConfirmedMemory(next);
    pendingMemoryConfirmRef.current = null;
    setPendingMemoryConfirm(null);
    setMemoryCustomOpen(false);
    memoryCustomForcedRef.current = false;
  };

  const recentChatTurnsForMemory = (list) => (
    (list || messagesRef.current || [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'orchestrator'))
      .filter((m) => m.kind !== 'intake' && m.kind !== 'memory-confirm')
      .slice(-8)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
  );

  /** Append mandatory user preferences/context to any system prompt. */
  const resolvePromptModule = () => {
    if (activeTab === 'stella') return 'stella';
    if (activeTab === 'territory') return 'territory';
    if (activeTab === 'user-settings') {
      if (userSettingsPane === 'stella') return 'stella';
      if (userSettingsPane === 'territory') return 'territory';
      if (userSettingsPane === 'incentives') return 'incentives';
    }
    const topic = String(currentWorkflow?.topicId || '');
    if (topic.includes('territory')) return 'territory';
    if (topic.includes('stella')) return 'stella';
    return 'incentives';
  };

  const withUserSettings = (system, { moduleContext = true, applyResponseLength = true } = {}) => {
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
    const settings = userSettingsRef.current || userSettings;
    const useLength = applyResponseLength && !systemHasExplicitLengthSpec(prompt);
    const liveStellaFiles = (Array.isArray(stellaDataFilesRef.current) && stellaDataFilesRef.current.length)
      ? stellaDataFilesRef.current
      : (stellaDataFiles || []);
    const moduleBlock = moduleContext
      ? formatLinkedModulesPromptBlock(settings, resolvePromptModule(), {
        stellaFiles: liveStellaFiles,
      })
      : '';
    const base = `${prompt}${buildUserSettingsPromptBlock(settings, { moduleId: resolvePromptModule(), applyResponseLength: useLength })}${moduleBlock}`;
    const endUser = isAdmin ? '' : `

END-USER MODE: Never cite or name knowledge files, intelligence documents, or source filenames. Do not use [1]/[2] markers or a References section. Apply best-practice knowledge in your reasoning without mentioning where it came from.
MEMORY UPDATES: Never say you updated, saved, locked in, or remembered a fact. Do not write "Memory updated". The app confirms memory changes separately.`;
    const lengthTail = useLength ? `\n\n${formatResponseLengthOverride(settings)}` : '';
    return `${base}${endUser}${lengthTail}`;
  };

  const callAnthropicMaybeStellaTools = async (system, messages, maxTokens = 1000, { maxRounds = 4 } = {}) => {
    const run = runWithStellaDataToolsRef.current;
    const settings = userSettingsRef.current || userSettings;
    const home = resolvePromptModule();
    const stellaFilesAll = (stellaDataFilesRef.current || []).filter((f) => f && !f.processing);
    const linked = connectedComponentIds(settings?.moduleConnections, home);
    const stellaInHub = home === 'stella' || linked.includes('stella');
    const stellaFiles = stellaInHub ? stellaFilesAll : [];
    const hubFiles = listHubContextFiles(settings, home, { stellaFiles });
    if (!run || !hubFiles.length) {
      return callAnthropic(system, messages, maxTokens);
    }
    const out = await run({
      system,
      messages,
      files: stellaFiles,
      hubFiles,
      maxRounds,
      maxTokens,
      thinking: false,
    });
    return out.text;
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

  const pptxExportThread = () => (activeTab === 'stella' ? 'stella' : 'chat');
  const pptxThreadMessages = (thread = pptxExportThread()) => (
    thread === 'stella' ? (stellaMessagesRef.current || []) : (messagesRef.current || [])
  );
  const appendPptxThreadMessage = (thread, msg) => {
    if (thread === 'stella') {
      setStellaMessages((prev) => {
        const next = [...prev, msg];
        stellaMessagesRef.current = next;
        return next;
      });
    } else {
      setMessages((prev) => {
        const next = [...prev, msg];
        messagesRef.current = next;
        return next;
      });
    }
  };
  const isPptxClarifyContent = (content) => {
    const text = String(content || '');
    if (!text) return false;
    const prompt = String(getPptxClarify()?.prompt || '').replace(/\s+/g, ' ').trim();
    const compact = text.replace(/\s+/g, ' ');
    if (prompt && compact.includes(prompt.slice(0, 48))) return true;
    return /export a PowerPoint/i.test(text) && /Session summary/i.test(text) && /one-pager/i.test(text);
  };
  const threadWaitingForPptx = (list) => {
    if (currentWorkflow || pptxGenerating) return false;
    const last = lastConversationalMessage(list);
    return last?.role === 'assistant' && isPptxClarifyContent(last.content);
  };

  const knowledgeAccessLive = () => mergeKnowledgeAccess(getIntel().knowledgeAccess);

  const moduleGetsGeneralKnowledge = (moduleId) => {
    if (moduleId === 'incentives') return true;
    const settings = userSettingsRef.current || userSettings;
    return connectedComponentIds(settings.moduleConnections, moduleId).includes('incentives');
  };

  const formatGeneralKnowledgeBlock = () => {
    const kb = buildKnowledgeBaseFromDocuments(documents, {
      access: knowledgeAccessLive(),
      role: 'general',
      hideNames: !isAdmin,
    });
    if (!kb) return '';
    return isAdmin
      ? `\n\nKNOWLEDGE BASE (loaded from intelligence files):\n${kb}`
      : `\n\nKNOWLEDGE BASE (best-practice guidance — never name source files):\n${kb}`;
  };

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

  const revealSavedWorkflow = (id) => {
    const focusId = String(id || '').trim();
    if (!focusId) return;
    setWfSavedId(focusId);
    requestAnimationFrame(() => {
      const card = wfCardRefs.current[focusId];
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    window.setTimeout(() => {
      setWfSavedId((cur) => (cur === focusId ? '' : cur));
    }, 2200);
  };

  const closeWorkflowBuilder = () => {
    setWfBuilderOpen(false);
    setWfBuilderFocusId('');
    setWfBuilderIntent('create');
    setWfBuilderMessages([]);
    setWfBuilderInput('');
    setWfBuilderDraft(null);
    setWfBuilderReady(false);
    setWfBuilderError('');
    setWfBuilderLoading(false);
    setWfBuilderThinking('');
  };

  const openWorkflowBuilder = (intent, topic = null) => {
    setWfBuilderOpen(true);
    setWfBuilderIntent(intent);
    setWfBuilderFocusId(topic?.id || '');
    setWfBuilderDraft(null);
    setWfBuilderReady(false);
    setWfBuilderError('');
    setWfBuilderLoading(false);
    setWfBuilderThinking('');
    setWfBuilderInput('');
    const kwList = Array.isArray(topic?.triggerKeywords) && topic.triggerKeywords.length
      ? topic.triggerKeywords.join(', ')
      : 'none yet';
    const welcome = intent === 'edit'
      ? `We'll edit **${topic?.name || 'this workflow'}** (\`${topic?.id || ''}\`), currently **${topic?.status === 'inactive' ? 'disabled' : 'enabled'}**. I have the full workflow — steps, goals, success criteria, orchestrator, assigned agent prompts, and triggers.\n\n**Start from chat:** ${triggerModeLabel(topic?.triggerMode)}\n**Keyword triggers now:** ${kwList}\n**Context cue now:** ${topic?.description || '(none)'}\n\n${WORKFLOW_BUILDER_WELCOME_EDIT}`
      : WORKFLOW_BUILDER_WELCOME;
    setWfBuilderMessages([{ role: 'assistant', content: welcome }]);
  };

  const startWorkflowBuilderEdit = (topic) => {
    if (!topic?.id) return;
    openWorkflowBuilder('edit', topic);
  };

  const openManualNewWorkflow = () => {
    closeWorkflowBuilder();
    const id = slugifyId('new_workflow', new Set((topics || []).map((t) => t.id)));
    setEditingTopic({
      id,
      name: 'New Workflow',
      description: '',
      triggerKeywords: [],
      triggerMode: 'both',
      autoAdvance: false,
      status: 'active',
      orchestrator: {
        ...DEFAULT_ORCHESTRATOR_PROMPTS,
        role: 'You are the Workflow Orchestrator.',
        goal: '',
        approach: '',
      },
      workflow: [{ step: 1, name: 'New Step', agents: [], goal: '', successCriteria: '' }],
    });
    setEditingTopicTab('basics');
    setExpandedSteps({ [`${id}-0`]: true });
  };

  const sendWorkflowBuilder = async (text) => {
    const content = String(text || wfBuilderInput || '').trim();
    if (!content || wfBuilderLoading) return;
    setWfBuilderInput('');
    setWfBuilderError('');
    setWfBuilderThinking('');
    const history = [...wfBuilderMessages, { role: 'user', content }];
    setWfBuilderMessages(history);
    setWfBuilderLoading(true);
    try {
      const knowledgeFiles = (documents || [])
        .filter((d) => knowledgeFileFlags(knowledgeAccessLive(), d.name).agents)
        .map((d) => d.name);
      const catalog = buildWorkflowBuilderCatalog({
        topics,
        agents,
        knowledgeFiles,
        intent: wfBuilderIntent,
        focusId: wfBuilderFocusId,
      });
      const apiMessages = toAnthropicHistory(history).slice(-20);
      if (!apiMessages.length) {
        throw new Error('Type a message for the Workflow agent.');
      }
      const res = await anthropicMessagesPost({
        system: buildWorkflowBuilderSystemPrompt(catalog),
        messages: apiMessages,
        max_tokens: 6000,
        thinking: { type: 'enabled', budget_tokens: 1600 },
      });
      const errText = !res.ok ? await res.text() : '';
      if (!res.ok) {
        let detail = (errText || '').slice(0, 240);
        try {
          const parsed = JSON.parse(errText);
          detail = parsed?.error?.message || parsed?.message || detail;
        } catch { /* keep detail */ }
        throw new Error(`API error ${res.status}: ${detail || 'request failed'}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(`Anthropic error: ${data.error.message || JSON.stringify(data.error)}`);
      const blocks = Array.isArray(data.content) ? data.content : [];
      const thinkingText = blocks
        .filter((b) => b.type === 'thinking' || b.type === 'redacted_thinking')
        .map((b) => (b.type === 'redacted_thinking' ? '' : String(b.thinking || '').trim()))
        .filter(Boolean)
        .join('\n\n');
      if (thinkingText) setWfBuilderThinking(thinkingText);
      const raw = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || anthropicAssistantText(data);
      const interpreted = interpretWorkflowBuilderReply(raw);
      setWfBuilderMessages((prev) => [...prev, {
        role: 'assistant',
        content: interpreted.message || 'Draft updated.',
        reasoning: thinkingText ? excerptForSuggestions(thinkingText, 1400) : '',
      }]);
      setWfBuilderDraft(interpreted.draft);
      setWfBuilderReady(!!interpreted.ready);
    } catch (err) {
      setWfBuilderError(err?.message || 'Workflow agent failed.');
      setWfBuilderMessages((prev) => [...prev, {
        role: 'assistant',
        content: `I couldn't reach the model (${err?.message || 'unknown error'}). Try again.`,
      }]);
    } finally {
      setWfBuilderLoading(false);
      setWfBuilderThinking('');
    }
  };

  const applyWorkflowBuilder = async () => {
    if (!wfBuilderDraft || wfBuilderApplying) return;
    const agentOnly = wfBuilderIntent === 'create_agent' || wfBuilderDraft.mode === 'create_agent';
    if (!agentOnly && !wfBuilderDraft.workflow) return;
    setWfBuilderApplying(true);
    setWfBuilderError('');
    try {
      const knowledgeNames = (documents || []).map((d) => d.name);
      const draft = {
        ...wfBuilderDraft,
        mode: agentOnly ? 'create_agent' : (wfBuilderFocusId ? 'edit' : (wfBuilderDraft.mode || 'create')),
        workflow: agentOnly ? null : {
          ...wfBuilderDraft.workflow,
          id: wfBuilderFocusId || wfBuilderDraft.workflow.id,
        },
      };
      const applied = applyWorkflowBuilderDraft({
        topics,
        agents,
        draft,
        knowledgeNames,
      });
      setTopics(mergeTopics(applied.topics));
      setAgents(applied.agents);
      setWfBuilderDraft(null);
      setWfBuilderReady(false);
      if (applied.mode === 'create_agent') {
        const created = applied.createdAgents?.[0] || applied.agents.find((a) => applied.createdAgentIds?.includes(a.id));
        setWfBuilderMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Saved **${created?.name || 'the agent'}** to the product JSON. It is not assigned to a workflow yet — use Edit on a workflow (or Edit with agent) to add it to a step.`,
        }]);
      } else {
        if (applied.topic?.id) {
          setWfBuilderFocusId(applied.topic.id);
          setWfBuilderIntent('edit');
        }
        const created = applied.createdAgentIds?.length
          ? ` Created agents: ${applied.createdAgentIds.join(', ')}.`
          : '';
        setWfBuilderMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Saved **${applied.topic.name}** (${applied.topic.status === 'inactive' ? 'disabled' : 'enabled'}) to the product JSON.${created} Use **Edit** on the card if you want to tweak it by hand.`,
        }]);
        revealSavedWorkflow(applied.topic?.id);
      }
      await persistIntelligenceSettings({ topics: applied.topics, agents: applied.agents });
    } catch (err) {
      setWfBuilderError(err?.message || 'Could not apply the draft.');
    } finally {
      setWfBuilderApplying(false);
    }
  };

  const syncKnowledgeAccessMap = (patch = {}) => {
    const next = mergeKnowledgeAccess(knowledgeAccessLive());
    for (const doc of documents) {
      if (doc?.name && !next[doc.name]) next[doc.name] = { generalContext: true, agents: true };
    }
    return { ...next, ...patch };
  };

  const setKnowledgeFileFlag = async (fileName, field, value) => {
    const name = String(fileName || '').trim();
    if (!name) return;
    const next = syncKnowledgeAccessMap();
    next[name] = { ...knowledgeFileFlags(next, name), [field]: !!value };
    await persistIntelligenceSettings({ knowledgeAccess: next });
  };

  const saveUserSettings = async (next) => {
    const incoming = next || {};
    const settings = mergeUserSettingsFields({
      ...userSettingsRef.current,
      ...incoming,
    });
    const liveExisting = (chatSessionsRef.current || []).find((c) => c.id === (activeChatIdRef.current));
    const liveModule = liveChatModule();
    const existingIsStella = !!(liveExisting && (liveExisting.module || inferChatModule(liveExisting)) === 'stella');
    const liveIsStella = liveModule === 'stella';
    const liveSnap = serializeChatSnapshot({
      id: (liveExisting && existingIsStella !== liveIsStella) ? newChatId() : (activeChatIdRef.current || newChatId()),
      messages: liveIsStella ? stellaMessagesRef.current : messagesRef.current,
      currentWorkflow: liveIsStella ? null : currentWorkflowRef.current,
      pendingWorkflow: liveIsStella ? null : pendingWorkflowRef.current,
      uploadedFile: liveIsStella ? null : uploadedFileRef.current,
      module: liveModule,
      createdAt: (liveExisting && existingIsStella === liveIsStella) ? liveExisting.createdAt : undefined,
      workflowRuns: (liveExisting && existingIsStella === liveIsStella) ? liveExisting.workflowRuns : undefined,
      previousMessages: (liveExisting && existingIsStella === liveIsStella) ? liveExisting.messages : undefined,
    });
    const liveChats = chatHasUserContent(liveSnap.messages)
      ? upsertChatInPlace(unionChats(chatSessionsRef.current, chatsBodiesRef.current), liveSnap)
      : unionChats(chatSessionsRef.current, chatsBodiesRef.current);
    setUserSettings(settings);
    userSettingsRef.current = settings;
    setUserSettingsSaveStatus('saving');
    try {
      try {
        await ensureFullChatsLoaded();
      } catch { /* still save settings */ }
      if (liveChats !== chatSessionsRef.current) {
        chatSessionsRef.current = unionChats(liveChats, chatSessionsRef.current);
        setChatSessions(chatSessionsRef.current);
      }
      void persistChatList(chatSessionsRef.current, activeChatIdRef.current || liveSnap.id);
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
        return false;
      }
      setUserSettingsCloudError('');
      setUserSettingsSaveStatus('saved');
      setTimeout(() => setUserSettingsSaveStatus('idle'), 3000);
      return true;
    } catch (err) {
      console.warn('User settings save failed:', err?.message || err);
      setUserSettingsCloudError(err?.message || String(err));
      setUserSettingsSaveStatus('error');
      setTimeout(() => setUserSettingsSaveStatus('idle'), 8000);
      return false;
    }
  };

  const measureLandingCards = () => {
    const board = landingBoardRef.current?.getBoundingClientRect();
    if (!board) return;
    const next = {};
    for (const mod of ACTIVE_HUB_MODULES) {
      const el = landingCardRefs.current[mod.id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next[mod.id] = {
        cx: r.left + r.width / 2 - board.left,
        cy: r.top + r.height / 2 - board.top,
      };
    }
    setLandingCardRects(next);
  };

  useEffect(() => {
    if (!showLanding) return undefined;
    const tick = () => measureLandingCards();
    tick();
    const t = window.setTimeout(tick, 50);
    window.addEventListener('resize', tick);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', tick);
    };
  }, [showLanding, userSettings.moduleConnections]);

  const persistModuleConnection = async (a, b, { unlink = false } = {}) => {
    const left = MODULE_CONTEXT_LABELS[a] || a;
    const right = MODULE_CONTEXT_LABELS[b] || b;
    const already = modulesAreConnected(userSettingsRef.current.moduleConnections, a, b);
    if (!unlink && already) {
      setLandingLinkNotice(`${left} and ${right} already share context.`);
      window.setTimeout(() => setLandingLinkNotice(''), 4000);
      return;
    }
    if (unlink && !already) return;
    const next = toggleModuleConnection(userSettingsRef.current.moduleConnections, a, b);
    const linked = modulesAreConnected(next, a, b);
    setLandingLinkNotice(linked
      ? `${left} and ${right} now share context.`
      : `${left} and ${right} are no longer linked.`);
    window.setTimeout(() => setLandingLinkNotice(''), 4000);
    await saveUserSettings({ moduleConnections: next });
  };

  const startLandingLinkDrag = (event, fromId) => {
    event.preventDefault();
    event.stopPropagation();
    const board = landingBoardRef.current?.getBoundingClientRect();
    if (!board) return;
    setLandingLinkDrag({
      fromId,
      x: event.clientX - board.left,
      y: event.clientY - board.top,
    });
    const onMove = (e) => {
      const b = landingBoardRef.current?.getBoundingClientRect();
      if (!b) return;
      setLandingLinkDrag((prev) => (prev ? { ...prev, x: e.clientX - b.left, y: e.clientY - b.top } : prev));
    };
    const onUp = (e) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLandingLinkDrag(null);
      let hit = null;
      for (const mod of ACTIVE_HUB_MODULES) {
        if (mod.id === fromId) continue;
        const el = landingCardRefs.current[mod.id];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          hit = mod.id;
          break;
        }
      }
      if (hit) void persistModuleConnection(fromId, hit);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const mergeChatListForPersist = (list) => {
    const fullById = new Map(
      (chatsBodiesRef.current || [])
        .filter((c) => c?.id && chatMessageCount(c) > 0)
        .map((c) => [c.id, c]),
    );
    const out = [];
    const seen = new Set();
    for (const c of list || []) {
      if (!c?.id || seen.has(c.id)) continue;
      seen.add(c.id);
      const filled = chatMessageCount(c) > 0
        ? preferRicherChat(c, fullById.get(c.id))
        : fullById.get(c.id);
      if (filled && chatMessageCount(filled) > 0) out.push(filled);
    }
    return out;
  };

  const persistChatList = async (list, activeId, { dropIds } = {}) => {
    if (!userSettingsReadyRef.current) return;
    try {
      try {
        await ensureFullChatsLoaded();
      } catch {
        return;
      }
      if (!chatsFullLoadedRef.current) return;
      if (dropIds?.length) {
        const drop = new Set(dropIds);
        const strip = (arr) => (arr || []).filter((c) => !drop.has(c.id));
        list = strip(list);
        chatsBodiesRef.current = strip(chatsBodiesRef.current);
        chatSessionsRef.current = strip(chatSessionsRef.current);
        setChatSessions(chatSessionsRef.current);
        writeCachedChatIndex(currentUser.id, {
          chats: chatSessionsRef.current,
          activeChatId: activeId,
        });
      }
      const chats = mergeChatListForPersist(unionChats(list, chatSessionsRef.current, chatsBodiesRef.current));
      if (!chats.length && unionChats(list, chatSessionsRef.current, readCachedChatIndex(currentUser.id).chats).filter(chatIsListed).length) return;
      await queueUserChatsUpload(currentUser, () => buildUserChatsDocument(
        currentUser.id,
        {
          chats,
          activeChatId: activeId,
          userName: currentUser.name,
        },
      ));
    } catch { /* next save retries */ }
  };

  const liveChatModule = () => {
    const existing = (chatSessionsRef.current || []).find((c) => c.id === activeChatIdRef.current);
    if (activeTabRef.current === 'stella' || existing?.module === 'stella') return 'stella';
    if (existing?.module) return existing.module;
    if (activeTabRef.current === 'territory') return 'territory';
    return 'incentives';
  };

  const flushActiveChat = ({ preserveUpdatedAt = false } = {}) => {
    const id = activeChatIdRef.current || newChatId();
    if (!activeChatIdRef.current) {
      activeChatIdRef.current = id;
      setActiveChatId(id);
    }
    const existing = (chatSessionsRef.current || []).find((c) => c.id === id);
    const module = liveChatModule();
    const msgs = module === 'stella' ? stellaMessagesRef.current : messagesRef.current;
    const snap = serializeChatSnapshot({
      id,
      messages: msgs,
      currentWorkflow: module === 'stella' ? null : currentWorkflowRef.current,
      pendingWorkflow: module === 'stella' ? null : pendingWorkflowRef.current,
      uploadedFile: module === 'stella' ? null : uploadedFileRef.current,
      module,
      createdAt: existing?.createdAt,
      updatedAt: preserveUpdatedAt ? existing?.updatedAt : undefined,
      workflowRuns: existing?.workflowRuns,
      previousMessages: existing?.messages,
    });
    const base = unionChats(chatSessionsRef.current, chatsBodiesRef.current);
    let next;
    if (chatHasUserContent(snap.messages)) {
      next = upsertChatInPlace(base, snap);
    } else if (existing && chatIsListed(existing)) {
      next = base;
    } else {
      next = base.filter((c) => c.id !== snap.id);
    }
    chatSessionsRef.current = next;
    chatsBodiesRef.current = unionChats(chatsBodiesRef.current, next);
    setChatSessions(next);
    return { list: next, activeId: id, snap };
  };

  const resetLiveChat = (id, snapshot = null, { tab } = {}) => {
    skipChatPersistRef.current = true;
    setActiveChatId(id);
    activeChatIdRef.current = id;
    const destTab = tab || (snapshot ? chatModuleMeta(snapshot).tab : (activeTabRef.current === 'stella' ? 'stella' : 'chat'));
    if (destTab === 'stella') {
      setStellaMessages(snapshot?.messages?.length ? snapshot.messages : [stellaWelcome()]);
      setStellaInput('');
      setStellaIsLoading(false);
    } else {
      setMessages(snapshot?.messages?.length ? snapshot.messages : [consultationWelcome(currentUser.id)]);
      setCurrentWorkflow(snapshot?.currentWorkflow || null);
      setPendingWorkflow(snapshot?.pendingWorkflow || null);
      setUploadedFile(snapshot?.uploadedFile || null);
      setInput('');
      setIsLoading(false);
    }
    setOrchestratorDecision(null);
    setPendingButtonAction(null);
    setPendingImageReview(null);
    pendingImageReviewRef.current = null;
    setSuggestedPrompts([]);
    setPptxOffers(null);
    setPptxClarifyPending(false);
    setToolsPptxPick(false);
    setShowLanding(false);
    setActiveTab(destTab);
    activeTabRef.current = destTab;
    if (memoryConfirmThreadOf(pendingMemoryConfirmRef.current) !== (destTab === 'stella' ? 'stella' : 'chat')) {
      pendingMemoryConfirmRef.current = null;
      setPendingMemoryConfirm(null);
      setMemoryCustomOpen(false);
      setMemoryCustomDraft('');
      memoryResumeRef.current = null;
      memoryCustomForcedRef.current = false;
    }
    skipMemoryHarvestRef.current = false;
    stellaResumeRef.current = null;
    const declined = new Set();
    for (const run of snapshot?.workflowRuns || []) {
      if (run?.status === 'declined' && run.topicId) declined.add(run.topicId);
    }
    declinedWorkflowIdsRef.current = declined;
    setTimeout(() => { skipChatPersistRef.current = false; }, 0);
  };

  const startNewChat = () => {
    const { list } = flushActiveChat();
    const id = newChatId();
    const destTab = activeTabRef.current === 'stella' ? 'stella' : (activeTabRef.current === 'territory' ? 'territory' : 'chat');
    const module = destTab === 'stella' ? 'stella' : (destTab === 'territory' ? 'territory' : 'incentives');
    resetLiveChat(id, { module }, { tab: destTab });
    persistChatList(list, id);
    setMobileChatHistoryOpen(false);
  };

  const openHubModule = (tab) => {
    setShowLanding(false);
    const destMod = tab === 'stella' ? 'stella' : tab === 'territory' ? 'territory' : 'incentives';
    const current = (chatSessionsRef.current || []).find((c) => c.id === activeChatIdRef.current);
    if (current && (current.module || inferChatModule(current)) === destMod) {
      setActiveTab(tab);
      activeTabRef.current = tab;
      return;
    }
    const last = sidebarChats(chatSessionsRef.current).find((c) => (c.module || inferChatModule(c)) === destMod);
    if (last) {
      void continueChat(last.id);
      return;
    }
    const { list } = flushActiveChat();
    const id = newChatId();
    resetLiveChat(id, { module: destMod }, { tab });
    persistChatList(list, id);
  };

  const continueChat = async (chatId) => {
    const current = (chatSessionsRef.current || []).find((c) => c.id === chatId);
    const bodiesReady = chatsFullLoadedRef.current && Array.isArray(current?.messages) && (
      current.messages.length > 0 || current.messagesLoaded
    );
    if (chatId === activeChatIdRef.current && bodiesReady) {
      setShowLanding(false);
      setActiveTab(chatModuleMeta(current).tab);
      setMobileChatHistoryOpen(false);
      return;
    }
    flushActiveChat({ preserveUpdatedAt: true });
    setOpeningChatId(chatId);
    try {
      await ensureFullChatsLoaded();
      const found = (chatSessionsRef.current || []).find((c) => c.id === chatId);
      if (!found) return;
      resetLiveChat(found.id, found);
    } catch (err) {
      console.warn('Could not open chat:', err?.message || err);
    } finally {
      setOpeningChatId(null);
      setMobileChatHistoryOpen(false);
    }
  };

  const deleteChat = (chatId, event) => {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const next = (chatSessionsRef.current || []).filter((c) => c.id !== chatId);
    chatSessionsRef.current = next;
    chatsBodiesRef.current = (chatsBodiesRef.current || []).filter((c) => c.id !== chatId);
    setChatSessions(next);
    writeCachedChatIndex(currentUser.id, { chats: next, activeChatId: activeChatIdRef.current === chatId ? null : activeChatIdRef.current });
    if (activeChatIdRef.current === chatId) {
      const id = newChatId();
      const destTab = activeTabRef.current === 'stella' ? 'stella' : (activeTabRef.current === 'territory' ? 'territory' : 'chat');
      const module = destTab === 'stella' ? 'stella' : (destTab === 'territory' ? 'territory' : 'incentives');
      resetLiveChat(id, { module }, { tab: destTab });
      persistChatList(next, id, { dropIds: [chatId] });
      return;
    }
    persistChatList(next, activeChatIdRef.current, { dropIds: [chatId] });
  };

  const handleSignOut = () => {
    flushActiveChat();
    persistChatList(chatSessionsRef.current, activeChatIdRef.current);
    clearCurrentUser();
    window.location.reload();
  };

  const renderChatHistorySidebar = () => {
    const listed = sidebarChats(chatSessions);
    const row = (chat) => {
      const mod = chatModuleMeta(chat);
      return (
        <div
          key={chat.id}
          className={`group relative flex items-start gap-1 rounded-lg overflow-hidden border ${chat.id === activeChatId ? 'bg-blue-500/20 border-blue-400/40' : 'border-transparent hover:bg-slate-700/40 hover:border-blue-400/20'}`}
        >
          <div className={`absolute left-0 top-0 bottom-0 w-1 ${mod.bar || 'bg-blue-400'}`} />
          <button
            type="button"
            onClick={() => continueChat(chat.id)}
            className="flex-1 min-w-0 text-left pl-3.5 pr-2.5 py-2"
          >
            <div className="mb-1">{chatModuleBadge(mod)}</div>
            <div className="text-xs font-semibold text-white truncate">{chat.title || 'Chat'}</div>
            <div className="text-[10px] text-blue-300/55 mt-0.5">
              {formatChatTime(chat.updatedAt)}
              {chat.currentWorkflow || chat.hasWorkflow ? ' · in progress' : ''}
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
    };
    return (
      <>
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
                {listed.length === 0 && (
                  <div className="text-[11px] text-blue-300/50 px-2 py-3">No saved chats yet. Start a conversation and it will appear here.</div>
                )}
                {listed.map(row)}
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
              {listed.length === 0 && (
                <div className="text-[11px] text-blue-300/50 px-2 py-3">No saved chats yet. Start a conversation and it will appear here.</div>
              )}
              {listed.map(row)}
            </div>
          </aside>
        )}
      </>
    );
  };

  const revealChatTools = () => {
    setChatToolsCollapsed(false);
    try { localStorage.setItem('comex-chat-tools-collapsed', '0'); } catch { /* ignore */ }
    setMobileChatToolsOpen(true);
  };

  const renderChatModuleBanner = (kind) => {
    const isStella = kind === 'stella';
    const Icon = isStella ? Layers : DollarSign;
    const title = isStella ? 'Stella Insights' : 'Incentive Compensation';
    const subtitle = isStella
      ? 'Chat with your data — analyse trends and chart insights'
      : 'Design, assess and optimise sales incentive schemes';
    return (
      <div className="bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl px-3 py-1 text-white shadow-md flex-shrink-0 mb-2">
        <div className="flex items-center justify-between gap-3 min-h-[1.5rem]">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <h2 className="text-[13px] font-bold leading-none truncate">{title}</h2>
            <span className="hidden sm:inline text-[11px] text-cyan-100/85 truncate">· {subtitle}</span>
          </div>
          {renderMobileChatChrome()}
        </div>
      </div>
    );
  };

  const goToIncentiveChat = () => {
    setShowLanding(false);
    setActiveTab('chat');
    setMobileChatToolsOpen(false);
  };

  const startDesignScheme = () => {
    goToIncentiveChat();
    window.setTimeout(() => {
      void launchWorkflowDirect('design_ic', 'I want to design a new incentive scheme');
    }, 100);
  };

  const startAssessIc = () => {
    goToIncentiveChat();
    fileInputRef.current?.click();
  };

  const openIcContextSettings = () => {
    setShowLanding(false);
    setActiveTab('user-settings');
    setUserSettingsPane('incentives');
    setMobileChatToolsOpen(false);
  };

  const startUploadIcContext = () => {
    openIcContextSettings();
    window.setTimeout(() => {
      document.getElementById('module-context-files-incentives')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      moduleContextFileInputRef.current?.setAttribute('data-module', 'incentives');
      moduleContextFileInputRef.current?.removeAttribute('data-source');
      moduleContextFileInputRef.current?.click();
    }, 150);
  };

  const startBestPractices = () => {
    goToIncentiveChat();
    window.setTimeout(() => {
      void handleSubmit(null, 'What are the key principles for designing effective sales incentive schemes?');
    }, 100);
  };

  const renderChatToolsBody = (kind) => {
    const isStella = kind === 'stella';
    const showQuick = !isStella && !waitingForPptxChoice;
    const pptxClarifyOptions = !isStella && waitingForPptxChoice ? (getPptxClarify().options || []) : [];
    const threadMsgs = isStella ? stellaMessages : messages;
    const threadOffers = !isStella && pptxOffers && (pptxOffers.thread || 'chat') !== 'stella' ? pptxOffers : null;
    const canExportPptx = !currentWorkflow
      && !threadOffers
      && !pptxGenerating
      && !waitingForPptxChoice
      && !(isStella ? stellaIsLoading : isLoading)
      && threadMsgs.filter((m) => m.role === 'assistant' || m.role === 'orchestrator').length > 0;
    const runToolPrompt = (e, value) => {
      e.preventDefault();
      setMobileChatToolsOpen(false);
      if (isStella) handleStellaChatSubmit(e, value);
      else handleSubmit(e, value);
    };
    const startStellaSessionSummary = () => {
      setMobileChatToolsOpen(false);
      handleGeneratePptx({ title: 'Session Summary', description: 'Factual recap of this conversation' }, 'summary');
    };
    return (
      <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isStella && (
            <div className="p-3 text-[11px] text-blue-300/55 leading-relaxed border-b border-blue-400/15">
              Upload datasets in User Settings → Stella Insights, then ask questions in this chat. Tables and charts in replies have their own Excel export.
            </div>
          )}
          {showQuick && (
            <div className="p-3 space-y-2 border-b border-blue-400/15">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-300/70">Start</div>
              <button type="button" onClick={startDesignScheme} className="w-full flex items-center gap-2 px-2.5 py-2 bg-slate-800/60 hover:bg-blue-500/20 border border-blue-400/25 hover:border-blue-400/50 rounded-lg text-xs text-blue-200 text-left"><Target className="w-3.5 h-3.5 shrink-0" /> Design New Scheme</button>
              <button type="button" onClick={startAssessIc} className="w-full flex items-center gap-2 px-2.5 py-2 bg-slate-800/60 hover:bg-cyan-500/20 border border-cyan-400/25 hover:border-cyan-400/50 rounded-lg text-xs text-cyan-200 text-left"><Upload className="w-3.5 h-3.5 shrink-0" /> Assess IC</button>
              <button type="button" onClick={startBestPractices} className="w-full flex items-center gap-2 px-2.5 py-2 bg-slate-800/60 hover:bg-purple-500/20 border border-purple-400/25 hover:border-purple-400/50 rounded-lg text-xs text-purple-200 text-left"><Award className="w-3.5 h-3.5 shrink-0" /> Best Practices</button>
            </div>
          )}
          {!isStella && (
            <div className="p-3 space-y-2 border-b border-blue-400/15">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-300/70">IC context files</div>
              <p className="text-[11px] text-blue-300/50 leading-relaxed">Uploads open in User Settings → Incentive Compensation, where intake runs as normal.</p>
              <button type="button" onClick={startUploadIcContext} className="w-full flex items-center gap-2 px-2.5 py-2 bg-slate-800/60 hover:bg-cyan-500/20 border border-cyan-400/25 hover:border-cyan-400/50 rounded-lg text-xs text-cyan-200 text-left"><Upload className="w-3.5 h-3.5 shrink-0" /> Upload context file</button>
              {(userSettings.moduleContext?.incentives?.files || []).length === 0 ? (
                <div className="text-[11px] text-blue-300/45">No context files yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {(userSettings.moduleContext?.incentives?.files || []).map((f) => {
                    const capturedView = harvestModuleCapturedContext(f.capturedContext, null, f.intakeMessages, {
                      extract: contextFileExtractBlob(f),
                    })
                      || f.capturedContext;
                    const n = Array.isArray(capturedView?.key_facts) ? capturedView.key_facts.length : 0;
                    const captured = isModuleContextCaptured(f);
                    const inv = Array.isArray(f.imageInventory) ? f.imageInventory : [];
                    const usedN = inv.filter((r) => r.status === 'included').length;
                    const unusedN = inv.filter((r) => r.status === 'skipped').length;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={openIcContextSettings}
                        className="w-full text-left px-2.5 py-2 bg-slate-900/40 hover:bg-slate-800/60 border border-blue-400/15 rounded-lg"
                      >
                        <div className="text-[11px] font-semibold text-blue-100 truncate">{f.name}</div>
                        <div className="text-[10px] text-blue-300/50 mt-0.5">
                          {f.processing ? 'Processing…' : captured ? (n ? `Context captured · ${n} fact${n === 1 ? '' : 's'}` : 'Context captured') : 'Needs intake'}
                          {(usedN || unusedN) ? ` · ${usedN} used · ${unusedN} not used` : ''}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
            <div className="p-3 space-y-2 border-b border-blue-400/15">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-300/70">Export</div>
              {isStella ? (
                <>
                  {pptxGenerating && (
                    <div className="px-2.5 py-2 bg-violet-900/30 border border-violet-400/30 rounded-lg flex items-center gap-2 text-xs text-violet-300">
                      <div className="w-3.5 h-3.5 border-2 border-violet-400/40 border-t-violet-400 rounded-full animate-spin flex-shrink-0" />
                      Generating session summary…
                    </div>
                  )}
                  {canExportPptx && (
                    <button type="button" onClick={startStellaSessionSummary} className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-400/25 hover:border-violet-400/40 rounded-lg text-xs text-violet-200 font-semibold">
                      Session summary
                    </button>
                  )}
                  {!canExportPptx && !pptxGenerating && (
                    <div className="text-[11px] text-blue-300/50 leading-relaxed">
                      Session summary export is available after Stella replies.
                    </div>
                  )}
                </>
              ) : (
                <>
              {pptxGenerating && (
                <div className="px-2.5 py-2 bg-violet-900/30 border border-violet-400/30 rounded-lg flex items-center gap-2 text-xs text-violet-300">
                  <div className="w-3.5 h-3.5 border-2 border-violet-400/40 border-t-violet-400 rounded-full animate-spin flex-shrink-0" />
                  Generating PowerPoint…
                </div>
              )}
              {threadOffers && !currentWorkflow && !pptxGenerating && (
                <div className="bg-slate-800/60 border border-violet-400/25 rounded-lg overflow-hidden">
                  <div className="px-2.5 py-1.5 border-b border-violet-400/15 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] text-violet-300/80 font-semibold">Export as PowerPoint</div>
                    <button type="button" onClick={() => setPptxOffers(null)} className="text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="divide-y divide-violet-400/15">
                    {threadOffers.summary && (
                      <div className="p-2.5 flex flex-col gap-1.5">
                        <div className="text-xs font-semibold text-violet-200">Session Summary</div>
                        <div className="text-[11px] text-slate-400">{threadOffers.summary.title}</div>
                        <button type="button" onClick={() => handleGeneratePptx(threadOffers.summary, 'summary')} className="mt-1 px-2.5 py-1.5 bg-violet-500/20 hover:bg-violet-500/35 border border-violet-400/30 rounded-lg text-xs text-violet-200 font-semibold">Generate</button>
                      </div>
                    )}
                    {threadOffers.produced && (
                      <div className="p-2.5 flex flex-col gap-1.5">
                        <div className="text-xs font-semibold text-emerald-300">Working Document</div>
                        <div className="text-[11px] text-slate-400">{threadOffers.produced.title}</div>
                        <button
                          type="button"
                          onClick={() => {
                            const dt = threadOffers.produced.deckType;
                            if (!dt || dt === 'general') setToolsPptxPick(true);
                            else handleGeneratePptx(threadOffers.produced, 'produced');
                          }}
                          className="mt-1 px-2.5 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/30 rounded-lg text-xs text-emerald-200 font-semibold"
                        >
                          Generate
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {pptxClarifyOptions.length > 0 && !pptxGenerating && (
                <div className="space-y-1.5">
                  <div className="text-[11px] text-blue-300/70 leading-relaxed">Choose a deck type:</div>
                  {pptxClarifyOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={(e) => runToolPrompt(e, opt.value)}
                      className="w-full px-2.5 py-2 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 hover:border-cyan-400/55 rounded-lg text-xs text-cyan-100 font-semibold transition-all text-left leading-snug"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {toolsPptxPick && !waitingForPptxChoice && !pptxGenerating && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-blue-300/70 leading-relaxed">Choose a deck type:</div>
                    <button type="button" onClick={() => setToolsPptxPick(false)} className="text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  {(getPptxClarify().options || []).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setMobileChatToolsOpen(false);
                        const resolved = pptxOfferFromClarifyValue(opt.value);
                        if (resolved?.mode && resolved.offer) handleGeneratePptx(resolved.offer, resolved.mode);
                      }}
                      className="w-full px-2.5 py-2 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 hover:border-cyan-400/55 rounded-lg text-xs text-cyan-100 font-semibold transition-all text-left leading-snug"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {canExportPptx && !toolsPptxPick && (
                <button type="button" onClick={startPptxExportFromUi} className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-400/25 hover:border-violet-400/40 rounded-lg text-xs text-violet-200 font-semibold">
                  Export as PowerPoint
                </button>
              )}
              {!canExportPptx && !threadOffers && !pptxGenerating && !waitingForPptxChoice && !toolsPptxPick && (
                <div className="text-[11px] text-blue-300/50 leading-relaxed">
                  {currentWorkflow
                    ? 'Export is paused while a workflow is in progress.'
                    : 'PowerPoint export is available after the assistant replies.'}
                </div>
              )}
                </>
              )}
            </div>
          <div className="p-3">
            {renderSuggestedPrompts('panel', kind)}
          </div>
      </div>
    );
  };

  const renderChatToolsPanel = (kind) => (
    <>
      {mobileChatToolsOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70"
            aria-label="Close tools"
            onClick={() => setMobileChatToolsOpen(false)}
          />
          <aside className="absolute inset-y-0 right-0 w-[min(20rem,88vw)] bg-slate-900 border-l border-blue-400/25 flex flex-col shadow-2xl">
            <div className="p-3 border-b border-blue-400/15 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-200">
                <Sparkles className="w-3.5 h-3.5" /> Tools
              </div>
              <button
                type="button"
                title="Close"
                onClick={() => setMobileChatToolsOpen(false)}
                className="p-1 rounded-md text-blue-300/70 hover:text-blue-100 hover:bg-slate-700/50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {renderChatToolsBody(kind)}
          </aside>
        </div>
      )}
      {chatToolsCollapsed ? (
        <aside className="hidden md:flex w-10 flex-col flex-shrink-0 bg-slate-800/40 border border-blue-400/20 rounded-xl overflow-hidden">
          <button
            type="button"
            title="Show tools"
            onClick={toggleChatToolsCollapsed}
            className="flex-1 flex flex-col items-center gap-2 py-3 text-blue-200 hover:bg-slate-700/40"
          >
            <Sparkles className="w-4 h-4" />
            <ChevronDown className="w-4 h-4 rotate-90" />
          </button>
        </aside>
      ) : (
        <aside className="hidden md:flex w-56 lg:w-64 flex-col flex-shrink-0 bg-slate-800/40 border border-blue-400/20 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-blue-400/15 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-200">
              <Sparkles className="w-3.5 h-3.5" /> Tools
            </div>
            <button
              type="button"
              title="Collapse tools"
              onClick={toggleChatToolsCollapsed}
              className="p-1 rounded-md text-blue-300/70 hover:text-blue-100 hover:bg-slate-700/50"
            >
              <ChevronDown className="w-3.5 h-3.5 rotate-90" />
            </button>
          </div>
          {renderChatToolsBody(kind)}
        </aside>
      )}
    </>
  );

  const renderMobileChatChrome = () => (
    <div className="md:hidden flex items-center gap-1.5 shrink-0">
      <button type="button" onClick={() => setMobileChatHistoryOpen(true)} className="flex items-center gap-1 px-2 py-1 bg-white/15 hover:bg-white/25 rounded-md text-[11px] font-semibold">
        <History className="w-3.5 h-3.5" /> Chats
      </button>
      <button type="button" onClick={startNewChat} className="flex items-center gap-1 px-2 py-1 bg-white/15 hover:bg-white/25 rounded-md text-[11px] font-semibold">
        <Plus className="w-3.5 h-3.5" /> New
      </button>
      <button type="button" onClick={() => setMobileChatToolsOpen(true)} className="flex items-center gap-1 px-2 py-1 bg-white/15 hover:bg-white/25 rounded-md text-[11px] font-semibold">
        <Sparkles className="w-3.5 h-3.5" /> Tools
      </button>
    </div>
  );

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
    const eligible = filterKnowledgeDocuments(documents, knowledgeAccessLive(), 'agents');
    const selected = keys.includes('*')
      ? eligible
      : eligible.filter((d) => keys.some((k) => d.name === k || d.name.endsWith(`/${k}`) || d.id === k));
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
    const lengthSource = `${agent.systemPrompt}\n${taskBlock}\n${step.goal || ''}\n${step.successCriteria || ''}`;
    return await callAnthropicMaybeStellaTools(
      system,
      messages,
      resolveUserFacingMaxTokens(3000, userSettingsRef.current || userSettings, lengthSource),
      { maxRounds: 4 },
    );
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

${evaluatePrompt}`, { applyResponseLength: false });

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
    return await callAnthropicMaybeStellaTools(
      system,
      [{ role: 'user', content: task }],
      resolveUserFacingMaxTokens(2000, userSettingsRef.current || userSettings, `${agent.systemPrompt}\n${task}`),
      { maxRounds: 3 },
    );
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
        resolveUserFacingMaxTokens(900, userSettingsRef.current || userSettings, `${orch.role}\n${introInstr}`),
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

  const launchWorkflowDirect = async (topicId, userMessage, focusedContext = null, source = 'direct') => {
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
    const fileName = uploadedFileRef.current?.name || '';
    const triggerRec = source === 'file'
      ? buildWorkflowTriggerRecord({ trigger: 'file', message: fileName || userMessage })
      : buildWorkflowTriggerRecord({ trigger: source || 'direct', message: userMessage });
    patchWorkflowRun({
      topicId: topic.id,
      topicName: topic.name,
      status: 'running',
      ...triggerRec,
    });
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
    if (shouldHarvestChatMemory('', typedInput || '')) {
      const priorAsk = [...(messagesRef.current || [])].reverse().find((m) => m.role === 'assistant' || m.role === 'orchestrator');
      void harvestChatMemory(priorAsk?.content, typedInput, recentChatTurnsForMemory());
    }
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
    const wrapSettings = userSettingsRef.current || userSettings;
    const wrapLen = normalizeResponseLength(wrapSettings?.responseLength);
    const snippet = wrapLen >= 3 ? 900 : wrapLen >= 2 ? 350 : 180;
    const wrapPrompt = `${topic.orchestrator?.role || ''}\n${topic.orchestrator?.wrapUpPrompt || DEFAULT_ORCHESTRATOR_PROMPTS.wrapUpPrompt}`;
    const wrapSystem = withUserSettings(wrapPrompt);
    const wrapSummary = await callAnthropic(
      wrapSystem,
      [{ role: 'user', content: `Completed: ${topic.name}\n${updatedContext.map((c) => `${c.step}: ${c.output.substring(0, snippet)}`).join('\n')}` }],
      resolveUserFacingMaxTokens(1600, wrapSettings, wrapPrompt),
    );
    setMessages(prev => {
      const updated = [...prev, { role: 'orchestrator', content: wrapSummary }];
      setTimeout(() => generateSuggestions(updated), 800);
      return updated;
    });
    setMessages(prev => [...prev, { role: 'system', content: `✅ **Workflow complete** — ${topic.workflow.length} steps finished.` }]);
    patchWorkflowRun({ topicId: topic.id, topicName: topic.name, status: 'completed' });
    setCurrentWorkflow(null);
    setIsLoading(false);
  };

  const runWorkflowStep = async (topic, stepIndex, userMessage, workflowContext, focusedContextOverride = null) => {
    if (shouldHarvestChatMemory('', userMessage) && !/^User (feedback|instruction|request):/i.test(String(userMessage || ''))) {
      const priorAsk = [...(messagesRef.current || [])].reverse().find((m) => m.role === 'assistant' || m.role === 'orchestrator');
      void harvestChatMemory(priorAsk?.content, userMessage, recentChatTurnsForMemory());
    }
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
1) Summarise findings (strengths, weaknesses, compliance issues, information gaps) at the user's ANSWER DETAIL level.
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
      } else if (isTerritoryWorkflow && isStructureStep) {
        const territoryFiles = (userSettingsRef.current.moduleContext?.territory?.files || []).filter((f) => f?.tableName);
        const activeFile = territoryFiles.find((f) => f.id === selectedTerritoryFileId) || territoryFiles[0];
        if (focusedContext) {
          taskBriefing = `${focusedContext}\n\nINSTRUCTION: The user wants to assess the FOCUS TERRITORY marked above. Begin by presenting a brief profile then ask what specific aspects the user wants to explore.`;
        } else if (activeFile) {
          const layout = activeFile.mapLayout || {};
          const structSummary = `LOADED TERRITORY FILE: "${activeFile.name}"\nRows: ${activeFile.rowCount ?? 'unknown'}\nTeam column: ${layout.teamColumn || '(none)'}\nTerritory column: ${layout.territoryColumn || '(none)'}\nGeo column: ${layout.geoColumn || '(none)'} (${layout.geoKind || 'unknown'})${layout.country ? `\nCountry: ${layout.country}` : ''}`;
          taskBriefing = `${structSummary}\n\nUser request: ${userMessage}\n\nAsk: (1) Use this uploaded structure or provide a different one? (2) Cover all territories or focus on a specific team/region?`;
        }
      } else if (workflowContext.length > 0) {
        const contextSummary = workflowContext.map(c => `[${c.step}] ${c.agent}: ${c.output}`).join('\n\n');
        const briefingSystem = withUserSettings(`${topic.orchestrator?.role || ''}\n${topic.orchestrator?.briefingPrompt || DEFAULT_ORCHESTRATOR_PROMPTS.briefingPrompt}`, { applyResponseLength: false });
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
          classifyPrompt || withUserSettings(getWorkflowRuntime().proposalImageClassifyPrompt, { moduleContext: false, applyResponseLength: false }),
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
        console.warn('Context image scan failed:', err);
      }
    }
    return { kind, fileType: label, extractedText, structuredText, included, unsure, skipped, imageNotes };
  };

  const runContextIntakeTurn = async ({ extractBlob, moduleLabel: label, intakeMessages, fileName }) => {
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
    const hasUserReply = (intakeMessages || []).some((m) => m.role === 'user');
    let complete = !!parsed.complete;
    const context_qa = pickIntakeContextQa(parsed);
    let message = stripOffTopicIntakeQuestions(stripJsonFromIntakeMessage(parsed.message));
    if (!hasUserReply) {
      complete = false;
      if (!intakeMessageLooksLikeAsk(message) || String(message || '').replace(/\s+/g, ' ').trim().length < 12) {
        message = CONTEXT_FILE_CONFIRM_QUESTION;
      }
    } else if (!intakeMessageLooksLikeAsk(message) || complete) {
      complete = true;
      message = stripJsonFromIntakeMessage(message) || contextFileAddedConfirm(fileName, label);
    } else if (!message) {
      message = 'Is anything in this file still unclear?';
    }
    return {
      complete,
      message,
      context_qa,
    };
  };

  const summarizeContextFile = async ({ name, extractBlob, moduleId, columns = [] }) => {
    const fallback = {
      summary: '', columns: [], suggestedQuestions: [],
      what_it_represents: '', time_period: '', key_facts: [], key_metrics: [], interpretation_notes: '',
    };
    if (isThinContextExtract(extractBlob, name)) return fallback;
    const rt = getWorkflowRuntime();
    const system = fillTemplate(rt.contextContentSummaryPrompt, {
      moduleLabel: moduleLabelFor(moduleId),
    });
    const colText = columns.length ? `\n\nDETECTED COLUMNS:\n${columns.map((c) => `- ${c.name}`).join('\n')}` : '';
    const ask = async (extra = '') => {
      const raw = await callAnthropic(system, [{
        role: 'user',
        content: `FILE NAME: ${name}\nStored under: ${moduleLabelFor(moduleId)} (storage location only — not a topic to ask about).${colText}\n\nFILE CONTENTS:\n${String(extractBlob || '').slice(0, 18000)}\n\nReturn the JSON object now. key_facts must list discrete facts from FILE CONTENTS (prefer 4–20).${extra}`,
      }], 3500);
      return parseContextSummaryResponse(raw);
    };
    let parsed = null;
    try {
      parsed = await ask();
    } catch (err) {
      console.warn('Context summary failed:', err);
    }
    const factCount = Array.isArray(parsed?.key_facts) ? parsed.key_facts.filter((f) => String(f || '').trim().length >= 4).length : 0;
    if (!parsed || typeof parsed !== 'object' || !factCount) {
      try {
        parsed = await ask('\nThe previous reply was empty or invalid. Extract key_facts from the file text above — do not return empty arrays if facts are present.');
      } catch (err) {
        console.warn('Context summary retry failed:', err);
        if (!parsed) throw err;
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Could not parse captured facts from the model response.');
    }
    const questions = stellaNormalizeIntakeQuestions(
      parsed.suggestedQuestions != null ? parsed.suggestedQuestions : parsed.questions
    ).filter((q) => !isEmptyContextValue(q) && !contextIntakeQuestionLooksOffTopic(q));
    const columnsOut = (Array.isArray(parsed.columns) ? parsed.columns : [])
      .filter((c) => c && !isEmptyContextValue(c.name));
    const summary = isEmptyContextValue(parsed.summary) ? '' : String(parsed.summary).trim();
    const facts = (Array.isArray(parsed.key_facts) ? parsed.key_facts : [])
      .map((f) => String(f || '').replace(/\s+/g, ' ').trim())
      .filter((f) => f.length >= 4 && !isEmptyContextValue(f))
      .slice(0, 24);
    const metrics = (Array.isArray(parsed.key_metrics) ? parsed.key_metrics : [])
      .map((m) => String(m || '').replace(/\s+/g, ' ').trim())
      .filter((m) => m && !isEmptyContextValue(m))
      .slice(0, 40);
    if (!metrics.length && columnsOut.length) {
      columnsOut.forEach((c) => {
        const line = c.description ? `${c.name} = ${c.description}` : c.name;
        if (line) metrics.push(line);
      });
    }
    return {
      summary,
      columns: columnsOut,
      suggestedQuestions: questions,
      what_it_represents: isEmptyContextValue(parsed.what_it_represents) ? '' : String(parsed.what_it_represents).trim(),
      time_period: isEmptyContextValue(parsed.time_period) ? '' : String(parsed.time_period).trim(),
      key_facts: facts,
      key_metrics: metrics,
      interpretation_notes: isEmptyContextValue(parsed.interpretation_notes) ? '' : String(parsed.interpretation_notes).trim(),
    };
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
            withUserSettings(getWorkflowRuntime().proposalImageInterpretPrompt, { moduleContext: false, applyResponseLength: false }),
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
      ? ctx.qa_pairs.map((p) => intakePairFact(p)).filter(Boolean).map((f) => `- ${f}`).join('\n')
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
    setMessages((prev) => [...prev, { role: 'assistant', content: assistantMsg, kind: 'intake' }]);
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
      setMessages((prev) => [...prev, { role: 'assistant', content: result.message, kind: 'intake' }]);
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

  const rememberContextImages = (fileId, { included = [], unsure = [], skipped = [] } = {}) => {
    if (!fileId) return;
    contextImageAssetsRef.current[fileId] = {
      included: (included || []).map((img) => imageWithBlob(img)).filter(Boolean),
      unsure: (unsure || []).map((img) => imageWithBlob(img)).filter(Boolean),
      skipped: (skipped || []).map((img) => imageWithBlob(img)).filter(Boolean),
    };
    const previews = buildProposalImagePreviews(included, unsure, skipped);
    setContextImagePreviewsByFile((prev) => ({ ...prev, [fileId]: previews }));
  };

  const interpretContextImages = async (images, onStatus, moduleId) => {
    if (!images?.length) return '';
    onStatus?.(`Reading ${Math.min(images.length, 8)} image(s)…`);
    const rt = getWorkflowRuntime();
    const prompt = rt.contextImageInterpretPrompt;
    return interpretProposalImages(
      images,
      withUserSettings(prompt, { moduleContext: false, applyResponseLength: false }),
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
    const fromChat = !!job.fromChat;
    const postChat = (content, extra = {}) => {
      if (!fromChat) return;
      setMessages((prev) => [...prev, { role: extra.role || 'system', content, ...extra }]);
    };
    let visionText = '';
    try {
      if (images.length) {
        if (fromChat) {
          postChat(`🖼️ Extracting content and key points from **${Math.min(images.length, 8)}** image(s)…`);
        }
        visionText = await interpretContextImages(images, (msg) => {
          job.onStatus?.(msg);
          if (fromChat) {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === 'system' && /Extracting content|Reading image/.test(String(last.content || ''))) {
                copy[copy.length - 1] = { ...last, content: `🖼️ ${msg}` };
                return copy;
              }
              return [...prev, { role: 'system', content: `🖼️ ${msg}` }];
            });
          }
        }, moduleId);
      }
    } catch (err) {
      job.onStatus?.(`Image reading skipped: ${err.message || 'vision failed'}`);
      postChat(`⚠️ Image reading skipped: ${err.message || 'vision failed'}. Continuing with text extract.`);
    }

    const extractBlob = [extractedText, structuredText, visionText].filter((t) => !isEmptyContextValue(t)).join('\n\n');
    let onboarding = {
      summary: '', suggestedQuestions: [], columns: [],
      what_it_represents: '', time_period: '', key_facts: [], key_metrics: [], interpretation_notes: '',
    };
    if (!isThinContextExtract(extractBlob, file.name)) {
      try {
        job.onStatus?.('Capturing key facts…');
        postChat('⏳ Capturing key facts from this file…');
        onboarding = await summarizeContextFile({ name: file.name, extractBlob, moduleId });
      } catch (err) {
        const why = err?.message || 'fact capture failed';
        console.warn('Context fact capture failed:', err);
        job.onStatus?.(`Fact capture failed: ${why}`);
        postChat(`⚠️ Could not capture facts automatically: ${why}. The raw extract is saved — you can add facts under Incentive Comp context files.`);
      }
    }
    let questions = stellaNormalizeIntakeQuestions(onboarding.suggestedQuestions)
      .filter((q) => !contextIntakeQuestionLooksOffTopic(q));
    let assistantMsg = '';
    try {
      job.onStatus?.('Asking clarifying questions…');
      postChat('⏳ Checking what still needs clarifying in this file…');
      const probe = await runContextIntakeTurn({
        extractBlob: extractBlob || `File name: ${file.name}`,
        moduleLabel: moduleLabelFor(moduleId),
        fileName: file.name,
        intakeMessages: [],
      });
      assistantMsg = stripOffTopicIntakeQuestions(stripJsonFromIntakeMessage(probe.message));
      if (questions.length && !/\n\s*1[\.)]\s/.test(assistantMsg)) {
        assistantMsg = `${assistantMsg ? `${assistantMsg}\n\n` : ''}${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
      }
    } catch (err) {
      console.warn('Context intake opening turn failed:', err);
    }
    const summaryLine = onboarding.summary ? `\n\n${onboarding.summary}` : '';
    const factCount = (onboarding.key_facts || []).filter((f) => String(f || '').trim()).length;
    if (!assistantMsg || !intakeMessageLooksLikeAsk(assistantMsg)) {
      assistantMsg = questions.length
        ? `${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
        : CONTEXT_FILE_CONFIRM_QUESTION;
    }
    assistantMsg = `I've saved **${file.name}** for ${moduleLabelFor(moduleId)}.${summaryLine}${factCount ? `\n\nI captured **${factCount}** key fact${factCount === 1 ? '' : 's'} so far.` : ''}\n\n${assistantMsg}`;
    const captured = compactCapturedContext({
      what_it_represents: onboarding.what_it_represents,
      time_period: onboarding.time_period,
      key_facts: onboarding.key_facts,
      key_metrics: onboarding.key_metrics,
      interpretation_notes: onboarding.interpretation_notes,
    });
    rememberContextImages(fileId, { included: images, unsure: [], skipped: job.skipped || [] });
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
      imageCount: (images.length || 0) + ((job.skipped || []).length || 0),
      columns: onboarding.columns,
      capturedContext: captured,
      imageInventory: compactImageInventory(images, [], job.skipped || []),
      intakeMessages: [{ role: 'assistant', content: assistantMsg }],
      intakeComplete: false,
      processing: false,
    };
    const nextCtx = upsertModuleContextFile(userSettingsRef.current.moduleContext, moduleId, rec);
    await persistContextFiles(nextCtx);
    setActiveContextFileId(fileId);
    contextIngestJobRef.current = null;
    setContextIngestJob(null);
    const intake = { moduleId, fileId, fromChat };
    pendingModuleContextIntakeRef.current = intake;
    setPendingModuleContextIntake(intake);
    if (fromChat) {
      setMessages((prev) => [...prev.filter((m) => m.kind !== 'intake-think'), { role: 'assistant', content: assistantMsg, kind: 'intake' }]);
      setIsLoading(false);
    }
  };

  const continueModuleContextIntake = async (moduleId, fileId, userText, { fromChat = false } = {}) => {
    const files = userSettingsRef.current.moduleContext?.[moduleId]?.files || [];
    const rec = files.find((f) => f.id === fileId);
    if (!rec) return;
    const nextMessages = [...(rec.intakeMessages || []).filter((m) => !String(m.content || '').startsWith('⏳')), { role: 'user', content: userText }];
    setContextIntakeBusy(true);
    if (fromChat) {
      setIsLoading(true);
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        const think = { role: 'system', content: '⏳ Saving your answers as separate facts…', kind: 'intake-think' };
        if (last?.kind === 'intake-think' || (last?.role === 'system' && String(last.content || '').startsWith('⏳'))) {
          copy[copy.length - 1] = think;
          return copy;
        }
        return [...copy, think];
      });
    }
    const thinkLine = { role: 'system', content: '⏳ Saving your answers as separate facts…' };
    const optimistic = patchModuleContextFile(userSettingsRef.current.moduleContext, moduleId, fileId, {
      intakeMessages: [...nextMessages, thinkLine],
    });
    setUserSettings((prev) => ({ ...prev, moduleContext: optimistic }));
    try {
      const result = await runContextIntakeTurn({
        extractBlob: [rec.extractedText, rec.structuredExtract, rec.visionExtract].filter((t) => !isEmptyContextValue(t)).join('\n\n'),
        moduleLabel: moduleLabelFor(moduleId),
        fileName: rec.name,
        intakeMessages: nextMessages,
      });
      const confirm = contextFileAddedConfirm(rec.name, moduleLabelFor(moduleId));
      const assistantMsg = result.complete
        ? confirm
        : (stripOffTopicIntakeQuestions(stripJsonFromIntakeMessage(result.message)) || 'Is anything in this file still unclear?');
      const withAssistant = [...nextMessages, { role: 'assistant', content: assistantMsg }];
      const qa = result.context_qa && typeof result.context_qa === 'object' ? result.context_qa : null;
      const mergedCtx = harvestModuleCapturedContext(rec.capturedContext, qa, withAssistant, {
        extract: [rec.extractedText, rec.structuredExtract, rec.visionExtract].filter((t) => !isEmptyContextValue(t)).join('\n\n'),
      })
        || rec.capturedContext;
      const storedFacts = (mergedCtx?.qa_pairs || []).map((p) => intakePairFact(p)).filter(Boolean);
      const intakeSteps = [
        { type: 'thought', label: 'Read your reply', detail: String(userText || '').slice(0, 500) },
        { type: 'context', label: `Stored ${storedFacts.length} fact${storedFacts.length === 1 ? '' : 's'}`, detail: storedFacts.join('\n') },
      ];
      const patched = patchModuleContextFile(optimistic, moduleId, fileId, {
        intakeMessages: withAssistant,
        intakeComplete: !!result.complete,
        capturedContext: mergedCtx,
      });
      await persistContextFiles(patched);
      if (fromChat) {
        setMessages((prev) => [
          ...prev.filter((m) => m.kind !== 'intake-think'),
          { role: 'assistant', content: assistantMsg, kind: 'intake', steps: intakeSteps },
        ]);
      }
      if (result.complete) {
        pendingModuleContextIntakeRef.current = null;
        setPendingModuleContextIntake(null);
      } else {
        const next = { moduleId, fileId, fromChat };
        pendingModuleContextIntakeRef.current = next;
        setPendingModuleContextIntake(next);
      }
    } catch (err) {
      const patched = patchModuleContextFile(optimistic, moduleId, fileId, {
        intakeMessages: [...nextMessages, { role: 'system', content: `⚠️ ${err.message || 'Intake failed'}` }],
      });
      await persistContextFiles(patched);
      if (fromChat) {
        setMessages((prev) => [...prev, { role: 'system', content: `⚠️ Could not continue intake: ${err.message || 'error'}. Facts already captured are still saved.` }]);
      }
    } finally {
      setContextIntakeBusy(false);
      setContextIntakeInput('');
      setContextIntakeByFile((prev) => ({ ...prev, [fileId]: '' }));
      if (fromChat) setIsLoading(false);
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
    rememberContextImages(prev.fileId, { included, unsure, skipped });
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

  const mergeContextFactLines = (a, b) => {
    const seen = new Set();
    const out = [];
    [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].forEach((item) => {
      const t = String(item || '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      const key = t.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    });
    return out;
  };

  const toggleContextImageUse = async (moduleId, fileId, imageName, use) => {
    const rec = (userSettingsRef.current.moduleContext?.[moduleId]?.files || []).find((f) => f.id === fileId);
    if (!rec || rec.processing) return;
    const job = (contextIngestJob?.fileId === fileId) ? contextIngestJob : null;
    if (job?.unsure?.length) {
      await applyContextUnsureImageDecision(imageName, use);
      return;
    }
    const store = contextImageAssetsRef.current[fileId] || { included: [], unsure: [], skipped: [] };
    let included = [...(store.included || [])];
    let skipped = [...(store.skipped || [])];
    const match = (img) => String(img?.name || '') === String(imageName || '');
    if (use) {
      const fromSkip = skipped.find(match);
      if (!fromSkip) return;
      const blob = imageWithBlob(fromSkip);
      if (!blob?.base64) {
        setContextEditSaveStatus('error');
        return;
      }
      skipped = skipped.filter((img) => !match(img));
      included = [...included.filter((img) => !match(img)), { ...blob, included: true, reason: 'User included' }];
      rememberContextImages(fileId, { included, unsure: [], skipped });
      setContextImageBusy({ fileId, name: imageName });
      try {
        const extra = await interpretContextImages([blob], undefined, moduleId);
        const visionExtract = [rec.visionExtract, extra].filter((t) => !isEmptyContextValue(t)).join('\n\n');
        let captured = rec.capturedContext;
        if (!isThinContextExtract(extra, rec.name)) {
          try {
            const extraFacts = await summarizeContextFile({ name: rec.name, extractBlob: extra, moduleId });
            captured = compactCapturedContext({
              ...(captured || {}),
              key_facts: mergeContextFactLines(captured?.key_facts, extraFacts.key_facts),
              key_metrics: mergeContextFactLines(captured?.key_metrics, extraFacts.key_metrics),
              interpretation_notes: extraFacts.interpretation_notes || captured?.interpretation_notes,
            });
          } catch { /* keep vision extract even if fact merge fails */ }
        }
        await persistContextFiles(patchModuleContextFile(userSettingsRef.current.moduleContext, moduleId, fileId, {
          visionExtract,
          capturedContext: captured,
          imageInventory: compactImageInventory(included, [], skipped),
          imageCount: included.length + skipped.length,
        }));
      } finally {
        setContextImageBusy(null);
      }
      return;
    }
    const fromInc = included.find(match);
    if (!fromInc) return;
    included = included.filter((img) => !match(img));
    skipped = [...skipped.filter((img) => !match(img)), { ...fromInc, included: false, kind: 'skipped_by_user', reason: 'User skipped' }];
    rememberContextImages(fileId, { included, unsure: [], skipped });
    await persistContextFiles(patchModuleContextFile(userSettingsRef.current.moduleContext, moduleId, fileId, {
      imageInventory: compactImageInventory(included, [], skipped),
      imageCount: included.length + skipped.length,
    }));
  };

  const handleModuleContextUpload = async (event, moduleId) => {
    const file = event.target.files?.[0];
    const fromChat = event.target.getAttribute('data-source') === 'chat';
    event.target.removeAttribute('data-source');
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
    const lowerName = file.name.toLowerCase();
    if (moduleId === 'territory' && /\.(csv|xlsx|xls|json)$/i.test(lowerName)) {
      try {
        await ingestTerritoryTabularFile(file, { fileId });
      } catch (err) {
        await persistContextFiles(patchModuleContextFile(userSettingsRef.current.moduleContext, moduleId, fileId, {
          processing: false,
          intakeMessages: [{ role: 'system', content: `❌ Upload failed: ${err.message || 'error'}` }],
        }));
      }
      return;
    }
    if (!fromChat) {
      setUserSettingsPane(moduleId === 'stella' ? 'stella' : moduleId === 'territory' ? 'territory' : 'incentives');
    } else {
      setIsLoading(true);
      setMessages((prev) => [...prev, {
        role: 'system',
        content: `⏳ Uploading **${file.name}** as Incentive Comp context — scanning text and images…`,
      }]);
    }
    const classifyPrompt = withUserSettings(
      getWorkflowRuntime().contextImageClassifyPrompt,
      { moduleContext: false, applyResponseLength: false },
    );
    try {
      const extracts = await extractDocumentForIngest(file, {
        classifyPrompt,
        onStatus: (msg) => {
          setUserSettings((prev) => ({
            ...prev,
            moduleContext: patchModuleContextFile(prev.moduleContext, moduleId, fileId, {
              intakeMessages: [{ role: 'assistant', content: `⏳ ${msg}` }],
            }),
          }));
          if (fromChat) {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === 'system' && String(last.content || '').includes('⏳')) {
                copy[copy.length - 1] = { ...last, content: `⏳ ${msg}` };
                return copy;
              }
              return [...prev, { role: 'system', content: `⏳ ${msg}` }];
            });
          }
        },
      });
      if (extracts.imageNotes?.length && fromChat) {
        const scanErr = extracts.imageNotes.find((n) => /fail|error|skipped/i.test(String(n)));
        if (scanErr) {
          setMessages((prev) => [...prev, { role: 'system', content: `⚠️ Image scan: ${scanErr}` }]);
        }
      }
      const included = extracts.included || [];
      const unsure = extracts.unsure || [];
      const skipped = extracts.skipped || [];
      const job = {
        moduleId,
        fileId,
        file,
        fromChat,
        fileType: extracts.fileType,
        extractedText: extracts.extractedText,
        structuredText: extracts.structuredText,
        imageNotes: extracts.imageNotes,
        included,
        unsure,
        skipped,
        ingestKind: 'moduleContext',
        onStatus: (msg) => {
          setUserSettings((prev) => ({
            ...prev,
            moduleContext: patchModuleContextFile(prev.moduleContext, moduleId, fileId, {
              intakeMessages: [{ role: 'assistant', content: `⏳ ${msg}` }],
            }),
          }));
        },
      };
      const previews = buildProposalImagePreviews(included, unsure, skipped);
      const inventory = compactImageInventory(included, unsure, skipped);
      rememberContextImages(fileId, { included, unsure, skipped });
      const ignoredPurpose = skipped.filter((s) =>
        ['logo', 'decorative', 'icon', 'stock_photo'].includes(s.kind || s.purpose),
      );
      if (fromChat && previews.length) {
        setMessages((prev) => [...prev, {
          role: 'system',
          content: unsure.length
            ? `🖼️ **${included.length}** strategy/IC image(s) will be extracted. **${unsure.length}** still need a yes/no — include any that carry strategy or IC context (skip logos and decoration).`
            : included.length
              ? `🖼️ **${included.length}** strategy/IC image(s) will be read for context${ignoredPurpose.length ? `; ${ignoredPurpose.length} logo/decoration skipped` : ''}.`
              : `⚠️ **No strategy/IC images** for vision${ignoredPurpose.length ? ` (${ignoredPurpose.length} logo/decorative skipped)` : ''} — click a thumbnail to inspect.`,
          imagePreviews: previews,
          imageReviewPending: unsure.length > 0,
        }]);
      }
      if (unsure.length) {
        contextIngestJobRef.current = job;
        setContextIngestJob(job);
        setUserSettings((prev) => ({
          ...prev,
          moduleContext: patchModuleContextFile(prev.moduleContext, moduleId, fileId, {
            processing: true,
            imageInventory: inventory,
            intakeMessages: [{
              role: 'assistant',
              content: `🖼️ **${included.length}** strategy/IC image(s) will be read. **${unsure.length}** need a yes/no — click a thumbnail to enlarge, then include or skip.`,
            }],
          }),
        }));
        if (fromChat) {
          pendingImageReviewRef.current = job;
          setPendingImageReview(job);
          setIsLoading(false);
        }
        return;
      }
      await completeModuleContextIngest({ ...job, images: included });
    } catch (err) {
      const failed = patchModuleContextFile(userSettingsRef.current.moduleContext, moduleId, fileId, {
        processing: false,
        intakeMessages: [{ role: 'system', content: `❌ Could not process ${file.name}: ${err.message || 'error'}` }],
      });
      await persistContextFiles(failed);
      if (fromChat) {
        setIsLoading(false);
        setMessages((prev) => [...prev, {
          role: 'system',
          content: `❌ Could not process ${file.name}: ${err.message || 'error'}`,
        }]);
      }
    }
  };

  const handleRemoveModuleContextFile = async (moduleId, fileId) => {
    const rec = (userSettingsRef.current.moduleContext?.[moduleId]?.files || []).find((f) => f.id === fileId);
    if (rec?.storagePath) {
      try {
        await supabase.storage.from('intelligence').remove([rec.storagePath, `${rec.storagePath}.extracted.txt`]);
      } catch { /* ignore */ }
    }
    if (rec?.tableName) {
      try { await stellaTableApi({ action: 'drop', tableName: rec.tableName }); } catch { /* ignore */ }
    }
    const next = removeModuleContextFile(userSettingsRef.current.moduleContext, moduleId, fileId);
    await persistContextFiles(next);
    if (activeContextFileId === fileId) setActiveContextFileId(null);
    setContextImagePreviewsByFile((prev) => {
      if (!prev?.[fileId]) return prev;
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
    if (contextImageAssetsRef.current[fileId]) delete contextImageAssetsRef.current[fileId];
    setContextFileDeleteConfirm((prev) => (prev?.fileId === fileId ? null : prev));
  };

  const requestRemoveModuleContextFile = (moduleId, file) => {
    if (!file?.id) return;
    setContextFileDeleteConfirm({ moduleId, fileId: file.id, name: file.name || 'this file' });
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
    const patch = {};
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
    } else if (blockId === 'facts') {
      const facts = empty ? [] : String(nextValue || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
      patch.capturedContext = { ...ctx, key_facts: facts };
    } else if (blockId.startsWith('qa:')) {
      const idx = Number(blockId.slice(3));
      const qa = [...(ctx.qa_pairs || [])];
      if (empty || idx < 0 || idx >= qa.length) qa.splice(idx, 1);
      else if (nextValue && typeof nextValue === 'object') {
        qa[idx] = {
          question: nextValue.question || qa[idx].question || '',
          answer: nextValue.answer || qa[idx].answer || '',
          fact: nextValue.fact || intakePairFact({ ...qa[idx], ...nextValue }),
        };
      } else {
        qa[idx] = { ...qa[idx], fact: nextValue, answer: nextValue };
      }
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
    const job = (contextIngestJob?.moduleId === moduleId) ? contextIngestJob : null;
    const imagePreviews = (job && !job.processing && (job.unsure?.length || job.included?.length || job.skipped?.length))
      ? buildProposalImagePreviews(job.included || [], job.unsure || [], job.skipped || [])
      : [];
    const pendingImageCount = imagePreviews.filter((img) => img.pending).length;
    const openContextImageLightbox = (img, fileId) => {
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
        fileId,
        moduleId,
        canToggle: !img.pending,
      });
    };
    return (
      <div id={`module-context-files-${moduleId}`} className="mt-8 pt-6 border-t border-blue-400/15">
        <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" /> {moduleLabelFor(moduleId)} context files
        </h3>
        <p className="text-xs text-blue-300/60 mb-2">
          PowerPoint, PDF, Excel, CSV, or text. Intake harvests facts from the file — it does not design schemes. Strategy and IC images are auto-included (logos skipped; unclear slides wait for you). Captured facts are stored per file and shared with later IC design, the incentive LLM, and the context map.
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
        {files.length === 0 ? (
          <div className="text-xs text-blue-300/50 bg-slate-900/30 border border-dashed border-blue-400/20 rounded-xl p-4">No context files yet for this module.</div>
        ) : (
          <div className="space-y-3">
            {contextEditSaveStatus === 'saving' && <div className="text-[11px] text-blue-300/70">Saving…</div>}
            {contextEditSaveStatus === 'saved' && <div className="text-[11px] text-green-400 font-semibold">Saved</div>}
            {contextEditSaveStatus === 'error' && <div className="text-[11px] text-red-400 font-semibold">Save failed</div>}
            {files.map((f) => {
              const capturedView = harvestModuleCapturedContext(f.capturedContext, null, f.intakeMessages, {
                extract: contextFileExtractBlob(f),
              })
                || f.capturedContext;
              const factN = Array.isArray(capturedView?.key_facts) ? capturedView.key_facts.length : 0;
              const qaN = Array.isArray(capturedView?.qa_pairs) ? capturedView.qa_pairs.length : 0;
              const captured = isModuleContextCaptured(f);
              const sourceBlocks = (f.extractedText || f.structuredExtract || f.visionExtract)
                ? [
                  f.extractedText && { id: 'extractedText', label: 'Detected from file', value: f.extractedText },
                  f.structuredExtract && { id: 'structuredExtract', label: 'Tables / charts', value: f.structuredExtract },
                  f.visionExtract && { id: 'visionExtract', label: 'From images', value: f.visionExtract },
                ].filter(Boolean)
                : [];
              const fileJob = job?.fileId === f.id ? job : null;
              const thumbs = contextImagePreviewsByFile[f.id]
                || (fileJob && !fileJob.processing ? imagePreviews : []);
              const pendingThumbs = thumbs.filter((img) => img.pending);
              const inventory = fileJob
                ? compactImageInventory(fileJob.included || [], fileJob.unsure || [], fileJob.skipped || [])
                : (Array.isArray(f.imageInventory) ? f.imageInventory.filter((row) => row.status !== 'pending') : []);
              const usedN = thumbs.length
                ? thumbs.filter((img) => img.included && !img.pending).length
                : inventory.filter((r) => r.status === 'included').length;
              const unusedN = thumbs.length
                ? thumbs.filter((img) => !img.included && !img.pending).length
                : inventory.filter((r) => r.status === 'skipped').length;
              const intakeThread = (f.intakeMessages || [])
                .filter((m) => !String(m.content || '').startsWith('⏳'))
                .map((m) => {
                  if (m.role === 'user' || !intakeChatLooksLikeJson(m.content)) return m;
                  return {
                    ...m,
                    content: captured
                      ? contextFileAddedConfirm(f.name, moduleLabelFor(moduleId))
                      : 'I have a few clarifying questions — please reply below.',
                  };
                });
              const fileIntakeText = contextIntakeByFile[f.id] ?? '';
              const needsAttention = !!(f.processing || !captured);
              return (
                <details
                  key={f.id}
                  className="bg-slate-900/40 border border-blue-400/20 rounded-xl overflow-hidden group"
                >
                  <summary className="cursor-pointer select-none list-none px-4 py-3 flex items-start gap-3 hover:bg-slate-800/40 [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="w-3.5 h-3.5 text-cyan-300 shrink-0 mt-1 transition-transform group-open:rotate-90" />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="text-sm font-semibold text-white truncate">{f.name}</div>
                      <div className="text-[11px] text-blue-300/55 mt-0.5">
                        {f.fileType}{f.sizeLabel ? ` · ${f.sizeLabel}` : ''}
                        {(usedN || unusedN) ? ` · ${usedN} used · ${unusedN} not used` : (f.imageCount ? ` · ${f.imageCount} image${f.imageCount === 1 ? '' : 's'}` : '')}
                        {factN ? ` · ${factN} fact${factN === 1 ? '' : 's'}` : ''}
                        {qaN && !factN ? ` · ${qaN} intake answer${qaN === 1 ? '' : 's'}` : ''}
                        {needsAttention
                          ? (f.processing ? ' · Expand to view progress' : ' · Expand to answer intake')
                          : ' · Expand to view or edit'}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0" onClick={(e) => e.preventDefault()}>
                      {f.processing ? (
                        job?.fileId === f.id && pendingImageCount > 0 ? (
                          <span className="px-2 py-0.5 bg-amber-500/15 text-amber-200 text-[10px] rounded border border-amber-400/25">Confirm images</span>
                        ) : (
                          <span className="px-2 py-0.5 bg-amber-500/15 text-amber-200 text-[10px] rounded border border-amber-400/25">Processing</span>
                        )
                      ) : captured ? (
                        <span className="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded border border-green-400/30">Context captured</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-yellow-500/15 text-yellow-200 text-[10px] rounded border border-yellow-400/25">Intake</span>
                      )}
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestRemoveModuleContextFile(moduleId, f); }} className="p-1 hover:bg-red-500/20 rounded text-red-400" title="Remove file"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </summary>
                  <div className="px-4 pb-4 space-y-3 border-t border-blue-400/10 pt-3">
                    {(thumbs.length > 0 || inventory.length > 0) && (
                      <details className={`rounded-xl overflow-hidden group/img ${pendingThumbs.length ? 'bg-slate-900/40 border border-amber-400/25' : 'bg-slate-950/40 border border-blue-400/10'}`}>
                        <summary className="cursor-pointer select-none list-none px-3 py-2 flex items-center gap-2 hover:bg-slate-800/40 [&::-webkit-details-marker]:hidden">
                          <ChevronRight className="w-3.5 h-3.5 text-cyan-300 shrink-0 transition-transform group-open/img:rotate-90" />
                          <span className="text-[11px] font-semibold text-blue-200/80">
                            Images · {usedN} used · {unusedN} not used
                            {pendingThumbs.length ? ` · ${pendingThumbs.length} need a yes/no` : ''}
                          </span>
                        </summary>
                        <div className="px-3 pb-3 space-y-2">
                          {thumbs.length > 0 ? (
                            <>
                              <div className="text-[11px] text-blue-300/60">
                                {pendingThumbs.length
                                  ? 'Include any that carry strategy or IC context, then they will be read. Click a thumbnail to enlarge.'
                                  : 'Click to enlarge. Switch an ignored image to used to read it.'}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {thumbs.map((img, i) => (
                                  <figure
                                    key={`${img.name}-${i}`}
                                    role={img.src ? 'button' : undefined}
                                    tabIndex={img.src ? 0 : undefined}
                                    onClick={() => openContextImageLightbox(img, f.id)}
                                    onKeyDown={(e) => {
                                      if (!img.src) return;
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        openContextImageLightbox(img, f.id);
                                      }
                                    }}
                                    className={`rounded-lg overflow-hidden border text-left ${img.src ? 'cursor-zoom-in hover:ring-2 hover:ring-cyan-400/50' : ''} ${
                                      img.pending
                                        ? 'border-amber-400/70 bg-amber-950/40'
                                        : img.included
                                        ? 'border-emerald-400/40 bg-slate-900/40'
                                        : 'border-slate-500/50 bg-slate-900/30'
                                    }`}
                                    title={img.src ? `Click to enlarge — ${img.pending ? (img.reason || 'Confirm') : img.included ? (img.reason || 'Included') : (img.reason || 'Skipped')}` : (img.reason || '')}
                                  >
                                    {img.src ? (
                                      <img
                                        src={img.src}
                                        alt={img.name}
                                        className={`block h-16 w-auto max-w-[110px] object-contain bg-slate-950/50 ${img.included || img.pending ? '' : 'opacity-60 grayscale-[35%]'}`}
                                      />
                                    ) : (
                                      <div className="h-16 w-[100px] flex items-center justify-center px-2 text-[10px] text-amber-200/90 text-center leading-snug">
                                        {img.reason || img.name}
                                      </div>
                                    )}
                                    <figcaption className="px-1 py-1 text-[10px] leading-tight text-slate-300 max-w-[110px]">
                                      <div className="truncate">{img.pending ? '? ' : img.included ? '✓ used ' : '✗ not used '}{img.name}</div>
                                      {img.pending ? (
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
                                      ) : !f.processing && (img.src || img.base64) ? (
                                        <button
                                          type="button"
                                          disabled={contextImageBusy?.fileId === f.id}
                                          className={`w-full mt-1 px-1 py-0.5 rounded text-[10px] font-semibold disabled:opacity-40 ${
                                            img.included
                                              ? 'bg-slate-600/60 hover:bg-slate-500/70 text-slate-100'
                                              : 'bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100'
                                          }`}
                                          onClick={(e) => { e.stopPropagation(); toggleContextImageUse(moduleId, f.id, img.name, !img.included); }}
                                        >
                                          {contextImageBusy?.fileId === f.id && contextImageBusy?.name === img.name
                                            ? 'Reading…'
                                            : img.included ? "Don't use" : 'Use'}
                                        </button>
                                      ) : null}
                                    </figcaption>
                                  </figure>
                                ))}
                              </div>
                              {pendingThumbs.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                  <button type="button" onClick={() => applyContextUnsureImageDecision('*', true)} className="px-3 py-1.5 bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400/40 rounded-lg text-xs text-emerald-100 font-semibold">Include all unsure</button>
                                  <button type="button" onClick={() => applyContextUnsureImageDecision('*', false)} className="px-3 py-1.5 bg-slate-600/50 hover:bg-slate-500/60 border border-slate-400/30 rounded-lg text-xs text-slate-100 font-semibold">Skip all unsure</button>
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              {inventory.map((row, i) => (
                                <div key={`${row.name}-${i}`} className="text-[11px] text-blue-200/80 flex gap-2 min-w-0">
                                  <span className={row.status === 'included' ? 'text-emerald-300 shrink-0' : 'text-slate-400 shrink-0'}>
                                    {row.status === 'included' ? '✓ used' : '✗ not used'}
                                  </span>
                                  <span className="truncate">{row.name}</span>
                                  <span className="text-blue-400/50 truncate">{row.purpose ? purposeLabel(row.purpose) : (row.reason || '')}</span>
                                </div>
                              ))}
                              {unusedN > 0 && (
                                <div className="text-[10px] text-blue-300/50 pt-1">To change an ignored image to used, do it in this session after upload (Use on the thumbnail), or re-upload the file.</div>
                              )}
                            </>
                          )}
                        </div>
                      </details>
                    )}
                    {f.processing && (f.intakeMessages || []).length > 0 && (
                      <div className="text-[11px] text-amber-200/90 bg-amber-500/10 border border-amber-400/20 rounded-lg px-3 py-2">
                        {stripJsonFromIntakeMessage((f.intakeMessages[f.intakeMessages.length - 1] || {}).content)
                          || 'Processing this file…'}
                      </div>
                    )}
                    {!f.processing && (
                      <div className="bg-slate-800/30 border border-blue-400/20 rounded-xl p-3 space-y-3">
                        <div>
                          <div className="text-xs font-bold text-white">Intake assistant</div>
                          <div className="text-[11px] text-blue-300/60 mt-0.5">
                            {captured
                              ? 'Context captured. Reply here to add or update notes for this file.'
                              : 'Confirm anything unclear in this file so its facts can be stored as context. Design happens later, using this capture.'}
                          </div>
                        </div>
                        <div className="bg-slate-900/40 border border-blue-400/15 rounded-xl p-3 max-h-[280px] overflow-y-auto overflow-x-hidden custom-scrollbar space-y-2">
                          {intakeThread.length === 0 ? (
                            <div className="text-[11px] text-blue-300/60">Waiting for questions…</div>
                          ) : intakeThread.map((m, i) => (
                            <div key={i} className={`flex min-w-0 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[95%] min-w-0 chat-fit px-3 py-2 rounded-xl text-xs ${m.role === 'user' ? 'inline-block bg-gradient-to-br from-cyan-500 to-blue-500 text-white' : m.role === 'system' ? 'bg-yellow-500/15 border border-yellow-400/25 text-yellow-200' : 'block w-full bg-slate-800/60 border border-blue-400/20 text-blue-100'}`}>
                                {m.role === 'user'
                                  ? <span className="whitespace-pre-wrap break-words">{m.content}</span>
                                  : <MessageErrorBoundary>{formatMarkdown(m.content)}</MessageErrorBoundary>}
                              </div>
                            </div>
                          ))}
                          {contextIntakeBusy && activeContextFileId === f.id ? (
                            <div className="flex justify-start">
                              <div className="bg-slate-800/60 border border-blue-400/20 text-blue-100 rounded-xl px-3 py-2 text-xs">
                                ⏳ Saving your answers as separate facts…
                              </div>
                            </div>
                          ) : null}
                          {contextIntakeBusy && activeContextFileId === f.id ? (
                            <div className="flex justify-start">
                              <div className="bg-slate-800/60 border border-blue-400/20 text-blue-100 rounded-xl px-3 py-2 text-xs">
                                ⏳ Saving your answers as separate facts…
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex gap-2">
                          <textarea
                            value={fileIntakeText}
                            onChange={(e) => { setActiveContextFileId(f.id); setContextIntakeByFile((prev) => ({ ...prev, [f.id]: e.target.value })); }}
                            onFocus={() => setActiveContextFileId(f.id)}
                            placeholder={captured ? 'Add a comment or update for this file…' : 'Answer the intake questions… (1= … 2= … if several are listed)'}
                            rows={2}
                            className="flex-1 bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-400 resize-none"
                          />
                          <button
                            type="button"
                            disabled={!fileIntakeText.trim() || contextIntakeBusy}
                            onClick={() => continueModuleContextIntake(moduleId, f.id, fileIntakeText.trim())}
                            className="px-3 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 disabled:opacity-40 text-white font-semibold rounded-lg text-xs flex items-center gap-1"
                          >
                            <Send className="w-3.5 h-3.5" /> Send
                          </button>
                        </div>
                      </div>
                    )}
                    {!f.processing && (
                      <details className="bg-emerald-500/10 border border-emerald-400/20 rounded-xl overflow-hidden" open>
                        <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold text-emerald-300 hover:bg-emerald-500/10 flex items-center gap-2">
                          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" /> Captured context
                        </summary>
                        <StellaCapturedContextView
                          ctx={capturedView}
                          onPatch={async (next) => {
                            setContextEditSaveStatus('saving');
                            try {
                              await persistContextFiles(patchModuleContextFile(
                                userSettingsRef.current.moduleContext,
                                moduleId,
                                f.id,
                                { capturedContext: next || undefined },
                              ));
                              setContextEditSaveStatus('saved');
                              setTimeout(() => setContextEditSaveStatus('idle'), 2500);
                            } catch {
                              setContextEditSaveStatus('error');
                            }
                          }}
                        />
                      </details>
                    )}
                    {Array.isArray(f.columns) && f.columns.length > 0 && (
                      <details className="bg-slate-900/40 border border-blue-400/15 rounded-xl overflow-hidden">
                        <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold text-blue-300 hover:bg-slate-800/40 flex items-center gap-2">
                          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" /> Detected fields ({f.columns.length})
                        </summary>
                        <div className="px-4 pb-4 space-y-1">
                          {f.columns.map((c, i) => (
                            <div key={i} className="text-[11px] text-blue-200/80">
                              <span className="text-cyan-300 font-semibold">{c.name}</span>
                              {c.type ? <span className="text-blue-400/50"> [{c.type}]</span> : null}
                              {c.description ? ` — ${c.description}` : ''}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {(f.notes || []).length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-cyan-400/80">Comments</div>
                        {(f.notes || []).map((n) => (
                          <EditableContextBlock
                            key={n.id}
                            label="Comment"
                            value={n.text}
                            onSave={(val) => persistContextBlock(moduleId, f.id, `note:${n.id}`, val)}
                            onDelete={() => persistContextBlock(moduleId, f.id, `note:${n.id}`, '', true)}
                          />
                        ))}
                      </div>
                    )}
                    {sourceBlocks.length > 0 && (
                      <details className="bg-slate-950/40 border border-blue-400/10 rounded-xl overflow-hidden">
                        <summary className="cursor-pointer select-none px-4 py-2 text-[11px] font-semibold text-blue-300/70 hover:bg-slate-800/40">
                          Source extract (raw)
                        </summary>
                        <div className="px-4 pb-3 space-y-2">
                          {sourceBlocks.map((b) => (
                            <EditableContextBlock
                              key={b.id}
                              label={b.label}
                              value={b.value}
                              onSave={(val) => persistContextBlock(moduleId, f.id, b.id, val)}
                              onDelete={() => persistContextBlock(moduleId, f.id, b.id, '', true)}
                            />
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </details>
              );
            })}
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
    if (prev.ingestKind === 'moduleContext') {
      rememberContextImages(prev.fileId, { included, unsure, skipped });
    }
    if (unsure.length) {
      pendingImageReviewRef.current = next;
      setPendingImageReview(next);
      if (prev.ingestKind === 'moduleContext') {
        contextIngestJobRef.current = next;
        setContextIngestJob(next);
      }
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
    if (prev.ingestKind === 'moduleContext') {
      pendingImageReviewRef.current = null;
      setPendingImageReview(null);
      contextIngestJobRef.current = { ...next, processing: true };
      setContextIngestJob({ ...next, processing: true });
      setIsLoading(true);
      setMessages((msgs) => {
        const copy = [...msgs];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].imageReviewPending) {
            copy[i] = {
              ...copy[i],
              content: `🖼️ **${included.length}** image(s) selected for extract.`,
              imageReviewPending: false,
            };
            break;
          }
        }
        return [...copy, {
          role: 'system',
          content: `▶️ Confirmed **${included.length}** image(s). Capturing context facts…`,
        }];
      });
      try {
        await completeModuleContextIngest({ ...next, images: included, fromChat: true });
      } catch (err) {
        setIsLoading(false);
        setMessages((prevMsgs) => [...prevMsgs, {
          role: 'system',
          content: `❌ Could not continue after image review: ${err.message || 'Unknown error'}`,
        }]);
      }
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
          withUserSettings(getWorkflowRuntime().proposalImageClassifyPrompt, { moduleContext: false, applyResponseLength: false }),
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

    void persistIntelligenceSettings({
      knowledgeAccess: syncKnowledgeAccessMap({
        [file.name]: { generalContext: true, agents: true },
      }),
    });

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
    const nextAccess = { ...syncKnowledgeAccessMap() };
    delete nextAccess[doc.name];
    void persistIntelligenceSettings({ knowledgeAccess: nextAccess });
    setDocuments((prev) => {
      const next = prev.filter((d) => d.id !== doc.id && d.name !== doc.name);
      setKnowledgeBase(buildKnowledgeBaseFromDocuments(next));
      return next;
    });
  };

  // ── STELLA: Supabase storage helpers ──
  const stellaUserPrefix = () => userStellaStoragePrefix(currentUser);
  const stellaUploadCandidates = () => ([
    { bucket: 'intelligence', prefix: stellaUserPrefix() },
    { bucket: 'stella-data', prefix: stellaUserPrefix() },
  ]);

  const stellaResolveStoragePath = (candidate, path) => `${candidate.prefix}${path}`;

  const stellaUploadToStorage = async (path, blobOrFile, contentType) => {
    let lastErr = null;
    for (const candidate of stellaUploadCandidates()) {
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

  // ── STELLA: DB registry (stella_files) + local state helpers ──
  const stellaPatchLocal = (fileId, patch) =>
    setStellaDataFiles((prev) => {
      const next = prev.map((f) => (f.id === fileId ? { ...f, ...patch } : f));
      stellaDataFilesRef.current = next;
      return next;
    });

  const stellaReloadRegistry = async () => {
    try {
      let data = null;
      try {
        const res = await fetch(STELLA_FILES_API_PATH, {
          headers: authHeaders({ 'Content-Type': 'application/json' }),
        });
        if (res.ok) {
          const payload = await res.json().catch(() => ({}));
          const schemaStatus = stellaSchemaStatusFromPayload(payload);
          if (schemaStatus) setStellaTenantSchema(schemaStatus);
          if (Array.isArray(payload.files)) data = payload.files;
        }
      } catch {
        /* company-schema API is required — do not read public.stella_files */
      }
      if (!Array.isArray(data)) return null;
      const mapped = data.map(stellaMapRegistryRow);
      const prev = stellaDataFilesRef.current || [];
      const next = stellaMergeRegistryFiles(prev, mapped);
      stellaDataFilesRef.current = next;
      setStellaDataFiles(next);
      void sweepChatMemoryOfFileContext(factsFromStellaFiles(next));
      return next;
    } catch {
      return null;
    }
  };

  const stellaInsertRegistry = async (record) => {
    const res = await fetch(STELLA_FILES_API_PATH, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'insert', record }),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok && payload.file) {
      const schemaStatus = stellaSchemaStatusFromPayload(payload);
      if (schemaStatus) setStellaTenantSchema(schemaStatus);
      return payload.file;
    }
    throw new Error(payload?.error?.message || 'Registry insert failed');
  };

  const stellaUpdateRegistry = async (dbId, patch) => {
    if (!dbId) return;
    const res = await fetch(STELLA_FILES_API_PATH, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'update', id: dbId, patch }),
    });
    if (res.ok) return;
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload?.error?.message || 'Registry update failed');
  };

  const stellaOtherTabularFiles = (exceptId) => {
    const except = new Set([exceptId, String(exceptId || '')].filter(Boolean));
    return (stellaDataFilesRef.current || []).filter((x) => (
      x && x.tableName
      && !except.has(x.id)
      && !except.has(x.dbId)
      && !x.processing
    ));
  };

  const stellaRelationshipIntakeHint = (thisFile, otherTabular) => {
    if (!otherTabular.length) return '';
    const candidates = stellaGuessJoinCandidates(thisFile, otherTabular);
    const otherFilesBlob = otherTabular.map((x) => {
      const cols = (x.columns || []).map((c) => {
        const label = c.original && c.original !== c.name ? `${c.name} (header "${c.original}")` : (c.name || '');
        const samples = Array.isArray(c.samples) && c.samples.length ? ` e.g. ${c.samples.slice(0, 3).join(', ')}` : '';
        return `${label}${samples}`;
      }).filter(Boolean).join('; ');
      return `- "${x.name}" (table ${x.tableName}) columns: ${cols || '(unknown)'}`;
    }).join('\n');
    const candidateBlob = candidates.length
      ? `\n\nMATCHING JOIN KEYS (entity keys only — not sales/transaction/row IDs):\n${candidates.map((c) => `- this.${c.this_field} = ${c.related_table}.${c.related_field}  (${c.related_file}, ${c.reason})`).join('\n')}`
      : '\n\nMATCHING JOIN KEYS: none. Do not invent joins on id, sales_id, record_id, or transaction_id.';
    const grainCols = [thisFile, ...otherTabular].flatMap((f) => (
      (f?.columns || []).filter((c) => stellaLooksLikeFactGrainId(c, f)).map((c) => `${f.name}.${c.name || c.original}`)
    )).filter(Boolean);
    const grainBlob = grainCols.length
      ? `\n\nNOT JOIN KEYS (independent per file/year — never propose these): ${grainCols.join(', ')}`
      : '';
    const knownJoins = stellaFormatConfirmedJoins(otherTabular);
    const knownBlob = knownJoins
      ? `\n\nALREADY STORED JOINS among previously loaded files:\n${knownJoins}`
      : '';
    return `\n\nRELATIONSHIPS: Other datasets already exist (listed below). You MUST ask whether this file joins to them before complete=true.\n\nLINK HIERARCHY (most to least preferred):\n1. STRUCTURAL (preferred) — one file is a master/reference list and the other is a fact/transaction file that references those IDs. Propose when a dimension PK matches a fact FK. The master list defines what the ID means.\n2. COMPARISON (fallback only) — both files are fact/transaction datasets with no master list to join through. Do NOT propose comparison links on an entity when a master/reference list for that entity is already uploaded — propose structural links to the master instead. Only propose comparison links when no master exists. They are NOT row-to-row joins; they only capture shared entity IDs so Stella can group or compare across files.\n\nONE PAIR PER ENTITY: Between two files, propose at most one column pair for each shared entity. A master file's other attributes (names, owners, labels) are not extra join keys for the same entity. If MATCHING JOIN KEYS lists more than one pair for the same entity, keep only the best name-aligned pair.\n\nNEVER propose: row/transaction/record IDs (id, record_id, sales_id, sale_id, transaction_id, invoice_id, engagement_id, order_id) — each file's own row IDs are independent and meaningless across files. Never join measures (revenue, qty, units). Never join from name or data type alone.\n\nStore confirmed links in context_qa.relationships. Use empty array if the user says unrelated or rejects all links.\n\nOTHER DATASETS:\n${otherFilesBlob}${candidateBlob}${grainBlob}${knownBlob}`;
  };

  const stellaTableApi = async (payload) => {
    const res = await fetch(STELLA_QUERY_API_PATH, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Stella request failed (${res.status})`);
    return data;
  };

  const stellaHydrateColumnValueProfiles = async (files, { persist = false } = {}) => {
    const list = (files || []).filter((f) => f && stellaFileNeedsValueProfile(f));
    if (!list.length) return (stellaDataFilesRef.current || []);
    const patched = new Map();
    await Promise.all(list.map(async (f) => {
      try {
        const data = await stellaTableApi({ sql: `SELECT * FROM ${f.tableName} LIMIT ${STELLA_SQL_SAMPLE_ROWS}` });
        const rows = Array.isArray(data.rows) ? data.rows : [];
        if (!rows.length) return;
        const columns = stellaApplyRowSampleToColumns(f.columns, rows);
        patched.set(f.id, { columns, previewRows: stellaPreviewRowsFromData(rows, 3) });
        if (persist && f.dbId) {
          try { await stellaUpdateRegistry(f.dbId, { columns: stellaColumnsForRegistry(columns) }); } catch { /* ignore */ }
        }
      } catch { /* table may not be ready */ }
    }));
    if (!patched.size) return (stellaDataFilesRef.current || []);
    let result = stellaDataFilesRef.current || [];
    setStellaDataFiles((prev) => {
      const next = (prev || []).map((f) => (patched.has(f.id) ? { ...f, ...patched.get(f.id) } : f));
      stellaDataFilesRef.current = next;
      result = next;
      return next;
    });
    return result;
  };
  stellaHydrateColumnProfilesRef.current = stellaHydrateColumnValueProfiles;

  // Create a dynamic stella_data_* table in this company's schema and load rows in batches.
  const stellaCreateAndLoadTable = async (tableName, columns, rows) => {
    const cols = columns.map(c => ({ name: c.name, type: c.type }));
    await stellaTableApi({ action: 'create', tableName, columns: cols });
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      await stellaTableApi({ action: 'insert', tableName, rows: rows.slice(i, i + BATCH) });
    }
  };

  const territoryApi = async (payload) => {
    const res = await fetch(TERRITORY_API_PATH, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Territory request failed (${res.status})`);
    return data;
  };

  const persistTerritoryFile = async (rec) => {
    const next = upsertModuleContextFile(userSettingsRef.current.moduleContext, 'territory', rec);
    userSettingsRef.current = { ...userSettingsRef.current, moduleContext: next };
    setUserSettings((prev) => ({ ...prev, moduleContext: next }));
    try {
      await persistContextFiles(next);
    } catch (err) {
      console.warn('Territory file save lagged:', err?.message || err);
    }
    return next;
  };

  const patchTerritoryFile = async (fileId, patch) => {
    const rec = (userSettingsRef.current.moduleContext?.territory?.files || []).find((f) => f.id === fileId);
    if (!rec) return;
    await persistTerritoryFile({ ...rec, ...patch, id: fileId });
  };

  const runTerritoryIntakeTurn = async (fileRec) => {
    if (!fileRec) return fileRec;
    const layout = normalizeMapLayout(fileRec.mapLayout) || inferTerritoryLayout(fileRec.columns || [], fileRec.previewRows || []);
    const colsBlob = (fileRec.columns || []).map((c) => (
      `- ${c.name}${c.original && c.original !== c.name ? ` (header "${c.original}")` : ''}${c.type ? ` [${c.type}]` : ''}`
    )).join('\n') || '(no columns)';
    const guessed = [
      layout.teamColumn ? `team = ${layout.teamColumn}` : 'team = (none found)',
      layout.territoryColumn ? `territory = ${layout.territoryColumn}` : 'territory = (none found)',
      layout.geoColumn ? `geo = ${layout.geoColumn} (${layout.geoKind || 'unknown'})` : 'geo = (none found)',
      layout.country ? `country = ${layout.country}` : '',
    ].filter(Boolean).join('\n');
    const rt = getWorkflowRuntime();
    const system = fillTemplate(rt.territoryIntakePrompt || '', {
      dataProfile: fileRec.dataProfile ? `\n\nDATA PROFILE:\n${fileRec.dataProfile}` : '',
    });
    const convo = [
      {
        role: 'user',
        content: `You are onboarding: "${fileRec.name}".\nSQL TABLE: ${fileRec.tableName || ''}\nROWS: ${fileRec.rowCount ?? ''}\nCOLUMNS (use these exact SQL names):\n${colsBlob}\n\nCOLUMN GUESSES:\n${guessed}\n\nSAMPLE ROWS:\n${JSON.stringify((fileRec.previewRows || []).slice(0, 8), null, 2).slice(0, 6000)}`,
      },
      ...((fileRec.intakeMessages || [])
        .filter((m) => !String(m.content || '').startsWith('⏳'))
        .map((m) => ({
        role: toAnthropicRole(m.role),
        content: m.role === 'assistant'
          ? (stripJsonFromIntakeMessage(m.content) || 'Thanks — noted.')
          : String(m.content || ''),
      }))),
    ];
    let parsed = {};
    try {
      const raw = await callAnthropic(system, convo, 1200);
      parsed = extractJsonObject(raw) || {};
    } catch { /* fall through */ }
    const hasUserReply = (fileRec.intakeMessages || []).some((m) => m.role === 'user');
    const nextLayout = mergeTerritoryLayout(layout, parsed.layout);
    let complete = !!parsed.complete;
    let message = stripJsonFromIntakeMessage(parsed.message);
    if (!hasUserReply) {
      complete = false;
      if (!intakeMessageLooksLikeAsk(message)) {
        message = nextLayout.geoColumn
          ? `I mapped this file as team **${nextLayout.teamColumn || '(none)'}**, territory **${nextLayout.territoryColumn || '(none)'}**, geo **${nextLayout.geoColumn}** (${nextLayout.geoKind || 'region'}). Is that correct?`
          : 'Which column holds the geography to plot (postcode/zip, city, county, or region)?';
      }
    } else if (!intakeMessageLooksLikeAsk(message) || complete) {
      complete = true;
      message = stripJsonFromIntakeMessage(message) || contextFileAddedConfirm(fileRec.name, 'Territory Design');
    }
    const context_qa = complete ? harvestModuleCapturedContext(
      fileRec.capturedContext,
      pickIntakeContextQa(parsed),
      [...(fileRec.intakeMessages || []), { role: 'assistant', content: message }],
      { extract: fileRec.dataProfile || '' },
    ) : fileRec.capturedContext;
    const next = {
      ...fileRec,
      mapLayout: nextLayout,
      capturedContext: context_qa || fileRec.capturedContext,
      intakeMessages: [...(fileRec.intakeMessages || []).filter((m) => !String(m.content || '').startsWith('⏳')), { role: 'assistant', content: message }],
      intakeComplete: complete,
      processing: false,
    };
    await patchTerritoryFile(fileRec.id, {
      mapLayout: next.mapLayout,
      capturedContext: next.capturedContext,
      intakeMessages: next.intakeMessages,
      intakeComplete: next.intakeComplete,
      processing: false,
    });
    return next;
  };

  const ingestTerritoryTabularFile = async (file, { fileId: existingId } = {}) => {
    const fileId = existingId || `ctx_${Date.now()}_${stellaNanoId()}`;
    const lower = file.name.toLowerCase();
    const kind =
      lower.endsWith('.csv') ? 'csv'
      : (lower.endsWith('.xlsx') || lower.endsWith('.xls')) ? 'excel'
      : lower.endsWith('.json') ? 'json'
      : '';
    if (!kind) throw new Error('Please upload Excel, CSV, or a JSON table of rows.');

    const placeholder = {
      id: fileId,
      name: file.name,
      fileType: kind,
      sizeLabel: `${(file.size / 1024).toFixed(1)} KB`,
      processing: true,
      intakeComplete: false,
      intakeMessages: [{ role: 'assistant', content: `⏳ Loading **${file.name}** into Territory…` }],
    };
    await persistTerritoryFile(placeholder);
    setSelectedTerritoryFileId(fileId);
    setSelectedTerritory(null);
    setSelectedTerritoryTeam('');
    setTerritoryMapPayload(null);
    setTerritoryMapError('');
    setActiveTab('territory');

    try {
      const { records, sheetName } = await parseTerritoryTabular(file, kind);
      if (!Array.isArray(records) || !records.length) {
        throw new Error('No data rows found. Upload an Excel/CSV with a header row and territory records.');
      }
      const payload = stellaBuildTabularPayload(records);
      const tableName = `territory_data_${stellaNanoId()}`;
      await stellaCreateAndLoadTable(tableName, payload.columns, payload.rows);
      const mapLayout = inferTerritoryLayout(payload.columns, records.slice(0, 40));
      const dataProfile = [
        sheetName ? `Excel sheet used: ${sheetName}` : '',
        stellaProfileRecords(records),
      ].filter(Boolean).join('\n');
      let storagePath = null;
      let storageBucket = null;
      try {
        const cleanName = sanitizeStorageName(file.name);
        const up = await stellaUploadToStorage(`territory_${Date.now()}_${cleanName}`, file, file.type || undefined);
        storagePath = up.objectPath;
        storageBucket = up.bucket;
      } catch { /* table is the source of truth */ }
      const rec = {
        id: fileId,
        name: file.name,
        fileType: kind,
        sizeLabel: `${payload.rowCount} rows`,
        tableName,
        rowCount: payload.rowCount,
        columns: payload.columns,
        previewRows: records.slice(0, 8),
        dataProfile,
        mapLayout,
        storagePath,
        storageBucket,
        uploadedAt: new Date().toISOString(),
        processing: false,
        intakeComplete: false,
        intakeMessages: [{ role: 'assistant', content: `⏳ Loaded **${payload.rowCount}** rows. Checking the territory columns…` }],
        summary: `Territory file with ${payload.rowCount} rows${sheetName ? ` from sheet "${sheetName}"` : ''}.`,
      };
      await persistTerritoryFile(rec);
      setSelectedTerritoryFileId(fileId);
      try {
        await runTerritoryIntakeTurn(rec);
      } catch (err) {
        await patchTerritoryFile(fileId, {
          intakeMessages: [{
            role: 'assistant',
            content: `Loaded **${payload.rowCount}** rows. I could not finish intake (${err.message || 'error'}). Confirm the team, territory, and geography columns if the map looks wrong.`,
          }],
        });
      }
    } catch (err) {
      const message = err?.message || 'Upload failed';
      setTerritoryMapError(message);
      await patchTerritoryFile(fileId, {
        processing: false,
        intakeMessages: [{ role: 'system', content: `❌ Upload failed: ${message}` }],
      });
      throw err;
    }
  };

  const loadTerritoryMapForFile = async (file, team) => {
    if (!file?.tableName || !file?.mapLayout?.geoColumn) {
      setTerritoryMapPayload(null);
      return;
    }
    const gen = ++territoryMapAbortRef.current;
    setTerritoryMapBusy(true);
    setTerritoryMapError('');
    try {
      let nextTeam = team;
      for (let i = 0; i < 40; i += 1) {
        const data = await territoryApi({
          action: 'map',
          tableName: file.tableName,
          layout: file.mapLayout,
          team: nextTeam || undefined,
          geocode: true,
        });
        if (gen !== territoryMapAbortRef.current) return;
        if (!nextTeam && Array.isArray(data.teams) && data.teams.length) {
          nextTeam = data.teams[0];
          setSelectedTerritoryTeam(nextTeam);
          continue;
        }
        setTerritoryMapPayload(data);
        if (!data.pending) break;
        await new Promise((r) => setTimeout(r, 1200));
        if (gen !== territoryMapAbortRef.current) return;
      }
    } catch (err) {
      if (gen !== territoryMapAbortRef.current) return;
      setTerritoryMapError(err.message || 'Could not load the territory map');
    } finally {
      if (gen === territoryMapAbortRef.current) setTerritoryMapBusy(false);
    }
  };

  const stellaRemoveStorage = async (objectPath, { bucket } = {}) => {
    if (!objectPath) return;
    const buckets = [...new Set([bucket, 'intelligence', 'stella-data'].filter(Boolean))];
    const paths = [...new Set([objectPath, objectPath.replace(/^stella\//, '')].filter(Boolean))];
    await Promise.all(buckets.flatMap((b) => paths.map((p) => (
      supabase.storage.from(b).remove([p]).catch(() => null)
    ))));
  };

  // Download a blob from Stella storage (tries path variants across candidate buckets).
  const stellaDownloadStorageBlob = async (objectPath) => {
    if (!objectPath) return null;
    const rel = objectPath.replace(/^stella\//, '');
    const paths = [...new Set([objectPath, rel, `stella/${rel}`, `${stellaUserPrefix()}${rel}`])];
    const buckets = ['intelligence', 'stella-data'];
    for (const bucket of buckets) {
      for (const p of paths) {
        try {
          const { data, error } = await supabase.storage.from(bucket).download(p);
          if (!error && data) return data;
        } catch { /* try next */ }
      }
    }
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
    let qa = Array.isArray(base.qa_pairs) ? base.qa_pairs.filter(p => p && (p.question || p.answer || p.fact)) : [];
    const seen = new Set(qa.map((p) => `${String(p.question || '').trim()}|${String(p.answer || p.fact || '').trim()}`.toLowerCase()));
    const msgs = intakeMessages || [];
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role !== 'assistant') continue;
      const ans = msgs.slice(i + 1).find(m => m.role === 'user');
      if (!ans) continue;
      const pair = { question: msgs[i].content, answer: ans.content };
      const key = `${String(pair.question || '').trim()}|${String(pair.answer || '').trim()}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      qa.push(pair);
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
    const withQa = { ...base, qa_pairs: qa };
    const name_maps = stellaCollectNameMaps(withQa, msgs);
    const qaWithFacts = qa.map((p) => {
      const fact = intakePairFact(p);
      return fact ? { ...p, fact } : p;
    });
    return {
      what_it_represents: base.what_it_represents || '',
      time_period: base.time_period || '',
      key_metrics: Array.isArray(base.key_metrics) ? base.key_metrics : (base.key_metrics ? [String(base.key_metrics)] : []),
      interpretation_notes: base.interpretation_notes || '',
      qa_pairs: qaWithFacts,
      relationships,
      ...(name_maps.length ? { name_maps } : {}),
    };
  };

  const persistStellaIntakeContext = async (fileRec, ctx, intakeMessages) => {
    const maps = stellaCollectNameMaps(ctx, intakeMessages);
    const nextCtx = ctx && typeof ctx === 'object'
      ? (maps.length ? { ...ctx, name_maps: maps } : { ...ctx })
      : ctx;
    if (nextCtx && typeof nextCtx === 'object') {
      delete nextCtx.schema_changed;
      if (Array.isArray(nextCtx.qa_pairs)) {
        const extract = [fileRec.extractedText, fileRec.structuredExtract, fileRec.summary].filter(Boolean).join('\n\n');
        const keyFacts = Array.isArray(nextCtx.key_metrics) ? nextCtx.key_metrics : [];
        nextCtx.qa_pairs = nextCtx.qa_pairs.map((p) => {
          const fact = intakePairFact(p, { extract, keyFacts });
          return fact ? { ...p, fact } : p;
        });
      }
    }
    stellaPatchLocal(fileRec.id, { intakeMessages, capturedContext: nextCtx, intakeComplete: true });
    setStellaIntakeMinimized(true);
    try {
      if (fileRec.dbId) await stellaUpdateRegistry(fileRec.dbId, { context_qa: nextCtx });
    } catch (e) {
      setStellaMessages(prev => [...prev, { role: 'system', content: `⚠️ Could not save captured context: ${e.message}` }]);
    }
    return nextCtx;
  };

  const persistStellaFileContext = async (fileRec, nextCtx) => {
    const ctx = stellaCapturedContextIsEmpty(nextCtx) ? null : { ...nextCtx };
    if (ctx) {
      delete ctx.schema_changed;
      if (Array.isArray(ctx.qa_pairs)) {
        const extract = [fileRec.extractedText, fileRec.structuredExtract, fileRec.summary].filter(Boolean).join('\n\n');
        const keyFacts = Array.isArray(ctx.key_metrics) ? ctx.key_metrics : [];
        ctx.qa_pairs = ctx.qa_pairs.map((p) => {
          const fact = intakePairFact(p, { extract, keyFacts });
          return fact ? { ...p, fact } : p;
        });
      }
    }
    stellaPatchLocal(fileRec.id, { capturedContext: ctx, intakeComplete: !!ctx });
    try {
      if (fileRec.dbId) await stellaUpdateRegistry(fileRec.dbId, { context_qa: ctx });
    } catch (e) {
      setStellaMessages((prev) => [...prev, { role: 'system', content: `⚠️ Could not save context: ${e.message}` }]);
    }
  };

  const handleStellaJoinChange = async ({ type, fromId, toId, thisField, relatedField }, opts = {}) => {
    const files = stellaDataFilesRef.current || [];
    const from = files.find((f) => f.id === fromId);
    const to = files.find((f) => f.id === toId);
    if (!from || !to || from.id === to.id) return;
    const tf = String(thisField || '').trim();
    const rf = String(relatedField || '').trim();
    if (!tf || !rf) return;
    if (type === 'add' && !opts.force) {
      await stellaHydrateColumnValueProfiles([from, to]);
      const latest = stellaDataFilesRef.current || [];
      const fromNow = latest.find((f) => f.id === from.id) || from;
      const toNow = latest.find((f) => f.id === to.id) || to;
      const assess = stellaAssessJoin(fromNow, toNow, tf, rf);
      if (assess.verdict !== 'ok') {
        setStellaJoinPending({
          action: 'add',
          fromId: from.id,
          toId: to.id,
          thisField: tf,
          relatedField: rf,
          fromName: from.name,
          toName: to.name,
          assess,
        });
        return;
      }
    }
    const fromCtx = stellaMutateRelationships(from.capturedContext, to, tf, rf, type, from);
    const toCtx = stellaMutateRelationships(to.capturedContext, from, rf, tf, type, to);
    stellaPatchLocal(from.id, { capturedContext: fromCtx, intakeComplete: true });
    stellaPatchLocal(to.id, { capturedContext: toCtx, intakeComplete: true });
    setStellaJoinUndo({
      type: type === 'add' ? 'remove' : 'add',
      fromId: from.id,
      toId: to.id,
      thisField: tf,
      relatedField: rf,
      fromName: from.name,
      toName: to.name,
    });
    try {
      if (from.dbId) await stellaUpdateRegistry(from.dbId, { context_qa: fromCtx });
      if (to.dbId) await stellaUpdateRegistry(to.dbId, { context_qa: toCtx });
    } catch (e) {
      setStellaMessages((prev) => [...prev, { role: 'system', content: `⚠️ Could not save join: ${e.message}` }]);
    }
  };

  const requestStellaJoinRemove = ({ fromId, toId, thisField, relatedField }) => {
    const files = stellaDataFilesRef.current || [];
    const from = files.find((f) => f.id === fromId);
    const to = files.find((f) => f.id === toId);
    const tf = String(thisField || '').trim();
    const rf = String(relatedField || '').trim();
    if (!from || !to || !tf || !rf) return;
    setStellaJoinPending({
      action: 'remove',
      fromId: from.id,
      toId: to.id,
      thisField: tf,
      relatedField: rf,
      fromName: from.name,
      toName: to.name,
    });
  };

  const confirmStellaJoinPending = async () => {
    const pending = stellaJoinPending;
    if (!pending) return;
    setStellaJoinPending(null);
    await handleStellaJoinChange({
      type: pending.action === 'add' ? 'add' : 'remove',
      fromId: pending.fromId,
      toId: pending.toId,
      thisField: pending.thisField,
      relatedField: pending.relatedField,
    }, { force: true });
  };

  const undoStellaJoin = async () => {
    const undo = stellaJoinUndo;
    if (!undo) return;
    setStellaJoinUndo(null);
    await handleStellaJoinChange({
      type: undo.type,
      fromId: undo.fromId,
      toId: undo.toId,
      thisField: undo.thisField,
      relatedField: undo.relatedField,
    }, { force: true });
  };

  const stellaSaveBusinessContext = async (next) => {
    const ctx = mergeStellaBusinessContext({ keyGoals: mergeStellaBusinessContext(next).keyGoals });
    setStellaBusinessContext(ctx);
    setStellaBizSaveStatus('saving');
    try {
      const ok = await saveUserSettings({ stellaBusinessContext: ctx });
      if (!ok) {
        setStellaBizSaveStatus('error');
        return;
      }
      setStellaBizSaveStatus('saved');
      setTimeout(() => setStellaBizSaveStatus('idle'), 3000);
    } catch (e) {
      setStellaBizSaveStatus('error');
      setStellaMessages(prev => [...prev, { role: 'system', content: `⚠️ Could not save business context: ${e.message}` }]);
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
    const system = withUserSettings(getStellaPrompts().contentSummary, { moduleContext: false, applyResponseLength: false });
    const colText = columns.length ? `\n\nDETECTED COLUMNS:\n${columns.map(c => `- ${c.name}`).join('\n')}` : '';
    const profileText = profile ? `\n\nDATA PROFILE (observable facts — DO NOT ask about these):\n${profile}` : '';
    const others = (stellaDataFilesRef.current || []).filter((f) => f && f.tableName && !f.processing);
    const otherHint = others.length
      ? `\n\nOTHER STELLA DATASETS already loaded:\n${others.map((f) => `- ${f.name}${f.tableName ? ` (table ${f.tableName})` : ''}: ${(f.columns || []).slice(0, 10).map((c) => c.name || c).filter(Boolean).join(', ')}`).join('\n')}`
      : '';
    const user = `FILE:\n- name: ${name}\n- type: ${type}${colText}${profileText}${otherHint}\n\nCONTENT SAMPLE (may be truncated):\n${textSample}\n\nINTAKE: suggestedQuestions only if something in THIS file is still unclear (ambiguous fields, codes, grain, or a possible join). If the extract already makes the file understandable, return []. Never use a fixed checklist. Do not ask about schemes, other hub modules, or how to analyse the numbers.`;
    const raw = await callAnthropic(system, [{ role: 'user', content: user }], 1400);
    const parsed = extractJsonObject(raw);
    if (!(parsed && typeof parsed === 'object')) {
      return { summary: 'Uploaded dataset.', columns: [], suggestedQuestions: [] };
    }
    return {
      ...parsed,
      suggestedQuestions: stellaNormalizeIntakeQuestions(
        parsed.suggestedQuestions != null ? parsed.suggestedQuestions : parsed.questions
      ),
    };
  };

  // Runs one intake turn for the given (up-to-date) file object.
  const stellaIntakeNextTurn = async (f) => {
    if (!f) return;
    const isDoc = !f.tableName;

    if (!isDoc) {
      await stellaHydrateColumnValueProfiles([f, ...stellaOtherTabularFiles(f.id)]);
    }
    const live = (stellaDataFilesRef.current || []).find((x) => x.id === f.id) || f;
    const otherTabular = stellaOtherTabularFiles(live.id);
    const candidates = !isDoc ? stellaGuessJoinCandidates(live, otherTabular) : [];
    const relationshipGuidance = (!isDoc && otherTabular.length)
      ? stellaRelationshipIntakeHint(live, otherTabular)
      : '';

    const colsBlob = Array.isArray(live.columns) && live.columns.length
      ? live.columns.map((c) => {
        const samples = Array.isArray(c.samples) && c.samples.length ? ` e.g. ${c.samples.slice(0, 4).join(', ')}` : '';
        return `- ${c.name}${c.original && c.original !== c.name ? ` (header "${c.original}")` : ''}${c.type ? ` [${c.type}]` : ''}${c.kind ? ` {${c.kind}}` : ''}${c.description ? `: ${c.description}` : ''}${samples}`;
      }).join('\n')
      : '(no columns — this is a document)';
    const system = withUserSettings(fillTemplate(getStellaPrompts().intake, {
      kind: isDoc ? 'document' : 'dataset',
      kindSubject: isDoc ? 'document contains / represents' : 'data represents',
      relationshipBullet: (!isDoc && otherTabular.length) ? '\n- joins: whether/how it shares keys with other uploaded datasets (matching values, not just similar names)' : '',
      dataProfile: (!isDoc && (live.dataProfile || f.dataProfile)) ? `\n\nDATA PROFILE (observable facts — DO NOT ask about these):\n${live.dataProfile || f.dataProfile}` : '',
      relationshipGuidance: relationshipGuidance || '',
    }), { moduleContext: false, applyResponseLength: false });
    const contextBlob = `FILE: "${f.name}" (type: ${f.fileType || f.type})${f.tableName ? `\nSQL TABLE: ${f.tableName}` : ''}\nSUMMARY: ${f.summary || ''}\nCOLUMNS (use these exact names in relationships.this_field):\n${colsBlob}`;
    const convo = [
      { role: 'user', content: `You are onboarding: "${f.name}".\n\n${contextBlob}` },
      ...((f.intakeMessages || []).map((m) => ({
        role: toAnthropicRole(m.role),
        content: m.role === 'assistant'
          ? (stripJsonFromIntakeMessage(m.content) || 'Thanks — noted.')
          : String(m.content || ''),
      }))),
    ];

    let parsed = null;
    let raw = '';
    try {
      raw = await callAnthropic(system, convo, 2200);
      parsed = extractJsonObject(raw);
    } catch { /* fall through to fallback handling */ }

    const lastUserText = [...(f.intakeMessages || [])].reverse().find(m => m.role === 'user')?.content || '';
    const hasUserReply = (f.intakeMessages || []).some((m) => m.role === 'user');
    const declinedJoin = stellaLooksLikeJoinDecline(lastUserText);
    const acceptedJoin = stellaLooksLikeJoinAccept(lastUserText);
    const qaFromModel = (() => {
      const picked = pickIntakeContextQa(parsed);
      if (picked && typeof picked === 'object' && !Array.isArray(picked)) return picked;
      const nested = parsed?.context_qa;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
      return {};
    })();
    let rels = stellaNormalizeStoredRelationships(qaFromModel.relationships, live, otherTabular);
    if (declinedJoin) {
      rels = [];
    } else if (candidates.length && acceptedJoin) {
      const strong = candidates.filter((c) => c.score >= 70);
      rels = stellaDedupeRelationships([
        ...rels,
        ...stellaNormalizeStoredRelationships(strong, live, otherTabular),
      ]);
    }
    const priorRels = stellaNormalizeStoredRelationships(live.capturedContext?.relationships || f.capturedContext?.relationships, live, otherTabular);
    if (priorRels.length && !declinedJoin) rels = stellaDedupeRelationships([...priorRels, ...rels]);
    const filteredJoins = stellaFilterJoinRels(rels, live, otherTabular);
    rels = declinedJoin ? [] : filteredJoins.keep;

    const joinAskCount = (f.intakeMessages || []).filter(m => (
      m?.role === 'assistant' && /\b(join|joined|share an id, territory|correct keys|should not be joined)\b/i.test(String(m.content || ''))
    )).length;
    let complete = !!(parsed && parsed.complete);
    let forceJoinQuestion = false;
    if (!isDoc && otherTabular.length && !rels.length && !declinedJoin && joinAskCount < 2) {
      if (complete || !stellaIntakeAskedJoin(f.intakeMessages)) {
        complete = false;
        forceJoinQuestion = true;
      }
    }

    const modelLine = humanIntakeAssistantLine(parsed, raw, '');
    if (hasUserReply && !forceJoinQuestion && (complete || !intakeMessageLooksLikeAsk(modelLine) || !modelLine)) {
      complete = true;
    }

    let assistantMessage = forceJoinQuestion
      ? (stellaJoinQuestion(candidates, otherTabular) || modelLine)
      : modelLine;
    if (!assistantMessage) {
      assistantMessage = complete
        ? contextFileAddedConfirm(f.name, 'Stella Insights')
        : 'Could you tell me what this represents, the time period it covers, and the key metrics involved?';
    }
    if (complete && !forceJoinQuestion && intakeMessageLooksLikeAsk(assistantMessage)) {
      assistantMessage = contextFileAddedConfirm(f.name, 'Stella Insights');
    }
    if (complete && !declinedJoin && rels.length && !/\bstored join/i.test(assistantMessage)) {
      const joinLines = rels.map(r => `- ${f.tableName}.${r.this_field} = ${r.related_table || r.related_file}.${r.related_field}${r.related_file ? ` (${r.related_file})` : ''}`);
      assistantMessage = `${assistantMessage}\n\nStored joins for queries:\n${joinLines.join('\n')}`;
    }
    if (!declinedJoin && filteredJoins.dropped.length) {
      const lines = filteredJoins.dropped.map((d) => `- ${d.r.this_field} ↔ ${d.r.related_field || d.r.related_file}: ${d.why}`);
      assistantMessage = `${assistantMessage}\n\nI did not store these joins because they do not look like matching keys:\n${lines.join('\n')}`;
    }

    const nextIntakeMessages = [...(f.intakeMessages || []), { role: 'assistant', content: assistantMessage }];
    const shouldPersistContext = complete || !!f.intakeComplete;

    if (shouldPersistContext) {
      const ctx = {
        ...normalizeContextQa({ ...(f.capturedContext || {}), ...qaFromModel }, nextIntakeMessages),
        relationships: declinedJoin ? [] : rels,
      };
      await persistStellaIntakeContext(f, ctx, nextIntakeMessages);
      if (!declinedJoin && rels.length) {
        for (const r of rels) {
          const other = otherTabular.find(x => (
            (r.related_table && x.tableName === r.related_table)
            || (r.related_file && String(x.name || '').toLowerCase() === String(r.related_file).toLowerCase())
          ));
          if (!other) continue;
          const reverse = {
            related_file: f.name,
            related_table: f.tableName || '',
            this_field: r.related_field,
            related_field: r.this_field,
            note: r.note || '',
            link_type: r.link_type || stellaJoinLinkType(other, f),
          };
          const existing = Array.isArray(other.capturedContext?.relationships) ? other.capturedContext.relationships : [];
          const nextRels = stellaDedupeRelationships([...existing, reverse]);
          if (nextRels.length === existing.length) continue;
          const nextCtx = { ...(other.capturedContext || {}), relationships: nextRels };
          stellaPatchLocal(other.id, { capturedContext: nextCtx });
          try {
            if (other.dbId) await stellaUpdateRegistry(other.dbId, { context_qa: nextCtx });
          } catch { /* keep local mirror even if registry update fails */ }
        }
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

  const parseTerritoryTabular = async (file, kind) => {
    if (kind === 'json') {
      const records = await stellaParseTabular(file, kind);
      return { records: records || [], sheetName: null };
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
    const names = wb.SheetNames || [];
    let best = { score: -1, name: names[0] || '', records: [] };
    for (const name of names) {
      const ws = wb.Sheets[name];
      const records = ws ? XLSX.utils.sheet_to_json(ws, { defval: null }) : [];
      if (!records.length) continue;
      const payload = stellaBuildTabularPayload(records.slice(0, 40));
      const score = scoreTerritorySheet(payload.columns, records.slice(0, 40));
      if (score > best.score) best = { score, name, records };
    }
    return { records: best.records, sheetName: best.name || null };
  };

  const composeStellaOpeningIntake = async (fileRec, {
    records = null,
    summary: summaryArg = '',
    columns: columnsArg = null,
    heading = 'Uploaded',
    requireConfirm = false,
  } = {}) => {
    const name = fileRec.name;
    const isTabular = Array.isArray(records) && records.length > 0;
    let columns = Array.isArray(columnsArg) ? columnsArg : (fileRec.columns || []);
    let summary = String(summaryArg || fileRec.summary || '').trim();
    let onboarding = { summary, suggestedQuestions: [] };
    const sampleText = isTabular
      ? JSON.stringify(records.slice(0, 30), null, 2).substring(0, 16000)
      : '';
    const dataProfile = isTabular ? stellaProfileRecords(records) : '';
    if (!summary || /scheduled inbox/i.test(summary) || /^uploaded (dataset|document)\.?$/i.test(summary)) {
      onboarding = await stellaBuildContentSummary({
        name,
        type: fileRec.fileType || fileRec.type || 'csv',
        textSample: sampleText || (columns.length ? columns.map((c) => c.original || c.name).join(', ') : ''),
        columns: columns.map((c) => ({ name: c.original || c.name })),
        profile: dataProfile,
      });
      summary = onboarding.summary || summary || (isTabular ? 'Uploaded dataset.' : 'Uploaded document.');
      if (isTabular && Array.isArray(onboarding.columns) && onboarding.columns.length) {
        columns = columns.map((c) => {
          const match = onboarding.columns.find((oc) => (
            String(oc.name || '').toLowerCase() === String(c.original || c.name).toLowerCase()
          ));
          return match ? { ...c, description: match.description || '' } : c;
        });
      }
    }
    const otherTabular = stellaOtherTabularFiles(fileRec.id);
    const profiledColumns = isTabular
      ? stellaApplyRowSampleToColumns(columns, records.slice(0, STELLA_SQL_SAMPLE_ROWS))
      : columns;
    let joinQ = '';
    if ((isTabular || fileRec.tableName) && otherTabular.length) {
      await stellaHydrateColumnValueProfiles(otherTabular);
      const othersNow = stellaOtherTabularFiles(fileRec.id);
      joinQ = stellaJoinQuestion(
        stellaGuessJoinCandidates({ ...fileRec, columns: profiledColumns }, othersNow),
        othersNow,
      ) || '';
    }
    const modelQuestions = pickStellaIntakeQuestions({ ...onboarding, summary }).filter((q) => {
      if (!joinQ) return true;
      return !/\b(join|related|shared (id|key)|territory, product)\b/i.test(q);
    });
    const confirmQ = requireConfirm
      ? 'This file was refreshed from the inbox with different columns. Does the existing context still apply, or should we update it?'
      : '';
    const questions = [
      ...(confirmQ ? [confirmQ] : []),
      ...(joinQ ? [joinQ] : []),
      ...modelQuestions,
    ];
    const colLine = profiledColumns.length ? `\n\n**Columns:** ${profiledColumns.map((c) => c.name).join(', ')}` : '';
    const needsUser = questions.length > 0;
    const qBlock = formatStellaIntakeQuestionList(questions);
    const assistantMsg = needsUser
      ? (questions.length === 1
        ? `✅ ${heading}: **${name}**\n\n${summary}${colLine}\n\nI assessed this file from its contents${joinQ ? ' and found likely connections' : ''}:\n\n${questions[0]}`
        : `✅ ${heading}: **${name}**\n\n${summary}${colLine}\n\nI assessed this file from its contents.${joinQ || confirmQ ? ' Proposed connections are below.' : ''}\n\n${qBlock}`)
      : `✅ ${heading}: **${name}**\n\n${summary}${colLine}\n\nI've assessed this file from its contents — that's enough to query it. Ask me anything in Stella Insights.`;
    const autoCtx = needsUser ? null : {
      what_it_represents: summary,
      time_period: '',
      key_metrics: profiledColumns.slice(0, 12).map((c) => (
        c.description ? `${c.name} = ${c.description}` : c.name
      )).filter(Boolean),
      interpretation_notes: '',
      qa_pairs: [],
      relationships: [],
    };
    return { assistantMsg, needsUser, autoCtx, profiledColumns, summary, dataProfile };
  };

  const ensureStellaOpeningIntake = async (fileRec) => {
    if (!stellaFileNeedsOpeningIntake(fileRec)) return;
    stellaPatchLocal(fileRec.id, { processing: true });
    try {
      let records = null;
      if (fileRec.tableName) {
        const data = await stellaTableApi({ sql: `SELECT * FROM ${fileRec.tableName} LIMIT ${STELLA_SQL_SAMPLE_ROWS}` });
        records = Array.isArray(data.rows) ? data.rows : [];
      }
      const schemaChanged = !!(fileRec.capturedContext?.schema_changed);
      const opening = await composeStellaOpeningIntake(fileRec, {
        records,
        heading: schemaChanged ? 'Refreshed from inbox' : 'Imported from inbox',
        requireConfirm: schemaChanged,
      });
      const patch = {
        processing: false,
        summary: opening.summary,
        columns: opening.profiledColumns,
        previewRows: records?.length ? stellaPreviewRowsFromData(records, 3) : (fileRec.previewRows || []),
        intakeMessages: [{ role: 'assistant', content: opening.assistantMsg }],
        intakeComplete: !opening.needsUser && !schemaChanged,
      };
      if (opening.autoCtx && !schemaChanged) patch.capturedContext = opening.autoCtx;
      stellaPatchLocal(fileRec.id, patch);
      if (fileRec.dbId) {
        const reg = { summary: opening.summary, columns: stellaColumnsForRegistry(opening.profiledColumns) };
        if (opening.autoCtx && !schemaChanged) reg.context_qa = opening.autoCtx;
        try { await stellaUpdateRegistry(fileRec.dbId, reg); } catch { /* keep local opening even if registry lags */ }
      }
    } catch (err) {
      stellaPatchLocal(fileRec.id, {
        processing: false,
        intakeMessages: [{
          role: 'assistant',
          content: `Imported from the scheduled inbox. I could not finish the usual intake scan (${err.message || 'error'}). Describe what this file represents and whether it joins to other datasets.`,
        }],
      });
    }
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

    setStellaDataFiles(prev => {
      const next = [...prev, {
        id: tempId, dbId: null, name: file.name, type: kind, fileType: kind,
        size: `${(file.size / 1024).toFixed(1)} KB`, columns: [], rowCount: null,
        summary: '', capturedContext: null, tableName: null, storagePath: null, storageBucket: null,
        intakeMessages: [{ role: 'assistant', content: `⏳ Processing **${file.name}**…` }],
        intakeComplete: false, processing: true,
      }];
      stellaDataFilesRef.current = next;
      return next;
    });
    setActiveStellaDataId(tempId);
    setStellaSettingsTab('connections');
    setStellaConnectionsTab('files');
    setStellaFilesInnerTab('list');

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

      const cleanName = sanitizeStorageName(file.name);
      const objectRelPath = `data_${Date.now()}_${cleanName}`;
      const up = await stellaUploadToStorage(objectRelPath, file, file.type || undefined);
      storagePath = up.objectPath;
      storageBucket = up.bucket;

      if (isTabular) {
        // ── Tabular flow: keep the original in storage, load rows into a company table ──
        const payload = stellaBuildTabularPayload(records);
        columns = payload.columns;
        rowCount = payload.rowCount;
        tableName = `stella_data_${stellaNanoId()}`;
        await stellaCreateAndLoadTable(tableName, payload.columns, payload.rows);
        sampleText = JSON.stringify(records.slice(0, 30), null, 2).substring(0, 16000);
        dataProfile = stellaProfileRecords(records);
      } else {
        // ── Document flow: raw file already in storage; persist extracted text beside it ──
        let fullDocumentText = '';
        if (kind === 'pdf') {
          try { fullDocumentText = await stellaExtractPdfText(file); }
          catch { fullDocumentText = ''; }
          if (!fullDocumentText) fullDocumentText = `PDF document "${file.name}". Text could not be automatically extracted; please describe its contents in the intake questions.`;
        } else {
          fullDocumentText = await stellaReadAsText(file);
        }
        sampleText = fullDocumentText.substring(0, 18000);
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
        columns: stellaColumnsForRegistry(mergedColumns),
        row_count: rowCount,
        summary,
        context_qa: null,
      });
      const dbId = dbRow?.id || null;

      const opening = await composeStellaOpeningIntake({
        id: tempId,
        dbId,
        name: file.name,
        fileType: kind,
        type: kind,
        tableName,
        columns: mergedColumns,
        summary,
      }, {
        records: isTabular ? records : null,
        summary,
        columns: mergedColumns,
        heading: 'Uploaded',
      });
      const profiledColumns = opening.profiledColumns;
      const assistantMsg = opening.assistantMsg;
      const needsUser = opening.needsUser;
      const autoCtx = opening.autoCtx;
      const finalFile = {
        id: dbId || tempId, dbId,
        name: file.name, type: kind, fileType: kind,
        size: rowCount != null ? `${rowCount} rows` : `${(file.size / 1024).toFixed(1)} KB`,
        columns: profiledColumns, rowCount,
        previewRows: isTabular ? stellaPreviewRowsFromData(records, 3) : [],
        extractedText: isTabular ? '' : sampleText,
        summary, capturedContext: autoCtx, dataProfile,
        tableName, storagePath, storageBucket,
        uploadedBy: dbRow?.uploaded_by || currentUser.id,
        uploadedByName: dbRow?.uploaded_by_name || currentUser.name,
        textStoragePath: storagePath ? stellaExtractedTextPath(storagePath) : null,
        intakeMessages: [{ role: 'assistant', content: assistantMsg }],
        intakeComplete: !needsUser, processing: false,
        uploadedAt: dbRow?.uploaded_at || new Date().toISOString(),
      };
      setStellaDataFiles((prev) => {
        const next = prev.map((f) => (f.id === tempId ? finalFile : f));
        stellaDataFilesRef.current = next;
        return next;
      });
      setActiveStellaDataId(prev => (prev === tempId ? (dbId || tempId) : prev));
      if (autoCtx) {
        setStellaIntakeMinimized(true);
        try {
          if (dbId) await stellaUpdateRegistry(dbId, { context_qa: autoCtx });
        } catch (e) {
          setStellaMessages((prev) => [...prev, { role: 'system', content: `⚠️ Could not save captured context: ${e.message}` }]);
        }
      }
    } catch (e) {
      setStellaDataFiles(prev => prev.map(f => f.id === tempId
        ? { ...f, processing: false, intakeMessages: [{ role: 'system', content: `❌ Upload failed: ${e.message}` }] }
        : f));
    } finally {
      event.target.value = '';
    }
  };

  useEffect(() => {
    const list = stellaDataFilesRef.current || stellaDataFiles || [];
    for (const f of list) {
      if (stellaIntakeNeedsJsonSalvage(f)) {
        const salvageKey = `salvage:${f.id}`;
        if (stellaOpeningIntakeBusyRef.current.has(salvageKey)) continue;
        stellaOpeningIntakeBusyRef.current.add(salvageKey);
        const ctx = normalizeContextQa(f.capturedContext, f.intakeMessages);
        const msgs = (f.intakeMessages || []).map((m) => (
          m.role === 'assistant' && intakeChatLooksLikeJson(m.content)
            ? { ...m, content: contextFileAddedConfirm(f.name, 'Stella Insights') }
            : m
        ));
        void persistStellaIntakeContext(f, ctx, msgs).finally(() => {
          stellaOpeningIntakeBusyRef.current.delete(salvageKey);
        });
        continue;
      }
      if (!stellaFileNeedsOpeningIntake(f)) continue;
      if (stellaOpeningIntakeBusyRef.current.has(f.id)) continue;
      stellaOpeningIntakeBusyRef.current.add(f.id);
      void ensureStellaOpeningIntake(f).finally(() => {
        stellaOpeningIntakeBusyRef.current.delete(f.id);
      });
    }
  }, [stellaDataFiles]);

  const handleStellaIntakeSend = async () => {
    const fileId = activeStellaDataId;
    const current = stellaDataFiles.find(x => x.id === fileId);
    const msg = stellaIntakeInput.trim();
    if (!current || !msg || current.processing) return;
    setStellaIntakeInput('');
    const updated = { ...current, intakeMessages: [...(current.intakeMessages || []), { role: 'user', content: msg }] };
    stellaPatchLocal(fileId, { intakeMessages: updated.intakeMessages });
    try {
      await stellaIntakeNextTurn(updated);
    } catch (e) {
      setStellaMessages((prev) => [...prev, {
        role: 'system',
        content: `⚠️ Could not finish intake: ${e.message || e}`,
      }]);
    }
  };

  const handleStellaDeleteFile = async (fileId) => {
    const f = stellaDataFiles.find(x => x.id === fileId);
    if (!f) return;
    if (!window.confirm(`Delete "${f.name}" and its captured context? This cannot be undone.`)) return;
    setStellaDataFiles((prev) => {
      const next = prev.filter((x) => x.id !== fileId);
      stellaDataFilesRef.current = next;
      return next;
    });
    setActiveStellaDataId((prev) => (prev === fileId ? null : prev));
    const restore = () => {
      setStellaDataFiles((prev) => {
        if (prev.some((x) => x.id === fileId)) return prev;
        const next = [...prev, f];
        stellaDataFilesRef.current = next;
        return next;
      });
      setActiveStellaDataId((prev) => prev || fileId);
    };
    try {
      if (f.dbId) {
        const res = await fetch(STELLA_FILES_API_PATH, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action: 'delete', id: f.dbId }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error?.message || 'Could not remove file from the registry');
        }
      }
    } catch (e) {
      restore();
      setStellaMessages((prev) => [...prev, { role: 'system', content: `⚠️ Could not remove "${f.name}" from the registry: ${e.message}` }]);
      return;
    }
    void Promise.all([
      f.tableName ? stellaTableApi({ action: 'drop', tableName: f.tableName }).catch(() => null) : null,
      stellaRemoveStorage(f.storagePath, { bucket: f.storageBucket }),
      f.storagePath ? stellaRemoveStorage(stellaExtractedTextPath(f.storagePath), { bucket: f.storageBucket }) : null,
    ]);
  };

  // ── STELLA: Reusable admin panels ──
  const patchStellaBusinessField = (key, value) => {
    setStellaBusinessContext((prev) => {
      const next = { ...prev, [key]: value };
      setUserSettings((s) => ({ ...s, stellaBusinessContext: mergeStellaBusinessContext(next) }));
      return next;
    });
  };

  const renderStellaFileLinkMap = () => {
    const files = (stellaDataFiles || []).filter((f) => f && !f.processing);
    if (!files.length) return null;
    return (
      <MessageErrorBoundary fallback={
        <div className="bg-red-500/10 border border-red-400/25 rounded-xl p-4 text-xs text-red-200">
          Could not draw the file connection map.
        </div>
      }>
        <StellaFileConnectionMap
          files={files}
          activeId={activeStellaDataId}
          onSelectFile={setActiveStellaDataId}
          onJoinChange={handleStellaJoinChange}
          onRequestRemoveJoin={requestStellaJoinRemove}
          onUndoJoin={undoStellaJoin}
          joinUndo={stellaJoinUndo}
          joinConfirmOpen={!!stellaJoinPending}
        />
      </MessageErrorBoundary>
    );
  };

  const renderStellaDataPanel = () => {
    let joinCountById = new Map();
    try {
      joinCountById = new Map(
        stellaBuildFileLinkGraph(stellaDataFiles).nodes.map((n) => [n.id, n.joinCount])
      );
    } catch (err) {
      console.error('Stella file graph failed:', err);
    }
    const scheduleOpen = stellaFilesInnerTab === 'schedule';
    return (
    <div className="space-y-4">
      <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex gap-1 bg-slate-900/50 rounded-lg p-1 w-fit flex-wrap">
              <button
                type="button"
                onClick={() => setStellaFilesInnerTab('list')}
                className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-all ${!scheduleOpen ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}
              >
                Files
              </button>
              <button
                type="button"
                onClick={() => setStellaFilesInnerTab('schedule')}
                className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 ${scheduleOpen ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}
              >
                <Clock className="w-3.5 h-3.5" /> Schedule refresh
              </button>
            </div>
            <div className="text-xs text-blue-300/60 mt-2">
              {scheduleOpen
                ? 'Scheduled imports pull CSV, Excel, or JSON from this company’s drop folder (matched by company name). Same filename refreshes the existing dataset; a new name starts intake. Use Upload on the Files tab to load a file immediately.'
                : 'Upload CSV, JSON, Excel, PDF, or plain text. Stella captures context via intake.'}
            </div>
            {!scheduleOpen ? (() => {
              const folder = userStellaStoragePrefix(currentUser).replace(/\/$/, '');
              const schemaName = stellaTenantSchema?.name || companyPgSchema(resolveUserCompany(currentUser));
              const status = !stellaTenantSchema
                ? 'checking'
                : (stellaTenantSchema.ready !== false ? 'connected' : 'down');
              const statusLabel = status === 'connected'
                ? 'Connected'
                : status === 'checking'
                  ? 'Checking…'
                  : 'Not connected';
              const statusClass = status === 'connected'
                ? 'text-emerald-300/80'
                : status === 'checking'
                  ? 'text-blue-300/50'
                  : 'text-amber-300/85';
              const dotClass = status === 'connected'
                ? 'bg-emerald-400'
                : status === 'checking'
                  ? 'bg-blue-400/60'
                  : 'bg-amber-400';
              return (
                <div className="text-[11px] mt-1.5 text-blue-300/50 space-y-0.5">
                  <div>
                    Company folder <code className="text-cyan-300/80">{folder}</code>
                  </div>
                  <div className={`flex items-center gap-1.5 ${statusClass}`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />
                    Schema {schemaName} · {statusLabel}
                  </div>
                </div>
              );
            })() : null}
          </div>
          {!scheduleOpen ? (
            <div className="flex flex-col items-stretch sm:items-end gap-2 flex-shrink-0">
              <button onClick={() => stellaDataFileInputRef.current?.click()} className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2 text-sm">
                <Upload className="w-4 h-4" /> Upload
              </button>
            </div>
          ) : null}
          <input ref={stellaDataFileInputRef} type="file" accept=".csv,.json,.xlsx,.xls,.pdf,.txt,.md" onChange={handleStellaDataUpload} className="hidden" />
        </div>
      </div>

      {scheduleOpen ? renderStellaScheduleCard() : (
      <>
      {renderStellaFileLinkMap()}
      <div className="flex flex-col lg:flex-row gap-4">
      <div className="w-full lg:w-2/5">
        <div className="space-y-3">
          {stellaDataFiles.length === 0 && (
            <div className="bg-slate-800/20 border border-slate-700/40 rounded-xl p-5 text-sm text-blue-300/60">
              No files uploaded yet. Upload a file to begin intake.
            </div>
          )}
          {stellaDataFiles.map(f => (
            <div key={f.id} className={`w-full bg-slate-800/30 border rounded-xl p-4 transition-all ${activeStellaDataId === f.id ? 'border-cyan-400/60 bg-cyan-500/10' : 'border-blue-400/20 hover:border-blue-400/40'}`}>
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => setActiveStellaDataId(f.id)} className="min-w-0 text-left flex-1">
                  <div className="text-sm font-semibold text-white truncate">{f.name}</div>
                  <div className="text-xs text-blue-300/60 mt-1">{f.size} • {f.type || 'file'}{Array.isArray(f.columns) && f.columns.length ? ` • ${f.columns.length} cols` : ''}{(f.uploadedByName || f.uploadedBy) ? ` • uploaded by ${f.uploadedByName || f.uploadedBy}` : ''}</div>
                  {f.summary && <div className="text-xs text-blue-200/80 mt-2 line-clamp-3">{f.summary}</div>}
                </button>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  {f.intakeComplete ? (
                    <span className="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded border border-green-400/30">Context captured</span>
                  ) : (
                    <span className="px-2 py-1 bg-yellow-500/15 text-yellow-200 text-xs rounded border border-yellow-400/25">Intake pending</span>
                  )}
                  {f.capturedContext && !f.processing && (joinCountById.get(f.id) || 0) > 0 && (
                    <span className="px-2 py-1 bg-cyan-500/15 text-cyan-200 text-xs rounded border border-cyan-400/25">
                      Connected
                    </span>
                  )}
                  {f.capturedContext && !f.processing && !(joinCountById.get(f.id) || 0) && (
                    <span className="px-2 py-1 bg-slate-700/40 text-slate-300 text-xs rounded border border-slate-500/30">Not joined</span>
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
          {(() => {
            const f = stellaDataFiles.find(x => x.id === activeStellaDataId);
            const intake = f?.intakeMessages || [];
            const captured = !!(f && f.intakeComplete && !f.processing);
            const minimized = stellaIntakeMinimized && captured;
            return (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white">Intake assistant</div>
                    {!minimized ? (
                      <div className="text-xs text-blue-300/60 mt-1">Answer questions about this file&apos;s structure — columns, what they contain, and how it joins to other files. Not metrics or analysis.</div>
                    ) : (
                      <div className="text-xs text-blue-300/60 mt-1">Context captured. Expand to add or update notes for this file.</div>
                    )}
                  </div>
                  {f && captured ? (
                    <button
                      type="button"
                      onClick={() => setStellaIntakeMinimized((v) => !v)}
                      className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-cyan-200 bg-slate-900/60 border border-cyan-400/25 hover:bg-cyan-500/15 flex items-center gap-1.5"
                    >
                      {minimized ? <ChevronDown className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
                      {minimized ? 'Update context' : 'Minimise'}
                    </button>
                  ) : null}
                </div>

                {minimized ? (
                  <div className="mt-3 text-xs text-slate-300 bg-slate-900/40 border border-emerald-400/20 rounded-lg px-3 py-2">
                    {String(f.capturedContext?.what_it_represents || f.summary || 'File context is stored. Use Update context if you need to change it.').replace(/\s+/g, ' ').trim().slice(0, 180)}
                  </div>
                ) : !f ? (
                  <div className="text-sm text-blue-300/60 mt-3">Select a dataset on the left.</div>
                ) : (
              <div className="space-y-3 mt-4">
                <div className="bg-slate-900/40 border border-blue-400/15 rounded-xl p-4 max-h-[420px] overflow-y-auto overflow-x-hidden custom-scrollbar space-y-3">
                  {intake.length === 0 ? (
                    <div className="text-sm text-blue-300/60">Upload processing…</div>
                  ) : intake.map((m, i) => {
                    const shown = m.role === 'user'
                      ? m.content
                      : displayIntakeChatContent(m.content, {
                        complete: captured,
                        fileName: f.name,
                        moduleLabel: 'Stella Insights',
                      });
                    return (
                    <div key={i} className={`flex min-w-0 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[90%] min-w-0 chat-fit px-3 py-2 rounded-xl text-sm ${m.role === 'user' ? 'inline-block bg-gradient-to-br from-cyan-500 to-blue-500 text-white' : m.role === 'system' ? 'bg-yellow-500/15 border border-yellow-400/25 text-yellow-200' : 'block w-full bg-slate-800/60 border border-blue-400/20 text-blue-100'}`}>
                        {m.role === 'user' ? <span className="whitespace-pre-wrap break-words">{shown}</span> : <MessageErrorBoundary>{formatMarkdown(shown)}</MessageErrorBoundary>}
                      </div>
                    </div>
                    );
                  })}
                </div>

                <div className="flex gap-2">
                  <textarea value={stellaIntakeInput} onChange={(e) => setStellaIntakeInput(e.target.value)} placeholder="Answer the intake questions… (1= … 2= … if several are listed)" className="flex-1 bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors resize-none" rows={2} />
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
                  <details className="bg-emerald-500/10 border border-emerald-400/20 rounded-xl overflow-hidden" open>
                    <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold text-emerald-300 hover:bg-emerald-500/10 flex items-center gap-2">
                      <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" /> Captured context
                    </summary>
                    <StellaCapturedContextView
                      ctx={f.capturedContext}
                      onPatch={(next) => persistStellaFileContext(f, next)}
                      onRemoveJoin={(rel) => {
                        const other = (stellaDataFilesRef.current || []).find((x) => (
                          x.id !== f.id && (
                            (rel.related_table && x.tableName === rel.related_table)
                            || (rel.related_file && String(x.name || '').toLowerCase() === String(rel.related_file || '').toLowerCase())
                          )
                        ));
                        if (!other) {
                          persistStellaFileContext(f, {
                            ...f.capturedContext,
                            relationships: (f.capturedContext?.relationships || []).filter((r) => r !== rel),
                          });
                          return;
                        }
                        requestStellaJoinRemove({
                          fromId: f.id,
                          toId: other.id,
                          thisField: rel.this_field,
                          relatedField: rel.related_field,
                        });
                      }}
                    />
                  </details>
                )}
              </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
      </div>
      </>
      )}
    </div>
    );
  };

  const renderStellaBusinessPanel = () => (
    <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
      <h3 className="text-lg font-bold text-white mb-2">Analysis goals</h3>
      <p className="text-xs text-blue-300/60 mb-6">
        Company name, industry, metrics, and terminology are in <span className="text-cyan-300 font-semibold">General</span> and apply across the hub. Use this field only for what Stella should focus on when analysing your data.
      </p>
      <div>
        <label className="block text-xs text-blue-300/70 font-semibold mb-2">Key goals for Stella</label>
        <textarea value={stellaBusinessContext.keyGoals} onChange={(e) => patchStellaBusinessField('keyGoals', e.target.value)} rows={4} placeholder="e.g. Spot underperforming territories, explain mix vs price, flag data quality issues" className="w-full bg-slate-900/50 text-white placeholder-blue-300/30 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y" />
      </div>
      <div className="flex items-center gap-3 mt-6">
        <button onClick={() => stellaSaveBusinessContext(stellaBusinessContext)} disabled={stellaBizSaveStatus === 'saving'} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:opacity-50 text-white font-semibold rounded-lg transition-all flex items-center gap-2">
          <Save className="w-4 h-4" /> {stellaBizSaveStatus === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => stellaSaveBusinessContext({ ...stellaBusinessContext, keyGoals: '' })} className="px-5 py-2.5 bg-slate-700/60 hover:bg-slate-600/60 text-slate-200 font-semibold rounded-lg transition-all border border-slate-500/30">
          Reset
        </button>
        {stellaBizSaveStatus === 'saved' && (
          <span className="flex items-center gap-1.5 text-sm text-green-400 font-semibold"><CheckCircle className="w-4 h-4" /> Saved to your settings</span>
        )}
        {stellaBizSaveStatus === 'error' && (
          <span className="flex items-center gap-1.5 text-sm text-red-400 font-semibold"><AlertTriangle className="w-4 h-4" /> Save failed — see chat</span>
        )}
      </div>
    </div>
  );

  const patchStellaInboxSchedule = (patch) => {
    const connections = mergeStellaConnections(userSettingsRef.current?.stellaConnections);
    const current = stellaInboxSchedule(connections);
    const nextSchedule = { ...current, ...patch };
    const schedules = connections.schedules.map((s) => (
      (s.id === nextSchedule.id || s.source === 'inbox') ? nextSchedule : s
    ));
    const next = { ...connections, schedules };
    setUserSettings((s) => ({ ...s, stellaConnections: next }));
    userSettingsRef.current = { ...userSettingsRef.current, stellaConnections: next };
    return next;
  };

  const saveStellaInboxSchedule = async (patch) => {
    const next = patchStellaInboxSchedule(patch);
    await saveUserSettings({ stellaConnections: next });
  };

  const runStellaInboxNow = async () => {
    try {
      setStellaSyncBusy(true);
      const res = await fetch(STELLA_SYNC_API_PATH, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'run' }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error?.message || `Sync failed (${res.status})`);
      }
      if (payload.schedule) {
        const next = patchStellaInboxSchedule(payload.schedule);
        await saveUserSettings({ stellaConnections: next });
      }
      await stellaReloadRegistry();
      const pendingIntake = (Array.isArray(payload.results) ? payload.results : []).filter((r) => (
        r && (r.action === 'created' || r.action === 'replaced_schema')
      ));
      if (pendingIntake.length) {
        openStellaIntakeAssistant(pendingIntake[0]);
      }
      const n = Array.isArray(payload.results) ? payload.results.filter((r) => r.action !== 'error').length : 0;
      const status = payload.schedule?.lastStatus || (payload.skipped ? 'Not run' : 'Done');
      const mailNote = payload.emailed
        ? ' An email was sent with a link to the intake assistant.'
        : payload.emailError
          ? ` Email was not sent (${payload.emailError}).`
          : pendingIntake.length
            ? ' Open the file on the left to answer intake.'
            : '';
      setStellaMessages((prev) => [...prev, {
        role: 'system',
        content: n
          ? `Inbox sync finished: ${status}.${mailNote}`
          : `Inbox sync: ${status}.${mailNote}`,
      }]);
    } catch (err) {
      setStellaMessages((prev) => [...prev, {
        role: 'system',
        content: `⚠️ Inbox sync failed: ${err.message || err}`,
      }]);
    } finally {
      setStellaSyncBusy(false);
    }
  };

  const renderStellaScheduleCard = () => {
    const schedule = stellaInboxSchedule(userSettings.stellaConnections);
    const lastRun = schedule.lastRunAt
      ? new Date(schedule.lastRunAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'Never';
    return (
      <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-5 space-y-4">
        <div>
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" /> Inbox schedule
          </div>
          <p className="text-xs text-blue-300/60 mt-2">
            Tick <span className="text-blue-100 font-semibold">Enable schedule</span> to import files from this company&apos;s drop folder. Admins place files in the folder that matches the company name. Same filename refreshes the existing dataset; a new name starts intake.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <div className="text-xs font-semibold text-blue-200/80 mb-1.5">Frequency</div>
            <select
              value={schedule.frequency}
              onChange={(e) => saveStellaInboxSchedule({ frequency: e.target.value })}
              className="w-full bg-slate-900/60 border border-blue-400/20 rounded-lg px-3 py-2 text-sm text-white"
            >
              {STELLA_SCHEDULE_FREQUENCIES.map((id) => (
                <option key={id} value={id}>{id.charAt(0).toUpperCase() + id.slice(1)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-3 bg-slate-900/40 border border-blue-400/15 rounded-lg px-3 py-2 mt-0 sm:mt-6">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) => saveStellaInboxSchedule({ enabled: e.target.checked })}
              className="w-4 h-4 accent-cyan-500"
            />
            <span className="text-sm text-white font-semibold">Enable schedule</span>
          </label>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-blue-400/15">
          <div className="text-xs text-blue-300/70 space-y-1">
            <div>Last run: <span className="text-blue-100">{lastRun}</span></div>
            {schedule.lastStatus ? <div>Status: <span className="text-blue-100">{schedule.lastStatus}</span></div> : null}
            {schedule.lastFile ? <div>Last file: <span className="text-blue-100">{schedule.lastFile}</span></div> : null}
            {!schedule.enabled ? <div className="text-amber-200/80">Schedule is off — cron will skip this account until you enable it.</div> : null}
          </div>
          <button
            type="button"
            disabled={stellaSyncBusy}
            onClick={runStellaInboxNow}
            className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-50 text-cyan-100 font-semibold rounded-lg border border-cyan-400/30 flex items-center justify-center gap-2 text-sm"
          >
            <Play className="w-4 h-4" /> {stellaSyncBusy ? 'Working…' : 'Run now'}
          </button>
        </div>
      </div>
    );
  };

  const renderStellaConnectionsPanel = () => {
    const connector = STELLA_CONNECTORS.find(c => c.id === stellaConnectionsTab);
    return (
      <div className="space-y-4">
        <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1 w-fit flex-wrap">
          <button
            type="button"
            onClick={() => { setStellaConnectionsTab('files'); setStellaFilesInnerTab('list'); }}
            className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-all ${stellaConnectionsTab === 'files' ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}
          >
            Files
          </button>
          {STELLA_CONNECTORS.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setStellaConnectionsTab(c.id)}
              className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-all ${stellaConnectionsTab === c.id ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
        {stellaConnectionsTab === 'files' ? renderStellaDataPanel() : (
          <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white">{connector?.name || 'Connector'}</h3>
                <p className="text-xs text-blue-300/60 mt-2">Direct connectors (APIs / databases / CRM) will be enabled here in a future release. Saved per user when available.</p>
              </div>
              <span className="px-2 py-1 bg-slate-700/50 text-slate-300 text-xs rounded border border-slate-600/50 flex-shrink-0">Coming Soon</span>
            </div>
            <div className="mt-4 text-xs text-slate-400/80">Authentication, schema mapping, and scheduled sync will be available for this account.</div>
          </div>
        )}
      </div>
    );
  };

  // ── STELLA: Chat prompt builder + submit ──
  const buildStellaSystemPrompt = (filesArg) => {
    const files = Array.isArray(filesArg) ? filesArg : (stellaDataFiles || []);
    const biz = stellaBusinessContext || {};
    const goals = String(biz.keyGoals || '').trim();
    const bizText = goals
      ? `STELLA ANALYSIS GOALS:\n${goals}\n\nCompany, industry, metrics, and terminology come from this user's General settings — do not re-ask them.\n`
      : 'STELLA ANALYSIS GOALS: (not set — use General user settings for company, industry, metrics, and terminology.)\n';

    const tabular = files.filter(f => f.tableName);
    const docs = files.filter(f => !f.tableName);
    const { body: blocks } = formatStellaFileIndex(files, { maxFiles: 40, maxChars: 4000, header: false });

    const tableList = tabular.length ? tabular.map(t => t.tableName).join(', ') : '(none)';
    const sqlInstr = tabular.length
      ? `\nTABULAR DATA (query with tools):\n- Call \`get_file_context\` for the files you will query so you have exact column names, types, and interpretation notes.\n- Query tables using the \`run_sql\` tool (single SELECT only). Available tables: ${tableList}.\n- Use \`inspect_table\` to preview a table's real values/formats before writing analytical queries.\n- Reference EXACT (safe) column names from get_file_context / inspect_table, not original headers and not guesses from the index.\n`
      : '';
    const docList = docs.length ? docs.map(d => `"${d.name}"`).join(', ') : '(none)';
    const docInstr = docs.length
      ? `\nDOCUMENTS (PDF / text):\n- Call \`get_file_context\` for interpretive notes, then \`read_document\` for full text. Documents: ${docList}.\n- Use \`read_document\` when you need specific facts, quotes, or details from a PDF/text file.\n`
      : '';
    const crossInstr = (tabular.length && docs.length)
      ? `\nCROSS-SOURCE QUESTIONS:\nMany questions combine tabular data (sales, engagement metrics in SQL) with document context (policies, reports, PDFs). For these:\n1. Use \`get_file_context\` then \`read_document\` to pull relevant passages from PDFs/text files\n2. Use \`inspect_table\` / \`run_sql\` for quantitative data\n3. Synthesise both in your answer — explicitly connect numbers to document context\n4. Verify that findings from each source align before answering\n`
      : '';

    return withUserSettings(`${fillTemplate(getStellaPrompts().analyst, {
      bizText,
      fileCount: files.length,
      filePlural: files.length === 1 ? '' : 's',
      blocks: blocks || '(no files uploaded yet)',
      sqlInstr,
      docInstr,
      crossInstr,
    })}${moduleGetsGeneralKnowledge('stella') ? formatGeneralKnowledgeBlock() : ''}`);
  };

  const stellaRunQuery = async (sql) => {
    const data = await stellaTableApi({ sql });
    return Array.isArray(data.rows) ? data.rows : [];
  };

  // Tools the Stella agent can call during its investigation loop.
  const STELLA_TOOLS = [
    {
      name: 'get_file_context',
      description: 'Load the full context card for one file from this hub session (this module or a connected module). Use a file name from THIS MODULE LIBRARY or a LINKED MODULE LIBRARY index. Call this before answering from, interpreting, or querying a file.',
      input_schema: {
        type: 'object',
        properties: {
          file_name: { type: 'string', description: 'File name, table name, or unique fragment from the data index.' },
        },
        required: ['file_name'],
      },
    },
    {
      name: 'run_sql',
      description: 'Execute a single read-only SQL SELECT against the uploaded datasets and return matching rows as JSON. Only SELECT is allowed. Results are capped at 500 rows — use COUNT/SUM/GROUP BY for full-table stats on large files. Use exact table and column names from get_file_context or inspect_table. Use JOINs to combine datasets.',
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
        properties: { table: { type: 'string', description: 'Exact table name from get_file_context or the data index.' } },
        required: ['table'],
      },
    },
    {
      name: 'read_document',
      description: 'Read the full text of a hub file (Stella PDF/text, or an Incentive/Territory context file extract) by file name from the index. Use when you need specific details, quotes, scheme rules, or alignment facts — especially when combining with Stella SQL results.',
      input_schema: {
        type: 'object',
        properties: {
          file_name: { type: 'string', description: 'Exact file name from the data index (e.g. "Q1 Engagement Report.pdf").' },
          search_hint: { type: 'string', description: 'Optional keyword or topic to focus on when scanning a long document.' },
        },
        required: ['file_name'],
      },
    },
  ];

  // Execute a tool call requested by the agent; returns { text, step }.
  const runStellaTool = async (name, input, knownTables, files, hubFiles = []) => {
    if (name === 'get_file_context') {
      const q = String(input?.file_name || '').trim();
      const stellaHit = findStellaFile(files, q);
      const hubHit = stellaHit ? null : findHubContextFile(hubFiles, q);
      const file = stellaHit || hubHit;
      if (!file) {
        const available = [...new Set([
          ...(files || []).filter((f) => f && !f.processing).map((f) => f.name),
          ...(hubFiles || []).filter((f) => f && !f.processing).map((f) => f.name),
        ])].slice(0, 40).join(', ') || '(none)';
        return { text: `File "${q}" not found. Available files: ${available}`, step: { type: 'error', label: 'File context not found', detail: q } };
      }
      const useStellaCard = !!(file.tableName || file.hubKind === 'stella-table' || file.hubKind === 'stella-doc');
      return {
        text: useStellaCard ? formatStellaFileContextCard(file) : formatModuleContextCard(file),
        step: { type: 'context', label: `Loaded context for ${file.name}`, detail: file.tableName ? `table ${file.tableName}` : (file.hubModule ? String(file.hubModule) : 'document') },
      };
    }
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
        const capped = rows.length >= 500;
        return {
          text: `Rows (${rows.length}${capped ? ', capped at 500 — aggregate if you need the full table' : ''}):\n${JSON.stringify(rows).slice(0, 10000)}`,
          step: { type: 'query', label: 'Ran query', detail: query, resultCount: rows.length, result: stellaPreviewRows(rows) },
        };
      } catch (err) {
        return { text: `Query failed: ${err.message}`, step: { type: 'error', label: 'Query failed', detail: `${query}\n→ ${err.message}` } };
      }
    }
    if (name === 'read_document') {
      const fileName = String(input?.file_name || '').trim();
      const hint = String(input?.search_hint || '').trim().toLowerCase();
      const stellaDoc = (files || []).find(f => !f.tableName && f.name.toLowerCase() === fileName.toLowerCase())
        || (files || []).find(f => !f.tableName && f.name.toLowerCase().includes(fileName.toLowerCase()));
      const hubDoc = stellaDoc ? null : findHubContextFile(hubFiles, fileName);
      const doc = stellaDoc || hubDoc;
      if (!doc) {
        const available = [...new Set([
          ...(files || []).filter(f => !f.tableName).map(f => f.name),
          ...(hubFiles || []).filter(f => f && !f.tableName).map(f => f.name),
        ])].filter(Boolean).join(', ') || '(none)';
        return { text: `Document "${fileName}" not found. Available documents: ${available}`, step: { type: 'error', label: 'Document not found', detail: fileName } };
      }
      const applyHint = (text) => {
        let excerpt = String(text || '');
        let truncated = false;
        if (hint && excerpt.length > 8000) {
          const paras = excerpt.split(/\n{2,}/);
          const hits = paras.filter(p => p.toLowerCase().includes(hint));
          if (hits.length) excerpt = hits.join('\n\n');
        }
        const TOOL_CHAR_CAP = 55000;
        if (excerpt.length > TOOL_CHAR_CAP) {
          excerpt = excerpt.slice(0, TOOL_CHAR_CAP);
          truncated = true;
        }
        return { excerpt, truncated };
      };
      try {
        if (doc.tableName || doc.hubKind === 'stella-table') {
          return { text: `"${doc.name}" is a Stella table. Use get_file_context then inspect_table / run_sql.`, step: { type: 'error', label: `Read ${doc.name}`, detail: 'tabular — use SQL tools' } };
        }
        if (stellaDoc || doc.hubKind === 'stella-doc') {
          let text = await stellaFetchDocumentText(doc);
          if (!text || !text.trim()) {
            return { text: `No extractable text found for "${doc.name}". Use the summary and intake context from get_file_context.`, step: { type: 'error', label: `Read ${doc.name}`, detail: 'No text extracted' } };
          }
          const { excerpt, truncated } = applyHint(text);
          return {
            text: `Full text of "${doc.name}"${hint ? ` (filtered by: ${hint})` : ''}${truncated ? ' [truncated]' : ''}:\n\n${excerpt}`,
            step: { type: 'document', label: `Read ${doc.name}`, detail: `${excerpt.length.toLocaleString()} characters${truncated ? ' (truncated)' : ''}${hint ? ` · hint: ${hint}` : ''}` },
          };
        }
        const bundled = [
          doc.extractedText,
          doc.structuredExtract,
          doc.visionExtract,
          doc.summary,
        ].filter((t) => t && String(t).trim()).join('\n\n');
        if (!bundled.trim()) {
          const card = formatModuleContextCard(doc);
          return { text: card || `No extractable text found for "${doc.name}".`, step: { type: 'document', label: `Read ${doc.name}`, detail: 'context card' } };
        }
        const { excerpt, truncated } = applyHint(bundled);
        return {
          text: `Extract of "${doc.name}" (${doc.hubModule || 'module'})${hint ? ` (filtered by: ${hint})` : ''}${truncated ? ' [truncated]' : ''}:\n\n${excerpt}`,
          step: { type: 'document', label: `Read ${doc.name}`, detail: `${excerpt.length.toLocaleString()} characters${truncated ? ' (truncated)' : ''}` },
        };
      } catch (err) {
        return { text: `Could not read "${doc.name}": ${err.message}`, step: { type: 'error', label: `Read ${doc.name}`, detail: err.message } };
      }
    }
    return { text: `Unknown tool: ${name}`, step: { type: 'error', label: `Unknown tool ${name}`, detail: '' } };
  };

  const runWithStellaDataTools = async ({
    system,
    messages,
    files,
    hubFiles = [],
    maxRounds = 8,
    maxTokens = 4000,
    thinking = false,
    wrapPrompt = 'Please give your final answer now based on what you found. Do not mention SQL or tool names.',
  } = {}) => {
    const knownTables = (files || []).filter((f) => f.tableName).map((f) => f.tableName);
    const hasTables = knownTables.length > 0;
    const toolList = hasTables
      ? STELLA_TOOLS
      : STELLA_TOOLS.filter((t) => t.name === 'get_file_context' || t.name === 'read_document');
    const convo = (messages || []).map((m) => ({
      role: toAnthropicRole(m.role),
      content: m.content,
    }));
    const steps = [];
    let finalText = '';
    const thinkingCfg = thinking && typeof thinking === 'object'
      ? thinking
      : (thinking ? { type: 'enabled', budget_tokens: 2500 } : null);
    const tokenBudget = Math.min(8192, Math.max(maxTokens || 1000, thinkingCfg ? (thinkingCfg.budget_tokens || 2500) + 500 : 0));

    for (let round = 0; round < maxRounds; round++) {
      const payload = {
        system,
        messages: convo,
        tools: toolList,
        max_tokens: tokenBudget,
      };
      if (thinkingCfg) payload.thinking = thinkingCfg;
      const resp = await anthropicMessagesPost(payload);
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`API error ${resp.status}: ${(errText || '').slice(0, 240)}`);
      }
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

      const content = Array.isArray(data.content) ? data.content : [];
      const thinkingParts = content
        .filter((b) => (b.type === 'thinking' || b.type === 'redacted_thinking'))
        .map((b) => (b.type === 'redacted_thinking' ? '(internal reasoning)' : b.thinking))
        .filter(Boolean);
      const textParts = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const toolUses = content.filter((b) => b.type === 'tool_use');

      thinkingParts.forEach((t, idx) => {
        const detail = String(t).trim();
        if (detail) steps.push({ type: 'thought', label: (round === 0 && idx === 0) ? 'Plan' : 'Reasoning', detail });
      });
      if (textParts && toolUses.length) {
        steps.push({ type: 'thought', label: 'Note', detail: textParts });
      }

      if (data.stop_reason !== 'tool_use' || !toolUses.length) {
        finalText = textParts || finalText;
        break;
      }

      convo.push({ role: 'assistant', content });
      const toolResults = [];
      for (const tu of toolUses) {
        const { text, step } = await runStellaTool(tu.name, tu.input, knownTables, files, hubFiles);
        steps.push(step);
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: text });
      }
      convo.push({ role: 'user', content: toolResults });

      if (round === maxRounds - 1) {
        const wrapPayload = {
          system,
          messages: [...convo, { role: 'user', content: wrapPrompt }],
          max_tokens: tokenBudget,
        };
        if (thinkingCfg) wrapPayload.thinking = thinkingCfg;
        const wrapResp = await anthropicMessagesPost(wrapPayload);
        if (!wrapResp.ok) {
          const errText = await wrapResp.text();
          throw new Error(`API error ${wrapResp.status}: ${(errText || '').slice(0, 240)}`);
        }
        const wrapData = await wrapResp.json();
        if (!wrapData.error) finalText = anthropicAssistantText(wrapData) || finalText;
      }
    }

    return { text: stellaStripSqlBlocks(finalText) || finalText || '', steps };
  };
  runWithStellaDataToolsRef.current = runWithStellaDataTools;

  // Collapsible "How Stella worked this out" reasoning trail.
  const renderStellaSteps = (steps, title) => {
    const iconFor = (t) => (t === 'query' ? '🔎' : t === 'inspect' ? '👁' : t === 'document' ? '📄' : t === 'context' ? '📋' : t === 'error' ? '⚠️' : '🧠');
    const heading = title || 'How Stella worked this out';
    return (
      <details className="mt-3 bg-slate-900/50 border border-blue-400/20 rounded-lg overflow-hidden">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-cyan-300/90 hover:bg-slate-800/50 flex items-center gap-2">
          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" /> {heading} ({steps.length} step{steps.length === 1 ? '' : 's'})
        </summary>
        <ol className="px-3 pb-3 pt-1 space-y-2 list-none">
          {steps.map((s, i) => (
            <div key={i} className="text-[11px] text-blue-200/80 border-l-2 border-blue-400/25 pl-2.5">
              <div className="font-semibold text-blue-100/90">{i + 1}. {iconFor(s.type)} {s.label}{typeof s.resultCount === 'number' ? ` — ${s.resultCount} row${s.resultCount === 1 ? '' : 's'}` : ''}</div>
              {s.detail && (s.type === 'thought'
                ? <div className="mt-0.5 whitespace-pre-wrap text-blue-200/85 leading-relaxed">{s.detail}</div>
                : <pre className="mt-0.5 whitespace-pre-wrap break-words text-blue-300/70 bg-slate-950/40 rounded px-2 py-1 overflow-x-hidden">{s.detail}</pre>)}
              {s.result && <pre className="mt-1 whitespace-pre-wrap break-words text-emerald-200/70 bg-emerald-950/20 border border-emerald-400/15 rounded px-2 py-1 overflow-x-hidden">{s.result}</pre>}
            </div>
          ))}
        </ol>
      </details>
    );
  };

  const handleStellaChatSubmit = async (e, overrideInput = null) => {
    if (e) e.preventDefault();
    let messageContent = (overrideInput != null ? String(overrideInput) : stellaInput).trim();
    if (!messageContent || stellaIsLoading) return;

    let skipPost = false;
    let skipHarvest = false;
    const resume = stellaResumeRef.current;

    if (memoryPendingFor('stella')) {
      const forcedCustom = memoryCustomForcedRef.current;
      memoryCustomForcedRef.current = false;
      if (isMemoryConfirmAccept(messageContent)) {
        setStellaInput('');
        setStellaMessages((prev) => [...prev, { role: 'user', content: messageContent }]);
        await applyPendingMemoryDecision('accept');
        if (resume?.messageContent) {
          stellaResumeRef.current = null;
          skipPost = true;
          skipHarvest = true;
          messageContent = resume.messageContent;
        } else {
          setStellaMessages((prev) => [...prev, { role: 'assistant', content: 'Updated. I’ll use the new fact going forward.' }]);
          return;
        }
      } else if (isMemoryConfirmDecline(messageContent)) {
        setStellaInput('');
        setStellaMessages((prev) => [...prev, { role: 'user', content: messageContent }]);
        await applyPendingMemoryDecision('decline');
        if (resume?.messageContent) {
          stellaResumeRef.current = null;
          skipPost = true;
          skipHarvest = true;
          messageContent = resume.messageContent;
        } else {
          setStellaMessages((prev) => [...prev, { role: 'assistant', content: 'Kept the existing remembered fact. Thanks for confirming.' }]);
          return;
        }
      } else if (forcedCustom || looksLikeMemoryCorrection(messageContent, { force: forcedCustom })) {
        setStellaInput('');
        setStellaMessages((prev) => [...prev, { role: 'user', content: messageContent }]);
        await applyPendingMemoryDecision('custom', messageContent.trim());
        if (resume?.messageContent) {
          stellaResumeRef.current = null;
          skipPost = true;
          skipHarvest = true;
          messageContent = resume.messageContent;
        } else {
          setStellaMessages((prev) => [...prev, { role: 'assistant', content: `Updated memory to: ${messageContent.trim()}` }]);
          return;
        }
      } else {
        setStellaInput('');
        setStellaMessages((prev) => [...prev, { role: 'user', content: messageContent }]);
        setStellaMessages((prev) => [...prev, {
          role: 'assistant',
          content: 'Please confirm the memory change first — **Yes**, **Keep existing**, or type the correct version.',
        }]);
        return;
      }
    }

    if (pptxClarifyPending) setPptxClarifyPending(false);

    setStellaIsLoading(true);
    if (!skipPost) {
      setStellaMessages((prev) => {
        const next = [...prev, { role: 'user', content: messageContent }];
        stellaMessagesRef.current = next;
        return next;
      });
      setStellaInput('');
    }

    if (!skipHarvest && shouldHarvestChatMemory('', messageContent) && !/\?/.test(messageContent)) {
      const threadNow = stellaMessagesRef.current || [];
      const priorAsk = [...threadNow].reverse().find((m) => m.role === 'assistant');
      const harvested = await harvestChatMemory(
        priorAsk?.content,
        messageContent,
        recentChatTurnsForMemory(threadNow),
        { thread: 'stella' },
      );
      if (harvested?.conflict || memoryPendingFor('stella')) {
        stellaResumeRef.current = { messageContent };
        setStellaIsLoading(false);
        return;
      }
      skipHarvest = true;
    }

    try {
      const routed = await classifyUserMessageIntent(messageContent);
      if (routed.kind === 'export') {
        setStellaIsLoading(false);
        await handleGeneratePptx({
          title: routed.title || 'Session Summary',
          description: routed.description || 'Factual recap of this conversation',
        }, 'summary');
        return;
      }

      // Always build the prompt from the freshest registry.
      const registry = await stellaReloadRegistry();
      const files = (Array.isArray(registry) && registry.length)
        ? registry
        : (stellaDataFilesRef.current || stellaDataFiles);
      const systemPrompt = buildStellaSystemPrompt(files);
      const convo = [
        ...stellaMessages.filter(m => m.role !== 'system').map(m => ({ role: toAnthropicRole(m.role), content: m.content })),
        { role: 'user', content: messageContent },
      ];
      const stellaSettings = userSettingsRef.current || userSettings;
      const stellaAnswerTokens = scaleUserFacingMaxTokens(2500, stellaSettings);
      const hubFiles = listHubContextFiles(stellaSettings, 'stella', { stellaFiles: files });
      const { text: finalText, steps } = await runWithStellaDataTools({
        system: systemPrompt,
        messages: convo,
        files,
        hubFiles,
        maxRounds: 8,
        maxTokens: Math.min(8192, 2500 + stellaAnswerTokens),
        thinking: { type: 'enabled', budget_tokens: 2500 },
        wrapPrompt: 'Please give your final answer now based on what you found.',
      });

      const cleaned = stellaStripSqlBlocks(finalText) || finalText || 'I couldn\'t find enough to answer that from the available data.';
      const withReply = [...(stellaMessagesRef.current || []), { role: 'assistant', content: cleaned, steps }];
      stellaMessagesRef.current = withReply;
      setStellaMessages(withReply);
      if (!skipHarvest && shouldHarvestChatMemory(cleaned, messageContent)) {
        await harvestChatMemory(cleaned, messageContent, recentChatTurnsForMemory(withReply), { thread: 'stella' });
      }
      if (!memoryPendingFor('stella')) {
        setTimeout(() => generateSuggestions(withReply, { thread: 'stella' }), 400);
      } else {
        setSuggestedPrompts([]);
      }
    } catch (error) {
      setStellaMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Error: Unable to process request.\n\n${error?.message || 'Unknown error'}` }]);
    } finally {
      setStellaIsLoading(false);
    }
  };

  const askPptxClarification = () => {
    const thread = pptxExportThread();
    setPptxClarifyPending(true);
    setPptxOffers(null);
    setToolsPptxPick(false);
    setSuggestedPrompts([]);
    appendPptxThreadMessage(thread, { role: 'assistant', content: getPptxClarify().prompt });
    revealChatTools();
  };

  const waitingForPptxChoice = useMemo(() => {
    if (activeTab === 'stella' || currentWorkflow || pptxGenerating) return false;
    return threadWaitingForPptx(messages);
  }, [messages, activeTab, pptxGenerating, currentWorkflow, productIntel]);

  const choiceButtons = useMemo(() => {
    if (isLoading || pptxGenerating) return null;
    if (memoryPendingFor('chat')) return null;
    if (pptxClarifyPending) return getPptxClarify().options;
    if (currentWorkflow?.awaitingAgentReply) return null;
    if (currentWorkflow || pendingWorkflow || orchestratorDecision) return null;
    const list = Array.isArray(messages) ? messages : [];
    const last = lastConversationalMessage(list);
    if (!last?.content || last.role === 'user') return null;
    if (hasNumberedClarifyingQuestions(last.content)) return null;
    if (/remembered facts|update memory/i.test(last.content)) return null;
    if (!isClosedChoicePrompt(last.content)) return null;
    return extractChoiceOptions(last.content);
  }, [messages, pptxClarifyPending, isLoading, pptxGenerating, currentWorkflow, pendingWorkflow, orchestratorDecision, pendingMemoryConfirm]);

  const clarifyingReplyHint = useMemo(() => {
    if (isLoading || pptxGenerating) return false;
    if (pendingWorkflow || orchestratorDecision || pptxClarifyPending || memoryPendingFor('chat')) return false;
    if (currentWorkflow && !currentWorkflow.awaitingAgentReply) return false;
    return unansweredNumberedClarify(messages);
  }, [messages, pptxClarifyPending, isLoading, pptxGenerating, currentWorkflow, pendingWorkflow, orchestratorDecision, pendingMemoryConfirm]);

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

  const matchTopicByConversationContext = async (messageContent) => {
    const active = (topics || []).filter((t) => t.status === 'active' && workflowAllowsContextTrigger(t));
    if (!active.length) return null;
    const recent = (messagesRef.current || [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'orchestrator'))
      .slice(-8)
      .map((m) => `${m.role}: ${String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 400)}`)
      .join('\n');
    if (!recent.trim()) return null;
    const workflowList = active.map((t) => (
      `- id: ${t.id}\n  name: ${t.name}\n  when: ${t.description || t.name}`
    )).join('\n');
    try {
      const raw = await callAnthropic(
        fillTemplate(getWorkflowRuntime().matchDetectorPrompt, { workflowList }),
        [{ role: 'user', content: `CURRENT USER MESSAGE:\n${messageContent}\n\nRECENT CONVERSATION:\n${recent}` }],
        250,
      );
      const parsed = extractJsonObject(raw);
      const rawId = String(parsed?.id || (!parsed ? raw : '') || '').trim().toLowerCase();
      const id = rawId.replace(/[^a-z0-9_-]/g, '').split(/\s+/)[0];
      if (!id || id === 'none') return null;
      const topic = active.find((t) => t.id === id);
      if (!topic || declinedWorkflowIdsRef.current.has(topic.id)) return null;
      const reason = String(parsed?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 240);
      return { topic, reason: reason || 'The conversation indicated this guided workflow.' };
    } catch {
      return null;
    }
  };

  const offerMatchedWorkflow = (topic, triggerRecord, triggerMessage) => {
    const workflowSummary = (topic.workflow || []).map((s, i) => `**Step ${i + 1}:** ${s.name}\n   _${s.goal}_`).join('\n\n');
    const runId = `wf_${Date.now().toString(36)}`;
    patchWorkflowRun({
      id: runId,
      topicId: topic.id,
      topicName: topic.name,
      status: 'offered',
      ...triggerRecord,
    });
    setMessages((prev) => [...prev, {
      role: 'assistant',
      content: fillTemplate(getWorkflowRuntime().offerTemplate, {
        description: topic.description,
        stepCount: topic.workflow.length,
        workflowSummary,
      }),
    }]);
    setPendingWorkflow({ topicId: topic.id, triggerMessage, runId });
    setIsLoading(false);
  };

  /** Route a user message using pptxContext.messageClassify from settings JSON (no hardcoded intent rules). */
  const classifyUserMessageIntent = async (messageContent) => {
    const text = String(messageContent || '').trim();
    if (!text) return { kind: 'none' };
    try {
      const pptxCtx = getPptxContext(productIntel);
      const raw = await callAnthropic(
        `${pptxCtx.messageClassify}${buildUserSettingsPromptBlock(userSettings, { moduleId: resolvePromptModule(), applyResponseLength: false })}`,
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

  const pptxOfferFromClarifyValue = (value) => {
    const m = String(value || '').toLowerCase().trim();
    const stella = pptxExportThread() === 'stella';
    if (/^(1|one)\b/.test(m) || /session summary/.test(m)) {
      return { mode: 'summary', offer: { title: 'Session Summary', description: 'Factual recap of this conversation' } };
    }
    if (/^(2|two)\b/.test(m) || /one-pager|one pager/.test(m)) {
      return {
        mode: 'produced',
        offer: stella
          ? { title: 'One-Pager', description: 'Short overview ready to share', deckType: 'one_pager', hasRealData: true }
          : { title: 'IC One-Pager', description: 'Simple one-page IC overview', deckType: 'ic_one_pager', hasRealData: true },
      };
    }
    if (/^(3|three)\b/.test(m) || /documentation|doc pack|full ic/.test(m)) {
      return {
        mode: 'produced',
        offer: stella
          ? { title: 'Documentation Pack', description: 'Full write-up from this conversation', deckType: 'doc_pack', hasRealData: true }
          : { title: 'IC Documentation Pack', description: 'Full IC documentation from this conversation', deckType: 'ic_doc_pack', hasRealData: true },
      };
    }
    return null;
  };

  const resolvePptxClarificationReply = async (messageContent) => {
    const mapped = pptxOfferFromClarifyValue(messageContent);
    if (mapped) return mapped;
    const classified = await classifyUserMessageIntent(messageContent);
    if (classified.kind === 'export' && classified.clear && classified.mode) {
      return { mode: classified.mode, offer: offerFromClassification(classified) };
    }
    return null;
  };

  const handleGeneratePptx = async (offer, mode = 'summary') => {
    const thread = pptxExportThread();
    const savedOffers = pptxOffers;
    setPptxOffers(null);
    setPptxClarifyPending(false);
    setToolsPptxPick(false);
    setPptxGenerating(true);

    const isSummary = mode === 'summary';
    const deckType = offer?.deckType || (isSummary ? 'session_summary' : 'general');
    const conversationContext = buildPptxConversationContext(pptxThreadMessages(thread));
    const pptxCtx = getPptxContext(productIntel);
    const systemPrompt = withUserSettings(isSummary ? pptxCtx.summary : pptxCtx.produced, { applyResponseLength: false });
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
          system: withUserSettings(getWorkflowRuntime().pptxRepairPrompt, { applyResponseLength: false }),
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

      if (thread !== 'stella') {
        const wantsOnePager = !isSummary || /incentive|scheme|component|weighting|payout|ic\b/i.test(conversationContext.slice(0, 6000));
        slideData = ensureIcOnePagerSlide(slideData, { force: wantsOnePager });
      }

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
      appendPptxThreadMessage(thread, {
        role: 'assistant',
        content: `📊 **PowerPoint generated** — "${slideData.title || offer?.title}" (${slides.length} slides${isSummary ? ', conversation summary' : `, ${deckType}`}). Check your downloads folder.`,
      });
    } catch (e) {
      console.error('PPTX generation error:', e);
      appendPptxThreadMessage(thread, {
        role: 'assistant',
        content: thread === 'stella'
          ? `⚠️ Could not generate the session summary: ${e.message || 'Unknown error'}. You can try **Session summary** in Tools again.`
          : `⚠️ Could not generate PowerPoint: ${e.message || 'Unknown error'}. You can try again, or tell me whether you want a **session summary**, **one-pager**, or **full documentation pack**.`,
      });
      if (savedOffers) setPptxOffers(savedOffers);
    } finally {
      setPptxGenerating(false);
    }
  };

  const startPptxExportFromUi = () => {
    setPptxOffers(null);
    setPptxClarifyPending(false);
    setToolsPptxPick(true);
    revealChatTools();
  };

  const handleTerritoryDataUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await ingestTerritoryTabularFile(file);
    } catch (err) {
      setTerritoryMapError(err.message || 'Upload failed');
    }
  };

  const handleTerritoryIntakeSend = async () => {
    const text = territoryIntakeInput.trim();
    if (!text || territoryIntakeBusy) return;
    const files = userSettingsRef.current.moduleContext?.territory?.files || [];
    const rec = files.find((f) => f.id === selectedTerritoryFileId) || files.find((f) => f.tableName);
    if (!rec || rec.processing) return;
    setTerritoryIntakeInput('');
    setTerritoryIntakeBusy(true);
    const nextMessages = [...(rec.intakeMessages || []), { role: 'user', content: text }];
    await patchTerritoryFile(rec.id, { intakeMessages: nextMessages });
    try {
      await runTerritoryIntakeTurn({ ...rec, intakeMessages: nextMessages });
    } finally {
      setTerritoryIntakeBusy(false);
    }
  };

  const territoryMapFiles = (userSettings.moduleContext?.territory?.files || []).filter(Boolean);
  const activeTerritoryFile = territoryMapFiles.find((f) => f.id === selectedTerritoryFileId)
    || territoryMapFiles.find((f) => f.tableName && !f.processing)
    || territoryMapFiles[0]
    || null;
  const territoryLayoutKey = activeTerritoryFile
    ? [
      activeTerritoryFile.id,
      activeTerritoryFile.tableName,
      activeTerritoryFile.mapLayout?.teamColumn,
      activeTerritoryFile.mapLayout?.territoryColumn,
      activeTerritoryFile.mapLayout?.geoColumn,
      activeTerritoryFile.mapLayout?.geoKind,
      activeTerritoryFile.mapLayout?.country,
    ].join('|')
    : '';

  useEffect(() => {
    const file = (userSettingsRef.current.moduleContext?.territory?.files || []).find((f) => f.id === activeTerritoryFile?.id);
    if (!file?.tableName || !file?.mapLayout?.geoColumn) {
      if (!file?.processing) setTerritoryMapPayload(null);
      return undefined;
    }
    if (file.id && !selectedTerritoryFileId) setSelectedTerritoryFileId(file.id);
    void loadTerritoryMapForFile(file, selectedTerritoryTeam);
    return () => { territoryMapAbortRef.current += 1; };
  }, [territoryLayoutKey, selectedTerritoryTeam]);

  const handleSubmit = async (e, overrideInput = null, isFileAnalysis = false) => {
    if (e) e.preventDefault();
    let messageContent = overrideInput || input.trim();
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
      setMessages((prev) => [...prev, { role: 'user', content: messageContent, kind: 'intake' }]);
      await continueProposalIntake(messageContent);
      return;
    }

    if ((pendingModuleContextIntakeRef.current || pendingModuleContextIntake) && !currentWorkflow) {
      const intake = pendingModuleContextIntakeRef.current || pendingModuleContextIntake;
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', content: messageContent, kind: 'intake' }]);
      await continueModuleContextIntake(intake.moduleId, intake.fileId, messageContent, { fromChat: true });
      return;
    }

    let skipPostUserMessage = false;
    let skipMemoryHarvest = skipMemoryHarvestRef.current;
    skipMemoryHarvestRef.current = false;
    const resumeAfterConfirm = memoryResumeRef.current;

    if (memoryPendingFor('chat') && !currentWorkflow) {
      const forcedCustom = memoryCustomForcedRef.current;
      memoryCustomForcedRef.current = false;
      if (isMemoryConfirmAccept(messageContent)) {
        setInput('');
        setMessages((prev) => {
          const next = [...prev, { role: 'user', content: messageContent }];
          messagesRef.current = next;
          return next;
        });
        await applyPendingMemoryDecision('accept');
        if (resumeAfterConfirm?.messageContent) {
          memoryResumeRef.current = null;
          skipPostUserMessage = true;
          skipMemoryHarvest = true;
          messageContent = resumeAfterConfirm.messageContent;
          isFileAnalysis = !!resumeAfterConfirm.isFileAnalysis;
        } else {
          setMessages((prev) => [...prev, { role: 'assistant', content: 'Updated. I’ll use the new fact going forward.' }]);
          setIsLoading(false);
          return;
        }
      } else if (isMemoryConfirmDecline(messageContent)) {
        setInput('');
        setMessages((prev) => {
          const next = [...prev, { role: 'user', content: messageContent }];
          messagesRef.current = next;
          return next;
        });
        await applyPendingMemoryDecision('decline');
        if (resumeAfterConfirm?.messageContent) {
          memoryResumeRef.current = null;
          skipPostUserMessage = true;
          skipMemoryHarvest = true;
          messageContent = resumeAfterConfirm.messageContent;
          isFileAnalysis = !!resumeAfterConfirm.isFileAnalysis;
        } else {
          setMessages((prev) => [...prev, { role: 'assistant', content: 'Kept the existing remembered fact. Thanks for confirming.' }]);
          setIsLoading(false);
          return;
        }
      } else if (forcedCustom || looksLikeMemoryCorrection(messageContent, { force: forcedCustom })) {
        setInput('');
        setMessages((prev) => {
          const next = [...prev, { role: 'user', content: messageContent }];
          messagesRef.current = next;
          return next;
        });
        await applyPendingMemoryDecision('custom', messageContent.trim());
        if (resumeAfterConfirm?.messageContent) {
          memoryResumeRef.current = null;
          skipPostUserMessage = true;
          skipMemoryHarvest = true;
          messageContent = resumeAfterConfirm.messageContent;
        } else {
          setMessages((prev) => [...prev, { role: 'assistant', content: `Updated memory to: ${messageContent.trim()}` }]);
          setIsLoading(false);
          return;
        }
      } else {
        setInput('');
        setMessages((prev) => {
          const next = [...prev, { role: 'user', content: messageContent }];
          messagesRef.current = next;
          return next;
        });
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: 'Please confirm the memory change first — **Yes**, **Keep existing**, or type the correct version.',
        }]);
        setIsLoading(false);
        return;
      }
    }

    setInput('');
    // Capture before clearing — needed to route Continue / typed replies correctly
    const pendingDecision = orchestratorDecision;
    setOrchestratorDecision(null);
    setPendingButtonAction(null);

    // Resolve pending PPT export clarification before normal chat routing.
    if (waitingForPptxChoice && !currentWorkflow) {
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
    if (!skipPostUserMessage) {
      setMessages((prev) => {
        const next = [...prev, { role: 'user', content: messageContent }];
        messagesRef.current = next;
        return next;
      });
    }
    setIsLoading(true);

    if (!skipMemoryHarvest && !currentWorkflow && shouldHarvestChatMemory('', messageContent)) {
      const priorAsk = [...(messagesRef.current || [])].reverse().find((m) => m.role === 'assistant' || m.role === 'orchestrator');
      const harvested = await harvestChatMemory(
        priorAsk?.content,
        messageContent,
        recentChatTurnsForMemory(messagesRef.current),
        { thread: 'chat' },
      );
      if (harvested?.conflict || memoryPendingFor('chat')) {
        memoryResumeRef.current = { messageContent, isFileAnalysis };
        setIsLoading(false);
        return;
      }
      skipMemoryHarvest = true;
    }

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
        await launchWorkflowDirect('analyze_ic', workflowMessage, null, 'file');
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

    const continueFreeform = async (extraInstruction = '') => {
      try {
        const fileContext = isFileAnalysis && uploadedFile ? `\n\nCONTEXT: The user has just uploaded a file named "${uploadedFile.name}" for assessment.` : '';
        const kb = buildKnowledgeBaseFromDocuments(documents, {
          access: knowledgeAccessLive(),
          role: 'general',
          hideNames: !isAdmin,
        });
        const systemPrompt = withUserSettings(customSystemPrompt
          .replace(
            'KNOWLEDGE BASE:\nYou have access to comprehensive best practices and the complete Pillar 2: Strategic Alignment & Principles framework.',
            kb
              ? (isAdmin
                ? `KNOWLEDGE BASE (loaded from intelligence files):\n${kb}`
                : `KNOWLEDGE BASE (best-practice guidance — never name source files):\n${kb}`)
              : 'KNOWLEDGE BASE:\nNo general best-practice files are marked yet. If THIS MODULE LIBRARY appears below, call get_file_context on a listed file before answering from it. Do not claim those files are missing.'
          )
          + fileContext
          + (extraInstruction ? `\n\n${extraInstruction}` : ''));

        const history = (messagesRef.current || []).filter((m) => m.role !== 'system').map((m) => ({ role: toAnthropicRole(m.role), content: m.content }));
        const alreadyLatest = history.length && history[history.length - 1]?.role === 'user'
          && String(history[history.length - 1]?.content || '') === messageContent;
        const convo = [
          ...history,
          ...(alreadyLatest ? [] : [{ role: 'user', content: messageContent }]),
        ];
        const assistantMessage = await callAnthropicMaybeStellaTools(
          systemPrompt,
          convo,
          scaleUserFacingMaxTokens(4000, userSettingsRef.current || userSettings),
          { maxRounds: 8 },
        );
        const withReply = [...(messagesRef.current || []), { role: 'assistant', content: assistantMessage }];
        setMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }]);
        setUploadedFile(null);
        if (!skipMemoryHarvest && shouldHarvestChatMemory(assistantMessage, messageContent)) {
          await harvestChatMemory(assistantMessage, messageContent, recentChatTurnsForMemory(withReply), { thread: 'chat' });
        }
        if (!memoryPendingFor('chat')) {
          setTimeout(() => generateSuggestions(withReply), 400);
        } else {
          setSuggestedPrompts([]);
        }
      } catch (error) {
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error: Unable to process request. Please try again.' }]);
      } finally {
        setIsLoading(false);
      }
    };

    const pendingId = pendingWorkflowId(pendingWorkflow);
    if (pendingId && !currentWorkflow) {
      const topic = topics.find((t) => t.id === pendingId);
      const triggerMessage = (typeof pendingWorkflow === 'object' && pendingWorkflow?.triggerMessage) || '';
      if (topic && isWorkflowAccept(messageContent)) {
        setPptxOffers(null);
        setCurrentWorkflow({ topicId: topic.id, currentStep: 0, context: [], waitingForUser: false });
        setPendingWorkflow(null);
        patchWorkflowRun({
          id: typeof pendingWorkflow === 'object' ? pendingWorkflow.runId : null,
          topicId: topic.id,
          topicName: topic.name,
          status: 'running',
        });
        await executeOrchestrator(topic, triggerMessage || messageContent, 0);
        return;
      }
      declinedWorkflowIdsRef.current.add(pendingId);
      patchWorkflowRun({
        id: typeof pendingWorkflow === 'object' ? pendingWorkflow.runId : null,
        topicId: pendingId,
        topicName: topic?.name,
        status: 'declined',
      });
      setPendingWorkflow(null);
      await continueFreeform(
        'The user declined (or continued past) a guided workflow offer. Answer their current message in the existing conversation. Do not restart from scratch, do not greet as if this is a new chat, and do not re-offer that workflow unless they explicitly ask to start it.',
      );
      return;
    }

    // PPT export only — never auto-launch an assessment/workflow from the classifier.
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
    }

    const keywordMatch = matchTopicByTriggers(topics, messageContent);
    if (keywordMatch?.topic && !currentWorkflow && !declinedWorkflowIdsRef.current.has(keywordMatch.topic.id)) {
      offerMatchedWorkflow(
        keywordMatch.topic,
        buildWorkflowTriggerRecord({
          trigger: 'keyword',
          phrase: keywordMatch.matchedKeywords.join(', '),
          message: messageContent,
        }),
        messageContent,
      );
      return;
    }

    if (!currentWorkflow) {
      const contextMatch = await matchTopicByConversationContext(messageContent);
      if (contextMatch?.topic && !declinedWorkflowIdsRef.current.has(contextMatch.topic.id)) {
        offerMatchedWorkflow(
          contextMatch.topic,
          buildWorkflowTriggerRecord({
            trigger: 'context',
            reason: contextMatch.reason,
            message: messageContent,
          }),
          messageContent,
        );
        return;
      }
    }

    await continueFreeform();
  };

  const openMemoryOther = () => {
    setMemoryCustomDraft(String(pendingMemoryConfirmRef.current?.proposed || memoryCustomDraft || '').trim());
    setMemoryCustomOpen(true);
    window.setTimeout(() => memoryCustomInputRef.current?.focus(), 50);
  };

  const submitMemoryChoice = (event, value) => {
    if (event?.preventDefault) event.preventDefault();
    const thread = pendingMemoryConfirmRef.current?.thread;
    if (thread === 'stella') {
      setStellaInput('');
      handleStellaChatSubmit(event, value);
    } else {
      setInput('');
      handleSubmit(event, value);
    }
  };

  const saveMemoryOther = (event) => {
    const text = String(memoryCustomDraft || '').trim();
    if (!text) return;
    memoryCustomForcedRef.current = true;
    submitMemoryChoice(event, text);
  };

  const renderMemoryConfirmActions = () => {
    if (!pendingMemoryConfirm) return null;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={(e) => submitMemoryChoice(e, 'Yes')}
            className="px-4 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-semibold rounded-lg transition-all"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={(e) => submitMemoryChoice(e, 'No')}
            className="px-4 py-2.5 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-all"
          >
            No
          </button>
          <button
            type="button"
            onClick={openMemoryOther}
            className={`px-4 py-2.5 font-semibold rounded-lg transition-all border ${memoryCustomOpen ? 'bg-cyan-500/25 border-cyan-300/60 text-cyan-50' : 'bg-slate-800 hover:bg-slate-700 border-cyan-400/35 text-cyan-100'}`}
          >
            Other
          </button>
        </div>
        {memoryCustomOpen && (
          <div className="bg-slate-900/60 border border-cyan-400/25 rounded-lg p-3 space-y-2">
            <label className="block text-[11px] text-cyan-200/80 font-semibold">Type the fact to remember</label>
            <textarea
              ref={memoryCustomInputRef}
              value={memoryCustomDraft}
              onChange={(e) => setMemoryCustomDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveMemoryOther(e);
                }
              }}
              rows={3}
              placeholder="e.g. Products are Tysabri and Innovex"
              className="w-full bg-slate-950/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-400 resize-y"
            />
            <button
              type="button"
              disabled={!String(memoryCustomDraft || '').trim()}
              onClick={saveMemoryOther}
              className="px-4 py-2 bg-cyan-500/25 hover:bg-cyan-500/40 border border-cyan-400/40 text-cyan-50 font-semibold rounded-lg text-sm disabled:opacity-40"
            >
              Save this version
            </button>
          </div>
        )}
      </div>
    );
  };

  const setHubAnswerDetail = (raw) => {
    void saveUserSettings({ responseLength: storedResponseLength(raw) });
  };

  const renderHubAnswerDetail = () => {
    const lengthLevel = getResponseLengthLevel(userSettings);
    return (
      <div className="bg-slate-900/40 border border-blue-400/20 rounded-xl p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="text-sm font-semibold text-white">Answer detail</div>
            <p className="text-xs mt-1 text-blue-300/60">
              Hub-wide default for this account — Incentive chat, workflows, Territory, and Stella. Executive = decide. Standard = recommend. Teaching = explain with why, impact, and an example. If a workflow step or agent specifies its own length (for example 300 words), that instruction is used instead.
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-bold text-cyan-300">{lengthLevel.label}</div>
            <div className="text-[10px] text-blue-300/50">{lengthLevel.value} of {RESPONSE_LENGTH_MAX}</div>
          </div>
        </div>
        <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1 w-full sm:w-fit mb-1">
          {RESPONSE_LENGTH_LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              onClick={() => setHubAnswerDetail(level.id)}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                level.value === lengthLevel.value
                  ? 'bg-blue-500 text-white shadow-lg'
                  : 'text-blue-300 hover:bg-slate-700/50'
              }`}
            >
              {level.label}
            </button>
          ))}
        </div>
        <input
          id="response-length"
          type="range"
          min={RESPONSE_LENGTH_MIN}
          max={RESPONSE_LENGTH_MAX}
          step={1}
          value={lengthLevel.value}
          onChange={(e) => setHubAnswerDetail(e.target.value)}
          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400 mt-3"
          aria-valuemin={RESPONSE_LENGTH_MIN}
          aria-valuemax={RESPONSE_LENGTH_MAX}
          aria-valuenow={lengthLevel.value}
          aria-valuetext={lengthLevel.label}
        />
        <div className="grid grid-cols-3 mt-2">
          {RESPONSE_LENGTH_LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              onClick={() => setHubAnswerDetail(level.id)}
              className={`text-[10px] sm:text-xs font-semibold ${
                level.value === 1 ? 'text-left' : level.value === 3 ? 'text-right' : 'text-center'
              } ${level.value === lengthLevel.value ? 'text-cyan-300' : 'text-blue-300/40 hover:text-blue-200/70'}`}
            >
              {level.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-blue-200/70 mt-3">{lengthLevel.hint}</p>
      </div>
    );
  };

  const renderSuggestedPrompts = (variant = 'composer', kind = 'incentives') => {
    const memKey = kind === 'stella' ? 'stella' : 'chat';
    const loading = kind === 'stella' ? stellaIsLoading : isLoading;
    const submitPrompt = kind === 'stella' ? handleStellaChatSubmit : handleSubmit;
    const show = suggestionsEnabled && suggestedPrompts.length > 0
      && !pendingWorkflow && !memoryPendingFor(memKey) && (kind === 'stella' || !currentWorkflow)
      && !pendingImageReview && !pendingProposalIntake && !pendingModuleContextIntake && !loading
      && (kind === 'stella' || (!choiceButtons?.length && !clarifyingReplyHint));
    if (!show) {
      if (variant === 'panel') {
        return <div className="text-[11px] text-blue-300/50 leading-relaxed">Next-step suggestions appear here after a reply.</div>;
      }
      return null;
    }
    const n = suggestedPrompts.length;
    if (variant === 'panel') {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300/70">
            <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
            Suggestions
            <span className="min-w-[1.1rem] h-4 px-1 rounded-full bg-cyan-400 text-slate-900 text-[10px] font-bold leading-4 text-center">{n}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {suggestedPrompts.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={(e) => { e.preventDefault(); setSuggestedPrompts([]); setMobileChatToolsOpen(false); submitPrompt(e, prompt); }}
                className="px-2.5 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 hover:border-blue-400/50 rounded-lg text-xs text-blue-200 hover:text-blue-100 transition-all text-left leading-snug"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="mb-2 w-full min-w-0">
        <button
          type="button"
          onClick={() => setSuggestionsOpen((open) => !open)}
          className="w-full flex items-center justify-between gap-2 px-3 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded-lg text-xs font-semibold text-blue-100"
          title={suggestionsOpen ? 'Hide suggestions' : `${n} suggested prompt${n === 1 ? '' : 's'}`}
          aria-expanded={suggestionsOpen}
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="relative inline-flex shrink-0">
              <Sparkles className="w-4 h-4 text-cyan-300" />
              <span className="absolute -top-1.5 -right-2 min-w-[1.1rem] h-4 px-0.5 rounded-full bg-cyan-400 text-slate-900 text-[10px] font-bold leading-4 text-center">
                {n}
              </span>
            </span>
            <span className="truncate">{suggestionsOpen ? 'Suggested next steps' : 'Suggestions'}</span>
          </span>
          {suggestionsOpen
            ? <Minimize2 className="w-4 h-4 text-blue-300/80 shrink-0" />
            : <ChevronDown className="w-4 h-4 text-blue-300/80 shrink-0" />}
        </button>
        {suggestionsOpen && (
          <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto custom-scrollbar mt-1.5">
            {suggestedPrompts.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={(e) => { e.preventDefault(); setSuggestedPrompts([]); handleSubmit(e, prompt); }}
                className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 hover:border-blue-400/50 rounded-lg text-xs text-blue-200 hover:text-blue-100 transition-all text-left"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white ${showLanding ? 'min-h-dvh' : 'h-dvh max-h-dvh overflow-hidden flex flex-col'}`}>
      {/* Header */}
      <header className="border-b border-blue-400/30 bg-slate-900/80 backdrop-blur-sm flex-shrink-0">
        <div className={`${showLanding ? 'max-w-7xl' : 'max-w-[96rem]'} mx-auto px-4 sm:px-6 ${showLanding ? 'py-3 sm:py-4' : 'py-1.5 sm:py-2'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={() => setShowLanding(true)} className={`${showLanding ? 'w-8 h-8 sm:w-10 sm:h-10' : 'w-8 h-8 sm:w-9 sm:h-9'} bg-gradient-to-br from-blue-400 to-cyan-400 rounded-lg flex items-center justify-center hover:opacity-80 transition-opacity`}>
                <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-slate-900" />
              </button>
              <div>
                <button onClick={() => setShowLanding(true)} className="text-left hover:opacity-80 transition-opacity">
                  <h1 className={`${showLanding ? 'text-lg sm:text-2xl' : 'text-base sm:text-xl'} font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent`}>Commercial Excellence Hub</h1>
                </button>
                {showLanding && <p className="text-xs text-blue-300/70 hidden sm:block">Field & Commercial Excellence Platform</p>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3">
              {!showLanding && (activeTab === 'chat' || activeTab === 'performance') && (
                <div className="flex gap-1 bg-slate-800/50 rounded-lg p-0.5 sm:p-1">
                  {[['chat', MessageSquare, 'Consultation'], ['performance', BarChart3, 'Performance']].map(([tab, Icon, label]) => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md transition-all text-xs sm:text-sm ${activeTab === tab ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}>
                      <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" /><span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                title="User settings"
                onClick={() => { setShowLanding(false); setActiveTab('user-settings'); }}
                className={`${showLanding ? 'h-11 sm:h-12' : 'h-9 sm:h-10'} px-2.5 sm:px-3 rounded-lg flex items-center justify-center gap-2 border transition-all ${!showLanding && activeTab === 'user-settings' ? 'bg-blue-500 border-blue-400 text-white' : 'bg-slate-800/60 border-blue-400/20 text-blue-200 hover:bg-slate-700/70 hover:border-blue-400/40'}`}
              >
                <UserCog className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="hidden sm:inline text-sm font-semibold">Settings</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  title="Admin"
                  onClick={() => { setShowLanding(false); setActiveTab('admin'); }}
                  className={`${showLanding ? 'h-11 sm:h-12 w-11 sm:w-12' : 'h-9 sm:h-10 w-9 sm:w-10'} rounded-lg flex items-center justify-center border transition-all ${!showLanding && activeTab === 'admin' ? 'bg-blue-500 border-blue-400 text-white' : 'bg-slate-800/60 border-blue-400/20 text-blue-200 hover:bg-slate-700/70 hover:border-blue-400/40'}`}
                >
                  <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              )}
              <div className="hidden md:flex flex-col items-end leading-tight ml-2 sm:ml-4 pl-3 sm:pl-4 border-l border-blue-400/25">
                <span className="text-xs font-semibold text-white max-w-[180px] truncate">{currentUser.name}</span>
                <span className="text-[10px] text-blue-300/60 max-w-[180px] truncate">{userSettings.companyName || resolveUserCompany(currentUser)}</span>
              </div>
              <button
                type="button"
                title="Sign out"
                onClick={handleSignOut}
                className={`${showLanding ? 'h-11 sm:h-12 w-11 sm:w-12' : 'h-9 sm:h-10 w-9 sm:w-10'} rounded-lg flex items-center justify-center border bg-slate-800/60 border-blue-400/20 text-blue-200 hover:bg-slate-700/70 hover:border-blue-400/40 transition-all`}
              >
                <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>
      <input ref={fileInputRef} type="file" accept=".pdf,.ppt,.pptx,.xlsx,.xls,.csv,.txt,.md" onChange={handleFileUpload} className="hidden" />
      <input
        ref={moduleContextFileInputRef}
        type="file"
        accept=".pdf,.ppt,.pptx,.xlsx,.xls,.csv,.txt,.md,.json"
        className="hidden"
        onChange={(e) => {
          const raw = e.target.getAttribute('data-module') || userSettingsPane || 'incentives';
          const id = ['incentives', 'territory', 'stella'].includes(raw) ? raw : 'incentives';
          handleModuleContextUpload(e, id);
        }}
      />

      {/* Landing Page */}
      {showLanding ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">Commercial Excellence Hub</h2>
            <p className="text-blue-300/70 text-lg max-w-2xl mx-auto">AI-powered tools for field and commercial excellence. Select a topic to get started.</p>
          </div>

          <div className="mb-8">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Active modules</h3>
                <p className="text-xs text-blue-300/55 mt-1">
                  Drag the link handle from one card onto another to share context (schemes, data summaries, strategy files). Links are saved for this account.
                </p>
              </div>
              {landingLinkNotice ? (
                <div className="text-xs font-semibold text-cyan-200 bg-cyan-500/10 border border-cyan-400/25 rounded-lg px-3 py-1.5">{landingLinkNotice}</div>
              ) : null}
            </div>
            <div ref={landingBoardRef} className="relative">
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible" aria-hidden="true">
                {(userSettings.moduleConnections || []).map((c) => {
                  const from = landingCardRects[c.a];
                  const to = landingCardRects[c.b];
                  if (!from || !to) return null;
                  return (
                    <g key={`${c.a}|${c.b}`}>
                      <line x1={from.cx} y1={from.cy} x2={to.cx} y2={to.cy} stroke="rgba(34,211,238,0.55)" strokeWidth="3" strokeLinecap="round" />
                      <circle cx={from.cx} cy={from.cy} r="4" fill="#22d3ee" />
                      <circle cx={to.cx} cy={to.cy} r="4" fill="#22d3ee" />
                    </g>
                  );
                })}
                {landingLinkDrag && landingCardRects[landingLinkDrag.fromId] ? (
                  <line
                    x1={landingCardRects[landingLinkDrag.fromId].cx}
                    y1={landingCardRects[landingLinkDrag.fromId].cy}
                    x2={landingLinkDrag.x}
                    y2={landingLinkDrag.y}
                    stroke="rgba(165,243,252,0.9)"
                    strokeWidth="2.5"
                    strokeDasharray="6 5"
                    strokeLinecap="round"
                  />
                ) : null}
              </svg>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 relative z-20">
                {ACTIVE_HUB_MODULES.map((mod) => {
                  const linked = connectedModuleIds(userSettings.moduleConnections, mod.id);
                  const dropTarget = landingLinkDrag && landingLinkDrag.fromId !== mod.id;
                  const Icon = mod.Icon;
                  return (
                    <div
                      key={mod.id}
                      ref={(el) => { landingCardRefs.current[mod.id] = el; }}
                      className={`relative text-left bg-slate-800/60 border rounded-2xl p-6 transition-all ${mod.ring} ${mod.shadow} ${dropTarget ? 'ring-2 ring-cyan-300/70' : ''}`}
                    >
                      <button
                        type="button"
                        title="Drag onto another module to share context"
                        onPointerDown={(e) => startLandingLinkDrag(e, mod.id)}
                        className="absolute top-3 right-3 z-30 p-2 rounded-lg bg-slate-900/70 border border-cyan-400/30 text-cyan-200 hover:bg-cyan-500/20 hover:border-cyan-300/60 cursor-grab active:cursor-grabbing touch-none select-none"
                      >
                        <Link2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openHubModule(mod.tab)}
                        className="text-left w-full group"
                      >
                        <div className={`w-12 h-12 ${mod.iconBg} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <h3 className="font-bold text-white text-base mb-1 pr-8">{mod.title}</h3>
                        <p className="text-xs text-blue-300/60 leading-relaxed">{mod.desc}</p>
                        <div className="mt-4 flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <span className="text-xs text-emerald-400">Active</span>
                        </div>
                      </button>
                      {linked.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {linked.map((id) => (
                            <button
                              key={id}
                              type="button"
                              title={`Stop sharing context with ${MODULE_CONTEXT_LABELS[id] || id}`}
                              onClick={() => persistModuleConnection(mod.id, id, { unlink: true })}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/15 text-cyan-200 border border-cyan-400/25 hover:bg-red-500/15 hover:text-red-200 hover:border-red-400/30"
                            >
                              Linked: {MODULE_CONTEXT_LABELS[id] || id}
                              <X className="w-3 h-3" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <h3 className="text-sm font-bold text-slate-400 mb-3">Coming soon</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[{ icon: BarChart3, label: 'Sales Performance', desc: 'Track and benchmark rep performance.' }, { icon: Target, label: 'Targeting & Segmentation', desc: 'Build and refine HCP target lists.' }, { icon: Users, label: 'Workforce Planning', desc: 'Model headcount and deployment.' }, { icon: Calendar, label: 'Business Planning', desc: 'Align field activity with strategy.' }, { icon: Award, label: 'Customer Engagement', desc: 'Design multi-channel engagement plans.' }, { icon: TrendingUp, label: 'Market Access', desc: 'Formulary positioning and payer strategy.' }].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="text-left bg-slate-800/30 border border-slate-700/40 rounded-2xl p-6 opacity-50 cursor-not-allowed">
                <div className="w-12 h-12 bg-slate-700/50 rounded-xl flex items-center justify-center mb-4"><Icon className="w-6 h-6 text-slate-500" /></div>
                <h3 className="font-bold text-slate-400 text-base mb-1">{label}</h3>
                <p className="text-xs text-slate-500/70 leading-relaxed">{desc}</p>
                <div className="mt-4 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-slate-600" /><span className="text-xs text-slate-500">Coming soon</span></div>
              </div>
            ))}
          </div>

          {chatIndexLoading && recentChats(chatSessions).length === 0 && (
            <div className="mt-10 text-sm text-blue-300/55">Loading recent chats…</div>
          )}
          {recentChats(chatSessions).length > 0 && (
            <div className="mt-10">
              <div className="flex items-center gap-2 mb-4">
                <History className="w-5 h-5 text-cyan-300" />
                <h3 className="text-lg font-semibold text-white">Recent chats</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {recentChats(chatSessions).map((chat) => {
                  const mod = chatModuleMeta(chat);
                  const opening = openingChatId === chat.id;
                  return (
                  <div
                    key={chat.id}
                    className="relative text-left bg-slate-800/50 hover:bg-slate-700/55 border border-blue-400/20 hover:border-blue-400/45 rounded-xl p-4 pl-5 transition-all group overflow-hidden"
                  >
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${mod.bar || 'bg-blue-400'}`} />
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" onClick={() => continueChat(chat.id)} disabled={!!openingChatId} className="min-w-0 text-left flex-1 disabled:opacity-70">
                        <div className="mb-1.5">{chatModuleBadge(mod)}</div>
                        <div className="text-sm font-semibold text-white truncate">{chat.title || 'Chat'}</div>
                        <div className="text-[11px] text-blue-300/60 mt-1">
                          {formatChatTime(chat.updatedAt)}
                          {(chat.currentWorkflow || chat.hasWorkflow) ? ' · Workflow in progress' : ''}
                          {chat.id === activeChatId ? ' · Current' : ''}
                        </div>
                        <div className="mt-3 text-xs text-cyan-300/80 font-semibold">{opening ? 'Opening…' : 'Continue →'}</div>
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
        <div className="flex-1 min-h-0 max-w-[96rem] mx-auto w-full px-3 sm:px-4 py-2 sm:py-3 overflow-hidden flex flex-col">
          <MessageErrorBoundary key={activeTab} fallback={
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md text-center bg-red-500/10 border border-red-400/25 rounded-xl p-6">
                <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
                <div className="text-sm font-semibold text-red-200 mb-1">Something went wrong rendering this view</div>
                <div className="text-xs text-red-300/70">Try switching tabs or reloading the page. Other areas of the app still work.</div>
              </div>
            </div>
          }>
          {activeTab === 'chat' ? (
            <div className="flex flex-col h-full min-h-0">
            {renderChatModuleBanner('incentives')}
            <div className="flex gap-3 flex-1 min-h-0">
              {renderChatHistorySidebar()}
              <div className="flex flex-col h-full min-w-0 flex-1 overflow-hidden">

              {/* Activity Log */}
              {activityLog.length > 0 && (
                <div className="bg-slate-800/50 border border-purple-400/30 rounded-xl mb-2 overflow-hidden flex-shrink-0">
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
                <div className="bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border border-blue-400/40 rounded-xl p-2.5 sm:p-3 mb-2 flex-shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-7 h-7 sm:w-9 sm:h-9 bg-blue-500 rounded-full flex items-center justify-center animate-pulse"><Target className="w-4 h-4 sm:w-5 sm:h-5 text-white" /></div>
                      <div>
                        <div className="text-[11px] sm:text-xs font-semibold text-blue-300">Workflow Active</div>
                        <div className="text-sm sm:text-base font-bold text-white leading-tight">{topics.find(t => t.id === currentWorkflow.topicId)?.name || 'Unknown'}</div>
                      </div>
                    </div>
                    <button type="button" onClick={handleCancelWorkflow} className="px-2 sm:px-3 py-1 sm:py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-400/50 text-red-300 rounded-lg transition-all text-xs font-semibold cursor-pointer hover:scale-105">
                      <span className="hidden sm:inline">✕ Cancel Workflow</span><span className="sm:hidden">✕</span>
                    </button>
                  </div>
                  <div className="space-y-1.5 mb-2">
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="text-blue-300 font-medium">Step {currentWorkflow.currentStep + 1} of {topics.find(t => t.id === currentWorkflow.topicId)?.workflow.length || 0}</span>
                      <span className="text-cyan-300 font-bold">{Math.round(((currentWorkflow.currentStep + 1) / (topics.find(t => t.id === currentWorkflow.topicId)?.workflow.length || 1)) * 100)}% Complete</span>
                    </div>
                    <div className="w-full bg-slate-700/50 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-gradient-to-r from-blue-500 to-cyan-500 h-full transition-all duration-500" style={{ width: `${((currentWorkflow.currentStep + 1) / (topics.find(t => t.id === currentWorkflow.topicId)?.workflow.length || 1)) * 100}%` }}></div>
                    </div>
                  </div>
                  <div className="hidden md:flex items-center gap-2 overflow-x-auto pb-1">
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
              <div className="flex-1 bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-3 sm:p-5 overflow-y-auto overflow-x-hidden space-y-4 custom-scrollbar mb-2 min-h-0">
                {messages.map((message, index) => (
                  <div key={index} className={`flex gap-3 min-w-0 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${message.role === 'user' ? 'bg-gradient-to-br from-cyan-400 to-blue-400' : message.role === 'system' ? 'bg-gradient-to-br from-yellow-400 to-orange-400' : message.role === 'orchestrator' ? 'bg-gradient-to-br from-purple-500 to-pink-500' : 'bg-gradient-to-br from-blue-400 to-purple-400'}`}>
                      {message.role === 'user' ? <Users className="w-5 h-5 text-slate-900" /> : message.role === 'system' ? <FileText className="w-5 h-5 text-slate-900" /> : message.role === 'orchestrator' ? <Target className="w-5 h-5 text-slate-900" /> : <TrendingUp className="w-5 h-5 text-slate-900" />}
                    </div>
                    <div className={`flex-1 min-w-0 ${message.role === 'user' ? 'text-right' : ''}`}>
                      <div className={`max-w-[85%] min-w-0 chat-fit px-4 py-3 rounded-2xl ${message.role === 'user' ? 'inline-block bg-gradient-to-br from-cyan-500 to-blue-500 text-white' : 'block w-full text-left'} ${message.role === 'system' ? 'bg-yellow-500/20 border border-yellow-400/30 text-yellow-200' : message.role === 'orchestrator' ? 'bg-purple-500/20 border border-purple-400/40 text-purple-200' : message.role === 'user' ? '' : 'bg-slate-700/50 border border-blue-400/20 text-blue-100'}`}>
                        <div className="text-sm leading-relaxed">
                          {message.role === 'user' ? <span className="whitespace-pre-wrap break-words">{message.content}</span> : formatMarkdown(message.content)}
                        </div>
                        {message.role === 'assistant' && Array.isArray(message.steps) && message.steps.length > 0 && renderStellaSteps(message.steps, message.kind === 'intake' ? 'How this was captured' : undefined)}
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
                        {index === messages.length - 1 && pendingWorkflow && /Would you like me to start this workflow|Reply \*\*"Yes"\*\* to use the guided workflow/i.test(message.content) && (
                          <div className="flex gap-2 mt-4">
                            <button onClick={(e) => { e.preventDefault(); setInput(''); handleSubmit(e, 'Yes'); }} className="flex-1 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-semibold rounded-lg transition-all">✅ Yes, Start Workflow</button>
                            <button onClick={(e) => { e.preventDefault(); setInput(''); handleSubmit(e, 'No'); }} className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-all">💬 No, keep talking</button>
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
                        {(() => {
                          const lastThink = [...messages].reverse().find((m) => m.kind === 'intake-think' || (m.role === 'system' && String(m.content || '').startsWith('⏳')));
                          return lastThink ? (
                            <div className="text-xs text-blue-200/80 mt-2">{String(lastThink.content).replace(/^⏳\s*/, '')}</div>
                          ) : null;
                        })()}
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
                  <div className="mb-3 px-3 py-2 bg-violet-900/30 border border-violet-400/30 rounded-xl flex items-center gap-3 text-sm text-violet-300 md:hidden">
                    <div className="w-4 h-4 border-2 border-violet-400/40 border-t-violet-400 rounded-full animate-spin flex-shrink-0" />
                    Generating PowerPoint…
                  </div>
                )}

                {clarifyingReplyHint && !isLoading && !pptxGenerating && (
                  <div className="mb-3 text-xs text-blue-300/70 bg-slate-800/40 border border-blue-400/20 rounded-lg px-3 py-2">
                    Reply with your answers by number, e.g. <span className="text-cyan-300 font-mono">1 = …</span>  <span className="text-cyan-300 font-mono">2 = …</span>
                  </div>
                )}

                {memoryPendingFor('chat') && !isLoading && !pptxGenerating && (
                  <div className="mb-3 p-3 bg-slate-800/70 border border-cyan-400/35 rounded-xl">
                    <div className="text-xs font-semibold text-cyan-200 mb-2">Confirm remembered fact</div>
                    {renderMemoryConfirmActions()}
                  </div>
                )}

                {choiceButtons && choiceButtons.length > 0 && !waitingForPptxChoice && !isLoading && !pptxGenerating && (
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

                <form onSubmit={handleSubmit} className="bg-slate-800/50 backdrop-blur-sm border border-blue-400/20 rounded-xl p-2 sm:p-3">
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <div className="flex-1">
                      <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }} placeholder="Describe your incentive scenario or ask a question..." className="w-full bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 sm:px-4 py-2 text-sm outline-none focus:border-blue-400 transition-colors resize-none" rows={2} disabled={isLoading} />
                    </div>
                    <div className="flex gap-2 sm:gap-3 sm:items-end">
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="flex-1 sm:flex-none px-3 sm:px-4 py-2 sm:py-2.5 bg-slate-700 hover:bg-slate-600 text-cyan-400 rounded-lg transition-all border border-cyan-400/30 hover:border-cyan-400/50" disabled={isLoading}><Upload className="w-5 h-5 mx-auto" /></button>
                      <button type="submit" onClick={(e) => { if (input.trim()) handleSubmit(e); }} disabled={isLoading || !input.trim()} className="flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"><Send className="w-5 h-5" /><span className="hidden sm:inline">Send</span></button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
            {renderChatToolsPanel('incentives')}
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
                  <div className="flex items-center gap-3"><MapIcon className="w-6 h-6" /><div><h2 className="text-xl font-bold">Territory Design</h2><p className="text-emerald-100 text-xs">Upload a territory file to see the structure on a map</p></div></div>
                  <button onClick={() => territoryFileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold transition-all"><Upload className="w-4 h-4" /> Upload territory file</button>
                  <input ref={territoryFileInputRef} type="file" accept=".xlsx,.xls,.csv,.json" onChange={handleTerritoryDataUpload} className="hidden" />
                </div>
              </div>

              {territoryMapFiles.length > 0 && (
                <div className="flex-shrink-0 mb-3 flex items-center gap-3 flex-wrap">
                  {territoryMapFiles.length > 1 && (
                    <>
                      <span className="text-xs text-blue-300/70 whitespace-nowrap">File:</span>
                      <div className="flex gap-2 flex-wrap">
                        {territoryMapFiles.map((s) => (
                          <button key={s.id} onClick={() => { setSelectedTerritoryFileId(s.id); setSelectedTerritory(null); setSelectedTerritoryTeam(''); setTerritoryMapPayload(null); }} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${activeTerritoryFile?.id === s.id ? 'bg-emerald-500/30 border-emerald-400/60 text-emerald-300' : 'bg-slate-800/50 border-blue-400/20 text-blue-300 hover:border-blue-400/40'}`}>{s.name}</button>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="flex gap-1 ml-auto">
                    <button onClick={() => setTerritoryView('map')} className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${territoryView === 'map' ? 'bg-blue-500/30 border-blue-400/60 text-blue-200' : 'bg-slate-800/50 border-slate-600 text-slate-400 hover:text-slate-300'}`}>🗺 Map</button>
                    <button onClick={() => setTerritoryView('list')} className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${territoryView === 'list' ? 'bg-blue-500/30 border-blue-400/60 text-blue-200' : 'bg-slate-800/50 border-slate-600 text-slate-400 hover:text-slate-300'}`}>☰ List</button>
                  </div>
                </div>
              )}

              {(() => {
                const teams = territoryMapPayload?.teams || [];
                const points = territoryMapPayload?.points || [];
                const mappedPoints = points.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
                const pendingIntake = !!(activeTerritoryFile && !activeTerritoryFile.processing && !activeTerritoryFile.intakeComplete);
                const grouped = [];
                const byTerr = new Map();
                for (const p of points) {
                  const key = p.territory || p.geo || p.id;
                  const prev = byTerr.get(key);
                  if (prev) {
                    prev.count += Number(p.count) || 0;
                    if (p.geo && !prev.geos.includes(p.geo)) prev.geos.push(p.geo);
                  } else {
                    byTerr.set(key, { id: p.id, territory: key, team: p.team, count: Number(p.count) || 0, geos: p.geo ? [p.geo] : [], lat: p.lat, lng: p.lng });
                  }
                }
                grouped.push(...byTerr.values());
                if (!activeTerritoryFile) {
                  return (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-center max-w-md">
                        <MapPin className="w-10 h-10 text-emerald-400/70 mx-auto mb-3" />
                        <div className="text-white font-semibold mb-1">No territory file loaded</div>
                        <p className="text-sm text-blue-300/60 mb-4">Upload an Excel or CSV with team, territory, and geography columns (postcode/zip, city, or region). We will store the rows, geocode them, and draw the structure on the map.</p>
                        {territoryMapError && <p className="text-sm text-rose-300 mb-4">{territoryMapError}</p>}
                        <button onClick={() => territoryFileInputRef.current?.click()} className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 rounded-lg text-sm text-emerald-200 font-semibold">Upload Excel / CSV</button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="flex-1 overflow-hidden flex flex-col gap-3 min-h-0">
                    {teams.length > 0 && (
                      <div className="flex-shrink-0 flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-blue-300/70 whitespace-nowrap">Team:</span>
                        {teams.map((team) => (
                          <button key={team} onClick={() => { setSelectedTerritoryTeam(team); setSelectedTerritory(null); }} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${selectedTerritoryTeam === team ? 'bg-emerald-500/30 border-emerald-400/60 text-emerald-300' : 'bg-slate-800/50 border-blue-400/20 text-blue-300 hover:border-blue-400/40'}`}>{team}</button>
                        ))}
                      </div>
                    )}
                    <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
                    <div className={`overflow-y-auto custom-scrollbar ${selectedTerritory ? 'w-1/2' : 'w-full'} transition-all`}>
                      {territoryView === 'map' ? (
                        <div className="bg-slate-800/40 border border-blue-400/20 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                            <span className="text-xs text-blue-300/70 font-semibold">{activeTerritoryFile.name}{activeTerritoryFile.rowCount != null ? ` — ${activeTerritoryFile.rowCount} rows` : ''}</span>
                            <span className="text-xs text-blue-300/40">
                              {territoryMapBusy || territoryMapPayload?.pending
                                ? `Geocoding… ${mappedPoints.length} placed${territoryMapPayload?.pending ? `, ${territoryMapPayload.pending} remaining` : ''}`
                                : `${mappedPoints.length} locations · Click a marker to inspect`}
                            </span>
                          </div>
                          {territoryMapError && <div className="text-xs text-rose-300 mb-2">{territoryMapError}</div>}
                          {mappedPoints.length ? (
                            <TerritoryMap points={mappedPoints} selectedTerritory={selectedTerritory} onSelectTerritory={setSelectedTerritory} />
                          ) : (
                            <div className="h-[320px] flex items-center justify-center text-sm text-blue-300/50">
                              {activeTerritoryFile.processing || territoryMapBusy ? 'Loading territory points…' : (activeTerritoryFile.mapLayout?.geoColumn ? 'Waiting for geocoded locations…' : 'Confirm the geography column in intake below to draw the map.')}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {grouped.map((t) => {
                            const colour = hashTerritoryColour(t.territory).colour;
                            return (
                              <div key={t.id || t.territory} onClick={() => setSelectedTerritory(selectedTerritory?.id === t.id ? null : t)} className={`bg-slate-800/40 border border-blue-400/20 rounded-xl px-4 py-2.5 cursor-pointer transition-all flex items-center gap-3 ${selectedTerritory?.id === t.id ? 'bg-blue-500/10' : 'hover:bg-slate-700/30'}`}>
                                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: colour }} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm text-white truncate">{t.territory}</div>
                                  <div className="text-xs text-blue-300/50 truncate">{t.geos.slice(0, 4).join(', ')}{t.geos.length > 4 ? '…' : ''}</div>
                                </div>
                                <span className="text-xs text-white font-bold">{t.count}</span>
                              </div>
                            );
                          })}
                          {!grouped.length && <div className="text-sm text-blue-300/50 py-8 text-center">No territory rows in this team yet.</div>}
                        </div>
                      )}
                    </div>

                    {selectedTerritory && (
                      <div className="w-1/2 overflow-y-auto custom-scrollbar">
                        <div className="bg-slate-800/60 border border-blue-400/30 rounded-xl p-4 space-y-4">
                          <div className="flex items-start justify-between">
                            <div>
                              {selectedTerritory.team && <div className="text-xs text-emerald-300 mb-1">{selectedTerritory.team}</div>}
                              <h3 className="text-lg font-bold text-white">{selectedTerritory.territory || selectedTerritory.id}</h3>
                              {selectedTerritory.geo && <p className="text-sm text-blue-300/70">{selectedTerritory.geo}</p>}
                            </div>
                            <button onClick={() => setSelectedTerritory(null)} className="text-slate-500 hover:text-slate-300 transition-all flex-shrink-0"><X className="w-4 h-4" /></button>
                          </div>
                          <div className="flex justify-between text-xs pt-2 border-t border-slate-700/50">
                            <span className="text-blue-300/60">Rows</span>
                            <span className="text-white font-bold">{selectedTerritory.count ?? (selectedTerritory.geos ? grouped.find((g) => g.id === selectedTerritory.id)?.count : '—')}</span>
                          </div>
                          {(selectedTerritory.geos || []).length > 0 && (
                            <div>
                              <div className="text-xs text-blue-300/60 mb-2 font-semibold uppercase tracking-wide">Geo keys</div>
                              <div className="flex flex-wrap gap-1">{selectedTerritory.geos.map((c) => (<span key={c} className="text-xs bg-slate-700/60 text-blue-200/70 px-2 py-0.5 rounded-full">{c}</span>))}</div>
                            </div>
                          )}
                          <button onClick={() => {
                            const focusedContext = formatTerritoryAssessContext({
                              file: activeTerritoryFile,
                              team: selectedTerritoryTeam,
                              territory: selectedTerritory,
                              points,
                            });
                            setActiveTab('chat');
                            setTimeout(() => launchWorkflowDirect('territory_assessment', `Assess territory ${selectedTerritory.territory || selectedTerritory.id}`, focusedContext), 100);
                          }} className="w-full py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 rounded-lg text-sm text-emerald-300 font-semibold transition-all">🔍 Assess this territory →</button>
                        </div>
                      </div>
                    )}
                    </div>

                    {pendingIntake && (
                      <div className="flex-shrink-0 bg-slate-800/50 border border-emerald-400/25 rounded-xl p-3">
                        <div className="text-[10px] uppercase tracking-wide text-emerald-300/80 font-semibold mb-2">Territory intake</div>
                        <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-2 mb-2">
                          {(activeTerritoryFile.intakeMessages || []).slice(-6).map((m, i) => (
                            <div key={i} className={`text-xs ${m.role === 'user' ? 'text-cyan-200' : 'text-blue-100'}`}>
                              {m.role === 'user' ? <span className="whitespace-pre-wrap">{m.content}</span> : <MessageErrorBoundary>{formatMarkdown(m.content)}</MessageErrorBoundary>}
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <textarea value={territoryIntakeInput} onChange={(e) => setTerritoryIntakeInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTerritoryIntakeSend(); } }} placeholder="Answer the intake questions…" className="flex-1 bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none" rows={2} />
                          <button onClick={handleTerritoryIntakeSend} disabled={!territoryIntakeInput.trim() || territoryIntakeBusy} className="px-4 py-2 bg-emerald-500/30 hover:bg-emerald-500/40 disabled:opacity-40 text-white font-semibold rounded-lg text-sm">Send</button>
                        </div>
                      </div>
                    )}
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
            <div className="flex flex-col h-full min-h-0">
            {renderChatModuleBanner('stella')}
            <div className="flex gap-3 flex-1 min-h-0">
              {renderChatHistorySidebar()}
              <div className="flex flex-col h-full min-w-0 flex-1 overflow-hidden">

              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-3 sm:p-5 overflow-y-auto overflow-x-hidden space-y-4 custom-scrollbar mb-2 min-h-0">
                  {stellaMessages.map((message, index) => (
                    <div key={index} className={`flex gap-3 min-w-0 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${message.role === 'user' ? 'bg-gradient-to-br from-cyan-400 to-blue-400' : message.role === 'system' ? 'bg-gradient-to-br from-yellow-400 to-orange-400' : 'bg-gradient-to-br from-blue-400 to-purple-400'}`}>
                        {message.role === 'user' ? <Users className="w-5 h-5 text-slate-900" /> : message.role === 'system' ? <FileText className="w-5 h-5 text-slate-900" /> : <Layers className="w-5 h-5 text-slate-900" />}
                      </div>
                      <div className={`flex-1 min-w-0 ${message.role === 'user' ? 'text-right' : ''}`}>
                        <div className={`max-w-[85%] min-w-0 chat-fit px-4 py-3 rounded-2xl ${message.role === 'user' ? 'inline-block bg-gradient-to-br from-cyan-500 to-blue-500 text-white' : 'block w-full text-left'} ${message.role === 'system' ? 'bg-yellow-500/20 border border-yellow-400/30 text-yellow-200' : message.role === 'user' ? '' : 'bg-slate-700/50 border border-blue-400/20 text-blue-100'}`}>
                          <div className="text-sm leading-relaxed">
                            {message.role === 'user' ? <span className="whitespace-pre-wrap break-words">{message.content}</span> : <MessageErrorBoundary>{formatMarkdown(message.content)}</MessageErrorBoundary>}
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

                {memoryPendingFor('stella') && !stellaIsLoading && (
                  <div className="mb-3 p-3 bg-slate-800/70 border border-cyan-400/35 rounded-xl">
                    <div className="text-xs font-semibold text-cyan-200 mb-2">Confirm remembered fact</div>
                    {renderMemoryConfirmActions()}
                  </div>
                )}
                {pptxGenerating && (
                  <div className="mb-3 px-3 py-2 bg-violet-900/30 border border-violet-400/30 rounded-xl flex items-center gap-3 text-sm text-violet-300 md:hidden">
                    <div className="w-4 h-4 border-2 border-violet-400/40 border-t-violet-400 rounded-full animate-spin flex-shrink-0" />
                    Generating PowerPoint…
                  </div>
                )}
                <form onSubmit={handleStellaChatSubmit} className="bg-slate-800/50 backdrop-blur-sm border border-blue-400/20 rounded-xl p-2 sm:p-3">
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <div className="flex-1">
                      <textarea
                        value={stellaInput}
                        onChange={(e) => setStellaInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleStellaChatSubmit(e); } }}
                        placeholder="Ask a question about your uploaded datasets…"
                        className="w-full bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 sm:px-4 py-2 text-sm outline-none focus:border-blue-400 transition-colors resize-none"
                        rows={2}
                        disabled={stellaIsLoading || pptxGenerating}
                      />
                    </div>
                    <div className="flex gap-2 sm:gap-3 sm:items-end">
                      <button type="submit" disabled={stellaIsLoading || pptxGenerating || !stellaInput.trim()} className="flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"><Send className="w-5 h-5" /><span className="hidden sm:inline">Send</span></button>
                    </div>
                  </div>
                </form>
              </div>
              </div>
              {renderChatToolsPanel('stella')}
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
                    <div>{resolveUserCompany(currentUser)}</div>
                    <div className="font-mono text-blue-200/70">userId: {currentUser.id}</div>
                  </div>
                </div>
              </div>

              {renderHubAnswerDetail()}

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1 w-fit flex-wrap">
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
                <button
                  type="button"
                  onClick={() => setUserSettingsPane('context-map')}
                  className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-all border ${userSettingsPane === 'context-map' ? 'bg-amber-500 text-slate-900 border-amber-300 shadow-lg shadow-amber-500/20' : 'bg-amber-500/15 text-amber-200 border-amber-400/40 hover:bg-amber-500/25'}`}
                >
                  Context Map
                </button>
              </div>

              <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-5 sm:p-6">
                {userSettingsPane === 'general' && (
                  <>
                    <p className="text-xs text-blue-300/70 mb-5">
                      Company, industry, metrics, and terminology here apply across Incentive Comp, Territory, and Stella — not duplicated per tool. Link modules on the home page to share that tool’s files and data summaries between them.
                      {' '}The <span className="text-cyan-200 font-semibold">Context Map</span> tab shows everything captured and how it connects.
                      {' '}Account company <span className="text-cyan-200 font-semibold">{resolveUserCompany(currentUser)}</span> isolates this user’s files under
                      {' '}<code className="text-cyan-300/80">{userSettingsRemotePath(currentUser)}</code>.
                      {' '}Chat history is <code className="text-cyan-300/80">{userChatsRemotePath(currentUser)}</code>.
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
                        <div className="flex items-baseline justify-between gap-3 mb-2">
                          <label className="block text-xs text-blue-300/70 font-semibold">Remembered from chats</label>
                          {(() => {
                            const usage = memoryUsage(userSettings.memory);
                            return (
                              <span className={`text-[10px] whitespace-nowrap ${userSettings.memoryEnabled === false ? 'text-blue-300/30' : 'text-blue-300/50'}`}>
                                {usage.used} of {usage.cap} · {usage.pctLabel} full
                              </span>
                            );
                          })()}
                        </div>
                        <div className={`h-1 rounded-full bg-slate-800 overflow-hidden mb-3 ${userSettings.memoryEnabled === false ? 'opacity-40 grayscale' : ''}`}>
                          <div
                            className="h-full bg-cyan-400/70 rounded-full transition-all"
                            style={{ width: `${Math.min(100, memoryUsage(userSettings.memory).pct)}%` }}
                          />
                        </div>
                        <label className="flex items-start gap-2 mb-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={userSettings.memoryEnabled !== false}
                            onChange={(e) => saveUserSettings({ memoryEnabled: e.target.checked })}
                            className="rounded border-blue-400/40 mt-0.5"
                          />
                          <span className="text-[11px] text-blue-300/70 leading-relaxed">
                            Remember key facts from my chats (products, competitors, territories, definitions, and anything I ask to remember). When this is off, facts are kept but not sent to the AI.
                          </span>
                        </label>
                          <p className="text-[11px] text-blue-300/45 mb-2">
                            Saved only on this account in settings.json. File intake answers, joins, and column notes stay on the file — they are not added here. Facts are tagged by the module you were in. Another module only receives them if you link the two on the home page. If a new fact contradicts one already remembered, the assistant will ask before updating and can mark the old fact as obsolete.
                          </p>
                        {userSettings.memoryEnabled === false && (
                          <div className="text-xs text-amber-200/70 border border-amber-400/20 rounded-lg px-3 py-2 mb-2">
                            Chat memory is off — existing facts are not passed as context.
                          </div>
                        )}
                        <div className={userSettings.memoryEnabled === false ? 'opacity-40 grayscale' : ''}>
                        {(userSettings.memory || []).length === 0 ? (
                          <div className="text-xs text-blue-300/40 border border-blue-400/15 rounded-lg px-3 py-2">Nothing remembered yet. Key facts from conversations appear here automatically. File intake stays on the file.</div>
                        ) : (
                          <ul className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                            {(userSettings.memory || []).map((item) => {
                              const reason = describeObsoleteReason(item, userSettings.memory);
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
                                    {item.module ? ` · ${MODULE_CONTEXT_LABELS[item.module] || item.module}` : ''}
                                    {item.status === 'obsolete' && item.obsoleteAt ? ` · Obsolete ${formatMemoryStamp(item.obsoleteAt)}` : ''}
                                  </span>
                                  {item.status === 'obsolete' && reason ? (
                                    <span className="block text-[10px] text-amber-200/75 mt-0.5">{reason}</span>
                                  ) : null}
                                </span>
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
                              );
                            })}
                          </ul>
                        )}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {userSettingsPane === 'context-map' && (
                  <MessageErrorBoundary
                    fallback={
                      <div className="bg-red-500/10 border border-red-400/25 rounded-xl p-4">
                        <div className="text-sm font-semibold text-red-200 mb-1">Context map could not render</div>
                        <div className="text-xs text-red-300/70">The rest of User Settings still works. Try General or reload.</div>
                      </div>
                    }
                  >
                    <ContextMap
                      hubModules={ACTIVE_HUB_MODULES}
                      userSettings={userSettings}
                      stellaDataFiles={stellaDataFiles}
                      userName={currentUser.name}
                      companyName={userSettings.companyName || resolveUserCompany(currentUser)}
                      layout={userSettings.contextMapLayout}
                      onLayoutChange={(next) => {
                        const settings = mergeUserSettingsFields({ ...userSettingsRef.current, contextMapLayout: next });
                        setUserSettings(settings);
                        userSettingsRef.current = settings;
                        void queueUserSettingsUpload(currentUser, () => buildUserSettingsDocument(
                          currentUser.id,
                          mergeUserSettingsFields(userSettingsRef.current),
                          { userName: currentUser.name },
                        ));
                      }}
                      onOpenPane={(pane, extra) => {
                        setUserSettingsPane(pane);
                        if (pane === 'stella' && extra?.stellaTab) setStellaSettingsTab(extra.stellaTab);
                      }}
                    />
                  </MessageErrorBoundary>
                )}

                {userSettingsPane === 'incentives' && (
                  <>
                    <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">📊 PowerPoint template</h3>
                    <p className="text-xs text-blue-300/60 mb-4">
                      Used when exporting PowerPoint from Incentive Compensation and Territory chats, and for Stella session summaries. Upload a branded .pptx — exports keep its slide size, title style, colours, and logos. Title slides and content slides are captured separately so the corporate identity is preserved. Without a file, ComEx uses the default navy / cyan look. Stored at{' '}
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
                              {userSettings.pptxTemplate?.theme?.capturedLayouts && (
                                <span className="text-[10px] text-cyan-300/80 font-semibold">
                                  Layouts: {userSettings.pptxTemplate.theme.capturedLayouts.title ? 'title' : '—'}
                                  {' + '}
                                  {userSettings.pptxTemplate.theme.capturedLayouts.content ? 'content' : '—'}
                                </span>
                              )}
                              {meta && (
                                <span className="text-[10px] text-cyan-300/80 font-semibold">
                                  {meta.hasTitleSlot ? 'title slot · ' : ''}{userSettings.pptxTemplate?.theme?.logoCount || meta.pictureCount || 0} logo(s) · {meta.chromeShapeCount || 0} chrome
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
                        <div className="text-xs text-blue-300/60">No template uploaded — exports use the default ComEx look (widescreen, navy title slides, light content, Calibri, cyan accent).</div>
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
                    <p className="text-xs text-blue-300/70 mb-4">
                      Files and connectors for this account. Company, industry, metrics, and terminology are under <span className="text-cyan-300 font-semibold">General</span>.
                    </p>
                    <div className="flex gap-1 bg-slate-900/50 rounded-lg p-1 w-fit mb-5">
                      {[['connections', 'Connections'], ['goals', 'Analysis goals']].map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setStellaSettingsTab(id)}
                          className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-all ${stellaSettingsTab === id ? 'bg-cyan-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <MessageErrorBoundary
                      key={stellaSettingsTab}
                      fallback={
                        <div className="bg-red-500/10 border border-red-400/25 rounded-xl p-4">
                          <div className="text-sm font-semibold text-red-200 mb-1">Stella Insights could not render</div>
                          <div className="text-xs text-red-300/70">The rest of User Settings still works. Try Analysis goals, or reload.</div>
                        </div>
                      }
                    >
                      {stellaSettingsTab === 'goals' && (
                        <StellaSafePanel render={() => (
                          <>
                            {renderStellaBusinessPanel()}
                            <p className="text-xs text-blue-300/70 mt-6 mb-2">
                              Optional background notes used as guidance in Stella. Dataset files live under Connections → Files.
                            </p>
                            {renderModuleContextPanel('stella')}
                          </>
                        )} />
                      )}
                      {stellaSettingsTab === 'connections' && (
                        <StellaSafePanel render={renderStellaConnectionsPanel} />
                      )}
                    </MessageErrorBoundary>
                  </>
                )}

                {!['stella', 'context-map'].includes(userSettingsPane) && (
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
                      setStellaBusinessContext(mergeStellaBusinessContext({}));
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
                )}
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
                      Knowledge is <span className="text-cyan-300 font-semibold">not hardcoded</span>. Files in the Supabase <code className="text-cyan-300/80">intelligence</code> bucket are loaded on every visit.
                    </p>
                    <p className="text-xs text-blue-300/50 mb-2">
                      <span className="text-cyan-200/90 font-semibold">General Context</span> is injected into Incentive chat, and into other modules when they are linked to Incentives on the home page.
                      {' '}<span className="text-cyan-200/90 font-semibold">Agents</span> makes the file available to assign to workflow specialists.
                      {' '}These flags are stored in shared <code className="text-cyan-300/80">product.json</code>, not in user settings.
                    </p>
                    <p className="text-xs text-blue-300/50 mb-6">
                      Status: {knowledgeLoadStatus === 'loading' ? 'Loading…' : knowledgeLoadStatus === 'ready' ? `${documents.length} file(s) loaded` : knowledgeLoadStatus === 'error' ? 'Storage error (tried public seed fallback)' : 'Idle'}
                      {userSettingsSaveStatus === 'saved' && <span className="text-emerald-300/80 ml-2">product.json updated.</span>}
                      {userSettingsSaveStatus === 'saved-local' && <span className="text-amber-300/80 ml-2">Saved locally — cloud write failed.</span>}
                    </p>
                    <div className="space-y-3 mb-6">
                      {documents.length === 0 && (
                        <div className="text-xs text-amber-300/80 bg-amber-500/10 border border-amber-400/20 rounded-lg p-3">
                          No knowledge files loaded yet. Upload .md / .txt / .yml files below (seed files: {KNOWLEDGE_SEED_FILES.join(', ')}).
                        </div>
                      )}
                      {documents.map(doc => {
                        const flags = knowledgeFileFlags(knowledgeAccessLive(), doc.name);
                        return (
                        <div key={doc.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-700/30 border border-blue-400/20 rounded-lg p-4 hover:border-blue-400/40 transition-all">
                          <div className="flex items-center gap-3 min-w-0">
                            <FileText className="w-5 h-5 text-blue-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{doc.name}</div>
                              <div className="text-xs text-blue-300/50">{doc.size} • {doc.status}{doc.type === 'yaml' && <span className="ml-2 px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded text-xs">YAML</span>}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={flags.generalContext}
                                onChange={(e) => setKnowledgeFileFlag(doc.name, 'generalContext', e.target.checked)}
                                className="rounded border-blue-400/40"
                              />
                              General Context
                            </label>
                            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={flags.agents}
                                onChange={(e) => setKnowledgeFileFlag(doc.name, 'agents', e.target.checked)}
                                className="rounded border-blue-400/40"
                              />
                              Agents
                            </label>
                            <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded border border-green-400/30 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Active</span>
                            <button onClick={() => removeDocument(doc.id)} className="p-2 hover:bg-red-500/20 rounded transition-colors text-red-400"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                        );
                      })}
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
                          <div><div className="font-semibold text-purple-300">{agent.name}</div><div className="text-xs text-blue-300/60 mt-1">{agent.role}</div>
                            {(agent.tools || []).length > 0 && (
                              <div className="text-[10px] text-cyan-300/50 mt-1">Tools: {(agent.tools || []).join(', ')}</div>
                            )}
                          </div>
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
                <div className="flex flex-col min-h-0 h-[calc(100vh-11rem)]">
                <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6 flex flex-col min-h-0 flex-1 overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <h2 className="text-xl font-bold flex items-center gap-2"><Target className="w-6 h-6 text-cyan-400" />Workflows</h2>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={openManualNewWorkflow}
                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-700/50 hover:bg-slate-700 text-blue-100 border border-blue-400/25 flex items-center gap-1.5"
                      >
                        <Plus className="w-4 h-4" /> New Workflow
                      </button>
                      <button
                        type="button"
                        onClick={() => openWorkflowBuilder('create')}
                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/30 flex items-center gap-1.5"
                      >
                        <Sparkles className="w-4 h-4" /> New Workflow
                      </button>
                    </div>
                  </div>
                {wfBuilderOpen && (
                <div ref={wfBuilderPanelRef} className="mb-4 bg-slate-950/40 border border-cyan-400/25 rounded-xl p-4 flex flex-col h-[min(28rem,46vh)] min-h-[16rem] shrink-0">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3 shrink-0">
                    <div>
                      <h3 className="text-base font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-cyan-400" />Workflow agent</h3>
                      <p className="text-xs text-blue-300/55 mt-1">
                        {wfBuilderIntent === 'edit'
                          ? `Editing ${topics.find((t) => t.id === wfBuilderFocusId)?.name || 'this workflow'} — full current JSON (including trigger mode, keywords, and context) is passed to the agent.`
                          : 'Creating a new workflow. The agent will ask whether chat should start it from keywords only, conversation context only, or both.'}
                      </p>
                    </div>
                    <button type="button" onClick={closeWorkflowBuilder} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-700/50 hover:bg-slate-700 text-blue-200 border border-blue-400/20">Close</button>
                  </div>
                  <div ref={wfBuilderChatRef} className="bg-slate-950/50 border border-blue-400/20 rounded-lg p-3 flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar space-y-3">
                    {wfBuilderMessages.map((m, i) => (
                      <div key={i} className={`text-sm min-w-0 ${m.role === 'user' ? 'text-right' : ''}`}>
                        <div className={`max-w-[95%] min-w-0 chat-fit rounded-lg px-3 py-2 ${m.role === 'user' ? 'inline-block bg-cyan-500/20 text-cyan-50 text-left' : 'block w-full bg-slate-800/80 text-blue-100'}`}>
                          {m.role === 'user' ? <span className="whitespace-pre-wrap break-words">{m.content}</span> : formatMarkdown(m.content)}
                          {m.role === 'assistant' && m.reasoning && (
                            <div className="mt-2 border-t border-blue-400/15 pt-2 text-left">
                              <div className="text-[11px] font-semibold text-cyan-300/80">Reasoning</div>
                              <div className="mt-1 whitespace-pre-wrap text-[11px] text-blue-200/65 leading-relaxed max-h-32 overflow-y-auto custom-scrollbar">{m.reasoning}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {wfBuilderLoading && (
                      <div className="text-xs text-cyan-300/80 bg-slate-800/60 border border-cyan-400/15 rounded-lg px-3 py-2">
                        <div className="font-semibold">Workflow agent is thinking…</div>
                        {wfBuilderThinking ? (
                          <div className="mt-1.5 whitespace-pre-wrap text-blue-200/70 leading-relaxed">{excerptForSuggestions(wfBuilderThinking, 900)}</div>
                        ) : (
                          <div className="mt-1 text-blue-300/50">Reading the workflow, triggers, steps, and assigned agents…</div>
                        )}
                      </div>
                    )}
                    {wfBuilderDraft && (wfBuilderDraft.workflow || (wfBuilderDraft.newAgents || []).length) && (
                      <div className="bg-slate-900/70 border border-cyan-400/25 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-cyan-300">
                            {wfBuilderReady ? 'Ready to apply' : 'Draft sketch'} — {wfBuilderDraft.workflow?.name || wfBuilderDraft.newAgents?.[0]?.name || wfBuilderDraft.workflow?.id || 'draft'}
                          </div>
                          {!wfBuilderReady && <span className="text-[10px] text-amber-300/80">Keep chatting to finish the draft</span>}
                        </div>
                        <div className="text-xs text-blue-200/80 whitespace-pre-wrap">{summarizeWorkflowDraft(wfBuilderDraft)}</div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            disabled={!wfBuilderReady || wfBuilderApplying}
                            onClick={applyWorkflowBuilder}
                            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg flex items-center gap-2"
                          >
                            <Save className="w-4 h-4" /> {wfBuilderApplying ? 'Applying…' : 'Apply to product JSON'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setWfBuilderDraft(null); setWfBuilderReady(false); }}
                            className="px-3 py-2 bg-slate-700/60 text-blue-200 text-sm rounded-lg"
                          >
                            Discard draft
                          </button>
                        </div>
                      </div>
                    )}
                    <div ref={wfBuilderEndRef} />
                  </div>
                  {wfBuilderError && <div className="mt-2 text-xs text-red-400 shrink-0">{wfBuilderError}</div>}
                  <div className="mt-3 flex gap-2 shrink-0">
                    <textarea
                      value={wfBuilderInput}
                      onChange={(e) => setWfBuilderInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendWorkflowBuilder();
                        }
                      }}
                      rows={2}
                      placeholder={
                        wfBuilderIntent === 'edit'
                          ? `Describe how to change ${topics.find((t) => t.id === wfBuilderFocusId)?.name || 'this workflow'} (steps, triggers, agents)…`
                          : 'Describe the workflow and how chat should start it (keyword only, context only, or both)…'
                      }
                      className="flex-1 bg-slate-900 border border-blue-400/30 rounded-lg px-3 py-2 text-sm text-white resize-none min-h-[44px]"
                    />
                    <button
                      type="button"
                      disabled={wfBuilderLoading || !wfBuilderInput.trim()}
                      onClick={() => sendWorkflowBuilder()}
                      className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-40 text-cyan-300 border border-cyan-400/30 rounded-lg"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                )}
                  <div ref={wfListRef} className="space-y-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    {topics.map(topic => (
                      <div
                        key={topic.id}
                        ref={(el) => {
                          if (el) wfCardRefs.current[topic.id] = el;
                          else delete wfCardRefs.current[topic.id];
                        }}
                        className={`bg-slate-700/30 border rounded-lg p-4 transition-all ${wfSavedId === topic.id ? 'border-cyan-300 bg-cyan-500/15' : 'border-cyan-400/20'}`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1 mr-3">
                            <div className="font-semibold text-cyan-300">{topic.name}</div>
                            <div className="text-xs text-blue-300/60 mt-1">{topic.description}</div>
                            <div className="text-[10px] text-cyan-300/70 mt-1.5">Starts: {triggerModeLabel(topic.triggerMode)}</div>
                            {workflowAllowsKeywordTrigger(topic) && (topic.triggerKeywords || []).length > 0 ? (
                              <div className="text-[10px] text-blue-300/50 mt-1">
                                Keywords: {(topic.triggerKeywords || []).join(' · ')}
                              </div>
                            ) : workflowAllowsKeywordTrigger(topic) ? (
                              <div className="text-[10px] text-amber-300/70 mt-1">No keyword phrases — chat will not start this workflow from a typed phrase</div>
                            ) : (
                              <div className="text-[10px] text-blue-300/45 mt-1">Keyword phrases are ignored (context only)</div>
                            )}
                          </div>
                          <span className={`px-2 py-1 text-xs rounded ${topic.status === 'active' ? 'bg-green-500/20 text-green-400 border border-green-400/30' : 'bg-gray-500/20 text-gray-400 border border-gray-400/30'}`}>{topic.status}</span>
                        </div>
                        <div className="space-y-1 mt-3 pl-3 border-l-2 border-cyan-400/30">
                          {topic.workflow.map((step, idx) => (
                            <div key={idx} className="text-xs"><span className="text-cyan-400 font-medium">Step {step.step}:</span><span className="text-blue-300/80 ml-2">{step.name}</span></div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-cyan-400/20">
                          <button onClick={async () => {
                            const next = topics.map(t => t.id === topic.id ? { ...t, status: t.status === 'active' ? 'inactive' : 'active' } : t);
                            setTopics(next);
                            await persistIntelligenceSettings({ topics: next });
                          }} className={`flex-1 min-w-[6.5rem] px-3 py-2 rounded-lg text-sm font-semibold transition-all ${topic.status === 'active' ? 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border border-yellow-400/30' : 'bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-400/30'}`}>{topic.status === 'active' ? 'Disable' : 'Enable'}</button>
                          <button onClick={() => {
                            const hydrated = mergeTopics([topic])[0];
                            setEditingTopic(hydrated);
                            setEditingTopicTab('orchestrator');
                            setExpandedSteps({});
                          }} className="flex-1 min-w-[6.5rem] px-3 py-2 rounded-lg text-sm font-semibold transition-all bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-400/30">Edit</button>
                          <button
                            type="button"
                            onClick={() => startWorkflowBuilderEdit(topic)}
                            className="flex-1 min-w-[8rem] px-3 py-2 rounded-lg text-sm font-semibold transition-all bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-400/30 flex items-center justify-center gap-1.5"
                          >
                            <Sparkles className="w-3.5 h-3.5" /> Edit with agent
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
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
                        <p className="text-xs text-blue-300/50 mb-2">Only files marked <span className="text-cyan-200">Agents</span> in Knowledge Base Management can be assigned here.</p>
                        {(() => {
                          const agentDocs = (documents || []).filter((d) => knowledgeFileFlags(knowledgeAccessLive(), d.name).agents);
                          if (!agentDocs.length) {
                            return (
                          <div className="text-xs text-amber-300/80 bg-amber-500/10 border border-amber-400/20 rounded-lg p-3">
                            No agent-eligible knowledge files. Tick <span className="font-semibold">Agents</span> on a file in Admin → Knowledge first.
                          </div>
                            );
                          }
                          return (
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
                              All files marked Agents
                            </label>
                            <div className="border-t border-blue-400/15 pt-2 space-y-1.5">
                              {agentDocs.map((doc) => {
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
                          );
                        })()}
                      </div>
                      <div>
                        <label className="block text-sm font-semibold mb-2">Tools</label>
                        <p className="text-xs text-blue-300/50 mb-2">Capability labels this specialist needs (one per line). Stored in the product JSON; runtime uses the system prompt and knowledge files.</p>
                        <textarea
                          value={(editingAgent.tools || []).join('\n')}
                          onChange={(e) => setEditingAgent({
                            ...editingAgent,
                            tools: e.target.value.split('\n').map((t) => t.trim()).filter(Boolean),
                          })}
                          rows={3}
                          placeholder={"numbered clarifying questions\nproposal image extract"}
                          className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white text-sm"
                        />
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
                        <h2 className="text-xl font-bold">{topics.some((t) => t.id === editingTopic.id) ? `Edit Workflow: ${editingTopic.name}` : 'New Workflow'}</h2>
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
                          <div>
                            <label className="block text-sm font-semibold mb-2">Description (context cue)</label>
                            <textarea value={editingTopic.description} onChange={(e) => setEditingTopic({...editingTopic, description: e.target.value})} rows={3} className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white" />
                            <p className="text-[11px] text-blue-300/50 mt-1">
                              {normalizeTriggerMode(editingTopic.triggerMode) === 'keyword'
                                ? 'Shown as the workflow summary. Not used to start the workflow while Keyword only is selected.'
                                : 'Used as the “when” situation for conversation-context matching.'}
                            </p>
                          </div>
                          <fieldset className="space-y-2">
                            <legend className="block text-sm font-semibold mb-1">Start from chat</legend>
                            {[
                              ['keyword', 'Keyword only', 'Offer this workflow only when the user message contains a trigger phrase.'],
                              ['context', 'Context only', 'Offer this workflow only when the conversation matches the description — not from phrases.'],
                              ['both', 'Keywords and context', 'Offer from a trigger phrase or from conversation context.'],
                            ].map(([id, label, hint]) => (
                              <label key={id} className="flex items-start gap-2 text-sm text-blue-100 cursor-pointer">
                                <input
                                  type="radio"
                                  name="workflow-trigger-mode"
                                  checked={normalizeTriggerMode(editingTopic.triggerMode) === id}
                                  onChange={() => setEditingTopic({ ...editingTopic, triggerMode: id })}
                                  className="mt-1 border-blue-400/40"
                                />
                                <span>
                                  <span className="font-semibold">{label}</span>
                                  <span className="block text-xs text-blue-300/60 mt-0.5">{hint}</span>
                                </span>
                              </label>
                            ))}
                          </fieldset>
                          <div>
                            <label className="block text-sm font-semibold mb-2">Trigger Keywords (comma-separated)</label>
                            <input type="text" value={editingTopic.triggerKeywords?.join(', ') || ''} onChange={(e) => setEditingTopic({ ...editingTopic, triggerKeywords: e.target.value.split(',').map(k => k.trim()).filter(k => k) })} className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white text-sm" />
                            <p className="text-[11px] text-blue-300/50 mt-1">
                              {normalizeTriggerMode(editingTopic.triggerMode) === 'context'
                                ? 'Not used to start the workflow while Context only is selected. Keep phrases if you may switch back.'
                                : 'Chat offers this workflow when the user message contains a phrase (4+ characters), e.g. design an incentive, assess my ic.'}
                            </p>
                          </div>
                          <label className="flex items-start gap-2 text-sm text-blue-100 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editingTopic.status !== 'inactive'}
                              onChange={(e) => setEditingTopic({ ...editingTopic, status: e.target.checked ? 'active' : 'inactive' })}
                              className="rounded border-blue-400/40 mt-0.5"
                            />
                            <span>
                              <span className="font-semibold">Enabled</span>
                              <span className="block text-xs text-blue-300/60 mt-0.5">
                                {editingTopic.status === 'inactive'
                                  ? 'Off: this workflow is not offered to users until you enable it.'
                                  : 'On: users can trigger this workflow from chat.'}
                              </span>
                            </span>
                          </label>
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
                        const idx = topics.findIndex(t => t.id === editingTopic.id);
                        const next = idx >= 0
                          ? topics.map(t => t.id === editingTopic.id ? editingTopic : t)
                          : [...topics, editingTopic];
                        setTopics(next);
                        setEditingTopic(null);
                        setEditingTopicTab('basics');
                        revealSavedWorkflow(editingTopic.id);
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
                  <div>
                    <h3 className="text-lg font-bold text-white">Stella prompts</h3>
                    <p className="text-xs text-blue-300/55 mt-1">
                      Welcome message and AI prompts for data intake / analysis. Stored in the shared product JSON — separate from per-user business context, files, and connections (those live in User Settings).
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

              {adminModule === 'users' && (
                <AdminUsers
                  currentUserId={currentUser.id}
                  onGeneralSettingsSaved={(userId, general) => {
                    if (String(userId) !== String(currentUser.id)) return;
                    setUserSettings((prev) => {
                      const next = mergeUserSettingsFields({ ...prev, ...general });
                      userSettingsRef.current = next;
                      return next;
                    });
                    if (general?.stellaBusinessContext) {
                      setStellaBusinessContext(mergeStellaBusinessContext(general.stellaBusinessContext));
                    }
                  }}
                />
              )}
            </div>
          ) : null}
          </MessageErrorBoundary>
        </div>
      )}

      {contextFileDeleteConfirm && createPortal(
        <div
          className="fixed inset-0 z-[220] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="context-file-delete-title"
          onClick={() => setContextFileDeleteConfirm(null)}
        >
          <div
            className="w-full max-w-md bg-slate-900 rounded-2xl shadow-2xl p-5 border border-red-400/30"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="context-file-delete-title" className="text-sm font-bold text-white">Delete this context file?</h3>
            <p className="text-xs text-cyan-100 mt-3 leading-relaxed">
              Remove <span className="font-semibold">{contextFileDeleteConfirm.name}</span> and its captured context? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setContextFileDeleteConfirm(null)}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRemoveModuleContextFile(contextFileDeleteConfirm.moduleId, contextFileDeleteConfirm.fileId)}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-red-500/85 hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {stellaJoinPending && createPortal(
        <div
          className="fixed inset-0 z-[220] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stella-join-pending-title"
          onClick={() => setStellaJoinPending(null)}
        >
          <div
            className={`w-full max-w-xl bg-slate-900 rounded-2xl shadow-2xl p-5 border ${stellaJoinPending.action === 'add' ? 'border-amber-400/35' : 'border-red-400/30'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {stellaJoinPending.action === 'add' ? (
              <>
                <h3 id="stella-join-pending-title" className="text-sm font-bold text-white">
                  {stellaJoinPending.assess?.verdict === 'block' ? 'This join looks wrong' : 'Check this connection'}
                </h3>
                <p className="text-xs text-cyan-100 mt-3 font-mono leading-relaxed">{stellaJoinActionLabel(stellaJoinPending)}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                  <StellaJoinColumnPreview
                    fileName={stellaJoinPending.assess?.thisFile || stellaJoinPending.fromName}
                    field={stellaJoinPending.assess?.thisField || stellaJoinPending.thisField}
                    type={stellaJoinPending.assess?.thisType}
                    kind={stellaJoinPending.assess?.thisKind}
                    samples={stellaJoinPending.assess?.thisSamples}
                  />
                  <StellaJoinColumnPreview
                    fileName={stellaJoinPending.assess?.thatFile || stellaJoinPending.toName}
                    field={stellaJoinPending.assess?.thatField || stellaJoinPending.relatedField}
                    type={stellaJoinPending.assess?.thatType}
                    kind={stellaJoinPending.assess?.thatKind}
                    samples={stellaJoinPending.assess?.thatSamples}
                  />
                </div>
                {stellaJoinPending.assess?.examples ? (
                  <p className="text-xs text-cyan-100/80 mt-2 font-mono">Shared values{stellaJoinPending.assess.examples}</p>
                ) : null}
                {(stellaJoinPending.assess?.warnings || []).length ? (
                  <ul className="mt-2 space-y-1 text-xs text-amber-200/85 list-disc pl-4">
                    {stellaJoinPending.assess.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                ) : (
                  <p className="text-xs text-blue-300/70 mt-2">{stellaJoinPending.assess?.reason}</p>
                )}
                <p className="text-xs text-blue-300/55 mt-3">Connect anyway only if you know these fields really match.</p>
                <div className="flex justify-end gap-2 mt-5">
                  <button
                    type="button"
                    onClick={() => setStellaJoinPending(null)}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmStellaJoinPending}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-amber-500/85 hover:bg-amber-500"
                  >
                    Connect anyway
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 id="stella-join-pending-title" className="text-sm font-bold text-white">Remove this connection?</h3>
                <p className="text-xs text-cyan-100 mt-3 font-mono leading-relaxed">{stellaJoinActionLabel(stellaJoinPending)}</p>
                <p className="text-xs text-blue-300/60 mt-2">This updates both files. You can Undo afterwards.</p>
                <div className="flex justify-end gap-2 mt-5">
                  <button
                    type="button"
                    onClick={() => setStellaJoinPending(null)}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmStellaJoinPending}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-red-500/85 hover:bg-red-500"
                  >
                    Remove
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
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
                {!imageLightbox.pending && imageLightbox.contextReview && imageLightbox.fileId && (
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      disabled={!!contextImageBusy}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold disabled:opacity-40 ${
                        imageLightbox.included
                          ? 'bg-slate-600/60 hover:bg-slate-500/70 text-slate-100'
                          : 'bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100'
                      }`}
                      onClick={() => {
                        toggleContextImageUse(imageLightbox.moduleId, imageLightbox.fileId, imageLightbox.name, !imageLightbox.included);
                        setImageLightbox((prev) => (prev ? { ...prev, included: !prev.included } : prev));
                      }}
                    >
                      {contextImageBusy?.name === imageLightbox.name
                        ? 'Reading…'
                        : imageLightbox.included ? "Don't use this image" : 'Use this image'}
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
