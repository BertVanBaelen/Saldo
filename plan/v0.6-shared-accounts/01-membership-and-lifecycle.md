# 0.6-1 · Membership and lifecycle

| | |
|---|---|
| Version | [0.6 Shared accounts](README.md) |
| Status | planned |
| Size | L |
| Features | SHARE-1, SHARE-2 |
| Concepts | [shared-account](../../analysis/concepts/shared-account.md), [account](../../analysis/concepts/account.md), [bank-connection](../../analysis/concepts/bank-connection.md), [user-and-visibility](../../analysis/concepts/user-and-visibility.md) |
| Screens | [bank-koppelen](../../analysis/screens/bank-koppelen.md), [rekeningen](../../analysis/screens/rekeningen.md) |
| Analysis | 4.8, 6.3 |
| Depends on | [0.3-1](../v0.3-bank-sync/01-sync-engine.md), [0.3-4](../v0.3-bank-sync/04-rekeningen-and-manual-accounts.md) |

## Goal
One account per IBAN, shared by its holders, with clear roles.

## Steps
1. `account_access`: role manager or member, permission read or edit (default edit), joined at.
2. Linking an existing IBAN offers "Deze rekening bestaat al. Wil je aansluiten?"; joining notifies the manager (in-app; e-mail and push in 0.9). From then on the account shows as Gedeeld for its members.
3. `account_source`: primary and fallback connections; the fallback takes over when the primary consent lapses and fills gaps (merged on the dedupe key).
4. Leden in the account detail: the manager changes permissions; read-only members see no edit controls anywhere (Transacties, Planning, Rekeningen, Categorieën).
5. Lifecycle: remove your own link (keep or delete history), leave an account, manager hand-over to the longest-standing member, delete an account for everyone, admin deletes a user.

## Done when
Partner joins your shared account through her own bank link, without duplicate transactions, and each lifecycle action works.