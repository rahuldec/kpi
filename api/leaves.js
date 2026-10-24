// Reads leave data from the daily Drive PDFs using a plain Google API key.
// The Drive folder must be shared "Anyone with the link can view" (already done).
//
// SETUP (one-time — much simpler than the old service-account approach):
//   1. Google Cloud Console → APIs & Services → Library → enable "Google Drive API".
//   2. APIs & Services → Credentials → Create credentials → API key.
//      (Optionally restrict it to Google Drive API.)
//   3. Add GOOGLE_API_KEY=<the key string> to Vercel → Settings → Environment Variables.
//   That's it — no JSON file, no service account, no Drive folder re-sharing needed.
//
// On each (4-hour-cached) call:
//   • Lists all PDFs in GOOGLE_DRIVE_FOLDER_ID using the Drive v3 API + API key.
//   • Downloads each PDF binary and extracts text via a built-in PDF parser.
//   • Parses employee names and dates from the "Day Report" format Zoho exports.
//   • Returns { "Employee Name": ["YYYY-MM-DD", ...] } — same shape as LEAVE_RAW,
//     merged into LEAVE_DAYS by both digest endpoints at send time.
//
// Falls back to {} on any error so digests degrade gracefully to LEAVE_RAW only.

const zlib = require('zlib');

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '15WPsMyE1FoP-yXc5xvbiXgAC7rDbZ4Xb';

// Module-level cache — survives warm Vercel invocations.
let _cache = null;
let _cacheExpiry = 0;

// ---- Drive API (API-key auth, works for publicly-shared folders) -------------

function apiKey() {
  const k = process.env.GOOGLE_API_KEY || '';
  if (!k) throw new Error('GOOGLE_API_KEY is not set');
  return encodeURIComponent(k);
}

async function driveList() {
  const q = encodeURIComponent(`'${FOLDER_ID}' in parents and mimeType='application/pdf' and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=400&key=${apiKey()}`;
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Drive list: ${r.status} ${body.slice(0, 200)}`);
  }
  const { files } = await r.json();
  return files || [];
}

async function driveDownload(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Drive download ${fileId}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---- Minimal PDF text extraction (handles both ASCII and CID-encoded PDFs) --

function extractPdfText(buf) {
  const raw = buf.toString('binary');

  // Build a combined CID→Unicode map from all ToUnicode CMap streams.
  // wkhtmltopdf-generated PDFs use CID fonts where each glyph is addressed
  // by a 2-byte CID index (<hex4>Tj) rather than a plain ASCII string.
  const cidMap = new Map();
  const cmapRe = /begincmap([\s\S]*?)endcmap/g;
  let cm;
  while ((cm = cmapRe.exec(raw)) !== null) {
    const block = cm[1];
    // bfrange with array: <startCID> <endCID> [<u1> <u2> …]
    const rangeArrRe = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+\[([^\]]+)\]/g;
    let rm;
    while ((rm = rangeArrRe.exec(block)) !== null) {
      const start = parseInt(rm[1], 16);
      const unis = [...rm[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map(x => x[1]);
      unis.forEach((h, i) => cidMap.set(start + i, String.fromCodePoint(parseInt(h, 16))));
    }
    // bfchar: <CID> <Unicode>
    const bfcharRe = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g;
    let bm;
    while ((bm = bfcharRe.exec(block)) !== null) {
      const cid = parseInt(bm[1], 16);
      if (!cidMap.has(cid)) cidMap.set(cid, String.fromCodePoint(parseInt(bm[2], 16)));
    }
  }

  const decodeHex = hex => {
    let s = '';
    for (let i = 0; i < hex.length; i += 4)
      s += cidMap.get(parseInt(hex.slice(i, i + 4), 16)) || '';
    return s;
  };

  const parts = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let sm;
  while ((sm = streamRe.exec(raw)) !== null) {
    let data = Buffer.from(sm[1], 'binary');
    try { data = zlib.inflateSync(data); } catch (_) {}
    const content = data.toString('latin1');

    // CID-encoded: <hex4…>Tj
    const hexTjRe = /<([0-9A-Fa-f]{4,})>\s*Tj/g;
    let hm;
    while ((hm = hexTjRe.exec(content)) !== null) {
      const t = decodeHex(hm[1]);
      if (t) parts.push(t);
    }
    // Plain ASCII: (string)Tj and [(string)]TJ
    const tjRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
    let tm;
    while ((tm = tjRe.exec(content)) !== null) parts.push(unescapePdf(tm[1]));
    const tjARe = /\[([^\]]*)\]\s*TJ/g;
    while ((tm = tjARe.exec(content)) !== null) {
      const inner = tm[1];
      const sRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let pm;
      while ((pm = sRe.exec(inner)) !== null) parts.push(unescapePdf(pm[1]));
    }
  }

  return parts.join('');
}

function unescapePdf(s) {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
}

// ---- Zoho "Day Report" PDF parser -------------------------------------------

function parseLeavePDF(text) {
  // The date appears as YYYY-MM-DD somewhere near the top of the joined text.
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) return [];
  const date = dateMatch[1];

  const entries = [];
  // In CID-decoded text, rows are delimited by "OD<digits>" employee IDs.
  // Each segment contains: <name><email@okiedokiepay.com><leave details><status>
  const segments = text.split(/OD\d+/);
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const emailMatch = seg.match(/([\w.+-]+@okiedokiepay\.com)/);
    if (!emailMatch) continue;
    // Name is everything before the email (trim leading/trailing spaces).
    const name = seg.slice(0, emailMatch.index).trim();
    // After the email, check for Cancelled status.
    const after = seg.slice(emailMatch.index + emailMatch[0].length);
    if (/Cancelled/i.test(after)) continue;
    if (name) entries.push({ name, date });
  }

  return entries;
}

// ---- Main handler -----------------------------------------------------------

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');

  if (_cache && Date.now() < _cacheExpiry) return res.status(200).json(_cache);

  try {
    const files = await driveList();

    const leaveMap = {};

    for (const file of files) {
      let buf;
      try { buf = await driveDownload(file.id); }
      catch (e) { console.error(`leaves: download ${file.id}: ${e.message}`); continue; }

      let text;
      try { text = extractPdfText(buf); }
      catch (e) { console.error(`leaves: parse ${file.id}: ${e.message}`); continue; }

      for (const { name, date } of parseLeavePDF(text)) {
        if (!leaveMap[name]) leaveMap[name] = [];
        if (!leaveMap[name].includes(date)) leaveMap[name].push(date);
      }
    }

    _cache = leaveMap;
    _cacheExpiry = Date.now() + 4 * 60 * 60 * 1000;
    return res.status(200).json(leaveMap);
  } catch (e) {
    console.error('leaves endpoint error:', e.message);
    return res.status(200).json(_cache || {});
  }
};
