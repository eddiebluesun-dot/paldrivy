import { supabase } from '../lib/supabase';
import { computeDailyAllocationCents, splitAcrossShifts, type RecurringExpenseInput } from '../utils/recurringExpenseAllocationUtils';

// Fetches this user's active recurring expenses + their current monthly
// goal's working_days + all shifts started on shiftDate, and returns the
// fixed-cost (rent/insurance/etc.) share allocated to THIS specific shift
// for that day.
//
// shiftId identifies which of the day's (potentially multiple) shifts is
// asking: same-day shifts are ordered by started_at ascending and the
// rounding remainder from splitAcrossShifts (Task 2) goes to the LAST shift
// in that order, per the feature's design. Passing shiftId (rather than,
// say, a raw index) means callers don't need to know the day's shift count
// or ordering themselves -- this function looks it up.
export async function getAllocatedFixedCentsForShift(
  userId: string,
  shiftDate: string,
  shiftId: string,
): Promise<number> {
  // NOTE: shiftDate is assumed to already be in UTC-midnight convention (see
  // dayStart/dayEnd below), matching Task 2. Shift-day bucketing elsewhere in
  // this codebase (dashboard.ts's toLocalDateString) uses the LOCAL calendar
  // day instead -- callers (Task 4) must convert consistently before calling,
  // not pass a locally-bucketed date string through unchanged.
  const dayStart = `${shiftDate}T00:00:00.000Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

  const [{ data: expenseRows }, { data: goal }, { data: sameDayShifts }] = await Promise.all([
    supabase.from('expenses').select('amount_cents, expense_date, recurring_frequency')
      .eq('user_id', userId).eq('recurring', true),
    // Most recent goal that was already active as of shiftDate (not any goal
    // created after it). This matters for backdated manual shifts
    // (createManualShift lets a driver log a shift for a past date) so a
    // newer goal's working_days doesn't get applied retroactively to a
    // historical shift's allocation. Mirrors the fallback step of
    // getActiveGoal (dashboard.ts), bounded to shiftDate instead of "now".
    supabase.from('goals').select('working_days')
      .eq('user_id', userId).eq('type', 'monthly')
      .lte('starts_at', shiftDate)
      .order('starts_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('shifts').select('id, started_at')
      .eq('user_id', userId).gte('started_at', dayStart).lt('started_at', dayEnd)
      .order('started_at', { ascending: true }),
  ]);

  const workingDays = goal?.working_days ?? [];
  if (workingDays.length === 0) return 0;

  const expenses: RecurringExpenseInput[] = (expenseRows ?? [])
    .filter((e): e is typeof e & { recurring_frequency: 'weekly' | 'monthly' } =>
      e.recurring_frequency === 'weekly' || e.recurring_frequency === 'monthly')
    .map(e => ({ amountCents: e.amount_cents, expenseDate: e.expense_date, frequency: e.recurring_frequency }));

  const dailyTotal = computeDailyAllocationCents(expenses, workingDays, new Date(dayStart));
  if (dailyTotal === 0) return 0;

  // Ordered ascending by started_at via the query above, so index N-1 (the
  // last shift chronologically) is the one splitAcrossShifts gives the
  // rounding remainder to.
  const orderedShiftIds = (sameDayShifts ?? []).map(s => s.id as string);
  const shiftCount = Math.max(orderedShiftIds.length, 1);
  const shares = splitAcrossShifts(dailyTotal, shiftCount);

  const index = orderedShiftIds.indexOf(shiftId);
  if (index === -1) {
    // The shift asking isn't among the same-day shifts we just fetched --
    // this would silently mis-allocate (wrong shiftCount, wrong position),
    // so fail loudly rather than guess. Callers must pass a shiftId for a
    // shift that's already persisted with started_at set on shiftDate.
    throw new Error(
      `getAllocatedFixedCentsForShift: shift ${shiftId} not found among user ${userId}'s shifts on ${shiftDate}`
    );
  }
  return shares[index];
}

// Per-category breakdown of the day's recurring-expense allocation (e.g.
// "rent: R$134.05"), for display in an audit-style day/week/month detail
// view -- distinct from getAllocatedFixedCentsForShift, which returns one
// summed, per-shift-split number for folding into net_cents. Each active
// recurring expense's own daily share is computed independently (matching
// the design's "no shared denominator" rule from computeDailyAllocationCents),
// then grouped by category since a user could have more than one recurring
// expense in the same category. Categories with a zero share (inactive that
// day) are omitted. Not shift-split -- this is a whole-day total, since a
// detail view spans however many shifts happened that day, not one shift.
export async function getRecurringExpenseBreakdownForDay(
  userId: string,
  dateStr: string,
): Promise<Array<{ category: string; amountCents: number }>> {
  const dayStart = `${dateStr}T00:00:00.000Z`;

  const [{ data: expenseRows }, { data: goal }] = await Promise.all([
    supabase.from('expenses').select('category, amount_cents, expense_date, recurring_frequency')
      .eq('user_id', userId).eq('recurring', true),
    supabase.from('goals').select('working_days')
      .eq('user_id', userId).eq('type', 'monthly')
      .lte('starts_at', dateStr)
      .order('starts_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const workingDays = goal?.working_days ?? [];
  if (workingDays.length === 0) return [];

  const recurring = (expenseRows ?? []).filter(
    (e): e is typeof e & { recurring_frequency: 'weekly' | 'monthly' } =>
      e.recurring_frequency === 'weekly' || e.recurring_frequency === 'monthly'
  );

  const byCategory = new Map<string, number>();
  for (const e of recurring) {
    const share = computeDailyAllocationCents(
      [{ amountCents: e.amount_cents, expenseDate: e.expense_date, frequency: e.recurring_frequency }],
      workingDays,
      new Date(dayStart),
    );
    if (share > 0) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + share);
  }

  return Array.from(byCategory.entries()).map(([category, amountCents]) => ({ category, amountCents }));
}
