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
  // Every shift-completion path (endShift/updateShift/createManualShift) now
  // also fires a day-wide re-split so sibling same-day shifts don't keep a
  // stale allocation once a new shift joins their day (see
  // recurringExpenseAllocation.ts). That's covered by its own dedicated unit
  // tests -- here it's mocked out entirely so these tests stay focused on
  // shifts.ts's own wiring, same rationale as getAllocatedFixedCentsForShift
  // above.
  syncAllocatedFixedCentsForDay: jest.fn(),
}));

// Minimal fake 'shifts' table double supporting the four chain shapes these
// functions use:
//   .select('user_id, started_at').eq('id', x).single()      (fetch context)
//   .select('user_id' | 'started_at').eq('id', x).maybeSingle() (sync lookup)
//   .update({...}).eq('id', x)                                (persist)
//   .insert({...}).select('id').single()                      (create, then read back id)
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
        // Used only by the post-write syncAllocatedFixedCentsForDay lookup
        // (fetching user_id/started_at so it knows which day to re-split) --
        // never throws on a missing row, unlike .single() above.
        maybeSingle: () => Promise.resolve({ data: opts.fetchRow ?? null, error: null }),
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
  it('wires the same allocation deduction as endShift, via a two-phase write (persist fields first, then correct the allocation)', async () => {
    mockedGetAllocated.mockResolvedValue(2000);
    const { updates } = mockShiftsTable({ fetchRow: { user_id: 'user-1' } });

    await updateShift('shift-2', basePayload(), '2026-08-05T08:00:00.000Z', '2026-08-05T18:00:00.000Z');

    expect(mockedGetAllocated).toHaveBeenCalledWith('user-1', '2026-08-05', 'shift-2');
    expect(updates).toHaveLength(2);
    // Phase 1: placeholder allocation, but started_at/etc. already persisted.
    expect(updates[0].allocated_fixed_cents).toBe(0);
    expect(updates[0].net_cents).toBe(20500);
    // Phase 2: follow-up update corrects both fields.
    expect(updates[1].net_cents).toBe(20500 - 2000);
    expect(updates[1].allocated_fixed_cents).toBe(2000);
  });

  // Regression test for the bug flagged in review: safeGetAllocatedFixedCents
  // (and thus getAllocatedFixedCentsForShift) used to run BEFORE updateShift's
  // own .update() persisted the new started_at. getAllocatedFixedCentsForShift
  // queries the shifts table for rows already persisted within the NEW
  // shiftDate's UTC-day window and throws if shiftId isn't found there -- so
  // editing a shift's start time across a day boundary (e.g. correcting
  // 23:58 to 00:02 the next day) meant the DB row was still on the OLD day
  // at lookup time, the lookup threw, and safeGetAllocatedFixedCents silently
  // degraded to allocated_fixed_cents=0. The fix: persist started_at FIRST
  // (phase 1), then look up the allocation (phase 2), mirroring
  // createManualShift's two-phase write.
  it('persists the new started_at BEFORE looking up the allocation, so a shift edited across a UTC day boundary resolves under its NEW day', async () => {
    const { updates } = mockShiftsTable({ fetchRow: { user_id: 'user-1' } });
    mockedGetAllocated.mockImplementation(async (_userId: string, shiftDate: string, _shiftId: string) => {
      // Prove ordering: by the time the allocation lookup runs, phase 1's
      // update (persisting the new started_at) must already have happened --
      // otherwise this is exactly the stale-day race being regression-tested.
      expect(updates).toHaveLength(1);
      expect(shiftDate).toBe('2026-08-05'); // the NEW day, not the old '2026-08-04'
      return 4200;
    });

    // Shift originally started 2026-08-04T23:58:00Z, edited to
    // 2026-08-05T00:02:00Z -- crossing a UTC day boundary.
    await updateShift('shift-3', basePayload(), '2026-08-05T00:02:00.000Z', '2026-08-05T10:00:00.000Z');

    expect(mockedGetAllocated).toHaveBeenCalledWith('user-1', '2026-08-05', 'shift-3');
    expect(updates).toHaveLength(2);
    expect(updates[0].started_at).toBe('2026-08-05T00:02:00.000Z');
    expect(updates[0].allocated_fixed_cents).toBe(0);
    expect(updates[1].net_cents).toBe(20500 - 4200);
    expect(updates[1].allocated_fixed_cents).toBe(4200);
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
