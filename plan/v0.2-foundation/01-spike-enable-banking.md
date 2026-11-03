# 0.2-1 · Spike S1 · Enable Banking

| | |
|---|---|
| Version | [0.2 Foundation](README.md) |
| Status | planned |
| Features | PLAT-1 |
| Concepts | [bank-connection](../../analysis/concepts/bank-connection.md), [account](../../analysis/concepts/account.md), [shared-account](../../analysis/concepts/shared-account.md), [transaction](../../analysis/concepts/transaction.md) |
| Analysis | 6.1, 13.1, risks 2, 3, 5 |
| Depends on | – (can run alongside 0.1) |

## Goal
Know what the bank API really returns before building on it. A short check, not a feature; nothing is stored.

## Steps
1. Register your own Enable Banking app in restricted production mode.
2. Link the personal and the shared Argenta account in **one** consent.
3. With a throwaway read-only script: fetch accounts, balances and transactions.
4. Record: history depth, whether the shared IBAN is returned, `entry_reference` stability across sessions, what a second consent does to the first.
5. Partner repeats it with her own app.

## Done when
Every assumption in analysis 6.1 is confirmed or corrected in [bank-connection](../../analysis/concepts/bank-connection.md).
