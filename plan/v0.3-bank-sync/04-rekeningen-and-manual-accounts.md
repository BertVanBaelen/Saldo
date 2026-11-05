# 0.3-4 · Rekeningen, account detail and manual accounts

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | built (5 Nov 2026), to verify on the live add-on |
| Size | M |
| Features | ACCT-1 |
| Concepts | [account](../../analysis/concepts/account.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [bank-connection](../../analysis/concepts/bank-connection.md) |
| Screens | [rekeningen](../../analysis/screens/rekeningen.md) |
| Analysis | 3, 4.7, 4.8 (remove a link) |
| Depends on | [0.3-1](01-sync-engine.md) |

## Goal
Manage your accounts, including the savings accounts the bank does not expose.

## Steps
1. Rekeningen: name, colour (8) and minimum buffer per current account, as designed.
2. Account detail: balance history, settings, Synchronisatie (sources, consent, re-authorise, remove your link with keep or delete history), recent transactions.
3. Manual accounts: savings or a current account without a bank link; register an IBAN only to recognise transfers; update the balance by hand with history and "last updated".
4. Add an account: link a bank account (wizard) or create a manual account.

## Done when
You see all your accounts with the buffer you set, and your savings balances with their date.