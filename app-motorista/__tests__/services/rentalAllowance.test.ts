import { getRentalAllowanceStatus } from '@/src/services/rentalAllowance';
import { supabase } from '@/src/lib/supabase';
import type { Vehicle } from '@/src/types';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

// Minimal fake Supabase query builder: filters an in-memory row array as
// .eq()/.lte() calls come in, and resolves like the real client when awaited.
// This lets tests assert on the *result* of filtering (e.g. a future-dated
// row genuinely excluded) rather than just on which methods were called.
function makeQueryBuilder(rows: Record<string, unknown>[]) {
  let filtered = rows;
  const builder: any = {
    select: () => builder,
    eq: (field: string, value: unknown) => {
      filtered = filtered.filter(r => r[field] === value);
      return builder;
    },
    lte: (field: string, value: unknown) => {
      filtered = filtered.filter(r => (r[field] as string) <= (value as string));
      return builder;
    },
    then: (resolve: (v: { data: Record<string, unknown>[] }) => unknown) =>
      resolve({ data: filtered }),
  };
  return builder;
}

function mockVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v1', user_id: 'u1', name: 'Kwid', brand: 'Renault', model: 'Kwid', year: 2026,
    fuel_type: 'ethanol', avg_consumption_per_100: 1100, ownership_type: 'rent',
    monthly_cost_cents: 0, monthly_insurance_cents: 0, current_odometer: 18622000,
    is_taxi: false, taxi_license_monthly_cents: 0, created_at: '2026-08-05T00:00:00Z',
    rental_contract_start_date: '2026-08-05',
    rental_contract_start_odometer: 18332000,
    rental_km_allowance_period: 'weekly',
    rental_km_allowance_amount: 500,
    rental_km_excess_rate_cents: 150,
    ...overrides,
  };
}

describe('getRentalAllowanceStatus', () => {
  it('returns null immediately for a non-rental vehicle, without querying', async () => {
    const vehicle = mockVehicle({ ownership_type: 'own' });
    const result = await getRentalAllowanceStatus(vehicle);
    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns null for unlimited allowance, without querying', async () => {
    const vehicle = mockVehicle({ rental_km_allowance_period: 'unlimited' });
    const result = await getRentalAllowanceStatus(vehicle);
    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('combines shift and fuel-entry odometer readings for the vehicle', async () => {
    const vehicle = mockVehicle();
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'shifts') {
        return { select: () => ({ eq: () => ({ eq: () => ({ lte: () => Promise.resolve({
          data: [
            { odometer_start_meters: 18332000, odometer_end_meters: 18522000, started_at: '2026-08-06T08:00:00Z' },
          ],
        }) }) }) }) };
      }
      if (table === 'fuel_entries') {
        return { select: () => ({ eq: () => ({ eq: () => ({ lte: () => Promise.resolve({
          data: [
            { odometer_meters: 18622000, filled_at: '2026-08-07T08:30:00Z' },
          ],
        }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getRentalAllowanceStatus(vehicle, new Date('2026-08-07T09:00:00Z'));
    expect(result?.cumulativeUsageKm).toBe(290); // 18622000 - 18332000
  });

  it('bounds both queries to now, so a future-dated (e.g. mistyped-year) reading is excluded', async () => {
    const vehicle = mockVehicle();
    const now = new Date('2026-08-07T09:00:00Z');

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'shifts') {
        return makeQueryBuilder([
          {
            vehicle_id: 'v1', user_id: 'u1',
            odometer_start_meters: 18332000, odometer_end_meters: 18522000,
            started_at: '2026-08-06T08:00:00Z',
          },
        ]);
      }
      if (table === 'fuel_entries') {
        return makeQueryBuilder([
          { vehicle_id: 'v1', user_id: 'u1', odometer_meters: 18622000, filled_at: '2026-08-07T08:30:00Z' },
          // Mistyped year: a driver fat-fingers the date when logging a fill-up.
          // Without a query-level bound this would be the globally-latest reading
          // and would silently pin currentOdometerMeters to it.
          { vehicle_id: 'v1', user_id: 'u1', odometer_meters: 99999000, filled_at: '2027-01-01T00:00:00Z' },
        ]);
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getRentalAllowanceStatus(vehicle, now);

    expect(result?.currentOdometerMeters).toBe(18622000);
    expect(result?.cumulativeUsageKm).toBe(290); // unaffected by the 99999000 future-dated row
  });

  // Regression test for a real production bug (2026-08-15, user Eddie): the
  // "FRANQUIA DE KM" card showed 1358/1500 km used, NOT reflecting a shift
  // finished earlier that same day that drove the true odometer up to 20739.
  // Root cause: the shift's END odometer reading was tagged with the shift's
  // STARTED_at timestamp (not its own ended_at), so on a day with another
  // same-day reading logged later (e.g. a fuel entry filled_at later that
  // day), sorting readings by `at` and taking the last one picked the fuel
  // entry's lower odometer over the shift's true, higher, end-of-day reading.
  it('uses a shift end odometer as the latest reading when its ended_at is later than a same-day fuel entry, even though the shift STARTED earlier that day', async () => {
    const vehicle = mockVehicle();
    const now = new Date('2026-08-15T16:00:00Z');

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'shifts') {
        return makeQueryBuilder([
          {
            vehicle_id: 'v1', user_id: 'u1',
            odometer_start_meters: 20584000, odometer_end_meters: 20739000,
            started_at: '2026-08-15T08:57:00Z', ended_at: '2026-08-15T15:46:00Z',
          },
        ]);
      }
      if (table === 'fuel_entries') {
        return makeQueryBuilder([
          // Logged mid-shift but with a filled_at timestamp later in the day
          // than the shift's started_at -- the exact production shape that
          // let this fuel entry's lower odometer win as "most recent".
          { vehicle_id: 'v1', user_id: 'u1', odometer_meters: 20586000, filled_at: '2026-08-15T15:00:00Z' },
        ]);
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getRentalAllowanceStatus(vehicle, now);

    // Must reflect the finished shift's true end odometer (20739000), not
    // the fuel entry's lower reading (20586000).
    expect(result?.currentOdometerMeters).toBe(20739000);
  });
});
