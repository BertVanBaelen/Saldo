# 0.9-2 · Category mapping

| | |
|---|---|
| Version | [0.9 Bilance import](README.md) |
| Status | planned |
| Features | IMP-2 |
| Concepts | [import](../../analysis/concepts/import.md), [category](../../analysis/concepts/category.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.6, risk 10 |
| Depends on | 0.9-1, 0.4-1 |

## Goal
Bilance categories land in Saldo's own categories.

## Steps
1. Table of distinct source categories with transaction count and total.
2. Per category: map (with a name-similarity suggestion), create new, merge several into one, or leave uncategorised.
3. Full path by default; "map by parent" for all children at once.
4. `category_mapping` saved per source and reused; edit later and re-apply to an import.

## Done when
A second import of a Bilance file needs no new mapping.
