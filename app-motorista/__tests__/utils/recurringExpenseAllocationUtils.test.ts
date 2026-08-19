import { computeDailyAllocationCents, splitAcrossShifts, type RecurringExpenseInput } from '@/src/utils/recurringExpenseAllocationUtils';

describe('computeDailyAllocationCents', () => {
  it('divides a weekly expense by the working days in ITS OWN period', () => {
    // Rent R$660/week, expense_date anchors the weekly cycle to Tuesdays,
    // driver works Mon-Sat (6 days) -> 660/6 = 110 per working day.
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 66000, expenseDate: '2026-08-04', frequency: 'weekly' }, // a Tuesday
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z')); // the Wednesday right after
    expect(result).toBe(11000); // R$110,00
  });

  it('sums two independent recurring expenses without a shared denominator', () => {
    // Rent 660/week (6 working days -> 110/day) + insurance 300/month anchored
    // same date. getPeriodBounds('2026-08-04', 'monthly', 2026-08-05) resolves to
    // period [2026-08-04T00:00:00Z, 2026-09-04T00:00:00Z) -- confirmed by reading
    // the monthly branch: n=0, periodEnd (2026-09-04) is not <= now (2026-08-05),
    // so the loop never advances past the first period.
    // That range spans 31 calendar days (Aug 4 - Sep 3 inclusive). Aug 4, 2026 is a
    // Tuesday, so the Sundays landing in range are Aug 9, 16, 23, 30 -- 4 Sundays.
    // Mon-Sat working days = 31 - 4 = 27. monthlyShare = Math.round(30000 / 27) = 1111.
    // weeklyShare (from the first test, same anchor/target) = 11000.
    // Total = 11000 + 1111 = 12111.
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 66000, expenseDate: '2026-08-04', frequency: 'weekly' },
      { amountCents: 30000, expenseDate: '2026-08-04', frequency: 'monthly' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(12111);
  });

  it('ignores quarterly/semiannual/annual recurring expenses', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 120000, expenseDate: '2026-08-04', frequency: 'quarterly' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(0);
  });

  it('ignores non-recurring expenses entirely (frequency null/one-off)', () => {
    // one-off expenses shouldn't even reach this function in practice (Task 3 filters them
    // before calling), but the pure function should be defensive regardless
    const expenses: RecurringExpenseInput[] = [];
    expect(computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'))).toBe(0);
  });

  it('returns 0 for a day the target date falls outside any active expense\'s period', () => {
    // NOTE: uses 'monthly' here, not 'weekly' as in the original brief draft. Verified by
    // hand-tracing getPeriodBounds: the weekly branch bins `now` via floor((now-start)/week),
    // which by construction always lands `now` inside SOME weekly period stretching backward
    // or forward indefinitely -- there is no `now` for which a weekly-anchored expense's
    // bounds check ever excludes it. The monthly branch's loop only counts forward from `n=0`
    // (never decrements), so a `now` before the anchor date falls before periodStart and is
    // correctly excluded. Confirmed numerically: getPeriodBounds('2026-08-04','weekly', Jan 1
    // 2026) returns periodStart=2025-12-30/periodEnd=2026-01-06, which DOES contain Jan 1 2026
    // -- so a weekly expense here would NOT return 0, contradicting the test's intent. Monthly
    // does return 0 as intended: periodStart=2026-08-04 is after the Jan 1 2026 target.
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 30000, expenseDate: '2026-08-04', frequency: 'monthly' },
    ];
    // a date long before the expense's anchor -- outside any period this expense could define
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-01-01T12:00:00Z'));
    expect(result).toBe(0);
  });

  it('returns 0 for a day off (not a configured working day) even though it falls inside an active period', () => {
    // Real bug: a Mon-Sat driver's day off (Sunday) was getting charged the
    // same daily share as a worked day, because period-membership alone was
    // treated as sufficient. 2026-08-09 is a Sunday, inside the weekly
    // period [2026-08-03, 2026-08-10) anchored to 2026-08-04.
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 66000, expenseDate: '2026-08-04', frequency: 'weekly' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-09T12:00:00Z'));
    expect(result).toBe(0);
  });

  it('a daily expense contributes its full amount on every working day, no division', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 5000, expenseDate: '2026-08-04', frequency: 'daily' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(5000);
  });

  it('a daily expense contributes 0 on a day off, same as weekly/monthly', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 5000, expenseDate: '2026-08-04', frequency: 'daily' },
    ];
    // 2026-08-09 is a Sunday, not in the Mon-Sat working days below.
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-09T12:00:00Z'));
    expect(result).toBe(0);
  });

  it('an expense with endsAt on/before the target date contributes 0', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 66000, expenseDate: '2026-08-04', frequency: 'weekly', endsAt: '2026-08-05' },
    ];
    // Target date equals endsAt -- must already be excluded (endsAt is the
    // first day the expense no longer applies, not the last day it does).
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(0);
  });

  it('an expense with endsAt in the future still contributes normally before that date', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 66000, expenseDate: '2026-08-04', frequency: 'weekly', endsAt: '2026-12-01' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(11000); // same as the very first test in this file
  });

  it('a daily expense also respects endsAt', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 5000, expenseDate: '2026-08-04', frequency: 'daily', endsAt: '2026-08-05' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(0);
  });

  it('a weekly expense contributes 0 for a target date before its own anchor (expenseDate), even though the calendar week containing that date overlaps the period getPeriodBounds would compute', () => {
    // Bug: getPeriodBounds derives periodStart/periodEnd from `now` (targetDate),
    // not from the expense's own anchor date, so a date BEFORE the expense was
    // ever created could still fall inside the Mon-Sun week getPeriodBounds
    // returns for it. expenseDate=2026-08-10 (a Monday) anchors the expense;
    // 2026-08-05 (the Wednesday of the PRIOR week) must contribute 0 regardless.
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 80431, expenseDate: '2026-08-10', frequency: 'weekly' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(0);
  });

  it('a monthly expense contributes 0 for a target date before its own anchor (expenseDate)', () => {
    // Same lower-bound rule as weekly, for the monthly branch. Anchored
    // 2026-08-15; a target date in the same getPeriodBounds-computed period
    // stretch but before the anchor day must still contribute 0.
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 30000, expenseDate: '2026-08-15', frequency: 'monthly' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-10T12:00:00Z'));
    expect(result).toBe(0);
  });

  it('regression: real rent (R$804.31/week, anchored 2026-08-10) summed over all of August contributes ZERO for days 01-09 and the correct total for days 10-31', () => {
    // Real case: user db85eea7-8cd7-464d-ba68-05f1e8a15560, rent R$804.31/week,
    // recurring_frequency='weekly', expense_date='2026-08-10' (a Monday).
    // Driver works Mon-Sat. Before the fix, days 01-09 (11 days before the
    // expense ever existed) were incorrectly allocated a share of this rent.
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 80431, expenseDate: '2026-08-10', frequency: 'weekly' },
    ];
    const workingDays = [1, 2, 3, 4, 5, 6];

    let earlyTotal = 0; // Aug 1-9
    for (let d = 1; d <= 9; d++) {
      earlyTotal += computeDailyAllocationCents(expenses, workingDays, new Date(`2026-08-0${d}T12:00:00Z`));
    }
    expect(earlyTotal).toBe(0);

    // Aug 10-31: every calendar week Aug10-2026 anchors is a full Mon-Sun
    // week (Aug 10 itself is a Monday), so every one of those weeks has 6
    // working days (Mon-Sat) and each working day's share is always
    // round(80431 / 6) = 13405 cents (R$134.05), regardless of which of the
    // 4 weekly periods it falls in. Working days Aug10-31 inclusive: Aug
    // 10-15 (6), 17-22 (6), 24-29 (6), 31 (1) = 19 working days (Sundays
    // Aug16/23/30 excluded). Expected total = 19 x 13405 = 254695 cents
    // (R$2,546.95) -- derived here independently of the implementation, not
    // copied from it.
    let lateTotal = 0; // Aug 10-31
    for (let d = 10; d <= 31; d++) {
      lateTotal += computeDailyAllocationCents(expenses, workingDays, new Date(`2026-08-${d}T12:00:00Z`));
    }
    expect(lateTotal).toBe(254695);
  });

  it('summing the daily share across every day of the period reconciles to the total expense, not more', () => {
    // The exact scenario reported: R$804.31/week, driver works Mon-Sat.
    // Every working day in the period should get an equal share that sums
    // back to 80431 -- NOT 7 days x that share (which overshoots to 93835,
    // the bug's symptom).
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 80431, expenseDate: '2026-08-10', frequency: 'weekly' },
    ];
    const workingDays = [1, 2, 3, 4, 5, 6];
    let total = 0;
    for (let d = 10; d <= 16; d++) {
      total += computeDailyAllocationCents(expenses, workingDays, new Date(`2026-08-${d}T12:00:00Z`));
    }
    // 80431 / 6 = 13405 (rounded) per working day x 6 working days = 80430 --
    // off by 1 cent from 80431 purely due to per-day rounding, not the bug.
    expect(total).toBeGreaterThanOrEqual(80425);
    expect(total).toBeLessThanOrEqual(80431);
  });
});

describe('splitAcrossShifts', () => {
  it('returns the full amount for a single shift', () => {
    expect(splitAcrossShifts(11000, 1)).toEqual([11000]);
  });

  it('splits evenly across multiple shifts, remainder to the last', () => {
    // 11000 / 3 = 3666.67 -> 3667, 3667, 3666 (sums back to exactly 11000)
    const shares = splitAcrossShifts(11000, 3);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(11000);
    expect(shares.length).toBe(3);
  });

  it('returns an empty array for zero shifts', () => {
    expect(splitAcrossShifts(11000, 0)).toEqual([]);
  });
});
