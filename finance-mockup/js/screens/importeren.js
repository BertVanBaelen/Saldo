// Importeren: CSV import wizard (Bilance, Argenta-export, any CSV), import history with undo, saved mappings.
// Not on the design boards: derived from analysis 4.1, 4.6 and 6.3 in the style of Rekeningen and Meldingen.
// Spec: analysis/screens/importeren.md. Concepts: analysis/concepts/import.md, category.md.
// Routes (hash): '' or #start · #geschiedenis · #stap-1 … #stap-5 · #al-geimporteerd · #koppeling · #ongedaan-maken
(function (S) {
  'use strict';

  const { eur, esc, MONTHS, MONTHS_SHORT } = S.fmt;
  const icon = S.icon;
  const D = S.data;

  Object.assign(S.icons.paths, {
    arrowRight: '<path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path>',
    undo: '<path d="M9 14 4 9l5-5"></path><path d="M4 9h11a5 5 0 0 1 0 10h-3"></path>',
    merge: '<path d="M4 6h3a5 5 0 0 1 5 5 1 1 0 0 0 1 1h7"></path><path d="M4 18h3a5 5 0 0 0 5-5"></path><path d="m17 9 3 3-3 3"></path>',
    checkCircle: '<circle cx="12" cy="12" r="9"></circle><path d="m8 12 3 3 5-6"></path>'
  });

  // ---------- Small helpers ----------

  const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const plural = (n, one, many) => num(n) + ' ' + (n === 1 ? one : many);
  const dt = (s) => new Date(s + 'T12:00:00');
  const isoOf = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  const addDays = (s, n) => { const x = dt(s); x.setDate(x.getDate() + n); return isoOf(x); };
  const daysBetween = (a, b) => Math.round((dt(b) - dt(a)) / 86400000);
  const fullDate = (s) => { const x = dt(s); return x.getDate() + ' ' + MONTHS[x.getMonth()] + ' ' + x.getFullYear(); };
  const dayMonth = (s) => { const x = dt(s); return x.getDate() + ' ' + MONTHS[x.getMonth()]; };
  const shortDate = (s) => { const x = dt(s); return x.getDate() + ' ' + MONTHS_SHORT[x.getMonth()] + ' ' + x.getFullYear(); };
  // "op 15 november" or "vandaag"
  const onDay = (s) => (s === D.today ? 'vandaag' : 'op ' + (s.slice(0, 4) === D.today.slice(0, 4) ? dayMonth(s) : fullDate(s)));
  const when = (s) => (s === D.today ? 'vandaag' : (s.slice(0, 4) === D.today.slice(0, 4) ? dayMonth(s) : fullDate(s)));
  const unique = (a) => a.filter((x, i) => a.indexOf(x) === i);

  const isEmpty = () => D.demo() === 'leeg';
  const isOffline = () => D.demo() === 'offline';
  const offAttr = () => (isOffline() ? ' disabled' : '');

  // ---------- Demo data (screen-only, invented and anonymised) ----------

  const NOW = '20:41';
  // The demo file: a Bilance export of the personal current account. Bilance was used until Saldo started syncing.
  const FILE = { name: 'bilance-export.csv', size: '412 kB', rows: 2418, cols: 9, from: '2015-11-05', to: '2026-06-02' };
  const END = addDays(FILE.to, 1);
  // First synced booking date per bank-linked account (strategy=longest at the first sync on 3 June 2026).
  const SYNC_FROM = { zicht: '2025-03-03', gedeeld: '2025-03-05' };
  const AFTER_BASE = 286; // rows of the file on or after 3 March 2025

  const PRESETS = [
    { id: 'bilance', name: 'Bilance', tint: 'var(--c4)' },
    { id: 'argenta', name: 'Argenta-export', tint: 'var(--c1)', sub: 'CSV uit Argenta-online, zonder categorieën' },
    { id: 'ander', name: 'Ander CSV-bestand', tint: 'var(--c6)', sub: 'Je koppelt de kolommen zelf' }
  ];
  const presetName = (id) => (id === 'bilance' ? 'Bilance' : id === 'argenta' ? 'Argenta-export' : 'CSV-bestand');
  const srcTint = (source) => (source === 'Bilance' ? 'var(--c4)' : source === 'Argenta-export' ? 'var(--c1)' : 'var(--c6)');

  // Columns of the demo file: header, sample value of the first row, kind, default from the Bilance preset.
  const COLS = [
    { h: 'Datum', ex: '02/06/2026', kind: 'date', def: 'datum' },
    { h: 'Omschrijving', ex: 'Colruyt Laagste Prijzen', kind: 'text', def: 'tegenpartij' },
    { h: 'Rekening tegenpartij', ex: 'BE71 •••• •••• 2209', kind: 'iban', def: 'iban' },
    { h: 'Bedrag', ex: '-64,12', kind: 'amount', def: 'bedrag' },
    { h: 'Categorie', ex: 'Huishouden > Supermarkt', kind: 'cat', def: 'categorie' },
    { h: 'Rekening', ex: 'Argenta Zicht', kind: 'acc', def: 'rekening' },
    { h: 'Notitie', ex: 'Betaling Bancontact', kind: 'text', def: 'mededeling' },
    { h: 'Labels', ex: 'weekend', kind: 'text', def: 'negeren' },
    { h: 'Saldo na', ex: '1.919,30', kind: 'amount', def: 'negeren' }
  ];
  const FIELDS = [['datum', 'Datum'], ['bedrag', 'Bedrag'], ['tegenpartij', 'Tegenpartij'], ['iban', 'IBAN tegenpartij'],
    ['mededeling', 'Mededeling'], ['categorie', 'Categorie'], ['rekening', 'Rekening'], ['negeren', 'Negeren']];
  const fieldName = (id) => FIELDS.find((f) => f[0] === id)[1];
  const RAW = [
    'Datum;Omschrijving;Rekening tegenpartij;Bedrag;Categorie;Rekening;Notitie;Labels;Saldo na',
    '02/06/2026;Colruyt Laagste Prijzen;BE71 •••• •••• 2209;-64,12;Huishouden > Supermarkt;Argenta Zicht;Betaling Bancontact;;1.919,30',
    '01/06/2026;Café De Hoek;;-14,60;Ontspanning > Café;Argenta Zicht;;weekend;1.983,42'
  ];
  // Distinct values of the Rekening column in the demo file
  const FILE_ACCOUNTS = [{ name: 'Argenta Zicht', n: 2418 }];

  // Saldo's category tree (default Dutch set, shared by all users; see analysis/concepts/category.md).
  const TREE = [
    { name: 'Wonen', kids: ['Huur', 'Energie', 'Verzekeringen', 'Onderhoud'] },
    { name: 'Boodschappen', kids: ['Supermarkt', 'Bakker'] },
    { name: 'Vrije tijd', kids: ['Restaurant', 'Sport', 'Vakantie'] },
    { name: 'Vervoer', kids: ['Brandstof', 'Openbaar vervoer', 'Onderhoud auto'] },
    { name: 'Abonnementen', kids: ['Streaming', 'Telefoon en internet'] },
    { name: 'Overig', kids: ['Gezondheid', 'Kleding', 'Cadeaus'] },
    { name: 'Inkomsten', kids: ['Salaris', 'Terugbetaling'] }
  ];
  const PASTEL = { Wonen: 'var(--c1)', Boodschappen: 'var(--c2)', 'Vrije tijd': 'var(--c3)', Vervoer: 'var(--c4)', Abonnementen: 'var(--c5)' };
  const topOf = (v) => v.split('/')[0];
  const catText = (v) => (v === '__saved' ? 'Gespaard' : v.replace('/', ' › '));
  // Fill and ink of a category chip; text on a pastel is always --onPastel (Overig uses --onC6, income the green tint).
  function catInk(v) {
    const top = topOf(v);
    if (v === '__saved' || top === 'Inkomsten') return { bg: 'var(--soft)', fg: 'var(--greenText)', dot: 'var(--green)' };
    if (PASTEL[top]) return { bg: PASTEL[top], fg: 'var(--onPastel)', dot: PASTEL[top] };
    return { bg: 'var(--c6)', fg: 'var(--onC6)', dot: 'var(--dashed)' };
  }

  // Distinct values of the Categorie column (full path). `saved` = target in the saved Bilance mapping (made with
  // batch 3), `suggest` = name-similarity suggestion, `transfer` = looks like a transfer between own accounts.
  const SRC = [
    { id: 's1', parent: 'Huishouden', leaf: 'Supermarkt', n: 512, sum: -2987435, saved: 'Boodschappen/Supermarkt', suggest: 'Boodschappen/Supermarkt' },
    { id: 's2', parent: 'Huishouden', leaf: 'Bakker', n: 186, sum: -156240, saved: 'Boodschappen/Bakker', suggest: 'Boodschappen/Bakker' },
    { id: 's3', parent: 'Huishouden', leaf: 'Drogisterij', n: 64, sum: -110890, saved: 'Boodschappen/Supermarkt' },
    { id: 's4', parent: 'Wonen', leaf: 'Huur', n: 104, sum: -9880000, suggest: 'Wonen/Huur' },
    { id: 's5', parent: 'Wonen', leaf: 'Gas en elektriciteit', n: 112, sum: -1534080, saved: 'Wonen/Energie', suggest: 'Wonen' },
    { id: 's6', parent: 'Wonen', leaf: 'Water', n: 38, sum: -152760, saved: 'Wonen/Energie', suggest: 'Wonen' },
    { id: 's7', parent: 'Auto', leaf: 'Brandstof', n: 236, sum: -1428460, suggest: 'Vervoer/Brandstof' },
    { id: 's8', parent: 'Auto', leaf: 'Onderhoud', n: 21, sum: -642390, suggest: 'Vervoer/Onderhoud auto' },
    { id: 's9', parent: '', leaf: 'Openbaar vervoer', n: 74, sum: -98620, suggest: 'Vervoer/Openbaar vervoer' },
    { id: 's10', parent: 'Ontspanning', leaf: 'Restaurant', n: 168, sum: -712540, suggest: 'Vrije tijd/Restaurant' },
    { id: 's11', parent: 'Ontspanning', leaf: 'Café', n: 97, sum: -118930, saved: 'Vrije tijd/Restaurant' },
    { id: 's12', parent: 'Ontspanning', leaf: 'Reizen', n: 22, sum: -1186500 },
    { id: 's13', parent: 'Ontspanning', leaf: 'Sport', n: 58, sum: -214800, suggest: 'Vrije tijd/Sport' },
    { id: 's14', parent: 'Abonnementen', leaf: 'Streaming', n: 131, sum: -159420, saved: 'Abonnementen/Streaming', suggest: 'Abonnementen/Streaming' },
    { id: 's15', parent: 'Abonnementen', leaf: 'GSM en internet', n: 112, sum: -401260, suggest: 'Abonnementen/Telefoon en internet' },
    { id: 's16', parent: 'Gezondheid', leaf: 'Apotheek', n: 83, sum: -168215, suggest: 'Overig/Gezondheid' },
    { id: 's17', parent: 'Gezondheid', leaf: 'Dokter', n: 41, sum: -96340, suggest: 'Overig/Gezondheid' },
    { id: 's18', parent: '', leaf: 'Hobby', n: 47, sum: -186430 },
    { id: 's19', parent: 'Inkomen', leaf: 'Loon', n: 112, sum: 31248000, suggest: 'Inkomsten/Salaris' },
    { id: 's20', parent: 'Inkomen', leaf: 'Terugbetaling mutualiteit', n: 44, sum: 81460, suggest: 'Inkomsten/Terugbetaling' },
    { id: 's21', parent: 'Overboekingen', leaf: 'Spaarrekening', n: 96, sum: -1920000, transfer: true }
  ];
  const NO_CAT = { n: 60, sum: -84215 };
  const srcById = (id) => SRC.find((s) => s.id === id);
  const srcLabel = (s) => (s.parent ? s.parent + ' > ' + s.leaf : s.leaf);
  const PARENTS = [];
  SRC.forEach((s) => {
    if (!s.parent) return;
    let g = PARENTS.find((p) => p.name === s.parent);
    if (!g) PARENTS.push(g = { name: s.parent, kids: [] });
    g.kids.push(s);
  });

  // History before this session. Batch 1 (Argenta, February 2025) is where the probable duplicates come from.
  const BATCHES0 = [
    { id: 3, source: 'Bilance', file: 'bilance-gedeeld.csv', acc: 'gedeeld', date: '2026-11-15', time: '21:14', rows: 1186, imported: 1012, cutoffSkip: 162, dupSkip: 12, catApplied: 4, from: '2016-02-01', to: '2025-03-04' },
    { id: 2, source: 'Bilance', file: 'bilance-gedeeld.csv', acc: 'gedeeld', date: '2026-11-12', time: '20:30', rows: 1186, imported: 1012, cutoffSkip: 162, dupSkip: 12, catApplied: 4, from: '2016-02-01', to: '2025-03-04', undone: '2026-11-13' },
    { id: 1, source: 'Argenta-export', file: 'argenta-zicht-feb-2025.csv', acc: 'zicht', date: '2026-06-04', time: '19:02', rows: 31, imported: 31, cutoffSkip: 0, dupSkip: 0, catApplied: 0, from: '2025-02-01', to: '2025-02-28' }
  ];
  // Rows of batch 3 per saved category (to say how many transactions a re-applied mapping changes).
  const SAVED_N = { s1: 402, s2: 88, s3: 31, s5: 96, s6: 33, s11: 41, s14: 62 };

  // Probable duplicates: file row vs the existing row from batch 1. off = days between them; sCat = existing category.
  const DUPS = [
    ['2025-02-01', 'Immo De Linde', -98000, 's4', 0, 'IMMO DE LINDE BV', 'Wonen/Huur'],
    ['2025-02-01', 'Colruyt Laagste Prijzen', -6412, 's1', 1, 'COLRUYT LAAGSTE PRIJZEN', null],
    ['2025-02-03', 'Atelier Noord bv', 278450, 's19', 0, 'ATELIER NOORD BV', 'Inkomsten/Salaris'],
    ['2025-02-03', 'Bakkerij De Graankorrel', -840, 's2', 1, 'BAKKERIJ DE GRAANKORREL', null],
    ['2025-02-04', 'Spotify', -1099, 's14', 0, 'SPOTIFY AB', 'Abonnementen/Streaming'],
    ['2025-02-05', 'TotalEnergies', -5830, 's7', 1, 'TOTALENERGIES 0412', 'Vervoer/Brandstof'],
    ['2025-02-06', 'Apotheek Van Damme', -1285, 's16', 0, 'APOTHEEK VAN DAMME', null],
    ['2025-02-07', 'Delhaize', -4126, 's1', 1, 'DELHAIZE 5523', null],
    ['2025-02-08', 'Proximus', -4200, 's15', 0, 'PROXIMUS NV', 'Abonnementen/Telefoon en internet'],
    ['2025-02-08', 'Café De Hoek', -1460, 's11', 0, 'CAFE DE HOEK', null],
    ['2025-02-10', 'NMBS', -1960, 's9', 0, 'NMBS/SNCB', 'Vervoer/Openbaar vervoer'],
    ['2025-02-11', 'Colruyt Laagste Prijzen', -7248, 's1', 0, 'COLRUYT LAAGSTE PRIJZEN', 'Boodschappen/Supermarkt'],
    ['2025-02-12', 'Netflix', -1399, 's14', 1, 'NETFLIX.COM', 'Abonnementen/Streaming'],
    ['2025-02-13', 'Bakkerij De Graankorrel', -690, 's2', 0, 'BAKKERIJ DE GRAANKORREL', null],
    ['2025-02-14', 'Restaurant Het Anker', -6800, 's10', 1, 'HET ANKER', null],
    ['2025-02-15', 'Kruidvat', -947, 's3', 0, 'KRUIDVAT 2291', null],
    ['2025-02-15', 'Engie', -12600, 's5', 0, 'ENGIE ELECTRABEL', 'Wonen/Energie'],
    ['2025-02-17', 'Colruyt Laagste Prijzen', -5590, 's1', 1, 'COLRUYT LAAGSTE PRIJZEN', 'Boodschappen/Supermarkt'],
    ['2025-02-18', 'TotalEnergies', -6105, 's7', 0, 'TOTALENERGIES 0412', 'Vervoer/Brandstof'],
    ['2025-02-19', 'Basic-Fit', -2999, 's13', 0, 'BASIC-FIT BELGIUM', null],
    ['2025-02-20', 'Huisartsenpraktijk Zuid', -3000, 's17', 0, 'HUISARTSENPRAKTIJK ZUID', null],
    ['2025-02-21', 'Delhaize', -3814, 's1', 1, 'DELHAIZE 5523', 'Boodschappen/Supermarkt'],
    ['2025-02-22', 'Bakkerij De Graankorrel', -840, 's2', 0, 'BAKKERIJ DE GRAANKORREL', 'Boodschappen/Bakker'],
    ['2025-02-24', 'De Watergroep', -3210, 's6', 1, 'DE WATERGROEP', 'Wonen/Energie'],
    ['2025-02-25', 'Colruyt Laagste Prijzen', -4973, 's1', 0, 'COLRUYT LAAGSTE PRIJZEN', null],
    ['2025-02-26', 'CM Ziekenfonds', 1850, 's20', 0, 'CM ZIEKENFONDS', 'Inkomsten/Terugbetaling'],
    ['2025-02-27', 'Naar spaarrekening', -20000, 's21', 0, 'Naar spaarrekening', '__saved'],
    ['2025-02-28', 'Frituur \u2019t Pleintje', -1450, 's10', -1, 'FRITUUR T PLEINTJE', null]
  ].map((r, i) => ({ id: 'd' + (i + 1), date: r[0], name: r[1], amt: r[2], src: r[3], sDate: addDays(r[0], r[4]), off: r[4], sName: r[5], sCat: r[6] }));

  // First rows of the import (oldest first), to preview the effect of the mapping.
  const PREVIEW = [
    ['2015-11-05', 'Colruyt Laagste Prijzen', 'Betaling Bancontact', 's1', -4318],
    ['2015-11-06', 'Atelier Noord bv', 'Loon oktober', 's19', 210437],
    ['2015-11-07', 'Immo De Linde', 'Huur november', 's4', -84500],
    ['2015-11-09', 'Café De Hoek', '', 's11', -1120],
    ['2015-11-10', 'Hobbyshop Kleurrijk', 'Verf en penselen', 's18', -2495],
    ['2015-11-12', 'Naar spaarrekening', 'Maandelijks sparen', 's21', -15000]
  ];

  // ---------- State ----------

  let page = null;
  let painted = false;
  let route = 'start';
  let batches = [];
  let saved = {};        // Bilance category mapping: source id → target ('Wonen/Huur', 'none' or a created name)
  let accNames = [];     // Bilance account-name mapping: [name in file, account id]
  let created = [];      // categories created by an import in this session
  let wz = null;         // wizard state
  let imported = null;   // the batch made by this session's wizard
  let dialog = null;     // { kind: 'undo', id } or { kind: 'map', source, draft, accDraft, batch }
  let busy = '';         // 'read' | 'import'
  let highlight = 0;     // batch id highlighted in Geschiedenis

  function boot() {
    const empty = isEmpty();
    batches = empty ? [] : BATCHES0.map((b) => Object.assign({}, b));
    // In "lezen", Partner manages the shared account, so the imports into it are hers.
    batches.forEach((b) => { b.by = D.readOnly(b.acc) ? D.partner.name : D.user.name; });
    saved = {};
    if (!empty) SRC.forEach((s) => { if (s.saved) saved[s.id] = s.saved; });
    batches.forEach((b) => { if (b.source === 'Bilance') b.map = Object.assign({}, saved); });
    accNames = empty ? [] : [['Gezamenlijk', 'gedeeld']];
    wz = freshWizard();
  }

  // Default target of a source category: saved mapping, then name similarity, then a new category.
  function origin(s) {
    if (saved[s.id]) return { v: saved[s.id], badge: 'saved' };
    if (s.transfer) return { v: 'none', badge: 'transfer' };
    if (s.suggest) return { v: s.suggest, badge: 'suggest' };
    return { v: 'new', badge: 'new' };
  }

  function freshWizard() {
    const empty = isEmpty();
    const w = {
      preset: 'bilance', sep: ';', enc: 'utf-8',
      cols: COLS.map((c) => c.def), dateFmt: 'dmy', decimal: 'komma',
      targetMode: 'een', target: empty ? 'nieuw' : 'zicht', fileAcc: empty ? 'nieuw' : 'zicht', newName: 'Zichtrekening',
      catMap: {}, parentMode: false, parentMap: {}, parentDef: {},
      cutoff: SYNC_FROM.zicht, forced: {}, applyCats: true, showAll: false
    };
    SRC.forEach((s) => { w.catMap[s.id] = origin(s).v; });
    return w;
  }

  // ---------- Model ----------

  const targetAcc = () => (wz.targetMode === 'kolom' ? wz.fileAcc : wz.target);
  const catColumn = () => wz.cols.indexOf('categorie') >= 0;
  const batchActive = (id) => batches.some((b) => b.id === id && !b.undone);

  function accName(id, b) {
    if (id === 'nieuw') return (b && b.accName) || wz.newName || 'Nieuwe rekening';
    return D.account(id).name;
  }
  function accPill(id, b) {
    const color = id === 'nieuw' ? 'green' : D.account(id).color;
    return '<span class="im-acc"><i style="background:var(--a-' + color + ')"></i>' + esc(accName(id, b)) + '</span>';
  }

  // Effective target of a source category (per category, or per parent when "Per hoofdcategorie" is on).
  const targetOf = (s) => (wz.parentMode && s.parent ? wz.parentMap[s.parent] : wz.catMap[s.id]);
  const newNameOf = (s) => (wz.parentMode && s.parent ? s.parent : s.leaf);

  // Default for a whole parent: the common target of its children, else the top category with the most rows.
  function parentDefault(g) {
    const vals = g.kids.map((k) => wz.catMap[k.id]);
    if (vals.every((v) => v === vals[0])) return vals[0];
    const byTop = {};
    g.kids.forEach((k) => {
      const v = wz.catMap[k.id];
      if (v === 'none' || v === 'new') return;
      byTop[topOf(v)] = (byTop[topOf(v)] || 0) + k.n;
    });
    return Object.keys(byTop).sort((a, b) => byTop[b] - byTop[a])[0] || 'none';
  }

  // The rows of the category table: one per source category, or one per parent in parent mode.
  function units() {
    const one = (s) => ({ key: s.id, kind: 'src', parent: s.parent, leaf: s.leaf, label: srcLabel(s), n: s.n, sum: s.sum,
      value: wz.catMap[s.id], def: origin(s), newName: s.leaf, srcs: [s] });
    if (!wz.parentMode) return SRC.map(one);
    const out = [];
    SRC.forEach((s) => {
      if (!s.parent) { out.push(one(s)); return; }
      if (out.some((u) => u.key === 'p:' + s.parent)) return;
      const g = PARENTS.find((p) => p.name === s.parent);
      out.push({ key: 'p:' + g.name, kind: 'parent', parent: '', leaf: g.name, label: g.name, kids: g.kids,
        n: g.kids.reduce((a, k) => a + k.n, 0), sum: g.kids.reduce((a, k) => a + k.sum, 0),
        value: wz.parentMap[g.name], def: { v: wz.parentDef[g.name], badge: g.kids.some((k) => k.transfer) ? 'transfer' : 'suggest' },
        newName: g.name, srcs: g.kids });
    });
    return out;
  }

  function isCat(v) { return v !== 'none' && v !== 'new'; }

  // Several source rows that land in one Saldo category.
  function merges(us) {
    const by = {};
    us.forEach((u) => { if (isCat(u.value)) (by[u.value] = by[u.value] || []).push(u); });
    return Object.keys(by).filter((v) => by[v].length > 1).map((v) => ({ v, units: by[v] }));
  }

  // Rows on or after `cut` (the file has a steady ~19 rows a month).
  function afterCount(cut) {
    if (!cut) return 0;
    if (cut <= FILE.from) return FILE.rows;
    if (cut >= END) return 0;
    return Math.min(FILE.rows, Math.round(AFTER_BASE * daysBetween(cut, END) / daysBetween(SYNC_FROM.zicht, END)));
  }

  function stats() {
    const acc = targetAcc();
    const first = SYNC_FROM[acc] || null;
    const cut = first ? (wz.cutoff || first) : null;
    const after = afterCount(cut);
    const listed = acc === 'zicht' && batchActive(1) ? DUPS.filter((d) => !cut || d.date < cut) : [];
    const extra = first && cut > first ? Math.max(0, afterCount(first) - after) : 0;
    const forced = listed.filter((d) => wz.forced[d.id]).length;
    const dups = listed.length + extra;
    const skippedDups = dups - forced;
    const fresh = Math.max(0, FILE.rows - after - skippedDups);
    const canApply = (d) => !wz.forced[d.id] && !d.sCat && catColumn() && targetOf(srcById(d.src)) !== 'none';
    const applyable = listed.filter(canApply).length;
    return { acc, first, cut, after, listed, extra, forced, dups, skippedDups, fresh, applyable, apply: wz.applyCats ? applyable : 0 };
  }

  function createImported() {
    const s = stats();
    const us = catColumn() ? units() : [];
    const newCats = unique(us.filter((u) => u.value === 'new').map((u) => u.newName));
    const id = batches.reduce((m, b) => Math.max(m, b.id), 0) + 1;
    const b = { id, source: presetName(wz.preset), file: FILE.name, acc: s.acc, accName: s.acc === 'nieuw' ? (wz.newName.trim() || 'Zichtrekening') : null,
      date: D.today, time: NOW, rows: FILE.rows, imported: s.fresh, cutoffSkip: s.after, dupSkip: s.skippedDups, forced: s.forced,
      catApplied: s.apply, cut: s.cut, from: FILE.from, to: s.cut ? addDays(s.cut, -1) : FILE.to, cats: us.length, newCats, by: D.user.name };
    if (wz.preset === 'bilance' && catColumn()) {
      SRC.forEach((x) => { const v = targetOf(x); saved[x.id] = v === 'new' ? newNameOf(x) : v; });
      newCats.forEach((n) => { if (created.indexOf(n) < 0) created.push(n); });
      b.map = Object.assign({}, saved);
    }
    if (wz.targetMode === 'kolom' && !accNames.some((a) => a[0] === FILE_ACCOUNTS[0].name)) accNames.push([FILE_ACCOUNTS[0].name, s.acc]);
    batches.unshift(b);
    imported = b;
  }

  // ---------- Small pieces ----------

  function anim(cls, delay) {
    return painted ? '' : ' ' + cls + '" style="--d:' + delay + 'ms';
  }

  const tile = (name, bg, fg) => '<span class="im-tile" style="background:' + bg + ';color:' + (fg || (bg === 'var(--c6)' ? 'var(--onC6)' : 'var(--onPastel)')) + '">' + icon(name, 18, 2) + '</span>';
  const offNote = (t) => '<p class="im-off">' + icon('cloudOff', 16, 2.2) + '<span><strong>Je bent offline.</strong> ' + esc(t) + '</span></p>';
  const notice = (kind, ic, html) => '<div class="im-notice im-notice--' + kind + '">' + icon(ic, 18, 2.2) + '<div>' + html + '</div></div>';
  const chev = icon('chevron', 16, 2.4);

  // Native select in a styled wrapper. opts: [value, label, disabled]
  function selectEl(key, opts, value, change, label, attrs) {
    return '<span class="im-sel"><select class="im-select" id="im-' + key + '" data-key="' + key + '" data-change="' + change + '"' +
      (label ? ' aria-label="' + esc(label) + '"' : '') + (attrs || '') + '>' +
      opts.map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === value ? ' selected' : '') + (o[2] ? ' disabled' : '') + '>' + esc(o[1]) + '</option>').join('') +
      '</select>' + chev + '</span>';
  }

  // Category select: Niet categoriseren, Nieuwe categorie 'X', then the tree (and categories created this session).
  function catSelect(key, value, newName, label, change, attrs) {
    const o = (v, t) => '<option value="' + esc(v) + '"' + (v === value ? ' selected' : '') + '>' + esc(t) + '</option>';
    let h = o('none', 'Niet categoriseren') + (newName ? o('new', 'Nieuwe categorie \u2018' + newName + '\u2019') : '');
    TREE.forEach((t) => {
      h += '<optgroup label="' + esc(t.name) + '">' + o(t.name, t.name) + t.kids.map((k) => o(t.name + '/' + k, t.name + ' › ' + k)).join('') + '</optgroup>';
    });
    if (created.length) h += '<optgroup label="Nieuw gemaakt">' + created.map((c) => o(c, c)).join('') + '</optgroup>';
    const dot = value === 'none' ? '<i class="im-dot im-dot--none"></i>'
      : value === 'new' ? '<i class="im-dot im-dot--new">' + icon('plus', 10, 3) + '</i>'
        : '<i class="im-dot" style="background:' + catInk(value).dot + '"></i>';
    return '<span class="im-sel im-sel--cat">' + dot + '<select class="im-select" id="im-' + key + '" data-key="' + key + '" data-change="' + change + '"' +
      ' aria-label="' + esc(label) + '"' + (attrs || '') + '>' + h + '</select>' + chev + '</span>';
  }

  function catChip(v, srcLeaf) {
    if (v === 'none') return '<span class="im-cat im-cat--none">Niet gecategoriseerd</span>';
    if (v === 'new') return '<span class="im-cat im-cat--new">' + icon('plus', 12, 2.6) + esc(srcLeaf) + '</span>';
    const ink = catInk(v);
    return '<span class="im-cat" style="background:' + ink.bg + ';color:' + ink.fg + '">' + esc(catText(v)) + '</span>';
  }

  const BADGES = {
    saved: ['im-badge--saved', 'Bewaard', 'Uit je bewaarde koppeling voor Bilance'],
    suggest: ['im-badge--ok', 'Voorstel', 'Voorstel op basis van de naam'],
    transfer: ['im-badge--ok', 'Voorstel', 'Lijkt een overschrijving'],
    new: ['im-badge--new', 'Nieuw', 'Geen gelijkaardige categorie gevonden']
  };
  function badge(kind) {
    const b = BADGES[kind];
    return b ? '<span class="im-badge ' + b[0] + '" title="' + esc(b[2]) + '">' + (kind === 'saved' ? icon('check', 12, 3) : '') + b[1] + '</span>' : '';
  }

  // ---------- Header ----------

  // back: 'meer' (start view, phone only) or 'start' (sub views, both widths)
  function header(title, sub, back, subDesktopOnly) {
    const backEl = back === 'meer'
      ? '<a class="page-back only-phone" href="meer.html" aria-label="Terug naar Meer">' + icon('back', 22, 2.4) + '</a>'
      : '<a class="page-back im-back" href="#start" aria-label="Terug naar Importeren">' + icon('back', 22, 2.4) + '</a>';
    return '<div class="im-head' + anim('anim-fade', 0) + '">' + backEl +
      '<div class="im-head-title"><h1>' + esc(title) + '</h1>' +
        (sub ? '<span class="im-head-sub' + (subDesktopOnly ? ' only-desktop' : '') + '">' + sub + '</span>' : '') + '</div>' +
    '</div>';
  }

  // ---------- Start view ----------

  function pickButton(cls) {
    const reading = busy === 'read';
    return '<button type="button" class="btn btn--primary im-pick' + (cls ? ' ' + cls : '') + '" data-action="pick" data-key="pick"' + offAttr() + '>' +
      (reading ? '<span class="im-spin" aria-hidden="true"></span>Bestand lezen…' : icon('file', 18, 2.2) + 'Bestand kiezen') + '</button>';
  }

  function intro() {
    return '<section class="card im-intro' + anim('anim-in', 30) + '" aria-labelledby="im-intro-h">' +
      '<div class="im-intro-head">' + tile('upload', 'var(--c4)') +
        '<div class="im-intro-text"><h2 id="im-intro-h">Breng je geschiedenis mee</h2>' +
        '<p>Importeer een CSV-bestand, zoals de export uit Bilance of uit Argenta. Je ziet eerst alles in een voorbeeld: er wordt niets bewaard tot je bevestigt. Elke import kan je in één keer ongedaan maken.</p></div>' +
      '</div>' +
      '<div class="im-drop" data-drop>' +
        '<span class="im-drop-icon only-desktop">' + icon('upload', 22, 2) + '</span>' +
        '<span class="im-drop-text only-desktop">Sleep je CSV-bestand hierheen of</span>' + pickButton() +
      '</div>' +
      (isOffline() ? offNote('Een bestand importeren kan weer zodra je verbinding hebt.') : '') +
    '</section>';
  }

  // State "leeg": no accounts yet, so an import needs an account first (or makes a new manual one).
  function introEmpty() {
    const choice = (href, ic, bg, fg, name, sub, key) => '<a class="im-choice" href="' + href + '" data-key="' + key + '">' + tile(ic, bg, fg) +
      '<span class="im-choice-main"><span class="im-choice-name">' + esc(name) + '</span><span class="im-choice-sub">' + esc(sub) + '</span></span>' +
      '<span class="im-chev">' + icon('chevron', 16, 2.2) + '</span></a>';
    return '<section class="card im-intro' + anim('anim-in', 30) + '" aria-labelledby="im-intro-h">' +
      '<div class="im-intro-head">' + tile('upload', 'var(--c4)') +
        '<div class="im-intro-text"><h2 id="im-intro-h">Eerst een rekening</h2>' +
        '<p>Je hebt nog geen rekening. Een import komt altijd in een rekening terecht. Koppel eerst je bank of maak een handmatige rekening. Of importeer meteen in een nieuwe handmatige rekening.</p></div>' +
      '</div>' +
      '<div class="im-choices">' +
        choice('bankkoppelingen.html', 'bank', 'var(--c1)', null, 'Bank koppelen', 'Je bank geeft de recente maanden. Daarna importeer je wat ouder is.', 'ch-bank') +
        choice('rekeningen.html', 'card', 'var(--soft)', 'var(--greenText)', 'Handmatige rekening maken', 'Voor een spaarrekening of een rekening zonder koppeling', 'ch-manual') +
        choice('#stap-1', 'file', 'var(--c4)', null, 'Importeren in een nieuwe rekening', 'Saldo maakt een handmatige rekening met de rijen uit je bestand', 'ch-import') +
      '</div>' +
      (isOffline() ? offNote('Een bestand importeren kan weer zodra je verbinding hebt.') : '') +
    '</section>';
  }

  function undoControl(b) {
    if (b.undone) return '<span class="im-undone">' + icon('undo', 14, 2.2) + 'Ongedaan gemaakt op ' + esc(dayMonth(b.undone)) + '</span>';
    if (D.readOnly(b.acc)) return '<span class="chip chip--readonly">' + icon('lock', 13, 2.2) + 'Alleen lezen</span>';
    return '<button type="button" class="im-btn im-btn--undo" data-action="undo" data-id="' + b.id + '" data-key="undo-' + b.id + '"' + offAttr() + '>' +
      icon('undo', 16, 2.2) + 'Ongedaan maken</button>';
  }

  // Compact batch row (start view and result)
  function batchRow(b) {
    return '<div class="im-batch' + (b.undone ? ' is-undone' : '') + '">' +
      tile('file', srcTint(b.source)) +
      '<div class="im-batch-main">' +
        '<span class="im-batch-name">' + esc(b.file) + '</span>' +
        '<span class="im-batch-sub">' + esc(b.source) + ' · batch ' + b.id + ' · ' + esc(when(b.date)) + (b.by !== D.user.name ? ' · door ' + esc(b.by) : '') + '</span>' +
        '<span class="im-batch-meta">' + accPill(b.acc, b) + '<span class="mono">' + plural(b.imported, 'transactie', 'transacties') + '</span></span>' +
      '</div>' +
      '<div class="im-batch-act">' + undoControl(b) + '</div>' +
    '</div>';
  }

  function historySection() {
    const list = batches.slice(0, 3);
    return '<section class="im-sec' + anim('anim-in', 60) + '" aria-labelledby="im-hist-h">' +
      '<div class="im-sec-head"><h2 class="label" id="im-hist-h">Geschiedenis</h2>' +
        (batches.length ? '<a class="section-link" href="#geschiedenis">Alles bekijken</a>' : '') + '</div>' +
      (list.length
        ? '<div class="im-list">' + list.map(batchRow).join('') + '</div>'
        : '<div class="im-empty"><strong>Nog geen imports</strong><span>Elke import verschijnt hier als een batch die je in één keer ongedaan kan maken.</span></div>') +
    '</section>';
  }

  function lastUse(source) {
    return batches.find((b) => b.source === source && !b.undone);
  }

  function mappingSection() {
    const nCats = Object.keys(saved).length;
    const bil = lastUse('Bilance');
    const arg = lastUse('Argenta-export');
    const useText = (b) => (b ? 'Laatst gebruikt ' + onDay(b.date) + ' (batch ' + b.id + ')' : 'Nog niet gebruikt');
    const card = (key, ic, tint, name, sub, meta, buttons) => '<div class="im-map">' +
      '<div class="im-map-head">' + tile(ic, tint) + '<span class="im-map-main"><span class="im-map-name">' + esc(name) + '</span><span class="im-map-sub">' + esc(sub) + '</span>' +
        '<span class="im-map-meta">' + esc(meta) + '</span></span></div>' +
      '<div class="im-map-actions">' + buttons + '</div></div>';
    const canApply = bil && !D.readOnly(bil.acc) || batches.some((b) => b.source === 'Bilance' && !b.undone && !D.readOnly(b.acc));
    return '<section class="im-sec' + anim('anim-in', 90) + '" aria-labelledby="im-map-h">' +
      '<div class="im-sec-head"><h2 class="label" id="im-map-h">Opgeslagen koppelingen</h2></div>' +
      '<div class="im-maps">' +
        card('bilance', 'link', 'var(--c4)', 'Bilance',
          nCats ? '9 kolommen · ' + plural(nCats, 'categorie', 'categorieën') + ' · ' + plural(accNames.length, 'rekeningnaam', 'rekeningnamen') : 'Standaardkolommen · nog geen categorieën gekoppeld',
          useText(bil),
          '<button type="button" class="im-btn im-btn--ghost im-btn--sm" data-action="map-edit" data-src="bilance" data-key="map-bilance">' + icon('edit', 15, 2.2) + 'Bewerken</button>' +
          (nCats ? '<button type="button" class="im-btn im-btn--soft im-btn--sm" data-action="map-apply" data-src="bilance" data-key="map-apply"' + (canApply ? '' : ' disabled') + '>' + icon('sync', 15, 2.2) + 'Opnieuw toepassen</button>' : '')) +
        card('argenta', 'link', 'var(--c1)', 'Argenta-export', '6 kolommen · geen categorieën in dit formaat', useText(arg),
          '<button type="button" class="im-btn im-btn--ghost im-btn--sm" data-action="map-edit" data-src="argenta" data-key="map-argenta">' + icon('edit', 15, 2.2) + 'Bewerken</button>') +
      '</div>' +
      '<p class="im-help im-maps-note">Een koppeling onthoudt per bron welke kolom wat is en waar elke categorie terechtkomt. Zo hoef je de volgende keer niets te koppelen.</p>' +
    '</section>';
  }

  function viewStart() {
    return header('Importeren', 'CSV-bestanden, bv. de export uit Bilance', 'meer', true) +
      (isEmpty() ? introEmpty() : intro()) +
      '<div class="im-start-grid">' + historySection() + mappingSection() + '</div>';
  }

  // ---------- Geschiedenis ----------

  function batchCard(b, i) {
    const ro = D.readOnly(b.acc);
    const fact = (k, v) => '<div class="im-fact"><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>';
    const skipped = [];
    if (b.cutoffSkip) skipped.push(num(b.cutoffSkip) + ' na de importgrens');
    if (b.dupSkip) skipped.push(num(b.dupSkip) + ' dubbels');
    const actions = b.undone ? '' :
      '<div class="im-bc-actions">' +
        '<button type="button" class="im-btn im-btn--ghost im-btn--sm" data-action="view-tx" data-id="' + b.id + '" data-key="tx-' + b.id + '">' + icon('list', 15, 2.2) + 'Transacties bekijken</button>' +
        (b.source === 'Bilance' && !ro ? '<button type="button" class="im-btn im-btn--ghost im-btn--sm" data-action="map-apply" data-src="bilance" data-batch="' + b.id + '" data-key="reapply-' + b.id + '"' + offAttr() + '>' + icon('sync', 15, 2.2) + 'Koppeling opnieuw toepassen</button>' : '') +
        undoControl(b) +
      '</div>';
    return '<article class="im-bc' + (b.undone ? ' is-undone' : '') + (highlight === b.id ? ' is-hl' : '') + anim('anim-in', 60 + i * 30) + '" id="batch-' + b.id + '" aria-labelledby="im-bc-' + b.id + '">' +
      '<div class="im-bc-head">' + tile('file', srcTint(b.source)) +
        '<div class="im-bc-title"><h2 id="im-bc-' + b.id + '">Batch ' + b.id + ' · ' + esc(b.file) + '</h2>' +
          '<span>' + esc(b.source) + ' · ' + esc(fullDate(b.date)) + ' om ' + b.time + ' · door ' + (b.by === D.user.name ? 'jou' : esc(b.by)) + '</span></div>' +
        (b.undone ? '<span class="im-status im-status--undone">Ongedaan gemaakt</span>' : '<span class="im-status">Actief</span>') +
      '</div>' +
      '<dl class="im-facts">' +
        fact('Rekening', accPill(b.acc, b)) +
        fact('Periode', esc(shortDate(b.from) + ' – ' + shortDate(b.to))) +
        fact('Rijen in het bestand', '<span class="mono">' + num(b.rows) + '</span>') +
        fact('Geïmporteerd', '<span class="mono">' + num(b.imported) + '</span>') +
        fact('Overgeslagen', skipped.length ? esc(skipped.join(' · ')) : '<span class="muted">geen</span>') +
        fact('Categorie gegeven aan bestaande', b.catApplied ? '<span class="mono">' + num(b.catApplied) + '</span>' : '<span class="muted">geen</span>') +
      '</dl>' +
      (b.undone ? '<p class="im-bc-undone">' + icon('undo', 15, 2.2) + 'Ongedaan gemaakt op ' + esc(fullDate(b.undone)) + '. De ' + num(b.imported) + ' transacties uit dit bestand zijn verwijderd.</p>' : '') +
      actions +
    '</article>';
  }

  function viewHistory() {
    return header('Importgeschiedenis', 'Elke import is een batch', 'start') +
      '<p class="im-lead' + anim('anim-in', 30) + '">Maak je een batch ongedaan, dan verdwijnen de transacties uit dat bestand, en alleen die. Saldo onthoudt elk bestand: hetzelfde bestand nog eens importeren voegt niets toe.</p>' +
      (isOffline() ? offNote('Ongedaan maken kan weer zodra je verbinding hebt.') : '') +
      (batches.length ? '<div class="im-bcs">' + batches.map(batchCard).join('') + '</div>'
        : '<div class="im-empty"><strong>Nog geen imports</strong><span>Je eerste import verschijnt hier.</span></div>');
  }

  // ---------- Wizard frame ----------

  const STEPS = ['Bestand', 'Kolommen', 'Categorieën', 'Voorbeeld', 'Resultaat'];

  function stepper(cur) {
    const closed = cur === 5;
    const items = STEPS.map((name, i) => {
      const n = i + 1;
      const state = n < cur ? 'done' : (n === cur ? 'current' : 'todo');
      const inner = '<span class="im-st-dot">' + (state === 'done' ? icon('check', 13, 3) : n) + '</span><span class="im-st-name">' + name + '</span>';
      const el = state === 'done' && !closed
        ? '<a class="im-st-link" href="#stap-' + n + '" aria-label="Stap ' + n + ': ' + name + ' (klaar)">' + inner + '</a>'
        : '<span class="im-st-link">' + inner + (state === 'done' ? '<span class="visually-hidden"> (klaar)</span>' : '') + '</span>';
      return '<li class="im-st im-st--' + state + '"' + (state === 'current' ? ' aria-current="step"' : '') + '>' + el + '</li>';
    }).join('');
    return '<nav class="im-steps' + anim('anim-fade', 20) + '" aria-label="Stappen van de import">' +
      '<p class="im-steps-phone" aria-hidden="true"><strong>Stap ' + cur + ' van 5</strong> · ' + STEPS[cur - 1] + '</p>' +
      '<ol class="im-steps-list">' + items + '</ol></nav>';
  }

  function stepTitle(t, sub) {
    return '<div class="im-step-title' + anim('anim-in', 40) + '"><h2 id="im-step-h" tabindex="-1">' + esc(t) + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>';
  }

  function actionBar(left, right, note) {
    return '<div class="im-actions">' + (note ? '<span class="im-actions-note">' + note + '</span>' : '<span class="im-actions-spacer"></span>') + left + right + '</div>';
  }
  const prevBtn = (to) => '<button type="button" class="im-btn im-btn--ghost" data-action="go" data-to="' + to + '" data-key="prev">' + (to === 'start' ? 'Annuleren' : 'Vorige') + '</button>';
  const nextBtn = (label, ok) => '<button type="button" class="im-btn im-btn--primary" data-action="next" data-key="next"' + (ok ? '' : ' disabled') + '>' + esc(label) + icon('arrowRight', 16, 2.4) + '</button>';
  const nothingSaved = '<span class="only-desktop">Er wordt niets bewaard tot je importeert.</span>';

  // ---------- Stap 1 · Bestand ----------

  function fileCard(name, meta, period) {
    return '<div class="im-file' + anim('anim-in', 60) + '">' + tile('file', 'var(--c4)') +
      '<span class="im-file-main"><span class="im-file-name">' + esc(name) + '</span><span class="im-file-meta">' + meta + '</span>' +
        (period ? '<span class="im-file-meta">' + period + '</span>' : '') + '</span>' +
      '<button type="button" class="im-btn im-btn--ghost im-btn--sm" data-action="pick-other" data-key="pick-other"' + offAttr() + '>Ander bestand</button>' +
    '</div>';
  }

  function step1Valid() { return wz.preset !== 'argenta' && wz.sep === ';'; }

  function step1() {
    const presetSub = (p) => p.sub || (Object.keys(saved).length ? 'Opgeslagen koppeling: kolommen, categorieën en rekeningnamen' : 'Standaardkolommen voor een export uit Bilance');
    const presets = '<fieldset class="im-fieldset"><legend class="im-card-title">Soort bestand</legend><div class="im-radios">' +
      PRESETS.map((p) => '<label class="im-radio"><input type="radio" name="im-preset" value="' + p.id + '" data-change="preset" data-key="preset-' + p.id + '"' + (p.id === wz.preset ? ' checked' : '') + '>' +
        '<span class="im-radio-main"><span class="im-radio-name">' + esc(p.name) + (p.id === 'bilance' ? badge('suggest').replace('Voorstel', 'Herkend') : '') + '</span>' +
        '<span class="im-radio-sub">' + esc(presetSub(p)) + '</span></span></label>').join('') +
      '</div>' +
      (wz.preset === 'argenta' ? notice('warn', 'warning', '<strong>Dit lijkt geen Argenta-export.</strong> De kolommen Boekingsdatum, Naam tegenpartij en Mededeling ontbreken. Kies Bilance of Ander CSV-bestand.') : '') +
      (wz.preset === 'ander' ? '<p class="im-help">Saldo raadt de kolommen aan de hand van hun naam. In de volgende stap kijk je ze na.</p>' : '') +
    '</fieldset>';

    const raw = RAW.map((l) => (wz.enc === 'utf-8' ? l : l.replace(/é/g, 'Ã©').replace(/•/g, 'â€¢'))).map(esc).join('\n');
    const det = '<section class="im-card im-det-card" aria-labelledby="im-det-h"><h3 class="im-card-title" id="im-det-h">Herkend in het bestand</h3>' +
      '<div class="im-det">' +
        '<div class="field"><label class="field-label" for="im-sep">Scheidingsteken</label>' + selectEl('sep', [[';', 'Puntkomma ( ; )'], [',', 'Komma ( , )'], ['tab', 'Tab']], wz.sep, 'sep') + '</div>' +
        '<div class="field"><label class="field-label" for="im-enc">Codering</label>' + selectEl('enc', [['utf-8', 'UTF-8'], ['win1252', 'Windows-1252'], ['latin1', 'ISO-8859-1']], wz.enc, 'enc') + '</div>' +
        '<div class="im-det-fact"><span class="field-label">Datumnotatie</span><span class="im-det-val">dd/mm/jjjj</span><span class="im-det-ex">bv. 02/06/2026</span></div>' +
        '<div class="im-det-fact"><span class="field-label">Bedragen</span><span class="im-det-val">Decimale komma</span><span class="im-det-ex">bv. -64,12</span></div>' +
      '</div>' +
      (wz.sep !== ';' ? notice('warn', 'warning', 'Met dit scheidingsteken vindt Saldo maar één kolom per regel. Puntkomma lijkt te kloppen.') : '') +
      (wz.enc !== 'utf-8' ? notice('warn', 'warning', 'Zie je rare tekens zoals \u2018CafÃ©\u2019? Kies dan UTF-8.') : '') +
      '<div class="im-raw-wrap"><span class="field-label">Eerste regels</span><pre class="im-raw" tabindex="0" aria-label="Eerste regels van het bestand">' + raw + '</pre></div>' +
    '</section>';

    const mock = batches.some((b) => b.id === 3)
      ? '<div class="im-mock"><span class="im-mock-tag">Mockup</span><span>Wat als je een bestand kiest dat al geïmporteerd is?</span>' +
        '<button type="button" class="im-link" data-action="go" data-to="al-geimporteerd" data-key="mock-dupe">Kies het bestand van batch 3 opnieuw</button></div>'
      : '';

    return stepTitle('Welk bestand importeer je?', 'Saldo leest het bestand en herkent hoe het is opgebouwd. Er wordt nog niets bewaard.') +
      fileCard(FILE.name, FILE.size + ' · ' + num(FILE.rows) + ' rijen · ' + FILE.cols + ' kolommen', 'Van ' + fullDate(FILE.from) + ' tot ' + fullDate(FILE.to)) +
      (isOffline() ? offNote('Een ander bestand kiezen kan weer zodra je verbinding hebt.') : '') +
      '<div class="im-grid2' + anim('anim-in', 90) + '"><section class="im-card">' + presets + '</section>' + det + '</div>' +
      mock +
      actionBar(prevBtn('start'), nextBtn('Volgende', step1Valid()), nothingSaved);
  }

  // ---------- Al geïmporteerd (same file again) ----------

  function dupeBatch() {
    if (imported && !imported.undone) return imported;
    return batches.find((b) => b.id === 3);
  }

  function stepDupe() {
    const b = dupeBatch();
    if (!b) return step1();
    const text = b.undone
      ? '<strong>Dit bestand werd ' + onDay(b.date) + ' geïmporteerd (batch ' + b.id + '), maar die import is ongedaan gemaakt.</strong><p>Je kan het gewoon opnieuw importeren.</p>'
      : '<strong>Dit bestand is al geïmporteerd ' + onDay(b.date) + ' (batch ' + b.id + '). Er komt niets bij.</strong>' +
        '<p>Saldo herkent een bestand aan zijn inhoud, ook als je het hernoemt. En een rij die al in Saldo staat, komt er nooit een tweede keer in.</p>';
    return stepTitle('Welk bestand importeer je?', '') +
      fileCard(b.file, num(b.rows) + ' rijen · 9 kolommen', 'In je ' + esc(accName(b.acc, b)) + ' · ' + plural(b.imported, 'transactie', 'transacties') + ' geïmporteerd') +
      '<div class="im-dupe' + anim('anim-in', 90) + '" role="status">' +
        '<span class="im-dupe-icon">' + icon('checkCircle', 26, 2) + '</span>' +
        '<div class="im-dupe-text">' + text + '</div>' +
      '</div>' +
      actionBar(
        '<button type="button" class="im-btn im-btn--ghost" data-action="see-batch" data-id="' + b.id + '" data-key="see-batch">Batch ' + b.id + ' bekijken</button>',
        '<button type="button" class="im-btn im-btn--primary" data-action="pick-other" data-key="pick-other2"' + offAttr() + '>' + icon('file', 16, 2.2) + 'Ander bestand kiezen</button>');
  }

  // ---------- Stap 2 · Kolommen ----------

  function colIssues() {
    const used = {};
    wz.cols.forEach((f, i) => { if (f !== 'negeren') (used[f] = used[f] || []).push(i); });
    const dupCols = {};
    Object.keys(used).forEach((f) => { if (used[f].length > 1) used[f].forEach((i) => { dupCols[i] = f; }); });
    const missing = ['datum', 'bedrag'].filter((f) => !used[f]);
    if (wz.targetMode === 'kolom' && !used.rekening) missing.push('rekening');
    return { used, dupCols, missing };
  }

  function parseAmount(s) {
    const t = wz.decimal === 'komma' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const v = parseFloat(t);
    return isFinite(v) ? Math.round(v * 100) : null;
  }

  function readAs(c, f) {
    const bad = '<span class="im-read-bad">Onleesbaar</span>';
    if (f === 'negeren') return '<span class="muted">Wordt niet gebruikt</span>';
    if (f === 'datum') {
      if (c.kind !== 'date') return bad;
      const p = c.ex.split('/');
      if (wz.dateFmt === 'ymd') return bad;
      const iso = wz.dateFmt === 'dmy' ? p[2] + '-' + p[1] + '-' + p[0] : p[2] + '-' + p[0] + '-' + p[1];
      return esc(shortDate(iso));
    }
    if (f === 'bedrag') {
      if (c.kind !== 'amount') return bad;
      const v = parseAmount(c.ex);
      if (v === null) return bad;
      return '<span class="mono">' + eur(v) + '</span>' + (Math.abs(v) > 500000 && wz.decimal === 'punt' ? ' <span class="im-read-warn">Klopt dit?</span>' : '');
    }
    if (f === 'categorie') return c.kind === 'cat' ? plural(SRC.length, 'categorie', 'categorieën') + ' · zie stap 3' : esc(c.ex);
    if (f === 'rekening') return c.kind === 'acc' ? plural(FILE_ACCOUNTS.length, 'rekeningnaam', 'rekeningnamen') : esc(c.ex);
    return esc(c.ex);
  }

  function accountOptions(selected, withSkip) {
    const list = isEmpty() ? [] : D.accounts.map((a) => D.account(a.id));
    const opts = list.map((a) => [a.id, a.name + (D.readOnly(a.id) ? ' (alleen lezen)' : ''), D.readOnly(a.id)]);
    opts.push(['nieuw', 'Nieuwe handmatige rekening']);
    if (withSkip) opts.push(['skip', 'Niet importeren']);
    return opts;
  }

  function targetSection() {
    const seg = '<div class="im-seg" role="group" aria-label="Doelrekening">' +
      [['een', 'Eén rekening'], ['kolom', 'Uit de kolom Rekening']].map((o) =>
        '<button type="button" aria-pressed="' + (wz.targetMode === o[0]) + '" data-action="seg" data-group="targetMode" data-value="' + o[0] + '" data-key="tm-' + o[0] + '">' + o[1] + '</button>').join('') +
    '</div>';
    const nameField = (show) => show
      ? '<div class="field im-newname"><label class="field-label" for="im-newname">Naam van de nieuwe rekening</label>' +
        '<input class="input" id="im-newname" autocomplete="off" value="' + esc(wz.newName) + '" data-input="newname" data-key="newname">' +
        '<span class="im-help">Een handmatige rekening werk je zelf bij. Naam, kleur en buffer pas je later aan onder Rekeningen.</span></div>'
      : '';
    let body;
    if (wz.targetMode === 'een') {
      const accs = isEmpty() ? [] : D.accounts.map((a) => D.account(a.id));
      const opt = (id, av, name, sub, ro) => '<label class="im-acc-opt' + (ro ? ' is-disabled' : '') + '">' +
        '<input type="radio" name="im-target" value="' + id + '" data-change="target" data-key="tg-' + id + '"' + (wz.target === id ? ' checked' : '') + (ro ? ' disabled' : '') + '>' +
        av + '<span class="im-radio-main"><span class="im-radio-name">' + esc(name) + '</span><span class="im-radio-sub">' + esc(sub) + '</span></span>' +
        (ro ? '<span class="chip chip--readonly">' + icon('lock', 13, 2.2) + 'Alleen lezen</span>' : '') + '</label>';
      body = '<div class="im-acc-list" role="radiogroup" aria-label="Doelrekening">' +
        accs.map((a) => {
          const ro = D.readOnly(a.id);
          const sub = ro ? D.partner.name + ' is beheerder · jij kan alleen lezen'
            : (SYNC_FROM[a.id] ? a.source + ' · gesynchroniseerd sinds ' + fullDate(SYNC_FROM[a.id]) : 'Handmatig · niet gesynchroniseerd');
          return opt(a.id, '<span class="im-acc-av" style="background:var(--a-' + a.color + ')">' + icon(a.icon, 17, 2.2) + '</span>', a.name, sub, ro);
        }).join('') +
        opt('nieuw', '<span class="im-acc-av im-acc-av--new">' + icon('plus', 17, 2.4) + '</span>', 'Nieuwe handmatige rekening', 'Saldo maakt ze aan bij het importeren', false) +
      '</div>' + nameField(wz.target === 'nieuw') +
      (D.demo() === 'lezen' ? '<p class="im-help">' + icon('lock', 13, 2.2) + ' Op de Gedeelde rekening kan je alleen lezen. Importeren kan wie mag bewerken; vraag het aan ' + esc(D.partner.name) + '.</p>' : '') +
      (isEmpty() ? notice('info', 'info', 'Je hebt nog geen rekening, dus Saldo maakt een handmatige rekening voor deze import. Liever eerst je bank koppelen? <a href="bankkoppelingen.html">Bank koppelen</a>') : '');
    } else {
      body = '<div class="im-mapacc">' +
        '<div class="im-mapacc-th only-desktop"><span>Naam in het bestand</span><span>Rijen</span><span></span><span>Rekening in Saldo</span></div>' +
        FILE_ACCOUNTS.map((fa) => '<div class="im-mapacc-row">' +
          '<span class="im-mapacc-name">' + esc(fa.name) + '</span><span class="im-mapacc-n mono">' + num(fa.n) + '<span class="only-phone"> rijen</span></span>' +
          '<span class="im-arrow" aria-hidden="true">' + icon('arrowRight', 16, 2) + '</span>' +
          selectEl('fileacc', accountOptions(wz.fileAcc, true), wz.fileAcc, 'fileacc', 'Rekening in Saldo voor ' + fa.name) + '</div>').join('') +
      '</div>' + nameField(wz.fileAcc === 'nieuw') +
      '<p class="im-help">Saldo vond ' + plural(FILE_ACCOUNTS.length, 'rekeningnaam', 'rekeningnamen') + ' in de kolom Rekening. Koppel elke naam aan een rekening; de koppeling wordt bewaard voor ' + esc(presetName(wz.preset)) + '.</p>';
    }
    return '<section class="im-card" aria-labelledby="im-tg-h"><h3 class="im-card-title" id="im-tg-h">Naar welke rekening?</h3>' + seg + body + '</section>';
  }

  function step2Problems() {
    const iss = colIssues();
    const out = iss.missing.map((f) => 'Kies nog een kolom voor ' + fieldName(f) + '.');
    if (Object.keys(iss.dupCols).length) out.push('Elke soort mag maar bij één kolom staan.');
    if (wz.dateFmt === 'ymd') out.push('De datums passen niet bij deze notatie.');
    const acc = targetAcc();
    if (acc === 'skip') out.push('Kies een rekening voor ' + FILE_ACCOUNTS[0].name + '.');
    if (acc === 'nieuw' && !wz.newName.trim()) out.push('Geef de nieuwe rekening een naam.');
    if (acc !== 'nieuw' && acc !== 'skip' && D.readOnly(acc)) out.push('Op die rekening kan je alleen lezen.');
    return out;
  }

  function step2() {
    const iss = colIssues();
    const rows = COLS.map((c, i) => {
      const f = wz.cols[i];
      const err = iss.dupCols[i];
      return '<div class="im-tr im-colrow' + (err ? ' is-err' : '') + '">' +
        '<div class="im-colrow-src"><span class="im-colrow-h">' + esc(c.h) + '</span><span class="im-colrow-ex mono">' + esc(c.ex) + '</span></div>' +
        '<span class="im-arrow" aria-hidden="true">' + icon('arrowRight', 16, 2) + '</span>' +
        '<div class="im-colrow-sel">' + selectEl('col-' + i, FIELDS, f, 'col', 'Kolom \u2018' + c.h + '\u2019 wordt', ' data-i="' + i + '"') +
          (err ? '<span class="im-err">Ook gekozen bij een andere kolom</span>' : '') + '</div>' +
        '<div class="im-colrow-read"><span class="only-phone im-read-label">Saldo leest </span>' + readAs(c, f) + '</div>' +
      '</div>';
    }).join('');
    const problems = step2Problems();
    const fmt = '<section class="im-card" aria-labelledby="im-fmt-h"><h3 class="im-card-title" id="im-fmt-h">Notatie</h3><div class="im-grid2 im-grid2--tight">' +
      '<div class="field"><label class="field-label" for="im-datefmt">Datumnotatie</label>' +
        selectEl('datefmt', [['dmy', 'dag/maand/jaar · 02/06/2026'], ['mdy', 'maand/dag/jaar · 06/02/2026'], ['ymd', 'jaar-maand-dag · 2026-06-02']], wz.dateFmt, 'datefmt') + '</div>' +
      '<div class="field"><span class="field-label" id="im-dec-l">Decimaalteken</span><div class="im-seg" role="group" aria-labelledby="im-dec-l">' +
        [['komma', 'Komma · 1.234,56'], ['punt', 'Punt · 1,234.56']].map((o) =>
          '<button type="button" aria-pressed="' + (wz.decimal === o[0]) + '" data-action="seg" data-group="decimal" data-value="' + o[0] + '" data-key="dec-' + o[0] + '">' + o[1] + '</button>').join('') +
      '</div></div></div>' +
      '<p class="im-help">Saldo leest 02/06/2026 als ' + readAs(COLS[0], 'datum') + ' en -64,12 als ' + readAs(COLS[3], 'bedrag') + '.</p></section>';

    return stepTitle('Wat staat in welke kolom?', wz.preset === 'bilance'
      ? 'Herkend met de koppeling voor Bilance. Kijk ze na en pas aan waar nodig.'
      : 'Saldo raadde de kolommen aan de hand van hun naam. Kijk ze na en pas aan waar nodig.') +
      '<section class="im-card im-card--table' + anim('anim-in', 60) + '" aria-label="Kolommen">' +
        '<div class="im-th im-colrow only-desktop"><span>Kolom in het bestand</span><span></span><span>Wordt in Saldo</span><span>Saldo leest</span></div>' +
        rows +
      '</section>' +
      '<div class="im-grid2' + anim('anim-in', 90) + '">' + fmt + targetSection() + '</div>' +
      actionBar(prevBtn('stap-1'), nextBtn('Volgende', !problems.length),
        problems.length ? '<span class="im-actions-err">' + esc(problems[0]) + '</span>' : nothingSaved);
  }

  // ---------- Stap 3 · Categorieën ----------

  function pathHtml(u) {
    if (u.kind === 'parent') return '<span class="im-path-leaf">' + esc(u.leaf) + '</span><span class="im-path-kids">' + u.kids.length + ' subcategorieën: ' + esc(u.kids.map((k) => k.leaf).join(', ')) + '</span>';
    return '<span class="im-path">' + (u.parent ? '<span class="im-path-parent">' + esc(u.parent) + ' &gt;</span> ' : '') + '<span class="im-path-leaf">' + esc(u.leaf) + '</span></span>';
  }

  function catRow(u, us) {
    const mates = isCat(u.value) ? us.filter((x) => x !== u && x.value === u.value) : [];
    const isTransfer = u.srcs.some((s) => s.transfer) && u.value === 'none';
    return '<div class="im-tr im-catrow">' +
      '<div class="im-catrow-src">' + pathHtml(u) + '</div>' +
      '<div class="im-catrow-n"><span class="mono">' + num(u.n) + '</span><span class="only-phone"> transacties</span></div>' +
      '<div class="im-catrow-sum mono' + (u.sum > 0 ? ' pos' : '') + '">' + eur(u.sum, u.sum > 0) + '</div>' +
      '<span class="im-arrow" aria-hidden="true">' + icon('arrowRight', 16, 2) + '</span>' +
      '<div class="im-catrow-tgt">' +
        '<div class="im-catrow-pick">' + catSelect('cat-' + u.key, u.value, u.newName, 'Categorie in Saldo voor ' + u.label, 'cat', ' data-unit="' + esc(u.key) + '"') +
          (u.value === u.def.v ? badge(u.def.badge) : '') + '</div>' +
        (mates.length ? '<span class="im-merge">' + icon('merge', 14, 2.2) + 'Samen met ' + esc(mates.map((m) => m.label).join(', ')) + '</span>' : '') +
        (isTransfer ? '<span class="im-hint">Saldo herkent overschrijvingen tussen je eigen rekeningen zelf.</span>' : '') +
      '</div>' +
    '</div>';
  }

  function step3() {
    if (!catColumn()) {
      return stepTitle('Koppel de categorieën', '') +
        notice('info', 'info', 'Je koos geen kolom Categorie, dus er is niets te koppelen. Saldo categoriseert de transacties met je regels en suggesties.') +
        actionBar(prevBtn('stap-2'), nextBtn('Volgende', true), nothingSaved);
    }
    const us = units();
    const count = { saved: 0, suggest: 0, new: 0, none: 0, changed: 0 };
    us.forEach((u) => {
      if (u.value !== u.def.v) count.changed++;
      else if (u.def.badge === 'saved') count.saved++;
      else if (u.value === 'new') count.new++;
      else if (u.value === 'none') count.none++;
      else count.suggest++;
    });
    const chips = [
      count.saved && '<span class="im-badge im-badge--saved">' + icon('check', 12, 3) + count.saved + ' bewaard</span>',
      count.suggest && '<span class="im-badge im-badge--ok">' + plural(count.suggest, 'voorstel', 'voorstellen') + '</span>',
      count.new && '<span class="im-badge im-badge--new">' + count.new + ' nieuw</span>',
      count.none && '<span class="im-badge im-badge--none">' + count.none + ' niet categoriseren</span>',
      count.changed && '<span class="im-badge im-badge--none">' + count.changed + ' zelf gekozen</span>'
    ].filter(Boolean).join('');
    const ms = merges(us);
    const newNames = unique(us.filter((u) => u.value === 'new').map((u) => u.newName));
    const src = presetName(wz.preset);

    return stepTitle('Koppel de categorieën', 'Saldo vond ' + plural(SRC.length, 'categorie', 'categorieën') + ' in de kolom Categorie. Kies voor elke categorie waar ze in Saldo terechtkomt.') +
      '<div class="im-catnote' + anim('anim-in', 60) + '">' + icon('info', 18, 2.2) +
        '<div><strong>Deze koppeling wordt bewaard voor ' + esc(src) + '. Volgende keer hoef je niets te koppelen.</strong>' +
        '<p>Gekoppelde categorieën leren Saldo ook welke categorie bij een tegenpartij hoort. Zo worden je suggesties beter.</p></div></div>' +
      '<div class="im-cattools' + anim('anim-in', 75) + '">' +
        '<div class="im-sum-chips">' + chips + '</div>' +
        '<div class="im-toggle"><span class="im-toggle-text"><span class="im-toggle-name" id="im-pm-l">Per hoofdcategorie koppelen</span>' +
          '<span class="im-toggle-sub">Alle subcategorieën krijgen hetzelfde doel, bv. alles onder Huishouden</span></span>' +
          '<button type="button" class="switch" role="switch" aria-checked="' + wz.parentMode + '" aria-labelledby="im-pm-l" data-action="parent-toggle" data-key="parent-toggle"></button></div>' +
      '</div>' +
      '<section class="im-card im-card--table' + anim('anim-in', 90) + '" aria-label="Categorieën koppelen">' +
        '<div class="im-th im-catrow only-desktop"><span>Categorie in ' + esc(src) + '</span><span>Transacties</span><span>Totaal</span><span></span><span>Categorie in Saldo</span></div>' +
        us.map((u) => catRow(u, us)).join('') +
        '<div class="im-tr im-catrow im-catrow--fixed">' +
          '<div class="im-catrow-src"><span class="im-path"><span class="im-path-leaf muted">Zonder categorie</span></span></div>' +
          '<div class="im-catrow-n"><span class="mono">' + num(NO_CAT.n) + '</span><span class="only-phone"> transacties</span></div>' +
          '<div class="im-catrow-sum mono">' + eur(NO_CAT.sum) + '</div>' +
          '<span class="im-arrow" aria-hidden="true">' + icon('arrowRight', 16, 2) + '</span>' +
          '<div class="im-catrow-tgt"><span class="im-fixed">Niet categoriseren</span><span class="im-hint">Je regels en suggesties beslissen later.</span></div>' +
        '</div>' +
      '</section>' +
      '<div class="im-grid2' + anim('anim-in', 120) + '">' +
        '<section class="im-card" aria-labelledby="im-merge-h"><h3 class="im-card-title" id="im-merge-h">' + icon('merge', 16, 2.2) + 'Samengevoegd</h3>' +
          (ms.length
            ? '<p class="im-help">Deze categorieën uit ' + esc(src) + ' komen samen in één categorie van Saldo.</p><ul class="im-merges">' +
              ms.map((m) => '<li>' + catChip(m.v) + '<span class="im-merges-from">' + esc(m.units.map((u) => u.label).join(' + ')) + '</span>' +
                '<span class="im-merges-n mono">' + num(m.units.reduce((a, u) => a + u.n, 0)) + ' · ' + eur(m.units.reduce((a, u) => a + u.sum, 0), true) + '</span></li>').join('') + '</ul>'
            : '<p class="im-help">Kies dezelfde categorie bij meerdere rijen om ze samen te voegen.</p>') +
        '</section>' +
        '<section class="im-card" aria-labelledby="im-new-h"><h3 class="im-card-title" id="im-new-h">' + icon('plus', 16, 2.4) + 'Nieuwe categorieën</h3>' +
          (newNames.length
            ? '<div class="im-newcats">' + newNames.map((n) => catChip('new', n)).join('') + '</div><p class="im-help">Saldo maakt ze aan als hoofdcategorie bij Categorieën en regels. Daar kan je ze later verplaatsen of hernoemen.</p>'
            : '<p class="im-help">Geen. Alles komt in een bestaande categorie.</p>') +
        '</section>' +
      '</div>' +
      actionBar(prevBtn('stap-2'), nextBtn('Volgende', true), nothingSaved);
  }

  // ---------- Stap 4 · Voorbeeld ----------

  function dupRow(d) {
    const s = srcById(d.src);
    const forced = !!wz.forced[d.id];
    const target = targetOf(s);
    const gets = !d.sCat && wz.applyCats && !forced && target !== 'none';
    const why = [d.off === 0 ? 'zelfde dag' : '1 dag verschil', 'zelfde bedrag', d.sName.toLowerCase() === d.name.toLowerCase() ? 'zelfde naam' : 'naam lijkt erop'];
    return '<div class="im-dup' + (forced ? ' is-forced' : '') + '">' +
      '<div class="im-dup-side"><span class="im-dup-tag">In het bestand</span>' +
        '<span class="im-dup-line"><span class="im-dup-date">' + esc(shortDate(d.date)) + '</span><span class="im-dup-name">' + esc(d.name) + '</span><span class="im-dup-amt mono">' + eur(d.amt, d.amt > 0) + '</span></span>' +
        '<span class="im-dup-cat">' + esc(srcLabel(s)) + '</span></div>' +
      '<span class="im-dup-eq" aria-hidden="true">≈</span>' +
      '<div class="im-dup-side"><span class="im-dup-tag">Al in Saldo · batch 1</span>' +
        '<span class="im-dup-line"><span class="im-dup-date">' + esc(shortDate(d.sDate)) + '</span><span class="im-dup-name">' + esc(d.sName) + '</span><span class="im-dup-amt mono">' + eur(d.amt, d.amt > 0) + '</span></span>' +
        '<span class="im-dup-cat">' + (d.sCat ? esc(catText(d.sCat)) : '<span class="im-dup-uncat">Niet gecategoriseerd</span>' +
          (gets ? ' <span class="im-dup-gets">' + icon('arrowRight', 12, 2.4) + 'krijgt ' + esc(target === 'new' ? newNameOf(s) : catText(target)) + '</span>' : '')) + '</span></div>' +
      '<div class="im-dup-foot"><span class="im-dup-why">' + esc(why.join(' · ')) + '</span>' +
        '<button type="button" class="im-force" aria-pressed="' + forced + '" data-action="force" data-id="' + d.id + '" data-key="force-' + d.id + '">' +
          (forced ? icon('check', 14, 2.6) + 'Wordt geïmporteerd' : 'Toch importeren') + '</button></div>' +
    '</div>';
  }

  function step4() {
    const s = stats();
    const name = s.acc === 'nieuw' ? (wz.newName.trim() || 'nieuwe rekening') : accName(s.acc);
    let cut;
    if (s.first) {
      const warn = s.cut > s.first
        ? notice('warn', 'warning', 'Vanaf ' + fullDate(s.first) + ' komen je transacties al van de bank. De ' + num(s.extra) + ' rijen tussen ' + fullDate(s.first) + ' en ' + fullDate(s.cut) + ' tellen als waarschijnlijke dubbels.')
        : s.cut < s.first ? notice('warn', 'warning', 'De rijen van ' + fullDate(s.cut) + ' tot ' + fullDate(s.first) + ' komen niet van de bank. Met deze grens ontbreken ze in Saldo.') : '';
      cut = '<section class="im-card im-cut' + anim('anim-in', 60) + '" aria-labelledby="im-cut-h">' +
        '<div class="im-cut-head">' + tile('calendar', 'var(--soft)', 'var(--greenText)') +
          '<div><h3 class="im-card-title" id="im-cut-h">Importgrens</h3><p class="im-cut-text">Je ' + esc(name) + ' wordt gesynchroniseerd sinds ' + fullDate(s.first) + '. We importeren alleen wat daarvoor ligt.</p></div></div>' +
        '<div class="im-cut-field"><div class="field"><label class="field-label" for="im-cutoff">Importeren tot</label>' +
          '<input class="input im-date" type="date" id="im-cutoff" value="' + s.cut + '" min="' + FILE.from + '" max="' + END + '" data-change="cutoff" data-key="cutoff"></div>' +
          (s.cut !== s.first ? '<button type="button" class="im-link" data-action="cut-reset" data-key="cut-reset">Terug naar ' + fullDate(s.first) + '</button>' : '<span class="im-badge im-badge--ok">Voorstel</span>') +
        '</div>' + warn + '</section>';
    } else {
      cut = '<section class="im-card im-cut' + anim('anim-in', 60) + '" aria-labelledby="im-cut-h">' +
        '<div class="im-cut-head">' + tile('calendar', 'var(--soft)', 'var(--greenText)') +
          '<div><h3 class="im-card-title" id="im-cut-h">Geen importgrens</h3><p class="im-cut-text">' +
          (s.acc === 'nieuw' ? 'Je nieuwe rekening ' + esc(name) + ' wordt niet gesynchroniseerd.' : 'Je ' + esc(name) + ' wordt niet gesynchroniseerd.') +
          ' Er is dus niets om mee te overlappen: we importeren alle rijen.</p></div></div></section>';
    }
    const stat = (n, label, cls) => '<div class="im-stat' + (cls ? ' im-stat--' + cls : '') + '"><span class="im-stat-n mono">' + num(n) + '</span><span class="im-stat-l">' + label + '</span></div>';
    const lastDay = s.cut ? addDays(s.cut, -1) : FILE.to;
    const listed = wz.showAll ? s.listed : s.listed.slice(0, 4);

    const dups = s.dups ? '<section class="im-sec' + anim('anim-in', 120) + '" aria-labelledby="im-dup-h">' +
      '<div class="im-sec-head"><h3 class="im-sec-title" id="im-dup-h">Waarschijnlijke dubbels</h3><span class="im-sec-meta">' + num(s.skippedDups) + ' overgeslagen</span></div>' +
      '<p class="im-help">Zelfde bedrag, hoogstens één dag verschil en een tegenpartij die erop lijkt. We slaan ze over, tenzij je kiest voor \u2018Toch importeren\u2019.</p>' +
      (s.listed.length ? '<div class="im-card im-apply"><div class="im-toggle">' +
        '<span class="im-toggle-text"><span class="im-toggle-name" id="im-apply-l">Bilance-categorie gebruiken voor ' + plural(s.applyable, 'bestaande transactie', 'bestaande transacties') + ' zonder categorie</span>' +
        '<span class="im-toggle-sub">Alleen voor overgeslagen dubbels die in Saldo nog geen categorie hebben. Een categorie die je zelf koos, blijft.</span></span>' +
        '<button type="button" class="switch" role="switch" aria-checked="' + wz.applyCats + '" aria-labelledby="im-apply-l" data-action="apply-toggle" data-key="apply-toggle"' + (s.applyable ? '' : ' disabled') + '></button></div></div>' : '') +
      '<div class="im-dups">' + listed.map(dupRow).join('') + '</div>' +
      (s.listed.length > 4 ? '<button type="button" class="im-more" data-action="dups-all" data-key="dups-all" aria-expanded="' + wz.showAll + '">' +
        (wz.showAll ? 'Toon minder' : 'Toon alle ' + s.listed.length + ' dubbels') + '</button>' : '') +
      (s.extra ? '<p class="im-help">En ' + plural(s.extra, 'rij', 'rijen') + ' na ' + fullDate(s.first) + ' die al van de bank kwam' + (s.extra === 1 ? '' : 'en') + '. Die slaan we ook over.</p>' : '') +
    '</section>' : '';

    const prev = '<section class="im-sec' + anim('anim-in', 150) + '" aria-labelledby="im-prev-h">' +
      '<div class="im-sec-head"><h3 class="im-sec-title" id="im-prev-h">Eerste rijen</h3><span class="im-sec-meta">' + PREVIEW.length + ' van ' + num(s.fresh) + '</span></div>' +
      '<div class="im-card im-card--table">' +
        '<div class="im-th im-prevrow only-desktop"><span>Datum</span><span>Tegenpartij</span><span>Categorie in Saldo</span><span>Bedrag</span></div>' +
        PREVIEW.map((r) => {
          const src = srcById(r[3]);
          const t = catColumn() ? targetOf(src) : 'none';
          return '<div class="im-tr im-prevrow">' +
            '<span class="im-prevrow-date">' + esc(shortDate(r[0])) + '</span>' +
            '<span class="im-prevrow-main"><span class="im-prevrow-name">' + esc(r[1]) + '</span>' + (r[2] ? '<span class="im-prevrow-memo">' + esc(r[2]) + '</span>' : '') + '</span>' +
            '<span class="im-prevrow-cat">' + catChip(t, newNameOf(src)) + '</span>' +
            '<span class="im-prevrow-amt mono' + (r[4] > 0 ? '' : ' neg') + '">' + eur(r[4], r[4] > 0) + '</span>' +
          '</div>';
        }).join('') +
      '</div></section>';

    const commit = '<button type="button" class="im-btn im-btn--primary" data-action="commit" data-key="commit"' + (isOffline() || !s.fresh || busy ? ' disabled' : '') + '>' +
      (busy === 'import' ? '<span class="im-spin" aria-hidden="true"></span>Bezig met importeren…' : icon('upload', 16, 2.4) + 'Importeer ' + num(s.fresh) + ' transacties') + '</button>';

    return stepTitle('Controleer voor je importeert', 'Dit is wat er in je ' + esc(name) + ' komt. Pas de grens aan of kies dubbels die je toch wil.') +
      cut +
      '<div class="im-stats' + anim('anim-in', 90) + '">' +
        stat(s.fresh, 'nieuw', 'new') + stat(s.after, s.first ? 'na de grens overgeslagen' : 'na de grens', '') + stat(s.dups, 'waarschijnlijke dubbels', s.dups ? 'warn' : '') +
      '</div>' +
      '<p class="im-range' + anim('anim-in', 100) + '">Van ' + fullDate(FILE.from) + ' tot ' + fullDate(lastDay) + ' · ' + accPill(s.acc) + '</p>' +
      dups + prev +
      (isOffline() ? offNote('Importeren kan weer zodra je verbinding hebt.') : '') +
      actionBar(prevBtn('stap-3'), commit, '<span class="only-desktop">Je kan de import daarna in één keer ongedaan maken.</span>');
  }

  // ---------- Stap 5 · Resultaat ----------

  function step5() {
    const b = imported;
    const name = accName(b.acc, b);
    if (b.undone) {
      return '<section class="im-card im-done' + anim('anim-in', 40) + '">' +
        '<span class="im-done-icon im-done-icon--undone">' + icon('undo', 26, 2.4) + '</span>' +
        '<h2 id="im-step-h" tabindex="-1">Import ongedaan gemaakt</h2>' +
        '<p class="im-done-sub">Batch ' + b.id + ' is ongedaan gemaakt. De ' + num(b.imported) + ' transacties zijn weer weg uit je ' + esc(name) + '. De koppeling voor ' + esc(b.source) + ' blijft bewaard.</p>' +
        batchRow(b) +
        '<div class="im-done-actions"><button type="button" class="im-btn im-btn--primary" data-action="restart" data-key="restart">Opnieuw beginnen</button>' +
          '<a class="im-btn im-btn--ghost" href="#start">Terug naar Importeren</a></div>' +
      '</section>';
    }
    const fact = (ic, html) => '<li>' + '<span class="im-done-fact-icon">' + icon(ic, 16, 2.2) + '</span><span>' + html + '</span></li>';
    const facts = [];
    if (b.cutoffSkip) facts.push(fact('calendar', '<strong>' + num(b.cutoffSkip) + '</strong> rijen overgeslagen vanaf de importgrens van ' + fullDate(b.cut) + ': die komen van de bank.'));
    if (b.dupSkip) facts.push(fact('close', '<strong>' + num(b.dupSkip) + '</strong> waarschijnlijke dubbels overgeslagen' + (b.forced ? ', ' + num(b.forced) + ' toch geïmporteerd' : '') + '.'));
    if (b.catApplied) facts.push(fact('tag', '<strong>' + num(b.catApplied) + '</strong> bestaande transacties kregen hun Bilance-categorie.'));
    if (b.cats) facts.push(fact('link', '<strong>' + b.cats + '</strong> categorieën gekoppeld en bewaard voor ' + esc(b.source) + (b.newCats.length ? ' · nieuw: ' + esc(b.newCats.join(', ')) : '') + '.'));
    const next = (href, ic, bg, title, sub) => '<a class="im-next" href="' + href + '">' + tile(ic, bg) +
      '<span class="im-next-main"><span class="im-next-name">' + esc(title) + '</span><span class="im-next-sub">' + esc(sub) + '</span></span>' +
      '<span class="im-chev">' + icon('chevron', 16, 2.2) + '</span></a>';
    return '<section class="im-card im-done' + anim('anim-in', 40) + '" aria-labelledby="im-step-h">' +
        '<span class="im-done-icon">' + icon('check', 28, 2.8) + '</span>' +
        '<h2 id="im-step-h" tabindex="-1">' + num(b.imported) + ' transacties geïmporteerd</h2>' +
        '<p class="im-done-sub">In je ' + esc(name) + ', van ' + fullDate(b.from) + ' tot ' + fullDate(b.to) + '. Bewaard als batch ' + b.id + ': je kan de hele import in één keer ongedaan maken.</p>' +
        batchRow(b) +
        (isOffline() ? offNote('Ongedaan maken kan weer zodra je verbinding hebt.') : '') +
      '</section>' +
      (facts.length ? '<section class="im-card' + anim('anim-in', 80) + '" aria-label="Wat er gebeurde"><ul class="im-done-facts">' + facts.join('') + '</ul></section>' : '') +
      '<section class="im-sec' + anim('anim-in', 120) + '" aria-labelledby="im-next-h">' +
        '<div class="im-sec-head"><h3 class="label" id="im-next-h">Volgende stappen</h3></div>' +
        '<div class="im-nexts">' +
          next('overzicht.html', 'chart', 'var(--c1)', 'Overzicht', 'Je uitgaven sinds ' + dt(b.from).getFullYear() + ', per maand en categorie') +
          next('categorieen.html', 'tag', 'var(--c3)', 'Categorieën en regels', 'Saldo leerde uit je geschiedenis: bekijk de nieuwe suggesties') +
        '</div>' +
        '<a class="im-back-link" href="#start">' + icon('back', 16, 2.4) + 'Terug naar Importeren</a>' +
      '</section>';
  }

  function viewWizard(r) {
    const step = r === 'al-geimporteerd' ? 1 : (r === 'ongedaan-maken' ? 5 : Number(r.slice(5)));
    if (step === 5 && !imported) createImported();
    const body = r === 'al-geimporteerd' ? stepDupe() : [null, step1, step2, step3, step4, step5][step]();
    const sub = step === 5 ? esc(FILE.name) + ' · ' + esc(imported.source) : (r === 'al-geimporteerd' ? 'Bestand kiezen' : esc(FILE.name) + ' · ' + esc(presetName(wz.preset)));
    return header('Importeren', sub, 'start') + stepper(step) + '<div class="im-body">' + body + '</div>';
  }

  // ---------- Dialogs (sheet on phone, centred on desktop) ----------

  function undoDialog(b) {
    return '<div class="im-dlg-head"><span class="im-dlg-icon im-dlg-icon--neg">' + icon('undo', 20, 2.2) + '</span>' +
        '<h2 id="im-dlg-h">Batch ' + b.id + ' ongedaan maken?</h2>' +
        '<button type="button" class="im-close" aria-label="Sluiten" data-action="close" data-key="dlg-close">' + icon('close', 18, 2.4) + '</button></div>' +
      '<p>De ' + num(b.imported) + ' transacties uit <strong>' + esc(b.file) + '</strong> verdwijnen uit je ' + esc(accName(b.acc, b)) + '. Andere transacties blijven staan.</p>' +
      (b.catApplied ? '<p>De ' + num(b.catApplied) + ' categorieën die deze import aan bestaande transacties gaf, zetten we terug.</p>' : '') +
      (b.acc === 'gedeeld' ? '<p>Ook ' + esc(D.partner.name) + ' ziet ze dan niet meer.</p>' : '') +
      '<p class="muted">De koppeling voor ' + esc(b.source) + ' blijft bewaard. Je kan het bestand later opnieuw importeren.</p>' +
      '<div class="im-dlg-actions"><button type="button" class="im-btn im-btn--ghost" data-action="close" data-key="dlg-cancel">Annuleren</button>' +
        '<button type="button" class="im-btn im-btn--neg" data-action="undo-confirm" data-id="' + b.id + '" data-key="dlg-ok"' + offAttr() + '>Ongedaan maken</button></div>';
  }

  // Batches a Bilance mapping can be re-applied to (active, editable)
  const applyTargets = () => batches.filter((b) => b.source === 'Bilance' && !b.undone && !D.readOnly(b.acc));

  function mapDialog() {
    const d = dialog;
    const close = '<button type="button" class="im-close" aria-label="Sluiten" data-action="close" data-key="dlg-close">' + icon('close', 18, 2.4) + '</button>';
    if (d.source === 'argenta') {
      const cols = [['Boekingsdatum', 'Datum'], ['Bedrag', 'Bedrag'], ['Naam tegenpartij', 'Tegenpartij'], ['Rekening tegenpartij', 'IBAN tegenpartij'], ['Mededeling', 'Mededeling'], ['Valutadatum', 'Negeren']];
      return '<div class="im-dlg-head">' + tile('link', 'var(--c1)') + '<div class="im-dlg-title"><h2 id="im-dlg-h">Koppeling voor Argenta-export</h2><span>Ingebouwd · gebruikt bij batch 1</span></div>' + close + '</div>' +
        '<section class="im-dlg-sec"><h3 class="label">Kolommen</h3><ul class="im-colmap">' + cols.map((c) => '<li><span>' + esc(c[0]) + '</span>' + icon('arrowRight', 14, 2.2) + '<strong>' + esc(c[1]) + '</strong></li>').join('') + '</ul>' +
        '<p class="im-help">Notatie dd/mm/jjjj, decimale komma, puntkomma. Een Argenta-export heeft geen categorieën: je regels en suggesties categoriseren.</p></section>' +
        '<div class="im-dlg-actions"><button type="button" class="im-btn im-btn--ghost" data-action="close" data-key="dlg-cancel">Sluiten</button>' +
          '<button type="button" class="im-btn im-btn--primary" data-action="map-cols" data-key="dlg-cols">Kolommen aanpassen</button></div>';
    }
    const ids = SRC.filter((s) => d.draft[s.id] !== undefined).map((s) => s.id);
    const used = batches.filter((b) => b.source === 'Bilance' && !b.undone);
    const first = batches.slice().reverse().find((b) => b.source === 'Bilance');
    const targets = applyTargets();
    const cols = COLS.map((c) => [c.h, fieldName(c.def)]);
    const rows = ids.map((id) => {
      const s = srcById(id);
      return '<div class="im-mrow"><span class="im-mrow-src">' + pathHtml({ kind: 'src', parent: s.parent, leaf: s.leaf }) + '</span>' +
        catSelect('m-' + id, d.draft[id], d.draft[id] === 'new' ? s.leaf : '', 'Categorie in Saldo voor ' + srcLabel(s), 'map-cat', ' data-id="' + id + '"') + '</div>';
    }).join('');
    const accRows = d.accDraft.map((a, i) => '<div class="im-mrow"><span class="im-mrow-src"><span class="im-path-leaf">' + esc(a[0]) + '</span></span>' +
      selectEl('ma-' + i, accountOptions(a[1], true), a[1], 'map-acc', 'Rekening in Saldo voor ' + a[0], ' data-i="' + i + '"') + '</div>').join('');
    const apply = targets.length
      ? '<section class="im-dlg-sec im-dlg-apply" id="im-apply"><h3 class="label">Opnieuw toepassen</h3>' +
        '<p class="im-help">Pas je de koppeling aan, dan kan je ze opnieuw toepassen op een import. Saldo zet dan de categorie van die transacties opnieuw. Een categorie die je zelf koos bij een transactie, blijft staan.</p>' +
        '<div class="im-apply-row">' + selectEl('apply-batch', targets.map((b) => [String(b.id), 'Batch ' + b.id + ' · ' + b.file + ' · ' + accName(b.acc, b)]), String(d.batch), 'map-batch', 'Import') +
        '<button type="button" class="im-btn im-btn--soft" data-action="map-reapply" data-key="dlg-reapply"' + offAttr() + '>' + icon('sync', 15, 2.2) + 'Opnieuw toepassen</button></div></section>'
      : '';
    return '<div class="im-dlg-head">' + tile('link', 'var(--c4)') + '<div class="im-dlg-title"><h2 id="im-dlg-h">Koppeling voor Bilance</h2>' +
        '<span>' + (first ? 'Bewaard sinds ' + dayMonth(first.date) + ' · gebruikt bij ' + (used.length ? used.map((b) => 'batch ' + b.id).join(' en ') : 'geen actieve import') : 'Standaardkolommen, nog niet gebruikt') + '</span></div>' + close + '</div>' +
      '<section class="im-dlg-sec"><h3 class="label">Kolommen</h3><ul class="im-colmap">' + cols.map((c) => '<li><span>' + esc(c[0]) + '</span>' + icon('arrowRight', 14, 2.2) + '<strong>' + esc(c[1]) + '</strong></li>').join('') + '</ul>' +
        '<p class="im-help">Notatie dd/mm/jjjj, decimale komma, puntkomma, UTF-8. Kolommen pas je aan in stap 2 van een import.</p></section>' +
      '<section class="im-dlg-sec"><h3 class="label">Categorieën · ' + ids.length + '</h3>' +
        (ids.length ? '<div class="im-mrows">' + rows + '</div>' : '<p class="im-help">Nog geen categorieën gekoppeld. Dat doe je bij je eerste import van een Bilance-bestand.</p>') + '</section>' +
      (d.accDraft.length ? '<section class="im-dlg-sec"><h3 class="label">Rekeningnamen · ' + d.accDraft.length + '</h3><div class="im-mrows">' + accRows + '</div></section>' : '') +
      apply +
      (isOffline() ? offNote('Bewaren kan weer zodra je verbinding hebt.') : '') +
      '<div class="im-dlg-actions"><button type="button" class="im-btn im-btn--ghost" data-action="close" data-key="dlg-cancel">Annuleren</button>' +
        '<button type="button" class="im-btn im-btn--primary" data-action="map-save" data-key="dlg-save"' + offAttr() + '>Opslaan</button></div>';
  }

  let returnFocus = null;

  function openDialog(d, from) {
    closeDialog(true, true);
    dialog = d;
    returnFocus = from || null;
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop im-backdrop';
    wrap.innerHTML = '<div class="sheet im-sheet' + (d.kind === 'map' ? ' im-sheet--wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="im-dlg-h">' +
      '<div class="sheet-grip" aria-hidden="true"></div><div class="im-dlg">' + dialogHtml() + '</div></div>';
    document.body.appendChild(wrap);
    document.body.classList.add('im-locked');
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeDialog(); else onClick(e); });
    wrap.addEventListener('change', onChange);
    const focus = d.focusApply ? wrap.querySelector('#im-apply-batch') : wrap.querySelector('[data-key="dlg-close"]');
    if (d.focusApply) {
      const sec = wrap.querySelector('#im-apply');
      if (sec) sec.scrollIntoView({ block: 'center' });
    }
    if (focus) focus.focus();
  }

  function dialogHtml() {
    return dialog.kind === 'undo' ? undoDialog(batches.find((b) => b.id === dialog.id)) : mapDialog();
  }

  function repaintDialog() {
    const box = document.querySelector('.im-backdrop .im-dlg');
    if (box) keepFocus(() => { box.innerHTML = dialogHtml(); }, box);
  }

  function closeDialog(silent, keepHash) {
    const wrap = document.querySelector('.im-backdrop');
    if (wrap) wrap.remove();
    document.body.classList.remove('im-locked');
    const had = !!dialog;
    dialog = null;
    if (keepHash) return;
    // Leave the dialog deep links so a reload does not reopen them
    if (route === 'koppeling') { route = 'start'; history.replaceState(null, '', '#start'); }
    if (route === 'ongedaan-maken') { route = 'stap-5'; history.replaceState(null, '', '#stap-5'); }
    if (!silent && had && returnFocus) {
      const el = page.querySelector('[data-key="' + returnFocus + '"]');
      if (el) el.focus();
    }
  }

  function openMap(source, focusApply, batchId, from) {
    const targets = applyTargets();
    openDialog({ kind: 'map', source, focusApply, draft: Object.assign({}, saved), accDraft: accNames.map((a) => a.slice()),
      batch: batchId || (targets[0] ? targets[0].id : 0) }, from);
  }

  // ---------- Painting and routing ----------

  const ROUTES = ['start', 'geschiedenis', 'stap-1', 'stap-2', 'stap-3', 'stap-4', 'stap-5', 'al-geimporteerd', 'koppeling', 'ongedaan-maken'];
  const readRoute = () => { const h = location.hash.replace('#', ''); return ROUTES.indexOf(h) >= 0 ? h : 'start'; };

  function paint() {
    const r = route;
    const wizard = /^stap-|al-geimporteerd|ongedaan-maken/.test(r);
    page.classList.toggle('im-page--wizard', wizard);
    page.innerHTML = (r === 'start' || r === 'koppeling') ? viewStart() : (r === 'geschiedenis' ? viewHistory() : viewWizard(r));
    painted = true;
  }

  // Re-render while keeping keyboard focus on the same control
  function keepFocus(fn, scope) {
    const a = document.activeElement;
    const key = a && a.dataset ? a.dataset.key : null;
    fn();
    if (!key) return;
    const el = (scope || page).querySelector('[data-key="' + key + '"]');
    if (el && el.getClientRects().length) el.focus();
  }
  const refresh = () => keepFocus(paint);

  function onRoute(userNav) {
    closeDialog(true, true);
    route = readRoute();
    if (route !== 'geschiedenis') highlight = 0;
    painted = false;
    paint();
    if (route === 'koppeling') openMap('bilance');
    if (route === 'ongedaan-maken' && imported && !imported.undone) openDialog({ kind: 'undo', id: imported.id });
    if (!userNav) return;
    const hl = highlight && page.querySelector('#batch-' + highlight);
    if (hl) hl.scrollIntoView({ block: 'center' });
    else window.scrollTo(0, 0);
    const h = page.querySelector('#im-step-h') || page.querySelector('h1');
    if (h && !dialog) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function go(r) {
    const h = '#' + r;
    if (location.hash === h) onRoute(true);
    else location.hash = h;
  }

  // ---------- Actions ----------

  const NEXT = { 'stap-1': 'stap-2', 'stap-2': 'stap-3', 'stap-3': 'stap-4' };

  function pick() {
    if (isOffline()) { S.shell.toast('Je bent offline'); return; }
    if (busy) return;
    busy = 'read';
    refresh();
    setTimeout(() => {
      busy = '';
      if (imported && !imported.undone) go('al-geimporteerd');
      else { wz = freshWizard(); go('stap-1'); }
    }, 700);
  }

  function commit() {
    if (isOffline()) { S.shell.toast('Je bent offline'); return; }
    if (busy) return;
    busy = 'import';
    refresh();
    S.shell.progress(true);
    setTimeout(() => {
      busy = '';
      S.shell.progress(false);
      createImported();
      go('stap-5');
    }, 1200);
  }

  function undoBatch(id) {
    const b = batches.find((x) => x.id === id);
    if (!b) return;
    b.undone = D.today;
    closeDialog();
    refresh();
    S.shell.toast('Batch ' + id + ' ongedaan gemaakt');
  }

  function reapply() {
    const d = dialog;
    const b = batches.find((x) => x.id === Number(d.batch));
    if (!b) return;
    const before = b.map || {};
    const changed = SRC.filter((s) => d.draft[s.id] !== undefined && d.draft[s.id] !== before[s.id]);
    saved = Object.assign({}, d.draft);
    accNames = d.accDraft.map((a) => a.slice());
    b.map = Object.assign({}, saved);
    const n = changed.reduce((a, s) => a + (b.id === 3 ? (SAVED_N[s.id] || 0) : s.n), 0);
    closeDialog();
    refresh();
    S.shell.toast(changed.length ? 'Toegepast op batch ' + b.id + ' · ' + plural(n, 'transactie', 'transacties') + ' bijgewerkt (mockup)' : 'Batch ' + b.id + ' volgt de koppeling al. Er verandert niets.');
  }

  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const act = el.dataset.action;
    const key = el.dataset.key;
    if (act === 'go') go(el.dataset.to);
    else if (act === 'pick') pick();
    else if (act === 'pick-other') {
      if (isOffline()) { S.shell.toast('Je bent offline'); return; }
      S.shell.toast('Mockup: je kiest altijd het demobestand');
      if (route === 'al-geimporteerd') { wz = freshWizard(); go('stap-1'); }
    } else if (act === 'next') { if (NEXT[route]) go(NEXT[route]); }
    else if (act === 'commit') commit();
    else if (act === 'seg') {
      wz[el.dataset.group] = el.dataset.value;
      if (el.dataset.group === 'targetMode') { wz.cutoff = SYNC_FROM[targetAcc()] || null; wz.forced = {}; }
      refresh();
    } else if (act === 'parent-toggle') {
      wz.parentMode = !wz.parentMode;
      if (wz.parentMode) PARENTS.forEach((g) => {
        if (wz.parentMap[g.name] === undefined) { wz.parentDef[g.name] = parentDefault(g); wz.parentMap[g.name] = wz.parentDef[g.name]; }
      });
      refresh();
    } else if (act === 'force') { wz.forced[el.dataset.id] = !wz.forced[el.dataset.id]; refresh(); }
    else if (act === 'apply-toggle') { wz.applyCats = !wz.applyCats; refresh(); }
    else if (act === 'dups-all') { wz.showAll = !wz.showAll; refresh(); }
    else if (act === 'cut-reset') { wz.cutoff = SYNC_FROM[targetAcc()] || null; refresh(); }
    else if (act === 'undo') openDialog({ kind: 'undo', id: Number(el.dataset.id) }, key);
    else if (act === 'undo-confirm') undoBatch(Number(el.dataset.id));
    else if (act === 'map-edit') openMap(el.dataset.src, false, 0, key);
    else if (act === 'map-apply') openMap('bilance', true, Number(el.dataset.batch) || 0, key);
    else if (act === 'map-cols') { closeDialog(); S.shell.toast('Kolommen pas je aan bij een import (mockup)'); }
    else if (act === 'map-save') {
      saved = Object.assign({}, dialog.draft);
      accNames = dialog.accDraft.map((a) => a.slice());
      closeDialog();
      refresh();
      S.shell.toast('Koppeling voor Bilance bewaard');
    } else if (act === 'map-reapply') reapply();
    else if (act === 'close') closeDialog();
    else if (act === 'view-tx') S.shell.toast('Transacties uit batch ' + el.dataset.id + ' tonen (mockup)');
    else if (act === 'see-batch') { highlight = Number(el.dataset.id); go('geschiedenis'); }
    else if (act === 'restart') { wz = freshWizard(); imported = null; go('stap-1'); }
  }

  function onChange(e) {
    const el = e.target;
    const ch = el.dataset && el.dataset.change;
    if (!ch) return;
    const v = el.value;
    if (ch === 'preset') wz.preset = v;
    else if (ch === 'sep') wz.sep = v;
    else if (ch === 'enc') wz.enc = v;
    else if (ch === 'col') wz.cols[Number(el.dataset.i)] = v;
    else if (ch === 'datefmt') wz.dateFmt = v;
    else if (ch === 'target' || ch === 'fileacc') {
      if (ch === 'target') wz.target = v; else wz.fileAcc = v;
      wz.cutoff = SYNC_FROM[targetAcc()] || null;
      wz.forced = {};
    } else if (ch === 'cat') {
      const k = el.dataset.unit;
      if (k.indexOf('p:') === 0) wz.parentMap[k.slice(2)] = v; else wz.catMap[k] = v;
    } else if (ch === 'cutoff') {
      if (!v) return;
      wz.cutoff = v < FILE.from ? FILE.from : (v > END ? END : v);
    } else if (ch === 'map-cat') { dialog.draft[el.dataset.id] = v; repaintDialog(); return; }
    else if (ch === 'map-acc') { dialog.accDraft[Number(el.dataset.i)][1] = v; return; }
    else if (ch === 'map-batch') { dialog.batch = Number(v); return; }
    else return;
    refresh();
  }

  function onInput(e) {
    const el = e.target;
    if (el.dataset && el.dataset.input === 'newname') {
      wz.newName = el.value;
      // Only the error line and the next button depend on the name; update them without a re-render.
      const ok = !step2Problems().length;
      const next = page.querySelector('[data-action="next"]');
      if (next) next.disabled = !ok;
    }
  }

  // Desktop drop zone (mockup: any dropped file stands for the demo file)
  function onDrag(e) {
    const zone = e.target.closest && e.target.closest('[data-drop]');
    if (!zone) return;
    e.preventDefault();
    zone.classList.toggle('is-over', e.type === 'dragover');
    if (e.type === 'drop') { S.shell.toast('Mockup: we gebruiken het demobestand'); pick(); }
  }

  // ---------- Screen ----------

  function render(p) {
    page = p;
    if (!wz) boot();
    route = readRoute();
    painted = false;
    paint();
    if (!page.dataset.imWired) {
      page.dataset.imWired = '1';
      page.addEventListener('click', onClick);
      page.addEventListener('change', onChange);
      page.addEventListener('input', onInput);
      ['dragover', 'dragleave', 'drop'].forEach((t) => page.addEventListener(t, onDrag));
      window.addEventListener('hashchange', () => onRoute(true));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialog) closeDialog(); });
      if (route === 'koppeling') openMap('bilance');
      if (route === 'ongedaan-maken' && imported && !imported.undone) openDialog({ kind: 'undo', id: imported.id });
    }
  }

  S.screens = S.screens || {};
  S.screens.importeren = { title: 'Importeren', render };
})(window.Saldo = window.Saldo || {});
