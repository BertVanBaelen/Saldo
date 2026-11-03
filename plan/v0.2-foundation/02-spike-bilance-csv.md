# 0.2-2 · Spike S2 · Bilance CSV

| | |
|---|---|
| Version | [0.2 Foundation](README.md) |
| Status | planned |
| Features | PLAT-1 |
| Concepts | [import](../../analysis/concepts/import.md), [category](../../analysis/concepts/category.md), [transaction](../../analysis/concepts/transaction.md) |
| Analysis | 4.6, 13.1, risks 1, 10 |
| Depends on | – (can run alongside 0.1) |

## Goal
Know the exact layout of the Bilance export, so the import wizard (0.9) is designed around the real file.

## Steps
1. Export the full history from Bilance as CSV.
2. Note the columns, the category format (flat or `Parent > Child`), date and amount formats, encoding and separator.
3. Make an anonymised sample (no real names) for tests.

## Done when
The Bilance preset is known and [import](../../analysis/concepts/import.md) and analysis 4.6 are updated.
