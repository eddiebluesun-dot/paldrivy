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

  it('uses the explicit contract-start odometer as the baseline, for both period and cumulative usage, in the first period', () => {
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
    expect(status?.periodIndex).toBe(0);
    expect(status?.periodUsageKm).toBe(290);
    expect(status?.cumulativeUsageKm).toBe(290);
    expect(status?.cumulativeAllowanceKm).toBe(500); // allowanceAmountKm * (periodIndex 0 + 1)
    expect(status?.balanceKm).toBe(210);
    expect(status?.isNearLimit).toBe(false);
    expect(status?.isOverLimit).toBe(false);
    // explicit contract-start odometer was available -> baseline is exact, not estimated
    expect(status?.baselineIsEstimated).toBe(false);
    expect(status?.remainingKm).toBe(210);
  });

  it('falls back to the earliest-ever reading as the cumulative baseline when no explicit start odometer is given (mid-contract signup)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: null,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings, // first reading ever (18332000) becomes the baseline itself
      now: new Date('2026-08-07T09:00:00Z'),
    });
    // baseline = first reading (18332000) itself -> usage = 18622000-18332000 = 290km, identical
    // result here, but arrived at via the fallback path, not the explicit odometer
    expect(status?.periodUsageKm).toBe(290);
    expect(status?.cumulativeUsageKm).toBe(290);
    // no explicit contract-start odometer -> baseline came from the fallback path, so it's estimated
    expect(status?.baselineIsEstimated).toBe(true);
  });

  it('flags over-limit once the CUMULATIVE balance goes negative, with an overage cost estimate', () => {
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
    expect(status?.balanceKm).toBe(-20);
    expect(status?.overageKm).toBe(20);
    expect(status?.overageCostCents).toBe(20 * 150);
    // Already over the allowance -- remainingKm clamps at 0, it never goes negative.
    expect(status?.remainingKm).toBe(0);
  });

  it('a later period reuses the SAME contract-lifetime baseline for cumulative usage (never resets), but periodUsageKm stays scoped to that period alone', () => {
    // Contract started Wed 2026-08-05 with an explicit baseline odometer
    // (18332000). "now" falls in the FOLLOWING calendar week (2026-08-10
    // Mon - 2026-08-17), periodIndex 1. Only that week's own 2 readings are
    // passed in -- no week-1 readings at all -- to isolate what each number
    // does with a real boundary in the data.
    const week2Readings: OdometerReading[] = [
      { odometerMeters: 19000000, at: '2026-08-11T09:00:00Z' }, // first reading of week 2
      { odometerMeters: 19100000, at: '2026-08-12T18:00:00Z' },
    ];
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: week2Readings,
      now: new Date('2026-08-12T19:00:00Z'),
    });
    expect(status?.periodStart).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    expect(status?.periodEnd).toEqual(new Date('2026-08-17T00:00:00.000Z'));
    expect(status?.periodIndex).toBe(1);
    // periodUsageKm: no reading exists before this period started (the test
    // deliberately passes only week-2 data), so it falls back to the first
    // in-period reading (19000000) -> 19100000-19000000 = 100km.
    expect(status?.periodUsageKm).toBe(100);
    // cumulativeUsageKm: the baseline is STILL the contract's original
    // explicit odometer (18332000), reused unchanged in period 1 -- this is
    // the fix for the boundary-gap bug: 19100000-18332000 = 768km. Under the
    // old per-period-reset design this 768 would have been impossible to
    // see (period 2's baseline would have reset to 19000000, silently
    // discarding the distance between 18332000 and 19000000).
    expect(status?.cumulativeUsageKm).toBe(768);
    expect(status?.cumulativeAllowanceKm).toBe(1000); // 500 * (periodIndex 1 + 1)
    expect(status?.balanceKm).toBe(232);
    expect(status?.isOverLimit).toBe(false);
    expect(status?.isNearLimit).toBe(false); // 768/1000 = 76.8%, under 90%
  });

  it('regression: km driven in the gap between two periods (no shift/fuel entry logged) is never lost, and shows up on the bar of the period where the bridging reading landed', () => {
    // Real production shape (2026-08-15, Eddie): a shift ends Saturday, the
    // car is driven privately over the weekend with nothing logged, and the
    // next shift starts Monday. Modeled here with round numbers: contract
    // started Monday 2026-08-03 at odometer 0. Week 1 [Aug 3, Aug 10) has one
    // shift ending Sat Aug 8 at 500km. Over the weekend the odometer climbs
    // by 200km with nothing logged. Week 2 [Aug 10, Aug 17) picks back up
    // Monday at 700km (that Monday reading is itself the first evidence of
    // the 200km gap), then another 200km is driven and logged Wednesday at
    // 900km.
    const readings: OdometerReading[] = [
      { odometerMeters: 500_000, at: '2026-08-08T18:00:00Z' }, // Sat, week 1's last reading
      { odometerMeters: 700_000, at: '2026-08-10T08:00:00Z' }, // Mon, week 2's first reading -- already includes the weekend's 200km
      { odometerMeters: 900_000, at: '2026-08-12T18:00:00Z' }, // Wed, week 2
    ];
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-03',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 1500,
      excessRateCents: 75,
      readings,
      now: new Date('2026-08-12T19:00:00Z'),
    });
    expect(status?.periodIndex).toBe(1);
    // Cumulative usage is a straight odometer diff since contract start --
    // it is structurally impossible for it to lose the weekend gap, because
    // there is no period-boundary reset to lose it at: 900000 - 0 = 900km.
    expect(status?.cumulativeUsageKm).toBe(900);
    expect(status?.cumulativeAllowanceKm).toBe(3000); // 1500 * (periodIndex 1 + 1)
    expect(status?.balanceKm).toBe(2100);
    // periodUsageKm (week 2's bar): baseline is the most recent reading
    // AT OR BEFORE this period's start (Aug 10 00:00) -- that's Saturday's
    // 500000 reading, not Monday's own 700000 -- so week 2's bar correctly
    // shows the bridged weekend gap plus its own Wednesday driving:
    // 900000 - 500000 = 400km (200km gap + 200km logged this week).
    expect(status?.periodUsageKm).toBe(400);
  });

  it('a single heavy period does not trigger the over-limit alert when the cumulative balance still covers it (banked surplus from earlier periods)', () => {
    // Contract started Monday 2026-08-03 at odometer 0, 1500km/week. By the
    // start of week 4 (periodIndex 3, period start Aug 24) only 1000km total
    // has been driven -- well under the 3 weeks' worth of allowance already
    // granted (4500km) -- then week 4 alone drives 2000km, MORE than that
    // single week's own 1500km nominal allowance.
    const readings: OdometerReading[] = [
      { odometerMeters: 1_000_000, at: '2026-08-20T12:00:00Z' }, // Thu, week 3: 1000km cumulative so far
      { odometerMeters: 3_000_000, at: '2026-08-26T12:00:00Z' }, // Wed, week 4: +2000km in this week alone
    ];
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-03',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 1500,
      excessRateCents: 75,
      readings,
      now: new Date('2026-08-26T13:00:00Z'),
    });
    expect(status?.periodIndex).toBe(3);
    // This period alone drove 2000km, over its own 1500km nominal allowance --
    // proof the per-period number would have been "over limit" under the old design.
    expect(status?.periodUsageKm).toBe(2000);
    expect(status?.periodAllowanceKm).toBe(1500);
    // But cumulative usage (3000km) is well inside the cumulative allowance
    // banked across 4 weeks (1500 * 4 = 6000km), so no alert fires.
    expect(status?.cumulativeUsageKm).toBe(3000);
    expect(status?.cumulativeAllowanceKm).toBe(6000);
    expect(status?.balanceKm).toBe(3000);
    expect(status?.isOverLimit).toBe(false);
    expect(status?.isNearLimit).toBe(false); // 3000/6000 = 50%
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
