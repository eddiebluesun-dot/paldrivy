import { supabase } from '../lib/supabase';

export type KmGapCategory = 'personal_use' | 'other';

export interface KmGap {
  id: string;
  user_id: string;
  vehicle_id: string;
  start_odometer_meters: number;
  end_odometer_meters: number;
  gap_meters: number;
  start_at: string;
  end_at: string;
  category: KmGapCategory;
  note: string | null;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
}

// A KmGap plus a display-only flag computed for the specific calendar day
// it's being shown on -- see getKmGapsForDay. Not a DB column: a single
// km_gaps row whose window spans midnight is independently fetched (and
// this flag recomputed) by each overlapping day's DayDetailModal, per
// docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md
// Part C ("shown on both days ... a single row, two display appearances").
export interface KmGapForDay extends KmGap {
  spansMultipleDays: boolean;
}

function toLocalDateStr(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Gaps whose [start_at, end_at) window overlaps the given local calendar
// day, across ALL of the user's vehicles -- matches DayDetailModal's
// existing getDayDetail, which is also user-scoped rather than
// vehicle-scoped (see app/(tabs)/index.tsx). dateStr is 'YYYY-MM-DD' in the
// user's local time, same convention as getDayDetail.
export async function getKmGapsForDay(userId: string, dateStr: string): Promise<KmGapForDay[]> {
  const dayStart = new Date(dateStr + 'T00:00:00').toISOString();
  const dayEnd = new Date(dateStr + 'T23:59:59.999').toISOString();

  const { data, error } = await supabase
    .from('km_gaps')
    .select('*')
    .eq('user_id', userId)
    .lt('start_at', dayEnd)
    .gt('end_at', dayStart)
    .order('start_at', { ascending: true });

  if (error) throw error;
  return ((data ?? []) as KmGap[]).map(g => ({
    ...g,
    spansMultipleDays: toLocalDateStr(g.start_at) !== toLocalDateStr(g.end_at),
  }));
}

// Reclassification is metadata-only (see the design spec's "Reclassification
// is metadata-only" section): never touches gap_meters/start_odometer_meters/
// end_odometer_meters, which came from real odometer readings. Always sets
// is_edited = true, which excludes this row from the next automatic
// recompute_km_gaps() rebuild triggered by a shifts/fuel_entries write.
export async function updateKmGap(
  id: string,
  updates: { category: KmGapCategory; note: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('km_gaps')
    .update({
      category: updates.category,
      note: updates.note,
      is_edited: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}
