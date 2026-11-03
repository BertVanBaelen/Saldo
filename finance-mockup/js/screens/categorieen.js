// Categorieën en regels: the category tree shared by all users, the viewer's rules by priority, and
// learned suggestions to confirm. Not on the design boards: derived from Rekeningen (phone: Meer sub page
// with bottom sheets; desktop: list with a side panel editor) and Planning (tabs).
// Spec: analysis/screens/categorieen.md. Concepts: category, categorisation-rule.
(function (S) {
  'use strict';

  const { eur0, esc } = S.fmt;
  const icon = S.icon;
  const D = S.data;

  // Four-point spark for learned suggestions (24 grid, stroke)
  S.icons.paths.spark = '<path d="M12 3c.8 5 4 8.2 9 9-5 .8-8.2 4-9 9-.8-5-4-8.2-9-9 5-.8 8.2-4 9-9Z"></path>';

  const deskMq = window.matchMedia('(min-width: 1024px)');
  const isDesk = () => deskMq.matches;

  const TABS = [['categorieen', 'Categorieën'], ['regels', 'Regels'], ['suggesties', 'Suggesties']];
  // The six category pastels (analysis/concepts/category.md); a colour may be used more than once.
  const PASTELS = [['c1', 'Lichtblauw'], ['c2', 'Abrikoos'], ['c3', 'Roze'], ['c4', 'Lavendel'], ['c5', 'Geel'], ['c6', 'Grijs']];

  // Default Dutch tree: [id, name, type (out = Uitgaven, in = Inkomsten), parent, pastel, n].
  // n = the viewer's own transactions directly in this category (about 12 months of demo history).
  const TREE = [
    ['wonen', 'Wonen', 'out', null, 'c1', 0],
    ['huur', 'Huur', 'out', 'wonen', null, 12],
    ['energie', 'Energie', 'out', 'wonen', null, 12],
    ['internet', 'Internet en tv', 'out', 'wonen', null, 12],
    ['verzekeringen', 'Verzekeringen', 'out', 'wonen', null, 9],
    ['boodschappen', 'Boodschappen', 'out', null, 'c2', 41],
    ['supermarkt', 'Supermarkt', 'out', 'boodschappen', null, 148],
    ['bakker', 'Bakker', 'out', 'boodschappen', null, 23],
    ['vrijetijd', 'Vrije tijd', 'out', null, 'c3', 12],
    ['uitgaan', 'Uitgaan', 'out', 'vrijetijd', null, 38],
    ['sport', 'Sport', 'out', 'vrijetijd', null, 14],
    ['cultuur', 'Cultuur', 'out', 'vrijetijd', null, 6],
    ['vakantie', 'Vakantie', 'out', 'vrijetijd', null, 9],
    ['vervoer', 'Vervoer', 'out', null, 'c4', 0],
    ['brandstof', 'Brandstof', 'out', 'vervoer', null, 26],
    ['ov', 'Openbaar vervoer', 'out', 'vervoer', null, 19],
    ['onderhoud', 'Onderhoud', 'out', 'vervoer', null, 3],
    ['abonnementen', 'Abonnementen', 'out', null, 'c5', 0],
    ['streaming', 'Streaming', 'out', 'abonnementen', null, 24],
    ['telefoon', 'Telefoon', 'out', 'abonnementen', null, 12],
    ['overig', 'Overig', 'out', null, 'c6', 27],
    ['salaris', 'Salaris', 'in', null, null, 12],
    ['terugbetaling', 'Terugbetaling', 'in', null, null, 9],
    ['bijdrage', 'Bijdrage', 'in', null, null, 12],
    ['overiginkomen', 'Overig inkomen', 'in', null, null, 3]
  ];

  // The viewer's transactions per counterparty, used for "Past op N transacties". small/big = how many are
  // under € 20 / over € 200; diff = how many are not in `cat` yet (and not chosen by hand); manual = chosen by hand.
  const SEEN = [
    { cp: 'Colruyt Laagste Prijzen', iban: 'BE11 •••• •••• 0071', comm: 'Bancontact · Colruyt Gent-Dampoort', acc: 'gedeeld', n: 16, small: 1, big: 1, cat: 'boodschappen', diff: 2, manual: 1 },
    { cp: 'Delhaize', iban: 'BE23 •••• •••• 1180', comm: 'Bancontact · Delhaize Gent', acc: 'gedeeld', n: 9, small: 0, big: 0, cat: 'supermarkt', diff: 0, manual: 0 },
    { cp: 'Albert Heijn', iban: 'BE52 •••• •••• 3307', comm: 'Bancontact · AH Gent Zuid', acc: 'gedeeld', n: 7, small: 1, big: 0, cat: 'supermarkt', diff: 0, manual: 0 },
    { cp: 'Carrefour Express', iban: 'BE64 •••• •••• 9021', comm: 'Bancontact · Carrefour Gent', acc: 'gedeeld', n: 5, small: 2, big: 0, cat: 'supermarkt', diff: 0, manual: 0 },
    { cp: 'Partner', iban: 'BE47 •••• •••• 2210', comm: 'Bijdrage gedeelde rekening', acc: 'gedeeld', n: 12, small: 0, big: 12, cat: 'bijdrage', diff: 0, manual: 0 },
    { cp: 'Immo Vandenberghe', iban: 'BE90 •••• •••• 0453', comm: 'Huur appartement', acc: 'zicht', n: 12, small: 0, big: 12, cat: 'huur', diff: 0, manual: 0 },
    { cp: 'TotalEnergies', iban: 'BE30 •••• •••• 5512', comm: 'Bancontact · TotalEnergies Merelbeke', acc: 'zicht', n: 18, small: 2, big: 0, cat: 'brandstof', diff: 0, manual: 0 },
    { cp: 'Netflix', iban: 'NL18 •••• •••• 6620', comm: 'Netflix.com', acc: 'zicht', n: 12, small: 12, big: 0, cat: 'streaming', diff: 0, manual: 0 },
    { cp: 'Spotify', iban: 'SE35 •••• •••• 1043', comm: 'Spotify Premium', acc: 'zicht', n: 12, small: 12, big: 0, cat: 'streaming', diff: 0, manual: 0 },
    { cp: 'Kinepolis', iban: 'BE71 •••• •••• 2280', comm: 'Kinepolis Gent · 2 tickets', acc: 'zicht', n: 4, small: 0, big: 0, cat: 'cultuur', diff: 0, manual: 0 },
    { cp: 'NMBS', iban: 'BE08 •••• •••• 0019', comm: 'Treinticket Gent – Brussel', acc: 'zicht', n: 19, small: 14, big: 0, cat: 'ov', diff: 0, manual: 0 },
    { cp: 'Decathlon', iban: 'BE15 •••• •••• 4471', comm: 'Bancontact · Decathlon Gent', acc: 'zicht', n: 3, small: 0, big: 0, cat: 'sport', diff: 0, manual: 0 },
    { cp: 'Bakkerij De Graankorrel', iban: '', comm: 'Bancontact', acc: 'zicht', n: 11, small: 11, big: 0, cat: 'boodschappen', diff: 1, manual: 0 },
    { cp: "Frituur 't Pleintje", iban: '', comm: 'Payconiq', acc: 'zicht', n: 7, small: 6, big: 0, cat: 'vrijetijd', diff: 3, manual: 0 },
    { cp: 'Apotheek Van Damme', iban: '', comm: 'Bancontact', acc: 'zicht', n: 5, small: 3, big: 0, cat: 'overig', diff: 3, manual: 0 },
    { cp: 'Bol.com', iban: 'NL52 •••• •••• 8830', comm: 'Bestelling', acc: 'zicht', n: 6, small: 2, big: 0, cat: 'overig', diff: 4, manual: 2 }
  ];

  // Rules in priority order. owner: an account id (shared with its members who have Bewerken) or 'jij'
  // (the viewer's personal accounts only). Amounts in cents, without sign.
  const RULES = [
    { id: 1, owner: 'gedeeld', cpOp: 'bevat', cp: 'Colruyt', iban: '', comm: '', regex: false, min: 2000, max: 20000, cat: 'boodschappen' },
    { id: 2, owner: 'gedeeld', cpOp: 'bevat', cp: '', iban: 'BE47 •••• •••• 2210', comm: 'bijdrage', regex: false, min: null, max: null, cat: 'bijdrage' },
    { id: 3, owner: 'zicht', cpOp: 'bevat', cp: '', iban: 'BE90 •••• •••• 0453', comm: '', regex: false, min: null, max: null, cat: 'huur' },
    { id: 4, owner: 'jij', cpOp: 'bevat', cp: 'TotalEnergies', iban: '', comm: '', regex: false, min: null, max: null, cat: 'brandstof' },
    { id: 5, owner: 'jij', cpOp: 'bevat', cp: '', iban: '', comm: 'netflix|spotify|disney', regex: true, min: null, max: null, cat: 'streaming' },
    { id: 6, owner: 'jij', cpOp: 'is', cp: 'Kinepolis', iban: '', comm: '', regex: false, min: null, max: null, cat: 'cultuur' },
    { id: 7, owner: 'gedeeld', cpOp: 'bevat', cp: 'Delhaize', iban: '', comm: '', regex: false, min: null, max: null, cat: 'supermarkt' }
  ];

  // Learned suggestions (Saldo.data.suggestions = 3). open = uncategorised transactions waiting for this one.
  const SUGGESTIONS = [
    { id: 1, cp: 'Bakkerij De Graankorrel', cat: 'boodschappen', pct: 92, seen: 11, open: 1, acc: 'zicht' },
    { id: 2, cp: "Frituur 't Pleintje", cat: 'vrijetijd', pct: 64, seen: 7, open: 1, acc: 'zicht' },
    { id: 3, cp: 'Apotheek Van Damme', cat: 'overig', pct: 41, seen: 5, open: 1, acc: 'zicht' }
  ];

  // ---------- State ----------

  let page = null;
  let painted = false;
  let mode = null;
  let cats = [];
  let rules = [];
  let sugg = [];
  let seen = [];
  let uncat = 0;
  let nextRule = 8;
  let nextCat = 1;
  let returnFocus = null;
  let live = null;

  const ui = {
    tab: 'categorieen',
    selCat: 'wonen',
    selRule: 1,
    ed: null,      // { kind: 'cat' | 'del' | 'rule' | 'info', id, isNew, parent, from }
    draft: {},
    sheet: false,  // phone bottom sheet open
    flip: false,   // fade the desktop panel
    tabFlip: false
  };

  const offline = () => mode === 'offline';
  const empty = () => mode === 'leeg';

  function init() {
    mode = D.demo();
    cats = TREE.map((t) => ({ id: t[0], name: t[1], type: t[2], parent: t[3], color: t[4], n: empty() ? 0 : t[5] }));
    seen = empty() ? [] : SEEN.map((s) => Object.assign({}, s));
    rules = empty() ? [] : RULES.map((r) => Object.assign({}, r));
    sugg = empty() ? [] : SUGGESTIONS.map((s) => Object.assign({}, s));
    uncat = empty() ? 0 : D.toCategorise;
  }

  // ---------- Helpers ----------

  const cat = (id) => cats.find((c) => c.id === id);
  const rule = (id) => rules.find((r) => r.id === id);
  const kids = (id) => cats.filter((c) => c.parent === id);
  const tops = (type) => cats.filter((c) => !c.parent && c.type === type);
  const topOf = (c) => (c.parent ? cat(c.parent) : c);
  const total = (c) => c.n + kids(c.id).reduce((s, k) => s + k.n, 0);
  const plural = (n, one, more) => n + ' ' + (n === 1 ? one : more);
  const lower = (s) => (s.indexOf('IBAN') === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const SOFT = { bg: 'var(--soft)', fg: 'var(--greenText)' };
  const pastel = (key) => ({ bg: 'var(--' + key + ')', fg: key === 'c6' ? 'var(--onC6)' : 'var(--onPastel)' });

  function look(c) {
    const t = topOf(c);
    return t.type === 'in' ? SOFT : pastel(t.color || 'c6');
  }

  const personalAccounts = () => D.accounts.filter((a) => a.type === 'current' && a.group === 'pers').map((a) => a.id);
  const ownerAccounts = (o) => (o === 'jij' ? personalAccounts() : [o]);
  const ownerName = (o) => (o === 'jij' ? 'Jij' : D.account(o).name);
  const ownerLong = (o) => (o === 'jij' ? 'Al je persoonlijke rekeningen' : D.account(o).name);

  function anim(cls, delay) {
    return painted ? '' : ' ' + cls + '" style="--d:' + delay + 'ms';
  }

  // "20" or "19,99" in euro → cents; '' → null; anything else → NaN
  function parseAmt(s) {
    const v = String(s || '').replace(/[€\s]/g, '');
    if (!v) return null;
    if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(v)) return NaN;
    return Math.round(parseFloat(v.replace(/\./g, '').replace(',', '.')) * 100);
  }
  const amtIn = (c) => (c === null || c === undefined ? '' : (c % 100 ? (c / 100).toFixed(2).replace('.', ',') : String(c / 100)));
  const validRe = (s) => { try { new RegExp(s, 'i'); return true; } catch (e) { return false; } };

  // Conditions summary, e.g. ["Tegenpartij bevat 'Colruyt'", "Bedrag tussen € 20 en € 200"]
  function conds(r) {
    const c = [];
    if (r.cp) c.push('Tegenpartij ' + (r.cpOp === 'is' ? 'is gelijk aan' : 'bevat') + " '" + r.cp + "'");
    if (r.iban) c.push('IBAN tegenpartij is ' + r.iban);
    if (r.comm) c.push(r.regex ? 'Mededeling past op /' + r.comm + '/' : "Mededeling bevat '" + r.comm + "'");
    const hasMin = r.min !== null && r.min !== undefined;
    const hasMax = r.max !== null && r.max !== undefined;
    if (hasMin && hasMax) c.push('Bedrag tussen ' + eur0(r.min) + ' en ' + eur0(r.max));
    else if (hasMin) c.push('Bedrag vanaf ' + eur0(r.min));
    else if (hasMax) c.push('Bedrag tot ' + eur0(r.max));
    return c;
  }

  const hasCond = (r) => !!(r.cp || r.iban || r.comm || r.min !== null || r.max !== null);

  // A rule-shaped object from the editor draft
  function draftRule(d) {
    const num = (v) => { const x = parseAmt(v); return Number.isNaN(x) ? null : x; };
    return { cpOp: d.cpOp, cp: (d.cp || '').trim(), iban: (d.iban || '').trim(), comm: (d.comm || '').trim(), regex: !!d.regex,
      min: num(d.minIn), max: num(d.maxIn), owner: d.owner, cat: d.cat || '' };
  }

  // How many of the viewer's transactions a rule matches, and how many would change category
  function matchInfo(r, hits) {
    let n = 0;
    let diff = 0;
    if (!hasCond(r)) return { n, diff };
    let re = null;
    if (r.comm && r.regex) {
      if (!validRe(r.comm)) return { n, diff, bad: true };
      re = new RegExp(r.comm, 'i');
    }
    const accs = ownerAccounts(r.owner);
    const norm = (s) => s.replace(/\s/g, '').toLowerCase();
    seen.forEach((e) => {
      if (accs.indexOf(e.acc) < 0) return;
      if (r.cp) {
        const a = e.cp.toLowerCase();
        const b = r.cp.toLowerCase();
        if (r.cpOp === 'is' ? a !== b : a.indexOf(b) < 0) return;
      }
      if (r.iban && norm(e.iban) !== norm(r.iban)) return;
      if (r.comm && (re ? !re.test(e.comm) : e.comm.toLowerCase().indexOf(r.comm.toLowerCase()) < 0)) return;
      let k = e.n;
      if (r.min !== null && r.min > 0) k -= e.small;
      if (r.max !== null) k -= e.big;
      if (k <= 0) return;
      n += k;
      diff += r.cat && r.cat === e.cat ? Math.min(e.diff, k) : Math.max(0, k - e.manual);
      if (hits) hits.push(e);
    });
    return { n, diff };
  }

  // Live preview of a rule: text and tone ('' green, 'idle' neutral, 'bad' error)
  function preview(r) {
    if (!hasCond(r)) return { text: 'Vul minstens één voorwaarde in.', tone: 'idle' };
    const m = matchInfo(r);
    if (m.bad) return { text: 'Deze reguliere expressie klopt niet.', tone: 'bad' };
    if (!m.n) return { text: 'Past nog op geen enkele transactie. Nieuwe transacties die passen, krijgen deze categorie.', tone: 'idle' };
    const main = 'Past op ' + plural(m.n, 'transactie', 'transacties');
    if (!r.cat) return { text: main + ' · kies een categorie', tone: '' };
    if (!m.diff) return { text: main + ' · ze hebben deze categorie al', tone: '' };
    return { text: main + ' · ' + m.diff + (m.diff === 1 ? ' krijgt' : ' krijgen') + ' een andere categorie', tone: '' };
  }

  function level(pct) {
    if (pct >= 80) return { key: 'hoog', label: 'Hoog', color: 'var(--green)' };
    if (pct >= 55) return { key: 'gem', label: 'Gemiddeld', color: 'var(--warn)' };
    return { key: 'laag', label: 'Laag', color: 'var(--dashed)' };
  }

  // Keeps the sidebar badge on Transacties in step when suggestions categorise transactions
  function setUncat(n) {
    uncat = Math.max(0, n);
    const b = document.querySelector('.side-link[href="transacties.html"] .side-badge');
    if (b) { if (uncat) b.textContent = uncat; else b.remove(); }
  }

  function announce(text) {
    if (!live) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 30);
  }

  // ---------- Small pieces ----------

  function catChip(c) {
    if (!c) return '';
    const lk = look(c);
    return '<span class="ct-chip" style="background:' + lk.bg + ';color:' + lk.fg + '">' +
      (c.parent ? '<span class="ct-chip-parent">' + esc(cat(c.parent).name) + ' ›</span> ' : '') + esc(c.name) + '</span>';
  }

  function ownerChip(o) {
    if (o === 'jij') return '<span class="ct-owner ct-owner--me">' + icon('person', 13, 2.4) + 'Jij</span>';
    const a = D.account(o);
    return '<span class="ct-owner"><i style="background:var(--a-' + a.color + ')"></i>' + esc(a.name) + '</span>';
  }

  const chevron = () => '<span class="ct-chev">' + icon('chevron', 16, 2.2) + '</span>';

  function note(ic, title, text, delay, cls) {
    return '<div class="ct-note' + (cls ? ' ' + cls : '') + anim('anim-in', delay) + '">' +
      '<span class="ct-note-icon">' + icon(ic, 18, 2.2) + '</span>' +
      '<span class="ct-note-text"><strong>' + title + '</strong>' + (text ? '<span>' + text + '</span>' : '') + '</span></div>';
  }

  function emptyCard(title, text) {
    return '<div class="ct-empty' + anim('anim-in', 60) + '"><strong>' + title + '</strong><span>' + text + '</span></div>';
  }

  // ---------- Header and tabs ----------

  function header() {
    const add = ui.tab === 'categorieen' ? ['new-cat', 'Categorie toevoegen'] : (ui.tab === 'regels' ? ['new-rule', 'Regel toevoegen'] : null);
    return '<div class="ct-head' + anim('anim-fade', 0) + '">' +
      '<a class="page-back only-phone" href="meer.html" aria-label="Terug naar Meer">' + icon('back', 22, 2.4) + '</a>' +
      '<div class="ct-head-title"><h1>Categorieën en regels</h1>' +
        '<span class="ct-head-sub only-desktop">Eén lijst categorieën voor iedereen, regels voor jouw rekeningen</span></div>' +
      (add ? '<div class="only-desktop"><button type="button" class="btn btn--primary ct-add" data-action="' + add[0] + '" data-key="head-add">' +
        icon('plus', 16, 2.6) + add[1] + '</button></div>' : '') +
    '</div>';
  }

  function tabs() {
    const count = { regels: rules.length, suggesties: sugg.length };
    return '<div class="ct-tabs' + anim('anim-fade', 20) + '" role="tablist" aria-label="Categorieën en regels">' + TABS.map((t) => {
      const on = t[0] === ui.tab;
      const n = count[t[0]];
      return '<button type="button" role="tab" class="ct-tab" id="ct-tab-' + t[0] + '" aria-selected="' + on + '" aria-controls="ct-tabpanel" tabindex="' + (on ? 0 : -1) +
        '" data-action="tab" data-tab="' + t[0] + '" data-key="tab-' + t[0] + '">' + esc(t[1]) +
        (n ? '<span class="ct-tab-count' + (t[0] === 'suggesties' ? '' : ' ct-tab-count--muted') + '">' + n + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  // ---------- Categorieën ----------

  function catTab() {
    const desk = isDesk();
    const selId = ui.ed && (ui.ed.kind === 'cat' || ui.ed.kind === 'del') && !ui.ed.isNew ? ui.ed.id : null;
    const row = (c, sub) => {
      const lk = look(c);
      const n = sub ? c.n : total(c);
      const k = kids(c.id).length;
      const subline = sub ? '' : (k ? plural(k, 'subcategorie', 'subcategorieën') : (c.type === 'out' ? 'Geen subcategorieën' : ''));
      return '<button type="button" class="ct-crow' + (sub ? ' ct-crow--sub' : '') + '" data-action="cat" data-id="' + c.id + '" data-key="cat-' + c.id + '"' +
        (desk ? ' aria-pressed="' + (selId === c.id) + '"' : '') + '>' +
        (sub ? '<i class="ct-dot" style="background:' + lk.bg + '"></i>'
          : '<span class="ct-cav" style="background:' + lk.bg + ';color:' + lk.fg + '">' + icon('tag', 16, 2.2) + '</span>') +
        '<span class="ct-crow-main"><span class="ct-crow-name">' + esc(c.name) + '</span>' + (subline ? '<span class="ct-crow-sub">' + subline + '</span>' : '') + '</span>' +
        (empty() ? '' : '<span class="mono ct-count"><span class="visually-hidden">, </span>' + n + '<span class="visually-hidden"> ' + (n === 1 ? 'transactie' : 'transacties') + '</span></span>') +
        chevron() +
      '</button>';
    };
    const group = (type, title, delay) => {
      const list = tops(type);
      return '<section class="ct-group' + anim('anim-in', delay) + '" aria-labelledby="ct-g-' + type + '">' +
        '<div class="ct-group-head"><h2 class="label" id="ct-g-' + type + '">' + title + '</h2>' +
          '<span class="ct-group-note">· ' + plural(list.length, type === 'out' ? 'hoofdcategorie' : 'categorie', type === 'out' ? 'hoofdcategorieën' : 'categorieën') + '</span>' +
          (empty() ? '' : '<span class="ct-group-right" aria-hidden="true">Jouw transacties</span>') + '</div>' +
        '<div class="ct-list">' + list.map((c) => row(c, false) + kids(c.id).map((k) => row(k, true)).join('')).join('') + '</div>' +
      '</section>';
    };
    return note('people', 'Gedeeld met alle gebruikers · alleen namen, nooit bedragen',
        empty() ? 'Nog geen transacties. De aantallen verschijnen zodra je een rekening koppelt of importeert.' : 'De aantallen tellen alleen jouw eigen transacties.', 30) +
      group('out', 'Uitgaven', 60) +
      group('in', 'Inkomsten', 90) +
      '<button type="button" class="btn btn--dashed btn--block only-phone ct-add-phone' + anim('anim-in', 110) + '" data-action="new-cat" data-key="add-cat">' +
        icon('plus', 16, 2.6) + 'Categorie toevoegen</button>' +
      '<p class="ct-foot' + anim('anim-in', 120) + '">Overschrijvingen tussen je eigen rekeningen krijgen geen categorie. Saldo herkent ze zelf; wat naar een spaarrekening gaat, telt als gespaard.</p>';
  }

  // ---------- Regels ----------

  function ruleRow(r, i, desk, selId) {
    const c = cat(r.cat);
    const cs = conds(r);
    const ro = D.readOnly(r.owner);
    const m = matchInfo(r);
    const mv = (dir, ic, dis, label) => '<button type="button" class="ct-move-btn" data-action="move" data-dir="' + dir + '" data-id="' + r.id +
      '" data-key="' + dir + '-' + r.id + '" aria-label="' + label + '"' + (dis ? ' disabled' : '') + '>' + icon(ic, 16, 2.4) + '</button>';
    return '<li class="ct-rule' + (ro ? ' ct-rule--ro' : '') + '">' +
      '<span class="ct-prio" aria-hidden="true">' + (i + 1) + '</span>' +
      '<button type="button" class="ct-rule-main" data-action="rule" data-id="' + r.id + '" data-key="rule-' + r.id + '"' +
        (desk ? ' aria-pressed="' + (selId === r.id) + '"' : '') + '>' +
        '<span class="visually-hidden">Prioriteit ' + (i + 1) + ': </span>' +
        '<span class="ct-rule-cond">' + esc(cs[0] || '') + '</span>' +
        cs.slice(1).map((x) => '<span class="ct-rule-more">en ' + esc(lower(x)) + '</span>').join('') +
        '<span class="ct-rule-meta"><span class="ct-to" aria-hidden="true">→</span><span class="visually-hidden">naar </span>' + catChip(c) +
          '<span class="visually-hidden">, geldt voor </span>' + ownerChip(r.owner) +
          (ro ? '<span class="chip chip--readonly ct-ro">' + icon('lock', 12, 2.4) + 'Alleen lezen</span>' : '') + '</span>' +
        '<span class="ct-rule-n">Past op ' + plural(m.n, 'transactie', 'transacties') + '</span>' +
      '</button>' +
      (ro ? '' : '<span class="ct-move">' +
        mv('up', 'arrowUp', i === 0 || offline(), 'Regel ' + (i + 1) + ' hoger zetten') +
        mv('down', 'arrowDown', i === rules.length - 1 || offline(), 'Regel ' + (i + 1) + ' lager zetten') + '</span>') +
    '</li>';
  }

  function ruleTab() {
    const desk = isDesk();
    const intro = note('info', 'Een handmatige keuze wint altijd, dan de regel met de hoogste prioriteit, dan een suggestie.',
      'De volgorde telt alleen tussen regels die op dezelfde rekening gelden.', 30);
    const add = '<button type="button" class="btn btn--dashed btn--block only-phone ct-add-phone' + anim('anim-in', 110) + '" data-action="new-rule" data-key="add-rule">' +
      icon('plus', 16, 2.6) + 'Regel toevoegen</button>';
    if (!rules.length) {
      return intro + emptyCard('Nog geen regels', 'Een regel geeft transacties vanzelf een categorie, bijvoorbeeld alles van Colruyt naar Boodschappen.') + add;
    }
    const selId = ui.ed && ui.ed.kind === 'rule' && !ui.ed.isNew ? ui.ed.id : null;
    return intro +
      '<section class="ct-group' + anim('anim-in', 60) + '" aria-labelledby="ct-g-rules">' +
        '<div class="ct-group-head"><h2 class="label" id="ct-g-rules">Op volgorde van prioriteit</h2>' +
          '<span class="ct-group-right">' + plural(rules.length, 'regel', 'regels') + '</span></div>' +
        '<ol class="ct-rules">' + rules.map((r, i) => ruleRow(r, i, desk, selId)).join('') + '</ol>' +
      '</section>' + add;
  }

  // ---------- Suggesties ----------

  function suggCard(s, i) {
    const lv = level(s.pct);
    const busy = offline() ? ' disabled' : '';
    const on = isDesk() && ui.ed && ui.ed.kind === 'rule' && ui.ed.from === s.id;
    return '<article class="ct-sugg' + (on ? ' is-on' : '') + anim('anim-in', 60 + i * 30) + '" aria-labelledby="ct-s-' + s.id + '">' +
      '<div class="ct-sugg-head">' +
        '<span class="ct-sugg-av" aria-hidden="true">' + esc(s.cp.charAt(0)) + '</span>' +
        '<span class="ct-sugg-text"><span class="ct-sugg-name" id="ct-s-' + s.id + '">' + esc(s.cp) + '</span>' +
          '<span class="ct-sugg-sub">' + s.seen + ' keer gezien · ' + plural(s.open, 'transactie wacht', 'transacties wachten') + '</span></span>' +
      '</div>' +
      '<div class="ct-sugg-to"><span class="ct-sugg-label">Voorstel</span>' + catChip(cat(s.cat)) + '</div>' +
      '<div class="ct-sugg-conf"><span class="ct-sugg-label">Zekerheid</span>' +
        '<span class="ct-meter" aria-hidden="true"><span style="width:' + s.pct + '%;background:' + lv.color + '"></span></span>' +
        '<span class="ct-conf ct-conf--' + lv.key + '">' + lv.label + ' · ' + s.pct + '&nbsp;%</span></div>' +
      (lv.key === 'laag' ? '<p class="ct-sugg-low">' + icon('info', 14, 2.2) + '<span>Lage zekerheid: Saldo past dit niet toe zonder jouw bevestiging.</span></p>' : '') +
      '<div class="ct-sugg-actions">' +
        '<button type="button" class="btn btn--primary" data-action="confirm" data-id="' + s.id + '" data-key="confirm-' + s.id + '"' + busy + '>Bevestigen</button>' +
        '<button type="button" class="btn btn--secondary" data-action="as-rule" data-id="' + s.id + '" data-key="as-rule-' + s.id + '">Als regel</button>' +
        '<button type="button" class="btn btn--ghost" data-action="ignore" data-id="' + s.id + '" data-key="ignore-' + s.id + '"' + busy + '>Negeren</button>' +
      '</div>' +
    '</article>';
  }

  function suggTab() {
    const intro = note('spark', 'Saldo leert van je keuzes',
      'Een tegenpartij krijgt de categorie die je er het vaakst voor koos. Een suggestie met lage zekerheid wordt nooit toegepast zonder jouw bevestiging.', 30);
    if (!sugg.length) return intro + emptyCard('Geen suggesties', 'Saldo stelt een categorie voor zodra het een tegenpartij vaak genoeg ziet.');
    return intro + '<div class="ct-suggs">' + sugg.map(suggCard).join('') + '</div>';
  }

  // ---------- Editors (phone sheet, desktop panel) ----------

  function closeBtn(inSheet) {
    return inSheet ? '<button type="button" class="ct-close" aria-label="Sluiten" data-action="close" data-key="close">' + icon('close', 18, 2.4) + '</button>' : '';
  }

  function edHead(lk, ic, title, sub, inSheet, extra) {
    return '<div class="ct-ed-head">' +
      '<span class="ct-ed-icon" style="background:' + lk.bg + ';color:' + lk.fg + '">' + icon(ic, 20, 2.2) + '</span>' +
      '<div class="ct-ed-title"><span class="ct-ed-name" data-bind="title">' + esc(title) + '</span><span class="ct-ed-sub">' + sub + '</span>' + (extra || '') + '</div>' +
      closeBtn(inSheet) +
    '</div>';
  }

  const offlineNote = () => (offline() ? '<p class="ct-offline">' + icon('cloudOff', 16, 2.2) + '<span>Je bent offline. Opslaan kan weer zodra je verbinding hebt.</span></p>' : '');
  const errHtml = (id, msg) => (msg ? '<p class="ct-err" id="' + id + '">' + esc(msg) + '</p>' : '');
  const invalid = (id, msg) => (msg ? ' aria-invalid="true" aria-describedby="' + id + '"' : '');

  function info() {
    const step = (n, t, s) => '<li><span class="ct-step-n">' + n + '</span><span class="ct-step-text"><strong>' + t + '</strong><span>' + s + '</span></span></li>';
    return '<div class="ct-info">' +
      '<div class="ct-ed-head"><span class="ct-ed-icon" style="background:var(--soft);color:var(--greenText)">' + icon('spark', 20, 2) + '</span>' +
        '<div class="ct-ed-title"><h2 class="ct-ed-name">Zo kiest Saldo een categorie</h2><span class="ct-ed-sub">Voor elke transactie, in deze volgorde</span></div></div>' +
      '<ol class="ct-steps">' +
        step(1, 'Jouw keuze', 'Een categorie die je zelf kiest, blijft altijd staan. Ook als regels opnieuw lopen.') +
        step(2, 'Een regel', 'Anders de regel met de hoogste prioriteit die past.') +
        step(3, 'Een suggestie', 'Anders wat Saldo leerde uit je eerdere keuzes.') +
      '</ol>' +
      '<p class="ct-box">Een suggestie met lage zekerheid past Saldo nooit toe zonder jouw bevestiging. Bevestig je ze, dan krijgen de open transacties die categorie.</p>' +
    '</div>';
  }

  function catEditor(p, inSheet) {
    const ed = ui.ed;
    const d = ui.draft;
    const c = ed.isNew ? null : cat(ed.id);
    const err = d.err || {};
    const isTop = d.place === 'top-out' || d.place === 'top-in';
    const parent = isTop ? null : cat(d.place);
    const lk = d.place === 'top-out' ? pastel(d.color) : (d.place === 'top-in' ? SOFT : look(parent));
    const k = c ? kids(c.id).length : 0;
    const shown = (d.name || '').trim() || (c ? c.name : 'Nieuwe categorie');
    const sub = c
      ? (c.type === 'in' ? 'Inkomst' : 'Uitgave') + (c.parent ? ' · onder ' + esc(cat(c.parent).name) : ' · hoofdcategorie')
      : 'Nieuwe ' + (isTop ? 'hoofdcategorie' : 'subcategorie') + ' · voor alle gebruikers';
    const id = (x) => 'ct-' + p + '-' + x;
    const sel = (v) => (d.place === v ? ' selected' : '');

    const placeOpts = '<option value="top-out"' + sel('top-out') + '>Hoofdcategorie bij Uitgaven</option>' +
      '<option value="top-in"' + sel('top-in') + '>Hoofdcategorie bij Inkomsten</option>' +
      '<optgroup label="Subcategorie van">' + cats.filter((x) => !x.parent && (!c || x.id !== c.id)).map((x) =>
        '<option value="' + x.id + '"' + sel(x.id) + '>' + esc(x.name) + (x.type === 'in' ? ' (inkomsten)' : '') + '</option>').join('') + '</optgroup>';

    let colour;
    if (d.place === 'top-out') {
      colour = '<div class="ct-swatches" role="radiogroup" aria-labelledby="' + id('kleur') + '">' + PASTELS.map((x) => {
        const on = x[0] === d.color;
        return '<button type="button" class="ct-swatch" role="radio" aria-checked="' + on + '" aria-label="' + x[1] + '" tabindex="' + (on ? 0 : -1) + '"' +
          ' data-action="color" data-color="' + x[0] + '" data-key="sw-' + x[0] + '" style="background:var(--' + x[0] + ');color:' + pastel(x[0]).fg + '">' +
          (on ? icon('check', 16, 3) : '') + '</button>';
      }).join('') + '</div>' +
      '<span class="ct-help">Subcategorieën krijgen de kleur van hun hoofdcategorie. Een kleur mag vaker voorkomen.</span>';
    } else if (d.place === 'top-in') {
      colour = '<span class="ct-help">Inkomsten zijn altijd groen.</span>';
    } else {
      colour = '<span class="ct-help">Krijgt de kleur van ' + esc(parent.name) + '.</span>';
    }

    const count = c && !empty() ? '<span class="mono ct-preview-n">' + (k ? total(c) : c.n) + '</span>' : '';
    const delHelp = k ? '<span class="ct-help">Verwijderen kan pas als er geen subcategorieën meer onder hangen.</span>' : '';

    return edHead(lk, 'tag', shown, sub, inSheet) +
      '<div class="ct-field">' +
        '<label class="ct-label" for="' + id('name') + '">Naam</label>' +
        '<input class="input" id="' + id('name') + '" autocomplete="off" value="' + esc(d.name || '') + '" placeholder="Bijvoorbeeld: Huisdieren" data-input="name" data-key="name"' + invalid(id('name-err'), err.name) + '>' +
        errHtml(id('name-err'), err.name) +
        '<span class="ct-help">Iedereen ziet dezelfde categorieën. Bedragen en aantallen van anderen zie je nooit.</span>' +
      '</div>' +
      '<div class="ct-field">' +
        '<label class="ct-label" for="' + id('place') + '">Plaats</label>' +
        '<select class="input ct-select" id="' + id('place') + '" data-input="place" data-key="place"' + (k ? ' disabled' : '') + '>' + placeOpts + '</select>' +
        '<span class="ct-help">' + (k ? 'Verplaats eerst de ' + plural(k, 'subcategorie', 'subcategorieën') + '. Saldo heeft twee niveaus.' : 'Twee niveaus: hoofdcategorie en subcategorie.') + '</span>' +
      '</div>' +
      '<div class="ct-field"><span class="ct-label" id="' + id('kleur') + '">Kleur</span>' + colour + '</div>' +
      '<div class="ct-preview-strip"><span class="ct-preview-label">Voorbeeld</span>' +
        '<span class="ct-chip" style="background:' + lk.bg + ';color:' + lk.fg + '">' + (parent ? '<span class="ct-chip-parent">' + esc(parent.name) + ' ›</span> ' : '') +
          '<span data-bind="cname">' + esc(shown) + '</span></span>' +
        (count ? '<span class="ct-preview-count">' + count + ' van jou</span>' : '') +
      '</div>' +
      (c && !c.parent && c.type === 'out' ? '<button type="button" class="ct-subadd" data-action="new-sub" data-id="' + c.id + '" data-key="new-sub">' + icon('plus', 16, 2.6) + 'Subcategorie toevoegen</button>' : '') +
      '<div class="ct-actions">' +
        (c ? '<button type="button" class="ct-btn ct-btn--danger" data-action="del" data-id="' + c.id + '" data-key="del"' + (k || offline() ? ' disabled' : '') + '>' + icon('trash', 16, 2.2) + 'Verwijderen</button>'
          : '<button type="button" class="ct-btn ct-btn--ghost" data-action="cancel" data-key="cancel">Annuleren</button>') +
        '<button type="button" class="ct-btn ct-btn--primary" data-action="save-cat" data-key="save"' + (offline() ? ' disabled' : '') + '>Opslaan</button>' +
      '</div>' + delHelp + offlineNote();
  }

  function otherTargets(c) {
    return cats.filter((x) => x.id !== c.id && x.type === c.type && x.id !== c.parent);
  }

  function delEditor(p, inSheet) {
    const c = cat(ui.ed.id);
    const d = ui.draft;
    const parent = c.parent ? cat(c.parent) : null;
    const target = d.to === 'parent' ? parent : (d.to === 'other' ? cat(d.other) : null);
    const used = rules.filter((r) => r.cat === c.id).length;
    const id = (x) => 'ct-' + p + '-' + x;
    const others = otherTargets(c);
    const radio = (val, title, sub, extra) => '<div class="ct-radio-box' + (d.to === val ? ' is-on' : '') + '">' +
      '<label class="ct-radio"><input type="radio" name="' + id('to') + '" value="' + val + '" data-input="to" data-key="to-' + val + '"' + (d.to === val ? ' checked' : '') + '>' +
        '<span class="ct-radio-text"><span class="ct-radio-title">' + title + '</span>' + (sub ? '<span class="ct-radio-sub">' + sub + '</span>' : '') + '</span></label>' +
      (extra || '') + '</div>';
    const otherSelect = '<label class="visually-hidden" for="' + id('other') + '">Andere categorie</label>' +
      '<select class="input ct-select ct-radio-select" id="' + id('other') + '" data-input="other" data-key="other"' + (d.to === 'other' ? '' : ' disabled') + '>' +
        others.map((x) => '<option value="' + x.id + '"' + (x.id === d.other ? ' selected' : '') + '>' + esc(x.parent ? cat(x.parent).name + ' › ' + x.name : x.name) + '</option>').join('') +
      '</select>';
    const q = c.n
      ? 'Waar gaan je ' + plural(c.n, 'transactie', 'transacties') + ' naartoe?'
      : 'Je hebt geen transacties in ' + esc(c.name) + '. Kies waar die van andere gebruikers naartoe gaan.';
    let ruleNote = '';
    if (used) {
      const t = target ? 'kiest voortaan ' + esc(target.name) : null;
      ruleNote = used === 1
        ? '1 regel kiest ' + esc(c.name) + '. ' + (t ? 'Die ' + t + '.' : 'Die regel wordt verwijderd.')
        : used + ' regels kiezen ' + esc(c.name) + '. ' + (t ? 'Die kiezen voortaan ' + esc(target.name) + '.' : 'Die regels worden verwijderd.');
    }
    const sub = esc(c.parent ? parent.name + ' › ' + c.name : c.name) + (empty() ? '' : ' · ' + plural(c.n, 'transactie', 'transacties') + ' van jou');
    return edHead({ bg: 'var(--negSoft)', fg: 'var(--negText)' }, 'trash', c.name + ' verwijderen', sub, inSheet) +
      '<fieldset class="ct-fieldset"><legend class="ct-q">' + q + '</legend>' +
        '<div class="ct-radios">' +
          (parent ? radio('parent', 'Naar ' + esc(parent.name), 'De hoofdcategorie') : '') +
          (others.length ? radio('other', 'Naar een andere categorie', '', otherSelect) : '') +
          radio('none', 'Niet gecategoriseerd', 'Ze komen bij Te categoriseren in Transacties') +
        '</div>' +
      '</fieldset>' +
      (ruleNote ? '<p class="ct-box">' + ruleNote + '</p>' : '') +
      '<p class="ct-help">Transacties van andere gebruikers in ' + esc(c.name) + ' gaan naar dezelfde plaats. Hoeveel dat er zijn, zie je niet.</p>' +
      '<div class="ct-actions">' +
        '<button type="button" class="ct-btn ct-btn--ghost" data-action="cancel-del" data-key="cancel-del">Annuleren</button>' +
        '<button type="button" class="ct-btn ct-btn--dangerfill" data-action="confirm-del" data-key="confirm-del"' + (offline() ? ' disabled' : '') + '>Verwijderen</button>' +
      '</div>' + offlineNote();
  }

  function owners() {
    const list = [{ id: 'jij', label: 'Al je persoonlijke rekeningen' }];
    if (!empty()) {
      D.accounts.filter((a) => a.type === 'current').forEach((a) => {
        const acc = D.account(a.id);
        const ro = D.readOnly(a.id);
        list.push({ id: a.id, label: acc.name + (a.group === 'ged' ? ' · met ' + D.partner.name : '') + (ro ? ' (alleen lezen)' : ''), ro });
      });
    }
    return list;
  }

  function ownerHelp(o) {
    if (o === 'jij') return 'Alleen voor jou. Geldt voor al je rekeningen waar jij het enige lid bent.';
    const a = D.accounts.find((x) => x.id === o);
    if (a && a.group === 'ged') return 'Geldt voor de ' + esc(D.account(o).name.toLowerCase()) + '. Leden met Bewerken, zoals ' + D.partner.name + ', zien en wijzigen deze regel ook.';
    return 'Geldt alleen voor ' + esc(D.account(o).name) + '.';
  }

  function catOptions(selected) {
    const opt = (c, label) => '<option value="' + c.id + '"' + (c.id === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    const grp = (type, label) => '<optgroup label="' + label + '">' + tops(type).map((t) =>
      opt(t, t.name) + kids(t.id).map((k) => opt(k, t.name + ' › ' + k.name)).join('')).join('') + '</optgroup>';
    return '<option value=""' + (selected ? '' : ' selected') + '>Kies een categorie</option>' + grp('out', 'Uitgaven') + grp('in', 'Inkomsten');
  }

  function roRule(r, inSheet) {
    const i = rules.indexOf(r);
    const m = matchInfo(r);
    const c = cat(r.cat);
    const acc = D.account(r.owner);
    return edHead(c ? look(c) : SOFT, 'filter', 'Regel ' + (i + 1), esc(acc.name) + ' · prioriteit ' + (i + 1), inSheet,
        '<span class="chip chip--readonly ct-ro ct-ro--head">' + icon('lock', 12, 2.4) + 'Alleen lezen</span>') +
      '<dl class="ct-dl">' +
        '<dt>Voorwaarden</dt><dd>' + conds(r).map(esc).join('<br>') + '</dd>' +
        '<dt>Categorie</dt><dd>' + catChip(c) + '</dd>' +
        '<dt>Geldt voor</dt><dd>' + ownerChip(r.owner) + '</dd>' +
        '<dt>Prioriteit</dt><dd>' + (i + 1) + ' van ' + rules.length + '</dd>' +
        '<dt>Past op</dt><dd>' + plural(m.n, 'transactie', 'transacties') + '</dd>' +
      '</dl>' +
      '<p class="ct-box">' + D.partner.name + ' beheert de ' + esc(acc.name.toLowerCase()) + ' en gaf je Lezen. Je ziet deze regel, maar wijzigen kan alleen met Bewerken.</p>' +
      (inSheet ? '<button type="button" class="ct-btn ct-btn--ghost" data-action="close" data-key="close-ro">Sluiten</button>' : '');
  }

  function ruleEditor(p, inSheet) {
    const ed = ui.ed;
    const d = ui.draft;
    const r = ed.isNew ? null : rule(ed.id);
    if (r && D.readOnly(r.owner)) return roRule(r, inSheet);
    const err = d.err || {};
    const id = (x) => 'ct-' + p + '-' + x;
    const c = d.cat ? cat(d.cat) : null;
    const lk = c ? look(c) : { bg: 'var(--bg)', fg: 'var(--muted)' };
    const title = r ? 'Regel ' + (rules.indexOf(r) + 1) : (ed.from ? 'Regel uit suggestie' : 'Nieuwe regel');
    const max = r ? rules.length : rules.length + 1;
    const seg = '<div class="ct-seg" role="group" aria-label="Tegenpartij vergelijken">' +
      [['bevat', 'bevat'], ['is', 'is gelijk aan']].map((x) => '<button type="button" aria-pressed="' + (d.cpOp === x[0]) + '" data-action="cpop" data-v="' + x[0] +
        '" data-key="cpop-' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
    const regexSw = '<span class="ct-sw"><span id="' + id('re-l') + '">Reguliere expressie</span>' +
      '<button type="button" class="switch ct-switch" role="switch" aria-checked="' + !!d.regex + '" aria-labelledby="' + id('re-l') + '" data-action="regex" data-key="regex"></button></span>';
    const prioOpts = Array.from({ length: max }, (_, i) => '<option value="' + (i + 1) + '"' + (d.prio === i + 1 ? ' selected' : '') + '>' +
      (i + 1) + (i === 0 ? ' · hoogste' : (i === max - 1 && max > 1 ? ' · laagste' : '')) + '</option>').join('');
    const ownerOpts = owners().map((o) => '<option value="' + o.id + '"' + (o.id === d.owner ? ' selected' : '') + (o.ro ? ' disabled' : '') + '>' + esc(o.label) + '</option>').join('');

    return edHead(lk, 'filter', title, esc(ownerLong(d.owner)) + ' · prioriteit ' + d.prio, inSheet) +
      '<fieldset class="ct-fieldset"><legend class="ct-legend">Voorwaarden</legend>' +
        '<span class="ct-help ct-legend-help">Alle ingevulde voorwaarden moeten kloppen.</span>' +
        '<div class="ct-field">' +
          '<div class="ct-label-row"><label class="ct-label" for="' + id('cp') + '">Tegenpartij</label>' + seg + '</div>' +
          '<input class="input" id="' + id('cp') + '" autocomplete="off" placeholder="Bijvoorbeeld: Colruyt" value="' + esc(d.cp) + '" data-input="cp" data-key="cp">' +
        '</div>' +
        '<div class="ct-field">' +
          '<label class="ct-label" for="' + id('iban') + '">IBAN tegenpartij</label>' +
          '<input class="input ct-mono" id="' + id('iban') + '" autocomplete="off" placeholder="BE00 0000 0000 0000" value="' + esc(d.iban) + '" data-input="iban" data-key="iban">' +
        '</div>' +
        '<div class="ct-field">' +
          '<div class="ct-label-row"><label class="ct-label" for="' + id('comm') + '">Mededeling</label>' + regexSw + '</div>' +
          '<input class="input' + (d.regex ? ' ct-mono' : '') + '" id="' + id('comm') + '" autocomplete="off" placeholder="' + (d.regex ? 'netflix|spotify' : 'Bijvoorbeeld: bijdrage') + '" value="' + esc(d.comm) + '" data-input="comm" data-key="comm"' + invalid(id('comm-err'), err.comm) + '>' +
          errHtml(id('comm-err'), err.comm) +
          '<span class="ct-help">' + (d.regex ? 'Een reguliere expressie, bijvoorbeeld netflix|spotify. Hoofdletters tellen niet mee.' : 'Bevat deze tekst. Hoofdletters tellen niet mee.') + '</span>' +
        '</div>' +
        '<div class="ct-field">' +
          '<span class="ct-label" id="' + id('amt-l') + '">Bedrag</span>' +
          '<div class="ct-amounts" role="group" aria-labelledby="' + id('amt-l') + '">' +
            '<span class="ct-money"><span aria-hidden="true">€</span><input class="input ct-money-input" inputmode="decimal" autocomplete="off" placeholder="van" aria-label="Bedrag van" value="' + esc(d.minIn) + '" data-input="minIn" data-key="min"' + invalid(id('amt-err'), err.amt) + '></span>' +
            '<span class="ct-amounts-sep" aria-hidden="true">tot</span>' +
            '<span class="ct-money"><span aria-hidden="true">€</span><input class="input ct-money-input" inputmode="decimal" autocomplete="off" placeholder="tot" aria-label="Bedrag tot" value="' + esc(d.maxIn) + '" data-input="maxIn" data-key="max"' + invalid(id('amt-err'), err.amt) + '></span>' +
          '</div>' +
          errHtml(id('amt-err'), err.amt) +
          '<span class="ct-help">Zonder teken. Bij een uitgavencategorie kijkt Saldo naar uitgaven, bij een inkomstencategorie naar inkomsten.</span>' +
        '</div>' +
      '</fieldset>' +
      '<fieldset class="ct-fieldset"><legend class="ct-legend">Resultaat</legend>' +
        '<div class="ct-field">' +
          '<label class="ct-label" for="' + id('cat') + '">Categorie</label>' +
          '<select class="input ct-select" id="' + id('cat') + '" data-input="cat" data-key="cat"' + invalid(id('cat-err'), err.cat) + '>' + catOptions(d.cat) + '</select>' +
          errHtml(id('cat-err'), err.cat) +
        '</div>' +
        '<div class="ct-field">' +
          '<label class="ct-label" for="' + id('owner') + '">Geldt voor</label>' +
          '<select class="input ct-select" id="' + id('owner') + '" data-input="owner" data-key="owner">' + ownerOpts + '</select>' +
          '<span class="ct-help">' + ownerHelp(d.owner) + '</span>' +
        '</div>' +
        '<div class="ct-field">' +
          '<label class="ct-label" for="' + id('prio') + '">Prioriteit</label>' +
          '<select class="input ct-select" id="' + id('prio') + '" data-input="prio" data-key="prio">' + prioOpts + '</select>' +
          '<span class="ct-help">1 is de hoogste. Passen twee regels op dezelfde transactie, dan wint de hoogste.</span>' +
        '</div>' +
      '</fieldset>' +
      errHtml(id('cond-err'), err.cond) +
      (function () {
        const pv = preview(draftRule(d));
        return '<div class="ct-preview' + (pv.tone ? ' ct-preview--' + pv.tone : '') + '" role="status">' + icon('search', 16, 2.4) +
          '<span data-bind="preview">' + esc(pv.text) + '</span></div>';
      })() +
      '<label class="ct-check"><input type="checkbox" data-input="apply" data-key="apply"' + (d.apply ? ' checked' : '') + '>' +
        '<span><strong>Ook toepassen op bestaande transacties</strong><br><span class="muted">(handmatige keuzes blijven altijd staan)</span></span></label>' +
      '<div class="ct-actions">' +
        (r ? '<button type="button" class="ct-btn ct-btn--danger" data-action="del-rule" data-key="del-rule"' + (offline() ? ' disabled' : '') + '>' + icon('trash', 16, 2.2) + 'Verwijderen</button>'
          : '<button type="button" class="ct-btn ct-btn--ghost" data-action="cancel" data-key="cancel">Annuleren</button>') +
        '<button type="button" class="ct-btn ct-btn--primary" data-action="save-rule" data-key="save"' + (offline() ? ' disabled' : '') + '>Opslaan</button>' +
      '</div>' + offlineNote();
  }

  function editor(p, inSheet) {
    const ed = ui.ed || { kind: 'info' };
    let html;
    if (ed.kind === 'cat') html = catEditor(p, inSheet);
    else if (ed.kind === 'del') html = delEditor(p, inSheet);
    else if (ed.kind === 'rule') html = ruleEditor(p, inSheet);
    else html = info();
    return '<div class="ct-editor' + (ui.flip && !inSheet ? ' anim-fade' : '') + '">' + html + '</div>';
  }

  function edLabel(ed) {
    if (!ed || ed.kind === 'info') return 'Zo kiest Saldo een categorie';
    if (ed.kind === 'cat') return ed.isNew ? 'Nieuwe categorie' : 'Categorie bewerken';
    if (ed.kind === 'del') return 'Categorie verwijderen';
    const r = ed.isNew ? null : rule(ed.id);
    if (r && D.readOnly(r.owner)) return 'Regel bekijken';
    return r ? 'Regel bewerken' : 'Nieuwe regel';
  }

  // ---------- Editor state ----------

  function defaultEd(tab) {
    if (tab === 'categorieen') return { kind: 'cat', id: cat(ui.selCat) ? ui.selCat : 'wonen' };
    if (tab === 'regels') {
      if (!rules.length) return { kind: 'info' };
      return { kind: 'rule', id: rule(ui.selRule) ? ui.selRule : rules[0].id };
    }
    return { kind: 'info' };
  }

  function draftFor(ed) {
    if (!ed || ed.kind === 'info') return {};
    if (ed.kind === 'cat') {
      if (ed.isNew) return { name: '', place: ed.parent || 'top-out', color: 'c1' };
      const c = cat(ed.id);
      return { name: c.name, place: c.parent || (c.type === 'in' ? 'top-in' : 'top-out'), color: c.color || 'c6' };
    }
    if (ed.kind === 'del') {
      const c = cat(ed.id);
      const sibs = cats.filter((x) => x.id !== c.id && c.parent && x.parent === c.parent);
      const others = otherTargets(c);
      return { to: c.parent ? 'parent' : (others.length ? 'other' : 'none'), other: (sibs[0] || others[0] || {}).id };
    }
    const blank = { cpOp: 'bevat', cp: '', iban: '', comm: '', regex: false, minIn: '', maxIn: '', owner: 'jij', cat: '', prio: rules.length + 1, apply: false };
    if (ed.from) {
      const s = sugg.find((x) => x.id === ed.from);
      return Object.assign(blank, { cpOp: 'is', cp: s.cp, owner: s.acc === 'gedeeld' ? 'gedeeld' : 'jij', cat: s.cat, apply: true });
    }
    if (ed.isNew) return blank;
    const r = rule(ed.id);
    return { cpOp: r.cpOp, cp: r.cp, iban: r.iban, comm: r.comm, regex: r.regex, minIn: amtIn(r.min), maxIn: amtIn(r.max),
      owner: r.owner, cat: r.cat, prio: rules.indexOf(r) + 1, apply: false };
  }

  function hashFor(ed) {
    if (!ed || ed.kind === 'info') return ui.tab;
    if (ed.kind === 'cat') return ed.isNew ? 'categorie-nieuw' : 'categorie-' + ed.id;
    if (ed.kind === 'del') return 'categorie-' + ed.id + '-verwijderen';
    if (ed.from) return 'suggestie-' + ed.from + '-regel';
    return ed.isNew ? 'regel-nieuw' : 'regel-' + ed.id;
  }

  function setHash(h) {
    try { history.replaceState(null, '', location.pathname + location.search + '#' + h); } catch (e) { /* file:// */ }
  }

  // Deep links: #categorieen #regels #suggesties #categorie-nieuw #categorie-<id> #categorie-verwijderen
  // #categorie-<id>-verwijderen #regel-nieuw #regel-<n> #suggestie-regel #suggestie-<n>-regel
  function route(hash) {
    const h = (hash || '').replace(/^#/, '');
    if (TABS.some((t) => t[0] === h)) return { tab: h };
    let m;
    if (h === 'categorie-nieuw') return { tab: 'categorieen', ed: { kind: 'cat', isNew: true } };
    if (h === 'categorie-verwijderen') return delRoute('cultuur');
    if ((m = h.match(/^categorie-([a-z0-9]+)-verwijderen$/)) && cat(m[1])) return delRoute(m[1]);
    if ((m = h.match(/^categorie-([a-z0-9]+)$/)) && cat(m[1])) return { tab: 'categorieen', ed: { kind: 'cat', id: m[1] } };
    if (h === 'regel-nieuw') return { tab: 'regels', ed: { kind: 'rule', isNew: true } };
    if (h.indexOf('regel-') === 0) return rule(+h.slice(6)) ? { tab: 'regels', ed: { kind: 'rule', id: +h.slice(6) } } : { tab: 'regels' };
    if (h === 'suggestie-regel' || (m = h.match(/^suggestie-(\d+)-regel$/))) {
      const s = m ? sugg.find((x) => x.id === +m[1]) : sugg[0];
      return s ? { tab: 'suggesties', ed: { kind: 'rule', isNew: true, from: s.id } } : { tab: 'suggesties' };
    }
    return null;
  }

  function delRoute(id) {
    if (!cat(id)) return { tab: 'categorieen' };
    // A top category with subcategories cannot be removed: show its editor instead
    return { tab: 'categorieen', ed: kids(id).length ? { kind: 'cat', id } : { kind: 'del', id } };
  }

  function applyRoute(r) {
    ui.tab = r.tab;
    ui.ed = r.ed || defaultEd(r.tab);
    if (ui.ed.kind === 'cat' && !ui.ed.isNew) ui.selCat = ui.ed.id;
    if (ui.ed.kind === 'del') ui.selCat = ui.ed.id;
    if (ui.ed.kind === 'rule' && !ui.ed.isNew) ui.selRule = ui.ed.id;
    ui.draft = draftFor(ui.ed);
    return !!r.ed;
  }

  // ---------- Painting ----------

  function content() {
    if (ui.tab === 'regels') return ruleTab();
    if (ui.tab === 'suggesties') return suggTab();
    return catTab();
  }

  function paint() {
    page.innerHTML =
      header() +
      tabs() +
      '<div class="ct-layout' + (ui.tabFlip ? ' anim-fade' : '') + '" role="tabpanel" id="ct-tabpanel" aria-labelledby="ct-tab-' + ui.tab + '">' +
        '<div class="ct-col">' + content() + '</div>' +
        '<div class="only-desktop ct-aside"><section class="ct-panel' + anim('anim-in', 60) + '" id="ct-panel" aria-label="' + esc(edLabel(ui.ed)) + '">' + editor('d', false) + '</section></div>' +
      '</div>';
    painted = true;
    ui.flip = false;
    ui.tabFlip = false;
  }

  function paintEditors() {
    const panel = page.querySelector('#ct-panel');
    if (panel) {
      panel.innerHTML = editor('d', false);
      panel.setAttribute('aria-label', edLabel(ui.ed));
    }
    const body = document.querySelector('.ct-sheet-body');
    if (body) {
      body.innerHTML = editor('p', true);
      body.parentElement.setAttribute('aria-label', edLabel(ui.ed));
    }
    ui.flip = false;
  }

  // Re-render while keeping keyboard focus on the same control
  function refresh(all, focusKey) {
    const a = document.activeElement;
    const key = focusKey || (a && a.dataset ? a.dataset.key : null);
    const inSheet = !focusKey && a && a.closest && !!a.closest('.ct-sheet');
    if (all) paint(); else paintEditors();
    if (!key) return;
    const scope = inSheet ? document.querySelector('.ct-sheet') : page;
    const el = scope && scope.querySelector('[data-key="' + key + '"]');
    if (el && !el.disabled && el.getClientRects().length) el.focus();
  }

  // ---------- Phone sheet ----------

  function openSheet(trigger) {
    removeSheet();
    ui.sheet = true;
    returnFocus = trigger || null;
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop ct-backdrop';
    wrap.innerHTML = '<div class="sheet ct-sheet" role="dialog" aria-modal="true" aria-label="' + esc(edLabel(ui.ed)) + '">' +
      '<div class="sheet-grip" aria-hidden="true"></div><div class="ct-sheet-body">' + editor('p', true) + '</div></div>';
    document.body.appendChild(wrap);
    document.body.classList.add('ct-locked');
    wire(wrap.querySelector('.ct-sheet'));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheet(); });
    const first = wrap.querySelector('[data-key="close"]');
    if (first) first.focus();
  }

  function removeSheet() {
    const old = document.querySelector('.ct-backdrop');
    if (old) old.remove();
    document.body.classList.remove('ct-locked');
  }

  function closeSheet(focusKey) {
    removeSheet();
    ui.sheet = false;
    ui.ed = defaultEd(ui.tab);
    ui.draft = draftFor(ui.ed);
    setHash(ui.tab);
    refresh(true, focusKey || returnFocus);
  }

  // Show an editor: in the side panel on desktop, in the bottom sheet on the phone
  function setEd(ed, trigger) {
    ui.ed = ed;
    ui.draft = draftFor(ed);
    if (ed.kind === 'cat' && !ed.isNew) ui.selCat = ed.id;
    if (ed.kind === 'rule' && !ed.isNew) ui.selRule = ed.id;
    setHash(hashFor(ed));
    if (isDesk()) {
      ui.flip = true;
      refresh(true);
    } else if (ui.sheet) {
      paintEditors();
      const sh = document.querySelector('.ct-sheet');
      sh.scrollTop = 0;
      const c = sh.querySelector('[data-key="close"]');
      if (c) c.focus();
    } else {
      openSheet(trigger);
    }
  }

  // Leave an editor without saving
  function cancel() {
    if (ui.sheet) { closeSheet(); return; }
    ui.ed = defaultEd(ui.tab);
    ui.draft = draftFor(ui.ed);
    setHash(ui.tab);
    ui.flip = true;
    refresh(true);
  }

  // After a save: phone closes the sheet, desktop shows `ed` in the panel
  function done(ed, focusKey) {
    if (ui.sheet) { closeSheet(focusKey); return; }
    ui.ed = ed;
    ui.draft = draftFor(ed);
    setHash(ed.kind === 'info' ? ui.tab : hashFor(ed));
    ui.flip = true;
    refresh(true, focusKey);
  }

  function setTab(id) {
    if (!TABS.some((t) => t[0] === id)) return;
    if (id !== ui.tab) {
      ui.tab = id;
      ui.ed = defaultEd(id);
      ui.draft = draftFor(ui.ed);
      ui.tabFlip = true;
      setHash(id);
    }
    refresh(true, 'tab-' + id);
  }

  // ---------- Actions ----------

  function showErrors(err, order) {
    ui.draft.err = err;
    paintEditors();
    const scope = ui.sheet ? document.querySelector('.ct-sheet') : page;
    const k = order.find((x) => err[x[0]]);
    const el = k && scope.querySelector('[data-key="' + k[1] + '"]');
    if (el) el.focus();
    announce(Object.keys(err).map((x) => err[x]).join(' '));
  }

  function saveCat() {
    if (offline()) { S.shell.toast('Je bent offline'); return; }
    const ed = ui.ed;
    const d = ui.draft;
    const c = ed.isNew ? null : cat(ed.id);
    const name = (d.name || '').trim() || (c ? c.name : '');
    const parent = d.place === 'top-out' || d.place === 'top-in' ? null : d.place;
    const type = parent ? cat(parent).type : (d.place === 'top-in' ? 'in' : 'out');
    let err = null;
    if (!name) err = 'Geef de categorie een naam.';
    else if (cats.some((x) => x !== c && x.parent === parent && x.type === type && x.name.toLowerCase() === name.toLowerCase())) {
      err = 'Er is al een categorie ‘' + name + '’ op die plaats.';
    }
    if (err) { showErrors({ name: err }, [['name', 'name']]); return; }
    const color = !parent && type === 'out' ? d.color : null;
    let target = c;
    if (c) {
      Object.assign(c, { name, parent, type, color });
    } else {
      target = { id: 'nieuw' + (nextCat++), name, type, parent, color, n: 0 };
      let at;
      if (parent) {
        at = cats.reduce((last, x, i) => (x.id === parent || x.parent === parent ? i : last), -1) + 1;
      } else if (type === 'out') {
        at = cats.findIndex((x) => topOf(x).type === 'in');
        if (at < 0) at = cats.length;
      } else at = cats.length;
      cats.splice(at, 0, target);
    }
    S.shell.toast(name + (c ? ' opgeslagen' : ' toegevoegd'));
    ui.selCat = target.id;
    done({ kind: 'cat', id: target.id }, 'cat-' + target.id);
  }

  function removeCat() {
    if (offline()) { S.shell.toast('Je bent offline'); return; }
    const c = cat(ui.ed.id);
    const d = ui.draft;
    const parent = c.parent ? cat(c.parent) : null;
    const target = d.to === 'parent' ? parent : (d.to === 'other' ? cat(d.other) : null);
    if (target) target.n += c.n;
    else setUncat(uncat + c.n);
    rules = rules.filter((r) => r.cat !== c.id || target);
    rules.forEach((r) => { if (r.cat === c.id) r.cat = target.id; });
    sugg = sugg.filter((s) => s.cat !== c.id || target);
    sugg.forEach((s) => { if (s.cat === c.id) s.cat = target.id; });
    seen.forEach((e) => { if (e.cat === c.id) e.cat = target ? target.id : null; });
    cats = cats.filter((x) => x !== c);
    S.shell.toast(c.name + ' verwijderd' + (c.n ? (target ? ' · ' + c.n + ' naar ' + target.name : ' · ' + c.n + ' zonder categorie') : ''));
    ui.selCat = (target && target.id) || (parent && parent.id) || tops('out')[0].id;
    done({ kind: 'cat', id: ui.selCat }, 'cat-' + ui.selCat);
  }

  function saveRule() {
    if (offline()) { S.shell.toast('Je bent offline'); return; }
    const ed = ui.ed;
    const d = ui.draft;
    const x = draftRule(d);
    const err = {};
    const mi = parseAmt(d.minIn);
    const ma = parseAmt(d.maxIn);
    if (Number.isNaN(mi) || Number.isNaN(ma)) err.amt = 'Vul een bedrag in euro in, bijvoorbeeld 20 of 19,99.';
    else if (mi !== null && ma !== null && mi > ma) err.amt = 'Het eerste bedrag moet kleiner zijn dan het tweede.';
    if (x.regex && x.comm && !validRe(x.comm)) err.comm = 'Deze reguliere expressie klopt niet.';
    if (!hasCond(x) && !err.amt) err.cond = 'Vul minstens één voorwaarde in.';
    if (!x.cat) err.cat = 'Kies een categorie.';
    if (Object.keys(err).length) {
      showErrors(err, [['cond', 'cp'], ['comm', 'comm'], ['amt', 'min'], ['cat', 'cat']]);
      return;
    }
    const hits = [];
    const m = matchInfo(x, hits);
    let r = ed.isNew ? null : rule(ed.id);
    if (r) {
      Object.assign(r, x);
      rules.splice(rules.indexOf(r), 1);
    } else {
      r = Object.assign({ id: nextRule++ }, x);
    }
    rules.splice(Math.min(d.prio - 1, rules.length), 0, r);
    if (d.apply) hits.forEach((e) => { e.cat = x.cat; e.diff = 0; });
    if (ed.from) {
      const s = sugg.find((y) => y.id === ed.from);
      sugg = sugg.filter((y) => y !== s);
      if (d.apply && s) setUncat(uncat - s.open);
    }
    S.shell.toast((ed.isNew ? 'Regel gemaakt' : 'Regel opgeslagen') + (d.apply && m.diff ? ' · ' + m.diff + ' bijgewerkt' : ''));
    ui.selRule = r.id;
    if (ed.from) done({ kind: 'info' }, sugg.length ? 'confirm-' + sugg[0].id : 'tab-suggesties');
    else done({ kind: 'rule', id: r.id }, 'rule-' + r.id);
  }

  function deleteRule() {
    if (offline()) { S.shell.toast('Je bent offline'); return; }
    const r = rule(ui.ed.id);
    const i = rules.indexOf(r);
    rules.splice(i, 1);
    S.shell.toast('Regel verwijderd');
    const next = rules[Math.min(i, rules.length - 1)];
    if (next) ui.selRule = next.id;
    done(next ? { kind: 'rule', id: next.id } : { kind: 'info' }, next ? 'rule-' + next.id : 'tab-regels');
  }

  function move(id, dir) {
    if (offline()) { S.shell.toast('Je bent offline'); return; }
    const i = rules.findIndex((r) => r.id === id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rules.length) return;
    const r = rules.splice(i, 1)[0];
    rules.splice(j, 0, r);
    if (ui.ed && ui.ed.kind === 'rule' && !ui.ed.isNew && rule(ui.ed.id)) ui.draft.prio = rules.indexOf(rule(ui.ed.id)) + 1;
    const edge = j === 0 || j === rules.length - 1;
    refresh(true, (edge ? (dir === 'up' ? 'down-' : 'up-') : dir + '-') + id);
    announce('Regel staat nu op plaats ' + (j + 1) + ' van ' + rules.length + '.');
  }

  function confirmSugg(id) {
    if (offline()) { S.shell.toast('Je bent offline'); return; }
    const i = sugg.findIndex((s) => s.id === id);
    const s = sugg[i];
    const c = cat(s.cat);
    sugg.splice(i, 1);
    c.n += s.open;
    seen.forEach((e) => { if (e.cp === s.cp) e.diff = 0; });
    setUncat(uncat - s.open);
    S.shell.toast(plural(s.open, 'transactie', 'transacties') + ' naar ' + c.name);
    refresh(true, sugg.length ? 'confirm-' + sugg[Math.min(i, sugg.length - 1)].id : 'tab-suggesties');
  }

  function ignoreSugg(id) {
    if (offline()) { S.shell.toast('Je bent offline'); return; }
    const i = sugg.findIndex((s) => s.id === id);
    sugg.splice(i, 1);
    S.shell.toast('Genegeerd');
    refresh(true, sugg.length ? 'confirm-' + sugg[Math.min(i, sugg.length - 1)].id : 'tab-suggesties');
  }

  // ---------- Events ----------

  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const a = el.dataset.action;
    const key = el.dataset.key;
    if (a === 'tab') setTab(el.dataset.tab);
    else if (a === 'cat') {
      if (isDesk() && ui.ed && ui.ed.kind === 'cat' && !ui.ed.isNew && ui.ed.id === el.dataset.id) return;
      setEd({ kind: 'cat', id: el.dataset.id }, key);
    } else if (a === 'new-cat') setEd({ kind: 'cat', isNew: true }, key);
    else if (a === 'new-sub') setEd({ kind: 'cat', isNew: true, parent: el.dataset.id }, returnFocus);
    else if (a === 'color') { ui.draft.color = el.dataset.color; refresh(false); }
    else if (a === 'save-cat') saveCat();
    else if (a === 'del') setEd({ kind: 'del', id: el.dataset.id }, returnFocus);
    else if (a === 'cancel-del') setEd({ kind: 'cat', id: ui.ed.id }, returnFocus);
    else if (a === 'confirm-del') removeCat();
    else if (a === 'rule') {
      const id = +el.dataset.id;
      if (isDesk() && ui.ed && ui.ed.kind === 'rule' && !ui.ed.isNew && ui.ed.id === id) return;
      setEd({ kind: 'rule', id }, key);
    } else if (a === 'new-rule') setEd({ kind: 'rule', isNew: true }, key);
    else if (a === 'move') move(+el.dataset.id, el.dataset.dir);
    else if (a === 'cpop') { ui.draft.cpOp = el.dataset.v; refresh(false); updatePreview(); }
    else if (a === 'regex') { ui.draft.regex = !ui.draft.regex; refresh(false); }
    else if (a === 'save-rule') saveRule();
    else if (a === 'del-rule') deleteRule();
    else if (a === 'confirm') confirmSugg(+el.dataset.id);
    else if (a === 'as-rule') setEd({ kind: 'rule', isNew: true, from: +el.dataset.id }, key);
    else if (a === 'ignore') ignoreSugg(+el.dataset.id);
    else if (a === 'cancel') cancel();
    else if (a === 'close') closeSheet();
  }

  function updatePreview() {
    const pv = preview(draftRule(ui.draft));
    document.querySelectorAll('[data-bind="preview"]').forEach((n) => {
      n.textContent = pv.text;
      n.parentElement.className = 'ct-preview' + (pv.tone ? ' ct-preview--' + pv.tone : '');
    });
  }

  // Typing updates the draft in place (no re-render, the caret stays)
  function onInput(e) {
    const el = e.target;
    const k = el.dataset.input;
    if (!k || el.tagName === 'SELECT' || el.type === 'radio' || el.type === 'checkbox') return;
    ui.draft[k] = el.value;
    if (k === 'name') {
      const c = ui.ed.isNew ? null : cat(ui.ed.id);
      const shown = el.value.trim() || (c ? c.name : 'Nieuwe categorie');
      document.querySelectorAll('.ct-editor [data-bind="title"], .ct-editor [data-bind="cname"]').forEach((n) => { n.textContent = shown; });
    } else updatePreview();
    if (el.getAttribute('aria-invalid')) {
      const box = el.closest('.ct-field');
      el.removeAttribute('aria-invalid');
      const msg = box && box.querySelector('.ct-err');
      if (msg) msg.remove();
    }
  }

  function onChange(e) {
    const el = e.target;
    const k = el.dataset.input;
    if (!k) return;
    if (el.type === 'checkbox') { ui.draft[k] = el.checked; return; }
    if (el.tagName !== 'SELECT' && el.type !== 'radio') return;
    ui.draft[k] = k === 'prio' ? +el.value : el.value;
    if (ui.draft.err && k === 'cat') delete ui.draft.err.cat;
    refresh(false);
  }

  function onKey(e) {
    const tab = e.target.closest && e.target.closest('.ct-tab');
    if (tab) {
      const i = TABS.findIndex((t) => t[0] === tab.dataset.tab);
      let n = null;
      if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
      else if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = TABS.length - 1;
      if (n !== null) { e.preventDefault(); setTab(TABS[n][0]); }
      return;
    }
    const sw = e.target.closest && e.target.closest('.ct-swatch');
    if (sw) {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const i = PASTELS.findIndex((x) => x[0] === sw.dataset.color);
      ui.draft.color = PASTELS[(i + step + PASTELS.length) % PASTELS.length][0];
      refresh(false, 'sw-' + ui.draft.color);
      const scope = sw.closest('.ct-sheet') ? document.querySelector('.ct-sheet') : page;
      const next = scope.querySelector('[data-key="sw-' + ui.draft.color + '"]');
      if (next) next.focus();
    }
  }

  function wire(root) {
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKey);
  }

  // ---------- Screen ----------

  function render(p) {
    page = p;
    if (!page.dataset.ctWired) {
      page.dataset.ctWired = '1';
      init();
      const r = route(location.hash) || { tab: 'categorieen' };
      const withEd = applyRoute(r);
      wire(page);
      live = document.createElement('p');
      live.className = 'visually-hidden';
      live.setAttribute('aria-live', 'polite');
      document.body.appendChild(live);
      paint();
      if (withEd && !isDesk()) openSheet(null);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) closeSheet(); });
      window.addEventListener('hashchange', () => {
        const rr = route(location.hash);
        if (!rr) return;
        removeSheet();
        ui.sheet = false;
        const ed = applyRoute(rr);
        paint();
        if (ed && !isDesk()) openSheet(null);
      });
      // Crossing the breakpoint: an open sheet becomes the side panel
      deskMq.addEventListener('change', () => {
        if (isDesk() && ui.sheet) { removeSheet(); ui.sheet = false; }
        paint();
      });
      return;
    }
    paint();
  }

  S.screens = S.screens || {};
  S.screens.categorieen = { title: 'Categorieën en regels', render };
})(window.Saldo = window.Saldo || {});
