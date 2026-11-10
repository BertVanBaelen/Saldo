# 0.5-2 · Import wizard and Bilance preset

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | planned |
| Size | M |
| Features | IMP-1 |
| Concepts | [import](../../analysis/concepts/import.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.6 |
| Depends on | [0.3-6](../v0.3-bank-sync/06-csv-import.md), [0.5-1](01-spike-bilance-csv.md) |

## Goal
A step-by-step import with a preview before anything is written.

## Steps
1. The full wizard as designed: file → columns → categories → preview → result.
2. Column mapping for date, amount, counterparty, communication, category, account; target account, or accounts from a column.
3. Saved "Bilance" preset from spike S2.

## Done when
A Bilance export reaches the preview step with all columns recognised by the preset.

## Carried over from 0.3
- The 0.3-6 wizard has four steps (Bestand, Kolommen, Controle, Klaar) and no override of the parse settings. The mockup shows a manual choice of delimiter, encoding, date format and decimal separator: build it here, next to the categories step and "accounts from a column".
- The Argenta preset was built from the header only. After the real-data check in [0.3-6](../v0.3-bank-sync/06-csv-import.md#to-verify-with-real-data), add a `Referentie` mapping field if it equals the sync's `external_id`, and `Beschrijving` as a fallback for an empty `Mededeling`, if the real rows call for it.
