# 0.9.1-5a · Budgetten: stepper, Vast + Extra = Totaal, warnings, prefill

| | |
|---|---|
| Version | [0.9.1 Improvements](README.md) |
| Status | built 25 Nov 2026; released as 0.9.1 |
| Size | M |
| Features | IMP-5 |
| Concepts | [budget](../../analysis/concepts/budget.md), [recurring-item](../../analysis/concepts/recurring-item.md) |
| Screens | [planning](../../analysis/screens/planning.md) (Planning instellen › Budgetten) |
| Depends on | [0.9.1-4](04-budget-total-engine.md) (`total`, `recurring`, `average=1`), [0.9.1-3](03-item-category.md) (`categoryId`, `suggestedCategoryId`, the item sheet); **wave 1 (0.9.1-1, 0.9.1-2) merged and verified** before it starts |
| Who | Opus (step 1: the impact formula, `itemAmountIn`, `budgetWarnings`, `monthlyFixed`), Sonnet (steps 2–3: the screen) |
| Files | `web/src/lib/planningImpact.ts` (+ test), new `web/src/lib/budgetTotal.ts` (+ test), `web/src/pages/PlanningInstellenBudget.tsx` (+ test), `PlanningInstellen.tsx`, `PlanningInstellen.css` |

**Builder:** use the graphify skill to find dependencies before editing, and the ponytail skill: the smallest change that fully solves the phase.

## Goal
The rows of request 3 (25 Nov 2026): Planning instellen › Budgetten shows, per account and for the running month or any later month (a stepper), each budgeted category as **Vast + Extra = Totaal**, warns on the row when the total is below the month's fixed costs or below the 6-month average, lists the items behind "Vast", and prefills a new budget sensibly. The user changes a total themselves with − / + (no raise helper: README decision 18). 0.9.1-5b adds the "Zonder categorie" list and rewrites the texts.

## What exists (read 25 Nov 2026)
- `useBudgetEditor` and `BudgetSection` (`pages/PlanningInstellenBudget.tsx`): rows are the entries with `source === 'budget'` of the month a change counts from (`fromMonth`, `:118-145`); the stepper starts from `entry.plan` (`:210-216`), the shown amount is `draft ?? entry.plan` (`:137`), a draft is dropped once `entry.plan === v` (`:205`), "Budget toevoegen" prefills the variable average rounded up (`:279-285`, `:415`), the tile's "€ 938 per maand" is Σ `plan` (`totalOf`), "Geldt vanaf februari 2027 en de maanden erna." when `fromMonth` is not the running month (`:318-322`).
- `fromMonth` comes from `?maand` (offset 0–24 from the running month; the horizon grows with it, `pages/PlanningInstellen.tsx:183-200`). `SetBudget` upserts the row of that month and deletes the category's later rows (`server/internal/ledger/planning.go:483-511`).
- The strip: `impactOf`/`impactEnds` (`lib/planningImpact.ts:31-76`), per month `new − old(m)` with `old = entry.plan`, the running month netted against `spent`.
- `expectedContributions` computes an item's amount in a month from its frequency, month and end date (`lib/planningMonths.ts:204-220`).
- `PlanningInstellen.tsx` already loads the items (`api.planningItems`, `:193`); `api.reportBudgets(q)` takes `scope`, `account`, `from`, `to` (`lib/types.ts:600-608`) and, from 0.9.1-4, `average`.

## Rules
**Month stepper** (README decision 13): under the section title, "‹ november 2026 ›" (buttons "Vorige maand" / "Volgende maand"; the previous disabled on the running month, the next on running + 24), writing `?maand` with `replace` as the Budget tab's "Aanpassen" does. The rows, sums and warnings are that month's. An edit applies **from that month onward** (`SetBudget` writes the month and deletes the later rows); the existing note "Geldt vanaf januari 2027 en de maanden erna." says so whenever the month is not the running one. No helper splits a one-month change: the user who wants one month higher sets that month, steps to the next month and sets it back (README known limits).

