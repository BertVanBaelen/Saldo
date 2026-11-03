# Account group and scope switch

Analysis: 4.5, 5.3, risk 16, decision "Account groups" · Screens: [start](../screens/start.md), [transacties](../screens/transacties.md), [overzicht](../screens/overzicht.md), [planning](../screens/planning.md) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.1-7](../../plan/v0.1-mockup/07-review-and-freeze.md), [0.5-4](../../plan/v0.5-shared-accounts/04-account-groups-and-scope.md), [0.6-1](../../plan/v0.6-overview/01-reports-api.md), [0.6-3](../../plan/v0.6-overview/03-start-live.md), [0.7-4](../../plan/v0.7-planning/04-forecast-engine.md), [0.7-6](../../plan/v0.7-planning/06-planning-screen.md), [2.0-2](../../plan/v2.0-investments/02-net-worth.md)

## What it is
The unit for every verdict about money.
- All personal **current** accounts of a user form one group: **"Persoonlijk"**.
- Every shared account is its **own** group, shown with its own name ("Gedeelde rekening").
- A group's buffer is the sum of the buffers of its accounts.

## Rules
- Groups are **never added together** in a chart, a buffer check, a warning or a month budget.
- In **Alles** the groups are shown side by side (one chart, summary and breakdown per group). A total across groups is information only ("Saldo nu · alle rekeningen"), never a verdict (risk 16).
- Transfers between accounts inside one group net to zero. Transfers between your own groups are left out of income and expenses ([internal-transfer](internal-transfer.md)).
- A calendar day in Alles takes the **worst** state of the groups.
- **Open question (found in 0.1-2):** the Overzicht boards show **one combined** chart and category breakdown in Alles (internal transfers netted out, e.g. income € 3.300 = salary € 2.850 + Partner's € 450 contribution). That contradicts "never added together in a chart". Proposed reading: the rule applies to **verdicts** (balances, buffers, warnings, free to spend), while past-period income and expense totals may be combined because they carry no verdict. Decide in 0.1-7; the mockup follows the board. The Planning board does the same in **Maanden** for Alles (combined buffer € 1.500, "€ 131,64 onder buffer" in January) and in the desktop buffer pill "Buffer · zicht + gedeeld". That one **is** a verdict, so it conflicts with risk 16 even under the proposed reading.

## Scope switch
Segmented control (`role="group"`, label "Welke rekeningen") with three buttons, on Start, Transacties, Overzicht and Planning:

| Value | Label | Icon | Selected background / text |
|---|---|---|---|
| `alles` | Alles | 2×2 squares | `--text` / `--bg` |
| `persoonlijk` | Persoonlijk | person | `--green` / `--onGreen` |
| `gedeeld` | Gedeeld | two persons | `--shared` / `--onShared` |

Phone: full width, three equal columns, 40 px buttons. Desktop: inline in the page header, 36 px buttons. The choice carries across screens (mockup: `localStorage`, app: per user).

## Related
[account](account.md) · [buffer-and-states](buffer-and-states.md) · [forecast](forecast.md) · [budget](budget.md)
