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

/* Client names only, from the CS Team Plan book — trimmed down from
   index.html's parseBook, which also carries billing/team/category/handler
   for the dashboard's own use. The digest only needs enough to tell whether
   an escalation client or implementation project name matches something in
   the book at all, so the header-detection and the "real client row, not a
   scratch row" Sr No. check are kept and everything else is dropped. */
function parseBookNames(text) {
  const dl = (text.split('\n')[0].match(/\t/g) || []).length >= 2 ? '\t' : ',';
  const rows = splitRows(text, dl);
  let head = -1, ix = {};
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = rows[i].map(x => x.trim().toLowerCase());
    const name = h.indexOf('client name');
    const bill = h.findIndex(x => x.includes('total billing'));
    const sr = h.findIndex(x => x === 'sr no.' || x === 'sr no' || x === 'sr. no.');
    if (name > -1 && bill > -1) { head = i; ix = { sr, name }; break; }
  }
  if (head < 0) return [];
  const out = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const sr = String(r[ix.sr] ?? '').trim();
    const n = String(r[ix.name] ?? '').trim();
    if (n && /^\d+$/.test(sr)) out.push(n);
  }
  return out;
}

/* Every client string Asana carries for escalations, closed ones included —
   unlike parseEscalations above, which only keeps what's still open. The
   unmatched check cares about every aliasing gap that exists, not just the
   ones currently affecting something open, so it can catch a mapping problem
   before it happens to matter for compliance. */
function allEscalationClients(text) {
  const rows = splitRows(text, ',');
  let head = -1, ix = {};
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = rows[i].map(x => String(x).trim().toLowerCase());
    const p = h.indexOf('projects');
    if (p > -1 && h.indexOf('parent task') > -1) {
      head = i;
      ix = { projects: p, parent: h.indexOf('parent task'), name: h.indexOf('name') };
      break;
    }
  }
  if (head < 0) return [];
  const out = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r || r.length < 2) continue;
    if ((r[ix.parent] || '').trim()) continue; // a sub-task, not an escalation
    const projects = (r[ix.projects] || '').split(',').map(x => x.trim()).filter(Boolean);
    const client = projects.find(x => x.toLowerCase() !== ESC_PROJECT) || (r[ix.name] || '').trim();
    if (client) out.push(client);
  }
  return out;
}

// Same reasoning as allEscalationClients: every implementation project name,
// not just the ones with overdue tasks right now.
function allImplementationNames(text) {
  const rows = splitRows(text, ',');
  let head = -1, ix = {};
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = rows[i].map(x => String(x).trim().toLowerCase());
    const owner = h.indexOf('owner'), overdue = h.indexOf('overdue');
    if (owner > -1 && overdue > -1) { head = i; ix = { name: h.indexOf('name') }; break; }
  }
  if (head < 0) return [];
  const out = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const name = (r[ix.name] || '').trim();
    if (name) out.push(name);
  }
  return out;
}

/* Kept in sync with index.html's own ESC_ALIAS — hand-written evidence about
   which client an escalation belongs to, for the same reason index.html
   needs it: exact-match and safe prefix-containment alone don't bridge every
   spelling difference between what Asana carries and what the book says.
   Comments there explain the evidence behind each entry; not repeated here. */
const ESC_ALIAS = {
  'MSG Glorious Int School': 'Shah Satnam Sirsa',
  'Sirsa MSG Glorious': 'Shah Satnam Sirsa',
  'Dhanna Bhagat Public School': 'Dhanna Bhagat School',
  'Aggarwal college - not satisfied': 'Aggarwal College Faridabad',
  'Milestone Kaithal': 'Milestone School Kaithal',
  'AIMT': 'SA Jain (PG) College + AIMT',
  "Shah Satnam Girls' School": 'Shah Satnam Sirsa',
  'Shah Satnam Kotra': 'Shah Satnam Non Sirsa',
};

/* Kept in sync with index.html's own IMPL_ALIAS — same shape and reason as
   ESC_ALIAS above, for implementation project names instead of escalation
   clients. See index.html for the evidence behind each entry. */
