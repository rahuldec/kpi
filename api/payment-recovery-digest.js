// Sends the Payment Recovery 26-27 owner-wise summary by email via ZeptoMail.
// Triggered Mon/Wed/Sat by a Vercel Cron entry in vercel.json — never called
// directly by the dashboard itself.
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

const ACCENT = '#B5501C';

function renderHtml(groups, grandTotal, accountCount, dateStr) {
  const rowsHtml = groups.map(g => {
    const clients = g.rows.map(r => escapeHtml(r.client)).join(', ');
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #EFEDE8;vertical-align:top;font-weight:600;">${escapeHtml(g.owner)}</td>` +
      `<td style="padding:10px 0;border-bottom:1px solid #EFEDE8;vertical-align:top;">${clients}</td>` +
      `<td style="padding:10px 0;border-bottom:1px solid #EFEDE8;vertical-align:top;text-align:right;">${g.total ? '₹' + inr(g.total) : '—'}</td></tr>`;
  }).join('');
  return `<div style="max-width:640px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1D1D1F;">` +
    `<p style="font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:${ACCENT};margin:0 0 6px;">Payment Recovery 26-27</p>` +
    `<h1 style="font-size:22px;font-weight:600;margin:0 0 4px;">Owner-wise Summary</h1>` +
    `<p style="font-size:14px;color:#6E6E73;margin:0 0 20px;">${dateStr}</p>` +
    `<table style="width:100%;border-collapse:collapse;font-size:14px;">` +
    `<tr><th style="text-align:left;padding:0 0 8px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#8A8A8F;border-bottom:1px solid #E5E3DE;">Owner</th>` +
    `<th style="text-align:left;padding:0 0 8px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#8A8A8F;border-bottom:1px solid #E5E3DE;">Accounts</th>` +
    `<th style="text-align:right;padding:0 0 8px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#8A8A8F;border-bottom:1px solid #E5E3DE;">Total</th></tr>` +
    rowsHtml +
    `<tr><td style="padding:12px 0 0;font-weight:700;">Total</td><td style="padding:12px 0 0;font-weight:700;">${accountCount} accounts</td>` +
    `<td style="padding:12px 0 0;font-weight:700;text-align:right;">₹${inr(grandTotal)}</td></tr>` +
    `</table>` +
    `<p style="margin-top:20px;font-size:12px;color:#8A8A8F;">Automated e-mail from the Payment Recovery 26-27 Asana project. ` +
    `Accounts with no "Amount in INR" custom field set show as &mdash;.</p></div>`;
}

/* `testTo`, when set, replaces the real recipient with a single address — for
   confirming a change before it goes to the real list. Still gated by
   CRON_SECRET like everything else here. */
async function sendEmail(subject, html, testTo) {
  const fallbackTo = 'rahul.sharma@okiedokiepay.com';
  const to = testTo ? [testTo]
    : (process.env.PAYMENT_RECOVERY_TO || fallbackTo).split(',').map(s => s.trim()).filter(Boolean);

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
    const dateStr = new Date().toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const subject = `Payment Recovery 26-27 — ${accounts.length} open accounts, ₹${inr(grandTotal)}`;
    await sendEmail(subject, renderHtml(groups, grandTotal, accounts.length, dateStr), testTo);

    return res.status(200).json({ ok: true, accounts: accounts.length, total: grandTotal, testTo: testTo || undefined });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
