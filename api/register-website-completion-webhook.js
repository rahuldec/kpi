// One-time endpoint: registers the Asana webhook that fires on task completion
// in the Client Website Tasks project, pointing at the
// website-task-completion-webhook handler.
//
// Call once after deploy:
//   curl -H "Authorization: Bearer $INSPECT_SECRET" \
//        https://cskpi.oderp.in/api/register-website-completion-webhook
//
// Idempotent — safe to call again; Asana deduplicates by (resource, target).

const WEBSITE_TASKS_PROJECT_GID = '1211188142613963';
const ASANA_TOKEN_URL = 'https://app.asana.com/-/oauth_token';
const ASANA_API       = 'https://app.asana.com/api/1.0';

module.exports = async (req, res) => {
  const auth = req.headers.authorization || '';
  const ok = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)
          || (process.env.INSPECT_SECRET && auth === `Bearer ${process.env.INSPECT_SECRET}`);
  if (!ok) return res.status(404).end();

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     process.env.ASANA_CLIENT_ID     || '',
    client_secret: process.env.ASANA_CLIENT_SECRET  || '',
    refresh_token: process.env.ASANA_REFRESH_TOKEN  || '',
  });
  const tokenRes = await fetch(ASANA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    return res.status(500).json({ error: 'Failed to get Asana token', detail: tokenJson });
  }

  const baseUrl = process.env.DIGEST_BASE_URL || 'https://cskpi.oderp.in';
  const hookRes = await fetch(`${ASANA_API}/webhooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenJson.access_token}`,
    },
    body: JSON.stringify({
      data: {
        resource: WEBSITE_TASKS_PROJECT_GID,
        target: `${baseUrl}/api/website-task-completion-webhook`,
        filters: [{ resource_type: 'task', action: 'changed', fields: ['completed'] }],
      },
    }),
  });
  const hookJson = await hookRes.json().catch(() => ({}));
  return res.status(hookRes.status).json(hookJson);
};
