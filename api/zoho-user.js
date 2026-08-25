// Proxies Zoho /oauth/user/info server-side. The browser cannot call it
// directly — Zoho does not send CORS headers on that endpoint.

const ALLOWED_ACCOUNTS = /^https:\/\/accounts\.zoho(\.[a-z]{2,3})?(\.cloud\.ca)?$/;

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || !/^Zoho-oauthtoken /i.test(auth)) {
    return res.status(401).json({ error: 'Missing Zoho access token' });
  }

  const accounts = (req.query && req.query.accounts) ||
    new URL(req.url, 'http://x').searchParams.get('accounts') ||
    'https://accounts.zoho.in';

  if (!ALLOWED_ACCOUNTS.test(accounts)) {
    return res.status(400).json({ error: 'Invalid accounts URL' });
  }

  try {
    const r = await fetch(accounts + '/oauth/user/info', {
      headers: { Authorization: auth },
    });
    const data = await r.json().catch(() => ({}));
    res.setHeader('Cache-Control', 'no-store');
    if (!r.ok) return res.status(r.status).json(data);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: String((err && err.message) || err) });
  }
};
