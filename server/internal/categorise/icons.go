package categorise

import "slices"

// CategoryIcons is the fixed list of icon names a category may carry (CAT-6).
// The web draws them from web/src/lib/categoryIcons.ts, which must list the
// same names (icons_test.go checks it).
var CategoryIcons = []string{
	"home", "cart", "car", "fuel", "bus", "train", "bike", "plane", "bolt", "water",
	"flame", "wifi", "phone", "tv", "health", "pill", "sport", "food", "coffee", "beer",
	"gift", "school", "book", "kids", "paw", "bag", "shirt", "scissors", "wrench", "repeat",
	"wallet", "salary", "refund", "piggy", "bank", "receipt", "shield", "heart", "music", "film",
	"gamepad", "camera", "laptop", "tree", "ticket", "hotel", "tax", "tag", "dots",
}

// ValidIcon reports whether name is on the list.
func ValidIcon(name string) bool { return slices.Contains(CategoryIcons, name) }
