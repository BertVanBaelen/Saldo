package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"testing/iotest"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/importers"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Synthetic CSV in a generic layout (not Argenta's); every name and amount
// is invented.
const (
	csvHeader  = "Boekingsdatum;Valutadatum;Bedrag;Naam tegenpartij;Rekening tegenpartij;Mededeling\n"
	csvCoffee  = "10/11/2026;10/11/2026;-3,50;Koffiehuis Test;;Bancontact\n"
	csvBread   = "11/11/2026;11/11/2026;-12,30;Bakker Test;;Brood\n"
	csvSalary  = "12/11/2026;12/11/2026;1.500,00;Werkgever Test;;Loon\n"
	csvFuel    = "13/11/2026;13/11/2026;-20,00;Tankstation Test;;Diesel\n"
	csvBadDate = "31/02/2026;31/02/2026;-7,77;Geheime Naam;;Geheim\n"
	csvRagged  = "14/11/2026;-5,55;Geheime Naam\n"
	csvMapping = `{"date":0,"valueDate":1,"amount":2,"counterparty":3,"counterpartyIban":4,"communication":5}`
)

type formPart struct{ name, fileName, content string }

func multipartForm(t *testing.T, parts ...formPart) (body, contentType string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, p := range parts {
		var w io.Writer
		var err error
		if p.name == "file" {
			w, err = mw.CreateFormFile(p.name, p.fileName)
		} else {
			w, err = mw.CreateFormField(p.name)
		}
		if err != nil {
			t.Fatal(err)
		}
		io.WriteString(w, p.content)
	}
	mw.Close()
	return buf.String(), mw.FormDataContentType()
}

// upload posts a multipart form as user.
func (e *bankEnv) upload(user int64, path string, parts ...formPart) response {
	e.t.Helper()
	body, ct := multipartForm(e.t, parts...)
	return e.do(call{method: "POST", path: path, body: body,
		header: map[string]string{"X-Test-User": strconv.FormatInt(user, 10), "Content-Type": ct}})
}

// importForm is the three parts of an import; account 0 or mapping "" leaves that part out.
func importForm(csv string, account int64, mapping string) []formPart {
	parts := []formPart{{"file", "export.csv", csv}}
	if account != 0 {
		parts = append(parts, formPart{"accountId", "", strconv.FormatInt(account, 10)})
	}
	if mapping != "" {
		parts = append(parts, formPart{"mapping", "", mapping})
	}
	return parts
}

func (e *bankEnv) importOK(user, account int64, csv string) importBody {
	e.t.Helper()
	r := e.upload(user, "/api/imports", importForm(csv, account, csvMapping)...)
	if r.status != http.StatusCreated {
		e.t.Fatalf("import: %d %s", r.status, r.body)
	}
	return decode[importBody](e.t, r.body)
}

func (e *bankEnv) previewCounts(user, account int64, csv string) countsBody {
	e.t.Helper()
	r := e.upload(user, "/api/imports/preview", importForm(csv, account, csvMapping)...)
	if r.status != http.StatusOK {
		e.t.Fatalf("preview: %d %s", r.status, r.body)
	}
	p := decode[previewBody](e.t, r.body)
	if p.Counts == nil {
		e.t.Fatalf("preview without counts: %s", r.body)
	}
	return *p.Counts
}

