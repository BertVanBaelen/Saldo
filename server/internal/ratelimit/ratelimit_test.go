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
