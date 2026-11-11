package importers

import (
	"bytes"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"os"
	"runtime"
	"slices"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

// All data here is invented. BE68539007547034 is a documentation IBAN.

const today = "2026-06-15"

var simple = Mapping{Date: 0, ValueDate: NoColumn, Amount: 1, Counterparty: 2, CounterpartyIBAN: NoColumn, Communication: 3, Account: NoColumn, Currency: NoColumn, Note: NoColumn, Category: NoColumn, Subcategory: NoColumn, AccountName: NoColumn, CounterpartyFallback: NoColumn}

func invalidMessage(t *testing.T, err error) string {
	t.Helper()
	var inv *apperr.InvalidError
	if !errors.As(err, &inv) {
		t.Fatalf("err = %v, want an apperr.InvalidError", err)
	}
	return inv.Message
}

// argentaHeader is the real Argenta export's header line (column names
// only; no data was seen), with a delimiter placeholder.
var argentaHeader = []string{"Rekening", "Boekdatum", "Valutadatum", "Referentie", "Beschrijving", "Bedrag", "Munt",
	"Verrichtingsdatum", "Rekening tegenpartij", "Naam tegenpartij", "Mededeling"}

// argentaMapping is the suggestion for the 11 Argenta columns. Referentie (3),
// Beschrijving (4) and Verrichtingsdatum (7) stay unmapped.
var argentaMapping = Mapping{Account: 0, Date: 1, ValueDate: 2, Amount: 5, Currency: 6,
	CounterpartyIBAN: 8, Counterparty: 9, Communication: 10, Note: NoColumn, Category: NoColumn, Subcategory: NoColumn, AccountName: NoColumn, CounterpartyFallback: NoColumn}

func TestArgentaFixture(t *testing.T) {
	data, err := os.ReadFile("testdata/argenta-synthetic.csv")
	if err != nil {
		t.Fatal(err)
	}
	in, err := Inspect(data)
	if err != nil {
		t.Fatal(err)
	}
	if in.Preset != PresetArgenta || in.Delimiter != ';' || in.Mapping != argentaMapping || in.TotalRows != 3 || len(in.Sample) != 3 || in.Rows != nil ||
		strings.Join(in.Headers, "|") != strings.Join(argentaHeader, "|") {
		t.Fatalf("Inspect = %+v", in)
	}
	p, err := Parse(data, in.Mapping, today)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Errors) != 0 || len(p.Rows) != 3 {
		t.Fatalf("Parse rows %d errors %+v", len(p.Rows), p.Errors)
	}
	got := p.Rows[0]
	if got.Line != 2 || got.Account != "BE68539007547034" || got.Tx.BookingDate != "2026-06-02" || got.Tx.ValueDate != "2026-06-03" || got.Tx.Amount != -6412 ||
		got.Tx.CounterpartyName != "Voorbeeldwinkel Noord" || got.Tx.CounterpartyIBAN != "BE71096123456769" ||
		got.Tx.Communication != "Aankoop fictief" || got.Tx.Currency != "EUR" || got.Tx.Status != bank.StatusBooked || got.Tx.EntryReference != "" {
		t.Fatalf("row 0 = %+v", got)
	}
	if p.Rows[1].Tx.Amount != 125000 || p.Rows[1].Tx.CounterpartyIBAN != "" {
		t.Fatalf("row 1 = %+v", p.Rows[1])
	}
	// The blank line is skipped; the fake IBAN is dropped; the quoted delimiter stays in the cell.
	if r := p.Rows[2]; r.Line != 5 || r.Tx.CounterpartyIBAN != "" || r.Tx.Communication != "Drankje; met vrienden" {
		t.Fatalf("row 2 = %+v", r)
	}
	// Every cell is kept in the raw payload, the unmapped ones too.
	var raw map[string]string
	if err := json.Unmarshal(got.Tx.Raw, &raw); err != nil {
		t.Fatal(err)
	}
	if len(raw) != 11 || raw["Bedrag"] != "-64,12" || raw["Referentie"] != "TEST-REF-0001" || raw["Beschrijving"] != "Betaling Bancontact" ||
		raw["Verrichtingsdatum"] != "01/06/2026" || raw["Munt"] != "EUR" || raw["Rekening"] != "BE68 5390 0754 7034" {
		t.Fatalf("raw = %v", raw)
	}
}

