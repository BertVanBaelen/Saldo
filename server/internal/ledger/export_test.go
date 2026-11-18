package ledger

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

// ReportRows reads the report rule per transaction for the selection of
// scope and account: id -> "out", or the buckets of its parts summed as the
// report counts them ("income 45000", "saved 20000", "<key> 4000"), joined
// by ", ". Rows outside the selection are absent. For tests only.
func (s *Store) ReportRows(ctx context.Context, viewer int64, scope string, account int64) (map[int64]string, error) {
	sel, err := s.reportSelection(ctx, viewer, scope, account)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, visibleTx+reportParts+`
		SELECT id, `+reportBucket(inSelection("other_id", sel))+`, `+reportKey+`, SUM(amount)
		FROM parts WHERE `+inSelection("account_id", sel)+` GROUP BY 1, 2, 3`, viewer, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	labels := map[int64][]string{}
	for rows.Next() {
		var id, amount int64
		var bucket, key string
		if err := rows.Scan(&id, &bucket, &key, &amount); err != nil {
			return nil, err
		}
		var label string
		switch bucket {
		case "out":
			label = "out"
		case "income":
			label = fmt.Sprintf("income %d", amount)
		case "saved":
			label = fmt.Sprintf("saved %d", -amount)
		default:
			label = fmt.Sprintf("%s %d", key, -amount)
		}
		labels[id] = append(labels[id], label)
	}
	out := map[int64]string{}
	for id, l := range labels {
		sort.Strings(l)
		out[id] = strings.Join(l, ", ")
	}
	return out, rows.Err()
}

// SavedParts is, per transaction of the selection booked between from and to,
// what its parts in the saved bucket add to the report's saved (−amount).
// Only rows with a saved part are present. For tests only.
func (s *Store) SavedParts(ctx context.Context, viewer int64, scope string, account int64, from, to string) (map[int64]int64, error) {
	sel, err := s.reportSelection(ctx, viewer, scope, account)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, visibleTx+reportParts+`
		SELECT id, -SUM(amount) FROM parts WHERE `+inSelection("account_id", sel)+` AND booking_date BETWEEN ? AND ?
		AND `+reportBucket(inSelection("other_id", sel))+` = 'saved' GROUP BY id`, viewer, viewer, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int64{}
	for rows.Next() {
		var id, saved int64
		if err := rows.Scan(&id, &saved); err != nil {
			return nil, err
		}
		out[id] = saved
	}
	return out, rows.Err()
}

// DrillDown lists the ids behind one key of the report, through the
// drill-down fragment (0.7-2 uses the same one). For tests only.
func (s *Store) DrillDown(ctx context.Context, viewer int64, scope string, account int64, from, to, key string) ([]int64, error) {
	sel, err := s.reportSelection(ctx, viewer, scope, account)
	if err != nil {
		return nil, err
	}
	cond, args := reportDrillDown(sel, key)
	rows, err := s.db.QueryContext(ctx, visibleTx+reportParts+`
		SELECT tx.id FROM tx WHERE tx.booking_date BETWEEN ? AND ? AND `+cond+` ORDER BY tx.id`,
		append([]any{viewer, viewer, from, to}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
