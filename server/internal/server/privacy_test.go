package server

// The privacy suite (plan 0.6-2, docs/api.md "Privacy rules and the route
// table"). One table, privacyRows, has a row per route registered in this
// package; TestEveryRouteHasAPrivacyRow fails when a route has no row or a
// row names a route that is gone. Every row says what the route is and how
// rules 1-5 are proven for it: by its probes (run by TestPrivacyRoutes on a
// fresh two-user world) and/or by the named tests. TestPrivacySentinels runs
// every read of the table as both users in four states and looks for strings
// that only the other user's personal data holds.

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

const (
	ibanDerde = "BE09000000000303" // a third user's account, offered to Bert
	gemeen    = "11/11/2026;11/11/2026;-9,90;Gemeenschappelijke Bakker;;Brood\n"
)

// world is a bank environment with three users. Bert links his current
// account and the family account; Partner links her own account and the
// family account and joins it (edit); Derde holds an account that is offered
// to Bert. Each user has private data of every kind; the ids are below.
type world struct {
	t *testing.T
	e *bankEnv

	bert, partner, derde                                   int64
	bertAcc, shared, bertManual, partnerAcc, partnerManual int64
	derdeAcc, bertConn, partnerConn                        int64
	bertTx, bertSplit, partnerTx, sharedTx                 int64
	bertRule, bertAccRule, partnerRule, partnerAccRule     int64
	sharedRule                                             int64
	bertBatch, bertRunBatch, sharedRunBatch, partnerBatch  int64
	bertDevice, partnerDevice, bertOffer                   int64
	bertNotice, partnerNotice, invitation, accInvitation   int64 // accInvitation: Derde's open invitation to the family account
	bertSender, partnerSender, bertContribution            int64
	bertContributor                                        int64  // Grootmoeder, a contributor without Saldo Bert added to the family account (0.8.1-7)
	bertItem, partnerItem, bertPlanned, partnerPlanned     int64  // planning: recurring items and planned items on the personal accounts
	bertState                                              string // a pending link state of Bert
}

// Strings only one user's personal data holds; each is rendered somewhere
// in its owner's own answers (TestPrivacySentinels checks that too).
var (
	bertSecrets = []string{"Zichtrekening", "7034", "Koffiebar", "Bakkerij Voorbeeld", "Werkgever NV", "Loon november", "196882",
		"Spaarpot", "5615", "Geheimbakker", "bert-geheim.csv", "Geheimnotitie", "Geheimwinkel", "0071", "Geheimloon",
		"Geheimcat", "Runwinkel Prive", "bert@jouw-domein.be", "Chrome op Windows", "nieuw@example.com", "BERTFOUT_X",
		"7193"} // the masked IBAN of the contributor Bert added: the creator and the manager only
	partnerSecrets = []string{"Eigen rekening", "7061", "Werkgever BV", "246000", "143215", "Potje Partner", "Partnerbakker",
		"partner-geheim.csv", "Partnergeheim", "Partnerwinkel", "0082", "Partnerloon", "Partnercat", "Partnerzaak",
		"partner@jouw-domein.be", "Safari op iPhone", "Overschrijving Bert", "PARTNERFOUT_Y",
		"246001", "246002", "246003"} // planning: an item, a budget and a planned item on her own account
	derdeSecrets = []string{"Derdes Rekening", "Derdewinkel", "derde@example.com"}
	// Never rendered at all (full IBANs are masked): checked only for absence.
	neverShown = []string{ibanPersonal, ibanPartner, ibanDerde, "BE11000000000071", "BE22000000000082", ibanContributor}
	// The family account's data: every member sees it.
	sharedSecrets = []string{"Gezinsrekening", "6769", "Gedeelde notitie", "Runwinkel Samen", "Gedeeld Proef", "Bijdrage van Bert", "Gezinsabonnement", "Grootmoeder"}
)

func newWorld(t *testing.T) *world {
	t.Helper()
	e := newBankEnv(t)
	w := &world{t: t, e: e, bert: e.bert, partner: e.partner}
	e.bank.set(func(b *testBank) {
		b.txs[ibanShared] = append(b.txs[ibanShared],
			bank.Transaction{EntryReference: "ref-10", BookingDate: "2026-11-13", Amount: 45000, CounterpartyName: "Bijdrage van Bert", CounterpartyIBAN: ibanPersonal, Status: bank.StatusBooked},
			bank.Transaction{EntryReference: "ref-11", BookingDate: "2026-11-13", Amount: 45000, CounterpartyName: "Bijdrage", CounterpartyIBAN: ibanPartner, Status: bank.StatusBooked})
		b.txs[ibanPartner] = append(b.txs[ibanPartner],
			bank.Transaction{EntryReference: "ref-6", BookingDate: "2026-11-08", Amount: -5000, CounterpartyName: "Overschrijving Bert", CounterpartyIBAN: ibanPersonal, Status: bank.StatusBooked})
	})
	e.saveCredentials(w.bert)
	w.bertConn = e.link(w.bert, "").Connection.ID
	e.saveCredentials(w.partner)
	e.bank.set(func(b *testBank) {
		b.session = "sess-partner"
		b.accounts = []bank.Account{
			{ID: "p-1", IBAN: ibanPartner, Name: "Eigen rekening", Currency: "EUR", Bank: "Argenta"},
			{ID: "p-2", IBAN: ibanShared, Name: "Gezinsrekening", Currency: "EUR", Bank: "Argenta"},
		}
	})
	linked := e.link(w.partner, "")
	w.partnerConn = linked.Connection.ID
	leaks(t, "POST /api/bank/callback", "partner", "baseline", probe{method: "POST", path: "/api/bank/callback"}, response{body: jsonBody(linked)})
	if len(linked.Offers) != 1 {
		t.Fatalf("Partner's offers: %+v", linked.Offers)
	}
	r := w.ok(w.partner, "POST", "/api/join-offers/"+id(linked.Offers[0].ID)+"/accept", "", 200)
	leaks(t, "POST /api/join-offers/{id}/accept", "partner", "baseline", probe{method: "POST", path: "/api/join-offers/{id}/accept"}, r)
	e.bank.set(func(b *testBank) { // every provider id resolves again
		b.accounts = append(b.accounts, bank.Account{ID: "uid-1", IBAN: ibanPersonal}, bank.Account{ID: "uid-2", IBAN: ibanShared})
	})
	byIBAN := func(iban string) int64 { return w.int(`SELECT id FROM accounts WHERE iban = ?`, iban) }
	w.bertAcc, w.shared, w.partnerAcc = byIBAN(ibanPersonal), byIBAN(ibanShared), byIBAN(ibanPartner)
	if err := categorise.SeedDefaults(t.Context(), e.db); err != nil {
		t.Fatal(err)
	}

	// Manual accounts.
	w.bertManual = decode[ledger.Account](t, w.ok(w.bert, "POST", "/api/accounts", `{"name":"Spaarpot","type":"savings","colour":"orange","iban":"BE83 3630 1234 5615","balance":1250000}`, 201).body).ID
	w.partnerManual = decode[ledger.Account](t, w.ok(w.partner, "POST", "/api/accounts", `{"name":"Potje Partner","type":"savings","colour":"teal","balance":7700}`, 201).body).ID

	// Rows: categories, notes, a split, a transfer override.
	row := func(name string) int64 {
		return w.int(`SELECT id FROM transactions WHERE counterparty_name = ? AND status = 'booked'`, name)
	}
	w.bertTx, w.bertSplit, w.partnerTx, w.sharedTx = row("Werkgever NV"), row("Bakkerij Voorbeeld"), row("Werkgever BV"), row("Supermarkt")
	w.ok(w.bert, "PATCH", txPath(w.bertTx, ""), `{"categoryId":7,"note":"Geheimnotitie"}`, 200)
	w.ok(w.partner, "PATCH", txPath(w.partnerTx, ""), `{"categoryId":7,"note":"Partnergeheim"}`, 200)
	w.ok(w.bert, "PATCH", txPath(w.sharedTx, ""), `{"categoryId":2,"note":"Gedeelde notitie"}`, 200)
	w.ok(w.bert, "PUT", txPath(w.bertSplit, "/split"), `{"parts":[{"categoryId":2,"amount":-615},{"categoryId":3,"amount":-615}]}`, 200)
	w.exec(`INSERT INTO transfer_overrides (user_id, transaction_id, is_transfer) VALUES (?, ?, 1)`, w.bert, w.sharedTx)

	// Planning (0.8-1): Partner's own account carries an item, a budget and a planned item with the
	// sentinel amounts; Bert has an item and a planned item on his; the family account has an item
	// with a counterparty IBAN of Partner's (stored, never shown).
	planningBody := func(account int64, rest string) string { return `{"accountId":` + id(account) + `,` + rest + `}` }
	const itemRest = `"description":"Eigen post","amount":-%d,"frequency":"monthly","day":5,"kind":"expense"`
	w.partnerItem = decode[ledger.Item](t, w.ok(w.partner, "POST", "/api/planning/items", planningBody(w.partnerAcc, fmt.Sprintf(itemRest, 246001)), 201).body).ID
	w.bertItem = decode[ledger.Item](t, w.ok(w.bert, "POST", "/api/planning/items", planningBody(w.bertAcc, fmt.Sprintf(itemRest, 100500)), 201).body).ID
	w.ok(w.partner, "PUT", "/api/planning/budgets", planningBody(w.partnerAcc, `"categoryId":2,"fromMonth":"2026-11","amount":246002`), 200)
	w.partnerPlanned = decode[ledger.Planned](t, w.ok(w.partner, "POST", "/api/planning/planned", planningBody(w.partnerAcc, `"date":"2026-12-01","amount":246003,"description":"Eigen plan"`), 201).body).ID
	w.bertPlanned = decode[ledger.Planned](t, w.ok(w.bert, "POST", "/api/planning/planned", planningBody(w.bertAcc, `"date":"2026-12-02","amount":-7700,"description":"Bert plan"`), 201).body).ID
	shared := decode[ledger.Item](t, w.ok(w.bert, "POST", "/api/planning/items", planningBody(w.shared, `"description":"Gezinsabonnement","counterparty":"Bijdrage","amount":-1100,"frequency":"monthly","day":9,"kind":"expense"`), 201).body)
	w.exec(`UPDATE recurring_items SET counterparty_iban = ? WHERE id = ?`, ibanPartner, shared.ID)

	// Rules: a user rule and an account rule each, and one on the family account.
	w.bertRule = w.rule(w.bert, `{"counterparty":"Geheimwinkel","counterpartyIban":"BE11000000000071","categoryId":2}`)
	w.bertAccRule = w.rule(w.bert, `{"accountId":`+id(w.bertAcc)+`,"counterparty":"Geheimloon","categoryId":7}`)
	w.partnerRule = w.rule(w.partner, `{"counterparty":"Partnerwinkel","counterpartyIban":"BE22000000000082","categoryId":2}`)
	w.partnerAccRule = w.rule(w.partner, `{"accountId":`+id(w.partnerAcc)+`,"counterparty":"Partnerloon","categoryId":7}`)
	w.sharedRule = w.rule(w.bert, `{"accountId":`+id(w.shared)+`,"counterparty":"Gedeeld Proef","categoryId":2}`)

	// Imports: one file each into a personal account, and one file of Bert's
	// split over his current account and the family account (one run).
	w.bertBatch = w.importFile(w.bert, "bert-geheim.csv", csvHeader+"10/11/2026;10/11/2026;-4,20;Geheimbakker;;Geheimbrood\n", w.bertAcc).Batches[0].ID
	w.partnerBatch = w.importFile(w.partner, "partner-geheim.csv", csvHeader+"09/11/2026;09/11/2026;-7,40;Partnerbakker;;Brood\n", w.partnerAcc).Batches[0].ID
	run := w.bilanceRun()
	w.bertRunBatch, w.sharedRunBatch = run.Batches[0].ID, run.Batches[1].ID
	w.ok(w.bert, "PUT", "/api/imports/mappings?source=bilance", `[{"category":"Geheimcat","subcategory":"","categoryId":2}]`, 200)
	w.ok(w.partner, "PUT", "/api/imports/mappings?source=bilance", `[{"category":"Partnercat","subcategory":"","categoryId":2}]`, 200)

	// Suggestions: two manual choices and a row that waits, each on a personal account.
	for owner, name := range map[int64]string{w.bertAcc: "Geheimwinkel Noord", w.partnerAcc: "Partnerzaak Zuid"} {
		for i, cat := range []any{2, 2, nil} {
			origin := any("manual")
			if cat == nil {
				origin = nil
			}
			w.exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, category_id, category_origin)
				VALUES (?, -4321, '2026-11-05', ?, 'booked', ?, ?, ?)`, owner, name, fmt.Sprintf("sugg-%d-%d", owner, i), cat, origin)
		}
	}

	// Rows both users have (rule 5): the same counterparty, date and amount
	// on each personal account. Bert chose a category by hand twice and
	// imported one; Partner's waits. A shared row keeps the rule id of Bert's
	// user rule from before the account was shared.
	for i, owner := range []int64{w.bertAcc, w.bertAcc, w.partnerAcc} {
		cat, origin := any(2), any("manual")
		if owner == w.partnerAcc {
			cat, origin = nil, nil
		}
		w.exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, category_id, category_origin)
			VALUES (?, -990, '2026-11-11', 'Gemeenschappelijke Bakker', 'booked', ?, ?, ?)`, owner, fmt.Sprintf("gb-%d", i), cat, origin)
	}
	w.importFile(w.bert, "gemeen.csv", csvHeader+gemeen, w.bertAcc)
	w.exec(`UPDATE transactions SET category_id = 2, category_origin = 'rule', rule_id = ? WHERE counterparty_name = 'Bijdrage'`, w.bertRule)

	// Contributions: each member claims their own account as the sender of
	// their contribution to the family account (masked: "7034", "7061").
	sender := func(user, from int64) int64 {
		return decode[ledger.Sender](t, w.ok(user, "POST", "/api/accounts/"+id(w.shared)+"/contribution-senders", `{"fromAccountId":`+id(from)+`}`, 201).body).ID
	}
	w.bertSender, w.partnerSender = sender(w.bert, w.bertAcc), sender(w.partner, w.partnerAcc)
	w.bertContribution = row("Bijdrage van Bert")
	// A contributor without Saldo (0.8.1-7): name for every member, IBAN masked to Bert (creator, manager) only.
	w.bertContributor = decode[ledger.Contributions](t, w.ok(w.bert, "POST", "/api/accounts/"+id(w.shared)+"/contributors",
		`{"name":"Grootmoeder","iban":"`+ibanContributor+`"}`, 201).body).Contributors[0].ID

	// Devices, a third user with an account offered to Bert, notices, an invitation.
	w.bertDevice = w.int(`INSERT INTO devices (user_id, name, token_hash) VALUES (?, 'Chrome op Windows', 'b') RETURNING id`, w.bert)
	w.partnerDevice = w.int(`INSERT INTO devices (user_id, name, token_hash) VALUES (?, 'Safari op iPhone', 'p') RETURNING id`, w.partner)
	// A push subscription on each device (0.9-2).
	w.exec(`INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth) VALUES (?, ?, ?, 'bert-k', 'bert-s'), (?, ?, ?, 'partner-k', 'partner-s')`,
		w.bert, w.bertDevice, fcm+"bert", w.partner, w.partnerDevice, fcm+"partner")
	w.derde = e.addUser("derde@example.com", "Derde", "user", "Derde kiest ook een zin")
	w.derdeAcc = w.int(`INSERT INTO accounts (type, source, iban, name, bank_name, created_by) VALUES ('current', 'bank', ?, 'Derdes Rekening', 'Argenta', ?) RETURNING id`, ibanDerde, w.derde)
	w.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (?, ?, 'manager', 'edit')`, w.derdeAcc, w.derde)
	w.exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key) VALUES (?, -999, '2026-11-14', 'Derdewinkel', 'booked', 'd-1')`, w.derdeAcc)
	w.bertOffer = w.int(`INSERT INTO join_offers (user_id, connection_id, account_id, external_account_id, created_at) VALUES (?, ?, ?, 'd-ext', ?) RETURNING id`,
		w.bert, w.bertConn, w.derdeAcc, e.now.UTC().Format(time.RFC3339))
	w.bertNotice = w.int(`SELECT id FROM account_notices WHERE user_id = ? AND type = 'member'`, w.bert)
	w.partnerNotice = w.int(`INSERT INTO account_notices (user_id, account_id, type, created_at) VALUES (?, ?, 'rules', ?) RETURNING id`,
		w.partner, w.shared, e.now.UTC().Format(time.RFC3339))
	w.invitation = decode[struct {
		ID int64 `json:"id"`
	}](t, w.ok(w.bert, "POST", "/api/users/invitations", `{"email":"nieuw@example.com","role":"user"}`, 201).body).ID
	e.mails()

	// Bert invited Derde to the family account (0.8-0b): Derde is no member, so
	// for everyone else the invitation is as good as nothing.
	w.accInvitation = decode[ledger.Invitation](t, w.ok(w.bert, "POST", "/api/accounts/"+id(w.shared)+"/invitations", `{"userId":`+id(w.derde)+`}`, 201).body).ID

	// Sync errors: Bert's link failed on the family account (its error code
	// is his alone), Partner's link failed as a whole.
	w.exec(`UPDATE account_sources SET status = 'failed', last_error = 'BERTFOUT_X' WHERE account_id = ? AND connection_id = ?`, w.shared, w.bertConn)
	w.exec(`UPDATE provider_connections SET sync_status = 'failed', last_error = 'PARTNERFOUT_Y' WHERE id = ?`, w.partnerConn)

	// A pending link of Bert (its state), after which the clock moves past
	// the sync cooldown.
	w.ok(w.bert, "POST", "/api/bank/link", `{"connectionId":`+id(w.bertConn)+`}`, 200)
	w.bertState = e.bank.lastState()
	e.now = e.now.Add(20 * time.Minute)
	return w
}