func TestImport(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	linked := e.link(e.bert, "")
	bankAccount := linked.Accounts[0].ID
	r := e.as(e.bert, "POST", "/api/accounts", `{"name":"Spaarpot","type":"savings"}`)
	if r.status != http.StatusCreated {
		t.Fatalf("manual account: %d %s", r.status, r.body)
	}
	manual := decode[ledger.Account](t, r.body).ID
	untouched := func() string {
		return e.query(`SELECT * FROM balance_snapshots ORDER BY id`) + "|" + e.query(`SELECT * FROM account_sources ORDER BY account_id`) +
			"|" + e.query(`SELECT * FROM provider_connections ORDER BY id`) + "|" + e.as(e.bert, "GET", "/api/accounts", "").body
	}
	before := untouched()
	txsBefore := e.count(`SELECT COUNT(*) FROM transactions`)
	file := csvHeader + csvCoffee + csvCoffee + csvBread + csvSalary

	// The mapping step: the suggestion and the preset, no counts.
	r = e.upload(e.bert, "/api/imports/preview", importForm(file, 0, "")...)
	if r.status != http.StatusOK {
		t.Fatalf("preview: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"fileName": "export.csv", "delimiter": ";", "encoding": "utf-8", "accounts": [], "categories": [],
		"headers": ["Boekingsdatum", "Valutadatum", "Bedrag", "Naam tegenpartij", "Rekening tegenpartij", "Mededeling"],
		"mapping": {"date":0,"valueDate":1,"amount":2,"counterparty":3,"counterpartyIban":4,"communication":5,"account":null,"currency":null,"note":null,"category":null,"subcategory":null,"accountName":null,"counterpartyFallback":null},
		"preset": null, "totalRows": 4,
		"sample": [["10/11/2026", "10/11/2026", "-3,50", "Koffiehuis Test", "", "Bancontact"],
		           ["10/11/2026", "10/11/2026", "-3,50", "Koffiehuis Test", "", "Bancontact"],
		           ["11/11/2026", "11/11/2026", "-12,30", "Bakker Test", "", "Brood"]],
		"counts": null, "errors": []}`)

	// Preview then import: the same numbers. Two coffees are two rows.
	if c := e.previewCounts(e.bert, bankAccount, file); c != (countsBody{Rows: 4, New: 4, Overlap: 4}) { // the fake sync covers these dates
		t.Errorf("preview counts %+v", c)
	}
	got := e.importOK(e.bert, bankAccount, file)
	if b := got.Batches[0]; b.Imported != 4 || b.Present != 0 || b.Invalid != 0 || b.Source != "csv" || b.FileName != "export.csv" ||
		b.AccountID != bankAccount || !strings.HasSuffix(b.CreatedAt, "+01:00") || len(got.Errors) != 0 {
		t.Errorf("import %+v", got)
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions WHERE import_batch_id = ? AND source_connection_id IS NULL AND status = 'booked'
		AND category_id IS NULL AND raw_payload LIKE '%Koffiehuis Test%'`, got.Batches[0].ID); n != 2 {
		t.Errorf("stored coffees: %d", n)
	}
	if e.count(`SELECT COUNT(*) FROM import_batches WHERE id = ? AND created_by = ? AND length(file_hash) = 64
		AND rows_imported = 4 AND rows_duplicate = 0 AND rows_skipped = 0`, got.Batches[0].ID, e.bert) != 1 {
		t.Error("batch row")
	}

	// The same file again: nothing new, a second batch; the preview agrees.
	if c := e.previewCounts(e.bert, bankAccount, file); c != (countsBody{Rows: 4, Present: 4}) {
		t.Errorf("preview of the same file %+v", c)
	}
	if b := e.importOK(e.bert, bankAccount, file).Batches[0]; b.Imported != 0 || b.Present != 4 {
		t.Errorf("same file again %+v", b)
	}
	if e.count(`SELECT COUNT(*) FROM import_batches`) != 2 || e.count(`SELECT COUNT(*) FROM transactions`) != txsBefore+4 {
		t.Error("re-import changed the transactions or made no batch")
	}

	// An overlapping file with an unreadable and a ragged row: only the new
	// readable row goes in, the bad ones are counted, the rest is imported.
	overlap := csvHeader + csvSalary + csvBadDate + csvFuel + csvRagged
	if c := e.previewCounts(e.bert, bankAccount, overlap); c != (countsBody{Rows: 4, New: 1, Present: 1, Invalid: 2, Overlap: 1}) {
		t.Errorf("preview of the overlap %+v", c)
	}
	got = e.importOK(e.bert, bankAccount, overlap)
	if b := got.Batches[0]; b.Imported != 1 || b.Present != 1 || b.Invalid != 2 || len(got.Errors) != 2 || got.Errors[0].Line != 3 || got.Errors[1].Line != 5 {
		t.Errorf("overlap %+v", got)
	}

	// A manual account takes the same file; it syncs nothing, so no overlap.
	if c := e.previewCounts(e.bert, manual, file); c != (countsBody{Rows: 4, New: 4}) {
		t.Errorf("manual account preview %+v", c)
	}
	r = e.upload(e.bert, "/api/imports", importForm(file, manual, csvMapping)...)
	if b := decode[importBody](t, r.body).Batches[0]; r.status != http.StatusCreated || b.Imported != 4 {
		t.Errorf("manual account %d %s", r.status, r.body)
	}
	// Only the preview's counts carry overlap.
	if strings.Contains(r.body, "overlap") || strings.Contains(e.as(e.bert, "GET", "/api/imports", "").body, "overlap") {
		t.Error("overlap outside the preview")
	}
	if after := untouched(); after != before {
		t.Errorf("the import changed balances, sources or sync state\nbefore %s\nafter  %s", before, after)
	}

	list := decode[[]ledger.Batch](t, e.as(e.bert, "GET", "/api/imports", "").body)
	if len(list) != 4 || list[0].AccountID != manual || list[3].Imported != 4 || list[0].ID < list[1].ID {
		t.Errorf("batches %+v", list)
	}
	if e.count(`SELECT COUNT(*) FROM audit_log WHERE event = 'import_done' AND user_id = ? AND detail LIKE 'account=% batch=% imported=% present=% invalid=%'`, e.bert) != 4 {
		t.Error("audit rows")
	}
	// Nothing of the file reaches the log.
	for _, s := range []string{"Koffiehuis", "Geheime", "export.csv", "-3,50", "1.500,00"} {
		if strings.Contains(e.logs.String(), s) || strings.Contains(e.query(`SELECT detail FROM audit_log`), s) {
			t.Errorf("%q is logged", s)
		}
	}
}

