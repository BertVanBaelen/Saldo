# 0.8-0a · Saving categories ("Telt als gespaard")

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | released (0.8.0), verifying |
| Size | M |
| Features | PLAN-0 |
| Concepts | [category](../../analysis/concepts/category.md), [internal-transfer](../../analysis/concepts/internal-transfer.md), [period-overview](../../analysis/concepts/period-overview.md) |
| Screens | [categorieen](../../analysis/screens/categorieen.md), [overzicht](../../analysis/screens/overzicht.md) |
| Analysis | 4.2, 4.4, 5.2 |
| Depends on | [0.7-1](../v0.7-overview/01-reports-api.md) (`reportBucket`, `reportWorld`), [0.7-2](../v0.7-overview/02-transacties-drill-down.md) (drill-down) |

## Goal
The user's request of 17 Nov 2026: "I want to be able to assign a category or 2 to saving. If a transaction is under the saving head category it has to be counted here [Gespaard on Overzicht]. I can set this in the settings of the category." Today a row is Gespaard only when it is a **detected** transfer to an own savings or investment account (rule 2 of `reportBucket`); savings at another bank, a savings account without IBAN, Bilance rows without counterparty IBAN and "Is een overschrijving" without a partner are missed. It comes first in 0.8 because budgets, detection and the forecast read the flag.

