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

function boot({ body = SHEET, status = 200, reject = false } = {}) {
  const errs = [], calls = [];
  // beforeParse installs the mock before the page's own <script> runs, so the
  // script executes normally and its top-level bindings stay reachable via eval.
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url) => {
        calls.push(url);
        if (reject) return Promise.reject(new Error('Failed to fetch'));
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          text: () => Promise.resolve(body)
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
    check('fetches from /api/data', /DATA_URL\s*=\s*'\/api\/data'/.test(HTML));
  }

  // ── 2. happy path ──────────────────────────────────────────────
  {
    const { doc, errs, calls } = boot(); await settle();
    check('boots with no JS errors', errs.length === 0, errs.join(' | '));
    check('called the data endpoint', calls.length === 1 && /^\/api\/data\?/.test(calls[0]), calls.join());
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

  // ── 4. date range: defaults to today, widens but never narrows ──
  {
    const { doc } = boot(); await settle();
    check('To defaults to today or later', doc.getElementById('to').value >= isoLocal(new Date()),
          doc.getElementById('to').value);
    check('From widened back to earliest data', doc.getElementById('from').value <= '2026-07-27',
          doc.getElementById('from').value);
    check('no hardcoded date in markup', !/id="(to|from)" value=/.test(HTML));
  }
  {
    // a single-day sheet must not collapse the window
    const oneDay = SHEET.split('\n').slice(0, 5).join('\n') + '\nand a newline"';
    const { doc } = boot({ body: oneDay }); await settle();
    const span = (new Date(doc.getElementById('to').value) - new Date(doc.getElementById('from').value)) / 86400000;
    check('one-day sheet does not narrow the range', span >= 15, span + ' days');
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
    check('refresh triggers a second fetch', calls.length === 2, calls.length + ' calls');
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
    const mid = figs(doc).join();
    doc.getElementById('joined').checked = false;
    doc.getElementById('joined').dispatchEvent(new win.Event('change'));
    check('joined toggle re-renders', figs(doc).join() !== mid);
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