func TestImportPrivacy(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	linked := e.link(e.bert, "")
	personal, shared := linked.Accounts[0].ID, linked.Accounts[1].ID
	e.importOK(e.bert, personal, csvHeader+csvCoffee)
	e.importOK(e.bert, shared, csvHeader+csvBread)
	if _, err := e.db.Exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (?, ?, 'member', 'read')`, shared, e.partner); err != nil {
		t.Fatal(err)
	}
	file := csvHeader + csvSalary
	// Hidden: 404 like every hidden account, with and without a dry run.
	for _, path := range []string{"/api/imports", "/api/imports/preview"} {
		expectError(t, e.upload(e.partner, path, importForm(file, personal, csvMapping)...), http.StatusNotFound, "not_found")
		expectError(t, e.upload(e.partner, path, importForm(file, 999, csvMapping)...), http.StatusNotFound, "not_found")
		// Read-only member: 403.
		if msg := expectError(t, e.upload(e.partner, path, importForm(file, shared, csvMapping)...), http.StatusForbidden, "forbidden"); msg != "Je mag deze rekening alleen bekijken." {
			t.Errorf("read-only message %q", msg)
		}
	}
	// She sees the batch of the account she shares, not that of his own.
	list := decode[[]ledger.Batch](t, e.as(e.partner, "GET", "/api/imports", "").body)
	if len(list) != 1 || list[0].AccountID != shared {
		t.Errorf("partner's batches %+v", list)
	}
	if e.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Werkgever Test'`) != 0 || e.count(`SELECT COUNT(*) FROM import_batches`) != 2 {
		t.Error("partner imported into Bert's account")
	}
	// A stranger sees none.
	stranger := e.addUser("derde@jouw-domein.be", "Derde", "user", partnerPass)
	if r := e.as(stranger, "GET", "/api/imports", ""); r.body != "[]\n" {
		t.Errorf("stranger: %s", r.body)
	}
}

func TestImportBadFiles(t *testing.T) {
	e := newBankEnv(t)
	r := e.as(e.bert, "POST", "/api/accounts", `{"name":"Spaarpot","type":"savings"}`)
	account := decode[ledger.Account](t, r.body).ID
	ok := csvHeader + csvCoffee
	big := csvHeader + strings.Repeat(csvCoffee, importers.MaxFileBytes/len(csvCoffee)+1)
	secrets := []string{"Koffiehuis", "Geheim", "fakepath", "-3,50", "-7,77"}
	cases := []struct {
		name   string
		path   string
		parts  []formPart
		status int
	}{
		{"no file part", "/api/imports/preview", []formPart{{"accountId", "", "1"}}, 400},
		{"too large", "/api/imports/preview", importForm(big, 0, ""), 413},
		{"binary", "/api/imports/preview", importForm("Boekingsdatum;Bedrag\n\x00\x01\x02;1", 0, ""), 400},
		{"empty", "/api/imports/preview", importForm("", 0, ""), 400},
		{"header only", "/api/imports/preview", importForm(csvHeader, 0, ""), 400},
		{"account without mapping", "/api/imports/preview", importForm(ok, account, ""), 400},
		{"no amount", "/api/imports", importForm(ok, account, `{"date":0}`), 400},
		{"unknown delimiter", "/api/imports/preview", append(importForm(ok, 0, ""), formPart{"settings", "", `{"delimiter":"|"}`}), 400},
		{"unknown setting", "/api/imports/preview", append(importForm(ok, 0, ""), formPart{"settings", "", `{"x":"y"}`}), 400},
		{"accounts twice", "/api/imports/preview", append(importForm(ok, account, csvMapping), formPart{"accountMap", "", `{"A":1}`}), 400},
		{"duplicate column", "/api/imports", importForm(ok, account, `{"date":0,"amount":0}`), 400},
		{"out of range", "/api/imports", importForm(ok, account, `{"date":0,"amount":6}`), 400},
		{"unknown mapping key", "/api/imports", importForm(ok, account, `{"date":0,"amount":2,"x":1}`), 400},
		{"mapping not JSON", "/api/imports", importForm(ok, account, `date=0`), 400},
		{"mapping too long", "/api/imports", importForm(ok, account, `{"date":0,"amount":2}`+strings.Repeat(" ", 2048)), 400},
		{"only a file", "/api/imports", importForm(ok, 0, ""), 400},
		{"bad account id", "/api/imports", append(importForm(ok, 0, csvMapping), formPart{"accountId", "", "abc"}), 404},
		{"unknown part", "/api/imports", append(importForm(ok, account, csvMapping), formPart{"extra", "", "x"}), 400},
		{"file twice", "/api/imports", append(importForm(ok, account, csvMapping), formPart{"file", "b.csv", ok}), 400},
		{"missing mapping", "/api/imports", importForm(ok, account, ""), 400},
		{"all rows unreadable", "/api/imports", importForm(csvHeader+csvBadDate+csvRagged, account, csvMapping), 400},
		{"too many rows", "/api/imports", importForm(csvHeader+strings.Repeat(csvCoffee, importers.MaxRows+1), account, csvMapping), 400},
	}
	for _, c := range cases {
		r := e.upload(e.bert, c.path, c.parts...)
		if r.status != c.status {
			t.Errorf("%s: %d, want %d (%s)", c.name, r.status, c.status, r.body)
			continue
		}
		msg := decode[errorBody](t, r.body).Error.Message
		if msg == "" {
			t.Errorf("%s: no message", c.name)
		}
		for _, s := range secrets {
			if strings.Contains(msg, s) {
				t.Errorf("%s: message %q repeats %q", c.name, msg, s)
			}
		}
	}
	if msg := expectError(t, e.upload(e.bert, "/api/imports/preview", importForm(big, 0, "")...), http.StatusRequestEntityTooLarge, "too_large"); !strings.Contains(msg, "20 MB") {
		t.Errorf("too large: %q", msg)
	}
	// Not multipart.
	expectError(t, e.as(e.bert, "POST", "/api/imports", `{"file":"x"}`), http.StatusUnsupportedMediaType, "unsupported_media_type")
	expectError(t, e.as(e.bert, "POST", "/api/imports/preview", `{"file":"x"}`), http.StatusUnsupportedMediaType, "unsupported_media_type")
	if e.count(`SELECT COUNT(*) FROM import_batches`)+e.count(`SELECT COUNT(*) FROM transactions`) != 0 {
		t.Error("a refused file stored something")
	}

	// Every row error is listed with its line and without cell text, at most 20.
	file := csvHeader + csvCoffee + strings.Repeat(csvBadDate, 25)
	r = e.upload(e.bert, "/api/imports/preview", importForm(file, account, csvMapping)...)
	p := decode[previewBody](t, r.body)
	if *p.Counts != (countsBody{Rows: 26, New: 1, Invalid: 25}) || len(p.Errors) != 20 || p.Errors[0].Line != 3 {
		t.Errorf("preview with errors: %s", r.body)
	}
	for _, s := range secrets {
		if strings.Contains(fmt.Sprint(p.Errors), s) {
			t.Errorf("row errors repeat %q", s)
		}
	}
	// A path in the file name is dropped.
	r = e.upload(e.bert, "/api/imports", formPart{"file", `C:\fakepath\Rekening.csv`, csvHeader + csvSalary},
		formPart{"accountId", "", strconv.FormatInt(account, 10)}, formPart{"mapping", "", csvMapping})
	if b := decode[importBody](t, r.body).Batches[0]; b.FileName != "Rekening.csv" || b.Source != "csv" {
		t.Errorf("file name %q", b.FileName)
	}
}

