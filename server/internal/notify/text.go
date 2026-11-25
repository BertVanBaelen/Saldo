package notify

import (
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/push"
)

// Push text (plan 0.9 README decision 3). A web push cannot hide its text on
// the lock screen, so until the lock-screen spike (0.9-2 step 8, confirmed in
// 0.9-5) says otherwise every push is generic: no account name, no bank, no
// amount. The full text is built and tested too, so the spike's outcome is
// the one-line switch of Detail.

// Detail levels of a push.
const (
	DetailGeneric = "generic" // a title per type and "Ontgrendel om de details te zien"
	DetailFull    = "full"    // the account, the bank and the key amount
)

// Detail is the level every push is built at.
var Detail = DetailGeneric

// Line is the second line of a generic push.
const (
	Line         = "Ontgrendel om de details te zien"
	LineOverview = "Tik om te zien waar je geld heen ging."
)

// Text is what a push may say at detail full; Payload leaves out everything
// but Count at detail generic.
type Text struct {
	Account string // the account's name
	Bank    string // the bank of a connection
	Month   string // the month as the app writes it ("februari")
	Amount  int64  // the key amount in cents (end balance, missing part)
	Under   int64  // how far under the buffer (buffer)
	Days    int    // days left (consent)
	Count   int    // how many (cat): the only number a generic push shows
	Who     string // a person (joined, invite)
	Device  string // the new device (device)
}

// Payload builds the title, body and tone of a push of type typ at detail;
// the caller sets URL and Tag. An unknown type gets a neutral text.
func Payload(typ string, d Text, detail string) push.Payload {
	full := detail == DetailFull
	p := push.Payload{Body: Line, Tone: "info"}
	switch typ {
	case TypeRood:
		p.Tone, p.Title = "error", "Planning: actie nodig"
		if full {
			p.Title, p.Body = d.Account+" staat rood in "+d.Month, "Verwacht eindsaldo "+ledger.Eur0(d.Amount)
		}
	case TypeBuffer:
		p.Tone, p.Title = "warn", "Planning: let op"
		if full {
			p.Title = d.Account + " zakt in " + d.Month + " in de buffer"
			p.Body = "Verwacht " + ledger.Eur0(d.Amount) + ", " + ledger.Eur0(d.Under) + " onder je buffer"
		}
	case TypeConsent:
		p.Tone, p.Title = "warn", "Bankkoppeling verloopt binnenkort"
		if d.Days <= 3 {
			p.Tone = "error"
		}
		if full {
			p.Title = "Je " + d.Bank + "-koppeling verloopt over " + days(d.Days)
			if d.Days <= 0 {
				p.Title = "Je " + d.Bank + "-koppeling verloopt vandaag"
			}
			p.Body = "Koppel opnieuw om te blijven synchroniseren."
		}
	case TypeStop:
		p.Tone, p.Title = "error", "Bankkoppeling: actie nodig"
		if full {
			p.Title, p.Body = "Synchronisatie gestopt bij "+d.Bank, d.Account+" wordt niet meer bijgewerkt."
		}
	case TypeJoined:
		p.Title = "Gedeelde rekening: er is iets nieuws"
		if full {
			p.Title, p.Body = d.Who+" is erbij op de "+d.Account, "Jullie zien nu dezelfde transacties."
		}
	case TypeInvite:
		p.Title = "Gedeelde rekening: er is iets nieuws"
		if full {
			p.Title, p.Body = d.Who+" nodigt je uit voor de "+d.Account, "Bekijk de uitnodiging in Saldo."
		}
	case TypeContrib:
		p.Tone, p.Title = "warn", "Gedeelde rekening: let op"
		if full {
			p.Title, p.Body = "Bijdrage voor de "+d.Account+" ontbreekt", "Nog "+ledger.Eur0(d.Amount)+" te storten voor "+d.Month
		}
	case TypeCat:
		p.Title = strconv.Itoa(d.Count) + " transacties te categoriseren"
		if d.Count == 1 {
			p.Title = "1 transactie te categoriseren"
		}
		if full {
			p.Body = "Geef ze een categorie, dan kloppen je overzicht en je budgetten."
		}
	case TypeDevice:
		p.Tone, p.Title = "warn", "Nieuw toestel aangemeld"
		if full && d.Device != "" {
			p.Body = d.Device
		}
	case TypeWeek:
		p.Title, p.Body = "Weekoverzicht: je bon staat klaar", LineOverview
	case TypeMonth:
		p.Title, p.Body = "Maandoverzicht: je bon staat klaar", LineOverview
	default:
		p.Title = "Saldo"
	}
	return p
}

func days(n int) string {
	if n == 1 {
		return "1 dag"
	}
	return strconv.Itoa(n) + " dagen"
}
