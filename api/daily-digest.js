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

  /* How many missed on the working day right before `day` — the window
     already covers it, so this is a free comparison rather than a second
     fetch. Genuinely "vs the previous working day", not "vs last week": with
     only one day of lookback available there is no honest weekly number to
     show, so the email says exactly what this is. */
  const dayIdx = window.indexOf(day);
  const prevMissedCount = dayIdx > 0 ? missedByDay.get(window[dayIdx - 1]).size : null;

  /* Every (person, tracker) pair actually expected on `day` — on the roster
     by then, not on leave, not exempt from that specific tracker. Compliance
     rate is missed obligations against this, not against headcount, since
     exemptions and leave both shrink what a "full" day even means. */
  let totalObligations = 0;
  for (const [key, person] of roster) {
    if (day < person.first || onLeave(person.name, day)) continue;
    for (const src of TRACKERS) if (!EXEMPT[src].includes(key)) totalObligations++;
  }

  return { missed, prevMissedCount, totalObligations };
}

/* ISO-8601 week number — the "Week 36" style label in the masthead. Genuinely
   computed from the reporting date, not a counter this stateless function has
   nowhere to persist. */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
}

/* Escalations carry no priority field of their own in Asana — this bands the
   one real signal available (days open) into the same four labels the design
   calls for. The cutoffs are a judgment call, not something Asana defines:
   past 60 days is "how did this go unnoticed", past 20 is "should have a plan
   by now", past a week is worth a mention, under that is routine. */
function escalationPriority(days) {
  if (days === null) return { label: 'Low', cls: 'low' };
  if (days > 60) return { label: 'Critical', cls: 'critical' };
  if (days > 20) return { label: 'High', cls: 'high' };
  if (days > 7) return { label: 'Medium', cls: 'medium' };
  return { label: 'Low', cls: 'low' };
}

// How many rows a table shows before folding the rest into a "+N more" line
// linking to the live dashboard — an implementation list with 25 overdue
// projects makes for an email nobody scrolls through otherwise.
const ROW_CAP = 5;

