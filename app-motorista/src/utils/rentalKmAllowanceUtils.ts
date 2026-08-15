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

export interface RentalAllowanceStatus {
  periodStart: Date;
  periodEnd: Date;
  allowanceAmountKm: number;
  allowancePeriod: RentalAllowancePeriod;
  baselineMeters: number;
  baselineIsEstimated: boolean; // true when baselineMeters came from the fallback (first in-period reading) rather than an explicit contract odometer
  currentOdometerMeters: number;
  usageKm: number;
  percentUsed: number;
  isNearLimit: boolean; // >= 90%
  isOverLimit: boolean; // >= 100%
  overageKm: number; // 0 if not over
  overageCostCents: number; // 0 if not over
  remainingKm: number; // max(0, allowanceAmountKm - usageKm) -- never negative, use overageKm for that
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

  const bounds = getPeriodBounds(contractStartDate, allowancePeriod, now);
  if (!bounds || allowanceAmountKm == null) return null;
  const { periodStart, periodEnd } = bounds;

  const sorted = [...readings].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const inPeriod = sorted.filter(r => {
    const d = new Date(r.at);
    return d >= periodStart && d < periodEnd;
  });
  if (inPeriod.length === 0) return null;

  // "First period" = the period that CONTAINS the contract's start date, not
  // "periodStart exactly equals contractStartDate" -- that equality only
  // ever held for monthly periods (still contract-day-anchored) or a weekly
  // contract that happened to start on a Monday. Weekly periods are now
  // calendar-aligned (see getPeriodBounds), so a contract starting mid-week
  // has its first periodStart fall BEFORE contractStartDate, not equal to it.
  const contractStart = new Date(`${contractStartDate}T00:00:00.000Z`);
  const isFirstPeriod = contractStart >= periodStart && contractStart < periodEnd;
  const hasExplicitBaseline = isFirstPeriod && contractStartOdometerMeters != null;
  const baselineMeters = hasExplicitBaseline
    ? (contractStartOdometerMeters as number)
    : inPeriod[0].odometerMeters;
  const baselineIsEstimated = !hasExplicitBaseline;

  const currentOdometerMeters = sorted[sorted.length - 1].odometerMeters;
  const usageMeters = Math.max(0, currentOdometerMeters - baselineMeters);
  const usageKm = usageMeters / 1000;
  const percentUsed = usageKm / allowanceAmountKm;

  const overageKm = Math.max(0, usageKm - allowanceAmountKm);
  const overageCostCents = excessRateCents != null ? Math.round(overageKm * excessRateCents) : 0;
  const remainingKm = Math.max(0, allowanceAmountKm - usageKm);

  return {
    periodStart,
    periodEnd,
    allowanceAmountKm,
    allowancePeriod,
    baselineMeters,
    baselineIsEstimated,
    currentOdometerMeters,
    usageKm,
    percentUsed,
    isNearLimit: percentUsed >= 0.9,
    isOverLimit: percentUsed >= 1,
    overageKm,
    overageCostCents,
    remainingKm,
  };
}
