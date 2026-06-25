-- supabase/migrations/20260625000000_initial.sql

-- EXTENSIONS
create extension if not exists "uuid-ossp";

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
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "own profile" on profiles for all using (auth.uid() = id);

-- VEHICLES
create table vehicles (
  id uuid primary key default uuid_generate_v4(),
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

-- PLATFORMS (sem RLS — leitura pública)
create table platforms (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  country_code text,   -- null = global
  type text not null check (type in ('rideshare','taxi_app','taxi_conventional','delivery')),
  active boolean not null default true
);

-- SHIFTS
create table shifts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles on delete cascade,
  vehicle_id uuid not null references vehicles on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  start_odometer integer not null,  -- meters
  end_odometer integer,             -- meters
  tips_cents integer not null default 0,
  bonuses_cents integer not null default 0,
  tolls_cents integer not null default 0,
  parking_cents integer not null default 0,
  food_cents integer not null default 0,
  region text,
  notes text,
  -- cached calculation result (from edge function)
  calc jsonb,
  created_at timestamptz not null default now()
);
alter table shifts enable row level security;
create policy "own shifts" on shifts for all using (auth.uid() = user_id);

-- SHIFT EARNINGS PER PLATFORM
create table shift_earnings (
  id uuid primary key default uuid_generate_v4(),
  shift_id uuid not null references shifts on delete cascade,
  platform_id uuid not null references platforms,
  gross_amount_cents integer not null
);
alter table shift_earnings enable row level security;
create policy "own shift earnings" on shift_earnings for all
  using (auth.uid() = (select user_id from shifts where id = shift_id));

-- FUEL ENTRIES
create table fuel_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles on delete cascade,
  vehicle_id uuid not null references vehicles on delete cascade,
  filled_at timestamptz not null,
  odometer integer not null,  -- meters
  fuel_type text not null,
  volume_ml integer not null,
  total_amount_cents integer not null,
  price_per_unit_cents integer not null, -- per liter/gallon in cents
  station_name text,
  is_full_tank boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
alter table fuel_entries enable row level security;
create policy "own fuel" on fuel_entries for all using (auth.uid() = user_id);

-- EXPENSE CATEGORIES
create table expense_categories (
  id uuid primary key default uuid_generate_v4(),
  name_key text not null,  -- i18n key
  type text not null check (type in ('fixed','variable')),
  is_system boolean not null default false
);

-- EXPENSES
create table expenses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles on delete cascade,
  vehicle_id uuid references vehicles on delete set null,
  category_id uuid not null references expense_categories,
  expense_date date not null,
  amount_cents integer not null,
  description text,
  is_recurring boolean not null default false,
  recurrence_period text check (recurrence_period in ('daily','weekly','monthly','yearly')),
  created_at timestamptz not null default now()
);
alter table expenses enable row level security;
create policy "own expenses" on expenses for all using (auth.uid() = user_id);

-- GOALS
create table goals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles on delete cascade,
  type text not null check (type in ('daily','weekly','monthly','per_hour','per_km')),
  target_amount_cents integer not null,
  starts_at date not null,
  ends_at date,
  created_at timestamptz not null default now()
);
alter table goals enable row level security;
create policy "own goals" on goals for all using (auth.uid() = user_id);