const STYLE = `
    * { margin:0; padding:0; box-sizing:border-box;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; }
    body { background:#f0f2f5; padding:40px 16px; }
    .email-container { max-width:680px; width:100%; margin:0 auto; background:#ffffff; border-radius:32px;
      overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.02); }
    .header-banner { background:linear-gradient(145deg,#ffffff 0%,#f8f9fc 100%); padding:44px 44px 32px;
      border-bottom:1px solid rgba(0,0,0,.03); position:relative; }
    .header-top { display:flex; align-items:center; margin-bottom:16px; position:relative; z-index:1; }
    .header-top .digest-tag { display:inline-flex; align-items:center; gap:8px; background:rgba(227,138,80,.08);
      padding:5px 18px 5px 16px; border-radius:100px; font-size:10px; font-weight:700; letter-spacing:.1em;
      text-transform:uppercase; color:#c06a3a; border:1px solid rgba(227,138,80,.08); }
    .header-top .digest-tag .pulse { display:inline-block; width:6px; height:6px; border-radius:50%; background:#c06a3a; }
    .header-banner h1 { font-size:30px; font-weight:700; letter-spacing:-.02em; color:#1a1a1e; line-height:1.15;
      margin-bottom:6px; position:relative; z-index:1; }
    .header-banner h1 .highlight { background:linear-gradient(120deg,#fdf2ef 0%,#fdf2ef 40%,transparent 80%);
      padding:0 4px; color:#b84a2e; }
    .header-banner .sub { font-size:14px; font-weight:400; color:#7a7a85; letter-spacing:.2px; position:relative;
      z-index:1; display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
    .header-banner .sub .date { color:#1a1a1e; font-weight:500; }
    .header-banner .sub .separator { color:#d0d0d8; font-weight:300; }
    .header-banner .sub .badge { background:#eef3fd; color:#2a6ab8; padding:2px 12px; border-radius:100px;
      font-size:10px; font-weight:600; letter-spacing:.04em; }
    .content-body { padding:28px 44px 32px; background:#ffffff; }
    .quick-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:32px;
      padding-bottom:24px; border-bottom:1px solid #f0f2f5; }
    .quick-stat { background:#f8f9fc; border-radius:14px; padding:14px 12px; text-align:center; border:1px solid #f0f2f5; }
    .quick-stat .number { font-size:22px; font-weight:700; color:#1a1a1e; letter-spacing:-.02em; line-height:1.2; }
    .quick-stat .number.red { color:#b84a2e; } .quick-stat .number.orange { color:#b86a2a; }
    .quick-stat .number.blue { color:#2a6ab8; } .quick-stat .number.green { color:#2a9d8f; }
    .quick-stat .number.grey { color:#8a8a94; }
    .quick-stat .label { font-size:9px; text-transform:uppercase; letter-spacing:.06em; color:#8a8a94;
      font-weight:600; margin-top:4px; }
    .quick-stat .trend { font-size:9px; font-weight:600; margin-top:2px; letter-spacing:.03em; }
    .quick-stat .trend.up { color:#2a9d8f; } .quick-stat .trend.down { color:#b84a2e; }
    .quick-stat .trend.flat { color:#8a8a94; }
    .section-label-wrapper { display:flex; justify-content:center; margin-bottom:4px; }
    .section-label { display:inline-flex; align-items:center; gap:10px; padding:8px 28px 8px 24px; font-size:13px;
      font-weight:700; letter-spacing:.1em; text-transform:uppercase; border-radius:100px; box-shadow:0 2px 8px rgba(0,0,0,.02); }
    .label-filing { color:#b84a2e; background:#fdf2ef; border:1px solid rgba(184,74,46,.12); box-shadow:0 2px 12px rgba(184,74,46,.06); }
    .label-escalation { color:#b86a2a; background:#fdf5ed; border:1px solid rgba(184,106,42,.12); box-shadow:0 2px 12px rgba(184,106,42,.06); }
    .label-implementation { color:#2a6ab8; background:#eef3fd; border:1px solid rgba(42,106,184,.12); box-shadow:0 2px 12px rgba(42,106,184,.06); }
    .label-ok { color:#2a9d8f; background:#eafaf7; border:1px solid rgba(42,157,143,.12); box-shadow:0 2px 12px rgba(42,157,143,.06); }
    .section-label .status-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:2px; }
    .dot-red { background:#b84a2e; } .dot-orange { background:#b86a2a; } .dot-blue { background:#2a6ab8; } .dot-green { background:#2a9d8f; }
    .section-title { margin:14px 0 20px; font-size:18px; font-weight:600; color:#1a1a1e; letter-spacing:-.01em; text-align:center; }
    .section-title .highlight { color:#b84a2e; font-weight:700; background:#fdf2ef; padding:0 8px; border-radius:6px; }
    .section-spacer { margin-top:44px; }
    .kpi-table { width:100%; border-collapse:collapse; font-size:13.5px; border-radius:16px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.02); }
    .kpi-table thead th { text-align:left; padding:12px 16px; background:#fafbff; color:#6a6a74; font-weight:600;
      font-size:10px; letter-spacing:.06em; text-transform:uppercase; border-bottom:2px solid #eaeaef; }
    .kpi-table tbody td { padding:14px 16px; border-bottom:1px solid #f4f4f8; color:#1e1e22; background:#ffffff; }
    .kpi-table tbody tr:last-child td { border-bottom:none; }
    .text-danger { color:#b84a2e; font-weight:600; }
    .text-right { text-align:right; }
    .missed-badge { font-size:11px; color:#b84a2e; margin-top:3px; font-weight:400; opacity:.75; letter-spacing:.01em; }
    .person-name { font-weight:600; color:#1a1a1e; }
    .center-cell { text-align:center; font-size:12.5px; color:#7a7a85; background:#fafbff!important;
      padding:18px 16px!important; border-radius:0 0 16px 16px; border-top:1px solid #f0f0f4!important; }
    .center-cell a { color:#2a6ab8; text-decoration:none; font-weight:500; border-bottom:2px solid rgba(42,106,184,.12); padding-bottom:2px; }
    .status-badge { display:inline-block; padding:2px 12px; border-radius:100px; font-size:10px; font-weight:600; letter-spacing:.04em; }
    .status-badge.critical { background:#fdf2ef; color:#b84a2e; }
    .status-badge.high { background:#fdf5ed; color:#b86a2a; }
    .status-badge.medium { background:#fef9e7; color:#b7950b; }
    .status-badge.low { background:#eef3fd; color:#2a6ab8; }
    .footer { background:#fafbff; padding:24px 44px; border-top:1px solid #eaeaef; text-align:center; }
    .footer p { margin:0; font-size:12px; line-height:1.6; color:#7a7a85; }
    .footer a { color:#2a6ab8; text-decoration:none; font-weight:500; }
    .footer .ted { margin:8px 0 0; font-size:11px; font-weight:700; letter-spacing:.2em; color:#1a1a1e; opacity:.15; text-transform:uppercase; }
    @media (max-width:480px) {
      .header-banner, .content-body, .footer { padding-left:20px; padding-right:20px; }
      .header-banner h1 { font-size:22px; }
      .quick-stats { grid-template-columns:repeat(2,1fr); gap:8px; }
      .quick-stat { padding:10px 8px; } .quick-stat .number { font-size:18px; }
      .section-label { font-size:11px; padding:6px 18px 6px 16px; }
      .kpi-table { font-size:12px; } .kpi-table thead th, .kpi-table tbody td { padding:10px 10px; }
      .section-title { font-size:16px; }
    }`;

