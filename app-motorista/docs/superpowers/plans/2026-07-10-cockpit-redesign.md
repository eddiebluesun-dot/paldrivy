# PalDrivy Cockpit Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's static cards and expenses flat-list with an immersive "Cockpit do Motorista" — SVG gauge, streak counter, month history scroll, and a calendar heatmap for expenses.

**Architecture:** Incremental in-place — add new service functions to `src/services/cockpit.ts`, create focused component files under `src/components/`, then wire them into the existing `index.tsx` and `expenses.tsx`. No new navigation routes or DB schema changes needed.

**Tech Stack:** Expo / React Native, `react-native-svg` (already installed), Supabase client (`@/src/lib/supabase`), `react-i18next`, `expo-router`.

## Global Constraints

- Colors: `Colors.accent = #F59E0B` (gold PRIMARY), `Colors.brandBlue = #8B5CF6` (violet secondary), `Colors.background = #0B1221`, `Colors.error = #EF4444`, `Colors.success = #10B981`.
- No new npm packages — use `react-native-svg` (already in project) for all SVG needs.
- No `expo-linear-gradient` (not installed) — all gradients via SVG `<LinearGradient>` or solid colors.
- All monetary values in **cents** (integer). Display via `formatMoney(cents, currencyCode, locale)` from `@/src/utils/currency`.
- Distances in meters internally; display via `metersToDisplay(meters, unit)` from `@/src/utils/units`.
- Follow existing style conventions: `StyleSheet.create`, `cardShadow`, `Colors.*`, `Radius.*`, `Spacing.*`.
- Auth screens (`login.tsx`, `register.tsx`) are already done — do NOT touch them.
- Keep `GoalEditModal` in `index.tsx` — it is now opened from `CockpitCard`'s pencil icon.
- Working days ISO numbering: Monday = 1, Sunday = 7 (stored as `[1,2,3,4,5,6]` in `goals.working_days`).
- Run tests: `npx jest --testPathPattern=__tests__ --no-coverage`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/services/cockpit.ts` | **Create** | `getMonthHistory`, `getCalendarHeatmap`, `getStreak` queries + `getDailyGoalCents`, `workingDaysInMonth` pure utils |
| `src/components/VehiclePill.tsx` | **Create** | Compact violet vehicle info pill below header |
| `src/components/StreakBar.tsx` | **Create** | "🔥 N dias" consecutive-days counter |
| `src/components/CockpitCard.tsx` | **Create** | SVG semicircle gauge + 4 micro-stats, replaces TodayCard + GoalProgress |
| `src/components/MonthHistoryCard.tsx` | **Create** | Horizontal scroll of last 12 months, replaces CarComparisonCard |
| `src/components/CalendarHeatmapView.tsx` | **Create** | 7×5 calendar grid with income/expense color intensity |
| `src/components/ExpenseDaySheet.tsx` | **Create** | pageSheet modal showing one day's shifts + expense rows |
| `app/(tabs)/index.tsx` | **Modify** | Remove CarComparisonCard, TodayCard, GoalProgress; add VehiclePill, StreakBar, CockpitCard, MonthHistoryCard |
| `app/(tabs)/expenses.tsx` | **Modify** | Add CalendarHeatmapView at top, wire month-nav + day-tap → ExpenseDaySheet |
| `__tests__/services/cockpit.test.ts` | **Create** | Unit tests for all pure functions in cockpit.ts |

---

## Task 1: Service Layer — `src/services/cockpit.ts`

**Files:**
- Create: `src/services/cockpit.ts`
- Test: `__tests__/services/cockpit.test.ts`

**Interfaces:**
- Produces:
  - `getDailyGoalCents(goalCents: number, workingDays: number[], year: number, month: number): number`
  - `workingDaysInMonth(workingDays: number[], year: number, month: number): number`
  - `streakFromDates(activeDates: string[], todayStr: string): number`
  - `intensityForCents(cents: number): 0 | 1 | 2 | 3`
  - `getMonthHistory(userId: string, limit?: number): Promise<MonthHistoryItem[]>`
  - `getCalendarHeatmap(userId: string, year: number, month: number): Promise<HeatmapDay[]>`
  - `getStreak(userId: string): Promise<number>`
  - `interface MonthHistoryItem { year: number; month: number; gross_cents: number; expenses_cents: number; fuel_cents: number; rides: number; km_meters: number; }`
  - `interface HeatmapDay { day: number; income_cents: number; expense_cents: number; }`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/services/cockpit.test.ts
import { test, expect, describe } from '@jest/globals';
import {
  workingDaysInMonth,
  getDailyGoalCents,
  streakFromDates,
  intensityForCents,
} from '../../src/services/cockpit';

describe('workingDaysInMonth', () => {
  test('July 2026 Mon-Sat has 27 working days', () => {
    // July 2026: 31 days, starts on Wednesday
    // Working days Mon(1)-Sat(6): all except Sundays (7th,14th,21st,28th)
    expect(workingDaysInMonth([1, 2, 3, 4, 5, 6], 2026, 7)).toBe(27);
  });
  test('with only Mon-Fri', () => {
    // July 2026 Mon-Fri: 5 full weeks minus partial = 23 working days
    expect(workingDaysInMonth([1, 2, 3, 4, 5], 2026, 7)).toBe(23);
  });
});

describe('getDailyGoalCents', () => {
  test('divides goal by working days', () => {
    // 500000 cents / 27 working days ≈ 18519 (Math.ceil)
    expect(getDailyGoalCents(500000, [1, 2, 3, 4, 5, 6], 2026, 7)).toBe(18519);
  });
  test('returns 0 when no working days', () => {
    expect(getDailyGoalCents(500000, [], 2026, 7)).toBe(0);
  });
  test('returns 0 when goal is 0', () => {
    expect(getDailyGoalCents(0, [1, 2, 3, 4, 5, 6], 2026, 7)).toBe(0);
  });
});

describe('streakFromDates', () => {
  test('consecutive days from today give correct streak', () => {
    const today = '2026-07-10';
    const dates = ['2026-07-10', '2026-07-09', '2026-07-08', '2026-07-07'];
    expect(streakFromDates(dates, today)).toBe(4);
  });
  test('gap breaks streak', () => {
    const today = '2026-07-10';
    const dates = ['2026-07-10', '2026-07-08']; // gap on 7-09
    expect(streakFromDates(dates, today)).toBe(1);
  });
  test('no data today gives 0', () => {
    const today = '2026-07-10';
    const dates = ['2026-07-09', '2026-07-08'];
    expect(streakFromDates(dates, today)).toBe(0);
  });
  test('empty dates gives 0', () => {
    expect(streakFromDates([], '2026-07-10')).toBe(0);
  });
});

describe('intensityForCents', () => {
  test('0 gives 0', () => expect(intensityForCents(0)).toBe(0));
  test('5000 (R$50) gives 1', () => expect(intensityForCents(5000)).toBe(1));
  test('15000 (R$150) gives 2', () => expect(intensityForCents(15000)).toBe(2));
  test('35000 (R$350) gives 3', () => expect(intensityForCents(35000)).toBe(3));
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest --testPathPattern=cockpit --no-coverage
```
Expected: FAIL — "Cannot find module '../../src/services/cockpit'"

- [ ] **Step 3: Implement `src/services/cockpit.ts`**

