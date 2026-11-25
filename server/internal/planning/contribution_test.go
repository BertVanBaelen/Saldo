package planning

import "testing"

func TestMemberPart(t *testing.T) {
	share := func(n int) *int { return &n }
	for _, c := range []struct {
		need     int64
		share    *int
		parties  int
		pct      int
		required int64
	}{
		{87118, nil, 2, 50, 43600},       // the demo: € 871,18 → € 436 each
		{87118, share(70), 2, 70, 61000}, // € 609,83 → € 610
		{87118, share(30), 2, 30, 26200}, // € 261,35 → € 262
		{87118, nil, 3, 33, 29100},       // three never sum below the need
		{87118, share(0), 2, 0, 0},
		{0, nil, 2, 50, 0},
		{100000, nil, 2, 50, 50000}, // whole euros stay
	} {
		pct, req := MemberPart(c.need, c.share, c.parties)
		if pct != c.pct || req != c.required {
			t.Errorf("MemberPart(%d, %v, %d) = %d, %d; want %d, %d", c.need, c.share, c.parties, pct, req, c.pct, c.required)
		}
	}
	if CeilEuros(87118, 100) != 87200 {
		t.Error("CeilEuros")
	}
}
