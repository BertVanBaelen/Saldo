// Test fixtures from the demo story (analysis 12) and helpers to render the app with a stubbed API.
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { AppRoutes, Root } from '../App';
import { AppProvider } from '../app/AppContext';
import { api } from '../lib/api';
import type { ImportBatch, ImportCounts, ImportPreview, ImportResult, RowError } from '../lib/imports';
import type {
  Account,
  Alert,
  BalancePoint,
  Connection,
  Device,
  EnableBanking,
  Me,
  Rule,
  RulePreview,
  SimilarPreview,
  SimilarResult,
  Suggestion,
  Transaction,
  TransactionPage,
  TransactionQuery,
  TreeCategory,
  UserList,
} from '../lib/types';

export const ME: Me = {
  user: { id: 1, name: 'Bert', email: 'bert@jouw-domein.be', role: 'admin', initial: 'B' },
  preferences: { scope: 'alles', theme: 'system' },
  today: '2026-11-18',
};

const base: Omit<Account, 'id' | 'name' | 'type' | 'iban' | 'colour' | 'buffer' | 'balance' | 'state'> = {
  source: 'bank',
  kind: 'personal',
  balanceDate: '2026-11-18',
  bank: 'Argenta',
  lastSync: '2026-11-18T04:02:00+01:00',
  syncStatus: 'ok',
  permission: 'edit',
  role: 'manager',
  members: [],
};

export const ZICHT: Account = { ...base, id: 1, name: 'Zichtrekening', type: 'current', iban: 'BE68 •••• •••• 4821', colour: 'green', buffer: 90000, balance: 196882, state: 'ok' };
export const SPAAR: Account = {
  ...base,
  id: 2,
  name: 'Spaarrekening',
  type: 'savings',
  source: 'manual',
  iban: 'BE41 •••• •••• 1196',
  colour: 'orange',
  buffer: 0,
  balance: 1250000,
  balanceDate: '2026-10-02',
  state: null,
  bank: null,
  lastSync: null,
  syncStatus: null,
};
export const GEDEELD: Account = {
  ...base,
  id: 4,
  name: 'Gedeelde rekening',
  type: 'current',
  kind: 'shared',
  iban: 'BE12 •••• •••• 7730',
  colour: 'violet',
  buffer: 60000,
  balance: 94608,
  state: 'ok',
  members: [
    { name: 'Bert', initial: 'B', role: 'manager', permission: 'edit', me: true },
    { name: 'Partner', initial: 'P', role: 'member', permission: 'edit', me: false },
  ],
};
export const ACCOUNTS = [ZICHT, SPAAR, GEDEELD];

const tx = (id: number, bookingDate: string, accountId: number, amount: number, counterparty: string, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  accountId,
  bookingDate,
  amount,
  counterparty,
  communication: 'Bancontact',
  status: 'booked',
  category: null,
  categoryOrigin: null,
  ruleId: null,
  note: null,
  splits: null,
  transfer: false,
  ...extra,
});

export const TRANSACTIONS: Transaction[] = [
  tx(116, '2026-11-18', 1, -2499, 'Bol.com', { status: 'pending', communication: 'Bestelling 4471-2210' }),
  tx(115, '2026-11-18', 4, -8642, 'Colruyt Laagste Prijzen', { category: { id: 2, name: 'Boodschappen', colour: 'c2' }, categoryOrigin: 'rule', ruleId: 3 }),
  tx(114, '2026-11-17', 1, -6210, 'TotalEnergies', { category: { id: 4, name: 'Vervoer', colour: 'c4' }, categoryOrigin: 'manual' }),
  tx(112, '2026-11-17', 1, -840, 'Bakkerij De Graankorrel'),
  tx(111, '2026-11-16', 1, -20000, 'Naar spaarrekening', { transfer: true, category: { id: 9, name: 'Gespaard', colour: 'soft' }, categoryOrigin: 'manual' }),
  tx(110, '2026-11-16', 1, 1850, 'CM Ziekenfonds', { category: { id: 8, name: 'Terugbetaling', colour: 'soft' }, categoryOrigin: 'manual' }),
];

