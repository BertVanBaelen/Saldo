# 0.5-4 · Overlap and duplicates

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | planned |
| Size | M |
| Features | IMP-3 |
| Concepts | [import](../../analysis/concepts/import.md), [transaction](../../analysis/concepts/transaction.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.6, risk 11 |
| Depends on | [0.5-2](02-import-wizard.md) |

## Goal
Old history from Bilance and recent history from the bank fit together without double counting.

## Steps
1. Suggested import cutoff = first synced date of the target account.
2. Probable duplicates: booking date ±1 day, same amount, similar counterparty; shown side by side in the preview, skipped by default.
3. For a skipped duplicate, apply the Bilance category to the existing transaction if it is uncategorised.

## Done when
Importing a file that overlaps the synced period adds only the older rows.

## Carried over from 0.3
- 0.3-6 already skips exact matches (booking date, amount, counterparty and communication equal, counted per occurrence), at import and in the sync. This phase adds the fuzzy part: booking date ±1 day and a similar counterparty.
- **Step 1 conflicts with the 0.3-6 fallback use.** A cutoff at the first synced date would block importing the rows after a failed sync. Offer the cutoff only for Bilance files, never for the generic CSV import.
- The preview already warns when new rows fall in the period the account syncs (counts only); the side-by-side view of probable duplicates can replace that warning for Bilance files.
