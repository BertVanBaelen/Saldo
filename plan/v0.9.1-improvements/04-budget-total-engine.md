# 0.9.1-4 · Budget as total: engine, contributions, wire

| | |
|---|---|
| Version | [0.9.1 Improvements](README.md) |
| Status | built 25 Nov 2026; released as 0.9.1 |
| Size | M |
| Features | IMP-4 |
| Concepts | [budget](../../analysis/concepts/budget.md), [forecast](../../analysis/concepts/forecast.md), [recurring-item](../../analysis/concepts/recurring-item.md), [shared-account](../../analysis/concepts/shared-account.md) |
| Screens | [planning](../../analysis/screens/planning.md), [overzicht](../../analysis/screens/overzicht.md) |
| Depends on | [0.9.1-3](03-item-category.md) (the stored category, the extracted match pass) |
| Who | Opus (steps 1–2: engine, loader, `TestWorldTotal`), Sonnet (step 3: wire, `average=1`, docs, web types) |
| Files | `server/internal/planning/forecast_load.go`, `forecast_project.go`, `budget_reference.go`, `world_test.go` (a new test only), `server/internal/server/planning_forecast.go`, `reports_budgets.go` (+ tests), `privacy_test.go`, `docs/api.md`, `web/src/lib/planning.ts`, `web/src/lib/types.ts`, `web/src/lib/api.ts` |

**Builder:** use the graphify skill to find dependencies before editing, and the ponytail skill: the smallest change that fully solves the phase.

## Goal
The budget a user sets per top category becomes the **total** for the month (user decision 25 Nov 2026): the month's assigned recurring costs are part of it, and the forecast plans only what is left on top, the extra. Contributions follow; Overzicht's reference was already the full amount against the budget and now means the same thing as Planning. The two warnings get their numbers (the screens are 0.9.1-5a and 0.9.1-5b).

## What exists (read 25 Nov 2026)
- `planning.Budget` `{CategoryID, Plan, Source, Spent, Rest, Average}` (`forecast_project.go:79-88`). The categories are those with variable spending or a budget row (`:469-494`); `plan(c, m)` is the budget row (`BudgetFor`) else the variable average (`:505-510`); per month each category's `Plan`, its `Spent` (running month only) and `Rest = max(0, Plan − Spent)` (`:545-559`); an entry is kept only when `Plan != 0 || Spent != 0` (`:555`); `varTotal` = Σ `Rest` is spread over the days (`:558-621`).
- Recurring items are separate lines (`recurringOut`, `saving`) from their occurrences (`:286-309`, `:378-416`); a matched row is never variable spending (`:473`).
- `Need.Costs` = `planTotal` (Σ `Plan`) + every negative occurrence of the month, paid or not (`:661-673`); `Need.Amount = max(0, Costs − OtherIncome + BufferGap)` (`:683-685`); the members' parts come from it (`planning/contribution.go`, `server/planning_forecast.go:239-258`), and so do the "Bijdrage ontbreekt" trigger (`notify/contrib.go:121-133`) and the planning warnings (`notify/planning.go:124`).
- The loader reads confirmed items without a category (`forecast_load.go:36-38`) and budgets of valid categories only (`:39-40`).
- The wire: `planBudget` mirrors `planning.Budget` field for field because it is a struct conversion (`server/planning_forecast.go:35-42`, `:224`).
- Overzicht's reference (`planning/budget_reference.go`): a budget row when one applies, else the full-amount 6-month average from the viewer's own report (`:41-102`); `In` lists the average only for categories without a budget (`:95-99`); `GET /api/reports/budgets` (`server/reports_budgets.go`) answers `{categoryId, reference, source}`; its answer is pinned in `testdata/reports_budgets_golden.txt`.

