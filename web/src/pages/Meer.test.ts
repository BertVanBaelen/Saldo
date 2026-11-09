import { describe, expect, it } from 'vitest';
import type { Connection } from '../lib/types';
import { connectionsSub } from './Meer';
import { CONNECTIONS } from '../test/helpers';

const conn = (c: Partial<Connection>): Connection => ({ ...CONNECTIONS[0], ...c });
const now = Date.parse('2026-11-18T20:00:00+01:00');

// The shapes a real link has: no dates while pending, no last sync before the first sync worked.
describe('Meer · bankkoppelingen summary on real data', () => {
  it('names the consent that ends first', () => {
    expect(connectionsSub([conn({}), conn({ id: 2, bank: 'KBC', daysLeft: 90 })], now)).toEqual({ sub: 'Argenta · toestemming nog 12 dagen', tone: 'warn' });
    expect(connectionsSub([conn({ daysLeft: 40 })], now)).toEqual({ sub: 'Argenta · toestemming nog 40 dagen', tone: '' });
    expect(connectionsSub([conn({ daysLeft: 0 })], now)).toEqual({ sub: 'Argenta · toestemming verloopt vandaag', tone: 'warn' });
  });

  it('shows a lapsed consent and a failed or stopped sync in red', () => {
    expect(connectionsSub([conn({ status: 'expired', daysLeft: -1 })], now)).toEqual({ sub: 'Argenta · toestemming verlopen', tone: 'neg' });
    expect(connectionsSub([conn({ status: 'failed' })], now)).toEqual({ sub: 'Argenta · synchronisatie mislukt', tone: 'neg' });
    // Stale for two days is a warning; more than 72 hours without a sync has stopped.
    const stale = conn({ status: 'stale', daysLeft: 60, lastSync: '2026-11-16T20:00:00+01:00' });
    expect(connectionsSub([stale], now)).toEqual({ sub: 'Argenta · toestemming nog 60 dagen', tone: 'warn' });
    expect(connectionsSub([{ ...stale, lastSync: '2026-11-15T19:00:00+01:00' }], now)).toEqual({ sub: 'Argenta · synchronisatie gestopt', tone: 'neg' });
  });

  it('copes with a link without dates or a first sync', () => {
    const pending = conn({ status: 'pending', accounts: [], lastSync: null, since: null, validUntil: null, daysLeft: null });
    expect(connectionsSub([pending], now)).toEqual({ sub: 'Argenta · koppelen niet afgerond', tone: 'warn' });
    const unsynced = conn({ status: 'stale', lastSync: null, daysLeft: null, validUntil: null });
    expect(connectionsSub([unsynced], now)).toEqual({ sub: 'Argenta · gekoppeld', tone: 'warn' });
  });
});
