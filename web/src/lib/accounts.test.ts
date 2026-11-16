import { describe, expect, it } from 'vitest';
import { syncReportLine } from './accounts';
import type { SyncReport } from './types';

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
