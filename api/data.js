// Fetches the tracker sheet as CSV, server-side.
//
// Why this exists: the browser cannot reliably fetch docs.google.com directly —
// that depends on Google returning CORS headers. This runs on Vercel's server,
// where CORS does not apply, and hands the CSV back to the page from your own
// domain. It also keeps the sheet URL out of the client.
//
// The sheet must be readable without a login:
//   Share -> General access -> Anyone with the link -> Viewer
//
// Why it hunts for the tab: this spreadsheet has more than one tab. The first
// one holds the Asana integration URL, not the export, so asking Google for the
// default tab returns a CSV with no "Due Date" column. Tab ids (gids) are not
// sequential and Asana's integration can recreate a tab with a new id, so any
// hardcoded gid is a time bomb. Instead we identify the right tab by its
// contents. Set SHEET_GID in Vercel -> Settings -> Environment Variables to skip
// the search if you ever want to pin it.

// Two trackers, same Asana export shape, different sheets. Selected with
// ?src=internal or ?src=client; anything else falls back to internal.
const SOURCES = {
  internal: { id: process.env.SHEET_ID        || '1tzsf5iWijfIT8AfXTJZUbrGzH5OkNb-6xMO3EZ59cdo',
              gid: process.env.SHEET_GID        || '' },
  client:   { id: process.env.CLIENT_SHEET_ID || '1oUHAjf6zAiHdLd11jvqerbXC0adx5XDsqlfLoRNOSCY',
              gid: process.env.CLIENT_SHEET_GID || '' }
};

const looksLikeTheExport = csv => /due date/i.test(csv) && /assignee/i.test(csv);
const isLoginPage = body => body.trimStart().startsWith('<');

async function grab(base, gid) {
  const url = `${base}/export?format=csv` + (gid === null ? '' : `&gid=${gid}`);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) return { ok: false, status: r.status, url };
  const body = await r.text();
  if (isLoginPage(body)) return { ok: false, login: true, url };
  return { ok: true, body, url, gid };
}

// Tab ids live in the sheet's own HTML view, which link-sharing makes readable.
async function discoverGids(base) {
  for (const path of ['/htmlview', '/pubhtml']) {
    try {
      const r = await fetch(base + path, { redirect: 'follow' });
      if (!r.ok) continue;
      const html = await r.text();
      const found = [...html.matchAll(/[?&#]gid=(\d+)/g)].map(m => m[1]);
      if (found.length) return [...new Set(found)].slice(0, 12);
    } catch (_) { /* try the next path */ }
  }
  return [];
}

module.exports = async (req, res) => {
  const attempted = [];
  const src = (req.query && req.query.src) ||
              (new URL(req.url, 'http://x').searchParams.get('src')) || 'internal';
  const source = SOURCES[src] || SOURCES.internal;
  const SHEET_ID = source.id;
  const PINNED_GID = source.gid;
  const BASE = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

  const send = hit => {
    // Cached at the edge for 5 minutes, served stale for another 10 while it
    // refreshes behind the scenes. Keeps the page fast without going far stale.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Sheet-Gid', String(hit.gid ?? 'default'));
    res.setHeader('X-Sheet-Source', SOURCES[src] ? src : 'internal');
    return res.status(200).send(hit.body);
  };

  const fail = (error, hint) =>
    res.status(502).json({ error, hint, source: src, sheetId: SHEET_ID, attempted });

  try {
    // 1. A pinned tab wins outright.
    if (PINNED_GID) {
      const hit = await grab(BASE, PINNED_GID);
      attempted.push({ gid: PINNED_GID, ok: hit.ok, status: hit.status || 200 });
      if (hit.ok && looksLikeTheExport(hit.body)) return send(hit);
      if (hit.ok) return fail(
        `SHEET_GID is set to ${PINNED_GID}, but that tab has no "Due Date" column.`,
        'Remove the SHEET_GID environment variable to let the function find the right tab itself.');
    }

    // 2. Try the default tab.
    const first = await grab(BASE, null);
    attempted.push({ gid: 'default', ok: first.ok, status: first.status || 200 });
    if (first.login) return fail(
      'Google returned a login page instead of the sheet.',
      'Open the sheet, then Share -> General access -> Anyone with the link -> Viewer.');
    if (first.ok && looksLikeTheExport(first.body)) return send(first);

    // 3. Walk the remaining tabs and take the one that is actually the export.
    const gids = await discoverGids(BASE);
    if (!gids.length) return fail(
      'The default tab has no "Due Date" column, and the other tabs could not be listed.',
      'Open the tab holding the Asana export, copy the number after "gid=" in the address bar, ' +
      'and set it as SHEET_GID in Vercel -> Settings -> Environment Variables.');

    for (const gid of gids) {
      const hit = await grab(BASE, gid);
      attempted.push({ gid, ok: hit.ok, status: hit.status || 200 });
      if (hit.ok && looksLikeTheExport(hit.body)) return send(hit);
    }

    return fail(
      'None of the tabs in this spreadsheet have both a "Due Date" and an "Assignee" column.',
      'Check that the Asana export is still writing to this sheet.');

  } catch (err) {
    return fail('Could not reach Google Sheets.', String((err && err.message) || err));
  }
};
