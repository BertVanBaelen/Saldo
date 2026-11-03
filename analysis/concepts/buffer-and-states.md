# Buffer and states

Analysis: 4.5, 4.9, 5.3, decision "States" · Screens: all money screens, [emails](../screens/emails.md), [pushmeldingen](../screens/pushmeldingen.md) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.1-4](../../plan/v0.1-mockup/04-rekeningen-meer-meldingen.md), [0.1-5](../../plan/v0.1-mockup/05-emails-and-push.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.3-4](../../plan/v0.3-bank-sync/04-rekeningen-and-manual-accounts.md), [0.3-5](../../plan/v0.3-bank-sync/05-start-balances.md), [0.6-4](../../plan/v0.6-shared-accounts/04-scope-and-sums.md), [0.8-4](../../plan/v0.8-planning/04-forecast-engine.md), [0.8-6](../../plan/v0.8-planning/06-planning-screen.md), [0.9-1](../../plan/v0.9-notifications/01-email-templates.md)

## Buffer
A minimum balance per **current** account (cents), set under Rekeningen in whole euros with a € 50 stepper. Every current account has its own buffer; buffers are never added up for a verdict ([scope](scope.md)). Savings accounts have none. Rekeningen may show the sum over all current accounts (demo € 1.500), labelled as information. Help text: "Komt deze rekening onder dit bedrag, dan kleurt de planning geel. Onder € 0 wordt ze rood."

## States
| State | When | Colour | Severity | Dutch |
|---|---|---|---|---|
| ok | balance ≥ buffer | green (`--green`, `--greenText`, `--soft`) | info | "Boven buffer", "Over" |
| in the buffer | 0 ≤ balance < buffer | ochre (`--warn`, `--warnSoft`, `--warnChip`) | warning | "In de buffer", "Onder buffer", "bufferzone" |
| below zero | balance < 0 | red (`--neg`, `--negText`, `--negSoft`) | error | "Rood", "Tekort" |

The same colours are used in the app, the emails and the push notifications.

## Where states show
- Start hero chip for one account ("Boven buffer", "In de buffer", "Rood"); with several accounts in view a count of per-account states ("1 rekening vraagt aandacht", "Alle rekeningen boven buffer"), never a state of the sum.
- Start alerts: red alert "X staat rood in februari" and warn alert "X zakt in de buffer in januari", both link to Planning.
- Forecast bars, month cards, calendar days and chart zones in Planning, per account. With several accounts in view a calendar day takes the worst state of those accounts.
- Notifications "Rekening staat rood" and "Rekening komt in de buffer".

## Labels in Planning
Day chips: Vandaag, Geboekt, Verwacht, Onder buffer, Negatief. Month cards: "… over", "… onder buffer", "… rood". Result bar: "Over", "Onder buffer", "Tekort · je staat rood".

## Alert component
Row link, padding 10×12, radius 16. Left a 36 px circle with a triangle-warning icon: red = `--neg` circle with `--onNeg` stroke on `--negSoft`; warn = `--warnChip` circle with `--warn` stroke on `--warnSoft`. Title 14/600, note muted on the next line.
