import { endShift, updateShift, createManualShift } from '@/src/services/shifts';
import { getAllocatedFixedCentsForShift } from '@/src/services/recurringExpenseAllocation';
import { supabase } from '@/src/lib/supabase';
import type { EndShiftData } from '@/src/types';

jest.mock('@/src/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

// Task 3's function has its own dedicated test coverage
// (__tests__/services/recurringExpenseAllocation.test.ts) -- these tests mock
// it out entirely so we're testing shifts.ts's WIRING (does it call the
// allocation lookup with the right args, at the right time, and persist the
// result correctly) rather than re-testing the allocation math itself.
jest.mock('@/src/services/recurringExpenseAllocation', () => ({
  getAllocatedFixedCentsForShift: jest.fn(),
}));

// Minimal fake 'shifts' table double supporting the three chain shapes these
// functions use:
//   .select('user_id, started_at').eq('id', x).single()   (fetch context)
//   .update({...}).eq('id', x)                             (persist)
//   .insert({...}).select('id').single()                   (create, then read back id)
// Captures every update/insert payload seen so tests can assert on them.
function makeShiftsTableDouble(opts: { fetchRow?: Record<string, unknown>; insertId?: string; fetchError?: Error }) {
  const updates: Record<string, unknown>[] = [];
  let insertPayload: Record<string, unknown> | undefined;

  const table = {
    select: (_cols: string) => ({
      eq: (_field: string, _value: unknown) => ({
        single: () =>
          opts.fetchError
            ? Promise.resolve({ data: null, error: opts.fetchError })
            : Promise.resolve({ data: opts.fetchRow ?? null, error: null }),
      }),
    }),
    update: (payload: Record<string, unknown>) => ({
      eq: (_field: string, _value: unknown) => {
        updates.push(payload);
        return Promise.resolve({ error: null });
      },
    }),
    insert: (payload: Record<string, unknown>) => {
      insertPayload = payload;
      return {
        select: (_cols: string) => ({
          single: () => Promise.resolve({ data: { id: opts.insertId ?? 'new-id' }, error: null }),
        }),
      };
    },
  };

  return { table, updates, getInsertPayload: () => insertPayload };
}

function mockShiftsTable(opts: Parameters<typeof makeShiftsTableDouble>[0]) {
  const double = makeShiftsTableDouble(opts);
  (supabase.from as jest.Mock).mockImplementation((tableName: string) => {
    if (tableName === 'shifts') return double.table;
    throw new Error(`unexpected table ${tableName}`);
  });
  return double;
}

function basePayload(overrides: Partial<EndShiftData> = {}): EndShiftData {
  return {
    odometer_end_meters: 1000,
    platforms: [{ platform_name: 'Uber', amount_cents: 20000 }],
    tolls_cents: 500,
    parking_cents: 0,
    food_cents: 0,
    tips_cents: 1000,
    bonuses_cents: 0,
    rides_count: 5,
    ...overrides,
  };
}

const mockedGetAllocated = getAllocatedFixedCentsForShift as jest.Mock;

beforeEach(() => {
  mockedGetAllocated.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

describe('endShift', () => {
  // gross = 20000 + 1000 = 21000; deductions = 500; pre-allocation net = 20500
  it('deducts a non-zero allocated fixed cost into both net_cents and allocated_fixed_cents', async () => {
    mockedGetAllocated.mockResolvedValue(5500);
    const { updates } = mockShiftsTable({ fetchRow: { user_id: 'user-1' } });

    await endShift('shift-1', basePayload(), '2026-08-05T08:00:00.000Z', []);

    expect(mockedGetAllocated).toHaveBeenCalledWith('user-1', '2026-08-05', 'shift-1');
    expect(updates).toHaveLength(1);
    expect(updates[0].allocated_fixed_cents).toBe(5500);
    expect(updates[0].net_cents).toBe(20500 - 5500);
  });

  it('leaves net_cents unchanged from pre-feature behavior when the allocation is zero (regression safety)', async () => {
    mockedGetAllocated.mockResolvedValue(0);
    const { updates } = mockShiftsTable({ fetchRow: { user_id: 'user-1' } });

    await endShift('shift-1', basePayload(), '2026-08-05T08:00:00.000Z', []);

    expect(updates[0].net_cents).toBe(20500);
    expect(updates[0].allocated_fixed_cents).toBe(0);
  });

  it('fetches started_at from the DB when the caller omits it, deriving the UTC-day for the allocation lookup', async () => {
    mockedGetAllocated.mockResolvedValue(1000);
    mockShiftsTable({ fetchRow: { user_id: 'user-1', started_at: '2026-08-05T23:30:00.000Z' } });

    await endShift('shift-1', basePayload(), undefined, []);

    expect(mockedGetAllocated).toHaveBeenCalledWith('user-1', '2026-08-05', 'shift-1');
  });

  it('degrades gracefully to allocated_fixed_cents=0 (and does not block shift completion) when the allocation lookup throws', async () => {
    mockedGetAllocated.mockRejectedValue(new Error('boom'));
    const { updates } = mockShiftsTable({ fetchRow: { user_id: 'user-1' } });

    await endShift('shift-1', basePayload(), '2026-08-05T08:00:00.000Z', []);

    expect(updates).toHaveLength(1); // shift completion still happened
    expect(updates[0].net_cents).toBe(20500);
    expect(updates[0].allocated_fixed_cents).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('updateShift', () => {
  it('wires the same allocation deduction as endShift', async () => {
    mockedGetAllocated.mockResolvedValue(2000);
    const { updates } = mockShiftsTable({ fetchRow: { user_id: 'user-1' } });

    await updateShift('shift-2', basePayload(), '2026-08-05T08:00:00.000Z', '2026-08-05T18:00:00.000Z');

    expect(mockedGetAllocated).toHaveBeenCalledWith('user-1', '2026-08-05', 'shift-2');
    expect(updates[0].net_cents).toBe(20500 - 2000);
    expect(updates[0].allocated_fixed_cents).toBe(2000);
  });
});

describe('createManualShift', () => {
  it('inserts the shift first (placeholder allocation), then updates it with the real id once it exists in the DB', async () => {
    mockedGetAllocated.mockResolvedValue(800);
    const { updates, getInsertPayload } = mockShiftsTable({ insertId: 'real-id-123' });

    const returnedId = await createManualShift(
      'user-1',
      'vehicle-1',
      '2026-08-05T08:00:00.000Z',
      '2026-08-05T18:00:00.000Z',
      basePayload(),
      true,
    );

    expect(returnedId).toBe('real-id-123');

    // Phase 1: insert happened with a placeholder allocation and the
    // not-yet-corrected net_cents, since the allocation can't be computed
    // until the row (and its real id) exists.
    const insertPayload = getInsertPayload();
    expect(insertPayload?.allocated_fixed_cents).toBe(0);
    expect(insertPayload?.net_cents).toBe(20500);

    // The allocation lookup must use the REAL id returned by the insert,
    // proving it ran only after the row existed in the DB.
    expect(mockedGetAllocated).toHaveBeenCalledWith('user-1', '2026-08-05', 'real-id-123');

    // Phase 2: follow-up update corrects both fields on that same row.
    expect(updates).toHaveLength(1);
    expect(updates[0].net_cents).toBe(20500 - 800);
    expect(updates[0].allocated_fixed_cents).toBe(800);
  });

  it('does not hit the DB for user_id/started_at context, since both are already known to the caller', async () => {
    mockedGetAllocated.mockResolvedValue(0);
    // fetchRow deliberately omitted -- if createManualShift tried the
    // select().eq().single() fetch path, .single() would resolve {data: null}
    // and getAllocatedFixedCentsForShift would be called with userId
    // undefined, which this assertion below would catch.
    mockShiftsTable({ insertId: 'real-id-456' });

    await createManualShift(
      'user-1',
      'vehicle-1',
      '2026-08-05T08:00:00.000Z',
      '2026-08-05T18:00:00.000Z',
      basePayload(),
      true,
    );

    expect(mockedGetAllocated).toHaveBeenCalledWith('user-1', '2026-08-05', 'real-id-456');
  });
});
