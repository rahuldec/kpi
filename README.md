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
`?src=internal`, `?src=client`, `?src=escalations`, `?src=book` or `?src=adoption`,
fetches the matching sheet server-side and hands back raw CSV. The first three are
Google Sheets fetched by id with the right tab discovered by its columns; the last two
are published-to-web CSVs fetched by their full URL. The browser only ever talks to your own
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

### vercel.json takes no comments

Vercel validates that file against a strict schema *before* it builds anything, and a
rejected deploy takes every other change with it. JSON has no comment syntax and the
schema permits no extra keys on a header rule — a `comment` array inside one is enough
to fail the whole deploy. So the reasoning lives here instead:

**`/` and `/index.html` are sent `Cache-Control: no-cache, must-revalidate`.** The
client book parser, the roster and the pod mapping all live inside `index.html`, so a
browser holding an old copy of that file is holding an old copy of the entire
dashboard — and it reads exactly like stale data from the sheet, which is the wrong
place to go looking. Without this header, every deploy stays invisible to anyone who
does not happen to hard-reload.

`no-cache` does not mean "do not store". The browser still keeps the file and still
asks whether it changed, so an unchanged page costs a 304 and no download. `/api` is
deliberately left alone: `api/data.js` sets its own caching.

`qa.js` checks all of this — that the file parses, that no rule carries a key the
schema would reject, that both cache rules survive, and that the CSP still allows the
page to call its own API.

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

**Overall -> KPI meter** puts the three halves on one screen: a card per team with a
compliance dial, a business dial and a module adoption dial.

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

Module adoption is the third dial — see **Module adoption** below.

Below the three dials, each card carries an **escalation line**: how many are open on
that team's clients, and which clients they are — a count alone just moves the
question along. It is deliberately not a third dial. A count of live problems has no
denominator, and a progress bar would invite reading "2 of 5" into it. Teams with
nothing open read "None open", with any earlier ones noted quietly. If the
escalation sheet fails, the line reads "not loaded" rather than zero, so no team is
wrongly marked clean.

    const NO_BOOK_TEAMS = ['Sagar Mishra'];

Teams listed there carry no client book, so they are not measured on business at all
— left off both the **Business** tab and the **KPI meter**. A ₹0 against a ₹50L
target reads as "failed ₹50L of business" when the truth is "was never carrying a
book", and on the meter a 0% dial says "failed" when it should say "not applicable".

They are untouched everywhere compliance is measured: the scorecard and the daily
boards score their people exactly like everyone else. Both views say who is left out
and why, so the totals are not read as covering the whole team.

Each card has an **(i)** button. It opens under that card and answers the question
the number provokes — the rule in one sentence, then the arithmetic for that team,
then **every date each member missed**, split by tracker. The counts and the dates
come from the same `scoreRows()` call that drew the dial, so the explanation cannot
disagree with the figure it explains. One panel opens at a time: several expanded
cards push the rest off screen and the grid stops being comparable.

**The three are not blended into one score.** Compliance is this month's behaviour,
business is the standing book, adoption is last quarter's product usage; a team can be
filing perfectly and still be far short on revenue, and a single averaged figure hides
exactly the case worth looking at. All three use the same no-rounding-across-100 rule
as the book table.

## Module adoption

The third dial: of the modules that apply to a team's clients, how many are actually
in use. Source is the **ERP Usage Score** workbook, one tab per RM per quarter, each
holding the raw scorecard — a client per row, a module per three columns.

### Count the grid, never the Total column

Each module occupies three columns: a score, a grade, and a spare. Only the score
carries information — the grade is `1`->A and `0`->C with nothing added, and the third
column is always empty. A blank score means the module was never sold to that client
and is excluded from both sides of the ratio; a `0` means sold and unused, and counts
against it.

The sheet computes its own `Total` as "13/17", and that column **must not be parsed**.
Excel has coerced most of them to dates, and not consistently between tabs — one
sheet's "3/10" became 3 October, another's became 10 March. Worse, "0/1" degenerates
to 2000-01-01, which reads back as a perfectly plausible 1/1 and would score four
clients at 100% when the truth is 0%. Counting the grid avoids all of it, and agrees
with the sheet's own `Percentage` column on every row.

