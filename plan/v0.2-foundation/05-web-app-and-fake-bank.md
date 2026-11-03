# 0.2-5 · Web app and fake bank

| | |
|---|---|
| Version | [0.2 Foundation](README.md) |
| Status | planned |
| Features | PLAT-3, PLAT-4 |
| Concepts | [design-system](../../analysis/concepts/design-system.md), [app-shell](../../analysis/concepts/app-shell.md), [money-and-format](../../analysis/concepts/money-and-format.md), [demo-data](../../analysis/concepts/demo-data.md), [bank-connection](../../analysis/concepts/bank-connection.md) |
| Analysis | 8, 13.3, 13.5 |
| Depends on | 0.2-3, 0.1-7 (frozen components) |

## Goal
The real web app skeleton in the look of the mockup, and a fake bank that serves the demo story.

## Steps
1. Vite + React + TypeScript, installable as a PWA (manifest, service worker, app icons from `finance-mockup/img/`).
2. Port `tokens.css`, the shared components and the shell from the mockup; `format.ts` (eur, eur0, dates), `api.ts`, router, i18n with Dutch first.
3. Theme (system, light, dark) and scope switch state per user.
4. Bank provider interface (`ListAccounts`, `FetchTransactions`, `FetchBalances`) and a fake provider seeded with the demo story and about 12 months of transactions.
5. Component tests for the shell and formatting.

## Done when
After sign-in the Start screen renders from the server with fake-bank data, on phone and desktop.
