# 0.3-5 · Basic CSV import

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | planned |
| Features | TX-1 |
| Concepts | [import](../../analysis/concepts/import.md), [transaction](../../analysis/concepts/transaction.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.1, 4.6 |
| Depends on | 0.3-3 |

## Goal
A fallback when the bank API fails, and a first way to bring in older history.

## Steps
1. Upload a CSV, map the columns (date, amount, counterparty, communication), choose the target account.
2. Preset for the Argenta export.
3. Run the rows through the same pipeline and dedupe key as the sync.
4. Keep it as a batch from the start, so 0.9 can add undo and category mapping.

## Done when
An Argenta CSV export imports into the right account, and importing it again adds nothing.
