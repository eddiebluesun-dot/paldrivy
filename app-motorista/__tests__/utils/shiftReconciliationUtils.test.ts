import { test, expect, describe } from '@jest/globals';
import {
  shiftDayKey,
  getPriorSameDayPlatforms,
  reconcileShiftPlatforms,
  type ShiftPlatformEntry,
  type ShiftForReconciliation,
} from '../../src/utils/shiftReconciliationUtils';

describe('shiftDayKey', () => {
  test('attributes a normal daytime shift to its own calendar day', () => {
    expect(shiftDayKey('2026-08-03T11:00:00-03:00')).toBe('2026-08-03');
  });

  // Overnight shifts (start 22:00, end 03:00 next day) must be attributed to
  // the day they STARTED — matching the existing convention already used
  // throughout dashboard.ts (getMonthReport, getWeekBuckets, getMonthlyBuckets,
  // getYearlyReport all group by `started_at`, never `ended_at`).
  test('attributes an overnight shift to its START day, not its end day', () => {
    // Started 22:00 on Aug 3rd, would end around 03:00 Aug 4th.
    expect(shiftDayKey('2026-08-03T22:00:00-03:00')).toBe('2026-08-03');
  });
});

describe('getPriorSameDayPlatforms', () => {
  const shift1: ShiftForReconciliation = {
    id: 'shift-1',
    started_at: '2026-08-03T08:00:00-03:00',
    ended_at: '2026-08-03T11:00:00-03:00',
    platforms: [{ platform_name: 'Uber', amount_cents: 20000 }],
  };

  test('no other shifts that day: nothing to reconcile against', () => {
    const result = getPriorSameDayPlatforms([], '2026-08-03T15:00:00-03:00');
    expect(result).toEqual([]);
  });

  test('includes an earlier same-day shift, excludes shifts from other days', () => {
    const shiftOtherDay: ShiftForReconciliation = {
      id: 'shift-0',
      started_at: '2026-08-02T08:00:00-03:00',
      ended_at: '2026-08-02T11:00:00-03:00',
      platforms: [{ platform_name: 'Uber', amount_cents: 99999 }],
    };
    const result = getPriorSameDayPlatforms(
      [shiftOtherDay, shift1],
      '2026-08-03T15:00:00-03:00',
    );
    expect(result).toEqual([{ platform_name: 'Uber', amount_cents: 20000 }]);
  });

  test('excludes the shift currently being edited (by id) from its own prior list', () => {
    const result = getPriorSameDayPlatforms(
      [shift1],
      '2026-08-03T08:00:00-03:00',
      'shift-1',
    );
    expect(result).toEqual([]);
  });

  test('excludes shifts that are not yet completed (no ended_at / no platforms)', () => {
    const activeShift: ShiftForReconciliation = {
      id: 'active',
      started_at: '2026-08-03T08:00:00-03:00',
      ended_at: null,
      platforms: null,
    };
    const result = getPriorSameDayPlatforms([activeShift], '2026-08-03T15:00:00-03:00');
    expect(result).toEqual([]);
  });

  test('an overnight shift starting the previous day is not counted as prior for a shift the next morning', () => {
    const overnightShift: ShiftForReconciliation = {
      id: 'overnight',
      started_at: '2026-08-02T22:00:00-03:00', // attributed to Aug 2nd
      ended_at: '2026-08-03T03:00:00-03:00',
      platforms: [{ platform_name: 'Uber', amount_cents: 15000 }],
    };
    // A fresh shift starting the morning of Aug 3rd is a *different* attributed day.
    const result = getPriorSameDayPlatforms(
      [overnightShift],
      '2026-08-03T09:00:00-03:00',
    );
    expect(result).toEqual([]);
  });

  test('flattens and sums multiple prior shifts, including multiple platforms per shift', () => {
    const shiftA: ShiftForReconciliation = {
      id: 'a',
      started_at: '2026-08-03T06:00:00-03:00',
      ended_at: '2026-08-03T09:00:00-03:00',
      platforms: [
        { platform_name: 'Uber', amount_cents: 10000 },
        { platform_name: '99', amount_cents: 5000 },
      ],
    };
    const shiftB: ShiftForReconciliation = {
      id: 'b',
      started_at: '2026-08-03T10:00:00-03:00',
      ended_at: '2026-08-03T13:00:00-03:00',
      platforms: [{ platform_name: 'Uber', amount_cents: 8000 }],
    };
    const result = getPriorSameDayPlatforms(
      [shiftA, shiftB],
      '2026-08-03T15:00:00-03:00',
    );
    expect(result).toEqual([
      { platform_name: 'Uber', amount_cents: 10000 },
      { platform_name: '99', amount_cents: 5000 },
      { platform_name: 'Uber', amount_cents: 8000 },
    ]);
  });
});

