// Pure, side-effect-free helpers for fuel consumption stats (no Supabase import).
// Extracted so scoping bugs (dashboard showed all-time km instead of the
// selected month's km; odometer deltas bridging two different vehicles) can
// be unit tested without mocking Supabase.

export interface FuelEntryForConsumption {
  odometer_meters: number;
  volume_ml: number;
  filled_at: string;
  // Optional because legacy rows may not have it. Entries with no vehicle_id
  // are grouped together (null/undefined normalized to the same bucket) —
  // see statsFromEntries for why this is a known limitation, not a fix.
  vehicle_id?: string | null;
  // Whether this fill topped the tank off to full. Required at both ends of
  // a measured segment — see statsFromEntries for why.
  full_tank?: boolean | null;
}

export interface ConsumptionStats {
  km_per_l: number;
  total_km: number;
  total_liters: number;
  segments: number;
}

export interface ConsumptionTrend {
  overall: ConsumptionStats;
  recent: ConsumptionStats | null;
  // Full-tank-segment method (see statsFromEntries) — the only sound way to
  // compute a real km/L figure, but it necessarily EXCLUDES liters/km at the
  // edges of the month (the opening fill's liters, any fill not yet closed
  // by a later full-tank) — see current_month_totals for the true sums.
  current_month: ConsumptionStats | null;
  // True calendar-month totals: every fill in the month counts, regardless
  // of whether it falls inside a closed full-tank segment. Answers "how much
  // did I actually spend/drive/fill up this month" -- current_month answers
  // "what's my measured efficiency this month," a narrower, different
  // question. Both can be non-null independently (e.g. one fill this month
  // with no closed segment yet: totals exist, current_month doesn't).
  current_month_totals: { km_driven: number; total_liters: number; fill_count: number } | null;
  change_pct: number | null;
}

// Full-tank method: a measured segment must start AND end on a fill that
// topped the tank off to full. Between two full-tank fills, every drop of
// fuel put in — whether that fill was itself full or partial — was burned
// over that same odometer range (fuel added = fuel burned, since the tank
// holds the same "full" level at both ends). km = last full-tank odometer −
// first full-tank odometer; liters = sum of every fill strictly after the
// first (skip-first: the first fill's liters paid for km driven *before*
// the segment, so it's excluded; the closing full-tank fill's own liters
// ARE included, since it's the fill that finally topped back up to full).
// A fill that's never followed by a later full-tank fill measures nothing
// yet — its liters can't be attributed to a closed km range.
//
// A delta must never bridge two different vehicles: if a driver swaps cars,
// the new vehicle's odometer starts far lower than the old one's, so a naive
// last-minus-first across the boundary produces a nonsensical (or, after
// chronological sorting, negative) figure. `entries` is expected to already
// be sorted chronologically by the caller (computeConsumptionTrend); this
// function first splits it into contiguous runs that share the same
// vehicle_id (null/undefined normalized together), then within each run
// trims to the span between its first and last full-tank fill and applies
// the method above. A trimmed span of length < 2, or whose delta is
// non-positive (e.g. an odometer typo/reset), contributes nothing.
//
// Known limitation: legacy fuel entries with no vehicle_id at all can't be
// told apart this way — a swap between two such entries still isn't
// detected. Chronological sorting alone still saves that case from a bogus
// *positive* figure (the cross-vehicle delta comes out negative and the run
// is dropped), but the honest result is "no data" rather than the correct
// per-vehicle number. Fixing that fully requires a vehicle_id backfill on
// historical rows.
// A same-vehicle_id run must also stay odometer-monotonic (within a small
// tolerance for same-day reordering noise: multiple fills on one day often
// share the exact same `filled_at` clock time -- see getConsumptionTrend --
// so chronological sort can place a slightly-lower reading right after a
// slightly-higher one). A drop far larger than any real day's driving means
// this vehicle_id row is being reused for a physically different car
// (swapped/replaced vehicle, never re-pointed to a new vehicle_id) rather
// than a same-car ordering hiccup. Without this, the whole history bridges
// into one run, the old car's early odometer to the new car's low one
// produces a nonsensical negative delta, and — since a single run was all
// there was — the result is "no data" instead of the new car's own,
// otherwise perfectly valid, segments.
//
// Shared by statsFromEntries (below) and computeWeeklyKmMeters -- both need
// the exact same protection: an ISO week (or the whole history) can just as
// easily straddle a vehicle swap as a full-tank-to-full-tank span can.
const RUN_RESET_THRESHOLD_METERS = 500_000; // 500 km

export function splitIntoVehicleRuns<T extends { odometer_meters: number; vehicle_id?: string | null }>(
  entries: T[],
): T[][] {
  const vehicleKey = (e: T) => e.vehicle_id ?? null;
  const runs: T[][] = [];
  for (const e of entries) {
    const currentRun = runs[runs.length - 1];
    const last = currentRun?.[currentRun.length - 1];
    const sameVehicle = !!currentRun && !!last && vehicleKey(last) === vehicleKey(e);
    const odometerDrop = last ? last.odometer_meters - e.odometer_meters : 0;
    if (sameVehicle && odometerDrop <= RUN_RESET_THRESHOLD_METERS) {
      currentRun!.push(e);
    } else {
      runs.push([e]);
    }
  }
  return runs;
}

