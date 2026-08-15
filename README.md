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

    ┌──────────────────────┬────────────────────────────────────────┐
    │ Okie Dokie           │  <- eyebrow                            │
    │                      │  Compliance and business.  <- headline │
    │ CS Team KPI          │  lede                                  │
    │ Team metrics, …      │  ┌──────────────────────────────────┐  │
    │                      │  │ months  skip-days      Refresh   │  │
    │ COMPLIANCE           │  └──────────────────────────────────┘  │
    │  Internal team calls │  ┌───────────┐ ┌───────────┐           │
    │  Client calls        │  │ team card │ │ team card │           │
    │  Scorecard           │  └───────────┘ └───────────┘           │
    │ BUSINESS             │                                        │
    │  Client book         │                                        │
    │ PRODUCT              │                                        │
    │  ERP module adoption │                                        │
    │ VOICE                │                                        │
    │  Client feedback     │                                        │
    │ ────────────────     │                                        │
    │ OVERALL              │                                        │
    │  KPI meter           │                                        │
    └──────────────────────┴────────────────────────────────────────┘

The five groups used to sit side by side on one horizontal rule above the content,
under a 64px page title. That cost roughly 350px of height before a single figure
appeared, and it put **Overall** at the far right of a row of peers when it is not a
peer — it is where the four beside it land. In the rail each label sits over its own
tabs, Overall is pinned to the foot behind a rule, and the first card starts near the
top of the window.

The rail is 264px. Below 1000px there is no room for it beside a card grid, so it
returns to the top of the page and lays the groups out along a row again; Overall
loses its pin there, because a row has no foot to pin it to.

The page title and the group labels never change. The headline in the content column
does — it names the view you are in. A second family of metrics is a second `.group`
block in `index.html` with its own label and its own tabs; nothing else has to move.

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
`?src=internal`, `?src=client`, `?src=escalations`, `?src=book`, `?src=adoption`,
`?src=feedback` or `?src=implementation`, fetches the matching sheet server-side and
hands back raw CSV. The first three are Google Sheets fetched by id with the right tab
discovered by its columns; `book`, `feedback` and `implementation` are published-to-web
CSVs fetched by their full URLs; `adoption` fetches several tabs by name and returns
them together. The browser only ever talks to your own domain, so cross-origin
restrictions never apply — which is why this is a function and not a direct `fetch` to
Google.

Everything else is read live and parsed in the browser. Responses are cached at
Vercel's edge for 5 minutes. The one thing that *is* stored here is the tracker
archive — see below, and note what it means for a public repository.

## The archive, and why it exists

The Asana → Sheets sync keeps roughly the **last 500 tasks** and drops the oldest
to make room. That is a rolling window, not a history. It is fine for the daily
boards, which only ask about the last few days, and fatal for the monthly
scorecard: once July's rows fall out, July stops reading as a month that was
filed and starts reading as a month of missed days. The figures stay confident
and become wrong.

So `scripts/archive.js` runs on a schedule, reads the same two sheets the
dashboard reads, and writes every `{person, due date}` it sees into
`archive/<tracker>/<month>.json`. Entries already recorded are left alone, so a
re-run is free and adds nothing; the files only ever grow. The page then reads
those files back alongside the live fetch and uses them for any date the export
no longer reaches, so a month rescued from the archive is scored from what was
captured while it was still there.

**Daily, not monthly.** The window is measured in rows, not in time — a busy
fortnight can push a month out well before that month ends, and a run scheduled
after the rows are gone has nothing left to save.

**One parser, not two.** The archiver does not reimplement the CSV parsing. It
lifts `parseExport()` (and the three helpers it needs) straight out of
`index.html` and runs them as-is, because a second parser is a second set of
rules about headers, spacer rows, quoted names and blank assignees — and the
moment the two disagree the archive stops describing what the dashboard would
have shown. If those functions are ever renamed or reshaped, the archiver throws
at the top of the run rather than quietly saving nothing, since an archive that
silently stops growing looks exactly like a quiet month.

**Live data always wins.** Archived rows only fill dates the live export no
longer covers, keyed on person + due date, so a month present in both is never
double-counted.

    ARCHIVE_FROM = '2026-07'      // in index.html — nothing to fetch before this

Backfill or re-run by hand from the Actions tab (**Archive tracker entries** →
Run workflow), or locally with `node scripts/archive.js` — add `--dry-run` to see
what it would write without writing it.

> **This repository is public, and the archive contains employee names against
> the dates they did and did not file.** That is per-person compliance history,
> readable by anyone with the URL, and it does not age out the way the Asana
> window does. Before the first run, decide whether that is acceptable — the
> alternative is making the repository private (the dashboard reads the archive
> over its own domain, so a private repo with the same Vercel deployment serves
> it exactly the same way).

**The sheet must be readable without signing in.** In the sheet: Share → General
access → **Anyone with the link → Viewer**. Without that, Google returns a login page
and the dashboard shows an error explaining exactly this.

The page is public, so anyone with the URL sees the data. `vercel.json` sets
`noindex, nofollow` to keep it out of search results, but that is not access control.
For real restriction: Project → Settings → **Deployment Protection** → Vercel
Authentication.

### Pointing at a different sheet or tab

Project → Settings → Environment Variables: `SHEET_ID` / `SHEET_GID` for the internal
tracker, `CLIENT_SHEET_ID` / `CLIENT_SHEET_GID` for the client one, `BOOK_CSV_URL` and
`FEEDBACK_CSV_URL` for the two published CSVs, `ADOPTION_SHEET_ID` for the usage-score
workbook. No code change needed. Defaults are in `api/data.js`.

Republishing a sheet can mint a new link, so if a published source starts failing,
check the URL before anything else — the error on the page names the variable to set.

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

**Overall -> KPI meter** puts the four measures on one screen: a card per team with a
compliance dial, a business dial, a module adoption dial and a client feedback dial —
side by side, never blended. Adoption and feedback are both averages over whichever
clients have been measured, and neither dial can show its own denominator — that
figure lives in the (i) panel behind each dial rather than as a row of its own on the
card (see **Coverage is part of the number**, and **Client feedback**, below).

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

Business is the standing book against the target. `BOOK` — the per-team totals behind
that dial — is rebuilt every time `CLIENTS` changes. It was a parse-time `const` until
5 Aug, which meant it captured the compiled snapshot and the live book never reached
it: the dial showed the day the snapshot was cut while the client book tab showed
today, and nothing on screen compared the two. The adoption card now prints the same
team's book total beside it, and `qa.js` asserts the two agree on every card.

### Retention and implementation

