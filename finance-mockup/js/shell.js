// App shell: sidebar (desktop), tab bar (phone), scope switch, theme, toast, sync progress and the
// mockup-only demo state. A page sets <body data-screen="start"> and registers
// Saldo.screens.start = { render(page, state) }. A page with <body data-shell="none"> (sign-in) gets no
// sidebar or tab bar. See analysis/concepts/app-shell.md.
(function (S) {
  'use strict';

  const { icon, logo } = S.icons;
  const esc = S.fmt.esc;

  // Main destinations. `tab` = shown in the phone tab bar, `side` = sidebar group,
  // `tabParent` / `sideParent` = the item marked current for a sub page.
  // Meldingen sits in the Beheer group on desktop (decision 3 Nov 2026).
  const NAV = [
    { id: 'start', label: 'Start', href: 'index.html', icon: 'home', tab: true, side: 'main' },
    { id: 'transacties', label: 'Transacties', href: 'transacties.html', icon: 'list', tab: true, side: 'main', badge: () => (S.shell.state.demo === 'leeg' ? 0 : S.data.toCategorise) },
    { id: 'overzicht', label: 'Overzicht', href: 'overzicht.html', icon: 'chart', tab: true, side: 'main' },
    { id: 'planning', label: 'Planning', href: 'planning.html', icon: 'calendar', tab: true, side: 'main' },
    { id: 'meer', label: 'Meer', href: 'meer.html', icon: 'more', tab: true, stroke: 3 },
    { id: 'rekeningen', label: 'Rekeningen', href: 'rekeningen.html', icon: 'card', side: 'beheer', tabParent: 'meer' },
    { id: 'rekening', label: 'Rekening', href: 'rekening.html', icon: 'card', tabParent: 'meer', sideParent: 'rekeningen' },
    { id: 'bankkoppelingen', label: 'Bankkoppelingen', href: 'bankkoppelingen.html', icon: 'link', side: 'beheer', tabParent: 'meer', dot: () => S.data.connectionState() },
    { id: 'categorieen', label: 'Categorieën', href: 'categorieen.html', icon: 'tag', side: 'beheer', tabParent: 'meer' },
    { id: 'importeren', label: 'Importeren', href: 'importeren.html', icon: 'upload', side: 'beheer', tabParent: 'meer' },
    { id: 'meldingen', label: 'Meldingen', href: 'meldingen.html', icon: 'bell', side: 'beheer', tabParent: 'meer' },
    { id: 'instellingen', label: 'Instellingen', href: 'instellingen.html', icon: 'sliders', side: 'beheer', tabParent: 'meer' }
  ];

  // Mockup-only demo states, picked under Meer → Mockup (analysis/concepts/demo-data.md#demo-states).
  const DEMOS = [
    { id: 'normaal', label: 'Normaal' },
    { id: 'leeg', label: 'Nog geen rekeningen' },
    { id: 'verouderd', label: 'Sync verouderd' },
    { id: 'fout', label: 'Sync mislukt' },
    { id: 'lezen', label: 'Alleen lezen (gedeeld)' },
    { id: 'offline', label: 'Offline' }
  ];

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('saldo.' + key); return v === null ? fallback : v; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('saldo.' + key, value); } catch (e) { /* private mode: keep in memory only */ }
    }
  };

  const state = {
    screen: null,
    scope: store.get('scope', 'alles'),
    theme: store.get('theme', 'system'),
    demo: store.get('demo', 'normaal')
  };

  function navItem(id) { return NAV.find((n) => n.id === id); }

  function renderSidebar() {
    const active = state.screen;
    const link = (n) => {
      const cur = n.id === active || (navItem(active) || {}).sideParent === n.id;
      const badge = n.badge ? n.badge() : 0;
      const dot = n.dot ? n.dot() : '';
      const extra = badge ? '<span class="side-badge">' + esc(badge) + '</span>'
        : (dot ? '<span class="side-dot' + (dot === 'neg' ? ' side-dot--neg' : '') + '" aria-label="' + (dot === 'neg' ? 'Probleem' : 'Let op') + '"></span>' : '');
      return '<a class="side-link" href="' + n.href + '"' + (cur ? ' aria-current="page"' : '') + '>' + icon(n.icon, 20) + esc(n.label) + extra + '</a>';
    };
    const u = S.data.user;
    const userCur = active === 'meer';
    return '<a class="side-logo" href="index.html">' + logo(32) + 'Saldo</a>' +
      '<nav class="side-nav" aria-label="Hoofdmenu">' + NAV.filter((n) => n.side === 'main').map(link).join('') + '</nav>' +
      '<div class="side-group"><span class="side-group-label">Beheer</span>' + NAV.filter((n) => n.side === 'beheer').map(link).join('') + '</div>' +
      '<a class="side-user" href="meer.html"' + (userCur ? ' aria-current="page"' : '') + '>' +
        '<span class="avatar avatar--md" style="background:' + u.tint + '">' + esc(u.initial) + '</span>' +
        '<span class="side-user-name">' + esc(u.name) + '<small>' + esc(u.role) + '</small></span>' +
      '</a>';
  }

  function renderTabbar() {
    const n0 = navItem(state.screen) || {};
    const activeTab = n0.tab ? n0.id : n0.tabParent;
    return NAV.filter((n) => n.tab).map((n) =>
      '<a class="tab" href="' + n.href + '"' + (n.id === activeTab ? ' aria-current="page"' : '') + '>' +
        '<span class="tab-pill">' + icon(n.icon, 22, n.stroke) + '</span>' + esc(n.label) + '</a>'
    ).join('');
  }

  // ---------- Scope switch (analysis/concepts/scope.md) ----------

  const SCOPES = [
    { id: 'alles', label: 'Alles', icon: 'grid' },
    { id: 'persoonlijk', label: 'Persoonlijk', icon: 'person' },
    { id: 'gedeeld', label: 'Gedeeld', icon: 'people' }
  ];

  function scopeSwitch(extraClass) {
    return '<div class="scope' + (extraClass ? ' ' + extraClass : '') + '" role="group" aria-label="Welke rekeningen">' +
      SCOPES.map((s) => '<button type="button" class="scope-btn" data-scope="' + s.id + '" aria-pressed="' + (state.scope === s.id) + '">' +
        icon(s.icon, 16, 2.2) + s.label + '</button>').join('') +
      '</div>';
  }

  function setScope(scope) {
    if (scope === state.scope) return;
    state.scope = scope;
    store.set('scope', scope);
    rerender();
  }

  // ---------- Theme (Weergave) ----------

  function setTheme(theme) {
    state.theme = theme;
    store.set('theme', theme);
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  // ---------- Demo state (mockup only) ----------

  function setDemo(demo) {
    state.demo = demo;
    store.set('demo', demo);
  }

  // Banner shown on every shell page while the demo state is "offline".
  function offlineBanner() {
    return state.demo === 'offline'
      ? '<div class="offline-banner" role="status">' + icon('cloudOff', 16, 2.2) + '<span><strong>Je bent offline.</strong> Je ziet de gegevens van vandaag 08:12. Wijzigen kan weer zodra je verbinding hebt.</span></div>'
      : '';
  }

  // ---------- Feedback ----------

  let toastTimer = null;
  function toast(text) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    clearTimeout(toastTimer);
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.appendChild(el);
    toastTimer = setTimeout(() => el.remove(), 2700);
  }

  function progress(on) {
    const main = document.getElementById('main');
    const bar = main.querySelector(':scope > .progress');
    if (on && !bar) main.insertAdjacentHTML('afterbegin', '<div class="progress" aria-hidden="true"></div>');
    if (!on && bar) bar.remove();
  }

  // ---------- Bootstrapping ----------

  function rerender() {
    const screen = S.screens[state.screen];
    const page = document.getElementById('page');
    if (screen && page) screen.render(page, state);
  }

  function init() {
    state.screen = document.body.dataset.screen;
    // Mockup only: ?demo=<state> and ?scope=<scope> in the URL set the demo state and scope (deep links, screenshots).
    const q = new URLSearchParams(location.search);
    if (DEMOS.some((d) => d.id === q.get('demo'))) setDemo(q.get('demo'));
    if (SCOPES.some((s) => s.id === q.get('scope'))) { state.scope = q.get('scope'); store.set('scope', state.scope); }
    setTheme(state.theme);
    const app = document.getElementById('app');
    if (document.body.dataset.shell === 'none') {
      app.classList.add('app--bare');
      app.innerHTML = '<main class="main main--bare" id="main"><div class="page" id="page"></div></main>';
    } else {
      app.innerHTML =
        '<aside class="sidebar">' + renderSidebar() + '</aside>' +
        '<main class="main" id="main">' + offlineBanner() + '<div class="page" id="page"></div></main>' +
        '<nav class="tabbar" aria-label="Hoofdmenu">' + renderTabbar() + '</nav>';
    }

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.scope-btn');
      if (btn) setScope(btn.dataset.scope);
    });

    const screen = S.screens[state.screen];
    if (screen && screen.title) document.title = screen.title + ' · Saldo';
    rerender();
  }

  S.screens = S.screens || {};
  S.shell = { state, store, scopeSwitch, setScope, setTheme, setDemo, toast, progress, rerender, NAV, DEMOS };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.Saldo = window.Saldo || {});
