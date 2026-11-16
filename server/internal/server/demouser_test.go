package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func meName(t *testing.T, h http.Handler, cookie string) string {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/me", nil)
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: demoCookie, Value: cookie})
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Body.String()
}

func TestDemoCanActAsPartner(t *testing.T) {
	h, _ := demoServer(t)
	if got := meName(t, h, ""); !strings.Contains(got, `"name":"Bert"`) {
		t.Fatalf("default viewer is not Bert: %s", got)
	}
	r := do(t, h, "GET", "/api/demo/as/partner", "")
	if r.status != http.StatusNoContent {
		t.Fatalf("switch answered %d", r.status)
	}
	if c := r.header.Get("Set-Cookie"); !strings.Contains(c, demoCookie+"=partner") {
		t.Fatalf("no partner cookie: %q", c)
	}
	if got := meName(t, h, "partner"); !strings.Contains(got, `"name":"Partner"`) {
		t.Fatalf("cookie did not switch to Partner: %s", got)
	}
	if got := meName(t, h, "other"); !strings.Contains(got, `"name":"Bert"`) {
		t.Fatalf("an unknown cookie value must stay Bert: %s", got)
	}
	if r := do(t, h, "GET", "/api/demo/as/mallory", ""); r.status != http.StatusNotFound {
		t.Fatalf("unknown demo user answered %d", r.status)
	}
}

// Outside demo mode the route does not exist and the cookie means nothing.
func TestDemoSwitchIsDemoOnly(t *testing.T) {
	d := seededDB(t)
	h := New(Options{DB: d, Version: "test", Clock: demoClock})
	if r := do(t, h, "GET", "/api/demo/as/partner", ""); r.status == http.StatusNoContent || r.header.Get("Set-Cookie") != "" {
		t.Fatalf("the demo switch answered outside demo mode: %d %q", r.status, r.header.Get("Set-Cookie"))
	}
	req := httptest.NewRequest("GET", "/api/me", nil)
	req.AddCookie(&http.Cookie{Name: demoCookie, Value: "partner"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusUnauthorized {
		t.Fatalf("the cookie signed someone in outside demo mode: %d %s", rec.Code, rec.Body.String())
	}
}
