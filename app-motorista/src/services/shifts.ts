import { supabase } from '../lib/supabase';
import type { Shift, EndShiftData } from '../types';

export async function getActiveShift(userId: string): Promise<Shift | null> {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('user_id', userId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function startShift(
  userId: string,
  vehicleId: string | null
): Promise<Shift> {
  const { data, error } = await supabase
    .from('shifts')
    .insert({
      user_id: userId,
      vehicle_id: vehicleId,
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function endShift(
  shiftId: string,
  payload: EndShiftData
): Promise<void> {
  const { error } = await supabase
    .from('shifts')
    .update({
      ended_at: new Date().toISOString(),
      odometer_end_meters: payload.odometer_end_meters,
      platforms: payload.platforms,
      tolls_cents: payload.tolls_cents,
      parking_cents: payload.parking_cents,
      food_cents: payload.food_cents,
      tips_cents: payload.tips_cents,
      bonuses_cents: payload.bonuses_cents,
    })
    .eq('id', shiftId);

  if (error) throw error;
}

export async function getRecentShifts(
  userId: string,
  days = 7
): Promise<Shift[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('user_id', userId)
    .gte('started_at', since.toISOString())
    .order('started_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}
