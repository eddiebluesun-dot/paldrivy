export interface PlatformBreakdownItem {
  name: string;
  gross_cents: number;
  pct: number;
}

export function buildPlatformBreakdown(
  entries: Array<{ platform_name: string; amount_cents: number }>,
): PlatformBreakdownItem[] {
  const totals = new Map<string, number>();
  for (const e of entries) {
    totals.set(e.platform_name, (totals.get(e.platform_name) ?? 0) + e.amount_cents);
  }
  const grandTotal = Array.from(totals.values()).reduce((s, v) => s + v, 0);
  return Array.from(totals.entries())
    .map(([name, gross_cents]) => ({
      name,
      gross_cents,
      pct: grandTotal > 0 ? Math.round((gross_cents / grandTotal) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.gross_cents - a.gross_cents);
}

export interface CommunityMetrics {
  earnings_today_cents: number;
  net_cents: number;
  avg_per_hour_cents: number;
  avg_per_km_cents: number;
  total_duration_seconds: number;
  total_km_meters: number;
  rides_count: number;
  avg_per_ride_cents: number;
}

export function computeCommunityMetrics(input: {
  gross_cents: number;
  net_cents: number;
  duration_seconds: number;
  km_meters: number;
  rides_count: number;
}): CommunityMetrics {
  const hours = input.duration_seconds / 3600;
  const km = input.km_meters / 1000;
  return {
    earnings_today_cents: input.gross_cents,
    net_cents: input.net_cents,
    avg_per_hour_cents: hours > 0 ? Math.round(input.gross_cents / hours) : 0,
    avg_per_km_cents: km > 0 ? Math.round(input.gross_cents / km) : 0,
    total_duration_seconds: input.duration_seconds,
    total_km_meters: input.km_meters,
    rides_count: input.rides_count,
    avg_per_ride_cents: input.rides_count > 0 ? Math.round(input.gross_cents / input.rides_count) : 0,
  };
}
