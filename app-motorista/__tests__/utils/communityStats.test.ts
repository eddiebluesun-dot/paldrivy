import { test, expect, describe } from '@jest/globals';
import { buildPlatformBreakdown, computeCommunityMetrics } from '../../src/utils/communityStats';

describe('buildPlatformBreakdown', () => {
  test('aggregates same-named platforms across shifts and computes pct', () => {
    const result = buildPlatformBreakdown([
      { platform_name: 'Uber', amount_cents: 7300 },
      { platform_name: '99', amount_cents: 15292 },
      { platform_name: 'Uber', amount_cents: 2700 },
    ]);
    expect(result).toEqual([
      { name: '99',   gross_cents: 15292, pct: 60.46 },
      { name: 'Uber', gross_cents: 10000, pct: 39.54 },
    ]);
  });

  test('empty input returns empty array', () => {
    expect(buildPlatformBreakdown([])).toEqual([]);
  });
});

describe('computeCommunityMetrics', () => {
  test('computes averages from totals', () => {
    const result = computeCommunityMetrics({
      gross_cents: 30592,
      net_cents: 30592,
      duration_seconds: 33821, // 9h23m41s
      km_meters: 139800,
      rides_count: 20,
      shifts_count: 2,
    });
    expect(result).toEqual({
      earnings_today_cents: 30592,
      net_cents: 30592,
      avg_per_hour_cents: 3256, // 30592 / (33821/3600)
      avg_per_km_cents: 219,    // 30592 / 139.8
      total_duration_seconds: 33821,
      total_km_meters: 139800,
      rides_count: 20,
      avg_per_ride_cents: 1530, // 30592 / 20
      shifts_count: 2,
      avg_duration_per_shift_seconds: 16911, // 33821 / 2, rounded
    });
  });

  test('zero duration/km/rides/shifts never divides by zero', () => {
    const result = computeCommunityMetrics({
      gross_cents: 0, net_cents: 0, duration_seconds: 0, km_meters: 0, rides_count: 0, shifts_count: 0,
    });
    expect(result.avg_per_hour_cents).toBe(0);
    expect(result.avg_per_km_cents).toBe(0);
    expect(result.avg_per_ride_cents).toBe(0);
    expect(result.avg_duration_per_shift_seconds).toBe(0);
  });
});
