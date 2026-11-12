# 0.4-1 · Category tree

| | |
|---|---|
| Version | [0.4 Categorisation](README.md) |
| Status | built (10 Nov 2026), to verify: server only, the screen is 0.4-4 |
| Size | S |
| Features | CAT-1 |
| Concepts | [category](../../analysis/concepts/category.md) |
| Screens | [categorieen](../../analysis/screens/categorieen.md) |
| Analysis | 4.2 |
| Depends on | [0.3-3](../v0.3-bank-sync/03-transacties.md) |

## Goal
One category tree that all users share, with names, types and colours but no amounts.

## Steps
1. `category` table: name, parent, type (income or expense), colour.
2. Dutch default set seeded on first start (Wonen, Boodschappen, Vrije tijd, Vervoer, Abonnementen, Overig with their subcategories; Salaris, Terugbetaling, Bijdrage, Overig inkomen) with the pastel colours from the design.
3. API to add, rename, move, recolour and remove categories; removing asks where its transactions go.

## Done when
The default tree is there after install and can be edited.

## Built (10 Nov 2026)
Server side; the contract is in [docs/api.md](../../docs/api.md), "Categories". No web change in this phase.
- **Table:** the existing `categories` table (no migration for the tree). Default set seeded in Go, `categorise.SeedDefaults` (`server/internal/categorise`), from main after the migrations and from the demo seed: once, only on an empty table, marked with `app_settings.categories_seeded`. The set is one Go slice, `categorise.Defaults`, the design's TREE: expense tops 1–6 (Wonen, Boodschappen, Vrije tijd, Vervoer, Abonnementen, Overig), income tops 7–10 (Salaris, Terugbetaling, Bijdrage, Overig inkomen, `soft`), then the subcategories. The demo uses the same tree; its history stays on the top categories, so its numbers did not change.
- **Endpoints:** `GET /api/categories` (flat, tree order, `count` = the viewer's own transactions directly in the category), `POST`, `PATCH /api/categories/{id}`, `DELETE /api/categories/{id}?moveTo=<id>|none`.
- **Tests:** seeding (ids, idempotent, no resurrection, marker only on an existing tree), the tree API (validation, inheritance, recolour cascade, moves, names with commas and `&`), removal across both users with every dependent table, atomic removal, counts per viewer, `401` and CSRF.

## Decisions (10 Nov 2026)
1. **Two levels**, a subcategory has its parent's type and colour (stored on the sub row too and kept equal). Expense tops take `c1`–`c6`, income is `soft`. A category with subcategories cannot move under another one or be removed. The analysis states no depth; the design ("Saldo heeft twee niveaus") and Bilance have two. No conflict found.
2. **Names:** trimmed, white space collapsed, 1–60 characters, no control characters; punctuation is data. Unique per parent, case-insensitive (the existing index; so an income top and an expense top cannot share a name, where the design compared per type too).
3. **Who:** anyone signed in adds, renames, moves, recolours and removes, for everyone ("Iedereen ziet dezelfde categorieën"). Nothing in a response, error or the audit log tells a user about another user's transactions.
4. **Removal** re-points everything in one database transaction instead of relying on the foreign keys (which would delete rules, splits and budgets and lift children to the top): transactions of every user keep their origin and rule, splits, rules, budgets (`UPDATE OR IGNORE`), mappings and suggestions follow. `none` uncategorises, deletes the category's rules, budgets and suggestions and turns mappings into "leave uncategorised"; refused while a split part uses it. This is the merge 0.5-3 needs. Audit-logged as `category_removed` with ids only.
5. **No reorder API:** a new category goes last among its siblings.

## Decided (10 Nov 2026)
- The default set stays the mockup tree, as built. The 0.5 import maps Bilance's two-level categories onto it ([0.5-3](../v0.5-bilance-import/03-category-mapping.md)); merging is the category removal with `moveTo`.

## Added after 0.4 testing (11 Nov 2026): category icons (CAT-6)
Every category and subcategory gets an icon; the colour stays that of the main category. Migration `0007_category_icons.sql` adds a nullable `icon TEXT` (no rebuild, no data change) and backfills the seeded default tree of an existing install by name and parent name where `icon IS NULL`; a renamed category stays `NULL` and the web shows `tag`. `categorise.Defaults` carries an icon for every default category and subcategory, so a new database starts with them. The allowed names are one Go list, `categorise.CategoryIcons` with `ValidIcon` (`server/internal/categorise/icons.go`, 49 names), mirrored in `web/src/lib/categoryIcons.ts`; a Go test fails when the two differ. API: `icon` (string or `null`) on every category; accepted on create and change, an unknown name answers `400`, `null` or `""` clears it, leaving it out of a change keeps it ([docs/api.md](../../docs/api.md), "Categories").
