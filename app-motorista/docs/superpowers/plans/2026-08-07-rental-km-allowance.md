# Rental Vehicle KM/Mile Allowance Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** track total odometer usage (work + personal) for rented vehicles against the rental contract's km allowance, alert in the dashboard hero as the driver approaches/exceeds it, and let them optionally log the estimated overage as an expense.

**Architecture:** a pure calculation utility (period bounds + usage math, no Supabase), a thin service layer that fetches shift/fuel-entry odometer readings for one vehicle and calls the utility, a dashboard hero banner component, and new conditional fields in both vehicle forms (onboarding + edit).

**Tech Stack:** React Native/Expo (SDK 56), TypeScript, Supabase (Postgres), react-i18next (5 locales: pt/en/es/fr/zh), Jest + Testing Library.

## Global Constraints

- Work in **km only** internally and for display — the app has no existing km↔mi conversion infrastructure anywhere (`distance_unit` on `profiles` is stored but not currently used to convert any display value), so building unit conversion for just this one feature would be inconsistent with the rest of the codebase. Store `rental_km_allowance_amount` as a plain km integer. This is a deliberate deviation from the design spec's "respect distance_unit" language — noted there as an aspiration, but there is no existing pattern to hook into, and building one is out of scope here (YAGNI).
- `rental_contract_start_odometer` is OPTIONAL. `rental_contract_start_date` is REQUIRED whenever `rental_km_allowance_period != 'unlimited'`.
- Odometer values are stored in **meters** everywhere in this schema (`odometer_start_meters`, `odometer_end_meters`, `odometer_meters`) — convert to km only at the boundary where a human-readable number is needed.
- No new tables. Five new nullable columns on `public.vehicles`, following the existing pattern of ownership-type-conditional columns already there.
- Every new pure function goes in `src/utils/`, tested in `__tests__/utils/`, with no Supabase import — matches `cockpitUtils.ts`/`fuelConsumptionUtils.ts`.
- `expenses.category` is a free-text column (no check constraint) — the new `km_excedente` category needs no migration.

---

### Task 1: DB migration — rental allowance columns

**Files:**
- Create: `supabase/migrations/20260807120000_rental_km_allowance.sql`

**Interfaces:**
- Produces: five new nullable columns on `public.vehicles`, consumed by every later task.

- [ ] **Step 1: Write the migration**

```sql
alter table public.vehicles
  add column rental_contract_start_date date,
  add column rental_contract_start_odometer integer,
  add column rental_km_allowance_period text
    check (rental_km_allowance_period in ('weekly', 'monthly', 'unlimited')),
  add column rental_km_allowance_amount integer,
  add column rental_km_excess_rate_cents integer;

comment on column public.vehicles.rental_contract_start_date is
  'Anchor date for km-allowance period calculation. Required (application-level, not DB-level) whenever rental_km_allowance_period is set and not ''unlimited''.';
comment on column public.vehicles.rental_contract_start_odometer is
  'Odometer at rental pickup, in meters. Optional -- drivers joining mid-contract may not remember it; see rentalKmAllowanceUtils.ts for the fallback baseline.';
comment on column public.vehicles.rental_km_allowance_amount is
  'Allowance in whole km per period. This app has no unit-conversion infrastructure yet, so this is always km regardless of profiles.distance_unit.';
```

- [ ] **Step 2: Apply the migration**

This project's Supabase is MCP-linked (project_id `ucxkvxqpkknxotbfxgeu`). Apply via the `apply_migration` MCP tool with the file's contents, or paste into the Supabase Dashboard SQL editor if MCP access isn't available in your environment. Confirm success before continuing — every later task depends on these columns existing.

- [ ] **Step 3: Update the `Vehicle` type**

Edit `src/types/index.ts`:

