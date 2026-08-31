import { DEFAULT_ORCHESTRATOR_PROMPTS, normalizeTriggerMode, triggerModeLabel, workflowAllowsKeywordTrigger } from './topics';

/**
 * Hardcoded Admin → Workflows helper. Not a user-facing topic/agent in product JSON.
 * Actual workflows and specialists still live in topics/agents via persistIntelligenceSettings.
 */

export const WORKFLOW_BUILDER_WELCOME = `I'm the **Workflow agent**. We'll create a **new workflow** and write it into the product JSON.

Tell me:
1. **What it is** — name, who uses it, and the outcome you want.
2. **How it should start** — **keyword only**, **context only** (the situation in chat), or **both**. Then the phrases and/or the situation.
3. **Settings** — files, knowledge, wait-for-answers vs auto-advance, start **enabled** or **disabled**.
4. Specialists — I'll **reuse** existing agents when the job matches, and **create new ones** when a step needs something we don't have.

I'll propose steps in the same style as Design New IC / Analyze Existing IC, plus orchestrator copy and triggers. **Apply** saves the workflow and any new agents.`;

export const WORKFLOW_BUILDER_WELCOME_AGENT = `I'm the **Workflow agent**. We'll create a **new specialist agent only** — not a workflow. You can assign it to a workflow later.

Tell me:
1. **Name and job** — what this specialist owns, and what is out of scope.
2. **How it should behave** — numbered questions vs auto-advance gaps, tables, STOP when done.
3. **Tools and knowledge** it needs (capability labels + existing knowledge files, or none).

I'll draft id, role, system prompt, knowledge files, and tools. **Apply** writes the agent into the product JSON.`;

export const WORKFLOW_BUILDER_WELCOME_EDIT = `We'll **edit** the workflow you picked. I have its full record (basics, status, **trigger mode**, trigger keywords, description/context cue, orchestrator, every step, assigned agents and their prompts).

Tell me what to change — purpose, **how it is triggered** (keyword only, context only, or both), steps, agents, orchestrator, auto-advance, or **enable / disable**. I'll propose a complete updated draft. **Apply** overwrites that workflow in the product JSON.`;

