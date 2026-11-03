# 0.3-3 · Sync engine

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | planned |
| Features | BANK-3 |
| Concepts | [transaction](../../analysis/concepts/transaction.md), [account](../../analysis/concepts/account.md), [bank-connection](../../analysis/concepts/bank-connection.md) |
| Analysis | 4.1, 6.3 (dedupe), 5.1 |
| Depends on | 0.3-2 |

## Goal
Fetch transactions and balances reliably, without duplicates and without ever losing data.

## Steps
1. First sync with `strategy=longest`; nightly sync around 04:00, incremental; "Sync now" with a rate limit.
2. Pagination and `EXPIRED_SESSION` handling; per-account status; a failed sync never deletes data.
3. Dedupe key: IBAN + booked `entry_reference`, falling back to a hash of date, amount, counterparty and communication, with occurrence counting for identical rows.
4. Pending → booked; pending rows excluded from totals. Raw payload stored.
5. `balance_snapshot` per sync.
6. Table tests for dedupe; integration tests with the fake provider (re-sync, overlap, pending changes).

## Done when
Running the sync twice gives the same data; balances match the bank.
