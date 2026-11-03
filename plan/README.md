# Saldo roadmap

Saldo is built in versions. Each version adds a set of **features** that you can use when it is done; each version is split into **phases**, one file per phase. Phase ids are `<version>-<n>` (for example **0.3-2**) and are used in the knowledge base ([`../analysis/`](../analysis/README.md)) to link concepts and screens to the work.

Order follows analysis 10 and 13.6: design first, then the foundation, then bank sync, categorisation, shared accounts, overview, planning, notifications and the Bilance import, then the release gate.

## Versions at a glance

| Version | Name | After this version you can … | Analysis | Status |
|---|---|---|---|---|
| [0.1](v0.1-mockup/README.md) | Mockup | click through every screen of Saldo with demo data, on phone and desktop | 12, 13.6 | in progress |
| [0.2](v0.2-foundation/README.md) | Foundation | install Saldo as a Home Assistant add-on and sign in on your own domain | S1, S2, M0 | planned |
| [0.3](v0.3-bank-sync/README.md) | Bank sync | see your real Argenta transactions and balances, synced every night | M1 | planned |
| [0.4](v0.4-categorisation/README.md) | Categorisation | have transactions categorised by rules and fix the rest in a tap | M2 | planned |
| [0.5](v0.5-shared-accounts/README.md) | Shared accounts | share the joint account with Partner while each of you sees only your own accounts | M3 | planned |
| [0.6](v0.6-overview/README.md) | Overview | see what you earned, spent and saved per month and per category | M4 | planned |
| [0.7](v0.7-planning/README.md) | Planning | know how each coming month ends, per account group, and how much is free to spend | M5 | planned |
| [0.8](v0.8-notifications/README.md) | Notifications | get warned by push and e-mail before an account goes into its buffer or below zero | 4.9 | planned |
| [0.9](v0.9-bilance-import/README.md) | Bilance import | bring in your full Bilance history, mapped to your categories, without duplicates | M6 | planned |
| [1.0](v1.0-release/README.md) | Release | run Saldo at home on real data, reviewed, exported and backed up | 13.4 | planned |
| [2.0](v2.0-investments/README.md) | Investments | see the value of your investments and your net worth per platform | v2 | later |

Versions 0.2 to 0.9 run on the fake bank provider during development. The first real bank link on the public domain happens only after the security review in 1.0 (analysis 13.4); before that, real syncs run on a local copy.

## Features per version

Feature ids are stable; phase files list the features they deliver. **[S]** = should, **[C]** = could (analysis 4).

### 0.1 · Mockup
| Id | Feature | Phase |
|---|---|---|
| UI-1 | Design system: colours, type, components, icons, light and dark | 0.1-1 |
| UI-2 | Clickable Start, Transacties, Overzicht, Planning, Rekeningen, Meer, Meldingen | 0.1-1 … 0.1-4 |
| UI-3 | E-mail templates and push notification previews | 0.1-5 |
| UI-4 | Designs for sign-in, bank linking, account detail, categories, import, settings and the remaining states | 0.1-6 |
| UI-5 | Reviewed and frozen design | 0.1-7 |

### 0.2 · Foundation
| Id | Feature | Phase |
|---|---|---|
| PLAT-1 | Verified bank API facts and Bilance file layout (spikes) | 0.2-1, 0.2-2 |
| PLAT-2 | Home Assistant add-on: Go server, SQLite, migrations, health, logs, CI | 0.2-3 |
| ACC-1 | Sign in with e-mail, password and an 8-digit e-mail code | 0.2-4 |
| ACC-2 | First-admin setup link, invite users, admin reset link, admin recovery | 0.2-4 |
| ACC-3 | Log in with Home Assistant, still followed by the e-mail code [C] | 0.2-4 |
| PLAT-3 | Web app (PWA): shell, navigation, Dutch UI, light and dark | 0.2-5 |
| PLAT-4 | Fake bank provider with the demo story | 0.2-5 |

### 0.3 · Bank sync
| Id | Feature | Phase |
|---|---|---|
| BANK-1 | Enable Banking setup per user (application id and private key) | 0.3-1 |
| BANK-2 | Link Argenta, choose accounts, re-authorise | 0.3-2 |
| BANK-3 | Nightly sync and "Sync now", bank balances, pending transactions, no duplicates | 0.3-3 |
| BANK-4 | Consent and sync status, reminders in the app and by e-mail (14 and 3 days) | 0.3-4 |
| TX-1 | CSV import (generic, Argenta export) | 0.3-5 |
| TX-2 | Transacties: list by day, search, filters, detail | 0.3-6 |
| ACCT-1 | Rekeningen: name, colour and buffer per account; manual savings accounts and balances | 0.3-6 |

### 0.4 · Categorisation
| Id | Feature | Phase |
|---|---|---|
| CAT-1 | One shared category tree with a Dutch default set | 0.4-1 |
| CAT-2 | Rules on counterparty, communication and amount, with priorities | 0.4-2 |
| CAT-3 | Change a category, "apply to similar and create a rule", notes | 0.4-3 |
| CAT-4 | Split a transaction over categories [S] | 0.4-3 |
| CAT-5 | Categorieën en regels screen with suggestions to confirm | 0.4-4 |

### 0.5 · Shared accounts
| Id | Feature | Phase |
|---|---|---|
| SHARE-1 | Join a shared account by IBAN; manager and members with Lezen or Bewerken | 0.5-1 |
| SHARE-2 | Fallback bank sources, leave, manager hand-over, remove a link, delete a user | 0.5-1 |
| SHARE-3 | Privacy: every figure comes from your own accounts only (tested) | 0.5-2 |
| SHARE-4 | Internal transfers left out, transfers to savings shown as saved, "is / is not a transfer" [S] | 0.5-3 |
| SHARE-5 | Account groups and the scope switch Alles · Persoonlijk · Gedeeld | 0.5-4 |
| SHARE-6 | Contributions to the shared account | 0.5-5 |

