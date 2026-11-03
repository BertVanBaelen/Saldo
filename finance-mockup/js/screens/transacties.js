// Transacties screen. Design boards: Telefoon-Transacties, Desktop-Transacties.
// Spec: analysis/screens/transacties.md. Concepts: transaction, category, categorisation-rule, internal-transfer.
(function (S) {
  'use strict';

  const { eur, esc, cap, DAYS, MONTHS } = S.fmt;
  const icon = S.icon;
  const D = S.data;

  S.icons.paths.chevronDown = '<path d="m6 9 6 6 6-6"></path>';

  // Category look (analysis/concepts/category.md). Gespaard and Terugbetaling use the green soft tint.
  const CAT = {
    wonen: { n: 'Wonen', bg: D.categories.Wonen, fg: 'var(--onPastel)' },
    bood: { n: 'Boodschappen', bg: D.categories.Boodschappen, fg: 'var(--onPastel)' },
    vrij: { n: 'Vrije tijd', bg: D.categories['Vrije tijd'], fg: 'var(--onPastel)' },
    verv: { n: 'Vervoer', bg: D.categories.Vervoer, fg: 'var(--onPastel)' },
    abo: { n: 'Abonnementen', bg: D.categories.Abonnementen, fg: 'var(--onPastel)' },
    ovr: { n: 'Overig', bg: D.categories.Overig, fg: 'var(--onC6)' },
    spaar: { n: 'Gespaard', bg: 'var(--soft)', fg: 'var(--greenText)' },
    terug: { n: 'Terugbetaling', bg: 'var(--soft)', fg: 'var(--greenText)' }
  };
  const PICK = ['wonen', 'bood', 'vrij', 'verv', 'abo', 'ovr'];

  // Demo rows as on the boards (analysis/concepts/transaction.md). `similar` = other transactions of
  // the same counterparty that a new rule would update. `transfer` = internal transfer to savings.
  const TX = [
    { id: 't1', date: '2026-11-18', name: 'Bol.com', ini: 'B', amt: -2499, cat: null, acc: 'zicht', pending: true, comm: 'Bestelling 4471-2210', similar: 5 },
    { id: 't2', date: '2026-11-18', name: 'Colruyt Laagste Prijzen', ini: 'C', amt: -8642, cat: 'bood', acc: 'gedeeld', comm: 'Bancontact · Colruyt Gent-Dampoort', similar: 14 },
    { id: 't3', date: '2026-11-17', name: 'TotalEnergies', ini: 'T', amt: -6210, cat: 'verv', acc: 'zicht', comm: 'Bancontact · TotalEnergies Merelbeke', similar: 6 },
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
    notes: {}
  };
  let pageEl = null;
  let scope = 'alles';
  let lastFocus = null;

  // ---------- Derived values ----------

  function account(id) { return D.accounts.find((a) => a.id === id); }

  function view(t) {
    const c = ui.cats[t.id] !== undefined ? ui.cats[t.id] : t.cat;
    const m = c ? CAT[c] : null;
    const acc = account(t.acc);
    const shared = acc.group === 'ged';
    return Object.assign({}, t, {
      c, m,
      catName: m ? m.n : 'Niet gecategoriseerd',
      accName: acc.name,
      accLabel: shared ? 'Gedeeld' : 'Persoonlijk',
      accCls: shared ? 'ged' : 'pers',
      group: acc.group,
      amount: eur(t.amt, true),
      amtCls: t.pending ? 'muted' : (t.amt < 0 && !t.transfer ? 'neg' : '')
    });
  }

  function uncatCount() {
    const fixed = ALL.filter((t) => !t.cat && ui.cats[t.id]).length;
    return Math.max(0, D.toCategorise - fixed);
  }

  function matches(v, q) {
    if (!q) return true;
    const hay = [v.name, v.comm, v.amount, (Math.abs(v.amt) / 100).toFixed(2), v.catName].join(' ').toLowerCase();
    return hay.includes(q);
  }

  function visibleRows() {
    const q = ui.query.trim().toLowerCase();
    return (ui.more ? ALL : TX).map(view)
      .filter((v) => scope === 'alles' || (scope === 'gedeeld' ? v.group === 'ged' : v.group === 'pers'))
      .filter((v) => !ui.uncat || !v.c)
      .filter((v) => matches(v, q));
  }

  // "Vandaag · woensdag 18 november", "Maandag · 16 november"
  function dayHead(date) {
    const x = new Date(date + 'T12:00:00');
    const t = new Date(D.today + 'T12:00:00');
    const days = Math.round((t - x) / 86400000);
    const dm = x.getDate() + ' ' + MONTHS[x.getMonth()];
    if (days === 0) return { main: 'Vandaag', sub: DAYS[x.getDay()] + ' ' + dm };
    if (days === 1) return { main: 'Gisteren', sub: DAYS[x.getDay()] + ' ' + dm };
    return { main: cap(DAYS[x.getDay()]), sub: dm };
  }

  function dateFull(date) {
    const x = new Date(date + 'T12:00:00');
    return DAYS[x.getDay()] + ' ' + x.getDate() + ' ' + MONTHS[x.getMonth()] + ' ' + x.getFullYear();
  }

  // ---------- Pieces ----------

  function avatar(v, cls) {
    return v.c
      ? '<span class="tx-av ' + cls + '" style="background:' + v.m.bg + ';color:' + v.m.fg + '" aria-hidden="true">' + esc(v.ini) + '</span>'
      : '<span class="tx-av tx-av--uncat ' + cls + '" aria-hidden="true">?</span>';
  }

  function accLabel(v) {
    return '<span class="acc-label acc-label--' + v.accCls + ' tx-acc">' + v.accLabel + '</span>';
  }

  function header() {
    const chev = icon('chevronDown', 14, 2.4);
    return '<div class="tx-head">' +
      '<div class="tx-title anim-fade"><h1>Transacties</h1>' +
        '<a class="avatar only-phone" href="meer.html" aria-label="Profiel en meer" style="background:' + D.user.tint + '">' + esc(D.user.initial) + '</a></div>' +
      '<div class="tx-search anim-in" style="--d:30ms">' + icon('search', 18, 2.2) +
        '<input type="search" class="tx-search-input" aria-label="Zoeken in transacties" placeholder="Zoek op naam, bedrag of mededeling" value="' + esc(ui.query) + '"></div>' +
      '<div class="tx-filters">' +
        S.shell.scopeSwitch('tx-scope anim-in') +
        '<div class="tx-chips anim-in" style="--d:60ms">' +
          '<button type="button" class="filter-chip tx-chip tx-chip--uncat" data-action="uncat" aria-pressed="' + ui.uncat + '">Niet gecategoriseerd<span class="tx-count" data-uncat-count>' + uncatCount() + '</span></button>' +
          '<button type="button" class="filter-chip tx-chip" data-action="todo" data-what="Filter op rekening">Alle rekeningen' + chev + '</button>' +
          '<button type="button" class="filter-chip tx-chip" data-action="todo" data-what="Periode kiezen">November<span class="only-desktop"> 2026</span>' + chev + '</button>' +
          '<button type="button" class="filter-chip tx-chip" data-action="todo" data-what="Filter op categorie">Categorie' + chev + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function row(v, first) {
    const on = desktopMq.matches && v.id === ui.sel;
    const pending = '<span class="tx-pending">In behandeling</span>';
    return '<button type="button" class="tx-row' + (first ? ' tx-row--first' : '') + '" data-id="' + v.id + '"' +
        (desktopMq.matches ? ' aria-pressed="' + on + '"' : ' aria-haspopup="dialog"') + '>' +
      avatar(v, '') +
      '<span class="tx-row-main">' +
        '<span class="tx-row-name"><span class="tx-name">' + esc(v.name) + '</span>' + (v.pending ? '<span class="only-desktop">' + pending + '</span>' : '') + '</span>' +
        '<span class="tx-row-sub">' + accLabel(v) +
          '<span class="tx-row-sub-text only-phone">' + esc(v.catName) + '</span>' +
          '<span class="only-desktop">' + esc(v.accName) + '</span></span>' +
      '</span>' +
      '<span class="only-desktop tx-catcell"><span class="tx-cat' + (v.c ? '' : ' tx-cat--uncat') + '"' +
        (v.c ? ' style="background:' + v.m.bg + ';color:' + v.m.fg + '"' : '') + '>' + esc(v.catName) + '</span></span>' +
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
    const title = q ? 'Geen transacties gevonden' : (ui.uncat ? 'Niets meer te categoriseren' : 'Geen transacties');
    const note = q ? 'Niets voor “' + esc(q) + '” in deze rekeningen.' : (ui.uncat ? 'Alle transacties in deze lijst hebben een categorie.' : 'Er zijn nog geen transacties voor deze rekeningen.');
    return '<div class="tx-empty"><strong>' + title + '</strong><span>' + note + '</span></div>';
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
      return '<section class="tx-day' + (animate ? ' anim-in' : '') + '" style="--d:' + (base + i * 30) + 'ms">' +
        '<h2 class="tx-day-head">' + esc(h.main) + ' <span>· ' + esc(h.sub) + '</span></h2>' +
        '<div class="tx-card">' + d.rows.map((v, j) => row(v, j === 0)).join('') + '</div>' +
      '</section>';
    }).join('');
    const showLoad = !ui.more && !ui.loadingMore && !ui.uncat;
    return (html || emptyState()) +
      (ui.loadingMore ? skeleton() : '') +
      (showLoad ? '<button type="button" class="tx-more" data-action="more">Oudere transacties laden</button>' : '');
  }

  // Detail: sheet on phone, side panel on desktop (same content)
  function detail(id, mode) {
    const v = view(ALL.find((t) => t.id === id));
    const sheet = mode === 'sheet';
    const similarText = v.similar
      ? 'Ook ' + v.similar + ' andere transacties van ' + v.name + ' krijgen deze categorie.'
      : 'Nieuwe transacties van ' + v.name + ' krijgen deze categorie.';
    const picks = PICK.map((k) => {
      const c = CAT[k];
      const on = v.c === k;
      return '<button type="button" class="tx-pick" data-pick="' + k + '" aria-pressed="' + on + '" style="' +
        (on ? 'background:' + c.bg + ';color:' + c.fg + ';border-color:var(--text)' : 'border-color:' + c.bg) + '">' +
        (on ? icon('check', sheet ? 15 : 14, 3) : '') + esc(c.n) + '</button>';
    }).join('');
    const noteId = 'tx-note-' + mode;
    return '<div class="tx-detail tx-detail--' + mode + '">' +
      '<div class="tx-detail-head">' +
        avatar(v, 'tx-av--lg') +
        '<div class="tx-detail-title"><span class="tx-detail-name"' + (sheet ? ' id="tx-sheet-title"' : '') + '>' + esc(v.name) + '</span>' +
          '<span class="tx-row-sub">' + accLabel(v) + esc(v.accName) + '</span></div>' +
        (sheet ? '<button type="button" class="tx-close" data-action="close" aria-label="Sluiten">' + icon('close', 18, 2.4) + '</button>' : '') +
      '</div>' +
      '<div class="tx-detail-amount"><span class="mono ' + v.amtCls + '">' + v.amount + '</span>' +
        '<span class="tx-status">' + (v.pending ? 'In behandeling' : 'Geboekt') + '</span></div>' +
      '<dl class="tx-dl">' +
        '<dt>Datum</dt><dd>' + esc(dateFull(v.date)) + '</dd>' +
        '<dt>Mededeling</dt><dd>' + esc(v.comm) + '</dd>' +
        '<dt>Categorie</dt><dd class="tx-dl-strong">' + esc(v.catName) + '</dd>' +
      '</dl>' +
      (v.pending ? '<p class="tx-note tx-note--muted">Nog in behandeling. Telt mee in de totalen zodra de bank ze boekt.</p>' : '') +
      (v.transfer
        ? '<p class="tx-note tx-note--saved">Overschrijving naar je spaarrekening. Telt als gespaard, niet als uitgave.</p>'
        : '<div class="tx-picker">' +
            '<span class="tx-picker-label" id="tx-pick-label-' + mode + '">Kies een categorie</span>' +
            '<div class="tx-picks" role="group" aria-labelledby="tx-pick-label-' + mode + '">' + picks + '</div>' +
            '<label class="tx-rule"><input type="checkbox" data-action="rule"' + (ui.rule ? ' checked' : '') + '>' +
              '<span><strong>Toepassen op vergelijkbare en regel maken</strong><br><span class="muted">' + esc(similarText) + '</span></span></label>' +
            '<div class="tx-actions">' +
              '<button type="button" class="tx-action" data-action="todo" data-what="Splitsen">Splitsen</button>' +
              '<button type="button" class="tx-action" data-action="todo" data-what="Markeren als overschrijving">Is een overschrijving</button>' +
            '</div>' +
          '</div>') +
      '<div class="field tx-field"><label for="' + noteId + '">Notitie</label>' +
        '<input class="input" id="' + noteId + '" data-note placeholder="Bijvoorbeeld: verjaardagscadeau" value="' + esc(ui.notes[v.id] || '') + '"></div>' +
      '<button type="button" class="tx-save" data-action="save">Opslaan</button>' +
    '</div>';
  }

  // ---------- Updates ----------

  function renderList(animate) {
    const el = pageEl && pageEl.querySelector('#tx-list');
    if (el) el.innerHTML = list(animate);
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

  function openSheet(id, trigger) {
    ui.sheetId = id;
    ui.sel = id;
    ui.rule = false;
    lastFocus = trigger || null;
    closeSheet(true);
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
    const close = wrap.querySelector('[data-action="close"]');
    if (close) close.focus();
  }

  function closeSheet(silent) {
    const el = document.getElementById('tx-sheet');
    if (el) el.remove();
    document.body.classList.remove('tx-locked');
    if (silent) return;
    ui.sheetId = null;
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
    else {
      const r = pageEl && pageEl.querySelector('.tx-row[data-id="' + ui.sel + '"]');
      if (r) r.focus();
    }
    lastFocus = null;
  }

  // Category pick, rule toggle, note, save; shared by sheet and panel
  function bindDetail(root) {
    root.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const id = ui.sheetId || ui.sel;
        ui.cats[id] = pick.dataset.pick;
        refreshAfterPick(pick.dataset.pick);
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'close') closeSheet();
      else if (a === 'todo') S.shell.toast(btn.dataset.what + ' wordt nog ontworpen');
      else if (a === 'save') save();
    });
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-action="rule"]')) ui.rule = e.target.checked;
    });
    root.addEventListener('input', (e) => {
      if (e.target.matches('[data-note]')) ui.notes[ui.sheetId || ui.sel] = e.target.value;
    });
  }

  function refreshAfterPick(key) {
    renderList(false);
    updateCounts();
    if (ui.sheetId) renderSheetBody();
    else renderPanel(false);
    // Keep focus on the chosen chip after the re-render
    const root = ui.sheetId ? document.getElementById('tx-sheet') : pageEl.querySelector('#tx-panel');
    const chip = root && root.querySelector('[data-pick="' + key + '"]');
    if (chip) chip.focus();
  }

  function save() {
    const id = ui.sheetId || ui.sel;
    const t = ALL.find((x) => x.id === id);
    const text = ui.rule ? 'Regel gemaakt · ' + ((t && t.similar) || 0) + ' andere bijgewerkt' : 'Opgeslagen';
    if (ui.sheetId) closeSheet();
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

  // ---------- Screen ----------

  function render(page, st) {
    pageEl = page;
    scope = st.scope;
    page.classList.add('tx-page');
    page.innerHTML =
      header() +
      '<div class="tx-body">' +
        '<div class="tx-list-wrap"><div class="tx-list" id="tx-list"></div></div>' +
        '<aside class="tx-panel only-desktop" id="tx-panel" aria-label="Transactie"></aside>' +
      '</div>';
    renderList(true);
    renderPanel(true);
    updateCounts();

    page.querySelector('.tx-search-input').addEventListener('input', (e) => {
      ui.query = e.target.value;
      renderList(false);
    });
    page.querySelector('.tx-head').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'uncat') {
        ui.uncat = !ui.uncat;
        btn.setAttribute('aria-pressed', ui.uncat);
        renderList(true);
      } else if (btn.dataset.action === 'todo') {
        S.shell.toast(btn.dataset.what + ' wordt nog ontworpen');
      }
    });
    page.querySelector('#tx-list').addEventListener('click', (e) => {
      if (e.target.closest('[data-action="more"]')) { loadMore(); return; }
      const r = e.target.closest('.tx-row');
      if (!r) return;
      const id = r.dataset.id;
      if (desktopMq.matches) {
        if (id === ui.sel) return;
        ui.sel = id;
        ui.rule = false;
        pageEl.querySelectorAll('.tx-row[aria-pressed]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.id === id));
        renderPanel(true);
      } else {
        openSheet(id, r);
      }
    });
    bindDetail(page.querySelector('#tx-panel'));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('tx-sheet')) closeSheet();
  });

  // Crossing the breakpoint: the sheet becomes the side panel, rows switch between dialog and toggle semantics
  desktopMq.addEventListener('change', () => {
    if (desktopMq.matches && ui.sheetId) closeSheet();
    renderList(false);
    renderPanel(false);
  });

  S.screens = S.screens || {};
  S.screens.transacties = { title: 'Transacties', render };
})(window.Saldo = window.Saldo || {});
