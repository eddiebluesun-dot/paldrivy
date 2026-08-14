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

// Sum of every active recurring weekly/monthly expense's daily share across
// every day in [startDateStr, endDateStrExclusive) -- the range-level
// equivalent of getRecurringExpenseBreakdownForDay's whole-day total. Used by
// week/month/year aggregates (getWeekTotals, getMonthReport, getYearlyReport
// in dashboard.ts, getMonthHistory in cockpit.ts) so a recurring expense's
// cost is spread across every working day of the queried range instead of
// showing up only in whichever single day/window happens to contain the
// expense row's own `expense_date` anchor -- which is all a raw date-ranged
// `expenses` query can ever see, since a recurring expense is stored as ONE
// row, not one row per occurrence.
//
// `goal.working_days` can legitimately change mid-range (a new goal starting
// partway through the month), so this fetches every goal whose `starts_at`
// is on/before the range end once, then picks the most recent one that was
// already active as of each individual day -- same "most recent goal as of
// that day" rule getAllocatedFixedCentsForShift/getRecurringExpenseBreakdownForDay
// already apply per-day, just resolved locally instead of one query per day.
export async function getRecurringExpenseTotalForRange(
  userId: string,
  startDateStr: string,
  endDateStrExclusive: string,
): Promise<number> {
  const [{ data: expenseRows }, { data: goals }] = await Promise.all([
    supabase.from('expenses').select('amount_cents, expense_date, recurring_frequency')
      .eq('user_id', userId).eq('recurring', true),
    supabase.from('goals').select('starts_at, working_days')
      .eq('user_id', userId).eq('type', 'monthly')
      .lte('starts_at', endDateStrExclusive)
      .order('starts_at', { ascending: false }),
  ]);

  const recurring: RecurringExpenseInput[] = (expenseRows ?? [])
    .filter((e): e is typeof e & { recurring_frequency: 'weekly' | 'monthly' } =>
      e.recurring_frequency === 'weekly' || e.recurring_frequency === 'monthly')
    .map(e => ({ amountCents: e.amount_cents, expenseDate: e.expense_date, frequency: e.recurring_frequency }));
  if (recurring.length === 0) return 0;

  const goalList = (goals ?? []) as { starts_at: string; working_days: number[] | null }[];
  if (goalList.length === 0) return 0;

  function workingDaysAsOf(dateStr: string): number[] {
    const g = goalList.find(g => g.starts_at <= dateStr);
    return g?.working_days ?? [];
  }

  let total = 0;
  const cursor = new Date(`${startDateStr}T00:00:00.000Z`);
  const end = new Date(`${endDateStrExclusive}T00:00:00.000Z`);
  while (cursor < end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const workingDays = workingDaysAsOf(dateStr);
    if (workingDays.length > 0) {
      total += computeDailyAllocationCents(recurring, workingDays, cursor);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}

// Same range-level allocation as getRecurringExpenseTotalForRange, broken
// down per expense category (e.g. "rent: R$3,485.30 for the month") instead
// of collapsed into one number -- for report views (getMonthReport's
// expensesByCategory) that itemize despesas by category rather than showing
// one lump total. Each active recurring expense's own daily share is summed
// independently by category across the whole range, same "no shared
// denominator" rule as getRecurringExpenseBreakdownForDay.
export async function getRecurringExpenseBreakdownForRange(
  userId: string,
  startDateStr: string,
  endDateStrExclusive: string,
): Promise<Array<{ category: string; amountCents: number }>> {
  const [{ data: expenseRows }, { data: goals }] = await Promise.all([
    supabase.from('expenses').select('category, amount_cents, expense_date, recurring_frequency')
      .eq('user_id', userId).eq('recurring', true),
    supabase.from('goals').select('starts_at, working_days')
      .eq('user_id', userId).eq('type', 'monthly')
      .lte('starts_at', endDateStrExclusive)
      .order('starts_at', { ascending: false }),
  ]);

  const recurring = (expenseRows ?? []).filter(
    (e): e is typeof e & { recurring_frequency: 'weekly' | 'monthly' } =>
      e.recurring_frequency === 'weekly' || e.recurring_frequency === 'monthly',
  );
  if (recurring.length === 0) return [];

  const goalList = (goals ?? []) as { starts_at: string; working_days: number[] | null }[];
  if (goalList.length === 0) return [];

  function workingDaysAsOf(dateStr: string): number[] {
    const g = goalList.find(g => g.starts_at <= dateStr);
    return g?.working_days ?? [];
  }

  const byCategory = new Map<string, number>();
  const cursor = new Date(`${startDateStr}T00:00:00.000Z`);
  const end = new Date(`${endDateStrExclusive}T00:00:00.000Z`);
  while (cursor < end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const workingDays = workingDaysAsOf(dateStr);
    if (workingDays.length > 0) {
      for (const e of recurring) {
        const share = computeDailyAllocationCents(
          [{ amountCents: e.amount_cents, expenseDate: e.expense_date, frequency: e.recurring_frequency }],
          workingDays,
          cursor,
        );
        if (share > 0) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + share);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return Array.from(byCategory.entries()).map(([category, amountCents]) => ({ category, amountCents }));
}

// Re-splits a day's recurring-expense allocation across ALL of that day's
// shifts, correcting any sibling shift whose share is now stale.
//
// getAllocatedFixedCentsForShift computes ONE shift's share at the moment
// THAT shift is completed, based on however many same-day shifts exist at
// that instant. If a driver logs a second shift on a day that already has a
// completed (and thus already-allocated) first shift, the first shift's
// share was computed back when it was the ONLY shift of the day -- it got
// the day's FULL recurring cost, not half of it -- and nothing revisits it
// once the second shift shows up. The result: the day's shifts sum to MORE
// than the actual daily recurring cost (e.g. one shift keeps a full
// R$134.05 share while the new one also gets its own ~R$67 share), silently
// double-counting the day's rent/insurance/etc. against net_cents.
//
// Called after endShift/updateShift/createManualShift have already persisted
// the CURRENT shift's own allocation (unchanged, additive fix) -- this pass
// re-fetches every shift on the day and brings any OTHER shift's
// allocated_fixed_cents/net_cents back in line with what an even split
// across the day's current shift count actually is, matching the "multiple
// shifts split the day's allocation" rule from
// docs/superpowers/specs/2026-08-07-recurring-expense-daily-allocation-design.md.
// Deliberately best-effort/non-throwing, same posture as
// safeGetAllocatedFixedCentsForShift in shifts.ts -- a sync failure here must
// never block the shift save that triggered it.
export async function syncAllocatedFixedCentsForDay(userId: string, shiftDate: string): Promise<void> {
  try {
    const dayStart = `${shiftDate}T00:00:00.000Z`;
    const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

    const [{ data: expenseRows }, { data: goal }, { data: sameDayShifts }] = await Promise.all([
      supabase.from('expenses').select('amount_cents, expense_date, recurring_frequency')
        .eq('user_id', userId).eq('recurring', true),
      supabase.from('goals').select('working_days')
        .eq('user_id', userId).eq('type', 'monthly')
        .lte('starts_at', shiftDate)
        .order('starts_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('shifts')
        .select('id, started_at, gross_cents, net_cents, tolls_cents, parking_cents, food_cents, allocated_fixed_cents')
        .eq('user_id', userId).gte('started_at', dayStart).lt('started_at', dayEnd)
        .order('started_at', { ascending: true }),
    ]);

    const shifts = (sameDayShifts ?? []) as Array<{
      id: string; started_at: string; gross_cents: number | null; net_cents: number | null;
      tolls_cents: number | null; parking_cents: number | null; food_cents: number | null;
      allocated_fixed_cents: number | null;
    }>;
    if (shifts.length === 0) return;

    const workingDays = goal?.working_days ?? [];
    const expenses: RecurringExpenseInput[] = (expenseRows ?? [])
      .filter((e): e is typeof e & { recurring_frequency: 'weekly' | 'monthly' } =>
        e.recurring_frequency === 'weekly' || e.recurring_frequency === 'monthly')
      .map(e => ({ amountCents: e.amount_cents, expenseDate: e.expense_date, frequency: e.recurring_frequency }));

    const dailyTotal = workingDays.length > 0
      ? computeDailyAllocationCents(expenses, workingDays, new Date(dayStart))
      : 0;
    const shares = splitAcrossShifts(dailyTotal, shifts.length);

    await Promise.all(shifts.map((s, i) => {
      const newAllocated = shares[i] ?? 0;
      if ((s.allocated_fixed_cents ?? 0) === newAllocated) return null;
      const deductions = (s.tolls_cents ?? 0) + (s.parking_cents ?? 0) + (s.food_cents ?? 0);
      const newNet = (s.gross_cents ?? 0) - deductions - newAllocated;
      return supabase.from('shifts')
        .update({ allocated_fixed_cents: newAllocated, net_cents: newNet })
        .eq('id', s.id);
    }));
  } catch (err) {
    console.error(`[recurringExpenseAllocation] failed to sync day ${shiftDate} for user ${userId}`, err);
  }
}
