# KM Gaps table + cumulative-balance bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Replace the weekly/monthly block-accrual km-allowance formula with pure daily-linear accrual, and make the "Franquia de km" bar show the cumulative signed balance. (B) Persist every auto-detected odometer gap as an auditable `km_gaps` row, for every vehicle, fully recomputed on every `shifts`/`fuel_entries` write. (C) Surface detected gaps on the day-detail sheet with an inline reclassification editor.

**Architecture:** Pure-function rewrite in `rentalKmAllowanceUtils.ts` (no I/O, no period concept), a new SQL migration + `SECURITY DEFINER` recompute trigger for `km_gaps`, a new `src/services/kmGaps.ts` read/update service, and a new small presentational `src/components/KmGapRow.tsx` wired into the existing (untested, route-level) `DayDetailModal` inside `app/(tabs)/index.tsx`.

**Tech Stack:** React Native/Expo, TypeScript, Jest + @testing-library/react-native, Supabase Postgres (SQL migrations, RLS, `SECURITY DEFINER` triggers), react-i18next.

## Global Constraints

- `getPeriodBounds`/`PeriodBounds` in `src/utils/rentalKmAllowanceUtils.ts` must NOT be touched — `src/utils/recurringExpenseAllocationUtils.ts` depends on it (confirmed via grep: only consumer besides this file itself; reads only `periodStart`/`periodEnd`, never `periodIndex`).
- `RentalAllowanceStatus` drops `periodStart`/`periodEnd`/`periodIndex`/`periodUsageKm`/`periodAllowanceKm`. `allowanceAmountKm`/`allowancePeriod` stay.
- `km_gaps` applies to every vehicle, not just ones with an active km-allowance.
- `recompute_km_gaps` is a full rebuild per vehicle (never incremental), preserves rows with `is_edited = true` untouched.
- No user-facing INSERT policy on `km_gaps` — only the `SECURITY DEFINER` trigger writes new rows. `EXECUTE` on `recompute_km_gaps` is revoked from `public`/`authenticated`/`anon`.
- Reclassifying a gap (category/note) never changes `gap_meters`/`start_odometer_meters`/`end_odometer_meters`, and never affects `cumulativeUsageKm`/`balanceKm`.
- A gap whose window spans midnight is shown in full (not split) on every calendar day it overlaps.
- Notification dedup key (`fireRentalAllowanceNearLimitNotification`) must keep its exact current cadence (re-arms every calendar week/month while `isNearLimit` stays true) by calling `getPeriodBounds` directly in `app/(tabs)/index.tsx`, purely for that key — this value must never flow into `RentalAllowanceStatus` (coordinator decision, see plan history).
- TDD every task: failing test → implementation → passing test → commit. Full Jest suite green before every commit after the first.
- Multi-language: every new user-facing string gets real translations in `pt.json`, `en.json`, `es.json`, `fr.json`, `zh.json` (not just Portuguese). `en-GB.json` is a partial override merged over `en` (`{ ...en, ...enGB }` in `src/lib/i18n.ts`) — it only needs new keys where British spelling actually differs, which none of this feature's strings do, so it is NOT touched.
- Work directly on `master`, no worktree/branch. No `finishing-a-development-branch` at the end.

---

## Part A — daily-linear accrual

### Task 1: Rewrite `computeRentalAllowanceStatus` to daily-linear accrual

**Files:**
- Modify: `src/utils/rentalKmAllowanceUtils.ts` (keep `getPeriodBounds`/`PeriodBounds`/`addMonthClamped`/`mondayOf` at the top completely untouched; replace `RentalAllowanceStatus` and `computeRentalAllowanceStatus` below them)
- Test: `__tests__/utils/rentalKmAllowanceUtils.test.ts` (keep the `describe('getPeriodBounds', ...)` block byte-for-byte unchanged; replace the entire `describe('computeRentalAllowanceStatus', ...)` block)

**Interfaces:**
- Produces: `RentalAllowanceStatus` (new shape, no period fields), `computeRentalAllowanceStatus(params)` with the SAME parameter shape as before (`contractStartDate`, `contractStartOdometerMeters`, `allowancePeriod`, `allowanceAmountKm`, `excessRateCents`, `readings`, `now`) — callers (`src/services/rentalAllowance.ts`) need zero changes.

- [ ] **Step 1: Replace the `computeRentalAllowanceStatus` describe block in the test file with the new daily-linear tests**

Open `__tests__/utils/rentalKmAllowanceUtils.test.ts`. Leave lines 1-78 (imports + the entire `describe('getPeriodBounds', ...)` block) exactly as they are. Replace everything from `describe('computeRentalAllowanceStatus', ...)` (currently starting at line 80) through the end of the file with:

```ts
describe('computeRentalAllowanceStatus', () => {
  // Real production case (Eddie, 2026-08-17): contract started 2026-08-05
  // at 18332000m, 1505 km/week (215 km/day exactly). By 2026-08-17 the
  // odometer read 21126000m. Hand-verified: 13 calendar days (inclusive of
  // both start and today) x 215 km/day = 2795 km allowance vs
  // (21126000-18332000)/1000 = 2794 km driven -> +1 km balance. The
  // previous block-formula gave +1277 km for this exact data -- a
  // different model, not a rounding difference. This is the regression
  // test for the whole daily-linear rewrite (docs/superpowers/specs/
  // 2026-08-18-km-gaps-and-cumulative-balance-bar-design.md).
  it('regression: daily-linear allowance for a weekly plan matches the hand-verified production case (+1 km balance)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 1505,
      excessRateCents: 150,
      readings: [{ odometerMeters: 21126000, at: '2026-08-17T10:00:00Z' }],
      now: new Date('2026-08-17T16:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(2794);
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(2795); // 215 km/day * 13 days
    expect(status?.balanceKm).toBeCloseTo(1);
    expect(status?.isOverLimit).toBe(false);
  });

  // Boundary case requested explicitly: same real data, but 2km more driven
  // tips the balance from +1 to a small debt, proving the boundary crosses
  // exactly where hand-calculated (2795 - 2796 = -1), not off-by-one.
  it('regression: 2km more driven on the same real data crosses the balance from +1 to -1 km (debt boundary)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 1505,
      excessRateCents: 150,
      readings: [{ odometerMeters: 21128000, at: '2026-08-17T10:00:00Z' }],
      now: new Date('2026-08-17T16:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(2796);
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(2795);
    expect(status?.balanceKm).toBeCloseTo(-1);
    expect(status?.isOverLimit).toBe(true);
    expect(status?.overageKm).toBeCloseTo(1);
    expect(status?.overageCostCents).toBe(Math.round(1 * 150));
  });

  it('uses the explicit contract-start odometer as the baseline', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [
        { odometerMeters: 18332000, at: '2026-08-05T09:00:00Z' },
        { odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' },
      ],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    // latest reading 18622000 - baseline 18332000 = 290000m = 290km
    expect(status?.cumulativeUsageKm).toBe(290);
    // daysElapsed: Aug5,6,7 inclusive = 3 days -> (500/7)*3 = 214.2857...
    expect(status?.cumulativeAllowanceKm).toBeCloseTo((500 / 7) * 3);
    expect(status?.baselineIsEstimated).toBe(false);
  });

  it('falls back to the earliest-ever reading as the baseline when no explicit start odometer is given', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: null,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [
        { odometerMeters: 18332000, at: '2026-08-05T09:00:00Z' },
        { odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' },
      ],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(290);
    expect(status?.baselineIsEstimated).toBe(true);
  });

  it('cumulative usage never resets across what would have been a period boundary (weekend gap production shape)', () => {
    // Contract started Monday 2026-08-03 at odometer 0. A shift ends
    // Saturday at 500km; the car is driven privately over the weekend with
    // nothing logged (+200km); the next reading Wednesday is 900km. There
    // is no period-boundary concept anymore for this to get lost at.
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-03',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 1500,
      excessRateCents: 75,
      readings: [
        { odometerMeters: 500_000, at: '2026-08-08T18:00:00Z' },
        { odometerMeters: 900_000, at: '2026-08-12T18:00:00Z' },
      ],
      now: new Date('2026-08-12T19:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(900);
    // daysElapsed: Aug3..Aug12 inclusive = 10 days -> (1500/7)*10
    expect(status?.cumulativeAllowanceKm).toBeCloseTo((1500 / 7) * 10);
  });

  it('monthly: daily rate varies by which calendar month the elapsed day falls in (rate changes across a month boundary)', () => {
    // Contract started 2026-01-30, allowance 310km/month. daysElapsed
    // (Jan30, Jan31, Feb1, Feb2 inclusive) = 4 days: 2 days at Jan's rate
    // (310/31 = 10 km/day exactly) + 2 days at Feb's rate (310/28, Feb 2026
    // is not a leap year).
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-01-30',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'monthly',
      allowanceAmountKm: 310,
      excessRateCents: 100,
      readings: [{ odometerMeters: 1_000_000, at: '2026-02-02T12:00:00Z' }],
      now: new Date('2026-02-02T12:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(1000);
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(2 * (310 / 31) + 2 * (310 / 28));
  });

  it('flags over-limit once the cumulative balance goes negative, with an overage cost estimate', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [{ odometerMeters: 520_000, at: '2026-08-05T18:00:00Z' }],
      now: new Date('2026-08-05T19:00:00Z'),
    });
    // daysElapsed = 1 -> allowance = 500/7 ~= 71.43km
    expect(status?.isOverLimit).toBe(true);
    expect(status?.balanceKm).toBeCloseTo(500 / 7 - 520);
    expect(status?.overageKm).toBeCloseTo(520 - 500 / 7);
    expect(status?.overageCostCents).toBe(Math.round((520 - 500 / 7) * 150));
    expect(status?.remainingKm).toBe(0);
  });

  it('isNearLimit fires at >=90% cumulative usage', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 700, // daysElapsed=1 -> allowance = 100km
      excessRateCents: 150,
      readings: [{ odometerMeters: 95_000, at: '2026-08-05T18:00:00Z' }],
      now: new Date('2026-08-05T19:00:00Z'),
    });
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(100);
    expect(status?.isNearLimit).toBe(true);
    expect(status?.isOverLimit).toBe(false);
  });

  it('returns null when there are no readings at all', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status).toBeNull();
  });

  it('returns null for unlimited allowance', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'unlimited',
      allowanceAmountKm: null,
      excessRateCents: null,
      readings: [{ odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' }],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status).toBeNull();
  });

  it('returns null when allowanceAmountKm is null', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: null,
      excessRateCents: null,
      readings: [{ odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' }],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test file to confirm it fails**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts`
