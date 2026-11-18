# Internal transfer and saved

Analysis: 4.3, 4.4, 5.2 · Data: `transfer_override` (pairing itself is not stored) · Screens: [transacties](../screens/transacties.md), [overzicht](../screens/overzicht.md), [planning](../screens/planning.md) · Phases: [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.6-3](../../plan/v0.6-shared-accounts/03-transfers-and-saved.md), [0.7-1](../../plan/v0.7-overview/01-reports-api.md), [0.8-0a](../../plan/v0.8-planning/00-saving-categories.md), [0.8-3](../../plan/v0.8-planning/03-forecast-engine.md)

## Rules
Evaluated **per viewer, at query time**. A transaction is an internal transfer for a user when:
- the counterparty IBAN is an account **that user can see** (personal, joined shared, registered savings), or
- an opposite amount exists on another account the user can see within about 3 days (same currency, the partner row booked), **unless the IBANs contradict the pair**: when a row names a counterparty IBAN, the other account must have no registered IBAN or that same IBAN. (Decided 16 Nov 2026: without it, Partner's contribution to the shared account paired with Bert's own payment of the same amount and was labelled a transfer.)

Then:
- Internal transfers are excluded from income and expenses in that user's combined views.
- A transfer **to a savings account** is always shown as **saved** ("gespaard"), not as an expense and not hidden.
- Your monthly transfer to the shared account is internal in Alles, but an outgoing item in Persoonlijk, shown as "Naar gedeelde rekening".
- The other user's personal accounts are never used for matching, so no label reveals them.
- The user can mark a transaction as "is a transfer" / "is not a transfer" [S], stored per user.

## In sums: the selection rule (plan 0.7-1, 17 Nov 2026)
Whether a transfer is "internal" depends on which accounts a sum covers. A sum covers a **selection**: one filtered current account, or every current account of the scope (savings and investment accounts are never in it). For a transfer on an account in the selection:

| Other side | Outgoing | Incoming |
|---|---|---|
| in the selection, and its history has started (first booked row on or before this date plus 3 days, the pairing window) | left out | left out |
| a savings or investment account | Gespaard + | Gespaard − (net; a month can be negative) |
| a shared account, from a personal account | "Naar gedeelde rekening" (an expense row, `--shared`) | income |
| any other own current account, or one in the selection whose history starts later | "Naar eigen rekening" (an expense row) | income (not netted) |
| unknown (marked "is een overschrijving", no partner found) | left out | left out |

**Saving categories** (plan [0.8-0a](../../plan/v0.8-planning/00-saving-categories.md)): a row or split part whose top category is marked "Telt als gespaard" is Gespaard (net) unless it is an internal transfer with its other side in the selection (left out, rule above); it wins over "Naar gedeelde rekening", "Naar eigen rekening", "Niet gecategoriseerd" and over the "left out" of "is een overschrijving" without a partner. A detected transfer to a savings account is Gespaard once, whatever its category.

So in Alles the € 450 contribution is left out, in Persoonlijk it is "Naar gedeelde rekening", in Gedeeld both contributions are income (€ 900), and per account each account counts its own transfers (the footnote "tellen per rekening mee, maar niet in het totaal samen"). Bilance history from before the shared account's history (for example 2020–2024) shows the contributions as "Naar gedeelde rekening" in Alles too, because the other half is not in Saldo. Transacties' own transfer flag and kind (0.6-3) do not change.

Known limits (plan 0.7 README): the opposite-amount match is not one-to-one (an equal contribution imported without IBAN pairs with your own and is left out in Alles); sums use today's membership, so leaving or a partner leaving reclassifies history; a transfer to an investment account counts as saved in sums while Transacties labels it `internal`.

## In the design (Transacties)
A transfer row shows its amount in `--text`, not red, and its detail has no category picker but the note "Overschrijving naar je spaarrekening. Telt als gespaard, niet als uitgave." Overzicht counts the € 200 per month to savings as "Gespaard".

## Dutch labels
"Overschrijving tussen eigen rekeningen", "Gespaard", "Naar gedeelde rekening".
