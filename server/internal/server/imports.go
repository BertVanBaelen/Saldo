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
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/importers"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/ratelimit"
)

// CSV import (phase 0.3-6). The two POST routes are the one exception to
// "JSON only": they take multipart/form-data, read as a stream.

const (
	// importBodyMax caps the whole multipart body: the file plus room for
	// the part headers and the two small fields.
	importBodyMax = importers.MaxFileBytes + 64<<10
	// importTimeout replaces the server's 30 s read timeout for an upload:
	// 5 MB from a phone on a slow uplink can take longer.
	importTimeout   = 2 * time.Minute
	maxAccountField = 20 // digits of an int64
	maxMappingField = 2 << 10
	maxImportErrors = 20 // row errors in an answer; counts give the total
	msgFileTooLarge = "Het bestand is groter dan 5 MB."
	msgBadUpload    = "Het bestand kwam niet goed aan. Probeer het opnieuw."
	defaultFileName = "bestand.csv"
)

// importLimits are the per-user limits of the import routes, and the
// server-wide count of import requests (preview and import) running now.
type importLimits struct {
	preview, run *ratelimit.Limiter
	running      atomic.Int32
}

// maxImportsRunning caps concurrent uploads: each can hold several times
// 5 MB for up to two minutes, too much for a small Home Assistant box.
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
		Account: col(b.Account), Currency: col(b.Currency)}
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
		Account: col(m.Account), Currency: col(m.Currency)}
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
}

type previewBody struct {
	FileName  string         `json:"fileName"`
	Delimiter string         `json:"delimiter"`
	Headers   []string       `json:"headers"`
	Mapping   mappingBody    `json:"mapping"`
	Preset    *string        `json:"preset"`
	TotalRows int            `json:"totalRows"`
	Sample    [][]string     `json:"sample"`
	Counts    *countsBody    `json:"counts"`
	Errors    []rowErrorBody `json:"errors"`
}

type importBody struct {
	Batch  ledger.Batch   `json:"batch"`
	Errors []rowErrorBody `json:"errors"`
}

// upload is a read multipart request.
type upload struct {
	fileName  string
	data      []byte
	accountID int64              // 0 when not sent
	mapping   *importers.Mapping // nil when not sent
	echo      mappingBody        // the mapping as sent
}

// postImportPreview inspects a CSV file for the import wizard.
//
// POST /api/imports/preview, multipart/form-data with the parts file
// (required), accountId and mapping (a JSON object of column indexes, keys
// date, valueDate, amount, counterparty, counterpartyIban, communication,
// account, currency; null or absent = not mapped). 200 with fileName, delimiter, headers,
// mapping (the one sent, else the suggestion), preset ("argenta" or null),
// totalRows, sample (the first three readable rows, cells in header order,
// IBAN-shaped cells masked),
// counts and errors. counts ({rows, new, present, invalid, overlap}; overlap
// is how many of the new rows are dated on or after the account's earliest
// synced booked row) and errors (at
// most 20 {line, message}; counts.invalid is the total) only come when both
// accountId and mapping are sent; one without the other is 400. The counts
// are those of a real import (the same code, rolled back), so they need edit
// access to the account: hidden 404, read-only 403. counts null and errors
// [] otherwise. 60 previews per user per hour, then 429 with Retry-After.
// Errors: 415 not multipart, 413 file over 5 MB, 400 a bad file, mapping
// or upload (Dutch message, never cell text).
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
	if (u.accountID == 0) != (u.mapping == nil) {
		writeError(w, http.StatusBadRequest, "invalid", "Stuur de rekening en de koppeling samen mee, of geen van beide.")
		return
	}
	var p importers.Parsed
	var err error
	if u.mapping == nil {
		p, err = importers.Inspect(u.data)
	} else {
		p, err = importers.Parse(u.data, *u.mapping, s.today())
	}
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	body := previewBody{FileName: u.fileName, Delimiter: string(p.Delimiter), Headers: p.Headers, Mapping: mappingOf(p.Mapping),
		TotalRows: p.TotalRows, Sample: maskSample(p.Sample), Errors: []rowErrorBody{}}
	if u.mapping != nil {
		body.Mapping = u.echo
	}
	if p.Preset != "" {
		body.Preset = &p.Preset
	}
	if u.mapping != nil {
		b, excluded, err := s.store.Import(r.Context(), viewer, importFile(u, p), true)
		if err != nil {
			s.fail(w, r, err, msgAccountNotFound)
			return
		}
		body.Counts = &countsBody{Rows: p.TotalRows, New: b.Imported, Present: b.Present, Invalid: b.Invalid, Overlap: b.Overlap}
		body.Errors = rowErrors(p.Errors, excluded)
	}
	writeJSON(w, http.StatusOK, body)
}

// postImport imports a CSV file into an account the viewer may edit.
//
// POST /api/imports, multipart/form-data with the parts file, accountId and
// mapping (as for the preview), all required. 201 {batch, errors}: batch is
// {id, source ("argenta" or "csv"), fileName, accountId, createdAt,
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
	if u.accountID == 0 || u.mapping == nil {
		writeError(w, http.StatusBadRequest, "invalid", "Kies een rekening en koppel de kolommen.")
		return
	}
	p, err := importers.Parse(u.data, *u.mapping, s.today())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	b, excluded, err := s.store.Import(r.Context(), viewer, importFile(u, p), false)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	s.audit(r, auth.EventImportDone, viewer, fmt.Sprintf("account=%d batch=%d imported=%d present=%d invalid=%d",
		b.AccountID, b.ID, b.Imported, b.Present, b.Invalid))
	writeJSON(w, http.StatusCreated, importBody{Batch: b, Errors: rowErrors(p.Errors, excluded)})
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

func importFile(u upload, p importers.Parsed) ledger.ImportFile {
	source := "csv"
	if p.Preset == importers.PresetArgenta {
		source = "argenta"
	}
	sum := sha256.Sum256(u.data)
	f := ledger.ImportFile{AccountID: u.accountID, Source: source, FileName: u.fileName,
		FileHash: hex.EncodeToString(sum[:]), Invalid: len(p.Errors)}
	for _, row := range p.Rows {
		f.Rows = append(f.Rows, ledger.ImportRow{Line: row.Line, Account: row.Account, Tx: row.Tx})
	}
	return f
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
// a slow 5 MB upload after 30 s; httptest's recorder does not support that,
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
			if _, ok := errors.AsType[*apperr.InvalidError](err); ok { // ReadUpload's only one: over 5 MB
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
