// Planning screen. Design boards: Telefoon-Planning, Desktop-Planning. Spec: analysis/screens/planning.md.
// The calculations are ported from the boards' renderVals(): analysis/concepts/forecast.md (month chain
// and daily line), budget.md (free to spend), buffer-and-states.md (day and month states).
(function (S) {
  'use strict';

  const { eur, eur0, esc, cap, MONTHS, DAYS } = S.fmt;
  const icon = S.icon;
  const D = S.data;

  // ---------- Demo data (analysis/concepts/demo-data.md) ----------

  const PERS = D.groups.find((g) => g.key === 'pers');
  const GED = D.groups.find((g) => g.key === 'ged');

  // Per scope: buffer, balance on 1 Nov and today, variable spending (already spent / rest of November / a full
  // month), November end, monthly income, recurring costs and savings. Alles = both groups, internal transfers left out.
  const SCOPE_DATA = {
    alles: { buf: PERS.buffer + GED.buffer, nov1: 166727, today: PERS.now + GED.now, pastVar: 64740, futVar: 100260, varM: 165000, novEnd: PERS.forecast[0] + GED.forecast[0],
      inc: 330000, rec: 120497, sav: 20000, novExp: 285497, incNote: 'Salaris en bijdrage Partner', recNote: 'Huur, energie, internet, streaming',
      varNote: 'Volgens je budgetten', todayNote: 'Zichtrekening en gedeelde rekening', line: 'var(--green)' },
    persoonlijk: { buf: PERS.buffer, nov1: 102041, today: PERS.now, pastVar: 23460, futVar: 70338, varM: 93798, novEnd: PERS.forecast[0],
      inc: 285000, rec: 146699, sav: 20000, novExp: 240497, incNote: 'Salaris', recNote: 'Huur, bijdrage gedeelde rekening, Spotify',
      varNote: 'Vrije tijd, vervoer, overig', todayNote: 'Zichtrekening', line: 'var(--green)' },
    gedeeld: { buf: GED.buffer, nov1: 64686, today: GED.now, pastVar: 41280, futVar: 29922, varM: 71202, novEnd: GED.forecast[0],
      inc: 90000, rec: 18798, sav: 0, novExp: 90000, incNote: 'Bijdragen van jou en Partner', recNote: 'Energie, internet, Netflix',
      varNote: 'Boodschappen en overig', todayNote: 'Gedeelde rekening', line: 'var(--shared)' }
  };

  const ACC = {
    p: { name: 'Persoonlijk', full: 'Zichtrekening', bg: 'var(--soft)', fg: 'var(--greenText)', sel: 'var(--green)', onSel: 'var(--onGreen)' },
    g: { name: 'Gedeeld', full: 'Gedeelde rekening', bg: 'var(--sharedSoft)', fg: 'var(--sharedText)', sel: 'var(--shared)', onSel: 'var(--onShared)' }
  };
  const SUBS = [['persoonlijk', 'Persoonlijk', 'Zichtrekening', 'p'], ['gedeeld', 'Gedeelde rekening', 'met Partner', 'g']];

  // Recurring items every month: [day, cents, label, note, short tag, account, 'int' = transfer between own groups]
  const EVENTS = [
    [1, -100500, 'Huur', 'Terugkerend', 'Huur', 'p'],
    [1, -45000, 'Naar gedeelde rekening', 'Jouw bijdrage', 'Bijdrage', 'p', 'int'],
    [1, 45000, 'Jouw bijdrage', 'Van je zichtrekening', 'Bijdrage', 'g', 'int'],
    [1, 45000, 'Bijdrage Partner', 'Terugkerend', 'Partner', 'g'],
    [2, 285000, 'Salaris', 'Werkgever nv', 'Salaris', 'p'],
    [5, -14500, 'Energie', 'Terugkerend', 'Energie', 'g'],
    [8, -2899, 'Internet en tv', 'Terugkerend', 'Internet', 'g'],
    [12, -1399, 'Netflix', 'Terugkerend', 'Netflix', 'g'],
    [16, -20000, 'Naar spaarrekening', 'Gespaard', 'Sparen', 'p'],
    [17, -1199, 'Spotify', 'Terugkerend', 'Spotify', 'p']
  ];
  // Extra items per calendar month (0 = nov 2026 … 3 = feb 2027)
  const EXTRA = {
    1: [[20, -35000, 'Kerstcadeaus', 'Eenmalig', 'Kerst', 'p']],
    2: [[15, -68400, 'Familiale verzekering', 'Jaarlijks', 'Verzekering', 'p']],
    3: [[10, -200000, 'Autoherstelling', 'Eenmalig · offerte garage', 'Auto', 'p']]
  };
  const FAMILY_INSURANCE = 68400; // yearly, January, personal
  // One-offs in the month chain, key "<month 0-11>-<year>"
  const ONE_M = { '11-2026': ['Kerstcadeaus', -35000], '1-2027': ['Autoherstelling', -200000], '6-2027': ['Zomervakantie', -150000], '7-2027': ['Belastingteruggave', 68000] };

  // Category budgets: [name, colour, account, budget, spent in November]
  const CATS = [
    ['Boodschappen', 'var(--c2)', 'g', 65000, 41280],
    ['Vrije tijd', 'var(--c3)', 'p', 35000, 13820],
    ['Vervoer', 'var(--c4)', 'p', 30000, 9640],
    ['Overig', 'var(--c6)', 'p', 28798, 0],
    ['Overig gedeeld', 'var(--c6)', 'g', 6202, 0]
  ];

  // Tab "Terugkerend" (analysis/concepts/recurring-item.md)
  const SUGGESTIONS = [
    { id: 's1', name: 'Basic-Fit', rhythm: 'Maandelijks · rond de 3e · 4 keer gezien', amt: -2999, acc: 'p' },
    { id: 's2', name: 'Proximus Mobile', rhythm: 'Maandelijks · rond de 20e · 3 keer gezien', amt: -1500, acc: 'p' },
    { id: 's3', name: 'Farys water', rhythm: 'Maandelijks · rond de 22e · 3 keer gezien', amt: -3500, acc: 'g' }
  ];
  const RECURRING = [
    ['Salaris', 'Maandelijks · rond de 2e', 285000, 'p'],
    ['Bijdrage Partner', 'Maandelijks · rond de 1e', 45000, 'g'],
    ['Jouw bijdrage', 'Maandelijks · 1e · van je zichtrekening', 45000, 'g', 'int'],
    ['Naar gedeelde rekening', 'Maandelijks · 1e · jouw bijdrage', -45000, 'p', 'int'],
    ['Huur', 'Maandelijks · 1e', -100500, 'p'],
    ['Energie', 'Maandelijks · rond de 5e', -14500, 'g'],
    ['Internet en tv', 'Maandelijks · rond de 8e', -2899, 'g'],
    ['Netflix', 'Maandelijks · rond de 12e', -1399, 'g'],
    ['Spotify', 'Maandelijks · rond de 17e', -1199, 'p'],
    ['Naar spaarrekening', 'Maandelijks · 16e · gespaard', -20000, 'p'],
    ['Familiale verzekering', 'Jaarlijks · januari', -68400, 'p']
  ];

  // Tab "Eenmalig" (analysis/concepts/planned-item.md): [month, year, label, note, cents, account, chip colour]
  const MY = [['NOV', '2026', 'november'], ['DEC', '2026', 'december'], ['JAN', '2027', 'januari'], ['FEB', '2027', 'februari']];
  const ONE_OFFS = [
    ['DEC', '2026', 'Kerstcadeaus', 'Rond 20 december', -35000, 'p', 'var(--c3)'],
    ['FEB', '2027', 'Autoherstelling', '10 februari · offerte garage', -200000, 'p', 'var(--c4)'],
    ['JUL', '2027', 'Zomervakantie', 'Juli 2027', -150000, 'p', 'var(--c1)'],
    ['AUG', '2027', 'Belastingteruggave', 'Verwachte inkomst · augustus 2027', 68000, 'p', 'var(--soft)']
  ];

  const TABS = [['kalender', 'Kalender'], ['maanden', 'Maanden'], ['terugkerend', 'Terugkerend'], ['eenmalig', 'Eenmalig'], ['budget', 'Budget']];
  const HORIZONS = [3, 6, 12, 24];
  const HATCH = 'repeating-linear-gradient(135deg, var(--muted) 0 2px, transparent 2px 6px)';

  // ---------- UI state (survives a re-render by the shell) ----------

  const ui = {
    tab: 'kalender',
    month: 0,          // calendar and budget month, 0 = november 2026
    sel: {},           // selected day per month
    planned: {},       // planned items per month: { id, day, amt, label, acc }
    horizon: 3,
    loading: false,
    open: undefined,   // month card: undefined = default (feb), null = none
    done: {},          // answered suggestions: 'ja' | 'nee'
    addOpen: false,
    draft: { desc: '', amt: '', kind: 'out', acc: 'p', err: false }
  };

  const mq = window.matchMedia('(min-width: 1024px)');
  let pageEl = null;
  let scopeNow = null;
  let md = null;          // current model
  let desk = false;
  let animAll = false;    // first render or scope change
  let animPanel = false;  // tab, month or horizon change
  let fresh = {};         // one-shot animations: { form, month }
  let lastW = 0;

  const tabFromHash = () => {
    const h = (location.hash || '').slice(1);
    return TABS.some((t) => t[0] === h) ? h : null;
  };
  ui.tab = tabFromHash() || ui.tab;

  // ---------- Model (ported from the boards' model()) ----------

  function model(scope, inner) {
    const C = SCOPE_DATA[scope];
    const BUF = C.buf;
    const inScope = (acc) => scope === 'alles' || (scope === 'persoonlijk' ? acc === 'p' : acc === 'g');
    const planned = ui.planned;
    const plList = (k) => (planned[k] || []).filter((p) => inScope(p.acc));
    const plSum = (k) => plList(k).reduce((a, p) => a + p.amt, 0);
    const plIn = (k) => plList(k).filter((p) => p.amt > 0).reduce((a, p) => a + p.amt, 0);

    // Month chain: projected_end(m) = projected_end(m-1) + income - recurring - variable - saved ± one-off (forecast.md)
    const forecast = (h) => {
      const e0 = plSum(0);
      const novEnd = C.novEnd + e0;
      const l0 = [['Saldo vandaag', C.today, C.todayNote], ['Terugkerende posten', 0, 'Deze maand al ontvangen en betaald'], ['Variabele uitgaven', -C.futVar, C.varNote + ' · rest van de maand']];
      if (e0) l0.push(['Gepland', e0, 'Via de kalender']);
      const out = [{ key: 'm0', name: 'November', current: true, inc: C.inc + plIn(0), exp: C.novExp + plIn(0) - e0, sav: C.sav, end: novEnd, lines: l0 }];
      let bal = novEnd;
      for (let i = 1; i <= h; i++) {
        const m = (10 + i) % 12;
        const y = 2026 + Math.floor((10 + i) / 12);
        const yearly = (m === 0 && scope !== 'gedeeld') ? FAMILY_INSURANCE : 0;
        const rec = C.rec + yearly;
        const one = scope === 'gedeeld' ? null : (ONE_M[m + '-' + y] || null);
        const ex = i <= 3 ? plSum(i) : 0;
        const exIn = i <= 3 ? plIn(i) : 0;
        const oneIn = one && one[1] > 0 ? one[1] : 0;
        const start = bal;
        const end = start + C.inc - rec - C.varM - C.sav + (one ? one[1] : 0) + ex;
        const lines = [['Startsaldo', start, 'Einde vorige maand'], ['Terugkerend inkomen', C.inc, C.incNote],
          ['Terugkerende uitgaven', -rec, yearly ? C.recNote + ', familiale verzekering' : C.recNote], ['Variabele uitgaven', -C.varM, C.varNote]];
        if (one) lines.push(['Eenmalig', one[1], one[0]]);
        if (ex) lines.push(['Gepland', ex, 'Via de kalender']);
        if (C.sav) lines.push(['Naar spaarrekening', -C.sav, 'Gespaard']);
        out.push({ key: 'm' + i, name: cap(MONTHS[m]) + (y !== 2026 ? ' ' + y : ''), current: false, inc: C.inc + oneIn + exIn,
          exp: rec + C.varM + oneIn - (one ? one[1] : 0) + exIn - ex, sav: C.sav, end, lines });
        bal = end;
      }
      return out.map((o) => Object.assign({}, o, { left: o.end - BUF }));
    };
    const chain = forecast(3);

    // Daily line: balance(d) = balance(d-1) + items on day d - variable spending of day d
    const CM = [{ y: 2026, m: 10, today: 18, start: C.nov1 }, { y: 2026, m: 11, start: chain[0].end }, { y: 2027, m: 0, start: chain[1].end }, { y: 2027, m: 1, start: chain[2].end }];
    const mi = ui.month;
    const M = CM[mi];
    const PL = planned[mi] || [];
    const ev = EVENTS.concat(EXTRA[mi] || []).concat(PL.map((p) => [p.day, p.amt, p.label, 'Gepland', p.label, p.acc, null, p.id]))
      .filter((e) => inScope(e[5]) && !(scope === 'alles' && e[6] === 'int'));
    const days = new Date(M.y, M.m + 1, 0).getDate();
    const offset = (new Date(M.y, M.m, 1).getDay() + 6) % 7;
    const varFor = (d) => M.today ? (d <= M.today ? C.pastVar / M.today : C.futVar / (days - M.today)) : C.varM / days;
    const bal = [M.start];
    for (let d = 1; d <= days; d++) bal.push(bal[d - 1] + ev.filter((e) => e[0] === d).reduce((a, e) => a + e[1], 0) - varFor(d));
    const sel = Math.min(days, ui.sel[mi] || M.today || 1);
    const split = scope === 'alles' && !inner;
    const subs = split ? SUBS.map((x) => ({ key: x[0], name: x[1], sub: x[2], acc: x[3], md: model(x[0], true) })) : [];
    const mName = MONTHS[M.m];

    // Day state; in Alles the worst state of the groups (buffer-and-states.md)
    const stOf = (v, b) => v < 0 ? 'neg' : (v < b ? 'low' : 'ok');
    const stateAt = (d) => {
      if (!split) return stOf(bal[d], BUF);
      const ss = subs.map((s) => stOf(s.md.bal[d], s.md.BUF));
      return ss.indexOf('neg') >= 0 ? 'neg' : (ss.indexOf('low') >= 0 ? 'low' : 'ok');
    };
    const stateTxt = (d) => {
      if (!split) { const x = stateAt(d); return x === 'neg' ? ', negatief saldo' : (x === 'low' ? ', onder je buffer' : ''); }
      return subs.map((s) => { const x = stOf(s.md.bal[d], s.md.BUF); return x === 'neg' ? ', ' + s.name.toLowerCase() + ' negatief' : (x === 'low' ? ', ' + s.name.toLowerCase() + ' onder buffer' : ''); }).join('');
    };

    const cells = [];
    for (let d = 1; d <= days; d++) {
      const evs = ev.filter((e) => e[0] === d);
      const tags = evs.slice(0, 2).map((e) => ({ text: (e[1] < 0 ? '− ' : '+ ') + e[4], color: e[7] ? 'var(--warn)' : (e[1] < 0 ? 'var(--neg)' : 'var(--greenText)') }));
      if (evs.length > 2) tags.push({ text: '+' + (evs.length - 2) + ' meer', color: 'var(--muted)' });
      cells.push({
        d, state: stateAt(d), today: M.today === d, past: !!(M.today && d < M.today), sel: d === sel, tags,
        hasIn: evs.some((e) => e[1] > 0), hasOut: evs.some((e) => e[1] < 0 && !e[7]), hasPlan: evs.some((e) => !!e[7]),
        aria: d + ' ' + mName + ': ' + (evs.length ? evs.map((e) => e[2]).join(', ') + ', ' : '') +
          (split ? subs.map((s) => s.name.toLowerCase() + ' ' + eur0(s.md.bal[d])).join(', ') : 'saldo ' + eur0(bal[d])) + stateTxt(d)
      });
    }

    // Lowest point and the sentence under the chart
    let lowD = 1;
    for (let d = 2; d <= days; d++) if (bal[d] < bal[lowD]) lowD = d;
    const lowV = bal[lowD];
    const endV = bal[days];
    const wasPast = (d) => M.today && d < M.today;
    let lowText;
    if (endV < 0) {
      let fromD = days;
      while (fromD > 1 && bal[fromD - 1] < 0) fromD--;
      lowText = (fromD > 1 ? 'Vanaf ' + fromD + ' ' + mName + ' sta je rood. ' : '') + 'Je eindigt de maand ' + eur0(-endV) + ' rood. Schuif een uitgave op of verlaag een budget.';
    } else if (lowV < 0) {
      lowText = 'Op ' + lowD + ' ' + mName + (wasPast(lowD) ? ' stond je ' : ' sta je ') + eur0(-lowV) + ' rood' + (lowD <= 2 && scope !== 'gedeeld' ? ', tot het salaris binnenkomt.' : '.');
      if (endV < BUF) lowText += ' Je eindigt de maand ' + eur0(BUF - endV) + ' onder je buffer.';
    } else if (lowV < BUF) {
      const under = M.today && lowD < M.today;
      lowText = 'Op ' + lowD + ' ' + mName + (under ? ' zat je ' : ' zak je ') + eur0(BUF - lowV) + ' onder je buffer' + (lowD <= 2 && scope !== 'gedeeld' ? ', tot het salaris binnenkomt.' : '.');
      if (endV < BUF) lowText += ' Je eindigt de maand ' + eur0(BUF - endV) + ' onder je buffer.';
    } else {
      lowText = 'Je blijft de hele maand boven je buffer van ' + eur0(BUF) + '.';
    }

    // Selected day
    const selDate = new Date(M.y, M.m, sel);
    const isPastSel = !!(M.today && sel < M.today);
    const isTodaySel = M.today === sel;
    const items = ev.filter((e) => e[0] === sel).map((e) => ({
      id: e[7] || null, label: e[2], note: e[7] ? (e[1] < 0 ? 'Geplande uitgave' : 'Verwachte inkomst') : e[3], amount: eur(e[1], true),
      color: e[1] < 0 ? 'var(--neg)' : 'var(--text)', dot: e[7] ? 'var(--warn)' : (e[1] < 0 ? 'var(--neg)' : 'var(--green)'), acc: e[5]
    }));
    items.push({ id: null, label: isPastSel ? 'Dagelijkse uitgaven' : 'Dagelijkse uitgaven (schatting)', note: C.varNote, amount: eur(-varFor(sel), true), color: 'var(--neg)', dot: 'var(--muted)', acc: null });
    const selSt = stateAt(sel);
    const selLow = selSt !== 'ok';
    const selNeg = selSt === 'neg';
    const shortDay = sel + ' ' + mName.slice(0, 3);
    const wd = DAYS[selDate.getDay()];

    // Free to spend (budget.md): start + still to receive - fixed - one-off - budgets - savings - buffer
    const afterDay = M.today || 0;
    const fut = ev.filter((e) => e[0] > afterDay);
    const isSav = (e) => e[2] === 'Naar spaarrekening';
    // The board tests e[3] === 'Eenmalig', which files "Eenmalig · offerte garage" under fixed costs; startsWith fixes that.
    const isOne = (e) => !!e[7] || e[3].indexOf('Eenmalig') === 0;
    const sumNeg = (arr) => -arr.reduce((a, e) => a + e[1], 0);
    const incEv = fut.filter((e) => e[1] > 0);
    const incRest = incEv.reduce((a, e) => a + e[1], 0);
    const fixedRest = sumNeg(fut.filter((e) => e[1] < 0 && !isSav(e) && !isOne(e)));
    const oneEv = fut.filter((e) => e[1] < 0 && isOne(e));
    const oneRest = sumNeg(oneEv);
    const savRest = sumNeg(fut.filter((e) => e[1] < 0 && isSav(e)));
    const budRows = CATS.filter((b) => inScope(b[2])).map((b) => ({ name: b[0], bg: b[1], rest: mi === 0 ? b[3] - b[4] : b[3],
      note: mi === 0 ? eur0(b[4]) + ' van ' + eur0(b[3]) + ' al besteed' : 'Volledig budget ' + eur0(b[3]) }));
    const budTot = budRows.reduce((a, b) => a + b.rest, 0);
    const startB = mi === 0 ? bal[M.today] : M.start;
    const free = startB + incRest - fixedRest - oneRest - savRest - budTot - BUF;
    const rowsB = [{ label: mi === 0 ? 'Saldo vandaag' : 'Startsaldo 1 ' + mName, note: C.todayNote, amount: eur(startB), bold: true }];
    if (incRest) rowsB.push({ label: 'Nog te ontvangen', note: incEv.map((e) => e[2]).join(', '), amount: eur(incRest, true) });
    if (fixedRest) rowsB.push({ label: 'Vaste kosten', note: 'Nog te betalen deze maand', amount: eur(-fixedRest, true), sq: 'var(--c1)' });
    if (oneRest) rowsB.push({ label: 'Eenmalig en gepland', note: oneEv.map((e) => e[2]).join(', '), amount: eur(-oneRest, true), sq: 'var(--warn)' });
    rowsB.push({ label: 'Budgetten', note: mi === 0 ? 'Nog te besteden tot 30 ' + mName : 'Gereserveerd voor ' + mName, amount: eur(-budTot, true) });
    budRows.forEach((b) => rowsB.push({ label: b.name, note: b.note, amount: eur(-b.rest, true), sq: b.bg, sub: true }));
    if (savRest) rowsB.push({ label: 'Naar spaarrekening', note: 'Gespaard', amount: eur(-savRest, true), sq: 'var(--c5)' });
    rowsB.push({ label: 'Buffer', note: 'Blijft altijd staan', amount: eur(-BUF, true), sq: HATCH });
    const pos = startB + incRest;
    const costs = fixedRest + oneRest + savRest + budTot + BUF;
    const tot = Math.max(pos, costs) || 1;
    const segs = [];
    if (fixedRest) segs.push({ w: fixedRest / tot * 100, bg: 'var(--c1)' });
    budRows.forEach((b) => segs.push({ w: b.rest / tot * 100, bg: b.bg }));
    if (oneRest) segs.push({ w: oneRest / tot * 100, bg: 'var(--warn)' });
    if (savRest) segs.push({ w: savRest / tot * 100, bg: 'var(--c5)' });
    segs.push({ w: BUF / tot * 100, bg: HATCH });
    if (free > 0) segs.push({ w: free / tot * 100, bg: C.line });
    const freeOk = free >= 0;
    const bud = {
      month: mName, ok: freeOk,
      free: eur(Math.abs(free)),
      freeLabel: freeOk ? 'Vrij te besteden' : 'Tekort',
      freeColor: freeOk ? (scope === 'gedeeld' ? 'var(--sharedText)' : 'var(--greenText)') : 'var(--neg)',
      chipBg: freeOk ? (scope === 'gedeeld' ? 'var(--sharedSoft)' : 'var(--soft)') : 'var(--neg)',
      chipFg: freeOk ? (scope === 'gedeeld' ? 'var(--sharedText)' : 'var(--greenText)') : 'var(--onNeg)',
      aria: 'Van ' + eur0(pos) + ' is ' + eur0(costs - BUF) + ' voorzien voor verwachte kosten, ' + eur0(BUF) + ' is buffer en ' + eur0(Math.max(free, 0)) + ' is vrij.',
      segs: segs.map((s) => ({ w: s.w.toFixed(2), bg: s.bg })),
      rows: rowsB
    };

    // Plan form with the end-of-day preview (planned-item.md)
    const d0 = ui.draft;
    const acc = scope === 'gedeeld' ? 'g' : (scope === 'persoonlijk' ? 'p' : (d0.acc || 'p'));
    const cents = parseCents(d0.amt);
    const isIn = d0.kind === 'in';
    const sign = isIn ? 1 : -1;
    const accMd = split ? subs.filter((s) => s.acc === acc)[0].md : null;
    const aBuf = accMd ? accMd.BUF : BUF;
    const afterBal = (accMd ? accMd.bal[sel] : bal[sel]) + sign * cents;
    const f = {
      kind: d0.kind, acc, cents, sign,
      title: (isIn ? 'Verwachte inkomst op ' : 'Geplande uitgave op ') + shortDay,
      ph: isIn ? 'Bijvoorbeeld: verkoop oude fiets' : 'Bijvoorbeeld: nieuwe fiets',
      accLabel: isIn ? 'Ontvangen op' : 'Betalen met',
      choose: scope === 'alles',
      hasImpact: cents > 0,
      impact: (split ? ACC[acc].full + ' einde dag: ' : 'Saldo einde dag wordt ') + eur(afterBal) + (afterBal < 0 ? ' · je staat rood' : (afterBal < aBuf ? ' · onder je buffer' : '')),
      impactColor: afterBal < 0 ? 'var(--neg)' : (afterBal < aBuf ? 'var(--warn)' : 'var(--greenText)'),
      err: !!d0.err
    };

    const lineColor = C.line;
    return {
      scope, C, BUF, inScope, forecast, M, mi, CM, days, offset, bal, sel, split, subs, cells, lowD, lowV, endV, lineColor,
      cal: {
        name: cap(mName) + ' ' + M.y,
        note: (M.today ? 'Vandaag is ' + M.today + ' ' + mName : 'Verwachting') + ' · ' + (scope === 'alles' ? 'alle rekeningen' : (scope === 'persoonlijk' ? 'persoonlijk' : 'gedeeld')),
        noPrev: mi === 0, noNext: mi === CM.length - 1,
        startTxt: eur0(M.start), endTxt: eur0(endV), lowTxt: lowD + ' ' + mName.slice(0, 3) + ' · ' + eur0(lowV),
        lowColor: lowV < 0 ? 'var(--neg)' : (lowV < BUF ? 'var(--warn)' : lineColor),
        endColor: endV < 0 ? 'var(--neg)' : (endV < BUF ? 'var(--warn)' : 'var(--text)'),
        chartAria: 'Verwacht saldo in ' + mName + ': begin ' + eur0(M.start) + ', laagste ' + eur0(lowV) + ' op ' + lowD + ' ' + mName + ', einde ' + eur0(endV) + '. Buffer ' + eur0(BUF) + '.' +
          (lowV < 0 ? ' De lijn zakt onder nul.' : (lowV < BUF ? ' De lijn komt in de bufferzone.' : '')),
        lowText,
        selLabel: cap(wd.slice(0, 2)) + ' ' + sel + ' ' + mName + (isPastSel || isTodaySel ? ' · saldo' : ' · verwacht')
      },
      day: {
        title: cap(wd) + ' ' + sel + ' ' + mName,
        short: shortDay,
        canAdd: !isPastSel,
        chip: isTodaySel ? 'Vandaag' : (isPastSel ? 'Geboekt' : (selNeg ? 'Negatief' : (selLow ? 'Onder buffer' : 'Verwacht'))),
        chipBg: selNeg && !isPastSel ? 'var(--neg)' : (selLow && !isPastSel ? 'var(--warnChip)' : (isTodaySel ? 'var(--soft)' : 'var(--bg)')),
        chipFg: selNeg && !isPastSel ? 'var(--onNeg)' : (selLow && !isPastSel ? 'var(--warn)' : (isTodaySel ? 'var(--greenText)' : 'var(--muted)')),
        items,
        balLabel: isPastSel || isTodaySel ? 'Saldo einde dag' : 'Verwacht saldo einde dag',
        bal: eur(bal[sel]),
        balColor: selNeg ? 'var(--neg)' : (selLow ? 'var(--warn)' : 'var(--text)'),
        accBals: subs.map((s) => {
          const v = s.md.bal[sel];
          return { name: s.name, bal: eur(v), color: v < 0 ? 'var(--neg)' : (v < s.md.BUF ? 'var(--warn)' : 'var(--text)'), dot: s.acc === 'p' ? 'var(--green)' : 'var(--shared)' };
        })
      },
      f, bud
    };
  }

  function parseCents(s) {
    const v = parseFloat(String(s || '').replace(/[\s€]/g, '').replace(/\./g, '').replace(',', '.'));
    return isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
  }

  // ---------- Small pieces ----------

  const A = (on, cls) => (on ? ' ' + (cls || 'anim-in') : '');
  const delay = (ms) => ' style="--d:' + ms + 'ms"';

  function accPill(acc) {
    const a = ACC[acc];
    return '<span class="pl-acc" style="background:' + a.bg + ';color:' + a.fg + '">' + esc(a.name) + '</span>';
  }

  function segsHtml(segs, cls, aria) {
    return '<span class="pl-segs ' + cls + '"' + (aria ? ' role="img" aria-label="' + esc(aria) + '"' : '') + '>' +
      segs.map((s) => '<span style="width:' + s.w + '%;background:' + s.bg + '"></span>').join('') + '</span>';
  }

  function chip(text, bg, fg, cls) {
    return '<span class="pl-chip' + (cls ? ' ' + cls : '') + '" style="background:' + bg + ';color:' + fg + '">' + esc(text) + '</span>';
  }

  function bufLabel() {
    if (md.scope === 'alles') return desk ? 'Buffer · zicht + gedeeld' : 'Buffer · zichtrekening + gedeelde rekening';
    return md.scope === 'persoonlijk' ? 'Buffer · zichtrekening' : 'Buffer · gedeelde rekening';
  }

  // ---------- Header, group summary, tabs ----------

  function header() {
    return '<div class="page-head' + A(animAll, 'anim-fade') + '">' +
      '<div class="page-head-title"><h1>Planning</h1></div>' +
      S.shell.scopeSwitch(animAll ? 'anim-in' : '') +
      '<div class="page-head-actions">' +
        (desk
          ? '<div class="pl-bufpill"><span class="pl-bufpill-label">' + bufLabel() + '</span><span class="mono pl-bufpill-amount">' + eur(md.C.buf) + '</span>' +
            '<a class="pl-wijzig" href="rekeningen.html">Wijzigen</a></div>'
          : '<a class="avatar" href="meer.html" aria-label="Profiel en meer" style="background:' + D.user.tint + '">' + esc(D.user.initial) + '</a>') +
      '</div>' +
    '</div>';
  }

  function buds() {
    const budOf = (m, name, dot) => Object.assign({}, m.bud, {
      name, dot,
      sumNote: (m.bud.ok ? 'vrij in ' : 'tekort in ') + m.bud.month,
      sumNoteLong: (m.bud.ok ? 'Vrij te besteden in ' : 'Tekort in ') + m.bud.month,
      sumAria: name + ': ' + (m.bud.ok ? 'vrij te besteden ' : 'tekort ') + m.bud.free + ' in ' + m.bud.month + '. Open de volledige berekening.'
    });
    if (md.split) return md.subs.map((s) => budOf(s.md, s.name, s.acc === 'p' ? 'var(--green)' : 'var(--shared)'));
    const ged = md.scope === 'gedeeld';
    return [budOf(md, ged ? 'Gedeelde rekening' : 'Persoonlijk', ged ? 'var(--shared)' : 'var(--green)')];
  }

  // Free-to-spend summary per group; opens the Budget tab (budget.md)
  function summary() {
    const list = buds();
    return '<div class="pl-sum' + A(animAll) + '" style="--cols:' + list.length + ';--d:20ms">' + list.map((b) => desk
      ? '<button type="button" class="pl-sum-card" data-action="go-budget" aria-label="' + esc(b.sumAria) + '">' +
          '<span class="pl-sum-row"><i class="pl-sq" style="background:' + b.dot + '"></i>' +
            '<span class="pl-sum-text"><span class="pl-sum-name">' + esc(b.name) + '</span><span class="pl-sum-note">' + esc(b.sumNoteLong) + '</span></span>' +
            '<span class="mono pl-sum-free" style="color:' + b.freeColor + '">' + b.free + '</span>' +
            '<span class="pl-sum-chev">' + icon('chevron', 16, 2.2) + '</span></span>' +
          segsHtml(b.segs, 'pl-segs--sm') +
        '</button>'
      : '<button type="button" class="pl-sum-card" data-action="go-budget" aria-label="' + esc(b.sumAria) + '">' +
          '<span class="pl-sum-name"><i class="pl-sq pl-sq--sm" style="background:' + b.dot + '"></i><span>' + esc(b.name) + '</span></span>' +
          '<span class="mono pl-sum-free" style="color:' + b.freeColor + '">' + b.free + '</span>' +
          '<span class="pl-sum-note">' + esc(b.sumNote) + '</span>' +
          segsHtml(b.segs, 'pl-segs--sm') +
        '</button>'
    ).join('') + '</div>';
  }

  function tabs() {
    return '<div class="pl-tabs' + A(animAll) + '" role="tablist" aria-label="Planning"' + delay(30) + '>' + TABS.map((t) => {
      const on = t[0] === ui.tab;
      return '<button type="button" role="tab" class="pl-tab" id="pl-tab-' + t[0] + '" aria-selected="' + on + '" aria-controls="pl-panel" tabindex="' + (on ? 0 : -1) +
        '" data-action="tab" data-tab="' + t[0] + '" data-focus="tab-' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }

  function monthNav(title, note, cls) {
    const c = md.cal;
    const btn = (dir, label, ic, disabled) => '<button type="button" class="pl-mnav-btn" aria-label="' + label + '" data-action="month-' + dir + '" data-focus="month-' + dir + '"' +
      (disabled ? ' disabled' : '') + '>' + icon(ic, 18, 2.4) + '</button>';
    return '<div class="pl-mnav ' + cls + '">' +
      btn('prev', 'Vorige maand', 'back', c.noPrev) +
      '<div class="pl-mnav-title"><span class="pl-mnav-name">' + esc(title) + '</span><span class="pl-mnav-note">' + esc(note) + '</span></div>' +
      btn('next', 'Volgende maand', 'chevron', c.noNext) +
    '</div>';
  }

  // ---------- Kalender ----------

  function gridHtml() {
    let h = '';
    for (let i = 0; i < md.offset; i++) h += '<span aria-hidden="true"></span>';
    md.cells.forEach((c) => {
      const cls = 'pl-day pl-day--' + c.state + (c.today ? ' is-today' : '') + (c.past ? ' is-past' : '') + (c.sel ? ' is-sel' : '');
      h += '<button type="button" class="' + cls + '" data-action="day" data-day="' + c.d + '" aria-pressed="' + c.sel + '" aria-label="' + esc(c.aria) +
        '" tabindex="' + (c.sel ? 0 : -1) + '"><span class="pl-day-num">' + c.d + '</span>' +
        (desk
          ? c.tags.map((t) => '<span class="pl-day-tag" style="color:' + t.color + '">' + esc(t.text) + '</span>').join('')
          : '<span class="pl-day-dots">' + (c.hasIn ? '<i style="background:var(--green)"></i>' : '') + (c.hasOut ? '<i style="background:var(--neg)"></i>' : '') +
            (c.hasPlan ? '<i style="background:var(--warn)"></i>' : '') + '</span>') +
      '</button>';
    });
    return h;
  }

  function chartList() {
    if (md.split) return md.subs.map((s) => ({ m: s.md, title: s.name, sub: s.sub, dot: s.acc === 'p' ? 'var(--green)' : 'var(--shared)' }));
    return [{ m: md, title: '', sub: '', dot: '' }];
  }

  function chartHeight() {
    return desk ? (md.split ? 76 : 110) : (md.split ? 64 : 96);
  }

  function selHeadHtml() {
    return '<span class="pl-selhead-label">' + esc(md.cal.selLabel) + '</span>' +
      (md.split ? '' : '<span class="mono pl-selhead-bal" style="color:' + md.day.balColor + '">' + md.day.bal + '</span>');
  }

  function statsHtml(c, m) {
    return '<span class="pl-stats">' +
      '<span>Begin <b class="mono">' + c.startTxt + '</b></span>' +
      '<span>Laagste <b class="mono" style="color:' + c.lowColor + '">' + c.lowTxt + '</b></span>' +
      '<span>Einde <b class="mono" style="color:' + c.endColor + '">' + c.endTxt + '</b></span>' +
      '<span>Buffer <b class="mono">' + eur0(m.BUF) + '</b></span>' +
    '</span>';
  }

  function chartsHtml() {
    const H = chartHeight();
    const blocks = chartList().map((ch, i) => {
      const c = ch.m.cal;
      const title = ch.title ? '<span class="pl-chart-title"><i class="pl-sq" style="background:' + ch.dot + '"></i><span class="pl-chart-name">' + esc(ch.title) + '</span>' +
        '<span class="pl-chart-sub">' + esc(ch.sub) + '</span></span>' : '';
      const selBal = ch.title ? '<span class="mono pl-chart-selbal" data-selbal="' + i + '" style="color:' + ch.m.day.balColor + '">' + ch.m.day.bal + '</span>' : '';
      const head = desk
        ? '<div class="pl-chart-head">' + title + statsHtml(c, ch.m) + selBal + '</div>'
        : (ch.title ? '<div class="pl-chart-head">' + title + selBal + '</div>' : '');
      return '<div class="pl-chart">' + head +
        '<div class="pl-plot" data-i="' + i + '" data-h="' + H + '" style="height:' + H + 'px">' +
          '<svg role="img" aria-label="' + esc(c.chartAria) + '" height="' + H + '"></svg>' +
          '<div class="pl-scrub" aria-hidden="true"></div>' +
        '</div>' +
        '<div class="pl-axis"><span>1</span><span>' + Math.round(ch.m.days / 2) + '</span><span>' + ch.m.days + '</span></div>' +
        (desk ? '' : statsHtml(c, ch.m)) +
        '<span class="pl-lowtext">' + esc(c.lowText) + '</span>' +
      '</div>';
    }).join('');
    const legend = '<div class="pl-legend pl-legend--chart">' +
      '<span><i class="pl-key-dash"></i>Buffer</span><span><i class="pl-key-zero"></i>Nul</span>' +
      '<span><i class="pl-key-box" style="background:var(--warnChip)"></i>In de bufferzone</span>' +
      '<span><i class="pl-key-box pl-key-box--neg"></i>Onder nul</span>' +
      (desk ? '<span class="pl-hint">Beweeg over een grafiek om een dag te kiezen</span>' : '') +
    '</div>';
    return '<div class="pl-charts">' +
      '<div class="pl-selhead" id="pl-selhead">' + selHeadHtml() + '</div>' +
      blocks + legend +
      (desk ? '' : '<span class="pl-hint">Schuif met je vinger over een grafiek om een dag te kiezen.</span>') +
    '</div>';
  }

  // Line chart geometry (board: X/Y with 8 % padding, zones, buffer and zero lines, low point, selected day)
  function chartInner(m, W, H) {
    const bal = m.bal;
    const days = m.days;
    const BUF = m.BUF;
    const vals = bal.slice(1);
    const vMin = Math.min(Math.min.apply(null, vals), 0);
    const vMax = Math.max(Math.max.apply(null, vals), BUF);
    const pad = (vMax - vMin) * 0.08;
    const lo = vMin - pad;
    const hi = vMax + pad;
    const X = (d) => Math.round((d - 1) / (days - 1) * W * 10) / 10;
    const Y = (v) => Math.round((H - (v - lo) / (hi - lo) * H) * 10) / 10;
    const pathOf = (a, b) => { let s = ''; for (let d = a; d <= b; d++) s += (d === a ? 'M' : 'L') + X(d) + ' ' + Y(bal[d]) + ' '; return s.trim(); };
    const today = m.M.today;
    const yb = Y(BUF);
    const y0 = Y(0);
    const low = m.lowV;
    const c = m.cal;
    const lbl = (y, t) => '<text class="pl-chart-lbl" x="' + (W - 2) + '" y="' + y + '" text-anchor="end">' + t + '</text>';
    return '<rect x="0" y="' + Math.max(0, yb) + '" width="' + W + '" height="' + Math.max(0, Math.min(H, y0) - Math.max(0, yb)) + '" rx="3" style="fill:' +
        (low < BUF ? 'var(--warnChip);opacity:0.75' : 'var(--track);opacity:0.5') + '"></rect>' +
      '<rect x="0" y="' + Math.min(H, y0) + '" width="' + W + '" height="' + Math.max(0, H - Math.min(H, y0)) + '" rx="3" style="fill:' +
        (low < 0 ? 'var(--neg);opacity:0.18' : 'var(--track);opacity:0') + '"></rect>' +
      '<line x1="0" x2="' + W + '" y1="' + y0 + '" y2="' + y0 + '" style="stroke:var(--muted);stroke-width:1.5"></line>' +
      '<line x1="0" x2="' + W + '" y1="' + yb + '" y2="' + yb + '" style="stroke:var(--muted);stroke-width:1.5;stroke-dasharray:4 4"></line>' +
      lbl(Math.max(9, yb - 4), 'buffer') + lbl(Math.min(H - 2, y0 + 11), '€ 0') +
      (today ? '<line x1="' + X(today) + '" x2="' + X(today) + '" y1="0" y2="' + H + '" style="stroke:var(--line);stroke-width:2"></line>' : '') +
      '<line x1="' + X(m.sel) + '" x2="' + X(m.sel) + '" y1="0" y2="' + H + '" style="stroke:var(--text);stroke-width:1;opacity:0.35"></line>' +
      '<path d="' + pathOf(today || 1, days) + '" fill="none" style="stroke:' + m.lineColor + ';stroke-width:2.5;stroke-dasharray:5 4;stroke-linecap:round;stroke-linejoin:round"></path>' +
      (today ? '<path d="' + pathOf(1, today) + '" fill="none" style="stroke:' + m.lineColor + ';stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round"></path>' : '') +
      '<circle cx="' + X(m.lowD) + '" cy="' + Y(low) + '" r="4" style="fill:' + c.lowColor + '"></circle>' +
      '<circle cx="' + X(m.sel) + '" cy="' + Y(bal[m.sel]) + '" r="5.5" style="fill:var(--surface);stroke:var(--text);stroke-width:2.5"></circle>';
  }

  function drawCharts() {
    if (!pageEl || !md) return;
    const list = chartList();
    pageEl.querySelectorAll('.pl-plot').forEach((plot) => {
      const ch = list[+plot.dataset.i];
      const W = Math.round(plot.clientWidth);
      const H = +plot.dataset.h;
      if (!ch || !W) return;
      const svg = plot.querySelector('svg');
      svg.setAttribute('width', W);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.innerHTML = chartInner(ch.m, W, H);
    });
  }

  function itemRow(it) {
    return '<div class="pl-item">' +
      '<i class="pl-dot" style="background:' + it.dot + '"></i>' +
      '<span class="pl-item-main"><span class="pl-item-label">' + esc(it.label) + '</span>' +
        '<span class="pl-item-sub">' + (it.acc ? accPill(it.acc) : '') + esc(it.note) + '</span></span>' +
      '<span class="mono pl-item-amount" style="color:' + it.color + '">' + it.amount + '</span>' +
      (it.id ? '<button type="button" class="pl-item-remove" aria-label="Geplande post verwijderen: ' + esc(it.label) + '" data-action="remove" data-id="' + it.id + '">' + icon('close', 16, 2.4) + '</button>' : '') +
    '</div>';
  }

  function formHtml() {
    const f = md.f;
    const kind = (k, label) => {
      const on = f.kind === k;
      return '<button type="button" aria-pressed="' + on + '" data-action="kind" data-kind="' + k + '" data-focus="kind-' + k + '">' + label + '</button>';
    };
    const accBtn = (k) => {
      const on = f.acc === k;
      const a = ACC[k];
      return '<button type="button" aria-pressed="' + on + '" data-action="acc" data-acc="' + k + '" data-focus="acc-' + k + '" style="' +
        (on ? 'background:' + a.sel + ';color:' + a.onSel + ';border-color:transparent' : '') + '">' + a.full + '</button>';
    };
    return '<form class="pl-form' + A(fresh.form, 'pl-pop') + '" data-form="plan" novalidate>' +
      '<span class="pl-form-title">' + esc(f.title) + '</span>' +
      '<div class="pl-seg pl-seg--kind" role="group" aria-label="Soort">' + kind('out', '− Uitgave') + kind('in', '+ Inkomst') + '</div>' +
      '<div class="pl-field"><label class="pl-label" for="pl-desc">Omschrijving</label>' +
        '<input class="pl-input" id="pl-desc" autocomplete="off" value="' + esc(ui.draft.desc) + '" placeholder="' + esc(f.ph) + '"></div>' +
      '<div class="pl-field"><label class="pl-label" for="pl-amt">Bedrag</label>' +
        '<div class="pl-money"><span aria-hidden="true">€</span><input class="pl-input mono" id="pl-amt" inputmode="decimal" autocomplete="off" value="' + esc(ui.draft.amt) + '" placeholder="0,00"></div></div>' +
      '<div class="pl-field"><span class="pl-label" id="pl-acc-label">' + f.accLabel + '</span>' +
        (f.choose
          ? '<div class="pl-accs" role="group" aria-labelledby="pl-acc-label">' + accBtn('p') + accBtn('g') + '</div>'
          : '<span class="pl-fixed" style="background:' + ACC[f.acc].bg + ';color:' + ACC[f.acc].fg + '">' + ACC[f.acc].full + '</span>') +
      '</div>' +
      '<span class="pl-impact" aria-live="polite" style="color:' + f.impactColor + '">' + (f.hasImpact ? esc(f.impact) : '') + '</span>' +
      (f.err ? '<span class="pl-err" role="alert">Vul een omschrijving en een bedrag in.</span>' : '') +
      '<div class="pl-form-actions">' +
        '<button type="button" class="btn btn--ghost" data-action="cancel">Annuleren</button>' +
        '<button type="submit" class="btn btn--primary" data-focus="submit">Toevoegen</button>' +
      '</div>' +
    '</form>';
  }

  function dayCardHtml() {
    const d = md.day;
    let h = '<div class="pl-dc-head"><h2 class="pl-dc-title">' + esc(d.title) + '</h2>' + chip(d.chip, d.chipBg, d.chipFg, 'pl-chip--sm') + '</div>';
    h += d.items.map(itemRow).join('');
    if (d.canAdd) {
      h += ui.addOpen ? formHtml()
        : '<button type="button" class="pl-add" data-action="add-open" data-focus="add-open">' + icon('plus', 16, 2.6) + 'Uitgave of inkomst plannen op ' + esc(d.short) + '</button>';
    }
    if (!md.split) {
      h += '<div class="pl-total"><span>' + d.balLabel + '</span><span class="mono pl-total-bal" style="color:' + d.balColor + '">' + d.bal + '</span></div>';
    } else {
      h += '<div class="pl-total pl-total--split"><span>' + d.balLabel + '</span>' + d.accBals.map((ab) =>
        '<div class="pl-accbal"><i class="pl-sq" style="background:' + ab.dot + '"></i><span class="pl-accbal-name">' + esc(ab.name) + '</span>' +
        '<span class="mono pl-accbal-bal" style="color:' + ab.color + '">' + ab.bal + '</span></div>').join('') + '</div>';
    }
    return h;
  }

  function kalender() {
    const c = md.cal;
    const dow = '<div class="pl-dow" aria-hidden="true">' + ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((x) => '<span>' + x + '</span>').join('') + '</div>';
    const legend = '<div class="pl-legend pl-legend--cal">' + (desk
      ? '<span><b style="color:var(--greenText)">+</b>Inkomend</span><span><b style="color:var(--neg)">−</b>Uitgaand</span><span><b style="color:var(--warn)">±</b>Gepland</span>'
      : '<span><i class="pl-key-dot" style="background:var(--green)"></i>Inkomend</span><span><i class="pl-key-dot" style="background:var(--neg)"></i>Uitgaand</span>' +
        '<span><i class="pl-key-dot" style="background:var(--warn)"></i>Gepland</span>') +
      '<span><i class="pl-key-box pl-key-box--warn"></i>Onder buffer</span><span><i class="pl-key-box pl-key-box--neg"></i>Negatief</span></div>';
    const nav = monthNav(c.name, c.note, desk ? 'pl-mnav--card' : '');
    const card = '<div class="card pl-cal">' + (desk ? nav : '') + dow +
      '<div class="pl-grid" id="pl-grid" role="group" aria-label="Dagen in ' + esc(c.name.toLowerCase()) + '">' + gridHtml() + '</div>' +
      legend + chartsHtml() + '</div>';
    const day = '<div class="card pl-daycard" id="pl-daycard">' + dayCardHtml() + '</div>';
    return desk ? '<div class="pl-kal">' + card + '<div class="pl-side">' + day + '</div></div>' : nav + card + day;
  }

  // ---------- Maanden ----------

  function monthView(o, i) {
    const short = o.left < 0;
    const st = o.end < 0 ? 'neg' : (short ? 'under' : 'ok');
    return {
      o, st, delay: Math.min(i, 8) * 30,
      chip: st === 'neg' ? eur(Math.abs(o.end)) + ' rood' : eur(Math.abs(o.left)) + (short ? ' onder buffer' : ' over'),
      chipBg: st === 'neg' ? 'var(--neg)' : (st === 'under' ? 'var(--warnChip)' : 'var(--soft)'),
      chipFg: st === 'neg' ? 'var(--onNeg)' : (st === 'under' ? 'var(--warn)' : 'var(--greenText)'),
      summary: 'In ' + eur0(o.inc) + ' · uit ' + eur0(o.exp) + (o.sav ? ' · gespaard ' + eur0(o.sav) : ''),
      resultLabel: st === 'neg' ? 'Tekort · je staat rood' : (short ? 'Onder buffer' : 'Over')
    };
  }

  function breakdown(v) {
    return v.o.lines.map((l) => '<div class="pl-line"><span class="pl-line-text"><span>' + esc(l[0]) + '</span><span class="pl-line-note">' + esc(l[2]) + '</span></span>' +
        '<span class="mono">' + (l[1] === 0 ? '€ 0,00' : eur(l[1], true)) + '</span></div>').join('') +
      '<div class="pl-line pl-line--end"><span>Eindsaldo</span><span class="mono">' + eur(v.o.end) + '</span></div>' +
      '<div class="pl-line pl-line--buf"><span>Min. buffer</span><span class="mono">−' + eur(md.C.buf) + '</span></div>' +
      '<div class="pl-result" style="background:' + v.chipBg + ';color:' + v.chipFg + '"><span>' + v.resultLabel + '</span><span class="mono">' + eur(Math.abs(v.o.left)) + '</span></div>';
  }

  function maanden() {
    const views = md.forecast(ui.horizon).map(monthView);
    const hz = '<div class="pl-hz-row"><span class="pl-hz-label">Vooruitkijken</span><div class="pl-seg pl-seg--hz" role="group" aria-label="Horizon">' +
      HORIZONS.map((n) => '<button type="button" aria-pressed="' + (n === ui.horizon) + '" data-action="horizon" data-n="' + n + '" data-focus="hz-' + n + '">' + n + ' mnd</button>').join('') +
      '</div></div>';
    const skel = '<div class="pl-skel-list" role="status" aria-label="Laden">' + '<div class="pl-skel"></div>'.repeat(4) + '</div>';
    const cardCls = (v) => 'pl-mcard pl-mcard--' + v.st;
    const animM = animPanel || fresh.months;

    if (desk) {
      const selKey = ui.open || 'm3';
      const sv = views.find((v) => v.o.key === selKey) || views[0];
      const rows = views.map((v) => '<button type="button" class="' + cardCls(v) + ' pl-mrow' + A(animM) + (v.o.key === selKey ? ' is-sel' : '') + '"' + delay(v.delay) +
        ' aria-pressed="' + (v.o.key === selKey) + '" data-action="month-select" data-key="' + v.o.key + '" data-focus="m-' + v.o.key + '">' +
        '<span class="pl-mcard-name">' + esc(v.o.name) + (v.o.current ? '<span class="pl-lopend">lopend</span>' : '') + '</span>' +
        '<span class="pl-mcard-sum">' + v.summary + '</span>' +
        '<span class="mono pl-mcard-end">' + eur(v.o.end) + '</span>' +
        chip(v.chip, v.chipBg, v.chipFg, 'pl-mrow-chip') +
      '</button>').join('');
      return '<div class="pl-maanden">' +
        '<div class="pl-mcol">' + hz + (ui.loading ? skel : '<div class="pl-mlist">' + rows + '</div>') + '</div>' +
        '<div class="card pl-mdetail" aria-live="polite"><h2 class="pl-mdetail-title">' + esc(sv.o.name) + '</h2>' + breakdown(sv) + '</div>' +
      '</div>';
    }

    const openKey = ui.open === undefined ? 'm3' : ui.open;
    const cards = views.map((v) => {
      const open = v.o.key === openKey;
      return '<div class="' + cardCls(v) + A(animM) + '"' + delay(v.delay) + '>' +
        '<button type="button" class="pl-mcard-btn" aria-expanded="' + open + '" aria-controls="pl-m-' + v.o.key + '" data-action="month-toggle" data-key="' + v.o.key + '" data-focus="m-' + v.o.key + '">' +
          '<span class="pl-mcard-top"><span class="pl-mcard-name">' + esc(v.o.name) + (v.o.current ? '<span class="pl-lopend">lopend</span>' : '') + '</span>' + chip(v.chip, v.chipBg, v.chipFg) + '</span>' +
          '<span class="pl-mcard-bottom"><span class="pl-mcard-sum">' + v.summary + '</span><span class="mono pl-mcard-end">' + eur(v.o.end) + '</span></span>' +
        '</button>' +
        (open ? '<div class="pl-mcard-body' + A(fresh.month === v.o.key, 'pl-pop') + '" id="pl-m-' + v.o.key + '">' + breakdown(v) + '</div>' : '') +
      '</div>';
    }).join('');
    return hz +
      '<div class="pl-bufcard"><span class="pl-bufcard-text"><span class="pl-bufcard-label">' + bufLabel() + '</span><span class="mono pl-bufcard-amount">' + eur(md.C.buf) + '</span></span>' +
        '<a class="pl-wijzig" href="rekeningen.html">Wijzigen</a></div>' +
      (ui.loading ? skel : '<div class="pl-mlist">' + cards + '</div>');
  }

  // ---------- Terugkerend ----------

  function terugkerend() {
    const scope = md.scope;
    const visible = (acc, int) => md.inScope(acc) && !(scope === 'alles' && int);
    const confirmed = SUGGESTIONS.filter((s) => ui.done[s.id] === 'ja').map((s) => [s.name, s.rhythm.split(' · ').slice(0, 2).join(' · '), s.amt, s.acc]);
    const open = SUGGESTIONS.filter((s) => !ui.done[s.id] && md.inScope(s.acc));
    const rows = RECURRING.concat(confirmed).filter((r) => visible(r[3], r[4]));
    const sugg = open.map((s) => '<div class="pl-sugg">' +
      '<div class="pl-sugg-top"><span class="pl-sugg-text"><span class="pl-sugg-name">' + esc(s.name) + '</span><span class="pl-sugg-sub">' + accPill(s.acc) + esc(s.rhythm) + '</span></span>' +
        '<span class="mono pl-sugg-amount">' + eur(s.amt, true) + '</span></div>' +
      '<div class="pl-sugg-actions">' +
        '<button type="button" class="btn btn--primary pl-btn-sm" data-action="suggest" data-id="' + s.id + '" data-v="ja">Bevestigen</button>' +
        '<button type="button" class="btn btn--ghost pl-btn-sm" data-action="suggest" data-id="' + s.id + '" data-v="nee">Negeren</button>' +
      '</div></div>').join('');
    const head = '<h2 class="pl-h2">Te bevestigen <span class="pl-h2-count">· ' + open.length + '</span></h2>';
    const suggSection = open.length || desk
      ? '<section class="pl-section">' + head + sugg + (open.length ? '' : '<p class="pl-empty-card">Alles bevestigd.</p>') + '</section>' : '';
    const list = rows.map((r) => {
      const amt = '<span class="mono pl-rec-amount" style="color:' + (r[2] < 0 ? 'var(--neg)' : 'var(--text)') + '">' + eur(r[2], true) + '</span>';
      return desk
        ? '<div class="pl-rec pl-rec--desk"><span class="pl-rec-name">' + esc(r[0]) + '</span><span class="pl-rec-acc">' + accPill(r[3]) + '</span><span class="pl-rec-rhythm">' + esc(r[1]) + '</span>' + amt + '</div>'
        : '<div class="pl-rec"><span class="pl-rec-main"><span class="pl-rec-name">' + esc(r[0]) + '</span><span class="pl-rec-sub">' + accPill(r[3]) + esc(r[1]) + '</span></span>' + amt + '</div>';
    }).join('');
    return '<div class="pl-terug">' + suggSection +
      '<section class="pl-section"><h2 class="pl-h2">Bevestigd</h2><div class="pl-list">' + list + '</div></section></div>';
  }

  // ---------- Eenmalig ----------

  function eenmalig() {
    const all = ONE_OFFS.slice();
    Object.keys(ui.planned).forEach((k) => (ui.planned[k] || []).forEach((p) => all.push([MY[k][0], MY[k][1], p.label, (p.amt < 0 ? 'Gepland op ' : 'Verwacht op ') + p.day + ' ' + MY[k][2], p.amt, p.acc, 'var(--warnSoft)'])));
    const rows = all.filter((o) => md.inScope(o[5])).map((o) => {
      const fg = o[6] === 'var(--warnSoft)' ? 'var(--warn)' : (o[6] === 'var(--soft)' ? 'var(--greenText)' : 'var(--onPastel)');
      return '<div class="pl-one">' +
        '<span class="pl-one-date" style="background:' + o[6] + ';color:' + fg + '"><span>' + o[0] + '</span><span>' + o[1] + '</span></span>' +
        '<span class="pl-rec-main"><span class="pl-rec-name">' + esc(o[2]) + '</span><span class="pl-rec-sub">' + accPill(o[5]) + esc(o[3]) + '</span></span>' +
        '<span class="mono pl-rec-amount" style="color:' + (o[4] < 0 ? 'var(--neg)' : 'var(--greenText)') + '">' + eur(o[4], true) + '</span>' +
      '</div>';
    }).join('');
    return '<div class="pl-eenmalig"><div class="pl-list">' + (rows || '<p class="pl-empty">Nog geen eenmalige posten voor deze rekeningen.</p>') + '</div>' +
      '<button type="button" class="btn btn--dashed btn--block" data-action="go-kalender">Eenmalige uitgave of inkomst toevoegen via de kalender</button></div>';
  }

  // ---------- Budget ----------

  function budget() {
    const list = buds();
    const cards = list.map((b) => '<div class="card pl-bcard">' +
      '<div class="pl-bcard-head"><span class="pl-bcard-name"><i class="pl-sq" style="background:' + b.dot + '"></i>' + esc(b.name) + '</span>' +
        '<span class="pl-bcard-free"><span class="pl-bcard-free-label">' + b.freeLabel + '</span><span class="mono pl-bcard-amount" style="color:' + b.freeColor + '">' + b.free + '</span></span></div>' +
      segsHtml(b.segs, 'pl-segs--lg', b.aria) +
      '<div class="pl-brows">' + b.rows.map((r) => '<div class="pl-brow' + (r.sub ? ' pl-brow--sub' : '') + (r.bold ? ' pl-brow--bold' : '') + '">' +
          (r.sq ? '<i class="pl-sq" style="background:' + r.sq + '"></i>' : '') +
          '<span class="pl-brow-text"><span class="pl-brow-label">' + esc(r.label) + '</span><span class="pl-brow-note">' + esc(r.note) + '</span></span>' +
          '<span class="mono pl-brow-amount">' + r.amount + '</span></div>').join('') +
        '<div class="pl-result" style="background:' + b.chipBg + ';color:' + b.chipFg + '"><span>' + b.freeLabel + '</span><span class="mono">' + b.free + '</span></div>' +
      '</div></div>').join('');
    const cats = CATS.filter((c) => md.inScope(c[2])).map((c, i) => '<div class="pl-cat">' +
      '<div class="pl-cat-head"><i class="pl-cat-dot" style="background:' + c[1] + '"></i><span class="pl-cat-name">' + esc(c[0]) + '</span>' + accPill(c[2]) + '</div>' +
      '<span class="pl-cat-track"><span class="pl-cat-fill' + A(animPanel, 'pl-grow') + '" style="width:' + Math.round(c[4] / c[3] * 100) + '%;background:' + c[1] + ';--d:' + (80 + i * 50) + 'ms"></span></span>' +
      '<span class="mono pl-cat-amount">' + eur(c[4]) + ' van ' + eur(c[3]) + '</span>' +
    '</div>').join('');
    const note = md.scope === 'gedeeld'
      ? 'Energie, internet en Netflix lopen via terugkerende posten. Jullie bijdragen (€ 900 per maand) dekken de vaste kosten en deze budgetten.'
      : 'Wonen en abonnementen lopen via terugkerende posten. Zonder budget rekent de planning met het gemiddelde van de afgelopen 6 maanden.';
    return '<div class="pl-budget">' +
      monthNav('Budget ' + md.cal.name.toLowerCase(), 'Verwachte kosten zijn al afgetrokken', 'pl-mnav--budget') +
      '<div class="pl-bcards" style="--cols:' + list.length + '">' + cards + '</div>' +
      '<h2 class="label pl-cats-title">Per categorie · deze maand</h2>' +
      '<div class="pl-cats">' + cats + '</div>' +
      '<p class="pl-note">' + note + '</p>' +
    '</div>';
  }

  // ---------- Drawing ----------

  function panel() {
    switch (ui.tab) {
      case 'maanden': return maanden();
      case 'terugkerend': return terugkerend();
      case 'eenmalig': return eenmalig();
      case 'budget': return budget();
      default: return kalender();
    }
  }

  function draw(level) {
    if (!pageEl) return;
    desk = mq.matches;
    animAll = level === 'all';
    animPanel = animAll || level === 'panel';
    md = model(scopeNow);
    pageEl.innerHTML = header() + summary() + tabs() +
      '<div class="pl-panel' + A(animPanel) + '" id="pl-panel" role="tabpanel" aria-labelledby="pl-tab-' + ui.tab + '">' + panel() + '</div>';
    fresh = {};
    drawCharts();
  }

  // Re-render without page animations and put focus back on the same control
  function refresh(focusKey, level) {
    const ae = document.activeElement;
    const key = focusKey || (ae && pageEl.contains(ae) && ae.dataset ? ae.dataset.focus : null);
    draw(level || 'none');
    if (key) {
      const el = pageEl.querySelector('[data-focus="' + key + '"]');
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
  }

  // Day selection only touches the Kalender parts, so the scrub overlay survives a drag
  function selectDay(d, focusCell) {
    if (d === md.sel) return;
    ui.sel[ui.month] = d;
    ui.addOpen = false;
    md = model(scopeNow);
    const grid = pageEl.querySelector('#pl-grid');
    if (!grid) return;
    grid.innerHTML = gridHtml();
    pageEl.querySelector('#pl-selhead').innerHTML = selHeadHtml();
    chartList().forEach((ch, i) => {
      const el = pageEl.querySelector('[data-selbal="' + i + '"]');
      if (el) { el.textContent = ch.m.day.bal; el.style.color = ch.m.day.balColor; }
    });
    pageEl.querySelector('#pl-daycard').innerHTML = dayCardHtml();
    drawCharts();
    if (focusCell) grid.querySelector('.is-sel').focus({ preventScroll: true });
  }

  function setTab(id, focus) {
    if (!TABS.some((t) => t[0] === id)) return;
    if (id !== ui.tab) {
      ui.tab = id;
      try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// */ }
    }
    refresh(focus ? 'tab-' + id : null, 'panel');
  }

  function setMonth(dir) {
    const n = Math.max(0, Math.min(3, ui.month + dir));
    if (n === ui.month) return;
    ui.month = n;
    ui.addOpen = false;
    refresh(null, 'panel');
    const btn = pageEl.querySelector('[data-focus="month-' + (dir < 0 ? 'prev' : 'next') + '"]');
    const other = pageEl.querySelector('[data-focus="month-' + (dir < 0 ? 'next' : 'prev') + '"]');
    (btn && !btn.disabled ? btn : other).focus({ preventScroll: true });
  }

  function addPlanned() {
    const f = md.f;
    const desc = ui.draft.desc.trim();
    if (!desc || !f.cents) {
      ui.draft.err = true;
      refresh('submit');
      return;
    }
    const item = { id: 'p' + Date.now(), day: md.sel, amt: f.sign * f.cents, label: desc, acc: f.acc };
    ui.planned[ui.month] = (ui.planned[ui.month] || []).concat([item]);
    ui.addOpen = false;
    refresh('add-open');
    S.shell.toast('Gepland op ' + md.day.short + ' · ' + eur(item.amt, true));
  }

  // ---------- Events ----------

  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || !pageEl.contains(el)) return;
    const a = el.dataset.action;
    if (a === 'go-budget') setTab('budget');
    else if (a === 'go-kalender') setTab('kalender');
    else if (a === 'tab') setTab(el.dataset.tab);
    else if (a === 'month-prev') setMonth(-1);
    else if (a === 'month-next') setMonth(1);
    else if (a === 'day') selectDay(+el.dataset.day, true);
    else if (a === 'add-open') {
      ui.addOpen = true;
      ui.draft = { desc: '', amt: '', kind: 'out', acc: ui.draft.acc, err: false };
      fresh.form = true;
      refresh();
      const inp = pageEl.querySelector('#pl-desc');
      if (inp) inp.focus();
    } else if (a === 'kind') {
      ui.draft.kind = el.dataset.kind;
      ui.draft.err = false;
      refresh();
    } else if (a === 'acc') {
      ui.draft.acc = el.dataset.acc;
      refresh();
    } else if (a === 'cancel') {
      ui.addOpen = false;
      refresh('add-open');
    } else if (a === 'remove') {
      ui.planned[ui.month] = (ui.planned[ui.month] || []).filter((p) => p.id !== el.dataset.id);
      refresh('add-open');
    } else if (a === 'horizon') {
      const n = +el.dataset.n;
      if (n === ui.horizon) return;
      ui.horizon = n;
      ui.loading = true;
      refresh();
      setTimeout(() => {
        ui.loading = false;
        fresh.months = true;
        if (ui.tab === 'maanden') refresh();
      }, 380);
    } else if (a === 'month-toggle') {
      const key = el.dataset.key;
      const cur = ui.open === undefined ? 'm3' : ui.open;
      ui.open = key === cur ? null : key;
      fresh.month = ui.open;
      refresh();
    } else if (a === 'month-select') {
      ui.open = el.dataset.key;
      refresh();
    } else if (a === 'suggest') {
      ui.done[el.dataset.id] = el.dataset.v;
      refresh();
      S.shell.toast(el.dataset.v === 'ja' ? 'Toegevoegd aan terugkerende posten' : 'Genegeerd');
    }
  }

  function onKey(e) {
    const day = e.target.closest('.pl-day');
    if (day) {
      const d = +day.dataset.day;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      let n = null;
      if (step) n = d + step;
      else if (e.key === 'Home') n = 1;
      else if (e.key === 'End') n = md.days;
      if (n !== null) {
        e.preventDefault();
        selectDay(Math.max(1, Math.min(md.days, n)), true);
      }
      return;
    }
    const tab = e.target.closest('.pl-tab');
    if (tab) {
      const i = TABS.findIndex((t) => t[0] === tab.dataset.tab);
      let n = null;
      if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
      else if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = TABS.length - 1;
      if (n !== null) {
        e.preventDefault();
        setTab(TABS[n][0], true);
      }
    }
  }

  // Typing updates the draft and the end-of-day preview in place (no re-render, focus stays)
  function onInput(e) {
    const id = e.target.id;
    if (id !== 'pl-desc' && id !== 'pl-amt') return;
    if (id === 'pl-desc') ui.draft.desc = e.target.value;
    else ui.draft.amt = e.target.value;
    ui.draft.err = false;
    md = model(scopeNow);
    const imp = pageEl.querySelector('.pl-impact');
    if (imp) {
      imp.textContent = md.f.hasImpact ? md.f.impact : '';
      imp.style.color = md.f.impactColor;
    }
    const err = pageEl.querySelector('.pl-err');
    if (err) err.remove();
  }

  function onSubmit(e) {
    if (!e.target.matches('[data-form="plan"]')) return;
    e.preventDefault();
    addPlanned();
  }

  function onScrub(e) {
    const ov = e.target.closest && e.target.closest('.pl-scrub');
    if (!ov || !md) return;
    const r = ov.getBoundingClientRect();
    if (!r.width) return;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const d = Math.min(md.days, Math.max(1, Math.round(x * (md.days - 1)) + 1));
    selectDay(d, false);
  }

  function bind(page) {
    if (page.dataset.plBound) return;
    page.dataset.plBound = '1';
    page.addEventListener('click', onClick);
    page.addEventListener('keydown', onKey);
    page.addEventListener('input', onInput);
    page.addEventListener('submit', onSubmit);
    page.addEventListener('pointerdown', onScrub);
    page.addEventListener('pointermove', onScrub);
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        const w = page.clientWidth;
        if (w !== lastW) { lastW = w; drawCharts(); }
      }).observe(page);
    }
    mq.addEventListener('change', () => draw('none'));
    window.addEventListener('hashchange', () => {
      const t = tabFromHash();
      if (t && t !== ui.tab) setTab(t);
    });
  }

  function render(page, st) {
    pageEl = page;
    if (scopeNow !== null && scopeNow !== st.scope) {
      ui.addOpen = false;
      ui.open = undefined;
    }
    scopeNow = st.scope;
    bind(page);
    draw('all');
  }

  S.screens = S.screens || {};
  S.screens.planning = { title: 'Planning', render };
})(window.Saldo = window.Saldo || {});
