# 0.3-6 · Basic CSV import

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | planned |
| Size | M |
| Features | TX-1 |
| Concepts | [import](../../analysis/concepts/import.md), [transaction](../../analysis/concepts/transaction.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.1, 4.6 |
| Depends on | [0.3-1](01-sync-engine.md) |

## Goal
A fallback when the bank API fails, and a first way to bring in older Argenta history.

## Steps
1. Upload a CSV, map the columns (date, amount, counterparty, communication), choose the target account (steps 1, 2 and 4 of the designed wizard).
2. Preset for the Argenta export.
3. Run the rows through the same pipeline and dedupe key as the sync.
4. Keep every import as a batch from the start, so 0.5 can add undo, category mapping and duplicate handling.

## Done when
An Argenta CSV export imports into the right account, and importing it again adds nothing.