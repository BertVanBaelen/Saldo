# 1.0-2 · Security review

| | |
|---|---|
| Version | [1.0 Release](README.md) |
| Status | planned |
| Features | SEC-1 |
| Concepts | [authentication](../../analysis/concepts/authentication.md), [user-and-visibility](../../analysis/concepts/user-and-visibility.md), [bank-connection](../../analysis/concepts/bank-connection.md) |
| Analysis | 7, 13.4, risks 6, 7, 13 |
| Depends on | all of 0.2 … 0.9 |

## Goal
A public endpoint with banking data that you can trust.

## Steps
1. Review sign-in, sessions, CSRF, CSP, rate limits, the bank callback and `state` handling, secret encryption, privacy scoping, exports and outbound traffic.
2. Dependency and container check.
3. Write `docs/security-review-v1.md` with findings and fixes.

## Done when
The review is written and every finding is fixed or accepted with a reason, **before** the first real bank link on the public domain.
