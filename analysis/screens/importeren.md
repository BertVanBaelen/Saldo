# Importeren (wizard)

Analysis: 4.6, 12 (screen 9) · Design: to design · Concepts: [import](../concepts/import.md), [category](../concepts/category.md), [transaction](../concepts/transaction.md) · Phases: [0.1-6](../../plan/v0.1-mockup/06-missing-designs.md), [0.3-5](../../plan/v0.3-bank-sync/05-csv-import.md), [0.9-1](../../plan/v0.9-bilance-import/01-import-wizard.md), [0.9-2](../../plan/v0.9-bilance-import/02-category-mapping.md), [0.9-3](../../plan/v0.9-bilance-import/03-overlap-and-duplicates.md), [0.9-4](../../plan/v0.9-bilance-import/04-batches-and-undo.md)

## Content to design
File → column mapping → **category mapping table** (source category, transactions, total, target) → preview with probable duplicates and import cutoff → result with undo.
