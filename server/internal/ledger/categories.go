package ledger

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

// The shared category tree (phase 0.4-1, docs/api.md "Categories"). Every
// signed-in user sees and edits the same tree of names, types, colours and icons;
// counts only ever cover the viewer's own transactions.

// Opt is a JSON field of a PATCH body: Set when present, Null when null.
type Opt[T any] struct {
	Set, Null bool
	V         T
}

// UnmarshalJSON is called only for a field that is present.
func (o *Opt[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Null = true
		return nil
	}
	return json.Unmarshal(b, &o.V)
}

// TreeCategory is one category of the tree as the API shows it.
type TreeCategory struct {
	ID       int64   `json:"id"`
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Colour   string  `json:"colour"`
	ParentID *int64  `json:"parentId"`
	Icon     *string `json:"icon"`
	Count    int     `json:"count"`
	// Saving is the effective "Telt als gespaard" (0.8-0a): a subcategory
	// shows its parent's value.
	Saving bool `json:"saving"`
	order  int
}

// CategoryInput is the body of POST and PATCH /api/categories.
type CategoryInput struct {
	Name     Opt[string] `json:"name"`
	Type     Opt[string] `json:"type"`
	Colour   Opt[string] `json:"colour"`
	ParentID Opt[int64]  `json:"parentId"`
	Icon     Opt[string] `json:"icon"`
	Saving   Opt[bool]   `json:"saving"`
}

const maxCategoryName = 60

// paletteColours are the 16 pastels of a category (c1..c16); income tops also
// take "soft", and any top takes a custom #rrggbb.
var paletteColours = []string{"c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12", "c13", "c14", "c15", "c16"}

var hexColour = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// legacyColour tells whether a colour fits the CHECK list of categories.colour.
func legacyColour(v string) bool {
	switch v {
	case "c1", "c2", "c3", "c4", "c5", "c6", "soft":
		return true
	}
	return false
}

// colourColumns splits an API colour (the effective colour: c1..c16, soft or a
// lowercase #rrggbb) into the two stored columns. A legacy key is stored as
// colour with no tint; c7..c16 and a hex are stored as tint with colour 'c6'
// as placeholder. Every write of a category colour goes through here, so the
// two columns never disagree.
// shortcut: two columns because the CHECK on colour cannot be widened without
// a table rebuild (foreign keys would cascade-delete rules and splits),
// rebuild in 1.0-3 and drop tint.
func colourColumns(v string) (colour string, tint *string) {
	if legacyColour(v) {
		return v, nil
	}
	return "c6", &v
}

// effectiveColour is the SQL expression of the colour the API shows, for the
// categories table under alias ("" for none). Every read of a category colour
// uses it: a missed read shows a tinted category as the c6 placeholder.
func effectiveColour(alias string) string {
	if alias != "" {
		alias += "."
	}
	return "COALESCE(" + alias + "tint, " + alias + "colour)"
}

