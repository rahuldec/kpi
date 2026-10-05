// Reads leave data directly from the daily Drive PDFs — no Sheets, no Apps Script.
//
// Auth: a Google Service Account (GOOGLE_SA_JSON env var, full JSON).
// The Drive folder must be shared (Viewer) with the service account's email.
//
// SETUP (one-time):
//   1. Google Cloud Console → APIs & Services → Library → Enable "Google Drive API".
//   2. IAM & Admin → Service Accounts → Create service account (any name).
//      → Keys → Add key → JSON → Download.
//   3. In Google Drive, share the PDF folder with the service account email
//      (found in the JSON as "client_email") — Viewer access.
//   4. Paste the full JSON content as GOOGLE_SA_JSON in Vercel → Settings →
//      Environment Variables, then redeploy.
//
// On each (4-hour-cached) call:
//   • Lists all PDFs in GOOGLE_DRIVE_FOLDER_ID.
//   • For each PDF: downloads the binary, re-uploads it as a Google Doc so Drive
//     OCRs / extracts the text, exports as plain text, then deletes the temp Doc.
//   • Parses employee names and dates from the extracted text.
//   • Returns { "Employee Name": ["YYYY-MM-DD", ...] } — the same shape as
//     LEAVE_RAW in index.html, merged into LEAVE_DAYS at page load time.
//
// Both Pending and Approved leaves are included; Cancelled are excluded.
// Falls back to {} on any error so the page degrades to LEAVE_RAW only.

const crypto = require('crypto');

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '15WPsMyE1FoP-yXc5xvbiXgAC7rDbZ4Xb';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

// Module-level cache — survives warm Vercel invocations.
let _cache = null;
let _cacheExpiry = 0;
let _saToken = null;
let _saTokenExpiry = 0;

// ---- Google Service Account JWT auth ----------------------------------------

async function getAccessToken() {
  if (_saToken && Date.now() < _saTokenExpiry - 30000) return _saToken;

  const sa = JSON.parse(process.env.GOOGLE_SA_JSON || 'null');
  if (!sa || !sa.client_email || !sa.private_key)
    throw new Error('GOOGLE_SA_JSON is not set or is malformed');

  const now = Math.floor(Date.now() / 1000);
  const hdr = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const pay = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: DRIVE_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const sig = crypto.createSign('RSA-SHA256').update(`${hdr}.${pay}`).sign(sa.private_key, 'base64url');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${hdr}.${pay}.${sig}`,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`SA token error: ${j.error_description || j.error || r.status}`);

  _saToken = j.access_token;
  _saTokenExpiry = Date.now() + (j.expires_in || 3600) * 1000;
  return _saToken;
}

const b64url = s => Buffer.from(s).toString('base64url');
const auth = tok => ({ Authorization: `Bearer ${tok}` });

// ---- Drive API helpers -------------------------------------------------------

async function driveJson(path, tok) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { headers: auth(tok) });
  if (!r.ok) throw new Error(`Drive ${path.split('?')[0]}: ${r.status}`);
  return r.json();
}

// Downloads a PDF and re-uploads it as a Google Doc so Drive extracts the text.
// Returns the plain-text content, then deletes the temporary Doc.
async function pdfToText(fileId, tok) {
  // 1. Download the PDF binary.
  const dlR = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: auth(tok) }
  );
  if (!dlR.ok) throw new Error(`download ${fileId}: ${dlR.status}`);
  const pdfBytes = Buffer.from(await dlR.arrayBuffer());

  // 2. Re-upload as Google Doc (Drive converts / extracts text automatically).
  const boundary = 'lv' + Date.now();
  const meta = JSON.stringify({ name: '_leaves_tmp', mimeType: 'application/vnd.google-apps.document' });
  const bodyBuf = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8'),
    pdfBytes,
    Buffer.from(`\r\n--${boundary}--`, 'utf8'),
  ]);
  const upR = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: { ...auth(tok), 'Content-Type': `multipart/related; boundary="${boundary}"` },
      body: bodyBuf,
    }
  );
  if (!upR.ok) throw new Error(`upload-as-doc ${fileId}: ${upR.status}`);
  const { id: docId } = await upR.json();

  let text = '';
  try {
    // 3. Export the Google Doc as plain text.
    const expR = await fetch(
      `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text%2Fplain`,
      { headers: auth(tok) }
    );
    if (expR.ok) text = await expR.text();
  } finally {
    // 4. Always delete the temporary Doc, regardless of whether export succeeded.
    await fetch(`https://www.googleapis.com/drive/v3/files/${docId}`, {
      method: 'DELETE',
      headers: auth(tok),
    }).catch(() => {});
  }
  return text;
}

// ---- PDF text → leave entries -----------------------------------------------

function parseLeavePDF(text) {
  const dateMatch = text.match(/Date\s*[:\-]\s*(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) return [];
  const date = dateMatch[1];

  const entries = [];
  for (const line of text.split('\n')) {
    if (!/@okiedokiepay\.com/.test(line)) continue;
    if (/\bCancelled\b/i.test(line)) continue;

    // Name sits between the employee ID (OD followed by digits) and the email.
    const m = line.match(/OD\d+\s+(.+?)\s+\S+@okiedokiepay\.com/);
    if (!m) continue;
    const name = m[1].trim();
    if (name) entries.push({ name, date });
  }
  return entries;
}

// ---- Main handler -----------------------------------------------------------

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');

  if (_cache && Date.now() < _cacheExpiry) return res.status(200).json(_cache);

  try {
    const tok = await getAccessToken();

    // List all PDFs in the folder.
    const q = encodeURIComponent(`'${FOLDER_ID}' in parents and mimeType='application/pdf' and trashed=false`);
    const { files } = await driveJson(`files?q=${q}&fields=files(id,name,createdTime)&pageSize=400`, tok);

    const leaveMap = {};

    // Process each PDF — sequential to avoid hammering the Drive API.
    for (const file of files || []) {
      let text;
      try { text = await pdfToText(file.id, tok); } catch (e) {
        console.error(`leaves: skipping ${file.id}: ${e.message}`); continue;
      }
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
