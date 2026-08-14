import { supabase } from '../lib/supabase';
import { streakFromDates, countActiveDays } from '../utils/cockpitUtils';
import { getRecurringExpenseTotalForRange } from './recurringExpenseAllocation';
export {
  workingDaysInMonth,
  getDailyGoalCents,
  streakFromDates,
  countActiveDays,
  intensityForCents,
} from '../utils/cockpitUtils';

export interface MonthHistoryItem {
  year: number;
  month: number;
  gross_cents: number;
  expenses_cents: number;
  fuel_cents: number;
  rides: number;
  km_meters: number;
  liters_ml: number;
}

export interface HeatmapDay {
  day: number;
  income_cents: number;
  expense_cents: number;
}

// ─── Supabase queries ─────────────────────────────────────────────────────────

export async function getMonthHistory(userId: string, limit = 12): Promise<MonthHistoryItem[]> {
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - limit + 1, 1);
  const cutoffIso = cutoff.toISOString();
  const cutoffStr = cutoffIso.slice(0, 10);

  const [shiftsRes, expRes, fuelRes] = await Promise.all([
    supabase
      .from('shifts')
      .select('started_at, gross_cents, rides_count, odometer_start_meters, odometer_end_meters')
      .eq('user_id', userId)
      .gte('started_at', cutoffIso)
      .not('ended_at', 'is', null),
    // Weekly/monthly recurring rows excluded -- see the matching comment in
    // dashboard.ts's getMonthReport. Each bucketed month's prorated share is
    // added below via getRecurringExpenseTotalForRange instead of this raw
    // sum, otherwise a weekly-frequency expense would only ever land in
    // whichever single month contains its anchor date.
    supabase
      .from('expenses')
      .select('expense_date, amount_cents, recurring, recurring_frequency')
      .eq('user_id', userId)
      .gte('expense_date', cutoffStr),
    supabase
      .from('fuel_entries')
      .select('filled_at, total_cost_cents, volume_ml')
      .eq('user_id', userId)
      .gte('filled_at', cutoffIso),
  ]);

  const buckets = new Map<string, MonthHistoryItem>();
  for (let i = limit - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    buckets.set(key, {
      year: d.getFullYear(), month: d.getMonth() + 1,
      gross_cents: 0, expenses_cents: 0, fuel_cents: 0, rides: 0, km_meters: 0, liters_ml: 0,
    });
  }

  for (const row of (shiftsRes.data ?? []) as Array<{
    started_at: string; gross_cents: number | null; rides_count: number | null;
    odometer_start_meters: number | null; odometer_end_meters: number | null;
  }>) {
    const d = new Date(row.started_at);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const b = buckets.get(key);
    if (!b) continue;
    b.gross_cents += row.gross_cents ?? 0;
    b.rides += row.rides_count ?? 1;
    if (row.odometer_start_meters != null && row.odometer_end_meters != null) {
      b.km_meters += row.odometer_end_meters - row.odometer_start_meters;
    }
  }
  const expenseRows = ((expRes.data ?? []) as
    Array<{ expense_date: string; amount_cents: number; recurring: boolean; recurring_frequency: string | null }>)
    .filter(e => !(e.recurring && (e.recurring_frequency === 'weekly' || e.recurring_frequency === 'monthly')));
  for (const row of expenseRows) {
    const d = new Date(row.expense_date + 'T00:00:00');
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const b = buckets.get(key);
    if (b) b.expenses_cents += row.amount_cents;
  }
  for (const row of (fuelRes.data ?? []) as Array<{ filled_at: string; total_cost_cents: number; volume_ml: number | null }>) {
    const d = new Date(row.filled_at);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const b = buckets.get(key);
    if (b) {
      b.fuel_cents += row.total_cost_cents;
      b.liters_ml += row.volume_ml ?? 0;
    }
  }

  // Each bucketed month's recurring-expense share, same rationale as
  // getYearlyReport in dashboard.ts.
  const bucketKeys = Array.from(buckets.keys());
  const recurringTotals = await Promise.all(bucketKeys.map(key => {
    const b = buckets.get(key)!;
    const mStart = `${b.year}-${String(b.month).padStart(2, '0')}-01`;
    const nextMonthDate = new Date(b.year, b.month, 1);
    const mEnd = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;
    return getRecurringExpenseTotalForRange(userId, mStart, mEnd);
  }));
  bucketKeys.forEach((key, i) => { buckets.get(key)!.expenses_cents += recurringTotals[i]; });

  return Array.from(buckets.values()).reverse(); // newest first
}

export async function getCalendarHeatmap(
  userId: string,
  year: number,
  month: number,
): Promise<HeatmapDay[]> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const monthStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextYear = monthEnd.getFullYear();
  const nextMonth = monthEnd.getMonth() + 1;
  const monthEndStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const [shiftsRes, expRes, fuelRes] = await Promise.all([
    supabase
      .from('shifts')
      .select('started_at, gross_cents')
      .eq('user_id', userId)
      .gte('started_at', monthStart.toISOString())
      .lt('started_at', monthEnd.toISOString())
      .not('ended_at', 'is', null),
    supabase
      .from('expenses')
      .select('expense_date, amount_cents')
      .eq('user_id', userId)
      .gte('expense_date', monthStartStr)
      .lt('expense_date', monthEndStr),
    supabase
      .from('fuel_entries')
      .select('filled_at, total_cost_cents')
      .eq('user_id', userId)
      .gte('filled_at', monthStart.toISOString())
      .lt('filled_at', monthEnd.toISOString()),
  ]);

  const totalDays = new Date(year, month, 0).getDate();
  const map = new Map<number, HeatmapDay>();
  for (let d = 1; d <= totalDays; d++) {
    map.set(d, { day: d, income_cents: 0, expense_cents: 0 });
  }

  for (const row of (shiftsRes.data ?? []) as Array<{ started_at: string; gross_cents: number | null }>) {
    const d = new Date(row.started_at).getDate();
    const b = map.get(d);
    if (b) b.income_cents += row.gross_cents ?? 0;
  }
  for (const row of (expRes.data ?? []) as Array<{ expense_date: string; amount_cents: number }>) {
    const d = new Date(row.expense_date + 'T00:00:00').getDate();
    const b = map.get(d);
    if (b) b.expense_cents += row.amount_cents;
  }
  for (const row of (fuelRes.data ?? []) as Array<{ filled_at: string; total_cost_cents: number }>) {
    const d = new Date(row.filled_at).getDate();
    const b = map.get(d);
    if (b) b.expense_cents += row.total_cost_cents;
  }

  return Array.from(map.values());
}

export async function getStreak(userId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const localDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // "Active day" = a day with at least one completed shift. Logging an
  // expense on a day with no shift does NOT count — see
  // src/utils/cockpitUtils.ts#countActiveDays for why (verified against
  // production data after this drifted to include expense-only days).
  const { data } = await supabase
    .from('shifts')
    .select('started_at')
    .eq('user_id', userId)
    .gte('started_at', monthStart.toISOString())
    .lt('started_at', monthEnd.toISOString())
    .not('ended_at', 'is', null);

  const shiftDates = (data ?? []).map(
    (row: { started_at: string }) => localDate(new Date(row.started_at)),
  );

  // Single source of truth for "days active this month" — see
  // src/utils/cockpitUtils.ts#countActiveDays. Every UI element that shows
  // this figure (StreakBar today; the HOJE card previously) must read from
  // this function's result, not recompute it independently.
  return countActiveDays(shiftDates);
}
