# Vehicle Recurring Cost Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** let a rented vehicle's cost be entered as daily, weekly, or monthly; make the vehicle's own cost field the single source of truth for the existing daily-rateio engine (instead of a disconnected manual expense); let any recurring expense be given an end date so it stops being rated going forward.

**Architecture:** No new tables. Extend the existing `expenses` table (`ends_at` column, `'daily'` added to `recurring_frequency`) and the existing recurring-allocation engine (`recurringExpenseAllocationUtils.ts`/`recurringExpenseAllocation.ts`, built 2026-08-07) to understand both. A vehicle's rent/financing cost becomes, by convention, "the one `recurring=true` expense row with this `vehicle_id`" — new functions in `vehicles.ts` find-or-update that row instead of writing to the decorative `vehicles.monthly_cost_cents` column.

**Tech Stack:** React Native + Expo Router, Supabase (Postgres + PostgREST), Jest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-14-vehicle-recurring-cost-lifecycle-design.md` — every task below implements one part of it.
- Forward-only: `ends_at` never retroactively changes allocation for days before it.
- `'daily'` frequency: full `amount_cents` on every working day, no division.
- Daily/weekly/monthly selector only for `ownership_type === 'rent'`; `financed`/`own` stay monthly-only.
- `ends_at` is available on any recurring expense, not just vehicle-linked ones.
- No pause/resume — ending is permanent.
- pt-BR is the primary locale; every user-facing string change ships in `locales/pt.json`, `locales/en.json`, `locales/es.json` together (they are line-aligned today — keep them that way).
- Supabase project ref: `ucxkvxqpkknxotbfxgeu`.

---

### Task 1: Database migration — `expenses.ends_at` + `'daily'` frequency

**Files:**
- Create: `supabase/migrations/20260814150000_expenses_ends_at_and_daily_frequency.sql`

**Interfaces:**
- Produces: `expenses.ends_at` (nullable `date` column), `expenses.recurring_frequency` CHECK constraint widened to include `'daily'`.

- [ ] **Step 1: Write the migration file**

```sql
-- Add ends_at: when set, this recurring expense stops being allocated
-- for any day >= ends_at. Days before ends_at are unaffected (forward-only).
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS ends_at DATE;

-- Allow 'daily' as a recurring_frequency value (a daily rate contributes
-- its full amount every working day, no period division).
ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_recurring_frequency_check;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_recurring_frequency_check
  CHECK (recurring_frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual'));
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

Use the `mcp__claude_ai_Supabase__apply_migration` tool with `project_id: ucxkvxqpkknxotbfxgeu`, `name: expenses_ends_at_and_daily_frequency`, and the SQL from Step 1 as `query`.

- [ ] **Step 3: Verify the column and constraint exist**

Run via `mcp__claude_ai_Supabase__execute_sql` (`project_id: ucxkvxqpkknxotbfxgeu`):

```sql
select column_name, is_nullable, data_type
from information_schema.columns
where table_name = 'expenses' and column_name = 'ends_at';

select pg_get_constraintdef(oid)
from pg_constraint
where conname = 'expenses_recurring_frequency_check';
```

Expected: first query returns one row (`ends_at`, `YES`, `date`); second query's definition string contains `'daily'::text`.

- [ ] **Step 4: Commit**

```bash
git add "supabase/migrations/20260814150000_expenses_ends_at_and_daily_frequency.sql"
git commit -m "Adiciona ends_at e frequência daily em expenses"
```

---

### Task 2: One-off data fix — link the existing orphaned rent expense to its vehicle

**Files:** none (data-only, via Supabase MCP tools — no repo file changes).

**Interfaces:**
- Consumes: Task 1's migration must already be applied (not required for this specific fix, but keep task order — this fix doesn't touch `ends_at`/`daily`, just `vehicle_id`).

- [ ] **Step 1: Confirm the row still matches what was found during design**

Run via `mcp__claude_ai_Supabase__execute_sql` (`project_id: ucxkvxqpkknxotbfxgeu`):

```sql
select id, category, amount_cents, recurring_frequency, vehicle_id
from expenses
where id = '16eab437-db08-49c3-87ed-7c28d3933ad9';
```

Expected: one row, `vehicle_id` is `null`, `category` is `'rent'`, `amount_cents` is `80431`. If `vehicle_id` is already set or the row no longer matches, STOP and report back instead of proceeding — the data has changed since design time and this fix needs re-verification, not blind execution.

- [ ] **Step 2: Link it to the Renault Kwid**

```sql
update expenses
set vehicle_id = '4483a9f5-10b0-442c-9732-415a1dc27264'
where id = '16eab437-db08-49c3-87ed-7c28d3933ad9';
```

- [ ] **Step 3: Verify**

```sql
select id, vehicle_id from expenses where id = '16eab437-db08-49c3-87ed-7c28d3933ad9';
```

Expected: `vehicle_id` is now `4483a9f5-10b0-442c-9732-415a1dc27264`.

(No commit — this task has no repo files.)

---

### Task 3: `recurringExpenseAllocationUtils.ts` — `'daily'` frequency + `endsAt`

**Files:**
- Modify: `src/utils/recurringExpenseAllocationUtils.ts`
- Test: `__tests__/utils/recurringExpenseAllocationUtils.test.ts`

