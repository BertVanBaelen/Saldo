# 0.2-5 · Security baseline and public access

| | |
|---|---|
| Version | [0.2 Foundation and first bank link](README.md) |
| Status | planned |
| Size | M |
| Features | SEC-0 |
| Concepts | [authentication](../../analysis/concepts/authentication.md), [user-and-visibility](../../analysis/concepts/user-and-visibility.md), [bank-connection](../../analysis/concepts/bank-connection.md) |
| Analysis | 7, 13.4, risks 13, 17, 20 |
| Depends on | [0.2-4](04-sign-in-users-mail.md) |

## Goal
Make the public domain safe enough for real bank data **before** the first real link (decision of 3 Nov 2026: real bank data from the first version, on the public domain).

## Steps
1. Cloudflared route to the add-on on your domain; HTTPS only, HSTS.
2. Encryption key generated on first start and stored apart from the database; secret fields (Enable Banking keys, tokens) encrypted with it.
3. Every query that touches financial data goes through `account_access` for the viewer, from the first table on; the first privacy tests (user A never sees user B's accounts) run in CI.
4. Check sign-in, devices, rate limits, CSRF, CSP, headers, the planned bank callback (`state` handling) and outbound traffic against analysis 7.
5. Home Assistant backups encrypted; a first restore test of the empty add-on.
6. Write `docs/security-baseline.md`: what was checked, what is accepted, what waits for the full review in 1.0-2.

## Done when
The baseline document is written and every finding is fixed or accepted with a reason. Only then the first real bank link (0.2-6) is made.