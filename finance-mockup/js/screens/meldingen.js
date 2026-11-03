// Meldingen: channels, per-type push/e-mail, look-ahead, quiet hours, test notification.
// Design board: Telefoon-Meldingen. Spec: analysis/screens/meldingen.md, concepts/notification.md.
// Desktop is not designed: channels and general settings left, the types right.
(function (S) {
  'use strict';

  const { esc } = S.fmt;
  const icon = S.icon;
  const D = S.data;
  const store = S.shell.store;

  // Types per group with their state dot (analysis/concepts/notification.md)
  const GROUPS = [
    { id: 'planning', title: 'Planning', look: true, rows: [
      ['rood', 'Rekening staat rood', 'Als een rekening in de planning onder € 0 zakt', 'var(--neg)'],
      ['buffer', 'Rekening komt in de buffer', 'Als een rekening onder haar eigen buffer zakt', 'var(--warn)']] },
    { id: 'bank', title: 'Bank', rows: [
      ['consent', 'Koppeling verloopt', '14 en 3 dagen vooraf', 'var(--warn)'],
      ['stop', 'Synchronisatie gestopt', 'Als Saldo een rekening niet meer kan lezen', 'var(--neg)']] },
    { id: 'gedeeld', title: 'Gedeeld', rows: [
      ['joined', 'Iemand sluit aan', 'Bij een gedeelde rekening waar jij beheerder bent', 'var(--shared)'],
      ['contrib', 'Bijdrage ontbreekt', 'Als een bijdrage op de 3e nog niet binnen is', 'var(--shared)']] },
    { id: 'transacties', title: 'Transacties', rows: [
      ['cat', 'Te categoriseren', 'Eén keer per dag om 19:00, als er iets is', 'var(--green)']] }
  ];
  const LOOK = [1, 3, 6];

  // Defaults as on the board; saved per viewer
  const DEFAULTS = {
    ch: { push: true, mail: true },
    pref: { rood: { p: true, m: true }, buffer: { p: true, m: false }, consent: { p: true, m: true }, stop: { p: true, m: true },
      joined: { p: true, m: true }, contrib: { p: false, m: false }, cat: { p: true, m: false } },
    look: 3,
    quiet: true
  };

  let st = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const s = JSON.parse(store.get('meldingen', 'null'));
    if (s) {
      st.ch = Object.assign(st.ch, s.ch);
      Object.keys(st.pref).forEach((k) => { st.pref[k] = Object.assign(st.pref[k], (s.pref || {})[k]); });
      if (LOOK.indexOf(s.look) >= 0) st.look = s.look;
      if (typeof s.quiet === 'boolean') st.quiet = s.quiet;
    }
  } catch (e) { /* keep defaults */ }

  const persist = () => store.set('meldingen', JSON.stringify(st));

  let page = null;
  let painted = false;

  function anim(cls, delay) {
    return painted ? '' : ' ' + cls + '" style="--d:' + delay + 'ms';
  }

  function sw(on, label, key) {
    return '<button type="button" class="switch" role="switch" aria-checked="' + on + '" aria-label="' + esc(label) + '" data-action="' + key + '" data-key="' + key + '"></button>';
  }

  // ---------- Pieces ----------

  function header() {
    return '<div class="ml-head' + anim('anim-fade', 0) + '">' +
      '<a class="page-back only-phone" href="meer.html" aria-label="Terug naar Meer">' + icon('back', 22, 2.4) + '</a>' +
      '<div class="ml-head-title"><h1>Meldingen</h1><span class="ml-head-sub only-desktop">Push en e-mail, per soort</span></div>' +
    '</div>';
  }

  function channels() {
    return '<section class="ml-card ml-channels' + anim('anim-in', 30) + '" aria-label="Kanalen">' +
      '<div class="ml-setting"><span class="ml-setting-text"><span class="ml-setting-name">Pushmeldingen</span><span class="ml-setting-sub">Op dit toestel · Saldo op je startscherm</span></span>' +
        sw(st.ch.push, 'Pushmeldingen', 'ch-push') + '</div>' +
      '<div class="ml-setting"><span class="ml-setting-text"><span class="ml-setting-name">E-mail</span><span class="ml-setting-sub">' + esc(D.user.email) + '</span></span>' +
        sw(st.ch.mail, 'E-mail', 'ch-mail') + '</div>' +
    '</section>';
  }

  // Push or e-mail chip; locked at 40 % when its channel is off
  function chip(id, name, k) {
    const enabled = k === 'p' ? st.ch.push : st.ch.mail;
    const on = st.pref[id][k] && enabled;
    const key = 'pref-' + id + '-' + k;
    return '<button type="button" class="ml-chip" aria-pressed="' + on + '" aria-label="' + esc(name + (k === 'p' ? ' als pushmelding' : ' per e-mail')) + '"' +
      (enabled ? '' : ' disabled') + ' data-action="pref" data-id="' + id + '" data-k="' + k + '" data-key="' + key + '">' +
      icon(k === 'p' ? 'phone' : 'mail', 18, 2.2) + '</button>';
  }

  function lookAhead() {
    return '<div class="ml-look">' +
      '<span class="ml-look-title">Hoe ver vooruit kijken</span>' +
      '<div class="ml-seg" role="group" aria-label="Hoe ver vooruit kijken">' +
        LOOK.map((n) => '<button type="button" aria-pressed="' + (n === st.look) + '" data-action="look" data-n="' + n + '" data-key="look-' + n + '">' +
          n + (n === 1 ? ' maand' : ' maanden') + '</button>').join('') +
      '</div>' +
      '<span class="ml-hint">Je krijgt één melding per maand en per rekening, op de ochtend nadat de planning verandert.</span>' +
    '</div>';
  }

  function groups() {
    return '<div class="ml-types">' + GROUPS.map((g, gi) =>
      '<section class="ml-group' + anim('anim-in', 60 + gi * 30) + '" aria-labelledby="ml-g-' + g.id + '">' +
        '<div class="ml-group-head"><h2 class="label" id="ml-g-' + g.id + '">' + esc(g.title) + '</h2><span aria-hidden="true">Push · E-mail</span></div>' +
        '<div class="ml-card ml-list">' +
          g.rows.map((r) => '<div class="ml-type">' +
            '<span class="ml-dot" style="background:' + r[3] + '"></span>' +
            '<span class="ml-type-text"><span class="ml-type-name">' + esc(r[1]) + '</span><span class="ml-type-sub">' + esc(r[2]) + '</span></span>' +
            chip(r[0], r[1], 'p') + chip(r[0], r[1], 'm') +
          '</div>').join('') +
          (g.look ? lookAhead() : '') +
        '</div>' +
      '</section>').join('') + '</div>';
  }

  function quiet() {
    return '<section class="ml-card ml-quiet' + anim('anim-in', 180) + '" aria-label="Stille uren">' +
      '<div class="ml-setting"><span class="ml-setting-text"><span class="ml-setting-name">Stille uren</span><span class="ml-setting-sub">Geen pushmeldingen van 22:00 tot 07:00</span></span>' +
        sw(st.quiet, 'Stille uren', 'quiet') + '</div>' +
    '</section>';
  }

  // ---------- Painting ----------

  function paint() {
    page.innerHTML =
      header() +
      '<div class="ml-layout">' +
        channels() +
        groups() +
        quiet() +
        '<p class="ml-always' + anim('anim-in', 200) + '">Inlogcodes, uitnodigingen en wachtwoordlinks komen altijd per e-mail. Die kan je niet uitzetten.</p>' +
        '<button type="button" class="btn btn--dashed btn--block ml-test' + anim('anim-in', 220) + '" data-action="test" data-key="test">Stuur een testmelding</button>' +
      '</div>';
    painted = true;
  }

  // Re-render while keeping keyboard focus on the same control
  function refresh() {
    const a = document.activeElement;
    const key = a && a.dataset ? a.dataset.key : null;
    paint();
    if (key) {
      const el = page.querySelector('[data-key="' + key + '"]');
      if (el) el.focus();
    }
  }

  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const act = el.dataset.action;
    if (act === 'ch-push') st.ch.push = !st.ch.push;
    else if (act === 'ch-mail') st.ch.mail = !st.ch.mail;
    else if (act === 'quiet') st.quiet = !st.quiet;
    else if (act === 'pref') st.pref[el.dataset.id][el.dataset.k] = !st.pref[el.dataset.id][el.dataset.k];
    else if (act === 'look') st.look = Number(el.dataset.n);
    else if (act === 'test') {
      S.shell.toast(st.ch.push ? 'Testmelding verstuurd naar dit toestel' : 'Pushmeldingen staan uit');
      return;
    } else return;
    persist();
    refresh();
  }

  function render(p) {
    page = p;
    paint();
    if (!page.dataset.mlWired) {
      page.dataset.mlWired = '1';
      page.addEventListener('click', onClick);
    }
  }

  S.screens = S.screens || {};
  S.screens.meldingen = { title: 'Meldingen', render };
})(window.Saldo = window.Saldo || {});
