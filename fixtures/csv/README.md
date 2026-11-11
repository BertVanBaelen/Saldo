# CSV fixtures for the import wizard

Invented data for trying **Importeren** by hand, one file per case. Nothing here comes from a real bank or a Bilance file; the names are made up (companies such as Colruyt or Delhaize are the ones the demo uses), the IBANs are documentation IBANs. How to start the demo and click through the screens: [docs/local-testing.md](../../docs/local-testing.md).

All files except `bilance-voorbeeld.csv` (below) are UTF-8, `;`-separated, in the Argenta header set (`Rekening;Boekdatum;Valutadatum;Referentie;Beschrijving;Bedrag;Munt;Verrichtingsdatum;Rekening tegenpartij;Naam tegenpartij;Mededeling`), so the wizard recognises them as "Lijkt een Argenta-export" and fills in the columns. The date and amount formats differ per file on purpose (`dd/mm/yyyy`, `dd-mm-yyyy`, `dd.mm.yyyy`, `yyyy-mm-dd`; `-1.005,00` and `-1005,00`), all of which the importer reads. All dates are before 18 November 2026, the date the demo is fixed at.

## The `Rekening` cell and the demo IBANs

The demo IBANs have wrong check digits on purpose, and the importer refuses a row whose `Rekening` cell is not a valid IBAN ("De rekening in het bestand is geen geldig IBAN."). So:

