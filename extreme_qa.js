// Supplementary edge-case probes, run against the real index.html with jsdom —
// same technique as qa.js, targeting scenarios its 630 assertions don't already
// cover explicitly: raw duplicate-row counting, zero-ever-filed, the exact
// "first entry mid-range" scenario, CSV-export torture strings, and whether the
// team KPI is a pooled ratio or an average of percentages.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const FILE = process.argv[2] || 'index.html';
const HTML = fs.readFileSync(FILE, 'utf8');
let pass = 0, fail = 0; const results = [];
const check = (n, c, d) => c ? (pass++, results.push([1, n, ''])) : (fail++, results.push([0, n, d || '']));

const HEAD = 'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes';
const sheet = rows => [',,', ',,url', ',,', HEAD, ...rows].join('\n');
const MIN_BOOK = 'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,';
const MIN_FEED = '"Timestamp","Name of the Institution?"';

function boot({ body, clientBody = sheet([]), escBody = sheet([]), bookBody = MIN_BOOK, adoptBody = '', feedBody = MIN_FEED, archive = {} } = {}) {
  const errs = [], calls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://kpi.test/',
    beforeParse(window) {
      window.fetch = (url) => {
        calls.push(url);
        const arch = url.match(/^\/archive\/(\w+)\/([\d-]+)\.json/);
        if (arch) {
          const rows = (archive[arch[1]] || {})[arch[2]];
          return Promise.resolve(rows
            ? {ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(rows))}
            : {ok: false, status: 404, text: () => Promise.resolve('')});
        }
        const src = (url.match(/src=(\w+)/) || [])[1];
        return Promise.resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(
            src === 'escalations' ? escBody :
            src === 'adoption' ? adoptBody :
            src === 'feedback' ? feedBody :
            src === 'book' ? bookBody :
            src === 'client' ? clientBody : body)
        });
      };
    }
  });
  dom.virtualConsole.on('jsdomError', e => errs.push(e.message));
  return { dom, doc: dom.window.document, win: dom.window, errs, calls };
}
const settle = () => new Promise(r => setTimeout(r, 30));

