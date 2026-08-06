// Pure, side-effect-free helpers for reconciling shift ("turno") earnings
// against other shifts on the same calendar day (no Supabase import).
//
// The bug this fixes: rideshare apps (Uber/99/etc.) report CUMULATIVE
// earnings for the whole day, not per-session. A driver who works two shifts
// in one day and checks the platform app at the end of shift 2 sees the
// day's running total (e.g. R$492,23), not shift 2's isolated earnings. If
// that figure is entered as-is, naive per-shift summation double-counts
// shift 1: R$200 (shift 1) + R$492,23 (actually the day total, entered as if
// it were shift 2 alone) = R$692,23 recorded instead of the true R$492,23.
//
// Fix: when the driver confirms the entered amount is a day-cumulative
// figure, subtract what was already logged earlier that day for the SAME
// platform (Uber's running total and 99's running total don't share a
// balance, so reconciliation is per platform_name, not a single day-wide
// number).

export interface ShiftPlatformEntry {
  platform_name: string;
  amount_cents: number;
}

export interface ShiftForReconciliation {
  id: string;
  started_at: string;
  ended_at?: string | null;
  platforms?: ShiftPlatformEntry[] | null;
}

// Local calendar day a shift is attributed to, for grouping purposes.
//
// Matches the existing convention already used everywhere else in the app
// (dashboard.ts's getMonthReport/getWeekBuckets/getMonthlyBuckets/
// getYearlyReport all bucket by `started_at`, never `ended_at`): an
// overnight shift that starts 22:00 on day N and ends 03:00 on day N+1 is
// grouped under day N, the day it started earning against. This function
// doesn't invent a new convention — it reuses the one the rest of the
// codebase already relies on.
export function shiftDayKey(startedAtIso: string): string {
  const d = new Date(startedAtIso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Flattens the platform earnings of every COMPLETED shift attributed to the
// same day as `targetStartedAtIso`, excluding the shift being created/edited
// itself (`excludeShiftId`). Order is preserved (oldest-entered platforms
// first), and a platform appearing in multiple prior shifts appears multiple
// times in the output — callers that need a single running total per
// platform (like reconcileShiftPlatforms) sum across duplicates themselves.
export function getPriorSameDayPlatforms(
  shifts: ShiftForReconciliation[],
  targetStartedAtIso: string,
  excludeShiftId?: string,
): ShiftPlatformEntry[] {
  const targetDay = shiftDayKey(targetStartedAtIso);
  const result: ShiftPlatformEntry[] = [];
  for (const shift of shifts) {
    if (excludeShiftId && shift.id === excludeShiftId) continue;
    if (!shift.ended_at || !shift.platforms || shift.platforms.length === 0) continue;
    if (shiftDayKey(shift.started_at) !== targetDay) continue;
    result.push(...shift.platforms);
  }
  return result;
}

// Reconciles a shift's entered platform earnings against earlier shifts the
// same attributed day.
//
// Only runs the subtraction when the caller confirms (`isCumulativeDayTotal`)
// that the entered amounts represent the platform's day-running total rather
// than genuinely isolated per-shift earnings — this is a driver-facing
// choice (see the "isCumulativeDayTotal" toggle in shifts.tsx), not an
// automatic assumption. Left unchecked (the default), entered amounts pass
// through unchanged, which is the historical (pre-fix) behavior — so a
// driver who already knows their true per-shift split isn't silently
// corrupted by an aggressive auto-subtract.
//
// Reconciliation is per platform_name: a platform with no matching prior
// entry that day (e.g. a driver who only just started using it) passes
// through untouched. Reconciled amounts are floored at 0 — a same-named
// platform total that comes in lower than what's already logged means bad
// input, not negative earnings.
export function reconcileShiftPlatforms(
  enteredPlatforms: ShiftPlatformEntry[],
  priorPlatformsSameDay: ShiftPlatformEntry[],
  isCumulativeDayTotal: boolean,
): ShiftPlatformEntry[] {
  if (!isCumulativeDayTotal || priorPlatformsSameDay.length === 0) {
    return enteredPlatforms;
  }

  const priorTotals = new Map<string, number>();
  for (const p of priorPlatformsSameDay) {
    priorTotals.set(p.platform_name, (priorTotals.get(p.platform_name) ?? 0) + p.amount_cents);
  }

  return enteredPlatforms.map((p) => {
    const prior = priorTotals.get(p.platform_name) ?? 0;
    return { ...p, amount_cents: Math.max(p.amount_cents - prior, 0) };
  });
}
