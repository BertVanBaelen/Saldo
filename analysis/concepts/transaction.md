# Transaction

Analysis: 4.1, 4.2, 4.4, 5.1, 6.3 · Data: `transaction`, `transaction_split`, `transfer_override` · Screens: [transacties](../screens/transacties.md), [start](../screens/start.md), [overzicht](../screens/overzicht.md) · Phases: [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.2-1](../../plan/v0.2-foundation/01-spike-enable-banking.md), [0.2-6](../../plan/v0.2-foundation/06-first-bank-link.md), [0.3-1](../../plan/v0.3-bank-sync/01-sync-engine.md), [0.3-3](../../plan/v0.3-bank-sync/03-transacties.md), [0.3-6](../../plan/v0.3-bank-sync/06-csv-import.md), [0.4-2](../../plan/v0.4-categorisation/02-rules-engine.md), [0.4-3](../../plan/v0.4-categorisation/03-categorise-in-transacties.md), [0.5-1](../../plan/v0.5-bilance-import/01-spike-bilance-csv.md), [0.5-4](../../plan/v0.5-bilance-import/04-overlap-and-duplicates.md), [0.6-3](../../plan/v0.6-shared-accounts/03-transfers-and-saved.md)

## Fields
Account, amount (**cents**, signed), booking date, value date, counterparty name and IBAN, communication, status (`pending` | `booked`), external id (`entry_reference`), dedupe key, occurrence, source (connection or import batch), raw payload, category, **category origin** (`manual` | `rule` | `suggestion` | `import`) and the rule that set it, note. A split stores its parts in `transaction_split` (category, amount; the parts add up to the amount).

## Rules
- A transaction belongs to the month of its **booking date** (Europe/Brussels).
- **Pending**: shown with a dashed "In behandeling" chip and a dashed "?" avatar, amount in muted colour, excluded from category totals until booked.
- **Dedupe key**: account IBAN + booked `entry_reference`, falling back to a hash of date, amount, counterparty and communication. Identical same-day rows (two coffees) are kept by counting occurrences per hash. Across connections the fallback hash is used.
- Manual transactions are allowed (needed for savings).
- Detail actions: category picker, "apply to similar and create a rule", split over categories [S], mark as transfer / not a transfer [S], note, a link to the rule that set the category (only when the viewer can see that rule). Edit controls are hidden for read-only members. The category origin is what keeps a manual choice from ever being overwritten by rules.
- **Category origin**: `manual`, `rule`, `suggestion` or `import`. Rules, suggestions and "apply to similar" only change a transaction without splits that has no category or origin `rule` or `suggestion`. A `manual` or `import` category is replaced only by an explicit pick on that one transaction. An `import` category is also set once on a stored transaction that has no category, when a probable duplicate of a Bilance row is skipped at import (0.5-4); it never replaces a category. A pending transaction can be categorised.
- **Note**: at most 200 characters, white space collapsed, empty clears it. Visible to everyone with access to the account (read-only members too); changing it needs edit permission. Not searched.
- **Split** [S]: booked transactions only (a pending amount may still change), 2 to 10 parts, each with the sign of the amount and not 0, adding up exactly to the amount. New parts replace the old ones. The transaction keeps its own category, origin and rule only to restore them when the split is undone; they are hidden while it is split, and it cannot be given a category or be changed by rules. A split transaction is not "uncategorised". Sums and category counts use the parts, so it counts once under each category it has a part in.
- **Pending to booked**: when a sync replaces a pending transaction by its booked one, the booked transaction inherits the note and, if the pending one's category was `manual`, that category (origin `manual`). The pair: same account and amount, equal normalised counterparty (lower case, Latin diacritics folded, white space collapsed), booked date within 7 days of the pending date, one to one, closest date first. Only a booked transaction that is new in that fetch inherits. Nothing else is carried (no rule link, no split). This runs before the rules, so a carried category is not re-tagged.

## In the design (list row)
- 40 px round avatar with the counterparty initial on the category pastel, or green soft for income. Name 15/500, subline 13 muted ("Boodschappen · vandaag", "Salaris · 2 nov").
- Amount right-aligned, Geist Mono 15/500: expenses `−€ 86,42` in `--neg`, income `+€ 2.850,00` in `--text`.
- An account label on every row (personal green / shared violet) — see [scope](scope.md).
- The list is grouped by day.
- Uncategorised: dashed muted "?" avatar and "Niet gecategoriseerd". Pending and uncategorised can coexist (Bol.com).
- Detail status reads "Geboekt" or "In behandeling"; pending note "Nog in behandeling. Telt mee in de totalen zodra de bank ze boekt."
- Phone row subline = account label + category; desktop row = account label + account name, with the category as its own chip column. Avatar 40 px phone, 36 px desktop.
- Full detail spec and the 16 demo rows: [transacties](../screens/transacties.md#design-notes).

## Related
[category](category.md) · [categorisation-rule](categorisation-rule.md) · [internal-transfer](internal-transfer.md) · [import](import.md) · [money-and-format](money-and-format.md)