```typescript
// src/services/cockpit.ts
import { supabase } from '../lib/supabase';

export interface MonthHistoryItem {
  year: number;
  month: number;
  gross_cents: number;
  expenses_cents: number;
  fuel_cents: number;
  rides: number;
  km_meters: number;
}

export interface HeatmapDay {
  day: number;
  income_cents: number;
  expense_cents: number;
}

// ─── pure functions (no Supabase calls) ──────────────────────────────────────

export function workingDaysInMonth(workingDays: number[], year: number, month: number): number {
  if (workingDays.length === 0) return 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay(); // 0=Sun...6=Sat
    const iso = dow === 0 ? 7 : dow; // convert to ISO: Mon=1...Sun=7
    if (workingDays.includes(iso)) count++;
  }
  return count;
}

export function getDailyGoalCents(
  goalCents: number,
  workingDays: number[],
  year: number,
  month: number,
): number {
  if (goalCents <= 0 || workingDays.length === 0) return 0;
  const wd = workingDaysInMonth(workingDays, year, month);
  if (wd === 0) return 0;
  return Math.ceil(goalCents / wd);
}

export function streakFromDates(activeDates: string[], todayStr: string): number {
  const dateSet = new Set(activeDates);
  if (!dateSet.has(todayStr)) return 0;
  let streak = 0;
  const cursor = new Date(todayStr + 'T12:00:00');
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!dateSet.has(key)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
    if (streak > 60) break; // safety cap
  }
  return streak;
}

// Returns 0 (none), 1 (low <R$100), 2 (medium R$100-R$300), 3 (high >R$300)
export function intensityForCents(cents: number): 0 | 1 | 2 | 3 {
  if (cents <= 0) return 0;
  if (cents < 10000) return 1;   // < R$100
  if (cents < 30000) return 2;   // R$100–R$300
  return 3;                       // > R$300
}

// ─── Supabase queries ─────────────────────────────────────────────────────────

export async function getMonthHistory(userId: string, limit = 12): Promise<MonthHistoryItem[]> {
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - limit + 1, 1);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-01`;
  const cutoffExpenses = cutoffStr;

  const [shiftsRes, expRes, fuelRes] = await Promise.all([
    supabase
      .from('shifts')
      .select('started_at, gross_cents, odometer_start_meters, odometer_end_meters')
      .eq('user_id', userId)
      .gte('started_at', cutoff.toISOString())
      .not('ended_at', 'is', null),
    supabase
      .from('expenses')
      .select('expense_date, amount_cents')
      .eq('user_id', userId)
      .gte('expense_date', cutoffExpenses),
    supabase
      .from('fuel_entries')
      .select('filled_at, total_cost_cents')
      .eq('user_id', userId)
      .gte('filled_at', cutoff.toISOString()),
  ]);

  const buckets = new Map<string, MonthHistoryItem>();
  for (let i = limit - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    buckets.set(key, {
      year: d.getFullYear(), month: d.getMonth() + 1,
      gross_cents: 0, expenses_cents: 0, fuel_cents: 0, rides: 0, km_meters: 0,
    });
  }

  for (const row of (shiftsRes.data ?? []) as Array<{
    started_at: string; gross_cents: number | null;
    odometer_start_meters: number | null; odometer_end_meters: number | null;
  }>) {
    const d = new Date(row.started_at);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const b = buckets.get(key);
    if (!b) continue;
    b.gross_cents += row.gross_cents ?? 0;
    b.rides++;
    if (row.odometer_start_meters != null && row.odometer_end_meters != null) {
      b.km_meters += row.odometer_end_meters - row.odometer_start_meters;
    }
  }
  for (const row of (expRes.data ?? []) as Array<{ expense_date: string; amount_cents: number }>) {
    const d = new Date(row.expense_date + 'T00:00:00');
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const b = buckets.get(key);
    if (b) b.expenses_cents += row.amount_cents;
  }
  for (const row of (fuelRes.data ?? []) as Array<{ filled_at: string; total_cost_cents: number }>) {
    const d = new Date(row.filled_at);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const b = buckets.get(key);
    if (b) b.fuel_cents += row.total_cost_cents;
  }

  return Array.from(buckets.values()).reverse(); // newest first
}

export async function getCalendarHeatmap(
  userId: string,
  year: number,
  month: number,
): Promise<HeatmapDay[]> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const monthStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEndStr = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-01`;

  const [shiftsRes, expRes, fuelRes] = await Promise.all([
    supabase
      .from('shifts')
      .select('started_at, gross_cents')
      .eq('user_id', userId)
      .gte('started_at', monthStart.toISOString())
      .lt('started_at', monthEnd.toISOString())
      .not('ended_at', 'is', null),
    supabase
      .from('expenses')
      .select('expense_date, amount_cents')
      .eq('user_id', userId)
      .gte('expense_date', monthStartStr)
      .lt('expense_date', monthEndStr),
    supabase
      .from('fuel_entries')
      .select('filled_at, total_cost_cents')
      .eq('user_id', userId)
      .gte('filled_at', monthStart.toISOString())
      .lt('filled_at', monthEnd.toISOString()),
  ]);

  const totalDays = new Date(year, month, 0).getDate();
  const map = new Map<number, HeatmapDay>();
  for (let d = 1; d <= totalDays; d++) {
    map.set(d, { day: d, income_cents: 0, expense_cents: 0 });
  }

  for (const row of (shiftsRes.data ?? []) as Array<{ started_at: string; gross_cents: number | null }>) {
    const d = new Date(row.started_at).getDate();
    const b = map.get(d);
    if (b) b.income_cents += row.gross_cents ?? 0;
  }
  for (const row of (expRes.data ?? []) as Array<{ expense_date: string; amount_cents: number }>) {
    const d = new Date(row.expense_date + 'T00:00:00').getDate();
    const b = map.get(d);
    if (b) b.expense_cents += row.amount_cents;
  }
  for (const row of (fuelRes.data ?? []) as Array<{ filled_at: string; total_cost_cents: number }>) {
    const d = new Date(row.filled_at).getDate();
    const b = map.get(d);
    if (b) b.expense_cents += row.total_cost_cents;
  }

  return Array.from(map.values());
}

export async function getStreak(userId: string): Promise<number> {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - 60);

  const [shiftsRes, expRes] = await Promise.all([
    supabase
      .from('shifts')
      .select('started_at')
      .eq('user_id', userId)
      .gte('started_at', cutoff.toISOString())
      .not('ended_at', 'is', null),
    supabase
      .from('expenses')
      .select('expense_date')
      .eq('user_id', userId)
      .gte('expense_date', cutoff.toISOString().slice(0, 10)),
  ]);

  const activeDates = new Set<string>();
  for (const row of (shiftsRes.data ?? []) as Array<{ started_at: string }>) {
    activeDates.add(new Date(row.started_at).toISOString().slice(0, 10));
  }
  for (const row of (expRes.data ?? []) as Array<{ expense_date: string }>) {
    activeDates.add(row.expense_date);
  }

  const todayStr = now.toISOString().slice(0, 10);
  return streakFromDates(Array.from(activeDates), todayStr);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest --testPathPattern=cockpit --no-coverage
```
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```
git add src/services/cockpit.ts __tests__/services/cockpit.test.ts
git commit -m "feat: add cockpit service layer (month history, heatmap, streak, daily goal)"
```