export const WORKFLOW_BUILDER_SYSTEM = `You are the ComEx Workflow agent — an admin-only helper that designs consultation workflows for the product JSON.

You are NOT a user-facing specialist. You never run inside a live IC/Territory/Stella chat. Your job is to interview the admin, then produce a complete draft they can apply.

## What a workflow is in this product
Each workflow (topic) has:
- id (snake_case), name, description, triggerKeywords[], triggerMode ("keyword"|"context"|"both"), autoAdvance (boolean), status ("active"|"inactive")
- orchestrator: role, goal, approach, plus shared prompt fields (introFull, introFocused, briefingPrompt, wrapUpPrompt, evalFallbackMessage). Leave evaluatePrompt unchanged unless they explicitly need a custom evaluator.
- workflow[] steps: { step, name, agents: [one agent id], goal, successCriteria }

Each specialist agent has:
- id, name, role, systemPrompt, knowledgeFiles[] (existing filenames or "*"), status
- tools[] — short capability labels stored on the agent for admins (runtime uses knowledge files + the system prompt; tools document what the specialist needs: e.g. "numbered clarifying questions", "proposal image extract", "markdown recommendations table", "uploaded IC document")

## Style to copy (existing factory workflows)
Steps are short, sequential, one specialist each. Examples:
- Gather Requirements / Design Structure / Validate Compliance / Fairness Check / Create Documentation
- Extract & Analyze / Compliance Check / Generate Report / Recommendations Summary
Goals are one line. successCriteria are concrete checklists the orchestrator can judge.

Agent system prompts:
- State YOUR ONLY JOB / YOUR SCOPE and what is OUT OF SCOPE (later steps own those).
- When finished, STOP. Never announce handoffs, next agents, or workflow steps.
- If the workflow waits for the user: numbered questions 1. 2. 3. … then wait.
- If autoAdvance: do not wait; record INFORMATION GAPS instead of inventing facts.
- Match USER ANSWER DETAIL for user-visible prose.
- Use ## headers, tables, **bold** where it helps.

Orchestrator:
- role: "You are the Workflow Orchestrator for …"
- goal: the end-to-end outcome
- approach: how to evaluate steps, when agentStillWorking, when workflowComplete (ONLY on the last step)
- If autoAdvance: say specialists must not wait for clarifying answers.

## Triggers (keyword only, context only, or both)
Chat can offer a workflow in two ways. Set \`triggerMode\` to exactly one of:
- **keyword** — only if the user's message **contains** a \`triggerKeywords[]\` phrase (case-insensitive, phrase length ≥ 4). Conversation context is ignored.
- **context** — only if a matcher reads recent conversation plus this workflow's **name** and **description** and decides they want this guided process. Keyword phrases are ignored.
- **both** — either path can offer it (keyword first, then context). This is the default if the admin does not choose.

Keywords: natural phrases people would type, not single generic words like "help" or "ic". Typical: 3–6 phrases. Examples: "design an incentive", "assess my ic", "territory assessment".
Context: write \`description\` as the *situation* that should offer this workflow (e.g. "Assess uploaded IC documents against best practices"), not a vague slogan.

Rules:
- Always ask **keyword only / context only / both** if the admin has not said. Do not assume both.
- If triggerMode is keyword or both: collect at least two keyword phrases. Propose phrases if they are unsure.
- If triggerMode is context or both: write a description that states when chat should offer this workflow.
- If triggerMode is context: keywords are optional (may keep them for later). If triggerMode is keyword: still write a short description as the workflow summary.
- Do not copy another workflow's trigger phrases (for keyword or both). If overlap is unavoidable, warn them in \`message\`.
- File upload / UI buttons are separate start paths; still set triggerMode for chat.
- Preserve existing triggerMode and triggerKeywords on edit unless the admin wants them changed.

## Enable / disable
Workflows have status "active" (offered to users) or "inactive" (hidden until enabled). Include status in every workflow draft. Honour "disable it" / "enable it" / "keep it off until we're ready".

## Interview first
Follow ADMIN INTENT. Ask only what is still missing. Do not dump a full JSON draft on the first reply unless the admin already gave enough.

When you have enough, set ready=true:
- create / edit: fill workflow completely (including status, triggerMode, description, and triggerKeywords when that mode needs them) and any newAgents.
- create_agent: workflow MUST be null; newAgents has one or more complete specialists (name, role, systemPrompt, knowledgeFiles, tools). Do not invent a workflow.
- Do **not** set ready=true until triggerMode is set (keyword | context | both) and the matching fields are settled (keywords for keyword/both; description-as-context for context/both).

## Reuse vs create
Prefer reusing an existing agent when the role truly matches (e.g. compliance_agent for a compliance step). Create a new agent automatically when a step needs a job that no existing specialist owns — do not wait for a separate "new agent" action, and do not overload an existing specialist with a second unrelated job. If editing, you may propose updateAgents to tighten a prompt for this workflow; say so clearly in message.

## Keep edit replies small
When mode=edit:
- Do NOT copy unchanged agent systemPrompts into newAgents or updateAgents. Only include an agent there if you are creating it or changing its prompt/tools/knowledge.
- Do NOT copy shared orchestrator fields (evaluatePrompt, introFull, introFocused, briefingPrompt, wrapUpPrompt, evalFallbackMessage) unless the admin asked to change them. Role/goal/approach are enough.
- Preserve unspecified fields from WORKFLOW UNDER EDIT (id, status, steps not mentioned, assigned agents).

## Tools and knowledge
- knowledgeFiles: only names listed in the catalog, or "*".
- tools: 1–6 short labels of capabilities the specialist needs (clarifying questions, document extract, tables, payout curves, territory metrics, etc.).
- Mention any Admin settings the workflow depends on (knowledge files, autoAdvance, **triggerMode, trigger phrases, context/description**).

## Output format (mandatory)
Reply with a single JSON object, no markdown fence, no text outside JSON:
{
  "message": "markdown shown to the admin (questions, or a readable draft summary)",
  "ready": false,
  "mode": "create" | "edit" | "create_agent",
  "workflow": null | {
    "id": "snake_case",
    "name": "",
    "description": "",
    "triggerKeywords": [],
    "triggerMode": "both",
    "autoAdvance": false,
    "status": "active",
    "orchestrator": {
      "role": "",
      "goal": "",
      "approach": "",
      "introFull": "",
      "introFocused": "",
      "briefingPrompt": "",
      "wrapUpPrompt": "",
      "evalFallbackMessage": ""
    },
    "workflow": [
      { "step": 1, "name": "", "goal": "", "successCriteria": "", "agents": ["agent_id"] }
    ]
  },
  "newAgents": [
    {
      "id": "snake_case_agent",
      "name": "",
      "role": "",
      "systemPrompt": "",
      "knowledgeFiles": [],
      "tools": [],
      "status": "active"
    }
  ],
  "updateAgents": [],
  "reuseAgents": [{ "id": "", "reason": "" }]
}

Rules:
- message is always required and user-facing. Summarise the draft in message when ready. Do not paste the raw JSON in message.
- ready=true for create/edit only when workflow is complete (name, description, status, **triggerMode**, keywords if mode is keyword or both, description-as-context if mode is context or both, orchestrator role/goal/approach, every step name/goal/successCriteria/agent, and every referenced NEW agent fully specified). Existing assigned agents need not be restated.
- ready=true for create_agent when each newAgents entry has id, name, role, and a real systemPrompt (not a stub). workflow must be null.
- mode=edit must keep the existing workflow id from ADMIN INTENT / WORKFLOW UNDER EDIT. Preserve unspecified fields from that dump. Omit unchanged prompts from the JSON.
- mode=create must pick a new snake_case id that is not already in the catalog.
- mode=create_agent never writes a workflow.
- newAgents ids must not collide with existing agents unless you intend updateAgents instead.
- Step agents[] must list exactly one id that is either existing or in newAgents.
- If not ready, you MAY include a partial sketch (ready=false).
- Never invent knowledge filenames that are not in the catalog.`;

