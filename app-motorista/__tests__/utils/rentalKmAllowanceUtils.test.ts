import { getPeriodBounds, computeRentalAllowanceStatus, getAllowanceCycleBounds, type OdometerReading } from '@/src/utils/rentalKmAllowanceUtils';

describe('getAllowanceCycleBounds', () => {
  it('daily: cycleIndex is days elapsed since contract start, cycle is exactly 1 day', () => {
    const bounds = getAllowanceCycleBounds('2026-08-05', 'daily', null, new Date('2026-08-08T15:00:00Z'));
    expect(bounds).toEqual({
      cycleStart: new Date('2026-08-08T00:00:00.000Z'),
      cycleEnd: new Date('2026-08-09T00:00:00.000Z'),
      cycleIndex: 3,
    });
  });

  it('monthly: fixed 30-day rolling window anchored to contractStartDate, no calendar-month clamping', () => {
    // 31 days after 2026-08-05 -> day 31 falls in the SECOND 30-day block (days 31-60), cycleIndex 1.
    const bounds = getAllowanceCycleBounds('2026-08-05', 'monthly', null, new Date('2026-09-05T12:00:00Z'));
    expect(bounds).toEqual({
      cycleStart: new Date('2026-09-04T00:00:00.000Z'), // contractStart + 30 days
      cycleEnd: new Date('2026-10-04T00:00:00.000Z'),
      cycleIndex: 1,
    });
  });

  it('weekly: cycle 0 contains contractStartDate regardless of weekStartDay, even when the week starts BEFORE the contract', () => {
    // Contract started Wed 2026-08-05, week starts Monday -> cycle 0 is [Aug 3, Aug 10).
    const bounds = getAllowanceCycleBounds('2026-08-05', 'weekly', 1, new Date('2026-08-05T12:00:00Z'));
    expect(bounds).toEqual({
      cycleStart: new Date('2026-08-03T00:00:00.000Z'),
      cycleEnd: new Date('2026-08-10T00:00:00.000Z'),
      cycleIndex: 0,
    });
  });

  it('weekly: cycleIndex advances by 1 each configured week-start weekday, regardless of contract start weekday', () => {
    // "now" = 2026-08-19 (Wednesday) -> current week is [Aug 17, Aug 24), 2 full weeks after
    // the contract-start week (which began Mon Aug 3) -> cycleIndex 2.
    const bounds = getAllowanceCycleBounds('2026-08-05', 'weekly', 1, new Date('2026-08-19T12:00:00Z'));
    expect(bounds).toEqual({
      cycleStart: new Date('2026-08-17T00:00:00.000Z'),
      cycleEnd: new Date('2026-08-24T00:00:00.000Z'),
      cycleIndex: 2,
    });
  });

  it('weekly: defaults weekStartDay to Monday (1) when null', () => {
    const withNull = getAllowanceCycleBounds('2026-08-05', 'weekly', null, new Date('2026-08-19T12:00:00Z'));
    const withMonday = getAllowanceCycleBounds('2026-08-05', 'weekly', 1, new Date('2026-08-19T12:00:00Z'));
    expect(withNull).toEqual(withMonday);
  });

  it('weekly: a different week-start day (e.g. Sunday=0) shifts the boundary', () => {
    // now = Sunday 2026-08-16 -> with week starting Sunday, "now" itself IS the boundary.
    const bounds = getAllowanceCycleBounds('2026-08-05', 'weekly', 0, new Date('2026-08-16T12:00:00Z'));
    expect(bounds.cycleStart).toEqual(new Date('2026-08-16T00:00:00.000Z'));
    expect(bounds.cycleEnd).toEqual(new Date('2026-08-23T00:00:00.000Z'));
  });
});

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

