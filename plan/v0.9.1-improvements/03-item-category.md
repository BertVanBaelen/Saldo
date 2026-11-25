# 0.9.1-3 · Category on recurring items

| | |
|---|---|
| Version | [0.9.1 Improvements](README.md) |
| Status | built 25 Nov 2026; released as 0.9.1 |
| Size | M |
| Features | IMP-3 |
| Concepts | [recurring-item](../../analysis/concepts/recurring-item.md), [budget](../../analysis/concepts/budget.md) |
| Screens | [planning](../../analysis/screens/planning.md) (Planning instellen, the item sheet) |
| Depends on | – (0.8-1 items, 0.8-3 matching, 0.8.1-8 item sheet: built) |
| Who | Opus (steps 1–3: migration, ledger rules, category lifecycle, match-pass extraction and suggestion), Sonnet (steps 4–5: route field, docs, web) |
| Files | new `server/internal/db/migrations/0022_recurring_item_category.sql`, `server/internal/db/db_test.go`, `server/internal/ledger/planning.go` (+ test), `server/internal/ledger/categories.go` (+ test), `server/internal/planning/forecast_load.go`, `forecast_project.go`, new `planning/suggest.go` + `suggest_test.go`, `server/internal/server/planning.go` (+ `planning_test.go`), `privacy_test.go`, `docs/api.md`, `web/src/lib/planningItems.ts`, `web/src/components/CategoryPicker.tsx`, `web/src/pages/PlanningItemForm.tsx`, `PlanningTerugkerend.tsx` (+ tests) |

**Builder:** use the graphify skill to find dependencies before editing, and the ponytail skill: the smallest change that fully solves the phase.

## Goal
A recurring item can carry a category: optional, any expense category (top or sub, rolling up to its top) for an expense item, a saving category for a saving item, none for income, transfers and contributions. The app suggests one from the categories of the item's matched payments; the user confirms it in the item form (and, in 0.9.1-5b, in the Budgetten "Zonder categorie" list). This phase stores and serves it; the engine uses it in 0.9.1-4.

## What exists (read 25 Nov 2026)
- `recurring_items` (`migrations/0017_planning.sql:9-25`): no category; `kind IN ('income','expense','transfer','saving','contribution')`, `state IN ('suggested','confirmed','ignored')`. Foreign keys are on (`server/internal/db/db.go:46`); migrations end at `0021_planned_whole_month.sql`.
- `ledger.Item`/`ItemFields`/`validate` (`ledger/planning.go:27-161`), `itemColumns` and `scanItem` (`:194-213`), `CreateItem` (`:247-276`), `UpdateItem` (`:319-344`, a PATCH of named fields, then the whole item is checked again).
- Category lifecycle (`ledger/categories.go`): `UpdateCategory` deletes the budgets of a category that gets the saving flag, turns income, moves from top to sub or moves under a saving parent (`:439-445`); `RemoveCategory` (`:467-531`) without target clears transactions and deletes rules and budgets, with target (same type only, `:505`) moves transactions, splits, rules, budgets (only to a top expense category that is not saving, `:514-516`), mappings and suggestions.
- The forecast's matching (`planning/forecast_project.go:263-351`: rows of the window, occurrences, one pass in date order, `rows[j].match`) lives inside `Project`. The loader rolls every part up to its top (`forecast_load.go:28-35`, `tc`); it does not read the leaf category.
- Detection rows carry no category (`planning/detect.go:59-65`).
- The item list is `GET /api/planning/items?scope=` (`server/planning.go:37-44`), straight from `store.PlanningItems`.
- The item sheet (`web/src/pages/PlanningItemForm.tsx`) has no category; `CategoryPicker` (`web/src/components/CategoryPicker.tsx:11-31`) shows the expense or income tree by the sign of `amount`, saving categories included.

