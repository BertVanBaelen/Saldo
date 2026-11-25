# 0.9.1-2 · Overzicht: running month, quarter and year

| | |
|---|---|
| Version | [0.9.1 Improvements](README.md) |
| Status | built 25 Nov 2026; released as 0.9.1 |
| Size | S |
| Features | IMP-2 |
| Concepts | [period-overview](../../analysis/concepts/period-overview.md) |
| Screens | [overzicht](../../analysis/screens/overzicht.md) |
| Depends on | – (merge after 0.9.1-1: one call in `Overzicht.tsx`) |
| Who | Sonnet |
| Files | `web/src/lib/reports.ts` + `reports.test.ts`, `web/src/pages/Overzicht.tsx` (one call), `Overzicht.test.tsx`, `web/src/lib/receipt.ts` (a comment), `analysis/concepts/period-overview.md` |

**Builder:** use the graphify skill to find dependencies before editing, and the ponytail skill: the smallest change that fully solves the phase.

## Goal
User request 2 (25 Nov 2026): Maand shows the running month as its last, lighter column ("loopt nog, tot 18 nov") and opens on it; Kwartaal gets the current quarter so far; Jaar includes the running month. A partial column has no trend; the category rows keep their budget progress ("€ 295,21 van € 550,00").

## What exists (read 25 Nov 2026)
- `columns(view, h, today, custom)` (`web/src/lib/reports.ts:87-203`): Maand is the last 6 **complete** months (`range(start, end)` with `end = last`, `:130-135`); Kwartaal leaves out the quarter that holds the running month and keeps at most 4 complete ones (`:136-154`); Jaar runs to the last complete month (`end = last`, `:155-171`); Eigen already reaches the running month (`:172-183`).
- A column holding the running month gets `partial = runningInfo` ("(loopt nog, tot 18 nov)", head "lopend · tot 18 nov", note "november loopt nog, tot 18 nov.", `:95-110`) and is drawn lighter (`.ov-col--running`, `pages/Overzicht.css:78`, `Overzicht.tsx:198`); a partial column gets no trend base and is no base for the next (`:185-191`); the category head says "lopend · tot 18 nov" (`Overzicht.tsx:391`).
- `defaultSelection(cols)` takes the last column that is not partial (`reports.ts:206-209`), called once (`Overzicht.tsx:659`); `columns(` is called in production only by `Overzicht.tsx:618` (the Eigen seed) and `:656`, and in the tests `receipt.test.ts:26`, `receiptCrossCheck.test.ts:25` and `Transacties.test.tsx:6` import it too (run them; a test that assumes Maand ends at October gets the running month added); `OverzichtSaldo.tsx:16` takes the `Period` and the selected index.
- `barSize(n)`: `n > 8` xs, `> 4` s, `> 2` m, else l (`reports.ts:537`); `'s'` has no rule of its own, so the base `--bar-w: 10px` and gap 4 px apply on the phone (`Overzicht.css:72-77`), 18 px and 8 px from 1024 px (`:139`).
- The report and the budget references already include the running month (Eigen uses them); the drill-down reads `2026-K4` and `2026` (`lib/drilldown.ts:52-74`); `bonTarget` takes a running quarter or year "as it is" (`lib/receipt.ts:146-157`); its comment at `:161` says Kwartaal "leaves out the running quarter".

## Rules
- **Maand**: the last 6 complete months **and** the running month: `range(start, running)` with `start = max(first, last − 5)` (7 columns at most); a history that starts this month keeps its one column. The range text follows ("mei – november 2026"). Trend base of the first column unchanged.
- **Kwartaal**: the complete quarters as today (at most 4) **plus** the running quarter as the last column, partial with `runningInfo` (5 columns at most, README decision 8). Append it only when it is not already the last column (the fallback `qs = [qRunning]` of `reports.ts:143` holds it already); a history that starts inside the running quarter keeps its one column.
- **Jaar**: `end = running`; the running year's column holds the running month and is partial (`runningInfo`): lighter, title "2026" (cut at the start as today: "2025 · vanaf november").
- **Default selection** (README decision 7): Maand and Jaar open on their last column (the running month, the running year: for Jaar today's behaviour, because today's 2026 column is complete and last); Kwartaal and Eigen keep the last complete column. `defaultSelection(cols, view)`.
- **No trend for a partial column** (existing rule, unchanged); the next column has none either because the running one is last.
- **Budget progress stays**: the rows of a running column read against the references of its months (0.8.1-4 `columnReferences`). The running month counts its whole budget; a running quarter or year sums the references of the months so far (the budgets answer ends at the running month), nothing pro-rated.
- **Drill-down `periode`**: the running month `2026-11`, quarter `2026-K4`, year `2026`, as for complete columns (`periodParam`, unchanged).
- **The receipt chip** keeps working for a running column (no change); fix the comment at `receipt.ts:161`.
- **Sizes**: Maand 7 columns stays `'s'`; Kwartaal 5 columns becomes `'s'` (from `'m'`). The lead checks 375 px by eye: no overlapping labels, the selected column's outline fits, light and dark.

## Steps
1. **Sonnet**: `columns` and `defaultSelection` as above, `reports.test.ts` updated and extended.
2. **Sonnet**: `Overzicht.tsx:659` passes `view`; `Overzicht.test.tsx` updated; the comment in `receipt.ts`; `analysis/concepts/period-overview.md` "Rules for the app": the running column per view.

## Tests (vitest, today 2026-11-18, the demo history `{ firstMonth: '2025-11', firstDate: '2025-11-01' }` of `reports.test.ts:6`)
- Maand: keys `2026-05 … 2026-11`, the last partial with aria "(loopt nog, tot 18 nov)", selected by default; `partialNotes` "Lichtere staven: november loopt nog, tot 18 nov."; November has no `base`; October's base is September.
- Kwartaal: the complete quarters as today, then `2026-K4` partial (months 2026-10 … 2026-12), not selected by default (the last complete quarter is).
- Jaar: `2025 · vanaf november` (as today) and `2026` holding 2026-01 … 2026-11, partial (today it is `2026 · tot oktober`, complete); default selection 2026, as today.
- A history from 3 November 2026: one partial column in every view, selected (unchanged test).
- `barSize(7) === 's'`, `barSize(5) === 's'`.
- Overzicht, Maand, Alles: November is `aria-pressed`, the tiles show November's amounts, "Vrije tijd € 66,90 van € 350,00 · 19 %" and no trend text on the rows, the head "lopend · tot 18 nov"; clicking October shows its trend again.
- The running quarter's rows: Vrije tijd reads against 4028 + 35000 (October's average, November's budget), "budget en gemiddelde".

## Who builds it
- **Sonnet**: all steps.

## Done when
Maand shows seven columns ending in a lighter November and opens on it, Kwartaal ends in the running quarter, Jaar's 2026 holds November, the running columns have no trend and keep their budget progress, and seven columns fit at 375 px.
