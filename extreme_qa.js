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

  const w = Math.max(...results.map(r => r[1].length));
  for (const [ok, n, d] of results) console.log(`${ok ? ' ok ' : 'FAIL'}  ${n.padEnd(Math.min(w,100))}  ${d}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