## Rules
- **Storage** (migration 0022): `ALTER TABLE recurring_items ADD COLUMN category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL;` with a header comment (what it means, who writes it, that `NULL` is "Zonder categorie"). Additive; every existing item is "Zonder categorie". 0022 is free (0.8.1 took 0020/0021, 0.9 needed no more than 0018/0019).
- **Wire**: `Item.categoryId` (`number | null`), `ItemFields.categoryId` (`Opt[int64]`, `null` clears). `GET /api/planning/items` also answers `suggestedCategoryId` (`number | null`, output only; a request carrying it is `400` "De gegevens kloppen niet." as for unknown fields).
- **Validation** (in `ledger`, after `validate`, in the same transaction; `400 invalid`):
  - `categoryId` of a category that does not exist: "Die categorie bestaat niet.";
  - kind `expense`: its top must be type `expense` and not saving, else "Kies een uitgavencategorie die niet als gespaard telt.";
  - kind `saving`: its top must be saving, else "Kies een spaarcategorie.";
  - any other kind with a category: "Alleen een uitgave of sparen krijgt een categorie.";
  - **(lead, README 9)** a PATCH that changes `kind` (or `state` to `ignored`) without naming `categoryId` clears a category that no longer fits instead of refusing; an `ignored` item never keeps one.
- **Category lifecycle** (`ledger/categories.go`), one helper `clearUnfitItemCategories(ctx, tx)` that sets `category_id = NULL` on every item whose category no longer fits its kind and state (the rule above, one `UPDATE … WHERE id IN (SELECT … JOIN categories c … JOIN categories t ON t.id = COALESCE(c.parent_id, c.id) WHERE NOT (…))`):
  - `RemoveCategory` without target: the foreign key already sets `NULL`; add the explicit `UPDATE recurring_items SET category_id = NULL WHERE category_id = ?1` to the steps anyway (readable, and safe on a connection without foreign keys);
  - `RemoveCategory` with target (the merge): `UPDATE recurring_items SET category_id = ?2 WHERE category_id = ?1`, then the helper (an expense item that followed into a saving category falls back to "Zonder categorie");
  - `UpdateCategory`: the helper after the update, always (a type change, the saving flag either way, a move under a saving parent or to another top all change what fits).
  - `docs/api.md` "Categories" says so in one sentence each, plus one for a subcategory moved under another top: its items keep it, so their costs move into the new top's total (review nit 14).
- **Suggestion** (README decision 10; `planning/suggest.go`, pure, viewer-free):
  - The match pass of `Project` (rows of the window, occurrences, matching; `forecast_project.go:263-351`) moves into one unexported function that `Project` calls; **every golden stays byte-identical** (the identity test).
  - The loader adds the leaf category to each part: `FactPart.Own int64` = `COALESCE(sp.category_id, t.category_id, 0)` (an added column of `fcQueryRows`; no number changes, `TestForecastLoaderReadsNoUserData` still holds). Any **new** loader query goes into `forecastQueries` (`forecast_load.go:45`): that test checks only that list (review nit 12).
  - `SuggestCategories(f Facts, today string) map[int64]int64` (item id → leaf category id): for each confirmed item of kind `expense` (or `saving`), its matched **booked** rows of the window; count each part whose top fits the kind (`Variable` for expense, `Saving` for saving) under its `Own` id; the id with the most parts wins, a tie goes to the id on the newest row (then the lower id). No fitting part: no entry. Parts are counted, not amounts: chosen for simplicity (README decision 23); a split 30/10 is a tie.
  - Served on `GET /api/planning/items`: the handler loads `planning.LoadFacts` once per account of the answer (today in Brussels) and sets `suggestedCategoryId` on its confirmed expense and saving items; an account without a balance (`ErrNoBalance`) gives `null`. Account-level, the same for every member. `POST` and `PATCH /api/planning/items` keep answering the bare item (no `suggestedCategoryId`, review nit 13): the web keeps the suggestion it got from the list (by item id) and reloads the list after a save, so the chip and the hint do not flicker.
- **Web types** (README build order): `categoryId?: number | null` and `suggestedCategoryId?: number | null` are **optional** on `RecurringItem`, so the item fixtures of `planningItems.test.ts`, `PlanningInstellen.test.tsx`, `PlanningTerugkerend.test.tsx` and `test/helpers.tsx` need no change; a missing value reads as `null`.
- **The hint** (web, two sources of truth): when an item's `categoryId` differs from `suggestedCategoryId` and both are set, the form says "Betalingen van deze post staan meestal in <naam>." under the field. Nothing is changed automatically.
- **Item sheet** (`PlanningItemForm.tsx`): a field "Categorie" under "Omschrijving" and "Bedrag" for "Gewone uitgave" and "Sparen" only (hidden for the other kinds; switching to one clears the field in the form); the value is the item's category or "Zonder categorie"; with a suggestion and no category a chip "Suggestie: Wonen · Gebruiken"; "Kies…" opens `CategoryPicker` filtered to the fitting categories (a new optional prop `only?: (c: TreeCategory) => boolean`; expense: expense tops that are not saving and their subs; saving: saving tops and their subs); "Geen categorie" clears it. The line under the sheet adds "· Wonen". The Terugkerend rows add "· <categorie>" to their note.

