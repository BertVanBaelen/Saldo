# 0.3-3 · Transacties

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | built (5 Nov 2026), to verify on the live add-on. Reviewed and fixed 9 Nov 2026 |
| Size | M |
| Features | TX-2 |
| Concepts | [transaction](../../analysis/concepts/transaction.md), [account](../../analysis/concepts/account.md) |
| Screens | [transacties](../../analysis/screens/transacties.md) |
| Analysis | 4.1, 12 (screen 3) |
| Depends on | [0.3-1](01-sync-engine.md) |

## Goal
See every synced transaction the way the mockup shows it.

## Steps
1. List grouped by day, account label with the account colour, pending rows, "Oudere transacties laden".
2. Search on name, amount and communication; filters for account, period and category (dropdowns as designed).
3. Detail sheet / panel, read-only until 0.4 (category, notes and split follow there).
4. Empty state for a user without accounts.

## Done when
You find any transaction of the last months in a few taps, on phone and desktop.

## Reviewed and fixed (9 Nov 2026)
An independent review found and fixed two bugs: Transacties showed the previous filter's rows when a new filter failed to load, and "Oudere transacties laden" could send a new filter with an old cursor.

Also changed:
- "Deze maand" and "Laatste 3 maanden" now end at the end of the current month, and "Dit jaar" at 31 December, so rows dated after today (pending, value date) show.
- The amount search no longer guesses ambiguous input: text that is not one clear amount (for example `1.50.0`) adds no amount match, and the text still searches counterparty and communication ([docs/api.md](../../docs/api.md), `GET /api/transactions`).