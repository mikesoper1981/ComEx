export const DEFAULT_TOPICS = [
    {
      id: 'design_ic',
      name: 'Design New IC Scheme',
      description: 'End-to-end incentive compensation scheme creation',
      triggerKeywords: ['design scheme', 'design an incentive', 'create ic', 'new incentive', 'build scheme'],
      orchestrator: {
        role: 'You are the Workflow Orchestrator for IC scheme design.',
        goal: 'Ensure the final scheme meets all compliance rules, fairness standards, and the user\'s business requirements.',
        approach: 'EVALUATING STEPS: After each agent responds, assess their output strictly against the step\'s success criteria. IF THE AGENT ASKED THE USER A QUESTION: set agentStillWorking=true, stepComplete=false, and do not offer Continue — wait for the user\'s answer. WORKFLOW END: Only mark workflowComplete when all steps have passed.'
      },
      workflow: [
        { step: 1, name: 'Gather Requirements', agents: ['requirements_agent'], goal: 'Collect all necessary information', successCriteria: 'Clear answers to: How many reps? What products? Strategic priorities?' },
        { step: 2, name: 'Design Structure', agents: ['design_agent'], goal: 'Create IC scheme with 3-5 components', successCriteria: 'Draft scheme with components, weightings summing to 100%, metric types' },
        { step: 3, name: 'Validate Compliance', agents: ['compliance_agent'], goal: 'Check scheme against ALL mandatory rules', successCriteria: 'All rules checked, violations documented' },
        { step: 4, name: 'Fairness Check', agents: ['fairness_agent'], goal: 'Analyze for territory bias and equity issues', successCriteria: 'Equity assessment with recommendations' },
        { step: 5, name: 'Create Documentation', agents: ['communication_agent'], goal: 'Generate comprehensive plan document', successCriteria: 'Documentation created and shared' }
      ],
      status: 'active'
    },
    {
      id: 'analyze_ic',
      name: 'Analyze Existing IC',
      description: 'Assess uploaded IC documents against best practices',
      triggerKeywords: ['analyze scheme', 'assess ic', 'review plan', 'evaluate incentive'],
      orchestrator: {
        role: 'You are the Workflow Orchestrator for IC scheme analysis.',
        goal: 'Produce a complete assessment covering scheme structure, compliance, and fairness.',
        approach: 'EVALUATING STEPS: After each agent responds, check their output against the step\'s success criteria before advancing.'
      },
      workflow: [
        { step: 1, name: 'Extract & Analyze', agents: ['analysis_agent'], goal: 'Extract key info and assess against 6 Fundamental Axes', successCriteria: 'Scheme structure understood, strengths/weaknesses noted' },
        { step: 2, name: 'Compliance Check', agents: ['compliance_agent'], goal: 'Validate against mandatory rules', successCriteria: 'All rules checked, violations categorized by severity' },
        { step: 3, name: 'Generate Report', agents: ['communication_agent'], goal: 'Create assessment report', successCriteria: 'Detailed report with ranked recommendations' }
      ],
      status: 'active'
    },
    {
      id: 'territory_assessment',
      name: 'Territory Assessment',
      description: 'Assess current territory structure for balance, equity and efficiency',
      triggerKeywords: ['territory assessment', 'assess territory', 'territory structure', 'territory design', 'rep coverage', 'territory review'],
      orchestrator: {
        role: 'You are the Workflow Orchestrator for territory assessment.',
        goal: 'Produce a complete territory assessment covering structure, sales performance, HCP coverage, and actionable redesign recommendations.',
        approach: 'DATA STEPS (Steps 1-3): Let agents gather information, do not intervene while they are asking questions. WORKFLOW END: Only mark workflowComplete when the design strategist has produced concrete recommendations.'
      },
      workflow: [
        { step: 1, name: 'Load Territory Structure', agents: ['territory_structure_agent'], goal: 'Capture the current territory structure', successCriteria: 'Clear summary of territory count, rep roles, alignment method' },
        { step: 2, name: 'Load Sales & Performance Data', agents: ['sales_data_agent'], goal: 'Gather sales performance data by territory', successCriteria: 'Summary of performance by territory with top/bottom performers identified' },
        { step: 3, name: 'Load HCP & Account Data', agents: ['hcp_data_agent'], goal: 'Capture HCP universe and coverage data', successCriteria: 'Summary of HCP universe size, segment coverage rates, key gaps' },
        { step: 4, name: 'Perform Assessment', agents: ['territory_assessment_agent'], goal: 'Assess workload balance, opportunity equity, coverage efficiency', successCriteria: 'Rated assessment across four dimensions with ranked issue list' },
        { step: 5, name: 'Design Recommendations', agents: ['territory_design_agent'], goal: 'Produce prioritised redesign recommendations', successCriteria: 'Ranked recommendations with rationale, quick wins, risk mitigations' }
      ],
      status: 'active'
    }
];
