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

## Done when
You categorise from the phone and desktop, and a created rule picks up the next matching transaction.