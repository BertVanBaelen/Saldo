# 0.9-3c · Overview receipt: data and model

| | |
|---|---|
| Version | [0.9 Notifications](README.md) |
| Status | built 23-25 Nov 2026 (0.9.0-dev; step 1 on 23 Nov, the week golden derived by the lead on 24 Nov) |
| Size | M |
| Features | NOTIF-6 |
| Concepts | [period-overview](../../analysis/concepts/period-overview.md), [category](../../analysis/concepts/category.md), [budget](../../analysis/concepts/budget.md), [internal-transfer](../../analysis/concepts/internal-transfer.md), [scope](../../analysis/concepts/scope.md) |
| Screens | [overzichtbon](../../analysis/screens/overzichtbon.md) (the data it renders) |
| Analysis | 4.4, 4.9, risk 16 |
| Depends on | [0.7-1](../v0.7-overview/01-reports-api.md) (`reportBucket`, `ReportMonths`), [0.8.1-1](../v0.8.1-improvements/01-report-detail.md) (`detail=1`), [0.8.1-2](../v0.8.1-improvements/02-budget-reference.md) (budget reference). **Nothing of the rest of 0.9**: can run in parallel with 0.9-1 and 0.9-2 |
| Who | Opus: step 1 (the range rule in `reports.go`) and step 5 (the cross-check golden). Sonnet: steps 2 to 4, 6, from this file |

## Goal
One server-side model of "what went out in this week or month", with income, expenses per category and subcategory, saved, the result, the comparison with the previous period and (months) the budgets, built **once in Go** so the e-mail of [0.9-3e](03e-week-and-month-overview-notifications.md) and the screen of [0.9-3d](03d-overview-receipt-screen.md) render the same numbers.

## Decisions (23 Nov 2026)
1. **The model is built in Go and served by one route**, `GET /api/reports/receipt`. The e-mail has to be built server-side, so the Go model is the source and the page renders it; there is no second generic range endpoint. The roll-up, ordering, trend and budget rules now exist twice (Go here, TypeScript in `lib/reports.ts` for Overzicht); a cross-check golden (step 5) pins them together. Amounts are never recomputed in the model: it is built from `reportBucket` and the report's own statement.
2. **Weeks reuse the rule, only the grouping differs.** `ReportMonths` groups by `substr(booking_date, 1, 7)`; a week is a date range. Step 1 adds `ReportRange(ctx, viewer, scope, account, from, to)` to `ledger/reports.go`: the same `parts`, the same `reportBucket` and key functions and the same selection, summed over `booking_date BETWEEN from AND to` into **one** `ReportTotals` (with `detail`). Months go through the same function, so a month receipt and `GET /api/reports/months` cannot drift. **Week = ISO week, Monday to Sunday, Brussels dates**; the label is "Week 47 · 16–22 nov", with the ISO week-year around New Year (29 Dec 2025 is in week 1 of 2026).
3. **The comparison runs against the previous full period even while the period is running.** At 19:00 on the Sunday or on the month's last day the period is still "running", and Overzicht gives a running period no trend. The receipt does not follow that rule (Overzicht's own rule does not change): this week against last week, this month against last month, so the message that is sent carries the comparison the user asked for. A running period carries the note "Loopt nog, tot zo 22 nov: de bank geeft de transacties van vandaag pas morgen door." No comparison when the previous period lies outside the history, or the current one is a partial first period ("vanaf 19 nov"); "nieuw" when the previous amount was 0 (the rules of [period-overview](../../analysis/concepts/period-overview.md)).
4. **Pending rows stay out**, as in every report. At 19:00 the last day or two are mostly pending, so a snapshot reads low; this is said in the note, not fixed with a "nog in behandeling" line (a question for the user if the snapshot turns out misleading). The in-app receipt is computed when it is opened, so it is complete once the bank has booked the last days.
5. **Computed on read, nothing stored, no migration.** A push or e-mail says nothing about amounts that could later disagree (the push is generic, the e-mail is labelled "Stand zondag 22 nov, 19:00").
6. **No verdicts** (risk 16). In Alles the budgets are the sum of each account's plan shown as text ("van € 550,00", "54 %"), never coloured; the totals line is "samen · ter info". Trend colour is not used at all on the paper (one ink colour).
7. **Selection and scope** as every report: `scope` (default `alles`) or `account`, the viewer's own current accounts only; another user's accounts never enter a sum. The notifications always use `scope=alles`; the page may switch.

