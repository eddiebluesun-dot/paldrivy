# Vehicle Recurring Cost Lifecycle (Daily/Weekly Rent + Ending a Recurring Charge) — Design

**Goal:** let a rented vehicle's cost be entered as daily, weekly, or monthly (not just monthly), make the vehicle's own cost field the single source of truth that drives the existing daily-rateio engine (instead of a manually-created, unlinked recurring expense), and let any recurring expense be given an end date so it stops being rated going forward once a financing is paid off or a rental contract ends.

## Context

Investigated during this session (owner: Eddie, account `db85eea7-8cd7-464d-ba68-05f1e8a15560`): `vehicles.monthly_cost_cents` (filled at registration/edit, "Custo mensal de aluguel ou financiamento") is **write-only** — nothing in the app reads it for display or calculation. The actual recurring cost that feeds `getAllocatedFixedCentsForShift`/`syncAllocatedFixedCentsForDay` (the daily-rateio engine from `2026-08-07-recurring-expense-daily-allocation-design.md`) is a separate row the owner created manually in the Despesas tab (`category: 'rent'`, `amount_cents: 80431`, `recurring_frequency: 'weekly'`, `vehicle_id: null` — not even linked to the vehicle). Two parallel, disconnected representations of the same real-world cost.

The owner also wants to be able to end a recurring expense (paid off financing, ended a rental) without it retroactively changing already-closed historical periods.

## Data model

**`expenses` table** (existing — this is the same table/engine from the 08-07 design, no new table):
- New column: `ends_at date null`. When set, this expense stops contributing to the daily allocation for any day `>= ends_at`. Days before `ends_at` are unaffected (forward-only, matches the existing "forward-only" allocation posture from the 08-07 design — no retroactive recalculation of past shifts either way).
- `recurring_frequency` CHECK constraint (`expenses_recurring_frequency_check`) currently allows `weekly|monthly|quarterly|semiannual|annual`. Migration adds `daily` to the allowed list.
- No new columns needed for the vehicle link — `expenses.vehicle_id` already exists (FK to `vehicles`, `ON DELETE SET NULL`) and is already selected/available; it's just never populated by the vehicle-registration flow today.

**`vehicles` table:** no schema change. `monthly_cost_cents` stays in the table (avoid a risky rename/migration touching existing rows) but the app stops treating it as authoritative for rent/financed vehicles — see "Where this plugs in".

**One recurring cost row per vehicle, by convention:** "the vehicle's own recurring cost" = the row in `expenses` where `vehicle_id = <this vehicle>` and `recurring = true`. The app enforces at most one such row per vehicle (find-or-update on save, never insert a second one) — this is an application-level invariant, not a DB constraint, matching how the rest of this table works (no uniqueness constraints on `expenses` today).

## Scope

- Daily/weekly/monthly selector: **only for `ownership_type = 'rent'`**. `financed` and `own` keep the existing single monthly-only field, unchanged (a financing installment is conventionally monthly; the owner confirmed this).
- Vehicle-as-source-of-truth: applies to `rent` and `financed` (both already use `monthly_cost_cents` today) — both now manage a linked `expenses` row instead of a decorative vehicle column. `own` vehicles do not get a linked recurring expense (no change from today — an owned car's monthly field, if ever used, stays as-is; it was never wired to the rateio engine before this feature and this design doesn't change that).
- `ends_at`: available on **any** recurring expense (owner's explicit choice — broader than just vehicle costs), surfaced in the existing recurring-expense edit form. No pause/resume — ending is permanent (owner's explicit choice); to resume, the driver creates a new recurring expense.
- Out of scope: `quarterly`/`semiannual`/`annual` allocation is a pre-existing gap (the UI already offers these frequencies but `computeDailyAllocationCents` silently skips them — confirmed during investigation, unrelated to this feature, not touched here). Rental-km-allowance (`rental_km_allowance_*`, the "Franquia de km" widget) is a separate mechanism keyed off `ownership_type === 'rent'` + `rental_contract_start_date` and is not touched by this design — ending a rental's cost via `ends_at` does not change `ownership_type` or stop the km-allowance widget; that's a known follow-up, not part of this ask.

## Calculation changes

`computeDailyAllocationCents` (`src/utils/recurringExpenseAllocationUtils.ts`):

