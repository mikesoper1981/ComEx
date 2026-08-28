import { isEmptyContextValue } from './moduleContext';

export const MEMORY_CAP = 30;
export const MEMORY_TEXT_MAX = 280;

export const MEMORY_HARVEST_SYSTEM = `You extract a small set of durable facts about THIS USER's own business for a commercial-excellence copilot.

Save ONLY high-value facts that should still be true in later chats:
- Named products, brands, or SKUs they work on
- Named competitors
- Named territories, countries, markets, or regions they cover
- Specific definitions, metrics, or abbreviations they use (e.g. "attainment = YTD sales vs quota")
- Explicit remember-this requests ("remember that…", "don't forget…", "always use…")
- Named incentive plans/schemes or hard rules they confirmed as theirs (eligibility, pay curve, quota cycle)

Skip:
- Greetings, yes/start/continue/ok/thanks, process chatter
- The assistant's generic advice or best-practice lectures
- One-off questions, hypotheticals, or this-session-only analysis
- Anything already listed as remembered, or a close rephrase of it
- Secrets or passwords

When in doubt return {"facts":[],"conflicts":[]}. Prefer fewer, more specific facts. Max 4 new facts.
If a new fact contradicts an already remembered fact (same topic, different value — e.g. product was Alpha, now Beta), do NOT put it in facts. Put it in conflicts with a short confirmation question.
Return JSON only: {"facts":["..."],"conflicts":[{"existingId":"mem_…","existingText":"…","proposed":"…","question":"I currently remember X. Update this to Y?"}]}`;

export const MEMORY_BACKFILL_SYSTEM = `${MEMORY_HARVEST_SYSTEM}

You are reading a transcript of prior chats for one user. Extract only the key facts above. Deduplicate. Do not invent. Max 6 facts.`;

function extractJsonObject(text) {
  if (!text) return null;
  const tryParse = (raw) => {
    try { return JSON.parse(String(raw || '').trim()); } catch { return null; }
  };
  const direct = tryParse(text);
  if (direct && typeof direct === 'object') return direct;
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    const parsed = tryParse(fenced[1]);
    if (parsed && typeof parsed === 'object') return parsed;
  }
  const source = String(text);
  const firstBrace = source.indexOf('{');
  if (firstBrace === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < source.length; i++) {
    const ch = source[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const parsed = tryParse(source.slice(firstBrace, i + 1));
        if (parsed && typeof parsed === 'object') return parsed;
      }
    }
  }
  return null;
}

function factText(item) {
  if (typeof item === 'string') return item.replace(/\s+/g, ' ').trim();
  if (item && typeof item === 'object') {
    return String(item.text || item.fact || item.value || '').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function extractJsonArray(text) {
  if (!text) return null;
  const tryParse = (raw) => {
    try { return JSON.parse(String(raw || '').trim()); } catch { return null; }
  };
  const direct = tryParse(text);
  if (Array.isArray(direct)) return direct;
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    const parsed = tryParse(fenced[1]);
    if (Array.isArray(parsed)) return parsed;
  }
  const source = String(text);
  const first = source.indexOf('[');
  if (first === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = first; i < source.length; i++) {
    const ch = source[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        const parsed = tryParse(source.slice(first, i + 1));
        if (Array.isArray(parsed)) return parsed;
      }
    }
  }
  return null;
}

export function parseMemoryHarvest(raw) {
  const parsed = extractJsonObject(String(raw || ''));
  const facts = parseMemoryFacts(raw);
  const conflicts = [];
  const list = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.conflicts)
    ? parsed.conflicts
    : [];
  for (const item of list) {
    const proposed = factText(item?.proposed || item?.text);
    const existingText = factText(item?.existingText || item?.existing);
    if (proposed.length < 12) continue;
    conflicts.push({
      existingId: String(item?.existingId || ''),
      existingText,
      proposed,
      question: String(item?.question || '').replace(/\s+/g, ' ').trim()
        || `I currently remember: "${existingText || 'an earlier fact'}". Should I update this to: "${proposed}"?`,
    });
  }
  return { facts, conflicts };
}

export function parseJsonArray(raw) {
  const arr = extractJsonArray(String(raw || ''));
  if (Array.isArray(arr)) return arr;
  const parsed = extractJsonObject(String(raw || ''));
  if (Array.isArray(parsed)) return parsed;
  return [];
}

