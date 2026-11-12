# 0.5-6 · Learning and backfill

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | built, to verify (11 Nov 2026) |
| Size | M |
| Features | IMP-5 |
| Concepts | [categorisation-rule](../../analysis/concepts/categorisation-rule.md), [category](../../analysis/concepts/category.md), [import](../../analysis/concepts/import.md) |
| Screens | [categorieen](../../analysis/screens/categorieen.md) |
| Analysis | 4.2 (learning), risk 9 |
| Depends on | [0.5-3](03-category-mapping.md), [0.4-4](../v0.4-categorisation/04-categories-and-rules-screen.md) |

## Goal
Use years of categorised Bilance history to categorise new transactions better.

## Steps
1. Counterparty → most frequent category, with a confidence level; mapped imported categories count as training data.
2. High-confidence suggestions offered as rules; low confidence only for confirmation, never applied silently.
3. Backfill: suggestions for uncategorised synced history.

## Done when
After the Bilance import, the number of uncategorised transactions drops and every change was confirmed or rule-based.

## Carried over from 0.4 (10 Nov 2026)
- **Simple suggestions already exist (0.4-4):** `GET /api/suggestions` offers, per counterparty, the category the user chose most often, for the rows that still wait. Offered when seen ≥ 2 (`categorise.MinSeen`), confidence ≥ 40 (`categorise.MinConfidence`) and at least one open row. They are computed on every read; only the decisions (`dismissed`, `confirmed`) are stored in `category_suggestions`, per user, counterparty and category (migration 0006). See [docs/api.md](../../docs/api.md), "Suggestions".
- **0.5-6 extends rather than restarts:** build on `categorise.Suggest` and the same endpoints and decisions, not on a second model.
- **A confirmed suggestion does not apply to future rows yet:** confirming categorises the rows that wait then, with origin `suggestion`, never over a rule's or a manual category. Rows that arrive later need a rule, so offer it as a rule ("Als regel") instead of applying it silently. (Since the 0.4 fix Bevestigen also makes that rule; see Decisions 3 and 4 below.)
- **Training data:** rows of origin `manual` or `import` (categories set by a rule or a suggestion are echoes and do not count). Mapped Bilance categories (origin `import`, 0.5-3) therefore already feed it. Pending rows with a manual category count as training until they are booked (a small, short-lived effect).
- **The thresholds are generous:** a 1:1 split between two categories is offered at 50 percent. They may be raised once there is real Bilance history.

