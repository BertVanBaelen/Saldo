# Internal transfer and saved

Analysis: 4.3, 4.4, 5.2 · Data: `transfer_override` (pairing itself is not stored) · Screens: [transacties](../screens/transacties.md), [overzicht](../screens/overzicht.md), [planning](../screens/planning.md) · Phases: [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-6](../../plan/v0.1-mockup/06-missing-designs.md), [0.5-3](../../plan/v0.5-shared-accounts/03-transfers-and-saved.md), [0.6-1](../../plan/v0.6-overview/01-reports-api.md), [0.7-4](../../plan/v0.7-planning/04-forecast-engine.md)

## Rules
Evaluated **per viewer, at query time**. A transaction is an internal transfer for a user when:
- the counterparty IBAN is an account **that user can see** (personal, joined shared, registered savings), or
- an opposite amount exists on another account the user can see within about 3 days.

Then:
- Internal transfers are excluded from income and expenses in that user's combined views.
- A transfer **to a savings account** is always shown as **saved** ("gespaard"), not as an expense and not hidden.
- Your monthly transfer to the shared account is internal in Alles, but an outgoing item in Persoonlijk, shown as "Naar gedeelde rekening".
- The other user's personal accounts are never used for matching, so no label reveals them.
- The user can mark a transaction as "is a transfer" / "is not a transfer" [S], stored per user.

## In the design (Transacties)
A transfer row shows its amount in `--text`, not red, and its detail has no category picker but the note "Overschrijving naar je spaarrekening. Telt als gespaard, niet als uitgave." Overzicht counts the € 200 per month to savings as "Gespaard".

## Dutch labels
"Overschrijving tussen eigen rekeningen", "Gespaard", "Naar gedeelde rekening".