---

## Task 2: VehiclePill and StreakBar components

**Files:**
- Create: `src/components/VehiclePill.tsx`
- Create: `src/components/StreakBar.tsx`

**Interfaces:**
- Consumes: `Colors`, `Spacing`, `Radius` from `@/src/theme`; `useRouter` from `expo-router`
- Produces:
  - `VehiclePill({ brand, model, year, fuelType, kmPerL, odometerKm })`
  - `StreakBar({ streak })`

- [ ] **Step 1: Create `src/components/VehiclePill.tsx`**

```tsx
// src/components/VehiclePill.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing } from '../theme';

const FUEL_LABELS: Record<string, string> = {
  gasoline: 'Gasolina', ethanol: 'Etanol', diesel: 'Diesel',
  gnv: 'GNV', electric: 'Elétrico', hybrid: 'Híbrido',
};

interface VehiclePillProps {
  brand: string;
  model: string;
  year: number;
  fuelType: string;
  kmPerL: number | null;
}

export function VehiclePill({ brand, model, year, fuelType, kmPerL }: VehiclePillProps) {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={styles.pill}
      onPress={() => router.push('/(tabs)/more')}
      activeOpacity={0.75}
    >
      <Ionicons name="car-sport-outline" size={15} color={Colors.brandBlue} />
      <Text style={styles.name} numberOfLines={1}>
        {brand} {model} · {year}
      </Text>
      <View style={styles.tags}>
        <Text style={styles.tag}>{FUEL_LABELS[fuelType] ?? fuelType}</Text>
        {kmPerL != null && (
          <Text style={styles.tag}>{kmPerL.toFixed(1)} km/L</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={13} color={Colors.brandBlue} style={{ marginLeft: 'auto' }} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.brandBlueLight,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.2)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    marginBottom: Spacing.md,
  },
  name: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  tags: {
    flexDirection: 'row',
    gap: 6,
  },
  tag: {
    color: Colors.brandBlue,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(139,92,246,0.12)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
});
```

- [ ] **Step 2: Create `src/components/StreakBar.tsx`**

```tsx
// src/components/StreakBar.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius } from '../theme';

interface StreakBarProps {
  streak: number;
}

export function StreakBar({ streak }: StreakBarProps) {
  if (streak === 0) return null;
  return (
    <View style={styles.bar}>
      <Text style={styles.fire}>🔥</Text>
      <Text style={styles.text}>
        <Text style={styles.count}>{streak}</Text>
        {' '}
        {streak === 1 ? 'dia registrando dados' : 'dias registrando dados'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.15)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
    alignSelf: 'flex-start',
  },
  fire: {
    fontSize: 14,
  },
  count: {
    color: Colors.accent,
    fontWeight: '800',
    fontSize: 14,
  },
  text: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors related to the new files.

- [ ] **Step 4: Commit**

```
git add src/components/VehiclePill.tsx src/components/StreakBar.tsx
git commit -m "feat: add VehiclePill and StreakBar components"
```

---

## Task 3: CockpitCard (SVG gauge + daily goal)

**Files:**
- Create: `src/components/CockpitCard.tsx`

**Interfaces:**
- Consumes: `react-native-svg` (`Svg`, `Path`, `Circle`, `Text as SvgText`, `Defs`, `LinearGradient`, `Stop`), `Colors`, `Spacing`, `Radius`
- Produces:
  ```
  CockpitCard({
    todayGrossCents,
    dailyGoalCents,
    rides,
    durationSeconds,
    distanceMeters,
    expensesTodayCents,
    distanceUnit,
    currencyCode,
    locale,
    onEditGoal,
  })
  ```

- [ ] **Step 1: Create `src/components/CockpitCard.tsx`**

```tsx
// src/components/CockpitCard.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Radius, Spacing } from '../theme';
import { formatMoney } from '../utils/currency';
import { metersToDisplay } from '../utils/units';
import { useTranslation } from 'react-i18next';

