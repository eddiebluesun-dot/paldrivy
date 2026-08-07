import { getRentalAllowanceStatus } from '@/src/services/rentalAllowance';
import { supabase } from '@/src/lib/supabase';
import type { Vehicle } from '@/src/types';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

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
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({
          data: [
            { odometer_start_meters: 18332000, odometer_end_meters: 18522000, started_at: '2026-08-06T08:00:00Z' },
          ],
        }) }) }) };
      }
      if (table === 'fuel_entries') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({
          data: [
            { odometer_meters: 18622000, filled_at: '2026-08-07T08:30:00Z' },
          ],
        }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getRentalAllowanceStatus(vehicle, new Date('2026-08-07T09:00:00Z'));
    expect(result?.usageKm).toBe(290); // 18622000 - 18332000
  });
});