export function activeMemoryItems(settings) {
  return normalizeMemoryItems(settings?.memory).filter((m) => m.status !== 'obsolete');
}

export function applyMemoryConfirmation(existing, { existingId, existingText, proposed, accept }, { module = '' } = {}) {
  const base = normalizeMemoryItems(existing);
  const now = new Date().toISOString();
  if (!accept) return base;
  const matchIdx = base.findIndex((m) =>
    (existingId && m.id === existingId) || (existingText && factsAreSimilar(m.text, existingText)),
  );
  const oldId = matchIdx >= 0 ? base[matchIdx].id : '';
  let next = base;
  if (matchIdx >= 0) {
    next = base.map((m, i) => (i === matchIdx ? { ...m, status: 'obsolete', updatedAt: now } : m));
  }
  const merged = mergeMemoryFacts(next, [proposed], { module });
  if (!oldId) return merged;
  const added = merged.find((m) => m.status === 'active' && factsAreSimilar(m.text, proposed));
  return merged.map((m) => (m.id === oldId ? { ...m, supersededBy: added?.id || '' } : m));
}

export function parseMemoryFacts(raw) {
  const parsed = extractJsonObject(String(raw || ''));
  if (Array.isArray(parsed)) return parsed.map(factText).filter(Boolean);
  if (parsed && typeof parsed === 'object') {
    const list = Array.isArray(parsed.facts) ? parsed.facts
      : (Array.isArray(parsed.memory) ? parsed.memory : []);
    if (list.length) return list.map(factText).filter(Boolean);
  }
  const arr = extractJsonArray(String(raw || ''));
  return Array.isArray(arr) ? arr.map(factText).filter(Boolean) : [];
}

export function normalizeMemoryItems(raw) {
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
      status: item?.status === 'obsolete' ? 'obsolete' : 'active',
      supersededBy: item?.supersededBy ? String(item.supersededBy) : '',
      updatedAt: item?.updatedAt || new Date().toISOString(),
    });
    if (out.length >= MEMORY_CAP) break;
  }
  return out;
}

const FACT_STOPWORDS = new Set([
  'the', 'and', 'for', 'their', 'user', 'plan', 'scheme', 'uses', 'with', 'from',
  'that', 'this', 'they', 'are', 'is', 'was', 'a', 'an', 'of', 'in', 'on', 'to',
  'as', 'or', 'be', 'by', 'it', 'its', 'at', 'our', 'we', 'will', 'has', 'have',
]);

function normalizeFactKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function factTokens(text) {
  return new Set(normalizeFactKey(text).split(' ').filter((w) => w.length > 2 && !FACT_STOPWORDS.has(w)));
}

export function factsAreSimilar(a, b) {
  const ka = normalizeFactKey(a);
  const kb = normalizeFactKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.includes(kb) || kb.includes(ka)) return true;
  const ta = factTokens(a);
  const tb = factTokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  const jaccard = union ? inter / union : 0;
  const coverage = inter / Math.min(ta.size, tb.size);
  return jaccard >= 0.55 || coverage >= 0.8;
}

export function memorySignature(items) {
  return normalizeMemoryItems(items).map((m) => m.text.toLowerCase()).sort().join('\n');
}

export function mergeMemoryFacts(existing, incoming, { module = '' } = {}) {
  const base = normalizeMemoryItems(existing);
  const now = new Date().toISOString();
  for (const raw of incoming || []) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_TEXT_MAX);
    if (text.length < 12 || isEmptyContextValue(text)) continue;
    const active = base.filter((m) => m.status !== 'obsolete');
    if (active.some((m) => factsAreSimilar(m.text, text))) continue;
    base.unshift({
      id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      text,
      module,
      status: 'active',
      updatedAt: now,
    });
  }
  return normalizeMemoryItems(base).slice(0, MEMORY_CAP);
}

export function isMemoryEnabled(settings) {
  return settings?.memoryEnabled !== false;
}

