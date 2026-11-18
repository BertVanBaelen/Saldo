package demo

import (
	"context"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
)

// The seed of plan 0.8-1: 11 confirmed items (four with the counterparty
// IBAN of an own-account transfer), 4 budgets and 4 planned items, no
// ignored item and nothing on Partner's own account.
func TestDemoPlanningSeed(t *testing.T) {
	d := openDB(t)
	if _, err := Seed(context.Background(), d, fake.Provider{}, nil); err != nil {
		t.Fatal(err)
	}
	table := func(q string) string {
		t.Helper()
		var out string
		if err := d.QueryRow(`SELECT group_concat(row, char(10)) FROM (` + q + `)`).Scan(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	for name, c := range map[string]struct{ q, want string }{
		"items": {`SELECT account_id || '|' || description || '|' || counterparty || '|' || COALESCE(counterparty_iban, '-') || '|' || amount || '|' || frequency || '|' ||
			expected_day || '|' || COALESCE(expected_month, '-') || '|' || kind || '|' || state || '|' || amount_rule || '|' || COALESCE(user_id, '-') || '|' || COALESCE(end_date, '-') AS row
			FROM recurring_items ORDER BY id`, `1|Salaris|Werkgever NV|-|285000|monthly|2|-|income|confirmed|fixed|-|-
1|Huur|Immo Verhaeghe|-|-100500|monthly|1|-|expense|confirmed|fixed|-|-
1|Naar gedeelde rekening|Naar gedeelde rekening|BE12000000007730|-45000|monthly|1|-|transfer|confirmed|fixed|-|-
1|Netflix|Netflix|-|-1399|monthly|12|-|expense|confirmed|fixed|-|-
1|Naar spaarrekening|Naar spaarrekening|BE41000000001196|-20000|monthly|16|-|saving|confirmed|fixed|-|-
1|Spotify|Spotify|-|-1199|monthly|17|-|expense|confirmed|fixed|-|-
1|Familiale verzekering||-|-68400|yearly|15|1|expense|confirmed|fixed|-|-
4|Bijdrage Bert|Bert|BE68000000004821|45000|monthly|1|-|contribution|confirmed|fixed|-|-
4|Bijdrage Partner|Partner|BE71000000005038|45000|monthly|1|-|contribution|confirmed|fixed|-|-
4|Energie|Luminus|-|-14500|monthly|3|-|expense|confirmed|fixed|-|-
4|Internet en tv|Proximus|-|-4298|monthly|9|-|expense|confirmed|fixed|-|-`},
		"budgets": {`SELECT b.account_id || '|' || c.name || '|' || b.monthly_amount || '|' || b.from_month AS row FROM budgets b JOIN categories c ON c.id = b.category_id ORDER BY b.id`,
			`1|Vrije tijd|35000|2026-11
1|Vervoer|30000|2026-11
1|Overig|28798|2026-11
4|Boodschappen|55000|2026-11`},
		"planned": {`SELECT account_id || '|' || created_by || '|' || date || '|' || amount || '|' || description AS row FROM planned_items ORDER BY date`,
			`1|1|2026-12-20|-35000|Kerstcadeaus
1|1|2027-02-10|-200000|Autoherstelling
1|1|2027-07-15|-150000|Zomervakantie
1|1|2027-08-20|68000|Belastingteruggave`},
	} {
		if got := table(c.q); strings.TrimSpace(got) != c.want {
			t.Errorf("%s:\n%s\nwant\n%s", name, got, c.want)
		}
	}
	if n := count(t, d, `SELECT COUNT(*) FROM recurring_items WHERE account_id = 5`) + count(t, d, `SELECT COUNT(*) FROM budgets WHERE account_id = 5`); n != 0 {
		t.Errorf("%d planning rows on Partner's own account", n)
	}
}
