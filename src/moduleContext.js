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
  if (t.length <= 240) {
    if (/\bto use this correctly i need a little context\b/i.test(lower)) return true;
    if (/\byou can answer them together or one at a time\b/i.test(lower)) return true;
  }
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

function compactStringList(val) {
  if (Array.isArray(val)) return val.map((m) => usefulString(m)).filter(Boolean);
  const s = usefulString(val);
  return s ? [s] : [];
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
  const metrics = compactStringList(base.key_metrics);
  const facts = compactStringList(base.key_facts);
  const out = {};
  const represents = usefulString(base.what_it_represents);
  const period = usefulString(base.time_period);
  const notes = usefulString(base.interpretation_notes);
  if (represents) out.what_it_represents = represents;
  if (period) out.time_period = period;
  if (facts.length) out.key_facts = facts;
  if (metrics.length) out.key_metrics = metrics;
  if (notes) out.interpretation_notes = notes;
  if (qa.length) out.qa_pairs = qa;
  return Object.keys(out).length ? out : undefined;
}

function mergeContextLines(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    const items = Array.isArray(list) ? list : (list ? [list] : []);
    for (const item of items) {
      const t = String(item || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

function parseNumberedParts(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const matches = [...t.matchAll(/(\d+)\s*[=:.)]\s+/g)];
  if (!matches.length) return [];
  const parts = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : t.length;
    const body = t.slice(start, end).replace(/[;,\s]+$/g, '').replace(/\s+/g, ' ').trim();
    if (body) parts.push(body);
  }
  return parts;
}

function harvestQaPairs(intakeMessages) {
  const msgs = Array.isArray(intakeMessages) ? intakeMessages : [];
  const pairs = [];
  const seen = new Set();
  const push = (q, a) => {
    const question = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 800);
    const answer = String(a || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (!answer) return;
    const key = `${question.toLowerCase()}|${answer.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ question: question || 'Clarification', answer });
  };
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i]?.role !== 'assistant') continue;
    const ansMsg = msgs.slice(i + 1).find((m) => m.role === 'user');
    if (!ansMsg) continue;
    const qs = parseNumberedParts(msgs[i].content);
    const as = parseNumberedParts(ansMsg.content);
    if (qs.length && as.length) {
      const n = Math.max(qs.length, as.length);
      for (let k = 0; k < n; k++) {
        push(qs[k] || qs[qs.length - 1] || 'Clarification', as[k] || as[as.length - 1]);
      }
    } else if (qs.length) {
      push(qs.join(' / '), ansMsg.content);
    } else {
      const lines = String(msgs[i].content || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const qLines = lines.filter((l) => /[?？]/.test(l));
      const question = qLines.length ? qLines.join(' ') : lines.slice(-3).join(' ');
      push(question, ansMsg.content);
    }
  }
  return pairs;
}

/** Merge model context_qa with assistant→user pairs from the intake thread. */
export function harvestModuleCapturedContext(prior, modelQa, intakeMessages) {
  const fromModel = modelQa && typeof modelQa === 'object' && !Array.isArray(modelQa) ? modelQa : {};
  const fromPrior = prior && typeof prior === 'object' ? prior : {};
  const harvestedQa = harvestQaPairs(intakeMessages);
  const qa_pairs = [];
  const seen = new Set();
  for (const p of [...(fromPrior.qa_pairs || []), ...(fromModel.qa_pairs || []), ...harvestedQa]) {
    if (!p || typeof p !== 'object') continue;
    const question = String(p.question || '').trim();
    const answer = String(p.answer || '').trim();
    if (!question && !answer) continue;
    const key = `${question.toLowerCase()}|${answer.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    qa_pairs.push({
      ...(question ? { question } : {}),
      ...(answer ? { answer } : {}),
    });
  }
  const answerFacts = harvestedQa
    .map((p) => p.answer)
    .filter((a) => {
      const t = String(a || '').trim();
      if (t.length < 4 || t.length > 280) return false;
      if (/^(yes|no|ok|okay|sure|thanks|looks good|that'?s (all|correct)|complete|done)[.!]?\s*$/i.test(t)) return false;
      return true;
    });
  return compactCapturedContext({
    ...fromPrior,
    ...fromModel,
    what_it_represents: fromModel.what_it_represents || fromPrior.what_it_represents,
    time_period: fromModel.time_period || fromPrior.time_period,
    interpretation_notes: fromModel.interpretation_notes || fromPrior.interpretation_notes,
    key_facts: mergeContextLines(fromPrior.key_facts, fromModel.key_facts, answerFacts),
    key_metrics: mergeContextLines(fromPrior.key_metrics, fromModel.key_metrics),
    qa_pairs,
  });
}

function intakeAssistantStillAsking(content) {
  const t = String(content || '').trim();
  if (!t) return false;
  if (/\bnow added to\b/i.test(t) || /\bis now added\b/i.test(t)) return false;
  return /[?？]/.test(t) || /\n\s*1[\.)]\s/.test(t);
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
  if (Array.isArray(raw.imageInventory) && raw.imageInventory.length) {
    rec.imageInventory = raw.imageInventory
      .slice(0, 80)
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const n = usefulString(row.name);
        if (!n) return null;
        const status = ['included', 'skipped', 'pending'].includes(row.status) ? row.status : 'skipped';
        return {
          name: n,
          status,
          ...(usefulString(row.purpose) ? { purpose: usefulString(row.purpose) } : {}),
          ...(usefulString(row.reason, 200) ? { reason: usefulString(row.reason, 200) } : {}),
        };
      })
      .filter(Boolean);
    if (!rec.imageInventory.length) delete rec.imageInventory;
  }
  const intakeMessages = Array.isArray(raw.intakeMessages)
    ? raw.intakeMessages
      .slice(-24)
      .map((m) => ({ role: m.role, content: capText(m.content, 4000) }))
      .filter((m) => m.role && String(m.content || '').trim())
    : [];
  if (intakeMessages.length) rec.intakeMessages = intakeMessages;
  if (raw.intakeComplete === false) rec.intakeComplete = false;
  else if (raw.intakeComplete) rec.intakeComplete = true;
  if (raw.processing) rec.processing = true;
  const captured = harvestModuleCapturedContext(raw.capturedContext, null, intakeMessages)
    || compactCapturedContext(raw.capturedContext);
  if (captured) rec.capturedContext = captured;
  const hasUserIntake = intakeMessages.some((m) => m.role === 'user');
  const lastAssistant = [...intakeMessages].reverse().find((m) => m.role === 'assistant');
  if (hasUserIntake && rec.intakeComplete === false && !intakeAssistantStillAsking(lastAssistant?.content)) {
    rec.intakeComplete = true;
  }
  if (Array.isArray(raw.columns) && raw.columns.length) {
    rec.columns = raw.columns
      .filter((c) => c && usefulString(c.name || c))
      .slice(0, 80)
      .map((c) => (typeof c === 'string'
        ? { name: usefulString(c) }
        : {
          name: usefulString(c.name),
          ...(usefulString(c.description) ? { description: usefulString(c.description) } : {}),
          ...(usefulString(c.type) ? { type: usefulString(c.type) } : {}),
        }))
      .filter((c) => c.name);
    if (!rec.columns.length) delete rec.columns;
  }
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
  if (rec.intakeComplete == null && !rec.processing && (rec.capturedContext || rec.notes?.length) && !(rec.intakeMessages || []).length) {
    rec.intakeComplete = true;
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

/** Disk shape: detected file content + curated blocks. Keep unfinished intake so Settings can continue it. */
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
  if (rec.imageInventory?.length) out.imageInventory = rec.imageInventory;
  if (rec.capturedContext) out.capturedContext = rec.capturedContext;
  if (rec.notes?.length) out.notes = rec.notes;
  if (rec.columns?.length) out.columns = rec.columns;
  if (rec.intakeComplete) out.intakeComplete = true;
  else if (rec.extractedText || rec.structuredExtract || rec.visionExtract || rec.capturedContext || rec.intakeMessages?.length) {
    out.intakeComplete = false;
    if (rec.intakeMessages?.length) out.intakeMessages = rec.intakeMessages;
  }
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
  const ctx = harvestModuleCapturedContext(f.capturedContext, null, f.intakeMessages) || f.capturedContext || {};
  const blocks = [];
  if (!isEmptyContextValue(ctx.what_it_represents)) blocks.push({ id: 'represents', label: 'What it represents', value: ctx.what_it_represents, line: true });
  if (!isEmptyContextValue(ctx.time_period)) blocks.push({ id: 'period', label: 'Time period', value: ctx.time_period, line: true });
  if (Array.isArray(ctx.key_facts) && ctx.key_facts.some((m) => !isEmptyContextValue(m))) {
    blocks.push({ id: 'facts', label: 'Key facts', value: ctx.key_facts.filter((m) => !isEmptyContextValue(m)).join('\n') });
  }
  if (Array.isArray(ctx.key_metrics) && ctx.key_metrics.some((m) => !isEmptyContextValue(m))) {
    blocks.push({ id: 'metrics', label: 'Key fields', value: ctx.key_metrics.filter((m) => !isEmptyContextValue(m)).join('\n') });
  }
  if (!isEmptyContextValue(ctx.interpretation_notes)) blocks.push({ id: 'interpretation', label: 'How to use', value: ctx.interpretation_notes });
  if (!isEmptyContextValue(f.summary)) blocks.push({ id: 'summary', label: 'Summary', value: f.summary });
  if (Array.isArray(ctx.name_maps) && ctx.name_maps.some((m) => m && (m.from || m.to))) {
    const maps = ctx.name_maps
      .filter((m) => m && (m.from || m.to))
      .map((m) => `${m.from || '?'} → ${m.to || '?'}${m.note ? ` (${m.note})` : ''}`)
      .join('\n');
    if (maps) blocks.push({ id: 'name_maps', label: 'Name maps', value: maps });
  }
  if (Array.isArray(ctx.relationships) && ctx.relationships.some((r) => r && (r.this_field || r.related_field))) {
    const joins = ctx.relationships
      .filter((r) => r && (r.this_field || r.related_field))
      .map((r) => `${r.this_field || '?'} = ${r.related_file || r.related_table || '?'}.${r.related_field || '?'}${r.note ? ` (${r.note})` : ''}`)
      .join('\n');
    if (joins) blocks.push({ id: 'joins', label: 'Joins', value: joins });
  }
  (ctx.qa_pairs || []).forEach((p, i) => {
    if (isEmptyContextValue(p?.question) && isEmptyContextValue(p?.answer)) return;
    blocks.push({ id: `qa:${i}`, label: 'Clarification', qa: true, question: p.question || '', answer: p.answer || '' });
  });
  (f.notes || []).forEach((n) => {
    if (!n || isEmptyContextValue(n.text)) return;
    blocks.push({ id: `note:${n.id}`, label: 'Comment', value: n.text });
  });
  if (!isEmptyContextValue(f.extractedText)) {
    blocks.push({ id: 'extractedText', label: 'Detected from file', value: f.extractedText, source: true });
  }
  if (!isEmptyContextValue(f.structuredExtract)) {
    blocks.push({ id: 'structuredExtract', label: 'Tables / charts', value: f.structuredExtract, source: true });
  }
  if (!isEmptyContextValue(f.visionExtract)) {
    blocks.push({ id: 'visionExtract', label: 'From images', value: f.visionExtract, source: true });
  }
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

/** Every module reachable from this one through hub links (undirected). Direct neighbors first. */
export function connectedComponentIds(connections, moduleId) {
  if (!MODULE_CONTEXT_IDS.includes(moduleId)) return [];
  const adj = new Map(MODULE_CONTEXT_IDS.map((id) => [id, []]));
  for (const c of mergeModuleConnections(connections)) {
    adj.get(c.a).push(c.b);
    adj.get(c.b).push(c.a);
  }
  const seen = new Set([moduleId]);
  const queue = [moduleId];
  const out = [];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of adj.get(cur) || []) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      queue.push(n);
    }
  }
  return out;
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

function oneSentence(text, max = 140) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const first = s.split(/(?<=\.)\s/)[0] || s;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

function stellaFileJoinKeys(f) {
  const rels = Array.isArray(f?.capturedContext?.relationships) ? f.capturedContext.relationships : [];
  const keys = [];
  const seen = new Set();
  for (const r of rels) {
    const k = String(r?.this_field || '').trim();
    if (!k) continue;
    const id = k.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push(k);
  }
  return keys;
}

function stellaJoinIndexLines(files, maxLines = 20) {
  const lines = [];
  const seen = new Set();
  for (const f of files || []) {
    const rels = Array.isArray(f?.capturedContext?.relationships) ? f.capturedContext.relationships : [];
    if (!f?.tableName) continue;
    for (const r of rels) {
      if (!r?.this_field || !r?.related_field) continue;
      const left = `${f.tableName}.${r.this_field}`;
      const rightTable = r.related_table || r.related_file;
      if (!rightTable) continue;
      const right = `${rightTable}.${r.related_field}`;
      const pair = [left, right].sort().join(' = ');
      if (seen.has(pair)) continue;
      seen.add(pair);
      lines.push(`- ${left} = ${right}${r.note ? ` — ${r.note}` : ''}`);
      if (lines.length >= maxLines) return lines;
    }
  }
  return lines;
}

export function formatStellaFileIndexLine(f) {
  const ctx = f?.capturedContext && typeof f.capturedContext === 'object' ? f.capturedContext : {};
  const purpose = oneSentence(ctx.what_it_represents) || oneSentence(f?.summary) || (f?.tableName ? 'tabular dataset' : 'document');
  const loc = f?.tableName ? `table ${f.tableName}` : 'document';
  const size = f?.rowCount != null ? `${f.rowCount} rows` : (f?.tableName ? 'table' : 'document');
  const keys = stellaFileJoinKeys(f).slice(0, 6).join(', ');
  return `- ${f?.name || 'file'} | ${loc} | ${size} | ${purpose}${keys ? ` | keys: ${keys}` : ''}`;
}

/** Compact directory of Stella files for prompts — not full catalogs. */
export function formatStellaFileIndex(files, { maxFiles = 40, maxChars = 4000, header = true } = {}) {
  const usable = (files || []).filter((f) => f && !f.processing);
  const shown = usable.slice(0, maxFiles);
  const omitted = Math.max(0, usable.length - shown.length);
  const lines = shown.map(formatStellaFileIndexLine);
  const joins = stellaJoinIndexLines(usable);
  const parts = [];
  if (header) {
    parts.push(`STELLA DATA INDEX (${usable.length} file${usable.length === 1 ? '' : 's'}) — directory only, not the numbers. Use get_file_context for columns/joins/notes, then inspect_table / run_sql / read_document for live facts. Never invent territory counts, product performance, or coverage from the index lines.`);
  }
  parts.push(...lines);
  if (omitted) parts.push(`… ${omitted} more file${omitted === 1 ? '' : 's'} not listed — call get_file_context with the file name from the user's question.`);
  if (joins.length) {
    parts.push('CONFIRMED JOINS:');
    parts.push(...joins);
  }
  let body = parts.join('\n');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n[… Stella index truncated — use get_file_context by file name …]`;
  return { body, fileCount: usable.length, shown: shown.length, omitted };
}

/** Full catalog card for one Stella file (tool result, not always-on prompt). */
export function formatStellaFileContextCard(f, { maxChars = 8000 } = {}) {
  if (!f) return '';
  const ctx = f.capturedContext && typeof f.capturedContext === 'object' ? f.capturedContext : {};
  const cols = (f.columns || []).map((c) => {
    if (typeof c === 'string') return `  - ${c}`;
    const orig = c.original && c.original !== c.name ? ` (source header: "${c.original}")` : '';
    const desc = c.description ? `: ${c.description}` : '';
    return `  - ${c.name}${orig} [${c.type || 'text'}]${desc}`;
  }).filter(Boolean);
  const metrics = Array.isArray(ctx.key_metrics) ? ctx.key_metrics.filter((m) => !isEmptyContextValue(m)) : [];
  const maps = Array.isArray(ctx.name_maps)
    ? ctx.name_maps.filter((m) => m && (m.from || m.to)).map((m) => `  - "${m.from || '?'}" = "${m.to || '?'}"${m.note ? ` (${m.note})` : ''}`)
    : [];
  const joins = Array.isArray(ctx.relationships)
    ? ctx.relationships
      .filter((r) => r && r.this_field && r.related_field)
      .map((r) => `  - ${r.this_field} = ${r.related_file || r.related_table}.${r.related_field}${r.note ? ` — ${r.note}` : ''}`)
    : [];
  const qa = Array.isArray(ctx.qa_pairs)
    ? ctx.qa_pairs.filter((p) => p && (p.question || p.answer)).slice(0, 12).map((p) => `  Q: ${p.question || ''}\n  A: ${p.answer || ''}`)
    : [];
  const location = f.tableName
    ? `SQL table: ${f.tableName}`
    : `Document (use read_document for full text; path: ${f.storagePath || 'n/a'})`;
  const parts = [
    `FILE: ${f.name}`,
    `Type: ${f.fileType || f.type || 'file'}`,
    location,
    f.rowCount != null ? `Rows: ${f.rowCount}` : '',
    !isEmptyContextValue(f.summary) ? `Summary: ${String(f.summary).replace(/\s+/g, ' ').trim()}` : '',
    cols.length ? `Columns:\n${cols.join('\n')}` : (f.tableName ? 'Columns: (none captured yet — inspect_table)' : 'Columns: (document)'),
    !isEmptyContextValue(ctx.what_it_represents) ? `What it represents: ${ctx.what_it_represents}` : '',
    !isEmptyContextValue(ctx.time_period) ? `Time period: ${ctx.time_period}` : '',
    metrics.length ? `Key metrics: ${metrics.join('; ')}` : '',
    maps.length ? `NAME MAPS (authoritative — treat mapped names as the same; apply in queries):\n${maps.join('\n')}` : '',
    joins.length ? `Confirmed joins:\n${joins.join('\n')}` : '',
    !isEmptyContextValue(ctx.interpretation_notes) ? `Interpretation notes: ${String(ctx.interpretation_notes).replace(/\s+/g, ' ').trim()}` : '',
    qa.length ? `Intake Q&A:\n${qa.join('\n')}` : '',
    (!f.tableName && !isEmptyContextValue(f.extractedText))
      ? `Extract (partial): ${String(f.extractedText).replace(/\s+/g, ' ').trim().slice(0, 1200)}`
      : '',
  ].filter(Boolean);
  let body = parts.join('\n');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n[… file context truncated …]`;
  return body;
}

export function findStellaFile(files, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const list = (files || []).filter((f) => f && !f.processing);
  const exact = list.find((f) => String(f.name || '').toLowerCase() === q)
    || list.find((f) => String(f.tableName || '').toLowerCase() === q)
    || list.find((f) => String(f.id || '').toLowerCase() === q);
  if (exact) return exact;
  return list.find((f) => String(f.name || '').toLowerCase().includes(q))
    || list.find((f) => String(f.tableName || '').toLowerCase().includes(q))
    || null;
}

export function formatStellaSharePromptBlock(files, { maxChars = 3500 } = {}) {
  const usable = (files || []).filter((f) => f && !f.processing);
  if (!usable.length) return '';
  const { body } = formatStellaFileIndex(usable, { maxFiles: 40, maxChars });
  return `\n\nLINKED STELLA DATA — Stella Insights is in this hub. The index below is a directory of live datasets. Use get_file_context for columns/joins/notes, then inspect_table / run_sql / read_document for live facts (territory counts, product performance, coverage). Do not invent extra tables or values. Do not mention SQL, table names, or tool names to the end user.\n${body}\nSQL: PostgreSQL SELECT only. Columns marked numeric are already numeric — never ROUND(...::float). For division: (SUM(x)::numeric / NULLIF(COUNT(*),0)).\n`;
}

export function listModuleLibraryFiles(settings, moduleId) {
  const id = MODULE_CONTEXT_IDS.includes(moduleId) ? moduleId : 'incentives';
  return (settings?.moduleContext?.[id]?.files || []).filter((f) => f && !f.processing);
}

export function formatModuleLibraryIndexLine(f, moduleId) {
  const ctx = f?.capturedContext && typeof f.capturedContext === 'object' ? f.capturedContext : {};
  const purpose = oneSentence(ctx.what_it_represents)
    || oneSentence((Array.isArray(ctx.key_facts) ? ctx.key_facts[0] : ''))
    || oneSentence(f?.summary)
    || oneSentence(f?.extractedText, 100)
    || (f?.fileType || 'document');
  const kind = f?.fileType || f?.kind || 'file';
  return `- ${f?.name || 'file'} | ${MODULE_CONTEXT_LABELS[moduleId] || moduleId} | ${kind} | ${purpose}`;
}

export function formatModuleLibraryIndex(settings, moduleId, { maxFiles = 40, maxChars = 2500, linkedFrom = '', role = 'linked' } = {}) {
  const files = listModuleLibraryFiles(settings, moduleId);
  if (!files.length) return '';
  const shown = files.slice(0, maxFiles);
  const omitted = Math.max(0, files.length - shown.length);
  const label = MODULE_CONTEXT_LABELS[moduleId] || moduleId;
  const header = role === 'home'
    ? `\n\nTHIS MODULE LIBRARY (${label}, ${files.length} file${files.length === 1 ? '' : 's'}) — directory only. Use get_file_context for the full extract, Q&A, and notes.\n`
    : `\n\nLINKED MODULE LIBRARY (${label}, ${files.length} file${files.length === 1 ? '' : 's'}) — shared both ways because this hub connects ${MODULE_CONTEXT_LABELS[linkedFrom] || linkedFrom} with ${label}. Directory only. Use get_file_context for the full file. Do not contradict it.\n`;
  const parts = [header.trimEnd(), ...shown.map((f) => formatModuleLibraryIndexLine(f, moduleId))];
  if (omitted) parts.push(`… ${omitted} more file${omitted === 1 ? '' : 's'} — call get_file_context with the file name.`);
  let body = parts.join('\n');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n[… library index truncated — use get_file_context by file name …]`;
  return `${body}\n`;
}

export function formatModuleContextCard(f, { maxChars = 8000 } = {}) {
  if (!f) return '';
  const moduleLabel = MODULE_CONTEXT_LABELS[f.hubModule] || f.hubModule || '';
  const blocks = listModuleContextBlocks(f).map(formatBlockForPrompt).filter(Boolean);
  const parts = [
    `FILE: ${f.name || 'file'}`,
    moduleLabel ? `Module: ${moduleLabel}` : '',
    `Type: ${f.fileType || f.type || 'document'}`,
    ...blocks,
  ].filter(Boolean);
  let body = parts.join('\n');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n[… file context truncated …]`;
  return body;
}

export function listHubContextFiles(settings, homeId, { stellaFiles = [], includeHome = true } = {}) {
  const home = MODULE_CONTEXT_IDS.includes(homeId) ? homeId : 'incentives';
  const linked = connectedComponentIds(settings?.moduleConnections, home);
  const scope = includeHome ? [home, ...linked] : linked;
  const out = [];
  const seen = new Set();
  const push = (f, hubModule, hubKind) => {
    if (!f || f.processing) return;
    const key = `${hubModule}|${f.id || f.tableName || f.name || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...f, hubModule, hubKind });
  };
  for (const id of scope) {
    if (id === 'stella') {
      for (const f of (stellaFiles || [])) push(f, 'stella', f?.tableName ? 'stella-table' : 'stella-doc');
    }
    for (const f of listModuleLibraryFiles(settings, id)) push(f, id, 'module-file');
  }
  return out;
}

export function findHubContextFile(hubFiles, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const list = (hubFiles || []).filter((f) => f && !f.processing);
  const exact = list.find((f) => String(f.name || '').toLowerCase() === q)
    || list.find((f) => String(f.tableName || '').toLowerCase() === q)
    || list.find((f) => String(f.id || '').toLowerCase() === q);
  if (exact) return exact;
  return list.find((f) => String(f.name || '').toLowerCase().includes(q))
    || list.find((f) => String(f.tableName || '').toLowerCase().includes(q))
    || null;
}

export function formatModuleContextPromptBlock(settings, moduleId, { maxChars = 12000, linkedFrom = '' } = {}) {
  const files = listModuleLibraryFiles(settings, moduleId);
  const blobs = files.map((f) => {
    const blocks = listModuleContextBlocks(f).map(formatBlockForPrompt).filter(Boolean);
    if (!blocks.length) return '';
    return [`### ${f.name}${f.fileType ? ` (${f.fileType})` : ''}`, ...blocks].join('\n');
  }).filter(Boolean);
  if (!blobs.length) return '';
  let body = blobs.join('\n\n');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n\n[… module context truncated …]`;
  const header = linkedFrom
    ? `\n\nLINKED MODULE CONTEXT (${MODULE_CONTEXT_LABELS[moduleId] || moduleId}) — shared because this user connected ${MODULE_CONTEXT_LABELS[linkedFrom] || linkedFrom} with ${MODULE_CONTEXT_LABELS[moduleId] || moduleId}. This is mandatory background from that module. Do not contradict it. Do not name internal filenames to end users:\n`
    : `\n\nMODULE CONTEXT (${MODULE_CONTEXT_LABELS[moduleId] || moduleId}) — user-provided guidance for this module. Treat it as mandatory background. Do not contradict it. Do not name internal filenames to end users:\n`;
  return `${header}${body}\n`;
}

export function formatLinkedModulesPromptBlock(settings, homeId, { stellaFiles = [], maxChars = 10000 } = {}) {
  const home = MODULE_CONTEXT_IDS.includes(homeId) ? homeId : 'incentives';
  const linked = connectedComponentIds(settings?.moduleConnections, home);
  const chunks = [];
  if (linked.length) {
    const names = linked.map((id) => MODULE_CONTEXT_LABELS[id] || id).join(', ');
    chunks.push(`\n\nCONNECTED MODULES — this ${MODULE_CONTEXT_LABELS[home] || home} session is in a two-way hub with ${names}. Scheme files, territory files, and Stella datasets flow both ways. Use get_file_context to load a file from the indexes below. If Stella is in the hub, use inspect_table / run_sql / read_document for live numbers. Never invent territory counts, product performance, coverage, scheme rules, or alignment facts those libraries would contain. Do not say you cannot see a linked module. Do not mention SQL, table names, or tool names to the end user.\n`);
  }
  if (home === 'stella') {
    const homeLib = formatModuleLibraryIndex(settings, 'stella', { role: 'home', maxChars: 2500 });
    if (homeLib) chunks.push(homeLib);
  } else {
    const homeLib = formatModuleLibraryIndex(settings, home, { role: 'home', maxChars: 2500 });
    if (homeLib) chunks.push(homeLib);
  }
  for (const id of linked) {
    if (id === 'stella') {
      const goals = String(settings?.stellaBusinessContext?.keyGoals || '').trim();
      if (goals) {
        chunks.push(`\n\nLINKED STELLA ANALYSIS GOALS — use as background for what they want from data analysis:\n${goals}\n`);
      }
      if (home !== 'stella') {
        const catalog = formatStellaSharePromptBlock(stellaFiles, { maxChars: 3500 });
        chunks.push(catalog || `\n\nLINKED STELLA DATA — Stella Insights is in this hub, but no Stella datasets are loaded in this session yet. You can still treat Stella as a linked module.\n`);
      }
    } else {
      const idx = formatModuleLibraryIndex(settings, id, { maxChars: 2500, linkedFrom: home, role: 'linked' });
      chunks.push(idx || `\n\nLINKED MODULE LIBRARY (${MODULE_CONTEXT_LABELS[id] || id}) — this hub connects ${MODULE_CONTEXT_LABELS[home] || home} with ${MODULE_CONTEXT_LABELS[id] || id}, but that module has no context files uploaded yet.\n`);
    }
  }
  if (!chunks.length) return '';
  let body = chunks.join('');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n\n[… linked context truncated …]`;
  return body;
}

