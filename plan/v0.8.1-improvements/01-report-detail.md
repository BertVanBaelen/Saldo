# 0.8.1-1 · Report detail: income, expenses and saved per category and subcategory

| | |
|---|---|
| Version | [0.8.1 Improvements](README.md) |
| Status | planned |
| Size | M |
| Items | 8 |
| Concepts | [period-overview](../../analysis/concepts/period-overview.md), [category](../../analysis/concepts/category.md), [internal-transfer](../../analysis/concepts/internal-transfer.md) |
| Screens | [overzicht](../../analysis/screens/overzicht.md), [transacties](../../analysis/screens/transacties.md) |
| Depends on | – (0.7-1 `reportBucket`/`reportKey`, 0.8-0a `saved`) |
| Files | `server/internal/ledger/reports.go`, `reports_test.go` (incl. the speed test), `transactions*.go` (drill-down keys), `server/internal/server/reports.go`, `docs/api.md`, `web/src/lib/{types,api,drilldown}.ts` |

## Goal
Item 8: tapping Inkomen, Uitgaven or Gespaard on Overzicht shows the amounts per category with a dropdown per subcategory. Today the report rolls everything up into top categories, and income and saved are one number. This phase gives the numbers and the drill-down filters behind every one of them; the screens are 0.8.1-4.

## Rules (one place: `ledger/reports.go`)
- **Same statement, same rows.** `ReportMonths` gets `Detail bool` (`GET /api/reports/months?…&detail=1`). With it, the existing statement selects one more column, `reportDetail` (below), and groups by it too; the totals (`income`, `saved`, `expenses`) are summed from the same rows as before, so they cannot drift from the detail. Without `detail` the statement and the answer are byte-identical to 0.8.0 (`TestReportMonthsDemo` unchanged).
- **`reportDetail`** (a CASE on a `parts` row, read only together with `reportBucket`):
  - bucket `expense`, key a top category id: the row's own category id (`c.id`; equal to the top id when the row sits on the top itself); other expense keys (`none`, `toShared`, `toOwn`): `''`.
  - bucket `income`: `transfer` when `is_transfer = 1`; else the row's own category id when `cat_type = 'income'`; else `none` (uncategorised income, and an expense-category row can never land here because rule 9 makes it an expense).
  - bucket `saved`: `account-<other_id>` when rule 2 applies (a transfer to a savings or investment account: `is_transfer = 1 AND other_type IN ('savings','investment')`); else the row's own category id (rule 3, a saving category or its sub).
  - `parts` gets the column `cat_id` = `c.id` (it already joins `c`).
- **Answer** (per month, and per account in `accounts` as today), only with `detail=1`, zero entries pruned:
  ```json
  "detail": {
    "income":   {"7": 285000, "transfer": 45000, "none": 5000},
    "saved":    {"<sparenId>": 21000, "<pensioenId>": 3000, "account-4": 4000},
    "expenses": {"2": {"2": 20000, "12": 9521}}
  }
  ```
  `income` and `saved` are keyed by the **row's own** category (a sub id when the row is on a sub, the top id for rows booked on the top itself: its **own part**); the web app rolls subs up to their top with the category tree. `expenses` is `{topKey: {ownCategoryId: amount}}` for top category keys only; `expenses[k][k]` is the top's own part.
- **Both buckets.** The statement computes the bucket twice (selection `reportBucket(inSel)` for the totals, `reportBucket("0 = 1")` for the per-account view, `reports.go:277-299`); `reportDetail` reads the bucket it is paired with, so the per-account `detail` follows the per-account bucket (a transfer to the shared account is `toShared` in the selection and, alone, may be income on the other side). Two detail columns, one per bucket, both from the same fragment. Identities: Σ `detail.income` = `income`; Σ `detail.saved` = `saved`; Σ of `detail.expenses[k]` = `expenses[k]` for every top key.
- **Privacy.** Nothing new is exposed: every key is a category id (shared tree), `transfer`, `none` or the id of an account in the viewer's `vis` (rule 2 only fires when `other_type` is known, i.e. the viewer sees the other account). Partner's view of Bert's contribution stays uncategorised income (`none`, or the category the row carries) and never names Bert's account.
- **Drill-down filters** (`reportDrillDown`, the same fragment): the existing `category=` values (a top id stays **rolled up**: top and its subs, as `reportKey`) plus
  - `category=<subId>` (a subcategory id): `bucket = 'expense' AND cat_id = ?` or `bucket = 'saved' AND saving = 1 AND cat_id = ?`;
  - `category=<topId>-zelf`: the top's **own part** only, `cat_id = <topId>` in the same bucket condition as the top key (the "Boodschappen zelf" row of 0.8.1-4);
  - `category=income-<id>` rolled up for a top (`bucket = 'income' AND is_transfer = 0 AND top_id = ?`), own for a sub (`cat_id = ?`); `income-<topId>-zelf`; `income-transfer`, `income-none`;
  - `category=saved-account-<id>`: `bucket = 'saved' AND` the rule-2 condition with `other_id = ?`.
  So every number shown has a key: rolled-up tops sum their detail entries, subs and `-zelf` are single entries.
  A split row is listed once when one of its parts matches (as today). Web URL values (`lib/drilldown.ts` `CATEGORY_KEYS`): `<id>-zelf`, `inkomen-<id>`, `inkomen-<id>-zelf`, `inkomen-overschrijving`, `inkomen-geen`, `gespaard-rekening-<id>`; a sub id is a plain id. Transacties' chip names them ("Salaris", "Inkomen · overschrijvingen", "Inkomen · niet gecategoriseerd", "Gespaard · Spaarrekening"); the dropdown does not list the new values (reached from Overzicht only, as `gespaard`).

