# Category

Analysis: 4.2, 4.4, 4.6 · Data: `category`, `category_mapping` · Screens: [transacties](../screens/transacties.md), [overzicht](../screens/overzicht.md), [categorieen](../screens/categorieen.md), [importeren](../screens/importeren.md) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-6](../../plan/v0.1-mockup/06-missing-designs.md), [0.2-2](../../plan/v0.2-foundation/02-spike-bilance-csv.md), [0.4-1](../../plan/v0.4-categorisation/01-category-tree.md), [0.4-3](../../plan/v0.4-categorisation/03-categorise-in-transacties.md), [0.4-4](../../plan/v0.4-categorisation/04-categories-and-rules-screen.md), [0.6-1](../../plan/v0.6-overview/01-reports-api.md), [0.6-2](../../plan/v0.6-overview/02-overzicht-screen.md), [0.6-3](../../plan/v0.6-overview/03-start-live.md), [0.9-2](../../plan/v0.9-bilance-import/02-category-mapping.md), [0.9-5](../../plan/v0.9-bilance-import/05-learning-and-backfill.md)

## Rules
- One **category tree shared by all users** (names and types only, no amounts). Starts from a Dutch default set, editable.
- Types: income, expense. Internal transfers are not categorised but recognised ([internal-transfer](internal-transfer.md)).
- Imported (Bilance) categories are mapped onto app categories, saved per source ([import](import.md)).

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

Income (Salaris, Terugbetaling) and "Gespaard" (transfer to savings) use the green soft tint (`--soft` / `--greenText`). The category picker in Transacties offers only the six expense categories above.

## In the design
- Chip: 14/600, padding 7×12, radius 999.
- Spending card on Start: a stacked 12 px bar of category shares, then rows with dot, name, share % and amount.

## Demo spending November (Alles, € 1.852,37)
Wonen € 1.150,00 · Boodschappen € 412,80 · Vrije tijd € 138,20 · Vervoer € 96,40 · Abonnementen € 54,97. Persoonlijk € 1.251,59, Gedeeld € 600,78.