Under the business dial sits a **Mix** line: how many of the team's clients are
retention against how many are implementation, and the book split the same way —
"14 retention · 5 implementation" with both totals beside it. Not a fifth dial:
there is no target either half is chasing, and a dial would invite reading "more
retention is better" into a number that says no such thing about a book that is
supposed to carry both. It is a composition of the business figure above it, not a
score of its own, so it gets a line the way adoption's coverage does, not a track.

The source is the client book's own **Retention/Imp** column, added by hand
alongside Team. Matched on the stem rather than the whole word — `Imp` is the
obvious abbreviation and the sheet has used it — so `bookKind()` reads "Retention"
and "Implementation" the same as it reads "Ret" and "Imp". A client the column
does not label is left out of *both* sides of the split, the same rule adoption
uses for a never-scored client: counting it as either would invent an answer the
sheet never gave. The card's Scored line and this one can therefore name different
denominators — one is "how many clients have a module score", the other is "how
many have a retention/implementation label" — and both are correct about what they
each measure.

Money and headcount are shown separately because they can disagree, and did the
first time this was checked: a team can be one-third retention by client count and
half-and-half by revenue, which is a different fact about the book each way, so one
number does not stand in for the other.

The revenue half is also drawn, not just stated — a two-segment bar under the
count line, each segment carrying its own rupee figure printed inside it. That
was the point of putting it there rather than in the small grey text a coverage
line uses for its own figure: at a glance the split reads as *this much orange,
this much gold*, and the number confirms what the eye already saw instead of
being the only way to know it.

Segment width comes straight from the two revenue figures as flex-grow weights,
so there is no separate percentage to compute or keep in sync with the label —
whatever `inr()` prints is the same number sizing the segment. The one thing
that needed checking rather than assuming: a lopsided split, tested at 99
one-thousand-rupee clients against a single ₹50L one. Flexbox's ordinary
`min-width:auto` turned out to already be the right behaviour with no extra
CSS — each segment claims at least its own label's width before any of the
grow ratio is applied, so the ₹99,000 side survives at 1/500th the revenue of
the other rather than being squeezed to nothing.

The (i) beside the line opens to the same panel as every other row — the split
named again with the count and the money side by side, and, when the book has no
such column at all (the compiled fallback predates it), a line saying there is
nothing to split rather than a silent 0/0.

Below that, each half gets its clients named — added 16 Aug 2026, on request, so
"38 retention" is a list you can read, not just a number to trust. Same
`clientMoney`/`longList` pair every other named list in this dialog already uses
(Never scored, Not heard from): largest billing first, six shown, the rest behind
"Show all N clients" rather than dumped — a team with forty retention clients would
otherwise bury the implementation section right under it, which is the exact
failure this dialog was rebuilt to stop doing (see **The (i) dialog was
unreadable**, below). The names come from the same `CLIENTS` array the stats above
are counted from, filtered on the same `k` field, so a client can never appear in
the list without being counted in the number, or the other way round.

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

Each card has an **(i)** button. It opens a dialog over the grid and answers the
question the number provokes — the rule in one sentence, then the arithmetic for
that team, then **every date each member missed**, split by tracker. The counts and
the dates come from the same `scoreRows()` call that drew the dial, so the
explanation cannot disagree with the figure it explains.

It used to expand under its own card, on the reasoning that an RM wants their dates
beside their number. With four dials the content outgrew that: the panel pushed
every card below it off screen, so the comparison it was protecting was lost anyway.
The dialog is filled by copying the card's own hidden panel markup — one source for
the content, so what is read in the dialog is by construction what the card
computed. Escape, the backdrop and the close button all shut it, focus returns to
the button that opened it, and any re-render closes it rather than leaving stale
arithmetic on screen.

**Every row has its own (i) as well.** The card button opens the panel at the top;
the small button beside each parameter — compliance, business, module adoption,
scored, client feedback, heard from, escalations — opens the same dialog scrolled to
the section that explains that one row, with the heading it landed on marked. There
is one panel and one set of arithmetic; these are entry points into it, not a second
copy. Clicking another row of a card that is already open re-aims rather than
closing, so reading a card's sections in turn is four clicks and not eight.

A row button is only drawn when the section behind it exists — a team with nothing
escalated has no escalations section and so no escalations (i). `renderMeter()`
builds the panel first and checks it, which is the only way that guarantee holds as
sections come and go. Business had no section at all until this went in: it is the
one figure on the card whose two inputs are invisible there, because the book is a
dated snapshot and the target is not the same number for every team once the scaled
option is on. It says both.

Adding a control to each row cost about 20px, which is enough to break
"4.0/5 from 2 clients" in a 300px column. So every row on a card now wraps the same
way: the label and the figure stay together on one line at any width, and the muted
right-hand detail drops to a line of its own rather than the value being squeezed
into a break mid-phrase. That is what "36 of 48 / clients" was — the value losing to
the money beside it.

**The four are not blended into one score.** Compliance is this month's behaviour,
business is the standing book, adoption is last quarter's product usage; a team can be
filing perfectly and still be far short on revenue, and a single averaged figure hides
exactly the case worth looking at. All three use the same no-rounding-across-100 rule
as the book table.

## Names, and the day

Two things that look like data problems and are not.

**One spelling per person.** Asana sends the same person under different casing row
to row, and the roster used to keep whichever spelling arrived first — which is how a
lowercase name reached the boards while the client book showed the proper one. The
roster now prefers a hand-typed spelling where one exists (`PODS`, or the book's
`Team` column), and otherwise the best-cased spelling Asana actually sent. It chooses
between observed spellings and never invents capitals: names here are not title-case
("MPPS School kkr", "IsharJyot", "SA Jain (PG) College + AIMT") and title-casing at
ingest would mangle them.

The owner filter on the client book was never affected by this. Its options are built
from the same `CLIENTS` strings it compares against, so a selection cannot return
nothing — `qa.js` now asserts that too.

**The day is re-read, not remembered.** `iso()` reads local date parts, so the date is
right in whatever timezone the viewer is in, and the suite runs in three of them. What
went stale was the *moment*: `CHASE_DAY` was computed once at load, so a dashboard left
open across midnight kept calling yesterday "Today". It is now re-checked when the tab
is looked at again, on focus, and on a slow timer — the same captured-once mistake
`BOOK` made.

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

**This is the RM's team score.** Ownership comes from the `Team` column of the client
book and from nowhere else.

A client is scored on whichever RM's tab the person doing the work happened to use,
and that is not the same thing. Assistants move between RMs, so the tab tracks who did
the typing, not who carries the account — fourteen of the current rows sit on a tab
that disagrees with the book. The scorecard's own "Client Ownership" column has the
same problem: it holds an assistant's first name and a counter ("Priya 3"), not an RM.
Both are ignored.

