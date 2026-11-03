// Meer: profile, Geld and App menus, Weergave, Afmelden.
// Design board: Telefoon-Meer. Spec: analysis/screens/meer.md.
// Desktop is not designed: the same menu in a centred column (reached from the sidebar user block).
(function (S) {
  'use strict';

  const { esc } = S.fmt;
  const icon = S.icon;
  const D = S.data;

  // Weergave choices (analysis/concepts/app-shell.md); value = Saldo.shell.state.theme
  const THEMES = [
    { id: 'system', label: 'Systeem', sub: 'Volgt het systeem' },
    { id: 'light', label: 'Licht', sub: 'Licht' },
    { id: 'dark', label: 'Donker', sub: 'Donker' }
  ];

  let page = null;
  let painted = false;
  let themeOpen = false;

  function anim(cls, delay) {
    return painted ? '' : ' ' + cls + '" style="--d:' + delay + 'ms';
  }

  const chevron = '<span class="mr-chev">' + icon('chevron', 18, 2) + '</span>';

  // Menu row: icon tile, title, subline, chevron. `tone` = optional subline class.
  function row(it) {
    return '<a class="mr-row" href="' + it.href + '">' +
      '<span class="mr-tile" style="background:' + it.tile + ';color:' + (it.ink || 'var(--onPastel)') + '">' + icon(it.icon, 18, 2) + '</span>' +
      '<span class="mr-row-main"><span class="mr-row-name">' + esc(it.name) + '</span><span class="mr-row-sub' + (it.tone ? ' ' + it.tone : '') + '">' + esc(it.sub) + '</span></span>' +
      chevron +
    '</a>';
  }

  function themeRow() {
    const cur = THEMES.find((t) => t.id === S.shell.state.theme) || THEMES[0];
    return '<div class="mr-theme">' +
      '<button type="button" class="mr-row" aria-expanded="' + themeOpen + '" aria-controls="mr-theme-pick" data-action="theme-toggle" data-key="theme">' +
        '<span class="mr-tile" style="background:var(--c2);color:var(--onPastel)">' + icon('moon', 18, 2) + '</span>' +
        '<span class="mr-row-main"><span class="mr-row-name">Weergave</span><span class="mr-row-sub" data-theme-sub>' + esc(cur.sub) + '</span></span>' +
        chevron +
      '</button>' +
      '<div class="mr-theme-pick" id="mr-theme-pick" role="group" aria-label="Weergave"' + (themeOpen ? '' : ' hidden') + '>' +
        THEMES.map((t) => '<button type="button" aria-pressed="' + (t.id === cur.id) + '" data-action="theme" data-theme="' + t.id + '" data-key="theme-' + t.id + '">' + esc(t.label) + '</button>').join('') +
      '</div>' +
    '</div>';
  }

  function paint() {
    const u = D.user;
    const geld = [
      { href: 'rekeningen.html', icon: 'card', tile: 'var(--soft)', ink: 'var(--greenText)', name: 'Rekeningen', sub: D.accounts.length + ' rekeningen · buffer en kleur' },
      { href: '#', icon: 'link', tile: 'var(--c1)', name: 'Bankkoppelingen', sub: D.consent.bank + ' · toestemming nog ' + D.consent.daysLeft + ' dagen', tone: 'mr-row-sub--warn' },
      { href: '#', icon: 'tag', tile: 'var(--c3)', name: 'Categorieën en regels', sub: D.suggestions + ' suggesties om te bevestigen' },
      { href: '#', icon: 'upload', tile: 'var(--c4)', name: 'Importeren', sub: 'CSV-bestand, bv. de export uit Bilance' }
    ];
    const app = [
      { href: '#', icon: 'sliders', tile: 'var(--c6)', ink: 'var(--text)', name: 'Instellingen', sub: 'Enable Banking, gebruikers, taal' },
      { href: 'meldingen.html', icon: 'bell', tile: 'var(--c5)', name: 'Meldingen', sub: 'Push en e-mail, per soort' }
    ];

    page.innerHTML =
      '<div class="mr-head' + anim('anim-fade', 0) + '"><h1>Meer</h1></div>' +
      '<a class="mr-profile' + anim('anim-in', 30) + '" href="#">' +
        '<span class="avatar mr-profile-avatar" style="background:' + u.tint + '">' + esc(u.initial) + '</span>' +
        '<span class="mr-profile-main"><span class="mr-profile-name">' + esc(u.name) + '</span><span class="mr-row-sub">Profiel, wachtwoord, taal</span></span>' +
        '<span class="mr-role">' + esc(u.role) + '</span>' +
      '</a>' +
      '<section class="mr-section' + anim('anim-in', 60) + '" aria-labelledby="mr-geld"><h2 class="label mr-section-title" id="mr-geld">Geld</h2>' +
        '<div class="mr-list">' + geld.map(row).join('') + '</div></section>' +
      '<section class="mr-section' + anim('anim-in', 90) + '" aria-labelledby="mr-app"><h2 class="label mr-section-title" id="mr-app">App</h2>' +
        '<div class="mr-list">' + app.map(row).join('') + themeRow() + '</div></section>' +
      '<button type="button" class="btn btn--danger btn--block' + anim('anim-in', 120) + '" data-action="logout">Afmelden</button>';
    painted = true;
  }

  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    if (act === 'theme-toggle') {
      themeOpen = !themeOpen;
      el.setAttribute('aria-expanded', themeOpen);
      page.querySelector('#mr-theme-pick').hidden = !themeOpen;
    } else if (act === 'theme') {
      const t = THEMES.find((x) => x.id === el.dataset.theme);
      S.shell.setTheme(t.id);
      page.querySelectorAll('[data-action="theme"]').forEach((b) => b.setAttribute('aria-pressed', b === el));
      page.querySelector('[data-theme-sub]').textContent = t.sub;
    } else if (act === 'logout') {
      // Sign-in is designed in 0.1-6 (analysis/screens/inloggen.md)
      S.shell.toast('Afmelden werkt nog niet in de mockup');
    }
  }

  function render(p) {
    page = p;
    paint();
    if (!page.dataset.mrWired) {
      page.dataset.mrWired = '1';
      page.addEventListener('click', onClick);
    }
  }

  S.screens = S.screens || {};
  S.screens.meer = { title: 'Meer', render };
})(window.Saldo = window.Saldo || {});