1. `RecurringExpenseInput` gains `endsAt: string | null` and `'daily'` is added to the `frequency` union.
2. Before computing a share for an expense on `targetDate`: if `endsAt != null && targetDate >= endsAt`, this expense contributes 0 for that day (same early-exit shape as the existing working-day check).
3. `'daily'` frequency bypasses the period-bounds/division machinery entirely: if `targetDate` is a working day and not past `endsAt`, the expense contributes its **full** `amountCents` for that day (a daily rate is already "per working day," nothing to divide across a period) — no `getPeriodBounds` call needed for this branch.
4. `'weekly'`/`'monthly'` behavior is unchanged aside from the new `endsAt` check.

`getRecurringExpenseTotalForRange`/`getRecurringExpenseBreakdownForRange`/`getRecurringExpenseBreakdownForDay`/`syncAllocatedFixedCentsForDay` (`src/services/recurringExpenseAllocation.ts`): all four already `select` a fixed column list from `expenses` and filter `recurring_frequency in ('weekly','monthly')` before mapping to `RecurringExpenseInput`. Each needs: add `ends_at` to the select, add `'daily'` to the frequency filter, pass `endsAt: e.ends_at` through to the mapped `RecurringExpenseInput`. Four call sites, same mechanical change each time — no new function needed.

## Vehicle registration / edit UI

`app/(auth)/register.tsx` (Seção 3, Veículo) and `app/(tabs)/more.tsx` `VehicleModal`: when `ownership === 'rent'`, replace the single "Custo mensal" `TextInput` with a frequency `Select` (Diário/Semanal/Mensal, matching `RECURRING_FREQUENCIES`-style options already used in `expenses.tsx`) plus one amount `TextInput`, dynamically labeled by the chosen frequency. `financed`/`own` keep today's single monthly field unchanged.

**On save** (both the registration flow and the edit flow in `more.tsx`): after the vehicle row itself is created/updated, find-or-update the vehicle's linked recurring expense:
- Query `expenses` for `vehicle_id = <this vehicle> and recurring = true` (limit 1).
- If found: `update` its `amount_cents`/`recurring_frequency` to match the form.
- If not found: `insert` a new row (`vehicle_id`, `user_id`, `category: 'rent'` or `'financing'` matching `ownership_type`, `amount_cents`, `recurring: true`, `recurring_frequency`, `expense_date: today`).
- `ownership_type === 'own'`: no linked expense is created/touched (matches Scope above). If a vehicle is edited FROM `rent`/`financed` TO `own`, its previously-linked expense is left as-is (not deleted, not auto-ended) — the driver can end it manually via the Despesas tab or the vehicle-screen shortcut below if that's what they want; the app doesn't guess intent here.

**"Encerrar aluguel/financiamento" shortcut**: shown on `VehicleModal` (edit mode) when `ownership_type` is `rent` or `financed` and a linked recurring expense exists. Sets that expense's `ends_at` to today. Same effect as ending it from the Despesas tab — this is a convenience entry point, not a separate mechanism.

## Existing data migration (one-time)

The owner's current unlinked `rent` expense (`id 16eab437-db08-49c3-87ed-7c28d3933ad9`, `amount_cents: 80431`, `recurring_frequency: 'weekly'`, `vehicle_id: null`) gets `vehicle_id` set to the Renault Kwid (`4483a9f5-10b0-442c-9732-415a1dc27264`) as a one-off data fix alongside this feature's rollout (not a generic migration script — a single, specific `update` run once, since this is the only pre-existing orphaned vehicle-cost expense found). After this, editing the vehicle's cost in the app will find this row via the find-or-update logic above instead of creating a duplicate.

## Recurring expense edit UI (Despesas tab)

`app/(tabs)/expenses.tsx` `ExpenseFormProps`/`ExpenseFormModal` (the same form used for both quick-add and edit, per the existing `recurring`/`frequency` state already read there): when `recurring` is true, add an optional date field "Data de encerramento" below the frequency `Select`. Empty by default (no end date = still active, today's behavior unchanged). `RECURRING_FREQUENCIES` gains `'daily'` alongside the existing five.

## Testing

- `recurringExpenseAllocationUtils.test.ts`: new cases for `'daily'` frequency (full amount every working day, 0 on non-working days) and `endsAt` (0 contribution on/after the end date, unchanged contribution before it), plus a case combining both.
- `recurringExpenseAllocation.test.ts`: the four range/day functions' existing mocks extended to cover `ends_at`/`'daily'` passthrough.
- Vehicle-save find-or-update logic: unit test for both branches (existing linked expense gets updated, no existing one gets created) — likely alongside `vehicles.ts`/`completeRegistration.ts` tests.
