# Planned one-off item

Analysis: 4.5 (3), 5.3 · Data: `planned_item` · Screens: [planning](../screens/planning.md) (Kalender, Eenmalig, Budget) · Phases: [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.7-3](../../plan/v0.7-planning/03-planned-items.md)

## Rules
- An expected **expense or income** on a chosen day, with description, signed amount and the account it lands on. In Alles you choose the account; in Persoonlijk or Gedeeld it is fixed.
- Planned from the calendar. The form previews that account's **end-of-day balance** before saving.
- Shows in the calendar, the "Eenmalig" list, the month budget and the forecast. Can be removed.

## Data
`planned_item`: account, created by, date, amount (signed cents), description.

## Demo items
- Autoherstelling −€ 2.000 in February 2027 → personal goes to −€ 1.033.
- Verwachte belastingteruggave +€ 680 in August 2027.

- Autoherstelling is planned on 10 February. Zomervakantie −€ 1.500 in July 2027 is also in the Planning board's demo.

## Form copy (Planning board)
"Geplande uitgave op …" / "Verwachte inkomst op …", "Omschrijving", "Bedrag", "Betalen met" / "Ontvangen op", preview "Saldo einde dag wordt … · onder je buffer", error "Vul een omschrijving en een bedrag in.", toast "Gepland op 25 nov · −€ 1.500,00".

## Dutch labels
"Gepland", "Verwachte inkomst", "Eenmalige uitgave", "Eenmalig".
