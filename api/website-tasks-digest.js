// Sends the Client Website Tasks daily update by email via ZeptoMail: what's
// still pending, and what got closed today. Triggered by a Vercel Cron entry
// in vercel.json — never called directly by the dashboard itself.
//
// Pulls from api/data.js's `websiteTasks` source (see grabAsanaWebsiteTasks
// there), which reads the "Client Website Tasks" Asana project directly —
// same OAuth app and ASANA_* env vars as every other Asana-backed source on
// this deployment, nothing new to configure there.
//
// Security: same gate as api/daily-digest.js — refuses to run unless called
// with the same secret Vercel Cron is configured to send, and does nothing
// (404) rather than erroring loudly if that secret is missing or wrong.

function splitRows(t, dl) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === dl) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  row.push(f); if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/* Same shape as grabAsanaWebsiteTasks's CSV: Task, Assignee, Website,
   Category, Created At, Completed At, Completed. Dates arrive as Asana's own
   ISO timestamps (UTC) and are kept as Date objects here rather than strings,
   since both the pending/completed split and the display format need real
   dates, not just the raw text. */
function parseWebsiteTasks(csv) {
  const rows = splitRows(csv, ',');
  if (!rows.length) return [];
  const [head, ...rest] = rows;
  const ix = {
    task: head.indexOf('Task'), assignee: head.indexOf('Assignee'), website: head.indexOf('Website'),
    category: head.indexOf('Category'), created: head.indexOf('Created At'),
    completedAt: head.indexOf('Completed At'), completed: head.indexOf('Completed'),
  };
  const out = [];
  for (const r of rest) {
    if (!r || !r[ix.task]) continue;
    out.push({
      task: (r[ix.task] || '').trim(),
      assignee: (r[ix.assignee] || 'Unassigned').trim() || 'Unassigned',
      website: (r[ix.website] || '').trim(),
      category: (r[ix.category] || '').trim(),
      createdAt: r[ix.created] ? new Date(r[ix.created]) : null,
      completedAt: r[ix.completedAt] ? new Date(r[ix.completedAt]) : null,
      completed: r[ix.completed] === 'true',
    });
  }
  return out;
}

/* Same UTC-calendar-day convention the rest of this codebase's server-side
   digests use (index.html's own iso() and daily-digest.js's lastWorkingDay())
   — Vercel's server clock is UTC, so getFullYear/Month/Date here read the UTC
   date, not IST. A task closed between midnight and 5:30am IST reads as the
   previous day, the same edge case those other digests already carry. */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shorten = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
const fmtDate = d => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

/* Same template as api/daily-digest.js — one accent for structure, RED/AMBER/
   GREEN as semantic status colors, hairline dividers, centered section
   eyebrow+headline pairs, the same kpi-table and footer shapes — so this
   reads as the same family of email rather than a one-off design. */
const ACCENT = '#B5501C';
const RED = '#A82A1C';
const AMBER = '#B8860B';
const GREEN = '#2E7D32';

const STYLE = `
    * { margin:0; padding:0; box-sizing:border-box;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; }
    body { background:#F5F4F1; padding:40px 16px; color:#1D1D1F; }
    .email-container { max-width:600px; width:100%; margin:0 auto; background:#FFFFFF;
      border:1px solid #E5E3DE; border-radius:12px; padding:36px 32px; }
    .masthead { text-align:center; margin-bottom:28px; }
    .masthead .eyebrow { font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase;
      color:${ACCENT}; margin:0 0 10px; }
    .masthead h1 { font-size:23px; font-weight:600; letter-spacing:-.01em; color:#1D1D1F; margin:0 0 6px; }
    .masthead .date { font-size:14px; color:#6E6E73; margin:0; }
    .divider { border:none; border-top:1px solid #E5E3DE; margin:40px 0; }
    .section-eyebrow { margin:0; font-size:19px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; text-align:center; }
    .section-headline { margin:8px 0 0; font-size:14px; font-weight:500; color:#6E6E73; text-align:center; }
    .kpi-table { width:100%; border-collapse:collapse; margin-top:22px; font-size:14px; }
    .kpi-table th { text-align:left; padding:0 0 8px; font-size:10.5px; font-weight:600; letter-spacing:.04em;
      text-transform:uppercase; color:#8A8A8F; border-bottom:1px solid #E5E3DE; }
    .kpi-table td { padding:10px 0; border-bottom:1px solid #EFEDE8; vertical-align:top; }
    .kpi-table tr:last-child td { border-bottom:none; }
    .task-name { font-weight:500; color:#1D1D1F; }
    .footer p { margin:0; font-size:12px; color:#8A8A8F; text-align:center; }
    .footer a { color:${ACCENT}; text-decoration:none; }
    .footer .ted { margin:10px 0 0; font-size:22px; font-weight:800; letter-spacing:.18em; color:#1D1D1F; text-align:center; }
    @media (max-width:480px) {
      .email-container { padding:28px 20px; }
      .masthead h1 { font-size:20px; }
    }`;

function sectionHead(color, label, headlineHtml) {
  return `<p class="section-eyebrow" style="color:${color}">${label}</p>` +
    `<p class="section-headline">${headlineHtml}</p>`;
}

