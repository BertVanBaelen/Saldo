# Forecast (months and daily line)

Analysis: 1, 4.5, 5.3, risk 12 · Screens: [planning](../screens/planning.md), [start](../screens/start.md) ("Komende maanden", alerts) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.8-3](../../plan/v0.8-planning/03-forecast-engine.md), [0.8-4](../../plan/v0.8-planning/04-forecast-api-and-start.md), [0.8-5](../../plan/v0.8-planning/05-planning-kalender.md), [0.8-6](../../plan/v0.8-planning/06-maanden-and-budget.md), [0.9-3](../../plan/v0.9-notifications/03-triggers-and-scheduler.md)

## The core question
"Will I have enough money at the end of each coming month, and how much is left or short?"

## Month formula (per current account)
```
projected_end(m) = projected_end(m-1)
                 + confirmed_recurring_income(m)
                 - confirmed_recurring_expenses(m)
                 - variable_expenses(m)
                 + one_off_planned(m)          # signed
                 - saved(m)
                 - transfers_out(m) + transfers_in(m)   # only those that leave or enter the group

left_or_short(m) = projected_end(m) - buffer(account)
```
Start balance: the latest bank balance of the account (manual: last manual balance). Only current accounts have a forecast. Every account is calculated on its own; `transfers_out` / `transfers_in` are the recurring transfers to and from your other accounts, for example the contribution to the shared account ([scope](scope.md)).

## Daily line (calendar)
`balance(d) = balance(d-1) + items expected on day d - variable spending of day d`. Days before today in the running month are the **actual** end-of-day balances, reconstructed from the latest bank balance and the booked rows; from tomorrow on variable spending is spread evenly (running month: the rest of the budgets over the remaining days; later months: the month's budgets and averages over all days). Pending rows, recurring items up to 7 days late and plans for today land on tomorrow. The lowest point of the month is shown. Full rules: plan [0.8-3](../../plan/v0.8-planning/03-forecast-engine.md).

The forecast is the same for every member of an account: it reads only the account's own rows, categories, items, budgets and planned items, never the per-viewer transfer detection (plan 0.8 decision 2). Variable spending is learned from expense categories that are not saving categories, without the rows matched to a recurring item; uncategorised rows are not forecast.

## Horizon
Default 3 months, extendable to 6, 12 or 24 (tab "Maanden").

## Demo values (end of month, cents)
Mockup:

| Account | nov | dec | jan | feb |
|---|---|---|---|---|
| Zichtrekening (buffer 90000) | 126544 | 116047 | 72150 | −103347 |
| Gedeelde rekening (buffer 60000) | 64686 | 64686 | 64686 | 64686 |

The app with the demo story and the seed of plan 0.8-1 (golden numbers of 0.8-3; same states, other amounts, see [planning](../screens/planning.md#demo-values)):

| Account | nov | dec | jan | feb |
|---|---|---|---|---|
| Zichtrekening (buffer 90000) | 120685 | 108789 | 63493 (buffer) | −113403 (red) |
| Gedeelde rekening (buffer 60000) | 62882 | 72837 | 82792 | 92747 |

January is under the Zichtrekening's buffer because of the yearly family insurance (€ 684, a hand-added item); February is red from the 10th because of the car repair (€ 2.000, planned). The Zichtrekening dips below zero on 1 November (rent and the contribution leave on the 1st, the salary arrives on the 2nd): −€ 448 in the mockup, −€ 431,45 in the story. Extra demo items: Kerstcadeaus −€ 350 on 20 December, Zomervakantie −€ 1.500 in July 2027, Belastingteruggave +€ 680 in August 2027.

## Daily line as designed (Planning, Kalender)
- Y scale: min(values, 0) to max(values, buffer) plus 8 % padding. Past part solid, future dashed; dots on today, the selected day and the lowest point.
- Sentences: "Op 1 november stond je € 448 rood, tot het salaris binnenkomt." (the app drops "tot het salaris binnenkomt", which was written for the demo), "Je blijft de hele maand boven je buffer van € 600.", "Vanaf 10 februari sta je rood. Je eindigt de maand € 1.033 rood. Schuif een uitgave op of verlaag een budget."
- Full spec: [planning](../screens/planning.md#design-notes).

## In the design ("Komende maanden" on Start)
- One bar chart per current account, titled with the account name, 4 columns ("nov · nu", "dec", "jan", "feb"). Bars 40 px wide, positive in the account's colour (demo `--green` / `--shared`) with radius 6 6 2 2, negative in `--neg` below a solid zero line, a dashed buffer line in `--text` at 75 % opacity.
- Under each bar: month, end balance (Mono 12, neg in `--neg`), and the result vs buffer: "+€ 365" in `--greenText`, "−€ 178" in `--warn`, "rood" in `--neg`.
- Legend: Boven buffer / Onder buffer / Rood: negatief saldo.
- Chart height 84 px with several accounts in view, 124 px for a single account. Each chart has an `aria-label` that reads all values.
