# Rental Vehicle KM/Mile Allowance Tracking — Design

**Goal:** for drivers with a rented vehicle (`vehicles.ownership_type = 'rent'`), track total odometer usage (work + personal/leisure) against the rental contract's km/mile allowance, alert as the driver approaches and exceeds it, and let them optionally log the estimated overage as an expense.

## Context

Real example from the owner: rented a car starting 2026-08-05 at odometer 18332. A driver's shift can end at 12300 and the next shift start at 12400 — the 100 km in between is personal/leisure driving, and rental contracts cap TOTAL km driven, not just work km. The allowance must include that gap.

**Existing users joining mid-contract:** a driver installing the app for the first time may already be months into a rental contract. They'll typically still know/have the contract's start date on paper, but are unlikely to remember the exact odometer reading from pickup day. `rental_contract_start_odometer` must therefore be OPTIONAL, not required — see the baseline-determination fallback below.

## Data model

New nullable columns on `public.vehicles`, populated only when `ownership_type = 'rent'` (matching the existing pattern of ownership-type-conditional columns already on this table, e.g. `monthly_cost_cents`, `purchase_date` for 'own'/'financed'):

- `rental_contract_start_date` (date) — anchor date for period calculation. Required whenever `rental_km_allowance_period != 'unlimited'` — a driver signing up mid-contract will still know this from their paperwork even if they don't remember the exact odometer.
- `rental_contract_start_odometer` (integer, meters, nullable/OPTIONAL) — the odometer reading at pickup, if known. Explicit rather than inferred when available, because the first logged shift/fuel entry may come days after pickup and would otherwise miss the gap. Left blank by drivers joining the app mid-contract who no longer remember/have this — see the baseline fallback below for what happens then.
- `rental_km_allowance_period` (text, check: `'weekly' | 'monthly' | 'unlimited'`).
- `rental_km_allowance_amount` (integer) — in the unit implied by `profiles.distance_unit` (km or mi) at the time it's set; store consistently, format for display via existing unit-conversion helpers.
- `rental_km_excess_rate_cents` (integer) — cost per km/mile over the allowance, in the same unit as the allowance.

No new table — this follows the vehicles table's existing convention of nullable, ownership-type-scoped columns rather than a separate one-to-one table.

## KM tracking calculation

Reuse the chronological-odometer-readings-segmented-by-vehicle_id building block already built today for the vehicle-swap km fix (`src/utils/fuelConsumptionUtils.ts`'s approach) — extend it to pull from **both** `shifts` (`odometer_start_meters`/`odometer_end_meters`) and `fuel_entries` (`odometer_meters`), not fuel entries alone, since either can be the most recent known reading.

For a given rental vehicle and "now":

1. Determine the current allowance period's start date:
   - If `rental_km_allowance_period = 'unlimited'`: no tracking, no alerts — skip everything below.
   - Otherwise, compute the period boundary on or before "now", counting forward from `rental_contract_start_date` in 7-day (weekly) or 1-calendar-month (monthly) increments. (E.g. contract started 2026-08-05, monthly: periods are [08-05, 09-05), [09-05, 10-05), ...)
2. Determine the period's starting odometer baseline:
   - If this is the FIRST period (period start == `rental_contract_start_date`) AND `rental_contract_start_odometer` is set: baseline = `rental_contract_start_odometer`.
   - Otherwise (a later period, OR the first period but the driver left the start odometer blank because they joined mid-contract): baseline = the odometer value from the most recent shift/fuel-entry reading at or before the period's start date. If none exists (no logged activity since the period began until some point after it started — this is the expected case for a driver who just installed the app), baseline = the first reading found at/after the period start. Either way, the gap before that first available reading is unavoidably unmeasured for that period — surface this as a known limitation in the UI copy (e.g. "Contagem iniciada a partir do seu primeiro registro neste período") rather than a silent wrong number.
3. Current usage = (latest known odometer reading for this vehicle, from shifts or fuel_entries) − baseline. This inherently includes all driving in between, work or personal — no need to classify individual trips.
4. Percentage used = usage ÷ `rental_km_allowance_amount`.

## Alerts (dashboard hero)

Shown in the dashboard's hero/top section (near the vehicle picker pill), only for the active vehicle if it's a tracked rental (`ownership_type = 'rent'` and `rental_km_allowance_period != 'unlimited'`):

- **≥90% of allowance**: warning-styled banner, e.g. "⚠️ 90% da franquia usada — faltam N km/mi neste período."
- **≥100% of allowance**: alert-styled banner with the estimated overage: "🚨 Franquia excedida em N km/mi — ~R$X estimado." Includes an "Adicionar como despesa" button.
- **"Adicionar como despesa" button**: on tap, creates one `expenses` row with category `km_excedente` (`expenses.category` is a free-text column, no check constraint — confirmed via schema, no migration needed for the new category value) for the currently-computed estimated overage amount. Not automatic — the driver must tap it. Tapping it once per period is expected; consider disabling/relabeling the button ("Despesa já adicionada") if one was already logged for the current period, to avoid accidental duplicates — implementer's call on exact UX, keep it simple.
- Below 90%: no banner (or an optional quiet/collapsed indicator — implementer's call, don't over-design this part).

## Registration/edit form

In the vehicle add/edit form, when `ownership_type = 'rent'` is selected, reveal the five new fields (contract start date, contract start odometer, allowance period, allowance amount, excess rate — labeled/formatted using the driver's configured distance unit). Hidden entirely for 'own'/'financed'. Contract start date is required whenever the allowance period isn't 'unlimited'; contract start odometer is optional, with placeholder/helper copy along the lines of "Não sabe o km da retirada? Deixe em branco — vamos contar a partir do seu primeiro registro" so drivers joining mid-contract aren't blocked. If the driver later switches an existing vehicle from 'rent' to something else, the rental fields become irrelevant but the columns stay (nullable, harmless) — no migration/cleanup needed for that edge case.

## Out of scope for this pass

- Historical backfill for rentals that started before this feature existed (same "no data" honesty approach as the vehicle-swap km fix — don't fabricate numbers for periods with no odometer baseline).
- Push notifications for the alerts (in-app banner only, for now).
- Editing/undoing an auto-added overage expense beyond normal expense editing (no special-cased UI).
