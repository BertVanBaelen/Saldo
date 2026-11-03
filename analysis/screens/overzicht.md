# Overzicht

Analysis: 12 (screen 4), 4.4 · Design: Telefoon-Overzicht, Desktop-Overzicht · Mockup: `finance-mockup/overzicht.html` · Concepts: [period-overview](../concepts/period-overview.md), [category](../concepts/category.md), [internal-transfer](../concepts/internal-transfer.md), [scope](../concepts/scope.md) · Phases: [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.7-2](../../plan/v0.7-overview/02-overzicht-screen.md)

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
- Maand: mei – oktober 2026 (april only feeds the trend), default selection the last month (oktober). Kwartaal: K1–K3 2026, "2026 per kwartaal". Jaar: "2025 · vanaf november" and "2026 · tot oktober", "Per jaar, sinds november 2025", no trend. Eigen: no behaviour in the design (mockup shows a toast).
- Alles, oktober 2026: Inkomen € 3.350,00, Uitgaven € 2.759,97, Gespaard € 200,00; Wonen € 1.150,00 (42%, = 0%), Boodschappen € 642,00 (23%, −7%), Vrije tijd € 318,00, Overig € 311,00, Vervoer € 284,00, Abonnementen € 54,97. Income € 3.300 per month (€ 3.350 in October), saved € 200 per month (0 in July, € 400 in August).
- Persoonlijk: income − € 450, Wonen € 1.005, Abonnementen € 11,99, no Boodschappen, Overig − € 62,02, plus **"Naar gedeelde rekening" € 450,00** (colour `--shared`).
- Gedeeld: income € 900 (two contributions), saved 0; Wonen € 145, Boodschappen (all), Abonnementen € 42,98, Overig € 62,02.

### States and interactions
- Changing period or scope resets the selection to the last period and shows a **loading shimmer** in the chart (6 skeleton bars, 320 ms); tiles and categories update at once.
- Tapping a column selects it: tiles, category title, shares and trends follow; share bars animate their width (420 ms).
- Entry: sFade header, sIn sections staggered 20–120 ms; bars sGrowY 520 / 560 ms staggered 40 ms per column.
- Not designed: empty state (no history yet), custom range picker, account filter.
