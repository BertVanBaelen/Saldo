# 0.1-5 · E-mails and pushmeldingen

| | |
|---|---|
| Version | [0.1 Mockup](README.md) |
| Status | done (3 Nov 2026) |
| Size | M |
| Features | UI-3 |
| Concepts | [notification](../../analysis/concepts/notification.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [authentication](../../analysis/concepts/authentication.md), [bank-connection](../../analysis/concepts/bank-connection.md), [design-system](../../analysis/concepts/design-system.md), [demo-data](../../analysis/concepts/demo-data.md) |
| Screens | [emails](../../analysis/screens/emails.md), [pushmeldingen](../../analysis/screens/pushmeldingen.md) |
| Design boards | E-mail-Berichten, Meldingen-Android, Meldingen-Icoon, Saldo-Icoon |
| Depends on | [0.1-1](01-foundation-and-start.md) |

## Goal
Every message Saldo sends, ready to become server templates in 0.2-4, 0.3-2 and 0.9-1.

## Steps
1. Nine e-mails as mail-client-safe HTML plus plain text, with the Go template fields listed at the top (`finance-mockup/emails/`).
2. Gallery page `berichten.html`: e-mails, lock screen, notification shade light and dark, expanded red notification with chart, status-bar icon.
3. Icon files: app icon (square and round) and status-bar silhouette.

## Done when
All messages match the boards. ✔

## Open questions found (resolved 3 Nov 2026)
- Consent expiry 14 days in the messages vs 12 days in the app screens: both are right. The consent ends on 30 November; the 14-day reminder went out on 16 November, the app says 12 days on 18 November.
- Real mail clients and real phones are not tested yet: that happens in 0.9-1 and 0.9-5 (Android and iPhone).