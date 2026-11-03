# 0.1-2 · Transacties and Overzicht

| | |
|---|---|
| Version | [0.1 Mockup](README.md) |
| Status | done (3 Nov 2026) |
| Features | UI-2 |
| Concepts | [transaction](../../analysis/concepts/transaction.md), [category](../../analysis/concepts/category.md), [categorisation-rule](../../analysis/concepts/categorisation-rule.md), [internal-transfer](../../analysis/concepts/internal-transfer.md), [period-overview](../../analysis/concepts/period-overview.md), [account-group](../../analysis/concepts/account-group.md) |
| Screens | [transacties](../../analysis/screens/transacties.md), [overzicht](../../analysis/screens/overzicht.md) |
| Design boards | Telefoon-Transacties, Desktop-Transacties, Telefoon-Overzicht, Desktop-Overzicht |
| Depends on | 0.1-1 |

## Goal
The two screens about the past: individual transactions and monthly totals.

## Steps
1. Transacties: list grouped by day, account label on every row, search, filter chips ("Niet gecategoriseerd" with count), pending and uncategorised rows, older transactions with skeleton.
2. Transaction detail: bottom sheet on phone, side panel on desktop; category pills, "apply to similar and create a rule", note, save.
3. Overzicht: period picker Maand · Kwartaal · Jaar, income / expenses / saved bars, summary tiles, category rows with share and trend, drill-down links.
4. Write the design notes into the screen files.

## Done when
Both screens match their boards on phone and desktop, scope switch included. ✔

## Open questions found
- Overzicht combines both groups in Alles, see [account-group](../../analysis/concepts/account-group.md) → decide in 0.1-7.
- 8 to categorise vs 4 uncategorised demo rows → decide in 0.1-7.
