// Sends the daily "who hasn't filed" compliance digest by email via ZeptoMail.
// Triggered once a day by a Vercel Cron entry in vercel.json — never called
// directly by the dashboard itself.
//
// Reports on the most recent working day strictly before today (skipping
// Sundays and company holidays), not literal "yesterday" — sending an empty
// digest about a Sunday every Monday would train everyone to ignore it.
//
// This duplicates a handful of constants from index.html (HOLIDAYS, LEAVE_RAW,
// HIDDEN, EXEMPT, MANUAL_ROSTER) rather than sharing them, because index.html
// has no module system to import from and this endpoint has no browser to run
// in. If one of those lists changes there, it must be changed here too — see
// the comment on each for where the original lives.
//
// Security: this endpoint sends real email to real people, so it refuses to
// run unless called with the same secret Vercel Cron is configured to send.
// Hitting it without that secret does nothing rather than erroring loudly,
// so a scan of this URL by an outsider learns nothing about whether it exists.

// Kept in sync with index.html's own HOLIDAYS — see the comment there for why
// each date is on the list.
const HOLIDAYS = new Set([
  '2026-08-15', '2026-08-28', '2026-10-02', '2026-10-20',
  '2026-11-06', '2026-11-07', '2026-11-09', '2026-12-25',
]);

// Kept in sync with index.html's own LEAVE_RAW. Same limitation applies here
// as there: this is a snapshot from a Zoho People export taken 17 Aug 2026,
// only covering July 2026 — leave taken after that will not be excused until
// a fresh export is imported into both places.
const LEAVE_RAW = {"Amar Kumar Pandit":["2026-07-08","2026-07-24","2026-07-25"],"Anjali Verma":["2026-07-20","2026-07-30"],"Ankush Rana":["2026-07-01","2026-07-24","2026-07-25","2026-09-04"],"Ashish Kumar":["2026-07-03","2026-07-06","2026-07-17"],"Ayush Garg":["2026-07-03","2026-07-04","2026-07-05","2026-07-06","2026-07-20"],"Divya Gupta":["2026-07-06","2026-07-31","2026-09-04"],"Gobind Monga":["2026-07-02"],"Kashish Goel":["2026-07-13","2026-07-27","2026-09-04"],"Lokesh Kumar":["2026-07-10","2026-07-27","2026-09-04"],"Mansi Rana":["2026-07-08"],"Mehak Garg":["2026-07-23","2026-07-24"],"Mithilesh Kumar":["2026-07-06","2026-07-07","2026-07-16"],"Priya":["2026-07-17","2026-09-04"],"Rahul Sharma":["2026-07-31"],"Sagar Mishra":["2026-07-14"],"Shobhit Sehra":["2026-07-09","2026-07-16","2026-07-29"],"Sukhmeet Singh":["2026-07-17"],"Sumaiya Khan":["2026-07-07","2026-07-10","2026-07-17"]};

// Kept in sync with index.html's own HIDDEN — people not part of the CS team
// being measured at all.
const HIDDEN = ['rahul sharma', 'aman sharma', 'amar kumar pandit'];

// Kept in sync with index.html's own EXEMPT — on the team, but not expected
// to file to a given tracker.
const EXEMPT = {
  internal: ['bhavey saluja'],
  client:   ['sagar mishra', 'sumaiya khan', 'bhavey saluja', 'mehak garg'],
};

// Kept in sync with index.html's own MANUAL_ROSTER — on the roster despite
// having filed nothing yet, so they still show up rather than being invisible
// until their first entry.
const MANUAL_ROSTER = ['Bhavey Saluja'];

const TRACKERS = ['internal', 'client'];
const TRACKER_LABEL = { internal: 'internal calls', client: 'client calls' };

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isWorkingDay = d => d.getDay() !== 0 && !HOLIDAYS.has(iso(d));

const LEAVE_DAYS = new Map(
  Object.entries(LEAVE_RAW).map(([name, days]) => [name.toLowerCase(), new Set(days)]));
const onLeave = (name, day) => LEAVE_DAYS.get(String(name).toLowerCase())?.has(day) === true;

/* Walks back from today to the most recent day that was actually a working
   day — skips weekends and holidays so a Monday morning digest reports on
   Friday, not on an empty Sunday nobody was ever expected to file on. */