**Interfaces:**
- Produces: `RecurringExpenseInput` gains `frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual'` (was missing `'daily'`) and `endsAt?: string | null` (optional — existing call sites/tests that don't set it must keep compiling). `computeDailyAllocationCents` signature is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/utils/recurringExpenseAllocationUtils.test.ts`, inside the existing `describe('computeDailyAllocationCents', ...)` block (after the last existing `it(...)`, before its closing `});`):

```ts
  it('a daily expense contributes its full amount on every working day, no division', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 5000, expenseDate: '2026-08-04', frequency: 'daily' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(5000);
  });

  it('a daily expense contributes 0 on a day off, same as weekly/monthly', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 5000, expenseDate: '2026-08-04', frequency: 'daily' },
    ];
    // 2026-08-09 is a Sunday, not in the Mon-Sat working days below.
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-09T12:00:00Z'));
    expect(result).toBe(0);
  });

  it('an expense with endsAt on/before the target date contributes 0', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 66000, expenseDate: '2026-08-04', frequency: 'weekly', endsAt: '2026-08-05' },
    ];
    // Target date equals endsAt -- must already be excluded (endsAt is the
    // first day the expense no longer applies, not the last day it does).
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(0);
  });

  it('an expense with endsAt in the future still contributes normally before that date', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 66000, expenseDate: '2026-08-04', frequency: 'weekly', endsAt: '2026-12-01' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(11000); // same as the very first test in this file
  });

  it('a daily expense also respects endsAt', () => {
    const expenses: RecurringExpenseInput[] = [
      { amountCents: 5000, expenseDate: '2026-08-04', frequency: 'daily', endsAt: '2026-08-05' },
    ];
    const result = computeDailyAllocationCents(expenses, [1, 2, 3, 4, 5, 6], new Date('2026-08-05T12:00:00Z'));
    expect(result).toBe(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/utils/recurringExpenseAllocationUtils.test.ts`
Expected: FAIL — TypeScript error, `frequency: 'daily'` and `endsAt` don't exist on `RecurringExpenseInput` yet.

- [ ] **Step 3: Implement**

In `src/utils/recurringExpenseAllocationUtils.ts`, replace the `RecurringExpenseInput` interface and the body of `computeDailyAllocationCents`:

```ts
export interface RecurringExpenseInput {
  amountCents: number;
  expenseDate: string; // YYYY-MM-DD, anchors this expense's period cycle
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';
  // YYYY-MM-DD. When set, this expense contributes 0 for any targetDate on
  // or after this date -- days before it are unaffected (forward-only, no
  // retroactive recalculation). Optional so existing callers/fixtures that
  // never set it keep compiling unchanged.
  endsAt?: string | null;
}
```

```ts
export function computeDailyAllocationCents(
  expenses: RecurringExpenseInput[],
  workingDays: number[],
  targetDate: Date,
): number {
  const targetDow = targetDate.getUTCDay();
  const targetIso = targetDow === 0 ? 7 : targetDow;
  if (!workingDays.includes(targetIso)) return 0;

  let total = 0;
  for (const expense of expenses) {
    if (expense.endsAt) {
      const endsAtDate = new Date(`${expense.endsAt}T00:00:00.000Z`);
      if (targetDate >= endsAtDate) continue;
    }

    // A daily rate is already "per working day" -- nothing to divide across
    // a period, unlike weekly/monthly. Bypasses getPeriodBounds entirely.
    if (expense.frequency === 'daily') {
      total += expense.amountCents;
      continue;
    }

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/utils/recurringExpenseAllocationUtils.test.ts`
Expected: PASS, all tests (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add "src/utils/recurringExpenseAllocationUtils.ts" "__tests__/utils/recurringExpenseAllocationUtils.test.ts"
git commit -m "Adiciona frequência daily e endsAt em computeDailyAllocationCents"
```

---

### Task 4: `recurringExpenseAllocation.ts` — thread `ends_at`/`'daily'` through all 5 call sites

**Files:**
- Modify: `src/services/recurringExpenseAllocation.ts`
- Test: `__tests__/services/recurringExpenseAllocation.test.ts`

**Interfaces:**
- Consumes: `RecurringExpenseInput.endsAt`/`'daily'` from Task 3.
- Produces: no exported signature changes — `getAllocatedFixedCentsForShift`, `getRecurringExpenseBreakdownForDay`, `getRecurringExpenseTotalForRange`, `getRecurringExpenseBreakdownForRange`, `syncAllocatedFixedCentsForDay` keep their existing signatures, now correctly honoring `ends_at`/`'daily'` rows.

All 5 functions in this file follow the identical pattern: `select('...amount_cents, expense_date, recurring_frequency')`, then `.filter(...)` on `recurring_frequency === 'weekly' || 'monthly'`, then `.map(e => ({ amountCents, expenseDate, frequency }))`. Each needs the same three-part change.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/services/recurringExpenseAllocation.test.ts`. First, inside `describe('getAllocatedFixedCentsForShift', ...)`, after its last existing `it(...)`:

```ts
  it('a daily-frequency expense contributes its full amount, not divided across a period', async () => {
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 5000, expense_date: '2026-08-04', recurring: true, recurring_frequency: 'daily' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
      shifts: [{ id: 's1', user_id: 'user-1', started_at: '2026-08-05T08:00:00.000Z' }],
    });
    const result = await getAllocatedFixedCentsForShift('user-1', '2026-08-05', 's1');
    expect(result).toBe(5000);
  });

  it('an expense past its ends_at no longer contributes', async () => {
    mockTables({
      expenses: [{ user_id: 'user-1', amount_cents: 66000, expense_date: '2026-08-04', recurring: true, recurring_frequency: 'weekly', ends_at: '2026-08-05' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
      shifts: [{ id: 's1', user_id: 'user-1', started_at: '2026-08-05T08:00:00.000Z' }],
    });
    const result = await getAllocatedFixedCentsForShift('user-1', '2026-08-05', 's1');
    expect(result).toBe(0);
  });
```

Then, inside `describe('getRecurringExpenseTotalForRange', ...)`, after its last existing `it(...)`:

```ts
  it('an expense that ends partway through the range only counts the days before ends_at', async () => {
    mockTables({
      // Daily R$50, ends 2026-08-04 (the 4th itself is excluded) -- so only
      // Aug 1, 2, 3 (all Mon-Sat working days, none are Sunday) count = 3 days.
      expenses: [{ user_id: 'user-1', amount_cents: 5000, expense_date: '2026-08-01', recurring: true, recurring_frequency: 'daily', ends_at: '2026-08-04' }],
      goal: { user_id: 'user-1', type: 'monthly', starts_at: '2026-08-01', working_days: [1, 2, 3, 4, 5, 6] },
    });
    const total = await getRecurringExpenseTotalForRange('user-1', '2026-08-01', '2026-08-08');
    expect(total).toBe(3 * 5000);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/services/recurringExpenseAllocation.test.ts`
Expected: FAIL — daily/ends_at rows are filtered out today (frequency filter only allows weekly/monthly, ends_at is never read), so results come back as `0` instead of the expected values.

- [ ] **Step 3: Implement**

In `src/services/recurringExpenseAllocation.ts`, apply this same three-part change at all 5 call sites (`getAllocatedFixedCentsForShift`, `getRecurringExpenseBreakdownForDay`, `getRecurringExpenseTotalForRange`, `getRecurringExpenseBreakdownForRange`, `syncAllocatedFixedCentsForDay`):

1. In every `.select('...')` string on the `expenses` table, add `ends_at` to the column list (e.g. `'amount_cents, expense_date, recurring_frequency, ends_at'` or `'category, amount_cents, expense_date, recurring_frequency, ends_at'` for the two functions that also select `category`).
2. Every type-guard filter:
```ts
.filter((e): e is typeof e & { recurring_frequency: 'weekly' | 'monthly' } =>
  e.recurring_frequency === 'weekly' || e.recurring_frequency === 'monthly')
```
becomes:
```ts
.filter((e): e is typeof e & { recurring_frequency: 'daily' | 'weekly' | 'monthly' } =>
  e.recurring_frequency === 'daily' || e.recurring_frequency === 'weekly' || e.recurring_frequency === 'monthly')
```
3. Every `.map(e => ({ amountCents: e.amount_cents, expenseDate: e.expense_date, frequency: e.recurring_frequency }))` becomes:
```ts
.map(e => ({ amountCents: e.amount_cents, expenseDate: e.expense_date, frequency: e.recurring_frequency, endsAt: e.ends_at as string | null }))
```

`getRecurringExpenseBreakdownForDay` and `getRecurringExpenseBreakdownForRange` build their `RecurringExpenseInput` inline per-expense inside a loop rather than via one `.map()` (e.g. `[{ amountCents: e.amount_cents, expenseDate: e.expense_date, frequency: e.recurring_frequency }]`) — apply the same `endsAt: e.ends_at as string | null` addition there too, and widen their inline type-guard filters the same way as point 2.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/services/recurringExpenseAllocation.test.ts`
Expected: PASS, all tests (existing + 3 new).

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx jest`
Expected: PASS, all suites (191+ tests, no regressions from Tasks 3-4).

- [ ] **Step 6: Commit**

```bash
git add "src/services/recurringExpenseAllocation.ts" "__tests__/services/recurringExpenseAllocation.test.ts"
git commit -m "Propaga ends_at e frequência daily pelas 5 funções de rateio"
```

---

### Task 5: `vehicles.ts` — vehicle-linked recurring cost functions

**Files:**
- Modify: `src/services/vehicles.ts`
- Create: `__tests__/services/vehicles.test.ts`

**Interfaces:**
- Produces:
  - `getVehicleRecurringCost(vehicleId: string): Promise<{ id: string; amountCents: number; frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual'; endsAt: string | null } | null>`
  - `syncVehicleRecurringCost(params: { vehicleId: string; userId: string; ownershipType: 'own' | 'rent' | 'financed'; amountCents: number; frequency: 'daily' | 'weekly' | 'monthly' }): Promise<void>`
  - `endVehicleRecurringCost(vehicleId: string): Promise<void>`
- Consumes: none beyond the existing `supabase` client.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/services/vehicles.test.ts`:

```ts
import { getVehicleRecurringCost, syncVehicleRecurringCost, endVehicleRecurringCost } from '@/src/services/vehicles';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

function makeQueryBuilder(rows: Record<string, unknown>[]) {
  let filtered = rows;
  const builder: any = {
    select: () => builder,
    eq: (field: string, value: unknown) => { filtered = filtered.filter(r => r[field] === value); return builder; },
    limit: (n: number) => { filtered = filtered.slice(0, n); return builder; },
    maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
  };
  return builder;
}

describe('getVehicleRecurringCost', () => {
  it('returns null when the vehicle has no linked recurring expense', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => makeQueryBuilder([]));
    const result = await getVehicleRecurringCost('veh-1');
    expect(result).toBeNull();
  });

  it('returns the linked expense mapped to camelCase fields', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      expect(table).toBe('expenses');
      return makeQueryBuilder([
        { id: 'exp-1', vehicle_id: 'veh-1', recurring: true, amount_cents: 80431, recurring_frequency: 'weekly', ends_at: null },
      ]);
    });
    const result = await getVehicleRecurringCost('veh-1');
    expect(result).toEqual({ id: 'exp-1', amountCents: 80431, frequency: 'weekly', endsAt: null });
  });
});