Expected: the `getPeriodBounds` tests still PASS (untouched code); every `computeRentalAllowanceStatus` test FAILS, because `status.cumulativeAllowanceKm` etc. still come from the old block formula (e.g. the first regression test will see something far from 2795).

- [ ] **Step 3: Replace `RentalAllowanceStatus` and `computeRentalAllowanceStatus` in the implementation file**

In `src/utils/rentalKmAllowanceUtils.ts`, keep everything from the top through the end of `getPeriodBounds` (through its closing `}` — i.e. keep lines 1-78 of the current file exactly as they are: `RentalAllowancePeriod`, `OdometerReading`, `PeriodBounds`, `addMonthClamped`, `mondayOf`, `getPeriodBounds`). Replace everything from `export interface RentalAllowanceStatus` onward with:

```ts
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
```

- [ ] **Step 4: Run the test file to confirm it passes**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts`
Expected: PASS, all tests in both describe blocks.

- [ ] **Step 5: Fix `RentalAllowanceBanner.test.tsx`'s `makeStatus` fixture — it still has the removed period fields**

`__tests__/components/RentalAllowanceBanner.test.tsx`'s `makeStatus` builds an object literal declared as `RentalAllowanceStatus` that still includes `periodStart`/`periodEnd`/`periodIndex`/`periodUsageKm`/`periodAllowanceKm`. `RentalAllowanceBanner.tsx` itself needs no change (it never read those fields — see the spec's "What stays, what goes"), but this object literal now has excess properties against the new type, which `npx tsc --noEmit` will flag (Jest itself won't catch it: `jest-expo`'s babel transform strips types without checking them, so this stays a silent latent type error until something runs `tsc`, which Task 3 and Task 8 both do later in this plan).

In `__tests__/components/RentalAllowanceBanner.test.tsx`, find:

```tsx
function makeStatus(overrides: Partial<RentalAllowanceStatus> = {}): RentalAllowanceStatus {
  return {
    periodStart: new Date('2026-08-05'), periodEnd: new Date('2026-08-12'), periodIndex: 0,
    allowanceAmountKm: 500, allowancePeriod: 'weekly',
    baselineMeters: 18332000, baselineIsEstimated: false, currentOdometerMeters: 18622000,
    periodUsageKm: 290, periodAllowanceKm: 500,
    cumulativeUsageKm: 290, cumulativeAllowanceKm: 500, balanceKm: 210,
    isNearLimit: false, isOverLimit: false,
    overageKm: 0, overageCostCents: 0, remainingKm: 210,
    ...overrides,
  };
}
```

Replace with:

```tsx
function makeStatus(overrides: Partial<RentalAllowanceStatus> = {}): RentalAllowanceStatus {
  return {
    allowanceAmountKm: 500, allowancePeriod: 'weekly',
    baselineMeters: 18332000, baselineIsEstimated: false, currentOdometerMeters: 18622000,
    cumulativeUsageKm: 290, cumulativeAllowanceKm: 500, balanceKm: 210,
    isNearLimit: false, isOverLimit: false,
    overageKm: 0, overageCostCents: 0, remainingKm: 210,
    ...overrides,
  };
}
```

The test bodies below it already only ever override/read cumulative fields (`cumulativeUsageKm`, `cumulativeAllowanceKm`, `isNearLimit`, `isOverLimit`, `balanceKm`, `overageKm`, `overageCostCents`, `remainingKm`, `baselineIsEstimated`) — none reference `periodUsageKm`/`periodAllowanceKm`/`period*`, so no other line in that file changes. One exception: the test `'does not alert on a single heavy period when the cumulative balance still covers it'` overrides `periodUsageKm: 600, periodAllowanceKm: 500` to make a point about period-vs-cumulative — since period fields no longer exist at all, delete that test entirely (there is no period-scoped figure left to conflict with the cumulative one; the scenario it guarded against is structurally impossible now).

Find and delete:

```tsx
  it('does not alert on a single heavy period when the cumulative balance still covers it', () => {
    // periodUsageKm/periodAllowanceKm alone would look "over" (600/500), but
    // isNearLimit/isOverLimit are driven by the cumulative fields, which the
    // caller (computeRentalAllowanceStatus) would have computed as healthy.
    const { toJSON } = render(<RentalAllowanceBanner status={makeStatus({
      periodUsageKm: 600, periodAllowanceKm: 500, isNearLimit: false, isOverLimit: false,
    })} />);
    expect(toJSON()).toBeNull();
  });

```

- [ ] **Step 6: Run the Banner test file and the typecheck to confirm the fix**

Run: `npx jest __tests__/components/RentalAllowanceBanner.test.tsx`
Expected: PASS, all remaining tests.

Run: `npx tsc --noEmit`
Expected: no errors referencing `RentalAllowanceBanner.test.tsx` or `RentalAllowanceStatus` excess properties (some pre-existing unrelated errors, if any, are out of scope for this plan — only confirm no NEW error was introduced by this task).

- [ ] **Step 7: Confirm `getPeriodBounds`'s other real caller still passes untouched**

Run: `npx jest __tests__/utils/recurringExpenseAllocationUtils.test.ts`
Expected: PASS (this file was never touched; confirms `getPeriodBounds`/`PeriodBounds` are still fully intact for this caller).

- [ ] **Step 8: Commit**

```bash
git add src/utils/rentalKmAllowanceUtils.ts __tests__/utils/rentalKmAllowanceUtils.test.ts __tests__/components/RentalAllowanceBanner.test.tsx
git commit -m "feat: switch km-allowance accrual from weekly/monthly blocks to daily-linear