function lastWorkingDay() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (!isWorkingDay(d)) d.setDate(d.getDate() - 1);
  return iso(d);
}

// Kept in sync with index.html's own tc() — title-cases a name derived from
// an email local-part (see the fallback in parseExport below).
const tc = s => s.split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');

/* Same shape as index.html's parseExport: find the header row with "Due
   Date" and "Assignee", then one {name, due} per row after it. Duplicated
   rather than shared for the same reason as the constants above.

   Some Asana profiles have no display name set, so the Assignee column comes
   back as their email instead — index.html derives a name from the email's
   local part rather than dropping the row, and this must match or anyone in
   that situation (e.g. Sapna) is silently invisible to the digest: not just
   never flagged as missing, but absent from the roster entirely, no matter
   what day is checked. */
function parseExport(text) {
  const dl = (text.split('\n')[0].match(/\t/g) || []).length >= 2 ? '\t' : ',';
  const rows = splitRows(text, dl);
  let head = -1, ix = {};
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = rows[i].map(x => x.trim().toLowerCase());
    const d = h.indexOf('due date'), a = h.indexOf('assignee');
    if (d > -1 && a > -1) { head = i; ix = { due: d, name: a, email: h.indexOf('assignee email') }; break; }
  }
  if (head < 0) throw new Error('Could not find a header row with "Due Date" and "Assignee".');
  const out = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r || r.length < 2) continue;
    const due = r[ix.due] || '';
    let name = (r[ix.name] || '').trim();
    if (!name || name.includes('@')) {
      name = tc(((ix.email > -1 ? r[ix.email] : '') || name || '').split('@')[0].replace(/[._-]+/g, ' '));
    }
    if (!due || !name) continue;
    out.push({ name, due: due.slice(0, 10) });
  }
  return out;
}

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

