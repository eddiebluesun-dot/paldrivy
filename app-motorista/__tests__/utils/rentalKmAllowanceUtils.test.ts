import { getPeriodBounds, computeRentalAllowanceStatus, type OdometerReading } from '@/src/utils/rentalKmAllowanceUtils';

describe('getPeriodBounds', () => {
  it('returns null for unlimited', () => {
    expect(getPeriodBounds('2026-08-05', 'unlimited', new Date('2026-08-20'))).toBeNull();
  });

  it('computes the current weekly period from the contract start date', () => {
    // contract started Wed 2026-08-05; "now" is 10 days later (2026-08-15,
    // a Saturday) -> period 2 is [2026-08-12, 2026-08-19)
    const bounds = getPeriodBounds('2026-08-05', 'weekly', new Date('2026-08-15T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-08-12T00:00:00.000Z'),
      periodEnd: new Date('2026-08-19T00:00:00.000Z'),
    });
  });

  it('computes the current monthly period from the contract start date', () => {
    // contract started 2026-08-05; "now" is 2026-09-10 -> period 2 is [2026-09-05, 2026-10-05)
    const bounds = getPeriodBounds('2026-08-05', 'monthly', new Date('2026-09-10T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-09-05T00:00:00.000Z'),
      periodEnd: new Date('2026-10-05T00:00:00.000Z'),
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
