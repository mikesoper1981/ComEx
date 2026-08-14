import { DEFAULT_SYSTEM_PROMPT } from './systemPrompt';
import { DEFAULT_AGENTS } from './agents';
import { DEFAULT_TOPICS, DEFAULT_ORCHESTRATOR_PROMPTS } from './topics';
import {
  DEFAULT_WELCOME_MESSAGES,
  DEFAULT_PPTX_CLARIFY,
  DEFAULT_SUGGESTIONS,
  DEFAULT_WORKFLOW_RUNTIME,
  DEFAULT_STELLA_PROMPTS,
} from './runtimePrompts';

export {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_AGENTS,
  DEFAULT_TOPICS,
  DEFAULT_ORCHESTRATOR_PROMPTS,
  DEFAULT_WELCOME_MESSAGES,
  DEFAULT_PPTX_CLARIFY,
  DEFAULT_SUGGESTIONS,
  DEFAULT_WORKFLOW_RUNTIME,
  DEFAULT_STELLA_PROMPTS,
};

/** Map legacy numeric knowledge file ids → storage filenames. */
function normalizeKnowledgeFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((f) => {
    if (f === 1 || f === '1') return 'default-best-practices.md';
    if (f === 2 || f === '2') return 'pillar-2-strategic-alignment.md';
    return String(f);
  });
}

/** Intelligence / AI config nested under user settings JSON (knowledge lives in storage files, not here). */
export const DEFAULT_INTELLIGENCE_CONTEXT = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  agents: DEFAULT_AGENTS.map((a) => ({ ...a, knowledgeFiles: normalizeKnowledgeFiles(a.knowledgeFiles) })),
  topics: DEFAULT_TOPICS.map((t) => ({
    ...t,
    triggerKeywords: [...(t.triggerKeywords || [])],
    orchestrator: { ...(t.orchestrator || {}) },
    workflow: (t.workflow || []).map((s) => ({ ...s, agents: [...(s.agents || [])] })),
  })),
  welcomeMessages: { ...DEFAULT_WELCOME_MESSAGES },
  suggestions: { ...DEFAULT_SUGGESTIONS },
  pptxClarify: {
    prompt: DEFAULT_PPTX_CLARIFY.prompt,
    options: DEFAULT_PPTX_CLARIFY.options.map((o) => ({ ...o })),
  },
  workflowRuntime: { ...DEFAULT_WORKFLOW_RUNTIME },
  stellaPrompts: { ...DEFAULT_STELLA_PROMPTS },
};

function cloneAgents(list) {
  return (Array.isArray(list) ? list : []).map((a) => ({
    id: a.id,
    name: a.name || '',
    role: a.role || '',
    systemPrompt: a.systemPrompt != null ? String(a.systemPrompt) : '',
    knowledgeFiles: normalizeKnowledgeFiles(a.knowledgeFiles),
    status: a.status || 'active',
  }));
}

function cloneOrchestrator(orch) {
  const o = orch && typeof orch === 'object' ? orch : {};
  return {
    role: o.role != null ? String(o.role) : '',
    goal: o.goal != null ? String(o.goal) : '',
    approach: o.approach != null ? String(o.approach) : '',
    evaluatePrompt: o.evaluatePrompt != null ? String(o.evaluatePrompt) : DEFAULT_ORCHESTRATOR_PROMPTS.evaluatePrompt,
    introFull: o.introFull != null ? String(o.introFull) : DEFAULT_ORCHESTRATOR_PROMPTS.introFull,
    introFocused: o.introFocused != null ? String(o.introFocused) : DEFAULT_ORCHESTRATOR_PROMPTS.introFocused,
    briefingPrompt: o.briefingPrompt != null ? String(o.briefingPrompt) : DEFAULT_ORCHESTRATOR_PROMPTS.briefingPrompt,
    wrapUpPrompt: o.wrapUpPrompt != null ? String(o.wrapUpPrompt) : DEFAULT_ORCHESTRATOR_PROMPTS.wrapUpPrompt,
    evalFallbackMessage: o.evalFallbackMessage != null ? String(o.evalFallbackMessage) : DEFAULT_ORCHESTRATOR_PROMPTS.evalFallbackMessage,
  };
}

