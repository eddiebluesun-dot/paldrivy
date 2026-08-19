# Rental KM Allowance — Cycle Generalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the daily-linear km-allowance accrual (2026-08-18) with the correct block-per-cycle-with-carryover model, and generalize it to daily/weekly/monthly cycles with a configurable week-start day and a null-amount "unlimited/informational" mode — reproducing the owner's hand-verified real numbers exactly (896/+179, 1625/+59, 519/+1045).

**Architecture:** A new pure function `getAllowanceCycleBounds` (in `rentalKmAllowanceUtils.ts`, separate from the untouched `getPeriodBounds`) computes which cycle "now" falls in and its 0-based index since contract start. `computeRentalAllowanceStatus` is rewritten to grant a cycle's allowance in full at cycle start (prorating only cycle 0, and only for weekly), accumulate it via `cycleIndex`, and never reset the running balance. A DB migration adds `rental_week_start_day` and widens `rental_km_allowance_period` to `daily|weekly|monthly` (dropping `unlimited`, which becomes "amount is null" instead).

**Tech Stack:** React Native/Expo, TypeScript, Jest + @testing-library/react-native, Supabase Postgres (project `ucxkvxqpkknxotbfxgeu`).

## Global Constraints

- Vehicle under verification: `vehicle_id = 4483a9f5-10b0-442c-9732-415a1dc27264`, `user_id = db85eea7-8cd7-464d-ba68-05f1e8a15560`, contract start `2026-08-05`, contract start odometer `18332000`, weekly allowance `1505` km (correcting stale `1500`), week start day = Monday (`1`).
- Confirmed via SQL 2026-08-19: existing check constraint name is `vehicles_rental_km_allowance_period_check`; `rental_week_start_day` column does not exist yet; **zero** rows currently have `rental_km_allowance_period = 'unlimited'` (1 row is `'weekly'`, 8 are `null`) — no data-migration decision needed for that value.
- `getPeriodBounds`/`PeriodBounds` in `src/utils/rentalKmAllowanceUtils.ts` are used by `src/utils/recurringExpenseAllocationUtils.ts` and MUST NOT be modified, renamed, or removed. The new cycle-bounds function is a separate export.
- `RentalAllowancePeriod` (old, `'weekly'|'monthly'|'unlimited'`) stays exactly as-is in `rentalKmAllowanceUtils.ts` since it's `getPeriodBounds`'s own param type — do not touch it. The app-wide `RentalAllowancePeriod` in `src/types/index.ts` (used by `Vehicle.rental_km_allowance_period`, `register.tsx`, `more.tsx`) becomes `'daily' | 'weekly' | 'monthly'`.
- Every new/changed user-facing string needs keys in all 6 locale files: `locales/pt.json`, `en.json`, `en-GB.json`, `es.json`, `fr.json`, `zh.json`.
- Jest suite must be 100% green before every commit. Work directly on `master` (authorized), no worktree, no `finishing-a-development-branch` step at the end.
- LGPD: no changes in this feature touch consent/export/deletion flows — out of scope, don't add any.

---

## File Structure

- Modify: `src/types/index.ts` — `RentalAllowancePeriod` union, `Vehicle.rental_week_start_day`.
- Modify: `src/utils/rentalKmAllowanceUtils.ts` — add `AllowanceCycleType`, `CycleBounds`, `getAllowanceCycleBounds`; rewrite `RentalAllowanceStatus`, `computeRentalAllowanceStatus`; remove now-dead `computeCumulativeAllowanceKm`/`daysInMonthUTC`; keep `getPeriodBounds`/`PeriodBounds`/`mondayOf`/`addMonthClamped`/`RentalAllowancePeriod` (old) untouched.
- Modify: `__tests__/utils/rentalKmAllowanceUtils.test.ts` — new/updated tests, including the 3 real-data regression checkpoints.
- Modify: `src/services/rentalAllowance.ts` — new call signature, no more `'unlimited'` early return.
- Modify: `__tests__/services/rentalAllowance.test.ts` — update the "unlimited" test to the new "null amount" shape.
- Modify: `src/components/RentalAllowanceExtractCard.tsx` — daily label, informational/uncapped rendering, current-cycle headline.
- Modify: `__tests__/components/RentalAllowanceExtractCard.test.tsx` — update fixture + new cases.
- Modify: `__tests__/components/RentalAllowanceBanner.test.tsx` — add an uncapped-status regression case (component itself needs no code change).
- Modify: `locales/pt.json`, `en.json`, `en-GB.json`, `es.json`, `fr.json`, `zh.json` — new keys.
- Modify: `app/(auth)/register.tsx` — cycle picker, week-start-day picker, always-visible optional amount/excess fields.
- Modify: `app/(tabs)/more.tsx` — same, in `VehicleModal`.
- Modify: `app/(tabs)/index.tsx` — query column, notification dedup key via `getAllowanceCycleBounds`.
- Migration (via `mcp__claude_ai_Supabase__apply_migration`): add `rental_week_start_day`, widen period check constraint.
- Data fix (via `mcp__claude_ai_Supabase__execute_sql`): Eddie's vehicle row.

---

### Task 1: Database migration

**Files:**
- No local file — applied directly via MCP tool.

**Interfaces:**
- Produces: `vehicles.rental_week_start_day smallint null`, `vehicles_rental_km_allowance_period_check` allowing `daily|weekly|monthly` (not `unlimited`).

- [ ] **Step 1: Apply the migration**

Call `mcp__claude_ai_Supabase__apply_migration` with `project_id: "ucxkvxqpkknxotbfxgeu"`, `name: "rental_km_allowance_cycle_generalization"`, and:

```sql
-- 1. Add the new column + range constraint.
alter table public.vehicles add column rental_week_start_day smallint;
alter table public.vehicles add constraint rental_week_start_day_range
  check (rental_week_start_day is null or rental_week_start_day between 0 and 6);

-- 2. Backfill existing weekly contracts to Monday (today's only supported
--    behavior), so nothing silently changes for the one contract already tracked.
update public.vehicles
  set rental_week_start_day = 1
  where rental_km_allowance_period = 'weekly';

-- 3. Widen the period check constraint: drop 'unlimited', add 'daily'.
--    Verified 2026-08-19: 0 rows have rental_km_allowance_period = 'unlimited'
--    today (1 row 'weekly', 8 null) -- no data migration needed for that value.
alter table public.vehicles drop constraint vehicles_rental_km_allowance_period_check;
alter table public.vehicles add constraint vehicles_rental_km_allowance_period_check
  check (rental_km_allowance_period is null or rental_km_allowance_period in ('daily', 'weekly', 'monthly'));
```

- [ ] **Step 2: Verify the migration**

Call `mcp__claude_ai_Supabase__execute_sql` with `project_id: "ucxkvxqpkknxotbfxgeu"`:

```sql
select column_name, data_type from information_schema.columns
  where table_schema='public' and table_name='vehicles' and column_name='rental_week_start_day';
select conname, pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.vehicles'::regclass and contype='c'
  and conname in ('rental_week_start_day_range','vehicles_rental_km_allowance_period_check');
select id, rental_km_allowance_period, rental_week_start_day from public.vehicles
  where rental_km_allowance_period is not null;
```

Expected: `rental_week_start_day` is `smallint`; both constraints show the new definitions; Eddie's vehicle row (`4483a9f5-...`) shows `rental_km_allowance_period='weekly'`, `rental_week_start_day=1`.

- [ ] **Step 3: Commit note**

No local diff to commit for this task (schema-only). Proceed to Task 2.

---

### Task 2: Update shared types

**Files:**
- Modify: `src/types/index.ts:8` and `:54-59`

**Interfaces:**
- Produces: `RentalAllowancePeriod = 'daily' | 'weekly' | 'monthly'`; `Vehicle.rental_week_start_day?: number | null`.

- [ ] **Step 1: Edit the union type**

In `src/types/index.ts` line 8, change:

```ts
export type RentalAllowancePeriod = 'weekly' | 'monthly' | 'unlimited';
```

to:

```ts
export type RentalAllowancePeriod = 'daily' | 'weekly' | 'monthly';
```

- [ ] **Step 2: Add the new Vehicle field**

In the `Vehicle` interface, right after `rental_km_excess_rate_cents?: number | null;` (currently line 58), add:

