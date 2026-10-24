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

const { extractPdfText, parseLeavePDF } = require('../lib/leaves-parser');

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
