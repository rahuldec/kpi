// Sends a weekly rollup by email via ZeptoMail: filing compliance across the
// whole past week (not just one day), escalations opened/closed/still-open
// during that week, and the current overdue-implementation snapshot. Meant to
// be triggered Monday mornings by a Vercel Cron entry in vercel.json — never
// called directly by the dashboard itself.
//
// This duplicates a handful of constants and helpers from api/daily-digest.js
// (HOLIDAYS, LEAVE_RAW, HIDDEN, EXEMPT, MANUAL_ROSTER, the STYLE template,
// parseImplementation, ...) rather than sharing them — same reasoning as that
// file's own header comment: no module system connects these serverless
// functions, and each is meant to read as one self-contained deployment unit.
// If one of those lists changes in daily-digest.js or index.html, it must be
// changed here too.
//
// Security: same gate as the other digests — accepts CRON_SECRET (what
// Vercel Cron sends once scheduled) or INSPECT_SECRET (a plain, shareable env
// var for one-off manual tests before a schedule is wired up). Refuses to run
// without one rather than erroring loudly, so a scan of this URL learns
// nothing about whether it exists.

const HOLIDAYS = new Set([
  '2026-08-15', '2026-08-28', '2026-10-02', '2026-10-20',
  '2026-11-06', '2026-11-07', '2026-11-09', '2026-12-25',
]);

const LEAVE_RAW = {"Amar Kumar Pandit":["2026-07-08","2026-07-24","2026-07-25"],"Anjali Verma":["2026-07-20","2026-07-30"],"Ankush Rana":["2026-07-01","2026-07-24","2026-07-25","2026-09-04","2026-09-08"],"Ashish Kumar":["2026-07-03","2026-07-06","2026-07-17"],"Ayush Garg":["2026-07-03","2026-07-04","2026-07-05","2026-07-06","2026-07-20"],"Divya Gupta":["2026-07-06","2026-07-31","2026-09-04"],"Gobind Monga":["2026-07-02"],"Kashish Goel":["2026-07-13","2026-07-27","2026-09-04","2026-09-08"],"Lokesh Kumar":["2026-07-10","2026-07-27","2026-09-04"],"Mansi Rana":["2026-07-08"],"Mehak Garg":["2026-07-23","2026-07-24"],"Mithilesh Kumar":["2026-07-06","2026-07-07","2026-07-16"],"Priya":["2026-07-17","2026-09-04"],"Rahul Sharma":["2026-07-31"],"Sagar Mishra":["2026-07-14"],"Shobhit Sehra":["2026-07-09","2026-07-16","2026-07-29"],"Sukhmeet Singh":["2026-07-17"],"Sumaiya Khan":["2026-07-07","2026-07-10","2026-07-17"]};

const HIDDEN = ['rahul sharma', 'aman sharma', 'amar kumar pandit'];

const EXEMPT = {
  internal: ['bhavey saluja'],
  client:   ['sagar mishra', 'sumaiya khan', 'bhavey saluja', 'mehak garg'],
};

const MANUAL_ROSTER = ['Bhavey Saluja'];

const TRACKERS = ['internal', 'client'];

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isWorkingDay = d => d.getDay() !== 0 && !HOLIDAYS.has(iso(d));

const LEAVE_DAYS = new Map(
  Object.entries(LEAVE_RAW).map(([name, days]) => [name.toLowerCase(), new Set(days)]));
const onLeave = (name, day) => LEAVE_DAYS.get(String(name).toLowerCase())?.has(day) === true;

const tc = s => s.split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');

const EMAIL_NAME_OVERRIDE = {
  'kjain21569@gmail.com': 'Khushi Jain',
};

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
      const emailRaw = ((ix.email > -1 ? r[ix.email] : '') || name || '').trim();
      name = EMAIL_NAME_OVERRIDE[emailRaw.toLowerCase()] || tc(emailRaw.split('@')[0].replace(/[._-]+/g, ' '));
    }
    if (!due || !name) continue;
    out.push({ name, due: due.slice(0, 10) });
  }
  return out;
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

/* Unlike daily-digest.js's parseEscalations, this keeps *every* row —
   completed ones too — since the weekly report needs to say what closed
   during the week, not just what's still open. api/data.js's `escalations`
   source already carries Completed At for every task (grabAsanaEscalations
   fetches the project's full task list, Asana doesn't filter completed ones
   out), so nothing upstream needs to change to get this. */
