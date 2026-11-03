# 0.2-3 · Web app shell

| | |
|---|---|
| Version | [0.2 Foundation and first bank link](README.md) |
| Status | in progress (3 Nov 2026): shell, PWA and first screens on real data; to check: install on both phones once Saldo runs on HTTPS |
| Size | M |
| Features | PLAT-3 |
| Concepts | [design-system](../../analysis/concepts/design-system.md), [app-shell](../../analysis/concepts/app-shell.md), [money-and-format](../../analysis/concepts/money-and-format.md), [demo-data](../../analysis/concepts/demo-data.md) |
| Analysis | 8, 12, 13.3 |
| Depends on | [0.2-2](02-repository-addon-ci.md), [0.1-8](../v0.1-mockup/08-review-and-freeze.md) (frozen components) |

## Goal
The real web app skeleton in the look of the mockup, installable on Android and iPhone.

## Steps
1. Vite + React + TypeScript, installable as a PWA (manifest, service worker that caches only the app shell, app icons from `finance-mockup/img/`, `apple-touch-icon` for iPhone).
2. Port `tokens.css`, the shared components and the shell from the mockup; `format.ts` (eur, eur0, dates), `api.ts`, router, i18n with Dutch first.
3. Theme (system, light, dark) and scope switch state per user; offline banner.
4. Pages without navigation for sign-in.
5. Component tests for the shell and formatting.

## Done when
The empty shell installs on the Android phone and the iPhone and matches the mockup's navigation on phone and desktop.