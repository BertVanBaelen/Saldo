# 0.8.1-8 · "Planning instellen": budgets, recurring and one-off items in one screen

| | |
|---|---|
| Version | [0.8.1 Improvements](README.md) |
| Status | planned (design: canvas page "IMP: Planning instellen", boards Telefoon-Planning-Instellen and Desktop-Planning-Instellen, 19 Nov 2026) |
| Size | L |
| Items | 2 |
| Concepts | [budget](../../analysis/concepts/budget.md), [recurring-item](../../analysis/concepts/recurring-item.md), [planned-item](../../analysis/concepts/planned-item.md), [scope](../../analysis/concepts/scope.md) |
| Screens | [planning](../../analysis/screens/planning.md) (a new section "Planning instellen") |
| Depends on | [0.8.1-6](06-month-change-and-low.md) (`stateLabel`, shared helpers in `lib/planningMonths.ts`), [0.8.1-2](02-budget-reference.md) step 1 (the `average` field); no other server change |
| Files | new `web/src/pages/PlanningInstellen.tsx` (+ css, test), new `web/src/lib/planningImpact.ts` (+ test), `Planning.tsx`, `planningTabs.ts`, `PlanningBudget.tsx`, `PlanningTerugkerend.tsx` and `PlanningEenmalig.tsx` (their bodies move into sections), `PlanningItemForm.tsx`, `PlanningBudgetEditor.tsx` (removed), the router, `Planning.test.tsx`, `PlanningTerugkerend.test.tsx`, `PlanningEenmalig.test.tsx`, `PlanningBudget.test.tsx` |

## Goal
Item 2 (user answer 19 Nov 2026): "instellingen planning zouden duidelijker moeten zijn" means the design page "Planning instellen". Today the settings are spread over five Planning tabs (budgets edited by tapping a row of the Budget tab, Terugkerend and Eenmalig as tabs). The design gives them one screen of their own; Planning keeps three tabs: **Kalender, Maanden, Budget**.

## Navigation and URLs
- Route `/planning/instellen`, state in the URL: `?rekening=<id>` (the selected account) and the section in the hash `#budgetten` (default), `#terugkerend`, `#eenmalig`.
- Opened from a **cog** button at the top right of Planning (`aria-label="Planning instellen"`; desktop: same place, Planning stays selected in the sidebar) and from **"Aanpassen"** next to the category budgets of the Budget tab (opens `#budgetten` on that account). "‹ Planning" top left goes back (history back when it came from Planning, else `/planning`). Title "Planning instellen" (h1 26 px).
- **Old links**: `/planning#terugkerend` and `/planning#eenmalig` redirect (replace) to `/planning/instellen#terugkerend` / `#eenmalig`, keeping `?maand` out. `#kalender`, `#maanden`, `#budget` and the alerts' `/planning?maand=…#maanden` are unchanged. Bijdragen's "Bekijk de berekening" (`#budget`) is unchanged. Eenmalig's "Op een dag in de kalender zetten" opens `/planning?maand=<running>#kalender`.
- `PlanningTabId` loses `terugkerend` and `eenmalig`; `TABS` has three entries.

