// Berichten: gallery of the e-mails and push notifications (Android, iPhone). No app shell.
// Design boards: E-mail-Berichten, Meldingen-Android, Meldingen-Icoon, Saldo-Icoon; the iPhone frames and
// the "Nieuw toestel" e-mail and push are derived in the same style.
// Spec: analysis/screens/emails.md, analysis/screens/pushmeldingen.md.
(function (S) {
  'use strict';

  const { esc, eur0 } = S.fmt;
  const { icon, logo } = S.icons;
  const D = S.data;

  // Screen-only icons for the iPhone lock screen (24 grid, stroke)
  S.icons.paths.flashlight = '<path d="M8 3h8v4l-2 3v11h-4V10L8 7V3Z"></path><path d="M8 7h8"></path><path d="M12 13v2"></path>';
  S.icons.paths.camera = '<path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"></path><circle cx="12" cy="13" r="3.5"></circle>';

  // ---------- Data (copy and values from the boards) ----------

  // One entry per file in emails/ (<file>.html and <file>.txt).
  const MAILS = [
    { file: 'inlogcode', label: '1 · Inlogcode', time: '14:12', subject: 'Je inlogcode: 4829 1736', pre: 'Geldig tot 14:22. Deel deze code met niemand.' },
    { file: 'planning-rood', label: '2 · Planning: rood', time: '07:30', subject: 'Zichtrekening staat rood in februari', pre: 'Verwacht eindsaldo −€ 1.033,47. Bekijk wat je kan schuiven.' },
    { file: 'planning-buffer', label: '3 · Planning: in de buffer', time: '07:30', subject: 'Zichtrekening zakt in januari in de buffer', pre: 'Verwacht € 721,50, dat is € 178,50 onder je buffer.' },
    { file: 'koppeling-14-dagen', label: '4 · Koppeling verloopt (14 dagen)', time: '09:00', subject: 'Je Argenta-koppeling verloopt over 14 dagen (2 rekeningen)', pre: 'Koppel opnieuw om te blijven synchroniseren. Het duurt een minuut.' },
    { file: 'koppeling-3-dagen', label: '5 · Koppeling verloopt (3 dagen)', time: '09:00', subject: 'Laatste herinnering: Argenta verloopt over 3 dagen (2 rekeningen)', pre: 'Na 30 november stopt de synchronisatie van 2 rekeningen.' },
    { file: 'sync-gestopt', label: '6 · Synchronisatie gestopt', time: '04:05', subject: 'Zichtrekening en Gedeelde rekening worden niet meer bijgewerkt', pre: 'De toestemming is verlopen. Laatste synchronisatie 30 nov om 04:02.' },
    { file: 'uitnodiging', label: '7 · Uitnodiging', time: '20:14', subject: 'Bert nodigt je uit voor Saldo', pre: 'Maak je account aan. De link is 7 dagen geldig.' },
    { file: 'lid-aangesloten', label: '8 · Lid gedeelde rekening', time: '20:31', subject: 'Partner is erbij op de Gedeelde rekening', pre: 'Partner heeft de rekening gekoppeld en ziet nu dezelfde transacties.' },
    { file: 'nieuw-wachtwoord', label: '9 · Nieuw wachtwoord', time: '10:02', subject: 'Stel een nieuw wachtwoord in', pre: 'Bert heeft een nieuwe link voor je aangemaakt. Geldig tot 11:02.' },
    { file: 'nieuw-toestel', label: '10 · Nieuw toestel', time: '21:14', subject: 'Nieuw toestel aangemeld: Chrome op Android', pre: 'Wo 18 nov, 21:14. Was jij dit niet? Meld het toestel af en kies een nieuw wachtwoord.' }
  ];

  // Notification circle colours (same hex in light and dark, as on the board).
  const TONE = { neg: '#C62828', warn: '#A15C07', info: '#15803D' };

  // Titles name the account ("Zichtrekening …"), never the scope (decision 3 Nov 2026).
  // `amt` is the pill on Android; types without a key figure have none.
  const PUSH = [
    { id: 'toestel', kind: 'info', time: 'nu', title: 'Nieuw toestel aangemeld', text: 'Chrome op Android is nu aangemeld bij je account. Was jij dit niet? Meld het af in Instellingen → Toestellen.' },
    { id: 'rood', kind: 'neg', time: '07:30', title: 'Zichtrekening staat rood in februari', text: 'Verwacht −€ 1.033 op 28 februari. De autoherstelling van 10 februari duwt de rekening onder nul.', amt: '−€ 1.033', chart: true },
    { id: 'buffer', kind: 'warn', time: '07:30', title: 'Zichtrekening zakt in januari in de buffer', text: 'Verwacht € 722. Dat is € 179 onder je buffer van € 900.', amt: '€ 722' },
    { id: 'consent', kind: 'warn', time: 'gisteren', title: 'Argenta verloopt over 14 dagen', text: 'Koppel opnieuw om Zichtrekening en Gedeelde rekening te blijven synchroniseren.', amt: '14 dagen' },
    { id: 'cat', kind: 'info', time: 'gisteren', title: '8 transacties te categoriseren', text: 'Colruyt, Delhaize, NMBS en 5 andere.', amt: '8' }
  ];

  // Lock screen: no amounts, no account names and no device names.
  const LOCK = [
    { kind: 'info', time: 'nu', title: 'Nieuw toestel aangemeld', text: 'Ontgrendel om de details te zien' },
    { kind: 'neg', time: '07:30', title: 'Planning: actie nodig', text: 'Ontgrendel om de details te zien' },
    { kind: 'warn', time: 'gisteren', title: 'Bankkoppeling verloopt binnenkort', text: 'Ontgrendel om de details te zien' }
  ];

  const FRAMES = [
    { id: 'L', theme: 'light', name: 'Meldingenpaneel · licht', desc: 'Bedrag rechts bovenaan in de kleur van de melding. De rode melding staat open met de komende maanden.' },
    { id: 'D', theme: 'dark', name: 'Meldingenpaneel · donker', desc: 'Hetzelfde in donkere modus. Android kiest dit vanzelf volgens je toestel.' }
  ];
  const DEFAULT_OPEN = { rood: true };

  const DATE = 'woensdag 18 november';

  // Android glyphs (filled, 24 grid) from Meldingen-Android and Meldingen-Icoon.
  const GLYPH = {
    saldo: '<path d="M6.5 7.5a4 4 0 0 1 8 0Z"></path><path fill-rule="evenodd" d="M6 9h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3ZM16.75 13h.5a2.25 2.25 0 0 1 0 4.5h-.5a2.25 2.25 0 0 1 0-4.5Z"></path>',
    chat: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 3V6a1 1 0 0 1 1-1Z"></path>',
    reminder: '<path d="M12 3a6 6 0 0 1 6 6v4l2 3H4l2-3V9a6 6 0 0 1 6-6Zm-2 15h4a2 2 0 0 1-4 0Z"></path>',
    wifi: '<path d="M12 20.5 1.5 9a15 15 0 0 1 21 0L12 20.5Z"></path>',
    signal: '<path d="M2 21 21 2v19H2Z"></path>',
    battery: '<path d="M9 2h6v2h2a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2V2Z"></path>'
  };

  function glyph(name, size, style) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"' +
      (style ? ' style="' + style + '"' : '') + '>' + GLYPH[name] + '</svg>';
  }

  // ---------- State ----------

  let open = {};
  let txtOpen = {};

  function isOpen(frameId, n) {
    const key = frameId + n.id;
    return open[key] !== undefined ? open[key] : !!DEFAULT_OPEN[n.id];
  }

  // ---------- Header ----------

  function themeChoice() {
    const cur = document.documentElement.dataset.theme || 'system';
    const opt = (v, l) => '<button type="button" class="filter-chip" data-theme-set="' + v + '" aria-pressed="' + (cur === v) + '">' + l + '</button>';
    return '<div class="bx-theme" role="group" aria-label="Weergave">' + opt('light', 'Licht') + opt('dark', 'Donker') + opt('system', 'Systeem') + '</div>';
  }

  function header() {
    return '<header class="bx-head anim-fade">' +
      '<div class="bx-head-title">' +
        '<a class="bx-logo" href="index.html" aria-label="Naar Start">' + logo(36) + '</a>' +
        '<div><h1>Berichten</h1><p class="muted">E-mails en pushmeldingen van Saldo, zoals de ontwerpborden ze tonen.</p></div>' +
      '</div>' +
      themeChoice() +
    '</header>' +
    '<nav class="bx-toc" aria-label="Op deze pagina">' +
      '<a href="#emails">E-mails (10)</a><a href="#push">Pushmeldingen</a><a href="#iphone">iPhone</a><a href="#icoon">Meldingsicoon</a><a href="#app-icoon">App-icoon</a>' +
    '</nav>';
  }

  // ---------- E-mails ----------

  function mailCard(m, i) {
    const shown = !!txtOpen[m.file];
    return '<article class="bx-mail anim-in" style="--d:' + (i * 30) + 'ms">' +
      '<span class="label">' + esc(m.label) + '</span>' +
      '<div class="bx-mail-box">' +
        '<div class="bx-meta">' +
          '<div class="bx-meta-row"><span class="bx-meta-av" aria-hidden="true">S</span>' +
            '<span class="bx-meta-from">Saldo <span>&lt;saldo@jouw-domein.be&gt;</span></span><span>' + esc(m.time) + '</span></div>' +
          '<div class="bx-meta-subj">' + esc(m.subject) + '</div>' +
          '<div class="bx-meta-pre">' + esc(m.pre) + '</div>' +
        '</div>' +
        '<iframe class="bx-frame" src="emails/' + m.file + '.html" title="E-mail: ' + esc(m.subject) + '" data-mail="' + m.file + '"></iframe>' +
      '</div>' +
      '<div class="bx-mail-links">' +
        '<a href="emails/' + m.file + '.html" target="_blank" rel="noopener">HTML openen</a>' +
        '<button type="button" data-txt="' + m.file + '" aria-expanded="' + shown + '" aria-controls="txt-' + m.file + '">' + (shown ? 'Platte tekst verbergen' : 'Platte tekst') + '</button>' +
      '</div>' +
      '<pre class="bx-txt" id="txt-' + m.file + '"' + (shown ? '' : ' hidden') + '></pre>' +
    '</article>';
  }

  function emailsSection() {
    return '<section class="bx-section" id="emails" aria-labelledby="emails-h">' +
      '<div class="bx-section-head"><h2 id="emails-h">Alle e-mails</h2>' +
        '<p class="muted">10 berichten in de gekozen stijl: een witte kaart, kleur alleen in het label en het bedrag. Elke e-mail heeft ook een platte-tekstversie.</p></div>' +
      '<div class="bx-mails">' + MAILS.map(mailCard).join('') + '</div>' +
    '</section>';
  }

  // ---------- Push: chart ----------

  // Small forecast chart in the red planning notification (Meldingen-Android chartOf).
  function chart() {
    const g = D.groups[0];
    const vals = g.forecast;
    const H = 64, max = g.chartMax, min = g.chartMin, sc = H / (max - min);
    const zeroY = Math.round(max * sc) + 4;
    const bufH = Math.round(g.buffer * sc);
    const bufY = zeroY - bufH;
    const bars = vals.map((v, i) => {
      const h = Math.max(2, Math.round(Math.abs(v) * sc));
      const y = v >= 0 ? zeroY - Math.round(v * sc) : zeroY;
      return '<rect class="' + (v < 0 ? 'bx-bar bx-bar--neg' : 'bx-bar') + '" x="' + (13 + i * 60) + '" y="' + y + '" width="34" height="' + h + '" rx="5"></rect>';
    }).join('');
    const label = 'Verwacht eindsaldo ' + g.title + ': ' +
      vals.map((v, i) => D.forecastMonths[i].name + ' ' + eur0(v)).join(', ') + '. Buffer ' + eur0(g.buffer) + '.';
    const months = ['nov', 'dec', 'jan', 'feb'];
    return '<div class="bx-chart">' +
      '<div class="bx-chart-in">' +
        '<svg viewBox="0 0 240 76" role="img" aria-label="' + esc(label) + '">' +
          '<rect class="bx-zone-buf" x="0" y="' + bufY + '" width="240" height="' + bufH + '"></rect>' +
          '<rect class="bx-zone-neg" x="0" y="' + zeroY + '" width="240" height="' + (76 - zeroY) + '"></rect>' +
          bars +
          '<line class="bx-zero" x1="0" x2="240" y1="' + zeroY + '" y2="' + zeroY + '"></line>' +
          '<line class="bx-buf" x1="0" x2="240" y1="' + bufY + '" y2="' + bufY + '"></line>' +
        '</svg>' +
        '<div class="bx-chart-months" aria-hidden="true">' +
          months.map((m, i) => '<span' + (vals[i] < 0 ? ' class="is-neg"' : '') + '>' + m + '</span>').join('') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ---------- Push: phone frames ----------

  function statusBar() {
    return '<span class="bx-cam" aria-hidden="true"></span>' +
      '<div class="bx-status" aria-hidden="true">' +
        '<span class="bx-status-time">9:41</span>' + glyph('saldo', 16) + glyph('chat', 15, 'opacity:.85') +
        '<span class="bx-flex"></span>' +
        '<span class="bx-status-sys">' + glyph('wifi', 15) + glyph('signal', 15) + glyph('battery', 15) + '</span>' +
      '</div>';
  }

  function circle(kind, size, glyphSize) {
    return '<span class="bx-circle" style="--tone:' + TONE[kind] + ';--size:' + size + 'px">' + glyph('saldo', glyphSize) + '</span>';
  }

  function lockFrame() {
    return '<figure class="bx-phone-col">' +
      '<div class="bx-phone bx-lock">' + statusBar() +
        '<div class="bx-lock-clock"><span>9:41</span><span>' + DATE + '</span></div>' +
        '<div class="bx-lock-list">' +
          LOCK.map((n, i) => '<div class="bx-lock-n bx-drop" style="--d:' + (80 + i * 60) + 'ms">' + circle(n.kind, 36, 20) +
            '<span class="bx-lock-t"><span class="bx-lock-app">Saldo · ' + esc(n.time) + '</span><strong>' + esc(n.title) + '</strong><span class="bx-lock-sub">' + esc(n.text) + '</span></span></div>').join('') +
        '</div>' +
        '<span class="bx-lock-btn" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
          '<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg></span>' +
      '</div>' +
      '<figcaption><strong>Vergrendelscherm</strong><span>Geen bedragen, rekeningnamen of toestelnamen zolang het toestel vergrendeld is. Je ziet alleen dat er iets is.</span></figcaption>' +
    '</figure>';
  }

  function notification(f, n, i) {
    const o = isOpen(f.id, n);
    const key = f.id + n.id;
    return '<div class="bx-n bx-drop' + (o ? ' is-open' : '') + '" data-key="' + key + '" style="--d:' + (80 + i * 60) + 'ms">' +
      circle(n.kind, 36, 20) +
      '<div class="bx-n-main">' +
        '<div class="bx-n-head"><span>Saldo</span><span aria-hidden="true">·</span><span>' + esc(n.time) + '</span><span class="bx-flex"></span>' +
          (n.amt ? '<span class="bx-amt bx-amt--' + n.kind + '">' + esc(n.amt) + '</span>' : '') +
          '<button type="button" class="bx-n-toggle" data-toggle="' + key + '" aria-expanded="' + o + '" aria-label="' + (o ? 'Melding inklappen' : 'Melding openklappen') + '">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>' +
          '</button>' +
        '</div>' +
        '<span class="bx-n-title">' + esc(n.title) + '</span>' +
        '<span class="bx-n-text">' + esc(n.text) + '</span>' +
        (n.chart ? chart() : '') +
      '</div>' +
    '</div>';
  }

  function shadeFrame(f) {
    const tiles = [['Wifi', true], ['Bluetooth', false], ['Niet storen', false], ['Zaklamp', false]];
    return '<figure class="bx-phone-col">' +
      '<div class="bx-phone bx-shade bx-shade--' + f.theme + '">' + statusBar() +
        '<div class="bx-shade-in">' +
          '<div class="bx-tiles" aria-hidden="true">' + tiles.map((t) => '<span class="bx-tile' + (t[1] ? ' is-on' : '') + '">' + t[0] + '</span>').join('') + '</div>' +
          '<span class="bx-shade-date">' + DATE + '</span>' +
          '<div class="bx-n-list">' + PUSH.map((n, i) => notification(f, n, i)).join('') + '</div>' +
          '<div class="bx-shade-foot" aria-hidden="true"><span>Beheren</span><span>Alles wissen</span></div>' +
        '</div>' +
      '</div>' +
      '<figcaption><strong>' + esc(f.name) + '</strong><span>' + esc(f.desc) + '</span></figcaption>' +
    '</figure>';
  }

  function pushFrames() {
    return lockFrame() + FRAMES.map(shadeFrame).join('');
  }

  function pushSection() {
    return '<section class="bx-section" id="push" aria-labelledby="push-h">' +
      '<div class="bx-section-head bx-section-head--row">' +
        '<div><h2 id="push-h">Pushmeldingen op Android</h2>' +
          '<p class="muted">Het bedrag staat meteen bij de melding. Open de rode melding met de pijl om de komende maanden te zien.</p></div>' +
        '<button type="button" class="btn btn--ghost" data-action="reset">Opnieuw tonen</button>' +
      '</div>' +
      '<div class="bx-phones" id="push-frames">' + pushFrames() + '</div>' +
    '</section>';
  }

  // ---------- Push: iPhone ----------

  // iOS shows a web app's push with the app icon, title, time and body only: no amount pill, no chart,
  // no buttons. Lock-screen previews follow the iPhone setting "Toon voorvertoning" (default "Indien ontgrendeld").
  const IOS_BANNER = Object.assign({}, PUSH[1], { time: 'nu' });
  const IOS_LOCK = [PUSH[0], PUSH[1]];

  function iosStatus() {
    return '<div class="bx-ios-status" aria-hidden="true">' +
      '<span class="bx-ios-time">9:41</span><span class="bx-ios-island"></span>' +
      '<span class="bx-ios-sys">' +
        '<svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1"></rect><rect x="4.5" y="5" width="3" height="6" rx="1"></rect><rect x="9" y="2.5" width="3" height="8.5" rx="1"></rect><rect x="13.5" y="0" width="3" height="11" rx="1"></rect></svg>' +
        glyph('wifi', 15) +
        '<svg width="25" height="12" viewBox="0 0 25 12"><rect x="0.5" y="0.5" width="21" height="11" rx="3.5" fill="none" stroke="currentColor" opacity=".45"></rect><rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor"></rect><rect x="23" y="4" width="1.6" height="4" rx=".8" fill="currentColor" opacity=".45"></rect></svg>' +
      '</span>' +
    '</div>';
  }

  // One iOS notification: app icon, then title + time and the body (or "Saldo" + "Melding" without preview)
  function iosCard(n, preview, i) {
    return '<div class="bx-ios-n bx-drop" style="--d:' + (80 + i * 60) + 'ms">' +
      '<span class="bx-ios-icon">' + logo(38, 22) + '</span>' +
      '<span class="bx-ios-t">' +
        '<span class="bx-ios-head"><strong>' + esc(preview ? n.title : 'Saldo') + '</strong><span>' + esc(n.time) + '</span></span>' +
        '<span class="bx-ios-body">' + esc(preview ? n.text : 'Melding') + '</span>' +
      '</span>' +
    '</div>';
  }

  function iosHome() {
    const apps = [];
    for (let i = 0; i < 16; i++) {
      apps.push(i === 5
        ? '<span class="bx-ios-app">' + logo(56, 22) + '<small>Saldo</small></span>'
        : '<span class="bx-ios-app"><i></i><small></small></span>');
    }
    return '<div class="bx-ios-apps" aria-hidden="true">' + apps.join('') + '</div>' +
      '<div class="bx-ios-dock" aria-hidden="true"><i></i><i></i><i></i><i></i></div>';
  }

  function iosLockTop(unlocked) {
    return '<div class="bx-ios-clock" aria-hidden="true">' +
      '<svg width="16" height="20" viewBox="0 0 16 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<rect x="2" y="9" width="12" height="10" rx="2.5" fill="currentColor" stroke="none"></rect>' +
        '<path d="' + (unlocked ? 'M5 9V5.5a3.5 3.5 0 0 1 6.6-1.6' : 'M5 9V5.5a3 3 0 0 1 6 0V9') + '"></path></svg>' +
      '<span class="bx-ios-date">' + DATE + '</span><span class="bx-ios-big">9:41</span>' +
    '</div>' +
    '<span class="bx-ios-btn bx-ios-btn--l" aria-hidden="true">' + icon('flashlight', 18, 2) + '</span>' +
    '<span class="bx-ios-btn bx-ios-btn--r" aria-hidden="true">' + icon('camera', 18, 2) + '</span>' +
    '<span class="bx-ios-bar" aria-hidden="true"></span>';
  }

  function iphoneSection() {
    const frames = [
      { cls: 'bx-iphone--home', inner: iosStatus() + '<div class="bx-ios-banner">' + iosCard(IOS_BANNER, true, 0) + '</div>' + iosHome() + '<span class="bx-ios-bar" aria-hidden="true"></span>',
        name: 'Banner · ontgrendeld, licht', desc: 'Bovenaan het beginscherm: het app-icoon in plaats van een silhouet, dan titel, tijd en tekst. Geen bedragpil, dus het bedrag staat in de tekst.' },
      { cls: 'bx-iphone--lock', inner: iosStatus() + iosLockTop(false) + '<div class="bx-ios-list">' + IOS_LOCK.map((n, i) => iosCard(n, false, i)).join('') + '</div>',
        name: 'Vergrendeld · donker', desc: 'Met Toon voorvertoning: Indien ontgrendeld (de standaard op iPhone) zie je alleen "Saldo" en "Melding". Geen titel, geen bedrag, geen rekening.' },
      { cls: 'bx-iphone--lock', inner: iosStatus() + iosLockTop(true) + '<div class="bx-ios-list">' + IOS_LOCK.map((n, i) => iosCard(n, true, i)).join('') + '</div>',
        name: 'Na Face ID · donker', desc: 'Zodra Face ID je herkent, toont iOS titel en tekst. Geen grafiek om open te klappen en geen knoppen: tikken opent Saldo op de juiste plek.' }
    ];
    return '<section class="bx-section" id="iphone" aria-labelledby="iphone-h">' +
      '<div class="bx-section-head"><h2 id="iphone-h">Pushmeldingen op iPhone</h2>' +
        '<p class="muted">Dezelfde meldingen als op Android, maar iOS toont alleen de titel en de tekst. De teksten moeten dus ook zonder bedragpil en grafiek kloppen.</p></div>' +
      '<div class="bx-phones">' + frames.map((f) =>
        '<figure class="bx-phone-col">' +
          '<div class="bx-phone bx-iphone ' + f.cls + '">' + f.inner + '</div>' +
          '<figcaption><strong>' + esc(f.name) + '</strong><span>' + esc(f.desc) + '</span></figcaption>' +
        '</figure>').join('') +
      '</div>' +
      '<div class="card bx-icon-card bx-ios-rules">' +
        '<span class="bx-icon-card-title">Zo werkt het op iOS</span>' +
        '<ul class="bx-rules">' +
          '<li>Pushmeldingen werken pas als Saldo op het beginscherm staat (Deel → Zet op beginscherm, iOS 16.4 of nieuwer).</li>' +
          '<li>Saldo vraagt toestemming pas na een tik op Pushmeldingen in Meldingen, nooit bij het openen.</li>' +
          '<li>Alleen titel en tekst: geen bedragpil, geen grafiek, geen knoppen. Het bedrag staat daarom altijd in de tekst.</li>' +
          '<li>Geen icoon in de statusbalk. Het app-icoon (Beurs) staat in de melding zelf.</li>' +
          '<li>Het vergrendelscherm volgt Toon voorvertoning. Kiest iemand Altijd, dan toont iOS titel en tekst ook vergrendeld: Saldo kan op iOS geen aparte vergrendeltekst sturen.</li>' +
        '</ul>' +
      '</div>' +
    '</section>';
  }

  // ---------- Meldingsicoon ----------

  function sizes(cls) {
    return '<div class="bx-sizes ' + cls + '">' + [16, 24, 32, 48].map((s) =>
      '<span>' + glyph('saldo', s) + '<small>' + s + '</small></span>').join('') + '</div>';
  }

  function statusStrip(cls) {
    return '<div class="bx-strip ' + cls + '" aria-hidden="true">' +
      '<span class="bx-strip-time">9:41</span>' +
      '<span class="bx-strip-icons">' + glyph('saldo', 32) + glyph('chat', 30, 'opacity:.9') + glyph('reminder', 30, 'opacity:.9') + '</span>' +
      '<span class="bx-flex"></span>' +
      '<span class="bx-strip-sys">' + glyph('wifi', 28) + glyph('signal', 28) + glyph('battery', 28) + '</span>' +
    '</div>';
  }

  function sample(kind, time, title, dark) {
    return '<div class="bx-sample' + (dark ? ' bx-sample--dark' : '') + '">' + circle(kind, 40, 22) +
      '<span class="bx-sample-t"><span>Saldo · ' + time + '</span><strong>' + esc(title) + '</strong></span></div>';
  }

  function iconSection() {
    return '<section class="bx-section" id="icoon" aria-labelledby="icoon-h">' +
      '<div class="bx-section-head"><h2 id="icoon-h">Meldingsicoon · Beurs met munt</h2>' +
        '<p class="muted">Het kleine icoon dat Android in de statusbalk en in elke melding toont. Hetzelfde beeld als het app-icoon, maar als silhouet: één kleur, alleen de vorm telt.</p></div>' +
      '<div class="bx-icon-grid">' +
        '<div class="card bx-icon-master">' +
          '<span class="bx-raster" role="img" aria-label="Meldingsicoon op een raster van 24 bij 24 dp met 2 dp marge">' +
            '<span class="bx-raster-margin" aria-hidden="true"></span>' + glyph('saldo', 288) +
          '</span>' +
          sizes('bx-sizes--dark') + sizes('bx-sizes--light') +
          '<ul class="bx-rules">' +
            '<li>Raster 24 × 24 dp, 2 dp marge (oranje lijn)</li>' +
            '<li>Eén kleur met transparantie, geen verloop of details</li>' +
            '<li>1,5 dp ruimte tussen munt en beurs, zodat ze op 16 px los blijven</li>' +
            '<li>Lever als vector (XML) aan, Android kleurt hem zelf in</li>' +
          '</ul>' +
          '<a class="section-link" href="img/statusbar-icon.svg" download>statusbar-icon.svg</a>' +
        '</div>' +
        '<div class="bx-icon-side">' +
          '<div class="card bx-icon-card">' +
            '<span class="bx-icon-card-title">In de statusbalk <span class="muted">· 2× vergroot, naast andere meldingen</span></span>' +
            statusStrip('bx-strip--dark') + statusStrip('bx-strip--light') +
            '<span class="bx-note">Links van de klok staan de meldingen: eerst Saldo, daarna een chat-app en een herinnering.</span>' +
          '</div>' +
          '<div class="card bx-icon-card">' +
            '<span class="bx-icon-card-title">In de melding zelf</span>' +
            sample('info', 'nu', '8 transacties te categoriseren') +
            sample('warn', '07:30', 'Zichtrekening zakt in januari in de buffer') +
            sample('neg', '07:30', 'Zichtrekening staat rood in februari', true) +
            '<span class="bx-note">Android kleurt de cirkel met de kleur die Saldo meegeeft: groen voor info, oker voor een waarschuwing, rood voor een fout.</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  // ---------- App icon files ----------

  function appIconSection() {
    const files = [
      ['app-icon.svg', 'Afgerond vierkant', 'Hoofdvorm. 96-raster, hoek 30.'],
      ['app-icon-round.svg', 'Rond · Android', 'Ronde vorm voor Android-launchers.'],
      ['statusbar-icon.svg', 'Statusbalk', 'Silhouet 24 × 24 dp, één kleur.'],
      ['favicon.svg', 'Favicon', 'Vereenvoudigd voor 32 en 16 px.']
    ];
    return '<section class="bx-section" id="app-icoon" aria-labelledby="app-icoon-h">' +
      '<div class="bx-section-head"><h2 id="app-icoon-h">App-icoon · Beurs</h2>' +
        '<p class="muted">Een munt die uit de portemonnee piept. Witte lijnen op groen #15803D, munt in #FFD59E.</p></div>' +
      '<div class="bx-files">' + files.map((f) =>
        '<a class="card bx-file" href="img/' + f[0] + '" download>' +
          '<span class="bx-file-art' + (f[0] === 'statusbar-icon.svg' ? ' bx-file-art--glyph' : '') + '"><img src="img/' + f[0] + '" width="72" height="72" alt=""></span>' +
          '<span class="bx-file-name">' + esc(f[1]) + '</span>' +
          '<span class="bx-file-sub mono">' + esc(f[0]) + '</span>' +
          '<span class="bx-file-sub">' + esc(f[2]) + '</span>' +
        '</a>').join('') +
      '</div>' +
    '</section>';
  }

  // ---------- Behaviour ----------

  function fitFrame(fr) {
    try {
      const body = fr.contentDocument && fr.contentDocument.body;
      // Content height plus the iframe's own top and bottom border.
      if (body) fr.style.height = Math.ceil(body.getBoundingClientRect().height + fr.offsetHeight - fr.clientHeight) + 'px';
    } catch (e) { /* not same-origin: keep the default height */ }
  }

  function fitFrames(root) {
    root.querySelectorAll('.bx-frame').forEach(fitFrame);
  }

  // The e-mails switch to dark with @media (prefers-color-scheme: dark), which follows the device.
  // When the page theme is forced, rewrite that media query inside the (same-origin) preview.
  function applyMailScheme(fr) {
    const forced = document.documentElement.dataset.theme;
    try {
      if (!fr.darkRule) {
        Array.from(fr.contentDocument.styleSheets).forEach((sh) => Array.from(sh.cssRules).forEach((r) => {
          if (r.media && r.media.mediaText.indexOf('prefers-color-scheme') >= 0) { fr.darkRule = r; fr.darkMedia = r.media.mediaText; }
        }));
      }
      if (fr.darkRule) fr.darkRule.media.mediaText = forced === 'dark' ? 'all' : forced === 'light' ? 'not all' : fr.darkMedia;
    } catch (e) { /* not same-origin: the e-mail follows the device */ }
  }

  function toggleNotification(btn) {
    const key = btn.dataset.toggle;
    const card = btn.closest('.bx-n');
    const now = !card.classList.contains('is-open');
    open[key] = now;
    card.classList.toggle('is-open', now);
    btn.setAttribute('aria-expanded', String(now));
    btn.setAttribute('aria-label', now ? 'Melding inklappen' : 'Melding openklappen');
  }

  function toggleText(btn) {
    const file = btn.dataset.txt;
    const pre = document.getElementById('txt-' + file);
    const now = !txtOpen[file];
    txtOpen[file] = now;
    btn.setAttribute('aria-expanded', String(now));
    btn.textContent = now ? 'Platte tekst verbergen' : 'Platte tekst';
    pre.hidden = !now;
    if (now && !pre.dataset.loaded) {
      pre.textContent = 'Laden…';
      fetch('emails/' + file + '.txt', { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
        .then((t) => { pre.textContent = t; pre.dataset.loaded = '1'; })
        .catch(() => { pre.textContent = 'Kon emails/' + file + '.txt niet laden.'; });
    }
  }

  function setTheme(v, root) {
    const el = document.documentElement;
    if (v === 'system') delete el.dataset.theme; else el.dataset.theme = v;
    try { localStorage.setItem('saldo.theme', v); } catch (e) { /* private mode */ }
    root.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === v)));
    root.querySelectorAll('.bx-frame').forEach(applyMailScheme);
    requestAnimationFrame(() => fitFrames(root));
  }

  function render(root) {
    root.innerHTML = header() + emailsSection() + pushSection() + iphoneSection() + iconSection() + appIconSection();

    root.querySelectorAll('.bx-frame').forEach((fr) => {
      fr.addEventListener('load', () => { applyMailScheme(fr); fitFrame(fr); });
    });

    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-toggle], [data-txt], [data-action], [data-theme-set]');
      if (!t) return;
      if (t.dataset.toggle) toggleNotification(t);
      else if (t.dataset.txt) toggleText(t);
      else if (t.dataset.themeSet) setTheme(t.dataset.themeSet, root);
      else if (t.dataset.action === 'reset') {
        open = {};
        document.getElementById('push-frames').innerHTML = pushFrames();
      }
    });

    let timer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => fitFrames(root), 120);
    });
  }

  render(document.getElementById('berichten'));
})(window.Saldo = window.Saldo || {});
