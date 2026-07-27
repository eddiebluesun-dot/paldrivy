import { supabase } from '../lib/supabase';
import type { Goal } from '../types';

export interface DailySummary {
  gross_cents: number;
  net_cents: number;
  duration_seconds: number;
  distance_meters: number;
  expenses_cents: number;
  fuel_cents: number;
  odometer_start_meters: number | null;
  odometer_end_meters: number | null;
  shifts_count: number;
}

export interface DayBucket {
  date: string;
  net_cents: number;
}

export interface MonthBucket {
  day: number;
  net_cents: number;
  gross_cents: number;
}

function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function durationFromRow(row: { duration_seconds?: number | null; started_at?: string; ended_at?: string | null }): number {
  if (row.duration_seconds != null) return row.duration_seconds;
  if (row.started_at && row.ended_at) {
    return Math.round((new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()) / 1000);
  }
  return 0;
}

export async function getTodaySummary(userId: string): Promise<DailySummary> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const { data, error } = await supabase
    .from('shifts')
    .select('gross_cents, net_cents, duration_seconds, started_at, ended_at, odometer_start_meters, odometer_end_meters')
    .eq('user_id', userId)
    .gte('started_at', todayStart.toISOString())
    .lt('started_at', tomorrowStart.toISOString())
    .not('ended_at', 'is', null);

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    gross_cents: number | null;
    net_cents: number | null;
    duration_seconds: number | null;
    started_at: string;
    ended_at: string | null;
    odometer_start_meters: number | null;
    odometer_end_meters: number | null;
  }>;

  const shiftTotals = rows.reduce<Omit<DailySummary, 'expenses_cents' | 'fuel_cents'>>(
    (acc, row) => {
      acc.gross_cents += row.gross_cents ?? 0;
      acc.net_cents += row.net_cents ?? 0;
      acc.duration_seconds += durationFromRow(row);
      if (row.odometer_start_meters != null && row.odometer_end_meters != null) {
        acc.distance_meters += row.odometer_end_meters - row.odometer_start_meters;
      }
      if (row.odometer_start_meters != null) {
        acc.odometer_start_meters = acc.odometer_start_meters == null
          ? row.odometer_start_meters
          : Math.min(acc.odometer_start_meters, row.odometer_start_meters);
      }
      if (row.odometer_end_meters != null) {
        acc.odometer_end_meters = acc.odometer_end_meters == null
          ? row.odometer_end_meters
          : Math.max(acc.odometer_end_meters, row.odometer_end_meters);
      }
      return acc;
    },
    { gross_cents: 0, net_cents: 0, duration_seconds: 0, distance_meters: 0, odometer_start_meters: null, odometer_end_meters: null }
  );

  const todayStr = toLocalDateString(todayStart);

  const [expRes, fuelRes] = await Promise.all([
    supabase.from('expenses').select('amount_cents').eq('user_id', userId).eq('expense_date', todayStr),
    supabase.from('fuel_entries').select('total_cost_cents')
      .eq('user_id', userId)
      .gte('filled_at', todayStart.toISOString())
      .lt('filled_at', tomorrowStart.toISOString()),
  ]);

  const expenses_cents = ((expRes.data ?? []) as { amount_cents: number }[]).reduce((s, e) => s + e.amount_cents, 0);
  const fuel_cents = ((fuelRes.data ?? []) as { total_cost_cents: number }[]).reduce((s, e) => s + e.total_cost_cents, 0);

  return { ...shiftTotals, expenses_cents, fuel_cents, shifts_count: rows.length };
}

