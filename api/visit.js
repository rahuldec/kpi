const SESSIONS_KEY = 'kpi:sessions';

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
    const count = await call('incr', SESSIONS_KEY);
    return res.status(200).json({ count });
  } catch (e) {
    return res.status(502).json({ error: `Could not reach KV: ${e.message}` });
  }
};
