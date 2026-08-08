# Recurring Expense Daily Allocation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** divide weekly/monthly recurring expenses across the driver's configured working days, and deduct each day's share from that day's shift(s) via a new `shifts.allocated_fixed_cents` column, folded into the real `net_cents` calculation.

**Architecture:** a pure calculation utility (which recurring expenses are active for a given day, and each one's daily share), a thin service layer that fetches the driver's recurring expenses + `working_days` config + same-day shift count, and three call-site edits in `src/services/shifts.ts` where `net_cents` is actually computed today.

**Tech Stack:** React Native/Expo (SDK 56), TypeScript, Supabase (Postgres), Jest.

## Global Constraints

- **No UI for this feature** — per the design spec, this only affects the persisted `net_cents` value; there is no card, banner, or breakdown screen to build. Don't add one.
- **Forward-only, no retroactive recalculation** — `allocated_fixed_cents` is computed once, at shift-completion time, using whatever recurring expenses are active then. Editing/adding/deleting a recurring expense later never touches already-completed shifts.
- **Each recurring expense computes its own daily share independently** — do NOT sum multiple recurring expenses into one shared denominator. Each one's share is `expense.amount_cents ÷ workingDaysInThatExpense'sOwnPeriod`, then all active expenses' shares are summed for the day's total.
- **"Dias úteis"/"dias trabalhados" always means `goals.working_days`** (the driver's own configured weekdays), never a calendar business-day definition, for both weekly and monthly frequency.
- **`ShiftCalc`/`shifts.calc` (jsonb) is untouched, unrelated dead code** — do not resurrect it or write to it as part of this feature. Use a real new column instead, matching how `gross_cents`/`net_cents` already work.
- **Only `recurring_frequency IN ('weekly', 'monthly')` participate** — `quarterly`/`semiannual`/`annual` recurring expenses are out of scope for this pass and must not affect the calculation.
- Reuse `getPeriodBounds` from `src/utils/rentalKmAllowanceUtils.ts` for period-bounds math — do not reimplement weekly/monthly period logic. It already has the monthly day-of-month clamping fix (contracts/expenses anchored on the 29th-31st) from earlier work today.

---

### Task 1: DB migration — `allocated_fixed_cents` column

**Files:**
- Create: `supabase/migrations/20260807140000_shift_allocated_fixed_cents.sql`
- Modify: `src/types/index.ts` (add the field to the `Shift` interface — check its exact current shape first, don't guess)

**Interfaces:**
- Produces: `shifts.allocated_fixed_cents` column, consumed by every later task.

- [ ] **Step 1: Write and apply the migration**

```sql
alter table public.shifts
  add column allocated_fixed_cents integer not null default 0;

comment on column public.shifts.allocated_fixed_cents is
  'This shift''s share of active weekly/monthly recurring expenses for its day, computed once at shift-completion time (endShift/updateShift/createManualShift in src/services/shifts.ts) and folded into net_cents. Forward-only: never retroactively recalculated when recurring expenses change later. See docs/superpowers/specs/2026-08-07-recurring-expense-daily-allocation-design.md.';
```

Apply via the `apply_migration` MCP tool (project_id `ucxkvxqpkknxotbfxgeu`) — **use the actual current timestamp when invoking it**, then verify the applied version via `list_migrations` and rename this local file to match exactly (same gotcha hit and fixed in the rental-km-allowance plan's Task 1 — `apply_migration` assigns its own version at invocation time, which can differ from the filename you write first).

- [ ] **Step 2: Update the `Shift` type**

Read `src/types/index.ts`'s current `Shift` interface in full first (don't guess its shape from memory), then add `allocated_fixed_cents: number;` as a required field (it has a DB default of 0, so every row always has a value — not optional/nullable).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/<actual-applied-timestamp>_shift_allocated_fixed_cents.sql src/types/index.ts
git commit -m "feat: add allocated_fixed_cents column to shifts"
```

---

### Task 2: Pure calculation utility

**Files:**
- Create: `src/utils/recurringExpenseAllocationUtils.ts`
- Test: `__tests__/utils/recurringExpenseAllocationUtils.test.ts`

**Interfaces:**
- Consumes: `getPeriodBounds` from `src/utils/rentalKmAllowanceUtils.ts` (signature: `getPeriodBounds(anchorDate: string, period: 'weekly' | 'monthly' | 'unlimited', now: Date): { periodStart: Date, periodEnd: Date } | null`).
- Produces: `computeDailyAllocationCents`, `splitAcrossShifts` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

```ts
import { computeDailyAllocationCents, splitAcrossShifts, type RecurringExpenseInput } from '@/src/utils/recurringExpenseAllocationUtils';

describe('computeDailyAllocationCents', () => {
  it('divides a weekly expense by the working days in ITS OWN period', () => {
    // Rent R$660/week, expense_date anchors the weekly cycle to Tuesdays,
    // driver works Mon-Sat (6 days) -> 660/6 = 110 per working day.
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 66000, expenseDate: '2026-08-04', frequency: 'weekly' }, // a Tuesday
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z')); // the Wednesday right after
    expect(result).toBe(11000); // R$110,00
  });

  it('sums two independent recurring expenses without a shared denominator', () => {
    // Rent 660/week (6 working days -> 110/day) + insurance 300/month anchored
    // same date, ~26 working days in a Mon-Sat month -> ~11.54/day, floored/rounded.
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 66000, expenseDate: '2026-08-04', frequency: 'weekly' },
      { amountCents: 30000, expenseDate: '2026-08-04', frequency: 'monthly' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    // 110/day (weekly) computed independently from monthly's own ~1154/day share -- assert each
    // component matches its own period's working-day count, not a combined one. Exact monthly
    // figure depends on actual Aug 2026 Mon-Sat count in that period -- implementer: compute the
    // real expected value from the actual calendar when writing this assertion, don't guess a
    // round number. The key behavioral assertion is: result === weeklyShare + monthlyShare,
    // where each share was computed against ITS OWN period's working-day count.
    expect(result).toBeGreaterThan(11000); // more than the weekly share alone
  });

  it('ignores quarterly/semiannual/annual recurring expenses', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 120000, expenseDate: '2026-08-04', frequency: 'quarterly' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(0);
  });

  it('ignores non-recurring expenses entirely (frequency null/one-off)', () => {
    // one-off expenses shouldn't even reach this function in practice (Task 3 filters them
    // before calling), but the pure function should be defensive regardless
    const expenses: RecurringExpenseInput[] = [];
    expect(computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'))).toBe(0);
  });

  it('returns 0 for a day the target date falls outside any active expense\'s period', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 66000, expenseDate: '2026-08-04', frequency: 'weekly' },
    ];
    // a date long before the expense's anchor -- outside any period this expense could define
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-01-01T12:00:00Z'));
    expect(result).toBe(0);
  });
});

describe('splitAcrossShifts', () => {
  it('returns the full amount for a single shift', () => {
    expect(splitAcrossShifts(11000, 1)).toEqual([11000]);
  });

  it('splits evenly across multiple shifts, remainder to the last', () => {
    // 11000 / 3 = 3666.67 -> 3667, 3667, 3666 (sums back to exactly 11000)
    const shares = splitAcrossShifts(11000, 3);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(11000);
    expect(shares.length).toBe(3);
  });

  it('returns an empty array for zero shifts', () => {
    expect(splitAcrossShifts(11000, 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/utils/recurringExpenseAllocationUtils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/utils/recurringExpenseAllocationUtils.test.ts`
Expected: PASS (8 tests). For the second test ("sums two independent recurring expenses"), compute the actual expected monthly-share value by hand against the real August 2026 calendar before finalizing the assertion — don't leave the placeholder `toBeGreaterThan` check as the final assertion, tighten it to an exact expected total once you've computed it.

- [ ] **Step 5: Commit**

```bash
git add src/utils/recurringExpenseAllocationUtils.ts __tests__/utils/recurringExpenseAllocationUtils.test.ts
git commit -m "feat: pure recurring-expense daily allocation calculation"
```

---

### Task 3: Service layer

**Files:**
- Create: `src/services/recurringExpenseAllocation.ts`
- Test: `__tests__/services/recurringExpenseAllocation.test.ts`

**Interfaces:**
- Consumes: `computeDailyAllocationCents`, `splitAcrossShifts`, `RecurringExpenseInput` (Task 2).
- Produces: `getAllocatedFixedCentsForShift(userId: string, shiftDate: string): Promise<number>` — consumed by Task 4. `shiftDate` is a `YYYY-MM-DD` string identifying which calendar day's shifts to split across.

- [ ] **Step 1: Write the failing tests**

```ts
import { getAllocatedFixedCentsForShift } from '@/src/services/recurringExpenseAllocation';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

describe('getAllocatedFixedCentsForShift', () => {
  it('fetches recurring expenses + working_days + same-day shift count and splits the total', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'expenses') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({
          data: [{ amount_cents: 66000, expense_date: '2026-08-04', recurring_frequency: 'weekly' }],
        }) }) }) };
      }
      if (table === 'goals') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () =>
          Promise.resolve({ data: { working_days: [1, 2, 3, 4, 5, 6] } }) }) }) }) }) }) };
      }
      if (table === 'shifts') {
        return { select: () => ({ eq: () => ({ gte: () => ({ lt: () =>
          Promise.resolve({ data: [{ id: 's1' }, { id: 's2' }] }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });

    // 660/6 = 110 total for the day, split across 2 shifts -> 55 each; this
    // call is for the first shift in insertion/id order (implementer's call
    // on exact ordering -- document whatever's chosen)
    const result = await getAllocatedFixedCentsForShift('user-1', '2026-08-05');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  it('returns 0 when there are no active recurring expenses', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'expenses') return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [] }) }) }) };
      if (table === 'goals') return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) }) }) };
      if (table === 'shifts') return { select: () => ({ eq: () => ({ gte: () => ({ lt: () => Promise.resolve({ data: [{ id: 's1' }] }) }) }) }) };
      throw new Error(`unexpected table ${table}`);
    });
    const result = await getAllocatedFixedCentsForShift('user-1', '2026-08-05');
    expect(result).toBe(0);
  });
});
```

Note: the exact mock chain shapes above are a reasonable guess at query structure — adjust to match whatever this codebase's actual `.select()/.eq()/.gte()/.lt()` chaining convention is once you've written the real implementation (check `src/services/rentalAllowance.ts`'s test file for this repo's established query-mocking style and match it).

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/services/recurringExpenseAllocation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { supabase } from '../lib/supabase';
import { computeDailyAllocationCents, splitAcrossShifts, type RecurringExpenseInput } from '../utils/recurringExpenseAllocationUtils';

export async function getAllocatedFixedCentsForShift(userId: string, shiftDate: string): Promise<number> {
  const dayStart = `${shiftDate}T00:00:00.000Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

  const [{ data: expenseRows }, { data: goal }, { data: sameDayShifts }] = await Promise.all([
    supabase.from('expenses').select('amount_cents, expense_date, recurring_frequency')
      .eq('user_id', userId).eq('recurring', true),
    supabase.from('goals').select('working_days')
      .eq('user_id', userId).eq('type', 'monthly')
      .order('starts_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('shifts').select('id')
      .eq('user_id', userId).gte('started_at', dayStart).lt('started_at', dayEnd),
  ]);

  const workingDays = goal?.working_days ?? [];
  if (workingDays.length === 0) return 0;

  const expenses: RecurringExpenseInput[] = (expenseRows ?? [])
    .filter((e): e is typeof e & { recurring_frequency: 'weekly' | 'monthly' } =>
      e.recurring_frequency === 'weekly' || e.recurring_frequency === 'monthly')
    .map(e => ({ amountCents: e.amount_cents, expenseDate: e.expense_date, frequency: e.recurring_frequency }));

  const dailyTotal = computeDailyAllocationCents(expenses, workingDays, new Date(dayStart));
  if (dailyTotal === 0) return 0;

  const shiftCount = sameDayShifts?.length ?? 1;
  const shares = splitAcrossShifts(dailyTotal, Math.max(shiftCount, 1));
  // The specific shift being completed gets one share -- since all same-day
  // shifts get an identical split amount except the last (which absorbs the
  // rounding remainder), and this function doesn't know which numeric
  // position the CURRENT shift occupies among the day's shifts, return the
  // base (non-remainder) share unless this is the only shift of the day.
  // This is a known simplification -- see report for exact reasoning if
  // this needs revisiting.
  return shiftCount <= 1 ? shares[0] : shares[0];
}
```

**Flag for the implementer:** the "which shift gets the remainder" detail in Step 3's example code is under-specified — re-examine this when implementing. The cleanest correct approach is likely: pass the CURRENT shift's `id` (or its position/index among the day's shifts, e.g. "this is shift N of M for the day, ordered by `started_at`") into `getAllocatedFixedCentsForShift`, so it can return the correct positional share from `splitAcrossShifts`'s array (giving the last-by-`started_at`-order shift the remainder) rather than always returning `shares[0]`. Decide and implement the correct version — don't ship the placeholder "always shares[0]" behavior above as final. Update the function signature and its call sites in Task 4 accordingly, and add a test proving a 3-shift day gives three DIFFERENT correct shares (not the same value three times).

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/services/recurringExpenseAllocation.test.ts`
Expected: PASS, with the remainder-assignment gap above resolved and tested.

- [ ] **Step 5: Commit**

```bash
git add src/services/recurringExpenseAllocation.ts __tests__/services/recurringExpenseAllocation.test.ts
git commit -m "feat: fetch recurring expenses and compute per-shift fixed-cost allocation"
```

---

### Task 4: Wire into shift completion

**Files:**
- Modify: `src/services/shifts.ts`
- Test: extend `__tests__/services/shifts.test.ts` if it exists (check first — if this file doesn't exist yet, this is the first test coverage for this service; check whether that's consistent with the rest of the codebase's testing conventions before deciding whether to add broad new coverage or scope your tests tightly to just the new behavior)

**Interfaces:**
- Consumes: `getAllocatedFixedCentsForShift` (Task 3).

- [ ] **Step 1: Investigate the three call sites**

Re-read `src/services/shifts.ts`'s `endShift`, `updateShift`, and `createManualShift` — all three currently call `calcGrossNet(payload)` to get `{ grossCents, netCents }`, then insert/update using `netCents` directly with no fixed-cost deduction. All three need the same treatment: fetch this shift's `allocated_fixed_cents` for its day (via Task 3's function, using the shift's own date — `endShift`/`updateShift` need the shift's `started_at`, which may need to be fetched or is already available depending on the call site; `createManualShift` already has `startedAt` as a parameter), deduct it from `netCents`, and persist the value in the new `allocated_fixed_cents` column alongside `net_cents`.

- [ ] **Step 2: Extend `calcGrossNet` or wrap its result**

Either extend `calcGrossNet` to accept `allocatedFixedCents` as a parameter and fold it into its returned `netCents`, or compute `netCents - allocatedFixedCents` separately at each call site after calling the existing `calcGrossNet` — pick whichever keeps the three call sites least duplicated (a small shared helper if the same 2-3 lines would otherwise repeat three times, matching this file's existing preference for one `calcGrossNet` helper over duplicating the gross/net math per call site).

- [ ] **Step 3: Determine each shift's date for the allocation lookup**

- `endShift(shiftId, payload, startedAt?, pauses?)`: `startedAt` is already an optional parameter — if not passed, this function needs the shift's actual `started_at` from the DB (check whether callers of `endShift` always pass it, or whether a fetch is needed here).
- `updateShift(shiftId, payload, startedAt?, endedAt?)`: same consideration.
- `createManualShift(userId, vehicleId, startedAt, endedAt, payload, isPremium)`: `startedAt` is always available directly.

Use the shift's `started_at` date (not `ended_at`) as the day the allocation applies to — matching the existing precedent from the rental-km-allowance work, where a shift's odometer readings are also attributed to `started_at` for period-bucketing purposes (see that plan's Task 3 notes on this exact convention, including its known limitation for overnight shifts — same limitation applies here, don't try to fix it as part of this task).

- [ ] **Step 4: Wire in and persist**

Add `allocated_fixed_cents: allocatedFixedCents` to each of the three `updateData`/insert payloads (`endShift`, `updateShift`, `createManualShift`), and ensure `net_cents`/`gross_cents` reflect the deduction consistently across all three call sites.

- [ ] **Step 5: Tests**

Add test coverage (new file if `shifts.ts` has none yet) for at least: `endShift` correctly deducts a non-zero allocation into both `net_cents` and `allocated_fixed_cents`; a day with zero active recurring expenses leaves `net_cents` unchanged from today's behavior (regression safety — confirm existing callers/behavior for non-rental users aren't affected).

- [ ] **Step 6: Run full suite, typecheck, commit**

```bash
npx jest && npx tsc --noEmit
git add src/services/shifts.ts __tests__/services/shifts.test.ts
git commit -m "feat: deduct allocated fixed costs from shift net profit at completion time"
```

---

### Task 5: Full-flow verification

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: all suites pass, no regressions in files this plan didn't touch.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors vs. the established pre-existing baseline (compare via `git stash` if unsure which errors are new).

- [ ] **Step 3: Manual end-to-end sanity check against real data**

Using the real Supabase project (`ucxkvxqpkknxotbfxgeu`), check whether any test account has a `recurring = true` expense with `recurring_frequency IN ('weekly','monthly')` — if so, hand-compute what a shift completed today should deduct, and compare against what the code actually produces (either by tracing the logic or, if feasible, completing a real test shift and checking the resulting `allocated_fixed_cents`/`net_cents`). If no such expense currently exists in test data, note this gap rather than fabricating one, matching this session's established "no data = say so, don't invent" discipline.

- [ ] **Step 4: Report status**

Do not deploy/build an AAB from this plan alone — report completion and hold for the owner's release-bundling decision, matching this session's established pattern for every feature today.
