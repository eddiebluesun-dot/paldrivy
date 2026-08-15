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
    supabase.from('shifts').select('odometer_start_meters, odometer_end_meters, started_at, ended_at')
      .eq('vehicle_id', vehicle.id).eq('user_id', vehicle.user_id)
      .lte('started_at', now.toISOString()),
    supabase.from('fuel_entries').select('odometer_meters, filled_at')
      .eq('vehicle_id', vehicle.id).eq('user_id', vehicle.user_id)
      .lte('filled_at', now.toISOString()),
  ]);

  const readings: OdometerReading[] = [];
  for (const s of shifts ?? []) {
    if (s.odometer_start_meters != null) readings.push({ odometerMeters: s.odometer_start_meters, at: s.started_at });
    // Tagged with the shift's OWN end timestamp, not started_at: computeRentalAllowanceStatus
    // picks "current odometer" as the chronologically-latest reading, so a finished shift's end
    // odometer must sort after anything logged later that same day (e.g. a fuel entry filled in
    // the afternoon after a morning shift). Tagging it with started_at instead let a same-day
    // reading with a later timestamp but a LOWER odometer outrank it -- see the regression test
    // "uses a shift end odometer as the latest reading..." for the exact production case (2026-08-15,
    // user Eddie: a finished 155km shift wasn't reflected in the weekly km-allowance card because
    // its end reading was time-stamped as if it happened at shift start, hours before it actually did).
    if (s.odometer_end_meters != null) readings.push({ odometerMeters: s.odometer_end_meters, at: s.ended_at ?? s.started_at });
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
