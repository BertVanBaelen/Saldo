# Version 0.2 · Foundation and first bank link

**After this version you can** install Saldo from its public repository as a Home Assistant add-on, reach it on your own domain through Cloudflared, sign in with e-mail, password and an e-mail code on devices that stay trusted, and link your real Argenta accounts to see their balances and transactions.

Status: in progress (3 Nov 2026): the Go server, the React web app with a first Start, Transacties, Rekeningen and Meer on real data, the add-on and CI exist; sign-in, the security baseline and the bank link are next. Analysis milestones: spike S1, M0 and the first bank link (section 10). Roadmap: [../README.md](../README.md).

Order of 3 Nov 2026: the real bank connection is the base of the app and comes first. Because Saldo runs on the public domain from day one, sign-in, hardening and a written security baseline come before the first real link, in this version.

## Features
| Id | Feature |
|---|---|
| PLAT-1 | Verified bank API facts (spike S1) |
| PLAT-2 | Home Assistant add-on: Go server, SQLite, migrations, health, logs, CI, multi-arch images on GHCR |
| PLAT-3 | Web app (PWA) on Android and iPhone: shell, navigation, Dutch UI, light and dark |
| ACC-1 | Sign in with e-mail, password and an 8-digit e-mail code |
| ACC-2 | First-admin setup link, invite users, admin reset link, admin recovery |
| ACC-3 | Log in with Home Assistant, still followed by the e-mail code [C] |
| ACC-4 | Trusted devices with a device list, and a push and e-mail for every new device |
| SEC-0 | Security baseline and public access before the first real bank link |
| BANK-1 | Enable Banking setup per user (application id and private key) |
| BANK-2 | Link Argenta, choose accounts, re-authorise; Bankkoppelingen screen |
| PLAT-4 | Fake bank provider with the demo story, for tests and local development |

## Phases
| Phase | Title | Size | Features | Status |
|---|---|---|---|---|
| [0.2-1](01-spike-enable-banking.md) | Spike S1 · Enable Banking | S | PLAT-1 | planned (can start now) |
| [0.2-2](02-repository-addon-ci.md) | Repository, add-on and CI | M | PLAT-2 | in progress |
| [0.2-3](03-web-app-shell.md) | Web app shell | M | PLAT-3 | in progress |
| [0.2-4](04-sign-in-users-mail.md) | Sign-in, users, trusted devices and mail | L | ACC-1, ACC-2, ACC-3, ACC-4 | planned |
| [0.2-5](05-security-baseline.md) | Security baseline and public access | M | SEC-0 | planned |
| [0.2-6](06-first-bank-link.md) | First bank link and first sync | L | BANK-1, BANK-2, PLAT-4 | planned |

0.2-1 and 0.2-2 can run in parallel with the review of the mockup (0.1-8). The new-device push arrives with Web Push in 0.9-2; until then the new-device message is an e-mail only.

## Concepts
authentication, user-and-visibility, money-and-format, design-system, app-shell, demo-data, bank-connection, account, transaction, notification (e-mail only).

## Prerequisites
Go and Node.js on the development machine, with the organisation proxy set for `go` and `npm`. An Enable Banking app per user. A domain with the Cloudflared add-on. An SMTP account for `saldo@<your-domain>`.

## Exit criteria
Both of you sign in on your domain and see your own real Argenta accounts and transactions; the security baseline is written; the privacy tests pass.