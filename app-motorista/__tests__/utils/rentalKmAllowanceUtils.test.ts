import { getPeriodBounds, computeRentalAllowanceStatus, type OdometerReading } from '@/src/utils/rentalKmAllowanceUtils';

describe('getPeriodBounds', () => {
  it('returns null for unlimited', () => {
    expect(getPeriodBounds('2026-08-05', 'unlimited', new Date('2026-08-20'))).toBeNull();
  });

  it('periodIndex is 0 for the period containing the contract start date', () => {
    const bounds = getPeriodBounds('2026-08-05', 'weekly', new Date('2026-08-05T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-08-03T00:00:00.000Z'),
      periodEnd: new Date('2026-08-10T00:00:00.000Z'),
      periodIndex: 0,
    });
  });

  it('computes the current weekly period as the calendar week (Mon-Sun) containing "now", regardless of the contract start date\'s weekday', () => {
    // Weekly periods are calendar-aligned (Mon-Sun), not floating 7-day
    // windows anchored to the contract's own start weekday. Contract started
    // Wed 2026-08-05; "now" is 2026-08-15 (a Saturday) -> the calendar week
    // containing it is [2026-08-10 Mon, 2026-08-17 Mon), independent of the
    // fact the contract itself started on a Wednesday. That's 1 full week
    // after the contract-start week (which began Mon 2026-08-03) -> periodIndex 1.
    const bounds = getPeriodBounds('2026-08-05', 'weekly', new Date('2026-08-15T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-08-10T00:00:00.000Z'),
      periodEnd: new Date('2026-08-17T00:00:00.000Z'),
      periodIndex: 1,
    });
  });

  it('weekly period resets every Monday regardless of contract start weekday (Sunday still counts in the PRIOR week)', () => {
    // "now" is a Sunday -- must resolve to the week that already started the
    // preceding Monday, not roll into the next one.
    const bounds = getPeriodBounds('2026-08-05', 'weekly', new Date('2026-08-16T12:00:00Z')); // Sunday
    expect(bounds).toEqual({
      periodStart: new Date('2026-08-10T00:00:00.000Z'),
      periodEnd: new Date('2026-08-17T00:00:00.000Z'),
      periodIndex: 1,
    });
  });

  it('computes the current monthly period from the contract start date', () => {
    // contract started 2026-08-05; "now" is 2026-09-10 -> period 2 is [2026-09-05, 2026-10-05),
    // which is periodIndex 1 (0-based: the contract-start period is index 0).
    const bounds = getPeriodBounds('2026-08-05', 'monthly', new Date('2026-09-10T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-09-05T00:00:00.000Z'),
      periodEnd: new Date('2026-10-05T00:00:00.000Z'),
      periodIndex: 1,
    });
  });

  it('clamps the monthly period end to the last valid day instead of overflowing into the next month (contract started the 31st)', () => {
    // contract started 2026-01-31. Naive Date.UTC(2026, 1, 31) overflows
    // February's 28 days into 2026-03-03. period 1 must instead end on
    // 2026-02-28 (last day of Feb), and period 2 -- checked at a "now" of
    // 2026-03-02, which falls inside period 2 -- must stay anchored to the
    // 31st of March (period 2's own last-valid-day clamp), not drift to the 3rd.
    const bounds = getPeriodBounds('2026-01-31', 'monthly', new Date('2026-03-02T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-02-28T00:00:00.000Z'),
      periodEnd: new Date('2026-03-31T00:00:00.000Z'),
      periodIndex: 1,
    });
  });

  it('does not drift for a start day that exists in every month (regression check)', () => {
    // contract started 2026-01-15 (a day with no overflow risk). "now" is
    // 2026-03-20 -> period 3 is [2026-03-15, 2026-04-15), which is periodIndex 2 (0-based).
    const bounds = getPeriodBounds('2026-01-15', 'monthly', new Date('2026-03-20T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-03-15T00:00:00.000Z'),
      periodEnd: new Date('2026-04-15T00:00:00.000Z'),
      periodIndex: 2,
    });
  });
});