const IMPL_ALIAS = {
  'Dalmia Vidya Mandir, Dalmiapuram (Extramarks)': 'Dalmia Group',
  'Dalmia Vidya Mandir, Kalyanpur (Extramarks)':   'Dalmia Group',
  'Dalmia Vidya Mandir- Thangskai (Extramarks)':   'Dalmia Group',
  'Dalmiya Vidya Mandir, Kadappa (Extramarks)':    'Dalmia Group',
  'Dalmia Vidya Mandir, Rajgangpur (Extramarks)':  'Dalmia Group',
  "Lingaya's Vidyapeeth University": "Linagaya's Vidyapeeth",
  'MAIMT Yamunanagar':               'MAIMT Ynr',
  'MRRA Sen. Sec. School, Kharindwa':'MRRA Kharindwa',
  'The Genesis School':              'Genesis School Karnal',
  'DPS Yamuna Nagar':                'DPS YNR CRM',
  'NPS Kalayat':                     'Nirmal Public Kalayat',
  'Satluj School Shahbad':           'Satluj Shahbad',
  'BM Group Gurugram':               'BM Group of Institutions',
  'P M COLLEGE OF PHARMACY': 'Puran Murti',
  'Shah Satnam Boys School': 'Shah Satnam Sirsa',
  'Hindu Engineering College, Sonipat':  'Hindu College',
  'Hindu Girls College':                 'Hindu College',
  'Hindu Architecture College, Sonipat':  'Hindu College',
  'Hindu Institute of Management (HIM)': 'Hindu College',
  'Hindu Senior Secondary School':       'Hindu School',
  'Hindu Malviya school':                'Hindu School',
  'Hindu Kanya Vidyalaya':               'Hindu School',
  'SM Hindu':                'Hindu School',
  'Hindu Vidyapeeth, Sonipat': 'Hindu School',
  'Hindu Global, Sonipat':    'Hindu School',
  'Rhuchi School':            'Hindu School',
};

const bookNorm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/* Same matching algorithm as index.html's buildEscalations/buildImplementation
   (they're identical apart from which alias table and name list they use) —
   alias lookup first, then exact match, then a safe prefix-containment match
   only when exactly one book row qualifies. Anything left over, plus any
   alias pointing at a client no longer in the book, comes back as unmatched. */
function computeUnmatched(bookNames, alias, rawNames) {
  const byNorm = new Map(bookNames.map(n => [bookNorm(n), n]));
  const aliasByNorm = new Map(Object.entries(alias).map(([from, to]) => [bookNorm(from), to]));
  const unmatched = [];
  for (const [from, to] of Object.entries(alias))
    if (!byNorm.has(bookNorm(to)))
      unmatched.push(`"${from}" is aliased to "${to}", which is not in the client book`);
  for (const name of rawNames) {
    const aliased = aliasByNorm.get(bookNorm(name)) || name;
    const k = bookNorm(aliased);
    let hit = byNorm.get(k);
    if (!hit) {
      const cands = bookNames.filter(n => {
        const nk = bookNorm(n);
        return nk.startsWith(k) || k.startsWith(nk);
      });
      if (cands.length === 1) hit = cands[0];
    }
    if (!hit && !unmatched.includes(name)) unmatched.push(name);
  }
  return unmatched;
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

// How many rows the escalations table shows before folding the rest into a
// "+N more" line linking to the live dashboard. Implementation shows its
// full list instead — see renderImplementation.
const ROW_CAP = 5;

const STYLE = `
    * { margin:0; padding:0; box-sizing:border-box;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; }
    body { background:#f0f2f5; padding:40px 16px; }
    .email-container { max-width:680px; width:100%; margin:0 auto; background:#ffffff; border-radius:32px;
      overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.02); }
    .header-banner { background:linear-gradient(145deg,#ffffff 0%,#f8f9fc 100%); padding:44px 44px 32px;
      border-bottom:1px solid rgba(0,0,0,.03); position:relative; }
    .header-top { display:flex; align-items:center; justify-content:center; margin-bottom:16px; position:relative; z-index:1; }
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
    .section-label-wrapper { display:flex; justify-content:center; margin-bottom:4px; }
    .section-label { display:inline-flex; align-items:center; gap:10px; padding:8px 28px 8px 24px; font-size:13px;
      font-weight:700; letter-spacing:.1em; text-transform:uppercase; border-radius:100px; box-shadow:0 2px 8px rgba(0,0,0,.02); }
    .label-filing { color:#b84a2e; background:#fdf2ef; border:1px solid rgba(184,74,46,.12); box-shadow:0 2px 12px rgba(184,74,46,.06); }
    .label-escalation { color:#b86a2a; background:#fdf5ed; border:1px solid rgba(184,106,42,.12); box-shadow:0 2px 12px rgba(184,106,42,.06); }
    .label-implementation { color:#2a6ab8; background:#eef3fd; border:1px solid rgba(42,106,184,.12); box-shadow:0 2px 12px rgba(42,106,184,.06); }
    .label-ok { color:#2a9d8f; background:#eafaf7; border:1px solid rgba(42,157,143,.12); box-shadow:0 2px 12px rgba(42,157,143,.06); }
    .label-data { color:#6a6a74; background:#f4f4f8; border:1px solid rgba(0,0,0,.05); }
    .section-label .status-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:2px; }
    .dot-red { background:#b84a2e; } .dot-orange { background:#b86a2a; } .dot-blue { background:#2a6ab8; }
    .dot-green { background:#2a9d8f; } .dot-grey { background:#8a8a94; }
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
    .footer { background:#fafbff; padding:24px 44px; border-top:1px solid #eaeaef; text-align:center; }
    .footer p { margin:0; font-size:12px; line-height:1.6; color:#7a7a85; }
    .footer a { color:#2a6ab8; text-decoration:none; font-weight:500; }
    .footer .ted { margin:10px 0 0; font-size:26px; font-weight:800; letter-spacing:.2em; color:#1a1a1e; text-transform:uppercase; }
    @media (max-width:480px) {
      .header-banner, .content-body, .footer { padding-left:20px; padding-right:20px; }
      .header-banner h1 { font-size:22px; }
      .section-label { font-size:11px; padding:6px 18px 6px 16px; }
      .kpi-table { font-size:12px; } .kpi-table thead th, .kpi-table tbody td { padding:10px 10px; }
      .section-title { font-size:16px; }
    }`;

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
    return `<tr><td><span style="font-weight:500">${escapeHtml(e.client)}</span></td>` +
      `<td>${escapeHtml(e.owner || '—')}</td><td class="text-danger">${openFor}</td></tr>`;
  }).join('') + (sorted.length > ROW_CAP ? capNote(sorted.length - ROW_CAP, 'open escalations') : '');
  return `<div class="section-spacer">` +
    sectionHead('label-escalation', 'dot-orange', 'Escalations',
      `<span class="highlight">${rows.length}</span> escalation${rows.length === 1 ? '' : 's'} still open`) +
    `<table class="kpi-table"><thead><tr><th>Client</th><th>Owner</th><th>Open Duration</th></tr></thead>` +
    `<tbody>${rowsHtml}</tbody></table></div>`;
}

