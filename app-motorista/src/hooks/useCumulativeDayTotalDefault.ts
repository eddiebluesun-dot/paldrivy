import { useMemo } from 'react';
import { getPriorSameDayPlatforms, type ShiftForReconciliation, type ShiftPlatformEntry } from '../utils/shiftReconciliationUtils';

export interface CumulativeDayTotalDefault {
  priorSameDayPlatforms: ShiftPlatformEntry[];
  hasPriorSameDayShift: boolean;
  // Whether the "this amount is already the day's total" toggle should
  // start checked. Per the owner's decision, this is automatic: checked
  // whenever a completed shift already exists earlier the same attributed
  // day, unchecked for the first shift of the day. The driver can still
  // flip it manually — this only decides the starting position.
  defaultChecked: boolean;
}

// Computes whether a shift form's "cumulative day total" toggle should
// default to checked, given the other shifts loaded on screen and the
// shift currently being created/edited (identified by targetStartedAtIso +
// excludeShiftId). Extracted out of ShiftFormModal so the default-state
// decision is unit-testable via renderHook without mounting the full form
// (which pulls in supabase, i18n, and native components).
export function useCumulativeDayTotalDefault(
  otherShifts: ShiftForReconciliation[] | undefined,
  targetStartedAtIso: string | undefined,
  excludeShiftId: string,
): CumulativeDayTotalDefault {
  const priorSameDayPlatforms = useMemo(() => {
    if (!targetStartedAtIso || !otherShifts?.length) return [];
    return getPriorSameDayPlatforms(otherShifts, targetStartedAtIso, excludeShiftId);
  }, [otherShifts, targetStartedAtIso, excludeShiftId]);

  const hasPriorSameDayShift = priorSameDayPlatforms.length > 0;

  return { priorSameDayPlatforms, hasPriorSameDayShift, defaultChecked: hasPriorSameDayShift };
}
