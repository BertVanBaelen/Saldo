# Local testing

How to run Saldo on your own machine with the demo story, reset it, and click through every screen in about ten minutes. Needs Go and Node on the PATH. Developer tests (`go test`, `npm test`) are in [architecture.md](architecture.md); this page is about trying the app by hand.

## Start, reset, stop

```powershell
pwsh -File scripts/dev.ps1           # start
pwsh -File scripts/dev.ps1 -Fresh    # delete the demo database first: the demo story starts over
pwsh -File scripts/dev.ps1 -Stop     # stop what an earlier run left running
```

Windows PowerShell works too (`powershell -File scripts/dev.ps1`). Ctrl+C in the window that runs it stops everything. The script:

- builds the server to `server/bin/saldo.exe` and runs that (a `go run` child would survive a stop), and installs the web app's packages with `npm ci` when `web/node_modules` is missing;
- keeps the demo database and the server log in **`server/data-demo/`** (`server.log`, `server.err.log`). That folder is only for demo mode; `server/data/` (the default of a non-demo run) is never touched, and `-Fresh` deletes `server/data-demo/` and nothing else;
- checks first that ports 8080 and 5180 are free. If not, it says which program holds the port and what to do: `scripts/dev.ps1 -Stop` when it is an earlier run of this script, otherwise close that program. Nothing is started in that case;
- waits until http://localhost:8080/api/health answers, then prints the URLs and "Saldo is ready".

## The two URLs

| URL | What |
|---|---|
| http://localhost:5180 | The web app with hot reload (Vite). Open this one. It forwards `/api` to the server. |
| http://localhost:8080 | The Go server: the JSON API of [api.md](api.md) (try `/api/health`). It serves the built web app only when `SALDO_WEB_DIR` points at `web/dist`; otherwise `/` shows a short notice. |

## Demo mode

`SALDO_DEMO=1` (set by the script):

