// One-time endpoint: registers the Asana webhook for the KPI section trigger.
// Call once after deploy:
//   curl -H "Authorization: Bearer $INSPECT_SECRET" \
//        https://cskpi.oderp.in/api/register-sprint-webhook
//
// Idempotent — safe to call again; Asana deduplicates by (resource, target).

const ASANA_TOKEN_URL = 'https://app.asana.com/-/oauth_token';
const ASANA_API       = 'https://app.asana.com/api/1.0';

module.exports = async (req, res) => {
  const auth = req.headers.authorization || '';
  const ok = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)
          || (process.env.INSPECT_SECRET && auth === `Bearer ${process.env.INSPECT_SECRET}`);
  if (!ok) return res.status(404).end();

  // Get a fresh Asana access token using the stored refresh token
  const tokenBody = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     process.env.ASANA_CLIENT_ID     || '',
    client_secret: process.env.ASANA_CLIENT_SECRET  || '',
    refresh_token: process.env.ASANA_REFRESH_TOKEN  || '',
  });
  const tokenRes = await fetch(ASANA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    return res.status(500).json({ error: 'Failed to get Asana token', detail: tokenJson });
  }
  const accessToken = tokenJson.access_token;

  // Register the webhook
  const hookRes = await fetch(`${ASANA_API}/webhooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      data: {
        resource: '1152739415005823',
        target: 'https://cskpi.oderp.in/api/sprint-kpi-webhook',
        filters: [{ resource_type: 'task', action: 'added' }],
      },
    }),
  });
  const hookJson = await hookRes.json().catch(() => ({}));

  return res.status(hookRes.status).json(hookJson);
};
