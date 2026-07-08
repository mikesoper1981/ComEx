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

  const { system, messages, max_tokens, tools, tool_choice } = body || {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: { message: 'messages must be an array' } });
  }

  const maxTokens = typeof max_tokens === 'number' && max_tokens > 0 ? Math.min(max_tokens, 8192) : 4096;

  const anthropicBody = {
    model: MODEL,
    max_tokens: maxTokens,
    messages,
  };

  if (system != null && String(system).trim() !== '') {
    anthropicBody.system = system;
  }

  if (Array.isArray(tools) && tools.length > 0) {
    anthropicBody.tools = tools;
    if (tool_choice != null) anthropicBody.tool_choice = tool_choice;
  }

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({
      error: { message: err instanceof Error ? err.message : 'Upstream request failed' },
    });
  }
}