```ts
  rental_week_start_day?: number | null; // 0=Sunday..6=Saturday; only meaningful when rental_km_allowance_period === 'weekly'
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: New errors appear at every call site still using `'unlimited'` as a `RentalAllowancePeriod` value (`app/(auth)/register.tsx`, `app/(tabs)/more.tsx`) — these are fixed in Tasks 9-10. No errors should appear anywhere else yet (utils file has its own independent `RentalAllowancePeriod` declaration, untouched).

- [ ] **Step 4: Commit**

```bash
git add "src/types/index.ts"
git commit -m "feat: widen RentalAllowancePeriod to daily/weekly/monthly, add week-start-day field"
```

---

### Task 3: `getAllowanceCycleBounds` (new cycle-bounds function)

**Files:**
- Modify: `src/utils/rentalKmAllowanceUtils.ts`
- Test: `__tests__/utils/rentalKmAllowanceUtils.test.ts`

**Interfaces:**
- Consumes: nothing new (pure function, no imports needed beyond what the file already doesn't have).
- Produces: `AllowanceCycleType = 'daily' | 'weekly' | 'monthly'`, `CycleBounds { cycleStart: Date; cycleEnd: Date; cycleIndex: number }`, `getAllowanceCycleBounds(contractStartDate: string, cycleType: AllowanceCycleType, weekStartDay: number | null, now: Date): CycleBounds`.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/utils/rentalKmAllowanceUtils.test.ts` (new `describe` block, keep the existing `getPeriodBounds`/`computeRentalAllowanceStatus` blocks untouched for now):

```ts
import { getAllowanceCycleBounds } from '@/src/utils/rentalKmAllowanceUtils';

describe('getAllowanceCycleBounds', () => {
  it('daily: cycleIndex is days elapsed since contract start, cycle is exactly 1 day', () => {
    const bounds = getAllowanceCycleBounds('2026-08-05', 'daily', null, new Date('2026-08-08T15:00:00Z'));
    expect(bounds).toEqual({
      cycleStart: new Date('2026-08-08T00:00:00.000Z'),
      cycleEnd: new Date('2026-08-09T00:00:00.000Z'),
      cycleIndex: 3,
    });
  });

  it('monthly: fixed 30-day rolling window anchored to contractStartDate, no calendar-month clamping', () => {
    // 31 days after 2026-08-05 -> day 31 falls in the SECOND 30-day block (days 31-60), cycleIndex 1.
    const bounds = getAllowanceCycleBounds('2026-08-05', 'monthly', null, new Date('2026-09-05T12:00:00Z'));
    expect(bounds).toEqual({
      cycleStart: new Date('2026-09-04T00:00:00.000Z'), // contractStart + 30 days
      cycleEnd: new Date('2026-10-04T00:00:00.000Z'),
      cycleIndex: 1,
    });
  });

  it('weekly: cycle 0 contains contractStartDate regardless of weekStartDay, even when the week starts BEFORE the contract', () => {
    // Contract started Wed 2026-08-05, week starts Monday -> cycle 0 is [Aug 3, Aug 10).
    const bounds = getAllowanceCycleBounds('2026-08-05', 'weekly', 1, new Date('2026-08-05T12:00:00Z'));
    expect(bounds).toEqual({
      cycleStart: new Date('2026-08-03T00:00:00.000Z'),
      cycleEnd: new Date('2026-08-10T00:00:00.000Z'),
      cycleIndex: 0,
    });
  });

  it('weekly: cycleIndex advances by 1 each configured week-start weekday, regardless of contract start weekday', () => {
    // "now" = 2026-08-19 (Wednesday) -> current week is [Aug 17, Aug 24), 2 full weeks after
    // the contract-start week (which began Mon Aug 3) -> cycleIndex 2.
    const bounds = getAllowanceCycleBounds('2026-08-05', 'weekly', 1, new Date('2026-08-19T12:00:00Z'));
    expect(bounds).toEqual({
      cycleStart: new Date('2026-08-17T00:00:00.000Z'),
      cycleEnd: new Date('2026-08-24T00:00:00.000Z'),
      cycleIndex: 2,
    });
  });

  it('weekly: defaults weekStartDay to Monday (1) when null', () => {
    const withNull = getAllowanceCycleBounds('2026-08-05', 'weekly', null, new Date('2026-08-19T12:00:00Z'));
    const withMonday = getAllowanceCycleBounds('2026-08-05', 'weekly', 1, new Date('2026-08-19T12:00:00Z'));
    expect(withNull).toEqual(withMonday);
  });

  it('weekly: a different week-start day (e.g. Sunday=0) shifts the boundary', () => {
    // now = Sunday 2026-08-16 -> with week starting Sunday, "now" itself IS the boundary.
    const bounds = getAllowanceCycleBounds('2026-08-05', 'weekly', 0, new Date('2026-08-16T12:00:00Z'));
    expect(bounds.cycleStart).toEqual(new Date('2026-08-16T00:00:00.000Z'));
    expect(bounds.cycleEnd).toEqual(new Date('2026-08-23T00:00:00.000Z'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts -t "getAllowanceCycleBounds"`
Expected: FAIL — `getAllowanceCycleBounds is not a function` (or module has no export).

- [ ] **Step 3: Implement**

In `src/utils/rentalKmAllowanceUtils.ts`, add after the existing `getPeriodBounds` function (do not touch anything above it), before the `RentalAllowanceStatus` interface:

```ts
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
```

Note: `DAY_MS` already exists at module scope (line 100 of the current file) — reuse it, don't redeclare.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts -t "getAllowanceCycleBounds"`
Expected: PASS, all 6 cases.

- [ ] **Step 5: Commit**

```bash
git add "src/utils/rentalKmAllowanceUtils.ts" "__tests__/utils/rentalKmAllowanceUtils.test.ts"
git commit -m "feat: add getAllowanceCycleBounds for configurable daily/weekly/monthly km-allowance cycles"
```

---

### Task 4: Rewrite `computeRentalAllowanceStatus` (block-per-cycle carryover + real-data regression)

**Files:**
- Modify: `src/utils/rentalKmAllowanceUtils.ts`
- Test: `__tests__/utils/rentalKmAllowanceUtils.test.ts`

**Interfaces:**
- Consumes: `getAllowanceCycleBounds` from Task 3.
- Produces: rewritten `RentalAllowanceStatus` (allowance-related fields nullable, new `currentCycleUsageKm`), rewritten `computeRentalAllowanceStatus(params: { contractStartDate; contractStartOdometerMeters; cycleType: AllowanceCycleType; weekStartDay: number | null; allowanceAmountKm: number | null; excessRateCents: number | null; readings: OdometerReading[]; now: Date }): RentalAllowanceStatus | null`.

- [ ] **Step 1: Write the failing tests — real-data fixture + the 3 verification checkpoints**

Replace the ENTIRE `describe('computeRentalAllowanceStatus', ...)` block in `__tests__/utils/rentalKmAllowanceUtils.test.ts` with the following (this removes the old daily-linear-era assertions, which described the now-reverted model, and replaces them with the block-carryover model). Keep the `getPeriodBounds` describe block above it completely untouched.

