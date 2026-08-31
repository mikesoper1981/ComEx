const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

/** Vercel Node.js serverless entry: CommonJS handler (req, res). */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  res.setHeader('Content-Type', 'application/json');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY is not configured' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return res.status(400).json({ error: { message: 'Invalid JSON body' } });
    }
  }

  const { system, messages, max_tokens, tools, tool_choice, thinking } = body || {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: { message: 'messages must be an array' } });
  }

  const maxTokens = typeof max_tokens === 'number' && max_tokens > 0 ? Math.min(max_tokens, 8192) : 4096;

  const normalized = [];
  for (const m of messages) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const content = m?.content;
    if (content == null || content === '') continue;
    if (!normalized.length && role === 'assistant') continue;
    if (normalized.length && normalized[normalized.length - 1].role === role) {
      const prev = normalized[normalized.length - 1];
      const prevText = typeof prev.content === 'string' ? prev.content : '';
      const nextText = typeof content === 'string' ? content : '';
      prev.content = nextText ? `${prevText}\n\n${nextText}` : prev.content;
      continue;
    }
    normalized.push({ role, content });
  }
  if (!normalized.length) {
    return res.status(400).json({ error: { message: 'messages must include a user turn' } });
  }

  const anthropicBody = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: normalized,
  };

  if (system != null && String(system).trim() !== '') {
    anthropicBody.system = system;
  }

  if (Array.isArray(tools) && tools.length > 0) {
    anthropicBody.tools = tools;
    if (tool_choice != null) anthropicBody.tool_choice = tool_choice;
  }

  // Optional extended thinking (used by the Stella agent for a visible reasoning trail).
  let interleaved = false;
  if (thinking && thinking.type === 'enabled') {
    const budget = typeof thinking.budget_tokens === 'number' ? thinking.budget_tokens : 2000;
    // Budget must be < max_tokens; ensure headroom for the actual answer.
    const safeBudget = Math.max(1024, Math.min(budget, maxTokens - 512));
    anthropicBody.thinking = { type: 'enabled', budget_tokens: safeBudget };
    interleaved = true;
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
    // Interleaved thinking lets the model reason between tool calls (fuller trail).
    if (interleaved) headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(anthropicBody),
    });

    const raw = await upstream.text();
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      return res.status(upstream.status === 200 ? 502 : upstream.status).json({
        error: { message: raw ? raw.slice(0, 240) : 'Upstream returned a non-JSON response' },
      });
    }
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({
      error: { message: err instanceof Error ? err.message : 'Upstream request failed' },
    });
  }
}
