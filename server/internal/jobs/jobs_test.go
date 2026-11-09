package jobs

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"
)

func TestRunDueKeepsEachIntervalWithAFakeClock(t *testing.T) {
	now := time.Date(2026, 11, 18, 3, 55, 0, 0, time.UTC)
	s := New(func() time.Time { return now }, nil)
	var ran []string
	s.Every(10*time.Minute, "sync", func(_ context.Context, at time.Time) error {
		ran = append(ran, "sync "+at.Format("15:04"))
		return errors.New("logged, not fatal")
	})
	s.Every(time.Hour, "reminders", func(_ context.Context, at time.Time) error {
		ran = append(ran, "reminders "+at.Format("15:04"))
		return nil
	})
	ctx := context.Background()
	for range 9 { // 03:55 … 04:19
		s.RunDue(ctx)
		now = now.Add(3 * time.Minute)
	}
	want := []string{"sync 03:55", "reminders 03:55", "sync 04:07", "sync 04:19"}
	if !slices.Equal(ran, want) {
		t.Errorf("ran %q, want %q", ran, want)
	}
}

func TestRunStopsWithItsContext(t *testing.T) {
	s := New(nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	s.Every(time.Hour, "job", func(ctx context.Context, _ time.Time) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	})
	done := make(chan struct{})
	go func() {
		s.Run(ctx)
		close(done)
	}()
	<-started
	cancel()
	<-done
}