Verified against real production data (Eddie, 2026-08-17): the block
formula gave +1277 km balance, daily-linear gives the hand-verified
correct +1 km. getPeriodBounds/PeriodBounds untouched (still used by
recurringExpenseAllocationUtils.ts). Also fixes RentalAllowanceBanner's
test fixture, which still referenced the now-removed period fields."
```

---

### Task 2: `RentalAllowanceExtractCard` shows the cumulative balance, not a period figure

**Files:**
- Modify: `src/components/RentalAllowanceExtractCard.tsx`
- Test: `__tests__/components/RentalAllowanceExtractCard.test.tsx` (full rewrite — `makeStatus` no longer has period fields)

**Interfaces:**
- Consumes: `RentalAllowanceStatus` from Task 1 (`cumulativeUsageKm`, `cumulativeAllowanceKm`, `balanceKm`, `isNearLimit`, `isOverLimit`, `allowancePeriod`) — no period fields exist anymore.
- Produces: no change to the component's own exported signature (`{ status: RentalAllowanceStatus | null }`).

- [ ] **Step 1: Replace the test file**

Replace the entire contents of `__tests__/components/RentalAllowanceExtractCard.test.tsx` with:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { RentalAllowanceExtractCard } from '../../src/components/RentalAllowanceExtractCard';
import { Colors } from '../../src/theme';
import type { RentalAllowanceStatus } from '../../src/utils/rentalKmAllowanceUtils';

// Same convention as RentalAllowanceBanner.test.tsx: mock react-i18next with
// the real pt.json copy so assertions exercise the actual production strings.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      const ptDict = require('../../locales/pt.json');
      const shortKey = key.replace('rental_allowance.', '');
      let str: string = ptDict.rental_allowance[shortKey] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{{${k}}}`, String(v));
        }
      }
      return str;
    },
  }),
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  return Array.isArray(style) ? Object.assign({}, ...style) : (style as Record<string, unknown>);
}

function makeStatus(overrides: Partial<RentalAllowanceStatus> = {}): RentalAllowanceStatus {
  return {
    allowanceAmountKm: 1500, allowancePeriod: 'weekly',
    baselineMeters: 19228000, baselineIsEstimated: true, currentOdometerMeters: 20739000,
    cumulativeUsageKm: 2858, cumulativeAllowanceKm: 3000, balanceKm: 142,
    isNearLimit: true, isOverLimit: false,
    overageKm: 0, overageCostCents: 0, remainingKm: 142,
    ...overrides,
  };
}

describe('RentalAllowanceExtractCard', () => {
  it('renders nothing when status is null', () => {
    const { toJSON } = render(<RentalAllowanceExtractCard status={null} />);
    expect(toJSON()).toBeNull();
  });

  it('shows used/total km and percentage from the CUMULATIVE balance, not a period-scoped figure', () => {
    render(<RentalAllowanceExtractCard status={makeStatus()} />);
    expect(screen.getByText('2858 / 3000 km usados')).toBeTruthy();
    expect(screen.getByText('95%')).toBeTruthy(); // round(2858/3000 * 100) = 95
  });

  it('shows a positive balance as banked km', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({ balanceKm: 142 })} />);
    expect(screen.getByTestId('rental-allowance-balance').props.children).toBe('142 km de saldo');
  });

  it('shows a negative balance as debt, without a minus sign leaking into the label', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({
      cumulativeUsageKm: 3011, isOverLimit: true, balanceKm: -11,
    })} />);
    expect(screen.getByTestId('rental-allowance-balance').props.children).toBe('11 km em débito');
  });

  it('caps the bar fill at 100% and switches it to error color once the cumulative balance goes negative, regardless of how far over', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({
      cumulativeUsageKm: 6000, cumulativeAllowanceKm: 3000,
      isNearLimit: true, isOverLimit: true, balanceKm: -3000,
    })} />);
    const fill = flattenStyle(screen.getByTestId('rental-allowance-fill').props.style);
    expect(fill.width).toBe('100%'); // usage is 2x allowance -- fill must still cap at 100%
    expect(fill.backgroundColor).toBe(Colors.error);
  });

  it('shows the bar in accent color, not yet full, while near but under the limit', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({
      cumulativeUsageKm: 2858, cumulativeAllowanceKm: 3000, isNearLimit: true, isOverLimit: false,
    })} />);
    const fill = flattenStyle(screen.getByTestId('rental-allowance-fill').props.style);
    expect(fill.width).toBe(`${(2858 / 3000) * 100}%`);
    expect(fill.backgroundColor).toBe(Colors.accent);
  });
});
```

- [ ] **Step 2: Run the test file to confirm it fails**

Run: `npx jest __tests__/components/RentalAllowanceExtractCard.test.tsx`
Expected: FAIL — `status.cumulativeUsageKm`/`cumulativeAllowanceKm` exist on the type already (Task 1), but the component still reads `periodUsageKm`/`periodAllowanceKm`, which no longer exist on `RentalAllowanceStatus` (TypeScript/runtime `undefined`), and there is no `testID="rental-allowance-fill"` yet.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `src/components/RentalAllowanceExtractCard.tsx` with:

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import type { RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';

// Always-visible "how much of my km allowance have I used" card for a
// rental vehicle -- distinct from RentalAllowanceBanner, which stays
// silent until 90% used (that one is a warning, this one is a standing
// extract/statement, shown regardless of how close the driver is to the
// limit). Renders nothing for a non-rental vehicle (status === null).
//
// The bar/percentage/headline are the CUMULATIVE, never-resets figures
// (cumulativeUsageKm / cumulativeAllowanceKm) -- see
// docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md
// Part A. Because cumulativeUsageKm > cumulativeAllowanceKm exactly when
// balanceKm < 0, capping the fill ratio at 1 automatically fully-fills the
// bar the moment the balance goes negative -- no separate "force full bar"
// branch needed.
export function RentalAllowanceExtractCard({ status }: { status: RentalAllowanceStatus | null }) {
  const { t } = useTranslation();
  if (!status) return null;

  const pct = Math.min(status.cumulativeUsageKm / status.cumulativeAllowanceKm, 1);
  const pctLabel = Math.round(pct * 100);
  const barColor = status.isOverLimit ? Colors.error : status.isNearLimit ? Colors.accent : Colors.success;
  const periodLabel = status.allowancePeriod === 'monthly'
    ? t('rental_allowance.period_monthly')
    : t('rental_allowance.period_weekly');
  const isBalancePositive = status.balanceKm >= 0;
  const balanceKey = isBalancePositive
    ? 'rental_allowance.extract_balance_positive'
    : 'rental_allowance.extract_balance_negative';
  const balanceColor = isBalancePositive ? Colors.success : Colors.error;

  return (
    <View style={s.card} testID="rental-allowance-extract">
      <View style={s.headerRow}>
        <Text style={s.title}>{t('rental_allowance.extract_title')}</Text>
        <Text style={s.period}>{periodLabel}</Text>
      </View>

      <Text style={s.usageText}>
        {t('rental_allowance.extract_usage', {
          used: status.cumulativeUsageKm.toFixed(0),
          total: status.cumulativeAllowanceKm.toFixed(0),
        })}
      </Text>

      <View style={s.track}>
        <View
          testID="rental-allowance-fill"
          style={[s.fill, { width: `${pct * 100}%`, backgroundColor: barColor }]}
        />
      </View>

      <View style={s.footerRow}>
        <Text style={[s.balanceText, { color: balanceColor }]} testID="rental-allowance-balance">
          {t(balanceKey, { km: Math.abs(status.balanceKm).toFixed(0) })}
        </Text>
        <Text style={[s.pctText, { color: barColor }]}>{pctLabel}%</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md,
    marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  title: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  period: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  usageText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: Spacing.sm },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  balanceText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  pctText: { fontSize: 12, fontWeight: '700' },
});
```

- [ ] **Step 4: Run the test file to confirm it passes**

Run: `npx jest __tests__/components/RentalAllowanceExtractCard.test.tsx`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full Jest suite**

Run: `npx jest`
Expected: PASS (this also confirms `RentalAllowanceBanner` and `rentalAllowance.test.ts` are unaffected — neither reads the removed period fields).

- [ ] **Step 6: Commit**

