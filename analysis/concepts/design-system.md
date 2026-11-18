# Design system

Analysis: 11 ("Look", "Brand", "Accounts in the UI", "States"), 12 · Design boards: Main (Saldo · stijl), Saldo-Icoon, Saldo-Start · Code: `finance-mockup/css/tokens.css`, `finance-mockup/css/components.css` · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-5](../../plan/v0.1-mockup/05-emails-and-push.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.2-3](../../plan/v0.2-foundation/03-web-app-shell.md), [0.9-2](../../plan/v0.9-notifications/02-web-push.md)

Tagline: **"Weet vandaag hoe je maand eindigt."** Mood: Rustig · Helder · Met kleur.

## Colour tokens
Light is the default, dark follows `prefers-color-scheme` or the `data-theme` attribute.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #F4F7F5 | #0E1311 | page (Achtergrond) |
| `--surface` | #FFFFFF | #161D1A | cards (Vlak) |
| `--line` | #E2E8E4 | #24302A | borders, dividers (Lijn) |
| `--text` | #121A16 | #E7EEEA | text |
| `--muted` | #56615B | #98A59E | secondary text |
| `--green` | #15803D | #4ADE80 | primary, "over", personal |
| `--onGreen` | #FFFFFF | #0E1311 | text on green |
| `--greenText` | #166534 | #86EFAC | green text, links |
| `--soft` / `--softChip` | #DCFCE7 / #BBF7D0 | #13321F / #1C4A2C | green tints |
| `--hero` / `--heroSub` | #15803D / #DCFCE7 | #166534 / #DCFCE7 | hero card (personal) |
| `--shared` / `--onShared` | #5B3FD9 / #FFFFFF | #9C86FF / #15111F | shared accounts |
| `--sharedText` | #4A31C2 | #B7A6FF | |
| `--sharedSoft` / `--sharedChip` | #ECE8FF / #DAD2FF | #231D3D / #342B5C | |
| `--sharedHero` / `--sharedSub` | #5B3FD9 / #E9E3FF | #4A33B8 / #E9E3FF | hero card (shared) |
| `--neg` / `--negText` / `--negSoft` / `--onNeg` | #C62828 / #B42323 / #FBE9E9 / #FFFFFF | #FF6B6B / #FF7B7B / #3A1A1C / #0E1311 | below zero |
| `--warn` / `--warnSoft` / `--warnChip` | #8A5A00 / #FFF4DB / #FFE2A3 | #F5B94A / #2E2414 / #4A3816 | in the buffer |
| `--onPastel` | #121A16 | #0E1311 | text on pastels |
| `--c1` … `--c6` | see [category](category.md) | | pastels |
| `--track` | #EAEFEC | #222B27 | progress tracks |
| `--shadow` | 0 24px 60px rgba(18,26,22,.16) | 0 24px 60px rgba(0,0,0,.4) | device frame |
| `--pop` | 0 12px 32px rgba(18,26,22,.18) | 0 12px 32px rgba(0,0,0,.5) | toasts, sheets |

Hero yellow accent: #FFD59E (bar fill and chip on the hero, text #121A16).

Chart colours (Overzicht, currently screen-local in `overzicht.css`, to promote): income `--green`; expenses #5B9BD5 / #7DBDF0; saved #B07F00 / #E8CB55; skeleton #E7EDE9 / #1F2824 and #F3F7F4 / #2A3530 with a shimmer animation (light / dark).

## Typography (Geist, Geist Mono)
| Role | Font | Weight · size |
|---|---|---|
| Big amount | Geist Mono | 500 · 46 (phone) / 50 (desktop) / 48 (style), letter-spacing −0.03em, tabular |
| Page title | Geist | 600 · 26 (phone) / 28 (desktop), −0.02em |
| Card title | Geist | 600 · 16 |
| Body | Geist | 400 · 16 / list 15 |
| Amount in list | Geist Mono | 500 · 15 |
| Label | Geist | 600 · 12–13, uppercase, letter-spacing 0.06–0.08em, muted |