- Files for a **demo bank account** (Bert's Zichtrekening) leave `Rekening` **empty**; an empty cell is not checked. They can go into any account.
- Files that test the **account check** carry valid documentation IBANs: `BE68 5390 0754 7034`, `BE71 0961 2345 6769` and `BE62 5100 0754 7061` (all three pass the mod-97 check; the wizard accepting them as "another account" instead of "geen geldig IBAN" is the proof). They go into a **manual account** with that IBAN.

Create the manual account once (after `scripts/dev.ps1 -Fresh`): Rekeningen → "Rekening toevoegen" → "Handmatige rekening", name `Testrekening`, Soort "Zichtrekening zonder bankkoppeling", IBAN `BE68 5390 0754 7034` → "Toevoegen". The demo's **Reserve** is a manual account without IBAN, the one for the "several accounts" case.

## The files

Results were measured on a fresh demo database through the real API (`POST /api/imports/preview` for the numbers, `POST /api/imports` for the imports) and, for `valid.csv`, also through the wizard. The files share no rows with each other (each has its own months), so the results do not depend on the order. Importing the same file twice gives every readable row as "al in Saldo" (present) and adds nothing.

| File | Rows | Dates | `Rekening` | Into | Result |
|---|---|---|---|---|---|
| `valid.csv` | 20 | Oct 2025 | empty | Zichtrekening | new 20, present 0, invalid 0, overlap 0 |
| `overlap.csv` | 10 | Oct 2026 | empty | Zichtrekening | new 4, present 6, invalid 0, overlap 4 |
| `other-account.csv` | 12 | Sep 2025 | `BE68 5390 0754 7034` | Testrekening, and Zichtrekening | Testrekening: new 12. Zichtrekening: new 0, invalid 12; the import is refused |
| `non-euro.csv` | 10 | Aug 2025 | empty | Zichtrekening | new 8, present 0, invalid 2 |
| `malformed.csv` | 11 | Jul 2025 | empty | Zichtrekening | new 6, present 0, invalid 5 |
| `several-accounts.csv` | 11 | Jun 2025 | three IBANs | Testrekening, and Reserve | Testrekening: new 4, invalid 7. Reserve: new 0, invalid 11; the import is refused |
| `large.csv` | 1 500 | Jan 2023 to May 2025 | empty | Zichtrekening | new 1 500, present 0, invalid 0, overlap 0 |
| `bilance-voorbeeld.csv` | 27 | Jan to Oct 2025, Oct to Nov 2026 | account names (3) | Zichtrekening, Spaarrekening and Reserve | see below: new 24, present 2, invalid 1, overlap 3 |

"Overlap" is how many of the new rows are dated in the period the account already syncs (from 1 November 2025 for the demo's Zichtrekening); the wizard warns about them.

### `valid.csv`
Twenty rows of October 2025, EUR, mixed income and expenses, with counterparties to try rules on: Colruyt Laagste Prijzen (3 rows), Delhaize (2), Lidl (2), Luminus, Proximus, Netflix, Spotify, NMBS, Kinepolis, Apotheek Peeters (2), Decathlon, Bol.com, rent (Immo Verhaeghe), salary (Werkgever NV) and a refund from a friend (Sofie Maes). The dates lie before the demo story (it starts 1 November 2025), so these rows never overlap what the demo "synced". Imported into Zichtrekening they are all uncategorised: the badge on Transacties goes from 4 to 24 (to 21 when a rule for "Colruyt" exists first).

### `overlap.csv`
Ten rows of October 2026 for Zichtrekening: six are rows the demo already synced (same booking date, amount, counterparty and communication: Immo Verhaeghe rent, Werkgever NV salary, CM Ziekenfonds refund, Netflix, NMBS, Spotify) and four are new (Lidl, Apotheek Peeters, Delhaize, Colruyt Laagste Prijzen). Preview and import: new 4, present 6, invalid 0; the preview's overlap is 4, and the wizard shows "4 nieuwe regels vallen in de periode die de bank al synchroniseert; controleer op dubbels." Import it twice and the second batch has 0 imported, 10 present.

### `other-account.csv`
Twelve rows of September 2025, every row with `Rekening` `BE68 5390 0754 7034`.
- Into **Testrekening** (that IBAN): new 12.
- Into **Zichtrekening** (another IBAN): new 0, invalid 12, each row with "Rekening BE68 •••• •••• 7034 in het bestand is niet de gekozen rekening."; the API refuses the import with 400 "Dit bestand hoort bij een andere rekening dan de gekozen rekening." (in the wizard the import button stays disabled).

### `non-euro.csv`
Ten rows of August 2025; line 4 (Booking.com, USD) and line 7 (Amazon UK, GBP) are not in euro. New 8, invalid 2: "Regel 4" and "Regel 7" both read "Alleen bedragen in euro worden ondersteund."

### `malformed.csv`
Eleven data rows of July 2025 with five faults, shown by line of the file (the header is line 1): new 6, invalid 5.

| Line | Fault | Message |
|---|---|---|
| 4 | one field too few | Deze regel heeft 10 velden in plaats van 11. |
| 5 | impossible date (31/06/2025) | Datum is ongeldig. Gebruik dd/mm/jjjj, dd-mm-jjjj, dd.mm.jjjj of jjjj-mm-dd. |
| 6 | amount `twaalf euro` | Bedrag is ongeldig. |
| 7 | a stray quote inside a field | Aanhalingsteken op een onverwachte plaats. |
| 10 | date 01/01/2027, after the demo date | Datum ligt in de toekomst. |

### `several-accounts.csv`
Eleven rows of June 2025 from three accounts: `BE68 5390 0754 7034` (lines 2, 5, 8, 11), `BE71 0961 2345 6769` (lines 3, 6, 9, 12) and `BE62 5100 0754 7061` (lines 4, 7, 10).
- Into **Testrekening**: new 4 (its own rows), invalid 7: "Rekening BE71 •••• •••• 6769 in het bestand is niet de gekozen rekening." (lines 3, 6, 9, 12) and the same for `BE62 •••• •••• 7061` (lines 4, 7, 10).
- Into **Reserve** (no IBAN): the file cannot be told apart, so every row is refused: new 0, invalid 11, each with "Het bestand bevat rijen van meer dan één rekening, en de gekozen rekening heeft geen IBAN om ze uit elkaar te houden."; the API refuses the import with 400 "Dit bestand bevat meer dan één rekening. Kies een rekening met een IBAN of splits het bestand."

### `large.csv`
1 500 rows from January 2023 to May 2025 (181 KB, limit 5 MB): monthly rent, salary, energy, internet, Netflix and Spotify, and 1 326 card payments at supermarkets, shops, a pharmacy and so on, with the counterparties of `valid.csv` among them. Generated once by a throwaway script from a fixed seed (not kept in the repository), so the file is stable. Preview and import answer at once (the import took 104 ms on the development machine); the badge on Transacties goes up by 1 500.

### `bilance-voorbeeld.csv`
A Bilance export in the layout of spike S2 ([plan](../../plan/v0.5-bilance-import/01-spike-bilance-csv.md)), all values invented: UTF-8 without BOM, LF, `, ` between fields (also in the header), text in quotes, dates `YYYY-MM-DD 00:00:00.000`, amounts like `-170.00€` with a dot decimal and no thousands separator, two category columns, the account in `Rekening(en)` as a name, every row ending in `, `. Nothing in it comes from a real Bilance file. The demo's synced period starts on 1 November 2025, so most rows (January to October 2025) lie before it and 5 rows (October and November 2026) lie in it.

What it covers: 3 account names (Zichtrekening 21 rows, Spaarrekening 2, Contant 3), 12 distinct category pairs with commas and `&` in their names (for example `Wonen` / `Energie, nutsvoorzieningen`), incomes (salary, interest, a refund), amounts over 1 000 (rent `-1005.00€`, salary `+2850.00€`, `-1349.99€`), a transfer between two own accounts as two rows with opposite amounts and no category (16 September 2025), card payments whose `Betalingskenmerk` holds the card text (merchant, date, time, place, country, masked card number, merchant code and an invented card holder, `Jan Voorbeeld`, with an invented number `0000********0000`; one row without spaces around `|.|`), notes (`Verjaardag Sofie`, `Cadeau`, `Groenten`), an empty `Handelaar` (line 14, `Parking Gent`: the counterparty falls back to the title) and one unreadable amount (line 15, `abc€`).

Steps in the wizard (**Meer > Importeren**), with `scripts/dev.ps1 -Fresh`:
1. **Bestand:** "Lijkt een Bilance-export", scheidingsteken Komma, codering UTF-8, and the first lines show the card text reduced (`Colruyt Laagste Prijzen 14-01-2025 Gent`): the card holder and the card number are shown nowhere.
2. **Kolommen:** every column is filled in (Datum, Bedrag, Tegenpartij = Handelaar, Tegenpartij als die leeg is = Titel, Mededeling = Betalingskenmerk, Notitie, Categorie, Subcategorie, Rekeningnaam = Rekening(en)). Under "Naar welke rekeningen?" three names: Contant (3 rijen), Spaarrekening (2), Zichtrekening (21). Map Zichtrekening to Zichtrekening, Spaarrekening to Spaarrekening and Contant to Reserve (a manual account); Volgende stays off until all three are mapped.
3. **Categorieën:** 12 pairs, read-only, with a note that the mapping comes in a later step: for example `Eten & Drinken > Boodschappen` 5 transacties, `Winkelen > Overig` 5, `Wonen > Huur, hypotheek` 3, and "Zonder categorie" 2 transacties, total € 0,00 (the transfer). *Later phases extend this entry with what the mapping step shows and does.*
4. **Controle:** 24 nieuw, 2 al in Saldo (the Zichtrekening rows `Huur oktober 2026` and `Netflix` of October 2026 equal two rows the demo synced), 1 onleesbaar ("Regel 15: Bedrag is ongeldig."), and the warning that 3 new rows fall in the period the bank already syncs. One of those 3 is a probable duplicate that the exact rule does not catch: `Spotify` on 18 October 2026 (the demo has Spotify on 17 October: same amount, similar name `SPOTIFY AB`, one day off). The other two (`Apotheek Peeters`, `Lidl`) are really new.
5. **Klaar:** 3 batches, imported 19 (Zichtrekening), 2 (Spaarrekening), 3 (Reserve). Importing the same file again: 0 imported, 26 already present. In Transacties the rows have the note (`Verjaardag Sofie` on Pizzeria Roma) and the communication without the card holder (`Pizzeria Roma 09-04-2025 Gent`).
