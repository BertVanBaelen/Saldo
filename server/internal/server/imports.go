package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/auth"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/importers"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/ratelimit"
)

// CSV import (phases 0.3-6 and 0.5-2). The two POST routes are the one
// exception to "JSON only": they take multipart/form-data, read as a stream.

const (
	// importBodyMax caps the whole multipart body: the file plus room for
	// the part headers and the two small fields.
	importBodyMax = importers.MaxFileBytes + 64<<10
	// importTimeout replaces the server's 30 s read timeout for an upload:
	// 20 MB from a phone on a slow uplink can take minutes.
	importTimeout    = 5 * time.Minute
	maxAccountField  = 20 // digits of an int64
	maxMappingField  = 2 << 10
	maxAccountMap    = 8 << 10 // up to importers.MaxAccountNames names
	maxSettingsField = 256
	maxChoicesField  = 256 << 10 // up to importers.MaxCategoryPairs choices
	maxImportErrors  = 20        // row errors in an answer; counts give the total
	msgFileTooLarge  = "Het bestand is groter dan 20 MB."
	msgBadUpload     = "Het bestand kwam niet goed aan. Probeer het opnieuw."
	defaultFileName  = "bestand.csv"
)

// importLimits are the per-user limits of the import routes, and the
// server-wide count of import requests (preview and import) running now.
type importLimits struct {
	preview, run *ratelimit.Limiter
	running      atomic.Int32
}

// maxImportsRunning caps concurrent uploads: each can hold several times
// 20 MB for minutes, too much for a small Home Assistant box.
const maxImportsRunning = 2

// enter takes an import slot, or answers 503 and returns false. Taken before
// the rate limit, so a busy answer costs the user no quota; the caller
// defers leave.
func (l *importLimits) enter(w http.ResponseWriter) bool {
	if l.running.Add(1) > maxImportsRunning {
		l.running.Add(-1)
		writeError(w, http.StatusServiceUnavailable, "unavailable", "Er loopt al een import. Probeer het over een minuut opnieuw.")
		return false
	}
	return true
}

func (l *importLimits) leave() { l.running.Add(-1) }

// mappingBody is a column mapping in JSON: a 0-based column index per
// field, null (or absent) when the field is not mapped. account is the
// file's own account column, currency its currency column.
type mappingBody struct {
	Date             *int `json:"date"`
	ValueDate        *int `json:"valueDate"`
	Amount           *int `json:"amount"`
	Counterparty     *int `json:"counterparty"`
	CounterpartyIBAN *int `json:"counterpartyIban"`
	Communication    *int `json:"communication"`
	Account          *int `json:"account"`
	Currency         *int `json:"currency"`
	// Added in 0.5-2; absent means not mapped, so older clients keep working.
	Note                 *int `json:"note"`
	Category             *int `json:"category"`
	Subcategory          *int `json:"subcategory"`
	AccountName          *int `json:"accountName"`
	CounterpartyFallback *int `json:"counterpartyFallback"`
}

func (b mappingBody) mapping() importers.Mapping {
	col := func(p *int) int {
		if p == nil {
			return importers.NoColumn
		}
		return *p
	}
	return importers.Mapping{Date: col(b.Date), ValueDate: col(b.ValueDate), Amount: col(b.Amount),
		Counterparty: col(b.Counterparty), CounterpartyIBAN: col(b.CounterpartyIBAN), Communication: col(b.Communication),
		Account: col(b.Account), Currency: col(b.Currency), Note: col(b.Note), Category: col(b.Category),
		Subcategory: col(b.Subcategory), AccountName: col(b.AccountName), CounterpartyFallback: col(b.CounterpartyFallback)}
}

func mappingOf(m importers.Mapping) mappingBody {
	col := func(i int) *int {
		if i == importers.NoColumn {
			return nil
		}
		return &i
	}
	return mappingBody{Date: col(m.Date), ValueDate: col(m.ValueDate), Amount: col(m.Amount),
		Counterparty: col(m.Counterparty), CounterpartyIBAN: col(m.CounterpartyIBAN), Communication: col(m.Communication),
		Account: col(m.Account), Currency: col(m.Currency), Note: col(m.Note), Category: col(m.Category),
		Subcategory: col(m.Subcategory), AccountName: col(m.AccountName), CounterpartyFallback: col(m.CounterpartyFallback)}
}