// The preset comes from the header set alone, whatever the delimiter, and
// does not force a decimal comma.
func TestArgentaPresetDelimiters(t *testing.T) {
	row := []string{"BE68 5390 0754 7034", "02/06/2026", "02/06/2026", "R1", "Betaling", "-1234.5", "eur", "01/06/2026", "", "Test Winkel", ""}
	for _, d := range []string{";", "\t", ","} {
		data := strings.Join(argentaHeader, d) + "\n" + strings.Join(row, d) + "\n"
		p, err := Parse([]byte(data), argentaMapping, today)
		if err != nil {
			t.Fatal(err)
		}
		in, _ := Inspect([]byte(data))
		if in.Preset != PresetArgenta || in.Mapping != argentaMapping || string(p.Delimiter) != d || len(p.Rows) != 1 || p.Rows[0].Tx.Amount != -123450 {
			t.Errorf("delimiter %q: preset %q mapping %+v rows %+v errors %+v", d, in.Preset, in.Mapping, p.Rows, p.Errors)
		}
	}
}

// TestCurrencyAndAccount checks the guards on the Munt and Rekening columns;
// their errors never repeat the cell.
func TestCurrencyAndAccount(t *testing.T) {
	m := Mapping{Date: 0, ValueDate: NoColumn, Amount: 1, Counterparty: NoColumn, CounterpartyIBAN: NoColumn, Communication: NoColumn, Account: 2, Currency: 3, Note: NoColumn, Category: NoColumn, Subcategory: NoColumn, AccountName: NoColumn, CounterpartyFallback: NoColumn}
	data := "Datum;Bedrag;Rekening;Munt\n" +
		"02/01/2026;1;BE68 5390 0754 7034;EUR\n" + // 2 ok
		"02/01/2026;1;be68539007547034;eur\n" + // 3 ok, lower case
		"02/01/2026;1;;\n" + // 4 ok, empty account and currency
		"02/01/2026;1;BE68 5390 0754 7034;GBP\n" + // 5 other currency
		"02/01/2026;1;BE68 5390 0754 7035;EUR\n" + // 6 bad checksum
		"02/01/2026;1;123-4567890-12;EUR\n" // 7 not an IBAN
	p, err := Parse([]byte(data), m, today)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Rows) != 3 || p.Rows[0].Account != "BE68539007547034" || p.Rows[1].Account != "BE68539007547034" || p.Rows[2].Account != "" ||
		p.Rows[0].Tx.Currency != "EUR" || p.Rows[2].Tx.Currency != "EUR" {
		t.Fatalf("rows %+v", p.Rows)
	}
	want := []RowError{{5, "Alleen bedragen in euro worden ondersteund."}, {6, "De rekening in het bestand is geen geldig IBAN."},
		{7, "De rekening in het bestand is geen geldig IBAN."}}
	if !slices.Equal(p.Errors, want) {
		t.Fatalf("errors %+v", p.Errors)
	}
	// Unmapped, the columns are not checked.
	m.Account, m.Currency = NoColumn, NoColumn
	if p, _ := Parse([]byte(data), m, today); len(p.Rows) != 6 || p.Rows[3].Account != "" {
		t.Fatalf("unmapped: %+v", p)
	}
}

func TestPresetAndSuggestion(t *testing.T) {
	cases := []struct {
		name, file string
		preset     string
		want       Mapping
	}{
		{"generic english, comma", "Date,Amount,Payee,Description\n2026-01-02,12.50,A,B\n", "",
			Mapping{0, NoColumn, 1, 2, NoColumn, 3, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}},
		{"accents, case and punctuation", "BEDRAG (EUR);Omschrijving;Date d'exécution\n1;x;02/01/2026\n", "",
			Mapping{2, NoColumn, 0, NoColumn, NoColumn, 1, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}},
		{"value date only becomes the date", "Valutadatum;Bedrag\n02/01/2026;1\n", "",
			Mapping{0, NoColumn, 1, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}},
		{"booking date wins, value date kept", "Valutadatum;Bedrag;Boekingsdatum\n02/01/2026;1;02/01/2026\n", "",
			Mapping{2, 0, 1, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}},
		{"argenta-like but comma separated", "Boekingsdatum,Bedrag,Naam tegenpartij,Mededeling\n02/01/2026,1,a,b\n", "",
			Mapping{0, NoColumn, 1, 2, NoColumn, 3, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}},
		{"argenta-like without mededeling", "Boekingsdatum;Bedrag;Naam tegenpartij\n02/01/2026;1;a\n", "",
			Mapping{0, NoColumn, 1, 2, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}},
		{"argenta core headers missing: generic, own account and currency suggested", "Rekening;Mededeling;Verrichtingsdatum;Bedrag;Munt;Naam tegenpartij\nx;b;02/01/2026;1;EUR;a\n", "",
			Mapping{2, NoColumn, 3, 5, NoColumn, 1, 0, 4, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}},
		{"argenta, other column order, comma separated", "Mededeling,Munt,Naam tegenpartij,Bedrag,Referentie,Valutadatum,Boekdatum\nb,EUR,a,1,r,02/01/2026,02/01/2026\n", PresetArgenta,
			Mapping{6, 5, 3, 2, NoColumn, 0, NoColumn, 1, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}},
		{"english own account and currency", "Date,Amount,Account,Currency,Counterparty account\n2026-01-02,1,x,EUR,y\n", "",
			Mapping{0, NoColumn, 1, NoColumn, 4, NoColumn, 2, 3, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}},
		{"rekening tegenpartij alone is not the own account", "Datum;Bedrag;Rekening tegenpartij\n02/01/2026;1;x\n", "",
			Mapping{0, NoColumn, 1, NoColumn, 2, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}},
		{"nothing recognised", "foo;bar\n1;2\n", "",
			Mapping{NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, err := Inspect([]byte(c.file))
			if err != nil {
				t.Fatal(err)
			}
			if p.Preset != c.preset || p.Mapping != c.want {
				t.Fatalf("preset %q mapping %+v, want %q %+v", p.Preset, p.Mapping, c.preset, c.want)
			}
		})
	}
}

