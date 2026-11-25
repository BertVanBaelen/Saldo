package server

import (
	"cmp"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// The forecast on the wire (0.8-4, docs/api.md "Planning (0.8)"):
// GET /api/planning answers one planning.Forecast per current account of the
// scope the viewer holds. The forecast takes no viewer (plan 0.8 decision 2):
// everything here but `me` is the same for every member of a shared account.

const (
	msgPlanHorizon = "Kies 3, 6, 12 of 24 maanden."
	msgPlanMonth   = "Kies een maand binnen de planning."
	msgPlanScope   = "Kies alles, persoonlijk of gedeeld."
)

// The wire types of the engine's: the leaf ones convert straight from them
// (struct conversion ignores tags), the others are mapped by hand.
type (
	planLine struct {
		Key    string   `json:"key"`
		Amount int64    `json:"amount"`
		Labels []string `json:"labels"`
	}
	planBudget struct {
		CategoryID int64  `json:"categoryId"`
		Plan       int64  `json:"plan"`
		Source     string `json:"source"`
		Spent      int64  `json:"spent"`
		Rest       int64  `json:"rest"`
		Average    int64  `json:"average"` // the category's 6-month average of variable spending (0 without history), whatever source says
	}
	planItem struct {
		Kind   string `json:"kind"`
		Label  string `json:"label"`
		Amount int64  `json:"amount"`
		ID     int64  `json:"id"`
	}
	planMissed struct {
		ItemID int64  `json:"itemId"`
		Label  string `json:"label"`
		Date   string `json:"date"`
		Amount int64  `json:"amount"`
	}
	planLow struct {
		Date    string `json:"date"`
		Balance int64  `json:"balance"`
		State   string `json:"state"`
	}
	planDay struct {
		Date    string     `json:"date"`
		Balance int64      `json:"balance"`
		State   string     `json:"state"`
		Items   []planItem `json:"items"`
	}
	planMember struct {
		UserID        int64  `json:"userId,omitempty"`        // a member
		ContributorID int64  `json:"contributorId,omitempty"` // a contributor without Saldo (0.8.1-7)
		Name          string `json:"name"`
		Me            bool   `json:"me"`
		Share         int    `json:"share"`
		Required      int64  `json:"required"`
	}
	planContribution struct {
		Need        int64        `json:"need"`
		Costs       int64        `json:"costs"`
		OtherIncome int64        `json:"otherIncome"`
		BufferGap   int64        `json:"bufferGap"`
		Members     []planMember `json:"members"`
	}
	planMonth struct {
		Month        string            `json:"month"`
		Start        int64             `json:"start"`
		End          int64             `json:"end"`
		Left         int64             `json:"left"`
		State        string            `json:"state"`
		Income       int64             `json:"income"`
		Out          int64             `json:"out"`
		Saved        int64             `json:"saved"`
		Low          planLow           `json:"low"`
		Lines        []planLine        `json:"lines"`
		Budgets      []planBudget      `json:"budgets"`
		Contribution *planContribution `json:"contribution,omitempty"` // shared accounts only
	}
	planAccount struct {
		ID          int64        `json:"id"`
		Buffer      int64        `json:"buffer"`
		Balance     int64        `json:"balance"`
		BalanceDate string       `json:"balanceDate"`
		DataDate    string       `json:"dataDate"`
		Months      []planMonth  `json:"months"`
		Days        []planDay    `json:"days"` // the days of the requested month only
		Missed      []planMissed `json:"missed"`
	}
	planAnswer struct {
		Today    string        `json:"today"`
		Accounts []planAccount `json:"accounts"`
		Missing  []int64       `json:"missing"` // current accounts of the scope without a balance
	}
)

// mapTo converts every element; the result is never nil (JSON [] not null).
func mapTo[T, U any](in []T, f func(T) U) []U {
	out := make([]U, len(in))
	for i, v := range in {
		out[i] = f(v)
	}
	return out
}

// inScope tells whether an account of this kind ("personal" or "shared") is in
// the scope; an unknown scope holds nothing (the caller answers its 400).
func inScope(scope, kind string) bool {
	switch scope {
	case "", "alles":
		return true
	case "persoonlijk":
		return kind == "personal"
	case "gedeeld":
		return kind == "shared"
	}
	return false
}

// brusselsToday is the clock's date in Brussels, the engine's `today`.
func (s *Server) brusselsToday() string { return s.now().In(clock.Brussels).Format(time.DateOnly) }

// planMonths is "YYYY-MM" plus n months.
func planMonths(month string, n int) string {
	t, _ := time.Parse("2006-01", month)
	return t.AddDate(0, n, 0).Format("2006-01")
}

func (s *Server) getPlanningForecast(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	scope := q.Get("scope")
	if !inScope(scope, "personal") && !inScope(scope, "shared") {
		writeError(w, http.StatusBadRequest, "invalid", msgPlanScope)
		return
	}
	horizon := 3
	switch h := q.Get("horizon"); h {
	case "":
	case "3", "6", "12", "24":
		horizon, _ = strconv.Atoi(h)
	default:
		writeError(w, http.StatusBadRequest, "invalid", msgPlanHorizon)
		return
	}
	today := s.brusselsToday()
	running := today[:7]
	month := cmp.Or(q.Get("month"), running)
	months := make([]string, horizon+1)
	for i := range months {
		months[i] = planMonths(running, i)
	}
	if !slices.Contains(months, month) {
		writeError(w, http.StatusBadRequest, "invalid", msgPlanMonth)
		return
	}

	ctx, viewer, now := r.Context(), viewerOf(r), s.now()
	accounts, err := s.store.Accounts(ctx, viewer, now)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	out := planAnswer{Today: today, Accounts: []planAccount{}, Missing: []int64{}}
	for _, a := range accounts {
		if a.Type != "current" || !inScope(scope, a.Kind) {
			continue
		}
		f, err := planning.Forecast(ctx, s.db, a.ID, today, horizon)
		if errors.Is(err, planning.ErrNoBalance) {
			out.Missing = append(out.Missing, a.ID)
			continue
		}
		if err != nil {
			s.fail(w, r, err, msgAccountNotFound)
			return
		}
		var parties []contribParty
		if a.Kind == "shared" {
			c, err := s.store.Contributions(ctx, viewer, a.ID, "", now)
			if err != nil {
				s.fail(w, r, err, msgAccountNotFound)
				return
			}
			parties = partiesOf(c)
		}
		out.Accounts = append(out.Accounts, planAccountOf(f, month, parties))
	}
	writeJSON(w, http.StatusOK, out)
}

// planAccountOf maps one forecast; parties (members in member order, then
// contributors without Saldo, with their stored shares) make every month of a
// shared account carry its contribution.
func planAccountOf(f planning.AccountForecast, month string, parties []contribParty) planAccount {
	return planAccount{ID: f.AccountID, Buffer: f.Buffer, Balance: f.Balance, BalanceDate: f.BalanceDate, DataDate: f.DataDate,
		Months: mapTo(f.Months, func(m planning.Month) planMonth {
			pm := planMonth{Month: m.Month, Start: m.Start, End: m.End, Left: m.Left, State: m.State,
				Income: m.Income, Out: m.Out, Saved: m.Saved,
				Low:     planLow{Date: m.Low.Date, Balance: m.Low.Balance, State: m.Low.State},
				Lines:   mapTo(m.Lines, func(l planning.Line) planLine { return planLine{l.Key, l.Amount, append([]string{}, l.Labels...)} }), // labels: [] not null
				Budgets: mapTo(m.Budgets, func(b planning.Budget) planBudget { return planBudget(b) })}
			if len(parties) > 0 {
				pm.Contribution = contributionOf(m.Need, parties)
			}
			return pm
		}),
		Days: mapTo(f.Days[month], func(d planning.Day) planDay {
			return planDay{Date: d.Date, Balance: d.Balance, State: d.State,
				Items: mapTo(d.Items, func(i planning.Item) planItem { return planItem(i) })}
		}),
		Missed: mapTo(f.Missed, func(m planning.Missed) planMissed { return planMissed(m) })}
}

// contribParty is one who owes a part of the need: a member (UserID) or a
// contributor without Saldo (ContributorID, 0.8.1-7), with the stored share.
type contribParty struct {
	who   planMember
	share *int
}

// partiesOf lists the members, then the contributors.
func partiesOf(c ledger.Contributions) []contribParty {
	out := make([]contribParty, 0, len(c.Members)+len(c.Contributors))
	for _, m := range c.Members {
		out = append(out, contribParty{planMember{UserID: m.UserID, Name: m.Name, Me: m.Me}, m.Share})
	}
	for _, x := range c.Contributors {
		out = append(out, contribParty{planMember{ContributorID: x.ID, Name: x.Name}, x.Share})
	}
	return out
}

// contributionOf is a month's required contribution (decision 10): the need
// rounded up to whole euros and each party's part of it.
func contributionOf(n planning.Need, parties []contribParty) *planContribution {
	c := &planContribution{Need: planning.CeilEuros(n.Amount, 100), Costs: n.Costs, OtherIncome: n.OtherIncome, BufferGap: n.BufferGap,
		Members: mapTo(parties, func(p contribParty) planMember {
			m := p.who
			m.Share, m.Required = planning.MemberPart(n.Amount, p.share, len(parties))
			return m
		})}
	return c
}
