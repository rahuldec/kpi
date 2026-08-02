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
      Compliance                          Business        Overall
        [ Internal ][ Client ][ Scorecard ]  [ Client book ]  [ KPI meter ]

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
process you keep it in. It carries the raw rupee figure rather than the abbreviated
one on screen, so a spreadsheet can total it.

## KPI meter

**Overall -> KPI meter** puts the two halves on one screen: a card per team with a
compliance dial and a business dial.

### Choosing months

The month control is a checkbox list, not a single `<input type="month">`. A quarter,
or two months side by side, is a question people actually ask, and a range control
cannot express "June and August but not July". Quick picks cover **This month**,
**Last 3** and **All covered**. The Scorecard and the KPI meter share the selection,
and it is remembered.

Only months the sheets actually reach are offered — listing a month with no data
behind it produces a confident 0%. The one exception is a month restored from a
previous visit that has since aged out of the export window: it stays listed so it
can be seen and unticked, and the coverage warning explains what happened.

The wording follows the selection. A finished month reads "July 2026"; the current
one reads "August 2026 to date". Two months read "July and August 2026"; more than
two collapse to "4 months: May to August 2026". The CSV filename carries the whole
span rather than just the first month.

Compliance is rolled up from the same `scoreRows()` the scorecard uses, so the two
views cannot disagree. It is a **pooled ratio** — the team's filed entries over its
expected ones — not an average of its members' percentages, which would let someone
with three expected days weigh as much as someone with fifty. It respects the month
picker and the "skip days before someone's first entry" toggle, both of which sit in
the same control bar.

Business is the standing book against the target.

Below the two dials, each card carries an **escalation line**: how many are open on
that team's clients, and which clients they are — a count alone just moves the
question along. It is deliberately not a third dial. A count of live problems has no
denominator, and a progress bar would invite reading "2 of 5" into it. Teams with
nothing open read "None open", with any earlier ones noted quietly. If the
escalation sheet fails, the line reads "not loaded" rather than zero, so no team is
wrongly marked clean.

    const METER_EXCLUDE = ['Sagar Mishra'];

Teams listed there are kept off this view. The meter reads compliance *against*
business, and a team with no client book has no business half to read — a 0% dial
says "failed" when the truth is "not applicable". They stay everywhere else: the
client book still lists them, and their people are still scored on the scorecard and
the daily boards. The note above the cards says who is excluded, why, and how many
people that leaves out of these figures.

Each card has an **(i)** button. It opens under that card and answers the question
the number provokes — the rule in one sentence, then the arithmetic for that team,
then **every date each member missed**, split by tracker. The counts and the dates
come from the same `scoreRows()` call that drew the dial, so the explanation cannot
disagree with the figure it explains. One panel opens at a time: several expanded
cards push the rest off screen and the grid stops being comparable.

**The two are not blended into one score.** Compliance is this month's behaviour,
business is the standing book; a team can be filing perfectly and still be far short
on revenue, and a single averaged figure hides exactly the case worth looking at.
Both dials use the same no-rounding-across-100 rule as the book table.

## Client book

The **Business -> Client book** tab shows who owns what: revenue by RM with each one's
share of the total, then every client with its owner, type, size band and billing for
the financial year, filterable by owner and by institution type.

The scorecard also carries a **Book** column, so a person's compliance and the revenue
behind them can be read on one line. Revenue is deliberately *not* folded into the
compliance percentage — a weak row against a large book is a different problem from a
weak row against none, and averaging them together hides which one you are looking at.
Only the six RMs own clients; everyone else shows a dash, and those rows sink to the
bottom whichever way the column is sorted rather than reading as zero.

### Teams

Each of the six RMs runs a team, and the book they carry is worked by that team
rather than by the RM alone. `PODS` near the top of `index.html` holds the mapping:

    const PODS = {
      'Sukhmeet Singh': ['Gobind', 'Sumaiya'],
      ...
    };

These were given directly and supersede the `Team` sheet in the workbook, which had
drifted — it had Divya under Amit rather than Mansi, Sumaiya under Sukhmeet, and no
team at all for Sagar.

Members can be written first-name-only, as the org chart writes them. They are
resolved against the roster: an exact match wins, otherwise a unique first name.
Anything that fails — a name nobody matches, or a first name two people share — is
**named on the page** under the team table rather than dropped. A pod chart that
quietly loses someone is worse than none, because the total it produces still looks
complete.

The table is driven by the team list, not by the client book, so a team that owns no
clients still gets a row with dashes rather than disappearing — Sagar's team files
timesheets whether or not it bills. Ankush Rana is the reverse: he owns 14 clients
with no team recorded, and his row says so.

The **Team** column on the scorecard shows which pod each person belongs to; sorting
by it groups a lead with their own people, lead first, which is how a review actually
runs.

### The target

A full team is one RM and two assistants carrying **₹50 lakh**. That fixes both the
shape and the number:

    const TARGET_FULL_TEAM = 5000000;   // rupees
    const TARGET_TEAM_SIZE = 3;         // one RM + two assistants

