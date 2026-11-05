package banklink

import (
	"cmp"
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/bank/enablebanking"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// overlapDays is how far before the newest stored transaction a sync starts
// again, so late bookings and rows that were pending are fetched once more.
const overlapDays = 14

// Sync is "Sync now" for the viewer's active connections (server.Syncer). A
// bank error is stored on its connection and is not an error here; only a
// database failure is. A connection that is syncing already (the nightly job,
// the link callback) is not fetched twice: Sync waits for that sync instead.
func (s *Service) Sync(ctx context.Context, viewer int64, now time.Time) error {
	ids, err := s.activeConnections(ctx, viewer)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := s.run(ctx, id, now, true); err != nil {
			return err
		}
	}
	return nil
}

// SyncConnection is the first sync of a link that was just completed. It
// waits for a sync of the connection that is still running, which may have
// used the session of before the new consent, and then syncs it anyway.
func (s *Service) SyncConnection(ctx context.Context, connection int64, now time.Time) error {
	return s.run(ctx, connection, now, false)
}

// activeConnections lists the active connections with a session: of the
// viewer, or of everyone for viewer 0.
func (s *Service) activeConnections(ctx context.Context, viewer int64) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM provider_connections
		WHERE (? = 0 OR user_id = ?) AND status = 'active' AND session_id_enc IS NOT NULL ORDER BY id`, viewer, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// claim marks the connection as syncing. When it already is, it returns nil
// and a channel that closes when that sync ends.
func (s *Service) claim(id int64) (release func(), busy <-chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if done, ok := s.syncing[id]; ok {
		return nil, done
	}
	done := make(chan struct{})
	s.syncing[id] = done
	return func() {
		s.mu.Lock()
		delete(s.syncing, id)
		s.mu.Unlock()
		close(done)
	}, nil
}

// run syncs one connection, never two at once. With join a sync that is
// already running counts as this one.
func (s *Service) run(ctx context.Context, id int64, now time.Time, join bool) error {
	for {
		release, busy := s.claim(id)
		if release != nil {
			defer release()
			return s.syncConnection(ctx, id, now)
		}
		select {
		case <-busy:
			if join {
				return nil
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

type source struct {
	account  int64
	iban     string
	external string // the provider's account id in the current session
}

// syncConnection fetches every account the connection feeds. A failing
// account is recorded on its account_sources row and the others still sync;
// the connection is ok only when every account is. A lapsed session stops it.
// The caller holds the connection's claim.
func (s *Service) syncConnection(ctx context.Context, id int64, now time.Time) error {
	c, err := scanConnection(s.db.QueryRowContext(ctx, `SELECT `+connectionColumns+` FROM provider_connections WHERE id = ?`, id))
	if err != nil {
		return err
	}
	ts := now.UTC().Format(time.RFC3339)
	today := now.In(clock.Brussels).Format(time.DateOnly)

	client, err := s.client(c)
	var session []byte
	if err == nil && c.sessEnc != nil {
		session, err = s.box.Open(c.sessEnc)
	}
	if err != nil || len(session) == 0 {
		// A lost secret.key or credentials removed: only new ones help.
		return s.broken(ctx, c.id, ts, "credentials", false)
	}
	sess := bank.Session{ID: string(session)}

	sources, err := s.sources(ctx, c.id)
	if err != nil {
		return err
	}
	failed := ""
	for _, src := range sources {
		from, err := s.fromDate(ctx, src.account, today)
		if err != nil {
			return err
		}
		txs, err := client.FetchTransactions(ctx, sess, src.external, from, today)
		var bals []bank.Balance
		if err == nil {
			bals, err = client.FetchBalances(ctx, sess, src.external)
		}
		if errors.Is(err, bank.ErrSessionExpired) {
			return s.broken(ctx, c.id, ts, errorCode(err), true)
		}
		if err != nil {
			code := errorCode(err)
			if err := s.accountFailed(ctx, c.id, src.account, ts, code); err != nil {
				return err
			}
			failed = cmp.Or(failed, code)
			continue
		}
		if err := s.storeAccount(ctx, c.id, src, from, txs, bals, today, ts); err != nil {
			return err
		}
	}
	if failed != "" {
		_, err = s.db.ExecContext(context.WithoutCancel(ctx), `UPDATE provider_connections
			SET sync_status = 'failed', last_attempt_at = ?, last_error = ? WHERE id = ?`, ts, failed, c.id)
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE provider_connections
		SET last_sync_at = ?, last_attempt_at = ?, sync_status = 'ok', last_error = NULL WHERE id = ?`, ts, ts, c.id)
	return err
}

func (s *Service) sources(ctx context.Context, connection int64) ([]source, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.account_id, COALESCE(a.iban, ''), s.external_account_id
		FROM account_sources s JOIN accounts a ON a.id = s.account_id
		WHERE s.connection_id = ? AND s.external_account_id IS NOT NULL ORDER BY s.account_id`, connection)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []source
	for rows.Next() {
		var src source
		if err := rows.Scan(&src.account, &src.iban, &src.external); err != nil {
			return nil, err
		}
		list = append(list, src)
	}
	return list, rows.Err()
}

// fromDate is where the account's sync starts: nothing (the longest history
// the bank gives, analysis 4.1) while the account has no transactions, else
// overlapDays before the newest one.
func (s *Service) fromDate(ctx context.Context, account int64, today string) (string, error) {
	var newest string
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(booking_date), '') FROM transactions WHERE account_id = ?`,
		account).Scan(&newest); err != nil || newest == "" {
		return "", err
	}
	t, err := time.Parse(time.DateOnly, newest)
	if err != nil {
		return "", err
	}
	return min(t.AddDate(0, 0, -overlapDays).Format(time.DateOnly), today), nil
}

