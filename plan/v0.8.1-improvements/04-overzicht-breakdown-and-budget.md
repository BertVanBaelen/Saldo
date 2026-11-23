# 0.8.1-4 · Overzicht: breakdown sheets, subcategories, rows against budget

| | |
|---|---|
| Version | [0.8.1 Improvements](README.md) |
| Status | planned |
| Size | M |
| Items | 6, 8 |
| Screens | [overzicht](../../analysis/screens/overzicht.md) |
| Depends on | [0.8.1-1](01-report-detail.md) (`detail=1`, drill-down keys), [0.8.1-2](02-budget-reference.md) (`/api/reports/budgets`), [0.8.1-3](03-stacked-chart.md) (same files) |
| Files | `web/src/pages/Overzicht.tsx`, `OverzichtSheet.tsx`, `Overzicht.css`, `Overzicht.test.tsx` (`?blad=gespaard` changes meaning), `web/src/lib/reports.ts` (+ test), `analysis/screens/overzicht.md` |

## Goal
Item 8: tap Inkomen, Uitgaven or Gespaard and see how much per category, with a dropdown per subcategory. Item 6: each category row shows how far it is through its budget, the same budget as in Planning.

## Rules: the breakdown sheets (item 8)
- The three tiles become buttons (`aria-haspopup="dialog"`) opening a sheet (the 0.8-0c `Sheet`: bottom sheet on the phone, right panel from 1024 px) at `?blad=inkomen`, `?blad=uitgaven`, `?blad=gespaard` (the last replaces today's transaction list of the Gespaard tile, which moves to its rows). A tile with 0 stays a plain tile.
- Data: the report is loaded once more with `detail=1` **only while a sheet or the category list needs it** (default: always with the page's request, the answer is small; the lead measures the demo's 13-month answer and keeps the flag off when it doubles). Sums per column: `sumDetail(months, data, accountId?)` in `lib/reports.ts`, the same shape as `sumColumn`.
- **Sheet content**: title "Inkomen · oktober 2026", the tile's amount, then one row per top key largest first: emoji/dot, name, amount, and a chevron button "Toon subcategorieën" (`aria-expanded`) when the key has more than one own-category entry; expanded, indented rows per subcategory ("Boodschappen zelf" for the part booked on the top itself, only when not 0; its drill-down key is `<id>-zelf`, 0.8.1-1). Every row (top or sub) links to Transacties with its drill-down value (0.8.1-1) and the column's `periode`/`rekening`. Income keys: categories, "Overschrijvingen" (`transfer`: money from your own or a shared account outside the selection), "Niet gecategoriseerd". Gespaard keys: saving categories, "Naar <spaarrekening>" (`account-<id>`, the account's name), with the 0.8-0a note. Uitgaven: the same rows as "Per categorie" plus their subcategories.
- **Per categorie list**: each category row gets the same chevron to expand its subcategories inline (the row itself still opens its transaction sheet).
- Identities shown: the rows of a sheet add up to its tile (pinned in vitest).

## Rules: rows against budget (item 6; user answer: budget, else the 6-month average)
- `GET /api/reports/budgets` for the columns in view (one request per scope/account, like the report). `budgetRows(sum, ref, categories)`: per top expense category, `reference` = Σ `reference` over the column's months and the selection's accounts; `source` = `budget` when every contributing entry is a budget, `average` when every one is an average, else `mixed`.
- **Numerator = the row's own amount** (user answer 19 Nov 2026): everything in the category, recurring items included, the figure the row already shows. A budgeted category holding a recurring item can therefore exceed 100 %.
- **Top row** (replaces today's "share of total"): amount as today; under it a bar of `amount / reference` (full and `--neg` above 100 %) and "€ 66,90 van € 350,00 · 19 %", with "gemiddelde" (or "budget en gemiddelde" when mixed) after it when the reference is not all budget; over: "€ 12,00 te veel". No reference (an account with no history month; the pseudo rows "Niet gecategoriseerd", "Naar gedeelde/eigen rekening"; saving categories never are expense rows): no bar, the muted text "geen budget". A category with a reference and nothing spent in the column is listed at the end ("€ 0,00 van € 350,00"). Trend stays.
- **Subcategory rows** (the dropdown): their own amount only, no bar and no percentage (budgets exist on top categories only).
- Footnote under the list: "Budget zoals in de planning. Zonder budget: het gemiddelde van wat je de laatste 6 maanden in deze categorie uitgaf. Hier telt alles mee, ook terugkerende posten zoals huur; de planning rekent die apart, dus haar budgetten tonen soms meer ruimte."
- Account sheet ("Per rekening") rows: the same, for that account only.
- Partial columns (running month, first month from day N): the full month's plan, the head says "lopend · tot 18 nov" (as today); no pro-rating.

## Steps
1. **Sonnet**: `sumDetail`, the breakdown sheets, the subcategory dropdown in the list, vitest.
2. **Sonnet**: `budgetRows`, the new row, the footnote, vitest.
3. **Sonnet**: `analysis/screens/overzicht.md` "Deviation (0.8.1)": tiles open breakdown sheets, rows against budget instead of share.

## Tests (vitest; demo fixtures from 0.8.1-1 and 0.8.1-2)
- Alles, November 2026 (running; budgets from 2026-11): Vrije tijd "€ 66,90 van € 350,00 · 19 %"; Vervoer "€ 134,10 van € 300,00 · 45 %"; Boodschappen "€ 295,21 van € 550,00 · 54 %" (unchanged by the answer: no recurring item sits in these categories, so the full amount equals Planning's spent); Overig "€ 0,00 van € 350,45 · 0 %" with "budget en gemiddelde" (28798 budget + the shared account's full average, 6247 if lead confirms it equals the engine's); Wonen "€ 1.150,00 van € 1.150,00 · 100 % · gemiddelde" and Abonnementen "€ 68,96 van € 68,96 · 100 % · gemiddelde" if the lead's derived averages are 100500 + 14500 and 2598 + 4298 (the demo charges them every month; confirm May–Oct); "Niet gecategoriseerd" "geen budget".
- Gedeeld, November: Boodschappen 54 %; Overig "€ 0,00 van € 62,47 · gemiddelde" (lead confirms 6247).
- Alles, October (averages only): Vrije tijd 2795 of 4028 → 69 % "gemiddelde"; Vervoer 14060 of 12900 → 109 %, bar full in `--neg`, "€ 11,60 te veel"; Overig 6562 of 7147 (900 + 6247) → 92 %. (Boodschappen October: lead derives the shared average.)
- Kwartaal or Eigen over Oct–Nov: Vrije tijd reference 4028 + 35000 = 39028 "budget en gemiddelde".
- Over 100 % by a recurring item (fixture, as `planningWorld` W1): Vrije tijd budget € 20 with the Gym −€ 25 row → "€ 25,00 van € 20,00 · 125 %", "€ 5,00 te veel", while Planning's Budget tab for the same month says "€ 0,00 van € 20,00".
- A subcategory row in the dropdown shows its amount and no percentage.
- Breakdown: the Gespaard sheet of November alles has one row "Naar Spaarrekening € 200,00"; the Uitgaven sheet's rows add up to `s.total`; the Inkomen sheet's rows add up to 331850; a category with a sub row expands and both rows link to `/transacties?categorie=<id>&periode=2026-11`; keyboard: the chevron toggles with Enter and Space and is not the row's own button.
- `?blad=inkomen` after a reload opens the sheet on the default column; an unknown `blad` is dropped (as 0.8-0c).

## Who builds it
- **Sonnet**: all steps.

## Done when
The three tiles open sheets whose rows (and subcategory rows) add up to the tile and each lead to their transactions, and every category row reads its full amount against the same budget as Planning (or the full 6-month average).
