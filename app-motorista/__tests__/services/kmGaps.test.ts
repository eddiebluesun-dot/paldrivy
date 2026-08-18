import { getKmGapsForDay, updateKmGap } from '@/src/services/kmGaps';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

// Minimal fake Supabase select-query builder, same style as
// __tests__/services/rentalAllowance.test.ts's makeQueryBuilder. Row
// timestamps here are deliberately NAIVE (no 'Z'/offset suffix) so that
// `new Date(...)` parses them as local time -- exactly matching how
// getKmGapsForDay computes its own dayStart/dayEnd bounds
// (`new Date(dateStr + 'T00:00:00')`). This keeps the test's expectations
// independent of the test runner's actual timezone: both sides of every
// comparison go through the same local-time interpretation.
function makeSelectBuilder(rows: Record<string, unknown>[]) {
  let filtered = rows;
  const builder: any = {
    select: () => builder,
    eq: (field: string, value: unknown) => { filtered = filtered.filter(r => r[field] === value); return builder; },
    lt: (field: string, value: unknown) => { filtered = filtered.filter(r => (r[field] as string) < (value as string)); return builder; },
    gt: (field: string, value: unknown) => { filtered = filtered.filter(r => (r[field] as string) > (value as string)); return builder; },
    order: () => builder,
    then: (resolve: (v: { data: Record<string, unknown>[]; error: null }) => unknown) =>
      resolve({ data: filtered, error: null }),
  };
  return builder;
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1', user_id: 'u1', vehicle_id: 'v1',
    start_odometer_meters: 20739000, end_odometer_meters: 20853000, gap_meters: 114000,
    start_at: '2026-08-15T15:46:00', end_at: '2026-08-17T12:44:39',
    category: 'personal_use', note: null, is_edited: false,
    created_at: '2026-08-18T00:00:00', updated_at: '2026-08-18T00:00:00',
    ...overrides,
  };
}

describe('getKmGapsForDay', () => {
  it('returns a gap whose window overlaps the given local day', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      expect(table).toBe('km_gaps');
      return makeSelectBuilder([makeRow()]);
    });
    const result = await getKmGapsForDay('u1', '2026-08-16');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g1');
    expect(result[0].gap_meters).toBe(114000);
  });

  it('marks a gap that starts and ends on different local calendar days as spanning multiple days', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => makeSelectBuilder([
      makeRow({ start_at: '2026-08-15T22:00:00', end_at: '2026-08-16T06:00:00' }),
    ]));
    const result = await getKmGapsForDay('u1', '2026-08-16');
    expect(result[0].spansMultipleDays).toBe(true);
  });

  it('marks a same-day gap as not spanning multiple days', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => makeSelectBuilder([
      makeRow({ start_at: '2026-08-16T08:00:00', end_at: '2026-08-16T12:00:00' }),
    ]));
    const result = await getKmGapsForDay('u1', '2026-08-16');
    expect(result[0].spansMultipleDays).toBe(false);
  });

  it('excludes a gap entirely outside the requested day', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => makeSelectBuilder([
      makeRow({ start_at: '2026-08-10T08:00:00', end_at: '2026-08-10T12:00:00' }),
    ]));
    const result = await getKmGapsForDay('u1', '2026-08-16');
    expect(result).toHaveLength(0);
  });
});

describe('updateKmGap', () => {
  it('sets category, note, and is_edited=true, without touching the odometer fields', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      expect(table).toBe('km_gaps');
      return { update: updateMock };
    });
    await updateKmGap('g1', { category: 'other', note: 'foi buscar filho na escola' });
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      category: 'other', note: 'foi buscar filho na escola', is_edited: true,
    }));
    expect(eqMock).toHaveBeenCalledWith('id', 'g1');
  });

  it('throws when the update fails', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: new Error('boom') }) }),
    }));
    await expect(updateKmGap('g1', { category: 'other', note: null })).rejects.toThrow('boom');
  });
});
