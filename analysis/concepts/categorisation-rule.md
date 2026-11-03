# Rule and learning (categorisation)

Analysis: 4.2, risk 9 · Data: `rule` · Screens: [transacties](../screens/transacties.md), [categorieen](../screens/categorieen.md) · Phases: [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-6](../../plan/v0.1-mockup/06-missing-designs.md), [0.4-2](../../plan/v0.4-categorisation/02-rules-engine.md), [0.4-3](../../plan/v0.4-categorisation/03-categorise-in-transacties.md), [0.4-4](../../plan/v0.4-categorisation/04-categories-and-rules-screen.md), [0.5-5](../../plan/v0.5-shared-accounts/05-contributions.md), [0.8-3](../../plan/v0.8-notifications/03-triggers-and-scheduler.md), [0.9-5](../../plan/v0.9-bilance-import/05-learning-and-backfill.md)

## Rules
- A rule matches on counterparty name or IBAN, communication (regex) and amount range, with a priority.
- Owner: an **account** (shared by members with edit access) or a **user** (applies to that user's personal accounts only).
- **Precedence**: manual choice > highest-priority matching rule > learned suggestion. Re-running rules **never overwrites a manual choice**.
- **Learning**: map a counterparty to its most frequent category, with a confidence level. Low confidence is shown for confirmation, never applied silently.
- Manual override offers "apply to similar transactions and create a rule".
- Learning improves after the Bilance import (0.9), so early on rules carry the load.

## In the design
- Start alert (green): tag icon, "8 transacties te categoriseren", links to Transacties filtered on "Niet gecategoriseerd". Desktop sidebar shows a count badge "8" on Transacties.
- Meer: "Categorieën en regels · 3 suggesties om te bevestigen".
- Notification type "Te categoriseren": at most once a day at 19:00.
- Transacties detail: checkbox "Toepassen op vergelijkbare en regel maken" with "Ook N andere transacties van X krijgen deze categorie." (or "Nieuwe transacties van X krijgen deze categorie."), unchecked each time; toast "Regel gemaakt · N andere bijgewerkt". The "Niet gecategoriseerd" filter chip carries the count.
