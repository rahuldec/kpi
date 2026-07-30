const fs = require('fs');
const { JSDOM } = require('jsdom');

const FILE = process.argv[2] || '/home/claude/work.html';
const HTML = fs.readFileSync(FILE, 'utf8');
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
  return { dom, doc: dom.window.document, win: dom.window, errs };
}
const txt = (doc, sel) => (doc.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
const figs = doc => [...doc.querySelectorAll('#kpis .fig')].map(e => e.textContent.replace(/\s+/g, ''));
const pad = n => String(n).padStart(2, '0');
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ── 1. boots clean, renders every section ────────────────────────
{
  const { doc, errs } = boot();
  check('boots with no JS errors', errs.length === 0, errs.join(' | '));
  check('KPI block rendered', doc.querySelectorAll('#kpis .kpi').length === 4);
  check('grid has rows', doc.querySelectorAll('#grid tbody tr').length > 0);
  check('board has rows', doc.querySelectorAll('#board tbody tr').length > 0);
  check('turnout strip rendered', doc.querySelectorAll('#strip div').length > 0);
  check('chase block rendered', txt(doc, '#chase .when').length > 0);
}

// ── 2. the paste panel is genuinely gone ─────────────────────────
{
  const { doc } = boot();
  check('no panel element', !doc.getElementById('panel'));
  check('no textarea anywhere', doc.querySelectorAll('textarea').length === 0);
  check('no buttons left', doc.querySelectorAll('button').length === 0,
        doc.querySelectorAll('button').length + ' remain');
  // visible text only — textContent would otherwise include <script> bodies
  const visible = [...doc.body.querySelectorAll('*')]
    .filter(e => !['SCRIPT', 'STYLE'].includes(e.tagName))
    .map(e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' '))
    .join(' ');
  check('no export copy left in visible text',
        !/Asana export|fresh export|sample data|Rebuild/i.test(visible),
        (visible.match(/Asana export|fresh export|sample data|Rebuild/ig) || []).join(','));
  check('no dead panel CSS', !/\.panel\s*\{/.test(HTML));
  check('no dead parser code', !/parseExport|splitRows/.test(HTML));
}

// ── 3. dates default to today, off the local clock ───────────────
{
  const { doc } = boot();
  const today = isoLocal(new Date());
  const expFrom = isoLocal(new Date(Date.now() - 15 * 86400000));
  check('To defaults to today', doc.getElementById('to').value === today,
        `${doc.getElementById('to').value} vs ${today}`);
  check('From defaults to 15 days back', doc.getElementById('from').value === expFrom,
        `${doc.getElementById('from').value} vs ${expFrom}`);
  check('no hardcoded date in the markup', !/id="(to|from)" value=/.test(HTML));
}

// ── 4. the three ways of counting misses must agree ──────────────
{
  const { doc } = boot();
  const f = figs(doc);
  check('4 KPI figures present', f.length === 4, JSON.stringify(f));
  check('missed is a plain integer', /^\d+$/.test(f[0]), f[0]);
  check('coverage is a percentage', /^\d+%$/.test(f[1]), f[1]);

  const rowTotals = [...doc.querySelectorAll('#grid td.tot')].reduce((s, e) => s + Number(e.textContent), 0);
  check('headline == sum of grid row totals', Number(f[0]) === rowTotals, `${f[0]} vs ${rowTotals}`);

  const redCells = doc.querySelectorAll('#grid .cell.m').length;
  check('headline == red cell count', Number(f[0]) === redCells, `${f[0]} vs ${redCells}`);

  const boardMissed = [...doc.querySelectorAll('#board tbody tr')]
    .reduce((s, r) => s + Number(r.children[2].textContent), 0);
  check('headline == board missed column', Number(f[0]) === boardMissed, `${f[0]} vs ${boardMissed}`);

  check('grid and board cover the same people',
        doc.querySelectorAll('#grid tbody tr').length === doc.querySelectorAll('#board tbody tr').length);
}

// ── 5. chase list is self-consistent ─────────────────────────────
{
  const { doc } = boot();
  const names = [...doc.querySelectorAll('#chase .names a')].map(a => a.childNodes[0].textContent);
  const n = txt(doc, '#chase .n');
  if (n) check('chase count matches chase names', Number(n) === names.length, `${n} vs ${names.length}`);
  else check('all-clear shown when nobody outstanding', /Everyone filed/.test(txt(doc, '#chase')));
}

// ── 6. controls still work ───────────────────────────────────────
{
  const { doc, win } = boot();
  const before = figs(doc).join();
  doc.getElementById('from').value = '2026-07-01';
  doc.getElementById('from').dispatchEvent(new win.Event('change'));
  check('changing From re-renders', figs(doc).join() !== before);

  const mid = figs(doc).join();
  doc.getElementById('joined').checked = false;
  doc.getElementById('joined').dispatchEvent(new win.Event('change'));
  check('joined toggle re-renders', figs(doc).join() !== mid);
}

// ── 7. degenerate ranges must not throw ──────────────────────────
{
  const cases = [
    ['from after to',      '2026-07-30', '2026-07-01'],
    ['single working day', '2026-07-15', '2026-07-15'],
    ['a lone Sunday',      '2026-07-19', '2026-07-19'],
    ['range after data',   '2027-01-01', '2027-01-31'],
    ['range before data',  '2020-01-01', '2020-01-31'],
  ];
  for (const [label, f, t] of cases) {
    const { doc, win, errs } = boot();
    doc.getElementById('from').value = f;
    doc.getElementById('to').value = t;
    doc.getElementById('to').dispatchEvent(new win.Event('change'));
    check(`no crash: ${label}`, errs.length === 0, errs.join(' | '));
  }
}

// ── 8. date maths is timezone-independent ────────────────────────
{
  const { win } = boot();
  const rt = win.eval("iso(D('2026-07-14'))");
  check('iso() round-trips in this TZ', rt === '2026-07-14', `TZ=${process.env.TZ || 'UTC'} gave ${rt}`);

  const days = win.eval("JSON.stringify(range('2026-07-17','2026-07-21',true))");
  check('Sundays excluded from working days',
        days === '["2026-07-17","2026-07-18","2026-07-20","2026-07-21"]', days);

  const fixed = win.eval(`
    document.getElementById('from').value='2026-07-15';
    document.getElementById('to').value='2026-07-30';
    render();
    [...document.querySelectorAll('#kpis .fig')].map(e=>e.textContent.replace(/\\s+/g,'')).join('|');
  `);
  check('fixed range gives identical figures in every TZ', fixed === '112|49%|2/20|12',
        `TZ=${process.env.TZ || 'UTC'} gave ${fixed}`);
}

// ── 9. embedded data renders as text, not markup ─────────────────
{
  const { doc } = boot();
  check('no stray elements from data',
        doc.querySelectorAll('#board img, #grid img, #chase img, #board script').length === 0);
  check('names render as text', /Divya Gupta/.test(doc.querySelector('#board').textContent));
}

const w = Math.max(...results.map(r => r[1].length));
for (const [s, n, d] of results) console.log(`${s === 'PASS' ? ' ok ' : 'FAIL'}  ${n.padEnd(w)}  ${d}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
