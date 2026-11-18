# 0.8-5 · Planning screen: shell, summary, Kalender, plan form

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | released (0.8.0), verifying |
| Size | L |
| Features | PLAN-3, PLAN-6 |
| Concepts | [forecast](../../analysis/concepts/forecast.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [scope](../../analysis/concepts/scope.md), [planned-item](../../analysis/concepts/planned-item.md) |
| Screens | [planning](../../analysis/screens/planning.md) |
| Depends on | [0.8-4](04-forecast-api-and-start.md) (`GET /api/planning`, `lib/planning.ts`), [0.8-1](01-planning-data.md) (planned-item routes) |

## Goal
`/planning` as designed (`finance-mockup/js/screens/planning.js`, `css/screens/planning.css`) on real data: the page shell with the five tabs, the summary per account and the Kalender tab with its charts, day card and plan form. Maanden and Budget follow in 0.8-6, Terugkerend and Eenmalig in 0.8-7 (their tab panels show a short "Volgt" placeholder until then, never in a release).

## Page (`web/src/pages/Planning.tsx`, `Planning.css`, ported from the mockup's CSS with the app's tokens; `--skel`, `--skel2`, `--warnSoft`, `--warnChip`, `--negSoft`, `--negText`, `--onNeg`, `--sharedSoft`, `--track` exist)
- Route `planning` in `App.tsx` replaces `<NotBuilt id="planning" />`; remove the `planning` entry from `NotBuilt.tsx`.
- **Header**: "Planning", the scope switch, on desktop the buffer pill: per account in view "Buffer · <naam> € 900" (one row per account, never a sum, decision 1) and "Wijzigen" → `/rekeningen`; on the phone the avatar as on other pages.
- **State in the URL**: the tab in the hash (`#kalender` default, `#maanden`, `#terugkerend`, `#eenmalig`, `#budget`; the mockup's `planning.html#budget` deep link), the month in `?maand=YYYY-MM` (default the running month), the selected day in component state. Tabs: `role="tablist"` "Planning", arrow keys, Home and End, selected tab `--text` 600 with a 3 px `--green` underline.
- **Data**: one `GET /api/planning?scope&horizon&month` per scope, horizon, month and `dataVersion`; the horizon state lives here (0.8-6 uses it), the Kalender's month range is the running month to the running month + horizon (default horizon 3: four months, as the mockup's nov … feb; the user widens it in Maanden). A `?maand=` beyond it (an alert with look-ahead 6) picks the **smallest horizon of 3, 6, 12, 24 that contains it**, so the request never gets the `400`; a month beyond 24 falls back to the running month. Loading: skeletons as on Overzicht; failure: the app's `ErrorState`.
- **Summary** (top, one button per account in view; phone: a grid of columns, desktop: cards up to 470 px with a chevron): dot in the account colour, name, `left` of the month shown (Mono 18/600, `--greenText`, `--sharedText` for a shared account, `--neg` when below 0), note "vrij in november" / "tekort in november" (desktop "Vrij te besteden in …" / "Tekort in …"), a 6 px bar of the Budget tab's segments (0.8-6 adds the bar; here a plain track), `aria-label` "Zichtrekening: vrij te besteden € 306,85 in november. Open de volledige berekening." Opens `#budget`. A stale or failed account adds "Stand van <datum>" (muted, as Start's hero) from `balanceDate`; an account in `missing` shows "Nog geen saldo" and no figures.
- **Empty scope**: the empty state of the other screens ("Nog geen betaalrekening in deze weergave." with the link to Rekeningen).
- **Read-only**: no plan button and no remove buttons on an account where the viewer has Lezen (`permission` from `GET /api/accounts`); in Alles the plan form offers only accounts the viewer may edit, and no plan button when there is none.

