import { getAllocatedFixedCentsForShift } from '@/src/services/recurringExpenseAllocation';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

// Minimal fake Supabase query builder, matching the convention established in
// __tests__/services/rentalAllowance.test.ts: filters an in-memory row array
// as .eq()/.gte()/.lt()/.order()/.limit() calls come in, and resolves like
// the real client when awaited (or via .maybeSingle() for single-row reads).
// Reused across the expenses/goals/shifts tables in these tests by handing it
// a different row array per table.
function makeQueryBuilder(rows: Record<string, unknown>[]) {
  let filtered = rows;
  const builder: any = {
    select: () => builder,
    eq: (field: string, value: unknown) => {
      filtered = filtered.filter(r => r[field] === value);
      return builder;
    },
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
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'expenses') return makeQueryBuilder(expenses);
    if (table === 'goals') return makeQueryBuilder(goalRows);
    if (table === 'shifts') return makeQueryBuilder(shifts);
    throw new Error(`unexpected table ${table}`);
  });
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

  it('throws when shiftId is not among the fetched same-day shifts (defensive: caller passed a bad/unpersisted id)', async () => {
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 66000, expense_date: '2026-08-04', recurring: true, recurring_frequency: 'weekly' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
      shifts: [{ id: 's1', user_id: 'user-1', started_at: '2026-08-05T08:00:00.000Z' }],
    });

    await expect(getAllocatedFixedCentsForShift('user-1', '2026-08-05', 'does-not-exist')).rejects.toThrow();
  });
});
