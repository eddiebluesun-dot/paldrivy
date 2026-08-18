-- Bug found during production verification of 20260818120000_km_gaps.sql:
-- recompute_km_gaps's "advance to latest reading" step was gated on
-- `readings.odometer >= prev_odometer`, contradicting its own comment
-- ("Always advance to the latest reading seen, even if this one didn't
-- produce a gap (odometer went backwards or stayed flat...)"). The guard
-- meant that a single downward reading anywhere in a vehicle's full
-- history permanently froze prev_odometer at its highest-ever value,
-- silently disabling ALL further gap detection for that vehicle from that
-- point forward.
--
-- Reproduced in production for vehicle 4483a9f5-10b0-442c-9732-415a1dc27264
-- (Eddie): fuel_entries before the 2026-08-05 rental contract start carry a
-- much higher odometer (~123,375,000 -- an earlier/different car under the
-- same vehicle_id), and the first shift after contract start
-- (2026-08-06T08:48, odometer 18,376,000) is a ~105,000,000m DECREASE.
-- Under the buggy guard, prev_odometer stayed frozen at 123,375,000
-- forever after that point, so the backfill (20260818120000) found only
-- 24 gaps, all ending by 2026-08-03 -- zero gaps after the contract
-- started, including the known real 114 km gap on 2026-08-15/17.
--
-- Fix: always advance, unconditionally, matching the existing comment's
-- already-documented intent exactly.
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
    -- Always advance, unconditionally -- even a downward reading (data-entry
    -- typo, or a genuine vehicle swap reusing the same vehicle_id) becomes
    -- the new prev_odometer baseline, so a single anomalous row can at most
    -- cause one bounded, driver-correctable gap on the NEXT reading -- it
    -- can never again silently disable all future gap detection.
    prev_odometer := readings.odometer;
    prev_at := readings.at;
  end loop;
end;
$$;
