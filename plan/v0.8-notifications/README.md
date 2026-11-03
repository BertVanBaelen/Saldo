# Version 0.8 · Notifications

**After this version you can** install Saldo on your phone and get a push notification or e-mail when an account group is heading into its buffer or below zero, when a bank link expires or a sync stops, when someone joins your shared account, and when transactions wait to be categorised. You choose per type and channel, with quiet hours.

Status: planned. Analysis section: 4.9. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| NOTIF-1 | All nine e-mails, with plain-text parts |
| NOTIF-2 | Push notifications on the installed app |
| NOTIF-3 | Warnings for red and buffer, member joined, to categorise; once per group, month and state |
| NOTIF-4 | Meldingen settings: per type and channel, look-ahead, quiet hours, test notification |
| NOTIF-5 | Lock screen without amounts, checked on a real phone |

## Phases
| Phase | Title | Features | Status |
|---|---|---|---|
| [0.8-1](01-email-templates.md) | Remaining e-mail templates | NOTIF-1 | planned |
| [0.8-2](02-web-push.md) | Web Push | NOTIF-2 | planned |
| [0.8-3](03-triggers-and-scheduler.md) | Triggers, preferences and scheduler | NOTIF-3 | planned |
| [0.8-4](04-meldingen-screen.md) | Meldingen screen | NOTIF-4 | planned |
| [0.8-5](05-lock-screen-check.md) | Lock screen check | NOTIF-5 | planned |

## Concepts
notification, buffer-and-states, forecast, bank-connection, shared-account, categorisation-rule.

## Exit criteria
A forecast that turns red sends one push and one e-mail the next morning, and nothing again until the state changes.
