# 0.8-0c · Overzicht: bottom sheets with a natural slide

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | released (0.8.0), verifying |
| Size | M |
| Features | PLAN-0 |
| Concepts | [period-overview](../../analysis/concepts/period-overview.md), [design-system](../../analysis/concepts/design-system.md) |
| Screens | [overzicht](../../analysis/screens/overzicht.md), [transacties](../../analysis/screens/transacties.md) |
| Depends on | [0.8-0a](00-saving-categories.md) (the `saved` drill-down key and the Gespaard tile), [0.7-3](../v0.7-overview/03-overzicht-screen.md) |

## Goal
The user's request of 18 Nov 2026: "when I press on the categories or on the accounts in the overview that it slides in from the bottom. The slide should be natural, so slow at first, with a little overshoot at the end." Chosen design (user): a **sheet over Overzicht**. A category row (and the Gespaard tile) opens a bottom sheet with the transactions behind it; an account row in "Per rekening" opens a bottom sheet with that account's figures. Overzicht stays visible behind. This deviates from the frozen mockup (rows were links to Transacties, account rows filtered at once): recorded in `analysis/screens/overzicht.md`.

## The motion (one place: `tokens.css` and `Sheet.tsx`, so every sheet in the app moves the same, the pickers included)
- Tokens: `--ease-sheet-in: cubic-bezier(0.5, 0, 0.3, 1.2)`, `--dur-sheet-in: 450ms`, `--ease-sheet-out: cubic-bezier(0.4, 0, 0.2, 1)`, `--dur-sheet-out: 250ms`. The in-curve starts slowly (15 % of the way after a quarter of the time) and overshoots by **2.25 %** of the travel at about 90 % of the time before settling (sampled from the Bézier; 1.15 as last control point gives only 1.35 %, 1.1 gives 0.6 %).
- Phone (every `.sheet`): `@keyframes sSheetUp { from { transform: translateY(100%); } to { transform: none; } }` with the in-tokens; the backdrop fades in (`sFade`, 200 ms). Because the overshoot lifts the sheet above its resting place, `.sheet::after` paints a strip of `--surface` 48 px below the sheet so no gap shows at the bottom edge. Only `transform` and `opacity` animate (no height, no layout), so a sheet with a long list stays smooth; `will-change: transform` only while animating.
- Closing: `Sheet` gets a closing state: on Escape, backdrop, the close button or a caller's request it adds `sheet--closing` (`translateY(100%)` with the out-tokens, no overshoot; backdrop fades out) and calls `onClose` on `animationend`, with a 300 ms timer as a fallback (jsdom fires no animation events). Callers keep their API; a caller that must close at once (after a save that navigates) passes `immediate`.
- Desktop (≥ 1024 px): the existing `Sheet` stays a **centred dialog** for the pickers and forms (unchanged, they only take the in-tokens for their 24 px `sSheet` rise). The **Overzicht content sheets** become a **side panel** there (user decision 18 Nov 2026): anchored to the right edge, full height, width 440 px (max 90 vw), radius 24 0 0 24, sliding in with `@keyframes sPanelIn { from { transform: translateX(100%); } to { transform: none; } }` on the same in-tokens (slow start, 2.25 % overshoot, 450 ms) and out with `translateX(100%)` on the out-tokens (250 ms, no overshoot); reduced motion: the same 150 ms fade. The overshoot pulls the panel left of its resting place, so `.panel::after` paints a 48 px strip of `--surface` beyond its right edge. It is **modal**: the same backdrop (fading), focus trap, Escape and backdrop close and focus return as the phone sheet. Why modal and not a non-blocking panel: one behaviour on both widths, one focus model, no second interaction state to test, and the page behind stays visible (the panel covers at most 440 px of Overzicht, which keeps its chart and tiles in view).
- **One content component, two presentations**: `OverzichtSheet` (title, totals, list or account figures, links) renders inside `<Sheet variant={desktop ? 'panel' : 'sheet'}>`, where `desktop` comes from the app's existing hook **`useIsDesktop()`** (`web/src/components/ui.tsx`, `(min-width: 1024px)`, the app shell's breakpoint). `Sheet` gets the `variant` prop (`sheet` default, `panel`), the class and the keyframes; nothing else differs. Crossing the breakpoint while open re-renders the same content in the other presentation without closing it.
- `prefers-reduced-motion: reduce`: no movement, a 150 ms fade in and out; the closing timer becomes 160 ms.
- Drag-to-dismiss: out of scope (not cheap to do well with a scrolling list inside).
- **Verification.** A unit test (`web/src/styles/motion.test.ts`) reads `tokens.css` (`?raw` import), parses `--ease-sheet-in`, samples the cubic Bézier and asserts: progress at 25 % of the time below 0.2 (slow start), the maximum between 1.01 and 1.04 (a small overshoot), the end at 1; the out-curve never above 1. Manual check (lead): Chrome DevTools → Animations at 10 % speed on the 375 px phone emulation, light and dark: slow start, a visible small bounce, no bottom gap, and the same at 1280 px for the side panel (no gap at the right edge), the list does not reflow during the slide; once with "Emulate CSS prefers-reduced-motion".

