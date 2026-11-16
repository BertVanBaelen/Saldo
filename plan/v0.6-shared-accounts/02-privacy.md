# 0.6-2 · Privacy suite for every endpoint

| | |
|---|---|
| Version | [0.6 Shared accounts](README.md) |
| Status | planned |
| Size | M |
| Features | SHARE-3 |
| Concepts | [user-and-visibility](../../analysis/concepts/user-and-visibility.md) |
| Analysis | 2, risk 7 |
| Depends on | [0.6-1](01-membership-and-lifecycle.md) |

## Goal
Make it impossible for one user to see another user's accounts or figures, now that accounts can be shared.

## Steps
1. Extend the privacy tests from 0.2-5 to every endpoint: lists, search, reports, imports, exports, notifications.
2. Cases with a shared account: Partner sees the shared account and its history, never Bert's personal accounts, balances, counterparties or transfers; a read-only member cannot change anything.
3. Review all endpoints from 0.2 to 0.5 against the rule.

## Done when
The privacy suite covers every endpoint, runs in CI and passes.

## What exists and how to build it (16 Nov 2026)
`server/security_test.go` holds the 0.2-5 checks; viewer-scoped queries go through `account_access`. Build **one table** over the routes registered in `server/server.go` (`m.HandleFunc`), with a test that fails when a route has no row, and per row the cases: another user's personal account is never visible (404, not 403, and absent from lists, search, counts, suggestions, backfill, imports and undo, rules, categories counts, alerts, `syncError`/`syncReport`), a read-only member cannot write, a shared account's history is visible to its members only. Include join offers and notices (1a), members (1b) and the lifecycle routes (1c). The reviewer reads the code and this rule, not the implementer's summary.