// Invented category tree (GET /api/categories): server order, subcategories after their top.
const cat = (id: number, name: string, colour: TreeCategory['colour'], parentId: number | null = null, type: TreeCategory['type'] = 'expense', icon: string | null = null): TreeCategory => ({
  id,
  name,
  type,
  colour,
  icon,
  parentId,
  count: 0,
});
export const CATEGORIES: TreeCategory[] = [
  cat(1, 'Wonen', 'c1', null, 'expense', 'home'),
  cat(10, 'Energie', 'c1', 1, 'expense', 'bolt'),
  cat(2, 'Boodschappen', 'c2'),
  cat(3, 'Vrije tijd', 'c3'),
  cat(4, 'Vervoer', 'c4'),
  cat(5, 'Abonnementen', 'c5'),
  cat(6, 'Overig', 'c6'),
  cat(7, 'Loon', 'soft', null, 'income'),
  cat(8, 'Terugbetaling', 'soft', null, 'income'),
  cat(9, 'Gespaard', 'soft', null, 'income'),
];
export const RULES: Rule[] = [
  {
    id: 3,
    accountId: 4,
    priority: 0,
    counterparty: 'Colruyt',
    counterpartyExact: false,
    counterpartyIban: null,
    communication: null,
    communicationRegex: false,
    amountMin: null,
    amountMax: null,
    categoryId: 2,
    permission: 'edit',
  },
];
const NO_SKIPS = { manual: 0, import: 0, split: 0, rule: 0 };

export const CONSENT_ALERT: Alert = { kind: 'warn', type: 'consent', title: 'Toestemming verloopt over 12 dagen', note: 'Argenta · opnieuw autoriseren', href: '/bankkoppelingen' };
export const CATEGORISE_ALERT: Alert = { kind: 'ok', type: 'categorise', title: '2 transacties te categoriseren', note: '', href: '/transacties?filter=niet-gecategoriseerd' };

export const CONNECTIONS: Connection[] = [
  { id: 1, bank: 'Argenta', since: '2026-06-03', validUntil: '2026-11-30', daysLeft: 12, lastSync: '2026-11-18T04:02:00+01:00', status: 'ok', accounts: [1, 4] },
];

// Real shapes of what the server sends before anything is known (docs/api.md): nulls, not values.
/** Credentials stored, consent not given: no dates, no accounts. */
export const PENDING: Connection = { id: 3, bank: 'Argenta', since: null, validUntil: null, daysLeft: null, lastSync: null, status: 'pending', accounts: [] };
/** A manual account without a balance yet. */
export const NEW_MANUAL: Account = { ...SPAAR, id: 7, name: 'Vakantiepot', iban: null, balance: 0, balanceDate: null };
/** A bank account whose link was removed with "keep history". */
export const UNLINKED: Account = { ...ZICHT, syncStatus: 'unlinked', lastSync: null, balanceDate: '2026-11-17' };

export const BALANCES: Record<number, BalancePoint[]> = {
  1: [
    { date: '2026-11-16', balance: 210000, origin: 'bank' },
    { date: '2026-11-17', balance: 85000, origin: 'bank' },
    { date: '2026-11-18', balance: 196882, origin: 'bank' },
  ],
  2: [
    { date: '2026-09-02', balance: 1230000, origin: 'manual' },
    { date: '2026-10-02', balance: 1250000, origin: 'manual' },
  ],
};

// Invented devices and users (Instellingen → Toestellen and Gebruikers).
export const DEVICES: Device[] = [
  { id: 3, name: 'Safari op iPhone', createdAt: '2026-06-03T20:14:00+02:00', lastUsedAt: '2026-11-18T08:12:00+01:00', current: true },
  { id: 5, name: 'Firefox op Ubuntu', createdAt: '2026-10-12T19:02:00+02:00', lastUsedAt: '2026-11-16T21:40:00+01:00', current: false },
  { id: 6, name: 'Chrome op Windows', createdAt: '2026-11-01T09:30:00+01:00', lastUsedAt: '2026-11-17T07:41:00+01:00', current: false },
];

export const USERS: UserList = {
  users: [ME.user, { id: 2, name: 'Partner', email: 'partner@example.com', role: 'user', initial: 'P' }],
  invitations: [{ id: 7, email: 'sam@example.com', role: 'user', expiresAt: '2026-11-25T20:14:00+01:00' }],
};

// Invented Enable Banking app (Instellingen → Enable Banking, Bankkoppelingen).
export const EB_ON: EnableBanking = {
  configured: true,
  applicationId: '3f9c2a1e-8b4d-4c6a-9e21-5d7b0a4f1c88',
  redirectUrl: 'https://saldo.jouw-domein.be/bankkoppelingen/terug',
};
export const EB_OFF: EnableBanking = { configured: false, applicationId: null, redirectUrl: 'https://saldo.jouw-domein.be/bankkoppelingen/terug' };

