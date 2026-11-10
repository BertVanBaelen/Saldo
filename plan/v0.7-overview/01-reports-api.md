# 0.7-1 · Reports API

| | |
|---|---|
| Version | [0.7 Overview](README.md) |
| Status | planned |
| Size | M |
| Features | OVER-1, OVER-2 |
| Concepts | [period-overview](../../analysis/concepts/period-overview.md), [internal-transfer](../../analysis/concepts/internal-transfer.md), [scope](../../analysis/concepts/scope.md), [category](../../analysis/concepts/category.md) |
| Analysis | 4.4 |
| Depends on | [0.6-4](../v0.6-shared-accounts/04-scope-and-sums.md) |

## Goal
Correct totals per period, per viewer, per account and per scope.

## Steps
1. Income, expenses and saved per month, quarter, year and custom range; booking date in Europe/Brussels; pending and internal transfers left out.
2. Per account, and summed over the accounts in a scope as information.
3. Per category: total, share, trend against the previous period.
4. Table tests with the demo story numbers (October 2026: income € 3.350, expenses € 2.759,97, saved € 200 for all accounts together).

## Done when
The API returns the Overzicht numbers of the mockup for the demo data.

## Carried over from 0.4 (10 Nov 2026)
- **Split rows** are summed by their parts (`transaction_split`); the row's own category fields are kept only for undo and are hidden, so never sum a split row under them.
- **Pending rows** are excluded from the totals.
- **Transfers** are left out at query time (0.6-3), not by category: a transfer may carry a category and would otherwise count in that category's total.