// storeAccount stores one account's complete fetch and its bank balance in
// one database transaction.
func (s *Service) storeAccount(ctx context.Context, connection int64, src source, from string, txs []bank.Transaction, bals []bank.Balance, today, ts string) error {
	for i := range txs {
		// A pending row often has no booking date yet; it is listed on its
		// value date until the bank books it.
		if txs[i].BookingDate == "" {
			txs[i].BookingDate = cmp.Or(txs[i].ValueDate, today)
		}
	}
	rows := ledger.Keyed(src.account, src.iban, connection, txs)
	// The bank lists newest first; storing oldest first keeps a day's order,
	// because lists sort on booking date and then id.
	slices.Reverse(rows)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := ledger.StoreFetch(ctx, tx, src.account, connection, from, rows); err != nil {
		return err
	}
	if b, ok := pickBalance(bals); ok {
		if _, err := tx.ExecContext(ctx, `INSERT INTO balance_snapshots (account_id, balance, date, origin) VALUES (?, ?, ?, 'bank')
			ON CONFLICT (account_id, date, origin) DO UPDATE SET balance = excluded.balance, created_at = excluded.created_at`,
			src.account, b.Amount, cmp.Or(b.Date, today)); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE account_sources SET status = 'ok', last_sync_at = ?, last_attempt_at = ?, last_error = NULL
		WHERE account_id = ? AND connection_id = ?`, ts, ts, src.account, connection); err != nil {
		return err
	}
	return tx.Commit()
}

// pickBalance chooses the balance the account shows and the forecast starts
// from (analysis 5.3): the booked balance, because pending rows stay out of
// the totals (analysis 4.1) and an "available" balance may include a credit
// line. Of the interim booked (ITBD, during the day) and the closing booked
// (CLBD, end of the last business day) the newer wins, ITBD on the same date.
// Without a booked balance the expected one (XPCD), else the first reported.
// verify in S1: which balance types Argenta reports.
func pickBalance(bals []bank.Balance) (bank.Balance, bool) {
	if len(bals) == 0 {
		return bank.Balance{}, false
	}
	group := func(t string) int {
		switch t {
		case "ITBD", "CLBD":
			return 2
		case "XPCD":
			return 1
		}
		return 0
	}
	best := bals[0]
	for _, b := range bals[1:] {
		gb, gbest := group(b.Type), group(best.Type)
		switch {
		case gb != gbest:
			if gb > gbest {
				best = b
			}
		case gb == 0:
			// keep the first reported
		case b.Date != best.Date:
			if b.Date > best.Date {
				best = b
			}
		case b.Type == "ITBD":
			best = b
		}
	}
	return best, true
}

// accountFailed records that one account could not be fetched. Only an error
// code is stored and logged, never the error, which can quote bank data. It
// is written also when the sync ran out of time, so the status shows it.
func (s *Service) accountFailed(ctx context.Context, connection, account int64, ts, code string) error {
	s.log.Warn("bank sync failed", "connection", connection, "account", account, "code", code)
	_, err := s.db.ExecContext(context.WithoutCancel(ctx), `UPDATE account_sources
		SET status = 'failed', last_attempt_at = ?, last_error = ? WHERE account_id = ? AND connection_id = ?`,
		ts, code, account, connection)
	return err
}

// broken records a sync that failed for the whole connection: a lapsed
// session marks it expired (only a new consent helps), anything else failed,
// and every account it feeds failed with the same code.
func (s *Service) broken(ctx context.Context, connection int64, ts, code string, expired bool) error {
	ctx = context.WithoutCancel(ctx)
	q := `UPDATE provider_connections SET sync_status = 'failed', last_attempt_at = ?, last_error = ? WHERE id = ?`
	if expired {
		q = `UPDATE provider_connections SET status = 'expired', last_attempt_at = ?, last_error = ? WHERE id = ?`
	}
	s.log.Warn("bank sync failed", "connection", connection, "code", code)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, q, ts, code, connection); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE account_sources SET status = 'failed', last_attempt_at = ?, last_error = ?
		WHERE connection_id = ?`, ts, code, connection); err != nil {
		return err
	}
	return tx.Commit()
}

// errorCode is what is kept of a provider error: its code or HTTP status.
func errorCode(err error) string {
	var api *enablebanking.APIError
	switch {
	case errors.Is(err, bank.ErrSessionExpired):
		return "session_expired"
	case errors.As(err, &api):
		if code := cleanCode(api.Code); code != "" {
			return code
		}
		return "http_" + strconv.Itoa(api.Status)
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "canceled"
	}
	return "provider_error"
}

// cleanCode returns a provider code that looks like one ("ASPSP_ERROR"), else
// "": no digits, so an account number can never pass as a code.
func cleanCode(s string) string {
	if len(s) > 64 || strings.Trim(s, "ABCDEFGHIJKLMNOPQRSTUVWXYZ_") != "" {
		return ""
	}
	return s
}
