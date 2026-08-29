/** Per-user, per-module uploaded context (strategy decks, product lists, territory Excel, etc.). */

export const MODULE_CONTEXT_IDS = ['incentives', 'territory', 'stella'];

export const DEFAULT_MODULE_CONTEXT = MODULE_CONTEXT_IDS.reduce((acc, id) => {
  acc[id] = { files: [] };
  return acc;
}, {});

const EXTRACT_CAPS = { text: 25000, vision: 15000, structured: 12000, summary: 4000 };

export function detectContextFileKind(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  if (name.endsWith('.pdf') || type.includes('pdf')) return { kind: 'pdf', label: 'PDF' };
  if (name.endsWith('.pptx') || type.includes('presentation')) return { kind: 'pptx', label: 'PowerPoint' };
  if (name.endsWith('.ppt')) return { kind: 'ppt', label: 'PowerPoint' };
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || type.includes('spreadsheet') || type.includes('excel')) {
    return { kind: 'excel', label: 'Excel' };
  }
  if (name.endsWith('.csv') || type.includes('csv')) return { kind: 'csv', label: 'CSV' };
  if (name.endsWith('.json') || type.includes('json')) return { kind: 'json', label: 'JSON' };
  return { kind: 'text', label: 'document' };
}

function capText(value, max) {
  const t = String(value || '').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n[… truncated for stored context …]`;
}

/** True when a stored field would add noise instead of usable context. */
export function isEmptyContextValue(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return !value.length || value.every(isEmptyContextValue);
  if (typeof value === 'object') {
    const vals = Object.values(value);
    return !vals.length || vals.every(isEmptyContextValue);
  }
  const t = String(value).trim();
  if (!t) return true;
  const lower = t.toLowerCase().replace(/\s+/g, ' ');
  if (/^(n\/a|na|none|null|nil|undefined|-|—|unknown|not specified|not provided|tbd|none provided)$/i.test(lower)) return true;
  if (/\bto use this correctly i need a little context\b/i.test(lower)) return true;
  if (/\byou can answer them together or one at a time\b/i.test(lower)) return true;
  if (t.length < 900) {
    if (/\bappears to be empty\b/i.test(lower)) return true;
    if (/\bcontains? only a filename\b/i.test(lower)) return true;
    if (/\bno actual data( content)?\b/i.test(lower)) return true;
    if (/\bfilename reference\b/i.test(lower)) return true;
    if (/\bwhat data should this .+\sfile contain\b/i.test(lower)) return true;
  }
  // Only treat short filler as empty — a long extract may mention missing text on one slide.
  if (t.length > 240) return false;
  if (/\bno (readable |extractable |usable )?(text|content|data|extract|information|context)\b/i.test(lower)) return true;
  if (/\bcontained no\b/i.test(lower)) return true;
  if (/\bcontains? no (readable |extractable |usable )?(text|content)\b/i.test(lower)) return true;
  if (/\blittle or no text\b/i.test(lower)) return true;
  if (/\b(could not|unable to) (be )?(extract|read|parse)/i.test(lower)) return true;
  if (/\bnothing to (extract|read|use)\b/i.test(lower)) return true;
  if (/\b(empty|blank) (file|document|extract|sheet)\b/i.test(lower)) return true;
  return false;
}

function usefulString(value, max) {
  const t = max != null ? capText(value, max) : String(value || '').trim();
  return isEmptyContextValue(t) ? '' : t;
}

export async function extractSpreadsheetText(file) {
  const xlsxMod = await import('xlsx');
  const XLSX = xlsxMod?.default || xlsxMod;
  const name = String(file?.name || '').toLowerCase();
  let wb;
  if (name.endsWith('.csv')) {
    const txt = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read CSV'));
      reader.readAsText(file);
    });
    wb = XLSX.read(txt, { type: 'string' });
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  }
  const parts = [];
  for (const sheetName of wb.SheetNames || []) {
    const ws = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(ws);
    if (String(csv || '').trim()) parts.push(`--- Sheet: ${sheetName} ---\n${csv.trim()}`);
  }
  return parts.join('\n\n').trim();
}

export function compactCapturedContext(ctx) {
  const base = ctx && typeof ctx === 'object' ? ctx : {};
  const qa = Array.isArray(base.qa_pairs)
    ? base.qa_pairs
      .map((p) => {
        if (!p || typeof p !== 'object') return null;
        const row = {};
        const q = usefulString(p.question);
        const a = usefulString(p.answer);
        if (q) row.question = q;
        if (a) row.answer = a;
        return Object.keys(row).length ? row : null;
      })
      .filter(Boolean)
    : [];
  const metrics = Array.isArray(base.key_metrics)
    ? base.key_metrics.map((m) => usefulString(m)).filter(Boolean)
    : (usefulString(base.key_metrics) ? [usefulString(base.key_metrics)] : []);
  const out = {};
  const represents = usefulString(base.what_it_represents);
  const period = usefulString(base.time_period);
  const notes = usefulString(base.interpretation_notes);
  if (represents) out.what_it_represents = represents;
  if (period) out.time_period = period;
  if (metrics.length) out.key_metrics = metrics;
  if (notes) out.interpretation_notes = notes;
  if (qa.length) out.qa_pairs = qa;
  return Object.keys(out).length ? out : undefined;
}

function normalizeContextFile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim();
  if (!id || !name) return null;
  const rec = { id, name };
  const fileType = usefulString(raw.fileType || raw.kind);
  if (fileType) rec.fileType = fileType;
  const sizeLabel = usefulString(raw.sizeLabel);
  if (sizeLabel) rec.sizeLabel = sizeLabel;
  if (raw.storagePath) rec.storagePath = raw.storagePath;
  if (raw.storageBucket && raw.storagePath) rec.storageBucket = raw.storageBucket;
  if (raw.uploadedAt) rec.uploadedAt = raw.uploadedAt;
  const summary = usefulString(raw.summary, EXTRACT_CAPS.summary);
  if (summary) rec.summary = summary;
  const extractedText = usefulString(raw.extractedText, EXTRACT_CAPS.text);
  if (extractedText) rec.extractedText = extractedText;
  const visionExtract = usefulString(raw.visionExtract, EXTRACT_CAPS.vision);
  if (visionExtract) rec.visionExtract = visionExtract;
  const structuredExtract = usefulString(raw.structuredExtract, EXTRACT_CAPS.structured);
  if (structuredExtract) rec.structuredExtract = structuredExtract;
  const imageCount = Number(raw.imageCount) || 0;
  if (imageCount > 0) rec.imageCount = imageCount;
  const intakeMessages = Array.isArray(raw.intakeMessages)
    ? raw.intakeMessages
      .slice(-24)
      .map((m) => ({ role: m.role, content: usefulString(m.content, 4000) }))
      .filter((m) => m.role && m.content)
    : [];
  if (intakeMessages.length) rec.intakeMessages = intakeMessages;
  if (raw.intakeComplete) rec.intakeComplete = true;
  if (raw.processing) rec.processing = true;
  const captured = compactCapturedContext(raw.capturedContext);
  if (captured) rec.capturedContext = captured;
  const notes = [];
  const seenNoteIds = new Set();
  const pushNote = (id, text) => {
    const t = usefulString(text, 8000);
    if (!t) return;
    let nid = String(id || '').trim() || `note_${notes.length + 1}`;
    while (seenNoteIds.has(nid)) nid = `${nid}_${notes.length + 1}`;
    seenNoteIds.add(nid);
    notes.push({ id: nid, text: t });
  };
  if (Array.isArray(raw.notes)) {
    raw.notes.forEach((n, i) => {
      if (typeof n === 'string') pushNote(`note_${i + 1}`, n);
      else if (n && typeof n === 'object') pushNote(n.id || `note_${i + 1}`, n.text);
    });
  }
  if (!notes.length && usefulString(raw.userNotes)) {
    String(raw.userNotes).split(/\n\n+/).forEach((part, i) => pushNote(`note_${i + 1}`, part));
  }
  if (notes.length) rec.notes = notes;
  if (!rec.intakeComplete && !rec.processing) {
    const hasStoredContent = !!(
      rec.summary || rec.extractedText || rec.visionExtract || rec.structuredExtract
      || rec.capturedContext || rec.notes?.length
    );
    if (hasStoredContent) rec.intakeComplete = true;
  }
  return rec;
}

export function mergeModuleContext(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const id of MODULE_CONTEXT_IDS) {
    const bucket = src[id] && typeof src[id] === 'object' ? src[id] : {};
    const files = Array.isArray(bucket.files)
      ? bucket.files.map(normalizeContextFile).filter(Boolean)
      : [];
    out[id] = { files };
  }
  return out;
}

export function contextFileContentScore(fileRec) {
  const rec = normalizeContextFile(fileRec);
  if (!rec) return 0;
  let n = 0;
  n += (rec.extractedText || '').length;
  n += (rec.visionExtract || '').length;
  n += (rec.structuredExtract || '').length;
  n += (rec.summary || '').length;
  n += (rec.notes || []).reduce((s, note) => s + String(note?.text || '').length, 0);
  if (rec.capturedContext) n += JSON.stringify(rec.capturedContext).length;
  return n;
}

export function moduleContextContentScore(raw) {
  const merged = mergeModuleContext(raw);
  let n = 0;
  for (const id of MODULE_CONTEXT_IDS) {
    for (const f of merged[id].files || []) n += contextFileContentScore(f);
  }
  return n;
}

/** Keep the richer extract/notes when the same file id exists on both sides. */
export function mergeModuleContextPreferRich(a, b) {
  const left = mergeModuleContext(a);
  const right = mergeModuleContext(b);
  const out = {};
  for (const id of MODULE_CONTEXT_IDS) {
    const byId = new Map();
    for (const f of [...(left[id].files || []), ...(right[id].files || [])]) {
      const prev = byId.get(f.id);
      if (!prev || contextFileContentScore(f) >= contextFileContentScore(prev)) byId.set(f.id, f);
    }
    out[id] = { files: [...byId.values()] };
  }
  return out;
}

/** Disk shape: detected file content + curated blocks. Never intake chat. */
export function serializeContextFileForPersist(fileRec) {
  const rec = normalizeContextFile(fileRec);
  if (!rec) return null;
  const out = { id: rec.id, name: rec.name };
  if (rec.fileType) out.fileType = rec.fileType;
  if (rec.sizeLabel) out.sizeLabel = rec.sizeLabel;
  if (rec.uploadedAt) out.uploadedAt = rec.uploadedAt;
  if (rec.summary) out.summary = rec.summary;
  if (rec.extractedText) out.extractedText = rec.extractedText;
  if (rec.structuredExtract) out.structuredExtract = rec.structuredExtract;
  if (rec.visionExtract) out.visionExtract = rec.visionExtract;
  if (rec.imageCount) out.imageCount = rec.imageCount;
  if (rec.capturedContext) out.capturedContext = rec.capturedContext;
  if (rec.notes?.length) out.notes = rec.notes;
  if (rec.intakeComplete) out.intakeComplete = true;
  return out;
}

export function serializeModuleContextForPersist(raw) {
  const merged = mergeModuleContext(raw);
  const out = {};
  for (const id of MODULE_CONTEXT_IDS) {
    out[id] = {
      files: (merged[id]?.files || []).map(serializeContextFileForPersist).filter(Boolean),
    };
  }
  return out;
}

export function isThinContextExtract(extractBlob, fileName) {
  if (isEmptyContextValue(extractBlob)) return true;
  const t = String(extractBlob || '').trim();
  if (t.length < 24) return true;
  const stem = String(fileName || '').replace(/\.[^.]+$/, '').trim().toLowerCase();
  if (stem && t.length < 80 && t.toLowerCase().includes(stem)) return true;
  return false;
}

export function serializeContextFile(fileRec) {
  return normalizeContextFile(fileRec);
}

export function upsertModuleContextFile(moduleContext, moduleId, fileRec) {
  const next = mergeModuleContext(moduleContext);
  const id = MODULE_CONTEXT_IDS.includes(moduleId) ? moduleId : 'incentives';
  const rec = normalizeContextFile(fileRec);
  if (!rec) return next;
  const list = next[id].files.filter((f) => f.id !== rec.id);
  next[id] = { files: [...list, rec] };
  return next;
}

export function patchModuleContextFile(moduleContext, moduleId, fileId, patch) {
  const next = mergeModuleContext(moduleContext);
  const id = MODULE_CONTEXT_IDS.includes(moduleId) ? moduleId : 'incentives';
  next[id] = {
    files: next[id].files.map((f) => (f.id === fileId ? normalizeContextFile({ ...f, ...patch, id: f.id }) : f)),
  };
  return next;
}

export function removeModuleContextFile(moduleContext, moduleId, fileId) {
  const next = mergeModuleContext(moduleContext);
  const id = MODULE_CONTEXT_IDS.includes(moduleId) ? moduleId : 'incentives';
  next[id] = { files: next[id].files.filter((f) => f.id !== fileId) };
  return next;
}

export function listModuleContextBlocks(f) {
  if (!f) return [];
  const ctx = f.capturedContext || {};
  const blocks = [];
  if (!isEmptyContextValue(f.extractedText)) {
    blocks.push({ id: 'extractedText', label: 'Detected from file', value: f.extractedText });
  }
  if (!isEmptyContextValue(f.structuredExtract)) {
    blocks.push({ id: 'structuredExtract', label: 'Tables / charts', value: f.structuredExtract });
  }
  if (!isEmptyContextValue(f.visionExtract)) {
    blocks.push({ id: 'visionExtract', label: 'From images', value: f.visionExtract });
  }
  if (!isEmptyContextValue(f.summary)) blocks.push({ id: 'summary', label: 'Summary', value: f.summary });
  if (!isEmptyContextValue(ctx.what_it_represents)) blocks.push({ id: 'represents', label: 'What it represents', value: ctx.what_it_represents, line: true });
  if (!isEmptyContextValue(ctx.time_period)) blocks.push({ id: 'period', label: 'Time period', value: ctx.time_period, line: true });
  if (Array.isArray(ctx.key_metrics) && ctx.key_metrics.some((m) => !isEmptyContextValue(m))) {
    blocks.push({ id: 'metrics', label: 'Key fields', value: ctx.key_metrics.filter((m) => !isEmptyContextValue(m)).join('\n') });
  }
  if (!isEmptyContextValue(ctx.interpretation_notes)) blocks.push({ id: 'interpretation', label: 'How to use', value: ctx.interpretation_notes });
  (ctx.qa_pairs || []).forEach((p, i) => {
    if (isEmptyContextValue(p?.question) && isEmptyContextValue(p?.answer)) return;
    blocks.push({ id: `qa:${i}`, label: 'Clarification', qa: true, question: p.question || '', answer: p.answer || '' });
  });
  (f.notes || []).forEach((n) => {
    if (!n || isEmptyContextValue(n.text)) return;
    blocks.push({ id: `note:${n.id}`, label: 'Added context', value: n.text });
  });
  return blocks;
}

function formatBlockForPrompt(b) {
  if (b.qa) {
    return [
      !isEmptyContextValue(b.question) ? `${b.label} — Q: ${b.question}` : b.label,
      !isEmptyContextValue(b.answer) ? `A: ${b.answer}` : '',
    ].filter(Boolean).join('\n');
  }
  const value = String(b.value || '').trim();
  if (!value) return '';
  return `${b.label}: ${value}`;
}

export const MODULE_CONTEXT_LABELS = {
  incentives: 'Incentive Compensation',
  territory: 'Territory Design',
  stella: 'Stella Insights',
};

export function mergeModuleConnections(raw) {
  const seen = new Set();
  const out = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const item of list) {
    const a = item?.a || item?.from || (Array.isArray(item) ? item[0] : '');
    const b = item?.b || item?.to || (Array.isArray(item) ? item[1] : '');
    const ids = [a, b]
      .map((id) => String(id || '').trim())
      .filter((id) => MODULE_CONTEXT_IDS.includes(id));
    if (ids.length !== 2 || ids[0] === ids[1]) continue;
    const [left, right] = ids.slice().sort();
    const key = `${left}|${right}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ a: left, b: right });
  }
  return out;
}

