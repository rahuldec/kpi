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

function boot({ body = SHEET, clientBody = CLIENT_DEFAULT, status = 200, reject = false } = {}) {
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
      window.fetch = (url) => {
        calls.push(url);
        if (reject) return Promise.reject(new Error('Failed to fetch'));
        const isClient = /src=client/.test(url);
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          text: () => Promise.resolve(isClient ? clientBody : body)
        });
      };
    }
  });
  dom.virtualConsole.on('jsdomError', e => errs.push(e.message));
  return { dom, doc: dom.window.document, win: dom.window, errs, calls };
}

const settle = () => new Promise(r => setTimeout(r, 30));
const txt = (doc, s) => (doc.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
const figs = doc => [...doc.querySelectorAll('#kpis .fig')].map(e => e.textContent.replace(/\s+/g, ''));
const pad = n => String(n).padStart(2, '0');
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

(async () => {

  // ── 1. no data is embedded any more ────────────────────────────
  {
    check('no employee names in the shipped file', !/Sukhmeet|Divya Gupta|Mansi Rana/.test(HTML),
          'found hardcoded names');
    check('no SAMPLE dataset constant', !/const SAMPLE/.test(HTML));
    check('fetches from /api/data with a source', /fetch\(`\/api\/data\?src=/.test(HTML));
    check('both sheet sources declared', /internal:/.test(HTML) && /client:/.test(HTML));
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
          doc.getElementById('month').value === isoLocal(new Date()).slice(0,7),
          doc.getElementById('month').value);
    check('headline changes for the scorecard', /Missed days/.test(txt(doc, '#h1')), txt(doc, '#h1'));

    const rows = [...doc.querySelectorAll('#score tbody tr')];
    check('one row per person on the roster', rows.length === 3, rows.length + ' rows');
    check('columns: internal, client, total', doc.querySelectorAll('#score thead th').length === 6,
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
    doc.getElementById('month').value = '2026-07';
    doc.getElementById('month').dispatchEvent(new (win.Event)('change'));
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
    // a month that starts before the data begins must be flagged, not scored silently
    const { doc } = boot(); await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    doc.getElementById('month').value = '2026-01';
    doc.getElementById('month').dispatchEvent(new (doc.defaultView.Event)('change'));
    check('month outside the data is flagged',
          /outside the data/i.test(txt(doc, '#coverwarn')), txt(doc, '#coverwarn'));
    check('warning names how far back the data reaches',
          /Jul/.test(txt(doc, '#coverwarn')), txt(doc, '#coverwarn'));
  }
  {
    // a fully covered month gets no warning
    const { doc } = boot(); await settle();
    doc.querySelector('#sources button[data-src="scorecard"]').click(); await settle();
    doc.getElementById('month').value = '2026-08';
    doc.getElementById('month').dispatchEvent(new (doc.defaultView.Event)('change'));
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
    doc.getElementById('month').value = '2026-07';
    doc.getElementById('month').dispatchEvent(new (doc.defaultView.Event)('change'));
    check('capped sheet alone raises no warning', txt(doc, '#coverwarn') === '',
          txt(doc, '#coverwarn'));
    doc.getElementById('month').value = '2026-01';
    doc.getElementById('month').dispatchEvent(new (doc.defaultView.Event)('change'));
    check('capped sheet still flags a month outside the data',
          /outside the data/i.test(txt(doc, '#coverwarn')), txt(doc, '#coverwarn'));
    check('that warning says the export limit is why',
          /export limit/i.test(txt(doc, '#coverwarn')), txt(doc, '#coverwarn'));
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
    check('called the data endpoint for both sheets', calls.length === 2 &&
          calls.every(u => /^\/api\/data\?src=/.test(u)), calls.join());
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
    check('refresh refetches both sheets', calls.length === 4, calls.length + ' calls');
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

  const w = Math.max(...results.map(r => r[1].length));
  for (const [ok, n, d] of results) console.log(`${ok ? ' ok ' : 'FAIL'}  ${n.padEnd(w)}  ${d}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
