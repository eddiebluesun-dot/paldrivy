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
