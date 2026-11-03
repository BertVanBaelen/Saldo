# 0.8-2 · Budgets and variable spending

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | planned |
| Size | M |
| Features | PLAN-2 |
| Concepts | [budget](../../analysis/concepts/budget.md) |
| Screens | [planning](../../analysis/screens/planning.md) |
| Analysis | 4.5 (2) |
| Depends on | [0.8-1](01-recurring-items.md) |

## Goal
Estimate the spending that is not fixed, per account.

## Steps
1. `budget`: account, category, monthly amount, from month.
2. Without a budget, use the average of the past 6 months.
3. Subtract what recurring items already cover, so nothing is counted twice.
4. Edit budgets in the Budget tab as designed (− / + in € 10 steps, use the average, no budget).

## Done when
Variable spending per month and account is available to the forecast, with budgets you can edit.