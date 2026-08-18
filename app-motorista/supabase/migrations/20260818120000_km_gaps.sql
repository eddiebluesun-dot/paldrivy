create table public.km_gaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  start_odometer_meters integer not null,
  end_odometer_meters integer not null,
  gap_meters integer generated always as (end_odometer_meters - start_odometer_meters) stored,
  start_at timestamptz not null,  -- timestamp of the reading right before the gap (the last known odometer value before it)
  end_at timestamptz not null,    -- timestamp of the reading that revealed the gap (the first reading after it)
  category text not null default 'personal_use'
    check (category in ('personal_use', 'other')),
  note text,
  is_edited boolean not null default false, -- true once the driver changes category/note; excludes this row from future auto-recompute
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint km_gaps_positive check (gap_meters > 0)
);

create index km_gaps_vehicle_idx on public.km_gaps (vehicle_id, start_at);

alter table public.km_gaps enable row level security;

create policy "km_gaps: usuario ve os proprios" on public.km_gaps
  for select using (user_id = auth.uid() or is_admin());
create policy "km_gaps: usuario edita os proprios" on public.km_gaps
  for update using (user_id = auth.uid() or is_admin());
create policy "km_gaps: usuario deleta os proprios" on public.km_gaps
  for delete using (user_id = auth.uid() or is_admin());
-- No user-facing INSERT policy: rows are only ever created by the
-- SECURITY DEFINER trigger function below, never directly by the app.

comment on table public.km_gaps is
  'Auto-detected odometer jumps between two consecutive readings (shift start/end, fuel fill-up) for a vehicle, with nothing logged in between -- almost always personal/leisure driving. Fully recomputed (see recompute_km_gaps()) on every shift/fuel_entries write for that vehicle, EXCEPT rows with is_edited=true, which the driver has manually recategorized and which recompute leaves untouched. See docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md.';

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
  -- Wipe only the auto-generated, untouched rows for this vehicle -- rows
  -- the driver has edited (is_edited=true) are preserved as-is, even if
  -- they no longer exactly match a gap the fresh scan below would find.
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
    -- Always advance to the latest reading seen, even if this one didn't
    -- produce a gap (odometer went backwards or stayed flat -- data entry
    -- noise, not a gap) -- otherwise a single bad row would poison every
    -- gap computed after it.
    if prev_odometer is null or readings.odometer >= prev_odometer then
      prev_odometer := readings.odometer;
      prev_at := readings.at;
    end if;
  end loop;
end;
$$;

create or replace function public.trg_recompute_km_gaps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.vehicle_id is not null then
      perform public.recompute_km_gaps(old.vehicle_id, old.user_id);
    end if;
    return old;
  end if;
  if new.vehicle_id is not null then
    perform public.recompute_km_gaps(new.vehicle_id, new.user_id);
  end if;
  -- A vehicle_id change (rare, but the column is nullable/updatable) needs
  -- the OLD vehicle's gaps recomputed too, or a stale gap can outlive the
  -- reading that justified it.
  if tg_op = 'UPDATE' and old.vehicle_id is not null and old.vehicle_id is distinct from new.vehicle_id then
    perform public.recompute_km_gaps(old.vehicle_id, old.user_id);
  end if;
  return new;
end;
$$;

create trigger shifts_recompute_km_gaps
  after insert or update or delete on public.shifts
  for each row execute function public.trg_recompute_km_gaps();

create trigger fuel_entries_recompute_km_gaps
  after insert or update or delete on public.fuel_entries
  for each row execute function public.trg_recompute_km_gaps();

-- SECURITY: recompute_km_gaps is SECURITY DEFINER (needs to write km_gaps
-- despite the table having no INSERT policy), which means if any
-- authenticated user could call it directly via RPC, they could pass an
-- arbitrary vehicle_id/user_id and force a recompute against a vehicle they
-- don't own -- not a data-modification risk (the function only ever
-- derives gap rows from that vehicle's own real shifts/fuel_entries, it
-- can't fabricate arbitrary data), but it would let one user trigger
-- unwanted writes/load against another user's rows. Revoke direct execute
-- access; only the trigger functions (which run with the privileges of
-- their own SECURITY DEFINER, not the calling user's grants) may invoke it.
revoke execute on function public.recompute_km_gaps(uuid, uuid) from public, authenticated, anon;
