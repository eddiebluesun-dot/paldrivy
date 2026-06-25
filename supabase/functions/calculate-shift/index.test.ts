// supabase/functions/calculate-shift/index.test.ts
import { assertEquals, assertAlmostEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { calculateShift, type CalcInput } from './index.ts';

const base: CalcInput = {
  started_at: '2026-06-25T08:00:00Z',
  ended_at: '2026-06-25T16:10:00Z',
  start_odometer: 87000000,   // 87.000 km em metros
  end_odometer: 87176000,     // +176 km
  gross_cents: 32000,         // R$ 320,00
  tips_cents: 0,
  bonuses_cents: 0,
  tolls_cents: 0,
  parking_cents: 0,
  food_cents: 0,
  avg_consumption_per_100: 10000, // 10L/100km em ml
  last_fuel_price_per_unit_cents: 599, // R$ 5,99/L
  monthly_fixed_cents: 120000, // R$ 1.200/mês
  days_in_month: 30,
  shift_days: 1,
};

Deno.test('duration_hours', () => {
  const r = calculateShift(base);
  assertAlmostEquals(r.duration_hours, 8.167, 0.01);
});

Deno.test('distance_meters', () => {
  const r = calculateShift(base);
  assertEquals(r.distance_meters, 176000);
});

Deno.test('fuel_cost_cents', () => {
  // 176km * 10L/100km = 17.6L * R$5.99 = R$105.42 ~ 10542 cents
  const r = calculateShift(base);
  assertAlmostEquals(r.fuel_cost_cents, 10542, 50);
});

Deno.test('net_cents', () => {
  const r = calculateShift(base);
  // gross 32000 - fuel ~10542 - fixed_alloc 4000 = ~17458
  assertAlmostEquals(r.net_cents, 17458, 100);
});

Deno.test('net_per_hour_cents', () => {
  const r = calculateShift(base);
  assertAlmostEquals(r.net_per_hour_cents, r.net_cents / r.duration_hours, 10);
});
