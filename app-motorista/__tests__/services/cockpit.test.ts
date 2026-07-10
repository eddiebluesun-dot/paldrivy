import { test, expect, describe } from '@jest/globals';
import {
  workingDaysInMonth,
  getDailyGoalCents,
  streakFromDates,
  intensityForCents,
} from '../../src/utils/cockpitUtils';

describe('workingDaysInMonth', () => {
  test('July 2026 Mon-Sat has 27 working days', () => {
    expect(workingDaysInMonth([1, 2, 3, 4, 5, 6], 2026, 7)).toBe(27);
  });
  test('with only Mon-Fri', () => {
    expect(workingDaysInMonth([1, 2, 3, 4, 5], 2026, 7)).toBe(23);
  });
});

describe('getDailyGoalCents', () => {
  test('divides goal by working days', () => {
    expect(getDailyGoalCents(500000, [1, 2, 3, 4, 5, 6], 2026, 7)).toBe(18519);
  });
  test('returns 0 when no working days', () => {
    expect(getDailyGoalCents(500000, [], 2026, 7)).toBe(0);
  });
  test('returns 0 when goal is 0', () => {
    expect(getDailyGoalCents(0, [1, 2, 3, 4, 5, 6], 2026, 7)).toBe(0);
  });
});

describe('streakFromDates', () => {
  test('consecutive days from today give correct streak', () => {
    const today = '2026-07-10';
    const dates = ['2026-07-10', '2026-07-09', '2026-07-08', '2026-07-07'];
    expect(streakFromDates(dates, today)).toBe(4);
  });
  test('gap breaks streak', () => {
    const today = '2026-07-10';
    const dates = ['2026-07-10', '2026-07-08'];
    expect(streakFromDates(dates, today)).toBe(1);
  });
  test('no data today gives 0', () => {
    const today = '2026-07-10';
    const dates = ['2026-07-09', '2026-07-08'];
    expect(streakFromDates(dates, today)).toBe(0);
  });
  test('empty dates gives 0', () => {
    expect(streakFromDates([], '2026-07-10')).toBe(0);
  });
});

describe('intensityForCents', () => {
  test('0 gives 0', () => expect(intensityForCents(0)).toBe(0));
  test('5000 (R$50) gives 1', () => expect(intensityForCents(5000)).toBe(1));
  test('15000 (R$150) gives 2', () => expect(intensityForCents(15000)).toBe(2));
  test('35000 (R$350) gives 3', () => expect(intensityForCents(35000)).toBe(3));
});
