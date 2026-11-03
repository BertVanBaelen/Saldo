// Rekeningen: name, colour and minimum buffer per account, the add-account chooser and the empty state.
// Design boards: Telefoon-Rekeningen, Desktop-Rekeningen. Spec: analysis/screens/rekeningen.md.
// Phone: list + bottom sheet. Desktop: list + settings panel on the right.
// This file also defines Saldo.accountKit: account helpers and the settings form shared with the account
// detail page (rekening.html loads this script before js/screens/rekening.js).
(function (S) {
  'use strict';

  const { eur, esc, MONTHS } = S.fmt;
  const icon = S.icon;
  const D = S.data;
  const store = S.shell.store;

  // =====================================================================
  // Account kit (shared with rekening.html)
  // =====================================================================

  // Account colour palette, 8 choices (tokens --a-* in css/tokens.css)
  const COLORS = [['green', 'Groen'], ['violet', 'Violet'], ['blue', 'Blauw'], ['teal', 'Petrol'], ['orange', 'Oranje'], ['pink', 'Roze'], ['yellow', 'Oker'], ['gray', 'Grijs']];
  const STEP = 5000; // € 50 per − / + press
  const acc = (color) => 'var(--a-' + color + ')';
  const isOffline = () => D.demo() === 'offline';

  // Saved edits per account, per viewer: { id: { name, color, buffer, iban, balance, updated, updates, perms, split } }
  function loadEdits() {
    try { return JSON.parse(store.get('rekeningen', '{}')) || {}; } catch (e) { return {}; }
  }
  function saveEdits(id, patch) {
    const all = loadEdits();
    all[id] = Object.assign({}, all[id] || {}, patch);
    store.set('rekeningen', JSON.stringify(all));
  }

  // "12.900,00", "€ 900", "−25,5" → cents; NaN when it is not an amount
  function parseMoney(s) {
    let t = String(s).replace(/[\s€]/g, '').replace(/\u2212/g, '-');
    if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    return /^-?\d+(\.\d{1,2})?$/.test(t) ? Math.round(parseFloat(t) * 100) : NaN;
  }
  // 1290000 → "12.900,00" (for an input after a € prefix)
  const inputMoney = (cents) => eur(cents).replace('€ ', '');

  // "3 juni 2026" → 20260603, to find the longest-standing member
  function dateKey(s) {
    const p = String(s).split(' ');
    return (+p[2]) * 10000 + (MONTHS.indexOf(p[1]) + 1) * 100 + (+p[0]);
  }

  // "Partner", "Partner en Sam", "An, Partner en Sam"
  function names(list) {
    if (list.length <= 1) return list[0] || '';
    return list.slice(0, -1).join(', ') + ' en ' + list[list.length - 1];
  }

  // Members of a shared account, manager first, then by date joined. Saved permission and split edits applied.
  // Demo state "lezen": Partner linked first and is the manager; Bert is a member with Lezen.
  function members(id) {
    const ed = loadEdits()[id] || {};
    const list = (D.members[id] || []).map((m) => Object.assign({}, m));
    if (D.readOnly(id)) {
      list.forEach((m) => {
        if (m.me) Object.assign(m, { role: 'member', perm: 'read', since: '5 juni 2026' });
        else if (m.role === 'manager' || m.who === D.partner.name) Object.assign(m, { role: 'manager', perm: 'edit', since: '3 juni 2026' });
      });
    } else if (ed.perms) {
      list.forEach((m) => { if (ed.perms[m.who] && m.role !== 'manager') m.perm = ed.perms[m.who]; });
    }
    if (ed.split) list.forEach((m) => { if (ed.split[m.who] !== undefined) m.share = ed.split[m.who]; });
    return list.sort((a, b) => (a.role === 'manager' ? -1 : (b.role === 'manager' ? 1 : dateKey(a.since) - dateKey(b.since))));
  }
  const others = (id) => members(id).filter((m) => !m.me);
  const manager = (id) => members(id).find((m) => m.role === 'manager');
  const withText = (id) => 'met ' + names(others(id).map((m) => m.who));

  // Sync story per demo state, as on Start: "verouderd" = the bank sent no new data for the shared account since
  // Sunday 15 November; "fout" = the bank did not answer this morning, the figures are from yesterday.
  const STALE_ACCOUNT = 'gedeeld';

  // Sync sources of a bank account (Saldo.data.sources / connections), primary first, with their status in
  // the current demo state. Returns null for a manual account. In "lezen" Partner's link is the primary one.
  function sync(id) {
    const list = D.sources[id];
    if (!list) return null;
    const demo = D.demo();
    let src = list.map((s) => ({ c: D.connections.find((x) => x.id === s.connection), priority: s.priority }));
    if (D.readOnly(id)) {
      src = src.map((s) => ({ c: s.c, priority: s.c.mine ? 'fallback' : 'primary' }))
        .sort((a, b) => (a.priority === 'primary' ? -1 : 1));
    }
    const time = (c) => c.lastSync.split(' ').pop();
    const sources = src.map((s) => {
      const c = s.c;
      const r = {
        id: c.id, bank: c.bank, mine: c.mine, owner: c.owner, priority: s.priority,
        prioLabel: s.priority === 'primary' ? 'Primair' : 'Reserve',
        title: c.bank + ' · via ' + (c.mine ? 'jouw koppeling' : c.owner),
        validUntil: c.validUntil, daysLeft: c.daysLeft, since: c.since,
        last: c.lastSync, lastShort: c.lastSync, tone: 'ok', status: 'Actief', problem: ''
      };
      if (demo === 'verouderd' && id === STALE_ACCOUNT) {
        Object.assign(r, { tone: 'warn', status: 'Verouderd', last: 'zondag 15 november ' + time(c), lastShort: 'zo 15 nov',
          problem: c.bank + ' stuurde sinds zondag geen nieuwe gegevens voor deze rekening. Saldo probeert het elke nacht opnieuw.' });
      } else if (demo === 'fout') {
        Object.assign(r, { tone: 'neg', status: 'Mislukt', last: 'gisteren ' + time(c), lastShort: 'gisteren ' + time(c),
          problem: c.bank + ' antwoordde niet bij de synchronisatie van vandaag ' + time(c) + '. Saldo probeert het vannacht opnieuw.' });
      } else if (c.mine && c.daysLeft <= 14) {
        Object.assign(r, { tone: 'warn', status: 'Verloopt over ' + c.daysLeft + ' dagen' });
      }
      return r;
    });
    const working = sources.filter((s) => s.tone !== 'neg');
    const by = working[0];
    const res = { sources, bank: sources[0].bank, tone: '', takeover: false, by: by || null };
    if (!by) {
      Object.assign(res, { tone: 'neg', short: 'synchronisatie mislukt', last: sources[0].last, lastShort: sources[0].lastShort });
    } else if (by.status === 'Verouderd') {
      Object.assign(res, { tone: 'warn', short: 'niet bijgewerkt sinds ' + by.lastShort, last: by.last, lastShort: by.lastShort });
    } else {
      // A fallback source keeps the account up to date when the primary one fails (not used by a demo state).
      res.takeover = by.priority !== 'primary';
      Object.assign(res, { short: res.takeover ? 'bijgewerkt via ' + by.owner : 'gesynchroniseerd ' + by.last, last: by.last, lastShort: by.lastShort });
    }
    return res;
  }

  // An account as the viewer sees it: saved edits applied, derived flags and the list subline.
  function account(id) {
    if (!D.accounts.some((x) => x.id === id)) return null;
    const a = D.account(id);
    a.hasBuffer = a.type === 'current';
    if (!a.hasBuffer) a.buffer = null;
    a.manual = !D.sources[id];
    a.shared = (D.members[id] || []).length > 1;
    a.readOnly = D.readOnly(id);
    a.sub = subline(a);
    return a;
  }
  const accounts = () => D.accounts.map((x) => account(x.id));

  function subline(a) {
    if (a.manual) return { text: 'Handmatig · bijgewerkt ' + a.updated, tone: '' };
    const s = sync(a.id);
    if (a.shared) {
      const m = manager(a.id);
      const tail = (s.tone || s.takeover) ? s.short : (m && m.me ? 'jij bent beheerder' : (m ? m.who + ' is beheerder' : ''));
      return { text: s.bank + ' · ' + withText(a.id) + ' · ' + tail, tone: s.tone };
    }
    return { text: s.bank + ' · ' + s.short, tone: s.tone };
  }

  // State of a current account against its own buffer (analysis/concepts/buffer-and-states.md)
  function bufferState(a) {
    if (!a.hasBuffer) return null;
    const whose = a.shared ? 'de' : 'je';
    if (a.balance < 0) return { tone: 'neg', chip: 'Rood', text: eur(-a.balance) + ' onder nul · ' + whose + ' buffer is ' + eur(a.buffer) };
    if (a.balance < a.buffer) return { tone: 'warn', chip: 'In de buffer', text: eur(a.buffer - a.balance) + ' onder ' + whose + ' buffer van ' + eur(a.buffer) };
    return { tone: 'ok', chip: 'Boven buffer', text: eur(a.balance - a.buffer) + ' boven ' + whose + ' buffer van ' + eur(a.buffer) };
  }

  function detailLabel(a) {
    if (a.manual) return 'Details en saldo bijwerken';
    return a.shared ? 'Details, synchronisatie en leden' : 'Details en synchronisatie';
  }

  // ---------- Settings form (name, colour, buffer, IBAN for manual accounts) ----------

  // Draft values over the saved account
  function values(a, draft) {
    const name = draft.name !== undefined ? draft.name : a.name;
    const color = draft.color || a.color;
    const buffer = draft.buffer !== undefined ? draft.buffer : a.buffer;
    const bufInput = draft.bufInput !== undefined ? draft.bufInput : (buffer !== null && buffer !== undefined ? String(Math.round(buffer / 100)) : '');
    const iban = draft.iban !== undefined ? draft.iban : (a.iban || '');
    return { name, color, buffer, bufInput, iban };
  }

  function swatches(p, color, disabled) {
    return COLORS.map((c) => {
      const on = c[0] === color;
      return '<button type="button" class="rk-swatch" role="radio" aria-checked="' + on + '" aria-label="' + c[1] + '" tabindex="' + (on ? 0 : -1) + '"' +
        (disabled ? ' disabled' : '') + ' data-action="color" data-color="' + c[0] + '" data-key="sw-' + c[0] + '" style="background:' + acc(c[0]) + '">' +
        (on ? icon('check', 16, 3) : '') + '</button>';
    }).join('');
  }

  function colorField(p, color, disabled) {
    return '<div class="rk-field">' +
      '<span class="rk-label" id="rk-' + p + '-kleur">Kleur</span>' +
      '<div class="rk-swatches" role="radiogroup" aria-labelledby="rk-' + p + '-kleur"' + (disabled ? ' aria-disabled="true"' : '') + '>' + swatches(p, color, disabled) + '</div>' +
      '<span class="rk-help">Deze kleur zie je overal bij deze rekening: in lijsten, grafieken en labels.</span>' +
    '</div>';
  }

  function bufferField(p, bufInput, help, disabled) {
    const dis = disabled ? ' disabled' : '';
    return '<div class="rk-field">' +
      '<label class="rk-label" for="rk-' + p + '-buf">Minimumbuffer</label>' +
      '<div class="rk-stepper">' +
        '<button type="button" class="rk-step" aria-label="€ 50 minder" data-action="buf-down" data-key="buf-down"' + dis + '>−</button>' +
        '<div class="rk-money"><span aria-hidden="true">€</span><input class="input rk-money-input" id="rk-' + p + '-buf" inputmode="decimal" autocomplete="off" value="' + esc(bufInput) + '" data-input="buf" data-key="buf"' + dis + '></div>' +
        '<button type="button" class="rk-step" aria-label="€ 50 meer" data-action="buf-up" data-key="buf-up"' + dis + '>+</button>' +
      '</div>' +
      '<span class="rk-help">' + esc(help) + '</span>' +
    '</div>';
  }

  function ibanField(p, iban, disabled) {
    return '<div class="rk-field rk-field--tight">' +
      '<label class="rk-label" for="rk-' + p + '-iban">IBAN <span class="rk-opt">(optioneel)</span></label>' +
      '<input class="input rk-iban-input" id="rk-' + p + '-iban" autocomplete="off" spellcheck="false" placeholder="BE00 0000 0000 0000" value="' + esc(iban) + '" data-input="iban" data-key="iban"' + (disabled ? ' disabled' : '') + '>' +
      '<span class="rk-help">Alleen om overschrijvingen naar deze rekening te herkennen. Wordt nooit gebruikt om rekeningen samen te voegen.</span>' +
    '</div>';
  }

  // Lock chip and note for a read-only member of a shared account
  function readOnlyNote(a) {
    const m = manager(a.id);
    return '<div class="rk-ro">' +
      '<span class="chip chip--readonly">' + icon('lock', 14, 2.2) + 'Alleen lezen</span>' +
      '<span>' + esc((m ? m.who : 'De beheerder') + ' (beheerder) gaf je leesrechten op deze rekening.') + '</span>' +
    '</div>';
  }

  function bufferHelp(a) {
    return a.shared
      ? 'Komt de gedeelde rekening onder dit bedrag, dan kleurt de planning geel. Onder € 0 wordt ze rood. Geldt voor jou en ' + names(others(a.id).map((m) => m.who)) + '.'
      : 'Komt deze rekening onder dit bedrag, dan kleurt de planning geel. Onder € 0 wordt ze rood.';
  }

  // Name, colour, buffer (or the savings note), IBAN (manual accounts) and the label preview
  function formHtml(p, a, d, opts) {
    const ro = !!(opts && opts.readOnly);
    return '<div class="rk-field rk-field--tight">' +
        '<label class="rk-label" for="rk-' + p + '-name">Naam</label>' +
        '<input class="input" id="rk-' + p + '-name" autocomplete="off" value="' + esc(d.name) + '" data-input="name" data-key="name"' + (ro ? ' disabled' : '') + '>' +
      '</div>' +
      colorField(p, d.color, ro) +
      (a.hasBuffer
        ? bufferField(p, d.bufInput, bufferHelp(a), ro)
        : '<p class="rk-note">Spaarrekeningen tellen niet mee als beschikbaar geld in je planning. Daarom hebben ze geen buffer.</p>') +
      (opts && opts.withIban ? ibanField(p, d.iban, ro) : '') +
      '<div class="rk-preview">' +
        '<span class="rk-preview-label">Voorbeeld</span>' +
        '<span class="rk-pill"><i style="background:' + acc(d.color) + '"></i><span data-bind="name">' + esc(d.name) + '</span></span>' +
        '<span class="mono rk-preview-amount">' + eur(-8642) + '</span>' +
      '</div>';
  }

  // Shared form behaviour. ctl = { values(), patch(obj), repaint(focusKey) }
  function formClick(el, ctl) {
    const act = el.dataset.action;
    if (act === 'color') {
      ctl.patch({ color: el.dataset.color });
      ctl.repaint(el.dataset.key);
      return true;
    }
    if (act === 'buf-down' || act === 'buf-up') {
      const b = Math.max(0, (ctl.values().buffer || 0) + (act === 'buf-up' ? STEP : -STEP));
      ctl.patch({ buffer: b, bufInput: String(Math.round(b / 100)) });
      ctl.repaint(el.dataset.key);
      return true;
    }
    return false;
  }

  // Live edits without re-rendering, so the caret stays put
  function formInput(el, ctl) {
    const k = el.dataset.input;
    if (k === 'name') {
      ctl.patch({ name: el.value });
      document.querySelectorAll('.rk-editor [data-bind="name"]').forEach((n) => { n.textContent = el.value; });
    } else if (k === 'buf') {
      const v = parseMoney(el.value);
      ctl.patch({ bufInput: el.value, buffer: isNaN(v) ? 0 : Math.max(0, v) });
    } else if (k === 'iban') {
      ctl.patch({ iban: el.value });
    } else return false;
    return true;
  }

  // Arrow keys move through the colour radiogroup
  function formKey(e, ctl) {
    const sw = e.target.closest && e.target.closest('.rk-swatch');
    if (!sw) return false;
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return false;
    e.preventDefault();
    const i = COLORS.findIndex((c) => c[0] === sw.dataset.color);
    const next = COLORS[(i + keys[e.key] + COLORS.length) % COLORS.length][0];
    ctl.patch({ color: next });
    ctl.repaint('sw-' + next);
    return true;
  }

  S.accountKit = {
    COLORS, STEP, acc, isOffline, loadEdits, saveEdits, parseMoney, inputMoney, dateKey, names,
    members, others, manager, withText, sync, account, accounts, bufferState, detailLabel,
    values, swatches, colorField, bufferField, ibanField, readOnlyNote, bufferHelp, formHtml, formClick, formInput, formKey
  };

  // =====================================================================
  // Rekeningen screen
  // =====================================================================

  const kit = S.accountKit;
  const GROUPS = [
    { key: 'pers', title: 'Persoonlijk', test: (a) => !a.shared },
    { key: 'ged', title: 'Gedeeld', test: (a) => a.shared }
  ];
  const HASHES = ['toevoegen', 'handmatig', 'handmatig-zicht'];

  let page = null;
  let painted = false;
  let sel = 'zicht';      // selected account (desktop panel, phone sheet)
  let draft = {};         // unsaved edits of the selected account
  let sheetOpen = false;  // phone only
  let flip = false;       // fade the desktop panel after a new selection
  let add = null;         // add-account dialog: { step: 'kies' | 'handmatig', d: {…}, err: {} }
  let returnFocus = null;

  const isEmpty = () => D.demo() === 'leeg';
  const current = () => kit.account(sel) || kit.accounts()[0];
  const dirty = () => Object.keys(draft).length > 0;

  function anim(cls, delay) {
    return painted ? '' : ' ' + cls + '" style="--d:' + delay + 'ms';
  }

  // ---------- Pieces ----------

  function header() {
    return '<div class="rk-head' + anim('anim-fade', 0) + '">' +
      '<a class="page-back only-phone" href="meer.html" aria-label="Terug naar Meer">' + icon('back', 22, 2.4) + '</a>' +
      '<div class="rk-head-title"><h1>Rekeningen</h1><span class="rk-head-sub only-desktop">Naam, kleur en buffer per rekening</span></div>' +
      '<div class="only-desktop"><button type="button" class="btn btn--primary rk-add" data-action="add" data-key="add-d" aria-haspopup="dialog">' + icon('plus', 16, 2.6) + 'Rekening toevoegen</button></div>' +
    '</div>';
  }

  // "Buffer per rekening": information only. Every current account has its own buffer; the sum is no verdict.
  function bufferCard(list) {
    const withBuf = list.filter((a) => a.buffer !== null);
    if (!withBuf.length) return '';
    const sum = withBuf.reduce((s, a) => s + a.buffer, 0);
    const total = sum || 1;
    return '<section class="card rk-buf' + anim('anim-in', 30) + '" aria-label="Buffer per rekening, ter info">' +
      '<div class="rk-buf-head">' +
        '<span class="rk-buf-title"><span>Buffer per rekening</span><small>Ter info: elke rekening heeft haar eigen buffer</small></span>' +
        '<span class="rk-buf-total"><small>samen</small><span class="mono">' + eur(sum) + '</span></span>' +
      '</div>' +
      '<div class="rk-buf-bar" aria-hidden="true">' + withBuf.map((a) =>
        '<span style="width:' + (a.buffer / total * 100).toFixed(1) + '%;background:' + kit.acc(a.color) + '"></span>').join('') + '</div>' +
      '<div class="rk-buf-legend">' + withBuf.map((a) =>
        '<span><i style="background:' + kit.acc(a.color) + '"></i>' + esc(a.name) + ' <span class="mono muted">' + eur(a.buffer) + '</span></span>').join('') + '</div>' +
    '</section>';
  }

  function bufText(a) {
    return a.buffer !== null ? 'Buffer ' + eur(a.buffer) : 'Telt niet mee in de planning';
  }

  function avatar(a, size, color) {
    return '<span class="rk-avatar' + (size > 19 ? ' rk-avatar--lg' : '') + '" style="background:' + kit.acc(color || a.color) + '">' + icon(a.icon, size, 2.2) + '</span>';
  }

  function subHtml(a, cls) {
    return '<span class="' + cls + (a.sub.tone ? ' rk-sub--' + a.sub.tone : '') + '">' + esc(a.sub.text) + '</span>';
  }

  const roChip = (a) => (a.readOnly ? '<span class="rk-lock">' + icon('lock', 12, 2.4) + 'Alleen lezen</span>' : '');

  // Phone row: opens the sheet
  function phoneRow(a) {
    return '<button type="button" class="rk-row" data-action="open" data-id="' + a.id + '" data-key="row-p-' + a.id + '" aria-haspopup="dialog">' +
      avatar(a, 19) +
      '<span class="rk-row-main"><span class="rk-row-name">' + esc(a.name) + roChip(a) + '</span>' + subHtml(a, 'rk-row-sub') +
        '<span class="rk-row-buf' + (a.buffer === null ? ' muted' : '') + '">' + bufText(a) + '</span></span>' +
      '<span class="rk-row-end"><span class="mono rk-row-amount">' + eur(a.balance) + '</span>' + chevron() + '</span>' +
    '</button>';
  }

  // Desktop row: selects the account for the panel
  function deskRow(a) {
    const on = a.id === sel;
    return '<button type="button" class="rk-drow" aria-pressed="' + on + '" data-action="select" data-id="' + a.id + '" data-key="row-d-' + a.id + '">' +
      avatar(a, 19) +
      '<span class="rk-drow-main"><span class="rk-drow-name">' + esc(a.name) + roChip(a) + '</span>' + subHtml(a, 'rk-drow-sub') + '</span>' +
      '<span class="rk-drow-buf' + (a.buffer === null ? ' muted' : '') + '">' + bufText(a) + '</span>' +
      '<span class="mono rk-drow-amount">' + eur(a.balance) + '</span>' +
      chevron() +
    '</button>';
  }

  function chevron() {
    return '<span class="rk-chev">' + icon('chevron', 16, 2.2) + '</span>';
  }

  // Persoonlijk = accounts with one member (you), Gedeeld = more than one. A filter, not a merged unit.
  function groups(list) {
    return GROUPS.map((g, i) => {
      const rows = list.filter(g.test);
      if (!rows.length) return '';
      let note = 'alleen jij ziet ze';
      if (g.key === 'ged') {
        const who = [];
        rows.forEach((a) => kit.others(a.id).forEach((m) => { if (who.indexOf(m.who) < 0) who.push(m.who); }));
        note = 'met ' + kit.names(who);
      }
      return '<section class="rk-group' + anim('anim-in', 60 + i * 30) + '" aria-labelledby="rk-g-' + g.key + '">' +
        '<div class="rk-group-head"><h2 class="label" id="rk-g-' + g.key + '">' + esc(g.title) + '</h2><span class="rk-group-note">· ' + esc(note) + '</span></div>' +
        '<div class="rk-list only-phone">' + rows.map(phoneRow).join('') + '</div>' +
        '<div class="only-desktop"><div class="rk-dlist">' + rows.map(deskRow).join('') + '</div></div>' +
      '</section>';
    }).join('');
  }

  // Demo state "leeg": no accounts yet, both ways to add one
  function emptyState() {
    return '<section class="card rk-empty' + anim('anim-in', 30) + '" aria-labelledby="rk-empty-title">' +
      '<span class="rk-empty-icon" aria-hidden="true">' + icon('card', 28, 2) + '</span>' +
      '<h2 class="rk-empty-title" id="rk-empty-title">Nog geen rekeningen</h2>' +
      '<p class="rk-empty-text">Koppel je zichtrekening bij de bank, dan komen saldo en transacties vanzelf binnen. Spaargeld of een rekening zonder koppeling voeg je met de hand toe.</p>' +
      '<div class="rk-empty-actions">' +
        '<a class="btn btn--primary" href="bankkoppelingen.html#nieuw" data-action="bank-link">' + icon('bank', 18, 2.2) + 'Bankrekening koppelen</a>' +
        '<button type="button" class="btn btn--ghost" data-action="add-manual" data-key="empty-manual" aria-haspopup="dialog">' + icon('edit', 18, 2.2) + 'Handmatige rekening</button>' +
      '</div>' +
      '<p class="rk-empty-note">Een gedeelde rekening voeg je toe door ze te koppelen. Heeft een mede-houder ze al gekoppeld, dan vraagt Saldo of je wil aansluiten.</p>' +
    '</section>';
  }

  // ---------- Editor (sheet on phone, panel on desktop) ----------

  function editor(p, inSheet) {
    const cur = current();
    const d = kit.values(cur, draft);
    const ro = cur.readOnly;
    const off = kit.isOffline();

    let actions;
    if (ro) {
      actions = inSheet ? '<div class="rk-actions rk-actions--one"><button type="button" class="rk-btn rk-btn--ghost" data-action="close" data-key="cancel">Sluiten</button></div>' : '';
    } else {
      actions = '<div class="rk-actions">' +
        (inSheet
          ? '<button type="button" class="rk-btn rk-btn--ghost" data-action="close" data-key="cancel">Annuleren</button>'
          : '<button type="button" class="rk-btn rk-btn--ghost" data-action="reset" data-key="reset"' + (dirty() ? '' : ' disabled') + '>Herstellen</button>') +
        '<button type="button" class="rk-btn rk-btn--primary" data-action="save" data-key="save"' + (off ? ' disabled' : '') + '>Opslaan</button>' +
      '</div>' +
      (off ? '<p class="rk-offline">' + icon('cloudOff', 14, 2.2) + 'Je bent offline. Opslaan kan weer zodra je verbinding hebt.</p>' : '');
    }

    return '<div class="rk-editor' + (flip && !inSheet ? ' anim-fade' : '') + '">' +
      '<div class="rk-ed-head">' +
        avatar(cur, 22, d.color) +
        '<div class="rk-ed-title"><span class="rk-ed-name" data-bind="name">' + esc(d.name) + '</span>' + subHtml(cur, 'rk-ed-sub') + '</div>' +
        (inSheet ? '<button type="button" class="rk-close" aria-label="Sluiten" data-action="close" data-key="close">' + icon('close', 18, 2.4) + '</button>' : '') +
      '</div>' +
      '<a class="rk-detail" href="rekening.html?id=' + encodeURIComponent(cur.id) + '" data-key="detail">' +
        '<span>' + esc(kit.detailLabel(cur)) + '</span>' + icon('chevron', 18, 2.2) +
      '</a>' +
      (ro ? kit.readOnlyNote(cur) : '') +
      kit.formHtml(p, cur, d, { readOnly: ro, withIban: cur.manual }) +
      actions +
    '</div>';
  }

  const editorCtl = {
    values: () => kit.values(current(), draft),
    patch: (o) => { draft = Object.assign({}, draft, o); },
    repaint: () => refresh(false)
  };

  // ---------- Add an account: chooser and manual form ----------

  function freeColor() {
    const used = kit.accounts().map((a) => a.color);
    const c = kit.COLORS.find((x) => used.indexOf(x[0]) < 0);
    return c ? c[0] : 'blue';
  }

  function newDraft(kind) {
    return { name: '', kind: kind || 'savings', iban: '', balInput: '', color: isEmpty() ? 'green' : freeColor(), buffer: 50000, bufInput: '500' };
  }

  function addChooser() {
    const opt = (action, ic, title, sub, href) => {
      const inner = '<span class="rk-choice-icon">' + icon(ic, 22, 2) + '</span>' +
        '<span class="rk-choice-main"><span class="rk-choice-title">' + title + '</span><span class="rk-choice-sub">' + sub + '</span></span>' +
        '<span class="rk-chev">' + icon('chevron', 18, 2.2) + '</span>';
      return href
        ? '<a class="rk-choice" href="' + href + '" data-action="' + action + '" data-key="' + action + '">' + inner + '</a>'
        : '<button type="button" class="rk-choice" data-action="' + action + '" data-key="' + action + '">' + inner + '</button>';
    };
    return '<div class="rk-add-head">' +
        '<h2 class="rk-add-title" id="rk-add-title">Rekening toevoegen</h2>' +
        '<button type="button" class="rk-close" aria-label="Sluiten" data-action="add-close" data-key="add-close">' + icon('close', 18, 2.4) + '</button>' +
      '</div>' +
      '<div class="rk-choices">' +
        opt('bank-link', 'bank', 'Bankrekening koppelen', 'Een zichtrekening bij Argenta. Saldo en transacties komen vanzelf binnen.', 'bankkoppelingen.html#nieuw') +
        opt('add-manual', 'edit', 'Handmatige rekening', 'Een spaarrekening of een rekening zonder bankkoppeling. Je houdt het saldo zelf bij.') +
      '</div>' +
      '<p class="rk-note">Een gedeelde rekening voeg je toe door ze te koppelen. Heeft een mede-houder ze al gekoppeld, dan vraagt Saldo of je wil aansluiten.</p>';
  }

  function addForm() {
    const d = add.d;
    const err = add.err;
    const off = kit.isOffline();
    const kind = (k, title, sub) => {
      const on = d.kind === k;
      return '<button type="button" class="rk-kind" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-action="add-kind" data-kind="' + k + '" data-key="kind-' + k + '">' +
        '<span class="rk-kind-dot" aria-hidden="true"></span>' +
        '<span class="rk-kind-main"><span class="rk-kind-title">' + title + '</span><span class="rk-kind-sub">' + sub + '</span></span>' +
      '</button>';
    };
    const fake = { id: 'nieuw', hasBuffer: d.kind === 'current', shared: false };
    return '<div class="rk-add-head">' +
        '<button type="button" class="rk-close rk-close--back" aria-label="Terug naar de keuze" data-action="add-back" data-key="add-back">' + icon('back', 20, 2.4) + '</button>' +
        '<h2 class="rk-add-title" id="rk-add-title">Handmatige rekening</h2>' +
        '<button type="button" class="rk-close" aria-label="Sluiten" data-action="add-close" data-key="add-close">' + icon('close', 18, 2.4) + '</button>' +
      '</div>' +
      '<div class="rk-editor rk-add-form">' +
        '<div class="rk-field rk-field--tight">' +
          '<label class="rk-label" for="rk-n-name">Naam</label>' +
          '<input class="input' + (err.name ? ' rk-input--err' : '') + '" id="rk-n-name" autocomplete="off" placeholder="Bijvoorbeeld: Vakantiepot" value="' + esc(d.name) + '" data-input="name" data-key="name"' +
            (err.name ? ' aria-invalid="true" aria-describedby="rk-n-name-err"' : '') + '>' +
          (err.name ? '<span class="rk-err" id="rk-n-name-err">' + esc(err.name) + '</span>' : '') +
        '</div>' +
        '<div class="rk-field">' +
          '<span class="rk-label" id="rk-n-kind">Soort</span>' +
          '<div class="rk-kinds" role="radiogroup" aria-labelledby="rk-n-kind">' +
            kind('savings', 'Spaarrekening', 'Telt niet mee in de planning. Geen buffer.') +
            kind('current', 'Zichtrekening zonder bankkoppeling', 'Telt mee in de planning, met een eigen buffer. Transacties voer je zelf in of importeer je.') +
          '</div>' +
        '</div>' +
        '<div class="rk-field rk-field--tight">' +
          '<label class="rk-label" for="rk-n-iban">IBAN <span class="rk-opt">(optioneel)</span></label>' +
          '<input class="input rk-iban-input' + (err.iban ? ' rk-input--err' : '') + '" id="rk-n-iban" autocomplete="off" spellcheck="false" placeholder="BE00 0000 0000 0000" value="' + esc(d.iban) + '" data-input="iban" data-key="iban"' +
            (err.iban ? ' aria-invalid="true" aria-describedby="rk-n-iban-err"' : '') + '>' +
          (err.iban ? '<span class="rk-err" id="rk-n-iban-err">' + esc(err.iban) + '</span>' : '') +
          '<span class="rk-help">Alleen om overschrijvingen naar deze rekening te herkennen. Wordt nooit gebruikt om rekeningen samen te voegen.</span>' +
        '</div>' +
        '<div class="rk-field rk-field--tight">' +
          '<label class="rk-label" for="rk-n-bal">Saldo vandaag</label>' +
          '<div class="rk-money"><span aria-hidden="true">€</span><input class="input rk-money-input rk-money-input--left' + (err.bal ? ' rk-input--err' : '') + '" id="rk-n-bal" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + esc(d.balInput) + '" data-input="bal" data-key="bal"' +
            (err.bal ? ' aria-invalid="true" aria-describedby="rk-n-bal-err"' : '') + '></div>' +
          (err.bal ? '<span class="rk-err" id="rk-n-bal-err">' + esc(err.bal) + '</span>' : '<span class="rk-help">Woensdag 18 november. Later werk je het bij op de pagina van de rekening.</span>') +
        '</div>' +
        kit.colorField('n', d.color, false) +
        (d.kind === 'current' ? kit.bufferField('n', d.bufInput, kit.bufferHelp(fake), false) : '') +
        '<p class="rk-note">' + icon('lock', 14, 2.2) + ' Alleen jij ziet handmatige rekeningen.</p>' +
        '<div class="rk-actions">' +
          '<button type="button" class="rk-btn rk-btn--ghost" data-action="add-back" data-key="add-back2">Terug</button>' +
          '<button type="button" class="rk-btn rk-btn--primary" data-action="add-save" data-key="add-save"' + (off ? ' disabled' : '') + '>Toevoegen</button>' +
        '</div>' +
        (off ? '<p class="rk-offline">' + icon('cloudOff', 14, 2.2) + 'Je bent offline. Toevoegen kan weer zodra je verbinding hebt.</p>' : '') +
      '</div>';
  }

  const addCtl = {
    values: () => add.d,
    patch: (o) => { Object.assign(add.d, o); },
    repaint: (key) => {
      paintAdd();
      const el = key && document.querySelector('.rk-add-sheet [data-key="' + key + '"]');
      if (el) el.focus();
    }
  };

  function openAdd(step, kind, from) {
    closeSheet(true);
    if (!add) returnFocus = from || null;
    add = { step: step, d: newDraft(kind), err: {} };
    let wrap = document.querySelector('.rk-add-backdrop');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'sheet-backdrop rk-add-backdrop';
      wrap.innerHTML = '<div class="sheet rk-sheet rk-add-sheet" role="dialog" aria-modal="true" aria-labelledby="rk-add-title"></div>';
      document.body.appendChild(wrap);
      const sheet = wrap.querySelector('.rk-add-sheet');
      sheet.addEventListener('click', onAddClick);
      sheet.addEventListener('input', onAddInput);
      sheet.addEventListener('keydown', onAddKey);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) closeAdd(); });
    }
    paintAdd();
    const first = wrap.querySelector(step === 'handmatig' ? '#rk-n-name' : '[data-key="bank-link"]');
    if (first) first.focus();
  }

  function paintAdd() {
    const sheet = document.querySelector('.rk-add-sheet');
    if (!sheet || !add) return;
    const a = document.activeElement;
    const key = a && sheet.contains(a) && a.dataset ? a.dataset.key : null;
    sheet.innerHTML = '<div class="sheet-grip" aria-hidden="true"></div>' + (add.step === 'kies' ? addChooser() : addForm());
    if (key) {
      const el = sheet.querySelector('[data-key="' + key + '"]');
      if (el) el.focus();
    }
  }

  function closeAdd() {
    const wrap = document.querySelector('.rk-add-backdrop');
    if (wrap) wrap.remove();
    add = null;
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (returnFocus) {
      const el = page.querySelector('[data-key="' + returnFocus + '"]');
      if (el) el.focus();
    }
  }

  function validIban(s) {
    const t = s.replace(/\s/g, '').toUpperCase();
    return /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(t);
  }

  function addSave() {
    const d = add.d;
    const err = {};
    if (!d.name.trim()) err.name = 'Geef de rekening een naam.';
    if (d.iban.trim() && !validIban(d.iban)) err.iban = 'Dit lijkt geen geldig IBAN. Kijk het na of laat het leeg.';
    const bal = d.balInput.trim() ? parseMoney(d.balInput) : 0;
    if (isNaN(bal)) err.bal = 'Vul een bedrag in, bijvoorbeeld 1.250,00.';
    add.err = err;
    if (Object.keys(err).length) {
      paintAdd();
      const first = document.querySelector('.rk-add-sheet .rk-input--err');
      if (first) first.focus();
      return;
    }
    const name = d.name.trim();
    closeAdd();
    S.shell.toast(name + ' toegevoegd (mockup)');
  }

  function onAddClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const act = el.dataset.action;
    if (kit.formClick(el, addCtl)) return;
    if (act === 'bank-link') {
      if (kit.isOffline()) { e.preventDefault(); S.shell.toast('Je bent offline'); }
      return;
    }
    if (act === 'add-close') closeAdd();
    else if (act === 'add-manual') { add.step = 'handmatig'; add.err = {}; paintAdd(); const n = document.querySelector('#rk-n-name'); if (n) n.focus(); }
    else if (act === 'add-back') { add.step = 'kies'; paintAdd(); const b = document.querySelector('.rk-add-sheet [data-key="add-manual"]'); if (b) b.focus(); }
    else if (act === 'add-kind') { add.d.kind = el.dataset.kind; paintAdd(); const k = document.querySelector('.rk-add-sheet [data-key="kind-' + add.d.kind + '"]'); if (k) k.focus(); }
    else if (act === 'add-save') addSave();
  }

  function onAddInput(e) {
    const el = e.target;
    if (el.dataset.input === 'bal') { add.d.balInput = el.value; return; }
    if (el.dataset.input === 'name') { add.d.name = el.value; return; }
    kit.formInput(el, addCtl);
  }

  function onAddKey(e) {
    if (kit.formKey(e, addCtl)) return;
    const k = e.target.closest && e.target.closest('.rk-kind');
    if (!k) return;
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    add.d.kind = add.d.kind === 'savings' ? 'current' : 'savings';
    paintAdd();
    document.querySelector('.rk-add-sheet [data-key="kind-' + add.d.kind + '"]').focus();
  }

  // ---------- Painting ----------

  // Re-render while keeping keyboard focus on the same control
  function keepFocus(fn) {
    const a = document.activeElement;
    const key = a && a.dataset ? a.dataset.key : null;
    const inSheet = a && a.closest && !!a.closest('.rk-edit-sheet');
    fn();
    if (!key) return;
    const scope = inSheet ? document.querySelector('.rk-edit-sheet') : page;
    const el = scope && scope.querySelector('[data-key="' + key + '"]');
    if (el && el.getClientRects().length) el.focus();
  }

  function paint() {
    if (isEmpty()) {
      page.innerHTML = header() +
        '<div class="rk-layout rk-layout--empty"><div class="rk-col">' + emptyState() + '</div></div>';
      painted = true;
      return;
    }
    const list = kit.accounts();
    if (!list.some((a) => a.id === sel)) sel = list[0].id;
    page.innerHTML =
      header() +
      '<div class="rk-layout">' +
        '<div class="rk-col">' +
          bufferCard(list) +
          groups(list) +
          '<button type="button" class="btn btn--dashed only-phone rk-add-phone' + anim('anim-in', 120) + '" data-action="add" data-key="add-p" aria-haspopup="dialog">' + icon('plus', 16, 2.6) + 'Rekening toevoegen</button>' +
        '</div>' +
        '<div class="only-desktop"><section class="rk-panel' + anim('anim-in', 60) + '" aria-label="Rekening instellen" id="rk-panel">' + editor('d', false) + '</section></div>' +
      '</div>';
    painted = true;
    flip = false;
  }

  function paintEditors() {
    const panel = page.querySelector('#rk-panel');
    if (panel) panel.innerHTML = editor('d', false);
    const sheet = document.querySelector('.rk-edit-sheet');
    if (sheet) sheet.innerHTML = '<div class="sheet-grip" aria-hidden="true"></div>' + editor('p', true);
    flip = false;
  }

  function refresh(all) {
    keepFocus(() => { if (all) paint(); else paintEditors(); });
  }

  // ---------- Phone sheet ----------

  function openSheet(id, from) {
    sel = id;
    draft = {};
    sheetOpen = true;
    returnFocus = from || null;
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop rk-backdrop';
    wrap.innerHTML = '<div class="sheet rk-sheet rk-edit-sheet" role="dialog" aria-modal="true" aria-label="Rekening instellen">' +
      '<div class="sheet-grip" aria-hidden="true"></div>' + editor('p', true) + '</div>';
    document.body.appendChild(wrap);
    wireEditor(wrap.querySelector('.rk-edit-sheet'));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheet(); });
    const first = wrap.querySelector('[data-key="close"]');
    if (first) first.focus();
    // The desktop panel follows the same selection
    refresh(true);
  }

  function closeSheet(silent) {
    const wrap = document.querySelector('.rk-backdrop');
    if (wrap) wrap.remove();
    if (!sheetOpen) return;
    sheetOpen = false;
    draft = {};
    if (!silent && returnFocus) {
      const el = page.querySelector('[data-key="' + returnFocus + '"]');
      if (el) el.focus();
    }
  }

  // ---------- Actions ----------

  function save() {
    if (kit.isOffline()) { S.shell.toast('Je bent offline'); return; }
    const cur = current();
    if (cur.readOnly) return;
    const d = kit.values(cur, draft);
    const patch = { color: d.color, name: (d.name || '').trim() || cur.name };
    if (cur.hasBuffer) patch.buffer = d.buffer;
    if (cur.manual) patch.iban = (d.iban || '').trim();
    kit.saveEdits(cur.id, patch);
    draft = {};
    const wasSheet = sheetOpen;
    if (wasSheet) {
      document.querySelector('.rk-backdrop').remove();
      sheetOpen = false;
    }
    refresh(true);
    if (wasSheet && returnFocus) {
      const el = page.querySelector('[data-key="' + returnFocus + '"]');
      if (el) el.focus();
    }
    S.shell.toast(patch.name + ' opgeslagen');
  }

  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    if (kit.formClick(el, editorCtl)) return;
    const act = el.dataset.action;
    if (act === 'open') openSheet(el.dataset.id, el.dataset.key);
    else if (act === 'select') {
      if (el.dataset.id === sel) return;
      sel = el.dataset.id;
      draft = {};
      flip = true;
      refresh(true);
    } else if (act === 'reset') { draft = {}; refresh(false); }
    else if (act === 'close') closeSheet();
    else if (act === 'save') save();
    else if (act === 'add') openAdd('kies', null, el.dataset.key);
    else if (act === 'add-manual') openAdd('handmatig', null, el.dataset.key);
    else if (act === 'bank-link' && kit.isOffline()) { e.preventDefault(); S.shell.toast('Je bent offline'); }
  }

  function onInput(e) {
    if (!e.target.closest('.rk-editor')) return;
    kit.formInput(e.target, editorCtl);
    const reset = page.querySelector('[data-action="reset"]');
    if (reset) reset.disabled = !dirty();
  }

  function onKey(e) {
    const inSheet = !!(e.target.closest && e.target.closest('.rk-edit-sheet'));
    kit.formKey(e, {
      values: editorCtl.values,
      patch: editorCtl.patch,
      repaint: (key) => {
        paintEditors();
        const scope = inSheet ? document.querySelector('.rk-edit-sheet') : page;
        const el = scope.querySelector('[data-key="' + key + '"]');
        if (el) el.focus();
      }
    });
  }

  function wireEditor(root) {
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey);
  }

  // Deep links (mockup): #toevoegen, #handmatig, #handmatig-zicht, or an account id (#gedeeld) to open its settings
  function openFromHash() {
    const h = location.hash.slice(1);
    if (h === 'toevoegen') openAdd('kies');
    else if (h === 'handmatig' || h === 'handmatig-zicht') openAdd('handmatig', h === 'handmatig-zicht' ? 'current' : 'savings');
    else if (!isEmpty() && D.accounts.some((a) => a.id === h)) {
      if (window.matchMedia('(min-width: 1024px)').matches) { sel = h; draft = {}; refresh(true); }
      else openSheet(h);
    }
  }

  // ---------- Screen ----------

  function render(p) {
    page = p;
    paint();
    if (!page.dataset.rkWired) {
      page.dataset.rkWired = '1';
      wireEditor(page);
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (add) closeAdd();
        else if (sheetOpen) closeSheet();
      });
      if (location.hash && (HASHES.indexOf(location.hash.slice(1)) >= 0 || D.accounts.some((a) => a.id === location.hash.slice(1)))) openFromHash();
    }
  }

  S.screens = S.screens || {};
  S.screens.rekeningen = { title: 'Rekeningen', render };
})(window.Saldo = window.Saldo || {});
