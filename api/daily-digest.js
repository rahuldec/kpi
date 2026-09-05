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

async function fetchTracker(baseUrl, src) {
  const r = await fetch(`${baseUrl}/api/data?src=${src}&t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${src} tracker: HTTP ${r.status}`);
  return parseExport(await r.text());
}

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

function renderHtml(day, missed) {
  const pretty = new Date(day + 'T00:00:00').toLocaleDateString('en-GB',
    { weekday: 'long', day: 'numeric', month: 'long' });
  // Short form for the column header, so each row reads standalone without
  // scrolling back up to the opening sentence to know which day this is.
  const shortDate = new Date(day + 'T00:00:00').toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short' });
  const rows = missed.map(m => {
    /* Only worth calling out once it is a pattern, not a single slip — today's
       own miss already accounts for one of the count, so 2+ means at least
       one other day in the window went the same way. Plain "this week" reads
       faster than a fraction, and RECENT_WINDOW (5 working days) is a week. */
    const streak = m.recent >= 2
      ? `<div style="font-size:11px;color:#A82A1C;margin-top:2px">` +
        `Missed ${m.recent} times this week</div>`
      : '';
    return `<tr><td style="padding:6px 12px;border-bottom:1px solid #E8E8ED">` +
      `${escapeHtml(m.name)}${streak}</td>` +
      `<td style="padding:6px 12px;border-bottom:1px solid #E8E8ED;color:#A82A1C">` +
      `${m.trackers.map(t => TRACKER_LABEL[t]).join(', ')}</td></tr>`;
  }).join('');
  const body = missed.length
    ? `<p>${missed.length} ${missed.length === 1 ? 'person' : 'people'} did not file time sheet for <b>${pretty}</b>:</p>` +
      `<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">` +
      `<tr><th style="text-align:left;padding:6px 12px;border-bottom:2px solid #1D1D1F">Person</th>` +
      `<th style="text-align:left;padding:6px 12px;border-bottom:2px solid #1D1D1F">Missed (${shortDate})</th></tr>` +
      rows + `</table>`
    : `<p>Everyone filed time sheet for <b>${pretty}</b>. Nothing missed.</p>`;
  return `<div style="font-family:sans-serif;color:#1D1D1F">${body}` +
    `<p style="margin-top:20px;font-size:12px;color:#86868B">` +
    `Automated E-mail from KPI Dashboard.<br><b>TED</b> ` +
    `<a href="https://cskpi.odpay.in">View live</a>.</p></div>`;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendEmail(subject, html) {
  const to = (process.env.DIGEST_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  const cc = (process.env.DIGEST_CC || '').split(',').map(s => s.trim()).filter(Boolean);
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

  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const baseUrl = `${proto}://${req.headers.host}`;
    const day = lastWorkingDay();

    const byTracker = {};
    for (const src of TRACKERS) byTracker[src] = await fetchTracker(baseUrl, src);

    const missed = computeMissed(byTracker, day);
    const pretty = new Date(day + 'T00:00:00').toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short' });
    const subject = missed.length
      ? `CS KPI: ${missed.length} ${missed.length === 1 ? 'person' : 'people'} missed filing time sheet (${pretty})`
      : `CS KPI: everyone filed time sheet (${pretty})`;

    await sendEmail(subject, renderHtml(day, missed));
    return res.status(200).json({ ok: true, day, missed: missed.length });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