// settingsBody is the manual override of what the parser detects, in JSON;
// an empty or absent value means "as detected". Values come from fixed lists.
type settingsBody struct {
	Delimiter  string `json:"delimiter"`  // ";" "," or a tab
	Encoding   string `json:"encoding"`   // "utf-8" or "windows-1252"
	DateFormat string `json:"dateFormat"` // "dmy", "mdy" or "ymd"
	Decimal    string `json:"decimal"`    // "," or "."
}

func (b settingsBody) options() (o importers.Options, ok bool) {
	if !slices.Contains([]string{"", ";", ",", "\t"}, b.Delimiter) || !slices.Contains([]string{"", importers.EncodingUTF8, importers.EncodingWindows1252}, b.Encoding) ||
		!slices.Contains([]string{"", "dmy", "mdy", "ymd"}, b.DateFormat) || !slices.Contains([]string{"", ",", "."}, b.Decimal) {
		return o, false
	}
	o.Encoding, o.DateFormat = b.Encoding, b.DateFormat
	if b.Delimiter != "" {
		o.Delimiter = rune(b.Delimiter[0])
	}
	if b.Decimal != "" {
		o.Decimal = b.Decimal[0]
	}
	return o, true
}

type rowErrorBody struct {
	Line    int    `json:"line"`
	Message string `json:"message"`
}

type countsBody struct {
	Rows    int `json:"rows"`
	New     int `json:"new"`
	Present int `json:"present"`
	Invalid int `json:"invalid"`
	Overlap int `json:"overlap"`
	// Categorised is how many of the new rows get a category.
	Categorised int `json:"categorised"`
}

type accountNameBody struct {
	Name string `json:"name"`
	Rows int    `json:"rows"`
}

type categoryBody struct {
	Category    string `json:"category"`
	Subcategory string `json:"subcategory"`
	Rows        int    `json:"rows"`
	Total       int64  `json:"total"`
	// Saved is the saved target of the pair for the viewer (categoryId null:
	// leave uncategorised), null when none; Suggestion is a category id
	// guessed by name, null when none. Neither is applied by the server.
	Saved      *savedBody `json:"saved"`
	Suggestion *int64     `json:"suggestion"`
}

type savedBody struct {
	CategoryID *int64 `json:"categoryId"`
}

type previewBody struct {
	FileName   string            `json:"fileName"`
	Delimiter  string            `json:"delimiter"`
	Encoding   string            `json:"encoding"`
	Headers    []string          `json:"headers"`
	Mapping    mappingBody       `json:"mapping"`
	Preset     *string           `json:"preset"`
	TotalRows  int               `json:"totalRows"`
	Sample     [][]string        `json:"sample"`
	Accounts   []accountNameBody `json:"accounts"`
	Categories []categoryBody    `json:"categories"`
	Counts     *countsBody       `json:"counts"`
	Errors     []rowErrorBody    `json:"errors"`
}

type importBody struct {
	Batches     []ledger.Batch `json:"batches"`
	Errors      []rowErrorBody `json:"errors"`
	Categorised int            `json:"categorised"`
}

// upload is a read multipart request.
type upload struct {
	fileName   string
	data       []byte
	accountID  int64                   // 0 when not sent
	accountMap map[string]int64        // file account name -> account id; nil when not sent
	mapping    *importers.Mapping      // nil when not sent
	echo       mappingBody             // the mapping as sent
	options    importers.Options       // the overrides; zero when not sent
	choices    []ledger.CategoryChoice // the category choices; nil when not sent
}

// hasAccount tells whether the upload names where the rows go.
func (u upload) hasAccount() bool { return u.accountID != 0 || u.accountMap != nil }

