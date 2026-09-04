// Step 2 of the one-time Asana OAuth bootstrap — see api/asana-authorize.js.
// Asana redirects here with ?code=... after consent; this exchanges it for a
// refresh token and prints it once. Copy the value into ASANA_REFRESH_TOKEN in
// Vercel -> Settings -> Environment Variables, then redeploy. This page shows
// it exactly once — losing it means repeating the /api/asana-authorize flow,
// not recovering it from anywhere.
//
// This route needs no auth of its own: the `code` it receives is single-use,
// short-lived, and only redeemable by whoever holds ASANA_CLIENT_SECRET (this
// deployment), which is the same protection an OAuth callback always relies on.
module.exports = async (req, res) => {
  const q = req.query && Object.keys(req.query).length
    ? req.query
    : Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (q.error) return res.status(400).send(`Asana returned an error: ${q.error}`);
  if (!q.code) return res.status(400).send('No ?code= on this request — start at /api/asana-authorize instead.');

  const clientId = process.env.ASANA_CLIENT_ID || '';
  const clientSecret = process.env.ASANA_CLIENT_SECRET || '';
  if (!clientId || !clientSecret)
    return res.status(500).send('ASANA_CLIENT_ID / ASANA_CLIENT_SECRET are not set on this deployment.');

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${proto}://${req.headers.host}/api/asana-callback`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code: q.code,
  });

  let json;
  try {
    const r = await fetch('https://app.asana.com/-/oauth_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    json = await r.json().catch(() => ({}));
    if (!r.ok)
      return res.status(502).send(`Asana token exchange failed: ${json.error_description || json.error || r.status}`);
  } catch (e) {
    return res.status(502).send(`Could not reach Asana: ${e.message}`);
  }

  return res.status(200).send(
    'Success. Copy the line below into Vercel -> Settings -> Environment Variables\n' +
    'as ASANA_REFRESH_TOKEN, then redeploy. This is shown once and not stored anywhere\n' +
    'by this app — if you lose it, just revisit /api/asana-authorize to get a new one.\n\n' +
    `ASANA_REFRESH_TOKEN=${json.refresh_token}\n`
  );
};
