# 0.1-6 · Missing designs and states

| | |
|---|---|
| Version | [0.1 Mockup](README.md) |
| Status | planned |
| Features | UI-4 |
| Concepts | [authentication](../../analysis/concepts/authentication.md), [bank-connection](../../analysis/concepts/bank-connection.md), [account](../../analysis/concepts/account.md), [shared-account](../../analysis/concepts/shared-account.md), [category](../../analysis/concepts/category.md), [categorisation-rule](../../analysis/concepts/categorisation-rule.md), [import](../../analysis/concepts/import.md), [user-and-visibility](../../analysis/concepts/user-and-visibility.md), [internal-transfer](../../analysis/concepts/internal-transfer.md), [demo-data](../../analysis/concepts/demo-data.md) |
| Screens | [inloggen](../../analysis/screens/inloggen.md), [bank-koppelen](../../analysis/screens/bank-koppelen.md), [rekeningen](../../analysis/screens/rekeningen.md) (detail), [categorieen](../../analysis/screens/categorieen.md), [importeren](../../analysis/screens/importeren.md), [instellingen](../../analysis/screens/instellingen.md), [transacties](../../analysis/screens/transacties.md), [start](../../analysis/screens/start.md) (states), [meer](../../analysis/screens/meer.md) |
| Design boards | none yet: designed directly in the mockup, in the existing style |
| Depends on | 0.1-1 … 0.1-5 |

## Goal
Design the screens that analysis 12 still marks "to do", so every flow of version 1 can be clicked through.

## Steps
1. Inloggen: e-mail and password, 8-digit code, first-admin setup, accept an invitation, choose a new password.
2. Bank koppelen: choose Argenta, explanation and redirect, choose accounts, "this account already exists, join it?", first sync progress.
3. Rekening detail: balance history, transactions, Synchronisatie (sources, consent, re-authorise), Leden (Lezen / Bewerken), manual balance update for savings.
4. Categorieën en regels: tree, rules with priority, suggestions to confirm.
5. Importeren: file, columns, category mapping table, preview with duplicates, result with undo.
6. Instellingen: profile, language, Enable Banking id and key; admin user management.
7. Transacties extras: account / period / category dropdowns, split, mark as transfer, rule editor.
8. States: empty (no accounts), stale sync, sync error, read-only member.
9. Desktop layouts for the settings screens.

## Done when
Every screen and state in analysis 12 can be opened in the mockup, and its screen file has design notes.
