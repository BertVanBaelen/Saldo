# 0.7-1 · Reports engine and API

| | |
|---|---|
| Version | [0.7 Overview](README.md) |
| Status | built (0.7.0-dev), to verify |
| Size | M |
| Features | OVER-1, OVER-2 |
| Concepts | [period-overview](../../analysis/concepts/period-overview.md), [internal-transfer](../../analysis/concepts/internal-transfer.md), [scope](../../analysis/concepts/scope.md), [category](../../analysis/concepts/category.md) |
| Analysis | 4.4 |
| Depends on | [0.6-4](../v0.6-shared-accounts/04-scope-and-sums.md) (scope, `visibleTx` with transfer detection) |

## Goal
Correct income, expenses per category and saved per month, for the viewer, for any selection of accounts, in one query, with the rule written once and reused by the Transacties drill-down (0.7-2).

## Rules (the contract)
- **Selection S**: with `account=<id>`, that account, which must be a `current` account the viewer holds (savings or investment: `400` "Kies een betaalrekening."; hidden or unknown: `404`). Without it, every account of the scope (`scopeCond`) the viewer holds with `type = 'current'`. Savings and investment accounts are never in S, so their own rows (interest) never count.
- **Rows**: the viewer's `booked` rows on accounts in S, booking date in the month (already Brussels dates). Pending rows never count. A split row counts by its parts (`transaction_splits`, signed like the amount); its own `category_id` is ignored.
- **Other side "known at that date"**: the other side (`other_id` from `visibleTx`) counts as being in S only when it is in S **and** its first booked row is on or before this row's booking date **plus 3 days** (`other_first <= date(booking_date, '+3 days')`, the same window `visibleTx` uses to pair opposite amounts). The window makes both halves of one transfer give the same answer when the other account's first row lags by a day or two (inter-bank delay): without it the outgoing half would be a phantom expense in the month a user links a new account while the incoming half is internal. A genuine pre-history transfer within 3 days of the other account's first row is treated as internal (accepted, tiny). Before the other account's history starts, the other half of the transfer is not in Saldo, so treating it as internal would make money disappear. Example: Bert imports Bilance history from 2020 with −€ 450 a month to the shared IBAN, and the shared account's history starts 2025-11-01; in Alles 2020–2024 each month shows € 450 "Naar gedeelde rekening", from 2025-11 on the contribution is internal. In the demo both sides start on 2025-11-01, which is why the golden table below is unchanged by the rule.
- **Bucket of a row or part**, in this order:
  1. `is_transfer` (override included) and (`other_id` is NULL, or the other side is in S and known at that date) → **left out**.
  2. `is_transfer` and the other side is `savings` or `investment` → **saved**, `-amount` (net: a withdrawal lowers it, a month can be negative). Investments get their own treatment in 2.0.
  3. `is_transfer`, amount < 0, the row's account has one member and the other side more than one → expense key **`toShared`** ("Naar gedeelde rekening").
  4. `is_transfer`, amount < 0 → expense key **`toOwn`** ("Naar eigen rekening"; also shared → personal and shared → another shared account).
  5. `is_transfer`, amount > 0 → **income** (also money from the shared account into a personal one: not netted against `toShared`).
  6. Category of type `income` → **income** (net).
  7. Category of type `expense` → expense key = **top category id** (`COALESCE(parent_id, id)`), `-amount` (a refund lowers it; the key may end below 0).
  8. No category: amount < 0 → expense key **`none`**, `-amount`; amount > 0 → **income**.
