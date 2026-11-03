# 0.7-1 · Recurring items

| | |
|---|---|
| Version | [0.7 Planning](README.md) |
| Status | planned |
| Features | PLAN-1 |
| Concepts | [recurring-item](../../analysis/concepts/recurring-item.md) |
| Screens | [planning](../../analysis/screens/planning.md) (Terugkerend) |
| Analysis | 4.5 (1), risk 12 |
| Depends on | 0.5-3 |

## Goal
The fixed income and costs the forecast is built on, confirmed by you.

## Steps
1. Detection: same counterparty, amount within about 10 %, monthly, quarterly or yearly interval, at least 3 occurrences (2 for yearly **[verify with real data]**).
2. Suggestions to confirm ("Maandelijks · rond de 3e · 4 keer gezien"), Bevestigen / Negeren.
3. Confirmed item: expected day, fixed or average amount, frequency, end date, kind (income, expense, transfer, saving), owner (account or user).
4. Table tests with the demo items (salary, rent, contribution, family insurance).

## Done when
Your real recurring items are detected and confirmed in the Terugkerend tab.
