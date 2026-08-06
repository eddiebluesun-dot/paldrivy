// Pure, side-effect-free helpers for fuel consumption stats (no Supabase import).
// Extracted so the "current month" scoping bug (dashboard showed all-time km
// instead of the selected month's km) can be unit tested without mocking Supabase.

export interface FuelEntryForConsumption {
  odometer_meters: number;
  volume_ml: number;
  filled_at: string;
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

// Skip-first method: km = last odometer − first odometer in the set;
// liters = sum of fills after the first (the first fill's liters paid for
// km driven *before* the set, so it's excluded).
function statsFromEntries(entries: FuelEntryForConsumption[]): ConsumptionStats | null {
  if (entries.length < 2) return null;

  const total_km = (entries[entries.length - 1].odometer_meters - entries[0].odometer_meters) / 1000;
  const total_liters = entries.slice(1).reduce((s, e) => s + e.volume_ml / 1000, 0);

  if (total_km <= 0 || total_liters <= 0) return null;

  return {
    km_per_l: total_km / total_liters,
    total_km,
    total_liters,
    segments: entries.length - 1,
  };
}

export function computeConsumptionTrend(
  rawEntries: FuelEntryForConsumption[],
  now: Date = new Date(),
): ConsumptionTrend | null {
  if (rawEntries.length < 2) return null;

  const entries = [...rawEntries].sort((a, b) => a.odometer_meters - b.odometer_meters);

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
