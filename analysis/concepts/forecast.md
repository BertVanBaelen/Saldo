# Forecast (months and daily line)

Analysis: 1, 4.5, 5.3, risk 12 · Screens: [planning](../screens/planning.md), [start](../screens/start.md) ("Komende maanden", alerts) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.7-4](../../plan/v0.7-planning/04-forecast-engine.md), [0.7-5](../../plan/v0.7-planning/05-free-to-spend.md), [0.7-6](../../plan/v0.7-planning/06-planning-screen.md), [0.8-3](../../plan/v0.8-notifications/03-triggers-and-scheduler.md)

## The core question
"Will I have enough money at the end of each coming month, and how much is left or short?"

## Month formula (per group)
```
projected_end(m) = projected_end(m-1)
                 + confirmed_recurring_income(m)
                 - confirmed_recurring_expenses(m)
                 - variable_expenses(m)
                 + one_off_planned(m)          # signed
                 - saved(m)
                 - transfers_out(m) + transfers_in(m)   # only those that leave or enter the group

left_or_short(m) = projected_end(m) - buffer(group)
```
Start balance: latest bank balance of every account in the group (manual: last manual balance). Only current accounts count.

## Daily line (calendar)
`balance(d) = balance(d-1) + items expected on day d - variable spending of day d`. Variable spending is spread evenly over the days (current month: remaining budget over the remaining days). The lowest point of the month is shown.

## Horizon
Default 3 months, extendable to 6, 12 or 24 (tab "Maanden").

## Demo values (end of month, cents)
| Group | nov | dec | jan | feb |
|---|---|---|---|---|
| Persoonlijk (buffer 90000) | 126544 | 116047 | 72150 | −103347 |
| Gedeelde rekening (buffer 60000) | 64686 | 64686 | 64686 | 64686 |

January is € 179 under the personal buffer (yearly family insurance € 684). February is −€ 1.033 (car repair € 2.000).

Exact month ends (personal): € 1.265,44 · € 1.160,47 · € 721,50 · −€ 1.033,47. November starts at € 1.020,41 (personal) and € 646,86 (shared); the personal account drops to −€ 448 on 1 November, after rent and the contribution, until the salary arrives on the 2nd. Extra demo items: Kerstcadeaus −€ 350 in December, Zomervakantie −€ 1.500 in July 2027.

## Daily line as designed (Planning, Kalender)
- Variable spending per day: already spent ÷ 18 up to today, remaining budget ÷ remaining days after today, full month budget ÷ days in later months.
- Y scale: min(values, 0) to max(values, buffer) plus 8 % padding. Past part solid, future dashed; dots on today, the selected day and the lowest point.
- Sentences: "Op 1 november stond je € 448 rood, tot het salaris binnenkomt.", "Je blijft de hele maand boven je buffer van € 600.", "Vanaf 10 februari sta je rood. Je eindigt de maand € 1.033 rood. Schuif een uitgave op of verlaag een budget."
- Full spec: [planning](../screens/planning.md#design-notes).

## In the design ("Komende maanden" on Start)
- One bar chart per group, 4 columns ("nov · nu", "dec", "jan", "feb"). Bars 40 px wide, positive in the group colour (`--green` / `--shared`) with radius 6 6 2 2, negative in `--neg` below a solid zero line, a dashed buffer line in `--text` at 75 % opacity.
- Under each bar: month, end balance (Mono 12, neg in `--neg`), and the result vs buffer: "+€ 365" in `--greenText`, "−€ 178" in `--warn`, "rood" in `--neg`.
- Legend: Boven buffer / Onder buffer / Rood: negatief saldo.
- Chart height 84 px in Alles, 124 px for a single group. Each chart has an `aria-label` that reads all values.