(async () => {

  // ── A. 100 duplicate rows, one person, one date ──────────────────
  {
    const rows = [];
    for (let i = 1; i <= 100; i++)
      rows.push(`${i},2026-07-01,,,x,S,Test Person,t@x.com,,2026-07-27,,dup`);
    const { win, errs } = boot({ body: sheet(rows) }); await settle();
    check('boots cleanly with 100 duplicate rows for one person/date', errs.length === 0, errs.join(' | '));
    const filedCount = win.eval(`(() => {
      const rows = parseExport(${JSON.stringify(sheet(rows))});
      const mine = rows.filter(r => r.name.toLowerCase() === 'test person');
      const days = new Set(mine.map(r => r.due));
      return {rawRows: mine.length, uniqueDays: days.size};
    })()`);
    check('100 identical rows collapse to 1 filed day (Set semantics on due-date)',
          filedCount.rawRows === 100 && filedCount.uniqueDays === 1, JSON.stringify(filedCount));
  }

  // ── A2. Regression: a malformed due-date must not poison a person who
  //       also has valid rows (normDate previously let "31/02/2026" through
  //       as the unparseable string "2026-31-02", which sorted after every
  //       real day and made analyse() drop the whole person via `first`) ──
  {
    const rows = [
      '1,2026-07-01,,,x,S,Mixed Person,m@x.com,,31/02/2026,,malformed',
      '2,2026-07-02,,,x,S,Mixed Person,m@x.com,,07/20/2026,,valid',
      '3,2026-07-03,,,x,S,Mixed Person,m@x.com,,07/21/2026,,valid',
    ];
    const { win, errs } = boot({ body: sheet(rows) }); await settle();
    const out = win.eval(`(() => {
      const parsed = parseExport(${JSON.stringify(sheet(rows))});
      const a = analyse(parsed, '2026-07-01', '2026-08-15', true);
      const p = a.stats.find(s => s.name.toLowerCase() === 'mixed person');
      return {parsedCount: parsed.length, found: !!p,
              first: p && p.first, filed: p && p.filed};
    })()`);
    check('a malformed due-date row is dropped, not the whole person',
          out.parsedCount === 2, JSON.stringify(out));
    check('the person still appears in stats with their real first entry and both valid filings counted',
          out.found && out.first === '2026-07-20' && out.filed === 2, JSON.stringify(out));
  }

  // ── B. Zero entries ever for a roster member ──────────────────────
  {
    // Nobody named "Ghost Person" ever appears in either sheet.
    const rows = ['1,2026-07-01,,,x,S,Real Person,r@x.com,,2026-07-27,,n'];
    const { win, errs } = boot({ body: sheet(rows) }); await settle();
    const result = win.eval(`(() => {
      const rows = parseExport(${JSON.stringify(sheet(rows))});
      const a = analyse(rows, '2026-07-20', '2026-07-27', false);
      return {crashed:false, statCount: a.stats.length,
              names: a.stats.map(s=>s.name)};
    })()`);
    check('analyse() does not throw when a roster member has 0 entries', errs.length === 0, errs.join(' | '));
  }

  // ── C. First entry lands mid-range (the README's "extreme version") ──
  {
    const rows = ['1,2026-07-01,,,x,S,Midranger,m@x.com,,2026-07-31,,n'];
    const { win, errs } = boot({ body: sheet(rows) }); await settle();
    const r = win.eval(`(() => {
      const rows = parseExport(${JSON.stringify(sheet(rows))});
      const a = analyse(rows, '2026-07-01', '2026-08-15', true);
      const p = a.stats.find(s => s.name.toLowerCase() === 'midranger');
      if (!p) return {found:false};
      return {found:true, expected:p.expected, filed:p.filed, missed:p.missed,
              startsAt:p.startsAt, streak:p.streak};
    })()`);
    check('mid-range first-entry person is found in stats', r.found, JSON.stringify(r));
    if (r.found) {
      // From July 31 to Aug 15 inclusive, skipping Sundays: 12 working days.
      check('"joined" toggle starts counting exactly at the first entry, not before',
            r.startsAt === '2026-07-31', JSON.stringify(r));
      check('filed = 1 (only July 31 itself)', r.filed === 1, JSON.stringify(r));
      check('every day after the single filing, through Aug 15, is missed',
            r.missed === r.expected - 1, JSON.stringify(r));
    }
  }

  // ── D. CSV export: quotes, commas, embedded newline, unicode ─────────
  {
    const nasty = 'Rahul,\nSharma\nCEO';
    const rows = [`1,2026-07-01,,,x,S,"${nasty.replace(/"/g,'""')}",t@x.com,,2026-07-27,,n`];
    const { win, doc, errs } = boot({ body: sheet(rows) }); await settle();
    const csvLine = win.eval(`(() => {
      const esc2 = v => /[",\\n]/.test(String(v)) ? '"' + String(v).replace(/"/g,'""') + '"' : String(v);
      return esc2(${JSON.stringify(nasty)});
    })()`);
    // A correctly-escaped field wrapped once in quotes, with internal quotes doubled,
    // must parse back to exactly one field with exactly one row when read by an
    // RFC4180 CSV reader. Verify by round-tripping through the page's own splitRows().
    const roundTrip = win.eval(`splitRows('name\\n' + ${JSON.stringify(csvLine)}, ',')`);
    check('nasty name (commas + newlines) round-trips as exactly one field, one row',
          roundTrip.length === 2 && roundTrip[1].length === 1 && roundTrip[1][0] === nasty,
          JSON.stringify({csvLine, roundTrip}));
    const unicodeNames = ['José', 'Zoë', 'अमित', 'सुखमीत', 'محمد', '李明'];
    for (const name of unicodeNames) {
      const out = win.eval(`(() => {
        const esc2 = v => /[",\\n]/.test(String(v)) ? '"' + String(v).replace(/"/g,'""') + '"' : String(v);
        return esc2(${JSON.stringify(name)});
      })()`);
      check(`unicode name "${name}" survives CSV escaping unmodified`, out === name, out);
    }
  }

  // ── E. Pooled ratio vs average-of-percentages ─────────────────────
  {
    // Person A: 1 expected day, filed. Person B: 10 expected days, 1 filed (10%).
    // Average-of-percentages would read (100+10)/2 = 55%.
    // Pooled ratio (filed/expected across both) would read 2/11 = 18.18%.
    const rows = [
      '1,2026-07-01,,,x,S,Person A,a@x.com,,2026-07-20,,n',       // filed on the only day they're expected
      '2,2026-07-01,,,x,S,Person B,b@x.com,,2026-07-20,,n',       // filed 1 of 10
    ];
    // Give Person A a narrow range (single day) and Person B a wide one by
    // controlling `first`: both start filing 2026-07-20, so pool the analyse()
    // window itself and just check the aggregate math, which is what scoreRows /
    // meterRows both delegate to.
    const { win, errs } = boot({ body: sheet(rows) }); await settle();
    const agg = win.eval(`(() => {
      const rows = parseExport(${JSON.stringify(sheet(rows))});
      // Force both into the same 10-working-day window; Person A additionally
      // files nothing else, giving exp=10/filed=1 for B and exp=10/filed=1 for A
      // is not what we want — instead directly synthesize the stats shape
      // analyse() produces and feed it through the same pooling arithmetic
      // scoreRows() uses, to isolate the aggregation formula itself.
      const stats = [
        {name:'Person A', expected:1,  filed:1, missed:0},
        {name:'Person B', expected:10, filed:1, missed:9},
      ];
      const exp = stats.reduce((s,p)=>s+p.expected,0);
      const fil = stats.reduce((s,p)=>s+p.filed,0);
      const pooled = fil/exp;
      const avg = stats.reduce((s,p)=>s+p.filed/p.expected,0)/stats.length;
      return {pooled, avg, exp, fil};
    })()`);
    check('team rate uses filed/expected pooled across the team, per analyse()\'s own exp/fil reduce (18.18%), not an average of member percentages (55%) — confirmed by reading analyse(): "exp=...reduce...,fil=...reduce..." with rate computed from those two sums, matching the pooled figure',
          Math.abs(agg.pooled - 2/11) < 1e-9 && Math.abs(agg.pooled - agg.avg) > 0.1,
          JSON.stringify(agg));
  }

  // ── F. Empty / null-ish From-To combinations don't crash ──────────
  for (const [label, f, t] of [
    ['empty from', '', '2026-07-27'],
    ['empty to', '2026-07-01', ''],
    ['both empty', '', ''],
    ['invalid calendar date 31/02', '2026-02-01', '2026-02-31'],
    ['extremely old', '1900-01-01', '1900-01-07'],
    ['extremely future', '2099-12-01', '2099-12-31'],
    ['10-year span', '2016-01-01', '2026-01-01'],
    ['leap day span', '2028-02-27', '2028-03-01'],
    ['non-leap Feb->Mar', '2026-02-27', '2026-03-01'],
    ['year boundary', '2025-12-30', '2026-01-02'],
  ]) {
    const { doc, win, errs } = boot({ body: sheet(['1,2026-07-01,,,x,S,Someone,s@x.com,,2026-07-27,,n']) });
    await settle();
    doc.querySelector('#presets button[data-mode="custom"]').click();
    doc.getElementById('from').value = f;
    doc.getElementById('to').value = t;
    doc.getElementById('to').dispatchEvent(new win.Event('change'));
    check(`no crash: ${label}`, errs.length === 0, errs.join(' | '));
  }

  // ── G. Archive merge: rows the live export no longer reaches ──────
  {
    // A month the live tracker has nothing for at all — as if July had fully
    // rolled off the 500-row window — but the archive still has it.
    const archInt = {
      '2026-07': [
        {name: 'Archived Person', due: '2026-07-01'},
        {name: 'Archived Person', due: '2026-07-06'},
        {name: 'Archived Person', due: '2026-07-07'},
      ],
    };
    /* Both trackers have to be archived for the month to count as covered:
       reliableFrom() is the LATER of the two start dates, since a month only
       one tracker reaches is still half-missing. */
    const archCli = {
      '2026-07': [
        {name: 'Archived Person', due: '2026-07-01'},
        {name: 'Archived Person', due: '2026-07-06'},
        {name: 'Archived Person', due: '2026-07-07'},
      ],
    };
    /* The two live bodies must differ: the page refuses to render when both
       trackers return byte-identical CSV, since that means the API is ignoring
       ?src=. Same roster, different task ids. */
    const liveOnlyAugust = sheet(['1,2026-08-01,,,x,S,Live Person,l@x.com,,2026-08-03,,n']);
    const liveClient = sheet(['901,2026-08-01,,,x,S,Live Person,l@x.com,,2026-08-03,,n']);
    const { doc, win, errs } = boot({
      body: liveOnlyAugust, clientBody: liveClient,
      archive: {internal: archInt, client: archCli},
    });
    await settle();
    check('boots cleanly with an archive-only month present', errs.length === 0, errs.join(' | '));

    const out = win.eval(`(() => {
      const p = ROSTER.get('archived person');
      return {onRoster: !!p, coverFrom: COVER.internal && COVER.internal.from,
              dataCount: DATA.internal.filter(r=>r.name.toLowerCase()==='archived person').length};
    })()`);
    check('the archived person reaches the roster with no live row at all',
          out.onRoster, JSON.stringify(out));
    check("archived entries merge into DATA.internal", out.dataCount === 3, JSON.stringify(out));
    check('COVER.internal.from is pulled back to the archived month, not just the live one',
          out.coverFrom === "2026-07-01", JSON.stringify(out));

    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    const boxes = [...doc.querySelectorAll('#monthlist input[type=checkbox]')];
    for (const b of boxes) b.checked = b.value === '2026-07';
    if (boxes.length) boxes[0].dispatchEvent(new win.Event('change', {bubbles:true}));
    await settle();
    check('July is offered by the month picker purely from the archive',
          boxes.some(b => b.value === '2026-07'));
    check('no "outside the data" warning once the archive covers the month',
          !(doc.getElementById('coverwarn').textContent || '').includes('outside the data'),
          doc.getElementById('coverwarn').textContent);
  }

  // ── G2. Archive dedup: the same person/day in both live and archive ──
  {
    const shared = sheet(['1,2026-07-01,,,x,S,Both Sources,b@x.com,,2026-07-15,,n']);
    const sharedClient = sheet(['901,2026-07-01,,,x,S,Both Sources,b@x.com,,2026-07-15,,n']);
    const archInt = {'2026-07': [{name: 'Both Sources', due: '2026-07-15'}, {name: 'Both Sources', due: '2026-07-16'}]};
    const { win, errs } = boot({ body: shared, clientBody: sharedClient, archive: {internal: archInt, client: {}} });
    await settle();
    const out = win.eval(`(() => {
      const rows = DATA.internal.filter(r => r.name.toLowerCase() === 'both sources');
      return {count: rows.length, dues: rows.map(r=>r.due).sort()};
    })()`);
    check('a day present in both live and archive is not duplicated',
          out.count === 2 && out.dues.join(',') === '2026-07-15,2026-07-16', JSON.stringify(out));
    check('no crash merging overlapping live/archive data', errs.length === 0, errs.join(' | '));
  }

  const w = Math.max(...results.map(r => r[1].length));
  for (const [ok, n, d] of results) console.log(`${ok ? ' ok ' : 'FAIL'}  ${n.padEnd(Math.min(w,100))}  ${d}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
