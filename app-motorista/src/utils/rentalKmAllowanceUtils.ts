// Pure, side-effect-free helpers for rental km-allowance tracking (no Supabase import).
// See docs/superpowers/specs/2026-08-07-rental-km-allowance-design.md for the full design.

export type RentalAllowancePeriod = 'weekly' | 'monthly' | 'unlimited';

export interface OdometerReading {
  odometerMeters: number;
  at: string; // ISO timestamp, from a shift's started_at/ended_at or a fuel entry's filled_at
}

export interface PeriodBounds {
  periodStart: Date;
  periodEnd: Date;
  periodIndex: number; // 0-based: the period containing contractStartDate is 0, the next is 1, etc.
}

// Adds `monthsToAdd` calendar months to `base`, clamping the result's
// day-of-month to the last valid day of the target month. Date.UTC()
// silently overflows out-of-range days (e.g. Date.UTC(2026, 1, 31) reads as
// "31 days into February" and rolls into March), which would otherwise drift
// a contract's anchor day forward permanently for any start date in the
// 29th-31st range. Always anchors off `base`'s own day-of-month, so callers
// must pass the ORIGINAL contract start date, not a previously-clamped
// periodStart, to avoid compounding the clamp across periods.
function addMonthClamped(base: Date, monthsToAdd: number): Date {
  const day = base.getUTCDate();
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const lastDayOfTargetMonth = new Date(Date.UTC(y, m + monthsToAdd + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + monthsToAdd, Math.min(day, lastDayOfTargetMonth)));
}

// Weekly: calendar weeks, Monday-Sunday, resetting every Monday regardless
// of the contract's own start date's day-of-week (app-standard week
// definition -- matches the dashboard's week widgets, see
// getWeekBuckets/getWeekTotals in dashboard.ts). Monthly: calendar-month-
// length windows anchored to the day-of-month of contractStartDate (e.g.
// started the 5th -> periods run 5th-to-5th), clamped to the last valid day
// of the target month for start days that don't exist in every month
// (29th-31st).
// The UTC-midnight Monday of the calendar week containing `d`.
function mondayOf(d: Date): Date {
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // 0=Sun..6=Sat -> days back to Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday));
}