## Account tiles (the design's "Persoonlijk" / "Gedeeld")
The design shows two fixed tiles because the demo has one personal and one shared account. In the app: **one tile per current account in the app-wide scope** (0.8 rule: budgets, items and planned items belong to an account), grouped under the labels "Persoonlijk" and "Gedeeld" when both occur. Tile: icon in the account colour, account name, the scope label as sub ("Persoonlijk" / "Gedeeld"), "€ 938 per maand" (Σ of the account's category budgets in the list below). Selected: `--soft`/`--sharedSoft` fill and a 2 px border in `--green`/`--shared`. Phone: two tiles per row, more wrap; desktop: one row. With one account in scope: one tile, no choice to make. The note under the tiles, with the design's words adapted to accounts: "Elke rekening staat helemaal los. Elke rekening heeft haar eigen budgetten, ook voor dezelfde categorie, en haar eigen vaste en eenmalige posten." No sum over tiles anywhere.

## Sections (3-part segmented control "Budgetten (n) · Terugkerend (n) · Eenmalig (n)", counts of the selected account)
### Budgetten
- **"Effect op de planning · laagste maand tot <laatste maand>"** card: the account's lowest month end over the forecast in view (horizon 3: the running month + 3, "tot februari"), its value and the chip "rood" / "in de buffer" / "boven buffer" (`stateLabel`), and "zoals nu" or "€ 40 minder" / "€ 40 meer" against the saved state. Recomputed **live** while −/+ are pressed, by `planningImpact.ts` (below), and from the server's answer once saved.
- One card with a row per category **with a budget** on this account: colour dot, name, − and + (€ 10 steps, `aria-label` "€ 10 minder" / "€ 10 meer", 44 px targets), the amount (Mono), a 6 px bar of spent this month / budget (`--neg` when over), the note "€ 66 besteed deze maand · gemiddeld € 40" (`spent` and the new `average` of the running month's `budgets` in `GET /api/planning`, added by 0.8.1-2). Line "Totaal per maand € 938".
- **Saving** (*default*, README question 5): each −/+ updates the screen at once and saves after 800 ms without a press (`PUT /api/planning/budgets`, `fromMonth` = `?maand` when the screen was opened with one from the Budget tab's "Aanpassen", else the running month, as 0.8-6's "from the month shown"), then reloads the forecast; a toast "Budget Vrije tijd: € 360 vanaf november". A `?maand` other than the running month shows the line "Geldt vanaf februari 2027 en de maanden erna." "Terugzetten" appears once something changed since the screen opened and restores the account's **whole budget row set** of that moment (`GET /api/planning/budgets` read at open). `PUT` refuses a `fromMonth` before the running month (`ledger/planning.go:472`), so per changed category: one `PUT` with `fromMonth` = the running month and the amount **in effect** in the running month at open (the row with the greatest `from_month` ≤ running, or `null`), then one `PUT` per saved row with a later `from_month`, in order. Rows before the running month were never touched by the edit. Offline: −/+ disabled with the app's offline note.
- Dashed "Budget toevoegen" opens the list "Categorieën zonder budget" (top expense categories, not saving, without a budget row on this account), each "Gemiddeld € X per maand"; picking one creates a budget of that average rounded up to whole euros. Empty: "Alle categorieën hebben een budget."
- Footnote: "Zonder budget rekent de planning met het gemiddelde van de laatste 6 maanden. Vaste kosten zoals huur en abonnementen staan bij Terugkerend."
- Removing a budget (back to the average): "Verwijderen" in the row's overflow (`…`) menu sends `amount: null` (the design has none; the app needs 0.8-6's "Geen budget" choice).
- The Budget tab's per-category rows stop being buttons; the 0.8-6 budget editor sheet is removed.

### Terugkerend (moves from the Planning tab, 0.8-7)
- Yellow card "Gevonden · te bevestigen · n": per suggestion name, "Maandelijks · rond de 3e · 4× gezien" (`seen` of the detection suggestion), signed amount, **Bevestigen** (opens the item form prefilled, as 0.8-7) and **Negeren**.
- Lists "Inkomend" and "Uitgaand": name, rhythm ("Maandelijks · 1e", "Jaarlijks · 15 januari"), signed amount, chevron; tap opens the edit sheet. Line "Per maand +€ 3.300 in · € 1.823 uit" (quarterly ÷ 3, yearly ÷ 12, as the design). Dashed "Terugkerende post toevoegen".
- Transfers between own accounts and contributions are rows like any other, with their **stored descriptions** ("Naar gedeelde rekening", "Bijdrage Bert"); the design's per-viewer "Jouw bijdrage" is not used (0.8 decision 9).

### Eenmalig (moves from the Planning tab)
- Rows with a chip "MEI 2027" (`--warnSoft` for expenses, `--soft` for income), name, "10 februari 2027" (· "verwachte inkomst" for income), signed amount, a remove ✕ (`aria-label` "Autoherstelling verwijderen"; toast with the name). Empty: "Nog geen eenmalige posten." Dashed "Eenmalige uitgave of inkomst toevoegen"; note "Je kan een eenmalige post ook meteen op een dag in de kalender zetten."

## The edit and new sheets
Reuse `Sheet` (0.8-0c motion) and `PlanningItemForm`, restyled to the design: segmented "− Uitgave / + Inkomst" first, "Omschrijving", "Bedrag (€)", "Ritme" (Maandelijks / Per kwartaal / Jaarlijks) and "Dag van de maand" (monthly) or "Wanneer" (quarterly, yearly: day and month) for recurring; a 12-month picker starting at the running month and "Dag (leeg = ergens in de maand)" for one-offs (an empty day is a one-off spread over the month, [0.8.1-9](09-one-off-without-day.md); until 0.8.1-9 lands the day is required); "Rekening" as a fixed name (the selected tile); the validation text "Vul een omschrijving en een bedrag in."; a preview line "−€ 29,99 · maandelijks · Zichtrekening"; Verwijderen (edit only) / Annuleren / Opslaan. The engine's other kinds stay reachable: under "Uitgave" a second row "Gewone uitgave · Sparen · Overschrijving naar" (personal) or "Gewone uitgave · Sparen" (shared), under "Inkomst" "Gewone inkomst · Bijdrage" (shared) or "Gewone inkomst · Overschrijving van" (personal): they set `kind` as today (0.8-7); "Het bedrag is vast / gemiddeld", "Tegenpartij" and "Einddatum" move under "Meer opties" (collapsed, open when one is set).

## `planningImpact.ts` (pure; exact by the engine's rules)
A budget change of category c on account a from month F on changes only that account's variable spending, and `PUT` deletes the later rows (0.8-1), so from F on the plan is `new` in every month while the old plan may differ per month (W1: a 2027-01 NULL row means the average from January). Per month, with `old(m)` = that month's `budgets[c].plan` in the forecast (0 when the category is absent): Δ(m) = max(0, new − spent) − max(0, old(m) − spent) for the running month (0 when today is the month's last day: the engine drops the rest), Δ(m) = new − old(m) for later months ≥ F, 0 before F; `end'(m_i) = end(m_i) − Σ_{j ≤ i} Δ(m_j)`. The card shows the minimum of `end'` with its month and state (`fcState`'s thresholds: < 0 red, < buffer buffer). After saving, the server's answer replaces the estimate; they must be equal (test).

## Steps
1. **Sonnet**: route, cog, "Aanpassen", redirects, three tabs (`planningTabs.ts`, `Planning.tsx`), tests moved.
2. **Sonnet**: the screen shell (tiles as a `radiogroup` of `radio`s, the section control as `tablist`/`tab` with the sections as `tabpanel`s) and the Terugkerend and Eenmalig sections from the existing tab bodies. They leave the Planning `Tabs`, so they drop the `TabPanel` wrapper and the hook-free rule of `planningTabs.ts:4-7`; their tests render them without `Tabs`.
3. **Sonnet**: the Budgetten section with saving, Terugzetten, Budget toevoegen; `planningImpact.ts` with vitest.
4. **Sonnet**: the sheets in the design's layout over `PlanningItemForm`.
5. **Sonnet**: `analysis/screens/planning.md` (Planning has three tabs; the new screen; deviations: tiles per account, "Meer opties", stored descriptions, the remove menu).

## Tests (vitest, demo fixtures; numbers from 0.8-1 and 0.8-3)
- Zichtrekening tile "€ 938 per maand" (35000 + 30000 + 28798 = 93798, `eur0`); Gedeelde rekening "€ 550 per maand" (Boodschappen only; Overig runs on the average and is not a budget row).
- Impact, Zichtrekening, horizon 3, saved state: "Februari −€ 1.134,03 · rood · zoals nu". Vrije tijd + € 10 (35000 → 36000): November Δ 1000 (rest 28310 → 29310), each later month Δ 1000 → "Februari −€ 1.174,03 · € 40 minder · rood". Vervoer down to € 100 (spent 13410 > 10000): November Δ −16590, later months −20000 each → February end −113403 + 16590 + 60000 = −36813 → "Februari −€ 368,13 · € 766 meer · rood" (differences in whole euros, as the design).
- Gedeelde rekening impact: "boven buffer"; its month and value: lead derives (0.8-3 pins November 62882 only).
- After saving Vrije tijd € 360, the reloaded forecast's February end equals the estimate (−117403).
- Per-month old plan (`planningWorld` W1 budgets: Boodschappen 10000 from 2026-11, NULL from 2027-01): setting € 120 from November gives Δ 2000 in December and 12000 − average in January and later; "Terugzetten" sends 2026-11 10000 then 2027-01 `null` and the rows are as at open; with an older row (from 2026-09) in effect, it sends `fromMonth` 2026-11 with that value, never 2026-09.
- Opened with `?maand=2027-02`: `PUT` carries `fromMonth: "2027-02"`, November–January Δ 0.
- Old link `/planning#eenmalig` lands on `/planning/instellen#eenmalig`; `/planning?maand=2027-02#maanden` still opens Maanden on February.
- Read-only member (Partner on a read-only demo state): no −/+, no Bevestigen, no ✕, no dashed buttons; the lists and the impact card are shown.
- Suggestions Decathlon and Action (0.8-7 demo) show "× gezien" with their `seen`; Negeren removes the card row.

## Who builds it
- **Sonnet**: all steps from this file; the lead checks the impact goldens against the server once (step 3).

## Done when
Planning has three tabs and a cog; "Planning instellen" shows per account the budgets with their live effect on the lowest month, the recurring and one-off items, in the design's layout at 375 px and desktop, and every old link still lands somewhere sensible.
