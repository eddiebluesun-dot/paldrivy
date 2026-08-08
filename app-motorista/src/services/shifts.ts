import { supabase } from '../lib/supabase';
import type { Shift, EndShiftData, ShiftPause } from '../types';
import { hasReachedShiftLimit } from '../utils/freeLimits';
import { getAllocatedFixedCentsForShift } from './recurringExpenseAllocation';

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

function calcGrossNet(payload: EndShiftData, allocatedFixedCents = 0): { grossCents: number; netCents: number } {
  const platformGross = payload.platforms.reduce((sum, p) => sum + p.amount_cents, 0);
  const grossCents = platformGross + payload.tips_cents + payload.bonuses_cents;
  const deductions = payload.tolls_cents + payload.parking_cents + payload.food_cents;
  return { grossCents, netCents: grossCents - deductions - allocatedFixedCents };
}

// shiftDate must be derived using UTC-day extraction, matching
// getAllocatedFixedCentsForShift's own internal dayStart/dayEnd convention
// (see recurringExpenseAllocation.ts) -- NOT local-calendar-day extraction,
// which would silently misattribute shifts near local midnight.
function toUtcShiftDate(startedAt: string): string {
  return new Date(startedAt).toISOString().slice(0, 10);
}

// Looks up this shift's allocated fixed cost for its day, tolerating any
// failure (missing context row, Task 3's own defensive throw, network error,
// etc.) by falling back to 0 -- today's pre-feature behavior. A rare
// allocation-calculation bug must never block a driver from completing a
// shift, so this never throws.
//
// `knownUserId` lets createManualShift skip the extra context fetch below,
// since it already has userId and startedAt as direct parameters. endShift
// and updateShift don't receive userId at all, so they always need the
// fetch (for user_id, and for started_at too when the caller omitted it).
async function safeGetAllocatedFixedCents(
  shiftId: string,
  startedAt: string | undefined,
  knownUserId?: string,
): Promise<number> {
  try {
    let userId = knownUserId;
    let effectiveStartedAt = startedAt;
    if (!userId || !effectiveStartedAt) {
      const { data, error } = await supabase
        .from('shifts')
        .select('user_id, started_at')
        .eq('id', shiftId)
        .single();
      if (error) throw error;
      userId = userId ?? (data as { user_id: string }).user_id;
      effectiveStartedAt = effectiveStartedAt ?? (data as { started_at: string }).started_at;
    }
    const shiftDate = toUtcShiftDate(effectiveStartedAt);
    return await getAllocatedFixedCentsForShift(userId, shiftDate, shiftId);
  } catch (err) {
    console.error(`[shifts] failed to compute allocated_fixed_cents for shift ${shiftId}; defaulting to 0`, err);
    return 0;
  }
}

export async function endShift(shiftId: string, payload: EndShiftData, startedAt?: string, pauses: ShiftPause[] = []): Promise<void> {
  const allocatedFixedCents = await safeGetAllocatedFixedCents(shiftId, startedAt);
  const { grossCents, netCents } = calcGrossNet(payload, allocatedFixedCents);

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
    allocated_fixed_cents: allocatedFixedCents,
    mood_rating: payload.mood_rating ?? null,
    notes: payload.notes?.trim() || null,
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
  // Two-phase write, mirroring createManualShift: getAllocatedFixedCentsForShift
  // queries `shifts` for rows already persisted within the shiftDate's UTC-day
  // window and throws if shiftId isn't found there. If this edit moves
  // started_at across a day boundary, the allocation lookup must run AFTER
  // the new started_at is durably persisted (phase 1) -- otherwise the DB row
  // is still on the OLD day at lookup time, the lookup throws, and
  // safeGetAllocatedFixedCents silently degrades to 0.
  const { grossCents, netCents: placeholderNetCents } = calcGrossNet(payload);
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
    net_cents: placeholderNetCents,
    allocated_fixed_cents: 0,
    mood_rating: payload.mood_rating ?? null,
    notes: payload.notes?.trim() || null,
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

  // Phase 2: started_at (if changed) is now durably persisted, so the
  // allocation lookup can correctly resolve this shift's day.
  const allocatedFixedCents = await safeGetAllocatedFixedCents(shiftId, startedAt);
  const { netCents: correctedNetCents } = calcGrossNet(payload, allocatedFixedCents);
  const { error: correctionError } = await supabase
    .from('shifts')
    .update({ net_cents: correctedNetCents, allocated_fixed_cents: allocatedFixedCents })
    .eq('id', shiftId);
  if (correctionError) {
    // The shift's primary fields were already persisted above -- don't fail
    // the edit over the correction write; just leave the placeholder
    // allocation in place and log for investigation.
    console.error(`[shifts] failed to persist corrected allocated_fixed_cents for shift ${shiftId}`, correctionError);
  }
}

export async function createManualShift(
  userId: string,
  vehicleId: string | null,
  startedAt: string,
  endedAt: string,
  payload: EndShiftData,
  isPremium: boolean,
): Promise<string> {
  if (!isPremium) {
    const count = await getShiftsCountThisMonth(userId);
    if (hasReachedShiftLimit(count)) throw new FreeLimitError('shifts');
  }
  // Phase 1: calcGrossNet's allocation lookup needs the shift's own id to
  // find its position among same-day shifts (getAllocatedFixedCentsForShift
  // throws if the id isn't already persisted with started_at set) -- but the
  // id is only generated by this insert. Insert first with a 0 placeholder
  // allocation (and the not-yet-corrected net_cents), then correct both
  // fields in a follow-up update once the real id is known (phase 2 below).
  const { grossCents: placeholderGrossCents, netCents: placeholderNetCents } = calcGrossNet(payload);
  const durationSeconds = Math.max(
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
    0,
  );
  const { data, error } = await supabase.from('shifts').insert({
    user_id: userId,
    vehicle_id: vehicleId,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    odometer_start_meters: payload.odometer_start_meters,
    odometer_end_meters: payload.odometer_end_meters,
    platforms: payload.platforms,
    tolls_cents: payload.tolls_cents,
    parking_cents: payload.parking_cents,
    food_cents: payload.food_cents,
    tips_cents: payload.tips_cents,
    bonuses_cents: payload.bonuses_cents,
    rides_count: payload.rides_count,
    gross_cents: placeholderGrossCents,
    net_cents: placeholderNetCents,
    allocated_fixed_cents: 0,
    mood_rating: payload.mood_rating ?? null,
    notes: payload.notes?.trim() || null,
  }).select('id').single();
  if (error) throw error;
  const shiftId = (data as { id: string }).id;

  // Phase 2: the row (with started_at) now exists and is queryable, so the
  // allocation lookup can run. userId/startedAt are already known here, so
  // this skips the extra context-fetch that endShift/updateShift need.
  const allocatedFixedCents = await safeGetAllocatedFixedCents(shiftId, startedAt, userId);
  const { netCents: correctedNetCents } = calcGrossNet(payload, allocatedFixedCents);
  const { error: correctionError } = await supabase
    .from('shifts')
    .update({ net_cents: correctedNetCents, allocated_fixed_cents: allocatedFixedCents })
    .eq('id', shiftId);
  if (correctionError) {
    // The shift row itself was already created successfully above -- don't
    // fail shift creation over the correction write; just leave the
    // placeholder allocation in place and log for investigation.
    console.error(`[shifts] failed to persist corrected allocated_fixed_cents for manual shift ${shiftId}`, correctionError);
  }

  return shiftId;
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
