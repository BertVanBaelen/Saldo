# Overzicht

Analysis: 12 (screen 4), 4.4 · Design: Telefoon-Overzicht, Desktop-Overzicht · Mockup: `finance-mockup/overzicht.html` · Concepts: [period-overview](../concepts/period-overview.md), [category](../concepts/category.md), [internal-transfer](../concepts/internal-transfer.md), [scope](../concepts/scope.md) · Phases: [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.7-3](../../plan/v0.7-overview/03-overzicht-screen.md)

## Content
- Period picker (month, quarter, year, custom).
- Income, expenses and saved per month as bars.
- Category breakdown with share and trend, drill-down to Transacties.
- In Persoonlijk the contribution shows as "Naar gedeelde rekening".

## Design notes
From Telefoon-Overzicht and Desktop-Overzicht. Mockup: `js/screens/overzicht.js`, `css/screens/overzicht.css`.

### Layout
- **Phone** (top to bottom): header "Overzicht" + avatar (→ Meer); scope switch; **period picker**; chart card; three summary tiles; "Per categorie" list.
- **Desktop**: header row = title with subtitle "Al mijn rekeningen · mei – oktober 2026", scope switch (text only, no icons), period picker (buttons min 92 px). Below a 2-column grid 1.2fr / 1fr, gap 20: left the chart card (padding 20) + summary tiles, right the category card.

### Components
- **Period picker**: segmented control like the scope switch (`role="group"`, label "Periode"): Maand · Kwartaal · Jaar · Eigen. Selected = `--green` / `--onGreen`. Phone: 4 equal columns, 40 px; desktop: inline.
- **Chart card**: title (phone: the range, "Mei – oktober 2026"; desktop: "Inkomen, uitgaven en gespaard") and legend Inkomen · Uitgaven · Gespaard (square keys 8 px / 10 px).
  - One `<button>` per period (`aria-pressed`, `aria-label` "oktober 2026: inkomen € 3.350,00, uitgaven € 2.759,97, gespaard € 200,00"), three bars side by side, height relative to the largest value in view (max bar 130 px phone / 240 px desktop, min 2 px), label under the bars.
  - Bar width by count: >4 periods 10 / 18 px, 3–4 → 18 / 30 px, ≤2 → 24 / 40 px (phone / desktop). Chart height 172 / 300 px.
  - Selected column: `--soft` background, label 700 `--greenText`; others label 500 `--muted`.
  - Bar colours (new, not yet in tokens): income `--green`; expenses #5B9BD5 / #7DBDF0; saved #B07F00 / #E8CB55 (light / dark).
- **Summary tiles**: three tiles Inkomen / Uitgaven / Gespaard for the selected period; amount in Geist Mono 14 (phone) / 20 (desktop). Desktop label adds the period: "Inkomen · okt".
- **Per categorie · {period title}** with "t.o.v. vorige maand" / "t.o.v. vorig kwartaal" right (empty for Jaar and for the first period). Rows sorted by amount, zero rows hidden: dot, name, share % (muted), trend, amount (Mono, min width 92 / 110), then a 6 / 8 px share bar on `--track` in the category colour. Each row is a link to Transacties (drill-down; mockup passes `categorie`, `periode`, `scope`).
  - Trend = change against the previous period, rounded %: "+12%", "−7%", "= 0%". Colour: > +5% `--warn`, < −5% `--greenText`, otherwise `--muted`.
  - Phone: title outside, rows in a list card. Desktop: title inside the card, rows with 12 px hover radius.

### Periods and demo values
- Maand: mei – oktober 2026 (april only feeds the trend), default selection the last month (oktober). Kwartaal: K1–K3 2026, "2026 per kwartaal". Jaar: "2025 · vanaf november" and "2026 · tot oktober", "Per jaar, sinds november 2025", no trend. Eigen: see "Designed in the mockup after the boards" below.
- Alles, oktober 2026: Inkomen € 3.350,00, Uitgaven € 2.759,97, Gespaard € 200,00; Wonen € 1.150,00 (42%, = 0%), Boodschappen € 642,00 (23%, −7%), Vrije tijd € 318,00, Overig € 311,00, Vervoer € 284,00, Abonnementen € 54,97. Income € 3.300 per month (€ 3.350 in October), saved € 200 per month (0 in July, € 400 in August).
- Persoonlijk: income − € 450, Wonen € 1.005, Abonnementen € 11,99, no Boodschappen, Overig − € 62,02, plus **"Naar gedeelde rekening" € 450,00** (colour `--shared`).
- Gedeeld: income € 900 (two contributions), saved 0; Wonen € 145, Boodschappen (all), Abonnementen € 42,98, Overig € 62,02.

