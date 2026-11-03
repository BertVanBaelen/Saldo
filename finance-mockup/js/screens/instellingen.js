// Instellingen: profile, trusted devices, Enable Banking, users (admin only), export, about.
// Not on the design boards. Spec: analysis/screens/instellingen.md. Concepts: authentication,
// user-and-visibility, bank-connection. Phone: an index list (Meer style) that opens one sub view per hash.
// Desktop: a section nav on the left of the content; no hash shows Profiel.
// Deep links: #profiel #wachtwoord #email-wijzigen #email-code #toestellen #toestel-afmelden #overal-afmelden
// #bank #bank-uitleg #bank-sleutel #gebruikers #gebruiker-uitnodigen #gebruiker-rol #gebruiker-verwijderen
// #gegevens #over. Mockup changes live in memory until the page reloads.
(function (S) {
  'use strict';

  const { esc, eur } = S.fmt;
  const icon = S.icon;
  const D = S.data;

  // Icons this screen adds (24 grid, stroke)
  S.icons.paths.copy = '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path>';

  // ---------- Screen-only demo data ----------

  const REDIRECT = 'https://saldo.jouw-domein.be/api/bank/callback';
  const APP_ID = '3f9c2a1e-••••-••••-••••-••••••••7a1e';
  const NEW_EMAIL = 'bert.nieuw@jouw-domein.be';
  const INVITE_UNTIL = '25 november 2026';
  // A device unused for 90 days is signed out (analysis/concepts/authentication.md#trusted-devices).
  const EXPIRY = { d3: '10 januari 2027' };
  const MIN_PW = 12;
  // A few entries of the common-password blocklist; the server checks a full list.
  const BLOCKLIST = ['wachtwoord', 'wachtwoord1', 'wachtwoord123', 'welkom123', 'welkom1234', 'password', 'password123',
    '123456789012', 'qwertyuiop12', 'azertyuiop12', 'iloveyou1234', 'zomer2026zomer'];
  const common = (p) => {
    const l = p.toLowerCase();
    return BLOCKLIST.indexOf(l) >= 0 || /(wachtwoord|password|welkom|azerty|qwerty|123456|saldo)/.test(l) || /^(.)\1+$/.test(l);
  };

  const ROLES = [
    { id: 'user', label: 'Gebruiker', sub: 'Ziet alleen de eigen rekeningen.' },
    { id: 'admin', label: 'Beheerder', sub: 'Kan ook gebruikers uitnodigen, hun rol wijzigen en verwijderen. Ziet daardoor geen extra rekeningen.' }
  ];

  const PARTS = [
    ['accounts', 'Rekeningen en saldi', 'Met de saldogeschiedenis van je spaarrekeningen'],
    ['transactions', 'Transacties', 'Met categorie, notitie en splitsingen'],
    ['categories', 'Categorieën', 'De categorieënlijst van Saldo'],
    ['rules', 'Regels', 'Jouw regels en die van je rekeningen'],
    ['recurring', 'Terugkerende posten', 'Bevestigde posten met bedrag en dag'],
    ['planned', 'Eenmalige posten', 'Geplande uitgaven en verwachte inkomsten']
  ];
  const FORMATS = {
    csv: { label: 'CSV', file: 'saldo-export-2026-11-18.zip', help: 'Een zip met één CSV-bestand per onderdeel. Opent in Excel of Numbers.' },
    json: { label: 'JSON', file: 'saldo-export-2026-11-18.json', help: 'Eén bestand met alles samen. Bedragen in cent, zoals Saldo ze bewaart.' }
  };

  // ---------- State (in memory) ----------

  // Demo state, read on the first render (the shell applies ?demo= after this script loads)
  let demo = 'normaal';
  let offline = false;
  let empty = false;
  const TINTS = [D.user.tint, D.partner.tint, 'var(--c1)', 'var(--c4)', 'var(--c5)'];

  const st = {
    name: D.user.name,
    email: D.user.email,
    pwChanged: 'op 3 juni 2026',
    pwOpen: false,
    pwShow: false,
    pw: { cur: '', next: '', rep: '' },
    pwError: '',
    devices: D.devices.map((d) => Object.assign({}, d)),
    bank: { configured: !empty, uploaded: '3 juni 2026', replacing: false, howto: false, file: null, appId: '', error: '', testing: false, tested: '', justSet: false },
    users: D.users.map((u, i) => Object.assign({ id: u.name.toLowerCase(), tint: TINTS[i] || 'var(--c6)' }, u)),
    invites: [],
    exp: { fmt: 'csv', parts: { accounts: true, transactions: true, categories: true, rules: true, recurring: true, planned: true }, busy: false, last: '' }
  };
  const me = () => st.users.find((u) => u.me);
  const isAdmin = () => me().role === 'admin';
  const initial = (s) => (String(s).trim().charAt(0) || '?').toUpperCase();

  // ---------- Sections and routes ----------

  const themeSub = () => ({ light: 'Licht', dark: 'Donker' }[S.shell.state.theme] || 'Volgt het systeem');
  const SECTIONS = [
    { id: 'profiel', group: 'jij', title: 'Profiel', icon: 'person', tile: 'var(--c2)',
      sub: () => 'Naam, e-mail, wachtwoord, taal', intro: 'Je naam, e-mailadres, wachtwoord en taal.' },
    { id: 'toestellen', group: 'jij', title: 'Toestellen', icon: 'laptop', tile: 'var(--c1)',
      sub: () => (st.devices.length === 1 ? 'Alleen dit toestel' : st.devices.length + ' toestellen aangemeld'),
      intro: 'De toestellen en browsers waarop je aangemeld blijft.' },
    { id: 'bank', group: 'jij', title: 'Enable Banking', icon: 'key', tile: 'var(--soft)', ink: 'var(--greenText)',
      sub: () => (st.bank.configured ? 'Sleutel geüpload · versleuteld' : 'Nog niet ingesteld'),
      tone: () => (st.bank.configured ? '' : 'warn'),
      intro: 'Je eigen app bij Enable Banking. Daarmee leest Saldo je bank.' },
    { id: 'gebruikers', group: 'beheer', title: 'Gebruikers', icon: 'people', tile: 'var(--c4)', admin: true,
      sub: () => st.users.length + ' gebruikers' + (st.invites.length ? ' · ' + st.invites.length + ' uitgenodigd' : ''),
      intro: 'Wie mag inloggen op deze Saldo. Alleen beheerders zien dit.' },
    { id: 'gegevens', group: 'saldo', title: 'Gegevens exporteren', nav: 'Gegevens', icon: 'download', tile: 'var(--c5)',
      sub: () => 'CSV of JSON · je eigen rekeningen', intro: 'Download alles wat jij in Saldo kan zien.' },
    { id: 'over', group: 'saldo', title: 'Over Saldo', icon: 'info', tile: 'var(--c6)', ink: 'var(--text)',
      sub: () => 'Versie 0.1 · back-ups', intro: 'Versie, waar Saldo draait en hoe je het veilig bewaart.' }
  ];
  const GROUPS = [['jij', 'Jij'], ['beheer', 'Beheer'], ['saldo', 'Saldo']];
  // Deep links to a step inside a section
  const SUBS = {
    wachtwoord: 'profiel', 'email-wijzigen': 'profiel', 'email-code': 'profiel',
    'toestel-afmelden': 'toestellen', 'overal-afmelden': 'toestellen',
    'bank-uitleg': 'bank', 'bank-sleutel': 'bank',
    'gebruiker-uitnodigen': 'gebruikers', 'gebruiker-rol': 'gebruikers', 'gebruiker-verwijderen': 'gebruikers'
  };
  const visible = () => SECTIONS.filter((s) => !s.admin || isAdmin());
  const section = (id) => SECTIONS.find((s) => s.id === id);

  let page = null;
  let painted = false;
  let flip = false;              // fade the content after a section change
  let cur = { section: null, sub: null };
  let overlay = null;            // open sheet: { kind, … }
  let returnKey = null;          // control to focus when the sheet closes

  function anim(cls, delay) {
    return painted ? '' : ' ' + cls + '" style="--d:' + delay + 'ms';
  }

  // Server actions are blocked while offline: dimmed, and a tap explains why.
  const saveAttr = () => (offline ? ' aria-disabled="true" data-offline="1"' : '');

  // ---------- Small pieces ----------

  const chev = (s) => '<span class="in-chev">' + icon('chevron', s || 18, 2) + '</span>';
  const tile = (s, size) => '<span class="in-tile' + (size ? ' in-tile--' + size : '') + '" style="background:' + s.tile + ';color:' + (s.ink || 'var(--onPastel)') + '">' +
    icon(s.icon, size === 'sm' ? 16 : (size === 'lg' ? 20 : 18), 2) + '</span>';
  const kv = (label, value) => '<div class="in-kv-row"><dt>' + label + '</dt><dd>' + value + '</dd></div>';
  const note = (ic, html, tone) => '<div class="in-note' + (tone ? ' in-note--' + tone : '') + '"><span class="in-note-icon">' + icon(ic, 18, 2) + '</span><p>' + html + '</p></div>';
  const errorLine = (text) => (text ? '<p class="in-error" role="alert">' + icon('warning', 16, 2.2) + '<span>' + esc(text) + '</span></p>' : '');
  const field = (id, label, control, help) => '<div class="in-field"><label class="in-label" for="' + id + '">' + label + '</label>' + control +
    (help ? '<span class="in-help">' + help + '</span>' : '') + '</div>';

  // Hidden username next to password fields, so password managers know the account.
  const userHint = () => '<input type="email" class="visually-hidden" autocomplete="username" value="' + esc(st.email) + '" tabindex="-1" aria-hidden="true" readonly>';

  function roleChip(role) {
    return role === 'admin' ? '<span class="chip chip--ok in-role">Beheerder</span>' : '<span class="chip in-role in-role--user">Gebruiker</span>';
  }

  function copyBox() {
    return '<div class="in-copy"><code class="in-copy-text">' + esc(REDIRECT) + '</code>' +
      '<button type="button" class="in-copy-btn" data-action="copy" aria-label="Redirect-URL kopiëren">' + icon('copy', 18, 2) + '</button></div>';
  }

  function seg(label, items, action, current) {
    return '<div class="in-seg" role="group" aria-label="' + esc(label) + '">' + items.map((it) =>
      '<button type="button" aria-pressed="' + (it.id === current) + '" data-action="' + action + '" data-value="' + it.id + '" data-key="' + action + '-' + it.id + '"' +
        (it.disabled ? ' disabled' : '') + '>' + it.label + '</button>').join('') + '</div>';
  }

  // ---------- Frame: header, desktop nav, phone index ----------

  function header() {
    const s = section(cur.section);
    const back = s
      ? '<a class="page-back only-phone" href="#" aria-label="Terug naar Instellingen">'
      : '<a class="page-back only-phone" href="meer.html" aria-label="Terug naar Meer">';
    return '<div class="in-head' + anim('anim-fade', 0) + '">' + back + icon('back', 22, 2.4) + '</a>' +
      '<div class="in-head-title"><h1 id="in-h1" tabindex="-1"><span class="only-phone">' + esc(s ? s.title : 'Instellingen') + '</span><span class="only-desktop">Instellingen</span></h1>' +
        '<span class="in-head-sub only-desktop">Profiel, toestellen, Enable Banking en gebruikers</span></div>' +
    '</div>';
  }

  function navMeta(s) {
    if (s.id === 'toestellen') return '<span class="in-nav-meta">' + st.devices.length + '</span>';
    if (s.id === 'gebruikers') return '<span class="in-nav-meta">' + (st.users.length + st.invites.length) + '</span>';
    if (s.id === 'bank' && !st.bank.configured) return '<span class="in-nav-dot" aria-label="Nog niet ingesteld"></span>';
    return '';
  }

  function deskNav(active) {
    return '<nav class="in-nav only-desktop' + anim('anim-in', 30) + '" aria-label="Instellingen">' + GROUPS.map((g) => {
      const items = visible().filter((s) => s.group === g[0]);
      if (!items.length) return '';
      return '<div class="in-nav-group"><span class="in-nav-label">' + g[1] + '</span>' + items.map((s) =>
        '<a class="in-nav-link" href="#' + s.id + '"' + (s.id === active ? ' aria-current="true"' : '') + '>' + tile(s, 'sm') +
          '<span class="in-nav-name">' + esc(s.nav || s.title) + '</span>' + navMeta(s) + '</a>').join('') + '</div>';
    }).join('') + '</nav>';
  }

  function indexRow(s) {
    const tone = s.tone ? s.tone() : '';
    return '<a class="in-row" href="#' + s.id + '">' + tile(s) +
      '<span class="in-row-main"><span class="in-row-name">' + esc(s.title) + '</span><span class="in-row-sub' + (tone ? ' in-row-sub--' + tone : '') + '">' + esc(s.sub()) + '</span></span>' +
      chev() + '</a>';
  }

  function phoneIndex() {
    return '<div class="in-index">' + GROUPS.map((g, i) => {
      const items = visible().filter((s) => s.group === g[0]);
      if (!items.length) return '';
      return '<section class="in-group' + anim('anim-in', 30 + i * 30) + '" aria-labelledby="in-g-' + g[0] + '">' +
        '<h2 class="label in-group-title" id="in-g-' + g[0] + '">' + g[1] + '</h2>' +
        '<div class="in-list">' + items.map(indexRow).join('') + '</div></section>';
    }).join('') + '</div>';
  }

  function sectionHead(s) {
    const action = s.id === 'gebruikers' && isAdmin()
      ? '<button type="button" class="btn btn--primary in-head-btn only-desktop" data-action="invite" data-key="invite-d"' + saveAttr() + '>' + icon('userPlus', 18, 2.2) + 'Uitnodigen</button>'
      : '';
    return '<div class="in-sec-head"><div class="in-sec-title"><h2>' + esc(s.title) + '</h2><p>' + esc(s.intro) + '</p></div>' + action + '</div>';
  }

  // ---------- Profiel ----------

  function pwChecks() {
    const p = st.pw;
    const len = p.next ? (p.next.length >= MIN_PW ? 'ok' : 'bad') : '';
    const block = p.next ? (common(p.next) ? 'bad' : 'ok') : '';
    const match = p.rep ? (p.rep === p.next ? 'ok' : 'bad') : '';
    return { len, block, match };
  }

  function checkItem(state, text) {
    const ic = state === 'ok' ? icon('check', 13, 3) : (state === 'bad' ? icon('close', 13, 3) : '');
    const sr = state === 'ok' ? ' (in orde)' : (state === 'bad' ? ' (nog niet in orde)' : '');
    return '<li class="in-check' + (state ? ' in-check--' + state : '') + '"><span class="in-check-dot" aria-hidden="true">' + ic + '</span>' + text +
      '<span class="visually-hidden">' + sr + '</span></li>';
  }

  function pwChecksHtml() {
    const c = pwChecks();
    return checkItem(c.len, 'Minstens ' + MIN_PW + ' tekens') +
      checkItem(c.block, 'Geen veelgebruikt wachtwoord') +
      checkItem(c.match, 'Twee keer hetzelfde');
  }

  function passwordCard() {
    const p = st.pw;
    const blocked = pwChecks().block === 'bad';
    return '<section class="in-card' + anim('anim-in', 90) + '" aria-labelledby="in-pw-t">' +
      '<div class="in-card-row"><span class="in-card-text"><h3 class="in-card-title" id="in-pw-t">Wachtwoord</h3>' +
        '<span class="in-card-sub">Laatst gewijzigd ' + esc(st.pwChanged) + '</span></span>' +
        '<button type="button" class="in-btn in-btn--ghost in-btn--sm" aria-expanded="' + st.pwOpen + '" aria-controls="in-pw-form" data-action="pw-toggle" data-key="pw-toggle"' +
          (st.pwOpen ? '' : saveAttr()) + '>' + (st.pwOpen ? 'Annuleren' : 'Wijzigen') + '</button></div>' +
      '<form class="in-form" id="in-pw-form" data-form="pw" novalidate' + (st.pwOpen ? '' : ' hidden') + '>' +
        userHint() +
        field('in-pw-cur', 'Huidig wachtwoord', '<input class="input" type="password" id="in-pw-cur" autocomplete="current-password" value="' + esc(p.cur) + '" data-input="pw-cur" data-key="pw-cur">') +
        field('in-pw-new', 'Nieuw wachtwoord',
          '<div class="in-pass"><input class="input" type="' + (st.pwShow ? 'text' : 'password') + '" id="in-pw-new" autocomplete="new-password" aria-describedby="in-pw-checks" value="' + esc(p.next) + '" data-input="pw-new" data-key="pw-new">' +
          '<button type="button" class="in-pass-eye" aria-pressed="' + st.pwShow + '" aria-label="Wachtwoord tonen" data-action="pw-show" data-key="pw-show">' + icon('eye', 18, 2) + '</button></div>') +
        field('in-pw-rep', 'Herhaal nieuw wachtwoord', '<input class="input" type="' + (st.pwShow ? 'text' : 'password') + '" id="in-pw-rep" autocomplete="new-password" value="' + esc(p.rep) + '" data-input="pw-rep" data-key="pw-rep">') +
        '<ul class="in-checks" id="in-pw-checks" data-bind="pw-checks">' + pwChecksHtml() + '</ul>' +
        '<p class="in-block" data-bind="pw-block"' + (blocked ? '' : ' hidden') + '>' + icon('warning', 16, 2.2) +
          '<span>Dit wachtwoord staat in de lijst van veelgebruikte wachtwoorden. Kies iets dat moeilijk te raden is, bijvoorbeeld drie losse woorden.</span></p>' +
        errorLine(st.pwError) +
        '<p class="in-help">Je blijft aangemeld op dit toestel. Je andere toestellen worden afgemeld.</p>' +
        '<div class="in-actions"><button type="submit" class="in-btn in-btn--primary" data-key="pw-save"' + saveAttr() + '>Wachtwoord wijzigen</button></div>' +
      '</form>' +
    '</section>';
  }

  function profiel() {
    const langs = [{ id: 'nl', label: 'Nederlands' }, { id: 'en', label: 'English <span class="in-later">later</span>', disabled: true }];
    const weergave = { icon: 'moon', tile: 'var(--c2)' };
    return '<section class="in-card' + anim('anim-in', 60) + '" aria-label="Profiel">' +
        '<div class="in-prof-head">' +
          '<span class="avatar in-prof-avatar" style="background:' + me().tint + '" data-bind="initial">' + esc(initial(st.name)) + '</span>' +
          '<span class="in-prof-main"><span class="in-prof-name" data-bind="name">' + esc(st.name) + '</span><span class="in-prof-sub">Sinds ' + esc(me().since) + '</span></span>' +
          roleChip(me().role) +
        '</div>' +
        field('in-name', 'Naam',
          '<div class="in-inline"><input class="input" id="in-name" autocomplete="name" value="' + esc(st.name) + '" data-input="name" data-key="name">' +
          '<button type="button" class="in-btn in-btn--ghost" data-action="name-save" data-key="name-save"' + saveAttr() + '>Opslaan</button></div>',
          'Zo heet je in Saldo en in e-mails. Leden van een gedeelde rekening zien deze naam ook.') +
        '<div class="in-field"><span class="in-label" id="in-email-l">E-mailadres</span>' +
          '<div class="in-inline"><span class="in-static" aria-labelledby="in-email-l" data-bind="email">' + esc(st.email) + '</span>' +
          '<button type="button" class="in-btn in-btn--ghost" data-action="email-change" data-key="email-change" aria-label="E-mailadres wijzigen"' + saveAttr() + '>Wijzigen</button></div>' +
          '<span class="in-help">Hier komen je inlogcodes, uitnodigingen en meldingen. Een nieuw adres bevestig je met een code die we naar dat adres sturen.</span></div>' +
      '</section>' +
      passwordCard() +
      '<section class="in-card' + anim('anim-in', 120) + '" aria-labelledby="in-lang-t">' +
        '<span class="in-card-text"><h3 class="in-card-title" id="in-lang-t">Taal</h3>' +
        '<span class="in-card-sub">Bedragen en datums staan altijd in het Belgische formaat: ' + eur(123456) + ' · 18 november 2026.</span></span>' +
        seg('Taal', langs, 'lang', 'nl') +
      '</section>' +
      '<div class="in-list' + anim('anim-in', 150) + '">' +
        '<a class="in-row" href="meer.html">' + tile(weergave) +
          '<span class="in-row-main"><span class="in-row-name">Weergave</span><span class="in-row-sub">' + esc(themeSub()) + ' · kies licht of donker in Meer</span></span>' + chev() + '</a>' +
      '</div>';
  }

  // ---------- Toestellen ----------

  function deviceRow(d) {
    const last = d.last === 'nu' ? 'Nu in gebruik' : 'Laatst gebruikt ' + d.last;
    return '<div class="in-device">' +
      '<span class="in-device-icon">' + icon(d.kind === 'phone' ? 'phone' : 'laptop', 20, 2) + '</span>' +
      '<span class="in-device-main">' +
        '<span class="in-device-name"><span>' + esc(d.name) + '</span>' + (d.me ? '<span class="chip chip--ok in-me">Dit toestel</span>' : '') + '</span>' +
        '<span class="in-device-meta"><span>Toegevoegd op ' + esc(d.added) + '</span><span>' + esc(last) + '</span></span>' +
        (EXPIRY[d.id] ? '<span class="in-device-exp">' + icon('clock', 14, 2.2) + 'Wordt afgemeld op ' + EXPIRY[d.id] + ' als het ongebruikt blijft</span>' : '') +
      '</span>' +
      '<button type="button" class="in-btn in-btn--ghost in-btn--sm" data-action="device-out" data-id="' + d.id + '" data-key="dev-' + d.id + '" aria-label="' + esc(d.name) + ' afmelden"' + saveAttr() + '>Afmelden</button>' +
    '</div>';
  }

  function toestellen() {
    const others = st.devices.filter((d) => !d.me).length;
    const explain = [
      ['shield', 'Na je wachtwoord en de e-mailcode blijft een toestel aangemeld. Je hoeft niet elke keer opnieuw in te loggen.'],
      ['clock', 'Gebruik je een toestel 90 dagen niet, dan wordt het vanzelf afgemeld.'],
      ['bell', 'Meldt een nieuw toestel zich aan, dan krijg je een pushmelding en een e-mail "Nieuw toestel aangemeld". Die e-mail kan je niet uitzetten.'],
      ['lock', 'Herken je een toestel niet? Meld het af en <a href="#wachtwoord">wijzig je wachtwoord</a>.']
    ];
    return '<section class="in-card in-card--list' + anim('anim-in', 60) + '" aria-label="Aangemelde toestellen">' + st.devices.map(deviceRow).join('') + '</section>' +
      (others
        ? '<button type="button" class="in-btn in-btn--danger-line in-btn--block' + anim('anim-in', 90) + '" data-action="devices-out" data-key="devices-out"' + saveAttr() + '>' + icon('logout', 18, 2) + 'Overal afmelden behalve hier</button>'
        : '<p class="in-quiet">Alleen dit toestel is aangemeld.</p>') +
      '<section class="in-card' + anim('anim-in', 120) + '" aria-labelledby="in-explain-t"><h3 class="in-card-title" id="in-explain-t">Zo blijf je aangemeld</h3>' +
        '<ul class="in-explain">' + explain.map((e) => '<li><span class="in-explain-icon">' + icon(e[0], 16, 2.2) + '</span><span>' + e[1] + '</span></li>').join('') + '</ul>' +
      '</section>';
  }

  // ---------- Enable Banking ----------

  function ownAppNote(delay) {
    return '<div class="' + anim('anim-in', delay).replace(/^ /, '') + '">' +
      note('people', '<strong>Elke gebruiker gebruikt een eigen app.</strong> ' + esc(D.partner.name) + ' stelt die zelf in, bij haar eigen login. Jullie zien elkaars sleutel nooit.') + '</div>';
  }

  function fileField(replacing) {
    const f = st.bank.file;
    return '<div class="in-file">' +
      '<input type="file" id="in-pem" class="visually-hidden" accept=".pem" data-input="pem" data-key="pem">' +
      '<label for="in-pem" class="in-file-drop">' +
        '<span class="in-file-icon">' + icon(f ? 'check' : 'file', 20, 2.2) + '</span>' +
        '<span class="in-file-text">' + (f
          ? '<strong>' + esc(f.name) + '</strong><small>' + esc(f.size) + ' · wordt versleuteld opgeslagen</small>'
          : (replacing ? '<strong>Kies de nieuwe sleutel</strong><small>Een .pem-bestand</small>' : '<strong>Kies je .pem-bestand</strong><small>Bijvoorbeeld saldo-bert.pem</small>')) + '</span>' +
        '<span class="in-file-btn">' + (f ? 'Ander bestand' : 'Kiezen') + '</span>' +
      '</label></div>';
  }

  function appIdField(replacing) {
    return '<input class="input in-appid" id="in-appid" autocomplete="off" spellcheck="false" value="' + esc(st.bank.appId) + '"' +
      ' placeholder="' + (replacing ? 'Leeg laten om het huidige te houden' : 'Bijvoorbeeld 3f9c2a1e-8b4d-…') + '" data-input="appid" data-key="appid">';
  }

  function steps(list) {
    return '<ol class="in-steps">' + list.map((s, i) =>
      '<li class="in-step"><span class="in-step-num" aria-hidden="true">' + (i + 1) + '</span>' +
        '<div class="in-step-body"><span class="in-step-title">' + s.t + '</span><span class="in-step-text">' + s.d + '</span>' + (s.x || '') + '</div></li>').join('') + '</ol>';
  }

  const STEP_APP = { t: 'Maak een gratis app bij Enable Banking',
    d: 'Kies "Restricted production" (beperkte productie): alleen je eigen rekeningen, niet commercieel. Dat is gratis.',
    x: '<button type="button" class="in-btn in-btn--ghost in-btn--sm in-step-btn" data-action="eb-open">' + icon('external', 16, 2.2) + 'Enable Banking openen</button>' };
  const STEP_URL = { t: 'Zet deze redirect-URL in je app', d: 'Na je akkoord bij de bank stuurt Enable Banking je naar dit adres terug.', x: copyBox() };

  function bankSetup(replacing) {
    const b = st.bank;
    const keyStep = { t: '<label for="in-pem">' + (replacing ? 'Upload de nieuwe privésleutel (.pem)' : 'Upload de privésleutel (.pem)') + '</label>',
      d: replacing ? 'Maak in het Enable Banking-dashboard een nieuwe sleutel en download hem.' : 'Je krijgt hem bij het aanmaken van de app. Saldo bewaart hem versleuteld.',
      x: fileField(replacing) };
    const idStep = { t: '<label for="in-appid">' + (replacing ? 'Application ID' : 'Vul het application ID in') + '</label>',
      d: replacing ? 'Alleen nodig als je een nieuwe app maakte.' : 'Je vindt het bij je app in het Enable Banking-dashboard.',
      x: appIdField(replacing) };
    const head = replacing
      ? '<div class="in-card-row"><span class="in-card-text"><h3 class="in-card-title" id="in-eb-t">Sleutel vervangen</h3>' +
          '<span class="in-card-sub">Je bankkoppelingen blijven werken zolang het application ID hetzelfde blijft. Met een nieuwe app koppel je je bank daarna opnieuw.</span></span></div>'
      : '<div class="in-card-row">' + tile({ icon: 'key', tile: 'var(--warnSoft)', ink: 'var(--warn)' }, 'lg') +
          '<span class="in-card-text"><h3 class="in-card-title" id="in-eb-t">Enable Banking</h3><span class="chip chip--warn in-status">Nog niet ingesteld</span></span></div>' +
        '<p class="in-text">Saldo leest je bank via Enable Banking. Daarvoor maak je één keer een eigen, gratis app aan. Dat duurt ongeveer tien minuten.</p>';
    return '<section class="in-card' + anim('anim-in', 60) + '" aria-labelledby="in-eb-t">' + head +
        '<form class="in-form" data-form="bank" novalidate>' +
          steps(replacing ? [keyStep, idStep] : [STEP_APP, STEP_URL, keyStep, idStep]) +
          errorLine(b.error) +
          '<div class="in-actions">' +
            (replacing ? '<button type="button" class="in-btn in-btn--ghost" data-action="bank-cancel" data-key="bank-cancel">Annuleren</button>' : '') +
            '<button type="submit" class="in-btn in-btn--primary" data-key="bank-save"' + saveAttr() + '>Opslaan en testen</button>' +
          '</div>' +
        '</form>' +
      '</section>' +
      ownAppNote(90);
  }

  function bankStatus() {
    const b = st.bank;
    const mine = D.connections.filter((c) => c.mine);
    const used = mine.length
      ? '<a href="bankkoppelingen.html">' + esc(mine[0].bank) + ' · ' + mine.length + (mine.length === 1 ? ' bankkoppeling' : ' bankkoppelingen') + '</a>'
      : '<a href="bankkoppelingen.html">Nog geen bankkoppeling</a>';
    const tested = b.tested
      ? (demo === 'fout'
        ? kv('Laatste test', '<span class="in-test in-test--warn">' + icon('warning', 15, 2.2) + 'Enable Banking werkt. De synchronisatie met Argenta mislukt: kijk bij <a href="bankkoppelingen.html">Bankkoppelingen</a>.</span>')
        : kv('Laatste test', '<span class="in-test">' + icon('check', 15, 2.6) + 'Verbinding werkt · ' + esc(b.tested) + '</span>'))
      : '';
    return (b.justSet
        ? '<a class="alert alert--ok' + anim('anim-in', 40) + '" href="bankkoppelingen.html"><span class="alert-icon">' + icon('check', 18, 2.4) + '</span>' +
          '<span class="alert-text"><strong>Enable Banking is ingesteld.</strong> <span>Koppel nu je bank onder Bankkoppelingen.</span></span>' + chev(16) + '</a>'
        : '') +
      '<section class="in-card' + anim('anim-in', 60) + '" aria-labelledby="in-eb-t">' +
        '<div class="in-card-row">' + tile(section('bank'), 'lg') +
          '<span class="in-card-text"><h3 class="in-card-title" id="in-eb-t">Enable Banking</h3><span class="chip chip--ok in-status">' + icon('check', 14, 2.6) + 'Ingesteld</span></span></div>' +
        '<dl class="in-kv">' +
          kv('Modus', 'Beperkte productie · alleen je eigen rekeningen') +
          kv('Application ID', '<span class="mono in-mono">' + esc(APP_ID) + '</span>') +
          kv('Privésleutel', 'Sleutel geüpload op ' + esc(b.uploaded) + ' · versleuteld opgeslagen') +
          kv('Redirect-URL', copyBox()) +
          kv('Gebruikt door', used) +
          tested +
        '</dl>' +
        '<div class="in-actions in-actions--split">' +
          '<button type="button" class="in-btn in-btn--ghost' + (b.testing ? ' in-spin' : '') + '" data-action="bank-test" data-key="bank-test"' + saveAttr() + (b.testing ? ' aria-busy="true"' : '') + '>' +
            icon('sync', 18, 2.2) + (b.testing ? 'Testen…' : 'Verbinding testen') + '</button>' +
          '<button type="button" class="in-btn in-btn--ghost" data-action="bank-replace" data-key="bank-replace"' + saveAttr() + '>' + icon('upload', 18, 2.2) + 'Sleutel vervangen</button>' +
        '</div>' +
      '</section>' +
      ownAppNote(90) +
      '<section class="in-card' + anim('anim-in', 120) + '">' +
        '<button type="button" class="in-disclosure" aria-expanded="' + b.howto + '" aria-controls="in-howto" data-action="howto" data-key="howto">' +
          '<span>Zo stel je het de eerste keer in</span>' + chev() + '</button>' +
        '<div id="in-howto" class="in-howto"' + (b.howto ? '' : ' hidden') + '>' +
          steps([STEP_APP, STEP_URL,
            { t: 'Upload de privésleutel (.pem)', d: 'Je krijgt hem bij het aanmaken van de app. Saldo bewaart hem versleuteld.' },
            { t: 'Vul het application ID in', d: 'Je vindt het bij je app in het Enable Banking-dashboard.' }]) +
        '</div>' +
      '</section>';
  }

  function bank() {
    if (!st.bank.configured) return bankSetup(false);
    if (st.bank.replacing) return bankSetup(true);
    return bankStatus();
  }

  // ---------- Gebruikers (admin only) ----------

  function userAction(action, u, ic, label, sub, tone) {
    return '<button type="button" class="in-uact' + (tone ? ' in-uact--' + tone : '') + '" data-action="' + action + '" data-id="' + u.id + '" data-key="' + action + '-' + u.id + '"' + saveAttr() + '>' +
      '<span class="in-uact-icon">' + icon(ic, 18, 2) + '</span><span class="in-uact-label">' + label + '</span>' +
      (sub ? '<span class="in-uact-sub">' + sub + '</span>' : '') + '</button>';
  }

  function userCard(u, i) {
    return '<article class="in-card in-user' + anim('anim-in', 60 + i * 30) + '" aria-labelledby="in-u-' + u.id + '">' +
      '<div class="in-user-head">' +
        '<span class="avatar" style="background:' + u.tint + '">' + esc(initial(u.me ? st.name : u.name)) + '</span>' +
        '<span class="in-user-main"><span class="in-user-name" id="in-u-' + u.id + '">' + esc(u.me ? st.name : u.name) + (u.me ? '<span class="in-you">Jij</span>' : '') + '</span>' +
          '<span class="in-user-sub">' + esc(u.me ? st.email : u.email) + '</span><span class="in-user-sub">Sinds ' + esc(u.since) + '</span></span>' +
        roleChip(u.role) +
      '</div>' +
      (u.me
        ? '<p class="in-user-self">Dit ben jij. Je eigen rol kan alleen een andere beheerder wijzigen.</p>'
        : '<div class="in-uacts">' +
            userAction('user-reset', u, 'mail', 'Nieuwe wachtwoordlink sturen', '1 uur geldig') +
            userAction('user-role', u, 'edit', 'Rol wijzigen', u.role === 'admin' ? 'Beheerder' : 'Gebruiker') +
            userAction('user-delete', u, 'trash', 'Gebruiker verwijderen', '', 'neg') +
          '</div>') +
    '</article>';
  }

  function inviteCard(inv) {
    return '<article class="in-card in-user in-user--pending anim-in" aria-labelledby="in-i-' + inv.id + '">' +
      '<div class="in-user-head">' +
        '<span class="avatar in-avatar-pending">' + icon('mail', 18, 2) + '</span>' +
        '<span class="in-user-main"><span class="in-user-name" id="in-i-' + inv.id + '">' + esc(inv.email) + '</span>' +
          '<span class="in-user-sub">Uitgenodigd als ' + (inv.role === 'admin' ? 'beheerder' : 'gebruiker') + ' · geldig tot ' + INVITE_UNTIL + '</span></span>' +
        '<span class="chip chip--pending">Uitgenodigd</span>' +
      '</div>' +
      '<div class="in-uacts">' +
        userAction('invite-resend', inv, 'sync', 'Opnieuw sturen', '7 dagen geldig') +
        userAction('invite-revoke', inv, 'close', 'Uitnodiging intrekken', '', 'neg') +
      '</div>' +
    '</article>';
  }

  function gebruikers() {
    if (!isAdmin()) return note('lock', 'Alleen beheerders zien de gebruikers.');
    return st.users.map(userCard).join('') + st.invites.map(inviteCard).join('') +
      '<button type="button" class="btn btn--dashed btn--block only-phone in-invite' + anim('anim-in', 120) + '" data-action="invite" data-key="invite-p"' + saveAttr() + '>' +
        icon('plus', 16, 2.6) + 'Gebruiker uitnodigen</button>' +
      '<div class="in-notes' + anim('anim-in', 150) + '">' +
        note('shield', '<strong>Een beheerder beheert alleen gebruikers.</strong> Je ziet nooit de rekeningen van een andere gebruiker.') +
        note('lock', 'Kan geen enkele beheerder nog inloggen? Gebruik dan "Beheerder herstellen" in de instellingen van de Saldo-add-on in Home Assistant.') +
      '</div>';
  }

  // ---------- Gegevens exporteren ----------

  function gegevens() {
    const e = st.exp;
    const accs = empty ? [] : D.accounts.map((a) => D.account(a.id));
    const fmts = Object.keys(FORMATS).map((k) => ({ id: k, label: FORMATS[k].label }));
    return '<section class="in-card' + anim('anim-in', 60) + '" aria-labelledby="in-exp-what">' +
        '<h3 class="in-card-title" id="in-exp-what">Wat zit erin</h3>' +
        '<div class="in-parts">' + PARTS.map((p) =>
          '<label class="in-part"><input type="checkbox" data-input="part" data-part="' + p[0] + '" data-key="part-' + p[0] + '"' + (e.parts[p[0]] ? ' checked' : '') + '>' +
            '<span class="in-part-text"><span class="in-part-name">' + p[1] + '</span><span class="in-part-sub">' + p[2] + '</span></span></label>').join('') + '</div>' +
      '</section>' +
      '<section class="in-card' + anim('anim-in', 90) + '" aria-labelledby="in-exp-acc">' +
        '<span class="in-card-text"><h3 class="in-card-title" id="in-exp-acc">Welke rekeningen</h3>' +
        '<span class="in-card-sub">Alleen je eigen rekeningen, ook de gedeelde rekeningen waar je lid van bent. Rekeningen van andere gebruikers zitten er nooit in.</span></span>' +
        (accs.length
          ? '<div class="in-accs">' + accs.map((a) => '<span class="in-acc"><i style="background:var(--a-' + a.color + ')"></i>' + esc(a.name) + '</span>').join('') + '</div>'
          : '<p class="in-quiet">Je hebt nog geen rekeningen. De export bevat dan alleen categorieën en regels.</p>') +
      '</section>' +
      '<section class="in-card' + anim('anim-in', 120) + '" aria-labelledby="in-exp-fmt">' +
        '<h3 class="in-card-title" id="in-exp-fmt">Formaat</h3>' +
        seg('Formaat', fmts, 'fmt', e.fmt) +
        '<span class="in-help">' + FORMATS[e.fmt].help + '</span>' +
      '</section>' +
      '<button type="button" class="in-btn in-btn--primary in-btn--block' + (e.busy ? ' in-spin' : '') + anim('anim-in', 150) + '" data-action="export" data-key="export"' + saveAttr() + (e.busy ? ' aria-busy="true"' : '') + '>' +
        icon(e.busy ? 'sync' : 'download', 18, 2.2) + (e.busy ? 'Export maken…' : 'Exporteren als ' + FORMATS[e.fmt].label) + '</button>' +
      '<div class="' + anim('anim-in', 180).replace(/^ /, '') + '">' +
        note('clock', 'Elke export komt in het logboek: wie, wanneer en welk formaat.' + (e.last ? ' Je laatste export: ' + esc(e.last) + '.' : '')) + '</div>';
  }

  // ---------- Over Saldo ----------

  function over() {
    return '<section class="in-card' + anim('anim-in', 60) + '" aria-labelledby="in-about-t">' +
        '<div class="in-about-head">' + S.icons.logo(56) +
          '<span class="in-card-text"><h3 class="in-about-name" id="in-about-t">Saldo</h3><span class="in-card-sub">Weet vandaag hoe je maand eindigt.</span></span></div>' +
        '<dl class="in-kv">' +
          kv('Versie', '<span class="mono">0.1</span> · mockup') +
          kv('Draait op', 'Je eigen Home Assistant, als add-on') +
          kv('Adres', '<span class="mono in-mono">saldo.jouw-domein.be</span>') +
          kv('Laatste synchronisatie', empty ? 'Nog geen' : esc(D.lastSync)) +
        '</dl>' +
      '</section>' +
      '<section class="in-card' + anim('anim-in', 90) + '" aria-labelledby="in-data-t">' +
        '<h3 class="in-card-title" id="in-data-t">Je gegevens blijven thuis</h3>' +
        '<p class="in-text">Saldo draait op je eigen Home Assistant. Je gegevens blijven op je eigen server. Saldo praat alleen met Enable Banking (voor je bank), met je mailserver en met de pushdienst van je browser. Geen analytics, geen tracking.</p>' +
      '</section>' +
      '<div class="' + anim('anim-in', 120).replace(/^ /, '') + '">' +
        note('shield', '<strong>Versleutel je back-ups.</strong> Saldo zit in de back-ups van Home Assistant, samen met de sleutels voor je bank. Zet daarom versleuteling aan voor je back-ups: wie een onversleutelde back-up heeft, kan je bankgegevens lezen.', 'warn') +
      '</div>';
  }

  const BODIES = { profiel, toestellen, bank, gebruikers, gegevens, over };

  // ---------- Sheets (bottom sheet on the phone, centred dialog on desktop) ----------

  function sheetActions(cancel, submit) {
    return '<div class="in-actions in-actions--sheet">' + cancel + submit + '</div>';
  }
  const cancelBtn = (label, action) => '<button type="button" class="in-btn in-btn--ghost" data-action="' + (action || 'close') + '" data-key="sh-cancel">' + (label || 'Annuleren') + '</button>';

  function roleField(name, current) {
    return '<fieldset class="in-roles"><legend class="in-label">Rol</legend>' + ROLES.map((r) =>
      '<label class="in-radio"><input type="radio" name="' + name + '" value="' + r.id + '"' + (r.id === current ? ' checked' : '') + ' data-input="role">' +
        '<span class="in-radio-text"><span class="in-radio-name">' + r.label + '</span><span class="in-radio-sub">' + r.sub + '</span></span></label>').join('') +
    '</fieldset>';
  }

  function deviceMini(d) {
    return '<li class="in-mini"><span class="in-device-icon">' + icon(d.kind === 'phone' ? 'phone' : 'laptop', 18, 2) + '</span>' +
      '<span class="in-mini-main"><span class="in-mini-name">' + esc(d.name) + '</span><span class="in-mini-sub">' + (d.last === 'nu' ? 'Nu in gebruik' : 'Laatst gebruikt ' + esc(d.last)) + '</span></span></li>';
  }

  const SHEETS = {
    email(o) {
      if (o.step === 2) {
        return { title: 'Code invullen', sub: 'Gestuurd naar ' + esc(o.email),
          body: '<form class="in-form" data-form="email-code" novalidate>' +
            field('in-code', 'Code uit de e-mail', '<input class="input in-code" id="in-code" inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="0000 0000" value="' + esc(o.code || '') + '" data-input="code" data-key="code" data-autofocus>',
              'De code heeft 8 cijfers, is 10 minuten geldig en werkt één keer.') +
            '<button type="button" class="in-link" data-action="code-resend">Geen code gekregen? Stuur een nieuwe</button>' +
            errorLine(o.error) +
            sheetActions(cancelBtn('Terug', 'email-back'), '<button type="submit" class="in-btn in-btn--primary" data-key="code-ok"' + saveAttr() + '>Bevestigen</button>') +
          '</form>' };
      }
      return { title: 'E-mailadres wijzigen', sub: 'Nu: ' + esc(st.email),
        body: '<form class="in-form" data-form="email-send" novalidate>' +
          userHint() +
          field('in-new-email', 'Nieuw e-mailadres', '<input class="input" type="email" id="in-new-email" autocomplete="email" placeholder="naam@voorbeeld.be" value="' + esc(o.email || '') + '" data-input="new-email" data-key="new-email" data-autofocus>') +
          field('in-email-pw', 'Huidig wachtwoord', '<input class="input" type="password" id="in-email-pw" autocomplete="current-password" value="' + esc(o.pw || '') + '" data-input="email-pw" data-key="email-pw">') +
          '<p class="in-help">We sturen een code van 8 cijfers naar het nieuwe adres. Pas als je die invult, verandert je e-mailadres. Je huidige adres krijgt daarna een bericht.</p>' +
          errorLine(o.error) +
          sheetActions(cancelBtn(), '<button type="submit" class="in-btn in-btn--primary" data-key="email-send"' + saveAttr() + '>Code sturen</button>') +
        '</form>' };
    },

    device(o) {
      const d = st.devices.find((x) => x.id === o.id);
      return { title: esc(d.name) + ' afmelden?',
        body: '<p class="in-text">' + (d.me
          ? 'Je wordt op dit toestel afgemeld. Daarna log je opnieuw in met je wachtwoord en een e-mailcode.'
          : 'Dit toestel moet daarna opnieuw inloggen met je wachtwoord en een e-mailcode.') + '</p>' +
          '<ul class="in-minis">' + deviceMini(d) + '</ul>' +
          sheetActions(cancelBtn(), '<button type="button" class="in-btn in-btn--danger" data-action="device-confirm" data-key="device-confirm"' + saveAttr() + '>Afmelden</button>') };
    },

    devices() {
      const others = st.devices.filter((d) => !d.me);
      return { title: 'Overal afmelden behalve hier?',
        body: '<p class="in-text">Deze toestellen moeten daarna opnieuw inloggen met je wachtwoord en een e-mailcode:</p>' +
          '<ul class="in-minis">' + others.map(deviceMini).join('') + '</ul>' +
          sheetActions(cancelBtn(), '<button type="button" class="in-btn in-btn--danger" data-action="devices-confirm" data-key="devices-confirm"' + saveAttr() + '>' +
            (others.length === 1 ? '1 toestel afmelden' : others.length + ' toestellen afmelden') + '</button>') };
    },

    invite(o) {
      return { title: 'Gebruiker uitnodigen', sub: 'Er gaat een e-mail met een link naar dit adres',
        body: '<form class="in-form" data-form="invite" novalidate>' +
          field('in-inv-email', 'E-mailadres', '<input class="input" type="email" id="in-inv-email" autocomplete="off" placeholder="naam@voorbeeld.be" value="' + esc(o.email || '') + '" data-input="inv-email" data-key="inv-email" data-autofocus>') +
          roleField('in-inv-role', o.role) +
          '<p class="in-help">De link is 7 dagen geldig en werkt één keer. Daarmee kiest de nieuwe gebruiker een wachtwoord. Daarna ziet die alleen de rekeningen die hij of zij zelf toevoegt.</p>' +
          errorLine(o.error) +
          sheetActions(cancelBtn(), '<button type="submit" class="in-btn in-btn--primary" data-key="invite-send"' + saveAttr() + '>Uitnodiging versturen</button>') +
        '</form>' };
    },

    role(o) {
      const u = st.users.find((x) => x.id === o.id);
      return { title: 'Rol van ' + esc(u.name), sub: esc(u.email),
        body: '<form class="in-form" data-form="role" novalidate>' + roleField('in-role', o.role) +
          '<p class="in-help">Een beheerder ziet nooit de rekeningen van een andere gebruiker, ook niet na deze wijziging.</p>' +
          sheetActions(cancelBtn(), '<button type="submit" class="in-btn in-btn--primary" data-key="role-save"' + saveAttr() + '>Opslaan</button>') +
        '</form>' };
    },

    remove(o) {
      const u = st.users.find((x) => x.id === o.id);
      const n = esc(u.name);
      // Only shared accounts the admin is a member of too may be named here (analysis/concepts/user-and-visibility.md).
      const shared = Object.keys(D.members).filter((id) => D.members[id].some((m) => m.who === u.name) && D.members[id].some((m) => m.me)).map((id) => D.account(id));
      const match = (o.typed || '').trim().toLowerCase() === u.name.toLowerCase();
      const items = [
        ['logout', 'De login van ' + n + ' verdwijnt. ' + n + ' wordt op alle toestellen afgemeld.'],
        ['trash', 'De persoonlijke en handmatige rekeningen van ' + n + ' worden verwijderd, met hun transacties, regels en planning.'],
        ['people', 'Gedeelde rekeningen blijven bestaan voor de andere leden. Was ' + n + ' er beheerder van, dan gaat die rol naar het lid dat er het langst bij is.'],
        ['key', 'De bankkoppelingen en de Enable Banking-sleutel van ' + n + ' worden verwijderd.']
      ];
      return { title: n + ' verwijderen?', sub: esc(u.email),
        body: '<p class="in-text">Dit kan je niet ongedaan maken. Dit gebeurt er:</p>' +
          '<ul class="in-explain in-explain--neg">' + items.map((e) => '<li><span class="in-explain-icon">' + icon(e[0], 16, 2.2) + '</span><span>' + e[1] + '</span></li>').join('') + '</ul>' +
          (shared.length
            ? '<p class="in-shared">Jij en ' + n + ' delen ' + shared.map((a) => '<span class="in-acc"><i style="background:var(--a-' + a.color + ')"></i>' + esc(a.name) + '</span>').join(', ') +
              '. Die blijft voor jou bestaan en synchroniseert verder via jouw koppeling.</p>'
            : '') +
          '<p class="in-help">Tip: laat ' + n + ' eerst zelf een export maken onder Instellingen → Gegevens exporteren.</p>' +
          '<form class="in-form" data-form="remove" novalidate>' +
            field('in-typed', 'Typ ' + n + ' om te bevestigen', '<input class="input" id="in-typed" autocomplete="off" spellcheck="false" value="' + esc(o.typed || '') + '" data-input="typed" data-key="typed">') +
            sheetActions(cancelBtn(), '<button type="submit" class="in-btn in-btn--danger" data-bind="remove-btn" data-key="remove-ok"' + (match ? '' : ' disabled') + saveAttr() + '>' + n + ' verwijderen</button>') +
          '</form>' };
    }
  };

  function sheetHtml() {
    const c = SHEETS[overlay.kind](overlay);
    return '<div class="sheet-grip" aria-hidden="true"></div>' +
      '<div class="in-sh-head"><span class="in-sh-title"><span id="in-sh-t">' + c.title + '</span>' + (c.sub ? '<small>' + c.sub + '</small>' : '') + '</span>' +
        '<button type="button" class="in-close" aria-label="Sluiten" data-action="close" data-key="sh-close">' + icon('close', 18, 2.4) + '</button></div>' +
      c.body;
  }

  function paintSheet(focus) {
    const sh = document.querySelector('.in-sheet');
    if (!sh) return;
    sh.innerHTML = sheetHtml();
    if (focus) {
      const f = sh.querySelector(focus === true ? '[data-autofocus]' : '[data-key="' + focus + '"]') || sh.querySelector('[data-key="sh-close"]');
      if (f) f.focus();
    }
  }

  function openSheet(o, fromKey) {
    overlay = o;
    returnKey = fromKey || returnKey;
    if (!document.querySelector('.in-backdrop')) {
      const wrap = document.createElement('div');
      wrap.className = 'sheet-backdrop in-backdrop';
      wrap.innerHTML = '<div class="sheet in-sheet" role="dialog" aria-modal="true" aria-labelledby="in-sh-t"></div>';
      document.body.appendChild(wrap);
      wire(wrap.querySelector('.in-sheet'));
      wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheet(); });
    }
    paintSheet(true);
  }

  function closeSheet(keepHash) {
    const wrap = document.querySelector('.in-backdrop');
    if (wrap) wrap.remove();
    overlay = null;
    if (!keepHash) settle();
    const key = returnKey;
    returnKey = null;
    if (key) {
      const el = page.querySelector('[data-key="' + key + '"]');
      if (el && el.getClientRects().length) el.focus();
    }
  }

  // ---------- Routing ----------

  function parse() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (section(h)) return { section: h, sub: null };
    if (SUBS[h]) return { section: SUBS[h], sub: h };
    return { section: null, sub: null };
  }

  // Put a deep-linked step on screen. Demo values are filled in only when the page opens on the link.
  function applySub(sub, first) {
    overlay = null;
    if (sub === 'wachtwoord') {
      st.pwOpen = true;
      st.pw = first ? { cur: 'mijn-huidige-wachtwoord', next: 'wachtwoord123', rep: '' } : { cur: '', next: '', rep: '' };
    } else if (sub === 'email-wijzigen') overlay = { kind: 'email', step: 1 };
    else if (sub === 'email-code') overlay = { kind: 'email', step: 2, email: NEW_EMAIL };
    else if (sub === 'toestel-afmelden' && st.devices.some((d) => d.id === 'd3')) overlay = { kind: 'device', id: 'd3' };
    else if (sub === 'overal-afmelden' && st.devices.length > 1) overlay = { kind: 'devices' };
    else if (sub === 'bank-uitleg') st.bank.howto = true;
    else if (sub === 'bank-sleutel' && st.bank.configured) st.bank.replacing = true;
    else if (sub === 'gebruiker-uitnodigen' && isAdmin()) overlay = { kind: 'invite', role: 'user' };
    else if (sub === 'gebruiker-rol' && st.users.some((u) => u.id === 'partner')) overlay = { kind: 'role', id: 'partner', role: 'user' };
    else if (sub === 'gebruiker-verwijderen' && st.users.some((u) => u.id === 'partner')) overlay = { kind: 'remove', id: 'partner' };
  }

  // After a deep-linked step is done or cancelled, the URL goes back to its section.
  function settle() {
    if (!cur.sub) return;
    cur.sub = null;
    history.replaceState(null, '', '#' + cur.section);
  }

  function onHash() {
    closeSheet(true);
    cur = parse();
    applySub(cur.sub, false);
    flip = true;
    paint();
    window.scrollTo(0, 0);
    const h1 = page.querySelector('#in-h1');
    if (h1) h1.focus({ preventScroll: true });
    if (overlay) openSheet(overlay);
  }

  // ---------- Painting ----------

  function paint() {
    const active = cur.section && (!section(cur.section).admin || isAdmin()) ? cur.section : null;
    const s = section(active || 'profiel');
    page.innerHTML = header() +
      '<div class="in-layout' + (active ? '' : ' in-layout--index') + '">' +
        deskNav(s.id) +
        phoneIndex() +
        '<div class="in-content' + (flip ? ' anim-fade' : '') + '" id="in-content">' + sectionHead(s) + BODIES[s.id]() + '</div>' +
      '</div>';
    painted = true;
    flip = false;
  }

  // Re-render while keeping keyboard focus on the same control
  function refresh(focusKey) {
    const a = document.activeElement;
    const key = focusKey || (a && a.dataset ? a.dataset.key : null);
    paint();
    if (key) {
      const el = page.querySelector('[data-key="' + key + '"]');
      if (el && el.getClientRects().length) el.focus();
    }
  }

  // ---------- Actions ----------

  const later = (fn, ms) => setTimeout(fn, ms);

  function bankTest() {
    const b = st.bank;
    if (b.testing) return;
    b.testing = true;
    refresh();
    S.shell.progress(true);
    later(() => {
      b.testing = false;
      b.tested = 'zojuist';
      S.shell.progress(false);
      refresh();
      S.shell.toast(demo === 'fout' ? 'Enable Banking werkt · sync mislukt' : 'Verbinding met Enable Banking werkt');
    }, 1300);
  }

  function doExport() {
    const e = st.exp;
    if (e.busy) return;
    if (!PARTS.some((p) => e.parts[p[0]])) { S.shell.toast('Kies minstens één onderdeel'); return; }
    e.busy = true;
    refresh();
    S.shell.progress(true);
    later(() => {
      e.busy = false;
      e.last = 'vandaag, ' + FORMATS[e.fmt].label;
      S.shell.progress(false);
      refresh();
      S.shell.toast(FORMATS[e.fmt].file + ' klaar (mockup)');
    }, 1200);
  }

  function onClick(e) {
    const blocked = e.target.closest('[data-offline]');
    if (blocked) {
      e.preventDefault();
      S.shell.toast('Je bent offline');
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const act = el.dataset.action;
    const key = el.dataset.key;
    const id = el.dataset.id;

    if (act === 'close') closeSheet();
    else if (act === 'name-save') {
      const v = page.querySelector('#in-name').value.trim();
      st.name = v || st.name;
      refresh();
      S.shell.toast('Naam opgeslagen');
    } else if (act === 'email-change') openSheet({ kind: 'email', step: 1 }, key);
    else if (act === 'email-back') { overlay.step = 1; overlay.error = ''; paintSheet(true); }
    else if (act === 'code-resend') S.shell.toast('Nieuwe code verstuurd');
    else if (act === 'pw-toggle') {
      st.pwOpen = !st.pwOpen;
      st.pw = { cur: '', next: '', rep: '' };
      st.pwError = '';
      settle();
      refresh(st.pwOpen ? 'pw-cur' : 'pw-toggle');
    } else if (act === 'pw-show') {
      st.pwShow = !st.pwShow;
      el.setAttribute('aria-pressed', st.pwShow);
      ['#in-pw-new', '#in-pw-rep'].forEach((s) => { page.querySelector(s).type = st.pwShow ? 'text' : 'password'; });
    } else if (act === 'device-out') openSheet({ kind: 'device', id }, key);
    else if (act === 'devices-out') openSheet({ kind: 'devices' }, key);
    else if (act === 'device-confirm') {
      const d = st.devices.find((x) => x.id === overlay.id);
      if (d.me) { location.href = 'inloggen.html'; return; }
      st.devices = st.devices.filter((x) => x !== d);
      returnKey = 'devices-out';
      closeSheet();
      refresh();
      S.shell.toast(d.name + ' afgemeld');
    } else if (act === 'devices-confirm') {
      const n = st.devices.filter((d) => !d.me).length;
      st.devices = st.devices.filter((d) => d.me);
      returnKey = null;
      closeSheet();
      refresh();
      S.shell.toast(n === 1 ? '1 toestel afgemeld' : n + ' toestellen afgemeld');
    } else if (act === 'copy') {
      try { navigator.clipboard.writeText(REDIRECT); } catch (err) { /* mockup: the toast is enough */ }
      S.shell.toast('Redirect-URL gekopieerd');
    } else if (act === 'eb-open') S.shell.toast('Opent enablebanking.com (mockup)');
    else if (act === 'howto') {
      st.bank.howto = !st.bank.howto;
      settle();
      refresh();
    } else if (act === 'bank-test') bankTest();
    else if (act === 'bank-replace') {
      Object.assign(st.bank, { replacing: true, file: null, appId: '', error: '', justSet: false });
      refresh('pem');
    } else if (act === 'bank-cancel') {
      Object.assign(st.bank, { replacing: false, file: null, appId: '', error: '' });
      settle();
      refresh('bank-replace');
    } else if (act === 'invite') openSheet({ kind: 'invite', role: 'user' }, key);
    else if (act === 'user-reset') S.shell.toast('Wachtwoordlink verstuurd · 1 uur geldig');
    else if (act === 'user-role') openSheet({ kind: 'role', id, role: st.users.find((u) => u.id === id).role }, key);
    else if (act === 'user-delete') openSheet({ kind: 'remove', id }, key);
    else if (act === 'invite-resend') S.shell.toast('Uitnodiging opnieuw verstuurd');
    else if (act === 'invite-revoke') {
      st.invites = st.invites.filter((i) => i.id !== id);
      refresh();
      S.shell.toast('Uitnodiging ingetrokken');
    } else if (act === 'fmt') {
      st.exp.fmt = el.dataset.value;
      refresh();
    } else if (act === 'export') doExport();
  }

  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

  function onSubmit(e) {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    if (offline) { S.shell.toast('Je bent offline'); return; }
    const kind = form.dataset.form;

    if (kind === 'pw') {
      const p = st.pw;
      const c = pwChecks();
      st.pwError = !p.cur ? 'Vul je huidige wachtwoord in.'
        : (c.len !== 'ok' ? 'Je nieuwe wachtwoord moet minstens ' + MIN_PW + ' tekens hebben.'
        : (c.block !== 'ok' ? 'Kies een wachtwoord dat niet in de lijst van veelgebruikte wachtwoorden staat.'
        : (c.match !== 'ok' ? 'Herhaal je nieuwe wachtwoord precies hetzelfde.' : '')));
      if (st.pwError) { refresh('pw-save'); return; }
      st.pwOpen = false;
      st.pw = { cur: '', next: '', rep: '' };
      st.pwChanged = 'vandaag';
      st.devices = st.devices.filter((d) => d.me);
      settle();
      refresh('pw-toggle');
      S.shell.toast('Wachtwoord gewijzigd');
    } else if (kind === 'email-send') {
      const v = (overlay.email || '').trim();
      overlay.error = !validEmail(v) ? 'Vul een geldig e-mailadres in.'
        : (v.toLowerCase() === st.email ? 'Dat is al je e-mailadres.'
        : (!overlay.pw ? 'Vul je huidige wachtwoord in.' : ''));
      if (overlay.error) { paintSheet('email-send'); return; }
      Object.assign(overlay, { step: 2, email: v, code: '', error: '' });
      paintSheet(true);
      S.shell.toast('Code verstuurd');
    } else if (kind === 'email-code') {
      if ((overlay.code || '').replace(/\D/g, '').length !== 8) { overlay.error = 'Vul de 8 cijfers uit de e-mail in.'; paintSheet('code'); return; }
      st.email = overlay.email;
      returnKey = 'email-change';
      closeSheet();
      refresh();
      S.shell.toast('E-mailadres gewijzigd');
    } else if (kind === 'bank') {
      const b = st.bank;
      b.error = !b.file && !b.replacing ? 'Kies eerst je .pem-bestand.'
        : (b.replacing && !b.file ? 'Kies de nieuwe sleutel.'
        : (!b.replacing && !b.appId.trim() ? 'Vul je application ID in.' : ''));
      if (b.error) { refresh('bank-save'); return; }
      const first = !b.configured;
      Object.assign(b, { configured: true, replacing: false, file: null, appId: '', uploaded: '18 november 2026', justSet: first, testing: true });
      settle();
      refresh('bank-test');
      S.shell.progress(true);
      later(() => {
        b.testing = false;
        b.tested = 'zojuist';
        S.shell.progress(false);
        refresh();
        S.shell.toast(first ? 'Opgeslagen · verbinding werkt' : 'Sleutel vervangen · verbinding werkt');
      }, 1300);
    } else if (kind === 'invite') {
      const v = (overlay.email || '').trim().toLowerCase();
      overlay.error = !validEmail(v) ? 'Vul een geldig e-mailadres in.'
        : (st.users.some((u) => u.email === v) ? 'Er is al een gebruiker met dit e-mailadres.'
        : (st.invites.some((i) => i.email === v) ? 'Dit adres is al uitgenodigd.' : ''));
      if (overlay.error) { paintSheet('invite-send'); return; }
      st.invites.push({ id: 'inv' + Date.now(), email: v, role: overlay.role });
      returnKey = null;
      closeSheet();
      refresh();
      S.shell.toast('Uitnodiging verstuurd · 7 dagen geldig');
    } else if (kind === 'role') {
      const u = st.users.find((x) => x.id === overlay.id);
      const changed = u.role !== overlay.role;
      u.role = overlay.role;
      closeSheet();
      refresh();
      if (changed) S.shell.toast(u.name + ' is nu ' + (u.role === 'admin' ? 'beheerder' : 'gebruiker'));
    } else if (kind === 'remove') {
      const u = st.users.find((x) => x.id === overlay.id);
      if ((overlay.typed || '').trim().toLowerCase() !== u.name.toLowerCase()) return;
      st.users = st.users.filter((x) => x !== u);
      returnKey = null;
      closeSheet();
      refresh();
      S.shell.toast(u.name + ' verwijderd');
    }
  }

  // Live edits without re-rendering, so the caret stays put
  function onInput(e) {
    const el = e.target;
    const k = el.dataset.input;
    if (!k) return;
    if (k === 'name') {
      page.querySelectorAll('[data-bind="name"]').forEach((n) => { n.textContent = el.value || st.name; });
      page.querySelectorAll('[data-bind="initial"]').forEach((n) => { n.textContent = initial(el.value || st.name); });
    } else if (k === 'pw-cur' || k === 'pw-new' || k === 'pw-rep') {
      st.pw[{ 'pw-cur': 'cur', 'pw-new': 'next', 'pw-rep': 'rep' }[k]] = el.value;
      page.querySelector('[data-bind="pw-checks"]').innerHTML = pwChecksHtml();
      page.querySelector('[data-bind="pw-block"]').hidden = pwChecks().block !== 'bad';
    } else if (k === 'new-email' || k === 'inv-email') overlay.email = el.value;
    else if (k === 'email-pw') overlay.pw = el.value;
    else if (k === 'code') {
      const d = el.value.replace(/\D/g, '').slice(0, 8);
      el.value = d.length > 4 ? d.slice(0, 4) + ' ' + d.slice(4) : d;
      overlay.code = el.value;
    } else if (k === 'role') overlay.role = el.value;
    else if (k === 'typed') {
      overlay.typed = el.value;
      const u = st.users.find((x) => x.id === overlay.id);
      const btn = document.querySelector('[data-bind="remove-btn"]');
      if (btn) btn.disabled = el.value.trim().toLowerCase() !== u.name.toLowerCase();
    } else if (k === 'appid') st.bank.appId = el.value;
    else if (k === 'pem' && e.type === 'change') {
      const f = el.files && el.files[0];
      if (!f) return;
      st.bank.file = { name: f.name, size: (f.size / 1024).toFixed(1).replace('.', ',') + ' kB' };
      st.bank.error = '';
      refresh('pem');
    } else if (k === 'part' && e.type === 'change') st.exp.parts[el.dataset.part] = el.checked;
  }

  function wire(root) {
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
  }

  // ---------- Screen ----------

  function render(p) {
    page = p;
    if (!page.dataset.inWired) {
      page.dataset.inWired = '1';
      demo = D.demo();
      offline = demo === 'offline';
      empty = demo === 'leeg';
      st.bank.configured = !empty;
      wire(page);
      window.addEventListener('hashchange', onHash);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay) closeSheet(); });
      cur = parse();
      applySub(cur.sub, true);
    }
    paint();
    if (overlay && !document.querySelector('.in-backdrop')) openSheet(overlay);
  }

  S.screens = S.screens || {};
  S.screens.instellingen = { title: 'Instellingen', render };
})(window.Saldo = window.Saldo || {});
