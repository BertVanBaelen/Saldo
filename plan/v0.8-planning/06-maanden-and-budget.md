# 0.8-6 · Planning: Maanden and Budget tabs, budget editor

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | released (0.8.0), verifying |
| Size | M |
| Features | PLAN-2, PLAN-5, PLAN-6 |
| Concepts | [forecast](../../analysis/concepts/forecast.md), [budget](../../analysis/concepts/budget.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [scope](../../analysis/concepts/scope.md) |
| Screens | [planning](../../analysis/screens/planning.md) |
| Depends on | [0.8-5](05-planning-kalender.md) (page shell), [0.8-1](01-planning-data.md) (`PUT /api/planning/budgets`), [0.8-4](04-forecast-api-and-start.md) (`contribution`), [0.6-5](../v0.6-shared-accounts/05-contributions.md) (the Bijdragen card) |

## Goal
The month list with its breakdown, free to spend per account with the budgets behind it, and a way to change a budget (the mockup has no budget editor: designed here with the app's existing components).

## Maanden tab
- "Vooruitkijken" and the horizon 3 / 6 / 12 / 24 mnd (selected green); a change refetches with the new horizon and shows 4 shimmer skeletons (88 px phone, 64 px desktop, `--skel`/`--skel2`) while loading (no fixed 380 ms: as long as the request runs). Phone: the buffer card per account in view with "Wijzigen" → Rekeningen.
- **Deep link**: with `?maand=` (an alert) the Maanden list opens with that month selected (desktop: the selection is account + month, shown in the right panel) or expanded (phone), scrolled into view.
- **Per account** (decision 1): with several accounts in view, one sub-heading per account (dot and name) and its own list of month cards; never summed cards.
- **Month card**: name ("November" for the running year, "Januari 2027" otherwise), badge "lopend" on the running month, chip from `left`/`state`: "€ 306,85 over" (`--soft`), "€ 265,07 onder buffer" (`--warnChip`), "€ 1.134,03 rood" (`--neg`/`--onNeg`; the amount is −end), summary "In € 2.868,50 · uit € 2.485,20 · gespaard € 200" (`income`, `out`, `saved`), end balance; card background `--warnSoft`/`--negSoft` with a `--warnChip`/`--neg` border. Phone: a card expands to its breakdown (default: the first month that is not ok, else the running month; `aria-expanded`); desktop: rows (grid 158 / 1fr / 112 / 172) select the month shown in the right panel (`aria-pressed`).
- **Breakdown** from `lines` (labels in Dutch; zero lines kept where the mockup shows them):
  - running month: "Saldo vandaag" (account name), "Terugkerende posten" (recurringIn + recurringOut; note "Deze maand al ontvangen en betaald" when 0, else the descriptions), "In behandeling" (pending, only when not 0), "Eenmalig en gepland" (planned, only when not 0), "Variabele uitgaven · rest van de maand", "Naar spaarrekening · Gespaard" (only when not 0);
  - later months: "Startsaldo · Einde vorige maand", "Terugkerend inkomen", "Terugkerende uitgaven" (descriptions in the note, so January names "Familiale verzekering"), "Variabele uitgaven", "Eenmalig en gepland" (descriptions), "Naar spaarrekening · Gespaard";
  - running month only, when `missed` is not empty: "Verwacht, niet gezien" with the descriptions and "Niet meegeteld" as amount note (0.8-3 rule 5b);
  - then "Eindsaldo", "Min. buffer −€ 900,00" and the result bar "Over" / "Onder buffer" / "Tekort · je staat rood".

## Budget tab
- Month switcher "Budget november 2026" / "Verwachte kosten zijn al afgetrokken", the same month as the Kalender (`?maand`).
- **One card per account in view**: "Vrij te besteden" or "Tekort" with |left| (Mono 22, `--greenText`/`--sharedText`/`--neg`); a 14 px stacked bar (fixed costs `--c1`, each category's rest in its colour, one-off `--warn`, savings `--c5`, buffer hatched, free in the account colour; scale = max(start + still to receive, costs + buffer)); `aria-label` "Van € 1.969 is € 762 voorzien voor verwachte kosten, € 900 is buffer en € 307 is vrij." Rows: "Saldo vandaag" / "Startsaldo 1 december", "Nog te ontvangen" (recurringIn, descriptions), "Vaste kosten · Nog te betalen deze maand" (recurringOut + pending), "Eenmalig en gepland", "Budgetten" ("Nog te besteden tot 30 november" / "Gereserveerd voor december") with one indented row per entry of `budgets`: "€ 66,90 van € 350,00 al besteed" (running month, source budget), "Gemiddelde € 62,47 · € 0,00 al besteed" (source average), "Volledig budget € 350,00" (later months), "Naar spaarrekening · Gespaard", "Buffer · Blijft altijd staan", and the result bar. The rows add up to `left` (decision 4).
- **Per categorie · deze maand**: per account and category of the running month, a bar of spent against plan ("€ 66,90 van € 350,00"; over plan the bar is full in `--neg` and the text says "€ 12,00 te veel"), with the account pill. A category whose plan is the average says "gemiddelde". Note: "Terugkerende posten tellen niet mee in de budgetten. Zonder budget rekent de planning met het gemiddelde van de afgelopen 6 maanden. Spaarcategorieën hebben geen budget." With less than one complete month of history: "Nog te weinig geschiedenis voor een gemiddelde."
- **Budget editor** (no mockup; a `Sheet` as the category editor): tapping a category row (with Bewerken on that account) opens "Budget <categorie> · <rekening>", the amount with − / + in € 10 steps (Mono, typed value allowed, `aria-label`s "€ 10 minder" / "€ 10 meer"), "Gemiddelde van de afgelopen 6 maanden: € 62,47" with a button "Gebruik het gemiddelde" (fills the amount, rounded up to whole euros), a choice "Geen budget (rekent met het gemiddelde)" and the line "Geldt vanaf <maand> en de maanden erna." Opslaan → `PUT /api/planning/budgets` with `fromMonth` = the month shown, toast "Budget bewaard vanaf november". Categories without a row (an expense top category, not saving, with no budget and an average of 0) are added from "+ Budget voor een andere categorie" (the app's `CategoryPicker` limited to those categories). Read-only: rows are not buttons.

## Required contribution (shared accounts; user decision 18 Nov 2026)
- **Budget tab**, the shared account's card: under the result bar a block "Bijdragen <maand>": "Nodig: € 872" with the note "Vaste kosten en budgetten € 800,45 · om de buffer van € 600 te halen € 70,73" (the second part only when `bufferGap` > 0; "− andere inkomsten € x" when `otherIncome` > 0), then one row per member "Jij · 50 % · € 436" / "Partner · 50 % · € 436" (shares from `contribution.members`, "gelijk verdeeld" when `NULL`). This replaces the mockup's static "Jullie bijdragen (€ 900 per maand) dekken de vaste kosten en deze budgetten.": the note under the categories becomes "Jullie verwachte bijdragen (€ 900) dekken wat nodig is." when the month's contribution items (kind contribution) sum to at least `need`, else "Jullie verwachte bijdragen (€ 800) zijn € 72 minder dan nodig." 
- **Bijdragen card** (`ContributionsCard` on the shared account's page, `Bijdragen.tsx`): per member, next to the chip of 0.6-5, "nodig € 436" for the current month and the line "Op basis van de planning: vaste kosten, budgetten en de buffer van deze rekening." with a link "Bekijk de berekening" to `/planning?maand=<YYYY-MM>#budget`. The percentage editor (manager only, 0.6-5) gets the help "Het aandeel bepaalt ieders deel van wat nodig is." Without `required` (no balance yet) the card is as in 0.6-5. Read-only members see the figures, not the editor (unchanged). Remove the comment "The shares have no effect yet".
- Demo (November): need € 872, gap € 70,73, Jij and Partner € 436 each; the note "Jullie verwachte bijdragen (€ 900) dekken wat nodig is."; December need € 801, € 401 each.

## Steps
1. **Sonnet**: Maanden (horizon, skeletons, per-account lists, cards, breakdown) with vitest.
2. **Sonnet**: Budget cards, bar, rows, per-category list, the summary bar of 0.8-5 (same segments), with vitest.
3. **Sonnet**: the budget editor sheet, with vitest.
4. **Sonnet**: the required-contribution block on the Budget card and in the Bijdragen card, with vitest (demo figures above; unequal shares 70/30 → € 610 / € 262; the bufferGap part hidden at 0; the short-of-need note; no block on a personal account).

## Tests (vitest, demo answer fixture)
- Maanden alles: two lists (Zichtrekening, Gedeelde rekening); Zichtrekening chips "€ 306,85 over", "€ 187,89 over", "€ 265,07 onder buffer", "€ 1.134,03 rood"; the expanded default on the phone is January (first not ok); the February breakdown has "Eenmalig en gepland" −€ 2.000,00 "Autoherstelling" and the result bar "Tekort · je staat rood"; the November breakdown has "Terugkerende posten € 0,00 · Deze maand al ontvangen en betaald" and "In behandeling −€ 24,99"; the horizon 12 request and the skeletons while it loads.
- Budget November: Zichtrekening "Vrij te besteden € 306,85" and rows that sum to it (196882 − 2499 − 73698 − 90000); Gedeelde rekening € 28,82 with "Overig · Gemiddelde € 62,47"; February Zichtrekening "Tekort € 2.034,03".
- Editor: steps of 1000 cents, "Gebruik het gemiddelde" → € 63 for Overig on the shared account, "Geen budget" sends `amount: null`, the `fromMonth`, read-only rows inert.

## Who builds it
- **Sonnet**: steps 1–3 from this file.

## Done when
Maanden and Budget match the mockup per account with the demo numbers of 0.8-3, and a budget change shows in the forecast after saving.