describe('syncVehicleRecurringCost', () => {
  it('does nothing for an owned vehicle', async () => {
    const fromMock = jest.fn();
    (supabase.from as jest.Mock).mockImplementation(fromMock);
    await syncVehicleRecurringCost({ vehicleId: 'veh-1', userId: 'user-1', ownershipType: 'own', amountCents: 50000, frequency: 'monthly' });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('inserts a new linked expense when none exists yet', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      expect(table).toBe('expenses');
      return {
        select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }),
        insert: insertMock,
      };
    });
    await syncVehicleRecurringCost({ vehicleId: 'veh-1', userId: 'user-1', ownershipType: 'rent', amountCents: 80431, frequency: 'weekly' });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1', vehicle_id: 'veh-1', category: 'rent',
      amount_cents: 80431, recurring: true, recurring_frequency: 'weekly',
    }));
  });

  it('updates the existing linked expense instead of inserting a duplicate', async () => {
    const updateEqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: updateEqMock }));
    const insertMock = jest.fn();
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      expect(table).toBe('expenses');
      return {
        select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'exp-1' }, error: null }) }) }) }) }),
        update: updateMock,
        insert: insertMock,
      };
    });
    await syncVehicleRecurringCost({ vehicleId: 'veh-1', userId: 'user-1', ownershipType: 'financed', amountCents: 120000, frequency: 'monthly' });
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      amount_cents: 120000, recurring_frequency: 'monthly', category: 'financing',
    }));
    expect(updateEqMock).toHaveBeenCalledWith('id', 'exp-1');
  });
});

