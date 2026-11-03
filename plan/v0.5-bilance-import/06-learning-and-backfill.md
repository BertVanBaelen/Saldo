# 0.5-6 · Learning and backfill

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | planned |
| Size | M |
| Features | IMP-5 |
| Concepts | [categorisation-rule](../../analysis/concepts/categorisation-rule.md), [category](../../analysis/concepts/category.md), [import](../../analysis/concepts/import.md) |
| Screens | [categorieen](../../analysis/screens/categorieen.md) |
| Analysis | 4.2 (learning), risk 9 |
| Depends on | [0.5-3](03-category-mapping.md), [0.4-4](../v0.4-categorisation/04-categories-and-rules-screen.md) |

## Goal
Use years of categorised Bilance history to categorise new transactions better.

## Steps
1. Counterparty → most frequent category, with a confidence level; mapped imported categories count as training data.
2. High-confidence suggestions offered as rules; low confidence only for confirmation, never applied silently.
3. Backfill: suggestions for uncategorised synced history.

## Done when
After the Bilance import, the number of uncategorised transactions drops and every change was confirmed or rule-based.