# 0.3-1 · Provider adapter and Enable Banking client

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | planned |
| Features | BANK-1 |
| Concepts | [bank-connection](../../analysis/concepts/bank-connection.md) |
| Screens | [instellingen](../../analysis/screens/instellingen.md) |
| Analysis | 6.1, 6.4, 7 (secrets) |
| Depends on | 0.2-1, 0.2-5 |

## Goal
Talk to Enable Banking with each user's own credentials, behind the same interface as the fake bank.

## Steps
1. Enable Banking implementation of the provider interface; JWT RS256 signed with the user's key, max 24 h.
2. `provider_connection` table; application id and PEM key stored encrypted with the key generated on first start, kept apart from the database.
3. Settings form for application id and key upload, with a connection test.
4. Integration tests against the fake provider; unit tests for JWT signing.

## Done when
A user can store their Enable Banking credentials and the server can call the API with them.