func id(n int64) string { return strconv.FormatInt(n, 10) }

func (w *world) int(q string, args ...any) int64 {
	w.t.Helper()
	var n int64
	if err := w.e.db.QueryRow(q, args...).Scan(&n); err != nil {
		w.t.Fatalf("%s: %v", q, err)
	}
	return n
}

func (w *world) exec(q string, args ...any) {
	w.t.Helper()
	if _, err := w.e.db.Exec(q, args...); err != nil {
		w.t.Fatalf("%s: %v", q, err)
	}
}

func (w *world) ok(user int64, method, path, body string, status int) response {
	w.t.Helper()
	r := w.e.as(user, method, path, body)
	if r.status != status {
		w.t.Fatalf("%s %s: %d %s, want %d", method, path, r.status, r.body, status)
	}
	return r
}

func (w *world) rule(user int64, body string) int64 {
	w.t.Helper()
	return decode[ledger.RuleView](w.t, w.ok(user, "POST", "/api/rules", body, 201).body).ID
}

func (w *world) importFile(user int64, name, csv string, account int64) importBody {
	w.t.Helper()
	r := w.e.upload(user, "/api/imports", formPart{"file", name, csv}, formPart{"accountId", "", id(account)}, formPart{"mapping", "", csvMapping})
	if r.status != http.StatusCreated {
		w.t.Fatalf("import: %d %s", r.status, r.body)
	}
	return decode[importBody](w.t, r.body)
}

// bilanceRun imports one Bilance file of Bert's over his current account
// (first) and the family account: two batches of one run.
func (w *world) bilanceRun() importBody {
	w.t.Helper()
	file := "Titel, Datum, Bedrag, Categorie, Subcategorie, Tag(s), Betalingskenmerk, Handelaar, Rekening(en), Notitie\n" +
		`"Runwinkel Prive", 2026-11-02 00:00:00.000, -17.00€, "Eten", "", , "x", "Runwinkel Prive", "Prive", ` + "\n" +
		`"Runwinkel Samen", 2026-11-03 00:00:00.000, -18.00€, "Eten", "", , "y", "Runwinkel Samen", "Gezin", ` + "\n"
	r := w.e.upload(w.bert, "/api/imports", formPart{"file", "run.csv", file},
		formPart{"mapping", "", `{"date":1,"amount":2,"counterparty":7,"communication":6,"category":3,"subcategory":4,"accountName":8,"note":9,"counterpartyFallback":0}`},
		formPart{"accountMap", "", fmt.Sprintf(`{"Prive":%d,"Gezin":%d}`, w.bertAcc, w.shared)})
	if r.status != http.StatusCreated {
		w.t.Fatalf("run import: %d %s", r.status, r.body)
	}
	b := decode[importBody](w.t, r.body)
	if len(b.Batches) != 2 || b.Batches[0].AccountID != w.bertAcc || b.Batches[1].AccountID != w.shared {
		w.t.Fatalf("run import: %s", r.body)
	}
	return b
}

func (w *world) user(as string) int64 {
	switch as {
	case "bert":
		return w.bert
	case "partner":
		return w.partner
	case "derde":
		return w.derde
	case "anon":
		return 0
	}
	w.t.Fatalf("unknown user %q", as)
	return 0
}

// probe is one request of a row. as is "bert", "partner", "anon" or "both"
// (a read run as Bert and as Partner, also by TestPrivacySentinels).
type probe struct {
	as           string
	method, path string
	body         string
	form         []formPart
	status       int
	// missing is the same request with ids that do not exist: it must
	// answer exactly as this one (status and body), and neither may write.
	missing *probe
	// owner sends this request afterwards as the user whose resource it
	// names: it must not answer 404 (else the probe proves nothing).
	owner string
	// pattern is the mux pattern the request reaches, when not the row's.
	pattern string
	verify  func(t *testing.T, w *world)
}

// hidden is a request as as with another user's ids, answered exactly as the
// same request with ids that do not exist (404), writing nothing.
func hidden(as, method, path, body, missingPath, missingBody, owner string) probe {
	return probe{as: as, method: method, path: path, body: body, status: http.StatusNotFound, owner: owner,
		missing: &probe{as: as, method: method, path: missingPath, body: missingBody, status: http.StatusNotFound}}
}

func read(path string, status int) probe {
	return probe{as: "both", method: "GET", path: path, status: status}
}

const none = "999999" // an id that exists nowhere

// ibanContributor is a contributor's IBAN (0.8.1-7): stored for matching, never returned in full.
const ibanContributor = "BE37000000007193"

// send runs one request as a user and returns the answer and the mux pattern it reached.
func (w *world) send(p probe, as string) (response, string) {
	w.t.Helper()
	var body io.Reader
	ct := ""
	switch {
	case p.form != nil:
		b, c := multipartForm(w.t, p.form...)
		body, ct = strings.NewReader(b), c
	case p.body != "":
		body, ct = strings.NewReader(p.body), "application/json"
	}
	req := httptest.NewRequest(p.method, p.path, body)
	if ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	req.Header.Set("User-Agent", iPhone)
	if u := w.user(as); u != 0 {
		req.Header.Set("X-Test-User", id(u))
	}
	// The push routes act on the session's device (0.9-2).
	if strings.HasPrefix(p.path, "/api/push/") || strings.HasPrefix(p.path, "/api/notifications/") {
		switch as {
		case "bert":
			req.Header.Set("X-Test-Device", id(w.bertDevice))
		case "partner":
			req.Header.Set("X-Test-Device", id(w.partnerDevice))
		}
	}
	_, pattern := w.e.s.mux.Handler(req)
	rec := httptest.NewRecorder()
	w.e.h.ServeHTTP(rec, req)
	w.e.s.syncs.Wait()
	return response{status: rec.Code, header: rec.Header(), body: rec.Body.String()}, pattern
}

// forbidden are the strings the viewer must never see in state.
func forbidden(viewer, state string) []string {
	out := append(slices.Clone(derdeSecrets), neverShown...)
	switch viewer {
	case "bert":
		out = append(out, partnerSecrets...)
	case "partner":
		out = append(out, bertSecrets...)
		if state == "left" {
			out = append(out, sharedSecrets...)
		}
	case "anon":
		out = append(append(append(out, bertSecrets...), partnerSecrets...), sharedSecrets...)
	}
	return out
}

// allowed are the documented exceptions: route -> viewer -> strings.
var allowed = map[string]map[string][]string{
	// The admin manages users (analysis 2): names and e-mail addresses only.
	"GET /api/users": {"bert": {"partner@jouw-domein.be", "derde@example.com"}},
	// Partner's own manual account with the IBAN of Bert's: her own input.
	"POST /api/accounts": {"partner": {"5615"}},
}

// leaks fails for each forbidden string in an answer.
func leaks(t *testing.T, route, viewer, state string, p probe, r response) {
	t.Helper()
	for _, s := range forbidden(viewer, state) {
		if slices.Contains(allowed[route][viewer], s) {
			continue
		}
		if strings.Contains(r.body, s) {
			t.Errorf("%s: %s %s as %s shows %q: %s", state, p.method, p.path, viewer, s, r.body)
		}
	}
}

// run sends a probe and checks it: status, pattern, leaks, the missing twin,
// that nothing was written, and the owner.
func (w *world) run(t *testing.T, route string, p probe) {
	t.Helper()
	who := []string{p.as}
	if p.as == "both" {
		who = []string{"bert", "partner"}
	}
	for _, as := range who {
		before := snapshotDB(t, w.e.db)
		r, pattern := w.send(p, as)
		want := route
		if p.pattern != "" {
			want = p.pattern
		}
		if want != "-" && pattern != want { // "-": a probe outside the table
			t.Errorf("%s %s reaches %q, want %q", p.method, p.path, pattern, want)
		}
		if r.status != p.status {
			t.Errorf("%s %s as %s: %d %s, want %d", p.method, p.path, as, r.status, r.body, p.status)
		}
		leaks(t, route, as, "baseline", p, r)
		if p.missing != nil {
			m, _ := w.send(*p.missing, as)
			if m.status != r.status || m.body != r.body {
				t.Errorf("%s %s as %s answers %d %s; with ids that do not exist %d %s", p.method, p.path, as, r.status, r.body, m.status, m.body)
			}
			if snapshotDB(t, w.e.db) != before {
				t.Errorf("%s %s as %s wrote", p.method, p.path, as)
			}
		}
		if p.verify != nil {
			p.verify(t, w)
		}
	}
	if p.owner != "" {
		if r, _ := w.send(p, p.owner); r.status == http.StatusNotFound || r.status == 0 {
			t.Errorf("%s %s as the owner %s: %d %s; the probe names nothing that exists", p.method, p.path, p.owner, r.status, r.body)
		}
	}
}

// privacyRow is a route with what it is and how rules 1-5 are proven for it.
type privacyRow struct {
	route  string
	kind   string // public, auth, own, list, byid, write, admin, shared-tree, fallback
	check  string
	probes func(w *world) []probe
	tests  []string // further tests that cover it
}

