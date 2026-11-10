# Category

Analysis: 4.2, 4.4, 4.6 · Data: `category`, `category_mapping` · Screens: [transacties](../screens/transacties.md), [overzicht](../screens/overzicht.md), [categorieen](../screens/categorieen.md), [importeren](../screens/importeren.md) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.4-1](../../plan/v0.4-categorisation/01-category-tree.md), [0.4-3](../../plan/v0.4-categorisation/03-categorise-in-transacties.md), [0.4-4](../../plan/v0.4-categorisation/04-categories-and-rules-screen.md), [0.5-1](../../plan/v0.5-bilance-import/01-spike-bilance-csv.md), [0.5-3](../../plan/v0.5-bilance-import/03-category-mapping.md), [0.5-6](../../plan/v0.5-bilance-import/06-learning-and-backfill.md), [0.7-1](../../plan/v0.7-overview/01-reports-api.md), [0.7-2](../../plan/v0.7-overview/02-overzicht-screen.md), [0.7-3](../../plan/v0.7-overview/03-start-spending.md)

## Rules
- One **category tree shared by all users** (names, types and colours only, no amounts). Starts from a Dutch default set (the design's tree), editable in Categorieën en regels: add, rename, move, recolour, remove. Everyone signed in may edit, for everyone.
- **Two levels**: a top category and its subcategories. A subcategory takes its parent's type and colour. A category with subcategories cannot move under another one or be removed.
- **Names**: 1 to 60 characters, unique per parent (case-insensitive). Commas, ampersands and other punctuation are plain data (`Energie, nutsvoorzieningen`, `Eten & Drinken`) and are never split.
- **Removal** says where its transactions go: to another category of the same type, or back to uncategorised. Moving them to another category is also the **merge** of two categories.
- **Counts** cover the viewer's own transactions only, directly in the category. A split transaction counts once under each category it has a part in ([transaction](transaction.md)).
- Types: income, expense. Internal transfers are recognised ([internal-transfer](internal-transfer.md)) and may still carry a category (decision 10 Nov 2026). Sums leave transfers out at query time, never by category.
- Imported (Bilance) categories are mapped onto the default set, saved per source ([import](import.md), phase 0.5-3).

## Colours
Each top category has a pastel. Text on a pastel is always `--onPastel`.

| Category | Token | Light | Dark |
|---|---|---|---|
| Wonen | `--c1` | #BFE0FF | #7DBDF0 |
| Boodschappen | `--c2` | #FFD59E | #F2B35E |
| Vrije tijd | `--c3` | #FFC6DC | #F08FB7 |
| Vervoer | `--c4` | #D8CCFF | #AE9BF7 |
| Abonnementen | `--c5` | #FFE58A | #E8CB55 |
| Overig | `--c6` | #E2E8E4 | #3A4741 (text `--text`) |

Income (Salaris, Terugbetaling, Bijdrage) and "Gespaard" (transfer to savings) use the green soft tint (`--soft` / `--greenText`). The quick picker in Transacties offers the six expense categories above; the full tree is in the category filter and in Categorieën en regels.

## In the design
- Chip: 14/600, padding 7×12, radius 999.
- Spending card on Start: a stacked 12 px bar of category shares, then rows with dot, name, share % and amount.

## Demo spending November (Alles, € 1.852,37)
Wonen € 1.150,00 · Boodschappen € 412,80 · Vrije tijd € 138,20 · Vervoer € 96,40 · Abonnementen € 54,97. Persoonlijk € 1.251,59, Gedeeld € 600,78.