export async function getWeekBuckets(userId: string): Promise<DayBucket[]> {
  const now = new Date();
  // Sunday of the current week
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  sunday.setHours(0, 0, 0, 0);
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  saturday.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from('shifts')
    .select('started_at, net_cents')
    .eq('user_id', userId)
    .gte('started_at', sunday.toISOString())
    .lte('started_at', saturday.toISOString())
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as Array<{ started_at: string; net_cents: number | null }>;

  const bucketMap = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
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

export async function getMonthlyBucketsForMonth(userId: string, year: number, month: number): Promise<MonthBucket[]> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 1);
  const totalDays  = new Date(year, month, 0).getDate();

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
  const bucketMap = new Map<number, MonthBucket>();
  for (let d = 1; d <= totalDays; d++) bucketMap.set(d, { day: d, net_cents: 0, gross_cents: 0 });
  for (const row of rows) {
    const day = new Date(row.started_at).getDate();
    const existing = bucketMap.get(day);
    if (existing) {
      existing.net_cents  += row.net_cents  ?? 0;
      existing.gross_cents += row.gross_cents ?? 0;
    }
  }
  return Array.from(bucketMap.values());
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
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const bucketMap = new Map<number, MonthBucket>();
  for (let d = 1; d <= totalDays; d++) {
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

export interface DayDetail {
  shifts: Array<{
    gross_cents: number | null;
    net_cents: number | null;
    duration_seconds: number | null;
    started_at: string;
    ended_at: string | null;
    odometer_start_meters: number | null;
    odometer_end_meters: number | null;
  }>;
  expenses_cents: number;
  fuel_cents: number;
}

export async function getDayDetail(userId: string, dateStr: string): Promise<DayDetail> {
  const start = new Date(dateStr + 'T00:00:00').toISOString();
  const end = new Date(dateStr + 'T23:59:59.999').toISOString();

  const [shiftsRes, expensesRes, fuelRes] = await Promise.all([
    supabase
      .from('shifts')
      .select('gross_cents, net_cents, duration_seconds, started_at, ended_at, odometer_start_meters, odometer_end_meters')
      .eq('user_id', userId)
      .gte('started_at', start)
      .lte('started_at', end)
      .not('ended_at', 'is', null),
    supabase
      .from('expenses')
      .select('amount_cents')
      .eq('user_id', userId)
      .eq('expense_date', dateStr),
    supabase
      .from('fuel_entries')
      .select('total_cost_cents')
      .eq('user_id', userId)
      .gte('filled_at', start)
      .lte('filled_at', end),
  ]);

  if (shiftsRes.error) throw shiftsRes.error;
  if (expensesRes.error) throw expensesRes.error;

  const expenses_cents = ((expensesRes.data ?? []) as { amount_cents: number }[])
    .reduce((s, e) => s + e.amount_cents, 0);
  const fuel_cents = ((fuelRes.data ?? []) as { total_cost_cents: number }[])
    .reduce((s, e) => s + e.total_cost_cents, 0);

  return { shifts: (shiftsRes.data ?? []) as DayDetail['shifts'], expenses_cents, fuel_cents };
}

export interface MonthlyTotals {
  gross_cents: number;
  net_cents: number;
  expenses_cents: number;
  fuel_cents: number;
  km_meters: number;
}

export interface ActiveGoal {
  id: string;
  target_amount_cents: number;
  starts_at: string;
  working_days?: number[] | null;
}

export async function getActiveGoal(userId: string): Promise<ActiveGoal | null> {
  const now = new Date();
  const monthStr = toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1));

  // Prefer goal for current month; fall back to most recent
  let { data, error } = await supabase
    .from('goals')
    .select('id, target_amount_cents, starts_at, working_days')
    .eq('user_id', userId)
    .eq('type', 'monthly')
    .eq('starts_at', monthStr)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const res = await supabase
      .from('goals')
      .select('id, target_amount_cents, starts_at, working_days')
      .eq('user_id', userId)
      .eq('type', 'monthly')
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (res.error) throw res.error;
    data = res.data;
  }

  return data as ActiveGoal | null;
}

export async function upsertMonthlyGoal(userId: string, targetCents: number, workingDays?: number[]): Promise<void> {
  const now = new Date();
  const monthStr = toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1));

  const { data: existing } = await supabase
    .from('goals')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'monthly')
    .eq('starts_at', monthStr)
    .maybeSingle();

  const payload: Record<string, unknown> = { target_amount_cents: targetCents };
  if (workingDays) payload.working_days = workingDays;

  if (existing) {
    const { error } = await supabase.from('goals').update(payload).eq('id', (existing as { id: string }).id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('goals').insert({
      user_id: userId, type: 'monthly', starts_at: monthStr, ...payload,
    });
    if (error) throw error;
  }
}

