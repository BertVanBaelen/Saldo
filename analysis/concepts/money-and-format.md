# Money, dates and formatting

Analysis: 4.7, 5.1, 14 · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.2-2](../../plan/v0.2-foundation/02-repository-addon-ci.md), [0.2-3](../../plan/v0.2-foundation/03-web-app-shell.md)

## Rules
- Amounts are **integer cents** (`int64`) with currency EUR, everywhere, also in JSON. Never floats.
- Dates: bank booking date and value date. "Month" = calendar month in Europe/Brussels.
- Dutch (Belgium) formats: `€ 1.234,56`, thousands with `.`, decimals with `,`, a space after `€`.
- Negative amounts use the **minus sign U+2212** (`−€ 86,42`), positive income gets `+` (`+€ 2.850,00`) in lists.
- Short form without cents for charts and summaries: `€ 1.033`, `−€ 1.033`, `+€ 365`.
- Dates in lists: "vandaag", "2 nov", "Woensdag 18 november" (desktop page header).
- Amounts are set in Geist Mono with `font-variant-numeric: tabular-nums`.

## Reference implementation (from the design)
```js
eur(c, signed)  // € 1.968,82 · −€ 86,42 · +€ 2.850,00
eur0(c, signed) // € 1.969 · −€ 1.033 · +€ 365
```
Mockup: `finance-mockup/js/format.js`.

## Glossary
| English | Dutch label |
|---|---|
| Account, current account, savings account, shared account | Rekening, zichtrekening, spaarrekening, gedeelde rekening |
| Transaction, category, rule | Transactie, categorie, regel |
| Recurring item, one-off item, budget, buffer | Terugkerende post, eenmalige post, budget, buffer |
| Internal transfer, saved | Overschrijving tussen eigen rekeningen, gespaard |
| Left, short | Over, tekort |
| Bank link, consent, re-authorise | Bankkoppeling, toestemming, opnieuw autoriseren |
| Manager, member, read, edit | Beheerder, lid, lezen, bewerken |
| Sync, import | Synchroniseren, importeren |
| Balance now, free to spend, buffer zone, below zero | Saldo nu, vrij te besteden, bufferzone, rood |
| All, personal, shared (scope switch) | Alles, persoonlijk, gedeeld |
| Planned, expected income, one-off expense | Gepland, verwachte inkomst, eenmalige uitgave |
| Notifications, push notification, quiet hours, test notification | Meldingen, pushmelding, stille uren, testmelding |
| Warning, error | Waarschuwing, fout |
| Trusted device, sign out, new device signed in | Toestel, afmelden, nieuw toestel aangemeld |
| Sum (information only) | Samen, ter info |
