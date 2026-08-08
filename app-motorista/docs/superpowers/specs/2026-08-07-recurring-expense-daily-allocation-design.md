# Recurring Expense Daily Allocation — Design

**Goal:** for expenses flagged `recurring` (weekly/monthly), divide the expense amount across the driver's configured working days for that period, and deduct each day's share from that day's shift(s) profit calculation via the already-reserved-but-unimplemented `ShiftCalc.allocated_fixed_cents` field.

## Context

Real example from the owner: a weekly car rental of R$660, driver configured to work Mon-Sat (6 days) → R$660 ÷ 6 = R$110/day. If the driver skips a day (e.g. doesn't work a Monday), the recurring expense's total does NOT shrink — it's still R$660 for the week — but that day simply has no shift to allocate a share to, so no allocation entry exists for it.

Second example, confirming the same rule applies to monthly-frequency expenses: monthly car insurance. The owner's own phrase for the divisor was "dias úteis no mês" (business days in the month) — explicitly confirmed this means the driver's OWN configured `working_days` count within that month (e.g. ~26 days for a Mon-Sat driver), NOT a calendar business-day definition (Mon-Fri excluding holidays, typically 21-23/month). "Dias úteis"/"dias trabalhados" are used interchangeably by the owner throughout — both always resolve to `goal.working_days`, never a generic calendar concept, for both weekly and monthly recurring expenses.

`ShiftCalc.allocated_fixed_cents` exists in `src/types/index.ts`, but investigation found the ENTIRE `ShiftCalc`/`shifts.calc` jsonb structure is dead code — `fuel_cost_cents`, `net_per_hour_cents`, `net_per_meter_cents` are never written by any of `calcGrossNet`/`endShift`/`updateShift`/`createManualShift` in `src/services/shifts.ts`. The real, actually-used profit calculation is `net_cents` (a plain top-level `shifts` column), computed by `calcGrossNet()`: `grossCents - (tolls_cents + parking_cents + food_cents)` — no fuel cost, no fixed-cost deduction, nothing beyond those three trip-level deductions today.

**Correction from the field's apparent intent**: rather than populating the unused `calc` jsonb blob that nothing reads, this feature adds a genuine new top-level `shifts.allocated_fixed_cents` column (matching the established pattern of `gross_cents`/`net_cents`/`fuel_cost_cents`-if-it-existed being real columns, not jsonb), and folds it into `calcGrossNet`'s `netCents` result as an additional deduction. The pre-existing `ShiftCalc` type/`calc` column are left untouched — out of scope to resurrect unrelated dead code as part of this feature.

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

- New column `shifts.allocated_fixed_cents integer not null default 0`.
- `calcGrossNet()` in `src/services/shifts.ts` (called by `endShift`, `updateShift`, `createManualShift` — all three call sites need the same treatment, they currently duplicate the gross/net computation identically) gains a new parameter/lookup for this shift's allocated fixed cost, and folds it into `netCents`: `netCents = grossCents - deductions - allocatedFixedCents`.
- The calculation from "Calculation" above (which recurring expenses are active for this shift's day, this driver's `working_days`, split across same-day shifts) needs to run BEFORE `calcGrossNet` so its result can be passed in — likely a new function `getAllocatedFixedCentsForShift(userId, shiftDate)` in a new or existing service, called from `endShift`/`updateShift`/`createManualShift` right before `calcGrossNet`.
- Per the owner's explicit choice, this needs to affect the shift's PERSISTED `net_cents` (not just a display-time calculation) — the existing per-shift net-profit numbers shown throughout the app (shift history, "Turnos" tab, etc.) already just read `net_cents` directly, so writing the correct value at shift-completion time is sufficient; no other display code needs to change.

## Retroactive recalculation

Forward-only. `allocated_fixed_cents` is computed once, at the time a shift is completed/its `ShiftCalc` is derived, using whatever recurring expenses are active for that shift's day AT THAT MOMENT. Adding, editing, or deleting a recurring expense afterward does NOT retroactively recalculate already-completed shifts' stored `net_cents`/`allocated_fixed_cents` — only shifts completed after the change pick up the new recurring-expense state. This matches how `gross_cents`/`fuel_cost_cents` already work elsewhere in this app (computed once at shift-completion time, not live-recomputed from current data on every read).

## Out of scope for this pass

- `quarterly`/`semiannual`/`annual` recurring expenses.
- Any UI to LIST/explain the daily allocation breakdown explicitly (the owner's answer was "no card, only affects the shift calculation" — if a future request wants visibility into "why is my profit lower today," that's a separate ask).
