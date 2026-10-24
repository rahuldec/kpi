const SESSIONS_KEY = 'kpi:sessions';
const LOG_KEY      = 'kpi:login-log';
const LOG_MAX      = 1000;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const base  = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token)
    return res.status(500).json({
      error: 'KV_REST_API_URL / KV_REST_API_TOKEN are not set on this deployment.',
      hint:  'Attach a KV store: Vercel → Storage → Create Database → KV, then redeploy.',
    });

  const p    = req.query || new URL(req.url, 'http://x').searchParams;
  const get  = k => String(p[k] || p.get?.(k) || '').trim();
  const email = get('email').toLowerCase();
  const name  = get('name');

  if (!email) return res.status(400).json({ error: 'No ?email= given.' });

  const kv = async (...args) => {
    const url = `${base}/${args.map(encodeURIComponent).join('/')}`;
    const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j   = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `KV ${r.status}`);
    return j.result;
  };

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';

  try {
    const [count] = await Promise.all([
      kv('incr', SESSIONS_KEY),
      kv('lpush', LOG_KEY, JSON.stringify({ email, name, ts: new Date().toISOString(), ip }))
        .then(() => kv('ltrim', LOG_KEY, '0', String(LOG_MAX - 1))),
    ]);
    return res.status(200).json({ count });
  } catch (e) {
    return res.status(502).json({ error: `Could not reach KV: ${e.message}` });
  }
};