describe('reconcileShiftPlatforms', () => {
  test('isCumulativeDayTotal=false: entered amounts pass through unchanged (safe default)', () => {
    const entered: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 49223 }];
    const prior: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 20000 }];
    expect(reconcileShiftPlatforms(entered, prior, false)).toEqual(entered);
  });

  test('no prior shifts: entered amounts pass through unchanged regardless of flag', () => {
    const entered: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 49223 }];
    expect(reconcileShiftPlatforms(entered, [], true)).toEqual(entered);
  });

  // The owner's exact real-world example:
  // Shift 1 (8h-11h): R$200,00 gross entered as its own value.
  // Shift 2 (15h-19h): driver checks the Uber app and it shows R$492,23 —
  // the platform's CUMULATIVE total for the whole day, not shift 2 alone.
  // True shift-2 earnings = 492.23 - 200 = 292.23; day total stays 492.23.
  test('owner regression: reconciles a same-day cumulative total against a prior shift', () => {
    const shift1Platforms: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 20000 }];
    const shift2Entered: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 49223 }];

    const reconciledShift2 = reconcileShiftPlatforms(shift2Entered, shift1Platforms, true);
    expect(reconciledShift2).toEqual([{ platform_name: 'Uber', amount_cents: 29223 }]);

    const shift1Gross = shift1Platforms.reduce((s, p) => s + p.amount_cents, 0);
    const shift2Gross = reconciledShift2.reduce((s, p) => s + p.amount_cents, 0);
    expect(shift1Gross + shift2Gross).toBe(49223); // day total matches what the app showed, not 69223
  });

  test('only subtracts prior amounts for the SAME platform name — unrelated platforms pass through', () => {
    const entered: ShiftPlatformEntry[] = [
      { platform_name: 'Uber', amount_cents: 49223 },
      { platform_name: '99', amount_cents: 3000 }, // new platform this shift, nothing to reconcile
    ];
    const prior: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 20000 }];
    expect(reconcileShiftPlatforms(entered, prior, true)).toEqual([
      { platform_name: 'Uber', amount_cents: 29223 },
      { platform_name: '99', amount_cents: 3000 },
    ]);
  });

  test('floors at 0 instead of going negative when entered total is below prior sum (bad input, not negative earnings)', () => {
    const entered: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 5000 }];
    const prior: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 20000 }];
    expect(reconcileShiftPlatforms(entered, prior, true)).toEqual([
      { platform_name: 'Uber', amount_cents: 0 },
    ]);
  });

  test('sums multiple prior shifts for the same platform before subtracting (3+ shifts in one day)', () => {
    // Shift 1: Uber 100. Shift 2: Uber cumulative 250 (reconciled to 150).
    // Shift 3: driver checks again, Uber cumulative shows 480.
    const entered: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 48000 }];
    const prior: ShiftPlatformEntry[] = [
      { platform_name: 'Uber', amount_cents: 10000 }, // shift 1 (already isolated)
      { platform_name: 'Uber', amount_cents: 15000 }, // shift 2 (already reconciled to isolated 150)
    ];
    expect(reconcileShiftPlatforms(entered, prior, true)).toEqual([
      { platform_name: 'Uber', amount_cents: 23000 }, // 480 - (100+150) = 230
    ]);
  });

  // rides_count reconciles by the exact same day-cumulative rule as
  // amount_cents (the platform's ride counter is also a running day total).
  test('reconciles rides_count the same way as amount_cents (owner request: apply the same logic used for ganhos)', () => {
    const shift1Platforms: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 20000, rides_count: 5 }];
    const shift2Entered: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 49223, rides_count: 11 }];

    const reconciled = reconcileShiftPlatforms(shift2Entered, shift1Platforms, true);
    expect(reconciled).toEqual([{ platform_name: 'Uber', amount_cents: 29223, rides_count: 6 }]);
  });

  test('rides_count floors at 0 instead of going negative', () => {
    const entered: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 5000, rides_count: 2 }];
    const prior: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 20000, rides_count: 9 }];
    expect(reconcileShiftPlatforms(entered, prior, true)).toEqual([
      { platform_name: 'Uber', amount_cents: 0, rides_count: 0 },
    ]);
  });

  test('rows without rides_count are left untouched (older callers, no rides data to reconcile)', () => {
    const entered: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 49223 }];
    const prior: ShiftPlatformEntry[] = [{ platform_name: 'Uber', amount_cents: 20000, rides_count: 5 }];
    expect(reconcileShiftPlatforms(entered, prior, true)).toEqual([
      { platform_name: 'Uber', amount_cents: 29223 },
    ]);
  });
});