func TestDecodeAndDelimiters(t *testing.T) {
	cases := []struct {
		name  string
		data  []byte
		delim rune
		cp    string // counterparty of the first row
	}{
		{"utf-8 bom", []byte("\xEF\xBB\xBFDatum;Bedrag;Naam;Mededeling\n02/01/2026;1;Café Één;x\n"), ';', "Café Één"},
		{"windows-1252", []byte("Datum;Bedrag;Naam;Mededeling\r\n02/01/2026;1;Caf\xe9 \x80 \x96;x\r\n"), ';', "Café € –"},
		{"old mac line endings", []byte("Datum;Bedrag;Naam;Mededeling\r02/01/2026;1;A;x\r"), ';', "A"},
		{"tab", []byte("Datum\tBedrag\tNaam\tMededeling\n02/01/2026\t1\tA\tx\n"), '\t', "A"},
		{"comma, quoted comma amount", []byte("Datum,Bedrag,Naam,Mededeling\n02/01/2026,\"-1,50\",\"A, B\",x\n"), ',', "A, B"},
		{"quoted newline in a cell", []byte("Datum;Bedrag;Naam;Mededeling\n02/01/2026;1;\"A\nB\";x\n"), ';', "A B"},
		{"control characters removed", []byte("Datum;Bedrag;Naam;Mededeling\n02/01/2026;1;A\x07B​;x\n"), ';', "AB​"},
		{"blank lines everywhere", []byte("\n\n  \nDatum;Bedrag;Naam;Mededeling\n\n;;;\n02/01/2026;1;A;x\n\n"), ';', "A"},
		{"excel sep line", []byte("sep=;\r\nDatum;Bedrag;Naam;Mededeling\r\n02/01/2026;1;A, B;x\r\n"), ';', "A, B"},
		{"excel sep line, comma", []byte("\xEF\xBB\xBFsep=,\nDatum,Bedrag,Naam,Mededeling\n02/01/2026,1,A;B,x\n"), ',', "A;B"},
		{"excel sep line, tab", []byte("sep=\t\nDatum\tBedrag\tNaam\tMededeling\n02/01/2026\t1\tA\tx\n"), '\t', "A"},
		{"quoted multi-line cell full of delimiters", []byte("Datum;Bedrag;Naam;Mededeling\n02/01/2026;1;A;\"" +
			strings.Repeat(";", 50) + "\n" + strings.Repeat(";", 50) + "\"\"x\"\n"), ';', "A"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, err := Parse(c.data, simple, today)
			if err != nil {
				t.Fatal(err)
			}
			if p.Delimiter != c.delim || len(p.Rows) != 1 || len(p.Errors) != 0 || p.Rows[0].Tx.CounterpartyName != c.cp {
				t.Fatalf("got delim %q rows %+v errors %+v", p.Delimiter, p.Rows, p.Errors)
			}
		})
	}
}

func TestFileErrors(t *testing.T) {
	big := bytes.Repeat([]byte("a"), MaxFileBytes+1)
	var many strings.Builder
	many.WriteString("Datum;Bedrag\n")
	for range MaxRows + 1 {
		many.WriteString("02/01/2026;1\n")
	}
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"empty", nil, "leeg"},
		{"only white space", []byte(" \r\n\n"), "leeg"},
		{"header only", []byte("Datum;Bedrag\n\n"), "alleen een kopregel"},
		{"NUL byte", []byte("Datum;Bedrag\n02/01/2026;\x001\n"), "geen tekstbestand"},
		{"utf-16 le bom", []byte("\xFF\xFED\x00;\x00a\x00\n\x00"), "UTF-16"},
		{"utf-16 be bom", []byte("\xFE\xFF\x00D\x00;\x00a\x00\n"), "UTF-16"},
		{"utf-16 le, no bom", []byte("D\x00;\x00a\x00\n\x00"), "UTF-16"},
		{"utf-16 be, no bom", []byte("\x00D\x00;\x00a\x00\n"), "UTF-16"},
		{"control characters", []byte("\x01\x02\x03\x04;\x05\n\x06;\x07\n"), "geen tekstbestand"},
		{"no delimiter", []byte("Datum\n02/01/2026\n"), "scheidingsteken"},
		{"too large", big, "groter dan 20 MB"},
		{"too many rows", []byte(many.String()), "meer dan 100000 regels"},
		{"too many columns", []byte(strings.Repeat("a;", MaxColumns) + "a\n1\n"), "kolommen"},
		{"broken header", []byte("Datum;\"Bed\"rag\n02/01/2026;1\n"), "kopregel"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := Inspect(c.data)
			if msg := invalidMessage(t, err); !strings.Contains(msg, c.want) {
				t.Fatalf("message %q, want it to contain %q", msg, c.want)
			}
			if _, err := Parse(c.data, simple, today); err == nil {
				t.Fatal("Parse accepted it")
			}
		})
	}
}