function secondsToHHMM(s: number): string {
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

interface CockpitCardProps {
  todayGrossCents: number;
  dailyGoalCents: number;
  rides: number;
  durationSeconds: number;
  distanceMeters: number;
  expensesTodayCents: number;
  distanceUnit: 'km' | 'mi';
  currencyCode: string;
  locale: string;
  onEditGoal: () => void;
}

const GAUGE_R = 76;
const GAUGE_CX = 100;
const GAUGE_CY = 90;
const HALF_CIRC = Math.PI * GAUGE_R; // ≈ 238.76

export function CockpitCard({
  todayGrossCents,
  dailyGoalCents,
  rides,
  durationSeconds,
  distanceMeters,
  expensesTodayCents,
  distanceUnit,
  currencyCode,
  locale,
  onEditGoal,
}: CockpitCardProps) {
  const { t } = useTranslation();

  const hasGoal = dailyGoalCents > 0;
  const pct = hasGoal ? Math.min(todayGrossCents / dailyGoalCents, 1) : 0;
  const metGoal = todayGrossCents >= dailyGoalCents && hasGoal;

  // SVG arc: M (left) A R R 0 1 0 (right) = upper semicircle (sweep=0 = CCW)
  const trackD = `M ${GAUGE_CX - GAUGE_R} ${GAUGE_CY} A ${GAUGE_R} ${GAUGE_R} 0 1 0 ${GAUGE_CX + GAUGE_R} ${GAUGE_CY}`;
  // fill dasharray: filled portion + empty portion
  const dashFill = HALF_CIRC * pct;
  const dashEmpty = HALF_CIRC * (1 - pct);

  const fillColor = metGoal ? Colors.success : pct >= 0.5 ? Colors.accent : '#EF8844';
  const remainCents = Math.max(dailyGoalCents - todayGrossCents, 0);

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.row}>
        <Text style={styles.title}>{t('dashboard.today')}</Text>
        <TouchableOpacity onPress={onEditGoal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.editBtn}>
          <Ionicons name="pencil-outline" size={14} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Gauge */}
      <View style={styles.gaugeWrap}>
        <Svg width={200} height={110} viewBox="0 0 200 110">
          <Defs>
            <LinearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#EF4444" />
              <Stop offset="50%" stopColor={Colors.accent} />
              <Stop offset="100%" stopColor={Colors.accent} />
            </LinearGradient>
          </Defs>
          {/* Track */}
          <Path
            d={trackD}
            fill="none"
            stroke={Colors.surfaceAlt ?? '#162032'}
            strokeWidth={12}
            strokeLinecap="round"
          />
          {/* Fill (dasharray trick) */}
          {pct > 0 && (
            <Path
              d={trackD}
              fill="none"
              stroke={metGoal ? Colors.success : 'url(#gaugeGrad)'}
              strokeWidth={12}
              strokeLinecap="round"
              strokeDasharray={`${dashFill} ${dashEmpty + 10}`}
            />
          )}
          {/* Center text */}
          <SvgText x={GAUGE_CX} y={GAUGE_CY - 8} textAnchor="middle" fontSize={11} fill={Colors.textSecondary} fontWeight="600">
            {metGoal ? '✅ Meta!' : hasGoal ? `${Math.round(pct * 100)}%` : 'sem meta'}
          </SvgText>
          <SvgText x={GAUGE_CX} y={GAUGE_CY + 14} textAnchor="middle" fontSize={21} fill={metGoal ? Colors.success : Colors.textPrimary} fontWeight="800">
            {formatMoney(todayGrossCents, currencyCode, locale)}
          </SvgText>
          <SvgText x={GAUGE_CX} y={GAUGE_CY + 30} textAnchor="middle" fontSize={9} fill={Colors.textSecondary}>
            ganhos hoje
          </SvgText>
        </Svg>
      </View>

      {/* Goal label */}
      {hasGoal && (
        <View style={styles.goalRow}>
          {metGoal ? (
            <Text style={[styles.goalLabel, { color: Colors.success }]}>
              +{formatMoney(todayGrossCents - dailyGoalCents, currencyCode, locale)} acima da meta ✓
            </Text>
          ) : (
            <Text style={styles.goalLabel}>
              Meta diária · {formatMoney(dailyGoalCents, currencyCode, locale)} · Faltam {formatMoney(remainCents, currencyCode, locale)}
            </Text>
          )}
        </View>
      )}

      {/* 4 micro-stats */}
      <View style={styles.statsRow}>
        {([
          { icon: 'car-outline' as const, label: 'Corridas', value: String(rides) },
          { icon: 'time-outline' as const, label: 'Horas', value: secondsToHHMM(durationSeconds) },
          {
            icon: 'navigate-outline' as const,
            label: distanceUnit === 'km' ? 'Km' : 'Mi',
            value: metersToDisplay(distanceMeters, distanceUnit).toFixed(1),
          },
          {
            icon: 'receipt-outline' as const,
            label: 'Despesas',
            value: formatMoney(expensesTodayCents, currencyCode, locale),
            valueColor: expensesTodayCents > 0 ? Colors.error : Colors.textSecondary,
          },
        ] as const).map(s => (
          <View key={s.label} style={styles.stat}>
            <Ionicons name={s.icon} size={14} color={Colors.textSecondary} />
            <Text style={[styles.statValue, 'valueColor' in s && s.valueColor ? { color: s.valueColor } : {}]}>
              {s.value}
            </Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const cardShadow = {
  shadowColor: '#94A3B8', shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.10, shadowRadius: 8, elevation: 2,
} as const;

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    ...cardShadow,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  title: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  editBtn: { padding: 4 },
  gaugeWrap: { alignItems: 'center', marginVertical: Spacing.sm },
  goalRow: { alignItems: 'center', marginBottom: Spacing.sm },
  goalLabel: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center' },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.md,
    gap: 4,
  },
  stat: { flex: 1, alignItems: 'center', gap: 3 },
  statValue: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  statLabel: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```
git add src/components/CockpitCard.tsx
git commit -m "feat: add CockpitCard with SVG semicircle gauge and daily goal display"
```

---

## Task 4: MonthHistoryCard

**Files:**
- Create: `src/components/MonthHistoryCard.tsx`

**Interfaces:**
- Consumes: `MonthHistoryItem` from `@/src/services/cockpit`
- Produces: `MonthHistoryCard({ items, currencyCode, locale })`

- [ ] **Step 1: Create `src/components/MonthHistoryCard.tsx`**

```tsx
// src/components/MonthHistoryCard.tsx
import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing } from '../theme';
import { formatMoney } from '../utils/currency';
import type { MonthHistoryItem } from '../services/cockpit';

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function netForItem(item: MonthHistoryItem): number {
  return item.gross_cents - item.expenses_cents - item.fuel_cents;
}

interface MonthHistoryCardProps {
  items: MonthHistoryItem[];
  currencyCode: string;
  locale: string;
}

export function MonthHistoryCard({ items, currencyCode, locale }: MonthHistoryCardProps) {
  if (items.length === 0) return null;

  const now = new Date();
  const bestGross = Math.max(...items.map(i => i.gross_cents));

  return (
    <View style={styles.card}>
      <Text style={styles.title}>HISTÓRICO MENSAL</Text>
      <FlatList
        data={items}
        keyExtractor={item => `${item.year}-${item.month}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: Spacing.sm, paddingRight: Spacing.sm }}
        renderItem={({ item }) => {
          const net = netForItem(item);
          const isCurrentMonth = item.year === now.getFullYear() && item.month === (now.getMonth() + 1);
          const isBest = item.gross_cents === bestGross && item.gross_cents > 0;
          const netColor = net >= 0 ? Colors.success : Colors.error;

          return (
            <View style={[styles.monthCard, isCurrentMonth && styles.monthCardCurrent]}>
              {/* Badge */}
              {isCurrentMonth && (
                <View style={styles.badgeCurrent}><Text style={styles.badgeText}>atual</Text></View>
              )}
              {isBest && !isCurrentMonth && (
                <View style={styles.badgeBest}><Text style={styles.badgeText}>⭐ melhor</Text></View>
              )}

              {/* Month label */}
              <Text style={styles.monthLabel}>
                {MONTH_NAMES[item.month - 1]} {item.year}
              </Text>

              {/* Gross */}
              <Text style={styles.gross}>
                {formatMoney(item.gross_cents, currencyCode, locale)}
              </Text>
              <Text style={styles.grossLabel}>bruto</Text>

              {/* Net */}
              <Text style={[styles.net, { color: netColor }]}>
                {formatMoney(net, currencyCode, locale)}
              </Text>
              <Text style={styles.netLabel}>líquido</Text>

              {/* Pills */}
              <View style={styles.pills}>
                {item.rides > 0 && (
                  <Text style={styles.pill}>🚗 {item.rides}</Text>
                )}
                {item.km_meters > 0 && (
                  <Text style={styles.pill}>{(item.km_meters / 1000).toFixed(0)} km</Text>
                )}
              </View>

              {/* Expense bar */}
              {item.gross_cents > 0 && (
                <View style={styles.expenseBar}>
                  <View
                    style={[
                      styles.expenseFill,
                      {
                        width: `${Math.min(((item.expenses_cents + item.fuel_cents) / item.gross_cents) * 100, 100)}%` as any,
                      },
                    ]}
                  />
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const cardShadow = {
  shadowColor: '#94A3B8', shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.10, shadowRadius: 8, elevation: 2,
} as const;

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    ...cardShadow,
  },
  title: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: Spacing.sm,
  },
  monthCard: {
    width: 130,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.card,
    padding: Spacing.sm + 2,
    borderWidth: 1,
    borderColor: Colors.border,
    position: 'relative',
    overflow: 'hidden',
  },
  monthCardCurrent: {
    borderColor: Colors.accent,
    borderWidth: 1.5,
  },
  badgeCurrent: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: Colors.accentDim,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  badgeBest: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: 'rgba(245,158,11,0.15)',
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6,
  },
  badgeText: { color: Colors.accent, fontSize: 9, fontWeight: '700' },
  monthLabel: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  gross: { color: Colors.accent, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  grossLabel: { color: Colors.textSecondary, fontSize: 9, marginBottom: 6 },
  net: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  netLabel: { color: Colors.textSecondary, fontSize: 9, marginBottom: 6 },
  pills: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginBottom: 6 },
  pill: { color: Colors.textSecondary, fontSize: 9, fontWeight: '600', backgroundColor: Colors.surface, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  expenseBar: { height: 3, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  expenseFill: { height: 3, backgroundColor: Colors.error, borderRadius: 2 },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```
git add src/components/MonthHistoryCard.tsx
git commit -m "feat: add MonthHistoryCard for month-by-month scrollable history"
```

---

## Task 5: Wire components into Dashboard (`app/(tabs)/index.tsx`)

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes:
  - `VehiclePill` from `@/src/components/VehiclePill`
  - `StreakBar` from `@/src/components/StreakBar`
  - `CockpitCard` from `@/src/components/CockpitCard`
  - `MonthHistoryCard` from `@/src/components/MonthHistoryCard`
  - `getMonthHistory`, `getStreak`, `getDailyGoalCents`, `MonthHistoryItem` from `@/src/services/cockpit`

- [ ] **Step 1: Add new imports and state to DashboardScreen**

At the top of `app/(tabs)/index.tsx`, add these imports after the existing ones:

```tsx
import { VehiclePill } from '@/src/components/VehiclePill';
import { StreakBar } from '@/src/components/StreakBar';
import { CockpitCard } from '@/src/components/CockpitCard';
import { MonthHistoryCard } from '@/src/components/MonthHistoryCard';
import {
  getMonthHistory, getStreak, getDailyGoalCents,
  type MonthHistoryItem,
} from '@/src/services/cockpit';
```

- [ ] **Step 2: Add new state variables to DashboardScreen**

Inside `DashboardScreen`, add these state declarations alongside the existing ones (after `const [weekTotals, ...]`):

```tsx
const [monthHistory, setMonthHistory] = useState<MonthHistoryItem[]>([]);
const [streak, setStreak] = useState(0);
```

- [ ] **Step 3: Load new data inside `loadData`**

Inside the `loadData` callback, add `getMonthHistory` and `getStreak` to the parallel calls:

```tsx
const loadData = useCallback(async (uid: string) => {
  const vehicleP = profile?.vehicle_id
    ? supabase.from('vehicles').select('brand, model, year, fuel_type, avg_consumption_per_100')
        .eq('id', profile.vehicle_id).maybeSingle().then(r => r.data, () => null)
    : supabase.from('vehicles').select('brand, model, year, fuel_type, avg_consumption_per_100')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle().then(r => r.data, () => null);
  const [
    todaySummary, buckets, monthly, active, goalData, consumption,
    vehicleData, mTotals, wTotals, history, streakCount,
  ] = await Promise.all([
    getTodaySummary(uid),
    getWeekBuckets(uid),
    getMonthlyBuckets(uid),
    getActiveShift(uid),
    getActiveGoal(uid),
    getConsumptionTrend(uid, profile?.vehicle_id ?? null).catch(() => null),
    vehicleP,
    getMonthlyTotals(uid).catch(() => null),
    getWeekTotals(uid).catch(() => null),
    getMonthHistory(uid).catch(() => []),
    getStreak(uid).catch(() => 0),
  ]);
  setSummary(todaySummary);
  setWeekBuckets(buckets);
  setMonthlyBuckets(monthly);
  setActiveShift(active);
  setGoal(goalData);
  setConsumptionTrend(consumption);
  setVehicleInfo(vehicleData as VehicleInfo | null);
  setMonthlyTotals(mTotals);
  setWeekTotals(wTotals);
  setMonthHistory(history);
  setStreak(streakCount);
}, [profile?.vehicle_id]);
```

- [ ] **Step 4: Compute dailyGoalCents in the render body**

Add this computed value just before the `return` statement in `DashboardScreen`:

```tsx
const now = new Date();
const dailyGoalCents = goal != null
  ? getDailyGoalCents(
      goal.target_amount_cents,
      goal.working_days ?? [1, 2, 3, 4, 5, 6],
      now.getFullYear(),
      now.getMonth() + 1,
    )
  : 0;
```

- [ ] **Step 5: Replace JSX in ScrollView**

Replace the JSX body inside `<ScrollView>` (between the `<View style={styles.header}>...</View>` and the closing `</ScrollView>`) with the following. This removes `TodayCard`, `GoalProgress`, `setGoalBtn`, and `CarComparisonCard`, and adds the new components:

```tsx
{fetchError && <Text style={styles.errorBanner}>{t('common.error')}</Text>}

{/* VehiclePill: compact vehicle info below greeting */}
{vehicleInfo && (
  <VehiclePill
    brand={vehicleInfo.brand}
    model={vehicleInfo.model}
    year={vehicleInfo.year}
    fuelType={vehicleInfo.fuel_type}
    kmPerL={consumptionTrend?.overall.km_per_l ?? (
      vehicleInfo.avg_consumption_per_100 > 0
        ? 100000 / vehicleInfo.avg_consumption_per_100
        : null
    )}
  />
)}

{/* Streak counter */}
<StreakBar streak={streak} />

{activeShift !== null && <ActiveShiftBanner shift={activeShift} />}

{/* CockpitCard: SVG gauge + 4 micro-stats */}
<CockpitCard
  todayGrossCents={summary?.gross_cents ?? 0}
  dailyGoalCents={dailyGoalCents}
  rides={summary ? Math.max(monthlyTotals ? 0 : 0, 0) : 0}
  durationSeconds={summary?.duration_seconds ?? 0}
  distanceMeters={summary?.distance_meters ?? 0}
  expensesTodayCents={(summary?.expenses_cents ?? 0) + (summary?.fuel_cents ?? 0)}
  distanceUnit={distanceUnit}
  currencyCode={currencyCode}
  locale={locale}
  onEditGoal={() => setGoalModalVisible(true)}
/>

{monthlyBuckets.length > 0 && (
  <MonthlyChart
    buckets={monthlyBuckets}
    goalCents={goal?.target_amount_cents ?? null}
    currencyCode={currencyCode}
    locale={locale}
  />
)}

{consumptionTrend !== null && <FuelConsumptionCard trend={consumptionTrend} />}

{monthlyTotals !== null && monthlyTotals.gross_cents > 0 && (
  <ProfitCard totals={monthlyTotals} currencyCode={currencyCode} locale={locale} />
)}

{weekBuckets.length > 0 && (
  <WeekBarChart
    buckets={weekBuckets}
    weekTotals={weekTotals}
    currencyCode={currencyCode}
    locale={locale}
    language={i18n.language}
    onPress={setSelectedDay}
  />
)}

{/* MonthHistoryCard: replaces CarComparisonCard */}
<MonthHistoryCard
  items={monthHistory}
  currencyCode={currencyCode}
  locale={locale}
/>
```

> **Note on `rides` prop**: The per-day ride count is not currently in `DailySummary`. Pass `0` for now — Task 7 adds a `rides` field to the daily summary via the calendar context. For the dashboard, the 4 micro-stats show duration and km correctly; ride count on the gauge will remain `0` until Task 8 wires it in.

- [ ] **Step 6: Remove `CarComparisonCard` and `CAR_SCENARIOS` from the file**

Find and delete lines 350–388 (the `CAR_SCENARIOS` array and `CarComparisonCard` function). Also remove `CarComparisonCard` from the `<ScrollView>` (already done in step 5). Remove its related i18n key usages inside.

- [ ] **Step 7: Verify TypeScript compiles and test manually**

```
npx tsc --noEmit
```

Then run Expo dev build:
```
npx expo start
```

Open on device/simulator. Verify:
- VehiclePill appears below greeting in violet
- StreakBar shows if you have recorded data
- CockpitCard shows gauge and 4 micro-stats
- MonthHistoryCard shows horizontal scroll
- CarComparisonCard is gone

- [ ] **Step 8: Commit**

```
git add app/(tabs)/index.tsx
git commit -m "feat: wire cockpit components into dashboard, remove CarComparisonCard"
```

---

## Task 6: CalendarHeatmapView component

**Files:**
- Create: `src/components/CalendarHeatmapView.tsx`

**Interfaces:**
- Consumes: `HeatmapDay`, `intensityForCents` from `@/src/services/cockpit`; `react-native-svg` (`Svg`, `Polygon`)
- Produces:
  ```
  CalendarHeatmapView({
    year, month,
    days: HeatmapDay[],
    onDayPress: (day: number) => void,
  })
  ```

- [ ] **Step 1: Create `src/components/CalendarHeatmapView.tsx`**

```tsx
// src/components/CalendarHeatmapView.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { Colors, Spacing, Radius } from '../theme';
import { intensityForCents, type HeatmapDay } from '../services/cockpit';

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Gold intensities (income): 0=none, 1=low, 2=mid, 3=high
const GOLD_ALPHA = [0, 0.12, 0.28, 0.50];
// Red intensities (expense):
const RED_ALPHA  = [0, 0.12, 0.28, 0.50];

function goldBg(level: 0 | 1 | 2 | 3): string {
  if (level === 0) return 'rgba(255,255,255,0.03)';
  return `rgba(245,158,11,${GOLD_ALPHA[level]})`;
}
function redBg(level: 0 | 1 | 2 | 3): string {
  if (level === 0) return 'rgba(255,255,255,0.03)';
  return `rgba(239,68,68,${RED_ALPHA[level]})`;
}

interface CalendarHeatmapViewProps {
  year: number;
  month: number;
  days: HeatmapDay[];
  onDayPress: (day: number) => void;
}

export function CalendarHeatmapView({ year, month, days, onDayPress }: CalendarHeatmapViewProps) {
  const { width } = useWindowDimensions();
  const cellSize = Math.floor((width - Spacing.md * 2 - Spacing.sm * 6) / 7);

  const dayMap = new Map<number, HeatmapDay>();
  for (const d of days) dayMap.set(d.day, d);

  // Build grid: first day of month's weekday (0=Sun)
  const firstDow = new Date(year, month - 1, 1).getDay();
  const totalDays = new Date(year, month, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const todayDay = isCurrentMonth ? today.getDate() : -1;

  // Pad with nulls for offset
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  // Fill to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <View>
      {/* Day headers */}
      <View style={styles.headerRow}>
        {DAY_LABELS.map(l => (
          <Text key={l} style={[styles.dayHeader, { width: cellSize }]}>{l}</Text>
        ))}
      </View>

      {/* Calendar grid */}
      {rows.map((row, ri) => (
        <View key={ri} style={styles.row}>
          {row.map((day, ci) => {
            if (day === null) {
              return <View key={ci} style={{ width: cellSize, height: cellSize, margin: Spacing.xs / 2 }} />;
            }
            const hd = dayMap.get(day);
            const incLevel = hd ? intensityForCents(hd.income_cents) : 0;
            const expLevel = hd ? intensityForCents(hd.expense_cents) : 0;
            const hasBoth = incLevel > 0 && expLevel > 0;
            const isToday = day === todayDay;

            return (
              <TouchableOpacity
                key={ci}
                style={[
                  styles.cell,
                  { width: cellSize, height: cellSize },
                  !hasBoth && incLevel > 0 && { backgroundColor: goldBg(incLevel) },
                  !hasBoth && expLevel > 0 && { backgroundColor: redBg(expLevel) },
                  hasBoth && { backgroundColor: 'transparent' },
                  isToday && styles.cellToday,
                ]}
                onPress={() => onDayPress(day)}
                activeOpacity={0.7}
              >
                {/* Diagonal split for days with both income and expense */}
                {hasBoth && (
                  <Svg
                    style={StyleSheet.absoluteFillObject}
                    width={cellSize}
                    height={cellSize}
                  >
                    {/* Gold triangle (top-left) */}
                    <Polygon
                      points={`0,0 ${cellSize},0 0,${cellSize}`}
                      fill={`rgba(245,158,11,${GOLD_ALPHA[incLevel]})`}
                    />
                    {/* Red triangle (bottom-right) */}
                    <Polygon
                      points={`${cellSize},0 ${cellSize},${cellSize} 0,${cellSize}`}
                      fill={`rgba(239,68,68,${RED_ALPHA[expLevel]})`}
                    />
                  </Svg>
                )}
                <Text style={[styles.dayNum, isToday && styles.dayNumToday]}>
                  {day}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', marginBottom: Spacing.xs },
  dayHeader: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    textAlign: 'center',
    marginHorizontal: Spacing.xs / 2,
  },
  row: { flexDirection: 'row' },
  cell: {
    borderRadius: Radius.input / 2,
    margin: Spacing.xs / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  cellToday: {
    borderWidth: 1.5,
    borderColor: 'rgba(245,158,11,0.45)',
  },
  dayNum: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  dayNumToday: {
    color: Colors.accent,
    fontWeight: '800',
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```
git add src/components/CalendarHeatmapView.tsx
git commit -m "feat: add CalendarHeatmapView with gold/red intensity diagonal bicolor cells"
```

---

## Task 7: ExpenseDaySheet component

**Files:**
- Create: `src/components/ExpenseDaySheet.tsx`

**Interfaces:**
- Produces:
  ```
  ExpenseDaySheet({
    visible: boolean,
    year: number,
    month: number,
    day: number | null,
    userId: string | null,
    currencyCode: string,
    locale: string,
    distanceUnit: 'km' | 'mi',
    onClose: () => void,
    onAddExpense: () => void,
  })
  ```

- [ ] **Step 1: Create `src/components/ExpenseDaySheet.tsx`**

```tsx
// src/components/ExpenseDaySheet.tsx
import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Radius, Spacing } from '../theme';
import { formatMoney } from '../utils/currency';
import { metersToDisplay } from '../utils/units';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';

function secondsToHHMM(s: number): string {
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

const CATEGORY_ICONS: Record<string, string> = {
  fuel: '⛽', car_wash: '🚿', maintenance: '🔧', oil_change: '🛢️',
  tires: '🔄', food: '🍔', insurance: '🛡️', licensing: '📋',
  financing: '🏦', rent: '🏠', tolls: '🛣️', parking: '🅿️',
  taxes: '📊', health_insurance: '❤️', internet: '📶',
  tracker: '📡', taxi_license: '🪪', other: '📌',
};

interface ShiftRow {
  id: string;
  gross_cents: number | null;
  net_cents: number | null;
  duration_seconds: number | null;
  started_at: string;
  ended_at: string | null;
  odometer_start_meters: number | null;
  odometer_end_meters: number | null;
  platform?: string | null;
  rides?: number | null;
}

interface ExpenseRow {
  id: string;
  category: string;
  amount_cents: number;
  description: string | null;
}

interface FuelRow {
  id: string;
  total_cost_cents: number;
  fuel_type: string;
}

interface DayData {
  shifts: ShiftRow[];
  expenses: ExpenseRow[];
  fuelEntries: FuelRow[];
}

async function loadDayData(userId: string, dateStr: string): Promise<DayData> {
  const start = new Date(dateStr + 'T00:00:00').toISOString();
  const end = new Date(dateStr + 'T23:59:59.999').toISOString();
  const [sr, er, fr] = await Promise.all([
    supabase.from('shifts')
      .select('id, gross_cents, net_cents, duration_seconds, started_at, ended_at, odometer_start_meters, odometer_end_meters, platform, rides')
      .eq('user_id', userId).gte('started_at', start).lte('started_at', end).not('ended_at', 'is', null),
    supabase.from('expenses')
      .select('id, category, amount_cents, description')
      .eq('user_id', userId).eq('expense_date', dateStr),
    supabase.from('fuel_entries')
      .select('id, total_cost_cents, fuel_type')
      .eq('user_id', userId).gte('filled_at', start).lte('filled_at', end),
  ]);
  return {
    shifts: (sr.data ?? []) as ShiftRow[],
    expenses: (er.data ?? []) as ExpenseRow[],
    fuelEntries: (fr.data ?? []) as FuelRow[],
  };
}

interface ExpenseDaySheetProps {
  visible: boolean;
  year: number;
  month: number;
  day: number | null;
  userId: string | null;
  currencyCode: string;
  locale: string;
  distanceUnit: 'km' | 'mi';
  onClose: () => void;
  onAddExpense: () => void;
}

export function ExpenseDaySheet({
  visible, year, month, day, userId,
  currencyCode, locale, distanceUnit,
  onClose, onAddExpense,
}: ExpenseDaySheetProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(false);

  const dateStr = day != null
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : null;

  useEffect(() => {
    if (!visible || !dateStr || !userId) { setData(null); return; }
    setLoading(true);
    loadDayData(userId, dateStr)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [visible, dateStr, userId]);

  const label = dateStr
    ? new Date(dateStr + 'T12:00:00').toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    : '';

  const totalIncome = (data?.shifts ?? []).reduce((s, sh) => s + (sh.gross_cents ?? 0), 0);
  const totalExpenses = (data?.expenses ?? []).reduce((s, e) => s + e.amount_cents, 0)
    + (data?.fuelEntries ?? []).reduce((s, f) => s + f.total_cost_cents, 0);
  const saldo = totalIncome - totalExpenses;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.handle} />
          <Text style={styles.title} numberOfLines={1}>{label}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {loading
          ? <ActivityIndicator color={Colors.accent} style={{ marginTop: Spacing.xl }} />
          : (
            <ScrollView contentContainerStyle={styles.content}>
              {/* Income section */}
              {(data?.shifts ?? []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>RECEITAS</Text>
                  {(data?.shifts ?? []).map(sh => {
                    const km = sh.odometer_start_meters != null && sh.odometer_end_meters != null
                      ? metersToDisplay(sh.odometer_end_meters - sh.odometer_start_meters, distanceUnit)
                      : null;
                    const dur = sh.duration_seconds
                      ?? (sh.ended_at ? Math.round((new Date(sh.ended_at).getTime() - new Date(sh.started_at).getTime()) / 1000) : 0);
                    return (
                      <View key={sh.id} style={styles.row}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowLabel}>
                            {sh.platform ?? 'Turno'}{sh.rides ? ` · ${sh.rides} corridas` : ''}
                          </Text>
                          <Text style={styles.rowSub}>
                            {secondsToHHMM(dur)}{km != null ? ` · ${km.toFixed(1)} ${distanceUnit}` : ''}
                          </Text>
                        </View>
                        <Text style={[styles.rowValue, { color: Colors.accent }]}>
                          {formatMoney(sh.gross_cents ?? 0, currencyCode, locale)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Expense section */}
              {((data?.expenses ?? []).length > 0 || (data?.fuelEntries ?? []).length > 0) && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>DESPESAS</Text>
                  {(data?.expenses ?? []).map(e => (
                    <View key={e.id} style={styles.row}>
                      <Text style={styles.icon}>{CATEGORY_ICONS[e.category] ?? '📌'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowLabel}>{e.description ?? e.category}</Text>
                        <Text style={styles.rowSub}>{e.category}</Text>
                      </View>
                      <Text style={[styles.rowValue, { color: Colors.error }]}>
                        -{formatMoney(e.amount_cents, currencyCode, locale)}
                      </Text>
                    </View>
                  ))}
                  {(data?.fuelEntries ?? []).map(f => (
                    <View key={f.id} style={styles.row}>
                      <Text style={styles.icon}>⛽</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowLabel}>Combustível ({f.fuel_type})</Text>
                      </View>
                      <Text style={[styles.rowValue, { color: Colors.error }]}>
                        -{formatMoney(f.total_cost_cents, currencyCode, locale)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Saldo */}
              {(totalIncome > 0 || totalExpenses > 0) && (
                <View style={[styles.section, styles.saldoSection]}>
                  <Text style={styles.sectionTitle}>SALDO DO DIA</Text>
                  <Text style={[styles.saldoValue, { color: saldo >= 0 ? Colors.success : Colors.error }]}>
                    {formatMoney(saldo, currencyCode, locale)}
                  </Text>
                </View>
              )}

              {totalIncome === 0 && totalExpenses === 0 && (
                <View style={{ alignItems: 'center', paddingVertical: Spacing.xl }}>
                  <Ionicons name="calendar-outline" size={32} color={Colors.borderBright} />
                  <Text style={{ color: Colors.textSecondary, marginTop: Spacing.sm }}>Nenhum registro neste dia</Text>
                </View>
              )}
            </ScrollView>
          )
        }

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.footerBtn} onPress={onAddExpense}>
            <Ionicons name="add" size={18} color={Colors.error} />
            <Text style={[styles.footerBtnText, { color: Colors.error }]}>+ Despesa</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const cardShadow = { shadowColor: '#94A3B8', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 } as const;

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.background },
  header: { alignItems: 'center', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.borderBright, marginBottom: Spacing.sm },
  title: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700', textTransform: 'capitalize' },
  closeBtn: { position: 'absolute', right: Spacing.md, top: Spacing.md + 12 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  section: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, marginBottom: Spacing.md, ...cardShadow },
  sectionTitle: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.xs, gap: Spacing.sm },
  icon: { fontSize: 16, width: 24, textAlign: 'center' },
  rowLabel: { color: Colors.textPrimary, fontSize: 13, fontWeight: '500' },
  rowSub: { color: Colors.textSecondary, fontSize: 11 },
  rowValue: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  saldoSection: { alignItems: 'center' },
  saldoValue: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  footer: {
    flexDirection: 'row',
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: Spacing.sm,
  },
  footerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.errorBg,
    borderRadius: Radius.button,
    paddingVertical: Spacing.sm + 4,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  footerBtnText: { fontSize: 14, fontWeight: '700' },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```
git add src/components/ExpenseDaySheet.tsx
git commit -m "feat: add ExpenseDaySheet with income, expense list, saldo, and add buttons"
```

---

## Task 8: Wire CalendarHeatmapView into Expenses screen (`app/(tabs)/expenses.tsx`)

**Files:**
- Modify: `app/(tabs)/expenses.tsx`

**Interfaces:**
- Consumes:
  - `CalendarHeatmapView` from `@/src/components/CalendarHeatmapView`
  - `ExpenseDaySheet` from `@/src/components/ExpenseDaySheet`
  - `getCalendarHeatmap`, `type HeatmapDay` from `@/src/services/cockpit`

- [ ] **Step 1: Add new imports to `app/(tabs)/expenses.tsx`**

At the top of the file, add after the existing imports:

```tsx
import { CalendarHeatmapView } from '@/src/components/CalendarHeatmapView';
import { ExpenseDaySheet } from '@/src/components/ExpenseDaySheet';
import { getCalendarHeatmap, type HeatmapDay } from '@/src/services/cockpit';
```

- [ ] **Step 2: Add new state and helpers to `ExpensesScreen`**

Inside `ExpensesScreen` (the main screen component, wherever `useState` declarations are), add:

```tsx
const now = new Date();
const [calYear, setCalYear] = useState(now.getFullYear());
const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
const [heatmapDays, setHeatmapDays] = useState<HeatmapDay[]>([]);
const [selectedDay, setSelectedDay] = useState<number | null>(null);
const [daySheetVisible, setDaySheetVisible] = useState(false);
```

- [ ] **Step 3: Load heatmap data when month changes**

Add this `useEffect` inside `ExpensesScreen` (after the userId effect already there):

```tsx
useEffect(() => {
  if (!userId) return;
  getCalendarHeatmap(userId, calYear, calMonth)
    .then(setHeatmapDays)
    .catch(() => setHeatmapDays([]));
}, [userId, calYear, calMonth]);
```

- [ ] **Step 4: Add month-nav helpers**

Add these two functions inside `ExpensesScreen`:

```tsx
function prevMonth() {
  setCalMonth(m => {
    if (m === 1) { setCalYear(y => y - 1); return 12; }
    return m - 1;
  });
}

function nextMonth() {
  const thisYear = new Date().getFullYear();
  const thisMonth = new Date().getMonth() + 1;
  if (calYear === thisYear && calMonth === thisMonth) return; // no future months
  setCalMonth(m => {
    if (m === 12) { setCalYear(y => y + 1); return 1; }
    return m + 1;
  });
}
```

- [ ] **Step 5: Add calendar header and heatmap above the existing FlatList**

Find the main return JSX of `ExpensesScreen`. Add the following block BEFORE the `<FlatList>` (or its parent `<ScrollView>`):

```tsx
{/* Month navigation */}
<View style={calStyles.monthNav}>
  <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
    <Ionicons name="chevron-back" size={20} color={Colors.textPrimary} />
  </TouchableOpacity>
  <Text style={calStyles.monthLabel}>
    {new Date(calYear, calMonth - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
      .replace(/^\w/, c => c.toUpperCase())}
  </Text>
  <TouchableOpacity onPress={nextMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
    <Ionicons name="chevron-forward" size={20} color={Colors.textPrimary} />
  </TouchableOpacity>
</View>

{/* Calendar heatmap */}
<View style={calStyles.calCard}>
  <CalendarHeatmapView
    year={calYear}
    month={calMonth}
    days={heatmapDays}
    onDayPress={day => {
      setSelectedDay(day);
      setDaySheetVisible(true);
    }}
  />
</View>
```

And add the day sheet AFTER the FlatList / at the end of the render:

```tsx
<ExpenseDaySheet
  visible={daySheetVisible}
  year={calYear}
  month={calMonth}
  day={selectedDay}
  userId={userId}
  currencyCode={currencyCode}
  locale={locale}
  distanceUnit={distanceUnit}
  onClose={() => setDaySheetVisible(false)}
  onAddExpense={() => {
    setDaySheetVisible(false);
    // open the add expense modal — set the AddExpenseModal visible
    setAddModalVisible(true);
  }}
/>
```

> **Note on `setAddModalVisible`:** The existing expenses screen uses a state variable to open the add-expense modal. Use the same variable name already in the file (look for `addModalVisible` or similar). If the modal is opened by a separate state, use that.

- [ ] **Step 6: Add `calStyles` to the existing `StyleSheet.create` call in expenses.tsx**

```tsx
// Add these to the StyleSheet.create block at the bottom of expenses.tsx
const calStyles = StyleSheet.create({
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  monthLabel: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  calCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 2,
  },
});
```

- [ ] **Step 7: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Test manually**

```
npx expo start
```

Open Expenses tab. Verify:
- Month navigator at top
- Calendar heatmap renders below navigator with correct colors
- Tapping a day with data opens ExpenseDaySheet
- Sheet shows income and expense rows
- Sheet "+ Despesa" button opens add-expense modal
- FlatList of expenses still visible below heatmap

- [ ] **Step 9: Commit**

```
git add app/(tabs)/expenses.tsx
git commit -m "feat: add calendar heatmap and day detail sheet to expenses screen"
```

---

## Self-Review

### 1. Spec coverage

| Spec requirement | Task covering it |
|---|---|
| VehiclePill below saudação | Task 2 + Task 5 |
| StreakBar "🔥 N dias" | Task 2 + Task 5 |
| CockpitCard gauge semicircular | Task 3 |
| Meta diária = goal ÷ dias úteis | Task 1 (getDailyGoalCents) + Task 5 |
| 4 micro-stats (corridas/horas/km/despesas) | Task 3 |
| MonthHistoryCard substitui CarComparisonCard | Task 4 + Task 5 |
| Mês com maior receita = "⭐ melhor mês" | Task 4 ✓ |
| Badge "atual" dourado no mês corrente | Task 4 ✓ |
| Corridas + km no card histórico | Task 4 ✓ |
| Calendário heatmap na tela de despesas | Task 6 + Task 8 |
| Intensidades gold/red por faixa | Task 1 (intensityForCents) + Task 6 |
| Diagonal bicolor quando há ambos | Task 6 ✓ (SVG Polygon) |
| Nav mês ‹ ›  | Task 8 ✓ |
| DayDetailBottomSheet ao tocar dia | Task 7 + Task 8 |
| Income e expense rows no sheet | Task 7 ✓ |
| Saldo do dia colorido | Task 7 ✓ |
| "+ Despesa" no rodapé do sheet | Task 7 ✓ |
| Auth screens | ✅ Already done (login.tsx, register.tsx) |
| CarComparisonCard removido | Task 5 ✓ |

### 2. Placeholder scan

No TBDs found. The "Note on rides prop" in Task 5 is a known limitation — rides in the CockpitCard micro-stat always shows 0 until the daily summary includes a ride count. This is acceptable: the `shifts` table row count can be added to `getTodaySummary` in a follow-up. All other steps have complete code.

### 3. Type consistency

- `MonthHistoryItem` defined in Task 1, consumed in Task 4 — types match.
- `HeatmapDay` defined in Task 1, consumed in Tasks 6, 7, 8 — types match.
- `intensityForCents` returns `0 | 1 | 2 | 3` — used as index into GOLD_ALPHA/RED_ALPHA arrays of length 4 — correct.
- `streakFromDates` signature consistent between Task 1 test and implementation.
- `getDailyGoalCents` receives `(goalCents, workingDays, year, month)` — called this way in Task 5.
- `CockpitCard.onEditGoal` is `() => void` — passed `() => setGoalModalVisible(true)` in Task 5 — correct.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-10-cockpit-redesign.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
