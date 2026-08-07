import { DEFAULT_KNOWLEDGE, PILLAR_2_KNOWLEDGE } from './knowledge';
import { DEFAULT_SYSTEM_PROMPT } from './systemPrompt';
import { DEFAULT_AGENTS } from './agents';
import { DEFAULT_TOPICS } from './topics';
import {
  DEFAULT_WELCOME_MESSAGES,
  DEFAULT_PPTX_CLARIFY,
  DEFAULT_SUGGESTIONS,
  DEFAULT_WORKFLOW_RUNTIME,
  DEFAULT_STELLA_PROMPTS,
} from './runtimePrompts';

export {
  DEFAULT_KNOWLEDGE,
  PILLAR_2_KNOWLEDGE,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_AGENTS,
  DEFAULT_TOPICS,
  DEFAULT_WELCOME_MESSAGES,
  DEFAULT_PPTX_CLARIFY,
  DEFAULT_SUGGESTIONS,
  DEFAULT_WORKFLOW_RUNTIME,
  DEFAULT_STELLA_PROMPTS,
};

/** Intelligence / AI config nested under user settings JSON. */
export const DEFAULT_INTELLIGENCE_CONTEXT = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  agents: DEFAULT_AGENTS.map((a) => ({ ...a, knowledgeFiles: [...(a.knowledgeFiles || [])] })),
  topics: DEFAULT_TOPICS.map((t) => ({
    ...t,
    triggerKeywords: [...(t.triggerKeywords || [])],
    orchestrator: { ...(t.orchestrator || {}) },
    workflow: (t.workflow || []).map((s) => ({ ...s, agents: [...(s.agents || [])] })),
  })),
  knowledge: {
    defaultMarkdown: DEFAULT_KNOWLEDGE,
    pillar2Markdown: PILLAR_2_KNOWLEDGE,
  },
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
    knowledgeFiles: Array.isArray(a.knowledgeFiles) ? [...a.knowledgeFiles] : [],
    status: a.status || 'active',
  }));
}

function cloneTopics(list) {
  return (Array.isArray(list) ? list : []).map((t) => ({
    id: t.id,
    name: t.name || '',
    description: t.description || '',
    triggerKeywords: Array.isArray(t.triggerKeywords) ? [...t.triggerKeywords] : [],
    orchestrator: {
      role: t.orchestrator?.role || '',
      goal: t.orchestrator?.goal || '',
      approach: t.orchestrator?.approach || '',
    },
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
  if (!Array.isArray(partial) || partial.length === 0) {
    return cloneAgents(DEFAULT_AGENTS);
  }
  return cloneAgents(partial);
}

export function mergeTopics(partial) {
  if (!Array.isArray(partial) || partial.length === 0) {
    return cloneTopics(DEFAULT_TOPICS);
  }
  return cloneTopics(partial);
}

export function mergeKnowledge(partial) {
  const k = partial && typeof partial === 'object' ? partial : {};
  return {
    defaultMarkdown: k.defaultMarkdown != null ? String(k.defaultMarkdown) : DEFAULT_KNOWLEDGE,
    pillar2Markdown: k.pillar2Markdown != null ? String(k.pillar2Markdown) : PILLAR_2_KNOWLEDGE,
  };
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
    knowledge: mergeKnowledge(raw.knowledge),
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
