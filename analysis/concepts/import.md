# Import batch (CSV, Bilance)

Analysis: 4.1 (CSV fallback), 4.6, risks 1, 10, 11 · Data: `import_batch`, `category_mapping` · Screens: [importeren](../screens/importeren.md) · Phases: [0.1-6](../../plan/v0.1-mockup/06-missing-designs.md), [0.2-2](../../plan/v0.2-foundation/02-spike-bilance-csv.md), [0.3-5](../../plan/v0.3-bank-sync/05-csv-import.md), [0.9-1](../../plan/v0.9-bilance-import/01-import-wizard.md), [0.9-2](../../plan/v0.9-bilance-import/02-category-mapping.md), [0.9-3](../../plan/v0.9-bilance-import/03-overlap-and-duplicates.md), [0.9-4](../../plan/v0.9-bilance-import/04-batches-and-undo.md), [0.9-5](../../plan/v0.9-bilance-import/05-learning-and-backfill.md)

## Wizard steps
1. Pick the file (CSV; Bilance export uses a saved "Bilance" preset).
2. Map columns: date, amount, counterparty, communication, category, account. Choose the target account.
3. **Category mapping**: every distinct source category with its transaction count and total. Per category: map to an existing category (name-similarity suggestion), create new, merge several into one, or leave uncategorised. Paths like `Parent > Child` map on the full path by default, "map by parent" maps all children at once.
4. Preview with **probable duplicates** (booking date ±1 day, same amount, similar counterparty), skipped by default. Suggested **import cutoff** = first synced date of the target account. For a skipped duplicate the source category may be applied to the existing transaction if it is uncategorised.
5. Result with **undo**.

## Rules
- Every import is a **batch** that can be undone as a whole. Re-importing the same file creates no duplicates (dedupe key, file hash).
- Mappings are saved per source and reused; changing a mapping can be re-applied to that import.
- Mapped imported categories feed the learning ([categorisation-rule](categorisation-rule.md)).
- Bilance CSV layout is unverified **[verify]** (spike S2, phase 0.2-2).

## In the design
Not designed yet. Meer row: "Importeren · CSV-bestand, bv. de export uit Bilance" with an upload icon on `--c4`.
