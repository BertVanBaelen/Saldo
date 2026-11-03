# Saldo · overview

Saldo is a self-hosted replacement for Bilance that runs as a Home Assistant add-on. It answers one question: *will I have enough money at the end of each coming month, and how much is left or short?* Two users (Bert and Partner), each seeing only their own accounts, with a shared account they both hold.

Status on 3 Nov 2026: **version 0.1 (mockup) in progress**. Phases 0.1-1 … 0.1-5 are done; 0.1-6 (missing designs) and 0.1-7 (review) are next. No server code yet.

## Where everything is

| Folder / file | What it holds | Start here |
|---|---|---|
| [`analysis.md`](analysis.md) | The analysis document v1.1: requirements, calculation rules, decisions, risks | sections 1, 4, 5 |
| [`analysis/`](analysis/README.md) | Knowledge base: 22 concept files and 14 screen files, cross-linked to the analysis, the design and the phases | [analysis/README.md](analysis/README.md) |
| [`plan/`](plan/README.md) | Roadmap: 11 versions, 46 features, one file per phase (53) | [plan/README.md](plan/README.md) |
| [`finance-mockup/`](finance-mockup/README.md) | Clickable mockup of the design, plain HTML/CSS/JS, demo data | [finance-mockup/README.md](finance-mockup/README.md) |
| [`design/`](design/README.md) | Read-only copy of the design canvas *Saldo – ontwerp* | [design/README.md](design/README.md) |
| `.claude/launch.json` | Starts the mockup server for the Claude preview pane | – |

How they connect:

```
analysis.md ──► analysis/concepts/*.md ◄──► plan/<version>/<phase>.md
   (what)          (one idea, once)              (when, which feature)
                          ▲
design/*.dc.html ──► analysis/screens/*.md ──► finance-mockup/<screen>.html
   (how it looks)       (spec per screen)          (clickable)
```

Every concept and screen file starts with a header line: analysis sections, data tables, screens, and **Phases:** with links to the phase files. Every phase file lists its features, concepts, screens, analysis sections and dependencies. The phase files are the source of truth for those links.

## Roadmap

| Version | After this version you can … | Phases |
|---|---|---|
| [0.1 Mockup](plan/v0.1-mockup/README.md) | click through every screen with demo data | 7 (5 done) |
| [0.2 Foundation](plan/v0.2-foundation/README.md) | install the add-on and sign in on your domain | 5 |
| [0.3 Bank sync](plan/v0.3-bank-sync/README.md) | see your real Argenta transactions, synced nightly | 6 |
| [0.4 Categorisation](plan/v0.4-categorisation/README.md) | have rules categorise transactions, fix the rest in a tap | 4 |
| [0.5 Shared accounts](plan/v0.5-shared-accounts/README.md) | share the joint account, each seeing only your own accounts | 5 |
| [0.6 Overview](plan/v0.6-overview/README.md) | see income, spending and savings per period and category | 3 |
| [0.7 Planning](plan/v0.7-planning/README.md) | know how each coming month ends per account group | 6 |
| [0.8 Notifications](plan/v0.8-notifications/README.md) | get push and e-mail warnings before the buffer or zero | 5 |
| [0.9 Bilance import](plan/v0.9-bilance-import/README.md) | bring in your full Bilance history without duplicates | 5 |
| [1.0 Release](plan/v1.0-release/README.md) | run it on real data, reviewed and backed up | 4 |
| [2.0 Investments](plan/v2.0-investments/README.md) | see net worth per platform | 3 |

The full feature list per version is in [plan/README.md](plan/README.md#features-per-version).

## The mockup

```bash
pwsh -NoProfile -File finance-mockup/serve.ps1
```
Open http://localhost:5173/. Phone layout below 1024 px, desktop from 1024 px; light and dark (Meer → Weergave).

| Page | Screen | Notes |
|---|---|---|
| `index.html` | Start | Scope switch, alerts, Saldo nu, Komende maanden, spending, accounts, sync simulation |
| `transacties.html` | Transacties | Search, "Niet gecategoriseerd", category sheet / side panel, rule checkbox |
| `overzicht.html` | Overzicht | Maand · Kwartaal · Jaar, bars, category share and trend |
| `planning.html` | Planning | Kalender, Maanden, Terugkerend, Eenmalig, Budget (`#tab` opens a tab) |
| `rekeningen.html` | Rekeningen | Name, 8 colours, buffer per account |
| `meer.html` | Meer | Phone menu; Weergave; also the desktop profile page |
| `meldingen.html` | Meldingen | Channels, per-type push / e-mail, look-ahead, quiet hours |
| `berichten.html` | E-mails and push | The nine e-mails (`emails/`), lock screen, notification shade, icons |

Items that link to `#` (Bankkoppelingen, Categorieën, Importeren, Instellingen, profile) have no screen yet: they are designed in 0.1-6.

## Review of 3 Nov 2026

Checked: every link and heading anchor in `analysis/`, `plan/` and `finance-mockup/` (all resolve); every phase id in the knowledge base exists; every mockup page at 375 and 1280 px (renders, no console errors, no horizontal scroll); theme tokens in light and dark.

Fixed in this pass:
- The "Phases:" lines in all concept and screen files were out of date after the plan was split into phase files (86 missing links). They are now generated from the phase files and link to them; 8 phase files got concepts or screens they touched but did not list.
- Skeleton colours and the shimmer animation were defined three times (Transacties, Overzicht, Planning), and the 8 account colours only in Rekeningen. All now live in `css/tokens.css`.
- Small text fixes: an old phase-id example in `analysis/README.md`, an unclear sentence about the 1 November balance in `forecast.md`; a Mockup column in the screen table; a README for `design/`.

## Open questions

These need your decision; they are also noted in the concept files and in phase [0.1-7](plan/v0.1-mockup/07-review-and-freeze.md).

1. **Combining groups in Alles.** The analysis says Persoonlijk and Gedeeld are never added together. The design adds them in Overzicht (past totals) and in Planning → Maanden and the desktop buffer pill (a combined € 1.500 buffer with "onder buffer" verdicts). See [account-group](analysis/concepts/account-group.md).
2. **Account icon colours.** Rekeningen lets you pick one of 8 colours per account, but Start and Transacties use fixed tints (green soft, pastels). Should the chosen account colour be used everywhere?
3. **Meldingen on desktop.** The desktop sidebar has no Meldingen item; the mockup reaches it through the user block → Meer. Keep that, put it under Instellingen, or add it to the Beheer group?
4. **Demo story.** The bank consent expires in 12 days on the app screens but in 14 days in the e-mails and push previews; and Start says 8 transactions to categorise while the demo list has 4.
5. **Notifications as their own version.** Analysis section 10 has no milestone for 4.9; the plan adds version 0.8 between Planning and the Bilance import, with the consent e-mails already in 0.3. Is that the right place?
6. **Git.** This folder is not a git repository yet, so nothing is committed. Analysis 8 says the app gets its own repository. Create it here now, or in 0.2-3?