// postImportPreview inspects a CSV file for the import wizard.
//
// POST /api/imports/preview, multipart/form-data with the parts file
// (required), settings (a JSON object of overrides, keys delimiter,
// encoding, dateFormat, decimal), mapping (a JSON object of column indexes,
// keys date, valueDate, amount, counterparty, counterpartyIban,
// communication, account, currency, note, category, subcategory,
// accountName, counterpartyFallback; null or absent = not mapped) and, with
// the mapping, either accountId or accountMap (a JSON object of file
// account name to account id, for a mapping with accountName). 200 with
// fileName, delimiter, encoding, headers, mapping (the one sent, else the
// suggestion), preset ("argenta", "bilance" or null), totalRows, sample (the
// first three readable rows, cells in header order, IBAN-shaped cells masked,
// card payment strings reduced), accounts and categories (with a mapping:
// the distinct account names and category pairs of the readable rows, with
// their counts), counts and errors. counts ({rows, new, present, invalid,
// overlap}; overlap is how many of the new rows are dated on or after the
// account's earliest synced booked row) and errors (at most 20 {line,
// message}; counts.invalid is the total) come when the mapping and an
// account are sent; an account without the mapping is 400. The counts are
// those of a real import (the same code, rolled back), so they need edit
// access to the accounts: hidden 404, read-only 403. counts null otherwise;
// errors then holds the unreadable rows of the mapping, if any. Each category
// pair also answers saved (the saved target of the viewer) and suggestion (a
// category id by name similarity); with the part categories (the choices of
// POST /api/imports) counts.categorised says how many new rows get a category.
// 60 previews
// per user per hour, then 429 with Retry-After.
// Errors: 415 not multipart, 413 file over 20 MB, 400 a bad file, setting,
// mapping or upload (Dutch message, never cell text).
func (s *Server) postImportPreview(w http.ResponseWriter, r *http.Request) {
	viewer := viewerOf(r)
	if !multipartRequest(w, r) || !s.imports.enter(w) {
		return
	}
	defer s.imports.leave()
	if s.limited(w, r, s.imports.preview, strconv.FormatInt(viewer, 10), "import_preview", viewer) {
		return
	}
	u, ok := readUpload(w, r)
	if !ok {
		return
	}
	if (u.mapping == nil && u.hasAccount()) || (u.accountID != 0 && u.accountMap != nil) {
		writeError(w, http.StatusBadRequest, "invalid", "Stuur de koppeling mee met één rekening of met de koppeling van de rekeningnamen.")
		return
	}
	var p importers.Parsed
	var err error
	if u.mapping == nil {
		p, err = importers.Inspect(u.data, u.options)
	} else {
		p, err = importers.Parse(u.data, *u.mapping, s.today(), u.options)
	}
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	body := previewBody{FileName: u.fileName, Delimiter: string(p.Delimiter), Encoding: p.Encoding, Headers: p.Headers, Mapping: mappingOf(p.Mapping),
		TotalRows: p.TotalRows, Sample: maskSample(p.Sample), Accounts: []accountNameBody{}, Categories: []categoryBody{}, Errors: []rowErrorBody{}}
	for _, a := range p.Accounts {
		body.Accounts = append(body.Accounts, accountNameBody{a.Name, a.Rows})
	}
	if len(p.Categories) > 0 {
		cats, err := s.categoryHints(r, viewer, p)
		if err != nil {
			s.fail(w, r, err, msgNotFound)
			return
		}
		body.Categories = cats
	}
	if u.mapping != nil {
		body.Mapping = u.echo
		body.Errors = rowErrors(p.Errors, nil)
	}
	if p.Preset != "" {
		body.Preset = &p.Preset
	}
	if u.hasAccount() {
		files, plan, err := importFiles(u, p)
		if err != nil {
			s.fail(w, r, err, msgAccountNotFound)
			return
		}
		batches, excluded, err := s.store.ImportFiles(r.Context(), viewer, files, plan, true)
		if err != nil {
			s.fail(w, r, err, msgAccountNotFound)
			return
		}
		body.Counts = &countsBody{Rows: p.TotalRows, Invalid: len(p.Errors)}
		if len(files) > 0 { // the parse errors count on the first part
			body.Counts.Invalid = 0
		}
		for _, b := range batches {
			body.Counts.New += b.Imported
			body.Counts.Present += b.Present
			body.Counts.Invalid += b.Invalid
			body.Counts.Overlap += b.Overlap
			body.Counts.Categorised += b.Categorised
		}
		body.Errors = rowErrors(p.Errors, excluded)
	}
	writeJSON(w, http.StatusOK, body)
}

