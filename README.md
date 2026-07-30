# Timesheet gaps — CS Internal Team Calls Tracker

Single static page. Shows who has not filed a daily timesheet entry, per person per
working day, from an Asana project export.

No build step, no backend, no dependencies at runtime beyond a Google Fonts stylesheet.

## What ships

**The July 2026 dataset is embedded in `index.html`** — 20 named employees and their
per-day filing record. This is deliberate: the page renders populated on load rather
than showing an empty state.

Deployed to a public URL, that data is readable by anyone with the link. That is an
accepted trade-off for this tool, not an oversight. If it ever stops being acceptable,
two options:

- Turn on **Deployment Protection** (Project → Settings → Deployment Protection →
  Vercel Authentication). One toggle, restricts to your team.
- Replace the `SAMPLE` block in `index.html` with an empty array and paste data at
  use time instead.

`vercel.json` sets `noindex, nofollow` so the page stays out of search results either
way. That is not access control — it only stops crawlers.

## Deploy

    npm i -g vercel
    cd deploy
    vercel --prod

Or drag this folder onto the Vercel dashboard, or connect it as a Git repo. Netlify,
Cloudflare Pages, GitHub Pages and Render static sites all work the same way; only
`vercel.json` is Vercel-specific, and dropping it costs you the headers, not the page.

## Daily use

1. Open the linked Google Sheet, select all, copy.
2. **Load a fresh export** → paste → **Rebuild**.
3. Set the date range you care about.

Parsing happens entirely in the browser. Nothing pasted is transmitted anywhere, and
nothing is stored — a reload returns to the embedded July data.

## Reading the numbers

- A person-day counts as filed if at least one entry carries that due date. A separate
  Online Meeting and Phone call row on the same day still counts once.
- Sundays are excluded everywhere. Saturdays count as working days.
- **Skip days before someone's first entry** (on by default) stops a recent joiner
  being scored for a period they were not around. Days *after* their first entry always
  count, so someone who stops filing still surfaces.
- **Longest live streak** counts consecutive working days missed, backwards from the
  end of the date range, until it hits a day they filed. It can never exceed the number
  of working days in the range — a one-day range gives a maximum streak of 1.

## Tests

    npm install jsdom
    node qa.js
    TZ=Asia/Kolkata node qa.js

40 assertions covering parsing (CSV and TSV, quoted fields, embedded newlines),
degenerate date ranges, HTML escaping of pasted names, case-insensitive person
matching, and timezone independence. Run them after any change to the parser — the
Asana form fields are expected to change once back-dated entries are blocked.

## Known limitations

These are open, not fixed:

- **Loading an export resets the date range** to the span of the pasted data. Paste a
  one-day export and every history-dependent figure silently collapses. Widen the range
  manually after pasting.
- **Only people present in the export are visible.** Someone who has never filed does
  not appear at all — no row, not counted. A fixed roster would fix this.
- "Never missed a day" counts anyone with a clean sheet, including someone whose first
  entry is the last day of the range. Read it alongside the Filed column.
- Public holidays and leave are not modelled. Both read as missed days.
