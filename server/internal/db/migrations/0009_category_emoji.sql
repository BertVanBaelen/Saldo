-- Category emoji (0.5.1-2): categories.icon held the name of a line icon from a
-- fixed list; it now holds one emoji. Only values change, no schema: the 49
-- old names become their emoji, and any other plain-ASCII value (a name that
-- is not on the list) is cleared so nothing invalid stays behind. A category
-- without icon (NULL) keeps none; the app draws a tag emoji for it.
WITH m(name, emoji) AS (VALUES
        ('home', '🏠'), ('cart', '🛒'), ('car', '🚗'), ('fuel', '⛽'), ('bus', '🚌'),
        ('train', '🚆'), ('bike', '🚲'), ('plane', '✈️'), ('bolt', '⚡'), ('water', '💧'),
        ('flame', '🔥'), ('wifi', '📶'), ('phone', '📱'), ('tv', '📺'), ('health', '🏥'),
        ('pill', '💊'), ('sport', '🏋️'), ('food', '🍽️'), ('coffee', '☕'), ('beer', '🍺'),
        ('gift', '🎁'), ('school', '🎓'), ('book', '📚'), ('kids', '🧒'), ('paw', '🐾'),
        ('bag', '👜'), ('shirt', '👕'), ('scissors', '✂️'), ('wrench', '🔧'), ('repeat', '🔁'),
        ('wallet', '👛'), ('salary', '💼'), ('refund', '↩️'), ('piggy', '🐷'), ('bank', '🏦'),
        ('receipt', '🧾'), ('shield', '🛡️'), ('heart', '❤️'), ('music', '🎵'), ('film', '🎬'),
        ('gamepad', '🎮'), ('camera', '📷'), ('laptop', '💻'), ('tree', '🌳'), ('ticket', '🎟️'),
        ('hotel', '🏨'), ('tax', '🏛️'), ('tag', '🏷️'), ('dots', '📦')
    )
UPDATE categories SET icon = (SELECT m.emoji FROM m WHERE m.name = categories.icon)
WHERE icon IN (SELECT name FROM m);

UPDATE categories SET icon = NULL
WHERE icon IS NOT NULL AND length(icon) = length(CAST(icon AS BLOB));
