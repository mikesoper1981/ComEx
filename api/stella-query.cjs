/**
 * Stella Insights — read-only SQL executor.
 *
 * Accepts POST { sql: "SELECT ..." }, validates that it is a single SELECT
 * statement, and runs it against Supabase using the service-role key via the
 * `stella_run_select` RPC. The service key is never exposed to the browser.
 *
 * Required environment variables:
 *   - SUPABASE_URL          (falls back to VITE_SUPABASE_URL)
 *   - SUPABASE_SERVICE_KEY  (the service_role key — server-side only)
 */

function isSelectOnly(sql) {
  if (typeof sql !== 'string') return false;
  const cleaned = sql.trim();
  if (!/^select\s/i.test(cleaned)) return false;
  // Reject stacked statements (a semicolon followed by more SQL).
  if (/;\s*\S/.test(cleaned)) return false;
  // Defensively block mutating keywords.
  if (/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy)\b/i.test(cleaned)) return false;
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    return res.status(500).json({ error: { message: 'SUPABASE_URL is not configured' } });
  }
  if (!serviceKey) {
    return res.status(500).json({ error: { message: 'SUPABASE_SERVICE_KEY is not configured' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return res.status(400).json({ error: { message: 'Invalid JSON body' } });
    }
  }

  const sql = body && body.sql;
  if (!isSelectOnly(sql)) {
    return res.status(400).json({ error: { message: 'Only a single SELECT statement is allowed' } });
  }

  try {
    const upstream = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/stella_run_select`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      const message = (data && (data.message || data.error || data.hint)) || 'Query failed';
      return res.status(upstream.status).json({ error: { message } });
    }

    // `stella_run_select` returns a JSON array (or null for empty).
    const rows = Array.isArray(data) ? data : (data == null ? [] : data);
    return res.status(200).json({ rows });
  } catch (err) {
    return res.status(502).json({
      error: { message: err instanceof Error ? err.message : 'Upstream request failed' },
    });
  }
};
