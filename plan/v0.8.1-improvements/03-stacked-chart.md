# 0.8.1-3 · Overzicht: stacked "uit" bar

| | |
|---|---|
| Version | [0.8.1 Improvements](README.md) |
| Status | planned |
| Size | S |
| Items | 5 |
| Screens | [overzicht](../../analysis/screens/overzicht.md) |
| Depends on | – (uses the report as it is) |
| Files | `web/src/pages/Overzicht.tsx` (Chart, ChartCard, Totals), `Overzicht.css`, `Overzicht.test.tsx` (aria labels change), `web/src/lib/reports.ts` (+ test), `analysis/screens/overzicht.md` |

## Goal
Item 5: "overzicht grafieken moeten kosten opeen staan om duidelijk te maken hoeveel er totaal uit is gegaan." Each period now has three bars side by side (Inkomen, Uitgaven, Gespaard). It becomes two: **In** and **Uit**, where Uit stacks the costs per category with Gespaard on top, so its height is everything that left the selection.

## Rules
- **`stack(sum, categories)`** in `lib/reports.ts` (pure): the segments of one column, bottom to top: the expense keys with a positive amount, largest first by the **selected** column's order so colours stay in the same order across columns (order = descending amount in the selected column, keys absent there after it by their own amount), then Gespaard when `saved > 0`. Each segment `{key, amount, colour}`: a category's colour (`catColours(...).bg`), `--shared` for "Naar gedeelde rekening", `--muted` for "Naar eigen rekening", the dashed/`--track` pattern for "Niet gecategoriseerd", the saved colour of today's bar for Gespaard. `stack` returns every segment (tested as such). **Drawing** merges, per bar, segments that would be under 4 px high into one "Kleine posten" segment (`--line`, not a category colour; not "Overige", next to the real category "Overig"), so a phone bar never has hairlines; the legend and aria label keep the real segments.
- **Height**: `out(sum) = Σ positive segments`; the chart max = `max(income, out)` over the columns (the stacked height, not `s.total`).
- **Negative keys** (a refund surplus, a net withdrawal from savings) add nothing to the stack (known limit); the figure "Samen uit" below uses the net sum.
- **Totals**: the three tiles stay (Inkomen, Uitgaven, Gespaard). Under them one line: "Samen uit € 1.905,49 · over € 1.444,51" (= `s.total + s.saved`, and `income − (s.total + s.saved)`; "tekort € x" in `--neg` when negative). With several accounts this is the "samen · ter info" sum of today (0.8 decision 1 allows sums as information).
- **Legend**: "In" (green key) and "Uit" with the segments of the selected column in a wrapping list under the chart ("Wonen · Boodschappen · … · Gespaard"), each with its swatch.
- **Accessibility**: the column's `aria-label` becomes "oktober 2026: in € 3.350,00, uit € 1.905,49, waarvan uitgaven € 1.705,49 en gespaard € 200,00". The animation stays `sGrowY` per bar (the stack grows as one bar).
- **Deviation** from the frozen mockup (three bars): written in `analysis/screens/overzicht.md` under "Deviation (0.8.1)".

## Steps
1. **Sonnet**: `stack`, `outOf`, the new chart markup and CSS (phone and desktop widths of today's `--s/--m/--l` classes), the totals line, the legend, vitest.

## Tests (vitest, the demo report fixture; numbers from `TestReportMonthsDemo`)
- Alles, October 2026: segments Wonen 115000, Boodschappen 25236, Vervoer 14060, Abonnementen 6896, Overig 6562, Vrije tijd 2795, Gespaard 20000; out 190549; income 335000; line "Samen uit € 1.905,49 · over € 1.444,51".
- Persoonlijk, October: Wonen 100500, Naar gedeelde rekening 45000 (`--shared`), Vervoer 14060, Vrije tijd 2795, Abonnementen 2598, Gespaard 20000; out 184953; "over € 1.050,47".
- Alles, November (running): out 195642 (175642 + 20000; "Niet gecategoriseerd" 4125 is a segment).
- Gedeeld, November: out 48319, no Gespaard segment; Boodschappen 29521 on the bottom.
- Drawing: at a 130 px bar on a max of 335000, Vrije tijd (2795 → 1,1 px) and the others under 4 px draw as "Kleine posten" while `stack` still lists them; a key of −500 adds no segment and "Samen uit" is 500 lower than the bar.
- The max is the stacked height: a column with income 100 and out 150 is drawn at full height for Uit.
- The aria label of October in Alles as above.

## Who builds it
- **Sonnet**: all of it.

## Done when
Every period shows In and a stacked Uit whose top is what left the selection, the tiles still read the same numbers, and the deviation is written down.
