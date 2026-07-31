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
// To point at a different sheet or tab without editing this file, set SHEET_ID
// and SHEET_GID in Vercel: Project -> Settings -> Environment Variables.

const SHEET_ID = process.env.SHEET_ID || '1tzsf5iWijfIT8AfXTJZUbrGzH5OkNb-6xMO3EZ59cdo';
const SHEET_GID = process.env.SHEET_GID || '0';

module.exports = async (req, res) => {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

  try {
    const upstream = await fetch(url, { redirect: 'follow' });

    if (!upstream.ok) {
      return res.status(502).json({
        error: `Google returned ${upstream.status}.`,
        hint: upstream.status === 404
          ? 'Check the sheet ID and the tab gid.'
          : 'The sheet is probably not shared. Set General access to "Anyone with the link — Viewer".'
      });
    }

    const body = await upstream.text();

    // A sign-in redirect comes back as an HTML page, not CSV. Catch it here so the
    // dashboard shows a real explanation instead of parsing login markup as data.
    if (body.trimStart().startsWith('<')) {
      return res.status(502).json({
        error: 'Google returned a login page instead of the sheet.',
        hint: 'Open the sheet, then Share -> General access -> Anyone with the link -> Viewer.'
      });
    }

    // Cached at the edge for 5 minutes, served stale for another 10 while it
    // refreshes behind the scenes. Keeps the page fast without going far stale.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.status(200).send(body);

  } catch (err) {
    return res.status(502).json({
      error: 'Could not reach Google Sheets.',
      hint: String((err && err.message) || err)
    });
  }
};