func TestExactlyMaxRows(t *testing.T) {
	var b strings.Builder
	b.WriteString("Datum;Bedrag\n")
	for range MaxRows {
		b.WriteString("02/01/2026;1\n")
	}
	p, err := Inspect([]byte(b.String()))
	if err != nil || p.TotalRows != MaxRows {
		t.Fatalf("TotalRows %d, err %v", p.TotalRows, err)
	}
}

// The sep= line is not the header, and lines keep their numbers in the file.
func TestExcelSepLine(t *testing.T) {
	p, err := Parse([]byte("sep=;\nDatum;Bedrag;Naam;Mededeling\n02/01/2026;1;A;x\nnooit;1;A;x\n"), simple, today)
	if err != nil || p.Headers[0] != "Datum" || len(p.Rows) != 1 || p.Rows[0].Line != 3 || len(p.Errors) != 1 || p.Errors[0].Line != 4 {
		t.Fatalf("%+v %v", p, err)
	}
	// Only the exact line counts.
	if p, err := Inspect([]byte("sep=; \nDatum;Bedrag\n1;2\n")); err != nil || p.Headers[0] != "sep=" {
		t.Fatalf("%+v %v", p, err)
	}
}

// A data line with millions of fields is refused before encoding/csv builds
// it as one record (about 200 MB for 5 MiB of ";a"), also after a quote
// error that could hide it from a naive quote scan.
func TestTooManyFieldsInADataLine(t *testing.T) {
	wide := strings.Repeat(";a", (MaxFileBytes-200)/2)
	for name, data := range map[string]string{
		"plain":                 "Datum;Bedrag\n02/01/2026;1\n" + wide + "\n",
		"after a bare quote":    "Datum;Bedrag\n02/01/2026;1\"\n" + wide + "\n",
		"after a quote error":   "Datum;Bedrag\n\"02/01/2026\"x;1\n" + wide + "\n",
		"after leading spaces":  "Datum;Bedrag\n02/01/2026;1\n" + strings.Repeat("; \"a\"", MaxColumns+1) + "\n",
		"just over, at the end": "Datum;Bedrag\n02/01/2026;1\n" + strings.Repeat(";", MaxColumns+1) + "\n",
	} {
		t.Run(name, func(t *testing.T) {
			b := []byte(data)
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			_, err := Inspect(b)
			runtime.ReadMemStats(&after)
			if msg := invalidMessage(t, err); !strings.Contains(msg, "kolommen") {
				t.Fatalf("message %q", msg)
			}
			if n := after.TotalAlloc - before.TotalAlloc; n > 5*MaxFileBytes {
				t.Errorf("allocated %d MB", n>>20)
			}
		})
	}
	// Exactly MaxColumns delimiters (a trailing one on 64 columns) still reads.
	ok := strings.Repeat("a;", MaxColumns-1) + "a\n" + strings.Repeat("1;", MaxColumns) + "\n"
	if _, err := Inspect([]byte(ok)); err != nil {
		t.Fatal(err)
	}
}

func TestReadUpload(t *testing.T) {
	if _, err := ReadUpload(bytes.NewReader(make([]byte, MaxFileBytes+10))); err == nil {
		t.Fatal("oversized upload accepted")
	}
	if b, err := ReadUpload(strings.NewReader("a;b")); err != nil || string(b) != "a;b" {
		t.Fatalf("%q %v", b, err)
	}
}

