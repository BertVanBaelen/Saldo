import { describe, expect, it } from 'vitest';
import { itemRhythm, lastPlanDay, monthChip, monthlyAmount, monthlySummary, monthYear, oneOffMonths, plannedDate, plannedNote, plannedPlace, plannedWhen, suggestionRhythm, type RecurringSuggestion } from './planningItems';

describe('lastPlanDay', () => {
  it.each([
    ['2026-11-18', '2028-11-30'],
    ['2026-12-31', '2028-12-31'],
    ['2026-02-10', '2028-02-29'], // a leap year
    ['2027-02-10', '2029-02-28'],
    ['2026-01-01', '2028-01-31'],
  ])('%s → %s', (today, last) => expect(lastPlanDay(today)).toBe(last));
});

describe('the words of Planning instellen', () => {
  it('says the rhythm of an item and of a suggestion in the design\'s words', () => {
    expect(itemRhythm({ frequency: 'yearly', day: 15, month: 1, endDate: null, kind: 'expense' })).toBe('Jaarlijks · 15 januari');
    expect(itemRhythm({ frequency: 'quarterly', day: 3, month: 9, endDate: null, kind: 'expense' })).toBe('Per kwartaal · 3e');
    const s: RecurringSuggestion = { accountId: 1, counterparty: 'Gym', description: 'Gym', amount: -2999, amountRule: 'fixed', frequency: 'monthly', day: 3, month: null, kind: 'expense', seen: 4 };
    expect(suggestionRhythm(s)).toBe('Maandelijks · rond de 3e · 4× gezien');
  });

  it('adds the items up per month: a quarterly one a third, a yearly one a twelfth, in whole euros', () => {
    const items = [
      { amount: 285000, frequency: 'monthly' as const },
      { amount: -100500, frequency: 'monthly' as const },
      { amount: -68400, frequency: 'yearly' as const },
      { amount: -4290, frequency: 'quarterly' as const },
    ];
    expect(items.map(monthlyAmount)).toEqual([285000, -100500, -5700, -1430]);
    expect(monthlySummary(items)).toBe('Per maand +€ 2.850 in · € 1.076 uit');
    expect(monthlySummary([])).toBe('Per maand € 0 in · € 0 uit');
  });

  it('offers twelve months from the running one (the year on a January), and the month of an item further out at the end', () => {
    const months = oneOffMonths('2026-11');
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ value: '2026-11', label: 'Nov', aria: 'november 2026' });
    expect(months[2]).toEqual({ value: '2027-01', label: 'Jan ’27', aria: 'januari 2027' });
    expect(months[11].value).toBe('2027-10');
    expect(oneOffMonths('2026-11', '2028-06').map((m) => m.value).slice(-2)).toEqual(['2027-10', '2028-06']);
    expect(oneOffMonths('2026-11', '2027-03')).toHaveLength(12);
  });

  it('writes a planned date in full', () => {
    expect(plannedDate('2026-12-20')).toBe('20 december 2026');
  });

  it('writes what an item is planned for, with or without a day, and what a request carries for it', () => {
    const dated = { date: '2027-07-15', month: '2027-07' };
    const dayless = { date: null, month: '2027-07' };
    expect(monthYear('2027-07')).toBe('juli 2027');
    expect(plannedWhen(dated)).toBe('15 juli 2027');
    expect(plannedWhen(dayless)).toBe('Ergens in juli 2027');
    expect(plannedPlace(dated)).toEqual({ date: '2027-07-15' });
    expect(plannedPlace(dayless)).toEqual({ month: '2027-07' });
    expect(plannedNote({ ...dayless, amount: -150000 }, '2026-11-18')).toBe('Ergens in juli 2027');
    expect(plannedNote({ ...dayless, month: '2026-12', amount: -150000 }, '2026-11-18')).toBe('Ergens in december');
    expect(plannedNote({ ...dated, amount: 68000 }, '2026-11-18')).toBe('Verwacht op 15 juli 2027');
    expect(monthChip('2027-07')).toEqual({ month: 'JUL', year: '2027' });
  });
});
