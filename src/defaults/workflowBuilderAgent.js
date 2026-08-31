import { DEFAULT_ORCHESTRATOR_PROMPTS } from './topics';

/**
 * Hardcoded Admin → Workflows helper. Not a user-facing topic/agent in product JSON.
 * Actual workflows and specialists still live in topics/agents via persistIntelligenceSettings.
 */

export const WORKFLOW_BUILDER_WELCOME = `I'm the **Workflow agent**. I help you set up a new consultation workflow or edit one already stored in the product JSON.

Tell me:
1. **Create** a new workflow, or **edit** an existing one (you can also pick it in the dropdown above).
2. **What it is** — name, who uses it, and the outcome you want.
3. **Context and settings** it needs — uploaded files, knowledge, data, wait-for-answers vs auto-advance, anything the specialists must know.
4. Agents you already want **reused**, vs gaps that need a **new** specialist.

I'll propose a draft in the same style as Design New IC Scheme / Analyze Existing IC: numbered steps with a name, goal, success criteria, and one specialist each. I'll also propose agents (reuse or create) with role, system prompt, knowledge files, and any tools they need.

We can refine the draft until you're happy. **Apply** writes the workflow and any new agents into the product JSON.`;

export const WORKFLOW_BUILDER_SYSTEM = `You are the ComEx Workflow agent — an admin-only helper that designs consultation workflows for the product JSON.

You are NOT a user-facing specialist. You never run inside a live IC/Territory/Stella chat. Your job is to interview the admin, then produce a complete draft they can apply.

## What a workflow is in this product
Each workflow (topic) has:
- id (snake_case), name, description, triggerKeywords[], autoAdvance (boolean), status ("active"|"inactive")
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

## Interview first
Ask only what is still missing. Do not dump a full JSON draft on the first reply unless the admin already gave enough (purpose, outcome, create vs edit, wait vs auto-advance). Typical gaps: purpose, users, inputs/files, wait-for-answers vs pipeline, whether to reuse named agents, module (incentive vs territory).

When you have enough, set ready=true and fill workflow + newAgents completely (every step has an agent id; every new agent has a real systemPrompt, not a stub).

## Reuse vs create
Prefer reusing an existing agent when the role truly matches (e.g. compliance_agent for a compliance step). Create a new agent when the job is different — do not overload an existing specialist with a second unrelated job. If editing, you may propose updateAgents to tighten a prompt for this workflow; say so clearly in message.

## Tools and knowledge
- knowledgeFiles: only names listed in the catalog, or "*".
- tools: 1–6 short labels of capabilities the specialist needs (clarifying questions, document extract, tables, payout curves, territory metrics, etc.).
- Mention any Admin settings the workflow depends on (knowledge files, autoAdvance, trigger phrases).

## Output format (mandatory)
Reply with a single JSON object, no markdown fence, no text outside JSON:
{
  "message": "markdown shown to the admin (questions, or a readable draft summary)",
  "ready": false,
  "mode": "create" | "edit",
  "workflow": null | {
    "id": "snake_case",
    "name": "",
    "description": "",
    "triggerKeywords": [],
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
- message is always required and user-facing. Summarise the draft in message when ready (steps, agents, settings). Do not paste the raw JSON in message.
- ready=true only when workflow is complete (name, description, triggers, orchestrator role/goal/approach, every step name/goal/successCriteria/agent, and every referenced new agent fully specified).
- mode=edit must keep the existing workflow id from ADMIN FOCUS / catalog.
- mode=create must pick a new snake_case id that is not already in the catalog.
- newAgents ids must not collide with existing agents unless you intend updateAgents instead.
- Step agents[] must list exactly one id that is either existing or in newAgents.
- If not ready, still you MAY include a partial workflow sketch (ready=false) so the admin can see the direction.
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

export function summarizeWorkflowDraft(parsed) {
  const w = parsed?.workflow;
  if (!w) return '';
  const steps = Array.isArray(w.workflow) ? w.workflow : (Array.isArray(w.steps) ? w.steps : []);
  const newAgents = Array.isArray(parsed.newAgents) ? parsed.newAgents : [];
  const updateAgents = Array.isArray(parsed.updateAgents) ? parsed.updateAgents : [];
  const reuse = Array.isArray(parsed.reuseAgents) ? parsed.reuseAgents : [];
  const stepLines = steps.map((s) => {
    const agent = Array.isArray(s.agents) && s.agents[0] ? s.agents[0] : '(unassigned)';
    return `- **Step ${s.step}: ${s.name}** — ${s.goal || ''} (${agent})`;
  });
  const parts = [
    parsed.mode === 'edit' ? `**Edit** \`${w.id || ''}\`: ${w.name || ''}` : `**New workflow:** ${w.name || w.id || ''}`,
    w.description ? w.description : '',
    w.autoAdvance ? 'Auto-advance: on' : 'Auto-advance: off (wait for answers)',
    stepLines.length ? `**Steps**\n${stepLines.join('\n')}` : '',
    reuse.length ? `**Reuse:** ${reuse.map((a) => a.id).filter(Boolean).join(', ')}` : '',
    newAgents.length ? `**New agents:** ${newAgents.map((a) => a.name || a.id).join(', ')}` : '',
    updateAgents.length ? `**Update agents:** ${updateAgents.map((a) => a.name || a.id).join(', ')}` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

