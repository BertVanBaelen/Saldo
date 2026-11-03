# Budget and free to spend

Analysis: 4.5 (2, "Month budget"), 5.3 · Data: `budget` (account, category, monthly amount, from month) · Screens: [planning](../screens/planning.md) (tab "Budget" and the group summary at the top) · Phases: [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.8-2](../../plan/v0.8-planning/02-budgets.md), [0.8-5](../../plan/v0.8-planning/05-free-to-spend.md)

## Variable spending
Variable categories use the budget of the account, or the average of past months, minus what recurring items already cover. A budget belongs to one account; on a shared account members with Bewerken manage it.

## Free to spend ("Vrij te besteden")
```
free(m, account) = balance today (current month) or projected start balance (future month)
               + income still expected this month
               - fixed costs still to pay
               - one-off and planned items still to come
               - remaining budget per category      # budget minus what is already spent
               - transfers to savings and to your other accounts still to come
               - buffer(account)
```
A negative result is shown as **"Tekort"**.

## In the design
- Planning tab "Budget": per account the free-to-spend amount, a month switcher, and the category budgets below it.
- A small summary per account at the top of Planning opens this tab.
- Editing a budget (designed in the mockup): amount with − / + in € 10 steps, "use the average of the last 6 months", or no budget (the planning then uses the average); it applies from the chosen month.
- Chips: "Over € …" (green soft) and "Tekort € …" (neg soft), always for one account. There is no combined free-to-spend amount ([scope](scope.md)).
- Labels: "Vrij te besteden", "Tekort", "Verwachte kosten zijn al afgetrokken", "Blijft altijd staan" (the buffer).

## Demo values (November 2026)
- Free to spend: Zichtrekening € 365,44, Gedeelde rekening € 46,86. In February the Zichtrekening has "Tekort € 1.933,47".
- Category budgets: Boodschappen € 650 (spent € 412,80, shared), Vrije tijd € 350 (€ 138,20), Vervoer € 300 (€ 96,40), Overig € 287,98, Overig gedeeld € 62,02.