export function formatMemoryPromptBlock(settings) {
  if (!isMemoryEnabled(settings)) return '';
  const items = activeMemoryItems(settings);
  if (!items.length) return '';
  let body = items.map((m) => `- ${m.text}`).join('\n');
  if (body.length > 3500) body = `${body.slice(0, 3500)}\n- [… older remembered facts omitted …]`;
  return `\n\nREMEMBERED FROM PRIOR CHATS (key facts this user already established — products, competitors, territories, definitions. Use them. Do not re-ask unless the user contradicts them):\n${body}`;
}

export function shouldHarvestChatMemory(_assistantText, userText) {
  const user = String(userText || '').trim();
  if (/\b(remember (this|that|it)|don'?t forget|always use|always remember)\b/i.test(user)) return user.length >= 8;
  if (user.length < 12) return false;
  if (/^(y|yes|yeah|yep|sure|ok|okay|start|go|continue|proceed|no|cancel|thanks|thank you|next|please)[\s.!]*$/i.test(user)) return false;
  if (/^User (feedback|instruction):/i.test(user) && user.length < 40) return false;
  return true;
}

function clipTurn(text, max = 500) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function chatsFromDocument(doc) {
  if (!doc || typeof doc !== 'object') return [];
  if (Array.isArray(doc.chats)) return doc.chats;
  if (Array.isArray(doc.settings?.chats)) return doc.settings.chats;
  return [];
}

export function compactChatsForMemory(chats) {
  const parts = [];
  for (const chat of (chats || []).slice(0, 20)) {
    const msgs = (chat.messages || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'orchestrator'));
    const wf = chat.currentWorkflow;
    const fileName = clipTurn(chat.uploadedFile?.name, 120);
    const focused = clipTurn(wf?.focusedContext, 1400);
    const stepBits = (wf?.context || []).slice(-6).map((c) => {
      const out = clipTurn(c?.output, 220);
      return out ? `${c.step || 'step'}: ${out}` : '';
    }).filter(Boolean);
    const hasSubstance = msgs.some((m) => clipTurn(m.content, 200).length >= 20)
      || focused.length > 40
      || stepBits.length > 0
      || fileName.length > 4;
    if (!hasSubstance) continue;
    const title = clipTurn(chat.title, 80);
    parts.push(`--- Chat (${chat.module || 'incentives'})${title ? ` "${title}"` : ''} ---`);
    if (fileName) parts.push(`FILE: ${fileName}`);
    if (focused) parts.push(`WORKING CONTEXT:\n${focused}`);
    if (stepBits.length) parts.push(`WORKFLOW NOTES:\n${stepBits.join('\n')}`);
    for (const m of msgs.slice(-30)) {
      const text = clipTurn(m.content, m.role === 'user' ? 700 : 420);
      if (text.length < 8) continue;
      if (m.role === 'user' && !shouldHarvestChatMemory('', text) && text.length < 24) continue;
      const role = m.role === 'user' ? 'USER' : 'ASSISTANT';
      parts.push(`${role}: ${text}`);
    }
  }
  return parts.join('\n').slice(0, 18000);
}

export function memoryBackfillNeeded(memory, chats, settings) {
  if (settings && !isMemoryEnabled(settings)) return false;
  return normalizeMemoryItems(memory).length === 0 && compactChatsForMemory(chats).length > 80;
}

function formatKnownMemory(existingMemory) {
  const items = normalizeMemoryItems(existingMemory).filter((m) => m.status !== 'obsolete');
  if (!items.length) return '';
  return `\n\nAlready remembered for this user (id + fact — do not repeat similar facts; use conflicts if a new fact contradicts one of these):\n${items.map((m) => `- [${m.id}] ${m.text}`).join('\n')}`;
}

export function buildHarvestExchange({ assistantText = '', userText = '', recentTurns = [], existingMemory = [] } = {}) {
  const recent = (recentTurns || [])
    .map((t) => `${String(t.role || '').toUpperCase()}: ${clipTurn(t.content, 400)}`)
    .filter(Boolean)
    .join('\n');
  return `Recent assistant message (may be empty):\n${String(assistantText || '').slice(0, 2500)}\n\nUser said:\n${String(userText || '').slice(0, 2500)}${recent ? `\n\nEarlier turns in this chat:\n${recent.slice(0, 3500)}` : ''}${formatKnownMemory(existingMemory)}`;
}

export function buildBackfillExchange(transcript, existingMemory = []) {
  return `Transcript of this user's prior chats:\n${transcript}${formatKnownMemory(existingMemory)}`;
}
