# Saldo · overview

Saldo is a self-hosted replacement for Bilance that runs as a Home Assistant add-on. It answers one question: *will I have enough money at the end of each coming month, and how much is left or short?* Two users (Bert and Partner), each seeing only their own accounts, with a shared account they both hold. Every account stands on its own: its own buffer, forecast and warnings; "Alles" shows them side by side, with sums as information only.

Status on 9 Nov 2026: **version 0.2 is released and the first real bank link works; version 0.3 is built and released as 0.3.0, and waits for verification on the live add-on** (nightly sync, consent reminders, Transacties, Rekeningen with manual accounts, Start with balances, and a CSV import). The mockup is frozen as the design reference. The real app: a **Go server** (SQLite, sign-in with e-mail code and trusted devices, invitations, mail, sealed bank credentials, the Enable Banking client and the first sync, privacy tests) and a **React web app** (Vite, TypeScript, PWA) with sign-in, Start, Transacties, Rekeningen, Bankkoppelingen, Instellingen and Meer, packaged as a Home Assistant add-on with CI. Still to do before 0.2.0: spike S1 on the real Argenta account (the bank client is built from the public docs and only tested against a fake server), the checklist in [`saldo/DOCS.md`](saldo/DOCS.md) on the real domain, and the install on Home Assistant. Repository: [github.com/BertVanBaelen/Saldo](https://github.com/BertVanBaelen/Saldo) (public).

## Where everything is

| Folder / file | What it holds | Start here |
|---|---|---|
| [`analysis.md`](analysis.md) | The analysis document v1.2: requirements, calculation rules, decisions, risks | sections 1, 4, 5, 11 |
| [`analysis/`](analysis/README.md) | Knowledge base: 22 concept files and 14 screen files, cross-linked to the analysis, the design and the phases | [analysis/README.md](analysis/README.md) |
| [`plan/`](plan/README.md) | Roadmap: 11 versions, 60 features, one file per phase (56), each with a size S, M or L | [plan/README.md](plan/README.md) |
| [`finance-mockup/`](finance-mockup/README.md) | Clickable mockup of every screen and state, plain HTML/CSS/JS, demo data | [finance-mockup/README.md](finance-mockup/README.md) |
| [`design/`](design/README.md) | Read-only copy of the design canvas *Saldo – ontwerp* | [design/README.md](design/README.md) |
| [`server/`](server/README.md) | The Go server: API, SQLite, bank providers, demo data, tests | [docs/architecture.md](docs/architecture.md) |
| [`web/`](web/README.md) | The React web app (PWA) | [docs/api.md](docs/api.md) |
| [`saldo/`](saldo/DOCS.md), `Dockerfile`, `repository.yaml` | The Home Assistant add-on and its image | [saldo/DOCS.md](saldo/DOCS.md) |
| `.github/workflows/` | CI (Go, web, secret scan, image) and release to `ghcr.io` | – |
| `scripts/dev.ps1`, [`fixtures/csv/`](fixtures/csv/README.md) | Runs the server (demo mode) and the web app together (`-Fresh` to reset, `-Stop` to stop); invented CSV files for the import wizard | [docs/local-testing.md](docs/local-testing.md) |
| `.claude/launch.json` | Starts the mockup server for a preview pane | – |

How they connect:

```
analysis.md ──► analysis/concepts/*.md ◄──► plan/<version>/<phase>.md
   (what)          (one idea, once)              (when, which feature)
                          ▲
design/*.dc.html ──► analysis/screens/*.md ──► finance-mockup/<screen>.html
   (how it looks)       (spec per screen)          (clickable)
```

Every concept and screen file starts with a header line: analysis sections, data tables, screens, and **Phases:** with links to the phase files. Every phase file lists its size, features, concepts, screens, analysis sections and dependencies. The phase files are the source of truth for those links.

## Roadmap

| Version | After this version you can … | Size | Status |
|---|---|---|---|
| [0.1 Mockup](plan/v0.1-mockup/README.md) | click through every screen and state with demo data, and agree on the design | 7 done · 1 stopped | done |
| [0.2 Foundation and first bank link](plan/v0.2-foundation/README.md) | sign in on your domain on trusted devices and see your real Argenta accounts and transactions | 1 S · 3 M · 2 L | built, to verify |
| [0.3 Bank sync](plan/v0.3-bank-sync/README.md) | rely on a nightly sync, consent reminders, Transacties, Rekeningen and manual accounts | 1 S · 4 M · 1 L | in progress |
| [0.4 Categorisation](plan/v0.4-categorisation/README.md) | have rules categorise transactions, fix the rest in a tap | 1 S · 3 M | planned |
| [0.5 Bilance import](plan/v0.5-bilance-import/README.md) | bring in your full Bilance history without duplicates | 2 S · 4 M | planned |
| [0.6 Shared accounts](plan/v0.6-shared-accounts/README.md) | share the joint account, each seeing only your own accounts | 2 S · 2 M · 1 L | planned |
| [0.7 Overview](plan/v0.7-overview/README.md) | see income, spending and savings per period, account and category | 1 S · 2 M | planned |
| [0.8 Planning](plan/v0.8-planning/README.md) | know how each coming month ends for each account | 1 S · 2 M · 3 L | planned |
| [0.9 Notifications](plan/v0.9-notifications/README.md) | get push (Android and iPhone) and e-mail warnings before the buffer or zero | 2 S · 3 M | planned |
| [1.0 Release](plan/v1.0-release/README.md) | run it with a full security review, tested backups and an export | 3 S · 1 M | planned |
| [2.0 Investments](plan/v2.0-investments/README.md) | see net worth per platform | 1 S · 2 M | later |

S = a few days of focused work, M = about a week, L = two weeks or more. The order, the release policy and every feature are in [plan/README.md](plan/README.md).

## The app

```powershell
pwsh -File scripts/dev.ps1
```
Starts the Go server in demo mode on http://localhost:8080 and the web app with hot reload on http://localhost:5180. Demo mode seeds the demo story and acts as Bert until sign-in exists (0.2-4); without it the API answers 401. Go and Node are in `D:\Data\BV10538\tools` on this machine (on the user PATH). Tests: `cd server; go test ./...` and `cd web; npm test`. See [docs/architecture.md](docs/architecture.md).

## The mockup

```bash
pwsh -NoProfile -File finance-mockup/serve.ps1
```
Open http://localhost:5173/. Phone layout below 1024 px, desktop from 1024 px; light and dark (Meer → Weergave). Demo states (no accounts yet, stale sync, failed sync, read-only member, offline) under Meer → Mockup · toestand, or with `?demo=<state>`; `?scope=alles|persoonlijk|gedeeld` sets the scope.

The mockup is **frozen** (3 Nov 2026): it is the design reference, no longer extended. New screens are built in the React app.

| Page | Screen |
|---|---|
| `index.html` | Start: scope switch, alerts, Saldo nu, Komende maanden, spending, accounts, sync simulation, states |
| `transacties.html` | Transacties: search, filters, category sheet / side panel, split, transfers, rule links |
| `overzicht.html` | Overzicht: Maand · Kwartaal · Jaar · Eigen, bars, per-account breakdown, categories |
| `planning.html` | Planning: Kalender, Maanden, Terugkerend, Eenmalig, Budget (as on the canvas) |
| `rekeningen.html`, `rekening.html` | Rekeningen and account detail: colours, buffers, Synchronisatie, Leden, manual balances |
| `bankkoppelingen.html` | Bankkoppelingen and the linking wizard |
| `categorieen.html` | Categorieën en regels |
| `importeren.html` | Import wizard and history |
| `instellingen.html` | Profiel, Toestellen, Enable Banking, Gebruikers, Gegevens |
| `inloggen.html` | Sign-in, code, setup, invitation, new password |
| `meer.html`, `meldingen.html` | Meer (with the demo-state picker) and Meldingen |
| `berichten.html` | The ten e-mails (`emails/`), push on Android and iPhone, icons |

## Review of 3 Nov 2026

Checked: the attached canvas export *Saldo – ontwerp.html* (its three overview boards are identical to `design/project/Main`, `Saldo-Start` and `Saldo-Icoon`); every analysis section against the concept, screen and phase files; the data model against the features; the mockup code against the docs (the mockup already had three decisions in code that the docs still listed as open, and a broken Start page in Alles).

Decided with Bert (recorded in analysis 11, "3 Nov 2026"):
1. **Accounts are independent.** Every current account has its own buffer, forecast, warnings and month budget; one buffer never affects another. A shared account is an ordinary account with more than one member; any mix of accounts is possible. The scope switch is a filter.
2. **Sums as information.** Alles may show sums across accounts, labelled as information, never a verdict (no combined buffer, state or free-to-spend).
3. **Real bank connection first**, on the public domain from day one, with sign-in, hardening and a security baseline before the first real link (version 0.2).
4. **The Bilance import before planning** (now version 0.5), so the forecast has 12+ months of history.
5. **Public GitHub repository** with multi-arch images on GHCR, installed from the repository URL. Saldo writes its own packages.
6. **Phones:** one Android, one iPhone; push and the lock-screen check cover both.
7. **Trusted devices** stay signed in; a new device triggers a push and an e-mail that cannot be turned off.
8. **Meldingen** in the desktop sidebar's Beheer group.
9. Earlier open questions settled: account colours everywhere; the consent story (12 days on 18 Nov, the 14-day reminder sent on 16 Nov); 4 transactions to categorise; notifications as their own version (now 0.9).
10. **Sizes, no dates** on the roadmap.

Completed in the analysis (v1.2): the data model got the tables and fields the features need (`device`, `user_token`, `transaction_split`, `category_suggestion`, category origin, member join date and contribution share, per-account sync status, budgets and notifications per account); the bank callback is reached by the browser, not by the bank; contributions are recognised without using the other member's accounts; manual current accounts; recurring items, budgets and planned items can be added and edited by hand; risks 17–20 (public repository, trusted devices, iPhone push, real data before the full review).

Designed in the mockup: sign-in, Bankkoppelingen and the linking wizard, account detail and adding an account, Categorieën en regels, Importeren, Instellingen (profile, devices, Enable Banking, users, export), the Transacties extras, Overzicht's custom range and empty state, Planning's edit forms and per-account months, the new-device e-mail and push, an iPhone preview, and the demo states.

## Still to verify
These don't block the next step; each has its phase.
- Enable Banking with the real Argenta accounts: history depth, shared IBAN, second consent, HTTPS redirect, "Sync now" limits (spike S1, [0.2-1](plan/v0.2-foundation/01-spike-enable-banking.md)).
- The real Bilance CSV layout (spike S2, [0.5-1](plan/v0.5-bilance-import/01-spike-bilance-csv.md)).
- Recurring-item detection thresholds on real history ([0.8-1](plan/v0.8-planning/01-recurring-items.md)).
- Lock screens and push on the real Android phone and iPhone ([0.9-5](plan/v0.9-notifications/05-lock-screen-check.md)).
- The design review with Partner ([0.1-8](plan/v0.1-mockup/08-review-and-freeze.md)).