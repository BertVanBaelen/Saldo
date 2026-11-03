// Overzicht screen (past months). Design boards: Telefoon-Overzicht, Desktop-Overzicht.
// Spec: analysis/screens/overzicht.md, analysis/concepts/period-overview.md.
// With several accounts the totals are information only ("samen, ter info") with a breakdown per account;
// no state colours on sums (decisions 3 Nov 2026, analysis/concepts/scope.md).
(function (S) {
  'use strict';

  const { eur, esc, cap } = S.fmt;
  const icon = S.icon;
  const D = S.data;

  S.icons.paths.chevronDown = '<path d="m6 9 6 6 6-6"></path>';

  // ---------- Demo data (from the boards' renderVals) ----------

  // Per month, scope Alles: [title, short, key, income, saved, expenses per category in CATS order, split?].
  // Internal transfers are left out; the € 200 to savings shows as "Gespaard" (analysis/concepts/internal-transfer.md).
  // History starts in November 2025. November 2026 runs until today and is only reachable through "Eigen";
  // its split per account is explicit (matches Start "Uitgaven november" and the Transacties rows).
  const MONTHS = [
    ['november 2025', 'nov', '2025-11', 330000, 20000, [115000, 70200, 38800, 29100, 5497, 40200]],
    ['december 2025', 'dec', '2025-12', 330000, 20000, [115000, 81200, 52000, 27600, 5497, 61000]],
    ['januari 2026', 'jan', '2026-01', 330000, 20000, [115000, 59800, 24000, 26200, 5497, 101200]],
    ['februari 2026', 'feb', '2026-02', 330000, 20000, [115000, 61100, 28600, 27000, 5497, 33000]],
    ['maart 2026', 'mrt', '2026-03', 330000, 20000, [115000, 64000, 31200, 28800, 5497, 35600]],
    ['april 2026', 'apr', '2026-04', 330000, 20000, [115000, 62200, 36400, 30100, 5497, 34100]],
    ['mei 2026', 'mei', '2026-05', 330000, 20000, [115000, 63000, 34200, 27600, 5497, 39200]],
    ['juni 2026', 'jun', '2026-06', 330000, 20000, [115000, 66500, 41000, 29000, 5497, 41000]],
    ['juli 2026', 'jul', '2026-07', 330000, 0, [115000, 71200, 98400, 40200, 5497, 33700]],
    ['augustus 2026', 'aug', '2026-08', 330000, 40000, [115000, 60100, 29600, 24800, 5497, 36000]],
    ['september 2026', 'sep', '2026-09', 330000, 20000, [115000, 68800, 35200, 30100, 5497, 34400]],
    ['oktober 2026', 'okt', '2026-10', 335000, 20000, [115000, 64200, 31800, 28400, 5497, 31100]],
    ['november 2026', 'nov', '2026-11', 331850, 20000, [115000, 41280, 13820, 9640, 5497, 0], {
      persoonlijk: { inc: 286850, sav: 20000, cats: [100500, 0, 13820, 9640, 1199, 0, 45000] },
      gedeeld: { inc: 90000, sav: 0, cats: [14500, 41280, 0, 0, 4298, 0] }
    }]
  ];
  const RUNNING = '2026-11';
  const RUNNING_UNTIL = '18 nov';
  const CATS = ['Wonen', 'Boodschappen', 'Vrije tijd', 'Vervoer', 'Abonnementen', 'Overig'];
  const TO_SHARED = 'Naar gedeelde rekening';
  const CONTRIBUTION = 45000;

  // Periods: maand shows mei–okt (april only feeds the trend), kwartaal K1–K3 2026, jaar 2025 and 2026.
  // "Eigen" is built from the chosen months (eigenPeriod).
  const PERIODS = {
    maand: {
      label: 'Maand', range: 'mei – oktober 2026', compare: 'vorige maand', first: 1,
      groups: [5, 6, 7, 8, 9, 10, 11].map((i) => ({ idx: [i], title: MONTHS[i][0], short: MONTHS[i][1], key: MONTHS[i][2] }))
    },
    kwartaal: {
      label: 'Kwartaal', range: '2026 per kwartaal', compare: 'vorig kwartaal', first: 0,
      groups: [
        { idx: [2, 3, 4], title: 'K1 2026', short: 'K1', key: '2026-K1' },
        { idx: [5, 6, 7], title: 'K2 2026', short: 'K2', key: '2026-K2' },
        { idx: [8, 9, 10], title: 'K3 2026', short: 'K3', key: '2026-K3' }
      ]
    },
    jaar: {
      label: 'Jaar', range: 'per jaar, sinds november 2025', compare: '', first: 0, short: true,
      groups: [
        { idx: [0, 1], title: '2025 · vanaf november', short: '2025', key: '2025' },
        { idx: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], title: '2026 · tot oktober', short: '2026', key: '2026' }
      ]
    },
    eigen: { label: 'Eigen' }
  };
  const PERIOD_KEYS = Object.keys(PERIODS);

  // Quick choices in the custom range picker (month indexes into MONTHS)
  const PRESETS = [
    { label: 'Laatste 3 maanden', from: 10, to: 12 },
    { label: 'Dit jaar', from: 2, to: 12 },
    { label: 'Hele geschiedenis', from: 0, to: 12 }
  ];
  const YEARS = [2025, 2026];

  const SCOPE_TEXT = { alles: 'Alle rekeningen', persoonlijk: 'Persoonlijke rekeningen', gedeeld: 'Gedeelde rekeningen' };
  const SCOPE_MENU = { alles: 'Alle rekeningen die je ziet', persoonlijk: 'Je persoonlijke rekeningen', gedeeld: 'Je gedeelde rekeningen' };
  const SKELETON = [[120, 220], [90, 170], [140, 250], [100, 190], [130, 230], [110, 200]];

  // ---------- Screen state ----------

  // range = the applied custom range (default aug – nov 2026); account = account filter (null = all in the scope)
  const ui = { period: 'maand', sel: null, swapping: false, scope: null, account: null, range: { from: 9, to: 12 } };
  let swapTimer = null;
  let draft = null;   // custom range being picked: { from, to, target: 'from' | 'to' }
  let panel = null;   // open picker: { kind: 'eigen' | 'accounts', el, desk, trigger }

  const monthIndex = (key) => MONTHS.findIndex((r) => r[2] === key);
  const yearOf = (i) => MONTHS[i][2].slice(0, 4);

  function rangeText(from, to) {
    if (from === to) return MONTHS[from][1] + ' ' + yearOf(from);
    return yearOf(from) === yearOf(to)
      ? MONTHS[from][1] + ' – ' + MONTHS[to][1] + ' ' + yearOf(to)
      : MONTHS[from][1] + ' ' + yearOf(from) + ' – ' + MONTHS[to][1] + ' ' + yearOf(to);
  }

  // ---------- Accounts ----------

  // Current accounts in the scope; savings accounts have no transactions of their own (money sent there counts as saved).
  function scopeAccounts(scope) {
    const group = scope === 'persoonlijk' ? 'pers' : 'ged';
    return D.accounts.filter((a) => a.type === 'current' && (scope === 'alles' || a.group === group)).map((a) => D.account(a.id));
  }

  // Every demo scope has one current account, so an account's figures are its scope's split.
  const splitKey = (a) => (a.group === 'pers' ? 'persoonlijk' : 'gedeeld');
  const viewKey = (scope) => (ui.account ? splitKey(D.account(ui.account)) : scope);
  const accColor = (a) => 'var(--a-' + a.color + ')';

  function subject(scope) {
    if (ui.account) return D.account(ui.account).name;
    const accs = scopeAccounts(scope);
    return accs.length === 1 ? accs[0].name : SCOPE_TEXT[scope];
  }

  // ---------- Model ----------

  function catsFor(key) {
    return key === 'persoonlijk' ? CATS.concat(TO_SHARED) : CATS;
  }

  // One month split per scope (analysis/concepts/scope.md, internal-transfer.md)
  function split(row, key) {
    if (row[6] && row[6][key]) return row[6][key];
    const c = row[5];
    if (key === 'gedeeld') return { inc: 2 * CONTRIBUTION, sav: 0, cats: [14500, c[1], 0, 0, 4298, 6202] };
    if (key === 'persoonlijk') return { inc: row[3] - CONTRIBUTION, sav: row[4], cats: [100500, 0, c[2], c[3], 1199, c[5] - 6202, CONTRIBUTION] };
    return { inc: row[3], sav: row[4], cats: c };
  }

  function aggregate(g, key) {
    const cats = catsFor(key).map(() => 0);
    let inc = 0, sav = 0;
    g.idx.forEach((i) => {
      const s = split(MONTHS[i], key);
      inc += s.inc; sav += s.sav;
      s.cats.forEach((v, k) => { cats[k] += v; });
    });
    return Object.assign({}, g, { inc, sav, cats, exp: cats.reduce((a, b) => a + b, 0) });
  }

  // Custom range: one column per month; the month before the range only feeds the trend.
  function eigenPeriod() {
    const r = ui.range;
    const start = r.from > 0 ? r.from - 1 : r.from;
    const groups = [];
    for (let i = start; i <= r.to; i++) {
      groups.push({ idx: [i], title: MONTHS[i][0], short: MONTHS[i][1], key: MONTHS[i][2], running: MONTHS[i][2] === RUNNING });
    }
    return { label: 'Eigen', range: 'Eigen · ' + rangeText(r.from, r.to), compare: 'vorige maand', first: r.from > 0 ? 1 : 0, short: r.from === 0, groups };
  }

  const period = () => (ui.period === 'eigen' ? eigenPeriod() : PERIODS[ui.period]);

  function model(scope) {
    const key = viewKey(scope);
    const p = period();
    const groups = p.groups.map((g) => aggregate(g, key));
    const view = groups.slice(p.first);
    const sel = ui.sel !== null && ui.sel < view.length ? ui.sel : view.length - 1;
    const cur = view[sel];
    const prev = p.compare && !cur.running ? (groups[sel + p.first - 1] || null) : null;
    const max = Math.max.apply(null, view.map((g) => Math.max(g.inc, g.exp, g.sav)));
    const accs = ui.account ? [] : scopeAccounts(scope);
    const per = accs.length > 1 ? accs.map((a) => ({ a, v: aggregate(cur, splitKey(a)) })) : [];
    return { p, view, sel, cur, prev, max, scope, key, per };
  }

  function trend(v, pv) {
    const d = pv ? Math.round((v - pv) / pv * 100) : 0;
    return {
      text: d === 0 ? '= 0%' : (d > 0 ? '+' + d + '%' : S.fmt.MINUS + Math.abs(d) + '%'),
      color: d > 5 ? 'var(--warn)' : (d < -5 ? 'var(--greenText)' : 'var(--muted)')
    };
  }

  function catRows(m) {
    const names = catsFor(m.key);
    return names.map((name, k) => {
      const v = m.cur.cats[k];
      const pct = Math.round(v / m.cur.exp * 100);
      return {
        name, v, pct,
        color: name === TO_SHARED ? 'var(--shared)' : D.categories[name],
        trend: m.prev ? trend(v, m.prev.cats[k]) : null
      };
    }).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
  }

  // ---------- Pieces ----------

  const subtitle = (m) => subject(m.scope) + ' · ' + m.p.range;

  function header(m) {
    return '<div class="page-head ov-head anim-fade">' +
      '<div class="page-head-title"><h1>Overzicht</h1>' +
        '<span class="page-date only-desktop" data-ov="range">' + esc(subtitle(m)) + '</span></div>' +
      S.shell.scopeSwitch('anim-in') +
      '<div class="ov-period anim-in" style="--d:30ms" role="group" aria-label="Periode">' +
        PERIOD_KEYS.map((k) => '<button type="button" class="ov-period-btn" data-period="' + k + '" aria-pressed="' + (k === ui.period) + '"' +
          (k === 'eigen' ? ' aria-haspopup="dialog" aria-expanded="false" data-key="eigen"' : '') + '>' + esc(PERIODS[k].label) + '</button>').join('') +
      '</div>' +
      '<div class="page-head-actions only-phone">' +
        '<a class="avatar" href="meer.html" aria-label="Profiel en meer" style="background:' + D.user.tint + '">' + esc(D.user.initial) + '</a>' +
      '</div>' +
    '</div>';
  }

  // Account filter chip, and in "Eigen" a chip that reopens the range picker
  function toolsInner(m) {
    const acc = ui.account ? D.account(ui.account) : null;
    return '<button type="button" class="filter-chip ov-chip' + (acc ? ' ov-chip--on' : '') + '" data-action="accounts" data-key="accounts" aria-haspopup="dialog" aria-expanded="false">' +
        (acc ? '<i class="ov-acc-dot" style="background:' + accColor(acc) + '"></i>' : icon('card', 16, 2)) +
        '<span><span class="visually-hidden">Rekening: </span>' + esc(acc ? acc.name : 'Alle rekeningen') + '</span>' + icon('chevronDown', 14, 2.4) +
      '</button>' +
      (ui.period === 'eigen'
        ? '<button type="button" class="filter-chip ov-chip" data-action="eigen" data-key="eigen-chip" aria-haspopup="dialog" aria-expanded="false">' +
            icon('calendar', 16, 2) + '<span><span class="visually-hidden">Eigen periode: </span>' + esc(rangeText(ui.range.from, ui.range.to)) + '</span>' + icon('chevronDown', 14, 2.4) +
          '</button>'
        : '');
  }

  const LEGEND = [['inc', 'Inkomen'], ['exp', 'Uitgaven'], ['sav', 'Gespaard']];

  function chartCard(m) {
    return '<section class="card ov-chart-card anim-in" style="--d:60ms">' +
      '<div class="ov-chart-head">' +
        '<h2 class="ov-chart-title"><span class="only-phone" data-ov="range-title">' + esc(cap(m.p.range)) + '</span><span class="only-desktop">Inkomen, uitgaven en gespaard</span></h2>' +
        '<div class="ov-legend">' + LEGEND.map((l) => '<span><i class="ov-key--' + l[0] + '"></i>' + l[1] + '</span>').join('') + '</div>' +
      '</div>' +
      '<div class="ov-chart-body" data-ov="chart">' + chartBody(m) + '</div>' +
    '</section>';
  }

  function chartBody(m) {
    if (ui.swapping) {
      return '<div class="ov-skel" role="status" aria-label="Laden">' +
        SKELETON.map((h) => '<span style="--hp:' + h[0] + 'px;--hd:' + h[1] + 'px"></span>').join('') + '</div>';
    }
    const n = m.view.length;
    const size = n > 8 ? 'xs' : (n > 4 ? 's' : (n > 2 ? 'm' : 'l'));
    return '<div class="ov-chart ov-chart--' + size + '" role="group" aria-label="Inkomen, uitgaven en gespaard per periode">' +
      m.view.map((g, i) => {
        const aria = g.title + (g.running ? ' (loopt nog, tot ' + RUNNING_UNTIL + ')' : '') + ': inkomen ' + eur(g.inc) + ', uitgaven ' + eur(g.exp) + ', gespaard ' + eur(g.sav);
        const bars = [['inc', g.inc, 60], ['exp', g.exp, 90], ['sav', g.sav, 120]];
        return '<button type="button" class="ov-col' + (g.running ? ' ov-col--running' : '') + '" data-sel="' + i + '" aria-pressed="' + (i === m.sel) + '" aria-label="' + esc(aria) + '">' +
          '<span class="ov-bars">' + bars.map((b) =>
            '<span class="ov-bar ov-key--' + b[0] + '" style="--h:' + (b[1] / m.max).toFixed(4) + ';--d:' + (b[2] + i * 40) + 'ms"></span>').join('') +
          '</span>' +
          '<span class="ov-col-label">' + esc(g.short) + '</span>' +
        '</button>';
      }).join('') +
    '</div>' + chartNotes(m);
  }

  // Notes under the chart: a running month, and a hint when the history is short
  function chartNotes(m) {
    const notes = [];
    if (m.view.some((g) => g.running)) {
      notes.push('<span>Lichtere staven: november loopt nog, tot ' + RUNNING_UNTIL + '.</span>');
    }
    if (m.p.short) {
      notes.push('<span>Je geschiedenis begint in november 2025. <a href="importeren.html">Oudere transacties importeren</a></span>');
    }
    return notes.length ? '<div class="ov-notes">' + notes.map((n) => '<p class="ov-note">' + icon('info', 15, 2.2) + n + '</p>').join('') + '</div>' : '';
  }

  // Totals of the selected period. Several accounts: a sum for information; one account: its own figures.
  function totals(m) {
    let head;
    if (m.per.length) {
      head = '<span class="ov-totals-title">' + esc(SCOPE_TEXT[m.scope]) + ' samen</span><span class="ov-totals-note">· ter info</span>';
    } else {
      const a = ui.account ? D.account(ui.account) : scopeAccounts(m.scope)[0];
      head = a ? '<i class="ov-acc-dot" style="background:' + accColor(a) + '"></i><span class="ov-totals-title">' + esc(a.name) + '</span>' : '';
    }
    const tile = (label, v) => '<div class="ov-sum"><span class="ov-sum-label">' + label +
      '<span class="only-desktop"> · ' + esc(m.cur.short) + '</span></span><span class="ov-sum-value mono">' + eur(v) + '</span></div>';
    return '<div class="ov-totals-head">' + head + '</div>' +
      '<div class="ov-sums">' + tile('Inkomen', m.cur.inc) + tile('Uitgaven', m.cur.exp) + tile('Gespaard', m.cur.sav) + '</div>';
  }

  // Breakdown per account for the selected period (only when the scope has several accounts)
  function perAccount(m) {
    if (!m.per.length) return '';
    const between = m.per.reduce((s, r) => s + r.v.inc, 0) - m.cur.inc;
    const val = (label, v) => '<span class="ov-per-val"><span class="ov-per-label">' + label + '</span>' +
      (v ? '<span class="mono">' + eur(v) + '</span>' : '<span class="mono muted" aria-label="geen">–</span>') + '</span>';
    return '<section class="ov-per anim-in" style="--d:105ms" aria-labelledby="ov-per-title">' +
      '<div class="ov-per-head"><h2 class="section-title" id="ov-per-title">Per rekening</h2><span class="ov-compare">' + esc(m.cur.title) + '</span></div>' +
      '<div class="ov-per-list">' + m.per.map((r) => {
        const ink = D.accountInk(r.a);
        return '<button type="button" class="ov-per-row" data-action="only" data-id="' + r.a.id + '" data-key="per-' + r.a.id + '" aria-label="Alleen ' + esc(r.a.name) + ' bekijken: in ' + eur(r.v.inc) + ', uit ' + eur(r.v.exp) + ', gespaard ' + eur(r.v.sav) + '">' +
          '<span class="ov-per-name"><span class="ov-per-icon" style="background:' + ink.bg + ';color:' + ink.fg + '">' + icon(r.a.icon, 15, 2.2) + '</span>' +
            '<span>' + esc(r.a.name) + '</span><span class="ov-per-chev">' + icon('chevron', 16, 2.2) + '</span></span>' +
          '<span class="ov-per-vals">' + val('In', r.v.inc) + val('Uit', r.v.exp) + val('Gespaard', r.v.sav) + '</span>' +
        '</button>';
      }).join('') + '</div>' +
      (between > 0 ? '<p class="ov-per-foot">Overschrijvingen tussen je eigen rekeningen (' + eur(between) + ') tellen per rekening mee, maar niet in het totaal samen.</p>' : '') +
    '</section>';
  }

  // Category breakdown: share, trend against the previous period, drill-down to Transacties
  function cats(m, oldWidths) {
    const compare = m.cur.running ? 'lopend · tot ' + RUNNING_UNTIL : (m.prev ? 't.o.v. ' + m.p.compare : '');
    const rows = catRows(m);
    return '<div class="ov-cats-head">' +
        '<h2 class="section-title">Per categorie · ' + esc(m.cur.title) + '</h2>' +
        '<span class="ov-compare">' + esc(compare) + '</span>' +
      '</div>' +
      '<div class="ov-cat-list">' + rows.map((r) => {
        const href = 'transacties.html?categorie=' + encodeURIComponent(r.name) + '&periode=' + encodeURIComponent(m.cur.key) + '&scope=' + m.scope +
          (ui.account ? '&rekening=' + encodeURIComponent(ui.account) : '');
        const from = oldWidths && oldWidths[r.name] !== undefined ? oldWidths[r.name] : r.pct;
        return '<a class="ov-cat" href="' + href + '">' +
          '<span class="ov-cat-line">' +
            '<i class="ov-cat-dot" style="background:' + r.color + '"></i>' +
            '<span class="ov-cat-name">' + esc(r.name) + ' <span class="muted">' + r.pct + '%</span></span>' +
            (r.trend ? '<span class="ov-cat-trend" style="color:' + r.trend.color + '"><span class="visually-hidden">' + esc(compare) + ' </span>' + r.trend.text + '</span>' : '') +
            '<span class="ov-cat-amount mono">' + eur(r.v) + '</span>' +
          '</span>' +
          '<span class="ov-cat-track"><span class="ov-cat-fill" data-name="' + esc(r.name) + '" data-w="' + r.pct + '" style="width:' + from + '%;background:' + r.color + '"></span></span>' +
        '</a>';
      }).join('') + '</div>';
  }

  // ---------- Empty state: no history yet (demo state "leeg") ----------

  function empty() {
    const ghost = [[34, 28, 6], [34, 40, 6], [34, 22, 0], [34, 30, 12], [34, 36, 6], [34, 26, 6]];
    return '<div class="page-head ov-head ov-head--bare anim-fade">' +
        '<div class="page-head-title"><h1>Overzicht</h1></div>' +
        '<div class="page-head-actions only-phone"><a class="avatar" href="meer.html" aria-label="Profiel en meer" style="background:' + D.user.tint + '">' + esc(D.user.initial) + '</a></div>' +
      '</div>' +
      '<section class="card ov-empty anim-in" style="--d:40ms" aria-labelledby="ov-empty-title">' +
        '<div class="ov-empty-art" aria-hidden="true">' + ghost.map((g) => '<span>' + g.map((h) => '<i style="height:' + h + 'px"></i>').join('') + '</span>').join('') + '</div>' +
        '<h2 class="ov-empty-title" id="ov-empty-title">Nog geen geschiedenis</h2>' +
        '<p class="ov-empty-text">Koppel je bank of importeer een CSV-bestand. Dan zie je hier per maand wat er binnenkwam, wat je uitgaf en wat je spaarde.</p>' +
        '<div class="ov-empty-actions">' +
          '<a class="btn btn--primary" href="bankkoppelingen.html#nieuw">' + icon('link', 18, 2.2) + 'Bank koppelen</a>' +
          '<a class="btn btn--secondary" href="importeren.html">' + icon('upload', 18, 2.2) + 'CSV importeren</a>' +
        '</div>' +
        '<p class="ov-empty-note">Een export uit Bilance kan ook. Je kiest zelf hoe de categorieën overkomen.</p>' +
      '</section>';
  }

  // ---------- Pickers: sheet on the phone, popover on desktop ----------

  function panelHead(title, sub) {
    return '<div class="ov-panel-head">' +
      '<div class="ov-panel-title"><h2>' + esc(title) + '</h2>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>' +
      '<button type="button" class="ov-close" data-action="close" data-key="close" aria-label="Sluiten">' + icon('close', 18, 2.4) + '</button>' +
    '</div>';
  }

  function eigenInner() {
    const d = draft;
    const n = d.to - d.from + 1;
    const status = n + (n === 1 ? ' maand' : ' maanden') + (MONTHS[d.to][2] === RUNNING ? ' · november loopt nog' : '');
    const end = (k, label, i) => '<button type="button" class="ov-end" data-action="target" data-end="' + k + '" data-key="end-' + k + '" aria-pressed="' + (d.target === k) + '">' +
      '<span class="ov-end-label">' + label + '</span><span class="ov-end-value">' + esc(MONTHS[i][0]) + '</span>' +
      '<span class="visually-hidden">' + (d.target === k ? ', de volgende maand die je kiest' : ', kies om te wijzigen') + '</span></button>';
    const month = (y, mi) => {
      const i = monthIndex(y + '-' + String(mi + 1).padStart(2, '0'));
      const name = S.fmt.MONTHS[mi] + ' ' + y;
      if (i < 0) {
        const future = y > 2026 || (y === 2026 && mi > 10);
        return '<button type="button" class="ov-month" disabled aria-label="' + esc(name + (future ? ', nog niet' : ', geen gegevens')) + '">' + S.fmt.MONTHS_SHORT[mi] + '</button>';
      }
      const cls = i === d.from || i === d.to ? ' is-end' : (i > d.from && i < d.to ? ' is-in' : '');
      return '<button type="button" class="ov-month' + cls + '" data-action="month" data-month="' + i + '" data-key="m-' + i + '" aria-pressed="' + (i >= d.from && i <= d.to) + '" aria-label="' + esc(name) + '">' + S.fmt.MONTHS_SHORT[mi] + '</button>';
    };
    return panelHead('Eigen periode', 'Kies de eerste en de laatste maand') +
      '<div class="ov-ends">' + end('from', 'Van', d.from) + end('to', 'Tot en met', d.to) + '</div>' +
      '<div class="ov-presets" role="group" aria-label="Snel kiezen">' + PRESETS.map((p, k) =>
        '<button type="button" class="filter-chip ov-preset" data-action="preset" data-preset="' + k + '" data-key="preset-' + k + '" aria-pressed="' + (p.from === d.from && p.to === d.to) + '">' + esc(p.label) + '</button>').join('') +
      '</div>' +
      YEARS.map((y) => '<div class="ov-year"><span class="ov-year-label" id="ov-y-' + y + '">' + y + '</span>' +
        '<div class="ov-months" role="group" aria-labelledby="ov-y-' + y + '">' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((mi) => month(y, mi)).join('') + '</div></div>').join('') +
      '<p class="ov-pick-note">' + icon('info', 15, 2.2) + '<span>Gegevens vanaf november 2025. Oudere geschiedenis? <a href="importeren.html">CSV importeren</a></span></p>' +
      '<p class="ov-pick-status" role="status">' + esc(status) + '</p>' +
      '<div class="ov-panel-actions">' +
        '<button type="button" class="btn btn--ghost" data-action="close" data-key="cancel">Annuleren</button>' +
        '<button type="button" class="btn btn--primary" data-action="apply" data-key="apply">Toepassen</button>' +
      '</div>';
  }

  function accountsInner() {
    const accs = scopeAccounts(ui.scope);
    const opt = (id, lead, name, sub) => {
      const on = (ui.account || '') === id;
      return '<button type="button" class="ov-opt" data-action="pick" data-id="' + id + '" data-key="opt-' + (id || 'all') + '" aria-pressed="' + on + '">' + lead +
        '<span class="ov-opt-main"><span class="ov-opt-name">' + esc(name) + '</span><span class="ov-opt-sub">' + esc(sub) + '</span></span>' +
        '<span class="ov-opt-check">' + (on ? icon('check', 18, 2.6) : '') + '</span></button>';
    };
    const allSub = accs.length > 1 ? accs.length + ' rekeningen · samen, ter info' : accs.map((a) => a.name).join('');
    return panelHead('Rekening', SCOPE_MENU[ui.scope]) +
      '<div class="ov-opts" role="group" aria-label="Rekening">' +
        opt('', '<span class="ov-opt-icon ov-opt-icon--all">' + icon('grid', 17, 2.2) + '</span>', 'Alle rekeningen', allSub) +
        accs.map((a) => {
          const ink = D.accountInk(a);
          return opt(a.id, '<span class="ov-opt-icon" style="background:' + ink.bg + ';color:' + ink.fg + '">' + icon(a.icon, 17, 2.2) + '</span>',
            a.name, a.group === 'ged' ? 'Gedeeld · met ' + D.partner.name : 'Persoonlijk · alleen jij');
        }).join('') +
      '</div>' +
      '<p class="ov-pick-note">' + icon('info', 15, 2.2) + '<span>Spaarrekeningen staan er niet bij: wat je erheen overschrijft, telt als gespaard.</span></p>';
  }

  function panelInner(kind) {
    return kind === 'eigen' ? eigenInner() : accountsInner();
  }

  function openPanel(kind, trigger) {
    closePanel(false);
    if (kind === 'eigen') draft = { from: ui.range.from, to: ui.range.to, target: 'from' };
    const desk = window.matchMedia('(min-width: 1024px)').matches;
    const label = kind === 'eigen' ? 'Eigen periode' : 'Rekening kiezen';
    let el;
    if (desk) {
      el = document.createElement('div');
      el.className = 'ov-pop ov-pop--' + kind + ' ov-panel';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', label);
      el.innerHTML = panelInner(kind);
      const anchor = kind === 'eigen' && trigger.classList.contains('ov-period-btn') ? page.querySelector('.ov-head') : page.querySelector('.ov-tools');
      anchor.appendChild(el);
    } else {
      el = document.createElement('div');
      el.className = 'sheet-backdrop ov-backdrop';
      el.innerHTML = '<div class="sheet ov-sheet ov-panel" role="dialog" aria-modal="true" aria-label="' + label + '"><div class="sheet-grip" aria-hidden="true"></div><div class="ov-panel-body">' + panelInner(kind) + '</div></div>';
      document.body.appendChild(el);
      el.addEventListener('click', (e) => { if (e.target === el) closePanel(true); });
    }
    el.addEventListener('click', onPanelClick);
    trigger.setAttribute('aria-expanded', 'true');
    panel = { kind, el, desk, trigger: trigger.dataset.key };
    const first = el.querySelector(kind === 'eigen' ? '[data-key="end-from"]' : '.ov-opt[aria-pressed="true"]');
    if (first) first.focus();
  }

  function closePanel(restoreFocus) {
    if (!panel) return;
    const key = panel.trigger;
    panel.el.remove();
    panel = null;
    draft = null;
    const t = page && page.querySelector('[data-key="' + key + '"]');
    if (t) {
      t.setAttribute('aria-expanded', 'false');
      if (restoreFocus) t.focus();
    }
  }

  // Re-paint the open picker and keep focus on the same control
  function repaintPanel() {
    if (!panel) return;
    const a = document.activeElement;
    const key = a && a.dataset ? a.dataset.key : null;
    const body = panel.desk ? panel.el : panel.el.querySelector('.ov-panel-body');
    body.innerHTML = panelInner(panel.kind);
    const el = key && body.querySelector('[data-key="' + key + '"]');
    if (el) el.focus();
  }

  function pickMonth(i) {
    const d = draft;
    if (d.target === 'from') {
      d.from = i;
      if (d.to < i) d.to = i;
      d.target = 'to';
    } else if (i < d.from) {
      d.from = i;
    } else {
      d.to = i;
      d.target = 'from';
    }
  }

  function onPanelClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    if (act === 'close') closePanel(true);
    else if (act === 'target') { draft.target = el.dataset.end; repaintPanel(); }
    else if (act === 'month') { pickMonth(Number(el.dataset.month)); repaintPanel(); }
    else if (act === 'preset') {
      const p = PRESETS[Number(el.dataset.preset)];
      draft.from = p.from; draft.to = p.to; draft.target = 'from';
      repaintPanel();
    } else if (act === 'apply') {
      ui.range = { from: draft.from, to: draft.to };
      ui.period = 'eigen';
      closePanel(false);
      change();
      const chip = page.querySelector('[data-key="eigen"]');
      if (chip) chip.focus();
    } else if (act === 'pick') {
      ui.account = el.dataset.id || null;
      closePanel(false);
      change();
      const chip = page.querySelector('[data-key="accounts"]');
      if (chip) chip.focus();
    }
  }

  // ---------- Screen ----------

  let page = null;
  let wired = false;
  let deepLinked = false;

  // Deep links (mockup): ?periode=maand|kwartaal|jaar|eigen, ?van=2026-08&tot=2026-11, ?rekening=zicht;
  // #eigen opens the custom range picker, #rekening the account filter.
  function readLink() {
    const q = new URLSearchParams(location.search);
    if (PERIOD_KEYS.indexOf(q.get('periode')) >= 0) ui.period = q.get('periode');
    const from = monthIndex(q.get('van') || ''), to = monthIndex(q.get('tot') || '');
    if (from >= 0 && to >= from) ui.range = { from, to };
    if (q.get('rekening') && D.accounts.some((a) => a.id === q.get('rekening') && a.type === 'current')) ui.account = q.get('rekening');
  }

  function render(el, st) {
    page = el;
    if (!deepLinked) readLink();
    closePanel(false);
    if (D.demo() === 'leeg') {
      page.innerHTML = empty();
      return;
    }
    if (ui.scope !== null && ui.scope !== st.scope) {
      ui.sel = null;
      startSwap();
    }
    ui.scope = st.scope;
    if (ui.account && !scopeAccounts(st.scope).some((a) => a.id === ui.account)) ui.account = null;
    const m = model(st.scope);
    page.innerHTML =
      header(m) +
      '<div class="ov-tools anim-in" style="--d:45ms" data-ov="tools">' + toolsInner(m) + '</div>' +
      '<div class="ov-grid">' +
        '<div class="ov-left">' +
          chartCard(m) +
          '<section class="ov-totals anim-in" style="--d:90ms" data-ov="sums">' + totals(m) + '</section>' +
          '<div class="ov-per-wrap" data-ov="per">' + perAccount(m) + '</div>' +
        '</div>' +
        '<section class="ov-cats anim-in" style="--d:120ms" data-ov="cats">' + cats(m) + '</section>' +
      '</div>';
    page.onclick = onClick;
    if (!wired) {
      wired = true;
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel) closePanel(true); });
      // Capture phase: decide before a click inside the popover re-paints it
      document.addEventListener('click', (e) => {
        if (!panel || !panel.desk || panel.el.contains(e.target)) return;
        if (e.target.closest('[data-key="' + panel.trigger + '"]')) return;
        closePanel(false);
      }, true);
    }
    if (!deepLinked) {
      deepLinked = true;
      const h = location.hash.slice(1);
      if (h === 'eigen') openPanel('eigen', page.querySelector('[data-key="eigen"]'));
      if (h === 'rekening') openPanel('accounts', page.querySelector('[data-key="accounts"]'));
    }
  }

  // Partial updates keep focus, skip the entry animations and let the share bars move (420 ms).
  function refresh(parts) {
    if (!page || !page.querySelector('[data-ov="cats"]')) return;
    const m = model(ui.scope);
    const q = (k) => page.querySelector('[data-ov="' + k + '"]');
    if (parts.period) {
      page.querySelectorAll('.ov-period-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === ui.period)));
      q('range').textContent = subtitle(m);
      q('range-title').textContent = cap(m.p.range);
      q('tools').innerHTML = toolsInner(m);
    }
    if (parts.chart) q('chart').innerHTML = chartBody(m);
    if (parts.sel) {
      page.querySelectorAll('.ov-col').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.sel) === m.sel)));
    }
    q('sums').innerHTML = totals(m);
    q('per').innerHTML = perAccount(m);
    const old = {};
    page.querySelectorAll('.ov-cat-fill').forEach((f) => { old[f.dataset.name] = parseFloat(f.style.width) || 0; });
    q('cats').innerHTML = cats(m, parts.period ? null : old);
    if (!parts.period) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        page.querySelectorAll('.ov-cat-fill').forEach((f) => { f.style.width = f.dataset.w + '%'; });
      }));
    }
  }

  // A new period, range or account: reset the selection and reload
  function change() {
    ui.sel = null;
    startSwap();
    refresh({ period: true, chart: true });
  }

  // Loading state while a new period or scope is fetched (boards: 320 ms shimmer)
  function startSwap() {
    ui.swapping = true;
    clearTimeout(swapTimer);
    swapTimer = setTimeout(() => {
      ui.swapping = false;
      refresh({ chart: true });
    }, 320);
  }

  function onClick(e) {
    const pb = e.target.closest('.ov-period-btn');
    if (pb) {
      const p = pb.dataset.period;
      if (p === 'eigen') {
        if (panel && panel.kind === 'eigen') closePanel(true);
        else openPanel('eigen', pb);
        return;
      }
      if (p === ui.period) return;
      ui.period = p;
      change();
      return;
    }
    const act = e.target.closest('[data-action]');
    if (act && act.dataset.action === 'accounts') {
      if (panel && panel.kind === 'accounts') closePanel(true);
      else openPanel('accounts', act);
      return;
    }
    if (act && act.dataset.action === 'eigen') {
      if (panel && panel.kind === 'eigen') closePanel(true);
      else openPanel('eigen', act);
      return;
    }
    if (act && act.dataset.action === 'only') {
      ui.account = act.dataset.id;
      change();
      const chip = page.querySelector('[data-key="accounts"]');
      if (chip) chip.focus();
      return;
    }
    const col = e.target.closest('.ov-col');
    if (col) {
      const i = Number(col.dataset.sel);
      if (i === model(ui.scope).sel) return;
      ui.sel = i;
      refresh({ sel: true });
    }
  }

  S.screens = S.screens || {};
  S.screens.overzicht = { title: 'Overzicht', render };
})(window.Saldo = window.Saldo || {});