```bash
git add src/components/RentalAllowanceExtractCard.tsx __tests__/components/RentalAllowanceExtractCard.test.tsx
git commit -m "feat: RentalAllowanceExtractCard bar shows the cumulative balance, not a period figure

Bar fill = min(cumulativeUsageKm/cumulativeAllowanceKm, 1); automatically
fully-fills once balanceKm goes negative since the ratio then exceeds 1."
```

---

### Task 3: Preserve the near-limit push-notification dedup cadence without `periodStart` on `RentalAllowanceStatus`

**Files:**
- Modify: `app/(tabs)/index.tsx` (import block ~line 42-46, call site ~line 1428-1430)

**Interfaces:**
- Consumes: `getPeriodBounds` from `src/utils/rentalKmAllowanceUtils.ts` (untouched, Task 1) — signature `getPeriodBounds(contractStartDate: string, allowancePeriod: RentalAllowancePeriod, now: Date): PeriodBounds | null`. Consumes `vehicleData` (the raw Supabase row already fetched for `vehicleP`/`rentalStatusP` in `loadData`, columns include `rental_contract_start_date` and `rental_km_allowance_period`, per the `vehicleColumns` string at line 1356).
- Produces: no new exports. This is route-level glue code; `app/(tabs)/index.tsx` has no dedicated test suite (confirmed: no `__tests__/app/index*.test.*` exists, only `root-layout-nav.test.tsx` and `tab-layout-tour-targets.test.tsx`, neither of which touches this screen). Verify this task via `npx tsc --noEmit` (must compile) and the full Jest suite staying green (must not regress anything it happens to share code with), not a new test file.

**Why this is safe:** `RentalAllowanceStatus` (Task 1) no longer carries `periodStart`. The notification's dedup key must still re-arm exactly when it did before — on every new calendar week/month while `isNearLimit` stays true. `getPeriodBounds` is exactly the function that already computed the old `periodStart` (Task 1 confirmed the old `computeRentalAllowanceStatus` derived its removed `periodStart` field from this same call). Calling it here, standalone, with the same `(contractStartDate, allowancePeriod, now)` inputs the old code implicitly used, reproduces the identical value — this is a pure refactor of *where* the value is computed, not a behavior change.

- [ ] **Step 1: Update the import**

Find (line 42, currently a standalone type-only import):

```ts
import type { RentalAllowanceStatus } from '@/src/utils/rentalKmAllowanceUtils';
```

Replace with:

```ts
import { getPeriodBounds, type RentalAllowanceStatus, type RentalAllowancePeriod } from '@/src/utils/rentalKmAllowanceUtils';
```

- [ ] **Step 2: Replace the notification call site**

Find (currently lines 1428-1430):

```ts
    if (rentalStatusData?.isNearLimit) {
      fireRentalAllowanceNearLimitNotification(i18n.language, rentalStatusData.periodStart.toISOString().slice(0, 10)).catch(() => {});
    }
```

Replace with:

```ts
    if (rentalStatusData?.isNearLimit) {
      // RentalAllowanceStatus no longer carries periodStart/periodEnd (removed
      // 2026-08-18 along with the block-accrual formula -- see
      // docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md).
      // The notification's dedup key still needs a value that re-arms on
      // each new calendar week/month, so it's derived directly here from
      // getPeriodBounds (the exact function the old removed periodStart
      // field itself came from) -- this key is display/dedup plumbing only,
      // it never flows into RentalAllowanceStatus.
      const vd = vehicleData as { rental_contract_start_date?: string | null; rental_km_allowance_period?: RentalAllowancePeriod | null } | null;
      const notifBounds = vd?.rental_contract_start_date && vd?.rental_km_allowance_period
        ? getPeriodBounds(vd.rental_contract_start_date, vd.rental_km_allowance_period, new Date())
        : null;
      if (notifBounds) {
        fireRentalAllowanceNearLimitNotification(i18n.language, notifBounds.periodStart.toISOString().slice(0, 10)).catch(() => {});
      }
    }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (confirms `getPeriodBounds`/`RentalAllowancePeriod` import paths and the `vd` cast are all valid).

- [ ] **Step 4: Run the full Jest suite**

Run: `npx jest`
Expected: PASS (no test exercises this route file directly, so this step is a regression guard on everything else, not a direct assertion on this change).

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "fix: rederive km-allowance notification dedup key via getPeriodBounds directly

RentalAllowanceStatus dropped periodStart in the daily-linear rewrite
(Task 1). Reuses getPeriodBounds standalone, purely for the notification's
week/month re-arm key -- preserves the exact existing cadence without
reintroducing period fields into RentalAllowanceStatus."
```

---

## Part B — `km_gaps` table

### Task 4: Create and apply the `km_gaps` migration

**Files:**
- Create: `supabase/migrations/20260818120000_km_gaps.sql`

**Interfaces:**
- Produces: table `public.km_gaps`, function `public.recompute_km_gaps(p_vehicle_id uuid, p_user_id uuid) returns void`, trigger function `public.trg_recompute_km_gaps()`, triggers `shifts_recompute_km_gaps` and `fuel_entries_recompute_km_gaps` on `public.shifts`/`public.fuel_entries`. Consumed by Task 5 (backfill), Task 6 (`src/services/kmGaps.ts`).
- This task has no Jest tests (pure SQL/infrastructure) — verified via `mcp__claude_ai_Supabase__execute_sql` checks instead.

Confirmed via `mcp__claude_ai_Supabase__execute_sql` during planning: `public.is_admin()` already exists in this project (`SECURITY DEFINER`, checks `profiles.role = 'admin'`) and every existing table (`expenses`, `fuel_entries`, `shifts`, `vehicles`) uses the exact `(user_id = auth.uid()) OR is_admin()` policy idiom the spec's SQL uses — no adjustment needed to match house style.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260818120000_km_gaps.sql`:

