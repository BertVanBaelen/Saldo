# 0.1-7 · Missing designs and states

| | |
|---|---|
| Version | [0.1 Mockup](README.md) |
| Status | stopped (3 Nov 2026): the rest is designed in the React app |
| Size | L |
| Features | UI-4 |
| Concepts | [authentication](../../analysis/concepts/authentication.md), [bank-connection](../../analysis/concepts/bank-connection.md), [account](../../analysis/concepts/account.md), [shared-account](../../analysis/concepts/shared-account.md), [category](../../analysis/concepts/category.md), [categorisation-rule](../../analysis/concepts/categorisation-rule.md), [import](../../analysis/concepts/import.md), [user-and-visibility](../../analysis/concepts/user-and-visibility.md), [internal-transfer](../../analysis/concepts/internal-transfer.md), [recurring-item](../../analysis/concepts/recurring-item.md), [planned-item](../../analysis/concepts/planned-item.md), [budget](../../analysis/concepts/budget.md), [period-overview](../../analysis/concepts/period-overview.md), [notification](../../analysis/concepts/notification.md), [demo-data](../../analysis/concepts/demo-data.md) |
| Screens | [inloggen](../../analysis/screens/inloggen.md), [bank-koppelen](../../analysis/screens/bank-koppelen.md), [rekeningen](../../analysis/screens/rekeningen.md), [categorieen](../../analysis/screens/categorieen.md), [importeren](../../analysis/screens/importeren.md), [instellingen](../../analysis/screens/instellingen.md), [transacties](../../analysis/screens/transacties.md), [start](../../analysis/screens/start.md), [overzicht](../../analysis/screens/overzicht.md), [planning](../../analysis/screens/planning.md), [meldingen](../../analysis/screens/meldingen.md), [emails](../../analysis/screens/emails.md), [pushmeldingen](../../analysis/screens/pushmeldingen.md) |
| Design boards | none: designed directly in the mockup, in the style of the canvas |
| Depends on | [0.1-6](06-decisions-in-the-mockup.md) |

## Goal
Design every screen and state that the canvas does not have, so every flow of version 1 can be clicked through.

## Outcome
On 3 Nov 2026 the work in plain HTML/JS was stopped (decision "Build the real app"): every further screen is built in the React app. What the mockup holds now is a design reference:

| Screen | In the mockup | Still to do, in the React phase that builds it |
|---|---|---|
| Inloggen (`inloggen.html`) | every step and state | design notes; dark mode check (0.2-4) |
| Bankkoppelingen (`bankkoppelingen.html`) | list, wizard, join, sync, errors | design notes; dark mode, states verouderd, fout, offline (0.2-6) |
| Account detail (`rekening.html`), add account | detail, Leden, Synchronisatie, manual balance, add chooser | design notes; states and dark mode (0.3-4) |
| Categorieën en regels (`categorieen.html`) | tree, rules, editor, suggestions | design notes (0.4-4) |
| Transacties extras | filters, split, transfer, rule links, states | design notes; dark mode (0.3-3, 0.4-3) |
| Importeren (`importeren.html`) | written, never opened in a browser | check and finish (0.3-6, 0.5-2) |
| Instellingen (`instellingen.html`) | every section | design notes; dark mode (0.2-4, 0.2-6) |
| Start and Overzicht states | empty, stale, failed, read-only, offline; custom range, account filter | Overzicht design notes (0.7-2) |
| Planning | as on the canvas (the per-account rewrite was stopped and reverted) | per-account months, buffers and summary, budget, recurring and planned-item edit forms (0.8-2, 0.8-3, 0.8-6) |
| Meldingen, e-mails, push | new-device type, tenth e-mail, iPhone preview | design notes (0.9-4) |

Decisions made while designing are recorded in the screen phases that build them (password rules, rate limits, demo values).

## Done when
Stopped. The remaining designs are part of the React phases listed above.