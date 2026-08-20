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
  /* Module adoption. Not a single tab but one per RM per quarter, and the set
     grows every quarter — so this source addresses tabs by NAME rather than by
     gid. gviz serves any tab of a native Google Sheet as CSV given its title,
     which means a new quarter needs no new id, no re-publishing and no code
     change: name the tabs "Q2 <RM full name>" and they are found.

     Requires the workbook to be a native Google Sheet (not an uploaded .xlsx —
     gviz will not serve those) and link-shared as Viewer. "ERP Usage Score"
     satisfies both. Override the file with ADOPTION_SHEET_ID in Vercel. */
  adoption:    { id: process.env.ADOPTION_SHEET_ID ||
                     '1uPatUpKNHNNvrz5mtz8_af9e_0rk6iPu9o0Bfc919sw',
                 byName: true },
  /* Client feedback. A Google Form's own responses tab, published as CSV. Same
     transport as the book and for the same reason — one fixed tab, no hunt.

     The form is the client's voice; everything else on this dashboard is ours.
     That is exactly why it joins on a name typed by the respondent, which is the
     weak link: see the note on the institution field in README. */
  feedback:    { url: process.env.FEEDBACK_CSV_URL ||
                   'https://docs.google.com/spreadsheets/d/e/2PACX-1vQnAHkLeFy5AzJEjnokYna54ZEIkf' +
                   '4ZnLCKNTqNvLuLPTVcOMX_1TY7U9jOL5HCf_ienaNUBCrwmzlI/pub?gid=981789536&single=true&output=csv',
                 signature: csv => /timestamp/i.test(csv) && /institution/i.test(csv),
                 envVar: 'FEEDBACK_CSV_URL',
                 mismatch: 'It has no "Timestamp" and "Institution" columns — the link probably ' +
                           'points at the wrong tab. Re-publish with the form responses tab ' +
                           'selected and update FEEDBACK_CSV_URL.' },
  /* Not a Google sheet at all. Field visits come from the MOM Portal's own API
     (source: github.com/rahuldec/odmom, src/routes/api/public/moms.ts) — one
     row per meeting, JSON, behind a shared secret. It is proxied here for one
     reason only: the secret must never reach the browser, and this page's CSP
     forbids the browser calling another origin anyway.

     There is no tab hunt and no signature-matching against sheet text here —
     the portal's route already validates its own shape (Zod on the way in);
     this proxy only checks that the body parses as `{ data: [...] }` before
     handing it to the page.

     Fails closed. If MOM_API_KEY is unset the portal refuses everyone, which
     is the correct behaviour for an unconfigured secret — an open visits feed
     would expose which clients were visited by whom and when. */
  visits:      { direct: process.env.MOM_API_URL ||
                   'https://odmom.lovable.app/api/public/moms?limit=200',
                 headers: () => ({ 'x-api-key': process.env.MOM_API_KEY || '' }),
                 json: true,
                 signature: body => {
                   try { return Array.isArray(JSON.parse(body).data); }
                   catch { return false; }
                 },
                 envVar: 'MOM_API_KEY',
                 mismatch: 'The portal answered, but not with { data: [...] } — check ' +
                           'MOM_API_URL points at /api/public/moms.' },
  book:        { url: process.env.BOOK_CSV_URL ||
                   'https://docs.google.com/spreadsheets/d/e/2PACX-1vRJduuwLQYkHFCDbGo1J-kGu8gN' +
                   'WH3CX7dD8vVekiztMWxuiJIY1wptsW4eGgO5wg/pub?gid=667331627&single=true&output=csv',
                 // Neither a tracker nor an escalation export — one row per client.
                 signature: csv => /client name/i.test(csv) && /total billing/i.test(csv),
                 envVar: 'BOOK_CSV_URL',
                 mismatch: 'It has no "Client Name" and "Total Billing FY" columns — the link ' +
                           'probably points at the wrong tab. Re-publish with the Clients tab ' +
                           'selected and update BOOK_CSV_URL.' },
  /* Who reports to whom — the "Team" tab, another tab in the same CS Team Plan
     workbook the book comes from (same publish token, different gid), added 17
     Aug 2026 to replace a hardcoded object in index.html that needed a code
     change every time someone moved teams. One row per lead: RM name in the
     first column, an assistant per column after it. A new RM is a new row; a
     reshuffle is moving a name between rows — no code change either way. */
  team:        { url: process.env.TEAM_CSV_URL ||
                   'https://docs.google.com/spreadsheets/d/e/2PACX-1vRJduuwLQYkHFCDbGo1J-kGu8gN' +
                   'WH3CX7dD8vVekiztMWxuiJIY1wptsW4eGgO5wg/pub?gid=976946752&single=true&output=csv',
                 signature: csv => /^rm,/im.test(csv),
                 envVar: 'TEAM_CSV_URL',
                 mismatch: 'It has no "RM" column as the first header — the link probably ' +
                           'points at the wrong tab. Re-publish with the Team tab selected ' +
                           'and update TEAM_CSV_URL.' },
  /* An Asana portfolio report ("Client Implementation"), exported the same way
     the Asana project itself would be — File -> Export -> CSV, or in this case a
     live "Open Report in Google Sheets" published to the web, so it stays
     current without anyone re-exporting by hand. One row per implementation
     project, not per client: the join to the client book happens entirely in
     index.html, the same way escalations do, because the two are typed into
     different systems by different people and can't be trusted to agree on a
     name. */
  implementation: { url: process.env.IMPLEMENTATION_CSV_URL ||
                   'https://docs.google.com/spreadsheets/d/e/2PACX-1vTa-IsaEuSdjzhsy_Vclm-4bTWeDmtz7pAbleMxaQJo32zMBSz1-eUl8aZ6dZX1SpeD_4h-3ClLsQAr' +
                   '/pub?gid=523747668&single=true&output=csv',
                 signature: csv => /owner/i.test(csv) && /overdue/i.test(csv) && /due date/i.test(csv),
                 envVar: 'IMPLEMENTATION_CSV_URL',
                 mismatch: 'It has no "Owner", "Overdue" and "Due Date" columns — the link ' +
                           'probably points at the wrong tab, or the Asana portfolio export ' +
                           'changed shape. Re-export the "Client Implementation" portfolio to ' +
                           'Google Sheets and update IMPLEMENTATION_CSV_URL.' }
};

