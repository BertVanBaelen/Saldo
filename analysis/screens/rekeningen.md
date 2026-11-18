# Rekeningen and account detail

Analysis: 12 (screen 6), 4.8, 6.3 · Design: Telefoon-Rekeningen, Desktop-Rekeningen · Mockup: `finance-mockup/rekeningen.html` · Concepts: [account](../concepts/account.md), [buffer-and-states](../concepts/buffer-and-states.md), [shared-account](../concepts/shared-account.md), [bank-connection](../concepts/bank-connection.md) · Phases: [0.1-4](../../plan/v0.1-mockup/04-rekeningen-meer-meldingen.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.2-6](../../plan/v0.2-foundation/06-first-bank-link.md), [0.3-2](../../plan/v0.3-bank-sync/02-consent-reminders.md), [0.3-4](../../plan/v0.3-bank-sync/04-rekeningen-and-manual-accounts.md), [0.6-1](../../plan/v0.6-shared-accounts/01-membership-and-lifecycle.md), [0.6-5](../../plan/v0.6-shared-accounts/05-contributions.md)

## Content
- Accounts grouped Persoonlijk and Gedeeld with balance.
- Per account: name, colour (8 choices) and minimum buffer (savings have none), with the total buffer per group.
- Detail (to design): balance history, transactions, **Synchronisatie** (sources, last sync, consent expiry, re-authorise), **Leden** (members with Lezen or Bewerken), manual balance update for savings.

## Design notes
Source: Telefoon-Rekeningen, Desktop-Rekeningen. Mockup: `finance-mockup/rekeningen.html`, `js/screens/rekeningen.js`, `css/screens/rekeningen.css`.

