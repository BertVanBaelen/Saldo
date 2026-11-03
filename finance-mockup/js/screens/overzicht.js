// Overzicht screen (past months). Design boards: Telefoon-Overzicht, Desktop-Overzicht.
// Spec: analysis/screens/overzicht.md, analysis/concepts/period-overview.md.
(function (S) {
  'use strict';

  const { eur, esc, cap } = S.fmt;
  const D = S.data;

  // ---------- Demo data (from the boards' renderVals) ----------

  // Per month, scope Alles: [title, short, key, income, saved, expenses per category in CATS order].
  // Internal transfers are left out; the € 200 to savings shows as "Gespaard" (analysis/concepts/internal-transfer.md).
  const MONTHS = [
    ['november 2025', 'nov', '2025-11', 330000, 20000, [115000, 70200, 38800, 29100, 5497, 40200]],
    ['december 2025', 'dec', '2025-12', 330000, 20000, [115000, 81200, 52000, 27600, 5497, 61000]],
    ['januari 2026', 'jan', '2026-01', 330000, 20000, [115000, 59800, 24000, 26200, 5497, 101200]],
    ['februari 2026', 'feb', '2026-02', 330000, 20000, [115000, 61100, 28600, 27000, 5497, 33000]],
    ['maart 2026', 'mrt', '2026-03', 330000, 20000, [115000, 64000, 31200, 28800, 5497, 35600]],
    ['april 2026', 'apr', '2026-04', 330000, 20000, [115000, 62200, 36400, 30100, 5497, 34100]],
    ['mei 2026', 'mei', '2026-05', 330000, 20000, [115000, 63000, 34200, 27600, 5497, 39200]],
    ['juni 2026', 'jun', '2026-06', 330000, 20000, [115000, 66500, 41000, 29000, 5497, 41000]],
    ['juli 2026', 'jul', '2026-07', 330000, 0, [115000, 71200, 98400, 40200, 5497, 33700]],
    ['augustus 2026', 'aug', '2026-08', 330000, 40000, [115000, 60100, 29600, 24800, 5497, 36000]],
    ['september 2026', 'sep', '2026-09', 330000, 20000, [115000, 68800, 35200, 30100, 5497, 34400]],
    ['oktober 2026', 'okt', '2026-10', 335000, 20000, [115000, 64200, 31800, 28400, 5497, 31100]]
  ];
  const CATS = ['Wonen', 'Boodschappen', 'Vrije tijd', 'Vervoer', 'Abonnementen', 'Overig'];
  const TO_SHARED = 'Naar gedeelde rekening';
  const CONTRIBUTION = 45000;

  // Periods: maand shows mei–okt (april only feeds the trend), kwartaal K1–K3 2026, jaar 2025 and 2026.
  const PERIODS = {
    maand: {
      label: 'Maand', range: 'mei – oktober 2026', compare: 'vorige maand', first: 1,
      groups: [5, 6, 7, 8, 9, 10, 11].map((i) => ({ idx: [i], title: MONTHS[i][0], short: MONTHS[i][1], key: MONTHS[i][2] }))
    },
    kwartaal: {
      label: 'Kwartaal', range: '2026 per kwartaal', compare: 'vorig kwartaal', first: 0,
      groups: [
        { idx: [2, 3, 4], title: 'K1 2026', short: 'K1', key: '2026-K1' },
        { idx: [5, 6, 7], title: 'K2 2026', short: 'K2', key: '2026-K2' },
        { idx: [8, 9, 10], title: 'K3 2026', short: 'K3', key: '2026-K3' }
      ]
    },
    jaar: {
      label: 'Jaar', range: 'per jaar, sinds november 2025', compare: '', first: 0,
      groups: [
        { idx: [0, 1], title: '2025 · vanaf november', short: '2025', key: '2025' },
        { idx: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], title: '2026 · tot oktober', short: '2026', key: '2026' }
      ]
    },
    eigen: { label: 'Eigen' }
  };

  const SCOPE_TEXT = { alles: 'Al mijn rekeningen', persoonlijk: 'Persoonlijke rekeningen', gedeeld: 'Gedeelde rekening' };
  const SKELETON = [[120, 220], [90, 170], [140, 250], [100, 190], [130, 230], [110, 200]];

  // ---------- Screen state ----------

  const ui = { period: 'maand', sel: null, swapping: false, scope: null };
  let swapTimer = null;

  // ---------- Model ----------

  function catsFor(scope) {
    return scope === 'persoonlijk' ? CATS.concat(TO_SHARED) : CATS;
  }

  // One month split per scope (analysis/concepts/account-group.md, internal-transfer.md)
  function split(row, scope) {
    const c = row[5];
    if (scope === 'gedeeld') return { inc: 2 * CONTRIBUTION, sav: 0, cats: [14500, c[1], 0, 0, 4298, 6202] };
    if (scope === 'persoonlijk') return { inc: row[3] - CONTRIBUTION, sav: row[4], cats: [100500, 0, c[2], c[3], 1199, c[5] - 6202, CONTRIBUTION] };
    return { inc: row[3], sav: row[4], cats: c };
  }

  function aggregate(g, scope) {
    const cats = catsFor(scope).map(() => 0);
    let inc = 0, sav = 0;
    g.idx.forEach((i) => {
      const s = split(MONTHS[i], scope);
      inc += s.inc; sav += s.sav;
      s.cats.forEach((v, k) => { cats[k] += v; });
    });
    return Object.assign({}, g, { inc, sav, cats, exp: cats.reduce((a, b) => a + b, 0) });
  }

  function model(scope) {
    const p = PERIODS[ui.period];
    const groups = p.groups.map((g) => aggregate(g, scope));
    const view = groups.slice(p.first);
    const sel = ui.sel !== null && ui.sel < view.length ? ui.sel : view.length - 1;
    const cur = view[sel];
    const prev = p.compare ? (groups[sel + p.first - 1] || null) : null;
    const max = Math.max.apply(null, view.map((g) => Math.max(g.inc, g.exp, g.sav)));
    return { p, view, sel, cur, prev, max, scope };
  }

  function trend(v, pv) {
    const d = pv ? Math.round((v - pv) / pv * 100) : 0;
    return {
      text: d === 0 ? '= 0%' : (d > 0 ? '+' + d + '%' : S.fmt.MINUS + Math.abs(d) + '%'),
      color: d > 5 ? 'var(--warn)' : (d < -5 ? 'var(--greenText)' : 'var(--muted)')
    };
  }

  function catRows(m) {
    const names = catsFor(m.scope);
    return names.map((name, k) => {
      const v = m.cur.cats[k];
      const pct = Math.round(v / m.cur.exp * 100);
      return {
        name, v, pct,
        color: name === TO_SHARED ? 'var(--shared)' : D.categories[name],
        trend: m.prev ? trend(v, m.prev.cats[k]) : null
      };
    }).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
  }

  // ---------- Pieces ----------

  function header(m) {
    return '<div class="page-head ov-head anim-fade">' +
      '<div class="page-head-title"><h1>Overzicht</h1>' +
        '<span class="page-date only-desktop" data-ov="range">' + esc(SCOPE_TEXT[m.scope] + ' · ' + m.p.range) + '</span></div>' +
      S.shell.scopeSwitch('anim-in') +
      '<div class="ov-period anim-in" style="--d:30ms" role="group" aria-label="Periode">' +
        Object.keys(PERIODS).map((k) => '<button type="button" class="ov-period-btn" data-period="' + k + '" aria-pressed="' + (k === ui.period) + '">' + esc(PERIODS[k].label) + '</button>').join('') +
      '</div>' +
      '<div class="page-head-actions only-phone">' +
        '<a class="avatar" href="meer.html" aria-label="Profiel en meer" style="background:' + D.user.tint + '">' + esc(D.user.initial) + '</a>' +
      '</div>' +
    '</div>';
  }

  const LEGEND = [['inc', 'Inkomen'], ['exp', 'Uitgaven'], ['sav', 'Gespaard']];

  function chartCard(m) {
    return '<section class="card ov-chart-card anim-in" style="--d:60ms">' +
      '<div class="ov-chart-head">' +
        '<h2 class="ov-chart-title"><span class="only-phone" data-ov="range-title">' + esc(cap(m.p.range)) + '</span><span class="only-desktop">Inkomen, uitgaven en gespaard</span></h2>' +
        '<div class="ov-legend">' + LEGEND.map((l) => '<span><i class="ov-key--' + l[0] + '"></i>' + l[1] + '</span>').join('') + '</div>' +
      '</div>' +
      '<div data-ov="chart">' + chartBody(m) + '</div>' +
    '</section>';
  }

  function chartBody(m) {
    if (ui.swapping) {
      return '<div class="ov-skel" role="status" aria-label="Laden">' +
        SKELETON.map((h) => '<span style="--hp:' + h[0] + 'px;--hd:' + h[1] + 'px"></span>').join('') + '</div>';
    }
    const size = m.view.length > 4 ? 's' : (m.view.length > 2 ? 'm' : 'l');
    return '<div class="ov-chart ov-chart--' + size + '" role="group" aria-label="Inkomen, uitgaven en gespaard per periode">' +
      m.view.map((g, i) => {
        const aria = g.title + ': inkomen ' + eur(g.inc) + ', uitgaven ' + eur(g.exp) + ', gespaard ' + eur(g.sav);
        const bars = [['inc', g.inc, 60], ['exp', g.exp, 90], ['sav', g.sav, 120]];
        return '<button type="button" class="ov-col" data-sel="' + i + '" aria-pressed="' + (i === m.sel) + '" aria-label="' + esc(aria) + '">' +
          '<span class="ov-bars">' + bars.map((b) =>
            '<span class="ov-bar ov-key--' + b[0] + '" style="--h:' + (b[1] / m.max).toFixed(4) + ';--d:' + (b[2] + i * 40) + 'ms"></span>').join('') +
          '</span>' +
          '<span class="ov-col-label">' + esc(g.short) + '</span>' +
        '</button>';
      }).join('') +
    '</div>';
  }

  function sums(m) {
    const tile = (label, v) => '<div class="ov-sum"><span class="ov-sum-label">' + label +
      '<span class="only-desktop"> · ' + esc(m.cur.short) + '</span></span><span class="ov-sum-value mono">' + eur(v) + '</span></div>';
    return tile('Inkomen', m.cur.inc) + tile('Uitgaven', m.cur.exp) + tile('Gespaard', m.cur.sav);
  }

  // Category breakdown: share, trend against the previous period, drill-down to Transacties
  function cats(m, oldWidths) {
    const compare = m.prev ? 't.o.v. ' + m.p.compare : '';
    const rows = catRows(m);
    return '<div class="ov-cats-head">' +
        '<h2 class="section-title">Per categorie · ' + esc(m.cur.title) + '</h2>' +
        '<span class="ov-compare">' + esc(compare) + '</span>' +
      '</div>' +
      '<div class="ov-cat-list">' + rows.map((r) => {
        const href = 'transacties.html?categorie=' + encodeURIComponent(r.name) + '&periode=' + encodeURIComponent(m.cur.key) + '&scope=' + m.scope;
        const from = oldWidths && oldWidths[r.name] !== undefined ? oldWidths[r.name] : r.pct;
        return '<a class="ov-cat" href="' + href + '">' +
          '<span class="ov-cat-line">' +
            '<i class="ov-cat-dot" style="background:' + r.color + '"></i>' +
            '<span class="ov-cat-name">' + esc(r.name) + ' <span class="muted">' + r.pct + '%</span></span>' +
            (r.trend ? '<span class="ov-cat-trend" style="color:' + r.trend.color + '"><span class="visually-hidden">' + esc(compare) + ' </span>' + r.trend.text + '</span>' : '') +
            '<span class="ov-cat-amount mono">' + eur(r.v) + '</span>' +
          '</span>' +
          '<span class="ov-cat-track"><span class="ov-cat-fill" data-name="' + esc(r.name) + '" data-w="' + r.pct + '" style="width:' + from + '%;background:' + r.color + '"></span></span>' +
        '</a>';
      }).join('') + '</div>';
  }

  // ---------- Screen ----------

  let page = null;

  function render(el, st) {
    page = el;
    if (ui.scope !== null && ui.scope !== st.scope) {
      ui.sel = null;
      startSwap();
    }
    ui.scope = st.scope;
    const m = model(st.scope);
    page.innerHTML =
      header(m) +
      '<div class="ov-grid">' +
        '<div class="ov-left">' +
          chartCard(m) +
          '<section class="ov-sums anim-in" style="--d:90ms" data-ov="sums">' + sums(m) + '</section>' +
        '</div>' +
        '<section class="ov-cats anim-in" style="--d:120ms" data-ov="cats">' + cats(m) + '</section>' +
      '</div>';
    page.onclick = onClick;
  }

  // Partial updates keep focus, skip the entry animations and let the share bars move (420 ms).
  function refresh(parts) {
    if (!page) return;
    const m = model(ui.scope);
    const q = (k) => page.querySelector('[data-ov="' + k + '"]');
    if (parts.period) {
      page.querySelectorAll('.ov-period-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === ui.period)));
      q('range').textContent = SCOPE_TEXT[m.scope] + ' · ' + m.p.range;
      q('range-title').textContent = cap(m.p.range);
    }
    if (parts.chart) q('chart').innerHTML = chartBody(m);
    if (parts.sel) {
      page.querySelectorAll('.ov-col').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.sel) === m.sel)));
    }
    q('sums').innerHTML = sums(m);
    const old = {};
    page.querySelectorAll('.ov-cat-fill').forEach((f) => { old[f.dataset.name] = parseFloat(f.style.width) || 0; });
    q('cats').innerHTML = cats(m, parts.period ? null : old);
    if (!parts.period) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        page.querySelectorAll('.ov-cat-fill').forEach((f) => { f.style.width = f.dataset.w + '%'; });
      }));
    }
  }

  // Loading state while a new period or scope is fetched (boards: 320 ms shimmer)
  function startSwap() {
    ui.swapping = true;
    clearTimeout(swapTimer);
    swapTimer = setTimeout(() => {
      ui.swapping = false;
      refresh({ chart: true });
    }, 320);
  }

  function onClick(e) {
    const pb = e.target.closest('.ov-period-btn');
    if (pb) {
      const p = pb.dataset.period;
      if (p === 'eigen') { S.shell.toast('Eigen periode kiezen volgt later'); return; }
      if (p === ui.period) return;
      ui.period = p;
      ui.sel = null;
      startSwap();
      refresh({ period: true, chart: true });
      return;
    }
    const col = e.target.closest('.ov-col');
    if (col) {
      const i = Number(col.dataset.sel);
      if (i === model(ui.scope).sel) return;
      ui.sel = i;
      refresh({ sel: true });
    }
  }

  S.screens = S.screens || {};
  S.screens.overzicht = { title: 'Overzicht', render };
})(window.Saldo = window.Saldo || {});
