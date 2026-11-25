# Budget and free to spend

Analysis: 4.5 (2, "Month budget"), 5.3 · Data: `budget` (account, category, monthly amount, from month) · Screens: [planning](../screens/planning.md) (tab "Budget" and the group summary at the top) · Phases: [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.8-1](../../plan/v0.8-planning/01-planning-data.md), [0.8-3](../../plan/v0.8-planning/03-forecast-engine.md), [0.8-6](../../plan/v0.8-planning/06-maanden-and-budget.md), [0.9.1-4](../../plan/v0.9.1-improvements/04-budget-total-engine.md), [0.9.1-5a](../../plan/v0.9.1-improvements/05a-budgetten-rows.md), [0.9.1-5b](../../plan/v0.9.1-improvements/05b-zonder-categorie-and-texts.md)

## Budget = total (0.9.1)
Per account and **expense top category that is not a saving category**, per month. The budget is the **total** the user allows for the category that month: its fixed costs plus what is spent on top. A budget row applies from its month on until a later row; a row without amount means "no budget, use the average" from that month. A budget belongs to one account; on a shared account members with Bewerken manage it. Saving categories have no budget. Uncategorised rows are not forecast (plan 0.8 known limits).
- **Vast** = `recurring(c, m)`: the month's occurrences of the account's confirmed `expense` items assigned to the category (a subcategory rolls up to its top), each in the month it is paid (yearly and quarterly items only in their month; every occurrence counts, a missed one included). Items without a category ("Zonder categorie") count in no budget ([recurring-item](recurring-item.md)).
- **Extra** = `max(0, total − Vast)`: what the forecast spreads as variable spending (`plan` of a `budgets` entry; `total` and `recurring` are separate fields). Vast + Extra = Totaal, except when the total is below Vast: the month then costs Vast ("Vast € 684 + Extra € 0 = € 684"). Assigning an item to a category **keeps the total and shrinks the extra**; the "Effect op de planning" strip previews it before the user confirms.
- **Without a budget** (or a row without amount): the average of the past complete months (at most 6, only since the account's history starts) of the rows that are not matched to a recurring item; there is no total, and the items assigned to the category count outside it.
- **Two warnings, on the budget row only**: the total is below the month's Vast, and the total is below the category's 6-month average (the full amount booked, per viewer, `GET /api/reports/budgets?average=1`). No helper raises the total: the user uses − / + in the month stepper, and a change applies from the month in view onward (no single-month budget).
- **"Budget toevoegen"** prefills the monthly fixed costs (items of frequency monthly assigned to the category) plus the variable average, rounded up to whole euros, the same in every month. A budget of € 0 stays listed.
- **Two percentages for one category and month, on purpose**: Budgetten measures the running month's variable spending against the extra, Overzicht everything booked in the category against the total (a fixed payment counts there in the category of its payment, in the planning in the category the user gave the item).

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
The shared account's Budget card shows what the members must pay in this month: "Nodig: € 872" (fixed costs and budgets, plus what reaches the buffer) and each member's part by their share. See [shared-account](shared-account.md); plan 0.8-6. A budgeted category with assigned items costs `max(total, Vast)` there, not total + Vast.

## In the design
- Planning tab "Budget": per account the free-to-spend amount, a month switcher, and the category budgets below it.
- A small summary per account at the top of Planning opens this tab.
- Editing a budget (not in the mockup; designed in plans 0.8.1-8 and 0.9.1-5, on Planning instellen › Budgetten): the total with − / + in € 10 steps for the month in the stepper and the months after it, "Verwijderen" (no budget: the planning uses the average), the rows Vast + Extra = Totaal and the two warnings ([planning](../screens/planning.md)).
- Chips: "Over € …" (green soft) and "Tekort € …" (neg soft), always for one account. There is no combined free-to-spend amount ([scope](scope.md)).
- Labels: "Vrij te besteden", "Tekort", "Verwachte kosten zijn al afgetrokken", "Blijft altijd staan" (the buffer).

## Demo values (November 2026)
- Mockup: free to spend Zichtrekening € 365,44, Gedeelde rekening € 46,86; February Zichtrekening "Tekort € 1.933,47". Category budgets Boodschappen € 650 (spent € 412,80, shared), Vrije tijd € 350 (€ 138,20), Vervoer € 300 (€ 96,40), Overig € 287,98, Overig gedeeld € 62,02.
- The app (story and seed of plan 0.8-1): Zichtrekening € 306,85 (Vrije tijd € 66,90 of € 350, Vervoer € 134,10 of € 300, Overig € 0 of € 287,98), Gedeelde rekening € 28,82 (Boodschappen € 295,21 of € 550, Overig € 0 of the average € 62,47); February Zichtrekening "Tekort € 2.034,03".
