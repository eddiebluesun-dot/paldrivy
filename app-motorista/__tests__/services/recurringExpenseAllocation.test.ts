import {
  getAllocatedFixedCentsForShift,
  getRecurringExpenseTotalForRange,
  syncAllocatedFixedCentsForDay,
} from '@/src/services/recurringExpenseAllocation';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

// Minimal fake Supabase query builder, matching the convention established in
// __tests__/services/rentalAllowance.test.ts: filters an in-memory row array
// as .eq()/.gte()/.lt()/.order()/.limit() calls come in, and resolves like
// the real client when awaited (or via .maybeSingle() for single-row reads).
// Reused across the expenses/goals/shifts tables in these tests by handing it
// a different row array per table.
function makeQueryBuilder(rows: Record<string, unknown>[], updateSink?: Array<{ id: unknown; payload: Record<string, unknown> }>) {
  let filtered = rows;
  const builder: any = {
    select: () => builder,
    eq: (field: string, value: unknown) => {
      filtered = filtered.filter(r => r[field] === value);
      return builder;
    },
    // Only exercised by syncAllocatedFixedCentsForDay's per-shift correction
    // write (shifts table). Mirrors the real client shape:
    // .update({...}).eq('id', shiftId).
    update: (payload: Record<string, unknown>) => ({
      eq: (field: string, value: unknown) => {
        updateSink?.push({ id: value, payload });
        void field;
        return Promise.resolve({ error: null });
      },
    }),
    gte: (field: string, value: unknown) => {
      filtered = filtered.filter(r => (r[field] as string) >= (value as string));
      return builder;
    },
    lt: (field: string, value: unknown) => {
      filtered = filtered.filter(r => (r[field] as string) < (value as string));
      return builder;
    },
    lte: (field: string, value: unknown) => {
      filtered = filtered.filter(r => (r[field] as string) <= (value as string));
      return builder;
    },
    order: (field: string, opts?: { ascending?: boolean }) => {
      const ascending = opts?.ascending !== false;
      filtered = [...filtered].sort((a, b) => {
        const av = a[field] as string;
        const bv = b[field] as string;
        if (av < bv) return ascending ? -1 : 1;
        if (av > bv) return ascending ? 1 : -1;
        return 0;
      });
      return builder;
    },
    limit: (n: number) => {
      filtered = filtered.slice(0, n);
      return builder;
    },
    maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null }),
    then: (resolve: (v: { data: Record<string, unknown>[] }) => unknown) =>
      resolve({ data: filtered }),
  };
  return builder;
}

function mockTables(opts: {
  expenses?: Record<string, unknown>[];
  goal?: Record<string, unknown> | null;
  goals?: Record<string, unknown>[];
  shifts?: Record<string, unknown>[];
}) {
  const { expenses = [], goal = null, goals, shifts = [] } = opts;
  const goalRows = goals ?? (goal ? [goal] : []);
  const shiftUpdates: Array<{ id: unknown; payload: Record<string, unknown> }> = [];
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'expenses') return makeQueryBuilder(expenses);
    if (table === 'goals') return makeQueryBuilder(goalRows);
    if (table === 'shifts') return makeQueryBuilder(shifts, shiftUpdates);
    throw new Error(`unexpected table ${table}`);
  });
  return { shiftUpdates };
}

