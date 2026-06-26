import { supabase } from '../lib/supabase';

export interface FuelEntry {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  odometer_meters: number | null;
  volume_ml: number;
  total_cost_cents: number;
  price_per_unit_cents: number;
  full_tank: boolean;
  station: string | null;
  filled_at: string;
}

export async function getFuelEntries(
  userId: string,
  limit = 30
): Promise<FuelEntry[]> {
  const { data, error } = await supabase
    .from('fuel_entries')
    .select('*')
    .eq('user_id', userId)
    .order('filled_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function addFuelEntry(
  entry: Omit<FuelEntry, 'id'>
): Promise<void> {
  const { error } = await supabase.from('fuel_entries').insert(entry);
  if (error) throw error;
}
