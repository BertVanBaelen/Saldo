# Saldo roadmap

Saldo is built in versions. Each version adds a set of **features** that you can use when it is done; each version is split into **phases**, one file per phase. Phase ids are `<version>-<n>` (for example **0.3-2**) and are used in the knowledge base ([`../analysis/`](../analysis/README.md)) to link concepts and screens to the work. Every phase has a **size**: S, M or L (below); there are no dates (decision of 3 Nov 2026).

## Order
Set on 3 Nov 2026 (analysis 10 and 11):
1. **Design first** (0.1): the mockup is frozen as the design reference (3 Nov 2026). No more screens in plain HTML/JS: everything else is built in the React app against the Go server.
2. **The real bank connection first** (0.2): it is the base of the app. Saldo runs on the public domain from day one, so sign-in with trusted devices, hardening and a written security baseline come before the first real link, in the same version.
3. **Daily bank sync** (0.3), then **categorisation** (0.4).
4. **The Bilance import before planning** (0.5): the bank API gives about 90 days of history, the forecast needs 12+ months for quarterly and yearly items.
5. **Shared accounts** (0.6), **overview** (0.7), **planning** (0.8), **notifications** (0.9).
6. **Release gate** (1.0): export, full security review, backup and restore, documentation. Then investments (2.0).

```mermaid
flowchart LR
  v01[0.1 Mockup] --> v02[0.2 Foundation and first bank link]
  v02 --> v03[0.3 Bank sync] --> v04[0.4 Categorisation] --> v05[0.5 Bilance import]
  v05 --> v06[0.6 Shared accounts] --> v07[0.7 Overview] --> v08[0.8 Planning] --> v09[0.9 Notifications] --> v10[1.0 Release] --> v20[2.0 Investments]
```

## Versions at a glance

| Version | Name | After this version you can … | Analysis | Size | Status |
|---|---|---|---|---|---|
| [0.1](v0.1-mockup/README.md) | Mockup | click through the screens with demo data: the frozen design reference | 12, 13.6 | done | done |
| [0.2](v0.2-foundation/README.md) | Foundation and first bank link | install the add-on, sign in on your domain on trusted devices, and see your real Argenta accounts and transactions | S1, M0, 6, 7 | 1 S · 3 M · 2 L | built, to verify |
| [0.3](v0.3-bank-sync/README.md) | Bank sync | rely on a nightly sync without duplicates, consent reminders, Transacties, Rekeningen, manual accounts and a CSV import | M1 | 1 S · 4 M · 1 L | released (0.3.0), verifying |
| [0.4](v0.4-categorisation/README.md) | Categorisation | have rules categorise transactions and fix the rest in a tap | M2 | 1 S · 3 M | planned |
| [0.5](v0.5-bilance-import/README.md) | Bilance import | bring in your full Bilance history, mapped to your categories, without duplicates | S2, M6 | 2 S · 4 M | planned |
| [0.6](v0.6-shared-accounts/README.md) | Shared accounts | share the joint account with Partner, each seeing only your own accounts | M3 | 2 S · 2 M · 1 L | planned |
| [0.7](v0.7-overview/README.md) | Overview | see income, spending and savings per period, per account and category | M4 | 1 S · 2 M | planned |
| [0.8](v0.8-planning/README.md) | Planning | know how each coming month ends for each account, and how much is free to spend | M5 | 1 S · 2 M · 3 L | planned |
| [0.9](v0.9-notifications/README.md) | Notifications | get push (Android and iPhone) and e-mail warnings before an account goes into its buffer or below zero | 4.9 | 2 S · 3 M | planned |
| [1.0](v1.0-release/README.md) | Release | run Saldo with a full security review, tested backups and an export | 13.4 | 3 S · 1 M | planned |
| [2.0](v2.0-investments/README.md) | Investments | see net worth per platform | v2 | 1 S · 2 M | later |

**Sizes** are relative effort, not dates: **S** = a few days of focused work, **M** = about a week, **L** = about two weeks or more. They help to pick the next phase and to see which versions are heavy (0.2 and 0.8).

**Real data:** from 0.2-6 on, Saldo holds your real bank data on the live add-on. The fake bank provider serves the demo story for tests and local development only; CI never calls a real bank. Nothing real is ever committed: the repository is public.

## Next up
Written 10 Nov 2026, after 0.3.0 was released. The order is the one set on 3 Nov; this section says what to do now, which phases come next and what each needs, and what 0.3 left behind. No dates, as before.