// Escalations fold past ROW_CAP into a "+N more" line (see capNote); the
// implementation list shows every overdue project instead, per request —
// there's no dashboard link substituting for the full picture here.
function renderImplementation(rows) {
  if (rows === null)
    return `<div class="section-spacer">${sectionHead('label-implementation', 'dot-blue', 'Implementation', 'Data unavailable right now')}</div>`;
  if (!rows.length)
    return `<div class="section-spacer">${sectionHead('label-ok', 'dot-green', 'Implementation', 'No projects have overdue tasks')}</div>`;
  const sorted = [...rows].sort((a, b) => b.overdue - a.overdue);
  const rowsHtml = sorted.map(p =>
    `<tr><td><span style="font-weight:500">${escapeHtml(p.name)}</span></td>` +
    `<td>${escapeHtml(p.owner || '—')}</td><td class="text-right text-danger">${p.overdue}</td></tr>`
  ).join('');
  return `<div class="section-spacer">` +
    sectionHead('label-implementation', 'dot-blue', 'Implementation',
      `<span class="highlight">${rows.length}</span> project${rows.length === 1 ? '' : 's'} ${rows.length === 1 ? 'has' : 'have'} overdue tasks`) +
    `<table class="kpi-table"><thead><tr><th>Project</th><th>Owner</th><th class="text-right">Overdue</th></tr></thead>` +
    `<tbody>${rowsHtml}</tbody></table></div>`;
}

/* Silent when there's nothing to flag — unlike the sections above, a clean
   result here just means the alias tables are currently in sync, which isn't
   worth a line in an email the whole team reads. `null` (book fetch failed,
   or nothing to compare) also renders nothing rather than a false all-clear. */
function renderUnmatched(escUnmatched, implUnmatched) {
  const parts = [];
  if (escUnmatched && escUnmatched.length)
    parts.push(`<p style="margin:0"><b>${escUnmatched.length} escalation${escUnmatched.length === 1 ? '' : 's'}</b> ` +
      `could not be matched to a client: ${escapeHtml(escUnmatched.join(', '))}.</p>`);
  if (implUnmatched && implUnmatched.length)
    parts.push(`<p style="margin:${parts.length ? '8px' : '0'} 0 0"><b>${implUnmatched.length} implementation ` +
      `project${implUnmatched.length === 1 ? '' : 's'}</b> could not be matched to a client: ` +
      `${escapeHtml(implUnmatched.join(', '))}.</p>`);
  if (!parts.length) return '';
  return `<div class="section-spacer">` +
    sectionHead('label-data', 'dot-grey', 'Data Quality', 'Client-matching gaps found') +
    `<div style="font-size:13px;color:#4a4a52;line-height:1.6">${parts.join('')}</div></div>`;
}