// Real production odometer readings for Eddie's rental Kwid (vehicle_id
// 4483a9f5-10b0-442c-9732-415a1dc27264), pulled 2026-08-19 via Supabase
// execute_sql against public.shifts and public.fuel_entries, built exactly
// as src/services/rentalAllowance.ts assembles readings (shift start tagged
// with started_at, shift end tagged with ended_at, fuel entries tagged with
// filled_at). Contract start 2026-08-05 at odometer 18332000. This is the
// dataset the owner hand-verified against his real Localiza contract --
// see docs/superpowers/specs/2026-08-19-km-allowance-cycle-generalization-design.md.
const EDDIE_REAL_READINGS: OdometerReading[] = [
  { odometerMeters: 18376000, at: '2026-08-06T08:48:00.000Z' },
  { odometerMeters: 18626000, at: '2026-08-06T21:15:00.000Z' },
  { odometerMeters: 18643000, at: '2026-08-07T12:42:50.320Z' },
  { odometerMeters: 18611000, at: '2026-08-07T15:00:00.000Z' },
  { odometerMeters: 18853000, at: '2026-08-07T20:33:42.634Z' },
  { odometerMeters: 18861000, at: '2026-08-08T09:04:42.313Z' },
  { odometerMeters: 18925000, at: '2026-08-08T15:00:00.000Z' },
  { odometerMeters: 19070000, at: '2026-08-08T16:44:24.373Z' },
  { odometerMeters: 19088000, at: '2026-08-09T10:36:00.000Z' },
  { odometerMeters: 19228000, at: '2026-08-09T15:21:00.000Z' },
  { odometerMeters: 19228000, at: '2026-08-10T09:54:03.178Z' },
  { odometerMeters: 19300000, at: '2026-08-10T12:51:02.482Z' },
  { odometerMeters: 19302000, at: '2026-08-10T14:57:00.000Z' },
  { odometerMeters: 19302000, at: '2026-08-10T15:00:00.000Z' },
  { odometerMeters: 19231000, at: '2026-08-10T15:00:00.000Z' },
  { odometerMeters: 19474000, at: '2026-08-10T22:06:00.000Z' },
  { odometerMeters: 19474000, at: '2026-08-11T08:40:00.000Z' },
  { odometerMeters: 19646000, at: '2026-08-11T15:00:00.000Z' },
  { odometerMeters: 19818000, at: '2026-08-11T21:46:00.000Z' },
  { odometerMeters: 19818000, at: '2026-08-12T09:13:00.000Z' },
  { odometerMeters: 20034000, at: '2026-08-12T15:00:00.000Z' },
  { odometerMeters: 19841000, at: '2026-08-12T15:00:00.000Z' },
  { odometerMeters: 20107000, at: '2026-08-12T22:06:00.000Z' },
  { odometerMeters: 20107000, at: '2026-08-13T09:23:25.776Z' },
  { odometerMeters: 20271000, at: '2026-08-13T15:00:00.000Z' },
  { odometerMeters: 20274000, at: '2026-08-13T16:58:39.625Z' },
  { odometerMeters: 20282000, at: '2026-08-13T18:47:00.000Z' },
  { odometerMeters: 20365000, at: '2026-08-13T22:30:00.000Z' },
  { odometerMeters: 20365000, at: '2026-08-14T09:06:00.000Z' },
  { odometerMeters: 20566000, at: '2026-08-14T16:36:00.000Z' },
  { odometerMeters: 20584000, at: '2026-08-15T08:57:00.000Z' },
  { odometerMeters: 20586000, at: '2026-08-15T15:00:00.000Z' },
  { odometerMeters: 20739000, at: '2026-08-15T15:46:00.000Z' },
  { odometerMeters: 20853000, at: '2026-08-17T12:44:39.292Z' },
  { odometerMeters: 20833000, at: '2026-08-17T15:00:00.000Z' },
  { odometerMeters: 21126000, at: '2026-08-17T21:55:48.192Z' },
  { odometerMeters: 21143000, at: '2026-08-18T12:15:00.000Z' },
  { odometerMeters: 21167000, at: '2026-08-18T15:00:00.000Z' },
  { odometerMeters: 21372000, at: '2026-08-18T22:04:00.000Z' },
];

