# 0.3-5 · Start with balances and alerts

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | planned |
| Size | S |
| Features | ACCT-2 |
| Concepts | [account](../../analysis/concepts/account.md), [scope](../../analysis/concepts/scope.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [bank-connection](../../analysis/concepts/bank-connection.md) |
| Screens | [start](../../analysis/screens/start.md) |
| Analysis | 4.5 (states), 12 (screen 2) |
| Depends on | [0.3-2](02-consent-reminders.md), [0.3-4](04-rekeningen-and-manual-accounts.md) |

## Goal
Open the app and see where every account stands today.

## Steps
1. Saldo nu per current account against its own buffer; with several accounts in view the sum as information.
2. Account sections (Persoonlijk, Gedeeld) with balances and sync status; the sync button with progress.
3. Alerts that already exist: consent expiring, stale or failed sync.
4. Welcome steps when there are no accounts yet. Spending (0.7-3) and the forecast parts (0.8-6) come later.

## Done when
Start shows your real balances and warns you about the bank link, on phone and desktop.