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