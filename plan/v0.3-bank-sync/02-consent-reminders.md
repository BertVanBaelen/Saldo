# 0.3-2 · Consent status and reminders

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | planned |
| Size | M |
| Features | BANK-4 |
| Concepts | [bank-connection](../../analysis/concepts/bank-connection.md), [notification](../../analysis/concepts/notification.md) |
| Screens | [bank-koppelen](../../analysis/screens/bank-koppelen.md), [start](../../analysis/screens/start.md), [rekeningen](../../analysis/screens/rekeningen.md), [emails](../../analysis/screens/emails.md) |
| Analysis | 4.1, 4.9, risk 4 |
| Depends on | [0.3-1](01-sync-engine.md), [0.2-4](../v0.2-foundation/04-sign-in-users-mail.md) (mailer) |

## Goal
Never let the sync stop silently.

## Steps
1. Consent expiry and last sync per connection and per account; Bankkoppelingen shows them, with the warn and error states as designed.
2. Start alert "Toestemming verloopt over N dagen" and the warn dot on Bankkoppelingen (red after a failed sync).
3. E-mails "Koppeling verloopt" at 14 and 3 days and "Synchronisatie gestopt", using the mockup templates. Push follows in 0.9.
4. Daily job that decides which reminders are due, without repeats (`notification_log`).

## Done when
With the fake provider set to expire, the alert and both e-mails arrive at the right moments, once.