import { DEFAULT_SYSTEM_PROMPT } from './systemPrompt';
import { DEFAULT_AGENTS } from './agents';
import { DEFAULT_TOPICS, DEFAULT_ORCHESTRATOR_PROMPTS, normalizeTriggerMode, triggerModeLabel, workflowAllowsKeywordTrigger, workflowAllowsContextTrigger } from './topics';
import {
  WORKFLOW_BUILDER_WELCOME,
  WORKFLOW_BUILDER_WELCOME_AGENT,
  WORKFLOW_BUILDER_WELCOME_EDIT,
  buildWorkflowBuilderCatalog,
  buildWorkflowBuilderSystemPrompt,
  interpretWorkflowBuilderReply,
  applyWorkflowBuilderDraft,
  summarizeWorkflowDraft,
  slugifyId,
} from './workflowBuilderAgent';
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
  normalizeTriggerMode,
  triggerModeLabel,
  workflowAllowsKeywordTrigger,
  workflowAllowsContextTrigger,
  DEFAULT_WELCOME_MESSAGES,
  DEFAULT_PPTX_CLARIFY,
  DEFAULT_SUGGESTIONS,
  DEFAULT_WORKFLOW_RUNTIME,
  DEFAULT_STELLA_PROMPTS,
  WORKFLOW_BUILDER_WELCOME,
  WORKFLOW_BUILDER_WELCOME_AGENT,
  WORKFLOW_BUILDER_WELCOME_EDIT,
  buildWorkflowBuilderCatalog,
  buildWorkflowBuilderSystemPrompt,
  interpretWorkflowBuilderReply,
  applyWorkflowBuilderDraft,
  summarizeWorkflowDraft,
  slugifyId,
};

/** Filenames under /knowledge (and intelligence bucket) that power the KB. */
export const KNOWLEDGE_SEED_FILES = [
  'default-best-practices.md',
  'pillar-2-strategic-alignment.md',
];

/** Map legacy numeric knowledge file ids → storage filenames. */
function normalizeKnowledgeFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((f) => {
    if (f === 1 || f === '1') return 'default-best-practices.md';
    if (f === 2 || f === '2') return 'pillar-2-strategic-alignment.md';
    return String(f);
  });
}

const DEFAULT_KNOWLEDGE_FLAGS = { generalContext: true, agents: true };

/** Per-file access flags stored in product.json (not user settings). */
export function mergeKnowledgeAccess(raw = {}) {
  const map = {};
  const apply = (name, flags) => {
    const n = String(name || '').trim();
    if (!n) return;
    const f = flags && typeof flags === 'object' ? flags : {};
    map[n] = {
      generalContext: f.generalContext !== false,
      agents: f.agents !== false,
    };
  };
  if (Array.isArray(raw)) {
    for (const item of raw) apply(item?.name, item);
  } else if (raw && typeof raw === 'object') {
    for (const [name, flags] of Object.entries(raw)) apply(name, flags);
  }
  for (const seed of KNOWLEDGE_SEED_FILES) {
    if (!map[seed]) apply(seed, DEFAULT_KNOWLEDGE_FLAGS);
  }
  return map;
}

export function knowledgeFileFlags(access, name) {
  const n = String(name || '').trim();
  const flags = access && typeof access === 'object' ? access[n] : null;
  if (!flags || typeof flags !== 'object') return { ...DEFAULT_KNOWLEDGE_FLAGS };
  return {
    generalContext: flags.generalContext !== false,
    agents: flags.agents !== false,
  };
}

export function knowledgeFileAllowsGeneral(access, name) {
  return knowledgeFileFlags(access, name).generalContext;
}

export function knowledgeFileAllowsAgents(access, name) {
  return knowledgeFileFlags(access, name).agents;
}

