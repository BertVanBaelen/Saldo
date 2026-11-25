package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/mail"
)

// GET /mail/<file> (0.9-1, docs/api.md "Mail images"): the logo and the two
// account icons the notification mails point at. Public like the web app: no
// session, no data, three static PNGs. Mail clients fetch them without cookies
// (Gmail through its own proxy), which is why a session cannot guard them.
// Registered as the GET /mail/ subtree (which also answers HEAD) so that
// everything else under it (the folder itself, other names, a deeper path) is a
// plain 404 instead of the web app's index.html; other methods fall to the web
// app's 405.

// mailImageCache is how long a client may keep an image. The names carry no
// hash, so it is not immutable; a day keeps a changed logo from lingering.
const mailImageCache = "public, max-age=86400"

var mailImageTags = sync.OnceValue(func() map[string]string {
	tags := make(map[string]string, len(mail.ImageNames))
	for _, name := range mail.ImageNames {
		b, _ := mail.Image(name)
		sum := sha256.Sum256(b)
		tags[name] = `"` + hex.EncodeToString(sum[:8]) + `"`
	}
	return tags
})

func (s *Server) getMailImage(w http.ResponseWriter, r *http.Request) {
	// An exact lookup of the file name: nothing of the path reaches a file system.
	name := strings.TrimPrefix(r.URL.Path, "/mail/")
	body, ok := mail.Image(name)
	if !ok {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "image/png")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", mailImageCache)
	h.Set("ETag", mailImageTags()[name])
	// ServeContent answers HEAD without the body and a matching If-None-Match with 304.
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(body))
}
