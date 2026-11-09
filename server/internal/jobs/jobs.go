// Package jobs runs Saldo's background jobs, such as the nightly bank sync.
// A job is a catch-up check that runs every interval and decides itself what
// is due at the time it is given, so a restart or a stopped add-on (the Home
// Assistant backup) only delays the work. Jobs run one after another, never
// two at once.
package jobs

import (
	"context"
	"log/slog"
	"time"
)

// tick is how often the scheduler looks for a due job.
const tick = time.Minute

// Func is a job's work at now.
type Func func(ctx context.Context, now time.Time) error

type job struct {
	name     string
	interval time.Duration
	fn       Func
	last     time.Time // zero: not run yet
}

// Scheduler runs registered jobs on their interval. Register jobs with Every
// before Run.
type Scheduler struct {
	now  func() time.Time
	log  *slog.Logger
	jobs []*job
}

// New returns a scheduler on the clock now (time.Now when nil).
func New(now func() time.Time, log *slog.Logger) *Scheduler {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Scheduler{now: now, log: log}
}

// Every registers fn to run every interval, the first time at the first check.
func (s *Scheduler) Every(interval time.Duration, name string, fn Func) {
	s.jobs = append(s.jobs, &job{name: name, interval: interval, fn: fn})
}

// Run checks for due jobs now and then every minute until ctx ends. It
// returns after the job that is running when ctx ends has stopped.
func (s *Scheduler) Run(ctx context.Context) {
	t := time.NewTicker(tick)
	defer t.Stop()
	for {
		s.RunDue(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// RunDue runs every job whose interval has passed at the scheduler's now. A
// job's error is logged; the job runs again on its next interval.
func (s *Scheduler) RunDue(ctx context.Context) {
	for _, j := range s.jobs {
		now := s.now()
		if ctx.Err() != nil {
			return
		}
		if !j.last.IsZero() && now.Sub(j.last) < j.interval {
			continue
		}
		j.last = now
		if err := j.fn(ctx, now); err != nil && ctx.Err() == nil {
			s.log.Error("job failed", "job", j.name, "error", err)
		}
	}
}