## Behaviour
- **URL state**: the sheet is in Overzicht's search parameters, pushed (so Back closes it): `?blad=categorie-<key>` (`<key>` exactly as the drill-down's `categorie` value: a top category id, `geen`, `naar-gedeeld`, `naar-eigen`), `?blad=gespaard`, `?blad=rekening-<id>`. Opening keeps the other parameters (period, account filter); closing goes back (or replaces when the sheet was opened from a link).
- **Category sheet** (and Gespaard): title the category name with its icon and the period ("Boodschappen · oktober 2026"), a totals line "€ 642,00 · 14 transacties" (the amount is the Overzicht row's, the count the API's `total`), the rows as in Transacties' list (date groups, counterparty, account pill in a multi-account view, amount; split rows once with their full amount), "Meer laden" with the `before` cursor, a link "Open in Transacties" to the drill-down URL of 0.7-2/0.8-0a. **One mapping**: move the URL-to-query code of Transacties (`periodFromParam`, `categoryFromParam` and the account/scope part) into `web/src/lib/drilldown.ts` (`drillQuery(params, today) → TxQuery`), used by Transacties and the sheet; the sheet builds the same `URLSearchParams` it links to and passes them through it. Rows are not editable in the sheet (no category picker): a row is a link to Transacties with the drill-down filter, where it can be opened and changed. Gespaard rows carry the note line of 0.8-0a. Loading: three skeleton rows; empty (only possible after a change elsewhere): "Geen transacties meer in deze periode."; error: the app's `ErrorState` with retry.
- **Account sheet**: title the account name with its colour; In / Uit / Gespaard for the selected period (from the report already loaded: `months[].accounts`, no extra request) and its expense rows (category name, amount, share), the footnote of Overzicht when it applies; buttons "Alleen deze rekening tonen" (the current tap-to-filter, then closes) and a link "Naar de rekening" (`/rekeningen/<id>`).
- **The Gespaard tile** (0.8-0a made it a link): it opens the Gespaard sheet instead; the sheet's "Open in Transacties" is the 0.8-0a link.
- Read-only members: nothing changes (the sheets are read-only).

## Accessibility
`Sheet` already gives `role="dialog"`, `aria-modal`, a label, focus into the sheet, a focus trap and focus back to the row (now after the closing animation). The opening row stays a `button` (it opens a dialog: `aria-haspopup="dialog"`) and keeps its `aria-label` ("Boodschappen: € 642,00, 23 %. Bekijk de transacties."). The list inside is the Transacties list markup (`aria-busy` while loading).

## Steps
1. **Sonnet**: the motion tokens, `Sheet` closing state, reduced motion, the `::after` strip, `motion.test.ts`, the vitest updates of existing sheet tests (close is now asynchronous: `await` the close or use fake timers).
2. **Sonnet**: `lib/drilldown.ts` (moved, Transacties unchanged in behaviour), the category, Gespaard and account sheets on Overzicht with the URL state, vitest.
3. **Sonnet**: `analysis/screens/overzicht.md` (the deviation), `analysis/concepts/design-system.md` (the motion tokens, the sheet and the panel), `docs/local-testing.md` (open each sheet at 375 px and each panel at 1280 px, Back closes it, reduced motion).
4. Lead: the manual motion check above.

## Tests (vitest)
- Motion: the token test above; `Sheet` adds `sheet--closing` and calls `onClose` after the animation (fake timers); with `matchMedia('(prefers-reduced-motion: reduce)')` mocked to match, the reduced class and the short timer; Escape and backdrop close; focus returns to the opener after closing; with `useIsDesktop` mocked true the Overzicht sheet renders as `.panel` (`variant="panel"`), false as `.sheet`, and a change of the mocked media query switches it while it stays open; the pickers stay centred dialogs on desktop.
- Overzicht: a category row sets `?blad=categorie-2` and the sheet's request is exactly `api.transactions` with the drill-down's query (`category=2`, `from`, `to`, the account or scope), the same object `drillQuery` gives Transacties for the "Open in Transacties" URL; "Meer laden" passes `before`; the totals line; Back (history pop) closes the sheet; the account sheet shows the per-account figures without a request and "Alleen deze rekening tonen" sets the filter; the Gespaard tile opens `?blad=gespaard` with `category=saved`.
- Transacties after the move: its existing tests unchanged and green.

## Who builds it
- **Sonnet**: steps 1–3 from this file. **Lead**: step 4.

## Done when
Every sheet in the app slides up with a slow start and a small overshoot (fade only with reduced motion), and on Overzicht a category, the Gespaard tile and an account open a sheet with exactly the rows or figures behind them, closed by Back.
