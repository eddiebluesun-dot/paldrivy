# Rental KM Allowance — Cumulative Balance (Rollover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace the per-period reset in the rental km-allowance tracker with a running balance that never resets across the life of the rental contract, so km driven between periods is never silently lost and unused/overused km rolls forward automatically.

**Architecture:** `computeRentalAllowanceStatus` (pure function, `src/utils/rentalKmAllowanceUtils.ts`) splits its single `usageKm` into two independent numbers: `periodUsageKm` (this period only, display-only, drives the existing weekly bar) and `cumulativeUsageKm`/`cumulativeAllowanceKm`/`balanceKm` (running total since contract start, drives every alert). The two UI components and the dashboard screen that consume the status object are updated to match; the now-dead auto-expense flow is deleted rather than left half-wired.

**Tech Stack:** React Native/Expo (TypeScript), Jest + `@testing-library/react-native`, react-i18next (5 locale files: pt/en/es/fr/zh — en-GB inherits from en, not touched).

## Global Constraints

- Work directly on the `master` branch — no worktree/feature branch. Direct-to-master commits and `vercel --prod` deploys are explicitly authorized by the project owner (Eddie) for this whole session.
- Full Jest suite (233 tests as of the last deploy this session) must stay green after every task before moving to the next.
- Spec: `docs/superpowers/specs/2026-08-15-rental-km-allowance-cumulative-balance-design.md` — read it if anything below is ambiguous, it is the source of truth for intent.
- All 5 locale files (`locales/{pt,en,es,fr,zh}.json`) must be edited together for any copy change — `pt.json`/`en.json`/`es.json` use column-aligned JSON formatting (preserve it, don't reformat); `fr.json`/`zh.json` use compact formatting (preserve it too). `en-GB.json` has no `rental_allowance` block (inherits from `en.json`) — do not add one.
- Do not touch `src/services/rentalAllowance.ts`'s Supabase query logic or the `ended_at`-vs-`started_at` fix committed earlier today (2026-08-15) — this plan only changes what happens to the `readings` array after it's fetched.

---

### Task 1: `getPeriodBounds` gains `periodIndex`

**Files:**
- Modify: `src/utils/rentalKmAllowanceUtils.ts` (the `PeriodBounds` interface and `getPeriodBounds` function, lines 11-70 as of this plan's writing)
- Test: `__tests__/utils/rentalKmAllowanceUtils.test.ts` (the `describe('getPeriodBounds', ...)` block, lines 3-63)

**Interfaces:**
- Produces: `PeriodBounds` gains `periodIndex: number` (0-based: the period containing `contractStartDate` is index 0, the next period is 1, etc.). `getPeriodBounds(contractStartDate, allowancePeriod, now)` signature is unchanged.

- [ ] **Step 1: Update the failing/updated tests in `getPeriodBounds`'s describe block**

Replace the entire `describe('getPeriodBounds', ...)` block (lines 3-63) with:

```ts
describe('getPeriodBounds', () => {
  it('returns null for unlimited', () => {
    expect(getPeriodBounds('2026-08-05', 'unlimited', new Date('2026-08-20'))).toBeNull();
  });

  it('periodIndex is 0 for the period containing the contract start date', () => {
    const bounds = getPeriodBounds('2026-08-05', 'weekly', new Date('2026-08-05T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-08-03T00:00:00.000Z'),
      periodEnd: new Date('2026-08-10T00:00:00.000Z'),
      periodIndex: 0,
    });
  });

  it('computes the current weekly period as the calendar week (Mon-Sun) containing "now", regardless of the contract start date\'s weekday', () => {
    // Weekly periods are calendar-aligned (Mon-Sun), not floating 7-day
    // windows anchored to the contract's own start weekday. Contract started
    // Wed 2026-08-05; "now" is 2026-08-15 (a Saturday) -> the calendar week
    // containing it is [2026-08-10 Mon, 2026-08-17 Mon), independent of the
    // fact the contract itself started on a Wednesday. That's 1 full week
    // after the contract-start week (which began Mon 2026-08-03) -> periodIndex 1.
    const bounds = getPeriodBounds('2026-08-05', 'weekly', new Date('2026-08-15T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-08-10T00:00:00.000Z'),
      periodEnd: new Date('2026-08-17T00:00:00.000Z'),
      periodIndex: 1,
    });
  });

  it('weekly period resets every Monday regardless of contract start weekday (Sunday still counts in the PRIOR week)', () => {
    // "now" is a Sunday -- must resolve to the week that already started the
    // preceding Monday, not roll into the next one.
    const bounds = getPeriodBounds('2026-08-05', 'weekly', new Date('2026-08-16T12:00:00Z')); // Sunday
    expect(bounds).toEqual({
      periodStart: new Date('2026-08-10T00:00:00.000Z'),
      periodEnd: new Date('2026-08-17T00:00:00.000Z'),
      periodIndex: 1,
    });
  });

  it('computes the current monthly period from the contract start date', () => {
    // contract started 2026-08-05; "now" is 2026-09-10 -> period 2 is [2026-09-05, 2026-10-05),
    // which is periodIndex 1 (0-based: the contract-start period is index 0).
    const bounds = getPeriodBounds('2026-08-05', 'monthly', new Date('2026-09-10T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-09-05T00:00:00.000Z'),
      periodEnd: new Date('2026-10-05T00:00:00.000Z'),
      periodIndex: 1,
    });
  });

  it('clamps the monthly period end to the last valid day instead of overflowing into the next month (contract started the 31st)', () => {
    // contract started 2026-01-31. Naive Date.UTC(2026, 1, 31) overflows
    // February's 28 days into 2026-03-03. period 1 must instead end on
    // 2026-02-28 (last day of Feb), and period 2 -- checked at a "now" of
    // 2026-03-02, which falls inside period 2 -- must stay anchored to the
    // 31st of March (period 2's own last-valid-day clamp), not drift to the 3rd.
    const bounds = getPeriodBounds('2026-01-31', 'monthly', new Date('2026-03-02T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-02-28T00:00:00.000Z'),
      periodEnd: new Date('2026-03-31T00:00:00.000Z'),
      periodIndex: 1,
    });
  });

  it('does not drift for a start day that exists in every month (regression check)', () => {
    // contract started 2026-01-15 (a day with no overflow risk). "now" is
    // 2026-03-20 -> period 3 is [2026-03-15, 2026-04-15), which is periodIndex 2 (0-based).
    const bounds = getPeriodBounds('2026-01-15', 'monthly', new Date('2026-03-20T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-03-15T00:00:00.000Z'),
      periodEnd: new Date('2026-04-15T00:00:00.000Z'),
      periodIndex: 2,
    });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts -t getPeriodBounds`
Expected: FAIL — `periodIndex` is `undefined` on every returned object, so the `toEqual` checks fail.

- [ ] **Step 3: Implement `periodIndex` in `getPeriodBounds`**

In `src/utils/rentalKmAllowanceUtils.ts`, add a shared `mondayOf` helper right after `addMonthClamped` (around line 30), and rewrite the `PeriodBounds` interface and `getPeriodBounds` function:

```ts
export interface PeriodBounds {
  periodStart: Date;
  periodEnd: Date;
  periodIndex: number; // 0-based: the period containing contractStartDate is 0, the next is 1, etc.
}
```

```ts
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
```

This replaces the old inline `dow`/`daysSinceMonday` computation in the weekly branch with a call to the new shared `mondayOf` helper (identical math, now reused for the `periodIndex` calc too). The monthly branch is unchanged except for exposing the loop's existing `n` as `periodIndex` instead of discarding it.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts -t getPeriodBounds`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add "src/utils/rentalKmAllowanceUtils.ts" "__tests__/utils/rentalKmAllowanceUtils.test.ts"
git commit -m "feat: add periodIndex to getPeriodBounds for cumulative km-allowance tracking"
```

---

### Task 2: `computeRentalAllowanceStatus` — cumulative balance

**Files:**
- Modify: `src/utils/rentalKmAllowanceUtils.ts` (the `RentalAllowanceStatus` interface and `computeRentalAllowanceStatus` function, lines 72-150 as of this plan's writing)
- Test: `__tests__/utils/rentalKmAllowanceUtils.test.ts` (the `describe('computeRentalAllowanceStatus', ...)` block)

**Interfaces:**
- Consumes: `getPeriodBounds` from Task 1, now returning `periodIndex`.
- Produces: `RentalAllowanceStatus` with the fields below — this is what `RentalAllowanceExtractCard` (Task 3), `RentalAllowanceBanner` (Task 4), and `app/(tabs)/index.tsx` (Task 5) all consume.

```ts
export interface RentalAllowanceStatus {
  periodStart: Date;
  periodEnd: Date;
  periodIndex: number;

  allowanceAmountKm: number;
  allowancePeriod: RentalAllowancePeriod;

  baselineMeters: number;
  baselineIsEstimated: boolean;

  currentOdometerMeters: number;

  periodUsageKm: number;
  periodAllowanceKm: number;

  cumulativeUsageKm: number;
  cumulativeAllowanceKm: number;
  balanceKm: number; // signed: positive = banked surplus, negative = debt

  isNearLimit: boolean; // cumulative percent used >= 90%
  isOverLimit: boolean; // balanceKm < 0
  overageKm: number; // max(0, -balanceKm)
  overageCostCents: number;
  remainingKm: number; // max(0, balanceKm)
}
```

`usageKm` and `percentUsed` (old fields) are removed — every caller in Tasks 3-5 is updated to use the new fields instead.

- [ ] **Step 1: Replace the `describe('computeRentalAllowanceStatus', ...)` block with the updated + new tests**

Replace the entire block (from `describe('computeRentalAllowanceStatus', ...)` to its closing `});`) with:

```ts
describe('computeRentalAllowanceStatus', () => {
  const readings: OdometerReading[] = [
    { odometerMeters: 18332000, at: '2026-08-05T09:00:00Z' }, // contract start reading (also passed explicitly below)
    { odometerMeters: 18522000, at: '2026-08-06T18:00:00Z' }, // end of a shift
    { odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' }, // start of next shift -- 100km gap is leisure driving
  ];

  it('uses the explicit contract-start odometer as the baseline, for both period and cumulative usage, in the first period', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings,
      now: new Date('2026-08-07T09:00:00Z'),
    });
    // latest reading 18622000 - baseline 18332000 = 290000m = 290km
    expect(status?.periodIndex).toBe(0);
    expect(status?.periodUsageKm).toBe(290);
    expect(status?.cumulativeUsageKm).toBe(290);
    expect(status?.cumulativeAllowanceKm).toBe(500); // allowanceAmountKm * (periodIndex 0 + 1)
    expect(status?.balanceKm).toBe(210);
    expect(status?.isNearLimit).toBe(false);
    expect(status?.isOverLimit).toBe(false);
    // explicit contract-start odometer was available -> baseline is exact, not estimated
    expect(status?.baselineIsEstimated).toBe(false);
    expect(status?.remainingKm).toBe(210);
  });

  it('falls back to the earliest-ever reading as the cumulative baseline when no explicit start odometer is given (mid-contract signup)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: null,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings, // first reading ever (18332000) becomes the baseline itself
      now: new Date('2026-08-07T09:00:00Z'),
    });
    // baseline = first reading (18332000) itself -> usage = 18622000-18332000 = 290km, identical
    // result here, but arrived at via the fallback path, not the explicit odometer
    expect(status?.periodUsageKm).toBe(290);
    expect(status?.cumulativeUsageKm).toBe(290);
    // no explicit contract-start odometer -> baseline came from the fallback path, so it's estimated
    expect(status?.baselineIsEstimated).toBe(true);
  });

  it('flags over-limit once the CUMULATIVE balance goes negative, with an overage cost estimate', () => {
    const heavyReadings: OdometerReading[] = [
      { odometerMeters: 0, at: '2026-08-05T09:00:00Z' },
      { odometerMeters: 520_000, at: '2026-08-06T18:00:00Z' }, // 520km, over a 500km allowance
    ];
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150, // R$1.50/km
      readings: heavyReadings,
      now: new Date('2026-08-06T19:00:00Z'),
    });
    expect(status?.isOverLimit).toBe(true);
    expect(status?.balanceKm).toBe(-20);
    expect(status?.overageKm).toBe(20);
    expect(status?.overageCostCents).toBe(20 * 150);
    // Already over the allowance -- remainingKm clamps at 0, it never goes negative.
    expect(status?.remainingKm).toBe(0);
  });

  it('a later period reuses the SAME contract-lifetime baseline for cumulative usage (never resets), but periodUsageKm stays scoped to that period alone', () => {
    // Contract started Wed 2026-08-05 with an explicit baseline odometer
    // (18332000). "now" falls in the FOLLOWING calendar week (2026-08-10
    // Mon - 2026-08-17), periodIndex 1. Only that week's own 2 readings are
    // passed in -- no week-1 readings at all -- to isolate what each number
    // does with a real boundary in the data.
    const week2Readings: OdometerReading[] = [
      { odometerMeters: 19000000, at: '2026-08-11T09:00:00Z' }, // first reading of week 2
      { odometerMeters: 19100000, at: '2026-08-12T18:00:00Z' },
    ];
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: week2Readings,
      now: new Date('2026-08-12T19:00:00Z'),
    });
    expect(status?.periodStart).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    expect(status?.periodEnd).toEqual(new Date('2026-08-17T00:00:00.000Z'));
    expect(status?.periodIndex).toBe(1);
    // periodUsageKm: no reading exists before this period started (the test
    // deliberately passes only week-2 data), so it falls back to the first
    // in-period reading (19000000) -> 19100000-19000000 = 100km.
    expect(status?.periodUsageKm).toBe(100);
    // cumulativeUsageKm: the baseline is STILL the contract's original
    // explicit odometer (18332000), reused unchanged in period 1 -- this is
    // the fix for the boundary-gap bug: 19100000-18332000 = 768km. Under the
    // old per-period-reset design this 768 would have been impossible to
    // see (period 2's baseline would have reset to 19000000, silently
    // discarding the distance between 18332000 and 19000000).
    expect(status?.cumulativeUsageKm).toBe(768);
    expect(status?.cumulativeAllowanceKm).toBe(1000); // 500 * (periodIndex 1 + 1)
    expect(status?.balanceKm).toBe(232);
    expect(status?.isOverLimit).toBe(false);
    expect(status?.isNearLimit).toBe(false); // 768/1000 = 76.8%, under 90%
  });

  it('regression: km driven in the gap between two periods (no shift/fuel entry logged) is never lost, and shows up on the bar of the period where the bridging reading landed', () => {
    // Real production shape (2026-08-15, Eddie): a shift ends Saturday, the
    // car is driven privately over the weekend with nothing logged, and the
    // next shift starts Monday. Modeled here with round numbers: contract
    // started Monday 2026-08-03 at odometer 0. Week 1 [Aug 3, Aug 10) has one
    // shift ending Sat Aug 8 at 500km. Over the weekend the odometer climbs
    // by 200km with nothing logged. Week 2 [Aug 10, Aug 17) picks back up
    // Monday at 700km (that Monday reading is itself the first evidence of
    // the 200km gap), then another 200km is driven and logged Wednesday at
    // 900km.
    const readings: OdometerReading[] = [
      { odometerMeters: 500_000, at: '2026-08-08T18:00:00Z' }, // Sat, week 1's last reading
      { odometerMeters: 700_000, at: '2026-08-10T08:00:00Z' }, // Mon, week 2's first reading -- already includes the weekend's 200km
      { odometerMeters: 900_000, at: '2026-08-12T18:00:00Z' }, // Wed, week 2
    ];
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-03',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 1500,
      excessRateCents: 75,
      readings,
      now: new Date('2026-08-12T19:00:00Z'),
    });
    expect(status?.periodIndex).toBe(1);
    // Cumulative usage is a straight odometer diff since contract start --
    // it is structurally impossible for it to lose the weekend gap, because
    // there is no period-boundary reset to lose it at: 900000 - 0 = 900km.
    expect(status?.cumulativeUsageKm).toBe(900);
    expect(status?.cumulativeAllowanceKm).toBe(3000); // 1500 * (periodIndex 1 + 1)
    expect(status?.balanceKm).toBe(2100);
    // periodUsageKm (week 2's bar): baseline is the most recent reading
    // AT OR BEFORE this period's start (Aug 10 00:00) -- that's Saturday's
    // 500000 reading, not Monday's own 700000 -- so week 2's bar correctly
    // shows the bridged weekend gap plus its own Wednesday driving:
    // 900000 - 500000 = 400km (200km gap + 200km logged this week).
    expect(status?.periodUsageKm).toBe(400);
  });

  it('a single heavy period does not trigger the over-limit alert when the cumulative balance still covers it (banked surplus from earlier periods)', () => {
    // Contract started Monday 2026-08-03 at odometer 0, 1500km/week. By the
    // start of week 4 (periodIndex 3, period start Aug 24) only 1000km total
    // has been driven -- well under the 3 weeks' worth of allowance already
    // granted (4500km) -- then week 4 alone drives 2000km, MORE than that
    // single week's own 1500km nominal allowance.
    const readings: OdometerReading[] = [
      { odometerMeters: 1_000_000, at: '2026-08-20T12:00:00Z' }, // Thu, week 3: 1000km cumulative so far
      { odometerMeters: 3_000_000, at: '2026-08-26T12:00:00Z' }, // Wed, week 4: +2000km in this week alone
    ];
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-03',
      contractStartOdometerMeters: 0,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 1500,
      excessRateCents: 75,
      readings,
      now: new Date('2026-08-26T13:00:00Z'),
    });
    expect(status?.periodIndex).toBe(3);
    // This period alone drove 2000km, over its own 1500km nominal allowance --
    // proof the per-period number would have been "over limit" under the old design.
    expect(status?.periodUsageKm).toBe(2000);
    expect(status?.periodAllowanceKm).toBe(1500);
    // But cumulative usage (3000km) is well inside the cumulative allowance
    // banked across 4 weeks (1500 * 4 = 6000km), so no alert fires.
    expect(status?.cumulativeUsageKm).toBe(3000);
    expect(status?.cumulativeAllowanceKm).toBe(6000);
    expect(status?.balanceKm).toBe(3000);
    expect(status?.isOverLimit).toBe(false);
    expect(status?.isNearLimit).toBe(false); // 3000/6000 = 50%
  });

  it('returns null for unlimited allowance (no tracking)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      allowancePeriod: 'unlimited',
      allowanceAmountKm: null,
      excessRateCents: null,
      readings,
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts -t computeRentalAllowanceStatus`
Expected: FAIL — `periodUsageKm`/`cumulativeUsageKm`/etc. are `undefined` (the old function still only returns `usageKm`/`percentUsed`).

- [ ] **Step 3: Implement the new `RentalAllowanceStatus` shape and `computeRentalAllowanceStatus`**

Replace the `RentalAllowanceStatus` interface and `computeRentalAllowanceStatus` function (from `export interface RentalAllowanceStatus {` to the end of the file) with:

```ts
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
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts`
Expected: PASS (all tests in the file, both describe blocks)

- [ ] **Step 5: Commit**

```bash
git add "src/utils/rentalKmAllowanceUtils.ts" "__tests__/utils/rentalKmAllowanceUtils.test.ts"
git commit -m "feat: cumulative balance for rental km allowance, never resets across periods"
```

---

### Task 3: `RentalAllowanceExtractCard` — period bar + balance line

**Files:**
- Modify: `src/components/RentalAllowanceExtractCard.tsx`
- Modify: `locales/pt.json`, `locales/en.json`, `locales/es.json`, `locales/fr.json`, `locales/zh.json` (add `extract_balance_positive`/`extract_balance_negative` keys to each `rental_allowance` block)
- Test: `__tests__/components/RentalAllowanceExtractCard.test.tsx`

**Interfaces:**
- Consumes: `RentalAllowanceStatus` from Task 2 (`periodUsageKm`, `periodAllowanceKm`, `balanceKm`, `isNearLimit`, `isOverLimit`, `allowancePeriod`).

- [ ] **Step 1: Add the two new locale keys to all 5 files**

In `locales/pt.json`, inside the `rental_allowance` block, add after `"extract_remaining": "{{km}} km restantes",` (preserve the file's column-aligned formatting style):

```json
"extract_balance_positive":  "{{km}} km de saldo",
"extract_balance_negative":  "{{km}} km em débito",
```

In `locales/en.json`, same position:

```json
"extract_balance_positive":  "{{km}} km banked",
"extract_balance_negative":  "{{km}} km over",
```

In `locales/es.json`, same position:

```json
"extract_balance_positive":  "{{km}} km de saldo",
"extract_balance_negative":  "{{km}} km en déficit",
```

In `locales/fr.json` (compact formatting, after `"extract_remaining": "{{km}} km restants",`):

```json
"extract_balance_positive": "{{km}} km de solde",
"extract_balance_negative": "{{km}} km de déficit",
```

In `locales/zh.json` (compact formatting, after `"extract_remaining": "剩余 {{km}} 公里",`):

```json
"extract_balance_positive": "结余 {{km}} 公里",
"extract_balance_negative": "超支 {{km}} 公里",
```

Do not touch `locales/en-GB.json` — it has no `rental_allowance` block and inherits from `en.json`.

- [ ] **Step 2: Replace the component test file**

Replace `__tests__/components/RentalAllowanceExtractCard.test.tsx` entirely with:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { RentalAllowanceExtractCard } from '../../src/components/RentalAllowanceExtractCard';
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

function makeStatus(overrides: Partial<RentalAllowanceStatus> = {}): RentalAllowanceStatus {
  return {
    periodStart: new Date('2026-08-10'), periodEnd: new Date('2026-08-17'), periodIndex: 1,
    allowanceAmountKm: 1500, allowancePeriod: 'weekly',
    baselineMeters: 19228000, baselineIsEstimated: true, currentOdometerMeters: 20739000,
    periodUsageKm: 1358, periodAllowanceKm: 1500,
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

  it('shows used/total km and percentage for THIS PERIOD, not the cumulative total', () => {
    render(<RentalAllowanceExtractCard status={makeStatus()} />);
    expect(screen.getByText('1358 / 1500 km usados')).toBeTruthy();
    expect(screen.getByText('91%')).toBeTruthy();
  });

  it('shows a positive balance as banked km', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({ balanceKm: 142 })} />);
    expect(screen.getByTestId('rental-allowance-balance').props.children).toBe('142 km de saldo');
  });

  it('shows a negative balance as debt, without a minus sign leaking into the label', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({
      periodUsageKm: 1520, isOverLimit: true, balanceKm: -11,
    })} />);
    expect(screen.getByTestId('rental-allowance-balance').props.children).toBe('11 km em débito');
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npx jest __tests__/components/RentalAllowanceExtractCard.test.tsx`
Expected: FAIL — `usageKm`/`percentUsed`/`remainingKm` no longer exist on `RentalAllowanceStatus` (TypeScript compile error) and `rental-allowance-balance` testID doesn't exist yet.

- [ ] **Step 4: Rewrite the component**

Replace `src/components/RentalAllowanceExtractCard.tsx` entirely with:

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
// The bar/percentage above the fold are THIS PERIOD only (periodUsageKm /
// periodAllowanceKm) -- the familiar weekly/monthly habit. The balance line
// below it is the cumulative, never-resets number (balanceKm) that also
// drives isNearLimit/isOverLimit and therefore the bar's color, so a card
// can show e.g. a modest-looking period fill in amber/red if the banked
// balance is what's actually tight.
export function RentalAllowanceExtractCard({ status }: { status: RentalAllowanceStatus | null }) {
  const { t } = useTranslation();
  if (!status) return null;

  const periodPct = Math.min(status.periodUsageKm / status.periodAllowanceKm, 1);
  const periodPctLabel = Math.round(periodPct * 100);
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
          used: status.periodUsageKm.toFixed(0),
          total: status.periodAllowanceKm.toFixed(0),
        })}
      </Text>

      <View style={s.track}>
        <View style={[s.fill, { width: `${periodPct * 100}%`, backgroundColor: barColor }]} />
      </View>

      <View style={s.footerRow}>
        <Text style={[s.balanceText, { color: balanceColor }]} testID="rental-allowance-balance">
          {t(balanceKey, { km: Math.abs(status.balanceKm).toFixed(0) })}
        </Text>
        <Text style={[s.pctText, { color: barColor }]}>{periodPctLabel}%</Text>
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

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx jest __tests__/components/RentalAllowanceExtractCard.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add "src/components/RentalAllowanceExtractCard.tsx" "__tests__/components/RentalAllowanceExtractCard.test.tsx" "locales/pt.json" "locales/en.json" "locales/es.json" "locales/fr.json" "locales/zh.json"
git commit -m "feat: show cumulative km-allowance balance on the extract card"
```

---

### Task 4: `RentalAllowanceBanner` — cumulative alerts, remove auto-expense button

**Files:**
- Modify: `src/components/RentalAllowanceBanner.tsx`
- Modify: `locales/pt.json`, `locales/en.json`, `locales/es.json`, `locales/fr.json`, `locales/zh.json` (reword `near_limit`/`over_limit`, remove `add_expense`/`expense_added`/`expense_already_added`)
- Test: `__tests__/components/RentalAllowanceBanner.test.tsx`

**Interfaces:**
- Consumes: `RentalAllowanceStatus` from Task 2. `onAddExpense`/`alreadyLogged` props are removed — Task 5 updates the only call site.
- Produces: `RentalAllowanceBanner({ status, currencyCode?, locale? })` — no longer takes `onAddExpense`/`alreadyLogged`.

- [ ] **Step 1: Update the locale files**

In every one of the 5 files, the `rental_allowance` block's key order is: `extract_title`, `extract_usage`, `extract_remaining`, `period_weekly`, `period_monthly`, `near_limit`, `over_limit`, `add_expense`, `expense_added`, `baseline_estimated`, `expense_already_added` — note `baseline_estimated` sits BETWEEN `expense_added` and `expense_already_added`, not after both. For each file: (a) update the `near_limit` and `over_limit` values in place, (b) delete the `add_expense` and `expense_added` lines (they sit right before `baseline_estimated`), (c) delete the `expense_already_added` line (it sits right after `baseline_estimated`, and was the last key in the block — after deleting it, `baseline_estimated`'s line must lose its trailing comma so it becomes the new last key). Leave `extract_title` through `period_monthly` and `baseline_estimated` itself untouched, and keep `extract_balance_positive`/`extract_balance_negative` from Task 3.

In `locales/pt.json`, the block becomes:

```json
"extract_balance_positive":  "{{km}} km de saldo",
"extract_balance_negative":  "{{km}} km em débito",
"period_weekly":  "semanal",
"period_monthly":  "mensal",
"near_limit":  "Você já usou {{percent}}% da sua franquia acumulada. Restam {{km}} km de saldo.",
"over_limit":  "Você está com {{km}} km de débito acumulado (~{{cost}} estimado).",
"baseline_estimated":  "Contagem iniciada a partir do seu primeiro registro neste período."
```

(shown only from `extract_balance_positive` onward since `extract_title`/`extract_usage`/`extract_remaining` above it are untouched from Task 3; `baseline_estimated` is now the last key in the block, no trailing comma.)

In `locales/en.json`:

```json
"near_limit":  "You've used {{percent}}% of your accumulated allowance. {{km}} km left in your balance.",
"over_limit":  "You're {{km}} km over your accumulated allowance (~{{cost}} estimated).",
"baseline_estimated":  "Tracking started from your first record this period."
```

In `locales/es.json`:

```json
"near_limit":  "Ya usaste el {{percent}}% de tu franquicia acumulada. Quedan {{km}} km de saldo.",
"over_limit":  "Tienes {{km}} km de déficit acumulado (~{{cost}} estimado).",
"baseline_estimated":  "El conteo comenzó a partir de tu primer registro en este período."
```

In `locales/fr.json` (compact formatting):

```json
"near_limit": "Vous avez utilisé {{percent}} % de votre forfait km cumulé. Il reste {{km}} km de solde.",
"over_limit": "Vous avez un déficit cumulé de {{km}} km (~{{cost}} estimé).",
"baseline_estimated": "Le suivi a commencé à partir de votre premier relevé de cette période."
```

In `locales/zh.json` (compact formatting):

```json
"near_limit": "您已使用累计配额的 {{percent}}%。剩余 {{km}} 公里余额。",
"over_limit": "您累计超出 {{km}} 公里（预计约 {{cost}}）。",
"baseline_estimated": "本周期的公里数统计从您的第一条记录开始。"
```

For en/es/fr/zh, same rule as pt: `baseline_estimated` becomes the last key in the block (no trailing comma) since `expense_already_added` after it is deleted. Double-check each file with a JSON parse (e.g. `node -e "require('./locales/pt.json')"` for each of the 5) after editing — a stray or missing trailing comma here would break the whole locale file, not just this feature.

- [ ] **Step 2: Replace the component test file**

Replace `__tests__/components/RentalAllowanceBanner.test.tsx` entirely with:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { RentalAllowanceBanner } from '../../src/components/RentalAllowanceBanner';
import type { RentalAllowanceStatus } from '../../src/utils/rentalKmAllowanceUtils';

// Mock react-i18next with the real pt.json copy so assertions exercise the
// actual production strings, same convention as CockpitCard.test.tsx.
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

describe('RentalAllowanceBanner', () => {
  it('renders nothing when status is null', () => {
    const { toJSON } = render(<RentalAllowanceBanner status={null} />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing below the near-limit threshold', () => {
    const { toJSON } = render(<RentalAllowanceBanner status={makeStatus()} />);
    expect(toJSON()).toBeNull();
  });

  it('shows a warning banner at >=90% CUMULATIVE usage', () => {
    render(<RentalAllowanceBanner status={makeStatus({
      isNearLimit: true, cumulativeUsageKm: 460, cumulativeAllowanceKm: 500,
    })} />);
    expect(screen.getByTestId('rental-allowance-warning')).toBeTruthy();
  });

  it('shows the remaining (banked) km on the warning banner, not just the percentage used', () => {
    render(<RentalAllowanceBanner
      status={makeStatus({ isNearLimit: true, cumulativeUsageKm: 460, cumulativeAllowanceKm: 500, remainingKm: 142 })}
    />);
    expect(screen.getByText(/142/)).toBeTruthy();
  });

  it('shows an over-limit banner with the estimated cost of the accumulated debt at >=100% CUMULATIVE usage, with no action button', () => {
    render(<RentalAllowanceBanner
      status={makeStatus({
        isNearLimit: true, isOverLimit: true, balanceKm: -20, overageKm: 20, overageCostCents: 3000,
      })}
    />);
    expect(screen.getByTestId('rental-allowance-over')).toBeTruthy();
    expect(screen.getByText(/20/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not alert on a single heavy period when the cumulative balance still covers it', () => {
    // periodUsageKm/periodAllowanceKm alone would look "over" (600/500), but
    // isNearLimit/isOverLimit are driven by the cumulative fields, which the
    // caller (computeRentalAllowanceStatus) would have computed as healthy.
    const { toJSON } = render(<RentalAllowanceBanner status={makeStatus({
      periodUsageKm: 600, periodAllowanceKm: 500, isNearLimit: false, isOverLimit: false,
    })} />);
    expect(toJSON()).toBeNull();
  });

  it('shows a baseline-estimated disclosure on the warning banner when the baseline was estimated', () => {
    render(<RentalAllowanceBanner
      status={makeStatus({ isNearLimit: true, baselineIsEstimated: true })}
    />);
    expect(screen.getByTestId('rental-allowance-baseline-estimated')).toBeTruthy();
  });

  it('shows a baseline-estimated disclosure on the over-limit banner when the baseline was estimated', () => {
    render(<RentalAllowanceBanner
      status={makeStatus({ isNearLimit: true, isOverLimit: true, baselineIsEstimated: true, balanceKm: -20, overageKm: 20, overageCostCents: 3000 })}
    />);
    expect(screen.getByTestId('rental-allowance-baseline-estimated')).toBeTruthy();
  });

  it('does not show a baseline-estimated disclosure when the baseline came from an explicit odometer', () => {
    render(<RentalAllowanceBanner
      status={makeStatus({ isNearLimit: true, isOverLimit: true, baselineIsEstimated: false, balanceKm: -20, overageKm: 20, overageCostCents: 3000 })}
    />);
    expect(screen.queryByTestId('rental-allowance-baseline-estimated')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npx jest __tests__/components/RentalAllowanceBanner.test.tsx`
