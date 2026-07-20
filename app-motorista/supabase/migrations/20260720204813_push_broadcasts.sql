create table push_broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  filters jsonb not null default '{}'::jsonb,
  recipient_count int not null default 0,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table push_broadcasts enable row level security;

create policy "admins can read push_broadcasts"
  on push_broadcasts for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "admins can insert push_broadcasts"
  on push_broadcasts for insert
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
