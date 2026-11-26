// Fetches and parses the ERP Training Google Sheet.
//
// Sheet format: "Sr No, Module, Days, Sub Parts, Link, Assignment"
// A row with a Module value starts a new module. Rows with Sub Parts are lessons.
// Lessons are "video" (has Link), "assignment" (sub part = "assignment"), or "review".
//
// Set TRAINING_SHEET_URL in Vercel env vars to a Google Sheets gviz CSV link:
//   Share the sheet -> Share -> General access -> Anyone with the link -> Viewer
//   Then: https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&sheet=<Tab>

export default async function handler(req, res) {
  const url = process.env.TRAINING_SHEET_URL;
  if (!url) {
    return res.status(200).json({ modules: [], note: 'TRAINING_SHEET_URL not set' });
  }

  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Sheet returned ${r.status}`);
    const csv = await r.text();
    const modules = parseModulesCsv(csv);
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    return res.status(200).json({ modules });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
}

function parseModulesCsv(csv) {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];

  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = k => header.indexOf(k);
  const iMod    = col('module');
  const iSub    = col('sub parts');
  const iLink   = col('link');
  const iAssign = col('assignment');
  if (iMod < 0) return [];

  const modules = [];
  let curMod = null;

  for (let i = 1; i < rows.length; i++) {
    const row     = rows[i];
    const modName = row[iMod]?.trim();
    const subPart = iSub    >= 0 ? row[iSub]?.trim()    : '';
    const link    = iLink   >= 0 ? row[iLink]?.trim()   : '';
    const assign  = iAssign >= 0 ? row[iAssign]?.trim() : '';

    if (modName) {
      curMod = { id: slugify(modName), title: modName, lessons: [] };
      modules.push(curMod);
    }
    if (!curMod || !subPart) continue;

    const subLower = subPart.toLowerCase();
    const kind = subLower === 'assignment' ? 'assignment'
               : subLower === 'review'     ? 'review'
               : (assign && !link)          ? 'assignment'
               : 'video';

    curMod.lessons.push({
      id:        `${curMod.id}__${slugify(subPart)}`,
      title:     subPart,
      kind,
      videoUrl:  kind === 'video'       ? drivePreviewUrl(link) : null,
      assignUrl: kind === 'assignment'  ? (link || assign)      : null,
    });
  }

  return modules.filter(m => m.lessons.length > 0);
}

function drivePreviewUrl(url) {
  if (!url) return null;
  const m = url.match(/\/file\/d\/([^/?#]+)/) || url.match(/[?&]id=([^&]+)/);
  if (!m) return url; // return as-is if not a Drive link
  return `https://drive.google.com/file/d/${m[1]}/preview`;
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else {
        field += c;
      }
    } else {
      if      (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim()));
}
