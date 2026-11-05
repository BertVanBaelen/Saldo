package ratelimit

import (
	"sync"
	"time"
)

// Limiter allows n attempts per key per fixed window, for example 5 sign-in
// attempts per e-mail address per 10 minutes. State lives in memory.
type Limiter struct {
	n      int
	period time.Duration
	now    func() time.Time

	mu      sync.Mutex
	windows map[string]*window
}

type window struct {
	start time.Time
	count int
}

// NewLimiter returns a limiter; now is time.Now when nil.
func NewLimiter(n int, period time.Duration, now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{n: n, period: period, now: now, windows: map[string]*window{}}
}

// Allow counts an attempt for key. It returns 0 when the attempt may go
// ahead, else the time until the window ends; first is true for the first
// refused attempt of a window, so a flood is audited once.
func (l *Limiter) Allow(key string) (wait time.Duration, first bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.current(key)
	w.count++
	if w.count <= l.n {
		return 0, false
	}
	return w.start.Add(l.period).Sub(l.now()), w.count == l.n+1
}

// Blocked returns the time left when key has used up its window, without
// counting an attempt; 0 when it may go ahead.
func (l *Limiter) Blocked(key string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.current(key)
	if w.count < l.n {
		return 0
	}
	return w.start.Add(l.period).Sub(l.now())
}

// current returns key's live window and drops ended ones.
func (l *Limiter) current(key string) *window {
	now := l.now()
	for k, w := range l.windows {
		if now.Sub(w.start) >= l.period {
			delete(l.windows, k)
		}
	}
	w, ok := l.windows[key]
	if !ok {
		w = &window{start: now}
		l.windows[key] = w
	}
	return w
}
