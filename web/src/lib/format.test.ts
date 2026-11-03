import { describe, expect, it } from 'vitest';
import { cap, dateFull, dateLong, dateRelative, dateShort, dayHeading, eur, eur0, MINUS, momentLabel, names, parseMoney, timeOf } from './format';

describe('eur', () => {
  it('formats cents the Belgian way with € and a space', () => {
    expect(eur(196882)).toBe('€ 1.968,82');
    expect(eur(0)).toBe('€ 0,00');
    expect(eur(5)).toBe('€ 0,05');
    expect(eur(125000000)).toBe('€ 1.250.000,00');
  });

  it('uses the U+2212 minus sign for negative amounts', () => {
    expect(eur(-8642)).toBe('\u2212€ 86,42');
    expect(eur(-8642).charCodeAt(0)).toBe(0x2212);
    expect(MINUS).toBe('\u2212');
    expect(eur(-8642)).not.toContain('-');
  });

  it('adds + to positive amounts only when signed', () => {
    expect(eur(285000, true)).toBe('+€ 2.850,00');
    expect(eur(285000)).toBe('€ 2.850,00');
    expect(eur(0, true)).toBe('€ 0,00');
    expect(eur(-1850, true)).toBe('\u2212€ 18,50');
  });
});

describe('eur0', () => {
  it('rounds to whole euros for charts and summaries', () => {
    expect(eur0(196882)).toBe('€ 1.969');
    expect(eur0(-103347)).toBe('\u2212€ 1.033');
    expect(eur0(36544, true)).toBe('+€ 365');
    expect(eur0(17900)).toBe('€ 179');
  });
});

describe('dates', () => {
  it('writes the long date of the desktop header', () => {
    expect(dateLong('2026-11-18')).toBe('Woensdag 18 november');
  });

  it('writes short and full dates', () => {
    expect(dateShort('2026-10-02')).toBe('2 okt');
    expect(dateFull('2026-11-18')).toBe('woensdag 18 november 2026');
  });

  it('says vandaag and gisteren relative to today', () => {
    expect(dateRelative('2026-11-18', '2026-11-18')).toBe('vandaag');
    expect(dateRelative('2026-11-17', '2026-11-18')).toBe('gisteren');
    expect(dateRelative('2026-11-02', '2026-11-18')).toBe('2 nov');
  });

  it('builds the day headings of Transacties', () => {
    expect(dayHeading('2026-11-18', '2026-11-18')).toEqual({ main: 'Vandaag', sub: 'woensdag 18 november' });
    expect(dayHeading('2026-11-17', '2026-11-18')).toEqual({ main: 'Gisteren', sub: 'dinsdag 17 november' });
    expect(dayHeading('2026-11-16', '2026-11-18')).toEqual({ main: 'Maandag', sub: '16 november' });
    expect(dayHeading('2025-12-31', '2026-11-18')).toEqual({ main: 'Woensdag', sub: '31 december 2025' });
  });

  it('names a moment for sync lines, in Brussels time', () => {
    const at = (d: string) => d + 'T04:02:00+01:00';
    expect(momentLabel(at('2026-11-18'), '2026-11-18')).toBe('vandaag 04:02');
    expect(momentLabel(at('2026-11-17'), '2026-11-18')).toBe('gisteren 04:02');
    expect(momentLabel(at('2026-11-15'), '2026-11-18')).toBe('zondag 04:02');
    expect(momentLabel(at('2026-11-02'), '2026-11-18')).toBe('2 nov 04:02');
    // The same moment written in UTC, and a time just after midnight in Brussels (still the previous day in UTC).
    expect(momentLabel('2026-11-18T03:02:00Z', '2026-11-18')).toBe('vandaag 04:02');
    expect(momentLabel('2026-11-17T23:30:00Z', '2026-11-18')).toBe('vandaag 00:30');
    expect(timeOf('2026-07-01T02:15:00Z')).toBe('04:15');
  });
});

describe('helpers', () => {
  it('capitalises and lists names', () => {
    expect(cap('maandag')).toBe('Maandag');
    expect(names(['Partner'])).toBe('Partner');
    expect(names(['An', 'Partner', 'Sam'])).toBe('An, Partner en Sam');
  });

  it('parses typed euro amounts to cents', () => {
    expect(parseMoney('900')).toBe(90000);
    expect(parseMoney('1.250')).toBe(125000);
    expect(parseMoney('1.250,50')).toBe(125050);
    expect(parseMoney('€ 64,92')).toBe(6492);
    expect(parseMoney('\u221225,5')).toBe(-2550);
    expect(parseMoney('abc')).toBeNaN();
  });
});
