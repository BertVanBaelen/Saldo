# 0.8-1 · Planning data: items, budgets, planned items

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | released (0.8.0), verifying |
| Size | M |
| Features | PLAN-1, PLAN-2, PLAN-3 |
| Concepts | [recurring-item](../../analysis/concepts/recurring-item.md), [budget](../../analysis/concepts/budget.md), [planned-item](../../analysis/concepts/planned-item.md), [shared-account](../../analysis/concepts/shared-account.md) |
| Analysis | 4.5, 8 (data model) |
| Depends on | [0.8-0a](00-saving-categories.md) (no budget on a saving category), [0.8-0b](00b-shared-flag-and-invitations.md) ("shared" = flag or members) |

## Goal
Store and edit what the forecast is built on, per account, with the permissions of a shared account; seed the demo with it.

## The tables (they exist since `0001_init.sql`, nothing writes them yet)
- `recurring_items`: **rebuilt** by `0017_planning.sql` (empty everywhere; copy the rows anyway) to widen the `kind` CHECK with **`contribution`** and to add **`counterparty_iban TEXT`** (normalised as `accounts.iban`, NULL when the rows carry none; review 18 Nov 2026: banks give own-account transfers the holder's name as counterparty, so the contribution and the savings order share one name and only the IBAN tells them apart). Column use in 0.8: `account_id`; `user_id` **always NULL** (items belong to the account; the column stays for the leave-cleanup in `lifecycle.go`); `counterparty` = the counterparty name the item matches (raw, as on the bank row; may be `''` for an item added by hand); `description` = the label shown ("Huur"); `amount` signed cents; `amount_rule` `fixed` | `average`; `frequency` `monthly` | `quarterly` | `yearly`; `expected_day` 1–31; `expected_month` NULL for monthly, the anchor month for quarterly (the item falls in that month and every third month after), the month for yearly; `end_date` NULL or `YYYY-MM-DD` (last date an occurrence may have); `kind` `income` | `expense` | `saving` | `transfer` | `contribution` (a member's payment into a shared account: income for the forecast, but left out of the "other income" of the required contribution, 0.8-3); `state` `confirmed` | `ignored` (`suggested` is never stored: suggestions are computed on read, 0.8-2).
- `budgets`: **rebuilt** by migration `0017_planning.sql` (the table is empty in every database; copy the rows anyway) so that `monthly_amount` may be NULL: `monthly_amount INTEGER CHECK (monthly_amount IS NULL OR monthly_amount >= 0)`, `UNIQUE (account_id, category_id, from_month)`. A budget is only valid on a top expense category that is not saving: 0.8-0a deletes a category's budgets when it moves under a parent, turns income or becomes saving, and a merge into a category that is not a valid budget category deletes the merged budgets instead of moving them. A row says "from `from_month` on, this category of this account has this budget" (NULL: no budget, use the average). The row with the greatest `from_month` ≤ m applies to month m; no row: the average. Keep `ledger/categories.go`'s merge and delete statements working on the rebuilt table (they are tested in `TestRemoveCategory*`).
- `planned_items`: kept as is (`account_id`, `created_by`, `date`, signed `amount`, `description`).
- `planning.Key(name string) string` (new package `server/internal/planning`, file `key.go`): `categorise.Normalise(name)` with every digit removed, tokens left with only punctuation dropped ("Q8 #123" → "q") and white space collapsed again ("PAYPAL *NETFLIX 1234" and "Paypal *Netflix 5678" give "paypal *netflix"). An empty key never matches. Used by matching (0.8-3) and detection (0.8-2).

