// Package db opens Saldo's SQLite database and applies the embedded,
// numbered schema migrations.
package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver, registers "sqlite"
)

//go:embed migrations/*.sql
var embedded embed.FS

// Migrations are the schema migrations built into the binary.
func Migrations() fs.FS {
	sub, err := fs.Sub(embedded, "migrations")
	if err != nil {
		panic(err)
	}
	return sub
}

// Open opens (and creates) the database at path with WAL, foreign keys and a
// busy timeout. Use ":memory:" only for single-connection tests.
func Open(path string) (*sql.DB, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("db: state directory: %w", err)
		}
	}
	q := url.Values{}
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "synchronous(NORMAL)")
	q.Set("_txlock", "immediate")
	// Without a "file:" prefix the driver strips its own parameters and opens the
	// path as is, which keeps Windows paths and spaces working.
	db, err := sql.Open("sqlite", path+"?"+q.Encode())
	if err != nil {
		return nil, fmt.Errorf("db: open: %w", err)
	}
	if path == ":memory:" {
		db.SetMaxOpenConns(1)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("db: open %s: %w", path, err)
	}
	return db, nil
}

var migrationName = regexp.MustCompile(`^(\d{4})_[a-z0-9_]+\.sql$`)

type migration struct {
	version int
	name    string
}

func list(fsys fs.FS) ([]migration, error) {
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return nil, err
	}
	var out []migration
	seen := map[int]string{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		m := migrationName.FindStringSubmatch(e.Name())
		if m == nil {
			return nil, fmt.Errorf("db: migration file %q does not match NNNN_name.sql", e.Name())
		}
		v, _ := strconv.Atoi(m[1])
		if prev, ok := seen[v]; ok {
			return nil, fmt.Errorf("db: migrations %q and %q share version %d", prev, e.Name(), v)
		}
		seen[v] = e.Name()
		out = append(out, migration{version: v, name: e.Name()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

// Migrate applies every migration in fsys that is not yet recorded in
// schema_migrations, in order, each in its own transaction. When the database
// already holds a schema and something is pending, it first writes a copy to
// backupDir (skipped when backupDir is empty). It returns the versions applied.
func Migrate(ctx context.Context, db *sql.DB, fsys fs.FS, backupDir string, log *slog.Logger) ([]int, error) {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    INTEGER PRIMARY KEY,
		name       TEXT NOT NULL,
		applied_at TEXT NOT NULL
	)`); err != nil {
		return nil, fmt.Errorf("db: schema_migrations: %w", err)
	}
	all, err := list(fsys)
	if err != nil {
		return nil, err
	}
	applied := map[int]bool{}
	rows, err := db.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return nil, err
		}
		applied[v] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var pending []migration
	for _, m := range all {
		if !applied[m.version] {
			pending = append(pending, m)
		}
	}
	if len(pending) == 0 {
		return nil, nil
	}
	if len(applied) > 0 && backupDir != "" {
		path, err := Backup(ctx, db, backupDir, fmt.Sprintf("before-%04d", pending[0].version))
		if err != nil {
			return nil, fmt.Errorf("db: backup before migrating: %w", err)
		}
		log.Info("database backed up before migrating", "file", path)
	}

	var done []int
	for _, m := range pending {
		body, err := fs.ReadFile(fsys, m.name)
		if err != nil {
			return done, err
		}
		if err := apply(ctx, db, m, string(body)); err != nil {
			return done, err
		}
		log.Info("migration applied", "version", m.version, "name", m.name)
		done = append(done, m.version)
	}
	return done, nil
}

func apply(ctx context.Context, db *sql.DB, m migration, body string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, body); err != nil {
		return fmt.Errorf("db: migration %s: %w", m.name, err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
		m.version, m.name, time.Now().UTC().Format(time.RFC3339)); err != nil {
		return err
	}
	return tx.Commit()
}

// keepBackups is how many migration backups stay on disk.
const keepBackups = 5

// Backup writes a consistent copy of the database to dir and prunes old copies.
func Backup(ctx context.Context, db *sql.DB, dir, label string) (string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	name := fmt.Sprintf("saldo-%s-%s.db", time.Now().UTC().Format("20060102T150405Z"), label)
	path := filepath.Join(dir, name)
	if _, err := db.ExecContext(ctx, `VACUUM INTO ?`, path); err != nil {
		return "", err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return path, nil
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "saldo-") && strings.HasSuffix(e.Name(), ".db") {
			names = append(names, e.Name())
		}
	}
	slices.Sort(names)
	for len(names) > keepBackups {
		os.Remove(filepath.Join(dir, names[0]))
		names = names[1:]
	}
	return path, nil
}
