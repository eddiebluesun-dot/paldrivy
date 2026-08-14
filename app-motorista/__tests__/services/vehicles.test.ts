import { getVehicleRecurringCost, syncVehicleRecurringCost, endVehicleRecurringCost } from '@/src/services/vehicles';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

function makeQueryBuilder(rows: Record<string, unknown>[]) {
  let filtered = rows;
  const builder: any = {
    select: () => builder,
    eq: (field: string, value: unknown) => { filtered = filtered.filter(r => r[field] === value); return builder; },
    limit: (n: number) => { filtered = filtered.slice(0, n); return builder; },
    maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
  };
  return builder;
}

describe('getVehicleRecurringCost', () => {
  it('returns null when the vehicle has no linked recurring expense', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => makeQueryBuilder([]));
    const result = await getVehicleRecurringCost('veh-1');
    expect(result).toBeNull();
  });

  it('returns the linked expense mapped to camelCase fields', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      expect(table).toBe('expenses');
      return makeQueryBuilder([
        { id: 'exp-1', vehicle_id: 'veh-1', recurring: true, amount_cents: 80431, recurring_frequency: 'weekly', ends_at: null },
      ]);
    });
    const result = await getVehicleRecurringCost('veh-1');
    expect(result).toEqual({ id: 'exp-1', amountCents: 80431, frequency: 'weekly', endsAt: null });
  });
});

describe('syncVehicleRecurringCost', () => {
  it('does nothing for an owned vehicle', async () => {
    const fromMock = jest.fn();
    (supabase.from as jest.Mock).mockImplementation(fromMock);
    await syncVehicleRecurringCost({ vehicleId: 'veh-1', userId: 'user-1', ownershipType: 'own', amountCents: 50000, frequency: 'monthly' });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('inserts a new linked expense when none exists yet', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      expect(table).toBe('expenses');
      return {
        select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }),
        insert: insertMock,
      };
    });
    await syncVehicleRecurringCost({ vehicleId: 'veh-1', userId: 'user-1', ownershipType: 'rent', amountCents: 80431, frequency: 'weekly' });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1', vehicle_id: 'veh-1', category: 'rent',
      amount_cents: 80431, recurring: true, recurring_frequency: 'weekly',
    }));
  });

  it('updates the existing linked expense instead of inserting a duplicate', async () => {
    const updateEqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: updateEqMock }));
    const insertMock = jest.fn();
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      expect(table).toBe('expenses');
      return {
        select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'exp-1' }, error: null }) }) }) }) }),
        update: updateMock,
        insert: insertMock,
      };
    });
    await syncVehicleRecurringCost({ vehicleId: 'veh-1', userId: 'user-1', ownershipType: 'financed', amountCents: 120000, frequency: 'monthly' });
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      amount_cents: 120000, recurring_frequency: 'monthly', category: 'financing',
    }));
    expect(updateEqMock).toHaveBeenCalledWith('id', 'exp-1');
  });
});

describe('endVehicleRecurringCost', () => {
  it('does nothing when the vehicle has no linked recurring expense', async () => {
    const updateMock = jest.fn();
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }),
      update: updateMock,
    }));
    await endVehicleRecurringCost('veh-1');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('sets ends_at to today on the linked expense', async () => {
    const updateEqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: updateEqMock }));
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'exp-1' }, error: null }) }) }) }) }),
      update: updateMock,
    }));
    await endVehicleRecurringCost('veh-1');
    const todayIso = new Date().toISOString().slice(0, 10);
    expect(updateMock).toHaveBeenCalledWith({ ends_at: todayIso });
    expect(updateEqMock).toHaveBeenCalledWith('id', 'exp-1');
  });
});