// postImport imports a CSV file into an account the viewer may edit.
//
// POST /api/imports, multipart/form-data with the parts file, mapping and
// accountId or accountMap (as for the preview), optionally settings and
// categories (a JSON array of choices {category, subcategory, action: map |
// create | skip, categoryId, new: {name, parentId, type, icon, colour}}, one
// per source pair, for a file with category columns; a pair without a choice
// stays uncategorised). The choices are checked and any new categories made
// in the database transaction of the import, and a real import saves them as
// the mapping of the viewer for the source. 201
// {batches, errors, categorised}: one batch per account the rows go to, each {id, source
// ("argenta", "bilance" or "csv"), fileName, accountId, createdAt,
// imported, present, invalid}, errors at most 20 {line, message}. Readable
// rows go in through the sync's dedupe key, so the same file again adds 0
// and counts its rows as present (a new batch all the same); unreadable rows
// are skipped and counted. A row whose file account (the account column)
// is another IBAN than the chosen account's is skipped and counted as
// unreadable, its error showing that IBAN masked. A file without any
// readable row is 400 and stores nothing; 400 with its own message when
// every readable row belongs to another account, or when the chosen account
// has no IBAN and the rows name more than one account. Balances, sync status and connections are never touched.
// Hidden account 404, read-only 403, 20 imports per user per hour then 429;
// other errors as for the preview. Nothing is stored before the whole body
// is read and parsed.
func (s *Server) postImport(w http.ResponseWriter, r *http.Request) {
	viewer := viewerOf(r)
	if !multipartRequest(w, r) || !s.imports.enter(w) {
		return
	}
	defer s.imports.leave()
	if s.limited(w, r, s.imports.run, strconv.FormatInt(viewer, 10), "import", viewer) {
		return
	}
	u, ok := readUpload(w, r)
	if !ok {
		return
	}
	if !u.hasAccount() || u.mapping == nil || (u.accountID != 0 && u.accountMap != nil) {
		writeError(w, http.StatusBadRequest, "invalid", "Kies een rekening en koppel de kolommen.")
		return
	}
	p, err := importers.Parse(u.data, *u.mapping, s.today(), u.options)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	files, plan, err := importFiles(u, p)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	batches, excluded, err := s.store.ImportFiles(r.Context(), viewer, files, plan, false)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	categorised := 0
	for _, b := range batches {
		categorised += b.Categorised
		s.audit(r, auth.EventImportDone, viewer, fmt.Sprintf("account=%d batch=%d imported=%d present=%d invalid=%d",
			b.AccountID, b.ID, b.Imported, b.Present, b.Invalid))
	}
	writeJSON(w, http.StatusCreated, importBody{Batches: batches, Errors: rowErrors(p.Errors, excluded), Categorised: categorised})
}

