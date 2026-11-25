package server

import (
	"net/http"
	"os"
	"strings"
	"testing"
)

// GET /mail/<file> (0.9-1): three static PNGs, public, nothing else.

var mailImageFiles = []string{"logo.png", "person.png", "people.png"}

func TestMailImagesAreServedWithoutASession(t *testing.T) {
	// A server that wants a device cookie: the control shows /api/ is guarded and /mail/ is not.
	e := newEnv(t)
	if r := e.get("/api/me", ""); r.status != http.StatusUnauthorized {
		t.Fatalf("control: /api/me without a session answers %d", r.status)
	}
	for _, name := range mailImageFiles {
		want, err := os.ReadFile("../mail/img/" + name)
		if err != nil {
			t.Fatal(err)
		}
		r := e.get("/mail/"+name, "")
		if r.status != http.StatusOK || r.body != string(want) {
			t.Fatalf("%s: %d, %d bytes, want 200 and the %d bytes of the file", name, r.status, len(r.body), len(want))
		}
		if !strings.HasPrefix(r.body, "\x89PNG\r\n\x1a\n") {
			t.Errorf("%s is not a PNG", name)
		}
		h := r.header
		if h.Get("Content-Type") != "image/png" || h.Get("X-Content-Type-Options") != "nosniff" ||
			h.Get("Cache-Control") != "public, max-age=86400" || h.Get("ETag") == "" {
			t.Errorf("%s: headers %v", name, h)
		}
		if h.Get("Set-Cookie") != "" {
			t.Errorf("%s sets a cookie: %v", name, h)
		}

		// A client that has the image asks again with its tag and gets no body.
		if again := e.do(call{method: "GET", path: "/mail/" + name, header: map[string]string{"If-None-Match": h.Get("ETag")}}); again.status != http.StatusNotModified || again.body != "" {
			t.Errorf("%s with its ETag: %d, %d bytes", name, again.status, len(again.body))
		}
		// HEAD has the headers and no body.
		head := e.do(call{method: "HEAD", path: "/mail/" + name})
		if head.status != http.StatusOK || head.body != "" || head.header.Get("Content-Type") != "image/png" ||
			head.header.Get("Content-Length") != r.header.Get("Content-Length") {
			t.Errorf("HEAD %s: %d, %d bytes, headers %v", name, head.status, len(head.body), head.header)
		}
	}
}

func TestMailImagesServeNothingElse(t *testing.T) {
	e := newEnv(t)
	logo := e.get("/mail/logo.png", "").body
	for _, path := range []string{
		"/mail/", "/mail/nope.png", "/mail/LOGO.png", "/mail/logo.PNG", "/mail/logo.png/", "/mail/logo.png/x", "/mail/img/logo.png",
		"/mail/%2e%2e/logo.png", "/mail/..%2flogo.png", "/mail/%2e%2e%2fapi/health", "/mail/logo.png%00", "/mail//logo.png",
		"/mail/templates/layout.html", "/mail/receipt.html", "/mail/.", "/mail/..", "/mailx/logo.png",
	} {
		r := e.get(path, "")
		if r.status == http.StatusOK && (r.body == logo || strings.HasPrefix(r.body, "\x89PNG") || r.header.Get("Content-Type") == "image/png") {
			t.Errorf("GET %s serves an image: %d", path, r.status)
		}
		// Under /mail/ it is a 404, or the mux's redirect to the cleaned path.
		if strings.HasPrefix(path, "/mail/") && r.status != http.StatusNotFound && r.status/100 != 3 {
			t.Errorf("GET %s: %d, want 404 or a redirect", path, r.status)
		}
	}
	// A cleaned path is redirected by the mux, never served as the image under another name.
	if r := e.get("/mail/../api/health", ""); r.status == http.StatusOK && strings.HasPrefix(r.body, "\x89PNG") {
		t.Errorf("a .. path serves an image")
	}
	// Writes are the web app's 405.
	for _, method := range []string{"POST", "PUT", "PATCH", "DELETE"} {
		r := e.do(call{method: method, path: "/mail/logo.png", body: "{}"})
		if r.status != http.StatusMethodNotAllowed && r.status != http.StatusForbidden {
			t.Errorf("%s /mail/logo.png: %d", method, r.status)
		}
		if r.header.Get("Content-Type") == "image/png" {
			t.Errorf("%s /mail/logo.png answers an image", method)
		}
	}
}
