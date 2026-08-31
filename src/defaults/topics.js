/** Shared factory seeds for orchestrator prompt fields (copied into each workflow). */
export const DEFAULT_ORCHESTRATOR_PROMPTS = {
  evaluatePrompt: `Respond in JSON only:
{
  "agentStillWorking": true/false,
  "stepComplete": true/false,
  "reason": "brief internal reason",
  "rerouteToStep": null,
  "rerouteBriefing": "",
  "handoffs": [],
  "buttons": [{ "label": "...", "action": "...", "requiresInput": false, "inputPrompt": "" }],
  "orchestratorMessage": "",
  "workflowComplete": false
}

CRITICAL — waiting on the user:
- If the agent asked the user any clarifying/open questions (especially a numbered 1. 2. 3. list), or is clearly waiting for answers, set agentStillWorking=true, stepComplete=false, orchestratorMessage="", buttons=[].
- Do NOT say the stage is finished and do NOT offer Continue/Proceed while questions are unanswered.
- Only set agentStillWorking=false when the agent has produced a substantive deliverable for this step's success criteria AND is not asking the user for more input.

If agentStillWorking is true, set orchestratorMessage to "" and buttons to [].
When agentStillWorking is false, write orchestratorMessage and 2-4 buttons.
Button "action" values MUST be exactly one of: "proceed", "refine", "redesign", "override" (never "continue", "next", or free text).
Include at least one proceed button and one refine button.

CRITICAL — multi-step workflows:
- workflowComplete=true ONLY when the current step is the LAST step in the workflow AND its success criteria are met.
- If more steps remain, workflowComplete MUST be false even if the agent wrote a long/comprehensive answer.
- Judge the agent only against THIS step's success criteria — do not treat an early step as finishing the whole workflow.`,
  introFull: 'Introduce yourself and state the overall goal. Do NOT list the workflow steps yourself — they are appended separately from the plan. Match USER ANSWER DETAIL: Executive = 1–2 sentences; Standard = short goal intro; Teaching = brief why this workflow and what the user will get. Do not write a full report.',
  introFocused: 'The user has already selected a specific focus. Match USER ANSWER DETAIL for the intro (Executive = 1 sentence; Teaching may add why this focus matters). Do NOT list workflow steps — they are appended separately.',
  briefingPrompt: 'Prepare a focused task briefing for the next specialist agent. Be specific and concise (3-5 sentences max). This is an internal handoff, not a user-facing reply.',
  wrapUpPrompt: 'The workflow is now complete. Write a closing summary covering what was accomplished. Match USER ANSWER DETAIL: Executive = verdict + bullets; Standard = what was done and key outcomes; Teaching = what was done, why it matters, and what happens next. Do not pad beyond that level.',
  evalFallbackMessage: 'The agent has completed its work. How would you like to proceed?',
};

function withOrchestratorPrompts(partial) {
  return {
    ...DEFAULT_ORCHESTRATOR_PROMPTS,
    ...partial,
  };
}

/** How chat may offer this workflow: keyword phrases, conversation context, or either. */
export function normalizeTriggerMode(value) {
  const v = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (v === 'keyword' || v === 'keywords' || v === 'keyword_only') return 'keyword';
  if (v === 'context' || v === 'conversation' || v === 'context_only') return 'context';
  return 'both';
}

export function triggerModeLabel(mode) {
  const m = normalizeTriggerMode(mode);
  if (m === 'keyword') return 'Keyword only';
  if (m === 'context') return 'Context only';
  return 'Keywords and context';
}

export function workflowAllowsKeywordTrigger(topic) {
  return normalizeTriggerMode(topic?.triggerMode) !== 'context';
}

export function workflowAllowsContextTrigger(topic) {
  return normalizeTriggerMode(topic?.triggerMode) !== 'keyword';
}

