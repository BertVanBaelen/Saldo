-- Category tint (0.5.1-3): the API colour of a category is c1..c16, soft or a
-- custom #rrggbb, but categories.colour has a CHECK list that only a table
-- rebuild can widen, and a rebuild with foreign keys on would cascade-delete
-- rules, splits, budgets and mappings. So this only adds a nullable column:
-- tint holds a c7..c16 key or a hex, and then colour is 'c6' as a placeholder.
-- Every read uses COALESCE(tint, colour). Existing rows keep their colour and
-- get tint NULL.
-- shortcut: two columns, widen the CHECK with a table rebuild in 1.0-3 and drop tint.
ALTER TABLE categories ADD COLUMN tint TEXT;
