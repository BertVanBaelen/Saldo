# Importeren (wizard)

Analysis: 4.6, 12 (screen 9) · Design: in the mockup (`finance-mockup/importeren.html`, `js/screens/importeren.js`), derived from the analysis, not on the design boards · Concepts: [import](../concepts/import.md), [category](../concepts/category.md), [transaction](../concepts/transaction.md) · Phases: [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.3-6](../../plan/v0.3-bank-sync/06-csv-import.md), [0.5-2](../../plan/v0.5-bilance-import/02-import-wizard.md), [0.5-3](../../plan/v0.5-bilance-import/03-category-mapping.md), [0.5-4](../../plan/v0.5-bilance-import/04-overlap-and-duplicates.md), [0.5-5](../../plan/v0.5-bilance-import/05-batches-and-undo.md)

## Content to design
File → column mapping → **category mapping table** (source category, transactions, total, target) → preview with probable duplicates and import cutoff → result with undo.

**In 0.3-6** (built 9 Nov 2026, `web/src/pages/Importeren.tsx`): the wizard has four steps, *Bestand* (what the server found in the file), *Kolommen* (the column mapping and the target account), *Controle* (counts: new, already in Saldo, unreadable) and *Klaar* (the batch), plus the import history on the start view. The designed wizard still lacks the category mapping table, probable duplicates per row and the import cutoff, undo, the Bilance preset, and importing into a new account (the empty state of the mockup); they come in [0.5](../../plan/v0.5-bilance-import/README.md).
