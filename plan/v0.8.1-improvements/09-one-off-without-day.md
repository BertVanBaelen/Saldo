# 0.8.1-9 · One-off items without a day ("ergens in de maand")

| | |
|---|---|
| Version | [0.8.1 Improvements](README.md) |
| Status | planned (user answer 19 Nov 2026) |
| Size | M |
| Items | 2 |
| Concepts | [planned-item](../../analysis/concepts/planned-item.md), [forecast](../../analysis/concepts/forecast.md) |
| Screens | [planning](../../analysis/screens/planning.md) |
| Depends on | after 0.8.1-2 step 1 and 0.8.1-5 step 1 (all three edit `planning/forecast_project.go`; one after the other, 0.8-3 suite green between them) |
| Files | migration `0021_planned_whole_month.sql`, `server/internal/ledger/planning.go` (+ test), `planning/forecast_load.go`, `forecast_project.go`, `forecast_test.go`, `world_test.go`, `docs/api.md`, `web/src/lib/planning.ts`, `PlanningKalender.tsx`, the one-off sheet of 0.8.1-8 |

## Goal
The design's one-off sheet has "Dag (leeg = ergens in de maand)". User answer: a one-off may have **no day**, and is then spread over the month like variable spending. Today `planned_items.date` is required and the engine puts the whole amount on that date.

## Data
- Migration **0021** (0020 is 0.8.1-7's; 0.9 keeps 0018/0019; 0.9-3b's fallback becomes 0022): `ALTER TABLE planned_items ADD COLUMN whole_month INTEGER NOT NULL DEFAULT 0 CHECK (whole_month IN (0, 1));` Additive, no rebuild. A dayless item stores `date` = the month's 1st and `whole_month = 1`, so the index `(account_id, date)` and every month filter (`date[:7]`) keep working.
- **API** (`POST`/`PATCH /api/planning/planned`): the body carries either `date` (`YYYY-MM-DD`, as today) or `month` (`YYYY-MM`), never both (`400` "Kies een dag of alleen een maand."). Answers: `{id, accountId, date, month, wholeMonth, amount, description}` with `date: null` for a dayless item and `month` always set. Validation: `month` from the running month to running + 24 ("Kies een maand vanaf deze maand."); a PATCH may switch between the two.

## Engine rules (0.8-3, new rule 6b; items with a day are unchanged)
- **Which months**: a dayless item counts in its month m when m ≥ the running month; a past month's item is not counted (as past dated items).
- **Which days**: later months: every day 1 … n. The running month: the days **after today** (today excluded, the same days as the variable spending, `first = today + 1`). On the month's last day no day is left: the whole amount goes on **tomorrow** (the 1st of next month, as anything due by today that has not happened, 0.8 decision 5), line `planned` of that next month.
- **Cents**: per day `v = A / d` (Go integer division, truncating toward zero, signed), the last day gets `A − v × (d − 1)`, so the days sum exactly to A (the variable spreading's rule).
- **Day items**: each day gets one item `{kind: "planned", label: description, amount: v, id}` added after the variable item; the day balance, `Low` and the month's `Out`/`Income` include it as any expected item. The month line `planned` holds the whole A (labels list the description once). Need (rule 12): the whole A counts in its month (unchanged: grouped by month).
- **Lowest point**: a spread item lowers the balance gradually; the low is computed on the day balances as before.
- **No matching** (as every planned item, 0.8 known limit): a dayless item is never matched to a transaction, never "late", never "Verwacht, niet gezien". Spending it during the month is counted twice until the month ends (the booked rows and the remaining spread days): known limit, the user removes the item once paid.

## UI
- One-off sheet (0.8.1-8): "Dag (leeg = ergens in de maand)"; an empty day sends `month`. The preview line says "· verdeeld over juli".
- Eenmalig list: the chip "JUL 2027" and the note "Ergens in juli 2027" (the design's "Juli 2027").
- Kalender: no dot on any day for a spread item (it is on every day); above the grid a line per dayless item of the month shown: "Zomervakantie −€ 1.500,00 · verdeeld over juli (ongeveer −€ 48,38 per dag)" (150000 / 31 = 4838, the last day 4860); the day card lists it as "Zomervakantie (verdeeld)" with the day's part. Maanden breakdown "Eenmalig en gepland" names it as any planned item.

## Steps
1. **Sonnet**: migration, `ledger/planning.go` (`month`, `wholeMonth`, validation), handler tests, `docs/api.md`.
2. **Opus**: rule 6b in `Project` and `LoadFacts` (`FactPlanned.WholeMonth`), the tests below; every existing 0.8-3 golden unchanged (no seeded item is dayless).
3. **Sonnet**: the sheet field, the Eenmalig note, the Kalender line and day card, vitest.

## Tests
- **0.8-3 goldens**: `TestForecastDemo`, `planningWorld` and the edge tests pass unchanged (whole_month = 0 everywhere).
- **New `planningWorld` cases** (lead adds to W1, then derives the end balances with the throwaway script and writes them here before step 2):
  - dayless −3100 in December 2026 (31 days): −100 on each of 1–31 December; December's `planned` line −3100 (with Feest −10000 → −13100), December End 297500 − 3100 = **294400**; every later month end 3100 lower.
  - dayless −1300 in November 2026, today 2026-11-18: days 19–30 (12 days): −108 on 19–29, −112 on 30 November (108 × 11 = 1188, 1300 − 1188 = 112); November End 1300 lower than the W1 golden.
  - dayless +5000 in November with today 2026-11-30: no day left, +5000 on 2026-12-01 in December's `planned` line.
  - dayless −1000 in October 2026 with today 2026-11-18: not counted.
  - Sign: −1000 over 3 days → −333, −333, −334.
- Handler: `{month: "2026-10"}` with today 2026-11-18 `400`; both `date` and `month` `400`; a PATCH from a date to a month answers `date: null, wholeMonth: true`.
- Vitest: the Kalender line text, no day dot, the day card label, the Eenmalig note "Ergens in juli 2027".

## Who builds it
- **Opus**: step 2 (the engine and its goldens). **Sonnet**: steps 1 and 3.

## Done when
A one-off without a day is spread over its month (remaining days in the running month) with exact cents, shows as such in the Kalender and Eenmalig, and every dated item and every 0.8-3 golden behaves as before.
