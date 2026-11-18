-- Saving categories (0.8-0a): a top expense category can count as saved
-- ("Telt als gespaard"). Only a top category of type expense stores 1; a
-- subcategory inherits its parent's value and always stores 0. Additive, so an
-- older binary on a restored backup ignores it.
ALTER TABLE categories ADD COLUMN saving INTEGER NOT NULL DEFAULT 0 CHECK (saving IN (0, 1));
