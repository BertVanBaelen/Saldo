-- Category icons (CAT-6): every category may carry the name of an icon from
-- the fixed list in categorise/icons.go. Only a column is added, so no row
-- changes and nothing can be lost. The default tree of an existing install
-- gets its icons here (matched on the seeded name and parent name, only where
-- no icon is set); a category the user renamed stays NULL and the app shows
-- the generic tag icon.
ALTER TABLE categories ADD COLUMN icon TEXT;

WITH m(parent, name, icon) AS (VALUES
        (NULL, 'Wonen', 'home'), ('Wonen', 'Huur', 'home'), ('Wonen', 'Energie', 'bolt'),
        ('Wonen', 'Internet en tv', 'wifi'), ('Wonen', 'Verzekeringen', 'shield'),
        (NULL, 'Boodschappen', 'cart'), ('Boodschappen', 'Supermarkt', 'cart'), ('Boodschappen', 'Bakker', 'food'),
        (NULL, 'Vrije tijd', 'ticket'), ('Vrije tijd', 'Uitgaan', 'beer'), ('Vrije tijd', 'Sport', 'sport'),
        ('Vrije tijd', 'Cultuur', 'film'), ('Vrije tijd', 'Vakantie', 'plane'),
        (NULL, 'Vervoer', 'car'), ('Vervoer', 'Brandstof', 'fuel'), ('Vervoer', 'Openbaar vervoer', 'bus'),
        ('Vervoer', 'Onderhoud', 'wrench'),
        (NULL, 'Abonnementen', 'repeat'), ('Abonnementen', 'Streaming', 'tv'), ('Abonnementen', 'Telefoon', 'phone'),
        (NULL, 'Overig', 'dots'), (NULL, 'Salaris', 'salary'), (NULL, 'Terugbetaling', 'refund'),
        (NULL, 'Bijdrage', 'piggy'), (NULL, 'Overig inkomen', 'wallet')
    )
UPDATE categories SET icon = (
    SELECT m.icon FROM m
    WHERE m.name = categories.name AND m.parent IS (SELECT p.name FROM categories p WHERE p.id = categories.parent_id))
WHERE icon IS NULL;
