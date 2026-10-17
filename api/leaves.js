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

// ---- Minimal PDF text extraction (no npm, handles FlateDecode streams) ------

function extractPdfText(buf) {
  // PDF files contain one or more stream/endstream blocks. Text-based PDFs
  // (like Zoho People exports) embed text inside FlateDecode-compressed streams
  // using PDF text operators (BT/ET, Tj, TJ). We decompress each stream with
  // Node's built-in zlib and collect all string operands.
  const raw = buf.toString('binary');
  const parts = [];

  // Match stream contents between "stream\n…\nendstream".
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let data = Buffer.from(m[1], 'binary');

    // Try FlateDecode (zlib); if it fails the stream is uncompressed.
    try { data = zlib.inflateSync(data); } catch (_) {}

    const content = data.toString('latin1');

    // (text)Tj — single string
    const tjRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
    let tm;
    while ((tm = tjRe.exec(content)) !== null) parts.push(unescapePdf(tm[1]));

    // [(text1)(text2)…]TJ — array of strings (and kerning numbers we ignore)
    const tjARe = /\[([^\]]*)\]\s*TJ/g;
    while ((tm = tjARe.exec(content)) !== null) {
      const inner = tm[1];
      const sRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let sm;
      while ((sm = sRe.exec(inner)) !== null) parts.push(unescapePdf(sm[1]));
    }
  }

  return parts.join(' ');
}

function unescapePdf(s) {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
}

// ---- Zoho "Day Report" PDF parser -------------------------------------------

function parseLeavePDF(text) {
  // The PDFs contain a date header ("Date : 2026-10-16") and a table where
  // each data row starts with an employee ID (OD followed by digits).
  const dateMatch = text.match(/Date\s*[:\-]\s*(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) return [];
  const date = dateMatch[1];

  const entries = [];

  // Each text-token stream joins everything with spaces, so we work on the
  // full joined text rather than individual lines.
  // Pattern: OD<digits> <Name parts> <email@okiedokiepay.com>
  const rowRe = /OD\d+\s+([\w\s]+?)\s+[\w.+-]+@okiedokiepay\.com/g;
  let m;
  while ((m = rowRe.exec(text)) !== null) {
    const name = m[1].trim();
    // Skip rows whose surrounding context marks them as Cancelled.
    const ctx = text.slice(Math.max(0, m.index - 10), m.index + m[0].length + 20);
    if (/\bCancelled\b/i.test(ctx)) continue;
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