const trackerSignature = csv => /due date/i.test(csv) && /assignee/i.test(csv);

/* One tab of a native Google Sheet, addressed by its title. */
async function grabNamed(id, tab) {
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq` +
              `?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) return { ok: false, status: r.status };
  const body = await r.text();
  /* gviz answers a missing tab with an HTML error page rather than a 404, and
     an unshared file with the login page. Both start with a tag; neither is a
     tab that exists, and neither must reach the parser. */
  if (isLoginPage(body)) return { ok: false, missing: true };
  return { ok: true, body };
}

/* Tab titles come from the client, so they are the one thing here an outsider
   could influence. The file id never does — it is fixed above — so the worst a
   crafted name can do is name a tab that does not exist. Still: keep them to
   what a tab title can plausibly be, and cap how many are asked for at once, so
   this cannot be turned into a fan-out. */
const cleanTab = s => String(s || '').replace(/[^\w .&'()-]/g, '').trim().slice(0, 60);
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
    res.setHeader('Content-Type', source.json ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8');
    res.setHeader('X-Sheet-Gid', String(hit.gid ?? 'default'));
    res.setHeader('X-Sheet-Source', SOURCES[src] ? src : 'internal');
    return res.status(200).send(hit.body);
  };

  const fail = (error, hint) =>
    res.status(502).json({ error, hint, source: src, sheetId: SHEET_ID, attempted });

  try {
    /* 0a. Tabs by name, one per RM per quarter. The client sends the RM names it
       knows from the client book; this tries the most recent quarter first and
       stops at the first one any tab answers for, so a half-finished Q2 does not
       hide a complete Q1. Blocks come back concatenated with a marker line — one
       response, one edge cache entry, however many tabs. */
    /* 0. A source that is not a spreadsheet. One request, no tab hunt, and the
       secret stays server-side. A 401 here means the two halves of the shared
       key disagree, which is worth saying plainly rather than reporting as a
       generic upstream failure — it is the one thing that will actually go
       wrong. */
    if (source.direct) {
      attempted.push(source.direct);
      if (!process.env[source.envVar])
        return fail(`${source.envVar} is not set on this deployment.`,
                    'Generate one (openssl rand -hex 32), set it here and as MOM_API_KEY ' +
                    'on the MOM Portal (same value, different variable name on each side — ' +
                    'that is expected). The portal refuses every request until both match.');
      let r;
      try {
        r = await fetch(source.direct, { headers: source.headers() });
      } catch (e) {
        return fail(`Could not reach the MOM Portal: ${e.message}`,
                    'Check MOM_API_URL and that the portal is deployed.');
      }
      if (r.status === 401 || r.status === 403)
        return fail('The MOM Portal rejected the key.',
                    `${source.envVar} here and MOM_API_KEY on the portal must be the same ` +
                    'value. Rotating one without the other breaks this.');
      if (!r.ok) return fail(`The MOM Portal answered ${r.status}.`, 'Nothing to read.');
      const body = await r.text();
      if (!looksLikeTheExport(body)) return fail('Unexpected response.', source.mismatch);
      return send({ body, gid: null });
    }

    if (source.byName) {
      const names = String((req.query && req.query.rms) ||
        new URL(req.url, 'http://x').searchParams.get('rms') || '')
        .split(',').map(cleanTab).filter(Boolean).slice(0, 12);
      if (!names.length)
        return fail('No RM names were supplied for ?src=adoption.',
                    'The page sends them from the client book; an empty list means the ' +
                    'book failed to load first.');

      const qParam = Number((req.query && req.query.q) ||
        new URL(req.url, 'http://x').searchParams.get('q') || 0);
      const quarters = qParam >= 1 && qParam <= 4 ? [qParam] : [4, 3, 2, 1];

      for (const q of quarters) {
        const tabs = names.map(n => `Q${q} ${n}`);
        attempted.push(...tabs);
        const got = await Promise.all(tabs.map(async t => ({t, r: await grabNamed(SHEET_ID, t)})));
        const hits = got.filter(x => x.r.ok);
        if (!hits.length) continue;
        const body = hits.map(x => `#### TAB: ${x.t}\n${x.r.body}`).join('\n\n') +
          got.filter(x => !x.r.ok).map(x => `\n\n#### MISSING: ${x.t}`).join('');
        res.setHeader('X-Adoption-Quarter', String(q));
        res.setHeader('X-Adoption-Tabs', String(hits.length));
        return send({body, gid: `Q${q}`});
      }
      return fail(
        `No tab was found for any quarter in the ERP Usage Score sheet.`,
        `Tabs are looked up by name, so each must be called "Q<number> <RM full name>" ` +
        `exactly as the client book spells that RM — for example "Q1 ${names[0]}". ` +
        `Tried: ${attempted.slice(0, 8).join(', ')}${attempted.length > 8 ? '…' : ''}`);
    }

    /* 0b. A published source is a fixed URL with the tab already chosen. There is
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
        `Republishing can mint a new link — set ${source.envVar || 'the URL environment variable'} ` +
        'in Vercel if it changed.');
      const body = await r.text();
      if (isLoginPage(body)) return fail(
        'Google returned a page instead of CSV for the published sheet.',
        'The publication has most likely been revoked. Re-publish the tab via File -> Share -> Publish to web.');
      if (!looksLikeTheExport(body)) return fail(
        `The published CSV for "${src}" is not the tab this source expects.`,
        source.mismatch || 'The link probably points at the wrong tab.');
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