export const DEFAULT_TOPICS = [
  {
    id: 'design_ic',
    name: 'Design New IC Scheme',
    description: 'End-to-end incentive compensation scheme creation',
    triggerKeywords: ['design scheme', 'design an incentive', 'create ic', 'new incentive', 'build scheme'],
    triggerMode: 'both',
    orchestrator: withOrchestratorPrompts({
      role: 'You are the Workflow Orchestrator for IC scheme design.',
      goal: 'Ensure the final scheme meets all compliance rules, fairness standards, and the user\'s business requirements.',
      approach: 'EVALUATING STEPS: After each agent responds, assess their output strictly against the step\'s success criteria. IF THE AGENT ASKED THE USER A QUESTION: set agentStillWorking=true, stepComplete=false, and do not offer Continue — wait for the user\'s answer. WORKFLOW END: Only mark workflowComplete when all steps have passed.',
    }),
    workflow: [
      { step: 1, name: 'Gather Requirements', agents: ['requirements_agent'], goal: 'Collect all necessary information', successCriteria: 'Clear answers to: How many reps? What products? Strategic priorities?' },
      { step: 2, name: 'Design Structure', agents: ['design_agent'], goal: 'Create IC scheme with 3-5 components', successCriteria: 'Draft scheme with components, weightings summing to 100%, metric types' },
      { step: 3, name: 'Validate Compliance', agents: ['compliance_agent'], goal: 'Check scheme against ALL mandatory rules', successCriteria: 'All rules checked, violations documented' },
      { step: 4, name: 'Fairness Check', agents: ['fairness_agent'], goal: 'Analyze for territory bias and equity issues', successCriteria: 'Equity assessment with recommendations' },
      { step: 5, name: 'Create Documentation', agents: ['communication_agent'], goal: 'Generate comprehensive plan document', successCriteria: 'Documentation created and shared' },
    ],
    status: 'active',
  },
  {
    id: 'analyze_ic',
    name: 'Analyze Existing IC',
    description: 'Assess uploaded IC documents against best practices',
    triggerKeywords: ['analyze scheme', 'assess ic', 'assess my ic', 'review plan', 'evaluate incentive', 'assess proposal'],
    triggerMode: 'both',
    autoAdvance: true,
    orchestrator: withOrchestratorPrompts({
      role: 'You are the Workflow Orchestrator for IC scheme analysis.',
      goal: 'Produce a complete assessment: extract/axes (1), compliance (2), narrative report (3), then a final recommendations table (4). All four specialists must run.',
      approach: 'AUTO-ADVANCE PIPELINE: Do not wait for clarifying answers. Specialists use ONLY evidenced proposal facts (including image/payout-scale extracts) — NEVER invent or assume missing details. Missing information must be recorded as INFORMATION GAPS (often critical findings). Never mark workflowComplete until Step 4 (Assessment Summary) has finished. After Steps 1–3, set workflowComplete=false and proceed. EVALUATING STEPS: Judge each agent only against THAT step\'s success criteria.',
      introFull: 'Introduce yourself as the IC analysis orchestrator and state that specialists will extract, check compliance, report, then summarise recommendations. Do NOT list the workflow steps yourself — they are appended separately. Match USER ANSWER DETAIL for this intro (keep it an intro, not a full assessment).',
    }),
    workflow: [
      { step: 1, name: 'Extract & Analyze', agents: ['analysis_agent'], goal: 'Extract key scheme info (text + image/payout extracts) and assess against 6 Fundamental Axes only', successCriteria: 'Scheme structure extracted including any payment-scale evidence; 6-axes strengths/gaps noted; STOP — no full compliance checklist and no final recommendations table' },
      { step: 2, name: 'Compliance Check', agents: ['compliance_agent'], goal: 'Validate extracted scheme against mandatory rules', successCriteria: 'All rules checked, violations categorized by severity' },
      { step: 3, name: 'Generate Report', agents: ['communication_agent'], goal: 'Create a narrative assessment report from prior steps', successCriteria: 'Narrative assessment covering strengths, weaknesses, and information gaps' },
      { step: 4, name: 'Recommendations Summary', agents: ['assessment_summary_agent'], goal: 'Summarise findings and produce a recommendations table with explanations', successCriteria: 'Executive summary plus markdown recommendations table (Priority, Recommendation, Rationale, Evidence, Severity) and next actions' },
    ],
    status: 'active',
  },
  {
    id: 'territory_assessment',
    name: 'Territory Assessment',
    description: 'Assess current territory structure for balance, equity and efficiency',
    triggerKeywords: ['territory assessment', 'assess territory', 'territory structure', 'territory design', 'rep coverage', 'territory review'],
    triggerMode: 'both',
    orchestrator: withOrchestratorPrompts({
      role: 'You are the Workflow Orchestrator for territory assessment.',
      goal: 'Produce a complete territory assessment covering structure, sales performance, HCP coverage, and actionable redesign recommendations.',
      approach: 'DATA STEPS (Steps 1-3): Let agents gather information, do not intervene while they are asking questions. WORKFLOW END: Only mark workflowComplete when the design strategist has produced concrete recommendations.',
      introFocused: 'The user has already selected a specific territory. Match USER ANSWER DETAIL for the intro (Executive = 1 sentence; Teaching may add why this territory review matters). Do NOT list workflow steps — they are appended separately.',
    }),
    workflow: [
      { step: 1, name: 'Load Territory Structure', agents: ['territory_structure_agent'], goal: 'Capture the current territory structure', successCriteria: 'Clear summary of territory count, rep roles, alignment method' },
      { step: 2, name: 'Load Sales & Performance Data', agents: ['sales_data_agent'], goal: 'Gather sales performance data by territory', successCriteria: 'Summary of performance by territory with top/bottom performers identified' },
      { step: 3, name: 'Load HCP & Account Data', agents: ['hcp_data_agent'], goal: 'Capture HCP universe and coverage data', successCriteria: 'Summary of HCP universe size, segment coverage rates, key gaps' },
      { step: 4, name: 'Perform Assessment', agents: ['territory_assessment_agent'], goal: 'Assess workload balance, opportunity equity, coverage efficiency', successCriteria: 'Rated assessment across four dimensions with ranked issue list' },
      { step: 5, name: 'Design Recommendations', agents: ['territory_design_agent'], goal: 'Produce prioritised redesign recommendations', successCriteria: 'Ranked recommendations with rationale, quick wins, risk mitigations' },
    ],
    status: 'active',
  },
];
