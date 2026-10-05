// Dynamic leave data from a Google Sheet.
// Returns { "Employee Name": ["YYYY-MM-DD", ...] } — the same shape as
// LEAVE_RAW in index.html, which the page merges into LEAVE_DAYS at load time
// so both the compiled snapshot and the live Sheet rows are always honoured.
//
// Sheet structure (two columns, no extras):
//   Date       | Name
//   2026-10-05 | Ayush Garg
//   2026-10-05 | Aanchal Dhiman
//
// Setup:
//   1. Create a Google Sheet with the headers above.
//   2. File → Share → Publish to web → Sheet1 → CSV → Publish.
//   3. Copy the published URL and set LEAVES_CSV_URL in
//      Vercel → Settings → Environment Variables, then redeploy.
//   4. See scripts/leaves-apps-script.js for the Apps Script that
//      auto-populates new rows from the daily Drive PDF each morning.
//
// Cancelled leaves are excluded by the Apps Script before writing; Pending and
// Approved both count — if an employee filed a leave request for a day, their
// timesheet is not expected on that day.
//
// Falls back to an empty object on any error — the page degrades to the
// hardcoded LEAVE_RAW snapshot in index.html.

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');

  const url = process.env.LEAVES_CSV_URL;
  if (!url) return res.status(200).json({});

  try {
    const r = await fetch(`${url}&t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Sheet answered ${r.status}`);
    const csv = await r.text();

    const leaveMap = {};
    const lines = csv.split('\n');
    for (let i = 1; i < lines.length; i++) {   // skip header row
      const line = lines[i].trim();
      if (!line) continue;
      const fields = parseCSVLine(line);
      const date = (fields[0] || '').trim();
      const name = (fields[1] || '').trim();
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!leaveMap[name]) leaveMap[name] = [];
      if (!leaveMap[name].includes(date)) leaveMap[name].push(date);
    }

    return res.status(200).json(leaveMap);
  } catch (e) {
    console.error('leaves endpoint error:', e.message);
    return res.status(200).json({});
  }
};

function parseCSVLine(line) {
  const fields = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}
