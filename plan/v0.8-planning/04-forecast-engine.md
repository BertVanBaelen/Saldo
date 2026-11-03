# 0.8-4 · Forecast engine

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | planned |
| Size | L |
| Features | PLAN-4 |
| Concepts | [forecast](../../analysis/concepts/forecast.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [scope](../../analysis/concepts/scope.md), [internal-transfer](../../analysis/concepts/internal-transfer.md), [shared-account](../../analysis/concepts/shared-account.md) |
| Analysis | 5.3 |
| Depends on | [0.8-1](01-recurring-items.md), [0.8-2](02-budgets.md), [0.8-3](03-planned-items.md) |

## Goal
The calculation behind every planning number, per current account.

## Steps
1. Month projection per account from its latest bank balance: recurring, variable, one-off, saved, transfers to and from your other accounts; `left_or_short` against the account's own buffer.
2. Daily line: items on their day, variable spending spread over the days; lowest point of the month.
3. States per month and day: ok, in the buffer (warning), below zero (error); with several accounts in view a day takes the worst state and names the accounts. No state on any sum.
4. Horizon 3 to 24 months.
5. Required monthly contribution for a shared account.
6. Table tests with the demo story: Zichtrekening below zero on 1 November, January € 178,50 under its buffer, February −€ 1.033,47; Gedeelde rekening stays above its buffer.

## Done when
The tests reproduce the Planning numbers of the mockup.