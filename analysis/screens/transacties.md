# Transacties

Analysis: 12 (screen 3), 4.2, 4.3 · Design: Telefoon-Transacties, Desktop-Transacties · Mockup: `finance-mockup/transacties.html` · Concepts: [transaction](../concepts/transaction.md), [category](../concepts/category.md), [categorisation-rule](../concepts/categorisation-rule.md), [internal-transfer](../concepts/internal-transfer.md), [scope](../concepts/scope.md), [shared-account](../concepts/shared-account.md) · Phases: [0.1-2](../../plan/v0.1-mockup/02-transacties-and-overzicht.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.2-6](../../plan/v0.2-foundation/06-first-bank-link.md), [0.3-3](../../plan/v0.3-bank-sync/03-transacties.md), [0.4-3](../../plan/v0.4-categorisation/03-categorise-in-transacties.md), [0.6-3](../../plan/v0.6-shared-accounts/03-transfers-and-saved.md), [0.6-4](../../plan/v0.6-shared-accounts/04-scope-and-sums.md)

## Content
- List grouped by day, an account label on every row.
- Search and filter chips: account, category, period, "Niet gecategoriseerd".
- Detail sheet: category picker, "apply to similar and create a rule", split, mark as transfer, note. Edit controls hidden for read-only members.

## Design status
List, labels and category sheet are designed. Split, transfer, note and rule are to design (0.1-6).

## Design notes
From Telefoon-Transacties and Desktop-Transacties. Mockup: `finance-mockup/transacties.html`, `js/screens/transacties.js`, `css/screens/transacties.css`.

### Layout
- **Phone** (< 1024 px), top to bottom: title "Transacties" (26/600) with the avatar "B" → Meer; search field; scope switch (full width, with icons); a horizontally scrolling chip row; day groups; "Oudere transacties laden" (full-width button). No sync button.
- **Desktop** (≥ 1024 px): the page fills the viewport height. A fixed header (padding 24 32 16, bottom border): title (28/600) left, search (360 px) right; second row: a **compact scope switch** (30 px buttons, 13/600, no icons, radius 9 in a 12 px frame) followed by the chips. Below, the list scrolls on its own (padding 16 24 24 32) next to a **380 px detail panel** (surface, left border) that is always open; it starts on Colruyt Laagste Prijzen.

### Search and chips
- Search placeholder "Zoek op naam, bedrag of mededeling", aria-label "Zoeken in transacties", 44 px, search icon inside.
- Chips (36 px pills, 1 px `--line`, padding 0 12): **"Niet gecategoriseerd"** (600, count pill `--soft`/`--greenText`; pressed: green fill, count pill `--onGreen`/`--green`), "Alle rekeningen ▾", "November ▾" (desktop "November 2026 ▾"), "Categorie ▾". Only the first one does something on the boards; the dropdowns are not designed yet.
- The count is the demo "8 te categoriseren" minus the rows you categorised in this session; the desktop sidebar badge follows it.
- `?filter=niet-gecategoriseerd` (from the Start alert) opens with the chip pressed. While it is on, "Oudere transacties laden" is hidden.

### List
- Day groups, newest first, heading "Vandaag · woensdag 18 november", "Gisteren · dinsdag 17 november", then "Maandag · 16 november" (14/600, the part after the dot 400 muted; desktop 13 px, indented 12).
- Phone row (card radius 20, padding 2 14, divider lines): 40 px avatar (initial on the category pastel; dashed muted "?" when uncategorised) · name 15/500 (ellipsis) over **account label** + category name · amount Mono 15/500 right, with the dashed "In behandeling" chip (11/600) under a pending amount.
- Desktop row (card radius 16, padding 4; rows radius 12, min 52 px; grid 36 px · 1fr · 140 px · 110 px): avatar · name (+ "In behandeling" chip next to it) over account label + account name ("Zichtrekening") · category chip (pastel; uncategorised: dashed muted "Niet gecategoriseerd") · amount. The selected row has `--soft` background and `aria-pressed="true"`.
- **Account label**: 11/600, padding 1×7, "Persoonlijk" (`--soft`/`--greenText`) or "Gedeeld" (`--sharedSoft`/`--sharedText`).
- Amount colour: expense `--neg`, income `--text` with "+", pending `--muted`, internal transfer `--text` (not an expense).
- Scope filters the rows: Persoonlijk = Zichtrekening, Gedeeld = Gedeelde rekening.
- "Oudere transacties laden": 44 px, surface, `--greenText` 15/600 (desktop centred). Shows a shimmer skeleton for 0.8 s (phone: two avatar rows; desktop: two bars; colours `--skel`/`--skel2`), then adds Vrijdag 13 and Donderdag 12 november.

