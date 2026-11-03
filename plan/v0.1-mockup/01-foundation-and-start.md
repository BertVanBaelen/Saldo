# 0.1-1 · Foundation and Start

| | |
|---|---|
| Version | [0.1 Mockup](README.md) |
| Status | done (3 Nov 2026) |
| Size | M |
| Features | UI-1, UI-2 |
| Concepts | [design-system](../../analysis/concepts/design-system.md), [app-shell](../../analysis/concepts/app-shell.md), [money-and-format](../../analysis/concepts/money-and-format.md), [demo-data](../../analysis/concepts/demo-data.md), [scope](../../analysis/concepts/scope.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [forecast](../../analysis/concepts/forecast.md), [category](../../analysis/concepts/category.md), [shared-account](../../analysis/concepts/shared-account.md), [account](../../analysis/concepts/account.md), [bank-connection](../../analysis/concepts/bank-connection.md), [user-and-visibility](../../analysis/concepts/user-and-visibility.md) |
| Screens | [start](../../analysis/screens/start.md) |
| Design boards | Main, Saldo-Icoon, Saldo-Start, Telefoon-Start, Desktop-Start |
| Depends on | – |

## Goal
The shared base every screen builds on, and the Start screen as the reference screen.

## Steps
1. Colour tokens for light and dark, fonts, radii, motion keyframes, reduced motion (`css/tokens.css`).
2. Shared components: card, button, chip, alert, list row, scope switch, switch, toast, sheet, month bars (`css/components.css`).
3. Shell: sidebar on desktop, tab bar on phone, active item, badges, user block, app icon and favicon (`js/shell.js`).
4. Formatting helpers `eur`, `eur0`, Dutch dates (`js/format.js`), icons (`js/icons.js`).
5. Shared demo data: users, accounts, forecasts, spending, alerts (`js/data.js`).
6. Start: alerts, Saldo nu hero, Komende maanden, Uitgaven, account sections, sync simulation, scope switch.

## Done when
Start matches Telefoon-Start at 375 px and Desktop-Start at 1280 px, in light and dark, in all three scopes. ✔