# 0.3-4 · Consent status and reminders

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | planned |
| Features | BANK-4 |
| Concepts | [bank-connection](../../analysis/concepts/bank-connection.md), [notification](../../analysis/concepts/notification.md) |
| Screens | [start](../../analysis/screens/start.md), [rekeningen](../../analysis/screens/rekeningen.md), [emails](../../analysis/screens/emails.md) |
| Analysis | 4.1, 4.9, risk 4 |
| Depends on | 0.3-3, 0.2-4 (mailer) |

## Goal
Never let the sync stop silently.

## Steps
1. Consent expiry and last sync per connection and per account.
2. Start alert "Toestemming verloopt over N dagen" and the warn dot on Bankkoppelingen.
3. E-mails "Koppeling verloopt" at 14 and 3 days and "Synchronisatie gestopt", using the 0.1-5 templates. Push follows in 0.8.
4. Daily job that decides which reminders are due, without repeats.

## Done when
With the fake provider set to expire, the alert and both e-mails arrive at the right moments, once.
