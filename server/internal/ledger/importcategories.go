package ledger

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/importers"
)

// Category mapping of an import (phase 0.5-3, docs/api.md "Bilance"): a
// source category is the pair (Categorie, Subcategorie), kept in two parts
// and never joined. The mapping is the viewer's own, per source, and says
// where each pair goes in the shared category tree.

// Actions of a CategoryChoice.
const (
	ActionMap    = "map"    // to an existing category
	ActionCreate = "create" // to a new category made with the import
	ActionSkip   = "skip"   // leave uncategorised
)

// ImportSources are the sources a mapping is kept for.
var ImportSources = []string{"argenta", "bilance", "csv"}

// NewCategory is the category an ActionCreate choice makes: a subcategory
// when ParentID is set (it takes its parent's type and colour), otherwise a
// top category of Type ("expense" when empty) and Colour.
type NewCategory struct {
	Name     string `json:"name"`
	ParentID *int64 `json:"parentId"`
	Type     string `json:"type"`
	Icon     string `json:"icon"`
	Colour   string `json:"colour"`
}

// CategoryChoice is what the user chose for one source pair.
type CategoryChoice struct {
	Category    string       `json:"category"`
	Subcategory string       `json:"subcategory"`
	Action      string       `json:"action"`
	CategoryID  int64        `json:"categoryId"`
	New         *NewCategory `json:"new"`
}

// CategoryPlan is the choices of one import, for a file with category
// columns. Source is the import's source ("bilance", "argenta", "csv").
type CategoryPlan struct {
	Source  string
	Choices []CategoryChoice
}

// SavedMapping is one saved pair; CategoryID nil means "leave uncategorised".
type SavedMapping struct {
	Category    string `json:"category"`
	Subcategory string `json:"subcategory"`
	CategoryID  *int64 `json:"categoryId"`
}

// resolved is the target per pair after validation (and creation); 0 is
// "leave uncategorised". A pair without a choice is absent.
type resolved map[[2]string]int64

func validSource(source string) error {
	if !slices.Contains(ImportSources, source) {
		return apperr.Invalid("Onbekende bron.")
	}
	return nil
}

// resolveChoices checks every choice and makes the categories of the create
// choices, in the caller's transaction. Two create choices for the same new
// category (the same name, parent and type) share it, which "per
// hoofdcategorie" needs.
func resolveChoices(ctx context.Context, tx *sql.Tx, plan *CategoryPlan) (resolved, error) {
	if len(plan.Choices) > importers.MaxCategoryPairs {
		return nil, apperr.Invalid("Te veel categorieën om te koppelen.")
	}
	out := resolved{}
	made := map[string]int64{}
	for _, c := range plan.Choices {
		pair := [2]string{c.Category, c.Subcategory}
		if _, dup := out[pair]; dup {
			return nil, apperr.Invalid("Een bronscategorie komt twee keer voor.")
		}
		switch c.Action {
		case ActionSkip:
			out[pair] = 0
		case ActionMap:
			if err := categoryExists(ctx, tx, c.CategoryID); err != nil {
				return nil, err
			}
			out[pair] = c.CategoryID
		case ActionCreate:
			n := c.New
			if n == nil {
				return nil, apperr.Invalid("Geef de nieuwe categorie een naam.")
			}
			var parent int64
			if n.ParentID != nil {
				parent = *n.ParentID
			}
			key := fmt.Sprintf("%s|%s|%d", strings.ToLower(strings.Join(strings.Fields(n.Name), " ")), n.Type, parent)
			id, ok := made[key]
			if !ok {
				in := CategoryInput{Name: Opt[string]{Set: true, V: n.Name}, Icon: Opt[string]{Set: true, V: n.Icon}}
				if n.ParentID != nil {
					in.ParentID = Opt[int64]{Set: true, V: parent}
				} else {
					in.Type = Opt[string]{Set: true, V: cmp.Or(n.Type, "expense")}
					in.Colour = Opt[string]{Set: n.Colour != "", V: n.Colour}
				}
				var err error
				if id, err = createCategoryIn(ctx, tx, in); err != nil {
					return nil, err
				}
				made[key] = id
			}
			out[pair] = id
		default:
			return nil, apperr.Invalid("Onbekende keuze voor een bronscategorie.")
		}
	}
	return out, nil
}

