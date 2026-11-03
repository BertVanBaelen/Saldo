# Bank koppelen (wizard)

Analysis: 6.2, 6.3, 12 (screen 7) · Design: to design · Concepts: [bank-connection](../concepts/bank-connection.md), [account](../concepts/account.md), [shared-account](../concepts/shared-account.md) · Phases: [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.2-6](../../plan/v0.2-foundation/06-first-bank-link.md), [0.3-2](../../plan/v0.3-bank-sync/02-consent-reminders.md), [0.6-1](../../plan/v0.6-shared-accounts/01-membership-and-lifecycle.md)

## Steps to design
1. Choose Argenta.
2. Explanation and redirect to the bank (SCA in the Argenta app, Digipass or itsme).
3. Return and choose accounts.
4. "Deze rekening bestaat al. Wil je aansluiten?" for an IBAN that exists.
5. First sync progress (`strategy=longest`).
