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
  current_month: ConsumptionStats | null;
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
function statsFromEntries(entries: FuelEntryForConsumption[]): ConsumptionStats | null {
  if (entries.length < 2) return null;

  const vehicleKey = (e: FuelEntryForConsumption) => e.vehicle_id ?? null;

  const runs: FuelEntryForConsumption[][] = [];
  for (const e of entries) {
    const currentRun = runs[runs.length - 1];
    if (currentRun && vehicleKey(currentRun[currentRun.length - 1]) === vehicleKey(e)) {
      currentRun.push(e);
    } else {
      runs.push([e]);
    }
  }

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
  const entries = [...rawEntries].sort(
    (a, b) => new Date(a.filled_at).getTime() - new Date(b.filled_at).getTime(),
  );

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

  const change_pct = recent ? ((recent.km_per_l - overall.km_per_l) / overall.km_per_l) * 100 : null;

  return { overall, recent, current_month, change_pct };
}
