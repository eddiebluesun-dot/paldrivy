import { test, expect, describe, jest, beforeEach, afterEach } from '@jest/globals';

// Regression coverage: Eddie confirmed the "Resumo do Mês" card should show
// the CURRENT (in-progress) month as month-to-date -- i.e. recurring-expense
// proration (rent/insurance/etc, spread across every working day of the
// range by getRecurringExpenseTotalForRange) must stop at TODAY, not smear
// across days that haven't happened yet just because they're calendar days
// of the current month. A CLOSED/past month keeps going through its actual
// last day, unchanged -- there's no "future" in a past month to exclude.
jest.mock('../../src/lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../src/services/recurringExpenseAllocation', () => ({
  getRecurringExpenseTotalForRange: jest.fn().mockResolvedValue(0),
}));

import { supabase } from '../../src/lib/supabase';
import { getMonthHistory } from '../../src/services/cockpit';
import { getRecurringExpenseTotalForRange } from '../../src/services/recurringExpenseAllocation';

function emptyQueryBuilder() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    not: () => builder,
    then: (resolve: (v: { data: never[]; error: null }) => unknown) => resolve({ data: [], error: null }),
  };
  return builder;
}

describe('getMonthHistory — recurring-expense range end date', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.from as jest.Mock).mockImplementation(() => emptyQueryBuilder());
    // Pin "now" to 2026-08-19 (a Wednesday), independent of the real system
    // clock, so this test is deterministic regardless of when it's run.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T12:00:00-03:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('the CURRENT month is queried up to tomorrow (exclusive), not the full calendar month', async () => {
    await getMonthHistory('user-1', 2); // buckets: July 2026 (closed), August 2026 (current)

    const calls = (getRecurringExpenseTotalForRange as jest.Mock).mock.calls as unknown as [string, string, string][];
    const augustCall = calls.find(([, start]) => start === '2026-08-01');
    expect(augustCall).toBeDefined();
    expect(augustCall![2]).toBe('2026-08-20'); // tomorrow, exclusive -- NOT '2026-09-01'
  });

  test('a CLOSED past month is still queried through its real last day', async () => {
    await getMonthHistory('user-1', 2); // buckets: July 2026 (closed), August 2026 (current)

    const calls = (getRecurringExpenseTotalForRange as jest.Mock).mock.calls as unknown as [string, string, string][];
    const julyCall = calls.find(([, start]) => start === '2026-07-01');
    expect(julyCall).toBeDefined();
    expect(julyCall![2]).toBe('2026-08-01'); // unchanged: first day of the following month
  });
});
