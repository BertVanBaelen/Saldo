package ledger

import (
	"context"
	"database/sql"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/users"
)

// Colours are the eight account colours (analysis/concepts/account.md).
var Colours = []string{"green", "violet", "blue", "teal", "orange", "pink", "yellow", "gray"}

// MaxBuffer is the highest buffer the API accepts (€ 1.000.000).
const MaxBuffer = 100_000_000

// Account is an account as the viewer sees it (docs/api.md).
type Account struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Type        string  `json:"type"`
	Source      string  `json:"source"`
	Kind        string  `json:"kind"`
	IBAN        *string `json:"iban"`
	Colour      string  `json:"colour"`
	Buffer      int64   `json:"buffer"`
	Balance     int64   `json:"balance"`
	BalanceDate *string `json:"balanceDate"`
	State       *string `json:"state"`
	Bank        *string `json:"bank"`
	LastSync    *string `json:"lastSync"`
	SyncStatus  *string `json:"syncStatus"`
	// SyncError is the error code of the failed source while syncStatus is
	// "failed" (for example "not_shared" or a provider code), else nil.
	SyncError *string `json:"syncError"`
	// LastAttempt is the last sync attempt of any of its sources, nil when
	// none was made.
	LastAttempt *string `json:"lastAttempt"`
	// SyncReport is what the last successful sync of a bank account asked for
	// and got; nil for other accounts and before the first successful sync.
	SyncReport *SyncReport `json:"syncReport"`
	Permission string      `json:"permission"`
	Role       string      `json:"role"`
	Members    []Member    `json:"members"`
	// ConvertibleRules is, for the manager of a shared account, the number of
	// their user rules that no longer apply to it and have no equal account
	// rule yet (POST /api/accounts/{id}/convert-rules); 0 for everyone else.
	ConvertibleRules int `json:"convertibleRules"`
	// SourceRole is the role of the viewer's own link on this bank account:
	// "primary", "reserve" (a fallback) or nil without a link (0.6-1d).
	SourceRole *string `json:"sourceRole"`
	// CarriedBy is whose link carries (fetches) the account now, nil when no
	// link can (manual, unlinked, or no usable source).
	CarriedBy *CarriedBy `json:"carriedBy"`
	// ViaReserve is true while a fallback carries the account.
	ViaReserve bool `json:"viaReserve"`
	// Invitations are the open invitations of the account, for its manager
	// only (0.8-0b); [] for everyone else.
	Invitations []Invitation `json:"invitations"`

	sources []int64 // connections whose failure explains this account's state
}

// CarriedBy names the owner of the link that carries an account.
type CarriedBy struct {
	Name string `json:"name"`
	Me   bool   `json:"me"`
}

// SyncReport tells a silent sync from a broken one: "fetched 0" is the bank's
// side, "fetched 20, added 0" is storing or dedupe, and an IDTail that is the
// other account's means the wrong account was fetched.
type SyncReport struct {
	At          string  `json:"at"`
	From        *string `json:"from"` // the date asked, nil for the longest history
	Fetched     int     `json:"fetched"`
	Added       int     `json:"added"`
	Newest      *string `json:"newest"` // newest booking date returned, nil without rows
	BalanceDate *string `json:"balanceDate"`
	IDTail      string  `json:"idTail"` // last 4 characters of the provider account id
}

// Member is one member of a shared account.
type Member struct {
	UserID     int64  `json:"userId"`
	Name       string `json:"name"`
	Initial    string `json:"initial"`
	Role       string `json:"role"`
	Permission string `json:"permission"`
	Me         bool   `json:"me"`
	JoinedAt   string `json:"joinedAt"`
}

// State is the verdict for one current account's balance against its own
// buffer: "ok", "buffer" or "neg". Other account types have no state (nil).
func State(accountType string, balance, buffer int64) *string {
	if accountType != "current" {
		return nil
	}
	switch {
	case balance < 0:
		return ptr("neg")
	case balance < buffer:
		return ptr("buffer")
	}
	return ptr("ok")
}

// IsShared is the one rule for personal or shared (0.8-0b): the manager
// declared the account shared (accounts.shared) or it has more than one
// member. The SQL twin is the shared column of visibleTx's vis.
func IsShared(flag bool, members int) bool {
	return flag || members > 1
}

// SyncUnlinked is the syncStatus of a bank account that no link feeds any more.
const SyncUnlinked = "unlinked"

// Accounts returns every account the viewer can see, oldest first.
func (s *Store) Accounts(ctx context.Context, viewer int64, now time.Time) ([]Account, error) {
	return s.accounts(ctx, viewer, 0, now)
}