The tab name is still carried on each row as `rm`, for provenance only. Nothing reads
it, and nothing should — attribution by tab would move a client between teams whenever
the work was shared out differently.

### Coverage is part of the number

A dial computed only over scored clients looks complete when it is not. Every card's
(i) panel therefore carries a **Scored** figure — "15 of 19 clients" — and when a
team's book is not fully scored, a **Never scored** section beneath it lists every
missing client with its billing, and says plainly that they are excluded from the
percentage rather than counted as zero. Scoring an unassessed client as zero would
make a team that has simply not been measured look like it is failing.

This sat as its own row on the card until 16 Aug 2026, alongside a matching **Heard
from** row for feedback coverage; both moved into the panel only, on request — the
card face is a dial's worth of numbers now, and "how many were scored" travels with
the rest of the adoption arithmetic it was always part of rather than standing apart
from it. Nothing about the figures changed, only where a reader finds them.

As of Quarter I this matters a great deal: 37 of 148 clients were never scored, and
they skew to the largest accounts — only 3 of the top 10 by revenue appear, so the
figures describe 59% of the book.

### The target is a placeholder

    const ADOPTION_TARGET = 0.80;

Compliance has an obvious target (100% — every entry filed) and business has an agreed
one (₹50L). Adoption has neither yet, so this number is asserted rather than derived,
and both the card and the meter note say so. Change it in `index.html` once the
business agrees one.

### The ERP module adoption tab

Its own tab under a **Product** group — adoption is neither this month's behaviour
nor the standing book, so it sits beside them rather than inside either. Five
sections, in this order:

1. **Where it stands** — two dials, not one. Overall modules in use, and beside it how
   much of the book that describes. The first without the second is how a partial
   exercise starts being read as a complete one.
2. **By module** — every module against the clients it applies to, weakest first. This
   is the cut that can be acted on centrally: a module at 0 of 52 is one conversation
   with the product, not fifty-two with RMs.
3. **By team** — the same arithmetic as the KPI meter dial, with the scored column
   beside it, because a team that scored half its book is not comparable to one that
   scored all of it.
4. **Every scored client** — weakest first, with how many modules apply to each, since
   30% of three modules and 30% of thirty are different problems.
5. **Never scored** — the clients no figure on the page describes, largest billing
   first.

The month picker and the joined toggle are hidden here. Neither changes a single
figure on this tab, and offering a control that does nothing implies the numbers
respond to it.

### The module grid, and why it is compiled in

Each client row carries `m`, a mask over `ADOPTION_MODULES` — one character per
module, `1` adopted, `0` applicable but unused, `-` not sold to that client. The whole
grid for 111 clients across 43 modules costs about 8KB, and it is what lets the page
answer "who has not taken up X" rather than only "how is this team doing".

Masks come from whichever source the rows came from — live tabs or the compiled
fallback — so the module table and the totals can never describe different data. `s`
and `a` are derived from the mask and never stored beside it; two copies of the same
fact drift.

Anything the parser has to skip — a cell that is neither 0, 1 nor blank, a client whose
Percentage column disagrees with its own grid, a scored client the book has never heard
of — is **named on the page**. A row quietly dropped is a client nobody is counting.

### Where the data lives

The workbook keeps one tab per RM per quarter as the working and audit layer. The
dashboard reads a single derived **stacked** tab instead — `RM, Quarter, As Of,
Client, Ownership, Modules Adopted, Modules Applicable, Adoption %` — because parsing
a 119-column two-header-row sheet over CSV, once per RM, is a great deal of fragile
surface for no gain.

The dashboard reads those raw tabs directly. No derived tab, no publishing, and
nothing to send anyone each quarter.

    /gviz/tq?tqx=out:csv&sheet=Q1%20Mansi%20Rana

gviz serves any tab of a **native** Google Sheet as CSV given its *title*. So the page
takes the RM names it already has from the client book, builds `Q<n> <RM full name>`,
and asks for those. `api/data.js` tries Q4 down to Q1, stops at the first quarter any
tab answers for, and returns the blocks concatenated behind `#### TAB:` markers — one
response and one cache entry however many tabs there are.

**The naming rule is the whole contract.** A tab must be `Q2 Mansi Rana`, spelled as
the client book spells that RM. Get it wrong and the tab is not found; the page names
what it looked for rather than quietly showing five RMs out of six.

Two conditions, both true of "ERP Usage Score": the workbook is a native Google Sheet
(gviz will not serve an uploaded `.xlsx` — this is why the client book had to be
published instead), and it is link-shared as Viewer. Point at a different file with
`ADOPTION_SHEET_ID`. The file id is fixed server-side and only tab *names* come from
the client, so a crafted name can at worst name a tab that does not exist.

Adding Q2 is: create six tabs, name them `Q2 <RM>`. Nothing else.

If every quarter comes back empty the page falls back to `ADOPTION_FALLBACK`, the
Quarter I grid compiled into `index.html` and dated by `ADOPTION_FALLBACK_ASOF`. That
is a real quarter rather than an empty state, so every figure stays true, just dated —
and the page says which of the two it is reading, because otherwise they look
identical.

### Names that do not match

    const ADOPTION_ALIAS = { 'cambridge': 'Cambridge Delhi', ... };

Same idea as `ESC_ALIAS`: where the scorecard spells a client differently from the
book, map it here on evidence rather than resemblance. Anything that still does not
resolve is **named on the meter note** rather than dropped, because an unmatched
client is revenue counting towards nobody.

## Client feedback

**Voice -> Client feedback** is the only source on this dashboard the CS team does
not write. Calls, book and adoption are all our record of our own work; this is the
client saying whether any of it landed. It comes from the **Okie Dokie Feedback
Form**'s own responses tab, published to the web as CSV and read as `?src=feedback`.

Four of the form's questions become measures: support quality, overall satisfaction
(1-5), whether they would recommend, and — the one the CS team actually controls —
how many of its clients have answered at all.

### Coverage is the first number, not the last

The tab leads with how much of the book has been heard from, and the satisfaction
score comes second. That order is deliberate. A satisfaction average can be improved
by asking fewer people, which is the one thing this measure must never reward, and a
large green percentage at the top of the page is read as the finding no matter what
the note underneath it says.

Clients who have not answered are left out of every average rather than counted as
dissatisfied. Silence is not a bad review. They are all named at the foot of the tab,
largest first, for the same reason the never-scored clients are named on the adoption
tab: excluding them is only defensible if the page says who they are.

### Thin samples are marked, and never go green

Below three responses a team's average is a couple of opinions, not a measurement.
The figure still shows — hiding it is its own distortion — but it is labelled
**thin**, the dial does not read as target met however warm the replies, and the team
table is sorted by coverage rather than by score so one happy reply cannot outrank
twelve mixed ones.

