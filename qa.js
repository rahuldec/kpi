const fs = require('fs');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync('/home/claude/missed-entries.html', 'utf8');
let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { pass++; results.push(['PASS', name, '']); }
  else { fail++; results.push(['FAIL', name, detail || '']); }
}

function boot() {
  const errs = [];
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.virtualConsole.on('jsdomError', e => errs.push(e.message));
  dom.window.onerror = (m) => errs.push(String(m));
  return { dom, doc: dom.window.document, win: dom.window, errs };
}

const txt = (doc, sel) => (doc.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();

// ── 1. boots clean ───────────────────────────────────────────────
{
  const { doc, errs } = boot();
  check('boots with no JS errors', errs.length === 0, errs.join(' | '));
  check('KPI block rendered', doc.querySelectorAll('#kpis .kpi').length === 4);
  check('grid has rows', doc.querySelectorAll('#grid tbody tr').length > 0);
  check('board has rows', doc.querySelectorAll('#board tbody tr').length > 0);
  check('turnout strip rendered', doc.querySelectorAll('#strip div').length > 0);
}

// ── 2. figures match independent calculation ─────────────────────
// From the Python cross-check: 113 missed / 225 expected / 50% / 2 clean / streak 12
{
  const { doc } = boot();
  const figs = [...doc.querySelectorAll('#kpis .fig')].map(e => e.textContent.replace(/\s+/g, ''));
  check('missed count = 113', figs[0] === '113', 'got ' + figs[0]);
  check('coverage = 50%', figs[1] === '50%', 'got ' + figs[1]);
  check('clean filers = 2/20', figs[2] === '2/20', 'got ' + figs[2]);
  check('longest streak = 12', figs[3] === '12', 'got ' + figs[3]);

  const rows = doc.querySelectorAll('#grid tbody tr').length;
  check('grid row count = 20 people', rows === 20, 'got ' + rows);

  // sum of the per-row "Missed" totals must equal the headline number
  const sum = [...doc.querySelectorAll('#grid td.tot')]
    .reduce((s, e) => s + Number(e.textContent), 0);
  check('grid row totals sum to 113', sum === 113, 'got ' + sum);

  // red cells in the grid must equal the same number
  const red = doc.querySelectorAll('#grid .cell.m').length;
  check('red cells = 113', red === 113, 'got ' + red);
  const grey = doc.querySelectorAll('#grid .cell.f').length;
  check('grey cells = 112 filed', grey === 112, 'got ' + grey);
}

// ── 3. chase list ────────────────────────────────────────────────
{
  const { doc } = boot();
  const names = [...doc.querySelectorAll('#chase .names a')].map(a => a.childNodes[0].textContent);
  const expected = ['Aman Sharma','Amar Kumar Pandit','Ankush Rana','Gobind Monga','Kashish Goel',
    'Lokesh Kumar','Mansi Rana','Mehak Garg','Palak Singh','Priya','Sagar Mishra','Sapna',
    'Sukhmeet Singh','Sultan Malik','Tinku Singh'];
  check('chase list = 15 names', names.length === 15, 'got ' + names.length);
  check('chase names match', JSON.stringify([...names].sort()) === JSON.stringify(expected.sort()),
        names.join(','));
  check('chase headline count = 15', txt(doc, '#chase .n') === '15', txt(doc, '#chase .n'));
}

// ── 4. controls actually re-render ───────────────────────────────
{
  const { doc, win } = boot();
  const before = txt(doc, '#kpis .fig');
  doc.getElementById('to').value = '2026-07-20';
  doc.getElementById('to').dispatchEvent(new win.Event('change'));
  const after = txt(doc, '#kpis .fig');
  check('changing date range re-renders', before !== after, `${before} -> ${after}`);

  doc.getElementById('joined').checked = false;
  doc.getElementById('joined').dispatchEvent(new win.Event('change'));
  const off = txt(doc, '#kpis .fig');
  check('joined toggle changes result', off !== after, `${after} -> ${off}`);
}

// ── 5. degenerate ranges must not throw or lie ───────────────────
{
  const cases = [
    ['from after to',       '2026-07-30', '2026-07-01'],
    ['single working day',  '2026-07-15', '2026-07-15'],
    ['a lone Sunday',       '2026-07-19', '2026-07-19'],
    ['range with no data',  '2026-09-01', '2026-09-30'],
  ];
  for (const [label, f, t] of cases) {
    const { doc, win, errs } = boot();
    doc.getElementById('from').value = f;
    doc.getElementById('to').value = t;
    doc.getElementById('to').dispatchEvent(new win.Event('change'));
    check(`no crash: ${label}`, errs.length === 0, errs.join(' | '));
  }
}

// ── 6. CSV / TSV parsing of a realistic Asana export ─────────────
{
  const csv = [
    'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes',
    '"121,700","2026-07-30",,,"a@x.com, Jul 30",Section,"Divya Gupta",divya@x.com,,2026-07-30,,"Notes with a comma, and',
    'an embedded newline"',
    '121701,2026-07-30,,,b,Section,,vansh.saini@x.com,,2026-07-29,,plain',
    '121702,2026-07-30,,,c,Section,"O\'Brien, Sam",sam@x.com,,2026-07-29,,plain',
  ].join('\n');

  const { doc, win, errs } = boot();
  doc.getElementById('paste').value = csv;
  doc.getElementById('load').click();
  check('CSV: no crash', errs.length === 0, errs.join(' | '));
  check('CSV: 3 entries loaded', /3 entries loaded/.test(txt(doc, '#status')), txt(doc, '#status'));
  const people = [...doc.querySelectorAll('#board tbody td:first-child')].map(e => e.textContent);
  check('CSV: quoted field with comma+newline survives', people.includes('Divya Gupta'), people.join('|'));
  check('CSV: apostrophe name kept verbatim', people.includes("O'Brien, Sam"), people.join('|'));
  check('CSV: blank assignee falls back to email', people.includes('Vansh Saini'), people.join('|'));
  check('CSV: date range auto-set', doc.getElementById('from').value === '2026-07-29', doc.getElementById('from').value);
}
{
  const tsv = [
    ['Task ID','Created At','Name','Assignee','Assignee Email','Due Date'].join('\t'),
    ['1','2026-07-30','x','Mansi Rana','m@x.com','2026-07-30'].join('\t'),
    ['2','2026-07-30','y','Mansi Rana','m@x.com','2026-07-29'].join('\t'),
  ].join('\n');
  const { doc, errs } = boot();
  doc.getElementById('paste').value = tsv;
  doc.getElementById('load').click();
  check('TSV: parsed', /2 entries loaded/.test(txt(doc, '#status')), txt(doc, '#status'));
  check('TSV: no crash', errs.length === 0, errs.join(' | '));
}

// ── 7. bad input is reported, not swallowed ──────────────────────
{
  const { doc } = boot();
  doc.getElementById('load').click();
  check('empty paste warns', /Nothing pasted/.test(txt(doc, '#status')), txt(doc, '#status'));
}
{
  const { doc } = boot();
  doc.getElementById('paste').value = 'total,nonsense\n1,2';
  doc.getElementById('load').click();
  check('junk paste warns', /No header row/.test(txt(doc, '#status')), txt(doc, '#status'));
  check('junk paste keeps old data', doc.querySelectorAll('#grid tbody tr').length === 20);
}

// ── 8. reset restores sample ─────────────────────────────────────
{
  const { doc } = boot();
  doc.getElementById('paste').value = 'Created At,Assignee,Due Date\n2026-07-30,Solo Person,2026-07-30';
  doc.getElementById('load').click();
  const one = doc.querySelectorAll('#board tbody tr').length;
  doc.getElementById('reset').click();
  const back = doc.querySelectorAll('#board tbody tr').length;
  check('reset restores 20 people', one === 1 && back === 20, `${one} -> ${back}`);
}

// ── 9. injection: a name containing HTML must not become markup ──
{
  const { doc } = boot();
  doc.getElementById('paste').value =
    'Created At,Assignee,Due Date\n2026-07-30,"<img src=x onerror=alert(1)>",2026-07-30';
  doc.getElementById('load').click();
  const injected = doc.querySelectorAll('#board img, #grid img, #chase img').length;
  check('pasted name cannot inject an element', injected === 0, injected + ' img elements created');
}

// ── 9b. same person, inconsistent capitalisation, must merge ────
{
  const { doc } = boot();
  doc.getElementById('paste').value =
    'Created At,Assignee,Due Date\n2026-07-29,Priya,2026-07-29\n2026-07-30,priya,2026-07-30';
  doc.getElementById('load').click();
  check('case-variant names merge to one person',
        doc.querySelectorAll('#board tbody tr').length === 1,
        doc.querySelectorAll('#board tbody tr').length + ' rows');
}

// ── 10. timezone: exercise the app's own date functions ───────
{
  const { doc, win } = boot();
  const rt = win.eval("iso(D('2026-07-14'))");
  check('app iso() round-trips in this TZ', rt === '2026-07-14', `TZ=${process.env.TZ||'UTC'} gave ${rt}`);

  const days = win.eval("JSON.stringify(range('2026-07-17','2026-07-21',true))");
  check('working days skip Sunday correctly',
        days === '["2026-07-17","2026-07-18","2026-07-20","2026-07-21"]', days);

  const nd = win.eval("JSON.stringify([normDate('2026-07-14'),normDate('7/14/2026'),normDate('Jul 14, 2026')])");
  check('date parsing agrees across formats',
        nd === '["2026-07-14","2026-07-14","2026-07-14"]', nd);

  // the headline figure must be identical regardless of the viewer's clock
  check('missed count is TZ-independent (113)', txt(doc, '#kpis .fig') === '113', txt(doc, '#kpis .fig'));
}

// ── report ───────────────────────────────────────────────────────
const w = Math.max(...results.map(r => r[1].length));
for (const [s, n, d] of results) {
  console.log(`${s === 'PASS' ? ' ok ' : 'FAIL'}  ${n.padEnd(w)}  ${d}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
