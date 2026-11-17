# 0.6-2 · Privacy suite for every endpoint

| | |
|---|---|
| Version | [0.6 Shared accounts](README.md) |
| Status | built (16 Nov 2026), to verify |
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

## Built (16 Nov 2026)
`server/internal/server/privacy_test.go`: the route table `privacyRows` covers all 77 registered patterns (73 method routes, the demo-only `GET /api/demo/as/{who}`, and the fallbacks `/api/`, `/api`, `/`); `TestEveryRouteHasAPrivacyRow` parses the `HandleFunc` patterns from the package's non-test code (and fails when a `HandleFunc` call has no literal pattern), fails on a route without a row or a row without a route, and checks that the named tests exist and that every `list` and `byid` row has probes. `TestPrivacyRoutes` runs each row on a fresh three-user world over a real bank link (Bert, Partner joined to Bert's family account with edit, Derde whose account is offered to Bert), with private data of every kind per user: accounts, manual accounts, notes, a split, user and account rules, imports and a two-account import run, mappings, suggestions, devices, offers, notices, an invitation, a transfer override and sync errors. Each probe must reach its route, answer its status and hold none of the other user's sentinels; another user's ids (path, query and body: accountId, accountMap, connectionId, ruleId, link state, suggestion keys, rule order) answer exactly like ids that do not exist and write nothing (snapshot of every table but the audit log), and the owner's same request is not a `404`. `TestPrivacySentinels` runs every read as both users in five states (baseline, read-only, after leaving, after deleting the family account, after deleting Partner) with a positive control per sentinel; mails sent during a row are checked too. `TestPrivacyPagesAndTotals` pages through the list (`total`, `next`); `TestTransferIsPerViewer` and `TestMatchingIsPerViewer` (the same row on both users' accounts: suggestions, backfill, exact and probable import duplicates, rule preview, category counts, rule ids) check rule 5; `TestLeaverLosesHerSharedObjects` checks a member's own import and rule on a shared account after she leaves.

Holes found and fixed (each with a regression test):
- `GET /api/imports`: `run` of a batch on the family account named the id of the importer's batch on his personal account. `run` is now the lowest id among the run's batches the viewer can see (`ledger.Batches`). Test: `TestImportRunIsPerViewer`.
- `GET /api/imports/{id}/undo-preview?run=1` and `POST .../undo?run=1`: a member got `404` for a batch she could see (the run included an account she cannot see, which told her so). A run is now the viewer's part of it, and the batch named must be visible (`ledger.undoBatches`); read-only still `403`. Test: `TestImportRunIsPerViewer`.
- `DELETE /api/connections/{id}`: another user's link that was syncing answered `503` after waiting instead of `404`, which told it existed and was syncing. Ownership is checked before waiting (`ledger.OwnConnection`). Test: `TestDeleteHiddenConnectionWhileItSyncs`.

Known exceptions, documented, not changed (a design decision each): the category tree is shared (names of categories anyone made; removing a category without `moveTo` refuses while any user's split uses it, one bit about other users' splits); the admin sees users' names and addresses and the counts of `removal-preview`.

## Review (16 Nov 2026)
An independent review read every handler registered in `server/server.go` and the ledger, banklink, categorise and lifecycle code they call (auth, users, notify and mail, unchanged since their own reviews, were read where 0.6 touches them: sign-in codes and attempts, tokens, devices, user names, reminders; the mail templates and `password.go` only grepped), the middleware (viewer resolution, CSRF, headers, logging), the static server and `apiFallback`, `main.go` and `config.go` (the `Options.Viewer` hook is never set outside tests; demo mode comes from `SALDO_DEMO` only, and `demo.Seed` refuses a database with users unless it carries the demo marker), and migrations 0011 to 0013. Every account-scoped read joins `account_access` on the viewer, and every id from a path, query or body passes through `accessOf`, `editable`, `visibleRules`, an owner check or a viewer filter before anything else can answer, so hidden and missing answer alike. One hole was found and fixed: a `left`, `manager` or `deleted` notice showed the actor's live name, so a member who had left (or a manager who deleted the account) leaked a later rename to people they no longer share an account with; `noticeAlerts` now prefers the name stored at the event (low severity: one display name, passively seen; `docs/api.md` says so). Test: `TestNoticeKeepsTheFormerMembersName` (`server/review_test.go`). Left as design decisions, not changed: deleting or merging a category rewrites every user's transactions and deletes other users' rules with it (`moveTo=none`), whoever asks; a join offer lets anyone whose bank lists an IBAN join that account with edit and its whole history, with only a notice to the manager afterwards; `Leave`, `DeleteAccount` and `RemoveUser` do not wait for a running sync of the leaver's link (`Bank.Exclusive`), so that sync may still write rows to the account it carried (never back to the leaver); ids are global sequences, so their gaps show that others create rows; a batch's `invalid` count includes the file's rows of other accounts and is seen by later members; `RemoveConnection`'s `kept` list and `carriedBy` rely on the invariant that a source's owner is a member.
