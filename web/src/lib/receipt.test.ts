import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, receiptPath } from './api';
import {
  bonHref,
  bonTarget,
  budgetText,
  canGoNext,
  emptyText,
  footerText,
  isBonKind,
  isBonPeriod,
  isDate,
  overzichtRangeHref,
  paperLabel,
  parseAccount,
  periodEnd,
  periodStart,
  plain,
  previousText,
  rangeLabel,
  shiftPeriod,
  stepLabel,
  switchPeriod,
  trendText,
} from './receipt';
import { columns } from './reports';

describe('period maths', () => {
  it('accepts real dates only', () => {
    expect(['2026-11-09', '2028-02-29', '2026-12-31'].map(isDate)).toEqual([true, true, true]);
    expect(['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '26-11-09', '2026-1-9', '', null, undefined, '1850-01-01'].map(isDate)).toEqual([false, false, false, false, false, false, false, false, false, false]);
  });

  it('starts a week on the Monday and a month on the 1st', () => {
    expect(periodStart('week', '2026-11-09')).toBe('2026-11-09'); // a Monday
    expect(periodStart('week', '2026-11-15')).toBe('2026-11-09'); // the Sunday of that week
    expect(periodStart('week', '2026-11-18')).toBe('2026-11-16');
    expect(periodStart('week', '2026-01-01')).toBe('2025-12-29'); // week 1 of 2026 starts in 2025
    expect(periodStart('week', '2028-02-29')).toBe('2028-02-28');
    expect(periodStart('maand', '2026-10-17')).toBe('2026-10-01');
  });

  it('ends a week on the Sunday and a month on its last day', () => {
    expect(periodEnd('week', '2026-11-09')).toBe('2026-11-15');
    expect(periodEnd('week', '2025-12-29')).toBe('2026-01-04');
    expect(periodEnd('maand', '2026-10-01')).toBe('2026-10-31');
    expect(periodEnd('maand', '2026-02-01')).toBe('2026-02-28');
    expect(periodEnd('maand', '2028-02-01')).toBe('2028-02-29');
    expect(periodEnd('maand', '2026-12-01')).toBe('2026-12-31');
  });

  it('steps a period back and forward, over month and year ends', () => {
    expect(shiftPeriod('week', '2026-11-09', -1)).toBe('2026-11-02');
    expect(shiftPeriod('week', '2026-11-12', 1)).toBe('2026-11-16'); // from any day of the week
    expect(shiftPeriod('week', '2026-12-28', 1)).toBe('2027-01-04');
    expect(shiftPeriod('week', '2026-01-05', -1)).toBe('2025-12-29');
    expect(shiftPeriod('maand', '2026-11-01', -1)).toBe('2026-10-01');
    expect(shiftPeriod('maand', '2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftPeriod('maand', '2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftPeriod('maand', '2026-03-31', 1)).toBe('2026-04-01');
  });

  it('never goes past the running period', () => {
    // Today is Wednesday 18 November 2026: the running week starts 16 Nov, the running month 1 Nov.
    expect(canGoNext('week', '2026-11-09', '2026-11-18')).toBe(true);
    expect(canGoNext('week', '2026-11-16', '2026-11-18')).toBe(false);
    expect(canGoNext('week', '2026-11-16', '2026-11-23')).toBe(true); // Monday 23 Nov: the next week has begun
    expect(canGoNext('maand', '2026-10-01', '2026-11-18')).toBe(true);
    expect(canGoNext('maand', '2026-11-01', '2026-11-18')).toBe(false);
    expect(canGoNext('maand', '2026-11-01', '2026-11-30')).toBe(false);
    expect(canGoNext('maand', '2026-11-01', '2026-12-01')).toBe(true);
  });

  it('changes the kind: a week becomes the month of its Monday, a month the week of its last day (the running week for the running month)', () => {
    expect(switchPeriod('week', 'maand', '2026-11-09', '2026-11-18')).toBe('2026-11-01');
    expect(switchPeriod('week', 'maand', '2026-10-26', '2026-11-18')).toBe('2026-10-01'); // 26 okt – 1 nov: the month of its Monday
    expect(switchPeriod('maand', 'week', '2026-10-01', '2026-11-18')).toBe('2026-10-26'); // 31 Oct is a Saturday
    expect(switchPeriod('maand', 'week', '2026-09-01', '2026-11-18')).toBe('2026-09-28');
    expect(switchPeriod('maand', 'week', '2026-11-01', '2026-11-18')).toBe('2026-11-16'); // the running month: this week
    // A period after the running one (a URL typed by hand) lands on the running one.
    expect(switchPeriod('maand', 'week', '2027-03-01', '2026-11-18')).toBe('2026-11-16');
    expect(switchPeriod('week', 'maand', '2027-03-08', '2026-11-18')).toBe('2026-11-01');
  });

  it('labels a period by its dates', () => {
    expect(rangeLabel('week', '2026-11-09')).toBe('9–15 nov 2026');
    expect(rangeLabel('week', '2026-10-26')).toBe('26 okt – 1 nov 2026');
    expect(rangeLabel('week', '2025-12-29')).toBe('29 dec 2025 – 4 jan 2026');
    expect(rangeLabel('maand', '2026-10-01')).toBe('oktober 2026');
  });
});

describe('period maths · quarters, years and custom ranges', () => {
  it('knows the five kinds, and which of them step', () => {
    expect(['week', 'maand', 'kwartaal', 'jaar', 'eigen'].map(isBonPeriod)).toEqual([true, true, true, true, true]);
    expect([undefined, null, '', 'dag', 'Maand'].map(isBonPeriod)).toEqual([false, false, false, false, false]);
    expect(['week', 'maand', 'kwartaal', 'jaar', 'eigen'].map(isBonKind)).toEqual([true, true, true, true, false]);
  });

  it('starts a quarter on 1 Jan, 1 Apr, 1 Jul or 1 Oct, a year on 1 Jan and a custom range on the 1st of its first month', () => {
    expect(['2026-01-01', '2026-03-31', '2026-02-15'].map((d) => periodStart('kwartaal', d))).toEqual(['2026-01-01', '2026-01-01', '2026-01-01']);
    expect(['2026-04-01', '2026-05-31', '2026-06-30'].map((d) => periodStart('kwartaal', d))).toEqual(['2026-04-01', '2026-04-01', '2026-04-01']);
    expect(['2026-07-01', '2026-08-15', '2026-09-30'].map((d) => periodStart('kwartaal', d))).toEqual(['2026-07-01', '2026-07-01', '2026-07-01']);
    expect(['2026-10-01', '2026-12-31'].map((d) => periodStart('kwartaal', d))).toEqual(['2026-10-01', '2026-10-01']);
    expect(['2026-01-01', '2026-11-18', '2026-12-31'].map((d) => periodStart('jaar', d))).toEqual(['2026-01-01', '2026-01-01', '2026-01-01']);
    expect(periodStart('eigen', '2026-05-17')).toBe('2026-05-01');
    expect(periodStart('eigen', '2026-05-01')).toBe('2026-05-01');
  });

  it('ends a quarter on its last day (30 or 31), a year on 31 Dec and a custom range on the last day of the month of its tot', () => {
    expect(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'].map((s) => periodEnd('kwartaal', s))).toEqual(['2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31']);
    expect(periodEnd('jaar', '2026-01-01')).toBe('2026-12-31');
    expect(periodEnd('eigen', '2026-05-01', '2026-10-17')).toBe('2026-10-31');
    expect(periodEnd('eigen', '2026-05-01', '2026-10-31')).toBe('2026-10-31');
    expect(periodEnd('eigen', '2026-05-01', '2026-05-02')).toBe('2026-05-31'); // one month
    // February: 28 days, and 29 in a leap year; the leap year's first quarter still ends on 31 March.
    expect(periodEnd('eigen', '2026-01-01', '2026-02-10')).toBe('2026-02-28');
    expect(periodEnd('eigen', '2028-01-01', '2028-02-10')).toBe('2028-02-29');
    expect(periodEnd('eigen', '2100-01-01', '2100-02-10')).toBe('2100-02-28'); // 2100 is no leap year
    expect(periodEnd('kwartaal', '2028-01-01')).toBe('2028-03-31');
    expect(periodEnd('eigen', '2026-05-01')).toBe('2026-05-31'); // without a tot: the first month alone
  });

  it('steps a quarter by 3 months and a year by 12, over year ends', () => {
    expect(shiftPeriod('kwartaal', '2026-08-15', -1)).toBe('2026-04-01');
    expect(shiftPeriod('kwartaal', '2026-08-15', 1)).toBe('2026-10-01');
    expect(shiftPeriod('kwartaal', '2026-10-31', 1)).toBe('2027-01-01');
    expect(shiftPeriod('kwartaal', '2026-02-10', -1)).toBe('2025-10-01');
    expect(shiftPeriod('kwartaal', '2028-01-01', -1)).toBe('2027-10-01');
    expect(shiftPeriod('jaar', '2026-11-18', -1)).toBe('2025-01-01');
    expect(shiftPeriod('jaar', '2026-11-18', 1)).toBe('2027-01-01');
    expect(shiftPeriod('jaar', '2028-12-31', 1)).toBe('2029-01-01');
    expect(shiftPeriod('jaar', '2028-02-29', -1)).toBe('2027-01-01'); // from a leap day
  });

  it('never goes past the running quarter or year', () => {
    // Today is Wednesday 18 November 2026: the running quarter is the 4th (from 1 Oct), the running year 2026.
    expect(canGoNext('kwartaal', '2026-07-01', '2026-11-18')).toBe(true);
    expect(canGoNext('kwartaal', '2026-10-01', '2026-11-18')).toBe(false);
    expect(canGoNext('kwartaal', '2026-10-01', '2026-12-31')).toBe(false);
    expect(canGoNext('kwartaal', '2026-10-01', '2027-01-01')).toBe(true); // the first day of the next quarter
    expect(canGoNext('jaar', '2025-01-01', '2026-11-18')).toBe(true);
    expect(canGoNext('jaar', '2026-01-01', '2026-11-18')).toBe(false);
    expect(canGoNext('jaar', '2026-01-01', '2026-12-31')).toBe(false);
    expect(canGoNext('jaar', '2026-01-01', '2027-01-01')).toBe(true);
  });

  it('switches to the period of the new kind that holds the anchor: the last day when going smaller, the first day when going bigger', () => {
    const today = '2026-11-18';
    // Smaller: the last day of the current period, the week or month or quarter that holds it.
    expect(switchPeriod('kwartaal', 'maand', '2026-07-01', today)).toBe('2026-09-01');
    expect(switchPeriod('kwartaal', 'week', '2026-07-01', today)).toBe('2026-09-28'); // 30 Sep is a Wednesday
    expect(switchPeriod('jaar', 'kwartaal', '2025-01-01', today)).toBe('2025-10-01');
    expect(switchPeriod('jaar', 'maand', '2025-01-01', today)).toBe('2025-12-01');
    expect(switchPeriod('jaar', 'week', '2025-01-01', today)).toBe('2025-12-29'); // 31 Dec 2025 is a Wednesday of the week that starts in 2025
    // Bigger: the first day of the current period.
    expect(switchPeriod('maand', 'kwartaal', '2026-08-01', today)).toBe('2026-07-01');
    expect(switchPeriod('maand', 'kwartaal', '2026-09-01', today)).toBe('2026-07-01');
    expect(switchPeriod('maand', 'jaar', '2025-12-01', today)).toBe('2025-01-01');
    expect(switchPeriod('week', 'kwartaal', '2026-09-28', today)).toBe('2026-07-01'); // the Monday decides, not the Wednesday
    expect(switchPeriod('week', 'jaar', '2025-12-29', today)).toBe('2025-01-01'); // a week of two years: its Monday's year
    expect(switchPeriod('kwartaal', 'jaar', '2025-10-01', today)).toBe('2025-01-01');
    // The same kind of period goes to itself.
    expect(switchPeriod('maand', 'maand', '2026-08-01', today)).toBe('2026-08-01');
  });

  it('never switches past the running period: the running period of the new kind', () => {
    const today = '2026-11-18'; // a Wednesday; the running week starts on 16 Nov, the quarter on 1 Oct, the year on 1 Jan
    expect(switchPeriod('jaar', 'kwartaal', '2026-01-01', today)).toBe('2026-10-01'); // the running year's last day is ahead: today's quarter
    expect(switchPeriod('jaar', 'maand', '2026-01-01', today)).toBe('2026-11-01');
    expect(switchPeriod('jaar', 'week', '2026-01-01', today)).toBe('2026-11-16');
    expect(switchPeriod('kwartaal', 'maand', '2026-10-01', today)).toBe('2026-11-01');
    expect(switchPeriod('kwartaal', 'week', '2026-10-01', today)).toBe('2026-11-16');
    // A period after today's (a URL typed by hand) lands on the running one, for a bigger kind too.
    expect(switchPeriod('maand', 'kwartaal', '2027-03-01', today)).toBe('2026-10-01');
    expect(switchPeriod('week', 'jaar', '2027-03-08', today)).toBe('2026-01-01');
    expect(switchPeriod('kwartaal', 'week', '2027-04-01', today)).toBe('2026-11-16');
    // On the last day of the year the running quarter and the running month are the last ones.
    expect(switchPeriod('jaar', 'maand', '2026-01-01', '2026-12-31')).toBe('2026-12-01');
    expect(switchPeriod('jaar', 'week', '2026-01-01', '2026-12-31')).toBe('2026-12-28');
  });

  it('switches from a custom range to the kind that holds its last day, clamped to the running period', () => {
    const today = '2026-11-18';
    expect(switchPeriod('eigen', 'maand', '2026-05-01', today, '2026-10-31')).toBe('2026-10-01');
    expect(switchPeriod('eigen', 'kwartaal', '2026-05-01', today, '2026-10-31')).toBe('2026-10-01');
    expect(switchPeriod('eigen', 'jaar', '2025-05-01', today, '2025-10-31')).toBe('2025-01-01');
    expect(switchPeriod('eigen', 'week', '2026-05-01', today, '2026-10-31')).toBe('2026-10-26'); // 31 Oct is a Saturday
    // A range that runs to the end of the running month: today's period of that kind.
    expect(switchPeriod('eigen', 'maand', '2026-08-01', today, '2026-11-30')).toBe('2026-11-01');
    expect(switchPeriod('eigen', 'week', '2026-08-01', today, '2026-11-30')).toBe('2026-11-16');
    expect(switchPeriod('eigen', 'kwartaal', '2026-08-01', today, '2026-11-30')).toBe('2026-10-01');
    // The tot of any day inside its month is the same range.
    expect(switchPeriod('eigen', 'maand', '2026-05-01', today, '2026-10-05')).toBe('2026-10-01');
  });

  it('labels the new kinds by their dates, in the words of the server', () => {
    expect(rangeLabel('kwartaal', '2026-07-01')).toBe('3e kwartaal 2026 · jul–sep');
    expect(rangeLabel('kwartaal', '2026-01-01')).toBe('1e kwartaal 2026 · jan–mrt');
    expect(rangeLabel('kwartaal', '2026-04-01')).toBe('2e kwartaal 2026 · apr–jun');
    expect(rangeLabel('kwartaal', '2026-10-01')).toBe('4e kwartaal 2026 · okt–dec');
    expect(rangeLabel('jaar', '2026-01-01')).toBe('Jaar 2026');
    expect(rangeLabel('eigen', '2026-05-01', '2026-10-31')).toBe('Mei – oktober 2026');
    expect(rangeLabel('eigen', '2026-05-01', '2026-10-05')).toBe('Mei – oktober 2026');
    expect(rangeLabel('eigen', '2026-10-01', '2026-10-31')).toBe('Oktober 2026'); // one month: as a month
    expect(rangeLabel('eigen', '2025-11-01', '2026-10-31')).toBe('Nov 2025 – okt 2026'); // across years
  });
});

describe('the account of the URL', () => {
  it('is a positive whole number or nothing', () => {
    expect(['1', '4', '123456789'].map(parseAccount)).toEqual([1, 4, 123456789]);
    for (const bad of ['0', '-1', '01', '1.5', '4a', 'abc', '', ' 4', '1234567890', null, undefined]) expect(parseAccount(bad)).toBeUndefined();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('the request', () => {
  it('sends the end of a custom range between the date and the scope', () => {
    expect(receiptPath({ periode: 'eigen', van: '2026-05-01', tot: '2026-10-31', scope: 'alles' })).toBe('/api/reports/receipt?periode=eigen&van=2026-05-01&tot=2026-10-31&scope=alles');
    expect(receiptPath({ periode: 'kwartaal', van: '2026-07-01', scope: 'gedeeld', account: 4 })).toBe('/api/reports/receipt?periode=kwartaal&van=2026-07-01&scope=gedeeld&account=4');
    expect(receiptPath({ periode: 'jaar', van: '2026-01-01', scope: 'persoonlijk' })).toBe('/api/reports/receipt?periode=jaar&van=2026-01-01&scope=persoonlijk');
  });

  it('always sends the period, the date and the scope, and the account when there is one', async () => {
    expect(receiptPath({ periode: 'week', van: '2026-11-09', scope: 'alles' })).toBe('/api/reports/receipt?periode=week&van=2026-11-09&scope=alles');
    expect(receiptPath({ periode: 'maand', van: '2026-10-01', scope: 'gedeeld', account: 4 })).toBe('/api/reports/receipt?periode=maand&van=2026-10-01&scope=gedeeld&account=4');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ period: 'week', empty: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(api.receipt({ periode: 'week', van: '2026-11-09', scope: 'persoonlijk' })).resolves.toMatchObject({ empty: true });
    expect(fetch).toHaveBeenCalledWith('/api/reports/receipt?periode=week&van=2026-11-09&scope=persoonlijk', expect.objectContaining({ method: 'GET' }));
  });
});

describe('links', () => {
  it('links to the receipt with the scope of the page that links, and the account when there is one', () => {
    expect(bonHref('maand', '2026-10-01', 'alles')).toBe('/overzicht/bon/maand/2026-10-01?scope=alles');
    expect(bonHref('week', '2026-11-09', 'persoonlijk')).toBe('/overzicht/bon/week/2026-11-09?scope=persoonlijk');
    expect(bonHref('jaar', '2026-01-01', 'gedeeld', { account: 4 })).toBe('/overzicht/bon/jaar/2026-01-01?scope=gedeeld&rekening=4');
    expect(bonHref('kwartaal', '2026-07-01', 'alles', { account: undefined })).toBe('/overzicht/bon/kwartaal/2026-07-01?scope=alles');
  });

  it('writes the end of a custom range into the link: tot first, then the scope and the account', () => {
    expect(bonHref('eigen', '2026-05-01', 'alles', { tot: '2026-10-31' })).toBe('/overzicht/bon/eigen/2026-05-01?tot=2026-10-31&scope=alles');
    expect(bonHref('eigen', '2026-05-01', 'persoonlijk', { tot: '2026-10-31', account: 1 })).toBe('/overzicht/bon/eigen/2026-05-01?tot=2026-10-31&scope=persoonlijk&rekening=1');
  });

  it('opens Overzicht on the months of the receipt: the custom range of them, with the account when there is one', () => {
    expect(overzichtRangeHref('2026-10-01', '2026-10-31')).toBe('/overzicht?periode=eigen&van=2026-10&tot=2026-10');
    expect(overzichtRangeHref('2026-07-01', '2026-09-30')).toBe('/overzicht?periode=eigen&van=2026-07&tot=2026-09');
    expect(overzichtRangeHref('2026-01-01', '2026-12-31', 4)).toBe('/overzicht?periode=eigen&van=2026-01&tot=2026-12&rekening=4');
  });
});

describe('the receipt of what Overzicht has selected', () => {
  // Today is 18 Nov 2026 and the history starts on 1 Nov 2025, as in the demo.
  const h = { firstMonth: '2025-11', firstDate: '2025-11-01' };
  const today = '2026-11-18';
  const pick = (view: 'maand' | 'kwartaal' | 'jaar' | 'eigen', key?: string, custom?: { from: string; to: string }) => {
    const p = columns(view, h, today, custom);
    const col = key ? p.columns.find((c) => c.key === key)! : p.columns[p.columns.length - 1];
    return bonTarget(view, col, { from: p.from, to: p.to });
  };

  it('is the selected month, with its title', () => {
    expect(pick('maand', '2026-10')).toEqual({ kind: 'maand', van: '2026-10-01', title: 'oktober 2026' });
    expect(pick('maand', '2026-09')).toEqual({ kind: 'maand', van: '2026-09-01', title: 'september 2026' });
  });

  it('is the selected quarter, from its first month', () => {
    expect(pick('kwartaal', '2026-K3')).toEqual({ kind: 'kwartaal', van: '2026-07-01', title: 'K3 2026' });
    expect(pick('kwartaal', '2026-K1')).toEqual({ kind: 'kwartaal', van: '2026-01-01', title: 'K1 2026' });
  });

  it('is the selected year: its own January, whatever the history cuts the column to, titled by the year alone', () => {
    // The running year's column is cut to "tot oktober", the first year's to "vanaf november": the receipt is the calendar year (its notes say what it holds).
    expect(pick('jaar', '2026')).toEqual({ kind: 'jaar', van: '2026-01-01', title: '2026' });
    expect(pick('jaar', '2025')).toEqual({ kind: 'jaar', van: '2025-01-01', title: '2025' });
  });

  it('is the whole custom range for Eigen, from the 1st of the first month to the last day of the last', () => {
    expect(pick('eigen', undefined, { from: '2026-05', to: '2026-10' })).toEqual({ kind: 'eigen', van: '2026-05-01', tot: '2026-10-31', title: 'mei – okt 2026' });
    expect(pick('eigen', undefined, { from: '2026-02', to: '2026-02' })).toEqual({ kind: 'eigen', van: '2026-02-01', tot: '2026-02-28', title: 'feb 2026' });
    expect(pick('eigen', undefined, { from: '2025-11', to: '2026-02' })).toEqual({ kind: 'eigen', van: '2025-11-01', tot: '2026-02-28', title: 'nov 2025 – feb 2026' });
    // Clamped to the history and to today, as Overzicht does.
    expect(pick('eigen', undefined, { from: '2025-01', to: '2027-01' })).toEqual({ kind: 'eigen', van: '2025-11-01', tot: '2026-11-30', title: 'nov 2025 – nov 2026' });
  });
});

describe('the paper\'s wording', () => {
  it('formats cents with Dutch separators, U+2212 for a minus and no currency symbol', () => {
    expect(plain(123456)).toBe('1.234,56');
    expect(plain(0)).toBe('0,00');
    expect(plain(5)).toBe('0,05');
    expect(plain(-5)).toBe('−0,05');
    expect(plain(-8642)).toBe('−86,42');
    expect(plain(123456789)).toBe('1.234.567,89');
    expect(plain(100)).toBe('1,00');
  });

  it('writes the trend as text', () => {
    expect(trendText({ pct: 12, kind: 'up' })).toBe('+12 %');
    expect(trendText({ pct: -7, kind: 'down' })).toBe('−7 %');
    expect(trendText({ pct: 0, kind: 'flat' })).toBe('= 0 %');
    expect(trendText({ pct: 3, kind: 'flat' })).toBe('+3 %');
    expect(trendText({ kind: 'new' })).toBe('nieuw');
  });

  it('writes the budget line by its source, without a percentage for a reference of 0', () => {
    expect(budgetText({ amount: 55000, kind: 'budget', pct: 117 })).toBe('budget 550,00 · 117 %');
    expect(budgetText({ amount: 52000, kind: 'average', pct: 54 })).toBe('gemiddeld 520,00 · 54 %');
    expect(budgetText({ amount: 52000, kind: 'mixed', pct: 54 })).toBe('budget en gemiddelde 520,00 · 54 %');
    expect(budgetText({ amount: 0, kind: 'budget' })).toBe('budget 0,00');
  });

  it('names the paper after its label', () => {
    expect(paperLabel('Week 47 · 16–22 nov 2026')).toBe('Bon: week 47, 16–22 nov 2026');
    expect(paperLabel('Oktober 2026')).toBe('Bon: oktober 2026');
  });

  it('has the Dutch words of the week and the month', () => {
    expect([emptyText('week'), emptyText('maand')]).toEqual(['Geen transacties in deze week.', 'Geen transacties in deze maand.']);
    expect([previousText('week'), previousText('maand')]).toEqual(['vorige week', 'vorige maand']);
    expect([footerText('week'), footerText('maand')]).toEqual(['Tot volgende week', 'Tot volgende maand']);
    expect([stepLabel('week', -1), stepLabel('week', 1), stepLabel('maand', -1), stepLabel('maand', 1)]).toEqual(['Vorige week', 'Volgende week', 'Vorige maand', 'Volgende maand']);
  });

  it('has the right Dutch for the quarter and the year (het kwartaal, het jaar: vorig, volgend, dit), and a custom range', () => {
    expect([emptyText('kwartaal'), emptyText('jaar'), emptyText('eigen')]).toEqual(['Geen transacties in dit kwartaal.', 'Geen transacties in dit jaar.', 'Geen transacties in deze periode.']);
    expect([previousText('kwartaal'), previousText('jaar'), previousText('eigen')]).toEqual(['vorig kwartaal', 'vorig jaar', 'vorige periode']);
    expect([footerText('kwartaal'), footerText('jaar'), footerText('eigen')]).toEqual(['Tot de volgende keer', 'Tot de volgende keer', 'Tot de volgende keer']);
    expect([stepLabel('kwartaal', -1), stepLabel('kwartaal', 1), stepLabel('jaar', -1), stepLabel('jaar', 1)]).toEqual(['Vorig kwartaal', 'Volgend kwartaal', 'Vorig jaar', 'Volgend jaar']);
  });

  it('names the paper of the new kinds after their labels', () => {
    expect(paperLabel('3e kwartaal 2026 · jul–sep')).toBe('Bon: 3e kwartaal 2026, jul–sep');
    expect(paperLabel('Jaar 2026')).toBe('Bon: jaar 2026');
    expect(paperLabel('Mei – oktober 2026')).toBe('Bon: mei – oktober 2026');
  });
});
