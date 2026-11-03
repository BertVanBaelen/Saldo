# 0.1-3 · Planning

| | |
|---|---|
| Version | [0.1 Mockup](README.md) |
| Status | done (3 Nov 2026) |
| Size | L |
| Features | UI-2 |
| Concepts | [forecast](../../analysis/concepts/forecast.md), [recurring-item](../../analysis/concepts/recurring-item.md), [planned-item](../../analysis/concepts/planned-item.md), [budget](../../analysis/concepts/budget.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [scope](../../analysis/concepts/scope.md) |
| Screens | [planning](../../analysis/screens/planning.md) |
| Design boards | Telefoon-Planning, Desktop-Planning |
| Depends on | [0.1-1](01-foundation-and-start.md) |

## Goal
The screen that answers the core question: how does each coming month end, per account.

## Steps
1. Summary on top (opens Budget), tabs Kalender · Maanden · Terugkerend · Eenmalig · Budget, `planning.html#<tab>`.
2. Kalender: month grid with day states, daily balance chart per account with zones, drag to pick a day, day card, plan-an-item form with end-of-day preview.
3. Maanden with horizon 3 / 6 / 12 / 24 and the per-month breakdown.
4. Terugkerend (to confirm, confirmed), Eenmalig, Budget with month switcher and category budgets.

## Done when
All five tabs work on phone and desktop with the demo story: dip below zero on the 1st, January in the buffer, February red. ✔

## Open questions found (resolved 3 Nov 2026)
- Maanden added both accounts together in Alles (combined buffer € 1.500): not allowed. Every account has its own months and buffer (decision "Accounts are independent", applied in 0.1-6).