describe('endVehicleRecurringCost', () => {
  it('does nothing when the vehicle has no linked recurring expense', async () => {
    const updateMock = jest.fn();
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }),
      update: updateMock,
    }));
    await endVehicleRecurringCost('veh-1');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('sets ends_at to today on the linked expense', async () => {
    const updateEqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: updateEqMock }));
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'exp-1' }, error: null }) }) }) }) }),
      update: updateMock,
    }));
    await endVehicleRecurringCost('veh-1');
    const todayIso = new Date().toISOString().slice(0, 10);
    expect(updateMock).toHaveBeenCalledWith({ ends_at: todayIso });
    expect(updateEqMock).toHaveBeenCalledWith('id', 'exp-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/services/vehicles.test.ts`
Expected: FAIL — `getVehicleRecurringCost`/`syncVehicleRecurringCost`/`endVehicleRecurringCost` don't exist yet.

- [ ] **Step 3: Implement**

Append to `src/services/vehicles.ts`:

```ts
type VehicleRecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export interface VehicleRecurringCost {
  id: string;
  amountCents: number;
  frequency: VehicleRecurringFrequency;
  endsAt: string | null;
}

// "The vehicle's own recurring cost" is, by convention, the one recurring=true
// expense row with this vehicle_id -- see the 2026-08-14 design doc. There is
// at most one such row per vehicle by construction (syncVehicleRecurringCost
// always finds-or-updates, never inserts a second one).
export async function getVehicleRecurringCost(vehicleId: string): Promise<VehicleRecurringCost | null> {
  const { data } = await supabase
    .from('expenses')
    .select('id, amount_cents, recurring_frequency, ends_at')
    .eq('vehicle_id', vehicleId)
    .eq('recurring', true)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    amountCents: data.amount_cents as number,
    frequency: data.recurring_frequency as VehicleRecurringFrequency,
    endsAt: (data.ends_at as string | null) ?? null,
  };
}

// Makes the vehicle's own registered cost the source of truth for the daily
// rateio engine: finds this vehicle's existing linked recurring expense and
// updates it, or creates one if none exists yet. Never creates a second row
// for the same vehicle. No-op for ownership_type 'own' -- an owned vehicle
// has no rent/financing cost to rate.
export async function syncVehicleRecurringCost(params: {
  vehicleId: string;
  userId: string;
  ownershipType: 'own' | 'rent' | 'financed';
  amountCents: number;
  frequency: 'daily' | 'weekly' | 'monthly';
}): Promise<void> {
  const { vehicleId, userId, ownershipType, amountCents, frequency } = params;
  if (ownershipType === 'own') return;
  const category = ownershipType === 'rent' ? 'rent' : 'financing';

  const { data: existing } = await supabase
    .from('expenses')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .eq('recurring', true)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('expenses')
      .update({ amount_cents: amountCents, recurring_frequency: frequency, category })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('expenses').insert({
      user_id: userId,
      vehicle_id: vehicleId,
      category,
      amount_cents: amountCents,
      recurring: true,
      recurring_frequency: frequency,
      expense_date: new Date().toISOString().slice(0, 10),
    });
    if (error) throw error;
  }
}

// Sets today as the linked recurring expense's end date (permanent -- no
// resume). No-op if the vehicle has no linked recurring expense.
export async function endVehicleRecurringCost(vehicleId: string): Promise<void> {
  const { data: existing } = await supabase
    .from('expenses')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .eq('recurring', true)
    .limit(1)
    .maybeSingle();
  if (!existing) return;

  const { error } = await supabase.from('expenses')
    .update({ ends_at: new Date().toISOString().slice(0, 10) })
    .eq('id', existing.id);
  if (error) throw error;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/services/vehicles.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/services/vehicles.ts" "__tests__/services/vehicles.test.ts"
git commit -m "Adiciona getVehicleRecurringCost/syncVehicleRecurringCost/endVehicleRecurringCost"
```

---

### Task 6: Wire vehicle registration (`completeRegistration.ts`) to sync the recurring cost

**Files:**
- Modify: `src/services/completeRegistration.ts`
- Test: `__tests__/services/completeRegistration.test.ts`

**Interfaces:**
- Consumes: `createVehicle` (existing, `src/services/vehicles.ts`, already returns the created `Vehicle` including `.id`), `syncVehicleRecurringCost` (Task 5).
- Produces: `RegistrationInput.vehicle` gains an optional `rentalCostFrequency?: 'daily' | 'weekly' | 'monthly'` field (defaults to `'monthly'` when absent, preserving today's behavior for `financed`/`own`).

- [ ] **Step 1: Write the failing test**

`__tests__/services/completeRegistration.test.ts` currently mocks vehicles.ts on line 11 as:
```ts
jest.mock('@/src/services/vehicles', () => ({ createVehicle: jest.fn() }));
```
Change this line to also export the new mocked function:
```ts
jest.mock('@/src/services/vehicles', () => ({ createVehicle: jest.fn(), syncVehicleRecurringCost: jest.fn() }));
```
Add the import at the top of the file, alongside the existing `import { createVehicle } from '@/src/services/vehicles';`:
```ts
import { createVehicle, syncVehicleRecurringCost } from '@/src/services/vehicles';
```

Add a new test inside the existing `describe('completeRegistration', ...)` block, after the last existing `it(...)` (the `'returns a resumable partial-failure result identifying the vehicle step...'` test):

```ts
  it('syncs the vehicle recurring cost after creating the vehicle, using the chosen rental frequency', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });

    const rentInput = {
      ...baseInput,
      vehicle: { ...baseInput.vehicle, ownership_type: 'rent' as const, monthly_cost_cents: 80431, rentalCostFrequency: 'weekly' as const },
    };

    const result = await completeRegistration(rentInput);

    expect(result.status).toBe('success');
    expect(syncVehicleRecurringCost).toHaveBeenCalledWith({
      vehicleId: 'v1',
      userId: 'u1',
      ownershipType: 'rent',
      amountCents: 80431,
      frequency: 'weekly',
    });
  });

  it('defaults the recurring cost frequency to monthly when rentalCostFrequency is not provided', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });

    await completeRegistration(baseInput); // baseInput.vehicle has no rentalCostFrequency, ownership_type: 'own'

    expect(syncVehicleRecurringCost).toHaveBeenCalledWith({
      vehicleId: 'v1',
      userId: 'u1',
      ownershipType: 'own',
      amountCents: 0,
      frequency: 'monthly',
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/services/completeRegistration.test.ts`
Expected: FAIL — `syncVehicleRecurringCost` is never called by `completeRegistration` yet.

- [ ] **Step 3: Implement**

In `src/services/completeRegistration.ts`:

1. Add the import: `import { createVehicle, syncVehicleRecurringCost } from './vehicles';` (replace the existing `createVehicle`-only import line).
2. Extend `RegistrationInput`'s `vehicle` field type — change:
```ts
vehicle: Omit<Vehicle, 'id' | 'user_id' | 'created_at' | 'name'>;
```
to:
```ts
vehicle: Omit<Vehicle, 'id' | 'user_id' | 'created_at' | 'name'> & {
  // Only meaningful when ownership_type is 'rent'; defaults to 'monthly'
  // otherwise (financed/own keep today's single-monthly-field behavior).
  rentalCostFrequency?: 'daily' | 'weekly' | 'monthly';
};
```
3. Replace the vehicle step body:
```ts
    if (startIndex <= STEP_ORDER.indexOf('vehicle')) {
      currentStep = 'vehicle';
      await createVehicle({ ...input.vehicle, user_id: userId, name: `${input.vehicle.brand} ${input.vehicle.model}` });
    }
```
with:
```ts
    if (startIndex <= STEP_ORDER.indexOf('vehicle')) {
      currentStep = 'vehicle';
      const vehicle = await createVehicle({ ...input.vehicle, user_id: userId, name: `${input.vehicle.brand} ${input.vehicle.model}` });
      await syncVehicleRecurringCost({
        vehicleId: vehicle.id,
        userId,
        ownershipType: input.vehicle.ownership_type,
        amountCents: input.vehicle.monthly_cost_cents,
        frequency: input.vehicle.rentalCostFrequency ?? 'monthly',
      });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/services/completeRegistration.test.ts`
Expected: PASS, all tests (existing + new).

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx jest`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add "src/services/completeRegistration.ts" "__tests__/services/completeRegistration.test.ts"
git commit -m "completeRegistration sincroniza o custo recorrente do veículo"
```

---

### Task 7: Locale strings (pt/en/es)

**Files:**
- Modify: `locales/pt.json`, `locales/en.json`, `locales/es.json`

**Interfaces:** none (data files, consumed via `t('...')` in Tasks 8-10).

- [ ] **Step 1: Add new keys to all three files, at the same locations in each (they are line-aligned today — keep them aligned)**

In the `"onboarding"` section, immediately after the existing `"monthly_cost"` key (`"Custo mensal (aluguel/parcela)"` in pt.json), add:
- `"rental_cost_frequency"`: label for the frequency selector.
- `"rental_cost_daily"` / `"rental_cost_weekly"` / `"rental_cost_monthly"`: the 3 selector options.
- `"rental_cost_amount"`: label for the amount field, replacing `monthly_cost`'s use specifically inside the rent branch (register.tsx/VehicleModal will use this new key when `ownership === 'rent'`, and keep using the existing `monthly_cost` key for `financed`/`own`).

pt.json:
```json
"rental_cost_frequency": "Frequência do valor",
"rental_cost_daily": "Diário",
"rental_cost_weekly": "Semanal",
"rental_cost_monthly": "Mensal",
"rental_cost_amount": "Valor do aluguel",
```

en.json:
```json
"rental_cost_frequency": "Cost frequency",
"rental_cost_daily": "Daily",
"rental_cost_weekly": "Weekly",
"rental_cost_monthly": "Monthly",
"rental_cost_amount": "Rental cost",
```

es.json:
```json
"rental_cost_frequency": "Frecuencia del valor",
"rental_cost_daily": "Diario",
"rental_cost_weekly": "Semanal",
"rental_cost_monthly": "Mensual",
"rental_cost_amount": "Valor del alquiler",
```

In the `"expense"` section, immediately after the existing `"frequency_annual"` key, add:
- `"frequency_daily"`.
In the same section, immediately after the existing `"recurring_frequency"` key's block (after `"frequency_annual"`), also add:
- `"ends_at"`: label for the new end-date field.
- `"ends_at_hint"`: short explanatory hint.

pt.json:
```json
"frequency_daily": "Diário",
```
```json
"ends_at": "Data de encerramento (opcional)",
"ends_at_hint": "A partir dessa data, essa despesa para de ser rateada nos seus dias — o histórico antes dela não muda.",
```

en.json:
```json
"frequency_daily": "Daily",
```
```json
"ends_at": "End date (optional)",
"ends_at_hint": "From this date on, this expense stops being allocated to your days — history before it is unchanged.",
```

es.json:
```json
"frequency_daily": "Diario",
```
```json
"ends_at": "Fecha de finalización (opcional)",
"ends_at_hint": "A partir de esta fecha, este gasto deja de prorratearse en tus días — el historial anterior no cambia.",
```

In the `"more"` section (near the existing `"vehicle_error"` key), add the "Encerrar" shortcut button label and its confirmation text:

pt.json:
```json
"vehicle_end_recurring_cost": "Encerrar aluguel/financiamento",
"vehicle_end_recurring_cost_confirm": "Isso encerra o valor recorrente desse veículo a partir de hoje. Dias anteriores não mudam. Confirmar?",
```

en.json:
```json
"vehicle_end_recurring_cost": "End rent/financing",
"vehicle_end_recurring_cost_confirm": "This ends this vehicle's recurring cost starting today. Past days are unchanged. Confirm?",
```

es.json:
```json
"vehicle_end_recurring_cost": "Finalizar alquiler/financiamiento",
"vehicle_end_recurring_cost_confirm": "Esto finaliza el costo recurrente de este vehículo a partir de hoy. Los días anteriores no cambian. ¿Confirmar?",
```

- [ ] **Step 2: Verify all three files still parse as valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('locales/pt.json', 'utf8')); JSON.parse(require('fs').readFileSync('locales/en.json', 'utf8')); JSON.parse(require('fs').readFileSync('locales/es.json', 'utf8')); console.log('OK')"`
Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add locales/pt.json locales/en.json locales/es.json
git commit -m "Adiciona strings de custo recorrente diário/semanal e encerramento"
```

---

### Task 8: Registration UI (`register.tsx`) — daily/weekly/monthly selector for rent

**Files:**
- Modify: `app/(auth)/register.tsx`

**Interfaces:**
- Consumes: `RegistrationInput.vehicle.rentalCostFrequency` (Task 6), locale keys from Task 7.

- [ ] **Step 1: Add frequency state**

Near the existing `const [monthlyCost, setMonthlyCost] = useState('0');` (Seção 3, Veículo state block), add:

```ts
  const [rentalCostFrequency, setRentalCostFrequency] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
```

- [ ] **Step 2: Replace the "Custo mensal" field with a conditional frequency selector**

Find this block (Seção 3, right after the `ownership` `Select` / rental-fields conditional block, before `</Section>`):

```tsx
            <Text style={s.label}>{t('onboarding.monthly_cost')}</Text>
            <TextInput
              style={inp}
              value={monthlyCost}
              onChangeText={setMonthlyCost}
              keyboardType="decimal-pad"
              placeholderTextColor={Colors.textSecondary}
              accessibilityLabel={t('onboarding.monthly_cost')}
            />
```

Replace it with:

```tsx
            {ownership === 'rent' ? (
              <>
                <Text style={s.label}>{t('onboarding.rental_cost_frequency')}</Text>
                <Select
                  value={rentalCostFrequency}
                  onValueChange={(v) => setRentalCostFrequency(v as 'daily' | 'weekly' | 'monthly')}
                  items={[
                    { label: t('onboarding.rental_cost_daily'), value: 'daily' },
                    { label: t('onboarding.rental_cost_weekly'), value: 'weekly' },
                    { label: t('onboarding.rental_cost_monthly'), value: 'monthly' },
                  ]}
                />
                <Text style={s.label}>{t('onboarding.rental_cost_amount')}</Text>
                <TextInput
                  style={inp}
                  value={monthlyCost}
                  onChangeText={setMonthlyCost}
                  keyboardType="decimal-pad"
                  placeholderTextColor={Colors.textSecondary}
                  accessibilityLabel={t('onboarding.rental_cost_amount')}
                />
              </>
            ) : (
              <>
                <Text style={s.label}>{t('onboarding.monthly_cost')}</Text>
                <TextInput
                  style={inp}
                  value={monthlyCost}
                  onChangeText={setMonthlyCost}
                  keyboardType="decimal-pad"
                  placeholderTextColor={Colors.textSecondary}
                  accessibilityLabel={t('onboarding.monthly_cost')}
                />
              </>
            )}
```

(`monthlyCost`/`setMonthlyCost` stay the single amount field regardless of branch — only the label and the presence of the frequency selector change. This keeps `buildInput()` below untouched for the amount itself.)

- [ ] **Step 3: Pass the frequency through in `buildInput()`**

In `buildInput()`, inside the returned `vehicle: { ... }` object, add one field:

```ts
      vehicle: {
        brand: brand.trim(),
        model: model.trim(),
        year: parseInt(year, 10) || new Date().getFullYear(),
        fuel_type: fuelType,
        avg_consumption_per_100: 0,
        ownership_type: ownership,
        monthly_cost_cents: decimalToCents(parseFloat(monthlyCost) || 0),
        rentalCostFrequency,
        // ...rest of the existing fields unchanged
```

- [ ] **Step 4: Manual verification (no automated UI test exists for this screen today — match that)**

Run: `npx tsc --noEmit -p .`
Expected: no new errors in `app/(auth)/register.tsx` (pre-existing unrelated errors elsewhere in the project, e.g. `more.tsx:149/152` `searchRow`/`searchInput`, are not introduced by this task and can be ignored).

- [ ] **Step 5: Commit**

```bash
git add "app/(auth)/register.tsx"
git commit -m "Cadastro: seletor diário/semanal/mensal para veículo alugado"
```

---

### Task 9: Vehicle edit UI (`more.tsx` `VehicleModal`) — selector + "Encerrar" shortcut

**Files:**
- Modify: `app/(tabs)/more.tsx`

**Interfaces:**
- Consumes: `getVehicleRecurringCost`, `syncVehicleRecurringCost`, `endVehicleRecurringCost` (Task 5), locale keys from Task 7.

- [ ] **Step 1: Import the new vehicle-cost functions**

Change the existing import:
```ts
import { createVehicle, updateVehicle } from '@/src/services/vehicles';
```
to:
```ts
import { createVehicle, updateVehicle, getVehicleRecurringCost, syncVehicleRecurringCost, endVehicleRecurringCost, type VehicleRecurringCost } from '@/src/services/vehicles';
```

- [ ] **Step 2: Add state for the linked cost, frequency selector, and cost amount**

VehicleModal today has no visible "monthly cost" `TextInput` at all (`handleSave` hardcodes `monthly_cost_cents: 0` when creating, and `updateVehicle`'s call doesn't touch cost fields) — this task ADDS the field, it doesn't relabel an existing one. In `VehicleModal`, alongside the existing `const [ownership, setOwnership] = useState<OwnershipType>('own');` block, add:

```ts
  const [rentalCostFrequency, setRentalCostFrequency] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [costAmount, setCostAmount] = useState('0');
  const [linkedCost, setLinkedCost] = useState<VehicleRecurringCost | null>(null);
  const [endingCost, setEndingCost] = useState(false);
```

- [ ] **Step 3: Fetch the linked cost when editing an existing vehicle**

Find this block (the existing `useEffect` that populates form state when the modal opens):

```ts
  useEffect(() => {
    if (visible && vehicle) {
      setBrand(vehicle.brand); setModel(vehicle.model);
      setYear(String(vehicle.year)); setFuel(vehicle.fuel_type);
      setOwnership(vehicle.ownership_type);
      setRentalStartDate(vehicle.rental_contract_start_date ?? '');
      setRentalStartOdometer(
        vehicle.rental_contract_start_odometer != null
          ? String(metersToDisplay(vehicle.rental_contract_start_odometer, 'km'))
          : ''
      );
      setAllowancePeriod(vehicle.rental_km_allowance_period ?? 'unlimited');
      setAllowanceAmount(vehicle.rental_km_allowance_amount != null ? String(vehicle.rental_km_allowance_amount) : '');
      setExcessRate(vehicle.rental_km_excess_rate_cents != null ? String(centsToDecimal(vehicle.rental_km_excess_rate_cents)) : '');
    } else if (visible && !vehicle) {
      setBrand(''); setModel(''); setYear(String(new Date().getFullYear()));
      setFuel('gasoline');
      setOwnership('own');
      setRentalStartDate(''); setRentalStartOdometer('');
      setAllowancePeriod('unlimited'); setAllowanceAmount(''); setExcessRate('');
    }
  }, [visible, vehicle]);
```

Replace it with:

```ts
  useEffect(() => {
    if (visible && vehicle) {
      setBrand(vehicle.brand); setModel(vehicle.model);
      setYear(String(vehicle.year)); setFuel(vehicle.fuel_type);
      setOwnership(vehicle.ownership_type);
      setRentalStartDate(vehicle.rental_contract_start_date ?? '');
      setRentalStartOdometer(
        vehicle.rental_contract_start_odometer != null
          ? String(metersToDisplay(vehicle.rental_contract_start_odometer, 'km'))
          : ''
      );
      setAllowancePeriod(vehicle.rental_km_allowance_period ?? 'unlimited');
      setAllowanceAmount(vehicle.rental_km_allowance_amount != null ? String(vehicle.rental_km_allowance_amount) : '');
      setExcessRate(vehicle.rental_km_excess_rate_cents != null ? String(centsToDecimal(vehicle.rental_km_excess_rate_cents)) : '');
      getVehicleRecurringCost(vehicle.id).then(cost => {
        setLinkedCost(cost);
        if (cost) {
          setCostAmount((cost.amountCents / 100).toFixed(2));
          if (cost.frequency === 'daily' || cost.frequency === 'weekly' || cost.frequency === 'monthly') {
            setRentalCostFrequency(cost.frequency);
          }
        } else {
          setCostAmount('0');
        }
      }).catch(() => { setLinkedCost(null); setCostAmount('0'); });
    } else if (visible && !vehicle) {
      setBrand(''); setModel(''); setYear(String(new Date().getFullYear()));
      setFuel('gasoline');
      setOwnership('own');
      setRentalStartDate(''); setRentalStartOdometer('');
      setAllowancePeriod('unlimited'); setAllowanceAmount(''); setExcessRate('');
      setRentalCostFrequency('monthly'); setCostAmount('0'); setLinkedCost(null);
    }
  }, [visible, vehicle]);
```

- [ ] **Step 4: Add the frequency selector + amount field + "Encerrar" shortcut to the JSX**

In the JSX, immediately after the existing `ownership` `Select` (before the `{ownership === 'rent' ? (...rental fields...) : null}` block), add:

The surrounding `VehicleModal` JSX uses a module-level `StyleSheet.create` object named `s` (same one `LocationModal` above it in this file uses — `s.fieldLabel`, `s.fieldInput`, `s.cancelBtn`, `s.cancelBtnText`, etc.). `Alert` is already imported at the top of `more.tsx` (`import { ActivityIndicator, Alert, KeyboardAvoidingView, ... } from 'react-native';`) — no new import needed.

```tsx
          {ownership !== 'own' && (
            <>
              {ownership === 'rent' && (
                <>
                  <Text style={s.fieldLabel}>{t('onboarding.rental_cost_frequency')}</Text>
                  <Select
                    value={rentalCostFrequency}
                    onValueChange={(v) => setRentalCostFrequency(v as 'daily' | 'weekly' | 'monthly')}
                    items={[
                      { label: t('onboarding.rental_cost_daily'), value: 'daily' },
                      { label: t('onboarding.rental_cost_weekly'), value: 'weekly' },
                      { label: t('onboarding.rental_cost_monthly'), value: 'monthly' },
                    ]}
                  />
                </>
              )}
              <Text style={s.fieldLabel}>{ownership === 'rent' ? t('onboarding.rental_cost_amount') : t('onboarding.monthly_cost')}</Text>
              <TextInput
                style={s.fieldInput}
                value={costAmount}
                onChangeText={setCostAmount}
                keyboardType="decimal-pad"
                placeholderTextColor={Colors.textSecondary}
              />
              {linkedCost && !linkedCost.endsAt && (
                <TouchableOpacity
                  style={s.cancelBtn}
                  disabled={endingCost}
                  onPress={() => {
                    Alert.alert(
                      t('more.vehicle_end_recurring_cost'),
                      t('more.vehicle_end_recurring_cost_confirm'),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t('more.vehicle_end_recurring_cost'),
                          style: 'destructive',
                          onPress: async () => {
                            if (!vehicle) return;
                            setEndingCost(true);
                            try {
                              await endVehicleRecurringCost(vehicle.id);
                              const refreshed = await getVehicleRecurringCost(vehicle.id);
                              setLinkedCost(refreshed);
                            } finally {
                              setEndingCost(false);
                            }
                          },
                        },
                      ],
                    );
                  }}
                >
                  <Text style={s.cancelBtnText}>{t('more.vehicle_end_recurring_cost')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}
```

- [ ] **Step 5: Wire `handleSave` to call `syncVehicleRecurringCost` after creating/updating the vehicle**

Find this block in `handleSave` (the exact code already present, including today's `more.tsx:337` fix):

```ts
    setSaving(true); setError('');
    try {
      if (vehicle) {
        await updateVehicle(vehicle.id, { brand: brand.trim(), model: model.trim(), year: parseInt(year) || vehicle.year, fuel_type: fuel, ...rentalFields });
      } else {
        const newVehicle = await createVehicle({ user_id: userId, name: `${brand.trim()} ${model.trim()}`, brand: brand.trim(), model: model.trim(), year: parseInt(year) || new Date().getFullYear(), fuel_type: fuel, avg_consumption_per_100: 0, monthly_cost_cents: 0, monthly_insurance_cents: 0, current_odometer: 0, is_taxi: false, taxi_license_monthly_cents: 0, ...rentalFields });
        const { error: linkError } = await supabase.from('profiles')
          .update({ vehicle_id: newVehicle.id })
          .eq('id', userId);
        if (linkError) throw linkError;
      }
      onSaved();
    } catch { setError(t('more.vehicle_error')); }
    finally { setSaving(false); }
  }
```

Replace it with:

```ts
    setSaving(true); setError('');
    try {
      let targetVehicleId: string;
      if (vehicle) {
        await updateVehicle(vehicle.id, { brand: brand.trim(), model: model.trim(), year: parseInt(year) || vehicle.year, fuel_type: fuel, ...rentalFields });
        targetVehicleId = vehicle.id;
      } else {
        const newVehicle = await createVehicle({ user_id: userId, name: `${brand.trim()} ${model.trim()}`, brand: brand.trim(), model: model.trim(), year: parseInt(year) || new Date().getFullYear(), fuel_type: fuel, avg_consumption_per_100: 0, monthly_cost_cents: 0, monthly_insurance_cents: 0, current_odometer: 0, is_taxi: false, taxi_license_monthly_cents: 0, ...rentalFields });
        const { error: linkError } = await supabase.from('profiles')
          .update({ vehicle_id: newVehicle.id })
          .eq('id', userId);
        if (linkError) throw linkError;
        targetVehicleId = newVehicle.id;
      }
      await syncVehicleRecurringCost({
        vehicleId: targetVehicleId,
        userId,
        ownershipType: ownership,
        amountCents: decimalToCents(parseFloat(costAmount.replace(',', '.')) || 0),
        frequency: ownership === 'rent' ? rentalCostFrequency : 'monthly',
      });
      onSaved();
    } catch { setError(t('more.vehicle_error')); }
    finally { setSaving(false); }
  }
```

(`decimalToCents` is already imported in this file per its existing top-level imports.)

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no new errors introduced in `app/(tabs)/more.tsx` beyond the pre-existing, unrelated `searchRow`/`searchInput` errors at lines 149/152 (confirmed pre-existing during today's earlier session — not something this task touches).

- [ ] **Step 7: Commit**

```bash
git add "app/(tabs)/more.tsx"
git commit -m "Edição de veículo: seletor de frequência e atalho para encerrar custo recorrente"
```

---

### Task 10: Despesas tab (`expenses.tsx`) — `'daily'` option + "Data de encerramento"

**Files:**
- Modify: `src/services/expenses.ts`
- Modify: `app/(tabs)/expenses.tsx`

**Interfaces:**
- Produces: `Expense` (from `src/services/expenses.ts`) gains `ends_at: string | null`; `RecurringFrequency` (same file) gains `'daily'`.

- [ ] **Step 1: Extend the service type**

In `src/services/expenses.ts`:

```ts
export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export interface Expense {
  id: string;
  user_id: string;
  category: string;
  amount_cents: number;
  expense_date: string;  // YYYY-MM-DD
  description: string | null;
  recurring: boolean;
  recurring_frequency: RecurringFrequency | null;
  ends_at: string | null;
}
```

- [ ] **Step 2: Add `'daily'` to the local frequency list in `expenses.tsx`**

```ts
const RECURRING_FREQUENCIES = [
  'daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual',
] as const;
```

- [ ] **Step 3: Add the `ends_at` field to `ExpenseForm` (the edit form)**

Add state, alongside the existing `const [frequency, setFrequency] = useState<RecurringFrequency>(...)`:

```ts
  const [endsAt, setEndsAt] = useState((initialValues as any)?.ends_at ?? '');
```

In `handleSave`, add `ends_at` to the object passed to `onSave`:

```ts
    onSave({
      category,
      amount_cents: decimalToCents(amountNum),
      expense_date: trimmedDate,
      description: description.trim() !== '' ? description.trim() : null,
      recurring,
      recurring_frequency: recurring ? frequency : null,
      ends_at: recurring && endsAt.trim() !== '' ? endsAt.trim() : null,
    });
```

In the JSX, immediately after the existing frequency `Select` (still inside the `{recurring && (...)}` block), add:

```tsx
            <Text style={styles.label}>{t('expense.ends_at')}</Text>
            <TextInput
              style={styles.input}
              value={endsAt}
              onChangeText={setEndsAt}
              placeholder="AAAA-MM-DD"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
            <Text style={styles.hint}>{t('expense.ends_at_hint')}</Text>
```

`expenses.tsx`'s `StyleSheet.create({...})` has no `hint` style yet (only `installmentHint`, styled as an accent-colored callout unsuited for this plain explanatory note). Add one, alongside the existing `installmentHint: { color: Colors.accent, fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 4 },` line:

```ts
  hint: { color: Colors.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 4 },
```

- [ ] **Step 4: Add the same field to `AddExpenseModal` (the quick-add form)**

Add state, alongside the existing `const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');`:

```ts
  const [endsAt, setEndsAt] = useState('');
```

Reset it in `resetForm()`, alongside `setFrequency('monthly');`:

```ts
    setEndsAt('');
```

In `handleSave`, the `n === 1` branch's `addExpense(...)` call gains one field:

```ts
          await addExpense({ user_id: userId, category, amount_cents: totalCents, expense_date: trimmedDate, description: desc, recurring, recurring_frequency: recurring ? frequency : null, ends_at: recurring && endsAt.trim() !== '' ? endsAt.trim() : null });
```

(The `n > 1` installments branch stays `recurring: false, recurring_frequency: null` — add `ends_at: null` there too for type completeness, since `Expense`'s `ends_at` field is now non-optional.)

In the JSX, immediately after the existing frequency `Select` (still inside `{recurring && (...)}`):

```tsx
                      <Text style={styles.label}>{t('expense.ends_at')}</Text>
                      <TextInput
                        style={styles.input}
                        value={endsAt}
                        onChangeText={setEndsAt}
                        placeholder="AAAA-MM-DD"
                        placeholderTextColor={Colors.textSecondary}
                        autoCapitalize="none"
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                      />
                      <Text style={styles.hint}>{t('expense.ends_at_hint')}</Text>
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no new errors in `src/services/expenses.ts` or `app/(tabs)/expenses.tsx`.

- [ ] **Step 6: Commit**

```bash
git add "src/services/expenses.ts" "app/(tabs)/expenses.tsx"
git commit -m "Despesas: frequência diária e data de encerramento de despesa recorrente"
```

---

### Task 11: Full regression pass + deploy

**Files:** none (verification + deploy only).

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: PASS, all suites, no regressions.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit -p .`
Expected: same pre-existing error set as before this plan started (`__tests__/app/*.test.tsx` jest-namespace errors, `more.tsx:149/152` `searchRow`/`searchInput`) — no new errors.

- [ ] **Step 3: Manually verify Eddie's real account picks up the migrated rent expense correctly**

Run via `mcp__claude_ai_Supabase__execute_sql` (`project_id: ucxkvxqpkknxotbfxgeu`):

```sql
select id, vehicle_id, category, amount_cents, recurring_frequency, ends_at
from expenses
where user_id = 'db85eea7-8cd7-464d-ba68-05f1e8a15560' and recurring = true;
```

Expected: the R$804,31/semana row now shows `vehicle_id = '4483a9f5-10b0-442c-9732-415a1dc27264'` (from Task 2) and `ends_at` is `null`.

- [ ] **Step 4: Deploy to production**

```bash
cd "app-motorista"
git push origin master
vercel --prod --yes
```

(This project's GitHub → Vercel auto-deploy is broken — Root Directory misconfigured — so the manual `vercel --prod` step is required; `git push` alone will not update `app.paldrivy.com`.)

Expected: `vercel --prod` output shows `"readyState": "READY"`, `"target": "production"`.

- [ ] **Step 5: Update the Obsidian project note**

Append a dated entry to `D:\Obsidian\Claude Code\PalDrivy.md` under a new `## Sessão 2026-08-14 (continuação) — custo recorrente do veículo` heading, following the style of this file's existing session entries: what was built, files changed, that a new AAB build is still needed for the native app to pick this up (same as every web-only fix from earlier today).
