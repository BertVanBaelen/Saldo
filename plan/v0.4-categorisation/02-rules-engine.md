# 0.4-2 · Rules engine

| | |
|---|---|
| Version | [0.4 Categorisation](README.md) |
| Status | planned |
| Size | M |
| Features | CAT-2 |
| Concepts | [categorisation-rule](../../analysis/concepts/categorisation-rule.md), [transaction](../../analysis/concepts/transaction.md) |
| Analysis | 4.2 |
| Depends on | [0.4-1](01-category-tree.md) |

## Goal
Most transactions get the right category without you doing anything.

## Steps
1. `rule` table: owner (account or user), priority, conditions (counterparty name or IBAN, communication contains or regex, amount range), category.
2. Store the category origin on every transaction (manual, rule, suggestion, import) and the rule that set it.
3. Apply rules on every new transaction and on demand. Precedence: manual > highest-priority rule > suggestion. Re-running never overwrites a manual choice.
4. Table tests for matching and precedence.

## Done when
New synced transactions are categorised by your rules, and the tests prove manual choices stay.