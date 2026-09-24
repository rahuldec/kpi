// Sends an implementation follow-up digest by email via ZeptoMail: incomplete
// tasks across every project in the "Client Implementation" Asana portfolio
// that are either overdue or due within the next 7 days. Meant to be
// triggered by a Vercel Cron entry in vercel.json — never called directly by
// the dashboard itself.
//
// Pulls from api/data.js's `implementationFollowUp` source (see
// grabAsanaImplementationFollowUp there), which fans out across the same
// "Client Implementation" portfolio the dashboard's own overdue-count source
// reads, but keeps the individual tasks instead of collapsing to a count —
// same OAuth app and ASANA_* env vars as every other Asana-backed source on
// this deployment, nothing new to configure there.
//
// Security: same gate as the other digests — accepts CRON_SECRET (what
// Vercel Cron sends once scheduled) or INSPECT_SECRET (a plain, shareable env
// var for one-off manual tests before a schedule is wired up).

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

/* Same shape as grabAsanaImplementationFollowUp's CSV: Project, Task,
   Assignee, Due Date, Status ("Overdue" or "Due Soon" — the source only ever
   emits those two, so nothing else needs to be checked for here). */
function parseFollowUp(csv) {
  const rows = splitRows(csv, ',');
  if (!rows.length) return [];
  const [head, ...rest] = rows;
  const ix = {
    project: head.indexOf('Project'), task: head.indexOf('Task'),
    assignee: head.indexOf('Assignee'), due: head.indexOf('Due Date'), status: head.indexOf('Status'),
  };
  const out = [];
  for (const r of rest) {
    if (!r || !r[ix.task]) continue;
    out.push({
      project: (r[ix.project] || '').trim(),
      task: (r[ix.task] || '').trim(),
      assignee: (r[ix.assignee] || 'Unassigned').trim() || 'Unassigned',
      due: (r[ix.due] || '').trim(),
      status: (r[ix.status] || '').trim(),
    });
  }
  return out;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtShort = iso => iso
  ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

/* Same template family as the other three digests — one accent, RED/AMBER as
   semantic status colors, hairline dividers, centered section eyebrow+
   headline pairs, the same kpi-table shapes. */
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
    .masthead h1 { font-size:23px; font-weight:600; letter-spacing:-.01em; color:#1D1D1F; margin:0 0 6px; }
    .masthead .date { font-size:14px; color:#6E6E73; margin:0; }
    .divider { border:none; border-top:1px solid #E5E3DE; margin:40px 0; }
    .section-eyebrow { margin:0; font-size:19px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; text-align:center; }
    .section-headline { margin:8px 0 0; font-size:14px; font-weight:500; color:#6E6E73; text-align:center; }
    .kpi-table { width:100%; table-layout:fixed; border-collapse:collapse; margin-top:22px; font-size:14px; }
    .kpi-table th { text-align:left; padding:0 8px 8px 0; font-size:10.5px; font-weight:600; letter-spacing:.04em;
      text-transform:uppercase; color:#8A8A8F; border-bottom:1px solid #E5E3DE; white-space:nowrap; }
    .kpi-table th:last-child, .kpi-table td:last-child { padding-right:0; }
    .kpi-table td { padding:10px 8px 10px 0; border-bottom:1px solid #EFEDE8; vertical-align:top; word-break:break-word; }
    .kpi-table tr:last-child td { border-bottom:none; }
    .kpi-table .nowrap { white-space:nowrap; overflow:hidden; }
    .text-danger { color:${RED}; font-weight:600; }
    .text-amber { color:${AMBER}; font-weight:600; }
    .project-name { font-weight:600; color:#1D1D1F; }
    .task-name { color:#4B5563; }
    .footer p { margin:0; font-size:12px; color:#8A8A8F; text-align:center; }
    .footer a { color:${ACCENT}; text-decoration:none; }
    @media (max-width:480px) {
      .email-container { padding:28px 20px; }
      .masthead h1 { font-size:20px; }
    }`;

function sectionHead(color, label, headlineHtml) {
  return `<p class="section-eyebrow" style="color:${color}">${label}</p>` +
    `<p class="section-headline">${headlineHtml}</p>`;
}

const daysBetween = (fromISO, toISO) =>
  Math.round((new Date(toISO + 'T00:00:00') - new Date(fromISO + 'T00:00:00')) / 86400000);

const ROW_CAP = 8;

function renderOverdue(rows, today) {
  if (!rows.length) return `<div>${sectionHead(GREEN, 'Overdue', 'Nothing overdue')}</div>`;
  const sorted = [...rows].sort((a, b) => a.due.localeCompare(b.due)); // longest overdue first
  const shown = sorted.slice(0, ROW_CAP);
  const rowsHtml = shown.map(t => {
    const days = daysBetween(t.due, today);
    return `<tr><td><div class="project-name">${escapeHtml(t.project)}</div>` +
      `<div class="task-name">${escapeHtml(t.task)}</div></td>` +
      `<td class="nowrap">${escapeHtml(t.assignee)}</td>` +
      `<td class="nowrap text-danger">${days} day${days === 1 ? '' : 's'}</td></tr>`;
  }).join('');
  return `<div>` +
    sectionHead(RED, 'Overdue', `<b>${rows.length}</b> task${rows.length === 1 ? '' : 's'} past due`) +
    `<table class="kpi-table"><tr><th>Task</th><th width="110" style="width:110px">Owner</th>` +
    `<th width="70" style="width:70px">Overdue</th></tr>${rowsHtml}</table></div>`;
}

function renderDueSoon(rows) {
  if (!rows.length) return `<div>${sectionHead(GREEN, 'Due Soon', 'Nothing due in the next 7 days')}</div>`;
  const sorted = [...rows].sort((a, b) => a.due.localeCompare(b.due)); // soonest first
  const shown = sorted.slice(0, ROW_CAP);
  const rowsHtml = shown.map(t =>
    `<tr><td><div class="project-name">${escapeHtml(t.project)}</div>` +
    `<div class="task-name">${escapeHtml(t.task)}</div></td>` +
    `<td class="nowrap">${escapeHtml(t.assignee)}</td>` +
    `<td class="nowrap text-amber">${fmtShort(t.due)}</td></tr>`
  ).join('');
  return `<div>` +
    sectionHead(AMBER, 'Due Soon', `<b>${rows.length}</b> task${rows.length === 1 ? '' : 's'} due within 7 days`) +
    `<table class="kpi-table"><tr><th>Task</th><th width="110" style="width:110px">Owner</th>` +
    `<th width="70" style="width:70px">Due</th></tr>${rowsHtml}</table></div>`;
}

function renderHtml(overdue, dueSoon, fullDate, today) {
  return `<div class="email-container">` +
    `<div class="masthead"><h1>Implementation Follow-up</h1><p class="date">${fullDate}</p></div>` +
    `<hr class="divider">` +
    renderOverdue(overdue, today) + `<hr class="divider">` +
    renderDueSoon(dueSoon) + `<hr class="divider">` +
    `<div class="footer"><p>Automated E-mail from the Client Implementation Asana portfolio.</p></div></div>`;
}

function renderPage(overdue, dueSoon, fullDate, today) {
  return `<!doctype html><html><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<title>Implementation Follow-up</title><style>${STYLE}</style></head>` +
    `<body>${renderHtml(overdue, dueSoon, fullDate, today)}</body></html>`;
}

/* `testTo`, when set, replaces the real recipient with a single address and
   drops any CC — for confirming a change before it goes to the real list. */
async function sendEmail(subject, html, testTo) {
  const fallbackTo = 'customer-success-delight@okiedokiepay.com';
  const to = testTo ? [testTo]
    : (process.env.IMPL_FOLLOWUP_TO || fallbackTo).split(',').map(s => s.trim()).filter(Boolean);
  const cc = testTo ? [] : (process.env.IMPL_FOLLOWUP_CC || '').split(',').map(s => s.trim()).filter(Boolean);

  const r = await fetch(process.env.ZEPTOMAIL_URL || 'https://api.zeptomail.in/v1.1/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.ZEPTOMAIL_TOKEN || '',
    },
    body: JSON.stringify({
      from: { address: process.env.ZEPTOMAIL_SENDER || '', name: 'Implementation Follow-up' },
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

  try {
    const baseUrl = process.env.DIGEST_BASE_URL || 'https://cskpi.odpay.in';
    const r = await fetch(`${baseUrl}/api/data?src=implementationFollowUp&t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`implementationFollowUp: HTTP ${r.status}`);
    const csv = await r.text();

    const tasks = parseFollowUp(csv);
    const overdue = tasks.filter(t => t.status === 'Overdue');
    const dueSoon = tasks.filter(t => t.status === 'Due Soon');
    const today = new Date().toISOString().slice(0, 10);
    const fullDate = new Date().toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const subject = `${overdue.length} Overdue | ${dueSoon.length} Due Soon (Implementation)`;
    await sendEmail(subject, renderPage(overdue, dueSoon, fullDate, today), testTo);

    return res.status(200).json({
      ok: true, overdue: overdue.length, dueSoon: dueSoon.length, testTo: testTo || undefined,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
