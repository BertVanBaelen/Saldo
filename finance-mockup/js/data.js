// Shared demo data: the story from analysis section 12, as the design boards show it.
// See analysis/concepts/demo-data.md. Amounts are integer cents.
// Screen-specific demo rows (transactions, calendar items …) live in the screen's own script.
(function (S) {
  'use strict';

  const data = {
    today: '2026-11-18',
    lastSync: 'vandaag 04:02',

    user: { name: 'Bert', initial: 'B', role: 'Beheerder', tint: 'var(--c2)', email: 'bert@jouw-domein.be' },
    partner: { name: 'Partner', initial: 'P', tint: 'var(--c3)' },

    // analysis/concepts/account.md. `color` is one of the 8 account colours (--a-<color> in tokens.css);
    // it is used wherever the account itself is shown (decision 3 Nov 2026).
    // `group` is the scope the account falls in: 'pers' (Persoonlijk, one member) or 'ged' (Gedeeld, more
    // than one member). It is a filter, not a merged unit: every current account has its own buffer,
    // forecast and warnings (decision 3 Nov 2026, analysis/concepts/scope.md).
    accounts: [
      { id: 'zicht', name: 'Zichtrekening', type: 'current', group: 'pers', source: 'Argenta', iban: 'BE68 •••• •••• 4821', balance: 196882, buffer: 90000, icon: 'card', color: 'green' },
      { id: 'spaar', name: 'Spaarrekening', type: 'savings', group: 'pers', source: 'Handmatig', updated: '2 okt', iban: 'BE41 •••• •••• 1196', balance: 1250000, buffer: 0, icon: 'coins', color: 'orange' },
      { id: 'reserve', name: 'Reserve', type: 'savings', group: 'pers', source: 'Handmatig', updated: '2 okt', balance: 420000, buffer: 0, icon: 'coins', color: 'yellow' },
      { id: 'gedeeld', name: 'Gedeelde rekening', type: 'current', group: 'ged', source: 'Argenta', iban: 'BE12 •••• •••• 7730', balance: 94608, buffer: 60000, icon: 'people', color: 'violet', manager: true, members: ['B', 'P'] }
    ],

    // One forecast per current account (analysis/concepts/forecast.md). `key` and `scope` say which
    // scope filter shows it; `title` is the account name used in charts, alerts and summaries.
    // Chart scale (max/min) per account as in the design.
    groups: [
      { key: 'pers', account: 'zicht', scope: 'persoonlijk', title: 'Zichtrekening', heroName: 'zichtrekening', color: 'var(--green)', now: 196882, buffer: 90000,
        forecast: [126544, 116047, 72150, -103347], chartMax: 140000, chartMin: -120000 },
      { key: 'ged', account: 'gedeeld', scope: 'gedeeld', title: 'Gedeelde rekening', heroName: 'gedeelde rekening', color: 'var(--shared)', now: 94608, buffer: 60000,
        forecast: [64686, 64686, 64686, 64686], chartMax: 80000, chartMin: 0 }
    ],
    forecastMonths: [
      { short: 'nov · nu', name: 'november' },
      { short: 'dec', name: 'december' },
      { short: 'jan', name: 'januari' },
      { short: 'feb', name: 'februari' }
    ],

    // analysis/concepts/category.md
    categories: {
      Wonen: 'var(--c1)',
      Boodschappen: 'var(--c2)',
      'Vrije tijd': 'var(--c3)',
      Vervoer: 'var(--c4)',
      Abonnementen: 'var(--c5)',
      Overig: 'var(--c6)'
    },

    // Spending this month per scope (Start, "Uitgaven november")
    spending: {
      month: 'november',
      alles: { total: 185237, split: { pers: 125159, ged: 60078 },
        rows: [['Wonen', 115000], ['Boodschappen', 41280], ['Vrije tijd', 13820], ['Vervoer', 9640], ['Abonnementen', 5497]] },
      persoonlijk: { total: 125159,
        rows: [['Wonen', 100500], ['Vrije tijd', 13820], ['Vervoer', 9640], ['Abonnementen', 1199]] },
      gedeeld: { total: 60078,
        rows: [['Boodschappen', 41280], ['Wonen', 14500], ['Abonnementen', 4298]] }
    },

    contributions: { month: 'november', rows: [{ who: 'Jij', amount: 45000, ok: true }, { who: 'Partner', amount: 45000, ok: true }] },

    // Consent expires 30 November: 12 days from today. The 14-day reminder went out on Monday 16 November.
    consent: { bank: 'Argenta', daysLeft: 12, expires: '30 november' },
    // Equals the uncategorised demo rows in Transacties (Bol.com, Bakkerij, Frituur, Apotheek).
    toCategorise: 4,
    suggestions: 3,

    // Bank connections (analysis/concepts/bank-connection.md). The viewer sees their own connections;
    // for a shared account they also see which member's link is the primary or fallback source.
    connections: [
      { id: 'c1', bank: 'Argenta', owner: 'Bert', mine: true, app: 'Saldo · Bert', since: '3 juni 2026', validUntil: '30 november 2026', daysLeft: 12,
        lastSync: 'vandaag 04:02', accounts: ['zicht', 'gedeeld'] },
      { id: 'c2', bank: 'Argenta', owner: 'Partner', mine: false, since: '5 juni 2026', validUntil: '2 december 2026', daysLeft: 14,
        lastSync: 'vandaag 04:05', accounts: ['gedeeld'] }
    ],
    // Sync sources per bank account: primary first, then fallback.
    sources: {
      zicht: [{ connection: 'c1', priority: 'primary' }],
      gedeeld: [{ connection: 'c1', priority: 'primary' }, { connection: 'c2', priority: 'fallback' }]
    },
    // Members of the shared account (analysis/concepts/shared-account.md). `share` = agreed contribution split in %.
    members: {
      gedeeld: [
        { who: 'Bert', initial: 'B', tint: 'var(--c2)', role: 'manager', perm: 'edit', since: '3 juni 2026', share: 50, me: true },
        { who: 'Partner', initial: 'P', tint: 'var(--c3)', role: 'member', perm: 'edit', since: '5 juni 2026', share: 50 }
      ]
    },
    // Users (Instellingen → Gebruikers, admin only). The admin manages logins, never someone else's accounts.
    users: [
      { name: 'Bert', email: 'bert@jouw-domein.be', role: 'admin', since: '3 juni 2026', me: true },
      { name: 'Partner', email: 'partner@jouw-domein.be', role: 'user', since: '4 juni 2026' }
    ],
    // Trusted devices of the viewer (analysis/concepts/authentication.md#trusted-devices).
    devices: [
      { id: 'd1', name: 'Chrome op Windows', kind: 'laptop', added: '3 juni 2026', last: 'nu', me: true },
      { id: 'd2', name: 'Saldo-app op Pixel 8', kind: 'phone', added: '3 juni 2026', last: 'vandaag 07:41' },
      { id: 'd3', name: 'Firefox op Ubuntu', kind: 'laptop', added: '12 oktober 2026', last: '12 oktober' }
    ]
  };

  const demo = () => (S.shell && S.shell.state.demo) || 'normaal';
  data.demo = demo;
  // Worst connection state for the sidebar dot and Meer: '' (fine), 'warn' (consent expiring, stale) or 'neg' (sync failed).
  data.connectionState = () => (demo() === 'leeg' ? '' : (demo() === 'fout' ? 'neg' : 'warn'));
  // True when the viewer may only read this account (demo state "lezen": Partner set Bert to Lezen on the shared account).
  data.readOnly = (accountId) => demo() === 'lezen' && accountId === 'gedeeld';

  data.groupsFor = (scope) => data.groups.filter((g) => scope === 'alles' || g.scope === scope);
  // An account with the viewer's own edits from Rekeningen applied (name, colour, buffer; localStorage 'saldo.rekeningen').
  data.account = (id) => {
    const a = data.accounts.find((x) => x.id === id);
    let edits = {};
    try { edits = JSON.parse(localStorage.getItem('saldo.rekeningen') || '{}')[id] || {}; } catch (e) { edits = {}; }
    return Object.assign({}, a, edits);
  };
  data.accountsIn = (groupKey) => data.accounts.filter((a) => a.group === groupKey).map((a) => data.account(a.id));
  // Background and text colour for an account's own icon or marker.
  data.accountInk = (a) => ({ bg: 'var(--a-' + a.color + ')', fg: 'var(--onAcc)' });

  S.data = data;
})(window.Saldo = window.Saldo || {});
