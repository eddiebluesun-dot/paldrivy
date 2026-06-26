import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ShiftPlatform {
  platform_name: string
  amount_cents: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { shift_id } = await req.json()
    if (!shift_id) {
      return new Response(JSON.stringify({ error: 'shift_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: shift, error: shiftError } = await supabase
      .from('shifts')
      .select('*')
      .eq('id', shift_id)
      .single()

    if (shiftError || !shift) {
      return new Response(JSON.stringify({ error: 'shift not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Duration
    const startedAt = new Date(shift.started_at)
    const endedAt = shift.ended_at ? new Date(shift.ended_at) : new Date()
    const duration_seconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)

    // Distance
    const distance_meters =
      shift.odometer_start_meters != null && shift.odometer_end_meters != null
        ? shift.odometer_end_meters - shift.odometer_start_meters
        : 0

    // Gross = sum of platform earnings + tips + bonuses
    const platforms: ShiftPlatform[] = shift.platforms ?? []
    const platform_gross = platforms.reduce((sum, p) => sum + (p.amount_cents ?? 0), 0)
    const gross_cents = platform_gross + (shift.tips_cents ?? 0) + (shift.bonuses_cents ?? 0)

    // Fuel cost: estimated from distance + vehicle avg consumption + last fill-up price
    let fuel_cost_cents = 0
    if (shift.vehicle_id && distance_meters > 0) {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('avg_consumption_per_100')
        .eq('id', shift.vehicle_id)
        .single()

      if (vehicle) {
        const { data: recentFuel } = await supabase
          .from('fuel_entries')
          .select('price_per_unit_cents')
          .eq('vehicle_id', shift.vehicle_id)
          .order('filled_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (recentFuel) {
          // avg_consumption_per_100 is ml per 100 km; convert distance to km
          const km = distance_meters / 1000
          const volume_used_ml = (vehicle.avg_consumption_per_100 / 100) * km
          const liters_used = volume_used_ml / 1000
          fuel_cost_cents = Math.round(liters_used * recentFuel.price_per_unit_cents)
        }
      }
    }

    const allocated_fixed_cents = 0

    const deductions =
      (shift.tolls_cents ?? 0) +
      (shift.parking_cents ?? 0) +
      (shift.food_cents ?? 0) +
      fuel_cost_cents +
      allocated_fixed_cents

    const net_cents = gross_cents - deductions

    const duration_hours = duration_seconds / 3600
    const net_per_hour_cents = duration_hours > 0 ? Math.round(net_cents / duration_hours) : 0
    const net_per_meter_cents =
      distance_meters > 0 ? Math.round((net_cents * 1000) / distance_meters) : 0

    const calc = {
      duration_hours,
      distance_meters,
      gross_cents,
      fuel_cost_cents,
      allocated_fixed_cents,
      net_cents,
      net_per_hour_cents,
      net_per_meter_cents,
    }

    const { error: updateError } = await supabase
      .from('shifts')
      .update({ gross_cents, net_cents, duration_seconds, calc })
      .eq('id', shift_id)

    if (updateError) throw updateError

    return new Response(JSON.stringify({ gross_cents, net_cents, duration_seconds, calc }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
