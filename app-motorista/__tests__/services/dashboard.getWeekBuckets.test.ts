import { test, expect, describe, jest, beforeEach, afterEach } from '@jest/globals';
import { getWeekBuckets } from '../../src/services/dashboard';
import { supabase } from '../../src/lib/supabase';

jest.mock('../../src/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

// Minimal fake Supabase query builder for the 'shifts' table, matching the
// convention already used in __tests__/services/rentalAllowance.test.ts and
// recurringExpenseAllocation.test.ts: filters an in-memory row array as
// .eq()/.gte()/.lte()/.not()/.order() calls come in, then resolves like the
// real client when awaited.
function makeShiftsQueryBuilder(rows: Record<string, unknown>[]) {
  let filtered = rows;
  const builder: any = {
    select: (_cols: string) => builder,
    eq: (field: string, value: unknown) => {
      filtered = filtered.filter(r => r[field] === value);
      return builder;
    },
    gte: (field: string, value: unknown) => {
      filtered = filtered.filter(r => (r[field] as string) >= (value as string));
      return builder;
    },
    lte: (field: string, value: unknown) => {
      filtered = filtered.filter(r => (r[field] as string) <= (value as string));
      return builder;
    },
    not: (field: string, _op: string, _value: unknown) => {
      filtered = filtered.filter(r => r[field] != null);
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
    then: (resolve: (v: { data: Record<string, unknown>[]; error: null }) => unknown) =>
      resolve({ data: filtered, error: null }),
  };
  return builder;
}

describe('getWeekBuckets', () => {
  beforeEach(() => {
    // Pin "now" to a known Wednesday so the Monday-Sunday window getWeekBuckets
    // computes internally is deterministic across test runs/days.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T12:00:00-03:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('sums gross_cents per day, not net_cents (regression: production data showed net_cents can be stale/uncorrected for historical shifts while gross_cents is always authoritative)', async () => {
    // Real production shape: a shift whose net_cents was clobbered by the
    // (now-removed) legacy calculate-shift edge function stays stuck equal to
    // gross_cents forever (allocated_fixed_cents never subtracted), while
    // gross_cents itself was never affected by that bug. The "Esta Semana"
    // bars/chip must read gross_cents so they always agree with the RECEITA
    // tile (KillShotCards, which reads gross_cents via getWeekTotals) instead
    // of silently disagreeing with it whenever a shift carries stale net_cents.
    const rows = [
      { user_id: 'u1', started_at: '2026-08-10T12:54:03.000Z', ended_at: '2026-08-10T15:51:02.000Z', gross_cents: 9559, net_cents: 9559 },
      { user_id: 'u1', started_at: '2026-08-15T11:57:00.000Z', ended_at: '2026-08-15T18:46:00.000Z', gross_cents: 25828, net_cents: 12423 },
    ];
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'shifts') return makeShiftsQueryBuilder(rows);
      throw new Error(`unexpected table ${table}`);
    });

    const buckets = await getWeekBuckets('u1');

    expect(buckets).toHaveLength(7);
    const aug10 = buckets.find(b => b.date === '2026-08-10');
    const aug15 = buckets.find(b => b.date === '2026-08-15');
    expect(aug10).toBeDefined();
    expect(aug15).toBeDefined();
    // Must equal gross_cents, not the (possibly stale) net_cents.
    expect((aug10 as any).gross_cents).toBe(9559);
    expect((aug15 as any).gross_cents).toBe(25828);
    // Explicitly no net_cents field left on the bucket shape.
    expect(aug10).not.toHaveProperty('net_cents');

    const weekTotal = buckets.reduce((s, b) => s + (b as any).gross_cents, 0);
    expect(weekTotal).toBe(9559 + 25828);
  });

  test('queries gross_cents from the shifts table (not net_cents)', async () => {
    const selectSpy = jest.fn((_cols: string) => makeShiftsQueryBuilder([]));
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'shifts') {
        const builder = makeShiftsQueryBuilder([]);
        const originalSelect = builder.select;
        builder.select = (cols: string) => { selectSpy(cols); return originalSelect(cols); };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    });

    await getWeekBuckets('u1');

    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining('gross_cents'));
    expect(selectSpy).not.toHaveBeenCalledWith(expect.stringContaining('net_cents'));
  });
});
