# Budget and free to spend

Analysis: 4.5 (2, "Month budget"), 5.3 · Data: `budget` (account, category, monthly amount, from month) · Screens: [planning](../screens/planning.md) (tab "Budget" and the group summary at the top) · Phases: [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.8-1](../../plan/v0.8-planning/01-planning-data.md), [0.8-3](../../plan/v0.8-planning/03-forecast-engine.md), [0.8-6](../../plan/v0.8-planning/06-maanden-and-budget.md)

## Variable spending
Per account and **expense top category that is not a saving category**: the budget of the account, or the average of the past complete months (at most 6, only since the account's history starts), of the rows that are not matched to a recurring item. A budget row applies from its month on until a later row; a row without amount means "no budget, use the average" from that month. A budget belongs to one account; on a shared account members with Bewerken manage it. Saving categories have no budget. Uncategorised rows are not forecast (plan 0.8 known limits).

## Free to spend ("Vrij te besteden")
```
free(m, account) = balance today (current month) or projected start balance (future month)
               + income still expected this month
               - fixed costs still to pay
               - one-off and planned items still to come
               - remaining budget per category      # budget minus what is already spent
               - transfers to savings and to your other accounts still to come
               - buffer(account)
               = projected end of month m - buffer(account)
```
The two lines are the same number (plan 0.8 decision 4). A negative result is shown as **"Tekort"**.

## Required contribution (shared accounts)
The shared account's Budget card shows what the members must pay in this month: "Nodig: € 872" (fixed costs and budgets, plus what reaches the buffer) and each member's part by their share. See [shared-account](shared-account.md); plan 0.8-6.

## In the design
- Planning tab "Budget": per account the free-to-spend amount, a month switcher, and the category budgets below it.
- A small summary per account at the top of Planning opens this tab.
- Editing a budget (not in the mockup; designed in plan 0.8-6): amount with − / + in € 10 steps, "Gebruik het gemiddelde", or "Geen budget" (the planning then uses the average); it applies from the month shown.
- Chips: "Over € …" (green soft) and "Tekort € …" (neg soft), always for one account. There is no combined free-to-spend amount ([scope](scope.md)).
- Labels: "Vrij te besteden", "Tekort", "Verwachte kosten zijn al afgetrokken", "Blijft altijd staan" (the buffer).

## Demo values (November 2026)
- Mockup: free to spend Zichtrekening € 365,44, Gedeelde rekening € 46,86; February Zichtrekening "Tekort € 1.933,47". Category budgets Boodschappen € 650 (spent € 412,80, shared), Vrije tijd € 350 (€ 138,20), Vervoer € 300 (€ 96,40), Overig € 287,98, Overig gedeeld € 62,02.
- The app (story and seed of plan 0.8-1): Zichtrekening € 306,85 (Vrije tijd € 66,90 of € 350, Vervoer € 134,10 of € 300, Overig € 0 of € 287,98), Gedeelde rekening € 28,82 (Boodschappen € 295,21 of € 550, Overig € 0 of the average € 62,47); February Zichtrekening "Tekort € 2.034,03".
