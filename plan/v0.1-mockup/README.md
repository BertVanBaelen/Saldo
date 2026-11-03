# Version 0.1 · Mockup

**After this version you can** click through every screen of Saldo with the demo data, on a phone and on a desktop, in light and dark, and agree on the design with Partner.

Status: in progress (phases 1 to 5 done on 3 Nov 2026). Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| UI-1 | Design system: colours, type, components, icons, light and dark |
| UI-2 | Clickable Start, Transacties, Overzicht, Planning, Rekeningen, Meer, Meldingen |
| UI-3 | E-mail templates and push notification previews |
| UI-4 | Designs for sign-in, bank linking, account detail, categories, import, settings and the remaining states |
| UI-5 | Reviewed and frozen design |

## Phases
| Phase | Title | Features | Status |
|---|---|---|---|
| [0.1-1](01-foundation-and-start.md) | Foundation and Start | UI-1, UI-2 | done |
| [0.1-2](02-transacties-and-overzicht.md) | Transacties and Overzicht | UI-2 | done |
| [0.1-3](03-planning.md) | Planning | UI-2 | done |
| [0.1-4](04-rekeningen-meer-meldingen.md) | Rekeningen, Meer and Meldingen | UI-2 | done |
| [0.1-5](05-emails-and-push.md) | E-mails and pushmeldingen | UI-3 | done |
| [0.1-6](06-missing-designs.md) | Missing designs and states | UI-4 | planned |
| [0.1-7](07-review-and-freeze.md) | Review and freeze | UI-5 | planned |

## Concepts
All concepts get a first visual form here: design-system, app-shell, money-and-format, demo-data, account, account-group, shared-account, bank-connection, transaction, category, categorisation-rule, internal-transfer, period-overview, recurring-item, planned-item, budget, forecast, buffer-and-states, import, notification, authentication, user-and-visibility.

## Conventions (carry over to the web app in 0.2-5)
- Code in [`finance-mockup/`](../../finance-mockup/README.md), no build step, served by `finance-mockup/serve.ps1`.
- `css/tokens.css`, `css/components.css`, `css/screens/<screen>.css`; `js/format.js`, `js/icons.js`, `js/data.js`, `js/shell.js`, `js/screens/<screen>.js`.
- Phone below 1024 px (bottom tabs), desktop from 1024 px (sidebar). Theme follows the system, overridable under Weergave.

## Exit criteria
Every screen in analysis 12 exists in the mockup, the open questions in the concept files are decided, and tokens and components are frozen for 0.2-5.
