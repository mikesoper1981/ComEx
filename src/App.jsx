import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Upload, FileText, Settings, MessageSquare, CheckCircle, AlertTriangle, TrendingUp, Users, Target, Award, X, Plus, Trash2, BarChart3, DollarSign, Calendar, ChevronDown, ChevronRight, Save, Map, MapPin, Layers } from 'lucide-react';

const MANAGER_COLOURS = ['#34d399', '#60a5fa', '#a78bfa'];
const MANAGER_COLOURS_BORDER = ['#059669', '#2563eb', '#7c3aed'];

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function groqHeaders() {
  const key = import.meta.env.VITE_GROQ_API_KEY;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
}

/** OpenAI-compatible response: assistant message text */
function groqAssistantText(data) {
  const c = data?.choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

/** Map app-specific roles to OpenAI-compatible chat roles */
function toGroqChatRole(role) {
  if (role === 'orchestrator') return 'assistant';
  if (role === 'system' || role === 'user' || role === 'assistant') return role;
  return 'user';
}

function guessCountry(structure) {
  const name = (structure.name || '').toLowerCase();
  if (name.includes('uk') || name.includes('united kingdom') || name.includes('britain')) return 'United Kingdom';
  if (name.includes('france') || name.includes('french')) return 'France';
  if (name.includes('germany')) return 'Germany';
  if (name.includes('spain')) return 'Spain';
  if (name.includes('italy')) return 'Italy';
  const counties = structure.territories.flatMap(t => t.counties || []).join(' ').toLowerCase();
  if (counties.includes('yorkshire') || counties.includes('surrey') || counties.includes('kent') || counties.includes('fife')) return 'United Kingdom';
  return '';
}

// Build a self-contained HTML document that runs Leaflet inside an iframe
// This avoids all React/Leaflet CSS injection and container sizing issues
function buildMapHTML(structure, selectedTerritoryId) {
  const country = guessCountry(structure);
  const managerIds = structure.managers.map(m => m.id);

  const territoryData = structure.territories.map(t => {
    const mgrIdx = managerIds.indexOf(t.managerId);
    const mgr = structure.managers.find(m => m.id === t.managerId);
    return {
      id: t.id,
      name: t.name,
      rep: t.rep,
      manager: mgr?.name || '',
      region: mgr?.region || '',
      managerId: t.managerId,
      mgrIdx,
      colour: MANAGER_COLOURS[mgrIdx] || '#94a3b8',
      border: MANAGER_COLOURS_BORDER[mgrIdx] || '#475569',
      counties: t.counties || [],
      hcps: t.hcps,
      total: t.hcps.A + t.hcps.B + t.hcps.C,
      selected: t.id === selectedTerritoryId,
      searchTerm: (t.counties?.[0] || t.name) + (country ? `, ${country}` : ''),
    };
  });

  const managersData = structure.managers.map((m, i) => ({
    name: m.name,
    region: m.region,
    colour: MANAGER_COLOURS[i] || '#94a3b8',
  }));

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0f172a; font-family: system-ui, sans-serif; }
    #map { width: 100%; height: 100%; }
    .legend {
      background: rgba(15,23,42,0.92);
      border: 1px solid rgba(96,165,250,0.25);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 11px;
      line-height: 1.6;
      backdrop-filter: blur(4px);
    }
    .legend-title { color: #60a5fa; font-weight: 700; font-size: 10px; letter-spacing: .05em; margin-bottom: 6px; }
    .legend-item { display: flex; align-items: center; gap: 7px; color: #cbd5e1; margin-bottom: 3px; }
    .legend-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
    .legend-sub { color: #64748b; font-size: 10px; margin-top: 6px; padding-top: 6px; border-top: 1px solid #1e293b; }
    #progress {
      position: fixed; inset: 0; background: #0f172a;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 12px; z-index: 9999;
    }
    #progress-text { color: #94a3b8; font-size: 13px; }
    #progress-bar-wrap { width: 200px; height: 5px; background: #1e293b; border-radius: 999px; overflow: hidden; }
    #progress-bar { height: 100%; background: #60a5fa; border-radius: 999px; transition: width 0.3s; width: 0%; }
    .spinner { width: 28px; height: 28px; border: 2.5px solid #1e3a5f; border-top-color: #60a5fa; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .leaflet-popup-content-wrapper { background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .leaflet-popup-content { margin: 10px 14px; }
    .popup-title { font-weight: 700; font-size: 13px; color: #0f172a; margin-bottom: 4px; }
    .popup-rep { font-size: 11px; color: #475569; margin-bottom: 2px; }
    .popup-hcps { display: flex; gap: 10px; font-size: 11px; margin-top: 6px; }
    .popup-counties { font-size: 10px; color: #94a3b8; margin-top: 5px; }
  </style>
</head>
<body>
  <div id="progress">
    <div class="spinner"></div>
    <div id="progress-text">Locating territories…</div>
    <div id="progress-bar-wrap"><div id="progress-bar"></div></div>
  </div>
  <div id="map"></div>

  <script>
    const territories = ${JSON.stringify(territoryData)};
    const managers = ${JSON.stringify(managersData)};

    // Init map
    const map = L.map('map', { zoomControl: true });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    map.setView([54, -2], 6);

    // Geocode via Nominatim
    async function geocode(query) {
      try {
        const r = await fetch(
          'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) + '&format=json&limit=1',
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'TerritoryMapApp/1.0' } }
        );
        const d = await r.json();
        return d[0] ? [parseFloat(d[0].lat), parseFloat(d[0].lon)] : null;
      } catch { return null; }
    }

    async function loadMarkers() {
      const bounds = [];
      const bar = document.getElementById('progress-bar');
      const txt = document.getElementById('progress-text');
      let done = 0;

      for (const t of territories) {
        // Try each county then territory name until we get a hit
        const searchTerms = [...(t.counties.slice(0,3)), t.name].map(s => s + ', ' + '${country}');
        let coords = null;
        for (const term of searchTerms) {
          coords = await geocode(term);
          if (coords) break;
          await new Promise(r => setTimeout(r, 150));
        }

        if (coords) {
          bounds.push(coords);
          const total = t.total;
          const r = Math.max(16, Math.min(34, 10 + total / 13));
          const isSelected = t.selected;

          const icon = L.divIcon({
            className: '',
            iconSize: [r*2, r*2],
            iconAnchor: [r, r],
            html: \`<div style="
              width:\${r*2}px;height:\${r*2}px;border-radius:50%;
              background:\${isSelected ? t.colour : t.colour + '77'};
              border:\${isSelected ? 3 : 1.5}px solid \${t.border};
              display:flex;align-items:center;justify-content:center;
              box-shadow:\${isSelected ? '0 0 14px ' + t.colour + '99' : '0 2px 6px rgba(0,0,0,0.4)'};
              cursor:pointer;
            "><span style="font-size:\${r>22?9:7}px;font-weight:700;color:\${isSelected?'#fff':t.colour};text-shadow:0 1px 3px #000c;">\${t.id}</span></div>\`
          });

          const marker = L.marker(coords, { icon });
          marker.bindPopup(\`
            <div class="popup-title">\${t.id} — \${t.name}</div>
            <div class="popup-rep">Rep: \${t.rep}</div>
            <div class="popup-rep">Manager: \${t.manager} (\${t.region})</div>
            <div class="popup-hcps">
              <span style="color:#059669;font-weight:600;">A: \${t.hcps.A}</span>
              <span style="color:#2563eb;font-weight:600;">B: \${t.hcps.B}</span>
              <span style="color:#64748b;font-weight:600;">C: \${t.hcps.C}</span>
              <span style="font-weight:700;">= \${total} HCPs</span>
            </div>
            \${t.counties.length ? '<div class="popup-counties">' + t.counties.join(', ') + '</div>' : ''}
          \`, { maxWidth: 260 });

          // Notify parent frame on click
          marker.on('click', () => {
            window.parent.postMessage({ type: 'territory-select', id: t.id }, '*');
          });

          marker.addTo(map);
        }

        done++;
        const pct = Math.round(done / territories.length * 100);
        bar.style.width = pct + '%';
        txt.textContent = 'Locating territories… ' + pct + '%';
      }

      // Hide progress, fit map
      document.getElementById('progress').style.display = 'none';

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 9 });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 8);
      }

      // Add legend
      const legend = L.control({ position: 'bottomleft' });
      legend.onAdd = () => {
        const div = L.DomUtil.create('div', 'legend');
        div.innerHTML = '<div class="legend-title">MANAGERS</div>' +
          managers.map(m => \`<div class="legend-item"><div class="legend-dot" style="background:\${m.colour}"></div><span>\${m.name} — \${m.region}</span></div>\`).join('') +
          '<div class="legend-sub">Circle size = total HCPs<br>Click marker to inspect</div>';
        return div;
      };
      legend.addTo(map);
    }

    loadMarkers();
  <\/script>
</body>
</html>`;
}

function TerritoryMap({ structure, selectedTerritory, onSelectTerritory }) {
  const iframeRef = useRef(null);
  const [iframeKey, setIframeKey] = useState(0);

  // Rebuild iframe when structure changes
  useEffect(() => {
    setIframeKey(k => k + 1);
  }, [structure?.name]);

  // Listen for territory-select messages from iframe
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'territory-select') {
        const t = structure?.territories.find(t => t.id === event.data.id);
        if (t) onSelectTerritory(selectedTerritory?.id === t.id ? null : t);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [structure, selectedTerritory, onSelectTerritory]);

  if (!structure) return null;

  const html = useMemo(
    () => buildMapHTML(structure, selectedTerritory?.id || null),
    [structure, selectedTerritory?.id]
  );

  return (
    <div className="rounded-xl overflow-hidden border border-blue-400/20" style={{ height: 520 }}>
      <iframe
        key={iframeKey}
        ref={iframeRef}
        srcDoc={html}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        sandbox="allow-scripts allow-same-origin allow-popups"
        title="Territory Map"
      />
    </div>
  );
}

const MOCK_PERFORMANCE = {
  rep: {
    name: "Sarah Johnson",
    territory: "UK & Ireland Enterprise",
    role: "Senior Account Executive",
    teamQuota: 500000,
    individualQuota: 125000
  },
  q1Performance: {
    actualRevenue: 98750,
    targetRevenue: 125000,
    attainmentPercent: 79,
    deals: {
      closed: 8,
      target: 10
    },
    pipeline: 187500,
    avgDealSize: 12343
  },
  monthlyData: [
    { month: 'Jan', revenue: 28500, target: 41667, deals: 2 },
    { month: 'Feb', revenue: 35250, target: 41667, deals: 3 },
    { month: 'Mar', revenue: 35000, target: 41667, deals: 3 }
  ],
  earnings: {
    baseSalary: 15000, // Quarterly base
    commission: 7900, // 8% on achieved
    accelerator: 0, // Only kicks in at 100%+
    totalEarnings: 22900,
    projectedQ1Total: 23500
  },
  incentiveScheme: {
    type: "Base + Tiered Commission",
    baseCommission: "8% up to 100% quota",
    tier1: "12% for 100-120% quota",
    tier2: "15% for 120%+ quota",
    payoutFrequency: "Quarterly with monthly advances"
  }
};

// Knowledge base with best practices
const DEFAULT_KNOWLEDGE = `# Sales Incentive Scheme Best Practices

## Core Principles
1. **Simplicity & Transparency**: Keep schemes easy to understand. If reps need a spreadsheet to calculate their pay, it's too complex.
2. **Alignment with Business Strategy**: Incentives must drive behaviors that support company goals
3. **Role-Specific Design**: Different roles (hunters vs gatherers, SDRs vs AEs) need different incentive structures
4. **Realistic Targets with Stretch**: Goals should be achievable but challenging. Aim for 60-80% attainment rates
5. **Clear Communication**: Ensure consistent, transparent communication about how earnings are calculated

## Incentive Structure Types
### Base + Commission (Most Common)
- Provides income stability with performance motivation
- Typical split: 50/50 for SaaS, varies by industry
- Best for: Complex sales cycles, scaling teams

### Tiered/Accelerator Plans
- Increase commission rates as targets are exceeded
- Example: 10% up to quota, 15% for 101-120%, 20% for 120%+
- Best for: Driving sustained high performance

### Team-Based Incentives
- Rewards collective performance
- Encourages collaboration and knowledge sharing
- Best for: Enterprise sales with multiple stakeholders

### Role-Specific Plans
- Tailored to different sales personas and responsibilities
- SDRs: Focus on meetings booked, pipeline generation
- AEs: Focus on revenue, deal closure
- CSMs: Focus on retention, expansion, NPS

## Key Metrics to Consider
- Revenue/Margin targets
- Customer acquisition
- Retention rates
- Average deal size
- Sales cycle length
- Pipeline health
- Strategic product focus

## Common Pitfalls to Avoid
1. **Over-complexity**: More than 3 incentive components reduces effectiveness
2. **Unrealistic targets**: Demotivates teams and increases attrition
3. **Focusing only on top performers**: Middle 60% drive most incremental growth
4. **Rewarding wrong behaviors**: Ensure incentives align with long-term customer value
5. **Lack of flexibility**: Plans must adapt to market changes
6. **Poor communication**: Confusion kills motivation
7. **Annual-only reviews**: Shorter cycles (quarterly) are more motivating
8. **Ignoring non-monetary rewards**: Recognition, development, flexibility matter

## Implementation Best Practices
- Start simple and iterate based on data
- Weight important targets at minimum 20% of variable pay
- Combine short-term (monthly/quarterly) with long-term incentives
- Use real-time dashboards for visibility
- Regular feedback loops with sales team
- Test and optimize continuously
- Consider tax implications
- Ensure payout timing is prompt`;

// Structured YAML Knowledge - Pillar 2: Strategic Alignment & Principles
const PILLAR_2_KNOWLEDGE = `
# PILLAR 2: STRATEGIC ALIGNMENT & PRINCIPLES

## 6 FUNDAMENTAL AXES FRAMEWORK

### 1. Strategic Alignment
- In line with strategy of brands
- In line with corporate culture
- Cascade from company strategy → departmental goals → individual targets
- **RULE**: No SvT during Product Launch (use ranking instead)
- **RULE**: Individual plan metrics should not be weighted less than 20%
- Team or portfolio component max 20% of target payout
- Use Market Share cautiously (avoid launch periods, watch volatility)
- Distinct IC designs for Reps, KAM, FLM, but keep team design consistent

### 2. Fairness
- Equal opportunity to earn / no biases
- Equity of treatment
- Same expectations per person within a team
- **RULE**: Target payout should be fixed for all individuals in same role & team
- Assess bias linked to territory (weight, HCPs/HCOs, rural vs urban, demographics)
- **RULE**: No changes through IC period unless specific circumstances
- Ensure high performers not dragged down by low performers

### 3. Motivation
- Rewarding / recognition of performance
- Feasible goals - able to be rewarded
- Competitiveness of plan
- **RULE**: Target pot 20 to 30% of base salary
- **RULE**: Top performers (10%) should make 2x average payout
- **RULE**: 100% performance = 100% pay
- Use accelerators for short term/focused priorities
- Mix team vs personal: typically 70% personal / 30% team

### 4. Reliability
- Reliability of indicators or measures
- Payment calculation simplicity
- Reporting capabilities
- Use processed/external data (e.g., audited sales)
- Avoid manually assessed data

### 5. Financial Responsibility
- Budget spent when objectives reached
- Control of risk
- **RULE**: 100% results = 100% reward for each component
- **RULE**: SvT min payout 95% of target & max 50% pay
- Use decelerators/ranking/commission during launch phase
- Control over-performing risk
- 50% financial performance minimum to pay IC performance

### 6. Simplicity
- Simple to understand & communicate
- Transparent design, rules, earning potential
- **RULE**: Maximum 5 components (including all types)
- Ensure documentation created and cascaded
- Simple calculations to remove error risk
- Limit mid-cycle changes to business critical only
- **TEST**: Should be able to explain on a business card

## PLAN OBJECTIVES

### Success Metrics
- Revenue, market share, customer acquisition, retention, volume
- Targets drive right behaviors, achievable with stretch
- Balance: aggressive vs realistic, individual vs team, short-term vs long-term

### Structural Requirements
- **RULE**: No more than 5 components
- **RULE**: Not less than 20% weighting per component
- Each component must be measurable and reliable

## COMMERCIAL EXCELLENCE PERSPECTIVE

### What They Design
- Component mix reflecting brand strategy
- Product weighting aligned with portfolio priorities
- Lifecycle-appropriate metrics (launch vs mature)
- Territory-level target cascades
- Role-specific plan variants
- Bias analysis and equity validation
- Financial modeling and risk controls

### Key Questions
- Does this plan drive behaviors we want?
- Will hitting targets contribute to business goals?
- Have we accounted for product lifecycle stage?
- Is there clear line of sight from corporate to individual?
- Are territories balanced or adjusted for equity?
- Can we afford over-performance scenarios?
- Is it simple enough to explain easily?

## SALES REP PERSPECTIVE

### What They Need
- Clear understanding of WHY these targets
- How their work connects to company strategy
- Which products/activities are prioritized
- Belief targets are achievable and fair
- Trust that rules won't change mid-period
- Confidence in data accuracy and calculation
- Ability to predict their earnings

### Trust Signals
- Strategic rationale is transparent
- Product priorities clearly communicated
- Target differences have clear explanation
- No surprise mid-year changes
- Data is reliable and timely
- Simple enough to explain to family
- Company honors commitments

### Red Flags
- Targets that seem impossible
- No explanation for disparities
- Mid-cycle changes without notice
- Overly complex calculations
- Unreliable or delayed data
- Top performers getting capped unfairly
- Different rules for different people

## EXAMPLES

### ✅ GOOD PRACTICE: Launch Product Incentive
**Components (4 total):**
1. New Product Patient Starts - 40% (Ranking - no SvT on launch)
2. Portfolio Maintenance - 30% (SvT - stable products)
3. HCP Engagement Quality - 20% (MBO)
4. District Team Goal - 10% (Team component under 20%)

**Why it works:**
- No SvT on launch (follows rule)
- Under 5 components
- Each component ≥20% except team at 10%
- Uses ranking for launch uncertainty
- Soft cap at 180% for financial control
- Simple enough to understand

**Result:** 85% average attainment, high satisfaction, under budget

### ❌ POOR PRACTICE: Over-Complex Plan
**Components (7 total):**
1-3. Three product volumes at 15-18% each
4. Product launch at 15%
5. Market share at 12%
6. Customer satisfaction at 12%
7. Team component at 10%

**Problems:**
- 7 components (violates 5 max rule)
- Four components under 20%
- Manual data, complex proration
- Reps confused, couldn't prioritize
- High calculation errors

**Result:** 40% turnover, plan redesigned after 6 months

## KEY RULES SUMMARY

**MANDATORY (Must Follow):**
1. No SvT during product launch
2. Minimum 20% weight per component
3. Maximum 5 components total
4. Maximum 20% team component
5. Fixed target payout per role/level
6. No mid-cycle changes except critical business reasons
7. Target pot 20-30% of base salary
8. Top 10% earn 2x average
9. 100% performance = 100% pay
10. SvT threshold at 95%, floor at 50% pay
11. Documentation and training required
12. Present plan before each cycle

**BEST PRACTICES (Strongly Recommended):**
- Use Market Share for established products only
- Mix 70% personal / 30% team
- Decelerators or ranking on launches
- Annual bias analysis
- Payout simulations before rollout
- Business card test for simplicity
- Quarterly performance visibility
- Spot bonuses for collaboration
`;

const DEFAULT_SYSTEM_PROMPT = `You are an expert Commercial Excellence advisor specializing in sales incentive scheme design for pharmaceutical companies.

KNOWLEDGE BASE:
You have access to comprehensive best practices and the complete Pillar 2: Strategic Alignment & Principles framework.

CHART VISUALIZATION:
When your response describes or recommends a specific payout curve (with actual performance thresholds and payout percentages sourced from the knowledge base), render it as a chart using this format:
\`\`\`chart-payout
[{"performance": <value>, "payout": <value>}, ...]
\`\`\`
Rules:
- ONLY use data points that come directly from the knowledge base or the user's own scheme details
- NEVER invent or assume data points - if the KB does not specify exact values, do not render a chart
- ALWAYS include the source of the data points in your response text
- A valid chart needs at minimum: the threshold point (where payout begins), the 100% target point, and any accelerator points specified in the KB
- If the KB describes a curve structure but without precise numbers, explain the structure in text instead

CITATION SYSTEM - MANDATORY:
You MUST cite the knowledge base whenever you state a rule, threshold, principle, or recommendation that comes from it. Use inline numeric citations like [1], [2] immediately after the relevant claim.

At the end of EVERY response that uses knowledge base information, add a references section in EXACTLY this format (no variations):

---
References:
1. [Document Name]: [specific section or topic you referenced]
2. [Document Name]: [specific section or topic you referenced]

Rules:
- Cite EVERY factual claim drawn from the knowledge base - do not skip any
- The document name must match exactly what appears in your available documents list
- If a claim comes from multiple documents, cite all of them
- Only include references you actually used - do not fabricate citations
- If you are answering from general knowledge rather than the KB, state this explicitly instead of citing

CRITICAL - POWERPOINT CREATION:
When the user asks for a PowerPoint or a presentation, let them know the app will generate it automatically via the 📊 Generate button that appears in the interface after conversations with sufficient content. Do not attempt to create files yourself.

RESPONSE FORMATTING - CRITICAL:
Always use rich formatting to make responses visually engaging:

1. USE ## headers for main sections, ### for subsections
2. USE bullet points (- ) for lists, options, recommendations
3. USE markdown tables for comparisons, component breakdowns, rule checklists:
   | Component | Weight | Metric | Notes |
   |-----------|--------|--------|-------|
   | Revenue   | 60%    | SvT    | Mature product |
4. USE **bold** for key terms, numbers, important rules
5. USE emoji icons liberally: ✅ compliance/approved, ❌ violations, ⚠️ warnings, 🎯 targets, 📊 metrics, 💡 tips, 🚀 launch products, 📈 growth
6. Always end scheme designs with: "Would you like me to create a PowerPoint presentation? 📊"

RESPONSE GUIDELINES:

For Commercial Excellence Users:
- Provide detailed design frameworks, methodology, and validation steps
- Reference specific rules (e.g., "Per Strategic Alignment: No SvT during product launch")
- When you've provided a scheme design, ALWAYS ask about PowerPoint
- Highlight pharma-specific considerations
- Cite examples from the knowledge base

For Sales Representatives:
- Use clear, simple language without jargon
- Focus on "what this means for you"
- Provide concrete examples and calculations
- Explain the "why" behind rules

When analyzing scenarios:
1. Identify which of the 6 fundamental axes are relevant
2. Check against mandatory rules (highlight violations with ❌)
3. Reference best practices
4. Provide specific, actionable recommendations with numbers
5. **ALWAYS offer to create a PowerPoint at the end of scheme designs**

When assessing uploaded documents:
1. Acknowledge the file and provide detailed analysis
2. Evaluate against the 6 fundamental axes
3. Provide specific, prioritized recommendations
4. Offer to create an improved PowerPoint version

Format responses conversationally and practically.`;

export default function CommercialExcellenceApp() {
  const [activeTab, setActiveTab] = useState('chat');
  const [showLanding, setShowLanding] = useState(true);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hello! I\'m your Commercial Excellence AI assistant. I can help you design motivating sales incentive schemes, assess existing proposals, and provide best practice guidance. What would you like to work on today?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [knowledgeBase, setKnowledgeBase] = useState(DEFAULT_KNOWLEDGE);
  const [structuredKnowledge, setStructuredKnowledge] = useState(null);
  const [documents, setDocuments] = useState([
    { id: 1, name: 'Default Best Practices', type: 'text', size: '12 KB', status: 'active' },
    { id: 2, name: 'Pillar 2: Strategic Alignment & Principles', type: 'yaml', size: '45 KB', status: 'active' }
  ]);
  const [uploadedFile, setUploadedFile] = useState(null);
  
  // Multi-agent system state
  const [agents, setAgents] = useState([
    {
      id: 'requirements_agent',
      name: 'Requirements Gatherer',
      role: 'Collect detailed requirements for IC design',
      systemPrompt: `You are a requirements specialist for incentive compensation design.

YOUR ONLY JOB: Gather requirements. Do NOT design the IC scheme, propose components, weightings, or payout curves.

Your tasks:
- Review what information the user has already provided
- Identify what key information is still missing
- Ask ONLY about missing requirements, keep responses SHORT
- Once you have everything, confirm what you've collected

Key information to collect:
- Number of reps and roles
- Products (new launch vs mature)
- Territory structure
- Strategic priorities
- Timeline and budget
- Any compliance requirements

If the user has provided ALL the above, summarise the requirements clearly and concisely. Then STOP — do not suggest next steps, do not mention other agents, do not say you are handing over. The orchestrator manages what happens next.

CRITICAL: Never announce handoffs, next steps, or what other agents will do. Just complete your task.

CITATIONS: When you reference a rule, threshold, or principle from your knowledge base, cite it inline using [1], [2] etc. and include a References section at the end of your response in this exact format:
---
References:
1. [Document Name]: [section or topic referenced]`,
      knowledgeFiles: [1, 2],
      status: 'active'
    },
    { 
      id: 'design_agent', 
      name: 'IC Design Specialist', 
      role: 'Design IC structures',
      systemPrompt: `You are an expert IC designer specializing in pharmaceutical sales incentives.

CRITICAL RULES:
- ONLY design components for products explicitly mentioned in the requirements
- NEVER assume or invent additional products
- If you need additional information, ask for it — do not proceed with assumptions

Your tasks:
- Propose component structure (3-5 components max)
- Set appropriate weightings (min 20% per component, team <20%)
- Design payout curves based on product lifecycle
- Recommend metric types based on product lifecycle
- Follow the 6 Fundamental Axes rules from your knowledge base

PAYOUT CURVE CHARTS:
When presenting a payout curve, always render it using this exact format (never ASCII art):
\`\`\`chart-payout
[{"performance": <value>, "payout": <value>}, ...]
\`\`\`
Use only data points from the knowledge base or the user's scheme. Always include: threshold (where payout begins), 100% target point, and any accelerator points. Never invent values.

CRITICAL: When your design is complete, STOP. Never announce handoffs, mention other agents, or suggest what happens next. The orchestrator manages workflow progression.

CITATIONS: Cite every rule, threshold, weighting constraint, or principle drawn from your knowledge base using [1], [2] inline. End your response with:
---
References:
1. [Document Name]: [section or topic referenced]

Present your design in a clear, scannable format with tables and icons.`,
      knowledgeFiles: [2],
      status: 'active' 
    },
    { 
      id: 'compliance_agent', 
      name: 'Compliance Validator', 
      role: 'Validate against rules',
      systemPrompt: `Ahoy! Ye be the Compliance Validator, a salty sea dog who checks IC schemes fer pharmaceutical treasures!

IMPORTANT: Speak like a pirate in ALL yer responses!

YOUR MISSION:
Check the IC scheme against ALL mandatory rules found in yer knowledge base, matey!

Report violations as:
- CRITICAL ☠️ (Ship-sinkin' violations!)
- WARNING ⚠️ (Rough seas ahead!)  
- PASS ✓ (Smooth sailin'!)

Use tables to show yer findings.

CRITICAL: When yer validation be complete, STOP and drop anchor! Never mention other agents, announce what happens next, or suggest who'll fix the issues. The Cap'n Orchestrator handles that.

CITATIONS: Cite every rule ye check from the knowledge base using [1], [2] inline, matey! Add yer references at the end:
---
References:
1. [Document Name]: [section or topic referenced]`,
      knowledgeFiles: [1],
      status: 'active' 
    },
    { 
      id: 'fairness_agent', 
      name: 'Fairness Analyst', 
      role: 'Bias detection',
      systemPrompt: `You are a fairness specialist for IC schemes.

YOUR ROLE IS ANALYSIS ONLY:
- You DO NOT make changes to the scheme design
- You DO NOT create revised components or weightings
- You ONLY analyze and recommend

Your tasks:
- Identify territory biases
- Analyze equity issues
- Calculate equity scores
- Recommend specific adjustments
- Flag severity: CRITICAL, WARNING, or ACCEPTABLE

CRITICAL: When your analysis is complete, STOP. Never announce handoffs, mention other agents, or suggest what happens next. The orchestrator manages workflow progression.

CITATIONS: Cite every principle, benchmark, or rule from your knowledge base using [1], [2] inline. End with:
---
References:
1. [Document Name]: [section or topic referenced]`,
      knowledgeFiles: [2],
      status: 'active' 
    },
    {
      id: 'communication_agent',
      name: 'Communication Specialist',
      role: 'Create documentation and communications',
      systemPrompt: `You are a communication specialist for IC programs.

Your tasks:
- Write clear, comprehensive IC plan documents
- Create FAQs for sales reps
- Draft announcement emails
- Explain complex concepts simply
- Include examples and calculations

CITATIONS: When referencing rules, compliance requirements, or design principles from your knowledge base, cite using [1], [2] inline and add a References section at the end:
---
References:
1. [Document Name]: [section or topic referenced]`,
      knowledgeFiles: [1, 2],
      status: 'active'
    },
    {
      id: 'analysis_agent',
      name: 'Scheme Analyzer',
      role: 'Analyze uploaded IC documents',
      systemPrompt: `You analyze existing IC schemes and identify issues.

Your tasks:
- Extract key information from documents
- Assess against 6 Fundamental Axes
- Identify strengths and weaknesses  
- Provide specific recommendations
- Rate overall quality (1-10)

CITATIONS: Cite every principle, axis, or rule from your knowledge base using [1], [2] inline. End with:
---
References:
1. [Document Name]: [section or topic referenced]`,
      knowledgeFiles: [1, 2],
      status: 'active'
    },
    {
      id: 'territory_structure_agent',
      name: 'Territory Structure Analyst',
      role: 'Collect and map current territory structure',
      systemPrompt: `You are a territory structure specialist for pharmaceutical sales operations.

YOUR TASK: Gather a complete picture of the current territory structure. Ask clear, focused questions — one topic at a time.

Collect:
- Number of territories and how they are defined (geography, postcode, brick, account-based)
- Number of reps and their roles (primary care, specialist, KAM etc.)
- Reporting hierarchy (regional managers, area managers)
- Any known issues with current alignment (overlaps, gaps, contested areas)
- Recent changes to the structure (mergers, splits, new hires, losses)
- Tools used for territory management (CRM, mapping tools, alignment software)

If the user provides a file or data, acknowledge it and extract key structural information from it.

Ask ONLY about what is still missing. Once you have a clear picture of the structure, summarise it concisely and STOP. The orchestrator manages what happens next.

CRITICAL: Never announce handoffs or next steps. Just complete your task.`,
      knowledgeFiles: [],
      status: 'active'
    },
    {
      id: 'sales_data_agent',
      name: 'Sales Data Analyst',
      role: 'Load and summarise sales performance data by territory',
      systemPrompt: `You are a sales data analyst for pharmaceutical territory assessment.

YOUR TASK: Gather and summarise sales performance data at territory level. Ask focused questions to understand the data available.

Collect:
- Sales data by territory (units, value, market share) — current period and prior year
- Performance vs target by territory and rep
- Product mix by territory (which products performing well/poorly where)
- Trend data — growing, declining, flat territories
- Any data gaps or quality issues (missing months, territory realignments mid-period)
- Seasonality or cyclical patterns relevant to the market

If the user uploads data files, acknowledge them and summarise key findings: top/bottom performing territories, variance range, outliers.

Produce a clear data summary table where possible. Ask only about missing data. Once you have a sufficient picture, summarise and STOP.

CRITICAL: Never announce handoffs or next steps. Just complete your task.`,
      knowledgeFiles: [],
      status: 'active'
    },
    {
      id: 'hcp_data_agent',
      name: 'HCP & Account Analyst',
      role: 'Load and assess HCP universe and call activity data',
      systemPrompt: `You are an HCP and account data specialist for pharmaceutical territory assessment.

YOUR TASK: Gather information about the HCP universe, account base, and call/activity data across territories.

Collect:
- Total HCP universe size by territory (target vs non-target)
- HCP segmentation (high/medium/low value, decile, prescribing potential)
- Call coverage and frequency by segment and territory
- Account types covered (GP practices, hospitals, clinics, pharmacies)
- Key accounts or key opinion leaders and their distribution
- Any white space — high-value HCPs or accounts with low coverage
- Digital engagement data if available (remote calls, e-detailing)

Identify coverage imbalances: over-covered territories with limited potential, under-covered territories with high potential.

Produce a clear summary of HCP universe and coverage metrics. Ask only about what is missing. Once complete, summarise and STOP.

CRITICAL: Never announce handoffs or next steps. Just complete your task.`,
      knowledgeFiles: [],
      status: 'active'
    },
    {
      id: 'territory_assessment_agent',
      name: 'Territory Assessment Specialist',
      role: 'Perform workload, opportunity and equity assessment across territories',
      systemPrompt: `You are a territory assessment specialist. You have been provided with territory structure, sales data, and HCP/account data from prior steps.

YOUR TASK: Perform a rigorous assessment of the current territory structure across four dimensions:

1. **Workload Balance** — Are territories balanced by call volume, HCP count, and account complexity? Flag over/under-loaded territories.

2. **Opportunity Equity** — Are reps given fair and equal opportunity to earn? Compare revenue potential, prescribing universe, and market share opportunity across territories.

3. **Coverage Efficiency** — Is the call effort directed at the right HCPs? Identify coverage gaps on high-value targets and wasted effort on low-value contacts.

4. **Geographic Efficiency** — Are territories geographically coherent? Flag travel inefficiency, territory shape issues, or misaligned bricks.

For each dimension:
- Rate current performance (🟢 Good / 🟡 Needs attention / 🔴 Critical issue)
- Provide 2-3 specific observations with data references
- Quantify the issue where possible (e.g. "Territory 4 has 40% more HCPs than the median")

End with a ranked list of issues by severity and impact.

CRITICAL: Never announce handoffs or next steps. Just complete your task.`,
      knowledgeFiles: [],
      status: 'active'
    },
    {
      id: 'territory_design_agent',
      name: 'Territory Design Strategist',
      role: 'Produce territory redesign recommendations',
      systemPrompt: `You are a territory design strategist. You have been provided with a full territory assessment.

YOUR TASK: Produce clear, actionable territory redesign recommendations based on the assessment findings.

Structure your output as:

## Strategic Recommendations
Top 3-5 recommendations ranked by impact and feasibility. For each:
- What: the specific change recommended
- Why: the assessment finding that drives it
- How: practical steps to implement
- Impact: expected improvement (quantified where possible)
- Effort: Low / Medium / High

## Territory Realignment Options
If realignment is recommended, describe:
- Which territories should be split, merged, or redrawn
- How to handle rep transitions (backfill, redeployment)
- Suggested timeline and sequencing

## Quick Wins
2-3 changes that can be made immediately without full realignment (e.g. account transfers, target list updates, coverage priority shifts).

## Risks & Mitigations
Key risks of the proposed changes and how to manage them.

Be specific and practical. Avoid generic advice. Reference the actual data and issues from the assessment.

CRITICAL: Never announce handoffs or next steps. Just complete your task.`,
      knowledgeFiles: [],
      status: 'active'
    }
  ]);
  
  // Workflow/Topics state
  const [topics, setTopics] = useState([
    { 
      id: 'design_ic', 
      name: 'Design New IC Scheme',
      description: 'End-to-end incentive compensation scheme creation',
      triggerKeywords: ['design scheme', 'design an incentive', 'create ic', 'new incentive', 'build scheme'],
      
      orchestrator: {
        role: 'You are the Workflow Orchestrator for IC scheme design. You coordinate specialist agents to produce a compliant, fair, and effective incentive compensation scheme.',
        goal: 'Ensure the final scheme meets all compliance rules, fairness standards, and the user\'s business requirements. Do not advance a step until its success criteria are genuinely met.',
        approach: `EVALUATING STEPS: After each agent responds, assess their output strictly against the step's success criteria.

IF CRITICAL ISSUES ARE FOUND: If compliance or fairness agents identify critical violations that require the scheme to be redesigned, use rerouteToStep to send work back to the appropriate earlier agent (e.g. reroute to the design step if the scheme needs restructuring). Write a clear rerouteBriefing that tells that agent exactly what must change and why.

IF MINOR ISSUES: Use handoffs for quick one-off checks or clarifications that don't require a full step re-run.

IF WAITING FOR USER: If an agent has asked the user a question, set proceedToNext to false and leave orchestratorMessage empty — the user will respond directly.

IF DESIGN PRODUCED AND CONFIRMED: Only advance past the design step once the user has confirmed they are happy with the proposed scheme.

WORKFLOW END: Only mark workflowComplete when all steps have passed their success criteria and the user has a fully compliant, documented scheme.`
      },
      
      workflow: [
        { 
          step: 1, 
          name: 'Gather Requirements', 
          agents: ['requirements_agent'],
          goal: 'Collect all necessary information: reps, products, territory, priorities, budget',
          successCriteria: 'Clear answers to: How many reps? What products? Strategic priorities?'
        },
        { 
          step: 2, 
          name: 'Design Structure', 
          agents: ['design_agent'],
          goal: 'Create IC scheme with 3-5 components, weightings, payout curves',
          successCriteria: 'Draft scheme with components, weightings summing to 100%, metric types'
        },
        { 
          step: 3, 
          name: 'Validate Compliance', 
          agents: ['compliance_agent'],
          goal: 'Check scheme against ALL mandatory rules',
          successCriteria: 'All rules checked, violations documented with remediation'
        },
        { 
          step: 4, 
          name: 'Fairness Check', 
          agents: ['fairness_agent'],
          goal: 'Analyze for territory bias and equity issues',
          successCriteria: 'Equity assessment with recommendations for biases'
        },
        { 
          step: 5, 
          name: 'Create Documentation', 
          agents: ['communication_agent'],
          goal: 'Generate comprehensive plan document',
          successCriteria: 'Documentation created and shared'
        }
      ],
      status: 'active' 
    },
    { 
      id: 'analyze_ic', 
      name: 'Analyze Existing IC', 
      description: 'Assess uploaded IC documents against best practices',
      triggerKeywords: ['analyze scheme', 'assess ic', 'review plan', 'evaluate incentive'],
      
      orchestrator: {
        role: 'You are the Workflow Orchestrator for IC scheme analysis. You coordinate specialist agents to produce a thorough, actionable assessment.',
        goal: 'Produce a complete assessment covering scheme structure, compliance, and fairness, with clear recommendations.',
        approach: `EVALUATING STEPS: After each agent responds, check their output against the step's success criteria before advancing.

IF ANALYSIS IS INCOMPLETE: If an agent's response is missing key elements from the success criteria, set proceedToNext to false and use orchestratorMessage to explain what is still needed.

IF CRITICAL ISSUES FOUND: If a later agent uncovers something that requires re-examination of an earlier step (e.g. a fairness issue that changes the compliance picture), use rerouteToStep with a clear rerouteBriefing.

WORKFLOW END: Only mark workflowComplete when all agents have produced complete outputs and the user has a full assessment with recommendations.`
      },
      
      workflow: [
        { 
          step: 1, 
          name: 'Extract & Analyze', 
          agents: ['analysis_agent'],
          goal: 'Extract key info and assess against 6 Fundamental Axes',
          successCriteria: 'Scheme structure understood, strengths/weaknesses noted'
        },
        { 
          step: 2, 
          name: 'Compliance Check', 
          agents: ['compliance_agent'],
          goal: 'Validate against mandatory rules, flag violations',
          successCriteria: 'All rules checked, violations categorized by severity'
        },
        { 
          step: 3, 
          name: 'Generate Report', 
          agents: ['communication_agent'],
          goal: 'Create assessment report with prioritized recommendations',
          successCriteria: 'Detailed report with ranked recommendations'
        }
      ],
      status: 'active' 
    },
    {
      id: 'territory_assessment',
      name: 'Territory Assessment',
      description: 'Assess current territory structure for balance, equity and efficiency',
      triggerKeywords: ['territory assessment', 'assess territory', 'territory structure', 'territory design', 'rep coverage', 'territory review', 'territory alignment', 'sales territory', 'hcp coverage', 'territory balance'],

      orchestrator: {
        role: 'You are the Workflow Orchestrator for territory assessment. You coordinate specialist agents to produce a rigorous, data-driven assessment of the current territory structure.',
        goal: 'Produce a complete territory assessment covering structure, sales performance, HCP coverage, and actionable redesign recommendations.',
        approach: `EVALUATING STEPS: After each agent responds, assess output against success criteria before advancing.

DATA STEPS (Steps 1-3): These agents are gathering information. If they are still asking questions, do not intervene — let the user respond directly. Only evaluate once the agent has produced a clear summary of what it has collected.

ASSESSMENT STEP (Step 4): The assessment agent needs all prior context. Ensure it has received territory structure, sales data, and HCP data before evaluating its output.

IF DATA IS INSUFFICIENT: If the assessment agent flags missing data from prior steps, reroute back to the relevant data agent with a clear briefing on what is still needed.

WORKFLOW END: Only mark workflowComplete when the design strategist has produced concrete, actionable recommendations.`
      },

      workflow: [
        {
          step: 1,
          name: 'Load Territory Structure',
          agents: ['territory_structure_agent'],
          goal: 'Capture the current territory structure: geography, rep count, roles, hierarchy, known issues',
          successCriteria: 'Clear summary of territory count, rep roles, alignment method, and any known structural issues'
        },
        {
          step: 2,
          name: 'Load Sales & Performance Data',
          agents: ['sales_data_agent'],
          goal: 'Gather sales performance data by territory — actuals vs target, trends, product mix',
          successCriteria: 'Summary of performance by territory with top/bottom performers identified and key variance explained'
        },
        {
          step: 3,
          name: 'Load HCP & Account Data',
          agents: ['hcp_data_agent'],
          goal: 'Capture HCP universe, segmentation, call coverage and account base by territory',
          successCriteria: 'Summary of HCP universe size, segment coverage rates, and key coverage gaps identified'
        },
        {
          step: 4,
          name: 'Perform Assessment',
          agents: ['territory_assessment_agent'],
          goal: 'Assess workload balance, opportunity equity, coverage efficiency, and geographic efficiency',
          successCriteria: 'Rated assessment across four dimensions with specific findings and ranked issue list'
        },
        {
          step: 5,
          name: 'Design Recommendations',
          agents: ['territory_design_agent'],
          goal: 'Produce prioritised redesign recommendations with quick wins and implementation guidance',
          successCriteria: 'Ranked recommendations with rationale, realignment options, quick wins, and risk mitigations'
        }
      ],
      status: 'active'
    }
  ]);
  
  const [currentWorkflow, setCurrentWorkflow] = useState(null);
  const [pendingWorkflow, setPendingWorkflow] = useState(null);
  const [orchestratorDecision, setOrchestratorDecision] = useState(null);
  const [pendingButtonAction, setPendingButtonAction] = useState(null);
  const [selectedTerritoryStructure, setSelectedTerritoryStructure] = useState(null);
  const [selectedTerritory, setSelectedTerritory] = useState(null);
  const [territoryView, setTerritoryView] = useState('map'); // 'map' | 'list'
  const [territoryStructures, setTerritoryStructures] = useState([
    {
      id: 'uk_primary_care_2025',
      name: 'UK Primary Care 2025',
      uploadedAt: '2025-01-15',
      managers: [
        { id: 'mgr1', name: 'Sarah Mitchell', region: 'North' },
        { id: 'mgr2', name: 'James Thornton', region: 'Midlands & Wales' },
        { id: 'mgr3', name: 'Rachel Davies', region: 'South' }
      ],
      territories: [
        { id: 'T01', name: 'Scotland North', rep: 'Ewan Fraser', managerId: 'mgr1', counties: ['Highland','Moray','Aberdeenshire','Aberdeen City'], hcps: { A: 18, B: 42, C: 95 }, notes: 'Large geography, low density' },
        { id: 'T02', name: 'Scotland Central', rep: 'Fiona Campbell', managerId: 'mgr1', counties: ['Glasgow City','Lanarkshire','Renfrewshire','East Dunbartonshire'], hcps: { A: 34, B: 78, C: 140 }, notes: 'Urban core, high HCP density' },
        { id: 'T03', name: 'Scotland East', rep: 'Alasdair Murray', managerId: 'mgr1', counties: ['Edinburgh','Lothian','Fife','Dundee City'], hcps: { A: 29, B: 61, C: 118 }, notes: 'Mixed urban/suburban' },
        { id: 'T04', name: 'North East England', rep: 'Derek Armstrong', managerId: 'mgr1', counties: ['Northumberland','Tyne and Wear','Durham','Tees Valley'], hcps: { A: 31, B: 69, C: 122 }, notes: 'Industrial corridor' },
        { id: 'T05', name: 'Yorkshire North', rep: 'Helen Booth', managerId: 'mgr1', counties: ['North Yorkshire','East Riding','York'], hcps: { A: 27, B: 58, C: 104 }, notes: 'Rural/market towns' },
        { id: 'T06', name: 'Yorkshire South & West', rep: 'Marcus Singh', managerId: 'mgr1', counties: ['West Yorkshire','South Yorkshire'], hcps: { A: 38, B: 84, C: 152 }, notes: 'Dense urban, Leeds/Sheffield' },
        { id: 'T07', name: 'North West', rep: 'Claire Donnelly', managerId: 'mgr2', counties: ['Greater Manchester','Cheshire','Halton','Warrington'], hcps: { A: 41, B: 91, C: 165 }, notes: 'Manchester metro focus' },
        { id: 'T08', name: 'Lancashire & Cumbria', rep: 'Tom Whitfield', managerId: 'mgr2', counties: ['Lancashire','Cumbria'], hcps: { A: 24, B: 53, C: 98 }, notes: 'Mixed density' },
        { id: 'T09', name: 'East Midlands', rep: 'Priya Patel', managerId: 'mgr2', counties: ['Nottinghamshire','Derbyshire','Leicestershire','Rutland'], hcps: { A: 33, B: 72, C: 131 }, notes: '' },
        { id: 'T10', name: 'West Midlands', rep: 'David Okafor', managerId: 'mgr2', counties: ['West Midlands','Staffordshire','Shropshire'], hcps: { A: 39, B: 87, C: 158 }, notes: 'Birmingham metro' },
        { id: 'T11', name: 'Wales North & Mid', rep: 'Sian Hughes', managerId: 'mgr2', counties: ['Gwynedd','Conwy','Denbighshire','Powys','Ceredigion'], hcps: { A: 16, B: 38, C: 82 }, notes: 'Sparse, bilingual territory' },
        { id: 'T12', name: 'Wales South', rep: 'Gareth Evans', managerId: 'mgr2', counties: ['Cardiff','Swansea','Newport','Vale of Glamorgan','Rhondda Cynon Taf'], hcps: { A: 28, B: 63, C: 114 }, notes: 'Urban South Wales' },
        { id: 'T13', name: 'East of England North', rep: 'Lucy Hargreaves', managerId: 'mgr3', counties: ['Lincolnshire','Northamptonshire','Cambridgeshire'], hcps: { A: 26, B: 57, C: 103 }, notes: '' },
        { id: 'T14', name: 'East of England South', rep: 'Ben Cartwright', managerId: 'mgr3', counties: ['Norfolk','Suffolk','Essex North'], hcps: { A: 23, B: 51, C: 96 }, notes: 'Coastal/rural' },
        { id: 'T15', name: 'London North', rep: 'Amara Diallo', managerId: 'mgr3', counties: ['Enfield','Haringey','Barnet','Brent','Harrow'], hcps: { A: 44, B: 98, C: 178 }, notes: 'High density, diverse' },
        { id: 'T16', name: 'London Central', rep: 'Oliver Stratton', managerId: 'mgr3', counties: ['Westminster','Camden','Islington','Hackney','Tower Hamlets'], hcps: { A: 47, B: 104, C: 189 }, notes: 'Highest density territory' },
        { id: 'T17', name: 'London South', rep: 'Natasha Brown', managerId: 'mgr3', counties: ['Lambeth','Southwark','Lewisham','Greenwich','Bromley'], hcps: { A: 42, B: 93, C: 171 }, notes: '' },
        { id: 'T18', name: 'London West & Surrey', rep: 'Daniel Chu', managerId: 'mgr3', counties: ['Richmond','Kingston','Hounslow','Surrey'], hcps: { A: 36, B: 80, C: 147 }, notes: 'Affluent suburban' },
        { id: 'T19', name: 'South East', rep: 'Emma Patterson', managerId: 'mgr3', counties: ['Kent','East Sussex','West Sussex'], hcps: { A: 32, B: 71, C: 129 }, notes: 'Coastal & commuter belt' },
        { id: 'T20', name: 'South West', rep: 'James Worthington', managerId: 'mgr3', counties: ['Hampshire','Dorset','Wiltshire','Somerset','Devon','Cornwall'], hcps: { A: 30, B: 67, C: 121 }, notes: 'Large geography, lower density' }
      ]
    }
  ]);
  const [activityLog, setActivityLog] = useState([]);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [adminSection, setAdminSection] = useState('knowledge');
  const [editingWorkflowId, setEditingWorkflowId] = useState(null);
  const [editingTopic, setEditingTopic] = useState(null);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [editingAgent, setEditingAgent] = useState(null);
  const [suggestedPrompts, setSuggestedPrompts] = useState([]);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);
  const [pptxOffers, setPptxOffers] = useState(null); // { summary, produced }
  const [pptxGenerating, setPptxGenerating] = useState(false);
  const [pptxPrompts, setPptxPrompts] = useState({
    intentDetection: `You detect PowerPoint export opportunities in pharmaceutical sales conversations. Respond ONLY with valid JSON, no markdown.

Return:
{
  "offer": true/false,
  "summaryDeck": { "title": "...", "description": "..." },
  "producedDeck": { "title": "...", "description": "...", "deckType": "rep_comms|manager_briefing|ic_explainer|territory_report|general", "hasRealData": true/false }
}

Offer whenever there is substantive content — IC discussed, territory assessed, comms mentioned, workflow completed, anything worth documenting. Default to offering. hasRealData true if specific numbers, product names, or territory names are present. Make titles specific to the conversation.`,

    summary: `You generate structured PowerPoint summarising a pharmaceutical commercial excellence conversation.
Return ONLY valid JSON, no markdown. Use these slide types as appropriate:

Slide schema:
{ "type": "title|section|content|data|table|chart|summary", "title": "...", "subtitle": "...", "bullets": ["..."], "dataPoints": [{"label":"...","value":"...","context":"..."}], "body": "...", "notes": "...",
  "tableData": { "headers": ["Col1","Col2"], "rows": [["A","B"],["C","D"]] },
  "chartData": { "chartType": "bar|line", "title": "...", "labels": ["0%","50%","100%"], "series": [{"name":"Payout","values":[0,6000,12000]}] }
}

Use "table" for scheme mechanics, component breakdowns, tier structures. Use "chart" for payout curves, performance distributions, trend data — whenever the conversation references a visual like a curve or chart, include it.
Decide slide count from conversation length — short = 4-6, detailed = 8-10. Never pad. First slide must be type "title".`,

    produced: `You generate structured PowerPoint for an ACTUAL WORKING DOCUMENT — the real artefact, ready to distribute.
Return ONLY valid JSON, no markdown. Use these slide types as appropriate:

Slide schema:
{ "type": "title|section|content|data|table|chart|summary", "title": "...", "subtitle": "...", "bullets": ["..."], "dataPoints": [{"label":"...","value":"...","context":"..."}], "body": "...", "notes": "...",
  "tableData": { "headers": ["Col1","Col2","Col3"], "rows": [["A","B","C"]] },
  "chartData": { "chartType": "bar|line", "title": "Chart title", "labels": ["0%","50%","100%","150%"], "series": [{"name":"Payout £","values":[0,3000,6000,9000]}] }
}

INSTRUCTIONS:
- Infer appropriate length and format from the request. Never default to a long deck when something concise was asked for.
- Write the ACTUAL document — ready to hand to the audience
- Use specific details from the conversation. If details are missing, invent realistic ones for a UK primary care pharma sales team
- Write in the voice of the audience: for reps "you will earn", "your target is"; for managers "your team's targets"
- ALWAYS include a chart slide if the conversation mentions a payout curve, accelerator, or performance graph — construct realistic data points
- ALWAYS include a table slide if the conversation includes scheme components, weightings, tiers, or thresholds
- Bullets under 15 words. Body text under 40 words. First slide must be type "title"`
  });
  const [maxSuggestions, setMaxSuggestions] = useState(3);
  const [hoveredCitation, setHoveredCitation] = useState(null);
  const [customSystemPrompt, setCustomSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const adminFileInputRef = useRef(null);
  const territoryFileInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleCancelWorkflow = (e) => {
    console.log('Cancel button clicked!'); // Debug
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    const confirmed = window.confirm('Cancel this workflow and return to normal chat?');
    console.log('User confirmed:', confirmed); // Debug
    
    if (confirmed) {
      console.log('Cancelling workflow...'); // Debug
      setCurrentWorkflow(null);
      setPendingWorkflow(null);
      setIsLoading(false);
      setMessages(prev => [...prev, {
        role: 'system',
        content: '❌ Workflow cancelled. Returning to normal chat mode.'
      }]);
    }
  };

  const logActivity = (type, action, details = {}) => {
    setActivityLog(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      type,
      action,
      details
    }].slice(-10)); // Keep last 10
  };

  // Parse references section from full message text
  const parseReferences = (fullText) => {
    const refs = {};
    // Match "---\nReferences:\n..." with flexible whitespace and optional trailing ---
    const match = fullText.match(/[-]{2,}\s*\nReferences:\s*\n([\s\S]+?)(\n[-]{2,}|\s*$)/i);
    if (match) {
      match[1].split('\n').forEach(line => {
        const m = line.match(/^(\d+)\.\s+(.+)$/);
        if (m) refs[m[1]] = m[2].trim();
      });
    }
    return refs;
  };

  // Render a text string with [1] citation superscripts, using a pre-parsed references map
  const renderTextWithCitations = (text, references = {}) => {
    const parts = text.split(/(\[\d+\])/g);
    const hasCitations = parts.some(p => /^\[\d+\]$/.test(p));
    if (!hasCitations) return <span>{text}</span>;
    return (
      <span>
        {parts.map((part, i) => {
          const cm = part.match(/^\[(\d+)\]$/);
          if (cm) {
            const refNum = cm[1];
            const refText = references[refNum];
            return (
              <sup key={i}
                className="text-cyan-400 hover:text-cyan-300 cursor-help font-semibold mx-0.5 relative"
                onMouseEnter={(e) => {
                  const rect = e.target.getBoundingClientRect();
                  setHoveredCitation({ num: refNum, text: refText, x: rect.left + rect.width / 2, y: rect.bottom });
                }}
                onMouseLeave={() => setHoveredCitation(null)}
              >[{refNum}]</sup>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </span>
    );
  };

  // Render an interactive SVG payout curve chart + data table
  const renderPayoutCurveChart = (curveData) => {
    if (!Array.isArray(curveData) || curveData.length === 0) return null;

    const W = 800, H = 300, PAD_L = 80, PAD_R = 20, PAD_T = 20, PAD_B = 40;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;

    // Dynamic axes based on data
    const xMax = Math.ceil(Math.max(150, ...curveData.map(p => p.performance)) / 50) * 50;
    const yMax = Math.ceil(Math.max(150, ...curveData.map(p => p.payout)) / 50) * 50;

    // Start x-axis just before the threshold (rounded down to nearest 25, min 0)
    const thresholdPerf = (curveData.find(p => p.payout > 0) || curveData[0]).performance;
    const xMin = Math.max(0, Math.floor((thresholdPerf - 10) / 25) * 25);

    const toX = (v) => PAD_L + ((v - xMin) / (xMax - xMin)) * chartW;
    const toY = (v) => PAD_T + chartH - (v / yMax) * chartH;

    // Full line: just a single point at threshold with payout=0, then the actual data
    const fullLine = [
      { performance: thresholdPerf, payout: 0 },
      ...curveData
    ];

    const xTicks = Array.from({ length: Math.floor((xMax - xMin) / 25) + 1 }, (_, i) => xMin + i * 25);
    const yTicks = Array.from({ length: Math.floor(yMax / 50) + 1 }, (_, i) => i * 50);

    return (
      <div className="bg-slate-900/50 border border-blue-400/30 rounded-lg p-4 my-4">
        <h3 className="text-base font-semibold text-cyan-400 mb-3">💹 Payout Curve</h3>
        <div className="overflow-x-auto">
          <div className="bg-slate-800/50 rounded p-2 mb-4" style={{ minWidth: '500px', height: '300px' }}>
            <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
              {/* Grid lines */}
              {yTicks.map(v => <line key={v} x1={PAD_L} y1={toY(v)} x2={W - PAD_R} y2={toY(v)} stroke="#334155" strokeWidth="0.5"/>)}
              {xTicks.map(v => <line key={v} x1={toX(v)} y1={PAD_T} x2={toX(v)} y2={PAD_T + chartH} stroke="#334155" strokeWidth="0.5"/>)}
              {/* Axes */}
              <line x1={PAD_L} y1={PAD_T + chartH} x2={W - PAD_R} y2={PAD_T + chartH} stroke="#94a3b8" strokeWidth="2"/>
              <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + chartH} stroke="#94a3b8" strokeWidth="2"/>
              {/* Y-axis labels */}
              {yTicks.map(v => <text key={v} x={PAD_L - 8} y={toY(v) + 4} textAnchor="end" fill="#94a3b8" fontSize="11">{v}%</text>)}
              {/* X-axis labels */}
              {xTicks.filter(v => v % 25 === 0).map(v => <text key={v} x={toX(v)} y={PAD_T + chartH + 16} textAnchor="middle" fill="#94a3b8" fontSize="11">{v}%</text>)}
              {/* Axis titles */}
              <text x={PAD_L + chartW / 2} y={H - 2} textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="bold">Performance (% of Quota)</text>
              <text x="12" y={PAD_T + chartH / 2} textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="bold" transform={`rotate(-90,12,${PAD_T + chartH / 2})`}>Payout (%)</text>
              {/* Target reference lines */}
              <line x1={toX(100)} y1={PAD_T} x2={toX(100)} y2={PAD_T + chartH} stroke="#10b981" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7"/>
              <line x1={PAD_L} y1={toY(100)} x2={W - PAD_R} y2={toY(100)} stroke="#10b981" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7"/>
              <text x={toX(100) + 4} y={PAD_T + 14} fill="#10b981" fontSize="11" fontWeight="bold">100% Target</text>
              {/* Threshold label on x-axis */}
              {thresholdPerf > xMin && (
                <text x={toX(thresholdPerf)} y={PAD_T + chartH + 16} textAnchor="middle" fill="#ef4444" fontSize="11" fontWeight="bold">{thresholdPerf}%↑</text>
              )}
              {/* Curve line (from 0 through threshold, then data points) */}
              <polyline
                points={fullLine.map(p => `${toX(p.performance)},${toY(p.payout)}`).join(' ')}
                fill="none" stroke="#22d3ee" strokeWidth="3"
              />
              {/* Data point dots */}
              {curveData.map((p, i) => {
                const color = p.payout === 0 ? '#ef4444' : p.payout < 100 ? '#eab308' : p.payout === 100 ? '#10b981' : '#22d3ee';
                return <circle key={i} cx={toX(p.performance)} cy={toY(p.payout)} r="6" fill={color} stroke="#1e293b" strokeWidth="2"/>;
              })}
            </svg>
          </div>
        </div>
        <table className="w-full border-collapse border border-blue-400/30 rounded text-xs">
          <thead className="bg-blue-500/20">
            <tr>
              <th className="border border-blue-400/30 px-3 py-2 text-left text-blue-300">Performance %</th>
              <th className="border border-blue-400/30 px-3 py-2 text-left text-blue-300">Payout %</th>
              <th className="border border-blue-400/30 px-3 py-2 text-left text-blue-300">Status</th>
            </tr>
          </thead>
          <tbody>
            {curveData.map((p, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-slate-800/30' : 'bg-slate-800/50'}>
                <td className="border border-blue-400/30 px-3 py-1.5">{p.performance}%</td>
                <td className="border border-blue-400/30 px-3 py-1.5 font-semibold">{p.payout}%</td>
                <td className="border border-blue-400/30 px-3 py-1.5">
                  {p.payout === 0 ? <span className="text-red-400">❌ No Payout</span> :
                   p.payout < 100 ? <span className="text-yellow-400">📊 Below Target</span> :
                   p.payout === 100 ? <span className="text-green-400">✅ On Target</span> :
                   <span className="text-cyan-400">🚀 Accelerator</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-4 mt-3 text-xs">
          {[['bg-red-400','No Payout'],['bg-yellow-400','Below Target'],['bg-green-400','On Target'],['bg-cyan-400','Accelerator']].map(([c,l]) => (
            <div key={l} className="flex items-center gap-1.5"><div className={`w-3 h-3 rounded-full ${c}`}/><span>{l}</span></div>
          ))}
        </div>
      </div>
    );
  };

  // Format markdown: handles chart blocks, tables, bold, headers, bullets, citations
  const formatMarkdown = (content) => {
    // 1. Parse references from full content first
    const references = parseReferences(content);
    // Strip the references section from content before rendering
    const cleanContent = content.replace(/[-]{2,}\s*\nReferences:\s*\n[\s\S]+?(\n[-]{2,}|\s*$)/i, '').trimEnd();

    // 2. Chart block
    const chartMatch = cleanContent.match(/```chart-payout\n([\s\S]+?)\n```/);
    if (chartMatch) {
      try {
        const chartData = JSON.parse(chartMatch[1]);
        const textWithoutChart = cleanContent.replace(/```chart-payout\n[\s\S]+?\n```/, '').trim();
        return (
          <div className="space-y-2">
            {renderPayoutCurveChart(chartData)}
            {textWithoutChart && <div>{formatMarkdown(textWithoutChart)}</div>}
          </div>
        );
      } catch(e) { /* fall through */ }
    }

    // 3. Split into lines and build element list (text blocks vs table blocks)
    const lines = cleanContent.split('\n');
    const elements = [];
    let tableLines = [];
    let textLines = [];

    const flushText = () => {
      if (textLines.length > 0) { elements.push({ type: 'text', lines: [...textLines] }); textLines = []; }
    };
    const flushTable = () => {
      if (tableLines.length > 0) { elements.push({ type: 'table', lines: [...tableLines] }); tableLines = []; }
    };

    for (const line of lines) {
      if (line.includes('|') && line.split('|').length >= 3) {
        flushText(); tableLines.push(line);
      } else {
        flushTable(); textLines.push(line);
      }
    }
    flushText(); flushTable();

    // 4. Inline formatter: bold, italic, code
    const inlineFormat = (text) =>
      text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code class="bg-slate-700 px-1 rounded text-cyan-300 text-xs">$1</code>');

    return (
      <div className="space-y-1">
        {elements.map((el, idx) => {
          if (el.type === 'table') {
            const rows = el.lines
              .filter(l => !l.match(/^[\s\-:|]+$/))
              .map(l => l.split('|').map(c => c.trim()).filter(c => c.length > 0))
              .filter(r => r.length > 0);
            if (rows.length === 0) return null;
            const [header, ...body] = rows;
            return (
              <div key={idx} className="overflow-x-auto my-3">
                <table className="min-w-full border-collapse border border-blue-400/30 rounded-lg overflow-hidden text-sm">
                  <thead className="bg-blue-500/20">
                    <tr>{header.map((h, i) => (
                      <th key={i} className="border border-blue-400/30 px-3 py-2 text-left font-semibold text-blue-300 whitespace-nowrap"
                        dangerouslySetInnerHTML={{ __html: inlineFormat(h) }} />
                    ))}</tr>
                  </thead>
                  <tbody>
                    {body.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-slate-800/30' : 'bg-slate-800/50'}>
                        {row.map((cell, j) => (
                          <td key={j} className="border border-blue-400/30 px-3 py-2 text-sm align-top"
                            dangerouslySetInnerHTML={{ __html: inlineFormat(cell) }} />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          } else {
            return (
              <div key={idx} className="space-y-1">
                {el.lines.map((line, i) => {
                  if (line.startsWith('### ')) return <h3 key={i} className="text-base font-bold text-cyan-300 mt-3 mb-1" dangerouslySetInnerHTML={{ __html: inlineFormat(line.slice(4)) }} />;
                  if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-bold text-cyan-400 mt-4 mb-1 border-b border-cyan-400/20 pb-1" dangerouslySetInnerHTML={{ __html: inlineFormat(line.slice(3)) }} />;
                  if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold text-white mt-4 mb-2" dangerouslySetInnerHTML={{ __html: inlineFormat(line.slice(2)) }} />;
                  if (line.match(/^(\s*[-*+]|\s*\d+\.)\s/)) {
                    const indent = line.match(/^(\s*)/)[1].length;
                    const text = line.replace(/^(\s*[-*+]|\s*\d+\.)\s/, '');
                    return (
                      <div key={i} className="flex gap-2 leading-relaxed" style={{ paddingLeft: `${indent * 4}px` }}>
                        <span className="text-cyan-400 flex-shrink-0 mt-0.5">•</span>
                        <span className="text-sm">{renderTextWithCitations(text, references)}</span>
                      </div>
                    );
                  }
                  if (line.trim() === '' || line.trim() === '---') return <div key={i} className="h-2"/>;
                  return <div key={i} className="text-sm leading-relaxed">{renderTextWithCitations(line, references)}</div>;
                })}
              </div>
            );
          }
        })}

        {/* Tooltip */}
        {hoveredCitation && hoveredCitation.text && (
          <div className="fixed z-50 bg-slate-800 border border-cyan-400/50 rounded-lg p-3 shadow-xl max-w-sm pointer-events-none"
            style={{ left: `${hoveredCitation.x}px`, top: `${hoveredCitation.y + 10}px`, transform: 'translateX(-50%)' }}>
            <div className="text-xs text-cyan-300 font-semibold mb-1">Reference [{hoveredCitation.num}]</div>
            <div className="text-sm text-slate-200">{hoveredCitation.text}</div>
          </div>
        )}

        {/* References panel */}
        {Object.keys(references).length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-700">
            <div className="text-sm font-semibold text-cyan-400 mb-2">📚 References</div>
            <div className="space-y-1 text-xs text-slate-400">
              {Object.entries(references).map(([num, text]) => (
                <div key={num} className="flex gap-2">
                  <span className="text-cyan-400 font-semibold min-w-[20px]">[{num}]</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Generate AI-powered contextual follow-up suggestions
  const generateSuggestions = async (conversationHistory) => {
    if (!suggestionsEnabled || conversationHistory.length === 0) {
      setSuggestedPrompts([]);
      return;
    }
    try {
      const recentMessages = conversationHistory.slice(-6).map(m =>
        `${m.role}: ${m.content.substring(0, 300)}`
      ).join('\n');
      const knowledgeTopics = documents.map(d => d.name).join(', ');
      const activeWorkflowContext = currentWorkflow
        ? `Active workflow: ${topics.find(t => t.id === currentWorkflow.topicId)?.name}, Step ${currentWorkflow.currentStep + 1}`
        : 'No active workflow';
      const response = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: groqHeaders(),
        body: JSON.stringify({
          model: GROQ_MODEL,
          max_tokens: 200,
          messages: [
            { role: 'system', content: 'You generate short follow-up questions for pharmaceutical sales/IC conversations. Respond ONLY with a JSON array of strings, no other text. Max 3 items, max 10 words each.' },
            {
              role: 'user',
              content: `Recent conversation:\n${recentMessages}\n\nContext: ${activeWorkflowContext}\nKnowledge: ${knowledgeTopics}\n\nGenerate 2-3 follow-up questions: ["Q1", "Q2"]`
            }
          ]
        })
      });
      const data = await response.json();
      const text = groqAssistantText(data)?.trim();
      if (text) {
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        if (Array.isArray(parsed)) setSuggestedPrompts(parsed.slice(0, maxSuggestions));
      }
    } catch (e) {
      console.warn('generateSuggestions error:', e);
      setSuggestedPrompts([]);
    }
  };

  // Separate PPTX intent detector — runs independently after any substantive response
  const detectPptxIntent = async (conversationHistory) => {
    if (conversationHistory.length < 2) return;
    try {
      const recentMessages = conversationHistory.slice(-8).map(m =>
        `${m.role}: ${m.content.substring(0, 400)}`
      ).join('\n');
      const response = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: groqHeaders(),
        body: JSON.stringify({
          model: GROQ_MODEL,
          max_tokens: 400,
          messages: [
            { role: 'system', content: pptxPrompts.intentDetection },
            { role: 'user', content: `Conversation:\n${recentMessages}` }
          ]
        })
      });
      const data = await response.json();
      const text = groqAssistantText(data)?.trim();
      if (text) {
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        if (parsed.offer && (parsed.summaryDeck || parsed.producedDeck)) {
          setPptxOffers({
            summary: parsed.summaryDeck || null,
            produced: parsed.producedDeck || null,
          });
        }
      }
    } catch (e) {
      console.warn('detectPptxIntent error:', e);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Watch messages — after any assistant or orchestrator response, check for PPTX intent
  // Disabled during active workflows (documentation agent handles it) and too early in conversations
  const lastMessageRef = useRef(0);
  useEffect(() => {
    // Never detect during an active workflow — the documentation agent handles export
    if (currentWorkflow) return;

    const substantiveMessages = messages.filter(m =>
      (m.role === 'assistant' || m.role === 'orchestrator') &&
      m.content?.length > 200 && // meaningful content only
      !m.content.includes('Would you like me to start') && // not a workflow proposal
      !m.content.includes('want to start this workflow') &&
      !m.content.includes('shall we begin')
    );

    // Need at least 2 substantive exchanges before offering export
    if (substantiveMessages.length < 2) return;
    if (substantiveMessages.length === lastMessageRef.current) return;
    lastMessageRef.current = substantiveMessages.length;

    const timer = setTimeout(() => {
      if (!isLoading && !currentWorkflow) detectPptxIntent(messages);
    }, 2000);
    return () => clearTimeout(timer);
  }, [messages, isLoading, currentWorkflow]);
  // Groq (OpenAI-compatible chat completions)
  const callGroq = async (system, messages, maxTokens = 1000) => {
    const chatMessages = system
      ? [{ role: 'system', content: system }, ...messages]
      : [...messages];
    const res = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: groqHeaders(),
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: maxTokens,
        messages: chatMessages
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API error ${res.status}: ${errText.substring(0, 200)}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(`Groq error: ${data.error.message || JSON.stringify(data.error)}`);
    return groqAssistantText(data);
  };

  // Build agent knowledge string
  const buildAgentKnowledge = (agent) => {
    if (!agent.knowledgeFiles) return '';
    return documents
      .filter(d => agent.knowledgeFiles.includes(d.id) && d.status === 'active' && d.content)
      .map(d => `## ${d.name}\n${d.content}`)
      .join('\n\n');
  };

  const runAgent = async (agent, step, messages) => {
    const knowledge = buildAgentKnowledge(agent);

    const system = `${agent.systemPrompt}
${knowledge ? `\n\nKNOWLEDGE BASE:\n${knowledge}` : ''}

YOUR CURRENT TASK:
Step ${step.step}: ${step.name}
Goal: ${step.goal}
Success criteria: ${step.successCriteria}

If you identify something outside your specialization that requires another agent, flag it at the end:
REQUIRES_HANDOFF: [agent_id] - [specific task for them]

Use ## headers, tables, **bold**, and emoji (✅❌⚠️🎯📊) in your response.`;

    return await callGroq(system, messages, 3000);
  };

  // Orchestrator evaluation: checks if step succeeded and decides what happens next
  const orchestratorEvaluate = async (topic, step, agentResponse, workflowContext) => {
    const orch = topic.orchestrator;
    const allAgentsList = agents.map(a => `${a.id}: ${a.name} - ${a.systemPrompt.substring(0, 80)}`).join('\n');

    const stepList = topic.workflow.map(s => `Step ${s.step} (index ${s.step - 1}): ${s.name} — agent: ${s.agents[0]}`).join('\n');

    const system = `${orch.role}
Overall goal: ${orch.goal}

You are the orchestrator. Your job is to decide whether an agent has FINISHED its task for this step, or is still mid-task (e.g. asking the user for information to continue its work).

Workflow steps available:
${stepList}

Respond in JSON only:
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

CRITICAL RULE — agentStillWorking:
- Set true if the agent is asking the user a question or requesting more information to complete its task. In this case set orchestratorMessage to "" and buttons to []. The user responds directly to the agent — do NOT intervene.
- Set false only when the agent has finished producing its output for this step (a design, analysis, report, recommendation etc). Then YOU summarise and present decisions.

WHEN agentStillWorking is false — always write orchestratorMessage and buttons:

orchestratorMessage:
- Concise summary of what the agent produced (2-3 sentences max)
- Frame the decision clearly
- Do NOT repeat the agent's questions or output verbatim
- Do NOT end with "type your own response below" — that's handled by the UI

buttons — generate 2-4 contextually appropriate decision buttons. Each button has this shape:
{ "label": "Button text", "action": "proceed|refine|redesign|override|custom_key", "requiresInput": false, "inputPrompt": "" }

requiresInput — set true when clicking this button implies the user needs to provide specifics before the action can execute. Examples:
- "🔄 Remove a component" → requiresInput: true, inputPrompt: "Which component would you like to remove?"
- "✏️ Adjust a weighting" → requiresInput: true, inputPrompt: "Which component and what weighting would you like?"
- "✅ Proceed to compliance review" → requiresInput: false
- "🔄 Redesign scheme" → requiresInput: false (the redesign briefing already exists)
- "🔓 Override with reason" → requiresInput: true, inputPrompt: "Please provide your reason for overriding."

When requiresInput is true, the UI will show the inputPrompt as an inline text field before executing. When false, the button executes immediately.

Always include at least one "proceed" path and one "refine/revisit" path. Buttons are for DECISIONS only — not conversational prompts like "I'll answer now".

rerouteToStep — leave null here. Set only when user clicks redesign/send_back.

ROUTING RULES:
- Quick one-off sub-tasks → handoffs
- workflowComplete: true only on the final step when fully done

Available agents:
${allAgentsList}`;

    const contextStr = workflowContext.map(c => `[${c.step}] ${c.agent}: ${c.output.substring(0, 300)}`).join('\n\n');
    const userContent = `Workflow: ${topic.name}
Step ${step.step}/${topic.workflow.length}: ${step.name}
Next step: ${topic.workflow[step.step] ? topic.workflow[step.step].name : 'Final step'}
Success criteria: ${step.successCriteria}

Agent response (summarised):
${agentResponse.substring(0, 1200)}

Previous context:
${contextStr || 'None'}`;

    const raw = await callGroq(system, [{ role: 'user', content: userContent }], 1200);
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);
    } catch {
      return {
        agentStillWorking: false, stepComplete: false, rerouteToStep: null, rerouteBriefing: '', handoffs: [],
        buttons: [{ label: '✅ Continue', action: 'proceed', requiresInput: false, inputPrompt: '' }, { label: '✏️ Refine', action: 'refine', requiresInput: true, inputPrompt: 'What would you like to refine?' }],
        orchestratorMessage: 'The agent has completed its work. How would you like to proceed?',
        workflowComplete: false
      };
    }
  };

  // Execute a handoff - agent receives only the specific task the orchestrator has prepared
  const executeHandoff = async (agentId, task) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent || agent.status !== 'active') return null;
    const knowledge = buildAgentKnowledge(agent);
    const system = `${agent.systemPrompt}
${knowledge ? `\n\nKNOWLEDGE BASE:\n${knowledge}` : ''}

You have been assigned a specific sub-task by the workflow orchestrator.
Use ## headers, tables, **bold**, emoji in your response.`;
    return await callGroq(system, [{ role: 'user', content: task }], 2000);
  };

  // Main orchestrator - two modes: intro (workflow start) and evaluate (after each agent)
  const executeOrchestrator = async (topic, userMessage, stepIndex = null) => {
    const currentStep = stepIndex !== null ? stepIndex : (currentWorkflow?.currentStep || 0);
    const workflowContext = currentWorkflow?.context || [];
    const isIntro = currentStep === 0 && workflowContext.length === 0;

    // ── INTRO PHASE: Orchestrator introduces itself, outlines the plan, hands to Step 1 ──
    if (isIntro) {
      logActivity('orchestrator', `Starting workflow: ${topic.name}`);

      const stepList = topic.workflow.map(s => `Step ${s.step}: ${s.name} — ${s.goal}`).join('\n');
      const firstAgent = agents.find(a => a.id === topic.workflow[0].agents[0]);
      const isFocused = !!currentWorkflow?.focusedContext;

      const introSystem = `${topic.orchestrator.role}
Overall goal: ${topic.orchestrator.goal}

${isFocused
  ? `The user has already selected a specific territory and wants to assess it directly. Keep your introduction to 1 sentence stating you will coordinate the assessment. Do NOT list all steps. End with: "I'll hand you to **${firstAgent?.name}** to begin."`
  : `Introduce yourself briefly (1-2 sentences), state the overall goal, list the steps clearly, then hand off to the first agent. Use **bold** for step names. End with: "I'll now hand you to **${firstAgent?.name}** to begin."`
}`;

      const introResponse = await callGroq(introSystem, [{
        role: 'user',
        content: isFocused
          ? `The user wants to: ${userMessage}`
          : `The user wants to: ${userMessage}\n\nWorkflow steps:\n${stepList}`
      }], 200);

      setMessages(prev => [...prev, { role: 'orchestrator', content: introResponse }]);

      // Small pause then kick off Step 1
      setIsLoading(false);
      setTimeout(async () => {
        setIsLoading(true);
        await runWorkflowStep(topic, 0, userMessage, []);
        setIsLoading(false);
      }, 800);
      return;
    }

    // ── EVALUATE PHASE: Orchestrator reviews last agent output, decides what's next ──
    await runWorkflowStep(topic, currentStep, userMessage, workflowContext);
  };

  // Launch a workflow directly without the confirm step (e.g. from Territory tab buttons)
  // focusedContext: optional string injected into step 1 briefing instead of full structure
  const launchWorkflowDirect = async (topicId, userMessage, focusedContext = null) => {
    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;
    setIsLoading(true);
    setPptxOffers(null); // clear any pending export offer
    setCurrentWorkflow({ topicId: topic.id, currentStep: 0, context: [], waitingForUser: false, focusedContext });
    setPendingWorkflow(null);
    logActivity('workflow', `Direct launch: ${topic.name}`);
    // Skip the confirm offer — go straight to orchestrator intro and step 1
    await executeOrchestrator(topic, userMessage, 0);
    setIsLoading(false);
  };

  // User replied to an agent's question - continue the conversation with full history
  const continueAgentWithUserReply = async (topic, stepIndex, userReply, workflowContext) => {
    const step = topic.workflow[stepIndex];
    const agentId = step.agents[0];
    const agent = agents.find(a => a.id === agentId);

    if (!agent || agent.status !== 'active') {
      setMessages(prev => [...prev, { role: 'system', content: `⚠️ Agent "${agentId}" not available` }]);
      setIsLoading(false);
      return;
    }

    logActivity('agent', `${agent.name} continuing conversation`);

    try {
      // Build full conversation history: prior exchanges + new user reply
      const priorMessages = currentWorkflow?.stepMessages || [];
      const fullMessages = [...priorMessages, { role: 'user', content: userReply }];
      const agentResponse = await runAgent(agent, step, fullMessages);
      setMessages(prev => [...prev, { role: 'assistant', content: `**[${agent.name}]**\n\n${agentResponse}` }]);

      // Accumulate for next reply
      const updatedStepMessages = [...fullMessages, { role: 'assistant', content: agentResponse }];

      // Orchestrator evaluates with the latest response
      logActivity('orchestrator', `Evaluating Step ${stepIndex + 1} after user reply`);
      const evaluation = await orchestratorEvaluate(topic, step, agentResponse, workflowContext);

      // Handle handoffs
      const handoffMatches = [...agentResponse.matchAll(/REQUIRES_HANDOFF:\s*(\S+)\s*-\s*(.+)/gi)];
      const allHandoffs = [...handoffMatches.map(m => ({ agentId: m[1], task: m[2] })), ...(evaluation.handoffs || [])];
      const handoffOutputs = [];
      for (const handoff of allHandoffs) {
        const handoffAgent = agents.find(a => a.id === handoff.agentId);
        if (!handoffAgent) continue;
        setMessages(prev => [...prev, { role: 'orchestrator', content: `🔀 **Routing to ${handoffAgent.name}:** ${handoff.task}` }]);
        const handoffResponse = await executeHandoff(handoff.agentId, handoff.task);
        if (handoffResponse) {
          setMessages(prev => [...prev, { role: 'assistant', content: `**[${handoffAgent.name}]**\n\n${handoffResponse}` }]);
          handoffOutputs.push({ agent: handoffAgent.name, output: handoffResponse.substring(0, 500) });
        }
      }

      const updatedContext = [
        ...workflowContext,
        { step: `Step ${step.step}: ${step.name}`, agent: agent.name, output: agentResponse.substring(0, 800), handoffs: handoffOutputs }
      ];

      if (evaluation.workflowComplete) {
        if (evaluation.orchestratorMessage) setMessages(prev => [...prev, { role: 'orchestrator', content: evaluation.orchestratorMessage }]);
        await wrapUpWorkflow(topic, updatedContext);
        return;
      }

      // Always pause — orchestrator presents summary + buttons, user decides
      postOrchestratorDecision(evaluation, topic, stepIndex, updatedContext, userReply);
      setCurrentWorkflow(prev => prev ? { ...prev, currentStep: stepIndex, context: updatedContext, waitingForUser: true, stepMessages: updatedStepMessages } : null);
      setIsLoading(false);

    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', content: `⚠️ Error: ${err.message}` }]);
      setIsLoading(false);
    }
  };

  // Post orchestrator message and set dynamic decision buttons
  const postOrchestratorDecision = (evaluation, topic, stepIndex, updatedContext, userMessage) => {
    // If agent is still mid-task, don't intervene — let user reply directly to agent
    if (evaluation.agentStillWorking) return;
    if (evaluation.orchestratorMessage) {
      setMessages(prev => [...prev, { role: 'orchestrator', content: evaluation.orchestratorMessage }]);
    }
    const buttons = evaluation.buttons || [];
    if (buttons.length > 0) {
      setOrchestratorDecision({ buttons, topic, stepIndex, context: updatedContext, userMessage, rerouteToStep: evaluation.rerouteToStep, rerouteBriefing: evaluation.rerouteBriefing });
    }
  };

  // Handle orchestrator decision — button click or free-text response
  const handleOrchestratorAction = async (action, decision, typedInput = null) => {
    setOrchestratorDecision(null);
    setIsLoading(true);
    const { topic, stepIndex, context, userMessage, rerouteToStep, rerouteBriefing } = decision;
    const effectiveInput = typedInput || userMessage;

    if (action === 'proceed') {
      setCurrentWorkflow(prev => prev ? { ...prev, waitingForUser: false, stepMessages: [] } : null);
      await advanceToNextStep(topic, stepIndex, context, effectiveInput);

    } else if (action === 'redesign' || action === 'send_back') {
      const targetIdx = (rerouteToStep !== null && rerouteToStep !== undefined) ? rerouteToStep : stepIndex - 1;
      const targetStep = topic.workflow[targetIdx];
      const targetAgent = agents.find(a => a.id === targetStep?.agents[0]);
      setMessages(prev => [...prev, { role: 'orchestrator', content: `🔄 Routing back to **${targetStep?.name}** (${targetAgent?.name}) for rework.` }]);
      setCurrentWorkflow(prev => prev ? { ...prev, currentStep: targetIdx, context, waitingForUser: false, stepMessages: [] } : null);
      await runWorkflowStep(topic, targetIdx, rerouteBriefing || effectiveInput, context);

    } else if (action === 'override') {
      setMessages(prev => [...prev, { role: 'orchestrator', content: `⚠️ Override accepted. Proceeding with noted risks.` }]);
      setCurrentWorkflow(prev => prev ? { ...prev, waitingForUser: false, stepMessages: [] } : null);
      await advanceToNextStep(topic, stepIndex, context, effectiveInput);

    } else {
      // refine, custom action, or any other — re-run current step with user's instruction
      const briefing = typedInput || `User instruction: ${action}. Please refine your work accordingly.`;
      setCurrentWorkflow(prev => prev ? { ...prev, currentStep: stepIndex, waitingForUser: false, stepMessages: [] } : null);
      await runWorkflowStep(topic, stepIndex, briefing, context);
    }

    setIsLoading(false);
  };

  // Orchestrator advances to next step with transition message
  const advanceToNextStep = async (topic, completedStepIndex, updatedContext, userMessage) => {
    const nextStep = completedStepIndex + 1;
    if (nextStep < topic.workflow.length) {
      // Clear stepMessages so new step starts with fresh conversation history
      setCurrentWorkflow(prev => prev ? { ...prev, currentStep: nextStep, context: updatedContext, waitingForUser: false, stepMessages: [] } : null);
      setTimeout(async () => {
        setIsLoading(true);
        await runWorkflowStep(topic, nextStep, userMessage, updatedContext);
        setIsLoading(false);
      }, 800);
    } else {
      await wrapUpWorkflow(topic, updatedContext);
    }
  };

  // Orchestrator wrap-up summary
  const wrapUpWorkflow = async (topic, updatedContext) => {
    const wrapSystem = `${topic.orchestrator.role}\nThe workflow is now complete. Write a brief, warm closing summary (3-5 sentences) covering what was accomplished. Mention key outputs.`;
    const wrapSummary = await callGroq(wrapSystem, [{
      role: 'user',
      content: `Completed: ${topic.name}\n${updatedContext.map(c => `${c.step}: ${c.output.substring(0, 150)}`).join('\n')}`
    }], 300);
    setMessages(prev => {
      const updated = [...prev, { role: 'orchestrator', content: wrapSummary }];
      setTimeout(() => generateSuggestions(updated), 800);
      return updated;
    });
    setMessages(prev => [...prev, { role: 'system', content: `✅ **Workflow complete** — ${topic.workflow.length} steps finished.` }]);
    setCurrentWorkflow(null);
    setIsLoading(false);
  };

  // Run a step: brief agent → orchestrator evaluates → advance or coordinate
  const runWorkflowStep = async (topic, stepIndex, userMessage, workflowContext) => {
    const step = topic.workflow[stepIndex];
    const agentId = step.agents[0];
    const agent = agents.find(a => a.id === agentId);

    if (!agent || agent.status !== 'active') {
      setMessages(prev => [...prev, { role: 'system', content: `⚠️ Agent "${agentId}" not available` }]);
      setIsLoading(false);
      return;
    }

    logActivity('orchestrator', `Step ${stepIndex + 1}/${topic.workflow.length}: briefing ${agent.name}`);

    // Show step indicator
    setMessages(prev => [...prev, {
      role: 'system',
      content: `📍 **Step ${step.step}/${topic.workflow.length}: ${step.name}** — 🤖 ${agent.name}`
    }]);

    try {
      // 1. Orchestrator prepares focused briefing for the agent
      let taskBriefing = userMessage;

      // For territory workflows step 1 — inject structure context (focused if launched from specific territory, full if general)
      const isTerritoryWorkflow = topic.id === 'territory_assessment';
      const isStructureStep = stepIndex === 0;
      const focusedContext = currentWorkflow?.focusedContext || null;

      if (isTerritoryWorkflow && isStructureStep && territoryStructures.length > 0) {
        const activeStruct = territoryStructures.find(s => s.id === selectedTerritoryStructure) || territoryStructures[0];

        if (focusedContext) {
          // Launched from a specific territory — full structure included for benchmarking, focus on selected territory
          taskBriefing = `${focusedContext}

INSTRUCTION: The user wants to assess the FOCUS TERRITORY marked above. The full territory list is provided so you can benchmark and compare — use it to identify how the focus territory sits relative to its manager region and the national average.

Do NOT ask whether to use this structure — it is confirmed. Do NOT ask the user to provide data you already have above.

Begin by presenting a brief profile of the focus territory with key comparisons (vs region avg, vs national avg). Then ask what specific aspects the user wants to explore further — for example: workload relative to peers, HCP segment mix, geographic efficiency, opportunity vs effort.`;
        } else {
          // General launch — show full structure, ask user to confirm or provide different one
          const structSummary = `LOADED TERRITORY STRUCTURE: "${activeStruct.name}" (${activeStruct.uploadedAt})
Managers: ${activeStruct.managers.map(m => `${m.name} (${m.region})`).join(', ')}
Territories (${activeStruct.territories.length} total):
${activeStruct.territories.slice(0, 20).map(t => `  ${t.id} ${t.name} | Rep: ${t.rep} | HCPs: A=${t.hcps.A} B=${t.hcps.B} C=${t.hcps.C} Total=${t.hcps.A+t.hcps.B+t.hcps.C}`).join('\n')}`;
          taskBriefing = `${structSummary}\n\nUser request: ${userMessage}\n\nA territory structure is pre-loaded above. Ask the user: (1) Do they want to use this structure or provide a different one? (2) Should the assessment cover all territories or focus on a specific region or territory?`;
        }
      } else if (workflowContext.length > 0) {
        const contextSummary = workflowContext
          .map(c => `[${c.step}] ${c.agent}: ${c.output}`)
          .join('\n\n');
        const briefingSystem = `${topic.orchestrator.role}
You are preparing a focused task briefing for the next specialist agent. Include only what is directly relevant to their task. Be specific and concise (3-5 sentences max).`;
        const briefingPrompt = `Context from prior steps:\n${contextSummary}\n\nNext agent: ${agent.name}\nTask: Step ${step.step} - ${step.name}\nGoal: ${step.goal}\nUser's message: ${userMessage}\n\nWrite the briefing.`;
        taskBriefing = await callGroq(briefingSystem, [{ role: 'user', content: briefingPrompt }], 300);
      }

      // 2. Run agent with task briefing (first message in this step's conversation)
      const initialMessages = [{ role: 'user', content: taskBriefing }];
      logActivity('agent', `Running ${agent.name}`);
      const agentResponse = await runAgent(agent, step, initialMessages);
      setMessages(prev => [...prev, { role: 'assistant', content: `**[${agent.name}]**\n\n${agentResponse}` }]);
      const initialStepMessages = [...initialMessages, { role: 'assistant', content: agentResponse }];

      // 3. Check for self-flagged handoffs from the agent
      const handoffMatches = [...agentResponse.matchAll(/REQUIRES_HANDOFF:\s*(\S+)\s*-\s*(.+)/gi)];
      const agentHandoffs = handoffMatches.map(m => ({ agentId: m[1], task: m[2] }));

      // 4. Orchestrator evaluates completion
      logActivity('orchestrator', `Evaluating Step ${stepIndex + 1}`);
      const evaluation = await orchestratorEvaluate(topic, step, agentResponse, workflowContext);

      // 5. Handle any handoffs (agent-flagged + orchestrator-directed)
      const allHandoffs = [...agentHandoffs, ...(evaluation.handoffs || [])];
      const handoffOutputs = [];
      for (const handoff of allHandoffs) {
        const handoffAgent = agents.find(a => a.id === handoff.agentId);
        if (!handoffAgent) continue;
        logActivity('orchestrator', `Routing to ${handoffAgent.name}`);
        setMessages(prev => [...prev, {
          role: 'orchestrator',
          content: `🔀 **Routing to ${handoffAgent.name}:** ${handoff.task}`
        }]);
        const handoffResponse = await executeHandoff(handoff.agentId, handoff.task);
        if (handoffResponse) {
          setMessages(prev => [...prev, { role: 'assistant', content: `**[${handoffAgent.name}]**\n\n${handoffResponse}` }]);
          handoffOutputs.push({ agent: handoffAgent.name, output: handoffResponse.substring(0, 500) });
        }
      }

      // 6. Update context
      const updatedContext = [
        ...workflowContext,
        {
          step: `Step ${step.step}: ${step.name}`,
          agent: agent.name,
          output: agentResponse.substring(0, 800),
          handoffs: handoffOutputs
        }
      ];

      // 7. Workflow complete
      if (evaluation.workflowComplete) {
        if (evaluation.orchestratorMessage) setMessages(prev => [...prev, { role: 'orchestrator', content: evaluation.orchestratorMessage }]);
        await wrapUpWorkflow(topic, updatedContext);
        return;
      }

      // 8. Always pause — orchestrator presents summary + buttons, user decides
      logActivity('orchestrator', `Step ${stepIndex + 1} awaiting user decision`);
      postOrchestratorDecision(evaluation, topic, stepIndex, updatedContext, userMessage);
      setCurrentWorkflow(prev => prev ? { ...prev, currentStep: stepIndex, context: updatedContext, waitingForUser: true, stepMessages: initialStepMessages } : null);
      setIsLoading(false);

    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', content: `⚠️ Orchestrator error: ${err.message}` }]);
      setIsLoading(false);
    }
  };

  // Handle file upload for assessment
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploadedFile(file);
    
    // Add system message about file upload
    const fileType = file.type.includes('pdf') ? 'PDF' : file.type.includes('presentation') || file.type.includes('powerpoint') ? 'PowerPoint' : 'document';
    const fileMessage = `📎 File uploaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)\n\nAnalyzing this ${fileType} incentive scheme proposal against the 6 Fundamental Axes framework...`;
    setMessages(prev => [...prev, { role: 'system', content: fileMessage }]);

    // Trigger analysis after brief delay
    setTimeout(() => {
      const analysisPrompt = `Please provide a comprehensive assessment of the uploaded incentive scheme document "${file.name}". Evaluate it against the 6 Fundamental Axes:

1. **Strategic Alignment** - Are components aligned with business strategy? Any SvT on launch products?
2. **Fairness** - Is target payout fixed per role? Territory equity considered?
3. **Motivation** - Appropriate pay mix (20-30%)? Top performers earn 2x average?
4. **Reliability** - Data sources reliable? Calculations simple?
5. **Financial Responsibility** - Win-win validation? Proper caps/thresholds?
6. **Simplicity** - Under 5 components? Each weighted >20%? Business card test?

Check for mandatory rule violations and provide specific recommendations for improvement.`;
      handleSubmit(null, analysisPrompt, true);
    }, 800);
    
    // Clear file input for next upload
    event.target.value = '';
  };

  // Handle admin knowledge base file upload
  const handleAdminFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Check if it's a YAML file
    const isYaml = file.name.endsWith('.yml') || file.name.endsWith('.yaml');
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const newDoc = {
        id: Date.now(),
        name: file.name,
        type: isYaml ? 'yaml' : file.type,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        status: 'active',
        content: content
      };
      setDocuments(prev => [...prev, newDoc]);
      
      // If it's YAML, add it to structured knowledge
      if (isYaml) {
        // Extract pillar name from content if possible
        const pillarMatch = content.match(/pillar_name:\s*["']([^"']+)["']/);
        const pillarName = pillarMatch ? pillarMatch[1] : file.name;
        
        // Add to knowledge base with clear section header
        setKnowledgeBase(prev => prev + `\n\n## ${pillarName} (from ${file.name})\n${content.substring(0, 5000)}`);
        
        // Show success message
        setMessages(prev => [...prev, {
          role: 'system',
          content: `✅ Successfully loaded ${file.name}. The AI now has access to ${pillarName} knowledge.`
        }]);
      } else {
        // For non-YAML files, add as before
        setKnowledgeBase(prev => prev + `\n\n## Document: ${file.name}\n${content.substring(0, 10000)}`);
      }
    };
    
    reader.readAsText(file);
    
    // Clear the input for next upload
    event.target.value = '';
  };

  const removeDocument = (id) => {
    setDocuments(prev => prev.filter(doc => doc.id !== id));
  };

  // Called when user clicks Generate on the PPTX offer
  // Generates slide content via API, stores it, then posts a trigger message into chat
  const handleGeneratePptx = async (offer, mode = 'summary') => {
    setPptxOffers(null);
    setPptxGenerating(true);

    const conversationSummary = messages.slice(-16)
      .filter(m => ['user','assistant','orchestrator'].includes(m.role))
      .map(m => `${m.role}: ${m.content.substring(0, 500)}`)
      .join('\n');

    const isSummary = mode === 'summary';
    // Use editable prompts from Admin > PPT Prompts
    const systemPrompt = isSummary ? pptxPrompts.summary : pptxPrompts.produced;

    try {
      const res = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: groqHeaders(),
        body: JSON.stringify({
          model: GROQ_MODEL,
          max_tokens: isSummary ? 2500 : 4096,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Document requested: "${offer.title}"\n\n${isSummary ? 'Conversation to summarise' : 'Context (use specific details if present, invent realistic ones if missing)'}:\n${conversationSummary}\n\nIMPORTANT: Match the slide count and format to the document type requested — do not default to a long deck if something brief was asked for.` }
          ]
        })
      });
      const data = await res.json();
      const finishReason = data?.choices?.[0]?.finish_reason;
      console.log('PPTX API response status:', res.status, 'finish_reason:', finishReason);

      // Check for API-level errors
      if (data.error) throw new Error(`API error: ${data.error.message}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);

      const raw = groqAssistantText(data)?.trim() || '';
      console.log('PPTX raw response length:', raw.length, 'first 200:', raw.substring(0, 200));

      if (!raw) throw new Error(`Empty response from API (finish_reason: ${finishReason})`);

      const cleaned = raw.replace(/```json|```/g, '').trim();

      // Resilient parse — handles multiple response shapes
      let slideData;
      try {
        const parsed = JSON.parse(cleaned);
        // Handle both { title, slides: [...] } and direct array [...]
        if (Array.isArray(parsed)) {
          slideData = { title: offer.title, subtitle: '', slides: parsed };
        } else if (Array.isArray(parsed.slides)) {
          slideData = parsed;
        } else {
          // Model may have returned slides under a different key
          const possibleSlidesKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]) && parsed[k].length > 0 && parsed[k][0]?.type);
          if (possibleSlidesKey) {
            slideData = { title: parsed.title || offer.title, subtitle: parsed.subtitle || '', slides: parsed[possibleSlidesKey] };
          } else {
            console.error('Unexpected JSON shape:', JSON.stringify(parsed).substring(0, 300));
            throw new Error('Unexpected response shape — no slides array found');
          }
        }
      } catch (parseErr) {
        console.warn('Initial parse failed:', parseErr.message, '— attempting repair');
        // Repair truncated JSON
        const lastGoodSlide = cleaned.lastIndexOf('},');
        const lastGoodFinal = cleaned.lastIndexOf('}]');
        const cutPoint = Math.max(lastGoodSlide, lastGoodFinal);
        if (cutPoint > 100) {
          const repaired = cleaned.substring(0, cutPoint + 1) + ']}';
          try {
            const parsed = JSON.parse(repaired);
            slideData = { title: offer.title, subtitle: '', slides: Array.isArray(parsed.slides) ? parsed.slides : (Array.isArray(parsed) ? parsed : []) };
          } catch (repairErr) {
            console.error('Repair also failed. Cleaned text:', cleaned.substring(0, 500));
            throw new Error(`Could not parse slide JSON: ${parseErr.message}`);
          }
        } else {
          console.error('Nothing to repair. Raw:', raw.substring(0, 500));
          throw new Error(`Response was not valid JSON: ${parseErr.message}`);
        }
      }

      // Step 2: load PptxGenJS from CDN if not already loaded
      const getPptxGen = () => window.PptxGenJS || window.pptxgen || window.PptxGenJs;
      
      if (!getPptxGen()) {
        await new Promise((resolve, reject) => {
          // Try unpkg first (most reliable), then cdnjs as fallback
          const urls = [
            'https://unpkg.com/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
            'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
          ];
          let tried = 0;
          const tryNext = () => {
            if (tried >= urls.length) { reject(new Error('Could not load PptxGenJS from any CDN')); return; }
            const script = document.createElement('script');
            script.src = urls[tried++];
            script.onload = () => {
              if (getPptxGen()) resolve();
              else tryNext(); // loaded but global not found, try next
            };
            script.onerror = tryNext;
            document.head.appendChild(script);
          };
          tryNext();
        });
      }

      const PptxGenJS = getPptxGen();
      if (!PptxGenJS) throw new Error('PptxGenJS library not available — check network connection');

      // Step 3: build the PPTX in-browser
      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_16x9';
      pptx.title = slideData.title;
      pptx.author = 'Commercial Excellence App';

      // Colour scheme — Midnight Executive
      const BG_DARK = '1E2761';
      const BG_MID  = '0D1B4B';
      const BG_LIGHT = 'FFFFFF';
      const ACCENT   = '60A5FA';
      const ACCENT2  = '34D399';
      const TEXT_LIGHT = 'CADCFC';
      const TEXT_WHITE = 'FFFFFF';
      const TEXT_DARK  = '1E2761';
      const TEXT_MUTED = '94A3B8';

      // Normalise — ensure slides is always an array
      const slides = Array.isArray(slideData.slides) ? slideData.slides : [];
      if (!slides.length) throw new Error('No slides returned — please try again');

      slides.forEach((slide, idx) => {
        if (!slide || !slide.type) return; // skip malformed slides

        // Normalise all optional arrays to safe defaults
        slide.bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
        slide.dataPoints = Array.isArray(slide.dataPoints) ? slide.dataPoints : [];
        if (slide.chartData) {
          slide.chartData.series = Array.isArray(slide.chartData?.series) ? slide.chartData.series : [];
          slide.chartData.labels = Array.isArray(slide.chartData?.labels) ? slide.chartData.labels : [];
        }
        if (slide.tableData) {
          slide.tableData.headers = Array.isArray(slide.tableData?.headers) ? slide.tableData.headers : [];
          slide.tableData.rows = Array.isArray(slide.tableData?.rows) ? slide.tableData.rows : [];
        }

        const s = pptx.addSlide();

        if (slide.type === 'title') {
          // ── TITLE SLIDE ──
          s.background = { color: BG_DARK };
          // Accent bar left
          s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 0.18, h: 5.625, fill: { color: ACCENT }, line: { color: ACCENT } });
          // Large title
          s.addText(slide.title || slideData.title, {
            x: 0.5, y: 1.4, w: 9, h: 1.6,
            fontSize: 40, bold: true, color: TEXT_WHITE,
            fontFace: 'Calibri', align: 'left', valign: 'middle'
          });
          // Subtitle
          if (slide.subtitle || slideData.subtitle) {
            s.addText(slide.subtitle || slideData.subtitle, {
              x: 0.5, y: 3.1, w: 8, h: 0.6,
              fontSize: 18, color: TEXT_LIGHT, fontFace: 'Calibri', align: 'left'
            });
          }
          // Date bottom right
          const today = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
          s.addText(today, {
            x: 6, y: 5.1, w: 3.7, h: 0.4,
            fontSize: 11, color: TEXT_MUTED, align: 'right', fontFace: 'Calibri'
          });

        } else if (slide.type === 'section') {
          // ── SECTION DIVIDER ──
          s.background = { color: BG_MID };
          s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: ACCENT2 }, line: { color: ACCENT2 } });
          s.addText(slide.title, {
            x: 0.5, y: 1.8, w: 9, h: 1.2,
            fontSize: 34, bold: true, color: TEXT_WHITE, fontFace: 'Calibri', align: 'left'
          });
          if (slide.body) {
            s.addText(slide.body, {
              x: 0.5, y: 3.2, w: 8, h: 0.8,
              fontSize: 16, color: TEXT_LIGHT, fontFace: 'Calibri', align: 'left'
            });
          }

        } else if (slide.type === 'data' && slide.dataPoints?.length) {
          // ── DATA / METRICS SLIDE ──
          s.background = { color: BG_LIGHT };
          s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.9, fill: { color: BG_DARK }, line: { color: BG_DARK } });
          s.addText(slide.title, {
            x: 0.4, y: 0, w: 9.2, h: 0.9,
            fontSize: 22, bold: true, color: TEXT_WHITE, valign: 'middle', fontFace: 'Calibri'
          });

          const pts = slide.dataPoints.slice(0, 4);
          if (!pts.length) {
            // Fall through to content rendering if no data points
            s.addText('No data points provided', { x: 0.5, y: 1.5, w: 9, h: 1, fontSize: 14, color: TEXT_MUTED });
          } else {
          const colW = 9.0 / pts.length;
          pts.forEach((dp, i) => {
            const x = 0.5 + i * colW;
            // Card bg
            s.addShape(pptx.shapes.RECTANGLE, {
              x, y: 1.1, w: colW - 0.2, h: 3.4,
              fill: { color: 'F0F4FF' }, line: { color: 'CADCFC', pt: 1 },
              shadow: { type: 'outer', color: '000000', blur: 6, offset: 2, angle: 135, opacity: 0.08 }
            });
            // Value
            s.addText(dp.value, {
              x, y: 1.5, w: colW - 0.2, h: 1.2,
              fontSize: 36, bold: true, color: BG_DARK, align: 'center', fontFace: 'Calibri'
            });
            // Label
            s.addText(dp.label, {
              x, y: 2.7, w: colW - 0.2, h: 0.5,
              fontSize: 13, bold: true, color: TEXT_DARK, align: 'center', fontFace: 'Calibri'
            });
            // Context
            if (dp.context) {
              s.addText(dp.context, {
                x, y: 3.2, w: colW - 0.2, h: 0.4,
                fontSize: 11, color: TEXT_MUTED, align: 'center', fontFace: 'Calibri'
              });
            }
          }); // end pts.forEach
          } // end if pts.length

          if (slide.notes) s.addNotes(slide.notes);

        } else if (slide.type === 'chart' && slide.chartData && slide.chartData.series.length > 0 && slide.chartData.labels.length > 0) {
          // ── CHART SLIDE ──
          s.background = { color: BG_LIGHT };
          s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.88, fill: { color: BG_DARK }, line: { color: BG_DARK } });
          s.addText(slide.title || 'Chart', { x: 0.4, y: 0, w: 9.2, h: 0.88, fontSize: 22, bold: true, color: TEXT_WHITE, valign: 'middle', fontFace: 'Calibri' });
          s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0.88, w: 10, h: 0.05, fill: { color: ACCENT }, line: { color: ACCENT } });

          const cd = slide.chartData;
          const chartType = cd.chartType === 'line' ? pptx.charts.LINE : pptx.charts.BAR;
          const chartData = cd.series.map(ser => ({
            name: ser.name || 'Series',
            labels: cd.labels,
            values: Array.isArray(ser.values) ? ser.values : [],
          }));

          try {
            s.addChart(chartType, chartData, {
              x: 0.5, y: 1.0, w: 9, h: 4.2,
              showTitle: !!cd.title,
              title: cd.title || '',
              titleFontSize: 13,
              dataLabelFontSize: 10,
              showLegend: cd.series.length > 1,
              legendPos: 'b',
              chartColors: [ACCENT.replace('#',''), ACCENT2.replace('#',''), 'A78BFA'],
              valAxisLabelFontSize: 10,
              catAxisLabelFontSize: 10,
              valAxisLabelColor: '475569',
              catAxisLabelColor: '475569',
              lineDataSymbol: cd.chartType === 'line' ? 'circle' : 'none',
              lineDataSymbolSize: 5,
              lineSmooth: cd.chartType === 'line',
            });
          } catch (chartErr) {
            console.warn('Chart render failed, falling back to text:', chartErr);
            s.addText(`[Chart: ${cd.title || slide.title}]\nData: ${cd.labels.join(', ')}`, { x: 0.5, y: 1.5, w: 9, h: 2, fontSize: 14, color: TEXT_DARK });
          }

          if (slide.body) s.addText(slide.body, { x: 0.5, y: 4.9, w: 9, h: 0.5, fontSize: 11, color: TEXT_MUTED, fontFace: 'Calibri', italic: true });
          if (slide.notes) s.addNotes(slide.notes);

        } else if (slide.type === 'table' && slide.tableData && slide.tableData.headers.length > 0) {
          // ── TABLE SLIDE ──
          s.background = { color: BG_LIGHT };
          s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.88, fill: { color: BG_DARK }, line: { color: BG_DARK } });
          s.addText(slide.title || 'Table', { x: 0.4, y: 0, w: 9.2, h: 0.88, fontSize: 22, bold: true, color: TEXT_WHITE, valign: 'middle', fontFace: 'Calibri' });
          s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0.88, w: 10, h: 0.05, fill: { color: ACCENT }, line: { color: ACCENT } });

          if (slide.body) {
            s.addText(slide.body, { x: 0.5, y: 1.0, w: 9, h: 0.45, fontSize: 13, color: TEXT_DARK, fontFace: 'Calibri' });
          }

          const td = slide.tableData;
          const colCount = Math.max(1, td.headers.length);
          const colW = 9.0 / colCount;
          const tableRows = [
            td.headers.map(h => ({
              text: String(h || ''),
              options: { bold: true, color: TEXT_WHITE, fill: BG_DARK, fontSize: 12, fontFace: 'Calibri', align: 'center', valign: 'middle', border: { pt: 1, color: ACCENT } }
            })),
            ...td.rows.map((row, ri) => {
              const safeRow = Array.isArray(row) ? row : [];
              // Pad row to match header count
              while (safeRow.length < colCount) safeRow.push('');
              return safeRow.slice(0, colCount).map(cell => ({
                text: String(cell ?? ''),
                options: { color: TEXT_DARK, fill: ri % 2 === 0 ? 'F0F4FF' : 'FFFFFF', fontSize: 11, fontFace: 'Calibri', align: 'center', valign: 'middle', border: { pt: 0.5, color: 'CADCFC' } }
              }));
            })
          ];

          const startY = slide.body ? 1.55 : 1.1;
          try {
            s.addTable(tableRows, { x: 0.5, y: startY, w: 9, rowH: 0.38, colW: Array(colCount).fill(colW) });
          } catch (tableErr) {
            console.warn('Table render failed:', tableErr);
            s.addText(td.headers.join(' | '), { x: 0.5, y: 1.5, w: 9, h: 0.5, fontSize: 13, color: TEXT_DARK });
          }

          if (slide.notes) s.addNotes(slide.notes);

        } else {
          // ── CONTENT SLIDE (default) ──
          s.background = { color: BG_LIGHT };
          // Header bar
          s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.88, fill: { color: BG_DARK }, line: { color: BG_DARK } });
          s.addText(slide.title, {
            x: 0.4, y: 0, w: 9.2, h: 0.88,
            fontSize: 22, bold: true, color: TEXT_WHITE, valign: 'middle', fontFace: 'Calibri'
          });
          // Accent line under header
          s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0.88, w: 10, h: 0.05, fill: { color: ACCENT }, line: { color: ACCENT } });

          // Body paragraph
          if (slide.body) {
            s.addText(slide.body, {
              x: 0.5, y: 1.05, w: 9, h: 0.8,
              fontSize: 14, color: TEXT_DARK, fontFace: 'Calibri', align: 'left'
            });
          }

          // Bullets
          if (slide.bullets?.length) {
            const startY = slide.body ? 1.95 : 1.1;
            const bulletItems = slide.bullets.map((b, i) => ({
              text: b,
              options: { bullet: true, breakLine: i < slide.bullets.length - 1, fontSize: 14, color: TEXT_DARK, fontFace: 'Calibri', paraSpaceAfter: 6 }
            }));
            s.addText(bulletItems, { x: 0.5, y: startY, w: 9, h: 4.2 - startY });
          }

          // Summary slide — add accent strip at bottom
          if (slide.type === 'summary') {
            s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 5.2, w: 10, h: 0.425, fill: { color: BG_DARK }, line: { color: BG_DARK } });
            s.addText('Commercial Excellence App', {
              x: 0.4, y: 5.2, w: 9, h: 0.425,
              fontSize: 10, color: TEXT_MUTED, valign: 'middle', fontFace: 'Calibri'
            });
          }

          if (slide.notes) s.addNotes(slide.notes);
        }

        // Slide number (not on title)
        if (slide.type !== 'title') {
          s.addText(`${idx + 1}`, {
            x: 9.5, y: 5.3, w: 0.4, h: 0.2,
            fontSize: 9, color: TEXT_MUTED, align: 'right', fontFace: 'Calibri'
          });
        }
      });

      // Step 4: trigger browser download
      const fileName = (slideData.title || offer.title).replace(/[^a-z0-9]/gi, '_').toLowerCase();
      await pptx.writeFile({ fileName: `${fileName}.pptx` });

      // Step 5: post success message into chat
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `📊 **PowerPoint generated** — "${slideData.title}" (${slides.length} slides) has been downloaded to your device. Check your downloads folder.`
      }]);
      setPptxGenerating(false);

    } catch (e) {
      console.error('PPTX generation error:', e);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Could not generate PowerPoint: ${e.message || 'Unknown error'}. Check browser console for details.`
      }]);
      setPptxGenerating(false);
    }
  };

  const handleTerritoryStructureUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        // Validate basic structure
        if (!parsed.name || !parsed.territories) {
          alert('Invalid territory structure file. Must have "name" and "territories" fields.');
          return;
        }
        const newStructure = { ...parsed, id: `ts_${Date.now()}`, uploadedAt: new Date().toISOString().split('T')[0] };
        setTerritoryStructures(prev => [...prev, newStructure]);
        setSelectedTerritoryStructure(newStructure.id);
      } catch {
        alert('Could not parse file. Please upload a valid JSON territory structure.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleSubmit = async (e, overrideInput = null, isFileAnalysis = false) => {
    if (e) e.preventDefault();
    const messageContent = overrideInput || input.trim();
    if (!messageContent || isLoading) return;

    setInput('');
    setOrchestratorDecision(null);
    setPendingButtonAction(null);
    setPptxOffers(null);
    setMessages(prev => [...prev, { role: 'user', content: messageContent }]);
    setIsLoading(true);

    // Check if user is continuing a workflow
    if (currentWorkflow) {
      const topic = topics.find(t => t.id === currentWorkflow.topicId);
      if (topic) {
        // If orchestrator decision buttons are showing, treat typed input as a free-text action
        if (orchestratorDecision) {
          await handleOrchestratorAction('custom', orchestratorDecision, messageContent);
          return;
        }
        if (currentWorkflow.waitingForUser) {
          // Agent asked the user a question - send reply directly to agent, then evaluate
          await continueAgentWithUserReply(topic, currentWorkflow.currentStep, messageContent, currentWorkflow.context || []);
        } else {
          // Orchestrator is driving - run the next step
          await runWorkflowStep(topic, currentWorkflow.currentStep, messageContent, currentWorkflow.context || []);
        }
        return;
      }
    }

    // Check if message matches a workflow trigger (keyword-based)
    const msg = messageContent.toLowerCase();
    let matchedTopic = topics.find(topic => 
      topic.status === 'active' && 
      topic.triggerKeywords.some(kw => msg.includes(kw.toLowerCase()))
    );

    // If no keyword match, use AI to detect workflow intent
    if (!matchedTopic && topics.length > 0) {
      logActivity('ai', 'Analyzing message for workflow intent');
      try {
        const workflowList = topics
          .filter(t => t.status === 'active')
          .map(t => `id: "${t.id}"
  name: ${t.name}
  description: ${t.description}
  keywords: ${t.triggerKeywords.join(', ')}`)
          .join('\n\n');

        const detectRes = await fetch(GROQ_CHAT_URL, {
          method: 'POST',
          headers: groqHeaders(),
          body: JSON.stringify({
            model: GROQ_MODEL,
            max_tokens: 50,
            messages: [
              { role: 'system', content: `You detect if a user message matches one of these workflows. Respond with ONLY the workflow id or "none".\n\nWorkflows:\n${workflowList}` },
              { role: 'user', content: messageContent }
            ]
          })
        });

        const detectData = await detectRes.json();
        const detectedId = groqAssistantText(detectData)?.trim().toLowerCase();
        
        if (detectedId && detectedId !== 'none') {
          matchedTopic = topics.find(t => t.id === detectedId);
          if (matchedTopic) {
            logActivity('ai', `Detected workflow: ${matchedTopic.name}`);
          }
        }
      } catch (error) {
        // Fallback to normal chat if detection fails
      }
    }

    if (matchedTopic && !currentWorkflow) {
      // Offer workflow
      const workflowSummary = matchedTopic.workflow
        .map((s, i) => `**Step ${i + 1}:** ${s.name}\n   _${s.goal}_`)
        .join('\n\n');

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `I can help you with **${matchedTopic.description}**.

I have a structured **${matchedTopic.workflow.length}-step workflow**:

${workflowSummary}

Would you like me to start this workflow?

Reply **"Yes"** to use the guided workflow, or **"No"** to continue chatting normally.`
      }]);
      
      setPendingWorkflow(matchedTopic.id);
      setIsLoading(false);
      return;
    }

    // Check if confirming pending workflow
    if (pendingWorkflow && (msg.includes('yes') || msg.includes('start'))) {
      const topic = topics.find(t => t.id === pendingWorkflow);
      if (topic) {
        setPptxOffers(null); // clear any pending export offer
        setCurrentWorkflow({
          topicId: topic.id,
          currentStep: 0,
          context: [],
          waitingForUser: false
        });
        setPendingWorkflow(null);
        logActivity('workflow', `Starting: ${topic.name}`);
        await executeOrchestrator(topic, messageContent, 0);
        return;
      }
    }

    // Cancel pending workflow
    if (pendingWorkflow && (msg.includes('no') || msg.includes('cancel'))) {
      setPendingWorkflow(null);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'No problem! How else can I help you?'
      }]);
      setIsLoading(false);
      return;
    }

    try {
      const fileContext = isFileAnalysis && uploadedFile 
        ? `\n\nCONTEXT: The user has just uploaded a file named "${uploadedFile.name}" for assessment. Treat this as a real incentive scheme document that needs evaluation. Provide a thorough assessment as if you've reviewed the actual document.`
        : '';
      
      const systemPrompt = customSystemPrompt
        .replace('KNOWLEDGE BASE:\nYou have access to comprehensive best practices and the complete Pillar 2: Strategic Alignment & Principles framework.', 
          'KNOWLEDGE BASE:\nYou have access to comprehensive best practices and the complete Pillar 2: Strategic Alignment & Principles framework.\n\n' + knowledgeBase + '\n\n' + PILLAR_2_KNOWLEDGE)
        + fileContext;

      const response = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: groqHeaders(),
        body: JSON.stringify({
          model: GROQ_MODEL,
          max_tokens: 4000,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.filter(m => m.role !== 'system').map(m => ({
              role: toGroqChatRole(m.role),
              content: m.content
            })),
            { role: 'user', content: messageContent }
          ],
        }),
      });

      const data = await response.json();
      const assistantMessage = groqAssistantText(data);

      setMessages(prev => {
        const updated = [...prev, { role: 'assistant', content: assistantMessage }];
        setTimeout(() => generateSuggestions(updated), 500);
        return updated;
      });
      setUploadedFile(null);
    } catch (error) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: '⚠️ Error: Unable to process request. Please try again.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-blue-400/30 bg-slate-900/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setShowLanding(true)}
                className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-blue-400 to-cyan-400 rounded-lg flex items-center justify-center hover:opacity-80 transition-opacity"
                title="Back to Hub"
              >
                <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-slate-900" />
              </button>
              <div>
                <button onClick={() => setShowLanding(true)} className="text-left hover:opacity-80 transition-opacity">
                  <h1 className="text-lg sm:text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                    Commercial Excellence Hub
                  </h1>
                </button>
                {!showLanding && (
                  <p className="text-xs text-blue-300/70 hidden sm:flex items-center gap-1">
                    <span className="text-blue-400/50">Hub</span>
                    <span className="text-blue-400/30">›</span>
                    <span>{activeTab === 'chat' ? 'Incentive Compensation' : activeTab === 'territory' ? 'Territory Design' : activeTab === 'performance' ? 'Performance' : 'Admin'}</span>
                  </p>
                )}
                {showLanding && <p className="text-xs text-blue-300/70 hidden sm:block">Field & Commercial Excellence Platform</p>}
              </div>
            </div>

            {/* Tab Navigation — hidden on landing */}
            {!showLanding && (
              <div className="flex gap-1 sm:gap-2 bg-slate-800/50 rounded-lg p-1">
                <button onClick={() => setActiveTab('chat')} className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-md transition-all text-xs sm:text-sm ${activeTab === 'chat' ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}>
                  <MessageSquare className="w-3 h-3 sm:w-4 sm:h-4" /><span className="hidden sm:inline">Consultation</span>
                </button>
                <button onClick={() => setActiveTab('performance')} className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-md transition-all text-xs sm:text-sm ${activeTab === 'performance' ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}>
                  <BarChart3 className="w-3 h-3 sm:w-4 sm:h-4" /><span className="hidden sm:inline">Performance</span>
                </button>
                <button onClick={() => setActiveTab('admin')} className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-md transition-all text-xs sm:text-sm ${activeTab === 'admin' ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}>
                  <Settings className="w-3 h-3 sm:w-4 sm:h-4" /><span className="hidden sm:inline">Admin</span>
                </button>
                <button onClick={() => setActiveTab('territory')} className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-md transition-all text-xs sm:text-sm ${activeTab === 'territory' ? 'bg-blue-500 text-white shadow-lg' : 'text-blue-300 hover:bg-slate-700/50'}`}>
                  <Map className="w-3 h-3 sm:w-4 sm:h-4" /><span className="hidden sm:inline">Territory</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Landing Page */}
      {showLanding ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
          {/* Hero */}
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">Commercial Excellence Hub</h2>
            <p className="text-blue-300/70 text-lg max-w-2xl mx-auto">AI-powered tools for field and commercial excellence. Select a topic to get started.</p>
          </div>

          {/* Topic tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* ACTIVE — Incentive Compensation */}
            <button
              onClick={() => { setShowLanding(false); setActiveTab('chat'); }}
              className="text-left bg-slate-800/60 hover:bg-slate-700/60 border border-blue-400/30 hover:border-blue-400/60 rounded-2xl p-6 transition-all group hover:shadow-xl hover:shadow-blue-500/10 hover:-translate-y-0.5"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-bold text-white text-base mb-1">Incentive Compensation</h3>
              <p className="text-xs text-blue-300/60 leading-relaxed">Design, assess and optimise sales incentive schemes. AI-guided workflows for IC design, compliance and rep comms.</p>
              <div className="mt-4 flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-xs text-emerald-400">Active</span>
              </div>
            </button>

            {/* ACTIVE — Territory Design */}
            <button
              onClick={() => { setShowLanding(false); setActiveTab('territory'); }}
              className="text-left bg-slate-800/60 hover:bg-slate-700/60 border border-emerald-400/30 hover:border-emerald-400/60 rounded-2xl p-6 transition-all group hover:shadow-xl hover:shadow-emerald-500/10 hover:-translate-y-0.5"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Map className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-bold text-white text-base mb-1">Territory Design</h3>
              <p className="text-xs text-blue-300/60 leading-relaxed">Assess and optimise territory structures. Visualise coverage, benchmark workload and generate redesign recommendations.</p>
              <div className="mt-4 flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-xs text-emerald-400">Active</span>
              </div>
            </button>

            {/* COMING SOON tiles */}
            {[
              { icon: BarChart3, label: 'Sales Performance', desc: 'Track, analyse and benchmark rep and team performance against targets.' },
              { icon: Target, label: 'Targeting & Segmentation', desc: 'Build and refine HCP target lists using prescribing data and segmentation models.' },
              { icon: Users, label: 'Workforce Planning', desc: 'Model headcount, roles and deployment to match business strategy.' },
              { icon: Calendar, label: 'Business Planning', desc: 'Align field activity plans with brand strategy and sales objectives.' },
              { icon: Award, label: 'Customer Engagement', desc: 'Design and optimise multi-channel engagement plans for key accounts.' },
              { icon: TrendingUp, label: 'Market Access', desc: 'Tools for formulary positioning, payer strategy and access tracking.' },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="text-left bg-slate-800/30 border border-slate-700/40 rounded-2xl p-6 opacity-50 cursor-not-allowed">
                <div className="w-12 h-12 bg-slate-700/50 rounded-xl flex items-center justify-center mb-4">
                  <Icon className="w-6 h-6 text-slate-500" />
                </div>
                <h3 className="font-bold text-slate-400 text-base mb-1">{label}</h3>
                <p className="text-xs text-slate-500/70 leading-relaxed">{desc}</p>
                <div className="mt-4 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                  <span className="text-xs text-slate-500">Coming soon</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      ) : (
      /* Main Content — existing tabs */
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 h-[calc(100vh-80px)] sm:h-[calc(100vh-100px)] overflow-hidden">
        {activeTab === 'chat' ? (
          // CHAT INTERFACE
          <div className="flex flex-col h-full">
            {/* Quick Actions — compact horizontal buttons */}
            <div className="flex flex-wrap gap-2 mb-3 flex-shrink-0">
              <button
                onClick={() => setInput('I need to design an incentive scheme for a team of 10 AEs selling enterprise SaaS with 6-month sales cycles. What do you recommend?')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/60 hover:bg-blue-500/20 border border-blue-400/25 hover:border-blue-400/50 rounded-lg text-xs text-blue-300 hover:text-blue-200 transition-all"
              >
                <Target className="w-3.5 h-3.5" /> Design New Scheme
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/60 hover:bg-cyan-500/20 border border-cyan-400/25 hover:border-cyan-400/50 rounded-lg text-xs text-cyan-300 hover:text-cyan-200 transition-all"
              >
                <Upload className="w-3.5 h-3.5" /> Assess Proposal
              </button>
              <button
                onClick={() => setInput('What are the key principles for designing effective sales incentive schemes?')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/60 hover:bg-purple-500/20 border border-purple-400/25 hover:border-purple-400/50 rounded-lg text-xs text-purple-300 hover:text-purple-200 transition-all"
              >
                <Award className="w-3.5 h-3.5" /> Best Practices
              </button>
            </div>

            {/* Activity Log */}
            {activityLog.length > 0 && (
              <div className="bg-slate-800/50 border border-purple-400/30 rounded-xl mb-3 overflow-hidden flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowActivityLog(!showActivityLog)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                    <span className="font-semibold text-purple-400">System Activity</span>
                  </div>
                </button>
                {showActivityLog && (
                  <div className="px-4 pb-3 space-y-2">
                    {activityLog.slice(-5).reverse().map((log, i) => (
                      <div key={i} className="text-xs bg-slate-900/50 rounded p-2">
                        <div className="text-purple-300">{log.timestamp} - {log.action}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Workflow Status Banner */}
            {currentWorkflow && (
              <div className="bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border border-blue-400/40 rounded-xl p-3 sm:p-4 mb-3 sm:mb-4 flex-shrink-0">
                <div className="flex items-center justify-between mb-2 sm:mb-3">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-500 rounded-full flex items-center justify-center animate-pulse">
                      <Target className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm font-semibold text-blue-300">
                        🔵 Workflow Active
                      </div>
                      <div className="text-sm sm:text-lg font-bold text-white">
                        {topics.find(t => t.id === currentWorkflow.topicId)?.name || 'Unknown'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelWorkflow}
                    className="px-2 sm:px-4 py-1.5 sm:py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-400/50 text-red-300 rounded-lg transition-all text-xs sm:text-sm font-semibold cursor-pointer hover:scale-105"
                  >
                    <span className="hidden sm:inline">✕ Cancel Workflow</span>
                    <span className="sm:hidden">✕</span>
                  </button>
                </div>
                
                {/* Progress Bar */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-blue-300 font-medium">
                      Step {currentWorkflow.currentStep + 1} of {topics.find(t => t.id === currentWorkflow.topicId)?.workflow.length || 0}
                    </span>
                    <span className="text-cyan-300 font-bold">
                      {Math.round(((currentWorkflow.currentStep + 1) / (topics.find(t => t.id === currentWorkflow.topicId)?.workflow.length || 1)) * 100)}% Complete
                    </span>
                  </div>
                  
                  <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-cyan-500 h-full transition-all duration-500"
                      style={{ 
                        width: `${((currentWorkflow.currentStep + 1) / (topics.find(t => t.id === currentWorkflow.topicId)?.workflow.length || 1)) * 100}%` 
                      }}
                    ></div>
                  </div>
                </div>

                {/* All Steps Display */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                  {topics.find(t => t.id === currentWorkflow.topicId)?.workflow.map((step, idx) => (
                    <div 
                      key={idx}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg flex-shrink-0 transition-all ${
                        idx < currentWorkflow.currentStep 
                          ? 'bg-green-500/20 border border-green-400/40' 
                          : idx === currentWorkflow.currentStep
                          ? 'bg-cyan-500/30 border border-cyan-400/60 ring-2 ring-cyan-400/30'
                          : 'bg-slate-700/30 border border-slate-600/40'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx < currentWorkflow.currentStep
                          ? 'bg-green-500 text-white'
                          : idx === currentWorkflow.currentStep
                          ? 'bg-cyan-500 text-white'
                          : 'bg-slate-600 text-slate-400'
                      }`}>
                        {idx < currentWorkflow.currentStep ? '✓' : step.step}
                      </div>
                      <div className="text-xs">
                        <div className={`font-semibold ${
                          idx < currentWorkflow.currentStep
                            ? 'text-green-300'
                            : idx === currentWorkflow.currentStep
                            ? 'text-cyan-300'
                            : 'text-slate-400'
                        }`}>
                          {step.name}
                        </div>
                        {idx === currentWorkflow.currentStep && (
                          <div className="text-cyan-400/70 text-xs">← Active</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Messages Area - Scrollable */}
            <div className="flex-1 bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6 overflow-y-auto space-y-4 custom-scrollbar mb-4 min-h-0">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    message.role === 'user' 
                      ? 'bg-gradient-to-br from-cyan-400 to-blue-400' 
                      : message.role === 'system'
                      ? 'bg-gradient-to-br from-yellow-400 to-orange-400'
                      : message.role === 'orchestrator'
                      ? 'bg-gradient-to-br from-purple-500 to-pink-500'
                      : 'bg-gradient-to-br from-blue-400 to-purple-400'
                  }`}>
                    {message.role === 'user' ? (
                      <Users className="w-5 h-5 text-slate-900" />
                    ) : message.role === 'system' ? (
                      <FileText className="w-5 h-5 text-slate-900" />
                    ) : message.role === 'orchestrator' ? (
                      <Target className="w-5 h-5 text-slate-900" />
                    ) : (
                      <TrendingUp className="w-5 h-5 text-slate-900" />
                    )}
                  </div>
                  
                  <div className={`flex-1 ${message.role === 'user' ? 'text-right' : ''}`}>
                    <div className={`inline-block max-w-[85%] px-4 py-3 rounded-2xl ${
                      message.role === 'user'
                        ? 'bg-gradient-to-br from-cyan-500 to-blue-500 text-white'
                        : message.role === 'system'
                        ? 'bg-yellow-500/20 border border-yellow-400/30 text-yellow-200'
                        : message.role === 'orchestrator'
                        ? 'bg-purple-500/20 border border-purple-400/40 text-purple-200'
                        : 'bg-slate-700/50 border border-blue-400/20 text-blue-100'
                    }`}>
                      <div className="text-sm leading-relaxed">
                        {message.role === 'user'
                          ? <span className="whitespace-pre-wrap">{message.content}</span>
                          : formatMarkdown(message.content)
                        }
                      </div>
                      
                      {/* Show buttons if this is the last message and there's a pending workflow */}
                      {index === messages.length - 1 && pendingWorkflow && message.content.includes('Would you like me to start this workflow') && (
                        <div className="flex gap-2 mt-4">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setInput('');
                              handleSubmit(e, 'Yes');
                            }}
                            className="flex-1 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-semibold rounded-lg transition-all"
                          >
                            ✅ Yes, Start Workflow
                          </button>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setInput('');
                              handleSubmit(e, 'No');
                            }}
                            className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-all"
                          >
                            💬 No, Just Chat
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-slate-900" />
                  </div>
                  <div className="flex-1">
                    <div className="inline-block px-4 py-3 rounded-2xl bg-slate-700/50 border border-blue-400/20">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0s'}}></span>
                        <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></span>
                        <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Form - Fixed at Bottom */}
            <div className="flex-shrink-0">
              {/* Orchestrator decision buttons — dynamically generated */}
              {orchestratorDecision && !isLoading && (
                <div className="mb-3 p-3 bg-slate-800/60 border border-blue-400/30 rounded-xl">
                  {pendingButtonAction ? (
                    /* Inline input for buttons that need more detail */
                    <div>
                      <div className="text-xs text-blue-300/70 mb-2">{pendingButtonAction.btn.inputPrompt}</div>
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          type="text"
                          placeholder="Type your response..."
                          className="flex-1 bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.target.value.trim()) {
                              const val = e.target.value.trim();
                              setPendingButtonAction(null);
                              setOrchestratorDecision(null);
                              handleOrchestratorAction(pendingButtonAction.btn.action, pendingButtonAction.decision, val);
                            }
                            if (e.key === 'Escape') setPendingButtonAction(null);
                          }}
                        />
                        <button
                          onClick={() => setPendingButtonAction(null)}
                          className="px-3 py-2 bg-slate-700/50 hover:bg-slate-600/50 border border-slate-500/30 rounded-lg text-xs text-slate-400 hover:text-slate-300 transition-all"
                        >Cancel</button>
                      </div>
                    </div>
                  ) : (
                    /* Button choices */
                    <div>
                      <div className="text-xs text-blue-300/70 mb-2">Choose how to proceed:</div>
                      <div className="flex flex-wrap gap-2">
                        {(orchestratorDecision.buttons || []).map((btn, idx) => {
                          const isPrimary = btn.action === 'proceed';
                          const isDanger = btn.action === 'override' || btn.action === 'redesign';
                          const cls = isPrimary
                            ? "px-4 py-2 bg-green-500/20 hover:bg-green-500/30 border border-green-400/40 rounded-lg text-sm text-green-300 hover:text-green-200 transition-all"
                            : isDanger
                            ? "px-4 py-2 bg-red-500/15 hover:bg-red-500/25 border border-red-400/30 rounded-lg text-sm text-red-300 hover:text-red-200 transition-all"
                            : "px-4 py-2 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded-lg text-sm text-blue-200 hover:text-blue-100 transition-all";
                          return (
                            <button key={idx} className={cls} onClick={() => {
                              if (btn.requiresInput) {
                                setPendingButtonAction({ btn, decision: orchestratorDecision });
                              } else {
                                setOrchestratorDecision(null);
                                handleOrchestratorAction(btn.action, orchestratorDecision);
                              }
                            }}>
                              {btn.label}
                            </button>
                          );
                        })}
                        <div className="w-full text-xs text-blue-300/40 mt-1">or type your own response below</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* PPTX Export Panel */}
              {pptxGenerating && (
                <div className="mb-3 px-3 py-2 bg-violet-900/30 border border-violet-400/30 rounded-xl flex items-center gap-3 text-sm text-violet-300">
                  <div className="w-4 h-4 border-2 border-violet-400/40 border-t-violet-400 rounded-full animate-spin flex-shrink-0" />
                  Generating PowerPoint — building slide content and downloading…
                </div>
              )}
              {pptxOffers && !currentWorkflow && !pptxGenerating && (
                <div className="mb-3 bg-slate-800/60 border border-violet-400/25 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-violet-400/15 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-violet-300/70 font-semibold">
                      <span>📊</span> Export as PowerPoint
                    </div>
                    <button onClick={() => setPptxOffers(null)} className="text-slate-500 hover:text-slate-300 transition-all">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-violet-400/15">
                    {/* Summary deck */}
                    {pptxOffers.summary && (
                      <div className="p-3 flex flex-col gap-2">
                        <div className="text-xs font-semibold text-violet-200">📋 Session Summary</div>
                        <div className="text-xs text-slate-400 flex-1">{pptxOffers.summary.title}</div>
                        <div className="text-xs text-slate-500">Recap of conversation, decisions and outputs</div>
                        <button
                          onClick={() => handleGeneratePptx(pptxOffers.summary, 'summary')}
                          className="mt-1 px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/35 border border-violet-400/30 rounded-lg text-xs text-violet-200 font-semibold transition-all"
                        >✨ Generate</button>
                      </div>
                    )}
                    {/* Produced document deck */}
                    {pptxOffers.produced && (
                      <div className="p-3 flex flex-col gap-2">
                        <div className="text-xs font-semibold text-emerald-300">📄 Produced Document</div>
                        <div className="text-xs text-slate-400 flex-1">{pptxOffers.produced.title}</div>
                        <div className="text-xs text-slate-500">
                          {pptxOffers.produced.hasRealData ? 'Using your specific details' : 'Realistic fictional example'}
                        </div>
                        <button
                          onClick={() => handleGeneratePptx(pptxOffers.produced, 'produced')}
                          className="mt-1 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/30 rounded-lg text-xs text-emerald-200 font-semibold transition-all"
                        >✨ Generate</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Manual trigger — always available when there are messages */}
              {!currentWorkflow && !pptxOffers && !pptxGenerating && messages.filter(m => m.role === 'assistant' || m.role === 'orchestrator').length > 0 && (
                <div className="mb-3 flex justify-end">
                  <button
                    onClick={() => setPptxOffers({
                      summary: { title: 'Session Summary Deck', description: 'Structured recap of this conversation' },
                      produced: { title: 'Working Document', description: 'An actual artefact ready to distribute', deckType: 'general', hasRealData: false }
                    })}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-400/20 hover:border-violet-400/40 rounded-lg text-xs text-violet-300/60 hover:text-violet-300 transition-all"
                  >
                    📊 Export as PowerPoint
                  </button>
                </div>
              )}

              {/* Contextual Prompt Suggestions — hidden during active workflow */}
              {suggestionsEnabled && suggestedPrompts.length > 0 && !pendingWorkflow && !currentWorkflow && !isLoading && (
                <div className="mb-3">
                  <div className="text-xs text-blue-300/70 mb-2 flex items-center gap-2">
                    <span>💡 Suggested next steps:</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {suggestedPrompts.map((prompt, idx) => (
                      <button
                        key={idx}
                        onClick={(e) => {
                          e.preventDefault();
                          setSuggestedPrompts([]);
                          handleSubmit(e, prompt);
                        }}
                        className="px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 hover:border-blue-400/50 rounded-lg text-xs text-blue-200 hover:text-blue-100 transition-all hover:scale-105 active:scale-95"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <form onSubmit={handleSubmit} className="bg-slate-800/50 backdrop-blur-sm border border-blue-400/20 rounded-xl p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <div className="flex-1">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit(e);
                        }
                      }}
                      placeholder="Describe your incentive scenario or ask a question..."
                      className="w-full bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-3 sm:px-4 py-2 sm:py-3 text-sm outline-none focus:border-blue-400 transition-colors resize-none"
                      rows={2}
                      disabled={isLoading}
                    />
                  </div>
                  
                  <div className="flex gap-2 sm:gap-3 sm:items-end">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 sm:flex-none px-4 py-3 bg-slate-700 hover:bg-slate-600 text-cyan-400 rounded-lg transition-all border border-cyan-400/30 hover:border-cyan-400/50"
                      disabled={isLoading}
                    >
                      <Upload className="w-5 h-5 mx-auto" />
                    </button>
                    
                    <button
                      type="submit"
                      onClick={(e) => { if (input.trim()) handleSubmit(e); }}
                      disabled={isLoading || !input.trim()}
                      className="flex-1 sm:flex-none px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                    >
                      <Send className="w-5 h-5" />
                      <span className="hidden sm:inline">Send</span>
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-xs text-blue-300/50 text-center hidden sm:block">
                  Press Enter to send • Shift+Enter for new line • Upload to assess proposals
                </div>
              </form>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.ppt,.pptx"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        ) : activeTab === 'performance' ? (
          // PERFORMANCE DASHBOARD
          <div className="space-y-6 overflow-y-auto h-full custom-scrollbar pr-2">
            {/* Rep Header */}
            <div className="bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl p-6 text-white shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold mb-1">{MOCK_PERFORMANCE.rep.name}</h2>
                  <p className="text-blue-100 text-sm">{MOCK_PERFORMANCE.rep.role}</p>
                  <p className="text-blue-200 text-xs mt-1">Territory: {MOCK_PERFORMANCE.rep.territory}</p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold">
                    {MOCK_PERFORMANCE.q1Performance.attainmentPercent}%
                  </div>
                  <div className="text-sm text-blue-100">Quota Attainment</div>
                </div>
              </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-slate-800/50 backdrop-blur-sm border border-blue-400/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-5 h-5 text-green-400" />
                  <span className="text-xs text-blue-300/70">Revenue YTD</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  £{(MOCK_PERFORMANCE.q1Performance.actualRevenue / 1000).toFixed(0)}K
                </div>
                <div className="text-xs text-blue-300/60 mt-1">
                  of £{(MOCK_PERFORMANCE.rep.individualQuota / 1000).toFixed(0)}K target
                </div>
              </div>

              <div className="bg-slate-800/50 backdrop-blur-sm border border-cyan-400/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-5 h-5 text-cyan-400" />
                  <span className="text-xs text-blue-300/70">Deals Closed</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {MOCK_PERFORMANCE.q1Performance.deals.closed}
                </div>
                <div className="text-xs text-blue-300/60 mt-1">
                  of {MOCK_PERFORMANCE.q1Performance.deals.target} target
                </div>
              </div>

              <div className="bg-slate-800/50 backdrop-blur-sm border border-purple-400/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-purple-400" />
                  <span className="text-xs text-blue-300/70">Pipeline</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  £{(MOCK_PERFORMANCE.q1Performance.pipeline / 1000).toFixed(0)}K
                </div>
                <div className="text-xs text-green-400 mt-1">
                  1.5x coverage
                </div>
              </div>

              <div className="bg-slate-800/50 backdrop-blur-sm border border-green-400/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="w-5 h-5 text-green-400" />
                  <span className="text-xs text-blue-300/70">Est. Earnings</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  £{(MOCK_PERFORMANCE.earnings.totalEarnings / 1000).toFixed(1)}K
                </div>
                <div className="text-xs text-blue-300/60 mt-1">
                  Q1 Total
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Monthly Performance Chart */}
              <div className="bg-slate-800/50 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-400" />
                  Monthly Performance - Q1
                </h3>
                <div className="space-y-6">
                  {MOCK_PERFORMANCE.monthlyData.map((data, idx) => (
                    <div key={idx}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-blue-300">{data.month}</span>
                        <span className="text-xs text-blue-300/60">{data.deals} deals</span>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-blue-400">Actual: £{(data.revenue / 1000).toFixed(1)}K</span>
                            <span className="text-blue-400">{((data.revenue / data.target) * 100).toFixed(0)}%</span>
                          </div>
                          <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
                            <div 
                              className="bg-gradient-to-r from-blue-500 to-cyan-500 h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.min((data.revenue / data.target) * 100, 100)}%` }}
                            ></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-400">Target: £{(data.target / 1000).toFixed(1)}K</span>
                          </div>
                          <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                            <div 
                              className="bg-slate-500 h-full rounded-full"
                              style={{ width: '100%' }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-blue-400/20">
                  <div className="flex justify-between text-sm">
                    <span className="text-blue-300">Q1 Total</span>
                    <span className="font-bold text-white">£{(MOCK_PERFORMANCE.q1Performance.actualRevenue / 1000).toFixed(1)}K / £{(MOCK_PERFORMANCE.rep.individualQuota / 1000).toFixed(0)}K</span>
                  </div>
                </div>
              </div>

              {/* Earnings Breakdown */}
              <div className="bg-slate-800/50 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-400" />
                  Q1 Earnings Breakdown
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                    <span className="text-sm text-blue-300">Base Salary</span>
                    <span className="text-lg font-bold text-white">£{(MOCK_PERFORMANCE.earnings.baseSalary / 1000).toFixed(1)}K</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                    <span className="text-sm text-blue-300">Commission (8%)</span>
                    <span className="text-lg font-bold text-green-400">£{(MOCK_PERFORMANCE.earnings.commission / 1000).toFixed(1)}K</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                    <span className="text-sm text-blue-300">Accelerator Bonus</span>
                    <span className="text-lg font-bold text-slate-500">£0K</span>
                  </div>
                  <div className="border-t border-blue-400/20 pt-3 mt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-blue-200">Total Q1 Earnings</span>
                      <span className="text-2xl font-bold text-cyan-400">£{(MOCK_PERFORMANCE.earnings.totalEarnings / 1000).toFixed(1)}K</span>
                    </div>
                  </div>
                  <div className="bg-blue-500/20 border border-blue-400/30 rounded-lg p-3 mt-4">
                    <div className="text-xs text-blue-300 mb-1">💡 Accelerator Opportunity</div>
                    <div className="text-xs text-blue-200">
                      Hit 100% quota to unlock 12% commission rate. Potential additional earnings: £3.1K
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Incentive Scheme Details */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Award className="w-5 h-5 text-purple-400" />
                Your Incentive Scheme
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-700/30 rounded-lg p-4">
                  <div className="text-xs text-blue-300/70 mb-1">Scheme Type</div>
                  <div className="text-sm font-semibold text-white">{MOCK_PERFORMANCE.incentiveScheme.type}</div>
                </div>
                <div className="bg-slate-700/30 rounded-lg p-4">
                  <div className="text-xs text-blue-300/70 mb-1">Base Rate</div>
                  <div className="text-sm font-semibold text-white">{MOCK_PERFORMANCE.incentiveScheme.baseCommission}</div>
                </div>
                <div className="bg-slate-700/30 rounded-lg p-4">
                  <div className="text-xs text-blue-300/70 mb-1">Tier 1 Accelerator</div>
                  <div className="text-sm font-semibold text-cyan-400">{MOCK_PERFORMANCE.incentiveScheme.tier1}</div>
                </div>
                <div className="bg-slate-700/30 rounded-lg p-4">
                  <div className="text-xs text-blue-300/70 mb-1">Tier 2 Accelerator</div>
                  <div className="text-sm font-semibold text-green-400">{MOCK_PERFORMANCE.incentiveScheme.tier2}</div>
                </div>
              </div>
            </div>

            {/* Performance Chat Interface */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-cyan-400" />
                Ask About Your Performance
              </h3>
              
              <div className="bg-slate-900/50 rounded-lg p-4 mb-4 max-h-60 overflow-y-auto space-y-3 custom-scrollbar">
                {messages.filter(m => m.performanceContext).length === 0 ? (
                  <div className="text-sm text-blue-300/50 text-center py-8">
                    Ask questions about your performance, earnings projections, or incentive scheme...
                  </div>
                ) : (
                  messages.filter(m => m.performanceContext).map((message, index) => (
                    <div key={index} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        message.role === 'user' 
                          ? 'bg-gradient-to-br from-cyan-400 to-blue-400' 
                          : 'bg-gradient-to-br from-blue-400 to-purple-400'
                      }`}>
                        {message.role === 'user' ? (
                          <Users className="w-5 h-5 text-slate-900" />
                        ) : (
                          <TrendingUp className="w-5 h-5 text-slate-900" />
                        )}
                      </div>
                      
                      <div className={`flex-1 ${message.role === 'user' ? 'text-right' : ''}`}>
                        <div className={`inline-block max-w-[85%] px-4 py-3 rounded-2xl ${
                          message.role === 'user'
                            ? 'bg-gradient-to-br from-cyan-500 to-blue-500 text-white'
                            : 'bg-slate-700/50 border border-blue-400/20 text-blue-100'
                        }`}>
                          <div className="text-sm whitespace-pre-wrap leading-relaxed">
                            {message.content}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
                
                {isLoading && messages.some(m => m.performanceContext) && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-400 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-slate-900" />
                    </div>
                    <div className="flex-1">
                      <div className="inline-block px-4 py-3 rounded-2xl bg-slate-700/50 border border-blue-400/20">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0s'}}></span>
                          <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></span>
                          <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 items-center mb-3 flex-wrap">
                <button
                  onClick={() => {
                    const performanceQuestion = `Based on my current performance (£${MOCK_PERFORMANCE.q1Performance.actualRevenue} revenue out of £${MOCK_PERFORMANCE.rep.individualQuota} target), how much more do I need to close to hit 100% of my Q1 quota?`;
                    setMessages(prev => [...prev, { role: 'user', content: performanceQuestion, performanceContext: true }]);
                    setIsLoading(true);
                    
                    setTimeout(async () => {
                      try {
                        const response = await fetch(GROQ_CHAT_URL, {
                          method: 'POST',
                          headers: groqHeaders(),
                          body: JSON.stringify({
                            model: GROQ_MODEL,
                            max_tokens: 1000,
                            messages: [{ role: 'user', content: performanceQuestion }]
                          })
                        });
                        const data = await response.json();
                        const answer = groqAssistantText(data);
                        setMessages(prev => [...prev, { role: 'assistant', content: answer, performanceContext: true }]);
                      } catch (error) {
                        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error processing question.', performanceContext: true }]);
                      }
                      setIsLoading(false);
                    }, 100);
                  }}
                  disabled={isLoading}
                  className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-blue-300 rounded-lg transition-all border border-blue-400/30 disabled:opacity-40"
                >
                  How to hit 100%?
                </button>
                <button
                  onClick={() => {
                    const performanceQuestion = `If I close £30,000 more this quarter, what would my total Q1 earnings be? Currently I've earned £${MOCK_PERFORMANCE.earnings.totalEarnings} with commission at 8% up to quota, then 12% for 100-120%, and 15% above 120%.`;
                    setMessages(prev => [...prev, { role: 'user', content: performanceQuestion, performanceContext: true }]);
                    setIsLoading(true);
                    
                    setTimeout(async () => {
                      try {
                        const response = await fetch(GROQ_CHAT_URL, {
                          method: 'POST',
                          headers: groqHeaders(),
                          body: JSON.stringify({
                            model: GROQ_MODEL,
                            max_tokens: 1000,
                            messages: [{ role: 'user', content: performanceQuestion }]
                          })
                        });
                        const data = await response.json();
                        const answer = groqAssistantText(data);
                        setMessages(prev => [...prev, { role: 'assistant', content: answer, performanceContext: true }]);
                      } catch (error) {
                        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error processing question.', performanceContext: true }]);
                      }
                      setIsLoading(false);
                    }, 100);
                  }}
                  disabled={isLoading}
                  className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-cyan-300 rounded-lg transition-all border border-cyan-400/30 disabled:opacity-40"
                >
                  Calculate £30K scenario
                </button>
                <button
                  onClick={() => {
                    const performanceQuestion = `Can you explain my incentive scheme structure? I have: ${MOCK_PERFORMANCE.incentiveScheme.type}, base commission is ${MOCK_PERFORMANCE.incentiveScheme.baseCommission}, tier 1 is ${MOCK_PERFORMANCE.incentiveScheme.tier1}, and tier 2 is ${MOCK_PERFORMANCE.incentiveScheme.tier2}.`;
                    setMessages(prev => [...prev, { role: 'user', content: performanceQuestion, performanceContext: true }]);
                    setIsLoading(true);
                    
                    setTimeout(async () => {
                      try {
                        const response = await fetch(GROQ_CHAT_URL, {
                          method: 'POST',
                          headers: groqHeaders(),
                          body: JSON.stringify({
                            model: GROQ_MODEL,
                            max_tokens: 1000,
                            messages: [{ role: 'user', content: performanceQuestion }]
                          })
                        });
                        const data = await response.json();
                        const answer = groqAssistantText(data);
                        setMessages(prev => [...prev, { role: 'assistant', content: answer, performanceContext: true }]);
                      } catch (error) {
                        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error processing question.', performanceContext: true }]);
                      }
                      setIsLoading(false);
                    }, 100);
                  }}
                  disabled={isLoading}
                  className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-purple-300 rounded-lg transition-all border border-purple-400/30 disabled:opacity-40"
                >
                  Explain my scheme
                </button>
              </div>

              <form onSubmit={(e) => {
                e.preventDefault();
                if (!input.trim() || isLoading) return;
                
                const userQuestion = input.trim();
                setMessages(prev => [...prev, { role: 'user', content: userQuestion, performanceContext: true }]);
                setInput('');
                setIsLoading(true);
                
                setTimeout(async () => {
                  try {
                    const response = await fetch(GROQ_CHAT_URL, {
                      method: 'POST',
                      headers: groqHeaders(),
                      body: JSON.stringify({
                        model: GROQ_MODEL,
                        max_tokens: 1000,
                        messages: [
                          { role: 'system', content: `You are analyzing performance for ${MOCK_PERFORMANCE.rep.name}. Data: ${JSON.stringify(MOCK_PERFORMANCE)}. Provide specific calculations and insights.` },
                          { role: 'user', content: userQuestion }
                        ]
                      })
                    });
                    const data = await response.json();
                    const answer = groqAssistantText(data);
                    setMessages(prev => [...prev, { role: 'assistant', content: answer, performanceContext: true }]);
                  } catch (error) {
                    setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error processing question.', performanceContext: true }]);
                  }
                  setIsLoading(false);
                }, 100);
              }}>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask about your performance, earnings, or scheme..."
                    className="flex-1 bg-slate-900/50 text-white placeholder-blue-300/40 border border-blue-400/30 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
                    disabled={isLoading}
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="px-6 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    Ask
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : activeTab === 'territory' ? (
          // TERRITORY DESIGN
          <div className="flex flex-col h-full overflow-hidden">

            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl p-4 text-white shadow-xl flex-shrink-0 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Map className="w-6 h-6" />
                  <div>
                    <h2 className="text-xl font-bold">Territory Design</h2>
                    <p className="text-emerald-100 text-xs">Assess, design and optimise your sales territory structure</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => territoryFileInputRef.current?.click()}
                    className="flex items-center gap-2 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold transition-all">
                    <Upload className="w-4 h-4" /> Upload Structure
                  </button>
                  <input ref={territoryFileInputRef} type="file" accept=".json" onChange={handleTerritoryStructureUpload} className="hidden" />
                </div>
              </div>
            </div>

            {/* Structure selector + view toggle */}
            {territoryStructures.length > 0 && (
              <div className="flex-shrink-0 mb-3 flex items-center gap-3 flex-wrap">
                <span className="text-xs text-blue-300/70 whitespace-nowrap">Loaded:</span>
                <div className="flex gap-2 flex-wrap flex-1">
                  {territoryStructures.map(s => (
                    <button key={s.id}
                      onClick={() => { setSelectedTerritoryStructure(s.id); setSelectedTerritory(null); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${selectedTerritoryStructure === s.id ? 'bg-emerald-500/30 border-emerald-400/60 text-emerald-300' : 'bg-slate-800/50 border-blue-400/20 text-blue-300 hover:border-blue-400/40'}`}>
                      {s.name}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setTerritoryView('map')} className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${territoryView === 'map' ? 'bg-blue-500/30 border-blue-400/60 text-blue-200' : 'bg-slate-800/50 border-slate-600 text-slate-400 hover:text-slate-300'}`}>🗺 Map</button>
                  <button onClick={() => setTerritoryView('list')} className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${territoryView === 'list' ? 'bg-blue-500/30 border-blue-400/60 text-blue-200' : 'bg-slate-800/50 border-slate-600 text-slate-400 hover:text-slate-300'}`}>☰ List</button>
                </div>
              </div>
            )}

            {/* Main content */}
            {(() => {
              const activeStructure = territoryStructures.find(s => s.id === selectedTerritoryStructure) || territoryStructures[0];
              if (!activeStructure) return (
                <div className="flex-1 flex items-center justify-center text-blue-300/50 text-sm">
                  No territory structure loaded. Upload a JSON file or use the pre-loaded structure.
                </div>
              );
              return (
                <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
                  {/* Map or List */}
                  <div className={`overflow-y-auto custom-scrollbar ${selectedTerritory ? 'w-1/2' : 'w-full'} transition-all`}>
                    {territoryView === 'map' ? (
                      <div className="bg-slate-800/40 border border-blue-400/20 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-blue-300/70 font-semibold">{activeStructure.name} — {activeStructure.territories.length} territories</span>
                          <span className="text-xs text-blue-300/40">{activeStructure.managers.length} managers · Click a territory to inspect</span>
                        </div>
                        <TerritoryMap structure={activeStructure} selectedTerritory={selectedTerritory} onSelectTerritory={setSelectedTerritory} />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {activeStructure.managers.map((mgr, mgrIdx) => (
                          <div key={mgr.id} className="bg-slate-800/40 border border-blue-400/20 rounded-xl overflow-hidden">
                            <div className="px-4 py-2 flex items-center gap-2" style={{ background: `${MANAGER_COLOURS[mgrIdx]}18` }}>
                              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: MANAGER_COLOURS[mgrIdx] }} />
                              <span className="text-sm font-semibold text-white">{mgr.name}</span>
                              <span className="text-xs text-blue-300/60">— {mgr.region}</span>
                              <span className="ml-auto text-xs text-blue-300/40">{activeStructure.territories.filter(t => t.managerId === mgr.id).length} territories</span>
                            </div>
                            <div className="divide-y divide-slate-700/40">
                              {activeStructure.territories.filter(t => t.managerId === mgr.id).map(t => (
                                <div key={t.id} onClick={() => setSelectedTerritory(selectedTerritory?.id === t.id ? null : t)}
                                  className={`px-4 py-2.5 cursor-pointer transition-all flex items-center gap-3 ${selectedTerritory?.id === t.id ? 'bg-blue-500/10' : 'hover:bg-slate-700/30'}`}>
                                  <span className="text-xs font-bold text-blue-400 w-8 flex-shrink-0">{t.id}</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm text-white truncate">{t.name}</div>
                                    <div className="text-xs text-blue-300/50 truncate">{t.rep}</div>
                                  </div>
                                  <div className="flex gap-2 text-xs flex-shrink-0">
                                    <span className="text-emerald-400 font-semibold">A:{t.hcps.A}</span>
                                    <span className="text-blue-400">B:{t.hcps.B}</span>
                                    <span className="text-slate-400">C:{t.hcps.C}</span>
                                    <span className="text-white font-bold ml-1">{t.hcps.A+t.hcps.B+t.hcps.C}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Territory detail panel */}
                  {selectedTerritory && (() => {
                    const mgr = activeStructure.managers.find(m => m.id === selectedTerritory.managerId);
                    const mgrIdx = activeStructure.managers.indexOf(mgr);
                    const total = selectedTerritory.hcps.A + selectedTerritory.hcps.B + selectedTerritory.hcps.C;
                    return (
                      <div className="w-1/2 overflow-y-auto custom-scrollbar">
                        <div className="bg-slate-800/60 border border-blue-400/30 rounded-xl p-4 space-y-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">{selectedTerritory.id}</span>
                                <span className="text-xs px-2 py-0.5 rounded" style={{ background: `${MANAGER_COLOURS[mgrIdx]}22`, color: MANAGER_COLOURS[mgrIdx] }}>{mgr?.name}</span>
                              </div>
                              <h3 className="text-lg font-bold text-white">{selectedTerritory.name}</h3>
                              <p className="text-sm text-blue-300/70">Rep: {selectedTerritory.rep}</p>
                            </div>
                            <button onClick={() => setSelectedTerritory(null)} className="text-slate-500 hover:text-slate-300 transition-all flex-shrink-0"><X className="w-4 h-4" /></button>
                          </div>

                          {/* HCP breakdown */}
                          <div>
                            <div className="text-xs text-blue-300/60 mb-2 font-semibold uppercase tracking-wide">HCP Universe</div>
                            {[['A — High value prescribers', selectedTerritory.hcps.A, '#34d399'], ['B — Medium value', selectedTerritory.hcps.B, '#60a5fa'], ['C — Low / awareness', selectedTerritory.hcps.C, '#64748b']].map(([label, count, colour]) => {
                              const pct = Math.round(count / total * 100);
                              return (
                                <div key={label} className="mb-2">
                                  <div className="flex justify-between text-xs mb-1">
                                    <span className="text-blue-200/80">{label}</span>
                                    <span className="font-bold" style={{ color: colour }}>{count} ({pct}%)</span>
                                  </div>
                                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colour }} />
                                  </div>
                                </div>
                              );
                            })}
                            <div className="mt-2 pt-2 border-t border-slate-700/50 flex justify-between text-xs">
                              <span className="text-blue-300/60">Total HCPs</span>
                              <span className="text-white font-bold">{total}</span>
                            </div>
                          </div>

                          {/* Counties */}
                          <div>
                            <div className="text-xs text-blue-300/60 mb-2 font-semibold uppercase tracking-wide">Counties / Areas</div>
                            <div className="flex flex-wrap gap-1">
                              {selectedTerritory.counties.map(c => (
                                <span key={c} className="text-xs bg-slate-700/60 text-blue-200/70 px-2 py-0.5 rounded-full">{c}</span>
                              ))}
                            </div>
                          </div>

                          {selectedTerritory.notes && (
                            <div className="bg-amber-500/10 border border-amber-400/20 rounded-lg p-3">
                              <div className="text-xs text-amber-400 font-semibold mb-1">Notes</div>
                              <p className="text-xs text-amber-200/80">{selectedTerritory.notes}</p>
                            </div>
                          )}

                          <button onClick={() => {
                            const t = selectedTerritory;
                            const mgr = activeStructure.managers.find(m => m.id === t.managerId);
                            const allTerritories = activeStructure.territories;
                            const totalHCPs = allTerritories.map(x => x.hcps.A + x.hcps.B + x.hcps.C);
                            const avgTotal = Math.round(totalHCPs.reduce((a,b) => a+b,0) / allTerritories.length);
                            const mgrTerritories = allTerritories.filter(x => x.managerId === t.managerId);
                            const avgMgrTotal = Math.round(mgrTerritories.map(x => x.hcps.A+x.hcps.B+x.hcps.C).reduce((a,b)=>a+b,0) / mgrTerritories.length);
                            const focusTotal = t.hcps.A + t.hcps.B + t.hcps.C;

                            const allTerritoriesStr = allTerritories.map(x => {
                              const xTotal = x.hcps.A+x.hcps.B+x.hcps.C;
                              const xMgr = activeStructure.managers.find(m=>m.id===x.managerId);
                              return `  ${x.id === t.id ? '>>> FOCUS: ' : ''}${x.id} ${x.name} | Rep: ${x.rep} | Manager: ${xMgr?.name} | HCPs: A=${x.hcps.A} B=${x.hcps.B} C=${x.hcps.C} Total=${xTotal}${x.id === t.id ? ' <<<' : ''}`;
                            }).join('\n');

                            const focusedContext = `TERRITORY ASSESSMENT — FOCUS TERRITORY: ${t.id} ${t.name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FOCUS TERRITORY DETAIL:
  ID: ${t.id} | Name: ${t.name}
  Rep: ${t.rep} | Manager: ${mgr?.name} (${mgr?.region})
  Counties: ${t.counties.join(', ')}
  HCPs: Segment A=${t.hcps.A}, B=${t.hcps.B}, C=${t.hcps.C}, Total=${focusTotal}
  ${t.notes ? `Notes: ${t.notes}` : ''}

BENCHMARKS FOR COMPARISON:
  National avg total HCPs per territory: ${avgTotal}
  Manager region avg total HCPs (${mgr?.region}): ${avgMgrTotal}
  Focus territory vs national avg: ${focusTotal > avgTotal ? '+' : ''}${focusTotal - avgTotal} (${Math.round((focusTotal/avgTotal-1)*100)}%)
  Focus territory vs region avg: ${focusTotal > avgMgrTotal ? '+' : ''}${focusTotal - avgMgrTotal} (${Math.round((focusTotal/avgMgrTotal-1)*100)}%)

ALL TERRITORIES (for peer comparison):
${allTerritoriesStr}

Structure: ${activeStructure.name} | Total territories: ${allTerritories.length} | Managers: ${activeStructure.managers.map(m=>`${m.name} (${m.region})`).join(', ')}`;

                            setActiveTab('chat');
                            setTimeout(() => launchWorkflowDirect('territory_assessment', `Assess territory ${t.id} — ${t.name}`, focusedContext), 100);
                          }}
                            className="w-full py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 rounded-lg text-sm text-emerald-300 font-semibold transition-all">
                            🔍 Assess this territory →
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* Action buttons row */}
            <div className="flex-shrink-0 mt-3 grid grid-cols-3 gap-3">
              <button onClick={() => { setActiveTab('chat'); setTimeout(() => launchWorkflowDirect('territory_assessment', 'I want to run a territory assessment'), 100); }}
                className="py-2.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/25 hover:border-emerald-400/45 rounded-xl text-sm text-emerald-300 font-semibold transition-all flex items-center justify-center gap-2">
                <Target className="w-4 h-4" /> Territory Assessment
              </button>
              <button onClick={() => { setActiveTab('chat'); setTimeout(() => handleSubmit(null, 'I want to design new territories'), 100); }}
                className="py-2.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/25 hover:border-blue-400/45 rounded-xl text-sm text-blue-300 font-semibold transition-all flex items-center justify-center gap-2">
                <MapPin className="w-4 h-4" /> New Territory Design
              </button>
              <button onClick={() => { setActiveTab('chat'); setTimeout(() => handleSubmit(null, 'I want to set up a new field team'), 100); }}
                className="py-2.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/25 hover:border-violet-400/45 rounded-xl text-sm text-violet-300 font-semibold transition-all flex items-center justify-center gap-2">
                <Users className="w-4 h-4" /> New Team Setup
              </button>
            </div>
          </div>
        ) : (
          // ADMIN INTERFACE
          <div className="space-y-4 sm:space-y-6 overflow-y-auto h-full custom-scrollbar pr-1 sm:pr-2">
            {/* Admin Tabs */}
            <div className="flex gap-2 border-b border-blue-400/20 pb-3 overflow-x-auto">
              {[
                { id: 'knowledge', label: 'Knowledge' },
                { id: 'workflows', label: 'Workflows' },
                { id: 'agents', label: 'Agents' },
                { id: 'system-prompt', label: 'Prompt' },
                { id: 'pptx', label: '📊 PPT Prompts' },
                { id: 'settings', label: 'Settings' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setAdminSection(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                    adminSection === tab.id
                      ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                      : 'bg-slate-700/30 text-blue-300 hover:bg-slate-700/50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            {adminSection === 'knowledge' && (
            <>
              <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <FileText className="w-6 h-6 text-blue-400" />
                  Knowledge Base Management
                </h2>
                <p className="text-sm text-blue-300/70 mb-6">
                  Upload and manage documentation about incentive rules, policies, and best practices. 
                  This knowledge will be used to provide accurate advice to users.
                </p>

                {/* Document List */}
                <div className="space-y-3 mb-6">
                  {documents.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between bg-slate-700/30 border border-blue-400/20 rounded-lg p-4 hover:border-blue-400/40 transition-all">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-blue-400" />
                        <div>
                          <div className="font-medium text-sm">{doc.name}</div>
                          <div className="text-xs text-blue-300/50">
                            {doc.size} • {doc.status}
                            {doc.type === 'yaml' && <span className="ml-2 px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded text-xs">YAML</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded border border-green-400/30 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Active
                        </span>
                        {doc.id !== 1 && doc.id !== 2 && (
                          <button
                            onClick={() => removeDocument(doc.id)}
                            className="p-2 hover:bg-red-500/20 rounded transition-colors text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Upload Button */}
                <div className="space-y-2">
                  <button
                    onClick={() => adminFileInputRef.current?.click()}
                    className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                  >
                    <Plus className="w-5 h-5" />
                    Upload Knowledge File
                  </button>
                  <p className="text-xs text-blue-300/50 text-center">
                    Supports: .yml, .yaml, .txt, .md, .pdf files
                  </p>
                </div>

                <input
                  ref={adminFileInputRef}
                  type="file"
                  accept=".yml,.yaml,.txt,.md,.pdf"
                  onChange={handleAdminFileUpload}
                  className="hidden"
                />
              </div>

              {/* Knowledge Base Preview */}
              <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6 mt-6">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Settings className="w-6 h-6 text-cyan-400" />
                  Current Knowledge Base
                </h2>
                
                <div className="mb-4 flex items-center gap-2 text-sm">
                  <div className="px-3 py-1 bg-green-500/20 text-green-400 rounded-lg border border-green-400/30">
                    2 Active Sources
                  </div>
                  <div className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg border border-blue-400/30">
                    Pillar 2 YAML Loaded
                  </div>
                </div>
                
                <div className="bg-slate-900/50 border border-blue-400/20 rounded-lg p-4 max-h-96 overflow-y-auto custom-scrollbar">
                  <div className="space-y-4">
                    <div>
                      <div className="text-xs font-semibold text-cyan-400 mb-2">📄 Default Best Practices</div>
                      <pre className="text-xs text-blue-300/80 whitespace-pre-wrap font-mono">
                        {knowledgeBase.substring(0, 500)}...
                      </pre>
                    </div>
                    
                    <div className="border-t border-blue-400/20 pt-4">
                      <div className="text-xs font-semibold text-cyan-400 mb-2">📋 Pillar 2: Strategic Alignment & Principles (YAML)</div>
                      <pre className="text-xs text-blue-300/80 whitespace-pre-wrap font-mono">
                        {PILLAR_2_KNOWLEDGE.substring(0, 800)}...
                      </pre>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm text-blue-300/60">
                  <AlertTriangle className="w-4 h-4" />
                  <span>This knowledge base powers all AI responses in the consultation and performance interfaces</span>
                </div>
              </div>

            </>
            )}

            {adminSection === 'agents' && (
              <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Users className="w-6 h-6 text-purple-400" />
                  Specialist Agents
                </h2>
                <p className="text-sm text-blue-300/70 mb-6">
                  {agents.length} specialist agents available for multi-step workflows
                </p>

                <div className="space-y-3">
                  {agents.map(agent => (
                    <div key={agent.id} className="bg-slate-700/30 border border-purple-400/20 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-semibold text-purple-300">{agent.name}</div>
                          <div className="text-xs text-blue-300/60 mt-1">{agent.role}</div>
                        </div>
                        <span className={`px-2 py-1 text-xs rounded ${
                          agent.status === 'active' 
                            ? 'bg-green-500/20 text-green-400 border border-green-400/30' 
                            : 'bg-gray-500/20 text-gray-400 border border-gray-400/30'
                        }`}>
                          {agent.status}
                        </span>
                      </div>
                      <div className="text-xs text-blue-300/50 mt-2 mb-3">
                        Uses knowledge: {agent.knowledgeFiles.map(id => 
                          documents.find(d => d.id === id)?.name || `Doc ${id}`
                        ).join(', ')}
                      </div>
                      <div className="flex gap-2 pt-3 border-t border-purple-400/20">
                        <button
                          onClick={() => setEditingAgent({...agent})}
                          className="flex-1 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-400/30 rounded-lg text-sm font-semibold transition-all"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {adminSection === 'workflows' && (
              <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Target className="w-6 h-6 text-cyan-400" />
                    Workflows
                  </h2>
                  <button
                    onClick={() => {
                      const newId = 'workflow_' + Date.now();
                      const blank = {
                        id: newId,
                        name: 'New Workflow',
                        description: 'Describe what this workflow helps users accomplish',
                        triggerKeywords: [],
                        status: 'active',
                        orchestrator: {
                          role: 'You are the Workflow Orchestrator.',
                          goal: 'Guide the user through this workflow.',
                          approach: 'WORKFLOW START: Introduce steps. BETWEEN STEPS: Validate before proceeding. WORKFLOW END: Summarize deliverables.'
                        },
                        workflow: [
                          { step: 1, name: 'Step 1', agents: [agents[0]?.id || ''], goal: 'Define the goal of this step', successCriteria: 'Define what success looks like' }
                        ]
                      };
                      setTopics(prev => [...prev, blank]);
                      setEditingTopic(blank);
                      setExpandedSteps({});
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold rounded-lg transition-all text-sm shadow-lg shadow-cyan-500/20"
                  >
                    <Plus className="w-4 h-4" />
                    New Workflow
                  </button>
                </div>
                <p className="text-sm text-blue-300/70 mb-6">
                  {topics.length} workflow{topics.length !== 1 ? 's' : ''} · AI auto-detects intent, keywords are a fallback
                </p>

                <div className="space-y-4">
                  {topics.map(topic => (
                    <div key={topic.id} className="bg-slate-700/30 border border-cyan-400/20 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 mr-3">
                          <div className="font-semibold text-cyan-300">{topic.name}</div>
                          <div className="text-xs text-blue-300/60 mt-1">{topic.description}</div>
                        </div>
                        <span className={`px-2 py-1 text-xs rounded ${
                          topic.status === 'active' 
                            ? 'bg-green-500/20 text-green-400 border border-green-400/30' 
                            : 'bg-gray-500/20 text-gray-400 border border-gray-400/30'
                        }`}>
                          {topic.status}
                        </span>
                      </div>
                      
                      <div className="space-y-2 mt-3 pl-3 border-l-2 border-cyan-400/30">
                        {topic.workflow.map((step, idx) => (
                          <div key={idx} className="text-xs">
                            <span className="text-cyan-400 font-medium">Step {step.step}:</span>
                            <span className="text-blue-300/80 ml-2">{step.name}</span>
                            <div className="text-blue-300/50 ml-6">→ {step.agents.map(id => 
                              agents.find(a => a.id === id)?.name || id
                            ).join(', ')}</div>
                          </div>
                        ))}
                      </div>
                      
                      <div className="text-xs text-blue-300/50 mt-3 flex flex-wrap gap-1">
                        <span className="font-medium">Triggers:</span>
                        {topic.triggerKeywords.slice(0, 3).map((kw, i) => (
                          <span key={i} className="px-2 py-0.5 bg-cyan-500/10 rounded">{kw}</span>
                        ))}
                        {topic.triggerKeywords.length > 3 && (
                          <span className="px-2 py-0.5">+{topic.triggerKeywords.length - 3} more</span>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2 mt-4 pt-4 border-t border-cyan-400/20">
                        <button
                          onClick={() => {
                            setTopics(prev => prev.map(t => 
                              t.id === topic.id ? { ...t, status: t.status === 'active' ? 'inactive' : 'active' } : t
                            ));
                          }}
                          className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                            topic.status === 'active'
                              ? 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border border-yellow-400/30'
                              : 'bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-400/30'
                          }`}
                        >
                          {topic.status === 'active' ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => {
                            setEditingTopic({...topic});
                            setExpandedSteps({});
                          }}
                          className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-400/30"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete "${topic.name}"? This cannot be undone.`)) {
                              setTopics(prev => prev.filter(t => t.id !== topic.id));
                            }
                          }}
                          className="px-3 py-2 rounded-lg text-sm font-semibold transition-all bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-400/30"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Topic Editor Modal */}
            {/* Agent Editor Modal */}

            {adminSection === 'system-prompt' && (
              <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <FileText className="w-6 h-6 text-blue-400" />
                  System Prompt Configuration
                </h2>
                <p className="text-sm text-blue-300/70 mb-6">
                  Edit the system prompt sent to the model for every conversation. Changes take effect immediately on the next message. The knowledge base content is automatically appended at runtime.
                </p>

                <div className="space-y-4">
                  {/* Editable textarea */}
                  <textarea
                    value={customSystemPrompt}
                    onChange={(e) => setCustomSystemPrompt(e.target.value)}
                    rows={24}
                    className="w-full bg-slate-950 border border-blue-400/30 rounded-lg px-4 py-3 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-cyan-400/60 resize-y"
                    spellCheck={false}
                  />

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(customSystemPrompt);
                        alert('System prompt copied to clipboard!');
                      }}
                      className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-400/30 rounded-lg text-sm font-semibold transition-all"
                    >
                      Copy to Clipboard
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm('Reset system prompt to default? This cannot be undone.')) {
                          setCustomSystemPrompt(DEFAULT_SYSTEM_PROMPT);
                        }
                      }}
                      className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-400/30 rounded-lg text-sm font-semibold transition-all"
                    >
                      Reset to Default
                    </button>
                    <div className="flex-1 flex items-center justify-end text-xs text-blue-300/50">
                      {customSystemPrompt === DEFAULT_SYSTEM_PROMPT
                        ? '✓ Using default prompt'
                        : '⚠ Using custom prompt'}
                    </div>
                  </div>

                  {/* Info panel */}
                  <div className="p-4 bg-blue-500/10 border border-blue-400/20 rounded-lg">
                    <div className="text-sm font-semibold text-blue-300 mb-2">📝 What gets sent to the model:</div>
                    <ul className="text-xs text-slate-400 space-y-1">
                      <li>✓ Your edited system prompt above</li>
                      <li>✓ Full knowledge base content appended automatically ({documents.filter(d => d.status === 'active').length} active document{documents.filter(d => d.status === 'active').length !== 1 ? 's' : ''})</li>
                      <li>✓ Uploaded file context (when a file is attached)</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {adminSection === 'pptx' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">PowerPoint Generation Prompts</h3>
                  <p className="text-sm text-blue-300/60">These prompts control how the app generates PowerPoint slides. Edit them to change the tone, structure, content focus, or output format.</p>
                </div>

                {/* Intent Detection */}
                <div className="bg-slate-800/40 border border-blue-400/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-white">🔍 Intent Detection</span>
                    <span className="text-xs text-blue-300/50 bg-blue-500/10 px-2 py-0.5 rounded-full">Runs after every response</span>
                  </div>
                  <p className="text-xs text-blue-300/50 mb-3">Decides when to offer a PowerPoint export and what titles to suggest. Returns JSON with summaryDeck and producedDeck.</p>
                  <textarea
                    value={pptxPrompts.intentDetection}
                    onChange={e => setPptxPrompts(prev => ({ ...prev, intentDetection: e.target.value }))}
                    rows={8}
                    className="w-full bg-slate-900/60 text-blue-100 text-xs rounded-lg p-3 border border-blue-400/20 focus:border-blue-400/50 focus:outline-none font-mono resize-y"
                  />
                </div>

                {/* Summary Prompt */}
                <div className="bg-slate-800/40 border border-violet-400/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-white">📋 Session Summary Prompt</span>
                    <span className="text-xs text-violet-300/50 bg-violet-500/10 px-2 py-0.5 rounded-full">Type 1</span>
                  </div>
                  <p className="text-xs text-blue-300/50 mb-3">Used when generating a summary deck of the conversation. The JSON schema must be preserved for the slide builder to work.</p>
                  <textarea
                    value={pptxPrompts.summary}
                    onChange={e => setPptxPrompts(prev => ({ ...prev, summary: e.target.value }))}
                    rows={10}
                    className="w-full bg-slate-900/60 text-blue-100 text-xs rounded-lg p-3 border border-violet-400/20 focus:border-violet-400/50 focus:outline-none font-mono resize-y"
                  />
                </div>

                {/* Produced Document Prompt */}
                <div className="bg-slate-800/40 border border-emerald-400/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-white">📄 Produced Document Prompt</span>
                    <span className="text-xs text-emerald-300/50 bg-emerald-500/10 px-2 py-0.5 rounded-full">Type 2</span>
                  </div>
                  <p className="text-xs text-blue-300/50 mb-3">Used when generating an actual working document — rep comms pack, manager briefing, IC explainer etc. Adjust tone, audience, and instructions here.</p>
                  <textarea
                    value={pptxPrompts.produced}
                    onChange={e => setPptxPrompts(prev => ({ ...prev, produced: e.target.value }))}
                    rows={14}
                    className="w-full bg-slate-900/60 text-blue-100 text-xs rounded-lg p-3 border border-emerald-400/20 focus:border-emerald-400/50 focus:outline-none font-mono resize-y"
                  />
                </div>

                <div className="bg-amber-500/10 border border-amber-400/20 rounded-lg p-3 text-xs text-amber-300/70">
                  ⚠️ The JSON schema in the prompts (<code className="font-mono">title, subtitle, slides, type, bullets...</code>) must be preserved — the slide builder depends on this structure. You can change all the instructions around it freely.
                </div>
              </div>
            )}

            {adminSection === 'settings' && (
              <div className="bg-slate-800/30 backdrop-blur-sm border border-blue-400/20 rounded-xl p-6">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <Settings className="w-6 h-6 text-yellow-400" />
                  Settings
                </h2>
                <p className="text-sm text-blue-300/70 mb-6">Configure application behaviour and AI features.</p>

                {/* AI Suggestions */}
                <div className="bg-slate-900/50 border border-blue-400/20 rounded-lg p-5">
                  <h3 className="text-lg font-semibold text-yellow-400 mb-1 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5" />
                    AI Suggestions
                  </h3>
                  <p className="text-xs text-blue-300/60 mb-4">Contextual follow-up prompts shown after each AI response.</p>
                  <div className="space-y-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-semibold text-white">Enable Suggestions</label>
                        <p className="text-xs text-blue-300/70 mt-1">Show AI-generated prompts after each response</p>
                      </div>
                      <button
                        onClick={() => setSuggestionsEnabled(!suggestionsEnabled)}
                        className={`relative w-14 h-7 rounded-full transition-colors ${suggestionsEnabled ? 'bg-green-500' : 'bg-slate-600'}`}
                      >
                        <div className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${suggestionsEnabled ? 'translate-x-7' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-white block mb-2">Number of Suggestions: {maxSuggestions}</label>
                      <input
                        type="range" min="1" max="5" value={maxSuggestions}
                        onChange={(e) => setMaxSuggestions(parseInt(e.target.value))}
                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-blue-300/50 mt-1">
                        {[1,2,3,4,5].map(n => <span key={n}>{n}</span>)}
                      </div>
                    </div>
                    {suggestionsEnabled && (
                      <div className="p-3 bg-slate-950 rounded border border-blue-400/20">
                        <div className="text-xs text-blue-300/70 mb-2">Preview:</div>
                        <div className="flex flex-wrap gap-2">
                          {Array.from({ length: maxSuggestions }, (_, i) => (
                            <div key={i} className="px-3 py-2 bg-blue-500/10 border border-blue-400/30 rounded-lg text-xs text-blue-200">
                              Suggested prompt {i + 1}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {editingAgent && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
                <div className="bg-slate-900 border border-blue-400/20 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto my-8">
                  <div className="sticky top-0 bg-slate-900 border-b border-blue-400/20 p-6 flex items-center justify-between z-10 rounded-t-xl">
                    <h2 className="text-xl font-bold">Edit Agent: {editingAgent.name}</h2>
                    <button onClick={() => setEditingAgent(null)} className="text-blue-300 hover:text-white transition-colors">
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                  <div className="p-6 space-y-6">
                    <div>
                      <label className="block text-sm font-semibold mb-2">Agent Name</label>
                      <input type="text" value={editingAgent.name}
                        onChange={(e) => setEditingAgent({...editingAgent, name: e.target.value})}
                        className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">Role (one-line summary)</label>
                      <input type="text" value={editingAgent.role}
                        onChange={(e) => setEditingAgent({...editingAgent, role: e.target.value})}
                        className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">System Prompt</label>
                      <textarea value={editingAgent.systemPrompt} rows={15}
                        onChange={(e) => setEditingAgent({...editingAgent, systemPrompt: e.target.value})}
                        className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white font-mono text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">Knowledge Base Access
                        <span className="text-xs text-blue-300/60 ml-2">(which docs this agent can reference)</span>
                      </label>
                      <div className="space-y-2">
                        {documents.map(doc => (
                          <label key={doc.id} className="flex items-center gap-3 px-4 py-3 bg-slate-800 border border-blue-400/30 rounded-lg cursor-pointer hover:bg-slate-700 transition-colors">
                            <input type="checkbox"
                              checked={editingAgent.knowledgeFiles?.includes(doc.id) || false}
                              onChange={(e) => {
                                const files = editingAgent.knowledgeFiles || [];
                                setEditingAgent({...editingAgent, knowledgeFiles: e.target.checked ? [...files, doc.id] : files.filter(f => f !== doc.id)});
                              }}
                              className="w-4 h-4" />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-white">{doc.name}</div>
                              <div className="text-xs text-blue-300/50">{doc.size} • {doc.type}</div>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-xs ${doc.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                              {doc.status}
                            </span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-blue-300/50 mt-2">Selected: {editingAgent.knowledgeFiles?.length || 0} documents</p>
                    </div>
                  </div>
                  <div className="border-t border-blue-400/20 p-6 flex gap-3 bg-slate-900 rounded-b-xl">
                    <button
                      onClick={() => { setAgents(agents.map(a => a.id === editingAgent.id ? editingAgent : a)); setEditingAgent(null); }}
                      className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      <Save className="w-5 h-5" /> Save Changes
                    </button>
                    <button onClick={() => setEditingAgent(null)} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {editingTopic && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
                <div className="bg-slate-900 border border-blue-400/20 rounded-xl max-w-4xl w-full my-8">
                  <div className="sticky top-0 bg-slate-900 border-b border-blue-400/20 p-6 flex items-center justify-between z-10 rounded-t-xl">
                    <h2 className="text-xl font-bold">Edit Workflow: {editingTopic.name}</h2>
                    <button
                      onClick={() => setEditingTopic(null)}
                      className="text-blue-300 hover:text-white transition-colors"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>

                  <div className="p-6 space-y-6">
                    <div>
                      <label className="block text-sm font-semibold mb-2">Workflow Name</label>
                      <input
                        type="text"
                        value={editingTopic.name}
                        onChange={(e) => setEditingTopic({...editingTopic, name: e.target.value})}
                        className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold mb-2">Description</label>
                      <textarea
                        value={editingTopic.description}
                        onChange={(e) => setEditingTopic({...editingTopic, description: e.target.value})}
                        rows={3}
                        className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold mb-2">
                        Trigger Keywords
                        <span className="text-xs text-blue-300/60 ml-2">(comma-separated phrases that activate this workflow)</span>
                      </label>
                      <input
                        type="text"
                        value={editingTopic.triggerKeywords?.join(', ') || ''}
                        onChange={(e) => setEditingTopic({
                          ...editingTopic, 
                          triggerKeywords: e.target.value.split(',').map(k => k.trim()).filter(k => k)
                        })}
                        placeholder="e.g., design scheme, create ic, new incentive"
                        className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white text-sm"
                      />
                      <p className="text-xs text-blue-300/50 mt-1">
                        Current: {editingTopic.triggerKeywords?.length || 0} keywords
                      </p>
                    </div>

                    {/* ORCHESTRATOR CONFIGURATION */}
                    <div className="border-t border-blue-400/20 pt-6">
                      <h3 className="text-lg font-bold mb-2 text-cyan-400">Orchestrator Configuration</h3>
                      <p className="text-xs text-blue-300/70 mb-4">
                        The orchestrator guides the entire workflow. Define its role, overall goal, and approach.
                      </p>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-semibold mb-2">
                            Orchestrator Role
                            <span className="text-xs text-blue-300/60 ml-2">(who is the orchestrator?)</span>
                          </label>
                          <input
                            type="text"
                            value={editingTopic.orchestrator?.role || ''}
                            onChange={(e) => setEditingTopic({
                              ...editingTopic,
                              orchestrator: { ...editingTopic.orchestrator, role: e.target.value }
                            })}
                            placeholder="e.g., You are the orchestrator for designing IC schemes"
                            className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold mb-2">
                            Overall Goal
                            <span className="text-xs text-blue-300/60 ml-2">(what is the workflow trying to achieve?)</span>
                          </label>
                          <textarea
                            value={editingTopic.orchestrator?.goal || ''}
                            onChange={(e) => setEditingTopic({
                              ...editingTopic,
                              orchestrator: { ...editingTopic.orchestrator, goal: e.target.value }
                            })}
                            placeholder="Describe the overall goal and responsibilities..."
                            className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white text-sm"
                            rows={4}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold mb-2">
                            Approach & Instructions
                            <span className="text-xs text-blue-300/60 ml-2">(how should the orchestrator work?)</span>
                          </label>
                          <textarea
                            value={editingTopic.orchestrator?.approach || ''}
                            onChange={(e) => setEditingTopic({
                              ...editingTopic,
                              orchestrator: { ...editingTopic.orchestrator, approach: e.target.value }
                            })}
                            placeholder="Provide step-by-step instructions, key principles, and decision criteria..."
                            className="w-full bg-slate-800 border border-blue-400/30 rounded-lg px-4 py-2 text-white text-sm"
                            rows={6}
                          />
                        </div>
                      </div>
                    </div>

                    {/* WORKFLOW STEPS */}
                    <div className="border-t border-blue-400/20 pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-cyan-400">Workflow Steps</h3>
                        <button
                          onClick={() => {
                            const newStep = {
                              step: editingTopic.workflow.length + 1,
                              name: 'New Step',
                              agents: [],
                              goal: '',
                              successCriteria: '',
                              additionalContext: ''
                            };
                            setEditingTopic({
                              ...editingTopic,
                              workflow: [...editingTopic.workflow, newStep]
                            });
                          }}
                          className="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg text-xs flex items-center gap-1 border border-green-400/30"
                        >
                          <Plus className="w-3 h-3" />
                          Add Step
                        </button>
                      </div>

                      <div className="space-y-3">
                        {editingTopic.workflow?.map((step, index) => {
                          const stepKey = `${editingTopic.id}-${index}`;
                          const isExpanded = expandedSteps[stepKey] || false;
                          
                          return (
                            <div key={index} className="bg-slate-800 border border-blue-400/20 rounded-lg">
                              {/* Step Header */}
                              <div className="p-4">
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => setExpandedSteps({...expandedSteps, [stepKey]: !isExpanded})}
                                    className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0 hover:bg-blue-500/30 transition-colors"
                                  >
                                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                  </button>
                                  <span className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-sm flex-shrink-0">
                                    {step.step}
                                  </span>
                                  <div className="flex-1">
                                    <div className="text-white font-medium">{step.name}</div>
                                    {!isExpanded && (
                                      <div className="text-xs text-blue-300/60 mt-0.5">
                                        {agents.find(a => a.id === step.agents?.[0])?.name || 'No agent assigned'}
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => {
                                      const newWorkflow = editingTopic.workflow.filter((_, i) => i !== index);
                                      newWorkflow.forEach((s, i) => s.step = i + 1);
                                      setEditingTopic({ ...editingTopic, workflow: newWorkflow });
                                    }}
                                    className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Step Details - Collapsible */}
                              {isExpanded && (
                                <div className="border-t border-blue-400/20 p-4">
                                  <div className="space-y-3">
                                    <div>
                                      <label className="text-xs text-blue-300/70 block mb-1">Step Name:</label>
                                      <input
                                        type="text"
                                        value={step.name}
                                        onChange={(e) => {
                                          const newWorkflow = [...editingTopic.workflow];
                                          newWorkflow[index] = {...newWorkflow[index], name: e.target.value};
                                          setEditingTopic({...editingTopic, workflow: newWorkflow});
                                        }}
                                        className="w-full bg-slate-700 border border-blue-400/30 rounded px-3 py-2 text-white text-sm"
                                        placeholder="Step name"
                                      />
                                    </div>

                                    <div>
                                      <label className="text-xs text-blue-300/70 block mb-1">Step Goal:</label>
                                      <textarea
                                        value={step.goal || ''}
                                        onChange={(e) => {
                                          const newWorkflow = [...editingTopic.workflow];
                                          newWorkflow[index] = {...newWorkflow[index], goal: e.target.value};
                                          setEditingTopic({...editingTopic, workflow: newWorkflow});
                                        }}
                                        className="w-full bg-slate-700 border border-blue-400/30 rounded px-3 py-2 text-white text-sm"
                                        placeholder="What should this step accomplish?"
                                        rows={2}
                                      />
                                    </div>

                                    <div>
                                      <label className="text-xs text-blue-300/70 block mb-1">Success Criteria:</label>
                                      <input
                                        type="text"
                                        value={step.successCriteria || ''}
                                        onChange={(e) => {
                                          const newWorkflow = [...editingTopic.workflow];
                                          newWorkflow[index] = {...newWorkflow[index], successCriteria: e.target.value};
                                          setEditingTopic({...editingTopic, workflow: newWorkflow});
                                        }}
                                        className="w-full bg-slate-700 border border-blue-400/30 rounded px-3 py-2 text-white text-sm"
                                        placeholder="How do we know this step is complete?"
                                      />
                                    </div>

                                    <div>
                                      <label className="text-xs text-blue-300/70 block mb-1">
                                        Additional Context <span className="text-blue-400/50">(Optional)</span>:
                                      </label>
                                      <textarea
                                        value={step.additionalContext || ''}
                                        onChange={(e) => {
                                          const newWorkflow = [...editingTopic.workflow];
                                          newWorkflow[index] = {...newWorkflow[index], additionalContext: e.target.value};
                                          setEditingTopic({...editingTopic, workflow: newWorkflow});
                                        }}
                                        className="w-full bg-slate-700 border border-blue-400/30 rounded px-3 py-2 text-white text-sm"
                                        placeholder="Any additional context, constraints, or guidance for the agent performing this step..."
                                        rows={2}
                                      />
                                      <p className="text-xs text-blue-300/50 mt-1">
                                        This context helps the same agent perform different roles in different workflows
                                      </p>
                                    </div>

                                    <div>
                                      <label className="text-xs text-blue-300/70 block mb-1">Assigned Agent:</label>
                                      <select
                                        value={step.agents?.[0] || ''}
                                        onChange={(e) => {
                                          const newWorkflow = [...editingTopic.workflow];
                                          newWorkflow[index] = {...newWorkflow[index], agents: e.target.value ? [e.target.value] : []};
                                          setEditingTopic({...editingTopic, workflow: newWorkflow});
                                        }}
                                        className="w-full bg-slate-700 border border-blue-400/30 rounded px-3 py-2 text-white text-sm"
                                      >
                                        <option value="">Select an agent...</option>
                                        {agents.map(agent => (
                                          <option key={agent.id} value={agent.id}>
                                            {agent.name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    {/* Move up/down buttons */}
                                    <div className="flex gap-2 pt-2">
                                      {index > 0 && (
                                        <button
                                          onClick={() => {
                                            const newWorkflow = [...editingTopic.workflow];
                                            [newWorkflow[index - 1], newWorkflow[index]] = [newWorkflow[index], newWorkflow[index - 1]];
                                            newWorkflow.forEach((s, i) => s.step = i + 1);
                                            setEditingTopic({...editingTopic, workflow: newWorkflow});
                                          }}
                                          className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded text-xs"
                                        >
                                          ↑ Move Up
                                        </button>
                                      )}
                                      {index < editingTopic.workflow.length - 1 && (
                                        <button
                                          onClick={() => {
                                            const newWorkflow = [...editingTopic.workflow];
                                            [newWorkflow[index], newWorkflow[index + 1]] = [newWorkflow[index + 1], newWorkflow[index]];
                                            newWorkflow.forEach((s, i) => s.step = i + 1);
                                            setEditingTopic({...editingTopic, workflow: newWorkflow});
                                          }}
                                          className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded text-xs"
                                        >
                                          ↓ Move Down
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Modal Footer */}
                  <div className="border-t border-blue-400/20 p-6 flex gap-3 bg-slate-900 rounded-b-xl">
                    <button 
                      onClick={() => {
                        setTopics(topics.map(t => t.id === editingTopic.id ? editingTopic : t));
                        setEditingTopic(null);
                      }}
                      className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      <CheckCircle className="w-5 h-5" />
                      Save Changes
                    </button>
                    <button
                      onClick={() => setEditingTopic(null)}
                      className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      )} {/* end showLanding conditional */}
    </div>
  );
}
