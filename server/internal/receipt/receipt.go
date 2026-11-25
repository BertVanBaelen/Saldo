package receipt

import (
	"context"
	"database/sql"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// Model is the receipt of one period (plan 0.9-3c, "The model"). Money in
// cents. It carries numbers and words only: no colour and no verdict (risk
// 16); the page and the e-mail decide how to draw them.
type Model struct {
	Period      string   `json:"period"` // week | maand | kwartaal | jaar | eigen
	From        string   `json:"from"`
	To          string   `json:"to"`
	Label       string   `json:"label"`
	Scope       string   `json:"scope"`
	Account     int64    `json:"account,omitempty"`
	ScopeLabel  string   `json:"scopeLabel"`
	Running     bool     `json:"running"`
	PartialFrom *string  `json:"partialFrom"`
	Stand       string   `json:"stand"`
	Income      Section  `json:"income"`
	Expenses    Expenses `json:"expenses"`
	Saved       Section  `json:"saved"`
	Result      Result   `json:"result"`
	Notes       []string `json:"notes"`
	Empty       bool     `json:"empty"`
}

// Section is income or saved: a total and its rows, each a top category
// (with its subcategories as children) or a pseudo row.
type Section struct {
	Total int64  `json:"total"`
	Prev  *int64 `json:"prev,omitempty"`
	Trend *Trend `json:"trend,omitempty"`
	Rows  []Row  `json:"rows"`
}

// Expenses is the expense total and its groups, largest first.
type Expenses struct {
	Total  int64  `json:"total"`
	Prev   *int64 `json:"prev,omitempty"`
	Trend  *Trend `json:"trend,omitempty"`
	Groups []Row  `json:"groups"`
}

// Row is one line of the receipt. Prev, Trend and Budget are set on expense
// groups only; Children only when more than one own-category entry is in it.
type Row struct {
	Key      string  `json:"key"`
	Name     string  `json:"name"`
	Emoji    *string `json:"emoji,omitempty"`
	Amount   int64   `json:"amount"`
	Prev     *int64  `json:"prev,omitempty"`
	Trend    *Trend  `json:"trend,omitempty"`
	Budget   *Budget `json:"budget,omitempty"`
	Children []Row   `json:"children,omitempty"`
}

// Trend is the change against the previous period: Pct the rounded percent
// (absent for new), Kind up (above +5), down (below −5), flat or new.
type Trend struct {
	Pct  *int   `json:"pct,omitempty"`
	Kind string `json:"kind"`
}

// Budget is what a month's group is read against: the sum of the selection's
// references (GET /api/reports/budgets) and their source, budget, average or
// mixed (accounts with either, as columnReferences in lib/reports.ts). Pct is
// absent for a reference of 0.
type Budget struct {
	Amount int64  `json:"amount"`
	Kind   string `json:"kind"`
	Pct    *int   `json:"pct,omitempty"`
}

// Result is income − expenses − saved, and the previous period's.
type Result struct {
	Total int64  `json:"total"`
	Prev  *int64 `json:"prev,omitempty"`
}

// Query asks for the receipt of one period. Period comes from Week, Month,
// Quarter, Year or Custom;
// Now is the clock (its Brussels date decides "running", the budget
// reference's history months and the stand).
type Query struct {
	Period    Period
	Scope     string // "", alles, persoonlijk or gedeeld
	AccountID int64  // 0 = every current account of the scope
	Now       time.Time
}

// Build makes the receipt of q.Period for the viewer. Every amount comes from
// ledger.ReportRange (the report rule, with detail); nothing is recomputed.
// The errors are ReportRange's (a hidden or unknown account, a savings
// account, an unknown scope).
func Build(ctx context.Context, db *sql.DB, store *ledger.Store, viewer int64, q Query) (Model, error) {
	p := q.Period
	cur, err := store.ReportRange(ctx, viewer, q.Scope, q.AccountID, p.From, p.To, true)
	if err != nil {
		return Model{}, err
	}
	now := q.Now.In(clock.Brussels)
	today := now.Format(time.DateOnly)
	first := ""
	if cur.FirstDate != nil {
		first = *cur.FirstDate
	}
	m := Model{Period: p.Kind, From: p.From, To: p.To, Label: p.Label, Scope: q.Scope, Account: q.AccountID,
		Running: p.Running(today), Stand: now.Format(time.RFC3339), Notes: []string{}}
	if m.Scope == "" && q.AccountID == 0 {
		m.Scope = "alles"
	}
	if pf := p.PartialFrom(first); pf != "" {
		m.PartialFrom = &pf
		m.Label = p.LabelFrom(pf)
	}

	var prev *ledger.ReportTotals
	if p.Comparable(first) {
		pp := p.Previous()
		r, err := store.ReportRange(ctx, viewer, q.Scope, q.AccountID, pp.From, pp.To, false)
		if err != nil {
			return Model{}, err
		}
		prev = &r.ReportTotals
	}
	cats, err := store.Categories(ctx, viewer)
	if err != nil {
		return Model{}, err
	}
	accounts, err := store.Accounts(ctx, viewer, q.Now)
	if err != nil {
		return Model{}, err
	}
	var refs map[string]Budget
	if p.Kind == KindMonth && len(cur.Accounts) > 0 {
		if refs, err = references(ctx, db, store, viewer, cur.Accounts, p.From[:7], today, q.Now); err != nil {
			return Model{}, err
		}
	}

	t := tree{cats}
	m.ScopeLabel = scopeLabel(m.Scope, q.AccountID, cur.Accounts, accounts)
	m.Income = Section{Total: cur.Income, Rows: t.breakdown(cur.Detail.Income, "inkomen", accounts)}
	m.Saved = Section{Total: cur.Saved, Rows: t.breakdown(cur.Detail.Saved, "gespaard", accounts)}
	m.Expenses = Expenses{Total: sumOf(cur.Expenses), Groups: t.groups(cur.ReportTotals, prev, refs)}
	m.Result.Total = m.Income.Total - m.Expenses.Total - m.Saved.Total
	if prev != nil {
		pe := sumOf(prev.Expenses)
		m.Income.Prev, m.Income.Trend = &prev.Income, trend(cur.Income, &prev.Income)
		m.Saved.Prev, m.Saved.Trend = &prev.Saved, trend(cur.Saved, &prev.Saved)
		m.Expenses.Prev, m.Expenses.Trend = &pe, trend(m.Expenses.Total, &pe)
		r := prev.Income - pe - prev.Saved
		m.Result.Prev = &r
	}
	m.Empty = cur.Income == 0 && cur.Saved == 0 && len(cur.Expenses) == 0
	m.Notes = notes(p, m.Running, today, m.PartialFrom, cur.Accounts, accounts)
	return m, nil
}

// references sums the budget reference of each of the selection's accounts
// in month per top category id, the way columnReferences in lib/reports.ts
// does for one month: the amounts add up, the source is budget or average
// when every account agrees, else mixed.
func references(ctx context.Context, db *sql.DB, store *ledger.Store, viewer int64, sel []int64, month, today string, now time.Time) (map[string]Budget, error) {
	out := map[string]Budget{}
	for _, id := range sel {
		ref, err := planning.LoadBudgetReference(ctx, db, store, viewer, id, today, now)
		if err != nil {
			return nil, err
		}
		for _, c := range ref.In(month) {
			k := strconv.FormatInt(c.CategoryID, 10)
			b, seen := out[k]
			b.Amount += c.Reference
			if !seen {
				b.Kind = c.Source
			} else if b.Kind != c.Source {
				b.Kind = "mixed"
			}
			out[k] = b
		}
	}
	return out, nil
}

// trend is trend() of lib/reports.ts without the colour: none without a
// previous period or with nothing now (or a refund surplus), new when the
// previous amount was 0 or below, else the rounded percent, up above +5 and
// down below −5.
func trend(v int64, prev *int64) *Trend {
	if prev == nil || v <= 0 {
		return nil
	}
	if *prev <= 0 {
		return &Trend{Kind: "new"}
	}
	d := jsRound((float64(v-*prev) / float64(*prev)) * 100)
	kind := "flat"
	if d > 5 {
		kind = "up"
	} else if d < -5 {
		kind = "down"
	}
	return &Trend{Pct: &d, Kind: kind}
}

// jsRound is JavaScript's Math.round (half toward +∞; Go's math.Round goes
// half away from zero, −2.5 → −3), so a trend or a budget percent is the
// number Overzicht shows.
func jsRound(x float64) int { return int(math.Floor(x + 0.5)) }

func sumOf(m map[string]int64) (n int64) {
	for _, v := range m {
		n += v
	}
	return n
}

// pseudo names the expense keys that are no category (PSEUDO in lib/reports.ts).
var pseudo = map[string]string{"none": "Niet gecategoriseerd", "toShared": "Naar gedeelde rekening", "toOwn": "Naar eigen rekening"}

// tree looks categories up by id as lookup and topOf in lib/reports.ts do.
type tree struct{ cats []ledger.TreeCategory }

func (t tree) find(key string) *ledger.TreeCategory {
	for i, c := range t.cats {
		if strconv.FormatInt(c.ID, 10) == key {
			return &t.cats[i]
		}
	}
	return nil
}

// look is the name and emoji of a key: a pseudo key, a category, or an id
// that is not (yet) in the tree ("Categorie <id>").
func (t tree) look(key string) (string, *string) {
	if n, ok := pseudo[key]; ok {
		return n, nil
	}
	if c := t.find(key); c != nil {
		return c.Name, c.Icon
	}
	return "Categorie " + key, nil
}

// topOf is a category's top: its parent, else itself.
func (t tree) topOf(id string) string {
	if c := t.find(id); c != nil && c.ParentID != nil {
		return strconv.FormatInt(*c.ParentID, 10)
	}
	return id
}

// children are subRows of lib/reports.ts: the own-category entries of one top,
// largest first, only when there are two or more; the part booked on the top
// itself is "<top> zelf", the wording of Overzicht's breakdown (0.8.1-4).
func (t tree) children(top string, entries map[string]int64) []Row {
	var ids []string
	for id, v := range entries {
		if v != 0 {
			ids = append(ids, id)
		}
	}
	if len(ids) < 2 {
		return nil
	}
	slices.SortFunc(ids, func(a, b string) int {
		if entries[a] != entries[b] {
			return cmp64(entries[b], entries[a])
		}
		return strings.Compare(a, b)
	})
	topName, _ := t.look(top)
	out := make([]Row, len(ids))
	for i, id := range ids {
		name, _ := t.look(id)
		if id == top {
			name = topName + " zelf"
		}
		out[i] = Row{Key: id, Name: name, Amount: entries[id]}
	}
	return out
}

func cmp64(a, b int64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// jsKeyOrder is the order of an object's keys in JavaScript, which is how the
// stable sort of catRows breaks ties: integer keys ascending, then the others
// (in the JSON order, which Go writes sorted).
func jsKeyOrder(a, b string) int {
	ia, ea := strconv.ParseUint(a, 10, 32)
	ib, eb := strconv.ParseUint(b, 10, 32)
	switch {
	case ea == nil && eb == nil:
		return cmp64(int64(ia), int64(ib))
	case ea == nil:
		return -1
	case eb == nil:
		return 1
	}
	return strings.Compare(a, b)
}

// groups are the expense rows of catRows in lib/reports.ts: every key with an
// amount other than 0, largest first (a pseudo key sorts by its amount like
// any category), with its trend against prev, its budget reference (months)
// and its subcategories. Categories with a reference and nothing spent are
// left out: the receipt hides zero rows.
func (t tree) groups(cur ledger.ReportTotals, prev *ledger.ReportTotals, refs map[string]Budget) []Row {
	keys := make([]string, 0, len(cur.Expenses))
	for k, v := range cur.Expenses {
		if v != 0 {
			keys = append(keys, k)
		}
	}
	slices.SortFunc(keys, func(a, b string) int {
		if cur.Expenses[a] != cur.Expenses[b] {
			return cmp64(cur.Expenses[b], cur.Expenses[a])
		}
		return jsKeyOrder(a, b)
	})
	out := make([]Row, len(keys))
	for i, k := range keys {
		name, emoji := t.look(k)
		r := Row{Key: k, Name: name, Emoji: emoji, Amount: cur.Expenses[k], Children: t.children(k, cur.Detail.Expenses[k])}
		if prev != nil {
			pv := prev.Expenses[k]
			r.Prev, r.Trend = &pv, trend(r.Amount, &pv)
		}
		if b, ok := refs[k]; ok {
			if b.Amount > 0 {
				pct := max(0, jsRound(float64(r.Amount)/float64(b.Amount)*100))
				b.Pct = &pct
			}
			r.Budget = &b
		}
		out[i] = r
	}
	return out
}

var savedAccount = regexp.MustCompile(`^account-(\d+)$`)

// breakdown is breakdown() of lib/reports.ts for inkomen and gespaard: the
// detail rolled up to the top categories (each with its subcategories and
// "<top> zelf"), plus the pseudo rows: income from "Overschrijvingen" and
// "Niet gecategoriseerd", saved "Naar <account>". Rows of 0 are left out;
// largest first, then by name.
func (t tree) breakdown(detail map[string]int64, which string, accounts []ledger.Account) []Row {
	income := which == "inkomen"
	rows := []Row{}
	tops := map[string]map[string]int64{}
	for k, v := range detail {
		if v == 0 {
			continue
		}
		acc := savedAccount.FindStringSubmatch(k)
		switch {
		case income && k == "transfer":
			rows = append(rows, Row{Key: k, Name: "Overschrijvingen", Amount: v})
		case income && k == "none":
			rows = append(rows, Row{Key: k, Name: pseudo["none"], Amount: v})
		case !income && acc != nil:
			name := "spaarrekening"
			for _, a := range accounts {
				if strconv.FormatInt(a.ID, 10) == acc[1] {
					name = a.Name
				}
			}
			rows = append(rows, Row{Key: k, Name: "Naar " + name, Amount: v})
		default:
			top := t.topOf(k)
			if tops[top] == nil {
				tops[top] = map[string]int64{}
			}
			tops[top][k] = v
		}
	}
	for top, entries := range tops {
		amount := sumOf(entries)
		if amount == 0 {
			continue
		}
		name, emoji := t.look(top)
		rows = append(rows, Row{Key: top, Name: name, Emoji: emoji, Amount: amount, Children: t.children(top, entries)})
	}
	slices.SortFunc(rows, func(a, b Row) int {
		if a.Amount != b.Amount {
			return cmp64(b.Amount, a.Amount)
		}
		return nameOrder(a.Name, b.Name)
	})
	return rows
}

// nameOrder breaks a tie between two names the way the web's localeCompare does for
// Dutch names: ignoring case first ("bakker" before "Zout"), then by bytes. Overzicht's
// breakdown sorts this way, and the cross-check of the receipt against it relies on it.
func nameOrder(a, b string) int {
	if c := strings.Compare(strings.ToLower(a), strings.ToLower(b)); c != 0 {
		return c
	}
	return strings.Compare(a, b)
}

// scopeLabel names the selection: the account, or the scope's accounts, with
// "samen · ter info" when several accounts are summed (no verdict on a sum).
func scopeLabel(scope string, account int64, sel []int64, accounts []ledger.Account) string {
	if account != 0 {
		for _, a := range accounts {
			if a.ID == account {
				return a.Name
			}
		}
	}
	label := map[string]string{"alles": "Alle rekeningen", "persoonlijk": "Persoonlijke rekeningen", "gedeeld": "Gedeelde rekeningen"}[scope]
	if len(sel) > 1 {
		label += " samen · ter info"
	}
	return label
}

// notes are the lines under the receipt: the running period (the bank sends
// today's rows tomorrow), each bank account of the selection whose sync is
// failing or stale (the account verdict of Start's alerts, ledger/alerts.go;
// manual accounts never) while its last sync is not after the period, and
// the start of the history inside the period.
func notes(p Period, running bool, today string, partialFrom *string, sel []int64, accounts []ledger.Account) []string {
	out := []string{}
	if running {
		out = append(out, "Loopt nog, tot "+dayShort(today)+": de bank geeft de transacties van vandaag pas morgen door.")
	}
	for _, a := range accounts {
		if !slices.Contains(sel, a.ID) || a.Source != "bank" || a.SyncStatus == nil || (*a.SyncStatus != "failed" && *a.SyncStatus != "stale") {
			continue
		}
		if a.LastSync == nil {
			out = append(out, "Niet volledig: "+a.Name+" is nog niet bijgewerkt.")
			continue
		}
		t, err := time.Parse(time.RFC3339, *a.LastSync)
		if err != nil {
			continue
		}
		since := t.In(clock.Brussels).Format(time.DateOnly)
		// A sync after the period's last day brought the whole period in.
		if since > p.To {
			continue
		}
		out = append(out, "Niet volledig: "+a.Name+" is niet bijgewerkt sinds "+dayShort(since)+".")
	}
	if partialFrom != nil {
		out = append(out, "Je geschiedenis begint op "+dateShort(*partialFrom)+".")
	}
	return out
}
