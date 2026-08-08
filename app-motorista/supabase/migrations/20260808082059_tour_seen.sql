alter table public.profiles
  add column tour_seen boolean not null default false;

comment on column public.profiles.tour_seen is
  'Whether the driver has completed or skipped the interactive guided tour. Separate from onboarding_done, which gates access to the main app and is already true by the time any user could see this tour.';
