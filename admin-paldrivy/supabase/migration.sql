-- ============================================================
-- PalDrivy Admin Migration
-- Run this in Supabase SQL Editor (Dashboard > SQL)
-- ============================================================

-- 1. Add role column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'driver';

-- 2. Plans table
CREATE TABLE IF NOT EXISTS plans (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  description TEXT,
  price_cents INTEGER     NOT NULL DEFAULT 0,
  interval    TEXT        NOT NULL DEFAULT 'monthly',
  features    JSONB       NOT NULL DEFAULT '[]',
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default plans
INSERT INTO plans (name, description, price_cents, interval, features, sort_order)
VALUES
  ('Free',    'Comece gratuitamente',            0,    'monthly', '["Até 5 turnos/mês","Histórico 30 dias","Dashboard básico"]',              0),
  ('Pro',     'Para motoristas profissionais', 1990,   'monthly', '["Turnos ilimitados","Histórico completo","DRE mensal","Relatórios PDF","Suporte prioritário"]', 1),
  ('Premium', 'Gestão completa avançada',     3990,   'monthly', '["Tudo do Pro","Multi-veículo","API access","Relatórios customizados","Suporte 24/7"]', 2)
ON CONFLICT DO NOTHING;

-- 3. Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id              UUID        NOT NULL REFERENCES plans(id),
  status               TEXT        NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 month'),
  cancelled_at         TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- 4. Helper function: is current user admin?
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 5. RLS on plans
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_read_active"  ON plans;
DROP POLICY IF EXISTS "plans_admin_all"    ON plans;

CREATE POLICY "plans_read_active" ON plans
  FOR SELECT USING (is_active = true OR is_admin());

CREATE POLICY "plans_admin_all" ON plans
  FOR ALL USING (is_admin());

-- 6. RLS on subscriptions
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_own"       ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_admin_all" ON subscriptions;

CREATE POLICY "subscriptions_own" ON subscriptions
  FOR SELECT USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "subscriptions_admin_all" ON subscriptions
  FOR ALL USING (is_admin());

-- 7. Admin can read ALL profiles (others only their own)
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (id = auth.uid() OR is_admin());

-- 8. Admin can update ALL profiles (role, status, etc.)
DROP POLICY IF EXISTS "profiles_admin_update" ON profiles;
CREATE POLICY "profiles_admin_update" ON profiles
  FOR UPDATE USING (id = auth.uid() OR is_admin());

-- 9. Admin read access to all shifts, expenses, fuel_entries, vehicles
-- (adjust table names if yours differ)
DROP POLICY IF EXISTS "shifts_admin_select"       ON shifts;
DROP POLICY IF EXISTS "expenses_admin_select"     ON expenses;
DROP POLICY IF EXISTS "fuel_entries_admin_select" ON fuel_entries;
DROP POLICY IF EXISTS "vehicles_admin_select"     ON vehicles;

CREATE POLICY "shifts_admin_select"       ON shifts       FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "expenses_admin_select"     ON expenses     FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "fuel_entries_admin_select" ON fuel_entries FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "vehicles_admin_select"     ON vehicles     FOR SELECT USING (user_id = auth.uid() OR is_admin());

-- 10. Promote first admin (replace with your user ID from Supabase Auth > Users)
-- UPDATE profiles SET role = 'admin' WHERE id = 'YOUR-USER-UUID-HERE';
