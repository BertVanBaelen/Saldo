# 0.5-3 · Transfer detection and saved

| | |
|---|---|
| Version | [0.5 Shared accounts](README.md) |
| Status | planned |
| Features | SHARE-4 |
| Concepts | [internal-transfer](../../analysis/concepts/internal-transfer.md), [transaction](../../analysis/concepts/transaction.md) |
| Screens | [transacties](../../analysis/screens/transacties.md) |
| Analysis | 4.3, 5.2 |
| Depends on | 0.5-2 |

## Goal
Money moving between your own accounts is not income or spending.

## Steps
1. Per-viewer, query-time detection: counterparty IBAN is an account you can see, or an opposite amount on another of your accounts within about 3 days.
2. Transfers to savings shown as "Gespaard"; your contribution as "Naar gedeelde rekening" in Persoonlijk.
3. "Is een overschrijving" / "Is geen overschrijving" per user [S].
4. Table tests, including that the other user's accounts are never used for matching.

## Done when
Your transfer to savings and to the shared account no longer show up as expenses in Alles.
