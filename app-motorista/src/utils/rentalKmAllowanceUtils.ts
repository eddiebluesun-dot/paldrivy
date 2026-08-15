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
  periodIndex: number;

  allowanceAmountKm: number;
  allowancePeriod: RentalAllowancePeriod;

  baselineMeters: number;
  baselineIsEstimated: boolean; // true when baselineMeters came from the fallback (earliest-ever reading) rather than an explicit contract odometer

  currentOdometerMeters: number;

  periodUsageKm: number; // this period only -- display-only, drives the weekly/monthly bar
  periodAllowanceKm: number; // alias of allowanceAmountKm, for display symmetry with periodUsageKm

  cumulativeUsageKm: number; // since contract start, never resets
  cumulativeAllowanceKm: number; // allowanceAmountKm * (periodIndex + 1)
  balanceKm: number; // cumulativeAllowanceKm - cumulativeUsageKm; signed, positive = banked, negative = debt

  isNearLimit: boolean; // cumulative percent used >= 90%
  isOverLimit: boolean; // balanceKm < 0
  overageKm: number; // max(0, -balanceKm)
  overageCostCents: number;
  remainingKm: number; // max(0, balanceKm)
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
  const { periodStart, periodEnd, periodIndex } = bounds;

  const sorted = [...readings].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const inPeriod = sorted.filter(r => {
    const d = new Date(r.at);
    return d >= periodStart && d < periodEnd;
  });
  if (inPeriod.length === 0) return null;

  // Contract-lifetime baseline: fixed once, at contract start -- explicit
  // odometer if the owner provided one, else the earliest reading ever
  // logged. Reused for EVERY period (never recomputed at a period
  // boundary), which is what makes cumulativeUsageKm immune to the old
  // per-period-reset bug that silently dropped km driven across a boundary.
  const baselineIsEstimated = contractStartOdometerMeters == null;
  const baselineMeters = baselineIsEstimated
    ? sorted[0].odometerMeters
    : (contractStartOdometerMeters as number);

  const currentOdometerMeters = sorted[sorted.length - 1].odometerMeters;

  const cumulativeUsageKm = Math.max(0, currentOdometerMeters - baselineMeters) / 1000;
  const cumulativeAllowanceKm = allowanceAmountKm * (periodIndex + 1);
  const balanceKm = cumulativeAllowanceKm - cumulativeUsageKm;

  // periodUsageKm (display-only, drives the weekly/monthly bar): baseline is
  // the most recent reading at/before this period started, so a gap that
  // spans the boundary (e.g. a weekend with no shift/fuel entry logged)
  // shows up on whichever period's bar is currently on screen, instead of
  // vanishing between two "first reading in period" resets. Falls back to
  // the pre-existing rule (explicit start odometer for period 0, else the
  // first in-period reading) only when there's no earlier reading at all --
  // e.g. a brand-new contract, or a period reached after total inactivity.
  const priorReadings = sorted.filter(r => new Date(r.at).getTime() <= periodStart.getTime());
  const isFirstPeriodWithExplicitBaseline = periodIndex === 0 && contractStartOdometerMeters != null;
  const periodBaselineMeters = priorReadings.length > 0
    ? priorReadings[priorReadings.length - 1].odometerMeters
    : isFirstPeriodWithExplicitBaseline
      ? (contractStartOdometerMeters as number)
      : inPeriod[0].odometerMeters;
  const periodUsageKm = Math.max(0, currentOdometerMeters - periodBaselineMeters) / 1000;

  const overageKm = Math.max(0, -balanceKm);
  const overageCostCents = excessRateCents != null ? Math.round(overageKm * excessRateCents) : 0;
  const remainingKm = Math.max(0, balanceKm);
  const cumulativePercentUsed = cumulativeUsageKm / cumulativeAllowanceKm;

  return {
    periodStart, periodEnd, periodIndex,
    allowanceAmountKm, allowancePeriod,
    baselineMeters, baselineIsEstimated,
    currentOdometerMeters,
    periodUsageKm, periodAllowanceKm: allowanceAmountKm,
    cumulativeUsageKm, cumulativeAllowanceKm, balanceKm,
    isNearLimit: cumulativePercentUsed >= 0.9,
    isOverLimit: balanceKm < 0,
    overageKm, overageCostCents, remainingKm,
  };
}
