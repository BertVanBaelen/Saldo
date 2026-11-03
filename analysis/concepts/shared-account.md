# Shared account membership

Analysis: 2, 4.3, 4.8, 5.3 (contribution), 6.3 · Data: `account_access`, `account_source` · Screens: [start](../screens/start.md), [rekeningen](../screens/rekeningen.md), [bank-koppelen](../screens/bank-koppelen.md) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-4](../../plan/v0.1-mockup/04-rekeningen-meer-meldingen.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.2-1](../../plan/v0.2-foundation/01-spike-enable-banking.md), [0.2-6](../../plan/v0.2-foundation/06-first-bank-link.md), [0.6-1](../../plan/v0.6-shared-accounts/01-membership-and-lifecycle.md), [0.6-5](../../plan/v0.6-shared-accounts/05-contributions.md), [0.7-3](../../plan/v0.7-overview/03-start-spending.md), [0.8-4](../../plan/v0.8-planning/04-forecast-engine.md), [0.9-3](../../plan/v0.9-notifications/03-triggers-and-scheduler.md)

## Rules
- A shared account is an ordinary account with **more than one member**; apart from the label "Gedeeld" and the sharing options below it behaves like a personal account, with its own buffer and forecast ([scope](scope.md)). A user may have several shared accounts.
- Grouped by **IBAN**. The first holder who links it is the **manager** ("beheerder"). Another holder who links the same IBAN is asked whether to join the existing account and joins after confirmation. The other members are notified ("Iemand sluit aan").
- Linking proves holder rights (SCA at the bank), so nobody can join an account they don't hold. Joining gives access to its stored history.
- Per member permission **read** ("Lezen") or **edit** ("Bewerken"), default edit for a joining co-holder. Edit allows recategorising, splitting, annotating, and managing the recurring items, budgets and rules of that account. Read-only members see a lock chip "Alleen lezen" and no edit controls.
- Only the manager changes permissions or removes the account for everyone. Any member can add or remove **their own** connection as a fallback source.
- If the manager leaves, the role passes to the longest-standing member (`account_access.joined_at`).
- **Primary and fallback sources**: one connection is primary. Others take over when its consent lapses and fill gaps, deduplicated on the dedupe key ([transaction](transaction.md)).
- **Contribution**: required monthly contribution = projected shared expenses − shared income other than member contributions. The split is a fixed percentage, default equal. A partner's contribution arrives as income from an IBAN you can't see behind; a rule on the shared account labels it as a contribution. Saldo never uses the other member's personal accounts to find it (privacy, analysis 5.2): each member confirms "dit is mijn bijdrage" from their own side, which creates that rule. The split is stored per member (`account_access.contribution_share`).

## In the design
- Start, section "Gedeelde rekeningen": subtitle "Met Partner · jij bent beheerder", stacked avatars B and P, violet soft card (`--sharedSoft`, border `--sharedChip`), row "Bijdragen november" with chips "Jij € 450 ✓" and "Partner € 450 ✓".
- The account detail (mockup `rekening.html`) shows Synchronisatie (primary and fallback links), Leden (permissions, contribution split, leave, hand-over) and the read-only state.
- "Iemand sluit aan" email: the new member gets "Lid · mag bewerken" and sees the shared account's history, never your personal accounts.
- The shared account's buffer applies to all members ("Geldt voor jou en Partner").
- The hero in Gedeeld scope uses `--sharedHero` and shows the contribution row.

## Related
[account](account.md) · [user-and-visibility](user-and-visibility.md) · [internal-transfer](internal-transfer.md) · [notification](notification.md)
