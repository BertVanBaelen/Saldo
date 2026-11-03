// Rekening: the detail page of one account, rekening.html?id=zicht|gedeeld|spaar|reserve.
// Header with balance and state against its own buffer, balance history, Saldo bijwerken (manual accounts),
// recent transactions, Leden and contribution split (shared accounts), Synchronisatie (bank accounts),
// Instellen (name, colour, buffer; the Rekeningen form) and removing or leaving the account.
// Not on the boards: derived from Rekeningen. Spec: analysis/screens/rekeningen.md#account-detail.
// Uses Saldo.accountKit from js/screens/rekeningen.js.
(function (S) {
  'use strict';

  const { eur, esc, cap, DAYS, MONTHS, MONTHS_SHORT, dateShort, dateRelative } = S.fmt;
  const icon = S.icon;
  const D = S.data;
  const kit = S.accountKit;

  // ---------- Screen demo data ----------

  const START = '2026-06-01';
  // Daily history of the bank accounts: the end-of-month balances (June to October) it passes through, the
  // balance on 31 May and the fixed flows per day of the month; the rest is spread as day-to-day spending.
  // Zicht: rent € 1.005 and the € 450 contribution on the 1st, salary € 2.850 on the 2nd, so it dips below
  // zero on the 1st; savings transfers as in Overzicht (none in July, € 400 in August).
  // Gedeeld: two contributions of € 450 on the 1st; it ends each month near € 647, in August in its buffer.
  const HISTORY = {
    zicht: { seed: 11, open: 131800, ends: [136300, 167800, 137300, 138800, 141300],
      fixed: [[1, -100500], [1, -45000], [2, 285000]], save: { 6: [16, -20000], 8: [14, -40000], 9: [16, -20000], 10: [16, -20000], 11: [16, -20000] } },
    gedeeld: { seed: 5, open: 65500, ends: [66200, 64000, 54800, 61000, 64686],
      fixed: [[1, 45000], [1, 45000], [5, -14500], [10, -4298]] }
  };
  // Manual balance updates (date, cents), oldest first
  const UPDATES = {
    spaar: [['2026-06-03', 1170000], ['2026-07-01', 1190000], ['2026-09-02', 1230000], ['2026-10-02', 1250000]],
    reserve: [['2026-06-03', 400000], ['2026-09-01', 415000], ['2026-10-02', 420000]]
  };
  // Transfers recognised by the IBAN of a manual account (from Zichtrekening), newest first
  const TRANSFERS = {
    spaar: [['2026-11-16', 20000], ['2026-10-16', 20000], ['2026-09-16', 20000], ['2026-08-14', 40000], ['2026-06-16', 20000]]
  };
  // Last five transactions per bank account (rows of Transacties)
  const TX = {
    zicht: [
      { date: '2026-11-18', name: 'Bol.com', ini: 'B', amt: -2499, cat: null, pending: true },
      { date: '2026-11-17', name: 'TotalEnergies', ini: 'T', amt: -6210, cat: 'Vervoer' },
      { date: '2026-11-17', name: 'Spotify', ini: 'S', amt: -1199, cat: 'Abonnementen' },
      { date: '2026-11-17', name: 'Bakkerij De Graankorrel', ini: 'B', amt: -840, cat: null },
      { date: '2026-11-16', name: 'Naar spaarrekening', ini: 'S', amt: -20000, cat: 'Gespaard', transfer: true }
    ],
    gedeeld: [
      { date: '2026-11-18', name: 'Colruyt Laagste Prijzen', ini: 'C', amt: -8642, cat: 'Boodschappen' },
      { date: '2026-11-16', name: 'Delhaize', ini: 'D', amt: -5437, cat: 'Boodschappen' },
      { date: '2026-11-13', name: 'Albert Heijn', ini: 'A', amt: -3214, cat: 'Boodschappen' },
      { date: '2026-11-12', name: 'Carrefour Express', ini: 'C', amt: -2265, cat: 'Boodschappen' },
      { date: '2026-11-01', name: 'Bijdrage Partner', ini: 'P', amt: 45000, cat: 'Bijdrage' }
    ]
  };
  // Required monthly contribution of a shared account (analysis.md 5.3): projected shared expenses minus
  // shared income other than member contributions.
  const NEED = { gedeeld: { expenses: 90000, otherIncome: 0 } };

  const HASH_DIALOGS = ['koppeling-verwijderen', 'verlaten', 'verwijderen'];
  const HASH_SECTIONS = ['saldoverloop', 'bijwerken', 'transacties', 'leden', 'synchronisatie', 'instellen'];

  // ---------- State ----------

  let page = null;
  let painted = false;
  let a = null;            // the account
  let hist = null;         // { days: [{ key, v }], updates? }
  let sel = -1;            // selected day in the chart
  let draft = {};          // Instellen
  let upd = null;          // Saldo bijwerken: { amount, date, err }
  let split = null;        // contribution split draft: { who: percent as text }
  let dialog = null;       // { kind, choice, confirm }
  let syncing = false;
  let synced = false;      // "Nu synchroniseren" is rate limited
  let returnFocus = null;

  const off = () => kit.isOffline();
  const today = () => D.today;

  function anim(cls, delay) {
    return painted ? '' : ' ' + cls + '" style="--d:' + delay + 'ms';
  }

  // ---------- Dates ----------

  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const dateOf = (key) => new Date(key + 'T12:00:00');
  // "woensdag 18 november"
  const dayLong = (key) => { const x = dateOf(key); return DAYS[x.getDay()] + ' ' + x.getDate() + ' ' + MONTHS[x.getMonth()]; };
  // "2 oktober 2026"
  const dateFull = (key) => { const x = dateOf(key); return x.getDate() + ' ' + MONTHS[x.getMonth()] + ' ' + x.getFullYear(); };

  function eachDay(from, to, fn) {
    const d = dateOf(from);
    const end = dateOf(to);
    while (d <= end) { fn(keyOf(d)); d.setDate(d.getDate() + 1); }
  }

  // Masked IBAN for display: demo values are masked already
  function mask(iban) {
    if (!iban) return '';
    if (iban.indexOf('•') >= 0) return iban;
    const t = iban.replace(/\s/g, '').toUpperCase();
    return t.length < 8 ? t : t.slice(0, 4) + ' •••• •••• ' + t.slice(-4);
  }

  // ---------- History ----------

  function mulberry(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // End-of-day balances from 1 June to today for a bank account
  function bankDays(id, balanceToday) {
    const h = HISTORY[id];
    const rnd = mulberry(h.seed);
    const t = dateOf(today());
    const out = [];
    let bal = h.open;
    [6, 7, 8, 9, 10, 11].forEach((m, mi) => {
      const isNow = m === t.getMonth() + 1;
      const last = isNow ? t.getDate() : new Date(2026, m, 0).getDate();
      const flows = {};
      h.fixed.forEach((f) => { flows[f[0]] = (flows[f[0]] || 0) + f[1]; });
      const sv = h.save && h.save[m];
      if (sv && sv[0] <= last) flows[sv[0]] = (flows[sv[0]] || 0) + sv[1];
      const fixedSum = Object.keys(flows).reduce((s, d) => s + flows[d], 0);
      const end = isNow ? balanceToday : h.ends[mi];
      const variable = bal + fixedSum - end;
      const w = [];
      let ws = 0;
      for (let d = 1; d <= last; d++) {
        const dow = new Date(2026, m - 1, d).getDay();
        const r = rnd();
        w[d] = r < 0.16 ? 0 : r * r * (dow === 0 || dow === 6 ? 1.7 : 1);
        ws += w[d];
      }
      for (let d = 1; d <= last; d++) {
        bal += (flows[d] || 0) - variable * w[d] / (ws || 1);
        out.push({ key: '2026-' + pad(m) + '-' + pad(d), v: Math.round(bal) });
      }
    });
    out[out.length - 1].v = balanceToday;
    return out;
  }

  // Manual updates, oldest first: saved ones (from "Saldo bijwerken") or the demo list
  function updatesOf(acc) {
    const list = acc.updates || UPDATES[acc.id] || [[today(), acc.balance]];
    return list.map((u) => ({ date: u[0], v: u[1] })).sort((x, y) => (x.date < y.date ? -1 : 1));
  }

  function buildHistory() {
    if (a.manual) {
      const ups = updatesOf(a);
      const days = [];
      let i = 0;
      let cur = ups[0].v;
      eachDay(START, today(), (key) => {
        while (i < ups.length && ups[i].date <= key) { cur = ups[i].v; i++; }
        days.push({ key, v: cur });
      });
      return { days, updates: ups };
    }
    return HISTORY[a.id] ? { days: bankDays(a.id, a.balance) } : null;
  }

  // ---------- Pieces ----------

  function top() {
    return '<a class="rkd-back' + anim('anim-fade', 0) + '" href="rekeningen.html" aria-label="Terug naar Rekeningen">' + icon('back', 20, 2.4) + '<span>Rekeningen</span></a>';
  }

  function cardHead(id, title, meta, extra) {
    return '<div class="rkd-card-head">' +
      '<span class="rkd-card-titles"><h2 class="rkd-card-title" id="' + id + '">' + esc(title) + '</h2>' + (meta ? '<span class="rkd-card-meta">' + meta + '</span>' : '') + '</span>' +
      (extra || '') +
    '</div>';
  }

  function syncLine(s) {
    if (!s) {
      return '<span class="rkd-sync">' + icon('edit', 14, 2.2) + '<span>Handmatig · bijgewerkt ' + esc(a.updated) + '</span>' +
        (a.readOnly ? '' : '<a href="#bijwerken" data-action="goto" data-target="bijwerken">Bijwerken</a>') + '</span>';
    }
    if (s.tone === 'neg') return '<span class="rkd-sync rkd-sync--neg">' + icon('warning', 14, 2.2) + '<span>Synchronisatie mislukt · stand van ' + esc(s.last) + '</span></span>';
    if (s.tone === 'warn') return '<span class="rkd-sync rkd-sync--warn">' + icon('clock', 14, 2.2) + '<span>Niet bijgewerkt sinds ' + esc(s.last) + '</span></span>';
    if (syncing) return '<span class="rkd-sync">' + icon('sync', 14, 2.2) + '<span>Synchroniseren…</span></span>';
    return '<span class="rkd-sync">' + icon('sync', 14, 2.2) + '<span>' + esc(s.bank + (s.takeover ? ' · via ' + s.by.owner : '') + ' · bijgewerkt ' + (synced ? 'zojuist' : s.last)) + '</span></span>';
  }

  function hero() {
    const st = kit.bufferState(a);
    const s = kit.sync(a.id);
    const kind = a.shared
      ? '<span class="rkd-kind rkd-kind--ged">' + icon('people', 14, 2.2) + 'Gedeeld · ' + esc(kit.withText(a.id)) + '</span>'
      : '<span class="rkd-kind rkd-kind--pers">' + icon('person', 14, 2.2) + 'Persoonlijk · alleen jij</span>';
    const type = '<span class="rkd-kind">' + (a.type === 'savings' ? 'Spaarrekening' : 'Zichtrekening') + ' · ' + (a.manual ? 'handmatig' : esc(a.source)) + '</span>';
    const ro = a.readOnly ? '<span class="chip chip--readonly rkd-ro-chip">' + icon('lock', 13, 2.2) + 'Alleen lezen</span>' : '';
    const iban = a.iban ? '<span class="mono rkd-iban">' + esc(mask(a.iban)) + '</span>' : '<span class="rkd-iban rkd-iban--none">Geen IBAN</span>';
    const state = st
      ? '<span class="rkd-state"><span class="chip chip--' + st.tone + '">' + st.chip + '</span><span class="rkd-state-text">' + esc(st.text) + '</span></span>'
      : '<span class="rkd-state"><span class="chip rkd-chip-plain">Telt niet mee in de planning</span><span class="rkd-state-text">Spaarrekeningen hebben geen buffer</span></span>';
    return '<section class="rkd-hero' + anim('anim-in', 20) + '" aria-labelledby="rkd-name">' +
      '<div class="rkd-hero-id">' +
        '<span class="rk-avatar rk-avatar--lg" style="background:var(--acc)">' + icon(a.icon, 22, 2.2) + '</span>' +
        '<span class="rkd-hero-names"><h1 class="rkd-name" id="rkd-name">' + esc(a.name) + '</h1>' + iban + '</span>' +
      '</div>' +
      '<div class="rkd-kinds">' + kind + type + ro + '</div>' +
      '<div class="rkd-hero-bal">' +
        '<span class="rkd-bal-label">' + (a.manual ? 'Saldo · handmatig' : 'Saldo nu') + '</span>' +
        '<span class="mono rkd-bal' + (a.balance < 0 ? ' neg' : '') + '">' + eur(a.balance) + '</span>' +
        state +
        syncLine(s) +
      '</div>' +
    '</section>';
  }

  function alertRow(kind, ic, title, note, href, target) {
    return '<a class="alert alert--' + kind + ' rkd-alert' + anim('anim-in', 40) + '" href="' + href + '"' + (target ? ' data-action="goto" data-target="' + target + '"' : '') + '>' +
      '<span class="alert-icon">' + icon(ic, 17, 2.2) + '</span>' +
      '<span class="alert-text"><strong>' + esc(title) + '</strong><br><span>' + esc(note) + '</span></span>' +
      '<span class="rkd-chev">' + icon('chevron', 18) + '</span>' +
    '</a>';
  }

  // Stale or failed sync, under the header (bank accounts)
  function syncAlert() {
    const s = kit.sync(a.id);
    if (!s || synced) return '';
    if (s.tone === 'neg') return alertRow('neg', 'warning', 'Synchronisatie mislukt · ' + s.bank + ' antwoordt niet', 'Je ziet de stand van ' + s.last + '. Bekijk de synchronisatie.', '#synchronisatie', 'synchronisatie');
    if (s.tone === 'warn') return alertRow('warn', 'sync', 'Niet bijgewerkt sinds ' + s.last, 'Het saldo en je planning kunnen afwijken. Bekijk de synchronisatie.', '#synchronisatie', 'synchronisatie');
    if (s.takeover) return alertRow('warn', 'sync', 'Jouw koppeling werkt niet', 'De koppeling van ' + s.by.owner + ' houdt deze rekening bij. Autoriseer jouw koppeling opnieuw.', 'bankkoppelingen.html#opnieuw');
    return '';
  }

  // ---------- Balance history ----------

  function stateColor(v) {
    if (a.hasBuffer && v < 0) return 'var(--neg)';
    if (a.hasBuffer && v < a.buffer) return 'var(--warn)';
    return 'var(--text)';
  }

  function readout(i) {
    const p = hist.days[i];
    const isToday = p.key === today();
    let label = isToday ? 'Vandaag · ' + dayLong(p.key) : cap(dayLong(p.key));
    if (a.manual) {
      const u = hist.updates.filter((x) => x.date <= p.key).pop();
      label += u ? (u.date === p.key ? ' · bijgewerkt' : ' · stand van ' + dateShort(u.date)) : '';
    }
    return '<span class="rkd-readout-date">' + esc(label) + '</span>' +
      '<span class="mono rkd-readout-amount" style="color:' + stateColor(p.v) + '">' + eur(p.v) + '</span>';
  }

  function valueText(i) {
    const p = hist.days[i];
    return dayLong(p.key) + ': ' + eur(p.v);
  }

  function stats() {
    const days = hist.days;
    if (a.manual) {
      const ups = hist.updates;
      const growth = ups[ups.length - 1].v - ups[0].v;
      return '<div class="rkd-stats">' +
        stat('Sinds ' + dateShort(ups[0].date), eur(growth, true), growth >= 0 ? 'var(--greenText)' : 'var(--neg)') +
        stat('Updates', String(ups.length)) +
        stat('Laatste update', dateShort(ups[ups.length - 1].date)) +
      '</div>';
    }
    let lo = 0;
    let hi = 0;
    days.forEach((p, i) => { if (p.v < days[lo].v) lo = i; if (p.v > days[hi].v) hi = i; });
    const under = days.filter((p) => p.v < a.buffer).length;
    return '<div class="rkd-stats">' +
      stat('Laagste · ' + dateShort(days[lo].key), eur(days[lo].v), stateColor(days[lo].v)) +
      stat('Hoogste · ' + dateShort(days[hi].key), eur(days[hi].v)) +
      stat('Onder de buffer', under + (under === 1 ? ' dag' : ' dagen'), under ? 'var(--warn)' : '') +
    '</div>';
  }

  function stat(label, value, color) {
    return '<span class="rkd-stat"><span class="rkd-stat-label">' + esc(label) + '</span><span class="mono rkd-stat-value"' + (color ? ' style="color:' + color + '"' : '') + '>' + esc(value) + '</span></span>';
  }

  function historyCard() {
    if (!hist) return '';
    const n = hist.days.length;
    const ticks = [];
    hist.days.forEach((p, i) => {
      if (p.key.slice(8) === '01') ticks.push('<span style="left:calc(4px + (100% - 8px) * ' + (i / (n - 1)).toFixed(4) + ')">' + MONTHS_SHORT[+p.key.slice(5, 7) - 1] + '</span>');
    });
    const legend = a.manual
      ? '<div class="legend rkd-legend"><span><i class="rkd-key-dot"></i>Handmatige update</span><span><i class="rkd-key-dash" style="border-color:var(--acc)"></i>Nog niet bijgewerkt</span></div>'
      : '<div class="legend rkd-legend"><span><i class="rkd-key-dash"></i>Buffer ' + eur(a.buffer) + '</span><span><i class="rkd-key-zero"></i>€ 0</span>' +
          '<span><i class="rkd-key-box" style="background:var(--warnChip)"></i>In de bufferzone</span><span><i class="rkd-key-box rkd-key-box--neg"></i>Onder nul</span></div>';
    return '<section class="card rkd-card' + anim('anim-in', 60) + '" id="saldoverloop" aria-labelledby="rkd-h-hist">' +
      cardHead('rkd-h-hist', 'Saldoverloop', a.manual ? 'Handmatig · bijgewerkt ' + esc(a.updated) : 'Laatste 6 maanden · saldo op het einde van elke dag') +
      '<div class="rkd-readout" data-readout aria-hidden="true">' + readout(sel) + '</div>' +
      '<div class="rkd-plot" data-plot tabindex="0" role="slider" aria-label="Saldo per dag, kies een dag met de pijltjestoetsen"' +
        ' aria-valuemin="0" aria-valuemax="' + (n - 1) + '" aria-valuenow="' + sel + '" aria-valuetext="' + esc(valueText(sel)) + '"><svg aria-hidden="true"></svg></div>' +
      '<div class="rkd-axis" aria-hidden="true">' + ticks.join('') + '</div>' +
      stats() +
      legend +
    '</section>';
  }

  // Line (bank) or step line (manual) on the plot's pixel width, with buffer and zero zones like Planning
  function chartSvg(W, H) {
    const days = hist.days;
    const n = days.length;
    const vals = days.map((p) => p.v);
    let lo;
    let hi;
    if (a.manual) {
      const mn = Math.min.apply(null, vals);
      const mx = Math.max.apply(null, vals);
      const padV = Math.max((mx - mn) * 0.35, 20000);
      lo = mn - padV;
      hi = mx + padV;
    } else {
      const mn = Math.min(Math.min.apply(null, vals), 0);
      const mx = Math.max(Math.max.apply(null, vals), a.buffer);
      const padV = (mx - mn) * 0.08;
      lo = mn - padV;
      hi = mx + padV;
    }
    const X = (i) => Math.round(i / (n - 1) * (W - 8) * 10) / 10 + 4;
    const Y = (v) => Math.round((H - (v - lo) / (hi - lo) * H) * 10) / 10;
    const ink = 'var(--acc)';
    let s = '';
    let line = '';
    if (a.manual) {
      const ups = hist.updates;
      const idx = (key) => days.findIndex((p) => p.key >= key);
      let started = false;
      let lastI = 0;
      ups.forEach((u) => {
        const i = Math.max(0, idx(u.date));
        if (idx(u.date) < 0) return;
        if (!started) { line += 'M' + X(i) + ' ' + Y(u.v); started = true; } else line += ' H' + X(i) + ' V' + Y(u.v);
        lastI = i;
      });
      const lastV = ups[ups.length - 1].v;
      const firstI = Math.max(0, idx(ups[0].date));
      s += '<path d="' + line + ' H' + X(n - 1) + ' V' + H + ' H' + X(firstI) + ' Z" style="fill:' + ink + ';opacity:0.12"></path>';
      s += '<path d="' + line + '" fill="none" style="stroke:' + ink + ';stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round"></path>';
      s += '<path d="M' + X(lastI) + ' ' + Y(lastV) + ' H' + X(n - 1) + '" fill="none" style="stroke:' + ink + ';stroke-width:2.5;stroke-dasharray:5 5;stroke-linecap:round"></path>';
      ups.forEach((u) => {
        const i = idx(u.date);
        if (i >= 0) s += '<circle cx="' + X(i) + '" cy="' + Y(u.v) + '" r="4.5" style="fill:var(--surface);stroke:' + ink + ';stroke-width:2.5"></circle>';
      });
    } else {
      const yb = Y(a.buffer);
      const y0 = Y(0);
      const low = Math.min.apply(null, vals);
      s += '<rect x="0" y="' + Math.max(0, yb) + '" width="' + W + '" height="' + Math.max(0, Math.min(H, y0) - Math.max(0, yb)) + '" rx="3" style="fill:' +
        (low < a.buffer ? 'var(--warnChip);opacity:0.6' : 'var(--track);opacity:0.5') + '"></rect>';
      s += '<rect x="0" y="' + Math.min(H, y0) + '" width="' + W + '" height="' + Math.max(0, H - Math.min(H, y0)) + '" rx="3" style="fill:' +
        (low < 0 ? 'var(--neg);opacity:0.16' : 'var(--track);opacity:0') + '"></rect>';
      line = vals.map((v, i) => (i ? 'L' : 'M') + X(i) + ' ' + Y(v)).join(' ');
      s += '<path d="' + line + ' L' + X(n - 1) + ' ' + H + ' L' + X(0) + ' ' + H + ' Z" style="fill:' + ink + ';opacity:0.1"></path>';
      s += '<line x1="0" x2="' + W + '" y1="' + y0 + '" y2="' + y0 + '" style="stroke:var(--muted);stroke-width:1.5"></line>';
      s += '<line x1="0" x2="' + W + '" y1="' + yb + '" y2="' + yb + '" style="stroke:var(--muted);stroke-width:1.5;stroke-dasharray:4 4"></line>';
      s += '<text class="rkd-chart-lbl" x="' + (W - 4) + '" y="' + Math.max(10, yb - 5) + '" text-anchor="end">buffer</text>';
      s += '<text class="rkd-chart-lbl" x="' + (W - 4) + '" y="' + Math.min(H - 3, y0 + 13) + '" text-anchor="end">€ 0</text>';
      s += '<path d="' + line + '" fill="none" style="stroke:' + ink + ';stroke-width:2;stroke-linejoin:round;stroke-linecap:round"></path>';
      let li = 0;
      vals.forEach((v, i) => { if (v < vals[li]) li = i; });
      if (vals[li] < a.buffer) s += '<circle cx="' + X(li) + '" cy="' + Y(vals[li]) + '" r="4" style="fill:' + stateColor(vals[li]) + '"></circle>';
    }
    s += '<line x1="' + X(sel) + '" x2="' + X(sel) + '" y1="0" y2="' + H + '" style="stroke:var(--text);stroke-width:1;opacity:0.35"></line>';
    s += '<circle cx="' + X(sel) + '" cy="' + Y(vals[sel]) + '" r="5.5" style="fill:var(--surface);stroke:var(--text);stroke-width:2.5"></circle>';
    return s;
  }

  function drawChart() {
    const plot = page && page.querySelector('[data-plot]');
    if (!plot || !hist) return;
    const W = Math.round(plot.clientWidth);
    const H = Math.round(plot.clientHeight);
    if (!W || !H) return;
    const svg = plot.querySelector('svg');
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = chartSvg(W, H);
  }

  function select(i) {
    const n = hist.days.length;
    i = Math.max(0, Math.min(n - 1, i));
    if (i === sel) return;
    sel = i;
    const plot = page.querySelector('[data-plot]');
    plot.setAttribute('aria-valuenow', sel);
    plot.setAttribute('aria-valuetext', valueText(sel));
    page.querySelector('[data-readout]').innerHTML = readout(sel);
    drawChart();
  }

  function pointAt(e) {
    const plot = page.querySelector('[data-plot]');
    const r = plot.getBoundingClientRect();
    const n = hist.days.length;
    return Math.round((e.clientX - r.left - 4) / Math.max(1, r.width - 8) * (n - 1));
  }

  // ---------- Saldo bijwerken (manual accounts) ----------

  function transfersSince(date) {
    return (TRANSFERS[a.id] || []).filter((t) => t[0] > date);
  }

  function updateCard() {
    const ups = updatesOf(a);
    const last = ups[ups.length - 1];
    const u = upd || { amount: '', date: today(), err: {} };
    const ro = a.readOnly;
    const since = a.iban ? transfersSince(last.date) : [];
    const sum = since.reduce((s, t) => s + t[1], 0);
    const hint = since.length
      ? '<div class="rkd-hint">' +
          '<span class="rkd-hint-icon">' + icon('transfer', 18, 2.2) + '</span>' +
          '<span class="rkd-hint-text">Sinds ' + dateShort(last.date) + ' herkende Saldo ' + since.length + (since.length === 1 ? ' overschrijving' : ' overschrijvingen') +
            ' naar deze rekening: <strong class="mono">' + eur(sum, true) + '</strong>. Rente zie je pas op je bankafschrift.</span>' +
          '<button type="button" class="btn btn--secondary rkd-hint-btn" data-action="use-hint" data-key="use-hint" data-amount="' + (last.v + sum) + '">' + eur(last.v + sum) + ' invullen</button>' +
        '</div>'
      : '';
    const rows = ups.slice().reverse().map((x, i, arr) => {
      const prev = arr[i + 1];
      const diff = prev ? x.v - prev.v : null;
      return '<li class="rkd-upd-row"><span class="rkd-upd-date">' + esc(dateFull(x.date)) + '</span>' +
        '<span class="mono rkd-upd-amount">' + eur(x.v) + '</span>' +
        '<span class="mono rkd-upd-diff' + (diff === null ? ' muted' : (diff >= 0 ? ' pos' : ' neg')) + '">' + (diff === null ? 'begin' : eur(diff, true)) + '</span></li>';
    }).join('');
    return '<section class="card rkd-card' + anim('anim-in', 80) + '" id="bijwerken" aria-labelledby="rkd-h-upd">' +
      cardHead('rkd-h-upd', 'Saldo bijwerken', 'Laatst bijgewerkt op ' + esc(dateFull(last.date))) +
      hint +
      '<div class="rkd-upd-form">' +
        '<div class="rk-field rk-field--tight">' +
          '<label class="rk-label" for="rkd-upd-amount">Saldo</label>' +
          '<div class="rk-money"><span aria-hidden="true">€</span><input class="input rk-money-input rk-money-input--left' + (u.err.amount ? ' rk-input--err' : '') + '" id="rkd-upd-amount" inputmode="decimal" autocomplete="off" placeholder="' + kit.inputMoney(last.v) + '"' +
            ' value="' + esc(u.amount) + '" data-input="upd-amount" data-key="upd-amount"' + (u.err.amount ? ' aria-invalid="true" aria-describedby="rkd-upd-amount-err"' : '') + (ro ? ' disabled' : '') + '></div>' +
          (u.err.amount ? '<span class="rk-err" id="rkd-upd-amount-err">' + esc(u.err.amount) + '</span>' : '') +
        '</div>' +
        '<div class="rk-field rk-field--tight">' +
          '<label class="rk-label" for="rkd-upd-date">Datum</label>' +
          '<input class="input rkd-date' + (u.err.date ? ' rk-input--err' : '') + '" type="date" id="rkd-upd-date" max="' + today() + '" value="' + esc(u.date) + '" data-input="upd-date" data-key="upd-date"' +
            (u.err.date ? ' aria-invalid="true" aria-describedby="rkd-upd-date-err"' : '') + (ro ? ' disabled' : '') + '>' +
          (u.err.date ? '<span class="rk-err" id="rkd-upd-date-err">' + esc(u.err.date) + '</span>' : '') +
        '</div>' +
        '<button type="button" class="btn btn--primary rkd-upd-save" data-action="upd-save" data-key="upd-save"' + (off() || ro ? ' disabled' : '') + '>Opslaan</button>' +
      '</div>' +
      offlineNote('Bijwerken') +
      '<div class="rkd-sub">' +
        '<h3 class="label rkd-sub-label">Geschiedenis</h3>' +
        '<ul class="rkd-upd-list">' + rows + '</ul>' +
      '</div>' +
    '</section>';
  }

  function offlineNote(what) {
    return off() ? '<p class="rk-offline">' + icon('cloudOff', 14, 2.2) + 'Je bent offline. ' + what + ' kan weer zodra je verbinding hebt.</p>' : '';
  }

  // ---------- Transactions ----------

  function catLook(cat) {
    if (!cat) return null;
    if (D.categories[cat]) return { bg: D.categories[cat], fg: cat === 'Overig' ? 'var(--onC6)' : 'var(--onPastel)' };
    return { bg: 'var(--soft)', fg: 'var(--greenText)' };
  }

  function txRow(t) {
    const look = catLook(t.cat);
    const av = look
      ? '<span class="rkd-tx-av" style="background:' + look.bg + ';color:' + look.fg + '" aria-hidden="true">' + esc(t.ini) + '</span>'
      : '<span class="rkd-tx-av rkd-tx-av--uncat" aria-hidden="true">?</span>';
    const cls = t.pending ? 'muted' : (t.amt < 0 && !t.transfer ? 'neg' : '');
    return '<li class="rkd-tx">' + av +
      '<span class="rkd-tx-main"><span class="rkd-tx-name">' + esc(t.name) + '</span>' +
        '<span class="rkd-tx-sub">' + esc((t.cat || 'Niet gecategoriseerd') + ' · ' + dateRelative(t.date)) + '</span></span>' +
      '<span class="rkd-tx-end"><span class="mono rkd-tx-amount ' + cls + '">' + eur(t.amt, true) + '</span>' +
        (t.pending ? '<span class="rkd-pending">In behandeling</span>' : '') + '</span>' +
    '</li>';
  }

  function txCard() {
    const link = '<a class="section-link rkd-all" href="transacties.html">Alle transacties' + icon('chevron', 16, 2.2) + '</a>';
    if (!a.manual) {
      return '<section class="card rkd-card' + anim('anim-in', 100) + '" id="transacties" aria-labelledby="rkd-h-tx">' +
        cardHead('rkd-h-tx', 'Recente transacties', '', link) +
        '<ul class="rkd-txs">' + (TX[a.id] || []).slice(0, 5).map(txRow).join('') + '</ul>' +
      '</section>';
    }
    const list = a.iban ? (TRANSFERS[a.id] || []) : [];
    const rows = list.slice(0, 5).map((t) => txRow({ date: t[0], name: 'Van Zichtrekening', ini: 'Z', amt: t[1], cat: 'Gespaard', transfer: true })).join('');
    let body;
    if (rows) body = '<ul class="rkd-txs">' + rows + '</ul>';
    else if (!a.iban) {
      body = '<div class="rkd-empty">' +
        '<p>Nog geen overschrijvingen herkend. Vul het IBAN van deze rekening in bij Instellen, dan herkent Saldo overschrijvingen vanaf je eigen rekeningen en telt ze als gespaard.</p>' +
        '<button type="button" class="btn btn--ghost" data-action="goto" data-target="instellen" data-focus="rk-dt-iban" data-key="fill-iban">IBAN invullen</button>' +
      '</div>';
    } else body = '<div class="rkd-empty"><p>Nog geen overschrijvingen naar dit IBAN gevonden.</p></div>';
    return '<section class="card rkd-card' + anim('anim-in', 100) + '" id="transacties" aria-labelledby="rkd-h-tx">' +
      cardHead('rkd-h-tx', 'Overschrijvingen naar deze rekening', a.iban ? 'Herkend aan het IBAN · tellen als gespaard' : '', rows ? link : '') +
      body +
    '</section>';
  }

  // ---------- Synchronisatie (bank accounts) ----------

  function sourceRow(src) {
    const consent = 'tot ' + src.validUntil + (src.mine ? ' · nog ' + src.daysLeft + ' dagen' : '');
    const consentTone = src.mine && src.daysLeft <= 14 ? ' class="warn"' : '';
    return '<li class="rkd-src">' +
      '<span class="rkd-src-icon">' + icon('bank', 18, 2.2) + '</span>' +
      '<div class="rkd-src-main">' +
        '<div class="rkd-src-top"><span class="rkd-src-title">' + esc(src.title) + '</span>' +
          '<span class="rkd-prio' + (src.priority === 'primary' ? ' rkd-prio--primary' : '') + '">' + src.prioLabel + '</span></div>' +
        '<dl class="rkd-facts">' +
          '<div><dt>Toestemming</dt><dd' + consentTone + '>' + esc(consent) + '</dd></div>' +
          '<div><dt>Laatste sync</dt><dd>' + esc(synced && src.tone === 'ok' ? 'zojuist' : src.last) + '</dd></div>' +
          '<div><dt>Status</dt><dd><span class="chip chip--' + src.tone + ' rkd-src-chip">' + esc(src.status) + '</span></dd></div>' +
        '</dl>' +
        (src.problem ? '<p class="rkd-src-problem rkd-src-problem--' + src.tone + '">' + esc(src.problem) + '</p>' : '') +
      '</div>' +
    '</li>';
  }

  function syncCard() {
    const s = kit.sync(a.id);
    if (!s) return '';
    const mine = s.sources.find((x) => x.mine);
    const fallback = s.sources.length > 1;
    const statusIcon = s.tone === 'neg' ? 'warning' : (s.tone === 'warn' ? 'clock' : 'check');
    const statusText = s.tone === 'neg' ? 'Mislukt vandaag ' + s.sources[0].last.split(' ').pop() + ' · stand van ' + s.last
      : (s.tone === 'warn' ? 'Niet bijgewerkt sinds ' + s.last : 'Laatst gesynchroniseerd ' + (synced ? 'zojuist' : s.last) + (s.takeover ? ' via ' + s.by.owner : ''));
    const help = fallback
      ? 'De primaire koppeling haalt saldo en transacties op. Werkt ze niet meer, dan neemt de reservekoppeling vanzelf over. Transacties worden nooit dubbel geteld.'
      : 'Alleen jouw koppeling houdt deze rekening bij. Banken vragen elke 180 dagen opnieuw toestemming.';
    const retry = s.tone === 'neg' || s.tone === 'warn';
    const reauthFirst = !retry && mine && mine.daysLeft <= 14;
    const actions = mine
      ? '<div class="rkd-actions">' +
          (retry ? '<button type="button" class="btn btn--primary btn--block" data-action="sync" data-key="retry">' + icon('sync', 18, 2.2) + 'Nu opnieuw proberen</button>' : '') +
          '<a class="btn ' + (reauthFirst ? 'btn--primary' : 'btn--ghost') + ' btn--block" href="bankkoppelingen.html#opnieuw" data-action="reauth">' + icon('link', 18, 2.2) + 'Opnieuw autoriseren</a>' +
          '<button type="button" class="btn btn--danger btn--block" data-action="unlink" data-key="unlink" aria-haspopup="dialog">Mijn koppeling voor deze rekening verwijderen</button>' +
        '</div>'
      : '';
    return '<section class="card rkd-card' + anim('anim-in', 70) + '" id="synchronisatie" aria-labelledby="rkd-h-sync">' +
      cardHead('rkd-h-sync', 'Synchronisatie', '',
        '<button type="button" class="icon-btn rkd-sync-btn" data-action="sync" data-key="sync" aria-label="' + (off() ? 'Synchroniseren kan niet: je bent offline' : (syncing ? 'Bezig met synchroniseren' : 'Nu synchroniseren')) + '"' + (off() ? ' aria-disabled="true"' : '') + '>' +
          '<span class="' + (syncing ? 'spin' : '') + '" style="display:flex">' + icon('sync', 20, 2.2) + '</span></button>') +
      '<div class="rkd-sync-status rkd-sync-status--' + (s.tone || 'ok') + '">' +
        '<span class="rkd-sync-status-icon">' + icon(statusIcon, 16, 2.4) + '</span>' +
        '<span class="rkd-sync-status-text"><strong>' + esc(statusText) + '</strong><small>Elke nacht rond 04:00, of nu met de knop.</small></span>' +
      '</div>' +
      '<ul class="rkd-srcs">' + s.sources.map(sourceRow).join('') + '</ul>' +
      '<p class="rkd-help">' + esc(help) + (a.readOnly ? ' Je beheert alleen je eigen koppeling.' : '') + '</p>' +
      actions +
    '</section>';
  }

  // ---------- Leden (shared accounts) ----------

  function shareValues(list) {
    const out = {};
    list.forEach((m) => { out[m.who] = split && split[m.who] !== undefined ? split[m.who] : String(m.share); });
    return out;
  }

  function ledenCard() {
    const list = kit.members(a.id);
    const me = list.find((m) => m.me);
    const isMgr = !!(me && me.role === 'manager');
    const disabled = off() ? ' disabled' : '';
    const need = NEED[a.id];
    const needCents = need ? need.expenses - need.otherIncome : 0;
    const vals = shareValues(list);
    const total = list.reduce((s, m) => s + (parseInt(vals[m.who], 10) || 0), 0);
    const ok = total === 100;
    const contrib = D.members[a.id] ? D.contributions : null;
    const paid = (m) => (contrib ? contrib.rows.find((r) => (m.me ? r.who === 'Jij' : r.who === m.who)) : null);

    const memberRow = (m) => {
      let perm;
      if (m.role === 'manager') perm = '<span class="rkd-perm-text">Bewerken · beheert de rekening</span>';
      else if (isMgr) {
        perm = '<div class="rkd-seg" role="group" aria-label="Rechten van ' + esc(m.who) + '">' +
          ['read', 'edit'].map((p) => '<button type="button" aria-pressed="' + (m.perm === p) + '" data-action="perm" data-who="' + esc(m.who) + '" data-perm="' + p + '" data-key="perm-' + esc(m.who) + '-' + p + '"' + disabled + '>' +
            (p === 'read' ? 'Lezen' : 'Bewerken') + '</button>').join('') +
        '</div>';
      } else perm = '<span class="rkd-perm-text">' + (m.perm === 'read' ? icon('lock', 13, 2.2) + 'Lezen' : 'Bewerken') + '</span>';
      return '<li class="rkd-member">' +
        '<span class="avatar avatar--md" style="background:' + m.tint + '" aria-hidden="true">' + esc(m.initial) + '</span>' +
        '<span class="rkd-member-main">' +
          '<span class="rkd-member-name">' + esc(m.who) + (m.me ? ' <span class="muted">(jij)</span>' : '') +
            '<span class="rkd-role' + (m.role === 'manager' ? ' rkd-role--mgr' : '') + '">' + (m.role === 'manager' ? 'Beheerder' : 'Lid') + '</span></span>' +
          '<span class="rkd-member-sub">sinds ' + esc(m.since) + '</span>' +
        '</span>' +
        '<span class="rkd-perm">' + perm + '</span>' +
      '</li>';
    };

    const shareRow = (m) => {
      const pct = parseInt(vals[m.who], 10) || 0;
      const p = paid(m);
      const input = isMgr
        ? '<span class="rkd-pct"><input class="input mono" inputmode="numeric" autocomplete="off" maxlength="3" value="' + esc(vals[m.who]) + '" aria-label="Aandeel van ' + esc(m.who) + ' in procent"' +
            ' data-input="share" data-who="' + esc(m.who) + '" data-key="share-' + esc(m.who) + '"' + disabled + '><span aria-hidden="true">%</span></span>'
        : '<span class="mono rkd-pct-text">' + pct + ' %</span>';
      return '<li class="rkd-share">' +
        '<span class="avatar avatar--sm" style="background:' + m.tint + '" aria-hidden="true">' + esc(m.initial) + '</span>' +
        '<span class="rkd-share-main"><span class="rkd-share-name">' + esc(m.me ? 'Jij' : m.who) + '</span>' +
          (p ? '<span class="rkd-share-paid' + (p.ok ? '' : ' warn') + '">' + (p.ok ? icon('check', 13, 2.6) + esc(cap(contrib.month)) + ' ontvangen' : esc(cap(contrib.month)) + ' nog niet ontvangen') + '</span>' : '') +
        '</span>' +
        input +
        '<span class="mono rkd-share-amount" data-share-amount="' + esc(m.who) + '">' + eur(Math.round(needCents * pct / 100)) + '</span>' +
      '</li>';
    };

    const mgr = list.find((m) => m.role === 'manager');
    const next = list.filter((m) => !m.me).sort((x, y) => kit.dateKey(x.since) - kit.dateKey(y.since))[0];
    const leave = '<div class="rkd-danger">' +
      (isMgr && next ? '<p class="rkd-help">Verlaat jij de rekening, dan wordt ' + esc(next.who) + ' beheerder: het langst aangesloten lid.</p>' : '') +
      '<button type="button" class="btn btn--danger btn--block" data-action="leave" data-key="leave" aria-haspopup="dialog">Rekening verlaten</button>' +
      (isMgr ? '<button type="button" class="btn btn--danger btn--block rkd-delete-all" data-action="delete-all" data-key="delete-all" aria-haspopup="dialog">' + icon('trash', 18, 2.2) + 'Rekening voor iedereen verwijderen</button>' : '') +
    '</div>';

    return '<section class="card rkd-card' + anim('anim-in', 120) + '" id="leden" aria-labelledby="rkd-h-leden">' +
      cardHead('rkd-h-leden', 'Leden', list.length + ' leden · ' + (mgr ? (mgr.me ? 'jij bent beheerder' : esc(mgr.who) + ' is beheerder') : '')) +
      (a.readOnly ? kit.readOnlyNote(a) : '') +
      '<ul class="rkd-members">' + list.map(memberRow).join('') + '</ul>' +
      '<p class="rkd-help"><strong>Lezen</strong>: alleen bekijken. <strong>Bewerken</strong>: ook categoriseren, splitsen en notities, en de terugkerende posten, budgetten en regels van deze rekening beheren. ' +
        (isMgr ? 'Alleen jij als beheerder past de rechten aan.' : 'Alleen de beheerder past de rechten aan.') + '</p>' +
      '<p class="rkd-join">' + icon('userPlus', 16, 2.2) + '<span>Een mede-houder sluit aan door deze rekening zelf bij ' + esc(a.source) + ' te koppelen. Uitnodigen is niet nodig.</span></p>' +
      (need
        ? '<div class="rkd-sub" id="bijdrage">' +
            '<h3 class="rkd-sub-title">Bijdrage per maand</h3>' +
            '<div class="rkd-need">' +
              '<span class="rkd-need-label">Nodig per maand</span><span class="mono rkd-need-amount">' + eur(needCents) + '</span>' +
              '<span class="rkd-need-sub">Verwachte gedeelde uitgaven ' + eur(need.expenses) + ' − andere inkomsten ' + eur(need.otherIncome) + '. Ter info, uit de planning.</span>' +
            '</div>' +
            '<ul class="rkd-shares">' + list.map(shareRow).join('') + '</ul>' +
            '<div class="rkd-share-total' + (ok ? '' : ' rkd-share-total--bad') + '" data-share-total role="status">' + shareTotal(total) + '</div>' +
            (isMgr
              ? '<div class="rkd-share-actions">' +
                  '<button type="button" class="btn btn--ghost" data-action="share-equal" data-key="share-equal"' + disabled + '>Gelijk verdelen</button>' +
                  '<button type="button" class="btn btn--primary" data-action="share-save" data-key="share-save"' + (ok && !off() ? '' : ' disabled') + '>Verdeling opslaan</button>' +
                '</div>' + offlineNote('Opslaan')
              : '<p class="rkd-help">Alleen de beheerder past de verdeling aan. Standaard delen alle leden gelijk.</p>') +
          '</div>'
        : '') +
      leave +
    '</section>';
  }

  function shareTotal(total) {
    return total === 100
      ? icon('check', 14, 2.6) + '<span>Samen 100 %</span>'
      : icon('warning', 14, 2.2) + '<span>Samen ' + total + ' % · moet 100 % zijn</span>';
  }

  // ---------- Instellen ----------

  const formCtl = {
    values: () => kit.values(a, draft),
    patch: (o) => { draft = Object.assign({}, draft, o); },
    repaint: (key) => {
      repaintForm();
      const el = key && page.querySelector('[data-form] [data-key="' + key + '"]');
      if (el && document.activeElement !== el) el.focus();
    }
  };

  function formInner() {
    const d = kit.values(a, draft);
    const ro = a.readOnly;
    const dirty = Object.keys(draft).length > 0;
    return (ro ? kit.readOnlyNote(a) : '') +
      kit.formHtml('dt', a, d, { readOnly: ro, withIban: a.manual }) +
      (ro ? '' : '<div class="rk-actions">' +
        '<button type="button" class="rk-btn rk-btn--ghost" data-action="reset" data-key="reset"' + (dirty ? '' : ' disabled') + '>Herstellen</button>' +
        '<button type="button" class="rk-btn rk-btn--primary" data-action="save" data-key="save"' + (off() ? ' disabled' : '') + '>Opslaan</button>' +
      '</div>' + offlineNote('Opslaan'));
  }

  function settingsCard() {
    return '<section class="card rkd-card' + anim('anim-in', 90) + '" id="instellen" aria-labelledby="rkd-h-set">' +
      cardHead('rkd-h-set', 'Instellen', a.shared ? 'Naam, kleur en buffer gelden voor alle leden' : 'Naam, kleur' + (a.hasBuffer ? ' en buffer' : '') + (a.manual ? ' en IBAN' : '')) +
      '<div class="rk-editor" data-form>' + formInner() + '</div>' +
    '</section>';
  }

  function repaintForm() {
    const host = page.querySelector('[data-form]');
    if (!host) return;
    const act = document.activeElement;
    const key = act && host.contains(act) && act.dataset ? act.dataset.key : null;
    host.innerHTML = formInner();
    if (key) {
      const el = host.querySelector('[data-key="' + key + '"]');
      if (el) el.focus();
    }
  }

  function manualDeleteCard() {
    return '<section class="card rkd-card' + anim('anim-in', 110) + '" aria-labelledby="rkd-h-del">' +
      cardHead('rkd-h-del', 'Rekening verwijderen') +
      '<p class="rkd-help">De rekening en haar saldogeschiedenis worden gewist. Overschrijvingen ernaar tellen daarna niet meer als gespaard.</p>' +
      '<button type="button" class="btn btn--danger btn--block" data-action="delete-manual" data-key="delete-manual" aria-haspopup="dialog">' + icon('trash', 18, 2.2) + 'Rekening verwijderen</button>' +
    '</section>';
  }

  // ---------- Dialogs: remove my link, leave, delete for everyone, delete a manual account ----------

  function dialogHtml() {
    const k = dialog.kind;
    const close = '<button type="button" class="rk-close" aria-label="Sluiten" data-action="dlg-close" data-key="dlg-close">' + icon('close', 18, 2.4) + '</button>';
    const head = (title, ic) => '<div class="rkd-dlg-head"><span class="rkd-dlg-icon">' + icon(ic, 20, 2.2) + '</span><h2 class="rkd-dlg-title" id="rkd-dlg-title">' + esc(title) + '</h2>' + close + '</div>';
    const actions = (label, enabled) => '<div class="rk-actions">' +
      '<button type="button" class="rk-btn rk-btn--ghost" data-action="dlg-close" data-key="dlg-cancel">Annuleren</button>' +
      '<button type="button" class="rk-btn rkd-btn--neg" data-action="dlg-confirm" data-key="dlg-confirm"' + (enabled && !off() ? '' : ' disabled') + '>' + esc(label) + '</button>' +
    '</div>' + offlineNote('Dit');
    const others = kit.names(kit.others(a.id).map((m) => m.who));

    if (k === 'unlink') {
      const s = kit.sync(a.id);
      const mine = s.sources.find((x) => x.mine);
      const conn = D.connections.find((c) => c.id === mine.id);
      const alsoFor = conn.accounts.filter((id) => id !== a.id).map((id) => kit.account(id).name);
      const rest = s.sources.filter((x) => !x.mine);
      const canDelete = !a.shared;
      const opt = (v, title, sub, dis) => '<button type="button" class="rk-kind" role="radio" aria-checked="' + (dialog.choice === v) + '" tabindex="' + (dialog.choice === v ? 0 : -1) + '"' +
        ' data-action="dlg-choice" data-choice="' + v + '" data-key="choice-' + v + '"' + (dis ? ' disabled' : '') + '>' +
        '<span class="rk-kind-dot" aria-hidden="true"></span><span class="rk-kind-main"><span class="rk-kind-title">' + title + '</span><span class="rk-kind-sub">' + esc(sub) + '</span></span></button>';
      return head('Jouw koppeling voor ' + a.name + ' verwijderen?', 'link') +
        '<p class="rkd-dlg-text">Saldo leest ' + esc(a.name) + ' dan niet meer via jouw ' + esc(mine.bank) + '-koppeling.' +
          (alsoFor.length ? ' Voor ' + esc(kit.names(alsoFor)) + ' blijft je koppeling werken.' : '') +
          (rest.length ? ' De koppeling van ' + esc(rest[0].owner) + ' wordt de primaire bron, dus de rekening blijft bijgewerkt.' : '') + '</p>' +
        '<div class="rk-field"><span class="rk-label" id="rkd-dlg-hist">Geschiedenis van deze rekening</span>' +
          '<div class="rk-kinds" role="radiogroup" aria-labelledby="rkd-dlg-hist">' +
            opt('keep', 'Geschiedenis bewaren', rest.length ? 'Transacties en saldi blijven, en de rekening blijft bijgewerkt via ' + rest[0].owner + '.'
              : 'Transacties en saldi blijven, maar de rekening wordt niet meer bijgewerkt. Je kan ze later opnieuw koppelen.') +
            opt('delete', 'Geschiedenis verwijderen', canDelete ? 'De rekening, haar transacties en saldi worden gewist.'
              : 'Kan niet bij een gedeelde rekening: de geschiedenis hoort bij de rekening en ' + others + ' ziet ze nog.', !canDelete) +
          '</div></div>' +
        actions('Koppeling verwijderen', true);
    }
    if (k === 'leave') {
      const list = kit.members(a.id);
      const me = list.find((m) => m.me);
      const next = list.filter((m) => !m.me).sort((x, y) => kit.dateKey(x.since) - kit.dateKey(y.since))[0];
      const s = kit.sync(a.id);
      const items = ['Je ziet deze rekening, haar transacties en planning niet meer. ' + others + ' houdt alles.'];
      if (me && me.role === 'manager' && next) items.push(next.who + ' wordt beheerder: het langst aangesloten lid.');
      if (s && s.sources.some((x) => x.mine)) items.push('Jouw koppeling synchroniseert deze rekening niet meer.');
      items.push('Wil je later terug, koppel de rekening dan opnieuw bij ' + a.source + '.');
      return head(a.name + ' verlaten?', 'logout') +
        '<ul class="rkd-dlg-list">' + items.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' +
        actions('Rekening verlaten', true);
    }
    if (k === 'delete-all') {
      const match = dialog.confirm.trim() === a.name;
      return head(a.name + ' voor iedereen verwijderen?', 'trash') +
        '<div class="rkd-dlg-warn">' + icon('warning', 18, 2.2) + '<span>Alle transacties, saldi, regels, budgetten en de planning van deze rekening worden gewist, ook voor ' + esc(others) + '. Dit kan je niet ongedaan maken.</span></div>' +
        '<p class="rkd-dlg-text">' + esc(others) + ' krijgt een e-mail dat de rekening verwijderd is. De koppelingen bij ' + esc(a.source) + ' blijven bestaan voor jullie andere rekeningen.</p>' +
        '<div class="rk-field rk-field--tight">' +
          '<label class="rk-label" for="rkd-dlg-confirm">Typ <span class="rkd-dlg-name">' + esc(a.name) + '</span> om te bevestigen</label>' +
          '<input class="input" id="rkd-dlg-confirm" autocomplete="off" spellcheck="false" value="' + esc(dialog.confirm) + '" data-input="dlg-confirm" data-key="dlg-input">' +
        '</div>' +
        actions('Voor iedereen verwijderen', match);
    }
    // delete-manual
    const n = updatesOf(a).length;
    return head(a.name + ' verwijderen?', 'trash') +
      '<p class="rkd-dlg-text">De rekening en haar saldogeschiedenis (' + n + ' updates) worden gewist.' +
        (a.iban ? ' Overschrijvingen naar ' + esc(mask(a.iban)) + ' tellen daarna niet meer als gespaard.' : '') + '</p>' +
      actions('Rekening verwijderen', true);
  }

  function openDialog(kind, from) {
    closeDialog(true);
    dialog = { kind, choice: 'keep', confirm: '' };
    returnFocus = from || null;
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop rkd-backdrop';
    wrap.innerHTML = '<div class="sheet rk-sheet rkd-dialog" role="dialog" aria-modal="true" aria-labelledby="rkd-dlg-title"></div>';
    document.body.appendChild(wrap);
    const sheet = wrap.querySelector('.rkd-dialog');
    sheet.addEventListener('click', onDialogClick);
    sheet.addEventListener('input', onDialogInput);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeDialog(); });
    paintDialog();
    const first = sheet.querySelector('#rkd-dlg-confirm') || sheet.querySelector('[data-key="dlg-cancel"]');
    if (first) first.focus();
  }

  function paintDialog() {
    const sheet = document.querySelector('.rkd-dialog');
    if (!sheet || !dialog) return;
    const act = document.activeElement;
    const key = act && sheet.contains(act) && act.dataset ? act.dataset.key : null;
    sheet.innerHTML = '<div class="sheet-grip" aria-hidden="true"></div>' + dialogHtml();
    if (key) {
      const el = sheet.querySelector('[data-key="' + key + '"]');
      if (el) el.focus();
    }
  }

  function closeDialog(silent) {
    const wrap = document.querySelector('.rkd-backdrop');
    if (wrap) wrap.remove();
    if (!dialog) return;
    dialog = null;
    if (HASH_DIALOGS.indexOf(location.hash.slice(1)) >= 0) history.replaceState(null, '', location.pathname + location.search);
    if (!silent && returnFocus) {
      const el = page.querySelector('[data-key="' + returnFocus + '"]');
      if (el) el.focus();
    }
  }

  function onDialogClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const act = el.dataset.action;
    if (act === 'dlg-close') closeDialog();
    else if (act === 'dlg-choice') { dialog.choice = el.dataset.choice; paintDialog(); }
    else if (act === 'dlg-confirm') {
      const k = dialog.kind;
      const msg = {
        unlink: 'Koppeling verwijderd · geschiedenis ' + (dialog.choice === 'keep' ? 'bewaard' : 'verwijderd') + ' (mockup)',
        leave: 'Je hebt ' + a.name + ' verlaten (mockup)',
        'delete-all': a.name + ' is voor iedereen verwijderd (mockup)',
        'delete-manual': a.name + ' is verwijderd (mockup)'
      }[k];
      closeDialog();
      S.shell.toast(msg);
    }
  }

  function onDialogInput(e) {
    if (e.target.dataset.input !== 'dlg-confirm') return;
    dialog.confirm = e.target.value;
    const btn = document.querySelector('.rkd-dialog [data-key="dlg-confirm"]');
    if (btn) btn.disabled = off() || dialog.confirm.trim() !== a.name;
  }

  // ---------- Empty and not found ----------

  function missing(empty) {
    return top() +
      '<section class="card rkd-missing' + anim('anim-in', 30) + '" aria-labelledby="rkd-missing-title">' +
        '<span class="rk-empty-icon" aria-hidden="true">' + icon('card', 28, 2) + '</span>' +
        '<h1 class="rk-empty-title" id="rkd-missing-title">' + (empty ? 'Nog geen rekeningen' : 'Deze rekening bestaat niet (meer)') + '</h1>' +
        '<p class="rk-empty-text">' + (empty
          ? 'Koppel je zichtrekening bij de bank of voeg een handmatige rekening toe. Daarna zie je hier haar saldo, geschiedenis en instellingen.'
          : 'Misschien heeft de beheerder ze verwijderd, of heb je de rekening verlaten.') + '</p>' +
        '<div class="rk-empty-actions">' +
          (empty
            ? '<a class="btn btn--primary" href="bankkoppelingen.html#nieuw">' + icon('bank', 18, 2.2) + 'Bankrekening koppelen</a>' +
              '<a class="btn btn--ghost" href="rekeningen.html#handmatig">' + icon('edit', 18, 2.2) + 'Handmatige rekening</a>'
            : '<a class="btn btn--primary" href="rekeningen.html">Naar Rekeningen</a>') +
        '</div>' +
      '</section>';
  }

  // ---------- Painting ----------

  function paint() {
    const q = new URLSearchParams(location.search);
    const id = q.get('id') || 'zicht';
    a = D.demo() === 'leeg' ? null : kit.account(id);
    if (!a) {
      document.title = 'Rekening · Saldo';
      page.innerHTML = missing(D.demo() === 'leeg');
      painted = true;
      return;
    }
    document.title = a.name + ' · Saldo';
    hist = buildHistory();
    if (hist && (sel < 0 || sel >= hist.days.length)) sel = hist.days.length - 1;

    const main = historyCard() + (a.manual ? updateCard() : '') + txCard() + (a.shared ? ledenCard() : '');
    const side = (a.manual ? '' : syncCard()) + settingsCard() + (a.manual ? manualDeleteCard() : '');
    page.innerHTML = top() +
      '<div class="rkd-layout" style="--acc:' + kit.acc(a.color) + '">' +
        '<div class="rkd-head">' + hero() + syncAlert() + '</div>' +
        '<div class="rkd-col rkd-col--main">' + main + '</div>' +
        '<div class="rkd-col rkd-col--side">' + side + '</div>' +
      '</div>';
    painted = true;
    drawChart();
  }

  function repaint() {
    const act = document.activeElement;
    const key = act && page.contains(act) && act.dataset ? act.dataset.key : null;
    paint();
    if (key) {
      const el = page.querySelector('[data-key="' + key + '"]');
      if (el) el.focus();
    }
  }

  // ---------- Actions ----------

  function save() {
    if (off()) { S.shell.toast('Je bent offline'); return; }
    if (a.readOnly) return;
    const d = kit.values(a, draft);
    const patch = { color: d.color, name: (d.name || '').trim() || a.name };
    if (a.hasBuffer) patch.buffer = d.buffer;
    if (a.manual) patch.iban = (d.iban || '').trim();
    kit.saveEdits(a.id, patch);
    draft = {};
    repaint();
    S.shell.toast(patch.name + ' opgeslagen');
  }

  function saveUpdate() {
    if (off()) { S.shell.toast('Je bent offline'); return; }
    const u = upd || { amount: '', date: today(), err: {} };
    const err = {};
    const v = kit.parseMoney(u.amount);
    if (!u.amount.trim() || isNaN(v)) err.amount = 'Vul het saldo in, bijvoorbeeld 12.900,00.';
    if (!u.date || u.date > today()) err.date = 'Kies vandaag of een dag in het verleden.';
    upd = Object.assign({}, u, { err });
    if (Object.keys(err).length) {
      repaint();
      const first = page.querySelector('#bijwerken .rk-input--err');
      if (first) first.focus();
      return;
    }
    const list = updatesOf(a).filter((x) => x.date !== u.date).concat([{ date: u.date, v }])
      .sort((x, y) => (x.date < y.date ? -1 : 1));
    const latest = list[list.length - 1];
    kit.saveEdits(a.id, { updates: list.map((x) => [x.date, x.v]), balance: latest.v, updated: dateShort(latest.date) });
    upd = null;
    sel = -1;
    repaint();
    S.shell.toast('Saldo bijgewerkt · ' + eur(v));
  }

  function doSync() {
    if (off()) { S.shell.toast('Je bent offline'); return; }
    if (syncing) return;
    if (synced) { S.shell.toast('Net gesynchroniseerd. Probeer het over 15 minuten opnieuw.'); return; }
    syncing = true;
    S.shell.progress(true);
    repaint();
    setTimeout(() => {
      syncing = false;
      S.shell.progress(false);
      const s = kit.sync(a.id);
      if (s.tone === 'neg') S.shell.toast(s.bank + ' antwoordt nog niet. Saldo probeert het vannacht opnieuw.');
      else if (s.tone === 'warn') S.shell.toast(s.bank + ' stuurde nog geen nieuwe gegevens');
      else { synced = true; S.shell.toast('Bijgewerkt · geen nieuwe transacties'); }
      repaint();
    }, 1600);
  }

  function goto(target, focusId, instant) {
    const el = page.querySelector('#' + target);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: instant || reduce ? 'auto' : 'smooth', block: 'start' });
    const f = focusId ? page.querySelector('#' + focusId) : null;
    if (f && !f.disabled) f.focus({ preventScroll: true });
  }

  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.getAttribute('aria-disabled') === 'true') { S.shell.toast('Je bent offline'); return; }
    if (el.disabled) return;
    if (el.closest('[data-form]') && kit.formClick(el, formCtl)) return;
    const act = el.dataset.action;
    if (act === 'goto') { e.preventDefault(); goto(el.dataset.target, el.dataset.focus); }
    else if (act === 'reset') { draft = {}; repaintForm(); }
    else if (act === 'save') save();
    else if (act === 'sync') doSync();
    else if (act === 'reauth' && off()) { e.preventDefault(); S.shell.toast('Je bent offline'); }
    else if (act === 'unlink' || act === 'leave' || act === 'delete-all' || act === 'delete-manual') openDialog(act, el.dataset.key);
    else if (act === 'use-hint') {
      upd = Object.assign({ date: today(), err: {} }, upd || {}, { amount: kit.inputMoney(+el.dataset.amount), err: {} });
      repaint();
      const inp = page.querySelector('#rkd-upd-amount');
      if (inp) inp.focus();
    } else if (act === 'upd-save') saveUpdate();
    else if (act === 'perm') {
      if (off()) return;
      const perms = Object.assign({}, (kit.loadEdits()[a.id] || {}).perms || {});
      if (perms[el.dataset.who] === el.dataset.perm) return;
      const m = kit.members(a.id).find((x) => x.who === el.dataset.who);
      if (m && m.perm === el.dataset.perm) return;
      perms[el.dataset.who] = el.dataset.perm;
      kit.saveEdits(a.id, { perms });
      repaint();
      S.shell.toast(el.dataset.who + (el.dataset.perm === 'read' ? ' mag nu alleen lezen' : ' mag nu bewerken'));
    } else if (act === 'share-equal') {
      const list = kit.members(a.id);
      const each = Math.floor(100 / list.length);
      split = {};
      list.forEach((m, i) => { split[m.who] = String(i === 0 ? 100 - each * (list.length - 1) : each); });
      repaint();
    } else if (act === 'share-save') {
      const list = kit.members(a.id);
      const vals = shareValues(list);
      const out = {};
      list.forEach((m) => { out[m.who] = parseInt(vals[m.who], 10) || 0; });
      kit.saveEdits(a.id, { split: out });
      split = null;
      repaint();
      S.shell.toast('Verdeling opgeslagen');
    }
  }

  function onInput(e) {
    const el = e.target;
    if (el.closest('[data-form]')) {
      kit.formInput(el, formCtl);
      const reset = page.querySelector('[data-form] [data-action="reset"]');
      if (reset) reset.disabled = Object.keys(draft).length === 0;
      return;
    }
    const k = el.dataset.input;
    if (k === 'upd-amount' || k === 'upd-date') {
      upd = Object.assign({ amount: '', date: today(), err: {} }, upd || {});
      if (k === 'upd-amount') upd.amount = el.value; else upd.date = el.value;
    } else if (k === 'share') {
      split = Object.assign({}, split || {}, { [el.dataset.who]: el.value.replace(/[^\d]/g, '') });
      // Live amounts and total without re-rendering, so the caret stays put
      const list = kit.members(a.id);
      const vals = shareValues(list);
      const need = NEED[a.id];
      const needCents = need.expenses - need.otherIncome;
      let total = 0;
      list.forEach((m) => {
        const pct = parseInt(vals[m.who], 10) || 0;
        total += pct;
        const out = page.querySelector('[data-share-amount="' + m.who + '"]');
        if (out) out.textContent = eur(Math.round(needCents * pct / 100));
      });
      const tot = page.querySelector('[data-share-total]');
      tot.innerHTML = shareTotal(total);
      tot.classList.toggle('rkd-share-total--bad', total !== 100);
      const btn = page.querySelector('[data-action="share-save"]');
      if (btn) btn.disabled = total !== 100 || off();
    }
  }

  function onKey(e) {
    if (e.target.closest && e.target.closest('[data-form]')) { kit.formKey(e, formCtl); return; }
    const plot = e.target.closest && e.target.closest('[data-plot]');
    if (plot) {
      const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 7, PageDown: -7 }[e.key];
      if (step) { e.preventDefault(); select(sel + step); } else if (e.key === 'Home') { e.preventDefault(); select(0); } else if (e.key === 'End') { e.preventDefault(); select(hist.days.length - 1); }
    }
  }

  let dragging = false;
  function onPointer(e) {
    const plot = e.target.closest && e.target.closest('[data-plot]');
    if (e.type === 'pointerup' || e.type === 'pointercancel') { dragging = false; return; }
    if (!plot || !hist) return;
    if (e.type === 'pointerdown') { dragging = true; plot.setPointerCapture(e.pointerId); }
    if (e.type === 'pointerdown' || dragging || e.pointerType === 'mouse') select(pointAt(e));
  }

  // Deep links (mockup): #instellen, #synchronisatie, #leden, #bijwerken, #transacties, #saldoverloop scroll to a
  // section; #koppeling-verwijderen, #verlaten, #verwijderen open a dialog.
  function openFromHash() {
    const h = location.hash.slice(1);
    if (!a || !h) return;
    if (HASH_SECTIONS.indexOf(h) >= 0) { goto(h, null, true); return; }
    if (h === 'koppeling-verwijderen' && !a.manual) openDialog('unlink');
    else if (h === 'verlaten' && a.shared) openDialog('leave');
    else if (h === 'verwijderen') {
      if (a.manual) openDialog('delete-manual');
      else if (a.shared) { const m = kit.manager(a.id); if (m && m.me) openDialog('delete-all'); }
      else openDialog('unlink');
    }
  }

  // ---------- Screen ----------

  function render(p) {
    page = p;
    paint();
    if (!page.dataset.rkdWired) {
      page.dataset.rkdWired = '1';
      page.addEventListener('click', onClick);
      page.addEventListener('input', onInput);
      page.addEventListener('keydown', onKey);
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((t) => page.addEventListener(t, onPointer));
      let raf = 0;
      window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawChart); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialog) closeDialog(); });
      // Fonts change the layout width a little after the first paint
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawChart);
      requestAnimationFrame(() => { drawChart(); openFromHash(); });
    }
  }

  S.screens = S.screens || {};
  S.screens.rekening = { title: 'Rekening', render };
})(window.Saldo = window.Saldo || {});
