# Account

Analysis: 3, 4.7, 4.8, 6.3, 8 · Data: `account`, `account_source`, `balance_snapshot` · Screens: [start](../screens/start.md), [rekeningen](../screens/rekeningen.md), [transacties](../screens/transacties.md) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-4](../../plan/v0.1-mockup/04-rekeningen-meer-meldingen.md), [0.1-6](../../plan/v0.1-mockup/06-missing-designs.md), [0.2-1](../../plan/v0.2-foundation/01-spike-enable-banking.md), [0.3-2](../../plan/v0.3-bank-sync/02-linking-flow.md), [0.3-3](../../plan/v0.3-bank-sync/03-sync-engine.md), [0.3-6](../../plan/v0.3-bank-sync/06-transacties-and-rekeningen.md), [0.5-1](../../plan/v0.5-shared-accounts/01-membership-and-lifecycle.md), [0.8-1](../../plan/v0.8-notifications/01-email-templates.md), [1.0-1](../../plan/v1.0-release/01-export.md), [1.0-3](../../plan/v1.0-release/03-first-real-sync.md), [2.0-1](../../plan/v2.0-investments/01-investment-accounts.md), [2.0-2](../../plan/v2.0-investments/02-net-worth.md), [2.0-3](../../plan/v2.0-investments/03-price-lookups.md)

## Types
| Type | Dutch | Source in v1 | Buffer | Counts as available money |
|---|---|---|---|---|
| current | zichtrekening | bank API (Enable Banking) | yes | yes |
| savings | spaarrekening | manual balance | no | no |
| investment | belegging | v2 | no | no |

## Rules
- Bank accounts are keyed by **IBAN** (unique among API accounts). Account ids change per bank session, so always match by IBAN.
- Manual accounts are **private** to their creator. A manual account may carry an IBAN **only to recognise transfers** to it. That IBAN is never used for grouping or joining.
- Each sync stores the **bank-reported balance** as a `balance_snapshot`. The forecast starts from it, not from a sum of transactions.
- Savings balances are updated by hand. The app keeps a history and shows the date (risk 8): "Handmatig · bijgewerkt 2 okt".
- Every account has its own **colour** (8 to choose from) and its own **minimum buffer** in cents (current accounts only), both set under Rekeningen.
- Personal accounts are green with a person icon, shared accounts violet with a two-person icon ([design-system](design-system.md)).
- Lifecycle (4.8): remove a bank link (keep or delete history), remove an account from your login, manager hand-over ([shared-account](shared-account.md)).
- IBANs in messages are masked: `BE68 •••• •••• 4821`.

## Account colours
Eight colours, separate from the category pastels (keys green, violet, blue, teal, orange, pink, yellow, gray; labels Groen, Violet, Blauw, Petrol, Oranje, Roze, Oker, Grijs). Icons on an account colour use `--onAcc`. Hex values per theme: [rekeningen](../screens/rekeningen.md#account-colours-8). Demo: Zichtrekening green, Spaarrekening orange, Reserve yellow, Gedeelde rekening violet. A savings account shows "Telt niet mee in de planning" instead of a buffer.

## Data
- `account`: type, source (`api` | `manual`), IBAN, name, colour, minimum buffer (cents), currency, created by.
- `account_source`: account, provider connection, priority (`primary` | `fallback`).
- `balance_snapshot`: account, balance (cents), date, origin (`bank` | `manual`).

## Demo values (18 Nov 2026)
| Account | Group | Balance | Buffer | Icon tint |
|---|---|---|---|---|
| Zichtrekening | Persoonlijk | € 1.968,82 | € 900 | `--soft` / `--greenText` |
| Gedeelde rekening | Gedeeld | € 946,08 | € 600 | `--shared` / `--onShared` |
| Spaarrekening | Persoonlijk, savings | € 12.500,00 | – | `--c2` |
| Reserve | Persoonlijk, savings | € 4.200,00 | – | `--c5` |

## Related
[account-group](account-group.md) · [shared-account](shared-account.md) · [bank-connection](bank-connection.md) · [buffer-and-states](buffer-and-states.md)
