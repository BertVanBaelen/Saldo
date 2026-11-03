// Rekeningen: name, colour and minimum buffer per account.
// Design boards: Telefoon-Rekeningen, Desktop-Rekeningen. Spec: analysis/screens/rekeningen.md.
// Phone: list + bottom sheet. Desktop: list + settings panel on the right.
(function (S) {
  'use strict';

  const { eur, esc } = S.fmt;
  const icon = S.icon;
  const D = S.data;
  const store = S.shell.store;

  // Account colour palette, 8 choices (tokens --a-* in css/screens/rekeningen.css)
  const COLORS = [['green', 'Groen'], ['violet', 'Violet'], ['blue', 'Blauw'], ['teal', 'Petrol'], ['orange', 'Oranje'], ['pink', 'Roze'], ['yellow', 'Oker'], ['gray', 'Grijs']];
  // Demo colours as the boards show them (screen-only demo data)
  const DEFAULT_COLOR = { zicht: 'green', spaar: 'orange', reserve: 'yellow', gedeeld: 'violet' };
  const GROUPS = [
    { key: 'pers', title: 'Persoonlijk', note: 'alleen jij ziet ze' },
    { key: 'ged', title: 'Gedeeld', note: 'met ' + D.partner.name }
  ];
  const STEP = 5000; // € 50 per − / + press

  // Saved edits per account, per viewer: { id: { name, color, buffer } }
  let saved = {};
  try { saved = JSON.parse(store.get('rekeningen', '{}')) || {}; } catch (e) { saved = {}; }

  let page = null;
  let painted = false;
  let sel = 'zicht';      // selected account (desktop panel, phone sheet)
  let draft = {};         // unsaved edits of the selected account
  let sheetOpen = false;  // phone only
  let flip = false;       // fade the desktop panel after a new selection

  // Accounts with saved edits applied. Savings have no buffer (analysis/concepts/buffer-and-states.md).
  function accounts() {
    return D.accounts.map((a) => {
      const hasBuffer = a.type === 'current';
      const base = { id: a.id, name: a.name, group: a.group, icon: a.icon, balance: a.balance, sub: subline(a),
        color: DEFAULT_COLOR[a.id] || 'gray', buffer: hasBuffer ? a.buffer : null };
      const s = saved[a.id] || {};
      return Object.assign(base, s, { buffer: hasBuffer ? (s.buffer !== undefined ? s.buffer : a.buffer) : null });
    });
  }

  function subline(a) {
    if (a.type === 'savings') return 'Handmatig · bijgewerkt ' + a.updated;
    if (a.group === 'ged') return a.source + ' · met ' + D.partner.name + (a.manager ? ' · jij bent beheerder' : '');
    return a.source + ' · gesynchroniseerd ' + D.lastSync;
  }

  const current = () => accounts().find((a) => a.id === sel);
  const dirty = () => Object.keys(draft).length > 0;
  const acc = (color) => 'var(--a-' + color + ')';

  function anim(cls, delay) {
    return painted ? '' : ' ' + cls + '" style="--d:' + delay + 'ms';
  }

  // ---------- Pieces ----------

  function header() {
    return '<div class="rk-head' + anim('anim-fade', 0) + '">' +
      '<a class="page-back only-phone" href="meer.html" aria-label="Terug naar Meer">' + icon('back', 22, 2.4) + '</a>' +
      '<div class="rk-head-title"><h1>Rekeningen</h1><span class="rk-head-sub only-desktop">Naam, kleur en buffer per rekening</span></div>' +
      '<div class="only-desktop"><a class="btn btn--primary rk-add" href="#">' + icon('plus', 16, 2.6) + 'Rekening toevoegen</a></div>' +
    '</div>';
  }

  // "Buffer per rekening": total and one segment per current account
  function bufferCard(list) {
    const withBuf = list.filter((a) => a.buffer !== null);
    const sum = withBuf.reduce((s, a) => s + a.buffer, 0);
    const total = sum || 1;
    return '<section class="card rk-buf' + anim('anim-in', 30) + '" aria-label="Buffer per rekening">' +
      '<div class="rk-buf-head">' +
        '<span class="rk-buf-title"><span>Buffer per rekening</span><small>Elke rekening heeft een eigen buffer in de planning</small></span>' +
        '<span class="mono rk-buf-total">' + eur(sum) + '</span>' +
      '</div>' +
      '<div class="rk-buf-bar" aria-hidden="true">' + withBuf.map((a) =>
        '<span style="width:' + (a.buffer / total * 100).toFixed(1) + '%;background:' + acc(a.color) + '"></span>').join('') + '</div>' +
      '<div class="rk-buf-legend">' + withBuf.map((a) =>
        '<span><i style="background:' + acc(a.color) + '"></i>' + esc(a.name) + ' <span class="mono muted">' + eur(a.buffer) + '</span></span>').join('') + '</div>' +
    '</section>';
  }

  function bufText(a) {
    return a.buffer !== null ? 'Buffer ' + eur(a.buffer) : 'Telt niet mee in de planning';
  }

  function avatar(a, size, color) {
    return '<span class="rk-avatar' + (size > 19 ? ' rk-avatar--lg' : '') + '" style="background:' + acc(color || a.color) + '">' + icon(a.icon, size, 2.2) + '</span>';
  }

  // Phone row: opens the sheet
  function phoneRow(a) {
    return '<button type="button" class="rk-row" data-action="open" data-id="' + a.id + '" data-key="row-p-' + a.id + '">' +
      avatar(a, 19) +
      '<span class="rk-row-main"><span class="rk-row-name">' + esc(a.name) + '</span><span class="rk-row-sub">' + esc(a.sub) + '</span>' +
        '<span class="rk-row-buf' + (a.buffer === null ? ' muted' : '') + '">' + bufText(a) + '</span></span>' +
      '<span class="rk-row-end"><span class="mono rk-row-amount">' + eur(a.balance) + '</span>' + chevron() + '</span>' +
    '</button>';
  }

  // Desktop row: selects the account for the panel
  function deskRow(a) {
    const on = a.id === sel;
    return '<button type="button" class="rk-drow" aria-pressed="' + on + '" data-action="select" data-id="' + a.id + '" data-key="row-d-' + a.id + '">' +
      avatar(a, 19) +
      '<span class="rk-drow-main"><span class="rk-drow-name">' + esc(a.name) + '</span><span class="rk-drow-sub">' + esc(a.sub) + '</span></span>' +
      '<span class="rk-drow-buf' + (a.buffer === null ? ' muted' : '') + '">' + bufText(a) + '</span>' +
      '<span class="mono rk-drow-amount">' + eur(a.balance) + '</span>' +
      chevron() +
    '</button>';
  }

  function chevron() {
    return '<span class="rk-chev">' + icon('chevron', 16, 2.2) + '</span>';
  }

  function groups(list) {
    return GROUPS.map((g, i) => {
      const rows = list.filter((a) => a.group === g.key);
      return '<section class="rk-group' + anim('anim-in', 60 + i * 30) + '" aria-labelledby="rk-g-' + g.key + '">' +
        '<div class="rk-group-head"><h2 class="label" id="rk-g-' + g.key + '">' + esc(g.title) + '</h2><span class="rk-group-note">· ' + esc(g.note) + '</span></div>' +
        '<div class="rk-list only-phone">' + rows.map(phoneRow).join('') + '</div>' +
        '<div class="only-desktop"><div class="rk-dlist">' + rows.map(deskRow).join('') + '</div></div>' +
      '</section>';
    }).join('');
  }

  // ---------- Editor (sheet on phone, panel on desktop) ----------

  function draftValues(cur) {
    const color = draft.color || cur.color;
    const name = draft.name !== undefined ? draft.name : cur.name;
    const buffer = draft.buffer !== undefined ? draft.buffer : cur.buffer;
    const bufInput = draft.bufInput !== undefined ? draft.bufInput : (buffer !== null ? String(Math.round(buffer / 100)) : '');
    return { color, name, buffer, bufInput };
  }

  function editor(p, inSheet) {
    const cur = current();
    const d = draftValues(cur);
    const shared = cur.group === 'ged';
    const bufHelp = shared
      ? 'Komt de gedeelde rekening onder dit bedrag, dan kleurt de planning geel. Onder € 0 wordt ze rood. Geldt voor jou en ' + D.partner.name + '.'
      : 'Komt deze rekening onder dit bedrag, dan kleurt de planning geel. Onder € 0 wordt ze rood.';

    const swatches = COLORS.map((c) => {
      const on = c[0] === d.color;
      return '<button type="button" class="rk-swatch" role="radio" aria-checked="' + on + '" aria-label="' + c[1] + '" tabindex="' + (on ? 0 : -1) + '"' +
        ' data-action="color" data-color="' + c[0] + '" data-key="sw-' + c[0] + '" style="background:' + acc(c[0]) + '">' +
        (on ? icon('check', 16, 3) : '') + '</button>';
    }).join('');

    const buffer = cur.buffer !== null
      ? '<div class="rk-field">' +
          '<label class="rk-label" for="rk-' + p + '-buf">Minimumbuffer</label>' +
          '<div class="rk-stepper">' +
            '<button type="button" class="rk-step" aria-label="€ 50 minder" data-action="buf-down" data-key="buf-down">−</button>' +
            '<div class="rk-money"><span aria-hidden="true">€</span><input class="input rk-money-input" id="rk-' + p + '-buf" inputmode="decimal" autocomplete="off" value="' + esc(d.bufInput) + '" data-input="buf" data-key="buf"></div>' +
            '<button type="button" class="rk-step" aria-label="€ 50 meer" data-action="buf-up" data-key="buf-up">+</button>' +
          '</div>' +
          '<span class="rk-help">' + esc(bufHelp) + '</span>' +
        '</div>'
      : '<p class="rk-note">Spaarrekeningen tellen niet mee als beschikbaar geld in je planning. Daarom hebben ze geen buffer.</p>';

    const actions = inSheet
      ? '<button type="button" class="rk-btn rk-btn--ghost" data-action="close" data-key="cancel">Annuleren</button>'
      : '<button type="button" class="rk-btn rk-btn--ghost" data-action="reset" data-key="reset"' + (dirty() ? '' : ' disabled') + '>Herstellen</button>';

    return '<div class="rk-editor' + (flip && !inSheet ? ' anim-fade' : '') + '">' +
      '<div class="rk-ed-head">' +
        avatar(cur, 22, d.color) +
        '<div class="rk-ed-title"><span class="rk-ed-name" data-bind="name">' + esc(d.name) + '</span><span class="rk-ed-sub">' + esc(cur.sub) + '</span></div>' +
        (inSheet ? '<button type="button" class="rk-close" aria-label="Sluiten" data-action="close" data-key="close">' + icon('close', 18, 2.4) + '</button>' : '') +
      '</div>' +
      '<div class="rk-field rk-field--tight">' +
        '<label class="rk-label" for="rk-' + p + '-name">Naam</label>' +
        '<input class="input" id="rk-' + p + '-name" autocomplete="off" value="' + esc(d.name) + '" data-input="name" data-key="name">' +
      '</div>' +
      '<div class="rk-field">' +
        '<span class="rk-label" id="rk-' + p + '-kleur">Kleur</span>' +
        '<div class="rk-swatches" role="radiogroup" aria-labelledby="rk-' + p + '-kleur">' + swatches + '</div>' +
        '<span class="rk-help">Deze kleur zie je overal bij deze rekening: in lijsten, grafieken en labels.</span>' +
      '</div>' +
      buffer +
      '<div class="rk-preview">' +
        '<span class="rk-preview-label">Voorbeeld</span>' +
        '<span class="rk-pill"><i style="background:' + acc(d.color) + '"></i><span data-bind="name">' + esc(d.name) + '</span></span>' +
        '<span class="mono rk-preview-amount">' + eur(-8642) + '</span>' +
      '</div>' +
      '<div class="rk-actions">' + actions +
        '<button type="button" class="rk-btn rk-btn--primary" data-action="save" data-key="save">Opslaan</button>' +
      '</div>' +
    '</div>';
  }

  // ---------- Painting ----------

  // Re-render while keeping keyboard focus on the same control
  function keepFocus(fn) {
    const a = document.activeElement;
    const key = a && a.dataset ? a.dataset.key : null;
    const inSheet = a && a.closest && !!a.closest('.rk-sheet');
    fn();
    if (!key) return;
    const scope = inSheet ? document.querySelector('.rk-sheet') : page;
    const el = scope && scope.querySelector('[data-key="' + key + '"]');
    if (el && el.getClientRects().length) el.focus();
  }

  function paint() {
    const list = accounts();
    page.innerHTML =
      header() +
      '<div class="rk-layout">' +
        '<div class="rk-col">' +
          bufferCard(list) +
          groups(list) +
          '<a class="btn btn--dashed only-phone rk-add-phone' + anim('anim-in', 120) + '" href="#">' + icon('plus', 16, 2.6) + 'Rekening toevoegen</a>' +
        '</div>' +
        '<div class="only-desktop"><section class="rk-panel' + anim('anim-in', 60) + '" aria-label="Rekening instellen" id="rk-panel">' + editor('d', false) + '</section></div>' +
      '</div>';
    painted = true;
    flip = false;
  }

  function paintEditors() {
    const panel = page.querySelector('#rk-panel');
    if (panel) panel.innerHTML = editor('d', false);
    const sheet = document.querySelector('.rk-sheet');
    if (sheet) sheet.innerHTML = '<div class="sheet-grip" aria-hidden="true"></div>' + editor('p', true);
    flip = false;
  }

  function refresh(all) {
    keepFocus(() => { if (all) paint(); else paintEditors(); });
  }

  // ---------- Phone sheet ----------

  let returnFocus = null;

  function openSheet(id, from) {
    sel = id;
    draft = {};
    sheetOpen = true;
    returnFocus = from || null;
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop rk-backdrop';
    wrap.innerHTML = '<div class="sheet rk-sheet" role="dialog" aria-modal="true" aria-label="Rekening instellen">' +
      '<div class="sheet-grip" aria-hidden="true"></div>' + editor('p', true) + '</div>';
    document.body.appendChild(wrap);
    wireEditor(wrap.querySelector('.rk-sheet'));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheet(); });
    const first = wrap.querySelector('[data-key="close"]');
    if (first) first.focus();
    // The desktop panel follows the same selection
    refresh(true);
  }

  function closeSheet() {
    const wrap = document.querySelector('.rk-backdrop');
    if (wrap) wrap.remove();
    sheetOpen = false;
    draft = {};
    if (returnFocus) {
      const el = page.querySelector('[data-key="' + returnFocus + '"]');
      if (el) el.focus();
    }
  }

  // ---------- Actions ----------

  function save() {
    const cur = current();
    const d = draftValues(cur);
    const patch = { color: d.color, name: (d.name || '').trim() || cur.name };
    if (cur.buffer !== null) patch.buffer = d.buffer;
    saved[cur.id] = Object.assign({}, saved[cur.id] || {}, patch);
    store.set('rekeningen', JSON.stringify(saved));
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

  const parseBuf = (s) => {
    const v = parseFloat(String(s).replace(/[\s€]/g, '').replace(/\./g, '').replace(',', '.'));
    return isFinite(v) && v >= 0 ? Math.round(v * 100) : 0;
  };

  function step(delta) {
    const d = draftValues(current());
    const b = Math.max(0, (d.buffer || 0) + delta);
    draft = Object.assign({}, draft, { buffer: b, bufInput: String(Math.round(b / 100)) });
    refresh(false);
  }

  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    if (act === 'open') openSheet(el.dataset.id, el.dataset.key);
    else if (act === 'select') {
      if (el.dataset.id === sel) return;
      sel = el.dataset.id;
      draft = {};
      flip = true;
      refresh(true);
    } else if (act === 'color') {
      draft = Object.assign({}, draft, { color: el.dataset.color });
      refresh(false);
    } else if (act === 'buf-down') step(-STEP);
    else if (act === 'buf-up') step(STEP);
    else if (act === 'reset') { draft = {}; refresh(false); }
    else if (act === 'close') closeSheet();
    else if (act === 'save') save();
  }

  // Live edits without re-rendering, so the caret stays put
  function onInput(e) {
    const el = e.target;
    const root = el.closest('.rk-editor');
    if (!root) return;
    if (el.dataset.input === 'name') {
      draft = Object.assign({}, draft, { name: el.value });
      document.querySelectorAll('.rk-editor [data-bind="name"]').forEach((n) => { n.textContent = el.value; });
    } else if (el.dataset.input === 'buf') {
      draft = Object.assign({}, draft, { bufInput: el.value, buffer: parseBuf(el.value) });
    }
    const reset = page.querySelector('[data-action="reset"]');
    if (reset) reset.disabled = !dirty();
  }

  // Arrow keys move through the colour radiogroup
  function onKey(e) {
    const sw = e.target.closest && e.target.closest('.rk-swatch');
    if (!sw) return;
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const i = COLORS.findIndex((c) => c[0] === sw.dataset.color);
    const next = COLORS[(i + keys[e.key] + COLORS.length) % COLORS.length][0];
    draft = Object.assign({}, draft, { color: next });
    const inSheet = !!sw.closest('.rk-sheet');
    paintEditors();
    const scope = inSheet ? document.querySelector('.rk-sheet') : page;
    scope.querySelector('[data-key="sw-' + next + '"]').focus();
  }

  function wireEditor(root) {
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey);
  }

  // ---------- Screen ----------

  function render(p) {
    page = p;
    paint();
    if (!page.dataset.rkWired) {
      page.dataset.rkWired = '1';
      wireEditor(page);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen) closeSheet(); });
    }
  }

  S.screens = S.screens || {};
  S.screens.rekeningen = { title: 'Rekeningen', render };
})(window.Saldo = window.Saldo || {});
