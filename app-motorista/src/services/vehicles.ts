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