## Built (11 Nov 2026)
The contract is in [docs/api.md](../../docs/api.md), "Suggestions". No migration and no new table: the learning is still computed on read, and nothing about it is stored.
- **Confidence and level** (`categorise.Suggest`): `confidence` = round(100 × winner's rows / (seen + 2)) and `level` `high` (confidence ≥ 80 and seen ≥ 5) or `low`. `GET /api/suggestions` carries `level`.
- **Backfill** (`ledger/backfill.go`): `GET /api/suggestions/backfill` lists the open suggestions as groups (counterparty, category with icon and colour, level, confidence, rows, up to 3 examples with date and amount) and the totals `rows` and `left`; `POST /api/suggestions/backfill` applies the groups the viewer ticked in one database transaction through `categorise.Confirm` (origin `suggestion`). Caps: 200 groups and 2000 rows per apply.
- **Web:** `CategorieenBackfill.tsx` (the sheet), on the Suggesties tab a button "Geschiedenis toepassen", the cards show "Hoge zekerheid" with "Maak regel" as the primary action or "Lage zekerheid" with "Alleen bevestigen" and no rule button.
- **Tests:** categorise (confidence, levels, thresholds guard), server (preview writes nothing, apply, never over a category of any origin or a split row, another user's rows untouched, stale pairs skipped, row cap refused as a whole, cross-origin, privacy sweep, 401), web (level wording and actions, the sheet's defaults, totals and the posted groups).

## Decisions (11 Nov 2026)
1. **Smoothed confidence, `top / (seen + 2)`.** The plain share said 100 % for a counterparty seen twice, which is exactly the case where a rule would be a guess. Adding 2 to the denominator makes a share count for more as the rows grow: 2 of 2 is 50, 3 of 3 is 60, 8 of 8 is 80, 10 of 10 is 83, 8 of 10 is 67, a 1:1 split is 25 (no longer offered). No second model, no prior to tune: one constant.
2. **Two levels, not three.** `high` needs confidence ≥ 80 and at least 5 rows seen, so with this formula about 8 agreeing rows; `HighSeen` stays as a guard for a later change of the formula. `low` is everything else that is offered (≥ 40). The 0.4 "Gemiddeld" band is gone: the only decision the level drives is whether a rule is offered, and that is binary.
3. **High is offered as a rule, low only for confirmation, nothing is applied silently.** On a card, high shows "Maak regel" as the primary action (it opens the rule editor filled in, as "Als regel" did), low shows only Bevestigen and Negeren. Bevestigen is unchanged from 0.4: it categorises the open rows and also makes the viewer's user rule (reused or a conflict, see api.md). For a low suggestion that rule is the weak spot: a decision for later is to let Bevestigen skip the rule at level low.
4. **The backfill only categorises.** It uses the same `Suggest`, so the same training, thresholds and the viewer's `confirmed` and `dismissed` decisions, and applies a group through `categorise.Confirm` (origin `suggestion`, never over a category of any origin or a split). It makes **no rule** and stores **no decision**: a bulk apply over a list that includes low-certainty groups must not also commit the user to rules for new rows; a rule stays its own choice ("Maak regel" or Bevestigen on the suggestion). A group disappears by itself once none of its rows waits.
5. **Always an explicit act over a previewed list.** The preview writes nothing and lists, per group, the counterparty, the category, the level, the confidence, the row count and up to 3 examples with **date and amount only** (no communication, IBAN, card text or raw row). High groups are ticked, low groups are not. The server derives every pair again at apply time: a pair that no longer matches (another category, another user's counterparty, dismissed, nothing waiting) is skipped and counted as `stale`, never applied; a pair named twice counts once.
6. **Viewer scope:** training on the accounts the viewer holds, targets only rows on accounts the viewer may edit, nothing of another user is read or changed (tested with Partner).
7. **Caps:** 200 groups and 2000 rows per apply, checked before anything is written; more is `400` with nothing changed. The sheet disables Toepassen over the cap and says so. A larger backlog is done in several rounds.
8. **Training data stays as in 0.4:** rows of origin `manual` or `import`. It is computed on every read from the rows that exist, so an undone import batch (its rows are gone) stops training at once, and a category set by a rule or a suggestion never trains, so a backfill does not feed itself.
9. **Backfill is outside every import batch.** It categorises rows that had no category (any batch's, any sync's), each with origin `suggestion`, so an import undo does not touch it, and no record of what it touched is kept: that is acceptable because it only fills empty categories and each row can be changed by hand on its transaction (the same as the 0.5-4 take-over). Rows of a batch that an undo removes are gone, so a category the backfill gave them goes with them.
10. **Mockup deviations:** the mockup has three confidence bands (Hoog, Gemiddeld, Laag) and the buttons Bevestigen · Als regel · Negeren; the web app has two levels with "Hoge zekerheid" / "Lage zekerheid", "Maak regel" for high only, and "Alleen bevestigen" as the low line. "Geschiedenis toepassen" and its sheet are not in the mockup (the sheet reuses the project's `Sheet`, the category chip and the checkbox row of the rule editor).

## To verify
- The whole 0.5 flow once with the invented fixtures, by hand: [local-testing](../../docs/local-testing.md), "Bilance import (0.5)".
- On real data: whether 80 and 5 are the right thresholds for years of Bilance history, and whether Bevestigen on a low suggestion should still make a rule.
