# 0.4-4 · Categorieën en regels screen

| | |
|---|---|
| Version | [0.4 Categorisation](README.md) |
| Status | planned |
| Size | M |
| Features | CAT-5 |
| Concepts | [category](../../analysis/concepts/category.md), [categorisation-rule](../../analysis/concepts/categorisation-rule.md) |
| Screens | [categorieen](../../analysis/screens/categorieen.md), [meer](../../analysis/screens/meer.md) |
| Analysis | 4.2 |
| Depends on | [0.4-3](03-categorise-in-transacties.md) |

## Goal
See and manage all categories and rules in one place.

## Steps
1. Category tree editor as designed.
2. Rules list with priority (reorder), owner and conditions; the rule editor with a live preview; edit and delete.
3. Simple suggestions from history (counterparty → most frequent category, with confidence) in `category_suggestion`; low confidence only for confirmation; "N suggesties om te bevestigen" in Meer. Full learning follows in 0.5-6.

## Done when
Every rule can be found, changed and reordered, and suggestions can be confirmed or dismissed for good.