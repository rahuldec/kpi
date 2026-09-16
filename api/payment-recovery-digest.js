// Sends the Payment Recovery 26-27 owner-wise summary by email via ZeptoMail.
// Triggered daily Mon-Sat at 10:00 AM IST by a Vercel Cron entry in
// vercel.json — never called directly by the dashboard itself.
//
// Pulls from api/data.js's `paymentRecovery` source (see grabAsanaPaymentRecovery
// there), which reads the "Payment Recovery 26-27" Asana project directly —
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

/* Same shape as grabAsanaPaymentRecovery's CSV: Client, Owner, Amount. Amount
   is whatever Asana's custom field display_value carries — usually a plain
   number, sometimes comma-grouped — so it's cleaned to digits/decimal only
   before summing rather than trusted as already-numeric. */
function parsePaymentRecovery(csv) {
  const rows = splitRows(csv, ',');
  if (!rows.length) return [];
  const [head, ...rest] = rows;
  const ix = { client: head.indexOf('Client'), owner: head.indexOf('Owner'), amount: head.indexOf('Amount') };
  const out = [];
  for (const r of rest) {
    if (!r || r.length < 2) continue;
    const client = (r[ix.client] || '').trim();
    if (!client) continue;
    const owner = (r[ix.owner] || 'Unassigned').trim() || 'Unassigned';
    const raw = (r[ix.amount] || '').replace(/[^0-9.]/g, '');
    const amount = raw ? Number(raw) : null;
    out.push({ client, owner, amount });
  }
  return out;
}

/* One row per owner, accounts sorted by name within it — same grouping the
   Asana list view itself shows, just recomputed here so the email doesn't
   depend on Asana's own group order. */
function groupByOwner(accounts) {
  const byOwner = new Map();
  for (const a of accounts) {
    if (!byOwner.has(a.owner)) byOwner.set(a.owner, []);
    byOwner.get(a.owner).push(a);
  }
  const owners = [...byOwner.keys()].sort((a, b) => a.localeCompare(b));
  return owners.map(owner => {
    const rows = byOwner.get(owner).sort((a, b) => a.client.localeCompare(b.client));
    const total = rows.reduce((sum, r) => sum + (r.amount || 0), 0);
    return { owner, rows, total };
  });
}

const inr = n => n.toLocaleString('en-IN');
const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Same look as api/daily-digest.js's own STYLE/ACCENT/sectionHead — duplicated
   rather than shared for the same reason noted at the top of that file: no
   module system connects these two serverless functions, and each is meant to
   read as one self-contained deployment unit. Keep the two in sync by eye if
   the shared template ever changes; there is nothing that enforces it. */
const ACCENT = '#B5501C';

const STYLE = `
    * { margin:0; padding:0; box-sizing:border-box;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; }
    body { background:#F5F4F1; padding:40px 16px; color:#1D1D1F; }
    .email-container { max-width:600px; width:100%; margin:0 auto; background:#FFFFFF;
      border:1px solid #E5E3DE; border-radius:12px; padding:36px 32px; }
    .masthead { text-align:center; margin-bottom:28px; }
    .masthead .eyebrow { font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase;
      color:${ACCENT}; margin:0 0 10px; }
    .masthead h1 { font-size:30px; font-weight:700; letter-spacing:-.01em; color:#1D1D1F; margin:0 0 6px; }
    .masthead .date { font-size:14px; color:#6E6E73; margin:0; }
    .divider { border:none; border-top:1px solid #E5E3DE; margin:40px 0; }
    .section-eyebrow { margin:0; font-size:19px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; text-align:center; }
    .section-headline { margin:8px 0 0; font-size:14px; font-weight:500; color:#6E6E73; text-align:center; }
    .kpi-table { width:100%; border-collapse:collapse; margin-top:22px; font-size:14px; }
    .kpi-table th { text-align:left; padding:0 0 8px; font-size:10.5px; font-weight:600; letter-spacing:.04em;
      text-transform:uppercase; color:#8A8A8F; border-bottom:1px solid #E5E3DE; }
    .kpi-table td { padding:10px 0; border-bottom:1px solid #EFEDE8; vertical-align:top; }
    .kpi-table tr:last-child td { border-bottom:none; }
    .text-right { text-align:right; }
    .owner-name { font-weight:600; color:#1D1D1F; }
    .client-list { color:#4B5563; }
    .total-row td { font-weight:700; border-top:1px solid #E5E3DE; border-bottom:none !important; padding-top:14px; }
    .footer p { margin:0; font-size:12px; color:#8A8A8F; text-align:center; }
    .footer a { color:${ACCENT}; text-decoration:none; }
    .footer .ted { margin:10px 0 0; font-size:22px; font-weight:800; letter-spacing:.18em; color:#1D1D1F; text-align:center; }
    @media (max-width:480px) {
      .email-container { padding:28px 20px; }
      .masthead h1 { font-size:25px; }
    }`;

