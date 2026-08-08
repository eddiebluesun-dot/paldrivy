alter table public.shifts
  add column allocated_fixed_cents integer not null default 0;

comment on column public.shifts.allocated_fixed_cents is
  'This shift''s share of active weekly/monthly recurring expenses for its day, computed once at shift-completion time (endShift/updateShift/createManualShift in src/services/shifts.ts) and folded into net_cents. Forward-only: never retroactively recalculated when recurring expenses change later. See docs/superpowers/specs/2026-08-07-recurring-expense-daily-allocation-design.md.';