// Invented CSV export (Importeren): the Argenta header layout (11 columns), made-up rows and batches.
export const IMPORT_PREVIEW: ImportPreview = {
  fileName: 'export-zicht.csv',
  delimiter: ';',
  headers: ['Rekening', 'Boekdatum', 'Valutadatum', 'Referentie', 'Beschrijving', 'Bedrag', 'Munt', 'Verrichtingsdatum', 'Rekening tegenpartij', 'Naam tegenpartij', 'Mededeling'],
  encoding: 'utf-8',
  mapping: {
    account: 0, date: 1, valueDate: 2, amount: 5, currency: 6, counterpartyIban: 8, counterparty: 9, communication: 10,
    note: null, category: null, subcategory: null, accountName: null, counterpartyFallback: null,
  },
  preset: 'argenta',
  totalRows: 31,
  sample: [
    ['BE68 5390 0754 7034', '02/11/2026', '02/11/2026', 'REF-0001', 'Betaling met bankkaart', '-8,40', 'EUR', '01/11/2026', 'BE71 0961 2345 6769', 'Bakkerij De Graankorrel', 'Bancontact'],
    ['BE68 5390 0754 7034', '01/11/2026', '01/11/2026', 'REF-0002', 'Overschrijving', '2.784,50', 'EUR', '01/11/2026', 'BE62 5100 0754 7061', 'Atelier Noord bv', 'Loon oktober'],
    ['BE68 5390 0754 7034', '31/10/2026', '31/10/2026', 'REF-0003', 'Betaling met bankkaart', '-64,12', 'EUR', '30/10/2026', '', 'Colruyt Laagste Prijzen', ''],
  ],
  accounts: [],
  categories: [],
  counts: null,
  errors: [],
};
export const IMPORT_COUNTS: ImportCounts = { rows: 31, new: 29, present: 1, invalid: 1, overlap: 0 };
export const IMPORT_ERRORS: RowError[] = [{ line: 7, message: 'Het bedrag is niet leesbaar.' }];
export const BATCHES: ImportBatch[] = [
  { id: 3, source: 'argenta', fileName: 'argenta-zicht-oktober.csv', accountId: 1, createdAt: '2026-11-12T20:30:00+01:00', imported: 42, present: 0, invalid: 0, undoneAt: null },
  { id: 2, source: 'csv', fileName: 'spaarrekening-2025.csv', accountId: 2, createdAt: '2025-12-30T19:02:00+01:00', imported: 12, present: 0, invalid: 1, undoneAt: null },
];
export const importResult = (fileName: string, accountId: number): ImportResult => ({
  batches: [{ id: 12, source: 'argenta', fileName, accountId, createdAt: '2026-11-18T20:00:00+01:00', imported: 29, present: 1, invalid: 1, undoneAt: null }],
  errors: IMPORT_ERRORS,
});

interface Stub {
  accounts?: Account[];
  /** A list, or a page per query (`total` defaults to the page's rows). */
  transactions?: Transaction[] | ((q: TransactionQuery) => Omit<TransactionPage, 'total'> & { total?: number });
  alerts?: Alert[];
  connections?: Connection[];
  balances?: Record<number, BalancePoint[]>;
  devices?: Device[];
  enableBanking?: EnableBanking;
  imports?: ImportBatch[];
  categories?: TreeCategory[];
  /** GET /api/transactions/{id}/similar; default 14 others, nothing skipped. */
  similar?: Partial<SimilarPreview>;
  /** POST /api/transactions/{id}/similar; default a new rule, 14 others updated. */
  applied?: Partial<Omit<SimilarResult, 'transaction' | 'rule'>>;
  rules?: Rule[];
  suggestions?: Suggestion[];
  /** POST /api/rules/preview; default 14 matches, 3 changes. */
  preview?: Partial<RulePreview>;
}

