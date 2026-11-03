# Version 0.9 · Bilance import

**After this version you can** import your full Bilance history from its CSV export, map its categories onto Saldo's, skip what is already synced, undo an import, and get better category suggestions learned from that history.

Status: planned. Analysis milestone: M6. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| IMP-1 | Import wizard with a saved Bilance preset |
| IMP-2 | Category mapping: map, create, merge or leave, saved per source |
| IMP-3 | Import cutoff and probable duplicates |
| IMP-4 | Import batches with undo |
| IMP-5 | Learned category suggestions and backfill |

## Phases
| Phase | Title | Features | Status |
|---|---|---|---|
| [0.9-1](01-import-wizard.md) | Import wizard | IMP-1 | planned |
| [0.9-2](02-category-mapping.md) | Category mapping | IMP-2 | planned |
| [0.9-3](03-overlap-and-duplicates.md) | Overlap and duplicates | IMP-3 | planned |
| [0.9-4](04-batches-and-undo.md) | Batches and undo | IMP-4 | planned |
| [0.9-5](05-learning-and-backfill.md) | Learning and backfill | IMP-5 | planned |

## Concepts
import, category, categorisation-rule, transaction.

## Exit criteria
Your Bilance history is in, mapped to your categories, without duplicates, and can be undone as a whole.