Most teams are not that shape, so the target reads two ways and both are on the page
behind one checkbox:

| | Question it asks | Amit's two people on ₹37.5L |
|---|---|---|
| **Flat** (default) | is it carrying a full team's worth of business, understaffed or not? | 75% |
| **Scaled** | is the team carrying its own staffing? — 50L x heads/3 | 112% |

Neither is wrong and they disagree loudly, so it is a toggle rather than a decision
buried in a formula. The choice is remembered.

Percentages never round across 100: a team ₹5,070 short of ₹50L shows 99%, not a
100% sitting beside a negative gap.

### Escalations

A third sheet — the **Client Escalations** Asana project — is fetched live and used
to flag clients in the list. Unlike the workbook this one is a native Google Sheet,
so `api/data.js` reads it as `?src=escalations`. It is identified by a different
signature (`Projects` + `Parent task`) because most of its rows have no due date.

Only top-level rows are escalations. They carry Section/Column "Clients"; the rows
beneath carry a `Parent task` and are the individual complaints inside one. Counting
those would report Budha as eighteen escalations rather than one.

The client is named in `Projects`, which lists every Asana project a task belongs
to — always "Client Escalations", plus usually the client's own project. Where the
client has no project of its own, the task Name is used instead.

**Open escalations flag the row** with a red rule and a badge. Closed ones get a
quiet outline badge and no flag: a client with a history of them is a different
conversation from one on fire right now.

#### Names that do not match

The escalation project and the client book are typed by different people, so exact
equality catches only some. Normalised containment catches the rest safely —
"Vedashree" to "Vedashree School", "GVM Girls College" to "GVM Girls College
Sonipat". It stops there: an acronym or a reordered name is a guess, and a wrong
guess puts a red flag on an innocent client, so unmatched names are **listed on the
page** and resolved by hand in `ESC_ALIAS`:

    const ESC_ALIAS = {
      'Sirsa MSG Glorious': 'Shah Satnam Sirsa'
    };

Prefer renaming in the sheets over adding an entry here — an alias is a second
place the truth lives. When a rename makes an alias redundant, remove it: one left
pointing at a client that no longer exists flags nothing at all.

An alias pointing at a client that is not in the book is worse than no alias — it
looks resolved and flags nothing — so that is reported in the same place.

#### It cannot break the page

Escalations are an enrichment, not a foundation. If the sheet is not shared or its
shape changes, the compliance figures are still correct and still render — the
failure is reported above the client list and nothing is flagged. Tests cover this
explicitly.

### This one is a snapshot, not a feed

The other two sources are fetched live. This one is compiled into `index.html`:

    const CLIENTS_ASOF = '2026-08-01';
    const CLIENTS = [ ... ];   // 148 rows

Only *numbered* rows from the sheet are taken. Below the client block there is
scratch — two internal "Daily work track" rows, a stray duplicate, and prospect notes
sitting in the wrong columns — and none of it carries a `Sr No.`. Filtering on the
client name alone pulls that in and inflates the total. The test suite checks the
embedded rows for exactly those shapes, so a future re-extraction cannot quietly
reintroduce them.

That is not a preference. "CS Team Plan.xlsx" is an *uploaded* .xlsx, and Drive only
exports Docs-editor files as CSV, so there is nothing for `api/data.js` to fetch. The
page states the snapshot date on the tab so the figures cannot quietly age.

To make it live: open the workbook in Drive, **File -> Save as Google Sheets**, share
the copy as *Anyone with the link — Viewer*, add its id to `api/data.js` beside the
other two, and add `clients` to the fetch in `load()`. The parser will need to read
the Clients sheet's columns rather than the Asana export's.

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

343 assertions with the network mocked: parsing (spacer rows above the header, quoted
fields containing commas and newlines, blank assignees, case-variant names), every
failure path (sheet not shared, network down, unparseable content), the date-window
rules, cross-checks between the three places misses are counted, escaping of sheet
content, the branding and embedded logo, the page title and metric grouping, the monthly scorecard and its CSV export, the coverage warning firing only for a month that really is outside the data, scorecard sorting (every column, both directions, exempt cells sinking, CSV matching the screen), the remembered view mode, range, tab and sort order, hidden people leaving no trace in any count while exempt people keep their row, the client book tab and its filters, the book column sitting beside compliance without altering it, lakh/crore formatting, pod resolution from first names with every failure reported on the page, the KPI meter (both dials, degenerate rosters, and an invariant that meter compliance equals the pooled scorecard rows team by team), static hygiene (no duplicate ids, no dangling $() references, nothing declared and never used), the (i) panel agreeing with its dial down to the date count, and a sweep over every tab checking that what should be hidden is hidden in computed style rather than merely flagged, the source switch, the combined roster, per-tracker exemptions, the three view modes and their persistence, Sunday handling in Today/Yesterday,
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
