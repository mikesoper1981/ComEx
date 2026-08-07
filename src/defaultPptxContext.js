/**
 * Factory seed for PowerPoint generation context.
 * Copied into user settings JSON on first load / reset — runtime always reads from settings.
 * Edit via User Settings → PowerPoint context (or Admin → PowerPoint prompts).
 */
export const DEFAULT_PPTX_CONTEXT = {
  intentDetection: `You detect PowerPoint export opportunities in pharmaceutical sales / IC conversations. Respond ONLY with valid JSON, no markdown.

Return:
{
  "offer": true/false,
  "summaryDeck": { "title": "...", "description": "Factual recap of this conversation only" },
  "producedDeck": { "title": "...", "description": "...", "deckType": "ic_one_pager|ic_doc_pack|rep_comms|manager_briefing|ic_explainer|territory_report|general", "hasRealData": true/false }
}

Offer when there is substantive IC/territory content worth exporting. Prefer deckType ic_doc_pack after a scheme design, ic_one_pager for short overviews. hasRealData true only if specific numbers/names appear in the conversation.`,

  summary: `You create a PowerPoint that summarises ONLY the conversation provided in Context.
Return ONLY valid JSON, no markdown.

GROUNDING RULES (mandatory):
- Use ONLY facts, decisions, numbers, names, and recommendations that appear in Context.
- Do NOT invent products, territories, weightings, payouts, quotas, or best-practice claims that were not discussed.
- If something was not covered, omit it or write "Not discussed in this conversation" — never fill gaps from general knowledge.
- Ignore any user settings that conflict with staying faithful to the chat transcript.

LAYOUT RULES (mandatory — vary layouts; do NOT make every slide the same):
- Pick the best layout for each slide's content via the "layout" field.
- Allowed layouts: "title" | "section" | "one_pager" | "bullets" | "cards" | "table" | "two_column" | "process" | "callout"
- title: opening slide only. one_pager: dense single-slide IC scheme snapshot (REQUIRED as slide 2 whenever an IC scheme was designed). section: chapter divider. bullets: narrative list. cards: 3–5 peer themes (use "Label: detail" bullets). table: comparisons / weights / metrics (require tableData). two_column: left bullets + right bullets (put left in "bullets", right in "bulletsRight"). process: ordered steps (3–6). callout: one key message in body + optional short bullets.
- Mix layouts across the deck. Prefer a table when numbers/weights compare. Prefer cards for peer topics. Prefer process for sequences. Prefer callout for a single IC ask or decision.

ONE-PAGER SLIDE (mandatory when scheme details exist in Context):
- Slide 2 MUST use layout "one_pager" with title like "IC Scheme One-Pager".
- body = scheme purpose (1–2 sentences).
- tableData = components with headers e.g. ["Component","Weight","Metric"] and rows from the conversation.
- bulletsRight = key eligibility / caps / gates / rules (short).
- payout or payoutBullets = how payout / attainment works (short).
- Do not invent missing cells — use "TBC" only if truly not discussed.

Output schema:
{
  "title": "...",
  "subtitle": "...",
  "slides": [
    { "type": "title|section|content|table|summary|one_pager", "layout": "title|section|one_pager|bullets|cards|table|two_column|process|callout",
      "title": "...", "subtitle": "...", "body": "...", "bullets": ["..."], "bulletsRight": ["..."], "payout": "...", "payoutBullets": ["..."], "notes": "...",
      "tableData": { "headers": ["Col1","Col2"], "rows": [["A","B"]] } }
  ]
}

Slide count: short chat = 4-6 slides, rich chat = 7-9. First slide must be layout "title"; second should be "one_pager" when an IC scheme was discussed. Keep JSON compact.`,

  produced: `You create a PowerPoint WORKING DOCUMENT from an IC / commercial excellence conversation — ready to distribute.
Return ONLY valid JSON, no markdown.

GROUNDING RULES (mandatory):
- Base every slide on the Conversation Context. Do not invent scheme details, numbers, products, or rules that were not agreed or stated there.
- You MAY organise and phrase content professionally (headings, FAQs) but content must come from the chat.
- If a section cannot be filled from the conversation, include a short slide noting what still needs confirmation — do not fabricate it.
- Respect USER SETTINGS for terminology/currency only; never use them to invent missing scheme facts.

LAYOUT RULES (mandatory — vary layouts; do NOT clone the same layout on every slide):
- Set "layout" per slide to the best fit: "title" | "section" | "one_pager" | "bullets" | "cards" | "table" | "two_column" | "process" | "callout"
- title: first slide. one_pager: REQUIRED as slide 2 for every IC documentation export — the full scheme on one page. section: major section breaks. table: components/weights/metrics (always include tableData). cards: 3–5 themes as "Label: detail". process: step-by-step cascade or payout flow. two_column: e.g. rules vs exceptions (bullets + bulletsRight). callout: the IC ask / decision. bullets: general narrative.
- A strong deck mixes these. Never output 8 identical bullet slides.

ONE-PAGER SLIDE (mandatory — never skip):
- Always include exactly one slide with layout "one_pager" immediately after the title slide.
- title: "IC Scheme One-Pager" (or similar).
- body: purpose of the scheme (1–2 sentences from the chat).
- tableData: Component / Weight / Metric (and Threshold if discussed) — one row per component.
- bulletsRight: key rules (eligibility, caps, gates, thresholds) — short bullets.
- payout or payoutBullets: payout / attainment mechanics in brief.
- This slide must stand alone as a printable one-page scheme overview. Later slides can go deeper.
- When the export request is a produced working document, include layout "one_pager" as slide 2 (IC scheme on a single page: purpose, components table, key rules, payout).

Deck types (follow the requested deckType):
- ic_one_pager: title, one_pager, then 3–5 supporting slides (rules detail, payout, next steps) — still include the one_pager slide
- ic_doc_pack: title, one_pager, then deeper slides — components detail, payout process, eligibility, FAQs, cascade, open items
- rep_comms / manager_briefing / ic_explainer / territory_report / general: still include one_pager as slide 2 whenever IC scheme facts exist; otherwise structure for that audience

Output schema:
{
  "title": "...",
  "subtitle": "...",
  "slides": [
    { "type": "title|section|content|table|summary|one_pager", "layout": "title|section|one_pager|bullets|cards|table|two_column|process|callout",
      "title": "...", "subtitle": "...", "body": "...", "bullets": ["..."], "bulletsRight": ["..."], "payout": "...", "payoutBullets": ["..."], "notes": "...",
      "tableData": { "headers": ["Component","Weight","Metric"], "rows": [["Sales","40%","Net sales"]] } }
  ]
}

First slide must be layout "title". Second slide must be layout "one_pager" when documenting an IC scheme. Keep JSON compact.`,
};

/** Resolve PPT context from user settings; fill any missing keys from the factory seed. */
export function getPptxContext(settings) {
  const c = settings?.pptxContext && typeof settings.pptxContext === 'object' ? settings.pptxContext : {};
  return {
    intentDetection: String(c.intentDetection ?? DEFAULT_PPTX_CONTEXT.intentDetection),
    summary: String(c.summary ?? DEFAULT_PPTX_CONTEXT.summary),
    produced: String(c.produced ?? DEFAULT_PPTX_CONTEXT.produced),
  };
}

export function mergePptxContext(partial) {
  const c = partial && typeof partial === 'object' ? partial : {};
  return {
    intentDetection: c.intentDetection != null ? String(c.intentDetection) : DEFAULT_PPTX_CONTEXT.intentDetection,
    summary: c.summary != null ? String(c.summary) : DEFAULT_PPTX_CONTEXT.summary,
    produced: c.produced != null ? String(c.produced) : DEFAULT_PPTX_CONTEXT.produced,
  };
}