function parseJsonObject(text) {
  if (!text) return null;
  const raw = String(text).trim();
  try {
    const direct = JSON.parse(raw);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  } catch { /* fall through */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }
  const first = raw.indexOf('{');
  if (first < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = first; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(raw.slice(first, i + 1));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch { return null; }
      }
    }
  }
  return null;
}

export function slugifyId(raw, used) {
  const taken = used instanceof Set ? used : new Set();
  let base = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  if (!base) base = 'item';
  if (/^[0-9]/.test(base)) base = `w_${base}`;
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  taken.add(id);
  return id;
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value)
    .split(/[\n,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function usableTriggerKeywords(value) {
  const seen = new Set();
  const out = [];
  for (const raw of asStringArray(value)) {
    const key = raw.toLowerCase();
    if (raw.length < 4 || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function workflowTriggersSettled(wf, mode) {
  if (!wf || typeof wf !== 'object') return false;
  const isEdit = mode === 'edit';
  const triggerMode = normalizeTriggerMode(wf.triggerMode);
  const desc = String(wf.description || '').trim();
  const hasKwField = Object.prototype.hasOwnProperty.call(wf, 'triggerKeywords');
  const kws = usableTriggerKeywords(wf.triggerKeywords);
  const needsKw = triggerMode === 'keyword' || triggerMode === 'both';
  const needsDesc = triggerMode === 'context' || triggerMode === 'both';
  const descOk = needsDesc
    ? (isEdit ? (wf.description == null || desc.length >= 8) : desc.length >= 8)
    : true;
  const kwOk = needsKw
    ? (isEdit ? (!hasKwField || kws.length >= 2) : kws.length >= 2)
    : true;
  return descOk && kwOk;
}

function triggerOverlapLines(topics) {
  const byPhrase = new Map();
  for (const t of topics || []) {
    if (!workflowAllowsKeywordTrigger(t)) continue;
    for (const kw of usableTriggerKeywords(t.triggerKeywords)) {
      const key = kw.toLowerCase();
      if (!byPhrase.has(key)) byPhrase.set(key, []);
      byPhrase.get(key).push(t.id);
    }
  }
  const lines = [];
  for (const [phrase, ids] of byPhrase) {
    if (ids.length > 1) lines.push(`  "${phrase}" → ${ids.join(', ')}`);
  }
  return lines;
}

export function summarizeWorkflowDraft(parsed) {
  const newAgents = Array.isArray(parsed?.newAgents) ? parsed.newAgents : [];
  const updateAgents = Array.isArray(parsed?.updateAgents) ? parsed.updateAgents : [];
  const reuse = Array.isArray(parsed?.reuseAgents) ? parsed.reuseAgents : [];
  const w = parsed?.workflow;
  if (!w) {
    if (!newAgents.length && !updateAgents.length) return '';
    const lines = newAgents.map((a) => {
      const tools = asStringArray(a.tools);
      return `- **${a.name || a.id}** — ${a.role || ''}${tools.length ? ` (tools: ${tools.join(', ')})` : ''}`;
    });
    return [`**New specialist agent${newAgents.length === 1 ? '' : 's'}**`, ...lines].join('\n');
  }
  const steps = Array.isArray(w.workflow) ? w.workflow : (Array.isArray(w.steps) ? w.steps : []);
  const stepLines = steps.map((s) => {
    const agent = Array.isArray(s.agents) && s.agents[0] ? s.agents[0] : '(unassigned)';
    return `- **Step ${s.step}: ${s.name}** — ${s.goal || ''} (${agent})`;
  });
  const kws = usableTriggerKeywords(w.triggerKeywords);
  const parts = [
    parsed.mode === 'edit' ? `**Edit** \`${w.id || ''}\`: ${w.name || ''}` : `**New workflow:** ${w.name || w.id || ''}`,
    `**Start from chat:** ${triggerModeLabel(w.triggerMode)}`,
    w.description ? `**Context (when chat should offer it):** ${w.description}` : '',
    kws.length
      ? `**Keyword triggers:** ${kws.join(' · ')}`
      : (parsed.mode === 'edit' && w.triggerKeywords == null
        ? ''
        : (normalizeTriggerMode(w.triggerMode) === 'context'
          ? '**Keyword triggers:** none (context only)'
          : '**Keyword triggers:** (none yet — ask the admin for phrases users would type)')),
    `Status: ${w.status === 'inactive' ? 'disabled (inactive)' : 'enabled (active)'}`,
    w.autoAdvance ? 'Auto-advance: on' : 'Auto-advance: off (wait for answers)',
    stepLines.length ? `**Steps**\n${stepLines.join('\n')}` : '',
    reuse.length ? `**Reuse:** ${reuse.map((a) => a.id).filter(Boolean).join(', ')}` : '',
    newAgents.length ? `**New agents:** ${newAgents.map((a) => a.name || a.id).join(', ')}` : '',
    updateAgents.length ? `**Update agents:** ${updateAgents.map((a) => a.name || a.id).join(', ')}` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

function agentDraftComplete(agent) {
  if (!agent || typeof agent !== 'object') return false;
  return !!(String(agent.name || '').trim() && String(agent.systemPrompt || '').trim());
}

export function interpretWorkflowBuilderReply(text) {
  const parsed = parseJsonObject(text);
  if (!parsed) {
    const message = String(text || '').trim();
    return { message, ready: false, draft: null };
  }
  const workflow = parsed.workflow && typeof parsed.workflow === 'object' ? parsed.workflow : null;
  const newAgents = Array.isArray(parsed.newAgents) ? parsed.newAgents : [];
  const agentOnly = parsed.mode === 'create_agent' || (!workflow && newAgents.length > 0);
  const ready = !!parsed.ready && (agentOnly
    ? newAgents.some(agentDraftComplete)
    : (!!workflow && workflowTriggersSettled(workflow, parsed.mode)));
  const message = String(parsed.message || '').trim() || ((workflow || agentOnly) ? summarizeWorkflowDraft(parsed) : String(text || '').trim());
  return {
    message,
    ready,
    draft: (workflow || agentOnly) ? parsed : null,
  };
}

const SHARED_ORCHESTRATOR_KEYS = [
  'introFull', 'introFocused', 'briefingPrompt', 'wrapUpPrompt', 'evalFallbackMessage', 'evaluatePrompt',
];

function compactOrchestrator(orch) {
  const o = orch && typeof orch === 'object' ? orch : {};
  const out = {
    role: String(o.role || ''),
    goal: String(o.goal || ''),
    approach: String(o.approach || ''),
  };
  const customShared = {};
  for (const key of SHARED_ORCHESTRATOR_KEYS) {
    const val = o[key] != null ? String(o[key]) : '';
    const def = DEFAULT_ORCHESTRATOR_PROMPTS[key] != null ? String(DEFAULT_ORCHESTRATOR_PROMPTS[key]) : '';
    if (val && val !== def) customShared[key] = val;
  }
  if (Object.keys(customShared).length) out.customSharedPrompts = customShared;
  return out;
}

export function dumpWorkflowForEdit(topic, agents = []) {
  if (!topic) return '';
  const orch = topic.orchestrator && typeof topic.orchestrator === 'object' ? topic.orchestrator : {};
  const steps = (topic.workflow || []).map((s) => ({
    step: s.step,
    name: s.name || '',
    goal: s.goal || '',
    successCriteria: s.successCriteria || '',
    agents: Array.isArray(s.agents) ? [...s.agents] : [],
  }));
  const agentIds = [...new Set(steps.flatMap((s) => s.agents))];
  const assignedAgents = agentIds.map((id) => {
    const a = (agents || []).find((x) => x.id === id);
    if (!a) return { id, missing: true };
    return {
      id: a.id,
      name: a.name || '',
      role: a.role || '',
      status: a.status || 'active',
      knowledgeFiles: Array.isArray(a.knowledgeFiles) ? a.knowledgeFiles : [],
      tools: asStringArray(a.tools),
      systemPrompt: String(a.systemPrompt || ''),
    };
  });
  return JSON.stringify({
    id: topic.id,
    name: topic.name || '',
    description: topic.description || '',
    status: topic.status || 'active',
    autoAdvance: !!topic.autoAdvance,
    triggerKeywords: Array.isArray(topic.triggerKeywords) ? topic.triggerKeywords : [],
    triggerMode: normalizeTriggerMode(topic.triggerMode),
    triggerNote: 'triggerMode is keyword | context | both. keyword = user message contains a phrase (≥4 chars). context = conversation matcher uses name + description. both = either (keyword first). File/UI starts are separate.',
    orchestrator: compactOrchestrator(orch),
    steps,
    assignedAgents,
  }, null, 2);
}

export function buildWorkflowBuilderCatalog({ topics = [], agents = [], knowledgeFiles = [], intent = 'create', focusId = '' } = {}) {
  const topicLines = (topics || [])
    .filter((t) => !(intent === 'edit' && focusId && t.id === focusId))
    .map((t) => {
      const steps = (t.workflow || []).map((s) => {
        const agent = Array.isArray(s.agents) && s.agents[0] ? s.agents[0] : '';
        return `    ${s.step}. ${s.name} [${agent}]`;
      }).join('\n');
      const kws = usableTriggerKeywords(t.triggerKeywords);
      return [
        `- id=${t.id} | ${t.name} | status=${t.status || 'active'} | autoAdvance=${!!t.autoAdvance} | triggerMode=${normalizeTriggerMode(t.triggerMode)}`,
        `  context: ${t.description || '(none)'}`,
        `  keywords: ${kws.join(', ') || '(none)'}`,
        `  steps:\n${steps || '    (none)'}`,
      ].join('\n');
    });
  const agentLines = (agents || []).map((a) => {
    const tools = asStringArray(a.tools);
    return `- id=${a.id} | ${a.name} | ${a.role || ''} | knowledge=${(a.knowledgeFiles || []).join(', ') || '(none)'} | tools=${tools.join(', ') || '(none)'}`;
  });
  const intentLine = intent === 'create_agent'
    ? 'ADMIN INTENT: create_agent — draft specialist agent(s) only. Do not create or edit a workflow. mode=create_agent, workflow=null.'
    : intent === 'edit'
      ? `ADMIN INTENT: edit existing workflow id=${focusId}. Keep that id. Propose a full replacement draft including status (active/inactive) and triggerMode (keyword | context | both) plus the matching phrases and/or context description. Ask if how it starts should change.`
      : 'ADMIN INTENT: create a new workflow with a unique id not in the catalog. Include status (default active unless the admin wants it disabled). You MUST interview for triggerMode (keyword only, context only, or both) and the matching keywords/description before ready=true.';
  const overlap = triggerOverlapLines(topics);
  const overlapBlock = overlap.length
    ? `\n\nKEYWORD OVERLAPS (do not copy these collisions onto a new workflow):\n${overlap.join('\n')}`
    : '';
  const focusTopic = focusId ? (topics || []).find((t) => t.id === focusId) : null;
  const dump = (intent === 'edit' && focusTopic)
    ? `\n\nWORKFLOW UNDER EDIT (complete current record — preserve ids and any field the admin does not change):\n${dumpWorkflowForEdit(focusTopic, agents)}`
    : '';
  return `${intentLine}

TRIGGER MODEL: triggerMode is keyword | context | both. keyword = the user message contains a triggerKeywords phrase (case-insensitive, phrase length ≥ 4). context = a matcher reads recent conversation plus name and description (the "when" / situation line). both = either path (keyword first). File upload and UI start are separate. Do not reuse another keyword-enabled workflow's phrases.

EXISTING WORKFLOWS (compact):
${topicLines.join('\n') || '(none)'}${overlapBlock}

EXISTING AGENTS (compact):
${agentLines.join('\n') || '(none)'}

AGENT-ELIGIBLE KNOWLEDGE FILES:
${(knowledgeFiles || []).length ? knowledgeFiles.join(', ') : '(none — leave knowledgeFiles empty or use * only if the admin will tick Agents on files later)'}

Shared orchestrator defaults (copy unless customising): introFull / introFocused / briefingPrompt / wrapUpPrompt / evalFallbackMessage already exist in the product; you may override intro/approach for this workflow.${dump}`;
}

export function buildWorkflowBuilderSystemPrompt(catalog) {
  return `${WORKFLOW_BUILDER_SYSTEM}

---
CURRENT PRODUCT JSON (live catalog — treat as source of truth)
${catalog}
`;
}

function mergeOrchestrator(partial) {
  const o = partial && typeof partial === 'object' ? partial : {};
  return {
    ...DEFAULT_ORCHESTRATOR_PROMPTS,
    role: String(o.role || '').trim() || 'You are the Workflow Orchestrator.',
    goal: String(o.goal || '').trim() || 'Complete every step against its success criteria.',
    approach: String(o.approach || '').trim() || 'EVALUATING STEPS: After each agent responds, assess output against that step\'s success criteria. WORKFLOW END: Only mark workflowComplete when the last step has passed.',
    introFull: o.introFull != null && String(o.introFull).trim() ? String(o.introFull) : DEFAULT_ORCHESTRATOR_PROMPTS.introFull,
    introFocused: o.introFocused != null && String(o.introFocused).trim() ? String(o.introFocused) : DEFAULT_ORCHESTRATOR_PROMPTS.introFocused,
    briefingPrompt: o.briefingPrompt != null && String(o.briefingPrompt).trim() ? String(o.briefingPrompt) : DEFAULT_ORCHESTRATOR_PROMPTS.briefingPrompt,
    wrapUpPrompt: o.wrapUpPrompt != null && String(o.wrapUpPrompt).trim() ? String(o.wrapUpPrompt) : DEFAULT_ORCHESTRATOR_PROMPTS.wrapUpPrompt,
    evalFallbackMessage: o.evalFallbackMessage != null && String(o.evalFallbackMessage).trim() ? String(o.evalFallbackMessage) : DEFAULT_ORCHESTRATOR_PROMPTS.evalFallbackMessage,
    evaluatePrompt: o.evaluatePrompt != null && String(o.evaluatePrompt).trim() ? String(o.evaluatePrompt) : DEFAULT_ORCHESTRATOR_PROMPTS.evaluatePrompt,
  };
}

function defaultNewAgentPrompt(name, role) {
  const label = name || role || 'specialist';
  return `You are the ${label}. YOUR ONLY JOB is this workflow step. Do not do later steps. When you need information from the user, number questions 1. 2. 3. … and wait unless auto-advance is on (then record INFORMATION GAPS — never invent facts). Match USER ANSWER DETAIL. When your deliverable meets the step success criteria, STOP. Never announce handoffs or what other agents will do.`;
}

function normalizeAgentRecord(raw, { usedIds, knowledgeNames, keepId }) {
  const used = usedIds instanceof Set ? usedIds : new Set();
  const id = keepId
    ? String(raw.id || '').trim()
    : slugifyId(raw.id || raw.name, used);
  if (keepId && id) used.add(id);
  const knowledgeFiles = asStringArray(raw.knowledgeFiles).filter((f) => f === '*' || !knowledgeNames || knowledgeNames.size === 0 || knowledgeNames.has(f));
  return {
    id,
    name: String(raw.name || id).trim() || id,
    role: String(raw.role || '').trim(),
    systemPrompt: String(raw.systemPrompt || '').trim() || defaultNewAgentPrompt(raw.name, raw.role),
    knowledgeFiles,
    tools: asStringArray(raw.tools),
    status: raw.status === 'inactive' ? 'inactive' : 'active',
  };
}

function normalizeSteps(rawSteps, agentIdMap) {
  const list = Array.isArray(rawSteps) ? rawSteps : [];
  return list.map((s, i) => {
    const rawAgents = Array.isArray(s.agents) ? s.agents : (s.agents ? [s.agents] : []);
    const mapped = rawAgents
      .map((id) => agentIdMap.get(String(id)) || String(id || '').trim())
      .filter(Boolean)
      .slice(0, 1);
    return {
      step: i + 1,
      name: String(s.name || `Step ${i + 1}`).trim(),
      goal: String(s.goal || '').trim(),
      successCriteria: String(s.successCriteria || '').trim(),
      agents: mapped,
    };
  });
}

/**
 * Merge a builder draft into live topics/agents arrays.
 * Does not persist — caller should persistIntelligenceSettings.
 */
export function applyWorkflowBuilderDraft({ topics = [], agents = [], draft, knowledgeNames = [] } = {}) {
  if (!draft || typeof draft !== 'object') {
    throw new Error('The draft is not ready to apply.');
  }
  const knowledgeSet = new Set(Array.isArray(knowledgeNames) ? knowledgeNames : []);
  const usedAgentIds = new Set((agents || []).map((a) => a.id));
  const usedTopicIds = new Set((topics || []).map((t) => t.id));
  const agentIdMap = new Map();
  let nextAgents = (agents || []).map((a) => ({ ...a, tools: asStringArray(a.tools), knowledgeFiles: [...(a.knowledgeFiles || [])] }));

  const updates = Array.isArray(draft.updateAgents) ? draft.updateAgents : [];
  for (const raw of updates) {
    const id = String(raw.id || '').trim();
    const idx = nextAgents.findIndex((a) => a.id === id);
    if (idx < 0) continue;
    const merged = normalizeAgentRecord({ ...nextAgents[idx], ...raw, id }, {
      usedIds: usedAgentIds,
      knowledgeNames: knowledgeSet,
      keepId: true,
    });
    nextAgents[idx] = { ...nextAgents[idx], ...merged, id };
  }

  const created = [];
  const newAgents = Array.isArray(draft.newAgents) ? draft.newAgents : [];
  for (const raw of newAgents) {
    const requested = String(raw.id || '').trim();
    const exists = nextAgents.find((a) => a.id === requested);
    if (exists && requested) {
      agentIdMap.set(requested, requested);
      continue;
    }
    const createdAgent = normalizeAgentRecord(raw, {
      usedIds: usedAgentIds,
      knowledgeNames: knowledgeSet,
      keepId: false,
    });
    if (requested && createdAgent.id !== requested) agentIdMap.set(requested, createdAgent.id);
    agentIdMap.set(createdAgent.id, createdAgent.id);
    nextAgents.push(createdAgent);
    created.push(createdAgent.id);
  }

  const agentOnly = draft.mode === 'create_agent';
  if (agentOnly) {
    if (!created.length && !updates.length) {
      throw new Error('The agent draft is not ready to apply.');
    }
    const createdAgents = created.map((id) => nextAgents.find((a) => a.id === id)).filter(Boolean);
    return {
      topics: [...(topics || [])],
      agents: nextAgents,
      topic: null,
      createdAgentIds: created,
      createdAgents,
      mode: 'create_agent',
    };
  }

  const wf = draft.workflow;
  if (!wf || typeof wf !== 'object') {
    throw new Error('The draft is not ready to apply.');
  }
  const rawSteps = Array.isArray(wf.workflow) ? wf.workflow : (Array.isArray(wf.steps) ? wf.steps : []);
  const steps = normalizeSteps(rawSteps, agentIdMap);

  for (const step of steps) {
    const aid = step.agents[0];
    if (!aid) continue;
    if (nextAgents.some((a) => a.id === aid)) continue;
    const stub = normalizeAgentRecord({
      id: aid,
      name: aid.replace(/_/g, ' '),
      role: `Specialist for ${step.name}`,
      systemPrompt: defaultNewAgentPrompt(step.name, ''),
      knowledgeFiles: [],
      tools: [],
    }, { usedIds: usedAgentIds, knowledgeNames: knowledgeSet, keepId: false });
    agentIdMap.set(aid, stub.id);
    step.agents = [stub.id];
    nextAgents.push(stub);
    created.push(stub.id);
  }

  const mode = draft.mode === 'edit' ? 'edit' : 'create';
  const requestedTopicId = String(wf.id || '').trim();
  let topicId;
  if (mode === 'edit' && requestedTopicId && usedTopicIds.has(requestedTopicId)) {
    topicId = requestedTopicId;
  } else if (mode === 'edit' && requestedTopicId) {
    topicId = requestedTopicId;
    usedTopicIds.add(topicId);
  } else {
    topicId = usedTopicIds.has(requestedTopicId)
      ? slugifyId(wf.name || requestedTopicId || 'workflow', usedTopicIds)
      : slugifyId(requestedTopicId || wf.name || 'workflow', usedTopicIds);
  }

  const existingIdx = (topics || []).findIndex((t) => t.id === topicId);
  const existing = existingIdx >= 0 ? topics[existingIdx] : null;
  const topic = {
    id: topicId,
    name: String(wf.name || existing?.name || topicId).trim() || topicId,
    description: wf.description != null ? String(wf.description).trim() : String(existing?.description || ''),
    triggerKeywords: wf.triggerKeywords != null ? usableTriggerKeywords(wf.triggerKeywords) : [...(existing?.triggerKeywords || [])],
    triggerMode: wf.triggerMode != null ? normalizeTriggerMode(wf.triggerMode) : normalizeTriggerMode(existing?.triggerMode),
    autoAdvance: wf.autoAdvance != null ? !!wf.autoAdvance : !!existing?.autoAdvance,
    orchestrator: mergeOrchestrator({
      ...(existing?.orchestrator || {}),
      ...(wf.orchestrator || {}),
    }),
    workflow: steps.length
      ? steps
      : (existing?.workflow || []).map((s) => ({
          step: s.step,
          name: s.name || '',
          goal: s.goal || '',
          successCriteria: s.successCriteria || '',
          agents: Array.isArray(s.agents) ? [...s.agents] : [],
        })),
    status: wf.status != null
      ? (wf.status === 'inactive' ? 'inactive' : 'active')
      : (existing?.status || 'active'),
  };

  const nextTopics = [...(topics || [])];
  if (existingIdx >= 0) nextTopics[existingIdx] = topic;
  else nextTopics.push(topic);

  return {
    topics: nextTopics,
    agents: nextAgents,
    topic,
    createdAgentIds: created,
    createdAgents: created.map((id) => nextAgents.find((a) => a.id === id)).filter(Boolean),
    mode: existingIdx >= 0 ? 'edit' : 'create',
  };
}
