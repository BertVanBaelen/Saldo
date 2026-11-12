# 0.3-6 · Basic CSV import

| | |
|---|---|
| Version | [0.3 Bank sync](README.md) |
| Status | built (9 Nov 2026), to verify with a real Argenta export |
| Size | M |
| Features | TX-1 |
| Concepts | [import](../../analysis/concepts/import.md), [transaction](../../analysis/concepts/transaction.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.1, 4.6 |
| Depends on | [0.3-1](01-sync-engine.md) |

## Goal
A fallback when the bank API fails, and a first way to bring in older Argenta history.

## Steps
1. Upload a CSV, map the columns (date, amount, counterparty, communication), choose the target account (steps 1, 2 and 4 of the designed wizard).
2. Preset for the Argenta export.
3. Run the rows through the same pipeline and dedupe key as the sync.
4. Keep every import as a batch from the start, so 0.5 can add undo, category mapping and duplicate handling.

## Done when
An Argenta CSV export imports into the right account, and importing it again adds nothing.

## Built (9 Nov 2026)
End to end; the contract is in [docs/api.md](../../docs/api.md), "CSV import".
- **Parser** (`server/internal/importers`): UTF-8 or Windows-1252, delimiter `;`, tab or `,`, Belgian dates and amounts into integer cents, column suggestion from header names, an `argenta` preset by header set. Limits 5 MiB, 20 000 rows, 64 columns (0.5-2 raised them to 20 MiB and 100 000 rows). Unreadable rows become errors by line, never with cell text. Cells are stored as data and never evaluated; a later exporter must neutralise cells that start with `=`, `+`, `-` or `@`.
- **Endpoints:** `POST /api/imports/preview` (file, columns and a sample; with an account and a mapping also the counts of a rolled-back import), `POST /api/imports` and `GET /api/imports` (the history). `multipart/form-data`; 60 previews and 20 imports per user per hour.
- **Batches:** every import is a row in the existing `import_batches` table (no migration), and its transactions point at it (`import_batch_id`, cascade). Rows go in through the sync's key path in one database transaction, so an import is atomic; the same file twice adds nothing. Balances, sync status and connections are never touched.
- **Guards:** a row whose own-account column holds another IBAN than the target account is refused; a currency other than EUR is refused. When the target account has no IBAN, a file whose own-account column names more than one account is refused whole (the preview lists every row as unreadable, the import answers 400 and makes no batch), since its rows cannot be told apart; a file of one account goes in unchecked.
- **Overlap warning:** the preview's counts carry `overlap`, the number of new rows dated in the period the account already syncs, and the wizard shows it as a warning on the *Controle* step: those rows may duplicate synced ones if the CSV and the sync describe a transaction differently. *The period the account already syncs* is defined as: from the booking date of the account's earliest booked row that a sync brought (a row with a bank connection; imported rows never count) up to today. An account without such a row has no synced period, so `overlap` is 0. Counts only, no rows.
- **Duplicates, both ways:** at import, a row equal in booking date, amount, counterparty and communication to a booked row the account holds (from any source) is not stored again (count-aware: two equal rows against one stored row import one); in the sync, a bank row equal to an imported row is not stored again, only for accounts that have imports.
- **Wizard** (Meer > Importeren, `web/src/pages/Importeren.tsx`) in four steps: *Bestand* (what the server found: delimiter, first lines, Argenta or other), *Kolommen* (the mapping, with the suggestion filled in, and the target account), *Controle* (new, already in Saldo, unreadable, with the unreadable lines) and *Klaar* (the batch). The import button is off when nothing is new. The start view lists the import history (file, source, batch number, date, account, number of transactions).

## Decisions (9 Nov 2026)
1. **Batch storage:** the existing `import_batches` table, no migration; deleting a batch removes its rows (cascade). The undo UI comes in 0.5-5.
2. **API shape:** a preview and an import endpoint on multipart upload, plus the history list. The file is uploaded again with every preview and with the import; the server keeps nothing in between.
3. **Who may import:** a user with edit permission on the target account, of any kind (bank, manual, savings). A hidden account answers 404, a read-only one 403. No import into a new account in 0.3: the wizard asks for an existing one.
4. **Preview:** counts only (new, already in Saldo, unreadable), no per-row list of probable duplicates.
5. **Duplicate rule:** exact content match, count-aware, both at import and in the sync; fuzzy matching (a day apart, similar names) is left to 0.5-4.
6. **Referentie is not a dedupe key:** it is unknown whether it is unique per row and how it relates to the bank's entry reference. It is kept in the stored raw row.

## To verify with real data
- The delimiter, date format and amount format of a real Argenta `.csv` (only the header layout is known, from a spreadsheet view).
- Whether Boekdatum equals the booking date the sync stores. If not, duplicates remain where an import overlaps the synced period; there is no undo until 0.5.
- Where the merchant name lives (Naam tegenpartij or Beschrijving), and whether Mededeling is often empty. The suggestion maps Naam tegenpartij to the counterparty and Mededeling to the communication.
- **Referentie, Boekdatum and the text columns against the sync.** A checklist on the live add-on:
  1. Pick one transaction that is both in the Argenta CSV and already synced into Saldo (same date, amount and counterparty).
  2. Read the CSV's `Referentie` for it.
  3. Read Saldo's stored `external_id` for the same transaction. The add-on keeps its SQLite database at `/data/saldo.db`: open a copy taken from a Home Assistant backup with any SQLite viewer (never edit the live file) and run `SELECT external_id, booking_date, amount, counterparty_name, communication FROM transactions WHERE account_id = ? AND booking_date = ? AND amount = ?;` with the account id, the date (`yyyy-mm-dd`) and the amount in cents (negative for a payment).
  4. Compare the two values on three or more transactions. Outcomes:
     - Equal on all: add a `Referentie` mapping field so imported rows get the sync's own key `ref:<IBAN>:<Referentie>`; that dedupes exactly in both directions, and the content rule stays as the fallback.
     - Different, but unique and stable per transaction: only useful to tell identical purchases apart between imports, not against the sync.
     - Repeated, empty or unstable: ignore Referentie for good.
  5. On the same rows, compare Boekdatum with the stored `booking_date`, and Naam tegenpartij and Mededeling with the stored `counterparty_name` and `communication` (case and surrounding spaces aside). The content rule needs date, amount, counterparty and communication all equal; any mismatch means an import that overlaps the synced period stores those transactions twice. That is what the preview's overlap warning is for, and there is no undo until 0.5.
- **Beschrijving stays raw-only** (the user's decision): it is kept in the stored raw row and not mapped to a field.
- **A "€" in Munt** is accepted only if a real export shows it; until then only `EUR` is.

## Not in 0.3-6
Category mapping, undo, probable-duplicate matching and the import cutoff, the Bilance preset, and import into a new account. All in [0.5](../v0.5-bilance-import/README.md).

Deliberately cut: the manual choice of delimiter, encoding, date format and decimal separator that the mockup shows. They are detected (delimiter from the header line or Excel's `sep=` line, UTF-8 or Windows-1252, the date formats listed, the decimal separator per amount column); after a wrong guess the user saves the file again as CSV (UTF-8) with `;`.