## Rules (the engine; one place: `Project`)
- **Assigned item** (loader): `FactItem.Category int64` = the **top** of the item's category when the item is a confirmed `expense` item and that top is an expense category that is not saving, else 0 (`fcQueryItems` joins `categories c` and `categories t ON t.id = COALESCE(c.parent_id, c.id)`; the check repeats 0.9.1-3's so a stale row never counts).
- **recurring(c, m)** = −Σ of the amounts of every occurrence dated in month m of the items with `Category == c` (the `occs` of `Project`: average items with their averaged amount, end dates honoured; paid, pending, late, missed or still to come alike; a yearly or quarterly item only in its month, user decision). Positive cents. **Missed occurrences count too** (README decision 19): the forecast gives them no balance effect, so they free their part of the total that month (known limit); an assumed-paid unmatched occurrence counts while its differing payment is variable spending, and a late occurrence of last month counts in no month in view (known limits, review findings 3 and 8). Nothing of this is worked around.
- **total(c, m)** = the budget row in effect (`BudgetFor`); none, or a `null` row: no total.
- **plan(c, m)** with a total: `extra = max(0, total − recurring)`, source `budget`; without one: the variable average, source `average`, exactly as today (an assigned item does not change the average).
- **Spent, Rest, the spread**: unchanged on `Plan` (`Spent` is variable spending: rows not matched to an item; `Rest = max(0, Plan − Spent)`). So in a month the category takes `recurring` through the item lines and up to `extra` through the spread: `max(total, recurring)` in all.
- **Which categories are listed** (README decision 12): those with variable spending, a budget row, or an assigned item with an occurrence in any month of the answer. An entry is kept when `Plan != 0 || Spent != 0 || Source == "budget" || Recurring != 0`.
- **`Budget` gains** `Total int64` (the budget row's amount, 0 for `average`) and `Recurring int64`. `Average` stays the variable average.
- **Need** follows without code of its own: `planTotal` is Σ `Plan`, so a budgeted category with assigned items costs `max(total, recurring)` instead of `total + recurring`; the need drops by `min(total, recurring)` for it.
- **Nothing assigned, nothing changes**: with every `Category` 0, `recurring` is 0 everywhere, `Plan = total`, and the new keep-condition only adds budget entries of amount 0 with nothing spent, which no existing fixture holds (the builder confirms with a grep of the test budgets before step 1). Every golden of the README's "Goldens" stays byte-identical.
- **A budget of 0 is now listed** (README decision 22, review finding 11): `SetBudget` accepts 0 (`ledger/planning.go:478`); such a row with nothing spent used to vanish from the forecast (`forecast_project.go:555`) and from the Budgetten rows; now it is an entry with `plan 0`. A visible production change: named in `docs/api.md` "Forecast" and in the CHANGELOG.

## Rules (the wire)
- `GET /api/planning`: each `budgets` entry gets `"total"` and `"recurring"` (cents) after `average`; `plan` is the spread amount (the extra for a budgeted category). Same for every member (account-level).
- `GET /api/reports/budgets?…&average=1` (opt-in, README decisions 11 and 20): every category entry also carries `"average"`, the full-amount 6-month average of 0.8.1-2, **`0` when there is no history** (never left out), also when `source` is `budget`; categories with only an average are listed as today. **How**: a separate wire type in `server/reports_budgets.go` (e.g. `refWithAverage{CategoryID, Reference, Source, Average}`) built from `In(month)` plus `BudgetReference.Average(category int64) int64`, only when `average=1`. `In()`, `RefCategory`, the receipt (`receipt/receipt.go:177-180`) and `testdata/reports_budgets_golden.txt` are untouched. Any other value of `average` is ignored.
- The warnings are **not** on the wire: 0.9.1-5a computes "below recurring" (`total < recurring`, from the forecast) and "below average" (`total < average`, from the reference) in one web helper.

## Steps
1. **Opus**: loader (`FactItem.Category`), `recurring`, the new `plan`, `Total`/`Recurring` on `planning.Budget` **and** the same two fields on `server.planBudget` (`json:"total"`, `json:"recurring"`, in the struct's order: `planBudget(b)` is a struct conversion, `server/planning_forecast.go:35-42`, `:224`, so both change together, review finding 5), the keep-condition, the zero-budget engine test (below); run `go build ./...`, `go vet ./...` and `go test ./internal/planning/... ./internal/server/...`; all existing goldens green **before** writing the new test.
2. **Opus**: `TestWorldTotal` (below), with numbers the lead derived and wrote here before the phase.
3. **Sonnet**: `BudgetReference.Average`, the `average=1` flag in `reports_budgets.go` with a handler test (Bert, account 1, November: Vrije tijd `reference 35000, source budget, average 4028`; without the flag the golden file unchanged), `privacy_test.go` (`average=1` on a hidden account `404`), `docs/api.md` "Forecast" (the two fields, which entries are listed, a budget of 0 listed) and "Reports", `web/src/lib/planning.ts` (`PlanBudget.total?`, `recurring?`: **optional**, as `average?`, so no web fixture changes), `types.ts` (`average?` on a reference), `api.ts` (`reportBudgets` takes `average`).

**0.9.1-4 and 0.9.1-5a ship together**: once items are assigned, the 0.9.0 budget editor would read `plan` (now the extra) as the budget. With nothing assigned `plan` equals the total, so the dev build between the two phases shows no difference.

## Tests
- **Identity**: `TestForecastDemo`, `TestWorld`, `TestWorldDayless`, `TestProjectEdges`, `contribution_test.go`, `server/planning_forecast_test.go`, `planning_alerts_golden_test.go`, `reports_budgets_golden_test.go`, `receipt_test.go`, `notify` byte-identical.
- **`TestWorldTotal`** (new, in `world_test.go`; builds `planningWorld`, then in the test only: assigns Gym to Sport (a sub of Vrije tijd), Verzekering to Vrije tijd, Krant to Supermarkt (a sub of Boodschappen), Water to Boodschappen, Huur to Wonen; adds a Vrije tijd budget of 3000 from 2026-11 on W1; on W2 adds a Boodschappen budget of 25000 from 2026-11 and a confirmed expense item "Energie" −5000 monthly on the 3rd, counterparty "Luminus", assigned to Boodschappen; today 2026-11-18, horizon 24). **Lead derives** every value with a throwaway script from the rules above before the phase; what the rules give by hand, to be confirmed:
  - W1 November: Boodschappen `total 10000, recurring 1000 (Krant), plan 9000, spent 5200, rest 3800`; Vrije tijd `total 3000, recurring 2500 (Gym, its averaged −2500), plan 500, spent 1000, rest 0`; Wonen `total 0, recurring 80000, plan 0, source average`. The November `variable` line −3800 (was −4800), the November end +1000 against `TestWorld`.
  - W1 December: Boodschappen `recurring 5500 (Krant + Water), plan 4500`; Vrije tijd `plan 500`; the `variable` line −5000 (was −10000).
  - W1 January: Boodschappen back to its average (`null` row): `plan 5000, source average, total 0, recurring 1000`.
  - W1 February: Vrije tijd `recurring 32500 (Gym + Verzekering), total 3000, plan 0`, listed (the case of the warning).
  - W1 ends and the lowest month over the horizon: lead derives.
  - W2 November and December `Need`: with the assignment `Costs` = 20000 (extra) + 5000 (Energie) = 25000; the same fixture **without** the assignment gives 25000 + 5000 = 30000; the difference is `min(25000, 5000)` = 5000. `Amount` and `BufferGap`: lead derives.
  - **Identity of the fixture** (review finding 4): the same fixture **without the assignments** (the Vrije tijd budget of 3000, the W2 budget of 25000 and the Energie item kept) is the baseline; with the assignments only the categories that hold an assigned item and have a budget differ from it, by exactly `Plan` = `max(0, total − recurring)` instead of `total` (asserted per category and month). Wonen (no budget) and every unassigned category are equal (`reflect.DeepEqual` on their entries apart from `Recurring`).
  - **Extra cases** (review nit 18; lead derives each, as separate sub-tests on their own copy so the numbers above stand): Water after its end date (ends 2027-06-30): Boodschappen `recurring` from 2027-07 on holds Krant only; a **pending matched** occurrence: an in-test item "Delhaize" −700 monthly on the 18th assigned to Boodschappen matches the pending `2026-11-18` row, its line is `pending` and November's Boodschappen `recurring` includes 700; an assigned **saving** item (in-test "Spaarpot" −2000 monthly, kind `saving`, category Sparen) changes no `Budget` and no end.
- **Zero budget** (step 1, README decision 22): facts with one budget row of 0 from the running month, no spending, nothing assigned → the entry is listed with `plan 0, spent 0, rest 0, total 0, recurring 0, source budget`; before 0.9.1 it was left out.
- **Handler**: `GET /api/planning` for the demo unchanged apart from the two new fields: `total` = `plan` on the `budget` entries and 0 on the `average` ones, `recurring` 0 everywhere (the seed assigns nothing); Bert and Partner byte-identical.

## Done when
A budgeted category with assigned items plans only its extra in every month, the need of a shared account follows, the new numbers of `TestWorldTotal` hold as the lead derived them, every existing golden is unchanged, and the web app can read `total`, `recurring` and the full average.
