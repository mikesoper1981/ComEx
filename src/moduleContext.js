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
  const t = String(value || '');
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n[… truncated for stored context …]`;
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

function normalizeCapturedContext(ctx) {
  const base = ctx && typeof ctx === 'object' ? ctx : {};
  const qa = Array.isArray(base.qa_pairs)
    ? base.qa_pairs
      .filter((p) => p && (p.question || p.answer))
      .map((p) => ({ question: String(p.question || ''), answer: String(p.answer || '') }))
    : [];
  return {
    what_it_represents: String(base.what_it_represents || ''),
    time_period: String(base.time_period || ''),
    key_metrics: Array.isArray(base.key_metrics)
      ? base.key_metrics.map((m) => String(m || '')).filter(Boolean)
      : (base.key_metrics ? [String(base.key_metrics)] : []),
    interpretation_notes: String(base.interpretation_notes || ''),
    qa_pairs: qa,
  };
}

function normalizeContextFile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    fileType: String(raw.fileType || raw.kind || 'document'),
    sizeLabel: String(raw.sizeLabel || ''),
    storagePath: raw.storagePath || null,
    storageBucket: raw.storageBucket || 'intelligence',
    uploadedAt: raw.uploadedAt || new Date().toISOString(),
    summary: capText(raw.summary, EXTRACT_CAPS.summary),
    extractedText: capText(raw.extractedText, EXTRACT_CAPS.text),
    visionExtract: capText(raw.visionExtract, EXTRACT_CAPS.vision),
    structuredExtract: capText(raw.structuredExtract, EXTRACT_CAPS.structured),
    imageCount: Number(raw.imageCount) || 0,
    intakeMessages: Array.isArray(raw.intakeMessages)
      ? raw.intakeMessages.slice(-24).map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 4000) }))
      : [],
    intakeComplete: !!raw.intakeComplete,
    processing: !!raw.processing,
    capturedContext: normalizeCapturedContext(raw.capturedContext),
  };
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

export function formatModuleContextPromptBlock(settings, moduleId, { maxChars = 40000 } = {}) {
  const files = settings?.moduleContext?.[moduleId]?.files || [];
  const ready = files.filter((f) => f.summary || f.extractedText || f.intakeComplete);
  if (!ready.length) return '';
  const blobs = ready.map((f) => {
    const ctx = f.capturedContext || {};
    const qa = (ctx.qa_pairs || [])
      .filter((p) => p.question || p.answer)
      .map((p) => `Q: ${p.question}\nA: ${p.answer}`)
      .join('\n');
    return [
      `### ${f.name} (${f.fileType || 'file'})`,
      f.summary ? `Summary: ${f.summary}` : '',
      ctx.what_it_represents ? `Represents: ${ctx.what_it_represents}` : '',
      ctx.time_period ? `Time period: ${ctx.time_period}` : '',
      ctx.key_metrics?.length ? `Key fields: ${ctx.key_metrics.join('; ')}` : '',
      ctx.interpretation_notes ? `How to use: ${ctx.interpretation_notes}` : '',
      qa ? `User clarifications:\n${qa}` : '',
      f.extractedText ? `Extracted text:\n${f.extractedText}` : '',
      f.structuredExtract ? `Tables / charts:\n${f.structuredExtract}` : '',
      f.visionExtract ? `From images:\n${f.visionExtract}` : '',
    ].filter(Boolean).join('\n');
  });
  let body = blobs.join('\n\n');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n\n[… module context truncated …]`;
  return `\n\nMODULE CONTEXT (${moduleId}) — mandatory background the user uploaded for this module. Treat it as source of truth alongside USER SETTINGS. Do not contradict it. Do not name storage paths or internal filenames to end users:\n${body}\n`;
}

export function knowledgeStemPattern(names = []) {
  const stems = (names || [])
    .map((n) => String(n || '').replace(/\.(md|ya?ml|txt)$/i, '').trim())
    .filter((s) => s.length >= 6)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_]/g, '[-_\\s]?'));
  if (!stems.length) return null;
  return new RegExp(`\\b(?:${stems.join('|')})\\b`, 'gi');
}