const statCell = (n, label, cls, trendHtml) =>
  `<div class="quick-stat"><div class="number ${cls}">${n}</div><div class="label">${label}</div>${trendHtml || ''}</div>`;

function capNote(remaining, kind) {
  return `<tr><td colspan="99" class="center-cell">+ ${remaining} additional ${kind} &nbsp;&middot;&nbsp; ` +
    `<a href="https://cskpi.odpay.in">View complete list on dashboard &rarr;</a></td></tr>`;
}

function sectionHead(labelCls, dotCls, label, titleHtml) {
  return `<div class="section-label-wrapper"><div class="section-label ${labelCls}">` +
    `<span class="status-dot ${dotCls}"></span> ${label}</div></div>` +
    `<h2 class="section-title">${titleHtml}</h2>`;
}

function renderEscalations(rows, today) {
  if (rows === null)
    return `<div class="section-spacer">${sectionHead('label-escalation', 'dot-orange', 'Escalations', 'Data unavailable right now')}</div>`;
  if (!rows.length)
    return `<div class="section-spacer">${sectionHead('label-ok', 'dot-green', 'Escalations', 'No open escalations')}</div>`;
  const sorted = [...rows].sort((a, b) => (a.raised || '9999').localeCompare(b.raised || '9999'));
  const shown = sorted.slice(0, ROW_CAP);
  const rowsHtml = shown.map(e => {
    const days = e.raised ? daysBetween(e.raised, today) : null;
    const openFor = days === null ? '—' : `${days} day${days === 1 ? '' : 's'}`;
    const pr = escalationPriority(days);
    return `<tr><td><span style="font-weight:500">${escapeHtml(e.client)}</span></td>` +
      `<td>${escapeHtml(e.owner || '—')}</td><td class="text-danger">${openFor}</td>` +
      `<td><span class="status-badge ${pr.cls}">${pr.label}</span></td></tr>`;
  }).join('') + (sorted.length > ROW_CAP ? capNote(sorted.length - ROW_CAP, 'open escalations') : '');
  return `<div class="section-spacer">` +
    sectionHead('label-escalation', 'dot-orange', 'Escalations',
      `<span class="highlight">${rows.length}</span> escalation${rows.length === 1 ? '' : 's'} still open`) +
    `<table class="kpi-table"><thead><tr><th>Client</th><th>Owner</th><th>Open Duration</th><th>Priority</th></tr></thead>` +
    `<tbody>${rowsHtml}</tbody></table></div>`;
}

function renderImplementation(rows) {
  if (rows === null)
    return `<div class="section-spacer">${sectionHead('label-implementation', 'dot-blue', 'Implementation', 'Data unavailable right now')}</div>`;
  if (!rows.length)
    return `<div class="section-spacer">${sectionHead('label-ok', 'dot-green', 'Implementation', 'No projects have overdue tasks')}</div>`;
  const sorted = [...rows].sort((a, b) => b.overdue - a.overdue);
  const shown = sorted.slice(0, ROW_CAP);
  const rowsHtml = shown.map(p =>
    `<tr><td><span style="font-weight:500">${escapeHtml(p.name)}</span></td>` +
    `<td>${escapeHtml(p.owner || '—')}</td><td class="text-right text-danger">${p.overdue}</td></tr>`
  ).join('') + (sorted.length > ROW_CAP ? capNote(sorted.length - ROW_CAP, 'projects with overdue tasks') : '');
  return `<div class="section-spacer">` +
    sectionHead('label-implementation', 'dot-blue', 'Implementation',
      `<span class="highlight">${rows.length}</span> project${rows.length === 1 ? '' : 's'} ${rows.length === 1 ? 'has' : 'have'} overdue tasks`) +
    `<table class="kpi-table"><thead><tr><th>Project</th><th>Owner</th><th class="text-right">Overdue</th></tr></thead>` +
    `<tbody>${rowsHtml}</tbody></table></div>`;
}

