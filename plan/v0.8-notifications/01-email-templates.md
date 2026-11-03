# 0.8-1 · Remaining e-mail templates

| | |
|---|---|
| Version | [0.8 Notifications](README.md) |
| Status | planned |
| Features | NOTIF-1 |
| Concepts | [notification](../../analysis/concepts/notification.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [account](../../analysis/concepts/account.md) |
| Screens | [emails](../../analysis/screens/emails.md) |
| Analysis | 4.9 |
| Depends on | 0.2-4 (mailer), 0.7-4 |

## Goal
Every e-mail from the design, sent by the server.

## Steps
1. Port the remaining templates from `finance-mockup/emails/` to Go `html/template`: planning rood, planning buffer, lid aangesloten (the others came in 0.2-4 and 0.3-4).
2. Account block with name, personal or shared, masked IBAN; subject names the account.
3. Plain-text parts; logo and icons as PNG.
4. Test in Gmail, Outlook and Apple Mail, light and dark.

## Done when
All nine e-mails render correctly in the three mail clients.
