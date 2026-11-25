-- The category of a recurring item (0.9.1-3). An expense item points at an expense category (a top one or a
-- subcategory, rolled up to its top by whoever reads it) that is not saving; a saving item at a saving category.
-- Written by ledger (CreateItem, UpdateItem and the category lifecycle in categories.go); NULL is "Zonder
-- categorie", which counts in no budget. Deleting the category sets it back to NULL. Additive: every existing
-- item has none, and the forecast does not read it yet.
ALTER TABLE recurring_items ADD COLUMN category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL;