function parseEscalationsAll(text) {
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
    const projects = (r[ix.projects] || '').split(',').map(x => x.trim()).filter(Boolean);
    const client = projects.find(x => x.toLowerCase() !== ESC_PROJECT) || (r[ix.name] || '').trim();
    if (!client) continue;
    const closedAt = (r[ix.done] || '').slice(0, 10);
    out.push({
      client, owner: (r[ix.owner] || '').trim(),
      raised: (r[ix.created] || '').slice(0, 10),
      closedAt: closedAt || null,
    });
  }
  return out;
}

/* Same row shape as daily-digest.js's own parseImplementation — the overdue
   snapshot has no history to speak of (Asana doesn't track "was overdue on
   day X"), so the weekly report shows the same live count as of when it
   runs, not a computed weekly delta. */
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

/* Same row shape as api/website-tasks-digest.js's own parseWebsiteTasks —
   duplicated for the same reason as everything else here. Dates arrive as
   Asana's own ISO timestamps (UTC) and are kept as Date objects, since the
   week-window comparison needs real dates, not just the raw text. */
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

const daysBetween = (fromISO, toISO) =>
  Math.round((new Date(toISO + 'T00:00:00') - new Date(fromISO + 'T00:00:00')) / 86400000);

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

/* The 6 working days of the week *before* the one containing today — meant
   to be called on a Monday, so "today" is the first day of the new week and
   the window is the just-finished Mon-Sat. Walking to Monday first and then
   stepping back 7 days (rather than just "the last 6 working days") means a
   Monday that's itself a holiday, or a run that slips to Tuesday, still
   reports on the intended calendar week rather than sliding the window. */
function previousWeekWorkingDays() {
  const now = new Date();
  const back = now.getDay() === 0 ? 6 : now.getDay() - 1; // days back to this Monday
  const thisMonday = new Date(now);
  thisMonday.setDate(thisMonday.getDate() - back);
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  const prevSaturday = new Date(thisMonday);
  prevSaturday.setDate(prevSaturday.getDate() - 1);
  const out = [];
  for (const cur = new Date(prevMonday); cur <= prevSaturday; cur.setDate(cur.getDate() + 1))
    if (isWorkingDay(cur)) out.push(iso(cur));
  return { window: out, start: iso(prevMonday), end: iso(prevSaturday) };
}

/* Same per-day rule as daily-digest.js's missedTrackersOn, duplicated for the
   same reason as everything else here. */
function missedTrackersOn(byTracker, roster, day) {
  const filedBy = {};
  for (const src of TRACKERS)
    filedBy[src] = new Set(byTracker[src].filter(r => r.due === day).map(r => r.name.toLowerCase()));
  const out = new Map();
  for (const [key, person] of roster) {
    if (day < person.first) continue;
    if (onLeave(person.name, day)) continue;
    const missedTrackers = TRACKERS.filter(src =>
      !EXEMPT[src].includes(key) && !filedBy[src].has(key));
    if (missedTrackers.length) out.set(key, missedTrackers);
  }
  return out;
}

/* Rolls missedTrackersOn up across the whole week: one row per person who
   missed at least once, with how many of the week's working days they
   missed on and which trackers were involved across the week. */