/** Stubs every API call; the spies are restored after each test (restoreMocks). */
export function stubApi(s: Stub = {}) {
  const list = s.transactions ?? TRANSACTIONS;
  // The server's shape: `total` counts every matching row, `limit` cuts the page.
  const page = (q: TransactionQuery): TransactionPage => {
    if (typeof list === 'function') {
      const p = list(q);
      return { ...p, total: p.total ?? p.items.length };
    }
    const items = list.filter(
      (t) =>
        (!q.uncategorised || (!t.category && !t.transfer)) &&
        (!q.account || t.accountId === q.account) &&
        (!q.from || t.bookingDate >= q.from) &&
        (!q.to || t.bookingDate <= q.to),
    );
    return { items: items.slice(0, q.limit ?? 50), next: null, total: items.length };
  };
  // Mutations answer like the server: from the fixture row, with the change applied.
  const rowOf = (id: number) => structuredClone((Array.isArray(list) ? list : TRANSACTIONS).find((t) => t.id === id)!);
  const categoryOf = (id: number) => {
    const c = (s.categories ?? CATEGORIES).find((x) => x.id === id)!;
    return { id: c.id, name: c.name, colour: c.colour };
  };
  return {
    categories: vi.spyOn(api, 'categories').mockImplementation(async () => structuredClone(s.categories ?? CATEGORIES)),
    rules: vi.spyOn(api, 'rules').mockImplementation(async () => structuredClone(s.rules ?? RULES)),
    updateTransaction: vi.spyOn(api, 'updateTransaction').mockImplementation(async (id, patch) => {
      const t = rowOf(id);
      if (patch.categoryId !== undefined) Object.assign(t, { category: categoryOf(patch.categoryId), categoryOrigin: 'manual', ruleId: null });
      if (patch.note !== undefined) t.note = (patch.note ?? '').replace(/\s+/g, ' ').trim() || null;
      return t;
    }),
    similarPreview: vi.spyOn(api, 'similarPreview').mockImplementation(async (id) => ({
      counterparty: rowOf(id).counterparty,
      scope: 'user',
      count: 14,
      skipped: NO_SKIPS,
      ...s.similar,
    })),
    applySimilar: vi.spyOn(api, 'applySimilar').mockImplementation(async (id) => {
      const t = rowOf(id);
      return {
        transaction: { ...t, categoryOrigin: 'manual', ruleId: null },
        rule: { ...RULES[0], id: 12, accountId: null, counterparty: t.counterparty, categoryId: t.category!.id },
        ruleCreated: true,
        updated: 14,
        skipped: NO_SKIPS,
        ...s.applied,
      };
    }),
    splitTransaction: vi.spyOn(api, 'splitTransaction').mockImplementation(async (id, parts) => ({
      ...rowOf(id),
      category: null,
      categoryOrigin: null,
      ruleId: null,
      splits: parts.map((p) => ({ category: categoryOf(p.categoryId), amount: p.amount })),
    })),
    unsplitTransaction: vi.spyOn(api, 'unsplitTransaction').mockImplementation(async (id) => ({ ...rowOf(id), splits: null })),
    accounts: vi.spyOn(api, 'accounts').mockImplementation(async () => structuredClone(s.accounts ?? ACCOUNTS)),
    transactions: vi.spyOn(api, 'transactions').mockImplementation(async (q = {}) => page(q)),
    alerts: vi.spyOn(api, 'alerts').mockResolvedValue(s.alerts ?? [CONSENT_ALERT, CATEGORISE_ALERT]),
    connections: vi.spyOn(api, 'connections').mockResolvedValue(s.connections ?? CONNECTIONS),
    savePreferences: vi.spyOn(api, 'savePreferences').mockImplementation(async (p) => ({ ...ME.preferences, ...p })),
    sync: vi.spyOn(api, 'sync').mockResolvedValue({ started: true }),
    // As in demo mode: the sync is done before the first poll.
    syncStatus: vi.spyOn(api, 'syncStatus').mockImplementation(async () => ({
      running: false,
      startedAt: '2026-11-18T20:00:00+01:00',
      finishedAt: '2026-11-18T20:00:01+01:00',
      connections: (s.connections ?? CONNECTIONS).map((c) => ({ id: c.id, status: c.status, lastSync: c.lastSync, error: null })),
    })),
    updateAccount: vi.spyOn(api, 'updateAccount').mockImplementation(async (id, patch) => ({ ...(s.accounts ?? ACCOUNTS).find((a) => a.id === id)!, ...patch })),
    devices: vi.spyOn(api, 'devices').mockImplementation(async () => structuredClone(s.devices ?? DEVICES)),
    users: vi.spyOn(api, 'users').mockImplementation(async () => structuredClone(USERS)),
    enableBanking: vi.spyOn(api, 'enableBanking').mockImplementation(async () => structuredClone(s.enableBanking ?? EB_ON)),
    balances: vi.spyOn(api, 'balances').mockImplementation(async (id) => structuredClone((s.balances ?? BALANCES)[id] ?? [])),
    createAccount: vi.spyOn(api, 'createAccount').mockImplementation(async (b) => ({
      ...NEW_MANUAL,
      id: 9,
      name: b.name,
      type: b.type,
      colour: b.colour ?? 'green',
      buffer: b.buffer ?? 0,
      balance: b.balance ?? 0,
      balanceDate: b.balance === undefined ? null : ME.today,
      state: b.type === 'current' ? 'ok' : null,
    })),
    setBalance: vi.spyOn(api, 'setBalance').mockImplementation(async (id, balance, date) => ({ ...(s.accounts ?? ACCOUNTS).find((a) => a.id === id)!, balance, balanceDate: date ?? ME.today })),
    deleteAccount: vi.spyOn(api, 'deleteAccount').mockResolvedValue(null),
    imports: vi.spyOn(api, 'imports').mockImplementation(async () => structuredClone(s.imports ?? BATCHES)),
    // Counts only when both the account and the mapping are sent, as the server does.
    previewImport: vi.spyOn(api, 'previewImport').mockImplementation(async (file, o = {}) => ({
      ...structuredClone(IMPORT_PREVIEW),
      fileName: file.name,
      ...(o.target !== undefined && o.mapping ? { mapping: o.mapping, counts: IMPORT_COUNTS, errors: IMPORT_ERRORS } : {}),
    })),
    importFile: vi.spyOn(api, 'importFile').mockImplementation(async (file, target) => importResult(file.name, typeof target === 'number' ? target : Object.values(target)[0])),
    undoPreview: vi.spyOn(api, 'undoPreview').mockResolvedValue({ batches: 1, rows: 42, changed: 3, categorised: 30 }),
    undoImport: vi.spyOn(api, 'undoImport').mockResolvedValue({ batches: 1, removed: 42 }),
    removeConnection: vi.spyOn(api, 'removeConnection').mockImplementation(async (_id, history) => (history === 'delete' ? { deleted: [1], kept: [4] } : { deleted: [], kept: [1, 4] })),
    // Categorieën en regels (0.4-4): answers like the server, from the stub's lists.
    suggestions: vi.spyOn(api, 'suggestions').mockImplementation(async () => structuredClone(s.suggestions ?? [])),
    confirmSuggestion: vi.spyOn(api, 'confirmSuggestion').mockImplementation(async (key) => ({
      updated: (s.suggestions ?? []).find((x) => x.counterpartyKey === key)?.open ?? 0,
      rule: { id: 12, created: true, conflict: false },
    })),
    dismissSuggestion: vi.spyOn(api, 'dismissSuggestion').mockResolvedValue(null),
    createCategory: vi.spyOn(api, 'createCategory').mockImplementation(async (b) => {
      const parent = b.parentId === undefined ? undefined : (s.categories ?? CATEGORIES).find((c) => c.id === b.parentId);
      return { id: 40, name: b.name, type: parent?.type ?? b.type ?? 'expense', colour: parent?.colour ?? b.colour ?? (b.type === 'income' ? 'soft' : 'c6'), icon: b.icon ?? null, parentId: b.parentId ?? null, count: 0 };
    }),
    updateCategory: vi.spyOn(api, 'updateCategory').mockImplementation(async (id, patch) => ({ ...(s.categories ?? CATEGORIES).find((c) => c.id === id)!, ...patch }) as TreeCategory),
    deleteCategory: vi.spyOn(api, 'deleteCategory').mockResolvedValue(null),
    createRule: vi.spyOn(api, 'createRule').mockImplementation(async (b) => ({ ...RULES[0], ...b, id: 30, priority: 0, categoryId: b.categoryId!, accountId: b.accountId ?? null, permission: 'edit' }) as Rule),
    updateRule: vi.spyOn(api, 'updateRule').mockImplementation(async (id, b) => ({ ...(s.rules ?? RULES).find((r) => r.id === id)!, ...b }) as Rule),
    deleteRule: vi.spyOn(api, 'deleteRule').mockResolvedValue(null),
    previewRule: vi.spyOn(api, 'previewRule').mockImplementation(async () => ({ matches: 14, changes: 3, skipped: NO_SKIPS, ...s.preview })),
    applyRule: vi.spyOn(api, 'applyRule').mockResolvedValue({ updated: 3, skipped: NO_SKIPS }),
    // The editable rules in the order sent, in the places of the editable rules; read-only ones stay put.
    reorderRules: vi.spyOn(api, 'reorderRules').mockImplementation(async (ids) => {
      const list = structuredClone(s.rules ?? RULES);
      const queue = ids.map((id) => list.find((r) => r.id === id)!);
      return list.map((r) => (r.permission === 'edit' ? queue.shift()! : r));
    }),
  };
}

function Where() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}

/** The whole app with its public pages and the sign-in gate (GET /api/me), at `path`. */
export function renderRoot(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Root />
      <Where />
    </MemoryRouter>,
  );
}

/** The signed-in app at `path`; `strict` renders in React's StrictMode (effects run twice, as in development). */
export function renderAt(path: string, me: Me = ME, strict = false) {
  return render(
    <AppProvider me={me}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Where />
      </MemoryRouter>
    </AppProvider>,
    { reactStrictMode: strict },
  );
}
