# 0.8.1-6 · Start and Maanden: the month's result and its lowest point

| | |
|---|---|
| Version | [0.8.1 Improvements](README.md) |
| Status | planned |
| Size | S |
| Items | 1, 3 |
| Concepts | [forecast](../../analysis/concepts/forecast.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md) |
| Screens | [planning](../../analysis/screens/planning.md), [start](../../analysis/screens/start.md) |
| Depends on | – (`PlanMonth.start`, `end`, `low` are on the wire since 0.8-4) |
| Files | `web/src/lib/planningMonths.ts`, `web/src/lib/planning.ts` (+ tests), `web/src/pages/PlanningMaanden.tsx`, `PlanningMaanden.css`, `StartForecast.tsx`, `styles/components.css` (`.fc-*`), `analysis/screens/{planning,start}.md` |

## Goal
Item 1 (user answer 19 Nov 2026): keep the grey number, the end-of-month balance. The coloured chip becomes the month's **result** = end − start (= income − out − saved): from € 1.000 to € 800 is a red "−€ 200", a gain a green "+€ X". The buffer state (rood / in de buffer / boven buffer) stays visible without that chip. Item 3: more emphasis on the lowest level of the month.

Where today: Start's "Komende maanden" shows under each bar the end (`.fc-end`, `--muted`) and `resultLabel` = end − buffer ("+€ 307", coloured by state); the Maanden card's chip is `monthChip` = |left| "over" / "onder buffer" / "rood". `low` is unused.

## Rules (one helper each, `lib/planningMonths.ts`)
- `monthResult(m) = m.end − m.start` (the identity `start + income − out − saved = end` makes it income − out − saved; savings lower it, user answer). Text `eur(result, true)`: "+€ 183,30", "−€ 118,96", "€ 0,00". Colour: `--greenText` on `--soft` when > 0, `--negText` on `--negSoft` when < 0, `--muted` at 0. In the running month `start` is the real end of last month, so the result covers the whole month (past days actual).
- `stateLabel(state)`: "boven buffer" / "in de buffer" / "rood" (the words of the design's impact card). The state keeps coming from the **end** (0.8 decision 14).
- `lowLine(m, today)`: "Laagste punt 1 nov · −€ 431,45", coloured by `m.low.state` (`--neg` red, `--warn` buffer, `--muted` ok); the whole month's low, past days included (*default*, README question). Shown only when `low.balance < end` (a month whose lowest point is its end has nothing to add).

### Maanden card (phone and desktop row)
- Chip → `monthResult` (replaces `monthChip`).
- **Buffer state**: the card keeps its tone background and border (`--warnSoft`/`--negSoft`, today) and gets a small state label next to the name ("in de buffer" in `--warn`, "rood" in `--neg`; nothing for "boven buffer", the calm default), and a 4 px left accent bar in the state colour (`--green` ok, `--warn`, `--neg`).
- **Low line** (item 3) on its own line under the summary, bold when its state is worse than the end's state (a red dip inside a month that ends ok: the case the user wants to see). Desktop row grid 158 / 1fr / 112 / 172 becomes 158 / 1fr / 112 / 112 / 120 (name, summary + low, end, result, state).
- Breakdown: after "Eindsaldo" a line "Resultaat deze maand" with the result, and "Laagste punt" with date and amount; the result bar ("Over" / "Onder buffer" / "Tekort") stays: it is the buffer verdict.
- `aria-label` of a card/row: "November, lopend: begint op € 1.023,55, eindigt op € 1.206,85, resultaat +€ 183,30, boven buffer, laagste punt −€ 431,45 op 1 november."

### Start "Komende maanden"
- Under each bar: month; end balance (grey, unchanged); `monthResult` coloured as above. It replaces `resultLabel` of `lib/planning.ts` (Start's "+€ 307", removed); `resultLabel` of `lib/planningMonths.ts` (the breakdown's result bar "Over" / "Onder buffer" / "Tekort") stays.
- **Buffer state by the bar's colour**: `ok` the account colour (today), `buffer` `--warn`, `red` `--neg` (red bars already go below the zero line). The legend's three swatches then describe the bars (texts unchanged). The buffer line stays.
- `chartLabel` adds the result: "november € 1.207, +€ 183 deze maand, boven buffer".

## Steps
1. **Sonnet**: the helpers with vitest; Maanden card, row and breakdown; Start's labels and bar colours; `analysis/screens/planning.md` and `start.md` deviation notes (chip = month result, state label, accent, low line).

## Tests (vitest, the demo forecast fixture; numbers from 0.8-3)
- Zichtrekening results: November +€ 183,30 (120685 − 102355), December −€ 118,96 (108789 − 120685), January −€ 452,96 (63493 − 108789), February −€ 1.768,96 (−113403 − 63493); Gedeelde rekening November +€ 99,55 (62882 − 52927).
- State labels: Zichtrekening November none (ok), January "in de buffer", February "rood"; accent colours accordingly.
- Low lines: November "Laagste punt 1 nov · −€ 431,45" in `--neg` and bold (end ok, low red); December "Laagste punt 1 dec · −€ 278,40"; January "1 jan · −€ 397,36"; Gedeelde rekening November no low line (its low is its end, 62882 on 30 November).
- Start (horizon 3): November bar in the account colour with "€ 1.207" grey and "+€ 183" green; January bar `--warn` with "−€ 453"; the legend unchanged.
- The breakdown of February has "Resultaat deze maand −€ 1.768,96" and still "Tekort · je staat rood".

## Who builds it
- **Sonnet**: all of it.

## Done when
Every month on Start and in Maanden says how much it wins or loses, still shows its end balance in grey and its buffer state by colour and label, and shows its lowest point when that is below the end.
