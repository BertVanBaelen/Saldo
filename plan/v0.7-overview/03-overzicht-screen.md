# 0.7-3 · Overzicht screen: chart, tiles, per account, categories

| | |
|---|---|
| Version | [0.7 Overview](README.md) |
| Status | built (0.7.0-dev), to verify |
| Size | M |
| Features | OVER-1, OVER-2 |
| Concepts | [period-overview](../../analysis/concepts/period-overview.md), [category](../../analysis/concepts/category.md), [scope](../../analysis/concepts/scope.md), [internal-transfer](../../analysis/concepts/internal-transfer.md) |
| Screens | [overzicht](../../analysis/screens/overzicht.md) |
| Depends on | [0.7-1](01-reports-api.md); [0.7-2](02-transacties-drill-down.md) for the link targets (the links can be built first) |

## Goal
The Overzicht screen of the mockup on real data, for Maand, Kwartaal and Jaar, on phone (375 px) and desktop, light and dark.

Design reference: `finance-mockup/js/screens/overzicht.js` and `css/screens/overzicht.css` (frozen); spec [overzicht](../../analysis/screens/overzicht.md). Port the CSS class by class into `web/src/pages/Overzicht.css`.

## Data flow
One request per scope, account and `dataVersion` (reload after a category change or a sync, as Start does): `api.reportMonths({ scope, account })` without `from`/`to` (the whole history; small). Changing Maand · Kwartaal · Jaar · Eigen or the selected column needs **no request**: the web app sums months. While a request for a new scope or account is in flight the chart shows the loading shimmer (6 skeleton bars, `role="status"`, label "Laden") and the tiles and categories show "–". A failed request shows `ErrorState` with "Opnieuw".

