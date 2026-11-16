package server

import (
	"net/http"
	"strings"
	"testing"
)

// Review (0.6-2): a notice about someone who is no longer a co-member names
// them as they were at the event. Their live name would tell the reader a
// rename made after they left, by a user who no longer shares an account.
func TestNoticeKeepsTheFormerMembersName(t *testing.T) {
	t.Run("left", func(t *testing.T) {
		p := newPair(t)
		if r := p.partner("POST", "/api/accounts/4/leave", ""); r.status != http.StatusOK {
			t.Fatalf("leave: %d %s", r.status, r.body)
		}
		if r := p.partner("PATCH", "/api/me", `{"name": "Nieuwe naam"}`); r.status != http.StatusOK {
			t.Fatalf("rename: %d %s", r.status, r.body)
		}
		if body := p.bert("GET", "/api/alerts", "").body; strings.Contains(body, "Nieuwe naam") {
			t.Errorf("Bert's alerts show Partner's name chosen after she left: %s", body)
		}
		sameAlerts(t, "Bert", noticeAlerts(t, p.bertH), leftAlert("Partner"))
	})
	t.Run("deleted", func(t *testing.T) {
		p := newPair(t)
		if r := p.bert("DELETE", "/api/accounts/4?confirm=Gedeelde+rekening", ""); r.status != http.StatusNoContent {
			t.Fatalf("delete: %d %s", r.status, r.body)
		}
		if r := p.bert("PATCH", "/api/me", `{"name": "Nieuwe naam"}`); r.status != http.StatusOK {
			t.Fatalf("rename: %d %s", r.status, r.body)
		}
		body := p.partner("GET", "/api/alerts", "").body
		if strings.Contains(body, "Nieuwe naam") || !strings.Contains(body, "Bert heeft Gedeelde rekening verwijderd") {
			t.Errorf("Partner's alerts must name Bert as he was when he deleted the account: %s", body)
		}
	})
}
