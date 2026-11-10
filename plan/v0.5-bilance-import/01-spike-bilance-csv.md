# 0.5-1 · Spike S2 · Bilance CSV

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | layout read from a real export (10 Nov 2026); the open points below need a bigger sample before 0.5-2 is final |
| Size | S |
| Features | PLAT-1 |
| Concepts | [import](../../analysis/concepts/import.md), [category](../../analysis/concepts/category.md), [transaction](../../analysis/concepts/transaction.md) |
| Analysis | 4.6, 13.1, risks 1, 10 |
| Depends on | – |

## Goal
Know the exact layout of the Bilance export, so the import is built around the real file.

## Steps
1. Export the full history from Bilance as CSV.
2. Note the columns, the category format (flat or `Parent > Child`), date and amount formats, encoding and separator.
3. Make an anonymised sample (no real names, IBANs or identifying amounts) for tests. Only the sample is committed (public repository).

## Done when
The Bilance preset is known and import and analysis 4.6 are updated.

## Result (10 Nov 2026)
Read from one real export: `bilance_transactions_2026_11_03.csv`, 9 transactions on one date, 2 018 bytes. **The file is never committed** (public repository): it holds a card holder name and a masked card number. Every example below is invented.

| Item | Finding |
|---|---|
| Encoding | UTF-8 without BOM. The `€` is the UTF-8 sequence E2 82 AC |
| Line endings | LF only; no blank line at the end |
| Separator | A comma written as `, ` (comma and space), also in the header. Every field after the first starts with a space |
| Quoting | Text fields are in double quotes; `Datum` and `Bedrag` are not. An empty field is only a space. The last field is empty, so each row ends with `, ` |
| Header | `Titel, Datum, Bedrag, Categorie, Subcategorie, Tag(s), Betalingskenmerk, Handelaar, Rekening(en), Notitie` |
| Datum | `2026-11-02 00:00:00.000`: ISO date and time, no time zone; the time is `00:00:00.000` in every row |
| Bedrag | `-170.00€`: minus sign in front, dot as the decimal separator, `€` glued behind the number. No thousands separator seen |
| Category | Two columns, `Categorie` and `Subcategorie`, not `Parent > Child`. Names contain `&` and commas (for example `Energie, nutsvoorzieningen`), so they are quoted |
| Titel | A short, cleaned display name of the payee |
| Handelaar | The raw merchant text from the bank, padded with spaces (for example `Winkel Voorbeeld   Antwerpen`) |
| Betalingskenmerk | Either a Belgian structured communication, `+++123/4567/89012+++`, or for a card payment one string with `\|.\|` as separator: merchant, date `dd-mm-yyyy`, time `hh:mm`, place, country code, masked card number (`1234********5678`), a four digit merchant category code and the **card holder's name** |
| Rekening(en) | The **name** of the account in Bilance (for example `Zichtrekening`), not an IBAN. There is no IBAN of the counterparty anywhere in the file |
| Tag(s), Notitie | Empty in the sample |
| Sign | Expenses are negative. Incomes are not in the sample |

Categories seen (`Categorie / Subcategorie`): Wonen / Energie, nutsvoorzieningen; Wonen / Huur, hypotheek; Winkelen / Overig; Winkelen / Kleding, accessoires; Eten & Drinken / Boodschappen; Eten & Drinken / Uit eten, bezorging; Gezondheid & Educatie / Wellness, verzorging; Vrije tijd & entertainment / Telefoonkosten. The tree has two levels.

## Not in the sample, still to verify
- Incomes (the sign, a `+`?), amounts of 1 000 or more (a thousands separator?), transfers between your own accounts (how Bilance writes them, in one row or in two), split transactions, tags, notes, a cell with several accounts, a text with a double quote in it, the order of the rows and a time other than `00:00`.
- The size of a full export. 0.3-6 refuses a file over 5 MiB or 20 000 rows; a full history may be larger. Look at the row count and file size of the full export before 0.5-2.
- Whether the full export has the same header (this sample is only one day).

## What this means for 0.5
- **Parser:** the `, ` separator needs leading spaces trimmed, or a quote after a space is a syntax error. Add the date format `yyyy-MM-dd HH:mm:ss.SSS` and an amount with a trailing `€` and a dot decimal to the importers (0.3-6 knows the Belgian `dd/mm/yyyy` and decimal comma).
- **Account:** there is no IBAN, so the IBAN guard of 0.3-6 does not apply. The wizard maps the Bilance account name to a Saldo account ("accounts from a column", 0.5-2 step 2).
- **Categories:** two source columns; map on the full `Categorie / Subcategorie` path, with "map by parent" as designed. The default tree of 0.4-1 should be two levels, and a category name must be allowed to contain commas and `&`.
- **Duplicates are not exact:** `Handelaar` and `Betalingskenmerk` are Bilance's own text, so they will not equal the counterparty and communication the bank sends. The exact match of 0.3-6 will rarely fire on a Bilance row: the fuzzy match of 0.5-4 (booking date ±1 day, same amount, similar counterparty) is the real overlap protection, not an extra.
- **Personal data:** the card payment string holds the card holder's name and a masked card number. Never log or echo it; decide in 0.5-2 whether to store it as the communication, to keep only the merchant and date, or to keep the raw row only in `raw_payload`.
- **Which field is the counterparty:** `Handelaar` (the bank's text, like the sync) or `Titel` (cleaned)? An open decision for 0.5-2.