function eddieStatusAt(now: Date) {
  return computeRentalAllowanceStatus({
    contractStartDate: '2026-08-05',
    contractStartOdometerMeters: 18332000,
    cycleType: 'weekly',
    weekStartDay: 1,
    allowanceAmountKm: 1505,
    excessRateCents: 75,
    readings: EDDIE_REAL_READINGS.filter(r => new Date(r.at).getTime() <= now.getTime()),
    now,
  });
}

describe('computeRentalAllowanceStatus — real-data regression (Eddie, vehicle 4483a9f5, hand-verified against the Localiza contract)', () => {
  it('week 1 (partial, 05-09/08): 896 km used, 1075 km allowance (1505 * 5/7 prorated), +179 balance', () => {
    const status = eddieStatusAt(new Date('2026-08-09T20:00:00.000Z'));
    expect(status?.cumulativeUsageKm).toBe(896);
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(1075);
    expect(status?.balanceKm).toBeCloseTo(179);
  });

  it('week 2 usage bridges the weekend gap to 1625 km, NOT 1511 km (regression: a trailing gap belongs to the cycle it happened in, not the one that reveals it)', () => {
    const week1End = eddieStatusAt(new Date('2026-08-09T20:00:00.000Z'));

    // Naive/WRONG snapshot: only data available strictly within week 2's own
    // calendar bounds (Sunday night, before week 3's Monday reading exists).
    // This reproduces the exact 1511 undercount the owner flagged as wrong.
    const naiveWeek2Close = eddieStatusAt(new Date('2026-08-16T20:00:00.000Z'));
    expect(naiveWeek2Close!.cumulativeUsageKm - week1End!.cumulativeUsageKm).toBe(1511);

    // Correct snapshot: once week 3's first reading (Mon 2026-08-17 12:44
    // shift start) is known, the SAME subtraction yields the true 1625 --
    // the 114km weekend gap is now counted, attributed back to week 2.
    const onceWeek3RevealsIt = eddieStatusAt(new Date('2026-08-17T13:00:00.000Z'));
    expect(onceWeek3RevealsIt!.cumulativeUsageKm).toBe(2521); // 896 + 1625
    expect(onceWeek3RevealsIt!.cumulativeUsageKm - week1End!.cumulativeUsageKm).toBe(1625);

    // The owner's own manual ledger: prevBalance + week2Allowance - week2Usage.
    const week2Balance = 179 + 1505 - 1625;
    expect(week2Balance).toBe(59);
  });

  it('week 3 (open, live as of 2026-08-19): 519 km current-cycle usage, 3040 km cumulative usage, +1045 cumulative balance', () => {
    const status = eddieStatusAt(new Date('2026-08-19T12:00:00.000Z'));
    expect(status?.cumulativeUsageKm).toBe(3040); // 896 + 1625 + 519
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(4085); // 1075 + 1505*2
    expect(status?.balanceKm).toBeCloseTo(1045);
    expect(status?.currentCycleUsageKm).toBe(519); // 21372000 - 20853000 (first reading of week 3)
    expect(status?.isOverLimit).toBe(false);
  });
});

