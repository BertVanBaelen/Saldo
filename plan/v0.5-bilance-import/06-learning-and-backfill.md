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

## Carried over from 0.4 (10 Nov 2026)
- **Simple suggestions already exist (0.4-4):** `GET /api/suggestions` offers, per counterparty, the category the user chose most often, for the rows that still wait. Offered when seen ≥ 2 (`categorise.MinSeen`), confidence ≥ 40 (`categorise.MinConfidence`) and at least one open row. They are computed on every read; only the decisions (`dismissed`, `confirmed`) are stored in `category_suggestions`, per user, counterparty and category (migration 0006). See [docs/api.md](../../docs/api.md), "Suggestions".
- **0.5-6 extends rather than restarts:** build on `categorise.Suggest` and the same endpoints and decisions, not on a second model.
- **A confirmed suggestion does not apply to future rows yet:** confirming categorises the rows that wait then, with origin `suggestion`, never over a rule's or a manual category. Rows that arrive later need a rule, so offer it as a rule ("Als regel") instead of applying it silently.
- **Training data:** rows of origin `manual` or `import` (categories set by a rule or a suggestion are echoes and do not count). Mapped Bilance categories (origin `import`, 0.5-3) therefore already feed it. Pending rows with a manual category count as training until they are booked (a small, short-lived effect).
- **The thresholds are generous:** a 1:1 split between two categories is offered at 50 percent. They may be raised once there is real Bilance history.