export interface MonthSummary {
  month: number;
  gross_cents: number;
  net_cents: number;
  expenses_cents: number;
  fuel_cents: number;
}

export interface YearlyReport {
  year: number;
  months: MonthSummary[];
}

export async function getYearlyReport(userId: string, year: number): Promise<YearlyReport> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const yearStartStr = toLocalDateString(yearStart);
  const yearEndStr = toLocalDateString(yearEnd);

  const [shiftsRes, expensesRes, fuelRes] = await Promise.all([
    supabase.from('shifts').select('started_at, gross_cents, net_cents')
      .eq('user_id', userId)
      .gte('started_at', yearStart.toISOString())
      .lt('started_at', yearEnd.toISOString())
      .not('ended_at', 'is', null),
    supabase.from('expenses').select('expense_date, amount_cents')
      .eq('user_id', userId)
      .gte('expense_date', yearStartStr)
      .lt('expense_date', yearEndStr),
    supabase.from('fuel_entries').select('filled_at, total_cost_cents')
      .eq('user_id', userId)
      .gte('filled_at', yearStart.toISOString())
      .lt('filled_at', yearEnd.toISOString()),
  ]);

  if (shiftsRes.error) throw shiftsRes.error;

  const monthMap = new Map<number, MonthSummary>();
  for (let m = 1; m <= 12; m++) {
    monthMap.set(m, { month: m, gross_cents: 0, net_cents: 0, expenses_cents: 0, fuel_cents: 0 });
  }

  for (const row of (shiftsRes.data ?? []) as Array<{ started_at: string; gross_cents: number | null; net_cents: number | null }>) {
    const m = new Date(row.started_at).getMonth() + 1;
    const b = monthMap.get(m)!;
    b.gross_cents += row.gross_cents ?? 0;
    b.net_cents += row.net_cents ?? 0;
  }
  for (const row of (expensesRes.data ?? []) as Array<{ expense_date: string; amount_cents: number }>) {
    const m = new Date(row.expense_date + 'T00:00:00').getMonth() + 1;
    monthMap.get(m)!.expenses_cents += row.amount_cents;
  }
  for (const row of (fuelRes.data ?? []) as Array<{ filled_at: string; total_cost_cents: number }>) {
    const m = new Date(row.filled_at).getMonth() + 1;
    monthMap.get(m)!.fuel_cents += row.total_cost_cents;
  }

  return { year, months: Array.from(monthMap.values()) };
}

export async function getMonthlyTotals(userId: string): Promise<MonthlyTotals> {
  const now = new Date();
  return getMonthReport(userId, now.getFullYear(), now.getMonth() + 1)
    .then(r => r.totals);
}

export async function getWeekTotals(userId: string): Promise<MonthlyTotals> {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  sunday.setHours(0, 0, 0, 0);
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  saturday.setHours(23, 59, 59, 999);

  const [shiftsRes, expRes, fuelRes] = await Promise.all([
    supabase.from('shifts').select('gross_cents, net_cents, odometer_start_meters, odometer_end_meters')
      .eq('user_id', userId)
      .gte('started_at', sunday.toISOString())
      .lte('started_at', saturday.toISOString())
      .not('ended_at', 'is', null),
    supabase.from('expenses').select('amount_cents')
      .eq('user_id', userId)
      .gte('expense_date', toLocalDateString(sunday))
      .lte('expense_date', toLocalDateString(saturday)),
    supabase.from('fuel_entries').select('total_cost_cents')
      .eq('user_id', userId)
      .gte('filled_at', sunday.toISOString())
      .lte('filled_at', saturday.toISOString()),
  ]);

  const rows = (shiftsRes.data ?? []) as {
    gross_cents: number | null; net_cents: number | null;
    odometer_start_meters: number | null; odometer_end_meters: number | null;
  }[];
  const km_meters = rows.reduce((s, r) =>
    r.odometer_start_meters != null && r.odometer_end_meters != null
      ? s + (r.odometer_end_meters - r.odometer_start_meters)
      : s, 0);
  return {
    gross_cents: rows.reduce((s, r) => s + (r.gross_cents ?? 0), 0),
    net_cents: rows.reduce((s, r) => s + (r.net_cents ?? 0), 0),
    expenses_cents: ((expRes.data ?? []) as { amount_cents: number }[]).reduce((s, e) => s + e.amount_cents, 0),
    fuel_cents: ((fuelRes.data ?? []) as { total_cost_cents: number }[]).reduce((s, e) => s + e.total_cost_cents, 0),
    km_meters,
  };
}

