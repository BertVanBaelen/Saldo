# 0.5.1-4 · Two-step category picker

| | |
|---|---|
| Version | [0.5.1](README.md) |
| Size | M |
| Builds on | [0.5.1-2](02-emoji-icons.md), [0.5.1-3](03-colours.md) |
| Replaces | the chip row of main categories plus the "Alle categorieën" dropdown in the transaction detail (0.4-3), and `CatSelect` in the split editor |

## Goal
Find a category on a transaction by looking, not scrolling: first a grid of main categories, then its subcategories.

## Behaviour (`web/src/components/CategoryPicker.tsx`, inline, no second `Sheet`)
- **Step 1, main categories:** a grid of tiles (emoji in the colour tile, name). The type shown follows the amount (expense for a negative amount, income for a positive one), with a clear link "Toon inkomsten" / "Toon uitgaven" to reach the other type. A tile whose category has subcategories shows a chevron and opens step 2; a tile without subcategories picks it at once. The current main category is marked; when the current category is a subcategory its main tile is marked and its name is shown under the grid ("Wonen › Energie").
- **Step 2, subcategories:** a "‹ Terug" button and the main category as header; first row "Alleen *Wonen*" (picks the main category itself, as before), then one row per subcategory (emoji tile, name, check on the current one). Tapping a row picks it. Back returns to step 1. Escape is not handled here (the surrounding sheet owns it).
- **`data-key` rules (fixes an ambiguity):** `data-key="pick-<id>"` goes ONLY on controls that pick a category: a main tile without subcategories, the "Alleen *Wonen*" row (its id is the main category's) and each subcategory row. A main tile that opens step 2 gets its own key, `open-<id>`, and the "‹ Terug" button `back`. Existing tests click `pick-<top id>` and expect a save; nearly every default main category has subcategories, so **rewrite those tests as two taps** (`open-<id>`, then `pick-<id>` of the "Alleen" row or a sub) and keep their assertions as strong as before, do not weaken them.
- **State after a pick:** the picker keeps its current step, marks the chosen category (check) while the save runs (`aria-busy`) and after the row re-renders with the new category; it goes back to step 1 only when it is reopened or the transaction changes.
- **Kept from before:** `aria-pressed`, `aria-disabled` when the row is read-only or offline, `aria-busy` while saving, the loading skeleton, the error with "Opnieuw proberen", the empty state with the link to Categorieën. Picking calls the same `pick(id)` as today, so "apply to similar and create a rule" and its preview are untouched.
- **Split parts:** each part shows a button with the chosen category (emoji tile and "Wonen › Energie", or "Kies een categorie") that opens the same picker inline under that part; choosing closes it. `CatSelect` is deleted.
- **Out of scope:** the Transacties category filter and the import mapping keep their dropdown (with emoji from 0.5.1-2); no recents row, no search.
- **Accessibility:** tiles are buttons in a labelled group, focus moves to the first row of step 2 and back to the tile on Back, targets at least 44 px, works at 375 px width.

## Steps
1. `CategoryPicker.tsx` and its CSS (move the `tx-picks` and `tx-pick` rules out of `Transacties.css` where they belong to it).
2. `TransactieDetail.tsx`: use it in the edit body and in the split editor; delete the chip row, `CatSelect` and the leftovers.
3. Tests: `components/CategoryPicker.test.tsx` (type by amount sign and the toggle, a main without subs picks at once, drill-down and back, the "Alleen" row, current subcategory marked, disabled/busy/loading/error/empty); update `pages/TransactieDetail.test.tsx` and `Transacties.test.tsx` for the new structure (existing tests rely on `data-key="pick-…"`, keep it).

## Done when
In the detail you reach any category in two taps, a main category can be chosen alone, and the split editor uses the same picker. `cd web && npx tsc -b --noEmit && npx vitest run` passes.