The 80% target (4 out of 5) is a placeholder, exactly like the adoption one. Nobody
has agreed it and the page says so.

### The institution field is the weak link

Every other join on this page is between two of our own sheets. This one matches on
an institution name the respondent typed themselves, so a client can answer under a
spelling the book does not have — and then their feedback counts towards nobody. Those
names are listed on the tab and on the KPI meter; map one to its client in
`FEED_ALIAS` in `index.html` when you know the two are the same, and never because
they merely look similar.

**Fix this at the source if you can.** Make the institution question a dropdown fed
from the client list rather than free text. That removes the whole class of problem,
and it is the difference between feedback that can be attributed to an RM and feedback
that cannot.

### One client, one voice

A client that answers repeatedly counts once, through its most recent response —
otherwise an institution that fills the form monthly outvotes ten that answered once.
Every submission is still listed on the tab, with the superseded ones marked, because
a score that moved is the most useful thing this sheet can tell you.

### Nothing is scored as zero when it is absent

A blank answer, an option this page does not know, a row naming no institution, a
satisfaction score outside 1-5 — each is reported on the page and left out of the
arithmetic. With a sheet this small, quietly turning a non-answer into a bad score
would move a team's number more than the real answers do. Answer options are listed
in `SUPPORT_SCALE`, `RECO_SCALE` and `EFFICIENCY_SCALE`; add to them when the form
gains an option, and the page will name any it meets in the meantime.

Timestamps are read day-first, which is what the sheet uses. A row whose second field
is over 12 is month-first, and it is corrected and reported rather than silently
believed.

### There is no compiled fallback, deliberately

The book and the adoption grid both fall back to a snapshot built into the page when
their sheet fails. This one falls back to nothing and says why. A snapshot of what
clients think ages in a way a client list does not, and the two test submissions
currently in the sheet, baked into the page, would read as findings.

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

630 assertions with the network mocked: parsing (spacer rows above the header, quoted
fields containing commas and newlines, blank assignees, case-variant names), every
failure path (sheet not shared, network down, unparseable content), the date-window
rules, cross-checks between the three places misses are counted, escaping of sheet
content, the branding and embedded logo, the page title and metric grouping, the monthly scorecard and its CSV export, the coverage warning firing only for a month that really is outside the data, scorecard sorting (every column, both directions, exempt cells sinking, CSV matching the screen), the remembered view mode, range, tab and sort order, hidden people leaving no trace in any count while exempt people keep their row, the client book tab and its filters, the book column sitting beside compliance without altering it, lakh/crore formatting, pod resolution from first names with every failure reported on the page, the KPI meter (all three dials, degenerate rosters, and an invariant that meter compliance equals the pooled scorecard rows team by team), static hygiene (no duplicate ids, no dangling $() references, nothing declared and never used), the (i) panel agreeing with its dial down to the date count, a per-parameter (i) on every dial and coverage line that names a section the panel actually contains and none where it does not, aiming and re-aiming the dialog without closing it, and the coverage figure being forbidden to break mid-phrase, and a sweep over every tab checking that what should be hidden is hidden in computed style rather than merely flagged, the source switch, the combined roster, per-tracker exemptions, the three view modes and their persistence, Sunday handling in Today/Yesterday, module adoption (a CSV round trip through the compiled snapshot, scratch rows dropped or reported but never counted, the team totals reconciling to the matched rows so nothing is double-counted or lost, ownership taken from the book rather than the tab with both sides of each disagreement named, coverage stated on every card, unscored clients excluded rather than zeroed, and three failure paths — an impossible score above its own denominator, a raw per-RM tab published by mistake, and an empty sheet — each falling back to the snapshot with the reason shown),
client feedback (the form's questions found by fragment rather than by position, one
client's repeat submissions collapsing to the latest while both stay visible, an
institution outside the book counted towards nobody and named, an unknown answer
option and an out-of-range score reported rather than scored, coverage taking the
whole book as its denominator, teams ordered by coverage rather than by score, thin
samples marked and never reading as target met, the never-answered table matching
exactly the clients with no response and ordered by real revenue, and a failed sheet
leaving an empty tab that says why rather than an invented figure), a sweep that
clicks every tab in every group and checks the view actually moved — the bug that
found, 5 Aug, was a group added to the render list but not to the click wiring, which
renders perfectly and does nothing —
the navigation rail (every tab inside it, the content column outside it, Overall
last, and static checks for the column direction, the pin that holds Overall at the
foot and the narrow-window rule that puts the horizontal strip back), inverted date
ranges, and timezone independence. Run them after any change to the parser — the
Asana form fields are expected to change once back-dated entries are blocked.

## Known limitations

These are open, not fixed:

- **Only people present in the sheet are visible.** Someone who has never filed does
  not appear at all — no row, not counted, absent from the chase list. This is the
  biggest gap. A fixed roster would fix it.
- "Never missed a day" counts anyone with a clean sheet, including someone whose first
  entry is the last day of the range. Read it alongside the Filed column.
- Public holidays and leave are not modelled. Both read as missed days.

### Two tests that had rotted on the calendar

Both were failing on the untouched file before this change, and neither was a defect
in the page:

- **"changing To re-renders"** set the To field to a hardcoded `2026-08-07`. That was
  forward of the default range when it was written and stopped being forward on 7 Aug
  2026, at which point the test quietly stopped testing anything and then failed. It
  now steps forward from whatever To currently holds.
- **"crossing midnight moves the day on"** winds the clock forward 24 hours. Run on a
  Saturday that lands on Sunday, `todayWorking()` correctly walks back to the
  Saturday, the day does not move, and the test failed — every Saturday, for a page
  behaving exactly as specified. It now steps over Sunday.

Worth the general note: a date literal in a test has an expiry date on it.


## A failed book was only loud on its own tab

Found 8 Aug 2026 while checking a "sheets not loading" report.

When the published client book fails, `CLIENTS` falls back to the compiled snapshot
and `CLIENTS_ASOF` quietly becomes the snapshot's date. The client book tab shouted
about it correctly — `LIVE BOOK UNAVAILABLE`, in red, with the reason. Nowhere else
did. The business dial on the KPI meter, its (i) section, and the scorecard's Book
and Team columns all showed snapshot money, and the (i) panel's "as at 3 August 2026"
read as a deliberate as-of rather than as a failure.

That is the same shape as the stale-`BOOK` bug of 5 Aug — a plausible, dated, wrong
number — arriving through a different door. The notice was in the right place for
whoever wired the book up and the wrong place for whoever reads the meter.