/** Slim linked-module facts for Stella intake — enough to propose joins, not scheme design. */
export function formatLinkedModulesIntakeHint(settings, homeId = 'stella', { maxChars = 2800 } = {}) {
  const home = MODULE_CONTEXT_IDS.includes(homeId) ? homeId : 'stella';
  const linked = connectedComponentIds(settings?.moduleConnections, home).filter((id) => id !== home);
  if (!linked.length) return '';
  const names = linked.map((id) => MODULE_CONTEXT_LABELS[id] || id).join(', ');
  const parts = [
    `CONNECTED MODULES: ${names}. Check whether THIS file shares products, territories, accounts, reps, or IDs with those modules and propose those connections. Do not ask about incentive scheme design, quotas, payouts, KPIs, or analysis goals.`,
  ];
  for (const id of linked) {
    if (id === 'stella') continue;
    const files = (settings?.moduleContext?.[id]?.files || []).filter((f) => f && !f.processing);
    if (!files.length) {
      parts.push(`${MODULE_CONTEXT_LABELS[id] || id}: linked, no context files uploaded yet.`);
      continue;
    }
    for (const f of files.slice(0, 4)) {
      const extract = String(f.extractedText || f.structuredExtract || f.summary || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 420);
      parts.push(`${MODULE_CONTEXT_LABELS[id] || id} file "${f.name}": ${extract || '(no extract yet)'}`);
    }
  }
  let body = parts.join('\n');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n[… linked intake hint truncated …]`;
  return `\n\n${body}\n`;
}

export function stellaLinkedModuleQuestion(settings, homeId = 'stella') {
  const linked = connectedComponentIds(settings?.moduleConnections, homeId).filter((id) => id !== 'stella');
  if (!linked.length) return '';
  const names = linked.map((id) => MODULE_CONTEXT_LABELS[id] || id).join(' and ');
  const fileBits = [];
  for (const id of linked) {
    const files = (settings?.moduleContext?.[id]?.files || []).filter((f) => f && !f.processing);
    for (const f of files.slice(0, 2)) fileBits.push(`"${f.name}"`);
  }
  const from = fileBits.length ? ` — e.g. ${fileBits.join(', ')}` : '';
  return `This Stella workspace is linked to ${names}${from}. Can this file be connected to those modules (shared products, territories, accounts, or IDs), or should it stay independent?`;
}


export function knowledgeStemPattern(names = []) {
  const stems = (names || [])
    .map((n) => String(n || '').replace(/\.(md|ya?ml|txt)$/i, '').trim())
    .filter((s) => s.length >= 6)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_]/g, '[-_\\s]?'));
  if (!stems.length) return null;
  return new RegExp(`\\b(?:${stems.join('|')})\\b`, 'gi');
}