## Kalender tab
- **Month switcher**: "November 2026", note "Vandaag is 18 november · alle rekeningen" (other months "Verwachting · persoonlijk" / "· gedeeld" / "· alle rekeningen"); prev and next disabled at the ends of the range (opacity 0.4). Phone 44 px buttons around a centred title, desktop inside the card.
- **Legends** (from the mockup): under the grid "Inkomend · Uitgaand · Gepland · Onder buffer · Negatief" (dots on the phone, + − ± on desktop); under the charts "Buffer · Nul · In de bufferzone · Onder nul". Above the charts the selected-day head "Wo 18 november · saldo" (future: "· verwacht") and, with one account in view, its balance.
- **Grid** (ma … zo): per day the state of the account(s) in view (in Alles the **worst** state, decision 1), today a green circle, past days muted, selected a 2 px `--text` border; phone dots (green in, red out, ochre planned), desktop up to two tags ("− Huur", "+ Salaris", planned in `--warn`) and "+N meer". Each cell an `aria-label` with the items, every account's balance and its state ("1 november: Huur, Naar gedeelde rekening, saldo −€ 431, negatief saldo"; Alles: "…, zichtrekening −€ 431 negatief, gedeelde rekening € 1.429"). Arrow keys move the selected day (roving tabindex): ←/→ one day, ↑/↓ seven days; Home/End to the first/last day.
- **Charts**: one per account in view (Alles: each with its own title and the selected day's balance on the right), as specified in `analysis/screens/planning.md` (zones, zero and buffer lines, past solid and future dashed, today line, selected day, lowest-point dot, axis "1 · 15 · 30"). The past part is the **actual** balance (decision 5). Stats "Begin € 1.024 · Laagste 1 nov · −€ 431 · Einde € 1.207 · Buffer € 900" (`start`, `low`, `end`, `buffer`). The sentence:
  - end < 0: "Vanaf <eerste dag van de laatste rode reeks> sta je rood. Je eindigt de maand € x rood. Schuif een uitgave op of verlaag een budget." (the first part only when that day is not the 1st);
  - else low < 0: "Op <dag> stond/sta je € x rood." plus " Je eindigt de maand € y onder je buffer." when end < buffer;
  - else low < buffer: "Op <dag> zat/zak je € x onder je buffer." plus the same ending;
  - else "Je blijft de hele maand boven je buffer van € x."
  ("stond/zat" for a day before today.) The mockup's ", tot het salaris binnenkomt" is dropped: it was hard-coded to the demo.
- **Day selection on the chart**: a transparent overlay (`touch-action: pan-y`) maps pointer x to a day; drag and click select; keyboard: the chart is one focusable `role="slider"` with `aria-valuemin` 1, `aria-valuemax` days, `aria-valuenow` the day, `aria-valuetext` "18 november, saldo € 1.968,82", arrow keys, Home, End. Hint "Schuif met je vinger over een grafiek om een dag te kiezen." (desktop "Beweeg over een grafiek om een dag te kiezen").
- **Day card**: "Woensdag 18 november" and a chip (Vandaag, Geboekt for past days, Verwacht, Onder buffer, Negatief). Rows from the day's `items`: booked rows (past and today), `pending` ("In behandeling"), `late` ("Verwacht, nog niet gezien"), `missed` (muted, struck-through amount, "Verwacht, niet gezien · niet meegeteld"), `recurring` ("Terugkerend"), `planned` (ochre dot, "Geplande uitgave" / "Verwachte inkomst", a remove button "Geplande post verwijderen: <omschrijving>" when the viewer may edit), `variable` "Dagelijkse uitgaven (schatting)"; each with the account pill in Alles. Then the dashed button "Uitgave of inkomst plannen op 18 nov" (today and later, not on past days) and "Saldo einde dag" / "Verwacht saldo einde dag", in Alles one row per account.
- **Plan form** as designed: segmented "− Uitgave" / "+ Inkomst", "Omschrijving", "Bedrag" (€ prefix, Mono, Dutch decimal comma), "Betalen met" / "Ontvangen op" (Alles: one button per editable account in its colour; otherwise a fixed chip), preview "Saldo einde dag wordt € 58,51 · onder je buffer" (that account's end of day + the amount; " · je staat rood" below 0), error "Vul een omschrijving en een bedrag in.", Annuleren · Toevoegen → `POST /api/planning/planned`, toast "Gepland op 25 nov · −€ 1.500,00", refetch. A planned item on today lands on tomorrow in the forecast (decision 5); the form says nothing about it. Selecting another day or month closes the form.

## Steps
1. **Sonnet**: route, `Planning.tsx` shell (header, scope, tabs with hash and keyboard, URL month, data loading, summary, empty and error states, read-only), `NotBuilt` cleanup, vitest.
2. **Opus**: the chart component (`PlanningChart.tsx`: scale, zones, lines, dots, drag overlay, slider semantics) and the calendar grid's keyboard model, with vitest on the geometry helpers (pure functions: scale, day from x, zone rectangles).
3. **Sonnet**: day card, plan form, remove, sentence helper (`lowText`, pure, tested with the four branches and the demo months).
4. Lead: the demo at 375 px and desktop, light and dark, keyboard only.

## Tests (vitest, with the demo answer of 0.8-4 as fixture)
- Tabs: hash in and out, arrow keys; `?maand=2027-02` opens February; `?maand=2027-05` requests horizon 6; grid ↑/↓ move a week; the legends and the selected-day head.
- Summary: Zichtrekening "€ 306,85 vrij in november", Gedeelde rekening "€ 28,82"; in February (month switcher) "Tekort" "€ 2.034,03" for the Zichtrekening; opens `#budget`.
- Calendar: 1 November red for the Zichtrekening, in Alles the cell's label names both accounts; February: 10 February first red day of the run, the sentence "Vanaf 10 februari sta je rood. Je eindigt de maand € 1.134 rood. Schuif een uitgave op of verlaag een budget."; November Zichtrekening sentence "Op 1 november stond je € 431 rood."; Gedeelde rekening "Je blijft de hele maand boven je buffer van € 600."; January "Op 1 januari sta je € 397 rood. Je eindigt de maand € 265 onder je buffer."
- Day card of 19 November: "Bol.com" "In behandeling" −€ 24,99 and "Dagelijkse uitgaven (schatting)" −€ 61,41; end of day € 1.882,42.
- Plan form: validation message, preview colours (green, `--warn`, `--neg`), the POST body, the toast, read-only account not offered.
- Chart helpers: day from x at both edges, scale with a negative minimum, the slider's `aria-valuetext`.

## Who builds it
- **Opus**: step 2. **Sonnet**: steps 1 and 3. **Lead**: step 4.

## Done when
The Kalender matches the mockup on phone and desktop with the demo, every state and sentence follows the forecast, and a planned item can be added and removed.
