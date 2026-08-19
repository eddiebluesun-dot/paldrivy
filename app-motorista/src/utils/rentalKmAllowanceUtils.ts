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
  allowanceAmountKm: number | null;   // null = uncapped/informational mode
  allowancePeriod: AllowanceCycleType;

  baselineMeters: number;
  baselineIsEstimated: boolean; // true when baselineMeters came from the fallback (earliest-ever reading) rather than an explicit contract odometer

  currentOdometerMeters: number;

  cumulativeUsageKm: number;            // since contract start, never resets, always meaningful
  cumulativeAllowanceKm: number | null; // null when allowanceAmountKm is null
  balanceKm: number | null;             // cumulativeAllowanceKm - cumulativeUsageKm; null when uncapped

  currentCycleUsageKm: number; // usage within the cycle containing `now` only -- always meaningful, even uncapped

  isNearLimit: boolean; // false when uncapped
  isOverLimit: boolean; // false when uncapped
  overageKm: number | null;
  overageCostCents: number | null;
  remainingKm: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeRentalAllowanceStatus(params: {
  contractStartDate: string;
  contractStartOdometerMeters: number | null;
  cycleType: AllowanceCycleType;
  weekStartDay: number | null;
  allowanceAmountKm: number | null;
  excessRateCents: number | null;
  readings: OdometerReading[];
  now: Date;
}): RentalAllowanceStatus | null {
  const {
    contractStartDate, contractStartOdometerMeters, cycleType, weekStartDay,
    allowanceAmountKm, excessRateCents, readings, now,
  } = params;

  const sorted = [...readings].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  if (sorted.length === 0) return null;

  // Contract-lifetime baseline: fixed once, at contract start -- explicit
  // odometer if the owner provided one, else the earliest reading ever
  // logged. Unchanged rule from every prior pass.
  const baselineIsEstimated = contractStartOdometerMeters == null;
  const baselineMeters = baselineIsEstimated
    ? sorted[0].odometerMeters
    : (contractStartOdometerMeters as number);

  const currentOdometerMeters = sorted[sorted.length - 1].odometerMeters;
  const cumulativeUsageKm = Math.max(0, currentOdometerMeters - baselineMeters) / 1000;

  const cycleLengthDays = cycleType === 'daily' ? 1 : cycleType === 'weekly' ? 7 : 30;
  const contractStart = new Date(`${contractStartDate}T00:00:00.000Z`);

  // Cycle 0's own bounds -- needed to know how many of its cycleLengthDays
  // are actually covered by the contract (only ever partial for weekly,
  // when weekStartDay doesn't match the contract's own start weekday; daily
  // and monthly always anchor exactly to contractStartDate, so cycle 0 is
  // never partial for them).
  const cycle0 = getAllowanceCycleBounds(contractStartDate, cycleType, weekStartDay, contractStart);
  const daysCoveredInCycle0 = Math.round((cycle0.cycleEnd.getTime() - contractStart.getTime()) / DAY_MS);

  const currentCycle = getAllowanceCycleBounds(contractStartDate, cycleType, weekStartDay, now);

  // Current (open) cycle's own usage -- the simple, un-bridged "first
  // reading actually in this cycle" rule. Falls back to the latest overall
  // reading (giving 0 km) when nothing has been logged yet in this cycle,
  // which is correct for any cycle after the first.
  const cycleReadings = sorted.filter(r => new Date(r.at).getTime() >= currentCycle.cycleStart.getTime());
  const currentCycleBaselineMeters = cycleReadings.length > 0 ? cycleReadings[0].odometerMeters : currentOdometerMeters;
  const currentCycleUsageKm = Math.max(0, currentOdometerMeters - currentCycleBaselineMeters) / 1000;

  if (allowanceAmountKm == null) {
    return {
      allowanceAmountKm: null, allowancePeriod: cycleType,
      baselineMeters, baselineIsEstimated,
      currentOdometerMeters,
      cumulativeUsageKm, cumulativeAllowanceKm: null, balanceKm: null,
      currentCycleUsageKm,
      isNearLimit: false, isOverLimit: false,
      overageKm: null, overageCostCents: null, remainingKm: null,
    };
  }

  const firstCycleAllowanceKm = (allowanceAmountKm * daysCoveredInCycle0) / cycleLengthDays;
  const cumulativeAllowanceKm = firstCycleAllowanceKm + allowanceAmountKm * currentCycle.cycleIndex;
  const balanceKm = cumulativeAllowanceKm - cumulativeUsageKm;

  const overageKm = Math.max(0, -balanceKm);
  const overageCostCents = excessRateCents != null ? Math.round(overageKm * excessRateCents) : 0;
  const remainingKm = Math.max(0, balanceKm);
  const cumulativePercentUsed = cumulativeUsageKm / cumulativeAllowanceKm;

  return {
    allowanceAmountKm, allowancePeriod: cycleType,
    baselineMeters, baselineIsEstimated,
    currentOdometerMeters,
    cumulativeUsageKm, cumulativeAllowanceKm, balanceKm,
    currentCycleUsageKm,
    isNearLimit: cumulativePercentUsed >= 0.9,
    isOverLimit: balanceKm < 0,
    overageKm, overageCostCents, remainingKm,
  };
}