function cloneTopics(list) {
  return (Array.isArray(list) ? list : []).map((t) => ({
    id: t.id,
    name: t.name || '',
    description: t.description || '',
    triggerKeywords: Array.isArray(t.triggerKeywords) ? [...t.triggerKeywords] : [],
    autoAdvance: !!t.autoAdvance,
    orchestrator: cloneOrchestrator(t.orchestrator),
    workflow: Array.isArray(t.workflow)
      ? t.workflow.map((s) => ({
          step: s.step,
          name: s.name || '',
          agents: Array.isArray(s.agents) ? [...s.agents] : [],
          goal: s.goal || '',
          successCriteria: s.successCriteria || '',
        }))
      : [],
    status: t.status || 'active',
  }));
}

export function mergeAgents(partial) {
  const defaults = cloneAgents(DEFAULT_AGENTS);
  if (!Array.isArray(partial) || partial.length === 0) return defaults;
  const saved = cloneAgents(partial);
  const byId = new Map(saved.map((a) => [a.id, a]));
  // Backfill any new factory agents missing from older saved settings
  for (const d of defaults) {
    if (!byId.has(d.id)) byId.set(d.id, d);
  }
  const ordered = defaults.map((d) => byId.get(d.id)).filter(Boolean);
  for (const a of saved) {
    if (!defaults.some((d) => d.id === a.id)) ordered.push(a);
  }
  return ordered;
}

function mergeWorkflowSteps(saved, defaults) {
  if (!Array.isArray(defaults) || !defaults.length) {
    return Array.isArray(saved) ? saved : [];
  }
  if (!Array.isArray(saved) || !saved.length) return defaults.map((s) => ({ ...s, agents: [...(s.agents || [])] }));
  const maxSaved = Math.max(...saved.map((s) => Number(s.step) || 0), 0);
  const out = saved.map((s) => ({
    step: s.step,
    name: s.name || '',
    agents: Array.isArray(s.agents) ? [...s.agents] : [],
    goal: s.goal || '',
    successCriteria: s.successCriteria || '',
  }));
  // Append newer factory steps (e.g. Analyze IC step 4) when saved workflows are older
  for (const d of defaults) {
    if (Number(d.step) > maxSaved) {
      out.push({
        step: d.step,
        name: d.name || '',
        agents: Array.isArray(d.agents) ? [...d.agents] : [],
        goal: d.goal || '',
        successCriteria: d.successCriteria || '',
      });
    }
  }
  return out.sort((a, b) => (Number(a.step) || 0) - (Number(b.step) || 0));
}

export function mergeTopics(partial) {
  if (!Array.isArray(partial) || partial.length === 0) {
    return cloneTopics(DEFAULT_TOPICS);
  }
  const defaultById = Object.fromEntries(DEFAULT_TOPICS.map((t) => [t.id, t]));
  const mergedSaved = partial.map((t) => {
    const d = defaultById[t.id];
    if (!d) return t;
    return {
      ...t,
      autoAdvance: t.autoAdvance !== undefined ? t.autoAdvance : d.autoAdvance,
      orchestrator: cloneOrchestrator({
        ...d.orchestrator,
        ...(t.orchestrator || {}),
        role: t.orchestrator?.role || d.orchestrator?.role,
        goal: t.orchestrator?.goal || d.orchestrator?.goal,
        approach: t.orchestrator?.approach || d.orchestrator?.approach,
        evaluatePrompt: t.orchestrator?.evaluatePrompt || d.orchestrator?.evaluatePrompt,
        introFull: t.orchestrator?.introFull || d.orchestrator?.introFull,
        introFocused: t.orchestrator?.introFocused || d.orchestrator?.introFocused,
        briefingPrompt: t.orchestrator?.briefingPrompt || d.orchestrator?.briefingPrompt,
        wrapUpPrompt: t.orchestrator?.wrapUpPrompt || d.orchestrator?.wrapUpPrompt,
        evalFallbackMessage: t.orchestrator?.evalFallbackMessage || d.orchestrator?.evalFallbackMessage,
      }),
      workflow: mergeWorkflowSteps(t.workflow, d.workflow),
    };
  });
  const savedIds = new Set(partial.map((t) => t.id));
  for (const d of DEFAULT_TOPICS) {
    if (!savedIds.has(d.id)) mergedSaved.push(d);
  }
  return cloneTopics(mergedSaved);
}

export function mergeWelcomeMessages(partial) {
  const w = partial && typeof partial === 'object' ? partial : {};
  return {
    consultation: w.consultation != null ? String(w.consultation) : DEFAULT_WELCOME_MESSAGES.consultation,
    stella: w.stella != null ? String(w.stella) : DEFAULT_WELCOME_MESSAGES.stella,
  };
}

