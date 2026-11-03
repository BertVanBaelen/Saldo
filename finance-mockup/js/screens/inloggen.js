// Inloggen: sign-in, e-mail code, first-admin setup, invitation, new password, expired link and rate limit.
// No design board: derived from the style of Rekeningen and the e-mails. Spec: analysis/screens/inloggen.md,
// concepts/authentication.md. Bare page (<body data-shell="none">): no sidebar, no tab bar.
// Every step is a hash (#inloggen, #code, #setup, #uitnodiging, #wachtwoord, #verlopen, #geblokkeerd) with an
// optional sub state after a slash (#code/fout, #setup/zwak, #verlopen/uitnodiging …) for deep links.
(function (S) {
  'use strict';

  const { esc } = S.fmt;
  const { icon, logo, paths } = S.icons;
  const D = S.data;

  // Screen-only icons (24 grid, stroke). A generic house with a node, not the Home Assistant logo.
  paths.homeAssistant = '<path d="M3 11.5 12 4l9 7.5"></path><path d="M5.5 9.8V20h13V9.8"></path><circle cx="12" cy="12.5" r="1.8"></circle><path d="M12 14.3V20"></path><path d="m9 16.6 3 1.6 3-1.6"></path>';
  paths.eyeOff = '<path d="M3 3l18 18"></path><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1"></path><path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>';

  // ---------- Demo values (mockup only) ----------

  const HOST = 'saldo.jouw-domein.be';
  const DEMO_CODE = '48291736';   // the code in emails/inlogcode.html
  const CODE_TRIES = 5;           // attempts per code
  const LOGIN_TRIES = 5;          // wrong sign-ins before the pause
  const RESEND_WAIT = 60;         // seconds between two code e-mails
  const RESEND_MAX = 3;           // extra codes per sign-in before the pause
  const BLOCK_MIN = 15;           // pause after too many attempts
  const MIN_LEN = 12;             // minimum password length
  const KNOWN = D.users.map((u) => u.email);
  const INVITE = { from: 'Bert', initial: 'B', tint: 'var(--c2)', email: 'partner@jouw-domein.be', role: 'Gebruiker', until: '25 nov, 20:14' };
  const RESET = { by: 'Bert', email: 'partner@jouw-domein.be', name: 'Partner', until: '11:02' };
  // A few entries of the common-password blocklist; the server checks a full list.
  const COMMON = ['wachtwoord', 'wachtwoord1', 'wachtwoord123', 'password', 'password1', 'password123', 'welkom', 'welkom123',
    'azerty', 'azertyuiop', 'qwerty', 'qwertyuiop', 'letmein', 'iloveyou', 'zomer2026', 'winter2026', 'voetbal', 'saldo'];

  // Where the code step comes from, where "back" goes and where it ends.
  const FLOWS = {
    inloggen: { back: 'inloggen', backLabel: 'Terug naar inloggen', next: 'index.html' },
    ha: { back: 'inloggen', backLabel: 'Terug naar inloggen', next: 'index.html' },
    setup: { back: 'setup', backLabel: 'E-mailadres aanpassen', next: 'index.html?demo=leeg', fresh: true },
    uitnodiging: { back: 'uitnodiging', backLabel: 'Terug', next: 'index.html?demo=leeg', fresh: true },
    wachtwoord: { back: 'wachtwoord', backLabel: 'Terug', next: 'index.html' }
  };

  // Expired or used links: what happened and what to do (no names, no accounts: the token is no longer valid).
  const EXPIRED = {
    '': { sub: 'Ze is verlopen of al gebruikt. Links voor de eerste setup, een uitnodiging of een nieuw wachtwoord werken maar één keer.',
      todo: ['Kreeg je een uitnodiging? Vraag wie je uitnodigde om een nieuwe. Een uitnodiging is 7 dagen geldig.',
        'Wilde je een nieuw wachtwoord kiezen? Vraag een beheerder om een nieuwe link. Die is 1 uur geldig.',
        'Heb je je account of wachtwoord al ingesteld? Dan log je gewoon in.'] },
    setup: { sub: 'De setuplink is 1 uur geldig en werkt één keer.',
      todo: ['Herstart de Saldo-add-on in Home Assistant.',
        'Open het logboek van de add-on. Zolang er nog geen beheerder is, staat daar na elke start een nieuwe setuplink.',
        'Is Saldo al ingesteld? Dan log je gewoon in.'] },
    uitnodiging: { sub: 'Een uitnodiging is 7 dagen geldig en werkt één keer.',
      todo: ['Vraag wie je uitnodigde om je opnieuw uit te nodigen. Je krijgt dan een nieuwe e-mail.',
        'Heb je je account al aangemaakt? Dan log je gewoon in met je e-mailadres en wachtwoord.'] },
    wachtwoord: { sub: 'Een link voor een nieuw wachtwoord is 1 uur geldig en werkt één keer.',
      todo: ['Vraag een beheerder om een nieuwe link.',
        'Heb je je nieuwe wachtwoord al gekozen? Dan log je ermee in.'] }
  };

  // Mockup-only list of every step and state (deep links)
  const MOCK = [
    ['inloggen', 'Inloggen'], ['inloggen/fout', 'Foute gegevens'], ['code', 'Code'], ['code/fout', 'Foute code'],
    ['code/laatste', 'Laatste poging'], ['code/op', 'Pogingen op'], ['code/verlopen', 'Code verlopen'], ['code/opnieuw', 'Nieuwe code'],
    ['code/limiet', 'Te veel codes'], ['code/ok', 'Gelukt'], ['code/ha', 'Via Home Assistant'], ['setup', 'Eerste beheerder'],
    ['setup/zwak', 'Zwak wachtwoord'], ['code/setup', 'Code na setup'], ['uitnodiging', 'Uitnodiging'], ['uitnodiging/zwak', 'Uitnodiging · fout'],
    ['wachtwoord', 'Nieuw wachtwoord'], ['code/wachtwoord', 'Code na wachtwoord'], ['verlopen', 'Link verlopen'], ['verlopen/setup', 'Setuplink verlopen'],
    ['verlopen/uitnodiging', 'Uitnodiging verlopen'], ['verlopen/wachtwoord', 'Wachtwoordlink verlopen'], ['geblokkeerd', 'Te veel pogingen']
  ];

  // ---------- State ----------

  const session = {
    get() { try { return JSON.parse(sessionStorage.getItem('saldo.inloggen')) || null; } catch (e) { return null; } },
    set(v) { try { sessionStorage.setItem('saldo.inloggen', JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  // Who the code goes to and which flow it belongs to; survives a reload of #code.
  let ctx = session.get() || { flow: 'inloggen', email: D.user.email, name: D.user.name };
  const setCtx = (c) => { ctx = c; session.set(c); };

  const emptyForms = () => ({
    login: { email: '', pw: '' },
    setup: { name: '', email: '', pw: '', pw2: '', submitted: false },
    uitnodiging: { name: '', pw: '', pw2: '', submitted: false },
    wachtwoord: { pw: '', pw2: '', submitted: false }
  });

  let page = null;
  let step = '';
  let sub = '';
  let animate = true;    // play the entry animation when a step opens
  let firstPaint = true;
  let mockOpen = false;
  let forms = emptyForms();
  let errors = {};       // input id → message for the current form
  let alertMsg = '';     // form-level message
  let loginFails = 0;
  let blockUntil = 0;
  let code = null;       // { digits, tries, state, resendAt, sends, limited }
  let redirect = 0;

  const offline = () => D.demo() === 'offline';
  const dis = () => (offline() ? ' disabled' : '');
  const secsLeft = (t) => Math.max(0, Math.ceil((t - Date.now()) / 1000));
  const mmss = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const mask = (email) => { const at = email.indexOf('@'); return at > 0 ? email.charAt(0) + '•••' + email.slice(at) : email; };
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  function isCommon(pw) {
    const p = pw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!p) return false;
    return COMMON.indexOf(p) >= 0 || /^(.)\1+$/.test(p) || /^\d+$/.test(p) ||
      /(wachtwoord|password|paswoord|welkom|azerty|qwerty|123456|saldo)/.test(p);
  }

  // ---------- Pieces ----------

  function progress(n) {
    return '<div class="il-progress">' +
      '<span class="il-progress-bar" aria-hidden="true"><i class="is-on"></i><i' + (n > 1 ? ' class="is-on"' : '') + '></i></span>' +
      '<span class="il-progress-text">Stap ' + n + ' van 2</span>' +
    '</div>';
  }

  function head(title, lead, badge) {
    return '<div class="il-head">' + (badge || '') +
      '<h1 id="il-title" tabindex="-1">' + esc(title) + '</h1>' +
      (lead ? '<p class="il-lead">' + lead + '</p>' : '') +
    '</div>';
  }

  function badge(tone, name) {
    return '<span class="il-badge il-badge--' + tone + '" aria-hidden="true">' + icon(name, 24, 2.2) + '</span>';
  }

  function alertBox(tone, text, name) {
    return '<div class="il-alert il-alert--' + tone + '" role="' + (tone === 'neg' ? 'alert' : 'status') + '">' +
      icon(name || (tone === 'ok' ? 'check' : 'warning'), 18, 2.2) + '<span>' + text + '</span></div>';
  }

  function offlineNote() {
    return offline() ? alertBox('warn', '<strong>Je bent offline.</strong> Inloggen kan pas als je weer verbinding hebt.', 'cloudOff') : '';
  }

  function submit(label, disabled) {
    return '<button type="submit" class="btn btn--primary btn--block il-submit"' + (disabled || offline() ? ' disabled' : '') + '>' + esc(label) + '</button>';
  }

  // One labelled input. o: { id, label, type, auto, value, bind, help, readonly, pw, rules, match, quiet }
  function field(o) {
    const err = errors[o.id];
    const desc = [o.help ? o.id + '-help' : '', o.rules ? o.id + '-rules' : '', o.match ? o.id + '-match' : '',
      err && !o.quiet ? o.id + '-err' : ''].filter(Boolean).join(' ');
    const type = o.pw ? 'password' : (o.type || 'text');
    let control = '<input class="input il-input" id="' + o.id + '" name="' + o.id + '" type="' + type + '"' +
      (o.auto ? ' autocomplete="' + o.auto + '"' : '') +
      (type === 'email' ? ' inputmode="email" autocapitalize="off" spellcheck="false"' : '') +
      ' value="' + esc(o.value || '') + '"' + (o.readonly ? ' readonly' : '') +
      (err ? ' aria-invalid="true"' : '') + (desc ? ' aria-describedby="' + desc + '"' : '') +
      (o.bind ? ' data-bind="' + o.bind + '"' : '') + '>';
    if (o.pw) {
      control = '<div class="il-pw">' + control +
        '<button type="button" class="il-eye" aria-label="Wachtwoord tonen" aria-pressed="false" aria-controls="' + o.id + '" data-action="eye" data-for="' + o.id + '">' +
          icon('eye', 20, 2) + '</button></div>';
    }
    if (o.readonly) control = '<div class="il-fixed">' + control + '<span class="il-fixed-icon" aria-hidden="true">' + icon('lock', 16, 2.2) + '</span></div>';
    return '<div class="il-field">' +
      '<label class="il-label" for="' + o.id + '">' + esc(o.label) + '</label>' + control +
      (o.rules ? '<ul class="il-rules" id="' + o.id + '-rules" data-rules="' + o.rules + '">' + rulesHtml(forms[o.rules]) + '</ul>' : '') +
      (o.match ? '<span class="il-match" id="' + o.id + '-match" data-match="' + o.match + '" aria-live="polite">' + matchHtml(forms[o.match]) + '</span>' : '') +
      (o.help ? '<span class="il-help" id="' + o.id + '-help">' + o.help + '</span>' : '') +
      (err && !o.quiet ? '<span class="il-field-error" id="' + o.id + '-err">' + icon('warning', 14, 2.2) + esc(err) + '</span>' : '') +
    '</div>';
  }

  // Live password feedback: minimum length and the common-password blocklist
  function rulesHtml(f) {
    const pw = f.pw;
    const len = pw.length >= MIN_LEN;
    const common = isCommon(pw);
    const li = (state, text) => '<li class="' + (state ? 'is-' + state : '') + '"><span class="il-rule-dot" aria-hidden="true">' +
      (state === 'ok' ? icon('check', 11, 3.4) : state === 'bad' ? icon('close', 10, 3.4) : '') + '</span><span>' + text +
      (state === 'ok' ? '<span class="visually-hidden"> (in orde)</span>' : '') + '</span></li>';
    return li(len ? 'ok' : (f.submitted ? 'bad' : ''), 'Minstens ' + MIN_LEN + ' tekens' + (pw && !len ? ' · nu ' + pw.length : '')) +
      (common ? li('bad', 'Dit wachtwoord wordt te vaak gebruikt. Kies iets anders.')
        : li(len ? 'ok' : '', 'Geen veelgebruikt wachtwoord'));
  }

  function matchHtml(f) {
    const err = (t) => icon('warning', 14, 2.2) + '<span>' + t + '</span>';
    if (!f.pw2) return f.submitted ? '<span class="il-match-bad">' + err('Herhaal je wachtwoord.') + '</span>' : '';
    if (f.pw2 === f.pw) return '<span class="il-match-ok">' + icon('check', 14, 2.6) + '<span>De wachtwoorden zijn gelijk.</span></span>';
    if (f.submitted || f.pw2.length >= f.pw.length) return '<span class="il-match-bad">' + err('De wachtwoorden zijn niet gelijk.') + '</span>';
    return '';
  }

  // "Wachtwoord" + "Herhaal wachtwoord" for setup, invitation and reset
  function newPassword(form, label) {
    const f = forms[form];
    return field({ id: 'il-' + form + '-pw', label: label || 'Wachtwoord', pw: true, auto: 'new-password', value: f.pw, bind: form + '.pw',
        rules: form, quiet: true, help: 'Tip: een zin van vier losse woorden is sterk en makkelijk te onthouden.' }) +
      field({ id: 'il-' + form + '-pw2', label: 'Herhaal wachtwoord', pw: true, auto: 'new-password', value: f.pw2, bind: form + '.pw2',
        match: form, quiet: true });
  }

  function trustNote(fresh) {
    return '<div class="il-trust">' +
      '<span class="il-trust-icon" aria-hidden="true">' + icon('shield', 18, 2.2) + '</span>' +
      '<span class="il-trust-text"><strong>Dit toestel blijft aangemeld</strong>' +
        '<span>Je hoeft hier niet telkens opnieuw in te loggen. Pas na 90 dagen zonder gebruik vraagt Saldo weer je wachtwoord en een code.</span>' +
        '<span>' + (fresh
          ? 'Log je later in op een ander toestel, dan krijg je een pushmelding en een e-mail.'
          : 'Bij elk nieuw toestel, ook dit, krijg je een pushmelding en een e-mail.') +
        ' Afmelden kan in Instellingen → Toestellen.</span>' +
      '</span>' +
    '</div>';
  }

  // ---------- Steps ----------

  function stepLogin() {
    const f = forms.login;
    return progress(1) +
      head('Inloggen', 'Log in met je e-mailadres en wachtwoord. Daarna sturen we je een code per e-mail.') +
      offlineNote() +
      (alertMsg ? alertBox('neg', esc(alertMsg)) : '') +
      '<form class="il-form" data-form="login" novalidate>' +
        field({ id: 'il-email', label: 'E-mailadres', type: 'email', auto: 'username', value: f.email, bind: 'login.email' }) +
        field({ id: 'il-pw', label: 'Wachtwoord', pw: true, auto: 'current-password', value: f.pw, bind: 'login.pw' }) +
        submit('Verder') +
      '</form>' +
      '<div class="il-or"><span>of</span></div>' +
      '<button type="button" class="btn btn--ghost btn--block il-btn" data-action="ha"' + dis() + '>' + icon('homeAssistant', 20, 2) + 'Inloggen met Home Assistant</button>' +
      '<p class="il-hint">Wachtwoord vergeten? Vraag een beheerder om een nieuwe link.</p>';
  }

  function codeAlert() {
    if (code.limited) {
      return alertBox('warn', code.tries === 0 || code.state === 'expired'
        ? 'Je vroeg al ' + RESEND_MAX + ' nieuwe codes en deze werkt niet meer. Probeer het over ' + BLOCK_MIN + ' minuten opnieuw.'
        : 'Je vroeg al ' + RESEND_MAX + ' nieuwe codes. De laatste werkt nog; een nieuwe kan pas over ' + BLOCK_MIN + ' minuten.', 'clock');
    }
    if (code.state === 'expired') return alertBox('warn', 'Deze code is verlopen. Vraag hieronder een nieuwe code aan.', 'clock');
    if (code.tries === 0) return alertBox('neg', 'Te veel foute pogingen. Deze code werkt niet meer. Vraag hieronder een nieuwe code aan.');
    if (code.state === 'wrong') return alertBox('neg', 'Deze code klopt niet. ' + (code.tries === 1 ? 'Nog 1 poging.' : 'Nog ' + code.tries + ' pogingen.'));
    if (code.state === 'short') return alertBox('neg', 'Vul alle 8 cijfers in.');
    if (code.state === 'sent') return alertBox('ok', 'Nieuwe code verstuurd. De vorige code werkt niet meer.', 'mail');
    return '';
  }

  function digits(dead) {
    let h = '';
    for (let i = 0; i < 8; i++) {
      if (i === 4) h += '<span class="il-code-gap" aria-hidden="true"></span>';
      h += '<input class="il-digit" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="' + (i === 0 ? 'one-time-code' : 'off') + '"' +
        ' aria-label="Cijfer ' + (i + 1) + ' van 8" data-i="' + i + '" value="' + esc(code.digits[i] || '') + '"' +
        (code.state === 'wrong' || code.state === 'short' ? ' aria-invalid="true"' : '') + (dead || offline() ? ' disabled' : '') + '>';
    }
    return h;
  }

  function resendRow(dead) {
    const left = secsLeft(code.resendAt);
    let ctl = '';
    if (code.limited) ctl = '<span>Een nieuwe code kan over ' + BLOCK_MIN + ' minuten.</span>';
    else if (left > 0) ctl = '<span>Nieuwe code sturen kan over <span class="mono" data-countdown>' + mmss(left) + '</span></span>';
    else if (!dead) ctl = '<button type="button" class="il-link" data-action="resend"' + dis() + '>Nieuwe code sturen</button>';
    return '<div class="il-resend" id="il-resend"><span>Geen e-mail gekregen? Kijk ook bij ongewenste mail.</span>' + ctl + '</div>';
  }

  function stepCode() {
    if (code.state === 'ok') return stepDone();
    const fl = FLOWS[ctx.flow] || FLOWS.inloggen;
    // A used-up or expired code cannot be entered any more: the main button asks for a new one.
    const dead = code.tries === 0 || code.state === 'expired';
    const lead = (ctx.flow === 'ha' ? 'Home Assistant herkende je als ' + esc(ctx.name) + '. ' : '') +
      'We stuurden een code naar <strong>' + esc(mask(ctx.email)) + '</strong>. Ze is 10 minuten geldig en werkt één keer.' +
      (fl.fresh ? ' Zo weten we meteen dat je e-mail aankomt.' : '');
    const main = dead
      ? '<button type="button" class="btn btn--primary btn--block il-submit" data-action="resend"' +
          (code.limited || secsLeft(code.resendAt) > 0 || offline() ? ' disabled' : '') + '>Nieuwe code sturen</button>'
      : submit(fl.fresh ? 'Bevestigen' : 'Inloggen');
    return progress(2) +
      head(fl.fresh ? 'Bevestig je e-mailadres' : 'Vul je code in', lead) +
      offlineNote() +
      codeAlert() +
      '<form class="il-form" data-form="code" novalidate>' +
        '<div class="il-field">' +
          '<span class="il-label" id="il-code-label">Code uit de e-mail</span>' +
          '<div class="il-code' + (code.state === 'wrong' || code.state === 'short' ? ' is-error' : '') + '" role="group" aria-labelledby="il-code-label" aria-describedby="il-code-help">' +
            digits(dead) + '</div>' +
          '<span class="il-help" id="il-code-help">8 cijfers, in twee groepjes van 4. Plakken kan ook.</span>' +
        '</div>' +
        main +
      '</form>' +
      resendRow(dead) +
      trustNote(fl.fresh) +
      '<button type="button" class="il-back" data-action="go" data-to="' + fl.back + '">' + icon('back', 16, 2.4) + esc(fl.backLabel) + '</button>';
  }

  function stepDone() {
    const fl = FLOWS[ctx.flow] || FLOWS.inloggen;
    const name = esc(ctx.name || '');
    let title = 'Je bent ingelogd';
    let lead = 'Dit toestel blijft aangemeld. Je gaat meteen naar Start.';
    if (ctx.flow === 'setup') { title = 'Saldo is klaar'; lead = 'Welkom, ' + name + '. Je bent beheerder en dit toestel blijft aangemeld. Koppel nu je eerste rekening of nodig iemand uit.'; }
    if (ctx.flow === 'uitnodiging') { title = 'Je account is klaar'; lead = 'Welkom bij Saldo, ' + name + '. Dit toestel blijft aangemeld. Koppel nu je eerste rekening.'; }
    if (ctx.flow === 'wachtwoord') { title = 'Je nieuwe wachtwoord werkt'; lead = 'Je bent ingelogd. Je andere toestellen zijn afgemeld; daar log je opnieuw in.'; }
    return '<div class="il-done">' +
      head(title, lead, badge('ok', 'check')) +
      '<a class="btn btn--primary btn--block il-submit" href="' + fl.next + '">Naar Start</a>' +
    '</div>';
  }

  function stepSetup() {
    const f = forms.setup;
    return progress(1) +
      head('Saldo instellen', 'Maak het eerste account aan. Jij wordt beheerder: je nodigt daarna anderen uit en beheert hun logins, nooit hun rekeningen.', badge('ok', 'key')) +
      '<p class="il-meta">' + icon('clock', 16, 2.2) + '<span>Deze setuplink komt uit het logboek van de add-on. Ze is 1 uur geldig en werkt één keer.</span></p>' +
      offlineNote() +
      '<form class="il-form" data-form="setup" novalidate>' +
        field({ id: 'il-setup-name', label: 'Naam', auto: 'name', value: f.name, bind: 'setup.name', help: 'Zo zien anderen je in Saldo.' }) +
        field({ id: 'il-setup-email', label: 'E-mailadres', type: 'email', auto: 'username', value: f.email, bind: 'setup.email', help: 'Hier komen je inlogcodes en meldingen.' }) +
        newPassword('setup') +
        submit('Account aanmaken') +
      '</form>';
  }

  function stepInvite() {
    const f = forms.uitnodiging;
    return progress(1) +
      '<div class="il-from">' +
        '<span class="avatar avatar--md" style="background:' + INVITE.tint + '" aria-hidden="true">' + esc(INVITE.initial) + '</span>' +
        '<span class="il-from-text"><strong>' + esc(INVITE.from) + ' nodigt je uit voor Saldo</strong>' +
          '<span>Als ' + esc(INVITE.role) + ' · link geldig tot ' + esc(INVITE.until) + '</span></span>' +
      '</div>' +
      head('Maak je account aan', 'Kies je naam en een wachtwoord. Je ziet alleen je eigen rekeningen en de rekeningen die je deelt.') +
      offlineNote() +
      '<form class="il-form" data-form="uitnodiging" novalidate>' +
        field({ id: 'il-uitnodiging-email', label: 'E-mailadres', type: 'email', auto: 'username', value: INVITE.email, readonly: true,
          help: esc(INVITE.from) + ' koos dit adres. Hier komen je inlogcodes.' }) +
        field({ id: 'il-uitnodiging-name', label: 'Naam', auto: 'name', value: f.name, bind: 'uitnodiging.name', help: 'Zo zien anderen je in Saldo.' }) +
        newPassword('uitnodiging') +
        submit('Account aanmaken') +
      '</form>';
  }

  function stepReset() {
    return progress(1) +
      head('Kies een nieuw wachtwoord', esc(RESET.by) + ' maakte deze link voor je aan. Ze is geldig tot ' + esc(RESET.until) + ' en werkt één keer.') +
      offlineNote() +
      '<form class="il-form" data-form="wachtwoord" novalidate>' +
        field({ id: 'il-wachtwoord-email', label: 'E-mailadres', type: 'email', auto: 'username', value: RESET.email, readonly: true }) +
        newPassword('wachtwoord', 'Nieuw wachtwoord') +
        '<p class="il-meta">' + icon('info', 16, 2.2) + '<span>Na het opslaan meldt Saldo je af op al je toestellen. Hier log je meteen weer in met een code.</span></p>' +
        submit('Wachtwoord opslaan') +
      '</form>';
  }

  function stepExpired() {
    const x = EXPIRED[sub] || EXPIRED[''];
    return head('Deze link werkt niet meer', esc(x.sub), badge('warn', 'clock')) +
      '<div class="il-field">' +
        '<h2 class="il-label" id="il-todo-h">Wat kan je doen?</h2>' +
        '<ol class="il-todo" aria-labelledby="il-todo-h">' + x.todo.map((t, i) =>
          '<li><span class="il-todo-n" aria-hidden="true">' + (i + 1) + '</span><span>' + esc(t) + '</span></li>').join('') + '</ol>' +
      '</div>' +
      '<a class="btn btn--ghost btn--block il-btn" href="#inloggen">Naar inloggen</a>';
  }

  function stepBlocked() {
    const left = secsLeft(blockUntil);
    return head('Te veel pogingen', 'Om je account te beschermen kan je even niet inloggen. Probeer het over ' + BLOCK_MIN + ' minuten opnieuw.', badge('neg', 'lock')) +
      '<div class="il-wait"><span>Opnieuw proberen kan over</span><span class="mono il-wait-time" data-countdown>' + mmss(left) + '</span></div>' +
      '<p class="il-hint">Wachtwoord vergeten? Vraag een beheerder om een nieuwe link.</p>' +
      '<button type="button" class="btn btn--ghost btn--block il-btn" data-action="retry"' + (left > 0 ? ' disabled' : '') + '>Opnieuw proberen</button>';
  }

  const STEPS = {
    inloggen: { title: 'Inloggen', render: stepLogin },
    code: { title: 'Code', render: stepCode },
    setup: { title: 'Saldo instellen', render: stepSetup },
    uitnodiging: { title: 'Uitnodiging', render: stepInvite },
    wachtwoord: { title: 'Nieuw wachtwoord', render: stepReset },
    verlopen: { title: 'Link werkt niet meer', render: stepExpired },
    geblokkeerd: { title: 'Te veel pogingen', render: stepBlocked }
  };

  // ---------- Routing and painting ----------

  function route() {
    const parts = location.hash.replace(/^#/, '').split('/');
    return { step: STEPS[parts[0]] ? parts[0] : 'inloggen', sub: parts[1] || '' };
  }

  function newCode() {
    return { digits: [], tries: CODE_TRIES, state: '', resendAt: Date.now() + RESEND_WAIT * 1000, sends: 0, limited: false };
  }

  // Weak password and mismatch, as after pressing the button (deep link /zwak)
  function weak(form) {
    const f = forms[form];
    f.pw = 'wachtwoord123';
    f.pw2 = 'wachtwoord12';
    if (form === 'setup') { f.name = 'Bert'; f.email = 'bert@jouw-domein.be'; }
    if (form === 'uitnodiging') f.name = '';
    f.submitted = true;
    errors = validate(form);
  }

  // Open a step and set up the state of its sub state
  function enter(r) {
    clearTimeout(redirect);
    step = r.step;
    sub = r.sub;
    errors = {};
    alertMsg = '';
    animate = true;
    if (step === 'inloggen' && sub === 'fout') {
      forms.login = { email: D.user.email, pw: '' };
      alertMsg = 'E-mailadres of wachtwoord klopt niet.';
    }
    if (step === 'code') {
      if (FLOWS[sub]) {
        const who = sub === 'setup' ? { email: D.user.email, name: D.user.name }
          : (sub === 'inloggen' || sub === 'ha') ? { email: D.user.email, name: D.user.name } : { email: INVITE.email, name: 'Partner' };
        setCtx({ flow: sub, email: who.email, name: who.name });
      }
      code = newCode();
      if (sub === 'fout') { code.tries = CODE_TRIES - 1; code.state = 'wrong'; }
      if (sub === 'laatste') { code.tries = 1; code.state = 'wrong'; }
      if (sub === 'op') { code.tries = 0; code.state = 'used'; code.resendAt = 0; }
      if (sub === 'verlopen') { code.state = 'expired'; code.resendAt = 0; }
      if (sub === 'opnieuw') code.resendAt = 0;
      if (sub === 'limiet') { code.limited = true; code.sends = RESEND_MAX; code.resendAt = 0; }
      if (sub === 'ok') code.state = 'ok';
    }
    if ((step === 'setup' || step === 'uitnodiging' || step === 'wachtwoord') && sub === 'zwak') weak(step);
    if (step === 'geblokkeerd' && blockUntil < Date.now()) blockUntil = Date.now() + BLOCK_MIN * 60000;
    document.title = STEPS[step].title + ' · Saldo';
  }

  function mockNav() {
    const cur = step + (sub ? '/' + sub : '');
    return '<details class="il-mock"' + (mockOpen ? ' open' : '') + '>' +
      '<summary>Mockup: alle stappen</summary>' +
      '<p>Demo-code <span class="mono">4829 1736</span>. Een onbekend e-mailadres of het wachtwoord <span class="mono">fout</span> geeft de foutmelding; na ' + LOGIN_TRIES + ' keer volgt de pauze.</p>' +
      '<nav class="il-mock-links" aria-label="Mockup-stappen">' + MOCK.map((m) =>
        '<a href="#' + m[0] + '"' + (m[0] === cur ? ' aria-current="page"' : '') + '>' + esc(m[1]) + '</a>').join('') + '</nav>' +
    '</details>';
  }

  function paint() {
    page.innerHTML =
      '<header class="il-brand' + (firstPaint ? ' anim-fade' : '') + '">' + logo(52) +
        '<span class="il-brand-name">Saldo</span><span class="il-brand-host">' + HOST + '</span></header>' +
      '<section class="il-card' + (animate ? ' anim-in' : '') + '" aria-labelledby="il-title">' + STEPS[step].render() + '</section>' +
      '<p class="il-foot">Saldo draait op je eigen Home Assistant.</p>' +
      mockNav();
    firstPaint = false;
    animate = false;
  }

  function paintCard() {
    const card = page.querySelector('.il-card');
    if (card) card.innerHTML = STEPS[step].render();
  }

  // Focus after a step opens: an invalid field, the first usable field, else the heading (not on first load)
  function focusStep(firstLoad) {
    const invalid = page.querySelector('.il-card input[aria-invalid="true"]:not(:disabled)');
    const first = page.querySelector('.il-card .il-digit:not(:disabled), .il-card input:not([readonly]):not(:disabled)');
    const resend = page.querySelector('.il-card [data-action="resend"]:not(:disabled)');
    const target = invalid || first || resend || (firstLoad ? null : page.querySelector('#il-title'));
    if (target) target.focus();
  }

  function focusInvalid() {
    const el = page.querySelector('.il-card [aria-invalid="true"]');
    if (el) el.focus();
  }

  function go(to) {
    if (location.hash === '#' + to) { enter(route()); paint(); focusStep(); } else location.hash = to;
  }

  function busy(btn, label) {
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="il-spin">' + icon('sync', 18, 2.4) + '</span>' + esc(label);
  }

  // ---------- Forms ----------

  function validate(form) {
    const f = forms[form];
    const e = {};
    const id = (k) => 'il-' + form + '-' + k;
    if ('name' in f && !f.name.trim()) e[id('name')] = 'Vul je naam in.';
    if (form === 'setup' && !validEmail(f.email)) e[id('email')] = f.email.trim() ? 'Dit is geen geldig e-mailadres.' : 'Vul je e-mailadres in.';
    if (f.pw.length < MIN_LEN || isCommon(f.pw)) e[id('pw')] = 'Kies een sterker wachtwoord.';
    if (!f.pw2 || f.pw2 !== f.pw) e[id('pw2')] = 'De wachtwoorden zijn niet gelijk.';
    return e;
  }

  function submitLogin(btn) {
    const f = forms.login;
    const email = f.email.trim().toLowerCase();
    errors = {};
    alertMsg = '';
    if (!email) errors['il-email'] = 'Vul je e-mailadres in.';
    if (!f.pw) errors['il-pw'] = 'Vul je wachtwoord in.';
    if (Object.keys(errors).length) { paintCard(); focusInvalid(); return; }
    busy(btn, 'Even geduld…');
    // Same answer and timing for an unknown e-mail and a wrong password: no account enumeration.
    setTimeout(() => {
      if (KNOWN.indexOf(email) < 0 || f.pw === 'fout') {
        loginFails++;
        f.pw = '';
        if (loginFails >= LOGIN_TRIES) { loginFails = 0; go('geblokkeerd'); return; }
        alertMsg = 'E-mailadres of wachtwoord klopt niet.';
        paintCard();
        const pw = page.querySelector('#il-pw');
        if (pw) pw.focus();
        return;
      }
      const u = D.users.find((x) => x.email === email);
      f.pw = '';
      loginFails = 0;
      setCtx({ flow: 'inloggen', email, name: u.name });
      go('code');
    }, 450);
  }

  function submitNew(form, btn) {
    const f = forms[form];
    f.submitted = true;
    errors = validate(form);
    if (Object.keys(errors).length) { paintCard(); focusInvalid(); return; }
    busy(btn, 'Even geduld…');
    setTimeout(() => {
      if (form === 'setup') setCtx({ flow: 'setup', email: f.email.trim(), name: f.name.trim() });
      if (form === 'uitnodiging') setCtx({ flow: 'uitnodiging', email: INVITE.email, name: f.name.trim() });
      if (form === 'wachtwoord') setCtx({ flow: 'wachtwoord', email: RESET.email, name: RESET.name });
      go('code');
    }, 450);
  }

  function checkCode() {
    const v = code.digits.join('');
    if (v.length < 8 || code.digits.some((d) => !d)) {
      code.state = 'short';
      paintCard();
      const empty = Array.from(page.querySelectorAll('.il-digit')).find((d) => !d.value);
      if (empty) empty.focus();
      return;
    }
    const btn = page.querySelector('.il-card .il-submit');
    page.querySelectorAll('.il-digit').forEach((d) => { d.disabled = true; });
    busy(btn, 'Controleren…');
    setTimeout(() => {
      if (v === DEMO_CODE) {
        code.state = 'ok';
        paintCard();
        page.querySelector('#il-title').focus();
        const next = (FLOWS[ctx.flow] || FLOWS.inloggen).next;
        redirect = setTimeout(() => { location.href = next; }, 1600);
        return;
      }
      code.tries = Math.max(0, code.tries - 1);
      code.state = code.tries > 0 ? 'wrong' : 'used';
      code.digits = [];
      paintCard();
      focusStep();
    }, 450);
  }

  function resend() {
    code.sends++;
    if (code.sends > RESEND_MAX) {
      code.limited = true;
    } else {
      code.digits = [];
      code.tries = CODE_TRIES;
      code.state = 'sent';
      code.resendAt = Date.now() + RESEND_WAIT * 1000;
      S.shell.toast('Nieuwe code verstuurd (mockup)');
    }
    paintCard();
    focusStep();
  }

  // ---------- Events ----------

  function digitEls() { return Array.from(page.querySelectorAll('.il-digit')); }

  // Put digits into the boxes from `start`; returns the index after the last one
  function fillDigits(start, str) {
    const els = digitEls();
    let i = start;
    str.replace(/\D/g, '').split('').forEach((d) => {
      if (i < 8) { code.digits[i] = d; els[i].value = d; i++; }
    });
    return i;
  }

  function afterFill(next) {
    const els = digitEls();
    if (code.digits.filter(Boolean).length === 8 && els.every((d) => d.value)) checkCode();
    else if (next < 8) { els[next].focus(); els[next].select(); }
  }

  function onDigitInput(el) {
    const i = Number(el.dataset.i);
    const v = el.value.replace(/\D/g, '');
    if (!v) { el.value = ''; code.digits[i] = ''; return; }
    // One typed digit (replacing the old one), or a whole code from autofill or a paste into one box
    let str = v;
    if (v.length === 2 && code.digits[i]) str = v.charAt(0) === code.digits[i] ? v.charAt(1) : v.charAt(0);
    afterFill(fillDigits(v.length >= 8 ? 0 : i, str));
  }

  function onKey(e) {
    const el = e.target;
    if (!el.classList || !el.classList.contains('il-digit')) return;
    const i = Number(el.dataset.i);
    const els = digitEls();
    if (e.key === 'Backspace' && !el.value && i > 0) {
      e.preventDefault();
      els[i - 1].value = '';
      code.digits[i - 1] = '';
      els[i - 1].focus();
    } else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); els[i - 1].focus(); els[i - 1].select(); }
    else if (e.key === 'ArrowRight' && i < 7) { e.preventDefault(); els[i + 1].focus(); els[i + 1].select(); }
  }

  function onPaste(e) {
    const el = e.target;
    if (!el.classList || !el.classList.contains('il-digit')) return;
    const text = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '');
    if (!text) return;
    e.preventDefault();
    afterFill(fillDigits(text.length >= 8 ? 0 : Number(el.dataset.i), text));
  }

  function onInput(e) {
    const el = e.target;
    if (el.classList.contains('il-digit')) { onDigitInput(el); return; }
    const bind = el.dataset.bind;
    if (!bind) return;
    const [form, key] = bind.split('.');
    forms[form][key] = el.value;
    if (key === 'pw' || key === 'pw2') {
      const rules = page.querySelector('[data-rules="' + form + '"]');
      if (rules) rules.innerHTML = rulesHtml(forms[form]);
      const match = page.querySelector('[data-match="' + form + '"]');
      if (match) match.innerHTML = matchHtml(forms[form]);
    }
  }

  function onSubmit(e) {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    if (offline()) { S.shell.toast('Je bent offline'); return; }
    const btn = form.querySelector('.il-submit');
    const kind = form.dataset.form;
    if (kind === 'login') submitLogin(btn);
    else if (kind === 'code') checkCode();
    else submitNew(kind, btn);
  }

  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const act = el.dataset.action;
    if (act === 'eye') {
      const input = page.querySelector('#' + el.dataset.for);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      el.setAttribute('aria-pressed', String(show));
      el.innerHTML = icon(show ? 'eyeOff' : 'eye', 20, 2);
    } else if (act === 'ha') {
      busy(el, 'Naar Home Assistant…');
      setTimeout(() => {
        setCtx({ flow: 'ha', email: D.user.email, name: D.user.name });
        go('code');
        S.shell.toast('Home Assistant bevestigde je (mockup)');
      }, 900);
    } else if (act === 'resend') resend();
    else if (act === 'retry') go('inloggen');
    else if (act === 'go') go(el.dataset.to);
  }

  // Countdowns for "Nieuwe code sturen" and the pause, updated in place
  function tick() {
    if (step === 'code' && code && code.state !== 'ok' && !code.limited) {
      const cd = page.querySelector('#il-resend [data-countdown]');
      if (cd) {
        const left = secsLeft(code.resendAt);
        const dead = code.tries === 0 || code.state === 'expired';
        if (left > 0) cd.textContent = mmss(left);
        else {
          page.querySelector('#il-resend').outerHTML = resendRow(dead);
          const main = page.querySelector('.il-submit[data-action="resend"]');
          if (main && !offline()) main.disabled = false;
        }
      }
    }
    if (step === 'geblokkeerd') {
      const left = secsLeft(blockUntil);
      const cd = page.querySelector('.il-wait [data-countdown]');
      if (cd) cd.textContent = mmss(left);
      const btn = page.querySelector('[data-action="retry"]');
      if (btn && left === 0) btn.disabled = false;
    }
  }

  // ---------- Screen ----------

  function render(p) {
    page = p;
    if (!page.dataset.ilWired) {
      page.dataset.ilWired = '1';
      enter(route());
      page.addEventListener('submit', onSubmit);
      page.addEventListener('click', onClick);
      page.addEventListener('input', onInput);
      page.addEventListener('keydown', onKey);
      page.addEventListener('paste', onPaste);
      page.addEventListener('focusin', (e) => { if (e.target.classList.contains('il-digit')) e.target.select(); });
      page.addEventListener('toggle', (e) => { if (e.target.classList.contains('il-mock')) mockOpen = e.target.open; }, true);
      window.addEventListener('hashchange', () => { enter(route()); paint(); focusStep(); });
      setInterval(tick, 1000);
      paint();
      // Keyboard focus on the first field on desktop; on a phone that would open the keyboard over the card.
      if (window.matchMedia('(min-width: 1024px)').matches) focusStep(true);
      return;
    }
    paint();
  }

  S.screens = S.screens || {};
  S.screens.inloggen = { title: 'Inloggen', render };
})(window.Saldo = window.Saldo || {});