```ts
import { computeRentalAllowanceStatus, type OdometerReading } from '@/src/utils/rentalKmAllowanceUtils';

// Real production odometer readings for Eddie's rental Kwid (vehicle_id
// 4483a9f5-10b0-442c-9732-415a1dc27264), pulled 2026-08-19 via Supabase
// execute_sql against public.shifts and public.fuel_entries, built exactly
// as src/services/rentalAllowance.ts assembles readings (shift start tagged
// with started_at, shift end tagged with ended_at, fuel entries tagged with
// filled_at). Contract start 2026-08-05 at odometer 18332000. This is the
// dataset the owner hand-verified against his real Localiza contract --
// see docs/superpowers/specs/2026-08-19-km-allowance-cycle-generalization-design.md.
const EDDIE_REAL_READINGS: OdometerReading[] = [
  { odometerMeters: 18376000, at: '2026-08-06T08:48:00.000Z' },
  { odometerMeters: 18626000, at: '2026-08-06T21:15:00.000Z' },
  { odometerMeters: 18643000, at: '2026-08-07T12:42:50.320Z' },
  { odometerMeters: 18611000, at: '2026-08-07T15:00:00.000Z' },
  { odometerMeters: 18853000, at: '2026-08-07T20:33:42.634Z' },
  { odometerMeters: 18861000, at: '2026-08-08T09:04:42.313Z' },
  { odometerMeters: 18925000, at: '2026-08-08T15:00:00.000Z' },
  { odometerMeters: 19070000, at: '2026-08-08T16:44:24.373Z' },
  { odometerMeters: 19088000, at: '2026-08-09T10:36:00.000Z' },
  { odometerMeters: 19228000, at: '2026-08-09T15:21:00.000Z' },
  { odometerMeters: 19228000, at: '2026-08-10T09:54:03.178Z' },
  { odometerMeters: 19300000, at: '2026-08-10T12:51:02.482Z' },
  { odometerMeters: 19302000, at: '2026-08-10T14:57:00.000Z' },
  { odometerMeters: 19302000, at: '2026-08-10T15:00:00.000Z' },
  { odometerMeters: 19231000, at: '2026-08-10T15:00:00.000Z' },
  { odometerMeters: 19474000, at: '2026-08-10T22:06:00.000Z' },
  { odometerMeters: 19474000, at: '2026-08-11T08:40:00.000Z' },
  { odometerMeters: 19646000, at: '2026-08-11T15:00:00.000Z' },
  { odometerMeters: 19818000, at: '2026-08-11T21:46:00.000Z' },
  { odometerMeters: 19818000, at: '2026-08-12T09:13:00.000Z' },
  { odometerMeters: 20034000, at: '2026-08-12T15:00:00.000Z' },
  { odometerMeters: 19841000, at: '2026-08-12T15:00:00.000Z' },
  { odometerMeters: 20107000, at: '2026-08-12T22:06:00.000Z' },
  { odometerMeters: 20107000, at: '2026-08-13T09:23:25.776Z' },
  { odometerMeters: 20271000, at: '2026-08-13T15:00:00.000Z' },
  { odometerMeters: 20274000, at: '2026-08-13T16:58:39.625Z' },
  { odometerMeters: 20282000, at: '2026-08-13T18:47:00.000Z' },
  { odometerMeters: 20365000, at: '2026-08-13T22:30:00.000Z' },
  { odometerMeters: 20365000, at: '2026-08-14T09:06:00.000Z' },
  { odometerMeters: 20566000, at: '2026-08-14T16:36:00.000Z' },
  { odometerMeters: 20584000, at: '2026-08-15T08:57:00.000Z' },
  { odometerMeters: 20586000, at: '2026-08-15T15:00:00.000Z' },
  { odometerMeters: 20739000, at: '2026-08-15T15:46:00.000Z' },
  { odometerMeters: 20853000, at: '2026-08-17T12:44:39.292Z' },
  { odometerMeters: 20833000, at: '2026-08-17T15:00:00.000Z' },
  { odometerMeters: 21126000, at: '2026-08-17T21:55:48.192Z' },
  { odometerMeters: 21143000, at: '2026-08-18T12:15:00.000Z' },
  { odometerMeters: 21167000, at: '2026-08-18T15:00:00.000Z' },
  { odometerMeters: 21372000, at: '2026-08-18T22:04:00.000Z' },
];

function eddieStatusAt(now: Date, readingsCutoff: Date = now) {
  return computeRentalAllowanceStatus({
    contractStartDate: '2026-08-05',
    contractStartOdometerMeters: 18332000,
    cycleType: 'weekly',
    weekStartDay: 1,
    allowanceAmountKm: 1505,
    excessRateCents: 75,
    readings: EDDIE_REAL_READINGS.filter(r => new Date(r.at).getTime() <= readingsCutoff.getTime()),
    now,
  });
}

describe('computeRentalAllowanceStatus — real-data regression (Eddie, vehicle 4483a9f5, hand-verified against the Localiza contract)', () => {
  it('week 1 (partial, 05-09/08): 896 km used, 1075 km allowance (1505 * 5/7 prorated), +179 balance', () => {
    const status = eddieStatusAt(new Date('2026-08-09T20:00:00.000Z'));
    expect(status?.cumulativeUsageKm).toBe(896);
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(1075);
    expect(status?.balanceKm).toBeCloseTo(179);
  });

  it('week 2 usage bridges the weekend gap to 1625 km, NOT 1511 km (regression: a trailing gap belongs to the cycle it happened in, not the one that reveals it)', () => {
    const week1End = eddieStatusAt(new Date('2026-08-09T20:00:00.000Z'));

    // Naive/WRONG snapshot: only data available strictly within week 2's own
    // calendar bounds (Sunday night, before week 3's Monday reading exists).
    // This reproduces the exact 1511 undercount the owner flagged as wrong.
    const naiveWeek2Close = eddieStatusAt(new Date('2026-08-16T20:00:00.000Z'));
    expect(naiveWeek2Close!.cumulativeUsageKm - week1End!.cumulativeUsageKm).toBe(1511);

    // Correct snapshot: once week 3's first reading (Mon 2026-08-17 12:44
    // shift start) is known, the SAME subtraction yields the true 1625 --
    // the 114km weekend gap is now counted, attributed back to week 2.
    const onceWeek3RevealsIt = eddieStatusAt(new Date('2026-08-17T13:00:00.000Z'));
    expect(onceWeek3RevealsIt!.cumulativeUsageKm).toBe(2521); // 896 + 1625
    expect(onceWeek3RevealsIt!.cumulativeUsageKm - week1End!.cumulativeUsageKm).toBe(1625);

    // The owner's own manual ledger: prevBalance + week2Allowance - week2Usage.
    const week2Balance = 179 + 1505 - 1625;
    expect(week2Balance).toBe(59);
  });

  it('week 3 (open, live as of 2026-08-19): 519 km current-cycle usage, 3040 km cumulative usage, +1045 cumulative balance', () => {
    const status = eddieStatusAt(new Date('2026-08-19T12:00:00.000Z'));
    expect(status?.cumulativeUsageKm).toBe(3040); // 896 + 1625 + 519
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(4085); // 1075 + 1505*2
    expect(status?.balanceKm).toBeCloseTo(1045);
    expect(status?.currentCycleUsageKm).toBe(519); // 21372000 - 20853000 (first reading of week 3)
    expect(status?.isOverLimit).toBe(false);
  });
});

describe('computeRentalAllowanceStatus — cycle mechanics', () => {
  it('daily: full daily allowance granted at each day boundary, no proration ever (cycle 0 anchors exactly to contractStartDate)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      cycleType: 'daily',
      weekStartDay: null,
      allowanceAmountKm: 200,
      excessRateCents: 100,
      readings: [{ odometerMeters: 450_000, at: '2026-08-07T10:00:00Z' }], // day index 2 (Aug5=0,Aug6=1,Aug7=2)
      now: new Date('2026-08-07T12:00:00Z'),
    });
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(600); // 200 * (cycleIndex 2 + 1 cycles) = 200*3
    expect(status?.cumulativeUsageKm).toBe(450);
    expect(status?.balanceKm).toBeCloseTo(150);
  });

  it('monthly: fixed 30-day block, no calendar clamping -- full allowance granted at day 30, not varying by month length', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-01-30',
      contractStartOdometerMeters: 0,
      cycleType: 'monthly',
      weekStartDay: null,
      allowanceAmountKm: 300,
      excessRateCents: 100,
      readings: [{ odometerMeters: 100_000, at: '2026-03-02T00:00:00Z' }], // 31 days after Jan 30 -> cycleIndex 1
      now: new Date('2026-03-02T00:00:00Z'),
    });
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(600); // cycle 0 (300, never prorated) + cycle 1 (300)
    expect(status?.cumulativeUsageKm).toBe(100);
  });

  it('uncapped/informational mode: allowanceAmountKm null returns cumulative + current-cycle usage but no balance/limit fields', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      cycleType: 'weekly',
      weekStartDay: 1,
      allowanceAmountKm: null,
      excessRateCents: null,
      readings: [
        { odometerMeters: 18332000, at: '2026-08-05T09:00:00Z' },
        { odometerMeters: 18459000, at: '2026-08-19T09:00:00Z' },
      ],
      now: new Date('2026-08-19T12:00:00Z'),
    });
    expect(status).not.toBeNull();
    expect(status?.cumulativeUsageKm).toBe(127);
    expect(status?.currentCycleUsageKm).toBe(127);
    expect(status?.cumulativeAllowanceKm).toBeNull();
    expect(status?.balanceKm).toBeNull();
    expect(status?.overageKm).toBeNull();
    expect(status?.overageCostCents).toBeNull();
    expect(status?.remainingKm).toBeNull();
    expect(status?.isNearLimit).toBe(false);
    expect(status?.isOverLimit).toBe(false);
  });

  it('uses the explicit contract-start odometer as the baseline', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      cycleType: 'weekly',
      weekStartDay: 1,
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [
        { odometerMeters: 18332000, at: '2026-08-05T09:00:00Z' },
        { odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' },
      ],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status?.cumulativeUsageKm).toBe(290);
    expect(status?.baselineIsEstimated).toBe(false);
  });

  it('falls back to the earliest-ever reading as the baseline when no explicit start odometer is given', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: null,
      cycleType: 'weekly',
      weekStartDay: 1,
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

  it('flags over-limit once the cumulative balance goes negative, with an overage cost estimate', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      cycleType: 'weekly',
      weekStartDay: 1,
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [{ odometerMeters: 520_000, at: '2026-08-05T18:00:00Z' }],
      now: new Date('2026-08-05T19:00:00Z'),
    });
    // cycle 0 for a Wed contract start with Monday week-start is prorated 5/7 -> 500*5/7 ~= 357.14
    expect(status?.isOverLimit).toBe(true);
    expect(status?.balanceKm).toBeCloseTo((500 * 5) / 7 - 520);
    expect(status?.overageKm).toBeCloseTo(520 - (500 * 5) / 7);
    expect(status?.overageCostCents).toBe(Math.round((520 - (500 * 5) / 7) * 150));
  });

  it('isNearLimit fires at >=90% cumulative usage', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 0,
      cycleType: 'weekly',
      weekStartDay: 1,
      allowanceAmountKm: 700,
      excessRateCents: 150,
      readings: [{ odometerMeters: 320_000, at: '2026-08-05T18:00:00Z' }], // cycle0 allowance = 700*5/7 = 500
      now: new Date('2026-08-05T19:00:00Z'),
    });
    expect(status?.cumulativeAllowanceKm).toBeCloseTo(500);
    expect(status?.isNearLimit).toBe(true);
    expect(status?.isOverLimit).toBe(false);
  });

  it('returns null when there are no readings at all', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: 18332000,
      cycleType: 'weekly',
      weekStartDay: 1,
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings: [],
      now: new Date('2026-08-07T09:00:00Z'),
    });
    expect(status).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts`
