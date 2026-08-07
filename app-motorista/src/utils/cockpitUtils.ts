// Pure, side-effect-free helpers for the cockpit feature (no Supabase import).

export function workingDaysInMonth(workingDays: number[], year: number, month: number): number {
  if (workingDays.length === 0) return 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay(); // 0=Sun…6=Sat
    const iso = dow === 0 ? 7 : dow;                   // Mon=1…Sun=7
    if (workingDays.includes(iso)) count++;
  }
  return count;
}

export function getDailyGoalCents(
  goalCents: number,
  workingDays: number[],
  year: number,
  month: number,
): number {
  if (goalCents <= 0 || workingDays.length === 0) return 0;
  const wd = workingDaysInMonth(workingDays, year, month);
  if (wd === 0) return 0;
  return Math.ceil(goalCents / wd);
}

// Working days from `today` (inclusive) through the end of the month.
// Mirrors the app/(tabs)/index.tsx `workingDaysLeft` helper, but pure/testable
// (takes year/month/today instead of reading `new Date()` internally).
export function workingDaysRemainingInMonth(
  workingDays: number[],
  year: number,
  month: number,
  today: number,
): number {
  if (workingDays.length === 0) return 0;
  const lastDay = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = today; d <= lastDay; d++) {
    const dow = new Date(year, month - 1, d).getDay(); // 0=Sun…6=Sat
    const iso = dow === 0 ? 7 : dow;                    // Mon=1…Sun=7
    if (workingDays.includes(iso)) count++;
  }
  return count;
}

// Adaptive daily target: (monthly goal − progress already made this month) ÷
// working days remaining (including today). Recalculates every day so the
// "HOJE" cockpit reflects how much is actually still needed to hit the
// monthly goal — unlike a flat goalCents/totalWorkingDays split, this
// tightens up if the driver falls behind and eases off once they're ahead.
export function getAdaptiveDailyGoalCents(
  goalCents: number,
  workingDays: number[],
  progressCentsThisMonth: number,
  year: number,
  month: number,
  today: number,
): number {
  if (goalCents <= 0 || workingDays.length === 0) return 0;
  const remaining = Math.max(goalCents - progressCentsThisMonth, 0);
  if (remaining === 0) return 0;
  const daysLeft = workingDaysRemainingInMonth(workingDays, year, month, today);
  if (daysLeft === 0) return Math.ceil(remaining); // no working days left but goal unmet: show it all on "today"
  return Math.ceil(remaining / daysLeft);
}

// Single definition of "active day" for the current month, used by every
// place that shows a "days active this month" figure (the streak badge near
// the vehicle picker and, previously, a second badge on the HOJE card). A
// day counts as active if it has at least one completed shift OR at least
// one logged expense; duplicate shifts/expenses on the same day still count
// once. Callers pass already-extracted 'YYYY-MM-DD' date strings so this
// stays pure and independent of Supabase/timezone concerns.
export function countActiveDays(shiftDates: string[], expenseDates: string[]): number {
  return new Set([...shiftDates, ...expenseDates]).size;
}

export function streakFromDates(activeDates: string[], todayStr: string): number {
  const dateSet = new Set(activeDates);
  if (!dateSet.has(todayStr)) return 0;
  let streak = 0;
  const cursor = new Date(todayStr + 'T12:00:00');
  while (streak <= 60) {
    const key = cursor.toISOString().slice(0, 10);
    if (!dateSet.has(key)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Returns 0 (none) | 1 (low <R$100) | 2 (mid R$100–R$300) | 3 (high >R$300)
export function intensityForCents(cents: number): 0 | 1 | 2 | 3 {
  if (cents <= 0) return 0;
  if (cents < 10000) return 1;
  if (cents < 30000) return 2;
  return 3;
}
