import { test, expect, describe } from '@jest/globals';
import { computeConsumptionTrend, type FuelEntryForConsumption } from '../../src/utils/fuelConsumptionUtils';

describe('computeConsumptionTrend', () => {
  test('returns null with fewer than 2 entries', () => {
    expect(computeConsumptionTrend([])).toBeNull();
    expect(computeConsumptionTrend([{ odometer_meters: 1000, volume_ml: 40000, filled_at: '2026-08-01' }])).toBeNull();
  });

  test('overall reflects all-time distance/liters regardless of month (unchanged all-time behavior)', () => {
    const entries: FuelEntryForConsumption[] = [
      { odometer_meters: 0,        volume_ml: 40000, filled_at: '2026-01-05', full_tank: true },
      { odometer_meters: 500_000,  volume_ml: 40000, filled_at: '2026-03-10', full_tank: true },
      { odometer_meters: 1_000_000, volume_ml: 40000, filled_at: '2026-06-15', full_tank: true },
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
      { odometer_meters: 0,       volume_ml: 40000, filled_at: '2026-01-05', full_tank: true },
      { odometer_meters: 500_000, volume_ml: 40000, filled_at: '2026-03-10', full_tank: true },
      { odometer_meters: 900_000, volume_ml: 40000, filled_at: '2026-07-20', full_tank: true },
      // Two fills inside August 2026 — this is the only data that should
      // drive the widget once fixed.
      { odometer_meters: 920_000, volume_ml: 30000, filled_at: '2026-08-02', full_tank: true },
      { odometer_meters: 940_000, volume_ml: 30000, filled_at: '2026-08-05', full_tank: true },
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
      { odometer_meters: 0,       volume_ml: 40000, filled_at: '2026-01-05', full_tank: true },
      { odometer_meters: 500_000, volume_ml: 40000, filled_at: '2026-03-10', full_tank: true },
      { odometer_meters: 900_000, volume_ml: 40000, filled_at: '2026-07-20', full_tank: true },
      // Only one fill so far in August
      { odometer_meters: 920_000, volume_ml: 30000, filled_at: '2026-08-02', full_tank: true },
    ];
    const trend = computeConsumptionTrend(entries, now);
    expect(trend).not.toBeNull();
    expect(trend!.current_month).toBeNull();
  });

  test('entries from a previous month do not leak into current_month', () => {
    const now = new Date('2026-08-06');
    const entries: FuelEntryForConsumption[] = [
      { odometer_meters: 0,      volume_ml: 40000, filled_at: '2026-07-01', full_tank: true },
      { odometer_meters: 10_000, volume_ml: 40000, filled_at: '2026-07-15', full_tank: true },
      { odometer_meters: 20_000, volume_ml: 40000, filled_at: '2026-07-28', full_tank: true },
    ];
    const trend = computeConsumptionTrend(entries, now);
    expect(trend).not.toBeNull();
    expect(trend!.current_month).toBeNull();
  });

  test('recent (90-day) window still computed independently of current_month', () => {
    const now = new Date('2026-08-06');
    const entries: FuelEntryForConsumption[] = [
      { odometer_meters: 0,      volume_ml: 40000, filled_at: '2026-01-01', full_tank: true },
      { odometer_meters: 100_000, volume_ml: 40000, filled_at: '2026-05-20', full_tank: true },
      { odometer_meters: 150_000, volume_ml: 20000, filled_at: '2026-06-25', full_tank: true },
      { odometer_meters: 200_000, volume_ml: 20000, filled_at: '2026-07-30', full_tank: true },
    ];
    const trend = computeConsumptionTrend(entries, now);
    expect(trend).not.toBeNull();
    expect(trend!.recent).not.toBeNull();
    // 90-day cutoff from 2026-08-06 is 2026-05-08: the 01-01 fill is excluded,
    // the other 3 fills (05-20, 06-25, 07-30) fall inside the window → 2 segments.
    expect(trend!.recent!.segments).toBe(2);
  });

  // Regression test for the August 2026 production bug: "CONSUMO REAL" showed
  // "3162.3 KM/L MÉDIO" and "104764 KM CALCULADOS" from "1 ABASTEC." after a
  // driver swapped vehicles (old car → Renault Kwid). Root cause traced to
  // real production data (user db85eea7-8cd7-464d-ba68-05f1e8a15560): entries
  // are sorted by `odometer_meters` ascending instead of chronologically by
  // `filled_at`. A newly-swapped-in vehicle starts with a much LOWER odometer
  // than the outgoing vehicle's accumulated mileage, so odometer-ascending
  // sort places the new car's later fill *before* the old car's earlier fill,
  // producing a huge backwards-in-time "delta" that also crosses vehicles.
  describe('vehicle-swap regression (production Aug 2026 bug)', () => {
    test('reproduces the exact production figures under the OLD sort-by-odometer bug', () => {
      // Same two real rows that produced the bug in production, condensed to
      // isolate the sort-key defect (this asserts the diagnosis, not the fix).
      const buggyStatsFromEntries = (entries: FuelEntryForConsumption[]) => {
        const sorted = [...entries].sort((a, b) => a.odometer_meters - b.odometer_meters);
        const total_km = (sorted[sorted.length - 1].odometer_meters - sorted[0].odometer_meters) / 1000;
        const total_liters = sorted.slice(1).reduce((s, e) => s + e.volume_ml / 1000, 0);
        return { km_per_l: total_km / total_liters, total_km, total_liters, segments: sorted.length - 1 };
      };
      const aug3Tiggo = { odometer_meters: 123_375_000, volume_ml: 33129, filled_at: '2026-08-03T15:00:00Z' };
      const aug7Kwid = { odometer_meters: 18_611_000, volume_ml: 28639, filled_at: '2026-08-07T15:00:00Z' };
      const buggy = buggyStatsFromEntries([aug3Tiggo, aug7Kwid]);
      expect(buggy.total_km).toBeCloseTo(104_764, 0);
      expect(buggy.km_per_l).toBeCloseTo(3162.3, 1);
      expect(buggy.segments).toBe(1);
    });

    test('current_month never bridges a delta across two different vehicles (vehicle_id present)', () => {
      const now = new Date('2026-08-06');
      // Full noon-UTC timestamps throughout (instead of bare dates) so the
      // month-boundary comparison against `monthStart`/`monthEnd` (built from
      // local Y/M/1) can't accidentally shift an entry across the August
      // boundary depending on the test runner's timezone.
      const entries: FuelEntryForConsumption[] = [
        // Old vehicle (Tiggo): high, steadily-climbing odometer, matching the
        // real production scale (~118k–123k km).
        { odometer_meters: 118_000_000, volume_ml: 40000, filled_at: '2026-07-01T12:00:00Z', vehicle_id: 'car-tiggo', full_tank: true },
        { odometer_meters: 122_000_000, volume_ml: 40000, filled_at: '2026-07-15T12:00:00Z', vehicle_id: 'car-tiggo', full_tank: true },
        // Last Tiggo fill happens to land inside August, right before the swap.
        { odometer_meters: 123_000_000, volume_ml: 40000, filled_at: '2026-08-02T12:00:00Z', vehicle_id: 'car-tiggo', full_tank: true },
        // New vehicle (Kwid): much LOWER odometer — this is what breaks the
        // odometer-ascending sort.
        { odometer_meters: 5_000_000, volume_ml: 30000, filled_at: '2026-08-05T12:00:00Z', vehicle_id: 'car-kwid', full_tank: true },
        { odometer_meters: 5_300_000, volume_ml: 30000, filled_at: '2026-08-15T12:00:00Z', vehicle_id: 'car-kwid', full_tank: true },
        { odometer_meters: 5_600_000, volume_ml: 30000, filled_at: '2026-08-25T12:00:00Z', vehicle_id: 'car-kwid', full_tank: true },
      ];

      const trend = computeConsumptionTrend(entries, now);
      expect(trend).not.toBeNull();

      // current_month must reflect ONLY the Kwid's own August deltas
      // (5,600,000 - 5,000,000 = 600,000m = 600km), never a jump down from
      // the Tiggo's 123,000,000m reading.
      expect(trend!.current_month).not.toBeNull();
      expect(trend!.current_month!.total_km).toBeCloseTo(600, 3);
      expect(trend!.current_month!.total_liters).toBeCloseTo(60, 3); // skip-first within the Kwid run: 30+30
      expect(trend!.current_month!.km_per_l).toBeCloseTo(10, 3);
      expect(trend!.current_month!.segments).toBe(2);

      // overall must aggregate each vehicle's OWN internal trend (Tiggo:
      // 118,000,000→123,000,000 = 5,000km; Kwid: 5,000,000→5,600,000 = 600km)
      // rather than a single lifetime last-minus-first that would bridge the
      // two vehicles and go deeply negative/nonsensical.
      expect(trend!.overall.total_km).toBeCloseTo(5600, 3);
      expect(trend!.overall.segments).toBe(4);
    });

    test('with legacy data (no vehicle_id on any entry), the fix returns null instead of the bogus figure — known gap without a vehicle_id backfill', () => {
      const now = new Date('2026-08-06');
      const entries: FuelEntryForConsumption[] = [
        { odometer_meters: 118_000_000, volume_ml: 40000, filled_at: '2026-07-01' }, // vehicle_id omitted, like real legacy rows
        { odometer_meters: 122_000_000, volume_ml: 40000, filled_at: '2026-07-15' },
        { odometer_meters: 123_375_000, volume_ml: 33129, filled_at: '2026-08-03' }, // old vehicle's last fill
        { odometer_meters: 18_611_000, volume_ml: 28639, filled_at: '2026-08-07' }, // new vehicle's only fill, no vehicle_id to distinguish it
      ];

      // Without vehicle_id, the swap boundary is indistinguishable from a
      // same-vehicle odometer correction. Chronological sort makes every
      // delta that crosses the boundary come out negative — including
      // `overall`, which spans the full set — so the whole trend is null
      // rather than a huge fabricated figure. This is the correct, honest
      // result given the data available; a vehicle_id backfill on historical
      // rows would be needed to recover the real per-vehicle numbers instead.
      const trend = computeConsumptionTrend(entries, now);
      expect(trend).toBeNull();
    });

    // Regression test for the real production account (Eddie's own,
    // db85eea7-8cd7-464d-ba68-05f1e8a15560): unlike the "known gap" case
    // above, EVERY row here — old car (Tiggo, ~118k–123k km) AND new car
    // (Kwid, ~18.6k–19.6k km) — carries the SAME non-null vehicle_id, because
    // the vehicle record was reused for the new car instead of a fresh one
    // being created. vehicleKey never changes, so run-splitting by vehicle_id
    // alone never fires: the whole history is one run, first-to-last full-tank
    // spans the swap boundary, the delta goes negative, and — since it was
    // the only run — the ENTIRE trend (including the new car's own otherwise-
    // valid segment) came back null. The odometer-drop check must recover the
    // new car's segment even though vehicle_id gives no signal here.
    test('same vehicle_id reused across a car swap still isolates the new car (odometer-drop split)', () => {
      const now = new Date('2026-08-14');
      const entries: FuelEntryForConsumption[] = [
        // Only ONE Tiggo fill is full_tank — fullIdxs.length stays 1, so this
        // half of the run measures nothing on its own (isolates the
        // assertion below to "did the swap boundary block the Kwid's
        // segment", not "does an unrelated earlier Tiggo segment also
        // close").
        { odometer_meters: 117_988_000, volume_ml: 45610, filled_at: '2026-06-29T15:00:00Z', vehicle_id: 'v1', full_tank: true },
        { odometer_meters: 123_375_000, volume_ml: 33129, filled_at: '2026-08-03T15:00:00Z', vehicle_id: 'v1', full_tank: false },
        // Swap happens here — same vehicle_id, odometer drops by ~104,764km.
        { odometer_meters: 18_611_000, volume_ml: 28639, filled_at: '2026-08-07T15:00:00Z', vehicle_id: 'v1', full_tank: true },
        { odometer_meters: 18_925_000, volume_ml: 30311, filled_at: '2026-08-08T15:00:00Z', vehicle_id: 'v1', full_tank: true },
        { odometer_meters: 19_646_000, volume_ml: 30434, filled_at: '2026-08-11T15:00:00Z', vehicle_id: 'v1', full_tank: true },
      ];

      const trend = computeConsumptionTrend(entries, now);
      expect(trend).not.toBeNull();

      // overall must reflect ONLY the Kwid's two closed segments
      // (18,611→18,925 = 314km, 18,925→19,646 = 721km = 1,035km total),
      // never a bridge back to the Tiggo's 117,988,000m reading.
      expect(trend!.overall.total_km).toBeCloseTo(1035, 3);
      expect(trend!.overall.segments).toBe(2);
      expect(trend!.overall.km_per_l).toBeGreaterThan(0);
    });
  });

  // Full-tank-boundary method: a measured segment must start AND end on a
  // fill that topped the tank off to full — see statsFromEntries. These
  // tests cover that requirement directly (distinct from the vehicle-swap
  // tests above, which use full_tank: true throughout to isolate the
  // vehicle-boundary behavior from this one).
  describe('full-tank boundary requirement', () => {
    test('a single full-tank fill with no later full-tank fill measures nothing yet', () => {
      const entries: FuelEntryForConsumption[] = [
        { odometer_meters: 0,      volume_ml: 40000, filled_at: '2026-01-01', full_tank: true },
        { odometer_meters: 300_000, volume_ml: 20000, filled_at: '2026-01-10', full_tank: false },
      ];
      expect(computeConsumptionTrend(entries)).toBeNull();
    });

    test('two partial fills with no full-tank fill at all measure nothing', () => {
      const entries: FuelEntryForConsumption[] = [
        { odometer_meters: 0,      volume_ml: 20000, filled_at: '2026-01-01', full_tank: false },
        { odometer_meters: 300_000, volume_ml: 20000, filled_at: '2026-01-10', full_tank: false },
      ];
      expect(computeConsumptionTrend(entries)).toBeNull();
    });

    test('a partial fill between two full-tank fills still counts its liters (fuel added = fuel burned between full-to-full)', () => {
      const entries: FuelEntryForConsumption[] = [
        { odometer_meters: 0,       volume_ml: 40000, filled_at: '2026-01-01', full_tank: true },  // baseline — its own liters excluded
        { odometer_meters: 200_000, volume_ml: 15000, filled_at: '2026-01-05', full_tank: false }, // topped up partway, tank not yet full
        { odometer_meters: 400_000, volume_ml: 25000, filled_at: '2026-01-10', full_tank: true },  // closes the segment
      ];
      const trend = computeConsumptionTrend(entries, new Date('2026-01-11'));
      expect(trend).not.toBeNull();
      // km = 400,000 - 0 = 400km; liters = 15 (partial) + 25 (closing full) = 40L
      expect(trend!.overall.total_km).toBeCloseTo(400, 3);
      expect(trend!.overall.total_liters).toBeCloseTo(40, 3);
      expect(trend!.overall.km_per_l).toBeCloseTo(10, 3);
      expect(trend!.overall.segments).toBe(2);
    });

    test('fills before the first full-tank fill or after the last one are excluded from the measured span', () => {
      const entries: FuelEntryForConsumption[] = [
        { odometer_meters: 0,       volume_ml: 40000, filled_at: '2026-01-01', full_tank: false }, // before any full-tank baseline — excluded entirely
        { odometer_meters: 100_000, volume_ml: 40000, filled_at: '2026-01-05', full_tank: true },  // measured span starts here
        { odometer_meters: 300_000, volume_ml: 20000, filled_at: '2026-01-10', full_tank: true },  // measured span ends here
        { odometer_meters: 500_000, volume_ml: 40000, filled_at: '2026-01-20', full_tank: false }, // after the last full-tank fill — not yet closed, excluded
      ];
      const trend = computeConsumptionTrend(entries, new Date('2026-01-21'));
      expect(trend).not.toBeNull();
      // km = 300,000 - 100,000 = 200km (NOT 500,000 - 0 = 500km); liters = 20 (only the closing fill)
      expect(trend!.overall.total_km).toBeCloseTo(200, 3);
      expect(trend!.overall.total_liters).toBeCloseTo(20, 3);
      expect(trend!.overall.segments).toBe(1);
    });
  });
});