## Rules (validation, Dutch messages through `apperr.Invalid`)
- **Access.** Every route takes an account the viewer holds (`accessOf`): hidden or unknown `404`, a write with Lezen `403` (`access.edit()`). Only `current` accounts: savings or investment `400` "Kies een betaalrekening." (the message of the reports route).
- **Recurring item.** `description` 1–80 characters after trimming ("Geef de post een naam."); `counterparty` 0–140; `counterparty_iban` is **never** in a request or an answer (it can be a member's personal IBAN, 0.6-5): a confirm from a suggestion sends `fromSuggestion: true` and the server copies the IBAN of the newest booked row of that account with the suggestion's key and sign and an amount within ±10 %, skipping rows without an IBAN (none when no such row has one, or when they carry different IBANs); an item created or edited by hand has none (changing `counterparty` clears it); `amount` ≠ 0 and |amount| ≤ `ledger.MaxBuffer`; sign: `income` and `contribution` > 0, `expense` and `saving` < 0, `transfer` either ("Een inkomst is positief, een uitgave negatief."); `contribution` only on a shared account (`kind` shared: the flag of 0.8-0b or more than one member; "Een bijdrage hoort bij een gedeelde rekening."); `transfer` never on a shared account ("Kies inkomst of bijdrage voor een gedeelde rekening.": every member sees the kind); `expected_day` 1–31; `expected_month` required and 1–12 for quarterly and yearly, absent for monthly ("Kies de maand."); `end_date` a date on or after today when it is set or changed, or absent (an item whose end date has passed can still be edited); `state` on create `confirmed` or `ignored` (an ignored item's `description` is its counterparty).
- **Budget.** `PUT` with `accountId`, `categoryId` (a **top** category of type expense that is **not saving**: subcategory "Een budget hoort bij een hoofdcategorie.", saving "Voor een spaarcategorie stel je geen budget in.", income "Kies een uitgavencategorie."), `fromMonth` from the current month (Brussels) to the current month + 24 (the longest horizon), `amount` cents 0 … `MaxBuffer` or `null`. It upserts the row for `fromMonth` and deletes that account's and category's rows with a later `from_month`, in one transaction ("from this month on"; the UI always edits from the month shown). A `null` row right after an equal earlier `null` (or with no earlier row) is simply deleted, so the table stays minimal.
- **Planned item.** `date` from today to the last day of the current month + 24 ("Kies een datum vanaf vandaag."); `amount` ≠ 0, |amount| ≤ `MaxBuffer`; `description` 1–80 ("Vul een omschrijving en een bedrag in." for an empty description or amount, the copy of the plan form). `created_by` = the viewer.

## Endpoints (all JSON, money in cents; `scope` as in `GET /api/transactions`, default `alles`, meaning the current accounts of that scope the viewer holds)
| Route | Answer |
|---|---|
| `GET /api/planning/items?scope=` | `{"items": [{id, accountId, description, counterparty, amount, amountRule, frequency, day, month, endDate, kind, state}]}`, confirmed and ignored, ordered by account (`/api/accounts` order), then state, then `day`, then id |
| `POST /api/planning/items` | the stored item, `201` |
| `PATCH /api/planning/items/{id}` | the item (any field above except `accountId`) |
| `DELETE /api/planning/items/{id}` | `204` (deleting an ignored item brings its suggestion back) |
| `GET /api/planning/budgets?scope=` | `{"budgets": [{id, accountId, categoryId, fromMonth, amount}]}` |
| `PUT /api/planning/budgets` | `{accountId, categoryId, fromMonth, amount}` → the rows of that account and category after the change |
| `GET /api/planning/planned?scope=` | `{"planned": [{id, accountId, date, amount, description}]}` with `date` ≥ the first day of the current month, by date |
| `POST /api/planning/planned`, `PATCH /api/planning/planned/{id}`, `DELETE /api/planning/planned/{id}` | as for items |

Every write bumps the data version the web app already uses to refetch (as categorising does), so Planning and Start refresh.

## Demo seed (`server/internal/demo/demo.go`, after the transactions; viewer-free facts of the story)
Recurring items, all `confirmed`, `amount_rule` `fixed`:

| Account | Description | Counterparty | Amount | Frequency, day | Kind |
|---|---|---|---|---|---|
| Zichtrekening (1) | Salaris | Werkgever NV | +285000 | monthly, 2 | income |
| 1 | Huur | Immo Verhaeghe | −100500 | monthly, 1 | expense |
| 1 | Naar gedeelde rekening | Naar gedeelde rekening (IBAN of the Gedeelde rekening) | −45000 | monthly, 1 | transfer |
| 1 | Netflix | Netflix | −1399 | monthly, 12 | expense |
| 1 | Naar spaarrekening | Naar spaarrekening (IBAN of the Spaarrekening) | −20000 | monthly, 16 | saving |
| 1 | Spotify | Spotify | −1199 | monthly, 17 | expense |
| 1 | Familiale verzekering | (empty: added by hand) | −68400 | yearly, 15 January | expense |
| Gedeelde rekening (4) | Bijdrage Bert | Bert (IBAN of Bert's Zichtrekening) | +45000 | monthly, 1 | contribution |
| 4 | Bijdrage Partner | Partner (IBAN of Partner's Zichtrekening) | +45000 | monthly, 1 | contribution |
| 4 | Energie | Luminus | −14500 | monthly, 3 | expense |
| 4 | Internet en tv | Proximus | −4298 | monthly, 9 | expense |

Budgets, all `from_month` `2026-11` (Boodschappen 2, Vrije tijd 3, Vervoer 4, Overig 6): Zichtrekening Vrije tijd 35000, Vervoer 30000, Overig 28798 (the mockup's three); Gedeelde rekening Boodschappen **55000** (the mockup has 65000: with 65000 the shared account's month nets exactly 0 and November ends at € 529,27, inside its € 600 buffer every month, which contradicts the mockup's verdict; accepted by the user on 18 Nov 2026). The shared account's Overig has **no** budget, so the demo exercises the average (Action, € 62,47).

Planned items (created by Bert, on the Zichtrekening): 2026-12-20 Kerstcadeaus −35000; 2027-02-10 Autoherstelling −200000; 2027-07-15 Zomervakantie −150000; 2027-08-20 Belastingteruggave +68000 (the mockup gives months only for the last two; the days are chosen here).

No ignored items; detection then offers Decathlon and Action (0.8-2). Partner's own Zichtrekening gets no items (it is not in the mockup), so Partner sees its suggestions.

## Steps
1. **Sonnet**: migration `0017_planning.sql` (rebuild `budgets` and `recurring_items`, with `TestMigration0017KeepsRows`), `planning.Key` with its table test, `ledger/planning.go` (types, validation, CRUD, `PUT` budgets) with tests.
2. **Sonnet**: handlers `server/planning.go` (literal patterns, as `server/reports.go`), handler tests, privacy rows (below).
3. **Sonnet**: the demo seed rows above, `TestDemoPlanningSeed` (counts and the table), and `docs/api.md` section "Planning (0.8)" for these routes.

## Tests
- `TestKey`: "Immo Verhaeghe" → "immo verhaeghe"; "PAYPAL *NETFLIX 1234" and "Paypal *Netflix  5678" → "paypal *netflix"; "Café Ölçer 12" → "cafe olcer"; "1234" → "" (never matches); "Q8 #123" → "q"; "" → "".
- `TestRecurringItemCRUD` (ledger, a small world with Bert, Partner, a personal account, a shared account with Partner on Lezen, a savings account): create, list per scope, update, delete; every validation message above; Partner (Lezen) gets `ErrForbidden` on every write and sees the items; Bert's personal account's items are `ErrNotFound` for Partner on read and write; a savings account is `400`.
- `TestBudgets`: from 2026-11 300 then from 2027-01 null then from 2026-12 400 leaves rows {2026-11: 300, 2026-12: 400} (the later null is deleted by the rule "deletes the later rows"); a subcategory, a saving category, an income category and a month before the current one or after current + 24 are refused (+ 24 is accepted: the Rules and horizon 24 of 0.8-3 reach it; corrected from "+ 23" while building 0.8-1); the category merge of 0.4 moves a budget row only when the merge target is a top expense category that is not saving (0.8-0a built it; `TestRemoveCategory` merges a top into a top for that reason); a merge into a subcategory or a saving category deletes it instead; a top category that moves under another one, turns income or becomes saving loses its budgets.
- `TestPlannedItems`: CRUD, dates, the list starts at the first of the current month.
- Handler tests for status codes and the `201`/`204`.
- **Privacy** (`server/privacy_test.go`): a row for each of the ten routes ("account-level: the viewer must hold the account; writes need Bewerken"), and `TestPrivacySentinels` extended: an item, a budget and a planned item on Partner's personal account carry sentinel amounts (246001, 246002, 246003) that never appear in any of Bert's planning answers in any scope; Bert's write to them is the `404` of a missing one.

## Who builds it
- **Sonnet**: steps 1–3 from this file.

## Done when
The demo has the items, budgets and planned items above, and every route answers as specified with its privacy row.
