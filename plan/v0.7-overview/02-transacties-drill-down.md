# 0.7-2 · Transacties: category and period filters for the drill-down

| | |
|---|---|
| Version | [0.7 Overview](README.md) |
| Status | built (0.7.0-dev), to verify |
| Size | S |
| Features | OVER-2 |
| Concepts | [category](../../analysis/concepts/category.md), [internal-transfer](../../analysis/concepts/internal-transfer.md), [period-overview](../../analysis/concepts/period-overview.md) |
| Screens | [transacties](../../analysis/screens/transacties.md) |
| Depends on | [0.7-1](01-reports-api.md) (the exported drill-down fragment, `reportWorld`) |

## Goal
Every number on Overzicht opens the transactions behind it: Transacties filters on one category (or "Naar gedeelde rekening" / "Naar eigen rekening") and on a month, quarter or year.

## What exists (17 Nov 2026)
`GET /api/transactions` filters on `account`, `scope`, `q`, `uncategorised=1`, `from`, `to`. Transacties reads `?filter=niet-gecategoriseerd`, `?rekening=<id>` and `?periode=deze|vorige|3-maanden|dit-jaar`; its category dropdown offers only "Alle categorieën" and "Niet gecategoriseerd" (`categoryOptions` in `Transacties.tsx` says the rest waits for this phase).

