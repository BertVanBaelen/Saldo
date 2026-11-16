# 0.6-0 · Sync diagnostics for the account that never syncs

| | |
|---|---|
| Version | [0.6 Shared accounts](README.md) |
| Status | built (16 Nov 2026), to verify on the live add-on |
| Size | S |
| Follows | [0.5.1-1](../v0.5.1-category-look/01-sync-two-accounts.md) |

## Why
One bank link, two accounts, and only the second syncs (user, 16 Nov 2026). With 0.5.1 installed the sync card shows no failure message and the first account has no new transactions: a silent failure. Two agents found no cause in the code, so the next step is to make a sync say what it did, per account, without needing logs.

## Goal
After a sync, Rekening shows for each bank account what the bank returned and what Saldo kept, so "fetched 0" (bank side), "fetched 20, added 0" (storing or dedupe side) and "ids swapped" (wrong account) can be told apart.

## Contract
Migration `0011_sync_report.sql` adds nullable columns to `account_sources`: `last_from TEXT` (the `date_from` asked, empty = longest), `last_fetched INTEGER`, `last_added INTEGER`, `last_newest TEXT` (newest booking date the bank returned), `last_balance_date TEXT` (date of the balance stored), `last_external_tail TEXT` (the last 4 characters of the provider's account id used). Written in `storeAccount` (success) and left as before on a failure. `GET /api/accounts` gets `syncReport` on bank accounts: `{"at": "...", "from": "2026-11-02" | null, "fetched": 12, "added": 0, "newest": "2026-11-18" | null, "balanceDate": "2026-11-18" | null, "idTail": "a3f9"}` or `null` before the first successful sync; visible to every member. `StoreFetch` must report how many rows it received and how many it inserted (it returns the inserted count already).
Log one INFO line per account per sync: `bank sync account` with connection, account, from, fetched, added, newest.

## Server steps
1. Migration and the writes in `banklink/sync.go` `storeAccount`.
2. `ledger/accounts.go`: `SyncReport` on `Account`, read with the sources.
3. Tests: a two-account link where the fake bank returns different counts per account; the report of each account is its own; `idTail` differs between the two accounts; a failed account keeps its old report; `docs/api.md` updated.

## Web steps
1. `Rekening.tsx` Synchronisatie card: a line "Laatste synchronisatie: de bank gaf 12 transacties vanaf 2 november, 0 nieuw (nieuwste 18 november), saldo van 18 november · bank-id …a3f9" in Dutch plain words; when `fetched` is 0 the line says so ("De bank gaf geen transacties terug"). Same short line per account in "Leest N rekeningen" on Bankkoppelingen.
2. Tests for the line variants.

## Done when
A two-account sync shows a different, correct report per account in tests; the web shows it. Then ask the user for the line of the first account: that line names the cause.
