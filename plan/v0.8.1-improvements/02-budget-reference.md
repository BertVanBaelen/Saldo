# 0.8.1-2 · Budget reference per category and month

| | |
|---|---|
| Version | [0.8.1 Improvements](README.md) |
| Status | planned (reworked 19 Nov 2026 after the user's answer on item 6) |
| Size | M |
| Items | 6 |
| Concepts | [budget](../../analysis/concepts/budget.md), [period-overview](../../analysis/concepts/period-overview.md) |
| Screens | [overzicht](../../analysis/screens/overzicht.md) |
| Depends on | – (0.7-1 report, 0.8-1 budget rows, 0.8-3 history-month rule) |
| Files | `server/internal/planning/forecast_project.go` (two small helpers out, `Budget.Average`), new `planning/reference.go` + test, `server/internal/ledger/reports.go` (exported `ReportSelection` wrapper), new `server/internal/server/reports_budgets.go` + test, `server/internal/server/planning_forecast.go` (`planBudget` gets `Average`: it is a struct conversion of `planning.Budget`), `privacy_test.go`, `docs/api.md`, `web/src/lib/{types,api,planning}.ts` (`PlanBudget.average`) |

## Goal
Item 6, user answer 19 Nov 2026: the percentage per category counts **everything in the category**, Overzicht's own amount with recurring items included, against the budget of Planning; a category without a budget compares to the average of the last 6 months. This phase gives Overzicht that reference per account, category and month; the screen is 0.8.1-4.

## Rules
- **Numerator** (0.8.1-4): the report's own amount for the top category (`expenses[<topId>]`), the number the row already shows. Nothing new is computed for it.
- **Reference with a budget**: the account's budget row for that category with the greatest `from_month` ≤ m (0.8-1), the same row Planning uses. A NULL row or no row: the average below.
- **Reference without a budget: a full-amount average from the report's own rule** (not the engine's average). The engine's average is variable spending only (rows matched to a confirmed recurring item left out, 0.8 decision 3); compared with a numerator that includes those rows it would put every category with a recurring item far above 100 % (Wonen: € 1.150 against an engine average of € 0). So the reference is a second figure, defined to match the numerator:
  - **amounts**: per account alone (selection = that one account, as `ReportMonths` with `account=<id>` for the same viewer), `expenses[<topId>]` per history month (rows and split parts, refunds net, saving categories and transfers never in a category key: exactly what the row counts);
  - **months**: the engine's history months (0.8-3 rule 7: at most the 6 complete months before the running month, from the account's first booked month when that row is on the 1st, else the month after, only months holding a booked row of the account). The rule moves into one exported function `planning.HistoryMonths(first string, booked map[string]bool, today string) []string` that `Project` calls too;
  - **average** = round(Σ amounts / n), never below 0; n = 0 → no reference ("geen budget").
  - It is the same for every month of a period (it is defined relative to today, as the engine's).
- **Budget lookup** moves into `planning.BudgetFor(rows []FactBudget, category int64, month string) (amount int64, ok bool)` (`Project` calls it): one rule for "which budget row applies".
- **Planning's figures stay as they are**: the engine, its average and the Budget tab's "€ x van € y" (variable spending against the plan) do not change. 0.8.1-8 needs the engine's average next to each budget ("gemiddeld € Y"), so `planning.Budget` gains `Average` (the existing `avg[c]`) and `GET /api/planning`'s `budgets` entries carry `average`.
- **Where the two screens differ** (documented, footnote in 0.8.1-4): (1) a budgeted category holding a recurring item or a transfer that carries its category: Overzicht counts it, Planning's "al besteed" does not (`planningWorld` W1: Vrije tijd with the Gym item); (2) a category without a budget: Overzicht's average includes recurring rows, Planning's does not (demo: Wonen and Abonnementen have a reference on Overzicht and none in Planning); (3) the Budget tab shows the running month only, Overzicht any period.
- **No engine spending pass is extracted** (review 19 Nov 2026): with the full-amount numerator the reference needs neither the engine's `spent` nor older occurrences, so `Project`'s matching window stays exactly as it is. Only `HistoryMonths` and `BudgetFor` move out.
- **Route** (server layer, `planning` + `ledger`; `reportSelection` is unexported, so `ledger` gets an exported `ReportSelection` that 0.8.1-5 uses too): `GET /api/reports/budgets?scope=&account=&from=YYYY-MM&to=YYYY-MM`, selection and errors as `GET /api/reports/months` (savings account `400`, hidden `404`, `to` ≤ the running month). It reads budget rows (`ledger`, account-level), the history months per account (`planning.HistoryMonths` on the account's booked months) and the per-account report for those months (`ReportMonths` with `account`, same viewer). Answer:
  ```json
  {"months": [{"month": "2026-11", "accounts": [{"id": 1, "categories": [{"categoryId": 3, "reference": 35000, "source": "budget"}, {"categoryId": 1, "reference": 100500, "source": "average"}]}]}]}
  ```
  Months before the account's first booked month carry no categories. Saving categories never appear (they have no expense key).
- **Viewer**: the average follows the viewer's report for that one account. For a shared account Bert and Partner can differ only when one of them marked a categorised row of it "is een overschrijving" (it then leaves the category for that viewer, numerator and reference alike). Budgets are account-level.

## Steps
1. **Opus**: `HistoryMonths`, `BudgetFor`, `Budget.Average`, `Project` calling them with every 0.8-3 golden unchanged; `TestHistoryMonths` (the W1 partial first month gives n = 1, a gap month is skipped).
2. **Sonnet**: the route, its handler test, the privacy row, `docs/api.md` "Reports" and "Planning" (`average`), `lib/types.ts` + `api.reportBudgets`.

## Tests (exact where the 0.7 and 0.8 tables give the numbers)
- **Demo, today 2026-11-18, Bert**:
  - Zichtrekening (account 1) November: Vrije tijd 35000 budget, Vervoer 30000 budget, Overig 28798 budget; Wonen average (lead derives from May–Oct of account 1; 100500 if every month holds Huur 100500 only, as October and November do), Abonnementen average (lead derives; October and November are 2598).
  - Gedeelde rekening (account 4) November: Boodschappen 55000 budget; Overig average 6247 if equal to the engine's (no confirmed item in Overig: lead confirms); Wonen average (lead derives; October and November 14500); Abonnementen (4298 in Oct and Nov).
  - October (no budget rows before 2026-11): every listed category `average`; Vrije tijd 4028 and Vervoer 12900 on account 1 (equal to the engine's 0.8-3 averages because no confirmed item sits in them; the test asserts equality with the engine for these two and inequality for Wonen).
  - 2025-10 (before the first booked month 2025-11): no categories.
- **`planningWorld` W1** (the case the demo cannot catch): the engine's Vrije tijd average excludes the matched Gym row, the reference includes it: for W1's single history month (October 2026) reference Vrije tijd 2500, engine average 0; Boodschappen reference 5000 = engine average 5000 (6000 − 1000 refund).
- **Identity**: `BudgetFor` and `HistoryMonths` used by `Project` give the 0.8-3 goldens unchanged (`TestForecastDemo`, `planningWorld`, the edge tests).
- Handler: `account=2` `400` "Kies een betaalrekening."; Partner's personal account for Bert `404`; Bert and Partner byte-identical for `account=4` on the demo (no override in the seed).

## Who builds it
- **Opus**: step 1. **Sonnet**: step 2.

## Done when
Overzicht can ask for each category's reference (budget, else a full-amount 6-month average from the report's own rule) for any period, and the 0.8-3 goldens are unchanged.