The parser refuses any row claiming more modules adopted than apply to the client.
That is arithmetically impossible and is the exact signature of the corrupted Total
column being pasted in, so it rejects the sheet and names that column in the error
rather than rendering a dial above 100%.

### The book decides who owns a client

A client is scored on whichever RM's tab the person doing the work happened to use,
and that is **not** the same as who owns the account — fourteen of the current rows
sit on a different tab than the client book assigns them to, following the assistant
rather than the owner. Ownership comes from the book. The tab is kept only so the
card can name where a disagreement came from, and both sides show it: the owning team
lists the client under "scored on a different tab", and the tab's team sees it listed
as belonging to someone else. Neither is silently resolved.

### Coverage is part of the number

A dial computed only over scored clients looks complete when it is not. Every card
therefore carries a **Scored** line — "15 of 19 clients" — and when a team's book is
not fully scored it turns red and names the revenue behind the gap. The (i) panel
lists every never-scored client with its billing, and says plainly that they are
excluded from the percentage rather than counted as zero. Scoring an unassessed
client as zero would make a team that has simply not been measured look like it is
failing.

As of Quarter I this matters a great deal: 37 of 148 clients were never scored, and
they skew to the largest accounts — only 3 of the top 10 by revenue appear, so the
figures describe 59% of the book.

### The target is a placeholder

    const ADOPTION_TARGET = 0.80;

Compliance has an obvious target (100% — every entry filed) and business has an agreed
one (₹50L). Adoption has neither yet, so this number is asserted rather than derived,
and both the card and the meter note say so. Change it in `index.html` once the
business agrees one.

### Where the data lives

The workbook keeps one tab per RM per quarter as the working and audit layer. The
dashboard reads a single derived **stacked** tab instead — `RM, Quarter, As Of,
Client, Ownership, Modules Adopted, Modules Applicable, Adoption %` — because parsing
a 119-column two-header-row sheet over CSV, once per RM, is a great deal of fragile
surface for no gain.

Publish that tab **on its own** (File -> Share -> Publish to web, pick the tab, not
Entire Document) and set the resulting link — it will carry `gid=` and `single=true` —
as `ADOPTION_CSV_URL` in Vercel -> Settings -> Environment Variables. Publishing the
entire document serves whichever tab happens to be first, which is a raw per-RM tab,
and would silently change if the tabs are ever reordered.

`api/data.js` deliberately ships **no default URL** for this source. An empty one is
refused with an explanatory error rather than falling through to the tab hunt, which
searches the tracker spreadsheet and would happily return a timesheet export under the
adoption name.

Until the link is set, the page reads `ADOPTION_FALLBACK` — a snapshot compiled into
`index.html`, dated by `ADOPTION_FALLBACK_ASOF` — and the (i) panel says which it is
reading. A stale quarterly figure and a live one look identical otherwise.

### Names that do not match

    const ADOPTION_ALIAS = { 'cambridge': 'Cambridge Delhi', ... };

Same idea as `ESC_ALIAS`: where the scorecard spells a client differently from the
book, map it here on evidence rather than resemblance. Anything that still does not
resolve is **named on the meter note** rather than dropped, because an unmatched
client is revenue counting towards nobody.

## Client book

The **Business -> Client book** tab shows who owns what: revenue by RM with each one's
share of the total, then every client with its owner, type, size band, billing for the
financial year and escalation status, filterable by owner and by institution type.

Every column of the client list sorts — click a header, click again to reverse, and
the choice is remembered. Two of them need more than an alphabetical compare:

- **Size** is a band, not a word. It sorts Large > Medium > Small; alphabetically
  that would read Large, Medium, Small on the way down and Large, Medium, Small on
  the way up, which is neither order anyone means.
- **Escalations** ranks open above resolved above none. A client with no escalation
  is not a client with zero, so those sink whichever way the column points — the same
  rule the scorecard uses for exempt cells.

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

Ankush Rana owns clients with no team recorded, and his row says so rather than
hiding it.

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

### This one comes from a published sheet

The book is fetched live like the trackers, but by a different route. "CS Team
Plan.xlsx" is an *uploaded* .xlsx, and Drive only runs `/export?format=csv` on
Docs-editor files — so the usual trick has nothing to serve. **File -> Share ->
Publish to web** sidesteps that: Google renders any chosen tab as CSV at a
`/d/e/2PACX-.../pub` URL whatever the source format. `api/data.js` holds that URL
as the `book` source and fetches it directly, skipping the tab hunt, since the
publication link already names the tab.