// Account returns one account the viewer can see, or apperr.ErrNotFound.
func (s *Store) Account(ctx context.Context, viewer, id int64, now time.Time) (Account, error) {
	list, err := s.accounts(ctx, viewer, id, now)
	if err != nil {
		return Account{}, err
	}
	if len(list) == 0 {
		return Account{}, apperr.ErrNotFound
	}
	return list[0], nil
}

// accounts loads the viewer's accounts; only is an account id or 0 for all.
func (s *Store) accounts(ctx context.Context, viewer, only int64, now time.Time) ([]Account, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.id, a.name, a.type, a.source, COALESCE(a.iban, ''), a.colour, a.buffer,
		       COALESCE(a.bank_name, ''), me.role, me.permission, a.shared = 1,
		       (SELECT COUNT(*) FROM account_access m WHERE m.account_id = a.id),
		       bs.balance, bs.date
		FROM account_access me
		JOIN accounts a ON a.id = me.account_id
		LEFT JOIN balance_snapshots bs ON bs.id = (
		    SELECT s.id FROM balance_snapshots s WHERE s.account_id = a.id
		    ORDER BY s.date DESC, s.id DESC LIMIT 1)
		WHERE me.user_id = ? AND (? = 0 OR a.id = ?)
		ORDER BY a.id`, viewer, only, only)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []Account{}
	index := map[int64]int{}
	for rows.Next() {
		var a Account
		var iban, bankName string
		var members int
		var flag bool
		var balance sql.NullInt64
		var balanceDate sql.NullString
		if err := rows.Scan(&a.ID, &a.Name, &a.Type, &a.Source, &iban, &a.Colour, &a.Buffer,
			&bankName, &a.Role, &a.Permission, &flag, &members, &balance, &balanceDate); err != nil {
			return nil, err
		}
		if m := MaskIBAN(iban); m != "" {
			a.IBAN = &m
		}
		a.Kind = "personal"
		if IsShared(flag, members) {
			a.Kind = "shared"
		}
		if a.Type != "current" {
			a.Buffer = 0
		}
		a.Balance = balance.Int64
		if balanceDate.Valid {
			a.BalanceDate = &balanceDate.String
		}
		a.State = State(a.Type, a.Balance, a.Buffer)
		if a.Source == "bank" && bankName != "" {
			a.Bank = &bankName
		}
		a.Members = []Member{}
		a.Invitations = []Invitation{}
		index[a.ID] = len(list)
		list = append(list, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	if len(list) == 0 {
		return list, nil
	}
	if err := s.loadMembers(ctx, viewer, list, index); err != nil {
		return nil, err
	}
	if err := s.loadSync(ctx, viewer, list, index, now); err != nil {
		return nil, err
	}
	if err := s.loadConvertible(ctx, viewer, list, index); err != nil {
		return nil, err
	}
	if err := s.loadInvitations(ctx, viewer, list, index, now); err != nil {
		return nil, err
	}
	return list, nil
}

func (s *Store) loadMembers(ctx context.Context, viewer int64, list []Account, index map[int64]int) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT x.account_id, u.id, u.display_name, x.role, x.permission, x.joined_at
		FROM account_access x
		JOIN users u ON u.id = x.user_id
		WHERE x.account_id IN (SELECT account_id FROM account_access WHERE user_id = ?)
		ORDER BY x.account_id, x.joined_at, u.id`, viewer)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var accountID int64
		var m Member
		var joined string
		if err := rows.Scan(&accountID, &m.UserID, &m.Name, &m.Role, &m.Permission, &joined); err != nil {
			return err
		}
		i, ok := index[accountID]
		if !ok || list[i].Kind != "shared" {
			continue
		}
		m.Initial = users.Initial(m.Name)
		m.Me = m.UserID == viewer
		m.JoinedAt, _, _ = formatTimestamp(joined)
		list[i].Members = append(list[i].Members, m)
	}
	return rows.Err()
}

type source struct {
	connection int64
	primary    bool
	usable     bool // source and consent are fine
	lastSync   time.Time
	hasSync    bool
	failed     string    // the source's error code while its status is failed
	attempt    time.Time // its last attempt
	report     *SyncReport

	// For the carrier (0.6-1d).
	status     string // ok or failed
	lastError  string
	live       bool   // the connection is active
	validUntil string // the consent's end
	shared     bool   // the current consent lists the account (a provider id)
	owner      int64  // the connection's user
	ownerName  string
	joined     string // when the owner joined the account ("" when unknown)
}

