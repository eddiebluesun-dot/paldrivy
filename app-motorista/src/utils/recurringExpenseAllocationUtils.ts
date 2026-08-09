// Pure, side-effect-free helpers for recurring-expense daily allocation
// (no Supabase import). See
// docs/superpowers/specs/2026-08-07-recurring-expense-daily-allocation-design.md.

import { getPeriodBounds } from './rentalKmAllowanceUtils';

export interface RecurringExpenseInput {
  amountCents: number;
  expenseDate: string; // YYYY-MM-DD, anchors this expense's period cycle
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';
}

// Counts how many days in [periodStart, periodEnd) match one of the ISO
// weekday numbers in workingDays (1=Mon...7=Sun, same convention as
// cockpitUtils.ts's workingDaysInMonth). Generic over an arbitrary UTC date
// range -- cockpitUtils.ts's workingDaysInMonth/workingDaysRemainingInMonth
// are calendar-month-bound and use local Date, not suitable for a
// weekly/29th-31st-anchored-monthly period that doesn't align to calendar
// month boundaries.
function countWorkingDaysInRange(periodStart: Date, periodEnd: Date, workingDays: number[]): number {
  if (workingDays.length === 0) return 0;
  let count = 0;
  const cursor = new Date(periodStart);
  while (cursor < periodEnd) {
    const dow = cursor.getUTCDay(); // 0=Sun...6=Sat
    const iso = dow === 0 ? 7 : dow; // Mon=1...Sun=7
    if (workingDays.includes(iso)) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function computeDailyAllocationCents(
  expenses: RecurringExpenseInput[],
  workingDays: number[],
  targetDate: Date,
): number {
  // targetDate must itself be a configured working day -- membership in the
  // expense's PERIOD alone isn't enough. Without this check, a day off within
  // an active period (e.g. Sunday, for a Mon-Sat driver) still got charged
  // the same daily share as a worked day, inflating the period's total well
  // past the actual expense amount (e.g. 6 working-day shares correctly sum
  // to the R$804.31 rent, but applying that share to all 7 days of the week
  // sums to R$938.35 instead).
  const targetDow = targetDate.getUTCDay();
  const targetIso = targetDow === 0 ? 7 : targetDow;
  if (!workingDays.includes(targetIso)) return 0;

  let total = 0;
  for (const expense of expenses) {
    if (expense.frequency !== 'weekly' && expense.frequency !== 'monthly') continue;

    const bounds = getPeriodBounds(expense.expenseDate, expense.frequency, targetDate);
    if (!bounds) continue;
    const { periodStart, periodEnd } = bounds;
    if (targetDate < periodStart || targetDate >= periodEnd) continue;

    const workingDaysInPeriod = countWorkingDaysInRange(periodStart, periodEnd, workingDays);
    if (workingDaysInPeriod === 0) continue;

    total += Math.round(expense.amountCents / workingDaysInPeriod);
  }
  return total;
}

// Splits totalCents evenly across shiftCount shares (integer cents), with
// any rounding remainder added to the last share so the shares always sum
// back to exactly totalCents.
export function splitAcrossShifts(totalCents: number, shiftCount: number): number[] {
  if (shiftCount <= 0) return [];
  const base = Math.floor(totalCents / shiftCount);
  const shares = new Array(shiftCount).fill(base);
  const remainder = totalCents - base * shiftCount;
  shares[shiftCount - 1] += remainder;
  return shares;
}
