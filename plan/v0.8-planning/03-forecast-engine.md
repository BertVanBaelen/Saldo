# 0.8-3 · Forecast engine (`planning` package)

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | released (0.8.0), verifying |
| Size | L |
| Features | PLAN-4, PLAN-5 |
| Concepts | [forecast](../../analysis/concepts/forecast.md), [budget](../../analysis/concepts/budget.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [recurring-item](../../analysis/concepts/recurring-item.md), [planned-item](../../analysis/concepts/planned-item.md), [scope](../../analysis/concepts/scope.md) |
| Analysis | 4.5, 5.3, risk 12, risk 16 |
| Depends on | [0.8-1](01-planning-data.md) (tables, `planning.Key`, the demo seed), [0.8-0a](00-saving-categories.md) (the saving flag) |

## Goal
Every planning number of one current account, from facts that are the same for every member, callable without a viewer (0.9-3 runs it from the scheduler).

## Contract
```go
// package planning (server/internal/planning)
func Forecast(ctx context.Context, db *sql.DB, accountID int64, today string, horizon int) (AccountForecast, error)
```
- `today` is the Brussels date (`clock.Today()`); `horizon` is 3, 6, 12 or 24: the answer holds the running month and the `horizon` months after it (horizon 3 = November … February, as Start's four bars and the mockup's four month cards).
- It reads, for that account only: `accounts` (type, source, buffer), `account_sources` (`last_sync_at`, `status`: the data date; account-level, not per user), the latest `balance_snapshots` row (date desc, id desc, as `ledger.accounts`), `transactions` (booked and pending) with `transaction_splits` and `categories` (top id, type, saving), `recurring_items` (state `confirmed`), `budgets`, `planned_items`. Nothing per user. Not `visibleTx`, not `transfer_overrides`.
- `ErrNoBalance` when the account has no snapshot (the API lists such an account under `missing`); savings and investment accounts are refused by the caller.
- Split in a loader (`load.go`, plain SQL into a `Facts` struct) and pure functions (`project.go`): `Project(f Facts, today string, horizon int) AccountForecast`. Every rule below is tested on `Project` with hand-built `Facts`; the SQL is tested once on `planningWorld` and once on the demo. (Built as `forecast_load.go` with `LoadFacts` and `forecast_project.go`, so the names stay apart from 0.8-2's detection files; `AccountForecast` also carries `DataDate`, the date the API returns as `dataDate`.)

```go
type AccountForecast struct {
    AccountID   int64
    Buffer      int64
    Balance     int64        // the start: snapshot + booked rows after the snapshot date
    BalanceDate string       // the snapshot's date
    Months      []Month      // running month first, then horizon months
    Days        map[string][]Day // per month "YYYY-MM": every day of that month (filled for every month of the answer)
    Missed      []Missed     // expected but not seen, no longer counted (rule 5b)
}
type Missed struct { ItemID int64; Label string; Date string; Amount int64 }
type Need struct { Amount, Costs, OtherIncome, BufferGap int64 } // the shared account's required contribution (rule 12)
type Month struct {
    Month         string // "2026-11"
    Start, End    int64  // start: end of the previous month (running month: the real end of last month)
    Left          int64  // End - Buffer: free to spend (negative: Tekort)
    State         string // "ok" | "buffer" | "red", from End
    Income, Out, Saved int64 // Start + Income - Out - Saved == End
    Low           Day    // the lowest end-of-day balance (earliest on a tie)
    Lines         []Line // the breakdown (below)
    Budgets       []Budget
    Need          Need   // computed for every account; the API shows it for shared accounts only
}
type Day struct { Date string; Balance int64; State string; Items []Item }
type Item struct { Kind string; Label string; Amount int64; ID int64 } // Kind: booked | pending | late | missed | recurring | planned | variable
type Line struct { Key string; Amount int64; Labels []string }
type Budget struct { CategoryID int64; Plan int64; Source string; Spent int64; Rest int64 } // Source: "budget" | "average"
```

## Rules
1. **Start.** `Balance` = the snapshot's balance + every **booked** row of the account dated after the snapshot's date, up to today. The forecast starts at the end of today.
2. **Past days of the running month** are actual: end of day d = `Balance` − Σ booked rows dated after d. `Month.Start` of the running month is the end of the last day of the previous month, computed the same way. Their items are the booked rows of the day (`booked`, label = counterparty name, or the item's description when the row is matched to a recurring item).
3. **Occurrences.** An item falls in month m: monthly every month; quarterly when `(m − expected_month) mod 3 = 0`; yearly when m = `expected_month`. Its date is `expected_day`, clamped to the month's last day (31 → 30 or 28/29; 29 February → 28 in a common year). An occurrence after `end_date` does not exist.
4. **Matching** (one function, run **once** per forecast, across month boundaries; review 18 Nov 2026): every occurrence of every item from the first history month (rule 7) up to **today + 7 days**, in date order (then item id), takes the not yet matched row of the account that
   - has the same sign and, for an item with a counterparty IBAN (`counterparty_iban`, 0.8-1), that IBAN, or, for a row **without** an IBAN (a Bilance import never has one), the same `Key(counterparty)` and an amount within ±10 % of the item's (else the old rows stay variable spending and the category average is projected on top of the item; review fix 18 Nov 2026); for an item with only a name, the same `Key(counterparty)`; for an item **without** a counterparty, exactly the item's amount (any counterparty: so a hand-added yearly insurance claims its own payment and it leaves the averages);
   - is **booked**, or **pending** and dated today − 14 … today (a pending card payment on its due day is that occurrence, not a second outflow);
   - is dated within ±7 days of the occurrence,
   nearest date first, then nearest amount, then the lower row id. One row matches one occurrence. Booked rows dated after today are ignored everywhere (a bank's future-dated row is not history).
5. **What still comes** (items that should have happened by today but have not go to **tomorrow** = today + 1, which may be the 1st of the next month):
   - every unmatched occurrence dated after today, in its month (an occurrence of a later month already matched by a past row, such as rent for 1 November paid on Friday 30 October, is **not** projected again);
   - an occurrence matched by a **pending** row: on tomorrow with the pending row's amount, kind `pending`, labelled with the item's description;
   - every unmatched occurrence dated today − 7 … today, **whatever its month** (a salary due 31 October that has not arrived on 1 November): `late`, on tomorrow;
   - every unmatched occurrence dated after the account's **data date** and on or before today: `late`, on tomorrow, however old. The data date is the newest `last_sync_at` of the account's sources with status ok (bank accounts) or, for a manual account, the later of the snapshot's date and its newest booked row: rows after it are simply not in Saldo yet, so such an occurrence is not missed (a stale sync or a manual current account). The API returns `dataDate`;
   - an unmatched occurrence of an item **without** a counterparty dated today or earlier (and on or before the data date) is assumed paid;
   - every **pending** row of the account dated today − 14 … today that matched no occurrence: `pending`, on tomorrow (older pending rows are ignored: a bank that never confirms them leaves them in the table);
   - **5b. Missed** (user decision 18 Nov 2026): an unmatched occurrence of an item with a counterparty, dated more than 7 days before today and on or before the data date, is not counted, but listed in `Missed` (computed on read, never stored) while (a) no booked row matching the item (rule 4, ignoring the ±7 days) is dated on or after the occurrence's date minus 7 days (a payment that arrives late clears it), and (b) the item's next occurrence is dated after today (once the next one is due, the old one is forgotten). It also appears as an item `missed` (amount shown, balance unchanged) on the occurrence's own day when that day is in the answer;
   - planned items dated today: on tomorrow; planned items dated after today: on their date; planned items dated before today are not counted (the balance already holds them, or they did not happen; they stay listed as "Voorbij" in Eenmalig until removed: Known limits).
6. **Amount of an occurrence**: the item's `amount`; with `amount_rule` `average`, the mean of its matched rows in the 6 complete months before the running month (rounded half away from zero), else the stored amount.
7. **Variable spending.**
   - **History months**: of the 6 complete months before the running month, those on or after the account's first booked row's month **when that row is on the 1st**, else from the month after it (a partial first month never counts), **and that hold at least one booked row of the account** (a gap between an imported history and the bank's history is not a month of zero spending). `n` = their number (0 … 6).
   - **Spent(c, m)**: Σ −amount of booked rows and split parts in month m whose top category c is of type expense and not saving, **not matched** to an occurrence (rule 4). A refund lowers it. For the running month, **pending** rows with such a category count too.
   - **Average(c)** = round(Σ spent(c, history months) / n), never below 0; 0 when n = 0.
   - **Plan(c, m)**: the budget row of (account, c) with the greatest `from_month` ≤ m: its amount, or the average when it is NULL; no row: the average. The loader reads budget rows only for categories with `parent_id IS NULL AND type = 'expense' AND saving = 0` (a row left on another category by an old merge is ignored). Saving categories never have a plan. Categories with plan 0 and no spending are not listed.
   - **Running month**: rest(c) = max(0, plan(c) − spent(c)); the remaining variable spending Σ rest is spread over the days after today (none left on the last day of the month: dropped).
   - **Later months**: Σ plan(c, m) spread over all days.
   - **Spreading**: per day = ⌊total / days⌋, the last day gets the remainder, so the month sums exactly. Item `variable`, label "Dagelijkse uitgaven (schatting)".
8. **Month chain.** End of day d = end of day d−1 + items of d − variable of d; the next month starts at this month's end.
9. **States.** A day or month (by its end) is `red` when the balance < 0, `buffer` when < `Buffer`, else `ok`.
10. **Totals.** Running month: Income = Σ positive booked rows of the month + positive expected items; Saved = −Σ (booked rows matched to a `saving` item or in a saving category) − Σ expected `saving` items; Out = everything else negative, booked and expected, plus the remaining variable spending. Later months the same over expected items and variable. Always `Start + Income − Out − Saved = End`.
11. **Lines** (keys fixed; the web app writes the Dutch labels): running month `today` (Balance), `recurringIn`, `recurringOut` (items still to come, `late` included; the labels list their descriptions), `pending`, `planned`, `variable` (= Σ rest), `saving`, `end`, `buffer` (−Buffer), `free` (Left), and in the running month `missed` (amount 0, labels = the descriptions of `Missed`; the web app shows "Verwacht, niet gezien: …" only when there are any). Later months: `start` instead of `today`. A line with amount 0 is present (the mockup shows "Terugkerende posten € 0,00 · Deze maand al ontvangen en betaald").

12. **Required contribution** (`Need`, for a shared account; user decision 18 Nov 2026: the shares of 0.6-5 take effect). For month m:
    - `Costs` = −Σ all occurrences in m of items of kind expense, saving and transfer with a negative amount (paid or not: the whole month) + Σ plan(c, m) of every variable category (the whole month's plan, also for the running month) − Σ negative planned items in m;
    - `OtherIncome` = Σ occurrences in m of positive items whose kind is **not** `contribution` + Σ positive planned items in m;
    - `BufferGap` = max(0, Buffer − Start(m)), where Start(m) is the end of the previous month (running month: the real end of last month), so the month's contributions also bring the account back to its buffer;
    - `Amount` = max(0, Costs − OtherIncome + BufferGap).
    The engine knows nothing of members; the API (0.8-4) turns it into each member's part.

## Golden numbers: the demo (`TestForecastDemo`, `seeded(t)` with the 0.8-1 seed, today 2026-11-18, horizon 24)
Derived on 18 Nov 2026 by a throwaway script that replays `story.go` with the rules above (matching ±7 days, pending and late items on tomorrow, uncategorised rows not variable, averages over the complete months since the first booked row, at most 6). Recompute if the story or the seed changes; if a number differs, check the rule first and report a table error instead of bending the code.

**Zichtrekening** (buffer 90000; snapshot 196882 on 2026-11-18; no booked rows after it):
- History averages (May–Oct 2026, n = 6, rows matched to items left out): Vervoer 12900, Vrije tijd 4028, Overig 900 (budgets replace all three). November spent: Vrije tijd 6690, Vervoer 13410, Overig 0 (Bol.com is pending and uncategorised; Bakkerij, Frituur and Apotheek are uncategorised). Every November occurrence is matched (Huur and Naar gedeelde rekening on the 1st, Salaris the 2nd, Netflix the 12th, Naar spaarrekening the 16th, Spotify the 17th).
- November: Start 102355, days 1 → −43145 (red), 2 → 241855, 8 → 236615, 12 → 235216, 16 → 205131, 17 → 196882, 18 → 196882 (today); 19 → 188242 (Bol.com −2499 pending, variable 6141), 29 → 126832, 30 → 120685 (last day 6147). Lines: today 196882, recurringIn 0, recurringOut 0, pending −2499, planned 0, variable −73698 (Vrije tijd rest 28310, Vervoer 16590, Overig 28798), saving 0, end 120685, buffer −90000, free **30685**. Income 286850, Out 248520, Saved 20000. Low: 1 November −43145.
- Month ends and free: 2026-12 **108789** (+18789, ok; low 1 December −27840), 2027-01 **63493** (−26507, buffer; low 1 January −39736), 2027-02 **−113403** (Tekort 203403, red; red from 10 February to the end; day 1 −85356), 2027-03 −90299, 04 −67195, 05 −44091, 06 −20987, 07 −147883, 08 −56779, 09 −33675, 10 −10571, 11 12533, 12 35637, 2028-01 −9659, 02 13445, 03 36549, 04 59653, 05 82757, 06 105861, 07 128965, 08 152069, 09 175173, 10 198277, 2028-11 221381.
- February 2027 lines: start 63493, recurringIn 285000, recurringOut −148098 (Huur, Naar gedeelde rekening, Netflix, Spotify), planned −200000 (Autoherstelling), variable −93798, saving −20000, end −113403, free −203403. January's recurringOut is −216498 (with Familiale verzekering on the 15th). Income 285000, Out 441896, Saved 20000 in February.

**Gedeelde rekening** (buffer 60000; snapshot 94608 on 2026-11-18):
- Averages: Boodschappen 26821 (replaced by the budget 55000), Overig 6247 (no budget: used). November spent: Boodschappen 29521.
- November: Start 52927, day 1 → 142927, 3 → 128427, 18 → 94608, 19 → 91965 (variable 2643), 30 → 62882 (last day 2653). Lines: today 94608, variable −31726 (Boodschappen 25479, Overig 6247 average), end 62882, free **2882**. Income 90000, Out 80045, Saved 0. Low: 30 November 62882, state ok all month.
- Later months: +9955 each (income 90000, recurringOut −18798, variable −61247): 2026-12 72837, 2027-01 82792, 2027-02 92747, … 2028-11 301802; free 12837, 22792, 32747; state ok throughout.
- **Need**: November Costs 80045 (Energie 14500, Internet en tv 4298, Boodschappen plan 55000, Overig average 6247), OtherIncome 0 (both contributions are kind contribution), BufferGap 7073 (60000 − 52927), Amount **87118**; December to February Costs 80045, BufferGap 0 (each month starts above the buffer), Amount **80045**. For the Zichtrekening the Need is computed too and never shown.
- **Missed**: none in the demo (every occurrence is matched).

**Viewer independence**: `Forecast` takes no viewer, so here it is pinned structurally: `TestLoaderReadsNoUserData` asserts that the loader's SQL text contains none of `transfer_overrides`, `account_access`, `user_id`, `visibleTx`; and the demo forecast of the shared account is unchanged after Partner marks the 2026-10-26 Colruyt row "is een overschrijving". The byte-identical answer for Bert and Partner is tested on the API in 0.8-4.

## Golden numbers: `planningWorld(t)` (synthetic, `planning/world_test.go`; the cases the demo never exercises)
Today 2026-11-18. Categories: the default tree plus a saving top category Sparen. Accounts: **W1** Zicht (Bert, current, **manual**, buffer 50000, snapshot 100000 dated **2026-11-16**; data date 2026-11-17, its newest booked row); **W2** Gedeeld (Bert + Partner, current, bank, a source with `last_sync_at` 2026-11-18, buffer 0, snapshot 20000 on 2026-11-18); **W3** Nieuw (Bert, current, no snapshot); **W4** Spaar (Bert, savings).

W1 rows: 2026-09-15 −3000 Boodschappen (first booked row: September is partial, so n = 1, October only); 2026-09-25 and 2026-10-25 +150000 Salaris "Werkgever"; 2026-10-01 −80000 Wonen "Huurbaas"; 2026-10-05 −6000 and 2026-10-20 +1000 (refund) Boodschappen; 2026-10-10 −2000 Sparen (saving: not variable); 2026-10-14 −2500 Vrije tijd "Gym"; 2026-11-01 −80000 "Huurbaas"; 2026-11-03 −4000 split −3000 Boodschappen / −1000 Vrije tijd; 2026-11-17 −1500 Boodschappen (after the snapshot date); 2026-11-18 −700 Boodschappen **pending**.
W1 items (confirmed): Huur "Huurbaas" −80000 monthly day 1; Salaris "Werkgever" +150000 monthly day 25; Gym "Gym" −2000 monthly day 14, **amount_rule average** (its one matched row is −2500, so it counts −2500); Krant "Krant" −1000 monthly day 5 (never paid); Toelage "Toelage" +20000 monthly day 8 (rows 2026-09-08 and 2026-10-08 in Overig inkomen; the November one has not come); Verzekering "" −30000 yearly month 2 **day 31**; Water "Water" −4500 quarterly anchor 12 day 20, end_date 2027-06-30. Budgets: Boodschappen from 2026-11 10000, from 2027-01 NULL. Planned: 2026-11-18 −5000 "Cadeau" (today), 2026-12-24 −10000 "Feest".

| Check | Expected |
|---|---|
| Balance (start) | 98500 (100000 − 1500 booked after the snapshot date) |
| Averages | Boodschappen 5000 (October: 6000 − 1000), Vrije tijd 0 (the October Gym row is matched), Wonen 0 (matched); n = 1 |
| Running month matches | Huur on 1 November matched; Gym (14 November, 4 days ago) `late` on 19 November −2500; Krant (5 November, 13 days ago) and Toelage (8 November, 10 days ago) not counted (both are before W1's data date, 2026-11-17); `Missed` = [Krant 2026-11-05 −1000, Toelage 2026-11-08 +20000], each also an item `missed` on its day; the November line `missed` names both. With an extra booked row "Toelage" +20000 on 2026-11-17 (10 days late, outside the match window) Toelage leaves `Missed` (and nothing else changes: the row is income, not variable); with today = 2026-12-09 (after the next occurrence, 8 December) the November Toelage is no longer listed |
| November spent / rest | Boodschappen spent 5200 (3000 split part + 1500 + 700 pending), rest 4800; Vrije tijd spent 1000, plan 0, rest 0 |
| 19 November | 89900 = 98500 − 700 (pending) − 2500 (late Gym) − 5000 (Cadeau, planned today, moved to tomorrow) − 400 (4800 over 12 days) |
| November | Start 184000; End **235500** (salary +150000 on the 25th); Income 150000, Out 98500, Saved 0 |
| December | variable 10000 (budget; 322 a day, 340 on the 31st); items Huur, Krant, Gym −2500, Water (anchor 12) −4500, Feest −10000, Salaris, Toelage +20000 on the 8th; End **297500**; Low 24 December 149772 (Feest; 1 December is 155178: corrected while building 0.8-3, the table had the 1st) |
| January 2027 | budget NULL from 2027-01, so the average 5000; End **379000** |
| February 2027 | Verzekering on the 28th (day 31 clamped) −30000; End **430500** |
| March 2027 | Water again; End 507500. June 2027 has Water (20 June ≤ end date), September 2027 does not |
| February 2028 | Verzekering on the 29th (leap year) |
| States | W1 ok everywhere |

W2 (shared, no items): rows on the 1st of May–November 2026 +30000 from X1 (Bert's personal IBAN) and +30000 from XP (Partner's personal IBAN), on the 10th of May–October −20000 Boodschappen, 2026-10-15 −5000 to XP uncategorised, 2026-11-10 −8000 Boodschappen; Partner has an override "is een overschrijving" on the 2026-10-10 row. Expected: average Boodschappen 20000 (n = 6, the override changes nothing); November rest 12000 (1000 a day), End 8000 (ok, buffer 0); December End **−12000**, red from **13 December** (8000 − 13 × 645 < 0) to the 31st; the contributions are not forecast (no confirmed item: risk 12). The JSON is identical for Bert and Partner.

W2 **Need**: November Costs 20000 (the Boodschappen average), OtherIncome 0, BufferGap 32000 (buffer 0 − Start −32000: the account ended October at −32000), Amount **52000**; December Start 8000, Amount **20000**. (W1's Need is not pinned; its rule is covered by the edge tests.)

W3: `ErrNoBalance`. W4: the caller refuses it (savings).

Edge tests on `Project` (no SQL), each a few hand-built facts (review of 18 Nov 2026 included):
- **early payment across months**: today 2026-10-31, rent −100500 monthly day 1, booked rows 2026-10-01 and Friday 2026-10-30 → the 1 November occurrence is matched by the 30 October row and November has no rent (November ends 100500 higher than without the rule);
- **late across months**: today 2026-11-01, salary +250000 monthly day 31 (October: the 31st), no row → `late` on 2 November and counted in November;
- **pending on the due day**: today 2026-11-12, Netflix −1399 day 12, a pending −1399 Netflix row dated 2026-11-12 → one item on 13 November (kind `pending`, label "Netflix"), not also `late`;
- **old pending**: a pending row dated 2026-10-01 is ignored; a booked row dated 2026-11-20 (after today 2026-11-18) is ignored;
- **key-less item**: Familiale verzekering −68400 yearly 15 January, no counterparty, a booked row −68400 "AG Insurance" on 2026-01-14 in Wonen → matched, so Wonen's average for a history containing January leaves it out;
- **shared name, two IBANs**: items "Naar gedeelde rekening" (IBAN XS, −45000, day 1) and "Naar spaarrekening" (IBAN XV, −20000, day 1) both with the counterparty name "BERT VAN BAELEN" → each matches only its own IBAN's rows;
- **stale data**: data date 2026-11-05 (last sync), today 2026-11-18, salary day 10 unmatched → `late` on 19 November (not missed); with data date 2026-11-18 it is missed;
- **history gap**: rows in January–March 2026 (import) and from August 2026 (bank), none in April–July: for November the history months are August, September and October, n = 3;
- **budget on an invalid category**: a budget row on a subcategory or a saving category is ignored by the loader;
- today = 2026-11-30 puts a pending row on 2026-12-01 and drops the November rest; an occurrence matched by a row 6 days early is not expected again; two occurrences never share one row; a row 8 days from its occurrence does not match; a recurring item of kind `income` lowers `Need.Amount` by its amount, one of kind `contribution` does not; a planned expense in the month raises it; `Need.Amount` is never below 0; the identities `Left == End − Buffer` and `Start + Income − Out − Saved == End` for every month of every test.

## Performance
One forecast reads one account's rows from the first day of the 6th month before the running month (plus the first booked date), its items, budgets and planned items: four small queries. 24 months of days is about 730 small structs per account. `TestForecastSpeed` (skipped under `-short`): the demo's two accounts at horizon 24 under 50 ms, logged. No cache.

## Steps
1. **Opus**: `project.go` with every rule, the `Project` edge tests, `planningWorld` and its table.
2. **Opus**: `load.go` (the four queries) and `TestForecastDemo`, `TestLoaderReadsNoUserData`, the speed test.

## Who builds it
- **Opus**: all of it. The rules interact (matching, late and missed items, history months, pending, the need) and the goldens must be reproduced, not adjusted.

## Done when
`TestForecastDemo`, the `planningWorld` table and the edge tests pass, and the forecast is provably the same for every member.
