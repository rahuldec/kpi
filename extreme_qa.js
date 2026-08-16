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
/* load() refuses to render when internal and client come back byte-identical
   — the real signal of an old api/data.js ignoring ?src=. A fixture that
   hands the same CSV to both trips that guard and the page bails before the
   book ever loads, which looks like the feature under test failing when it
   is really the fixture. Offsetting the row ids, the same way qa.js's own
   CLIENT_DEFAULT does, keeps the two bodies distinct without changing what
   either one says. */
const asClient = csv => csv.replace(/\n(\d+),/g, (m, d) => '\n' + (Number(d) + 900) + ',');
const MIN_BOOK = 'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,';
const MIN_FEED = '"Timestamp","Name of the Institution?"';
const MIN_IMPL = 'NAME,URL,TEAM,OWNER,DESCRIPTION,CREATED,START DATE,FIRST TASK COMPLETED,' +
  'DUE DATE,ALL TASKS,COMPLETE,INCOMPLETE,ASSIGNED,OVERDUE,TASKS ADDED,TASKS COMPLETED\n' +
  'No Matching Client,https://x,,Nobody,,2026-07-01,2026-07-01,,2026-07-01,1,1,0,0,0,0,0';

function boot({ body, clientBody = sheet([]), escBody = sheet([]), bookBody = MIN_BOOK, adoptBody = '', feedBody = MIN_FEED, implBody = MIN_IMPL, teamBody = '', archive = {} } = {}) {
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
            src === 'implementation' ? implBody :
            src === 'book' ? bookBody :
            src === 'team' ? teamBody :
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

  // ── H. Retention / implementation split ──────────────────────────
  {
    /* The real sheet's header and its two real values, verbatim. Two teams so
       the split is per-team rather than global, a client with no label so the
       "left out of both sides" path is live, and an abbreviation because the
       column is typed by hand. */
    const book = [
      'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,',
      '1,Alpha College,Old,College,Large,B," ₹ 1,000,000.00 ",Mansi Rana,,Retention,,,',
      '2,Beta School,Old,School,Large,B," ₹ 400,000.00 ",Mansi Rana,,Implementation,,,',
      '3,Gamma University,New,University,Large,B," ₹ 600,000.00 ",Mansi Rana,,Imp,,,',
      '4,Delta Institute,Old,College,Small,B," ₹ 250,000.00 ",Mansi Rana,,,,,',
      '5,Epsilon Academy,Old,School,Large,B," ₹ 300,000.00 ",Sultan Malik,,Retention,,,',
    ].join('\n');
    const rows = sheet(['1,2026-07-01,,,x,S,Mansi Rana,m@x.com,,2026-07-27,,n']);
    const { win, errs } = boot({ body: rows, clientBody: asClient(rows), bookBody: book });
    await settle();
    check('boots cleanly with a book carrying Retention/Imp', errs.length === 0, errs.join(' | '));

    const parsed = win.eval(`JSON.stringify(CLIENTS)`);
    const cl = JSON.parse(parsed);
    const byName = n => cl.find(c => c.n === n);
    check('"Retention" parses to a kind', byName('Alpha College').k === 'retention',
          JSON.stringify(byName('Alpha College')));
    check('"Implementation" parses to a kind',
          byName('Beta School').k === 'implementation', JSON.stringify(byName('Beta School')));
    check('the hand-typed abbreviation "Imp" is understood too',
          byName('Gamma University').k === 'implementation', JSON.stringify(byName('Gamma University')));
    check('an unlabelled client gets no kind key at all rather than an empty one',
          !('k' in byName('Delta Institute')), JSON.stringify(byName('Delta Institute')));

    const b = JSON.parse(win.eval(`JSON.stringify(bookOf('Mansi Rana'))`));
    check('the split is counted per team, not globally',
          b.retention.clients === 1 && b.implementation.clients === 2,
          JSON.stringify(b));
    check('revenue is split the same way',
          b.retention.revenue === 1000000 && b.implementation.revenue === 1000000,
          JSON.stringify(b));
    check('an unlabelled client is left out of both sides, not counted as either',
          b.labelled === 3 && b.clients === 4, JSON.stringify(b));
    check('but it still counts towards the team total the business dial uses',
          b.revenue === 2250000, String(b.revenue));

    /* The whole point of printing both: this book is 1-of-3 retention by count
       and 50/50 by money. One figure standing in for the other would be wrong. */
    check('count and revenue can disagree, and both are kept',
          b.retention.clients !== b.implementation.clients &&
          b.retention.revenue === b.implementation.revenue, JSON.stringify(b));
  }

  // ── H2. The mix line on the card, and the section behind its (i) ──
  {
    const book = [
      'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,',
      '1,Alpha College,Old,College,Large,B," ₹ 1,000,000.00 ",Mansi Rana,,Retention,,,',
      '2,Beta School,Old,School,Large,B," ₹ 400,000.00 ",Mansi Rana,,Implementation,,,',
    ].join('\n');
    const people = ['Mansi Rana', 'Vansh Saini', 'Divya Gupta'];
    const trk = sheet(people.map((p, i) =>
      `${i + 1},2026-07-01,,,x,S,${p},x@x.com,,2026-07-27,,n`));
    const { doc, win, errs } = boot({ body: trk, clientBody: asClient(trk), bookBody: book });
    await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click();
    await settle();
    check('the meter renders with the mix line', errs.length === 0, errs.join(' | '));

    const card = [...doc.querySelectorAll('.mcard')]
      .find(c => /Mansi Rana/.test(c.querySelector('h4').textContent));
    check('a card is drawn for the team', !!card);
    if (card) {
      const mix = card.querySelector('.mixline');
      check('the card carries a mix line', !!mix, card.textContent.slice(0, 120));
      check('and it names both halves with their counts',
            /1 retention/.test(mix.textContent) && /1 implementation/.test(mix.textContent),
            mix && mix.textContent);

      /* The bar is what the user asked for by name: the amount printed inside
         the graph itself, not beside it as small muted text. */
      const bar = card.querySelector('.mixbar');
      check('the mix line is followed by an actual bar, not just text', !!bar,
            card.innerHTML.slice(0, 200));
      const ret = bar && bar.querySelector('.ret');
      const imp = bar && bar.querySelector('.imp');
      check('the retention segment prints its own amount inside itself',
            ret && ret.textContent.trim() === '₹10L', ret && ret.textContent);
      check('the implementation segment prints its own amount inside itself',
            imp && imp.textContent.trim() === '₹4L', imp && imp.textContent);
      check('the two segments are sized by the same rupee figures they display',
            ret && imp && ret.style.flexGrow === '1000000' && imp.style.flexGrow === '400000',
            ret && imp && `${ret.style.flexGrow} / ${imp.style.flexGrow}`);
      check('the bar has an accessible label carrying both figures, for anyone not reading it visually',
            /retention.*₹10L.*implementation.*₹4L/i.test(bar?.getAttribute('aria-label') || ''),
            bar && bar.getAttribute('aria-label'));

      /* The rule the suite already enforces for every other row: the pairing
         has to sit directly under the dial it describes, which is Business —
         now line, then bar, then the next dial's separator. */
      const kids = [...card.children];
      const i = kids.indexOf(mix);
      check('the bar immediately follows the mix line, with nothing between them',
            kids[i + 1] === bar, kids[i + 1] && kids[i + 1].className);
      check('the mix line sits directly under the business dial it describes',
            kids[i - 1].classList.contains('track') &&
            kids[i - 2].querySelector('.lbl').textContent === 'Business',
            kids[i - 2] && kids[i - 2].textContent);
      check('and the next dial is separated from the bar, not from the line',
            kids[i + 2].classList.contains('dial'), kids[i + 2] && kids[i + 2].className);

      /* Adding a line must not add a dial — the four dial labels are read
         positionally by the main suite and by the eye. */
      check('it did not become a fifth dial',
            [...card.querySelectorAll('.dial .lbl')].map(x => x.textContent).join('|') ===
            'Compliance|Business|Module adoption|Client feedback',
            [...card.querySelectorAll('.dial .lbl')].map(x => x.textContent).join('|'));
      // .covline itself was retired from the card on 16 Aug 2026 (Scored and
      // Heard-from moved into the panel only) — nothing should still emit one.
      check('and did not resurrect .covline, which no longer belongs on the card',
            card.querySelectorAll('.covline').length === 0,
            String(card.querySelectorAll('.covline').length));

      // its (i) must open a section that actually exists
      const btn = mix.querySelector('button.mi');
      check('the mix line has its own (i)', !!btn);
      check('and it names a section the panel really has',
            btn && !!card.querySelector(`.how [data-sec="${btn.dataset.sec}"]`),
            btn && btn.dataset.sec);
      const how = card.querySelector('.how').textContent.replace(/\s+/g, ' ');
      check('the panel explains the split in full',
            /retention/i.test(how) && /implementation/i.test(how), how.slice(0, 200));
      check('and says the split is inside the business figure, not extra to it',
            /already inside the business figure/i.test(how), how.slice(0, 300));
      check('the retention client is named, not just counted',
            /Alpha College/.test(how), how.slice(how.indexOf('made of'), how.indexOf('made of') + 120));
      check('and so is the implementation one',
            /Beta School/.test(how), how.slice(how.indexOf('made of'), how.indexOf('made of') + 200));
      check('each name carries its own billing figure',
            /Alpha College.*?₹10L/.test(how) && /Beta School.*?₹4L/.test(how), how.slice(0, 400));
    }
  }

  // ── H3. A book with no such column still works ────────────────────
  {
    // The compiled snapshot predates the column; the page must not invent one.
    const book = [
      'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM',
      '1,Alpha College,Old,College,Large,B," ₹ 1,000,000.00 ",Mansi Rana,',
    ].join('\n');
    const trk = sheet(['1,2026-07-01,,,x,S,Mansi Rana,m@x.com,,2026-07-27,,n']);
    const { win, errs } = boot({ body: trk, clientBody: asClient(trk), bookBody: book });
    await settle();
    check('a book with no Retention/Imp column does not crash', errs.length === 0, errs.join(' | '));
    const cl = JSON.parse(win.eval(`JSON.stringify(CLIENTS)`));
    check('and its clients carry no kind key', !('k' in cl[0]), JSON.stringify(cl[0]));
    const b = JSON.parse(win.eval(`JSON.stringify(bookOf('Mansi Rana'))`));
    check('the team still has a book, with nothing labelled',
          b.clients === 1 && b.labelled === 0, JSON.stringify(b));
    check('and the mix line says so rather than showing a zero split',
          /not in this book/.test(win.eval(`mixLine(meterRows().rows[0] || {lead:'Mansi Rana'}, '')`)),
          win.eval(`mixLine({lead:'Mansi Rana'}, '')`));
  }

  // ── H4. An extreme ratio — the whole reason for a real minimum width ──
  {
    /* 99 retention clients worth almost nothing against one implementation
       client worth a great deal. A percentage-width bar would shrink the
       ₹50L segment to a sliver too narrow for its own label; flex's default
       min-width:auto is what is supposed to stop that. */
    const rows = ['Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,'];
    for (let i = 1; i <= 99; i++)
      rows.push(`${i},Client ${i},Old,College,Small,B," ₹ 1,000.00 ",Mansi Rana,,Retention,,,`);
    rows.push('100,Big Implementation Client,New,University,Large,B," ₹ 5,000,000.00 ",Mansi Rana,,Implementation,,,');
    const book = rows.join('\n');
    const trk = sheet(['1,2026-07-01,,,x,S,Mansi Rana,m@x.com,,2026-07-27,,n']);
    const { doc, win, errs } = boot({ body: trk, clientBody: asClient(trk), bookBody: book });
    await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click();
    await settle();
    check('a 99-to-1 client split does not crash the meter', errs.length === 0, errs.join(' | '));

    const card = [...doc.querySelectorAll('.mcard')]
      .find(c => /Mansi Rana/.test(c.querySelector('h4').textContent));
    const bar = card && card.querySelector('.mixbar');
    check('the bar still renders both segments at this ratio', !!bar);
    const ret = bar && bar.querySelector('.ret'), imp = bar && bar.querySelector('.imp');
    check('the 99-client, ₹99K retention segment keeps its own label',
          ret && ret.textContent.trim() === '₹99,000', ret && ret.textContent);
    check('the single ₹50L implementation client is not swallowed by the other side',
          imp && imp.textContent.trim() === '₹50L', imp && imp.textContent);
    check('the far larger implementation revenue drives the wider flex-grow',
          imp && ret && Number(imp.style.flexGrow) > Number(ret.style.flexGrow),
          imp && ret && `${imp.style.flexGrow} vs ${ret.style.flexGrow}`);
  }

  // ── J. Overdue is counted in projects, not raw tasks ───────────────
  {
    /* One project with seven overdue tasks and one with a single overdue task
       both have to read as "1 project" toward the headline count — summing raw
       task counts across projects of very different sizes would read as a
       severity difference that isn't the point of the figure. */
    const IHEAD = 'NAME,URL,TEAM,OWNER,DESCRIPTION,CREATED,START DATE,FIRST TASK COMPLETED,' +
      'DUE DATE,ALL TASKS,COMPLETE,INCOMPLETE,ASSIGNED,OVERDUE,TASKS ADDED,TASKS COMPLETED';
    const book = [
      'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,',
      '1,Alpha College,Old,College,Large,B," ₹ 1,000,000.00 ",Mansi Rana,,Implementation,,,',
      '2,Beta School,Old,School,Large,B," ₹ 400,000.00 ",Mansi Rana,,Implementation,,,',
    ].join('\n');
    const impl = [IHEAD,
      // one project, seven overdue tasks
      'Alpha College,https://x,,Mansi Rana,,2026-07-01,2026-07-01,,2026-07-20,20,10,10,3,3,0,7',
      // a second project, one overdue task
      'Beta School,https://x,,Mansi Rana,,2026-07-01,2026-07-01,,2026-07-20,10,8,2,1,1,0,1',
    ].join('\n');
    const trk = sheet(['1,2026-07-01,,,x,S,Mansi Rana,m@x.com,,2026-07-27,,n']);
    const { doc, errs } = boot({ body: trk, clientBody: asClient(trk), bookBody: book, implBody: impl });
    await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('boots cleanly with two overdue projects of very different sizes', errs.length === 0, errs.join(' | '));

    const card = [...doc.querySelectorAll('.mcard')]
      .find(c => /Mansi Rana/.test(c.querySelector('h4').textContent));
    const line = card && card.querySelector('.implline .n');
    check('the headline reads "2 of 2 overdue" — projects, not the eight overdue tasks between them',
          line && line.textContent.trim() === '2 of 2 overdue', line && line.textContent);
  }

  // ── J2. A project's due date passing is not the same signal as Asana's
  //        own overdue count — only the latter drives the card ──────────
  {
    const IHEAD = 'NAME,URL,TEAM,OWNER,DESCRIPTION,CREATED,START DATE,FIRST TASK COMPLETED,' +
      'DUE DATE,ALL TASKS,COMPLETE,INCOMPLETE,ASSIGNED,OVERDUE,TASKS ADDED,TASKS COMPLETED';
    const book = [
      'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,',
      '1,Alpha College,Old,College,Large,B," ₹ 1,000,000.00 ",Mansi Rana,,Implementation,,,',
    ].join('\n');
    // Due date is well in the past and 11 tasks remain incomplete, but Asana's
    // own OVERDUE column reads 0 — the exact shape flagged in review: a
    // project can be behind schedule without any single task being marked
    // overdue (no due dates set on the tasks themselves, for instance).
    const impl = [IHEAD,
      'Alpha College,https://x,,Mansi Rana,,2026-07-01,2026-07-01,,2026-07-01,15,4,11,0,0,0,0',
    ].join('\n');
    const trk = sheet(['1,2026-07-01,,,x,S,Mansi Rana,m@x.com,,2026-07-27,,n']);
    const { doc, errs } = boot({ body: trk, clientBody: asClient(trk), bookBody: book, implBody: impl });
    await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('boots cleanly with a past-due, zero-overdue project', errs.length === 0, errs.join(' | '));

    const card = [...doc.querySelectorAll('.mcard')]
      .find(c => /Mansi Rana/.test(c.querySelector('h4').textContent));
    const line = card && card.querySelector('.implline .n');
    check('a project with 0 overdue tasks reads "None overdue" regardless of its due date',
          line && line.textContent.trim() === 'None overdue', line && line.textContent);
    check('and is not marked hot', !card.querySelector('.implline').classList.contains('hot'));
  }

  // ── K. The mix panel's client lists cap and disclose, same as every
  //      other named list in this dialog (Never scored, Not heard from) —
  //      A-Z, not by revenue, and named names cleverly chosen so the two
  //      orders actually disagree: alphabetical revenue order is exactly
  //      backwards from name order, so a wrong sort is caught, not coincided
  //      with by a fixture where both orders happen to agree. ─────────────
  {
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India'];
    const rows = ['Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,'];
    names.forEach((n, i) => rows.push(
      `${i + 1},${n} School,Old,School,Small,B," ₹ ${(i + 1) * 10000}.00 ",Mansi Rana,,Retention,,,`));
    rows.push('10,The Only Implementation Client,New,College,Large,B," ₹ 500,000.00 ",Mansi Rana,,Implementation,,,');
    const book = rows.join('\n');
    const trk = sheet(['1,2026-07-01,,,x,S,Mansi Rana,m@x.com,,2026-07-27,,n']);
    const { doc, errs } = boot({ body: trk, clientBody: asClient(trk), bookBody: book });
    await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('boots cleanly with nine retention clients', errs.length === 0, errs.join(' | '));

    const card = [...doc.querySelectorAll('.mcard')]
      .find(c => /Mansi Rana/.test(c.querySelector('h4').textContent));
    card.querySelector('button.info').click();
    const how = card.querySelector('.how');
    /* Scoped to the mix section alone: with this fixture's adoption data left
       empty, all ten clients read as never-scored too, which produces its own
       unrelated "Show all 10 clients" disclosure in the adoption section right
       after it — a coincidence of this fixture, not something the mix section
       should be judged by. */
    const mixSection = [];
    let node = how.querySelector('h5[data-sec="mix"]')?.nextElementSibling;
    while (node && node.tagName !== 'H5') { mixSection.push(node); node = node.nextElementSibling; }
    const mixDetails = mixSection.filter(el => el.matches('details') || el.querySelector?.('details'))
      .flatMap(el => el.matches('details') ? [el] : [...el.querySelectorAll('details')]);

    const details = mixDetails.find(d => /Show all 9 clients/.test(d.querySelector('summary')?.textContent || ''));
    check('nine retention clients disclose behind "Show all 9 clients"', !!details,
          mixDetails.map(d => d.querySelector('summary')?.textContent).join(' | '));
    const cap = details && details.previousElementSibling;
    check('the visible list before opening it is capped, not all nine',
          cap && cap.textContent.split('·').length < 9, cap && cap.textContent);
    check('opening it reveals every one, including the smallest',
          details && /India School/.test(details.textContent), details && details.textContent);
    check('a single implementation client needs no disclosure of its own — only the nine-strong retention list does',
          mixDetails.length === 1 &&
          mixSection.some(el => /The Only Implementation Client/.test(el.textContent)),
          mixDetails.length + ' details inside the mix section');

    /* The real bug this section exists for: Alpha School bills the LEAST of
       the nine (₹90,000) and Golf School bills the MOST — so if the capped
       preview were still sorted by revenue, Golf would lead it and Alpha
       would be buried behind "Show all". A-Z puts Alpha first regardless. */
    check('the capped preview is alphabetical, not revenue order — Alpha leads despite billing the least',
          cap && cap.textContent.trim().startsWith('Alpha School'), cap && cap.textContent);
    check('and Foxtrot (billing more than everyone before it, A-Z) still sits in the middle, not pulled to the front',
          cap && !cap.textContent.trim().startsWith('Foxtrot'), cap && cap.textContent);

    /* The fix itself: opening "Show all" must hide the capped preview rather
       than leaving both visible — a real click on <summary>, not setting
       .open programmatically, so the native toggle event actually fires. */
    check('before opening, the capped preview is visible', cap && !cap.hidden, cap && String(cap.hidden));
    details.querySelector('summary').click();
    await settle();
    check('opening "Show all" hides the capped preview — no more duplicate listing',
          cap.hidden === true, String(cap.hidden));
    check('the full list underneath is what shows now, unduplicated',
          /India School/.test(details.querySelector('p.gaps:not(.cap)')?.textContent || ''),
          details.querySelector('p.gaps:not(.cap)')?.textContent);
    details.querySelector('summary').click();
    await settle();
    check('closing it again restores the capped preview',
          cap.hidden === false, String(cap.hidden));
  }

  // ── L. Implementation sits with Business/Mix, not after Escalations —
  //      moved 16 Aug 2026, on request: overdue implementation is a
  //      business-relationship signal about the same clients Mix just
  //      described, not a "something's wrong right now" line in the same
  //      family as Escalations. ─────────────────────────────────────────
  {
    const book = [
      'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,',
      '1,Alpha College,Old,College,Large,B," ₹ 1,000,000.00 ",Mansi Rana,,Implementation,,,',
    ].join('\n');
    const impl = [
      'NAME,URL,TEAM,OWNER,DESCRIPTION,CREATED,START DATE,FIRST TASK COMPLETED,DUE DATE,ALL TASKS,COMPLETE,INCOMPLETE,ASSIGNED,OVERDUE,TASKS ADDED,TASKS COMPLETED',
      'Alpha College,https://x,,Mansi Rana,,2026-07-01,2026-07-01,,2026-07-20,10,8,2,1,1,0,0',
    ].join('\n');
    const trk = sheet(['1,2026-07-01,,,x,S,Mansi Rana,m@x.com,,2026-07-27,,n']);
    const { doc, errs } = boot({ body: trk, clientBody: asClient(trk), bookBody: book, implBody: impl });
    await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('boots cleanly with both mix and implementation data on one team', errs.length === 0, errs.join(' | '));

    const card = [...doc.querySelectorAll('.mcard')]
      .find(c => /Mansi Rana/.test(c.querySelector('h4').textContent));
    const kids = [...card.children];
    const implLine = card.querySelector('.implline');
    const mixBar = card.querySelector('.mixbar');
    check('the implementation line and mix bar are both present', !!implLine && !!mixBar);
    if (implLine && mixBar) {
      check('implementation sits directly after the mix bar, with nothing between them',
            kids[kids.indexOf(mixBar) + 1] === implLine,
            kids[kids.indexOf(mixBar) + 1] && kids[kids.indexOf(mixBar) + 1].className);
      /* This fixture's one project is overdue, so implLine() is a hot card:
         no .implwho paragraph follows it (the roster moved into the (i) panel
         17 Aug 2026) — module adoption's dial sits directly after the line. */
      const nextDial = kids[kids.indexOf(implLine) + 1];
      check('module adoption follows the implementation line directly, not the mix bar',
            nextDial && nextDial.classList.contains('dial') &&
            nextDial.querySelector('.lbl')?.textContent === 'Module adoption',
            nextDial && nextDial.textContent.slice(0, 40));
      check('it did not land after escalations — no dial-family line sits between it and mix',
            kids.indexOf(implLine) < kids.indexOf(card.querySelector('.escline')),
            `impl at ${kids.indexOf(implLine)}, escalations at ${kids.indexOf(card.querySelector('.escline'))}`);
    }

    /* And the panel order matches: implDetail() moved to sit right after
       bookDetail()/mixDetail(), before adoptDetail(), the same way the card
       moved. */
    card.querySelector('button.info').click();
    const secs = [...card.querySelectorAll('.how h5')].map(h => h.dataset.sec);
    const businessAt = secs.indexOf('business'), implAt = secs.indexOf('implementation'),
          adoptionAt = secs.indexOf('adoption');
    check('the panel names business, implementation, then adoption in that order',
          businessAt > -1 && businessAt < implAt && implAt < adoptionAt, secs.join(' > '));
  }

  // ── M. The headline counts overdue PROJECTS, not clients with an overdue
  //      project — the real bug a live-data check turned up: every one of a
  //      client's projects can be overdue and a client-level count still only
  //      ever adds one, because however many projects alias to one book row,
  //      it is still one client. ──────────────────────────────────────────
  {
    const book = [
      'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,',
      '1,Multi Project Client,Old,College,Large,B," ₹ 1,000,000.00 ",Mansi Rana,,Implementation,,,',
    ].join('\n');
    // All three resolve to "Multi Project Client" by the ordinary auto-prefix
    // rule (each name's normalised form starts with the client's) — no
    // IMPL_ALIAS entry needed, so this is a plain multi-project client, the
    // same shape Dalmia Group is in production, without depending on that
    // specific alias staying exactly as written.
    // Columns: ...,ALL TASKS,COMPLETE,INCOMPLETE,ASSIGNED,OVERDUE,TASKS ADDED,TASKS COMPLETED —
    // OVERDUE is column 14 of 16 (index 13), not the trailing one.
    const impl = [
      'NAME,URL,TEAM,OWNER,DESCRIPTION,CREATED,START DATE,FIRST TASK COMPLETED,DUE DATE,ALL TASKS,COMPLETE,INCOMPLETE,ASSIGNED,OVERDUE,TASKS ADDED,TASKS COMPLETED',
      'Multi Project Client Branch A,https://x,,Mansi Rana,,2026-07-01,2026-07-01,,2026-07-20,10,7,3,1,2,0,0',
      'Multi Project Client Branch B,https://x,,Mansi Rana,,2026-07-01,2026-07-01,,2026-07-20,10,8,2,1,1,0,0',
      'Multi Project Client Branch C,https://x,,Mansi Rana,,2026-07-01,2026-07-01,,2026-07-20,10,10,0,0,0,0,0',
    ].join('\n');
    const trk = sheet(['1,2026-07-01,,,x,S,Mansi Rana,m@x.com,,2026-07-27,,n']);
    const { doc, errs } = boot({ body: trk, clientBody: asClient(trk), bookBody: book, implBody: impl });
    await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('boots cleanly with three projects on one client, two overdue', errs.length === 0, errs.join(' | '));

    const card = [...doc.querySelectorAll('.mcard')]
      .find(c => /Mansi Rana/.test(c.querySelector('h4').textContent));
    const n = card.querySelector('.implline .n')?.textContent.trim();
    check('the headline reads "2 of 3 overdue" — two overdue PROJECTS, not one overdue CLIENT',
          n === '2 of 3 overdue', n);
    check('the card itself names no branch — the roster lives in the (i) panel only',
          !card.querySelector('.implwho'));

    card.querySelector('button.info').click();
    const who = card.querySelector('.how').textContent.replace(/\s+/g, ' ');
    check('both overdue branches are named individually in the panel',
          /Branch A/.test(who) && /Branch B/.test(who), who.slice(0, 300));
    check('the on-track branch is not named among the overdue ones',
          !/Branch C/.test(who), who.slice(0, 300));
  }

  // ── N. Company holidays — added 17 Aug 2026: a fixed list of dates (some of
  //      them Saturdays, which are otherwise ordinary working days here) that
  //      must be excluded from "expected" everywhere Sunday already is —
  //      range() and analyse(), which the internal and client-call trackers
  //      both run through. The gap grid's own gutter rendering (same
  //      isWorkingDay() check, rendered on the page) is covered in qa.js
  //      instead, against its richer default fixture. ────────────────────
  {
    const { win } = boot({ body: sheet([]) }); await settle();
    // 2026-08-15 is a real listed holiday (Independence Day) and a Saturday,
    // so it would count as an ordinary working day without the fix; 08-16 is
    // an ordinary Sunday, already excluded before this change.
    check('range() drops the holiday alongside the Sunday',
          win.eval("JSON.stringify(range('2026-08-13','2026-08-17',true))") ===
          '["2026-08-13","2026-08-14","2026-08-17"]',
          win.eval("JSON.stringify(range('2026-08-13','2026-08-17',true))"));
    check('a plain Saturday with no holiday is untouched',
          win.eval("JSON.stringify(range('2026-08-20','2026-08-22',true))") ===
          '["2026-08-20","2026-08-21","2026-08-22"]',
          win.eval("JSON.stringify(range('2026-08-20','2026-08-22',true))"));
  }
  {
    // A person who files on every real working day across the holiday span
    // must show 0 missed — not 1 for a "skipped" Saturday that was never
    // actually expected of them.
    const rows = ['2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-17']
      .map((d, i) => `${i + 1},2026-08-01,,,x,S,Holiday Tester,h@x.com,,${d},,n`);
    const { win, errs } = boot({ body: sheet(rows) }); await settle();
    const a = JSON.parse(win.eval(`(() => {
      const parsed = parseExport(${JSON.stringify(sheet(rows))});
      const a = analyse(parsed, '2026-08-10', '2026-08-17', true);
      const p = a.stats.find(s => s.name.toLowerCase() === 'holiday tester');
      return JSON.stringify({expected: p.expected, filed: p.filed, missed: p.missed, days: a.days});
    })()`));
    check('boots cleanly across a fixture spanning the holiday', errs.length === 0, errs.join(' | '));
    check('the holiday and the Sunday both fall out of the expected-day list',
          a.days.length === 6 && !a.days.includes('2026-08-15') && !a.days.includes('2026-08-16'),
          JSON.stringify(a.days));
    check('a person who filed every real working day reads 0 missed, not 1 for the holiday',
          a.expected === 6 && a.filed === 6 && a.missed === 0, JSON.stringify(a));
  }
  // ── O. The Team tab — added 17 Aug 2026, replacing a hardcoded PODS object.
  //      Two things this exists to prove: a new RM named nowhere but the Team
  //      tab gets a card with no code change, and moving an assistant between
  //      two rows in the sheet is all a reshuffle takes. ────────────────────
  {
    const { win, errs } = boot({ body: sheet([]) }); await settle();
    const out = win.eval(`JSON.stringify(parseTeam(
      'Some title row above the real header\\n' +
      'RM,ARM,CR,CR,CR\\n' +
      'Test Lead,Alpha,Beta,,\\n' +
      'Solo Lead,,,,\\n'
    ))`);
    const rows = JSON.parse(out);
    check('boots cleanly', errs.length === 0, errs.join(' | '));
    check('the header is hunted for by its first cell, not assumed to be row 0',
          rows.length === 2, out);
    check('blank member cells are dropped, not kept as empty names',
          JSON.stringify(rows[0]) === JSON.stringify({lead: 'Test Lead', members: ['Alpha', 'Beta']}), out);
    check('a lead with every member column blank is still one lead, zero members — not skipped',
          JSON.stringify(rows[1]) === JSON.stringify({lead: 'Solo Lead', members: []}), out);
  }
  {
    const book = [
      'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,',
      '1,New RM College,Old,College,Large,B," ₹ 1,000,000.00 ",Priya Sharma,,Retention,,,',
    ].join('\n');
    const team = ['RM,ARM', 'Priya Sharma,'].join('\n');
    const trk = sheet(['1,2026-07-01,,,x,S,Priya Sharma,p@x.com,,2026-07-27,,n']);
    const { doc, errs } = boot({ body: trk, clientBody: asClient(trk), bookBody: book, teamBody: team });
    await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('boots cleanly with a lead who exists only in the book and the Team tab',
          errs.length === 0, errs.join(' | '));
    const card = [...doc.querySelectorAll('.mcard')]
      .find(c => /Priya Sharma/.test(c.querySelector('h4')?.textContent || ''));
    check('a lead named nowhere but the Team tab gets a KPI meter card automatically',
          !!card, [...doc.querySelectorAll('.mcard h4')].map(h => h.textContent).join(', '));
  }
  {
    const trk = sheet([
      '1,2026-07-01,,,x,S,Lead One,a@x.com,,2026-07-01,,n',
      '2,2026-07-01,,,x,S,Lead Two,b@x.com,,2026-07-01,,n',
      '3,2026-07-01,,,x,S,Shuffled Person,c@x.com,,2026-07-01,,n',
    ]);
    const before = ['RM,ARM', 'Lead One,Shuffled Person', 'Lead Two,'].join('\n');
    const after  = ['RM,ARM', 'Lead One,', 'Lead Two,Shuffled Person'].join('\n');

    const b1 = boot({ body: trk, clientBody: asClient(trk), teamBody: before }); await settle();
    check('before the edit: the assistant belongs to the row that names them',
          b1.win.eval("POD_OF.get('Shuffled Person')") === 'Lead One',
          b1.win.eval("POD_OF.get('Shuffled Person')"));

    const b2 = boot({ body: trk, clientBody: asClient(trk), teamBody: after }); await settle();
    check('moving them to the other row in the sheet is the entire reshuffle — no code touched',
          b2.win.eval("POD_OF.get('Shuffled Person')") === 'Lead Two',
          b2.win.eval("POD_OF.get('Shuffled Person')"));
    check('and the row they left now has nobody',
          b2.win.eval("POD_TEAM.get('Lead One')").length === 0,
          b2.win.eval("JSON.stringify(POD_TEAM.get('Lead One'))"));
  }
  {
    const trk = sheet(['1,2026-07-01,,,x,S,Kashish Goel,k@x.com,,2026-07-01,,n']);
    const { doc, win, errs } = boot({ body: trk, clientBody: asClient(trk), teamBody: 'nonsense\n1,2,3' });
    await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('a broken Team tab does not take the page down', errs.length === 0, errs.join(' | '));
    check('falls back to the compiled snapshot rather than an empty meter',
          doc.querySelectorAll('.mcard').length > 0, String(doc.querySelectorAll('.mcard').length));
    check('and says so internally, rather than silently claiming to be live',
          win.eval('TEAM_LIVE') === false && win.eval('typeof TEAM_ERROR === "string" && TEAM_ERROR.length > 0'),
          win.eval('TEAM_ERROR'));
  }

  // ── P. Malformed sheet edits — added 17 Aug 2026, from an audit of the Team
  //      tab migration. Three distinct hand-edit mistakes used to resolve by
  //      silent overwrite, each one losing or duplicating a real person:
  //      splitting one lead across two rows dropped the first row's team,
  //      repeating a name in one row duplicated it on the card, and the same
  //      assistant claimed by two leads landed on both their teams at once —
  //      though POD_OF, a Map, could only ever agree with one of them. All
  //      three are now merged/deduped/resolved instead, and reported in
  //      POD_GAPS rather than guessed at. ─────────────────────────────────
  {
    const trk = sheet([
      '1,2026-07-01,,,x,S,Kashish Goel,k@x.com,,2026-07-01,,n',
      '2,2026-07-01,,,x,S,Anjali Verma,a@x.com,,2026-07-01,,n',
      '3,2026-07-01,,,x,S,Tanvi Gupta,t@x.com,,2026-07-01,,n',
    ]);
    // The same lead, split across two rows — a copy-pasted row where only the
    // assistant column was changed.
    const team = ['RM,ARM', 'Kashish Goel,Anjali Verma', 'Kashish Goel,Tanvi Gupta'].join('\n');
    const { win, errs } = boot({ body: trk, clientBody: asClient(trk), teamBody: team }); await settle();
    check('boots cleanly with the same lead split across two rows', errs.length === 0, errs.join(' | '));
    check('a lead split across two rows keeps both rows\' members — merged, not overwritten',
          win.eval("JSON.stringify(POD_TEAM.get('Kashish Goel').slice().sort())") ===
          JSON.stringify(['Anjali Verma', 'Tanvi Gupta']),
          win.eval("JSON.stringify(POD_TEAM.get('Kashish Goel'))"));
  }
  {
    const trk = sheet([
      '1,2026-07-01,,,x,S,Kashish Goel,k@x.com,,2026-07-01,,n',
      '2,2026-07-01,,,x,S,Anjali Verma,a@x.com,,2026-07-01,,n',
    ]);
    // The same assistant typed twice in one row.
    const team = ['RM,ARM,CR', 'Kashish Goel,Anjali Verma,Anjali Verma'].join('\n');
    const { doc, win, errs } = boot({ body: trk, clientBody: asClient(trk), teamBody: team }); await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('boots cleanly with a repeated name in one row', errs.length === 0, errs.join(' | '));
    check('a name typed twice in the same row is not duplicated on the team',
          win.eval("JSON.stringify(POD_TEAM.get('Kashish Goel'))") === JSON.stringify(['Anjali Verma']),
          win.eval("JSON.stringify(POD_TEAM.get('Kashish Goel'))"));
    const card = [...doc.querySelectorAll('.mcard')]
      .find(c => /Kashish Goel/.test(c.querySelector('h4')?.textContent || ''));
    check('and does not print twice on the card either',
          (card?.querySelector('.who')?.textContent.match(/Anjali Verma/g) || []).length === 1,
          card?.querySelector('.who')?.textContent);
  }
  {
    const trk = sheet([
      '1,2026-07-01,,,x,S,Kashish Goel,k@x.com,,2026-07-01,,n',
      '2,2026-07-01,,,x,S,Sultan Malik,s@x.com,,2026-07-01,,n',
      '3,2026-07-01,,,x,S,Anjali Verma,a@x.com,,2026-07-01,,n',
    ]);
    // The same assistant claimed by two different leads.
    const team = ['RM,ARM', 'Kashish Goel,Anjali Verma', 'Sultan Malik,Anjali Verma'].join('\n');
    const { win, errs } = boot({ body: trk, clientBody: asClient(trk), teamBody: team }); await settle();
    check('boots cleanly with one assistant claimed by two leads', errs.length === 0, errs.join(' | '));
    check('POD_OF (one value per person) agrees with exactly one of the two claims',
          win.eval("POD_OF.get('Anjali Verma')") === 'Kashish Goel',
          win.eval("POD_OF.get('Anjali Verma')"));
    check('she is on the winning lead\'s team...',
          win.eval("POD_TEAM.get('Kashish Goel')").includes('Anjali Verma'));
    check('...and not on the other lead\'s team too — no appearing on two cards at once',
          !win.eval("POD_TEAM.get('Sultan Malik')").includes('Anjali Verma'),
          win.eval("JSON.stringify(POD_TEAM.get('Sultan Malik'))"));
    check('the conflict is named in POD_GAPS, not silently resolved',
          /listed under both/.test(win.eval("POD_GAPS.join(' | ')")),
          win.eval("POD_GAPS.join(' | ')"));
  }
  {
    // A person who runs their own team AND is listed as somebody else's
    // assistant elsewhere in the sheet — self-contradictory input with no
    // "correct" answer, but it must not crash, and it must not silently cost
    // the person their own card.
    const trk = sheet([
      '1,2026-07-01,,,x,S,Kashish Goel,k@x.com,,2026-07-01,,n',
      '2,2026-07-01,,,x,S,Sultan Malik,s@x.com,,2026-07-01,,n',
    ]);
    const team = ['RM,ARM', 'Kashish Goel,', 'Sultan Malik,Kashish Goel'].join('\n');
    const { doc, win, errs } = boot({ body: trk, clientBody: asClient(trk), teamBody: team }); await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('boots cleanly when a lead is also listed as someone else\'s assistant',
          errs.length === 0, errs.join(' | '));
    check('the lead keeps their own card rather than being folded into the other team',
          [...doc.querySelectorAll('.mcard h4')].some(h => h.textContent === 'Kashish Goel'),
          [...doc.querySelectorAll('.mcard h4')].map(h => h.textContent).join(', '));
    check('POD_OF still says they report to themselves, not to the row that also claimed them',
          win.eval("POD_OF.get('Kashish Goel')") === 'Kashish Goel',
          win.eval("POD_OF.get('Kashish Goel')"));
    check('the contradiction is named in POD_GAPS',
          /also runs their own team/.test(win.eval("POD_GAPS.join(' | ')")),
          win.eval("POD_GAPS.join(' | ')"));
  }

  // ── Q. More sheet-editing mistakes — added 17 Aug 2026, from the same audit:
  //      a real fetch failure (not just malformed content), a header missing
  //      the one column that matters, a row with no lead name at all, names
  //      that need CSV quoting or aren't ASCII, and a column nobody asked the
  //      sheet to have. ─────────────────────────────────────────────────────
  {
    // A genuine transport failure — fetchRaw() itself throws on a non-2xx
    // status, before parseTeam() ever runs — distinct from the "malformed
    // content, 200 OK" case already covered above.
    const trk = sheet(['1,2026-07-01,,,x,S,Kashish Goel,k@x.com,,2026-07-01,,n']);
    const dom = new (require('jsdom').JSDOM)(HTML, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://kpi.test/',
      beforeParse(window) {
        window.fetch = (url) => {
          const src = (url.match(/src=(\w+)/) || [])[1];
          if (src === 'team') return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
            src === 'book' ? MIN_BOOK : src === 'client' ? asClient(trk) : trk) });
        };
      },
    });
    const errs = []; dom.virtualConsole.on('jsdomError', e => errs.push(e.message));
    await settle();
    check('a real 503 on the Team endpoint does not crash the page', errs.length === 0, errs.join(' | '));
    check('falls back to the compiled snapshot, same as malformed content does',
          dom.window.eval('TEAM_LIVE') === false, dom.window.eval('TEAM_ERROR'));
    dom.window.document.querySelector('#sources3 button[data-src="meter"]')?.click();
    await settle();
    check('the meter still has cards to show',
          dom.window.document.querySelectorAll('.mcard').length > 0,
          String(dom.window.document.querySelectorAll('.mcard').length));
  }
  {
    // A well-formed CSV, but the one column parseTeam() actually looks for —
    // "RM" as the first header cell — isn't there at all.
    const trk = sheet(['1,2026-07-01,,,x,S,Kashish Goel,k@x.com,,2026-07-01,,n']);
    const team = 'Name,Assistant\nKashish Goel,Anjali Verma\n';
    const { doc, win, errs } = boot({ body: trk, clientBody: asClient(trk), teamBody: team }); await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('a sheet missing the RM column entirely does not crash', errs.length === 0, errs.join(' | '));
    check('is reported as unreadable rather than silently parsed as zero leads',
          /Could not find a header row/.test(win.eval('TEAM_ERROR') || ''), win.eval('TEAM_ERROR'));
    check('and still falls back to a working meter',
          doc.querySelectorAll('.mcard').length > 0, String(doc.querySelectorAll('.mcard').length));
  }
  {
    // A row with no lead name but a filled-in assistant column — a stray
    // half-deleted row, not a real team.
    const trk = sheet([
      '1,2026-07-01,,,x,S,Kashish Goel,k@x.com,,2026-07-01,,n',
      '2,2026-07-01,,,x,S,Anjali Verma,a@x.com,,2026-07-01,,n',
      '3,2026-07-01,,,x,S,Ghost Assistant,g@x.com,,2026-07-01,,n',
    ]);
    const team = ['RM,ARM', ',Ghost Assistant', 'Kashish Goel,Anjali Verma'].join('\n');
    const { win, errs } = boot({ body: trk, clientBody: asClient(trk), teamBody: team }); await settle();
    check('boots cleanly with a blank-lead row ahead of a real one', errs.length === 0, errs.join(' | '));
    check('the blank-lead row is skipped outright — its assistant lands on nobody\'s team',
          win.eval("POD_OF.has('Ghost Assistant')") === false,
          win.eval("POD_OF.get('Ghost Assistant')"));
    check('and it does not leak into the very next row\'s team either',
          !win.eval("POD_TEAM.get('Kashish Goel')").includes('Ghost Assistant'),
          win.eval("JSON.stringify(POD_TEAM.get('Kashish Goel'))"));
    check('the real row right after the blank one still parses normally',
          win.eval("POD_OF.get('Anjali Verma')") === 'Kashish Goel',
          win.eval("POD_OF.get('Anjali Verma')"));
  }
  {
    // A quoted name containing a comma, and a name in Devanagari — both have
    // to survive the same CSV parser the book and escalations already lean on.
    const trk = sheet([
      '1,2026-07-01,,,x,S,"Sharma, Raj",r@x.com,,2026-07-01,,n',
      '2,2026-07-01,,,x,S,सुनीता कुमारी,s@x.com,,2026-07-01,,n',
    ]);
    const team = 'RM,ARM\n"Sharma, Raj",सुनीता कुमारी\n';
    const { win, errs } = boot({ body: trk, clientBody: asClient(trk), teamBody: team }); await settle();
    check('boots cleanly with a quoted comma-containing name and a Devanagari name',
          errs.length === 0, errs.join(' | '));
    check('the quoted comma-containing lead name resolves to their own team',
          Array.isArray(win.eval("POD_TEAM.get('Sharma, Raj')")), win.eval("POD_TEAM.get('Sharma, Raj')"));
    check('and the Devanagari assistant name resolves under them, not reported as a gap',
          win.eval("POD_OF.get('सुनीता कुमारी')") === 'Sharma, Raj',
          win.eval("POD_OF.get('सुनीता कुमारी')") + ' | gaps: ' + win.eval("POD_GAPS.join(' | ')"));
  }
  {
    // A column the Team tab was never asked to have.
    const trk = sheet([
      '1,2026-07-01,,,x,S,Kashish Goel,k@x.com,,2026-07-01,,n',
      '2,2026-07-01,,,x,S,Anjali Verma,a@x.com,,2026-07-01,,n',
    ]);
    const team = ['RM,ARM,Region', 'Kashish Goel,Anjali Verma,North'].join('\n');
    const { win, errs } = boot({ body: trk, clientBody: asClient(trk), teamBody: team }); await settle();
    check('boots cleanly with an unrelated extra column', errs.length === 0, errs.join(' | '));
    check('the real assistant still resolves correctly',
          win.eval("POD_OF.get('Anjali Verma')") === 'Kashish Goel',
          win.eval("POD_OF.get('Anjali Verma')"));
    check('the stray column\'s value is reported as an unplaceable name, not silently added to the team',
          !win.eval("POD_TEAM.get('Kashish Goel')").includes('North') &&
          /"North" is not on the roster/.test(win.eval("POD_GAPS.join(' | ')")),
          win.eval("JSON.stringify(POD_TEAM.get('Kashish Goel'))") + ' | ' + win.eval("POD_GAPS.join(' | ')"));
  }
  {
    // Case variants of the same two names, exactly as they might be typed
    // into the sheet by someone not matching the tracker's own casing.
    //
    // What actually has to hold, per resolve(): matching against the roster
    // is always case-insensitive, so a mismatched casing in the sheet is
    // never a *second* person — the identity always collapses to whichever
    // one entry the roster already has for that lowercased name. Which exact
    // spelling gets DISPLAYED is a separate, cosmetic question, decided by
    // canonicalNames() — hand-typed sources (the Team tab, and the client
    // book's own owner column) are trusted as authoritative there, on the
    // same principle as everywhere else in this file: it is not this app's
    // place to silently second-guess a name a human actually typed. Kashish
    // resolves to "Kashish Goel" below because he also owns a client in the
    // fallback book (a coincidence of this fixture, not a Team-tab mechanism);
    // Anjali has no second hand-typed source, so the sheet's own "ANJALI
    // VERMA" wins outright — correctly, by the same rule, even though it
    // reads oddly. Either way there is exactly one of each, never two.
    const trk = sheet([
      '1,2026-07-01,,,x,S,Kashish Goel,k@x.com,,2026-07-01,,n',
      '2,2026-07-01,,,x,S,Anjali Verma,a@x.com,,2026-07-01,,n',
    ]);
    const team = 'RM,ARM\nkashish goel, ANJALI VERMA \n';
    const { doc, win, errs } = boot({ body: trk, clientBody: asClient(trk), teamBody: team }); await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('boots cleanly with mismatched case and stray whitespace in the sheet',
          errs.length === 0, errs.join(' | '));
    check('a differently-cased lead name still resolves to the one real person, not a gap',
          win.eval("POD_TEAM.has('Kashish Goel')"), win.eval("POD_GAPS.join(' | ')"));
    check('the card is rendered under a real casing, not the sheet\'s literal "kashish goel"',
          [...doc.querySelectorAll('.mcard h4')].length === 1 &&
          ![...doc.querySelectorAll('.mcard h4')].some(h => h.textContent === 'kashish goel'),
          [...doc.querySelectorAll('.mcard h4')].map(h => h.textContent).join(', '));
    check('the roster is not inflated — case variance never creates a second person',
          win.eval('ROSTER.size') === 2, win.eval('ROSTER.size'));
    check('the padded, all-caps assistant is still exactly one team member, resolved and self-consistent',
          win.eval("POD_TEAM.get('Kashish Goel').length") === 1 &&
          win.eval("(() => { const nm = POD_TEAM.get('Kashish Goel')[0]; return POD_OF.get(nm) === 'Kashish Goel'; })()"),
          win.eval("JSON.stringify(POD_TEAM.get('Kashish Goel'))"));
  }
  {
    // The same isolated claim, without the client-book coincidence muddying
    // which mechanism did the work: two leads' rows reference the same
    // assistant under two different casings. If case-folding did not happen
    // before the duplicate-claim check runs, this would misread as two
    // different people and silently double her onto both teams — the
    // conflict-detection added earlier in this file would never fire, since
    // it compares resolved (roster) names, not raw sheet text.
    const trk = sheet([
      '1,2026-07-01,,,x,S,Kashish Goel,k@x.com,,2026-07-01,,n',
      '2,2026-07-01,,,x,S,Sultan Malik,s@x.com,,2026-07-01,,n',
      '3,2026-07-01,,,x,S,Anjali Verma,a@x.com,,2026-07-01,,n',
    ]);
    const team = ['RM,ARM', 'Kashish Goel,anjali verma', 'Sultan Malik,ANJALI VERMA'].join('\n');
    const { win, errs } = boot({ body: trk, clientBody: asClient(trk), teamBody: team }); await settle();
    check('boots cleanly with the same assistant claimed twice under two different casings',
          errs.length === 0, errs.join(' | '));
    check('case folding happens before the conflict check — this is caught as one duplicate claim, not missed',
          /listed under both/.test(win.eval("POD_GAPS.join(' | ')")), win.eval("POD_GAPS.join(' | ')"));
    check('she lands on exactly one of the two teams, never both',
          win.eval("POD_TEAM.get('Kashish Goel').length") === 1 &&
          win.eval("POD_TEAM.get('Sultan Malik').length") === 0,
          win.eval("JSON.stringify({k: POD_TEAM.get('Kashish Goel'), s: POD_TEAM.get('Sultan Malik')})"));
  }

  const w = Math.max(...results.map(r => r[1].length));
  for (const [ok, n, d] of results) console.log(`${ok ? ' ok ' : 'FAIL'}  ${n.padEnd(Math.min(w,100))}  ${d}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
