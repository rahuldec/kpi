#!/usr/bin/env node
/* Keep a permanent copy of what the rolling Asana export can only hold for a
   while.

   The Asana -> Sheets sync keeps roughly the most recent 500 tasks and drops the
   oldest to make room. That is fine for the daily boards, which only ever ask
   about the last few days, and fatal for the monthly scorecard: once July's rows
   fall out of the window, July stops reading as a month that was filed and starts
   reading as a month of missed days. The figures stay confident and become wrong.

   So this runs on a schedule, reads the same two sheets the dashboard reads, and
   writes every {person, due date} it sees into archive/<tracker>/<month>.json.
   Anything already recorded is left alone, so re-running is free and running it
   twice in a day costs nothing. It only ever adds.

   Parsing is not reimplemented here. The page's own parseExport() is lifted out
   of index.html and run as-is, because a second parser is a second set of rules
   about headers, spacer rows, quoted names and blank assignees — and the moment
   the two disagree the archive stops describing what the dashboard would have
   shown. One parser, one set of answers.

   Usage:
     node scripts/archive.js               # both trackers, live sheets
     node scripts/archive.js --dry-run     # report what would change, write nothing

   Reads SHEET_ID / CLIENT_SHEET_ID from the environment when set, exactly as
   api/data.js does, so a repointed sheet needs no change here.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ARCHIVE = path.join(ROOT, 'archive');
const DRY = process.argv.includes('--dry-run');

/* The two trackers, addressed the way api/data.js addresses them. Defaults match
   its own, so this works with no environment set at all. */
const SHEETS = {
  internal: process.env.SHEET_ID        || '1tzsf5iWijfIT8AfXTJZUbrGzH5OkNb-6xMO3EZ59cdo',
  client:   process.env.CLIENT_SHEET_ID || '1oUHAjf6zAiHdLd11jvqerbXC0adx5XDsqlfLoRNOSCY',
};

/* ---- the page's own parser, lifted rather than copied ---------------------
   parseExport depends on splitRows, normDate, tc and iso. Pull those four out
   of index.html by name and evaluate them in a bare context. If index.html ever
   renames or reshapes one, this throws loudly at the top of the run rather than
   silently archiving nothing — which is the failure that would go unnoticed
   longest, since an archive that stops growing looks exactly like a quiet month. */
function loadParser(){
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const grab = name => {
    const m = html.match(new RegExp(`\\nfunction ${name}\\(([\\s\\S]*?)\\n\\}`));
    if (!m) throw new Error(
      `Could not find function ${name}() in index.html. The archiver reuses the ` +
      `page's own parser; if it has been renamed or reshaped, update scripts/archive.js.`);
    return `function ${name}(${m[1]}\n}`;
  };
  const iso = html.match(/\nconst iso\s*=\s*(.+?);\n/);
  const tc = html.match(/\nconst tc\s*=\s*(.+?);\n/);
  if (!iso || !tc) throw new Error(
    'Could not find the iso/tc helpers in index.html — the archiver needs them for parseExport().');
  const src = [
    `const pad = n => String(n).padStart(2, '0');`,
    `const iso = ${iso[1]};`,
    `const tc = ${tc[1]};`,
    grab('splitRows'), grab('normDate'), grab('parseExport'),
    `module.exports = { parseExport, normDate };`,
  ].join('\n');
  const ctx = {module: {exports: {}}, console};
  vm.createContext(ctx);
  vm.runInContext(src, ctx, {filename: 'index.html(parser)'});
  return ctx.module.exports;
}

/* Same transport as api/data.js: export the sheet as CSV, hunting for the tab
   that actually holds the Asana export rather than trusting the default one. */
const isLoginPage = body => body.trimStart().startsWith('<');
const looksLikeExport = csv => /due date/i.test(csv) && /assignee/i.test(csv);

async function grab(base, gid){
  const url = `${base}/export?format=csv` + (gid == null ? '' : `&gid=${gid}`);
  const r = await fetch(url, {redirect: 'follow'});
  if (!r.ok) return null;
  const body = await r.text();
  return isLoginPage(body) ? null : body;
}

async function discoverGids(base){
  for (const p of ['/htmlview', '/pubhtml']){
    try {
      const r = await fetch(base + p, {redirect: 'follow'});
      if (!r.ok) continue;
      const html = await r.text();
      const found = [...html.matchAll(/[?&#]gid=(\d+)/g)].map(m => m[1]);
      if (found.length) return [...new Set(found)].slice(0, 12);
    } catch (_) { /* try the next */ }
  }
  return [];
}

async function fetchTracker(id){
  const base = `https://docs.google.com/spreadsheets/d/${id}`;
  const first = await grab(base, null);
  if (first && looksLikeExport(first)) return first;
  for (const gid of await discoverGids(base)){
    const body = await grab(base, gid);
    if (body && looksLikeExport(body)) return body;
  }
  throw new Error(
    `No tab in sheet ${id} looks like the Asana export. If the sheet is not ` +
    `link-shared as "Anyone with the link -> Viewer", Google serves a login page ` +
    `instead and this is what that looks like.`);
}

/* One file per tracker per month, keyed by person + due date. The key is what
   makes re-running safe: an entry already archived is recognised however many
   times the sheet still carries it, so the file only ever grows by genuinely
   new rows. Sorted on write so a re-run that adds nothing produces a
   byte-identical file and therefore no commit. */
const keyOf = r => `${r.name.trim().toLowerCase()}|${r.due}`;

function readMonth(tracker, month){
  const f = path.join(ARCHIVE, tracker, `${month}.json`);
  if (!fs.existsSync(f)) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    /* A corrupt file must stop the run. Treating it as empty would rewrite it
       from the live sheet, which is exactly the data that has aged out — the
       one case where the archive is the only copy left. */
    throw new Error(`archive/${tracker}/${month}.json is not readable JSON: ${e.message}. ` +
                    `Fix or restore it from git history before re-running.`);
  }
}

function writeMonth(tracker, month, rows){
  const dir = path.join(ARCHIVE, tracker);
  fs.mkdirSync(dir, {recursive: true});
  const sorted = rows.slice().sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(dir, `${month}.json`), JSON.stringify(sorted, null, 0) + '\n');
}

(async () => {
  const {parseExport} = loadParser();
  let added = 0, touched = [];

  for (const [tracker, id] of Object.entries(SHEETS)){
    const csv = await fetchTracker(id);
    const rows = parseExport(csv);

    // group this fetch by month
    const byMonth = new Map();
    for (const r of rows){
      const m = r.due.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push({name: r.name, due: r.due});
    }

    for (const [month, fresh] of byMonth){
      const have = readMonth(tracker, month);
      const seen = new Set(have.map(keyOf));
      const novel = [];
      for (const r of fresh){
        if (seen.has(keyOf(r))) continue;
        seen.add(keyOf(r));      // the live sheet itself repeats a person/day
        novel.push(r);
      }
      if (!novel.length) continue;
      added += novel.length;
      touched.push(`${tracker}/${month} +${novel.length}`);
      if (!DRY) writeMonth(tracker, month, have.concat(novel));
    }
    console.log(`${tracker}: ${rows.length} rows in the export, ` +
                `${byMonth.size} month${byMonth.size === 1 ? '' : 's'}`);
  }

  console.log(added
    ? `${DRY ? 'Would add' : 'Added'} ${added} new ${added === 1 ? 'entry' : 'entries'}: ${touched.join(', ')}`
    : 'Nothing new — the archive already has every entry in both exports.');
})().catch(e => { console.error(String((e && e.message) || e)); process.exit(1); });
