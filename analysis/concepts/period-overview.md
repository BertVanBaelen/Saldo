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

- **Saving categories** (plan [0.8-0a](../../plan/v0.8-planning/00-saving-categories.md)): what is booked in a category marked "Telt als gespaard" counts as saved, not as an expense.

## From the design (0.1-2, see [overzicht](../screens/overzicht.md#design-notes))
- Period picker Maand · Kwartaal · Jaar · Eigen. The month view shows 6 months; the default selection is the last complete period. Changing period or scope resets the selection. (The app since 0.9.1-2: the running month, quarter and year are columns too, and Maand and Jaar open on them; see "Rules for the app".)
- **Trend** = change against the previous period, rounded %: "+12%", "−7%", "= 0%". More than +5 % is shown in `--warn`, less than −5 % in `--greenText`, otherwise muted. No trend for Jaar or for the first period.
- Drill-down links carry `categorie`, `periode` (`2026-10`, `2026-K2`, `2026`) and `scope` in the mockup; in the app the scope is the app-wide choice and `rekening` is added when an account is filtered (plan 0.7-2).
- "Eigen" (custom range), the account filter, the running month, the per-account breakdown and the empty state (no history yet) are designed in the mockup ([overzicht](../screens/overzicht.md)).

## Rules for the app (plan 0.7, 17 Nov 2026)
- **Selection**: the filtered current account, else every current account of the scope (savings and investment accounts never). Transfers follow the selection rule in [internal-transfer](internal-transfer.md): internal when the other side is in the selection and its history has started, otherwise a flow (saved, "Naar gedeelde rekening", "Naar eigen rekening" or income).
- **Income or expense** follows the category type; a refund in an expense category lowers that category; uncategorised rows go by sign ("Niet gecategoriseerd" for the expenses). Subcategories roll up into their top category; split rows count by their parts.
- **Periods** (running columns added in 0.9.1-2): Maand = the last 6 complete months **and the running month** (7 columns at most), Kwartaal = up to 4 quarters complete in the history **and the running quarter so far** (5 at most), Jaar = each year cut to the history **up to and including the year of the running month** (no trend), Eigen = any months including the running one. A view without a complete period shows the running month.
- **Trend**: none for Jaar, for a partial period (the running month, quarter or year, a first month that starts after the 1st), next to one, and when the previous period is outside the history; "nieuw" when the previous amount was 0.
- **Running columns** (plan [0.9.1-2](../../plan/v0.9.1-improvements/02-running-periods.md), the user's request of 25 Nov 2026): a column that holds the running month is the last column of its view, drawn lighter and called "loopt nog, tot 18 nov" (aria "(loopt nog, tot 18 nov)", category head "lopend · tot 18 nov", the note under the chart). It has no trend and is no base for one; its category rows keep the progress against the budget or average ("€ 66,90 van € 350,00 · 19 %"), read against the references of the months in the column: the running month counts its whole budget, a running quarter or year the sum of the months so far (the reports end with the running month), nothing is pro-rated.
  - **What the running column holds**: Maand the running month; Kwartaal the running quarter **so far** (K4 in November: oktober and november), appended after the complete quarters (a history that starts inside it keeps that one column); Jaar January (or the first month) to the running month, titled "2026" without an end month (a first year cut at the start: "2025 · vanaf november"). A column never reaches past the running month: GET /api/reports/months and /balances refuse a later `to`.
  - **Default selection**: Maand and Jaar open on their last column, the running month and the running year; Kwartaal and Eigen on the last column that is not partial (Kwartaal: the last complete quarter, K3 in November); when none is complete, the last. Changing period, scope or account resets it.
  - **Drill-down `periode`**: the month `2026-11`, a complete quarter `2026-K3`, a complete year `2026`; the running quarter and year the explicit range of their months (`2026-10..2026-11`, `2026-01..2026-11`), as for a year cut to the history, so Transacties lists what the column counts.
  - **Bar size** by column count: Maand's 7 and Kwartaal's 5 columns are size `s` (the base bar width, no rule of its own in `Overzicht.css`); a Kwartaal with 4 columns (the demo: K1 to K3 and the running K4) is `m`.

## The week and the receipt (plan 0.9-3c to 0.9-3e, 23 Nov 2026)
- **Week = ISO week**, Monday to Sunday, Brussels dates, labelled "Week 47 · 16–22 nov" with the ISO week-year. Overzicht has no week period; weeks exist on the receipt page ([overzichtbon](../screens/overzichtbon.md)) and in the week overview notification.
- **One rule, two groupings**: a week is a date range summed with the same `reportBucket` and selection as a month (`ReportRange`); the month receipt is the same function, so it cannot drift from `GET /api/reports/months`.
- **Every Overzicht period has a receipt** (25 Nov 2026): besides week and month, `GET /api/reports/receipt` takes `kwartaal` (the calendar quarter), `jaar` (the calendar year, "Jaar 2025 · vanaf 1 nov" when the history starts inside it) and `eigen` (whole months from `van`'s to `tot`'s, at most 600 months like the months report). The previous period is the previous quarter, the previous calendar year, or the range of as many months just before; the comparison rules below are unchanged. **Budgets stay months only.**
- **The receipt compares against the previous full period even while the period is running** (at 19:00 on the last day it still is); Overzicht keeps its rule of no trend for a running period. No comparison when the previous period is outside the history or the current one is a partial first period.
- Pending rows never count; at 19:00 the last day or two read low, which the receipt says ("Loopt nog").
