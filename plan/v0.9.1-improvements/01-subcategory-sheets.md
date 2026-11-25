# 0.9.1-1 · Overzicht: subcategory sheets

| | |
|---|---|
| Version | [0.9.1 Improvements](README.md) |
| Status | built 25 Nov 2026; released as 0.9.1 |
| Size | S |
| Features | IMP-1 |
| Concepts | [period-overview](../../analysis/concepts/period-overview.md) |
| Screens | [overzicht](../../analysis/screens/overzicht.md) |
| Depends on | – (0.8.1-1 drill-down keys and 0.8.1-4 breakdown sheets, built) |
| Who | Sonnet |
| Files | new `web/src/lib/overzichtBlad.ts` + `overzichtBlad.test.ts`, `web/src/pages/Overzicht.tsx`, `OverzichtSheet.tsx`, `Overzicht.test.tsx` |

**Builder:** use the graphify skill to find dependencies before editing, and the ponytail skill: the smallest change that fully solves the phase.

## Goal
User request 1 (25 Nov 2026): tapping a subcategory, or the "<top> zelf" row, opens the same slide-in sheet as a top category (bottom sheet on the phone, side panel from 1024 px) with that subcategory's transactions, instead of switching to Transacties. Title "Boodschappen › Supermarkt"; "Open in Transacties" stays a link. It works from the Inkomen, Uitgaven and Gespaard sheets and from the "Per categorie" dropdown.

## What exists (read 25 Nov 2026)
- `?blad=` holds the open sheet: `inkomen|uitgaven|gespaard`, `categorie-<value>`, `rekening-<id>` (`pages/Overzicht.tsx:86-96`). `categorie-<value>` is accepted when `categoryFromParam(value)` knows it (`lib/drilldown.ts:105-125`): `<id>`, `<id>-zelf`, `inkomen-<id>`, `inkomen-<id>-zelf`, `inkomen-overschrijving`, `inkomen-geen`, `gespaard-rekening-<id>`, `geen`, `naar-gedeeld`, `naar-eigen`, `gespaard`. So the URL already carries a subcategory; the server's `category=` drill-down already takes every one of those keys (0.8.1-1).
- The category sheet is opened only for a **top** row: `rows.find((x) => x.key === blad.key)` over `catRows` (`Overzicht.tsx:729-735`); anything else is "stale" and the `blad` is dropped (`:734`, `:807`). `CategoryBlad` (`OverzichtSheet.tsx:230-310`) needs only `param`, `name`, `lead`, `amount` and the column's `periodKey`/`account`; it builds its request and its "Open in Transacties" link from `param` through `drillParams` (`:232-234`).
- Sub rows: `Subs` renders each as a `<Link>` to Transacties (`OverzichtSheet.tsx:108-122`), used by the "Per categorie" dropdown (`CatItem`, `:128-144`), the breakdown sheets (`BdItem`, `:319-336`, whose top row is a `<Link>` too) and the "Per rekening" sheet (`AccountBlad`, `:428`).
- A row's `param` is its `categorie` value: `subRows` writes `<id>` or `<id>-zelf` for expense subs and `inkomen-<id>[-zelf]` for income subs (`lib/reports.ts:363-373`, `:429`, `:474`); breakdown top rows carry `inkomen-<top>`, a saving category's id, `inkomen-overschrijving`, `inkomen-geen`, `gespaard-rekening-<id>` (`:451-478`).
- Opening pushes the `blad` onto the history with `state.ovBlad`, closing goes back (`Overzicht.tsx:545-568`), so a sheet opened from a breakdown sheet returns to it on Back.

