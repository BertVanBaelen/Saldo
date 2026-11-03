# 0.3-1 · Sync engine

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | planned |
| Size | L |
| Features | BANK-3 |
| Concepts | [transaction](../../analysis/concepts/transaction.md), [account](../../analysis/concepts/account.md), [bank-connection](../../analysis/concepts/bank-connection.md) |
| Analysis | 4.1, 5.1, 6.3 (dedupe), 7 (reliability) |
| Depends on | [0.2-6](../v0.2-foundation/06-first-bank-link.md) |

## Goal
Fetch transactions and balances every night, reliably, without duplicates and without ever losing data.

## Steps
1. Nightly sync around 04:00, incremental; it retries later when it runs into the Home Assistant backup window. "Nu synchroniseren" with a rate limit (as found in spike S1).
2. Pagination and `EXPIRED_SESSION` handling; status, last sync and last error per account (`account_source`); a failed sync never deletes data.
3. Dedupe key: IBAN + booked `entry_reference`, falling back to a hash of date, amount, counterparty and communication, with occurrence counting for identical rows.
4. Pending → booked; pending rows excluded from totals. Raw payload stored.
5. `balance_snapshot` per sync.
6. Table tests for dedupe; integration tests with the fake provider (re-sync, overlap, pending changes, a failing bank).

## Done when
Running the sync twice gives the same data, balances match the bank, and a failing bank shows a status instead of losing anything.