// listImports answers GET /api/imports: the batches of the accounts the
// viewer holds (read-only ones too), newest first, in the batch shape of
// POST /api/imports; [] when there are none.
func (s *Server) listImports(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Batches(r.Context(), viewerOf(r))
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// today is the latest booking date a file may hold (Brussels; the demo date
// in demo mode).
func (s *Server) today() string { return s.now().In(clock.Brussels).Format(time.DateOnly) }

const msgMapAccounts = "Koppel elke rekeningnaam in het bestand aan een rekening."

// categoryHints answers the category pairs of a parsed file with the saved
// target of the viewer and a name-based suggestion each.
func (s *Server) categoryHints(r *http.Request, viewer int64, p importers.Parsed) ([]categoryBody, error) {
	saved, err := s.store.Mappings(r.Context(), viewer, sourceOf(p))
	if err != nil {
		return nil, err
	}
	tree, err := s.store.Categories(r.Context(), viewer)
	if err != nil {
		return nil, err
	}
	names := map[int64]string{}
	for _, c := range tree {
		names[c.ID] = c.Name
	}
	targets := make([]categorise.Target, len(tree))
	for i, c := range tree {
		targets[i] = categorise.Target{ID: c.ID, Name: c.Name}
		if c.ParentID != nil {
			targets[i].Parent = names[*c.ParentID]
		}
	}
	out := make([]categoryBody, 0, len(p.Categories))
	for _, c := range p.Categories {
		b := categoryBody{Category: c.Category, Subcategory: c.Subcategory, Rows: c.Rows, Total: c.Total}
		if i := slices.IndexFunc(saved, func(m ledger.SavedMapping) bool { return m.Category == c.Category && m.Subcategory == c.Subcategory }); i >= 0 {
			b.Saved = &savedBody{saved[i].CategoryID}
		}
		if id, ok := categorise.SuggestTarget(c.Category, c.Subcategory, targets); ok {
			b.Suggestion = &id
		}
		out = append(out, b)
	}
	return out, nil
}

// sourceOf is the source a parsed file is stored under.
func sourceOf(p importers.Parsed) string {
	if p.Preset == importers.PresetArgenta || p.Preset == importers.PresetBilance {
		return p.Preset
	}
	return "csv"
}

// importFiles splits the readable rows over the accounts they go to: one
// part for the chosen account, or, when the mapping has an account name
// column, one part per name in the order of its first row, each to the
// account accountMap gives it. A name without an account is refused whole,
// and the error never repeats it. The unreadable rows count on the first part.
// The plan holds the category choices for a file with category columns and
// is nil otherwise; choices for a file without such columns are refused.
func importFiles(u upload, p importers.Parsed) ([]ledger.ImportFile, *ledger.CategoryPlan, error) {
	source := sourceOf(p)
	var plan *ledger.CategoryPlan
	if p.Mapping.Category != importers.NoColumn || p.Mapping.Subcategory != importers.NoColumn {
		plan = &ledger.CategoryPlan{Source: source, Choices: u.choices}
	} else if len(u.choices) > 0 {
		return nil, nil, apperr.Invalid("Het bestand heeft geen categoriekolommen om te koppelen.")
	}
	sum := sha256.Sum256(u.data)
	base := ledger.ImportFile{Source: source, FileName: u.fileName, FileHash: hex.EncodeToString(sum[:])}
	var files []ledger.ImportFile
	if p.Mapping.AccountName == importers.NoColumn {
		if u.accountID == 0 {
			return nil, nil, apperr.Invalid("Kies een rekening.")
		}
		base.AccountID = u.accountID
		files = []ledger.ImportFile{base}
	} else if u.accountMap == nil {
		return nil, nil, apperr.Invalid(msgMapAccounts)
	}
	part := map[string]int{}
	for _, row := range p.Rows {
		i := 0
		if p.Mapping.AccountName != importers.NoColumn {
			var ok bool
			if i, ok = part[row.AccountName]; !ok {
				id := u.accountMap[row.AccountName]
				if id == 0 {
					return nil, nil, apperr.Invalid(msgMapAccounts)
				}
				i = len(files)
				part[row.AccountName] = i
				f := base
				f.AccountID = id
				files = append(files, f)
			}
		}
		files[i].Rows = append(files[i].Rows, ledger.ImportRow{Line: row.Line, Account: row.Account, Note: row.Note,
			Category: row.Category, Subcategory: row.Subcategory, Tx: row.Tx})
	}
	if len(files) > 0 {
		files[0].Invalid = len(p.Errors)
	}
	return files, plan, nil
}

// maskSample copies the sample with every IBAN-shaped cell (the file's own
// account, a counterparty) masked like any IBAN the API shows; never nil.
func maskSample(sample [][]string) [][]string {
	out := make([][]string, len(sample))
	for i, row := range sample {
		out[i] = slices.Clone(row)
		for j, c := range row {
			if ibanShaped(c) {
				out[i][j] = ledger.MaskIBAN(c)
			}
		}
	}
	return out
}

// ibanShaped tells whether a cell looks like an IBAN: only ASCII letters,
// digits and spaces, two letters and two digits first, 15 to 34 characters.
// shortcut: no checksum, so a text such as "AB12 factuur 2026" is masked
// too; harmless in a preview sample.
func ibanShaped(s string) bool {
	for _, r := range s {
		if r != ' ' && (r > unicode.MaxASCII || !unicode.IsLetter(r) && !unicode.IsDigit(r)) {
			return false
		}
	}
	n := ledger.NormalizeIBAN(s)
	return len(n) >= 15 && len(n) <= 34 && unicode.IsLetter(rune(n[0])) && unicode.IsLetter(rune(n[1])) &&
		unicode.IsDigit(rune(n[2])) && unicode.IsDigit(rune(n[3]))
}

// rowErrors merges the parse errors and the rows Import excluded, by line,
// and keeps the first maxImportErrors.
func rowErrors(parsed []importers.RowError, excluded []ledger.LineError) []rowErrorBody {
	out := []rowErrorBody{}
	for _, e := range parsed {
		out = append(out, rowErrorBody{Line: e.Line, Message: e.Message})
	}
	for _, e := range excluded {
		out = append(out, rowErrorBody{Line: e.Line, Message: e.Message})
	}
	slices.SortStableFunc(out, func(a, b rowErrorBody) int { return a.Line - b.Line })
	return out[:min(len(out), maxImportErrors)]
}

// multipartRequest answers 415 unless the body is multipart/form-data.
func multipartRequest(w http.ResponseWriter, r *http.Request) bool {
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "multipart/form-data" {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Stuur het bestand als multipart/form-data.")
		return false
	}
	return true
}

// readUpload streams the multipart body (never to memory or disk as a
// whole form) and answers the error itself. It first lifts the server's
// read and write deadlines for this request, which would otherwise cut off
// a slow 20 MB upload after 30 s; httptest's recorder does not support that,
// so the errors are ignored. Each part may come once; anything unknown is 400.
func readUpload(w http.ResponseWriter, r *http.Request) (upload, bool) {
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(importTimeout))
	_ = rc.SetWriteDeadline(time.Now().Add(importTimeout + 30*time.Second))
	r.Body = http.MaxBytesReader(w, r.Body, importBodyMax)

	bad := func(status int, code, msg string) (upload, bool) {
		writeError(w, status, code, msg)
		return upload{}, false
	}
	readErr := func(err error) (upload, bool) {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return bad(http.StatusRequestEntityTooLarge, "too_large", msgFileTooLarge)
		}
		return bad(http.StatusBadRequest, "invalid", msgBadUpload)
	}
	mr, err := r.MultipartReader()
	if err != nil {
		return bad(http.StatusBadRequest, "invalid", msgBadUpload)
	}
	var u upload
	seen := map[string]bool{}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return readErr(err)
		}
		name := part.FormName()
		if seen[name] {
			return bad(http.StatusBadRequest, "invalid", "Elk veld mag maar één keer meekomen.")
		}
		seen[name] = true
		switch name {
		case "file":
			u.fileName = cleanFileName(part.FileName())
			u.data, err = importers.ReadUpload(part)
			if _, ok := errors.AsType[*apperr.InvalidError](err); ok { // ReadUpload's only one: over 20 MB
				return bad(http.StatusRequestEntityTooLarge, "too_large", msgFileTooLarge)
			}
			if err != nil {
				return readErr(err)
			}
		case "accountId":
			v, err := readField(part, maxAccountField)
			if err != nil {
				return readErr(err)
			}
			if len(v) == 0 {
				break // an empty field is no account
			}
			id, perr := strconv.ParseInt(string(v), 10, 64)
			if perr != nil || id <= 0 {
				return bad(http.StatusNotFound, "not_found", msgAccountNotFound)
			}
			u.accountID = id
		case "accountMap":
			v, err := readField(part, maxAccountMap)
			if err != nil {
				return readErr(err)
			}
			dec := json.NewDecoder(bytes.NewReader(v))
			if err := dec.Decode(&u.accountMap); err != nil || dec.More() || u.accountMap == nil || len(u.accountMap) > importers.MaxAccountNames {
				return bad(http.StatusBadRequest, "invalid", "De koppeling van de rekeningnamen klopt niet.")
			}
			for _, id := range u.accountMap {
				if id <= 0 {
					return bad(http.StatusNotFound, "not_found", msgAccountNotFound)
				}
			}
		case "categories":
			v, err := readField(part, maxChoicesField)
			if err != nil {
				return readErr(err)
			}
			dec := json.NewDecoder(bytes.NewReader(v))
			dec.DisallowUnknownFields()
			if err := dec.Decode(&u.choices); err != nil || dec.More() || u.choices == nil {
				return bad(http.StatusBadRequest, "invalid", "De koppeling van de categorieën klopt niet.")
			}
		case "settings":
			v, err := readField(part, maxSettingsField)
			if err != nil {
				return readErr(err)
			}
			var sb settingsBody
			dec := json.NewDecoder(bytes.NewReader(v))
			dec.DisallowUnknownFields()
			var ok bool
			if err := dec.Decode(&sb); err == nil && !dec.More() {
				u.options, ok = sb.options()
			}
			if !ok {
				return bad(http.StatusBadRequest, "invalid", "De instellingen van het bestand kloppen niet.")
			}
		case "mapping":
			v, err := readField(part, maxMappingField)
			if err != nil {
				return readErr(err)
			}
			dec := json.NewDecoder(bytes.NewReader(v))
			dec.DisallowUnknownFields()
			if err := dec.Decode(&u.echo); err != nil || dec.More() {
				return bad(http.StatusBadRequest, "invalid", "De koppeling van de kolommen klopt niet.")
			}
			m := u.echo.mapping()
			u.mapping = &m
		default:
			return bad(http.StatusBadRequest, "invalid", "De aanvraag bevat een onbekend veld.")
		}
	}
	if !seen["file"] {
		return bad(http.StatusBadRequest, "invalid", "Kies een CSV-bestand.")
	}
	return u, true
}

