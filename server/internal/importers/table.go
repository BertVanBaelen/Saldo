package importers

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
)

var (
	errTooLarge       = apperr.Invalid("Het bestand is groter dan 20 MB.")
	errEmpty          = apperr.Invalid("Het bestand is leeg.")
	errNoRows         = apperr.Invalid("Het bestand bevat alleen een kopregel, geen transacties.")
	errBinary         = apperr.Invalid("Dit is geen tekstbestand. Kies een CSV-bestand.")
	errUTF16          = apperr.Invalid("Dit bestand is opgeslagen als UTF-16. Sla het op als CSV (UTF-8) en probeer opnieuw.")
	errNoDelimiter    = apperr.Invalid("Geen scheidingsteken gevonden. Gebruik een CSV-bestand met puntkomma, komma of tab.")
	errTooManyRows    = apperr.Invalid(fmt.Sprintf("Het bestand heeft meer dan %d regels. Splits het in kleinere bestanden.", MaxRows))
	errTooManyColumns = apperr.Invalid(fmt.Sprintf("Het bestand heeft meer dan %d kolommen.", MaxColumns))

	errTooManyNames      = apperr.Invalid(fmt.Sprintf("Het bestand heeft meer dan %d verschillende rekeningnamen. Controleer de kolom die je als rekeningnaam koos.", MaxAccountNames))
	errTooManyCategories = apperr.Invalid(fmt.Sprintf("Het bestand heeft meer dan %d verschillende categorieën. Controleer de kolommen die je als categorie koos.", MaxCategoryPairs))
)

// record is one data row: its cleaned cells, or a Dutch error.
type record struct {
	line  int
	cells []string
	err   string
}

type table struct {
	delim    rune
	encoding string
	headers  []string
	records  []record
}