function renderCompletedToday(tasks) {
  if (!tasks.length) return `<div>${sectionHead(GREEN, 'Completed Today', 'Nothing closed today')}</div>`;
  const rowsHtml = tasks.map(t =>
    `<tr><td><span class="task-name">${escapeHtml(shorten(t.task, 90))}</span></td>` +
    `<td>${escapeHtml(t.assignee)}</td><td>${fmtDate(t.createdAt)}</td><td>${fmtDate(t.completedAt)}</td></tr>`
  ).join('');
  return `<div>` +
    sectionHead(GREEN, 'Completed Today', `<b>${tasks.length}</b> task${tasks.length === 1 ? '' : 's'} closed today`) +
    `<table class="kpi-table"><tr><th>Task</th><th>Assignee</th><th>Created</th><th>Completed</th></tr>` +
    `${rowsHtml}</table></div>`;
}

function renderPending(tasks) {
  if (!tasks.length) return `<div>${sectionHead(GREEN, 'Pending', 'Nothing pending — the board is clear')}</div>`;
  const rowsHtml = tasks.map(t =>
    `<tr><td><span class="task-name">${escapeHtml(shorten(t.task, 90))}</span></td>` +
    `<td>${escapeHtml(t.assignee)}</td><td>${fmtDate(t.createdAt)}</td></tr>`
  ).join('');
  return `<div>` +
    sectionHead(AMBER, 'Pending', `<b>${tasks.length}</b> task${tasks.length === 1 ? '' : 's'} still open`) +
    `<table class="kpi-table"><tr><th>Task</th><th>Assignee</th><th>Created</th></tr>` +
    `${rowsHtml}</table></div>`;
}

function renderHtml(pending, completedToday, fullDate) {
  return `<div class="email-container">` +
    `<div class="masthead"><p class="eyebrow">Daily Update</p>` +
    `<h1>Client Website Tasks</h1><p class="date">${fullDate}</p></div>` +
    `<hr class="divider">` +
    renderCompletedToday(completedToday) + `<hr class="divider">` +
    renderPending(pending) + `<hr class="divider">` +
    `<div class="footer"><p>Automated E-mail from the Client Website Tasks Asana project.</p>` +
    `<p class="ted">TED</p></div></div>`;
}

function renderPage(pending, completedToday, fullDate) {
  return `<!doctype html><html><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<title>Client Website Tasks &middot; Daily Update</title><style>${STYLE}</style></head>` +
    `<body>${renderHtml(pending, completedToday, fullDate)}</body></html>`;
}

/* `testTo`, when set, replaces the real recipient with a single address — for
   confirming a change before it goes to the real list. Still gated by
   CRON_SECRET like everything else here. */
async function sendEmail(subject, html, testTo) {
  const fallbackTo = 'rahul.sharma@okiedokiepay.com';
  const to = testTo ? [testTo]
    : (process.env.WEBSITE_TASKS_TO || fallbackTo).split(',').map(s => s.trim()).filter(Boolean);

  const r = await fetch(process.env.ZEPTOMAIL_URL || 'https://api.zeptomail.in/v1.1/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.ZEPTOMAIL_TOKEN || '',
    },
    body: JSON.stringify({
      from: { address: process.env.ZEPTOMAIL_SENDER || '' },
      to: to.map(address => ({ email_address: { address } })),
      subject,
      htmlbody: html,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`ZeptoMail answered ${r.status}: ${JSON.stringify(data)}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

module.exports = async (req, res) => {
  // Accepts CRON_SECRET (what Vercel Cron itself will send once scheduled) or
  // INSPECT_SECRET (a plain env var, unlike CRON_SECRET's write-only "Secret"
  // type in Vercel, so its value can actually be confirmed/shared for a
  // one-off manual test before a schedule is wired up).
  const auth = req.headers.authorization || '';
  const okCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  const okInspect = process.env.INSPECT_SECRET && auth === `Bearer ${process.env.INSPECT_SECRET}`;
  if (!okCron && !okInspect) {
    return res.status(404).end();
  }

  const testParam = Array.isArray(req.query.test) ? req.query.test[0] : req.query.test;
  const testTo = typeof testParam === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testParam)
    ? testParam : null;

  try {
    // Same reasoning as daily-digest.js: not derived from req.headers.host,
    // since Vercel Cron sometimes hits the protected *.vercel.app alias
    // instead of the custom domain.
    const baseUrl = process.env.DIGEST_BASE_URL || 'https://cskpi.oderp.in';
    const r = await fetch(`${baseUrl}/api/data?src=websiteTasks&t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`websiteTasks: HTTP ${r.status}`);
    const csv = await r.text();

    const tasks = parseWebsiteTasks(csv);
    const today = iso(new Date());
    const pending = tasks.filter(t => !t.completed)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const completedToday = tasks.filter(t => t.completed && t.completedAt && iso(t.completedAt) === today)
      .sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
    const dateStr = new Date().toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const subject = `Client Website Tasks — ${pending.length} pending, ${completedToday.length} completed today`;
    await sendEmail(subject, renderPage(pending, completedToday, dateStr), testTo);

    return res.status(200).json({
      ok: true, pending: pending.length, completedToday: completedToday.length, testTo: testTo || undefined,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