## Period model (`web/src/lib/reports.ts`, pure, no React)
Today is `me.today` (Brussels). The **running month** is today's month; the **last complete month** is the one before. `firstMonth` and `firstDate` come from the API.
- **Partial period** (generalises the mockup's running month): a month is partial when it is the running month, or when it is `firstMonth` and `firstDate` is after the 1st. A quarter is partial when it contains a partial month or starts before the history; a year only when it contains a partial month (next line). A partial column is lighter (`.ov-col--running`, opacity 0.5), has no trend, gives no trend to the next column, and is never the default selection. Its aria label adds "(loopt nog, tot 18 nov)" or "(vanaf 20 aug)"; the category head reads "lopend · tot 18 nov" or "vanaf 20 aug"; the note under the chart says "Lichtere staven: november loopt nog, tot 18 nov." or "Lichtere staven: augustus telt vanaf 20 aug."
- **Jaar follows the frozen mockup**: a year that merely starts before the history ("2025 · vanaf november") or ends before December ("2026 · tot oktober") is drawn normal; its title carries the cut. Jaar has no trend and the default selection is the last year anyway, so there is nothing for the partial style to protect. A year is partial (lighter, no default selection) only when it contains a partial month. Decided 17 Nov 2026 (the advisor's review; the earlier draft drew 2025 lighter).
- **Maand**: the last 6 complete months, not before `firstMonth`; the month before the first column feeds the trend when it is not before `firstMonth`. Range text "mei – oktober 2026" (two years: "nov 2025 – apr 2026"), compare "vorige maand".
- **Kwartaal**: calendar quarters that lie completely within `firstMonth` … last complete month and are not partial, the last 4 (K4 2025 stays out of the demo while complete quarters exist); with no such quarter, the quarter(s) containing the history, shown partial; the quarter before feeds the trend when it is complete in the history. Title "K1 2026", short "K1", key `2026-K1`; range "2026 per kwartaal" (two years: "K4 2025 – K3 2026"); compare "vorig kwartaal".
- **Jaar**: every calendar year from `firstMonth` to the last complete month, cut to that span; title "2025 · vanaf november" when it starts after January, "2026 · tot oktober" when it ends before December, else "2026"; range "per jaar, sinds november 2025"; no trend.
- **Eigen** (the picker is 0.7-4; this phase reads `?periode=eigen&van=2026-08&tot=2026-11`): one column per month, the running month allowed; the month before feeds the trend.
- Maand and Jaar with no complete month (history only in the running month) show the running month or year as their one, partial column.
- Bar size class by column count: > 8 `xs`, > 4 `s`, > 2 `m`, else `l`. Bar height relative to the largest of income, expenses and saved over the columns in view; a negative saved draws no bar (the tile shows the amount).
- Default selection: the last column that is not partial, else the last column; it resets when period, scope or account changes.

## Steps
1. **Types and client**: `ReportMonths` in `lib/types.ts`, `api.reportMonths(q, signal)` in `lib/api.ts`.
2. **`lib/reports.ts`**: `columns(view, firstMonth, today, range?)`, `sumColumn(column, months, accountId?)` (income, saved, expenses by key, total), `catRows(sum, prevSum, categories)`, `trend(v, prev)`, `barSize(n)`, `periodParam(column)` (`2026-10`, `2026-K2`, `2026`, for the drill-down).
   - `trend`: no previous column → none; previous amount 0 or missing and current > 0 → "nieuw" (muted); else `d = Math.round((v − p) / p × 100)`: 0 → "= 0%", "+12%", "−7%" (U+2212); colour > +5 `--warn`, < −5 `--greenText`, else `--muted`.
   - `catRows`: rows with amount ≠ 0, sorted by amount, largest first; a negative row (refunds above spending) goes last with "−€ …", no share and no bar. Share = `Math.round(v / total × 100)` per row; shares are not forced to 100. Keys: a category id → its name, colour and emoji from `api.categories`; `none` → "Niet gecategoriseerd" (dashed dot like `.tx-dot--uncat`); `toShared` → "Naar gedeelde rekening" (`--shared`); `toOwn` → "Naar eigen rekening" (`--muted`).
3. **Tokens**: `--ov-inc: var(--green)`, `--ov-exp` #5B9BD5 / #7DBDF0, `--ov-sav` #B07F00 / #E8CB55 in the light block and both dark blocks of `web/src/styles/tokens.css`.
4. **Page** `web/src/pages/Overzicht.tsx` with `Overzicht.css`, route `/overzicht` in `App.tsx` instead of `<NotBuilt id="overzicht" />` (drop the overzicht text from `NotBuilt` if it has one; keep the component, Planning and Meldingen still use it):
   - Header: title, desktop subtitle "{subject} · {range}" (subject: the filtered account, else the one account of the scope, else "Alle rekeningen" / "Persoonlijke rekeningen" / "Gedeelde rekeningen"), `ScopeSwitch`, period segmented control (`role="group"`, "Periode"; Eigen has `aria-haspopup="dialog"`), phone avatar → Meer.
   - Tools row: the account chip ("Alle rekeningen" or the account with its dot) and, in Eigen, the range chip. In this phase they only call `onOpenAccounts` / `onOpenRange` props that 0.7-4 implements.
   - Chart card: title (phone: the range, capitalised; desktop "Inkomen, uitgaven en gespaard"), legend, one `<button aria-pressed>` per column with aria label "oktober 2026: inkomen € 3.350,00, uitgaven € 1.705,49, gespaard € 200,00", label under the bars; notes under the chart: partial periods (above) and short history when `firstMonth` lies in or after the first column ("Je geschiedenis begint in november 2025. Oudere transacties importeren", link to `/importeren`).
   - Totals: head "{scope text} samen · ter info" with several accounts, else the account dot and name; tiles Inkomen / Uitgaven / Gespaard (desktop label adds " · okt").
   - **Per rekening** (only with several accounts): one button per account (icon in the account colour, name, chevron, In / Uit / Gespaard, "–" for 0), aria label "Alleen Zichtrekening bekijken: in …, uit …, gespaard …"; a tap sets `?rekening=<id>`. Footnote when the per-account incomes add up to more than the total: "Overschrijvingen tussen je eigen rekeningen (€ 450,00) tellen per rekening mee, maar niet in het totaal samen."
   - **Per categorie · {title}** with the compare text; each row a `Link` to `/transacties?categorie=<id>|geen|naar-gedeeld|naar-eigen&periode=<periodParam>` plus `&rekening=<id>` when filtered; `none` links to `?categorie=geen&periode=…` (the report's own selection, not the Start alert's filter). Trend text has a visually hidden prefix with the compare text.
   - Selecting a column changes tiles, per account and categories; the share bars animate their width (420 ms, none under `prefers-reduced-motion`).
   - URL state: `?periode=maand|kwartaal|jaar|eigen`, `van`, `tot`, `rekening` (read here, written here and by 0.7-4). A `rekening` outside the scope, or not a `current` account (savings, investment: the API would answer `400`), is dropped from the URL, as the mockup's `readLink` ignores it.
   - **Empty state** when `firstMonth` is `null`: the mockup's "Nog geen geschiedenis" card with "Bank koppelen" (`/bankkoppelingen`) and "CSV importeren" (`/importeren`). A scope without accounts: the Start card "Nog geen persoonlijke / gedeelde rekening".
5. Docs: `analysis/screens/overzicht.md` status, `docs/local-testing.md` section.

## Tests
- vitest `lib/reports.test.ts` with `today = 2026-11-18`, `firstMonth = 2025-11` (the demo):
  - Maand: columns mei … oktober 2026, trend base april; Kwartaal: K1, K2, K3 2026 (K4 2025 is incomplete in the history), trend base for K1 none; Jaar: "2025 · vanaf november", "2026 · tot oktober", no trend (drawn normal, see below); Eigen `2026-08`…`2026-11`: four columns, november running, base juli.
  - `firstMonth = 2026-11`, `firstDate = 2026-11-03` (new user): Maand, Kwartaal and Jaar show one partial column, which is the default selection.
  - `firstMonth = 2026-08`, `firstDate = 2026-08-01`: Maand shows aug, sep, okt, aug normal without trend, the short-history note; default selection okt.
  - `firstDate = 2026-08-20`: aug is partial ("vanaf 20 aug"), sep has no trend, Kwartaal shows K3 2026 partial only (no complete quarter), default selection in Maand okt.
  - Demo Jaar: "2025 · vanaf november" and "2026 · tot oktober" both drawn normal (the titles carry the cut, as in the mockup), default selection 2026; with `firstDate = 2025-11-20` the 2025 column is partial (it contains a partial month).
  - `trend`: (64200, 66500) → "−3%" muted; (100, 0) → "nieuw"; (0 hidden); (115000, 115000) → "= 0%"; (131, 100) → "+31%" warn; previous missing → none.
  - `catRows` with a negative key goes last without share; shares of 33.4/33.3/33.3 round to 33/33/33.
  - `sumColumn` of a quarter adds three months; per account; `barSize(7)` = `s`, `(9)` = `xs`, `(2)` = `l`.
  - With the demo answer of 0.7-1 (alles, October): Uitgaven 170549, rows Wonen 67 %, Boodschappen 15 %, Vervoer 8 %, … and the trend of Boodschappen against September "−7%".
- vitest `pages/Overzicht.test.tsx` (mocked `api`, as in `Start.test.tsx`): a `dataVersion` bump requests the report again; `?rekening=2` (savings) is dropped without a request for it; renders the six month columns with the last selected; clicking a column changes the tiles; Kwartaal shows three columns without a new request; the persoonlijk answer shows "Naar gedeelde rekening"; alles shows Per rekening with the € 450 footnote; a row links to `/transacties?categorie=2&periode=2026-10`; `firstMonth: null` shows "Nog geen geschiedenis"; a pending request shows `role="status"`.
- `tokens.test.ts`: `--ov-exp` and `--ov-sav` are hex colours in all three blocks and the two dark blocks agree.

## Who builds it
- **Sonnet**: everything, in two subagent runs: (a) steps 1 to 3 with `reports.test.ts` and the token test, (b) the page and its test, porting the mockup's markup and CSS.
- **Lead**: the visual check against the mockup at 375 px and desktop, light and dark, with the demo.

## Done when
The screen matches the mockup on phone and desktop with the demo data (the story's category amounts), every category row opens Transacties with the matching rows, and partial periods and short history read as designed.
