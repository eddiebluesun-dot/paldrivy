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