// sourceSelect reads account_sources rows with what the view and the carrier
// need; scanSource reads one. A caller adds the WHERE and ORDER BY.
const sourceSelect = `
	SELECT s.account_id, s.connection_id, s.priority, s.status, COALESCE(s.last_sync_at, ''),
	       c.status, COALESCE(c.valid_until, ''), COALESCE(s.last_error, ''), COALESCE(s.last_attempt_at, ''),
	       s.last_fetched, COALESCE(s.last_added, 0), COALESCE(s.last_from, ''), COALESCE(s.last_newest, ''),
	       COALESCE(s.last_balance_date, ''), COALESCE(s.last_external_tail, ''),
	       s.external_account_id IS NOT NULL, c.status = 'active',
	       c.user_id, u.display_name, COALESCE(x.joined_at, '')
	FROM account_sources s
	JOIN provider_connections c ON c.id = s.connection_id
	JOIN users u ON u.id = c.user_id
	LEFT JOIN account_access x ON x.account_id = s.account_id AND x.user_id = c.user_id`

func scanSource(rows *sql.Rows, now time.Time) (int64, source, error) {
	var accountID int64
	var src source
	var priority, lastSync, connStatus, lastAttempt string
	var fetched sql.NullInt64
	var added int
	var from, newest, balanceDate, tail string
	if err := rows.Scan(&accountID, &src.connection, &priority, &src.status, &lastSync, &connStatus, &src.validUntil, &src.lastError, &lastAttempt,
		&fetched, &added, &from, &newest, &balanceDate, &tail,
		&src.shared, &src.live, &src.owner, &src.ownerName, &src.joined); err != nil {
		return 0, src, err
	}
	src.primary = priority == "primary"
	src.usable = src.status == "ok" && connStatus == "active" && !consentLapsed(src.validUntil, now)
	if t, err := time.Parse(time.RFC3339, lastSync); err == nil {
		src.lastSync, src.hasSync = t, true
	}
	if src.status == "failed" {
		src.failed = src.lastError
	}
	if t, err := time.Parse(time.RFC3339, lastAttempt); err == nil {
		src.attempt = t
	}
	if at, _, ok := formatTimestamp(lastSync); ok && fetched.Valid {
		src.report = &SyncReport{At: at, From: ptrIfSet(from), Fetched: int(fetched.Int64), Added: added,
			Newest: ptrIfSet(newest), BalanceDate: ptrIfSet(balanceDate), IDTail: tail}
	}
	return accountID, src, nil
}

// Carrier returns the connection that fetches the account in a sync at now
// (0 when none can) and whether the account has more than one source. The
// sync calls it per account before fetching, on the state stored before.
func Carrier(ctx context.Context, db *sql.DB, account int64, now time.Time) (connection int64, multi bool, err error) {
	rows, err := db.QueryContext(ctx, sourceSelect+` WHERE s.account_id = ? ORDER BY s.connection_id`, account)
	if err != nil {
		return 0, false, err
	}
	defer rows.Close()
	var srcs []source
	for rows.Next() {
		_, src, err := scanSource(rows, now)
		if err != nil {
			return 0, false, err
		}
		srcs = append(srcs, src)
	}
	if err := rows.Err(); err != nil {
		return 0, false, err
	}
	if c := carrier(srcs, now, true); c != nil {
		connection = c.connection
	}
	return connection, len(srcs) > 1, nil
}

// carrier is the one source that fetches an account (plan 0.6-1d): the
// primary, unless it is stopped and a fallback can take over; then the oldest
// usable fallback (its owner joined first, then the lowest connection id, as
// promotePrimary). Without such a fallback the primary carries even when
// stopped, so a one-link account syncs exactly as before. run is true in a
// sync at now, false for the view.
func carrier(srcs []source, now time.Time, run bool) *source {
	var primary, reserve *source
	for i := range srcs {
		src := &srcs[i]
		switch {
		case src.primary:
			primary = src
		case src.canCarry(now, run) && (reserve == nil || src.before(reserve)):
			reserve = src
		}
	}
	if primary != nil && (reserve == nil || !primary.stopped(now, run)) {
		return primary
	}
	return reserve
}

// attemptedIn reports an attempt made by the sync at now (its timestamp has
// whole seconds). Such a source was a carrier of that sync: what it wrote
// must not change the choice for a connection that syncs after it.
func (src *source) attemptedIn(now time.Time) bool {
	return !src.attempt.IsZero() && !src.attempt.Before(now.Truncate(time.Second))
}

// canCarry: a fallback can take over when the current consent lists the
// account and its connection is usable. Its own row's status does not count:
// an idle fallback is never fetched, so nothing would clear it.
func (src *source) canCarry(now time.Time, run bool) bool {
	return src.shared && (src.live && !consentLapsed(src.validUntil, now) || run && src.attemptedIn(now))
}

