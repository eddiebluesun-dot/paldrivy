import { hasExpenseSince } from '@/src/services/expenses';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

// Minimal fake Supabase query builder: filters an in-memory row array as
// .eq()/.gte() calls come in, and resolves like the real client when
// .limit() is awaited (same convention as rentalAllowance.test.ts's
// makeQueryBuilder, extended with .limit() since hasExpenseSince chains one).
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
    limit: (n: number) => Promise.resolve({ data: filtered.slice(0, n) }),
  };
  return builder;
}

describe('hasExpenseSince', () => {
  it('returns true when a matching-category expense exists on/after the given date', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'expenses') {
        return makeQueryBuilder([
          { id: 'e1', user_id: 'u1', category: 'km_excedente', expense_date: '2026-08-06' },
        ]);
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await hasExpenseSince('u1', 'km_excedente', '2026-08-05');
    expect(result).toBe(true);
  });

  it('returns false when the only matching-category expense is before the given date', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'expenses') {
        return makeQueryBuilder([
          { id: 'e1', user_id: 'u1', category: 'km_excedente', expense_date: '2026-07-20' },
        ]);
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await hasExpenseSince('u1', 'km_excedente', '2026-08-05');
    expect(result).toBe(false);
  });

  it('returns false when no expenses exist for this category at all', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'expenses') return makeQueryBuilder([]);
      throw new Error(`unexpected table ${table}`);
    });

    const result = await hasExpenseSince('u1', 'km_excedente', '2026-08-05');
    expect(result).toBe(false);
  });
});