describe('getAllocatedFixedCentsForShift', () => {
  it('fetches recurring expenses + working_days + same-day shifts and splits the daily total', async () => {
    // Rent R$660/week, expense_date anchors the weekly cycle to a Tuesday,
    // driver works Mon-Sat (6 days) -> 66000/6 = 11000 cents/day (same as
    // recurringExpenseAllocationUtils.test.ts's first computeDailyAllocationCents case).
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 66000, expense_date: '2026-08-04', recurring: true, recurring_frequency: 'weekly' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
      shifts: [
        { id: 's1', user_id: 'user-1', started_at: '2026-08-05T08:00:00.000Z' },
        { id: 's2', user_id: 'user-1', started_at: '2026-08-05T18:00:00.000Z' },
      ],
    });

    // 11000 split evenly across 2 shifts -> 5500 each (no remainder here).
    const result = await getAllocatedFixedCentsForShift('user-1', '2026-08-05', 's1');
    expect(result).toBe(5500);
  });

  it('returns 0 when there are no active recurring expenses', async () => {
    mockTables({
      expenses: [],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
      shifts: [{ id: 's1', user_id: 'user-1', started_at: '2026-08-05T08:00:00.000Z' }],
    });
    const result = await getAllocatedFixedCentsForShift('user-1', '2026-08-05', 's1');
    expect(result).toBe(0);
  });

  it('returns 0 when there is no goal (no working_days to allocate against)', async () => {
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 66000, expense_date: '2026-08-04', recurring: true, recurring_frequency: 'weekly' }],
      goal: null,
      shifts: [{ id: 's1', user_id: 'user-1', started_at: '2026-08-05T08:00:00.000Z' }],
    });
    const result = await getAllocatedFixedCentsForShift('user-1', '2026-08-05', 's1');
    expect(result).toBe(0);
  });

  // Regression test for the code-review fix: the goal lookup must be scoped
  // to shiftDate (.lte('starts_at', shiftDate)), not just "most recent goal
  // overall". createManualShift lets a driver log a backdated shift, and if
  // a newer goal (different working_days) has since been created, applying
  // that newer goal's working_days to the historical shift would silently
  // mis-allocate. Before the fix, this test would pick the 2026-08-01 goal
  // (5 working days -> dailyTotal 13200) instead of the 2026-07-01 goal that
  // was actually active on the backdated shiftDate (6 working days ->
  // dailyTotal 11000).
  it('scopes the goal lookup to shiftDate, using the goal active back then rather than a newer one', async () => {
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 66000, expense_date: '2026-07-07', recurring: true, recurring_frequency: 'weekly' }],
      goals: [
        { user_id: 'user-1', type: 'monthly', starts_at: '2026-07-01', working_days: [1, 2, 3, 4, 5, 6] },
        // Created after the backdated shiftDate below -- must NOT be picked.
        { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5] },
      ],
      shifts: [{ id: 's1', user_id: 'user-1', started_at: '2026-07-08T08:00:00.000Z' }],
    });

    const result = await getAllocatedFixedCentsForShift('user-1', '2026-07-08', 's1');
    expect(result).toBe(11000);
  });

  // This is the test that proves the remainder-assignment gap (flagged in the
  // task brief) is actually closed: the brief's own Step 3 sample code always
  // returned shares[0] no matter which shift asked, so querying a 3-shift day
  // for each of its 3 shifts would return the SAME value three times. The
  // fix must return each shift's own positional share instead.
  //
  // Note: given splitAcrossShifts's design (Task 2, already committed) -- it
  // fills every share with the same base amount and adds the ENTIRE rounding
  // remainder to only the last share -- the correct output for 3 shifts is
  // [base, base, base + remainder], i.e. the first two are legitimately
  // identical (neither absorbs the remainder) and only the last differs.
  // "Three pairwise-distinct values" is therefore not the correct fixed
  // behavior; what this test asserts instead is the literal negative in the
  // brief -- the three results are NOT all identical -- plus that it's
  // specifically the last shift by started_at order that receives the extra
  // cent(s), which is what proves positional (not shares[0]-always) behavior.
  it('gives a 3-shift day per-shift shares that are NOT the same value repeated three times', async () => {
    // Single weekly expense, dailyTotal = 66000/6 = 11000 (same anchor/target
    // as the first test). Split across 3 shifts: floor(11000/3) = 3666,
    // remainder = 11000 - 3666*3 = 2, so shares = [3666, 3666, 3668].
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 66000, expense_date: '2026-08-04', recurring: true, recurring_frequency: 'weekly' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
      // Rows deliberately returned out of started_at order, to prove the
      // implementation sorts by started_at itself rather than trusting
      // incidental row order from the query result.
      shifts: [
        { id: 's3', user_id: 'user-1', started_at: '2026-08-05T18:00:00.000Z' },
        { id: 's1', user_id: 'user-1', started_at: '2026-08-05T08:00:00.000Z' },
        { id: 's2', user_id: 'user-1', started_at: '2026-08-05T12:00:00.000Z' },
      ],
    });

    const first = await getAllocatedFixedCentsForShift('user-1', '2026-08-05', 's1');
    const second = await getAllocatedFixedCentsForShift('user-1', '2026-08-05', 's2');
    const third = await getAllocatedFixedCentsForShift('user-1', '2026-08-05', 's3');

    expect(first).toBe(3666);
    expect(second).toBe(3666);
    expect(third).toBe(3668); // last shift by started_at absorbs the remainder
    expect([first, second, third]).not.toEqual([3666, 3666, 3666]); // not shares[0] for everyone
    expect(first + second + third).toBe(11000); // shares still sum back to the exact daily total
  });

  it('a daily-frequency expense contributes its full amount, not divided across a period', async () => {
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 5000, expense_date: '2026-08-04', recurring: true, recurring_frequency: 'daily' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
      shifts: [{ id: 's1', user_id: 'user-1', started_at: '2026-08-05T08:00:00.000Z' }],
    });
    const result = await getAllocatedFixedCentsForShift('user-1', '2026-08-05', 's1');
    expect(result).toBe(5000);
  });

  it('an expense past its ends_at no longer contributes', async () => {
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 66000, expense_date: '2026-08-04', recurring: true, recurring_frequency: 'weekly', ends_at: '2026-08-05' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
      shifts: [{ id: 's1', user_id: 'user-1', started_at: '2026-08-05T08:00:00.000Z' }],
    });
    const result = await getAllocatedFixedCentsForShift('user-1', '2026-08-05', 's1');
    expect(result).toBe(0);
  });

  it('throws when shiftId is not among the fetched same-day shifts (defensive: caller passed a bad/unpersisted id)', async () => {
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 66000, expense_date: '2026-08-04', recurring: true, recurring_frequency: 'weekly' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
      shifts: [{ id: 's1', user_id: 'user-1', started_at: '2026-08-05T08:00:00.000Z' }],
    });

    await expect(getAllocatedFixedCentsForShift('user-1', '2026-08-05', 'does-not-exist')).rejects.toThrow();
  });
});