func privacyRows() []privacyRow {
	return []privacyRow{
		{"GET /api/health", "public", "no data: status and version only", func(w *world) []probe {
			return []probe{{as: "anon", method: "GET", path: "/api/health", status: 200}}
		}, []string{"TestHealth"}},
		{"GET /healthz", "public", "no data", func(w *world) []probe {
			return []probe{{as: "anon", method: "GET", path: "/healthz", status: 200}}
		}, nil},
		{"GET /api/demo/as/{who}", "public", "demo mode only (not registered outside it, so it is the 401 of /api/); switches between the two demo users",
			func(w *world) []probe {
				return []probe{{as: "anon", method: "GET", path: "/api/demo/as/partner", status: 401, pattern: "/api/"}}
			}, []string{"TestDemoCanActAsPartner", "TestDemoSwitchIsDemoOnly"}},
		{"GET /api/me", "own", "the viewer's own user row and preferences", func(w *world) []probe {
			return []probe{read("/api/me", 200)}
		}, []string{"TestMe"}},
		{"PATCH /api/me", "own", "changes and answers the viewer's own name", func(w *world) []probe {
			return []probe{{as: "partner", method: "PATCH", path: "/api/me", body: `{"name":"Partner"}`, status: 200}}
		}, []string{"TestPatchMe"}},
		{"PUT /api/me/preferences", "own", "the viewer's own preferences", func(w *world) []probe {
			return []probe{{as: "partner", method: "PUT", path: "/api/me/preferences", body: `{"scope":"gedeeld"}`, status: 200}}
		}, []string{"TestPreferences"}},
		{"PUT /api/me/password", "own", "the viewer's own password; another user's password does not count", func(w *world) []probe {
			return []probe{{as: "partner", method: "PUT", path: "/api/me/password", body: jsonBody(map[string]string{"current": bertPass, "new": "een heel nieuwe zin"}), status: 400}}
		}, []string{"TestDeviceLifecycle"}},
		{"POST /api/auth/login", "auth", "never reveals whether an address has an account", nil, []string{"TestLoginDoesNotEnumerate", "TestSignInFlow"}},
		{"POST /api/auth/verify", "auth", "a code only for its own challenge", nil, []string{"TestCodeAttemptsExpiryAndReuse", "TestSignInFlow"}},
		{"POST /api/auth/logout", "own", "signs out the viewer's own device", func(w *world) []probe {
			return []probe{{as: "partner", method: "POST", path: "/api/auth/logout", status: 204}}
		}, []string{"TestDeviceLifecycle"}},
		{"GET /api/auth/token/{token}", "auth", "a one-time token: unknown and used answer alike", func(w *world) []probe {
			return []probe{{as: "anon", method: "GET", path: "/api/auth/token/onbekend", status: 404}}
		}, []string{"TestInvitationAndReset", "TestSetupOnlyWhileNoUser"}},
		{"POST /api/auth/redeem", "auth", "a one-time token", nil, []string{"TestInvitationAndReset"}},
		{"GET /api/devices", "list", "the viewer's own devices", func(w *world) []probe {
			return []probe{read("/api/devices", 200)}
		}, []string{"TestDevicesArePrivate"}},
		{"DELETE /api/devices/{id}", "byid", "another user's device is 404 as a missing one", func(w *world) []probe {
			return []probe{
				hidden("partner", "DELETE", "/api/devices/"+id(w.bertDevice), "", "/api/devices/"+none, "", "bert"),
				hidden("bert", "DELETE", "/api/devices/"+id(w.partnerDevice), "", "/api/devices/"+none, "", "partner"),
			}
		}, []string{"TestDevicesArePrivate"}},
		{"POST /api/devices/sign-out-others", "own", "signs out the viewer's other devices only", func(w *world) []probe {
			return []probe{{as: "partner", method: "POST", path: "/api/devices/sign-out-others", status: 204, verify: func(t *testing.T, w *world) {
				if w.int(`SELECT COUNT(*) FROM devices WHERE id = ? AND revoked_at IS NULL`, w.bertDevice) != 1 {
					t.Error("Partner signed out Bert's device")
				}
			}}}
		}, nil},
		{"GET /api/users", "admin", "admin only (403 otherwise): names, e-mail addresses and roles, no account data", func(w *world) []probe {
			return []probe{{as: "partner", method: "GET", path: "/api/users", status: 403}, {as: "bert", method: "GET", path: "/api/users", status: 200}}
		}, nil},
		{"POST /api/users/invitations", "admin", "admin only", func(w *world) []probe {
			return []probe{{as: "partner", method: "POST", path: "/api/users/invitations", body: `{"email":"x@example.com","role":"user"}`, status: 403,
				missing: &probe{as: "partner", method: "POST", path: "/api/users/invitations", body: `{"email":"y@example.com","role":"admin"}`, status: 403}}}
		}, []string{"TestInvitationAndReset"}},
		{"DELETE /api/users/invitations/{id}", "admin", "admin only; the same 403 for any id", func(w *world) []probe {
			return []probe{{as: "partner", method: "DELETE", path: "/api/users/invitations/" + id(w.invitation), status: 403,
				missing: &probe{as: "partner", method: "DELETE", path: "/api/users/invitations/" + none, status: 403}}}
		}, nil},
		{"POST /api/users/{id}/password-reset", "admin", "admin only; the same 403 for any id", func(w *world) []probe {
			return []probe{{as: "partner", method: "POST", path: "/api/users/" + id(w.bert) + "/password-reset", status: 403,
				missing: &probe{as: "partner", method: "POST", path: "/api/users/" + none + "/password-reset", status: 403}}}
		}, []string{"TestInvitationAndReset"}},
		{"GET /api/users/{id}/removal-preview", "admin", "admin only; counts only, never names or ids of accounts the admin does not hold (a documented exception to 'not as a count')", func(w *world) []probe {
			return []probe{
				{as: "partner", method: "GET", path: "/api/users/" + id(w.bert) + "/removal-preview", status: 403,
					missing: &probe{as: "partner", method: "GET", path: "/api/users/" + none + "/removal-preview", status: 403}},
				{as: "bert", method: "GET", path: "/api/users/" + id(w.partner) + "/removal-preview", status: 200},
			}
		}, []string{"TestDeleteUser"}},
		{"DELETE /api/users/{id}", "admin", "admin only; the same 403 for any id", func(w *world) []probe {
			return []probe{{as: "partner", method: "DELETE", path: "/api/users/" + id(w.derde), status: 403,
				missing: &probe{as: "partner", method: "DELETE", path: "/api/users/" + none, status: 403}}}
		}, []string{"TestDeleteUser"}},
		{"GET /api/accounts", "list", "account_access of the viewer; members only on shared accounts; open invitations (the invitees' names) only for the account's manager; syncError only of the viewer's own link", func(w *world) []probe {
			return []probe{read("/api/accounts", 200)}
		}, []string{"TestPatchMember", "TestAccountSources", "TestInvitationRoutes", "TestPrivacyInviteeBeforeAccepting"}},
		{"POST /api/accounts", "own", "a manual account of the viewer; another user's IBAN joins nothing and is not refused", func(w *world) []probe {
			return []probe{{as: "partner", method: "POST", path: "/api/accounts", body: `{"name":"Zijn spaarpot","type":"savings","iban":"BE83 3630 1234 5615"}`, status: 201,
				verify: func(t *testing.T, w *world) {
					if n := w.int(`SELECT COUNT(*) FROM account_access WHERE user_id = ?`, w.bert); n != 3 {
						t.Errorf("Bert holds %d accounts", n)
					}
				}}}
		}, nil},
		{"PATCH /api/accounts/{id}", "byid", "accessOf: hidden 404, read-only 403, member 403 (the shared flag too: only the manager)", func(w *world) []probe {
			return []probe{
				{as: "partner", method: "PATCH", path: "/api/accounts/" + id(w.shared), body: `{"shared":false}`, status: 403},
				hidden("partner", "PATCH", "/api/accounts/"+id(w.bertAcc), `{"name":"Gezien"}`, "/api/accounts/"+none, `{"name":"Gezien"}`, "bert"),
				hidden("partner", "PATCH", "/api/accounts/"+id(w.bertManual), `{"iban":""}`, "/api/accounts/"+none, `{"iban":""}`, "bert"),
				hidden("bert", "PATCH", "/api/accounts/"+id(w.partnerAcc), `{"buffer":0}`, "/api/accounts/"+none, `{"buffer":0}`, "partner"),
			}
		}, []string{"TestWritePermissions", "TestSharedFlagRoute"}},
		{"DELETE /api/accounts/{id}", "byid", "accessOf before any check", func(w *world) []probe {
			return []probe{
				hidden("partner", "DELETE", "/api/accounts/"+id(w.bertManual), "", "/api/accounts/"+none, "", "bert"),
				hidden("bert", "DELETE", "/api/accounts/"+id(w.partnerManual)+"?confirm=Potje+Partner", "", "/api/accounts/"+none+"?confirm=Potje+Partner", "", "partner"),
			}
		}, []string{"TestWritePermissions", "TestDeleteSharedAccount"}},
		{"POST /api/accounts/{id}/leave", "byid", "accessOf before the last-member check", func(w *world) []probe {
			return []probe{hidden("partner", "POST", "/api/accounts/"+id(w.bertAcc)+"/leave", "", "/api/accounts/"+none+"/leave", "", "bert")}
		}, []string{"TestLeaveAsMember"}},
		{"PUT /api/accounts/{id}/balance", "byid", "accessOf before the manual check", func(w *world) []probe {
			return []probe{
				hidden("partner", "PUT", "/api/accounts/"+id(w.bertManual)+"/balance", `{"balance":1}`, "/api/accounts/"+none+"/balance", `{"balance":1}`, "bert"),
				hidden("partner", "PUT", "/api/accounts/"+id(w.bertAcc)+"/balance", `{"balance":1}`, "/api/accounts/"+none+"/balance", `{"balance":1}`, "bert"),
			}
		}, []string{"TestWritePermissions"}},
		{"PATCH /api/accounts/{id}/members/{userId}", "byid", "accessOf, then manager only (403 before the target is looked up), then the member", func(w *world) []probe {
			return []probe{
				hidden("partner", "PATCH", "/api/accounts/"+id(w.bertAcc)+"/members/"+id(w.bert), `{"permission":"read"}`, "/api/accounts/"+none+"/members/"+id(w.bert), `{"permission":"read"}`, "bert"),
				hidden("bert", "PATCH", "/api/accounts/"+id(w.partnerAcc)+"/members/"+id(w.partner), `{"permission":"read"}`, "/api/accounts/"+none+"/members/"+id(w.partner), `{"permission":"read"}`, "partner"),
				// A member the manager's account does not have is the same 404 as a user that does not exist.
				hidden("bert", "PATCH", "/api/accounts/"+id(w.shared)+"/members/"+id(w.derde), `{"permission":"read"}`, "/api/accounts/"+id(w.shared)+"/members/"+none, `{"permission":"read"}`, ""),
			}
		}, []string{"TestPatchMember", "TestWritePermissions"}},
		{"POST /api/accounts/{id}/convert-rules", "byid", "accessOf, manager only; converts the viewer's own user rules", func(w *world) []probe {
			return []probe{hidden("partner", "POST", "/api/accounts/"+id(w.bertAcc)+"/convert-rules", "", "/api/accounts/"+none+"/convert-rules", "", "bert")}
		}, []string{"TestWritePermissions", "TestJoinSharedAccount"}},
		{"GET /api/accounts/{id}/contributions", "byid", "accessOf; the figure only from the shared account's own rows; senders as a count, sender IBANs (masked) only the viewer's own", func(w *world) []probe {
			return []probe{
				read("/api/accounts/"+id(w.shared)+"/contributions", 200),
				read("/api/accounts/"+id(w.shared)+"/contributions?month=2026-10", 200),
				hidden("partner", "GET", "/api/accounts/"+id(w.bertAcc)+"/contributions", "", "/api/accounts/"+none+"/contributions", "", "bert"),
				hidden("bert", "GET", "/api/accounts/"+id(w.partnerAcc)+"/contributions", "", "/api/accounts/"+none+"/contributions", "", "partner"),
			}
		}, []string{"TestContributionFigure", "TestContributionClaims"}},
		{"POST /api/accounts/{id}/contribution-senders", "byid", "accessOf, edit; the IBAN only from an account the viewer holds or a row of this account from outside Saldo: another user's account, a row elsewhere and a Saldo IBAN refuse as a missing id", func(w *world) []probe {
			path := "/api/accounts/" + id(w.shared) + "/contribution-senders"
			return []probe{
				hidden("partner", "POST", "/api/accounts/"+id(w.bertAcc)+"/contribution-senders", `{"fromAccountId":`+id(w.partnerAcc)+`}`, "/api/accounts/"+none+"/contribution-senders", `{"fromAccountId":`+id(w.partnerAcc)+`}`, ""),
				{as: "partner", method: "POST", path: path, body: `{"fromAccountId":` + id(w.bertAcc) + `}`, status: 400,
					missing: &probe{as: "partner", method: "POST", path: path, body: `{"fromAccountId":` + none + `}`, status: 400}},
				{as: "partner", method: "POST", path: path, body: `{"fromAccountId":` + id(w.bertManual) + `}`, status: 400,
					missing: &probe{as: "partner", method: "POST", path: path, body: `{"fromAccountId":` + none + `}`, status: 400}},
				{as: "bert", method: "POST", path: path, body: `{"transactionId":` + id(w.partnerTx) + `}`, status: 400,
					missing: &probe{as: "bert", method: "POST", path: path, body: `{"transactionId":` + none + `}`, status: 400}},
				// Bert's contribution comes from his IBAN, an account in Saldo.
				{as: "partner", method: "POST", path: path, body: `{"transactionId":` + id(w.bertContribution) + `}`, status: 400,
					missing: &probe{as: "partner", method: "POST", path: path, body: `{"transactionId":` + none + `}`, status: 400}},
			}
		}, []string{"TestContributionClaims", "TestWritePermissions"}},
		{"DELETE /api/accounts/{id}/contribution-senders/{senderId}", "byid", "accessOf, edit, the sender of this account; the claimant's own or the manager", func(w *world) []probe {
			return []probe{
				hidden("partner", "DELETE", "/api/accounts/"+id(w.bertAcc)+"/contribution-senders/"+id(w.bertSender), "", "/api/accounts/"+none+"/contribution-senders/"+id(w.bertSender), "", ""),
				hidden("bert", "DELETE", "/api/accounts/"+id(w.partnerAcc)+"/contribution-senders/"+id(w.partnerSender), "", "/api/accounts/"+id(w.shared)+"/contribution-senders/"+none, "", ""),
				{as: "partner", method: "DELETE", path: "/api/accounts/" + id(w.shared) + "/contribution-senders/" + id(w.bertSender), status: 403},
			}
		}, []string{"TestContributionClaims", "TestWritePermissions"}},
		{"PUT /api/accounts/{id}/contribution-shares", "byid", "accessOf, manager only; every member named", func(w *world) []probe {
			body := `{"shares":{"` + id(w.bert) + `":50,"` + id(w.partner) + `":40,"c` + id(w.bertContributor) + `":10}}`
			return []probe{
				hidden("partner", "PUT", "/api/accounts/"+id(w.bertAcc)+"/contribution-shares", body, "/api/accounts/"+none+"/contribution-shares", body, "bert"),
				hidden("bert", "PUT", "/api/accounts/"+id(w.partnerAcc)+"/contribution-shares", `{"shares":null}`, "/api/accounts/"+none+"/contribution-shares", `{"shares":null}`, "partner"),
				{as: "partner", method: "PUT", path: "/api/accounts/" + id(w.shared) + "/contribution-shares", body: body, status: 403},
				{as: "bert", method: "PUT", path: "/api/accounts/" + id(w.shared) + "/contribution-shares", body: body, status: 200},
			}
		}, []string{"TestContributionShares", "TestWritePermissions"}},
		{"POST /api/accounts/{id}/contributors", "byid", "accessOf, edit, shared; the IBAN typed (checksum) or from an incoming row of this account only (a row elsewhere refuses as a missing id); an IBAN in use answers one text naming nobody; nothing outside the account is looked up; the answer masks the IBAN to the creator and the manager", func(w *world) []probe {
			path := "/api/accounts/" + id(w.shared) + "/contributors"
			body := `{"name":"Oom","iban":"BE62510007547061"}`
			return []probe{
				hidden("partner", "POST", "/api/accounts/"+id(w.bertAcc)+"/contributors", body, "/api/accounts/"+none+"/contributors", body, "bert"),
				{as: "partner", method: "POST", path: path, body: `{"name":"Oom","transactionId":` + id(w.bertTx) + `}`, status: 400,
					missing: &probe{as: "partner", method: "POST", path: path, body: `{"name":"Oom","transactionId":` + none + `}`, status: 400}},
				{as: "partner", method: "POST", path: path, body: `{"name":"Oom","iban":"` + ibanContributor + `"}`, status: 409},
			}
		}, []string{"TestContributorsIBANRulesAndVisibility", "TestContributorsMemberWinsAndLinking"}},
		{"PATCH /api/accounts/{id}/contributors/{contributorId}", "byid", "accessOf, edit, shared, the contributor of this account; the same IBAN rules as adding", func(w *world) []probe {
			c, body := id(w.bertContributor), `{"name":"Oma"}`
			return []probe{
				hidden("partner", "PATCH", "/api/accounts/"+id(w.bertAcc)+"/contributors/"+c, body, "/api/accounts/"+none+"/contributors/"+c, body, ""),
				hidden("bert", "PATCH", "/api/accounts/"+id(w.partnerAcc)+"/contributors/"+c, body, "/api/accounts/"+id(w.shared)+"/contributors/"+none, body, ""),
			}
		}, []string{"TestContributorsIBANRulesAndVisibility"}},
		{"DELETE /api/accounts/{id}/contributors/{contributorId}", "byid", "accessOf, edit, shared, the contributor of this account; every share back to equal", func(w *world) []probe {
			c := id(w.bertContributor)
			return []probe{
				hidden("partner", "DELETE", "/api/accounts/"+id(w.bertAcc)+"/contributors/"+c, "", "/api/accounts/"+none+"/contributors/"+c, "", ""),
				hidden("bert", "DELETE", "/api/accounts/"+id(w.partnerAcc)+"/contributors/"+c, "", "/api/accounts/"+id(w.shared)+"/contributors/"+none, "", ""),
			}
		}, []string{"TestContributorsNeedSplitAndRecognition"}},
		{"PUT /api/accounts/{id}/contributors/{contributorId}/link", "byid", "accessOf, manager only, the contributor of this account; the user must be a member (a non-member and a missing user: one answer)", func(w *world) []probe {
			c, body := id(w.bertContributor), `{"userId":`+id(w.partner)+`}`
			return []probe{
				hidden("partner", "PUT", "/api/accounts/"+id(w.bertAcc)+"/contributors/"+c+"/link", body, "/api/accounts/"+none+"/contributors/"+c+"/link", body, ""),
				{as: "partner", method: "PUT", path: "/api/accounts/" + id(w.shared) + "/contributors/" + c + "/link", body: body, status: 403},
				{as: "bert", method: "PUT", path: "/api/accounts/" + id(w.shared) + "/contributors/" + c + "/link", body: `{"userId":` + id(w.derde) + `}`, status: 400,
					missing: &probe{as: "bert", method: "PUT", path: "/api/accounts/" + id(w.shared) + "/contributors/" + c + "/link", body: `{"userId":` + none + `}`, status: 400}},
			}
		}, []string{"TestContributorsMemberWinsAndLinking"}},
		{"POST /api/accounts/{id}/contributors/{contributorId}/link-answer", "byid", "accessOf, the contributor offered to the viewer (anyone else's: the 404 of a missing one), edit; Ja makes the IBAN the viewer's own sender in one transaction, audited with ids only", func(w *world) []probe {
			c := id(w.bertContributor)
			return []probe{
				hidden("bert", "POST", "/api/accounts/"+id(w.shared)+"/contributors/"+c+"/link-answer", `{"yes":true}`, "/api/accounts/"+id(w.shared)+"/contributors/"+none+"/link-answer", `{"yes":true}`, ""),
				hidden("partner", "POST", "/api/accounts/"+id(w.bertAcc)+"/contributors/"+c+"/link-answer", `{"yes":true}`, "/api/accounts/"+none+"/contributors/"+c+"/link-answer", `{"yes":true}`, ""),
			}
		}, []string{"TestContributorsMemberWinsAndLinking"}},
		{"GET /api/accounts/{id}/invitable", "byid", "accessOf, then manager only (a member's 403 comes before anything is listed); the instance's users by name and initial, never an e-mail address or an account; an invitee is no member and gets the 404 of a missing account", func(w *world) []probe {
			path := func(account string) string { return "/api/accounts/" + account + "/invitable" }
			return []probe{
				hidden("partner", "GET", path(id(w.bertAcc)), "", path(none), "", "bert"),
				hidden("derde", "GET", path(id(w.shared)), "", path(none), "", "bert"),
				{as: "partner", method: "GET", path: path(id(w.shared)), status: 403},
				{as: "bert", method: "GET", path: path(id(w.shared)), status: 200},
			}
		}, []string{"TestInvitationRoutes", "TestPrivacyInviteeBeforeAccepting"}},
		{"POST /api/accounts/{id}/invitations", "byid", "accessOf, then manager only, then shared, then the user: a member's 403 is the same for any user id (no probing for users), a stranger's or an invitee's 404 that of a missing account", func(w *world) []probe {
			path := func(account int64) string { return "/api/accounts/" + id(account) + "/invitations" }
			invite := func(user string) string { return `{"userId":` + user + `}` }
			return []probe{
				hidden("partner", "POST", path(w.bertAcc), invite(id(w.derde)), "/api/accounts/"+none+"/invitations", invite(id(w.derde)), "bert"),
				hidden("derde", "POST", path(w.shared), invite(id(w.partner)), "/api/accounts/"+none+"/invitations", invite(id(w.partner)), "bert"),
				{as: "partner", method: "POST", path: path(w.shared), body: invite(id(w.derde)), status: 403,
					missing: &probe{as: "partner", method: "POST", path: path(w.shared), body: invite(none), status: 403}},
			}
		}, []string{"TestInvitationRoutes", "TestPrivacyInviteeBeforeAccepting"}},
		{"POST /api/invitations/{id}/accept", "byid", "only the invitee's own open invitation: the manager, a member and a stranger get the 404 of a missing one", func(w *world) []probe {
			path, missing := "/api/invitations/"+id(w.accInvitation)+"/accept", "/api/invitations/"+none+"/accept"
			return []probe{
				hidden("bert", "POST", path, "", missing, "", ""),
				hidden("partner", "POST", path, "", missing, "", "derde"),
			}
		}, []string{"TestInvitationRoutes", "TestJoinByInvitationCallback"}},
		{"DELETE /api/invitations/{id}", "byid", "the invitee (declines) or the account's manager (revokes); a member and a stranger get the 404 of a missing one", func(w *world) []probe {
			return []probe{hidden("partner", "DELETE", "/api/invitations/"+id(w.accInvitation), "", "/api/invitations/"+none, "", "derde")}
		}, []string{"TestInvitationRoutes"}},
		{"GET /api/join-offers", "list", "the viewer's own offers; an offer shows only the masked IBAN and the viewer's own bank", func(w *world) []probe {
			return []probe{read("/api/join-offers", 200)}
		}, []string{"TestJoinSharedAccount"}},
		{"POST /api/join-offers/{id}/accept", "byid", "only the viewer's own offer", func(w *world) []probe {
			return []probe{hidden("partner", "POST", "/api/join-offers/"+id(w.bertOffer)+"/accept", "", "/api/join-offers/"+none+"/accept", "", "bert")}
		}, []string{"TestJoinSharedAccount"}},
		{"DELETE /api/join-offers/{id}", "byid", "only the viewer's own offer", func(w *world) []probe {
			return []probe{hidden("partner", "DELETE", "/api/join-offers/"+id(w.bertOffer), "", "/api/join-offers/"+none, "", "bert")}
		}, []string{"TestJoinDeclineAndNoRulesNotice"}},
		{"POST /api/notices/{id}/read", "byid", "only a notice addressed to the viewer", func(w *world) []probe {
			return []probe{
				hidden("partner", "POST", "/api/notices/"+id(w.bertNotice)+"/read", "", "/api/notices/"+none+"/read", "", "bert"),
				hidden("bert", "POST", "/api/notices/"+id(w.partnerNotice)+"/read", "", "/api/notices/"+none+"/read", "", "partner"),
			}
		}, []string{"TestJoinSharedAccount"}},
		{"GET /api/accounts/{id}/balances", "byid", "accessOf; the shared account's history for every member", func(w *world) []probe {
			return []probe{
				read("/api/accounts/"+id(w.shared)+"/balances", 200),
				hidden("partner", "GET", "/api/accounts/"+id(w.bertAcc)+"/balances", "", "/api/accounts/"+none+"/balances", "", "bert"),
				hidden("partner", "GET", "/api/accounts/"+id(w.bertManual)+"/balances", "", "/api/accounts/"+none+"/balances", "", "bert"),
				hidden("bert", "GET", "/api/accounts/"+id(w.partnerAcc)+"/balances", "", "/api/accounts/"+none+"/balances", "", "partner"),
			}
		}, nil},
		{"GET /api/accounts/{id}/transfers", "byid", "accessOf; the rows of the viewer's own other accounts only", func(w *world) []probe {
			return []probe{
				read("/api/accounts/"+id(w.shared)+"/transfers", 200),
				hidden("partner", "GET", "/api/accounts/"+id(w.bertManual)+"/transfers", "", "/api/accounts/"+none+"/transfers", "", "bert"),
				hidden("partner", "GET", "/api/accounts/"+id(w.bertAcc)+"/transfers", "", "/api/accounts/"+none+"/transfers", "", "bert"),
				hidden("bert", "GET", "/api/accounts/"+id(w.partnerAcc)+"/transfers", "", "/api/accounts/"+none+"/transfers", "", "partner"),
			}
		}, []string{"TestIncomingTransfers"}},
		{"GET /api/transactions", "list", "visibleTx: the viewer's accounts only; total, next, transfer and ruleId per viewer", func(w *world) []probe {
			ps := []probe{}
			for _, q := range transactionQueries(w) {
				ps = append(ps, read("/api/transactions"+q, 200))
			}
			return append(ps,
				hidden("partner", "GET", "/api/transactions?account="+id(w.bertAcc), "", "/api/transactions?account="+none, "", "bert"),
				hidden("partner", "GET", "/api/transactions?account="+id(w.bertManual)+"&q=x", "", "/api/transactions?account="+none+"&q=x", "", "bert"),
				hidden("bert", "GET", "/api/transactions?account="+id(w.partnerAcc), "", "/api/transactions?account="+none, "", "partner"))
		}, []string{"TestPrivacyPagesAndTotals", "TestTransferIsPerViewer"}},
		{"GET /api/reports/months", "list", "visibleTx: sums of the viewer's current accounts only, the other side of a transfer only among them; account must be a current account the viewer holds: another user's (current or savings) is the 404 of a missing one, before its type is looked at", func(w *world) []probe {
			const path = "/api/reports/months"
			ps := []probe{}
			for _, q := range []string{"", "?scope=alles", "?scope=persoonlijk", "?scope=gedeeld", "?from=2026-11&to=2026-11",
				"?account=" + id(w.shared), "?scope=gedeeld&account=" + id(w.shared), "?detail=1", "?scope=gedeeld&detail=1"} {
				ps = append(ps, read(path+q, 200))
			}
			return append(ps,
				probe{as: "bert", method: "GET", path: path + "?account=" + id(w.bertAcc), status: 200},
				probe{as: "partner", method: "GET", path: path + "?account=" + id(w.partnerAcc), status: 200},
				hidden("partner", "GET", path+"?account="+id(w.bertAcc), "", path+"?account="+none, "", "bert"),
				hidden("bert", "GET", path+"?account="+id(w.partnerAcc), "", path+"?account="+none, "", "partner"),
				// A savings account of another user is not "Kies een betaalrekening." (400): the owner gets that.
				hidden("partner", "GET", path+"?account="+id(w.bertManual), "", path+"?account="+none, "", "bert"),
				hidden("bert", "GET", path+"?account="+id(w.partnerManual), "", path+"?account="+none, "", "partner"))
		}, []string{"TestReportMonthsErrors", "TestReportIsPerViewer"}},
		{"GET /api/reports/budgets", "list", "the account list and the account's check are the report's: another user's account (current or savings) is the 404 of a missing one, before its type is looked at; budget rows and history months are account-level (the same for every member), the average is the viewer's own per-account report of that account; ids and amounts only", func(w *world) []probe {
			const path = "/api/reports/budgets"
			ps := []probe{}
			for _, q := range []string{"", "?scope=alles", "?scope=persoonlijk", "?scope=gedeeld", "?from=2026-11&to=2026-11", "?account=" + id(w.shared),
				"?average=1", "?scope=gedeeld&average=1", "?account=" + id(w.shared) + "&average=1"} { // average=1 (0.9.1-4): the same accounts, the viewer's own average
				ps = append(ps, read(path+q, 200))
			}
			return append(ps,
				probe{as: "bert", method: "GET", path: path + "?account=" + id(w.bertAcc), status: 200},
				probe{as: "partner", method: "GET", path: path + "?account=" + id(w.partnerAcc), status: 200},
				probe{as: "bert", method: "GET", path: path + "?account=" + id(w.bertAcc) + "&average=1", status: 200},
				probe{as: "partner", method: "GET", path: path + "?account=" + id(w.partnerAcc) + "&average=1", status: 200},
				hidden("partner", "GET", path+"?account="+id(w.bertAcc), "", path+"?account="+none, "", "bert"),
				hidden("bert", "GET", path+"?account="+id(w.partnerAcc), "", path+"?account="+none, "", "partner"),
				hidden("partner", "GET", path+"?account="+id(w.bertManual), "", path+"?account="+none, "", "bert"),
				hidden("bert", "GET", path+"?account="+id(w.partnerManual), "", path+"?account="+none, "", "partner"),
				hidden("partner", "GET", path+"?account="+id(w.bertAcc)+"&average=1", "", path+"?account="+none+"&average=1", "", "bert"),
				hidden("bert", "GET", path+"?account="+id(w.partnerAcc)+"&average=1", "", path+"?account="+none+"&average=1", "", "partner"))
		}, []string{"TestReportBudgetsErrors", "TestReportBudgetsDemo", "TestReportBudgetsAverage"}},
		{"GET /api/reports/balances", "list", "the account list and the account's check are the report's: another user's account (current or savings) is the 404 of a missing one, before its type is looked at; snapshot, booked rows and buffer are account-level (the same for every member of a shared account, no per-viewer table); dates and amounts of the viewer's own accounts only, never a sum over accounts", func(w *world) []probe {
			const path = "/api/reports/balances"
			ps := []probe{}
			for _, q := range []string{"", "?scope=alles", "?scope=persoonlijk", "?scope=gedeeld", "?from=2026-11&to=2026-11", "?account=" + id(w.shared)} {
				ps = append(ps, read(path+q, 200))
			}
			return append(ps,
				probe{as: "bert", method: "GET", path: path + "?account=" + id(w.bertAcc), status: 200},
				probe{as: "partner", method: "GET", path: path + "?account=" + id(w.partnerAcc), status: 200},
				hidden("partner", "GET", path+"?account="+id(w.bertAcc), "", path+"?account="+none, "", "bert"),
				hidden("bert", "GET", path+"?account="+id(w.partnerAcc), "", path+"?account="+none, "", "partner"),
				hidden("partner", "GET", path+"?account="+id(w.bertManual), "", path+"?account="+none, "", "bert"),
				hidden("bert", "GET", path+"?account="+id(w.partnerManual), "", path+"?account="+none, "", "partner"))
		}, []string{"TestReportBalancesErrors", "TestReportBalancesDemo"}},
		{"GET /api/reports/receipt", "list", "receipt.Build over ledger.ReportRange: the selection and the account's check are the report's, so another user's account (current or savings) is the 404 of a missing one, before its type is looked at, and answers as an unknown one; amounts, group and subgroup names of the viewer's own current accounts only, the other side of a transfer only among them; the budget reference is account-level (the same for every member of an account); the notes name the viewer's own accounts only; period, scope and account are validated before anything is read", func(w *world) []probe {
			const path = "/api/reports/receipt"
			month, week := "?periode=maand&van=2026-11-01", "?periode=week&van=2026-11-16"
			ps := []probe{}
			for _, q := range []string{month, month + "&scope=persoonlijk", month + "&scope=gedeeld", "?periode=maand&van=2026-10-15", "?periode=week&van=2026-11-09", week,
				week + "&scope=gedeeld", month + "&account=" + id(w.shared), week + "&account=" + id(w.shared), "?periode=week&van=2020-01-01"} {
				ps = append(ps, read(path+q, 200))
			}
			return append(ps,
				probe{as: "anon", method: "GET", path: path + month, status: 401},
				probe{as: "bert", method: "GET", path: path + month + "&account=" + id(w.bertAcc), status: 200},
				probe{as: "partner", method: "GET", path: path + month + "&account=" + id(w.partnerAcc), status: 200},
				hidden("partner", "GET", path+month+"&account="+id(w.bertAcc), "", path+month+"&account="+none, "", "bert"),
				hidden("bert", "GET", path+month+"&account="+id(w.partnerAcc), "", path+month+"&account="+none, "", "partner"),
				// A savings account of another user is not "Kies een betaalrekening." (400): the owner gets that.
				hidden("partner", "GET", path+week+"&account="+id(w.bertManual), "", path+week+"&account="+none, "", "bert"),
				hidden("bert", "GET", path+week+"&account="+id(w.partnerManual), "", path+week+"&account="+none, "", "partner"))
		}, []string{"TestReportReceiptErrors", "TestReceiptIsPerViewer", "TestReportReceiptIsTheMonthReport"}},
		{"GET /mail/", "public", "the logo and the two account icons of the mails: three static PNGs embedded in the binary, looked up by exact file name, no session and no data; everything else under /mail/ is a 404 (never the web app's index.html), other methods the web app's 405", func(w *world) []probe {
			ps := []probe{}
			for _, name := range []string{"logo.png", "person.png", "people.png"} {
				ps = append(ps, probe{as: "anon", method: "GET", path: "/mail/" + name, status: 200}, probe{as: "bert", method: "GET", path: "/mail/" + name, status: 200})
			}
			for _, path := range []string{"/mail/", "/mail/nope.png", "/mail/LOGO.png", "/mail/img/logo.png", "/mail/logo.png/", "/mail/%2e%2e/logo.png", "/mail/templates/layout.html"} {
				ps = append(ps, probe{as: "anon", method: "GET", path: path, status: 404})
			}
			return append(ps, probe{as: "anon", method: "HEAD", path: "/mail/logo.png", status: 200})
		}, []string{"TestMailImagesAreServedWithoutASession", "TestMailImagesServeNothingElse"}},
		{"GET /api/planning", "list", "account-level: the forecast of the current accounts of the scope the viewer holds, from facts that are the same for every member (no per-viewer table; only `me` differs); members only of accounts the viewer holds; no counterparty IBAN", func(w *world) []probe {
			gedeeld := read("/api/planning?scope=gedeeld", 200)
			gedeeld.verify = func(t *testing.T, w *world) { // the shared account is the same for both members
				bert, _ := w.send(gedeeld, "bert")
				partner, _ := w.send(gedeeld, "partner")
				if !sameButMe(bert.body, partner.body) {
					t.Errorf("the shared forecast differs between Bert and Partner: %s | %s", bert.body, partner.body)
				}
			}
			return []probe{read("/api/planning", 200), read("/api/planning?scope=persoonlijk", 200), gedeeld, read("/api/planning?horizon=3&month=2026-12", 200)}
		}, []string{"TestPlanningAPIDemo", "TestPlanningContribution", "TestPrivacySentinels"}},
		{"GET /api/planning/items", "list", "account-level: the current accounts of the scope the viewer holds; the counterparty IBAN is stored but never shown", func(w *world) []probe {
			return []probe{read("/api/planning/items", 200), read("/api/planning/items?scope=persoonlijk", 200), read("/api/planning/items?scope=gedeeld", 200)}
		}, []string{"TestPlanningRoutes", "TestPlanningItemCategoryIsAccountLevel", "TestPrivacySentinels"}},
		{"POST /api/planning/items", "byid", "account-level: accountId through accessOf before any field is read (hidden or savings of another user 404), writes need Bewerken", func(w *world) []probe {
			body := func(account string) string {
				return `{"accountId":` + account + `,"description":"Gas","amount":-5000,"frequency":"monthly","day":5,"kind":"expense"}`
			}
			const path = "/api/planning/items"
			return []probe{
				hidden("partner", "POST", path, body(id(w.bertAcc)), path, body(none), "bert"),
				hidden("partner", "POST", path, body(id(w.bertManual)), path, body(none), "bert"),
				hidden("bert", "POST", path, body(id(w.partnerAcc)), path, body(none), "partner"),
			}
		}, []string{"TestPlanningRoutes"}},
		{"PATCH /api/planning/items/{id}", "byid", "account-level: the item's account through accessOf, writes need Bewerken; another user's item is as missing as an unknown one", func(w *world) []probe {
			return []probe{
				hidden("partner", "PATCH", "/api/planning/items/"+id(w.bertItem), `{"amount":-1}`, "/api/planning/items/"+none, `{"amount":-1}`, "bert"),
				hidden("bert", "PATCH", "/api/planning/items/"+id(w.partnerItem), `{"amount":-1}`, "/api/planning/items/"+none, `{"amount":-1}`, "partner"),
			}
		}, []string{"TestPlanningRoutes", "TestPlanningItemCategoryIsAccountLevel"}},
		{"DELETE /api/planning/items/{id}", "byid", "as PATCH", func(w *world) []probe {
			return []probe{
				hidden("partner", "DELETE", "/api/planning/items/"+id(w.bertItem), "", "/api/planning/items/"+none, "", "bert"),
				hidden("bert", "DELETE", "/api/planning/items/"+id(w.partnerItem), "", "/api/planning/items/"+none, "", "partner"),
			}
		}, []string{"TestPlanningRoutes"}},
		{"GET /api/planning/budgets", "list", "account-level: the current accounts of the scope the viewer holds", func(w *world) []probe {
			return []probe{read("/api/planning/budgets", 200), read("/api/planning/budgets?scope=persoonlijk", 200), read("/api/planning/budgets?scope=gedeeld", 200)}
		}, []string{"TestPlanningRoutes", "TestPrivacySentinels"}},
		{"PUT /api/planning/budgets", "byid", "account-level: accountId through accessOf before any field is read, writes need Bewerken", func(w *world) []probe {
			body := func(account string) string {
				return `{"accountId":` + account + `,"categoryId":2,"fromMonth":"2026-11","amount":100}`
			}
			const path = "/api/planning/budgets"
			return []probe{
				hidden("partner", "PUT", path, body(id(w.bertAcc)), path, body(none), "bert"),
				hidden("bert", "PUT", path, body(id(w.partnerAcc)), path, body(none), "partner"),
			}
		}, []string{"TestPlanningRoutes"}},
		{"GET /api/planning/planned", "list", "account-level: the current accounts of the scope the viewer holds", func(w *world) []probe {
			return []probe{read("/api/planning/planned", 200), read("/api/planning/planned?scope=persoonlijk", 200), read("/api/planning/planned?scope=gedeeld", 200)}
		}, []string{"TestPlanningRoutes", "TestPrivacySentinels"}},
		{"POST /api/planning/planned", "byid", "account-level: accountId through accessOf before any field is read, writes need Bewerken", func(w *world) []probe {
			body := func(account string) string {
				return `{"accountId":` + account + `,"date":"2026-12-05","amount":-100,"description":"Proef"}`
			}
			const path = "/api/planning/planned"
			return []probe{
				hidden("partner", "POST", path, body(id(w.bertAcc)), path, body(none), "bert"),
				hidden("bert", "POST", path, body(id(w.partnerAcc)), path, body(none), "partner"),
			}
		}, []string{"TestPlanningRoutes"}},
		{"PATCH /api/planning/planned/{id}", "byid", "account-level: the planned item's account through accessOf, writes need Bewerken", func(w *world) []probe {
			return []probe{
				hidden("partner", "PATCH", "/api/planning/planned/"+id(w.bertPlanned), `{"amount":-1}`, "/api/planning/planned/"+none, `{"amount":-1}`, "bert"),
				hidden("bert", "PATCH", "/api/planning/planned/"+id(w.partnerPlanned), `{"amount":-1}`, "/api/planning/planned/"+none, `{"amount":-1}`, "partner"),
			}
		}, []string{"TestPlanningRoutes"}},
		{"DELETE /api/planning/planned/{id}", "byid", "as PATCH", func(w *world) []probe {
			return []probe{
				hidden("partner", "DELETE", "/api/planning/planned/"+id(w.bertPlanned), "", "/api/planning/planned/"+none, "", "bert"),
				hidden("bert", "DELETE", "/api/planning/planned/"+id(w.partnerPlanned), "", "/api/planning/planned/"+none, "", "partner"),
			}
		}, []string{"TestPlanningRoutes"}},
		{"GET /api/planning/suggestions", "list", "account-level: the current accounts of the scope the viewer holds; never a counterparty IBAN, and a shared account's kinds never read a member's own accounts", func(w *world) []probe {
			return []probe{read("/api/planning/suggestions", 200), read("/api/planning/suggestions?scope=persoonlijk", 200), read("/api/planning/suggestions?scope=gedeeld", 200)}
		}, []string{"TestPlanningDetectRoutes"}},
		{"GET /api/planning/detection", "byid", "account must be a current account the viewer holds: another user's (current or savings) is the 404 of a missing one, before its type is looked at; no counterparty IBAN", func(w *world) []probe {
			const path = "/api/planning/detection?account="
			return []probe{
				read(path+id(w.shared), 200),
				hidden("partner", "GET", path+id(w.bertAcc), "", path+none, "", "bert"),
				hidden("partner", "GET", path+id(w.bertManual), "", path+none, "", "bert"),
				hidden("bert", "GET", path+id(w.partnerAcc), "", path+none, "", "partner"),
				hidden("bert", "GET", path+id(w.partnerManual), "", path+none, "", "partner"),
			}
		}, []string{"TestPlanningDetectRoutes"}},
		{"PATCH /api/transactions/{id}", "byid", "editable(): the row's account through account_access", func(w *world) []probe {
			return []probe{
				hidden("partner", "PATCH", txPath(w.bertTx, ""), `{"note":"Gezien"}`, txPath(999999, ""), `{"note":"Gezien"}`, "bert"),
				hidden("bert", "PATCH", txPath(w.partnerTx, ""), `{"categoryId":3}`, txPath(999999, ""), `{"categoryId":3}`, "partner"),
			}
		}, []string{"TestWritePermissions"}},
		{"GET /api/transactions/{id}/similar", "byid", "editable(); the rule is the account's or the viewer's", func(w *world) []probe {
			return []probe{hidden("partner", "GET", txPath(w.bertTx, "/similar"), "", txPath(999999, "/similar"), "", "bert")}
		}, nil},
		{"POST /api/transactions/{id}/similar", "byid", "editable(); the rule is the account's or the viewer's", func(w *world) []probe {
			return []probe{hidden("bert", "POST", txPath(w.partnerTx, "/similar"), "", txPath(999999, "/similar"), "", "partner")}
		}, []string{"TestWritePermissions"}},
		{"PUT /api/transactions/{id}/split", "byid", "editable()", func(w *world) []probe {
			body := `{"parts":[{"categoryId":2,"amount":-615},{"categoryId":3,"amount":-615}]}`
			return []probe{hidden("partner", "PUT", txPath(w.bertSplit, "/split"), body, txPath(999999, "/split"), body, "bert")}
		}, []string{"TestWritePermissions"}},
		{"DELETE /api/transactions/{id}/split", "byid", "editable()", func(w *world) []probe {
			return []probe{hidden("partner", "DELETE", txPath(w.bertSplit, "/split"), "", txPath(999999, "/split"), "", "bert")}
		}, []string{"TestWritePermissions"}},
		{"PUT /api/transactions/{id}/transfer", "byid", "visible row through account_access (read-only too); the viewer's own override only", func(w *world) []probe {
			return []probe{
				hidden("partner", "PUT", txPath(w.bertTx, "/transfer"), `{"transfer":true}`, txPath(999999, "/transfer"), `{"transfer":true}`, "bert"),
				hidden("bert", "PUT", txPath(w.partnerTx, "/transfer"), `{"transfer":null}`, txPath(999999, "/transfer"), `{"transfer":null}`, "partner"),
			}
		}, []string{"TestTransferOverrideRoute", "TestTransferIsPerViewer"}},
		{"GET /api/alerts", "list", "the viewer's own connections, accounts and notices; an invitation shows only the account's name and the inviter's name; planning alerts only for the current accounts the viewer holds, from the account-level forecast", func(w *world) []probe {
			return []probe{read("/api/alerts", 200)}
		}, []string{"TestLeaveAsMember", "TestDeleteSharedAccount", "TestPrivacyInviteeBeforeAccepting"}},
		{"GET /api/connections", "list", "the viewer's own links; their accounts only when the viewer holds them", func(w *world) []probe {
			return []probe{read("/api/connections", 200)}
		}, nil},
		{"DELETE /api/connections/{id}", "byid", "the viewer's own link; checked before waiting for a running sync", func(w *world) []probe {
			return []probe{
				hidden("partner", "DELETE", "/api/connections/"+id(w.bertConn)+"?history=keep", "", "/api/connections/"+none+"?history=keep", "", "bert"),
				hidden("bert", "DELETE", "/api/connections/"+id(w.partnerConn)+"?history=delete", "", "/api/connections/"+none+"?history=delete", "", "partner"),
			}
		}, []string{"TestDeleteHiddenConnectionWhileItSyncs"}},
		{"POST /api/sync", "own", "syncs the viewer's own links only", func(w *world) []probe {
			return []probe{{as: "partner", method: "POST", path: "/api/sync", status: 202}}
		}, []string{"TestSyncStatusRunsInTheBackground"}},
		{"GET /api/sync", "list", "the viewer's own runs and links", func(w *world) []probe {
			return []probe{read("/api/sync", 200)}
		}, []string{"TestSyncStatusRunsInTheBackground"}},
		{"GET /api/bank/enablebanking", "own", "the viewer's own credentials, never the key", func(w *world) []probe {
			return []probe{read("/api/bank/enablebanking", 200)}
		}, []string{"TestBankCredentials"}},
		{"PUT /api/bank/enablebanking", "own", "the viewer's own credentials", func(w *world) []probe {
			return []probe{{as: "partner", method: "PUT", path: "/api/bank/enablebanking", body: jsonBody(map[string]string{"applicationId": testAppID, "privateKey": testKeyPEM()}), status: 200}}
		}, []string{"TestBankCredentials"}},
		{"POST /api/bank/link", "byid", "connectionId must be the viewer's own", func(w *world) []probe {
			return []probe{hidden("partner", "POST", "/api/bank/link", `{"connectionId":`+id(w.bertConn)+`}`, "/api/bank/link", `{"connectionId":`+none+`}`, "bert")}
		}, []string{"TestBankLinkPrivacyAndLimits"}},
		{"POST /api/bank/callback", "byid", "the state must be the viewer's own: another user's state answers as an unknown one", func(w *world) []probe {
			p := probe{as: "partner", method: "POST", path: "/api/bank/callback", body: jsonBody(map[string]string{"code": "code-1", "state": w.bertState}), status: 400, owner: "bert"}
			p.missing = &probe{as: "partner", method: "POST", path: "/api/bank/callback", body: jsonBody(map[string]string{"code": "code-1", "state": "onbekende-staat"}), status: 400}
			return []probe{p}
		}, []string{"TestBankCallbackRejectsStates", "TestJoinByInvitationCallback"}},
		{"POST /api/imports/preview", "byid", "accessOf of every account named (accountId, accountMap); duplicates only of that account", func(w *world) []probe {
			return importProbes(w, "/api/imports/preview", 200)
		}, []string{"TestImportBilance"}},
		{"POST /api/imports", "byid", "accessOf of every account named, edit permission", func(w *world) []probe {
			return importProbes(w, "/api/imports", 201)
		}, []string{"TestWritePermissions"}},
		{"GET /api/imports", "list", "batches of accounts the viewer holds; run only over those", func(w *world) []probe {
			return []probe{read("/api/imports", 200)}
		}, []string{"TestImportRunIsPerViewer"}},
		{"GET /api/imports/mappings", "own", "the viewer's own mapping", func(w *world) []probe {
			return []probe{read("/api/imports/mappings?source=bilance", 200), read("/api/imports/mappings?source=csv", 200)}
		}, nil},
		{"PUT /api/imports/mappings", "own", "the viewer's own mapping", func(w *world) []probe {
			return []probe{{as: "partner", method: "PUT", path: "/api/imports/mappings?source=bilance", body: `[]`, status: 200, verify: func(t *testing.T, w *world) {
				if w.int(`SELECT COUNT(*) FROM category_mappings WHERE user_id = ?`, w.bert) != 1 {
					t.Error("Partner changed Bert's mapping")
				}
			}}}
		}, nil},
		{"POST /api/imports/{id}/reapply-categories", "byid", "the batch's account through accessOf, edit", func(w *world) []probe {
			return []probe{
				hidden("partner", "POST", "/api/imports/"+id(w.bertBatch)+"/reapply-categories", "", "/api/imports/"+none+"/reapply-categories", "", "bert"),
				hidden("bert", "POST", "/api/imports/"+id(w.partnerBatch)+"/reapply-categories", "", "/api/imports/"+none+"/reapply-categories", "", "partner"),
			}
		}, []string{"TestWritePermissions"}},
		{"GET /api/imports/{id}/undo-preview", "byid", "the batch (with run: its batches on accounts the viewer holds) through accessOf", func(w *world) []probe {
			return []probe{
				hidden("partner", "GET", "/api/imports/"+id(w.bertBatch)+"/undo-preview", "", "/api/imports/"+none+"/undo-preview", "", "bert"),
				hidden("partner", "GET", "/api/imports/"+id(w.bertRunBatch)+"/undo-preview?run=1", "", "/api/imports/"+none+"/undo-preview?run=1", "", "bert"),
				hidden("bert", "GET", "/api/imports/"+id(w.partnerBatch)+"/undo-preview?run=1", "", "/api/imports/"+none+"/undo-preview?run=1", "", "partner"),
				{as: "partner", method: "GET", path: "/api/imports/" + id(w.sharedRunBatch) + "/undo-preview?run=1", status: 200},
			}
		}, []string{"TestImportRunIsPerViewer"}},
		{"POST /api/imports/{id}/undo", "byid", "as the preview", func(w *world) []probe {
			return []probe{
				hidden("partner", "POST", "/api/imports/"+id(w.bertBatch)+"/undo", "", "/api/imports/"+none+"/undo", "", "bert"),
				hidden("partner", "POST", "/api/imports/"+id(w.bertRunBatch)+"/undo?run=1", "", "/api/imports/"+none+"/undo?run=1", "", "bert"),
			}
		}, []string{"TestImportRunIsPerViewer", "TestWritePermissions"}},
		{"GET /api/categories", "shared-tree", "the tree is shared by design (names, colours and the saving flag of categories anyone made); counts only of the viewer's rows", func(w *world) []probe {
			return []probe{read("/api/categories", 200)}
		}, []string{"TestPrivacySweep", "TestCategoriesList"}},
		{"POST /api/categories", "shared-tree", "the tree is shared by design: a new category is everyone's", func(w *world) []probe {
			return []probe{{as: "partner", method: "POST", path: "/api/categories", body: `{"name":"Hobby","type":"expense","colour":"c3"}`, status: 201}}
		}, []string{"TestCategoryCreateAndUpdate"}},
		{"PATCH /api/categories/{id}", "shared-tree", "the tree is shared by design; the answer's count is the viewer's", func(w *world) []probe {
			return []probe{{as: "partner", method: "PATCH", path: "/api/categories/2", body: `{"name":"Boodschappen"}`, status: 200}}
		}, []string{"TestCategoryCreateAndUpdate"}},
		{"DELETE /api/categories/{id}", "shared-tree", "the tree is shared by design; known exception: the refusal 'a split uses it' counts every user's split parts", func(w *world) []probe {
			return []probe{{as: "partner", method: "DELETE", path: "/api/categories/" + none + "?moveTo=none", status: 404}}
		}, []string{"TestRemoveCategory"}},
		{"GET /api/rules", "list", "visibleRules: the viewer's user rules and the rules of accounts the viewer holds", func(w *world) []probe {
			return []probe{read("/api/rules", 200)}
		}, []string{"TestPrivacySweep"}},
		{"POST /api/rules", "byid", "accountId through accessOf, edit", func(w *world) []probe {
			return []probe{
				hidden("partner", "POST", "/api/rules", `{"accountId":`+id(w.bertAcc)+`,"counterparty":"x","categoryId":2}`, "/api/rules", `{"accountId":`+none+`,"counterparty":"x","categoryId":2}`, "bert"),
				hidden("partner", "POST", "/api/rules", `{"accountId":`+id(w.bertManual)+`,"counterparty":"x","categoryId":2}`, "/api/rules", `{"accountId":`+none+`,"counterparty":"x","categoryId":2}`, "bert"),
			}
		}, []string{"TestWritePermissions"}},
		{"POST /api/rules/apply", "own", "the accounts the viewer may edit", func(w *world) []probe {
			return []probe{{as: "partner", method: "POST", path: "/api/rules/apply", status: 200, verify: func(t *testing.T, w *world) {
				if n := w.int(`SELECT COUNT(*) FROM transactions WHERE account_id = ? AND category_origin = 'rule'`, w.bertAcc); n != 0 {
					t.Errorf("Partner's apply categorised %d of Bert's rows", n)
				}
			}}}
		}, []string{"TestReadOnlyViewerScopedRoutes"}},
		{"POST /api/rules/preview", "byid", "accountId and ruleId through accessOf and visibleRules; counts only the rule's scope", func(w *world) []probe {
			return []probe{
				hidden("partner", "POST", "/api/rules/preview", `{"accountId":`+id(w.bertAcc)+`,"counterparty":"x"}`, "/api/rules/preview", `{"accountId":`+none+`,"counterparty":"x"}`, "bert"),
				hidden("partner", "POST", "/api/rules/preview", `{"ruleId":`+id(w.bertRule)+`,"counterparty":"x"}`, "/api/rules/preview", `{"ruleId":`+none+`,"counterparty":"x"}`, "bert"),
				{as: "partner", method: "POST", path: "/api/rules/preview", body: `{"counterparty":"Geheimwinkel"}`, status: 200},
			}
		}, []string{"TestPrivacySweep"}},
		{"PUT /api/rules/order", "byid", "the rules the viewer may edit, exactly: another user's id is as stale as a missing one", func(w *world) []probe {
			return []probe{{as: "partner", method: "PUT", path: "/api/rules/order", body: `{"ids":[` + id(w.partnerRule) + `,` + id(w.partnerAccRule) + `,` + id(w.bertRule) + `]}`, status: 400,
				missing: &probe{as: "partner", method: "PUT", path: "/api/rules/order", body: `{"ids":[` + id(w.partnerRule) + `,` + id(w.partnerAccRule) + `,` + none + `]}`, status: 400}}}
		}, []string{"TestReadOnlyViewerScopedRoutes"}},
		{"POST /api/rules/{id}/apply", "byid", "visibleRules, edit", func(w *world) []probe {
			return []probe{
				hidden("partner", "POST", rulePath(w.bertRule, "/apply"), "", rulePath(999999, "/apply"), "", "bert"),
				hidden("partner", "POST", rulePath(w.bertAccRule, "/apply"), "", rulePath(999999, "/apply"), "", "bert"),
			}
		}, []string{"TestWritePermissions"}},
		{"PATCH /api/rules/{id}", "byid", "visibleRules, edit", func(w *world) []probe {
			return []probe{
				hidden("partner", "PATCH", rulePath(w.bertRule, ""), `{"priority":1}`, rulePath(999999, ""), `{"priority":1}`, "bert"),
				hidden("bert", "PATCH", rulePath(w.partnerAccRule, ""), `{"counterparty":"Gezien"}`, rulePath(999999, ""), `{"counterparty":"Gezien"}`, "partner"),
			}
		}, []string{"TestWritePermissions"}},
		{"DELETE /api/rules/{id}", "byid", "visibleRules, edit", func(w *world) []probe {
			return []probe{
				hidden("partner", "DELETE", rulePath(w.bertRule, ""), "", rulePath(999999, ""), "", "bert"),
				hidden("bert", "DELETE", rulePath(w.partnerRule, ""), "", rulePath(999999, ""), "", "partner"),
			}
		}, []string{"TestWritePermissions"}},
		{"GET /api/suggestions", "list", "trained on the viewer's accounts only, offered on the ones they may edit", func(w *world) []probe {
			return []probe{read("/api/suggestions", 200)}
		}, []string{"TestPrivacySweep"}},
		{"POST /api/suggestions/confirm", "byid", "only a suggestion offered to the viewer: another user's is as missing as an unknown one", func(w *world) []probe {
			return []probe{hidden("partner", "POST", "/api/suggestions/confirm", `{"counterpartyKey":"geheimwinkel noord","categoryId":2}`,
				"/api/suggestions/confirm", `{"counterpartyKey":"bestaat nergens","categoryId":2}`, "bert")}
		}, []string{"TestReadOnlyViewerScopedRoutes"}},
		{"POST /api/suggestions/dismiss", "byid", "as confirm", func(w *world) []probe {
			return []probe{hidden("bert", "POST", "/api/suggestions/dismiss", `{"counterpartyKey":"partnerzaak zuid","categoryId":2}`,
				"/api/suggestions/dismiss", `{"counterpartyKey":"bestaat nergens","categoryId":2}`, "partner")}
		}, nil},
		{"GET /api/suggestions/backfill", "list", "as the suggestions; examples only of rows the viewer may edit", func(w *world) []probe {
			return []probe{read("/api/suggestions/backfill", 200)}
		}, []string{"TestPrivacySweep"}},
		{"POST /api/suggestions/backfill", "byid", "another user's group counts as stale like an unknown one and changes nothing", func(w *world) []probe {
			return []probe{{as: "partner", method: "POST", path: "/api/suggestions/backfill", body: `{"items":[{"counterpartyKey":"geheimwinkel noord","categoryId":2}]}`, status: 200,
				missing: &probe{as: "partner", method: "POST", path: "/api/suggestions/backfill", body: `{"items":[{"counterpartyKey":"bestaat nergens","categoryId":2}]}`, status: 200}}}
		}, []string{"TestReadOnlyViewerScopedRoutes"}},
		{"GET /api/push/key", "own", "no personal data: the server's public VAPID key and whether push is on", func(w *world) []probe {
			return []probe{read("/api/push/key", 200), {as: "anon", method: "GET", path: "/api/push/key", status: 401}}
		}, []string{"TestPushKey"}},
		{"PUT /api/push/subscription", "own", "bound to the session's own device and user; an endpoint another user holds is deleted and inserted anew for the caller (never updated, nothing of the old row carries over): only that browser knows the endpoint, and the other user's pushes stop going there", func(w *world) []probe {
			return []probe{
				{as: "anon", method: "PUT", path: "/api/push/subscription", body: subscription(w.t, "anon"), status: 401},
				{as: "partner", method: "PUT", path: "/api/push/subscription", body: subscription(w.t, "neu"), status: 204, verify: func(t *testing.T, w *world) {
					if w.int(`SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ? AND device_id = ? AND endpoint = ? AND p256dh = 'bert-k'`, w.bert, w.bertDevice, fcm+"bert") != 1 ||
						w.int(`SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ? AND device_id = ? AND endpoint = ?`, w.partner, w.partnerDevice, fcm+"neu") != 1 ||
						w.int(`SELECT COUNT(*) FROM push_subscriptions`) != 2 {
						t.Error("Partner's subscription touched Bert's, or is not on her own device")
					}
				}},
				{as: "partner", method: "PUT", path: "/api/push/subscription", body: subscription(w.t, "bert"), status: 204, verify: func(t *testing.T, w *world) {
					if w.int(`SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?`, w.bert) != 0 ||
						w.int(`SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ? AND device_id = ? AND endpoint = ? AND p256dh <> 'bert-k'`, w.partner, w.partnerDevice, fcm+"bert") != 1 {
						t.Error("Bert's endpoint was not re-bound to Partner's device as a new row")
					}
				}},
			}
		}, []string{"TestPushSubscriptionAndTestPush", "TestPushCap"}},
		{"DELETE /api/push/subscription", "own", "removes the session device's subscription only", func(w *world) []probe {
			return []probe{
				{as: "anon", method: "DELETE", path: "/api/push/subscription", status: 401},
				{as: "partner", method: "DELETE", path: "/api/push/subscription", status: 204, verify: func(t *testing.T, w *world) {
					if w.int(`SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?`, w.partner) != 0 ||
						w.int(`SELECT COUNT(*) FROM push_subscriptions WHERE device_id = ?`, w.bertDevice) != 1 {
						t.Error("Partner's DELETE removed Bert's subscription, or not hers")
					}
				}},
			}
		}, []string{"TestPushSubscriptionAndTestPush"}},
		{"POST /api/notifications/test", "own", "the generic test push (no personal data) to the session device's own subscription only; at most 5 per user per hour", func(w *world) []probe {
			return []probe{
				{as: "anon", method: "POST", path: "/api/notifications/test", status: 401},
				{as: "partner", method: "POST", path: "/api/notifications/test", status: 200, verify: func(t *testing.T, w *world) {
					sent := w.e.push.Sent()
					if len(sent) != 1 || sent[0].Subscription.Endpoint != fcm+"partner" {
						t.Errorf("Partner's test reached %+v", sent)
					}
				}},
			}
		}, []string{"TestSignedOutDeviceGetsNoPush", "TestPushSubscriptionAndTestPush"}},
		{"GET /api/notifications", "own", "the viewer's own Meldingen settings (the users row and the viewer's own notification_prefs rows merged over the defaults); no account data", func(w *world) []probe {
			return []probe{read("/api/notifications", 200), {as: "anon", method: "GET", path: "/api/notifications", status: 401}}
		}, []string{"TestNotificationSettings", "TestNotificationSettingsArePerUser"}},
		{"PUT /api/notifications", "own", "changes and answers the viewer's own Meldingen settings only: another user's users row and notification_prefs rows are never read or written", func(w *world) []probe {
			return []probe{
				{as: "anon", method: "PUT", path: "/api/notifications", body: `{"lookahead":6}`, status: 401},
				{as: "partner", method: "PUT", path: "/api/notifications", status: 200,
					body: `{"channels":{"email":false,"quietHours":false},"lookahead":6,"types":{"rood":{"push":false},"week":{"email":true}}}`,
					verify: func(t *testing.T, w *world) {
						if w.int(`SELECT COUNT(*) FROM notification_prefs WHERE user_id = ?`, w.bert) != 0 ||
							w.int(`SELECT COUNT(*) FROM users WHERE id = ? AND notify_email = 1 AND quiet_hours = 1 AND lookahead_months = 3`, w.bert) != 1 {
							t.Error("Partner's change touched Bert's settings")
						}
						if w.int(`SELECT COUNT(*) FROM notification_prefs WHERE user_id = ?`, w.partner) != 2 ||
							w.int(`SELECT COUNT(*) FROM users WHERE id = ? AND notify_email = 0 AND quiet_hours = 0 AND lookahead_months = 6`, w.partner) != 1 {
							t.Error("Partner's own settings were not saved")
						}
					}},
				{as: "bert", method: "PUT", path: "/api/notifications", status: 400, body: `{"types":{"device":{"email":false}}}`,
					verify: func(t *testing.T, w *world) {
						if w.int(`SELECT COUNT(*) FROM notification_prefs`) != 2 {
							t.Error("a refused change wrote a row")
						}
					}},
			}
		}, []string{"TestNotificationSettings", "TestNotificationSettingsArePerUser"}},
		{"/api/", "fallback", "unknown API paths: 404 or 405, no data", func(w *world) []probe {
			return []probe{{as: "partner", method: "GET", path: "/api/bestaat-niet", status: 404}}
		}, []string{"TestRouting"}},
		{"/api", "fallback", "no data", func(w *world) []probe {
			return []probe{{as: "anon", method: "GET", path: "/api", status: 404}}
		}, []string{"TestRouting"}},
		{"/", "fallback", "the built web app: static files, no data", func(w *world) []probe {
			return []probe{{as: "anon", method: "GET", path: "/", status: 200}}
		}, []string{"TestWebApp", "TestWebNotBuilt"}},
	}
}

