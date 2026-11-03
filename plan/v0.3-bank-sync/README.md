# Version 0.3 · Bank sync

**After this version you can** link your Argenta accounts, see your real transactions and balances, synced every night or on demand, add your savings accounts by hand, set the name, colour and buffer of each account, and import a CSV file. You are warned before the bank consent expires.

Status: planned. Analysis milestone: M1. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| BANK-1 | Enable Banking setup per user (application id and private key) |
| BANK-2 | Link Argenta, choose accounts, re-authorise |
| BANK-3 | Nightly sync and "Sync now", bank balances, pending transactions, no duplicates |
| BANK-4 | Consent and sync status, reminders in the app and by e-mail (14 and 3 days) |
| TX-1 | CSV import (generic, Argenta export) |
| TX-2 | Transacties: list by day, search, filters, detail |
| ACCT-1 | Rekeningen: name, colour and buffer per account; manual savings accounts and balances |

## Phases
| Phase | Title | Features | Status |
|---|---|---|---|
| [0.3-1](01-provider-adapter.md) | Provider adapter and Enable Banking client | BANK-1 | planned |
| [0.3-2](02-linking-flow.md) | Linking flow and account matching | BANK-2 | planned |
| [0.3-3](03-sync-engine.md) | Sync engine | BANK-3 | planned |
| [0.3-4](04-consent-reminders.md) | Consent status and reminders | BANK-4 | planned |
| [0.3-5](05-csv-import.md) | Basic CSV import | TX-1 | planned |
| [0.3-6](06-transacties-and-rekeningen.md) | Transacties and Rekeningen live | TX-2, ACCT-1 | planned |

## Concepts
bank-connection, account, transaction, shared-account (linking only, joining comes in 0.5), import, notification (consent e-mails), buffer-and-states (buffer setting).

## Exit criteria
Your Argenta transactions appear and re-sync without duplicates (first tested on a local copy; the public link waits for 1.0-2).
