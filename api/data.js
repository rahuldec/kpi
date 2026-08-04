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

// Four sheets behind three shapes. Selected with ?src=; anything unrecognised
// falls back to internal.
//
// The two trackers are per-person daily timesheets. The escalations sheet is a
// different animal: one row per client escalation, keyed by the client rather
// than by a person. It shares the export shape, so the same tab-hunt works, but
// it is identified by a different column — see `signature` below.
//
// The book is different again. "CS Team Plan" is an uploaded .xlsx, and Drive
// only exports Docs-editor files, so /export?format=csv has nothing to serve for
// it. File -> Share -> Publish to web sidesteps that: Google renders the chosen
// tab as CSV at a /d/e/2PACX-.../pub URL regardless of the source format. A
// published source carries a full `url` and skips the tab hunt entirely, since
// the gid is already baked into the link.
//
// Two things to know about that link. It is a *publication*, separate from the
// file's own sharing — unpublishing breaks this without changing any permission,
// and re-publishing can mint a new token. And Google caches published output for
// a few minutes, so a fresh edit is not always visible on the next reload. Set
// BOOK_CSV_URL in Vercel -> Settings -> Environment Variables to repoint it
// without a code change.
const SOURCES = {
  internal:    { id: process.env.SHEET_ID        || '1tzsf5iWijfIT8AfXTJZUbrGzH5OkNb-6xMO3EZ59cdo',
                 gid: process.env.SHEET_GID        || '' },
  client:      { id: process.env.CLIENT_SHEET_ID || '1oUHAjf6zAiHdLd11jvqerbXC0adx5XDsqlfLoRNOSCY',
                 gid: process.env.CLIENT_SHEET_GID || '' },
  escalations: { id: process.env.ESC_SHEET_ID    || '1Y1S-jDHFyUe3IJw-B3X8CgM9JFnRwl_L7fkNtzgVEAw',
                 gid: process.env.ESC_SHEET_GID   || '',
                 // This export has no Due Date on most rows, so the tracker test
                 // would reject the right tab. Match on what it does have.
                 signature: csv => /projects/i.test(csv) && /parent task/i.test(csv) },
  /* The stacked adoption tab. Deliberately has no default URL: the workbook it
     lives in is published as "Entire Document", which for CSV serves whichever
     tab happens to be first — a per-RM tab in the raw 119-column shape, not the
     stacked one. Guessing at it would hand the page a sheet it cannot parse and
     blame the parser. Publish the stacked tab on its own (File -> Share ->
     Publish to web, pick that tab, not Entire Document) and set the resulting
     link — it will carry gid= and single=true — as ADOPTION_CSV_URL in Vercel.
     Until then the page falls back to its compiled snapshot and says so. */
  adoption:    { url: process.env.ADOPTION_CSV_URL || '',
                 signature: csv => /adopted/i.test(csv) && /applicable/i.test(csv) },
  book:        { url: process.env.BOOK_CSV_URL ||
                   'https://docs.google.com/spreadsheets/d/e/2PACX-1vRJduuwLQYkHFCDbGo1J-kGu8gN' +
                   'WH3CX7dD8vVekiztMWxuiJIY1wptsW4eGgO5wg/pub?gid=667331627&single=true&output=csv',
                 // Neither a tracker nor an escalation export — one row per client.
                 signature: csv => /client name/i.test(csv) && /total billing/i.test(csv) }
};

const trackerSignature = csv => /due date/i.test(csv) && /assignee/i.test(csv);
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
  const looksLikeTheExport = source.signature || trackerSignature;
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
    /* 0. A published source is a fixed URL with the tab already chosen. There is
       no tab to hunt for and no gid to pin, so this returns before any of that. */
    /* A published source with an empty url must not fall through to the tab
       hunt below — that hunts inside the *tracker* spreadsheet and would hand
       back a timesheet export under the adoption name. Wrong data is worse than
       no data, so say plainly what is missing. */
    if ('url' in source && !source.url)
      return fail(
        `No published URL is configured for ?src=${src}.`,
        'Publish the stacked tab (File -> Share -> Publish to web -> pick that tab, ' +
        'not Entire Document) and set the link as ADOPTION_CSV_URL in Vercel -> ' +
        'Settings -> Environment Variables. The page falls back to its built-in ' +
        'snapshot until then.');

    if (source.url) {
      /* The page varies its request to this function, so Vercel's edge never
         serves a stale copy — but this leg used to request the exact same Google
         URL every time, which is the one place a cached copy could still hide.
         A throwaway parameter makes each request unique. Google ignores params it
         does not know.

         Be clear about what this can and cannot do. It rules out any cache
         between here and Google. It does not touch the one *inside* Google:
         published output is regenerated on Google's own schedule, a few minutes
         behind the edit, and no request shape reaches past that. If the book has
         to be current to the second, publishing is the wrong transport — see the
         note on downloading the workbook directly in README. */
      const url = source.url + (source.url.includes('?') ? '&' : '?') + '_=' + Date.now();
      const r = await fetch(url, { redirect: 'follow', headers: { 'Cache-Control': 'no-cache' } });
      attempted.push({ url: source.url, ok: r.ok, status: r.status });
      if (!r.ok) return fail(
        `The published CSV for "${src}" returned ${r.status}.`,
        'Open the sheet, then File -> Share -> Publish to web, and republish the tab as CSV. ' +
        'Republishing can mint a new link — set BOOK_CSV_URL in Vercel if it changed.');
      const body = await r.text();
      if (isLoginPage(body)) return fail(
        'Google returned a page instead of CSV for the published sheet.',
        'The publication has most likely been revoked. Re-publish the tab via File -> Share -> Publish to web.');
      if (!looksLikeTheExport(body)) return fail(
        `The published CSV for "${src}" does not look like the client book.`,
        'It has no "Client Name" and "Total Billing FY" columns — the link probably points at the ' +
        'wrong tab. Re-publish with the Clients tab selected and update BOOK_CSV_URL.');
      return send({ body, gid: 'published' });
    }

    // 1. A pinned tab wins outright.
    if (PINNED_GID) {
      const hit = await grab(BASE, PINNED_GID);
      attempted.push({ gid: PINNED_GID, ok: hit.ok, status: hit.status || 200 });
      if (hit.ok && looksLikeTheExport(hit.body)) return send(hit);
      if (hit.ok) return fail(
        `A gid is pinned for "${src}" (${PINNED_GID}), but that tab does not look like the export.`,
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
      'No tab in this spreadsheet looks like the expected Asana export.',
      'Check that the Asana export is still writing to this sheet.');

  } catch (err) {
    return fail('Could not reach Google Sheets.', String((err && err.message) || err));
  }
};