// Categories lists the tree in tree order: the expense tops, each followed by
// its subcategories, then the income tops likewise. Count is the number of
// the viewer's own transactions directly in a category: a split row counts
// once under each category it has a part in, not under its own (hidden)
// category.
func (s *Store) Categories(ctx context.Context, viewer int64) ([]TreeCategory, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT c.id, c.name, c.type, `+effectiveColour("c")+`, c.parent_id, c.sort_order, c.icon,
		       (SELECT COUNT(*) FROM transactions t JOIN account_access me ON me.account_id = t.account_id AND me.user_id = ?1
		        WHERE t.category_id = c.id AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id))
		     + (SELECT COUNT(DISTINCT s.transaction_id) FROM transaction_splits s
		        JOIN transactions t ON t.id = s.transaction_id
		        JOIN account_access me ON me.account_id = t.account_id AND me.user_id = ?1
		        WHERE s.category_id = c.id),
		       COALESCE((SELECT p.saving FROM categories p WHERE p.id = c.parent_id), c.saving)
		FROM categories c`, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var all []TreeCategory
	for rows.Next() {
		var c TreeCategory
		if err := rows.Scan(&c.ID, &c.Name, &c.Type, &c.Colour, &c.ParentID, &c.order, &c.Icon, &c.Count, &c.Saving); err != nil {
			return nil, err
		}
		all = append(all, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slices.SortFunc(all, func(a, b TreeCategory) int {
		return cmp.Or(cmp.Compare(a.Type, b.Type), cmp.Compare(a.order, b.order), cmp.Compare(a.ID, b.ID))
	})
	list := []TreeCategory{}
	for _, top := range all {
		if top.ParentID != nil {
			continue
		}
		list = append(list, top)
		for _, sub := range all {
			if sub.ParentID != nil && *sub.ParentID == top.ID {
				list = append(list, sub)
			}
		}
	}
	return list, nil
}

func (s *Store) category(ctx context.Context, viewer, id int64) (TreeCategory, error) {
	list, err := s.Categories(ctx, viewer)
	if err != nil {
		return TreeCategory{}, err
	}
	for _, c := range list {
		if c.ID == id {
			return c, nil
		}
	}
	return TreeCategory{}, apperr.ErrNotFound
}

// cleanName trims a name and collapses its white space. Punctuation such as
// commas and ampersands is plain data ("Energie, nutsvoorzieningen").
func cleanName(raw string) (string, error) {
	if strings.ContainsFunc(raw, unicode.IsControl) {
		return "", apperr.Invalid("Een naam mag geen stuurtekens bevatten.")
	}
	name := strings.Join(strings.Fields(raw), " ")
	if name == "" {
		return "", apperr.Invalid("Geef de categorie een naam.")
	}
	if utf8.RuneCountInString(name) > maxCategoryName {
		return "", apperr.Invalid("Een naam heeft hoogstens 60 tekens.")
	}
	return name, nil
}

// stored is a category row as the write paths need it.
type stored struct {
	id       int64
	name     string
	parent   *int64
	typ      string
	colour   string
	icon     *string
	saving   bool // as stored: only a top expense category stores true
	children int
}

func loadCategory(ctx context.Context, tx *sql.Tx, id int64) (stored, error) {
	var c stored
	err := tx.QueryRowContext(ctx, `SELECT id, name, parent_id, type, `+effectiveColour("c")+`, icon, saving,
		(SELECT COUNT(*) FROM categories k WHERE k.parent_id = c.id) FROM categories c WHERE id = ?`, id).
		Scan(&c.id, &c.name, &c.parent, &c.typ, &c.colour, &c.icon, &c.saving, &c.children)
	if errors.Is(err, sql.ErrNoRows) {
		return c, apperr.ErrNotFound
	}
	return c, err
}

// place resolves the parent of a category: it must exist and be top-level.
func place(ctx context.Context, tx *sql.Tx, parentID, self int64) (stored, error) {
	p, err := loadCategory(ctx, tx, parentID)
	if errors.Is(err, apperr.ErrNotFound) {
		return p, apperr.Invalid("Die hoofdcategorie bestaat niet.")
	}
	if err != nil {
		return p, err
	}
	if p.id == self {
		return p, apperr.Invalid("Een categorie kan niet onder zichzelf staan.")
	}
	if p.parent != nil {
		return p, apperr.Invalid("Saldo heeft twee niveaus: kies een hoofdcategorie als plaats.")
	}
	return p, nil
}

// unique refuses a name that its parent already has (case-insensitive, as
// the unique index categories_name).
func unique(ctx context.Context, tx *sql.Tx, name string, parent *int64, self int64) error {
	var taken bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM categories
		WHERE COALESCE(parent_id, 0) = COALESCE(?, 0) AND name = ? COLLATE NOCASE AND id <> ?)`, parent, name, self).Scan(&taken); err != nil {
		return err
	}
	if taken {
		return apperr.Invalid("Er is al een categorie ‘" + name + "’ op die plaats.")
	}
	return nil
}