// transactionQueries are the filters the sweep reads the list with.
func transactionQueries(w *world) []string {
	return []string{"", "?limit=1000", "?scope=persoonlijk", "?scope=gedeeld", "?scope=alles&limit=200", "?q=Geheim", "?q=Partner",
		"?q=Runwinkel", "?q=Werkgever", "?q=Bijdrage", "?q=1500", "?q=2460", "?q=12,30", "?q=4,20", "?q=Overschrijving", "?uncategorised=1",
		"?from=2000-01-01&to=2100-12-31", "?account=" + id(w.shared), "?account=" + id(w.shared) + "&q=Runwinkel"}
}

// importProbes put a file into another user's accounts (accountId and
// accountMap) and compare with an account that does not exist.
func importProbes(w *world, path string, ownStatus int) []probe {
	file := formPart{"file", "probe.csv", csvHeader + csvBread}
	mapping := formPart{"mapping", "", csvMapping}
	into := func(account string) []formPart {
		return []formPart{file, formPart{"accountId", "", account}, mapping}
	}
	ps := []probe{}
	for _, c := range []struct {
		as, owner string
		account   int64
	}{{"partner", "bert", w.bertAcc}, {"partner", "bert", w.bertManual}, {"bert", "partner", w.partnerAcc}} {
		ps = append(ps, probe{as: c.as, method: "POST", path: path, form: into(id(c.account)), status: 404, owner: c.owner,
			missing: &probe{as: c.as, method: "POST", path: path, form: into(none)}})
	}
	// An accountMap with one of the viewer's accounts and one of Bert's.
	bilance := "Titel, Datum, Bedrag, Categorie, Subcategorie, Tag(s), Betalingskenmerk, Handelaar, Rekening(en), Notitie\n" +
		`"A", 2026-11-02 00:00:00.000, -1.00€, "", "", , "x", "A", "Mijn", ` + "\n" + `"B", 2026-11-03 00:00:00.000, -2.00€, "", "", , "y", "B", "Zijn", ` + "\n"
	bmap := formPart{"mapping", "", `{"date":1,"amount":2,"counterparty":7,"communication":6,"accountName":8,"counterpartyFallback":0}`}
	mapped := func(his string) []formPart {
		return []formPart{{"file", "b.csv", bilance}, bmap, {"accountMap", "", `{"Mijn":` + id(w.partnerAcc) + `,"Zijn":` + his + `}`}}
	}
	ps = append(ps, probe{as: "partner", method: "POST", path: path, form: mapped(id(w.bertAcc)), status: 404,
		missing: &probe{as: "partner", method: "POST", path: path, form: mapped(none)}})
	// A cutoff for another user's account is as foreign to the import as one for no account.
	cut := func(his string) []formPart {
		return []formPart{{"file", "b.csv", bilance}, bmap, {"accountMap", "", `{"Mijn":` + id(w.partnerAcc) + `,"Zijn":` + id(w.partnerManual) + `}`},
			{"cutoffs", "", `{"` + his + `":"2026-11-01"}`}}
	}
	ps = append(ps, probe{as: "partner", method: "POST", path: path, form: cut(id(w.bertAcc)), status: 400,
		missing: &probe{as: "partner", method: "POST", path: path, form: cut(none)}})
	for i := range ps {
		ps[i].pattern = "POST " + path
		if ps[i].missing != nil {
			ps[i].missing.pattern = ps[i].pattern
		}
	}
	return ps
}