### Now: verify 0.3 while 0.4 starts
| # | Check | Holds up |
|---|---|---|
| 1 | Two weeks of nightly syncs without duplicates on the live add-on | closing 0.3 |
| 2 | A real consent expiry, with the reminders at 14 and 3 days. It only happens when the first real consent runs out, so it can take months. **Proposal:** close 0.3 on check 1 and keep this as a standing check that holds nothing up. | nothing (proposal) |
| 3 | The first import from a real Argenta export, and the Referentie comparison ([0.3-6, to verify with real data](v0.3-bank-sync/06-csv-import.md#to-verify-with-real-data)) | the 0.5 import phases |
| 4 | Click through Start, Transacties, Rekeningen and Importeren on both phones: the account page and the import wizard were only checked by tests and a demo API | closing 0.3 |
| 5 | A Home Assistant backup before installing 0.3.0 (migrations 0003 and 0004; 0003 merges older duplicate balances of the same day) | installing |

Done: CI passed on main for 0.3.0 (including `go test -race` and `govulncheck`, which the development machine cannot run: no `gcc`), and the release workflow published the image and the tag `v0.3.0`.

### The next phases
Sizes are in the version READMEs. "Needs" lists the phases that must be done first; anything not listed can start now.

**0.4 · Categorisation** (CAT-1 to CAT-5): [version README](v0.4-categorisation/README.md)
| Phase | Title | Size | Needs |
|---|---|---|---|
| [0.4-1](v0.4-categorisation/01-category-tree.md) | Category tree | S | 0.3-3 (done): start here |
| [0.4-2](v0.4-categorisation/02-rules-engine.md) | Rules engine | M | 0.4-1 |
| [0.4-3](v0.4-categorisation/03-categorise-in-transacties.md) | Categorise in Transacties (change, "apply to similar", notes, split) | M | 0.4-2 |
| [0.4-4](v0.4-categorisation/04-categories-and-rules-screen.md) | Categorieën en regels screen | M | 0.4-3 |

**0.5 · Bilance import** (PLAT-1, IMP-1 to IMP-5): [version README](v0.5-bilance-import/README.md)
| Phase | Title | Size | Needs |
|---|---|---|---|
| [0.5-1](v0.5-bilance-import/01-spike-bilance-csv.md) | Spike S2 · Bilance CSV | S | nothing: do it now, in parallel with 0.4 (it needs the header and a few anonymised rows of your real Bilance export) |
| [0.5-2](v0.5-bilance-import/02-import-wizard.md) | Import wizard and Bilance preset | M | 0.3-6 (done), 0.5-1 |
| [0.5-3](v0.5-bilance-import/03-category-mapping.md) | Category mapping | M | 0.5-2, 0.4-1 |
| [0.5-4](v0.5-bilance-import/04-overlap-and-duplicates.md) | Overlap and duplicates | M | 0.5-2 |
| [0.5-5](v0.5-bilance-import/05-batches-and-undo.md) | Batches and undo | S | 0.5-4 |
| [0.5-6](v0.5-bilance-import/06-learning-and-backfill.md) | Learning and backfill | M | 0.5-3, 0.4-4 |

**0.6 · Shared accounts** (SHARE-1 to SHARE-6): [version README](v0.6-shared-accounts/README.md)
| Phase | Title | Size | Needs |
|---|---|---|---|
| [0.6-1](v0.6-shared-accounts/01-membership-and-lifecycle.md) | Membership and lifecycle | L | 0.3-1, 0.3-4 (done) |
| [0.6-2](v0.6-shared-accounts/02-privacy.md) | Privacy suite for every endpoint | M | 0.6-1 |
| [0.6-3](v0.6-shared-accounts/03-transfers-and-saved.md) | Transfer detection and saved | M | 0.6-2 |
| [0.6-4](v0.6-shared-accounts/04-scope-and-sums.md) | Scope filter and sums | S | 0.6-3 |
| [0.6-5](v0.6-shared-accounts/05-contributions.md) | Contributions | S | 0.6-4 |

The phases of 0.6 depend on 0.3 only, and nothing in 0.4 or 0.5 depends on 0.6. So the order is a choice, not a technical limit: if Partner should be using Saldo sooner, 0.6 can go before 0.4 and 0.5 without breaking anything. After that: **0.7 Overview** (3 phases), **0.8 Planning** (6 phases, the heaviest with 3 L, and it needs the 12+ months of history from 0.5), **0.9 Notifications** (5 phases), **1.0 Release** (4 phases); see the table above.

### Carried over from 0.3
Each item is also written in the phase file that will do it, under "Carried over from 0.3".

| Item | Goes to |
|---|---|
| Fuzzy duplicates (booking date ±1 day, similar counterparty); 0.3 only skips exact matches | [0.5-4](v0.5-bilance-import/04-overlap-and-duplicates.md) |
| **Conflict:** 0.5-4 suggests an import cutoff at the first synced date, which would block importing the rows after a failed sync, the very fallback 0.3-6 was built for. Offer the cutoff only for Bilance files, never for the generic CSV. | [0.5-4](v0.5-bilance-import/04-overlap-and-duplicates.md) |
| Manual override of delimiter, encoding, date format and decimal separator (shown in the mockup, cut from 0.3-6) | [0.5-2](v0.5-bilance-import/02-import-wizard.md) |
| `import_batches` and the history list already exist, and a re-import already adds nothing: 0.5-5 shrinks to undo. Deleting a batch also deletes the categories set on its rows, so say so in the confirmation. | [0.5-5](v0.5-bilance-import/05-batches-and-undo.md) |
| A `Referentie` mapping field (only if the real check shows it equals the sync's `external_id`) and `Beschrijving` as a fallback for an empty `Mededeling` | [0.5-2](v0.5-bilance-import/02-import-wizard.md), after check 3 |
| The "Overschrijvingen naar deze rekening" card on a manual account | [0.6-3](v0.6-shared-accounts/03-transfers-and-saved.md) |
| The Start hero and the forecast block link to Planning | [0.8-6](v0.8-planning/06-planning-screen.md) |

Small items, to do when the area is touched: `ValidIBAN` does not check the length per country; the empty-body message of `PATCH /api/accounts/{id}` does not mention the IBAN; `Munt` written as "€" is refused (accept it only if a real export shows it); the sync toast reads "Gesynchroniseerd" because the server sends no count of new transactions; a booked CSV row and its pending sync twin both count in the Transacties total until the next sync clears the pending one; the web app has no lint step; `plan/v0.1-mockup/07-missing-designs.md` still lists Importeren as never opened in a browser.

### Proposed working agreement
- **Real data first.** The first 0.3-6 preset was a guess and was wrong (the real Argenta header has `Boekdatum`, a `Referentie` and a `Munt` column), and the delimiter and the row formats are still unverified. Spike S2 comes before the Bilance wizard for the same reason, and every version README would get a "To verify with real data" list like 0.3-6 has.

## Release policy
- From 0.2 on, every version ends with a tagged add-on release `0.N.0`: CI builds the multi-arch images (amd64, aarch64), pushes them to `ghcr.io`, and Home Assistant offers the update from the repository URL. Fixes in between are `0.N.x`.
- The release is triggered by the `version` in `saldo/config.yaml` on main: once CI passes there, the release workflow publishes the image, tags `v<version>` and takes the notes from `saldo/CHANGELOG.md`. Merging work without releasing needs a `-dev` suffix on the version (0.3.0 was released before its exit criteria were met).
- A database backup is taken before every update that migrates the schema (Home Assistant backup, encrypted).
- Version 0.1 (the mockup) is not an add-on; it is served by `finance-mockup/serve.ps1`.
- 1.0.0 follows the full security review (1.0-2) and the restore test (1.0-3).

## Features per version
Feature ids are stable; phase files list the features they deliver. **[S]** = should, **[C]** = could (analysis 4).

### 0.1 · Mockup
| Id | Feature | Phase |
|---|---|---|
| UI-1 | Design system: colours, type, components, icons, light and dark | 0.1-1 |
| UI-2 | Clickable Start, Transacties, Overzicht, Planning, Rekeningen, Meer, Meldingen | 0.1-1 … 0.1-4 |
| UI-3 | E-mail templates and push notification previews | 0.1-5 |
| UI-6 | The decisions of 3 Nov 2026 in the mockup: independent accounts, sums as information, demo states | 0.1-6 |
| UI-4 | Designs for sign-in, bank linking, account detail, categories, import, settings and the remaining states (partly; the rest in the React app) | 0.1-7 |
| UI-5 | Frozen mockup as the design reference | 0.1-8 |

### 0.2 · Foundation and first bank link
| Id | Feature | Phase |
|---|---|---|
| PLAT-1 | Verified bank API facts (spike S1) | 0.2-1 |
| PLAT-2 | Home Assistant add-on: Go server, SQLite, migrations, health, logs, CI, images on GHCR | 0.2-2 |
| PLAT-3 | Web app (PWA) on Android and iPhone: shell, navigation, Dutch UI, light and dark | 0.2-3 |
| ACC-1 | Sign in with e-mail, password and an 8-digit e-mail code | 0.2-4 |
| ACC-2 | First-admin setup link, invite users, admin reset link, admin recovery | 0.2-4 |
| ACC-3 | Log in with Home Assistant, still followed by the e-mail code [C] | 0.2-4 |
| ACC-4 | Trusted devices with a device list, and a new-device e-mail (push from 0.9-2) | 0.2-4 |
| SEC-0 | Security baseline and public access before the first real bank link | 0.2-5 |
| BANK-1 | Enable Banking setup per user (application id and private key) | 0.2-6 |
| BANK-2 | Link Argenta, choose accounts, re-authorise; Bankkoppelingen screen | 0.2-6 |
| PLAT-4 | Fake bank provider with the demo story, for tests and local development | 0.2-6 |

### 0.3 · Bank sync
| Id | Feature | Phase |
|---|---|---|
| BANK-3 | Nightly sync and "Sync now", bank balances, pending transactions, no duplicates | 0.3-1 |
| BANK-4 | Consent and sync status, reminders in the app and by e-mail (14 and 3 days) | 0.3-2 |
| TX-2 | Transacties: list by day, search, filters, detail | 0.3-3 |
| ACCT-1 | Rekeningen and account detail: name, colour and buffer per account; manual accounts and balances | 0.3-4 |
| ACCT-2 | Start: balance now per account, accounts, sync and bank alerts | 0.3-5 |
| TX-1 | CSV import (generic, Argenta export) | 0.3-6 |

### 0.4 · Categorisation
| Id | Feature | Phase |
|---|---|---|
| CAT-1 | One shared category tree with a Dutch default set | 0.4-1 |
| CAT-2 | Rules on counterparty, communication and amount, with priorities | 0.4-2 |
| CAT-3 | Change a category, "apply to similar and create a rule", notes | 0.4-3 |
| CAT-4 | Split a transaction over categories [S] | 0.4-3 |
| CAT-5 | Categorieën en regels screen with suggestions to confirm | 0.4-4 |

### 0.5 · Bilance import
| Id | Feature | Phase |
|---|---|---|
| PLAT-1 | Verified Bilance file layout (spike S2) | 0.5-1 |
| IMP-1 | Import wizard with a saved Bilance preset | 0.5-2 |
| IMP-2 | Category mapping: map, create, merge or leave, saved per source | 0.5-3 |
| IMP-3 | Import cutoff and probable duplicates | 0.5-4 |
| IMP-4 | Import batches with undo | 0.5-5 |
| IMP-5 | Learned category suggestions and backfill | 0.5-6 |

### 0.6 · Shared accounts
| Id | Feature | Phase |
|---|---|---|
| SHARE-1 | Join a shared account by IBAN; manager and members with Lezen or Bewerken | 0.6-1 |
| SHARE-2 | Fallback bank sources, leave, manager hand-over, remove a link, delete a user | 0.6-1 |
| SHARE-3 | Privacy: every figure comes from your own accounts only (tested on every endpoint) | 0.6-2 |
| SHARE-4 | Internal transfers left out, transfers to savings shown as saved, "is / is not a transfer" [S] | 0.6-3 |
| SHARE-5 | Scope switch Alles · Persoonlijk · Gedeeld as a filter, sums as information only | 0.6-4 |
| SHARE-6 | Contributions to the shared account | 0.6-5 |

### 0.7 · Overview
| Id | Feature | Phase |
|---|---|---|
| OVER-1 | Income, expenses and saved per month, quarter, year or custom range, per account and as a sum | 0.7-1, 0.7-2 |
| OVER-2 | Category breakdown with share, trend and drill-down to transactions | 0.7-1, 0.7-2 |
| OVER-3 | Start: spending this month and contributions | 0.7-3 |

### 0.8 · Planning
| Id | Feature | Phase |
|---|---|---|
| PLAN-1 | Recurring items detected from history and confirmed by you, or added by hand | 0.8-1 |
| PLAN-2 | Budgets per account and category, or the average of past months | 0.8-2 |
| PLAN-3 | Plan a one-off expense or income from the calendar | 0.8-3 |
| PLAN-4 | Forecast per account: months (3 to 24) and daily balance, buffer and red states | 0.8-4 |
| PLAN-5 | Free to spend per account and month | 0.8-5 |
| PLAN-6 | Planning screen with five tabs; forecast and warnings on Start | 0.8-6 |

### 0.9 · Notifications
| Id | Feature | Phase |
|---|---|---|
| NOTIF-1 | All ten e-mails, with plain-text parts, tested in three mail clients | 0.9-1 |
| NOTIF-2 | Push notifications on the installed app, on Android and iPhone | 0.9-2 |
| NOTIF-3 | Warnings for red and buffer per account, member joined, new device, to categorise; once per account, month and state | 0.9-3 |
| NOTIF-4 | Meldingen settings: per type and channel, look-ahead, quiet hours, test notification | 0.9-4 |
| NOTIF-5 | Lock screen without amounts, checked on both phones | 0.9-5 |

### 1.0 · Release
| Id | Feature | Phase |
|---|---|---|
| DATA-1 | Export your data to CSV and JSON [S] | 1.0-1 |
| SEC-1 | Full security review | 1.0-2 |
| REL-1 | Backup, restore and migration routine | 1.0-3 |
| REL-2 | Add-on release 1.0.0 with documentation | 1.0-4 |

### 2.0 · Investments
| Id | Feature | Phase |
|---|---|---|
| INV-1 | Investment accounts with manual or imported values | 2.0-1 |
| INV-2 | Net worth per platform | 2.0-2 |
| INV-3 | Price lookups by ISIN [C] | 2.0-3 |

## Concepts per version
Generated from the "Concepts" row of every phase file.

<!-- concept-matrix -->
| Concept | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1.0 | 2.0 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [account](../analysis/concepts/account.md) | ● | ● | ● |  |  | ● |  |  | ● | ● | ● |
| [app-shell](../analysis/concepts/app-shell.md) | ● | ● |  |  |  |  |  |  |  |  |  |
| [authentication](../analysis/concepts/authentication.md) | ● | ● |  |  |  |  |  |  |  | ● |  |
| [bank-connection](../analysis/concepts/bank-connection.md) | ● | ● | ● |  |  | ● |  |  | ● | ● |  |
| [budget](../analysis/concepts/budget.md) | ● |  |  |  |  |  |  | ● |  |  |  |
| [buffer-and-states](../analysis/concepts/buffer-and-states.md) | ● |  | ● |  |  | ● |  | ● | ● |  |  |
| [categorisation-rule](../analysis/concepts/categorisation-rule.md) | ● |  |  | ● | ● | ● |  |  | ● |  |  |
| [category](../analysis/concepts/category.md) | ● |  |  | ● | ● |  | ● |  |  |  |  |
| [demo-data](../analysis/concepts/demo-data.md) | ● | ● |  |  |  |  |  |  |  |  |  |
| [design-system](../analysis/concepts/design-system.md) | ● | ● |  |  |  |  |  |  | ● |  |  |
| [forecast](../analysis/concepts/forecast.md) | ● |  |  |  |  |  |  | ● | ● |  |  |
| [import](../analysis/concepts/import.md) | ● |  | ● |  | ● |  |  |  |  |  |  |
| [internal-transfer](../analysis/concepts/internal-transfer.md) | ● |  |  |  |  | ● | ● | ● |  |  |  |
| [money-and-format](../analysis/concepts/money-and-format.md) | ● | ● |  |  |  |  |  |  |  |  |  |
| [notification](../analysis/concepts/notification.md) | ● | ● | ● |  |  |  |  |  | ● |  |  |
| [period-overview](../analysis/concepts/period-overview.md) | ● |  |  |  |  |  | ● |  |  |  |  |
| [planned-item](../analysis/concepts/planned-item.md) | ● |  |  |  |  |  |  | ● |  |  |  |
| [recurring-item](../analysis/concepts/recurring-item.md) | ● |  |  |  |  |  |  | ● |  |  |  |
| [scope](../analysis/concepts/scope.md) | ● |  | ● |  |  | ● | ● | ● |  |  | ● |
| [shared-account](../analysis/concepts/shared-account.md) | ● | ● |  |  |  | ● | ● | ● | ● |  |  |
| [transaction](../analysis/concepts/transaction.md) | ● | ● | ● | ● | ● | ● |  |  |  |  |  |
| [user-and-visibility](../analysis/concepts/user-and-visibility.md) | ● | ● |  |  |  | ● |  |  |  | ● |  |
<!-- /concept-matrix -->

## Toolchain note
The development machine has no Node.js, Go or Python (checked 3 Nov 2026). Version 0.1 is plain HTML, CSS and JavaScript without a build step. Version 0.2 needs Go and Node installed, with the organisation proxy set for `go` and `npm` (analysis 13.5). Real bank data never lives on the development machine.