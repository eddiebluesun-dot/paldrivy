import { supabase } from '../lib/supabase';
import type { Vehicle } from '../types';

export async function getVehicles(userId: string): Promise<Vehicle[]> {
  const { data } = await supabase.from('vehicles').select('*').eq('user_id', userId).order('created_at');
  return data ?? [];
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
