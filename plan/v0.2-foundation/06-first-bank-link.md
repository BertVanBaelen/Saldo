# 0.2-6 · First bank link and first sync

| | |
|---|---|
| Version | [0.2 Foundation and first bank link](README.md) |
| Status | built (5 Nov 2026): Enable Banking client, settings, link, callback, first sync, Bankkoppelingen and the fake provider for demo mode; tested against fakes only. To do: spike S1 (0.2-1), then the first real link on the live add-on |
| Size | L |
| Features | BANK-1, BANK-2, PLAT-4 |
| Concepts | [bank-connection](../../analysis/concepts/bank-connection.md), [account](../../analysis/concepts/account.md), [transaction](../../analysis/concepts/transaction.md), [shared-account](../../analysis/concepts/shared-account.md) |
| Screens | [bank-koppelen](../../analysis/screens/bank-koppelen.md), [instellingen](../../analysis/screens/instellingen.md), [rekeningen](../../analysis/screens/rekeningen.md), [transacties](../../analysis/screens/transacties.md) |
| Analysis | 4.1, 6.1, 6.2, 6.3, 6.4 |
| Depends on | [0.2-1](01-spike-enable-banking.md), [0.2-5](05-security-baseline.md) |

## Goal
Link your real Argenta accounts on your own domain and see their transactions. This is the base of the app (decision of 3 Nov 2026).

## Steps
1. Provider interface (`ListAccounts`, `FetchTransactions`, `FetchBalances`) with two implementations: Enable Banking (JWT RS256 signed with the user's key, max 24 h) and a **fake provider** seeded with the demo story for tests and local development (CI never calls a real bank).
2. Instellingen → Enable Banking: application id and PEM key upload, stored encrypted, with a connection test.
3. Linking: `POST /auth` with the maximum `valid_until` and a random single-use `state` bound to the session (15 minutes); the bank returns to the web page `/bankkoppelingen/terug`, which posts to `/api/bank/callback` (the `SameSite=Strict` cookie is not sent on the redirect itself); the callback rejects unknown, expired or reused `state` and session mismatches.
4. Account matching by IBAN: create the account with the user as manager. An IBAN that already exists for another user is refused with a clear message until joining exists (0.6-1).
5. First sync with `strategy=longest`: transactions with raw payload and dedupe key, and the bank balance as `balance_snapshot`.
6. Bankkoppelingen screen and wizard as designed; a first read-only Rekeningen and Transacties list.
7. Re-authorise on the same connection, matched by IBAN.

## Done when
You and Partner each link your own Argenta accounts (the personal one and, for you, the shared account in the same consent), and see the real transactions in the app on your domain; re-authorising creates no duplicates.