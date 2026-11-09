package ledger

import (
	"context"
	"database/sql"
	"encoding/base64"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
)

// Transaction is a transaction as the viewer sees it (docs/api.md).
type Transaction struct {
	ID            int64     `json:"id"`
	AccountID     int64     `json:"accountId"`
	BookingDate   string    `json:"bookingDate"`
	Amount        int64     `json:"amount"`
	Counterparty  string    `json:"counterparty"`
	Communication string    `json:"communication"`
	Status        string    `json:"status"`
	Category      *Category `json:"category"`
	Transfer      bool      `json:"transfer"`
}

// Category is the short category reference on a transaction.
type Category struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Colour string `json:"colour"`
}

// Page is one page of transactions; Next is the cursor of the next page and
// Total the number of rows that match the filters, on every page.
type Page struct {
	Items []Transaction `json:"items"`
	Next  *string       `json:"next"`
	Total int           `json:"total"`
}

// Paging limits for GET /api/transactions.
const (
	DefaultLimit = 50
	MaxLimit     = 200
	maxQuery     = 100
)

// TxQuery filters the viewer's transactions.
type TxQuery struct {
	AccountID     int64  // 0 = every visible account
	Scope         string // "", "alles", "persoonlijk" or "gedeeld"
	Q             string // search in counterparty, communication and amount
	Uncategorised bool
	From, To      string // booking dates YYYY-MM-DD, inclusive; "" = open
	Before        string // cursor from Page.Next
	Limit         int    // 0 = DefaultLimit
}

// cursor is the position after which the next page starts (newest first).
type cursor struct {
	date string
	id   int64
}

func (c cursor) encode() string {
	return base64.RawURLEncoding.EncodeToString([]byte(c.date + "|" + strconv.FormatInt(c.id, 10)))
}

func decodeCursor(s string) (cursor, error) {
	bad := apperr.Invalid("Deze lijst is verouderd. Laad de transacties opnieuw.")
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return cursor{}, bad
	}
	date, idText, ok := strings.Cut(string(b), "|")
	if !ok {
		return cursor{}, bad
	}
	if _, err := time.Parse(time.DateOnly, date); err != nil {
		return cursor{}, bad
	}
	id, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || id <= 0 {
		return cursor{}, bad
	}
	return cursor{date: date, id: id}, nil
}

// visibleTx is the viewer's transactions with the per-viewer transfer flag
// (analysis 5.2): a transaction is a transfer when its counterparty IBAN is
// another account the viewer can see, unless the viewer marked it otherwise.
// The first two parameters are the viewer's id.
const visibleTx = `
WITH vis AS (
    SELECT x.account_id,
           (SELECT COUNT(*) FROM account_access m WHERE m.account_id = x.account_id) AS members
    FROM account_access x WHERE x.user_id = ?
), viban AS (
    SELECT a.id, a.iban FROM accounts a JOIN vis ON vis.account_id = a.id
    WHERE a.iban IS NOT NULL AND a.iban <> ''
), tx AS (
    SELECT t.*, vis.members,
           COALESCE(
               (SELECT o.is_transfer FROM transfer_overrides o WHERE o.user_id = ? AND o.transaction_id = t.id),
               EXISTS (SELECT 1 FROM viban WHERE viban.iban = t.counterparty_iban AND viban.id <> t.account_id)
           ) AS is_transfer
    FROM transactions t JOIN vis ON vis.account_id = t.account_id
)`

// uncategorisedCond: no category, no split, and not a transfer for the viewer.
const uncategorisedCond = `tx.category_id IS NULL AND tx.is_transfer = 0
    AND NOT EXISTS (SELECT 1 FROM transaction_splits sp WHERE sp.transaction_id = tx.id)`

// Transactions returns one page of the viewer's transactions, newest first
// (booking date, then id). A hidden account answers apperr.ErrNotFound.
func (s *Store) Transactions(ctx context.Context, viewer int64, q TxQuery) (Page, error) {
	limit := q.Limit
	if limit <= 0 {
		limit = DefaultLimit
	}
	limit = min(limit, MaxLimit)

	where, args, err := s.filters(ctx, viewer, q)
	if err != nil {
		return Page{}, err
	}
	page := Page{Items: []Transaction{}}
	if err := s.db.QueryRowContext(ctx, visibleTx+` SELECT COUNT(*) FROM tx WHERE `+strings.Join(where, " AND "),
		append([]any{viewer, viewer}, args...)...).Scan(&page.Total); err != nil {
		return Page{}, err
	}
	if q.Before != "" {
		c, err := decodeCursor(q.Before)
		if err != nil {
			return Page{}, err
		}
		where = append(where, `(tx.booking_date < ? OR (tx.booking_date = ? AND tx.id < ?))`)
		args = append(args, c.date, c.date, c.id)
	}
	query := visibleTx + `
		SELECT tx.id, tx.account_id, tx.booking_date, tx.amount, tx.counterparty_name, tx.communication,
		       tx.status, c.id, c.name, c.colour, tx.is_transfer
		FROM tx LEFT JOIN categories c ON c.id = tx.category_id
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY tx.booking_date DESC, tx.id DESC
		LIMIT ?`
	args = append([]any{viewer, viewer}, args...)
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var t Transaction
		var catID sql.NullInt64
		var catName, catColour sql.NullString
		if err := rows.Scan(&t.ID, &t.AccountID, &t.BookingDate, &t.Amount, &t.Counterparty, &t.Communication,
			&t.Status, &catID, &catName, &catColour, &t.Transfer); err != nil {
			return Page{}, err
		}
		if catID.Valid {
			t.Category = &Category{ID: catID.Int64, Name: catName.String, Colour: catColour.String}
		}
		page.Items = append(page.Items, t)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		last := page.Items[limit-1]
		next := cursor{date: last.BookingDate, id: last.ID}.encode()
		page.Next = &next
	}
	return page, nil
}

