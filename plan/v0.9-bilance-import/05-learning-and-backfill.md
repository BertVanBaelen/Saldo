# 0.9-5 · Learning and backfill

| | |
|---|---|
| Version | [0.9 Bilance import](README.md) |
| Status | planned |
| Features | IMP-5 |
| Concepts | [categorisation-rule](../../analysis/concepts/categorisation-rule.md), [category](../../analysis/concepts/category.md), [import](../../analysis/concepts/import.md) |
| Screens | [categorieen](../../analysis/screens/categorieen.md) |
| Analysis | 4.2 (learning), risk 9 |
| Depends on | 0.9-2, 0.4-4 |

## Goal
Use years of categorised history to suggest categories for new and old transactions.

## Steps
1. Counterparty → most frequent category, with a confidence level; mapped imported categories count as training data.
2. High-confidence suggestions offered as rules; low confidence only for confirmation, never applied silently.
3. Backfill: suggestions for uncategorised synced history.

## Done when
After the Bilance import, the number of uncategorised transactions drops and every change was confirmed or rule-based.
