package ledger

import (
	"context"
	"database/sql"
	"errors"
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
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Source      string   `json:"source"`
	Kind        string   `json:"kind"`
	IBAN        *string  `json:"iban"`
	Colour      string   `json:"colour"`
	Buffer      int64    `json:"buffer"`
	Balance     int64    `json:"balance"`
	BalanceDate *string  `json:"balanceDate"`
	State       *string  `json:"state"`
	Bank        *string  `json:"bank"`
	LastSync    *string  `json:"lastSync"`
	SyncStatus  *string  `json:"syncStatus"`
	Permission  string   `json:"permission"`
	Role        string   `json:"role"`
	Members     []Member `json:"members"`

	sources []int64 // connections that feed this account
}

// Member is one member of a shared account.
type Member struct {
	Name       string `json:"name"`
	Initial    string `json:"initial"`
	Role       string `json:"role"`
	Permission string `json:"permission"`
	Me         bool   `json:"me"`
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
		       COALESCE(a.bank_name, ''), me.role, me.permission,
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
		var balance sql.NullInt64
		var balanceDate sql.NullString
		if err := rows.Scan(&a.ID, &a.Name, &a.Type, &a.Source, &iban, &a.Colour, &a.Buffer,
			&bankName, &a.Role, &a.Permission, &members, &balance, &balanceDate); err != nil {
			return nil, err
		}
		if m := MaskIBAN(iban); m != "" {
			a.IBAN = &m
		}
		a.Kind = "personal"
		if members > 1 {
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
	return list, nil
}

func (s *Store) loadMembers(ctx context.Context, viewer int64, list []Account, index map[int64]int) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT x.account_id, u.id, u.display_name, x.role, x.permission
		FROM account_access x
		JOIN users u ON u.id = x.user_id
		WHERE x.account_id IN (SELECT account_id FROM account_access WHERE user_id = ?)
		ORDER BY x.account_id, x.joined_at, u.id`, viewer)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var accountID, userID int64
		var m Member
		if err := rows.Scan(&accountID, &userID, &m.Name, &m.Role, &m.Permission); err != nil {
			return err
		}
		i, ok := index[accountID]
		if !ok || list[i].Kind != "shared" {
			continue
		}
		m.Initial = users.Initial(m.Name)
		m.Me = userID == viewer
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
}

// loadSync sets lastSync and syncStatus of bank accounts. The account follows
// its primary source; when that one fails or its consent lapsed, the most
// recent working fallback takes over (analysis 6.3).
func (s *Store) loadSync(ctx context.Context, viewer int64, list []Account, index map[int64]int, now time.Time) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.account_id, s.connection_id, s.priority, s.status, COALESCE(s.last_sync_at, ''),
		       c.status, COALESCE(c.valid_until, '')
		FROM account_sources s
		JOIN provider_connections c ON c.id = s.connection_id
		WHERE s.account_id IN (SELECT account_id FROM account_access WHERE user_id = ?)
		ORDER BY s.account_id, s.priority DESC, s.connection_id`, viewer)
	if err != nil {
		return err
	}
	defer rows.Close()
	byAccount := map[int64][]source{}
	for rows.Next() {
		var accountID int64
		var src source
		var priority, status, lastSync, connStatus, validUntil string
		if err := rows.Scan(&accountID, &src.connection, &priority, &status, &lastSync, &connStatus, &validUntil); err != nil {
			return err
		}
		src.primary = priority == "primary"
		src.usable = status == "ok" && connStatus == "active" && !consentLapsed(validUntil, now)
		if t, err := time.Parse(time.RFC3339, lastSync); err == nil {
			src.lastSync, src.hasSync = t, true
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
		for _, src := range srcs {
			a.sources = append(a.sources, src.connection)
		}
		status, last := syncState(srcs, now)
		a.SyncStatus = &status
		if !last.IsZero() {
			ts, _, _ := formatTimestamp(last.UTC().Format(time.RFC3339))
			a.LastSync = &ts
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
}

// UpdateAccount applies a patch for a viewer with edit permission and
// returns the updated account. Hidden accounts answer apperr.ErrNotFound,
// read-only ones apperr.ErrForbidden.
func (s *Store) UpdateAccount(ctx context.Context, viewer, id int64, p AccountPatch, now time.Time) (Account, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback()

	var accountType, permission string
	err = tx.QueryRowContext(ctx, `
		SELECT a.type, me.permission FROM account_access me JOIN accounts a ON a.id = me.account_id
		WHERE me.user_id = ? AND a.id = ?`, viewer, id).Scan(&accountType, &permission)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, apperr.ErrNotFound
	}
	if err != nil {
		return Account{}, err
	}
	if permission != "edit" {
		return Account{}, apperr.ErrForbidden
	}

	if p.Name == nil && p.Colour == nil && p.Buffer == nil {
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
		if err := validBuffer(accountType, *p.Buffer); err != nil {
			return Account{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE accounts SET name = COALESCE(?, name), colour = COALESCE(?, colour), buffer = COALESCE(?, buffer)
		WHERE id = ?`, name, p.Colour, p.Buffer, id); err != nil {
		return Account{}, err
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