export function getPeriodBounds(
  contractStartDate: string,
  allowancePeriod: RentalAllowancePeriod,
  now: Date,
): PeriodBounds | null {
  if (allowancePeriod === 'unlimited') return null;

  const start = new Date(`${contractStartDate}T00:00:00.000Z`);

  if (allowancePeriod === 'weekly') {
    const periodStart = mondayOf(now);
    const periodEnd = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const periodIndex = Math.round(
      (periodStart.getTime() - mondayOf(start).getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    return { periodStart, periodEnd, periodIndex };
  }

  // monthly: both bounds are always computed from the ORIGINAL contract
  // start date (never from a previous period's periodStart/periodEnd), so a
  // clamp in one period (e.g. Feb 28 for a 31st-started contract) never
  // becomes the anchor for the next period's clamp.
  let n = 0;
  let periodStart = addMonthClamped(start, n);
  let periodEnd = addMonthClamped(start, n + 1);
  while (periodEnd <= now) {
    n += 1;
    periodStart = addMonthClamped(start, n);
    periodEnd = addMonthClamped(start, n + 1);
  }
  return { periodStart, periodEnd, periodIndex: n };
}

// ─── Cycle bounds for the km-allowance feature (daily/weekly/monthly) ─────
// Deliberately SEPARATE from getPeriodBounds/PeriodBounds above: those stay
// calendar-Monday/calendar-month for recurringExpenseAllocationUtils.ts,
// which is unrelated and must keep working exactly as today (confirmed
// 2026-08-19). This is the km-allowance feature's own cycle math, with a
// configurable week-start day and a fixed 30-day (not calendar) month.

export type AllowanceCycleType = 'daily' | 'weekly' | 'monthly';

export interface CycleBounds {
  cycleStart: Date;
  cycleEnd: Date;      // exclusive
  cycleIndex: number;  // 0-based: the cycle containing contractStartDate is 0
}

function truncateToUTCMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

// The UTC-midnight date <= `d` whose day-of-week equals `startDay` (0=Sun..6=Sat).
function alignToWeekStart(d: Date, startDay: number): Date {
  const mid = truncateToUTCMidnight(d);
  const diff = (mid.getUTCDay() - startDay + 7) % 7;
  return addDays(mid, -diff);
}

export function getAllowanceCycleBounds(
  contractStartDate: string,
  cycleType: AllowanceCycleType,
  weekStartDay: number | null,
  now: Date,
): CycleBounds {
  const cycleLengthDays = cycleType === 'daily' ? 1 : cycleType === 'weekly' ? 7 : 30;
  const contractStart = new Date(`${contractStartDate}T00:00:00.000Z`);

  if (cycleType === 'weekly') {
    const startDay = weekStartDay ?? 1; // default Monday
    const cycleStart = alignToWeekStart(now, startDay);
    const anchorCycleStart = alignToWeekStart(contractStart, startDay);
    const cycleIndex = Math.round((cycleStart.getTime() - anchorCycleStart.getTime()) / (cycleLengthDays * DAY_MS));
    return { cycleStart, cycleEnd: addDays(cycleStart, 7), cycleIndex };
  }

  // daily and monthly are both fixed-length rolling windows from contractStart
  // -- no calendar alignment needed (unlike weekly), so both reduce to the
  // same "how many whole cycleLengthDays-day blocks have elapsed" arithmetic.
  const daysSinceStart = Math.floor((truncateToUTCMidnight(now).getTime() - contractStart.getTime()) / DAY_MS);
  const cycleIndex = Math.floor(daysSinceStart / cycleLengthDays);
  const cycleStart = addDays(contractStart, cycleIndex * cycleLengthDays);
  return { cycleStart, cycleEnd: addDays(cycleStart, cycleLengthDays), cycleIndex };
}

export interface RentalAllowanceStatus {
  allowanceAmountKm: number;      // nominal weekly/monthly amount, as configured
  allowancePeriod: RentalAllowancePeriod;

  baselineMeters: number;
  baselineIsEstimated: boolean; // true when baselineMeters came from the fallback (earliest-ever reading) rather than an explicit contract odometer

  currentOdometerMeters: number;

  cumulativeUsageKm: number; // since contract start, never resets
  cumulativeAllowanceKm: number; // daily-linear: dailyRateKm * daysElapsed (weekly) or a per-day sum of a rate that varies by month (monthly) -- see computeCumulativeAllowanceKm
  balanceKm: number; // cumulativeAllowanceKm - cumulativeUsageKm; signed, positive = banked, negative = debt

  isNearLimit: boolean; // cumulative percent used >= 90%
  isOverLimit: boolean; // balanceKm < 0
  overageKm: number; // max(0, -balanceKm)
  overageCostCents: number;
  remainingKm: number; // max(0, balanceKm)
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Last valid day-of-month for the calendar month containing `d` (28-31).
function daysInMonthUTC(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

// Daily-linear accrual (supersedes the 2026-08-15 weekly/monthly BLOCK
// formula -- see docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md).
// No more "periods" for this calculation: a period is no longer granted in
// full at its calendar start, it accrues one day's worth at a time.
// daysElapsed is inclusive of both the contract's first day and today
// (matches the old model's "a period is granted in full at its start"
// precedent, just applied at day granularity instead of week/month
// granularity).
function computeCumulativeAllowanceKm(
  contractStartDate: string,
  allowancePeriod: RentalAllowancePeriod,
  allowanceAmountKm: number,
  now: Date,
): number {
  const startMid = new Date(`${contractStartDate}T00:00:00.000Z`);
  const todayMid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysElapsed = Math.floor((todayMid.getTime() - startMid.getTime()) / DAY_MS) + 1;

  if (allowancePeriod === 'weekly') {
    // Constant daily rate -> closed form, no loop needed.
    return (allowanceAmountKm / 7) * daysElapsed;
  }

  // monthly: the daily rate varies by which calendar month each elapsed
  // day falls in (a 28-day February accrues faster per day than a 31-day
  // month for the same nominal monthly amount), so each day is summed
  // individually rather than using one closed-form rate.
  let total = 0;
  for (let i = 0; i < daysElapsed; i++) {
    const d = new Date(startMid.getTime() + i * DAY_MS);
    total += allowanceAmountKm / daysInMonthUTC(d);
  }
  return total;
}

export function computeRentalAllowanceStatus(params: {
  contractStartDate: string;
  contractStartOdometerMeters: number | null;
  allowancePeriod: RentalAllowancePeriod;
  allowanceAmountKm: number | null;
  excessRateCents: number | null;
  readings: OdometerReading[];
  now: Date;
}): RentalAllowanceStatus | null {
  const { contractStartDate, contractStartOdometerMeters, allowancePeriod, allowanceAmountKm, excessRateCents, readings, now } = params;

  if (allowancePeriod === 'unlimited' || allowanceAmountKm == null) return null;

  const sorted = [...readings].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  if (sorted.length === 0) return null;

  // Contract-lifetime baseline: fixed once, at contract start -- explicit
  // odometer if the owner provided one, else the earliest reading ever
  // logged. There is no more "first period" special case (there are no
  // periods): this is the only baseline rule now.
  const baselineIsEstimated = contractStartOdometerMeters == null;
  const baselineMeters = baselineIsEstimated
    ? sorted[0].odometerMeters
    : (contractStartOdometerMeters as number);

  const currentOdometerMeters = sorted[sorted.length - 1].odometerMeters;
  const cumulativeUsageKm = Math.max(0, currentOdometerMeters - baselineMeters) / 1000;

  const cumulativeAllowanceKm = computeCumulativeAllowanceKm(contractStartDate, allowancePeriod, allowanceAmountKm, now);
  const balanceKm = cumulativeAllowanceKm - cumulativeUsageKm;

  const overageKm = Math.max(0, -balanceKm);
  const overageCostCents = excessRateCents != null ? Math.round(overageKm * excessRateCents) : 0;
  const remainingKm = Math.max(0, balanceKm);
  const cumulativePercentUsed = cumulativeUsageKm / cumulativeAllowanceKm;

  return {
    allowanceAmountKm, allowancePeriod,
    baselineMeters, baselineIsEstimated,
    currentOdometerMeters,
    cumulativeUsageKm, cumulativeAllowanceKm, balanceKm,
    isNearLimit: cumulativePercentUsed >= 0.9,
    isOverLimit: balanceKm < 0,
    overageKm, overageCostCents, remainingKm,
  };
}
