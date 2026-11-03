# Saldo knowledge base

This folder is the shared memory between three sources:

| Source | Where | What it holds |
|---|---|---|
| Analysis document | [`../analysis.md`](../analysis.md) | Requirements, calculation rules, decisions (v1.2) |
| Design canvas and mockup | `design/project/*.dc.html` (copy of the *Saldo – ontwerp* canvas) and the mockup in [`../finance-mockup/`](../finance-mockup/), which also holds the screens the canvas does not have | How every screen, state, email and notification looks |
| Plan | [`../plan/`](../plan/README.md) | Versions, phases and the work per phase |

Every **concept** file describes one domain object or idea once, and links to the analysis sections, design boards, screens and phases that touch it. Every **screen** file describes one screen and links to the concepts it shows. When something changes, update the concept file first, then the places that link to it.

## Concepts

| Concept | File | Analysis |
|---|---|---|
| User, roles and visibility | [concepts/user-and-visibility.md](concepts/user-and-visibility.md) | 2, 4.8 |
| Sign-in, trusted devices and security | [concepts/authentication.md](concepts/authentication.md) | 7 |
| Account (current, savings, manual) | [concepts/account.md](concepts/account.md) | 3, 6.3 |
| Scope switch, independent accounts and sums | [concepts/scope.md](concepts/scope.md) | 4.4, 4.5, 5.3 |
| Shared account membership | [concepts/shared-account.md](concepts/shared-account.md) | 4.3, 4.8, 6.3 |
| Bank connection, consent and sync | [concepts/bank-connection.md](concepts/bank-connection.md) | 4.1, 6 |
| Transaction | [concepts/transaction.md](concepts/transaction.md) | 4.1, 5.1, 6.3 |
| Category | [concepts/category.md](concepts/category.md) | 4.2 |
| Rule and learning (categorisation) | [concepts/categorisation-rule.md](concepts/categorisation-rule.md) | 4.2 |
| Internal transfer and saved | [concepts/internal-transfer.md](concepts/internal-transfer.md) | 4.3, 5.2 |
| Recurring item | [concepts/recurring-item.md](concepts/recurring-item.md) | 4.5 |
| Planned one-off item | [concepts/planned-item.md](concepts/planned-item.md) | 4.5 |
| Budget and free to spend | [concepts/budget.md](concepts/budget.md) | 4.5, 5.3 |
| Forecast (months and daily line) | [concepts/forecast.md](concepts/forecast.md) | 4.5, 5.3 |
| Buffer and states (green, yellow, red) | [concepts/buffer-and-states.md](concepts/buffer-and-states.md) | 4.5, 5.3, 11 |
| Period and overview | [concepts/period-overview.md](concepts/period-overview.md) | 4.4 |
| Import batch (CSV, Bilance) | [concepts/import.md](concepts/import.md) | 4.6 |
| Notification and email | [concepts/notification.md](concepts/notification.md) | 4.9 |
| Money, dates and formatting | [concepts/money-and-format.md](concepts/money-and-format.md) | 4.7, 5.1, 14 |
| Design system | [concepts/design-system.md](concepts/design-system.md) | 11, 12 |
| App shell and navigation | [concepts/app-shell.md](concepts/app-shell.md) | 12 |
| Demo data | [concepts/demo-data.md](concepts/demo-data.md) | 12 |

## Screens

| Screen | File | Design boards | Designed in | Mockup |
|---|---|---|---|---|
| Inloggen and Code | [screens/inloggen.md](screens/inloggen.md) | – | Mockup | `inloggen.html` |
| Start | [screens/start.md](screens/start.md) | Telefoon-Start, Desktop-Start, Saldo-Start | Canvas, states in the mockup | `index.html` |
| Transacties | [screens/transacties.md](screens/transacties.md) | Telefoon-Transacties, Desktop-Transacties | Canvas (list, category sheet), mockup (filters, split, transfer, rules, states) | `transacties.html` |
| Overzicht | [screens/overzicht.md](screens/overzicht.md) | Telefoon-Overzicht, Desktop-Overzicht | Canvas, mockup (custom range, account filter, empty) | `overzicht.html` |
| Planning | [screens/planning.md](screens/planning.md) | Telefoon-Planning, Desktop-Planning | Canvas, mockup (per account, edit forms, states) | `planning.html` |
| Rekeningen and detail | [screens/rekeningen.md](screens/rekeningen.md) | Telefoon-Rekeningen, Desktop-Rekeningen | Canvas (list, settings), mockup (detail, add account, states) | `rekeningen.html`, `rekening.html` |
| Bankkoppelingen and Bank koppelen | [screens/bank-koppelen.md](screens/bank-koppelen.md) | – | Mockup | `bankkoppelingen.html` |
| Categorieën en regels | [screens/categorieen.md](screens/categorieen.md) | – | Mockup | `categorieen.html` |
| Importeren | [screens/importeren.md](screens/importeren.md) | – | Mockup | `importeren.html` |
| Instellingen | [screens/instellingen.md](screens/instellingen.md) | – | Mockup | `instellingen.html` |
| Meldingen | [screens/meldingen.md](screens/meldingen.md) | Telefoon-Meldingen | Canvas (phone), mockup (desktop, new-device type) | `meldingen.html` |
| Meer | [screens/meer.md](screens/meer.md) | Telefoon-Meer | Canvas (phone), mockup (desktop, demo states) | `meer.html` |
| E-mails | [screens/emails.md](screens/emails.md) | E-mail-Berichten | Canvas (nine), mockup (new device) | `emails/`, `berichten.html` |
| Pushmeldingen | [screens/pushmeldingen.md](screens/pushmeldingen.md) | Meldingen-Android, Meldingen-Icoon | Canvas, mockup (new device, iPhone) | `berichten.html` |

Every screen can be opened in the demo states of the mockup (Meer → Mockup · toestand, or `?demo=`): see [concepts/demo-data.md](concepts/demo-data.md#demo-states).

## Conventions

- Concept and screen files are written in English. UI labels are quoted in Dutch, exactly as in the design (glossary: [concepts/money-and-format.md](concepts/money-and-format.md#glossary)).
- Phases are referred to by id, for example **0.1-2** (version 0.1, phase 2), and every "Phases:" line links to the phase files. The phase files are the source of truth: when a phase changes its concepts or screens, update the "Phases:" line of those files. See [../plan/README.md](../plan/README.md).
- Features have ids like `BANK-3`; the roadmap lists them per version.
- Open questions are marked **[verify]**, as in the analysis.
