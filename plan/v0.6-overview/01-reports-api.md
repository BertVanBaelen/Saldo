# 0.6-1 · Reports API

| | |
|---|---|
| Version | [0.6 Overview](README.md) |
| Status | planned |
| Features | OVER-1, OVER-2 |
| Concepts | [period-overview](../../analysis/concepts/period-overview.md), [internal-transfer](../../analysis/concepts/internal-transfer.md), [account-group](../../analysis/concepts/account-group.md), [category](../../analysis/concepts/category.md) |
| Analysis | 4.4 |
| Depends on | 0.5-4 |

## Goal
Correct totals per period, per viewer and scope.

## Steps
1. Income, expenses and saved per month, quarter and year; booking date in Europe/Brussels; pending and internal transfers left out.
2. Per category: total, share, trend against the previous period.
3. Filter by scope and by account.
4. Table tests with the demo story numbers (October 2026: income € 3.350, expenses € 2.759,97, saved € 200).

## Done when
The API returns the Overzicht board's numbers for the demo data.