// saveMappings upserts the resolved pairs as the viewer's mapping for a
// source; pairs it does not name are kept.
func saveMappings(ctx context.Context, tx *sql.Tx, viewer int64, source string, targets resolved) error {
	for pair, id := range targets {
		if _, err := tx.ExecContext(ctx, `INSERT INTO category_mappings (user_id, source, source_category, source_subcategory, category_id)
			VALUES (?1, ?2, ?3, ?4, ?5)
			ON CONFLICT (user_id, source, source_category, source_subcategory)
			DO UPDATE SET category_id = excluded.category_id, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
			viewer, source, pair[0], pair[1], nullIfZero(id)); err != nil {
			return err
		}
	}
	return nil
}

// Mappings lists the viewer's saved mapping for a source.
func (s *Store) Mappings(ctx context.Context, viewer int64, source string) ([]SavedMapping, error) {
	if err := validSource(source); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT source_category, source_subcategory, category_id FROM category_mappings
		WHERE user_id = ? AND source = ? ORDER BY source_category, source_subcategory`, viewer, source)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []SavedMapping{}
	for rows.Next() {
		var m SavedMapping
		if err := rows.Scan(&m.Category, &m.Subcategory, &m.CategoryID); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, rows.Err()
}

// PutMappings saves entries as the viewer's mapping for a source (upsert per
// pair; other saved pairs stay) and returns the whole mapping. Targets must
// exist; null is "leave uncategorised".
func (s *Store) PutMappings(ctx context.Context, viewer int64, source string, entries []SavedMapping) ([]SavedMapping, error) {
	if err := validSource(source); err != nil {
		return nil, err
	}
	if len(entries) > importers.MaxCategoryPairs {
		return nil, apperr.Invalid("Te veel categorieën om te koppelen.")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	targets := resolved{}
	for _, e := range entries {
		pair := [2]string{e.Category, e.Subcategory}
		if _, dup := targets[pair]; dup {
			return nil, apperr.Invalid("Een bronscategorie komt twee keer voor.")
		}
		targets[pair] = 0
		if e.CategoryID != nil {
			if err := categoryExists(ctx, tx, *e.CategoryID); err != nil {
				return nil, err
			}
			targets[pair] = *e.CategoryID
		}
	}
	if err := saveMappings(ctx, tx, viewer, source, targets); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.Mappings(ctx, viewer, source)
}

// ReapplyCategories rewrites the category of the rows of an import batch
// from the viewer's saved mapping of the batch's source, and returns how many
// rows changed. Only rows the import itself categorised (origin "import") or
// left uncategorised (no category, no origin: a skipped pair) are touched,
// never a manual, rule or suggestion category, nor a split row; a pair the
// mapping lacks keeps its rows as they are. A pair now left uncategorised
// clears the row's category and origin. The batch's account needs edit
// permission (hidden 404, read-only 403). One database transaction.
func (s *Store) ReapplyCategories(ctx context.Context, viewer, batchID int64) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var account int64
	var source string
	err = tx.QueryRowContext(ctx, `SELECT account_id, source FROM import_batches WHERE id = ?`, batchID).Scan(&account, &source)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, apperr.ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	a, err := accessOf(ctx, tx, viewer, account)
	if err != nil {
		return 0, err
	}
	if a.permission != "edit" {
		return 0, apperr.ErrForbidden
	}
	res, err := tx.ExecContext(ctx, `UPDATE transactions SET category_id = m.category_id,
		    category_origin = CASE WHEN m.category_id IS NULL THEN NULL ELSE 'import' END
		FROM category_mappings m
		WHERE m.user_id = ?1 AND m.source = ?2 AND transactions.import_batch_id = ?3
		  AND m.source_category = transactions.import_category AND m.source_subcategory = transactions.import_subcategory
		  AND (transactions.category_origin = 'import' OR (transactions.category_origin IS NULL AND transactions.category_id IS NULL))
		  AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = transactions.id)
		  AND transactions.category_id IS NOT m.category_id`, viewer, source, batchID)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	return int(n), tx.Commit()
}
