# 0.4-1 · Category tree

| | |
|---|---|
| Version | [0.4 Categorisation](README.md) |
| Status | planned |
| Features | CAT-1 |
| Concepts | [category](../../analysis/concepts/category.md) |
| Analysis | 4.2 |
| Depends on | 0.3-6 |

## Goal
One category tree that both users share, with names, types and colours but no amounts.

## Steps
1. `category` table: name, parent, type (income or expense), colour.
2. Dutch default set seeded on first start (Wonen, Boodschappen, Vrije tijd, Vervoer, Abonnementen, Overig, Salaris, Terugbetaling …) with the pastel colours from the design.
3. API to add, rename, move and remove categories; removing asks where its transactions go.

## Done when
The default tree is there after install and can be edited.