### Account colours (8)
A palette separate from the category pastels (`--a-*` on the boards; defined in `css/screens/rekeningen.css` for now). Icons on an account colour use `--onAcc` (#FFFFFF light, #0E1311 dark).

| Key | Label | Light | Dark |
|---|---|---|---|
| green | Groen | #15803D | #4ADE80 |
| violet | Violet | #5B3FD9 | #9C86FF |
| blue | Blauw | #1D6FD1 | #6FB1FF |
| teal | Petrol | #0F7A7A | #4FD1C5 |
| orange | Oranje | #C2570C | #FB923C |
| pink | Roze | #C0267A | #F472B6 |
| yellow | Oker | #A16207 | #FACC15 |
| gray | Grijs | #4B5563 | #9CA3AF |

Demo: Zichtrekening green, Spaarrekening orange, Reserve yellow, Gedeelde rekening violet.

### Phone (< 1024 px)
- Header: back chevron (22, stroke 2.4) to Meer, title "Rekeningen" 26/600. The tab bar shows Meer as active.
- Card **Buffer per rekening** (padding 14 16): title 15/600, sub "Elke rekening heeft een eigen buffer in de planning" 12 muted, total on the right in Mono 18/600 (`€ 1.500,00`). Stacked bar 10 px (gap 2, radius 5) with one segment per current account in its colour, width by share. Legend: 10 px square r3, name, amount in Mono muted (`Zichtrekening € 900,00`, `Gedeelde rekening € 600,00`).
- Groups: label "PERSOONLIJK" + "· alleen jij ziet ze", "GEDEELD" + "· met Partner" (12 muted).
- List card padding 0 14. Each row is a button, min-height 66: a 40 px circle in the account colour with the account icon (card, coins, people; 19 px), name 15/500, subline 12 muted, buffer line 12/600 ("Buffer € 900,00" in text colour, "Telt niet mee in de planning" muted for savings). The right column has the balance in Mono 15/500 over a 16 px chevron.
- Sublines: "Argenta · gesynchroniseerd vandaag 04:02", "Handmatig · bijgewerkt 2 okt", "Argenta · met Partner · jij bent beheerder".
- Dashed button "+ Rekening toevoegen" (48 px, radius 14) at the end. It has no target yet.
- Tapping a row opens a bottom sheet "Rekening instellen" (radius 28 top, grip, padding 10 20 30, gap 18):
  - Head: 48 px colour circle with a 22 px icon, name 17/600 (follows the name field live), subline 13 muted, round 44 px close button on `--bg`.
  - **Naam** (label 14/600): input.
  - **Kleur**: radiogroup of 8 swatches, 40 px circles. The selected one has a 3 px `--text` ring and a check; all have an inset 2 px surface ring. Help: "Deze kleur zie je overal bij deze rekening: in lijsten, grafieken en labels."
  - **Minimumbuffer** (current accounts only): − / + buttons 44 px (step € 50, aria "€ 50 minder" / "€ 50 meer") around an input with a € prefix, Mono 16/500, centred, whole euros. Help: "Komt deze rekening onder dit bedrag, dan kleurt de planning geel. Onder € 0 wordt ze rood." For the shared account it starts "Komt de gedeelde rekening …" and adds "Geldt voor jou en Partner."
  - Savings get a note on `--bg` instead: "Spaarrekeningen tellen niet mee als beschikbaar geld in je planning. Daarom hebben ze geen buffer."
  - **Voorbeeld** strip on `--bg`: account label pill (16 px colour dot + name) and `−€ 86,42` in `--neg`.
  - Buttons Annuleren (ghost) · Opslaan (green), 48 px, radius 14. Saving shows the toast "<naam> opgeslagen". An empty name keeps the old name.

### Desktop (≥ 1024 px)
- Header: "Rekeningen" 28/600, sub "Naam, kleur en buffer per rekening", primary button "+ Rekening toevoegen" (44 px, 14/600) on the right.
- Two columns: the list (`1fr`) and a settings panel (`400px`), gap 18. The panel always shows the selected account (default Zichtrekening) with the same form as the phone sheet, minus the close button. Its buttons are **Herstellen** (disabled at 50 % until something changes; resets the draft) and **Opslaan**. A new selection fades the panel in.
- Buffer card: padding 16 18, title 16, sub 13, total 20.
- List card padding 6. Rows are `aria-pressed` buttons in a grid 40 · 1fr · 150 (buffer, 13/600) · 120 (balance) · 16 (chevron), min-height 64, radius 14. The selected row has a 2 px `--text` border and a `--bg` fill. Name 15/600, subline cut off with an ellipsis.
- Derived: from 1024 to 1279 px the panel is 360 px and the buffer text moves under the subline (no 150 px column), so the rows fit.

### Mockup behaviour
Edits (name, colour, buffer) are kept per viewer in `localStorage` (`saldo.rekeningen`). They do not feed Start or Planning yet. Escape or a tap on the backdrop closes the sheet. Arrow keys move through the colour radiogroup.

## Declared shared and invitations (0.8-0b)
Plan [0.8-0b](../../plan/v0.8-planning/00b-shared-flag-and-invitations.md); code `web/src/pages/RekeningUitnodigen.tsx`. The server decides every rule; the web shows its answers and refusals.
- **Rekening, card "Delen"** (below Instellen; the account's manager with Bewerken only; members and read-only members see the state in the head chip "Gedeeld · met Partner", never the card). Row: label "Dit is een gedeelde rekening", help "Zet je deze rekening op gedeeld, dan telt ze mee onder Gedeeld en kan je anderen uitnodigen. Wie je uitnodigt, ziet haar saldo en geschiedenis, nooit je andere rekeningen." and a `role="switch"` (44 px target). It saves at once (`PATCH {"shared": true}`) and then opens the invite sheet; if the sheet is closed unused, "Mensen uitnodigen" opens it again. With open invitations a line "Uitgenodigd: Partner. Trek eerst de uitnodiging in om dit uit te zetten." explains why switching off is refused; the server's refusal ("Trek eerst de uitnodiging in.", "Een rekening met meer leden blijft gedeeld.") shows as an alert line under the switch. With more than one member the label is "Gedeeld met Partner" and there is no switch (not editable); "Mensen uitnodigen" stays for a further person.
- **Rekeningen editor** (sheet on the phone, panel on desktop): for a current account the viewer manages, a row "Gedeelde rekening" under the buffer shows the state ("Persoonlijk", "Gedeeld met Partner", "Gedeeld · nog met niemand") and a button "Delen instellen" (personal) or "Delen beheren" (shared). It plays the sheet's exit, then opens `/rekeningen/<id>#delen`: the account page scrolls to the Delen card and focuses its first control. The invite sheet is never opened inside the editor. No row for savings accounts or for members; they use the account page.
- **Invite sheet "Wie nodig je uit?"** (`Sheet`, bottom sheet on the phone, dialog on desktop): one row per other user of the instance from `GET /api/accounts/{id}/invitable`, by name: initial in a circle and name. A free person is a toggle (`aria-pressed`, one at a time); a member shows "lid"; an invited person shows "uitgenodigd" and "Intrekken" (focus stays in the sheet afterwards). Primary "Uitnodigen" (disabled until one is picked) toasts "Partner is uitgenodigd", closes the sheet and loads the accounts again. Under the list: "Staat de persoon er niet bij? Een beheerder van Saldo nodigt nieuwe mensen uit in Instellingen → Gebruikers." (a link for an admin; no list and no button when nobody else is on this Saldo).
- **Rekeningen**: an account its manager declared shared is under "Gedeeld", note "nog met niemand" until someone joins; the manager's open invitations show as a line "Uitgenodigd: Partner" under the account (phone rows and desktop rows).
- **The invitee**: the `invite` alert on Start leads to `/rekeningen?uitnodiging=7`, which opens the dialog "Bert nodigt je uit voor Vakantiepot" (the alert's title, nothing else of the account) with "Als je ze toevoegt, zie je haar saldo en geschiedenis, en zien de andere leden wat je op deze rekening doet. Je persoonlijke rekeningen blijven van jou." and the buttons "Niet nu" and "Toevoegen". Toevoegen makes them a member at once (Bewerken), toasts "Je bent nu lid van Vakantiepot" and loads the accounts and alerts again; Niet nu declines. Closing the dialog decides nothing. A link to an invitation that is gone toasts "Deze uitnodiging bestaat niet meer.". The dialog also opens for a user without accounts.
- **Bankkoppelingen**: linking an IBAN the user was invited to joins at once (`joined` in the callback): no "Wil je aansluiten?" dialog, a toast and the line "Je bent nu lid van …".