// iconOf checks the icon of a create or change body: one emoji, or null or ""
// for none. Not sent on a change means unchanged (the caller).
func iconOf(in Opt[string]) (*string, error) {
	v := strings.TrimSpace(in.V)
	if in.Null || v == "" {
		return nil, nil
	}
	if !categorise.ValidIcon(v) {
		return nil, apperr.Invalid("Kies een icoon uit de lijst.")
	}
	return &v, nil
}

// topColour checks the colour of a top category of a type ("" = default) and
// returns it normalised (hex in lower case). Any top takes c1..c16 or a
// #rrggbb; "soft" is the income green and only income tops take it.
func topColour(typ, colour string) (string, error) {
	switch {
	case colour == "" && typ == "income":
		return "soft", nil
	case colour == "":
		return "c6", nil
	case colour == "soft" && typ == "income", slices.Contains(paletteColours, colour):
		return colour, nil
	case hexColour.MatchString(colour):
		return strings.ToLower(colour), nil
	}
	return "", apperr.Invalid("Kies een kleur uit het palet of een eigen kleur (#rrggbb).")
}

// savingOf checks "Telt als gespaard" for a category that ends up with parent
// and type: only a top expense category takes true; false is always fine.
func savingOf(in Opt[bool], parent *int64, typ string) (bool, error) {
	if !in.V || in.Null {
		return false, nil
	}
	if parent != nil {
		return false, apperr.Invalid("Een subcategorie telt mee via haar hoofdcategorie.")
	}
	if typ == "income" {
		return false, apperr.Invalid("Een inkomstencategorie kan niet als gespaard tellen.")
	}
	return true, nil
}

func validType(t string) error {
	if t != "expense" && t != "income" {
		return apperr.Invalid("Kies Uitgaven of Inkomsten.")
	}
	return nil
}

// CreateCategory adds a top category ({name, type, colour}) or a
// subcategory ({name, parentId}) that takes its parent's type and colour.
func (s *Store) CreateCategory(ctx context.Context, viewer int64, in CategoryInput) (TreeCategory, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return TreeCategory{}, err
	}
	defer tx.Rollback()
	id, err := createCategoryIn(ctx, tx, in)
	if err != nil {
		return TreeCategory{}, err
	}
	if err := tx.Commit(); err != nil {
		return TreeCategory{}, err
	}
	return s.category(ctx, viewer, id)
}

// createCategoryIn is the body of CreateCategory inside the caller's
// transaction (the import creates categories in its own), returning the new id.
func createCategoryIn(ctx context.Context, tx *sql.Tx, in CategoryInput) (int64, error) {
	name, err := cleanName(in.Name.V)
	if err != nil {
		return 0, err
	}
	icon, err := iconOf(in.Icon)
	if err != nil {
		return 0, err
	}
	var parent *int64
	var typ, colour string
	if in.ParentID.Set && !in.ParentID.Null {
		if in.Type.Set || in.Colour.Set {
			return 0, apperr.Invalid("Een subcategorie krijgt het type en de kleur van haar hoofdcategorie.")
		}
		p, err := place(ctx, tx, in.ParentID.V, 0)
		if err != nil {
			return 0, err
		}
		parent, typ, colour = &p.id, p.typ, p.colour
	} else {
		typ = in.Type.V
		if err := validType(typ); err != nil {
			return 0, err
		}
		if colour, err = topColour(typ, in.Colour.V); err != nil {
			return 0, err
		}
	}
	saving, err := savingOf(in.Saving, parent, typ)
	if err != nil {
		return 0, err
	}
	if err := unique(ctx, tx, name, parent, 0); err != nil {
		return 0, err
	}
	var id int64
	col, tint := colourColumns(colour)
	err = tx.QueryRowContext(ctx, `INSERT INTO categories (name, parent_id, type, colour, tint, icon, saving, sort_order)
		VALUES (?1, ?2, ?3, ?4, ?6, ?5, ?7, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE parent_id IS ?2))
		RETURNING id`, name, parent, typ, col, icon, tint, saving).Scan(&id)
	return id, err
}