// UncategorisedCount counts the viewer's transactions that still need a
// category: no category, no split and not a transfer for the viewer.
func (s *Store) UncategorisedCount(ctx context.Context, viewer int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, visibleTx+` SELECT COUNT(*) FROM tx WHERE `+uncategorisedCond,
		viewer, viewer).Scan(&n)
	return n, err
}

// filters turns a query into SQL conditions on the tx CTE.
func (s *Store) filters(ctx context.Context, viewer int64, q TxQuery) ([]string, []any, error) {
	where := []string{"1 = 1"}
	var args []any
	if q.AccountID != 0 {
		var ok bool
		err := s.db.QueryRowContext(ctx,
			`SELECT EXISTS (SELECT 1 FROM account_access WHERE user_id = ? AND account_id = ?)`,
			viewer, q.AccountID).Scan(&ok)
		if err != nil {
			return nil, nil, err
		}
		if !ok {
			return nil, nil, apperr.ErrNotFound
		}
		where = append(where, "tx.account_id = ?")
		args = append(args, q.AccountID)
	}
	switch q.Scope {
	case "", "alles":
	case "persoonlijk":
		where = append(where, "tx.members = 1")
	case "gedeeld":
		where = append(where, "tx.members > 1")
	default:
		return nil, nil, apperr.Invalid("Kies alles, persoonlijk of gedeeld.")
	}
	if text := strings.TrimSpace(q.Q); text != "" {
		if utf8.RuneCountInString(text) > maxQuery {
			return nil, nil, apperr.Invalid("De zoekterm is te lang.")
		}
		like := "%" + escapeLike(text) + "%"
		cond := `(tx.counterparty_name LIKE ? ESCAPE '\' OR tx.communication LIKE ? ESCAPE '\'`
		args = append(args, like, like)
		if amount, ok := amountQuery(text); ok {
			cond += ` OR printf('%d,%02d', abs(tx.amount) / 100, abs(tx.amount) % 100) LIKE ? ESCAPE '\'`
			args = append(args, escapeLike(amount)+"%")
		}
		where = append(where, cond+")")
	}
	if q.Uncategorised {
		where = append(where, uncategorisedCond)
	}
	for _, d := range []struct {
		value, cond string
	}{{q.From, "tx.booking_date >= ?"}, {q.To, "tx.booking_date <= ?"}} {
		if d.value == "" {
			continue
		}
		if _, err := time.Parse(time.DateOnly, d.value); err != nil {
			return nil, nil, apperr.Invalid("Kies een datum als 2026-11-18.")
		}
		where = append(where, d.cond)
		args = append(args, d.value)
	}
	if q.From != "" && q.To != "" && q.From > q.To {
		return nil, nil, apperr.Invalid("De begindatum ligt na de einddatum.")
	}
	return where, args, nil
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

var amountPattern = regexp.MustCompile(`^\d+(,\d{0,2})?$`)

// amountQuery turns a search like "24,99", "€ 24.99", "-1.005,00" or "1005"
// into the "1005,00" form used to match amounts by prefix: whole euros match
// every amount of that euro ("12" is 12,00 to 12,99, never 120), one decimal
// is tenths ("12,5" is 12,50).
func amountQuery(q string) (string, bool) {
	s := strings.NewReplacer("€", "", " ", "", "\u00a0", "").Replace(q)
	for _, sign := range []string{"+", "-", "−"} {
		if strings.HasPrefix(s, sign) {
			s = s[len(sign):]
			break
		}
	}
	switch {
	case strings.Contains(s, ","):
		s = strings.ReplaceAll(s, ".", "")
	case strings.Count(s, ".") == 1 && len(s)-strings.Index(s, ".") <= 3:
		s = strings.Replace(s, ".", ",", 1)
	default:
		s = strings.ReplaceAll(s, ".", "")
	}
	if !amountPattern.MatchString(s) {
		return "", false
	}
	euros, cents, comma := strings.Cut(s, ",")
	switch {
	case !comma || cents == "":
		return euros + ",", true
	case len(cents) == 1:
		return s + "0", true
	}
	return s, true
}