Expected: FAIL — `computeRentalAllowanceStatus` still has the old signature/behavior (TS errors on `cycleType`/`weekStartDay` not existing, or wrong runtime values).

- [ ] **Step 3: Implement the rewrite**

In `src/utils/rentalKmAllowanceUtils.ts`, delete `computeCumulativeAllowanceKm` and `daysInMonthUTC` entirely (both are dead once this rewrite lands — `daysInMonthUTC` is not used by `getPeriodBounds`, only by the function being replaced). Replace the `RentalAllowanceStatus` interface and `computeRentalAllowanceStatus` function with:

```ts
export interface RentalAllowanceStatus {
  allowanceAmountKm: number | null;   // null = uncapped/informational mode
  allowancePeriod: AllowanceCycleType;

  baselineMeters: number;
  baselineIsEstimated: boolean;

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
  // which is correct for any cycle after the first; cycle 0 can't hit this
  // fallback because sorted.length > 0 is already guaranteed and cycle 0's
  // bounds always start at-or-before contractStartDate.
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts`
Expected: PASS — all tests including the `getPeriodBounds` block (untouched) and the new real-data regression checkpoints (896/+179, the 1511-vs-1625 contrast, 519/+1045).

If the week-2 test does NOT show `1625` (i.e. still shows `1511`), STOP — do not adjust the expected numbers. Re-check `currentCycle`/`cycle0` computation and the `readings` filter in `eddieStatusAt`; the bug is almost certainly in cutoff timing, not the formula.

