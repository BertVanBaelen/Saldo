# Start

Analysis: 12 (screen 2), 4.5, 4.1 · Design: Telefoon-Start, Desktop-Start, Saldo-Start · Mockup: `finance-mockup/index.html` · Concepts: [account-group](../concepts/account-group.md), [account](../concepts/account.md), [buffer-and-states](../concepts/buffer-and-states.md), [forecast](../concepts/forecast.md), [category](../concepts/category.md), [shared-account](../concepts/shared-account.md), [bank-connection](../concepts/bank-connection.md) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-6](../../plan/v0.1-mockup/06-missing-designs.md), [0.3-4](../../plan/v0.3-bank-sync/04-consent-reminders.md), [0.3-6](../../plan/v0.3-bank-sync/06-transacties-and-rekeningen.md), [0.4-3](../../plan/v0.4-categorisation/03-categorise-in-transacties.md), [0.5-4](../../plan/v0.5-shared-accounts/04-account-groups-and-scope.md), [0.5-5](../../plan/v0.5-shared-accounts/05-contributions.md), [0.6-3](../../plan/v0.6-overview/03-start-live.md), [0.7-6](../../plan/v0.7-planning/06-planning-screen.md)

## Layout (top to bottom)
1. **Header**: "Start" (desktop: date under it), sync button, avatar (phone) → Meer.
2. **Scope switch** Alles · Persoonlijk · Gedeeld (phone: own row; desktop: in the header).
3. **Alerts**: planning red and warn per group (from the forecast), "Toestemming verloopt over 12 dagen", "8 transacties te categoriseren". Desktop: 2-column grid.
4. **Hero "Saldo nu"** (links to Planning). The big number is the **actual balance now**, not a forecast.
   - Alles: "Saldo nu · alle rekeningen", total € 2.914,90, chip "Boven buffer" or "Let op", two tiles (Persoonlijk / Gedeelde rekening) with balance and "€ 1.069 boven buffer".
   - One group: "Saldo nu · zichtrekening" or "· gedeelde rekening", chip state, a bar against the buffer (fill #FFD59E, white marker at the buffer), "Buffer € 900,00" / "€ 1.068,82 boven buffer". Gedeeld uses the violet hero and shows "Bijdragen november".
5. **Komende maanden**: one bar chart per group with zero and buffer lines (see [forecast](../concepts/forecast.md)). Desktop: next to the hero in a 2-column grid.
6. **Uitgaven november**: stacked share bar + category rows; in Alles the split Persoonlijk € 1.251,59 / Gedeeld € 600,78.
7. **Persoonlijke rekeningen** ("Alleen jij ziet deze rekeningen"): Zichtrekening, Spaarrekening, Reserve.
8. **Gedeelde rekeningen** ("Met Partner · jij bent beheerder"): violet card with balance and contributions.

Sections 7 and 8 follow the scope. Switching scope re-runs the entry animation.

## Interactions
- Sync: spinner, top progress bar 1.6 s, then toast "Bijgewerkt · 2 nieuwe transacties" and subtitles "Argenta · zojuist".
- Hero, chart and spending cards are links to Planning / Overzicht.

## States to mock
Done in design: first sync running, consent expiring. To do (0.1-6): empty (no accounts), stale sync, sync error, read-only member.
