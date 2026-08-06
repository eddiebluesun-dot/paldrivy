import { test, expect, describe } from '@jest/globals';
import {
  workingDaysInMonth, getDailyGoalCents, workingDaysRemainingInMonth, getAdaptiveDailyGoalCents,
} from '../../src/utils/cockpitUtils';

describe('getDailyGoalCents (flat split — kept for backward compat, no longer used by the HOJE card)', () => {
  test('splits the whole goal across all working days in the month', () => {
    // August 2026: Mon-Sat working days → 26 working days (5 Sundays: 2, 9, 16, 23, 30).
    expect(workingDaysInMonth([1, 2, 3, 4, 5, 6], 2026, 8)).toBe(26);
    expect(getDailyGoalCents(800000, [1, 2, 3, 4, 5, 6], 2026, 8)).toBe(Math.ceil(800000 / 26));
  });
});

describe('workingDaysRemainingInMonth', () => {
  test('counts today through end of month, inclusive of today', () => {
    // August 2026 has 31 days. From the 6th (a Thursday) to the 31st, Mon-Sat working days.
    const days = workingDaysRemainingInMonth([1, 2, 3, 4, 5, 6], 2026, 8, 6);
    // Manually: Aug 6-31 = 26 calendar days, minus the Sundays in that range (9, 16, 23, 30) = 22.
    expect(days).toBe(22);
  });

  test('returns 0 when there are no configured working days', () => {
    expect(workingDaysRemainingInMonth([], 2026, 8, 6)).toBe(0);
  });

  test('counts only today when today is the last day of the month and is a working day', () => {
    // Aug 31 2026 is a Monday.
    expect(workingDaysRemainingInMonth([1, 2, 3, 4, 5, 6], 2026, 8, 31)).toBe(1);
  });
});

describe('getAdaptiveDailyGoalCents — the HOJE card "Meta" figure', () => {
  test('with no progress yet, matches remaining-goal ÷ remaining-working-days', () => {
    const cents = getAdaptiveDailyGoalCents(800000, [1, 2, 3, 4, 5, 6], 0, 2026, 8, 6);
    expect(cents).toBe(Math.ceil(800000 / 22));
  });

  // Regression: the old getDailyGoalCents ignored progress-so-far entirely,
  // so the "Meta" figure never moved no matter how much the driver had
  // already earned that month. The adaptive version must shrink the daily
  // target as the driver makes progress toward the monthly goal.
  test('shrinks as progress toward the monthly goal accumulates', () => {
    const noProgress = getAdaptiveDailyGoalCents(800000, [1, 2, 3, 4, 5, 6], 0, 2026, 8, 6);
    const halfwayThere = getAdaptiveDailyGoalCents(800000, [1, 2, 3, 4, 5, 6], 400000, 2026, 8, 6);
    expect(halfwayThere).toBeLessThan(noProgress);
    expect(halfwayThere).toBe(Math.ceil((800000 - 400000) / 22));
  });

  // Falling behind pace should raise the daily target for the days that are
  // left, not leave it flat — this is the "recalculated daily" behavior the
  // flat split was missing.
  test('rises for the remaining days when the driver is behind pace', () => {
    // Only 1 remaining working day, but still R$3.000 short of the goal.
    const cents = getAdaptiveDailyGoalCents(800000, [1, 2, 3, 4, 5, 6], 500000, 2026, 8, 31);
    expect(cents).toBe(300000); // all of it lands on the last working day
  });

  test('returns 0 once the monthly goal has already been reached', () => {
    expect(getAdaptiveDailyGoalCents(800000, [1, 2, 3, 4, 5, 6], 800000, 2026, 8, 6)).toBe(0);
    expect(getAdaptiveDailyGoalCents(800000, [1, 2, 3, 4, 5, 6], 900000, 2026, 8, 6)).toBe(0);
  });

  test('returns 0 when there is no goal or no working days configured', () => {
    expect(getAdaptiveDailyGoalCents(0, [1, 2, 3, 4, 5, 6], 0, 2026, 8, 6)).toBe(0);
    expect(getAdaptiveDailyGoalCents(800000, [], 0, 2026, 8, 6)).toBe(0);
  });
});
