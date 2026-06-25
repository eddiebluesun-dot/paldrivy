// supabase/functions/calculate-shift/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface CalcInput {
  started_at: string;
  ended_at: string;
  start_odometer: number;    // meters
  end_odometer: number;      // meters
  gross_cents: number;
  tips_cents: number;
  bonuses_cents: number;
  tolls_cents: number;
  parking_cents: number;
  food_cents: number;
  avg_consumption_per_100: number;     // ml per 100 distance_unit
  last_fuel_price_per_unit_cents: number;
  monthly_fixed_cents: number;
  days_in_month: number;
  shift_days: number;
}

export interface CalcResult {
  duration_hours: number;
  distance_meters: number;
  gross_cents: number;
  fuel_cost_cents: number;
  allocated_fixed_cents: number;
  net_cents: number;
  net_per_hour_cents: number;
  net_per_meter_cents: number;
}

export function calculateShift(input: CalcInput): CalcResult {
  const start = new Date(input.started_at).getTime();
  const end = new Date(input.ended_at).getTime();
  const duration_hours = (end - start) / 3_600_000;

  const distance_meters = input.end_odometer - input.start_odometer;
  const distance_per_100 = distance_meters / 1000 / 100; // in 100-km units
  const volume_ml = distance_per_100 * input.avg_consumption_per_100;
  const volume_units = volume_ml / 1000; // liters
  const fuel_cost_cents = Math.round(volume_units * input.last_fuel_price_per_unit_cents);

  const daily_fixed_cents = input.monthly_fixed_cents / input.days_in_month;
  const allocated_fixed_cents = Math.round(daily_fixed_cents * input.shift_days);

  const variable_costs = input.tolls_cents + input.parking_cents + input.food_cents;
  const gross_cents = input.gross_cents + input.tips_cents + input.bonuses_cents;
  const net_cents = gross_cents - fuel_cost_cents - allocated_fixed_cents - variable_costs;

  const net_per_hour_cents = duration_hours > 0 ? net_cents / duration_hours : 0;
  const net_per_meter_cents = distance_meters > 0 ? net_cents / distance_meters : 0;

  return {
    duration_hours,
    distance_meters,
    gross_cents,
    fuel_cost_cents,
    allocated_fixed_cents,
    net_cents,
    net_per_hour_cents,
    net_per_meter_cents,
  };
}

if (import.meta.main) serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { shift_id } = await req.json();

  const { data: shift } = await supabase
    .from('shifts')
    .select('*, vehicles(*), shift_earnings(*)')
    .eq('id', shift_id)
    .single();

  if (!shift?.ended_at || !shift?.end_odometer) {
    return new Response(JSON.stringify({ error: 'shift not ended' }), { status: 400 });
  }

  // fetch last fuel price for vehicle
  const { data: lastFuel } = await supabase
    .from('fuel_entries')
    .select('price_per_unit_cents')
    .eq('vehicle_id', shift.vehicle_id)
    .order('filled_at', { ascending: false })
    .limit(1)
    .single();

  const gross_cents = shift.shift_earnings.reduce(
    (sum: number, e: { gross_amount_cents: number }) => sum + e.gross_amount_cents, 0
  );

  const monthly_fixed_cents =
    shift.vehicles.monthly_cost_cents +
    shift.vehicles.monthly_insurance_cents +
    shift.vehicles.taxi_license_monthly_cents;

  const input: CalcInput = {
    started_at: shift.started_at,
    ended_at: shift.ended_at,
    start_odometer: shift.start_odometer,
    end_odometer: shift.end_odometer,
    gross_cents,
    tips_cents: shift.tips_cents,
    bonuses_cents: shift.bonuses_cents,
    tolls_cents: shift.tolls_cents,
    parking_cents: shift.parking_cents,
    food_cents: shift.food_cents,
    avg_consumption_per_100: shift.vehicles.avg_consumption_per_100,
    last_fuel_price_per_unit_cents: lastFuel?.price_per_unit_cents ?? 0, // 0 when no fill-up recorded yet
    monthly_fixed_cents,
    days_in_month: new Date(
      new Date(shift.started_at).getFullYear(),
      new Date(shift.started_at).getMonth() + 1, 0
    ).getDate(),
    shift_days: 1,
  };

  const calc = calculateShift(input);
  const fuel_price_missing = !lastFuel?.price_per_unit_cents;

  await supabase
    .from('shifts')
    .update({ calc })
    .eq('id', shift_id);

  return new Response(JSON.stringify({ ...calc, fuel_price_missing }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
