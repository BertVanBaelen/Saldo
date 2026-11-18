# 0.8-5a · UI libraries for the Planning screens

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | released (0.8.0), verifying |
| Size | M |
| Features | PLAN-6 |
| Concepts | [design-system](../../analysis/concepts/design-system.md) |
| Screens | [planning](../../analysis/screens/planning.md) |
| Depends on | 0.8-5 steps 2 and 3 (the chart, the grid, the day card and the plan form exist) |

## Decision (user, 19 Nov 2026)
Use **Kokonut UI** (kokonutui.com: nice elements, some base elements missing) and **Untitled UI React** (untitledui.com/react: base elements, less flashy) for the **new Planning screens only** (0.8-5 shell, 0.8-6, 0.8-7). Existing screens stay untouched. **Only free Untitled UI components** (no PRO code is copied into this public repository). Restyled with Saldo's tokens so light and dark stay consistent.

## What the libraries need (docs, checked 19 Nov 2026)
- Kokonut UI is a shadcn/ui registry: Tailwind CSS v4, `components.json`, the `cn` helper, `motion` and `lucide-react`; components are copied into the repository by the shadcn CLI. The docs page states no licence: read the licence file of its repository before copying anything and record it.
- Untitled UI React is built on React Aria Components (1.21) and Tailwind CSS 4.3, with a free and a PRO tier (the page does not state the licence: check it per component in the registry and keep to the ones marked free).
- The web app has no UI dependency today (React, the router and the fonts), plain CSS on `tokens.css`, a strict CSP (`default-src 'self'`, no inline script) and a CI that blocks on `npm audit --omit=dev`.

## Rules
1. **Tailwind v4 without its global reset and without collisions**: import the theme and utilities layers only (no preflight), and prefix or scope the utilities so none of them can match a class of the existing CSS (`.card`, `.btn`, `.chip`, `.mono`, `.muted`, …); the Vite plugin (`@tailwindcss/vite`). The theme maps Saldo's tokens (`--green`, `--text`, `--bg`, `--surface`, `--line`, `--neg`, `--warn`, the account colours, radii, the Geist fonts) and follows the existing `data-theme` / `prefers-color-scheme` mechanism, so dark mode needs no second switch.
2. **Vendored, restyled, labelled**: copied components live in `web/src/ui/` (one folder, no other place), each file starts with a comment (source URL, licence, date copied), Dutch strings, our tokens instead of the library's palette, our focus ring, our 44 px touch targets.
3. **Which components**: Tabs (the Planning tab bar, keyboard and hash behaviour of 0.8-5 stay), Input and amount field, Select, Switch, segmented control ("− Uitgave" / "+ Inkomst", horizon 3 / 6 / 12 / 24), DatePicker or Calendar for the dates of planned and recurring items, Badge or chip, and from Kokonut only the motion touches that fit a calm finance screen (an animated tab indicator, number transitions), each behind `prefers-reduced-motion`. **Not**: sheets and the side panel (our own motion of 0.8-0c stays the one motion of the app), the daily-balance chart and the calendar grid (custom), any chart library, anything for existing screens.
4. **Hygiene**: `npm audit --omit=dev` stays clean (CI blocks on it); the bundle size delta is measured and reported (the Planning route may be loaded lazily if the delta is large); the CSP is unchanged (no inline script; styles from `motion` are inline styles, which `style-src 'unsafe-inline'` allows today); a short `docs/third-party-ui.md` lists every vendored component with its source, licence and date, and `docs/security-baseline.md` and `docs/architecture.md` get one line each about the new dependencies.
5. **No regressions**: the existing tests stay green and the existing screens render the same (a computed-style spot check of Start and Overzicht before and after, by the lead).

## Steps
1. **Opus**: the infrastructure: install and configure Tailwind v4 (no preflight, scoped), `components.json`, `cn`, the token theme, `web/src/ui/`, one smoke test that the built CSS carries no preflight and no unprefixed utility, `docs/third-party-ui.md`, the licence findings, the audit and the bundle delta.
2. **Sonnet**: the Planning shell of 0.8-5 and the tabs of 0.8-6 and 0.8-7 with the library Tabs, Select, Switch, segmented control and date picker (the steps of those phases, with these controls).
3. **Sonnet**: restyle the `PlanForm` and `DayCard` of 0.8-5 step 3 onto the library controls (behaviour and tests unchanged).
4. Lead: the demo at 375 px and desktop, light and dark; Start and Overzicht unchanged.

## Tests
- The smoke test of step 1; the Planning tests of the phases that use the controls; nothing else new.

## Done when
The Planning screens use the library controls, the existing screens are unchanged, the audit is clean, and every vendored component is listed with its licence.
