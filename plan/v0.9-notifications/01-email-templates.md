# 0.9-1 · Remaining e-mail templates

| | |
|---|---|
| Version | [0.9 Notifications](README.md) |
| Status | planned |
| Size | M |
| Features | NOTIF-1 |
| Concepts | [notification](../../analysis/concepts/notification.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [account](../../analysis/concepts/account.md) |
| Screens | [emails](../../analysis/screens/emails.md) |
| Analysis | 4.9 |
| Depends on | [0.2-4](../v0.2-foundation/04-sign-in-users-mail.md) (mailer), [0.8-4](../v0.8-planning/04-forecast-engine.md) |

## Goal
Every e-mail from the design, sent by the server.

## Steps
1. Port the remaining templates from `finance-mockup/emails/` to Go `html/template`: planning rood, planning buffer, lid aangesloten (the others came in 0.2-4 and 0.3-2).
2. Account block with name, personal or shared, masked IBAN; subject names the account.
3. Plain-text parts; logo and icons as PNG.
4. Test all ten e-mails in Gmail, Outlook and Apple Mail (iPhone), light and dark.

## Done when
All ten e-mails render correctly in the three mail clients.