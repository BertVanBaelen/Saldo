# Start

Analysis: 12 (screen 2), 4.5, 4.1 · Design: Telefoon-Start, Desktop-Start, Saldo-Start · Mockup: `finance-mockup/index.html` · Concepts: [scope](../concepts/scope.md), [account](../concepts/account.md), [buffer-and-states](../concepts/buffer-and-states.md), [forecast](../concepts/forecast.md), [category](../concepts/category.md), [shared-account](../concepts/shared-account.md), [bank-connection](../concepts/bank-connection.md) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.3-2](../../plan/v0.3-bank-sync/02-consent-reminders.md), [0.3-5](../../plan/v0.3-bank-sync/05-start-balances.md), [0.4-3](../../plan/v0.4-categorisation/03-categorise-in-transacties.md), [0.6-4](../../plan/v0.6-shared-accounts/04-scope-and-sums.md), [0.6-5](../../plan/v0.6-shared-accounts/05-contributions.md), [0.7-3](../../plan/v0.7-overview/03-start-spending.md), [0.8-6](../../plan/v0.8-planning/06-planning-screen.md)

## Content
- Scope switch Alles · Persoonlijk · Gedeeld (a filter only; see [scope](../concepts/scope.md)).
- Alerts: sync problems, planning warnings per account, consent expiring, transactions to categorise.
- **Saldo nu**: one account → its balance against its own buffer; several accounts → the sum as information plus one tile per account.
- **Komende maanden**: one forecast chart per current account. **Uitgaven november**: one block per account.
- Accounts split into Persoonlijke rekeningen and Gedeelde rekeningen, with members and contributions. Sync button with progress.

## Design notes
From Telefoon-Start and Desktop-Start, with the decisions of 3 Nov 2026 applied (every current account is judged on its own; sums are information only). Mockup: `finance-mockup/index.html`, `js/screens/start.js`, `css/screens/start.css`.

### Layout
- **Phone** (< 1024 px), top to bottom: header "Start" (26/600) with the sync button and the avatar (→ Meer); scope switch (full width, with icons); alerts; hero "Saldo nu"; "Komende maanden" (section head with a "Planning" link, then the chart card); "Uitgaven november"; Persoonlijke rekeningen; Gedeelde rekeningen. Gap 14.
- **Desktop** (≥ 1024 px): header row = title with the date under it ("Woensdag 18 november"), scope switch and sync button on the right. Alerts in a 2-column grid. Then a 2-column grid (gap 18, equal height): hero left, forecast card right (title inside the card, radius 24). Below an auto-fit grid (min 280 px): Uitgaven · Persoonlijk · Gedeeld (section titles shorten to "Persoonlijk" / "Gedeeld").
- Scope filters what is shown: Persoonlijk = accounts with one member, Gedeeld = accounts with more than one member. Every block loops over the accounts in the scope, so several personal or several shared accounts each get their own tile, chart, spending block and card. A scope without accounts of its kind shows a card "Nog geen persoonlijke / gedeelde rekening" with "Bank koppelen".

### Alerts (order)
1. Sync failed (state `fout`, red): "Synchronisatie mislukt · Argenta antwoordt niet" / "Laatste poging vandaag 04:02 · stand van gisteren" → `bankkoppelingen.html`.
2. Stale account (state `verouderd`, warn, sync icon), only when that account is in the scope: "Gedeelde rekening niet bijgewerkt sinds zondag 04:02" / "Argenta stuurde geen nieuwe gegevens · bekijk de koppeling" → `bankkoppelingen.html`.
3. Planning, per current account from its own forecast against its own buffer: red "Zichtrekening staat rood in februari" / "Verwacht eindsaldo −€ 1.033 · bekijk de planning"; warn "Zichtrekening zakt in de buffer in januari" / "Verwacht € 722, € 179 onder de buffer van € 900". Titles use the account name (renames from Rekeningen apply). → `planning.html`.
4. Consent (warn, clock): "Toestemming verloopt over 12 dagen" / "Argenta · opnieuw autoriseren" → `bankkoppelingen.html#opnieuw`.
5. "4 transacties te categoriseren" (green, tag) → `transacties.html?filter=niet-gecategoriseerd`.
Alerts with a target outside Planning show a chevron on the phone; desktop hides chevrons.

### Hero "Saldo nu" (links to Planning)
- The big number is always the actual balance now, never a forecast.
- **One account in the scope**: label "Saldo nu · Zichtrekening" (the account name as the user wrote it), state chip on the right: "Boven buffer", "In de buffer" or "Rood" (`chip--hero`). Amount Mono 46 / 50. Bar against the buffer (fill `--heroAccent`, white 2 px marker at the buffer, scale = max(balance, buffer) × 1.3) with "Buffer € 900,00" / "€ 1.068,82 boven buffer". Shared accounts use the violet hero and add "Bijdragen november" (Jij € 450 ✓, Partner € 450 ✓; wraps under the label on narrow phones).
- **Several accounts** (Alles, or a scope with more than one account): label "Saldo nu · alle rekeningen" ("persoonlijke rekeningen" / "gedeelde rekeningen" in a filtered scope), the total € 2.914,90 and under it "Samen, ter info · zonder spaarrekeningen" (13, hero sub colour). No chip on the total. Below a divider (1 px white 22 %): "Per rekening" with a chip about the **accounts**: "Alle rekeningen boven buffer" (check icon) or "1 rekening vraagt aandacht" / "2 rekeningen vragen aandacht" (warning icon) when any current account is in its buffer or red now. Then one tile per current account (2 columns, radius 12, white 14 %): an 18 px badge in the account colour with the account icon (ringed 1.5 px white so a green account stays visible on the green hero), the name (ellipsis), the balance (Mono 15) and its own distance to its own buffer: "€ 1.069 boven buffer"; under the buffer a warn pill "€ 54 onder buffer" (`--warnChip` / `--warn`), below zero a red pill "Rood" (`--negSoft` / `--negText`). Desktop pushes the tiles to the bottom of the hero.
- Stale or failed account: a line under the amount with a clock icon, "Stand van zondag 04:02" (state `verouderd`) or "Stand van gisteren 04:02" (state `fout`).

