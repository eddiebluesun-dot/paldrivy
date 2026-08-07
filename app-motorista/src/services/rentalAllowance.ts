import { supabase } from '../lib/supabase';
import { computeRentalAllowanceStatus, type OdometerReading, type RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';
import type { Vehicle } from '../types';

export async function getRentalAllowanceStatus(
  vehicle: Vehicle,
  now: Date = new Date(),
): Promise<RentalAllowanceStatus | null> {
  if (vehicle.ownership_type !== 'rent') return null;
  if (!vehicle.rental_km_allowance_period || vehicle.rental_km_allowance_period === 'unlimited') return null;
  if (!vehicle.rental_contract_start_date) return null;

  const [{ data: shifts }, { data: fuelEntries }] = await Promise.all([
    supabase.from('shifts').select('odometer_start_meters, odometer_end_meters, started_at')
      .eq('vehicle_id', vehicle.id).eq('user_id', vehicle.user_id),
    supabase.from('fuel_entries').select('odometer_meters, filled_at')
      .eq('vehicle_id', vehicle.id).eq('user_id', vehicle.user_id),
  ]);

  const readings: OdometerReading[] = [];
  for (const s of shifts ?? []) {
    if (s.odometer_start_meters != null) readings.push({ odometerMeters: s.odometer_start_meters, at: s.started_at });
    if (s.odometer_end_meters != null) readings.push({ odometerMeters: s.odometer_end_meters, at: s.started_at });
  }
  for (const f of fuelEntries ?? []) {
    if (f.odometer_meters != null) readings.push({ odometerMeters: f.odometer_meters, at: f.filled_at });
  }

  return computeRentalAllowanceStatus({
    contractStartDate: vehicle.rental_contract_start_date,
    contractStartOdometerMeters: vehicle.rental_contract_start_odometer ?? null,
    allowancePeriod: vehicle.rental_km_allowance_period,
    allowanceAmountKm: vehicle.rental_km_allowance_amount ?? null,
    excessRateCents: vehicle.rental_km_excess_rate_cents ?? null,
    readings,
    now,
  });
}
