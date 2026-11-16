// The category icon: one emoji, picked from the grid below or typed/pasted. The server stores it as a string (docs/api.md, "Categories").

/** Drawn for a category without an icon. */
export const DEFAULT_EMOJI = '🏷️';

/** The emoji to draw: the stored value, or the default for `null`, `undefined` and an empty string. */
export function categoryEmoji(icon: string | null | undefined): string {
  return icon ? icon : DEFAULT_EMOJI;
}

/** The same emoji with or without the variation selector (U+FE0F), which some keyboards add and others leave out. */
export function sameEmoji(a: string | null | undefined, b: string | null | undefined): boolean {
  const bare = (s: string | null | undefined) => (s ?? '').replace(/️/g, '');
  return bare(a) === bare(b);
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const isPictogram = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/** The trimmed text when it is exactly one emoji (a ZWJ family, a flag and a keycap count as one), else `null`. */
export function oneEmoji(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let n = 0;
  for (const _ of segmenter.segment(t)) if (++n > 1) return null;
  return isPictogram.test(t) ? t : null;
}

/** The last emoji of the text when it ends in one ("🏠🙂" gives "🙂"): on a phone a second emoji is appended to a filled field, and the newest one wins. */
export function lastEmoji(text: string): string | null {
  let last = '';
  for (const part of segmenter.segment(text.trim())) last = part.segment;
  return oneEmoji(last);
}

export interface EmojiEntry {
  emoji: string;
  /** Dutch name, for aria-label and title. */
  label: string;
  /** Dutch search words, space separated. */
  words: string;
}

export interface EmojiGroup {
  title: string;
  items: EmojiEntry[];
}

const e = (emoji: string, label: string, words = ''): EmojiEntry => ({ emoji, label, words });

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    title: 'Geld en rekeningen',
    items: [
      e('💶', 'Euro', 'geld munt cash'),
      e('💰', 'Geldzak', 'geld spaargeld rijk'),
      e('💳', 'Bankkaart', 'kaart betaalkaart krediet pin'),
      e('🏦', 'Bank', 'rekening'),
      e('🏧', 'Geldautomaat', 'pinautomaat geldopname'),
      e('👛', 'Portemonnee', 'beurs'),
      e('🐷', 'Spaarvarken', 'sparen spaarpot varken'),
      e('🧾', 'Kasticket', 'bon factuur'),
      e('🛡️', 'Verzekering', 'schild bescherming'),
      e('🏛️', 'Belasting', 'overheid fiscus gemeente'),
      e('💼', 'Loon', 'salaris werk inkomen'),
      e('↩️', 'Terugbetaling', 'terug refund'),
      e('🔁', 'Terugkerend', 'herhaling abonnement domiciliering'),
      e('📈', 'Beleggen', 'aandelen groei winst'),
      e('📉', 'Verlies', 'daling'),
      e('🪙', 'Munt', 'cent kleingeld'),
      e('💸', 'Uitgave', 'geld weg betaling'),
      e('💵', 'Biljet', 'cash contant'),
      e('🧮', 'Boekhouding', 'rekenen rekenmachine'),
      e('📜', 'Contract', 'papier overeenkomst'),
    ],
  },
  {
    title: 'Wonen',
    items: [
      e('🏠', 'Huis', 'wonen thuis huur hypotheek'),
      e('🏡', 'Huis met tuin', 'woning'),
      e('🏢', 'Appartement', 'flat gebouw'),
      e('🔑', 'Sleutel', 'huur verhuur'),
      e('🛋️', 'Zetel', 'meubels bank sofa'),
      e('🛏️', 'Bed', 'slaapkamer matras'),
      e('🚿', 'Douche', 'badkamer'),
      e('🛁', 'Bad', 'badkamer'),
      e('🧹', 'Schoonmaak', 'poetsen bezem poetshulp'),
      e('🧺', 'Wasmand', 'was wassen'),
      e('🪴', 'Plant', 'kamerplant'),
      e('🌳', 'Tuin', 'boom natuur'),
      e('🔨', 'Klussen', 'hamer bouwen verbouwen'),
      e('🔧', 'Herstelling', 'moersleutel reparatie'),
      e('🪜', 'Ladder', 'klus'),
      e('🧰', 'Gereedschap', 'toolbox'),
      e('💡', 'Verlichting', 'lamp licht'),
      e('⚡', 'Elektriciteit', 'stroom energie'),
      e('💧', 'Water', 'waterfactuur'),
      e('🔥', 'Verwarming', 'gas stookolie mazout'),
      e('📶', 'Internet', 'wifi'),
      e('📺', 'Televisie', 'tv kabel streaming'),
      e('🗑️', 'Afval', 'vuilnis containerpark'),
      e('🪟', 'Raam', 'ramen glas'),
      e('🚪', 'Deur', 'poort'),
    ],
  },
  {
    title: 'Eten en drinken',
    items: [
      e('🍽️', 'Eten', 'restaurant maaltijd'),
      e('🍕', 'Pizza', 'afhaal'),
      e('🍔', 'Hamburger', 'fastfood'),
      e('🍟', 'Frietjes', 'frieten friet frituur'),
      e('🍝', 'Pasta', 'spaghetti'),
      e('🍣', 'Sushi', 'japans'),
      e('🥗', 'Salade', 'gezond'),
      e('🥪', 'Broodje', 'lunch sandwich'),
      e('🍳', 'Ontbijt', 'ei'),
      e('🥐', 'Croissant', 'koffiekoek bakker'),
      e('🍞', 'Brood', 'bakker'),
      e('🧇', 'Wafel', 'pannenkoek'),
      e('🍰', 'Taart', 'gebak dessert'),
      e('🍦', 'Ijsje', 'ijs'),
      e('🍫', 'Chocolade', 'snoep'),
      e('☕', 'Koffie', 'café'),
      e('🍵', 'Thee', 'drank'),
      e('🍺', 'Bier', 'drank café pint'),
      e('🍷', 'Wijn', 'drank'),
      e('🍸', 'Cocktail', 'drank uitgaan'),
      e('🥤', 'Frisdrank', 'drank'),
      e('🍾', 'Champagne', 'feest drank'),
      e('🥡', 'Afhaalmaaltijd', 'afhalen takeaway'),
    ],
  },
  {
    title: 'Boodschappen',
    items: [
      e('🛒', 'Winkelwagen', 'boodschappen supermarkt'),
      e('🥦', 'Groenten', 'groente'),
      e('🍎', 'Fruit', 'appel'),
      e('🥩', 'Vlees', 'slager'),
      e('🐟', 'Vis', 'visboer'),
      e('🧀', 'Kaas', 'zuivel'),
      e('🥛', 'Melk', 'zuivel'),
      e('🥚', 'Eieren', 'ei'),
      e('🥖', 'Stokbrood', 'baguette'),
      e('🏪', 'Buurtwinkel', 'nachtwinkel'),
      e('🛍️', 'Winkelen', 'shoppen'),
      e('🧴', 'Verzorging', 'shampoo drogisterij'),
      e('🧼', 'Zeep', 'wasmiddel'),
      e('🧻', 'Toiletpapier', 'wc papier'),
      e('👕', 'Kleding', 'shirt kledij'),
      e('👗', 'Jurk', 'kleding'),
      e('🧥', 'Jas', 'kleding'),
      e('👟', 'Schoenen', 'sneakers'),
      e('👜', 'Tas', 'handtas'),
      e('💍', 'Juweel', 'ring juwelen'),
    ],
  },
  {
    title: 'Vervoer',
    items: [
      e('🚗', 'Auto', 'wagen'),
      e('⛽', 'Brandstof', 'benzine diesel tanken'),
      e('🅿️', 'Parkeren', 'parking'),
      e('🚌', 'Bus', 'de lijn'),
      e('🚆', 'Trein', 'nmbs spoor'),
      e('🚇', 'Metro', 'ondergrondse'),
      e('🚋', 'Tram', 'openbaar vervoer'),
      e('🚕', 'Taxi', 'uber'),
      e('🚲', 'Fiets', 'rijwiel'),
      e('🛴', 'Step', 'autoped'),
      e('🛵', 'Scooter', 'bromfiets'),
      e('🏍️', 'Motor', 'motorfiets'),
      e('🛞', 'Banden', 'wiel'),
      e('🛠️', 'Garage', 'onderhoud keuring'),
      e('🔋', 'Batterij', 'accu'),
      e('🔌', 'Stekker', 'laden elektrisch laadpaal'),
      e('🚦', 'Verkeer', 'boete verkeerslicht'),
      e('🚧', 'Wegenwerken', 'tol'),
    ],
  },
  {
    title: 'Vrije tijd en reizen',
    items: [
      e('✈️', 'Vliegtuig', 'vliegen vakantie'),
      e('🏨', 'Overnachting', 'hotel logies'),
      e('🧳', 'Koffer', 'reis bagage'),
      e('🏖️', 'Strand', 'zee vakantie'),
      e('⛺', 'Kamperen', 'tent camping'),
      e('🗺️', 'Landkaart', 'reis uitstap'),
      e('🚢', 'Boot', 'schip cruise veerboot'),
      e('🎟️', 'Uitstap', 'ticket toegang'),
      e('🎡', 'Pretpark', 'kermis'),
      e('🎬', 'Film', 'bioscoop'),
      e('🍿', 'Popcorn', 'cinema'),
      e('🎵', 'Muziek', 'spotify'),
      e('🎧', 'Koptelefoon', 'podcast audio'),
      e('🎸', 'Gitaar', 'instrument'),
      e('🎭', 'Theater', 'toneel cultuur'),
      e('🎨', 'Knutselen', 'kunst hobby schilderen'),
      e('🎮', 'Spelletjes', 'gamen games console'),
      e('🎲', 'Gezelschapsspel', 'bordspel'),
      e('🎳', 'Bowlen', 'uitgaan'),
      e('🎣', 'Vissen', 'hengelen'),
      e('⛷️', 'Skiën', 'sneeuw wintersport'),
      e('📷', 'Foto', 'camera fotograaf'),
      e('🎁', 'Cadeau', 'geschenk'),
      e('🎉', 'Feest', 'party'),
      e('🎂', 'Verjaardag', 'taart'),
      e('🎄', 'Kerst', 'kerstmis'),
    ],
  },
  {
    title: 'Gezondheid en sport',
    items: [
      e('🏥', 'Gezondheid', 'ziekenhuis dokter'),
      e('💊', 'Medicijnen', 'apotheek pillen'),
      e('🩺', 'Huisarts', 'dokter'),
      e('🦷', 'Tandarts', 'tanden'),
      e('👓', 'Bril', 'opticien ogen'),
      e('🩹', 'Pleister', 'verzorging'),
      e('💉', 'Vaccin', 'spuit prik'),
      e('🧠', 'Psycholoog', 'therapie geest'),
      e('🧘', 'Yoga', 'meditatie ontspanning'),
      e('💆', 'Massage', 'kine kinesist wellness'),
      e('💇', 'Kapper', 'haar'),
      e('✂️', 'Schaar', 'knippen'),
      e('💅', 'Nagels', 'schoonheid'),
      e('🏋️', 'Sport', 'fitness gym'),
      e('⚽', 'Voetbal', 'club'),
      e('🎾', 'Tennis', 'padel'),
      e('🏀', 'Basketbal', 'bal'),
      e('🏊', 'Zwemmen', 'zwembad'),
      e('🏃', 'Lopen', 'joggen running'),
      e('🚴', 'Wielrennen', 'fietsen'),
      e('🥾', 'Wandelen', 'stappen'),
      e('❤️', 'Hart', 'liefde gezond'),
    ],
  },
  {
    title: 'Kinderen en dieren',
    items: [
      e('🧒', 'Kinderen', 'kind kids'),
      e('👶', 'Baby', 'luiers'),
      e('🍼', 'Zuigfles', 'babyvoeding'),
      e('🧸', 'Speelgoed', 'knuffel'),
      e('🧩', 'Puzzel', 'spel'),
      e('🛝', 'Speeltuin', 'glijbaan'),
      e('🎒', 'Schooltas', 'boekentas'),
      e('👨‍👩‍👧', 'Gezin', 'familie ouders'),
      e('🐾', 'Huisdier', 'dier pootafdruk'),
      e('🐶', 'Hond', 'dierenarts'),
      e('🐱', 'Kat', 'poes'),
      e('🐰', 'Konijn', 'dier'),
      e('🐹', 'Hamster', 'knaagdier'),
      e('🐦', 'Vogel', 'dier'),
      e('🐠', 'Aquarium', 'vissen'),
      e('🐴', 'Paard', 'manege'),
      e('🐢', 'Schildpad', 'dier'),
      e('🦴', 'Bot', 'hondenvoer'),
    ],
  },
  {
    title: 'Werk en school',
    items: [
      e('🎓', 'School', 'diploma studie opleiding'),
      e('🏫', 'Schoolgebouw', 'onderwijs'),
      e('🧑‍🎓', 'Student', 'studeren'),
      e('🧑‍🏫', 'Leraar', 'les cursus'),
      e('📚', 'Boeken', 'lezen bibliotheek'),
      e('📖', 'Lezen', 'boek'),
      e('✏️', 'Potlood', 'schrijven'),
      e('📝', 'Notities', 'schrift'),
      e('💻', 'Computer', 'laptop pc'),
      e('🖥️', 'Beeldscherm', 'monitor'),
      e('🖨️', 'Printer', 'afdrukken'),
      e('📱', 'Telefoon', 'gsm smartphone abonnement'),
      e('📎', 'Kantoor', 'paperclip'),
      e('✉️', 'Brief', 'post postzegel'),
      e('📊', 'Grafiek', 'cijfers'),
      e('📅', 'Agenda', 'kalender'),
      e('🔬', 'Wetenschap', 'onderzoek'),
      e('🧑‍💼', 'Werk', 'kantoorwerker baan'),
    ],
  },
  {
    title: 'Diversen',
    items: [
      e('🏷️', 'Overig', 'label tag'),
      e('📦', 'Diversen', 'pakket doos bestelling'),
      e('⭐', 'Ster', 'favoriet'),
      e('🎯', 'Doel', 'target'),
      e('🏆', 'Trofee', 'beker prijs'),
      e('🔔', 'Herinnering', 'bel melding'),
      e('🔒', 'Slot', 'veilig'),
      e('❓', 'Onbekend', 'vraagteken'),
      e('✅', 'Klaar', 'vinkje'),
      e('🌍', 'Goede doelen', 'wereld gift schenking'),
      e('🎗️', 'Lintje', 'steun'),
      e('⛪', 'Kerk', 'parochie'),
      e('🕯️', 'Kaars', 'uitvaart'),
      e('💐', 'Bloemen', 'boeket'),
      e('🌹', 'Roos', 'bloem'),
      e('🚬', 'Roken', 'sigaretten tabak'),
      e('🎰', 'Gokken', 'loterij'),
      e('🇧🇪', 'België', 'vlag'),
      e('🇳🇱', 'Nederland', 'vlag'),
      e('🇪🇺', 'Europa', 'vlag eu'),
    ],
  },
];

export const ALL_EMOJI: EmojiEntry[] = EMOJI_GROUPS.flatMap((g) => g.items);

const plain = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** The groups with only the entries whose Dutch name or search words contain the query; empty groups drop out. */
export function searchEmoji(query: string): EmojiGroup[] {
  const q = plain(query.trim());
  if (!q) return EMOJI_GROUPS;
  return EMOJI_GROUPS.map((g) => ({ title: g.title, items: g.items.filter((x) => plain(x.label + ' ' + x.words).includes(q)) })).filter((g) => g.items.length > 0);
}