All three now say it, in the wording the adoption section already used for its own
fallback. The scorecard's version separates the two halves explicitly, because a
failed book does not touch compliance and the note must not imply it does. A working
book still says nothing anywhere: a warning that is always on is a warning nobody
reads, and qa asserts the silence as well as the noise.

### Which sheet is not loading

`qa.js` cannot answer this — it mocks the network, so it tests what the page does
*with* a failure, never whether one is happening. The live answer is in the API,
which returns either CSV or a JSON body carrying `error`, `hint` and `attempted`:

    /api/data?src=internal
    /api/data?src=client
    /api/data?src=book
    /api/data?src=escalations
    /api/data?src=feedback
    /api/data?src=adoption&rms=Mansi%20Rana,Kashish%20Goel

Adoption needs the `rms` parameter — the page sends it from the client book, and an
empty list is itself reported rather than guessed at.

Before chasing any of it, hard-reload. Browser caching on this repo has looked like
a data problem three times now.


## "Dhanna Bhagat Public School is in the escalation sheet but not on Mansi's card"

Reported 8 Aug 2026. The escalation was real, Mansi's ownership was real, and the
page was working exactly as written — which is the problem.

The client book spells it **Dhanna Bhagat School**. Asana spells it **Dhanna Bhagat
Public School**. Escalations resolve to a client by exact normalised name, and
failing that by a prefix test — one name running on from the other, which is what
catches "Vedashree" against "Vedashree School" and "SA Jain (PG) College" against
"SA Jain (PG) College + AIMT". Here the extra word is in the *middle*:

    dhannabhagatschool          <- book
    dhannabhagatpublicschool    <- Asana

Neither is a prefix of the other, so nothing matched, so the escalation belonged to
no client and therefore to no team. `ESC_ALIAS` now carries the pair.

Two things made this worse than a one-line spelling fix.

**The alias lookup was by exact string.** `ESC_ALIAS[e.client]` meant a difference in
case, punctuation or a stray space decided whether a hand-written alias fired at all
— which is how the MSG entry stopped working when Asana changed which string came
through. Aliases are looked up normalised now. That loosens nothing: an alias still
requires a person to write the pair down by evidence.

**The failure was silent where anyone would notice it.** `ESC_UNMATCHED` was already
computed and already listed — but only in the client book panel, next to "Every
client". On the KPI meter, an escalation that matched nothing was simply absent from
every card, and absent reads as *no escalation*, not as *we could not place one*. The
feedback and adoption unmatched lists were already reported on the meter; escalations
were the odd one out. They are reported there now, and silent when there is nothing
to say.

That is the same shape as the client-book failure above, found the same day: the
notice existed, in the place useful to whoever wired the data up, and nowhere near
whoever reads the number.

### Still worth doing

The prefix rule stays deliberately narrow — "GNAV Kurukshetra" against four
Kurukshetra schools is a guess, and a wrong guess puts a red flag on an innocent
client. But every mismatch found so far has been the same shape: the two systems
agree on the words and disagree on how many. A rule matching every word of the book
name appearing in order in the escalation name, accepted only when exactly one client
qualifies, would have caught this one without guessing. Not done here — it changes
which clients get flagged, so it wants its own change and its own tests.


## Client visits (MOM Portal) — added 9 Aug 2026

Every KPI meter card now carries a **Visits** line: field visits recorded in the
MOM Portal at odmom.lovable.app, with a per-person breakdown in the (i) panel.

**It is a count, not a dial, and that is deliberate.** Compliance has an obvious
target — every entry filed. Business has an agreed one — Rs 50L. Nobody has said
what a month of field visits should be. Drawing a dial against a number invents
that target and then lets it harden into a fact, which is already the risk the
adoption placeholder carries. A figure states what happened and asserts nothing.
qa asserts the absence: no track, no percentage. Turning it into a dial later is
the easy mistake.

**Only offline MOMs count.** An online MOM is a call, and calls are already
counted on the compliance side by the CS Client Call Tracker. Counting them here
would score the same contact twice under two headings.

**A visit counts for everyone who attended**, not only whoever filed it — credit
is `employee_name` plus every attendee marked as Okie Dokie staff. So the team
figure is person-visits, and the card shows the meeting count beside it whenever
the two differ. Two people spending a morning at a client is two people's time,
and a per-meeting count would hide the difference between a team of one turning
up and a team of three.

Names are resolved with the same restraint as the escalation and adoption
matchers: a first name is credited only when exactly one roster member answers to
it, and anyone who cannot be placed is listed rather than dropped. A visit
credited to the wrong person is worse than one credited to nobody.

### It is a snapshot, and it says so

`VISITS_FALLBACK` holds 75 meetings to 8 Aug 2026. The live feed exists —
`/api/kpi-visits` on the portal, one row per person per meeting — and `?src=visits`
is wired in `api/data.js`, but it needs a shared secret set on both sides:

    openssl rand -hex 32
    # -> Lovable: Cloud -> Secrets -> KPI_FEED_KEY
    # -> Vercel:  Environment Variables -> MOM_FEED_KEY

Both halves must hold the same value. The portal fails closed while `KPI_FEED_KEY`
is unset, so nothing is exposed in the gap between setting one and the other, and
the proxy reports a key mismatch as exactly that rather than as a generic upstream
failure. Until then the (i) panel says which it is reading.

### Two corrections baked into the snapshot

Both are still wrong AT SOURCE, so switching the live feed on will bring them back
until the records are fixed in the portal:

* **29 Jul, IAMR** — `employee_name` held "Rajendra Sir", the client's own admin,
  marked `team: client` in the attendee list. The visit is Amit Kumar's. Lokesh
  Kumar keeps his credit for it; he attended.
* **28 Jul, Aravali** — entered twice minutes apart, as "Amar kumar , Sultan malik"
  and "Amar Kumar, Sultan Malik". One visit, counted once.

### What the numbers say

August 2026 to date: 19 person-visits across the measured teams. Sukhmeet Singh's
team has 10 of them and Bhavey Saluja alone has 6. July: 64, with Sukhmeet's team
on 32 and Bhavey on 18.

Vansh Saini, Divya Gupta, Sapna and all of Sagar Mishra's team have no visit in
either month. Worth reading beside the long non-filers already noted above rather
than as a separate finding.

Two 6 Aug visits credit nobody on the CS roster — Vedashree (Lalit Garg, Rahul
Sharma) and PIET (Ayush Garg). Left uncredited by decision, not by accident: they
are real visits by people outside CS, and widening the roster to catch them would
change what the compliance figures mean too.


## The Field tab — added 9 Aug 2026

Visits got their own group in the rail, **Field → Client visits**, rather than
being folded into Compliance. Compliance measures filing discipline against an
expectation — every working day, two entries. A visit has no expectation behind
it, so putting it in that group would have described it as something it is not.

