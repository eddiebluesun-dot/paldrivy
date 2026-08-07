alter table public.platforms enable row level security;

-- Reference/lookup table (known ride-share/delivery platforms): safe to read
-- publicly, including by unauthenticated clients, since it's non-sensitive
-- catalog data the app needs for platform pickers before/without login.
create policy "platforms_public_read" on public.platforms
  for select
  using (true);

-- No insert/update/delete policy is created: only the service_role key
-- (which bypasses RLS entirely) can write to this table. Regular users and
-- the anon/authenticated roles have no path to modify it.