export function connectionKey(a, b) {
  const ids = [a, b].filter((id) => MODULE_CONTEXT_IDS.includes(id)).slice().sort();
  if (ids.length !== 2 || ids[0] === ids[1]) return '';
  return `${ids[0]}|${ids[1]}`;
}

export function modulesAreConnected(connections, a, b) {
  const key = connectionKey(a, b);
  return !!key && mergeModuleConnections(connections).some((c) => `${c.a}|${c.b}` === key);
}

export function connectedModuleIds(connections, moduleId) {
  if (!MODULE_CONTEXT_IDS.includes(moduleId)) return [];
  return mergeModuleConnections(connections)
    .filter((c) => c.a === moduleId || c.b === moduleId)
    .map((c) => (c.a === moduleId ? c.b : c.a));
}

export function toggleModuleConnection(connections, a, b) {
  const key = connectionKey(a, b);
  if (!key) return mergeModuleConnections(connections);
  const next = mergeModuleConnections(connections);
  if (next.some((c) => `${c.a}|${c.b}` === key)) {
    return next.filter((c) => `${c.a}|${c.b}` !== key);
  }
  const [left, right] = key.split('|');
  return [...next, { a: left, b: right }];
}

export function formatStellaSharePromptBlock(files, { maxChars = 3500 } = {}) {
  const usable = (files || []).filter((f) => f && !f.processing);
  if (!usable.length) return '';
  const blocks = usable.map((f) => {
    const cols = (f.columns || []).slice(0, 18).map((c) => (typeof c === 'string' ? c : c.name)).filter(Boolean).join(', ');
    const ctx = f.capturedContext && typeof f.capturedContext === 'object' ? f.capturedContext : {};
    const metrics = Array.isArray(ctx.key_metrics) ? ctx.key_metrics.filter((m) => !isEmptyContextValue(m)).slice(0, 8).join('; ') : '';
    return [
      `FILE: ${f.name}${f.rowCount != null ? ` (${f.rowCount} rows)` : (f.tableName ? ' (table)' : ' (document)')}`,
      !isEmptyContextValue(f.summary) ? `Summary: ${String(f.summary).replace(/\s+/g, ' ').trim().slice(0, 420)}` : '',
      cols ? `Columns: ${cols}` : '',
      !isEmptyContextValue(ctx.what_it_represents) ? `Represents: ${ctx.what_it_represents}` : '',
      !isEmptyContextValue(ctx.time_period) ? `Period: ${ctx.time_period}` : '',
      metrics ? `Key metrics: ${metrics}` : '',
      (!f.tableName && !isEmptyContextValue(f.extractedText))
        ? `Extract: ${String(f.extractedText).replace(/\s+/g, ' ').trim().slice(0, 500)}`
        : '',
    ].filter(Boolean).join('\n');
  });
  let body = blocks.join('\n\n');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n[… Stella catalog truncated …]`;
  return `\n\nLINKED STELLA DATA CATALOG — this user connected Stella to this module. Summaries of datasets they uploaded to Stella (not live SQL). Use as background for territories, products, coverage, and metrics. Do not invent extra tables or values:\n${body}\n`;
}

export function formatModuleContextPromptBlock(settings, moduleId, { maxChars = 12000, linkedFrom = '' } = {}) {
  const files = (settings?.moduleContext?.[moduleId]?.files || []).filter((f) => f && !f.processing);
  const blobs = files.map((f) => {
    const blocks = listModuleContextBlocks(f).map(formatBlockForPrompt).filter(Boolean);
    if (!blocks.length) return '';
    return [`### ${f.name}${f.fileType ? ` (${f.fileType})` : ''}`, ...blocks].join('\n');
  }).filter(Boolean);
  if (!blobs.length) return '';
  let body = blobs.join('\n\n');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n\n[… module context truncated …]`;
  const header = linkedFrom
    ? `\n\nLINKED MODULE CONTEXT (${moduleId}) — shared because this user connected ${linkedFrom} with ${moduleId}. Treat it as mandatory background from that module. Do not contradict it. Do not name internal filenames to end users:\n`
    : `\n\nMODULE CONTEXT (${moduleId}) — user-provided guidance for this module. Treat it as mandatory background. Do not contradict it. Do not name internal filenames to end users:\n`;
  return `${header}${body}\n`;
}

export function formatLinkedModulesPromptBlock(settings, homeId, { stellaFiles = [], maxChars = 14000 } = {}) {
  const home = MODULE_CONTEXT_IDS.includes(homeId) ? homeId : 'incentives';
  const linked = connectedModuleIds(settings?.moduleConnections, home);
  const chunks = [];
  const homeBlock = formatModuleContextPromptBlock(settings, home, { maxChars: 8000 });
  if (homeBlock) chunks.push(homeBlock);
  for (const id of linked) {
    const other = formatModuleContextPromptBlock(settings, id, { maxChars: 4500, linkedFrom: home });
    if (other) chunks.push(other);
    if (id === 'stella' && home !== 'stella') {
      const goals = String(settings?.stellaBusinessContext?.keyGoals || '').trim();
      if (goals) {
        chunks.push(`\n\nLINKED STELLA ANALYSIS GOALS — use as background for what they want from data analysis:\n${goals}\n`);
      }
      const catalog = formatStellaSharePromptBlock(stellaFiles);
      if (catalog) chunks.push(catalog);
    }
  }
  if (!chunks.length) return '';
  let body = chunks.join('');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n\n[… linked context truncated …]`;
  return body;
}


export function knowledgeStemPattern(names = []) {
  const stems = (names || [])
    .map((n) => String(n || '').replace(/\.(md|ya?ml|txt)$/i, '').trim())
    .filter((s) => s.length >= 6)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_]/g, '[-_\\s]?'));
  if (!stems.length) return null;
  return new RegExp(`\\b(?:${stems.join('|')})\\b`, 'gi');
}
