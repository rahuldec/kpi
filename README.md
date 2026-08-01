# Timesheet gaps — CS call trackers

Branded to Okie Dokie Campus Automation. Palette sampled directly from the logo —
orange `#EC6724`, wordmark maroon `#821D13`, star gold `#FCDE5C`. Type is the native
system stack (SF on Apple, Segoe on Windows, Roboto on Android), so there is no webfont
to download; the logo is embedded as a data URI. The page therefore makes **no external
requests at all**, and the CSP is tightened accordingly.

Single static page. Shows who has not filed a daily timesheet entry, per person per
working day, from an Asana project export.

## Structure

The page is **CS Team KPI** — the whole set of team metrics. Everything currently on
it measures one thing, whether people filed what they owe, so it sits in a group
labelled **Compliance**:

    CS Team KPI                                    <- fixed page title
      Compliance                                   <- metric group
        [ Internal team calls ][ Client calls ][ Scorecard ]

The page title and the group label never change. The headline below the tabs does —
it names the view you are in. A second family of metrics is a second `.group` block
in `index.html` with its own label and its own tabs; nothing else has to move.

Two trackers behind the first two tabs:

| Tab | Asana project | Sheet |
|---|---|---|
| Internal team calls | CS Internal Team Calls Tracker | `1tzsf5iWij…` |
| Client calls | CS Client Call Tracker | `1oUHAjf6zA…` |

Both are the same Asana export shape, so one parser handles both. The choice is
remembered in the browser.

### Exemptions

Everyone on the roster is expected to file to **both** trackers, with exceptions listed
in the `EXEMPT` block at the top of the `<script>` in `index.html`:

    const EXEMPT = {
      internal: [],
      client:   ['sagar mishra', 'sumaiya khan']
    };

### Hiding someone entirely

`EXEMPT` keeps a person's row and shows a dash for the tracker they are not expected
to file to. `HIDDEN`, just below it, is for someone who is not part of the CS team
being measured at all — a name that turns up in a sheet because they were tagged on a
task. They are dropped as the sheets load, so they have no row anywhere and no effect
on any count.

    const HIDDEN = ['rahul'];

Match is on the full display name as Asana writes it, lowercased. If the sheet says
`Rahul Sharma`, the entry has to read `rahul sharma`.

Lowercase names. To change it: on GitHub open `index.html`, click the pencil, edit,
commit — live in about a minute. Exempt people are dropped from every count on that
tab and named in a line beneath the panels, so the exclusion is never silent. If one
files anyway, they reappear — their work is never hidden.

Move this to a roster sheet if it grows past a handful of names, or if you start
needing joiner and leaver dates.

**The same team is expected to file to both.** Both sheets are therefore loaded on
every visit and the roster is the union of everyone appearing in either. Each tab is
scored against that full roster, not against whoever happens to appear in that one
sheet.

This is deliberate and it is the point. Six people appear only in the internal sheet
and one only in the client sheet. Scored per-sheet they would simply be absent from
the other tab — invisible rather than flagged. Scored against the union they show as
what they are: a full row of red.

The roster is still only as complete as the two sheets. Anyone who has never filed to
either has never appeared anywhere and cannot be counted. A fixed list of names would
close that last gap.

Names are merged case-insensitively across both sheets, since Asana display names vary
("kashish Goel" and "Kashish Goel" are one person).

No build step, no backend, no runtime dependencies at all.

## How it gets its data

    browser  ->  /api/data  (this project)  ->  docs.google.com  ->  the sheet

`api/data.js` is a serverless function on your own Vercel project. It takes
`?src=internal` or `?src=client`, fetches the matching sheet server-side and hands back raw CSV. The browser only ever talks to your own
domain, so cross-origin restrictions never apply — which is why this is a function
and not a direct `fetch` to Google.

No employee data is stored in this repository. Everything is read live and parsed in
the browser. Responses are cached at Vercel's edge for 5 minutes.

**The sheet must be readable without signing in.** In the sheet: Share → General
access → **Anyone with the link → Viewer**. Without that, Google returns a login page
and the dashboard shows an error explaining exactly this.

The page is public, so anyone with the URL sees the data. `vercel.json` sets
`noindex, nofollow` to keep it out of search results, but that is not access control.
For real restriction: Project → Settings → **Deployment Protection** → Vercel
Authentication.

