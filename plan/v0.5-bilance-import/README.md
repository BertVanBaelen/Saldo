# Version 0.5 · Bilance import

**After this version you can** import your full Bilance history from its CSV export, map its categories onto Saldo's, skip what is already synced, undo an import, and get better category suggestions learned from that history.

Status: built, to verify: all phases built (0.5-1 done, 0.5-2 to 0.5-6 to verify). Analysis milestones: spike S2 and M6. Roadmap: [../README.md](../README.md).

Moved before shared accounts, overview and planning on 3 Nov 2026: the bank API gives only about 90 days, and the forecast needs 12+ months to find quarterly and yearly items (risk 12). Overzicht also starts with real history this way.

## Features
| Id | Feature |
|---|---|
| PLAT-1 | Verified Bilance file layout (spike S2) |
| IMP-1 | Import wizard with a saved Bilance preset |
| IMP-2 | Category mapping: map, create, merge or leave, saved per source |
| IMP-3 | Import cutoff and probable duplicates |
| IMP-4 | Import batches with undo |
| IMP-5 | Learned category suggestions and backfill |

## Phases
| Phase | Title | Size | Features | Status |
|---|---|---|---|---|
| [0.5-1](01-spike-bilance-csv.md) | Spike S2 · Bilance CSV | S | PLAT-1 | done |
| [0.5-2](02-import-wizard.md) | Import wizard and Bilance preset | M | IMP-1 | built, to verify |
| [0.5-3](03-category-mapping.md) | Category mapping | M | IMP-2 | built, to verify |
| [0.5-4](04-overlap-and-duplicates.md) | Overlap and duplicates | M | IMP-3 | built, to verify |
| [0.5-5](05-batches-and-undo.md) | Batches and undo | S | IMP-4 | built, to verify |
| [0.5-6](06-learning-and-backfill.md) | Learning and backfill | M | IMP-5 | built, to verify |

## Concepts
import, category, categorisation-rule, transaction.

## Exit criteria
Your Bilance history is in, mapped to your categories, without duplicates, and can be undone as a whole.