The tab shows three totals (person-visits, meetings, teams out), then by team,
then by person with each person's share, then a card naming everyone on a
measured team with **no** visit in the selected months. Named, not counted:
"3 filed none" moves the question along; the names are what anyone asks next.

It follows the month picker, like the scorecard and the meter. The joined toggle
is not offered — it changes nothing here.

### Field sits above Overall, and a test now says so

The rail pins its **last** group to the foot as the roll-up. A group added after
Overall would take that position and read as the summary of everything above it.
qa asserts Field is second-to-last for that reason, not for tidiness.

### Two bugs found while wiring it, both worth the note

**`renderVisits()` was called inside the feedback branch**, which returns. The
tab rendered perfectly whenever you were looking at a different tab and was blank
on its own. Same family as the inert-tab bug: the view existed, the wiring went
to the wrong place.

**`setMonths()` ended `if (SOURCE === 'meter') renderMeter(); else renderScorecard()`.**
That was true when two views read the picker. With a third, changing the month
sent the visits tab a scorecard re-render and left its figures showing whichever
month happened to be selected when it was first drawn — a stale number with a
fresh label above it. It dispatches on the source now.

Generalise: **an `else` that names one view is a two-view assumption**, and it
does not announce itself when a third arrives.

### The inert-tab guard, generalised

Section 12b-ii clicked every tab and asserted the view moved. It now also asserts
that the group-id list in `markSource()` and the one on the click handler are
identical, and that both match the `.sources` ids actually in the markup.
Removing a group id from the handler alone fails 10 assertions instead of leaving
a tab that draws, highlights nothing, and does nothing.


## The (i) dialog was unreadable — rebuilt 9 Aug 2026

Reported from four screenshots. The clutter was mostly one CSS bug wearing
several costumes, plus two decisions that had aged badly.

### The bug: `.tk` was a column that was not a column

    .how .tk{display:inline-block;min-width:64px}

Nothing after it. A label shorter than 64px looked spaced; a label longer than it
ran straight into its own value:

    Sukhmeet Singh2 visits
    internal calls4 Aug · 6 Aug
    Budha College Karnaldd — dd

Every label/value row in the panel had this, and it only appeared when a label
happened to exceed 64px — which is why it survived four rounds of looking at this
dialog. A minimum width was the wrong instrument: it was trying to make a column
out of inline text.

They are laid out as what they are now — the label takes a fixed column, the
value takes the rest and wraps inside it, and the two cannot touch however long
either grows. Below 460px the row stacks instead. qa asserts the shape (label and
value in separate elements) rather than any pixel measurement, and separately
asserts the `.tk` rule no longer sets a `min-width`. Restoring the old rule fails
2 assertions.

### `word-spacing:.15em` on every `.dates`

Added for date runs, where it helps separate "4 Aug · 6 Aug". It also applied to
the client lists, which is what made those look randomly gappy rather than dense.
Gone.

### Silence was painted as failure

"Not heard from" listed every client yet to answer the feedback form, in the same
red used for missed entries — directly under a paragraph explaining that
non-responses are *not* counted as unhappy. The panel argued with itself. That
list is neutral now.

### Forty-eight names buried six sections

The never-scored and not-heard-from lists dumped every client inline, pushing
everything below them off the bottom of a scrolling dialog. They show the first
six with the rest behind a native `<details>` disclosure — keyboard-reachable,
no script, and the summary says how many are hidden. qa asserts no uncapped list
of more than a dozen names survives.

### Grouping

Each list now sits in its own inset panel with hairlines between rows rather than
running together as one column of text, so it is visible where the answer to one
question stops and the next begins.


## The meter hint, and the rail — 9 Aug 2026

### The hint was six sentences of methodology with the warnings buried in it

Every dial has carried its own (i) since the per-row buttons went in, so the
paragraph at the top of the KPI meter was restating on the page what the reader
could already ask for — and it pushed the warnings, which are the part available
nowhere else, into the middle of a wall of text where they read as more prose.

What is left is the period and one line about the four dials, then the warnings as
their own rows: a coloured dot for the level, the finding in bold, the detail
after it. "Is anything wrong?" is now answerable at a glance instead of by
reading nine lines.

The warnings themselves were **not** trimmed, and the test guards that
distinction: it caps the length of the standing text only. Capping the whole hint
would have measured the warnings, and a page with a lot wrong is supposed to say
a lot. `VISIT_UNPLACED` joined the list while it was being rebuilt — it was
reported on the Field tab and nowhere else.

### The rail ran past the fold, so the selection moves now

Tighter rhythm first — smaller group labels, less gap between groups.

Then the selection: one pill for the whole rail rather than a background on each
tab, so changing tab is a movement rather than one thing switching off and another
switching on. The curve matters more than the duration —
`cubic-bezier(.22,1.2,.36,1)` overshoots slightly at the end, which is what makes
it feel like the pill arrived somewhere rather than faded there. It follows
resize and rail scroll, and drops to a plain fade under
`prefers-reduced-motion`.

**It is decoration, never the mechanism.** The tab still carries `aria-pressed`,
and a CSS fallback marker draws the selection until the pill is actually live —
`.groups.piloted` gates that, so the fallback cannot disappear before its
replacement works. jsdom reports every offset as `0`, which is the same shape as
a layout failure in a real browser, so qa asserts the rail is *fully usable with
the pill never positioned*: positioning does not throw, the pill stays
unpositioned rather than parking in the corner, the fallback marker still draws,
and tabs still switch. Hiding the fallback unconditionally fails 2 assertions;
deleting the pill element fails 4.


## Two bugs from the notice strip and the pill — 9 Aug 2026

### A wrong diagnosis, recorded because it was acted on

`#meterhint` was `<p class="hint">` and the rebuilt notice strip put a `<p>` and
a `<ul>` inside it. That is invalid, and it was blamed for the overlapping render
in the screenshots. **It was not the cause.**

A `<p>` does get closed at its first block child — when the markup is parsed
*from source*. This content arrives through `innerHTML`, and the fragment parsing
algorithm sets up a stack containing only the root element, so there is no open
`<p>` in button scope to close and the children stay where they were put. jsdom
and a browser agree, and both were checked before this paragraph was written
rather than after.

The containers are `<div class="hint">` anyway, because the nesting was invalid
regardless, and qa pins it statically — no DOM assertion can see it either way.
But it fixed nothing visible, and the note that said it did was wrong.

Lesson, and it is the second time in this file: **a diagnosis that explains the
symptom is not the same as a diagnosis that was tested.** The earlier one cost
two wrong fixes before Ctrl+Shift+R turned out to be the answer.

### The notice strip drew its own separators three ways