Two things follow from that, and both bite quietly:

- **Publishing is separate from sharing.** Someone can un-publish without touching
  a single permission, and the file will still look correctly shared. Re-publishing
  can also mint a fresh link. Set `BOOK_CSV_URL` in Vercel to repoint it without a
  code change.
- **Google caches published output** for a few minutes. A change you just saved may
  need a refresh or two to appear. The tab says so, so nobody concludes the feed is
  broken.

### If a few minutes is too slow

It is worth being precise about where the delay is, because most of the obvious
fixes address the wrong layer. The page appends `&t=` to every call, so Vercel's
edge cache never serves the book; `api/data.js` appends `_=` to its Google request,
so nothing between Vercel and Google serves it either. What remains is inside
Google: published output is regenerated on Google's own schedule, and no request
shape reaches past that. **Publish-to-web cannot be made real-time.** If the sheet
has to be current to the second, the transport has to change.

The route that does give it: the workbook is shared *anyone with the link — Viewer*,
so `api/data.js` can download the raw `.xlsx` bytes from Drive with no credentials
and parse the Clients sheet server-side. That reads the live file with no
publication and no publish cache in the way. The cost is a dependency — reading
`.xlsx` means SheetJS, so this repo gains a `package.json` and an install step on
deploy, where today it has neither. Worth it only if minutes genuinely hurt.

Only *numbered* rows are taken. Below the client block there is scratch — two
internal "Daily work track" rows, a stray duplicate, and prospect notes sitting in
the wrong columns — and none of it carries a `Sr No.`. Filtering on the client name
alone pulls that in and inflates the total by ₹1L. `parseBook` filters on the
number, and the suite replays the scratch through it to prove it stays out.

Money has three cases that are easy to collapse into two. A figure is a number;
` ₹ - ` is a real zero; ` - ` is a cell nobody filled in and stays `null`. Reading
the third as zero invents a client that bills nothing.

### When the publication fails

`index.html` still carries a `CLIENTS_FALLBACK` array — the book as of its
`CLIENTS_FALLBACK_ASOF` date — and drops back to it if the fetch fails, so an
expired publication does not take down a dashboard whose compliance half owes the
book nothing.

A stale book that looks live is worse than no book, so the fallback is loud: the
tab turns to a warning, says **LIVE BOOK UNAVAILABLE**, names the snapshot date and
prints the underlying reason. If you ever see that, the numbers below it are frozen.

The fallback doubles as the test fixture — `qa.js` re-encodes it as CSV in the
sheet's own shape and serves that as the published sheet, so the parser is tested
against real data and a round trip that must come back unchanged.

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

415 assertions with the network mocked: parsing (spacer rows above the header, quoted
fields containing commas and newlines, blank assignees, case-variant names), every
failure path (sheet not shared, network down, unparseable content), the date-window
rules, cross-checks between the three places misses are counted, escaping of sheet
content, the branding and embedded logo, the page title and metric grouping, the monthly scorecard and its CSV export, the coverage warning firing only for a month that really is outside the data, scorecard sorting (every column, both directions, exempt cells sinking, CSV matching the screen), the remembered view mode, range, tab and sort order, hidden people leaving no trace in any count while exempt people keep their row, the client book tab and its filters, the book column sitting beside compliance without altering it, lakh/crore formatting, pod resolution from first names with every failure reported on the page, the KPI meter (all three dials, degenerate rosters, and an invariant that meter compliance equals the pooled scorecard rows team by team), static hygiene (no duplicate ids, no dangling $() references, nothing declared and never used), the (i) panel agreeing with its dial down to the date count, and a sweep over every tab checking that what should be hidden is hidden in computed style rather than merely flagged, the source switch, the combined roster, per-tracker exemptions, the three view modes and their persistence, Sunday handling in Today/Yesterday, module adoption (a CSV round trip through the compiled snapshot, scratch rows dropped or reported but never counted, the team totals reconciling to the matched rows so nothing is double-counted or lost, ownership taken from the book rather than the tab with both sides of each disagreement named, coverage stated on every card, unscored clients excluded rather than zeroed, and three failure paths — an impossible score above its own denominator, a raw per-RM tab published by mistake, and an empty sheet — each falling back to the snapshot with the reason shown),
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