// before orders fallbacks: the owner who joined first, then the connection.
func (src *source) before(o *source) bool {
	if (src.joined == "") != (o.joined == "") {
		return o.joined == ""
	}
	if src.joined != o.joined {
		return src.joined < o.joined
	}
	return src.connection < o.connection
}

// stopped decides, on stored state only, that the primary cannot carry: its
// connection is not active, its consent lapsed, the current consent does not
// list the account (not_shared), or it has been failing for longer than
// StaleAfter (the account's stale threshold, so a
// fallback steps in once the account would read stale; "failing" because a
// primary that was not tried, after a downtime say, is not broken). In a
// sync, a stopped-by-failures primary is tried again once its last attempt
// is older than StaleAfter: nothing else would ever bring it back.
func (src *source) stopped(now time.Time, run bool) bool {
	// Not listed by the consent: only a new consent changes that, never a
	// sync (which marks the row not_shared, an "attempt").
	if !src.shared {
		return true
	}
	if run && src.attemptedIn(now) {
		return false
	}
	if !src.live || consentLapsed(src.validUntil, now) {
		return true
	}
	// not_shared and session_expired were the consent's fault: a live
	// connection whose consent lists the account has a new one.
	failing := src.status == "failed" && src.lastError != "not_shared" && src.lastError != "session_expired"
	if !failing || src.hasSync && now.Sub(src.lastSync) <= StaleAfter {
		return false
	}
	return !run || now.Sub(src.attempt) <= StaleAfter
}