What replaced it: `display:grid` with `gap:1px` over a tinted background, plus
`overflow:hidden` to clip the corners — three mechanisms cooperating to draw a
line between two rows. It is now `border-top` on `li + li` and nothing else.
Ordinary block flow has the fewest ways to collapse, and a list of warnings is
not where to spend a layout trick.

### The pill was positioned twice, and the rail scrolled sideways

`left:8px` in the CSS, and the same 8px subtracted again from the transform.
They did not cancel: `.groups` is `position:relative`, so it is the offset parent
and a child's `offsetLeft` already includes its padding. The pill sat 8px wide of
its tab — far enough right to stretch the rail's scroll width and give a vertical
column a horizontal scrollbar.

One source of truth for the position now (the transform), and `.groups` sets
`overflow-x:hidden` in the column layout, because a vertical rail has no content
on that axis and should not be able to move on it. The rule is lifted again below
1000px, where the rail becomes a row and sideways is the point.

Each of the three fixes fails 2 assertions if reverted.


## `hidden` was not hidden — 9 Aug 2026

Three rounds of screenshots showed text from one view overlapping another, in a
narrow column, in a font nothing on the page uses. Two wrong diagnoses first (the
`<p>` nesting, then the notice strip's own CSS). The screenshot that settled it
showed something else entirely: a **From/To date range on the KPI meter tab**, a
control that ships with the `hidden` attribute and has no business on that view.

That was the tell. Every scrap of the overlapping text is content the page has
already set `hidden` on. It was rendering anyway.

`hidden` is only a UA-stylesheet `display:none`. **Any author rule that sets
`display` on the same element beats it on specificity**, and the element renders —
at whatever width its own container gives it, over the top of whatever is
genuinely open. This stylesheet had four `[hidden]` guards scattered through it,
each added when its own case was discovered. One blanket rule replaces the need
to remember:

    [hidden]{display:none !important}

qa asserts the rule exists, and separately that no display rule targets a
sometimes-hidden element without a `[hidden]` guard of its own — so the next one
added is caught rather than rediscovered from a screenshot.

### And the control that gave it away

`markSource()` computed the right condition:

    $('dates').hidden = !daily || MODE !== 'custom';

then `markMode()` ran afterwards and overwrote it with `MODE !== 'custom'` alone.
A persisted `custom` range therefore unhid the date pair on every tab. Two
functions writing the same property, one of them knowing less than the other.

Generalise, and it is the same shape as the `setMonths()` dispatch bug earlier
today: **when two functions write the same piece of state, the one that runs last
wins, whether or not it knows enough to.**

Reverting either fix fails 2 assertions.


## The meter hint is one line — 9 Aug 2026

Asked for twice. The whole warning block is off the KPI meter; the hint is the
period and nothing else.

Where each warning went, all of them already had a home on the tab that owns the
data:

* unmatched escalations -> the client book (`#escnote`)
* scored clients not in the book -> the adoption tab (`#adopthint`)
* institutions answering under an unknown name, and a failed feedback sheet ->
  the feedback tab (`#feedhint`)
* names on visits not on the roster -> the Field tab (`#visithint`)
* the book falling back to its snapshot -> the client book (`#asof`) and the
  scorecard note

**Two are now shown nowhere, and that is a real loss rather than a tidy-up:**
teams excluded for having no client book, and people in no team. The behaviour
they described still holds and qa now asserts it structurally instead of by
wording — an excluded team is absent from the meter and present on the scorecard,
and an unplaceable person is kept out of every team rather than folded into one.
Nobody is miscounted; nobody is told either.

The tests were redirected rather than deleted, which is the part worth insisting
on: a check that reads a removed sentence should point at wherever the fact
lives now, not be dropped along with the sentence.


## Retention and implementation on the meter — added 15 Aug 2026

The client book's **Retention/Imp** column reached the sheet a while back and had
no reader. It is now a **Mix** line under each team's business dial: client count
and revenue, split retention against implementation, with both totals so neither
stands in for the other — see **KPI meter -> Retention and implementation** above
for why it is a line and not a fifth dial, and why an unlabelled client counts
towards neither side rather than the more common one.

`bookKind()` matches on the stem (`/^ret/`, `/^imp/`) so the hand-typed
abbreviation is read the same as the full word, and returns `''` — not a guess —
for anything else. `parseBook()` only sets a client's `k` when that comes back
non-empty, so a book with no such column, or the compiled fallback, which predates
it, parses exactly as it did before: no key, not an empty one. That distinction is
what let the round-trip test in `qa.js` (1a3) stay a round trip — the fixture now
carries whatever kind each snapshot row actually has, rather than a constant that
would make every parsed row claim a label the snapshot never gave it.

Two things were caught by the existing suite rather than by hand:

* Adding a line under the business dial pushed the next element down by one, which
  is exactly the shape `.covline + .dial` was already guarding for adoption's own
  coverage line. `.mixline` picked up the same rule (§ 12d-ii, "sits directly under
  the dial it describes") for free.
* Two CSS assertions matched on the full `.escline,.covline{...}` selector list
  rather than on `.covline` alone, so adding `.mixline` to that list — needed for
  the no-line-break rule every other line on the card already has — broke them for
  a reason that had nothing to do with either rule. Loosened to match `.covline`
  wherever it sits in the group, so the next line added does not fail the same way.

Verified against the live book, not only fixtures: fetched `/api/data?src=book`
directly and confirmed two clean values across 146 numbered rows (no blanks, no
third spelling), then rendered the real KPI meter against it end to end — every
team carries a real, differently-shaped split (Sukhmeet Singh 39 retention / 9
implementation by count but a closer ₹44.9L/₹21.4L by revenue; Sultan Malik almost
even by count and revenue-heavier on implementation), which is the both-figures
case the line exists to show.


## Scored and Heard from moved into the panel only — 16 Aug 2026

Asked for by name. Both had been their own row on the card since the meter's early
days — `coverLine()` for adoption's denominator, `feedLine()` for feedback's, the
same "label · (i) · figure · money" shape as an escalation or a visit count. Neither
function is called from the card any more, and both are deleted outright rather than
left in place unused — `qa.js`'s own static-hygiene check would have caught either
one sitting there declared and dead.

Nothing about the arithmetic changed, only where it is read. The card is a dial's
worth of numbers now; the coverage figure travels with the rest of the panel's
arithmetic for that dial instead of standing beside it as a fifth row:

* **Scored** — `adoptDetail()`'s stats row gained an unconditional `scored/total`
  entry. It used to appear only when there was a gap to report (inside the "Never
  scored" heading); a fully-scored team had nowhere on the page that said so. That
  was a real hole opened by removing the card row, not a display preference — caught
  before it shipped by asking what the panel says for a 48-of-48 team, not just a
  partly-scored one.
* **Heard from** — already unconditional. `feedDetail()`'s stats row has carried a
  `heard/total` "replied" figure since the panel was reshaped in this same session's
  earlier work, so nothing needed adding there.
* **The stale-BOOK cross-check did too.** The deleted `coverLine()` carried a comment
  explaining that its revenue pair — computed independently in `adoptForTeam()`,
  never read from the cached `BOOK` — was "the only place the business dial's book
  total is printed twice," which is what caught `BOOK` going stale on 5 Aug (see
  **KPI meter**, above). Removing the row without replacing that would have quietly
  removed the cross-check along with it. `adoptDetail()`'s stats row now carries
  `a.revTotal` as its own **book** figure, printed a few lines below `bookDetail()`'s
  own — both independently derived, both in the same dialog, easier to compare now
  than when one was on the card and the other in a panel a click away.

The test suite took the heaviest hit of any change in this file: fourteen assertions
across `qa.js` either read `.covline` directly off a card or positioned something
relative to one. Two crashed outright — `kids[first - 2].querySelector(...)` on a
`.covline` that `indexOf` could no longer find, `undefined.querySelector` — rather
than failing cleanly, which is the shape of a test whose premise stopped being true
out from under it. Each was redirected to read the same fact from the panel instead
of deleted: a small `statVal()` helper (find the `.stat` whose `<span>` is the wanted
label, read the `<b>` beside it) replaces most of the card-scraping; the two
positional checks about a coverage line sitting under the right dial became one
check that the **scored** stat sits inside the adoption `<h5>`'s own section, not
drifted into feedback's, which is the same failure mode the original checks existed
to catch, just asked of the panel instead of the card. `extreme_qa.js` gained the
inverse assertion outright: `.covline` count is now pinned at zero, not two.


## Implementation projects — added 16 Aug 2026

A new source, `?src=implementation`: an Asana portfolio report ("Client
Implementation"), published to the web the same way the book and feedback are. One
row per **project**, not per client — task counts, a due date, and Asana's own
`OVERDUE` figure — matched against the client book exactly the way escalations
already are, because the two are typed into different systems by different people
and cannot be trusted to agree on a name.

### The card

A new **Implementation** line, the same shape as Escalations and directly below it:
"None overdue" and grey, or "N of M overdue" and red with the affected clients named.
Deliberately **projects**, not tasks — a project with seven overdue tasks and one
with a single overdue task are both one red flag on the card, and summing raw task
counts across projects of very different sizes would read as a severity difference
that isn't the question being asked. The (i) panel breaks it down further: every
overdue project with its due date and how many tasks are still open, projects on
schedule collapsed to a count.

A past due date is not the same signal as Asana's own overdue count, and only the
second one drives the card. A project can be behind schedule with `OVERDUE` reading
0 — no due dates set on the individual tasks, for instance — and the card says
"None overdue" for it regardless, because that is what Asana itself is reporting.
Read the due date in the (i) panel for that case; it is shown, just not counted.

### Ownership comes from the book, never from the sheet's own OWNER column

Same rule module adoption already learned the hard way (**Module adoption**, above:
"The book decides who owns a client"). This portfolio's `OWNER` column is whoever did
the Asana work, which drifts from who carries the account exactly the way an
assistant's tab did for adoption scoring. A project always lands on the same card its
client's revenue does, or it is reported as unmatched — never attributed by the
sheet's own say-so.

### `IMPL_ALIAS`, and the Hindu/Dalmia/Shah Satnam problem

Same shape as `ESC_ALIAS`, same reasoning, same place to fix a miss: on evidence,
never on resemblance. Most of the 51 real projects resolved without any alias at all
— 7 exact, 8 more by the existing prefix-containment rule (`MVN University` inside
`MVN University Palwal`, and so on) — but three groups needed a human decision before
any alias could be written:

* **Dalmia** — five branch projects (Dalmiapuram, Kalyanpur, Thangskai, Kadappa,
  Rajgangpur), one owner (Ankush Rana) throughout, one book row ("Dalmia Group").
  Real evidence, not a guess: all five are aliased to it.
* **Hindu** — fourteen projects, two book rows ("Hindu College", "Hindu School"),
  and *three different* Asana owners across them. No single row is the evidence-based
  answer the way Dalmia's is. Split by the word each project name actually carries —
  "College" vs "School"/"Vidyalaya", a real signal — wherever it has one; the three
  that carry neither (`SM Hindu`, `Hindu Vidyapeeth, Sonipat`, `Hindu Global, Sonipat`)
  are left unmatched and named on the client book tab rather than coin-flipped.
* **Shah Satnam** — three projects, two book rows ("Sirsa", "Non Sirsa"), and
  nothing in any of the three names says which is which. Left unmatched entirely:
  unlike Hindu, there was no textual evidence to split on at all, only the general
  "pick one" instruction — and picking wrong here would put a real overdue flag on
  the wrong team's card, which is worse than the gap staying visible.

`buildImplementation()` also validates `IMPL_ALIAS` itself the moment it runs: every
alias target has to actually be in the current book, or the alias is worse than
useless — it looks resolved and flags nothing. This caught a real gap before it
shipped: `IMPL_ALIAS` points five Dalmia projects at "Dalmia Group", which is in the
**live** book but was missing from `CLIENTS_FALLBACK`, the 3 Aug snapshot compiled
into this page for when the live book is unreachable. Had that gone out as written,
the moment the live book failed over, five real overdue projects would have gone
unmatched with the page giving no clue why. Added the missing row (`Dalmia Group`,
Ankush Rana, ₹2.75L) rather than silencing the check — the gap was in the snapshot,
not in the alias, and the check exists to catch exactly that class of drift.

### The note is shared with escalations, not given its own home

`#escnote`, on the client book tab, now reports both: "N escalations could not be
matched" and "N implementation projects could not be matched" sit in the same
paragraph, because they are the same failure — some row from an outside sheet
couldn't be matched to the book — appearing in the same place a reader already knows
to check, rather than scattered across tabs by which sheet happened to produce them.

### Verified against the live sheet, not only fixtures

Fetched `/api/data?src=implementation` and the book directly: 51 real projects, 37
currently carrying at least one overdue task. Matched by hand against the book to
build the picture above — 7 exact, 8 prefix, 16 safe spelling/abbreviation aliases,
21 in the three group cases, 3 genuinely absent from the book under any name
(`Saraswati Mahila Mahavidhyalaya, Palwal`, `IAIT`, `CDS Modern School`) — before any
of it was written as code. 725 assertions total (648 + 77), passing across
UTC/IST/PST/UTC+14.
