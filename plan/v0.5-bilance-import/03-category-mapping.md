# 0.5-3 · Category mapping

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | built, to verify (11 Nov 2026) |
| Size | M |
| Features | IMP-2 |
| Concepts | [import](../../analysis/concepts/import.md), [category](../../analysis/concepts/category.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.6, risk 10 |
| Depends on | [0.5-2](02-import-wizard.md), [0.4-1](../v0.4-categorisation/01-category-tree.md) |

## Goal
Bilance categories land in Saldo's own categories.

## Steps
1. Table of distinct source categories with transaction count and total.
2. Per category: map (with a name-similarity suggestion), create new, merge several into one, or leave uncategorised.
3. Full path by default; "map by parent" for all children at once.
4. `category_mapping` saved per source and reused; edit later and re-apply to an import.

## Done when
A second import of a Bilance file needs no new mapping.

## Carried over from 0.4 (10 Nov 2026)
- **Targets:** the default set is the mockup tree as built in 0.4-1 (decided 10 Nov 2026), two levels. The mapping puts Bilance's two-level `Categorie` / `Subcategorie` onto it.
- **Merge** is the existing category removal with `moveTo` ([docs/api.md](../../docs/api.md), "Categories"): transactions of every user, split parts, rules, budgets and mappings move along.
- **Source path in two parts** (top and sub), never one joined string: a name may contain commas, `&` and ` / `.
- **Origin `import`:** imported rows carry it. Rules, suggestions and "apply to similar" never overwrite it; only an explicit manual pick on that one row does. Re-applying a changed mapping may rewrite only rows of origin `import` of that batch.
## Built (11 Nov 2026)
The contract is in [docs/api.md](../../docs/api.md), "Category mapping".
- **Storage** (migration 0008): `category_mappings` rebuilt per user and source with the source category in two columns (`source_category`, `source_subcategory`), a nullable `category_id` (`ON DELETE SET NULL`, the "leave uncategorised" of a removal without `moveTo`) and a unique key on user, source and pair. `transactions` gets `import_category` and `import_subcategory`, the two parts of the file's category of an imported row.
- **Import** (`ledger.ImportFiles`, one more parameter, the `CategoryPlan`): the choices of the wizard (`map`, `create`, `skip` per pair) are checked and any new category is made with the 0.4 create code (`createCategoryIn`, shared with `POST /api/categories`) inside the import's own database transaction, so a failed import and every preview leave nothing behind. Rows of a mapped pair get the category with origin `import`; the choices are saved as the viewer's mapping after a real import.
- **Preview**: every category pair answers its saved target (`saved`) and a suggestion by name (`suggestion`, `categorise.SuggestTarget`); with the choices it also counts `categorised`.
- **Mapping routes**: `GET` and `PUT /api/imports/mappings?source=`, and `POST /api/imports/{id}/reapply-categories`.
- **Wizard** (`ImporterenCategories.tsx`): the table of pairs with count and total and per pair the shared Select (Niet categoriseren, Nieuwe categorie, then the tree with icons in the main category's colour), the saved target pre-selected with the badge *Opgeslagen*, the suggestion with *Voorstel*; *Nieuwe categorie* opens a name field, a parent choice and the shared IconPicker; the same target on several pairs shows "Samen met ..." and the *Samengevoegd* card; the switch *Per hoofdcategorie koppelen* gives all pairs of a main category one target. The Controle step and the result say how many rows get a category and how many stay without.
- **Fixtures**: `fixtures/csv/bilance-tweede.csv` and the extended entry in `fixtures/csv/README.md`.

## Decisions (11 Nov 2026)
1. **`category_mappings` is rebuilt, not altered.** The 0001 table (one global joined string) was never written by code (the same precedent as 0006), and SQLite cannot drop its unique key in place, so 0008 drops it and creates the new one. `RemoveCategory` already moved or nulled `category_mappings.category_id`; the same statements work on the new table (the 0.4 test now inserts a mapping with a user and the two parts).
2. **The source pair of a row is two columns on `transactions`, not parsed from `raw_payload`.** The raw row is keyed by the file's own header names, which differ per file and per mapping, so reading the pair back from it would be a guess; the two short strings are no personal data and only exist for rows of a file with category columns. Rows imported before this phase have none and a re-apply never touches them.
3. **Re-apply also takes uncategorised rows without origin that carry a pair.** A skipped pair leaves a row with no category and no origin (the `import` origin is for a category the import set), so without this a skip could never be changed into a target later. A row a rule or a suggestion categorised since, or one the user picked, has an origin and stays.
4. **Only the choices sent are applied and saved.** The wizard sends one choice per pair, with the pre-selected value (saved, suggestion or Niet categoriseren) made visible; a pair without a choice (an API client) stays uncategorised and is not saved. Saved pairs of other files are kept; `PUT` is an upsert and nothing deletes a saved pair.
5. **Account rules still apply to rows without a category from the mapping** (a skipped or unmapped pair), as for every new row since 0.4-2; `categorised` counts every new row that has a category, whatever set it.
6. **Suggestion by name** (`categorise.SuggestTarget`, no dependency): case, accents and punctuation ignored; an equal name beats one that contains the other (either way, four letters or more), which beats a shared word of four letters; a pair with a subcategory looks at the subcategory over the whole tree first (a small bonus under the same main category), then at the main category alone over the main categories. The first in tree order wins a tie. A suggestion is pre-selected and labelled, never sent unseen. With the default tree, `bilance-voorbeeld.csv` gets 8 of its 12 pairs a suggestion (see the fixtures README).
7. **Nothing found defaults to Niet categoriseren**, not to a new category as in the mockup, so no category is ever created without the user choosing it.
8. **Create:** a subcategory takes its parent's type and colour (no colour is chosen per sub); a new main category is `expense` unless the pairs going into it add up to income (the web sends that `type`; the server defaults to `expense`) and has the default colour. The new category cannot be a subcategory of another new category, only of an existing main category. Several `create` choices with the same name, parent and type share one new category, which "per hoofdcategorie" needs.
9. **Per hoofdcategorie** works on the pairs with both parts, per main category; a pair with one part stands alone. A group starts with the target its pairs share, else with Niet categoriseren. Turning it off brings the per-pair choices back.
10. **Rows without any category** (both parts empty, such as the transfer in the fixture) are fixed on Niet categoriseren, as in the mockup.
11. **Edit later and re-apply: API only.** `GET`/`PUT /api/imports/mappings` and the re-apply route exist and are tested; there is no screen for them yet. The mockup's mapping dialog on a batch belongs with the batch screen of [0.5-5](05-batches-and-undo.md). 0.5-5 kept the compact history list and did not build it either. The mapping a re-apply uses is the viewer's own, whoever imported the batch.
12. **The preview validates the choices** exactly like the import (same code, rolled back), so a bad choice stops at the Controle step; the check asks again when a choice changes.
13. **Mockup deviations:** the badge reads *Opgeslagen* (mockup: *Bewaard*) and the closed select shows no colour dot (the shared Select draws the icons in its list only); *Nieuwe categorie* has a parent choice and the icon picker (the mockup makes a main category with the source name); the default of an unmatched pair is Niet categoriseren (decision 7); *Per hoofdcategorie* starts a mixed group on Niet categoriseren (the mockup takes the top category with most rows); the mockup's parent text "Deze koppeling wordt bewaard voor Bilance" is kept, with "Wat je hier kiest, wordt pas bewaard als je importeert."

## To verify
- The Categorieën step of `bilance-voorbeeld.csv` and the reuse with `bilance-tweede.csv`, by hand ([fixtures](../../fixtures/csv/README.md)).
- Whether a real Bilance export holds category names the default tree never suggests: then the suggestions stay few and the user maps by hand once.