// A file at the row limit imports in one go.
func TestImportManyRows(t *testing.T) {
	e := newBankEnv(t)
	account := decode[ledger.Account](t, e.as(e.bert, "POST", "/api/accounts", `{"name":"Spaarpot","type":"savings"}`).body).ID
	file := csvHeader + strings.Repeat(csvCoffee, importers.MaxRows)
	if b := e.importOK(e.bert, account, file).Batches[0]; b.Imported != importers.MaxRows {
		t.Errorf("imported %d", b.Imported)
	}
	if b := e.importOK(e.bert, account, file).Batches[0]; b.Imported != 0 || b.Present != importers.MaxRows {
		t.Errorf("again: %+v", b)
	}
}

func TestCleanFileName(t *testing.T) {
	for in, want := range map[string]string{
		"export.csv":                      "export.csv",
		`C:\Users\x\Downloads\export.csv`: "export.csv",
		"../../etc/export.csv":            "export.csv",
		"a\x00b\x1f\u0085c.csv":           "abc.csv",
		"a‮b⁦c⁩‏.csv":                     "abc.csv", // format characters: bidi overrides, isolates, marks
		"  ":                              "bestand.csv",
		"":                                "bestand.csv",
		"..":                              "bestand.csv",
		"map/":                            "bestand.csv",
		strings.Repeat("é", 150):          strings.Repeat("é", 100),
	} {
		if got := cleanFileName(in); got != want {
			t.Errorf("cleanFileName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestImportRateLimits(t *testing.T) {
	e := newBankEnv(t)
	account := decode[ledger.Account](t, e.as(e.bert, "POST", "/api/accounts", `{"name":"Spaarpot","type":"savings"}`).body).ID
	file := csvHeader + csvCoffee
	for range 20 {
		e.importOK(e.bert, account, file)
	}
	r := e.upload(e.bert, "/api/imports", importForm(file, account, csvMapping)...)
	expectError(t, r, http.StatusTooManyRequests, "rate_limited")
	if r.header.Get("Retry-After") == "" {
		t.Error("no Retry-After")
	}
	for range 60 {
		if r := e.upload(e.bert, "/api/imports/preview", importForm(file, 0, "")...); r.status != 200 {
			t.Fatalf("preview: %d", r.status)
		}
	}
	r = e.upload(e.bert, "/api/imports/preview", importForm(file, 0, "")...)
	expectError(t, r, http.StatusTooManyRequests, "rate_limited")
	if r.header.Get("Retry-After") == "" {
		t.Error("no Retry-After")
	}
	// Per user: Partner may still preview.
	if r := e.upload(e.partner, "/api/imports/preview", importForm(file, 0, "")...); r.status != 200 {
		t.Errorf("partner: %d", r.status)
	}
	e.now = e.now.Add(time.Hour)
	e.importOK(e.bert, account, file)
}

// At most two uploads run at once, server-wide; a third is 503 without
// using the user's quota, and a slot comes free when its request ends,
// also on an error.
func TestImportConcurrencyCap(t *testing.T) {
	e := newBankEnv(t)
	account := decode[ledger.Account](t, e.as(e.bert, "POST", "/api/accounts", `{"name":"Spaarpot","type":"savings"}`).body).ID
	body, ct := multipartForm(t, importForm(csvHeader+csvCoffee, account, csvMapping)...)
	serve := func(user int64, path string, r io.Reader) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", path, r)
		req.Header.Set("Content-Type", ct)
		req.Header.Set("X-Test-User", strconv.FormatInt(user, 10))
		rec := httptest.NewRecorder()
		e.h.ServeHTTP(rec, req)
		return rec
	}
	var pipes []*io.PipeWriter
	done := make(chan int, 2)
	for _, path := range []string{"/api/imports", "/api/imports/preview"} {
		pr, pw := io.Pipe()
		pipes = append(pipes, pw)
		go func() { done <- serve(e.partner, path, pr).Code }()
		pw.Write([]byte(body[:20])) // returns once the handler reads its body
	}
	for _, path := range []string{"/api/imports", "/api/imports/preview"} {
		rec := serve(e.bert, path, strings.NewReader(body))
		expectError(t, response{status: rec.Code, body: rec.Body.String(), header: rec.Header()}, http.StatusServiceUnavailable, "unavailable")
		if !strings.Contains(rec.Body.String(), "Er loopt al een import.") {
			t.Errorf("message: %s", rec.Body)
		}
	}
	for _, pw := range pipes {
		pw.CloseWithError(errors.New("connection reset"))
		if code := <-done; code != http.StatusBadRequest {
			t.Errorf("broken upload: %d", code)
		}
	}
	// Both slots free again, and the busy answers cost no quota: all 20.
	for range 20 {
		e.importOK(e.bert, account, csvHeader+csvCoffee)
	}
}

// A body that breaks off stores nothing.
func TestImportBodyCutOff(t *testing.T) {
	e := newBankEnv(t)
	account := decode[ledger.Account](t, e.as(e.bert, "POST", "/api/accounts", `{"name":"Spaarpot","type":"savings"}`).body).ID
	// The file part last, so the other parts arrive whole.
	body, ct := multipartForm(t, formPart{"accountId", "", strconv.FormatInt(account, 10)}, formPart{"mapping", "", csvMapping},
		formPart{"file", "export.csv", csvHeader + strings.Repeat(csvCoffee, 100)})
	for _, r := range []io.Reader{
		io.MultiReader(strings.NewReader(body[:len(body)/2]), iotest.ErrReader(errors.New("connection reset"))),
		strings.NewReader(body[:len(body)/2]),
		strings.NewReader(body[:len(body)-10]),
	} {
		req := httptest.NewRequest("POST", "/api/imports", r)
		req.Header.Set("Content-Type", ct)
		req.Header.Set("X-Test-User", strconv.FormatInt(e.bert, 10))
		rec := httptest.NewRecorder()
		e.h.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("cut off: %d %s", rec.Code, rec.Body)
		}
	}
	if e.count(`SELECT COUNT(*) FROM import_batches`)+e.count(`SELECT COUNT(*) FROM transactions`) != 0 {
		t.Error("a cut-off upload stored something")
	}
}

// The server's read timeout (30 s in main) would cut off a slow upload; the
// import routes lift it. Here the timeout is 300 ms and the body pauses 1 s.
func TestImportOutlivesTheReadTimeout(t *testing.T) {
	e := newBankEnv(t)
	srv := httptest.NewUnstartedServer(e.h)
	srv.Config.ReadTimeout = 300 * time.Millisecond
	srv.Start()
	defer srv.Close()
	slow := func(path, ct, body string) (int, error) {
		pr, pw := io.Pipe()
		go func() {
			pw.Write([]byte(body[:20]))
			time.Sleep(time.Second)
			pw.Write([]byte(body[20:]))
			pw.Close()
		}()
		req, _ := http.NewRequest("POST", srv.URL+path, pr)
		req.Header.Set("Content-Type", ct)
		req.Header.Set("X-Test-User", strconv.FormatInt(e.bert, 10))
		resp, err := srv.Client().Do(req)
		if err != nil {
			return 0, err
		}
		resp.Body.Close()
		return resp.StatusCode, nil
	}
	// The baseline: a JSON route is cut off.
	if status, err := slow("/api/accounts", "application/json", `{"name":"Traag","type":"savings"}`); err == nil && status == http.StatusCreated {
		t.Fatal("the read timeout did not cut off a slow JSON body; the test proves nothing")
	}
	body, ct := multipartForm(t, importForm(csvHeader+csvCoffee, 0, "")...)
	if status, err := slow("/api/imports/preview", ct, body); err != nil || status != http.StatusOK {
		t.Errorf("slow upload: %d %v", status, err)
	}
}

func TestImportCrossOriginIsRefused(t *testing.T) {
	e := newBankEnv(t)
	body, ct := multipartForm(t, importForm(csvHeader+csvCoffee, 0, "")...)
	for _, path := range []string{"/api/imports", "/api/imports/preview"} {
		r := e.do(call{method: "POST", path: path, body: body, header: map[string]string{"X-Test-User": strconv.FormatInt(e.bert, 10),
			"Content-Type": ct, "Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example.org"}})
		expectError(t, r, http.StatusForbidden, "forbidden")
	}
}

// TestImportArgenta covers the 11-column Argenta layout: the preset and its
// suggested mapping (the file's own account and currency included), IBANs
// masked in the sample, and the account and currency guards. Every value is
// invented; BE68539007547034 is a documentation IBAN.
func TestImportArgenta(t *testing.T) {
	e := newBankEnv(t)
	account := decode[ledger.Account](t, e.as(e.bert, "POST", "/api/accounts", `{"name":"Zicht","type":"current"}`).body).ID
	if _, err := e.db.Exec(`UPDATE accounts SET iban = 'BE68539007547034' WHERE id = ?`, account); err != nil {
		t.Fatal(err)
	}
	const (
		header  = "Rekening;Boekdatum;Valutadatum;Referentie;Beschrijving;Bedrag;Munt;Verrichtingsdatum;Rekening tegenpartij;Naam tegenpartij;Mededeling\n"
		own     = "BE68 5390 0754 7034;02/11/2026;02/11/2026;TEST-REF-1;Betaling;-64,12;EUR;01/11/2026;BE71 0961 2345 6769;Voorbeeldwinkel;Aankoop fictief\n"
		other   = "BE71 0961 2345 6769;03/11/2026;03/11/2026;TEST-REF-2;Betaling;-8,41;EUR;03/11/2026;;Andere Winkel;Fictief\n"
		pound   = "BE68 5390 0754 7034;04/11/2026;04/11/2026;TEST-REF-3;Betaling;-9,97;GBP;04/11/2026;;Londen Test;Fictief\n"
		mapping = `{"date":1,"valueDate":2,"amount":5,"counterparty":9,"counterpartyIban":8,"communication":10,"account":0,"currency":6}`
	)
	file := header + own + other + pound
	var bodies []string
	send := func(path, csv, m string, status int) string {
		t.Helper()
		var acc int64
		if m != "" {
			acc = account
		}
		r := e.upload(e.bert, path, importForm(csv, acc, m)...)
		if r.status != status {
			t.Fatalf("%s: %d %s", path, r.status, r.body)
		}
		bodies = append(bodies, r.body)
		return r.body
	}

	equalJSON(t, send("/api/imports/preview", file, "", 200), `{"fileName": "export.csv", "delimiter": ";", "encoding": "utf-8", "accounts": [], "categories": [],
		"headers": ["Rekening", "Boekdatum", "Valutadatum", "Referentie", "Beschrijving", "Bedrag", "Munt", "Verrichtingsdatum",
		            "Rekening tegenpartij", "Naam tegenpartij", "Mededeling"],
		"mapping": `+echoed(mapping)+`, "preset": "argenta", "totalRows": 3,
		"sample": [["BE68 •••• •••• 7034", "02/11/2026", "02/11/2026", "TEST-REF-1", "Betaling", "-64,12", "EUR", "01/11/2026", "BE71 •••• •••• 6769", "Voorbeeldwinkel", "Aankoop fictief"],
		           ["BE71 •••• •••• 6769", "03/11/2026", "03/11/2026", "TEST-REF-2", "Betaling", "-8,41", "EUR", "03/11/2026", "", "Andere Winkel", "Fictief"],
		           ["BE68 •••• •••• 7034", "04/11/2026", "04/11/2026", "TEST-REF-3", "Betaling", "-9,97", "GBP", "04/11/2026", "", "Londen Test", "Fictief"]],
		"counts": null, "errors": []}`)

	// Another account's row and a pound row are counted as unreadable, with
	// the file's IBAN masked; preview and import agree.
	errs := `[{"line": 3, "message": "Rekening BE71 •••• •••• 6769 in het bestand is niet de gekozen rekening."},
		{"line": 4, "message": "Alleen bedragen in euro worden ondersteund."}]`
	p := decode[previewBody](t, send("/api/imports/preview", file, mapping, 200))
	if *p.Counts != (countsBody{Rows: 3, New: 1, Invalid: 2}) || p.Mapping.Account == nil || *p.Mapping.Account != 0 || *p.Mapping.Currency != 6 {
		t.Errorf("preview %+v", p)
	}
	equalJSON(t, mustJSON(t, p.Errors), errs)
	got := decode[importBody](t, send("/api/imports", file, mapping, 201))
	if b := got.Batches[0]; b.Source != "argenta" || b.Imported != 1 || b.Present != 0 || b.Invalid != 2 {
		t.Errorf("import %+v", b)
	}
	equalJSON(t, mustJSON(t, got.Errors), errs)
	if e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = ? AND external_id IS NULL AND raw_payload LIKE '%TEST-REF-1%'`, account) != 1 {
		t.Error("the own row is not stored, or Referentie became the external id")
	}

	// A file of another account: the import refuses it without a batch; the
	// preview still answers with every row invalid.
	batches := e.count(`SELECT COUNT(*) FROM import_batches`)
	r := e.upload(e.bert, "/api/imports", importForm(header+other, account, mapping)...)
	if msg := expectError(t, r, http.StatusBadRequest, "invalid"); msg != "Dit bestand hoort bij een andere rekening dan de gekozen rekening." {
		t.Errorf("wrong account: %q", msg)
	}
	bodies = append(bodies, r.body)
	if e.count(`SELECT COUNT(*) FROM import_batches`) != batches {
		t.Error("a batch was stored for another account's file")
	}
	if c := *decode[previewBody](t, send("/api/imports/preview", header+other, mapping, 200)).Counts; c != (countsBody{Rows: 1, Invalid: 1}) {
		t.Errorf("preview of another account's file %+v", c)
	}

	// No full IBAN anywhere in an answer or the log; no amount in an answer
	// other than the preview's sample, nor in the log.
	for i, b := range append(bodies, e.logs.String()) {
		for _, s := range []string{"BE68539007547034", "BE68 5390 0754 7034", "BE71096123456769", "BE71 0961 2345 6769", "5390", "0961"} {
			if strings.Contains(b, s) {
				t.Errorf("answer %d shows %q", i, s)
			}
		}
		if i == 0 || strings.Contains(b, `"sample"`) {
			continue
		}
		for _, s := range []string{"64,12", "8,41", "9,97", "-6412", "-841", "-997"} {
			if strings.Contains(b, s) {
				t.Errorf("answer %d shows amount %q", i, s)
			}
		}
	}
}

// TestImportMixedFile: an Argenta file of two accounts into an account
// without an IBAN is refused whole; a file of one account goes in. All data
// is invented.
func TestImportMixedFile(t *testing.T) {
	e := newBankEnv(t)
	account := decode[ledger.Account](t, e.as(e.bert, "POST", "/api/accounts", `{"name":"Spaarpot","type":"savings"}`).body).ID
	const (
		header  = "Rekening;Boekdatum;Valutadatum;Referentie;Beschrijving;Bedrag;Munt;Verrichtingsdatum;Rekening tegenpartij;Naam tegenpartij;Mededeling\n"
		own     = "BE68 5390 0754 7034;02/11/2026;02/11/2026;TEST-REF-1;Betaling;-64,12;EUR;01/11/2026;;Voorbeeldwinkel;Fictief\n"
		bad     = "BE68 5390 0754 7034;31/02/2026;31/02/2026;TEST-REF-2;Betaling;-1,11;EUR;01/11/2026;;Voorbeeldwinkel;Fictief\n"
		other   = "BE71 0961 2345 6769;03/11/2026;03/11/2026;TEST-REF-3;Betaling;-8,41;EUR;03/11/2026;;Andere Winkel;Fictief\n"
		mapping = `{"date":1,"valueDate":2,"amount":5,"counterparty":9,"counterpartyIban":8,"communication":10,"account":0,"currency":6}`
		rowMsg  = "Het bestand bevat rijen van meer dan één rekening, en de gekozen rekening heeft geen IBAN om ze uit elkaar te houden."
	)
	var bodies []string
	for _, file := range []string{header + own + bad + other, header + other + bad + own} {
		r := e.upload(e.bert, "/api/imports/preview", importForm(file, account, mapping)...)
		p := decode[previewBody](t, r.body)
		if r.status != http.StatusOK || *p.Counts != (countsBody{Rows: 3, Invalid: 3}) || len(p.Errors) != 3 ||
			p.Errors[0] != (rowErrorBody{2, rowMsg}) || p.Errors[1].Line != 3 || p.Errors[1].Message == rowMsg || p.Errors[2] != (rowErrorBody{4, rowMsg}) {
			t.Errorf("preview %d %s", r.status, r.body)
		}
		r = e.upload(e.bert, "/api/imports", importForm(file, account, mapping)...)
		if msg := expectError(t, r, http.StatusBadRequest, "invalid"); msg != "Dit bestand bevat meer dan één rekening. Kies een rekening met een IBAN of splits het bestand." {
			t.Errorf("import: %q", msg)
		}
		bodies = append(bodies, p.Errors[0].Message, r.body)
	}
	if e.count(`SELECT COUNT(*) FROM import_batches`)+e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = ?`, account) != 0 {
		t.Error("a refused file stored something")
	}
	// One account in the file: nothing to check against, it goes in.
	if b := decode[importBody](t, e.upload(e.bert, "/api/imports", importForm(header+own+bad, account, mapping)...).body).Batches[0]; b.Imported != 1 || b.Invalid != 1 {
		t.Errorf("single account %+v", b)
	}
	for i, b := range append(bodies, e.logs.String(), e.query(`SELECT detail FROM audit_log`)) {
		for _, s := range []string{"5390", "0961", "7034", "6769"} {
			if strings.Contains(b, s) {
				t.Errorf("text %d shows %q", i, s)
			}
		}
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// echoed is a mapping as the preview answers it: the fields added in 0.5-2 are null.
func echoed(mapping string) string {
	return strings.TrimSuffix(mapping, "}") + `,"note":null,"category":null,"subcategory":null,"accountName":null,"counterpartyFallback":null}`
}

// TestImportBilance covers a Bilance export (all values invented): the
// preset, accounts from a column mapped to two accounts of the viewer, the
// category pairs listed, the note stored, and the card holder and masked card
// number kept out of every stored field and every answer except raw_payload.
func TestImportBilance(t *testing.T) {
	e := newBankEnv(t)
	account := func(name string) int64 {
		return decode[ledger.Account](t, e.as(e.bert, "POST", "/api/accounts", `{"name":"`+name+`","type":"current"}`).body).ID
	}
	zicht, spaar := account("Zicht"), account("Spaar")
	const card = "Voorbeeld Winkel |.| 02-11-2026 |.| 14:35 |.| Antwerpen |.| BE |.| 0000********0000 |.| 5411 |.| Jan Voorbeeld"
	file := "Titel, Datum, Bedrag, Categorie, Subcategorie, Tag(s), Betalingskenmerk, Handelaar, Rekening(en), Notitie\n" +
		`"Voorbeeld Winkel", 2026-11-02 00:00:00.000, -170.00€, "Eten & Drinken", "Boodschappen", , "` + card + `", "Voorbeeld   Winkel Antwerpen", "Zichtrekening", "Voor het weekend"` + "\n" +
		`"Loon Test", 2026-11-03 00:00:00.000, +2850.00€, "Inkomen", "Loon, premies", , "+++123/4567/89012+++", "Werkgever Test", "Spaarrekening", ` + "\n" +
		`"Kaart Test", 2026-11-04 00:00:00.000, abc€, "Wonen", "Huur, hypotheek", , "` + card + `", "Kaart Test", "Zichtrekening", ` + "\n"
	mapped := fmt.Sprintf(`{"Zichtrekening":%d,"Spaarrekening":%d}`, zicht, spaar)
	send := func(user int64, path, accountMap string, withMapping bool) response {
		t.Helper()
		parts := []formPart{{"file", "bilance.csv", file}}
		if withMapping {
			parts = append(parts, formPart{"mapping", "", `{"date":1,"amount":2,"counterparty":7,"communication":6,"category":3,"subcategory":4,"accountName":8,"note":9,"counterpartyFallback":0}`})
		}
		if accountMap != "" {
			parts = append(parts, formPart{"accountMap", "", accountMap})
		}
		return e.upload(user, path, parts...)
	}
	noCardText := func(body string) {
		t.Helper()
		if strings.Contains(body, "Jan Voorbeeld") || strings.Contains(body, "0000****") {
			t.Errorf("card holder or number in an answer: %s", body)
		}
	}

	// File only: the preset and the suggested mapping, the card text reduced in the sample.
	r := send(e.bert, "/api/imports/preview", "", false)
	noCardText(r.body)
	p := decode[previewBody](t, r.body)
	if r.status != 200 || p.Preset == nil || *p.Preset != "bilance" || p.Mapping.AccountName == nil || *p.Mapping.AccountName != 8 ||
		p.Sample[0][6] != "Voorbeeld Winkel 02-11-2026 Antwerpen" {
		t.Fatalf("preview %d %s", r.status, r.body)
	}
	// Mapping only: the names and category pairs to map, and the unreadable row; no counts.
	r = send(e.bert, "/api/imports/preview", "", true)
	noCardText(r.body)
	p = decode[previewBody](t, r.body)
	if len(p.Accounts) != 2 || p.Accounts[0] != (accountNameBody{"Spaarrekening", 1}) || len(p.Categories) != 2 || p.Categories[1] != (categoryBody{"Inkomen", "Loon, premies", 1, 285000}) ||
		p.Counts != nil || len(p.Errors) != 1 || p.Errors[0].Line != 4 {
		t.Fatalf("mapping preview %s", r.body)
	}
	// With the names mapped: the counts of the import.
	r = send(e.bert, "/api/imports/preview", mapped, true)
	noCardText(r.body)
	if c := decode[previewBody](t, r.body).Counts; r.status != 200 || c == nil || *c != (countsBody{Rows: 3, New: 2, Invalid: 1}) {
		t.Fatalf("counts %s", r.body)
	}
	// A name without an account, and an account of someone else, store nothing.
	expectError(t, send(e.bert, "/api/imports", fmt.Sprintf(`{"Zichtrekening":%d}`, zicht), true), http.StatusBadRequest, "invalid")
	expectError(t, send(e.partner, "/api/imports", mapped, true), http.StatusNotFound, "not_found")
	if e.count(`SELECT COUNT(*) FROM import_batches`) != 0 {
		t.Fatal("a refused import left a batch")
	}

	r = send(e.bert, "/api/imports", mapped, true)
	noCardText(r.body)
	got := decode[importBody](t, r.body)
	if r.status != http.StatusCreated || len(got.Batches) != 2 || got.Batches[0].AccountID != zicht || got.Batches[1].AccountID != spaar ||
		got.Batches[0].Source != "bilance" || got.Batches[0].Imported != 1 || got.Batches[0].Invalid != 1 || got.Batches[1].Imported != 1 {
		t.Fatalf("import %d %s", r.status, r.body)
	}
	if e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = ? AND amount = -17000 AND booking_date = '2026-11-02' AND note = 'Voor het weekend'
		AND counterparty_name = 'Voorbeeld Winkel Antwerpen' AND communication = 'Voorbeeld Winkel 02-11-2026 Antwerpen'`, zicht) != 1 ||
		e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = ? AND amount = 285000 AND note IS NULL AND communication = '+++123/4567/89012+++'`, spaar) != 1 {
		t.Error("rows not stored as expected")
	}
	// The card holder and number live in raw_payload only.
	if e.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name || communication || COALESCE(note, '') LIKE '%Jan Voorbeeld%'
		OR counterparty_name || communication || COALESCE(note, '') LIKE '%0000****%'`) != 0 ||
		e.count(`SELECT COUNT(*) FROM transactions WHERE raw_payload LIKE '%Jan Voorbeeld%'`) != 1 {
		t.Error("card holder or number stored outside raw_payload")
	}
}

// The overrides of the parse settings reach the parser and come back in the answer.
func TestImportSettings(t *testing.T) {
	e := newBankEnv(t)
	r := e.upload(e.bert, "/api/imports/preview", append(importForm(csvHeader+csvCoffee, 0, ""), formPart{"settings", "", `{"delimiter":";","encoding":"windows-1252","dateFormat":"dmy","decimal":","}`})...)
	if p := decode[previewBody](t, r.body); r.status != 200 || p.Encoding != "windows-1252" || p.Delimiter != ";" {
		t.Fatalf("%d %s", r.status, r.body)
	}
}
