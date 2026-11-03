# Version 0.1 · Mockup

**After this version you can** click through the screens and states of Saldo with the demo data, on a phone and on a desktop, in light and dark: the design reference for the React app.

Status: done (3 Nov 2026). The mockup is frozen as the design reference; the work in plain HTML/JS stopped and every further screen is built in the React app (0.1-7, 0.1-8). Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| UI-1 | Design system: colours, type, components, icons, light and dark |
| UI-2 | Clickable Start, Transacties, Overzicht, Planning, Rekeningen, Meer, Meldingen |
| UI-3 | E-mail templates and push notification previews |
| UI-4 | Designs for sign-in, bank linking, account detail, categories, import, settings and the remaining states (partly; the rest in the React app) |
| UI-5 | Frozen mockup as the design reference |
| UI-6 | The decisions of 3 Nov 2026 in the mockup: independent accounts, sums as information, demo states |

## Phases
| Phase | Title | Size | Features | Status |
|---|---|---|---|---|
| [0.1-1](01-foundation-and-start.md) | Foundation and Start | M | UI-1, UI-2 | done |
| [0.1-2](02-transacties-and-overzicht.md) | Transacties and Overzicht | M | UI-2 | done |
| [0.1-3](03-planning.md) | Planning | L | UI-2 | done |
| [0.1-4](04-rekeningen-meer-meldingen.md) | Rekeningen, Meer and Meldingen | M | UI-2 | done |
| [0.1-5](05-emails-and-push.md) | E-mails and pushmeldingen | M | UI-3 | done |
| [0.1-6](06-decisions-in-the-mockup.md) | Decisions of 3 November in the mockup | M | UI-6 | done |
| [0.1-7](07-missing-designs.md) | Missing designs and states | L | UI-4 | stopped |
| [0.1-8](08-review-and-freeze.md) | Freeze the mockup | S | UI-5 | done |

## Concepts
All concepts get a first visual form here: design-system, app-shell, money-and-format, demo-data, account, scope, shared-account, bank-connection, transaction, category, categorisation-rule, internal-transfer, period-overview, recurring-item, planned-item, budget, forecast, buffer-and-states, import, notification, authentication, user-and-visibility.

## Conventions (carry over to the web app in 0.2-3)
- Code in `finance-mockup/`, no build step, served by `finance-mockup/serve.ps1`.
- `css/tokens.css`, `css/components.css`, `css/screens/<screen>.css`; `js/format.js`, `js/icons.js`, `js/data.js`, `js/shell.js`, `js/screens/<screen>.js`.
- Phone below 1024 px (bottom tabs), desktop from 1024 px (sidebar). Theme follows the system, overridable under Weergave.
- Demo states through Meer → Mockup · toestand, or `?demo=` and `?scope=` in the URL.

## Exit criteria
The mockup is frozen; tokens and components are the starting point for 0.2-3. ✔