function sectionHead(color, label, headlineHtml) {
  return `<p class="section-eyebrow" style="color:${color}">${label}</p>` +
    `<p class="section-headline">${headlineHtml}</p>`;
}

function renderHtml(groups, grandTotal, accountCount, fullDate) {
  const rowsHtml = groups.map(g => {
    const clients = g.rows.map(r => escapeHtml(r.client)).join(', ');
    return `<tr><td class="owner-name">${escapeHtml(g.owner)}</td>` +
      `<td class="client-list">${clients}</td>` +
      `<td class="text-right">${g.total ? '₹' + inr(g.total) : '—'}</td></tr>`;
  }).join('');

  return `<div class="email-container">` +
    `<div class="masthead">` +
    `<h1>Payment Recovery 26-27</h1><p class="date">${fullDate}</p></div>` +
    `<hr class="divider">` +
    `<div>` +
    sectionHead(ACCENT, 'Open Accounts',
      `<b>${accountCount}</b> account${accountCount === 1 ? '' : 's'} owed <b>₹${inr(grandTotal)}</b>`) +
    `<table class="kpi-table"><tr><th>Owner</th><th>Accounts</th><th class="text-right">Total</th></tr>` +
    rowsHtml +
    `<tr class="total-row"><td>Total</td><td>${accountCount} accounts</td><td class="text-right">₹${inr(grandTotal)}</td></tr>` +
    `</table></div>` +
    `<hr class="divider">` +
    `<div class="footer"><p>Automated E-mail from Payment Recovery 26-27 &middot; ` +
    `<a href="https://app.asana.com/1/480944584143449/project/1210353223733086/list/1210355814510279">View live on Asana</a>.</p>` +
    `<p class="ted">TED</p></div></div>`;
}

function renderPage(groups, grandTotal, accountCount, fullDate) {
  return `<!doctype html><html><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<title>Payment Recovery 26-27</title><style>${STYLE}</style></head>` +
    `<body>${renderHtml(groups, grandTotal, accountCount, fullDate)}</body></html>`;
}

/* `testTo`, when set, replaces the real recipient with a single address and
   drops the CC entirely — for confirming a change before it goes to the real
   list. Still gated by CRON_SECRET like everything else here. */
async function sendEmail(subject, html, testTo) {
  const fallbackTo = 'customer-success-delight@okiedokiepay.com';
  const fallbackCc = 'hr@okiedokiepay.com';
  const to = testTo ? [testTo]
    : (process.env.PAYMENT_RECOVERY_TO || fallbackTo).split(',').map(s => s.trim()).filter(Boolean);
  const cc = testTo ? []
    : (process.env.PAYMENT_RECOVERY_CC || fallbackCc).split(',').map(s => s.trim()).filter(Boolean);

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
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(404).end();
  }

  const testParam = Array.isArray(req.query.test) ? req.query.test[0] : req.query.test;
  const testTo = typeof testParam === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testParam)
    ? testParam : null;

  try {
    // Same reasoning as daily-digest.js: not derived from req.headers.host,
    // since Vercel Cron sometimes hits the protected *.vercel.app alias
    // instead of the custom domain.
    const baseUrl = process.env.DIGEST_BASE_URL || 'https://cskpi.odpay.in';
    const r = await fetch(`${baseUrl}/api/data?src=paymentRecovery&t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`paymentRecovery: HTTP ${r.status}`);
    const csv = await r.text();

    const accounts = parsePaymentRecovery(csv);
    const groups = groupByOwner(accounts);
    const grandTotal = groups.reduce((sum, g) => sum + g.total, 0);
    const fullDate = new Date().toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const subject = `Payment Recovery 26-27 — ${accounts.length} open accounts, ₹${inr(grandTotal)}`;
    await sendEmail(subject, renderPage(groups, grandTotal, accounts.length, fullDate), testTo);

    return res.status(200).json({ ok: true, accounts: accounts.length, total: grandTotal, testTo: testTo || undefined });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
