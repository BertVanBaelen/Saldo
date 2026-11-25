package mail

import (
	_ "embed"
)

// The images of the notification mails: the logo and the two account icons
// (green person, violet people), PNG because Gmail and Outlook drop SVG. The
// layout points at <BaseURL>/mail/<name>; the server serves exactly these
// files there, without a session (GET /mail/, docs/api.md). Each file is
// embedded by name, so a file dropped into img/ later is not served by
// accident.

//go:embed img/logo.png
var logoPNG []byte

//go:embed img/person.png
var personPNG []byte

//go:embed img/people.png
var peoplePNG []byte

var images = map[string][]byte{
	"logo.png":   logoPNG,
	"person.png": personPNG,
	"people.png": peoplePNG,
}

// ImageNames are the file names Image knows, in the order the layout uses them.
var ImageNames = []string{"logo.png", "person.png", "people.png"}

// Image returns the PNG named name (a bare file name such as "logo.png", as
// it appears after /mail/) and true, or nil and false for any other name.
// The bytes are shared: callers must not modify them.
func Image(name string) ([]byte, bool) {
	b, ok := images[name]
	return b, ok
}