```ts
export type RentalAllowancePeriod = 'weekly' | 'monthly' | 'unlimited';

export interface Vehicle {
  id: string;
  user_id: string;
  name: string;
  brand: string;
  model: string;
  year: number;
  plate?: string;
  fuel_type: FuelType;
  avg_consumption_per_100: number;
  ownership_type: OwnershipType;
  monthly_cost_cents: number;
  monthly_insurance_cents: number;
  current_odometer: number;
  purchase_price_cents?: number;
  purchase_date?: string;
  target_swap_years?: number;
  target_swap_budget_cents?: number;
  is_taxi: boolean;
  taxi_license_monthly_cents: number;
  rental_contract_start_date?: string | null;
  rental_contract_start_odometer?: number | null;
  rental_km_allowance_period?: RentalAllowancePeriod | null;
  rental_km_allowance_amount?: number | null;
  rental_km_excess_rate_cents?: number | null;
  created_at: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807120000_rental_km_allowance.sql src/types/index.ts
git commit -m "feat: add rental km-allowance columns to vehicles"
```

---

### Task 2: Pure calculation utility

**Files:**
- Create: `src/utils/rentalKmAllowanceUtils.ts`
- Test: `__tests__/utils/rentalKmAllowanceUtils.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no Supabase).
- Produces: `getPeriodBounds`, `computeRentalAllowanceStatus` — consumed by Task 3's service layer.

- [ ] **Step 1: Write the failing tests**

```ts
import { getPeriodBounds, computeRentalAllowanceStatus, type OdometerReading } from '@/src/utils/rentalKmAllowanceUtils';

describe('getPeriodBounds', () => {
  it('returns null for unlimited', () => {
    expect(getPeriodBounds('2026-08-05', 'unlimited', new Date('2026-08-20'))).toBeNull();
  });

  it('computes the current weekly period from the contract start date', () => {
    // contract started Wed 2026-08-05; "now" is 10 days later (2026-08-15,
    // a Saturday) -> period 2 is [2026-08-12, 2026-08-19)
    const bounds = getPeriodBounds('2026-08-05', 'weekly', new Date('2026-08-15T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-08-12T00:00:00.000Z'),
      periodEnd: new Date('2026-08-19T00:00:00.000Z'),
    });
  });

  it('computes the current monthly period from the contract start date', () => {
    // contract started 2026-08-05; "now" is 2026-09-10 -> period 2 is [2026-09-05, 2026-10-05)
    const bounds = getPeriodBounds('2026-08-05', 'monthly', new Date('2026-09-10T12:00:00Z'));
    expect(bounds).toEqual({
      periodStart: new Date('2026-09-05T00:00:00.000Z'),
      periodEnd: new Date('2026-10-05T00:00:00.000Z'),
    });
  });
});

