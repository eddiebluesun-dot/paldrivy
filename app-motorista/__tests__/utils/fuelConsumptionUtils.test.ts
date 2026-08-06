import { test, expect, describe } from '@jest/globals';
import { computeConsumptionTrend, type FuelEntryForConsumption } from '../../src/utils/fuelConsumptionUtils';

describe('computeConsumptionTrend', () => {
  test('returns null with fewer than 2 entries', () => {
    expect(computeConsumptionTrend([])).toBeNull();
    expect(computeConsumptionTrend([{ odometer_meters: 1000, volume_ml: 40000, filled_at: '2026-08-01' }])).toBeNull();
  });

  test('overall reflects all-time distance/liters regardless of month (unchanged all-time behavior)', () => {
    const entries: FuelEntryForConsumption[] = [
      { odometer_meters: 0,        volume_ml: 40000, filled_at: '2026-01-05' },
      { odometer_meters: 500_000,  volume_ml: 40000, filled_at: '2026-03-10' },
      { odometer_meters: 1_000_000, volume_ml: 40000, filled_at: '2026-06-15' },
    ];
    const trend = computeConsumptionTrend(entries, new Date('2026-08-06'));
    expect(trend).not.toBeNull();
    expect(trend!.overall.total_km).toBeCloseTo(1000, 3); // (1,000,000 - 0) / 1000
    expect(trend!.overall.segments).toBe(2);
  });

  // Regression test for the reported bug: "CONSUMO REAL" widget showed
  // 5387 km (lifetime total) instead of the km driven in the current month.
  test('current_month is scoped to the reference month, not lifetime — bug regression', () => {
    const now = new Date('2026-08-06');
    const entries: FuelEntryForConsumption[] = [
      // Lots of historical fills far outside August 2026 (this is what
      // inflated "overall.total_km" to an implausible lifetime figure).
      { odometer_meters: 0,       volume_ml: 40000, filled_at: '2026-01-05' },
      { odometer_meters: 500_000, volume_ml: 40000, filled_at: '2026-03-10' },
      { odometer_meters: 900_000, volume_ml: 40000, filled_at: '2026-07-20' },
      // Two fills inside August 2026 — this is the only data that should
      // drive the widget once fixed.
      { odometer_meters: 920_000, volume_ml: 30000, filled_at: '2026-08-02' },
      { odometer_meters: 940_000, volume_ml: 30000, filled_at: '2026-08-05' },
    ];

    const trend = computeConsumptionTrend(entries, now);
    expect(trend).not.toBeNull();

    // Lifetime figure stays available under `overall` (used elsewhere, e.g.
    // the vehicle pill's all-time average) but must NOT be what the monthly
    // widget reads.
    expect(trend!.overall.total_km).toBeCloseTo(940, 3);

    // The month-scoped figure must reflect only the August deltas: 940,000 - 920,000 = 20,000m = 20km
    expect(trend!.current_month).not.toBeNull();
    expect(trend!.current_month!.total_km).toBeCloseTo(20, 3);
    expect(trend!.current_month!.total_liters).toBeCloseTo(30, 3); // slice(1): only the 2nd August fill
    expect(trend!.current_month!.segments).toBe(1);
  });

  test('current_month is null when fewer than 2 fills fall inside the month', () => {
    const now = new Date('2026-08-06');
    const entries: FuelEntryForConsumption[] = [
      { odometer_meters: 0,       volume_ml: 40000, filled_at: '2026-01-05' },
      { odometer_meters: 500_000, volume_ml: 40000, filled_at: '2026-03-10' },
      { odometer_meters: 900_000, volume_ml: 40000, filled_at: '2026-07-20' },
      // Only one fill so far in August
      { odometer_meters: 920_000, volume_ml: 30000, filled_at: '2026-08-02' },
    ];
    const trend = computeConsumptionTrend(entries, now);
    expect(trend).not.toBeNull();
    expect(trend!.current_month).toBeNull();
  });

  test('entries from a previous month do not leak into current_month', () => {
    const now = new Date('2026-08-06');
    const entries: FuelEntryForConsumption[] = [
      { odometer_meters: 0,      volume_ml: 40000, filled_at: '2026-07-01' },
      { odometer_meters: 10_000, volume_ml: 40000, filled_at: '2026-07-15' },
      { odometer_meters: 20_000, volume_ml: 40000, filled_at: '2026-07-28' },
    ];
    const trend = computeConsumptionTrend(entries, now);
    expect(trend).not.toBeNull();
    expect(trend!.current_month).toBeNull();
  });

  test('recent (90-day) window still computed independently of current_month', () => {
    const now = new Date('2026-08-06');
    const entries: FuelEntryForConsumption[] = [
      { odometer_meters: 0,      volume_ml: 40000, filled_at: '2026-01-01' },
      { odometer_meters: 100_000, volume_ml: 40000, filled_at: '2026-05-20' },
      { odometer_meters: 150_000, volume_ml: 20000, filled_at: '2026-06-25' },
      { odometer_meters: 200_000, volume_ml: 20000, filled_at: '2026-07-30' },
    ];
    const trend = computeConsumptionTrend(entries, now);
    expect(trend).not.toBeNull();
    expect(trend!.recent).not.toBeNull();
    // 90-day cutoff from 2026-08-06 is 2026-05-08: the 01-01 fill is excluded,
    // the other 3 fills (05-20, 06-25, 07-30) fall inside the window → 2 segments.
    expect(trend!.recent!.segments).toBe(2);
  });
});