export function mergeSuggestions(partial) {
  const s = partial && typeof partial === 'object' ? partial : {};
  return {
    enabled: s.enabled !== undefined ? !!s.enabled : DEFAULT_SUGGESTIONS.enabled,
    max: Number.isFinite(Number(s.max)) ? Math.min(5, Math.max(1, Number(s.max))) : DEFAULT_SUGGESTIONS.max,
    systemPrompt: s.systemPrompt != null ? String(s.systemPrompt) : DEFAULT_SUGGESTIONS.systemPrompt,
    userPromptTemplate: s.userPromptTemplate != null ? String(s.userPromptTemplate) : DEFAULT_SUGGESTIONS.userPromptTemplate,
  };
}

export function mergePptxClarify(partial) {
  const c = partial && typeof partial === 'object' ? partial : {};
  const options = Array.isArray(c.options) && c.options.length
    ? c.options.map((o) => ({ value: String(o.value ?? ''), label: String(o.label ?? '') }))
    : DEFAULT_PPTX_CLARIFY.options.map((o) => ({ ...o }));
  return {
    prompt: c.prompt != null ? String(c.prompt) : DEFAULT_PPTX_CLARIFY.prompt,
    options,
  };
}

export function mergeWorkflowRuntime(partial) {
  const w = partial && typeof partial === 'object' ? partial : {};
  const out = { ...DEFAULT_WORKFLOW_RUNTIME };
  for (const key of Object.keys(DEFAULT_WORKFLOW_RUNTIME)) {
    if (w[key] != null) out[key] = String(w[key]);
  }
  // Refresh stale factory prompts that dropped scheme images / vision extracts
  const classify = String(out.proposalImageClassifyPrompt || '');
  if (classify.includes('Prefer false positives of') || classify.includes('DEFAULT: relevant=false')) {
    out.proposalImageClassifyPrompt = DEFAULT_WORKFLOW_RUNTIME.proposalImageClassifyPrompt;
  }
  const interpret = String(out.proposalImageInterpretPrompt || '');
  if (!/key points/i.test(interpret)) {
    out.proposalImageInterpretPrompt = DEFAULT_WORKFLOW_RUNTIME.proposalImageInterpretPrompt;
  }
  return out;
}

export function mergeStellaPrompts(partial) {
  const s = partial && typeof partial === 'object' ? partial : {};
  return {
    contentSummary: s.contentSummary != null ? String(s.contentSummary) : DEFAULT_STELLA_PROMPTS.contentSummary,
    intake: s.intake != null ? String(s.intake) : DEFAULT_STELLA_PROMPTS.intake,
    analyst: s.analyst != null ? String(s.analyst) : DEFAULT_STELLA_PROMPTS.analyst,
  };
}

/** Deep-merge intelligence fields from a loaded settings object. */
export function mergeIntelligenceContext(raw = {}) {
  return {
    systemPrompt: raw.systemPrompt != null ? String(raw.systemPrompt) : DEFAULT_SYSTEM_PROMPT,
    agents: mergeAgents(raw.agents),
    topics: mergeTopics(raw.topics),
    welcomeMessages: mergeWelcomeMessages(raw.welcomeMessages),
    suggestions: mergeSuggestions(raw.suggestions),
    pptxClarify: mergePptxClarify(raw.pptxClarify),
    workflowRuntime: mergeWorkflowRuntime(raw.workflowRuntime),
    stellaPrompts: mergeStellaPrompts(raw.stellaPrompts),
  };
}

export function fillTemplate(template, vars = {}) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => (
    vars[key] != null ? String(vars[key]) : ''
  ));
}

/** Filenames under /knowledge (and intelligence bucket) that power the KB. */
export const KNOWLEDGE_SEED_FILES = [
  'default-best-practices.md',
  'pillar-2-strategic-alignment.md',
];

export function isKnowledgeStorageFile(name) {
  const n = String(name || '').toLowerCase();
  if (!n || n.endsWith('/')) return false;
  if (n.includes('/') && !n.startsWith('knowledge/')) return false;
  if (n.endsWith('.json')) return false;
  if (n.startsWith('users/') || n === 'user-settings.json') return false;
  return /\.(md|txt|yml|yaml)$/i.test(n);
}

export function buildKnowledgeBaseFromDocuments(docs) {
  return (docs || [])
    .filter((d) => d.status === 'active' && d.content)
    .map((d) => `## ${d.name}\n${d.content}`)
    .join('\n\n');
}
