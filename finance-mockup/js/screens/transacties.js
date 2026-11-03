// Transacties screen. Design boards: Telefoon-Transacties, Desktop-Transacties.
// Spec: analysis/screens/transacties.md. Concepts: transaction, category, categorisation-rule, internal-transfer.
// Phone: list + bottom sheets (detail, filters). Desktop: list + detail panel, filter popovers.
(function (S) {
  'use strict';

  const { eur, esc, cap, DAYS, MONTHS, MONTHS_SHORT } = S.fmt;
  const icon = S.icon;
  const D = S.data;

  S.icons.paths.chevronDown = '<path d="m6 9 6 6 6-6"></path>';
  // Learned suggestion: a four-point spark
  S.icons.paths.spark = '<path d="M12 4.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z"></path>';

  // Category look (analysis/concepts/category.md). Income and "Gespaard" use the green soft tint.
  const CAT = {
    wonen: { n: 'Wonen', bg: D.categories.Wonen, fg: 'var(--onPastel)' },
    bood: { n: 'Boodschappen', bg: D.categories.Boodschappen, fg: 'var(--onPastel)' },
    vrij: { n: 'Vrije tijd', bg: D.categories['Vrije tijd'], fg: 'var(--onPastel)' },
    verv: { n: 'Vervoer', bg: D.categories.Vervoer, fg: 'var(--onPastel)' },
    abo: { n: 'Abonnementen', bg: D.categories.Abonnementen, fg: 'var(--onPastel)' },
    ovr: { n: 'Overig', bg: D.categories.Overig, fg: 'var(--onC6)' },
    sal: { n: 'Salaris', bg: 'var(--soft)', fg: 'var(--greenText)', income: true },
    terug: { n: 'Terugbetaling', bg: 'var(--soft)', fg: 'var(--greenText)', income: true },
    spaar: { n: 'Gespaard', bg: 'var(--soft)', fg: 'var(--greenText)' }
  };
  const PICK = ['wonen', 'bood', 'vrij', 'verv', 'abo', 'ovr'];
  const PICK_IN = ['sal', 'terug'];

  // The rule behind Colruyt (Categorieën en regels, first rule)
  const COLRUYT = { id: 'regel-1', name: 'Colruyt' };

  // Demo rows as on the boards (analysis/concepts/transaction.md). `similar` = other transactions of
  // the same counterparty that a new rule would update. `transfer` = detected internal transfer to savings.
  // `rule` = category set by a rule, `sugg` = category from a learned suggestion (confidence %).
  const TX = [
    { id: 't1', date: '2026-11-18', name: 'Bol.com', ini: 'B', amt: -2499, cat: null, acc: 'zicht', pending: true, comm: 'Bestelling 4471-2210', similar: 5 },
    { id: 't2', date: '2026-11-18', name: 'Colruyt Laagste Prijzen', ini: 'C', amt: -8642, cat: 'bood', acc: 'gedeeld', comm: 'Bancontact · Colruyt Gent-Dampoort', similar: 14, rule: COLRUYT },
    { id: 't3', date: '2026-11-17', name: 'TotalEnergies', ini: 'T', amt: -6210, cat: 'verv', acc: 'zicht', comm: 'Bancontact · TotalEnergies Merelbeke', similar: 6, sugg: { pct: 92, from: 6 } },
    { id: 't4', date: '2026-11-17', name: 'Spotify', ini: 'S', amt: -1199, cat: 'abo', acc: 'zicht', comm: 'Spotify Premium', similar: 11 },
    { id: 't5', date: '2026-11-17', name: 'Bakkerij De Graankorrel', ini: 'B', amt: -840, cat: null, acc: 'zicht', comm: 'Bancontact', similar: 3 },
    { id: 't6', date: '2026-11-16', name: 'Naar spaarrekening', ini: 'S', amt: -20000, cat: 'spaar', acc: 'zicht', comm: 'Maandelijks sparen', transfer: true },
    { id: 't7', date: '2026-11-16', name: 'CM Ziekenfonds', ini: 'C', amt: 1850, cat: 'terug', acc: 'zicht', comm: 'Terugbetaling raadpleging', similar: 2 },
    { id: 't8', date: '2026-11-16', name: 'Delhaize', ini: 'D', amt: -5437, cat: 'bood', acc: 'gedeeld', comm: 'Bancontact · Delhaize Gent', similar: 9 },
    { id: 't9', date: '2026-11-15', name: 'Kinepolis', ini: 'K', amt: -2400, cat: 'vrij', acc: 'zicht', comm: 'Kinepolis Gent · 2 tickets', similar: 2 },
    { id: 't10', date: '2026-11-15', name: "Frituur 't Pleintje", ini: 'F', amt: -1450, cat: null, acc: 'zicht', comm: 'Payconiq', similar: 2 },
    { id: 't11', date: '2026-11-14', name: 'Decathlon', ini: 'D', amt: -4290, cat: 'vrij', acc: 'zicht', comm: 'Bancontact · Decathlon Gent', similar: 1 },
    { id: 't12', date: '2026-11-14', name: 'NMBS', ini: 'N', amt: -1960, cat: 'verv', acc: 'zicht', comm: 'Treinticket Gent – Brussel', similar: 4 }
  ];
  // "Oudere transacties laden"
  const MORE = [
    { id: 't13', date: '2026-11-13', name: 'Albert Heijn', ini: 'A', amt: -3214, cat: 'bood', acc: 'gedeeld', comm: 'Bancontact · AH Gent Zuid', similar: 7 },
    { id: 't14', date: '2026-11-13', name: 'Apotheek Van Damme', ini: 'A', amt: -1835, cat: null, acc: 'zicht', comm: 'Bancontact', similar: 1 },
    { id: 't15', date: '2026-11-12', name: 'Netflix', ini: 'N', amt: -1399, cat: 'abo', acc: 'zicht', comm: 'Netflix.com', similar: 11 },
    { id: 't16', date: '2026-11-12', name: 'Carrefour Express', ini: 'C', amt: -2265, cat: 'bood', acc: 'gedeeld', comm: 'Bancontact · Carrefour Gent', similar: 5 }
  ];
  const ALL = TX.concat(MORE);

  // Earlier months for the period filter: one template, dated into every month from November 2025
  // (first data) to October 2026. All categorised, so the "te categoriseren" count stays the same.
  const MONTH_TPL = [
    { d: 28, name: 'Spotify', ini: 'S', amt: -1199, cat: 'abo', acc: 'zicht', comm: 'Spotify Premium', similar: 11 },
    { d: 27, name: 'Netflix', ini: 'N', amt: -1399, cat: 'abo', acc: 'zicht', comm: 'Netflix.com', similar: 11 },
    { d: 24, name: 'Standaard Boekhandel', ini: 'S', amt: -2795, cat: 'vrij', acc: 'zicht', comm: 'Bancontact · Standaard Boekhandel Gent', similar: 2 },
    { d: 20, name: 'Delhaize', ini: 'D', amt: -4122, cat: 'bood', acc: 'gedeeld', comm: 'Bancontact · Delhaize Gent', similar: 9 },
    { d: 16, name: 'Naar spaarrekening', ini: 'S', amt: -20000, cat: 'spaar', acc: 'zicht', comm: 'Maandelijks sparen', transfer: true },
    { d: 12, name: 'TotalEnergies', ini: 'T', amt: -5840, cat: 'verv', acc: 'zicht', comm: 'Bancontact · TotalEnergies Merelbeke', similar: 6 },
    { d: 9, name: 'Proximus', ini: 'P', amt: -4298, cat: 'abo', acc: 'gedeeld', comm: 'Internet en tv', similar: 11 },
    { d: 5, name: 'Colruyt Laagste Prijzen', ini: 'C', amt: -7418, cat: 'bood', acc: 'gedeeld', comm: 'Bancontact · Colruyt Gent-Dampoort', similar: 14, rule: COLRUYT },
    { d: 2, name: 'Werkgever NV', ini: 'W', amt: 285000, cat: 'sal', acc: 'zicht', comm: (m) => 'Loon ' + m, similar: 11 },
    { d: 1, name: 'Immo Verhaeghe', ini: 'I', amt: -100500, cat: 'wonen', acc: 'zicht', comm: (m) => 'Huur ' + m, similar: 11 }
  ];
  // Category used by the "#regel-gemaakt" deep link for rows without one
  const DEMO_CAT = { t1: 'ovr', t5: 'bood', t10: 'vrij', t14: 'ovr' };

  const NOW_YM = D.today.slice(0, 7);
  const FIRST_YM = '2025-11';
  const TITLES = { rekening: 'Rekening', periode: 'Periode', categorie: 'Categorie' };

  const ymAdd = (ym, n) => {
    const m = +ym.slice(0, 4) * 12 + (+ym.slice(5) - 1) + n;
    return Math.floor(m / 12) + '-' + String(m % 12 + 1).padStart(2, '0');
  };
  const PREV_YM = ymAdd(NOW_YM, -1);
  const ymName = (ym) => MONTHS[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4);
  const lastDay = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate();

  // Every row ever shown, by id (for the count and deep links)
  const REG = {};
  ALL.forEach((t) => { REG[t.id] = t; });
  const gen = {};

  function monthRows(ym) {
    if (ym === NOW_YM) return ALL;
    if (!gen[ym]) {
      const mname = MONTHS[+ym.slice(5) - 1];
      gen[ym] = MONTH_TPL.map((r, i) => {
        const t = Object.assign({}, r, {
          id: 'm' + ym.replace('-', '') + '-' + (i + 1),
          date: ym + '-' + String(r.d).padStart(2, '0'),
          comm: typeof r.comm === 'function' ? r.comm(mname) : r.comm
        });
        delete t.d;
        REG[t.id] = t;
        return t;
      });
    }
    return gen[ym];
  }

  function byId(id) {
    const m = /^m(\d{4})(\d{2})-\d+$/.exec(id || '');
    if (m && !REG[id]) {
      const ym = m[1] + '-' + m[2];
      if (ym >= FIRST_YM && ym < NOW_YM) monthRows(ym);
    }
    return REG[id] || null;
  }

  const desktopMq = window.matchMedia('(min-width: 1024px)');

  // Screen state (kept across scope re-renders)
  const ui = {
    uncat: new URLSearchParams(location.search).get('filter') === 'niet-gecategoriseerd',
    query: '',
    more: false,
    loadingMore: false,
    sel: 't2',        // desktop detail panel; the board opens on Colruyt
    sheetId: null,    // phone bottom sheet
    rule: false,
    cats: {},         // manual category choices: id -> category key
    notes: {},
    acc: null,        // account filter (id)
    cat: null,        // category filter (key); "Niet gecategoriseerd" is `uncat`
    period: { ym: NOW_YM },  // { ym } or { from, to }
    open: null,       // open filter dropdown: rekening | periode | categorie
    customOpen: false,
    custom: null,     // draft of "Eigen periode"
    tr: {},           // transfer override per row, for this viewer: true (is one) | false (is none)
    splits: {},       // saved splits: id -> [{ cat, amt }]
    splitEdit: null,  // { id, parts: [{ cat, input }] }
    newRule: {}       // rules made from a row in this session: id -> rule name
  };
  let pageEl = null;
  let scope = 'alles';
  let lastFocus = null;
  let booted = false;
  let linked = false;       // deep links handled after the first full render
  let pendingOpen = null;   // ?tx=<id>, opened once the list is there

  const isEmpty = () => D.demo() === 'leeg';
  const offline = () => D.demo() === 'offline';

  function blocked() {
    if (!offline()) return false;
    S.shell.toast('Je bent offline · wijzigen kan weer zodra je verbinding hebt');
    return true;
  }

  // ---------- Derived values ----------

  // Internal transfer for this viewer: 'spaar' (detected, to savings), 'eigen' (marked by you) or null
  function trOf(t) {
    const o = ui.tr[t.id];
    if (o === false) return null;
    if (t.transfer) return 'spaar';
    return o === true ? 'eigen' : null;
  }

  function view(t) {
    const a = D.account(t.acc);
    const tr = trOf(t);
    const split = !tr && ui.splits[t.id] ? ui.splits[t.id] : null;
    const base = t.transfer ? null : t.cat;
    const c = tr || split ? null : (ui.cats[t.id] !== undefined ? ui.cats[t.id] : base);
    const m = tr === 'spaar' ? CAT.spaar : (c ? CAT[c] : null);
    const shared = a.group === 'ged';
    const catName = tr === 'spaar' ? 'Gespaard'
      : tr === 'eigen' ? 'Overschrijving'
        : split ? 'Gesplitst · ' + split.length + ' categorieën'
          : (m ? m.n : 'Niet gecategoriseerd');
    return Object.assign({}, t, {
      c, m, tr, split, catName,
      uncat: !c && !tr && !split,
      accName: a.name,
      accColor: a.color || 'gray',
      accLabel: shared ? 'Gedeeld' : 'Persoonlijk',
      accCls: shared ? 'ged' : 'pers',
      group: a.group,
      ro: D.readOnly(t.acc),
      income: t.amt > 0,
      amount: eur(t.amt, true),
      amtCls: t.pending ? 'muted' : (t.amt < 0 && !tr ? 'neg' : '')
    });
  }

  // Where the category came from (analysis/concepts/categorisation-rule.md: manual > rule > suggestion)
  function srcOf(v) {
    if (!v.c) return null;
    if (ui.newRule[v.id]) return { kind: 'newrule', name: ui.newRule[v.id] };
    if (ui.cats[v.id] !== undefined) return { kind: 'manual' };
    if (v.rule) return { kind: 'rule', id: v.rule.id, name: v.rule.name };
    if (v.sugg) return { kind: 'sugg', pct: v.sugg.pct, from: v.sugg.from };
    return null;
  }

  // The demo count minus what you resolved in this session, plus rows that became uncategorised
  function uncatCount() {
    let n = D.toCategorise;
    Object.keys(REG).forEach((id) => {
      const t = REG[id];
      const was = !t.cat && !t.transfer;
      n += (view(t).uncat ? 1 : 0) - (was ? 1 : 0);
    });
    return Math.max(0, n);
  }

  function accountsInScope() {
    return D.accounts
      .filter((a) => scope === 'alles' || a.group === (scope === 'gedeeld' ? 'ged' : 'pers'))
      .map((a) => D.account(a.id));
  }

  const periodIsNow = () => ui.period.ym === NOW_YM;
  const filtersSet = () => !!(ui.acc || ui.cat || ui.uncat || !periodIsNow());

  function periodRows() {
    const p = ui.period;
    if (p.ym) return p.ym === NOW_YM ? (ui.more ? ALL : TX) : monthRows(p.ym);
    let out = [];
    let ym = p.to.slice(0, 7) > NOW_YM ? NOW_YM : p.to.slice(0, 7);
    const stop = p.from.slice(0, 7) < FIRST_YM ? FIRST_YM : p.from.slice(0, 7);
    while (ym >= stop) { out = out.concat(monthRows(ym)); ym = ymAdd(ym, -1); }
    return out.filter((t) => t.date >= p.from && t.date <= p.to);
  }

  function matches(v, q) {
    if (!q) return true;
    const hay = [v.name, v.comm, v.amount, (Math.abs(v.amt) / 100).toFixed(2), v.catName].join(' ').toLowerCase();
    return hay.includes(q);
  }

  function visibleRows() {
    const q = ui.query.trim().toLowerCase();
    return periodRows().map(view)
      .filter((v) => scope === 'alles' || (scope === 'gedeeld' ? v.group === 'ged' : v.group === 'pers'))
      .filter((v) => !ui.acc || v.acc === ui.acc)
      .filter((v) => !ui.cat || v.c === ui.cat || (v.split && v.split.some((p) => p.cat === ui.cat)))
      .filter((v) => !ui.uncat || v.uncat)
      .filter((v) => matches(v, q));
  }

  // "Vandaag · woensdag 18 november", "Maandag · 16 november"
  function dayHead(date) {
    const x = new Date(date + 'T12:00:00');
    const t = new Date(D.today + 'T12:00:00');
    const days = Math.round((t - x) / 86400000);
    const dm = x.getDate() + ' ' + MONTHS[x.getMonth()] + (x.getFullYear() !== t.getFullYear() ? ' ' + x.getFullYear() : '');
    if (days === 0) return { main: 'Vandaag', sub: DAYS[x.getDay()] + ' ' + dm };
    if (days === 1) return { main: 'Gisteren', sub: DAYS[x.getDay()] + ' ' + dm };
    return { main: cap(DAYS[x.getDay()]), sub: dm };
  }

  function dateFull(date) {
    const x = new Date(date + 'T12:00:00');
    return DAYS[x.getDay()] + ' ' + x.getDate() + ' ' + MONTHS[x.getMonth()] + ' ' + x.getFullYear();
  }

  function shortDate(d) {
    const x = new Date(d + 'T12:00:00');
    return x.getDate() + ' ' + MONTHS_SHORT[x.getMonth()] + (x.getFullYear() !== +NOW_YM.slice(0, 4) ? ' ' + x.getFullYear() : '');
  }
  const rangeText = (f, t) => shortDate(f) + ' – ' + shortDate(t);

  // Amounts typed in the split editor: "64,92", "1.250,00" or "64.92" -> cents
  function parseAmt(s) {
    let x = String(s || '').replace(/[\s€]/g, '');
    if (!x) return 0;
    if (x.indexOf(',') >= 0) x = x.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(x);
    return isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }
  const fmtIn = (c) => Math.floor(c / 100) + ',' + String(c % 100).padStart(2, '0');

  // ---------- Pieces ----------

  const accDot = (color) => '<i class="tx-dot" style="background:var(--a-' + color + ')" aria-hidden="true"></i>';
  const catDot = (k) => (k
    ? '<i class="tx-dot' + (CAT[k].income ? ' tx-dot--in' : '') + '" style="background:' + CAT[k].bg + '" aria-hidden="true"></i>'
    : '<i class="tx-dot tx-dot--uncat" aria-hidden="true"></i>');

  function splitBg(parts) {
    const total = parts.reduce((s, p) => s + p.amt, 0) || 1;
    let run = 0;
    const stops = parts.map((p) => {
      const a = run / total * 100;
      run += p.amt;
      return CAT[p.cat].bg + ' ' + a.toFixed(1) + '% ' + (run / total * 100).toFixed(1) + '%';
    });
    return 'linear-gradient(135deg, ' + stops.join(', ') + ')';
  }

  function avatar(v, cls) {
    if (v.tr === 'eigen') return '<span class="tx-av tx-av--tr ' + cls + '" aria-hidden="true">' + icon('transfer', 18, 2.2) + '</span>';
    if (v.split) return '<span class="tx-av ' + cls + '" style="background:' + splitBg(v.split) + ';color:var(--onPastel)" aria-hidden="true">' + esc(v.ini) + '</span>';
    return v.m
      ? '<span class="tx-av ' + cls + '" style="background:' + v.m.bg + ';color:' + v.m.fg + '" aria-hidden="true">' + esc(v.ini) + '</span>'
      : '<span class="tx-av tx-av--uncat ' + cls + '" aria-hidden="true">?</span>';
  }

  // The board's Persoonlijk / Gedeeld label, with the account's own colour as a dot (decision 3 Nov 2026)
  function accLabel(v) {
    return '<span class="acc-label acc-label--' + v.accCls + ' tx-acc"><i style="background:var(--a-' + v.accColor + ')" aria-hidden="true"></i>' + v.accLabel + '</span>';
  }

  function chips() {
    const chev = icon('chevronDown', 14, 2.4);
    const dd = (kind, html, text, set) =>
      '<button type="button" class="filter-chip tx-chip tx-dd' + (set ? ' tx-chip--set' : '') + '" data-dd="' + kind + '" aria-haspopup="dialog" aria-expanded="' + (ui.open === kind) + '"' +
        ' aria-label="' + esc(TITLES[kind] + ': ' + text) + '">' + html + chev + '</button>';

    const a = ui.acc ? D.account(ui.acc) : null;
    const acc = a ? dd('rekening', accDot(a.color || 'gray') + esc(a.name), a.name, true) : dd('rekening', 'Alle rekeningen', 'Alle rekeningen', false);

    const p = ui.period;
    let per;
    if (p.ym) {
      const m = cap(MONTHS[+p.ym.slice(5) - 1]);
      const y = p.ym.slice(0, 4);
      const yHtml = y === NOW_YM.slice(0, 4) ? '<span class="only-desktop"> ' + y + '</span>' : ' ' + y;
      per = dd('periode', esc(m) + yHtml, m + ' ' + y, p.ym !== NOW_YM);
    } else {
      const t = rangeText(p.from, p.to);
      per = dd('periode', esc(t), t, true);
    }

    const cat = ui.cat ? dd('categorie', catDot(ui.cat) + esc(CAT[ui.cat].n), CAT[ui.cat].n, true) : dd('categorie', 'Categorie', 'Alle categorieën', false);

    return '<button type="button" class="filter-chip tx-chip tx-chip--uncat" data-action="uncat" aria-pressed="' + ui.uncat + '">Niet gecategoriseerd<span class="tx-count" data-uncat-count>' + uncatCount() + '</span></button>' +
      acc + per + cat +
      (filtersSet() ? '<button type="button" class="tx-clear" data-action="clear">Wis filters</button>' : '');
  }

  function header() {
    const title = '<div class="tx-title anim-fade"><h1>Transacties</h1>' +
      '<a class="avatar only-phone" href="meer.html" aria-label="Profiel en meer" style="background:' + D.user.tint + '">' + esc(D.user.initial) + '</a></div>';
    if (isEmpty()) return '<div class="tx-head tx-head--empty">' + title + '</div>';
    return '<div class="tx-head">' + title +
      '<div class="tx-search anim-in" style="--d:30ms">' + icon('search', 18, 2.2) +
        '<input type="search" class="tx-search-input" aria-label="Zoeken in transacties" placeholder="Zoek op naam, bedrag of mededeling" value="' + esc(ui.query) + '"></div>' +
      '<div class="tx-filters">' +
        S.shell.scopeSwitch('tx-scope anim-in') +
        '<div class="tx-chips anim-in" style="--d:60ms">' + chips() + '</div>' +
      '</div>' +
    '</div>';
  }

  function catChip(v) {
    if (v.split) return '<span class="tx-cat tx-cat--split">' + esc(v.catName) + '</span>';
    if (v.tr === 'eigen') return '<span class="tx-cat tx-cat--tr">' + icon('transfer', 13, 2.4) + 'Overschrijving</span>';
    return '<span class="tx-cat' + (v.m ? '' : ' tx-cat--uncat') + '"' + (v.m ? ' style="background:' + v.m.bg + ';color:' + v.m.fg + '"' : '') + '>' + esc(v.catName) + '</span>';
  }

  function row(v, first) {
    const on = desktopMq.matches && v.id === ui.sel;
    const pending = '<span class="tx-pending">In behandeling</span>';
    const phoneCat = v.split
      ? '<span class="tx-splitchip only-phone">' + esc(v.catName) + '</span>'
      : '<span class="tx-row-sub-text only-phone">' + esc(v.catName) + '</span>';
    return '<button type="button" class="tx-row' + (first ? ' tx-row--first' : '') + (v.split ? ' tx-row--split' : '') + '" data-id="' + v.id + '"' +
        (desktopMq.matches ? ' aria-pressed="' + on + '"' : ' aria-haspopup="dialog"') + '>' +
      avatar(v, '') +
      '<span class="tx-row-main">' +
        '<span class="tx-row-name"><span class="tx-name">' + esc(v.name) + '</span>' + (v.pending ? '<span class="only-desktop">' + pending + '</span>' : '') + '</span>' +
        '<span class="tx-row-sub">' + accLabel(v) +
          '<span class="visually-hidden only-phone">' + esc(v.accName) + ',</span>' +
          phoneCat +
          '<span class="only-desktop tx-row-sub-text">' + esc(v.accName) + '</span></span>' +
      '</span>' +
      '<span class="only-desktop tx-catcell">' + catChip(v) + '</span>' +
      '<span class="tx-row-end">' +
        '<span class="tx-amount mono ' + v.amtCls + '">' + v.amount + '</span>' +
        (v.pending ? '<span class="only-phone">' + pending + '</span>' : '') +
      '</span>' +
    '</button>';
  }

  function skeleton() {
    const line = (w, h) => '<span class="tx-skel" style="width:' + w + ';height:' + h + 'px"></span>';
    const phoneRow = (a, b) => '<div class="tx-skel-row"><span class="tx-skel tx-skel--av"></span><span class="tx-skel-lines">' + line(a, 12) + line(b, 10) + '</span></div>';
    return '<div class="tx-skel-card" aria-label="Oudere transacties laden" role="status">' +
      '<div class="only-phone tx-skel-stack">' + phoneRow('60%', '40%') + phoneRow('52%', '34%') + '</div>' +
      '<div class="only-desktop"><div class="tx-skel-stack">' + line('55%', 14) + line('40%', 14) + '</div></div>' +
    '</div>';
  }

  function emptyState() {
    const q = ui.query.trim();
    const a = ui.acc ? D.account(ui.acc) : null;
    let title;
    let note;
    if (q) {
      title = 'Geen transacties gevonden';
      note = 'Niets voor “' + esc(q) + '” ' + (filtersSet() ? 'met deze filters.' : 'in deze rekeningen.');
    } else if (a && a.type === 'savings') {
      title = 'Geen transacties op ' + esc(a.name);
      note = 'Een spaarrekening heeft een handmatig saldo. Overschrijvingen ernaar zie je op de rekening waar ze vertrekken.';
    } else if (ui.uncat) {
      title = 'Niets meer te categoriseren';
      note = 'Alle transacties in deze lijst hebben een categorie.';
    } else if (filtersSet()) {
      title = 'Geen transacties';
      note = 'Niets dat past bij deze filters.';
    } else {
      title = 'Geen transacties';
      note = 'Er zijn nog geen transacties voor deze rekeningen.';
    }
    return '<div class="tx-empty"><strong>' + title + '</strong><span>' + note + '</span>' +
      (filtersSet() ? '<button type="button" class="tx-clear tx-clear--empty" data-action="clear">Wis filters</button>' : '') + '</div>';
  }

  // Demo state "leeg": no accounts, so no transactions yet
  function blank() {
    return '<section class="tx-blank anim-in" style="--d:40ms" aria-labelledby="tx-blank-title">' +
      '<span class="tx-blank-icon" aria-hidden="true">' + icon('list', 26, 2.2) + '</span>' +
      '<h2 id="tx-blank-title">Nog geen transacties</h2>' +
      '<p>Koppel je bank om je transacties elke nacht op te halen, of importeer een CSV-bestand, bijvoorbeeld je export uit Bilance.</p>' +
      '<div class="tx-blank-actions">' +
        '<a class="btn btn--primary" href="bankkoppelingen.html#nieuw">' + icon('bank', 18, 2.2) + 'Bank koppelen</a>' +
        '<a class="btn btn--ghost" href="importeren.html">' + icon('upload', 18, 2.2) + 'CSV importeren</a>' +
      '</div>' +
    '</section>';
  }

  function list(animate) {
    const rows = visibleRows();
    const days = [];
    rows.forEach((v) => {
      let d = days.find((x) => x.date === v.date);
      if (!d) { d = { date: v.date, rows: [] }; days.push(d); }
      d.rows.push(v);
    });
    const base = desktopMq.matches ? 60 : 90;
    const html = days.map((d, i) => {
      const h = dayHead(d.date);
      return '<section class="tx-day' + (animate ? ' anim-in' : '') + '" style="--d:' + (base + Math.min(i, 8) * 30) + 'ms">' +
        '<h2 class="tx-day-head">' + esc(h.main) + ' <span>· ' + esc(h.sub) + '</span></h2>' +
        '<div class="tx-card">' + d.rows.map((v, j) => row(v, j === 0)).join('') + '</div>' +
      '</section>';
    }).join('');
    const showLoad = periodIsNow() && !ui.more && !ui.loadingMore && !ui.uncat;
    return (html || emptyState()) +
      (ui.loadingMore ? skeleton() : '') +
      (showLoad ? '<button type="button" class="tx-more" data-action="more">Oudere transacties laden</button>' : '');
  }

  // ---------- Detail: sheet on phone, side panel on desktop (same content) ----------

  function sourceStrip(v) {
    const s = srcOf(v);
    if (!s) return '';
    const strip = (cls, ic, title, sub, end) => '<div class="tx-src' + cls + '">' + ic +
      '<span class="tx-src-text"><strong>' + title + '</strong>' + (sub ? '<span>' + sub + '</span>' : '') + '</span>' + (end || '') + '</div>';
    if (s.kind === 'rule') {
      return strip('', icon('tag', 18, 2.2), 'Via regel ‘' + esc(s.name) + '’', 'Geldt ook voor nieuwe transacties',
        v.ro ? '' : '<a class="tx-src-link" href="categorieen.html#' + s.id + '">Regel aanpassen</a>');
    }
    if (s.kind === 'newrule') {
      return strip('', icon('tag', 18, 2.2), 'Via nieuwe regel ‘' + esc(s.name) + '’', 'Net gemaakt · staat bij je regels',
        '<a class="tx-src-link" href="categorieen.html#regels" data-key="rule-view">Regel bekijken</a>');
    }
    if (s.kind === 'sugg') {
      return strip(' tx-src--sugg', icon('spark', 18, 2), 'Suggestie · ' + s.pct + '\u00A0%', 'Geleerd uit ' + s.from + ' eerdere transacties van ' + esc(v.name),
        v.ro ? '' : '<button type="button" class="tx-src-btn" data-action="confirm" data-key="confirm"' + (offline() ? ' aria-disabled="true"' : '') + '>Bevestigen</button>');
    }
    return strip(' tx-src--manual', icon('check', 18, 2.4), 'Zelf gekozen', 'Regels en suggesties overschrijven dit niet');
  }

  function picker(v, sheet) {
    const off = offline();
    const keys = v.income ? PICK_IN : PICK;
    const picks = keys.map((k) => {
      const c = CAT[k];
      const on = v.c === k;
      const ring = c.income ? 'var(--softChip)' : c.bg;
      return '<button type="button" class="tx-pick" data-pick="' + k + '" data-key="pick-' + k + '" aria-pressed="' + on + '"' + (off ? ' aria-disabled="true"' : '') + ' style="' +
        (on ? 'background:' + c.bg + ';color:' + c.fg + ';border-color:var(--text)' : 'border-color:' + ring) + '">' +
        (on ? icon('check', sheet ? 15 : 14, 3) : '') + esc(c.n) + '</button>';
    }).join('');
    const similarText = v.similar
      ? 'Ook ' + v.similar + ' andere transacties van ' + v.name + ' krijgen deze categorie.'
      : 'Nieuwe transacties van ' + v.name + ' krijgen deze categorie.';
    const mode = sheet ? 'sheet' : 'panel';
    return '<div class="tx-picker">' +
      '<span class="tx-picker-label" id="tx-pick-label-' + mode + '">Kies een categorie</span>' +
      '<div class="tx-picks" role="group" aria-labelledby="tx-pick-label-' + mode + '">' + picks + '</div>' +
      '<label class="tx-rule"><input type="checkbox" data-action="rule" data-key="rule"' + (ui.rule ? ' checked' : '') + (off ? ' disabled' : '') + '>' +
        '<span><strong>Toepassen op vergelijkbare en regel maken</strong><br><span class="muted">' + esc(similarText) + '</span></span></label>' +
      '<div class="tx-actions">' +
        '<button type="button" class="tx-action" data-action="split" data-key="split"' + (off ? ' aria-disabled="true"' : '') + '>Splitsen</button>' +
        '<button type="button" class="tx-action" data-action="transfer" data-key="transfer"' + (off ? ' aria-disabled="true"' : '') + '>Is een overschrijving</button>' +
      '</div>' +
    '</div>';
  }

  function partsView(v) {
    const sign = v.amt < 0 ? -1 : 1;
    return '<div class="tx-partsview">' +
      '<span class="tx-picker-label">Verdeling</span>' +
      '<div class="tx-splitbar" aria-hidden="true">' + v.split.map((p) => '<span style="flex:' + p.amt + ';background:' + CAT[p.cat].bg + '"></span>').join('') + '</div>' +
      '<ul class="tx-partlist">' + v.split.map((p) =>
        '<li>' + catDot(p.cat) + '<span class="tx-part-name">' + esc(CAT[p.cat].n) + '</span><span class="mono ' + (sign < 0 && !v.pending ? 'neg' : '') + '">' + eur(sign * p.amt, true) + '</span></li>').join('') +
      '</ul>' +
      (v.ro ? '' : '<button type="button" class="tx-action tx-action--wide" data-action="split" data-key="split"' + (offline() ? ' aria-disabled="true"' : '') + '>' + icon('split', 16, 2.2) + 'Splitsing aanpassen</button>') +
    '</div>';
  }

  function transferBlock(v) {
    const undo = v.ro ? '' : '<button type="button" class="tx-action tx-action--wide" data-action="untransfer" data-key="untransfer"' + (offline() ? ' aria-disabled="true"' : '') + '>Is geen overschrijving</button>';
    if (v.tr === 'spaar') {
      return '<p class="tx-note tx-note--saved">Overschrijving naar je spaarrekening. Telt als gespaard, niet als uitgave.</p>' + undo;
    }
    return '<div class="tx-note tx-note--transfer">' + icon('transfer', 18, 2.2) +
      '<span><strong>Overschrijving tussen eigen rekeningen</strong><br>Telt niet mee als inkomen of uitgave · alleen voor jou</span></div>' + undo;
  }

  function readOnlyBlock(v) {
    return '<div class="tx-ro"><span class="chip chip--readonly">' + icon('lock', 14, 2.2) + 'Alleen lezen</span>' +
      '<p>' + esc(D.partner.name) + ' gaf je leesrechten op de ' + esc(v.accName) + '. Categorie, splitsing en notitie kan je hier niet wijzigen.</p></div>';
  }

  function detail(id, mode) {
    const t = byId(id);
    if (!t) return '';
    const v = view(t);
    if (ui.splitEdit && ui.splitEdit.id === id && !v.ro && !v.tr) return splitEditor(v, mode);
    const sheet = mode === 'sheet';
    const off = offline();
    const noteId = 'tx-note-' + mode;

    let edit;
    if (v.tr) edit = transferBlock(v);
    else if (v.split) edit = partsView(v);
    else if (v.ro) edit = '';
    else {
      edit = (t.transfer && ui.tr[id] === false
        ? '<p class="tx-note tx-note--muted">Voor jou geen overschrijving meer. Kies een categorie, of markeer haar opnieuw als overschrijving.</p>'
        : '') + picker(v, sheet);
    }

    return '<div class="tx-detail tx-detail--' + mode + '">' +
      '<div class="tx-detail-head">' +
        avatar(v, 'tx-av--lg') +
        '<div class="tx-detail-title"><span class="tx-detail-name"' + (sheet ? ' id="tx-sheet-title"' : '') + '>' + esc(v.name) + '</span>' +
          '<span class="tx-row-sub">' + accLabel(v) + '<span class="tx-row-sub-text">' + esc(v.accName) + '</span></span></div>' +
        (sheet ? '<button type="button" class="tx-close" data-action="close" data-key="close" aria-label="Sluiten">' + icon('close', 18, 2.4) + '</button>' : '') +
      '</div>' +
      '<div class="tx-detail-amount"><span class="mono ' + v.amtCls + '">' + v.amount + '</span>' +
        '<span class="tx-status">' + (v.pending ? 'In behandeling' : 'Geboekt') + '</span></div>' +
      '<dl class="tx-dl">' +
        '<dt>Datum</dt><dd>' + esc(dateFull(v.date)) + '</dd>' +
        '<dt>Mededeling</dt><dd>' + esc(v.comm) + '</dd>' +
        '<dt>Categorie</dt><dd class="tx-dl-strong">' + esc(v.catName) + '</dd>' +
        (v.ro && ui.notes[id] ? '<dt>Notitie</dt><dd>' + esc(ui.notes[id]) + '</dd>' : '') +
      '</dl>' +
      (v.pending ? '<p class="tx-note tx-note--muted">Nog in behandeling. Telt mee in de totalen zodra de bank ze boekt.</p>' : '') +
      sourceStrip(v) +
      (v.ro ? readOnlyBlock(v) : '') +
      edit +
      (v.ro ? '' :
        '<div class="field tx-field"><label for="' + noteId + '">Notitie</label>' +
          '<input class="input" id="' + noteId + '" data-note data-key="note" placeholder="Bijvoorbeeld: verjaardagscadeau" value="' + esc(ui.notes[id] || '') + '"' + (off ? ' readonly aria-disabled="true"' : '') + '></div>' +
        (off ? '<p class="tx-offline">' + icon('cloudOff', 16, 2.2) + 'Je bent offline. Opslaan kan weer zodra je verbinding hebt.</p>' : '') +
        '<button type="button" class="tx-save" data-action="save" data-key="save"' + (off ? ' aria-disabled="true"' : '') + '>Opslaan</button>') +
    '</div>';
  }

  // ---------- Split editor ----------

  function startSplit(id, demo) {
    const t = byId(id);
    const v = view(t);
    let parts;
    if (v.split) parts = v.split.map((p) => ({ cat: p.cat, input: fmtIn(p.amt) }));
    else if (demo) {
      // Deep link #splitsen: half-way through, so "Nog te verdelen" shows an amount
      const total = Math.abs(t.amt);
      const first = id === 't2' ? 6492 : Math.round(total * 0.75);
      const c = v.c || (v.income ? 'terug' : 'bood');
      const other = v.income ? (c === 'sal' ? 'terug' : 'sal') : (c === 'ovr' ? 'bood' : 'ovr');
      parts = [{ cat: c, input: fmtIn(first) }, { cat: other, input: '' }];
    } else parts = [{ cat: v.c, input: '' }, { cat: null, input: '' }];
    ui.splitEdit = { id, parts };
  }

  function splitState(v) {
    const parts = ui.splitEdit.parts;
    const amts = parts.map((p) => parseAmt(p.input));
    const rest = Math.abs(v.amt) - amts.reduce((s, a) => s + a, 0);
    let hint = '';
    if (rest > 0) hint = 'Verdeel het hele bedrag om op te slaan.';
    else if (rest < 0) hint = 'Samen is dat meer dan het bedrag van de transactie.';
    else if (parts.some((p) => !p.cat)) hint = 'Kies voor elk deel een categorie.';
    else if (amts.some((a) => a <= 0)) hint = 'Geef elk deel een bedrag.';
    return { rest, hint, ok: !hint && parts.length >= 2 };
  }

  function restHtml(v) {
    const s = splitState(v);
    const cls = s.rest === 0 ? 'ok' : (s.rest < 0 ? 'neg' : 'open');
    return '<div class="tx-rest tx-rest--' + cls + '">' + (s.rest === 0 ? icon('check', 16, 2.6) : '') +
      '<span>' + (s.rest < 0 ? 'Te veel verdeeld' : 'Nog te verdelen') + '</span><span class="mono">' + eur(Math.abs(s.rest)) + '</span></div>' +
      (s.hint ? '<p class="tx-help">' + s.hint + '</p>' : '');
  }

  function splitEditor(v, mode) {
    const se = ui.splitEdit;
    const sheet = mode === 'sheet';
    const keys = v.income ? PICK_IN : PICK;
    const st = splitState(v);
    const parts = se.parts.map((p, i) => {
      const pid = 'tx-part-' + mode + '-' + i;
      const opts = '<option value="">Kies een categorie</option>' +
        keys.map((k) => '<option value="' + k + '"' + (p.cat === k ? ' selected' : '') + '>' + esc(CAT[k].n) + '</option>').join('');
      return '<div class="tx-part">' +
        '<div class="tx-part-cat">' +
          '<i class="tx-part-dot' + (p.cat ? '' : ' tx-part-dot--empty') + '" data-dot="' + i + '"' + (p.cat ? ' style="background:' + CAT[p.cat].bg + '"' : '') + ' aria-hidden="true"></i>' +
          '<label class="visually-hidden" for="' + pid + '-c">Categorie van deel ' + (i + 1) + '</label>' +
          '<select class="input tx-select" id="' + pid + '-c" data-part-cat="' + i + '" data-key="pc' + i + '">' + opts + '</select>' +
          icon('chevronDown', 16, 2.4) +
        '</div>' +
        '<div class="tx-money"><span aria-hidden="true">€</span>' +
          '<label class="visually-hidden" for="' + pid + '-a">Bedrag van deel ' + (i + 1) + '</label>' +
          '<input class="input tx-money-input" id="' + pid + '-a" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + esc(p.input) + '" data-part-amt="' + i + '" data-key="pa' + i + '">' +
        '</div>' +
        '<button type="button" class="tx-part-del" data-action="part-del" data-i="' + i + '" data-key="pd' + i + '" aria-label="Deel ' + (i + 1) + ' verwijderen"' + (se.parts.length <= 2 ? ' disabled' : '') + '>' + icon('trash', 18, 2) + '</button>' +
      '</div>';
    }).join('');

    return '<div class="tx-detail tx-split tx-detail--' + mode + '">' +
      '<div class="tx-detail-head">' +
        '<button type="button" class="tx-close" data-action="split-cancel" data-key="back" aria-label="Terug naar de transactie">' + icon('back', 20, 2.4) + '</button>' +
        '<div class="tx-detail-title"><span class="tx-detail-name"' + (sheet ? ' id="tx-sheet-title"' : '') + '>Splitsen</span>' +
          '<span class="tx-row-sub"><span class="tx-row-sub-text">' + esc(v.name) + '</span></span></div>' +
        '<span class="mono tx-split-total ' + v.amtCls + '">' + v.amount + '</span>' +
      '</div>' +
      '<p class="tx-help">Verdeel het bedrag over twee of meer categorieën. Elk deel telt mee in zijn eigen categorie.</p>' +
      '<div class="tx-parts" role="group" aria-label="Delen">' + parts + '</div>' +
      '<button type="button" class="tx-add" data-action="part-add" data-key="add">' + icon('plus', 16, 2.6) + 'Deel toevoegen</button>' +
      '<div class="tx-rest-wrap" data-rest-wrap aria-live="polite">' + restHtml(v) + '</div>' +
      '<div class="tx-btns">' +
        '<button type="button" class="tx-btn tx-btn--ghost" data-action="split-cancel" data-key="cancel">Annuleren</button>' +
        '<button type="button" class="tx-btn tx-btn--primary" data-action="split-save" data-key="ssave" aria-disabled="' + (!st.ok || offline()) + '">Opslaan</button>' +
      '</div>' +
      (offline() ? '<p class="tx-offline">' + icon('cloudOff', 16, 2.2) + 'Je bent offline. Opslaan kan weer zodra je verbinding hebt.</p>' : '') +
      (v.split ? '<button type="button" class="tx-linkbtn" data-action="split-remove" data-key="unsplit">Splitsing ongedaan maken</button>' : '') +
    '</div>';
  }

  function updateRest(input) {
    const root = input.closest('.tx-split');
    const v = view(byId(ui.splitEdit.id));
    root.querySelector('[data-rest-wrap]').innerHTML = restHtml(v);
    root.querySelector('[data-action="split-save"]').setAttribute('aria-disabled', String(!splitState(v).ok || offline()));
  }

  function saveSplit() {
    if (blocked()) return;
    const id = curId();
    const v = view(byId(id));
    const st = splitState(v);
    if (!st.ok) { S.shell.toast(st.hint || 'Verdeel eerst het hele bedrag'); return; }
    ui.splits[id] = ui.splitEdit.parts.map((p) => ({ cat: p.cat, amt: parseAmt(p.input) }));
    ui.splitEdit = null;
    ui.rule = false;
    refreshDetail('split');
    S.shell.toast('Gesplitst over ' + ui.splits[id].length + ' categorieën');
  }

  // ---------- Updates ----------

  const curId = () => ui.sheetId || ui.sel;

  function renderList(animate) {
    const el = pageEl && pageEl.querySelector('#tx-list');
    if (el) el.innerHTML = list(animate);
  }

  function renderChips() {
    const el = pageEl && pageEl.querySelector('.tx-chips');
    if (el) el.innerHTML = chips();
  }

  function renderPanel(animate) {
    const el = pageEl && pageEl.querySelector('#tx-panel');
    if (!el) return;
    el.innerHTML = ui.sel ? '<div class="tx-panel-inner' + (animate ? ' tx-panel-in' : '') + '">' + detail(ui.sel, 'panel') + '</div>' : '';
  }

  function renderSheetBody() {
    const body = document.querySelector('#tx-sheet .tx-sheet-body');
    if (body && ui.sheetId) body.innerHTML = detail(ui.sheetId, 'sheet');
  }

  function updateCounts() {
    const n = uncatCount();
    document.querySelectorAll('[data-uncat-count]').forEach((el) => { el.textContent = n; });
    const badge = document.querySelector('.side-link[aria-current="page"] .side-badge');
    if (badge) badge.textContent = n;
  }

  // Re-render the detail (and the list) and keep focus on the control with the same data-key
  function refreshDetail(focusKey, detailOnly) {
    if (!detailOnly) { renderList(false); updateCounts(); }
    const root = ui.sheetId ? document.getElementById('tx-sheet') : pageEl && pageEl.querySelector('#tx-panel');
    if (ui.sheetId) renderSheetBody(); else renderPanel(false);
    const el = focusKey && root && root.querySelector('[data-key="' + focusKey + '"]');
    if (el) el.focus();
  }

  // Desktop: keep the panel on a visible row when the filters change
  function ensureSelection() {
    if (!desktopMq.matches) return false;
    const rows = visibleRows();
    if (!rows.length || rows.some((v) => v.id === ui.sel)) return false;
    ui.sel = rows[0].id;
    ui.rule = false;
    ui.splitEdit = null;
    return true;
  }

  function filtersChanged() {
    const moved = ensureSelection();
    renderChips();
    renderList(true);
    if (moved) renderPanel(true);
  }

  function clearFilters() {
    ui.acc = null;
    ui.cat = null;
    ui.uncat = false;
    ui.period = { ym: NOW_YM };
    ui.custom = null;
    filtersChanged();
    const chip = pageEl.querySelector('[data-action="uncat"]');
    if (chip) chip.focus();
  }

  // ---------- Phone sheet ----------

  function removeSheet() {
    const el = document.getElementById('tx-sheet');
    if (el) el.remove();
    if (!document.getElementById('tx-dd')) document.body.classList.remove('tx-locked');
  }

  function openSheet(id, trigger) {
    if (!ui.splitEdit || ui.splitEdit.id !== id) ui.splitEdit = null;
    ui.sheetId = id;
    ui.sel = id;
    ui.rule = false;
    lastFocus = trigger || null;
    removeSheet();
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop tx-backdrop';
    wrap.id = 'tx-sheet';
    wrap.innerHTML = '<div class="sheet tx-sheet" role="dialog" aria-modal="true" aria-label="Transactie bewerken">' +
      '<div class="sheet-grip"></div><div class="tx-sheet-body"></div></div>';
    document.body.appendChild(wrap);
    document.body.classList.add('tx-locked');
    renderSheetBody();
    bindDetail(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheet(); });
    const first = wrap.querySelector('[data-key="close"], [data-key="back"]');
    if (first) first.focus();
  }

  function closeSheet() {
    removeSheet();
    ui.sheetId = null;
    ui.splitEdit = null;
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
    else {
      const r = pageEl && pageEl.querySelector('.tx-row[data-id="' + ui.sel + '"]');
      if (r) r.focus();
    }
    lastFocus = null;
  }

  // Category pick, rule toggle, split, transfer, note, save; shared by sheet and panel
  function bindDetail(root) {
    root.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        if (blocked()) return;
        const id = curId();
        ui.cats[id] = pick.dataset.pick;
        delete ui.newRule[id];
        refreshDetail('pick-' + pick.dataset.pick);
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (btn) onDetailAction(btn.dataset.action, btn);
    });
    root.addEventListener('change', (e) => {
      const el = e.target;
      if (el.matches('[data-action="rule"]')) ui.rule = el.checked;
      else if (el.matches('[data-part-cat]') && ui.splitEdit) {
        const i = +el.dataset.partCat;
        const k = el.value || null;
        ui.splitEdit.parts[i].cat = k;
        const dot = el.closest('.tx-part-cat').querySelector('[data-dot]');
        dot.classList.toggle('tx-part-dot--empty', !k);
        dot.style.background = k ? CAT[k].bg : '';
        updateRest(el);
      }
    });
    root.addEventListener('input', (e) => {
      const el = e.target;
      if (el.matches('[data-note]')) ui.notes[curId()] = el.value;
      else if (el.matches('[data-part-amt]') && ui.splitEdit) {
        ui.splitEdit.parts[+el.dataset.partAmt].input = el.value;
        updateRest(el);
      }
    });
    // Offline: the note is read-only, a tap explains why
    root.addEventListener('focusin', (e) => {
      if (offline() && e.target.matches('[data-note]')) blocked();
    });
  }

  function onDetailAction(a, btn) {
    const id = curId();
    if (a === 'close') closeSheet();
    else if (a === 'save') save();
    else if (a === 'split') {
      if (blocked()) return;
      startSplit(id, false);
      refreshDetail('pc0', true);
    } else if (a === 'transfer' || a === 'untransfer') markTransfer(a === 'transfer');
    else if (a === 'confirm') {
      if (blocked()) return;
      const v = view(byId(id));
      ui.cats[id] = v.c;
      refreshDetail('pick-' + v.c);
      S.shell.toast('Suggestie bevestigd · ' + v.catName);
    } else if (a === 'part-add') {
      ui.splitEdit.parts.push({ cat: null, input: '' });
      refreshDetail('pc' + (ui.splitEdit.parts.length - 1), true);
    } else if (a === 'part-del') {
      if (ui.splitEdit.parts.length <= 2) return;
      ui.splitEdit.parts.splice(+btn.dataset.i, 1);
      refreshDetail('add', true);
    } else if (a === 'split-cancel') {
      ui.splitEdit = null;
      refreshDetail('split', true);
    } else if (a === 'split-save') saveSplit();
    else if (a === 'split-remove') {
      if (blocked()) return;
      delete ui.splits[id];
      ui.splitEdit = null;
      refreshDetail('split');
      S.shell.toast('Splitsing ongedaan gemaakt');
    }
  }

  // "Is een overschrijving" / "Is geen overschrijving": stored for this viewer only (analysis 5.2)
  function markTransfer(on) {
    if (blocked()) return;
    const id = curId();
    const t = byId(id);
    if (on) {
      if (t.transfer) delete ui.tr[id]; else ui.tr[id] = true;
      ui.rule = false;
      refreshDetail('untransfer');
      S.shell.toast('Gemarkeerd als overschrijving · alleen voor jou');
    } else {
      if (t.transfer) ui.tr[id] = false; else delete ui.tr[id];
      refreshDetail('transfer');
      S.shell.toast('Geen overschrijving meer · alleen voor jou');
    }
  }

  function save() {
    if (offline()) { S.shell.toast('Je bent offline · opslaan kan weer zodra je verbinding hebt'); return; }
    const id = curId();
    const t = byId(id);
    const v = view(t);
    let text = 'Opgeslagen';
    if (ui.rule && !v.tr && !v.split) {
      if (!v.c) { S.shell.toast('Kies eerst een categorie voor de regel'); return; }
      ui.cats[id] = v.c;
      ui.newRule[id] = t.name;
      text = 'Regel ‘' + t.name + '’ gemaakt' + (t.similar ? ' · ' + t.similar + ' andere bijgewerkt' : '');
    }
    ui.rule = false;
    if (ui.sheetId) { closeSheet(); renderList(false); updateCounts(); } else refreshDetail(text === 'Opgeslagen' ? 'save' : 'rule-view');
    S.shell.toast(text);
  }

  function loadMore() {
    ui.loadingMore = true;
    renderList(false);
    setTimeout(() => {
      ui.loadingMore = false;
      ui.more = true;
      renderList(false);
    }, 800);
  }

  // ---------- Filter dropdowns: popover on desktop, bottom sheet on phone ----------

  function opt(val, on, lead, name, sub, end) {
    return '<button type="button" class="tx-opt" data-opt="' + val + '" aria-pressed="' + on + '">' +
      '<span class="tx-opt-lead">' + (lead || '') + '</span>' +
      '<span class="tx-opt-main"><span class="tx-opt-name">' + name + '</span>' + (sub ? '<span class="tx-opt-sub">' + sub + '</span>' : '') + '</span>' +
      (end || '') +
      '<span class="tx-opt-check">' + (on ? icon('check', 18, 2.6) : '') + '</span>' +
    '</button>';
  }

  function ddRekening() {
    const accs = accountsInScope();
    const sub = (a) => (a.group === 'ged' ? 'Gedeeld' : 'Persoonlijk') + ' · ' +
      (a.type === 'savings' ? 'handmatig saldo' : a.iban) + (D.readOnly(a.id) ? ' · alleen lezen' : '');
    return '<div class="tx-opts">' +
      opt('acc:', !ui.acc, '<span class="tx-opt-icon">' + icon('grid', 15, 2.2) + '</span>', 'Alle rekeningen', accs.length + (accs.length === 1 ? ' rekening' : ' rekeningen')) +
      accs.map((a) => opt('acc:' + a.id, ui.acc === a.id, accDot(a.color || 'gray'), esc(a.name), esc(sub(a)))).join('') +
    '</div>';
  }

  function ddCategorie() {
    return '<div class="tx-opts">' +
      opt('cat:', !ui.cat && !ui.uncat, '<span class="tx-opt-icon">' + icon('tag', 15, 2.2) + '</span>', 'Alle categorieën') +
    '</div>' +
    '<div class="tx-dd-label">Uitgaven</div>' +
    '<div class="tx-opts">' + PICK.map((k) => opt('cat:' + k, ui.cat === k, catDot(k), esc(CAT[k].n))).join('') + '</div>' +
    '<div class="tx-dd-label">Inkomsten</div>' +
    '<div class="tx-opts">' + PICK_IN.map((k) => opt('cat:' + k, ui.cat === k, catDot(k), esc(CAT[k].n))).join('') + '</div>' +
    '<div class="tx-dd-sep"></div>' +
    '<div class="tx-opts">' + opt('cat:uncat', ui.uncat, catDot(null), 'Niet gecategoriseerd', '', '<span class="tx-count">' + uncatCount() + '</span>') + '</div>';
  }

  function defaultCustom() {
    const p = ui.period;
    if (!p.ym) return { from: p.from, to: p.to };
    const end = p.ym + '-' + String(lastDay(p.ym)).padStart(2, '0');
    return { from: p.ym + '-01', to: end > D.today ? D.today : end };
  }

  function ddPeriode(mode) {
    const p = ui.period;
    const years = [];
    for (let y = +NOW_YM.slice(0, 4); y >= +FIRST_YM.slice(0, 4); y--) years.push(y);
    const grid = years.map((y) => {
      const btns = [];
      for (let m = 1; m <= 12; m++) {
        const ym = y + '-' + String(m).padStart(2, '0');
        if (ym < FIRST_YM || ym > NOW_YM) continue;
        btns.push('<button type="button" class="tx-month" data-opt="per:' + ym + '" aria-pressed="' + (p.ym === ym) + '" aria-label="' + ymName(ym) + '">' + MONTHS_SHORT[m - 1] + '</button>');
      }
      return '<div class="tx-year"><span class="tx-year-label" aria-hidden="true">' + y + '</span><div class="tx-months" role="group" aria-label="' + y + '">' + btns.join('') + '</div></div>';
    }).join('');
    const c = ui.custom || defaultCustom();
    const min = FIRST_YM + '-01';
    const custom = ui.customOpen
      ? '<div class="tx-custom">' +
          '<div class="tx-custom-row">' +
            '<div class="field"><label class="field-label" for="tx-from-' + mode + '">Van</label><input type="date" class="input" id="tx-from-' + mode + '" data-custom="from" data-key="from" min="' + min + '" max="' + D.today + '" value="' + c.from + '"></div>' +
            '<div class="field"><label class="field-label" for="tx-to-' + mode + '">Tot en met</label><input type="date" class="input" id="tx-to-' + mode + '" data-custom="to" data-key="to" min="' + min + '" max="' + D.today + '" value="' + c.to + '"></div>' +
          '</div>' +
          '<button type="button" class="btn btn--primary btn--block" data-action="custom-apply" data-key="apply">Toepassen</button>' +
        '</div>'
      : '';
    return '<div class="tx-opts">' +
        opt('per:' + NOW_YM, p.ym === NOW_YM, '', 'Deze maand', ymName(NOW_YM)) +
        opt('per:' + PREV_YM, p.ym === PREV_YM, '', 'Vorige maand', ymName(PREV_YM)) +
      '</div>' +
      '<div class="tx-dd-sep"></div>' +
      '<div class="tx-dd-label">Maand</div>' + grid +
      '<div class="tx-dd-sep"></div>' +
      '<button type="button" class="tx-opt tx-opt--custom" data-action="custom-toggle" data-key="custom" aria-expanded="' + ui.customOpen + '" aria-pressed="' + !p.ym + '">' +
        '<span class="tx-opt-lead"><span class="tx-opt-icon">' + icon('calendar', 15, 2.2) + '</span></span>' +
        '<span class="tx-opt-main"><span class="tx-opt-name">Eigen periode</span><span class="tx-opt-sub">' + (p.ym ? 'Van – tot' : esc(rangeText(p.from, p.to))) + '</span></span>' +
        '<span class="tx-opt-check tx-opt-chev">' + icon('chevronDown', 16, 2.4) + '</span>' +
      '</button>' + custom;
  }

  function ddBody(kind, mode) {
    if (kind === 'rekening') return ddRekening();
    if (kind === 'categorie') return ddCategorie();
    return ddPeriode(mode);
  }

  function ddFoot() {
    return filtersSet() ? '<div class="tx-dd-foot"><button type="button" class="tx-clear" data-action="clear" data-key="clear">Wis filters</button></div>' : '';
  }

  function openDd(kind) {
    removeDd();
    ui.open = kind;
    // A custom range in use opens with its dates showing
    ui.customOpen = kind === 'periode' && !ui.period.ym;
    let root;
    if (desktopMq.matches) {
      root = document.createElement('div');
      root.className = 'tx-pop';
      root.id = 'tx-dd';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-label', TITLES[kind] + ' kiezen');
      root.innerHTML = '<div class="tx-dd-body">' + ddBody(kind, 'pop') + '</div>' + ddFoot();
      document.body.appendChild(root);
      placePop(root);
    } else {
      root = document.createElement('div');
      root.className = 'sheet-backdrop tx-backdrop';
      root.id = 'tx-dd';
      root.innerHTML = '<div class="sheet tx-sheet tx-ddsheet" role="dialog" aria-modal="true" aria-labelledby="tx-dd-title">' +
        '<div class="sheet-grip"></div>' +
        '<div class="tx-dd-head"><h2 id="tx-dd-title">' + TITLES[kind] + '</h2>' +
          '<button type="button" class="tx-close" data-action="dd-close" data-key="close" aria-label="Sluiten">' + icon('close', 18, 2.4) + '</button></div>' +
        '<div class="tx-dd-body">' + ddBody(kind, 'sheet') + '</div>' + ddFoot() + '</div>';
      document.body.appendChild(root);
      document.body.classList.add('tx-locked');
    }
    bindDd(root);
    syncChips();
    const first = root.querySelector('[data-opt][aria-pressed="true"]') || root.querySelector('[data-opt]');
    if (first) first.focus();
  }

  function placePop(pop) {
    const chip = pageEl && pageEl.querySelector('[data-dd="' + ui.open + '"]');
    if (!chip) return;
    const r = chip.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = Math.max(16, Math.min(r.left, window.innerWidth - w - 16)) + 'px';
    pop.style.top = (r.bottom + 8) + 'px';
    pop.style.maxHeight = (window.innerHeight - r.bottom - 24) + 'px';
  }

  function removeDd() {
    const el = document.getElementById('tx-dd');
    if (el) el.remove();
    if (!document.getElementById('tx-sheet')) document.body.classList.remove('tx-locked');
  }

  function closeDd(silent) {
    if (!ui.open && !document.getElementById('tx-dd')) return;
    const kind = ui.open;
    ui.open = null;
    ui.customOpen = false;
    ui.custom = null;
    removeDd();
    syncChips();
    if (!silent && kind && pageEl) {
      const chip = pageEl.querySelector('[data-dd="' + kind + '"]');
      if (chip) chip.focus();
    }
  }

  function syncChips() {
    if (!pageEl) return;
    pageEl.querySelectorAll('[data-dd]').forEach((c) => c.setAttribute('aria-expanded', String(c.dataset.dd === ui.open)));
  }

  function renderDdBody(focusKey) {
    const root = document.getElementById('tx-dd');
    if (!root || !ui.open) return;
    root.querySelector('.tx-dd-body').innerHTML = ddBody(ui.open, root.classList.contains('tx-pop') ? 'pop' : 'sheet');
    if (root.classList.contains('tx-pop')) placePop(root);
    const el = focusKey && root.querySelector('[data-key="' + focusKey + '"]');
    if (el) el.focus();
  }

  function applyOpt(val) {
    const i = val.indexOf(':');
    const k = val.slice(0, i);
    const v = val.slice(i + 1);
    if (k === 'acc') ui.acc = v || null;
    else if (k === 'cat') {
      if (v === 'uncat') { ui.uncat = true; ui.cat = null; } else { ui.cat = v || null; ui.uncat = false; }
    } else if (k === 'per') ui.period = { ym: v };
    closeDd();
    filtersChanged();
    const chip = pageEl.querySelector('[data-dd="' + (k === 'acc' ? 'rekening' : k === 'cat' ? 'categorie' : 'periode') + '"]');
    if (chip) chip.focus();
  }

  function applyCustom(root) {
    const f = root.querySelector('[data-custom="from"]').value;
    const t = root.querySelector('[data-custom="to"]').value;
    const min = FIRST_YM + '-01';
    if (!f || !t) { S.shell.toast('Kies een begin- en einddatum'); return; }
    if (f > t) { S.shell.toast('De begindatum ligt na de einddatum'); return; }
    ui.period = { from: f < min ? min : f, to: t > D.today ? D.today : t };
    closeDd();
    filtersChanged();
    const chip = pageEl.querySelector('[data-dd="periode"]');
    if (chip) chip.focus();
  }

  function bindDd(root) {
    root.addEventListener('click', (e) => {
      if (e.target === root && root.classList.contains('sheet-backdrop')) { closeDd(); return; }
      const o = e.target.closest('[data-opt]');
      if (o) { applyOpt(o.dataset.opt); return; }
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const a = b.dataset.action;
      if (a === 'dd-close') closeDd();
      else if (a === 'custom-toggle') {
        ui.customOpen = !ui.customOpen;
        renderDdBody(ui.customOpen ? 'from' : 'custom');
      } else if (a === 'custom-apply') applyCustom(root);
      else if (a === 'clear') { closeDd(true); clearFilters(); }
    });
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-custom]')) {
        ui.custom = Object.assign(ui.custom || defaultCustom(), { [e.target.dataset.custom]: e.target.value });
      }
    });
    // Arrow keys move through the options
    root.addEventListener('keydown', (e) => {
      const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
      if (!(e.key in keys) || !e.target.closest('[data-opt], [data-action="custom-toggle"]')) return;
      const items = Array.prototype.slice.call(root.querySelectorAll('[data-opt], [data-action="custom-toggle"]'));
      const i = items.indexOf(e.target.closest('[data-opt], [data-action="custom-toggle"]'));
      const next = items[(i + keys[e.key] + items.length) % items.length];
      if (next) { e.preventDefault(); next.focus(); }
    });
  }

  // ---------- Deep links (mockup: screenshots and links from other screens) ----------

  function catKey(name) {
    const s = String(name).toLowerCase();
    if (s === 'uncat' || s === 'niet gecategoriseerd' || s === 'niet-gecategoriseerd') return 'uncat';
    if (CAT[s] && s !== 'spaar') return s;
    return Object.keys(CAT).find((k) => k !== 'spaar' && CAT[k].n.toLowerCase() === s) || null;
  }

  // ?periode=2026-10 | vorige | deze | 2026-K3 | 2026 | eigen (Overzicht passes month, quarter and year keys)
  function parsePeriod(s) {
    const min = FIRST_YM + '-01';
    const clamp = (f, t) => {
      const from = f < min ? min : f;
      const to = t > D.today ? D.today : t;
      return from <= to ? { from, to } : null;
    };
    if (s === 'deze') return { ym: NOW_YM };
    if (s === 'vorige') return { ym: PREV_YM };
    if (s === 'eigen') return clamp(NOW_YM + '-01', D.today);
    let m = /^(\d{4})-(\d{2})$/.exec(s);
    if (m) return s >= FIRST_YM && s <= NOW_YM ? { ym: s } : null;
    m = /^(\d{4})-K([1-4])$/.exec(s);
    if (m) {
      const last = m[1] + '-' + String(+m[2] * 3).padStart(2, '0');
      return clamp(m[1] + '-' + String(+m[2] * 3 - 2).padStart(2, '0') + '-01', last + '-' + lastDay(last));
    }
    if (/^\d{4}$/.test(s)) return clamp(s + '-01-01', s + '-12-31');
    return null;
  }

  // Make sure a deep-linked row is in the list
  function reveal(id) {
    const t = byId(id);
    const ym = t.date.slice(0, 7);
    if (MORE.indexOf(t) >= 0) ui.more = true;
    const inPeriod = ui.period.ym ? ui.period.ym === ym : (t.date >= ui.period.from && t.date <= ui.period.to);
    if (!inPeriod) ui.period = { ym };
  }

  function boot() {
    booted = true;
    const q = new URLSearchParams(location.search);
    const acc = q.get('rekening');
    if (acc && D.accounts.some((a) => a.id === acc)) ui.acc = acc;
    const cat = q.get('categorie');
    if (cat) {
      const k = catKey(cat);
      if (k === 'uncat') ui.uncat = true;
      else if (k) { ui.cat = k; ui.uncat = false; }
    }
    const per = q.get('periode');
    if (per) ui.period = parsePeriod(per) || ui.period;
    const tx = q.get('tx');
    if (tx && byId(tx)) {
      reveal(tx);
      ui.sel = tx;
      pendingOpen = tx;
    }
  }

  function showTx(id) {
    ui.sel = id;
    if (desktopMq.matches) {
      renderList(false);
      renderPanel(true);
      updateCounts();
    } else if (ui.sheetId === id) {
      renderSheetBody();
      renderList(false);
      updateCounts();
    } else {
      renderList(false);
      updateCounts();
      openSheet(id, null);
    }
  }

  // #splitsen, #gesplitst, #overschrijving, #geen-overschrijving, #regel-gemaakt,
  // #filter-rekening, #filter-periode, #filter-periode-eigen, #filter-categorie
  function applyHash() {
    const h = location.hash.slice(1);
    const fromQuery = !!pendingOpen;
    const id = pendingOpen || ui.sheetId || ui.sel;
    pendingOpen = null;
    if (h.indexOf('filter-') === 0) {
      const kind = h.slice(7).split('-')[0];
      if (!TITLES[kind]) return;
      // Wait for the chips to finish their entry animation, so the popover lines up
      setTimeout(() => {
        openDd(kind);
        if (h === 'filter-periode-eigen') { ui.customOpen = true; renderDdBody('from'); }
      }, desktopMq.matches ? 320 : 0);
      return;
    }
    const t = byId(id);
    if (!t) return;
    const v = view(t);
    if (h === 'splitsen' && !v.tr && !v.ro) startSplit(id, true);
    else if (h === 'gesplitst' && !v.tr) {
      const total = Math.abs(t.amt);
      const first = id === 't2' ? 6492 : Math.round(total * 0.75);
      const c = v.c || (v.income ? 'terug' : 'bood');
      ui.splits[id] = [{ cat: c, amt: first }, { cat: v.income ? (c === 'sal' ? 'terug' : 'sal') : (c === 'ovr' ? 'bood' : 'ovr'), amt: total - first }];
    } else if (h === 'overschrijving' && !t.transfer) ui.tr[id] = true;
    else if (h === 'geen-overschrijving' && t.transfer) ui.tr[id] = false;
    else if (h === 'regel-gemaakt' && !v.tr) {
      ui.cats[id] = v.c || DEMO_CAT[id] || (v.income ? 'terug' : 'ovr');
      ui.newRule[id] = t.name;
    } else if (!fromQuery || desktopMq.matches) return;
    // Phone: a state hash without ?tx shows the list; ?tx or #splitsen open the sheet
    if (!desktopMq.matches && !fromQuery && h !== 'splitsen') {
      renderList(false);
      updateCounts();
      return;
    }
    showTx(id);
  }

  // ---------- Screen ----------

  function render(page, st) {
    pageEl = page;
    scope = st.scope;
    closeDd(true);
    if (!booted) boot();
    if (ui.acc && !accountsInScope().some((a) => a.id === ui.acc)) ui.acc = null;
    page.classList.add('tx-page');

    if (isEmpty()) {
      removeSheet();
      ui.sheetId = null;
      page.innerHTML = header() + '<div class="tx-body"><div class="tx-list-wrap"><div class="tx-list">' + blank() + '</div></div></div>';
      return;
    }

    page.innerHTML =
      header() +
      '<div class="tx-body">' +
        '<div class="tx-list-wrap"><div class="tx-list" id="tx-list"></div></div>' +
        '<aside class="tx-panel only-desktop" id="tx-panel" aria-label="Transactie"></aside>' +
      '</div>';
    ensureSelection();
    renderList(true);
    renderPanel(true);
    updateCounts();

    page.querySelector('.tx-search-input').addEventListener('input', (e) => {
      ui.query = e.target.value;
      renderList(false);
    });
    page.querySelector('.tx-head').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action], [data-dd]');
      if (!btn) return;
      if (btn.dataset.dd) {
        if (ui.open === btn.dataset.dd) closeDd();
        else openDd(btn.dataset.dd);
      } else if (btn.dataset.action === 'uncat') {
        ui.uncat = !ui.uncat;
        if (ui.uncat) ui.cat = null;
        filtersChanged();
        const chip = pageEl.querySelector('[data-action="uncat"]');
        if (chip) chip.focus();
      } else if (btn.dataset.action === 'clear') clearFilters();
    });
    page.querySelector('#tx-list').addEventListener('click', (e) => {
      if (e.target.closest('[data-action="more"]')) { loadMore(); return; }
      if (e.target.closest('[data-action="clear"]')) { clearFilters(); return; }
      const r = e.target.closest('.tx-row');
      if (!r) return;
      const id = r.dataset.id;
      if (desktopMq.matches) {
        if (id === ui.sel) return;
        ui.sel = id;
        ui.rule = false;
        ui.splitEdit = null;
        pageEl.querySelectorAll('.tx-row[aria-pressed]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.id === id));
        renderPanel(true);
      } else {
        openSheet(id, r);
      }
    });
    bindDetail(page.querySelector('#tx-panel'));

    if (!linked) {
      linked = true;
      if (pendingOpen || location.hash) applyHash();
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('tx-dd')) { closeDd(); return; }
    if (document.getElementById('tx-sheet')) closeSheet();
  });

  // Desktop popover: close on a click or focus outside it
  const outside = (e) => {
    const pop = document.getElementById('tx-dd');
    if (!pop || !pop.classList.contains('tx-pop')) return;
    if (pop.contains(e.target) || (e.target.closest && e.target.closest('[data-dd]'))) return;
    closeDd(true);
  };
  document.addEventListener('mousedown', outside);
  document.addEventListener('focusin', outside);
  window.addEventListener('resize', () => {
    const pop = document.getElementById('tx-dd');
    if (pop && pop.classList.contains('tx-pop')) placePop(pop);
  });

  window.addEventListener('hashchange', () => {
    if (pageEl && !isEmpty()) applyHash();
  });

  // Crossing the breakpoint: the sheet becomes the side panel, rows switch between dialog and toggle semantics
  desktopMq.addEventListener('change', () => {
    closeDd(true);
    if (desktopMq.matches && ui.sheetId) {
      const keep = ui.splitEdit;
      closeSheet();
      ui.splitEdit = keep;
    }
    if (isEmpty()) return;
    renderList(false);
    renderPanel(false);
  });

  S.screens = S.screens || {};
  S.screens.transacties = { title: 'Transacties', render };
})(window.Saldo = window.Saldo || {});
