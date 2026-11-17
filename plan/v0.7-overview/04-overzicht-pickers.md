# 0.7-4 · Overzicht: custom range, account filter, deep links

| | |
|---|---|
| Version | [0.7 Overview](README.md) |
| Status | released (0.7.0), verifying |
| Size | S |
| Features | OVER-1 |
| Concepts | [period-overview](../../analysis/concepts/period-overview.md), [scope](../../analysis/concepts/scope.md) |
| Screens | [overzicht](../../analysis/screens/overzicht.md) |
| Depends on | [0.7-3](03-overzicht-screen.md) |

## Goal
"Eigen" picks any range of months, the account chip narrows Overzicht to one account, and both open from a link.

Design reference: `finance-mockup/js/screens/overzicht.js` (`eigenInner`, `accountsInner`, `openPanel`, `pickMonth`, `readLink`) and the `.ov-pop`, `.ov-sheet`, `.ov-month`, `.ov-opt` rules of `css/screens/overzicht.css`. Reuse the app's `Sheet` component on the phone (as Transacties does) and an anchored popover on desktop (≥ 1024 px); Escape and a click outside close it and focus returns to the trigger.

## Steps
1. **Account picker** ("Rekening", sub "Alle rekeningen die je ziet" / "Je persoonlijke rekeningen" / "Je gedeelde rekeningen"): "Alle rekeningen" (sub "N rekeningen · samen, ter info", or the one account's name), then every `current` account of the scope with its icon and "Persoonlijk · alleen jij" or "Gedeeld · met {other members}"; the chosen one has a check; note "Spaarrekeningen staan er niet bij: wat je erheen overschrijft, telt als gespaard." (The mockup text; beleggingsrekeningen are left out too.) Picking writes `?rekening=` (or removes it) and closes.
2. **Range picker** ("Eigen periode", "Kies de eerste en de laatste maand"): the two ends "Van" / "Tot en met" (`aria-pressed` on the end being chosen), presets "Laatste 3 maanden" (the running month and the two before), "Dit jaar" (January or `firstMonth` … the running month), "Hele geschiedenis"; one 12-button grid per year from `firstMonth`'s year to today's; months before `firstMonth` are disabled ("…, geen gegevens"), months after the running one too ("…, nog niet"); the status line "4 maanden · november loopt nog"; note "Gegevens vanaf november 2025. Oudere geschiedenis? CSV importeren"; "Annuleren" and "Toepassen". Picking follows `pickMonth` of the mockup (first click sets Van and moves to Tot, a month before Van moves Van). Toepassen writes `?periode=eigen&van=YYYY-MM&tot=YYYY-MM`. The default range when none is set: the last 4 months up to the running one.
3. **Deep links**: `#eigen` opens the range picker, `#rekening` the account picker, once after the first render (`?periode`, `van`, `tot`, `rekening` are read by 0.7-3). Invalid `van`/`tot` (malformed, `tot` before `van`, outside the history) fall back to the default range.
4. `docs/local-testing.md`: the two pickers and the deep links.

## Tests
- vitest `lib/reports.test.ts`: `pickMonth` (the three cases), `presets(firstMonth, today)` for the demo and for `firstMonth = 2026-10` ("Dit jaar" starts at October), `monthState(ym, firstMonth, today)` (enabled / "geen gegevens" / "nog niet"), the status text with and without the running month.
- vitest `pages/Overzicht.test.tsx`: the account chip opens a dialog with the two demo accounts; picking Gedeelde rekening requests `account=4` and puts `rekening=4` in the URL; the Eigen button opens the range picker, a preset plus "Toepassen" gives four columns with the running one; Escape closes and focuses the trigger; `#rekening` opens the account picker on load; on a phone-width `matchMedia` mock the picker renders in the sheet.

## Who builds it
- **Sonnet**: all of it, from the mockup functions named above.

## Done when
Both pickers work as in the mockup on phone (bottom sheet) and desktop (popover), with the keyboard, and every state is reachable from a URL.
