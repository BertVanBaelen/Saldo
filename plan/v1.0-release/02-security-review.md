# 1.0-2 · Full security review

| | |
|---|---|
| Version | [1.0 Release](README.md) |
| Status | planned |
| Size | M |
| Features | SEC-1 |
| Concepts | [authentication](../../analysis/concepts/authentication.md), [user-and-visibility](../../analysis/concepts/user-and-visibility.md), [bank-connection](../../analysis/concepts/bank-connection.md) |
| Analysis | 7, 13.4, risks 6, 7, 13, 17, 18, 20 |
| Depends on | [0.9-5](../v0.9-notifications/05-lock-screen-check.md), [1.0-1](01-export.md) |

## Goal
A full review of everything that was built on top of the security baseline of 0.2-5.

## Steps
1. Review sign-in, trusted devices, CSRF, CSP, rate limits, the bank callback and `state` handling, secret encryption, privacy scoping, imports, exports, push and outbound traffic.
2. Dependency and container check; scan the public repository history for secrets and personal data.
3. Write `docs/security-review-v1.md` with findings and fixes.

## Done when
The review is written and every finding is fixed or accepted with a reason.