func TestMappingChecks(t *testing.T) {
	data := []byte("Datum;Bedrag;Naam\n02/01/2026;1;A\n")
	for _, m := range []Mapping{
		{NoColumn, NoColumn, 1, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn},
		{0, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn},
		{0, NoColumn, 3, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn},
		{0, NoColumn, 1, -2, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn},
		{0, NoColumn, 1, 1, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn},
		{0, NoColumn, 1, NoColumn, NoColumn, NoColumn, 0, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn},
		{0, NoColumn, 1, NoColumn, NoColumn, NoColumn, NoColumn, 3, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn},
		{0, NoColumn, 1, NoColumn, NoColumn, NoColumn, 2, 2, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn},
		{},
	} {
		if _, err := Parse(data, m, today); err == nil {
			t.Errorf("mapping %+v accepted", m)
		}
	}
	if _, err := Parse(data, simple, "15/06/2026"); err == nil {
		t.Error("invalid today accepted")
	}
}

// TestRowErrors checks the per-row errors, their line numbers and that they
// never repeat the cell text.
func TestRowErrors(t *testing.T) {
	data := "Datum;Bedrag;Naam;Mededeling\n" +
		"02/01/2026;1;A;x\n" + // 2 ok
		"02/01/2026;1;SECRET1\n" + // 3 too few fields
		"02/01/2026;1;A;x;SECRET2\n" + // 4 too many fields
		"02/01/2026;1;A;x;;\n" + // 5 trailing empty cells: ok
		"02/01/2026;1;SE\"CRET3;x\n" + // 6 bare quote
		"SECRET4;1;A;x\n" + // 7 bad date
		"02/01/2026;SECRET5;A;x\n" + // 8 bad amount
		"02/01/2026;1;" + strings.Repeat("S", MaxCellRunes+1) + ";x\n" + // 9 over-long cell
		"03/01/2026;2;B;\"unclosed SECRET6\n" + // 10 unbalanced quote swallows the rest
		"04/01/2026;3;C;x\n"
	p, err := Parse([]byte(data), simple, today)
	if err != nil {
		t.Fatal(err)
	}
	var lines []int
	for _, r := range p.Rows {
		lines = append(lines, r.Line)
	}
	if len(lines) != 2 || lines[0] != 2 || lines[1] != 5 {
		t.Fatalf("row lines %v", lines)
	}
	wantErr := []int{3, 4, 6, 7, 8, 9, 10}
	if len(p.Errors) != len(wantErr) || p.TotalRows != len(p.Rows)+len(p.Errors) {
		t.Fatalf("errors %+v, total %d", p.Errors, p.TotalRows)
	}
	for i, e := range p.Errors {
		if e.Line != wantErr[i] || e.Message == "" || strings.Contains(e.Message, "SECRET") || strings.Contains(e.Message, "SSS") {
			t.Errorf("error %d = %+v", i, e)
		}
	}
}

func TestDates(t *testing.T) {
	cases := []struct{ in, want string }{
		{"02/06/2026", "2026-06-02"},
		{"2/6/2026", "2026-06-02"},
		{"02-06-2026", "2026-06-02"},
		{"02.06.2026", "2026-06-02"},
		{"2026-06-02", "2026-06-02"},
		{"29/02/2024", "2024-02-29"},
		{"15/06/2026", "2026-06-15"}, // today itself
		{"01/01/1990", "1990-01-01"},
		{"16/06/2026", ""}, // tomorrow
		{"31/12/1989", ""},
		{"29/02/2026", ""},
		{"31/04/2026", ""},
		{"00/01/2026", ""},
		{"01/13/2026", ""},
		{"02/06/26", ""},
		{"2026/06/02", ""},
		{"02/06-2026", ""},
		{"2026-06-02 00:00:00.000", "2026-06-02"}, // Bilance: the time is ignored
		{"02/06/2026 10:00", "2026-06-02"},
		{"02/06/2026 10", ""},
		{"20260602", ""},
		{"", ""},
		{"vandaag", ""},
	}
	for _, c := range cases {
		got, msg := checkDate(c.in, today, "")
		if got != c.want || (c.want == "") == (msg == "") {
			t.Errorf("checkDate(%q) = %q, %q; want %q", c.in, got, msg, c.want)
		}
	}
}

