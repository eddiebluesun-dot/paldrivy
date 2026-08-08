# Recurring Expense Daily Allocation — Design

**Goal:** for expenses flagged `recurring` (weekly/monthly), divide the expense amount across the driver's configured working days for that period, and deduct each day's share from that day's shift(s) profit calculation via the already-reserved-but-unimplemented `ShiftCalc.allocated_fixed_cents` field.

## Context

Real example from the owner: a weekly car rental of R$660, driver configured to work Mon-Sat (6 days) → R$660 ÷ 6 = R$110/day. If the driver skips a day (e.g. doesn't work a Monday), the recurring expense's total does NOT shrink — it's still R$660 for the week — but that day simply has no shift to allocate a share to, so no allocation entry exists for it.

Second example, confirming the same rule applies to monthly-frequency expenses: monthly car insurance. The owner's own phrase for the divisor was "dias úteis no mês" (business days in the month) — explicitly confirmed this means the driver's OWN configured `working_days` count within that month (e.g. ~26 days for a Mon-Sat driver), NOT a calendar business-day definition (Mon-Fri excluding holidays, typically 21-23/month). "Dias úteis"/"dias trabalhados" are used interchangeably by the owner throughout — both always resolve to `goal.working_days`, never a generic calendar concept, for both weekly and monthly recurring expenses.

`ShiftCalc.allocated_fixed_cents` already exists in `src/types/index.ts` as a field, but nothing in the codebase currently computes or writes to it — this feature is what finally implements it.

## Data model

No new tables/columns. This is a pure calculation layered on existing data:
- `expenses` table already has `recurring: boolean` and `recurring_frequency: 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual'`.
- `goals` table already has `working_days: integer[]` (the same field used by today's adaptive-daily-goal work — array of weekday numbers, e.g. `[1,2,3,4,5,6]` for Mon-Sat).
- `shifts.calc` (jsonb) already has a reserved `allocated_fixed_cents` slot in the `ShiftCalc` type.

## Scope of "recurring" for this feature

Only `recurring_frequency IN ('weekly', 'monthly')` participate in daily allocation. `quarterly`/`semiannual`/`annual` recurring expenses are out of scope for this pass (per the owner's example, which only described weekly; monthly is the natural sibling given the rental-km-allowance work already treats weekly/monthly as the two "real" periods and unlimited/longer cycles differently) — longer cycles can be added later using the same period-bounds math if needed, but aren't part of this design.

## Calculation

For a given user and a given day D (the day a shift occurred):

1. **Determine which recurring weekly/monthly expenses are "active" on day D** — an expense with `recurring = true`, `recurring_frequency` in `('weekly','monthly')`, whose period (using the SAME weekly/monthly period-bounds logic already built for rental km-allowance, `getPeriodBounds` in `src/utils/rentalKmAllowanceUtils.ts` — reuse it, don't reimplement, since "a period starting on the 29th-31st" needs the same clamping fix already shipped there) contains day D. The period's anchor date is the expense's own `expense_date` (the day it was first entered/it recurs from) — NOT `rental_contract_start_date`, which is unrelated; this is a general mechanism for any recurring expense, not specific to vehicle rentals.
2. **For each such expense, compute its daily share**: `expense.amount_cents ÷ (number of days in goal.working_days that fall within that expense's current period)`. Per the owner's explicit answer: multiple recurring expenses in the same period are **not** summed into one shared denominator — each expense computes its own daily share independently, using its own period and the driver's working-days config, then all shares for day D are summed for that day's total allocation.
3. **Sum all active recurring expenses' daily shares for day D** → `dailyFixedCostForDay`.
4. **Attribute to shift(s)**: if day D has exactly one shift, `allocated_fixed_cents = dailyFixedCostForDay` for that shift. If day D has N shifts (N > 1), split evenly: `allocated_fixed_cents = round(dailyFixedCostForDay / N)` per shift, distributing any rounding remainder to the last shift of the day (largest-remainder-style, to keep the day's total exact) — per the owner's explicit answer, multiple shifts split the day's allocation rather than the first shift absorbing it all.
5. **Days with no shift get no allocation entry** — the recurring expense's total is unaffected (point 2 above already computes the share from the FULL configured working-days count, not from actually-worked days, so skipping a day doesn't inflate other days' shares — it just means that day's share of the fixed cost isn't attributed to any shift's profit calc, matching "a despesa continua" from the owner's example).

## Where this plugs in

- `allocated_fixed_cents` feeds into `ShiftCalc.net_cents`/`net_per_hour_cents`/`net_per_meter_cents` — find wherever `ShiftCalc` is currently computed (likely `src/services/shifts.ts` or the shift-completion edge function referenced in earlier work today, `supabase/functions/calculate-shift/`) and confirm exactly how `net_cents` is derived today, since this feature needs to slot the new fixed-cost deduction into that existing formula without duplicating logic that already handles `fuel_cost_cents`.
- Per the owner's explicit choice, this ALSO needs to affect a shift's profit calculation directly (not just be shown informationally) — the existing per-shift net-profit numbers shown throughout the app (shift history, "Turnos" tab, etc.) should reflect this deduction once implemented.

## Retroactive recalculation

Forward-only. `allocated_fixed_cents` is computed once, at the time a shift is completed/its `ShiftCalc` is derived, using whatever recurring expenses are active for that shift's day AT THAT MOMENT. Adding, editing, or deleting a recurring expense afterward does NOT retroactively recalculate already-completed shifts' stored `net_cents`/`allocated_fixed_cents` — only shifts completed after the change pick up the new recurring-expense state. This matches how `gross_cents`/`fuel_cost_cents` already work elsewhere in this app (computed once at shift-completion time, not live-recomputed from current data on every read).

## Out of scope for this pass

- `quarterly`/`semiannual`/`annual` recurring expenses.
- Any UI to LIST/explain the daily allocation breakdown explicitly (the owner's answer was "no card, only affects the shift calculation" — if a future request wants visibility into "why is my profit lower today," that's a separate ask).
