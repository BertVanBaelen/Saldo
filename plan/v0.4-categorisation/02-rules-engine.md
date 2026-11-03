# 0.4-2 · Rules engine

| | |
|---|---|
| Version | [0.4 Categorisation](README.md) |
| Status | planned |
| Features | CAT-2 |
| Concepts | [categorisation-rule](../../analysis/concepts/categorisation-rule.md), [transaction](../../analysis/concepts/transaction.md) |
| Analysis | 4.2 |
| Depends on | 0.4-1 |

## Goal
Most transactions get the right category without you doing anything.

## Steps
1. `rule` table: owner (account or user), priority, conditions (counterparty name or IBAN, communication regex, amount range), category.
2. Apply rules on every new transaction and on demand.
3. Precedence: manual > highest-priority rule > suggestion. Re-running never overwrites a manual choice.
4. Table tests for matching and precedence.

## Done when
New synced transactions are categorised by your rules, and the tests prove manual choices stay.
