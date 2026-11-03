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