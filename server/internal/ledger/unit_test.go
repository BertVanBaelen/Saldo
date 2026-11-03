package ledger

import (
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

func TestMaskIBAN(t *testing.T) {
	tests := []struct{ in, want string }{
		{"BE68000000004821", "BE68 •••• •••• 4821"},
		{"be68 0000 0000 4821", "BE68 •••• •••• 4821"},
		{" BE12-0000-0000-7730 ", "BE12 •••• •••• 7730"},
		{"NL91ABNA0417164300", "NL91 •••• •••• •••• 4300"},
		{"FR1420041010050500013M02606", "FR14 •••• •••• •••• •••• •••• 2606"},
		{"", ""},
		{"BE68", ""},
	}
	for _, tt := range tests {
		if got := MaskIBAN(tt.in); got != tt.want {
			t.Errorf("MaskIBAN(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestState(t *testing.T) {
	str := func(p *string) string {
		if p == nil {
			return "<nil>"
		}
		return *p
	}
	tests := []struct {
		typ             string
		balance, buffer int64
		want            string
	}{
		{"current", 196882, 90000, "ok"},
		{"current", 90000, 90000, "ok"},
		{"current", 89999, 90000, "buffer"},
		{"current", 0, 90000, "buffer"},
		{"current", -1, 90000, "neg"},
		{"current", -1, 0, "neg"},
		{"current", 0, 0, "ok"},
		{"savings", 1250000, 0, "<nil>"},
		{"savings", -5, 0, "<nil>"},
	}
	for _, tt := range tests {
		if got := str(State(tt.typ, tt.balance, tt.buffer)); got != tt.want {
			t.Errorf("State(%s, %d, %d) = %s, want %s", tt.typ, tt.balance, tt.buffer, got, tt.want)
		}
	}
}

func TestSyncState(t *testing.T) {
	now := time.Date(2026, 11, 18, 12, 0, 0, 0, clock.Brussels)
	recent := now.Add(-8 * time.Hour)
	old := now.Add(-40 * time.Hour)
	tests := []struct {
		name     string
		srcs     []source
		want     string
		wantLast time.Time
	}{
		{"primary fine", []source{{primary: true, usable: true, lastSync: recent, hasSync: true}}, "ok", recent},
		{"primary old", []source{{primary: true, usable: true, lastSync: old, hasSync: true}}, "stale", old},
		{"never synced", []source{{primary: true, usable: true}}, "stale", time.Time{}},
		{"primary failed, fallback takes over", []source{
			{primary: true, usable: false, lastSync: old, hasSync: true},
			{primary: false, usable: true, lastSync: recent, hasSync: true},
		}, "ok", recent},
		{"primary wins over a newer fallback", []source{
			{primary: true, usable: true, lastSync: old, hasSync: true},
			{primary: false, usable: true, lastSync: recent, hasSync: true},
		}, "stale", old},
		{"everything failed", []source{
			{primary: true, usable: false, lastSync: old, hasSync: true},
			{primary: false, usable: false, lastSync: recent, hasSync: true},
		}, "failed", recent},
		{"no source", nil, "stale", time.Time{}},
	}
	for _, tt := range tests {
		got, last := syncState(tt.srcs, now)
		if got != tt.want || !last.Equal(tt.wantLast) {
			t.Errorf("%s: got %s %v, want %s %v", tt.name, got, last, tt.want, tt.wantLast)
		}
	}
}

func TestAmountQuery(t *testing.T) {
	tests := []struct {
		in   string
		want string
		ok   bool
	}{
		{"24,99", "24,99", true},
		{"24.99", "24,99", true},
		{"€ 24,99", "24,99", true},
		{"-24,99", "24,99", true},
		{"−1.005,00", "1005,00", true},
		{"1.005", "1005", true},
		{"2850", "2850", true},
		{"24,9", "24,9", true},
		{"Bol.com", "", false},
		{"4471-2210", "", false},
		{"12,345", "", false},
	}
	for _, tt := range tests {
		got, ok := amountQuery(tt.in)
		if got != tt.want || ok != tt.ok {
			t.Errorf("amountQuery(%q) = %q, %v; want %q, %v", tt.in, got, ok, tt.want, tt.ok)
		}
	}
}

func TestCursor(t *testing.T) {
	c := cursor{date: "2026-11-16", id: 1234}
	got, err := decodeCursor(c.encode())
	if err != nil || got != c {
		t.Fatalf("round trip: %+v, %v", got, err)
	}
	for _, bad := range []string{"", "!!", "MjAyNi0xMS0xNg", "eHx5", c.encode() + "x"} {
		if _, err := decodeCursor(bad); err == nil {
			t.Errorf("decodeCursor(%q) accepted", bad)
		}
	}
}

func TestWhenDutch(t *testing.T) {
	now := time.Date(2026, 11, 18, 21, 0, 0, 0, clock.Brussels) // Wednesday
	tests := []struct {
		t    time.Time
		want string
	}{
		{time.Date(2026, 11, 18, 3, 2, 0, 0, time.UTC), "vandaag 04:02"},
		{time.Date(2026, 11, 17, 4, 2, 0, 0, clock.Brussels), "gisteren 04:02"},
		{time.Date(2026, 11, 15, 4, 2, 0, 0, clock.Brussels), "zondag 04:02"},
		{time.Date(2026, 11, 2, 4, 2, 0, 0, clock.Brussels), "2 november 04:02"},
		{time.Date(2025, 12, 24, 9, 30, 0, 0, clock.Brussels), "24 december 2025 09:30"},
	}
	for _, tt := range tests {
		if got := whenDutch(tt.t, now); got != tt.want {
			t.Errorf("whenDutch(%v) = %q, want %q", tt.t, got, tt.want)
		}
	}
}

func TestDedupeKeys(t *testing.T) {
	coffee := bank.Transaction{BookingDate: "2026-11-18", Amount: -350, CounterpartyName: "Koffiebar", Communication: "Bancontact", Status: bank.StatusBooked}
	booked := coffee
	booked.EntryReference = "REF-1"
	rows := Keyed(1, "be68 0000 0000 4821", 0, []bank.Transaction{coffee, coffee, booked})
	if rows[0].DedupeKey != rows[1].DedupeKey || rows[0].Occurrence != 1 || rows[1].Occurrence != 2 {
		t.Errorf("two identical coffees: %+v", rows[:2])
	}
	if rows[2].DedupeKey != "ref:BE68000000004821:REF-1" || rows[2].Occurrence != 1 {
		t.Errorf("booked with reference: %s/%d", rows[2].DedupeKey, rows[2].Occurrence)
	}
	pending := booked
	pending.Status = bank.StatusPending
	if DedupeKey("BE68000000004821", pending) != "hash:"+ContentHash(coffee) {
		t.Error("a pending row must use the content hash")
	}
	spaced := coffee
	spaced.CounterpartyName = "  koffiebar "
	if ContentHash(spaced) != ContentHash(coffee) {
		t.Error("the content hash must ignore case and spacing")
	}
}
