import { test, expect, describe } from '@jest/globals';
import { FREE_MONTHLY_SHIFT_LIMIT, hasReachedShiftLimit, canViewMonthAsFree } from '../../src/utils/freeLimits';

describe('hasReachedShiftLimit', () => {
  test('below the limit returns false', () => {
    expect(hasReachedShiftLimit(4)).toBe(false);
  });
  test('at the limit returns true', () => {
    expect(hasReachedShiftLimit(FREE_MONTHLY_SHIFT_LIMIT)).toBe(true);
  });
  test('above the limit returns true', () => {
    expect(hasReachedShiftLimit(FREE_MONTHLY_SHIFT_LIMIT + 1)).toBe(true);
  });
});

describe('canViewMonthAsFree', () => {
  const now = new Date('2026-07-20T12:00:00Z');

  test('current month is allowed', () => {
    expect(canViewMonthAsFree(2026, 7, now)).toBe(true);
  });
  test('previous month is blocked', () => {
    expect(canViewMonthAsFree(2026, 6, now)).toBe(false);
  });
  test('same month, previous year is blocked', () => {
    expect(canViewMonthAsFree(2025, 7, now)).toBe(false);
  });
});
