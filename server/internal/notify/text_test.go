package notify

import (
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// TestGenericPushLeaksNothing is the property of README decision 3: for every
// type and many names chosen to leak easily (short, common words, names that
// look like amounts), the generic push names no account, bank, person or
// device and shows no euro amount; the full push does name them, so the
// switch of Detail is real.
func TestGenericPushLeaksNothing(t *testing.T) {
	// Not substrings of the fixed generic copy: "Planning" or "Gedeelde
	// rekening" as an account name would match the title itself.
	accounts := []string{"Zichtrekening", "Rekening van Partner", "Vakantiepot", "Bert", "Kaart 4821", "€ 1.033", "Huis & Tuin", "Ö"}
	banks := []string{"Argenta", "KBC", "Belfius", "ING", "BNP Paribas Fortis", "Crelan"}
	people := []string{"Partner", "Anna", "Jo"}
	devices := []string{"Safari op iPhone", "Chrome op Android"}
	r := rand.New(rand.NewPCG(9, 3))
	for i := range 500 {
		d := Text{
			Account: accounts[i%len(accounts)],
			Bank:    banks[r.IntN(len(banks))],
			Month:   "februari",
			Amount:  r.Int64N(10_000_000) - 5_000_000,
			Under:   r.Int64N(1_000_000),
			Days:    r.IntN(15),
			Count:   1 + r.IntN(40),
			Who:     people[r.IntN(len(people))],
			Device:  devices[r.IntN(len(devices))],
		}
		for _, typ := range Types {
			g := Payload(typ.Key, d, DetailGeneric)
			text := g.Title + "\n" + g.Body
			for _, leak := range []string{d.Account, d.Bank, d.Who, d.Device, "€", ledger.Eur0(d.Amount), ledger.Eur0(d.Under), "februari"} {
				if strings.Contains(text, leak) {
					t.Fatalf("%s generic push %q leaks %q", typ.Key, text, leak)
				}
			}
			want := Line
			if typ.Key == TypeWeek || typ.Key == TypeMonth {
				want = LineOverview
			}
			if g.Body != want || g.Title == "" {
				t.Fatalf("%s generic push %q / %q", typ.Key, g.Title, g.Body)
			}
		}
	}

	// The full texts carry the details.
	d := Text{Account: "Zichtrekening", Bank: "Argenta", Month: "februari", Amount: -103300, Under: 27800, Days: 14, Count: 8, Who: "Partner", Device: "Safari op iPhone"}
	for typ, want := range map[string]string{
		TypeRood:    "Zichtrekening staat rood in februari / Verwacht eindsaldo −€ 1.033",
		TypeBuffer:  "Zichtrekening zakt in februari in de buffer / Verwacht −€ 1.033, € 278 onder je buffer",
		TypeConsent: "Je Argenta-koppeling verloopt over 14 dagen / Koppel opnieuw om te blijven synchroniseren.",
		TypeStop:    "Synchronisatie gestopt bij Argenta / Zichtrekening wordt niet meer bijgewerkt.",
		TypeJoined:  "Partner is erbij op de Zichtrekening / Jullie zien nu dezelfde transacties.",
		TypeCat:     "8 transacties te categoriseren / Geef ze een categorie, dan kloppen je overzicht en je budgetten.",
		TypeDevice:  "Nieuw toestel aangemeld / Safari op iPhone",
		TypeWeek:    "Weekoverzicht: je bon staat klaar / " + LineOverview,
	} {
		p := Payload(typ, d, DetailFull)
		if got := p.Title + " / " + p.Body; got != want {
			t.Errorf("%s full: %q, want %q", typ, got, want)
		}
	}
	for typ, want := range map[string]string{
		TypeRood: "Planning: actie nodig", TypeBuffer: "Planning: let op", TypeConsent: "Bankkoppeling verloopt binnenkort",
		TypeStop: "Bankkoppeling: actie nodig", TypeJoined: "Gedeelde rekening: er is iets nieuws", TypeInvite: "Gedeelde rekening: er is iets nieuws",
		TypeContrib: "Gedeelde rekening: let op", TypeCat: "8 transacties te categoriseren", TypeDevice: "Nieuw toestel aangemeld",
		TypeWeek: "Weekoverzicht: je bon staat klaar", TypeMonth: "Maandoverzicht: je bon staat klaar",
	} {
		if got := Payload(typ, d, DetailGeneric).Title; got != want {
			t.Errorf("%s generic title %q, want %q", typ, got, want)
		}
	}
	if got := Payload(TypeCat, Text{Count: 1}, DetailGeneric).Title; got != "1 transactie te categoriseren" {
		t.Errorf("one to categorise: %q", got)
	}
	if Detail != DetailGeneric {
		t.Errorf("Detail is %q until the lock-screen spike says otherwise", Detail)
	}
}