describe('computeRentalAllowanceStatus — cycle mechanics', () => {
  it('daily: full daily allowance granted at each day boundary, no proration ever (cycle 0 anchors exactly to contractStartDate)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      cycleType: 'daily',
      weekStartDay: null,
      allowanceAmountKm: 200,
      excessRateCents: 100,
      readings: [{ odometerMeters: 450_000, at: '2026-08-07T10:00:00Z' }], // day index 2 (Aug5=0,Aug6=1,Aug7=2)
      now: new Date('2026-08-07T12:00:00Z'),
    });
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(600); // 200 * (cycleIndex 2 + 1 cycles) = 200*3
    expect(status?.cumulativeUsageKm).toBe(450);
    expect(status?.balanceKm).toBeCloseTo(150);
  });

  it('monthly: fixed 30-day block, no calendar clamping -- full allowance granted at day 30, not varying by month length', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-01-30',
      contractStartOdometerMeters: 0,
      cycleType: 'monthly',
      weekStartDay: null,
      allowanceAmountKm: 300,
      excessRateCents: 100,
      readings: [{ odometerMeters: 100_000, at: '2026-03-02T00:00:00Z' }], // 31 days after Jan 30 -> cycleIndex 1
      now: new Date('2026-03-02T00:00:00Z'),
    });
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(600); // cycle 0 (300, never prorated) + cycle 1 (300)
    expect(status?.cumulativeUsageKm).toBe(100);
  });

  it('uncapped/informational mode: allowanceAmountKm null returns cumulative + current-cycle usage but no balance/limit fields', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      cycleType: 'weekly',
      weekStartDay: 1,
      allowanceAmountKm: null,
      excessRateCents: null,
      readings: [
        { odometerMeters: 18332000, at: '2026-08-05T09:00:00Z' },
        { odometerMeters: 18400000, at: '2026-08-17T09:00:00Z' }, // first reading of the current (week 3) cycle
        { odometerMeters: 18459000, at: '2026-08-19T09:00:00Z' },
      ],
      now: new Date('2026-08-19T12:00:00Z'),
    });
    expect(status).not.toBeNull();
    expect(status?.cumulativeUsageKm).toBe(127); // 18459000 - 18332000, since contract start
    expect(status?.currentCycleUsageKm).toBe(59); // 18459000 - 18400000, since this cycle's own first reading
    expect(status?.cumulativeAllowanceKm).toBeNull();
    expect(status?.balanceKm).toBeNull();
    expect(status?.overageKm).toBeNull();
    expect(status?.overageCostCents).toBeNull();
    expect(status?.remainingKm).toBeNull();
    expect(status?.isNearLimit).toBe(false);
    expect(status?.isOverLimit).toBe(false);
  });

  it('uses the explicit contract-start odometer as the baseline', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      cycleType: 'weekly',
      weekStartDay: 1,
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [
        { odometerMeters: 18332000, at: '2026-08-05T09:00:00Z' },
        { odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' },
      ],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(290);
    expect(status?.baselineIsEstimated).toBe(false);
  });

  it('falls back to the earliest-ever reading as the baseline when no explicit start odometer is given', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: null,
      cycleType: 'weekly',
      weekStartDay: 1,
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

  it('flags over-limit once the cumulative balance goes negative, with an overage cost estimate', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      cycleType: 'weekly',
      weekStartDay: 1,
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [{ odometerMeters: 520_000, at: '2026-08-05T18:00:00Z' }],
      now: new Date('2026-08-05T19:00:00Z'),
    });
    // cycle 0 for a Wed contract start with Monday week-start is prorated 5/7 -> 500*5/7 ~= 357.14
    expect(status?.isOverLimit).toBe(true);
    expect(status?.balanceKm).toBeCloseTo((500 * 5) / 7 - 520);
    expect(status?.overageKm).toBeCloseTo(520 - (500 * 5) / 7);
    expect(status?.overageCostCents).toBe(Math.round((520 - (500 * 5) / 7) * 150));
  });

  it('isNearLimit fires at >=90% cumulative usage', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      cycleType: 'weekly',
      weekStartDay: 1,
      allowanceAmountKm: 700,
      excessRateCents: 150,
      readings: [{ odometerMeters: 460_000, at: '2026-08-05T18:00:00Z' }], // cycle0 allowance = 700*5/7 = 500; 460/500 = 92%
      now: new Date('2026-08-05T19:00:00Z'),
    });
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(500);
    expect(status?.isNearLimit).toBe(true);
    expect(status?.isOverLimit).toBe(false);
  });

  it('returns null when there are no readings at all', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      cycleType: 'weekly',
      weekStartDay: 1,
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status).toBeNull();
  });
});