### Pointing at a different sheet or tab

Project → Settings → Environment Variables: `SHEET_ID` / `SHEET_GID` for the internal
tracker, `CLIENT_SHEET_ID` / `CLIENT_SHEET_GID` for the client one. No code change
needed. Defaults are in `api/data.js`.

## Deploy

    npm i -g vercel
    cd kpi
    vercel --prod

Or drag this folder onto the Vercel dashboard, or connect it as a Git repo. Netlify,
Cloudflare Pages, GitHub Pages and Render static sites all work the same way; only
`vercel.json` is Vercel-specific, and dropping it costs you the headers, not the page.

## Scorecard — the monthly KPI record

The third tab counts missed days per person, per tracker, for a whole month.

| Column | Meaning |
|---|---|
| Internal missed | working days in the month with no internal entry |
| Client missed | same for client calls; `—` if exempt from that tracker |
| Total missed | the two added together |
| Filed | entries filed / entries expected |
| Compliance | filed as a percentage of expected |

### Sorting

Every column header is a button. Click one to sort by it, click it again to reverse.
The default is total missed, worst first — the question the page exists to answer —
and your choice is remembered in the browser, so a review that always reads the same
way does not have to be set up each time.

A new column opens at whichever end is useful for it: worst first for the three
missed counts and for Filed, A–Z for Person, weakest first for Compliance.

An exempt cell is a dash, not a zero, so those rows sink to the bottom whichever way
a tracker's column is pointed. Sorting Client missed ascending will not crown someone
who was never expected to file client calls.

**Download CSV** gives the table in the order you are looking at it, for whatever KPI
process you keep it in.

Rules, deliberately simple:

- One expected entry **per tracker per working day**, so most people owe two a day.
- Sundays excluded. Days later than today are not counted, so a mid-month figure
  reads against days elapsed, not the whole month.
- Days before a person's first ever entry are excluded while **Skip days before
  someone's first entry** is ticked.
- Exempt people are not scored for that tracker at all.

**Nothing is stored.** The figure is recomputed from the sheets every time it is
opened, so a late correction in Asana is reflected immediately rather than frozen into
a saved record. If you need a fixed snapshot — a number that will not move after a
review has happened — download the CSV on the last day of the month and keep the file.

## Daily use

Open the URL. It reads the sheet on load. Three views:

| Button | Range | Chase panel counts |
|---|---|---|
| **Today** | today only | today |
| **Yesterday** | previous working day | that day |
| **Date range** | reveals From/To | last working day in the range |

Whichever you last used is remembered in the browser and becomes your default, so the
filter never has to be set twice. Custom From/To values are remembered separately.

Sundays are skipped throughout, so **Yesterday** on a Monday means the previous
Saturday. The chase panel always spells out the actual date it is counting.

Under **Today** and **Yesterday** the range is a single day, so the panels below the
chase list — the grid, streaks, coverage — have no history to measure and go flat.
That is expected: those two views exist for the chase list. Use **Date range** for
anything historical.

**Refresh** re-reads the sheet, bypassing the cache. The line beside it shows how many
entries loaded and when.

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

158 assertions with the network mocked: parsing (spacer rows above the header, quoted
fields containing commas and newlines, blank assignees, case-variant names), every
failure path (sheet not shared, network down, unparseable content), the date-window
rules, cross-checks between the three places misses are counted, escaping of sheet
content, the branding and embedded logo, the page title and metric grouping, the monthly scorecard and its CSV export, the coverage warning firing only for a month that really is outside the data, scorecard sorting (every column, both directions, exempt cells sinking, CSV matching the screen), the remembered view mode, range, tab and sort order, hidden people leaving no trace in any count while exempt people keep their row, the source switch, the combined roster, per-tracker exemptions, the three view modes and their persistence, Sunday handling in Today/Yesterday,
inverted date ranges, and timezone independence. Run them after any change to the parser — the
Asana form fields are expected to change once back-dated entries are blocked.

## Known limitations

These are open, not fixed:

- **Only people present in the sheet are visible.** Someone who has never filed does
  not appear at all — no row, not counted, absent from the chase list. This is the
  biggest gap. A fixed roster would fix it.
- "Never missed a day" counts anyone with a clean sheet, including someone whose first
  entry is the last day of the range. Read it alongside the Filed column.
- Public holidays and leave are not modelled. Both read as missed days.
