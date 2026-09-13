// Sends the PEX "Pending at RM" list by email via ZeptoMail: every task in
// that section of the "PEX Team - Daily Problems" project that isn't marked
// complete yet. Triggered by a Vercel Cron entry in vercel.json — never
// called directly by the dashboard itself.
//
// Pulls from api/data.js's `pexPending` source (see grabAsanaPexPending
// there), which reads the PEX project directly — same OAuth app and ASANA_*
// env vars as every other Asana-backed source on this deployment, nothing
// new to configure there.
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

/* Same shape as grabAsanaPexPending's CSV: Task, Assignee, Module,
   Created At. Already filtered to "Pending at RM" + incomplete server-side,
   so nothing here needs to filter again — just parse and sort. */
function parsePexPending(csv) {
  const rows = splitRows(csv, ',');
  if (!rows.length) return [];
  const [head, ...rest] = rows;
  const ix = {
    task: head.indexOf('Task'), assignee: head.indexOf('Assignee'),
    module: head.indexOf('Module'), created: head.indexOf('Created At'),
  };
  const out = [];
  for (const r of rest) {
    if (!r || !r[ix.task]) continue;
    out.push({
      task: (r[ix.task] || '').trim(),
      assignee: (r[ix.assignee] || 'Unassigned').trim() || 'Unassigned',
      module: (r[ix.module] || '').trim(),
      createdAt: r[ix.created] ? new Date(r[ix.created]) : null,
    });
  }
  return out;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shorten = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
const fmtDate = d => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

/* Same template as api/daily-digest.js/api/website-tasks-digest.js — one
   accent for structure, AMBER/GREEN as semantic status colors, hairline
   dividers, centered section eyebrow+headline, the same kpi-table/footer
   shapes, so this reads as the same family of email. */
const ACCENT = '#B5501C';
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
    .kpi-table { width:100%; table-layout:fixed; border-collapse:collapse; margin-top:22px; font-size:14px; }
    .kpi-table th { text-align:left; padding:0 8px 8px 0; font-size:10.5px; font-weight:600; letter-spacing:.04em;
      text-transform:uppercase; color:#8A8A8F; border-bottom:1px solid #E5E3DE; white-space:nowrap; }
    .kpi-table th:last-child, .kpi-table td:last-child { padding-right:0; }
    .kpi-table td { padding:10px 8px 10px 0; border-bottom:1px solid #EFEDE8; vertical-align:top; }
    .kpi-table tr:last-child td { border-bottom:none; }
    .kpi-table .nowrap { white-space:nowrap; overflow:hidden; }
    .task-name { font-weight:500; color:#1D1D1F; word-break:break-word; }
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

function renderPending(tasks) {
  if (!tasks.length) return `<div>${sectionHead(GREEN, 'Pending at RM', 'Nothing pending — the board is clear')}</div>`;
  const rowsHtml = tasks.map(t => {
    const taskText = shorten(t.task, 90) + (t.module ? ` (${t.module})` : '');
    return `<tr><td><span class="task-name">${escapeHtml(taskText)}</span></td>` +
      `<td class="nowrap">${escapeHtml(t.assignee)}</td>` +
      `<td class="nowrap">${fmtDate(t.createdAt)}</td></tr>`;
  }).join('');
  return `<div>` +
    sectionHead(AMBER, 'Pending at RM', `<b>${tasks.length}</b> task${tasks.length === 1 ? '' : 's'} still open`) +
    `<table class="kpi-table"><tr><th>Task</th><th width="110" style="width:110px">RM</th>` +
    `<th width="60" style="width:60px">Created</th></tr>` +
    `${rowsHtml}</table></div>`;
}

function renderHtml(pending, fullDate) {
  return `<div class="email-container">` +
    `<div class="masthead"><p class="eyebrow">Daily Update</p>` +
    `<h1>PEX Team - Daily Problems</h1><p class="date">${fullDate}</p></div>` +
    `<hr class="divider">` +
    renderPending(pending) + `<hr class="divider">` +
    `<div class="footer"><p>Automated E-mail from the PEX Team - Daily Problems Asana project.</p>` +
    `<p class="ted">TED</p></div></div>`;
}

function renderPage(pending, fullDate) {
  return `<!doctype html><html><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<title>PEX Team &middot; Pending at RM</title><style>${STYLE}</style></head>` +
    `<body>${renderHtml(pending, fullDate)}</body></html>`;
}

/* `testTo`, when set, replaces the real recipient with a single address and
   drops any CC. `toOverride`/`ccOverride`, when set (and testTo is not),
   send to those addresses instead of the standing PEX_PENDING_TO/_CC env
   vars — for a one-off real send without touching the standing config.
   Still gated by CRON_SECRET/INSPECT_SECRET like everything else here. */
async function sendEmail(subject, html, testTo, toOverride, ccOverride) {
  const fallbackTo = 'rahul.sharma@okiedokiepay.com';
  const to = testTo ? [testTo]
    : toOverride || (process.env.PEX_PENDING_TO || fallbackTo).split(',').map(s => s.trim()).filter(Boolean);
  const cc = testTo ? [] : ccOverride || (process.env.PEX_PENDING_CC || '').split(',').map(s => s.trim()).filter(Boolean);

  const r = await fetch(process.env.ZEPTOMAIL_URL || 'https://api.zeptomail.in/v1.1/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.ZEPTOMAIL_TOKEN || '',
    },
    body: JSON.stringify({
      from: { address: process.env.ZEPTOMAIL_SENDER || '' },
      to: to.map(address => ({ email_address: { address } })),
      cc: cc.map(address => ({ email_address: { address } })),
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
  const auth = req.headers.authorization || '';
  const okCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  const okInspect = process.env.INSPECT_SECRET && auth === `Bearer ${process.env.INSPECT_SECRET}`;
  if (!okCron && !okInspect) {
    return res.status(404).end();
  }

  const testParam = Array.isArray(req.query.test) ? req.query.test[0] : req.query.test;
  const testTo = typeof testParam === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testParam)
    ? testParam : null;

  const emailList = v => (Array.isArray(v) ? v[0] : v || '')
    .split(',').map(s => s.trim()).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  const toOverride = req.query.to ? emailList(req.query.to) : null;
  const ccOverride = req.query.cc ? emailList(req.query.cc) : null;

  try {
    // Same reasoning as daily-digest.js: not derived from req.headers.host,
    // since Vercel Cron sometimes hits the protected *.vercel.app alias
    // instead of the custom domain.
    const baseUrl = process.env.DIGEST_BASE_URL || 'https://cskpi.oderp.in';
    const r = await fetch(`${baseUrl}/api/data?src=pexPending&t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`pexPending: HTTP ${r.status}`);
    const csv = await r.text();

    const pending = parsePexPending(csv).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const dateStr = new Date().toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const subject = `PEX Team - Daily Problems — ${pending.length} pending at RM`;
    await sendEmail(subject, renderPage(pending, dateStr), testTo, toOverride, ccOverride);

    return res.status(200).json({
      ok: true, pending: pending.length,
      testTo: testTo || undefined, to: toOverride || undefined, cc: ccOverride || undefined,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
