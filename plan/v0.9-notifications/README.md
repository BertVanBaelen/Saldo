# Version 0.9 · Notifications

**After this version you can** get a push notification on your Android phone or iPhone, or an e-mail, when an account is heading into its buffer or below zero, when a bank link expires or a sync stops, when someone joins your shared account, when a new device signs in, and when transactions wait to be categorised. You choose per type and channel, with quiet hours.

Status: planned. Analysis section: 4.9. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| NOTIF-1 | All ten e-mails, with plain-text parts, tested in three mail clients |
| NOTIF-2 | Push notifications on the installed app, on Android and iPhone |
| NOTIF-3 | Warnings for red and buffer per account, member joined, new device, to categorise; once per account, month and state |
| NOTIF-4 | Meldingen settings: per type and channel, look-ahead, quiet hours, test notification |
| NOTIF-5 | Lock screen without amounts, checked on both phones |

## Phases
| Phase | Title | Size | Features | Status |
|---|---|---|---|---|
| [0.9-1](01-email-templates.md) | Remaining e-mail templates | M | NOTIF-1 | planned |
| [0.9-2](02-web-push.md) | Web Push on Android and iPhone | M | NOTIF-2 | planned |
| [0.9-3](03-triggers-and-scheduler.md) | Triggers, preferences and scheduler | M | NOTIF-3 | planned |
| [0.9-4](04-meldingen-screen.md) | Meldingen screen | S | NOTIF-4 | planned |
| [0.9-5](05-lock-screen-check.md) | Lock screen check on both phones | S | NOTIF-5 | planned |

## Concepts
notification, buffer-and-states, forecast, bank-connection, shared-account, categorisation-rule, authentication (new device).

## Exit criteria
A forecast that turns red sends one push and one e-mail the next morning, and nothing again until the state changes, on both phones.