export interface MonthExpenseCategory {
  category: string;
  total_cents: number;
}

export interface MonthReport {
  totals: MonthlyTotals;
  expensesByCategory: MonthExpenseCategory[];
}

export async function getMonthReport(userId: string, year: number, month: number): Promise<MonthReport> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);

  const [shiftsRes, expRes, fuelRes] = await Promise.all([
    supabase.from('shifts').select('gross_cents, net_cents, odometer_start_meters, odometer_end_meters')
      .eq('user_id', userId)
      .gte('started_at', monthStart.toISOString())
      .lt('started_at', monthEnd.toISOString())
      .not('ended_at', 'is', null),
    supabase.from('expenses').select('category, amount_cents')
      .eq('user_id', userId)
      .gte('expense_date', toLocalDateString(monthStart))
      .lt('expense_date', toLocalDateString(monthEnd)),
    supabase.from('fuel_entries').select('total_cost_cents')
      .eq('user_id', userId)
      .gte('filled_at', monthStart.toISOString())
      .lt('filled_at', monthEnd.toISOString()),
  ]);

  const rows = (shiftsRes.data ?? []) as {
    gross_cents: number | null; net_cents: number | null;
    odometer_start_meters: number | null; odometer_end_meters: number | null;
  }[];
  const gross_cents = rows.reduce((s, r) => s + (r.gross_cents ?? 0), 0);
  const net_cents = rows.reduce((s, r) => s + (r.net_cents ?? 0), 0);
  const km_meters = rows.reduce((s, r) =>
    r.odometer_start_meters != null && r.odometer_end_meters != null
      ? s + (r.odometer_end_meters - r.odometer_start_meters)
      : s, 0);

  const expRows = (expRes.data ?? []) as { category: string; amount_cents: number }[];
  const expenses_cents = expRows.reduce((s, e) => s + e.amount_cents, 0);
  const fuel_cents = ((fuelRes.data ?? []) as { total_cost_cents: number }[])
    .reduce((s, e) => s + e.total_cost_cents, 0);

  const catMap = new Map<string, number>();
  for (const row of expRows) {
    catMap.set(row.category, (catMap.get(row.category) ?? 0) + row.amount_cents);
  }
  const expensesByCategory = Array.from(catMap.entries())
    .map(([category, total_cents]) => ({ category, total_cents }))
    .sort((a, b) => b.total_cents - a.total_cents);

  return { totals: { gross_cents, net_cents, expenses_cents, fuel_cents, km_meters }, expensesByCategory };
}

export interface MonthMoodStats {
  good: number;
  ok: number;
  bad: number;
}

export async function getMonthMoodStats(userId: string): Promise<MonthMoodStats> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const { data, error } = await supabase
    .from('shifts')
    .select('mood_rating')
    .eq('user_id', userId)
    .gte('started_at', monthStart.toISOString())
    .lt('started_at', monthEnd.toISOString())
    .not('ended_at', 'is', null)
    .not('mood_rating', 'is', null);

  if (error) throw error;

  const rows = (data ?? []) as { mood_rating: string | null }[];
  return rows.reduce(
    (acc, r) => {
      if (r.mood_rating === 'good') acc.good++;
      else if (r.mood_rating === 'ok') acc.ok++;
      else if (r.mood_rating === 'bad') acc.bad++;
      return acc;
    },
    { good: 0, ok: 0, bad: 0 },
  );
}
