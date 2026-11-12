package server

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Undo of an import (0.5-5) over HTTP: the preview counts what goes, the undo
// removes the rows and is refused a second time, the history shows when, and
// the same file imports again with all its rows.
func TestImportUndo(t *testing.T) {
	e := newBankEnv(t)
	if err := categorise.SeedDefaults(context.Background(), e.db); err != nil {
		t.Fatal(err)
	}
	account := decode[ledger.Account](t, e.as(e.bert, "POST", "/api/accounts", `{"name":"Zicht","type":"current"}`).body).ID
	file := csvHeader + csvCoffee + csvBread
	batch := e.importOK(e.bert, account, file).Batches[0]
	path := "/api/imports/" + strconv.FormatInt(batch.ID, 10)
	if _, err := e.db.Exec(`UPDATE transactions SET category_id = 1, category_origin = 'manual' WHERE counterparty_name = 'Bakker Test'`); err != nil {
		t.Fatal(err)
	}

	if r := e.as(e.bert, "GET", path+"/undo-preview", ""); r.status != 200 || strings.TrimSpace(r.body) != `{"batches":1,"rows":2,"changed":1,"categorised":1}` {
		t.Fatalf("preview: %d %s", r.status, r.body)
	}
	expectError(t, e.as(e.bert, "POST", path+"/undo?run=2", ""), http.StatusBadRequest, "invalid")
	if r := e.as(e.bert, "POST", path+"/undo", ""); r.status != 200 || strings.TrimSpace(r.body) != `{"batches":1,"removed":2}` {
		t.Fatalf("undo: %d %s", r.status, r.body)
	}
	if e.count(`SELECT COUNT(*) FROM transactions`) != 0 || e.count(`SELECT COUNT(*) FROM audit_log WHERE event = 'import_undone' AND user_id = ?`, e.bert) != 1 {
		t.Error("rows left, or no audit entry")
	}
	expectError(t, e.as(e.bert, "POST", path+"/undo", ""), http.StatusBadRequest, "invalid")
	expectError(t, e.as(e.bert, "GET", path+"/undo-preview", ""), http.StatusBadRequest, "invalid")
	list := decode[[]ledger.Batch](t, e.as(e.bert, "GET", "/api/imports", "").body)
	if len(list) != 1 || list[0].UndoneAt == nil || list[0].Run != batch.ID {
		t.Errorf("history: %+v", list)
	}

	if again := e.importOK(e.bert, account, file).Batches[0]; again.Imported != 2 || again.Present != 0 {
		t.Errorf("re-import after the undo: %+v", again)
	}
}
