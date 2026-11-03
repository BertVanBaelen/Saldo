// Bankkoppelingen: the viewer's bank connections, and the wizard to link a bank or re-authorise.
// No design board: designed in the mockup in the style of Rekeningen and Meldingen.
// Spec: analysis/screens/bank-koppelen.md · concepts bank-connection.md, shared-account.md.
// Phone: sub page with a back chevron to Meer; the wizard is a full page per step with a step bar.
// Desktop: a centred column; the wizard is a centred card. Every step and state has a deep link:
// #gestopt, #verwijderen, #nieuw, #nieuw-<step>, #opnieuw, #opnieuw-<step>. ?als=partner shows the wizard
// as Partner, who links the shared account that Bert already manages (the "aansluiten" story).
(function (S) {
  'use strict';

  const { eur, esc } = S.fmt;
  const icon = S.icon;
  const D = S.data;

  S.icons.paths.bkCopy = '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"></path>';

  // ---------- Demo values (screen only) ----------

  const NEW_UNTIL = '17 mei 2027'; // a new consent: 180 days after Wednesday 18 November 2026
  const CALLBACK = 'https://saldo.jouw-domein.be/api/bank/callback';
  const OTHER_BANKS = ['KBC', 'BNP Paribas Fortis', 'Belfius', 'ING'];

  // Accounts Argenta returns after consent (current accounts only: Argenta exposes no savings).
  // `acc` = the Saldo account with the same IBAN. `tx` / `from` = history of the first sync (strategy longest).
  // `missed` = transactions fetched after a re-authorisation.
  const RETURNED = {
    b68: { iban: 'BE68 •••• •••• 4821', holder: 'Bert', acc: 'zicht', tx: 862, from: '3 maart 2025', missed: 2 },
    b12: { iban: 'BE12 •••• •••• 7730', holder: 'Bert en Partner', acc: 'gedeeld', tx: 422, from: '3 maart 2025', missed: 0 },
    b53: { iban: 'BE53 •••• •••• 0915', holder: 'Bert', name: 'Zichtrekening 0915', color: 'blue', icon: 'card', tx: 96, from: '3 maart 2025', balance: 31240 },
    p71: { iban: 'BE71 •••• •••• 5038', holder: 'Partner', name: 'Zichtrekening', color: 'teal', icon: 'card', tx: 1037, from: '5 maart 2025', balance: 210455 }
  };

  // Month names the first sync walks back through, from now to the oldest history Argenta gives.
  const MONTHS_BACK = (() => {
    const out = [];
    let y = 2026;
    let m = 10;
    while (y > 2025 || m >= 2) {
      out.push(S.fmt.MONTHS[m] + ' ' + y);
      m -= 1;
      if (m < 0) { m = 11; y -= 1; }
    }
    return out;
  })();

  // Wizard steps per mode (first = the bare #nieuw / #opnieuw link) and the step bar.
  const STEPS = {
    nieuw: ['start', 'bank', 'uitleg', 'doorsturen', 'rekeningen', 'aansluiten', 'sync', 'klaar', 'geannuleerd', 'verlopen'],
    opnieuw: ['uitleg', 'doorsturen', 'rekeningen', 'sync', 'klaar', 'geannuleerd', 'verlopen']
  };
  const BAR = {
    nieuw: { labels: ['Bank', 'Toestemming', 'Rekeningen', 'Ophalen'],
      at: { start: -1, bank: 0, uitleg: 1, doorsturen: 1, geannuleerd: 1, verlopen: 1, rekeningen: 2, aansluiten: 2, sync: 3, klaar: 4 } },
    opnieuw: { labels: ['Toestemming', 'Rekeningen', 'Ophalen'],
      at: { uitleg: 0, doorsturen: 0, geannuleerd: 0, verlopen: 0, rekeningen: 1, sync: 2, klaar: 3 } }
  };

  // ---------- State ----------

  let page = null;
  let flowHash = null;              // hash reached through the wizard's own buttons: starts the simulations
  let picked = null;                // { key, set } accounts ticked on the Rekeningen step
  let joined = true;                // Partner chose "Aansluiten"
  let renewed = false;              // consent renewed during this visit (after #opnieuw-klaar)
  let manual = { busy: false, done: false }; // "Nu synchroniseren"
  let retrying = false;             // "Opnieuw proberen" in state fout
  let sim = null;                   // first-sync progress per row
  let timers = [];

  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  function stopTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (manual.busy || retrying) S.shell.progress(false);
    manual.busy = false;
    retrying = false;
  }

  function ctx() {
    const demo = D.demo();
    return { demo, setUp: demo !== 'leeg', linked: demo !== 'leeg', offline: demo === 'offline', lezen: demo === 'lezen' };
  }

  // ---------- Routing ----------

  function parse() {
    const h = location.hash.replace(/^#/, '');
    if (h === 'gestopt') return { view: 'list', variant: 'gestopt' };
    if (h === 'verwijderen') return { view: 'list', remove: true };
    const m = /^(nieuw|opnieuw)(?:-([a-z]+))?$/.exec(h);
    if (!m) return { view: 'list' };
    const mode = m[1];
    const step = STEPS[mode].indexOf(m[2]) >= 0 ? m[2] : STEPS[mode][0];
    return { view: 'wizard', mode, step };
  }

  const hashFor = (mode, step) => (step === STEPS[mode][0] ? '#' + mode : '#' + mode + '-' + step);
  const partnerParam = () => new URLSearchParams(location.search).get('als') === 'partner';
  const isPartner = (r) => r.view === 'wizard' && r.mode === 'nieuw' && (partnerParam() || r.step === 'aansluiten');
  // Leaving the wizard: Partner's view reloads the page without ?als=partner, Bert's stays in this page.
  const exitHref = (partner) => (partner ? 'bankkoppelingen.html' : '#');

  function go(hash, viaFlow) {
    flowHash = viaFlow ? hash : null;
    if ((location.hash || '#') === (hash || '#')) onRoute(false);
    else location.hash = hash;
  }

  // ---------- Small pieces ----------

  const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const accBg = (color) => 'var(--a-' + color + ')';

  function acct(id) {
    const r = RETURNED[id];
    const a = r.acc ? D.account(r.acc) : null;
    return Object.assign({ id }, r, a ? { name: a.name, color: a.color, icon: a.icon, balance: a.balance } : {});
  }

  function accIcon(a, size, isNew) {
    if (isNew) return '<span class="bk-acc-icon bk-acc-icon--new">' + icon(a.icon, size, 2.2) + '</span>';
    return '<span class="bk-acc-icon" style="background:' + accBg(a.color) + '">' + icon(a.icon, size, 2.2) + '</span>';
  }

  function chip(tone, text, ic) {
    return '<span class="bk-chip bk-chip--' + tone + '">' + (ic ? icon(ic, 13, 2.6) : '') + esc(text) + '</span>';
  }

  // Button or link. o: kind, href, action, flow, net (needs the server: disabled offline), disabled, icon, after, key, cls
  function btn(label, o) {
    o = o || {};
    const off = (o.net && ctx().offline) || o.disabled;
    const cls = 'bk-btn bk-btn--' + (o.kind || 'ghost') + (o.cls ? ' ' + o.cls : '');
    const inner = (o.icon ? icon(o.icon, 18, 2.4) : '') + '<span>' + esc(label) + '</span>' + (o.after ? icon(o.after, 16, 2.4) : '');
    const key = o.key ? ' data-key="' + o.key + '"' : '';
    if (o.href && !off) return '<a class="' + cls + '" href="' + o.href + '"' + (o.flow ? ' data-flow' : '') + key + '>' + inner + '</a>';
    return '<button type="button" class="' + cls + '"' + (o.action ? ' data-action="' + o.action + '"' : '') + key + (off ? ' disabled' : '') + '>' + inner + '</button>';
  }

  const h1 = (text) => '<h1 class="bk-h1" tabindex="-1">' + esc(text) + '</h1>';
  const lead = (html) => '<p class="bk-lead">' + html + '</p>';
  const subLabel = (text) => '<h2 class="label bk-sub">' + esc(text) + '</h2>';

  // Row with an icon, a bold title and a line of text (text is HTML, escaped by the caller)
  function item(ic, title, text, tone) {
    return '<li class="bk-item"><span class="bk-item-icon bk-item-icon--' + (tone || 'muted') + '">' + ic + '</span>' +
      '<span class="bk-item-text"><strong>' + esc(title) + '</strong><span>' + text + '</span></span></li>';
  }

  function tip(ic, html) {
    return '<p class="bk-tip">' + icon(ic, 18, 2.2) + '<span>' + html + '</span></p>';
  }

  function notice(tone, ic, title, text, extra) {
    return '<div class="bk-notice bk-notice--' + tone + '">' +
      '<span class="bk-notice-icon">' + icon(ic, 17, 2.2) + '</span>' +
      '<span class="bk-notice-text"><strong>' + esc(title) + '</strong>' + (text ? '<span>' + esc(text) + '</span>' : '') + (extra || '') + '</span>' +
    '</div>';
  }

  function offlineLine(text) {
    return '<p class="bk-offline">' + icon('cloudOff', 16, 2.2) + '<span>' + esc(text) + '</span></p>';
  }

  // ---------- List: own connections ----------

  function variantOf(r, c) {
    if (r.variant === 'gestopt') return 'gestopt';
    if (c.demo === 'fout') return 'fout';
    if (c.demo === 'verouderd') return 'verouderd';
    return 'ok';
  }

  function myCard(conn, v, c, A) {
    const fresh = manual.done;
    const busy = manual.busy;
    const stale = v === 'verouderd' && !fresh;
    const failed = v === 'fout';
    const stopped = v === 'gestopt';
    const days = renewed ? 180 : conn.daysLeft;
    const until = renewed ? NEW_UNTIL : conn.validUntil;
    const warnConsent = !stopped && days < 14;

    const head = stopped ? chip('neg', 'Gestopt') : failed ? chip('neg', 'Mislukt') : stale ? chip('warn', 'Verouderd')
      : warnConsent ? chip('warn', 'Nog ' + days + ' dagen') : chip('ok', 'Actief');

    const status = (a) => {
      if (busy || retrying) return chip('muted', 'Bezig…');
      if (stopped) return a.group === 'ged' ? chip('shared', 'Via Partner') : chip('neg', 'Gestopt');
      if (failed) return chip('neg', 'Niet bijgewerkt');
      if (stale) return chip('warn', '3 dagen oud');
      return chip('ok', fresh ? 'Zojuist' : 'Bijgewerkt', 'check');
    };
    const sub = (a) => {
      if (a.group !== 'ged') return '<span class="mono">' + esc(a.iban) + '</span> · persoonlijk';
      const role = stopped ? 'Partner neemt over' : (c.lezen ? 'reservebron' : 'hoofdbron');
      return '<span class="mono">' + esc(a.iban) + '</span> · met ' + esc(D.partner.name) + (c.lezen ? ' (beheerder)' : '') + ' · ' + role;
    };
    const accounts = conn.accounts.map((id) => D.account(id)).map((a) =>
      '<li class="bk-acc">' + accIcon(a, 16) +
        '<span class="bk-acc-main"><span class="bk-acc-name">' + esc(a.name) + '</span><span class="bk-acc-sub">' + sub(a) + '</span></span>' +
        status(a) +
      '</li>').join('');

    let alert = '';
    if (stopped) {
      alert = notice('neg', 'warning', 'Synchronisatie gestopt',
        'De toestemming bij Argenta is verlopen op 30 november. Zichtrekening wordt niet meer bijgewerkt en je planning rekent met het saldo van die dag. De Gedeelde rekening blijft bijgewerkt via de koppeling van ' + D.partner.name + '.');
    } else if (failed) {
      alert = notice('neg', 'warning', 'Argenta antwoordt niet sinds vannacht 04:02.',
        'Saldo probeert het om 10:00 opnieuw. Er gaat niets verloren: je ziet de saldi van gisteren 04:02.',
        btn(retrying ? 'Bezig…' : 'Opnieuw proberen', { kind: 'negline', cls: 'bk-btn--sm', action: 'retry', net: true, disabled: retrying, key: 'retry',
          icon: retrying ? null : 'sync' }));
    } else if (stale) {
      alert = notice('warn', 'clock', 'Niet bijgewerkt sinds zondag',
        'Saldo kon je rekeningen 3 dagen niet bijwerken. Je saldo en je planning kunnen achterlopen.');
    }

    const consent = stopped
      ? fact('clock', 'Toestemming verlopen op 30 november 2026', 'Na het opnieuw autoriseren haalt Saldo de gemiste transacties vanzelf op.', 'neg')
      : warnConsent
        ? notice('warn', 'clock', 'Toestemming tot ' + until + ' · nog ' + days + ' dagen',
          'Banken vragen elke 180 dagen opnieuw toestemming. Bevestig in de Argenta-app, dan loopt alles gewoon door.')
        : fact('clock', 'Toestemming tot ' + until + ' · nog ' + days + ' dagen', 'We herinneren je 14 en 3 dagen vooraf.');

    const last = fresh ? 'zojuist' : stale ? 'zondag 04:02 · 3 dagen geleden' : failed ? 'gisteren 04:02' : stopped ? '30 november 04:02' : conn.lastSync;
    const syncNote = busy ? 'Synchroniseren…' : fresh ? 'Opnieuw kan over een uur: Argenta laat maar een paar opvragingen per dag toe.'
      : failed ? 'Laatste poging vannacht 04:02 mislukt' : 'Elke nacht rond 04:00, vanzelf';
    const canSync = !stopped && !failed;
    const syncBtn = canSync
      ? '<button type="button" class="bk-sync' + (stale ? ' bk-sync--accent' : '') + '" data-action="sync" data-key="sync" aria-label="' +
          (busy ? 'Bezig met synchroniseren' : fresh ? 'Net gesynchroniseerd, opnieuw kan over een uur' : 'Nu synchroniseren') + '"' +
          (busy || fresh || c.offline ? ' disabled' : '') + '>' +
          '<span class="bk-spin' + (busy ? ' is-on' : '') + '">' + icon('sync', 18, 2.2) + '</span><span class="only-desktop">Nu synchroniseren</span></button>'
      : '';
    const syncRow = '<div class="bk-fact' + (stale ? ' bk-fact--warn' : '') + '"><span class="bk-fact-icon">' + icon('sync', 17, 2.2) + '</span>' +
      '<span class="bk-fact-text"><span>Laatst gesynchroniseerd ' + esc(last) + '</span><small>' + esc(syncNote) + '</small></span>' + syncBtn + '</div>';

    const reauthPrimary = warnConsent || stopped;
    const actions = '<div class="bk-actions">' +
      btn('Opnieuw autoriseren', { kind: reauthPrimary ? 'primary' : 'ghost', href: '#opnieuw', flow: true, net: true, icon: 'shield' }) +
      btn('Koppeling verwijderen', { kind: 'danger', href: '#verwijderen', net: true, icon: 'trash' }) +
    '</div>' + (c.offline ? offlineLine('Je bent offline. Synchroniseren, autoriseren en verwijderen kan weer zodra je verbinding hebt.') : '');

    return '<article class="bk-conn' + A('anim-in', 40) + '" aria-labelledby="bk-conn-' + conn.id + '">' +
      '<div class="bk-conn-head">' +
        '<span class="bk-tile">' + icon('bank', 22, 2) + '</span>' +
        '<span class="bk-conn-title"><span class="bk-conn-name" id="bk-conn-' + conn.id + '">' + esc(conn.bank) + '</span>' +
          '<span class="bk-conn-sub">Via je Enable Banking-app ‘' + esc(conn.app) + '’</span></span>' +
        head +
      '</div>' +
      alert +
      '<div class="bk-block"><h3 class="bk-block-title">Leest ' + conn.accounts.length + ' rekeningen</h3><ul class="bk-accs">' + accounts + '</ul></div>' +
      '<div class="bk-facts">' + consent + syncRow +
        fact('link', 'Gekoppeld sinds ' + conn.since, 'Door jou, met je eigen Enable Banking-app') +
      '</div>' +
      actions +
    '</article>';
  }

  function fact(ic, text, small, tone) {
    return '<div class="bk-fact' + (tone ? ' bk-fact--' + tone : '') + '"><span class="bk-fact-icon">' + icon(ic, 17, 2.2) + '</span>' +
      '<span class="bk-fact-text"><span>' + esc(text) + '</span>' + (small ? '<small>' + esc(small) + '</small>' : '') + '</span></div>';
  }

  // ---------- List: other members' connections (read-only) ----------

  function otherCard(conn, v, c, A) {
    const stopped = v === 'gestopt';
    const role = c.lezen ? 'hoofdbron' : 'reserve';
    const until = conn.validUntil.replace(/ \d{4}$/, '');
    const head = stopped ? chip('ok', 'Neemt over') : c.lezen ? chip('shared', 'Hoofdbron') : chip('readonly', 'Reserve');
    const status = v === 'fout' ? chip('neg', 'Mislukt') : chip('ok', 'Bijgewerkt', 'check');
    const note = stopped
      ? 'Jouw toestemming is verlopen. Deze koppeling houdt de Gedeelde rekening nu bij, zonder dubbele transacties.'
      : c.lezen
        ? D.partner.name + ' is beheerder van de Gedeelde rekening. Deze koppeling is de hoofdbron, die van jou de reserve.'
        : 'Verloopt jouw toestemming, dan houdt deze koppeling de Gedeelde rekening bij. Alleen ' + D.partner.name + ' kan ze vernieuwen of verwijderen.';
    const accounts = conn.accounts.map((id) => D.account(id)).map((a) =>
      '<li class="bk-acc">' + accIcon(a, 16) +
        '<span class="bk-acc-main"><span class="bk-acc-name">' + esc(a.name) + '</span><span class="bk-acc-sub"><span class="mono">' + esc(a.iban) + '</span> · ' + (v === 'fout' ? 'poging vannacht 04:05' : 'laatst ' + esc(conn.lastSync)) + '</span></span>' +
        status +
      '</li>').join('');
    return '<article class="bk-conn bk-conn--other' + A('anim-in', 90) + '" aria-label="Koppeling van ' + esc(conn.owner) + '">' +
      '<div class="bk-conn-head">' +
        '<span class="avatar avatar--md" style="background:' + D.partner.tint + '">' + esc(D.partner.initial) + '</span>' +
        '<span class="bk-conn-title"><span class="bk-conn-name bk-conn-name--sm">' + esc(conn.owner) + '</span>' +
          '<span class="bk-conn-sub">' + esc(conn.bank) + ' · ' + role + ' voor Gedeelde rekening · toestemming tot ' + esc(until) + '</span></span>' +
        head +
      '</div>' +
      '<ul class="bk-accs">' + accounts + '</ul>' +
      '<p class="bk-other-note">' + icon('lock', 14, 2.2) + '<span>' + esc(note) + '</span></p>' +
    '</article>';
  }

  // ---------- List: empty state ----------

  function empty(c, A) {
    return '<section class="bk-empty' + A('anim-in', 40) + '" aria-labelledby="bk-empty-title">' +
      '<span class="bk-empty-tile">' + icon('link', 30, 2) + '</span>' +
      '<h2 id="bk-empty-title">Nog geen bank gekoppeld</h2>' +
      '<p>Koppel je Argenta-rekeningen, dan haalt Saldo elke nacht je transacties en je saldo op. Saldo leest alleen: betalen of geld verplaatsen kan het nooit.</p>' +
      '<ul class="bk-empty-facts">' +
        '<li>' + icon('phone', 18, 2.2) + '<span>Bevestigen met de Argenta-app, Digipass of itsme</span></li>' +
        '<li>' + icon('clock', 18, 2.2) + '<span>Toestemming voor 180 dagen, daarna opnieuw</span></li>' +
        '<li>' + icon('download', 18, 2.2) + '<span>Zo veel mogelijk geschiedenis bij de eerste keer</span></li>' +
      '</ul>' +
      btn('Nieuwe bankkoppeling', { kind: 'primary', href: '#nieuw', flow: true, net: true, icon: 'plus', cls: 'bk-empty-btn' }) +
      '<p class="bk-small">Eerst je oudere geschiedenis? <a href="importeren.html">Importeer een CSV-bestand</a></p>' +
      (c.offline ? offlineLine('Je bent offline. Koppelen kan weer zodra je verbinding hebt.') : '') +
    '</section>';
  }

  // ---------- List ----------

  function paintList(r, animate) {
    const c = ctx();
    const A = (cls, d) => (animate ? ' ' + cls + '" style="--d:' + d + 'ms' : '');
    const v = variantOf(r, c);
    const mine = c.linked ? D.connections.filter((x) => x.mine) : [];
    const others = c.linked ? D.connections.filter((x) => !x.mine) : [];
    const newBtn = (cls) => btn('Nieuwe bankkoppeling', { kind: cls === 'phone' ? 'dashed' : 'secondary', href: '#nieuw', flow: true, net: true, icon: 'plus',
      cls: cls === 'phone' ? 'only-phone bk-add-phone' : 'bk-add' });

    page.innerHTML =
      '<div class="bk-head' + A('anim-fade', 0) + '">' +
        '<a class="page-back only-phone" href="meer.html" aria-label="Terug naar Meer">' + icon('back', 22, 2.4) + '</a>' +
        '<div class="bk-head-title"><h1 tabindex="-1">Bankkoppelingen</h1><span class="bk-head-sub only-desktop">Toestemming en synchronisatie per bank</span></div>' +
        (mine.length ? '<div class="only-desktop">' + newBtn('desk') + '</div>' : '') +
      '</div>' +
      (mine.length
        ? '<section class="bk-section" aria-labelledby="bk-mine"><div class="bk-section-head' + A('anim-fade', 20) + '"><h2 class="label" id="bk-mine">Jouw koppelingen</h2></div>' +
            mine.map((x) => myCard(x, v, c, A)).join('') + newBtn('phone') + '</section>'
        : empty(c, A)) +
      (others.length
        ? '<section class="bk-section" aria-labelledby="bk-others"><div class="bk-section-head' + A('anim-fade', 80) + '"><h2 class="label" id="bk-others">Koppelingen van andere leden</h2><span class="bk-section-note">· alleen ter info</span></div>' +
            others.map((x) => otherCard(x, v, c, A)).join('') + '</section>'
        : '') +
      ((c.demo === 'fout' || v === 'gestopt') && mine.length
        ? '<div class="bk-mock' + A('anim-in', 110) + '"><span class="label">Mockup · fout tonen als</span><div class="bk-mock-pick">' +
            '<a href="#"' + (v !== 'gestopt' ? ' aria-current="true"' : '') + '>Argenta antwoordt niet</a>' +
            '<a href="#gestopt"' + (v === 'gestopt' ? ' aria-current="true"' : '') + '>Toestemming verlopen</a></div></div>'
        : '') +
      '<p class="bk-info' + A('anim-in', 130) + '">' + icon('eye', 18, 2.2) + '<span>Saldo leest alleen: het kan nooit betalen of geld verplaatsen. ' +
        'Elke nacht rond 04:00 haalt het nieuwe transacties en je saldo op. Banken vragen elke 180 dagen opnieuw toestemming; je krijgt 14 en 3 dagen vooraf een herinnering.</span></p>';
  }

  // ---------- Remove a connection (sheet on the phone, dialog on desktop) ----------

  let removeChoice = 'keep';
  let removeFrom = null;

  function openRemove() {
    const c = ctx();
    if (!c.linked || document.querySelector('.bk-backdrop')) return;
    removeChoice = 'keep';
    const tx = fmtN(RETURNED.b68.tx);
    const opt = (val, title, text, danger) =>
      '<label class="bk-opt' + (danger ? ' bk-opt--danger' : '') + '"><input type="radio" name="bk-history" value="' + val + '"' + (val === removeChoice ? ' checked' : '') + ' data-key="opt-' + val + '">' +
        '<span class="bk-opt-text"><strong>' + esc(title) + '</strong><span>' + esc(text) + '</span></span></label>';
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop bk-backdrop';
    wrap.innerHTML = '<div class="sheet bk-sheet" role="dialog" aria-modal="true" aria-labelledby="bk-rm-title">' +
      '<div class="sheet-grip" aria-hidden="true"></div>' +
      '<div class="bk-sheet-head"><span class="bk-tile">' + icon('bank', 22, 2) + '</span>' +
        '<div class="bk-sheet-title"><h2 id="bk-rm-title">Koppeling met Argenta verwijderen?</h2>' +
        '<p>Saldo trekt je toestemming bij Argenta in en haalt via deze koppeling niets meer op.</p></div>' +
        '<button type="button" class="bk-x" data-action="rm-close" aria-label="Sluiten">' + icon('close', 18, 2.4) + '</button></div>' +
      '<fieldset class="bk-opts"><legend class="bk-legend">Wat met de opgeslagen geschiedenis van Zichtrekening?</legend>' +
        opt('keep', 'Bewaren', 'Zichtrekening blijft in Saldo met haar ' + tx + ' transacties, zonder koppeling. Koppel je later opnieuw, dan gaat ze verder waar ze stopte.') +
        opt('delete', 'Verwijderen', 'Zichtrekening en haar ' + tx + ' transacties worden gewist, ook je categorieën en notities erbij. Dit kan je niet ongedaan maken.', true) +
      '</fieldset>' +
      '<div class="bk-shared-note"><span class="bk-shared-icon">' + icon('people', 18, 2.2) + '</span><p><strong>De Gedeelde rekening blijft bestaan</strong> voor jou en ' + esc(D.partner.name) +
        ', met al haar geschiedenis. ' + (c.lezen ? 'De koppeling van ' + esc(D.partner.name) + ' blijft de bron.' : 'De koppeling van ' + esc(D.partner.name) + ' neemt het over als bron, dus ze blijft bijgewerkt.') +
        ' Wil je de gedeelde rekening zelf niet meer zien? Dat doe je bij Rekeningen.</p></div>' +
      (c.offline ? offlineLine('Je bent offline. Verwijderen kan weer zodra je verbinding hebt.') : '') +
      '<div class="bk-sheet-actions">' +
        btn('Annuleren', { action: 'rm-close' }) +
        btn('Verwijderen', { kind: 'neg', action: 'rm-confirm', net: true, key: 'rm-confirm' }) +
      '</div>' +
    '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeRemove(); else onClick(e); });
    wrap.addEventListener('change', (e) => {
      if (e.target.name === 'bk-history') removeChoice = e.target.value;
    });
    const first = wrap.querySelector('input[name="bk-history"]:checked');
    if (first) first.focus();
  }

  function closeRemove(silent) {
    const wrap = document.querySelector('.bk-backdrop');
    if (wrap) wrap.remove();
    if (!silent && location.hash === '#verwijderen') history.replaceState(null, '', location.pathname + location.search);
    if (!silent) {
      const back = page.querySelector('[href="#verwijderen"]');
      if (back) back.focus();
    }
  }

  // ---------- Wizard: accounts Argenta returns ----------

  // [returned id, kind]: new (creates an account), linked (already yours), match (re-authorise: same IBAN),
  // exists (in Saldo for another member: offer to join)
  function returnedRows(mode, partner, c) {
    if (partner) return [['p71', 'new'], ['b12', 'exists']];
    if (mode === 'opnieuw') return [['b68', 'match'], ['b12', 'match']];
    if (!c.linked) return [['b68', 'new'], ['b12', 'new']];
    return [['b68', 'linked'], ['b12', 'linked'], ['b53', 'new']];
  }

  function pickedSet(mode, partner, c) {
    const key = mode + (partner ? '-p-' : '-') + c.demo;
    if (!picked || picked.key !== key) {
      picked = { key, set: new Set(returnedRows(mode, partner, c).filter((x) => x[1] === 'new' || x[1] === 'exists').map((x) => x[0])) };
    }
    return picked.set;
  }

  function syncRows(mode, partner, c) {
    const sel = pickedSet(mode, partner, c);
    return returnedRows(mode, partner, c)
      .filter(([id, kind]) => kind === 'match' || kind === 'linked' || (kind === 'new' && sel.has(id)) || (kind === 'exists' && sel.has(id) && joined))
      .map(([id, kind]) => Object.assign(acct(id), { kind }))
      .sort((a, b) => (a.kind === 'linked') - (b.kind === 'linked'));
  }

  // ---------- Wizard steps ----------

  function connSummary(conn) {
    return '<div class="bk-box bk-summary">' +
      '<div class="bk-conn-head"><span class="bk-tile">' + icon('bank', 22, 2) + '</span>' +
        '<span class="bk-conn-title"><span class="bk-conn-name bk-conn-name--sm">' + esc(conn.bank) + '</span><span class="bk-conn-sub">Via je Enable Banking-app ‘' + esc(conn.app) + '’</span></span></div>' +
      '<div class="bk-summary-accs">' + conn.accounts.map((id) => D.account(id)).map((a) =>
        '<span class="bk-pill"><i style="background:' + accBg(a.color) + '"></i>' + esc(a.name) + ' <span class="mono muted">' + esc(a.iban.slice(-4)) + '</span></span>').join('') + '</div>' +
    '</div>';
  }

  function stepPrereq(r, c, partner) {
    return {
      prev: exitHref(partner),
      body: h1('Eerst je eigen app bij Enable Banking') +
        lead('Saldo leest je rekeningen via Enable Banking. Daarvoor maak je één keer een eigen, gratis app aan. Zo loopt de toegang tot je bank alleen via jou.') +
        '<ol class="bk-box bk-items">' +
          item('1', 'Maak een gratis app', 'Registreer op <strong>enablebanking.com</strong> een app in de beperkte productiemodus. Die leest alleen je eigen rekeningen.', 'num') +
          item('2', 'Vul het terugkeeradres in', 'Enable Banking stuurt je na de bank naar dit adres terug.' +
            '<span class="bk-url"><span class="mono">' + esc(CALLBACK) + '</span><button type="button" class="bk-copy" data-action="copy" aria-label="Terugkeeradres kopiëren">' + icon('bkCopy', 16, 2.2) + '</button></span>', 'num') +
          item('3', 'Zet de app in Saldo', 'Plak het application-id en laad de privésleutel (.pem) op bij Instellingen → Enable Banking. Saldo bewaart de sleutel versleuteld.', 'num') +
        '</ol>' +
        tip('people', esc(D.partner.name) + ' maakt een eigen app aan. Zo koppelt ieder alleen de eigen rekeningen.'),
      foot: btn('Naar Instellingen', { kind: 'primary', href: 'instellingen.html#bank', after: 'chevron' }) + btn('Later', { href: exitHref(partner) })
    };
  }

  function stepBank(r, c, partner) {
    const app = 'Saldo · ' + (partner ? D.partner.name : D.user.name);
    const already = c.linked && !partner;
    const banks = '<div class="bk-box bk-banks" role="radiogroup" aria-label="Bank">' +
      '<label class="bk-bank"><input type="radio" name="bk-bank" value="argenta" checked>' +
        '<span class="bk-tile bk-tile--sm">' + icon('bank', 20, 2) + '</span>' +
        '<span class="bk-bank-main"><span class="bk-bank-name">Argenta</span><span class="bk-bank-sub">Zichtrekeningen · bevestigen met de Argenta-app, Digipass of itsme</span>' +
          (already ? '<span class="bk-bank-note">' + icon('check', 13, 2.8) + 'Al gekoppeld voor Zichtrekening en Gedeelde rekening</span>' : '') +
        '</span></label>' +
      OTHER_BANKS.map((b) => '<label class="bk-bank bk-bank--off"><input type="radio" name="bk-bank" value="' + esc(b) + '" disabled>' +
        '<span class="bk-tile bk-tile--sm bk-tile--off">' + icon('bank', 20, 2) + '</span>' +
        '<span class="bk-bank-main"><span class="bk-bank-name">' + esc(b) + '</span></span>' + chip('readonly', 'Later') + '</label>').join('') +
    '</div>';
    return {
      prev: exitHref(partner),
      body: h1('Kies je bank') +
        '<p class="bk-okline"><span class="bk-okline-dot">' + icon('check', 13, 3) + '</span><span>Je Enable Banking-app ‘' + esc(app) + '’ is klaar.</span></p>' +
        banks +
        (already ? tip('info', 'Wil je alleen je toestemming verlengen? Dan maak je geen nieuwe koppeling. <a href="#opnieuw" data-flow>Opnieuw autoriseren</a>') : '') +
        '<p class="bk-small">Spaarrekeningen geeft Argenta niet door. Die houd je met de hand bij in Rekeningen.</p>',
      foot: btn('Verder', { kind: 'primary', href: hashFor('nieuw', 'uitleg'), flow: true }) + btn('Annuleren', { href: exitHref(partner) })
    };
  }

  function stepUitleg(r, c, partner) {
    if (r.mode === 'opnieuw') {
      const conn = D.connections.find((x) => x.mine);
      return {
        prev: '#',
        net: true,
        body: h1('Toestemming vernieuwen bij Argenta') +
          lead('Je toestemming loopt tot ' + esc(conn.validUntil) + ', nog ' + conn.daysLeft + ' dagen. Bevestig opnieuw bij Argenta, dan leest Saldo je rekeningen weer tot ' + NEW_UNTIL + '.') +
          connSummary(conn) +
          '<ul class="bk-box bk-items">' +
            item(icon('link', 18, 2.2), 'Niets dubbel', 'Vink bij Argenta dezelfde rekeningen aan. Saldo herkent ze aan hun IBAN: je geschiedenis, categorieën en instellingen blijven gewoon.', 'green') +
            item(icon('download', 18, 2.2), 'Gemiste transacties', 'Wat intussen binnenkwam, haalt Saldo daarna vanzelf op.', 'green') +
            item(icon('eye', 18, 2.2), 'Saldo leest alleen', 'Je bevestigt met de Argenta-app, je Digipass of itsme. Betalen of geld verplaatsen kan Saldo nooit.', 'green') +
          '</ul>' +
          '<p class="bk-small">Vink je een rekening niet meer aan, dan wordt die niet meer bijgewerkt. Haar geschiedenis blijft.</p>',
        foot: btn('Naar Argenta', { kind: 'primary', href: hashFor('opnieuw', 'doorsturen'), flow: true, net: true, after: 'external' }) + btn('Annuleren', { href: '#' })
      };
    }
    return {
      prev: hashFor('nieuw', 'bank'),
      net: true,
      body: h1('Bevestigen bij Argenta') +
        lead('Je gaat even naar Argenta. Daar geef je Saldo toestemming om je rekeningen te lezen.') +
        subLabel('Zo gaat het') +
        '<ol class="bk-box bk-items">' +
          item('1', 'Je gaat naar Argenta', 'Saldo stuurt je door naar de beveiligde pagina van Argenta.', 'num') +
          item('2', 'Je bevestigt wie je bent', 'Met de Argenta-app, je Digipass of itsme.', 'num') +
          item('3', 'Je kiest je rekeningen', 'Alleen de rekeningen die je aanvinkt, kan Saldo lezen.', 'num') +
          item('4', 'Je komt terug in Saldo', 'Daarna halen we zo veel mogelijk geschiedenis op.', 'num') +
        '</ol>' +
        subLabel('Goed om te weten') +
        '<ul class="bk-box bk-items">' +
          item(icon('eye', 18, 2.2), 'Saldo leest alleen', 'Het kan nooit betalen of geld verplaatsen.', 'green') +
          item(icon('clock', 18, 2.2), 'Toestemming voor 180 dagen', 'Ze loopt tot ' + NEW_UNTIL + '. Verlengen kan niet: dan autoriseer je opnieuw. We herinneren je 14 en 3 dagen vooraf.', 'green') +
          item(icon('shield', 18, 2.2), 'Binnen 15 minuten', 'Een koppelpoging blijft 15 minuten geldig en werkt maar één keer.', 'green') +
        '</ul>',
      foot: btn('Naar Argenta', { kind: 'primary', href: hashFor('nieuw', 'doorsturen'), flow: true, net: true, after: 'external' }) + btn('Terug', { href: hashFor('nieuw', 'bank') })
    };
  }

  function stepDoorsturen(r, c, partner, entered) {
    const m = r.mode;
    return {
      body: '<div class="bk-redirect">' +
          '<span class="bk-ring" aria-hidden="true"><span class="bk-tile bk-tile--lg">' + icon('bank', 28, 2) + '</span></span>' +
          h1('Je gaat naar Argenta…') +
          '<p class="bk-lead">Bevestig daar met de Argenta-app, je Digipass of itsme en kies je rekeningen. Daarna kom je vanzelf terug in Saldo.</p>' +
          '<p class="bk-small">Gebeurt er niets? <button type="button" class="bk-linkbtn" data-action="reopen">Open Argenta opnieuw</button></p>' +
        '</div>' +
        '<div class="bk-mock"><span class="label">Mockup · bij Argenta</span>' +
          (entered ? '<p class="bk-small">Je komt zo terug met toestemming…</p>' : '') +
          '<div class="bk-mock-pick">' +
            '<a href="' + hashFor(m, 'rekeningen') + '">Toestemming gegeven</a>' +
            '<a href="' + hashFor(m, 'geannuleerd') + '">Geannuleerd bij Argenta</a>' +
            '<a href="' + hashFor(m, 'verlopen') + '">Na 15 minuten terug</a>' +
          '</div></div>'
    };
  }

  function pickRow(row, sel) {
    const id = row[0];
    const kind = row[1];
    const a = acct(id);
    const joint = a.holder.indexOf(' en ') > 0;
    const chips = { new: chip('ok', 'Nieuw'), linked: chip('readonly', 'Al gekoppeld'), match: chip('ok', 'Herkend', 'check'), exists: chip('shared', 'Bestaat al') };
    const notes = {
      new: joint ? 'Nieuw in Saldo · jij wordt beheerder. Koppelt ' + D.partner.name + ' ze later ook, dan kan ' + D.partner.name + ' aansluiten.' : 'Nieuw in Saldo · alleen jij ziet ze',
      linked: 'Al in Saldo als ' + a.name + ' · niets wordt dubbel aangemaakt',
      match: 'Zelfde IBAN als ' + a.name + ' · gaat verder waar ze was',
      exists: 'In Saldo als ' + a.name + ', beheerd door ' + D.user.name + '. Je kan aansluiten.'
    };
    const main = '<span class="bk-pick-main">' +
      '<span class="bk-pick-name"><span>' + esc(a.name) + '</span>' + chips[kind] + '</span>' +
      '<span class="mono bk-pick-iban">' + esc(a.iban) + '</span>' +
      '<span class="bk-pick-sub">Zichtrekening · op naam van ' + esc(a.holder) + '</span>' +
      '<span class="bk-pick-note' + (kind === 'exists' ? ' bk-pick-note--shared' : '') + '">' + esc(notes[kind]) + '</span>' +
    '</span>';
    const ic = accIcon(a, 16, kind === 'new');
    if (kind === 'new' || kind === 'exists') {
      return '<label class="bk-pick-row"><input type="checkbox" class="bk-cb" data-pick="' + id + '"' + (sel.has(id) ? ' checked' : '') + '>' + ic + main + '</label>';
    }
    return '<div class="bk-pick-row bk-pick-row--fixed"><span class="bk-cb-fixed" aria-hidden="true">' + icon('check', 14, 3) + '</span>' + ic + main + '</div>';
  }

  function pickCount(mode, partner, c) {
    const sel = pickedSet(mode, partner, c);
    if (mode === 'opnieuw') return returnedRows(mode, partner, c).length + ' rekeningen herkend · niets dubbel';
    const n = sel.size;
    if (!n) return 'Kies minstens één rekening.';
    return n + (n === 1 ? ' rekening' : ' rekeningen') + ' gekozen' + (partner && sel.has('b12') ? ' · daarna vragen we of je wil aansluiten' : '');
  }

  function stepRekeningen(r, c, partner) {
    const rows = returnedRows(r.mode, partner, c);
    const sel = pickedSet(r.mode, partner, c);
    const re = r.mode === 'opnieuw';
    return {
      net: true,
      body: '<p class="bk-okline"><span class="bk-okline-dot">' + icon('check', 13, 3) + '</span><span>Argenta gaf toestemming tot ' + NEW_UNTIL + '.</span></p>' +
        h1(re ? 'Je rekeningen zijn herkend' : 'Welke rekeningen wil je in Saldo?') +
        lead(re ? 'Saldo herkent je rekeningen aan hun IBAN. Er wordt niets dubbel aangemaakt; je geschiedenis, categorieën en instellingen blijven.'
          : 'Argenta gaf deze rekeningen door. Saldo herkent rekeningen aan hun IBAN, dus niets wordt dubbel aangemaakt.') +
        '<div class="bk-box bk-pick" role="group" aria-label="Rekeningen van Argenta">' + rows.map((x) => pickRow(x, sel)).join('') + '</div>' +
        '<p class="bk-count" data-count aria-live="polite">' + esc(pickCount(r.mode, partner, c)) + '</p>' +
        '<p class="bk-small">Spaarrekeningen en kredietkaarten geeft Argenta niet door.</p>',
      foot: btn('Verder', { kind: 'primary', action: 'accounts-next', net: true, disabled: !re && sel.size === 0, key: 'next' }),
      after: (!re && !partner)
        ? '<div class="bk-mock"><span class="label">Mockup · aansluiten</span>' +
            '<p class="bk-small">Bestaat een IBAN al in Saldo voor iemand anders, dan vraagt Saldo of je wil aansluiten. Bekijk het zoals ' + esc(D.partner.name) +
            ' het ziet, die de Gedeelde rekening ook koppelt.</p>' +
            '<div class="bk-mock-pick"><a href="bankkoppelingen.html?als=partner#nieuw-rekeningen">Bekijk als ' + esc(D.partner.name) + '</a></div></div>'
        : ''
    };
  }

  function stepAansluiten(r, c) {
    const a = acct('b12');
    const u = D.user;
    const fact = (ic, title, text, tone) => item(icon(ic, 18, 2.2), title, esc(text), tone);
    return {
      prev: hashFor('nieuw', 'rekeningen'),
      net: true,
      body: h1('Deze rekening bestaat al in Saldo. Wil je aansluiten?') +
        lead(esc(u.name) + ' koppelde de Gedeelde rekening op 3 juni 2026 en is er beheerder van. Jij koppelde ze nu ook bij Argenta: dat bewijst dat ze ook op jouw naam staat.') +
        '<div class="bk-box bk-join">' + accIcon(a, 20) +
          '<span class="bk-join-main"><span class="bk-join-name">' + esc(a.name) + '</span><span class="mono bk-pick-iban">' + esc(a.iban) + '</span>' +
            '<span class="bk-pick-sub">Op naam van ' + esc(a.holder) + '</span></span>' +
          '<span class="bk-mgr"><span class="avatar avatar--sm" style="background:' + u.tint + '">' + esc(u.initial) + '</span><span><small>Beheerder</small>' + esc(u.name) + '</span></span>' +
        '</div>' +
        subLabel('Als je aansluit') +
        '<ul class="bk-box bk-items">' +
          fact('list', 'Je ziet de bewaarde geschiedenis', fmtN(a.tx) + ' transacties sinds ' + a.from + ', met de categorieën en de planning van deze rekening.', 'shared') +
          fact('bell', u.name + ' krijgt een melding', 'Per e-mail en push: ‘' + D.partner.name + ' is erbij’.', 'shared') +
          fact('link', 'Jouw koppeling wordt een reservebron', u.name + 's koppeling blijft de hoofdbron. Verloopt die toestemming, dan houdt jouw koppeling de rekening bij. Niets komt dubbel binnen.', 'shared') +
          fact('edit', 'Je krijgt Bewerken', 'Je kan categoriseren, splitsen en de planning, budgetten en regels van deze rekening beheren. ' + u.name + ' kan dat in Lezen veranderen.', 'shared') +
          fact('lock', 'Je persoonlijke rekeningen blijven van jou', u.name + ' ziet jouw zichtrekening niet, en jij de rekeningen van ' + u.name + ' niet.', 'shared') +
        '</ul>',
      foot: btn('Aansluiten', { kind: 'primary', action: 'join-yes', net: true, icon: 'userPlus' }) + btn('Niet aansluiten', { action: 'join-no' }),
      after: '<p class="bk-foot-note">Niet aansluiten? Dan slaat Saldo deze rekening over. Een tweede kopie van dezelfde rekening kan niet.</p>'
    };
  }

  function syncText(x, p) {
    if (p >= 1) {
      if (x.kind === 'match') return x.missed ? 'Klaar · ' + x.missed + ' gemiste transacties' : 'Klaar · niets gemist';
      if (x.kind === 'linked') return 'Al gekoppeld · niets dubbel';
      if (x.kind === 'exists') return 'Aangesloten · ' + fmtN(x.tx) + ' transacties zichtbaar';
      return 'Klaar · ' + fmtN(x.tx) + ' transacties sinds ' + x.from;
    }
    if (p <= 0) return 'In de wachtrij';
    if (x.kind === 'match') return 'Gemiste transacties ophalen…';
    if (x.kind === 'linked') return 'Al in Saldo · ontbrekende dagen aanvullen…';
    if (x.kind === 'exists') return 'Geschiedenis staat al in Saldo · ontbrekende dagen aanvullen…';
    return 'Transacties ophalen · terug tot ' + MONTHS_BACK[Math.min(MONTHS_BACK.length - 1, Math.floor(p * MONTHS_BACK.length))];
  }

  function progRow(x, i, p) {
    const pct = Math.round(p * 100);
    return '<li class="bk-prog-row' + (p >= 1 ? ' is-done' : '') + '" data-row="' + i + '">' + accIcon(x, 16) +
      '<span class="bk-prog-main">' +
        '<span class="bk-prog-top"><span class="bk-prog-name">' + esc(x.name) + '</span><span class="mono bk-prog-pct" data-pct>' + pct + '%</span></span>' +
        '<span class="mono bk-prog-iban">' + esc(x.iban) + '</span>' +
        '<span class="bk-bar" role="progressbar" aria-label="' + esc(x.name) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
          '<span data-fill style="width:' + pct + '%;background:' + accBg(x.color) + '"></span></span>' +
        '<span class="bk-prog-text" data-text>' + (p >= 1 ? icon('check', 13, 2.8) : '') + '<span>' + esc(syncText(x, p)) + '</span></span>' +
      '</span></li>';
  }

  function stepSync(r, c, partner, entered) {
    const rows = syncRows(r.mode, partner, c);
    // A deep link shows a still frame halfway; the flow starts the simulation from zero.
    sim = { rows, p: rows.map((x, i) => (entered ? 0 : (i === 0 ? (rows.length > 1 ? 1 : 0.45) : (i === 1 ? 0.45 : 0)))) };
    const re = r.mode === 'opnieuw';
    return {
      body: h1(re ? 'We halen de gemiste transacties op' : 'We halen zo veel mogelijk geschiedenis op') +
        lead(re ? 'Alles sinds de laatste synchronisatie van vandaag 04:02. Dat gaat snel.'
          : 'Vlak na je toestemming geeft Argenta de langste geschiedenis vrij. Dat kan een minuut duren.') +
        '<ul class="bk-box bk-prog">' + rows.map((x, i) => progRow(x, i, sim.p[i])).join('') + '</ul>' +
        tip('info', 'Je mag dit scherm sluiten. Saldo werkt verder en je ziet het resultaat bij Bankkoppelingen.'),
      foot: btn('Verder op de achtergrond', { action: 'background' }),
      after: entered ? '' : '<button type="button" class="bk-mockbtn" data-action="play">Mockup · simulatie afspelen</button>'
    };
  }

  function updateSync() {
    sim.rows.forEach((x, i) => {
      const el = page.querySelector('[data-row="' + i + '"]');
      if (!el) return;
      const p = sim.p[i];
      const pct = Math.round(p * 100);
      el.querySelector('[data-fill]').style.width = pct + '%';
      el.querySelector('[data-pct]').textContent = pct + '%';
      el.querySelector('.bk-bar').setAttribute('aria-valuenow', pct);
      el.querySelector('[data-text]').innerHTML = (p >= 1 ? icon('check', 13, 2.8) : '') + '<span>' + esc(syncText(x, p)) + '</span>';
      el.classList.toggle('is-done', p >= 1);
    });
  }

  function runSync(mode) {
    const dur = sim.rows.map((x) => (x.kind === 'new' ? 3600 : 1100));
    let i = 0;
    const tick = () => {
      while (i < sim.rows.length && sim.p[i] >= 1) i += 1;
      if (i >= sim.rows.length) { later(() => go(hashFor(mode, 'klaar'), true), 800); return; }
      sim.p[i] = Math.min(1, sim.p[i] + 100 / dur[i]);
      updateSync();
      later(tick, 100);
    };
    later(tick, 400);
  }

  function nextSteps() {
    const row = (href, ic, tile, name, sub) => '<a class="bk-next-row" href="' + href + '">' +
      '<span class="bk-next-tile" style="background:' + tile + '">' + icon(ic, 18, 2) + '</span>' +
      '<span class="bk-next-main"><span class="bk-next-name">' + esc(name) + '</span><span class="bk-next-sub">' + esc(sub) + '</span></span>' +
      '<span class="bk-next-chev">' + icon('chevron', 18, 2) + '</span></a>';
    return subLabel('Volgende stappen') +
      '<div class="bk-box bk-next">' +
        row('rekeningen.html', 'card', 'var(--soft)', 'Stel je buffer in', 'Hoeveel wil je minstens op elke zichtrekening houden?') +
        row('importeren.html', 'upload', 'var(--c4)', 'Oudere geschiedenis importeren', 'Argenta gaf alles vanaf 3 maart 2025. Ouder? Importeer een CSV, bv. uit Bilance.') +
        row('transacties.html', 'tag', 'var(--c3)', 'Categoriseer je transacties', 'Saldo stelt categorieën voor op basis van je geschiedenis.') +
      '</div>';
  }

  function stepKlaar(r, c, partner) {
    const rows = syncRows(r.mode, partner, c).filter((x) => x.kind !== 'linked');
    const re = r.mode === 'opnieuw';
    const doneRow = (x, text) => '<li class="bk-acc">' + accIcon(x, 16) +
      '<span class="bk-acc-main"><span class="bk-acc-name">' + esc(x.name) + '</span><span class="bk-acc-sub">' + text + '</span></span></li>';

    if (re) {
      const missed = rows.reduce((s, x) => s + (x.missed || 0), 0);
      return {
        body: '<span class="bk-mark">' + icon('check', 30, 2.6) + '</span>' +
          h1('Toestemming vernieuwd') +
          lead('Saldo leest je rekeningen weer tot ' + NEW_UNTIL + '. We herinneren je 14 en 3 dagen vooraf.') +
          '<p class="bk-total"><span class="mono bk-total-n">' + missed + '</span><span class="bk-total-unit">gemiste transacties</span><small>opgehaald sinds vandaag 04:02</small></p>' +
          '<ul class="bk-box bk-accs bk-accs--box">' + rows.map((x) => doneRow(x, '<span class="mono">' + esc(x.iban) + '</span> · ' +
            (x.missed ? x.missed + ' nieuwe' : 'niets gemist') + ' · niets dubbel')).join('') + '</ul>',
        foot: btn('Naar Bankkoppelingen', { kind: 'primary', href: '#' })
      };
    }

    const fresh = rows.filter((x) => x.kind === 'new');
    const join = rows.find((x) => x.kind === 'exists');
    const total = fresh.reduce((s, x) => s + x.tx, 0);
    const linked = returnedRows(r.mode, partner, c).filter((x) => x[1] === 'linked').map((x) => acct(x[0]).name);
    const title = partner ? (join ? 'Klaar. Je bent aangesloten.' : 'Klaar. Je rekening is gekoppeld.')
      : (fresh.length > 1 ? 'Klaar. Je rekeningen zijn gekoppeld.' : 'Klaar. Je rekening is gekoppeld.');
    const big = fresh.length
      ? '<p class="bk-total"><span class="mono bk-total-n">' + fmtN(total) + '</span><span class="bk-total-unit">transacties</span><small>sinds ' + esc(fresh[0].from) + '</small></p>'
      : (join ? '<p class="bk-total"><span class="mono bk-total-n">' + fmtN(join.tx) + '</span><span class="bk-total-unit">transacties zichtbaar</span><small>sinds ' + esc(join.from) + '</small></p>' : '');
    const notes = [];
    if (linked.length) notes.push(linked.join(' en ') + (linked.length > 1 ? ' waren' : ' was') + ' al gekoppeld. Er is niets dubbel aangemaakt.');
    if (partner && join) notes.push(D.user.name + ' kreeg een melding dat je aansloot. Je koppeling is de reservebron voor de Gedeelde rekening.');
    if (partner && !join && pickedSet(r.mode, partner, c).has('b12')) notes.push('De Gedeelde rekening is overgeslagen. Koppel je ze later opnieuw, dan kan je alsnog aansluiten.');
    return {
      body: '<span class="bk-mark">' + icon('check', 30, 2.6) + '</span>' +
        h1(title) + big +
        '<ul class="bk-box bk-accs bk-accs--box">' + rows.map((x) => doneRow(x, x.kind === 'exists'
          ? 'Aangesloten als lid · Bewerken · ' + fmtN(x.tx) + ' transacties'
          : fmtN(x.tx) + ' transacties · saldo <span class="mono">' + eur(x.balance) + '</span>')).join('') + '</ul>' +
        notes.map((n) => tip('info', esc(n))).join('') +
        '<p class="bk-okline bk-okline--muted"><span class="bk-okline-dot">' + icon('clock', 13, 2.6) + '</span><span>Toestemming tot ' + NEW_UNTIL + '. We herinneren je 14 en 3 dagen vooraf.</span></p>' +
        nextSteps(),
      foot: btn('Naar Start', { kind: 'primary', href: 'index.html' }) + btn('Bankkoppelingen', { href: exitHref(partner) })
    };
  }

  function stepGeannuleerd(r, c, partner) {
    const re = r.mode === 'opnieuw';
    return {
      error: true,
      net: true,
      body: '<span class="bk-mark bk-mark--muted">' + icon('close', 28, 2.6) + '</span>' +
        h1('Koppelen geannuleerd') +
        lead('Je hebt het koppelen bij Argenta afgebroken. Er is niets veranderd: Saldo kreeg geen toegang tot je rekeningen.' +
          (re ? ' Je huidige toestemming loopt nog tot 30 november 2026.' : '')) +
        tip('info', 'Bedacht je je, of lukte het bevestigen in de Argenta-app niet? Probeer het gerust opnieuw.'),
      foot: btn('Opnieuw proberen', { kind: 'primary', href: hashFor(r.mode, 'uitleg'), flow: true, net: true }) + btn('Terug naar Bankkoppelingen', { href: exitHref(partner) })
    };
  }

  function stepVerlopen(r, c, partner) {
    return {
      error: true,
      net: true,
      body: '<span class="bk-mark bk-mark--warn">' + icon('clock', 28, 2.4) + '</span>' +
        h1('Koppelpoging verlopen') +
        lead('Deze koppelpoging is verlopen. Begin opnieuw.') +
        tip('shield', 'Een koppelpoging blijft 15 minuten geldig en werkt maar één keer, zodat niemand anders ze kan afmaken. Er is niets veranderd.'),
      foot: btn('Opnieuw beginnen', { kind: 'primary', href: hashFor(r.mode, 'uitleg'), flow: true, net: true }) + btn('Terug naar Bankkoppelingen', { href: exitHref(partner) })
    };
  }

  const STEP = {
    start: stepPrereq, bank: stepBank, uitleg: stepUitleg, doorsturen: stepDoorsturen, rekeningen: stepRekeningen,
    aansluiten: stepAansluiten, sync: stepSync, klaar: stepKlaar, geannuleerd: stepGeannuleerd, verlopen: stepVerlopen
  };

  // ---------- Wizard frame ----------

  function stepBar(mode, step, error) {
    const bar = BAR[mode];
    const at = bar.at[step];
    return '<ol class="bk-steps" aria-label="Stappen">' + bar.labels.map((l, k) => {
      const st = k < at ? 'is-done' : (k === at ? (error ? 'is-error' : 'is-current') : '');
      return '<li class="' + st + '"' + (k === at ? ' aria-current="step"' : '') + '><span class="bk-steps-label">' + esc(l) +
        (k < at ? '<span class="visually-hidden"> (klaar)</span>' : '') + '</span></li>';
    }).join('') + '</ol>';
  }

  function paintWizard(r, entered, animate) {
    const c = ctx();
    const partner = isPartner(r);
    const step = r.step === 'start' && c.setUp ? 'bank' : r.step;
    const s = STEP[step](r, c, partner, entered);
    const bar = BAR[r.mode];
    const at = bar.at[step];
    const count = at < 0 ? 'Voorbereiding' : (at >= bar.labels.length ? 'Klaar' : 'Stap ' + (at + 1) + ' van ' + bar.labels.length + ' · ' + bar.labels[at]);
    page.innerHTML =
      '<div class="bk-wiz' + (animate ? ' anim-fade' : '') + '" data-step="' + step + '">' +
        '<div class="bk-wiz-head">' +
          (s.prev ? '<a class="page-back bk-back" href="' + s.prev + '" aria-label="Vorige stap">' + icon('back', 22, 2.4) + '</a>' : '') +
          '<div class="bk-wiz-title"><span class="bk-wiz-kicker">' + (r.mode === 'nieuw' ? 'Nieuwe bankkoppeling' : 'Opnieuw autoriseren') + '</span>' +
            '<span class="bk-wiz-count">' + esc(count) + '</span></div>' +
          '<a class="bk-x" href="' + exitHref(partner) + '" aria-label="Stoppen en terug naar Bankkoppelingen">' + icon('close', 18, 2.4) + '</a>' +
        '</div>' +
        stepBar(r.mode, step, s.error) +
        (partner ? '<p class="bk-as">' + icon('eye', 16, 2.2) + '<span><strong>Mockup · je bekijkt dit als ' + esc(D.partner.name) + '.</strong> ' + esc(D.user.name) +
          ' koppelde de Gedeelde rekening eerst en is beheerder; ' + esc(D.partner.name) + ' koppelt ze nu ook. <a href="bankkoppelingen.html#nieuw-rekeningen">Terug naar ' + esc(D.user.name) + '</a></span></p>' : '') +
        '<div class="bk-body' + (animate ? ' anim-in' : '') + '">' + s.body + '</div>' +
        (s.net && c.offline ? offlineLine('Je bent offline. Koppelen kan weer zodra je verbinding hebt.') : '') +
        (s.foot ? '<div class="bk-foot">' + s.foot + '</div>' : '') +
        (s.after || '') +
      '</div>';

    if (entered && step === 'doorsturen') later(() => go(hashFor(r.mode, 'rekeningen'), true), 2600);
    if (entered && step === 'sync') runSync(r.mode);
  }

  // ---------- Painting ----------

  function paint(animate) {
    const r = parse();
    if (r.view === 'wizard') paintWizard(r, false, animate);
    else paintList(r, animate);
  }

  // Re-render in place (sync, retry) while keeping keyboard focus on the same control
  function repaint() {
    const a = document.activeElement;
    const key = a && a.dataset ? a.dataset.key : null;
    paintList(parse(), false);
    if (key) {
      const el = page.querySelector('[data-key="' + key + '"]');
      if (el && !el.disabled) el.focus();
    }
  }

  function onRoute(initial) {
    const r = parse();
    const entered = !initial && flowHash !== null && flowHash === (location.hash || '#');
    flowHash = null;
    stopTimers();
    if (r.view === 'wizard' && r.step === 'aansluiten' && !partnerParam()) {
      const q = new URLSearchParams(location.search);
      q.set('als', 'partner');
      history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash);
    }
    if (!(r.view === 'list' && r.remove)) closeRemove(true);
    if (r.view === 'wizard') paintWizard(r, entered, true);
    else paintList(r, true);
    if (!initial) {
      window.scrollTo(0, 0);
      const h = page.querySelector('h1');
      if (h) h.focus({ preventScroll: true });
    }
    if (r.view === 'list' && r.remove) openRemove();
  }

  // ---------- Actions ----------

  function manualSync() {
    if (manual.busy || manual.done) return;
    manual.busy = true;
    repaint();
    S.shell.progress(true);
    later(() => {
      manual.busy = false;
      manual.done = true;
      S.shell.progress(false);
      repaint();
      S.shell.toast('Bijgewerkt · 2 nieuwe transacties');
    }, 1600);
  }

  function retry() {
    if (retrying) return;
    retrying = true;
    repaint();
    S.shell.progress(true);
    later(() => {
      retrying = false;
      S.shell.progress(false);
      repaint();
      S.shell.toast('Argenta antwoordt nog niet · nieuwe poging om 10:00');
    }, 1600);
  }

  function onClick(e) {
    const flow = e.target.closest('[data-flow]');
    if (flow) flowHash = flow.getAttribute('href');
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const act = el.dataset.action;
    const r = parse();
    const c = ctx();
    const partner = isPartner(r);
    if (act === 'sync') manualSync();
    else if (act === 'retry') retry();
    else if (act === 'copy') {
      try { navigator.clipboard.writeText(CALLBACK); } catch (err) { /* mockup: clipboard may be unavailable */ }
      S.shell.toast('Terugkeeradres gekopieerd');
    } else if (act === 'reopen') S.shell.toast('Argenta opnieuw geopend (mockup)');
    else if (act === 'accounts-next') {
      joined = true;
      const sel = pickedSet(r.mode, partner, c);
      go(hashFor(r.mode, partner && sel.has('b12') ? 'aansluiten' : 'sync'), true);
    } else if (act === 'join-yes') {
      joined = true;
      S.shell.toast('Aangesloten · ' + D.user.name + ' krijgt een melding');
      go(hashFor('nieuw', 'sync'), true);
    } else if (act === 'join-no') {
      joined = false;
      if (syncRows(r.mode, true, c).length) go(hashFor('nieuw', 'sync'), true);
      else { S.shell.toast('Niets gekoppeld'); location.href = 'bankkoppelingen.html'; }
    } else if (act === 'background') {
      S.shell.toast('Saldo haalt je geschiedenis verder op');
      if (partner) location.href = 'bankkoppelingen.html';
      else go('', false);
    } else if (act === 'play') {
      stopTimers();
      sim.p = sim.p.map(() => 0);
      updateSync();
      el.remove();
      runSync(r.mode);
    } else if (act === 'rm-close') closeRemove();
    else if (act === 'rm-confirm') {
      closeRemove();
      S.shell.toast(removeChoice === 'delete' ? 'Koppeling verwijderd · Zichtrekening gewist (mockup)' : 'Koppeling verwijderd · geschiedenis bewaard (mockup)');
    }
  }

  function onChange(e) {
    const cb = e.target.closest('[data-pick]');
    if (!cb) return;
    const r = parse();
    const c = ctx();
    const partner = isPartner(r);
    const sel = pickedSet(r.mode, partner, c);
    if (cb.checked) sel.add(cb.dataset.pick);
    else sel.delete(cb.dataset.pick);
    page.querySelector('[data-count]').textContent = pickCount(r.mode, partner, c);
    const next = page.querySelector('[data-action="accounts-next"]');
    if (next) next.disabled = c.offline || (r.mode === 'nieuw' && sel.size === 0);
  }

  // Remember a renewal so the list shows the new consent after #opnieuw-klaar
  function noteRenewal() {
    const r = parse();
    if (r.view === 'wizard' && r.mode === 'opnieuw' && r.step === 'klaar') renewed = true;
  }

  // ---------- Screen ----------

  function render(p) {
    page = p;
    if (!page.dataset.bkWired) {
      page.dataset.bkWired = '1';
      page.addEventListener('click', onClick);
      page.addEventListener('change', onChange);
      window.addEventListener('hashchange', () => { onRoute(false); noteRenewal(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.bk-backdrop')) closeRemove(); });
      onRoute(true);
      noteRenewal();
      return;
    }
    paint(false);
  }

  S.screens = S.screens || {};
  S.screens.bankkoppelingen = { title: 'Bankkoppelingen', render };
})(window.Saldo = window.Saldo || {});