export function interpretWorkflowBuilderReply(text) {
  const parsed = parseJsonObject(text);
  if (!parsed) {
    const message = String(text || '').trim();
    return { message, ready: false, draft: null };
  }
  const workflow = parsed.workflow && typeof parsed.workflow === 'object' ? parsed.workflow : null;
  const ready = !!parsed.ready && !!workflow;
  const message = String(parsed.message || '').trim() || (workflow ? summarizeWorkflowDraft(parsed) : String(text || '').trim());
  return {
    message,
    ready,
    draft: workflow ? parsed : null,
  };
}

export function buildWorkflowBuilderCatalog({ topics = [], agents = [], knowledgeFiles = [], focusId = '' } = {}) {
  const topicLines = (topics || []).map((t) => {
    const steps = (t.workflow || []).map((s) => {
      const agent = Array.isArray(s.agents) && s.agents[0] ? s.agents[0] : '';
      return `    ${s.step}. ${s.name} [${agent}] goal=${s.goal || ''} | success=${s.successCriteria || ''}`;
    }).join('\n');
    const orch = t.orchestrator || {};
    return [
      `- id=${t.id} | ${t.name} | status=${t.status || 'active'} | autoAdvance=${!!t.autoAdvance}`,
      `  description: ${t.description || ''}`,
      `  triggers: ${(t.triggerKeywords || []).join(', ')}`,
      `  orchestrator.role: ${orch.role || ''}`,
      `  orchestrator.goal: ${orch.goal || ''}`,
      `  steps:\n${steps || '    (none)'}`,
    ].join('\n');
  });
  const agentLines = (agents || []).map((a) => {
    const tools = asStringArray(a.tools);
    return `- id=${a.id} | ${a.name} | ${a.role || ''} | knowledge=${(a.knowledgeFiles || []).join(', ') || '(none)'} | tools=${tools.join(', ') || '(none)'}\n  prompt: ${String(a.systemPrompt || '').slice(0, 280)}`;
  });
  const focus = focusId
    ? `ADMIN FOCUS: edit existing workflow id=${focusId}. Keep that id. Propose a full replacement draft (basics, orchestrator, steps, agents).`
    : 'ADMIN FOCUS: create a new workflow with a unique id not in the catalog.';
  return `${focus}

EXISTING WORKFLOWS:
${topicLines.join('\n') || '(none)'}

EXISTING AGENTS:
${agentLines.join('\n') || '(none)'}

AGENT-ELIGIBLE KNOWLEDGE FILES:
${(knowledgeFiles || []).length ? knowledgeFiles.join(', ') : '(none — leave knowledgeFiles empty or use * only if the admin will tick Agents on files later)'}

Shared orchestrator defaults (copy unless customising): introFull / introFocused / briefingPrompt / wrapUpPrompt / evalFallbackMessage already exist in the product; you may override intro/approach for this workflow.`;
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
  if (!draft || !draft.workflow || typeof draft.workflow !== 'object') {
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

  const wf = draft.workflow;
  const rawSteps = Array.isArray(wf.workflow) ? wf.workflow : (Array.isArray(wf.steps) ? wf.steps : []);
  const steps = normalizeSteps(rawSteps, agentIdMap);

  // Stub any step agent that still is not in the list
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

  const topic = {
    id: topicId,
    name: String(wf.name || topicId).trim() || topicId,
    description: String(wf.description || '').trim(),
    triggerKeywords: asStringArray(wf.triggerKeywords),
    autoAdvance: !!wf.autoAdvance,
    orchestrator: mergeOrchestrator(wf.orchestrator),
    workflow: steps,
    status: wf.status === 'inactive' ? 'inactive' : 'active',
  };

  const existingIdx = (topics || []).findIndex((t) => t.id === topicId);
  const nextTopics = [...(topics || [])];
  if (existingIdx >= 0) nextTopics[existingIdx] = topic;
  else nextTopics.push(topic);

  return {
    topics: nextTopics,
    agents: nextAgents,
    topic,
    createdAgentIds: created,
    mode: existingIdx >= 0 ? 'edit' : 'create',
  };
}