## Steps
1. **Opus**: `cat_id`, `reportDetail`, the `Detail` flag and answer, the identities test, the `reportWorld` additions below.
2. **Opus**: the drill-down keys and `TestDrillDownMatchesReport` extended.
3. **Sonnet**: the handler flag, `docs/api.md` "Reports" and "Transactions", `lib/types.ts` (`ReportMonth.detail?`), `api.reportMonths({…, detail})`, `categoryFromParam` and the Transacties chip labels with vitest.

## Tests (exact; `reportWorld` ids as in 0.8-0a)
- **`TestReportDetailIdentities`**: on `reportWorld` and on the demo (`seeded(t)`), for every selection (alles, persoonlijk, gedeeld, each current account alone; viewer Bert and viewer Partner) and every month: the three identities above, and `detail=0` answers equal the 0.8.0 answers (`TestReportMonthsDemo` passes unchanged).
- **`reportWorld` 2026-04 saved detail** (rows s1–s9 of 0.8-0a): alles `{rwSparen: 18000, rwPensioen: 3000, "account-A4": 4000}` (s1 5000 + s3 −1000 + s6 6500 + s7 6000 + s9 1500 = 18000; s2 3000 on the sub; s5 is rule 2), Σ 25000 = saved; persoonlijk `{rwSparen: 23500, rwPensioen: 3000, "account-A4": 4000}` (adds s4 7000, drops s9 1500), Σ 30500; gedeeld `{rwSparen: 1500}`.
- **Subcategory expenses**: add to `reportWorld` two rows in a month it does not use yet (lead picks it and checks no pairing within 3 days): A1 −2000 on a subcategory "Restaurant" of Vrije tijd, A1 −1000 on Vrije tijd itself; that month alles `expenses["3"] = 3000`, `detail.expenses["3"] = {"3": 1000, "<restaurant>": 2000}`; one income row +5000 on a subcategory "Bonus" of Salaris → `detail.income = {"<bonus>": 5000}`.
- **Demo November 2026 (Bert, alles)**: `Σ detail.income = 331850`, `Σ detail.saved = 20000` (one key `account-2`, the transfer to the Spaarrekening), `detail.expenses["none"]` absent (pseudo keys carry no detail). The per-key income split of the demo: lead derives (salary 285000 is one key; the rest depends on the story's categories).
- **`TestDrillDownMatchesReport`** extended: for every detail key of every selection and month in `reportWorld` and the demo, Σ of the listed rows' matching parts equals the detail value (`income-*`: +, `saved-*` and sub ids in saved: × −1, expense subs: × −1); a rolled-up top key equals Σ of its detail entries (2026-04 alles `category=<rwSparen>` lists 21000 = 18000 own (`<rwSparen>-zelf`) + 3000 Pensioensparen).
- **Speed** (`reports_test.go` speed test, 4 s bound): add `Detail: true` on the whole history and the drill-downs `<id>-zelf`, `income-7`, `saved-account-2`.
- **Privacy row** in `privacy_test.go` for `detail=1`: Partner's answer for gedeeld never contains an `account-<id>` of Bert's personal accounts; Bert's personal ids never appear in any Partner answer.
- Vitest: `categoryFromParam('inkomen-7')`, `('inkomen-geen')`, `('gespaard-rekening-2')`, a sub id; the Transacties chip texts.

## Who builds it
- **Opus**: steps 1–2 (the rule fragment and the drill-down must agree everywhere; the review findings of 0.7 and 0.8 were about exactly these edges).
- **Sonnet**: step 3.

## Done when
`detail=1` answers satisfy the identities for every selection of `reportWorld` and the demo, every detail key has a drill-down that lists exactly its rows, and the 0.7/0.8 report goldens are unchanged.