// loadSync sets lastSync and syncStatus of bank accounts. An account with one
// source follows it; an account with more follows its carrier (0.6-1d), so an
// idle fallback never makes it stale or failed.
func (s *Store) loadSync(ctx context.Context, viewer int64, list []Account, index map[int64]int, now time.Time) error {
	rows, err := s.db.QueryContext(ctx, sourceSelect+`
		WHERE s.account_id IN (SELECT account_id FROM account_access WHERE user_id = ?)
		ORDER BY s.account_id, s.priority DESC, s.connection_id`, viewer)
	if err != nil {
		return err
	}
	defer rows.Close()
	byAccount := map[int64][]source{}
	for rows.Next() {
		accountID, src, err := scanSource(rows, now)
		if err != nil {
			return err
		}
		byAccount[accountID] = append(byAccount[accountID], src)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i := range list {
		a := &list[i]
		if a.Source != "bank" {
			continue
		}
		srcs := byAccount[a.ID]
		if len(srcs) == 0 {
			// Its link was removed with "keep history": nothing syncs it
			// until it is linked again.
			a.SyncStatus = ptr(SyncUnlinked)
			continue
		}
		for _, src := range srcs {
			if src.owner == viewer {
				a.SourceRole = ptr("primary")
				if !src.primary {
					a.SourceRole = ptr("reserve")
				}
			}
		}
		pick := carrier(srcs, now, false)
		if pick != nil {
			a.CarriedBy = &CarriedBy{Name: pick.ownerName, Me: pick.owner == viewer}
			a.ViaReserve = !pick.primary
		}
		// The state, error and report are the carrier's: an idle or broken
		// fallback says nothing about the account.
		view := srcs
		if len(srcs) > 1 && pick != nil {
			view = []source{*pick}
		}
		for _, src := range view {
			a.sources = append(a.sources, src.connection)
		}
		status, last := syncState(view, now)
		a.SyncStatus = &status
		if !last.IsZero() {
			ts, _, _ := formatTimestamp(last.UTC().Format(time.RFC3339))
			a.LastSync = &ts
		}
		var attempt, reported time.Time
		for _, src := range srcs {
			if src.attempt.After(attempt) {
				attempt = src.attempt
			}
		}
		for _, src := range view {
			// Only the viewer's own link's error code: never another
			// member's.
			if status == "failed" && a.SyncError == nil && src.failed != "" && src.owner == viewer {
				a.SyncError = ptr(src.failed)
			}
			// The report of the source that synced most recently.
			if src.report != nil && (a.SyncReport == nil || src.lastSync.After(reported)) {
				a.SyncReport, reported = src.report, src.lastSync
			}
		}
		if !attempt.IsZero() {
			ts, _, _ := formatTimestamp(attempt.UTC().Format(time.RFC3339))
			a.LastAttempt = &ts
		}
	}
	return nil
}

// syncState picks the effective source and returns the account's sync status
// ("ok", "stale" or "failed") and its last successful sync (zero if none).
func syncState(srcs []source, now time.Time) (string, time.Time) {
	var pick *source
	for i := range srcs {
		src := &srcs[i]
		if !src.usable {
			continue
		}
		if src.primary {
			pick = src
			break
		}
		if pick == nil || src.lastSync.After(pick.lastSync) {
			pick = src
		}
	}
	if pick == nil {
		var last time.Time
		for _, src := range srcs {
			if src.lastSync.After(last) {
				last = src.lastSync
			}
		}
		if len(srcs) == 0 {
			return "stale", last
		}
		return "failed", last
	}
	if !pick.hasSync || now.Sub(pick.lastSync) > StaleAfter {
		return "stale", pick.lastSync
	}
	return "ok", pick.lastSync
}

// consentLapsed reports whether a consent's valid_until lies in the past.
func consentLapsed(validUntil string, now time.Time) bool {
	t, err := time.Parse(time.RFC3339, validUntil)
	return err == nil && !now.Before(t)
}

// AccountPatch holds the fields PATCH /api/accounts/{id} may change; nil
// fields stay as they are.
type AccountPatch struct {
	Name   *string `json:"name"`
	Colour *string `json:"colour"`
	Buffer *int64  `json:"buffer"`
	// IBAN of a manual account ("" removes it); only to recognise transfers.
	IBAN *string `json:"iban"`
	// Shared declares the account shared (0.8-0b). Switching it off is
	// refused while another member or an open invitation exists.
	Shared *bool `json:"shared"`
}

// UpdateAccount applies a patch for the account's manager and returns the
// updated account. Hidden accounts answer apperr.ErrNotFound, read-only ones
// apperr.ErrForbidden, other members ErrNotManager.
func (s *Store) UpdateAccount(ctx context.Context, viewer, id int64, p AccountPatch, now time.Time) (Account, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback()

	a, err := accessOf(ctx, tx, viewer, id)
	if err != nil {
		return Account{}, err
	}
	if err := a.edit(); err != nil {
		return Account{}, err
	}
	// The account itself is the manager's (the single member of a personal account is its manager).
	if err := a.manage(); err != nil {
		return Account{}, err
	}

	if p.Name == nil && p.Colour == nil && p.Buffer == nil && p.IBAN == nil && p.Shared == nil {
		return Account{}, apperr.Invalid("Geef een naam, een kleur of een buffer op.")
	}
	var name *string
	if p.Name != nil {
		n, err := validName(*p.Name)
		if err != nil {
			return Account{}, err
		}
		name = &n
	}
	if p.Colour != nil && !slices.Contains(Colours, *p.Colour) {
		return Account{}, apperr.Invalid("Kies een van de acht rekeningkleuren.")
	}
	if p.Buffer != nil {
		if err := validBuffer(a.typ, *p.Buffer); err != nil {
			return Account{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE accounts SET name = COALESCE(?, name), colour = COALESCE(?, colour), buffer = COALESCE(?, buffer)
		WHERE id = ?`, name, p.Colour, p.Buffer, id); err != nil {
		return Account{}, err
	}
	if p.IBAN != nil {
		// A bank account's IBAN is its identity at the bank (analysis 6.3).
		if a.source != "manual" {
			return Account{}, apperr.Invalid("Het IBAN van een bankrekening komt van de bank.")
		}
		iban, err := manualIBAN(p.IBAN)
		if err != nil {
			return Account{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE accounts SET iban = ? WHERE id = ?`, iban, id); err != nil {
			return Account{}, err
		}
	}
	if p.Shared != nil {
		if err := setShared(ctx, tx, a, id, *p.Shared, now); err != nil {
			return Account{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Account{}, err
	}
	return s.Account(ctx, viewer, id, now)
}

func validName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if n := utf8.RuneCountInString(name); n < 1 || n > 40 {
		return "", apperr.Invalid("De naam moet tussen 1 en 40 tekens lang zijn.")
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return "", apperr.Invalid("De naam mag geen regeleinden of tabs bevatten.")
		}
	}
	return name, nil
}

func validBuffer(accountType string, buffer int64) error {
	switch {
	case accountType != "current" && buffer != 0:
		return apperr.Invalid("Alleen een zichtrekening heeft een buffer.")
	case buffer < 0:
		return apperr.Invalid("De buffer kan niet negatief zijn.")
	case buffer%100 != 0:
		return apperr.Invalid("De buffer is een bedrag in hele euro.")
	case buffer > MaxBuffer:
		return apperr.Invalid("De buffer kan hoogstens € 1.000.000 zijn.")
	}
	return nil
}