## Steps
1. **Opus**: migration 0022, its row in `db_test.go`'s migration list (and the "items survive" check if the test has one); `ledger`: `Item.CategoryID`, `ItemFields.CategoryID`, `itemColumns`, `scanItem`, insert and update, the validation and the kind-change rule; `ledger/planning_test.go` cases (each message, a sub of an expense top accepted, a saving category for an expense item refused, a kind change clearing, an ignored item).
2. **Opus**: `clearUnfitItemCategories` and the three call sites in `categories.go`; tests: delete without target → `NULL`; merge into an expense top → follows; merge into a saving category → `NULL`; setting the saving flag on Abonnementen → its expense items `NULL` and its saving items (none) untouched; turning a top income → `NULL`.
3. **Opus**: the match-pass extraction (all 0.8-3 and 0.8.1-9 goldens unchanged, run before anything else), `FactPart.Own`, `SuggestCategories` and `TestSuggestCategories` (below).
4. **Sonnet**: the handler's `suggestedCategoryId`, `server/planning_test.go` (the demo list, below), `privacy_test.go` (Partner sees the same `suggestedCategoryId` on the shared account's items; a Lezen member's PATCH with `categoryId` `403`), `docs/api.md` "Planning data" and "Categories".
5. **Sonnet**: `lib/planningItems.ts` types, `CategoryPicker`'s `only`, the item sheet field with the suggestion chip and the hint, the Terugkerend note; vitest for the form (field shown for expense and saving only, the chip fills it, the hint, a kind switch clears it, the PATCH body carries `categoryId`, the chip survives a save because the suggestion is kept from the list).

## Tests
- **`TestSuggestCategories`** (on `planningWorld`, today 2026-11-18; lead derives each answer from the fixture before the phase, the expected values below are what the rule should give): Huur → Wonen (`2026-10-01` and `2026-11-01`, both Wonen); Gym → Vrije tijd (the matched `2026-10-14` row); Krant, Toelage (income: no entry), Verzekering, Water (no matched row in the window: no entry); a split row matched to an item counts each fitting part once (a case on the loaded facts with one extra in-memory `FactItem` "Hema" −4000 monthly on the 3rd, so `planningWorld` and `TestWorld` stay untouched: it matches the split row of `2026-11-03` with parts Boodschappen −3000 and Vrije tijd −1000, one part each, both on the same row → the lower id, Boodschappen (default ids 2 and 3); lead confirms); a saving item matched to a Sparen row → Sparen (W1 has no saving item: an in-memory `FactItem` "Spaarpot" −2000 monthly on the 10th, kind `saving`, counterparty "Spaarpot", appended to the loaded facts like "Hema"; it matches the `2026-10-10` Sparen row, review nit 19).
- **Identity**: `TestForecastDemo`, `TestWorld`, `TestWorldDayless`, `TestProjectEdges` byte-identical after step 3.
- **Demo** (`GET /api/planning/items?scope=alles`, Bert; lead derives from the seed and the story): Huur → Wonen, Netflix → Abonnementen, Spotify → Abonnementen, Familiale verzekering → `null` (no counterparty, no payment of exactly −68400 in the window), Energie → Wonen, Internet en tv → Abonnementen; Salaris, the transfer, the saving order and the contributions `null` (Naar spaarrekening is kind `saving`: its rows are uncategorised transfers, so `null`). Bert and Partner byte-identical for account 4.
- **Validation and lifecycle**: the cases of steps 1 and 2.

## Done when
An expense or saving item can be given a fitting category (top or sub) in the item sheet, with the suggestion from its payments one tap away and a hint when they differ; the server refuses a category that does not fit; deleting, merging or re-flagging a category never leaves an item with one that does not fit; and every forecast golden is unchanged.