var errFieldTooLong = errors.New("field too long")

// readField reads a small text part of at most n bytes.
func readField(part io.Reader, n int64) ([]byte, error) {
	v, err := io.ReadAll(io.LimitReader(part, n+1))
	if err == nil && int64(len(v)) > n {
		err = errFieldTooLong
	}
	return v, err
}

// cleanFileName keeps the base name of an uploaded file (a browser may send
// a Windows or Unix path), without control or format characters (a bidi
// override would reorder the name for co-members), at most 100
// characters; bestand.csv when nothing is left.
func cleanFileName(name string) string {
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == unicode.ReplacementChar {
			return -1
		}
		return r
	}, name))
	if runes := []rune(name); len(runes) > 100 {
		name = strings.TrimSpace(string(runes[:100]))
	}
	if name == "" || name == "." || name == ".." {
		return defaultFileName
	}
	return name
}

// getImportMappings answers GET /api/imports/mappings?source=bilance: the
// saved category mapping of the viewer for a source ("argenta", "bilance" or
// "csv"), [{category, subcategory, categoryId}] (categoryId null: leave
// uncategorised), [] when none. Unknown source 400.
func (s *Server) getImportMappings(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Mappings(r.Context(), viewerOf(r), r.URL.Query().Get("source"))
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// putImportMappings answers PUT /api/imports/mappings?source=bilance: saves
// the entries of the body (an array like the GET answer) as the own mapping of
// the viewer, upsert per pair; saved pairs the body does not name stay. 200
// with the whole mapping. 400 for an unknown source, a category that does not
// exist, a pair twice or more than 500 entries.
func (s *Server) putImportMappings(w http.ResponseWriter, r *http.Request) {
	var body []ledger.SavedMapping
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	list, err := s.store.PutMappings(r.Context(), viewerOf(r), r.URL.Query().Get("source"), body)
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// postReapplyCategories answers POST /api/imports/{id}/reapply-categories:
// rewrites the category of the rows of one batch from the saved mapping of
// the viewer and answers {changed}. Only rows with origin "import", or still
// uncategorised from a skipped pair, change; never a manual, rule or
// suggestion category. Hidden batch 404, read-only account 403.
func (s *Server) postReapplyCategories(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgNotFound)
	if !ok {
		return
	}
	n, err := s.store.ReapplyCategories(r.Context(), viewerOf(r), id)
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"changed": n})
}