## Components (from the style board)
- **Primary button**: 44 px, padding 0 18, radius 12, `--green` on `--onGreen`, 15/600. **Secondary**: `--soft` / `--greenText`.
- **Filter chip**: 36 px pill, 1 px border; selected green filled.
- **Input**: 44 px, radius 12, 1 px border; money input in Geist Mono 15. Label 13/500 muted above.
- **Status chips**: "Over € …" (soft/greenText), "Tekort € …" (negSoft/negText), "In behandeling" (dashed border), "Alleen lezen" (lock icon).
- **Alert row**: see [buffer-and-states](buffer-and-states.md).
- **Card**: `--surface`, 1 px `--line`, radius 20, padding 16 (phone) / 18–20 (desktop). Hero radius 24.
- **List row**: 40 px avatar, name 15/500, subline 13 muted, amount Mono right.
- **Segmented control**: see [scope](scope.md).
- **Toggle switch**: 52×32 track, 24 px knob, on = `--green`.
- **Toast**: pill, `--text` background with `--bg` text, 14/600, above the tab bar, 2.6 s.
- Icons: inline 24-grid stroke SVG, stroke-width 2–2.2, round caps. No emoji.

## Motion
`sIn` (fade + 6 px rise, 240–260 ms, staggered 30 ms), `sFade`, `sGrowX`/`sGrowY` for bars (560–700 ms, cubic-bezier(.2,.7,.2,1)), `sSpin` for sync, `sProgress` for the top bar, `sToast`. All reduced to 1 ms under `prefers-reduced-motion`.

## App icon "Beurs"
96-grid: rounded square r30 `#15803D`, coin circle (44,31) r12 `#FFD59E`, wallet rect (18,36) 60×40 r12 green fill with white stroke 6, clasp rect (58,48) 23×16 r8 white with dot (66,56) r3.5 green. Variants: iOS r22, Android circle, favicon 32 and 16 (simplified, thicker strokes), email logo (r26, stroke 7, no clasp dot). Files: `finance-mockup/img/app-icon.svg`, `app-icon-round.svg`, `statusbar-icon.svg`, `favicon.svg`.

Status-bar icon: one-colour silhouette on a 24 dp grid, 2 dp margin, 1.5 dp gap between coin and wallet so they stay apart at 16 px. The Android notification shade uses its own colours, not the app tokens ([pushmeldingen](../screens/pushmeldingen.md#design-notes)).

## Sheet motion (0.8-0c)
One motion for every sheet in the app (`web/src/components/Sheet.tsx`, tokens in `tokens.css`, rules in `components.css`).

| Token | Value | Use |
|---|---|---|
| `--ease-sheet-in` | `cubic-bezier(0.5, 0, 0.3, 1.2)` | in: 15 % of the way after a quarter of the time, a 2.25 % overshoot at about 85 % of the time, then settles |
| `--dur-sheet-in` | 450 ms | |
| `--ease-sheet-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | out: no overshoot |
| `--dur-sheet-out` | 250 ms | |

- **Phone bottom sheet** (`.sheet`): `sSheetUp` (`translateY(100%)` to none) in, `sSheetDown` out; the backdrop fades in over 200 ms and out over 250 ms. Only `transform` and `opacity` animate. The overshoot lifts the sheet off the bottom edge, so a second `box-shadow` layer paints `--surface` 48 px below it (not a `::after`: the sheet is a scroll container and would clip or scroll it); the desktop dialog does not have it.
- **Side panel** (`.panel`, `Sheet variant="panel"`): right edge, full height, 440 px (max 90 vw), radius 24 0 0 24, `sPanelIn` / `sPanelOut` on `translateX` with the same tokens, a 48 px `--surface` strip beyond its right edge for the overshoot. Modal like the sheet: backdrop, focus trap, Escape and backdrop close, focus returns. Overzicht's content sheets use it from 1024 px (`useIsDesktop()`) and the bottom sheet below; the same content re-renders in the other presentation when the width crosses 1024 px while it is open.
- **Centred dialog** (pickers and forms on desktop, from 1024 px): the `.sheet` stays a dialog and rises 24 px (`sSheet`, `sSheetOut`) on the same tokens.
- **Closing is asynchronous**: Escape, the backdrop and `useSheetClose()` (for a close button inside a sheet) add `sheet--closing` / `panel--closing` and call `onClose` on `animationend`, with a 300 ms timer as the fallback (160 ms with reduced motion). A caller that must close at once passes `immediate`, or unmounts the sheet itself (a pick in a list, a save), which skips the exit.
- **Reduced motion**: no movement, a 150 ms fade in and out (`!important`, the global 1 ms rule would win otherwise).
- Drag-to-dismiss is not built. A unit test (`motion.test.ts`) samples the token curves. Plan [0.8-0c](../../plan/v0.8-planning/00c-overzicht-sheets.md).
