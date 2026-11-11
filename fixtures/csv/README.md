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
| `bilance-voorbeeld.csv` | 28 | Jan to Oct 2025, Oct to Nov 2026 | account names (3) | Zichtrekening, Spaarrekening and Reserve | see below: with the suggested cutoff new 21, after cutoff 6, invalid 1; with *Geen afkapdatum* new 23, present 2, probable duplicates 2, invalid 1 |
| `bilance-tweede.csv` | 12 | Mar to Aug 2025 | account names (3) | Zichtrekening, Spaarrekening and Reserve | see below: new 12, present 0, invalid 0, overlap 0 |

"Overlap" is how many of the new rows are dated in the period the account already syncs (from 1 November 2025 for the demo's Zichtrekening); the wizard warns about them for a generic file. For a Bilance file it shows the probable duplicates and the cutoff instead (0.5-4).

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
A Bilance export in the layout of spike S2 ([plan](../../plan/v0.5-bilance-import/01-spike-bilance-csv.md)), all values invented: UTF-8 without BOM, LF, `, ` between fields (also in the header), text in quotes, dates `YYYY-MM-DD 00:00:00.000`, amounts like `-170.00€` with a dot decimal and no thousands separator, two category columns, the account in `Rekening(en)` as a name, every row ending in `, `. Nothing in it comes from a real Bilance file. The demo's synced period starts on 1 November 2025, so most rows (January to October 2025) lie before it and 6 rows (October and November 2026) lie in it: two exact duplicates of synced rows (`Huur oktober 2026`, `Netflix`), two probable duplicates (`Spotify` and the bakery) and two really new ones (`Apotheek Peeters`, `Lidl`).

What it covers: 3 account names (Zichtrekening 22 rows, Spaarrekening 2, Contant 3), 12 distinct category pairs with commas and `&` in their names (for example `Wonen` / `Energie, nutsvoorzieningen`), incomes (salary, interest, a refund), amounts over 1 000 (rent `-1005.00€`, salary `+2850.00€`, `-1349.99€`), a transfer between two own accounts as two rows with opposite amounts and no category (16 September 2025), card payments whose `Betalingskenmerk` holds the card text (merchant, date, time, place, country, masked card number, merchant code and an invented card holder, `Jan Voorbeeld`, with an invented number `0000********0000`; one row without spaces around `|.|`), notes (`Verjaardag Sofie`, `Cadeau`, `Groenten`), an empty `Handelaar` (line 14, `Parking Gent`: the counterparty falls back to the title) and one unreadable amount (line 15, `abc€`).

Steps in the wizard (**Meer > Importeren**), with `scripts/dev.ps1 -Fresh`:
1. **Bestand:** "Lijkt een Bilance-export", scheidingsteken Komma, codering UTF-8, and the first lines show the card text reduced (`Colruyt Laagste Prijzen 14-01-2025 Gent`): the card holder and the card number are shown nowhere.
2. **Kolommen:** every column is filled in (Datum, Bedrag, Tegenpartij = Handelaar, Tegenpartij als die leeg is = Titel, Mededeling = Betalingskenmerk, Notitie, Categorie, Subcategorie, Rekeningnaam = Rekening(en)). Under "Naar welke rekeningen?" three names: Contant (3 rijen), Spaarrekening (2), Zichtrekening (22). Map Zichtrekening to Zichtrekening, Spaarrekening to Spaarrekening and Contant to Reserve (a manual account); Volgende stays off until all three are mapped.
3. **Categorieën:** 12 pairs with their transactions and total, for example `Eten & Drinken > Boodschappen` 6 transacties, `Winkelen > Overig` 5, `Wonen > Huur, hypotheek` 3, and "Zonder categorie" 2 transacties, total € 0,00 (the transfer), fixed on Niet categoriseren. On a fresh demo nothing is saved yet, so the step opens with **Voorstel** on 8 pairs (by name, against the default tree) and **Niet categoriseren** on the 4 others:

   | Pair in the file | Pre-selected in Saldo |
   |---|---|
   | `Wonen > Huur, hypotheek` | Voorstel: Wonen › Huur |
   | `Wonen > Energie, nutsvoorzieningen` | Voorstel: Wonen › Energie |
   | `Eten & Drinken > Boodschappen` | Voorstel: Boodschappen |
   | `Vrije tijd & entertainment > Telefoonkosten` | Voorstel: Abonnementen › Telefoon |
   | `Winkelen > Overig` | Voorstel: Overig |
   | `Inkomen > Loon` and `Inkomen > Rente` | Voorstel: Overig inkomen (both: a merge, "Samen met") |
   | `Inkomen > Terugbetaling` | Voorstel: Terugbetaling |
   | `Eten & Drinken > Uit eten, bezorging`, `Gezondheid & Educatie > Wellness, verzorging`, `Winkelen > Kleding, accessoires` | Niet categoriseren |

   Try: change a pair (the badge goes, the chip "zelf gekozen" counts it); choose *Nieuwe categorie* for `Winkelen > Kleding, accessoires` (name, place, icon); switch on *Per hoofdcategorie koppelen* and give `Wonen` one target; choose the same category for two pairs (the *Samengevoegd* card). A new category only exists after the import, and not when the import fails.
4. **Controle:** the Zichtrekening part suggests a cutoff, **1 november 2025**, the first date the demo syncs (Spaarrekening and Reserve are manual accounts: no suggestion). With it, 6 rows (the Oct and Nov 2026 ones) are skipped as *na afkapdatum* before anything is matched: 21 nieuw, 0 al in Saldo, 0 waarschijnlijke dubbels, 6 na afkapdatum, 1 onleesbaar ("Regel 15: Bedrag is ongeldig."). **To see the side-by-side list, choose *Geen afkapdatum* for Zichtrekening** (or a later date): then 23 nieuw, 2 al in Saldo (`Huur oktober 2026` and `Netflix` equal two rows the demo synced, same date, amount, counterparty and communication), 2 waarschijnlijke dubbels, 1 onleesbaar, and a list with two entries, each in the order *in het bestand* and *al in Saldo*: `SPOTIFY AB` of 18 October 2026 against the demo's `Spotify` of 17 October (same amount, one day off, similar name; the demo row already has a category, so nothing is taken over) and `Bakkerij De Graankorrel   Gent` of 16 November 2026 (EUR 8,40) against the demo's `Bakkerij De Graankorrel` of 17 November, which has **no category**: it shows *Niet gecategoriseerd* and *krijgt Boodschappen* (the *Voorstel* for `Eten & Drinken > Boodschappen`), so the result says **1 categorie overgenomen**. *Toch importeren* on a row makes it a new row (then 24 nieuw, 1 waarschijnlijke dubbel, and no category is taken over for it). The other two rows in the period (`Apotheek Peeters`, `Lidl`) are really new. With the proposals as they are 16 of the 23 new rows get a category (20 of the 27 readable rows sit in a pair with a proposal, 4 of them are present or probable duplicates) and 7 stay without; an account rule can still categorise one of those 7. Worked out from the pair table and checked by a preview on a fresh demo database, not clicked through.
5. **Klaar:** with the cutoff: 3 batches, imported 16 (Zichtrekening), 2 (Spaarrekening), 3 (Reserve), 6 overgeslagen na afkapdatum; importing the same file again: 0 imported, 21 already present, 6 na afkapdatum. With *Geen afkapdatum*: imported 18, 2, 3; 2 overgeslagen als dubbel besides the 2 already present (so the result shows 4 skipped as dubbel), 1 categorie overgenomen; the same file again: 0 imported, 25 already present, 2 probable duplicates (the Spotify and bakery rows still match their stored rows). In Transacties the rows have the note (`Verjaardag Sofie` on Pizzeria Roma) and the communication without the card holder (`Pizzeria Roma 09-04-2025 Gent`), and the category of the chosen target (origin "import": a rule or "apply to similar" never replaces it, only a manual pick on that row does). The demo's bakery row of 17 November now carries Boodschappen with origin "import". Undo does not exist yet (0.5-5).
6. **Ongedaan maken (0.5-5):** after the import (with the suggested cutoff: 3 batches, 21 transactions) the result step and **Meer > Importeren > Geschiedenis** show **one** entry, "Bilance-export · batch N en M en K · 3 rekeningen · 21 transacties", with **Alles ongedaan maken**. Open it: the sheet says "21 transacties worden verwijderd uit 3 rekeningen, inclusief hun categorie, splitsingen en notities. 0 daarvan heb je zelf aangepast" (first change a category by hand in Transacties and open it again: the count goes up by one), that the categories the import created stay, and that the mapping stays. Confirm: the transactions of the file are gone, Zichtrekening is back to its demo rows, and the entry reads "Ongedaan gemaakt op 18 november". Import the same file again: the same 21 transactions are added again (no "al in Saldo"), the mapping opens with everything already filled in. Importing it a second time without undoing makes batches that added nothing: they stay in the history as "Niets nieuws toegevoegd", without a button. (A file with *Geen afkapdatum* undoes the same way; the category the file gave to the one existing demo row (the bakery) stays.)

### `bilance-tweede.csv`
Twelve invented rows in exactly the layout of `bilance-voorbeeld.csv` (UTF-8, LF, `, `, `€` suffix), dates in March to August 2025, the same three account names, no row that equals one of the first file, and **11 of the 12 category pairs of the first file plus one new pair**, `Huisdieren > Dierenarts` (only the pair without a category is missing). Accounts: Zichtrekening 9 rows, Spaarrekening 1, Contant 2. Preview: 12 rows, nothing present or unreadable, and nothing in the period the bank syncs.

To see the mapping being reused (use the two files in this order on a fresh demo; undoing the first one leaves the mapping in place too): import `bilance-voorbeeld.csv` once with the choices you want (Bevestig *Voorstel*, create something new), then start the wizard again with `bilance-tweede.csv` and map the same three account names. *Categorieën* then opens with **11 pairs marked Opgeslagen** and showing your earlier targets (also a pair you left on Niet categoriseren: it is saved too), and `Huisdieren > Dierenarts` as the one new pair, with no match (no Voorstel; the name has no resemblance in the default tree) on Niet categoriseren. Click through to import: no mapping needed except for the new pair, and the result says how many of the 12 rows got a category. Another user signed in on the same demo sees none of the saved mapping.

### Learning and backfill (0.5-6) with these files
`bilance-voorbeeld.csv` and `bilance-tweede.csv` train the suggestions through their imported rows (origin `import`), but they hold no rows that wait for a category on a name the demo knows: their card names carry the town (`Colruyt Laagste Prijzen   Gent`), so they are other counterparties than the demo's, and the demo's four uncategorised rows (Bol.com pending, Bakkerij De Graankorrel, Frituur 't Pleintje, Apotheek Van Damme) have no history. The rows that wait come from **`valid.csv`** (20 uncategorised rows with the demo's counterparty names), imported into Zichtrekening **before or after** the Bilance files. The expectation, on a fresh demo, with `valid.csv` imported, then `bilance-voorbeeld.csv` (the suggested cutoff, after an import without cutoff and its undo, as in [local-testing](../../docs/local-testing.md)) and `bilance-tweede.csv`, every Voorstel accepted and the other pairs on Niet categoriseren:

| Counterparty | Proposed | Level, confidence | Seen | Rows that wait |
|---|---|---|---|---|
| Colruyt Laagste Prijzen | Boodschappen | high, 93 % | 26 | 3 |
| Delhaize | Boodschappen | high, 87 % | 13 | 2 |
| Luminus, Netflix, Spotify | Wonen, Abonnementen, Abonnementen | high, 87 % | 13 each | 1 each |
| Bol.com | Overig | high, 80 % | 8 | 2 (the pending demo row and one of the file) |
| Kinepolis, NMBS | Vrije tijd, Vervoer | low, 78 % | 7 each | 1 each |
| Proximus | Abonnementen | low, 76 % | 15 | 1 |
| Immo Verhaeghe, Werkgever NV | Wonen, Salaris | low, 72 % | 16 each | 1 each |
| Decathlon | Vrije tijd | low, 71 % | 5 | 1 |
| Sofie Maes | Terugbetaling | low, 50 % | 2 | 1 |

13 groups and 17 rows in all; the preview (`GET /api/suggestions/backfill`) ticks the 6 high groups in the web app (10 rows), and "X transacties krijgen een categorie, Y blijven zonder" reads 10 and 49 (17 and 42 with all 13). Only the demo and `valid.csv`, without the Bilance files: 12 groups (the same without Sofie Maes), Bol.com 75 % low, Proximus, Immo Verhaeghe and Werkgever NV 87 % high. The numbers were worked out from the demo seed and the files with a calculation that mimics the import, not clicked through. A backfill apply of the 6 high groups reports `{"categorised": 10, "groups": 6, "stale": 0}`, creates no rule and leaves the Bilance rows untouched (they already have a category); an undo of the Bilance batches afterwards does not undo it.
