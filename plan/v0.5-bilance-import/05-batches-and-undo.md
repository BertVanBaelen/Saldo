# 0.5-5 · Batches and undo

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | planned |
| Size | S |
| Features | IMP-4 |
| Concepts | [import](../../analysis/concepts/import.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.6 |
| Depends on | [0.5-4](04-overlap-and-duplicates.md) |

## Goal
Every import can be reversed in one step.

## Steps
1. `import_batch`: source, file name and hash, account, created by, created at, undone at, row counts.
2. Undo removes the batch's transactions (and only those).
3. Re-importing the same file adds nothing (file hash and dedupe key) and says so.
4. Import history with undo in the Importeren screen.

## Done when
Import, undo and re-import leave the data exactly as before the first import plus the file once.

## Carried over from 0.3
- `import_batches` (source, file name, SHA-256, account, created by, undone at, counts), the history list and the 0.3-6 re-import rule (an identical file adds nothing and makes a batch with 0 new rows) already exist, so steps 1, 3 and most of 4 are done. What is left: the undo itself, and what to do with 0-row batches.
- Deleting a batch also deletes the categories set on its rows (`transactions.import_batch_id` cascades): say so in the confirmation.
