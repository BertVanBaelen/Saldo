# Version 0.2 · Foundation

**After this version you can** install Saldo as a Home Assistant add-on, reach it on your own domain through Cloudflared, and sign in with e-mail, password and an e-mail code. The app shows the screens with demo data from the fake bank.

Status: planned. Analysis milestones: spikes S1 and S2, M0. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| PLAT-1 | Verified bank API facts and Bilance file layout (spikes) |
| PLAT-2 | Home Assistant add-on: Go server, SQLite, migrations, health, logs, CI |
| ACC-1 | Sign in with e-mail, password and an 8-digit e-mail code |
| ACC-2 | First-admin setup link, invite users, admin reset link, admin recovery |
| ACC-3 | Log in with Home Assistant, still followed by the e-mail code [C] |
| PLAT-3 | Web app (PWA): shell, navigation, Dutch UI, light and dark |
| PLAT-4 | Fake bank provider with the demo story |

## Phases
| Phase | Title | Features | Status |
|---|---|---|---|
| [0.2-1](01-spike-enable-banking.md) | Spike S1 · Enable Banking | PLAT-1 | planned |
| [0.2-2](02-spike-bilance-csv.md) | Spike S2 · Bilance CSV | PLAT-1 | planned |
| [0.2-3](03-repository-and-addon.md) | Repository and add-on skeleton | PLAT-2 | planned |
| [0.2-4](04-sign-in-users-mail.md) | Sign-in, users and mail | ACC-1, ACC-2, ACC-3 | planned |
| [0.2-5](05-web-app-and-fake-bank.md) | Web app and fake bank | PLAT-3, PLAT-4 | planned |

The spikes (0.2-1, 0.2-2) can run in parallel with version 0.1.

## Concepts
authentication, user-and-visibility, money-and-format, design-system, app-shell, demo-data, bank-connection, import, notification (e-mail only).

## Prerequisites
Go and Node.js installed on the development machine, with the organisation proxy set for `go` and `npm`.

## Exit criteria
Sign in on your domain as the first admin, invite Partner, and both of you see the demo Start screen.
