# User, roles and visibility

Analysis: 2, 4.8, 7 · Data: `user`, `account_access` · Screens: [meer](../screens/meer.md), [instellingen](../screens/instellingen.md) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-4](../../plan/v0.1-mockup/04-rekeningen-meer-meldingen.md), [0.1-6](../../plan/v0.1-mockup/06-missing-designs.md), [0.2-4](../../plan/v0.2-foundation/04-sign-in-users-mail.md), [0.5-1](../../plan/v0.5-shared-accounts/01-membership-and-lifecycle.md), [0.5-2](../../plan/v0.5-shared-accounts/02-privacy.md), [1.0-1](../../plan/v1.0-release/01-export.md), [1.0-2](../../plan/v1.0-release/02-security-review.md)

## What it is
A person with their own login. v1 has two: Bert (admin) and Partner.

## Rules
- **Everyone sees only the accounts they added themselves** (linked through the bank, joined by IBAN, or created manually), and only figures calculated from those accounts. No invitations to view someone else's account, no cross-user figures.
- The **admin** role manages users only (invite, reset password). It never grants access to another user's accounts.
- Visibility is enforced **server-side in every query** (overview, forecast, search, export, notifications), never only in the UI.
- Deleting a user deletes their personal and manual accounts. Shared accounts stay with the remaining members ([shared-account](shared-account.md)).
- Privacy tests: user A never sees user B's accounts, balances, counterparties or transfers (risk 7).

## Data
`user`: email, password hash, role (`admin` | `user`), language, planning look-ahead (months), quiet hours, created at.

## In the design
- Avatar circle with initial on pastel `--c2` (Bert) and `--c3` (Partner). The desktop sidebar footer shows name and role ("Beheerder").
- "Meer" profile card: name, "Profiel, wachtwoord, taal", role chip "Beheerder".
- "Beheerder" is used both for the admin role (profile chip) and for the manager of a shared account. Keep the meanings apart in code: `user.role = admin` vs `account_access.role = manager`.

## Related
[authentication](authentication.md) · [shared-account](shared-account.md) · [account-group](account-group.md)