## Rules
- **The flag.** `categories.saving` (0 or 1). Only a **top category of type expense** can carry it. A subcategory inherits it from its parent and never stores it (the reports already roll up with `COALESCE(parent_id, id)`). Income categories cannot be saving. Like the colour it is a shared setting: categories are shared by all users, every signed-in user may change it (as name, colour and icon today).
- Moving a top category under another one drops its own flag (it now inherits its new parent's). Moving a subcategory to the top gives it `saving = 0`. Changing a top category's type to income clears the flag. Removing or merging a category does not move the flag. **Budgets** (review 18 Nov 2026): setting the flag, moving a top category under another one and changing its type to income delete that category's budget rows; `RemoveCategory`'s merge moves budgets only when the target is a top expense category that is not saving, else deletes them.
- **Report rule** (one place: `reportBucket` in `ledger/reports.go`; `parts` gets a column `saving`, the top category's flag via `LEFT JOIN categories tc ON tc.id = top_id`). The new order:

  | # | Condition (row or split part) | Bucket |
  |---|---|---|
  | 1 | `is_transfer` and the other side is in the selection and its history has started (unchanged window) | left out |
  | 2 | `is_transfer` and the other side is `savings` or `investment` | saved, `-amount` |
  | 3 | **top category is saving** | **saved, `-amount`** (net: an outgoing row adds, an incoming row, a withdrawal or interest in that category, subtracts) |
  | 4 | `is_transfer` and `other_id IS NULL` (override without partner) | left out |
  | 5–9 | as in 0.7-1 (`toShared`, `toOwn`, transfer income, income category, expense category, `none`, uncategorised income) | unchanged |

  So: an internal transfer inside the selection stays left out even in a saving category (money did not leave the selection); a detected transfer to a savings account is saved once whatever its category; a saving-category row that is a transfer to a shared or own account outside the selection, an override without partner, or no transfer at all, is saved (the user's explicit choice wins over `toShared`, `toOwn`, `none` and over "left out"). **Change to 0.7-1:** a split transfer's parts' categories now matter (a part in a saving category is saved, the other parts follow rules 4–9 with their part amounts).
- Old rule 1 (`is_transfer AND (other_id IS NULL OR …)`) is split into rules 1 and 4; write the CASE in that order and keep `reportKey` unchanged (a saved row has no expense key).
- **Drill-down.** The filter for an expense key `<top id>` becomes "bucket expense and key = id, **or** bucket saved and `saving = 1` and `top_id` = id": the Transacties category filter and dropdown (which list every expense top category) then show, for a saving category, exactly the rows that count as Gespaard in it. `TestDrillDownMatchesReport` checks both halves.
- **Gespaard drill-down (user decision 18 Nov 2026).** A new key **`saved`**: the filter is "bucket saved" (`reportDrillDown` with `reportBucket(...) = 'saved'` instead of `'expense' AND key = ?`, same fragment, same selection), so it lists every row behind the Gespaard number: detected transfers to savings and investment accounts, rows and split parts in a saving category, and the rows that subtract (a withdrawal, interest in a saving category). `GET /api/transactions?category=saved&from=…&to=…[&account=…|&scope=…]`; the web URL is `/transacties?categorie=gespaard&periode=2026-10&rekening=<id>` (as `geen`, `naar-gedeeld`, `naar-eigen`). Each row shows its own signed amount (a transfer to savings −€ 200,00 in text colour as today, a withdrawal +€ 100,00); the sum of the listed rows' saved parts is the tile's amount with the sign flipped. A split row is listed once with its full amount when one of its parts is saved.
- **Consumers** follow through the same SQL: Overzicht (a saving category is no expense row; its amount is in the Gespaard tile and chart), the Start spending card (not an expense), the drill-down. Transacties' `transferKind` (0.6-3) does not change. Planning (0.8-1..0.8-3): no budget on a saving category (`400`), no variable spending from it, detection proposes kind `saving` for a group whose rows sit in a saving category.

## Data and API
- Migration `0015_category_saving.sql`: `ALTER TABLE categories ADD COLUMN saving INTEGER NOT NULL DEFAULT 0 CHECK (saving IN (0, 1));` Additive, so an older binary on a restored backup ignores it; the server keeps its pre-migration copy in `/data/backups` as for every migration.
- `GET /api/categories`: every category gets `"saving": true|false`, the **effective** value (a subcategory shows its parent's).
- `POST /api/categories` and `PATCH /api/categories/{id}` accept `saving` (boolean). Errors (`400`, Dutch, as `apperr.Invalid`): on a subcategory "Een subcategorie telt mee via haar hoofdcategorie."; on an income category "Een inkomstencategorie kan niet als gespaard tellen."
- The demo seed (`demo.go`, after `categorise.SeedDefaults`, so no default id moves) appends one top expense category **"Sparen"** (`saving = 1`, colour `c9`, icon 🏦: 🐷 is already Bijdrage's and `c5` Abonnementen's) with no rows: the demo shows the switch without changing any 0.7 number. Do **not** add it to `categorise.SeedDefaults` (`reportWorld` and the goldens use the default ids, 7 = Salaris).

## UI (Overzicht and Transacties)
- **Gespaard tile** (`Overzicht.tsx`; 0.8-0c later turns this link into a bottom sheet whose "Open in Transacties" is this URL): becomes a link (a `Link` around the tile, as the expense rows) to the drill-down for the tile's period and the account filter; it keeps its `aria-label` and adds "Bekijk de transacties." ("Gespaard in oktober: € 200,00. Bekijk de transacties."). A period with 0 saved has no link.
- **Transacties**: the chip of `categorie=gespaard` reads "Gespaard"; the dropdown does not list it (reached through the tile only, like `geen` and `naar-gedeeld`), and clearing the chip removes it. Under the list, while this filter is active, one muted note line: "Gespaard telt overschrijvingen naar je spaar- en beleggingsrekeningen en wat in een categorie staat die als gespaard telt. Een opname telt negatief." (it answers "how does it decide what is saving?").

## UI (Categorieën en regels)
- `CategorieenEditors.tsx` (`CatEditor`): for a top category of type expense, a switch row under Kleur: label "Telt als gespaard", help "Wat je in deze categorie boekt, telt in Overzicht mee als gespaard, niet als uitgave. Ook de subcategorieën." For a subcategory of a saving category a read-only line "Telt als gespaard via <hoofdcategorie>." For income categories nothing. The switch is a `role="switch"` button with `aria-checked`, reachable by keyboard, 44 px target on the phone.
- `Categorieen.tsx` tree: a small marker on saving top categories (the `piggy` icon or the text chip "gespaard", `--soft`/`--greenText`), with an `aria-label`.
- `web/src/lib/types.ts` `TreeCategory.saving: boolean`; `api.ts` create and update pass it.

## Steps
1. **Opus**: the rule (`reportParts` column `saving`, the new `reportBucket` order, the drill-down filter), the extension of `reportWorld` and the tests below.
2. **Sonnet**: migration 0015, the `saving` field in `ledger/categories.go` (`TreeCategory`, `CategoryInput`, create, update with the rules above, effective value on read), handler tests.
3. **Sonnet**: the editor switch, the tree marker, the Gespaard tile link, the `gespaard` chip and note in Transacties, vitest tests (the tile links with the period and account; `aria-label` kept; no link at 0; the chip text and note; the dropdown does not offer it).
4. **Sonnet**: `docs/api.md` (`category=saved`) and the demo category "Sparen" (then run every test on `seeded(t)` and the web tests with demo fixtures: a test that counts or orders the demo's categories, if any, gets the extra category as an expected update; `ledger_test.go`, `reports_test.go`, `transactions_category_test.go` and `transfer_perf_test.go` use the seed); `docs/api.md` (Categories, Reports); analysis `category.md`, `internal-transfer.md`, `period-overview.md`, `screens/overzicht.md`, `screens/categorieen.md` (the rule and the switch).

## Tests
- **`reportWorld` extension** (`server/internal/ledger/reports_test.go`): add a top expense category **Sparen** (`saving = 1`, appended after the defaults; id `rwSparen`) with a subcategory **Pensioensparen** (id `rwPensioen`), and these rows, all in April 2026 so no 0.7 total changes (check that none pairs by opposite amount with another row within 3 days):

  | Row | Account, date | Amount | Counterparty IBAN / category | alles | persoonlijk | gedeeld | alone |
  |---|---|---|---|---|---|---|---|
  | s1 | A1 2026-04-02 | −5000 | none / Sparen | saved +5000 | saved +5000 | – | A1 saved +5000 |
  | s2 | A1 2026-04-03 | −3000 | none / Pensioensparen (sub) | saved +3000 | saved +3000 | – | A1 saved +3000 |
  | s3 | A1 2026-04-04 | +1000 | none / Sparen (withdrawal) | saved −1000 | saved −1000 | – | A1 saved −1000 |
  | s4 | A1 2026-04-05 | −7000 | XS / Sparen | **out** (A3 in S) | saved +7000 (beats toShared) | – | A1 saved +7000 |
  | s4b | A3 2026-04-05 | +7000 | X1 / none | out | – | income 7000 | A3 income 7000 |
  | s5 | A1 2026-04-06 | −4000 | XV / Sparen | saved +4000 (once) | saved +4000 | – | A1 saved +4000 |
  | s5b | A4 2026-04-06 | +4000 | X1 | – (savings row) | – | – | – |
  | s6 | A1 2026-04-07 | −6500 | none / Sparen, override "is een overschrijving" (no partner) | saved +6500 (beats out) | saved +6500 | – | A1 saved +6500 |
  | s7 | A1 2026-04-08 | −9000 split −6000 Sparen / −3000 Overig | none | saved +6000, 6: 3000 | same | – | A1 same |
  | s8 | A1 2026-04-09 | −2500 | X2 / Sparen | out (A2 in S, started) | out | – | A1 saved +2500 |
  | s8b | A2 2026-04-09 | +2500 | X1 / none | out | out | – | A2 income 2500 |
  | s9 | A3 2026-04-10 | −1500 | none / Sparen | saved +1500 | – | saved +1500 | A3 saved +1500 |

  Totals 2026-04: **alles** income 0, saved 25000, expenses 6: 3000; **persoonlijk** income 0, saved 30500, 6: 3000; **gedeeld** income 7000, saved 1500; **A1 alone** saved 33000, 6: 3000; **A2 alone** income 2500; **A3 alone** income 7000, saved 1500. Viewer Partner, gedeeld 2026-04: income 7000 (s4b is not a transfer for Partner: uncategorised income), saved 1500. As in 0.7-1 the oracle was derived by hand: if a case differs, look at the SQL first and report a table error instead of bending the code.
- **`TestReportBucket`** gets one case per new row and selection; **`TestDrillDownMatchesReport`** (`reportWorld` run): the filter `category=<rwSparen>` for 2026-04 lists s1, s2, s3, s5, s6, s7, s9 in alles (sum of their Sparen parts 25000 = alles saved) and s1–s7 in persoonlijk (30500); `category=6` lists s7 (its Overig part, 3000); an expense key never lists a saved row; **`category=saved`**: on `reportWorld` for every selection (alles, persoonlijk, gedeeld, each current account alone, viewer Bert and viewer Partner) and every month of the fixture, Σ of the listed rows' saved parts × −1 equals the report's `saved` (2026-04 alles: s1, s2, s3, s5, s6, s7, s9 and no other row; 2026-01 alles: r5, r8, r13; A1 alone 2026-04 adds s4 and s8); on the demo (Bert, alles, persoonlijk and account 1, every month) the same identity, e.g. 2026-08 alles lists the two transfers to the Spaarrekening (40000).
- **`TestReportMonthsDemo`** (0.7-1) is unchanged: the demo's "Sparen" has no rows. Run it to prove it.
- `TestCategorySaving` (ledger): set on a top expense category; refused on a subcategory and on an income category (messages above); a subcategory reads the parent's value; moving the top under another drops the flag; moving a sub to the top gives false; type change to income clears it; each of those, and setting the flag, deletes the category's budget rows (a fixture budget on it); a merge into a saving category deletes the merged budgets.
- Handler tests for `POST`/`PATCH /api/categories` with `saving`; the privacy row of `GET /api/categories` is unchanged (names, colours and the flag are shared), its description mentions the flag.
- Vitest: the switch shows for a top expense category only, saves `saving: true`, shows the inherited line on a subcategory, nothing on income.

## Who builds it
- **Opus**: step 1 (the rule, the fixture rows, the bucket and drill-down tests).
- **Sonnet**: steps 2–4 from this file.

## Done when
A row in a saving category counts as Gespaard on Overzicht and Start in every case of the table, the Gespaard tile opens exactly the rows behind it, the 0.7 demo numbers are unchanged, and the switch works in Categorieën en regels.
