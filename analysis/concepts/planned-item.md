# Planned one-off item

Analysis: 4.5 (3), 5.3 · Data: `planned_item` · Screens: [planning](../screens/planning.md) (Kalender, Eenmalig, Budget) · Phases: [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.8-1](../../plan/v0.8-planning/01-planning-data.md), [0.8-5](../../plan/v0.8-planning/05-planning-kalender.md), [0.8-7](../../plan/v0.8-planning/07-terugkerend-and-eenmalig.md), [0.8.1-9](../../plan/v0.8.1-improvements/09-one-off-without-day.md)

## Rules
- An expected **expense or income** on a chosen day, with description, signed amount and the account it lands on. In Alles you choose the account; in Persoonlijk or Gedeeld it is fixed.
- Planned from the calendar. The form previews that account's **end-of-day balance** before saving.
- Shows in the calendar, the "Eenmalig" list, the month budget and the forecast. Can be edited and removed.
- **Without a day** (0.8.1-9, decided 19 Nov 2026, user answer; the design's "Dag (leeg = ergens in de maand)"): the day may be left empty, then the item belongs to a month only and the forecast **spreads it over that month like variable spending** (the rule is in [forecast](forecast.md) and `docs/api.md` "Planning": later months every day, the running month the days after today, exact cents). It is never matched to a transaction, never late. In the app: the sheet's preview ends "· verdeeld over juli"; the Eenmalig row has the chip "JUL 2027" and the note "Ergens in juli 2027" (the board's "Juli 2027"); the Kalender marks none of its days (it is on every day), says "Zomervakantie −€ 1.500,00 · verdeeld over juli (ongeveer −€ 48,38 per dag)" above the grid and lists it on the day card as "Zomervakantie (verdeeld)" with the day's part; the Maanden breakdown names it like any planned item. **Known limit:** an item without a day that is paid during its month counts twice until the month ends (planned items are never matched): remove it once paid.

## Data
`planned_item`: account, created by, date, amount (signed cents), description. It belongs to the account: every member sees it, members with Bewerken change it. A plan dated today lands on tomorrow in the forecast (today's balance is the real one); planned items have no category (a planned saving shows as Eenmalig; decided 18 Nov 2026). 0.8.1-9: an item without a day is stored as the month's 1st with `whole_month = 1` (migration 0021) and answers `date: null`, `month`, `wholeMonth: true`.

## Demo items (seed of plan 0.8-1, Zichtrekening)
- Kerstcadeaus −€ 350 on 20 December 2026.
- Autoherstelling −€ 2.000 on 10 February 2027 → the Zichtrekening is red from that day.
- Zomervakantie −€ 1.500 on 15 July 2027.
- Belastingteruggave +€ 680 on 20 August 2027 (the mockup gives months only for the last two).

## Form copy (Planning board)
"Geplande uitgave op …" / "Verwachte inkomst op …", "Omschrijving", "Bedrag", "Betalen met" / "Ontvangen op", preview "Saldo einde dag wordt … · onder je buffer", error "Vul een omschrijving en een bedrag in.", toast "Gepland op 25 nov · −€ 1.500,00".

## Dutch labels
"Gepland", "Verwachte inkomst", "Eenmalige uitgave", "Eenmalig".