func TestAmounts(t *testing.T) {
	const bad = int64(-1 << 62)
	cases := []struct {
		in   string
		dec  byte
		want int64
	}{
		{"1.234,56", 0, 123456},
		{"1,234.56", 0, 123456},
		{"-12,50", 0, -1250},
		{"+1.250,00", 0, 125000},
		{"12.50", 0, 1250},
		{"12,5", 0, 1250},
		{"12", 0, 1200},
		{"0,00", 0, 0},
		{"€ 12,50", 0, 1250},
		{"€ 12,50", 0, 1250}, // cleanText turns the no-break space into a space first
		{"EUR 12,50", 0, 1250},
		{"12,50 EUR", 0, 1250},
		{"-€ 12,50", 0, -1250},
		{"€ -12,50", 0, -1250},
		{"12,50-", 0, -1250},
		{"−12,50", 0, -1250},
		{"1.234.567", 0, 123456700},
		{"1.234.567,89", 0, 123456789},
		{"12,500", 0, bad}, // ambiguous without a file decision
		{"1,234", 0, bad},
		{"1.234", 0, bad},
		{"1.234", ',', 123400},
		{"1,234", ',', bad}, // three decimals
		{"1,230", ',', 123},
		{"1,234", '.', 123400},
		{"1.230", '.', 123},
		{"12,5000", 0, 1250},
		{"12,501", 0, bad},
		{"", 0, bad},
		{"€", 0, bad},
		{"NaN", 0, bad},
		{"1e5", 0, bad},
		{"--12", 0, bad},
		{"-12-", 0, bad},
		{"+-12", 0, bad},
		{"1-2", 0, bad},
		{"12,", 0, bad},
		{",5", 0, bad},
		{"1.,5", 0, bad},
		{"12.34.56", 0, bad},
		{"1234.567,00", 0, bad},
		{"1 234,56", 0, bad},
		{"90071992547409,91", 0, 9007199254740991}, // Number.MAX_SAFE_INTEGER cents
		{"-90071992547409,91", 0, -9007199254740991},
		{"90071992547409,92", 0, bad},
		{"-90071992547409,92", 0, bad},
		{"9999999999999999,99", 0, bad},
		{"99999999999999999,99", 0, bad},
		{"92233720368547758,08", 0, bad},
	}
	for _, c := range cases {
		got, msg := parseAmount(cleanText(c.in), c.dec)
		if c.want == bad {
			if msg == "" {
				t.Errorf("parseAmount(%q, %q) = %d, want an error", c.in, c.dec, got)
			}
			continue
		}
		if msg != "" || got != c.want {
			t.Errorf("parseAmount(%q, %q) = %d, %q; want %d", c.in, c.dec, got, msg, c.want)
		}
	}
}

func TestFileDecimal(t *testing.T) {
	cases := []struct {
		cells []string
		want  byte
	}{
		{[]string{"1.234", "-12,50"}, ','},
		{[]string{"1,234", "12.50"}, '.'},
		{[]string{"1.234", "12"}, 0},
		{[]string{"12,50", "12.50"}, 0},
		{[]string{"1.234.567"}, ','},
		{nil, 0},
	}
	for _, c := range cases {
		if got := fileDecimal(c.cells); got != c.want {
			t.Errorf("fileDecimal(%q) = %q, want %q", c.cells, got, c.want)
		}
	}
	// Through Parse: other rows decide "1.234".
	p, err := Parse([]byte("Datum;Bedrag\n02/01/2026;1.234\n02/01/2026;-3,50\n"), Mapping{0, NoColumn, 1, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}, today)
	if err != nil || len(p.Rows) != 2 || p.Rows[0].Tx.Amount != 123400 {
		t.Fatalf("%+v %v", p, err)
	}
}

func TestTextCapsAndIBAN(t *testing.T) {
	long := strings.Repeat("é", MaxCommunicationRunes+20)
	data := "Datum;Bedrag;Naam;Mededeling;IBAN\n02/01/2026;1;" + strings.Repeat("n", MaxCounterpartyRunes+5) + ";" + long + "; be68 5390-0754 7034 \n"
	p, err := Parse([]byte(data), Mapping{0, NoColumn, 1, 2, 4, 3, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}, today)
	if err != nil || len(p.Rows) != 1 {
		t.Fatalf("%+v %v", p, err)
	}
	tx := p.Rows[0].Tx
	if len([]rune(tx.CounterpartyName)) != MaxCounterpartyRunes || len([]rune(tx.Communication)) != MaxCommunicationRunes || tx.CounterpartyIBAN != "BE68539007547034" {
		t.Fatalf("tx = %+v", tx)
	}
	for _, in := range []string{"BE00 0000 0000 0000", "BE68 •••• •••• 7034", "735-0123456-12", "BE69539007547034", "12345678901234567"} {
		if got := validIBAN(in); got != "" {
			t.Errorf("validIBAN(%q) = %q", in, got)
		}
	}
}

func TestHeadersAreUniqueKeys(t *testing.T) {
	p, err := Parse([]byte("Datum;Bedrag;;Naam;Naam\n02/01/2026;1;x;A;B\n"), Mapping{0, NoColumn, 1, 3, NoColumn, 4, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}, today)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(p.Headers, "|") != "Datum|Bedrag|Kolom 3|Naam|Naam (2)" {
		t.Fatalf("headers %q", p.Headers)
	}
	var raw map[string]string
	if err := json.Unmarshal(p.Rows[0].Tx.Raw, &raw); err != nil || raw["Naam (2)"] != "B" || raw["Kolom 3"] != "x" {
		t.Fatalf("raw %s %v", p.Rows[0].Tx.Raw, err)
	}
}