**A budget row** (entries with `source === 'budget'` in the month):
- Top line as today: dot, name, − / + in € 10 on the **total** (`entry.total ?? entry.plan`), the amount.
- The sum line, only when `recurring > 0` (without it the row is today's): "Vast € 25 + Extra € 5 = € 30" (whole euros, `eur0`); the sum is `recurring + plan` = `max(total, recurring)`, what the month costs in the plan. When the total is below Vast: "Vast € 684 + Extra € 0 = € 684" and the warning names the budget (README decision 17); the − / + keeps showing the budget.
- The bar and "€ 67 besteed deze maand": the running month only, **variable spending against the extra** (`spent` / `plan`); later months no bar. This differs on purpose from Overzicht, which reads everything booked in the category against the total (README decision 24); 0.9.1-5b's footnote says so.
- "gemiddeld € 412": the full-amount 6-month average from `api.reportBudgets({ scope, account, from: running, to: running, average: true })`: the same call shape as Overzicht (`Overzicht.tsx:523`, which sends `scope` and `account`), one request per account in view (review nit 17). While it loads or when it fails, left out, and so is the average warning.
- The draft logic moves from `plan` to `total`: `step` starts from `entry.total`, the shown amount is `draft ?? entry.total`, a draft is dropped once `entry.total === v`. The tile's sum is Σ `total`.
- **Warnings** (one pure helper `budgetWarnings(total, recurring, average, month)` in the new `lib/budgetTotal.ts`, the only place they are decided): `total < recurring` → "Je budget € 288 is lager dan de vaste kosten van januari (€ 684)"; `average !== null && total < average` → "Je budget is lager dan je gemiddelde (€ 412)"; both lines when both hold; tone `--warn` (a choice, not an error), on the budget row only, `role="note"`. **No button** (README decision 18): the user adjusts the total with − / +.
- **Assigned items** of the row: a toggle "Vaste kosten (2)" lists the account's confirmed expense items assigned to that category (its top or a sub) with an occurrence in the month (`itemAmountIn(item, month) ≠ 0`): name, "Maandelijks · 1e", amount; a tap opens the item sheet (0.9.1-3). An item whose `categoryId` differs from its `suggestedCategoryId` shows "Betalingen staan meestal in Abonnementen".

**Categories with fixed costs but no budget**: under the rows, "Vaste kosten zonder budget": per category with `recurring > 0` and `source === 'average'` in the month: name, "Vast € 1.005 · geen budget"; a tap opens "Budget toevoegen" on it.

**"Budget toevoegen" prefill** (user decision 25 Nov 2026, README decision 14): `monthlyFixed + average`, rounded **up** to whole euros, where `monthlyFixed` = Σ −amount of the account's confirmed expense items of frequency **monthly** assigned to that top (or a sub of it) whose end date is not before the running month (yearly and quarterly items left out), and `average` the forecast entry's variable `average` (0 when absent). The same in every month of the stepper. The row of the list shows "Vast € 26 per maand · gemiddeld € 40". One pure helper `monthlyFixed(items, accountId, topId, tree, running)` in `lib/budgetTotal.ts`. Items with the amount rule "gemiddelde" count with their stored amount.

**The strip** (Opus, `lib/planningImpact.ts`), one formula for a total change (this phase) and an assignment change (used by 0.9.1-5b). Per account, per category c and month m ≥ F (F = `fromMonth` for a total, the running month for an assignment), with the entry's `plan` as `old`:
- `T` = the changed total, else `entry.total` when `entry.source === 'budget'`, else none;
- `R` = `entry.recurring` + the amounts the change assigns to c in m − those it takes away (an item's amount in m: `itemAmountIn(item, month)`, `expectedContributions` generalised to one item: frequency, month, day and end date, stored amount);
- `new` = `max(0, T − R)` with a total; a removed total (`null`) = the variable average (as today); no total and no change of total = `old` (an assignment to a category without a budget moves nothing);
- Δ(m) = `new − old` for a later month, `max(0, new − spent) − max(0, old − spent)` for the running month (0 on its last day); the ends move by the running sum (unchanged).
- Every existing case of `planningImpact.test.ts` (recurring 0) keeps its number; `BudgetChange` gets `total` instead of `plan`; a new `AssignChange { item, from: topId | null, to: topId | null }`.
- An item with the amount rule "gemiddelde" is previewed with its stored amount; the strip after saving is the engine's (README known limits).

## Steps
1. **Opus**: `itemAmountIn`, `impactEnds`/`impactOf` with total and assignment changes, `budgetWarnings`, `monthlyFixed`; vitest (below).
2. **Sonnet**: the stepper, the row (total, sum line, bar on the extra, the average request, warnings), the draft logic on `total`, the tile sum; `PlanningInstellenBudget.test.tsx`.
3. **Sonnet**: the assigned-items toggle with the hint, "Vaste kosten zonder budget", the prefill; tests.

## Tests (vitest; fixtures shaped like the demo plus `TestWorldTotal`'s numbers, which the lead derived in 0.9.1-4)
- `budgetWarnings(28798, 68400, 900, '2027-01')` → only "Je budget € 288 is lager dan de vaste kosten van januari (€ 684)"; `(35000, 0, 4028)` → none; `(30000, 0, 41200)` → only "Je budget is lager dan je gemiddelde (€ 412)"; `(28798, 68400, 90000)` → both; `average` `null` → never the average warning.
- `monthlyFixed`: Netflix −1399 and Spotify −1199 monthly on Abonnementen → 2598; a yearly −68400 on the same top is left out; an item ended before the running month is left out; an item on a sub counts for its top.
- Strip: a total change on a category with `recurring` 2500 in one month and 0 in the next moves the ends by `max(0, T − 2500) − old` and `T − old`; assigning a monthly −1000 item to a category with total 10000 and recurring 0 raises every later end by 1000 per month, to a category without a budget moves nothing; the running month nets against `spent`; on the month's last day the running month moves nothing; every existing case unchanged.
- Budgetten, Zichtrekening, demo with Familiale verzekering assigned to Overig, `?maand=2027-01`: Overig "Vast € 684 + Extra € 0 = € 684", the − / + at € 288, the warning "Je budget € 288 is lager dan de vaste kosten van januari (€ 684)" (no average warning: Overig's full average is 900), **no button**; "Geldt vanaf januari 2027 en de maanden erna."; one + press saves `PUT {categoryId: Overig, fromMonth: "2027-01", amount: 29798}`; November shows Overig without a sum line and with "€ 0 besteed deze maand".
- The stepper: "Vorige maand" disabled on November, the next writes `?maand=2026-12` with `replace`; on `?maand=2028-11` (running + 24) "Volgende maand" is disabled.
- A press on a row with `total` 35000 and `plan` 30000 (recurring 5000) shows € 360 and saves 36000.
- The reference request carries `scope`, `account`, `from`, `to` and `average=1`.
- "Budget toevoegen" on Abonnementen with Netflix and Spotify assigned and `average` 0: prefill € 26, the same with `?maand=2027-01`.

## Who builds it
- **Opus**: step 1. **Sonnet**: steps 2–3.

## Done when
On Budgetten each budgeted category reads Vast + Extra = Totaal for the month in the stepper, the − / + changes the total from that month onward (and the note says so), a row below its fixed costs or its 6-month average says so on the row, the items behind Vast are listed, a new budget is prefilled with the monthly fixed costs plus the average, and the strip previews total changes with the new formula.