### Detail (phone bottom sheet "Transactie bewerken" · desktop side panel)
- Head: 44 px avatar, name 17/600, account label + account name; phone adds a round 44 px close button (`--bg`).
- Amount Mono 36 (desktop 34) in the row colour, status pill "Geboekt" / "In behandeling" (`--bg`, muted 13/600).
- Facts (96 px label column, 14 px): "Datum" ("woensdag 18 november 2026"), "Mededeling", "Categorie" (600).
- Pending: muted note "Nog in behandeling. Telt mee in de totalen zodra de bank ze boekt."
- Internal transfer to savings: green note "Overschrijving naar je spaarrekening. Telt als gespaard, niet als uitgave." and **no** category picker.
- Otherwise "Kies een categorie": six pills Wonen, Boodschappen, Vrije tijd, Vervoer, Abonnementen, Overig (40 px, desktop 38; 2 px border in the pastel; selected: pastel fill, `--text` border, check icon). Picking applies at once to the row and the count.
- Checkbox "Toepassen op vergelijkbare en regel maken" with "Ook 14 andere transacties van Colruyt Laagste Prijzen krijgen deze categorie." (or "Nieuwe transacties van … krijgen deze categorie." when there are none). Unchecked each time a transaction is opened.
- Two outline buttons "Splitsen" and "Is een overschrijving" (not designed further; mockup shows a toast).
- "Notitie" field, placeholder "Bijvoorbeeld: verjaardagscadeau".
- "Opslaan" (48 px, radius 14, green). Toast "Opgeslagen", or "Regel gemaakt · 14 andere bijgewerkt" with the checkbox on. The phone sheet closes on save; the desktop panel stays.
- Phone sheet: radius 28 top, padding 10 20 30, slides up 300 ms, backdrop closes it. Desktop panel slides in from the right (14 px, 260 ms) when another row is chosen.

### Demo rows (18 Nov 2026)
| Day | Counterparty | Account | Amount | Category | Notes |
|---|---|---|---|---|---|
| 18 | Bol.com | Zicht | −€ 24,99 | – | pending, "Bestelling 4471-2210" |
| 18 | Colruyt Laagste Prijzen | Gedeeld | −€ 86,42 | Boodschappen | 14 similar |
| 17 | TotalEnergies | Zicht | −€ 62,10 | Vervoer | |
| 17 | Spotify | Zicht | −€ 11,99 | Abonnementen | |
| 17 | Bakkerij De Graankorrel | Zicht | −€ 8,40 | – | |
| 16 | Naar spaarrekening | Zicht | −€ 200,00 | Gespaard | internal transfer |
| 16 | CM Ziekenfonds | Zicht | +€ 18,50 | Terugbetaling | income |
| 16 | Delhaize | Gedeeld | −€ 54,37 | Boodschappen | |
| 15 | Kinepolis | Zicht | −€ 24,00 | Vrije tijd | |
| 15 | Frituur 't Pleintje | Zicht | −€ 14,50 | – | Payconiq |
| 14 | Decathlon | Zicht | −€ 42,90 | Vrije tijd | |
| 14 | NMBS | Zicht | −€ 19,60 | Vervoer | |
| 13 | Albert Heijn | Gedeeld | −€ 32,14 | Boodschappen | older |
| 13 | Apotheek Van Damme | Zicht | −€ 18,35 | – | older |
| 12 | Netflix | Zicht | −€ 13,99 | Abonnementen | older |
| 12 | Carrefour Express | Gedeeld | −€ 22,65 | Boodschappen | older |

### Mockup additions (not on the boards)
- Search filters live on name, communication, amount and category; an empty result shows "Geen transacties gevonden".
- The dropdown chips, "Splitsen" and "Is een overschrijving" show a toast "… wordt nog ontworpen".
- The note is kept per transaction for the session. Escape closes the sheet; crossing the breakpoint turns an open sheet into the side panel.

### Not designed yet (0.1-6)
Dropdown contents (account, period, category), split, mark as transfer / not a transfer, the rule editor, read-only member (no edit controls), empty list.
