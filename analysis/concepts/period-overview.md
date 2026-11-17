# Period and overview (past months)

Analysis: 4.4 · Screens: [overzicht](../screens/overzicht.md), [transacties](../screens/transacties.md) · Phases: [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.7-1](../../plan/v0.7-overview/01-reports-api.md), [0.7-3](../../plan/v0.7-overview/03-overzicht-screen.md)

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
- Drill-down links carry `categorie`, `periode` (`2026-10`, `2026-K2`, `2026`) and `scope` in the mockup; in the app the scope is the app-wide choice and `rekening` is added when an account is filtered (plan 0.7-2).
- "Eigen" (custom range), the account filter, the running month, the per-account breakdown and the empty state (no history yet) are designed in the mockup ([overzicht](../screens/overzicht.md)).

## Rules for the app (plan 0.7, 17 Nov 2026)
- **Selection**: the filtered current account, else every current account of the scope (savings and investment accounts never). Transfers follow the selection rule in [internal-transfer](internal-transfer.md): internal when the other side is in the selection and its history has started, otherwise a flow (saved, "Naar gedeelde rekening", "Naar eigen rekening" or income).
- **Income or expense** follows the category type; a refund in an expense category lowers that category; uncategorised rows go by sign ("Niet gecategoriseerd" for the expenses). Subcategories roll up into their top category; split rows count by their parts.
- **Periods**: Maand = the last 6 complete months, Kwartaal = up to 4 quarters complete in the history, Jaar = each year cut to the history (no trend), Eigen = any months including the running one. A view without a complete period shows the running month.
- **Trend**: none for Jaar, for a partial period (the running month, a first month that starts after the 1st), next to one, and when the previous period is outside the history; "nieuw" when the previous amount was 0.