export function filterKnowledgeDocuments(docs, access, role) {
  return (docs || []).filter((d) => {
    if (!d || d.status !== 'active' || !d.content) return false;
    if (role === 'general') return knowledgeFileAllowsGeneral(access, d.name);
    if (role === 'agents') return knowledgeFileAllowsAgents(access, d.name);
    return true;
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
  knowledgeAccess: mergeKnowledgeAccess({}),
};

function cloneAgents(list) {
  return (Array.isArray(list) ? list : []).map((a) => ({
    id: a.id,
    name: a.name || '',
    role: a.role || '',
    systemPrompt: a.systemPrompt != null ? String(a.systemPrompt) : '',
    knowledgeFiles: normalizeKnowledgeFiles(a.knowledgeFiles),
    tools: Array.isArray(a.tools) ? a.tools.map((t) => String(t || '').trim()).filter(Boolean) : [],
    status: a.status || 'active',
  }));
}

function cloneOrchestrator(orch) {
  const o = orch && typeof orch === 'object' ? orch : {};
  let wrapUpPrompt = o.wrapUpPrompt != null ? String(o.wrapUpPrompt) : DEFAULT_ORCHESTRATOR_PROMPTS.wrapUpPrompt;
  if (/brief, warm closing summary \(3-5 sentences\)/i.test(wrapUpPrompt)) {
    wrapUpPrompt = DEFAULT_ORCHESTRATOR_PROMPTS.wrapUpPrompt;
  }
  let introFull = o.introFull != null ? String(o.introFull) : DEFAULT_ORCHESTRATOR_PROMPTS.introFull;
  if (/Introduce yourself briefly \(1-2 sentences\)/i.test(introFull)
    || /Introduce yourself briefly as the IC analysis orchestrator \(1-2 sentences\)/i.test(introFull)) {
    introFull = o.introFull != null && /IC analysis orchestrator/i.test(introFull)
      ? (DEFAULT_TOPICS.find((t) => t.id === 'analyze_ic')?.orchestrator?.introFull || DEFAULT_ORCHESTRATOR_PROMPTS.introFull)
      : DEFAULT_ORCHESTRATOR_PROMPTS.introFull;
  }
  let introFocused = o.introFocused != null ? String(o.introFocused) : DEFAULT_ORCHESTRATOR_PROMPTS.introFocused;
  if (/Keep your introduction to 1 sentence/i.test(introFocused)) {
    introFocused = /specific territory/i.test(introFocused)
      ? (DEFAULT_TOPICS.find((t) => t.id === 'territory_assessment')?.orchestrator?.introFocused || DEFAULT_ORCHESTRATOR_PROMPTS.introFocused)
      : DEFAULT_ORCHESTRATOR_PROMPTS.introFocused;
  }
  return {
    role: o.role != null ? String(o.role) : '',
    goal: o.goal != null ? String(o.goal) : '',
    approach: o.approach != null ? String(o.approach) : '',
    evaluatePrompt: o.evaluatePrompt != null ? String(o.evaluatePrompt) : DEFAULT_ORCHESTRATOR_PROMPTS.evaluatePrompt,
    introFull,
    introFocused,
    briefingPrompt: o.briefingPrompt != null ? String(o.briefingPrompt) : DEFAULT_ORCHESTRATOR_PROMPTS.briefingPrompt,
    wrapUpPrompt,
    evalFallbackMessage: o.evalFallbackMessage != null ? String(o.evalFallbackMessage) : DEFAULT_ORCHESTRATOR_PROMPTS.evalFallbackMessage,
  };
}

function cloneTopics(list) {
  return (Array.isArray(list) ? list : []).map((t) => ({
    id: t.id,
    name: t.name || '',
    description: t.description || '',
    triggerKeywords: Array.isArray(t.triggerKeywords) ? [...t.triggerKeywords] : [],
    triggerMode: normalizeTriggerMode(t.triggerMode),
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
  return ordered.map((a) => {
    const d = defaults.find((x) => x.id === a.id);
    if (!d) return a;
    const prompt = String(a.systemPrompt || '');
    const staleLength = /keep responses SHORT/i.test(prompt)
      || /summarise it concisely and STOP/i.test(prompt)
      || (/full plan overviews/i.test(prompt) && /Explain complex concepts simply with examples/i.test(prompt));
    if (staleLength) return { ...a, systemPrompt: d.systemPrompt };
    return a;
  });
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
  let stella = w.stella != null ? String(w.stella) : DEFAULT_WELCOME_MESSAGES.stella;
  if (/define your \*\*Business Context\*\*/i.test(stella)) {
    stella = DEFAULT_WELCOME_MESSAGES.stella;
  }
  return {
    consultation: w.consultation != null ? String(w.consultation) : DEFAULT_WELCOME_MESSAGES.consultation,
    stella,
  };
}

export function mergeSuggestions(partial) {
  const s = partial && typeof partial === 'object' ? partial : {};
  let systemPrompt = s.systemPrompt != null ? String(s.systemPrompt) : DEFAULT_SUGGESTIONS.systemPrompt;
  let userPromptTemplate = s.userPromptTemplate != null ? String(s.userPromptTemplate) : DEFAULT_SUGGESTIONS.userPromptTemplate;
  // Refresh stale factory copy that forbade questions and leaked knowledge-file names into chips
  if (systemPrompt.includes('Do NOT write assistant-style clarifying questions')
    || systemPrompt.includes('No hardcoded generic IC trivia')
    || systemPrompt.includes('How would a 110% accelerator')
    || !/concrete detail/i.test(systemPrompt)
    || !/NEVER name knowledge files/i.test(systemPrompt)
    || !/Do NOT ask the user to supply missing/i.test(systemPrompt)) {
    systemPrompt = DEFAULT_SUGGESTIONS.systemPrompt;
    userPromptTemplate = DEFAULT_SUGGESTIONS.userPromptTemplate;
  }
  return {
    enabled: s.enabled !== undefined ? !!s.enabled : DEFAULT_SUGGESTIONS.enabled,
    max: Number.isFinite(Number(s.max)) ? Math.min(5, Math.max(1, Number(s.max))) : DEFAULT_SUGGESTIONS.max,
    systemPrompt,
    userPromptTemplate,
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
  if (!/casual questions/i.test(String(out.matchDetectorPrompt || ''))
    || /You detect if a user message matches one of these workflows/i.test(String(out.matchDetectorPrompt || ''))
    || /Two valid match types/i.test(String(out.matchDetectorPrompt || ''))
    || /"matched":"keyword"/i.test(String(out.matchDetectorPrompt || ''))
    || !/CONVERSATION CONTEXT/i.test(String(out.matchDetectorPrompt || ''))
    || !/"reason"/i.test(String(out.matchDetectorPrompt || ''))) {
    out.matchDetectorPrompt = DEFAULT_WORKFLOW_RUNTIME.matchDetectorPrompt;
  }
  if (!/unless this step or your role specifies/i.test(String(out.agentTaskWrapper || ''))) {
    out.agentTaskWrapper = DEFAULT_WORKFLOW_RUNTIME.agentTaskWrapper;
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
  const contextSummary = String(out.contextContentSummaryPrompt || '');
  const contextIntake = String(out.contextIntakePrompt || '');
  if (contextSummary.includes('simple team list')
    || contextSummary.includes('incentive design, payouts')
    || contextSummary.includes('2-4 sentences describing')
    || contextSummary.includes('suggestedQuestions only for a gap that would block')
    || contextSummary.includes('Always put 1–3 clarifying questions')
    || contextSummary.includes('year, plan/product, audience, currency')
    || contextIntake.includes('which plan/product, audience')
    || contextIntake.includes('Never set complete=true')
    || !/key_facts/i.test(contextSummary)
    || !/Never ask IC design/i.test(contextIntake)
    || !/harvest facts from this file/i.test(contextIntake)
    || !/incentive schemes/i.test(contextIntake)
    || !/key_facts/i.test(contextIntake)
    || !/FIRST TURN/i.test(contextIntake)
    || !/Never put JSON/i.test(contextIntake)
    || !/one-line confirmation that the file is now added/i.test(contextIntake)
    || !/Omit or leave empty any field with no real answer/i.test(contextIntake)) {
    out.contextContentSummaryPrompt = DEFAULT_WORKFLOW_RUNTIME.contextContentSummaryPrompt;
    out.contextIntakePrompt = DEFAULT_WORKFLOW_RUNTIME.contextIntakePrompt;
  }
  const contextClassify = String(out.contextImageClassifyPrompt || '');
  if (!/AUTO-INCLUDE/i.test(contextClassify) || !/strategy or IC/i.test(contextClassify)) {
    out.contextImageClassifyPrompt = DEFAULT_WORKFLOW_RUNTIME.contextImageClassifyPrompt;
  }
  return out;
}

export function mergeStellaPrompts(partial) {
  const s = partial && typeof partial === 'object' ? partial : {};
  const out = {
    contentSummary: s.contentSummary != null ? String(s.contentSummary) : DEFAULT_STELLA_PROMPTS.contentSummary,
    intake: s.intake != null ? String(s.intake) : DEFAULT_STELLA_PROMPTS.intake,
    analyst: s.analyst != null ? String(s.analyst) : DEFAULT_STELLA_PROMPTS.analyst,
  };
  if (/You are a data onboarding assistant/i.test(out.contentSummary)
      && (/MUST return 3-5 suggestedQuestions/i.test(out.contentSummary)
        || /units, time period, definitions, or caveats/i.test(out.contentSummary)
        || /meaning and INTENT/i.test(out.contentSummary)
        || /Ask only about file structure/i.test(out.contentSummary)
        || !/Prefer an empty list over padding/i.test(out.contentSummary)
        || !/Never use a fixed list of must-ask questions/i.test(out.contentSummary))) {
    out.contentSummary = DEFAULT_STELLA_PROMPTS.contentSummary;
  }
  if (/You are the Stella Insights data intake agent/i.test(out.intake)
      && (/key metrics \/ important fields/i.test(out.intake)
        || /how the data should be interpreted/i.test(out.intake)
        || /Concentrate only on/i.test(out.intake)
        || !/name_maps/i.test(out.intake)
        || !/sample VALUES overlap/i.test(out.intake)
        || !/incentive schemes, quotas, payouts/i.test(out.intake)
        || !/Never join measures/i.test(out.intake)
        || !/Typical gaps \(guidance only/i.test(out.intake))) {
    out.intake = DEFAULT_STELLA_PROMPTS.intake;
  }
  if (/Use ## headers, bullet points, concise explanations/i.test(out.analyst)
      || !/NAME MAPS already captured/i.test(out.analyst)
      || !/unless this question or your instructions specify/i.test(out.analyst)
      || !/CONNECTED MODULES/i.test(out.analyst)
      || !/get_file_context/i.test(out.analyst)
      || !/two-way hub/i.test(out.analyst)
      || !/the renderer infers/i.test(out.analyst)) {
    out.analyst = DEFAULT_STELLA_PROMPTS.analyst;
  }
  return out;
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
    knowledgeAccess: mergeKnowledgeAccess(raw.knowledgeAccess),
  };
}

export function fillTemplate(template, vars = {}) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => (
    vars[key] != null ? String(vars[key]) : ''
  ));
}

export function isKnowledgeStorageFile(name) {
  const n = String(name || '').toLowerCase();
  if (!n || n.endsWith('/')) return false;
  if (n.includes('/') && !n.startsWith('knowledge/')) return false;
  if (n.endsWith('.json')) return false;
  if (n.startsWith('users/') || n === 'user-settings.json' || n === 'product.json') return false;
  return /\.(md|txt|yml|yaml)$/i.test(n);
}

export function buildKnowledgeBaseFromDocuments(docs, { access, role, hideNames = false } = {}) {
  const list = role
    ? filterKnowledgeDocuments(docs, access, role)
    : (docs || []).filter((d) => d && d.status === 'active' && d.content);
  return list
    .map((d, i) => (hideNames ? `## Best-practice guidance ${i + 1}\n${d.content}` : `## ${d.name}\n${d.content}`))
    .join('\n\n');
}
