import { describe, expect, it } from 'vitest';
import { nextManager, syncReportLine } from './accounts';
import type { Account, Member, SyncReport } from './types';

const report: SyncReport = { at: '2026-11-18T04:02:00+01:00', from: '2026-11-02', fetched: 12, added: 0, newest: '2026-11-18', balanceDate: '2026-11-18', idTail: 'a3f9' };

describe('syncReportLine', () => {
  it('says what the bank gave and what Saldo kept', () => {
    expect(syncReportLine(report)).toBe('Laatste synchronisatie: de bank gaf 12 transacties vanaf 2 november, 0 nieuw (nieuwste 18 november), saldo van 18 november · bank-id …a3f9');
  });

  it('counts new transactions', () => {
    expect(syncReportLine({ ...report, added: 5 })).toContain('12 transacties vanaf 2 november, 5 nieuw (nieuwste');
  });

  it('names the whole history when no start date was asked', () => {
    expect(syncReportLine({ ...report, from: null })).toContain('de bank gaf 12 transacties uit de volledige geschiedenis, 0 nieuw');
  });

  it('uses the singular for one transaction', () => {
    expect(syncReportLine({ ...report, fetched: 1, added: 1 })).toContain('de bank gaf 1 transactie vanaf 2 november, 1 nieuw (nieuwste');
  });

  it('says so when the bank gave nothing back', () => {
    expect(syncReportLine({ ...report, fetched: 0, newest: null })).toBe('Laatste synchronisatie: de bank gaf geen transacties terug vanaf 2 november, saldo van 18 november · bank-id …a3f9');
    expect(syncReportLine({ ...report, fetched: 0, from: null, newest: null })).toContain('de bank gaf geen transacties terug uit de volledige geschiedenis, saldo van');
  });

  it('leaves out the newest date and the balance date when the bank gave none', () => {
    expect(syncReportLine({ ...report, newest: null, balanceDate: null })).toBe('Laatste synchronisatie: de bank gaf 12 transacties vanaf 2 november, 0 nieuw · bank-id …a3f9');
  });

  it('has a short form without dates', () => {
    expect(syncReportLine(report, true)).toBe('De bank gaf 12 transacties, 0 nieuw · bank-id …a3f9');
    expect(syncReportLine({ ...report, fetched: 1, added: 1 }, true)).toBe('De bank gaf 1 transactie, 1 nieuw · bank-id …a3f9');
    expect(syncReportLine({ ...report, fetched: 0 }, true)).toBe('De bank gaf geen transacties terug · bank-id …a3f9');
  });
});

describe('nextManager', () => {
  const member = (userId: number, joinedAt: string, me = false): Member => ({ userId, name: 'U' + userId, initial: 'U', role: 'member', permission: 'edit', me, joinedAt });
  const acc = (members: Member[]) => ({ members }) as Account;

  it('is the longest-standing other member, comparing moments and not strings (offsets differ)', () => {
    // 20:30 +02:00 is 18:30 UTC, earlier than 19:00 +00:00, although the text "…T19:00…" sorts before "…T20:30…".
    const list = [member(1, '2026-01-01', true), member(5, '2026-06-03T19:00:00+00:00'), member(3, '2026-06-03T20:30:00+02:00'), member(4, '2026-09-01')];
    expect(nextManager(acc(list))?.userId).toBe(3);
  });

  it('never picks the viewer, even when they joined first, and takes the lower user id on a tie', () => {
    expect(nextManager(acc([member(1, '2026-01-01', true), member(7, '2026-03-01'), member(6, '2026-03-01')]))?.userId).toBe(6);
  });

  it('compares a bare date with a timestamp, and is undefined when nobody else is left', () => {
    expect(nextManager(acc([member(1, '2026-01-01', true), member(2, '2026-03-02T00:00:00+01:00'), member(3, '2026-03-02')]))?.userId).toBe(2);
    expect(nextManager(acc([member(1, '2026-01-01', true)]))).toBeUndefined();
  });
});