// UpdateCategory renames, moves, retypes, recolours, re-icons or flags
// ("Telt als gespaard", 0.8-0a) a category. Moving under a parent adopts its
// type, colour and saving flag (a subcategory stores no flag of its own);
// recolouring a top category recolours its subcategories. A category with
// subcategories cannot move under another one, nor change its type. A saving
// or income category has no budget: moving a top category under another one,
// turning it income or making it count as saved (itself or through a new
// parent) deletes its budget rows, and its subcategories' when it is flagged.
func (s *Store) UpdateCategory(ctx context.Context, viewer, id int64, in CategoryInput) (TreeCategory, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return TreeCategory{}, err
	}
	defer tx.Rollback()
	c, err := loadCategory(ctx, tx, id)
	if err != nil {
		return TreeCategory{}, err
	}
	name := c.name
	if in.Name.Set {
		if name, err = cleanName(in.Name.V); err != nil {
			return TreeCategory{}, err
		}
	}
	icon := c.icon
	if in.Icon.Set {
		if icon, err = iconOf(in.Icon); err != nil {
			return TreeCategory{}, err
		}
	}
	parent, typ, colour := c.parent, c.typ, c.colour
	parentSaving := false // the category moves under a saving parent
	toTop := in.ParentID.Set && in.ParentID.Null
	if in.ParentID.Set && !toTop {
		if c.children > 0 {
			return TreeCategory{}, apperr.Invalid("Verplaats eerst de subcategorieën. Saldo heeft twee niveaus.")
		}
		p, err := place(ctx, tx, in.ParentID.V, id)
		if err != nil {
			return TreeCategory{}, err
		}
		parent, typ, colour = &p.id, p.typ, p.colour
		parentSaving = p.saving && (c.parent == nil || *c.parent != p.id)
	}
	if toTop {
		parent = nil
	}
	if in.Type.Set && in.Type.V != typ {
		if parent != nil || c.children > 0 {
			return TreeCategory{}, apperr.Invalid("Alleen een hoofdcategorie zonder subcategorieën kan van type veranderen.")
		}
		if err := validType(in.Type.V); err != nil {
			return TreeCategory{}, err
		}
		typ, colour = in.Type.V, "" // the default colour of the new type
	}
	if in.Colour.Set {
		if parent != nil {
			return TreeCategory{}, apperr.Invalid("Een subcategorie krijgt de kleur van haar hoofdcategorie.")
		}
		colour = in.Colour.V
	}
	if parent == nil {
		if colour, err = topColour(typ, colour); err != nil {
			return TreeCategory{}, err
		}
	}
	// The stored flag stays only while the category stays a top expense category.
	saving := c.saving && parent == nil && typ == "expense"
	if in.Saving.Set {
		if saving, err = savingOf(in.Saving, parent, typ); err != nil {
			return TreeCategory{}, err
		}
	}
	if err := unique(ctx, tx, name, parent, id); err != nil {
		return TreeCategory{}, err
	}
	moved := (parent == nil) != (c.parent == nil) || parent != nil && *parent != *c.parent
	col, tint := colourColumns(colour)
	if _, err := tx.ExecContext(ctx, `UPDATE categories SET name = ?1, parent_id = ?2, type = ?3, colour = ?4, tint = ?8, icon = ?7, saving = ?9,
		sort_order = CASE WHEN ?5 THEN (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE parent_id IS ?2 AND id <> ?6)
		                  ELSE sort_order END
		WHERE id = ?6`, name, parent, typ, col, moved, id, icon, tint, saving); err != nil {
		return TreeCategory{}, err
	}
	flagged := saving && !c.saving
	if c.parent == nil && parent != nil || typ == "income" && c.typ != "income" || flagged || parentSaving {
		if _, err := tx.ExecContext(ctx, `DELETE FROM budgets WHERE category_id = ?1
			OR (?2 AND category_id IN (SELECT id FROM categories WHERE parent_id = ?1))`, id, flagged); err != nil {
			return TreeCategory{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE categories SET type = ?, colour = ?, tint = ? WHERE parent_id = ?`, typ, col, tint, id); err != nil {
		return TreeCategory{}, err
	}
	if err := tx.Commit(); err != nil {
		return TreeCategory{}, err
	}
	return s.category(ctx, viewer, id)
}

// RemoveCategory removes a category without subcategories for everyone and
// moves what used it, of every user, to moveTo (a category of the same
// type), or with moveTo 0 leaves it uncategorised (analysis 4.2). This is
// also the merge of two categories. One database transaction.
//
// With a target: transactions keep their origin and rule, and split parts,
// rules, budgets (one per account, category and month: a clash keeps the
// target's; only to a top expense category that is not saving, else they are
// deleted), category mappings and suggestions follow. Without one:
// transactions lose category, origin and rule; the category's rules,
// budgets and suggestions are deleted and its mappings become "leave
// uncategorised"; refused when a split part uses it.
func (s *Store) RemoveCategory(ctx context.Context, id, moveTo int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	c, err := loadCategory(ctx, tx, id)
	if err != nil {
		return err
	}
	if c.children > 0 {
		return apperr.Invalid("Verwijderen kan pas als er geen subcategorieën meer onder hangen.")
	}
	var steps []string
	if moveTo == 0 {
		var split bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM transaction_splits WHERE category_id = ?)`, id).Scan(&split); err != nil {
			return err
		}
		if split {
			return apperr.Invalid("Een gesplitste transactie gebruikt deze categorie. Kies een andere categorie.")
		}
		steps = []string{
			`UPDATE transactions SET category_id = NULL, category_origin = NULL, rule_id = NULL WHERE category_id = ?1`,
			`DELETE FROM rules WHERE category_id = ?1`,
			`DELETE FROM budgets WHERE category_id = ?1`,
			`UPDATE category_mappings SET category_id = NULL WHERE category_id = ?1`,
			`DELETE FROM category_suggestions WHERE category_id = ?1`,
		}
	} else {
		t, err := loadCategory(ctx, tx, moveTo)
		switch {
		case errors.Is(err, apperr.ErrNotFound):
			return apperr.Invalid("Die categorie bestaat niet.")
		case err != nil:
			return err
		case t.id == id:
			return apperr.Invalid("Kies een andere categorie dan de categorie die je verwijdert.")
		case t.typ != c.typ:
			return apperr.Invalid("Kies een categorie van hetzelfde type.")
		}
		steps = []string{
			`UPDATE transactions SET category_id = ?2 WHERE category_id = ?1`,
			`UPDATE transaction_splits SET category_id = ?2 WHERE category_id = ?1`,
			`UPDATE rules SET category_id = ?2 WHERE category_id = ?1`,
		}
		// Budgets follow only to a top expense category that is not saving (0.8-0a); else they go.
		if t.parent == nil && t.typ == "expense" && !t.saving {
			steps = append(steps, `UPDATE OR IGNORE budgets SET category_id = ?2 WHERE category_id = ?1`)
		}
		steps = append(steps,
			`DELETE FROM budgets WHERE category_id = ?1`,
			`UPDATE category_mappings SET category_id = ?2 WHERE category_id = ?1`,
			`UPDATE OR IGNORE category_suggestions SET category_id = ?2 WHERE category_id = ?1`,
			`DELETE FROM category_suggestions WHERE category_id = ?1`,
		)
	}
	steps = append(steps, `DELETE FROM categories WHERE id = ?1`)
	for _, q := range steps {
		if _, err := tx.ExecContext(ctx, q, id, moveTo); err != nil {
			return err
		}
	}
	return tx.Commit()
}