## The model
`receipt.Model` in the new package `server/internal/receipt` (it imports `ledger` and `planning`, as `notify` may; neither imports it):
```json
{
  "period": "week", "from": "2026-11-16", "to": "2026-11-22",
  "label": "Week 47 · 16–22 nov 2026", "scope": "alles", "scopeLabel": "Alle rekeningen samen · ter info",
  "running": true, "partialFrom": null, "stand": "2026-11-22T19:00:00+01:00",
  "income":  { "total": 335000, "prev": 330000, "trend": {"pct": 2, "kind": "up"}, "rows": [ {"name": "Salaris", "amount": 330000}, ... ] },
  "expenses": { "total": 275997, "prev": 255000, "trend": {...}, "groups": [
    { "key": "2", "name": "Boodschappen", "emoji": "🛒", "amount": 64200, "prev": 69000, "trend": {"pct": -7, "kind": "down"},
      "budget": { "amount": 55000, "kind": "budget", "pct": 117 },
      "children": [ {"name": "Supermarkt", "amount": 52000}, {"name": "Boodschappen zelf", "amount": 12200} ] },
    { "key": "none", "name": "Niet gecategoriseerd", "amount": 1200 }, { "key": "toShared", "name": "Naar gedeelde rekening", ... } ] },
  "saved":   { "total": 20000, "prev": 0, "trend": {...}, "rows": [ {"name": "Sparen", "amount": 15000}, {"name": "Spaarrekening", "amount": 5000} ] },
  "result":  { "total": 39003, "prev": 40000 },
  "notes":   [ "Loopt nog, tot zo 22 nov: ...", "Niet volledig: Zichtrekening is niet bijgewerkt sinds ma 16 nov." ]
}
```
Money in cents. Groups sorted by amount, largest first; zero rows left out; `children` are the own-category amounts of `detail` (a subcategory each; the top's own part as the label of the same row in `breakdown` of [0.8.1-4](../v0.8.1-improvements/04-overzicht-breakdown-and-budget.md): reuse that wording, do not invent a second one); a group with one entry has no children. `budget` is present on **months** only (week: absent), the budget row of the account(s), else the full-amount 6-month average (`kind` `average`), the reference of `GET /api/reports/budgets`; a category with neither has none. `result` = income − expenses − saved (the month result of 0.8.1-6). `trend.pct` is the rounded %, `kind` `up` (above +5 %), `down` (below −5 %), `flat`, `new`; absent when no comparison (decision 3).

## Steps
1. **`ReportRange` (Opus; built 23 Nov 2026 as `ReportRange(ctx, viewer, scope, account, from, to, detail) (RangeReport, error)`, `RangeReport` = accounts, `firstDate` and the totals; `ReportMonths` and `ReportRange` share one private statement; it has no future-date check, the route of step 4 rejects future periods).** In `ledger/reports.go`, next to `ReportMonths`, sharing its selection, `parts`, `reportBucket` and key functions and its `detail` (no copy of the rule). Same errors as the months route (hidden or unknown account `404`, savings account `400` "Kies een betaalrekening."). A `from` after `to` or a range over 366 days `400`. Tests: the sum of the days of a month equals the month of `ReportMonths` (all demo months, all scopes, with and without `detail`); a week crossing a month end; a transfer inside the selection stays out; split rows by parts; the 4 s speed test and every 0.7 and 0.8.1 golden unchanged.
2. **The period maths and labels (Sonnet).** `receipt.Week(day)` and `receipt.Month(day)`: from and to, label, previous period, the ISO year, "vanaf <datum>" for a first period that the history only partly covers (the account's `firstDate`), `running` when `to` ≥ today (Brussels, from the clock). Dutch short months as `mail.dutchTime` (the helper moves to `ledger/dutch.go` if it is not there yet). Tests for 2025-12-29 (week 1 of 2026), a 53-week year, 29 February, the 1st on a Monday.
3. **`receipt.Build` (Sonnet).** From `ReportRange` for the period and the previous one, `GET /api/categories` data (the tree: names, emoji, saving flags), and for months `planning`'s budget reference (the function behind `GET /api/reports/budgets`; if it lives in the `server` package, extract it into `planning` first, with its tests, so `receipt` can import it). Notes: "Loopt nog…" when running; "Niet volledig: <naam> is niet bijgewerkt sinds <datum>." for each account of the selection whose sync is failing or stale (the `coveredBy` verdict of `ledger/alerts.go`; manual accounts never); "Je geschiedenis begint op <datum>." for a partial first period. No transactions in the period at all: the model says so (`empty: true`), which the trigger of 3e uses to send nothing.
4. **The route (Sonnet).** `GET /api/reports/receipt?periode=week|maand&van=<YYYY-MM-DD>&scope=…&account=…`. `van` is any date inside the period (the page passes the Monday or the 1st; the server normalises); a date in the future `400` "De periode ligt in de toekomst."; before the history: `200` with `empty: true`; an unknown `periode` `400` "Kies week of maand.". `privacy_test.go`: a row (a user never gets another user's accounts into the model; the same answer for hidden and unknown accounts); `docs/api.md` section "Reports", the receipt.
5. **The cross-check golden (Opus).** On the demo: the October month model equals what Overzicht shows for October through `lib/reports.ts` (`catRows`, `breakdown`, `columnReferences`): the same categories in the same order, subcategory amounts, own-part label, trend rounding (±5 % thresholds are the web's colour rule, not the model's: the model carries `kind` from the same numbers), budget percentages. Implemented as a Go test that reads the web test's golden JSON (a shared fixture in `fixtures/`) so a change to either side fails both. A week golden for 9–15 November from the demo, **derived by the lead on 24 Nov 2026** with an independent script over the raw transactions of both weeks (never the report code) and pinned in `server/internal/receipt/week_golden_test.go` (`TestWeekGolden`): expenses 259,16 (Boodschappen 82,84, Vrije tijd 66,90, Abonnementen 56,97, niet gecategoriseerd 32,85, Vervoer 19,60), no income, nothing saved, result −259,16; the week before took in 2.850,00 and spent 268,98 (result +2.581,02); trends Boodschappen +16 %, Vervoer −63 %, total −4 %, the other groups "nieuw".
6. **Docs (Sonnet).** `docs/api.md`, `docs/architecture.md` (the `receipt` package), `analysis/concepts/period-overview.md` (a line: the week and the receipt).

## Tests
`go test ./internal/ledger/... ./internal/receipt/... ./internal/server/...`: the range equals the months, the label and week-year cases, comparison against the previous full period while running, partial first period, empty period, budgets on months only, no colour or verdict fields in the model, stale-account note, privacy rows.

## Done when
`GET /api/reports/receipt` gives the model for any week and month of the demo; the October receipt equals Overzicht's October; the week of 9–15 November matches its golden; every 0.7 and 0.8.1 golden and the speed test are unchanged.
