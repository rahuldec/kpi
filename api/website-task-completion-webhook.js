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

const LOGO_URL = 'https://okiedokie-erp-images.s3.ap-south-1.amazonaws.com/Okie%20Dokie/2025/12/sourceURL/26aebcbe10f4ac5a3e8b-611ed1b9032568edd4f3-Okie_Dokie_App_icon__2___2_-removebg-preview.png';

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
  <p class="message">If you notice any issues or have further requests, feel free to <a href="https://form.asana.com/?k=1BG-dqb9_9fyxT7Uke3ckw&d=480944584143449" style="color:${ACCENT};text-decoration:none;font-weight:500;">submit a new ticket</a> through the same form.</p>
  <hr class="divider">
  <div class="footer">
    <p>Automated Email Alert from <a href="https://okiedokie.in" style="color:${ACCENT};text-decoration:none;">OkieDokie</a></p>
    <p class="pex">PEX</p>
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
      from: { address: process.env.ZEPTOMAIL_SENDER || '', name: 'OkieDokie Website Services' },
      to: [{ email_address: { address: toAddress } }],
      subject: 'Your website task has been completed ✓',
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