describe('getRecurringExpenseTotalForRange', () => {
  // Regression coverage for the bug found in production: getWeekTotals/
  // getMonthReport/getYearlyReport used to sum the raw `expenses` rows within
  // their date window directly. A weekly-frequency recurring expense is
  // stored as ONE row (its `expense_date` anchor), so that raw sum only ever
  // credited whichever single week/month happened to contain the anchor date
  // -- every other period saw nothing for it. This function instead sums the
  // per-day prorated share (same math as getAllocatedFixedCentsForShift)
  // across every day in the requested range.
  it('sums a weekly expense\'s daily share across a full month, not just the week containing its anchor date', async () => {
    // R$804.31/week (Eddie's real production figure), Mon-Sat (6 working
    // days) -> 80431/6 = 13405 cents/day (rounds to R$134.05, matching the
    // "Total despesas" rateio the driver actually sees).
    //
    // expense_date=2026-08-10 (a Monday) is this expense's own anchor --
    // it didn't exist before that date, so days 2026-08-01..09 must
    // contribute 0 (fixed 2026-08-19: computeDailyAllocationCents used to
    // only check the upper bound (ends_at), never the lower bound
    // (expense_date itself), so it retroactively charged this rent from the
    // 1st of the month even though the expense was anchored on the 10th --
    // this is the exact bug that hit production for this real user/expense).
    // Working days 2026-08-10..31: Aug 10-15, 17-22, 24-29 (6 each) + Aug 31
    // (1) = 19 working days (Sundays 16/23/30 excluded, and 01-09 excluded
    // entirely as before-anchor).
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 80431, expense_date: '2026-08-10', recurring: true, recurring_frequency: 'weekly' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
    });

    const total = await getRecurringExpenseTotalForRange('user-1', '2026-08-01', '2026-09-01');
    expect(total).toBe(19 * 13405);
  });

  it('returns 0 for a range with no active recurring expenses', async () => {
    mockTables({
      expenses: [],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
    });
    const total = await getRecurringExpenseTotalForRange('user-1', '2026-08-01', '2026-09-01');
    expect(total).toBe(0);
  });

  it('returns 0 when there is no goal covering the range (no working_days to allocate against)', async () => {
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 80431, expense_date: '2026-08-10', recurring: true, recurring_frequency: 'weekly' }],
      goal: null,
    });
    const total = await getRecurringExpenseTotalForRange('user-1', '2026-08-01', '2026-09-01');
    expect(total).toBe(0);
  });

  it('an expense that ends partway through the range only counts the days before ends_at', async () => {
    mockTables({
      // Daily R$50, ends 2026-08-04 (the 4th itself is excluded), so only
      // Aug 1/2/3 are even candidates -- but Aug 2, 2026 is a Sunday (Aug 10
      // is the known Monday anchor used elsewhere in this file), not a
      // Mon-Sat working day, so only Aug 1 (Sat) and Aug 3 (Mon) count = 2 days.
      expenses: [{ user_id: 'user-1', amount_cents: 5000, expense_date: '2026-08-01', recurring: true, recurring_frequency: 'daily', ends_at: '2026-08-04' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
    });
    const total = await getRecurringExpenseTotalForRange('user-1', '2026-08-01', '2026-08-08');
    expect(total).toBe(2 * 5000);
  });
});

