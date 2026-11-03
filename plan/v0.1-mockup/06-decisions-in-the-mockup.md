# 0.1-6 · Decisions of 3 November in the mockup

| | |
|---|---|
| Version | [0.1 Mockup](README.md) |
| Status | done (3 Nov 2026) |
| Size | M |
| Features | UI-6 |
| Concepts | [scope](../../analysis/concepts/scope.md), [account](../../analysis/concepts/account.md), [forecast](../../analysis/concepts/forecast.md), [budget](../../analysis/concepts/budget.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [notification](../../analysis/concepts/notification.md), [authentication](../../analysis/concepts/authentication.md), [app-shell](../../analysis/concepts/app-shell.md), [demo-data](../../analysis/concepts/demo-data.md) |
| Screens | [start](../../analysis/screens/start.md), [overzicht](../../analysis/screens/overzicht.md), [planning](../../analysis/screens/planning.md), [rekeningen](../../analysis/screens/rekeningen.md), [meer](../../analysis/screens/meer.md), [meldingen](../../analysis/screens/meldingen.md), [emails](../../analysis/screens/emails.md), [pushmeldingen](../../analysis/screens/pushmeldingen.md) |
| Analysis | 4.5, 4.9, 5.3, 7, 11 (decisions of 3 Nov 2026) |
| Depends on | [0.1-5](05-emails-and-push.md) |

## Goal
Bring the existing mockup screens in line with the review of 3 Nov 2026.

## Steps
1. **Accounts are independent:** every current account has its own summary, chart, months, buffer, warnings and free-to-spend; the scope switch is a filter. Account names replace "Persoonlijk" wherever it was used as a unit (`js/data.js`, Start, Planning, push texts).
2. **Sums as information:** the Start hero, the spending card and Overzicht show sums labelled as information, with the per-account figures; Planning's combined Maanden and buffer pill become per account.
3. Account colours wherever the account itself is shown.
4. Meldingen in the desktop sidebar's Beheer group; a new notification type "Nieuw toestel aangemeld".
5. Demo story: 12 days to the consent expiry (14-day reminder sent on 16 November), 4 transactions to categorise.
6. Mockup demo states: a picker in Meer and `?demo=` / `?scope=` in the URL; offline banner in the shell; pages without navigation for sign-in.

## Done when
No screen adds buffers or states of different accounts together, and every demo state can be opened. ✔