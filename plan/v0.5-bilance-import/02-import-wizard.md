# 0.5-2 · Import wizard and Bilance preset

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | built, to verify (11 Nov 2026) |
| Size | M |
| Features | IMP-1 |
| Concepts | [import](../../analysis/concepts/import.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.6 |
| Depends on | [0.3-6](../v0.3-bank-sync/06-csv-import.md), [0.5-1](01-spike-bilance-csv.md) |

## Goal
A step-by-step import with a preview before anything is written.

## Steps
1. The full wizard as designed: file → columns → categories → preview → result.
2. Column mapping for date, amount, counterparty, communication, category, account; target account, or accounts from a column.
3. Saved "Bilance" preset from spike S2.

## Done when
A Bilance export reaches the preview step with all columns recognised by the preset.

## Carried over from 0.3
- The 0.3-6 wizard has four steps (Bestand, Kolommen, Controle, Klaar) and no override of the parse settings. The mockup shows a manual choice of delimiter, encoding, date format and decimal separator: build it here, next to the categories step and "accounts from a column".
- The Argenta preset was built from the header only. After the real-data check in [0.3-6](../v0.3-bank-sync/06-csv-import.md#to-verify-with-real-data), add a `Referentie` mapping field if it equals the sync's `external_id`, and `Beschrijving` as a fallback for an empty `Mededeling`, if the real rows call for it.

## Built (11 Nov 2026)
The contract is in [docs/api.md](../../docs/api.md), "CSV import" and "Bilance".
- **Bilance preset** (`server/internal/importers`, extended, not forked): recognised from the header set (Titel, Datum, Bedrag, Categorie, Subcategorie, Betalingskenmerk, Handelaar, Rekening(en)), `source: "bilance"`. The `, ` separator (white space before a field is dropped, so `, "text"` parses), dates with a time (`2026-11-02 00:00:00.000`, the time ignored) and amounts like `-170.00€` or `+2850.00€` go through the existing date and amount parsers. The mapping is the generic suggestion through new header aliases, plus new fields: `note`, `category`, `subcategory`, `accountName`, `counterpartyFallback`.
- **Accounts from a column:** a file whose mapping has `accountName` takes an `accountMap` (file account name to one of the viewer's accounts) instead of `accountId`. The rows split over their accounts, one batch per account, all in one database transaction (`ledger.ImportFiles`; `Import` wraps it for one account). Authorisation is the existing one per account (hidden 404, read-only 403). The IBAN guard does not apply to such a file; currency and ownership checks stay.
- **Parse settings:** delimiter, encoding, date format (`dmy`, `mdy`, `ymd`) and decimal separator, as a `settings` part validated against fixed lists, for the preview and the import. The preview answers the delimiter and encoding it read.
- **Preview with a mapping, no account:** answers the distinct account names and the distinct category pairs of the readable rows (with rows and total); with an account (or the map) the counts as before. Category pairs are carried on the parsed row (`importers.Row.Category` and `.Subcategory`, two separate strings) and listed in the preview as `categories: [{category, subcategory, rows, total}]`; they are not stored or applied yet.
- **Limits:** 20 MiB, 100 000 rows (were 5 MiB, 20 000), read as before (`io.LimitReader`, an oversized upload is refused unread, `MaxBytesReader` on the body), the import read deadline 5 minutes.
- **Wizard** (`web/src/pages/Importeren.tsx`): *Bestand*, *Kolommen*, *Categorieën*, *Controle*, *Klaar*. Settings in *Bestand* (scheidingsteken, codering) and *Kolommen* (datumnotatie, decimaalteken); the account-name table in *Kolommen*; the read-only category table in *Categorieën* with the note that mapping comes next; the result lists one batch per account. See [importeren](../../analysis/screens/importeren.md) for the deviations from the mockup.
- **Fixture:** `fixtures/csv/bilance-voorbeeld.csv` (27 invented rows) with the expected result in `fixtures/csv/README.md`.

## Decisions (11 Nov 2026)
1. **Counterparty:** `Handelaar` with white space runs collapsed to one space (the parser's cell cleaning does that), `Titel` when `Handelaar` is empty (the `counterpartyFallback` field). All columns stay in `raw_payload`; nothing returns `raw_payload` through the API.
2. **Communication:** `Betalingskenmerk` as it is when structured (`+++123/4567/89012+++`). A card string (contains `|.|`) keeps merchant, date and place as one line; a string that is not eight parts with a `dd-mm-yyyy` second part keeps its first part only. The card holder's name and the masked card number exist only in `raw_payload`, never in a stored field, a preview sample, a row error or a log. The reduction applies to any cell with `|.|` in the communication or the sample, whatever the preset, so a changed mapping cannot leak it.
3. **Tags and notes:** `Notitie` becomes the transaction note (cut at 200 characters, like a note typed in Transacties); `Tag(s)` only stays in `raw_payload`.
4. **Categories:** carried as two separate parts (never joined) on the parsed row and in the preview; no category is stored or applied in this phase.
5. **Accounts from a column, unmapped names:** an unmapped name **blocks** the preview counts and the import (400, no name in the message) and the wizard keeps *Volgende* off; there is no "skip these rows" choice, which is the simplest rule that never silently drops history. The mockup's "Niet importeren" per name and "Nieuwe handmatige rekening" are not built. One batch per account; the file's unreadable rows count on the first batch.
6. **Mode of the account step:** following the `Rekeningnaam` column choice, not a separate switch. More than 50 distinct names, or 500 distinct category pairs, is a 400 (a wrong column), which also bounds the answer.
7. **A cell with several accounts** (a comma or semicolon in `Rekening(en)`) is an unreadable row ("Een cel met meer dan één rekening wordt niet ondersteund."), a name longer than 100 characters too; the real format of a list is unknown (the sample had none), so nothing is guessed.
8. **Amounts:** `+` is read, and a thousands separator only where the existing parser finds it unambiguous (`1,250.00`, `1.250,00`); `1.250€` next to dot-decimal amounts is refused as having more than two decimals, never read as 1,25. A thousands comma would also break an unquoted Bilance amount, so none is expected. No `1,250.00€` row is in the fixture.
9. **Settings defaults:** delimiter and encoding show what was detected and can be overridden; date format and decimal separator default to "Automatisch" (the existing detection), since the file's columns are not known before the mapping. The decimal setting only decides an amount that does not show its own separator (`1.234`). ISO-8859-1 is not offered: it differs from Windows-1252 only in 0x80 to 0x9F.
10. **Limits:** 20 MiB and 100 000 rows. Memory is as safe as in 0.3-6: the file is read once up to the limit plus one byte (`io.LimitReader`), refused beyond it, and held next to its decoded text and parsed rows (several times the file size; not measured at the limit); at most two imports run at once (a third answers 503), which stays the cap on memory. The HTTP body limit follows the file limit (`importBodyMax`); the 60 previews and 20 imports per hour are unchanged, and a Bilance file costs one preview more than an Argenta file (the account names and categories) plus one per change of the mapping or settings in the steps that ask. The web checks 20 MiB before uploading.
11. **Response shape:** `POST /api/imports` answers `batches` (an array), not `batch`: one batch per account.
12. **Argenta `Referentie` and `Beschrijving` fallbacks (carried over from 0.3-6): not added.** No real-data check of the Argenta export has happened, so nothing justifies them yet; they stay open under "To verify with real data" in [0.3-6](../v0.3-bank-sync/06-csv-import.md).
13. **Fixture dates:** the demo's synced period starts on 1 November 2025, so a year of history before it lies in 2025; five rows lie in October and November 2026 to overlap it (two exact duplicates of synced rows, one probable duplicate a day off, two new).

## To verify with a real Bilance export
- Incomes (a `+`?), amounts of 1 000 or more, transfers between own accounts, splits, tags, a note, a cell with several accounts and a text with a double quote: the parser reads what it can and makes the rest an unreadable row; look at the first real preview.
- The exact separator of a card string (`|.|` with or without spaces; both are read) and whether all of them have eight parts.
- The size and row count of the full export against the new limits.

