# 0.1-5 · E-mails and pushmeldingen

| | |
|---|---|
| Version | [0.1 Mockup](README.md) |
| Status | done (3 Nov 2026) |
| Features | UI-3 |
| Concepts | [notification](../../analysis/concepts/notification.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [authentication](../../analysis/concepts/authentication.md), [bank-connection](../../analysis/concepts/bank-connection.md), [design-system](../../analysis/concepts/design-system.md), [demo-data](../../analysis/concepts/demo-data.md) |
| Screens | [emails](../../analysis/screens/emails.md), [pushmeldingen](../../analysis/screens/pushmeldingen.md) |
| Design boards | E-mail-Berichten, Meldingen-Android, Meldingen-Icoon, Saldo-Icoon |
| Depends on | 0.1-1 |

## Goal
Every message Saldo sends, ready to become server templates in 0.2-4 and 0.8-1.

## Steps
1. Nine e-mails as mail-client-safe HTML plus plain text, with the Go template fields listed at the top (`finance-mockup/emails/`).
2. Gallery page `berichten.html`: e-mails, lock screen, notification shade light and dark, expanded red notification with chart, status-bar icon.
3. Icon files: app icon (square and round) and status-bar silhouette.

## Done when
All messages match the boards. ✔

## Open questions found
- Consent expiry 14 days in the messages vs 12 days in the app screens → decide in 0.1-7.
- Real mail clients and a real Android phone are not tested yet (that happens in 0.8-1 and 0.8-5).
