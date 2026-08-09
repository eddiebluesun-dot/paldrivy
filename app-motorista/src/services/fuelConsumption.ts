import { supabase } from '../lib/supabase';
import { computeConsumptionTrend, type ConsumptionStats, type ConsumptionTrend } from '../utils/fuelConsumptionUtils';

export type { ConsumptionStats, ConsumptionTrend };

// ─── Weekly consumption ───────────────────────────────────────────────────────

export interface WeeklyStats {
  week_label: string;
  total_volume: number;      // liters for thermal; kWh for electric (volume_ml / 1000 in both cases)
  km_driven: number;         // always in km (caller converts for display)
  efficiency: number | null; // km/L for thermal; km/kWh for electric
  is_electric: boolean;      // true when ALL entries in the week are electric
}

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function getWeeklyConsumption(
  userId: string,
  vehicleId?: string | null,
  weeksBack = 8,
): Promise<WeeklyStats[]> {
  const since = new Date();
  since.setDate(since.getDate() - weeksBack * 7);

  let q = supabase
    .from('fuel_entries')
    .select('filled_at, volume_ml, odometer_meters, fuel_type')
    .eq('user_id', userId)
    .gte('filled_at', since.toISOString())
    .order('filled_at', { ascending: true });

  if (vehicleId) q = q.eq('vehicle_id', vehicleId);

  const { data, error } = await q;
  if (error || !data) return [];

  type E = { filled_at: string; volume_ml: number; odometer_meters: number | null; fuel_type: string };
  const entries = data as E[];

  const byWeek = new Map<string, E[]>();
  for (const e of entries) {
    const key = isoWeekKey(new Date(e.filled_at));
    const arr = byWeek.get(key) ?? [];
    arr.push(e);
    byWeek.set(key, arr);
  }

  const results: WeeklyStats[] = [];

  for (const [, wEntries] of [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // volume_ml / 1000 = liters for thermal; kWh for electric (same conversion)
    const totalVolume = wEntries.reduce((s, e) => s + e.volume_ml / 1000, 0);

    const odoms = wEntries
      .map(e => e.odometer_meters)
      .filter((v): v is number => v !== null && v > 0);

    const kmDriven = odoms.length >= 2
      ? (Math.max(...odoms) - Math.min(...odoms)) / 1000
      : 0;

    const efficiency = totalVolume > 0 && kmDriven > 0
      ? kmDriven / totalVolume  // km/L for thermal; km/kWh for electric
      : null;

    const is_electric = wEntries.every(e => e.fuel_type === 'electric');

    // build label from actual dates in the week
    const dates = wEntries.map(e => new Date(e.filled_at));
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const week_label = minDate.toDateString() === maxDate.toDateString()
      ? fmt(minDate)
      : `${fmt(minDate)} – ${fmt(maxDate)}`;

    results.push({ week_label, total_volume: totalVolume, km_driven: kmDriven, efficiency, is_electric });
  }

  return results.reverse();
}

// Computation logic (overall / recent-90-days / current-month) lives in
// src/utils/fuelConsumptionUtils.ts as a pure, unit-tested function — this
// service is only responsible for fetching the raw rows from Supabase.
export async function getConsumptionTrend(
  userId: string,
  vehicleId?: string | null
): Promise<ConsumptionTrend | null> {
  let query = supabase
    .from('fuel_entries')
    .select('odometer_meters, volume_ml, filled_at, vehicle_id, full_tank')
    .eq('user_id', userId)
    .not('odometer_meters', 'is', null)
    .order('filled_at', { ascending: true });

  if (vehicleId) query = query.eq('vehicle_id', vehicleId);

  const { data, error } = await query;
  if (error || !data) return null;

  type E = { odometer_meters: number; volume_ml: number; filled_at: string; vehicle_id: string | null; full_tank: boolean | null };
  return computeConsumptionTrend(data as E[]);
}