### States and interactions
- Changing period or scope resets the selection to the last period and shows a **loading shimmer** in the chart (6 skeleton bars, 320 ms); tiles and categories update at once.
- Tapping a column selects it: tiles, category title, shares and trends follow; share bars animate their width (420 ms).
- Entry: sFade header, sIn sections staggered 20–120 ms; bars sGrowY 520 / 560 ms staggered 40 ms per column.
- Period changes are client-side in the app (0.7-3): the shimmer shows only while a new scope or account is loaded.

### Designed in the mockup after the boards (0.1-7; this section corrected 17 Nov 2026, it used to say "not designed")
- **Running month**: November 2026 runs until today; it is reachable through Eigen, drawn lighter (opacity 0.5), its aria label adds "(loopt nog, tot 18 nov)", it has no trend and the category head reads "lopend · tot 18 nov". Note under the chart: "Lichtere staven: november loopt nog, tot 18 nov."
- **Partial periods (app, plan 0.7-3)**: the running month is one case of a partial period. A first month whose history starts after the 1st is partial too ("vanaf 20 aug"), and so is a quarter that contains a partial month or starts before the history, and a year that contains a partial month. Partial columns are lighter, carry no trend, give none to the next column and are never the default selection. Jaar follows the mockup: "2025 · vanaf november" and "2026 · tot oktober" are drawn normal, the title carries the cut.
- **Short history**: when the history starts inside the view (Jaar, or Eigen from the first month): "Je geschiedenis begint in november 2025. Oudere transacties importeren" (→ Importeren).
- **Bar sizes** by column count: > 8 `xs`, > 4 `s`, > 2 `m`, else `l` (phone / desktop widths in `overzicht.css`).
- **Totals head**: several accounts "{Alle rekeningen | Persoonlijke rekeningen | Gedeelde rekeningen} samen · ter info"; one account its dot and name.
- **Per rekening** (several accounts): one button per account with In / Uit / Gespaard ("–" for 0), aria label "Alleen Zichtrekening bekijken: …"; a tap filters on that account. Footnote: "Overschrijvingen tussen je eigen rekeningen (€ 450,00) tellen per rekening mee, maar niet in het totaal samen."
- **Account filter**: chip "Alle rekeningen ▾" (or the account with its dot); desktop popover, phone bottom sheet "Rekening" with "Alle rekeningen" and each current account of the scope; note "Spaarrekeningen staan er niet bij: wat je erheen overschrijft, telt als gespaard."
- **Custom range ("Eigen")**: picker "Eigen periode" with Van / Tot en met, presets (Laatste 3 maanden, Dit jaar, Hele geschiedenis), a month grid per year (months without data disabled: "geen gegevens" / "nog niet"), a status line, Annuleren / Toepassen; in Eigen a range chip reopens it. One column per month; the month before feeds the trend.
- **Empty state** (no history yet): ghost bars, "Nog geen geschiedenis", "Koppel je bank of importeer een CSV-bestand. …", buttons "Bank koppelen" and "CSV importeren", note about Bilance.
- **Deep links** (mockup): `?periode=maand|kwartaal|jaar|eigen`, `?van=2026-08&tot=2026-11`, `?rekening=zicht`, `#eigen`, `#rekening`.
- **Demo numbers**: the per-category expenses of the mockup are illustrative; the app's demo story gives the same income, saved and transfer structure but smaller variable costs (plan [0.7-1](../../plan/v0.7-overview/01-reports-api.md)).
## Built in the app (0.7-3)
Status: built (plans 0.7-3 and 0.7-4): header with scope switch and period picker, chart, totals, Per rekening, Per categorie with share, trend and drill-down links, loading, error and empty states, the account filter and the custom range picker (a modal bottom sheet on the phone, an anchored popover from 1024 px; Escape closes it and returns focus to the button, a click outside closes the popover; `#eigen` and `#rekening` open them once after the load). Transacties reads the drill-down links from 0.7-2.
Differences from the mockup:
- Category rows link to `/transacties?categorie=<id>|geen|naar-gedeeld|naar-eigen&periode=2026-10[&rekening=<id>]`, without `scope` (the app-wide scope applies).
- Partial periods generalise the running month: a first month that starts after the 1st is lighter too ("vanaf 20 aug"). Kwartaal never shows the quarter that holds the running month unless there is no other quarter.
- The per-category amounts are the demo story's (plan 0.7-1), not the mockup's illustrative ones.
- The pickers (0.7-4): the Eigen button only opens the range picker, the period changes with "Toepassen" (`?periode=eigen&van=YYYY-MM&tot=YYYY-MM`), as in the mockup; "Annuleren" leaves it as it was. The picker starts from `van`/`tot` (else the last four months up to the running one). The grid has one 12-month block per year from the first month's year to today's, so the presets are cut to the history ("Dit jaar" starts at the first month when that is later than January). The account list shows the current accounts of the scope only; a shared account's line says "Gedeeld · met {other members}".