### Komende maanden
One bar chart per current account (see [forecast](../concepts/forecast.md#in-the-design-komende-maanden-on-start)); the title dot and the positive bars use the account colour (`--a-<color>`), negative bars `--neg`. Height 84 px when several accounts are shown, 124 px for one. Sub "Verwacht eindsaldo per rekening". Legend Boven buffer · Onder buffer · Rood: negatief saldo.

### Uitgaven november
- One account: stacked share bar and category rows, the total right in the section head (Mono, muted).
- Several accounts: the section head shows "samen € 1.852,37" (aria-label "Samen € 1.852,37, ter info"); the card holds one block per account: head with a 10 px square in the account colour, the account name (14/600) and its own total (Mono 13 muted), then its share bar and rows. Blocks are separated by a line. Demo: Zichtrekening € 1.251,59 (Wonen, Vrije tijd, Vervoer, Abonnementen), Gedeelde rekening € 600,78 (Boodschappen, Wonen, Abonnementen).

### Accounts
- **Persoonlijke rekeningen** ("Alleen jij ziet deze rekeningen"): list card with every personal account: 36 / 34 px icon in the account colour, name, subline, balance. Sublines: "Argenta · vandaag 04:02" for synced accounts, "Handmatig · bijgewerkt 2 okt" for manual savings.
- **Gedeelde rekeningen**: one violet card per shared account (`--sharedSoft`, border `--sharedChip`): white row with icon, name, sync subline and balance; then contributions ("Bijdragen november" in `--sharedText`, chips on `--surface`). Head subline with one shared account: "Met Partner · jij bent beheerder" and the member avatars; with several: "N rekeningen met meer leden".

### States (demo state from Meer → Mockup or `?demo=`)
- **leeg** (no bank linked yet): no figures, no scope switch, no sync button. A green welcome card (hero style): the app logo (48, ringed), "Welkom bij Saldo" (26 / 30, 600), "Koppel je bank. Dan zie je hier hoeveel er op elke rekening staat, of je de komende maanden toekomt en waar je geld naartoe gaat.", and three promises with icons (Saldo nu en je buffer, per rekening · Komende maanden: kom je toe? · Waar je geld naartoe gaat). Then "Aan de slag in drie stappen" ("0 van 3 klaar") as an ordered list card: 1 **Enable Banking instellen** ("Je eigen application id en sleutel · eenmalig") → `instellingen.html#bank`; 2 **Bank koppelen** ("Kies Argenta en geef toestemming in je bankapp") → `bankkoppelingen.html#nieuw`; 3 **Geschiedenis importeren** ("Optioneel · een CSV-bestand, bv. de export uit Bilance") → `importeren.html`. Step numbers in 32 px circles; the next step is filled `--green`. A violet note: "Partner koppelt haar eigen rekeningen" / "Iedereen koppelt zijn eigen bank met een eigen login. Een gedeelde rekening die jullie allebei koppelen, zien jullie allebei onder Gedeeld." Desktop: welcome card and steps side by side (two equal columns).
- **verouderd**: the shared account was last updated Sunday 15 November 04:02. Warn alert (above), its subline "Argenta · laatst 3 dagen geleden" in `--warn`, and the "Stand van zondag 04:02" line in its hero. A successful sync clears all three.
- **fout**: red alert (above); every synced subline reads "Argenta · synchronisatie mislukt" in `--negText`; heroes show "Stand van gisteren 04:02". The sync button runs (spinner, progress bar) and ends with the toast "Mislukt · Argenta antwoordt niet". The desktop sidebar shows a red dot at Bankkoppelingen (shell).
- **lezen** (Partner manages the shared account, Bert has Lezen): the shared card shows a chip "Alleen lezen" (lock icon, `chip--readonly` on `--surface`) with "Partner beheert deze rekening. Je ziet alles, maar wijzigt niets."; the head subline reads "Met Partner · Partner is beheerder". Start has no edit controls, so nothing else changes.
- **offline**: the shell shows the offline banner. The sync button stays focusable but is dimmed (`aria-disabled`, 45 %); pressing it shows the toast "Offline · synchroniseren kan niet". Figures stay visible.

### Interactions
- Sync: spinner in the button, 3 px progress bar 1.6 s, then the toast "Bijgewerkt · 2 nieuwe transacties" and sublines "Argenta · zojuist" (exceptions per state above).
- Hero and chart link to Planning, the spending card to Overzicht. Switching scope re-runs the entry animation (sFade header, sIn sections staggered 30–160 ms).

### Mockup deep links
`index.html?scope=alles|persoonlijk|gedeeld` and `?demo=normaal|leeg|verouderd|fout|lezen|offline`, for example `index.html?demo=lezen&scope=gedeeld`.