// Asana webhook: fires when a sprint task is moved to the "KPI" section of
// the OD Campus Automation ERP project. Fetches that sprint's numbered
// subtasks (with creator names) and sends the PEX Points Deployed email.
//
// Registration: POST /api/1.0/webhooks once (see register-sprint-webhook.js)
// pointing to https://cskpi.oderp.in/api/sprint-kpi-webhook
//
// Asana handshake: on first call Asana sends X-Hook-Secret — we echo it back
// as X-Hook-Secret in the response header. Subsequent calls are event payloads.

const KPI_SECTION_GID  = '1210351364480517';
const ASANA_TOKEN_URL  = 'https://app.asana.com/-/oauth_token';
const ASANA_API        = 'https://app.asana.com/api/1.0';

const EMAIL_TO   = 'customer-success-delight@okiedokiepay.com';
const EMAIL_CC   = [
  'lalit.garg@okiedokiepay.com',
  'vishvas.sehra@okiedokiepay.com',
  'jatin.goel@okiedokiepay.com',
  'anshul.dabas@okiedokiepay.com',
  'rahul.sharma@okiedokiepay.com',
  'ayush.garg@okiedokiepay.com',
];

// ─── colour palette (same as daily-digest.js) ─────────────────────────────
const ACCENT = '#B5501C';
const BLUE   = '#0071E3';
const GREEN  = '#2E7D32';
const AMBER  = '#B8860B';
const PURPLE = '#6A0DAD';
const TEAL   = '#007C74';

const STYLE = `
    * { margin:0; padding:0; box-sizing:border-box;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; }
    body { background:#F5F4F1; padding:40px 16px; color:#1D1D1F; }
    .email-container { max-width:600px; width:100%; margin:0 auto; background:#FFFFFF;
      border:1px solid #E5E3DE; border-radius:12px; padding:36px 32px; }
    .masthead { text-align:center; margin-bottom:28px; }
    .masthead h1 { font-size:23px; font-weight:600; letter-spacing:-.01em; color:#1D1D1F; margin:0 0 6px; }
    .masthead .date { font-size:14px; color:#6E6E73; margin:0; }
    .divider { border:none; border-top:1px solid #E5E3DE; margin:32px 0; }
    .sprint-name { font-size:15px; font-weight:600; color:${ACCENT}; margin:0 0 20px; }
    .kpi-table { width:100%; border-collapse:collapse; font-size:13.5px; table-layout:fixed; }
    .kpi-table th { text-align:left; padding:0 0 8px; font-size:10.5px; font-weight:600; letter-spacing:.04em;
      text-transform:uppercase; color:#8A8A8F; border-bottom:1px solid #E5E3DE; }
    .kpi-table td { padding:9px 0; border-bottom:1px solid #EFEDE8; vertical-align:top; }
    .kpi-table tr:last-child td { border-bottom:none; }
    .task-col { word-break:break-word; padding-right:8px; }
    .creator-col { white-space:nowrap; color:#6E6E73; width:130px; }
    .task-name { font-weight:500; color:#1D1D1F; }
    .footer p { margin:0; font-size:12px; color:#8A8A8F; text-align:center; }
    .footer .pex { margin:10px 0 0; font-size:22px; font-weight:800; letter-spacing:.18em; color:${BLUE}; text-align:center; }
    @media (max-width:480px) {
      .email-container { padding:28px 20px; }
      .masthead h1 { font-size:20px; }
    }`;

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ─── Asana helpers ─────────────────────────────────────────────────────────
let cachedToken = null;

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000)
    return cachedToken.token;
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     process.env.ASANA_CLIENT_ID     || '',
    client_secret: process.env.ASANA_CLIENT_SECRET  || '',
    refresh_token: process.env.ASANA_REFRESH_TOKEN  || '',
  });
  const r = await fetch(ASANA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error_description || `Asana token HTTP ${r.status}`);
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function asana(path, token) {
  const r = await fetch(`${ASANA_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Asana ${path} → ${r.status}: ${JSON.stringify(d)}`);
  return d.data;
}

