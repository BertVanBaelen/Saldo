package notify

import (
	"context"
	"database/sql"
)

// Type keys, pinned (plan 0.9 README decision 9): notification_prefs.type,
// notification_log.type and the Meldingen screen use them. The alert types of
// GET /api/alerts are another namespace.
const (
	TypeRood    = "rood"    // Rekening staat rood
	TypeBuffer  = "buffer"  // Rekening komt in de buffer
	TypeConsent = "consent" // Koppeling verloopt
	TypeStop    = "stop"    // Synchronisatie gestopt
	TypeJoined  = "joined"  // Iemand sluit aan
	TypeInvite  = "invite"  // Uitnodiging voor een gedeelde rekening
	TypeContrib = "contrib" // Bijdrage ontbreekt
	TypeCat     = "cat"     // Te categoriseren
	TypeDevice  = "device"  // Nieuw toestel aangemeld
	TypeWeek    = "week"    // Weekoverzicht
	TypeMonth   = "month"   // Maandoverzicht
)

// Group is a group of the Meldingen screen. ID is stable (the API and the web
// app use it); Label is the Dutch heading in mixed case: the screen styles it
// uppercase.
type Group struct {
	ID    string
	Label string
}

// Groups are the groups of the Meldingen screen, in screen order
// (analysis/screens/meldingen.md).
var Groups = []Group{
	{"planning", "Planning"},
	{"bank", "Bank"},
	{"gedeeld", "Gedeeld"},
	{"transacties", "Transacties"},
	{"overzicht", "Overzicht"},
	{"beveiliging", "Beveiliging"},
}

// Type is one notification type with its defaults
// (analysis/concepts/notification.md, "Types and defaults").
type Type struct {
	Key     string
	Name    string // Dutch, as the Meldingen screen shows it
	Subline string // Dutch one-line description under the name
	Group   string // the ID of a Group of Groups
	Dot     string // the colour token of the dot ("--neg")
	// Push and Email are the defaults when the user has no notification_prefs
	// row for the type.
	Push, Email bool
	// AlwaysEmail: the e-mail goes out whatever the chip and the e-mail
	// switch say (the new-device mail).
	AlwaysEmail bool
	// Security: quiet hours do not hold the push back.
	Security bool
}

// Types is the one table of notification types, in the order of the
// Meldingen screen: grouped as Groups, so a list in this order is ready to
// render. The API (0.9-4) and the dispatcher both read it.
var Types = []Type{
	{Key: TypeRood, Name: "Rekening staat rood", Subline: "Als een rekening in de planning onder € 0 zakt", Group: "planning", Dot: "--neg", Push: true, Email: true},
	{Key: TypeBuffer, Name: "Rekening komt in de buffer", Subline: "Als een rekening onder haar eigen buffer zakt", Group: "planning", Dot: "--warn", Push: true, Email: false},
	{Key: TypeConsent, Name: "Koppeling verloopt", Subline: "14 en 3 dagen vooraf", Group: "bank", Dot: "--warn", Push: true, Email: true},
	{Key: TypeStop, Name: "Synchronisatie gestopt", Subline: "Als Saldo een rekening niet meer kan lezen", Group: "bank", Dot: "--neg", Push: true, Email: true},
	{Key: TypeJoined, Name: "Iemand sluit aan", Subline: "Bij een gedeelde rekening waar jij beheerder bent", Group: "gedeeld", Dot: "--shared", Push: true, Email: true},
	{Key: TypeInvite, Name: "Uitnodiging voor een gedeelde rekening", Subline: "Als een beheerder je uitnodigt", Group: "gedeeld", Dot: "--shared", Push: true, Email: true},
	{Key: TypeContrib, Name: "Bijdrage ontbreekt", Subline: "Als een bijdrage op de 3e nog niet binnen is", Group: "gedeeld", Dot: "--shared", Push: false, Email: false},
	{Key: TypeCat, Name: "Te categoriseren", Subline: "Eén keer per dag om 19:00, als er iets is", Group: "transacties", Dot: "--green", Push: true, Email: false},
	{Key: TypeWeek, Name: "Weekoverzicht", Subline: "Elke zondag om 19:00, met wat je uitgaf per categorie", Group: "overzicht", Dot: "--green", Push: false, Email: false},
	{Key: TypeMonth, Name: "Maandoverzicht", Subline: "Op de laatste dag van de maand om 19:00, met je budgetten", Group: "overzicht", Dot: "--green", Push: false, Email: false},
	{Key: TypeDevice, Name: "Nieuw toestel aangemeld", Subline: "Als iemand inlogt op een nieuw toestel", Group: "beveiliging", Dot: "--warn", Push: true, Email: true, AlwaysEmail: true, Security: true},
}

// TypeByKey returns the type with this key.
func TypeByKey(key string) (Type, bool) {
	for _, t := range Types {
		if t.Key == key {
			return t, true
		}
	}
	return Type{}, false
}

// Pref is a user's choice for one type: the push and the e-mail chip.
type Pref struct{ Push, Email bool }

// Effective merges the stored notification_prefs rows (by type key) over the
// defaults of Types: a missing row means the default, not "on". Rows of
// unknown types are ignored. The e-mail of an AlwaysEmail type is always on.
func Effective(stored map[string]Pref) map[string]Pref {
	out := make(map[string]Pref, len(Types))
	for _, t := range Types {
		p, ok := stored[t.Key]
		if !ok {
			p = Pref{Push: t.Push, Email: t.Email}
		}
		if t.AlwaysEmail {
			p.Email = true
		}
		out[t.Key] = p
	}
	return out
}

// Prefs returns the user's effective preferences per type.
func Prefs(ctx context.Context, db *sql.DB, user int64) (map[string]Pref, error) {
	stored, err := storedPrefs(ctx, db, user)
	if err != nil {
		return nil, err
	}
	return Effective(stored), nil
}
