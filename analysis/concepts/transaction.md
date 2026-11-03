# Transaction

Analysis: 4.1, 4.2, 4.4, 5.1, 6.3 · Data: `transaction`, `transfer_override` · Screens: [transacties](../screens/transacties.md), [start](../screens/start.md), [overzicht](../screens/overzicht.md) · Phases: [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.2-1](../../plan/v0.2-foundation/01-spike-enable-banking.md), [0.2-2](../../plan/v0.2-foundation/02-spike-bilance-csv.md), [0.3-3](../../plan/v0.3-bank-sync/03-sync-engine.md), [0.3-5](../../plan/v0.3-bank-sync/05-csv-import.md), [0.3-6](../../plan/v0.3-bank-sync/06-transacties-and-rekeningen.md), [0.4-2](../../plan/v0.4-categorisation/02-rules-engine.md), [0.4-3](../../plan/v0.4-categorisation/03-categorise-in-transacties.md), [0.5-3](../../plan/v0.5-shared-accounts/03-transfers-and-saved.md), [0.9-3](../../plan/v0.9-bilance-import/03-overlap-and-duplicates.md)

## Fields
Account, amount (**cents**, signed), booking date, value date, counterparty name and IBAN, communication, status (`pending` | `booked`), external id (`entry_reference`), dedupe key, source (connection or import batch), raw payload, category, note.

## Rules
- A transaction belongs to the month of its **booking date** (Europe/Brussels).
- **Pending**: shown with a dashed "In behandeling" chip and a dashed "?" avatar, amount in muted colour, excluded from category totals until booked.
- **Dedupe key**: account IBAN + booked `entry_reference`, falling back to a hash of date, amount, counterparty and communication. Identical same-day rows (two coffees) are kept by counting occurrences per hash. Across connections the fallback hash is used.
- Manual transactions are allowed (needed for savings).
- Detail actions: category picker, "apply to similar and create a rule", split over categories [S], mark as transfer / not a transfer [S], note. Edit controls are hidden for read-only members.

## In the design (list row)
- 40 px round avatar with the counterparty initial on the category pastel, or green soft for income. Name 15/500, subline 13 muted ("Boodschappen · vandaag", "Salaris · 2 nov").
- Amount right-aligned, Geist Mono 15/500: expenses `−€ 86,42` in `--neg`, income `+€ 2.850,00` in `--text`.
- An account label on every row (personal green / shared violet) — see [account-group](account-group.md).
- The list is grouped by day.
- Uncategorised: dashed muted "?" avatar and "Niet gecategoriseerd". Pending and uncategorised can coexist (Bol.com).
- Detail status reads "Geboekt" or "In behandeling"; pending note "Nog in behandeling. Telt mee in de totalen zodra de bank ze boekt."
- Phone row subline = account label + category; desktop row = account label + account name, with the category as its own chip column. Avatar 40 px phone, 36 px desktop.
- Full detail spec and the 16 demo rows: [transacties](../screens/transacties.md#design-notes).

## Related
[category](category.md) · [categorisation-rule](categorisation-rule.md) · [internal-transfer](internal-transfer.md) · [import](import.md) · [money-and-format](money-and-format.md)
