// Test fixtures from the demo story (analysis 12) and helpers to render the app with a stubbed API.
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { AppRoutes, Root } from '../App';
import { AppProvider } from '../app/AppContext';
import { api } from '../lib/api';
import type { Account, Alert, Connection, Device, Me, Transaction, TransactionPage, TransactionQuery, UserList } from '../lib/types';

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
  transfer: false,
  ...extra,
});

export const TRANSACTIONS: Transaction[] = [
  tx(116, '2026-11-18', 1, -2499, 'Bol.com', { status: 'pending', communication: 'Bestelling 4471-2210' }),
  tx(115, '2026-11-18', 4, -8642, 'Colruyt Laagste Prijzen', { category: { id: 2, name: 'Boodschappen', colour: 'c2' } }),
  tx(114, '2026-11-17', 1, -6210, 'TotalEnergies', { category: { id: 4, name: 'Vervoer', colour: 'c4' } }),
  tx(112, '2026-11-17', 1, -840, 'Bakkerij De Graankorrel'),
  tx(111, '2026-11-16', 1, -20000, 'Naar spaarrekening', { transfer: true, category: { id: 9, name: 'Gespaard', colour: 'soft' } }),
  tx(110, '2026-11-16', 1, 1850, 'CM Ziekenfonds', { category: { id: 8, name: 'Terugbetaling', colour: 'soft' } }),
];

export const CONSENT_ALERT: Alert = { kind: 'warn', type: 'consent', title: 'Toestemming verloopt over 12 dagen', note: 'Argenta · opnieuw autoriseren', href: '/bankkoppelingen' };
export const CATEGORISE_ALERT: Alert = { kind: 'ok', type: 'categorise', title: '2 transacties te categoriseren', note: '', href: '/transacties?filter=niet-gecategoriseerd' };

export const CONNECTIONS: Connection[] = [
  { id: 1, bank: 'Argenta', since: '2026-06-03', validUntil: '2026-11-30', daysLeft: 12, lastSync: '2026-11-18T04:02:00+01:00', status: 'ok', accounts: [1, 4] },
];

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

interface Stub {
  accounts?: Account[];
  transactions?: Transaction[] | ((q: TransactionQuery) => TransactionPage);
  alerts?: Alert[];
  connections?: Connection[];
  devices?: Device[];
}

/** Stubs every API call; the spies are restored after each test (restoreMocks). */
export function stubApi(s: Stub = {}) {
  const list = s.transactions ?? TRANSACTIONS;
  const page = (q: TransactionQuery): TransactionPage => {
    if (typeof list === 'function') return list(q);
    const items = list.filter((t) => !q.uncategorised || (!t.category && !t.transfer));
    return { items, next: null };
  };
  return {
    accounts: vi.spyOn(api, 'accounts').mockImplementation(async () => structuredClone(s.accounts ?? ACCOUNTS)),
    transactions: vi.spyOn(api, 'transactions').mockImplementation(async (q = {}) => page(q)),
    alerts: vi.spyOn(api, 'alerts').mockResolvedValue(s.alerts ?? [CONSENT_ALERT, CATEGORISE_ALERT]),
    connections: vi.spyOn(api, 'connections').mockResolvedValue(s.connections ?? CONNECTIONS),
    savePreferences: vi.spyOn(api, 'savePreferences').mockImplementation(async (p) => ({ ...ME.preferences, ...p })),
    sync: vi.spyOn(api, 'sync').mockResolvedValue({ started: true }),
    updateAccount: vi.spyOn(api, 'updateAccount').mockImplementation(async (id, patch) => ({ ...(s.accounts ?? ACCOUNTS).find((a) => a.id === id)!, ...patch })),
    devices: vi.spyOn(api, 'devices').mockImplementation(async () => structuredClone(s.devices ?? DEVICES)),
    users: vi.spyOn(api, 'users').mockImplementation(async () => structuredClone(USERS)),
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

export function renderAt(path: string, me: Me = ME) {
  return render(
    <AppProvider me={me}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Where />
      </MemoryRouter>
    </AppProvider>,
  );
}
