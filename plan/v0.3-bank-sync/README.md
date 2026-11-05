# Version 0.3 · Bank sync

**After this version you can** rely on Saldo every day: your accounts sync every night or on demand without duplicates, you are warned before a bank consent expires or when a sync fails, you find any transaction, you set the name, colour and buffer of each account, you add your savings accounts by hand, and you import an Argenta CSV file.

Status: in progress (5 Nov 2026): the sync engine (0.3-1) and the consent reminders (0.3-2) are built and wait for two weeks of nightly syncs and a real consent expiry; Transacties, Rekeningen with manual accounts, Start and the CSV import are next. Analysis milestone: M1. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| BANK-3 | Nightly sync and "Sync now", bank balances, pending transactions, no duplicates |
| BANK-4 | Consent and sync status, reminders in the app and by e-mail (14 and 3 days) |
| TX-2 | Transacties: list by day, search, filters, detail |
| ACCT-1 | Rekeningen and account detail: name, colour and buffer per account; manual accounts and balances |
| ACCT-2 | Start: balance now per account, accounts, sync and bank alerts |
| TX-1 | CSV import (generic, Argenta export) |

## Phases
| Phase | Title | Size | Features | Status |
|---|---|---|---|---|
| [0.3-1](01-sync-engine.md) | Sync engine | L | BANK-3 | built, to verify |
| [0.3-2](02-consent-reminders.md) | Consent status and reminders | M | BANK-4 | built, to verify |
| [0.3-3](03-transacties.md) | Transacties | M | TX-2 | built (5 Nov 2026), to verify on the live add-on |
| [0.3-4](04-rekeningen-and-manual-accounts.md) | Rekeningen, account detail and manual accounts | M | ACCT-1 | planned |
| [0.3-5](05-start-balances.md) | Start with balances and alerts | S | ACCT-2 | planned |
| [0.3-6](06-csv-import.md) | Basic CSV import | M | TX-1 | planned |

## Concepts
bank-connection, account, transaction, scope, buffer-and-states, import, notification (consent e-mails).

## Exit criteria
Your Argenta transactions re-sync every night without duplicates for two weeks in a row, and the consent reminders arrive.