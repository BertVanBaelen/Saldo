# 0.5-1 · Spike S2 · Bilance CSV

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | planned (can be done any time before 0.5-2) |
| Size | S |
| Features | PLAT-1 |
| Concepts | [import](../../analysis/concepts/import.md), [category](../../analysis/concepts/category.md), [transaction](../../analysis/concepts/transaction.md) |
| Analysis | 4.6, 13.1, risks 1, 10 |
| Depends on | – |

## Goal
Know the exact layout of the Bilance export, so the import is built around the real file.

## Steps
1. Export the full history from Bilance as CSV.
2. Note the columns, the category format (flat or `Parent > Child`), date and amount formats, encoding and separator.
3. Make an anonymised sample (no real names, IBANs or identifying amounts) for tests. Only the sample is committed (public repository).

## Done when
The Bilance preset is known and import and analysis 4.6 are updated.