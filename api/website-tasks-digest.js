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

const ACCENT = '#B5501C';

function taskRowsHtml(tasks, showCompleted) {
  return tasks.map(t => {
    const cells = [
      `<td style="padding:9px 0;border-bottom:1px solid #EFEDE8;vertical-align:top;">${escapeHtml(shorten(t.task, 90))}</td>`,
      `<td style="padding:9px 0;border-bottom:1px solid #EFEDE8;vertical-align:top;">${escapeHtml(t.assignee)}</td>`,
      `<td style="padding:9px 0;border-bottom:1px solid #EFEDE8;vertical-align:top;white-space:nowrap;">${fmtDate(t.createdAt)}</td>`,
    ];
    if (showCompleted) cells.push(
      `<td style="padding:9px 0;border-bottom:1px solid #EFEDE8;vertical-align:top;white-space:nowrap;">${fmtDate(t.completedAt)}</td>`);
    return `<tr>${cells.join('')}</tr>`;
  }).join('');
}

function tableHtml(title, count, tasks, showCompleted, emptyText) {
  const headCols = showCompleted
    ? ['Task', 'Assignee', 'Created', 'Completed']
    : ['Task', 'Assignee', 'Created'];
  const headHtml = headCols.map(h =>
    `<th style="text-align:left;padding:0 0 8px;font-size:10.5px;font-weight:600;letter-spacing:.04em;` +
    `text-transform:uppercase;color:#8A8A8F;border-bottom:1px solid #E5E3DE;">${h}</th>`).join('');
  return `<h2 style="font-size:15px;font-weight:600;margin:26px 0 10px;">${escapeHtml(title)} ` +
    `<span style="color:#8A8A8F;font-weight:400;">(${count})</span></h2>` +
    (tasks.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:13.5px;">` +
        `<tr>${headHtml}</tr>${taskRowsHtml(tasks, showCompleted)}</table>`
      : `<p style="font-size:13.5px;color:#8A8A8F;margin:0;">${emptyText}</p>`);
}

function renderHtml(pending, completedToday, dateStr) {
  return `<div style="max-width:640px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1D1D1F;">` +
    `<p style="font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:${ACCENT};margin:0 0 6px;">Client Website Tasks</p>` +
    `<h1 style="font-size:22px;font-weight:600;margin:0 0 4px;">Daily Update</h1>` +
    `<p style="font-size:14px;color:#6E6E73;margin:0 0 8px;">${dateStr}</p>` +
    tableHtml('Completed today', completedToday.length, completedToday, true, 'Nothing closed today.') +
    tableHtml('Pending', pending.length, pending, false, 'Nothing pending — the board is clear.') +
    `<p style="margin-top:24px;font-size:12px;color:#8A8A8F;">Automated e-mail from the Client Website Tasks Asana project. ` +
    `Pending lists every open task on the board, not just today's.</p></div>`;
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
    await sendEmail(subject, renderHtml(pending, completedToday, dateStr), testTo);

    return res.status(200).json({
      ok: true, pending: pending.length, completedToday: completedToday.length, testTo: testTo || undefined,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