- Seeds the demo story: you are **Bert**; Partner exists but you never see their own account. Bert has Zichtrekening (Argenta, bank), Spaarrekening and Reserve (manual savings) and the Gedeelde rekening shared with Partner; about a year of transactions, from November 2025 to 18 November 2026 (342 in all, Partner's own account included).
- Acts as Bert on every request, **without signing in**, and refuses to start on a database that holds non-demo data (that is why it has its own folder).
- The date is fixed at **18 November 2026** ("vandaag" in the app). A CSV file may not hold rows dated after it. The history on Importeren shows the real date of an import, not the demo date.
- "Nu synchroniseren" only records a sync: no new transactions arrive, and a second press within 15 minutes answers "Je hebt net gesynchroniseerd. Probeer het over 15 minuten opnieuw."
- **The demo IBANs are invalid on purpose** (wrong check digits, so they can never be a real account). Consequences for importing: a `Rekening` cell in a CSV cannot hold a demo account's IBAN, because the importer refuses a row whose account is not a valid IBAN ("De rekening in het bestand is geen geldig IBAN."). So the files for the demo bank account leave that cell empty, and the files that test the account check carry a valid documentation IBAN and go into a manual account that you create with that IBAN (step "Rekeningen" below). The server also refuses a demo IBAN on a new manual account.
- The 4 transactions to categorise stay as they are (Bol.com pending, Bakkerij De Graankorrel, Frituur 't Pleintje, Apotheek Van Damme): the demo's numbers are used by tests and the design. More uncategorised rows with recognisable counterparties (Colruyt, Delhaize, Lidl, Luminus, Proximus, Netflix, NMBS, Kinepolis, a pharmacy, rent, salary) come from the CSV files in [`fixtures/csv/`](../fixtures/csv/README.md): invented data, one file per case.

## Click-through (about ten minutes)

Start with `pwsh -File scripts/dev.ps1 -Fresh` and open http://localhost:5180. Each item is "do this, you should see that". The last step changes the demo state; `-Fresh` restores it.

### Start (1 minute)
1. Open **Start**. You see the scope switch "Alles", "Persoonlijk", "Gedeeld" and two alerts: "Toestemming verloopt over 12 dagen" and "4 transacties te categoriseren".
2. "Saldo nu · alle rekeningen" shows € 2.914,90, "Samen, ter info · zonder spaarrekeningen", with the tiles Zichtrekening € 1.968,82 (€ 1.069 boven buffer) and Gedeelde rekening € 946,08 (€ 346 boven buffer). Below: "Persoonlijke rekeningen" (Zichtrekening, Spaarrekening, Reserve) and "Gedeelde rekeningen".
3. Click "Persoonlijk": "Saldo nu · Zichtrekening" with € 1.968,82 and no shared account. Click "Gedeeld": "Saldo nu · Gedeelde rekening" € 946,08, "Met Partner · jij bent beheerder". Back to "Alles".
4. Press the sync icon ("Nu synchroniseren"): the bar spins and a toast "Gesynchroniseerd" appears.
5. Click the alert "4 transacties te categoriseren": Transacties opens with the "Niet gecategoriseerd" filter on.

### Transacties (2 minutes)
1. The sidebar badge next to Transacties reads 4. Without filters the list starts with "Vandaag · woensdag 18 november": Bol.com ("In behandeling") and Colruyt Laagste Prijzen.
2. Click the chip "Niet gecategoriseerd 4": exactly Bol.com, Bakkerij De Graankorrel, Frituur 't Pleintje and Apotheek Van Damme. Click it again to switch it off.
3. Search ("Zoek op naam, bedrag of mededeling"): `colruyt` shows only Colruyt Laagste Prijzen rows, all on the Gedeelde rekening; `86,42` shows only rows of exactly € 86,42; clear the box.
4. Click a row. The detail (a side panel on a wide screen, a sheet on a phone) shows the amount, "Datum", "Mededeling" and "Categorie"; the pending Bol.com row adds "Nog in behandeling. Telt mee in de totalen zodra de bank ze boekt."
5. Filters: the chip "Alle rekeningen" → "Zichtrekening" leaves only that account's rows (the address becomes `?rekening=1`); the chip "Periode" → "Vorige maand" then leaves 1 to 24 October 2026; "Wis filters" removes both. "Oudere transacties laden" at the bottom loads the next 50.

### Rekeningen (2 minutes)
1. Open **Rekeningen** (sidebar, group Beheer). "Buffer per rekening" shows € 1.500,00 samen; PERSOONLIJK lists Zichtrekening (Buffer € 900,00, € 1.968,82), Spaarrekening (€ 12.500,00) and Reserve (€ 4.200,00); GEDEELD lists Gedeelde rekening (€ 946,08).
2. Add a manual account, which the import step below needs: "Rekening toevoegen" → "Handmatige rekening". Name `Testrekening`, Soort "Zichtrekening zonder bankkoppeling", IBAN `BE68 5390 0754 7034` (a documentation IBAN with valid check digits), "Saldo vandaag" `500,00`, press "Toevoegen". A toast "Testrekening toegevoegd" appears and Testrekening shows under PERSOONLIJK as "Handmatig · bijgewerkt 18 nov" with € 500,00. (Typing a demo IBAN such as `BE68 0000 0000 4821` instead gives "Dit lijkt geen geldig IBAN. Kijk het na of laat het leeg.")
3. Click Zichtrekening, then "Details en synchronisatie": the account page shows "Saldo nu", the masked IBAN `BE68 •••• •••• 4821`, "Recente transacties", and "Synchronisatie" with "Opnieuw autoriseren" and "Koppeling verwijderen" (do not press that yet).

### Importeren (4 minutes)
Open **Importeren**, press "Bestand kiezen" (or drop a file) and pick one of the files from `fixtures/csv/`. The steps are Bestand (it says "Lijkt een Argenta-export"), Kolommen (already filled in; under "Naar welke rekening?" pick the account), Controle (three numbers: "nieuw", "al in Saldo", "onleesbaar") and Klaar. Nothing is stored before you press "Importeer N transacties". Every file and its exact result is described in [`fixtures/csv/README.md`](../fixtures/csv/README.md); the short version, each on a fresh demo:

| File | Into | You should see |
|---|---|---|
| `valid.csv` | Zichtrekening | 20 nieuw, 0 al in Saldo, 0 onleesbaar. After "Importeer 20 transacties": "20 transacties geïmporteerd"; the badge on Transacties goes from 4 to 24 and search `apotheek` finds the rows of October 2025. |
| `valid.csv` again | Zichtrekening | 0 nieuw, 20 al in Saldo, "Er komt niets bij: elke rij staat al in Saldo of is onleesbaar." and the import button is disabled. |
| `overlap.csv` | Zichtrekening | 4 nieuw, 6 al in Saldo, and the warning "4 nieuwe regels vallen in de periode die de bank al synchroniseert; controleer op dubbels." |
| `other-account.csv` | Zichtrekening | 0 nieuw, 12 onleesbaar, each "Rekening BE68 •••• •••• 7034 in het bestand is niet de gekozen rekening." |
| `other-account.csv` | Testrekening | 12 nieuw: the file's account is the one you created. |
| `non-euro.csv` | Zichtrekening | 8 nieuw, 2 onleesbaar: "Regel 4" and "Regel 7", "Alleen bedragen in euro worden ondersteund." |
| `malformed.csv` | Zichtrekening | 6 nieuw, 5 onleesbaar, listed per line (4, 5, 6, 7, 10) under "Onleesbare rijen". |
| `several-accounts.csv` | Testrekening | 4 nieuw, 7 onleesbaar ("Rekening BE71 …" and "Rekening BE62 …" are not the chosen account). |
| `several-accounts.csv` | Reserve | 0 nieuw, 11 onleesbaar: "Het bestand bevat rijen van meer dan één rekening, en de gekozen rekening heeft geen IBAN om ze uit elkaar te houden." |
| `large.csv` | Zichtrekening | 1.500 nieuw, checked and imported in about a second. |

Afterwards the "Geschiedenis" list on Importeren shows each import as a batch. The 60 previews and 20 imports per hour that the server allows are reset by restarting.

### Bank link removal (1 minute, last: it changes the demo)
Open **Bankkoppelingen** (or the Zichtrekening account page from step 3) and press "Koppeling verwijderen". The question "Koppeling met Argenta verwijderen?" offers "Geschiedenis bewaren" (transactions and balances stay, the accounts stop updating) and "Geschiedenis verwijderen" (Zichtrekening and all its transactions go, the 4 to categorise with them; the Gedeelde rekening stays because Partner still uses it). Choose "Geschiedenis bewaren" and confirm with "Koppeling verwijderen": a toast "Koppeling verwijderd · geschiedenis bewaard" appears; Bankkoppelingen now says "Nog geen bank gekoppeld"; Zichtrekening and Gedeelde rekening stay, with all their transactions, marked "Argenta · niet meer gekoppeld" on Rekeningen and Start; the alert "Toestemming verloopt over 12 dagen" is gone. Run `scripts/dev.ps1 -Stop`, then `scripts/dev.ps1 -Fresh` to get the link back.

## Added in 0.4-1 and 0.4-2

Categories and rules exist in the server from phase 0.4-1 and 0.4-2; the screens for them (Categorieën, choosing a category on a transaction) come in 0.4-3 and 0.4-4. Until then you try them through the API from PowerShell, and see the effect in Transacties.

### Categories and rules (0.4-1, 0.4-2)

The counts below assume a fresh demo (`scripts/dev.ps1 -Fresh`) in which `valid.csv` is the only file you import. Keep the app open on Transacties to see the effect.

1. **The category tree.** `GET /api/categories` is a flat list; `parentId` is empty for top-level categories and `count` is the number of *your own* transactions in it (Partner's never count).
   ```powershell
   $api = 'http://localhost:8080/api'
   $cats = Invoke-RestMethod "$api/categories"
   $cats | Format-Table id, name, type, colour, parentId, count
   ```
   You see the default tree: 25 rows, the 10 top categories (Wonen, Boodschappen, Vrije tijd, Vervoer, Abonnementen, Overig as expenses; Salaris, Terugbetaling, Bijdrage, Overig inkomen as income) each followed by its subcategories (for example Huur, Energie, Internet en tv and Verzekeringen under Wonen). `count` shows your own transactions per category; the demo's history sits on the top categories, for example Wonen 26 and Boodschappen 66.

2. **A category and a subcategory.** Names may hold commas and `&`.
   ```powershell
   Invoke-RestMethod "$api/categories" -Method Post -ContentType 'application/json' -Body (@{ name = 'Gezondheid & zorg'; type = 'expense'; colour = 'c3' } | ConvertTo-Json)
   $cats = Invoke-RestMethod "$api/categories"
   $zorg = $cats | Where-Object name -eq 'Gezondheid & zorg'
   Invoke-RestMethod "$api/categories" -Method Post -ContentType 'application/json' -Body (@{ name = 'Apotheek, tandarts'; parentId = $zorg.id } | ConvertTo-Json)
   $cats = Invoke-RestMethod "$api/categories"
   $cats | Format-Table id, name, parentId, count
   ```
   The list now holds both, the second with `parentId` of the first.

3. **A rule from a counterparty, then an import.** A rule applies to rows when they come in, so create it before importing:
   ```powershell
   $boodschappen = ($cats | Where-Object name -eq 'Boodschappen').id
   Invoke-RestMethod "$api/rules" -Method Post -ContentType 'application/json' -Body (@{ counterparty = 'Colruyt'; categoryId = $boodschappen } | ConvertTo-Json)
   $rules = Invoke-RestMethod "$api/rules"
   $rules | Format-Table
   ```
   Then import `fixtures/csv/valid.csv` into Zichtrekening (Importeren, as above). In Transacties search `colruyt`: the three Colruyt rows of October 2025 on Zichtrekening come in as "Boodschappen", like the demo's own Colruyt rows. The badge reads 21 (the 4 of the demo plus the 17 other rows of the file): everything else stayed "Niet gecategoriseerd".

4. **Apply a rule to rows that are already there.** `apply` re-evaluates the uncategorised rows you already have; run it twice:
   ```powershell
   $sub = ($cats | Where-Object name -eq 'Apotheek, tandarts').id
   Invoke-RestMethod "$api/rules" -Method Post -ContentType 'application/json' -Body (@{ counterparty = 'Apotheek'; categoryId = $sub } | ConvertTo-Json)
   Invoke-RestMethod "$api/rules/apply" -Method Post -ContentType 'application/json' -Body '{}'    # updated: 3
   Invoke-RestMethod "$api/rules/apply" -Method Post -ContentType 'application/json' -Body '{}'    # updated: 0
   ```
   The first answer is `updated` 3: the two Apotheek Peeters rows of the file and the demo's Apotheek Van Damme. In Transacties search `apotheek`: all three now have a category, and the badge reads 18. The second run changes nothing.

5. **Remove a category.** `moveTo` says where its transactions go: the id of another category, or `none` to leave them uncategorised. Both answer 204 (no output). Write `${sub}` with braces: `$sub?moveTo` would be read as one variable name.
   ```powershell
   $overig = ($cats | Where-Object name -eq 'Overig').id
   Invoke-RestMethod "$api/categories/${sub}?moveTo=$overig" -Method Delete
   Invoke-RestMethod "$api/categories/$($zorg.id)?moveTo=none" -Method Delete
   ```
   The first moves the three pharmacy rows to "Overig" (search `apotheek` again); the second removes "Gezondheid & zorg", which holds nothing any more, so nothing else changes. Had it still held transactions, `moveTo=none` would have made them "Niet gecategoriseerd" again and the badge would go up by that many. Check with `Invoke-RestMethod "$api/categories"`: the 25 categories of the default tree (10 top categories and 15 subcategories) are left.

### What a rule can hold
Besides `categoryId` (required) and `counterparty`: `counterpartyExact`, `counterpartyIban`, `communication`, `communicationRegex`, `amountMin` and `amountMax` (cents, compared on the absolute amount), `accountId` and `priority` (higher wins; a tie goes to the newest rule). A rule without `accountId` is yours and applies to your personal accounts (accounts where you are the only member); with `accountId` it belongs to that account. A rule applies to rows that come in through a sync or an import, and `POST /api/rules/apply` applies it to the uncategorised rows already stored. A category chosen by hand is never overwritten, and neither is one that came from an import file. `GET /api/rules` lists the rules, `PATCH /api/rules/{id}` changes one and `DELETE /api/rules/{id}` removes it (204).
