# 0.8-2 · Recurring-item detection and the detection report

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | released (0.8.0), verifying |
| Size | M |
| Features | PLAN-1 |
| Concepts | [recurring-item](../../analysis/concepts/recurring-item.md), [category](../../analysis/concepts/category.md) (saving) |
| Analysis | 4.5 (1), risk 12 |
| Depends on | [0.8-1](01-planning-data.md) (tables, `planning.Key`); [0.5-5](../v0.5-bilance-import/05-batches-and-undo.md) (12+ months of history for real data) |

## Goal
Suggest the recurring items of an account from its history, as pure functions with a fixture test set, and give the user a read-only report to check the heuristic on real data before the forecast relies on it (risk 12; "real data first", the lesson of 0.3-6 and 0.5-1).

## The heuristic (`server/internal/planning/detect.go`, pure; all thresholds are named constants at the top of the file)
Input: today (Brussels date) and the account's **booked** rows dated today or earlier with an amount ≠ 0: date, amount, counterparty name, counterparty IBAN, top category id and whether that category is saving. Pending rows are ignored.
1. **Groups**: rows with the same `Key(counterparty name)`, the same sign and the same normalised counterparty IBAN (rows without an IBAN, such as a Bilance import, join the one IBAN group of their key and sign when exactly one exists, so a mixed history is one run; else they form their own group per key and sign; review fix 18 Nov 2026). Rows with an empty key are skipped. So "BERT VAN BAELEN" to the shared account and to the savings account are two groups (review 18 Nov 2026).
2. **Runs**: sort a group by date; a run is a maximal sequence of rows whose gaps are within the frequency's range, where a row closer than the range's minimum to the previous kept row is skipped as an **extra** (an energy settlement, a second charge) instead of ending the run; a run with more extras than a quarter of its kept rows (rounded down) is rejected ("extras"), so a twice-a-month pattern stays unsuggested. A gap above the maximum ends the run. Frequencies are tried in the order **monthly** (gap 25–35 days, at least 3 rows, last row at most 45 days before today), **quarterly** (80–100 days, at least 3 rows, last row at most 100 days ago), **yearly** (350–380 days, at least 2 rows, last row at most 400 days ago). For a frequency, the candidate run is the **latest** run that meets its minimum and recency; the first frequency whose candidate passes the amount test wins.
3. **Amount test**: the run's median amount (even count: mean of the two middle values, rounded half away from zero to a cent); at least 75 % of the run's rows within ±10 % of the median. `amountRule` is `fixed` when every row of the run has the same amount, else `average`; the suggested amount is the median.
4. **Day**: the median day of month of the run's rows (even count: the lower middle). Quarterly anchor month and yearly month: the month of the run's last row.
5. **Kind**: `saving` when the run's newest row has a saving top category (viewer-free); on a **personal** account (not shared, 0.8-0b) also `saving` when its counterparty IBAN is a savings or investment account the viewer holds and `transfer` when it is another current account the viewer holds; on a shared account `contribution` when the run's newest row comes from a claimed contribution sender of that account (`contribution_senders`, 0.6-5: an account-level fact every member already sees as "Bijdrage van …"); otherwise `income` (> 0) or `expense` (< 0). On a shared account the IBAN is never used for the kind: a stored kind is seen by every member and would reveal that a counterparty is a member's own account. The kind only prefills the form; the user's explicit choice in the form is stored as chosen.
6. **Hidden**: a group whose key and sign equal those of an item of the account (confirmed or ignored) is not suggested.
7. **Seen**: the number of kept rows of the run ("4 keer gezien").

Settled while building (18 Nov 2026): "last row" is the run's last **kept** row (recency, anchor month, counterparty spelling, kind); a group that is not suggested reports the verdict of the **first frequency that has a candidate run**, else `too few`; `saving` is set for outgoing runs only (an incoming run from an own savings account is `transfer`, an incoming one in a saving category `income`) and `contribution` for incoming runs only, so every suggestion passes the item validation of 0.8-1. In the demo Zara's report verdict is `extras` (its yearly candidate holds the other-month rows as extras), Lidl's monthly run has 54 % (rounded) within 10 %.

Rows that a twice-monthly, two-weekly or every-other-month pattern produces never form a run (gaps 12–21 or about 61 days), which is intended: such spending belongs in a budget.

## Endpoints
- `GET /api/planning/suggestions?scope=` → `{"suggestions": [{accountId, counterparty, description, amount, amountRule, frequency, day, month, kind, seen}]}` for the current accounts of the scope the viewer holds; `counterparty` is the raw spelling of the run's newest row and `description` the same text (the user renames it in the form). Ordered by account, then seen descending, then key.
- Confirm = `POST /api/planning/items` with the suggestion's values and `fromSuggestion: true` (0.8-1: the server copies the counterparty IBAN; a suggestion never carries it). Ignore = `POST /api/planning/items` with `state: "ignored"` and the same `counterparty`, `amount` (sign), `frequency`, `day` (an ignored row is hidden by key and sign only).
- `GET /api/planning/detection?account=<id>` (read-only, for the real-data check; no screen): every group of the account with `key`, `sign`, `rows`, the newest date, and per frequency the candidate run (`length`, `first`, `last`, `median`, `share within 10 %`) and the **verdict** with its reason: `suggested`, `covered` (an item exists), `ignored`, `too few` (no run long enough), `stale` (run too old), `amount` (share below 75 %), `extras` (too many extra rows). Amounts are the account's own; the route has the same access rule as the others (hold the account; Lezen may read).