## Steps
1. **API parameter `category`** on `GET /api/transactions` (`TxQuery.Category`, `ledger/transactions.go` `filters`): `<id>` | `none` | `toShared` | `toOwn`. **Apply the drill-down fragment exported by 0.7-1** (`tx.id IN (SELECT id FROM parts WHERE <bucket> = 'expense' AND <key> = ?)` with the report's selection); do **not** re-derive the rule here. Consequences, all coming from that fragment:
   - the selection is the report's: with `account`, that account (and `scope` then does not filter, as in the report: the drill-down of an account opened under another scope still lists it); else the scope's `current` accounts only, so rows of savings and investment accounts (interest) never show under a category, and `toShared` / `toOwn` never have a savings or investment other side;
   - only booked rows match (pending rows are not in the report);
   - `<id>` is a **top category** id (its subcategories roll up into it; a subcategory id matches nothing, and the dropdown offers top categories only: do not add a second form of the rule for subcategories); a split row matches when one of its parts does; a transfer never matches a category; a pre-history transfer (0.7-1) matches `toShared` / `toOwn`;
   - `none` is the report's "Niet gecategoriseerd" expense row (uncategorised, amount < 0, not a transfer for the selection). The existing `uncategorised=1` (the Start alert and the "te categoriseren" count) is unchanged.
   - An unknown id gives an empty list; any other value answers `400` ("Kies een categorie."). With `category` set and `account` a savings or investment account, the answer is `200` with an empty list (no report row ever sits behind such an account, and the account dropdown of Transacties lists every account; the report endpoint keeps its `400` "Kies een betaalrekening."); a hidden or unknown account stays `404`. Document it in `docs/api.md` under `GET /api/transactions`.
2. **Web API**: `TransactionQuery.category?: string` in `lib/types.ts`, `transactionsPath` adds `category`.
3. **URL parameters in Transacties**:
   - `?categorie=<id>|geen|naar-gedeeld|naar-eigen` (mapped to `<id>`, `none`, `toShared`, `toOwn`); `categorie` and `filter=niet-gecategoriseerd` exclude each other: setting one removes the other. "Wis filters" removes both.
   - `?periode=` also takes `YYYY-MM`, `YYYY-Kn` and `YYYY` (export `periodFromParam(value, today)` next to `period()`): the month, the calendar quarter or the year, chip "Oktober 2026", "K2 2026", "2026". Unknown values are ignored, as today. Added after the review (18 Nov 2026): the range `YYYY-MM..YYYY-MM` (chip "jan – okt 2026"), which Overzicht's `periodParam` sends when a column is not a whole calendar period (Jaar cut to the history), so the list holds exactly the months the column counts; a backwards range and years before 1900 are ignored.
4. **Category dropdown** as in the mockup (`finance-mockup/js/screens/transacties.js`, `ddCategorie`): "Alle categorieën"; label "Uitgaven" with the expense top categories (from `api.categories`, in tree order, with their dot or emoji as elsewhere); no "Inkomsten" group (decided 17 Nov 2026: the drill-down only has the report's expense keys, so an income category would always list nothing; income is one total on Overzicht); a separator; "Niet gecategoriseerd" with its count. The chip shows the chosen name; for `geen` it shows "Niet gecategoriseerd" (dashed dot); for `naar-gedeeld` / `naar-eigen` it shows "Naar gedeelde rekening" / "Naar eigen rekening" with a `--shared` / muted dot (`geen`, `naar-gedeeld` and `naar-eigen` are reached only through Overzicht links; picking "Niet gecategoriseerd" in the dropdown still sets `filter=niet-gecategoriseerd`).
5. Remove the comment "Filtering on one category arrives with the drill-down of 0.7-2" in `Transacties.tsx`; update `analysis/screens/transacties.md` (filters) and `docs/local-testing.md`.

## Tests
- Go `TestTransactionsCategoryFilter` (table, demo story, Bert): `category=2` in October 2026 lists the groceries of the shared account only; a split row with one part in Wonen appears under `category=1` and under the other part's category; a transfer carrying a category does not appear; pending rows never appear; `category=toShared` with `scope=persoonlijk` in October lists Bert's € 450 contribution of 1 October, with `scope=alles` nothing (true for the demo, where both histories start on 2025-11-01); `category=toShared&account=1` lists it, `&account=4` nothing; `category=1&account=2` (savings) answers `200` with an empty list, `category=abc` answers `400`.
- Go, on `reportWorld` (0.7-1): `category=toShared&scope=alles` lists r1 (the pre-history contribution of 2020) and r26 (four days before A3's history; r25, three days before, is internal) and nothing else; the savings interest r7 never appears under any category; `category=none&scope=alles` lists r17 and r18; `category=toOwn&account=1` lists r9 and not r5 or r13 (savings and investment are saved).
- Go `TestDrillDownMatchesReport` (the consistency test), on **both** `reportWorld` and the demo story: for every selection (alles, persoonlijk, gedeeld, each current account alone), every month with data and every expense key of `ReportMonths`, the rows of `Transactions` with that `category` and the month's `from`/`to` sum to the report's amount. A split row is listed under each part's key with its **full** row amount, so sum the matching **parts** (`Splits`, by category key) for a split row and compare the set of row ids as well, never the row amounts of split rows. Add the drill-down (`category=<top id>`, `category=toShared`) to the speed test of 0.7-1 (it runs `parts` twice per page, COUNT and items).
- vitest `periodFromParam`: `2026-10` → 2026-10-01 … 2026-10-31, chip "Oktober 2026"; `2026-K2` → 2026-04-01 … 2026-06-30, "K2 2026"; `2026-K4` ends 2026-12-31; `2026` → the year; `2026-13`, `2026-K5`, `abc` → undefined; the old keys still work.
- vitest `Transacties.test.tsx`: `?categorie=2&periode=2026-10` calls `api.transactions` with `category: '2'`, `from: '2026-10-01'`, `to: '2026-10-31'` and shows the chips "Boodschappen" and "Oktober 2026"; picking "Niet gecategoriseerd" removes `categorie`; "Wis filters" removes every filter; `?categorie=naar-gedeeld` sends `toShared` and shows "Naar gedeelde rekening"; `?categorie=geen` sends `none`. `api.test.ts`: `transactionsPath({ category: '2' })`.

## Who builds it
- **Sonnet**: all steps, applying the exported fragment of 0.7-1 (never a second copy of the rule). If `TestDrillDownMatchesReport` fails, the selection or the parameters passed to the fragment differ from `ReportMonths`; the lead (or Opus) looks at it.

## Done when
Every expense row of the report (demo and `reportWorld`) opens a Transacties list whose rows add up to that row, and the filters live in the URL.

## Not in this phase
The mockup's month grid and "Eigen periode" (van – tot) inside the Transacties period dropdown: still the four fixed choices plus the deep-link values. A later small step if wanted.
