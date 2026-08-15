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
  const readings: OdometerReading[] = [
    { odometerMeters: 18332000, at: '2026-08-05T09:00:00Z' }, // contract start reading (also passed explicitly below)
    { odometerMeters: 18522000, at: '2026-08-06T18:00:00Z' }, // end of a shift
    { odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' }, // start of next shift -- 100km gap is leisure driving
  ];

  it('uses the explicit contract-start odometer as the first period baseline', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings,
      now: new Date('2026-08-07T09:00:00Z'),
    });
    // latest reading 18622000 - baseline 18332000 = 290000m = 290km
    expect(status?.usageKm).toBe(290);
    expect(status?.percentUsed).toBeCloseTo(290 / 500);
    expect(status?.isNearLimit).toBe(false);
    expect(status?.isOverLimit).toBe(false);
    // explicit contract-start odometer was available -> baseline is exact, not estimated
    expect(status?.baselineIsEstimated).toBe(false);
    // 500km allowance - 290km used = 210km left this period
    expect(status?.remainingKm).toBe(210);
  });

  it('falls back to the earliest in-period reading when no explicit start odometer is given (mid-contract signup)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: null,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings, // first reading in-period (18332000) becomes the baseline itself
      now: new Date('2026-08-07T09:00:00Z'),
    });
    // baseline = first reading (18332000) itself -> usage = 18622000-18332000 = 290km, identical
    // result here, but arrived at via the fallback path, not the explicit odometer
    expect(status?.usageKm).toBe(290);
    // no explicit contract-start odometer -> baseline came from the fallback path, so it's estimated
    expect(status?.baselineIsEstimated).toBe(true);
  });

  it('flags near-limit at >=90% and over-limit at >=100%, with an overage cost estimate', () => {
    const heavyReadings: OdometerReading[] = [
      { odometerMeters: 0, at: '2026-08-05T09:00:00Z' },
      { odometerMeters: 520_000, at: '2026-08-06T18:00:00Z' }, // 520km, over a 500km allowance
    ];
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150, // R$1.50/km
      readings: heavyReadings,
      now: new Date('2026-08-06T19:00:00Z'),
    });
    expect(status?.isOverLimit).toBe(true);
    expect(status?.overageKm).toBe(20);
    expect(status?.overageCostCents).toBe(20 * 150);
    // Already over the allowance -- remainingKm clamps at 0, it never goes negative.
    expect(status?.remainingKm).toBe(0);
  });

  it('weekly allowance resets every Monday: a later calendar week is NOT treated as the "first period" even for a mid-week-started contract', () => {
    // Contract started Wed 2026-08-05 with an explicit baseline odometer.
    // The following calendar week (2026-08-10 Mon - 2026-08-17) is a
    // DIFFERENT period -- it must NOT reuse the original contract-start
    // odometer as its baseline (that would let unused allowance from week 1
    // carry over, or double-count already-driven km). It falls back to the
    // first reading actually logged inside week 2.
    const week2Readings: OdometerReading[] = [
      { odometerMeters: 19000000, at: '2026-08-11T09:00:00Z' }, // first reading of the new week
      { odometerMeters: 19100000, at: '2026-08-12T18:00:00Z' },
    ];
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000, // week 1's explicit baseline -- must NOT be reused here
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: week2Readings,
      now: new Date('2026-08-12T19:00:00Z'),
    });
    expect(status?.periodStart).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    expect(status?.periodEnd).toEqual(new Date('2026-08-17T00:00:00.000Z'));
    expect(status?.baselineIsEstimated).toBe(true);
    // baseline = first reading of week 2 (19000000) -> usage = 19100000-19000000 = 100km,
    // NOT 19100000-18332000 = 768km (which would happen if week 1's baseline leaked in)
    expect(status?.usageKm).toBe(100);
  });

  it('returns null for unlimited allowance (no tracking)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'unlimited',
      allowanceAmountKm: null,
      excessRateCents: null,
      readings,
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status).toBeNull();
  });
});