describe('computeRentalAllowanceStatus', () => {
  const readings: OdometerReading[] = [
    { odometerMeters: 18332000, at: '2026-08-05T09:00:00Z' }, // contract start reading (also passed explicitly below)
    { odometerMeters: 18522000, at: '2026-08-06T18:00:00Z' }, // end of a shift
    { odometerMeters: 18622000, at: '2026-08-07T08:30:00Z' }, // start of next shift -- 100km gap is leisure driving
  ];

  it('uses the explicit contract-start odometer as the first period baseline', () => {
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
    expect(status?.usageKm).toBe(290);
    expect(status?.percentUsed).toBeCloseTo(290 / 500);
    expect(status?.isNearLimit).toBe(false);
    expect(status?.isOverLimit).toBe(false);
  });

  it('falls back to the earliest in-period reading when no explicit start odometer is given (mid-contract signup)', () => {
    const status = computeRentalAllowanceStatus({
      contractStartDate: '2026-08-05',
      contractStartOdometerMeters: null,
      allowancePeriod: 'weekly',
      allowanceAmountKm: 500,
      excessRateCents: 150,
      readings, // first reading in-period (18332000) becomes the baseline itself
      now: new Date('2026-08-07T09:00:00Z'),
    });
    // baseline = first reading (18332000) itself -> usage = 18622000-18332000 = 290km, identical
    // result here, but arrived at via the fallback path, not the explicit odometer
    expect(status?.usageKm).toBe(290);
  });

  it('flags near-limit at >=90% and over-limit at >=100%, with an overage cost estimate', () => {
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
    expect(status?.overageKm).toBe(20);
    expect(status?.overageCostCents).toBe(20 * 150);
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

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/utils/rentalKmAllowanceUtils.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/rentalKmAllowanceUtils.ts __tests__/utils/rentalKmAllowanceUtils.test.ts
git commit -m "feat: pure km-allowance period and usage calculation"
```

---

### Task 3: Service layer — fetch readings and compute status

**Files:**
- Create: `src/services/rentalAllowance.ts`
- Test: `__tests__/services/rentalAllowance.test.ts`

**Interfaces:**
- Consumes: `computeRentalAllowanceStatus`, `OdometerReading` (Task 2); `supabase` client (`src/lib/supabase.ts`).
- Produces: `getRentalAllowanceStatus(vehicle: Vehicle): Promise<RentalAllowanceStatus | null>` — consumed by Task 4.

- [ ] **Step 1: Write the failing test**

```ts
import { getRentalAllowanceStatus } from '@/src/services/rentalAllowance';
import { supabase } from '@/src/lib/supabase';
import type { Vehicle } from '@/src/types';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

function mockVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v1', user_id: 'u1', name: 'Kwid', brand: 'Renault', model: 'Kwid', year: 2026,
    fuel_type: 'ethanol', avg_consumption_per_100: 1100, ownership_type: 'rent',
    monthly_cost_cents: 0, monthly_insurance_cents: 0, current_odometer: 18622000,
    is_taxi: false, taxi_license_monthly_cents: 0, created_at: '2026-08-05T00:00:00Z',
    rental_contract_start_date: '2026-08-05',
    rental_contract_start_odometer: 18332000,
    rental_km_allowance_period: 'weekly',
    rental_km_allowance_amount: 500,
    rental_km_excess_rate_cents: 150,
    ...overrides,
  };
}

describe('getRentalAllowanceStatus', () => {
  it('returns null immediately for a non-rental vehicle, without querying', async () => {
    const vehicle = mockVehicle({ ownership_type: 'own' });
    const result = await getRentalAllowanceStatus(vehicle);
    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns null for unlimited allowance, without querying', async () => {
    const vehicle = mockVehicle({ rental_km_allowance_period: 'unlimited' });
    const result = await getRentalAllowanceStatus(vehicle);
    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('combines shift and fuel-entry odometer readings for the vehicle', async () => {
    const vehicle = mockVehicle();
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'shifts') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({
          data: [
            { odometer_start_meters: 18332000, odometer_end_meters: 18522000, started_at: '2026-08-06T08:00:00Z' },
          ],
        }) }) }) };
      }
      if (table === 'fuel_entries') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({
          data: [
            { odometer_meters: 18622000, filled_at: '2026-08-07T08:30:00Z' },
          ],
        }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getRentalAllowanceStatus(vehicle, new Date('2026-08-07T09:00:00Z'));
    expect(result?.usageKm).toBe(290); // 18622000 - 18332000
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/services/rentalAllowance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { supabase } from '../lib/supabase';
import { computeRentalAllowanceStatus, type OdometerReading, type RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';
import type { Vehicle } from '../types';

export async function getRentalAllowanceStatus(
  vehicle: Vehicle,
  now: Date = new Date(),
): Promise<RentalAllowanceStatus | null> {
  if (vehicle.ownership_type !== 'rent') return null;
  if (!vehicle.rental_km_allowance_period || vehicle.rental_km_allowance_period === 'unlimited') return null;
  if (!vehicle.rental_contract_start_date) return null;

  const [{ data: shifts }, { data: fuelEntries }] = await Promise.all([
    supabase.from('shifts').select('odometer_start_meters, odometer_end_meters, started_at')
      .eq('vehicle_id', vehicle.id).eq('user_id', vehicle.user_id),
    supabase.from('fuel_entries').select('odometer_meters, filled_at')
      .eq('vehicle_id', vehicle.id).eq('user_id', vehicle.user_id),
  ]);

  const readings: OdometerReading[] = [];
  for (const s of shifts ?? []) {
    if (s.odometer_start_meters != null) readings.push({ odometerMeters: s.odometer_start_meters, at: s.started_at });
    if (s.odometer_end_meters != null) readings.push({ odometerMeters: s.odometer_end_meters, at: s.started_at });
  }
  for (const f of fuelEntries ?? []) {
    if (f.odometer_meters != null) readings.push({ odometerMeters: f.odometer_meters, at: f.filled_at });
  }

  return computeRentalAllowanceStatus({
    contractStartDate: vehicle.rental_contract_start_date,
    contractStartOdometerMeters: vehicle.rental_contract_start_odometer ?? null,
    allowancePeriod: vehicle.rental_km_allowance_period,
    allowanceAmountKm: vehicle.rental_km_allowance_amount ?? null,
    excessRateCents: vehicle.rental_km_excess_rate_cents ?? null,
    readings,
    now,
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/services/rentalAllowance.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/rentalAllowance.ts __tests__/services/rentalAllowance.test.ts
git commit -m "feat: fetch shift/fuel odometer readings and compute rental allowance status"
```

---

### Task 4: Dashboard hero banner

**Files:**
- Create: `src/components/RentalAllowanceBanner.tsx`
- Test: `__tests__/components/RentalAllowanceBanner.test.tsx`
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `getRentalAllowanceStatus` (Task 3), `RentalAllowanceStatus` type (Task 2).
- Produces: nothing consumed elsewhere (leaf UI component).

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen } from '@testing-library/react-native';
import { RentalAllowanceBanner } from '@/src/components/RentalAllowanceBanner';
import type { RentalAllowanceStatus } from '@/src/utils/rentalKmAllowanceUtils';

function makeStatus(overrides: Partial<RentalAllowanceStatus> = {}): RentalAllowanceStatus {
  return {
    periodStart: new Date('2026-08-05'), periodEnd: new Date('2026-08-12'),
    baselineMeters: 18332000, currentOdometerMeters: 18622000,
    usageKm: 290, percentUsed: 0.58, isNearLimit: false, isOverLimit: false,
    overageKm: 0, overageCostCents: 0,
    ...overrides,
  };
}

describe('RentalAllowanceBanner', () => {
  it('renders nothing when status is null', () => {
    const { toJSON } = render(<RentalAllowanceBanner status={null} onAddExpense={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing below the near-limit threshold', () => {
    const { toJSON } = render(<RentalAllowanceBanner status={makeStatus()} onAddExpense={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('shows a warning banner at >=90%', () => {
    render(<RentalAllowanceBanner status={makeStatus({ isNearLimit: true, percentUsed: 0.92 })} onAddExpense={jest.fn()} />);
    expect(screen.getByTestId('rental-allowance-warning')).toBeTruthy();
  });

  it('shows an over-limit banner with an add-expense button at >=100%', () => {
    const onAddExpense = jest.fn();
    render(<RentalAllowanceBanner
      status={makeStatus({ isNearLimit: true, isOverLimit: true, percentUsed: 1.04, overageKm: 20, overageCostCents: 3000 })}
      onAddExpense={onAddExpense}
    />);
    const button = screen.getByRole('button');
    fireEvent.press(button);
    expect(onAddExpense).toHaveBeenCalledWith(3000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/components/RentalAllowanceBanner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Follow this file's existing banner/card visual conventions (check `src/components/CockpitCard.tsx`'s pill/badge styling for the color tokens and border-radius pattern already established — reuse `Colors`/`Radius`/`Spacing` from `src/theme`, don't invent new values):

```tsx
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import type { RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';

export function RentalAllowanceBanner({
  status, onAddExpense,
}: {
  status: RentalAllowanceStatus | null;
  onAddExpense: (overageCostCents: number) => void;
}) {
  const { t } = useTranslation();
  if (!status || !status.isNearLimit) return null;

  if (status.isOverLimit) {
    return (
      <View style={[s.banner, s.over]} testID="rental-allowance-over">
        <Text style={s.text}>
          {t('rental_allowance.over_limit', { km: status.overageKm.toFixed(0), cost: (status.overageCostCents / 100).toFixed(2) })}
        </Text>
        <TouchableOpacity
          style={s.button}
          onPress={() => onAddExpense(status.overageCostCents)}
          accessibilityRole="button"
          accessibilityLabel={t('rental_allowance.add_expense')}
        >
          <Text style={s.buttonText}>{t('rental_allowance.add_expense')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.banner, s.warning]} testID="rental-allowance-warning">
      <Text style={s.text}>
        {t('rental_allowance.near_limit', { percent: Math.round(status.percentUsed * 100) })}
      </Text>
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
  },
  warning: { backgroundColor: Colors.warningDim ?? Colors.accentDim },
  over: { backgroundColor: Colors.errorDim ?? Colors.accentDim },
  text: { color: Colors.textPrimary, fontSize: 14, flexShrink: 1 },
  button: { backgroundColor: Colors.accent, borderRadius: Radius.button, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  buttonText: { color: Colors.onBrand, fontSize: 13, fontWeight: '600' },
});
```

Note: verify `Colors.warningDim`/`Colors.errorDim` exist in `src/theme.ts` before using them — if they don't, use whatever this codebase's existing warning/error color tokens actually are (checked in earlier work today: `Colors.error` exists, used in the onboarding vehicle form's error text).

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/components/RentalAllowanceBanner.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire into the dashboard**

In `app/(tabs)/index.tsx`, add to the existing `Promise.all` load (near `vehicleP`/`goalData` — see the file's current load function): fetch the full vehicle row (already partially fetched as `vehicleP` — extend its `.select()` to include the five rental columns) and call `getRentalAllowanceStatus(vehicle)`. Render `<RentalAllowanceBanner status={rentalStatus} onAddExpense={handleAddOverageExpense} />` near the top of the hero section, above or alongside the vehicle picker pill. `handleAddOverageExpense` should call this app's existing expense-creation service function (find it in `src/services/expenses.ts` or equivalent) with `category: 'km_excedente'` and the given `amount_cents`, then show whatever success feedback this screen already uses for similar actions (check how other quick actions on this screen confirm success — match that pattern, don't invent a new one).

- [ ] **Step 6: Run full suite, build, commit**

```bash
npx jest && npx tsc --noEmit
git add src/components/RentalAllowanceBanner.tsx __tests__/components/RentalAllowanceBanner.test.tsx "app/(tabs)/index.tsx"
git commit -m "feat: show rental km-allowance banner on the dashboard hero"
```

---

### Task 5: i18n strings

**Files:**
- Modify: `locales/pt.json`, `en.json`, `es.json`, `fr.json`, `zh.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `rental_allowance.near_limit`, `rental_allowance.over_limit`, `rental_allowance.add_expense` keys, consumed by Task 4.

- [ ] **Step 1: Add the `rental_allowance` namespace to `locales/pt.json`**

```json
"rental_allowance": {
  "near_limit": "Você já usou {{percent}}% da sua franquia de km neste período.",
  "over_limit": "Franquia excedida em {{km}} km — ~R$ {{cost}} estimado.",
  "add_expense": "Adicionar como despesa"
}
```

- [ ] **Step 2: Add equivalent translations to `en.json`, `es.json`, `fr.json`, `zh.json`**

Match this app's existing tone/formatting conventions per locale (check how other percent/currency-interpolated strings are phrased in each file already — e.g. search for `{{percent}}` or `{{cost}}` usage elsewhere if any exists, otherwise match the general register of nearby keys).

- [ ] **Step 3: Run full suite, commit**

```bash
npx jest
git add locales/*.json
git commit -m "feat: add rental allowance i18n strings"
```

---

### Task 6: Vehicle form — onboarding flow (new users)

**Files:**
- Modify: `app/onboarding/vehicle.tsx`

**Interfaces:**
- Consumes: `RentalAllowancePeriod` type (Task 1), `createVehicle` (`src/services/vehicles.ts`, unchanged signature — `Vehicle` type already extended).

- [ ] **Step 1: Add state and conditional fields**

Follow the exact pattern already used for the `isTaxi` conditional block (`{isTaxi ? (...) : null}`) in this file. Add state:

```ts
const [rentalStartDate, setRentalStartDate] = useState('');
const [rentalStartOdometer, setRentalStartOdometer] = useState('');
const [allowancePeriod, setAllowancePeriod] = useState<RentalAllowancePeriod>('unlimited');
const [allowanceAmount, setAllowanceAmount] = useState('');
const [excessRate, setExcessRate] = useState('');
```

After the existing "ownership" `Select`, add:

```tsx
{ownership === 'rent' ? (
  <>
    <Text style={s.label}>{t('onboarding.rental_start_date')}</Text>
    <TextInput
      style={s.input}
      value={rentalStartDate}
      onChangeText={setRentalStartDate}
      placeholder="AAAA-MM-DD"
      placeholderTextColor={Colors.textSecondary}
      accessibilityLabel={t('onboarding.rental_start_date')}
    />

    <Text style={s.label}>{t('onboarding.rental_start_odometer')}</Text>
    <TextInput
      style={s.input}
      value={rentalStartOdometer}
      onChangeText={setRentalStartOdometer}
      keyboardType="numeric"
      placeholder={t('onboarding.rental_start_odometer_placeholder')}
      placeholderTextColor={Colors.textSecondary}
      accessibilityLabel={t('onboarding.rental_start_odometer')}
    />

    <Text style={s.label}>{t('onboarding.allowance_period')}</Text>
    <Select
      value={allowancePeriod}
      onValueChange={(v) => setAllowancePeriod(v as RentalAllowancePeriod)}
      items={[
        { label: t('onboarding.allowance_weekly'), value: 'weekly' },
        { label: t('onboarding.allowance_monthly'), value: 'monthly' },
        { label: t('onboarding.allowance_unlimited'), value: 'unlimited' },
      ]}
    />

    {allowancePeriod !== 'unlimited' ? (
      <>
        <Text style={s.label}>{t('onboarding.allowance_amount')}</Text>
        <TextInput
          style={s.input}
          value={allowanceAmount}
          onChangeText={setAllowanceAmount}
          keyboardType="numeric"
          placeholderTextColor={Colors.textSecondary}
          accessibilityLabel={t('onboarding.allowance_amount')}
        />

        <Text style={s.label}>{t('onboarding.excess_rate')}</Text>
        <TextInput
          style={s.input}
          value={excessRate}
          onChangeText={setExcessRate}
          keyboardType="decimal-pad"
          placeholderTextColor={Colors.textSecondary}
          accessibilityLabel={t('onboarding.excess_rate')}
        />
      </>
    ) : null}
  </>
) : null}
```

- [ ] **Step 2: Wire into `handleSave`**

Extend the `createVehicle` call:

```ts
await createVehicle({
  // ...existing fields...
  rental_contract_start_date: ownership === 'rent' && rentalStartDate ? rentalStartDate : null,
  rental_contract_start_odometer: ownership === 'rent' && rentalStartOdometer
    ? displayToMeters(parseFloat(rentalStartOdometer) || 0, 'km') : null,
  rental_km_allowance_period: ownership === 'rent' ? allowancePeriod : null,
  rental_km_allowance_amount: ownership === 'rent' && allowancePeriod !== 'unlimited' && allowanceAmount
    ? parseInt(allowanceAmount, 10) : null,
  rental_km_excess_rate_cents: ownership === 'rent' && allowancePeriod !== 'unlimited' && excessRate
    ? decimalToCents(parseFloat(excessRate) || 0) : null,
});
```

- [ ] **Step 3: Validate required field before save**

In the existing validation block (where `brand`/`model` are checked), add: if `ownership === 'rent' && allowancePeriod !== 'unlimited' && !rentalStartDate.trim()`, set the same required-field error and return early — matches this spec's "contract start date required unless unlimited" rule.

- [ ] **Step 4: Manual verification**

This screen has no existing test file (per this codebase's current test coverage) — run the app (`npx expo start`), walk through onboarding selecting "rent" + each allowance period option, confirm the conditional fields show/hide correctly and the save succeeds. If you want automated coverage here, add one matching whatever pattern (if any) exists for other onboarding screens — don't invent a new testing approach for just this file if the rest of `app/onboarding/` has none.

- [ ] **Step 5: Commit**

```bash
git add app/onboarding/vehicle.tsx
git commit -m "feat: collect rental km-allowance fields during vehicle onboarding"
```

---

### Task 7: Vehicle form — edit flow (existing vehicles)

**Files:**
- Modify: `app/(tabs)/more.tsx`

**Interfaces:**
- Consumes: same as Task 6.

- [ ] **Step 1: Locate the vehicle edit form inside `more.tsx`**

This file already renders a vehicle add/edit form (search for `vehicle_add`/`vehicle_edit`/`ownership_type` in this file — it's a large 1500+ line settings screen with several sections; find the specific vehicle-form section, don't touch unrelated sections). Apply the same conditional-fields pattern as Task 6, matching whatever local state/update pattern this specific section already uses (it may differ slightly from the onboarding screen's — e.g. it likely calls `updateVehicle(id, {...})` instead of `createVehicle`, and needs to pre-fill existing values when editing rather than starting blank).

- [ ] **Step 2: Pre-fill on edit**

When editing an existing vehicle (not creating a new one), initialize the new state fields from the vehicle's current `rental_*` column values (converting `rental_contract_start_odometer` from meters to a display km string the same way `current_odometer` is already pre-filled elsewhere in this form).

- [ ] **Step 3: Wire into the update call**

Extend whatever `updateVehicle(id, {...})` call this section makes with the same five fields as Task 6's `createVehicle` call.

- [ ] **Step 4: Manual verification**

Run the app, edit an existing 'own' vehicle to 'rent', fill the new fields, save, re-open the edit form, confirm the values persisted and re-populate correctly. Also verify switching a 'rent' vehicle back to 'own' doesn't crash the form (the rental fields should just stop rendering, values stay in the DB but become irrelevant, per the spec's explicit "no cleanup needed" note).

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/more.tsx"
git commit -m "feat: edit rental km-allowance fields for existing vehicles"
```

---

### Task 8: Full-flow verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: all suites pass, no regressions in any file this plan didn't touch.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this plan (pre-existing unrelated errors from other in-flight work are fine, per this session's established convention — diff against a `git stash` baseline if unsure which errors are new).

- [ ] **Step 3: Manual end-to-end check**

Using the real Supabase project data already used earlier today (rental vehicle owner db85eea7-8cd7-464d-ba68-05f1e8a15560, contract start 2026-08-05, odometer 18332): set that vehicle's new rental fields via the app's edit form (or directly via SQL matching the migration's columns), then load the dashboard and confirm the banner appears/doesn't appear as expected at the real current usage level.

- [ ] **Step 4: Report status**

This is a multi-task feature bundled with the guided-tour plan for the next release — do not deploy/build an AAB from this plan alone. Report completion and hold for the owner's release-bundling decision, matching this session's established pattern for every feature/fix today.
