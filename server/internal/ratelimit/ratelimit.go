// Package ratelimit holds small in-memory limiters.
package ratelimit

import (
	"sync"
	"time"
)

// Cooldown allows one action per key per period, for example one "Sync now"
// per user per 15 minutes (banks limit background calls, analysis 4.1).
// State lives in memory, so a restart clears it.
type Cooldown struct {
	period time.Duration
	now    func() time.Time

	mu   sync.Mutex
	last map[int64]time.Time
}

// NewCooldown returns a cooldown; now is time.Now when nil.
func NewCooldown(period time.Duration, now func() time.Time) *Cooldown {
	if now == nil {
		now = time.Now
	}
	return &Cooldown{period: period, now: now, last: map[int64]time.Time{}}
}

// Allow records an action for key when the period since the previous one has
// passed. Otherwise it returns false and the time left to wait.
func (c *Cooldown) Allow(key int64) (bool, time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if prev, ok := c.last[key]; ok {
		if wait := prev.Add(c.period).Sub(now); wait > 0 {
			return false, wait
		}
	}
	for k, t := range c.last {
		if now.Sub(t) >= c.period {
			delete(c.last, k)
		}
	}
	c.last[key] = now
	return true, 0
}