// handlerPattern finds the patterns registered in the package's code.
var (
	handlerPattern = regexp.MustCompile(`\.Handle(?:Func)?\("([^"]+)"`)
	handlerCall    = regexp.MustCompile(`\.Handle(?:Func)?\(`)
)

func registeredRoutes(t *testing.T) []string {
	t.Helper()
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	var routes []string
	calls := 0
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		calls += len(handlerCall.FindAllIndex(src, -1))
		for _, m := range handlerPattern.FindAllStringSubmatch(string(src), -1) {
			routes = append(routes, m[1])
		}
	}
	if calls != len(routes) || len(routes) == 0 {
		t.Fatalf("%d Handle/HandleFunc calls, %d with a literal pattern: register every route with a literal pattern", calls, len(routes))
	}
	return routes
}

var privacyKinds = []string{"public", "auth", "own", "list", "byid", "admin", "shared-tree", "fallback"}

// Every registered route has exactly one row, and every row a route.
func TestEveryRouteHasAPrivacyRow(t *testing.T) {
	routes := registeredRoutes(t)
	rows := map[string]privacyRow{}
	for _, row := range privacyRows() {
		if _, dup := rows[row.route]; dup {
			t.Errorf("two rows for %q", row.route)
		}
		rows[row.route] = row
		if !slices.Contains(privacyKinds, row.kind) || strings.TrimSpace(row.check) == "" {
			t.Errorf("%q: kind %q, check %q", row.route, row.kind, row.check)
		}
		if row.probes == nil && len(row.tests) == 0 {
			t.Errorf("%q has neither probes nor tests", row.route)
		}
	}
	for _, r := range routes {
		if _, ok := rows[r]; !ok {
			t.Errorf("route %q has no row in privacyRows", r)
		}
	}
	for r := range rows {
		if !slices.Contains(routes, r) {
			t.Errorf("row %q names a route that is not registered", r)
		}
	}
	// The named tests exist.
	var src strings.Builder
	files, _ := filepath.Glob("*_test.go")
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		src.Write(b)
	}
	for _, row := range rows {
		for _, name := range row.tests {
			if !strings.Contains(src.String(), "func "+name+"(t *testing.T)") {
				t.Errorf("%q names the test %s, which does not exist", row.route, name)
			}
		}
	}
	// A route without probes and without the "byid" check is only allowed
	// for routes that name no other user's resource.
	for _, row := range rows {
		if row.probes == nil {
			if row.kind == "byid" || row.kind == "list" {
				t.Errorf("%q (%s) needs probes", row.route, row.kind)
			}
			continue
		}
		ps := row.probes(&world{t: t})
		if len(ps) == 0 {
			t.Errorf("%q: its probes are empty", row.route)
		}
		if row.kind == "byid" && !slices.ContainsFunc(ps, func(p probe) bool { return p.missing != nil }) {
			t.Errorf("%q (byid) has no probe with another user's ids against missing ones", row.route)
		}
	}
}