## Tests (`planning/detect_test.go`)
- **`TestDetect`** (table; today 2026-11-18; one case per line, each a small synthetic group; the expected result is the full suggestion or "none" with the report's reason):

  | Case | Rows | Expected |
  |---|---|---|
  | monthly fixed | −1000 on the 5th, Jan–Nov 2026 | monthly, day 5, −1000, fixed, seen 11 |
  | monthly skip and extra | −20000 on the 16th Nov 2025–Nov 2026 except Jul, plus −20000 on 2026-08-28 | monthly, day 16, seen 4 (the run Aug–Nov; 28 August is an extra) |
  | end of month drift | +250000 on 2026-05-30, 06-30, 07-31, 08-29, 09-30, 10-30 | monthly, day 30 |
  | rent paid early | −80000 on 2026-07-01, 07-31, 09-01, 10-01, 10-30 | monthly, day 1 (gaps 30, 32, 30, 29) |
  | twice a month | −5000 on the 8th and the 22nd, May–Oct, and on 8 Nov | none, extras (6 extras on 7 kept rows) |
  | every other month | −2400 on 20 May, 20 Jul, 20 Sep and 15 Nov | none, too few |
  | amounts vary 15 % | −5437 ± up to 920, monthly | none, amount |
  | amounts vary 6 % | −6202 ± up to 360, monthly | monthly, average, median |
  | stale | monthly −999, last row 2026-08-01 | none, stale |
  | quarterly with extra | −4290 on 2025-12-27, 2026-03-27, 06-27, 09-27, plus 2026-11-14 | quarterly, anchor 9, day 27, seen 4 |
  | yearly | −68400 on 2025-01-15 and 2026-01-15 | yearly, month 1, day 15 |
  | yearly, two years back | −5000 on 2024-02-29 and 2025-02-28 | none, stale (the last row is 628 days old) |
  | yearly, recent | −5000 on 2025-02-28 and 2026-02-28 | yearly, month 2, day 28 |
  | covered | the monthly fixed group, with a confirmed item of the same key and sign | none, covered |
  | ignored | same with an ignored item | none, ignored |
  | other sign | +1000 monthly next to an item of −1000 of that key | suggested (the item covers the negative sign only) |
  | one extra | −14500 on the 3rd Jan–Nov 2026 plus −30000 "Luminus" on 2026-06-10 (a settlement, other amount) | monthly, day 3, seen 11 (1 extra ≤ 11/4; the extra is outside the amount test) |
  | shared name, two IBANs | "BERT VAN BAELEN" −45000 on the 1st to IBAN XS and −20000 on the 16th to IBAN XV, May–Nov | two monthly suggestions (one per IBAN) |
  | key with digits | "PAYPAL *NETFLIX 1234" and "PAYPAL *NETFLIX 5678", monthly | one group, monthly |
  | saving category | monthly −5000 in a saving category | kind saving |
  | empty name | monthly −1000, no counterparty name | none (skipped) |

- **`TestDetectDemo`** (`seeded(t)` with the 0.8-1 seed; numbers computed on 18 Nov 2026 by a throwaway script): viewer Bert, scope alles → exactly two suggestions: Zichtrekening **Decathlon** quarterly, anchor 9, day 27, −4290, fixed, seen 4, kind expense; Gedeelde rekening **Action** monthly, day 23, −6247, average, seen 12, kind expense. Viewer Partner, scope alles → Action plus, on Partner's own account, **Basic-Fit** (monthly, day 21, −2999, seen 12), **De Lijn** (monthly, 14, −2200, seen 13), **Naar gedeelde rekening** (monthly, 1, −45000, seen 13, kind transfer) and **Werkgever BV** (monthly, 2, +246000, seen 13, income); Lidl is not suggested (amount: 54 % within 10 %), nor Zara (every other month). Without the seed's items (delete them in the test), Bert additionally gets Werkgever NV, Immo Verhaeghe, Naar gedeelde rekening (transfer), Netflix, Spotify, Naar spaarrekening (saving, seen 4: 28 August is an extra), Bert and Partner on the shared account (both kind income, for either viewer: the demo claims no senders; with a claimed sender the kind is contribution for both), Luminus and Proximus; Albert Heijn, Carrefour Express and Delhaize are refused on amount, Colruyt and TotalEnergies on extras, the yearly insurance is not found (no row).
- Handler tests and **privacy rows** for `GET /api/planning/suggestions` and `GET /api/planning/detection` (Partner's personal account: `404` for Bert; the kind of a shared account's suggestion never depends on a member's personal accounts: "Bert" and "Partner" are kind `income` for both viewers, so the suggestions of a shared account are identical for every member).

## Real-data check
Filled in by the lead after running the report on a local copy of a production backup (README) (see the README). Until then the thresholds above are a first guess.

## Who builds it
- **Opus**: `detect.go` and `TestDetect` (the heuristic, its edge cases), `TestDetectDemo`.
- **Sonnet**: the loader query (rows of one account with key inputs, category and saving flag), the two routes, handler and privacy tests, `docs/api.md`.

## Done when
`TestDetect` and `TestDetectDemo` pass, and the lead has run the detection report on real data and recorded the outcome.
