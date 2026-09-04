// Step 1 of the one-time Asana OAuth bootstrap for api/data.js's internal and
// client sources. Visit this route once in a browser, approve the consent
// screen, and Asana redirects to /api/asana-callback with a code that gets
// exchanged for the refresh token this app runs on long-term.
//
// The Asana app's OAuth settings must list this deployment's own
// /api/asana-callback URL as a registered redirect URI, or Asana will refuse
// the request with a redirect_uri mismatch — same failure shape as the Zoho
// login (see lib/zoho-auth.js), same fix: add the exact URL there.
module.exports = async (req, res) => {
  const clientId = process.env.ASANA_CLIENT_ID || '';
  if (!clientId) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(500).send('ASANA_CLIENT_ID is not set on this deployment.');
  }

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${proto}://${req.headers.host}/api/asana-callback`;

  const url = new URL('https://app.asana.com/-/oauth_authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'default');

  res.writeHead(302, { Location: url.toString() });
  res.end();
};
