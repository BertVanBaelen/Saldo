package categorise

import (
	"strings"
	"unicode/utf8"
)

// ValidIcon reports whether s may be the icon of a category: one emoji, as
// the web's picker or the phone's emoji keyboard writes it (0.5.1-2). The
// check is on bytes and runes only: trimmed, 1 to 64 bytes, valid UTF-8, no
// ASCII letter, space or control character, ASCII digits, # and * only as
// part of a keycap (followed by U+FE0F or U+20E3), and at least one rune of
// U+00A9 or higher. shortcut: it does not count graphemes (that needs a
// Unicode table); the web enforces one with Intl.Segmenter, which is enough
// while only the web writes icons.
func ValidIcon(s string) bool {
	if s == "" || s != strings.TrimSpace(s) || len(s) > 64 || !utf8.ValidString(s) {
		return false
	}
	runes := []rune(s)
	high := false
	for i, r := range runes {
		switch {
		case r >= 0xA9:
			high = true
		case r >= '0' && r <= '9', r == '#', r == '*':
			if i+1 >= len(runes) || (runes[i+1] != 0xFE0F && runes[i+1] != 0x20E3) {
				return false
			}
		default: // ASCII letter, space, control, punctuation, or a rune below U+00A9
			return false
		}
	}
	return high
}
