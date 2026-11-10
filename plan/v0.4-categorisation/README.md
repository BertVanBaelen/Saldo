# Version 0.4 · Categorisation

**After this version you can** have your transactions categorised automatically by rules, change a category in a tap and turn that into a rule for similar transactions, split a transaction, and manage categories and rules.

Status: in progress (10 Nov 2026): the category tree (0.4-1) and the rules engine (0.4-2) are built on the server and wait for verification; Categorise in Transacties (0.4-3) and the Categorieën en regels screen (0.4-4) are planned. Analysis milestone: M2. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| CAT-1 | One shared category tree with a Dutch default set |
| CAT-2 | Rules on counterparty, communication and amount, with priorities |
| CAT-3 | Change a category, "apply to similar and create a rule", notes |
| CAT-4 | Split a transaction over categories [S] |
| CAT-5 | Categorieën en regels screen with suggestions to confirm |

## Phases
| Phase | Title | Size | Features | Status |
|---|---|---|---|---|
| [0.4-1](01-category-tree.md) | Category tree | S | CAT-1 | built, to verify |
| [0.4-2](02-rules-engine.md) | Rules engine | M | CAT-2 | built, to verify |
| [0.4-3](03-categorise-in-transacties.md) | Categorise in Transacties | M | CAT-3, CAT-4 | planned |
| [0.4-4](04-categories-and-rules-screen.md) | Categorieën en regels screen | M | CAT-5 | planned |

## Concepts
category, categorisation-rule, transaction.

## Exit criteria
A month of real transactions is categorised with few manual fixes, and a manual choice is never overwritten.