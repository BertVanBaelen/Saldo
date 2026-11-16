# 0.5.1-1 · Fix: a link with two accounts syncs only the last

| | |
|---|---|
| Version | [0.5.1](README.md) |
| Size | S |
| Type | bug fix, server only |

## Report (user, 16 Nov 2026)
When one bank link (one login at the bank) covers two accounts, only the last of them is synced.

## What is known
Reading the code found no loop that stops early, so **reproduce first**. Checked and looking right: `banklink/sync.go` `syncConnection` loops over every `sources` row and a failing account does not stop the others; `ledger.Keyed` and the unique index `(account_id, dedupe_key, occurrence)` are per account; `ledger.StoreFetch` is per account and connection; `ledger/connections.go` lists all accounts of a connection. Not yet checked: the real shape of the provider's answers in `bank/enablebanking` (`CreateSession` reads `accounts[]` objects with `uid`; `ListAccounts` reads uid strings and then `/accounts/{uid}/details`), `banklink.match` / `storeConsent` for the second account (an IBAN that already exists, an account without IBAN is skipped silently, `external_account_id` reset to NULL then set per account), `bank/fake` (does it model two accounts?), `demo/sync.go`, and the web side (Start, Rekeningen, Bankkoppelingen showing sync state of only one account).

## Steps
1. Write a failing test first, with two accounts in one connection: link through `storeConsent`/`Complete` with a session that lists two accounts, run `Sync`, assert **both** accounts got their transactions, their bank balance snapshot and `account_sources.status = 'ok'` with a fresh `last_sync_at`. Use `bank/fake` (extend it with a second account if needed) and also an `httptest` server for `enablebanking` returning a two-account session.
2. Find the cause by following the data: provider answer, parsing, `account_sources` rows, `sources()` query, fetch, store. Fix it in the layer that owns it, nothing else.
3. If the test passes without a change (the bug is then only in the real bank's answers), do not guess a fix: report exactly which assumption could not be reproduced and add the missing two-account regression test anyway. The lead will ask the user for the server log of a real sync.

## Done when
A two-account link syncs both accounts in the test; `cd server && go test ./internal/banklink/... ./internal/bank/... ./internal/ledger/... ./internal/server/...` passes.

## Result (16 Nov 2026)
**The reported symptom was not reproduced.** The owner has one link with two accounts and says only the second syncs; there are no logs. Two agents found no mechanism in the code that skips the first account when both are fresh and healthy (tests `twoaccounts_test.go`). The second, deeper pass (`firstaccount_test.go`) found and fixed three real defects that can make one account fail or go stale silently, but none is proven to be the live cause:
1. A database or data error in `fromDate` or `storeAccount` aborted `syncConnection` (`return err`): later accounts were skipped and nothing was recorded. It is per account now (`storeFailed`, code `store_failed`), and the connection is marked failed.
2. `fromDate` used `MAX(booking_date)` over every row: one pending row dated more than 14 days ahead clamped the window to today. It ignores future rows and accepts a date with a time.
3. An account left out of a re-consent had its provider id cleared and silently dropped out of the sync. It is marked failed with `not_shared`.
Rekening and Bankkoppelingen now show the failure code and the last attempt of each account (`GET /api/accounts`: `syncError`, `lastAttempt`).

**To verify on the live add-on:** after installing, open Rekening for the first account (Synchronisatie card) and Bankkoppelingen. A code there names the cause: `not_shared` (authorise again and tick both accounts), a provider code or `http_<status>` (bank refusal or limit), `store_failed` (read the server log). If it shows nothing and the account still has no new transactions, run the SQL in the agent's report (kept in the session; it lists `external_account_id`, status, error, newest booking date and counts per source).
Unconfirmed risks, not changed: an account without transactions asks for the full history on every sync (`strategy=longest`) and may never finish; imported history can give a `date_from` the bank refuses (older than 90 days); a failed balance fetch discards a completed transaction fetch.