// ─── email helpers ─────────────────────────────────────────────────────────
function buildHtml(sprintName, tasks) {
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const rows = tasks.map(t =>
    `<tr>
      <td class="task-col"><span class="task-name">${esc(t.name)}</span></td>
      <td class="creator-col">${esc(t.creator)}</td>
    </tr>`
  ).join('');

  const body = `<div class="email-container">
    <div class="masthead">
      <h1>PEX Points Deployed This Week</h1>
      <p class="date">${today}</p>
    </div>
    <hr class="divider">
    <p class="sprint-name">${esc(sprintName)}</p>
    <table class="kpi-table">
      <tr><th class="task-col">Feature / Fix</th><th class="creator-col">Raised By</th></tr>
      ${rows}
    </table>
    <hr class="divider">
    <div class="footer">
      <p class="pex">PEX</p>
    </div>
  </div>`;

  return `<!doctype html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>PEX Points Deployed</title>
<style>${STYLE}</style></head>
<body>${body}</body></html>`;
}

async function sendEmail(sprintName, tasks) {
  const html = buildHtml(sprintName, tasks);
  const r = await fetch(process.env.ZEPTOMAIL_URL || 'https://api.zeptomail.in/v1.1/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.ZEPTOMAIL_TOKEN || '',
    },
    body: JSON.stringify({
      from: { address: process.env.ZEPTOMAIL_SENDER || '', name: 'PEX Points Deployed' },
      to:  [{ email_address: { address: EMAIL_TO } }],
      cc:  EMAIL_CC.map(a => ({ email_address: { address: a } })),
      subject: `🚀 PEX Points Deployed This Week`,
      htmlbody: html,
    }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`ZeptoMail ${r.status}: ${JSON.stringify(d)}`);
  }
}

// ─── main handler ──────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // Self-registration: ?register=1 (gated by INSPECT_SECRET / CRON_SECRET)
  if (req.query.register === '1') {
    const auth = req.headers.authorization || '';
    const ok = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)
            || (process.env.INSPECT_SECRET && auth === `Bearer ${process.env.INSPECT_SECRET}`);
    if (!ok) return res.status(404).end();
    const token = await getToken();
    const baseUrl = process.env.DIGEST_BASE_URL || 'https://cskpi.oderp.in';
    const r = await fetch(`${ASANA_API}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: {
        resource: '1152739415005823',
        target: `${baseUrl}/api/sprint-kpi-webhook`,
        filters: [{ resource_type: 'task', action: 'added' }],
      }}),
    });
    return res.status(r.status).json(await r.json().catch(() => ({})));
  }

  // Asana handshake: echo X-Hook-Secret back and done
  const hookSecret = req.headers['x-hook-secret'];
  if (hookSecret) {
    res.setHeader('X-Hook-Secret', hookSecret);
    return res.status(200).end();
  }

  // Only handle POST event payloads
  if (req.method !== 'POST') return res.status(405).end();

  const events = (req.body && req.body.events) || [];

  // Find tasks newly added to the KPI section
  const kpiTaskGids = [
    ...new Set(
      events
        .filter(ev => ev.action === 'added' && ev.parent?.gid === KPI_SECTION_GID)
        .map(ev => ev.resource?.gid)
        .filter(Boolean)
    ),
  ];

  if (!kpiTaskGids.length) return res.status(200).json({ skipped: true });

  try {
    const token = await getToken();

    for (const gid of kpiTaskGids) {
      // Get sprint task name
      const task = await asana(`/tasks/${gid}?opt_fields=name`, token);
      const sprintName = task.name || gid;

      // Get numbered main subtasks with creator names
      const subtasks = await asana(
        `/tasks/${gid}/subtasks?opt_fields=name,created_by.name&limit=100`,
        token
      );
      // Prefer [N]-prefixed tasks; fall back to all direct subtasks if none found
      // (some sprints don't use the [1]/[2] numbering convention)
      let mainTasks = subtasks
        .filter(t => /^\s*\[\d+\]/.test(t.name))
        .map(t => ({ name: t.name.trim(), creator: t.created_by?.name || '—' }));

      if (!mainTasks.length) {
        mainTasks = subtasks
          .filter(t => t.name && !t.name.startsWith('QA ') && !t.name.startsWith('----'))
          .map(t => ({ name: t.name.trim(), creator: t.created_by?.name || '—' }));
      }

      if (!mainTasks.length) continue;

      await sendEmail(sprintName, mainTasks);
    }

    return res.status(200).json({ sent: kpiTaskGids.length });
  } catch (err) {
    console.error('sprint-kpi-webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
};
