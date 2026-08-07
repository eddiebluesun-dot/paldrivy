import { test, expect, describe, jest } from '@jest/globals';
import { upsertMonthlyGoal } from '../../src/services/dashboard';

// Minimal chainable/thenable fake matching the subset of the supabase-js
// query builder that upsertMonthlyGoal actually calls: .select().eq().eq()
// .eq().maybeSingle() to look up an existing row, then either
// .update(payload).eq('id', ...) or .insert({...}).
// mockFrom* naming is required so the identifier survives Jest's module
// factory hoisting (see __tests__/components/CockpitCard.test.tsx for the
// same convention already used in this codebase).
function mockFromMakeChain(resolveValue: { data?: unknown; error: unknown }) {
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    update: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    maybeSingle: jest.fn(() => Promise.resolve(resolveValue)),
    then: (resolve: any, reject: any) => Promise.resolve(resolveValue).then(resolve, reject),
  };
  return chain;
}

const mockFromFn = jest.fn();

jest.mock('../../src/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFromFn(...args) },
}));

describe('upsertMonthlyGoal', () => {
  test('does not insert a duplicate row when the existing-row lookup errors', async () => {
    // Real production scenario (observed in the `goals` table): once two rows
    // already exist for the same user/type/starts_at, maybeSingle() on the
    // existence check errors ("multiple (or no) rows returned"). The old code
    // ignored that error and treated it as "no existing row", inserting yet
    // another duplicate on every subsequent save.
    mockFromFn.mockReset();
    mockFromFn.mockImplementationOnce(() =>
      mockFromMakeChain({ data: null, error: { message: 'JSON object requested, multiple rows returned', code: 'PGRST116' } }),
    );

    await expect(upsertMonthlyGoal('user-1', 800000, [1, 2, 3, 4, 5, 6])).rejects.toBeTruthy();
    // Only the lookup call should have happened — no second call to `.from('goals')` to insert.
    expect(mockFromFn).toHaveBeenCalledTimes(1);
  });

  test('updates the existing row (does not insert) when one is found', async () => {
    mockFromFn.mockReset();
    const updateChain = mockFromMakeChain({ error: null });
    mockFromFn
      .mockImplementationOnce(() => mockFromMakeChain({ data: { id: 'goal-123' }, error: null }))
      .mockImplementationOnce(() => updateChain);

    await upsertMonthlyGoal('user-1', 800000, [1, 2, 3, 4, 5, 6]);

    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      target_amount_cents: 800000,
      working_days: [1, 2, 3, 4, 5, 6],
    }));
    expect(updateChain.eq).toHaveBeenCalledWith('id', 'goal-123');
    expect(mockFromFn).toHaveBeenCalledTimes(2); // lookup + update, no insert
  });
});