```sql
create table public.km_gaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  start_odometer_meters integer not null,
  end_odometer_meters integer not null,
  gap_meters integer generated always as (end_odometer_meters - start_odometer_meters) stored,
  start_at timestamptz not null,  -- timestamp of the reading right before the gap (the last known odometer value before it)
  end_at timestamptz not null,    -- timestamp of the reading that revealed the gap (the first reading after it)
  category text not null default 'personal_use'
    check (category in ('personal_use', 'other')),
  note text,
  is_edited boolean not null default false, -- true once the driver changes category/note; excludes this row from future auto-recompute
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint km_gaps_positive check (gap_meters > 0)
);

create index km_gaps_vehicle_idx on public.km_gaps (vehicle_id, start_at);

alter table public.km_gaps enable row level security;

create policy "km_gaps: usuario ve os proprios" on public.km_gaps
  for select using (user_id = auth.uid() or is_admin());
create policy "km_gaps: usuario edita os proprios" on public.km_gaps
  for update using (user_id = auth.uid() or is_admin());
create policy "km_gaps: usuario deleta os proprios" on public.km_gaps
  for delete using (user_id = auth.uid() or is_admin());
-- No user-facing INSERT policy: rows are only ever created by the
-- SECURITY DEFINER trigger function below, never directly by the app.

comment on table public.km_gaps is
  'Auto-detected odometer jumps between two consecutive readings (shift start/end, fuel fill-up) for a vehicle, with nothing logged in between -- almost always personal/leisure driving. Fully recomputed (see recompute_km_gaps()) on every shift/fuel_entries write for that vehicle, EXCEPT rows with is_edited=true, which the driver has manually recategorized and which recompute leaves untouched. See docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md.';

create or replace function public.recompute_km_gaps(p_vehicle_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  readings record;
  prev_odometer integer;
  prev_at timestamptz;
begin
  -- Wipe only the auto-generated, untouched rows for this vehicle -- rows
  -- the driver has edited (is_edited=true) are preserved as-is, even if
  -- they no longer exactly match a gap the fresh scan below would find.
  delete from public.km_gaps
    where vehicle_id = p_vehicle_id and is_edited = false;

  prev_odometer := null;
  prev_at := null;

  for readings in (
    select odometer_start_meters as odometer, started_at as at
      from public.shifts
      where vehicle_id = p_vehicle_id and odometer_start_meters is not null
    union all
    select odometer_end_meters, ended_at
      from public.shifts
      where vehicle_id = p_vehicle_id and odometer_end_meters is not null and ended_at is not null
    union all
    select odometer_meters, filled_at
      from public.fuel_entries
      where vehicle_id = p_vehicle_id and odometer_meters is not null
    order by at
  )
  loop
    if prev_odometer is not null and readings.odometer > prev_odometer then
      insert into public.km_gaps (
        user_id, vehicle_id, start_odometer_meters, end_odometer_meters, start_at, end_at
      ) values (
        p_user_id, p_vehicle_id, prev_odometer, readings.odometer, prev_at, readings.at
      );
    end if;
    -- Always advance to the latest reading seen, even if this one didn't
    -- produce a gap (odometer went backwards or stayed flat -- data entry
    -- noise, not a gap) -- otherwise a single bad row would poison every
    -- gap computed after it.
    if prev_odometer is null or readings.odometer >= prev_odometer then
      prev_odometer := readings.odometer;
      prev_at := readings.at;
    end if;
  end loop;
end;
$$;

create or replace function public.trg_recompute_km_gaps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.vehicle_id is not null then
      perform public.recompute_km_gaps(old.vehicle_id, old.user_id);
    end if;
    return old;
  end if;
  if new.vehicle_id is not null then
    perform public.recompute_km_gaps(new.vehicle_id, new.user_id);
  end if;
  -- A vehicle_id change (rare, but the column is nullable/updatable) needs
  -- the OLD vehicle's gaps recomputed too, or a stale gap can outlive the
  -- reading that justified it.
  if tg_op = 'UPDATE' and old.vehicle_id is not null and old.vehicle_id is distinct from new.vehicle_id then
    perform public.recompute_km_gaps(old.vehicle_id, old.user_id);
  end if;
  return new;
end;
$$;

create trigger shifts_recompute_km_gaps
  after insert or update or delete on public.shifts
  for each row execute function public.trg_recompute_km_gaps();

create trigger fuel_entries_recompute_km_gaps
  after insert or update or delete on public.fuel_entries
  for each row execute function public.trg_recompute_km_gaps();

-- SECURITY: recompute_km_gaps is SECURITY DEFINER (needs to write km_gaps
-- despite the table having no INSERT policy), which means if any
-- authenticated user could call it directly via RPC, they could pass an
-- arbitrary vehicle_id/user_id and force a recompute against a vehicle they
-- don't own -- not a data-modification risk (the function only ever
-- derives gap rows from that vehicle's own real shifts/fuel_entries, it
-- can't fabricate arbitrary data), but it would let one user trigger
-- unwanted writes/load against another user's rows. Revoke direct execute
-- access; only the trigger functions (which run with the privileges of
-- their own SECURITY DEFINER, not the calling user's grants) may invoke it.
revoke execute on function public.recompute_km_gaps(uuid, uuid) from public, authenticated, anon;
```

- [ ] **Step 2: Apply the migration to the live project**

Call `mcp__claude_ai_Supabase__apply_migration` with `project_id: "ucxkvxqpkknxotbfxgeu"`, `name: "km_gaps"`, and `query` set to the exact SQL from Step 1.

- [ ] **Step 3: Verify the schema landed correctly**

Run via `mcp__claude_ai_Supabase__execute_sql` (project_id `ucxkvxqpkknxotbfxgeu`):

```sql
select tablename, policyname, cmd from pg_policies where tablename = 'km_gaps' order by cmd;
```
Expected: 3 rows (`SELECT`, `UPDATE`, `DELETE`), no `INSERT` row.

```sql
select has_function_privilege('authenticated', 'public.recompute_km_gaps(uuid,uuid)', 'EXECUTE') as auth_can_exec,
       has_function_privilege('anon', 'public.recompute_km_gaps(uuid,uuid)', 'EXECUTE') as anon_can_exec;
```
Expected: both `false`.

```sql
select tgname, tgrelid::regclass from pg_trigger where tgname in ('shifts_recompute_km_gaps', 'fuel_entries_recompute_km_gaps');
```
Expected: 2 rows, on `shifts` and `fuel_entries` respectively.

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase/migrations/20260818120000_km_gaps.sql
git commit -m "feat: add km_gaps table + full-rebuild recompute trigger on shifts/fuel_entries

Applied directly to production via Supabase MCP (apply_migration) as part
of this commit -- table, RLS policies, and the SECURITY DEFINER
recompute_km_gaps()/trigger were verified live before this commit. See
docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md
Part B."
```

---

### Task 5: Backfill `km_gaps` history for the existing vehicle

**Files:** none (pure data operation against the live database — no repo files change, no commit for this task).

The migration's triggers only fire on *future* `shifts`/`fuel_entries` writes. Per the spec's "Out of scope" section, existing vehicles need one manual `recompute_km_gaps` call to populate their history immediately rather than waiting for the next organic write.

- [ ] **Step 1: Run the backfill for the known vehicle**

Run via `mcp__claude_ai_Supabase__execute_sql` (project_id `ucxkvxqpkknxotbfxgeu`) — this connection uses the service role, which is unaffected by the `authenticated`/`anon`/`public` EXECUTE revoke from Task 4:

```sql
select public.recompute_km_gaps('4483a9f5-10b0-442c-9732-415a1dc27264'::uuid, 'db85eea7-8cd7-464d-ba68-05f1e8a15560'::uuid);
```

- [ ] **Step 2: Verify the backfilled rows, including the known 114 km gap**

```sql
select id, start_odometer_meters, end_odometer_meters, gap_meters, start_at, end_at, category, is_edited
from public.km_gaps
where vehicle_id = '4483a9f5-10b0-442c-9732-415a1dc27264'
order by start_at;
```

Expected: at least one row with `gap_meters = 114000` (114 km), `start_at` around `2026-08-15T15:46:00Z` (the finished shift's `ended_at`) and `end_at` around `2026-08-17T12:44:39Z` (the next shift's `started_at`) — matching the real production gap this whole feature was designed around (see the spec's Context section). Every row should have `category = 'personal_use'` and `is_edited = false` (nothing has been manually reclassified yet).

---

## Part C — Day-detail line item

### Task 6: `src/services/kmGaps.ts` — read gaps for a day, update category/note

**Files:**
- Create: `src/services/kmGaps.ts`
- Test: `__tests__/services/kmGaps.test.ts`

**Interfaces:**
- Consumes: `supabase` client from `../lib/supabase` (same pattern as `src/services/expenses.ts`/`src/services/rentalAllowance.ts`).
- Produces: `KmGapCategory` (`'personal_use' | 'other'`), `KmGap` interface (mirrors the `km_gaps` table columns from Task 4), `KmGapForDay` (`KmGap & { spansMultipleDays: boolean }`), `getKmGapsForDay(userId: string, dateStr: string): Promise<KmGapForDay[]>`, `updateKmGap(id: string, updates: { category: KmGapCategory; note: string | null }): Promise<void>`. Consumed by Task 7 (`KmGapRow`) and Task 8 (`DayDetailModal`).

- [ ] **Step 1: Write the failing test file**

Create `__tests__/services/kmGaps.test.ts`:

```ts
import { getKmGapsForDay, updateKmGap } from '@/src/services/kmGaps';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

// Minimal fake Supabase select-query builder, same style as
// __tests__/services/rentalAllowance.test.ts's makeQueryBuilder. Row
// timestamps here are deliberately NAIVE (no 'Z'/offset suffix) so that
// `new Date(...)` parses them as local time -- exactly matching how
// getKmGapsForDay computes its own dayStart/dayEnd bounds
// (`new Date(dateStr + 'T00:00:00')`). This keeps the test's expectations
// independent of the test runner's actual timezone: both sides of every
// comparison go through the same local-time interpretation.
function makeSelectBuilder(rows: Record<string, unknown>[]) {
  let filtered = rows;
  const builder: any = {
    select: () => builder,
    eq: (field: string, value: unknown) => { filtered = filtered.filter(r => r[field] === value); return builder; },
    lt: (field: string, value: unknown) => { filtered = filtered.filter(r => (r[field] as string) < (value as string)); return builder; },
    gt: (field: string, value: unknown) => { filtered = filtered.filter(r => (r[field] as string) > (value as string)); return builder; },
    order: () => builder,
    then: (resolve: (v: { data: Record<string, unknown>[]; error: null }) => unknown) =>
      resolve({ data: filtered, error: null }),
  };
  return builder;
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1', user_id: 'u1', vehicle_id: 'v1',
    start_odometer_meters: 20739000, end_odometer_meters: 20853000, gap_meters: 114000,
    start_at: '2026-08-15T15:46:00', end_at: '2026-08-17T12:44:39',
    category: 'personal_use', note: null, is_edited: false,
    created_at: '2026-08-18T00:00:00', updated_at: '2026-08-18T00:00:00',
    ...overrides,
  };
}

