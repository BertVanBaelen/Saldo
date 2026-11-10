# 0.5-3 · Category mapping

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | planned |
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