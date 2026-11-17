package server

import (
	"net/http"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// The `category` parameter of GET /api/transactions (0.7-2) on the demo story.
func TestTransactionsCategoryParam(t *testing.T) {
	h, _ := demoServer(t)
	const october = "&from=2026-10-01&to=2026-10-31"

	// Bert's contribution of 1 October: the one row behind "Naar gedeelde rekening" of Persoonlijk.
	r := do(t, h, "GET", "/api/transactions?category=toShared&scope=persoonlijk"+october, "")
	if r.status != http.StatusOK {
		t.Fatalf("toShared: %d %s", r.status, r.body)
	}
	if page := decode[ledger.Page](t, r.body); len(page.Items) != 1 || page.Total != 1 || page.Items[0].Amount != -45000 || page.Items[0].BookingDate != "2026-10-01" {
		t.Errorf("toShared in October: %+v", page)
	}
	if page := decode[ledger.Page](t, do(t, h, "GET", "/api/transactions?category=toShared&scope=alles"+october, "").body); len(page.Items) != 0 {
		t.Errorf("toShared with scope alles: %+v", page)
	}

	for _, c := range []struct {
		query, message string
	}{
		{"category=abc", "Kies een categorie."},
		{"category=-1", "Kies een categorie."},
	} {
		if got := expectError(t, do(t, h, "GET", "/api/transactions?"+c.query, ""), http.StatusBadRequest, "invalid"); got != c.message {
			t.Errorf("%s: %q, want %q", c.query, got, c.message)
		}
	}
	// A savings account answers an empty list with a category (the report endpoint keeps its 400), its rows without.
	if page := decode[ledger.Page](t, do(t, h, "GET", "/api/transactions?category=1&account=2", "").body); len(page.Items) != 0 || page.Total != 0 || page.Items == nil {
		t.Errorf("category=1&account=2: %+v", page)
	}
	if r := do(t, h, "GET", "/api/transactions?account=2", ""); r.status != http.StatusOK {
		t.Errorf("account=2 without category: %d %s", r.status, r.body)
	}
	// A hidden account is still not found, with or without a category.
	expectError(t, do(t, h, "GET", "/api/transactions?category=1&account=5", ""), http.StatusNotFound, "not_found")
}
