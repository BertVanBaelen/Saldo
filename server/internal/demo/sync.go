package demo

import (
	"context"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Syncer is the "Sync now" of demo mode. The fake provider's story ends on
// the demo date, so there is nothing new to fetch: it only records that the
// viewer's connections synced.
type Syncer struct {
	Store *ledger.Store
}

// Sync records a successful sync of the viewer's connections at now.
func (s Syncer) Sync(ctx context.Context, viewer int64, now time.Time) error {
	_, err := s.Store.MarkSynced(ctx, viewer, now)
	return err
}
