package banklink

import (
	"crypto/subtle"
	"slices"
	"sync"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/auth"
)

// stateTTL is how long the user may take at the bank (analysis 6.2).
const stateTTL = 15 * time.Minute

// states are the consents under way: the random state sent to the bank, bound
// to the viewer and the connection, single use. Only its hash is kept.
// shortcut: in memory, so a restart during a consent loses it and the user
// starts again.
type states struct {
	now  func() time.Time
	mu   sync.Mutex
	list []pendingState
}

type pendingState struct {
	hash       string
	viewer     int64
	connection int64
	expires    time.Time
}

// add returns a new state for the viewer's link of the connection.
func (s *states) add(viewer, connection int64) string {
	token, hash := auth.NewToken()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep()
	s.list = append(s.list, pendingState{hash: hash, viewer: viewer, connection: connection, expires: s.now().Add(stateTTL)})
	return token
}

// take spends a state and returns its connection. A state that is found is
// gone afterwards, also when it belongs to someone else, so it never works
// twice; ok is false for an unknown, expired, used or foreign state alike.
func (s *states) take(token string, viewer int64) (connection int64, ok bool) {
	hash := auth.HashToken(token)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep()
	found := -1
	for i, p := range s.list {
		if subtle.ConstantTimeCompare([]byte(p.hash), []byte(hash)) == 1 {
			found = i
		}
	}
	if found < 0 {
		return 0, false
	}
	p := s.list[found]
	s.list = slices.Delete(s.list, found, found+1)
	return p.connection, p.viewer == viewer
}

// sweep drops expired states; the caller holds mu.
func (s *states) sweep() {
	now := s.now()
	s.list = slices.DeleteFunc(s.list, func(p pendingState) bool { return !now.Before(p.expires) })
}
