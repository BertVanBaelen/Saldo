package ratelimit

import (
	"testing"
	"time"
)

func TestCooldown(t *testing.T) {
	now := time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC)
	c := NewCooldown(15*time.Minute, func() time.Time { return now })

	if ok, _ := c.Allow(1); !ok {
		t.Fatal("first call must pass")
	}
	now = now.Add(10 * time.Minute)
	ok, wait := c.Allow(1)
	if ok || wait != 5*time.Minute {
		t.Fatalf("second call after 10 min: ok=%v wait=%v", ok, wait)
	}
	if ok, _ := c.Allow(2); !ok {
		t.Error("another key has its own cooldown")
	}
	now = now.Add(5 * time.Minute)
	if ok, _ := c.Allow(1); !ok {
		t.Error("after 15 minutes the call must pass again")
	}
	// A refused call does not restart the period.
	now = now.Add(14 * time.Minute)
	c.Allow(1)
	now = now.Add(time.Minute)
	if ok, _ := c.Allow(1); !ok {
		t.Error("a refused call restarted the cooldown")
	}
}

func TestLimiter(t *testing.T) {
	now := time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC)
	l := NewLimiter(2, 10*time.Minute, func() time.Time { return now })

	for i := range 2 {
		if wait, _ := l.Allow("a"); wait != 0 {
			t.Fatalf("attempt %d refused", i+1)
		}
	}
	if l.Blocked("a") != 10*time.Minute {
		t.Error("a full window must block")
	}
	now = now.Add(4 * time.Minute)
	wait, first := l.Allow("a")
	if wait != 6*time.Minute || !first {
		t.Errorf("third attempt: wait %v, first %v", wait, first)
	}
	if _, first := l.Allow("a"); first {
		t.Error("only the first refusal is marked")
	}
	if wait, _ := l.Allow("b"); wait != 0 {
		t.Error("another key has its own window")
	}
	if l.Blocked("c") != 0 {
		t.Error("Blocked on a fresh key")
	}
	now = now.Add(6 * time.Minute)
	if wait, _ := l.Allow("a"); wait != 0 {
		t.Error("a new window must allow again")
	}
}