// Every row's probes on a fresh world: the right handler, the expected
// status, none of the other user's strings, another user's ids answered
// exactly as missing ones without writing, and the owner's request real.
func TestPrivacyRoutes(t *testing.T) {
	if testing.Short() {
		t.Skip("about 27 s (a world per route), no goroutines: CI runs it in the plain run, not under -race")
	}
	for _, row := range privacyRows() {
		if row.probes == nil {
			continue
		}
		t.Run(row.route, func(t *testing.T) {
			w := newWorld(t)
			for _, p := range row.probes(w) {
				w.run(t, row.route, p)
			}
			for _, m := range w.e.mails() {
				viewer := map[string]string{"bert@jouw-domein.be": "bert", "partner@jouw-domein.be": "partner"}[m.To]
				if viewer == "" {
					viewer = "anon"
				}
				leaks(t, row.route, viewer, "mail", probe{method: "MAIL", path: m.To}, response{body: m.Subject + m.Text + m.HTML})
			}
		})
	}
}

// The reads of the table as both users, in four states: baseline, Partner
// read-only on the family account, after Partner left it, after Bert deleted
// it. No answer holds the other user's personal strings (after leaving,
// Partner sees nothing of the family account either); in the baseline each
// user's own strings and the family account's show up somewhere, so the
// check is not vacuous.
func TestPrivacySentinels(t *testing.T) {
	for _, state := range []string{"baseline", "read-only", "left", "deleted", "user-deleted"} {
		t.Run(state, func(t *testing.T) {
			w := newWorld(t)
			switch state {
			case "read-only":
				w.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = ? AND user_id = ?`, w.shared, w.partner)
			case "left":
				w.ok(w.partner, "POST", "/api/accounts/"+id(w.shared)+"/leave", "", 200)
			case "deleted":
				w.ok(w.bert, "DELETE", "/api/accounts/"+id(w.shared)+"?confirm=Gezinsrekening", "", 204)
			case "user-deleted":
				w.ok(w.bert, "DELETE", "/api/users/"+id(w.partner), "", 204)
			}
			// Reports (0.7-1): Partner's amounts (her salary, her balance) are in
			// none of Bert's reports, whatever the scope, and her accounts are
			// missing ones to him.
			for _, q := range []string{"", "?scope=alles", "?scope=persoonlijk", "?scope=gedeeld", "?account=" + id(w.shared)} {
				r, _ := w.send(read("/api/reports/months"+q, 200), "bert")
				for _, s := range []string{"246000", "143215"} {
					if strings.Contains(r.body, s) {
						t.Errorf("%s: Bert's report %q shows Partner's %s: %s", state, q, s, r.body)
					}
				}
			}
			for _, account := range []int64{w.partnerAcc, w.partnerManual} {
				r, _ := w.send(read("/api/reports/months?account="+id(account), 404), "bert")
				m, _ := w.send(read("/api/reports/months?account="+none, 404), "bert")
				if r.status != http.StatusNotFound || r.body != m.body {
					t.Errorf("%s: Bert asks for Partner's account %d: %d %s", state, account, r.status, r.body)
				}
			}
			// The sentinel is not dead: it is in Partner's own report.
			if state == "baseline" {
				if r, _ := w.send(read("/api/reports/months?scope=persoonlijk", 200), "partner"); r.status != 200 || !strings.Contains(r.body, "246000") {
					t.Errorf("Partner's report lacks her salary: %d %s", r.status, r.body)
				}
			}
			seen := map[string]*strings.Builder{"bert": {}, "partner": {}}
			for _, row := range privacyRows() {
				if row.probes == nil {
					continue
				}
				for _, p := range row.probes(w) {
					if p.method != "GET" || p.missing != nil || p.as == "anon" {
						continue
					}
					who := []string{p.as}
					if p.as == "both" {
						who = []string{"bert", "partner"}
					}
					for _, as := range who {
						r, _ := w.send(p, as)
						if state == "baseline" && r.status != p.status {
							t.Errorf("GET %s as %s: %d %s", p.path, as, r.status, r.body)
						}
						leaks(t, row.route, as, state, p, r)
						seen[as].WriteString(r.body)
					}
				}
				// The owners' own by-id reads count for the positive control.
				for _, p := range row.probes(w) {
					if p.method == "GET" && p.owner != "" {
						r, _ := w.send(p, p.owner)
						leaks(t, row.route, p.owner, state, p, r)
						seen[p.owner].WriteString(r.body)
					}
				}
			}
			if state != "baseline" {
				return
			}
			for who, own := range map[string][]string{"bert": bertSecrets, "partner": partnerSecrets} {
				for _, s := range append(slices.Clone(own), sharedSecrets...) {
					if s == "nieuw@example.com" {
						continue // the invitation shows only in GET /api/users, which Partner may not read
					}
					if !strings.Contains(seen[who].String(), s) {
						t.Errorf("%s never sees %q: the sentinel is dead", who, s)
					}
				}
			}
			if !strings.Contains(seen["bert"].String(), "nieuw@example.com") {
				t.Error("Bert never sees his invitation")
			}
		})
	}
}

// Paging: each user's pages hold exactly the rows of the accounts they hold,
// once; total counts those rows and no other.
func TestPrivacyPagesAndTotals(t *testing.T) {
	w := newWorld(t)
	for _, as := range []string{"bert", "partner"} {
		u := w.user(as)
		want := w.int(`SELECT COUNT(*) FROM transactions t JOIN account_access x ON x.account_id = t.account_id AND x.user_id = ?`, u)
		got := map[int64]bool{}
		path := "/api/transactions?limit=1"
		for range 1000 {
			r, _ := w.send(probe{method: "GET", path: path}, as)
			page := decode[ledger.Page](t, r.body)
			if int64(page.Total) != want {
				t.Fatalf("%s: total %d, holds %d rows", as, page.Total, want)
			}
			for _, x := range page.Items {
				if got[x.ID] || w.int(`SELECT COUNT(*) FROM account_access WHERE account_id = ? AND user_id = ?`, x.AccountID, u) != 1 {
					t.Errorf("%s: row %d of account %d", as, x.ID, x.AccountID)
				}
				got[x.ID] = true
			}
			if page.Next == nil {
				break
			}
			path = "/api/transactions?limit=1&before=" + *page.Next
		}
		if int64(len(got)) != want {
			t.Errorf("%s paged %d rows of %d", as, len(got), want)
		}
		// A search that matches only the other user's rows counts nothing.
		q := map[string]string{"bert": "Partnerbakker", "partner": "Geheimbakker"}[as]
		r, _ := w.send(probe{method: "GET", path: "/api/transactions?q=" + q}, as)
		if page := decode[ledger.Page](t, r.body); page.Total != 0 || len(page.Items) != 0 || page.Next != nil {
			t.Errorf("%s searching %q: %s", as, q, r.body)
		}
	}
}

// Rule 5: the transfer flag is computed from the viewer's own accounts and
// overrides. On the family account Bert's contribution (from his IBAN) is a
// transfer for Bert, not for Partner; Partner's is one for her, not for Bert;
// Bert's override is his alone; and Partner's payment to Bert's IBAN is no
// transfer for her.
func TestTransferIsPerViewer(t *testing.T) {
	w := newWorld(t)
	flags := func(as string) map[string]bool {
		r, _ := w.send(probe{method: "GET", path: "/api/transactions?limit=200"}, as)
		out := map[string]bool{}
		for _, x := range decode[ledger.Page](t, r.body).Items {
			out[x.Counterparty] = x.Transfer
		}
		return out
	}
	bert, partner := flags("bert"), flags("partner")
	for name, want := range map[string][2]bool{
		"Bijdrage van Bert": {true, false},
		"Bijdrage":          {false, true},
		"Supermarkt":        {true, false}, // Bert's override
	} {
		if bert[name] != want[0] || partner[name] != want[1] {
			t.Errorf("%s: transfer for Bert %v, for Partner %v; want %v", name, bert[name], partner[name], want)
		}
	}
	if partner["Overschrijving Bert"] {
		t.Error("Partner's payment to Bert's IBAN is a transfer for her")
	}

	// The opposite-amount rule (b) and the kinds, per viewer: each user has
	// a contribution of their own to the family account without IBANs, and
	// each personal account holds the opposite of a family-account row that
	// only its owner can pair. A match on the other user's personal account
	// is no transfer, and no kind comes from an account the viewer cannot see.
	w.addRow(w.bertAcc, -6161, "2026-11-03", "PV Bert naar gezin", "booked", "EUR", "")
	w.addRow(w.shared, 6161, "2026-11-04", "PV gezin van Bert", "booked", "EUR", "")
	w.addRow(w.partnerAcc, -7171, "2026-11-03", "PV Partner naar gezin", "booked", "EUR", "")
	w.addRow(w.shared, 7171, "2026-11-05", "PV gezin van Partner", "booked", "EUR", "")
	// Family account to a savings account of one user: saved only for its owner.
	w.addRow(w.shared, -8282, "2026-11-06", "PV gezin naar Potje", "booked", "EUR", "")
	w.addRow(w.partnerManual, 8282, "2026-11-06", "PV Potje van gezin", "booked", "EUR", "")
	w.addRow(w.shared, -9292, "2026-11-06", "PV gezin naar Spaarpot", "booked", "EUR", "")
	w.addRow(w.bertManual, 9292, "2026-11-07", "PV Spaarpot van gezin", "booked", "EUR", "")
	for name, want := range map[string][2]string{
		"PV Bert naar gezin":     {"shared", "hidden"},
		"PV gezin van Bert":      {"internal", "-"},
		"PV Partner naar gezin":  {"hidden", "shared"},
		"PV gezin van Partner":   {"-", "internal"},
		"PV gezin naar Potje":    {"-", "saved"},
		"PV Potje van gezin":     {"hidden", "internal"},
		"PV gezin naar Spaarpot": {"saved", "-"},
		"PV Spaarpot van gezin":  {"internal", "hidden"},
	} {
		if b, p := kindOf(w.seen("bert", name)), kindOf(w.seen("partner", name)); b != want[0] || p != want[1] {
			t.Errorf("%s: Bert %s, Partner %s; want %v", name, b, p, want)
		}
	}
}

// A file of Bert's over his current account and the family account is one
// run for him; for Partner it is the family account's batch alone: GET
// /api/imports names no batch of his current account, and the run routes
// take only the batches she can see. A hidden batch is no handle for a run.
func TestImportRunIsPerViewer(t *testing.T) {
	w := newWorld(t)
	type listed struct {
		ID  int64 `json:"id"`
		Run int64 `json:"run"`
	}
	for _, as := range []string{"bert", "partner"} {
		r, _ := w.send(probe{method: "GET", path: "/api/imports"}, as)
		list := decode[[]listed](t, r.body)
		ids := map[int64]bool{}
		for _, b := range list {
			ids[b.ID] = true
		}
		for _, b := range list {
			if !ids[b.Run] {
				t.Errorf("%s: batch %d names run %d, which is not in the list: %s", as, b.ID, b.Run, r.body)
			}
		}
	}
	preview := func(as string, batch int64) response {
		r, _ := w.send(probe{method: "GET", path: "/api/imports/" + id(batch) + "/undo-preview?run=1"}, as)
		return r
	}
	if r := preview("bert", w.sharedRunBatch); r.status != 200 || decode[ledger.UndoPreview](t, r.body).Batches != 2 {
		t.Errorf("Bert's run: %d %s", r.status, r.body)
	}
	if r := preview("partner", w.sharedRunBatch); r.status != 200 || decode[ledger.UndoPreview](t, r.body).Batches != 1 {
		t.Errorf("Partner's run: %d %s", r.status, r.body)
	}
	hiddenRun, missingRun := preview("partner", w.bertRunBatch), preview("partner", 999999)
	if hiddenRun.status != 404 || hiddenRun.body != missingRun.body {
		t.Errorf("Partner with Bert's batch: %d %s", hiddenRun.status, hiddenRun.body)
	}
	// Partner undoes the run as she sees it: the family account's rows go,
	// Bert's current account keeps his.
	r, _ := w.send(probe{method: "POST", path: "/api/imports/" + id(w.sharedRunBatch) + "/undo?run=1"}, "partner")
	if r.status != 200 || !strings.Contains(r.body, `"batches":1`) {
		t.Fatalf("Partner's undo: %d %s", r.status, r.body)
	}
	if w.int(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Runwinkel Prive'`) != 1 ||
		w.int(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Runwinkel Samen'`) != 0 {
		t.Error("Partner's undo reached Bert's current account")
	}
	// Read-only: still 403 for the family account's batch.
	w.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = ? AND user_id = ?`, w.shared, w.partner)
	if r := preview("partner", w.sharedRunBatch); r.status != 403 {
		t.Errorf("read-only: %d %s", r.status, r.body)
	}
}

// Removing another user's link while that link syncs answers 404 at once,
// exactly as a link that does not exist, instead of waiting for the sync
// and answering 503 (which said the link exists and is syncing).
func TestDeleteHiddenConnectionWhileItSyncs(t *testing.T) {
	w := newWorld(t)
	wait := removeWait
	removeWait = 200 * time.Millisecond
	t.Cleanup(func() { removeWait = wait })
	release := make(chan struct{})
	held := make(chan struct{})
	go func() {
		_ = w.e.s.opts.Bank.Exclusive(t.Context(), w.bertConn, func() error {
			close(held)
			<-release
			return nil
		})
	}()
	<-held
	defer close(release)
	hidden, _ := w.send(probe{method: "DELETE", path: "/api/connections/" + id(w.bertConn) + "?history=keep"}, "partner")
	missing, _ := w.send(probe{method: "DELETE", path: "/api/connections/" + none + "?history=keep"}, "partner")
	if hidden.status != 404 || hidden.body != missing.body {
		t.Errorf("Partner removing Bert's syncing link: %d %s; a missing link: %d %s", hidden.status, hidden.body, missing.status, missing.body)
	}
	// The owner still waits for the sync.
	if r, _ := w.send(probe{method: "DELETE", path: "/api/connections/" + id(w.bertConn) + "?history=keep"}, "bert"); r.status != http.StatusServiceUnavailable {
		t.Errorf("Bert during his sync: %d %s", r.status, r.body)
	}
}

// Rule 5 where both users have the same row (counterparty, date, amount):
// suggestions, backfill, the exact and probable duplicates of an import, a
// rule preview, the category counts and a row's rule id are computed from
// the viewer's own accounts only.
func TestMatchingIsPerViewer(t *testing.T) {
	w := newWorld(t)
	const key = "gemeenschappelijke bakker"
	for _, path := range []string{"/api/suggestions", "/api/suggestions/backfill"} {
		if r, _ := w.send(probe{method: "GET", path: path}, "bert"); !strings.Contains(r.body, key) {
			t.Errorf("Bert has no suggestion for his own rows: %s", r.body)
		}
		if r, _ := w.send(probe{method: "GET", path: path}, "partner"); strings.Contains(r.body, key) {
			t.Errorf("Partner's %s learned from Bert's rows: %s", path, r.body)
		}
	}

	// The same file into each user's own account: present only for Bert.
	preview := func(as string, parts ...formPart) previewBody {
		t.Helper()
		r, _ := w.send(probe{method: "POST", path: "/api/imports/preview", form: parts}, as)
		if r.status != 200 {
			t.Fatalf("preview as %s: %d %s", as, r.status, r.body)
		}
		return decode[previewBody](t, r.body)
	}
	csv := func(account int64) []formPart {
		return []formPart{{"file", "gemeen.csv", csvHeader + gemeen}, {"accountId", "", id(account)}, {"mapping", "", csvMapping}}
	}
	if c := preview("bert", csv(w.bertAcc)...).Counts; c == nil || c.Present != 1 {
		t.Errorf("Bert's own file again: %+v", c)
	}
	if c := preview("partner", csv(w.partnerAcc)...).Counts; c == nil || c.Present != 0 || c.New != 1 {
		t.Errorf("Partner's file matched Bert's row: %+v", c)
	}
	bilance := func(account int64) []formPart {
		file := "Titel, Datum, Bedrag, Categorie, Subcategorie, Tag(s), Betalingskenmerk, Handelaar, Rekening(en), Notitie\n" +
			`"Runwinkel Prive", 2026-11-02 00:00:00.000, -17.00€, "", "", , "z", "Runwinkel Prive", "R", ` + "\n"
		return []formPart{{"file", "near.csv", file},
			{"mapping", "", `{"date":1,"amount":2,"counterparty":7,"communication":6,"accountName":8,"counterpartyFallback":0}`},
			{"accountMap", "", `{"R":` + id(account) + `}`}}
	}
	if p := preview("bert", bilance(w.bertAcc)...); p.Counts == nil || p.Duplicates == nil || p.Counts.Present+p.Duplicates.Total == 0 {
		t.Errorf("Bert's Bilance row again: %+v %+v", p.Counts, p.Duplicates)
	}
	if p := preview("partner", bilance(w.partnerAcc)...); p.Counts == nil || p.Duplicates == nil || p.Counts.Present != 0 || p.Duplicates.Total != 0 || p.Counts.New != 1 {
		t.Errorf("Partner's Bilance row matched Bert's: %+v %+v", p.Counts, p.Duplicates)
	}

	// A user rule's preview counts the viewer's own personal rows only.
	for as, u := range map[string]int64{"bert": w.bert, "partner": w.partner} {
		r, _ := w.send(probe{method: "POST", path: "/api/rules/preview", body: `{"counterparty":"Gemeenschappelijke Bakker"}`}, as)
		want := w.int(`SELECT COUNT(*) FROM transactions t JOIN account_access x ON x.account_id = t.account_id AND x.user_id = ?
			WHERE t.counterparty_name = 'Gemeenschappelijke Bakker'`, u)
		if got := decode[ledger.RulePreview](t, r.body); int64(got.Matches) != want || want == 0 {
			t.Errorf("%s's preview: %+v, holds %d such rows", as, got, want)
		}
	}

	// Category counts: the viewer's rows, per category.
	for as, u := range map[string]int64{"bert": w.bert, "partner": w.partner} {
		r, _ := w.send(probe{method: "GET", path: "/api/categories"}, as)
		for _, c := range decode[[]ledger.TreeCategory](t, r.body) {
			want := w.int(`SELECT COUNT(*) FROM transactions t JOIN account_access x ON x.account_id = t.account_id AND x.user_id = ?1
				WHERE (t.category_id = ?2 AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id))
				   OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id AND s.category_id = ?2)`, u, c.ID)
			if int64(c.Count) != want {
				t.Errorf("%s: category %d counts %d, holds %d", as, c.ID, c.Count, want)
			}
		}
	}

	// The shared row categorised by Bert's user rule: his rule id, never Partner's to see.
	ruleOf := func(as string) *int64 {
		r, _ := w.send(probe{method: "GET", path: "/api/transactions?q=Bijdrage&limit=200"}, as)
		for _, x := range decode[ledger.Page](t, r.body).Items {
			if x.Counterparty == "Bijdrage" {
				return x.RuleID
			}
		}
		t.Fatalf("%s does not see the row", as)
		return nil
	}
	if got := ruleOf("bert"); got == nil || *got != w.bertRule {
		t.Errorf("Bert's rule id on the shared row: %v", got)
	}
	if got := ruleOf("partner"); got != nil {
		t.Errorf("Partner sees Bert's user rule %d", *got)
	}

	// Transfer matching (rule b): the same family-account row has an
	// opposite amount on each user's personal account, so it is a transfer
	// for both, each paired with their own account (a personal source, so
	// "internal"); a family-account row whose opposite is only on Partner's
	// personal account is none for Bert, and the reverse.
	w.addRow(w.shared, 5353, "2026-11-10", "MV gezin in", "booked", "EUR", "")
	w.addRow(w.bertAcc, -5353, "2026-11-09", "MV Bert uit", "booked", "EUR", "")
	w.addRow(w.partnerAcc, -5353, "2026-11-11", "MV Partner uit", "booked", "EUR", "")
	w.addRow(w.shared, 5454, "2026-11-10", "MV alleen Partner", "booked", "EUR", "")
	w.addRow(w.partnerAcc, -5454, "2026-11-10", "MV Partner 5454", "booked", "EUR", "")
	w.addRow(w.shared, 5656, "2026-11-10", "MV alleen Bert", "booked", "EUR", "")
	w.addRow(w.bertAcc, -5656, "2026-11-10", "MV Bert 5656", "booked", "EUR", "")
	for name, want := range map[string][2]string{
		"MV gezin in":       {"internal", "internal"},
		"MV alleen Partner": {"-", "internal"},
		"MV alleen Bert":    {"internal", "-"},
	} {
		if b, p := kindOf(w.seen("bert", name)), kindOf(w.seen("partner", name)); b != want[0] || p != want[1] {
			t.Errorf("%s: Bert %s, Partner %s; want %v", name, b, p, want)
		}
	}
	// The uncategorised count follows each viewer's own flags.
	for as, u := range map[string]int64{"bert": w.bert, "partner": w.partner} {
		r, _ := w.send(probe{method: "GET", path: "/api/transactions?uncategorised=1&limit=200&q=MV%20alleen"}, as)
		got := map[string]bool{}
		for _, x := range decode[ledger.Page](t, r.body).Items {
			got[x.Counterparty] = true
		}
		want := map[int64]string{w.bert: "MV alleen Partner", w.partner: "MV alleen Bert"}[u]
		if len(got) != 1 || !got[want] {
			t.Errorf("%s's uncategorised MV rows: %v", as, got)
		}
	}
}

// Partner's own objects on the family account (an import and a rule) are
// hers only while she is a member: after she leaves, their ids answer as
// missing ones and her reads hold nothing of them; Bert keeps them.
func TestLeaverLosesHerSharedObjects(t *testing.T) {
	w := newWorld(t)
	batch := w.importFile(w.partner, "partner-gedeeld.csv", csvHeader+"12/11/2026;12/11/2026;-3,30;Gedeelde Slager;;Vlees\n", w.shared).Batches[0].ID
	rule := w.rule(w.partner, `{"accountId":`+id(w.shared)+`,"counterparty":"Partnerregel Gedeeld","categoryId":2}`)
	w.ok(w.partner, "POST", "/api/accounts/"+id(w.shared)+"/leave", "", 200)
	for _, path := range []string{"/api/imports", "/api/rules", "/api/transactions?limit=200", "/api/transactions?q=Slager"} {
		r, _ := w.send(probe{method: "GET", path: path}, "partner")
		for _, s := range []string{"partner-gedeeld.csv", "Partnerregel Gedeeld", "Gedeelde Slager"} {
			if strings.Contains(r.body, s) {
				t.Errorf("after leaving, %s shows Partner %q", path, s)
			}
		}
		if r, _ := w.send(probe{method: "GET", path: path}, "bert"); path != "/api/transactions?q=Slager" && path != "/api/transactions?limit=200" &&
			!strings.Contains(r.body, "partner-gedeeld.csv") && !strings.Contains(r.body, "Partnerregel Gedeeld") {
			t.Errorf("Bert lost the family account's %s: %s", path, r.body)
		}
	}
	for _, c := range []struct{ method, path, missing, body string }{
		{"GET", "/api/imports/" + id(batch) + "/undo-preview", "/api/imports/" + none + "/undo-preview", ""},
		{"GET", "/api/imports/" + id(batch) + "/undo-preview?run=1", "/api/imports/" + none + "/undo-preview?run=1", ""},
		{"POST", "/api/imports/" + id(batch) + "/undo?run=1", "/api/imports/" + none + "/undo?run=1", ""},
		{"POST", "/api/imports/" + id(batch) + "/reapply-categories", "/api/imports/" + none + "/reapply-categories", ""},
		{"PATCH", rulePath(rule, ""), rulePath(999999, ""), `{"priority":2}`},
		{"POST", rulePath(rule, "/apply"), rulePath(999999, "/apply"), ""},
		{"DELETE", rulePath(rule, ""), rulePath(999999, ""), ""},
	} {
		w.run(t, "", probe{as: "partner", method: c.method, path: c.path, body: c.body, status: 404, owner: "bert", pattern: "-",
			missing: &probe{as: "partner", method: c.method, path: c.missing, body: c.body, status: 404}})
	}
}

// Reports (0.7-1) sum the viewer's own accounts only: rows added to Partner's
// accounts (a big income, a contribution-sized transfer on the day of Bert's
// own, a row older than anything of Bert's, a transfer into her savings
// account) change none of Bert's reports, byte for byte, but do change hers.
func TestReportIsPerViewer(t *testing.T) {
	w := newWorld(t)
	queries := func(as string) []string {
		own := map[string]int64{"bert": w.bertAcc, "partner": w.partnerAcc}[as]
		return []string{"", "?scope=alles", "?scope=persoonlijk", "?scope=gedeeld", "?account=" + id(own), "?account=" + id(w.shared), "?from=2020-01"}
	}
	reports := func(as string) []string {
		out := []string{}
		for _, q := range queries(as) {
			r, _ := w.send(probe{method: "GET", path: "/api/reports/months" + q}, as)
			if r.status != http.StatusOK {
				t.Fatalf("%s %s: %d %s", as, q, r.status, r.body)
			}
			out = append(out, r.body)
		}
		return out
	}
	bert, partner := reports("bert"), reports("partner")

	w.addRow(w.partnerAcc, 9999900, "2026-11-10", "PR groot loon", "booked", "EUR", "")
	w.addRow(w.partnerAcc, -45000, "2026-11-13", "PR bijdrage", "booked", "EUR", "")
	w.addRow(w.partnerAcc, -1234, "2020-01-05", "PR heel oud", "booked", "EUR", "")
	w.addRow(w.partnerAcc, -8100, "2026-11-12", "PR naar potje", "booked", "EUR", "")
	w.addRow(w.partnerManual, 8100, "2026-11-12", "PR van rekening", "booked", "EUR", "")

	if after := reports("bert"); !slices.Equal(after, bert) {
		for i := range after {
			if after[i] != bert[i] {
				t.Errorf("Bert's report %q changed with Partner's rows:\nbefore %s\nafter  %s", queries("bert")[i], bert[i], after[i])
			}
		}
	}
	if after := reports("partner"); slices.Equal(after, partner) {
		t.Error("Partner's own report did not change with her own rows: the test proves nothing")
	}
}

// The category of a recurring item (0.9.1-3) is account-level: both members of the family account read the same
// suggestedCategoryId (from the account's payments, not from a viewer's rows) and the stored category, no IBAN shows,
// and a member on Lezen cannot set a category.
func TestPlanningItemCategoryIsAccountLevel(t *testing.T) {
	w := newWorld(t)
	// The family account's item "Gezinsabonnement" (-1100, Partner's IBAN) matches a booked row that carries Boodschappen.
	row := w.addRow(w.shared, -1100, "2026-11-09", "Gezinsabonnement", "booked", "EUR", ibanPartner)
	w.exec(`UPDATE transactions SET category_id = 2 WHERE id = ?`, row)
	type listed struct {
		ID                  int64
		Description         string
		CategoryID          *int64
		SuggestedCategoryID *int64
	}
	const list = "/api/planning/items?scope=gedeeld"
	item := func(as string) (listed, string) {
		t.Helper()
		r, _ := w.send(read(list, 200), as)
		for _, it := range decode[map[string][]listed](t, r.body)["items"] {
			if it.Description == "Gezinsabonnement" {
				return it, r.body
			}
		}
		t.Fatalf("%s: no Gezinsabonnement in %s", as, r.body)
		return listed{}, ""
	}
	bert, bertBody := item("bert")
	partner, partnerBody := item("partner")
	if bert.SuggestedCategoryID == nil || *bert.SuggestedCategoryID != 2 || bertBody != partnerBody {
		t.Errorf("the suggestion differs between members: %s | %s", bertBody, partnerBody)
	}
	for _, iban := range neverShown {
		if strings.Contains(bertBody, iban) {
			t.Errorf("the list shows %s", iban)
		}
	}

	// Lezen: reads stay open (the suggestion too), the write is 403; Bewerken writes it and both members see it.
	path := "/api/planning/items/" + id(partner.ID)
	w.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = ? AND user_id = ?`, w.shared, w.partner)
	if r, _ := w.send(probe{method: "PATCH", path: path, body: `{"categoryId":2}`}, "partner"); r.status != http.StatusForbidden {
		t.Errorf("Lezen sets a category: %d %s", r.status, r.body)
	}
	if got, _ := item("partner"); got.CategoryID != nil || got.SuggestedCategoryID == nil {
		t.Errorf("Partner on Lezen reads %+v", got)
	}
	w.ok(w.bert, "PATCH", path, `{"categoryId":2}`, 200)
	if got, _ := item("partner"); got.CategoryID == nil || *got.CategoryID != 2 {
		t.Errorf("Partner does not see the category Bert set: %+v", got)
	}
}

