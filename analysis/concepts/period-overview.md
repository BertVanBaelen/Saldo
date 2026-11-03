# Period and overview (past months)

Analysis: 4.4 · Screens: [overzicht](../screens/overzicht.md), [transacties](../screens/transacties.md) · Phases: [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.7-1](../../plan/v0.7-overview/01-reports-api.md), [0.7-2](../../plan/v0.7-overview/02-overzicht-screen.md)

## Rules
- Period picker: month, quarter, year, custom range. History reaches back as far as the data goes.
- Month = calendar month of the booking date in Europe/Brussels. "Month starts on day N" (salary day) is a [C] extra.
- Per month: **income, expenses and saved**. Internal transfers excluded ([internal-transfer](internal-transfer.md)).
- Per category: totals, share of spending, trend versus previous periods, drill-down to transactions.
- Filter by account or by scope; with several accounts in view the totals are sums for information with a per-account breakdown ([scope](scope.md)).
- In Persoonlijk your contribution shows as "Naar gedeelde rekening".
- Pending transactions are left out of totals.

## From the design (0.1-2, see [overzicht](../screens/overzicht.md#design-notes))
- Period picker Maand · Kwartaal · Jaar · Eigen. The month view shows 6 months; the default selection is the last complete period. Changing period or scope resets the selection.
- **Trend** = change against the previous period, rounded %: "+12%", "−7%", "= 0%". More than +5 % is shown in `--warn`, less than −5 % in `--greenText`, otherwise muted. No trend for Jaar or for the first period.
- Drill-down links carry `categorie`, `periode` (`2026-10`, `2026-K2`, `2026`) and `scope`.
- "Eigen" (custom range), the account filter and the empty state (no history yet) are designed in the mockup ([overzicht](../screens/overzicht.md)).
