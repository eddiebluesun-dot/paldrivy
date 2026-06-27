import { supabase } from '../lib/supabase';
import type { Shift, Goal } from '../types';

export interface DailySummary {
  gross_cents: number;
  net_cents: number;
  duration_seconds: number;
  distance_meters: number;
}

export interface DayBucket {
  date: string; // YYYY-MM-DD
  net_cents: number;
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function getTodaySummary(userId: string): Promise<DailySummary> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const { data, error } = await supabase
    .from('shifts')
    .select('gross_cents, net_cents, duration_seconds, odometer_start_meters, odometer_end_meters')
    .eq('user_id', userId)
    .gte('started_at', todayStart.toISOString())
    .lt('started_at', tomorrowStart.toISOString())
    .not('ended_at', 'is', null);

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    gross_cents: number | null;
    net_cents: number | null;
    duration_seconds: number | null;
    odometer_start_meters: number | null;
    odometer_end_meters: number | null;
  }>;

  return rows.reduce<DailySummary>(
    (acc, row) => {
      acc.gross_cents += row.gross_cents ?? 0;
      acc.net_cents += row.net_cents ?? 0;
      acc.duration_seconds += row.duration_seconds ?? 0;
      if (row.odometer_start_meters != null && row.odometer_end_meters != null) {
        acc.distance_meters += row.odometer_end_meters - row.odometer_start_meters;
      }
      return acc;
    },
    { gross_cents: 0, net_cents: 0, duration_seconds: 0, distance_meters: 0 }
  );
}

export async function getWeekBuckets(userId: string): Promise<DayBucket[]> {
  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('shifts')
    .select('started_at, net_cents')
    .eq('user_id', userId)
    .gte('started_at', since.toISOString())
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as Array<{ started_at: string; net_cents: number | null }>;

  // Build bucket map for last 7 days
  const bucketMap = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    bucketMap.set(toLocalDateString(d), 0);
  }

  for (const row of rows) {
    const dateKey = toLocalDateString(new Date(row.started_at));
    if (bucketMap.has(dateKey)) {
      bucketMap.set(dateKey, (bucketMap.get(dateKey) ?? 0) + (row.net_cents ?? 0));
    }
  }

  return Array.from(bucketMap.entries()).map(([date, net_cents]) => ({ date, net_cents }));
}

export interface MonthBucket {
  day: number; // 1-31
  net_cents: number;
  gross_cents: number;
}

export async function getMonthlyBuckets(userId: string): Promise<MonthBucket[]> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const { data, error } = await supabase
    .from('shifts')
    .select('started_at, net_cents, gross_cents')
    .eq('user_id', userId)
    .gte('started_at', monthStart.toISOString())
    .lt('started_at', monthEnd.toISOString())
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as Array<{ started_at: string; net_cents: number | null; gross_cents: number | null }>;
  const daysInMonth = monthEnd.getDate() === 1
    ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    : monthEnd.getDate();

  const bucketMap = new Map<number, MonthBucket>();
  for (let d = 1; d <= new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); d++) {
    bucketMap.set(d, { day: d, net_cents: 0, gross_cents: 0 });
  }

  for (const row of rows) {
    const day = new Date(row.started_at).getDate();
    const existing = bucketMap.get(day);
    if (existing) {
      existing.net_cents += row.net_cents ?? 0;
      existing.gross_cents += row.gross_cents ?? 0;
    }
  }

  return Array.from(bucketMap.values());
}

export async function getActiveGoal(userId: string): Promise<{ target_amount_cents: number } | null> {
  const { data, error } = await supabase
    .from('goals')
    .select('target_amount_cents')
    .eq('user_id', userId)
    .eq('type', 'monthly')
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as { target_amount_cents: number };
  return { target_amount_cents: row.target_amount_cents };
}
