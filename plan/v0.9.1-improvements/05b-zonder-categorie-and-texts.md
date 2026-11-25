# 0.9.1-5b · Budgetten: Zonder categorie, and the texts

| | |
|---|---|
| Version | [0.9.1 Improvements](README.md) |
| Status | built 25 Nov 2026; released as 0.9.1 |
| Size | M |
| Features | IMP-5 (and the texts of IMP-4) |
| Concepts | [budget](../../analysis/concepts/budget.md), [recurring-item](../../analysis/concepts/recurring-item.md) |
| Screens | [planning](../../analysis/screens/planning.md) (Planning instellen › Budgetten, the Budget tab), [overzicht](../../analysis/screens/overzicht.md) (the footnote) |
| Depends on | [0.9.1-5a](05a-budgetten-rows.md) (the strip's `AssignChange`, the screen file); wave 1 merged (this phase edits `lib/reports.ts` and `Overzicht.test.tsx`) |
| Who | Sonnet |
| Files | `web/src/pages/PlanningInstellenBudget.tsx` (+ test), `PlanningInstellen.css`, `web/src/lib/planningMonths.ts` (+ test), `web/src/pages/PlanningBudget.tsx` (+ test), `web/src/lib/reports.ts` (`BUDGET_NOTE` only), `Overzicht.test.tsx` (the note, if asserted), `analysis/screens/planning.md`, `analysis/concepts/budget.md` |

**Builder:** use the graphify skill to find dependencies before editing, and the ponytail skill: the smallest change that fully solves the phase.

## Goal
The rest of request 3 (25 Nov 2026): the account's confirmed expense items without a category are listed on Budgetten with their suggestion, can be assigned in one tap with a live preview in the "Effect op de planning" strip ("assigning keeps the total and shrinks the extra"), and every text that said recurring items are left out of a budget is rewritten.

## What exists (read 25 Nov 2026)
- After 0.9.1-5a: the strip formula takes an `AssignChange { item, from, to }` (`lib/planningImpact.ts`); the screen has the items (`PlanningInstellen.tsx:193`) with `categoryId` and `suggestedCategoryId` (0.9.1-3).
- The Budget tab: `budgetView` lists every entry under "Budgetten" with `budgetNote` ("€ x van € y al besteed", "Volledig budget € y", `lib/planningMonths.ts:135-169`); "Per categorie · deze maand" uses `categoryBar` (`:198-202`, `pages/PlanningBudget.tsx:189`, `:224`) and the note "Terugkerende posten tellen niet mee in de budgetten. …" (`PlanningBudget.tsx:246`).
- Budgetten's footnote "Zonder budget … Vaste kosten zoals huur en abonnementen staan bij Terugkerend." (`PlanningInstellenBudget.tsx:442`).
- Overzicht's `BUDGET_NOTE` says the planning counts recurring items apart (`lib/reports.ts:408-409`); it is rendered by `OverzichtSheet.tsx:18` and `Overzicht.tsx`.

## Rules
**Zonder categorie** (the account's confirmed `expense` items with `categoryId` `null`; saving items are not listed, README decision 16): title "Zonder categorie · telt in geen budget", per item: name, frequency and day, amount, and either a chip with the suggestion ("Wonen") or "Kies…".
- The chip shows the strip's live preview of the assignment (`AssignChange` from none to the suggestion's top) with "Toewijzen" / "Annuleren"; "Toewijzen" sends `PATCH /api/planning/items/{id}` `{categoryId: <suggestion>}`, toast "Huur telt nu bij Wonen", then reloads the items and the forecast (the strip then shows the engine's answer).
- "Kies…" opens the item sheet (0.9.1-3) on its category field.
- Read-only members see the list without chips or buttons. Empty: the section is left out. Offline: chips and buttons disabled as the rows' − / +.

**Texts** (decisions of IMP-4; the four text sites):
1. Budgetten footnote (`PlanningInstellenBudget.tsx:442`): "Een budget is het totaal per maand: de vaste kosten met deze categorie plus wat je daarnaast uitgeeft. Een wijziging geldt vanaf de gekozen maand. De balk toont wat je naast de vaste kosten uitgaf, tegenover het extra. Zonder budget rekent de planning met het gemiddelde van de laatste 6 maanden."
2. Budget tab note (`PlanningBudget.tsx:246`): "Een budget is het totaal per maand, vaste kosten met die categorie inbegrepen. Zonder budget rekent de planning met het gemiddelde van de afgelopen 6 maanden. Spaarcategorieën hebben geen budget."
3. `budgetNote` and `categoryBar` (`lib/planningMonths.ts`) when `recurring > 0`: running "€ 10,00 van € 5,00 extra al besteed · vast € 25,00", later months "Extra € 5,00 · totaal € 30,00"; the bar and "te veel" on the extra. With `recurring` 0 or absent the texts are today's (the existing tests stand). `budgetView` and "Per categorie" list only entries with `source === 'budget'`, `plan ≠ 0` or `spent ≠ 0` (an entry with fixed costs only is not a spending row; a budget of 0 is listed, README decision 22).
4. `BUDGET_NOTE` (Overzicht): "Budget zoals in de planning: het totaal per maand, vaste kosten inbegrepen. Zonder budget: het gemiddelde van wat je de laatste 6 maanden in deze categorie uitgaf. Hier telt alles wat in de categorie geboekt is tegenover het totaal; een vaste post telt hier bij de categorie van haar betaling, in de planning bij de categorie die je haar gaf." (README decision 24.)

**Analysis docs**: `analysis/screens/planning.md` (Planning instellen › Budgetten: stepper, Vast + Extra = Totaal, the two warnings without a helper, "Vaste kosten zonder budget", Zonder categorie, the prefill; the item sheet's category; the Budget tab's wording) and `analysis/concepts/budget.md` ("Variable spending" becomes "Budget = total": extra, the two warnings, the prefill, that a change applies from its month onward).

## Steps
1. **Sonnet**: the Zonder categorie list with the chip, the preview and "Toewijzen"; tests.
2. **Sonnet**: the four texts and the entry filter; `planningMonths.test.ts`, `PlanningBudget.test.tsx`, `Overzicht.test.tsx` (the note, if asserted).
3. **Sonnet**: the two analysis docs.

## Tests (vitest)
- Zonder categorie on the demo (Zichtrekening): Huur "Wonen", Netflix and Spotify "Abonnementen", Familiale verzekering "Kies…"; "Toewijzen" on Huur sends `PATCH {categoryId: <Wonen>}`; the preview says "zoals nu" (Wonen has no budget).
- Assigning a monthly −1000 item (suggestion Boodschappen) on an account with a Boodschappen total of 10000 and recurring 0: the preview strip moves the lowest month by +€ 10 per month after the running month (lead derives the month shown); "Annuleren" restores "zoals nu".
- A read-only member sees the list without chips.
- Budget tab: the demo's texts unchanged (recurring 0); a fixture with recurring 2500 on Vrije tijd: "€ 10,00 van € 5,00 extra al besteed · vast € 25,00"; an entry with fixed costs only (source `average`, plan 0, spent 0, recurring 80000) is not listed.
- The Budgetten footnote and `BUDGET_NOTE` read as above.

## Who builds it
- **Sonnet**: all steps.

## Done when
The account's items without a category are listed with their suggestion and can be assigned with a preview in the strip, and no text in the app or in the analysis still says that recurring items are left out of a budget.
