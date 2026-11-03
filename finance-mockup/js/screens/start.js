// Start screen. Design boards: Telefoon-Start, Desktop-Start. Spec: analysis/screens/start.md.
(function (S) {
  'use strict';

  const { eur, eur0, esc, dateLong } = S.fmt;
  const icon = S.icon;
  const D = S.data;

  let syncing = false;
  let synced = false;

  function syncSub() {
    if (syncing) return 'Synchroniseren…';
    return 'Argenta · ' + (synced ? 'zojuist' : D.lastSync);
  }

  // ---------- Pieces ----------

  function header(scope) {
    return '<div class="page-head anim-fade">' +
      '<div class="page-head-title"><h1>Start</h1><span class="page-date only-desktop">' + esc(dateLong(D.today)) + '</span></div>' +
      S.shell.scopeSwitch('anim-in') +
      '<div class="page-head-actions">' +
        '<button type="button" class="icon-btn" data-action="sync" aria-label="' + (syncing ? 'Bezig met synchroniseren' : 'Nu synchroniseren') + '">' +
          '<span class="' + (syncing ? 'spin' : '') + '" style="display:flex">' + icon('sync', 20, 2.2) + '</span></button>' +
        '<a class="avatar only-phone" href="meer.html" aria-label="Profiel en meer" style="background:' + D.user.tint + '">' + esc(D.user.initial) + '</a>' +
      '</div>' +
    '</div>';
  }

  function planningAlerts(groups) {
    const out = [];
    groups.forEach((g) => {
      const ni = g.forecast.findIndex((v) => v < 0);
      const ui = g.forecast.findIndex((v) => v >= 0 && v < g.buffer);
      if (ni >= 0) {
        out.push(alert('neg', 'warning', g.title + ' staat rood in ' + D.forecastMonths[ni].name,
          'Verwacht eindsaldo ' + eur0(g.forecast[ni]) + ' · bekijk de planning', 'planning.html'));
      }
      if (ui >= 0) {
        out.push(alert('warn', 'warning', g.title + ' zakt in de buffer in ' + D.forecastMonths[ui].name,
          'Verwacht ' + eur0(g.forecast[ui]) + ', ' + eur0(g.buffer - g.forecast[ui]) + ' onder de buffer van ' + eur0(g.buffer), 'planning.html'));
      }
    });
    return out.join('');
  }

  function alert(kind, ic, title, note, href, chevron) {
    return '<a class="alert alert--' + kind + '" href="' + href + '">' +
      '<span class="alert-icon">' + icon(ic, 17, 2.2) + '</span>' +
      '<span class="alert-text"><strong>' + esc(title) + '</strong>' + (note ? '<br><span>' + esc(note) + '</span>' : '') + '</span>' +
      (chevron ? '<span class="chev" style="display:flex">' + icon('chevron', 18) + '</span>' : '') +
    '</a>';
  }

  function alerts(groups) {
    return '<div class="alerts anim-in" style="--d:30ms">' +
      planningAlerts(groups) +
      alert('warn', 'clock', 'Toestemming verloopt over ' + D.consent.daysLeft + ' dagen', D.consent.bank + ' · opnieuw autoriseren', '#', true) +
      alert('ok', 'tag', D.toCategorise + ' transacties te categoriseren', '', 'transacties.html?filter=niet-gecategoriseerd', true) +
    '</div>';
  }

  function stateChip(g) {
    if (g.now < 0) return 'Rood';
    return g.now < g.buffer ? 'In de buffer' : 'Boven buffer';
  }

  function contributionRow(cls) {
    const c = D.contributions;
    return '<span class="' + cls + '"><span class="hero-sub">Bijdragen ' + c.month + '</span>' +
      '<span class="contrib-chips">' + c.rows.map((r) => '<span>' + esc(r.who) + ' ' + eur0(r.amount) + (r.ok ? ' ✓' : '') + '</span>').join('') + '</span></span>';
  }

  function hero(scope, groups) {
    if (groups.length === 1) {
      const g = groups[0];
      const shared = g.key === 'ged';
      const scale = Math.max(g.now, g.buffer) * 1.3;
      const fill = (Math.max(g.now, 0) / scale * 100).toFixed(1);
      const marker = (g.buffer / scale * 100).toFixed(1);
      const diff = g.now >= g.buffer ? eur(g.now - g.buffer) + ' boven buffer' : eur(g.buffer - g.now) + ' onder buffer';
      return '<a class="hero' + (shared ? ' hero--shared' : '') + ' anim-in" style="--d:40ms" href="planning.html">' +
        '<span class="hero-top"><span class="hero-label">Saldo nu · ' + esc(g.heroName) + '</span><span class="chip chip--hero">' + stateChip(g) + '</span></span>' +
        '<span class="hero-amount mono">' + eur(g.now) + '</span>' +
        '<span class="hero-meter">' +
          '<span class="hero-track"><span class="hero-fill" style="width:' + fill + '%"></span><span class="hero-marker" style="left:' + marker + '%"></span></span>' +
          '<span class="hero-meter-text"><span>Buffer ' + eur(g.buffer) + '</span><span>' + diff + '</span></span>' +
        '</span>' +
        (shared ? contributionRow('hero-contrib') : '') +
      '</a>';
    }
    const total = groups.reduce((a, g) => a + g.now, 0);
    const anyUnder = groups.some((g) => g.now < g.buffer);
    const tile = (g) => '<span class="hero-tile">' +
      '<span class="hero-tile-label">' + icon(g.key === 'pers' ? 'person' : 'people', 13, 2.4) + esc(g.title) + '</span>' +
      '<span class="mono hero-tile-amount">' + eur(g.now) + '</span>' +
      '<span class="hero-tile-note">' + (g.now >= g.buffer ? eur0(g.now - g.buffer) + ' boven buffer' : eur0(g.buffer - g.now) + ' onder buffer') + '</span>' +
    '</span>';
    return '<a class="hero anim-in" style="--d:40ms" href="planning.html">' +
      '<span class="hero-top"><span class="hero-label">Saldo nu · alle rekeningen</span><span class="chip chip--hero">' + (anyUnder ? 'Let op' : 'Boven buffer') + '</span></span>' +
      '<span class="hero-amount mono">' + eur(total) + '</span>' +
      '<span class="hero-tiles">' + groups.map(tile).join('') + '</span>' +
    '</a>';
  }

  // Month bars per group with zero and buffer lines (analysis/concepts/forecast.md)
  function forecastChart(g, height, index) {
    const span = g.chartMax - g.chartMin;
    const posH = Math.round(g.chartMax / span * height);
    const px = (v) => Math.round(Math.abs(v) / span * height);
    const bars = g.forecast.map((end, i) => {
      const res = end - g.buffer;
      const st = end < 0 ? 'neg' : (res < 0 ? 'under' : 'ok');
      return { end, res, st, m: D.forecastMonths[i], d: 120 + index * 80 + i * 50 };
    });
    const aria = g.title + ': ' + bars.map((b) => b.m.short + ' ' + eur0(b.end) + ', ' +
      (b.st === 'neg' ? 'negatief saldo' : (b.st === 'under' ? 'onder buffer ' + eur0(Math.abs(b.res)) : 'over ' + eur0(b.res)))).join('; ');
    const resColor = { ok: 'var(--greenText)', under: 'var(--warn)', neg: 'var(--neg)' };
    return '<span class="fc">' +
      '<span class="fc-head"><span class="fc-dot" style="background:' + g.color + '"></span><span class="fc-title">' + esc(g.title) + '</span><span class="fc-buf">Buffer ' + eur0(g.buffer) + '</span></span>' +
      '<span class="fc-plot" role="img" aria-label="' + esc(aria) + '" style="height:' + height + 'px">' +
        bars.map((b) => '<span class="fc-col" style="height:' + height + 'px">' +
          '<span class="fc-pos" style="height:' + posH + 'px">' + (b.end > 0 ? '<span class="fc-bar" style="height:' + px(b.end) + 'px;background:' + g.color + ';--d:' + b.d + 'ms"></span>' : '') + '</span>' +
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
    const h = scope === 'alles' ? 84 : 124;
    return '<section class="section start-forecast anim-in" style="--d:70ms">' +
      '<div class="section-head only-phone"><h2 class="section-title">Komende maanden</h2><a class="section-link" href="planning.html">Planning</a></div>' +
      '<a class="card start-forecast-card" href="planning.html">' +
        '<span class="start-forecast-head"><span class="section-title only-desktop">Komende maanden</span><span class="start-forecast-sub">Verwacht eindsaldo per rekening</span></span>' +
        groups.map((g, i) => forecastChart(g, h, i)).join('') +
        '<span class="legend"><span><i style="background:var(--greenText)"></i>Boven buffer</span><span><i style="background:var(--warn)"></i>Onder buffer</span><span><i style="background:var(--neg)"></i>Rood: negatief saldo</span></span>' +
      '</a>' +
    '</section>';
  }

  // Share bar and category rows for one group's spending this month.
  function spendingBlock(sp) {
    const tot = sp.rows.reduce((a, r) => a + r[1], 0);
    const rows = sp.rows.map((r) => ({ name: r[0], amount: r[1], color: D.categories[r[0]], pct: (r[1] / tot * 100).toFixed(1), share: Math.round(r[1] / tot * 100) + '%' }));
    return '<span class="share-bar">' + rows.map((r) => '<span style="width:' + r.pct + '%;background:' + r.color + '"></span>').join('') + '</span>' +
      '<span class="share-rows">' + rows.map((r) => '<span class="share-row"><i style="background:' + r.color + '"></i><span class="name">' + esc(r.name) + ' <span class="muted">' + r.share + '</span></span><span class="amount">' + eur(r.amount) + '</span></span>').join('') + '</span>';
  }

  // Groups are never added together (decision 3 Nov 2026): in Alles one block per group, no combined total.
  function spending(scope, groups) {
    const head = '<div class="section-head start-col-head"><h2 class="section-title">Uitgaven ' + D.spending.month + '</h2>' +
      (groups.length === 1 ? '<a class="section-meta" href="overzicht.html">' + eur(D.spending[scope].total) + '</a>' : '') + '</div>';
    const body = groups.length === 1
      ? spendingBlock(D.spending[scope])
      : groups.map((g) => '<span class="start-spend-group">' +
          '<span class="start-spend-head"><i style="background:' + g.color + '"></i><span>' + esc(g.title) + '</span><span class="mono muted">' + eur(D.spending[g.scope].total) + '</span></span>' +
          spendingBlock(D.spending[g.scope]) +
        '</span>').join('');
    return '<section class="section anim-in" style="--d:100ms">' + head + '<a class="card" href="overzicht.html">' + body + '</a></section>';
  }

  function accountRow(a) {
    const ink = D.accountInk(a);
    const sub = a.type === 'savings'
      ? 'Handmatig · <span class="only-phone">bijgewerkt </span>' + esc(a.updated)
      : '<span data-sync-sub>' + syncSub() + '</span>';
    return '<div class="row">' +
      '<span class="row-icon" style="background:' + ink.bg + ';color:' + ink.fg + '">' + icon(a.icon, 18) + '</span>' +
      '<div class="row-main"><span class="row-name">' + esc(a.name) + '</span><span class="row-sub">' + sub + '</span></div>' +
      '<span class="row-amount">' + eur(a.balance) + '</span>' +
    '</div>';
  }

  function personal() {
    return '<section class="section anim-in" style="--d:130ms">' +
      '<div class="group-head start-col-head">' +
        '<span class="group-head-icon group-head-icon--pers">' + icon('person', 17, 2.2) + '</span>' +
        '<span class="group-head-text"><h2 class="section-title"><span class="only-phone">Persoonlijke rekeningen</span><span class="only-desktop">Persoonlijk</span></h2><small>Alleen jij ziet deze rekeningen</small></span>' +
      '</div>' +
      '<div class="list">' + D.accountsIn('pers').map(accountRow).join('') + '</div>' +
    '</section>';
  }

  function shared() {
    const a = D.accountsIn('ged')[0];
    const ink = D.accountInk(a);
    return '<section class="section anim-in" style="--d:160ms">' +
      '<div class="group-head start-col-head">' +
        '<span class="group-head-icon group-head-icon--ged">' + icon('people', 17, 2.2) + '</span>' +
        '<span class="group-head-text"><h2 class="section-title"><span class="only-phone">Gedeelde rekeningen</span><span class="only-desktop">Gedeeld</span></h2><small>Met ' + esc(D.partner.name) + ' · jij bent beheerder</small></span>' +
        '<span class="avatar-stack" aria-label="Leden: jij en ' + esc(D.partner.name) + '">' +
          '<span class="avatar avatar--sm" style="background:' + D.user.tint + '">' + esc(D.user.initial) + '</span>' +
          '<span class="avatar avatar--sm" style="background:' + D.partner.tint + '">' + esc(D.partner.initial) + '</span>' +
        '</span>' +
      '</div>' +
      '<div class="shared-card">' +
        '<div class="row shared-card-row">' +
          '<span class="row-icon" style="background:' + ink.bg + ';color:' + ink.fg + '">' + icon(a.icon, 18) + '</span>' +
          '<div class="row-main"><span class="row-name">' + esc(a.name) + '</span><span class="row-sub" data-sync-sub>' + syncSub() + '</span></div>' +
          '<span class="row-amount">' + eur(a.balance) + '</span>' +
        '</div>' +
        contributionRow('shared-contrib') +
      '</div>' +
    '</section>';
  }

  // ---------- Screen ----------

  function render(page, st) {
    const scope = st.scope;
    const groups = D.groupsFor(scope);
    page.innerHTML =
      header(scope) +
      alerts(groups) +
      '<div class="start-top">' + hero(scope, groups) + forecast(scope, groups) + '</div>' +
      '<div class="start-bottom">' +
        spending(scope) +
        (scope !== 'gedeeld' ? personal() : '') +
        (scope !== 'persoonlijk' ? shared() : '') +
      '</div>';

    page.querySelector('[data-action="sync"]').addEventListener('click', sync);
  }

  // Sync simulation: spinner, progress bar, then a toast (analysis/concepts/bank-connection.md)
  function sync() {
    if (syncing) return;
    syncing = true;
    updateSync();
    S.shell.progress(true);
    setTimeout(() => {
      syncing = false;
      synced = true;
      updateSync();
      S.shell.progress(false);
      S.shell.toast('Bijgewerkt · 2 nieuwe transacties');
    }, 1600);
  }

  function updateSync() {
    const btn = document.querySelector('[data-action="sync"]');
    if (btn) {
      btn.setAttribute('aria-label', syncing ? 'Bezig met synchroniseren' : 'Nu synchroniseren');
      btn.firstElementChild.className = syncing ? 'spin' : '';
    }
    document.querySelectorAll('[data-sync-sub]').forEach((el) => { el.textContent = syncSub(); });
  }

  S.screens = S.screens || {};
  S.screens.start = { title: 'Start', render };
})(window.Saldo = window.Saldo || {});