// readTable decodes the file, finds the delimiter and the header row (the
// first non-blank row) and reads every data row. Blank rows are skipped.
func readTable(data []byte, opt Options) (*table, error) {
	if len(data) > MaxFileBytes {
		return nil, errTooLarge
	}
	text, encoding, err := decode(data, opt.Encoding)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(text) == "" {
		return nil, errEmpty
	}
	delim := excelSep(&text)
	if opt.Delimiter != 0 {
		delim = opt.Delimiter
	} else if delim == 0 {
		delim = detectDelimiter(text)
	}
	if delim == 0 {
		return nil, errNoDelimiter
	}
	// encoding/csv builds a whole record before the column check can run.
	// Bilance writes ", " between fields, also before a quote; a tab delimiter must keep its empty fields.
	trim := !unicode.IsSpace(delim)
	if tooManyFields(text, byte(delim), trim) {
		return nil, errTooManyColumns
	}

	r := csv.NewReader(strings.NewReader(text))
	r.Comma = delim
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = trim
	t := &table{delim: delim, encoding: encoding}
	for {
		fields, err := r.Read()
		if err == io.EOF {
			break
		}
		var pe *csv.ParseError
		if errors.As(err, &pe) {
			if t.headers == nil {
				return nil, apperr.Invalid("De kopregel kon niet gelezen worden: controleer de aanhalingstekens.")
			}
			if err := t.add(record{line: pe.StartLine, err: quoteMessage(pe.Err)}); err != nil {
				return nil, err
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		line, _ := r.FieldPos(0)
		cells := make([]string, len(fields))
		blank := true
		for i, f := range fields {
			cells[i] = cleanText(f)
			blank = blank && cells[i] == ""
		}
		if blank {
			continue
		}
		if t.headers == nil {
			if len(cells) > MaxColumns {
				return nil, errTooManyColumns
			}
			t.headers = uniqueHeaders(cells)
			continue
		}
		if err := t.add(t.check(line, cells)); err != nil {
			return nil, err
		}
	}
	if len(t.records) == 0 {
		return nil, errNoRows
	}
	return t, nil
}

func (t *table) add(r record) error {
	if len(t.records) == MaxRows {
		return errTooManyRows
	}
	t.records = append(t.records, r)
	return nil
}

// check turns a data row into a record. Extra empty cells at the end (a
// trailing delimiter) are tolerated; any other field count is an error.
func (t *table) check(line int, cells []string) record {
	for len(cells) > len(t.headers) && cells[len(cells)-1] == "" {
		cells = cells[:len(cells)-1]
	}
	if len(cells) != len(t.headers) {
		return record{line: line, err: fmt.Sprintf("Deze regel heeft %d velden in plaats van %d.", len(cells), len(t.headers))}
	}
	for _, c := range cells {
		if utf8.RuneCountInString(c) > MaxCellRunes {
			return record{line: line, err: fmt.Sprintf("Een veld is langer dan %d tekens.", MaxCellRunes)}
		}
	}
	return record{line: line, cells: cells}
}

func quoteMessage(err error) string {
	if errors.Is(err, csv.ErrBareQuote) {
		return "Aanhalingsteken op een onverwachte plaats."
	}
	return "Aanhalingstekens kloppen niet vanaf deze regel; de regels erna kunnen in dit veld terechtgekomen zijn."
}

// uniqueHeaders names empty headers "Kolom N" and numbers duplicates, so each
// header is a distinct key of the raw payload.
func uniqueHeaders(cells []string) []string {
	out := make([]string, len(cells))
	seen := map[string]bool{}
	for i, c := range cells {
		h := capRunes(c, maxHeaderRunes)
		if h == "" {
			h = "Kolom " + strconv.Itoa(i+1)
		}
		for n := 2; seen[h]; n++ {
			h = capRunes(c, maxHeaderRunes) + " (" + strconv.Itoa(n) + ")"
		}
		seen[h] = true
		out[i] = h
	}
	return out
}

// decode returns the file as UTF-8 text with "\n" line endings, and the
// encoding it read. It strips a UTF-8 BOM, keeps valid UTF-8 and reads
// anything else as Windows-1252, unless enc forces one of the two (invalid
// UTF-8 then becomes U+FFFD). A NUL byte or more than 2% control characters
// means it is not a text file.
func decode(data []byte, enc string) (string, string, error) {
	data = bytes.TrimPrefix(data, []byte("\xEF\xBB\xBF"))
	// A UTF-16 BOM, or a NUL in exactly one of the first two bytes (an ASCII
	// character in UTF-16 without a BOM).
	if bytes.HasPrefix(data, []byte{0xFF, 0xFE}) || bytes.HasPrefix(data, []byte{0xFE, 0xFF}) ||
		len(data) >= 2 && (data[0] == 0) != (data[1] == 0) {
		return "", "", errUTF16
	}
	ctrl := 0
	for _, b := range data {
		switch {
		case b == 0:
			return "", "", errBinary
		case b == '\t' || b == '\n' || b == '\r':
		case b < 0x20 || b == 0x7F:
			ctrl++
		}
	}
	if ctrl*50 > len(data) {
		return "", "", errBinary
	}
	var text string
	name := EncodingUTF8
	if enc == EncodingWindows1252 || enc == "" && !utf8.Valid(data) {
		name = EncodingWindows1252
		var b strings.Builder
		b.Grow(len(data) + len(data)/4)
		for _, c := range data {
			if c >= 0x80 && c < 0xA0 {
				b.WriteRune(cp1252[c-0x80])
			} else {
				b.WriteRune(rune(c)) // ASCII and Latin-1 0xA0-0xFF are the same code points
			}
		}
		text = b.String()
	} else {
		text = strings.ToValidUTF8(string(data), "\uFFFD")
	}
	return strings.NewReplacer("\r\n", "\n", "\r", "\n").Replace(text), name, nil
}

// cp1252 maps Windows-1252 bytes 0x80-0x9F; undefined bytes become U+FFFD.
var cp1252 = [32]rune{
	'€', '�', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '�', 'Ž', '�',
	'�', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '�', 'ž', 'Ÿ',
}

// excelSep reads Excel's optional first line "sep=;" (or "sep=," or
// "sep=" and a tab): it returns that delimiter and blanks the line, keeping
// the line numbers of the file. It returns 0 when there is no such line.
func excelSep(text *string) rune {
	rest := strings.TrimLeft(*text, " \n")
	line, _, _ := strings.Cut(rest, "\n")
	if line != "sep=;" && line != "sep=," && line != "sep=\t" {
		return 0
	}
	at := len(*text) - len(rest)
	*text = (*text)[:at] + (*text)[at+len(line):]
	return rune(line[4])
}

// tooManyFields reports a record with more than MaxColumns delimiters. It
// scans like encoding/csv (trim: with TrimLeadingSpace): a quote opens a field only at its start, a quoted
// field may span lines, and a quote error ends the record at the line end.
func tooManyFields(text string, delim byte, trim bool) bool {
	n, start, quoted := 0, true, false
	toLineEnd := func(i int) int { // the index before the next newline
		if j := strings.IndexByte(text[i:], '\n'); j >= 0 {
			return i + j - 1
		}
		return len(text)
	}
	for i := 0; i < len(text); i++ {
		c := text[i]
		switch {
		case quoted:
			if c != '"' {
				continue
			}
			if i+1 < len(text) && text[i+1] == '"' {
				i++
				continue
			}
			quoted = false
			if i+1 < len(text) && text[i+1] != delim && text[i+1] != '\n' {
				i = toLineEnd(i)
			}
		case c == '\n':
			n, start = 0, true
			continue
		case c == delim:
			if n++; n > MaxColumns {
				return true
			}
			start = true
			continue
		case trim && start && c < utf8.RuneSelf && unicode.IsSpace(rune(c)):
			continue // csv.Reader.TrimLeadingSpace skips white space before a quote
		case trim && start && c >= utf8.RuneSelf:
			if r, n := utf8.DecodeRuneInString(text[i:]); unicode.IsSpace(r) {
				i += n - 1
				continue
			}
		case c == '"' && start:
			quoted = true
		case c == '"':
			i = toLineEnd(i)
		}
		start = false
	}
	return false
}

// detectDelimiter counts ; , and tab outside quotes on the first non-blank
// line and returns the most frequent, or 0 when there is none.
// shortcut: looks at the header line only; check more lines if a real
// export ever has a header that fools it.
func detectDelimiter(text string) rune {
	text = strings.TrimLeft(text, " \n")
	counts := map[rune]int{}
	inQuote := false
	for _, c := range text {
		if c == '"' {
			inQuote = !inQuote
		} else if c == '\n' && !inQuote {
			break
		} else if !inQuote {
			counts[c]++
		}
	}
	best := rune(0)
	for _, d := range []rune{';', '\t', ','} { // ties: semicolon first, Belgian exports use it
		if counts[d] > counts[best] {
			best = d
		}
	}
	return best
}
