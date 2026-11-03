# Budget and free to spend

Analysis: 4.5 (2, "Month budget"), 5.3 · Data: `budget` (owner user + scope, category, monthly amount) · Screens: [planning](../screens/planning.md) (tab "Budget" and the group summary at the top) · Phases: [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.7-2](../../plan/v0.7-planning/02-budgets.md), [0.7-5](../../plan/v0.7-planning/05-free-to-spend.md)

## Variable spending
Variable categories use the budget, or the average of past months, minus what recurring items already cover.

## Free to spend ("Vrij te besteden")
```
free(m, group) = balance today (current month) or projected start balance (future month)
               + income still expected this month
               - fixed costs still to pay
               - one-off and planned items still to come
               - remaining budget per category      # budget minus what is already spent
               - transfers to savings still to come
               - buffer(group)
```
A negative result is shown as **"Tekort"**.

## In the design
- Planning tab "Budget": per group the free-to-spend amount, a month switcher, and the category budgets below it.
- A small summary per group at the top of Planning opens this tab.
- Chips: "Over € 412,30" (green soft) and "Tekort € 131,64" (neg soft). These are the Alles **combined** month results (see the open question in [account-group](account-group.md)).
- Labels: "Vrij te besteden", "Tekort", "Verwachte kosten zijn al afgetrokken", "Blijft altijd staan" (the buffer).

## Demo values (November 2026)
- Free to spend: Persoonlijk € 365,44, Gedeelde rekening € 46,86. In February Persoonlijk "Tekort € 1.933,47".
- Category budgets: Boodschappen € 650 (spent € 412,80, shared), Vrije tijd € 350 (€ 138,20), Vervoer € 300 (€ 96,40), Overig € 287,98, Overig gedeeld € 62,02.