func TestSampleAndOrder(t *testing.T) {
	var b strings.Builder
	b.WriteString("Datum;Bedrag\n")
	b.WriteString("bad;1\n")
	for _, d := range []string{"05", "01", "09", "03", "07"} {
		b.WriteString(d + "/01/2026;1\n")
	}
	p, err := Inspect([]byte(b.String()))
	if err != nil {
		t.Fatal(err)
	}
	// Inspect does not parse values: the bad date row is still a sample row.
	if p.TotalRows != 6 || len(p.Sample) != 3 || p.Sample[0][0] != "bad" {
		t.Fatalf("%+v", p)
	}
	full, err := Parse([]byte(b.String()), p.Mapping, today)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, r := range full.Rows {
		got = append(got, r.Tx.BookingDate[8:])
	}
	if strings.Join(got, ",") != "05,01,09,03,07" || len(full.Errors) != 1 || full.Errors[0].Line != 2 {
		t.Fatalf("order %v errors %+v", got, full.Errors)
	}
}

// TestGarbage feeds random bytes and mutated CSV and only asserts no panic.
func TestGarbage(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	alphabet := []byte("0123456789;,\t\"\n\r.-+€/ aZé\x00\x01\xff\x80")
	for range 3000 {
		n := r.IntN(300)
		data := make([]byte, n)
		for i := range data {
			if r.IntN(4) == 0 {
				data[i] = byte(r.IntN(256))
			} else {
				data[i] = alphabet[r.IntN(len(alphabet))]
			}
		}
		check(data)
	}
}

func FuzzParse(f *testing.F) {
	f.Add([]byte("Datum;Bedrag;Naam;Mededeling\n02/01/2026;-1.234,56;A;\"x\"\"y\"\n"))
	f.Add([]byte("\xEF\xBB\xBFdate,amount\n2026-01-02,\"1,234.5\"\n"))
	f.Add([]byte("a\tb\n\"\n"))
	f.Fuzz(func(t *testing.T, data []byte) { check(data) })
}

func check(data []byte) {
	p, err := Inspect(data)
	if err != nil {
		return
	}
	m := p.Mapping
	m.Date, m.Amount = 0, len(p.Headers)-1
	if m.Date == m.Amount {
		return
	}
	m.ValueDate, m.Counterparty, m.CounterpartyIBAN, m.Communication, m.Account, m.Currency = NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn
	_, _ = Parse(data, m, today)
}

// A Bilance export (spike S2, all values invented): ", " between fields,
// quoted text, dates with a time, amounts like -170.00€, two category columns.
const bilanceHeader = "Titel, Datum, Bedrag, Categorie, Subcategorie, Tag(s), Betalingskenmerk, Handelaar, Rekening(en), Notitie\n"

const cardText = "Voorbeeld Winkel |.| 02-06-2026 |.| 14:35 |.| Antwerpen |.| BE |.| 0000********0000 |.| 5411 |.| Jan Voorbeeld"

