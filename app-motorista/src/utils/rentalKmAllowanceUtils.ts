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
}

// Weekly: 7-day windows counted forward from contractStartDate. Monthly:
// calendar-month-length windows anchored to the day-of-month of
// contractStartDate (e.g. started the 5th -> periods run 5th-to-5th).
export function getPeriodBounds(
  contractStartDate: string,
  allowancePeriod: RentalAllowancePeriod,
  now: Date,
): PeriodBounds | null {
  if (allowancePeriod === 'unlimited') return null;

  const start = new Date(`${contractStartDate}T00:00:00.000Z`);

  if (allowancePeriod === 'weekly') {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const elapsedWeeks = Math.floor((now.getTime() - start.getTime()) / msPerWeek);
    const periodStart = new Date(start.getTime() + elapsedWeeks * msPerWeek);
    const periodEnd = new Date(periodStart.getTime() + msPerWeek);
    return { periodStart, periodEnd };
  }

  // monthly
  let periodStart = new Date(start);
  let periodEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()));
  while (periodEnd <= now) {
    periodStart = periodEnd;
    periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, periodStart.getUTCDate()));
  }
  return { periodStart, periodEnd };
}

export interface RentalAllowanceStatus {
  periodStart: Date;
  periodEnd: Date;
  baselineMeters: number;
  currentOdometerMeters: number;
  usageKm: number;
  percentUsed: number;
  isNearLimit: boolean; // >= 90%
  isOverLimit: boolean; // >= 100%
  overageKm: number; // 0 if not over
  overageCostCents: number; // 0 if not over
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

  const isFirstPeriod = periodStart.getTime() === new Date(`${contractStartDate}T00:00:00.000Z`).getTime();
  const baselineMeters = isFirstPeriod && contractStartOdometerMeters != null
    ? contractStartOdometerMeters
    : inPeriod[0].odometerMeters;

  const currentOdometerMeters = sorted[sorted.length - 1].odometerMeters;
  const usageMeters = Math.max(0, currentOdometerMeters - baselineMeters);
  const usageKm = usageMeters / 1000;
  const percentUsed = usageKm / allowanceAmountKm;

  const overageKm = Math.max(0, usageKm - allowanceAmountKm);
  const overageCostCents = excessRateCents != null ? Math.round(overageKm * excessRateCents) : 0;

  return {
    periodStart,
    periodEnd,
    baselineMeters,
    currentOdometerMeters,
    usageKm,
    percentUsed,
    isNearLimit: percentUsed >= 0.9,
    isOverLimit: percentUsed >= 1,
    overageKm,
    overageCostCents,
  };
}
