# 0.8-1 · Recurring items

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | planned |
| Size | L |
| Features | PLAN-1 |
| Concepts | [recurring-item](../../analysis/concepts/recurring-item.md) |
| Screens | [planning](../../analysis/screens/planning.md) |
| Analysis | 4.5 (1), risk 12 |
| Depends on | [0.6-3](../v0.6-shared-accounts/03-transfers-and-saved.md), [0.5-5](../v0.5-bilance-import/05-batches-and-undo.md) (12+ months of history) |

## Goal
The fixed income and costs the forecast is built on, confirmed by you.

## Steps
1. Detection over the full history (synced and imported): same counterparty, amount within about 10 %, monthly, quarterly or yearly interval, at least 3 occurrences (2 for yearly **[verify with real data]**).
2. Suggestions to confirm ("Maandelijks · rond de 3e · 4 keer gezien"); Bevestigen opens the form prefilled, Negeren is remembered.
3. Add and edit by hand: account, kind (income, expense, saving, transfer), fixed or average amount, frequency, expected day (and month), end date; delete.
4. Table tests with the demo items (salary, rent, contribution, family insurance).

## Done when
Your real recurring items, including the yearly ones, are in the Terugkerend tab, confirmed.