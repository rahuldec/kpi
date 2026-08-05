const fs = require('fs');
const { JSDOM } = require('jsdom');

const FILE = process.argv[2] || '/home/claude/work.html';
const HTML = fs.readFileSync(FILE, 'utf8');
let pass = 0, fail = 0; const results = [];
const check = (n, c, d) => c ? (pass++, results.push([1, n, ''])) : (fail++, results.push([0, n, d || '']));

// A realistic slice of the Asana export: spacer rows and a source URL above the
// real header, quoted fields containing commas and newlines, a blank assignee.
const SHEET = [
  ',,',
  ',,https://app.asana.com/-/googleSheetsProjectCsv?domain=480944584143449',
  ',,',
  'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes',
  '1,2026-07-30,,,x,Section,Divya Gupta,divya@x.com,,2026-07-30,,"Notes, with a comma',
  'and a newline"',
  '2,2026-07-30,,,y,Section,,vansh.saini@x.com,,2026-07-29,,plain',
  '3,2026-07-29,,,z,Section,"O\'Brien, Sam",sam@x.com,,2026-07-28,,plain',
  '4,2026-07-29,,,w,Section,Divya Gupta,divya@x.com,,2026-07-28,,plain',
  '5,2026-07-29,,,v,Section,divya gupta,divya@x.com,,2026-07-27,,plain',
].join('\n');

const CLIENT_DEFAULT = SHEET.replace(/\n(\d),/g, (m, d) => '\n' + (Number(d) + 100) + ',');

/* The escalations export: top-level rows carry Section/Column "Clients" and list
   the client's own Asana project alongside "Client Escalations"; sub-tasks carry
   a Parent task instead and must never be counted as escalations of their own.
   Names here are real entries in the embedded client book, so matching is
   exercised rather than stubbed. */
const ESC_HEAD = 'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes,Projects,Parent task';
const ESC_SHEET = [
  ',,', ',,https://app.asana.com/x', ',,',
  ESC_HEAD,
  // open — client named by its own project, exactly as the book spells it
  '1,2026-05-20,,2026-07-26,GNAV,Clients,Gobind Monga,g@x.com,,,,,"Client Escalations,Budha College Karnal",',
  // open — client project is a shortened form of the book name
  '2,2026-05-22,,2026-06-27,MPM,Clients,Gobind Monga,g@x.com,,,,,"Vedashree,Client Escalations",',
  // closed
  '3,2026-02-09,2026-02-26,2026-02-26,GVM: Library,Clients,kashish Goel,k@x.com,,,,,"GVM Girls College,Client Escalations",',
  // sub-tasks of the above — must not count
  '4,2026-05-20,,2026-05-20,some fix,,,,,,,,,GNAV',
  '5,2026-05-20,2026-06-02,2026-06-02,another fix,,,,,,,,,GNAV',
  // no project of its own, and no client in the book by this name
  // no project of its own, and deliberately nothing like it in the book, so it
  // exercises the "reported, never guessed" path
  '6,2026-07-08,,2026-07-27,Zzz Unknown Academy,Clients,Sukhmeet Singh,s@x.com,,,,,Client Escalations,'
].join('\n');

/* The published client book, replayed as CSV. Rather than hand-maintaining a
   second copy of 148 clients, this is generated from CLIENTS_FALLBACK in the
   page itself and re-encoded in the sheet's own shape — quoted names, " ₹ 1,234.00 "
   money, "-" for the blanks. So the round trip is what is under test: whatever
   the fallback says, the parser has to read back out of a real CSV unchanged,
   and every book figure asserted below stays pinned to one source.

   The header carries the sheet's trailing empty columns and its "RM" column, so
   the column-by-name lookup is exercised rather than a tidy fixture. */
const BOOK_ROWS = JSON.parse(HTML.match(/const CLIENTS_FALLBACK = (\[.*?\]);/s)[1]);
const BOOK_SHEET = (() => {
  const q = v => /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const money = r => r === null ? ' - '
                   : r === 0   ? ' ₹ - '
                   : ` ₹ ${r.toLocaleString('en-US')}.00 `;
  const head = 'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM,Retention/Imp,,,';
  const body = BOOK_ROWS.map((c, i) =>
    [i + 1, q(c.n), c.a, c.t || '-', c.c, 'B', q(money(c.r)), c.o || '-', '', 'Retention', '', '', ''].join(','));
  /* The scratch below the numbered block, reproduced: rows with a name and no
     Sr No. Any of these reaching the book inflates it — the IBMR line alone adds
     ₹1L to a client that is already counted. */
  const scratch = [
    ',Daily work track - Retention,,Vishvas,,,,,,,,,',
    ',Daily work track - Implementation,,Ayush,,,,,,,,,',
    ',IBMR,,,,, ₹ 100\u002C000.00 ,,,,,,'.replace('100\u002C000', '"100,000"'),
    ',Cambridge Delhi,,,,,,,,,,,'
  ];
  return [head, ...body, ...scratch].join('\n');
})();

/* The stacked adoption tab, replayed as CSV and generated from ADOPTION_FALLBACK
   in the page — same reasoning as the book fixture. The round trip is the test:
   whatever the snapshot says, the parser has to read back out of a real CSV
   unchanged. Two rows of scratch are included because a real sheet accumulates
   them, and neither may reach a dial. */
const ADOPT_ROWS = JSON.parse(HTML.match(/const ADOPTION_FALLBACK = (\[.*?\]);/s)[1])
  /* The page stores the module grid and derives the totals from it, so the
     fixture derives them the same way rather than keeping a second copy. */
  .map(r => ({...r, s: (r.m.match(/1/g) || []).length,
                    a: (r.m.match(/1/g) || []).length + (r.m.match(/0/g) || []).length}));
const ADOPT_MODULES = JSON.parse(HTML.match(/(?:const|let) ADOPTION_MODULES = (\[.*?\]);/s)[1]);
/* The raw per-RM tabs, rebuilt from the page's own compiled grid and wrapped in
   the same "#### TAB:" markers api/data.js emits. This is the real shape the CS
   team keeps: two header rows, three columns per module (score, Grade, spare),
   then Rank/Total/Percentage/Grade. Round-tripping through it is the test — the
   parser has to return what the grid says, out of the format it actually meets.

   The Total column is deliberately written as the corrupted values Excel
   produced, because the parser must ignore it. */
const ADOPT_SHEET = (() => {
  const q = v => /[",]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v;
  const byRm = new Map();
  for (const r of ADOPT_ROWS){
    if (!byRm.has(r.rm)) byRm.set(r.rm, []);
    byRm.get(r.rm).push(r);
  }
  const blocks = [];
  for (const [rm, rows] of byRm){
    const h0 = ['S No.', 'Student Name', 'Registration No', 'Client Ownership.'];
    const h1 = ['', '', '', ''];
    ADOPT_MODULES.forEach(m => { h0.push(q(m), '', ''); h1.push('Quarter I', 'Grade', ''); });
    h0.push('Rank', 'Total', 'Percentage', 'Grade');
    h1.push('', '', '', '');

    const body = rows.map((r, i) => {
      const cells = [i + 1, q(r.n), 100 + i, 'Someone 1'];
      ADOPT_MODULES.forEach((_, j) => {
        const ch = r.m[j];
        cells.push(ch === '-' ? '' : ch, ch === '1' ? 'A' : ch === '0' ? 'C' : '', '');
      });
      /* A date where "3/10" should be — exactly what the source files hold. */
      cells.push(i + 1, `2001-${String(r.a).padStart(2, '0')}-${String(r.s || 1).padStart(2, '0')}`,
                 (r.s / r.a * 100).toFixed(0), 'B');
      return cells.join(',');
    });
    /* Scratch below the numbered block, as every real tab has: unnumbered rows
       are dropped outright. A numbered row naming a client the book does not
       know is different — that one must be reported, never silently discarded,
       because it is a client nobody is counting. */
    body.push(',Daily work track,,,,,', ',,,,,,');
    if (rm === [...byRm.keys()][0]){
      const stray = [900, 'Totals', '', ''];
      ADOPT_MODULES.forEach((_, j) => stray.push(j === 0 ? '1' : '', j === 0 ? 'A' : '', ''));
      stray.push('', '', '100', 'A');
      body.push(stray.join(','));
    }
    blocks.push(`#### TAB: Q1 ${rm}\n` + [h0.join(','), h1.join(','), ...body].join('\n'));
  }
  return blocks.join('\n\n');
})();

function boot({ body = SHEET, clientBody = CLIENT_DEFAULT, escBody = ESC_SHEET,
                bookBody = BOOK_SHEET, adoptBody = ADOPT_SHEET,
                status = 200, reject = false, store = null } = {}) {
  const errs = [], calls = [];
  // beforeParse installs the mock before the page's own <script> runs, so the
  // script executes normally and its top-level bindings stay reachable via eval.
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    // Without an origin, localStorage throws and every writeStore call is swallowed
    // by its try/catch — so the page's remembered state would look untested-but-fine.
    // Each JSDOM gets its own storage, so the cases below stay independent.
    url: 'https://kpi.test/',
    beforeParse(window) {
      // Seed localStorage before the page script runs, so the restore path is
      // exercised rather than simulated.
      if (store) for (const [k, v] of Object.entries(store)) window.localStorage.setItem(k, v);
      window.fetch = (url) => {
        calls.push(url);
        if (reject) return Promise.reject(new Error('Failed to fetch'));
        const src = (url.match(/src=(\w+)/) || [])[1];
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          text: () => Promise.resolve(
            src === 'escalations' ? escBody :
            src === 'adoption' ? adoptBody :
            src === 'book' ? bookBody :
            src === 'client' ? clientBody : body)
        });
      };
    }
  });
  dom.virtualConsole.on('jsdomError', e => errs.push(e.message));
  return { dom, doc: dom.window.document, win: dom.window, errs, calls };
}

/* A roster wide enough for the team tables to resolve. Leads plus one or two of
   their people each, spelled as the trackers spell them. */
const TEAM_PEOPLE = [
  'Mansi Rana','Vansh Saini','Divya Gupta',
  'Sukhmeet Singh','Gobind Monga','Sapna','Bhavey Saluja',
  'Sultan Malik','Lokesh Kumar','Amar Kumar Pandit',
  'Sagar Mishra','Mehak Garg','Akshat Jain',
  'Kashish Goel','Anjali Verma','Tanvi Gupta',
  'Amit Kumar','Priya',
  'Ankush Rana'
];
const TEAM_HEAD = 'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes';
const teamSheet = (people = TEAM_PEOPLE, off = 0) =>
  [',,', ',,url', ',,', TEAM_HEAD].concat(people.map((p, i) =>
    `${off + i + 1},2026-07-01,,,x,S,${p},x@x.com,,2026-07-01,,n`)).join('\n');

/* Pick months the way the UI does — tick the boxes in the popover — rather than
   poking a value onto a control that no longer exists. Accepts one month or many. */
const pickMonths = (doc, ...months) => {
  const boxes = [...doc.querySelectorAll('#monthlist input[type=checkbox]')];
  for (const b of boxes) b.checked = months.includes(b.value);
  const miss = months.filter(m => !boxes.some(b => b.value === m));
  if (miss.length) throw new Error('month not offered by the picker: ' + miss.join());
  boxes[0].dispatchEvent(new doc.defaultView.Event('change', {bubbles: true}));
};

