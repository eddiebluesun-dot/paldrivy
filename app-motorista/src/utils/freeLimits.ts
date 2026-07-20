export const FREE_MONTHLY_SHIFT_LIMIT = 5;

export function hasReachedShiftLimit(shiftsThisMonth: number): boolean {
  return shiftsThisMonth >= FREE_MONTHLY_SHIFT_LIMIT;
}

export function canViewMonthAsFree(year: number, month: number, now: Date): boolean {
  return year === now.getFullYear() && month === now.getMonth() + 1;
}
