import { supabase } from '../lib/supabase';
import type { Vehicle } from '../types';

export async function getVehicles(userId: string): Promise<Vehicle[]> {
  const { data } = await supabase.from('vehicles').select('*').eq('user_id', userId).order('created_at');
  return data ?? [];
}

// Resolves which vehicle a new shift/fuel entry should be tagged with:
// the profile's explicitly selected vehicle if set, otherwise the same
// "most recently created vehicle" fallback the dashboard already uses to
// decide which vehicle to display. Without this, a user who never
// explicitly picked a vehicle (profile.vehicle_id stays null -- the common
// case for anyone with just one vehicle) logs every shift with
// vehicle_id: null, silently breaking anything scoped per-vehicle (rental
// km allowance tracking, fuel consumption trend) even though the dashboard
// itself shows a specific vehicle as "active".
export async function getEffectiveVehicleId(userId: string, explicitVehicleId: string | null): Promise<string | null> {
  if (explicitVehicleId) return explicitVehicleId;
  const { data } = await supabase
    .from('vehicles')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function createVehicle(vehicle: Omit<Vehicle, 'id' | 'created_at'>): Promise<Vehicle> {
  const { data, error } = await supabase.from('vehicles').insert(vehicle).select().single();
  if (error) throw error;
  return data;
}

export async function updateVehicle(id: string, data: Partial<Omit<Vehicle, 'id' | 'created_at' | 'user_id'>>): Promise<void> {
  const { error } = await supabase.from('vehicles').update(data).eq('id', id);
  if (error) throw error;
}

type VehicleRecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export interface VehicleRecurringCost {
  id: string;
  amountCents: number;
  frequency: VehicleRecurringFrequency;
  endsAt: string | null;
}

// "The vehicle's own recurring cost" is, by convention, the one recurring=true
// expense row with this vehicle_id -- see the 2026-08-14 design doc. There is
// at most one such row per vehicle by construction (syncVehicleRecurringCost
// always finds-or-updates, never inserts a second one).
export async function getVehicleRecurringCost(vehicleId: string): Promise<VehicleRecurringCost | null> {
  const { data } = await supabase
    .from('expenses')
    .select('id, amount_cents, recurring_frequency, ends_at')
    .eq('vehicle_id', vehicleId)
    .eq('recurring', true)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    amountCents: data.amount_cents as number,
    frequency: data.recurring_frequency as VehicleRecurringFrequency,
    endsAt: (data.ends_at as string | null) ?? null,
  };
}

// Makes the vehicle's own registered cost the source of truth for the daily
// rateio engine: finds this vehicle's existing linked recurring expense and
// updates it, or creates one if none exists yet. Never creates a second row
// for the same vehicle. No-op for ownership_type 'own' -- an owned vehicle
// has no rent/financing cost to rate.
export async function syncVehicleRecurringCost(params: {
  vehicleId: string;
  userId: string;
  ownershipType: 'own' | 'rent' | 'financed';
  amountCents: number;
  frequency: 'daily' | 'weekly' | 'monthly';
}): Promise<void> {
  const { vehicleId, userId, ownershipType, amountCents, frequency } = params;
  if (ownershipType === 'own') return;
  const category = ownershipType === 'rent' ? 'rent' : 'financing';

  const { data: existing } = await supabase
    .from('expenses')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .eq('recurring', true)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('expenses')
      .update({ amount_cents: amountCents, recurring_frequency: frequency, category })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('expenses').insert({
      user_id: userId,
      vehicle_id: vehicleId,
      category,
      amount_cents: amountCents,
      recurring: true,
      recurring_frequency: frequency,
      expense_date: new Date().toISOString().slice(0, 10),
    });
    if (error) throw error;
  }
}

// Sets today as the linked recurring expense's end date (permanent -- no
// resume). No-op if the vehicle has no linked recurring expense.
export async function endVehicleRecurringCost(vehicleId: string): Promise<void> {
  const { data: existing } = await supabase
    .from('expenses')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .eq('recurring', true)
    .limit(1)
    .maybeSingle();
  if (!existing) return;

  const { error } = await supabase.from('expenses')
    .update({ ends_at: new Date().toISOString().slice(0, 10) })
    .eq('id', existing.id);
  if (error) throw error;
}
