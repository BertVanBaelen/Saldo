# 0.3-5 · Start with balances and alerts

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | built (9 Nov 2026), to verify on the live add-on |
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

## Built (9 Nov 2026)
Start already showed balances per current account against their own buffer, the sum as information, the Persoonlijk and Gedeeld sections with sync sublines, the sync button with progress and the existing alerts (from 0.2 and 0.3-2). This phase closed the gaps:
- The welcome steps follow reality: Enable Banking key stored = step 1 done, a pending link continues at its page, counter "N van 3 klaar".
- Bank-account sublines read "Synchroniseren…" while a sync runs.
- A user with only savings accounts gets a "Nog geen zichtrekening" card instead of a blank top.
- Alert order follows the spec ([start](../../analysis/screens/start.md), "Alerts (order)"): red first, then stale-account warnings, then consent-expiring warnings, then "te categoriseren" (planning alerts join in 0.8).
- Account-level sync alerts carry an optional `accountId` ([docs/api.md](../../docs/api.md), `GET /api/alerts`); Start hides such an alert when its account is outside the chosen scope.