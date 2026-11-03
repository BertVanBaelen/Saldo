// Start screen. Design boards: Telefoon-Start, Desktop-Start. Spec: analysis/screens/start.md.
// Every current account has its own buffer, forecast and warnings; the scope switch only filters.
// Sums across accounts are information, never a verdict (decisions 3 Nov 2026, analysis/concepts/scope.md).
(function (S) {
  'use strict';

  const { eur, eur0, esc, dateLong } = S.fmt;
  const icon = S.icon;
  const D = S.data;

  // Sync story per demo state (analysis/concepts/bank-connection.md). "verouderd": the shared account was last
  // updated on Sunday 15 November 04:02. "fout": this morning's sync failed, the figures are from yesterday.
  const STALE = { account: 'gedeeld', since: 'zondag 04:02', ago: '3 dagen geleden' };
  const FAILED = { tried: 'vandaag 04:02', data: 'gisteren 04:02' };

  const SCOPE_LABEL = { alles: 'alle rekeningen', persoonlijk: 'persoonlijke rekeningen', gedeeld: 'gedeelde rekeningen' };
  const STATE_CHIP = { ok: 'Boven buffer', under: 'In de buffer', neg: 'Rood' };

  let syncing = false;
  let synced = false;

  const demo = () => D.demo();
  const offline = () => demo() === 'offline';
  const isStale = (id) => demo() === 'verouderd' && !synced && id === STALE.account;
  const accOf = (g) => D.account(g.account);
  const accColor = (a) => 'var(--a-' + a.color + ')';
  const stateOf = (v, buffer) => (v < 0 ? 'neg' : (v < buffer ? 'under' : 'ok'));
  // Demo contributions belong to the shared account that has members.
  const contributionsFor = (a) => (D.members[a.id] ? D.contributions : null);

  function syncInfo(a) {
    if (syncing) return { text: 'Synchroniseren…', tone: '' };
    if (synced) return { text: a.source + ' · zojuist', tone: '' };
    if (demo() === 'fout') return { text: a.source + ' · synchronisatie mislukt', tone: 'neg' };
    if (isStale(a.id)) return { text: a.source + ' · laatst ' + STALE.ago, tone: 'warn' };
    return { text: a.source + ' · ' + D.lastSync, tone: '' };
  }

  function syncSub(a) {
    const s = syncInfo(a);
    return '<span class="row-sub' + (s.tone ? ' start-sub--' + s.tone : '') + '" data-sync-sub="' + a.id + '">' + esc(s.text) + '</span>';
  }

  function syncLabel() {
    if (offline()) return 'Synchroniseren kan niet: je bent offline';
    return syncing ? 'Bezig met synchroniseren' : 'Nu synchroniseren';
  }

  // ---------- Pieces ----------

  function header(empty) {
    return '<div class="page-head' + (empty ? ' start-head--bare' : '') + ' anim-fade">' +
      '<div class="page-head-title"><h1>Start</h1><span class="page-date only-desktop">' + esc(dateLong(D.today)) + '</span></div>' +
      (empty ? '' : S.shell.scopeSwitch('anim-in')) +
      '<div class="page-head-actions">' +
        (empty ? '' : '<button type="button" class="icon-btn start-sync" data-action="sync" aria-label="' + syncLabel() + '"' + (offline() ? ' aria-disabled="true"' : '') + '>' +
          '<span class="' + (syncing ? 'spin' : '') + '" style="display:flex">' + icon('sync', 20, 2.2) + '</span></button>') +
        '<a class="avatar only-phone" href="meer.html" aria-label="Profiel en meer" style="background:' + D.user.tint + '">' + esc(D.user.initial) + '</a>' +
      '</div>' +
    '</div>';
  }

  function alert(kind, ic, title, note, href, chevron, attr) {
    return '<a class="alert alert--' + kind + '" href="' + href + '"' + (attr ? ' ' + attr : '') + '>' +
      '<span class="alert-icon">' + icon(ic, 17, 2.2) + '</span>' +
      '<span class="alert-text"><strong>' + esc(title) + '</strong>' + (note ? '<br><span>' + esc(note) + '</span>' : '') + '</span>' +
      (chevron ? '<span class="chev" style="display:flex">' + icon('chevron', 18) + '</span>' : '') +
    '</a>';
  }

  // Red and yellow warnings from each account's own forecast against its own buffer.
  function planningAlerts(groups) {
    const out = [];
    groups.forEach((g) => {
      const name = accOf(g).name;
      const ni = g.forecast.findIndex((v) => v < 0);
      const ui = g.forecast.findIndex((v) => v >= 0 && v < g.buffer);
      if (ni >= 0) {
        out.push(alert('neg', 'warning', name + ' staat rood in ' + D.forecastMonths[ni].name,
          'Verwacht eindsaldo ' + eur0(g.forecast[ni]) + ' · bekijk de planning', 'planning.html'));
      }
      if (ui >= 0) {
        out.push(alert('warn', 'warning', name + ' zakt in de buffer in ' + D.forecastMonths[ui].name,
          'Verwacht ' + eur0(g.forecast[ui]) + ', ' + eur0(g.buffer - g.forecast[ui]) + ' onder de buffer van ' + eur0(g.buffer), 'planning.html'));
      }
    });
    return out.join('');
  }

  function alerts(groups) {
    const out = [];
    if (demo() === 'fout') {
      out.push(alert('neg', 'warning', 'Synchronisatie mislukt · ' + D.consent.bank + ' antwoordt niet',
        'Laatste poging ' + FAILED.tried + ' · stand van gisteren', 'bankkoppelingen.html', true));
    }
    groups.forEach((g) => {
      if (isStale(g.account)) {
        out.push(alert('warn', 'sync', accOf(g).name + ' niet bijgewerkt sinds ' + STALE.since,
          D.consent.bank + ' stuurde geen nieuwe gegevens · bekijk de koppeling', 'bankkoppelingen.html', true, 'data-stale'));
      }
    });
    out.push(planningAlerts(groups));
    out.push(alert('warn', 'clock', 'Toestemming verloopt over ' + D.consent.daysLeft + ' dagen', D.consent.bank + ' · opnieuw autoriseren', 'bankkoppelingen.html#opnieuw', true));
    out.push(alert('ok', 'tag', D.toCategorise + ' transacties te categoriseren', '', 'transacties.html?filter=niet-gecategoriseerd', true));
    return '<div class="alerts anim-in" style="--d:30ms">' + out.join('') + '</div>';
  }

  function contributionRow(cls) {
    const c = D.contributions;
    return '<span class="' + cls + '"><span class="hero-sub">Bijdragen ' + c.month + '</span>' +
      '<span class="contrib-chips">' + c.rows.map((r) => '<span>' + esc(r.who) + ' ' + eur0(r.amount) + (r.ok ? ' ✓' : '') + '</span>').join('') + '</span></span>';
  }

  // Small badge in the account's own colour with its icon; the white ring keeps it visible on the hero.
  const badge = (a) => '<span class="hero-acc" style="background:' + accColor(a) + '" aria-hidden="true">' + icon(a.icon, 11, 2.4) + '</span>';

  // The balance of an account whose sync is stale or failed is the last known one.
  function staleNote(a) {
    if (isStale(a.id)) return '<span class="hero-stale" data-stale>' + icon('clock', 14, 2.2) + 'Stand van ' + STALE.since + '</span>';
    if (demo() === 'fout') return '<span class="hero-stale">' + icon('clock', 14, 2.2) + 'Stand van ' + FAILED.data + '</span>';
    return '';
  }

  // One account in the scope: its balance against its own buffer.
  function singleHero(g) {
    const a = accOf(g);
    const shared = a.group === 'ged';
    const st = stateOf(g.now, g.buffer);
    const scale = Math.max(g.now, g.buffer) * 1.3;
    const fill = (Math.max(g.now, 0) / scale * 100).toFixed(1);
    const marker = (g.buffer / scale * 100).toFixed(1);
    const diff = g.now >= g.buffer ? eur(g.now - g.buffer) + ' boven buffer' : eur(g.buffer - g.now) + ' onder buffer';
    return '<a class="hero' + (shared ? ' hero--shared' : '') + ' anim-in" style="--d:40ms" href="planning.html">' +
      '<span class="hero-top"><span class="hero-label">Saldo nu · ' + esc(a.name) + '</span><span class="chip chip--hero">' + STATE_CHIP[st] + '</span></span>' +
      '<span class="hero-amount mono">' + eur(g.now) + '</span>' +
      staleNote(a) +
      '<span class="hero-meter">' +
        '<span class="hero-track"><span class="hero-fill" style="width:' + fill + '%"></span><span class="hero-marker" style="left:' + marker + '%"></span></span>' +
        '<span class="hero-meter-text"><span>Buffer ' + eur(g.buffer) + '</span><span>' + diff + '</span></span>' +
      '</span>' +
      (shared && contributionsFor(a) ? contributionRow('hero-contrib') : '') +
    '</a>';
  }

  // Several accounts: the total is information only; the chip and the tiles judge each account on its own buffer.
  function multiHero(scope, groups) {
    const total = groups.reduce((s, g) => s + g.now, 0);
    const attention = groups.filter((g) => stateOf(g.now, g.buffer) !== 'ok').length;
    const chip = attention
      ? icon('warning', 13, 2.4) + attention + (attention === 1 ? ' rekening vraagt' : ' rekeningen vragen') + ' aandacht'
      : icon('check', 13, 2.6) + 'Alle rekeningen boven buffer';
    const tile = (g) => {
      const a = accOf(g);
      const st = stateOf(g.now, g.buffer);
      const note = st === 'ok'
        ? '<span class="hero-tile-note">' + eur0(g.now - g.buffer) + ' boven buffer</span>'
        : '<span class="hero-pill hero-pill--' + st + '">' + (st === 'neg' ? 'Rood' : eur0(g.buffer - g.now) + ' onder buffer') + '</span>';
      return '<span class="hero-tile">' +
        '<span class="hero-tile-label">' + badge(a) + '<span>' + esc(a.name) + '</span></span>' +
        '<span class="mono hero-tile-amount">' + eur(g.now) + '</span>' + note +
      '</span>';
    };
    return '<a class="hero anim-in" style="--d:40ms" href="planning.html">' +
      '<span class="hero-top"><span class="hero-label">Saldo nu · ' + SCOPE_LABEL[scope] + '</span></span>' +
      '<span class="hero-amount mono">' + eur(total) + '</span>' +
      '<span class="hero-info">Samen, ter info · zonder spaarrekeningen</span>' +
      '<span class="hero-accounts">' +
        '<span class="hero-accounts-head"><span class="hero-sub">Per rekening</span><span class="chip chip--hero">' + chip + '</span></span>' +
        '<span class="hero-tiles">' + groups.map(tile).join('') + '</span>' +
      '</span>' +
    '</a>';
  }

  function hero(scope, groups) {
    return groups.length === 1 ? singleHero(groups[0]) : multiHero(scope, groups);
  }

  // Month bars per account with zero and buffer lines (analysis/concepts/forecast.md)
  function forecastChart(g, height, index) {
    const a = accOf(g);
    const color = accColor(a);
    const span = g.chartMax - g.chartMin;
    const posH = Math.round(g.chartMax / span * height);
    const px = (v) => Math.round(Math.abs(v) / span * height);
    const bars = g.forecast.map((end, i) => {
      const res = end - g.buffer;
      const st = end < 0 ? 'neg' : (res < 0 ? 'under' : 'ok');
      return { end, res, st, m: D.forecastMonths[i], d: 120 + index * 80 + i * 50 };
    });
    const aria = a.name + ': ' + bars.map((b) => b.m.short + ' ' + eur0(b.end) + ', ' +
      (b.st === 'neg' ? 'negatief saldo' : (b.st === 'under' ? 'onder buffer ' + eur0(Math.abs(b.res)) : 'over ' + eur0(b.res)))).join('; ');
    const resColor = { ok: 'var(--greenText)', under: 'var(--warn)', neg: 'var(--neg)' };
    return '<span class="fc">' +
      '<span class="fc-head"><span class="fc-dot" style="background:' + color + '"></span><span class="fc-title">' + esc(a.name) + '</span><span class="fc-buf">Buffer ' + eur0(g.buffer) + '</span></span>' +
      '<span class="fc-plot" role="img" aria-label="' + esc(aria) + '" style="height:' + height + 'px">' +
        bars.map((b) => '<span class="fc-col" style="height:' + height + 'px">' +
          '<span class="fc-pos" style="height:' + posH + 'px">' + (b.end > 0 ? '<span class="fc-bar" style="height:' + px(b.end) + 'px;background:' + color + ';--d:' + b.d + 'ms"></span>' : '') + '</span>' +
          '<span class="fc-neg" style="height:' + (height - posH) + 'px">' + (b.end < 0 ? '<span class="fc-bar fc-bar--neg" style="height:' + px(b.end) + 'px;--d:' + b.d + 'ms"></span>' : '') + '</span>' +
        '</span>').join('') +
        '<span class="fc-zero" style="top:' + posH + 'px"></span>' +
        '<span class="fc-bufline" style="top:' + (posH - px(g.buffer)) + 'px"></span>' +
      '</span>' +
      '<span class="fc-labels">' + bars.map((b) => '<span>' +
        '<span class="fc-month">' + esc(b.m.short) + '</span>' +
        '<span class="fc-end"' + (b.end < 0 ? ' style="color:var(--neg)"' : '') + '>' + eur0(b.end) + '</span>' +
        '<span class="fc-res" style="color:' + resColor[b.st] + '">' + (b.st === 'neg' ? 'rood' : eur0(b.res, true)) + '</span>' +
      '</span>').join('') + '</span>' +
    '</span>';
  }

  function forecast(scope, groups) {
    const h = groups.length > 1 ? 84 : 124;
    return '<section class="section start-forecast anim-in" style="--d:70ms">' +
      '<div class="section-head only-phone"><h2 class="section-title">Komende maanden</h2><a class="section-link" href="planning.html">Planning</a></div>' +
      '<a class="card start-forecast-card" href="planning.html">' +
        '<span class="start-forecast-head"><span class="section-title only-desktop">Komende maanden</span><span class="start-forecast-sub">Verwacht eindsaldo per rekening</span></span>' +
        groups.map((g, i) => forecastChart(g, h, i)).join('') +
        '<span class="legend"><span><i style="background:var(--greenText)"></i>Boven buffer</span><span><i style="background:var(--warn)"></i>Onder buffer</span><span><i style="background:var(--neg)"></i>Rood: negatief saldo</span></span>' +
      '</a>' +
    '</section>';
  }

  // Share bar and category rows for one account's spending this month.
  function spendingBlock(sp) {
    const tot = sp.rows.reduce((a, r) => a + r[1], 0);
    const rows = sp.rows.map((r) => ({ name: r[0], amount: r[1], color: D.categories[r[0]], pct: (r[1] / tot * 100).toFixed(1), share: Math.round(r[1] / tot * 100) + '%' }));
    return '<span class="share-bar">' + rows.map((r) => '<span style="width:' + r.pct + '%;background:' + r.color + '"></span>').join('') + '</span>' +
      '<span class="share-rows">' + rows.map((r) => '<span class="share-row"><i style="background:' + r.color + '"></i><span class="name">' + esc(r.name) + ' <span class="muted">' + r.share + '</span></span><span class="amount">' + eur(r.amount) + '</span></span>').join('') + '</span>';
  }

  // Every account is its own block; with several accounts the sum is shown as information only.
  // Demo spending is kept per scope (data.js); every demo scope has one current account.
  function spending(scope, groups) {
    const total = groups.reduce((s, g) => s + D.spending[g.scope].total, 0);
    const many = groups.length > 1;
    const head = '<div class="section-head start-col-head"><h2 class="section-title">Uitgaven ' + D.spending.month + '</h2>' +
      '<a class="section-meta" href="overzicht.html"' + (many ? ' aria-label="Samen ' + eur(total) + ', ter info"' : '') + '>' +
        (many ? 'samen ' : '') + eur(total) + '</a></div>';
    const body = !many
      ? spendingBlock(D.spending[groups[0].scope])
      : groups.map((g) => {
        const a = accOf(g);
        return '<span class="start-spend-group">' +
          '<span class="start-spend-head"><i style="background:' + accColor(a) + '"></i><span class="start-spend-name">' + esc(a.name) + '</span><span class="mono">' + eur(D.spending[g.scope].total) + '</span></span>' +
          spendingBlock(D.spending[g.scope]) +
        '</span>';
      }).join('');
    return '<section class="section anim-in" style="--d:100ms">' + head + '<a class="card" href="overzicht.html">' + body + '</a></section>';
  }

  function accountRow(a) {
    const ink = D.accountInk(a);
    const sub = a.type === 'savings'
      ? '<span class="row-sub">Handmatig · <span class="only-phone">bijgewerkt </span>' + esc(a.updated) + '</span>'
      : syncSub(a);
    return '<div class="row">' +
      '<span class="row-icon" style="background:' + ink.bg + ';color:' + ink.fg + '">' + icon(a.icon, 18) + '</span>' +
      '<div class="row-main"><span class="row-name">' + esc(a.name) + '</span>' + sub + '</div>' +
      '<span class="row-amount">' + eur(a.balance) + '</span>' +
    '</div>';
  }

  function personal() {
    const list = D.accountsIn('pers');
    if (!list.length) return '';
    return '<section class="section anim-in" style="--d:130ms">' +
      '<div class="group-head start-col-head">' +
        '<span class="group-head-icon group-head-icon--pers">' + icon('person', 17, 2.2) + '</span>' +
        '<span class="group-head-text"><h2 class="section-title"><span class="only-phone">Persoonlijke rekeningen</span><span class="only-desktop">Persoonlijk</span></h2><small>Alleen jij ziet deze rekeningen</small></span>' +
      '</div>' +
      '<div class="list">' + list.map(accountRow).join('') + '</div>' +
    '</section>';
  }

  function sharedCard(a) {
    const ink = D.accountInk(a);
    return '<div class="shared-card">' +
      '<div class="row shared-card-row">' +
        '<span class="row-icon" style="background:' + ink.bg + ';color:' + ink.fg + '">' + icon(a.icon, 18) + '</span>' +
        '<div class="row-main"><span class="row-name">' + esc(a.name) + '</span>' + syncSub(a) + '</div>' +
        '<span class="row-amount">' + eur(a.balance) + '</span>' +
      '</div>' +
      (D.readOnly(a.id)
        ? '<div class="shared-ro"><span class="chip chip--readonly">' + icon('lock', 13, 2.2) + 'Alleen lezen</span>' +
          '<span>' + esc(D.partner.name) + ' beheert deze rekening. Je ziet alles, maar wijzigt niets.</span></div>'
        : '') +
      (contributionsFor(a) ? contributionRow('shared-contrib') : '') +
    '</div>';
  }

  // One card per shared account; the section heading stays "Gedeelde rekeningen".
  function shared() {
    const list = D.accountsIn('ged');
    if (!list.length) return '';
    const one = list.length === 1 ? list[0] : null;
    const members = one ? (D.members[one.id] || []) : [];
    const sub = one
      ? 'Met ' + D.partner.name + ' · ' + (D.readOnly(one.id) ? D.partner.name + ' is beheerder' : 'jij bent beheerder')
      : list.length + ' rekeningen met meer leden';
    return '<section class="section anim-in" style="--d:160ms">' +
      '<div class="group-head start-col-head">' +
        '<span class="group-head-icon group-head-icon--ged">' + icon('people', 17, 2.2) + '</span>' +
        '<span class="group-head-text"><h2 class="section-title"><span class="only-phone">Gedeelde rekeningen</span><span class="only-desktop">Gedeeld</span></h2><small>' + esc(sub) + '</small></span>' +
        (members.length
          ? '<span class="avatar-stack" aria-label="Leden: ' + esc(members.map((m) => (m.me ? 'jij' : m.who)).join(' en ')) + '">' +
            members.map((m) => '<span class="avatar avatar--sm" style="background:' + m.tint + '">' + esc(m.initial) + '</span>').join('') +
          '</span>'
          : '') +
      '</div>' +
      '<div class="start-shared-list">' + list.map(sharedCard).join('') + '</div>' +
    '</section>';
  }

  // A scope without accounts of its kind (for example no shared account yet).
  function noAccounts(scope) {
    const kind = scope === 'gedeeld' ? 'gedeelde' : 'persoonlijke';
    return '<div class="card start-none anim-in" style="--d:40ms">' +
      '<span class="group-head-icon group-head-icon--' + (scope === 'gedeeld' ? 'ged' : 'pers') + '">' + icon(scope === 'gedeeld' ? 'people' : 'person', 17, 2.2) + '</span>' +
      '<span class="start-none-text"><strong>Nog geen ' + kind + ' rekening</strong><span>Koppel je bank om ze hier te zien.</span></span>' +
      '<a class="btn btn--secondary" href="bankkoppelingen.html#nieuw">Bank koppelen</a>' +
    '</div>';
  }

  // ---------- Empty state: no bank linked yet ----------

  function welcome() {
    const promises = [
      ['card', 'Saldo nu en je buffer, per rekening'],
      ['calendar', 'Komende maanden: kom je toe?'],
      ['chart', 'Waar je geld naartoe gaat']
    ];
    const steps = [
      { href: 'instellingen.html#bank', title: 'Enable Banking instellen', sub: 'Je eigen application id en sleutel · eenmalig' },
      { href: 'bankkoppelingen.html#nieuw', title: 'Bank koppelen', sub: 'Kies Argenta en geef toestemming in je bankapp' },
      { href: 'importeren.html', title: 'Geschiedenis importeren', sub: 'Optioneel · een CSV-bestand, bv. de export uit Bilance' }
    ];
    return '<div class="start-welcome">' +
      '<section class="hero start-hello anim-in" style="--d:30ms" aria-labelledby="start-hello-title">' +
        '<span class="start-hello-logo">' + S.icons.logo(48) + '</span>' +
        '<h2 class="start-hello-title" id="start-hello-title">Welkom bij Saldo</h2>' +
        '<p class="start-hello-text">Koppel je bank. Dan zie je hier hoeveel er op elke rekening staat, of je de komende maanden toekomt en waar je geld naartoe gaat.</p>' +
        '<ul class="start-hello-list">' + promises.map((p) => '<li>' + icon(p[0], 16, 2.2) + esc(p[1]) + '</li>').join('') + '</ul>' +
      '</section>' +
      '<div class="start-welcome-side">' +
        '<section class="section anim-in" style="--d:60ms" aria-labelledby="start-steps-title">' +
          '<div class="section-head"><h2 class="section-title" id="start-steps-title">Aan de slag in drie stappen</h2><span class="start-steps-count">0 van 3 klaar</span></div>' +
          '<ol class="list start-steps">' + steps.map((s, i) => '<li>' +
            '<a class="row start-step" href="' + s.href + '">' +
              '<span class="start-step-num' + (i === 0 ? ' start-step-num--next' : '') + '" aria-hidden="true">' + (i + 1) + '</span>' +
              '<span class="row-main"><span class="row-name">' + esc(s.title) + (i === 0 ? '<span class="visually-hidden"> (volgende stap)</span>' : '') + '</span><span class="row-sub">' + esc(s.sub) + '</span></span>' +
              '<span class="start-step-chev">' + icon('chevron', 18) + '</span>' +
            '</a></li>').join('') +
          '</ol>' +
        '</section>' +
        '<div class="start-note anim-in" style="--d:90ms">' +
          '<span class="group-head-icon group-head-icon--ged">' + icon('people', 17, 2.2) + '</span>' +
          '<span class="start-note-text"><strong>' + esc(D.partner.name) + ' koppelt haar eigen rekeningen</strong>' +
            '<span>Iedereen koppelt zijn eigen bank met een eigen login. Een gedeelde rekening die jullie allebei koppelen, zien jullie allebei onder Gedeeld.</span></span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ---------- Screen ----------

  function render(page, st) {
    if (demo() === 'leeg') {
      page.innerHTML = header(true) + welcome();
      return;
    }
    const scope = st.scope;
    const groups = D.groupsFor(scope);
    page.innerHTML =
      header(false) +
      alerts(groups) +
      (groups.length ? '<div class="start-top">' + hero(scope, groups) + forecast(scope, groups) + '</div>' : noAccounts(scope)) +
      '<div class="start-bottom">' +
        (groups.length ? spending(scope, groups) : '') +
        (scope !== 'gedeeld' ? personal() : '') +
        (scope !== 'persoonlijk' ? shared() : '') +
      '</div>';

    page.querySelector('[data-action="sync"]').addEventListener('click', sync);
  }

  // Sync simulation: spinner, progress bar, then a toast (analysis/concepts/bank-connection.md).
  // Offline it only explains why; in the demo state "fout" it ends with an error.
  function sync() {
    if (offline()) { S.shell.toast('Offline · synchroniseren kan niet'); return; }
    if (syncing) return;
    syncing = true;
    updateSync();
    S.shell.progress(true);
    setTimeout(() => {
      syncing = false;
      S.shell.progress(false);
      if (demo() === 'fout') {
        updateSync();
        S.shell.toast('Mislukt · ' + D.consent.bank + ' antwoordt niet');
        return;
      }
      synced = true;
      updateSync();
      document.querySelectorAll('[data-stale]').forEach((el) => el.remove());
      S.shell.toast('Bijgewerkt · 2 nieuwe transacties');
    }, 1600);
  }

  function updateSync() {
    const btn = document.querySelector('[data-action="sync"]');
    if (btn) {
      btn.setAttribute('aria-label', syncLabel());
      btn.firstElementChild.className = syncing ? 'spin' : '';
    }
    document.querySelectorAll('[data-sync-sub]').forEach((el) => {
      const s = syncInfo(D.account(el.dataset.syncSub));
      el.textContent = s.text;
      el.classList.toggle('start-sub--warn', s.tone === 'warn');
      el.classList.toggle('start-sub--neg', s.tone === 'neg');
    });
  }

  S.screens = S.screens || {};
  S.screens.start = { title: 'Start', render };
})(window.Saldo = window.Saldo || {});