### 0.6 · Overview
| Id | Feature | Phase |
|---|---|---|
| OVER-1 | Income, expenses and saved per month, quarter or year | 0.6-1, 0.6-2 |
| OVER-2 | Category breakdown with share, trend and drill-down to transactions | 0.6-1, 0.6-2 |
| OVER-3 | Start: Saldo nu, spending this month, accounts and contributions | 0.6-3 |

### 0.7 · Planning
| Id | Feature | Phase |
|---|---|---|
| PLAN-1 | Recurring items detected from history and confirmed by you | 0.7-1 |
| PLAN-2 | Budgets per category, or the average of past months | 0.7-2 |
| PLAN-3 | Plan a one-off expense or income from the calendar | 0.7-3 |
| PLAN-4 | Forecast per group: months (3 to 24) and daily balance, buffer and red states | 0.7-4 |
| PLAN-5 | Free to spend per group and month | 0.7-5 |
| PLAN-6 | Planning screen with five tabs; forecast and warnings on Start | 0.7-6 |

### 0.8 · Notifications
| Id | Feature | Phase |
|---|---|---|
| NOTIF-1 | All nine e-mails, with plain-text parts | 0.8-1 |
| NOTIF-2 | Push notifications on the installed app | 0.8-2 |
| NOTIF-3 | Warnings for red and buffer, member joined, to categorise; once per group, month and state | 0.8-3 |
| NOTIF-4 | Meldingen settings: per type and channel, look-ahead, quiet hours, test notification | 0.8-4 |
| NOTIF-5 | Lock screen without amounts, checked on a real phone | 0.8-5 |

### 0.9 · Bilance import
| Id | Feature | Phase |
|---|---|---|
| IMP-1 | Import wizard with a saved Bilance preset | 0.9-1 |
| IMP-2 | Category mapping: map, create, merge or leave, saved per source | 0.9-2 |
| IMP-3 | Import cutoff and probable duplicates | 0.9-3 |
| IMP-4 | Import batches with undo | 0.9-4 |
| IMP-5 | Learned category suggestions and backfill | 0.9-5 |

### 1.0 · Release
| Id | Feature | Phase |
|---|---|---|
| DATA-1 | Export your data to CSV and JSON [S] | 1.0-1 |
| SEC-1 | Security review before the first real bank link | 1.0-2 |
| REL-1 | First real sync, backup and migration routine | 1.0-3 |
| REL-2 | Add-on release 1.0 with documentation | 1.0-4 |

### 2.0 · Investments
| Id | Feature | Phase |
|---|---|---|
| INV-1 | Investment accounts with manual or imported values | 2.0-1 |
| INV-2 | Net worth per platform | 2.0-2 |
| INV-3 | Price lookups by ISIN [C] | 2.0-3 |

## Concepts per version

| Concept | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1.0 | 2.0 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [design-system](../analysis/concepts/design-system.md) | ● | ● | | | | | | | | | |
| [app-shell](../analysis/concepts/app-shell.md) | ● | ● | | | | | | | | | |
| [money-and-format](../analysis/concepts/money-and-format.md) | ● | ● | | | | | | | | | |
| [demo-data](../analysis/concepts/demo-data.md) | ● | ● | | | | | | | | | |
| [user-and-visibility](../analysis/concepts/user-and-visibility.md) | ● | ● | | | ● | | | | | ● | |
| [authentication](../analysis/concepts/authentication.md) | ● | ● | | | | | | | | ● | |
| [account](../analysis/concepts/account.md) | ● | | ● | | ● | | | | | ● | ● |
| [account-group](../analysis/concepts/account-group.md) | ● | | | | ● | ● | ● | | | | |
| [shared-account](../analysis/concepts/shared-account.md) | ● | | ● | | ● | ● | | | | | |
| [bank-connection](../analysis/concepts/bank-connection.md) | ● | ● | ● | | ● | | | ● | | ● | |
| [transaction](../analysis/concepts/transaction.md) | ● | | ● | ● | | | | | ● | | |
| [category](../analysis/concepts/category.md) | ● | | | ● | | ● | | | ● | | |
| [categorisation-rule](../analysis/concepts/categorisation-rule.md) | ● | | | ● | | | | ● | ● | | |
| [internal-transfer](../analysis/concepts/internal-transfer.md) | ● | | | | ● | ● | ● | | | | |
| [period-overview](../analysis/concepts/period-overview.md) | ● | | | | | ● | | | | | |
| [recurring-item](../analysis/concepts/recurring-item.md) | ● | | | | | | ● | | | | |
| [planned-item](../analysis/concepts/planned-item.md) | ● | | | | | | ● | | | | |
| [budget](../analysis/concepts/budget.md) | ● | | | | | | ● | | | | |
| [forecast](../analysis/concepts/forecast.md) | ● | | | | | | ● | ● | | | |
| [buffer-and-states](../analysis/concepts/buffer-and-states.md) | ● | | ● | | | | ● | ● | | | |
| [import](../analysis/concepts/import.md) | ● | ● | ● | | | | | | ● | | |
| [notification](../analysis/concepts/notification.md) | ● | ● | ● | | ● | | | ● | | | |

## Toolchain note
The development machine has no Node.js and no Go (checked 3 Nov 2026). Version 0.1 is plain HTML, CSS and JavaScript without a build step. Version 0.2 needs Go and Node installed, with the organisation proxy set for `go` and `npm` (analysis 13.5).