Expected: FAIL — TypeScript error (old status shape / `onAddExpense` prop no longer matches), and the "no action button" assertions fail against the current component.

- [ ] **Step 4: Rewrite the component**

Replace `src/components/RentalAllowanceBanner.tsx` entirely with:

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import { formatMoney } from '../utils/currency';
import type { RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';

// Dashboard hero banner for rental-vehicle km allowance: silent until the
// CUMULATIVE balance hits 90% used, then a warning; once the balance goes
// negative, an over-limit banner showing the estimated cost of the
// accumulated debt. Informational only -- no action button, since (unlike
// the old per-period design) the debt can pay itself off automatically if a
// later period comes in under its own allowance; a driver who wants to log
// an out-of-pocket expense for it can still do so manually from the
// Despesas tab. currencyCode/locale are optional (default to this app's
// BRL/pt-BR fallback, matching the dashboard screen's own defaults) so
// callers that only track odometer math, not money display, don't need to
// thread them through.
export function RentalAllowanceBanner({
  status, currencyCode = 'BRL', locale = 'pt-BR',
}: {
  status: RentalAllowanceStatus | null;
  currencyCode?: string;
  locale?: string;
}) {
  const { t } = useTranslation();
  if (!status || !status.isNearLimit) return null;

  const baselineDisclosure = status.baselineIsEstimated ? (
    <Text style={s.subText} testID="rental-allowance-baseline-estimated">
      {t('rental_allowance.baseline_estimated')}
    </Text>
  ) : null;

  if (status.isOverLimit) {
    return (
      <View style={[s.banner, s.over]} testID="rental-allowance-over">
        <View style={s.textCol}>
          <Text style={s.text}>
            {t('rental_allowance.over_limit', {
              km: status.overageKm.toFixed(0),
              cost: formatMoney(status.overageCostCents, currencyCode, locale),
            })}
          </Text>
          {baselineDisclosure}
        </View>
      </View>
    );
  }

  const percent = Math.round((status.cumulativeUsageKm / status.cumulativeAllowanceKm) * 100);
  return (
    <View style={[s.banner, s.warning]} testID="rental-allowance-warning">
      <View style={s.textCol}>
        <Text style={s.text}>
          {t('rental_allowance.near_limit', {
            percent: String(percent),
            km: status.remainingKm.toFixed(0),
          })}
        </Text>
        {baselineDisclosure}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  warning: { backgroundColor: Colors.accentDim, borderColor: 'rgba(245,158,11,0.35)' },
  over: { backgroundColor: Colors.errorBg, borderColor: 'rgba(239,68,68,0.30)' },
  textCol: { flexShrink: 1, gap: 4 },
  text: { color: Colors.textPrimary, fontSize: 14, flexShrink: 1 },
  subText: { color: Colors.textSecondary, fontSize: 12, flexShrink: 1 },
});
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx jest __tests__/components/RentalAllowanceBanner.test.tsx`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add "src/components/RentalAllowanceBanner.tsx" "__tests__/components/RentalAllowanceBanner.test.tsx" "locales/pt.json" "locales/en.json" "locales/es.json" "locales/fr.json" "locales/zh.json"
git commit -m "feat: base km-allowance alerts on cumulative balance, drop auto-expense button"
```

---

### Task 5: `app/(tabs)/index.tsx` wiring — remove the dead auto-expense flow

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Modify: `src/services/expenses.ts` (delete the now-unused `hasExpenseSince`)
- Modify: `__tests__/services/expenses.test.ts` (delete its now-unused tests)

**Interfaces:**
- Consumes: `RentalAllowanceBanner` (Task 4, no longer takes `onAddExpense`/`alreadyLogged`), `RentalAllowanceStatus` (Task 2).

No new test file for this task — it's a wiring/dead-code removal in a screen component that has no existing dedicated test file (`index.tsx` is exercised via the component tests already updated in Tasks 3-4, and via the full app running). Verification for this task is: the full suite stays green, and a manual smoke check after deploy (Step 5).

- [ ] **Step 1: Check whether `hasExpenseSince` has any other callers**

Run: `grep -rn "hasExpenseSince" --include="*.ts" --include="*.tsx" "app-motorista" | grep -v node_modules`

Expected: only 3 matches — its definition in `src/services/expenses.ts`, its call in `app/(tabs)/index.tsx` (about to be removed below), and its own test file `__tests__/services/expenses.test.ts` (about to be removed below). If there turns out to be a 4th caller that wasn't expected, STOP and re-scope this step — do not delete `hasExpenseSince` if anything else still uses it.

- [ ] **Step 2: Remove the auto-expense wiring from `app/(tabs)/index.tsx`**

Remove the `hasExpenseSince` import (leave `addExpense` — it's still used by other flows in this file):

```ts
// before
import { addExpense, hasExpenseSince } from '@/src/services/expenses';
// after
import { addExpense } from '@/src/services/expenses';
```

Remove these two state declarations (they only fed the deleted flow):

```ts
// delete these two lines entirely
const [overageExpenseAdded, setOverageExpenseAdded] = useState(false);
const [overageAlreadyLogged, setOverageAlreadyLogged] = useState(false);
```

In `loadData`, remove the `overageAlreadyLoggedP` block (the comment + const, right after `rentalStatusP` is defined):

```ts
// delete this whole block (comment included)
// Only over the limit does the "Adicionar como despesa" button (and its
// duplicate-guard) matter, so this stays a no-op query the rest of the
// time. Failure here must not block the dashboard load either -- worst
// case the button is offered again and handleAddOverageExpense's own
// guard catches the duplicate before insert.
const overageAlreadyLoggedP: Promise<boolean> = rentalStatusP.then(async status => {
  if (!status || !status.isOverLimit) return false;
  try {
    return await hasExpenseSince(uid, 'km_excedente', status.periodStart.toISOString().slice(0, 10));
  } catch {
    return false;
  }
});
```

Remove `overageAlreadyLoggedData` from the `Promise.all` destructure and `overageAlreadyLoggedP` from the array passed to it:

```ts
// before
const [todaySummary, buckets, monthly, active, goalData, consumption, vehicleData, mTotals, wTotals, history, streakCount, mood, prevGross, prevWeekGrossData, platforms, weekPlatforms, dayPlatforms, rentalStatusData, overageAlreadyLoggedData] = await Promise.all([
  ...
  rentalStatusP,
  overageAlreadyLoggedP,
]);
// after
const [todaySummary, buckets, monthly, active, goalData, consumption, vehicleData, mTotals, wTotals, history, streakCount, mood, prevGross, prevWeekGrossData, platforms, weekPlatforms, dayPlatforms, rentalStatusData] = await Promise.all([
  ...
  rentalStatusP,
]);
```

Remove the now-dangling setter call:

```ts
// delete this line
setOverageAlreadyLogged(overageAlreadyLoggedData);
```

Delete the whole `handleAddOverageExpense` function, including its leading comment block:

```ts
// delete this entire block, from the comment through the function's closing brace
// "Adicionar como despesa" on the over-limit rental banner: logs the
// estimated overage cost as a one-off expense. Success feedback follows
// the same inline checkmark-banner pattern as profile_saved/settings_saved
// in more.tsx (auto-hides after 3s) rather than introducing a toast lib.
// Re-checks for an existing km_excedente expense this period right before
// inserting (rather than trusting only the loadData-computed
// overageAlreadyLogged flag) so a second tap in the same session -- before
// loadData has re-run -- can't still slip a duplicate through.
async function handleAddOverageExpense(overageCostCents: number) {
  if (!userId || !rentalStatus) return;
  try {
    const alreadyLogged = await hasExpenseSince(
      userId, 'km_excedente', rentalStatus.periodStart.toISOString().slice(0, 10)
    );
    if (alreadyLogged) {
      setOverageAlreadyLogged(true);
      return;
    }
    await addExpense({
      user_id: userId,
      category: 'km_excedente',
      amount_cents: overageCostCents,
      expense_date: new Date().toISOString().slice(0, 10),
      description: null,
      recurring: false,
      recurring_frequency: null,
      ends_at: null,
    });
    setOverageExpenseAdded(true);
    setTimeout(() => setOverageExpenseAdded(false), 3000);
    await loadData(userId).catch(() => {});
  } catch (e) {
    console.error('addExpense (km_excedente) failed:', e);
    setFetchError(true);
  }
}
```

Update the `<RentalAllowanceBanner>` call site to drop the removed props:

```tsx
// before
<RentalAllowanceBanner
  status={rentalStatus}
  onAddExpense={handleAddOverageExpense}
  alreadyLogged={overageAlreadyLogged}
  currencyCode={currencyCode}
  locale={locale}
/>
// after
<RentalAllowanceBanner
  status={rentalStatus}
  currencyCode={currencyCode}
  locale={locale}
/>
```

Delete the now-dead success-banner JSX block right after it:

```tsx
// delete this entire block
{overageExpenseAdded && (
  <View style={styles.successBanner}>
    <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
    <Text style={styles.successText}>{t('rental_allowance.expense_added')}</Text>
  </View>
)}
```

Delete the now-unused `successBanner`/`successText` entries from the file's `StyleSheet.create` block (confirm with the grep in Step 1's spirit — `grep -n "successBanner\|successText" "app/(tabs)/index.tsx"` — that nothing else in this same file references them before deleting; as of this plan's writing they're used only by the block just removed):

```ts
// delete these two lines from the styles object
successBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.successBg, borderRadius: Radius.input, padding: Spacing.sm, marginBottom: Spacing.md, borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)' },
successText: { color: Colors.success, fontSize: 14, fontWeight: '500' },
```

Note: `fireRentalAllowanceNearLimitNotification(...)`, called from `if (rentalStatusData?.isNearLimit) { ... }` a few lines above the deleted `setOverageAlreadyLogged` call, needs NO change — it already just reads `.isNearLimit`/`.periodStart` off the status object, and automatically inherits the new cumulative-balance meaning of `isNearLimit` from Task 2. Leave it exactly as-is.

- [ ] **Step 3: Remove `hasExpenseSince` from `src/services/expenses.ts`**

Delete the function and its leading comment (confirmed as safe to remove by Step 1's grep):

```ts
// delete this entire block
// Used to guard against duplicate auto-created expenses (e.g. the
// "Adicionar como despesa" rental km-overage action): true when this user
// already has a `category` expense dated on/after `sinceDate` (YYYY-MM-DD).
export async function hasExpenseSince(
  userId: string,
  category: string,
  sinceDate: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('expenses')
    .select('id')
    .eq('user_id', userId)
    .eq('category', category)
    .gte('expense_date', sinceDate)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
```

- [ ] **Step 4: Remove `hasExpenseSince`'s tests from `__tests__/services/expenses.test.ts`**

Open the file, find the `describe('hasExpenseSince', ...)` block (the one containing the 3 `km_excedente`-mocking tests read earlier in this plan's research), and delete that whole `describe` block. Leave every other describe block in the file untouched.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: PASS, full suite (233 existing tests minus the 3 deleted `hasExpenseSince` tests, plus the new tests from Tasks 1-4 — confirm the final count in the output and sanity-check it against that arithmetic).

- [ ] **Step 6: Commit**

```bash
git add "app/(tabs)/index.tsx" "src/services/expenses.ts" "__tests__/services/expenses.test.ts"
git commit -m "chore: remove dead auto-expense flow now that km-allowance debt rolls forward"
```

---

### Task 6: Deploy

**Files:** none (verification + deploy only)

- [ ] **Step 1: Run the full suite one more time from a clean state**

Run: `npx jest`
Expected: PASS, 0 failures.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit` (or the project's existing type-check script if `package.json` defines one — check `package.json`'s `scripts` block first)
Expected: no errors. Pay particular attention to any remaining reference to `RentalAllowanceStatus.usageKm` or `.percentUsed` anywhere in the codebase outside the files already changed in Tasks 1-5 — those two fields no longer exist on the type.

- [ ] **Step 3: Deploy to production**

```bash
vercel --prod
```

Run from inside `app-motorista/`. Confirm the deployment promotes/aliases to `app.paldrivy.com` and reaches `READY` status before reporting completion.

- [ ] **Step 4: Update the Obsidian project log**

Append a dated entry to `D:\Obsidian\Claude Code\PalDrivy.md` (`## Sessão 2026-08-15 (parte N)`, following the existing convention in that file) summarizing: the cumulative-balance redesign, the removed auto-expense flow, and the deploy. Do not create a new build/AAB entry here — this task is web-only; a native AAB rebuild (if wanted) is a separate, explicit follow-up.
