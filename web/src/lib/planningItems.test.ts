import { describe, expect, it } from 'vitest';
import { lastPlanDay } from './planningItems';

describe('lastPlanDay', () => {
  it.each([
    ['2026-11-18', '2028-11-30'],
    ['2026-12-31', '2028-12-31'],
    ['2026-02-10', '2028-02-29'], // a leap year
    ['2027-02-10', '2029-02-28'],
    ['2026-01-01', '2028-01-31'],
  ])('%s → %s', (today, last) => expect(lastPlanDay(today)).toBe(last));
});
