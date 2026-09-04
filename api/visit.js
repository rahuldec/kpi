// Records a unique dashboard visitor (by Zoho login email) and returns the
// running total. Backed by Vercel KV over its plain REST API rather than the
// @vercel/kv SDK — this project has no npm dependencies today, and every
// other api/*.js here already talks to its upstream with a bare fetch, so
// this keeps that pattern instead of introducing the first one.
//
// Requires a KV store attached to this Vercel project: Vercel -> Storage ->
// Create Database -> KV, then redeploy — that sets KV_REST_API_URL and
// KV_REST_API_TOKEN automatically, no manual copying.
//
// A Redis set is the whole mechanism: SADD is a no-op for an email already in
// it, so "unique visitor" falls out of the data structure rather than needing
// its own dedup logic here, and SCARD is the count.
const VISITORS_KEY = 'kpi:visitors';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const base = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token)
    return res.status(500).json({
      error: 'KV_REST_API_URL / KV_REST_API_TOKEN are not set on this deployment.',
      hint: 'Attach a KV store to this project: Vercel -> Storage -> Create Database -> KV, then redeploy.',
    });

  const email = String((req.query && req.query.email) ||
    new URL(req.url, 'http://x').searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'No ?email= given.' });

  const call = async (...args) => {
    const url = `${base}/${args.map(encodeURIComponent).join('/')}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || `KV answered ${r.status}`);
    return json.result;
  };

  try {
    await call('sadd', VISITORS_KEY, email);
    const count = await call('scard', VISITORS_KEY);
    return res.status(200).json({ count });
  } catch (e) {
    return res.status(502).json({ error: `Could not reach KV: ${e.message}` });
  }
};
