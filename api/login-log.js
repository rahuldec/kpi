const LOG_KEY   = 'kpi:login-log';
const ADMIN_EMAIL = 'rahul.sharma@okiedokiepay.com';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const base  = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token)
    return res.status(500).json({ error: 'KV not configured.' });

  const p     = req.query || new URL(req.url, 'http://x').searchParams;
  const email = String(p['email'] || p.get?.('email') || '').trim().toLowerCase();

  if (email !== ADMIN_EMAIL)
    return res.status(403).json({ error: 'Not authorised.' });

  const kv = async (...args) => {
    const url = `${base}/${args.map(encodeURIComponent).join('/')}`;
    const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j   = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `KV ${r.status}`);
    return j.result;
  };

  try {
    const raw = await kv('lrange', LOG_KEY, '0', '999');
    const entries = (raw || []).map(s => { try { return JSON.parse(s); } catch { return null; } })
                               .filter(Boolean);
    return res.status(200).json({ entries });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
