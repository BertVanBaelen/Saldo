package server

import (
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const notBuilt = "Saldo draait, maar de webapp is nog niet gebouwd. De API staat onder /api.\n"

// Types the minimal add-on image may not know from /etc/mime.types.
func init() {
	for ext, typ := range map[string]string{
		".webmanifest": "application/manifest+json",
		".woff2":       "font/woff2",
		".woff":        "font/woff",
		".ico":         "image/x-icon",
		".txt":         "text/plain; charset=utf-8",
	} {
		_ = mime.AddExtensionType(ext, typ)
	}
}

// webRoot opens the built web app, or returns nil when SALDO_WEB_DIR is
// empty or has no index.html. It is opened per request so a build made while
// the server runs is picked up; os.Root keeps every lookup inside the folder.
func (s *Server) webRoot() *os.Root {
	dir := s.opts.WebDir
	if dir == "" {
		return nil
	}
	if st, err := os.Stat(filepath.Join(dir, "index.html")); err != nil || st.IsDir() {
		return nil
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil
	}
	return root
}

// serveWeb serves the web app: real files as they are, /assets/* with long
// immutable caching (Vite puts a content hash in those names), and every
// other GET path the app's index.html, so client-side routes work on reload.
func (s *Server) serveWeb(w http.ResponseWriter, r *http.Request) {
	if isAPI(r.URL.Path) {
		writeError(w, http.StatusNotFound, "not_found", msgNotFound)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Methode niet toegestaan.", http.StatusMethodNotAllowed)
		return
	}
	root := s.webRoot()
	if root == nil {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		io.WriteString(w, notBuilt)
		return
	}
	defer root.Close()
	fsys := root.FS()
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	if servable(name) && s.serveFile(w, r, fsys, name) {
		return
	}
	if strings.HasPrefix(name, "assets/") {
		http.NotFound(w, r)
		return
	}
	if !s.serveFile(w, r, fsys, "index.html") {
		http.NotFound(w, r)
	}
}

// servable rejects hidden files and folders.
func servable(name string) bool {
	if !fs.ValidPath(name) {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") {
			return false
		}
	}
	return true
}

func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) bool {
	f, err := fsys.Open(name)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			s.log.WarnContext(r.Context(), "web: open failed", "file", name, "error", err)
		}
		return false
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		return false
	}
	rs, ok := f.(io.ReadSeeker)
	if !ok {
		return false
	}
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, name, st.ModTime(), rs)
	return true
}
