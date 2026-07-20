import { supabase } from '../lib/supabase';
import type { Shift, EndShiftData, ShiftPause } from '../types';
import { hasReachedShiftLimit } from '../utils/freeLimits';

function totalPausedSeconds(pauses: ShiftPause[]): number {
  return pauses.reduce((sum, p) => {
    const end = p.ended_at ? new Date(p.ended_at) : new Date();
    return sum + Math.round((end.getTime() - new Date(p.started_at).getTime()) / 1000);
  }, 0);
}

export async function pauseShift(shiftId: string, currentPauses: ShiftPause[]): Promise<void> {
  const updated = [...currentPauses, { started_at: new Date().toISOString(), ended_at: null }];
  const { error } = await supabase.from('shifts').update({ pauses: updated }).eq('id', shiftId);
  if (error) throw error;
}

export async function resumeShift(shiftId: string, currentPauses: ShiftPause[]): Promise<void> {
  const endedAt = new Date().toISOString();
  const updated = currentPauses.map((p, i) =>
    i === currentPauses.length - 1 && !p.ended_at ? { ...p, ended_at: endedAt } : p
  );
  const { error } = await supabase.from('shifts').update({ pauses: updated }).eq('id', shiftId);
  if (error) throw error;
}

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

export class FreeLimitError extends Error {
  constructor(public readonly limit: 'shifts') {
    super(`free plan limit reached: ${limit}`);
  }
}

export async function getShiftsCountThisMonth(userId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('shifts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('started_at', monthStart.toISOString());
  if (error) throw error;
  return count ?? 0;
}

export async function startShift(
  userId: string,
  vehicleId: string | null,
  odometerStartMeters: number | null,
  isPremium: boolean,
): Promise<Shift> {
  if (!isPremium) {
    const count = await getShiftsCountThisMonth(userId);
    if (hasReachedShiftLimit(count)) throw new FreeLimitError('shifts');
  }

  const { data, error } = await supabase
    .from('shifts')
    .insert({
      user_id: userId,
      vehicle_id: vehicleId,
      started_at: new Date().toISOString(),
      odometer_start_meters: odometerStartMeters,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function calcGrossNet(payload: EndShiftData): { grossCents: number; netCents: number } {
  const platformGross = payload.platforms.reduce((sum, p) => sum + p.amount_cents, 0);
  const grossCents = platformGross + payload.tips_cents + payload.bonuses_cents;
  const deductions = payload.tolls_cents + payload.parking_cents + payload.food_cents;
  return { grossCents, netCents: grossCents - deductions };
}

export async function endShift(shiftId: string, payload: EndShiftData, startedAt?: string, pauses: ShiftPause[] = []): Promise<void> {
  const { grossCents, netCents } = calcGrossNet(payload);

  // If the shift is currently paused, use that pause's start as the effective end time
  const openPause = pauses.find(p => !p.ended_at);
  const endedAt = openPause ? new Date(openPause.started_at) : new Date();

  // Close the open pause entry so the pauses array is consistent
  const closedPauses = openPause
    ? pauses.map(p => !p.ended_at ? { ...p, ended_at: openPause.started_at } : p)
    : pauses;

  const rawSeconds = startedAt ? Math.round((endedAt.getTime() - new Date(startedAt).getTime()) / 1000) : null;
  const pausedSeconds = totalPausedSeconds(closedPauses);
  const durationSeconds = rawSeconds !== null ? Math.max(rawSeconds - pausedSeconds, 0) : null;
  const updateData: Record<string, unknown> = {
    ended_at: endedAt.toISOString(),
    pauses: closedPauses,
    odometer_end_meters: payload.odometer_end_meters,
    platforms: payload.platforms,
    tolls_cents: payload.tolls_cents,
    parking_cents: payload.parking_cents,
    food_cents: payload.food_cents,
    tips_cents: payload.tips_cents,
    bonuses_cents: payload.bonuses_cents,
    rides_count: payload.rides_count,
    gross_cents: grossCents,
    net_cents: netCents,
  };
  if (durationSeconds !== null) updateData.duration_seconds = durationSeconds;
  const { error } = await supabase.from('shifts').update(updateData).eq('id', shiftId);
  if (error) throw error;
}

export async function updateShift(
  shiftId: string,
  payload: EndShiftData,
  startedAt?: string,
  endedAt?: string,
): Promise<void> {
  const { grossCents, netCents } = calcGrossNet(payload);
  const updateData: Record<string, unknown> = {
    odometer_end_meters: payload.odometer_end_meters,
    platforms: payload.platforms,
    tolls_cents: payload.tolls_cents,
    parking_cents: payload.parking_cents,
    food_cents: payload.food_cents,
    tips_cents: payload.tips_cents,
    bonuses_cents: payload.bonuses_cents,
    rides_count: payload.rides_count,
    gross_cents: grossCents,
    net_cents: netCents,
  };
  if (startedAt) updateData.started_at = startedAt;
  if (endedAt)   updateData.ended_at   = endedAt;
  if (startedAt && endedAt) {
    updateData.duration_seconds = Math.max(
      Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
      0,
    );
  }
  const { error } = await supabase.from('shifts').update(updateData).eq('id', shiftId);
  if (error) throw error;
}

export async function deleteShift(shiftId: string): Promise<void> {
  const { error } = await supabase.from('shifts').delete().eq('id', shiftId);
  if (error) throw error;
}

export async function getRecentShifts(userId: string, days = 7): Promise<Shift[]> {
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