func TestBilance(t *testing.T) {
	file := bilanceHeader +
		`"Voorbeeld Winkel", 2026-06-02 00:00:00.000, -170.00€, "Eten & Drinken", "Boodschappen", , "` + cardText + `", "Voorbeeld   Winkel  Antwerpen", "Zichtrekening", "Voor het weekend"` + "\n" +
		`"Loon Test", 2026-06-03 00:00:00.000, +1250.00€, "Inkomen", "Loon, premies", , "+++123/4567/89012+++", , "Spaarrekening", ` + "\n" +
		`"Kaart Test", 2026-06-04 00:00:00.000, abc€, "Wonen", "Huur, hypotheek", , "` + cardText + `", "Kaart Test", "Zichtrekening", ` + "\n" +
		`"Kaart Raar", 2026-06-05 00:00:00.000, -5.00€, , , , "Raar Winkel |.| geen datum |.| Jan Voorbeeld", "Raar Winkel", "Zichtrekening, Contant", ` + "\n"
	in, err := Inspect([]byte(file))
	if err != nil {
		t.Fatal(err)
	}
	want := Mapping{Date: 1, ValueDate: NoColumn, Amount: 2, Counterparty: 7, CounterpartyIBAN: NoColumn, Communication: 6, Account: NoColumn, Currency: NoColumn,
		Note: 9, Category: 3, Subcategory: 4, AccountName: 8, CounterpartyFallback: 0}
	if in.Preset != PresetBilance || in.Delimiter != ',' || in.Encoding != EncodingUTF8 || in.Mapping != want || in.TotalRows != 4 {
		t.Fatalf("Inspect = %+v", in)
	}
	for _, row := range in.Sample { // the sample goes to the browser
		for _, c := range row {
			if strings.Contains(c, "Jan Voorbeeld") || strings.Contains(c, "0000****") {
				t.Fatalf("card holder or number in the sample: %q", c)
			}
		}
	}
	if in.Sample[0][6] != "Voorbeeld Winkel 02-06-2026 Antwerpen" {
		t.Errorf("sample card = %q", in.Sample[0][6])
	}

	p, err := Parse([]byte(file), in.Mapping, today)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Rows) != 2 || len(p.Errors) != 2 {
		t.Fatalf("rows %d errors %+v", len(p.Rows), p.Errors)
	}
	r := p.Rows[0]
	if r.Line != 2 || r.Tx.BookingDate != "2026-06-02" || r.Tx.Amount != -17000 || r.Tx.CounterpartyName != "Voorbeeld Winkel Antwerpen" ||
		r.Tx.Communication != "Voorbeeld Winkel 02-06-2026 Antwerpen" || r.Note != "Voor het weekend" ||
		r.AccountName != "Zichtrekening" || r.Category != "Eten & Drinken" || r.Subcategory != "Boodschappen" || r.Account != "" {
		t.Fatalf("row 0 = %+v", r)
	}
	// The card holder and number stay in the raw payload only.
	if !bytes.Contains(r.Tx.Raw, []byte("Jan Voorbeeld")) {
		t.Error("raw payload lost the original cell")
	}
	r = p.Rows[1]
	if r.Tx.Amount != 125000 || r.Tx.CounterpartyName != "Loon Test" || r.Tx.Communication != "+++123/4567/89012+++" ||
		r.AccountName != "Spaarrekening" || r.Subcategory != "Loon, premies" || r.Note != "" {
		t.Fatalf("row 1 = %+v", r)
	}
	// Bad amount, and a cell with two accounts: row errors, never the cell text.
	for i, line := range []int{4, 5} {
		e := p.Errors[i]
		if e.Line != line || strings.Contains(e.Message, "Jan Voorbeeld") || strings.Contains(e.Message, "0000") {
			t.Errorf("error %d = %+v", i, e)
		}
	}
	if p.Errors[0].Message != "Bedrag is ongeldig." || !strings.Contains(p.Errors[1].Message, "meer dan één rekening") {
		t.Errorf("errors = %+v", p.Errors)
	}
	if len(p.Accounts) != 2 || p.Accounts[0] != (AccountCount{"Spaarrekening", 1}) || p.Accounts[1] != (AccountCount{"Zichtrekening", 1}) ||
		len(p.Categories) != 2 || p.Categories[0] != (CategoryCount{"Eten & Drinken", "Boodschappen", 1, -17000}) {
		t.Errorf("accounts %+v categories %+v", p.Accounts, p.Categories)
	}
}

// A card string of another shape keeps its merchant only.
func TestCardSafe(t *testing.T) {
	for in, want := range map[string]string{
		cardText: "Voorbeeld Winkel 02-06-2026 Antwerpen",
		"Voorbeeld Winkel |.| geen datum |.| Jan Voorbeeld":                         "Voorbeeld Winkel",
		"Voorbeeld Winkel |.| 02-06-2026 |.| 14:35 |.| Antwerpen |.| Jan Voorbeeld": "Voorbeeld Winkel",
		"+++123/4567/89012+++": "+++123/4567/89012+++",
	} {
		if got := cardSafe(in); got != want {
			t.Errorf("cardSafe(%q) = %q, want %q", in, got, want)
		}
	}
}

// The overrides replace what is detected.
func TestOptions(t *testing.T) {
	data := []byte("Datum;Bedrag\n02/06/2026;1.234\n")
	m := Mapping{Date: 0, ValueDate: NoColumn, Amount: 1, Counterparty: NoColumn, CounterpartyIBAN: NoColumn, Communication: NoColumn, Account: NoColumn, Currency: NoColumn,
		Note: NoColumn, Category: NoColumn, Subcategory: NoColumn, AccountName: NoColumn, CounterpartyFallback: NoColumn}
	p, err := Parse(data, m, today, Options{DateFormat: "mdy", Decimal: ','})
	if err != nil || len(p.Rows) != 1 || p.Rows[0].Tx.BookingDate != "2026-02-06" || p.Rows[0].Tx.Amount != 123400 {
		t.Fatalf("%+v %v", p, err)
	}
	if p, _ := Parse(data, m, today, Options{Decimal: '.'}); len(p.Rows) != 0 || len(p.Errors) != 1 {
		t.Fatalf("a dot decimal read 1.234 as %+v", p.Rows)
	}
	// Forced Windows-1252 reads UTF-8 bytes as separate characters; a forced delimiter wins.
	in, err := Inspect([]byte("Datum,Bedrag\n02/06/2026,é\n"), Options{Encoding: EncodingWindows1252, Delimiter: ','})
	if err != nil || in.Encoding != EncodingWindows1252 || in.Delimiter != ',' || in.Sample[0][1] != "Ã©" {
		t.Fatalf("%+v %v", in, err)
	}
}