## Rules
- **Which rows open a sheet** (README decisions 1, 5): in the Inkomen, Uitgaven and Gespaard sheets every row, top, pseudo or sub; in "Per categorie" the sub rows of the dropdown (the top row already does). Each becomes a `<button aria-haspopup="dialog">` that calls `openBlad('categorie-' + param, el)`; its accessible name ends in ". Bekijk de transacties." like `CatItem`'s. The "Per rekening" sheet's sub rows keep their `<Link>` (its `blad` cannot carry the account; README known limits).
- **Resolving a `categorie-<value>` blad**: one pure function `findBladRow(value, lists)` in the new `lib/overzichtBlad.ts`, searching by `param` (not by API key) in this order: the "Per categorie" rows and their subs (`catRows` of the column, with `detail`), then `breakdown('inkomen', …)` and `breakdown('gespaard', …)` rows and their subs. A top expense row matches on `categoryParam(row.key)` as today. It answers `{ name, title, amount, row }` or `null`. Ids are unique across the tree, so one id never matches two lists; `<id>` of a saving category is found among the Gespaard rows.
- **Title**: a top or pseudo row its name; a subcategory "<top name> › <sub name>" (U+203A with a space either side); the part on the top itself "<top name> › zelf" (decision 6). The top name is the parent row's `name`.
- **Lead icon**: the row's own look (`colour`, `icon`, `dot`): a sub row's emoji on its colour; the pseudo rows their dot (as `CatLead`).
- **Amount**: the row's own amount (an income row positive, as in the breakdown). Nothing is recomputed.
- **Back restores the breakdown sheet as it was** (README decision 21, review finding 7): `sheet` is one node (`Overzicht.tsx:690-735`), so opening a row's sheet unmounts the breakdown sheet, and `BdItem` keeps its expanded state in a local `useState` (`OverzichtSheet.tsx:319-321`). The expanded top keys of the breakdown sheets move into the page's state (`Overzicht.tsx`, e.g. `const [expanded, setExpanded] = useState<Set<string>>()`, reset when the column, scope or account changes) and are passed to `BreakdownBlad`/`BdItem`. On Back the breakdown sheet comes back with the same top expanded and focus on **that top's toggle** (the chevron button); the tapped sub button may not exist yet when the sheet mounts, so focus goes to the toggle, not the sub row. A top or pseudo row tapped without expanding gets focus back on itself. The "Per categorie" dropdown keeps its local state (`CatItem` stays mounted) and focus returns to the tapped sub button.
- **Stale**: a value that `findBladRow` does not find, once the report and (for idle top rows) the references are in, is dropped as today.
- Nothing changes on the server, in `lib/drilldown.ts` or in the request a sheet makes.

## Steps
1. **Sonnet**: `lib/overzichtBlad.ts` with `findBladRow` and its vitest (`overzichtBlad.test.ts`): a top expense row, an expense sub, a `-zelf` part, an income sub (`inkomen-<id>`), `inkomen-<id>-zelf`, `inkomen-overschrijving`, `gespaard-rekening-<id>`, a saving category id, `geen`, an unknown id (`null`); titles as above.
2. **Sonnet**: `Overzicht.tsx`: the `categorie` branch (`:729-735`) uses `findBladRow` (title for the sheet, `lead` from the row); `OverzichtSheet.tsx`: `Subs` and `BdItem` take an `onOpen(param, el)` and render buttons; `CatItem` passes `onOpen` to its `Subs`; `BreakdownBlad` gets `onOpen`; `AccountBlad` keeps links (pass `href` only). Keep the chevron a separate button (0.8.1-4). Lift the breakdown sheets' expanded keys into the page state and restore focus as in the rules.
3. **Sonnet**: `Overzicht.test.tsx`: the cases below.

## Tests (vitest, the demo fixtures of 0.8.1-4 plus one sub row)
- With a fixture where one November Boodschappen row is on Supermarkt: the Uitgaven sheet's "Supermarkt" is a button; clicking it sets `?blad=categorie-<Supermarkt id>`, the sheet's heading reads "Boodschappen › Supermarkt", the amount equals the sub row's, its request is `drillQuery` of `categorie=<id>&periode=2026-11` (the same query as the Transacties link it shows); "Boodschappen zelf" opens "Boodschappen › zelf" with `category=<top>-zelf`.
- The "Per categorie" dropdown's sub row opens the same sheet (same URL); the top row still opens the top's sheet.
- The Inkomen sheet's "Salaris" (top) and "Overschrijvingen" rows open sheets (`inkomen-<id>`, `inkomen-overschrijving`); the Gespaard sheet's "Naar Spaarrekening" opens `gespaard-rekening-2`.
- A reload with `?blad=categorie-<sub id>` opens the sub sheet on the default column; `?blad=categorie-99999` is dropped.
- The "Per rekening" sheet's sub rows are still links to `/transacties?…&rekening=<id>`.
- Keyboard: the sub button opens with Enter and Space; in the "Per categorie" dropdown focus returns to it when the sheet closes.
- **Back from a breakdown sheet's sub row** (finding 7): open the Uitgaven sheet, expand Boodschappen, open "Supermarkt", close it (Back): the Uitgaven sheet is open again, Boodschappen is still expanded (its toggle `aria-expanded="true"`, "Supermarkt" visible) and focus is on Boodschappen's toggle. Changing the column clears the expanded keys.

## Who builds it
- **Sonnet**: all steps.

## Done when
Every row of the three breakdown sheets and every subcategory of the "Per categorie" dropdown opens the sheet with the same rows and total as the row it was tapped on, titled "Top › Sub", Back returns where it came from, and "Open in Transacties" leads to the same list.
