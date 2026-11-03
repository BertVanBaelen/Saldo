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
