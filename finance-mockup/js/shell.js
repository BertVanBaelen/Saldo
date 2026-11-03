// App shell: sidebar (desktop), tab bar (phone), scope switch, theme, toast and sync progress.
// A page sets <body data-screen="start"> and registers Saldo.screens.start = { render(main) }.
// See analysis/concepts/app-shell.md.
(function (S) {
  'use strict';

  const { icon, logo } = S.icons;
  const esc = S.fmt.esc;

  // Main destinations. `tab` = shown in the phone tab bar, `side` = sidebar group.
  const NAV = [
    { id: 'start', label: 'Start', href: 'index.html', icon: 'home', tab: true, side: 'main' },
    { id: 'transacties', label: 'Transacties', href: 'transacties.html', icon: 'list', tab: true, side: 'main', badge: () => S.data.toCategorise },
    { id: 'overzicht', label: 'Overzicht', href: 'overzicht.html', icon: 'chart', tab: true, side: 'main' },
    { id: 'planning', label: 'Planning', href: 'planning.html', icon: 'calendar', tab: true, side: 'main' },
    { id: 'meer', label: 'Meer', href: 'meer.html', icon: 'more', tab: true, stroke: 3 },
    { id: 'rekeningen', label: 'Rekeningen', href: 'rekeningen.html', icon: 'card', side: 'beheer', tabParent: 'meer' },
    { id: 'bankkoppelingen', label: 'Bankkoppelingen', href: '#', icon: 'link', side: 'beheer', dot: true },
    { id: 'categorieen', label: 'Categorieën', href: '#', icon: 'tag', side: 'beheer' },
    { id: 'importeren', label: 'Importeren', href: '#', icon: 'upload', side: 'beheer' },
    { id: 'instellingen', label: 'Instellingen', href: '#', icon: 'sliders', side: 'beheer' },
    { id: 'meldingen', label: 'Meldingen', href: 'meldingen.html', icon: 'bell', tabParent: 'meer', sideParent: 'meer' }
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
    theme: store.get('theme', 'system')
  };

  function navItem(id) { return NAV.find((n) => n.id === id); }

  function renderSidebar() {
    const active = state.screen;
    const link = (n) => {
      const cur = n.id === active || (navItem(active) || {}).sideParent === n.id;
      const extra = n.badge ? '<span class="side-badge">' + esc(n.badge()) + '</span>' : (n.dot ? '<span class="side-dot" aria-label="Let op"></span>' : '');
      return '<a class="side-link" href="' + n.href + '"' + (cur ? ' aria-current="page"' : '') + '>' + icon(n.icon, 20) + esc(n.label) + extra + '</a>';
    };
    const u = S.data.user;
    const userCur = active === 'meer' || active === 'meldingen';
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

  // ---------- Scope switch (analysis/concepts/account-group.md) ----------

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
    setTheme(state.theme);
    const app = document.getElementById('app');
    app.innerHTML =
      '<aside class="sidebar">' + renderSidebar() + '</aside>' +
      '<main class="main" id="main"><div class="page" id="page"></div></main>' +
      '<nav class="tabbar" aria-label="Hoofdmenu">' + renderTabbar() + '</nav>';

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.scope-btn');
      if (btn) setScope(btn.dataset.scope);
    });

    const screen = S.screens[state.screen];
    if (screen && screen.title) document.title = screen.title + ' · Saldo';
    rerender();
  }

  S.screens = S.screens || {};
  S.shell = { state, store, scopeSwitch, setScope, setTheme, toast, progress, rerender, NAV };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.Saldo = window.Saldo || {});
