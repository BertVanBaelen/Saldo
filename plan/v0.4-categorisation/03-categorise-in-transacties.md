# 0.4-3 · Categorise in Transacties

| | |
|---|---|
| Version | [0.4 Categorisation](README.md) |
| Status | planned |
| Size | M |
| Features | CAT-3, CAT-4 |
| Concepts | [transaction](../../analysis/concepts/transaction.md), [categorisation-rule](../../analysis/concepts/categorisation-rule.md), [category](../../analysis/concepts/category.md) |
| Screens | [transacties](../../analysis/screens/transacties.md), [start](../../analysis/screens/start.md) |
| Analysis | 4.2 |
| Depends on | [0.4-2](02-rules-engine.md) |

## Goal
Fix a category in a tap and teach Saldo at the same time.

## Steps
1. Detail sheet / panel: category pills, saves at once; the rule that set a category, with "Regel aanpassen".
2. "Toepassen op vergelijkbare en regel maken" with the count of similar transactions; creates a rule and updates them; toast "Regel gemaakt · N andere bijgewerkt".
3. Note per transaction.
4. Split over several categories [S] (`transaction_split`).
5. Filter "Niet gecategoriseerd" with count, the Start alert "N transacties te categoriseren" and the sidebar badge.
6. Read-only members of a shared account see no edit controls.
7. Carry a manual choice from a pending row to its booked row. Today `ledger.StoreFetch` deletes a pending row the bank no longer reports, with its category and note, when the booked row arrives in the same fetch. Proposed rule: same account, same amount, equal normalised counterparty (`categorise.Normalise`), booked date within 7 days of the pending date, one to one, closest date first; carry the category with origin `manual` and the note, nothing else. Test: categorise a pending row by hand, sync its booked row, the booked row has the category and note, and nothing else moved.

## Done when
You categorise from the phone and desktop, and a created rule picks up the next matching transaction.

## Notes from 0.4-1 and 0.4-2 (10 Nov 2026)
- **One write path for automatic categories:** "apply to similar" writes the clicked row with origin `manual` itself, and the similar rows through `categorise.Assign` (or `ApplyAccount`), which only changes eligible rows (no split; no category, or a rule's or a suggestion's) and repeats that guard in its UPDATE.
- **`import` is protected** from automatic writers. "Apply to similar" must decide explicitly whether it overrides categories from a Bilance import (it may, as an explicit user action; never silently a `manual` one) and say so in the count it shows.
- **Pending to booked:** step 7 above is required for the exit criterion "a manual choice is never overwritten".
- **Rule visibility:** never return a rule or `rule_id` the viewer cannot see. Example: a user rule of one member set a category on a personal account that becomes shared in 0.6; show "set by a rule" without the rule then.
- **Splits on pending rows:** undecided (a pending row may still change its amount).
