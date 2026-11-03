# 0.9-4 · Batches and undo

| | |
|---|---|
| Version | [0.9 Bilance import](README.md) |
| Status | planned |
| Features | IMP-4 |
| Concepts | [import](../../analysis/concepts/import.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.6 |
| Depends on | 0.9-3 |

## Goal
Every import can be reversed in one step.

## Steps
1. `import_batch`: source, file hash, account, created by, created at, undone at.
2. Undo removes the batch's transactions (and only those).
3. Re-importing the same file adds nothing (file hash and dedupe key).
4. Import history with undo in the Importeren screen.

## Done when
Import, undo and re-import leave the data exactly as before the first import plus the file once.