function computeWeeklyMissed(byTracker, window) {
  const roster = buildRoster(byTracker);
  const perPerson = new Map();
  for (const day of window) {
    for (const [key, trackers] of missedTrackersOn(byTracker, roster, day)) {
      if (!perPerson.has(key)) perPerson.set(key, { name: roster.get(key).name, days: 0, trackers: new Set() });
      const entry = perPerson.get(key);
      entry.days += 1;
      trackers.forEach(t => entry.trackers.add(t));
    }
  }
  return [...perPerson.values()]
    .map(p => ({ ...p, trackers: [...p.trackers] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const ROW_CAP = 5;

const ACCENT = '#B5501C';
const RED = '#A82A1C';
const AMBER = '#B8860B';
const BLUE = '#0071E3';
const GREEN = '#2E7D32';

/* Same template as api/daily-digest.js's own STYLE — see that file's header
   comment for why it's duplicated instead of shared. */
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
    .divider { border:none; border-top:3px solid ${ACCENT}; margin:40px 0; opacity:.55; }
    .section-eyebrow { margin:0; font-size:19px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; text-align:center; }
    .section-headline { margin:8px 0 0; font-size:14px; font-weight:500; color:#6E6E73; text-align:center; }
    .kpi-table { width:100%; border-collapse:collapse; margin-top:22px; font-size:14px; }
    .kpi-table th { text-align:left; padding:0 0 8px; font-size:10.5px; font-weight:600; letter-spacing:.04em;
      text-transform:uppercase; color:#8A8A8F; border-bottom:1px solid #E5E3DE; }
    /* Higher specificity than ".kpi-table th" above, which otherwise wins the
       text-align cascade over the plain ".text-right" utility below and
       leaves a "text-right" header sitting left-aligned above right-aligned
       data — the header/data columns visibly don't line up. */
    .kpi-table th.text-right { text-align:right; }
    .kpi-table td { padding:10px 0; border-bottom:1px solid #EFEDE8; vertical-align:top; }
    .kpi-table tr:last-child td { border-bottom:none; }
    /* Plain (auto-layout) tables size each column to their own content, so
       stacked tables with different content lengths — e.g. Opened/Closed/
       Still Open in the Escalations section — drift out of alignment with
       each other. .fixed pins Owner/date columns (given explicit widths, see
       renderEscalationsWeekly) to the same width in every table using it, so
       the columns actually line up top to bottom; Client is left to wrap
       rather than forced onto one line, since some client names run long. */
    .kpi-table.fixed { table-layout:fixed; }
    .kpi-table.fixed th, .kpi-table.fixed td { padding-right:8px; word-break:break-word; }
    .kpi-table.fixed th:last-child, .kpi-table.fixed td:last-child { padding-right:0; }
    .kpi-table.fixed .nowrap { white-space:nowrap; overflow:hidden; }
    .text-danger { color:${RED}; font-weight:600; }
    .text-right { text-align:right; }
    .missed-badge { font-size:11px; color:#6E6E73; margin-top:2px; }
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

function sectionHead(color, label, headlineHtml) {
  return `<p class="section-eyebrow" style="color:${color}">${label}</p>` +
    `<p class="section-headline">${headlineHtml}</p>`;
}

function renderWeeklyMissed(missed) {
  if (!missed.length) return `<div>${sectionHead(GREEN, 'Time Sheet Compliance', 'Everyone filed on every working day last week')}</div>`;
  // Worst offenders first — a cap only tells a useful story if the rows it
  // keeps are the ones with the most missed days, not an alphabetical slice
  // that might drop the person who missed every single day.
  const sorted = [...missed].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  const shown = sorted.slice(0, ROW_CAP);
  const rowsHtml = shown.map(m =>
    `<tr><td><div class="person-name">${escapeHtml(m.name)}</div></td>` +
    `<td class="text-right text-danger">${m.days} time${m.days === 1 ? '' : 's'}</td></tr>`
  ).join('');
  return `<div>` +
    sectionHead(RED, 'Time Sheet Compliance',
      `<b>${missed.length}</b> ${missed.length === 1 ? 'person' : 'people'} missed at least one filing last week`) +
    `<table class="kpi-table"><tr><th>Person</th><th class="text-right">Times Missed</th></tr>${rowsHtml}</table></div>`;
}

function renderEscalationsWeekly(all, windowStart, windowEnd, today) {
  if (all === null) return `<div>${sectionHead('#8A8A8F', 'Escalations', 'Data unavailable right now')}</div>`;

  const opened = all.filter(e => e.raised && e.raised >= windowStart && e.raised <= windowEnd)
    .sort((a, b) => a.raised.localeCompare(b.raised));
  const closed = all.filter(e => e.closedAt && e.closedAt >= windowStart && e.closedAt <= windowEnd)
    .sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  const stillOpen = all.filter(e => !e.closedAt)
    .sort((a, b) => (a.raised || '9999').localeCompare(b.raised || '9999'));

  // Fixed Owner/date column widths — shared across all three sub-tables so
  // Client/Owner/date line up top to bottom regardless of which table has
  // the longest client name (see the .kpi-table.fixed comment in STYLE).
  const OWNER_W = 130, DATE_W = 90;
  const rows = (list, dateField) => {
    const shown = list.slice(0, ROW_CAP);
    const html = shown.map(e => {
      const d = e[dateField];
      const shown_ = d ? daysBetween(d, today) : null;
      const cell = dateField === 'closedAt'
        ? `<td class="nowrap">${e[dateField] || '—'}</td>`
        : `<td class="nowrap text-danger">${shown_ === null ? '—' : `${shown_} day${shown_ === 1 ? '' : 's'}`}</td>`;
      return `<tr><td><span style="font-weight:500">${escapeHtml(e.client)}</span></td>` +
        `<td class="nowrap">${escapeHtml(e.owner || '—')}</td>${cell}</tr>`;
    }).join('');
    return { html, count: list.length };
  };

  const openedRows = rows(opened, 'raised');
  const closedRows = rows(closed, 'closedAt');
  const stillOpenRows = rows(stillOpen, 'raised');

  return `<div>` +
    sectionHead(AMBER, 'Escalations',
      `<b>${openedRows.count}</b> opened &middot; <b>${closedRows.count}</b> closed &middot; <b>${stillOpenRows.count}</b> still open`) +
    (openedRows.count ? `<p style="margin-top:18px;font-size:12.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#1D1D1F;"><b>Opened Last Week</b></p>` +
      `<table class="kpi-table fixed"><tr><th>Client</th><th width="${OWNER_W}" style="width:${OWNER_W}px">Owner</th>` +
      `<th width="${DATE_W}" style="width:${DATE_W}px">Raised</th></tr>${openedRows.html}</table>` : '') +
    (closedRows.count ? `<p style="margin-top:18px;font-size:12.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#1D1D1F;"><b>Closed Last Week</b></p>` +
      `<table class="kpi-table fixed"><tr><th>Client</th><th width="${OWNER_W}" style="width:${OWNER_W}px">Owner</th>` +
      `<th width="${DATE_W}" style="width:${DATE_W}px">Closed On</th></tr>${closedRows.html}</table>` : '') +
    `<p style="margin-top:18px;font-size:12.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#1D1D1F;"><b>Still Open</b></p>` +
    (stillOpenRows.count
      ? `<table class="kpi-table fixed"><tr><th>Client</th><th width="${OWNER_W}" style="width:${OWNER_W}px">Owner</th>` +
        `<th width="${DATE_W}" style="width:${DATE_W}px">Open Duration</th></tr>${stillOpenRows.html}</table>`
      : `<p class="section-headline" style="margin-top:8px;">None</p>`) +
    `</div>`;
}

function renderImplementation(rows) {
  if (rows === null) return `<div>${sectionHead('#8A8A8F', 'Implementation', 'Data unavailable right now')}</div>`;
  if (!rows.length) return `<div>${sectionHead(GREEN, 'Implementation', 'No projects have overdue tasks')}</div>`;
  const sorted = [...rows].sort((a, b) => b.overdue - a.overdue);
  const shown = sorted.slice(0, ROW_CAP);
  const rowsHtml = shown.map(p =>
    `<tr><td><span style="font-weight:500">${escapeHtml(p.name)}</span></td>` +
    `<td>${escapeHtml(p.owner || '—')}</td><td class="text-right text-danger">${p.overdue}</td></tr>`
  ).join('');
  return `<div>` +
    sectionHead(BLUE, 'Implementation',
      `<b>${rows.length}</b> project${rows.length === 1 ? '' : 's'} ${rows.length === 1 ? 'has' : 'have'} overdue tasks (as of today)`) +
    `<table class="kpi-table"><tr><th>Project</th><th>Owner</th><th class="text-right">Overdue</th></tr>` +
    `${rowsHtml}</table></div>`;
}

/* Client Website Tasks — counts only, no itemized task list. Completed is
   scoped to the reported week (that history is real, unlike implementation's
   overdue count); pending is the live snapshot as of when this runs. */
function renderWebsiteTasksWeekly(tasks, windowStart, windowEnd) {
  if (tasks === null) return `<div>${sectionHead('#8A8A8F', 'Website Tasks', 'Data unavailable right now')}</div>`;

  const completedCount = tasks.filter(t => t.completed && t.completedAt &&
    iso(t.completedAt) >= windowStart && iso(t.completedAt) <= windowEnd).length;
  const pendingCount = tasks.filter(t => !t.completed).length;

  return `<div>${sectionHead(GREEN, 'Website Tasks',
    `<b>${completedCount}</b> completed last week &middot; <b>${pendingCount}</b> pending now`)}</div>`;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtRange(startISO, endISO) {
  const s = new Date(startISO + 'T00:00:00'), e = new Date(endISO + 'T00:00:00');
  const opts = { day: 'numeric', month: 'long' };
  return `${s.toLocaleDateString('en-GB', opts)} – ${e.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })}`;
}

function renderHtml(missed, escalationsAll, overdueImpl, websiteTasks, windowStart, windowEnd) {
  const rangeStr = fmtRange(windowStart, windowEnd);
  const today = iso(new Date());

  return `<div class="email-container">` +
    `<div class="masthead">` +
    `<h1>CS Monitoring &middot; Weekly Report</h1><p class="date">${rangeStr}</p></div>` +
    `<hr class="divider">` +
    renderWeeklyMissed(missed) + `<hr class="divider">` +
    renderEscalationsWeekly(escalationsAll, windowStart, windowEnd, today) + `<hr class="divider">` +
    renderImplementation(overdueImpl) + `<hr class="divider">` +
    renderWebsiteTasksWeekly(websiteTasks, windowStart, windowEnd) + `<hr class="divider">` +
    `<div class="footer"><p>Automated E-mail from KPI Dashboard &middot; ` +
    `<a href="https://cskpi.odpay.in">View live</a>.</p><p class="ted">TED</p></div></div>`;
}

function renderPage(missed, escalationsAll, overdueImpl, websiteTasks, windowStart, windowEnd) {
  return `<!doctype html><html><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<title>CS Monitoring &middot; Weekly Report</title><style>${STYLE}</style></head>` +
    `<body>${renderHtml(missed, escalationsAll, overdueImpl, websiteTasks, windowStart, windowEnd)}</body></html>`;
}

/* `testTo`, when set, replaces the real recipient with a single address and
   drops any CC — for confirming a change before it goes to the real list. */
async function sendEmail(subject, html, testTo) {
  const fallbackTo = 'customer-success-delight@okiedokiepay.com';
  const to = testTo ? [testTo]
    : (process.env.WEEKLY_REPORT_TO || fallbackTo).split(',').map(s => s.trim()).filter(Boolean);
  const cc = testTo ? [] : (process.env.WEEKLY_REPORT_CC || '').split(',').map(s => s.trim()).filter(Boolean);

  const r = await fetch(process.env.ZEPTOMAIL_URL || 'https://api.zeptomail.in/v1.1/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.ZEPTOMAIL_TOKEN || '',
    },
    body: JSON.stringify({
      from: { address: process.env.ZEPTOMAIL_SENDER || '', name: 'CS Weekly Report' },
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
    // Same reasoning as daily-digest.js: not derived from req.headers.host,
    // since Vercel Cron sometimes hits the protected *.vercel.app alias
    // instead of the custom domain.
    const baseUrl = process.env.DIGEST_BASE_URL || 'https://cskpi.odpay.in';
    const { window, start, end } = previousWeekWorkingDays();

    const byTracker = {};
    for (const src of TRACKERS) byTracker[src] = await fetchTracker(baseUrl, src);

    const [escalationsAll, overdueImpl, websiteTasks] = await Promise.all([
      fetchRaw(baseUrl, 'escalations').then(parseEscalationsAll).catch(() => null),
      fetchRaw(baseUrl, 'implementation').then(parseImplementation).catch(() => null),
      fetchRaw(baseUrl, 'websiteTasks').then(parseWebsiteTasks).catch(() => null),
    ]);

    const missed = computeWeeklyMissed(byTracker, window);

    const openedCount = escalationsAll === null ? null
      : escalationsAll.filter(e => e.raised && e.raised >= start && e.raised <= end).length;
    const closedCount = escalationsAll === null ? null
      : escalationsAll.filter(e => e.closedAt && e.closedAt >= start && e.closedAt <= end).length;
    const websiteCompletedCount = websiteTasks === null ? null
      : websiteTasks.filter(t => t.completed && t.completedAt &&
          iso(t.completedAt) >= start && iso(t.completedAt) <= end).length;

    const missedPart = `${missed.length} Missed Time Sheet${missed.length === 1 ? '' : 's'}`;
    const escPart = escalationsAll === null ? null : `${openedCount} Opened / ${closedCount} Closed Escalations`;
    const websitePart = websiteCompletedCount === null ? null : `${websiteCompletedCount} Website Tasks Done`;
    const subject = [missedPart, escPart, websitePart].filter(Boolean).join(' | ');

    await sendEmail(subject, renderPage(missed, escalationsAll, overdueImpl, websiteTasks, start, end), testTo);
    return res.status(200).json({
      ok: true, weekStart: start, weekEnd: end, missed: missed.length,
      escalationsOpened: openedCount === null ? 'unavailable' : openedCount,
      escalationsClosed: closedCount === null ? 'unavailable' : closedCount,
      overdueImplementation: overdueImpl === null ? 'unavailable' : overdueImpl.length,
      websiteTasksCompleted: websiteCompletedCount === null ? 'unavailable' : websiteCompletedCount,
      websiteTasksPending: websiteTasks === null ? 'unavailable' : websiteTasks.filter(t => !t.completed).length,
      testTo: testTo || undefined,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
