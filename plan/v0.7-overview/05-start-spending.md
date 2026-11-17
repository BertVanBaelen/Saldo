# 0.7-5 · Start: "Uitgaven november" card

| | |
|---|---|
| Version | [0.7 Overview](README.md) |
| Status | built (0.7.0-dev), to verify |
| Size | S |
| Features | OVER-3 |
| Concepts | [scope](../../analysis/concepts/scope.md), [category](../../analysis/concepts/category.md), [internal-transfer](../../analysis/concepts/internal-transfer.md) |
| Screens | [start](../../analysis/screens/start.md) |
| Depends on | [0.7-1](01-reports-api.md); [0.7-3](03-overzicht-screen.md) for `lib/reports.ts` (`catRows`) |

## Goal
Start shows what went out this month per account, by category and transfer row, with the same numbers as Overzicht, and links to Overzicht.

## What exists (17 Nov 2026)
The alert "N transacties te categoriseren" (0.4-3, `ledger/alerts.go`) and the "Bijdragen november" row on the shared hero and card (0.6-5) are built. `Start.tsx` says "the spending card (0.7) arrive[s] later". Left: the spending card only.

## Rules (user decision 17 Nov 2026: Start includes "Naar gedeelde rekening", deviating from the mockup)
- One request: `api.reportMonths({ scope, from: <running month>, to: <running month> })`.
- **Every expense key of the report counts**, as on Overzicht: the categories, `none` ("Niet gecategoriseerd"), `toShared` ("Naar gedeelde rekening", `--shared`) and `toOwn` ("Naar eigen rekening"). Pending rows do not count (0.7-1).
- **One account in the scope**: one block = the month's expenses for that selection; the total in the section head. In Persoonlijk the Zichtrekening block therefore holds the € 450 "Naar gedeelde rekening".
- **Several accounts**: one block per account from the per-account lists (`months[0].accounts`, S = {that account}, so each account counts its own transfers). The section head shows "samen" = the report's **total** expenses for the scope (internal transfers left out), aria label "Samen € 1.756,42, ter info". When the blocks add up to more than "samen" (sum of the blocks' totals minus the total expenses > 0), a footnote under the card: "Overschrijvingen tussen je eigen rekeningen (€ 450,00) tellen per rekening mee, maar niet in het totaal samen." (Overzicht's footnote uses the incomes; Start's uses the expenses; in the demo both are € 450.) The shared account's incoming contributions are income, so they are not in any block.
- Per block: the 10 px square in the account colour, the name (14/600), its own total (Mono 13, muted), the stacked 12 px share bar and the rows (dot, name, share %, amount), largest first, via `catRows`.
- An account without spending this month shows "Nog niets uitgegeven in november." A scope with no current account shows no card. A failed request leaves the card out (Start works without it, as with the contributions). The card links to `/overzicht`.
- Desktop: the card is the first column of the auto-fit grid (Uitgaven · Persoonlijk · Gedeeld).

## Steps
1. `SpendingCard` in `web/src/pages/Start.tsx` (or `StartSpending.tsx`), loaded once per scope and `dataVersion`, using `catRows` from `lib/reports.ts`; CSS from `finance-mockup/css/screens/start.css` (`.share-bar`, `.share-rows`, `.start-spend-*`) plus a footnote style like Overzicht's `.ov-per-foot`.
2. Remove the 0.7 note from the header comment of `Start.tsx`; `analysis/screens/start.md` and `docs/local-testing.md` (the numbers below).

## Tests
- vitest `Start.test.tsx` with mocked reports for November 2026 (the 0.7-1 numbers):
  - alles: blocks Zichtrekening € 1.723,23 (Wonen 1.005,00, Naar gedeelde rekening 450,00, Vervoer 134,10, Vrije tijd 66,90, Niet gecategoriseerd 41,25, Abonnementen 25,98) and Gedeelde rekening € 483,19 (Boodschappen 295,21, Wonen 145,00, Abonnementen 42,98); head "samen € 1.756,42"; footnote with € 450,00.
  - persoonlijk: one block € 1.723,23 including "Naar gedeelde rekening", total in the head, no footnote.
  - gedeeld: one block € 483,19.
  - shares rounded; a failed request shows the rest of Start; the card links to `/overzicht`; a `dataVersion` bump reloads it.

## Who builds it
- **Sonnet**: all of it.

## Done when
Start matches the mockup for everything except the forecast parts (0.8-6) and the decided deviation (transfer rows in the blocks, the footnote), with the story's November amounts, and every Start number equals Overzicht's for the same scope and month.

## Demo numbers (17 Nov 2026, from the story)
November 2026 to the 18th, Bert: Zichtrekening block 172323 (127323 in categories and `none` + 45000 `toShared`), Gedeelde rekening block 48319, samen 175642, footnote 45000. The mockup's € 1.852,37 / € 1.251,59 / € 600,78 are illustrative and leave out the contribution.
