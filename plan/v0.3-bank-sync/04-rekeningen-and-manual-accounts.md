# 0.3-4 · Rekeningen, account detail and manual accounts

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | built (5 Nov 2026), to verify on the live add-on. Reviewed and fixed 9 Nov 2026 |
| Size | M |
| Features | ACCT-1 |
| Concepts | [account](../../analysis/concepts/account.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [bank-connection](../../analysis/concepts/bank-connection.md) |
| Screens | [rekeningen](../../analysis/screens/rekeningen.md) |
| Analysis | 3, 4.7, 4.8 (remove a link) |
| Depends on | [0.3-1](01-sync-engine.md) |

## Goal
Manage your accounts, including the savings accounts the bank does not expose.

## Steps
1. Rekeningen: name, colour (8) and minimum buffer per current account, as designed.
2. Account detail: balance history, settings, Synchronisatie (sources, consent, re-authorise, remove your link with keep or delete history), recent transactions.
3. Manual accounts: savings or a current account without a bank link; register an IBAN only to recognise transfers; update the balance by hand with history and "last updated".
4. Add an account: link a bank account (wizard) or create a manual account.

## Done when
You see all your accounts with the buffer you set, and your savings balances with their date.

## Reviewed and fixed (9 Nov 2026)
An independent review found and fixed:
- Removing a bank link now waits at most 30 s for a running sync of it and then answers 503 without removing anything.
- A link removed while a re-authorisation was in flight can no longer come back active.
- The colour choice in "Rekening toevoegen" now works with the arrow keys.
- The account page offers "Nu opnieuw proberen" when the sync failed or is stale.
- The sidebar badge refreshes after IBAN changes and manual-account deletes.

## Decided (9 Nov 2026)
The "Overschrijvingen naar deze rekening" card of the mockup on a manual account is not built: it is deferred to 0.6-3 (transfers and "Gespaard").

## Notes
Small nits left as they are:
- `ValidIBAN` does not check the length per country, and `NormalizeIBAN` drops stray characters instead of refusing them.
- The `PATCH /api/accounts/{id}` message for an empty body ("Geef een naam, een kleur of een buffer op.") does not mention the IBAN.