// Package importers turns an uploaded CSV file (untrusted bytes) into bank
// transactions for the import pipeline (phase 0.3-6). It only parses: no
// database, no HTTP, no dedupe. The rows it returns are meant for the same
// path as a sync (ledger.Keyed, ledger.InsertTransactions).
//
// Two calls serve the wizard: Inspect for the mapping step (delimiter,
// headers, a suggested mapping, a sample) and Parse for the rows once the
// mapping is confirmed. Rows keep the file order; a row that cannot be read
// becomes a RowError with a Dutch message that never repeats the cell text.
//
// Cell text is stored as data and never interpreted or evaluated here.
// Whatever later exports it to a spreadsheet or echoes it into one must
// neutralise formulas: prefix a cell that starts with = + - @ tab or CR
// with an apostrophe.
package importers

import (
	"cmp"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

// Limits. The HTTP layer reuses MaxFileBytes for its upload limit.
const (
	MaxFileBytes          = 20 << 20 // 20 MiB, a full Bilance history (0.5-2; 5 MiB before)
	MaxRows               = 100000   // data rows, blank lines not counted
	MaxColumns            = 64
	MaxCellRunes          = 1000 // a longer cell makes its row an error
	MaxCounterpartyRunes  = 140  // longer names are truncated (SEPA name length)
	MaxCommunicationRunes = 500  // longer communications are truncated
	MaxNoteRunes          = 200  // longer notes are truncated, like a note typed in Transacties
	maxAccountNameRunes   = 100  // a longer account name makes its row an error
	maxHeaderRunes        = 100  // longer headers are truncated
	MaxAccountNames       = 50   // distinct account names; more means the wrong column
	MaxCategoryPairs      = 500  // distinct category pairs; more means the wrong column
)

// NoColumn marks a Mapping field that is not mapped.
const NoColumn = -1

// Preset names for Parsed.Preset; "" is the generic suggestion.
const (
	PresetArgenta = "argenta"
	PresetBilance = "bilance"
)

// Encodings an Options.Encoding may name, and Parsed.Encoding reports.
const (
	EncodingUTF8        = "utf-8"
	EncodingWindows1252 = "windows-1252"
)

// Options overrides what Inspect and Parse detect; the zero value detects
// everything. The HTTP layer checks the values against fixed lists.
type Options struct {
	Delimiter  rune   // ';' ',' or a tab
	Encoding   string // EncodingUTF8 or EncodingWindows1252
	DateFormat string // "dmy", "mdy" or "ymd"; "" reads dd/mm/yyyy and yyyy-mm-dd as found
	Decimal    byte   // ',' or '.'; decides an amount such as "1.234" that does not show its own
}

func firstOptions(o []Options) Options {
	if len(o) == 0 {
		return Options{}
	}
	return o[0]
}

// Mapping names the column index (0-based) of each field, or NoColumn.
// Date and Amount are required; a column can serve one field only.
type Mapping struct {
	Date             int // booking date
	ValueDate        int
	Amount           int
	Counterparty     int
	CounterpartyIBAN int
	Communication    int
	Account          int // the file's own account, an IBAN: a guard
	Currency         int
	// Added in 0.5-2.
	Note                 int
	Category             int // Bilance: Categorie
	Subcategory          int // Bilance: Subcategorie
	AccountName          int // accounts from a column: the name of the file's account
	CounterpartyFallback int // used when the Counterparty cell is empty
}

func (m Mapping) columns() []int {
	return []int{m.Date, m.ValueDate, m.Amount, m.Counterparty, m.CounterpartyIBAN, m.Communication, m.Account, m.Currency,
		m.Note, m.Category, m.Subcategory, m.AccountName, m.CounterpartyFallback}
}

// Row is one parsed data row; Line is its first line in the file (1-based).
// Account is the file's own account as a valid, normalised IBAN, "" when
// the column is not mapped or the cell is empty. AccountName, Category and
// Subcategory are the cells as read (the two category parts are never
// joined), "" when not mapped or empty.
type Row struct {
	Line        int
	Account     string
	AccountName string
	Category    string
	Subcategory string
	Note        string
	Tx          bank.Transaction
}

// RowError is a data row that could not be read. Message is Dutch and does
// not contain the cell text.
type RowError struct {
	Line    int
	Message string
}

// AccountCount is a distinct account name of the file with its readable rows.
type AccountCount struct {
	Name string
	Rows int
}

// CategoryCount is a distinct (Categorie, Subcategorie) pair with its
// readable rows and their total in cents; both "" is "no category".
type CategoryCount struct {
	Category, Subcategory string
	Rows                  int
	Total                 int64
}

// Parsed is the result of Inspect (no Rows, Errors or counts) or Parse.
type Parsed struct {
	Delimiter  rune
	Encoding   string   // EncodingUTF8 or EncodingWindows1252, as read
	Headers    []string // cleaned, unique, "Kolom N" for an empty header
	Mapping    Mapping  // the suggestion (Inspect) or the one used (Parse)
	Preset     string   // PresetArgenta, PresetBilance or "" (generic)
	TotalRows  int      // data rows, readable or not
	Rows       []Row
	Errors     []RowError
	Sample     [][]string      // the first three readable data rows, cleaned cells
	Accounts   []AccountCount  // Parse: by name, when AccountName is mapped
	Categories []CategoryCount // Parse: by pair, when Category or Subcategory is mapped
}

// ReadUpload reads an upload up to MaxFileBytes and refuses anything larger
// without reading further.
func ReadUpload(r io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxFileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxFileBytes {
		return nil, errTooLarge
	}
	return data, nil
}

// Inspect reads the file for the mapping step: delimiter, headers, the
// suggested mapping and preset, the row count and a sample. opts (at most
// one) overrides what it detects.
func Inspect(data []byte, opts ...Options) (Parsed, error) {
	t, err := readTable(data, firstOptions(opts))
	if err != nil {
		return Parsed{}, err
	}
	return t.parsed(), nil
}

// Parse reads every data row with the given mapping. today (YYYY-MM-DD) is
// the latest allowed booking date. opts (at most one) overrides what it
// detects.
func Parse(data []byte, m Mapping, today string, opts ...Options) (Parsed, error) {
	opt := firstOptions(opts)
	if _, err := time.Parse(time.DateOnly, today); err != nil {
		return Parsed{}, fmt.Errorf("importers: invalid today %q", today)
	}
	t, err := readTable(data, opt)
	if err != nil {
		return Parsed{}, err
	}
	if err := m.check(len(t.headers)); err != nil {
		return Parsed{}, err
	}
	p := t.parsed()
	p.Mapping = m

	var cells []string
	for _, r := range t.records {
		if r.err == "" {
			cells = append(cells, r.cells[m.Amount])
		}
	}
	dec := fileDecimal(cells)
	if opt.Decimal != 0 {
		dec = opt.Decimal
	}

	accounts := map[string]*AccountCount{}
	categories := map[[2]string]*CategoryCount{}
	for _, r := range t.records {
		if r.err != "" {
			p.Errors = append(p.Errors, RowError{Line: r.line, Message: r.err})
			continue
		}
		row, msg := parseRow(r.cells, t.headers, m, dec, today, opt.DateFormat)
		if msg != "" {
			p.Errors = append(p.Errors, RowError{Line: r.line, Message: msg})
			continue
		}
		row.Line = r.line
		p.Rows = append(p.Rows, row)
		if m.AccountName != NoColumn {
			if accounts[row.AccountName] == nil {
				if len(accounts) == MaxAccountNames {
					return Parsed{}, errTooManyNames
				}
				accounts[row.AccountName] = &AccountCount{Name: row.AccountName}
			}
			accounts[row.AccountName].Rows++
		}
		if m.Category != NoColumn || m.Subcategory != NoColumn {
			pair := [2]string{row.Category, row.Subcategory}
			if categories[pair] == nil {
				if len(categories) == MaxCategoryPairs {
					return Parsed{}, errTooManyCategories
				}
				categories[pair] = &CategoryCount{Category: row.Category, Subcategory: row.Subcategory}
			}
			categories[pair].Rows++
			categories[pair].Total += row.Tx.Amount
		}
	}
	for _, a := range accounts {
		p.Accounts = append(p.Accounts, *a)
	}
	slices.SortFunc(p.Accounts, func(a, b AccountCount) int { return strings.Compare(a.Name, b.Name) })
	for _, c := range categories {
		p.Categories = append(p.Categories, *c)
	}
	slices.SortFunc(p.Categories, func(a, b CategoryCount) int {
		return cmp.Or(strings.Compare(a.Category, b.Category), strings.Compare(a.Subcategory, b.Subcategory))
	})
	return p, nil
}

func parseRow(cells, headers []string, m Mapping, dec byte, today, dateFormat string) (Row, string) {
	get := func(i int) string {
		if i == NoColumn {
			return ""
		}
		return cells[i]
	}
	date, msg := checkDate(get(m.Date), today, dateFormat)
	if msg != "" {
		return Row{}, msg
	}
	// Multi-currency is out of scope (analysis money-and-format); empty is EUR.
	if c := get(m.Currency); c != "" && !strings.EqualFold(c, "EUR") {
		return Row{}, "Alleen bedragen in euro worden ondersteund."
	}
	amount, msg := parseAmount(get(m.Amount), dec)
	if msg != "" {
		return Row{}, msg
	}
	account := validIBAN(get(m.Account))
	if account == "" && get(m.Account) != "" {
		return Row{}, "De rekening in het bestand is geen geldig IBAN."
	}
	// "Rekening(en)" may be a list: more than one account in a cell is refused, not guessed.
	name := get(m.AccountName)
	switch {
	case m.AccountName == NoColumn:
	case name == "":
		return Row{}, "Rekeningnaam ontbreekt."
	case strings.ContainsAny(name, ",;"):
		return Row{}, "Een cel met meer dan één rekening wordt niet ondersteund."
	case utf8.RuneCountInString(name) > maxAccountNameRunes:
		return Row{}, "Rekeningnaam is te lang."
	}
	// An unreadable value date or counterparty IBAN is dropped: neither is required.
	valueDate, _ := parseDate(get(m.ValueDate), dateFormat)
	raw := make(map[string]string, len(cells))
	for i, c := range cells {
		raw[headers[i]] = c
	}
	rawJSON, _ := json.Marshal(raw) // a map of strings always marshals
	counterparty := get(m.Counterparty)
	if counterparty == "" {
		counterparty = get(m.CounterpartyFallback)
	}
	return Row{Account: account, AccountName: name, Category: get(m.Category), Subcategory: get(m.Subcategory),
		Note: capRunes(get(m.Note), MaxNoteRunes), Tx: bank.Transaction{
			BookingDate:      date,
			ValueDate:        valueDate,
			Amount:           amount,
			Currency:         "EUR",
			CounterpartyName: capRunes(counterparty, MaxCounterpartyRunes),
			CounterpartyIBAN: validIBAN(get(m.CounterpartyIBAN)),
			Communication:    capRunes(cardSafe(get(m.Communication)), MaxCommunicationRunes),
			Status:           bank.StatusBooked,
			Raw:              rawJSON,
		}}, ""
}

// check validates the mapping against the number of columns.
func (m Mapping) check(columns int) error {
	if m.Date == NoColumn || m.Amount == NoColumn {
		return apperr.Invalid("Kies een kolom voor de datum en een voor het bedrag.")
	}
	used := map[int]bool{}
	for _, i := range m.columns() {
		if i == NoColumn {
			continue
		}
		if i < 0 || i >= columns {
			return apperr.Invalid("De koppeling verwijst naar een kolom die niet bestaat.")
		}
		if used[i] {
			return apperr.Invalid("Elke kolom kan maar voor één veld dienen.")
		}
		used[i] = true
	}
	return nil
}

func (t *table) parsed() Parsed {
	p := Parsed{
		Delimiter: t.delim,
		Encoding:  t.encoding,
		Headers:   t.headers,
		Mapping:   suggest(t.headers),
		Preset:    detectPreset(t.headers),
		TotalRows: len(t.records),
	}
	for _, r := range t.records {
		if len(p.Sample) == 3 {
			break
		}
		if r.err == "" {
			row := slices.Clone(r.cells)
			for i, c := range row {
				row[i] = cardSafe(c) // the sample goes to the browser
			}
			p.Sample = append(p.Sample, row)
		}
	}
	return p
}
