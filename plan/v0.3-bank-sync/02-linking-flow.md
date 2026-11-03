# 0.3-2 · Linking flow and account matching

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | planned |
| Features | BANK-2 |
| Concepts | [bank-connection](../../analysis/concepts/bank-connection.md), [account](../../analysis/concepts/account.md), [shared-account](../../analysis/concepts/shared-account.md) |
| Screens | [bank-koppelen](../../analysis/screens/bank-koppelen.md) |
| Analysis | 6.2, 6.3 |
| Depends on | 0.3-1 |

## Goal
Link Argenta accounts safely and never create the same IBAN twice.

## Steps
1. Start linking: `POST /auth` with the maximum `valid_until` and a random single-use `state` bound to the session (15 minutes).
2. Callback `/api/bank/callback`: reject unknown, expired or reused `state` and session mismatches; create the session; list accounts.
3. Match by IBAN: create the account with the user as manager. (An IBAN that already exists for another user is handled in 0.5-1; until then it is refused with a clear message.)
4. Re-authorise on the same connection, matched by IBAN.
5. Bank koppelen wizard as designed in 0.1-6.

## Done when
You link your zichtrekening and the shared account in one consent; re-authorising creates no duplicates.