function renderHtml(day, missed, escalations, overdueImpl, escUnmatched, implUnmatched) {
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
    ? `<div>${sectionHead('label-filing', 'dot-red', 'Filing Compliance',
        `<span class="highlight">${missed.length}</span> ${missed.length === 1 ? 'person' : 'people'} missed timesheet submission`)}` +
      `<table class="kpi-table"><thead><tr><th>Person</th><th>Missed Area (${shortDate})</th></tr></thead>` +
      `<tbody>${missedRowsHtml}</tbody></table></div>`
    : `<div>${sectionHead('label-ok', 'dot-green', 'Filing Compliance', `Everyone filed time sheet for ${fullDate}`)}</div>`;

  return `<div class="email-container">` +
    `<div class="header-banner"><div class="header-top">` +
    `<div class="digest-tag"><span class="pulse"></span> CS Monitoring</div></div>` +
    `<h1>Daily <span class="highlight">Compliance</span> &amp; Operations</h1>` +
    `<div class="sub"><span class="date">${fullDate}</span></div></div>` +
    `<div class="content-body">` +
    filingSection + renderEscalations(escalations, iso(new Date())) + renderImplementation(overdueImpl) +
    renderUnmatched(escUnmatched, implUnmatched) +
    `</div>` +
    `<div class="footer"><p>Automated E-mail from KPI Dashboard &nbsp;&middot;&nbsp; ` +
    `<a href="https://cskpi.odpay.in">View Live Dashboard</a></p><p class="ted">TED</p></div></div>`;
}

function renderPage(day, missed, escalations, overdueImpl, escUnmatched, implUnmatched) {
  return `<!doctype html><html><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<title>CS Monitoring &middot; Daily Compliance</title><style>${STYLE}</style></head>` +
    `<body>${renderHtml(day, missed, escalations, overdueImpl, escUnmatched, implUnmatched)}</body></html>`;
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

    // Escalations, implementation, and the client book are all an enrichment
    // on top of the core filing-compliance report, not a foundation for it —
    // the same call index.html already makes about this data (see
    // buildImplementation's comment). A fetch failure in any of them shows up
    // as its own line in the email rather than taking down the whole digest.
    const [escText, implText, bookNames] = await Promise.all([
      fetchRaw(baseUrl, 'escalations').catch(() => null),
      fetchRaw(baseUrl, 'implementation').catch(() => null),
      fetchRaw(baseUrl, 'book').then(parseBookNames).catch(() => null),
    ]);
    const escalations = escText === null ? null : parseEscalations(escText);
    const overdueImpl = implText === null ? null : parseImplementation(implText);

    // Needs both the raw text (for every name, not just the open/overdue
    // ones) and the book — either missing means "can't tell", not "clean".
    const escUnmatched = escText !== null && bookNames !== null
      ? computeUnmatched(bookNames, ESC_ALIAS, allEscalationClients(escText)) : null;
    const implUnmatched = implText !== null && bookNames !== null
      ? computeUnmatched(bookNames, IMPL_ALIAS, allImplementationNames(implText)) : null;

    const missed = computeMissed(byTracker, day);
    const pretty = new Date(day + 'T00:00:00').toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short' });
    const subject = missed.length
      ? `CS KPI: ${missed.length} ${missed.length === 1 ? 'person' : 'people'} missed filing time sheet (${pretty})`
      : `CS KPI: everyone filed time sheet (${pretty})`;

    await sendEmail(subject, renderPage(day, missed, escalations, overdueImpl, escUnmatched, implUnmatched), testTo);
    return res.status(200).json({
      ok: true, day, missed: missed.length,
      openEscalations: escalations === null ? 'unavailable' : escalations.length,
      overdueImplementation: overdueImpl === null ? 'unavailable' : overdueImpl.length,
      unmatchedEscalations: escUnmatched === null ? 'unavailable' : escUnmatched.length,
      unmatchedImplementation: implUnmatched === null ? 'unavailable' : implUnmatched.length,
      testTo: testTo || undefined,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
