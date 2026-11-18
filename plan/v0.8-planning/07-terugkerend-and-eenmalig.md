# 0.8-7 · Planning: Terugkerend and Eenmalig tabs, item forms

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | released (0.8.0), verifying |
| Size | M |
| Features | PLAN-1, PLAN-3, PLAN-6 |
| Concepts | [recurring-item](../../analysis/concepts/recurring-item.md), [planned-item](../../analysis/concepts/planned-item.md), [shared-account](../../analysis/concepts/shared-account.md) |
| Screens | [planning](../../analysis/screens/planning.md) |
| Depends on | [0.8-5](05-planning-kalender.md) (page shell), [0.8-1](01-planning-data.md) (routes), [0.8-2](02-recurring-detection.md) (suggestions) |

## Goal
Confirm, ignore, add, edit and remove recurring items; list, edit and remove one-off items. The mockup shows the lists and the Bevestigen/Negeren buttons but no form: the form is designed here with the app's existing `Sheet`, `Select` and field styles.

## Terugkerend tab
- **Te bevestigen · N** (`GET /api/planning/suggestions?scope=`): `--warnSoft` cards with the name, the account pill, the rhythm ("Maandelijks · rond de 23e · 12 keer gezien", "Elk kwartaal · rond de 27e · 4 keer gezien", "Jaarlijks · 15 januari · 2 keer gezien"), the amount, and Bevestigen / Negeren (not shown on an account where the viewer has Lezen). **Bevestigen opens the item form prefilled** (as `analysis/concepts/recurring-item.md` says; the mockup confirms in one tap); saving stores a confirmed item, toast "Toegevoegd aan terugkerende posten". **Negeren** stores an ignored item at once, toast "Genegeerd" with the action "Ongedaan maken" (deletes it). Phone hides the section when empty, desktop shows "Alles bevestigd.".
- **Bevestigd** (`GET /api/planning/items?scope=`, state confirmed): rows with description, account pill, rhythm ("Maandelijks · 1e", "Jaarlijks · januari", "tot juni 2027" when there is an end date, "· gespaard" for kind saving, "· overschrijving" for kind transfer, "· bijdrage" for kind contribution) and the signed amount (`--neg` for expenses). An item in the answer's `missed` (0.8-3 rule 5b) gets a `--warnSoft` note under its row: "Verwacht op 8 november, niet gezien · telt niet meer mee" (it goes away by itself when the payment arrives or the next date passes; deleting the item clears it; changing its day or counterparty recomputes it). Both halves of the contribution are listed, each on its own account, in every scope (decision 9). A row opens the form for edit (Bewerken) or is inert (Lezen).
- **Genegeerd · N**: a collapsed list (closed by default) of ignored items with "Toch tonen" (deletes the ignored item, the suggestion comes back). Not in the mockup; small and needed, because Negeren is otherwise final.
- "+ Terugkerende post toevoegen" (dashed button, any account the viewer may edit).
- **Item form** (`Sheet`, title "Terugkerende post" / "Nieuwe terugkerende post"): Naam; Rekening (Alles: the editable accounts; otherwise fixed); Soort (segmented: Uitgave · Inkomst · Sparen · Overschrijving on a personal account; Uitgave · Inkomst · Bijdrage · Sparen on a shared account, where Bijdrage is a member's monthly payment and Overschrijving is not offered, 0.8-1); Bedrag (€, positive in the field, the sign from Soort; Overschrijving gets "Komt binnen" / "Gaat eruit"); "Bedrag" rule (Vast · Gemiddelde van de laatste maanden); Hoe vaak (Maandelijks · Elk kwartaal · Jaarlijks); Dag (1–31; help "Valt de dag niet in de maand, dan rekent Saldo met de laatste dag."); Maand (for quarterly "Eerste maand", for yearly "Maand"); Tegenpartij (optional, "Zoals op je rekeninguittreksel, zodat Saldo de betaling herkent"; prefilled from a suggestion); Einddatum (optional). Opslaan, Verwijderen (edit only, with a confirmation "Terugkerende post verwijderen?"). Errors from the API under the fields.

## Eenmalig tab
- `GET /api/planning/planned?scope=`: rows with a month chip (40 / 44 px, "DEC 2026"; `--warnSoft` for every planned item: the mockup's per-item pastel chips came from hand-picked demo colours and there is no category to take a colour from), description, account pill, note "Gepland op 20 december" / "Verwacht op 20 augustus 2027", the signed amount (`--neg` / `--greenText`). Rows dated before today in the running month are muted ("Voorbij"). Empty: "Nog geen eenmalige posten voor deze rekeningen."
- A row opens a small edit `Sheet` (Omschrijving, Bedrag with Uitgave/Inkomst, Datum, Rekening fixed) with Opslaan and Verwijderen (Bewerken only).
- The dashed button "Eenmalige uitgave of inkomst toevoegen via de kalender" opens `#kalender` on the running month.

## Steps
1. **Sonnet**: Terugkerend (suggestions, confirmed list, ignored list, item form) with vitest.
2. **Sonnet**: Eenmalig (list, edit sheet) with vitest.

## Tests (vitest, demo answers as fixtures)
- Terugkerend alles (Bert): "Te bevestigen · 2" with Decathlon ("Elk kwartaal · rond de 27e · 4 keer gezien", −€ 42,90, Zichtrekening) and Action ("Maandelijks · rond de 23e · 12 keer gezien", −€ 62,47, Gedeeld); Bevestigd lists the 11 seed items, "Familiale verzekering" "Jaarlijks · januari", "Naar spaarrekening" "· gespaard"; Bevestigen on Action opens the form with Tegenpartij "Action", Maandelijks, dag 23, −62,47, Gemiddelde; Negeren posts `state: "ignored"` and "Ongedaan maken" deletes it; the form's validation messages; Lezen on the shared account hides the buttons and makes rows inert.
- Eenmalig: four rows in date order (Kerstcadeaus, Autoherstelling, Zomervakantie, Belastingteruggave) with the right chips and notes; the edit sheet's PATCH and DELETE; the dashed button opens the Kalender.

## Who builds it
- **Sonnet**: steps 1 and 2 from this file.

## Done when
Every recurring and one-off item of the demo can be confirmed, ignored and brought back, added, edited and removed from Planning, with the forecast following after each change.