describe('getKmGapsForDay', () => {
  it('returns a gap whose window overlaps the given local day', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      expect(table).toBe('km_gaps');
      return makeSelectBuilder([makeRow()]);
    });
    const result = await getKmGapsForDay('u1', '2026-08-16');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g1');
    expect(result[0].gap_meters).toBe(114000);
  });

  it('marks a gap that starts and ends on different local calendar days as spanning multiple days', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => makeSelectBuilder([
      makeRow({ start_at: '2026-08-15T22:00:00', end_at: '2026-08-16T06:00:00' }),
    ]));
    const result = await getKmGapsForDay('u1', '2026-08-16');
    expect(result[0].spansMultipleDays).toBe(true);
  });

  it('marks a same-day gap as not spanning multiple days', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => makeSelectBuilder([
      makeRow({ start_at: '2026-08-16T08:00:00', end_at: '2026-08-16T12:00:00' }),
    ]));
    const result = await getKmGapsForDay('u1', '2026-08-16');
    expect(result[0].spansMultipleDays).toBe(false);
  });

  it('excludes a gap entirely outside the requested day', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => makeSelectBuilder([
      makeRow({ start_at: '2026-08-10T08:00:00', end_at: '2026-08-10T12:00:00' }),
    ]));
    const result = await getKmGapsForDay('u1', '2026-08-16');
    expect(result).toHaveLength(0);
  });
});

describe('updateKmGap', () => {
  it('sets category, note, and is_edited=true, without touching the odometer fields', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      expect(table).toBe('km_gaps');
      return { update: updateMock };
    });
    await updateKmGap('g1', { category: 'other', note: 'foi buscar filho na escola' });
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      category: 'other', note: 'foi buscar filho na escola', is_edited: true,
    }));
    expect(eqMock).toHaveBeenCalledWith('id', 'g1');
  });

  it('throws when the update fails', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: new Error('boom') }) }),
    }));
    await expect(updateKmGap('g1', { category: 'other', note: null })).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run the test file to confirm it fails**

Run: `npx jest __tests__/services/kmGaps.test.ts`
Expected: FAIL — `src/services/kmGaps.ts` does not exist yet (module not found).

- [ ] **Step 3: Implement the service**

Create `src/services/kmGaps.ts`:

```ts
import { supabase } from '../lib/supabase';

export type KmGapCategory = 'personal_use' | 'other';

export interface KmGap {
  id: string;
  user_id: string;
  vehicle_id: string;
  start_odometer_meters: number;
  end_odometer_meters: number;
  gap_meters: number;
  start_at: string;
  end_at: string;
  category: KmGapCategory;
  note: string | null;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
}

// A KmGap plus a display-only flag computed for the specific calendar day
// it's being shown on -- see getKmGapsForDay. Not a DB column: a single
// km_gaps row whose window spans midnight is independently fetched (and
// this flag recomputed) by each overlapping day's DayDetailModal, per
// docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md
// Part C ("shown on both days ... a single row, two display appearances").
export interface KmGapForDay extends KmGap {
  spansMultipleDays: boolean;
}

function toLocalDateStr(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Gaps whose [start_at, end_at) window overlaps the given local calendar
// day, across ALL of the user's vehicles -- matches DayDetailModal's
// existing getDayDetail, which is also user-scoped rather than
// vehicle-scoped (see app/(tabs)/index.tsx). dateStr is 'YYYY-MM-DD' in the
// user's local time, same convention as getDayDetail.
export async function getKmGapsForDay(userId: string, dateStr: string): Promise<KmGapForDay[]> {
  const dayStart = new Date(dateStr + 'T00:00:00').toISOString();
  const dayEnd = new Date(dateStr + 'T23:59:59.999').toISOString();

  const { data, error } = await supabase
    .from('km_gaps')
    .select('*')
    .eq('user_id', userId)
    .lt('start_at', dayEnd)
    .gt('end_at', dayStart)
    .order('start_at', { ascending: true });

  if (error) throw error;
  return ((data ?? []) as KmGap[]).map(g => ({
    ...g,
    spansMultipleDays: toLocalDateStr(g.start_at) !== toLocalDateStr(g.end_at),
  }));
}

// Reclassification is metadata-only (see the design spec's "Reclassification
// is metadata-only" section): never touches gap_meters/start_odometer_meters/
// end_odometer_meters, which came from real odometer readings. Always sets
// is_edited = true, which excludes this row from the next automatic
// recompute_km_gaps() rebuild triggered by a shifts/fuel_entries write.
export async function updateKmGap(
  id: string,
  updates: { category: KmGapCategory; note: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('km_gaps')
    .update({
      category: updates.category,
      note: updates.note,
      is_edited: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 4: Run the test file to confirm it passes**

Run: `npx jest __tests__/services/kmGaps.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full Jest suite**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/kmGaps.ts __tests__/services/kmGaps.test.ts
git commit -m "feat: add kmGaps service (getKmGapsForDay, updateKmGap)"
```

---

### Task 7: `i18n` keys for the gap row + `KmGapRow` component

**Files:**
- Modify: `locales/pt.json`, `locales/en.json`, `locales/es.json`, `locales/fr.json`, `locales/zh.json` (new `km_gaps` block, right after the existing `rental_allowance` block in each file — `en-GB.json` is NOT touched, per Global Constraints: it's a partial override merged over `en`, and none of these strings differ in British English)
- Create: `src/components/KmGapRow.tsx`
- Test: `__tests__/components/KmGapRow.test.tsx`

**Interfaces:**
- Consumes: `KmGapForDay`, `KmGapCategory` from `../services/kmGaps` (Task 6). `metersToDisplay` from `../utils/units`.
- Produces: `KmGapRow({ gap: KmGapForDay; distanceUnit: 'km' | 'mi'; onSave: (category: KmGapCategory, note: string | null) => Promise<void> })`. Purely presentational — the actual Supabase write happens in the `onSave` callback the caller supplies (Task 8), keeping this component unit-testable without mocking Supabase. Consumed by Task 8.

**Note on the `{{unit}}` interpolation below:** the app already shows `distanceUnit` ('km'/'mi') as a raw, untranslated suffix everywhere distances appear (e.g. `app/(tabs)/index.tsx`'s `` `${metersToDisplay(totalKm, distanceUnit).toFixed(1)} ${distanceUnit}` ``) — the gap row string follows that same existing convention instead of hardcoding "km".

- [ ] **Step 1: Add the `km_gaps` i18n block to all 5 locale files**

In `locales/pt.json`, immediately after the closing `},` of the `"rental_allowance"` block (before `"more": {`), insert:

```json
    "km_gaps":  {
                    "category_personal_use":  "Uso pessoal",
                    "category_other":  "Outro",
                    "row_label":  "{{category}} detectado: {{km}} {{unit}}",
                    "note_placeholder":  "Nota (opcional)",
                    "spans_multiple_days":  "Horário exato não registrado — pode ter ocorrido no dia anterior ou seguinte."
                },
```

In `locales/en.json`, in the same position, insert:

```json
    "km_gaps":  {
                    "category_personal_use":  "Personal use",
                    "category_other":  "Other",
                    "row_label":  "{{category}} detected: {{km}} {{unit}}",
                    "note_placeholder":  "Note (optional)",
                    "spans_multiple_days":  "Exact time not logged — may have happened the day before or after."
                },
```

In `locales/es.json`, in the same position, insert:

```json
    "km_gaps":  {
                    "category_personal_use":  "Uso personal",
                    "category_other":  "Otro",
                    "row_label":  "{{category}} detectado: {{km}} {{unit}}",
                    "note_placeholder":  "Nota (opcional)",
                    "spans_multiple_days":  "Hora exacta no registrada — puede haber ocurrido el día anterior o siguiente."
                },
```

In `locales/fr.json` (2-space compact style, no trailing comma-alignment), in the same position, insert:

```json
  "km_gaps": {
    "category_personal_use": "Usage personnel",
    "category_other": "Autre",
    "row_label": "{{category}} détecté : {{km}} {{unit}}",
    "note_placeholder": "Note (facultatif)",
    "spans_multiple_days": "Heure exacte non enregistrée — a pu se produire la veille ou le lendemain."
  },
```

In `locales/zh.json` (2-space compact style), in the same position, insert:

```json
  "km_gaps": {
    "category_personal_use": "私人使用",
    "category_other": "其他",
    "row_label": "检测到{{category}}：{{km}} {{unit}}",
    "note_placeholder": "备注（可选）",
    "spans_multiple_days": "确切时间未记录 — 可能发生在前一天或后一天。"
  },
```

- [ ] **Step 2: Write the failing component test**

Create `__tests__/components/KmGapRow.test.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { KmGapRow } from '../../src/components/KmGapRow';
import type { KmGapForDay } from '../../src/services/kmGaps';

// Generalized i18n mock (unlike RentalAllowanceExtractCard.test.tsx's, this
// component uses two namespaces: km_gaps.* and common.*), backed by the
// real pt.json copy so assertions exercise the actual production strings.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      const ptDict = require('../../locales/pt.json');
      const [ns, shortKey] = key.split('.');
      let str: string = ptDict[ns]?.[shortKey] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{{${k}}}`, String(v));
        }
      }
      return str;
    },
  }),
}));

function makeGap(overrides: Partial<KmGapForDay> = {}): KmGapForDay {
  return {
    id: 'g1', user_id: 'u1', vehicle_id: 'v1',
    start_odometer_meters: 20739000, end_odometer_meters: 20853000, gap_meters: 114000,
    start_at: '2026-08-15T15:46:00Z', end_at: '2026-08-17T12:44:39.292Z',
    category: 'personal_use', note: null, is_edited: false,
    created_at: '2026-08-18T00:00:00Z', updated_at: '2026-08-18T00:00:00Z',
    spansMultipleDays: true,
    ...overrides,
  };
}

describe('KmGapRow', () => {
  it('shows the detected personal-use gap in the configured distance unit', () => {
    render(<KmGapRow gap={makeGap()} distanceUnit="km" onSave={jest.fn()} />);
    expect(screen.getByText('Uso pessoal detectado: 114 km')).toBeTruthy();
  });

  it('converts gap_meters to miles when distanceUnit is mi', () => {
    render(<KmGapRow gap={makeGap({ gap_meters: 160934 })} distanceUnit="mi" onSave={jest.fn()} />);
    expect(screen.getByText('Uso pessoal detectado: 100 mi')).toBeTruthy();
  });

  it('shows a note when the gap window spans more than one calendar day', () => {
    render(<KmGapRow gap={makeGap({ spansMultipleDays: true })} distanceUnit="km" onSave={jest.fn()} />);
    expect(screen.getByTestId('km-gap-spans-note')).toBeTruthy();
  });

  it('does not show the multi-day note for a same-day gap', () => {
    render(<KmGapRow gap={makeGap({ spansMultipleDays: false })} distanceUnit="km" onSave={jest.fn()} />);
    expect(screen.queryByTestId('km-gap-spans-note')).toBeNull();
  });

  it('keeps the inline editor closed by default and opens it on tap', () => {
    render(<KmGapRow gap={makeGap()} distanceUnit="km" onSave={jest.fn()} />);
    expect(screen.queryByTestId('km-gap-editor')).toBeNull();
    fireEvent.press(screen.getByTestId('km-gap-row'));
    expect(screen.getByTestId('km-gap-editor')).toBeTruthy();
  });

  it('saves the selected category and trimmed note, then collapses', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<KmGapRow gap={makeGap()} distanceUnit="km" onSave={onSave} />);
    fireEvent.press(screen.getByTestId('km-gap-row'));
    fireEvent.press(screen.getByTestId('km-gap-category-other'));
    fireEvent.changeText(screen.getByTestId('km-gap-note-input'), '  foi buscar filho na escola  ');
    fireEvent.press(screen.getByTestId('km-gap-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('other', 'foi buscar filho na escola'));
    await waitFor(() => expect(screen.queryByTestId('km-gap-editor')).toBeNull());
  });

  it('cancels without calling onSave and collapses the editor', () => {
    const onSave = jest.fn();
    render(<KmGapRow gap={makeGap()} distanceUnit="km" onSave={onSave} />);
    fireEvent.press(screen.getByTestId('km-gap-row'));
    fireEvent.press(screen.getByTestId('km-gap-cancel'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('km-gap-editor')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test file to confirm it fails**

Run: `npx jest __tests__/components/KmGapRow.test.tsx`
Expected: FAIL — `src/components/KmGapRow.tsx` does not exist yet.

- [ ] **Step 4: Implement the component**

Create `src/components/KmGapRow.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors, Spacing } from '../theme';
import { metersToDisplay } from '../utils/units';
import type { KmGapForDay, KmGapCategory } from '../services/kmGaps';

