# 0.5-2 · Per-viewer visibility

| | |
|---|---|
| Version | [0.5 Shared accounts](README.md) |
| Status | planned |
| Features | SHARE-3 |
| Concepts | [user-and-visibility](../../analysis/concepts/user-and-visibility.md) |
| Analysis | 2, risk 7 |
| Depends on | 0.5-1 |

## Goal
Make it impossible for one user to see another user's accounts or figures.

## Steps
1. Every query that touches financial data goes through `account_access` for the viewer (lists, search, reports, exports, notifications).
2. A privacy test suite: user A never sees user B's accounts, balances, counterparties or transfers, in every endpoint.
3. Review existing endpoints from 0.3 and 0.4 against the rule.

## Done when
The privacy suite runs in CI and passes.