// Before accepting, an invitee learns the account's name and the inviter's
// name (the alert) and nothing else: every account answer is as if the
// account did not exist (plan 0.8-0b, Tests, Privacy). The invitation routes
// have their own rows in privacyRows.
func TestPrivacyInviteeBeforeAccepting(t *testing.T) {
	w := newWorld(t)
	pot := decode[ledger.Account](t, w.ok(w.bert, "POST", "/api/accounts",
		`{"name":"Vakantiepot","type":"current","iban":"BE95 0000 0000 5858","balance":424242}`, 201).body).ID
	if a := decode[ledger.Account](t, w.ok(w.bert, "PATCH", "/api/accounts/"+id(pot), `{"shared":true}`, 200).body); a.Kind != "shared" {
		t.Fatalf("kind after the switch: %q", a.Kind)
	}
	w.exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key) VALUES (?, -3131, '2026-11-12', 'Potgeheim', 'booked', 'pot-1')`, pot)
	inv := w.int(`INSERT INTO account_invitations (account_id, user_id, invited_by, created_at) VALUES (?, ?, ?, ?) RETURNING id`,
		pot, w.partner, w.bert, w.e.now.UTC().Format(time.RFC3339))
	secrets := []string{"Vakantiepot", "5858", "Potgeheim", "3131", "424242"}

	// The positive control: Bert sees them all.
	var bert strings.Builder
	for _, p := range []string{"/api/accounts", "/api/transactions?scope=gedeeld", "/api/reports/months?scope=gedeeld"} {
		bert.WriteString(w.ok(w.bert, "GET", p, "", 200).body)
	}
	for _, s := range secrets {
		if !strings.Contains(bert.String(), s) {
			t.Errorf("Bert never sees %q", s)
		}
	}
	for _, p := range []string{"/api/accounts", "/api/transactions", "/api/transactions?scope=gedeeld",
		"/api/reports/months", "/api/reports/months?scope=gedeeld", "/api/reports/months?scope=persoonlijk"} {
		body := w.ok(w.partner, "GET", p, "", 200).body
		for _, s := range secrets {
			if strings.Contains(body, s) {
				t.Errorf("invitee's %s shows %q", p, s)
			}
		}
	}
	for _, sub := range []string{"/transfers", "/contributions", "/invitable"} {
		got, missing := w.e.as(w.partner, "GET", "/api/accounts/"+id(pot)+sub, ""), w.e.as(w.partner, "GET", "/api/accounts/"+none+sub, "")
		if got.status != http.StatusNotFound || got.body != missing.body {
			t.Errorf("invitee reads %s: %d %s", sub, got.status, got.body)
		}
	}
	alerts := decode[[]ledger.Alert](t, w.ok(w.partner, "GET", "/api/alerts", "", 200).body)
	i := slices.IndexFunc(alerts, func(a ledger.Alert) bool { return a.Type == "invite" })
	if i < 0 || alerts[i] != (ledger.Alert{Kind: "ok", Type: "invite", Title: "Bert nodigt je uit voor Vakantiepot",
		Note: "Voeg de rekening toe om ze samen te volgen", Href: "/rekeningen?uitnodiging=" + id(inv), InvitationID: inv}) {
		t.Errorf("invite alert: %+v", alerts)
	}
}