describe('syncAllocatedFixedCentsForDay', () => {
  // Regression coverage for the production bug: a shift ended earlier in the
  // day (back when it was the day's ONLY shift) keeps the day's FULL
  // recurring share in its allocated_fixed_cents/net_cents -- nothing
  // revisited it once a second shift joined the same day. This re-fetches
  // every shift on the day and corrects any whose stored share no longer
  // matches an even split across the day's current shift count.
  it('corrects an earlier shift that is still holding the full-day share after a second shift joins the day', async () => {
    // Daily total = 13405 (matches getAllocatedFixedCentsForShift's own
    // fixture above). Two shifts -> splitAcrossShifts(13405, 2) = [6702, 6703].
    const { shiftUpdates } = mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 80431, expense_date: '2026-08-10', recurring: true, recurring_frequency: 'weekly' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
      shifts: [
        // Stale: this shift ended when it was the day's only shift, so it
        // was allocated the FULL 13405 -- now wrong since a second shift
        // exists. gross 21691, no trip deductions -> net was 21691-13405=8286.
        { id: 's1', user_id: 'user-1', started_at: '2026-08-13T09:23:00.000Z', gross_cents: 21691, net_cents: 8286, tolls_cents: 0, parking_cents: 0, food_cents: 0, allocated_fixed_cents: 13405 },
        // New shift, correctly allocated its own share at completion time.
        { id: 's2', user_id: 'user-1', started_at: '2026-08-13T18:47:00.000Z', gross_cents: 156, net_cents: 156 - 6703, tolls_cents: 0, parking_cents: 0, food_cents: 0, allocated_fixed_cents: 6703 },
      ],
    });

    await syncAllocatedFixedCentsForDay('user-1', '2026-08-13');

    // s1 (first by started_at) gets the base share; s2 (last) absorbs the
    // rounding remainder -- same convention as splitAcrossShifts elsewhere.
    expect(shiftUpdates).toContainEqual({ id: 's1', payload: { allocated_fixed_cents: 6702, net_cents: 21691 - 6702 } });
    // s2 was already correct (6703) -- update() must be skipped for it
    // entirely (see the `if (currentShare === newAllocated) return null`
    // short-circuit), not just a no-op write.
    expect(shiftUpdates.find(u => u.id === 's2')).toBeUndefined();
    expect(shiftUpdates).toHaveLength(1);
  });

  it('does nothing (no updates fired) when every shift already holds its correct even share', async () => {
    const { shiftUpdates } = mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 80431, expense_date: '2026-08-10', recurring: true, recurring_frequency: 'weekly' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
      shifts: [
        { id: 's1', user_id: 'user-1', started_at: '2026-08-13T09:23:00.000Z', gross_cents: 21691, net_cents: 21691 - 6702, tolls_cents: 0, parking_cents: 0, food_cents: 0, allocated_fixed_cents: 6702 },
        { id: 's2', user_id: 'user-1', started_at: '2026-08-13T18:47:00.000Z', gross_cents: 156, net_cents: 156 - 6703, tolls_cents: 0, parking_cents: 0, food_cents: 0, allocated_fixed_cents: 6703 },
      ],
    });

    await syncAllocatedFixedCentsForDay('user-1', '2026-08-13');

    expect(shiftUpdates).toHaveLength(0);
  });

  it('never throws even if a lookup fails -- a sync failure must not block whatever shift save triggered it', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => { throw new Error('boom'); });
    await expect(syncAllocatedFixedCentsForDay('user-1', '2026-08-13')).resolves.toBeUndefined();
  });
});
