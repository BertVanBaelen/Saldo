-- Category mapping (phase 0.5-3). category_mappings of 0001 was one global
-- table keyed on one joined source string; no code ever wrote it (the same
-- precedent as 0006), so it is rebuilt without copying: per user and source,
-- the source category in two parts (never one joined string: names hold
-- commas, ampersands and " / "), and a target that is NULL for "leave
-- uncategorised" (also what removing the target without a move leaves).
DROP TABLE category_mappings;
CREATE TABLE category_mappings (
    id                 INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    source             TEXT    NOT NULL,
    source_category    TEXT    NOT NULL,
    source_subcategory TEXT    NOT NULL,
    category_id        INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (user_id, source, source_category, source_subcategory)
);
CREATE INDEX category_mappings_category ON category_mappings (category_id);

-- The two parts of the file's category on an imported row (NULL for rows that
-- did not come from a file with category columns), so a changed mapping can be
-- re-applied to a batch. Only a column is added: no row changes.
ALTER TABLE transactions ADD COLUMN import_category TEXT;
ALTER TABLE transactions ADD COLUMN import_subcategory TEXT;
