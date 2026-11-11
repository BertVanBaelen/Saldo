package importers

import (
	"strings"
	"unicode"
)

// aliases lists, per field and in order of preference, the header names that
// suggest it (Dutch, English and a few French ones for Belgian exports),
// written as normaliseHeader returns them. A booking date wins over a value
// date for the date field.
var aliases = []struct {
	field func(*Mapping) *int
	names []string
}{
	{func(m *Mapping) *int { return &m.Date }, []string{
		"boekingsdatum", "boekdatum", "booking date", "datum", "date", "transactiedatum", "transaction date",
		"verrichtingsdatum", "datum verrichting", "uitvoeringsdatum", "date comptable", "date d execution",
		"valutadatum", "value date", "date valeur"}},
	{func(m *Mapping) *int { return &m.ValueDate }, []string{
		"valutadatum", "valuta", "value date", "rentedatum", "date valeur"}},
	{func(m *Mapping) *int { return &m.Amount }, []string{
		"bedrag", "bedrag eur", "bedrag in eur", "amount", "amount eur", "montant", "montant eur"}},
	{func(m *Mapping) *int { return &m.Counterparty }, []string{
		"naam tegenpartij", "tegenpartij", "naam van de tegenpartij", "naam begunstigde", "begunstigde",
		"counterparty", "counterparty name", "payee", "name", "naam", "nom de la contrepartie", "contrepartie", "handelaar"}},
	{func(m *Mapping) *int { return &m.CounterpartyIBAN }, []string{
		"rekening tegenpartij", "rekeningnummer tegenpartij", "iban tegenpartij", "tegenrekening",
		"counterparty iban", "counterparty account", "iban", "compte contrepartie", "compte de la contrepartie"}},
	{func(m *Mapping) *int { return &m.Communication }, []string{
		"mededeling", "mededelingen", "vrije mededeling", "gestructureerde mededeling", "communicatie",
		"communication", "omschrijving", "beschrijving", "description", "details", "remittance information", "memo",
		"betalingskenmerk"}},
	// Exact names only, so "rekening tegenpartij" never suggests the own account.
	{func(m *Mapping) *int { return &m.Account }, []string{"rekening", "rekeningnummer", "account"}},
	{func(m *Mapping) *int { return &m.Currency }, []string{"munt", "currency", "devise"}},
	// Bilance (0.5-2): the account is a name, the title backs up an empty merchant.
	{func(m *Mapping) *int { return &m.Note }, []string{"notitie", "note", "notes", "opmerking"}},
	{func(m *Mapping) *int { return &m.Category }, []string{"categorie", "category"}},
	{func(m *Mapping) *int { return &m.Subcategory }, []string{"subcategorie", "subcategory"}},
	{func(m *Mapping) *int { return &m.AccountName }, []string{"rekening en", "rekeningnaam", "account name"}},
	{func(m *Mapping) *int { return &m.CounterpartyFallback }, []string{"titel", "title"}},
}

// suggest maps each field to the first header that matches its aliases,
// never giving a column to two fields.
func suggest(headers []string) Mapping {
	m := Mapping{NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn, NoColumn,
		NoColumn, NoColumn, NoColumn, NoColumn, NoColumn}
	norm := make([]string, len(headers))
	for i, h := range headers {
		norm[i] = normaliseHeader(h)
	}
	taken := map[int]bool{}
	for _, a := range aliases {
	names:
		for _, name := range a.names {
			for i, h := range norm {
				if h == name && !taken[i] {
					*a.field(&m) = i
					taken[i] = true
					break names
				}
			}
		}
	}
	return m
}

// argentaHeaders must all be present, in any order and with any delimiter,
// for a file to count as an Argenta export. The real export has 11 columns:
// Rekening, Boekdatum, Valutadatum, Referentie, Beschrijving, Bedrag, Munt,
// Verrichtingsdatum, Rekening tegenpartij, Naam tegenpartij, Mededeling
// (seen in a spreadsheet view: delimiter, date and amount formats are not
// verified). The preset only names the source; its mapping is the generic
// suggestion.
var argentaHeaders = []string{"boekdatum", "valutadatum", "referentie", "bedrag", "munt", "naam tegenpartij", "mededeling"}

// bilanceHeaders must all be present for a Bilance export (spike S2, read from
// one real file): Titel, Datum, Bedrag, Categorie, Subcategorie, Tag(s),
// Betalingskenmerk, Handelaar, Rekening(en), Notitie. Tag(s) and Notitie may
// be missing. Its mapping is the generic suggestion too, through the aliases.
var bilanceHeaders = []string{"titel", "datum", "bedrag", "categorie", "subcategorie", "betalingskenmerk", "handelaar", "rekening en"}

func detectPreset(headers []string) string {
	have := map[string]bool{}
	for _, h := range headers {
		have[normaliseHeader(h)] = true
	}
	for _, p := range []struct {
		name    string
		headers []string
	}{{PresetArgenta, argentaHeaders}, {PresetBilance, bilanceHeaders}} {
		if hasAll(have, p.headers) {
			return p.name
		}
	}
	return ""
}

func hasAll(have map[string]bool, names []string) bool {
	for _, h := range names {
		if !have[h] {
			return false
		}
	}
	return true
}

// normaliseHeader lower-cases, removes accents and turns every run of other
// characters into one space: "Naam  tegenpartij:" and "Bedrag (EUR)" become
// "naam tegenpartij" and "bedrag eur".
func normaliseHeader(h string) string {
	h = accents.Replace(strings.ToLower(h))
	return strings.Join(strings.FieldsFunc(h, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}), " ")
}

var accents = strings.NewReplacer(
	"à", "a", "á", "a", "â", "a", "ä", "a", "ç", "c", "è", "e", "é", "e", "ê", "e", "ë", "e",
	"ì", "i", "í", "i", "î", "i", "ï", "i", "ñ", "n", "ò", "o", "ó", "o", "ô", "o", "ö", "o",
	"ù", "u", "ú", "u", "û", "u", "ü", "u", "ÿ", "y",
)
