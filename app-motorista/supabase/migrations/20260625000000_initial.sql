-- supabase/migrations/20260625000000_initial.sql

-- PROFILES
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  country text not null default 'BR',
  city text,
  currency_code text not null default 'BRL',
  distance_unit text not null default 'km' check (distance_unit in ('km', 'mi')),
  volume_unit text not null default 'liters' check (volume_unit in ('liters', 'gallons')),
  timezone text not null default 'America/Sao_Paulo',
  locale text not null default 'pt-BR',
  onboarding_done boolean not null default false,
  vehicle_id uuid,  -- FK added after vehicles to avoid forward-reference
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "own profile" on profiles for all using (auth.uid() = id);

-- VEHICLES
create table vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  name text not null,
  brand text not null,
  model text not null,
  year smallint not null,
  plate text,
  fuel_type text not null check (fuel_type in ('gasoline','ethanol','diesel','gnv','electric','hybrid')),
  avg_consumption_per_100 integer not null, -- ml per 100 distance_unit
  ownership_type text not null check (ownership_type in ('own','rent','financed')),
  monthly_cost_cents integer not null default 0,
  monthly_insurance_cents integer not null default 0,
  current_odometer integer not null default 0, -- in meters
  purchase_price_cents integer,
  purchase_date date,
  target_swap_years smallint,
  target_swap_budget_cents integer,
  is_taxi boolean not null default false,
  taxi_license_monthly_cents integer not null default 0,
  created_at timestamptz not null default now()
);
alter table vehicles enable row level security;
create policy "own vehicles" on vehicles for all using (auth.uid() = user_id);

-- profiles.vehicle_id FK (deferred to after vehicles creation)
alter table profiles add constraint profiles_vehicle_id_fkey
  foreign key (vehicle_id) references vehicles on delete set null;

-- PLATFORMS (no RLS — public read)
create table platforms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country_code text,
  type text not null check (type in ('rideshare','taxi_app','taxi_conventional','delivery')),
  active boolean not null default true
);

-- SHIFTS
create table shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  vehicle_id uuid references vehicles on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  odometer_start_meters integer,
  odometer_end_meters integer,
  platforms jsonb,              -- [{platform_name, amount_cents}]
  tips_cents integer not null default 0,
  bonuses_cents integer not null default 0,
  tolls_cents integer not null default 0,
  parking_cents integer not null default 0,
  food_cents integer not null default 0,
  gross_cents integer,          -- filled by calculate-shift edge function
  net_cents integer,            -- filled by calculate-shift edge function
  duration_seconds integer,     -- filled by calculate-shift edge function
  region text,
  notes text,
  calc jsonb,                   -- full breakdown from edge function
  created_at timestamptz not null default now()
);
alter table shifts enable row level security;
create policy "own shifts" on shifts for all using (auth.uid() = user_id);

-- FUEL ENTRIES
create table fuel_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  vehicle_id uuid references vehicles on delete set null,
  filled_at timestamptz not null,
  odometer_meters integer,
  fuel_type text not null,
  volume_ml integer not null,
  total_cost_cents integer not null,
  price_per_unit_cents integer not null,
  station text,
  full_tank boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
alter table fuel_entries enable row level security;
create policy "own fuel" on fuel_entries for all using (auth.uid() = user_id);

-- EXPENSES
create table expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  vehicle_id uuid references vehicles on delete set null,
  category text not null,
  expense_date date not null,
  amount_cents integer not null,
  description text,
  recurring boolean not null default false,
  created_at timestamptz not null default now()
);
alter table expenses enable row level security;
create policy "own expenses" on expenses for all using (auth.uid() = user_id);

-- GOALS
create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  type text not null check (type in ('daily','weekly','monthly','per_hour','per_km')),
  target_amount_cents integer not null,
  starts_at date not null,
  ends_at date,
  created_at timestamptz not null default now()
);
alter table goals enable row level security;
create policy "own goals" on goals for all using (auth.uid() = user_id);
