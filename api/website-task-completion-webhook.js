// Asana webhook: fires on any task change in the Client Website Tasks project.
// When a task transitions to completed=true, parses the client's email from
// the task notes (injected there by Asana's form submission) and sends a
// "your task is done" email via ZeptoMail.
//
// Registration: POST /api/register-website-completion-webhook once (gated by
// INSPECT_SECRET). Asana handshake is handled inline on first call.

const ASANA_TOKEN_URL = 'https://app.asana.com/-/oauth_token';
const ASANA_API       = 'https://app.asana.com/api/1.0';

// Colour palette — same family as the rest of the digest emails
const ACCENT = '#B5501C';
const GREEN  = '#2E7D32';
const BLUE   = '#0066CC';

const LOGO_URL = 'data:image/png;base64,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';

const STYLE = `
    * { margin:0; padding:0; box-sizing:border-box;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; }
    body { background:#F5F4F1; padding:40px 16px; color:#1D1D1F; }
    .email-container { max-width:600px; width:100%; margin:0 auto; background:#FFFFFF;
      border:1px solid #E5E3DE; border-radius:12px; padding:36px 32px; }
    .masthead { text-align:center; margin-bottom:28px; }
    .masthead img { width:56px; height:56px; object-fit:contain; margin:0 0 14px; display:block; margin-left:auto; margin-right:auto; }
    .masthead .eyebrow { font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase;
      color:${GREEN}; margin:0 0 10px; }
    .masthead h1 { font-size:23px; font-weight:600; letter-spacing:-.01em; color:#1D1D1F; margin:0 0 6px; }
    .masthead .date { font-size:14px; color:#6E6E73; margin:0; }
    .divider { border:none; border-top:1px solid #E5E3DE; margin:28px 0; }
    .task-box { background:#F5F4F1; border-radius:8px; padding:16px 20px; }
    .task-box .label { font-size:10.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
      color:#8A8A8F; margin:0 0 6px; }
    .task-box .task-name { font-size:15px; font-weight:600; color:#1D1D1F; word-break:break-word; }
    .message { font-size:14px; color:#3A3A3C; line-height:1.6; margin:0; }
    .footer p { margin:0; font-size:12px; color:#8A8A8F; text-align:center; }
    .footer a { color:${ACCENT}; text-decoration:none; }
    .footer .pex { margin:10px 0 0; font-size:22px; font-weight:800; letter-spacing:.18em;
      color:${BLUE}; text-align:center; }
    @media (max-width:480px) {
      .email-container { padding:28px 20px; }
      .masthead h1 { font-size:20px; }
    }`;

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ─── parse client email from Asana form notes ────────────────────────────────
// Notes injected by the form look like:
//   ...
//   Email address:
//   client@example.com
//   ...
function parseClientEmail(notes) {
  if (!notes) return null;
  const m = notes.match(/Email address:\s*\n([^\s@]+@[^\s@]+\.[^\s@]+)/i);
  return m ? m[1].trim() : null;
}

// ─── email HTML ──────────────────────────────────────────────────────────────
function buildHtml(taskName) {
  const dateStr = new Date().toLocaleDateString('en-GB',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `<!doctype html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Task Completed</title><style>${STYLE}</style></head>
<body><div class="email-container">
  <div class="masthead">
    <img src="${LOGO_URL}" alt="OkieDokie" width="56" height="56">
    <p class="eyebrow">Task Completed</p>
    <h1>Your request has been resolved</h1>
    <p class="date">${dateStr}</p>
  </div>
  <hr class="divider">
  <p class="message">Hi,<br><br>
  We're happy to let you know that the following task has been completed on your website.</p>
  <br>
  <div class="task-box">
    <p class="label">Task</p>
    <p class="task-name">${esc(taskName)}</p>
  </div>
  <br>
  <p class="message">If you have further requests, feel free to submit a new ticket through the form:</p>
  <br>
  <p style="text-align:center;">
    <a href="https://form.asana.com/?k=1BG-dqb9_9fyxT7Uke3ckw&d=480944584143449"
       style="display:inline-block;background:${ACCENT};color:#ffffff;font-size:14px;font-weight:600;
              text-decoration:none;padding:12px 28px;border-radius:8px;letter-spacing:.01em;">
      Submit a New Ticket
    </a>
  </p>
  <hr class="divider">
  <div class="footer">
    <p>Automated Email Alert from <a href="https://okiedokiepay.com/" style="color:${ACCENT};text-decoration:none;">Okie Dokie</a></p>
  </div>
</div></body></html>`;
}

// ─── Asana token ─────────────────────────────────────────────────────────────
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

// ─── ZeptoMail send ───────────────────────────────────────────────────────────
async function sendEmail(toAddress, taskName) {
  const r = await fetch(process.env.ZEPTOMAIL_URL || 'https://api.zeptomail.in/v1.1/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.ZEPTOMAIL_TOKEN || '',
    },
    body: JSON.stringify({
      from: { address: process.env.ZEPTOMAIL_SENDER || '', name: 'Okie Dokie Website Services' },
      to: [{ email_address: { address: toAddress } }],
      subject: 'Your Website Work Is Complete',
      htmlbody: buildHtml(taskName),
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ZeptoMail ${r.status}: ${JSON.stringify(d)}`);
  return d;
}

// ─── main handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // Test send: ?test=email (gated by INSPECT_SECRET / CRON_SECRET)
  if (req.query.test) {
    const auth = req.headers.authorization || '';
    const ok = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)
            || (process.env.INSPECT_SECRET && auth === `Bearer ${process.env.INSPECT_SECRET}`);
    if (!ok) return res.status(404).end();
    const testTo = req.query.test;
    const zepto = await sendEmail(testTo, 'Please upload the activity on college website — Blood Donation Camp Organised at DAV Centenary College, Faridabad');
    return res.status(200).json({ ok: true, testTo, zepto });
  }

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
        resource: '1211188142613963',
        target: `${baseUrl}/api/website-task-completion-webhook`,
        filters: [{ resource_type: 'task', action: 'changed', fields: ['completed'] }],
      }}),
    });
    return res.status(r.status).json(await r.json().catch(() => ({})));
  }

  // Asana handshake: echo X-Hook-Secret back on first registration call
  const hookSecret = req.headers['x-hook-secret'];
  if (hookSecret) {
    res.setHeader('X-Hook-Secret', hookSecret);
    return res.status(200).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  const events = (req.body && req.body.events) || [];

  // Find tasks that just flipped to completed
  const completedGids = [
    ...new Set(
      events
        .filter(ev =>
          ev.action === 'changed' &&
          ev.resource?.resource_type === 'task' &&
          ev.change?.field === 'completed' &&
          ev.change?.new_value === true
        )
        .map(ev => ev.resource?.gid)
        .filter(Boolean)
    ),
  ];

  if (!completedGids.length) return res.status(200).json({ skipped: true });

  try {
    const token = await getToken();
    const results = [];

    for (const gid of completedGids) {
      const task = await (async () => {
        const r = await fetch(`${ASANA_API}/tasks/${gid}?opt_fields=name,notes`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await r.json().catch(() => ({}));
        return d.data || {};
      })();

      const clientEmail = parseClientEmail(task.notes || '');
      if (!clientEmail) {
        results.push({ gid, skipped: 'no client email in notes' });
        continue;
      }

      await sendEmail(clientEmail, task.name || 'Website task');
      results.push({ gid, sent: clientEmail });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('website-task-completion-webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
};