// Sum of each vehicle-run's own (max - min) odometer delta, in meters --
// the same "never bridge two different vehicles" protection as
// statsFromEntries, but for a simple max-min distance calc instead of the
// full-tank method (used by weekly consumption, which has no full-tank
// requirement). Runs of length < 1 reading contribute nothing; entries with
// odometer_meters <= 0 (unset/placeholder) are dropped before splitting.
export function computeWeeklyKmMeters(
  entries: { odometer_meters: number; vehicle_id?: string | null }[],
): number {
  const runs = splitIntoVehicleRuns(entries.filter(e => e.odometer_meters > 0));
  let total = 0;
  for (const run of runs) {
    if (run.length < 2) continue;
    const odoms = run.map(e => e.odometer_meters);
    const delta = Math.max(...odoms) - Math.min(...odoms);
    if (delta > 0) total += delta;
  }
  return total;
}

function statsFromEntries(entries: FuelEntryForConsumption[]): ConsumptionStats | null {
  if (entries.length < 2) return null;

  const runs = splitIntoVehicleRuns(entries);

  let total_km = 0;
  let total_liters = 0;
  let segments = 0;

  for (const run of runs) {
    const fullIdxs = run.reduce<number[]>((acc, e, i) => { if (e.full_tank === true) acc.push(i); return acc; }, []);
    if (fullIdxs.length < 2) continue;
    const firstFullIdx = fullIdxs[0];
    const lastFullIdx = fullIdxs[fullIdxs.length - 1];

    const span = run.slice(firstFullIdx, lastFullIdx + 1);

    const run_km = (span[span.length - 1].odometer_meters - span[0].odometer_meters) / 1000;
    const run_liters = span.slice(1).reduce((s, e) => s + e.volume_ml / 1000, 0);

    if (run_km <= 0 || run_liters <= 0) continue;

    total_km += run_km;
    total_liters += run_liters;
    segments += span.length - 1;
  }

  if (total_km <= 0 || total_liters <= 0) return null;

  return { km_per_l: total_km / total_liters, total_km, total_liters, segments };
}

export function computeConsumptionTrend(
  rawEntries: FuelEntryForConsumption[],
  now: Date = new Date(),
): ConsumptionTrend | null {
  if (rawEntries.length < 2) return null;

  // Chronological order, not odometer order: odometer is only a valid proxy
  // for "earlier fill" within a single vehicle. Sorting by odometer instead
  // of filled_at is what let a vehicle swap (new car's much lower odometer)
  // reorder entries out of chronological sequence and reach across vehicles
  // when computing a delta — see statsFromEntries above and the "vehicle-swap
  // regression" tests for the production incident this caused.
  //
  // Secondary sort by odometer when filled_at ties exactly: multiple fills
  // on the same day commonly share the identical default clock time (no
  // real time-of-day is captured), and without a tie-breaker the DB's
  // return order for those rows is unspecified -- confirmed in production,
  // one tied pair came back odometer-ascending, another tied pair on a
  // different day came back odometer-descending, for the SAME query shape.
  // Odometer-ascending is the only sane deterministic tie-break: the car
  // cannot have driven backwards between two same-day fills.
  const entries = [...rawEntries].sort((a, b) => {
    const t = new Date(a.filled_at).getTime() - new Date(b.filled_at).getTime();
    return t !== 0 ? t : a.odometer_meters - b.odometer_meters;
  });

  const overall = statsFromEntries(entries);
  if (!overall) return null;

  // Recent: last 90 days (same skip-first method within the sub-window)
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 90);
  const recentEntries = entries.filter(e => new Date(e.filled_at) >= cutoff);
  const recent = recentEntries.length >= 3 ? statsFromEntries(recentEntries) : null;

  // Current month: same skip-first method, scoped to the calendar month in
  // exercise — matches how the rest of the dashboard (RESUMO DO MÊS) scopes
  // its totals via getMonthReport(year, month).
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthEntries = entries.filter(e => {
    const d = new Date(e.filled_at);
    return d >= monthStart && d < monthEnd;
  });
  const current_month = statsFromEntries(monthEntries);

  const current_month_totals = monthEntries.length > 0 ? {
    km_driven: computeWeeklyKmMeters(monthEntries) / 1000,
    total_liters: monthEntries.reduce((s, e) => s + e.volume_ml / 1000, 0),
    fill_count: monthEntries.length,
  } : null;

  const change_pct = recent ? ((recent.km_per_l - overall.km_per_l) / overall.km_per_l) * 100 : null;

  return { overall, recent, current_month, current_month_totals, change_pct };
}
