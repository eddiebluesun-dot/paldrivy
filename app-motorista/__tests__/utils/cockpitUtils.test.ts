import { test, expect, describe } from '@jest/globals';
import {
  workingDaysInMonth, getDailyGoalCents, workingDaysRemainingInMonth, getAdaptiveDailyGoalCents,
  countActiveDays,
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

  // Regression for: "I added Saturday to my working days and the daily goal
  // didn't change." Numbers here are the real production figures for the
  // account that reported it (R$8.000 August goal, R$522,25 earned so far
  // this month, checked on Aug 7th 2026) — R$356,09 is the exact figure the
  // "HOJE" card showed. Reproducing it against Mon-Sat confirms the function
  // DOES read the live working-days set; comparing against the Mon-Fri
  // figure proves it's not a coincidence — the two must differ.
  test('adding Saturday changes the figure — Mon-Fri vs Mon-Sat with real numbers', () => {
    const goalCents = 800000; // R$8.000,00
    const progressCents = 52225; // R$522,25 earned so far this month
    const year = 2026, month = 8, today = 7; // Fri Aug 7 2026

    const monFri = getAdaptiveDailyGoalCents(goalCents, [1, 2, 3, 4, 5], progressCents, year, month, today);
    const monSat = getAdaptiveDailyGoalCents(goalCents, [1, 2, 3, 4, 5, 6], progressCents, year, month, today);

    expect(monFri).toBe(43987); // R$439,87 — remaining ÷ 17 working days left
    expect(monSat).toBe(35609); // R$356,09 — remaining ÷ 21 working days left (matches production)
    expect(monSat).toBeLessThan(monFri); // adding a working day spreads the same remaining goal thinner
  });
});

// Regression for two production bugs in a row on this same metric:
//
// 1. The "🔥 N dias ativos" badge near the vehicle picker (fed by
//    getStreak → this function) and the "🏅 N dias ativos" badge on the
//    HOJE card (which used to independently filter monthlyBuckets by
//    `net_cents > 0`, shifts only) showed two different numbers for the
//    same moment in time — 4 vs 2. Both call sites now route through this
//    single function so there's no way for them to drift apart again.
//
// 2. The first fix for #1 unified both call sites onto the WRONG
//    definition — "shift OR expense that day" — without checking it
//    against real data. Verified against production (account
//    db85eea7-8cd7-464d-ba68-05f1e8a15560, August 2026): 2 distinct shift
//    days (Aug 3, Aug 6) but 2 additional expense-only days (Aug 9, Aug 16)
//    with no shift, which the union counted as "active" and inflated the
//    badge to 4 when the real, correct answer — confirmed by the
//    shift-only "DIAS DO MÊS" bars on Resumo do Mês — is 2. "Active day"
//    means "day with a shift," full stop; expenses never factor in.
describe('countActiveDays — single source of truth for "days active this month"', () => {
  test('a day with 2 shifts still counts as 1 active day, not 2', () => {
    const shiftDates = [
      '2026-08-01',
      '2026-08-01', // second shift, same day
      '2026-08-03',
      '2026-08-07',
    ];
    expect(countActiveDays(shiftDates)).toBe(3);
  });

  test('no activity gives 0', () => {
    expect(countActiveDays([])).toBe(0);
  });

  // Real production scenario (account db85eea7-8cd7-464d-ba68-05f1e8a15560,
  // Aug 2026): 2 shift days plus 2 expense-only days on the same month.
  // Expense dates are intentionally NOT passed in — an expense-only day
  // must not count as active. Correct answer is 2, not 4.
  test('reproduces the production scenario: expense-only days do not inflate the count', () => {
    const shiftDates = ['2026-08-03', '2026-08-06'];
    // Expense-only days (2026-08-09, 2026-08-16 in production) have no
    // representation here at all — countActiveDays no longer takes an
    // expense-dates argument, which is the point of the fix.
    expect(countActiveDays(shiftDates)).toBe(2);
  });
});
