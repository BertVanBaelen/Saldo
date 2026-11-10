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

## Notes from 0.4-1 and 0.4-2 (10 Nov 2026)
- **Still to build on the server:** reorder (a permutation of the `priority` values among the viewer's visible rules: the server reassigns those values in the new order, so rules the viewer cannot see keep theirs) and the live preview of a rule ("Past op N transacties", only over the viewer's own rows, through the same `categorise.Match`). The tree, rule CRUD and `POST /api/rules/apply` exist (docs/api.md).
- **Suggestions** must write through `categorise.Assign` with origin `suggestion`: it never replaces a rule's or a manual category.
- **Names with punctuation:** Bilance names contain commas and `&` (`Energie, nutsvoorzieningen`, `Eten & Drinken`). No UI or CSV code may split a category name on commas. For the 0.5-3 mapping, store the source path as two parts (top and sub), not one joined string, because a name may contain any punctuation, ` / ` included.