async function fetchRaw(baseUrl, src) {
  const r = await fetch(`${baseUrl}/api/data?src=${src}&t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
  return r.text();
}

async function fetchTracker(baseUrl, src) {
  return parseExport(await fetchRaw(baseUrl, src));
}

const ESC_PROJECT = 'client escalations';

/* Same row shape as index.html's parseEscalations, trimmed to just what the
   digest needs: which clients have an escalation still open (no Completed At),
   who owns it, and when it was raised. No client-book/alias matching here —
   that's for attributing an escalation to a revenue-owning lead on the
   dashboard's team cards, which this email has no use for; the raw client
   string Asana carries is informative enough for a compliance list. */
function parseEscalations(text) {
  const rows = splitRows(text, ',');
  let head = -1, ix = {};
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = rows[i].map(x => String(x).trim().toLowerCase());
    const p = h.indexOf('projects');
    if (p > -1 && h.indexOf('parent task') > -1) {
      head = i;
      ix = { projects: p, parent: h.indexOf('parent task'), name: h.indexOf('name'),
             owner: h.indexOf('assignee'), created: h.indexOf('created at'), done: h.indexOf('completed at') };
      break;
    }
  }
  if (head < 0) return [];
  const out = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r || r.length < 2) continue;
    if ((r[ix.parent] || '').trim()) continue;   // a sub-task, not an escalation
    if ((r[ix.done] || '').trim()) continue;     // already closed
    const projects = (r[ix.projects] || '').split(',').map(x => x.trim()).filter(Boolean);
    const client = projects.find(x => x.toLowerCase() !== ESC_PROJECT) || (r[ix.name] || '').trim();
    if (!client) continue;
    out.push({ client, owner: (r[ix.owner] || '').trim(), raised: (r[ix.created] || '').slice(0, 10) });
  }
  return out;
}

/* Same row shape as index.html's parseImplementation, trimmed to just the
   projects that currently have overdue tasks — the only implementation state
   worth interrupting someone's morning for. */
function parseImplementation(text) {
  const rows = splitRows(text, ',');
  let head = -1, ix = {};
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = rows[i].map(x => String(x).trim().toLowerCase());
    const owner = h.indexOf('owner'), overdue = h.indexOf('overdue');
    if (owner > -1 && overdue > -1) {
      head = i;
      ix = { name: h.indexOf('name'), owner, overdue };
      break;
    }
  }
  if (head < 0) return [];
  const out = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const name = (r[ix.name] || '').trim(); if (!name) continue;
    const overdue = Number(r[ix.overdue]) || 0;
    if (overdue > 0) out.push({ name, owner: (r[ix.owner] || '').trim(), overdue });
  }
  return out;
}

const daysBetween = (fromISO, toISO) =>
  Math.round((new Date(toISO + 'T00:00:00') - new Date(fromISO + 'T00:00:00')) / 86400000);

/* Everyone who has ever filed to either tracker, plus MANUAL_ROSTER, minus
   HIDDEN — the same roster index.html's buildRoster() derives, without the
   canonical-casing lookup against the Team tab (cosmetic only: it decides how
   a name is capitalised, never who is on the roster). */
function buildRoster(byTracker) {
  const roster = new Map();
  for (const src of TRACKERS)
    for (const r of byTracker[src]) {
      const key = r.name.toLowerCase();
      if (!roster.has(key)) roster.set(key, { name: r.name, first: r.due });
      else if (r.due < roster.get(key).first) roster.get(key).first = r.due;
    }
  for (const name of MANUAL_ROSTER) {
    const key = name.toLowerCase();
    if (!roster.has(key)) roster.set(key, { name, first: iso(new Date()) });
  }
  for (const key of [...roster.keys()]) if (HIDDEN.includes(key)) roster.delete(key);
  return roster;
}

// How far back to look when deciding whether a missed entry is a one-off or
// a pattern. 5 working days is a calendar week — long enough to catch someone
// drifting, short enough that a fix shows up in the count within a week.
const RECENT_WINDOW = 5;

/* The N most recent working days up to and including `day`, oldest first. */
function recentWorkingDays(day, n) {
  const out = [];
  const d = new Date(day + 'T00:00:00');
  while (out.length < n) {
    if (isWorkingDay(d)) out.unshift(iso(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

/* Which trackers each roster member missed on one specific day — the same
   per-day rule computeMissed used to apply only to its one reporting day,
   pulled out here so the recent-misses window below can reuse it without
   recomputing "not yet joined" / leave / exemption for every day by hand. */
function missedTrackersOn(byTracker, roster, day) {
  const filedBy = {};
  for (const src of TRACKERS)
    filedBy[src] = new Set(byTracker[src].filter(r => r.due === day).map(r => r.name.toLowerCase()));
  const out = new Map();
  for (const [key, person] of roster) {
    if (day < person.first) continue;           // not on the tracker yet that day
    if (onLeave(person.name, day)) continue;
    const missedTrackers = TRACKERS.filter(src =>
      !EXEMPT[src].includes(key) && !filedBy[src].has(key));
    if (missedTrackers.length) out.set(key, missedTrackers);
  }
  return out;
}

function computeMissed(byTracker, day) {
  const roster = buildRoster(byTracker);

  /* `day` is always the window's own last entry, so the day being reported on
     and the tally of how often each person has missed recently come out of
     the same set of per-day lookups rather than two separate passes. */
  const window = recentWorkingDays(day, RECENT_WINDOW);
  const missedByDay = new Map(window.map(d => [d, missedTrackersOn(byTracker, roster, d)]));

  const recentCounts = new Map();
  for (const dayMisses of missedByDay.values())
    for (const key of dayMisses.keys())
      recentCounts.set(key, (recentCounts.get(key) || 0) + 1);

  const missed = [];
  for (const [key, trackers] of missedByDay.get(day)) {
    missed.push({
      name: roster.get(key).name,
      trackers,
      recent: recentCounts.get(key) || 0,
      window: window.length,
    });
  }
  /* Alphabetical — a name is easier to find in a fixed, familiar order than
     to hunt for in a list that reshuffles by severity every day. The "Missed
     N times this week" note on each row still carries the pattern signal. */
  missed.sort((a, b) => a.name.localeCompare(b.name));
  return missed;
}

// How many rows the escalations table shows before folding the rest into a
// "+N more" line linking to the live dashboard. Implementation shows its
// full list instead — see renderImplementation.
const ROW_CAP = 5;

// A single accent color for structure (eyebrows, links, bold counts) — the
// clean/minimal direction deliberately drops per-section hues, pills, dots,
// gradients, and shadows. RED and GREEN remain as semantic status colors
// (something needs attention vs. nothing does), which is a different axis
// from the decorative accent and doesn't count against "one accent".
const ACCENT = '#B5501C';
const RED = '#A82A1C';
const AMBER = '#B8860B';
const BLUE = '#0071E3';
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
    .text-danger { color:${RED}; font-weight:600; }
    .text-right { text-align:right; }
    .missed-badge { font-size:11px; color:${RED}; margin-top:2px; opacity:.8; }
    .person-name { font-weight:600; color:#1D1D1F; }
    .more-note { padding:12px 0 0; font-size:12.5px; color:#6E6E73; }
    .more-note a { color:${ACCENT}; text-decoration:none; font-weight:500; }
    .footer p { margin:0; font-size:12px; color:#8A8A8F; text-align:center; }
    .footer a { color:${ACCENT}; text-decoration:none; }
    .footer .ted { margin:10px 0 0; font-size:22px; font-weight:800; letter-spacing:.18em; color:#1D1D1F; text-align:center; }
    @media (max-width:480px) {
      .email-container { padding:28px 20px; }
      .masthead h1 { font-size:20px; }
    }`;

function moreNote(remaining, kind) {
  return `<p class="more-note">+ ${remaining} additional ${kind} &middot; ` +
    `<a href="https://cskpi.odpay.in">View complete list on dashboard &rarr;</a></p>`;
}

function sectionHead(color, label, headlineHtml) {
  return `<p class="section-eyebrow" style="color:${color}">${label}</p>` +
    `<p class="section-headline">${headlineHtml}</p>`;
}

function renderEscalations(rows, today) {
  if (rows === null) return `<div>${sectionHead('#8A8A8F', 'Escalations', 'Data unavailable right now')}</div>`;
  if (!rows.length) return `<div>${sectionHead(GREEN, 'Escalations', 'No open escalations')}</div>`;
  const sorted = [...rows].sort((a, b) => (a.raised || '9999').localeCompare(b.raised || '9999'));
  const shown = sorted.slice(0, ROW_CAP);
  const rowsHtml = shown.map(e => {
    const days = e.raised ? daysBetween(e.raised, today) : null;
    const openFor = days === null ? '—' : `${days} day${days === 1 ? '' : 's'}`;
    return `<tr><td><span style="font-weight:500">${escapeHtml(e.client)}</span></td>` +
      `<td>${escapeHtml(e.owner || '—')}</td><td class="text-danger">${openFor}</td></tr>`;
  }).join('');
  const more = sorted.length > ROW_CAP ? moreNote(sorted.length - ROW_CAP, 'open escalations') : '';
  return `<div>` +
    sectionHead(AMBER, 'Escalations', `<b>${rows.length}</b> escalation${rows.length === 1 ? '' : 's'} still open`) +
    `<table class="kpi-table"><tr><th>Client</th><th>Owner</th><th>Open Duration</th></tr>` +
    `${rowsHtml}</table>${more}</div>`;
}

// Escalations fold past ROW_CAP into a "+N more" line (see moreNote); the
// implementation list shows every overdue project instead, per request —
// there's no dashboard link substituting for the full picture here.
function renderImplementation(rows) {
  if (rows === null) return `<div>${sectionHead('#8A8A8F', 'Implementation', 'Data unavailable right now')}</div>`;
  if (!rows.length) return `<div>${sectionHead(GREEN, 'Implementation', 'No projects have overdue tasks')}</div>`;
  const sorted = [...rows].sort((a, b) => b.overdue - a.overdue);
  const rowsHtml = sorted.map(p =>
    `<tr><td><span style="font-weight:500">${escapeHtml(p.name)}</span></td>` +
    `<td>${escapeHtml(p.owner || '—')}</td><td class="text-right text-danger">${p.overdue}</td></tr>`
  ).join('');
  return `<div>` +
    sectionHead(BLUE, 'Implementation',
      `<b>${rows.length}</b> project${rows.length === 1 ? '' : 's'} ${rows.length === 1 ? 'has' : 'have'} overdue tasks`) +
    `<table class="kpi-table"><tr><th>Project</th><th>Owner</th><th class="text-right">Overdue</th></tr>` +
    `${rowsHtml}</table></div>`;
}

function renderHtml(day, missed, escalations, overdueImpl) {
  const dateObj = new Date(day + 'T00:00:00');
  const fullDate = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Short form for the column header, so each row reads standalone without
  // scrolling back up to the opening sentence to know which day this is.
  const shortDate = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  const missedRowsHtml = missed.map(m => {
    /* Only worth calling out once it is a pattern, not a single slip — today's
       own miss already accounts for one of the count, so 2+ means at least
       one other day in the window went the same way. Plain "this week" reads
       faster than a fraction, and RECENT_WINDOW (5 working days) is a week. */
    const streak = m.recent >= 2 ? `<div class="missed-badge">Missed ${m.recent} times this week</div>` : '';
    return `<tr><td><div class="person-name">${escapeHtml(m.name)}</div>${streak}</td>` +
      `<td class="text-danger">${m.trackers.map(t => TRACKER_LABEL[t]).join(', ')}</td></tr>`;
  }).join('');
  const filingSection = missed.length
    ? `<div>${sectionHead(RED, 'Filing Compliance',
        `<b>${missed.length}</b> ${missed.length === 1 ? 'person' : 'people'} missed timesheet submission`)}` +
      `<table class="kpi-table"><tr><th>Person</th><th>Missed Area (${shortDate})</th></tr>` +
      `${missedRowsHtml}</table></div>`
    : `<div>${sectionHead(GREEN, 'Filing Compliance', `Everyone filed time sheet for ${fullDate}`)}</div>`;

  return `<div class="email-container">` +
    `<div class="masthead"><p class="eyebrow">CS Monitoring</p>` +
    `<h1>Daily Compliance &amp; Operations</h1><p class="date">${fullDate}</p></div>` +
    `<hr class="divider">` +
    filingSection + `<hr class="divider">` +
    renderEscalations(escalations, iso(new Date())) + `<hr class="divider">` +
    renderImplementation(overdueImpl) + `<hr class="divider">` +
    `<div class="footer"><p>Automated E-mail from KPI Dashboard &middot; ` +
    `<a href="https://cskpi.odpay.in">View live</a>.</p><p class="ted">TED</p></div></div>`;
}

function renderPage(day, missed, escalations, overdueImpl) {
  return `<!doctype html><html><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<title>CS Monitoring &middot; Daily Compliance</title><style>${STYLE}</style></head>` +
    `<body>${renderHtml(day, missed, escalations, overdueImpl)}</body></html>`;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* `testTo`, when set, replaces the real recipient list with a single address
   and drops the CC entirely — for confirming a change to the email before it
   goes to the whole team. Still gated by the same CRON_SECRET as everything
   else here, so it isn't an open relay. */
async function sendEmail(subject, html, testTo) {
  const to = testTo ? [testTo] : (process.env.DIGEST_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  const cc = testTo ? [] : (process.env.DIGEST_CC || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!to.length) throw new Error('DIGEST_TO is not set on this deployment.');

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

  // ?test=someone@example.com sends only to that address, no CC — see sendEmail.
  const testParam = Array.isArray(req.query.test) ? req.query.test[0] : req.query.test;
  const testTo = typeof testParam === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testParam)
    ? testParam : null;

  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const baseUrl = `${proto}://${req.headers.host}`;
    const day = lastWorkingDay();

    const byTracker = {};
    for (const src of TRACKERS) byTracker[src] = await fetchTracker(baseUrl, src);

    // Escalations and implementation are an enrichment on top of the core
    // filing-compliance report, not a foundation for it — the same call
    // index.html already makes about this data (see buildImplementation's
    // comment). A fetch failure here shows up as its own line in the email
    // rather than taking down the whole digest.
    const [escalations, overdueImpl] = await Promise.all([
      fetchRaw(baseUrl, 'escalations').then(parseEscalations).catch(() => null),
      fetchRaw(baseUrl, 'implementation').then(parseImplementation).catch(() => null),
    ]);

    const missed = computeMissed(byTracker, day);
    const pretty = new Date(day + 'T00:00:00').toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short' });
    const subject = missed.length
      ? `CS KPI: ${missed.length} ${missed.length === 1 ? 'person' : 'people'} missed filing time sheet (${pretty})`
      : `CS KPI: everyone filed time sheet (${pretty})`;

    await sendEmail(subject, renderPage(day, missed, escalations, overdueImpl), testTo);
    return res.status(200).json({
      ok: true, day, missed: missed.length,
      openEscalations: escalations === null ? 'unavailable' : escalations.length,
      overdueImplementation: overdueImpl === null ? 'unavailable' : overdueImpl.length,
      testTo: testTo || undefined,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