- For a split transfer, steps 1 to 5 use the part amounts (they sum to the row's amount); the parts' categories do not matter.
- Per account (`accounts` in the answer) is the same rule with S = {that account}: the other side is then never in S, so every transfer is a flow. Hence the per-account lists add up to more than the total by the transfers inside S (Overzicht's footnote: per-account incomes minus total income; Start's: per-account expenses minus total expenses).

## One source for the rule (`ledger/reports.go`)
Do not change `visibleTx` (Transacties' own transfer flag stays as in 0.6). Build a report layer on top of its `tx` CTE, exported for 0.7-2:
- `first_booked AS (SELECT account_id, MIN(booking_date) AS first FROM booked GROUP BY account_id)` (reuses the materialised `booked`).
- `parts`: one row per unsplit transaction or per split part, with plain columns `id`, `account_id`, `booking_date`, `amount` (the part's), `members`, `is_transfer`, `other_id`, `other_type`, `other_members`, `other_first` (via `LEFT JOIN vis` and `first_booked` on `other_id`), `top_id`, `cat_type`; only `status = 'booked'` rows.
- `reportBucket(inSel string) string`: a Go function returning the SQL `CASE` that yields the bucket (`out` | `saved` | `income` | `expense`) and one returning the expense key (`<top id>` | `none` | `toShared` | `toOwn`), referencing only `parts` columns. `inSel` is an SQL condition on `other_id` (for example `other_id IN (…)`, built from S), combined inside with `other_first <= date(booking_date, '+3 days')`.
- **ReportMonths** groups `parts` of S's accounts by `substr(booking_date, 1, 7)`, `account_id`, `reportBucket(selection)` + key **and** `reportBucket("0 = 1")` + key (the per-account view), summing `amount`. One statement; a second tiny one gives `firstDate` (the first booked date over S).
- **The drill-down filter** (0.7-2) is `tx.id IN (SELECT id FROM parts WHERE <bucket> = 'expense' AND <key> = ?)` with the same selection: one form for categories, `none`, `toShared`, `toOwn`, splits and pre-history.

## Endpoint
`GET /api/reports/months?scope=alles|persoonlijk|gedeeld&account=<id>&from=YYYY-MM&to=YYYY-MM`
- `scope` as in `GET /api/transactions` (default `alles`); `account` as above. `from` defaults to `firstMonth`, `to` to the current month (Brussels, from the clock). A malformed month answers `400` "Kies een maand als JJJJ-MM." (the message of the contributions route); `to` after the current month or `from` after `to` answer `400` too.
- Answer (money in cents; every month from `from` to `to` is present, zeros included; an expense key appears only when not 0):
```json
{
  "accounts": [1, 4],
  "firstMonth": "2025-11",
  "firstDate": "2025-11-01",
  "months": [
    {
      "month": "2026-10",
      "income": 335000,
      "saved": 20000,
      "expenses": { "1": 115000, "2": 25236, "3": 2795, "4": 14060, "5": 6896, "6": 6562 },
      "accounts": [
        { "id": 1, "income": 290000, "saved": 20000, "expenses": { "1": 100500, "3": 2795, "4": 14060, "5": 2598, "toShared": 45000 } },
        { "id": 4, "income": 90000, "saved": 0, "expenses": { "1": 14500, "2": 25236, "5": 4298, "6": 6562 } }
      ]
    }
  ]
}
```
- `accounts` (top level) is S in `GET /api/accounts` order. `firstDate` is the first booked date in S of a row with an amount, not 0 (0.7-3 uses it for a partial first month; the `booked` relation and the rule ignore rows of 0 too). When S has no booked rows: `firstMonth` and `firstDate` are `null`, and without `from` the answer has `months: []`; when S is empty (no current account in the scope): `accounts: []`, `months: []`, both `null`. The per-month `accounts` list is present only when S holds more than one account. Category names, colours and icons come from `GET /api/categories`; the keys `none`, `toShared` and `toOwn` are fixed.

## Steps
1. **Opus**: the report layer and `ReportMonths` (`ledger/reports.go`) as above, plus the fixture helper `reportWorld(t)` (below), the table test on it and the demo test.
2. **Sonnet**: handler `GET /api/reports/months` (`server/reports.go`, literal pattern), validation and handler tests.
3. **Sonnet**: `docs/api.md` section "Reports (0.7-1)" with the rules, parameters, errors and the example.
4. **Sonnet**: privacy. Add the route to `server/privacy_test.go` (`TestEveryRouteHasAPrivacyRow` fails until you do) and extend `TestPrivacySentinels`: Partner's sentinel amounts never appear in Bert's answer for any scope; `account=<Partner's personal account>` answers `404`.
5. **Sonnet**: a fixture file `fixtures/csv/bilance-bijdrage.csv` (Bilance format, no IBAN column: 2024 months with "Huur", "Loon" and −€ 450 "Bijdrage gedeelde rekening" on Zichtrekening) for the local-testing scenario of 0.7 (see the README); no existing fixture has a transfer to the shared account before 2025-11.

## Performance
`other_id` is a correlated subquery evaluated per row and referenced three times in `visibleTx` (`is_transfer`, the kind, the join); the report adds `first_booked` and the split join. If `TestReportMonthsSpeed` misses 2 s, the first lever is materialising `tx` (`tx AS MATERIALIZED`, or `tx0`) so `other_id` is computed once per row; measure before and after.

## Tests
- **`reportWorld(t)`** (ledger test helper, used by 0.7-1 and 0.7-2): viewer Bert, Partner as the other user. Accounts: A1 Zicht (Bert, current, IBAN X1); A2 Tweede (Bert, current, X2); A3 Gedeeld (Bert + Partner, current, XS, first row 2025-11-01); A4 Spaar (Bert, savings, **bank-synced** with rows, XV); A5 Beleggen (Bert, investment, manual, XI); A6 Partner's Zicht (Partner only, XP); A7 Oud gedeeld (Partner only now: Bert left it, XO); A8 Nieuw (Bert, current, X8, first booked row r23 on 2026-03-11). Category ids as the default tree (1 Wonen, 2 Boodschappen, 3 Vrije tijd, 6 Overig, 7 Salaris).

  | Row | Account, date | Amount | Counterparty IBAN / category | alles | persoonlijk | gedeeld | A1 / A2 / A3 alone |
  |---|---|---|---|---|---|---|---|
  | r1 | A1 2020-03-01 | −45000 | XS (before A3's history) | toShared | toShared | – | A1 toShared |
  | r2 | A1 2026-01-01 | −45000 | XS | out | toShared | – | A1 toShared |
  | r3 | A3 2026-01-01 | +45000 | X1 | out | – | income | A3 income |
  | r4 | A3 2026-01-01 | +45000 | none (Partner's, imported without IBAN; pairs with r2) | **out** (limitation) | – | income | A3 income |
  | r5 | A1 2026-01-05 | −20000 | XV | saved +20000 | saved | – | A1 saved |
  | r6 | A4 2026-01-05 | +20000 | X1 | – (savings row) | – | – | – |
  | r7 | A4 2026-01-31 | +350 | interest | – | – | – | – |
  | r8 | A1 2026-01-10 | +10000 | XV (withdrawal) | saved −10000 | saved −10000 | – | A1 saved −10000 |
  | r9 | A1 2026-01-12 | −30000 | X2 | out | out | – | A1 toOwn |
  | r10 | A2 2026-01-12 | +30000 | X1 | out | out | – | A2 income |
  | r11 | A3 2026-01-15 | −5000 | X1 | out | – | toOwn | A3 toOwn |
  | r12 | A1 2026-01-15 | +5000 | XS | out | income | – | A1 income |
  | r13 | A1 2026-01-20 | −10000 | XI (investment) | saved +10000 | saved | – | A1 saved |
  | r14 | A1 2026-01-22 | −12000 split −8000 Wonen / −4000 Overig | XS | out | toShared 12000 | – | A1 toShared 12000 |
  | r15 | A1 2026-01-25 | +2500 | Vrije tijd (refund) | 3: −2500 | 3: −2500 | – | A1 3: −2500 |
  | r16 | A1 2026-01-26 | −6000 | none, override "is een overschrijving" | out | out | – | A1 out |
  | r17 | A1 2026-01-27 | −4000 | none, uncategorised | none 4000 | none | – | A1 none |
  | r18 | A1 2025-06-01 | −45000 | XO (Bert left A7) | none 45000 (limitation) | none | – | A1 none |
  | r19 | A2 2026-01-28 | −3000 | Boodschappen | 2: 3000 | 2: 3000 | – | A2 2: 3000 |
  | r20 | A1 2026-01-02 | +250000 | Salaris | income | income | – | A1 income |
  | r21 | A1 2026-01-03 | −1000 | Salaris (correction) | income −1000 | income −1000 | – | A1 income −1000 |
  | r22 | A1 2026-03-10 | −1000 | X8 (A8 is new; its first row arrives the next day) | out | out | – | A1 toOwn |
  | r23 | A8 2026-03-11 | +1000 | X1 (A8's first booked row) | out | out | – | A8 income |
  | r24 | A1 2026-03-07 | −2000 | X8 (4 days before A8's first row: a genuine pre-history transfer) | toOwn 2000 | toOwn 2000 | – | A1 toOwn |
  | p1 | A6 2026-01-01 | −45000 | XS (Partner's own row) | never visible to Bert | | | |
  | r25 | A1 2025-10-29 | −4600 | XS (3 days before A3's first booked row r0: inside the window, internal) | out | toShared 4600 | – | A1 toShared 4600 |
  | r26 | A1 2025-10-28 | −4700 | XS (4 days before r0: outside the window, a flow) | toShared 4700 | toShared 4700 | – | A1 toShared 4700 |
  | r27 | A1 2025-09-15 | −3300, **pending**, category 2 | – | – | – | – | – (pending rows are in no report) |
  | r28 | A1 2019-12-15 | 0, booked | – | income 0 | income 0 | – | A1 income 0 (starts no history: `firstDate` stays 2020-03-01) |

  "out" = left out. r22/r23 are the lag pair (the window of the rule keeps both halves internal) and r24 the pair just outside the window. No two other rows may pair by opposite amount by accident (check the amounts when building it). The oracle was derived by hand, not run: if a case differs, look at the SQL first and at the table second, and report any table error instead of bending the code to it.
- **`TestReportBucket`** (table, on `reportWorld`): one case per row and selection above, read through `ReportMonths` or directly from `parts` with `reportBucket`. Totals for 2026-01: alles income 249000, saved 20000, expenses 3: −2500, none 4000, 2: 3000; persoonlijk income 254000, saved 20000, toShared 57000, 3: −2500, none 4000, 2: 3000; gedeeld income 90000, toOwn 5000; A1 alone income 254000, saved 20000, toShared 57000, toOwn 30000, 3: −2500, none 4000. 2020-03 alles: toShared 45000. 2025-06 alles: none 45000. 2025-10 alles: toShared 4700; persoonlijk and A1 alone: toShared 9300; gedeeld: nothing. 2025-09: nothing (the pending r27). 2026-03 alles and persoonlijk: toOwn 2000 only (r22 and r23 left out); A1 alone: toOwn 3000; A8 alone: income 1000.
- **`TestReportKnownLimits`** pins two documented behaviours on `reportWorld`: r4 (an equal contribution imported without IBAN pairs with Bert's own and is left out in Alles, so Alles income is € 450 too low) and r18 (contributions to a shared account Bert left become `none`). If either changes, update the README's Known limits.
- **`TestReportMonthsDemo`** (table, `seeded(t)` = the demo story, viewer Bert). Numbers computed on 17 Nov 2026 from the story with a throwaway query; recompute only if the story changes. Category ids: 1 Wonen, 2 Boodschappen, 3 Vrije tijd, 4 Vervoer, 5 Abonnementen, 6 Overig.

  | Selection, month | income | saved | expenses |
  |---|---|---|---|
  | alles 2026-10 | 335000 | 20000 | 1: 115000, 2: 25236, 3: 2795, 4: 14060, 5: 6896, 6: 6562 (total 170549) |
  | persoonlijk 2026-10 | 290000 | 20000 | 1: 100500, 3: 2795, 4: 14060, 5: 2598, toShared: 45000 (total 164953) |
  | gedeeld 2026-10 | 90000 | 0 | 1: 14500, 2: 25236, 5: 4298, 6: 6562 (total 50596) |
  | alles 2026-09 | 330000 | 20000 | 1: 115000, 2: 27106, 3: 6690, 4: 11560, 5: 6896, 6: 8881 |
  | alles 2026-07 | 330000 | 0 | Overig (6) 5721 (Action 6022 minus a Bol.com refund of 301: the story's `vary` gives a +€ 3,01 row) |
  | alles 2026-08 | 330000 | 40000 | (only income and saved checked: two savings transfers) |
  | alles 2026-11 (running, to 18 Nov) | 331850 | 20000 | 1: 115000, 2: 29521, 3: 6690, 4: 13410, 5: 6896, none: 4125 (total 175642; the pending Bol.com € 24,99 is left out) |
  | persoonlijk 2026-11 | 286850 | 20000 | 1: 100500, 3: 6690, 4: 13410, 5: 2598, none: 4125, toShared: 45000 |
  | gedeeld 2026-11 | 90000 | 0 | 1: 14500, 2: 29521, 5: 4298 (total 48319) |

  Plus: in alles 2026-10 the per-account list is `[1, 4]` with incomes 290000 + 90000 (their sum minus the total income is the € 450 of the footnote) and in 2026-11 Zichtrekening's expenses are 172323 (with `toShared` 45000), the shared account's 48319; `firstMonth` is `2025-11` and `firstDate` `2025-11-01` in every scope; months `2025-11` … `2026-11` are all present without `from`/`to`; `account=2` (savings) and an investment account answer `400`.
- **Viewer Partner** (every other test uses Bert, so a viewer bound to the wrong `?` of the new CTEs would pass silently): in `TestReportMonthsDemo`, Partner as viewer, 2026-10: persoonlijk income 246000 and `toShared` 45000; gedeeld income 90000; alles income 291000 (Bert's contribution comes from an account Partner cannot see, so it is income for Partner; Partner's own contribution is internal in Alles). The implementer computes the expense keys from the story, checks these four numbers and pins the rest.
- `TestReportMonthsSplit`: split a demo row over Wonen and Overig, the parts land in their categories and the row's own category does not count. `TestReportMonthsOverride`: "Is geen overschrijving" on Bert's contribution puts it in Alles as `none`; "Is een overschrijving" on a groceries row (no partner) removes it everywhere.
- `TestReportMonthsSpeed` in `transfer_perf_test.go` style (same 20 000-row fixture plus some split rows, skipped under `-short` and `-race`): times the report query itself (splits and grouping) over the whole history for `alles` and for one account, each under 2 s, timings logged. Once 0.7-2 exists it also times `Transactions` with `category=<top id>` and with `category=toShared` (the first page, which runs `parts` twice: COUNT and items), each under 2 s.
- Handler tests (`server/reports_test.go`): parameters and errors (the month message, `400` for a savings account, `404` for a hidden one, `401` without a viewer), the empty-selection answer.

## Who builds it
- **Opus**: the report layer, `reportBucket`, `ReportMonths`, `reportWorld`, `TestReportBucket`, `TestReportKnownLimits`, `TestReportMonthsDemo`, the speed test (step 1).
- **Sonnet**: steps 2 to 5 from this file, once `ledger.ReportMonths` and the exported drill-down fragment exist.

## Done when
`TestReportBucket` and `TestReportMonthsDemo` pass. Income, saved and the transfer structure equal the mockup (€ 3.350 / € 3.300, € 200 with 0 in July and € 400 in August, € 900 in Gedeeld, € 450 "Naar gedeelde rekening" in Persoonlijk, € 3.318,50 in the running November); the per-category expenses are the story's, not the mockup's illustrative ones.

## Carried over from 0.4 (10 Nov 2026)
- **Split rows** are summed by their parts (`transaction_split`); the row's own category fields are kept only for undo and are hidden, so never sum a split row under them.
- **Pending rows** are excluded from the totals.
- **Transfers** are left out at query time (0.6-3), not by category: a transfer may carry a category and would otherwise count in that category's total.