// Presentational row for one detected odometer gap, shown on the day-detail
// sheet under the "Produtividade" block (see app/(tabs)/index.tsx's
// DayDetailModal). Tapping it expands an inline reclassification editor
// (category + free-text note) -- see
// docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md
// Part C. Purely presentational: the actual Supabase write happens in
// `onSave`, supplied by the caller -- keeps this component unit-testable
// without mocking Supabase.
export function KmGapRow({ gap, distanceUnit, onSave }: {
  gap: KmGapForDay;
  distanceUnit: 'km' | 'mi';
  onSave: (category: KmGapCategory, note: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<KmGapCategory>(gap.category);
  const [note, setNote] = useState(gap.note ?? '');
  const [saving, setSaving] = useState(false);

  const km = metersToDisplay(gap.gap_meters, distanceUnit).toFixed(0);
  const categoryLabel = t(`km_gaps.category_${gap.category}`);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(category, note.trim() || null);
      setExpanded(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={s.wrap}>
      <TouchableOpacity style={s.row} onPress={() => setExpanded(e => !e)} testID="km-gap-row">
        <Ionicons name="alert-circle-outline" size={14} color={Colors.accent} />
        <Text style={s.label}>
          {t('km_gaps.row_label', { category: categoryLabel, km, unit: distanceUnit })}
        </Text>
      </TouchableOpacity>
      {gap.spansMultipleDays && (
        <Text style={s.subNote} testID="km-gap-spans-note">{t('km_gaps.spans_multiple_days')}</Text>
      )}
      {expanded && (
        <View style={s.editor} testID="km-gap-editor">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['personal_use', 'other'] as const).map(c => (
              <TouchableOpacity
                key={c}
                testID={`km-gap-category-${c}`}
                style={[s.pill, category === c && s.pillActive]}
                onPress={() => setCategory(c)}
              >
                <Text style={[s.pillText, category === c && s.pillTextActive]}>
                  {t(`km_gaps.category_${c}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={s.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder={t('km_gaps.note_placeholder')}
            placeholderTextColor={Colors.textSecondary}
            testID="km-gap-note-input"
          />
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
            <TouchableOpacity onPress={() => setExpanded(false)} testID="km-gap-cancel">
              <Text style={s.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} disabled={saving} testID="km-gap-save">
              <Text style={s.saveText}>{t('common.save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  label: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  subNote: { color: Colors.textSecondary, fontSize: 10, fontStyle: 'italic', marginLeft: 20 },
  editor: { marginTop: 6, marginLeft: 20, gap: 8 },
  pill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: Colors.border },
  pillActive: { backgroundColor: Colors.accentDim, borderColor: Colors.accent },
  pillText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  pillTextActive: { color: Colors.accent },
  noteInput: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 8, color: Colors.textPrimary, fontSize: 12 },
  cancelText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  saveText: { color: Colors.accent, fontSize: 12, fontWeight: '700' },
});
```

- [ ] **Step 5: Run the test file to confirm it passes**

Run: `npx jest __tests__/components/KmGapRow.test.tsx`
Expected: PASS, all tests.

- [ ] **Step 6: Validate every locale file is still valid JSON**

Run: `node -e "['pt','en','es','fr','zh'].forEach(l => { require('./locales/'+l+'.json'); console.log(l, 'OK'); })"`
Expected: prints `pt OK`, `en OK`, `es OK`, `fr OK`, `zh OK` — catches a stray trailing comma or bracket mismatch from the manual JSON edits in Step 1.

- [ ] **Step 7: Run the full Jest suite**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add locales/pt.json locales/en.json locales/es.json locales/fr.json locales/zh.json src/components/KmGapRow.tsx __tests__/components/KmGapRow.test.tsx
git commit -m "feat: add KmGapRow component with inline category/note reclassification editor"
```

---

### Task 8: Wire `KmGapRow` into the day-detail sheet

**Files:**
- Modify: `app/(tabs)/index.tsx` (`DayDetailModal`, currently lines 916-1073: imports ~line 26-47, the `useEffect` at 925-934, the render block around 1043-1058)

**Interfaces:**
- Consumes: `getKmGapsForDay`, `updateKmGap`, `KmGapForDay` from `@/src/services/kmGaps` (Task 6). `KmGapRow` from `@/src/components/KmGapRow` (Task 7).
- No new exports. Same as Task 3: `app/(tabs)/index.tsx` has no dedicated test suite — verify via `npx tsc --noEmit` and the full Jest suite staying green, plus the manual smoke-test described in Step 5.

- [ ] **Step 1: Add the imports**

Near the existing service imports (around line 43-45, right after the `getRecurringExpenseBreakdownForDay`/`getRentalAllowanceStatus` imports):

```ts
import { getKmGapsForDay, updateKmGap, type KmGapForDay } from '@/src/services/kmGaps';
import { KmGapRow } from '@/src/components/KmGapRow';
```

- [ ] **Step 2: Add gap state and fetch it alongside the existing day-detail data**

Find (current `DayDetailModal`, lines 921-934):

```tsx
  const { t } = useTranslation();
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [recurringBreakdown, setRecurringBreakdown] = useState<Array<{ category: string; amountCents: number }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !dateStr || !userId) return;
    setLoading(true); setDetail(null); setRecurringBreakdown([]);
    Promise.all([
      getDayDetail(userId, dateStr),
      getRecurringExpenseBreakdownForDay(userId, dateStr).catch(() => []),
    ]).then(([d, breakdown]) => { setDetail(d); setRecurringBreakdown(breakdown); })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [visible, dateStr, userId]);
```

Replace with:

```tsx
  const { t } = useTranslation();
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [recurringBreakdown, setRecurringBreakdown] = useState<Array<{ category: string; amountCents: number }>>([]);
  const [kmGaps, setKmGaps] = useState<KmGapForDay[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !dateStr || !userId) return;
    setLoading(true); setDetail(null); setRecurringBreakdown([]); setKmGaps([]);
    Promise.all([
      getDayDetail(userId, dateStr),
      getRecurringExpenseBreakdownForDay(userId, dateStr).catch(() => []),
      getKmGapsForDay(userId, dateStr).catch(() => [] as KmGapForDay[]),
    ]).then(([d, breakdown, gaps]) => { setDetail(d); setRecurringBreakdown(breakdown); setKmGaps(gaps); })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [visible, dateStr, userId]);

  // Optimistic local update: reclassification (Part B's "Reclassification
  // is metadata-only") never changes gap_meters/start_odometer_meters/
  // end_odometer_meters, so merging the patch into local state is exactly
  // as correct as refetching, without a round trip.
  async function handleGapSave(gap: KmGapForDay, category: KmGapForDay['category'], note: string | null) {
    await updateKmGap(gap.id, { category, note });
    setKmGaps(prev => prev.map(g => (g.id === gap.id ? { ...g, category, note, is_edited: true } : g)));
  }
```

- [ ] **Step 3: Render the gap rows under the km rows in the Produtividade block**

Find (current lines 1050-1053):

```tsx
              {dayOdomEnd != null && (
                <Row label={t('dashboard.day_odometer_end')} value={`${(dayOdomEnd / 1000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} km`} />
              )}
              <Row label={t('dashboard.day_shifts')} value={String(shifts.length)} />
```

Replace with:

```tsx
              {dayOdomEnd != null && (
                <Row label={t('dashboard.day_odometer_end')} value={`${(dayOdomEnd / 1000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} km`} />
              )}
              {kmGaps.map(gap => (
                <KmGapRow
                  key={gap.id}
                  gap={gap}
                  distanceUnit={distanceUnit}
                  onSave={(category, note) => handleGapSave(gap, category, note)}
                />
              ))}
              <Row label={t('dashboard.day_shifts')} value={String(shifts.length)} />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual smoke test against production data**

Since this file has no dedicated test suite, verify the wiring against the real backfilled data from Task 5 using `mcp__claude_ai_Supabase__execute_sql` (read-only, project_id `ucxkvxqpkknxotbfxgeu`):

```sql
select id, gap_meters, start_at, end_at, category
from public.km_gaps
where vehicle_id = '4483a9f5-10b0-442c-9732-415a1dc27264'
  and start_at < '2026-08-16T23:59:59.999-03:00' and end_at > '2026-08-16T00:00:00-03:00'
order by start_at;
```

(Adjust the `-03:00` offset if Eddie's actual configured timezone differs — the point is confirming at least the 114 km gap's window overlaps 2026-08-16 in local time, so `getKmGapsForDay(userId, '2026-08-16')` will return it and `DayDetailModal` will render a `KmGapRow` for that day.) This is a read-only confirmation that the query shape `getKmGapsForDay` uses will surface the expected row — full end-to-end UI verification happens in the "Deployment & Production Verification" section after this plan's tasks are all committed and deployed.

- [ ] **Step 6: Run the full Jest suite**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat: show detected km gaps on the day-detail sheet with inline reclassification

Wires KmGapRow (Task 7) and the kmGaps service (Task 6) into DayDetailModal,
directly under the existing km_driven/odometer_start/odometer_end rows in
the Produtividade block, per
docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md
Part C."
```

---

## Deployment & Production Verification

Not a task with its own commit — these are the closing steps once every task above is committed.

1. Run `npx jest` one final time and confirm the full suite is green.
2. Run `npx tsc --noEmit` and confirm no errors.
3. From `app-motorista/`, run `vercel --prod` and confirm the deployment reaches `READY` status at `app.paldrivy.com`.
4. Verify against real production data via `mcp__claude_ai_Supabase__execute_sql` (project_id `ucxkvxqpkknxotbfxgeu`):
   - Re-derive the expected km-allowance balance by hand for vehicle `4483a9f5-10b0-442c-9732-415a1dc27264` (`rental_contract_start_date = '2026-08-05'`, `rental_contract_start_odometer = 18332000`, `rental_km_allowance_period = 'weekly'`, `rental_km_allowance_amount = 1500` — confirmed live values, note: the design spec's own hand-worked example used a hypothetical 1505 km/week for its Context narrative, the real configured value is 1500) for **today's actual date**, not a hardcoded past date — `daysElapsed = floor((today_UTC_midnight - 2026-08-05T00:00:00Z) / 1 day) + 1`, `cumulativeAllowanceKm = (1500/7) * daysElapsed`, `cumulativeUsageKm = (latest_odometer_reading - 18332000) / 1000`, `balanceKm = cumulativeAllowanceKm - cumulativeUsageKm`. Query the latest reading with the same union `recompute_km_gaps` and `getRentalAllowanceStatus` both use (`shifts.odometer_start_meters`/`started_at`, `shifts.odometer_end_meters`/`ended_at`, `fuel_entries.odometer_meters`/`filled_at`, all for this `vehicle_id`, ordered by timestamp).
   - Confirm `select count(*) from public.km_gaps where vehicle_id = '4483a9f5-10b0-442c-9732-415a1dc27264'` is non-zero and includes the row with `gap_meters = 114000` from Task 5.
5. Update `D:\Obsidian\Claude Code\PalDrivy.md` with a new dated entry following the file's existing established pattern, summarizing: the daily-linear accrual rewrite (with the real +1/-1 km boundary verified), the `km_gaps` table + trigger, the day-detail gap row, and the deploy confirmation.
