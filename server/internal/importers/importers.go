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
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

// Limits. The HTTP layer reuses MaxFileBytes for its upload limit.
const (
	MaxFileBytes          = 5 << 20 // 5 MiB, years of household history
	MaxRows               = 20000   // data rows, blank lines not counted
	MaxColumns            = 64
	MaxCellRunes          = 1000 // a longer cell makes its row an error
	MaxCounterpartyRunes  = 140  // longer names are truncated (SEPA name length)
	MaxCommunicationRunes = 500  // longer communications are truncated
	maxHeaderRunes        = 100  // longer headers are truncated
)

// NoColumn marks a Mapping field that is not mapped.
const NoColumn = -1

// Preset names for Parsed.Preset; "" is the generic suggestion.
const PresetArgenta = "argenta"

// Mapping names the column index (0-based) of each field, or NoColumn.
// Date and Amount are required; a column can serve one field only.
type Mapping struct {
	Date             int // booking date
	ValueDate        int
	Amount           int
	Counterparty     int
	CounterpartyIBAN int
	Communication    int
	Account          int // the file's own account
	Currency         int
}

// Row is one parsed data row; Line is its first line in the file (1-based).
// Account is the file's own account as a valid, normalised IBAN, "" when
// the column is not mapped or the cell is empty.
type Row struct {
	Line    int
	Account string
	Tx      bank.Transaction
}

// RowError is a data row that could not be read. Message is Dutch and does
// not contain the cell text.
type RowError struct {
	Line    int
	Message string
}

// Parsed is the result of Inspect (no Rows or Errors) or Parse.
type Parsed struct {
	Delimiter rune
	Headers   []string // cleaned, unique, "Kolom N" for an empty header
	Mapping   Mapping  // the suggestion (Inspect) or the one used (Parse)
	Preset    string   // PresetArgenta or "" (generic)
	TotalRows int      // data rows, readable or not
	Rows      []Row
	Errors    []RowError
	Sample    [][]string // the first three readable data rows, cleaned cells
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
// suggested mapping and preset, the row count and a sample.
func Inspect(data []byte) (Parsed, error) {
	t, err := readTable(data)
	if err != nil {
		return Parsed{}, err
	}
	return t.parsed(), nil
}

// Parse reads every data row with the given mapping. today (YYYY-MM-DD) is
// the latest allowed booking date.
func Parse(data []byte, m Mapping, today string) (Parsed, error) {
	if _, err := time.Parse(time.DateOnly, today); err != nil {
		return Parsed{}, fmt.Errorf("importers: invalid today %q", today)
	}
	t, err := readTable(data)
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

	for _, r := range t.records {
		if r.err != "" {
			p.Errors = append(p.Errors, RowError{Line: r.line, Message: r.err})
			continue
		}
		row, msg := parseRow(r.cells, t.headers, m, dec, today)
		if msg != "" {
			p.Errors = append(p.Errors, RowError{Line: r.line, Message: msg})
			continue
		}
		row.Line = r.line
		p.Rows = append(p.Rows, row)
	}
	return p, nil
}

func parseRow(cells, headers []string, m Mapping, dec byte, today string) (Row, string) {
	get := func(i int) string {
		if i == NoColumn {
			return ""
		}
		return cells[i]
	}
	date, msg := checkDate(get(m.Date), today)
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
	// An unreadable value date or counterparty IBAN is dropped: neither is required.
	valueDate, _ := parseDate(get(m.ValueDate))
	raw := make(map[string]string, len(cells))
	for i, c := range cells {
		raw[headers[i]] = c
	}
	rawJSON, _ := json.Marshal(raw) // a map of strings always marshals
	return Row{Account: account, Tx: bank.Transaction{
		BookingDate:      date,
		ValueDate:        valueDate,
		Amount:           amount,
		Currency:         "EUR",
		CounterpartyName: capRunes(get(m.Counterparty), MaxCounterpartyRunes),
		CounterpartyIBAN: validIBAN(get(m.CounterpartyIBAN)),
		Communication:    capRunes(get(m.Communication), MaxCommunicationRunes),
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
	for _, i := range []int{m.Date, m.ValueDate, m.Amount, m.Counterparty, m.CounterpartyIBAN, m.Communication, m.Account, m.Currency} {
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
			p.Sample = append(p.Sample, r.cells)
		}
	}
	return p
}