function renderHtml(day, missedResult, escalations, overdueImpl) {
  const { missed, prevMissedCount, totalObligations } = missedResult;
  const dateObj = new Date(day + 'T00:00:00');
  const fullDate = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Short form for the column header, so each row reads standalone without
  // scrolling back up to the opening sentence to know which day this is.
  const shortDate = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const updatedAt = new Date().toLocaleTimeString('en-IN',
    { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/am|pm/i, s => s.toUpperCase());

  const missedObligations = missed.reduce((s, m) => s + m.trackers.length, 0);
  const complianceRate = totalObligations
    ? Math.round(((totalObligations - missedObligations) / totalObligations) * 100) : 100;
  const complianceCls = complianceRate >= 95 ? 'green' : complianceRate >= 80 ? 'orange' : 'red';

  /* The only stat with a genuine day-over-day comparison available (see
     computeMissed) — escalations and implementation are point-in-time Asana
     snapshots with no history this stateless function keeps, so those two
     stats and the compliance rate get a number but no invented trend. */
  let missedTrend = '';
  if (prevMissedCount !== null) {
    const diff = missed.length - prevMissedCount;
    const trendCls = diff > 0 ? 'down' : diff < 0 ? 'up' : 'flat';
    const arrow = diff > 0 ? '&uarr;' : diff < 0 ? '&darr;' : '&rarr;';
    const text = diff === 0 ? 'Same as last working day' : `${arrow} ${Math.abs(diff)} vs last working day`;
    missedTrend = `<div class="trend ${trendCls}">${text}</div>`;
  }

  const escN = escalations === null ? '—' : escalations.length;
  const implN = overdueImpl === null ? '—' : overdueImpl.length;
  const quickStats =
    statCell(missed.length, missed.length === 1 ? 'Missed Timesheet' : 'Missed Timesheets',
      missed.length ? 'red' : 'green', missedTrend) +
    statCell(escN, 'Open Escalations', escalations === null ? 'grey' : escalations.length ? 'orange' : 'green') +
    statCell(implN, 'Overdue Projects', overdueImpl === null ? 'grey' : overdueImpl.length ? 'blue' : 'green') +
    statCell(`${complianceRate}%`, 'Compliance Rate', complianceCls);

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
    ? `<div>${sectionHead('label-filing', 'dot-red', 'Filing Compliance',
        `<span class="highlight">${missed.length}</span> ${missed.length === 1 ? 'person' : 'people'} missed timesheet submission`)}` +
      `<table class="kpi-table"><thead><tr><th>Person</th><th>Missed Area (${shortDate})</th></tr></thead>` +
      `<tbody>${missedRowsHtml}</tbody></table></div>`
    : `<div>${sectionHead('label-ok', 'dot-green', 'Filing Compliance', `Everyone filed time sheet for ${fullDate}`)}</div>`;

  return `<div class="email-container">` +
    `<div class="header-banner"><div class="header-top">` +
    `<div class="digest-tag"><span class="pulse"></span> CS KPI Digest</div></div>` +
    `<h1>Daily <span class="highlight">Compliance</span> &amp; Operations</h1>` +
    `<div class="sub"><span class="date">${fullDate}</span><span class="separator">&middot;</span>` +
    `<span>Week ${isoWeek(dateObj)}</span><span class="separator">&middot;</span>` +
    `<span class="badge">Updated: ${updatedAt} IST</span></div></div>` +
    `<div class="content-body"><div class="quick-stats">${quickStats}</div>` +
    filingSection + renderEscalations(escalations, iso(new Date())) + renderImplementation(overdueImpl) +
    `</div>` +
    `<div class="footer"><p>Automated E-mail from KPI Dashboard &nbsp;&middot;&nbsp; ` +
    `<a href="https://cskpi.odpay.in">View Live Dashboard</a></p><p class="ted">TED</p></div></div>`;
}

function renderPage(day, missedResult, escalations, overdueImpl) {
  return `<!doctype html><html><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<title>CS KPI Digest &middot; Daily Compliance</title><style>${STYLE}</style></head>` +
    `<body>${renderHtml(day, missedResult, escalations, overdueImpl)}</body></html>`;
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

    const missedResult = computeMissed(byTracker, day);
    const pretty = new Date(day + 'T00:00:00').toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short' });
    const subject = missedResult.missed.length
      ? `CS KPI: ${missedResult.missed.length} ${missedResult.missed.length === 1 ? 'person' : 'people'} missed filing time sheet (${pretty})`
      : `CS KPI: everyone filed time sheet (${pretty})`;

    await sendEmail(subject, renderPage(day, missedResult, escalations, overdueImpl), testTo);
    return res.status(200).json({
      ok: true, day, missed: missedResult.missed.length,
      openEscalations: escalations === null ? 'unavailable' : escalations.length,
      overdueImplementation: overdueImpl === null ? 'unavailable' : overdueImpl.length,
      testTo: testTo || undefined,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
