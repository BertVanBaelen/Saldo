# Scope switch, independent accounts and sums

Analysis: 4.4, 4.5, 5.3, risk 16, decisions "Accounts are independent", "Scope switch", "Sums" · Screens: [start](../screens/start.md), [transacties](../screens/transacties.md), [overzicht](../screens/overzicht.md), [planning](../screens/planning.md) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.3-5](../../plan/v0.3-bank-sync/05-start-balances.md), [0.6-4](../../plan/v0.6-shared-accounts/04-scope-and-sums.md), [0.7-1](../../plan/v0.7-overview/01-reports-api.md), [0.7-2](../../plan/v0.7-overview/02-overzicht-screen.md), [0.7-3](../../plan/v0.7-overview/03-start-spending.md), [0.8-4](../../plan/v0.8-planning/04-forecast-engine.md), [0.8-6](../../plan/v0.8-planning/06-planning-screen.md), [2.0-2](../../plan/v2.0-investments/02-net-worth.md)

This file replaces the former concept "account group" (decision of 3 Nov 2026).

## Accounts are independent
- Every **current account** is the unit for every verdict about money: its own buffer, forecast, month results, daily line, warnings ("staat rood", "zakt in de buffer") and free-to-spend amount. One account's buffer never affects another.
- There is no merged "Persoonlijk group". A user may hold several personal current accounts, several shared accounts, or none of one kind; every account is calculated on its own.
- **Personal or shared** follows from membership: an account with one member is personal ("Persoonlijk"), an account with more than one member is shared ("Gedeeld"). Apart from the label and the sharing options (members, permissions, contributions, fallback links) they behave the same ([shared-account](shared-account.md)).
- Savings and investment accounts have no buffer and no forecast; they are shown, never judged.

## Scope switch (a filter)
Segmented control (`role="group"`, label "Welke rekeningen") with three buttons on Start, Transacties, Overzicht and Planning:

| Value | Label | Shows | Icon | Selected background / text |
|---|---|---|---|---|
| `alles` | Alles | every account, in one place | 2×2 squares | `--text` / `--bg` |
| `persoonlijk` | Persoonlijk | accounts with one member | person | `--green` / `--onGreen` |
| `gedeeld` | Gedeeld | accounts with more than one member | two persons | `--shared` / `--onShared` |

Phone: full width, three equal columns, 40 px buttons. Desktop: inline in the page header, 36 px buttons. The choice carries across screens (mockup: `localStorage`, app: per user, `user.last_scope`). When a scope holds no account (for example no shared account yet), its screens show an empty state that explains how an account gets there.

## Several accounts in view
- Each account is shown with its **own name and colour**: one chart, one summary tile, one breakdown per account, side by side.
- A screen may add a **sum** across the accounts in view as **information** ("Saldo nu · alle rekeningen", "samen € 1.852,37", Overzicht's income and expenses of all accounts together). Internal transfers between the accounts in view are left out of such sums ([internal-transfer](internal-transfer.md)).
- A sum **never carries a verdict**: no combined buffer, no yellow or red state, no warning, no free-to-spend amount. A chip that summarises per-account states ("1 rekening vraagt aandacht", "Alle rekeningen boven buffer") is allowed, because it counts verdicts instead of judging a sum.
- A calendar day with several accounts in view takes the **worst** state of those accounts and names them.
- Risk 16 (a partner reading the Alles totals as a household total) is covered by labelling every sum as information and keeping every verdict per account.

## In the mockup
- `js/data.js`: `accounts[].group` is the scope an account falls in (`pers` or `ged`), `groups[]` holds one forecast per current account, titled with the account name.
- Start: tiles, alerts and "Komende maanden" per account; the hero sum and the spending total are labelled as information. Planning: summary, charts, Maanden, buffers and budgets per account. Overzicht: sums with a per-account breakdown.

## Related
[account](account.md) · [buffer-and-states](buffer-and-states.md) · [forecast](forecast.md) · [budget](budget.md) · [shared-account](shared-account.md)