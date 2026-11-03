# 0.9-3 · Overlap and duplicates

| | |
|---|---|
| Version | [0.9 Bilance import](README.md) |
| Status | planned |
| Features | IMP-3 |
| Concepts | [import](../../analysis/concepts/import.md), [transaction](../../analysis/concepts/transaction.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.6, risk 11 |
| Depends on | 0.9-1 |

## Goal
Old history from Bilance and recent history from the bank fit together without double counting.

## Steps
1. Suggested import cutoff = first synced date of the target account.
2. Probable duplicates: booking date ±1 day, same amount, similar counterparty; shown in the preview, skipped by default.
3. For a skipped duplicate, apply the Bilance category to the existing transaction if it is uncategorised.

## Done when
Importing a file that overlaps the synced period adds only the older rows.
