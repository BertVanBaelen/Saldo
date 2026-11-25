# 0.9-4 · Meldingen screen

| | |
|---|---|
| Version | [0.9 Notifications](README.md) |
| Status | built 24-25 Nov 2026 (0.9.0-dev); not yet checked on the real phones (0.9-5) |
| Size | M |
| Features | NOTIF-4 |
| Concepts | [notification](../../analysis/concepts/notification.md), [design-system](../../analysis/concepts/design-system.md), [app-shell](../../analysis/concepts/app-shell.md) |
| Screens | [meldingen](../../analysis/screens/meldingen.md) |
| Depends on | [0.9-3](03-triggers-and-scheduler.md) (the model), [0.9-2](02-web-push.md) (the push card and `lib/push.ts`), [0.8-5a](../v0.8-planning/05a-ui-libraries.md) (the vendored controls in `web/src/ui`). Types of [0.9-3b](03b-bank-shared-and-transaction-triggers.md) can show before their triggers exist |
| Who | Sonnet, from this file |

## Goal
The Meldingen screen from the mockup, wired to the server, with the controls of the UI libraries, and every setting changing what is sent.

## What exists (checked 18 Nov 2026)
Meldingen is in the nav (`web/src/app/nav.ts`, group Beheer, tab parent Meer) and in Meer ("Push en e-mail, per soort"), so the sidebar work of the old plan is done. `/meldingen` renders `NotBuilt` until 0.9-2 puts the push card there. `web/src/ui` has `Switch`, `SegmentedControl`, `Badge`, `Tabs`; React Aria Components is a dependency. `users.lookahead_months` exists and has no screen. Start's alerts already follow it.

## API (docs/api.md "Notifications")
- `GET /api/notifications` → `{ channels: {email, quietHours}, lookahead, types: [{key, name, subline, group, dot, push, email, emailLocked}] }` with the defaults merged (the table of 0.9-3, so the screen never repeats defaults); the push channel state of **this device** comes from `lib/push.ts`, not from the server.
- `PUT /api/notifications` → partial update of `channels.email`, `channels.quietHours`, `lookahead` (1, 3, 6) and per-type `push`/`email` booleans; `device` e-mail cannot be turned off (`400`); unknown keys are `400`. `POST /api/notifications/test` is built in 0.9-2.
- Per-user only (viewer from the session); a row in `privacy_test.go`; the change is read by the next run of the sender (no cache).

## Steps
1. **Page and groups.** `Meldingen.tsx` (extends the card of 0.9-2): channel card (push on this device, e-mail with the user's address), groups PLANNING, BANK, GEDEELD, TRANSACTIES, **OVERZICHT** (new, [0.9-3e](03e-week-and-month-overview-notifications.md): "Weekoverzicht" with "Elke zondag om 19:00, met wat je uitgaf per categorie" and "Maandoverzicht" with "Op de laatste dag van de maand om 19:00, met je budgetten", dot `--green`, **both chips off by default**) and **BEVEILIGING** (the mockup has it, the old screen spec did not: "Nieuw toestel aangemeld", e-mail chip locked on), each row a state dot, name, subline and two chips. The `invite` type ("Uitnodiging voor een gedeelde rekening") joins GEDEELD with its subline "Als een beheerder je uitnodigt".
2. **Controls from the libraries (README decision 14).** Channel switches and Stille uren use `web/src/ui/Switch`; "Hoe ver vooruit kijken" uses `SegmentedControl` (1 maand · 3 maanden · 6 maanden); the push/e-mail chips are React Aria `ToggleButton`s restyled with the tokens (44 × 36, radius 10, `aria-pressed`, aria-label "<type> als pushmelding" / "<type> per e-mail", `--soft` fill and `--green` border on, `--line` border and `--muted` icon off, disabled at 40 % when the channel is off, the stored choice kept). Kokonut's motion only where it fits (an animated state on the chips), behind `prefers-reduced-motion`. No new package; `docs/third-party-ui.md` gets a line for the chip.
3. **Behaviour.** Push channel: the switch asks the browser for permission through `lib/push.ts` (0.9-2); with no subscription on this device the push chips are disabled and shown off, their stored values kept; on iPhone outside the installed app the instruction card replaces the switch. E-mail channel and Stille uren are saved on the server. Changes save on toggle, optimistically, with the screen's usual error toast; a failed save rolls back. "Stuur een testmelding" shows "Testmelding verstuurd naar dit toestel" or "Pushmeldingen staan uit". The note about login codes, invitations and password links stays.
4. **Desktop.** The derived layout of the screen spec (a 340 px left column with channels, Stille uren, the note and the test button; the four type groups right; DOM order channels → types → quiet hours), title 28/600 with the sub "Push en e-mail, per soort".
5. **Where the settings live elsewhere.** The footer link of every notification e-mail ("Meldingen aanpassen") lands here; Start's alert for look-ahead has no control of its own. Document in `analysis/screens/meldingen.md` that the mockup's `localStorage` store is gone.
6. **Tests.** `Meldingen.test.tsx`: every chip and switch saves and rolls back; locked and disabled states; the iPhone and blocked cards; look-ahead changes the next planning run (a server test with `planningWorld`: look-ahead 1 sends no message for a red month three months ahead, 3 does); quiet hours off lets a push through at 23:00; e-mail off silences e-mail but keeps `device`; keyboard only; 375 px and desktop, light and dark by the lead.

## Done when
Every setting is saved per user and changes what is sent; the screen uses the vendored controls and passes at 375 px and desktop in light and dark.
