-- Suggestions (phase 0.4-4): a user's decision on a suggestion (confirmed or
-- dismissed) is stored once per user, counterparty key and category. Open
-- suggestions are computed and never stored. No code wrote this table
-- before, but any duplicates are merged first, keeping the lowest id, so the
-- unique index can be built on a populated database.
DELETE FROM category_suggestions
WHERE user_id IS NOT NULL
  AND id NOT IN (SELECT MIN(id) FROM category_suggestions WHERE user_id IS NOT NULL
                 GROUP BY user_id, counterparty_key, category_id);
CREATE UNIQUE INDEX category_suggestions_user_key ON category_suggestions (user_id, counterparty_key, category_id)
    WHERE user_id IS NOT NULL;