- [ ] **Step 5: Full utils test file + repo-wide type check**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts __tests__/utils/recurringExpenseAllocationUtils.test.ts && npx tsc --noEmit`
Expected: PASS (confirms `getPeriodBounds` and `recurringExpenseAllocationUtils.ts` are unaffected). `tsc` errors, if any, should only be the known pending ones in `register.tsx`/`more.tsx` from Task 2.

- [ ] **Step 6: Commit**

```bash
git add "src/utils/rentalKmAllowanceUtils.ts" "__tests__/utils/rentalKmAllowanceUtils.test.ts"
git commit -m "feat: rewrite computeRentalAllowanceStatus to block-per-cycle carryover, verified against real production data"
```

---

### Task 5: Update `rentalAllowance.ts` service

**Files:**
- Modify: `src/services/rentalAllowance.ts`
- Modify: `__tests__/services/rentalAllowance.test.ts`

**Interfaces:**
- Consumes: `computeRentalAllowanceStatus` (new signature, Task 4).
- Produces: `getRentalAllowanceStatus(vehicle: Vehicle, now?: Date): Promise<RentalAllowanceStatus | null>` (signature unchanged externally).

- [ ] **Step 1: Update the failing test first**

In `__tests__/services/rentalAllowance.test.ts`, replace the test `'returns null for unlimited allowance, without querying'` with:

```ts
  it('returns a status with null allowance fields (not null itself) when allowance amount is not set, without needing a special-case query', async () => {
    const vehicle = mockVehicle({ rental_km_allowance_amount: null, rental_km_excess_rate_cents: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'shifts') {
        return { select: () => ({ eq: () => ({ eq: () => ({ lte: () => Promise.resolve({
          data: [{ odometer_start_meters: 18332000, odometer_end_meters: 18459000, started_at: '2026-08-19T08:00:00Z' }],
        }) }) }) }) };
      }
      if (table === 'fuel_entries') {
        return { select: () => ({ eq: () => ({ eq: () => ({ lte: () => Promise.resolve({ data: [] }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const result = await getRentalAllowanceStatus(vehicle, new Date('2026-08-19T12:00:00Z'));
    expect(result).not.toBeNull();
    expect(result?.cumulativeAllowanceKm).toBeNull();
    expect(result?.balanceKm).toBeNull();
  });
```

Also update `mockVehicle`'s default `rental_km_allowance_period` — it's already `'weekly'`, which is still valid, but add `rental_week_start_day: 1` to the returned object so the fixture matches the real `Vehicle` shape:

```ts
function mockVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v1', user_id: 'u1', name: 'Kwid', brand: 'Renault', model: 'Kwid', year: 2026,
    fuel_type: 'ethanol', avg_consumption_per_100: 1100, ownership_type: 'rent',
    monthly_cost_cents: 0, monthly_insurance_cents: 0, current_odometer: 18622000,
    is_taxi: false, taxi_license_monthly_cents: 0, created_at: '2026-08-05T00:00:00Z',
    rental_contract_start_date: '2026-08-05',
    rental_contract_start_odometer: 18332000,
    rental_km_allowance_period: 'weekly',
    rental_week_start_day: 1,
    rental_km_allowance_amount: 500,
    rental_km_excess_rate_cents: 150,
    ...overrides,
  };
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/services/rentalAllowance.test.ts`
Expected: FAIL — the removed `'unlimited'` early-return test is gone, but the new test fails because the service still passes the old param shape (or still early-returns on something related).

- [ ] **Step 3: Implement**

Replace `src/services/rentalAllowance.ts`'s guard clause and the `computeRentalAllowanceStatus` call:

```ts
import { supabase } from '../lib/supabase';
import { computeRentalAllowanceStatus, type OdometerReading, type RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';
import type { Vehicle } from '../types';

export async function getRentalAllowanceStatus(
  vehicle: Vehicle,
  now: Date = new Date(),
): Promise<RentalAllowanceStatus | null> {
  if (vehicle.ownership_type !== 'rent') return null;
  if (!vehicle.rental_km_allowance_period) return null;
  if (!vehicle.rental_contract_start_date) return null;

  const [{ data: shifts }, { data: fuelEntries }] = await Promise.all([
    supabase.from('shifts').select('odometer_start_meters, odometer_end_meters, started_at, ended_at')
      .eq('vehicle_id', vehicle.id).eq('user_id', vehicle.user_id)
      .lte('started_at', now.toISOString()),
    supabase.from('fuel_entries').select('odometer_meters, filled_at')
      .eq('vehicle_id', vehicle.id).eq('user_id', vehicle.user_id)
      .lte('filled_at', now.toISOString()),
  ]);

  const readings: OdometerReading[] = [];
  for (const s of shifts ?? []) {
    if (s.odometer_start_meters != null) readings.push({ odometerMeters: s.odometer_start_meters, at: s.started_at });
    if (s.odometer_end_meters != null) readings.push({ odometerMeters: s.odometer_end_meters, at: s.ended_at ?? s.started_at });
  }
  for (const f of fuelEntries ?? []) {
    if (f.odometer_meters != null) readings.push({ odometerMeters: f.odometer_meters, at: f.filled_at });
  }

  return computeRentalAllowanceStatus({
    contractStartDate: vehicle.rental_contract_start_date,
    contractStartOdometerMeters: vehicle.rental_contract_start_odometer ?? null,
    cycleType: vehicle.rental_km_allowance_period,
    weekStartDay: vehicle.rental_week_start_day ?? null,
    allowanceAmountKm: vehicle.rental_km_allowance_amount ?? null,
    excessRateCents: vehicle.rental_km_excess_rate_cents ?? null,
    readings,
    now,
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/services/rentalAllowance.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add "src/services/rentalAllowance.ts" "__tests__/services/rentalAllowance.test.ts"
git commit -m "feat: wire rentalAllowance service to the new cycle-based computeRentalAllowanceStatus signature"
```

---

### Task 6: `RentalAllowanceExtractCard` — daily label, informational mode, current-cycle headline

**Files:**
- Modify: `src/components/RentalAllowanceExtractCard.tsx`
- Modify: `__tests__/components/RentalAllowanceExtractCard.test.tsx`
- Modify: `locales/pt.json`, `en.json`, `en-GB.json`, `es.json`, `fr.json`, `zh.json`

**Interfaces:**
- Consumes: `RentalAllowanceStatus` (Task 4 shape — `cumulativeAllowanceKm`/`balanceKm` nullable, new `currentCycleUsageKm`).

- [ ] **Step 1: Add locale keys (all 6 files)**

In each locale file's `"rental_allowance"` block, add `"period_daily"` next to the existing `"period_weekly"`/`"period_monthly"`, and a `"current_cycle"` key (period-agnostic, since the current-cycle line always pairs with the same `periodLabel` already computed for the header). pt.json (source of truth for wording):

```json
                             "period_daily":  "diária",
                             "current_cycle":  "{{km}} km na {{period}} atual",
```

en.json:
```json
                             "period_daily": "daily",
                             "current_cycle": "{{km}} km in the current {{period}}",
```

en-GB.json: same as en.json.

es.json:
```json
                             "period_daily": "diaria",
                             "current_cycle": "{{km}} km en el {{period}} actual",
```

fr.json:
```json
                             "period_daily": "quotidienne",
                             "current_cycle": "{{km}} km sur la {{period}} en cours",
```

zh.json:
```json
                             "period_daily": "每日",
                             "current_cycle": "本{{period}}已行驶 {{km}} 公里",
```

(Match each file's existing indentation/quoting style exactly — read the file first and follow its formatting, don't reformat surrounding keys.)

- [ ] **Step 2: Write the failing tests**

In `__tests__/components/RentalAllowanceExtractCard.test.tsx`, update `makeStatus()` to include the new field, and add cases:

```ts
function makeStatus(overrides: Partial<RentalAllowanceStatus> = {}): RentalAllowanceStatus {
  return {
    allowanceAmountKm: 1500, allowancePeriod: 'weekly',
    baselineMeters: 19228000, baselineIsEstimated: true, currentOdometerMeters: 20739000,
    cumulativeUsageKm: 2858, cumulativeAllowanceKm: 3000, balanceKm: 142,
    currentCycleUsageKm: 519,
    isNearLimit: true, isOverLimit: false,
    overageKm: 0, overageCostCents: 0, remainingKm: 142,
    ...overrides,
  };
}
```

Add near the end of the `describe` block:

```ts
  it('shows the current-cycle usage line regardless of cap status', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({ currentCycleUsageKm: 519, allowancePeriod: 'weekly' })} />);
    expect(screen.getByText('519 km na semanal atual')).toBeTruthy();
  });

  it('shows the daily period label', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({ allowancePeriod: 'daily' })} />);
    expect(screen.getByText('diária')).toBeTruthy();
  });

  it('uncapped/informational mode: no bar, no balance, no percentage -- only the current-cycle usage line', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({
      cumulativeAllowanceKm: null, balanceKm: null, currentCycleUsageKm: 127, allowancePeriod: 'weekly',
    })} />);
    expect(screen.getByText('127 km na semanal atual')).toBeTruthy();
    expect(screen.queryByTestId('rental-allowance-fill')).toBeNull();
    expect(screen.queryByTestId('rental-allowance-balance')).toBeNull();
  });
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest __tests__/components/RentalAllowanceExtractCard.test.tsx`
Expected: FAIL — no current-cycle text exists yet, no `'daily'` label branch, uncapped mode still tries to render the bar with `null` values (NaN width or crash).

- [ ] **Step 4: Implement**

Replace `src/components/RentalAllowanceExtractCard.tsx`'s body:

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import type { RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';

// Always-visible "how much of my km allowance have I used" card for a
// rental vehicle. The top line (current-cycle usage) always shows,
// capped or not. The bar/balance/percentage below it are the CUMULATIVE,
// never-resets figures and only render when there's an actual cap
// (cumulativeAllowanceKm/balanceKm non-null) -- see
// docs/superpowers/specs/2026-08-19-km-allowance-cycle-generalization-design.md.
export function RentalAllowanceExtractCard({ status }: { status: RentalAllowanceStatus | null }) {
  const { t } = useTranslation();
  if (!status) return null;

  const periodLabel = status.allowancePeriod === 'monthly'
    ? t('rental_allowance.period_monthly')
    : status.allowancePeriod === 'daily'
      ? t('rental_allowance.period_daily')
      : t('rental_allowance.period_weekly');

  const isCapped = status.cumulativeAllowanceKm != null && status.balanceKm != null;
  const pct = isCapped ? Math.min(status.cumulativeUsageKm / status.cumulativeAllowanceKm!, 1) : 0;
  const pctLabel = Math.round(pct * 100);
  const barColor = status.isOverLimit ? Colors.error : status.isNearLimit ? Colors.accent : Colors.success;
  const isBalancePositive = (status.balanceKm ?? 0) >= 0;
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
        {t('rental_allowance.current_cycle', {
          km: status.currentCycleUsageKm.toFixed(0),
          period: periodLabel,
        })}
      </Text>

      {isCapped ? (
        <>
          <Text style={s.cumulativeText}>
            {t('rental_allowance.extract_usage', {
              used: status.cumulativeUsageKm.toFixed(0),
              total: status.cumulativeAllowanceKm!.toFixed(0),
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
              {t(balanceKey, { km: Math.abs(status.balanceKm!).toFixed(0) })}
            </Text>
            <Text style={[s.pctText, { color: barColor }]}>{pctLabel}%</Text>
          </View>
        </>
      ) : null}
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
  cumulativeText: { color: Colors.textSecondary, fontSize: 12, marginBottom: Spacing.xs },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  balanceText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  pctText: { fontSize: 12, fontWeight: '700' },
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest __tests__/components/RentalAllowanceExtractCard.test.tsx`
Expected: PASS, all tests including the pre-existing ones (`'2858 / 3000 km usados'`, bar color/cap behavior).

- [ ] **Step 6: Commit**

```bash
git add "src/components/RentalAllowanceExtractCard.tsx" "__tests__/components/RentalAllowanceExtractCard.test.tsx" locales/*.json
git commit -m "feat: ExtractCard shows current-cycle usage always, cumulative bar only when capped, daily period label"
```

---

### Task 7: `RentalAllowanceBanner` regression test (no code change)

**Files:**
- Modify: `__tests__/components/RentalAllowanceBanner.test.tsx`

**Interfaces:**
- Consumes: `RentalAllowanceStatus` (Task 4 shape).

- [ ] **Step 1: Write the test**

Add to `__tests__/components/RentalAllowanceBanner.test.tsx`, inside the existing `describe`:

```ts
  it('renders nothing for uncapped/informational status (isNearLimit is always false when allowanceAmountKm is null)', () => {
    const { toJSON } = render(<RentalAllowanceBanner status={makeStatus({
      allowanceAmountKm: null, cumulativeAllowanceKm: null, balanceKm: null,
      overageKm: null, overageCostCents: null, remainingKm: null,
      isNearLimit: false, isOverLimit: false,
    })} />);
    expect(toJSON()).toBeNull();
  });
```

Also update `makeStatus()` in this file to add `currentCycleUsageKm: 290` (matches its existing `cumulativeUsageKm: 290` fixture) so the object satisfies the `RentalAllowanceStatus` type from Task 4.

- [ ] **Step 2: Run to verify it passes immediately (no production code change needed)**

Run: `npx jest __tests__/components/RentalAllowanceBanner.test.tsx`
Expected: PASS, all tests including the new one — `RentalAllowanceBanner.tsx` already guards on `!status.isNearLimit`, which is `false` in uncapped mode by construction (Task 4), so it needs no code change.

- [ ] **Step 3: Commit**

```bash
git add "__tests__/components/RentalAllowanceBanner.test.tsx"
git commit -m "test: confirm RentalAllowanceBanner stays hidden for uncapped/informational status"
```

---

### Task 8: `app/(tabs)/index.tsx` — query column + notification dedup key

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `getAllowanceCycleBounds`, `AllowanceCycleType` (Task 3).

- [ ] **Step 1: Update the import**

Replace line 48:

```ts
import { getPeriodBounds, type RentalAllowanceStatus, type RentalAllowancePeriod } from '@/src/utils/rentalKmAllowanceUtils';
```

with:

```ts
import { getAllowanceCycleBounds, type RentalAllowanceStatus, type AllowanceCycleType } from '@/src/utils/rentalKmAllowanceUtils';
```

- [ ] **Step 2: Add the new column to the vehicle query**

On line 1377, add `rental_week_start_day` to `vehicleColumns`:

```ts
const vehicleColumns = 'id, user_id, brand, model, year, fuel_type, avg_consumption_per_100, ownership_type, rental_contract_start_date, rental_contract_start_odometer, rental_km_allowance_period, rental_km_allowance_amount, rental_km_excess_rate_cents, rental_week_start_day';
```

- [ ] **Step 3: Replace the notification dedup key logic**

Replace lines 1449-1465 (the `if (rentalStatusData?.isNearLimit) { ... }` block):

```ts
    if (rentalStatusData?.isNearLimit) {
      // The dedup key re-arms on each new cycle (day/week/month), derived
      // from the vehicle's own cycle bounds -- see
      // docs/superpowers/specs/2026-08-19-km-allowance-cycle-generalization-design.md.
      const vd = vehicleData as {
        rental_contract_start_date?: string | null;
        rental_km_allowance_period?: AllowanceCycleType | null;
        rental_week_start_day?: number | null;
      } | null;
      const cycleBounds = vd?.rental_contract_start_date && vd?.rental_km_allowance_period
        ? getAllowanceCycleBounds(
            vd.rental_contract_start_date,
            vd.rental_km_allowance_period,
            vd.rental_week_start_day ?? null,
            new Date(),
          )
        : null;
      if (cycleBounds) {
        fireRentalAllowanceNearLimitNotification(i18n.language, cycleBounds.cycleStart.toISOString().slice(0, 10)).catch(() => {});
      }
    }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No new errors from `index.tsx`. Pending errors from `register.tsx`/`more.tsx` still expected until Tasks 9-10.

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat: dashboard uses getAllowanceCycleBounds for the near-limit notification dedup key"
```

---

### Task 9: `register.tsx` — cycle picker, week-start-day picker, optional amount

**Files:**
- Modify: `app/(auth)/register.tsx`
- Modify: `locales/pt.json`, `en.json`, `en-GB.json`, `es.json`, `fr.json`, `zh.json`

**Interfaces:**
- Consumes: `RentalAllowancePeriod` (Task 2, now `'daily'|'weekly'|'monthly'`).

- [ ] **Step 1: Add locale keys (all 6 files)**

In each file's `"onboarding"` block, add `"allowance_daily"` next to the existing `"allowance_weekly"`/`"allowance_monthly"` (drop nothing yet — `"allowance_unlimited"` can stay in the files unused, removing dead locale keys is not required and keeps the diff smaller), plus a week-start-day picker label, hint, and 7 weekday names, plus an amount-optional hint. pt.json:

```json
                       "allowance_daily":  "Diária",
                       "week_start_day":  "Em que dia da semana sua franquia reinicia?",
                       "week_start_day_hint":  "Pode ser diferente do dia em que seu contrato começou.",
                       "weekday_0":  "Domingo",
                       "weekday_1":  "Segunda-feira",
                       "weekday_2":  "Terça-feira",
                       "weekday_3":  "Quarta-feira",
                       "weekday_4":  "Quinta-feira",
                       "weekday_5":  "Sexta-feira",
                       "weekday_6":  "Sábado",
                       "allowance_amount_hint":  "Deixe em branco se seu contrato não tem limite de km — ainda mostraremos quanto você rodou por período.",
```

en.json:
```json
                       "allowance_daily": "Daily",
                       "week_start_day": "Which day of the week does your allowance reset?",
                       "week_start_day_hint": "Can be different from the day your contract started.",
                       "weekday_0": "Sunday",
                       "weekday_1": "Monday",
                       "weekday_2": "Tuesday",
                       "weekday_3": "Wednesday",
                       "weekday_4": "Thursday",
                       "weekday_5": "Friday",
                       "weekday_6": "Saturday",
                       "allowance_amount_hint": "Leave blank if your contract has no km limit — we'll still show how much you drove per cycle.",
```

en-GB.json: same as en.json.

es.json:
```json
                       "allowance_daily": "Diaria",
                       "week_start_day": "¿En qué día de la semana se reinicia tu franquicia?",
                       "week_start_day_hint": "Puede ser distinto del día en que empezó tu contrato.",
                       "weekday_0": "Domingo",
                       "weekday_1": "Lunes",
                       "weekday_2": "Martes",
                       "weekday_3": "Miércoles",
                       "weekday_4": "Jueves",
                       "weekday_5": "Viernes",
                       "weekday_6": "Sábado",
                       "allowance_amount_hint": "Déjalo en blanco si tu contrato no tiene límite de km — igual mostraremos cuánto recorriste por ciclo.",
```

fr.json:
```json
                       "allowance_daily": "Quotidienne",
                       "week_start_day": "Quel jour de la semaine votre franchise se réinitialise-t-elle ?",
                       "week_start_day_hint": "Peut être différent du jour où votre contrat a commencé.",
                       "weekday_0": "Dimanche",
                       "weekday_1": "Lundi",
                       "weekday_2": "Mardi",
                       "weekday_3": "Mercredi",
                       "weekday_4": "Jeudi",
                       "weekday_5": "Vendredi",
                       "weekday_6": "Samedi",
                       "allowance_amount_hint": "Laissez vide si votre contrat n'a pas de limite de km — nous afficherons quand même votre kilométrage par cycle.",
```

zh.json:
```json
                       "allowance_daily": "每日",
                       "week_start_day": "您的额度在每周的哪一天重置？",
                       "week_start_day_hint": "可以和合同开始的日期不同。",
                       "weekday_0": "星期日",
                       "weekday_1": "星期一",
                       "weekday_2": "星期二",
                       "weekday_3": "星期三",
                       "weekday_4": "星期四",
                       "weekday_5": "星期五",
                       "weekday_6": "星期六",
                       "allowance_amount_hint": "如果您的合同没有公里数限制，请留空——我们仍会显示您每个周期行驶的公里数。",
```

- [ ] **Step 2: Add local state for week-start-day**

In `register.tsx`, near the other rental-related state (around line 154-156), add:

```ts
  const [allowancePeriod, setAllowancePeriod] = useState<RentalAllowancePeriod>('weekly');
  const [weekStartDay, setWeekStartDay] = useState<string>('1'); // Select requires string values
  const [allowanceAmount, setAllowanceAmount] = useState('');
  const [excessRate, setExcessRate] = useState('');
```

(Only the default for `allowancePeriod` changes, from `'unlimited'` to `'weekly'`; `weekStartDay` is new.)

- [ ] **Step 3: Simplify the `rentalOk` validation**

Replace the comment block and `rentalOk` definition (around lines 263-274):

```ts
  // A rent vehicle always has a cycle selected (default weekly) so its
  // contract start date is always required for cycle-bounds math -- even in
  // uncapped/informational mode, since that still needs to know which
  // cycle "now" falls in. The allowance amount/excess rate are always
  // optional (blank amount = uncapped).
  const rentalOk = ownership !== 'rent' || !!rentalStartDate;
```

- [ ] **Step 4: Fix the rental-start-date required asterisk**

The date-field label (around line 666-669) still gates its `*` marker on the removed `'unlimited'` value:

```tsx
                <Text style={s.label}>
                  {t('onboarding.rental_start_date')}
                  {allowancePeriod !== 'unlimited' ? <Text style={s.required}> *</Text> : null}
                </Text>
```

Since `rentalStartDate` is now unconditionally required whenever `ownership === 'rent'` (Step 3's `rentalOk`), replace it with an unconditional asterisk:

```tsx
                <Text style={s.label}>
                  {t('onboarding.rental_start_date')}
                  <Text style={s.required}> *</Text>
                </Text>
```

- [ ] **Step 5: Replace the allowance-period Select and always show amount/excess fields, plus the week-start-day picker**

Replace the block from `<Text style={s.label}>{t('onboarding.allowance_period')}</Text>` through the closing of the `allowancePeriod !== 'unlimited' ? (...) : null` conditional (lines 689-722):

```tsx
                <Text style={s.label}>{t('onboarding.allowance_period')}</Text>
                <Select
                  value={allowancePeriod}
                  onValueChange={(v) => setAllowancePeriod(v as RentalAllowancePeriod)}
                  items={[
                    { label: t('onboarding.allowance_daily'), value: 'daily' },
                    { label: t('onboarding.allowance_weekly'), value: 'weekly' },
                    { label: t('onboarding.allowance_monthly'), value: 'monthly' },
                  ]}
                />

                {allowancePeriod === 'weekly' ? (
                  <>
                    <Text style={s.label}>{t('onboarding.week_start_day')}</Text>
                    <Select
                      value={weekStartDay}
                      onValueChange={setWeekStartDay}
                      items={['1', '2', '3', '4', '5', '6', '0'].map(d => ({
                        label: t(`onboarding.weekday_${d}`), value: d,
                      }))}
                    />
                    <Text style={s.hint}>{t('onboarding.week_start_day_hint')}</Text>
                  </>
                ) : null}

                <Text style={s.label}>{t('onboarding.allowance_amount')}</Text>
                <TextInput
                  style={inp}
                  value={allowanceAmount}
                  onChangeText={setAllowanceAmount}
                  keyboardType="numeric"
                  placeholderTextColor={Colors.textSecondary}
                  accessibilityLabel={t('onboarding.allowance_amount')}
                />
                <Text style={s.hint}>{t('onboarding.allowance_amount_hint')}</Text>

                <Text style={s.label}>{t('onboarding.excess_rate')}</Text>
                <TextInput
                  style={inp}
                  value={excessRate}
                  onChangeText={setExcessRate}
                  keyboardType="decimal-pad"
                  placeholderTextColor={Colors.textSecondary}
                  accessibilityLabel={t('onboarding.excess_rate')}
                />
```

(Note: the `<Text style={s.required}> *</Text>` markers are removed from `allowance_amount`/`excess_rate` labels since they're no longer required fields — matches the `rentalOk` change in Step 3.)

- [ ] **Step 6: Update `buildInput()`**

Replace the vehicle object's rental fields (lines 337-341):

```ts
        rental_km_allowance_period: ownership === 'rent' ? allowancePeriod : null,
        rental_week_start_day: ownership === 'rent' && allowancePeriod === 'weekly' ? parseInt(weekStartDay, 10) : null,
        rental_km_allowance_amount: ownership === 'rent' && allowanceAmount.trim()
          ? parseInt(allowanceAmount.replace(',', '.'), 10) : null,
        rental_km_excess_rate_cents: ownership === 'rent' && excessRate.trim()
          ? decimalToCents(parseFloat(excessRate.replace(',', '.')) || 0) : null,
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: `register.tsx` errors from Task 2 are now resolved. Only `more.tsx` errors (Task 10) should remain, if any.

- [ ] **Step 8: Commit**

```bash
git add "app/(auth)/register.tsx" locales/*.json
git commit -m "feat: register.tsx cycle picker (daily/weekly/monthly), week-start-day picker, optional km amount"
```

---

### Task 10: `more.tsx` (`VehicleModal`) — same UI changes

**Files:**
- Modify: `app/(tabs)/more.tsx`

**Interfaces:**
- Consumes: `RentalAllowancePeriod` (Task 2), locale keys (Task 9).

- [ ] **Step 1: Update `ALLOWANCE_PERIODS` constant**

Line 123:

```ts
const ALLOWANCE_PERIODS: RentalAllowancePeriod[] = ['daily', 'weekly', 'monthly'];
```

- [ ] **Step 2: Add week-start-day state, change default period**

Line 300 and nearby:

```ts
  const [allowancePeriod, setAllowancePeriod]         = useState<RentalAllowancePeriod>('weekly');
  const [weekStartDay, setWeekStartDay]                = useState<string>('1');
```

- [ ] **Step 3: Load week-start-day when editing an existing vehicle**

In the `useEffect` that hydrates form state from `vehicle` (around line 306-319), add after `setAllowancePeriod(...)`:

```ts
      setAllowancePeriod(vehicle.rental_km_allowance_period ?? 'weekly');
      setWeekStartDay(vehicle.rental_week_start_day != null ? String(vehicle.rental_week_start_day) : '1');
```

And in the `else if (visible && !vehicle)` reset branch (around line 331-337), add:

```ts
      setAllowancePeriod('weekly'); setWeekStartDay('1'); setAllowanceAmount(''); setExcessRate('');
```

(replacing the existing `setAllowancePeriod('unlimited'); setAllowanceAmount(''); setExcessRate('');` line).

- [ ] **Step 4: Update `handleSave`'s validation and `rentalFields`**

Replace line 345's guard:

```ts
    if (ownership === 'rent' && !rentalStartDate) { setError(t('more.vehicle_required')); return; }
```

Replace `rentalFields` (lines 346-356):

```ts
    const rentalFields = {
      ownership_type: ownership,
      rental_contract_start_date: ownership === 'rent' ? rentalStartDate : null,
      rental_contract_start_odometer: ownership === 'rent' && rentalStartOdometer
        ? displayToMeters(parseFloat(rentalStartOdometer.replace(',', '.')) || 0, 'km') : null,
      rental_km_allowance_period: ownership === 'rent' ? allowancePeriod : null,
      rental_week_start_day: ownership === 'rent' && allowancePeriod === 'weekly' ? parseInt(weekStartDay, 10) : null,
      rental_km_allowance_amount: ownership === 'rent' && allowanceAmount
        ? parseInt(allowanceAmount.replace(',', '.'), 10) : null,
      rental_km_excess_rate_cents: ownership === 'rent' && excessRate
        ? decimalToCents(parseFloat(excessRate.replace(',', '.')) || 0) : null,
    };
```

- [ ] **Step 5: Update the JSX — week-start-day picker, always-visible optional amount/excess fields**

Replace the block from `<Text style={s.fieldLabel}>{t('onboarding.allowance_period')}</Text>` through the closing of `{allowancePeriod !== 'unlimited' ? (...) : null}` (lines 504-535):

```tsx
              <Text style={s.fieldLabel}>{t('onboarding.allowance_period')}</Text>
              <View style={s.fuelGrid}>
                {ALLOWANCE_PERIODS.map(p => (
                  <TouchableOpacity key={p} style={[s.fuelOption, allowancePeriod === p && s.fuelOptionActive]} onPress={() => setAllowancePeriod(p)}>
                    <Text style={[s.fuelOptionText, allowancePeriod === p && { color: Colors.accent }]}>{t(`onboarding.allowance_${p}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {allowancePeriod === 'weekly' ? (
                <>
                  <Text style={s.fieldLabel}>{t('onboarding.week_start_day')}</Text>
                  <Select
                    value={weekStartDay}
                    onValueChange={setWeekStartDay}
                    items={['1', '2', '3', '4', '5', '6', '0'].map(d => ({
                      label: t(`onboarding.weekday_${d}`), value: d,
                    }))}
                  />
                </>
              ) : null}

              <Text style={s.fieldLabel}>{t('onboarding.allowance_amount')}</Text>
              <TextInput
                style={s.fieldInput}
                value={allowanceAmount}
                onChangeText={setAllowanceAmount}
                keyboardType="numeric"
                placeholderTextColor={Colors.textSecondary}
                accessibilityLabel={t('onboarding.allowance_amount')}
              />

              <Text style={s.fieldLabel}>{t('onboarding.excess_rate')}</Text>
              <TextInput
                style={s.fieldInput}
                value={excessRate}
                onChangeText={setExcessRate}
                keyboardType="decimal-pad"
                placeholderTextColor={Colors.textSecondary}
                accessibilityLabel={t('onboarding.excess_rate')}
              />
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors anywhere in the km-allowance-touched files.

- [ ] **Step 7: Commit**

```bash
git add "app/(tabs)/more.tsx"
git commit -m "feat: VehicleModal cycle picker (daily/weekly/monthly), week-start-day picker, optional km amount"
```

---

### Task 11: Full suite green + repo sanity pass

**Files:** none new — verification only.

- [ ] **Step 1: Run the entire Jest suite**

Run: `npx jest`
Expected: 100% PASS, no skipped/failing suites.

- [ ] **Step 2: Full type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Confirm `getPeriodBounds` truly untouched**

Run: `git diff HEAD~8 -- src/utils/rentalKmAllowanceUtils.ts` (adjust the commit count to cover Tasks 3-4) and visually confirm the diff only ADDS content after `getPeriodBounds`'s closing brace and REMOVES `computeCumulativeAllowanceKm`/`daysInMonthUTC` — no lines inside `getPeriodBounds`, `mondayOf`, or `addMonthClamped` changed.

- [ ] **Step 4: Grep for stray `'unlimited'` references in touched files**

Run: `grep -rn "unlimited" app/\(auth\)/register.tsx app/\(tabs\)/more.tsx app/\(tabs\)/index.tsx src/services/rentalAllowance.ts src/components/RentalAllowanceExtractCard.tsx src/components/RentalAllowanceBanner.tsx`
Expected: no matches (the old `RentalAllowancePeriod` inside `rentalKmAllowanceUtils.ts` itself is intentionally excluded from this grep — it's supposed to keep `'unlimited'`).

- [ ] **Step 5: Commit (only if any stray fixes were needed in Steps 1-4; otherwise skip)**

If Steps 1-4 required no fixes, there is nothing to commit for this task — proceed directly to Task 12.

---

### Task 12: Production data fix for Eddie's vehicle

**Files:** none — data fix via MCP tool.

- [ ] **Step 1: Apply the fix**

Call `mcp__claude_ai_Supabase__execute_sql` with `project_id: "ucxkvxqpkknxotbfxgeu"`:

```sql
update public.vehicles
  set rental_km_allowance_amount = 1505, rental_week_start_day = 1
  where id = '4483a9f5-10b0-442c-9732-415a1dc27264';
```

- [ ] **Step 2: Verify**

```sql
select id, rental_km_allowance_period, rental_km_allowance_amount, rental_week_start_day,
       rental_contract_start_date, rental_contract_start_odometer
  from public.vehicles where id = '4483a9f5-10b0-442c-9732-415a1dc27264';
```

Expected: `rental_km_allowance_amount = 1505`, `rental_week_start_day = 1`, contract fields unchanged.

---

### Task 13: Final live verification against the real service

**Files:** none — verification only, via MCP `execute_sql` simulating the exact service query the app runs.

- [ ] **Step 1: Pull the current live readings for the vehicle**

```sql
select 'shift_start' as kind, odometer_start_meters as odometer_meters, started_at as at
  from public.shifts where vehicle_id='4483a9f5-10b0-442c-9732-415a1dc27264' and user_id='db85eea7-8cd7-464d-ba68-05f1e8a15560'
union all
select 'shift_end', odometer_end_meters, coalesce(ended_at, started_at)
  from public.shifts where vehicle_id='4483a9f5-10b0-442c-9732-415a1dc27264' and user_id='db85eea7-8cd7-464d-ba68-05f1e8a15560' and odometer_end_meters is not null
union all
select 'fuel', odometer_meters, filled_at
  from public.fuel_entries where vehicle_id='4483a9f5-10b0-442c-9732-415a1dc27264' and user_id='db85eea7-8cd7-464d-ba68-05f1e8a15560' and odometer_meters is not null
order by at;
```

- [ ] **Step 2: Hand-compute (or run a throwaway Node script importing the real `computeRentalAllowanceStatus`) using this data with `now = <current timestamp>`, `cycleType: 'weekly'`, `weekStartDay: 1`, `allowanceAmountKm: 1505`**

If a throwaway script is used, write it to the scratch/temp location (not committed), e.g.:

```ts
// scratch-verify.ts (not committed)
import { computeRentalAllowanceStatus } from './src/utils/rentalKmAllowanceUtils';
const readings = [/* paste rows from Step 1 */];
console.log(computeRentalAllowanceStatus({
  contractStartDate: '2026-08-05',
  contractStartOdometerMeters: 18332000,
  cycleType: 'weekly',
  weekStartDay: 1,
  allowanceAmountKm: 1505,
  excessRateCents: 75,
  readings,
  now: new Date(),
}));
```

Run: `npx ts-node scratch-verify.ts` (or equivalent).

- [ ] **Step 3: Compare against the table**

Expected (allowing for any new shifts logged between plan-writing time and verification time, which only ADD to week 3's usage/balance, never change weeks 1-2's closed figures): the closed week-1 and week-2 increments, computed the same way as Task 4's regression tests (successive `cumulativeUsageKm` snapshots at cycle boundaries), still equal 896 and 1625 exactly. If new data has landed since 2026-08-19, week 3's live numbers will have grown past 519/+1045 — that's expected and fine; what must NOT happen is a mismatch in the closed weeks.

If any closed-week number differs from 896/1625, STOP. Do not adjust the expected numbers — this means there's a bug in the implementation (most likely in `getAllowanceCycleBounds`'s cycle-index arithmetic or the readings-cutoff logic), and it must be found and fixed before proceeding to deploy.

---

### Task 14: Deploy + documentation

**Files:**
- Modify: `D:\Obsidian\Claude Code\PalDrivy.md`

- [ ] **Step 1: Deploy**

Run (from `D:\1. Google Drive Bluesun\App Calculo Uber\app-motorista`): `vercel --prod`
Expected: deployment succeeds, READY status at `app.paldrivy.com`.

- [ ] **Step 2: Confirm READY**

Check the Vercel deployment status (via `vercel:status` skill or `mcp__plugin_vercel_vercel__get_deployment`) for the production deployment at `app.paldrivy.com`.
Expected: state `READY`.

- [ ] **Step 3: Update the Obsidian note**

Read `D:\Obsidian\Claude Code\PalDrivy.md` first, then append an entry (matching the file's existing entry format/style) stating: this is the final correction to the km-allowance feature, citing the real Localiza contract (`ZJLF017112`) as source of truth for the block-per-cycle-with-carryover model and the 1505 km/week figure; explicitly note that the 2026-08-15 simple weekly-block version and the 2026-08-18 daily-linear version are both superseded by this pass; record the 3 verified numbers (896/+179, 1625/+59, 519/+1045) as the regression baseline.

- [ ] **Step 4: No commit needed for the Obsidian note (outside the git repo)**

---

## Self-Review Notes

- **Spec coverage:** Part A (cycle types, week-start-day field, unlimited→null-amount) → Tasks 1, 2, 9, 10. Part B (cycle bounds, corrected calculation, current-cycle usage) → Tasks 3, 4. Migration → Tasks 1, 12. Registration/edit form → Tasks 9, 10. Out-of-scope items (km_gaps, retroactive recategorization, cycle-switch UI) → deliberately no task touches them.
- **Placeholder scan:** every step has literal code, exact file paths/line numbers as of 2026-08-19, and real pulled data — no "TBD"/"similar to Task N" left in.
- **Type consistency:** `AllowanceCycleType` (Task 3) flows unchanged into `computeRentalAllowanceStatus`'s `cycleType` param (Task 4), `rentalAllowance.ts`'s call (Task 5), and `index.tsx`'s notification key (Task 8). `RentalAllowancePeriod` (Task 2, app-wide) flows into `register.tsx`/`more.tsx` (Tasks 9-10) unchanged from what `Vehicle.rental_km_allowance_period` expects. `RentalAllowanceStatus`'s new nullable fields (Task 4) are consumed consistently by `RentalAllowanceExtractCard` (Task 6, guards on `isCapped`) and `RentalAllowanceBanner` (Task 7, no change needed since `isNearLimit` is already `false`-safe).