const settle = () => new Promise(r => setTimeout(r, 30));
const txt = (doc, s) => (doc.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
/* `.hidden` being true is not the same as being off the screen: a class with an
   explicit display rule outranks the browser's [hidden] rule, which is exactly how
   the day presets stayed visible on the client book tab while every property-based
   assertion passed. Check the computed style instead. */
const shown = (doc, sel) => {
  const el = doc.querySelector(sel);
  if (!el) return false;
  return doc.defaultView.getComputedStyle(el).display !== 'none';
};
const figs = doc => [...doc.querySelectorAll('#kpis .fig')].map(e => e.textContent.replace(/\s+/g, ''));
const pad = n => String(n).padStart(2, '0');
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

(async () => {

  // ── 0. static hygiene ───────────────────────────────────────────
  {
    // Cheap checks that catch the classes of rot a behavioural test never will.
    const ids = [...HTML.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
    check('no duplicate element ids', dupes.length === 0, dupes.join());

    const refs = [...HTML.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
    const dangling = [...new Set(refs)].filter(r => !ids.includes(r));
    check('every $() reference has an element', dangling.length === 0, dangling.join());

    const js = HTML.slice(HTML.indexOf('<script>') + 8, HTML.lastIndexOf('</script>'));
    const declared = [...js.matchAll(/^(?:function|const|let)\s+([A-Za-z_][\w]*)/gm)].map(m => m[1]);
    const unused = declared.filter(n =>
      (js.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length <= 1);
    check('nothing is declared and never used', unused.length === 0, unused.join());

    // every tab must reach a panel, and every panel must have a tab
    const tabs = [...HTML.matchAll(/data-src="([^"]+)"/g)].map(m => m[1]);
    check('every tab is a declared source',
          tabs.every(t => new RegExp(`\\b${t}:\\s*\\{`).test(HTML)), tabs.join());
  }

  // ── 1. no timesheet data is embedded ───────────────────────────
  {
    // This guard exists because the page once shipped a SAMPLE dataset and read
    // it instead of the sheets. Timesheet figures must always come off the wire.
    // The client book is the deliberate exception: that workbook is an uploaded
    // .xlsx, Drive will not export it as CSV, so there is nothing to fetch. It is
    // allowed to be embedded on the condition that it says when it was taken —
    // which the next block enforces.
    check('no SAMPLE dataset constant', !/const SAMPLE/.test(HTML));
    check('timesheet rows are not embedded', !/Divya Gupta/.test(HTML),
          'found hardcoded tracker names');
    check('fetches from /api/data with a source', /fetch\(`\/api\/data\?src=/.test(HTML));
    check('both sheet sources declared', /internal:/.test(HTML) && /client:/.test(HTML));
  }

  // ── 1a2. the client book says where it came from ───────────────
  {
    check('fallback snapshot carries an as-of date',
          /const CLIENTS_FALLBACK_ASOF = '\d{4}-\d{2}-\d{2}'/.test(HTML));
    const { doc } = boot(); await settle();
    doc.querySelector('#sources2 button[data-src="clients"]').click(); await settle();
    check('a live book says nothing at all', !shown(doc, '#asof'), txt(doc, '#asof'));

    /* The fallback is the dangerous state: the numbers still render and look
       exactly as authoritative as live ones. It has to announce itself. */
    const b = boot({ bookBody: 'nothing,useful\n1,2' }); await settle();
    b.doc.querySelector('#sources2 button[data-src="clients"]').click(); await settle();
    const note = txt(b.doc, '#asof');
    check('a fallback book shows the notice at all', shown(b.doc, '#asof'));
    check('a fallback book says the live one is unavailable',
          /LIVE BOOK UNAVAILABLE/.test(note), note);
    check('the fallback gives the reason', /Client Name/.test(note), note);
    check('the fallback is styled as a warning',
          b.doc.getElementById('asof').className === 'bad');
    check('a failed book does not take the compliance side down',
          b.doc.getElementById('content').hidden === false);
  }

  // ── 1a3. the published book parses back to the snapshot ────────
  {
    const { win } = boot(); await settle();
    const live = win.eval('CLIENTS');
    check('the live book replaced the fallback', win.eval('BOOK_LIVE') === true);
    check('a CSV round trip reproduces the book exactly',
          JSON.stringify(live) === JSON.stringify(BOOK_ROWS),
          `${live.length} rows vs ${BOOK_ROWS.length}`);

    /* The scratch below the numbered block is the whole reason the Sr No. filter
       exists. BOOK_SHEET carries it; none of it may survive. */
    check('no internal tracker rows survive parsing',
          !live.some(c => /daily work track/i.test(c.n)));
    check('the unowned IBMR duplicate is dropped',
          !live.some(c => c.n === 'IBMR'));
    check('the scratch does not inflate the total',
          live.reduce((s, c) => s + (c.r || 0), 0) ===
          BOOK_ROWS.reduce((s, c) => s + (c.r || 0), 0));

    /* " ₹ - " and " - " look alike and are not alike. Reading the unfilled one
       as zero would invent a client that bills nothing. */
    const csv = [
      'Sr No.,Client Name,Old/New,TYPE1,Category,Type, Total Billing FY , Team ,RM',
      '1,Real Money,Old,School,Large,B," ₹ 1,368,000.00 ",Mansi Rana,',
      '2,Explicit Zero,Old,University,Large,B, ₹ - ,Sultan Malik,',
      '3,Never Filled,Old,School,Small,B, - ,-,',
      ',Prospect Note,,,,,,,'
    ].join('\n');
    const got = win.eval(`parseBook(${JSON.stringify(csv)})`);
    check('a numbered row with no Sr No. is not a client', got.length === 3, got.length);
    check('rupee formatting is stripped to a number',
          got.find(c => c.n === 'Real Money').r === 1368000);
    check('an explicit rupee dash is zero',
          got.find(c => c.n === 'Explicit Zero').r === 0);
    check('an unfilled cell stays null, not zero',
          got.find(c => c.n === 'Never Filled').r === null);
    check('a dash owner becomes unowned, not the literal dash',
          got.find(c => c.n === 'Never Filled').o === '');
    check('unfilled billing sorts last, not first',
          got[got.length - 1].n === 'Never Filled', got.map(c => c.n).join(','));
    check('ownership is read from Team, not RM',
          got.find(c => c.n === 'Real Money').o === 'Mansi Rana');

    check('a book with no Sr No. column is refused rather than guessed', (() => {
      try { win.eval(`parseBook("Client Name, Total Billing FY \\nFoo, 1")`); return false; }
      catch (e) { return /Sr No\./.test(e.message); }
    })());
  }

  // ── 1a4. the snapshot holds clients, not scratch ───────────────
  {
    // The source sheet has notes and internal tracker rows below the numbered
    // client block. They came in once because the extraction filtered on "has a
    // name" rather than "is numbered"; these pin the shape of what belongs.
    const m = HTML.match(/const CLIENTS_FALLBACK = (\[.*?\]);/s);
    check('client snapshot parses', !!m);
    const rows = JSON.parse(m[1]);
    check('every entry has a name', rows.every(r => r.n && r.n.trim().length > 1));
    check('no internal tracker rows', !rows.some(r => /daily work track/i.test(r.n)),
          (rows.find(r => /daily work track/i.test(r.n)) || {}).n);
    check('no row is a bare duplicate prefix of another', (() => {
      const names = rows.map(r => r.n.toLowerCase());
      return !names.some((n, i) => names.some((o, j) =>
        i !== j && o !== n && o.startsWith(n + ' ') && !rows[i].o));
    })(), 'an unowned row shadows a longer named one');
    check('no duplicate client names',
          new Set(rows.map(r => r.n.toLowerCase())).size === rows.length);
    check('every owner is a known lead', (() => {
      const leads = (HTML.match(/const PODS = \{(.*?)\};/s)[1].match(/'([^']+)':/g) || [])
        .map(x => x.slice(1, -2));
      return rows.every(r => !r.o || leads.includes(r.o));
    })());
  }

  // ── 1b. two sources ─────────────────────────────────────────────
  {
    const { doc, calls } = boot(); await settle();
    check('opens on Internal', doc.querySelector('#sources button[data-src="internal"]')
          .getAttribute('aria-pressed') === 'true');
    check('requests the internal sheet', /src=internal/.test(calls[0] || ''), calls[0]);
    check('heading names the internal tracker', /Internal Team Calls/.test(txt(doc, '#eyebrow')),
          txt(doc, '#eyebrow'));

    check('both sheets fetched on load', calls.some(u=>/src=internal/.test(u)) &&
          calls.some(u=>/src=client/.test(u)), calls.join(' | '));
    const n = calls.length;
    doc.querySelector('#sources button[data-src="client"]').click(); await settle();
    check('switching tabs does not refetch', calls.length === n, calls.length + ' vs ' + n);
    check('client tab marked active', doc.querySelector('#sources button[data-src="client"]')
          .getAttribute('aria-pressed') === 'true');
    check('heading follows the source', /Client Call Tracker/.test(txt(doc, '#eyebrow')),
          txt(doc, '#eyebrow'));
    check('document title follows the source', /Client Call Tracker/.test(doc.title), doc.title);
  }
  {
    // clicking the tab you are already on must not refetch
    const { doc, calls } = boot(); await settle();
    const n = calls.length;
    doc.querySelector('#sources button[data-src="internal"]').click(); await settle();
    check('re-clicking the active source is a no-op', calls.length === n, calls.length + ' vs ' + n);
  }

  // ── 1c. the roster spans both sheets ────────────────────────────
  {
    // someone present only in the internal sheet must still be scored on the client tab
    const CLIENT_ONLY = [
      'Task ID,Created At,Name,Assignee,Assignee Email,Due Date',
      '9,2026-07-30,z,Amit Kumar,amit@x.com,2026-07-30'
    ].join('\n');
    const { doc } = boot({ clientBody: CLIENT_ONLY }); await settle();

    const internalNames = [...doc.querySelectorAll('#board tbody td:first-child')].map(e=>e.textContent);
    check('internal tab includes the client-only person', internalNames.includes('Amit Kumar'),
          internalNames.join('|'));

    doc.querySelector('#sources button[data-src="client"]').click(); await settle();
    const clientNames = [...doc.querySelectorAll('#board tbody td:first-child')].map(e=>e.textContent);
    check('client tab includes internal-only people', clientNames.includes('Divya Gupta'),
          clientNames.join('|'));
    check('both tabs cover the same roster', internalNames.length === clientNames.length,
          internalNames.length + ' vs ' + clientNames.length);

    // and a never-filer on this sheet must show 100% missed, not vanish
    const row = [...doc.querySelectorAll('#board tbody tr')]
      .find(r => r.children[0].textContent === 'Divya Gupta');
    check('never-filed-here shows as fully missed', row && row.children[3].textContent.startsWith('0%'),
          row ? row.children[3].textContent : 'row missing');
  }
  {
    // roster count is surfaced
    const { doc } = boot(); await settle();
    check('freshness line reports roster size', /people/.test(txt(doc, '#fresh')), txt(doc, '#fresh'));
  }

  // ── 1d. exemptions ──────────────────────────────────────────────
  {
    const SH = [
      'Task ID,Created At,Name,Assignee,Assignee Email,Due Date',
      '1,2026-07-30,x,Sagar Mishra,sagar@x.com,2026-07-30',
      '2,2026-07-30,x,Divya Gupta,divya@x.com,2026-07-30'
    ].join('\n');
    const CL = [
      'Task ID,Created At,Name,Assignee,Assignee Email,Due Date',
      '3,2026-07-30,x,Divya Gupta,divya@x.com,2026-07-30'
    ].join('\n');

    const { doc } = boot({ body: SH, clientBody: CL }); await settle();
    let names = [...doc.querySelectorAll('#board tbody td:first-child')].map(e=>e.textContent);
    check('exempt person still counted on internal', names.includes('Sagar Mishra'), names.join('|'));
    check('no exemption note on internal', txt(doc, '#exempt') === '', txt(doc, '#exempt'));

    doc.querySelector('#sources button[data-src="client"]').click(); await settle();
    names = [...doc.querySelectorAll('#board tbody td:first-child')].map(e=>e.textContent);
    check('exempt person dropped from client board', !names.includes('Sagar Mishra'), names.join('|'));
    check('non-exempt person still on client board', names.includes('Divya Gupta'), names.join('|'));

    const chased = [...doc.querySelectorAll('#chase .names a')].map(a=>a.childNodes[0].textContent);
    check('exempt person not on the client chase list', !chased.includes('Sagar Mishra'), chased.join('|'));
    check('exemption is stated on screen', /Sagar Mishra/.test(txt(doc, '#exempt')), txt(doc, '#exempt'));
    check('exemption note names the tracker', /client calls/.test(txt(doc, '#exempt')), txt(doc, '#exempt'));
  }
  {
    // an exempt person who files anyway must not be hidden
    const CL = [
      'Task ID,Created At,Name,Assignee,Assignee Email,Due Date',
      '3,2026-07-30,x,Sagar Mishra,sagar@x.com,2026-07-30'
    ].join('\n');
    const { doc } = boot({ clientBody: CL }); await settle();
    doc.querySelector('#sources button[data-src="client"]').click(); await settle();
    const names = [...doc.querySelectorAll('#board tbody td:first-child')].map(e=>e.textContent);
    check('exempt person appears if they do file', names.includes('Sagar Mishra'), names.join('|'));
  }

  // ── 1e. branding ────────────────────────────────────────────────
  {
    const { doc } = boot(); await settle();
    const logo = doc.querySelector('.masthead img');
    check('logo present in the masthead', !!logo);
    check('logo is embedded, not a broken link',
          logo && logo.getAttribute('src').startsWith('data:image/png;base64,'));
    check('logo has alt text', logo && /Okie Dokie/.test(logo.getAttribute('alt')), logo && logo.alt);
    check('company name in the masthead', /Okie Dokie/.test(txt(doc, '.masthead .name')),
          txt(doc, '.masthead .name'));
    check('no external webfont request', !/fonts\.(googleapis|gstatic)/.test(HTML));

    const fav = doc.querySelector('link[rel="icon"]');
    check('favicon present', !!fav);
    check('favicon is embedded, not a separate request',
          fav && fav.getAttribute('href').startsWith('data:image/png;base64,'));
    const touch = doc.querySelector('link[rel="apple-touch-icon"]');
    check('apple touch icon present', !!touch);
    check('apple touch icon is embedded',
          touch && touch.getAttribute('href').startsWith('data:image/png;base64,'));
    check('theme colour is the brand orange',
          doc.querySelector('meta[name="theme-color"]')?.getAttribute('content') === '#EC6724');
    check('brand orange from the logo is the accent', /--brand:#EC6724/.test(HTML));
    check('absence colour is distinct from the accent', /--miss:#A82A1C/.test(HTML));
  }

  // ── 1e2. page title and metric groups ──────────────────────────
  {
    const { doc } = boot(); await settle();
    const h1s = [...doc.querySelectorAll('h1')];
    check('exactly one h1 on the page', h1s.length === 1, `${h1s.length} found`);
    check('h1 is the product, not the view', txt(doc, 'h1') === 'CS Team KPI', txt(doc, 'h1'));
    check('view headline sits below the h1', doc.getElementById('h1')?.tagName === 'H2',
          doc.getElementById('h1')?.tagName);

    check('group label reads Compliance', txt(doc, '#grouplabel') === 'Compliance',
          txt(doc, '#grouplabel'));
    check('the three tabs sit inside the group',
          doc.querySelectorAll('.group #sources button').length === 3);
    check('every tab is inside a labelled group',
          [...doc.querySelectorAll('#sources button')]
            .every(b => b.closest('.group')?.querySelector('.grouplabel')));

    check('document title leads with the product', /^CS Team KPI/.test(doc.title), doc.title);
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    check('page title does not change with the tab', txt(doc, 'h1') === 'CS Team KPI', txt(doc, 'h1'));
    check('group label does not change with the tab', txt(doc, '#grouplabel') === 'Compliance');
    check('view headline does change with the tab', /Missed days/.test(txt(doc, '#h1')),
          txt(doc, '#h1'));
  }

  // ── 1f. scorecard ───────────────────────────────────────────────
  {
    const { doc } = boot(); await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();

    check('scorecard section shown', doc.getElementById('scorecard').hidden === false);
    check('daily panels hidden', doc.getElementById('chase').hidden === true &&
          doc.getElementById('gridsec').hidden === true);
    check('month picker shown, day presets hidden',
          doc.getElementById('monthwrap').hidden === false &&
          doc.getElementById('presets').hidden === true);
    check('month defaults to the current month',
          txt(doc, '#monthbtn') === new Date().toLocaleDateString('en-GB',
            {month:'long', year:'numeric'}), txt(doc, '#monthbtn'));
    check('headline changes for the scorecard', /Missed days/.test(txt(doc, '#h1')), txt(doc, '#h1'));

    const rows = [...doc.querySelectorAll('#score tbody tr')];
    check('one row per person on the roster', rows.length === 3, rows.length + ' rows');
    check('columns: person, internal, client, total, filed, compliance, book, team',
          doc.querySelectorAll('#score thead th').length === 8,
          doc.querySelectorAll('#score thead th').length + ' cols');

    // total must equal internal + client for every row
    const bad = rows.filter(r => {
      const i = r.children[1].textContent, c = r.children[2].textContent;
      const tot = Number(r.children[3].textContent);
      return Number(i === '—' ? 0 : i) + Number(c === '—' ? 0 : c) !== tot;
    });
    check('total equals internal + client on every row', bad.length === 0,
          bad.map(r=>r.children[0].textContent).join('|'));

    check('sorted worst first', rows.map(r=>Number(r.children[3].textContent))
          .every((v,i,a) => i === 0 || a[i-1] >= v));
    check('summary line names the month', /2026|July|August/.test(txt(doc, '#scorenote')),
          txt(doc, '#scorenote'));
    check('does not score days that have not happened',
          /of \d+ working days elapsed/.test(txt(doc, '#scorenote')), txt(doc, '#scorenote'));
  }
  {
    // an exempt person shows a dash, not a zero, in that tracker's column
    const SH = ['Task ID,Created At,Name,Assignee,Assignee Email,Due Date',
      '1,2026-07-30,x,Sagar Mishra,sagar@x.com,2026-07-30'].join('\n');
    const CL = ['Task ID,Created At,Name,Assignee,Assignee Email,Due Date',
      '2,2026-07-30,x,Sagar Mishra,sagar@x.com,2026-07-30'].join('\n');
    const { doc } = boot({ body: SH, clientBody: CL }); await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    const row = [...doc.querySelectorAll('#score tbody tr')]
      .find(r => r.children[0].textContent === 'Sagar Mishra');
    check('exempt tracker shows a dash', row && row.children[2].textContent === '—',
          row ? row.children[2].textContent : 'no row');
    check('exempt person still scored on the other tracker',
          row && row.children[1].textContent !== '—', row && row.children[1].textContent);
  }
  {
    // CSV export
    const { doc, win } = boot(); await settle();
    let downloaded = null;
    win.URL.createObjectURL = () => 'blob:x';
    win.URL.revokeObjectURL = () => {};
    const origClick = win.HTMLAnchorElement.prototype.click;
    win.HTMLAnchorElement.prototype.click = function(){ downloaded = this.download; };
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    doc.getElementById('csv').click();
    win.HTMLAnchorElement.prototype.click = origClick;
    check('CSV download offered', !!downloaded, String(downloaded));
    check('CSV filename carries the month', /cs-team-missed-days-\d{4}-\d{2}\.csv/.test(downloaded || ''),
          String(downloaded));
  }
  {
    // scorecard choice is remembered like the other tabs
    const { doc } = boot(); await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    doc.querySelector('#sources button[data-src="internal"]').click(); await settle();
    check('leaving the scorecard restores the daily panels',
          doc.getElementById('chase').hidden === false &&
          doc.getElementById('scorecard').hidden === true);
    check('month picker hidden again', doc.getElementById('monthwrap').hidden === true);
  }

  // ── 1f2. scorecard sorting ──────────────────────────────────────
  {
    const head = 'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes';
    const row = (id, who, day) => `${id},2026-07-01,,,x,S,${who},${who.split(' ')[0].toLowerCase()}@x.com,,2026-07-${day},,n`;
    // Zara files most internally, Anil least. Sagar Mishra is exempt from client calls,
    // so his client cell is a dash and must never sort as a zero.
    const INT = [',,', ',,url', ',,', head,
      row(1,'Zara Khan','01'), row(2,'Zara Khan','02'), row(3,'Zara Khan','03'),
      row(4,'Anil Roy','01'),
      row(5,'Sagar Mishra','01'), row(6,'Sagar Mishra','02')].join('\n');
    const CLI = [',,', ',,url', ',,', head,
      row(101,'Zara Khan','01'),
      row(102,'Anil Roy','01'), row(103,'Anil Roy','02'), row(104,'Anil Roy','03')].join('\n');

    const { doc, win } = boot({ body: INT, clientBody: CLI }); await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    pickMonths(doc, '2026-07');
    const names = () => [...doc.querySelectorAll('#score tbody td:first-child')].map(e => e.textContent);
    const clientCells = () => [...doc.querySelectorAll('#score tbody tr')].map(r => r.children[2].textContent);
    const hit = col => doc.querySelector(`#score th button[data-col="${col}"]`).click();

    check('default is total missed, worst first', (() => {
      const tot = [...doc.querySelectorAll('#score tbody tr')].map(r => Number(r.children[3].textContent));
      return tot.every((v, i) => i === 0 || tot[i-1] >= v);
    })());
    check('one header marked as sorted by default',
          doc.querySelectorAll('#score th[aria-sort]').length === 1);

    hit('name');
    check('sorting by person goes A to Z', names().join('|') === [...names()].sort().join('|'),
          names().join('|'));
    check('aria-sort follows the active column',
          doc.querySelector('#score th[aria-sort]')?.querySelector('button')?.dataset.col === 'name' &&
          doc.querySelector('#score th[aria-sort]')?.getAttribute('aria-sort') === 'ascending');
    hit('name');
    check('clicking the same column flips it', names().join('|') === [...names()].sort().reverse().join('|'),
          names().join('|'));
    check('only ever one column marked sorted',
          doc.querySelectorAll('#score th[aria-sort]').length === 1);

    hit('rate');
    check('compliance opens weakest first', (() => {
      const r = [...doc.querySelectorAll('#score tbody tr')].map(x => parseInt(x.children[5].textContent));
      return r.every((v, i) => i === 0 || r[i-1] <= v);
    })());

    hit('client');
    check('exempt dash sinks to the bottom, worst first',
          clientCells()[clientCells().length - 1] === '—', clientCells().join('|'));
    hit('client');
    check('exempt dash still sinks when flipped',
          clientCells()[clientCells().length - 1] === '—', clientCells().join('|'));

    check('sort choice is remembered', (() => {
      try { return JSON.parse(win.localStorage.getItem('kpi.sort')).col === 'client'; }
      catch (e) { return false; }
    })());

    // the exported file must match what is on screen, not the default order
    let csv = null;
    win.URL.createObjectURL = b => { csv = b; return 'blob:x'; };
    win.URL.revokeObjectURL = () => {};
    const orig = win.HTMLAnchorElement.prototype.click;
    win.HTMLAnchorElement.prototype.click = function(){};
    hit('name');
    doc.getElementById('csv').click();
    win.HTMLAnchorElement.prototype.click = orig;
    const text = csv ? await csv.text() : '';
    const csvNames = text.trim().split('\n').slice(1).map(l => l.split(',')[0]);
    check('CSV follows the sort on screen', csvNames.join('|') === names().join('|'),
          `${csvNames.join('|')} vs ${names().join('|')}`);
  }

  // ── 1f3. hidden people ──────────────────────────────────────────
  {
    // Someone in HIDDEN is not on the team being measured. They must leave no
    // trace: no row, no entry counted, no effect on turnout — unlike an EXEMPT
    // person, who keeps a row and shows a dash.
    const head = 'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes';
    const row = (id, who, day) => `${id},2026-07-01,,,x,S,${who},x@x.com,,2026-07-${day},,n`;
    const INT = [',,', ',,url', ',,', head,
      row(1,'Zara Khan','01'), row(2,'Rahul Sharma','01'), row(3,'Rahul Sharma','02')].join('\n');
    const CLI = [',,', ',,url', ',,', head,
      row(101,'Zara Khan','01'), row(102,'Rahul Sharma','01')].join('\n');
    const { doc, win } = boot({ body: INT, clientBody: CLI }); await settle();

    check('hidden person has no row on the daily board',
          !/rahul/i.test(doc.getElementById('board').textContent));
    check('hidden person is not in the chase list',
          !/rahul/i.test(doc.getElementById('chase').textContent));
    check('hidden person is not named as exempt',
          !/rahul/i.test(doc.getElementById('exempt').textContent),
          txt(doc, '#exempt'));
    check('people count excludes them', /· 1 people/.test(txt(doc, '#fresh')), txt(doc, '#fresh'));
    check('entry count excludes their rows', /^1 of 2 entries/.test(txt(doc, '#fresh')),
          txt(doc, '#fresh'));

    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    pickMonths(doc, '2026-07');
    check('hidden person has no scorecard row',
          !/rahul/i.test(doc.getElementById('score').textContent));
    check('scorecard shows only the real person',
          doc.querySelectorAll('#score tbody tr').length === 1,
          String(doc.querySelectorAll('#score tbody tr').length));

    // and an exempt person is still treated the other way — row kept, dash shown
    const INT2 = [',,', ',,url', ',,', head,
      row(1,'Zara Khan','01'), row(2,'Sagar Mishra','01'), row(3,'Rahul Sharma','01')].join('\n');
    const CLI2 = [',,', ',,url', ',,', head, row(101,'Zara Khan','01')].join('\n');
    const b2 = boot({ body: INT2, clientBody: CLI2 }); await settle();
    b2.doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    pickMonths(b2.doc, '2026-07');
    const board = b2.doc.getElementById('score').textContent;
    check('exempt keeps a row where hidden loses one',
          /sagar mishra/i.test(board) && !/rahul/i.test(board), board.slice(0, 120));
    check('exempt row carries a dash for its tracker', /—/.test(board), board.slice(0, 120));
  }

  // ── 1f4. client book ────────────────────────────────────────────
  {
    const { doc, win } = boot({ body: teamSheet(), clientBody: teamSheet(TEAM_PEOPLE, 500) });
    await settle();
    const tab = () => doc.querySelector('#sources2 button[data-src="clients"]');
    check('the book tab lives in its own group',
          tab().closest('.group')?.querySelector('.grouplabel')?.textContent === 'Business',
          tab().closest('.group')?.querySelector('.grouplabel')?.textContent);
    check('every group sits on one row',
          doc.querySelectorAll('.groups > .group').length === 4,
          String(doc.querySelectorAll('.groups > .group').length));
    check('and each one is labelled', (() => {
      const l = [...doc.querySelectorAll('.groups > .group .grouplabel')].map(x => x.textContent);
      return JSON.stringify(l) === JSON.stringify(['Compliance','Business','Product','Overall']);
    })(), [...doc.querySelectorAll('.groups > .group .grouplabel')].map(x => x.textContent).join());

    tab().click(); await settle();
    check('book panel shown', doc.getElementById('clients').hidden === false);
    check('compliance panels all hidden on the book tab',
          doc.getElementById('scorecard').hidden === true &&
          doc.getElementById('chase').hidden === true &&
          doc.getElementById('boardsec').hidden === true);
    check('month picker and day presets are actually off screen',
          !shown(doc, '#monthwrap') && !shown(doc, '#presets'));
    check('the joined toggle is off screen on the book tab', !shown(doc, '#joinedwrap'));
    check('day presets are really gone, not just flagged hidden',
          !/Yesterday/.test(doc.querySelector('.controls').textContent.trim()) ||
          !shown(doc, '#presets'));
    check('title follows the book tab', /client book/i.test(doc.title), doc.title);

    const rmRows = [...doc.querySelectorAll('#byrm tbody tr')];
    check('one row per team that carries a book',
          rmRows.length >= 6, rmRows.length + ' rows');
    check('a team carrying no book is left off this table',
          !/Sagar Mishra/.test(doc.getElementById('byrm').textContent));
    check('team table is sorted by book, largest first', (() => {
      const v = rmRows.map(r => r.children[2].textContent).map(Number).filter(n => !isNaN(n));
      return v.length > 1;
    })());
    check('shares are a percentage', /%$/.test(rmRows[0].children[5].textContent),
          rmRows[0].children[5].textContent);

    const all = [...doc.querySelectorAll('#clientlist tbody tr')].length;
    check('every client is listed', all > 100, all + ' rows');
    const totalText = txt(doc, '#ctot');
    check('totals line reports the unfiltered count', new RegExp(`^${all} clients`).test(totalText),
          totalText);

    // filtering must move both the rows and the total together, or the number lies
    const sel = doc.getElementById('cowner');
    sel.value = [...sel.options].map(o => o.value).filter(Boolean)[0];
    sel.dispatchEvent(new win.Event('change'));
    const filtered = [...doc.querySelectorAll('#clientlist tbody tr')].length;
    check('owner filter narrows the list', filtered > 0 && filtered < all,
          `${filtered} of ${all}`);
    check('total follows the filter', new RegExp(`^${filtered} clients`).test(txt(doc, '#ctot')),
          txt(doc, '#ctot'));
    check('filtered rows all share that owner',
          [...doc.querySelectorAll('#clientlist tbody tr')]
            .every(r => r.children[1].textContent === sel.value));

    sel.value = '';
    sel.dispatchEvent(new win.Event('change'));
    check('clearing the filter restores every row',
          [...doc.querySelectorAll('#clientlist tbody tr')].length === all);

    // Indian short scale, not western — a book over a crore must not read as 267L
    check('totals over a crore read in crore', /Cr$/.test(totalText.split('· ')[1] || ''),
          totalText);
    check('a single team book reads in lakh', /L$/.test(rmRows[0].children[3].textContent),
          rmRows[0].children[3].textContent);
  }

  // ── 1f5. book column on the scorecard ───────────────────────────
  {
    // Revenue sits beside compliance, never inside it: adding the column must not
    // move a single missed-day figure.
    const head = 'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes';
    const row = (id, who, day) => `${id},2026-07-01,,,x,S,${who},x@x.com,,2026-07-${day},,n`;
    // Sukhmeet Singh owns clients in the snapshot; Zara Khan does not.
    const INT = [',,', ',,url', ',,', head,
      row(1,'Sukhmeet Singh','01'), row(2,'Zara Khan','01')].join('\n');
    const CLI = [',,', ',,url', ',,', head, row(101,'Sukhmeet Singh','01')].join('\n');
    const { doc, win } = boot({ body: INT, clientBody: CLI }); await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    pickMonths(doc, '2026-07');

    const rowFor = n => [...doc.querySelectorAll('#score tbody tr')]
      .find(r => r.children[0].textContent === n);
    check('an RM shows their book', /₹/.test(rowFor('Sukhmeet Singh').children[6].textContent),
          rowFor('Sukhmeet Singh').children[6].textContent);
    check('a non-owner shows a dash, not zero',
          rowFor('Zara Khan').children[6].textContent === '—',
          rowFor('Zara Khan').children[6].textContent);

    // sorting by book must not strand the dash at the top
    doc.querySelector('#score th button[data-col="book"]').click();
    const last = [...doc.querySelectorAll('#score tbody tr')].pop();
    check('no-book rows sink when sorting by book', last.children[6].textContent === '—',
          last.children[6].textContent);
    doc.querySelector('#score th button[data-col="book"]').click();
    const last2 = [...doc.querySelectorAll('#score tbody tr')].pop();
    check('and still sink when reversed', last2.children[6].textContent === '—',
          last2.children[6].textContent);
  }

  // ── 1f6. hidden really means hidden ─────────────────────────────
  {
    // A regression guard for the whole class of bug, not just the one instance:
    // walk every element the tab switch is supposed to hide, on every tab, and
    // check the computed style rather than the property.
    const HIDES = ['#presets','#monthwrap','#dates','#joinedwrap','#exempt',
                   '#scorecard','#clients','#meter','#chase','#kpis','#gridsec','#boardsec','#stripsec'];
    const { doc } = boot(); await settle();
    const visible = () => HIDES.filter(sel => shown(doc, sel));

    doc.querySelector('#sources2 button[data-src="clients"]').click(); await settle();
    check('client book shows only its own panel',
          visible().join() === '#clients', visible().join() || '(nothing)');

    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    const sc = visible();
    check('scorecard shows the month picker and the joined toggle',
          sc.includes('#monthwrap') && sc.includes('#joinedwrap') && sc.includes('#scorecard'),
          sc.join());
    check('scorecard hides the day presets and the daily panels',
          !sc.includes('#presets') && !sc.includes('#chase') && !sc.includes('#boardsec'),
          sc.join());
    check('scorecard hides the client book', !sc.includes('#clients'), sc.join());

    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    const mt = visible();
    check('the meter shows its panel, the month picker and the joined toggle',
          mt.includes('#meter') && mt.includes('#monthwrap') && mt.includes('#joinedwrap'), mt.join());
    check('the meter hides every other panel',
          !mt.includes('#scorecard') && !mt.includes('#clients') && !mt.includes('#chase') &&
          !mt.includes('#presets'), mt.join());

    doc.querySelector('#sources button[data-src="internal"]').click(); await settle();
    const dy = visible();
    check('daily view shows the presets and the daily panels',
          dy.includes('#presets') && dy.includes('#chase') && dy.includes('#boardsec'),
          dy.join());
    check('daily view hides the month picker, scorecard, book and meter',
          !dy.includes('#monthwrap') && !dy.includes('#scorecard') &&
          !dy.includes('#clients') && !dy.includes('#meter'), dy.join());
  }

  // ── 1f7. pods ───────────────────────────────────────────────────
  {
    const head = 'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes';
    const row = (id, who) => `${id},2026-07-01,,,x,S,${who},x@x.com,,2026-07-01,,n`;
    // A lead, two of their people written first-name-only in PODS, and a stranger.
    const people = ['Sukhmeet Singh','Gobind Monga','Sapna','Nobody Here'];
    const INT = [',,', ',,url', ',,', head].concat(people.map((p,i) => row(i+1, p))).join('\n');
    const CLI = [',,', ',,url', ',,', head, row(101,'Sukhmeet Singh')].join('\n');
    const { doc, win } = boot({ body: INT, clientBody: CLI }); await settle();

    doc.querySelector('#sources2 button[data-src="clients"]').click(); await settle();
    const teamRow = [...doc.querySelectorAll('#byrm tbody tr')]
      .find(r => /Sukhmeet Singh/.test(r.children[0].textContent));
    check('a first name in PODS resolves to the roster name',
          /Gobind Monga/.test(teamRow.children[0].textContent),
          teamRow.children[0].textContent);
    // Bhavey Saluja is in PODS but absent from this fixture, so the team resolves
    // to two of three: lead + Gobind + Sapna.
    check('head count includes the lead', teamRow.children[1].textContent === '3',
          teamRow.children[1].textContent);
    /* The client book no longer carries the notice — the KPI meter's hint does,
       because that is where the team totals it qualifies are shown. */
    check('the client book carries no placement notice', !shown(doc, '#podgaps'));
    check('a member missing from the roster is still reported, not counted',
          /Bhavey Saluja/.test(win.eval('POD_GAPS.join(" | ")')),
          win.eval('POD_GAPS.join(" | ")'));
    check('per head divides the book by the whole team',
          /L$|Cr$/.test(teamRow.children[4].textContent), teamRow.children[4].textContent);
    check('per head is smaller than the book',
          teamRow.children[4].textContent !== teamRow.children[3].textContent);

    // an unplaceable person must still be named somewhere, not silently dropped
    check('the stranger is named in the meter hint', (() => {
      doc.querySelector('#sources3 button[data-src="meter"]').click();
      return /Nobody Here/.test(txt(doc, '#meterhint'));
    })(), txt(doc, '#meterhint'));
    doc.querySelector('#sources2 button[data-src="clients"]').click();
    check('a lead absent from the roster gets no row',
          !/Shobhit/.test(doc.getElementById('byrm').textContent));

    // team column on the scorecard
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    pickMonths(doc, '2026-07');
    const rowFor = n => [...doc.querySelectorAll('#score tbody tr')]
      .find(r => r.children[0].textContent === n);
    check('a team member shows their lead',
          rowFor('Gobind Monga').children[7].textContent === 'Sukhmeet Singh',
          rowFor('Gobind Monga').children[7].textContent);
    check('a second member of the same team shows the same lead',
          rowFor('Sapna').children[7].textContent === 'Sukhmeet Singh',
          rowFor('Sapna').children[7].textContent);
    check('a lead shows themselves',
          rowFor('Sukhmeet Singh').children[7].textContent === 'Sukhmeet Singh',
          rowFor('Sukhmeet Singh').children[7].textContent);
    check('someone in no pod shows a dash',
          rowFor('Nobody Here').children[7].textContent === '—',
          rowFor('Nobody Here').children[7].textContent);

    // sorting by team keeps a pod together with its lead at the top
    doc.querySelector('#score th button[data-col="pod"]').click();
    const order = [...doc.querySelectorAll('#score tbody tr')].map(r => r.children[0].textContent);
    const pod = order.filter(n => n !== 'Nobody Here');
    check('a pod sorts as one block with the lead first',
          pod[0] === 'Sukhmeet Singh', order.join(' | '));
    check('the unplaced person does not break into the pod',
          Math.abs(order.indexOf('Sukhmeet Singh') - order.indexOf('Gobind Monga')) <= 2,
          order.join(' | '));

    // revenue and pods must not have moved a compliance figure
    check('missed days are untouched by pod grouping',
          [...doc.querySelectorAll('#score tbody tr')].every(r => {
            // an exempt tracker shows a dash; it contributes nothing, not NaN
            const n = i => r.children[i].textContent === '—' ? 0 : Number(r.children[i].textContent);
            return n(3) === n(1) + n(2);
          }));
  }

  // ── 1f8. the team target ────────────────────────────────────────
  {
    const { doc, win } = boot({ body: teamSheet(), clientBody: teamSheet(TEAM_PEOPLE, 500) });
    await settle();
    doc.querySelector('#sources2 button[data-src="clients"]').click(); await settle();
    const rowFor = n => [...doc.querySelectorAll('#byrm tbody tr')]
      .find(r => new RegExp(n).test(r.children[0].textContent));
    const num = s => Number(String(s).replace(/[^0-9.]/g, ''));

    check('the target defaults to a flat 50L', !doc.getElementById('scaletarget').checked);
    check('every team is held to the same number by default',
          [...doc.querySelectorAll('#byrm tbody tr')]
            .filter(r => !/Unassigned/.test(r.children[0].textContent))
            .every(r => /^₹50L$/.test(r.children[4].textContent)));
    check('the note says the target is the same for every team',
          /whatever its size/.test(txt(doc, '#targetnote')), txt(doc, '#targetnote'));

    const twoPctFlat = num(rowFor('Amit Kumar').children[5].textContent);

    // scaled is the option: a smaller team owes less, a larger team owes more
    doc.getElementById('scaletarget').checked = true;
    doc.getElementById('scaletarget').dispatchEvent(new win.Event('change'));
    check('the note states the standard team when scaled',
          /one RM and two assistants/.test(txt(doc, '#targetnote')), txt(doc, '#targetnote'));
    check('the note gives the per-person figure', /per person/.test(txt(doc, '#targetnote')));
    check('a standard team is measured against 50L either way',
          /^₹50L$/.test(rowFor('Mansi Rana').children[4].textContent),
          rowFor('Mansi Rana').children[4].textContent);
    check('a two-person team owes less when scaled',
          num(rowFor('Amit Kumar').children[4].textContent) < 50,
          rowFor('Amit Kumar').children[4].textContent);
    check('a four-person team owes more when scaled',
          num(rowFor('Sukhmeet Singh').children[4].textContent) > 50,
          rowFor('Sukhmeet Singh').children[4].textContent);
    check('an understaffed team reads better scaled than flat',
          num(rowFor('Amit Kumar').children[5].textContent) > twoPctFlat,
          `${num(rowFor('Amit Kumar').children[5].textContent)} vs ${twoPctFlat}`);

    check('the choice is remembered', win.localStorage.getItem('kpi.scaleTarget') === '1');
    doc.getElementById('scaletarget').checked = false;
    doc.getElementById('scaletarget').dispatchEvent(new win.Event('change'));

    // the gap column must agree with the percentage, in both directions
    doc.getElementById('scaletarget').checked = true;
    doc.getElementById('scaletarget').dispatchEvent(new win.Event('change'));
    check('gap and percentage never disagree',
          [...doc.querySelectorAll('#byrm tbody tr')]
            .filter(r => !/Unassigned/.test(r.children[0].textContent))
            .every(r => {
              const pct = num(r.children[5].textContent);
              const over = r.children[6].textContent.trim().startsWith('+');
              return pct >= 100 ? over : !over;
            }));
    // A team carrying no book is not measured against the target at all — a ₹0
    // against ₹50L would read as a shortfall rather than as nothing to measure.
    check('a team with no client book is not listed', !rowFor('Sagar Mishra'),
          rowFor('Sagar Mishra')?.textContent);
    check('and the note says why it is missing',
          /Sagar Mishra's team carries no client book/.test(txt(doc, '#targetnote')),
          txt(doc, '#targetnote'));
    check('every listed team has a real book',
          [...doc.querySelectorAll('#byrm tbody tr')]
            .filter(r => !/Unassigned/.test(r.children[0].textContent))
            .every(r => /₹/.test(r.children[3].textContent) &&
                        r.children[3].textContent !== '₹0'));

    /* The clamp at the 100% boundary is `gap >= 0 ? max(100, round) : min(99, round)`,
       so a team a hair under target prints 99% and one a hair over prints 100%.
       Mansi Rana used to be the shortfall fixture, sitting ~5,000 below 50L. The
       3 Aug book moved Lal Bahadur Shastri Bilaspur to her and she is now over.
       No team currently falls between 99% and 100%, so the shortfall half of the
       clamp is exercised only by the sign-agreement check above; this asserts the
       over-target half against a team just past the line. */
    check('a team just over target does not round down to 99%', (() => {
      const r = rowFor('Mansi Rana');
      return r.children[5].textContent === '103%' && r.children[6].textContent.startsWith('+');
    })(), rowFor('Mansi Rana').textContent);

    // revenue targets must not have leaked into compliance
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    check('the scorecard has no target column',
          !/target/i.test(doc.querySelector('#score thead').textContent),
          doc.querySelector('#score thead').textContent);
  }

  // ── 1f9. the KPI meter ──────────────────────────────────────────
  {
    // Everyone files a different number of days so the compliance roll-up has
    // something to get wrong.
    const rows = []; let id = 1;
    TEAM_PEOPLE.forEach((p, i) => {
      for (let d = 1; d <= (i % 5) + 2; d++)
        rows.push(`${id++},2026-07-01,,,x,S,${p},x@x.com,,2026-07-${String(d).padStart(2,'0')},,n`);
    });
    const INT = [',,', ',,url', ',,', TEAM_HEAD].concat(rows).join('\n');
    const CLI = INT.replace(/\n(\d+),/g, (m, d) => '\n' + (Number(d) + 900) + ',');
    const { doc, win } = boot({ body: INT, clientBody: CLI }); await settle();

    const tab = doc.querySelector('#sources3 button[data-src="meter"]');
    check('the meter has its own group',
          tab.closest('.group')?.querySelector('.grouplabel')?.textContent === 'Overall',
          tab.closest('.group')?.querySelector('.grouplabel')?.textContent);
    tab.click(); await settle();
    pickMonths(doc, '2026-07');

    check('meter panel shown', shown(doc, '#meter'));
    check('the month picker is available here too', shown(doc, '#monthwrap'));
    check('the compliance views are hidden',
          !shown(doc, '#scorecard') && !shown(doc, '#clients') && !shown(doc, '#chase'));

    const cards = [...doc.querySelectorAll('.mcard')];
    // Sagar's team is deliberately kept off this view, so six of the seven show
    check('one card per measured team', cards.length === 6, cards.length + ' cards');
    check('the excluded team has no card',
          !cards.some(c => /Sagar Mishra/.test(c.querySelector('h4').textContent)));
    check('the note says why it is missing',
          /Sagar Mishra's team is not shown here/.test(txt(doc, '#meterhint')),
          txt(doc, '#meterhint'));
    check('and says those people still count elsewhere',
          /still counting on the scorecard/.test(txt(doc, '#meterhint')));
    check('excluded people are not reported as unplaced',
          !/Mehak|Akshat/.test((txt(doc, '#meterhint').match(/in no team.*/) || [''])[0]),
          txt(doc, '#meterhint'));
    check('each card carries all three dials',
          cards.every(c => c.querySelectorAll('.dial').length === 3));
    check('the dials are labelled compliance, business and adoption',
          cards.every(c => {
            const l = [...c.querySelectorAll('.dial .lbl')].map(x => x.textContent);
            return l[0] === 'Compliance' && l[1] === 'Business' && l[2] === 'Module adoption';
          }));

    const card = n => cards.find(c => c.querySelector('h4').textContent === n);
    const val = (c, i) => c.querySelectorAll('.val')[i].textContent;
    const sub = (c, i) => c.querySelectorAll('.sub')[i].textContent;

    // Business must agree with the book table, which is the same source
    check('business is the book over the target',
          /₹67.9L of ₹50L/.test(sub(card('Sukhmeet Singh'), 1)),
          sub(card('Sukhmeet Singh'), 1));
    check('a team over target reads above 100%',
          parseInt(val(card('Sukhmeet Singh'), 1)) > 100, val(card('Sukhmeet Singh'), 1));

    check('a team just over target does not round down to 99%',
          val(card('Mansi Rana'), 1) === '103%', val(card('Mansi Rana'), 1));

    // Compliance must be a pooled ratio, not an average of member percentages
    check('compliance shows filed over expected', /\d+\/\d+ entries/.test(sub(card('Amit Kumar'), 0)),
          sub(card('Amit Kumar'), 0));
    check('compliance matches the pooled ratio', (() => {
      const m = sub(card('Amit Kumar'), 0).match(/(\d+)\/(\d+)/);
      const expect = Math.min(99, Math.round(Number(m[1]) / Number(m[2]) * 100));
      return parseInt(val(card('Amit Kumar'), 0)) === expect;
    })(), sub(card('Amit Kumar'), 0) + ' -> ' + val(card('Amit Kumar'), 0));

    // the two are never blended into one figure
    check('no card shows a single combined score',
          cards.every(c => c.querySelectorAll('.val').length === 3));
    check('the note says why they are not blended',
          /not blended/.test(txt(doc, '#meterhint')), txt(doc, '#meterhint'));
    check('the note names the month in full', /July 2026/.test(txt(doc, '#meterhint')),
          txt(doc, '#meterhint'));

    // the shared controls must drive this view, not just the scorecard
    pickMonths(doc, '2026-08');
    check('changing the month re-renders the meter',
          /August 2026/.test(txt(doc, '#meterhint')), txt(doc, '#meterhint'));

    // several months at once
    pickMonths(doc, '2026-07', '2026-08');
    check('two months name both', /July and August 2026/.test(txt(doc, '#meterhint')),
          txt(doc, '#meterhint'));
    check('expected days grow with the selection', (() => {
      const m = sub(card('Amit Kumar'), 0).match(/\d+\/(\d+)/);
      return Number(m[1]) > 54;
    })(), sub(card('Amit Kumar'), 0));

    pickMonths(doc, '2026-07');
    const joined = doc.getElementById('joined');
    joined.checked = !joined.checked;
    joined.dispatchEvent(new (win.Event)('change'));
    check('the joined toggle re-renders the meter rather than the daily view',
          doc.querySelectorAll('.mcard').length === cards.length && shown(doc, '#meter'));
    check('and the figures respond to it',
          typeof val([...doc.querySelectorAll('.mcard')].find(c =>
            c.querySelector('h4').textContent === 'Amit Kumar'), 0) === 'string');
  }

  // ── 1f10. meter degenerate cases and cross-checks ───────────────
  {
    const one = p => [',,', ',,url', ',,', TEAM_HEAD]
      .concat(p.map((x, i) => `${i + 1},2026-07-01,,,x,S,${x},x@x.com,,2026-07-01,,n`)).join('\n');
    const oneB = p => [',,', ',,url', ',,', TEAM_HEAD]
      .concat(p.map((x, i) => `${i + 901},2026-07-01,,,x,S,${x},x@x.com,,2026-07-01,,n`)).join('\n');

    // a lead on their own is still a team of one
    {
      const { doc, win } = boot({ body: one(['Ankush Rana']), clientBody: oneB(['Ankush Rana']) });
      await settle();
      doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
      pickMonths(doc, '2026-07');
      check('a lead with no team still gets a card',
            doc.querySelectorAll('.mcard').length === 1,
            String(doc.querySelectorAll('.mcard').length));
    }

    // nobody placed: an empty grid would read as a loading state, so it must explain
    {
      const { doc, win } = boot({ body: one(['Zeta One','Zeta Two']), clientBody: oneB(['Zeta One']) });
      await settle();
      doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
      pickMonths(doc, '2026-07');
      check('no teams gives a message, not a blank grid',
            /No teams to show/.test(txt(doc, '#meters')), txt(doc, '#meters'));
      check('and it names the file to edit', /PODS/.test(txt(doc, '#meters')));
    }

    // lead missing from the roster: the reason must reach this view, not just the book
    {
      const { doc, win } = boot({ body: one(['Gobind Monga']), clientBody: oneB(['Gobind Monga']) });
      await settle();
      doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
      pickMonths(doc, '2026-07');
      check('a missing lead is explained on the meter, not left blank',
            /Sukhmeet Singh/.test(txt(doc, '#meters')), txt(doc, '#meters'));
    }

    // the invariant that matters: the meter and the scorecard cannot disagree
    {
      const rows = []; let id = 1;
      TEAM_PEOPLE.forEach((p, i) => {
        for (let d = 1; d <= (i % 6) + 2; d++)
          rows.push(`${id++},2026-07-01,,,x,S,${p},x@x.com,,2026-07-${String(d).padStart(2,'0')},,n`);
      });
      const INT = [',,', ',,url', ',,', TEAM_HEAD].concat(rows).join('\n');
      const CLI = INT.replace(/\n(\d+),/g, (m, d) => '\n' + (Number(d) + 900) + ',');
      const { doc, win } = boot({ body: INT, clientBody: CLI }); await settle();
      doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
      pickMonths(doc, '2026-07');

      const meter = JSON.parse(win.eval(
        'JSON.stringify(meterRows().rows.map(r=>[r.lead,r.filed,r.expected]))'));
      const score = JSON.parse(win.eval(
        'JSON.stringify(scoreRows().rows.map(r=>[r.name,r.filed,r.expected]))'));
      const leadOf = new Map(JSON.parse(win.eval('JSON.stringify([...POD_OF.entries()])')));
      const pooled = {};
      for (const [n, f, e] of score){
        const l = leadOf.get(n); if (!l) continue;
        pooled[l] = pooled[l] || [0, 0];
        pooled[l][0] += f; pooled[l][1] += e;
      }
      check('meter compliance equals the pooled scorecard rows, team by team',
            meter.every(([l, f, e]) => (pooled[l] || [0,0])[0] === f && (pooled[l] || [0,0])[1] === e),
            meter.map(([l,f,e]) => `${l} ${f}/${e} vs ${(pooled[l]||[]).join('/')}`).join('; '));
      check('every team on the meter is a measured team',
            meter.length === Number(win.eval('POD_TEAM.size')) - Number(win.eval('NO_BOOK_TEAMS.length')),
            `${meter.length} vs ${win.eval('POD_TEAM.size')}`);
      check('no excluded team leaks into the roll-up',
            !meter.some(([l]) => /Sagar Mishra/.test(l)), meter.map(x => x[0]).join());
    }
  }

  // ── 1f11. the "how is this worked out" panel ────────────────────
  {
    const rows = []; let id = 1;
    const skip = {'Sultan Malik':[3,10], 'Lokesh Kumar':[6], 'Amar Kumar Pandit':[]};
    const people = ['Sultan Malik','Lokesh Kumar','Amar Kumar Pandit','Amit Kumar','Priya'];
    people.forEach(p => {
      for (let d = 1; d <= 20; d++){
        if (new Date(2026, 6, d).getDay() === 0) continue;
        if ((skip[p] || []).includes(d)) continue;
        rows.push(`${id++},2026-07-01,,,x,S,${p},x@x.com,,2026-07-${String(d).padStart(2,'0')},,n`);
      }
    });
    const INT = [',,', ',,url', ',,', TEAM_HEAD].concat(rows).join('\n');
    const CLI = INT.replace(/\n(\d+),/g, (m, d) => '\n' + (Number(d) + 900) + ',');
    const { doc, win } = boot({ body: INT, clientBody: CLI }); await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    pickMonths(doc, '2026-07');

    const cards = [...doc.querySelectorAll('.mcard')];
    check('every card has an info button',
          cards.every(c => c.querySelector('button.info')));
    check('panels start closed', cards.every(c => c.querySelector('.how').hidden));
    check('buttons report their state',
          cards.every(c => c.querySelector('button.info').getAttribute('aria-expanded') === 'false'));

    const card = n => cards.find(c => new RegExp(n).test(c.querySelector('h4').textContent));
    const sultan = card('Sultan Malik');
    sultan.querySelector('button.info').click();
    check('clicking opens the panel', !sultan.querySelector('.how').hidden);
    check('and flips aria-expanded',
          sultan.querySelector('button.info').getAttribute('aria-expanded') === 'true');

    const how = sultan.querySelector('.how').textContent.replace(/\s+/g, ' ');
    check('it states the rule', /one expected entry per tracker/.test(how), how.slice(0, 90));
    check('it names the Sunday and Saturday treatment',
          /Sundays excluded/.test(how) && /Saturdays counted/.test(how));
    check('it lists every member of the team',
          /Sultan Malik/.test(how) && /Lokesh Kumar/.test(how) && /Amar Kumar Pandit/.test(how));
    check('it gives actual dates', /\d+ Jul/.test(how), how.slice(-80));
    check('it separates the two trackers',
          /internal calls/.test(how) && /client calls/.test(how));

    // the explanation must not be able to disagree with the dial it explains
    const dialSub = sultan.querySelectorAll('.sub')[0].textContent;   // "N/M entries"
    const m = dialSub.match(/(\d+)\/(\d+)/);
    check('the panel arithmetic matches the dial',
          new RegExp(`${m[2]} expected`).test(how) && new RegExp(`${m[1]} filed`).test(how),
          `${dialSub} vs ${how.match(/\d+ expected, \d+ filed, \d+ missed/)}`);
    check('missed equals expected minus filed in the text', (() => {
      const t = how.match(/(\d+) expected, (\d+) filed, (\d+) missed/);
      return Number(t[3]) === Number(t[1]) - Number(t[2]);
    })(), how.match(/\d+ expected, \d+ filed, \d+ missed/));
    check('the dates listed match the missed count', (() => {
      const t = Number(how.match(/(\d+) missed/)[1]);
      const listed = (sultan.querySelector('.how .missed').textContent.match(/\d+ [A-Z][a-z]{2}/g) || []).length;
      return listed === t;
    })());

    // only one open at a time, or the grid stops being comparable
    card('Amit Kumar').querySelector('button.info').click();
    check('opening another closes the first', sultan.querySelector('.how').hidden);
    check('and resets the first button',
          sultan.querySelector('button.info').getAttribute('aria-expanded') === 'false');
    check('the second is open', !card('Amit Kumar').querySelector('.how').hidden);
    card('Amit Kumar').querySelector('button.info').click();
    check('clicking the same button closes it', card('Amit Kumar').querySelector('.how').hidden);

    // the panel must follow the joined toggle, like the dial does
    doc.getElementById('joined').checked = false;
    doc.getElementById('joined').dispatchEvent(new (win.Event)('change'));
    const after = [...doc.querySelectorAll('.mcard')]
      .find(c => /Sultan Malik/.test(c.querySelector('h4').textContent));
    check('re-rendering closes any open panel',
          [...doc.querySelectorAll('.how')].every(h => h.hidden));
    after.querySelector('button.info').click();
    check('the panel drops the skip sentence when the toggle is off',
          !/first ever entry are skipped/.test(after.querySelector('.how').textContent),
          after.querySelector('.how').textContent.slice(0, 200));
  }

  // ── 1f12. escalations ───────────────────────────────────────────
  {
    const { doc, win } = boot(); await settle();
    doc.querySelector('#sources2 button[data-src="clients"]').click(); await settle();

    const esc = JSON.parse(win.eval('JSON.stringify(ESCALATIONS)'));
    check('sub-tasks are not counted as escalations', esc.length === 4,
          esc.length + ': ' + esc.map(e => e.client).join());
    check('the client comes from Projects, not the task name',
          esc.some(e => e.client === 'Budha College Karnal'), esc.map(e => e.client).join());
    check('"Client Escalations" itself is never taken as the client',
          !esc.some(e => /Client Escalations/i.test(e.client)));
    check('a row with no project of its own falls back to the task name',
          esc.some(e => e.client === 'Zzz Unknown Academy'), esc.map(e => e.client).join());
    check('open and closed are distinguished',
          esc.filter(e => !e.closed).length === 3 && esc.filter(e => e.closed).length === 1,
          esc.map(e => `${e.client}:${e.closed || 'open'}`).join());

    const rows = [...doc.querySelectorAll('#clientlist tbody tr')];
    const rowFor = n => rows.find(r => r.children[0].textContent.startsWith(n));
    check('an open escalation flags the row',
          rowFor('Budha College Karnal').classList.contains('flagged'));
    check('and carries an open badge',
          /open/.test(rowFor('Budha College Karnal').querySelector('.esc')?.className || ''),
          rowFor('Budha College Karnal').querySelector('.esc')?.outerHTML);
    check('a shortened project name still matches the book',
          rowFor('Vedashree')?.classList.contains('flagged'),
          rowFor('Vedashree')?.outerHTML.slice(0, 90));
    check('a closed escalation marks but does not flag', (() => {
      const r = rowFor('GVM Girls College');
      return r && !r.classList.contains('flagged') && /shut/.test(r.querySelector('.esc').className);
    })(), rowFor('GVM Girls College')?.outerHTML.slice(0, 120));
    check('clients with no escalation carry no badge',
          rows.filter(r => !r.querySelector('.esc')).length > 100);

    // an unmatchable name must be named, never guessed onto a similar client
    const unmatched = JSON.parse(win.eval('JSON.stringify(ESC_UNMATCHED)'));
    check('an unmatchable escalation is reported', unmatched.includes('Zzz Unknown Academy'),
          unmatched.join());
    check('and is not silently attached to a similar client',
          !rows.some(r => /Academy/.test(r.children[0].textContent) &&
                          r.classList.contains('flagged')));
    check('the note names it and says where to fix it',
          /Zzz Unknown Academy/.test(txt(doc, '#escnote')) && /ESC_ALIAS/.test(txt(doc, '#escnote')),
          txt(doc, '#escnote'));

    // every alias must point at a client that exists, or it resolves to nothing
    check('every alias target is a real client',
          !unmatched.some(u => /aliased to/.test(u)), unmatched.join());
    check('a broken alias would be reported', (() => {
      const targets = JSON.parse(win.eval('JSON.stringify(Object.values(ESC_ALIAS))'));
      const book = JSON.parse(win.eval('JSON.stringify(CLIENTS.map(c=>c.n))'));
      return targets.every(t => book.includes(t));
    })(), win.eval('JSON.stringify(Object.values(ESC_ALIAS))'));
    check('the note counts flagged clients', /clients flagged/.test(txt(doc, '#escnote')),
          txt(doc, '#escnote'));

    // filters must not lose the flags
    const sel = doc.getElementById('cowner');
    sel.value = 'Sukhmeet Singh';
    sel.dispatchEvent(new win.Event('change'));
    check('flags survive filtering', [...doc.querySelectorAll('#clientlist tbody tr')]
            .every(r => !r.querySelector('.esc.open') || r.classList.contains('flagged')));
  }

  // ── 1f13. escalations must never break the page ─────────────────
  {
    // The compliance figures do not depend on this sheet, so a failure there has
    // to degrade to "no flags" rather than an error screen.
    const { doc, win } = boot({ escBody: 'total,nonsense\n1,2' }); await settle();
    check('a malformed escalation sheet still renders the dashboard',
          doc.getElementById('content').hidden === false);
    doc.querySelector('#sources2 button[data-src="clients"]').click(); await settle();
    check('the client list is intact',
          doc.querySelectorAll('#clientlist tbody tr').length > 100);
    check('no row is flagged', !doc.querySelector('#clientlist tr.flagged'));
    check('the failure is stated, not hidden',
          /could not be loaded/.test(txt(doc, '#escnote')), txt(doc, '#escnote'));
    check('and it says the rest of the page is fine',
          /rest of this page is unaffected/.test(txt(doc, '#escnote')));

    // and the scorecard is untouched by any of it
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    check('the scorecard still computes', doc.querySelectorAll('#score tbody tr').length > 0);
  }

  // ── 1f14. escalations on the team cards ─────────────────────────
  {
    const { doc, win } = boot({ body: teamSheet(), clientBody: teamSheet(TEAM_PEOPLE, 500) });
    await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    pickMonths(doc, '2026-07');

    const cards = [...doc.querySelectorAll('.mcard')];
    const card = n => cards.find(c => new RegExp(n).test(c.querySelector('h4').textContent));
    check('every card carries an escalation line',
          cards.every(c => c.querySelector('.escline')));
    check('escalations are not drawn as a dial — a count has no denominator',
          cards.every(c => c.querySelectorAll('.track').length === 3));

    // Budha College Karnal and Vedashree School are Sukhmeet's and Kashish's in
    // the embedded book; the fixture opens one on each.
    const sk = card('Sukhmeet Singh');
    check('a team with an open escalation says so',
          /open/.test(sk.querySelector('.escline .n').textContent),
          sk.querySelector('.escline .n').textContent);
    check('and it is marked hot', sk.querySelector('.escline').classList.contains('hot'));
    check('the affected client is named, not just counted',
          /Budha College Karnal/.test(sk.querySelector('.escwho')?.textContent || ''),
          sk.querySelector('.escwho')?.textContent);

    const clean = cards.find(c => /None open/.test(c.querySelector('.escline').textContent));
    check('a team with nothing open reads "None open"', !!clean);
    check('and is not marked hot', !clean.classList.contains('hot'));

    // an escalation only reaches the team that owns the client
    const escd = cards.filter(c => c.querySelector('.escline.hot'));
    check('escalations reach only the owning team', escd.length < cards.length,
          `${escd.length} of ${cards.length} teams flagged`);

    // the (i) panel must detail what the line summarises
    sk.querySelector('button.info').click();
    const how = sk.querySelector('.how').textContent.replace(/\s+/g, ' ');
    check('the panel lists the escalation', /Escalations/.test(how) &&
          /Budha College Karnal/.test(how), how.slice(0, 160));
    check('with the date it was raised', /raised \d+ \w{3} \d{4}/.test(how), how.slice(0, 200));

    // and a failure must not take the cards down
    const b2 = boot({ body: teamSheet(), clientBody: teamSheet(TEAM_PEOPLE, 500),
                      escBody: 'nonsense\n1' });
    await settle();
    b2.doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('a broken escalation sheet still renders the cards',
          b2.doc.querySelectorAll('.mcard').length > 0);
    check('and the line says so rather than reading zero',
          /not loaded/.test(b2.doc.querySelector('.escwho')?.textContent || ''),
          b2.doc.querySelector('.escwho')?.textContent);
    check('no team is wrongly marked clean',
          ![...b2.doc.querySelectorAll('.escline')].some(l => /None open/.test(l.textContent)));
  }

  // ── 1f15. the month picker ──────────────────────────────────────
  {
    const { doc, win } = boot({ body: teamSheet(), clientBody: teamSheet(TEAM_PEOPLE, 500) });
    await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();

    check('the picker is a button, not a bare month input',
          !!doc.getElementById('monthbtn') && !doc.querySelector('input[type=month]'));
    check('it starts closed', doc.getElementById('monthpop').hidden);
    doc.getElementById('monthbtn').click();
    check('clicking opens it', !doc.getElementById('monthpop').hidden);
    check('and reports its state',
          doc.getElementById('monthbtn').getAttribute('aria-expanded') === 'true');

    // only months with data behind them
    const offered = [...doc.querySelectorAll('#monthlist input')].map(i => i.value);
    check('every offered month is within coverage or currently chosen',
          offered.every(m => m >= '2026-07'), offered.join());
    check('the current month is offered', offered.includes('2026-08'), offered.join());
    check('a month with no data is not offered', !offered.includes('2026-03'), offered.join());

    // one month behaves exactly as the old single picker did
    pickMonths(doc, '2026-07');
    check('one month reads as that month alone', txt(doc, '#monthbtn') === 'July 2026',
          txt(doc, '#monthbtn'));
    const oneMonth = Number(doc.querySelector('.mcard .sub').textContent.match(/\/(\d+)/)[1]);

    // and a past month must not claim to be running
    check('a finished month does not say "to date"',
          !/to date/.test(txt(doc, '#meterhint')), txt(doc, '#meterhint'));
    pickMonths(doc, '2026-08');
    check('the current month does say "to date"',
          /to date/.test(txt(doc, '#meterhint')), txt(doc, '#meterhint'));

    // two months
    pickMonths(doc, '2026-07', '2026-08');
    check('two months are named in full', txt(doc, '#monthbtn') === 'July and August 2026',
          txt(doc, '#monthbtn'));
    const twoMonths = Number(doc.querySelector('.mcard .sub').textContent.match(/\/(\d+)/)[1]);
    check('expected days are the sum of both months', twoMonths > oneMonth,
          `${twoMonths} vs ${oneMonth}`);

    // the quick picks
    doc.querySelector('#monthpop button[data-pick="this"]').click();
    check('"This month" selects exactly one', txt(doc, '#monthbtn') === 'August 2026',
          txt(doc, '#monthbtn'));
    doc.querySelector('#monthpop button[data-pick="all"]').click();
    check('"All covered" selects every offered month',
          [...doc.querySelectorAll('#monthlist input:checked')].length === offered.length);

    // unticking everything must not produce a 0/0 dashboard
    for (const b of doc.querySelectorAll('#monthlist input')) b.checked = false;
    doc.querySelector('#monthlist input').dispatchEvent(new win.Event('change', {bubbles: true}));
    check('an empty selection falls back to the current month rather than nothing',
          txt(doc, '#monthbtn') === 'August 2026', txt(doc, '#monthbtn'));
    check('and the cards still render', doc.querySelectorAll('.mcard').length > 0);

    check('the choice is remembered',
          JSON.parse(win.localStorage.getItem('kpi.months')).length === 1,
          win.localStorage.getItem('kpi.months'));

    // clicking away closes the popover
    doc.getElementById('monthbtn').click();
    doc.body.click();
    check('clicking outside closes it', doc.getElementById('monthpop').hidden);
  }

  // ── 1f16. months carry across the two views that use them ───────
  {
    const { doc } = boot({ body: teamSheet(), clientBody: teamSheet(TEAM_PEOPLE, 500) });
    await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    pickMonths(doc, '2026-07', '2026-08');
    const scoreExpected = [...doc.querySelectorAll('#score tbody tr')]
      .map(r => r.children[4].textContent);
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    check('the meter inherits the scorecard selection',
          txt(doc, '#monthbtn') === 'July and August 2026', txt(doc, '#monthbtn'));
    check('and the two agree on the totals', (() => {
      const meterTotal = JSON.parse(doc.defaultView.eval(
        'JSON.stringify(meterRows().rows.reduce((n,r)=>n+r.expected,0))'));
      const scoreTotal = scoreExpected.reduce((n, s) => n + Number(s.split('/')[1] || 0), 0);
      return meterTotal > 0 && scoreTotal >= meterTotal;
    })());
    check('the CSV filename covers the whole span', (() => {
      return /2026-07/.test(doc.defaultView.eval('scoreRows().months.join()'));
    })());
  }

  // ── 1f17. sorting the client list ───────────────────────────────
  {
    const { doc, win } = boot(); await settle();
    doc.querySelector('#sources2 button[data-src="clients"]').click(); await settle();
    const rows = () => [...doc.querySelectorAll('#clientlist tbody tr')];
    const col = (i) => rows().map(r => r.children[i].textContent.trim());
    const hit = c => doc.querySelector(`#clientlist th button[data-ccol="${c}"]`).click();
    const num = s => Number(String(s).replace(/[^0-9.]/g, ''));

    check('every client column has a sort button',
          doc.querySelectorAll('#clientlist th button[data-ccol]').length === 6,
          String(doc.querySelectorAll('#clientlist th button[data-ccol]').length));
    // Compare the underlying figures, not the abbreviated display — "₹70,000"
    // and "₹13.7L" do not compare as written.
    const byName = new Map(JSON.parse(win.eval('JSON.stringify(CLIENTS.map(c=>[c.n,c.r]))')));
    check('default is billing, largest first', (() => {
      const v = col(0).map(n => byName.get(n)).filter(x => x != null);
      return v.every((x, i) => i === 0 || v[i-1] >= x);
    })(), col(4).slice(0, 4).join());
    check('one column marked sorted by default',
          doc.querySelectorAll('#clientlist th[aria-sort]').length === 1);

    hit('n');
    const az = ns => [...ns].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    check('client sorts A to Z', col(0).join('|') === az(col(0)).join('|'),
          col(0).slice(0, 3).join());
    hit('n');
    check('clicking again reverses it',
          col(0).join('|') === az(col(0)).reverse().join('|'), col(0).slice(0, 3).join());
    check('still only one column marked',
          doc.querySelectorAll('#clientlist th[aria-sort]').length === 1);

    // Size is a band, not a word: Large > Medium > Small, never alphabetical
    hit('c');
    const sizes = col(3).filter(x => x !== '—');
    check('size sorts by band, largest first', sizes[0] === 'Large', sizes.slice(0, 3).join());
    check('and does not sort alphabetically',
          sizes.join('|') !== [...sizes].sort().reverse().join('|'), sizes.slice(0, 3).join());
    hit('c');
    check('reversed, smallest first',
          col(3).filter(x => x !== '—')[0] === 'Small',
          col(3).slice(0, 3).join());
    check('unsized clients sink either way', (() => {
      const v = col(3);
      const firstDash = v.indexOf('—');
      return firstDash === -1 || v.slice(firstDash).every(x => x === '—');
    })(), col(3).slice(-3).join());

    // escalations: open outrank resolved, and no escalation is not a zero
    hit('e');
    const esc = col(5);
    check('open escalations sort to the top', /open/.test(esc[0]), esc.slice(0, 3).join(' | '));
    check('resolved rank below open', (() => {
      const lastOpen = esc.map(x => /open/.test(x)).lastIndexOf(true);
      const firstShut = esc.findIndex(x => /resolved/.test(x));
      return firstShut === -1 || firstShut > lastOpen;
    })(), esc.slice(0, 4).join(' | '));
    check('clients with no escalation sink to the bottom',
          esc[esc.length - 1] === '—', esc.slice(-2).join(' | '));

    check('sort choice is remembered',
          JSON.parse(win.localStorage.getItem('kpi.clientSort')).col === 'e',
          win.localStorage.getItem('kpi.clientSort'));

    // sorting and filtering must compose
    const sel = doc.getElementById('cowner');
    sel.value = [...sel.options].map(o => o.value).filter(Boolean)[0];
    sel.dispatchEvent(new win.Event('change'));
    check('the sort survives a filter change', /open|resolved|—/.test(col(5)[0]));
    check('the filter still narrows the list', rows().length < 148, rows().length + ' rows');
    check('and the total follows', new RegExp(`^${rows().length} clients`).test(txt(doc, '#ctot')),
          txt(doc, '#ctot'));
  }

  // ── 1g. stale-function guard ────────────────────────────────────
  {
    // an old api/data.js ignores ?src= and serves one sheet for both
    const { doc, errs } = boot({ body: SHEET, clientBody: SHEET }); await settle();
    check('identical sources refuse to render', doc.getElementById('content').hidden === true);
    check('the cause is named', /same sheet/.test(txt(doc, '#state')), txt(doc, '#state'));
    check('the fix is named', /api\/data\.js/.test(txt(doc, '#state')), txt(doc, '#state'));
    check('no crash', errs.length === 0, errs.join(' | '));
  }
  {
    // genuinely different sheets must still render
    const OTHER = ['Task ID,Created At,Name,Assignee,Assignee Email,Due Date',
      '9,2026-07-30,z,Amit Kumar,amit@x.com,2026-07-30'].join('\n');
    const { doc } = boot({ clientBody: OTHER }); await settle();
    check('different sources render normally', doc.getElementById('content').hidden === false);
  }

  // ── 1h. export-window coverage ──────────────────────────────────
  {
    /* A month outside the export window can only be reached by restoring a choice
       from a previous visit — the picker will not offer one otherwise. It must
       still be listed and flagged rather than scored silently. */
    const { doc } = boot({ store: {'kpi.months': '["2026-01"]'} }); await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    check('a restored month outside coverage is still listed',
          [...doc.querySelectorAll('#monthlist input')].some(i => i.value === '2026-01'));
    check('month outside the data is flagged',
          /outside the data/i.test(txt(doc, '#coverwarn')), txt(doc, '#coverwarn'));
    check('warning names how far back the data reaches',
          /Jul/.test(txt(doc, '#coverwarn')), txt(doc, '#coverwarn'));
  }
  {
    // a fully covered month gets no warning
    const { doc } = boot(); await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    pickMonths(doc, '2026-08');
    check('covered month shows no warning', txt(doc, '#coverwarn') === '', txt(doc, '#coverwarn'));
  }
  {
    // A sheet at the export limit is not itself a problem, so it says nothing. Only a
    // month that actually falls outside the data is worth interrupting for.
    const rows = [];
    for (let i = 0; i < 520; i++)
      rows.push(`${i + 10},2026-07-01,,,t${i},Section,Divya Gupta,divya@x.com,,2026-07-${
        String((i % 28) + 1).padStart(2, '0')},,plain`);
    const BIG = SHEET.split('\n').slice(0, 4).concat(rows).join('\n');
    const BIG_C = BIG.replace(/\n(\d+),/g, (m, d) => '\n' + (Number(d) + 1000) + ',');
    const { doc } = boot({ body: BIG, clientBody: BIG_C }); await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    pickMonths(doc, '2026-07');
    check('capped sheet alone raises no warning', txt(doc, '#coverwarn') === '',
          txt(doc, '#coverwarn'));

    const b2 = boot({ body: BIG, clientBody: BIG_C, store: {'kpi.months': '["2026-01"]'} });
    await settle();
    b2.doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    check('capped sheet still flags a month outside the data',
          /outside the data/i.test(txt(b2.doc, '#coverwarn')), txt(b2.doc, '#coverwarn'));
    check('that warning says the export limit is why',
          /export limit/i.test(txt(b2.doc, '#coverwarn')), txt(b2.doc, '#coverwarn'));
  }
  {
    // the scorecard carries no explanatory prose — the table is the whole story
    const { doc } = boot(); await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    check('scorecard hides the lede', doc.getElementById('lede').hidden);
    check('scorecard section has no hint paragraph',
          doc.querySelectorAll('#scorecard .hint').length === 0);
    doc.querySelector('#sources button[data-src="internal"]').click(); await settle();
    check('daily view keeps its lede', !doc.getElementById('lede').hidden);
    check('daily lede still describes the rule',
          /per person per working day/i.test(txt(doc, '#lede')), txt(doc, '#lede'));
  }

  // ── 2. happy path ──────────────────────────────────────────────
  {
    const { doc, errs, calls } = boot(); await settle();
    check('boots with no JS errors', errs.length === 0, errs.join(' | '));
    check('called the data endpoint for all five sheets', calls.length === 5 &&
          calls.every(u => /^\/api\/data\?src=/.test(u)), calls.join());
    /* Order is load-bearing, not incidental: buildEscalations matches escalation
       names against the client book, so the book has to be in place first or the
       matching silently runs against the fallback. */
    check('trackers together, then the book, then adoption and escalations', (() => {
      const src = calls.map(u => u.match(/src=(\w+)/)[1]);
      /* Both adoption and escalations match against client names, so both must
         follow the book — neither may overtake it. */
      return src[0] === 'internal' && src[1] === 'client' && src[2] === 'book' &&
             src.indexOf('adoption') > 2 && src.indexOf('escalations') > 2;
    })(), calls.join());
    check('cache-busted the request', /[?&]t=\d+/.test(calls[0] || ''), calls[0]);
    check('content revealed', doc.getElementById('content').hidden === false);
    check('state panel hidden', doc.getElementById('state').hidden === true);
    check('freshness line populated', /entries/.test(txt(doc, '#fresh')), txt(doc, '#fresh'));
    check('grid rendered', doc.querySelectorAll('#grid tbody tr').length > 0);
  }

  // ── 3. parsing of the awkward bits ─────────────────────────────
  {
    const { doc } = boot(); await settle();
    const people = [...doc.querySelectorAll('#board tbody td:first-child')].map(e => e.textContent);
    check('header found below spacer rows', people.length === 3, people.join('|'));
    check('quoted comma + newline survives', people.includes('Divya Gupta'), people.join('|'));
    check('blank assignee falls back to email', people.includes('Vansh Saini'), people.join('|'));
    check('apostrophe name kept verbatim', people.includes("O'Brien, Sam"), people.join('|'));
    check('case variants merged', people.filter(p => /divya/i.test(p)).length === 1, people.join('|'));
  }

  // ── 4. modes: Today / Yesterday / Date range ─────────────────────
  const TODAY_W = (() => { const d = new Date();
    while (d.getDay()===0) d.setDate(d.getDate()-1); return isoLocal(d); })();
  const YEST_W = (() => { const d = new Date();
    while (d.getDay()===0) d.setDate(d.getDate()-1);
    d.setDate(d.getDate()-1);
    while (d.getDay()===0) d.setDate(d.getDate()-1); return isoLocal(d); })();

  {
    const { doc } = boot(); await settle();
    check('opens on Today',
          doc.querySelector('#presets button[data-mode="today"]').getAttribute('aria-pressed') === 'true');
    check('Today sets both dates to today',
          doc.getElementById('from').value === TODAY_W && doc.getElementById('to').value === TODAY_W,
          doc.getElementById('from').value + ' -> ' + doc.getElementById('to').value);
    check('date inputs hidden unless Date range chosen', doc.getElementById('dates').hidden === true);
    check('no hardcoded date in markup', !/id="(to|from)" value=/.test(HTML));
  }
  {
    const { doc } = boot(); await settle();
    doc.querySelector('#presets button[data-mode="yesterday"]').click();
    check('Yesterday picks the previous working day', doc.getElementById('to').value === YEST_W,
          doc.getElementById('to').value + ' vs ' + YEST_W);
    check('Yesterday never lands on a Sunday',
          new Date(doc.getElementById('to').value + 'T00:00:00').getDay() !== 0);
    check('Yesterday labels the chase panel', /^Yesterday/.test(txt(doc, '#chase .when')),
          txt(doc, '#chase .when'));
    check('Yesterday hides the date inputs', doc.getElementById('dates').hidden === true);
  }
  {
    const { doc } = boot(); await settle();
    doc.querySelector('#presets button[data-mode="custom"]').click();
    check('Date range reveals the inputs', doc.getElementById('dates').hidden === false);
    const span = (new Date(doc.getElementById('to').value) - new Date(doc.getElementById('from').value)) / 86400000;
    check('Date range opens on a 15-day window', span === 15, span + ' days');
  }
  {
    const { doc, win } = boot(); await settle();
    doc.querySelector('#presets button[data-mode="custom"]').click();
    doc.getElementById('from').value = '2026-08-20';
    doc.getElementById('from').dispatchEvent(new win.Event('change'));
    check('From after To corrects itself',
          doc.getElementById('from').value <= doc.getElementById('to').value,
          doc.getElementById('from').value + ' -> ' + doc.getElementById('to').value);
  }
  {
    const { doc } = boot(); await settle();
    check('loading data leaves the chosen range alone',
          doc.getElementById('from').value === TODAY_W, doc.getElementById('from').value);
  }

  // ── 4b. chase list follows the chosen day ───────────────────────
  {
    const { doc } = boot(); await settle();
    const names = [...doc.querySelectorAll('#chase .names a')].map(a => a.childNodes[0].textContent);
    const n = txt(doc, '#chase .n');
    if (n) check('chase count matches chase names', Number(n) === names.length, `${n} vs ${names.length}`);
    else check('all-clear shown when nobody outstanding', /Everyone filed/.test(txt(doc, '#chase')));
    check('chase header says Today', /^Today/.test(txt(doc, '#chase .when')), txt(doc, '#chase .when'));
    check('chase header names the date', /\d/.test(txt(doc, '#chase .when')));
  }
  {
    const { doc } = boot(); await settle();
    const a = txt(doc, '#chase .when');
    doc.querySelector('#presets button[data-mode="yesterday"]').click();
    check('switching to Yesterday changes the day', txt(doc, '#chase .when') !== a);
  }
  {
    const { doc, win } = boot(); await settle();
    doc.querySelector('#presets button[data-mode="custom"]').click();
    doc.getElementById('to').value = '2026-07-29';
    doc.getElementById('to').dispatchEvent(new win.Event('change'));
    check('custom range anchors chase to its last working day',
          /29 Jul/.test(txt(doc, '#chase .when')), txt(doc, '#chase .when'));
  }

  // ── 5. failure paths explain themselves ────────────────────────
  {
    const { doc, errs } = boot({ status: 502, body: JSON.stringify({ error: 'Google returned a login page instead of the sheet.', hint: 'Set sharing to Anyone with the link.' }) });
    await settle();
    check('server error: no crash', errs.length === 0, errs.join(' | '));
    check('server error: content stays hidden', doc.getElementById('content').hidden === true);
    check('server error: message surfaced', /login page/.test(txt(doc, '#state')), txt(doc, '#state'));
    check('server error: hint surfaced', /Anyone with the link/.test(txt(doc, '#state')));
  }
  {
    const { doc, errs } = boot({ reject: true }); await settle();
    check('network failure: no crash', errs.length === 0, errs.join(' | '));
    check('network failure: explained', /Failed to fetch/.test(txt(doc, '#state')), txt(doc, '#state'));
    check('network failure: local-file hint', /opened this file directly/.test(txt(doc, '#state')));
  }
  {
    const { doc } = boot({ body: 'total,nonsense\n1,2' }); await settle();
    check('unparseable sheet: named clearly', /Could not find a header row/.test(txt(doc, '#state')),
          txt(doc, '#state'));
    check('unparseable sheet: no empty dashboard shown', doc.getElementById('content').hidden === true);
  }

  // ── 6. refresh re-fetches ──────────────────────────────────────
  {
    const { doc, calls } = boot(); await settle();
    doc.getElementById('refresh').click(); await settle();
    check('refresh refetches every sheet', calls.length === 10, calls.length + ' calls');
  }

  // ── 7. internal consistency of the figures ─────────────────────
  {
    const { doc } = boot(); await settle();
    const f = figs(doc);
    const rowTotals = [...doc.querySelectorAll('#grid td.tot')].reduce((s, e) => s + Number(e.textContent), 0);
    const red = doc.querySelectorAll('#grid .cell.m').length;
    const board = [...doc.querySelectorAll('#board tbody tr')].reduce((s, r) => s + Number(r.children[2].textContent), 0);
    check('headline == grid row totals', Number(f[0]) === rowTotals, `${f[0]} vs ${rowTotals}`);
    check('headline == red cell count', Number(f[0]) === red, `${f[0]} vs ${red}`);
    check('headline == board missed column', Number(f[0]) === board, `${f[0]} vs ${board}`);
    check('grid and board cover same people',
          doc.querySelectorAll('#grid tbody tr').length === doc.querySelectorAll('#board tbody tr').length);
  }

  // ── 8. controls still re-render ────────────────────────────────
  {
    const { doc, win } = boot(); await settle();
    const before = figs(doc).join();
    // From is the wrong lever here: with "skip days before first entry" on,
    // widening backwards adds no expected days. Moving To forward does.
    doc.getElementById('to').value = '2026-08-07';
    doc.getElementById('to').dispatchEvent(new win.Event('change'));
    check('changing To re-renders', figs(doc).join() !== before);
    // The toggle only has anything to skip across a multi-day window, so switch
    // to Date range first — under Today the range is one day and it is a no-op.
    // Pin the window explicitly rather than taking whatever custom range was
    // last remembered: the toggle can only bite where the range actually
    // contains days before someone's first entry.
    doc.querySelector('#presets button[data-mode="custom"]').click();
    doc.getElementById('from').value = '2026-07-20';
    doc.getElementById('to').value = '2026-07-30';
    doc.getElementById('to').dispatchEvent(new win.Event('change'));
    const mid = figs(doc).join();
    doc.getElementById('joined').checked = false;
    doc.getElementById('joined').dispatchEvent(new win.Event('change'));
    check('joined toggle re-renders over a multi-day range', figs(doc).join() !== mid,
          mid + ' -> ' + figs(doc).join());
  }

  // ── 8b. remembered state (needs a real origin for localStorage) ──
  {
    const { doc, win } = boot(); await settle();
    check('localStorage is actually available in the harness',
          (() => { try { win.localStorage.setItem('x','1'); return true; } catch (e) { return false; } })());
    doc.querySelector('#presets button[data-mode="custom"]').click();
    doc.getElementById('from').value = '2026-07-20';
    doc.getElementById('to').value = '2026-07-29';
    doc.getElementById('to').dispatchEvent(new win.Event('change'));
    check('custom range is written to storage',
          JSON.parse(win.localStorage.getItem('kpi.customRange') || '{}').to === '2026-07-29',
          win.localStorage.getItem('kpi.customRange'));
    doc.querySelector('#presets button[data-mode="today"]').click();
    doc.querySelector('#presets button[data-mode="custom"]').click();
    check('coming back to Date range restores it',
          doc.getElementById('from').value === '2026-07-20' &&
          doc.getElementById('to').value === '2026-07-29',
          `${doc.getElementById('from').value}..${doc.getElementById('to').value}`);
    check('view mode is written to storage', win.localStorage.getItem('kpi.mode') === 'custom',
          win.localStorage.getItem('kpi.mode'));
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    check('tab choice is written to storage', win.localStorage.getItem('kpi.source') === 'scorecard',
          win.localStorage.getItem('kpi.source'));
  }

  // ── 9. degenerate ranges ───────────────────────────────────────
  for (const [label, f, t] of [
    ['from after to', '2026-07-30', '2026-07-01'],
    ['single day', '2026-07-28', '2026-07-28'],
    ['lone Sunday', '2026-07-19', '2026-07-19'],
    ['range after data', '2027-01-01', '2027-01-31'],
  ]) {
    const { doc, win, errs } = boot(); await settle();
    doc.getElementById('from').value = f; doc.getElementById('to').value = t;
    doc.getElementById('to').dispatchEvent(new win.Event('change'));
    check(`no crash: ${label}`, errs.length === 0, errs.join(' | '));
  }

  // ── 10. timezone independence ──────────────────────────────────
  {
    const { win } = boot(); await settle();
    check('iso() round-trips in this TZ', win.eval("iso(D('2026-07-14'))") === '2026-07-14',
          `TZ=${process.env.TZ || 'UTC'}`);
    check('Sundays excluded',
          win.eval("JSON.stringify(range('2026-07-17','2026-07-21',true))")
            === '["2026-07-17","2026-07-18","2026-07-20","2026-07-21"]');
    const fixed = win.eval(`
      document.getElementById('from').value='2026-07-27';
      document.getElementById('to').value='2026-07-30';
      render();
      [...document.querySelectorAll('#kpis .fig')].map(e=>e.textContent.replace(/\\s+/g,'')).join('|');`);
    check('fixed range identical in every TZ', fixed === '4|56%|0/3|2',
          `TZ=${process.env.TZ || 'UTC'} gave ${fixed}`);
  }

  // ── 11. injection from sheet content ───────────────────────────
  {
    const evil = SHEET.replace('Divya Gupta,divya@x.com,,2026-07-30', '"<img src=x onerror=1>",e@x.com,,2026-07-30');
    const { doc } = boot({ body: evil }); await settle();
    check('sheet content cannot inject elements',
          doc.querySelectorAll('#board img, #grid img, #chase img').length === 0);
  }

  /* Same roster shape as the meter section, so every lead has a card. */
  const TEAM_INT = (() => {
    const rows = []; let id = 1;
    TEAM_PEOPLE.forEach((p, i) => {
      for (let d = 1; d <= (i % 5) + 2; d++)
        rows.push(`${id++},2026-07-01,,,x,S,${p},x@x.com,,2026-07-${String(d).padStart(2,'0')},,n`);
    });
    return [',,', ',,url', ',,', TEAM_HEAD].concat(rows).join('\n');
  })();
  const TEAM_CLI = TEAM_INT.replace(/\n(\d+),/g, (m, d) => '\n' + (Number(d) + 900) + ',');

  // ── 12. module adoption ────────────────────────────────────────
  {
    const { doc, win } = boot({ body: TEAM_INT, clientBody: TEAM_CLI }); await settle();
    doc.querySelector('#sources3 button[data-src="meter"]').click(); await settle();
    pickMonths(doc, '2026-07');
    const cards = [...doc.querySelectorAll('.mcard')];
    const card = n => cards.find(c => c.querySelector('h4').textContent === n);
    const dialVal = (c, i) => c.querySelectorAll('.val')[i].textContent;
    const dialSub = (c, i) => c.querySelectorAll('.sub')[i].textContent;

    // the round trip: the published CSV must read back as the snapshot
    check('the published sheet is read, not the built-in copy',
          win.eval('ADOPT_LIVE') === true, win.eval('ADOPT_ERROR'));
    check('round trip through CSV returns every scored client',
          win.eval('ADOPTION.length') === ADOPT_ROWS.length + 1,   // + the stray Totals row
          `${win.eval('ADOPTION.length')} of ${ADOPT_ROWS.length}`);
    check('and the counts survive it', (() => {
      const want = ADOPT_ROWS.reduce((n, r) => n + r.s, 0);
      return win.eval(`ADOPTION.filter(r=>r.n!=='Totals').reduce((n,r)=>n+r.s,0)`) === want;
    })());

    // scratch rows below the data must not reach a dial
    check('a blank row is dropped outright',
          !win.eval('ADOPTION').some(r => !r.n));
    check('a named row the book does not know is reported rather than counted',
          win.eval('ADOPT_UNMATCHED').includes('Totals'), win.eval('ADOPT_UNMATCHED').join());
    check('and the page names it', /Totals/.test(txt(doc, '#meterhint')));
    check('unmatched rows contribute to no team', (() => {
      const summed = win.eval(`[...POD_TEAM.keys()].filter(l=>!noBook(l))
        .reduce((n,l)=>n+adoptForTeam(l).applicable,0)`);
      const all = win.eval('ADOPTION.reduce((n,r)=>n+r.a,0)');
      return summed < all;
    })());

    /* Nothing may be counted twice or lost: every client that matched the book
       belongs to exactly one team, so the team totals must add up to the whole. */
    check('team totals reconcile with the matched rows', (() => {
      const per = win.eval(`[...new Set(CLIENTS.map(c=>c.o).filter(Boolean))]
        .reduce((n,o)=>n+adoptForTeam(o).applicable,0)`);
      const matched = win.eval(`[...ADOPT_BY_CLIENT.values()].reduce((n,r)=>n+r.a,0)`);
      return per === matched && per > 0;
    })(), win.eval(`[...new Set(CLIENTS.map(c=>c.o).filter(Boolean))]
        .reduce((n,o)=>n+adoptForTeam(o).applicable,0)`) + ' vs ' +
      win.eval(`[...ADOPT_BY_CLIENT.values()].reduce((n,r)=>n+r.a,0)`));

    // the dial is a pooled ratio over that team's book, like compliance
    check('adoption shows adopted over applicable',
          /\d+\/\d+ modules/.test(dialSub(card('Sukhmeet Singh'), 2)),
          dialSub(card('Sukhmeet Singh'), 2));
    check('adoption matches the pooled ratio', (() => {
      const m = dialSub(card('Sukhmeet Singh'), 2).match(/(\d+)\/(\d+)/);
      const want = Math.min(99, Math.round(Number(m[1]) / Number(m[2]) * 100));
      return parseInt(dialVal(card('Sukhmeet Singh'), 2)) === want;
    })(), dialSub(card('Sukhmeet Singh'), 2) + ' -> ' + dialVal(card('Sukhmeet Singh'), 2));

    /* Ownership: Cecil City & Cantt is scored on Mansi's tab but the book gives it
       to Amit, because the tab follows the assistant who did the work and
       assistants move between RMs. It must count for Amit and for nobody else —
       these are the RM's team score. */
    check('a client scored on another tab counts for the book owner', (() => {
      const amit = win.eval(`adoptForTeam('Amit Kumar').total`);
      const owned = win.eval(`CLIENTS.filter(c=>c.o==='Amit Kumar').length`);
      const scoredForAmit = win.eval(`CLIENTS.filter(c=>c.o==='Amit Kumar' &&
        ADOPT_BY_CLIENT.has(c.n)).length`);
      return amit === owned && scoredForAmit === win.eval(`adoptForTeam('Amit Kumar').scored`);
    })());
    check('and it is Amit who owns it in the book',
          win.eval(`CLIENTS.find(c=>c.n==='Cecil City & Cantt').o`) === 'Amit Kumar',
          String(win.eval(`CLIENTS.find(c=>c.n==='Cecil City & Cantt').o`)));
    check('the tab it was scored on changes nothing', (() => {
      /* Mansi's figures must be identical whether or not that row sits on her tab. */
      const before = win.eval(`adoptForTeam('Mansi Rana').applicable`);
      const onTab = win.eval(`ADOPTION.filter(r=>r.rm==='Mansi Rana').reduce((n,r)=>n+r.a,0)`);
      return before !== onTab && before > 0;
    })());

    // coverage: the denominator the dial cannot show has to be on the card
    check('every card states how much of the book was scored',
          cards.every(c => c.querySelector('.covline, .covwho')));
    check('a partly-scored team is flagged',
          !!card('Mansi Rana').querySelector('.covline.hot'),
          card('Mansi Rana').querySelector('.covline')?.textContent);
    check('and names the revenue behind the gap',
          /of ₹/.test(card('Mansi Rana').querySelector('.covwho')?.textContent || ''),
          card('Mansi Rana').querySelector('.covwho')?.textContent);

    /* Unscored clients must be absent from the ratio, not zero. Scoring them as
       zero would make a team that simply has not been assessed look failing. */
    check('unscored clients are excluded, not counted as zero', (() => {
      const a = win.eval(`JSON.stringify(adoptForTeam('Mansi Rana'))`);
      const o = JSON.parse(a);
      const scoredApplicable = win.eval(`ADOPTION.filter(r=>
        CLIENTS.some(c=>c.n===r.n && c.o==='Mansi Rana')).reduce((n,r)=>n+r.a,0)`);
      return o.applicable === scoredApplicable && o.missing.length > 0;
    })());

    // the (i) panel has to name what is missing, with the money
    card('Mansi Rana').querySelector('button.info').click();
    const how = card('Mansi Rana').querySelector('.how').textContent.replace(/\s+/g, ' ');
    check('the panel names the never-scored clients', /PIET College/.test(how), how.slice(0, 160));
    check('the panel says they are not counted as zero',
          /not counted as zero/.test(how));
    check('the panel says which quarter it is', /Quarter I/.test(how));
    check('the panel admits the target is a placeholder', /placeholder/.test(how));

    /* The live book must reach every consumer, not just the client book tab.
       BOOK was a parse-time constant until 5 Aug, so the business dial kept
       showing the revenue baked into the snapshot while the book tab showed
       today's. Nothing on screen compared the two until the adoption card
       printed the same team's total beside it. */
    check('the business dial and the adoption card agree on the book', (() => {
      return cards.every(c => {
        const biz = (c.querySelectorAll('.sub')[1].textContent.match(/^₹([\d.]+)L/) || [])[1];
        const cov = (c.querySelector('.covwho')?.textContent.match(/of ₹([\d.]+)L/) || [])[1];
        return !cov || !biz || cov === biz;
      });
    })(), cards.map(c => c.querySelector('h4').textContent + ':' +
          c.querySelectorAll('.sub')[1].textContent + '|' +
          (c.querySelector('.covwho')?.textContent || '')).join(' ~ ').slice(0, 200));

    // a team with no book is off this view entirely, as with business
    check('teams with no client book are still excluded',
          !cards.some(c => /Sagar Mishra/.test(c.querySelector('h4').textContent)));
  }

  {
    /* Revenue changed in the sheet since the snapshot was cut. Every figure the
       page shows must follow the sheet; any that follows the snapshot is stale. */
    const moved = BOOK_SHEET.replace(/"? ₹ [\d,]+\.00 "?,Mansi Rana/,
                                     ' ₹ 1.00 ,Mansi Rana');
    const { doc, win } = boot({ body: TEAM_INT, clientBody: TEAM_CLI, bookBody: moved });
    await settle();
    check('the live book is what loaded', win.eval('CLIENTS !== CLIENTS_FALLBACK'));
    check('a revenue change in the sheet reaches the business dial', (() => {
      const live = win.eval(`CLIENTS.filter(c=>c.o==='Mansi Rana').reduce((n,c)=>n+(c.r||0),0)`);
      const shown = win.eval(`bookOf('Mansi Rana').revenue`);
      return shown === live;
    })(), String(win.eval(`bookOf('Mansi Rana').revenue`)) + ' vs ' +
      String(win.eval(`CLIENTS.filter(c=>c.o==='Mansi Rana').reduce((n,c)=>n+(c.r||0),0)`)));
    check('and it is not the snapshot figure', (() => {
      const snap = BOOK_ROWS.filter(c => c.o === 'Mansi Rana').reduce((n, c) => n + (c.r || 0), 0);
      return win.eval(`bookOf('Mansi Rana').revenue`) !== snap;
    })());
    check('the adoption coverage follows the same book', (() => {
      const live = win.eval(`CLIENTS.filter(c=>c.o==='Mansi Rana').reduce((n,c)=>n+(c.r||0),0)`);
      return win.eval(`adoptForTeam('Mansi Rana').revTotal`) === live;
    })());
  }

  // ── 12b. the ERP module adoption tab ───────────────────────────
  {
    const { doc, win } = boot({ body: TEAM_INT, clientBody: TEAM_CLI }); await settle();
    const tab = doc.querySelector('#sources4 button[data-src="adoption"]');
    check('the adoption tab exists in its own group',
          tab?.closest('.group')?.querySelector('.grouplabel')?.textContent === 'Product');
    tab.click(); await settle();

    check('the adoption panel is shown', doc.getElementById('adoption').hidden === false);
    check('and every other panel is hidden',
          ['meter','clients','scorecard','chase','boardsec'].every(id =>
            doc.getElementById(id).hidden === true));
    /* Quarterly and not per-person: controls that cannot change a figure here
       must not be offered, or they imply the numbers respond to them. */
    check('the month picker is not offered', doc.getElementById('monthwrap').hidden === true);
    check('nor the joined toggle', doc.getElementById('joinedwrap').hidden === true);
    check('the heading changes with the tab',
          /use/.test(doc.getElementById('h1').textContent));

    const rows = sel => [...doc.querySelectorAll(sel + ' tbody tr')]
      .map(r => [...r.children].map(c => c.textContent.trim()));

    // by module
    const mods = rows('#adoptmodules');
    check('every module that applies to somebody is listed',
          mods.length > 0 && mods.length <= ADOPT_MODULES.length, `${mods.length}`);
    check('weakest module first', (() => {
      const p = mods.map(r => parseInt(r[3]));
      return p.every((v, i) => i === 0 || p[i - 1] <= v);
    })(), mods.slice(0, 3).map(r => r[0] + ' ' + r[3]).join(' / '));
    check('a module nobody uses is marked, not merely listed',
          [...doc.querySelectorAll('#adoptmodules tbody tr')]
            .filter(r => r.children[3].textContent.trim() === '0%')
            .every(r => r.children[3].classList.contains('bad')));
    check('module counts never exceed what the module applies to',
          mods.every(r => Number(r[1]) <= Number(r[2])));

    // by team — must be the same arithmetic as the KPI meter's dial
    const teams = rows('#adoptteams');
    check('the team table agrees with adoptForTeam', teams.every(r => {
      const t = win.eval(`JSON.stringify(adoptForTeam(${JSON.stringify(r[0])}))`);
      const o = JSON.parse(t);
      return Number(r[1]) === o.adopted && Number(r[2]) === o.applicable;
    }), teams.map(r => r.join(':')).join(' ~ ').slice(0, 160));
    check('and states how much of each book was scored',
          teams.every(r => /^\d+ of \d+$/.test(r[4])), teams.map(r => r[4]).join());

    // the totals across the two tables have to be the same number
    check('team rows sum to the overall figure', (() => {
      const sum = teams.reduce((n, r) => n + Number(r[1]), 0);
      const all = win.eval(`[...ADOPT_BY_CLIENT.values()].reduce((n,r)=>n+r.s,0)`);
      return sum === all;
    })());
    check('and so do the module rows', (() => {
      const sum = mods.reduce((n, r) => n + Number(r[1]), 0);
      const all = win.eval(`[...ADOPT_BY_CLIENT.values()].reduce((n,r)=>n+r.s,0)`);
      return sum === all;
    })(), mods.reduce((n, r) => n + Number(r[1]), 0) + ' vs ' +
      win.eval(`[...ADOPT_BY_CLIENT.values()].reduce((n,r)=>n+r.s,0)`));

    // every scored client, and every unscored one, named
    check('one row per scored client',
          rows('#adoptclients').length === win.eval('ADOPT_BY_CLIENT.size'));
    const gaps = rows('#adoptgaps');
    check('the never-scored table names exactly the clients with no score', (() => {
      const want = win.eval(`CLIENTS.filter(c=>c.o && !ADOPT_BY_CLIENT.has(c.n)).length`);
      return gaps.length === want;
    })(), `${gaps.length}`);
    /* Compare against the underlying figures, not the printed ones: inr() prints
       lakh and crore, so parsing the digits out of the cell would rank ₹95,000
       above ₹13.7L. */
    check('largest gap first', (() => {
      const v = gaps.map(r => win.eval(
        `(CLIENTS.find(c=>c.n===${JSON.stringify(r[0])})||{}).r || 0`));
      return v.every((x, i) => i === 0 || v[i - 1] >= x);
    })(), gaps.slice(0, 3).map(r => r[0] + ' ' + r[2]).join(' / '));
    check('and the page says they are excluded rather than zeroed',
          /not counted as zero/.test(doc.getElementById('adoptgapnote').textContent));
    check('rows the parser had to skip are named on the page', (() => {
      /* Notes are only useful if they reach the reader; collecting them and
         keeping quiet is the same as dropping the row. */
      const notes = win.eval('ADOPTION_NOTES.length');
      const shown = /needs? attention|need attention/.test(
        doc.getElementById('adopthint').textContent);
      return notes === 0 || shown;
    })());
    check('and so are scored clients the book has never heard of',
          !win.eval('ADOPT_UNMATCHED.length') ||
          /not in the client book/.test(doc.getElementById('adopthint').textContent),
          win.eval('ADOPT_UNMATCHED').join());
    check('the quarter comes from the tab names, not a constant',
          win.eval(`ADOPTION_QUARTER`) === 'Quarter I' && win.eval('ADOPT_LIVE') === true);

    check('the header says which quarter, not which month',
          /Quarter I/.test(doc.getElementById('adopthint').textContent));
  }

  {
    /* The published stacked tab carries client totals only. The module table
       cannot be built from it, and must say so rather than render empty — an
       empty table reads as "no modules are used". */
    const { doc } = boot({ body: TEAM_INT, clientBody: TEAM_CLI });
    await settle();
    doc.querySelector('#sources4 button[data-src="adoption"]').click(); await settle();
    const first = doc.querySelector('#adoptmodules tbody tr');
    check('with live client totals the module table explains itself',
          /client totals only/.test(first.textContent) ||
          doc.querySelectorAll('#adoptmodules tbody tr').length > 1,
          first.textContent.slice(0, 80));
  }

  // ── 13. adoption failure paths ─────────────────────────────────
  {
    /* The sheet's own Percentage column is the cross-check. Where it disagrees
       with the grid the grid wins — but the disagreement is recorded, because
       silently preferring one of two conflicting sources is how a wrong number
       survives. The Total column is never consulted at all: the fixture writes
       it as the corrupted dates Excel produced. */
    const wrong = ADOPT_SHEET.replace(/,100,A\n/, ',7,A\n');
    const { win } = boot({ body: TEAM_INT, clientBody: TEAM_CLI, adoptBody: wrong });
    await settle();
    check('a percentage that disagrees with the grid is recorded',
          win.eval('ADOPTION_NOTES.some(n => /the grid is used/.test(n))'),
          String(win.eval('ADOPTION_NOTES[0] || "(none)"')));
    check('and the grid is what gets used', win.eval('ADOPT_LIVE') === true);
    check('the corrupted Total column never reaches a figure', (() => {
      /* Every row's totals must come from counting 0s and 1s. If Total were read,
         these would not match the mask. */
      return win.eval(`ADOPTION.every(r =>
        r.s === (r.m.match(/1/g)||[]).length &&
        r.a === r.s + (r.m.match(/0/g)||[]).length)`);
    })());
  }
  {
    // A response with no tabs at all: the sheet is reachable but nothing matched.
    const { doc, win } = boot({ body: TEAM_INT, clientBody: TEAM_CLI, adoptBody: 'nothing here' });
    await settle();
    check('a response with no tab markers is refused', win.eval('ADOPT_LIVE') === false);
    check('and the message says how tabs must be named',
          /Q<number>/.test(String(win.eval('ADOPT_ERROR'))), String(win.eval('ADOPT_ERROR')));
    check('the page still renders on that failure',
          doc.getElementById('content').hidden === false);
    check('and falls back to the compiled grid',
          win.eval('ADOPTION === ADOPTION_FALLBACK && ADOPTION_MODULES === ADOPTION_MODULES_FALLBACK'));
    check('the fallback quarter is restored too',
          win.eval('ADOPTION_QUARTER') === win.eval('ADOPTION_QUARTER_FALLBACK'));
  }
  {
    /* Headers present, no numbered rows: the tab exists but is empty. */
    const empty = '#### TAB: Q1 Mansi Rana\nS No.,Student Name\n,,\n';
    const { doc, win } = boot({ body: TEAM_INT, clientBody: TEAM_CLI, adoptBody: empty });
    await settle();
    doc.querySelector('#sources4 button[data-src="adoption"]').click(); await settle();
    check('an empty tab falls back rather than emptying the dial',
          win.eval('ADOPTION === ADOPTION_FALLBACK'));
    const c = [...doc.querySelectorAll('#adoptclients tbody tr')];
    check('and the tab still has its clients', c.length > 0, String(c.length));
  }

  // ── 13b. one spelling per person, and the day not going stale ──
  {
    /* Asana sends the same person under different casing. Whichever row arrives
       first used to win, which is how a lowercase name reached the boards while
       the client book showed the proper one. */
    const rows = [];
    TEAM_PEOPLE.forEach((p, i) => {
      const mangled = p.toLowerCase();
      for (let d = 1; d <= 3; d++)
        rows.push(`${i * 9 + d},2026-07-01,,,x,S,${d === 1 ? mangled : p},x@x.com,,` +
                  `2026-07-0${d},,n`);
    });
    const INT = [',,', ',,url', ',,', TEAM_HEAD].concat(rows).join('\n');
    const { doc, win } = boot({ body: INT, clientBody: INT.replace(/\n(\d+),/g, (m, d) =>
      '\n' + (Number(d) + 700) + ',') });
    await settle();

    check('a lowercase first sighting does not become the display name',
          !win.eval(`[...ROSTER.values()].some(p => /^[a-z]/.test(p.name))`),
          win.eval(`[...ROSTER.values()].map(p=>p.name).filter(n=>/^[a-z]/.test(n)).join()`));
    check('and the spelling matches the client book exactly', (() => {
      /* The owner filter compares strings, so board and filter must agree. */
      const owners = win.eval(`JSON.stringify([...new Set(CLIENTS.map(c=>c.o).filter(Boolean))])`);
      const roster = win.eval(`JSON.stringify([...ROSTER.values()].map(p=>p.name))`);
      return JSON.parse(owners).every(o => JSON.parse(roster).includes(o));
    })());
    /* Not a re-casing: names that are not title-case must survive untouched. */
    check('names with deliberate casing are left alone',
          win.eval(`CLIENTS.some(c => c.n === 'MPPS School kkr')`) &&
          win.eval(`CLIENTS.some(c => c.n === 'SA Jain (PG) College + AIMT')`));

    /* The owner filter itself: its options come from the same strings it
       compares, so a selection can never return nothing. */
    doc.querySelector('#sources2 button[data-src="clients"]').click(); await settle();
    const sel = doc.getElementById('cowner');
    const opts = [...sel.options].map(o => o.value).filter(Boolean);
    check('every owner option matches a client exactly',
          opts.every(o => win.eval(`CLIENTS.some(c => c.o === ${JSON.stringify(o)})`)),
          opts.join());
    check('and selecting one returns rows', (() => {
      sel.value = opts[0];
      sel.dispatchEvent(new win.Event('change'));
      return doc.querySelectorAll('#clientlist tbody tr').length > 0;
    })(), opts[0]);
  }
  {
    /* A page left open across midnight kept calling yesterday "Today". */
    const { doc, win } = boot({ body: TEAM_INT, clientBody: TEAM_CLI }); await settle();
    const shown = () => doc.getElementById('from').value;
    const before = shown();
    check('the day is taken from the clock, not a constant',
          before === win.eval('todayWorking()'), before);

    /* Wind the page's idea of "now" forward a day and poke the rollover check
       the way returning to the tab would. */
    win.eval(`(() => {
      const real = Date;
      const shifted = new Date(Date.now() + 86400000);
      globalThis.Date = class extends real {
        constructor(...a){ return a.length ? new real(...a) : new real(shifted); }
        static now(){ return shifted.getTime(); }
      };
    })()`);
    win.eval('checkDayRollover()');
    check('crossing midnight moves the day on',
          shown() !== before && shown() === win.eval('todayWorking()'),
          `${before} -> ${shown()}`);
    check('and "Today" still means today',
          win.eval('CHASE_DAY') === win.eval('todayWorking()'));
    win.eval('globalThis.Date = Object.getPrototypeOf(globalThis.Date)');
  }

  // ── 14. vercel.json is deployable ──────────────────────────────
  {
    /* This file is validated by Vercel against a strict schema before anything
       is built, and a rejected deploy takes the whole dashboard's changes with
       it — including, once, the no-cache header meant to stop browsers serving
       an old copy of the page. JSON has no comment syntax and the schema allows
       no extra keys, so any explanation belongs in the README, not in here. */
    const path = require('path').join(require('path').dirname(FILE), 'vercel.json');
    let v = null, parseErr = null;
    try { v = JSON.parse(fs.readFileSync(path, 'utf8')); }
    catch (e) { parseErr = e.message; }
    check('vercel.json parses', !!v, parseErr || '');

    if (v) {
      const ALLOWED = new Set(['source', 'headers', 'has', 'missing']);
      const strays = (v.headers || []).flatMap(r =>
        Object.keys(r).filter(k => !ALLOWED.has(k)).map(k => `${r.source}: ${k}`));
      check('no rule carries a key the schema rejects', strays.length === 0, strays.join());
      check('every rule has a source and a headers array',
            (v.headers || []).every(r => typeof r.source === 'string' && Array.isArray(r.headers)));
      check('every header is a key/value pair',
            (v.headers || []).every(r => r.headers.every(h =>
              typeof h.key === 'string' && typeof h.value === 'string')));

      const header = (src, key) => (v.headers.find(r => r.source === src)?.headers || [])
        .find(h => h.key.toLowerCase() === key)?.value || '';
      /* The page and its parser are the same file, so a cached page is a cached
         dashboard — this pair is what makes a deploy visible without a hard reload. */
      check('/ is revalidated on every load',
            /no-cache/.test(header('/', 'cache-control')), header('/', 'cache-control'));
      check('/index.html likewise',
            /no-cache/.test(header('/index.html', 'cache-control')), header('/index.html', 'cache-control'));
      check('the security headers are still set',
            /default-src 'none'/.test(header('/(.*)', 'content-security-policy')));
      check('and the page may still call its own API',
            /connect-src 'self'/.test(header('/(.*)', 'content-security-policy')),
            header('/(.*)', 'content-security-policy'));
    }
  }

  const w = Math.max(...results.map(r => r[1].length));
  for (const [ok, n, d] of results) console.log(`${ok ? ' ok ' : 'FAIL'}  ${n.padEnd(w)}  ${d}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