describe('computeRentalAllowanceStatus', () => {
  // Real production case (Eddie, 2026-08-17): contract started 2026-08-05
  // at 18332000m, 1505 km/week (215 km/day exactly). By 2026-08-17 the
  // odometer read 21126000m. Hand-verified: 13 calendar days (inclusive of
  // both start and today) x 215 km/day = 2795 km allowance vs
  // (21126000-18332000)/1000 = 2794 km driven -> +1 km balance. The
  // previous block-formula gave +1277 km for this exact data -- a
  // different model, not a rounding difference. This is the regression
  // test for the whole daily-linear rewrite (docs/superpowers/specs/
  // 2026-08-18-km-gaps-and-cumulative-balance-bar-design.md).
  it('regression: daily-linear allowance for a weekly plan matches the hand-verified production case (+1 km balance)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 1505,
      excessRateCents: 150,
      readings: [{ odometerMeters: 21126000, at: '2026-08-17T10:00:00Z' }],
      now: new Date('2026-08-17T16:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(2794);
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(2795); // 215 km/day * 13 days
    expect(status?.balanceKm).toBeCloseTo(1);
    expect(status?.isOverLimit).toBe(false);
  });

  // Boundary case requested explicitly: same real data, but 2km more driven
  // tips the balance from +1 to a small debt, proving the boundary crosses
  // exactly where hand-calculated (2795 - 2796 = -1), not off-by-one.
  it('regression: 2km more driven on the same real data crosses the balance from +1 to -1 km (debt boundary)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 1505,
      excessRateCents: 150,
      readings: [{ odometerMeters: 21128000, at: '2026-08-17T10:00:00Z' }],
      now: new Date('2026-08-17T16:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(2796);
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(2795);
    expect(status?.balanceKm).toBeCloseTo(-1);
    expect(status?.isOverLimit).toBe(true);
    expect(status?.overageKm).toBeCloseTo(1);
    expect(status?.overageCostCents).toBe(Math.round(1 * 150));
  });

  it('uses the explicit contract-start odometer as the baseline', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [
        { odometerMeters: 18332000, at: '2026-08-05T09:00:00Z' },
        { odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' },
      ],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    // latest reading 18622000 - baseline 18332000 = 290000m = 290km
    expect(status?.cumulativeUsageKm).toBe(290);
    // daysElapsed: Aug5,6,7 inclusive = 3 days -> (500/7)*3 = 214.2857...
    expect(status?.cumulativeAllowanceKm).toBeCloseTo((500 / 7) * 3);
    expect(status?.baselineIsEstimated).toBe(false);
  });

  it('falls back to the earliest-ever reading as the baseline when no explicit start odometer is given', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: null,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [
        { odometerMeters: 18332000, at: '2026-08-05T09:00:00Z' },
        { odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' },
      ],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(290);
    expect(status?.baselineIsEstimated).toBe(true);
  });

  it('cumulative usage never resets across what would have been a period boundary (weekend gap production shape)', () => {
    // Contract started Monday 2026-08-03 at odometer 0. A shift ends
    // Saturday at 500km; the car is driven privately over the weekend with
    // nothing logged (+200km); the next reading Wednesday is 900km. There
    // is no period-boundary concept anymore for this to get lost at.
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-03',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 1500,
      excessRateCents: 75,
      readings: [
        { odometerMeters: 500_000, at: '2026-08-08T18:00:00Z' },
        { odometerMeters: 900_000, at: '2026-08-12T18:00:00Z' },
      ],
      now: new Date('2026-08-12T19:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(900);
    // daysElapsed: Aug3..Aug12 inclusive = 10 days -> (1500/7)*10
    expect(status?.cumulativeAllowanceKm).toBeCloseTo((1500 / 7) * 10);
  });

  it('monthly: daily rate varies by which calendar month the elapsed day falls in (rate changes across a month boundary)', () => {
    // Contract started 2026-01-30, allowance 310km/month. daysElapsed
    // (Jan30, Jan31, Feb1, Feb2 inclusive) = 4 days: 2 days at Jan's rate
    // (310/31 = 10 km/day exactly) + 2 days at Feb's rate (310/28, Feb 2026
    // is not a leap year).
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-01-30',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'monthly',
      allowanceAmountKm: 310,
      excessRateCents: 100,
      readings: [{ odometerMeters: 1_000_000, at: '2026-02-02T12:00:00Z' }],
      now: new Date('2026-02-02T12:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(1000);
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(2 * (310 / 31) + 2 * (310 / 28));
  });

  it('flags over-limit once the cumulative balance goes negative, with an overage cost estimate', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [{ odometerMeters: 520_000, at: '2026-08-05T18:00:00Z' }],
      now: new Date('2026-08-05T19:00:00Z'),
    });
    // daysElapsed = 1 -> allowance = 500/7 ~= 71.43km
    expect(status?.isOverLimit).toBe(true);
    expect(status?.balanceKm).toBeCloseTo(500 / 7 - 520);
    expect(status?.overageKm).toBeCloseTo(520 - 500 / 7);
    expect(status?.overageCostCents).toBe(Math.round((520 - 500 / 7) * 150));
    expect(status?.remainingKm).toBe(0);
  });

  it('isNearLimit fires at >=90% cumulative usage', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 700, // daysElapsed=1 -> allowance = 100km
      excessRateCents: 150,
      readings: [{ odometerMeters: 95_000, at: '2026-08-05T18:00:00Z' }],
      now: new Date('2026-08-05T19:00:00Z'),
    });
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(100);
    expect(status?.isNearLimit).toBe(true);
    expect(status?.isOverLimit).toBe(false);
  });

  it('returns null when there are no readings at all', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status).toBeNull();
  });

  it('returns null for unlimited allowance', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'unlimited',
      allowanceAmountKm: null,
      excessRateCents: null,
      readings: [{ odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' }],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status).toBeNull();
  });

  it('returns null when allowanceAmountKm is null', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: null,
      excessRateCents: null,
      readings: [{ odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' }],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status).toBeNull();
  });
});
