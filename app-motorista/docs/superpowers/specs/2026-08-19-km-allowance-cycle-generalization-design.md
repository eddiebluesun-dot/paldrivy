# Rental KM Allowance — Cycle Generalization (daily/weekly/monthly/unlimited, configurable week start) — Design

**Goal:** replace the daily-linear accrual shipped 2026-08-18 (confirmed, by hand-verification against the owner's real Localiza contract, to be the wrong model) with the correct **block-per-cycle carryover** model, and generalize the whole feature beyond the owner's single contract shape to cover the real variety of rental contracts drivers worldwide actually have: daily, weekly, or monthly (fixed 30-day) allowance cycles, an uncapped/informational mode, and a configurable week-start day.

This supersedes `2026-08-18-km-gaps-and-cumulative-balance-bar-design.md`'s **Part A only** (the daily-linear formula). Parts B (`km_gaps` table) and C (day-detail line item) from that spec are unaffected and already shipped — this pass does not touch them, beyond having the gap-attribution rule (below) align with how `km_gaps` already models a gap.

## Context

The owner's real rental contract (Localiza, `ZJLF017112`, PDF reviewed 2026-08-19) states: *"Franquia: 215 km/dia ou 1505 km/semana"* — confirming 1505 km/week is the real contracted amount (the vehicle record has 1500, stale, to be corrected as data — not a code concern) — and *"A locação será renovada automaticamente a cada segunda-feira mediante pagamento"*: the contract renews (and, per the owner's worked example below, the km allowance resets) every **Monday**, independent of the contract's own start date (Wednesday 2026-08-05) or the day-of-week the driver happened to sign up. The contract is also explicitly "**Aberto**" (open-ended, no fixed end date) — a red herring initially: this describes the *contract's duration*, not the km cap, and has no bearing on the km calculation (see "Unlimited" below for what actually needed clarifying).

The owner hand-built a week-by-week ledger from real production odometer data and it settled the model definitively:

| Semana | Km rodados | Franquia da semana | Saldo acumulado |
|---|---|---|---|
| 05–09/08 (parcial, 5 dos 7 dias sob contrato) | 896 | 1075 (1505 × 5/7) | +179 |
| 10–16/08 | 1625 | 1505 + 179 = 1684 | +59 |
| 17–19/08 (em aberto) | 519 (até 19/08) | 1505 + 59 = 1564 | +1045 (em aberto) |

This is **block-per-cycle carryover**, matching the *shape* of the 2026-08-15 design (full cycle granted upfront, first cycle prorated, balance never resets) — the 2026-08-18 daily-linear pivot was a wrong turn, triggered by a hand calculation ("215 km/dia") that the owner intended as a reference-rate sanity check, not a literal continuous-accrual proposal; the contract itself only ever states 215/day as an equivalent expression of the *same* 1505/week figure, not a separate daily-reset mechanism.

**The one real fix relative to 2026-08-15's block model:** week 2's usage (1625) is NOT `(last reading actually timestamped within week 2) − (first reading of week 2)` (that would give 1511, undercounting by the 114 km weekend gap) — it's `(first reading of week 3) − (first reading of week 2)`. A trailing gap is attributed to the cycle **before** it, not the cycle whose first reading happens to reveal it. This inverts the 2026-08-15 implementation's bridging direction (which attributed a gap to the *following* period) and is what actually caused this week's confusion (the 2026-08-17 "387 km" and 2026-08-19 "3040/3214, 95% usado" screenshots the owner flagged as wrong).

## Part A — cycle types

`rental_km_allowance_period` becomes `'daily' | 'weekly' | 'monthly'` (three values, down from today's `'weekly' | 'monthly' | 'unlimited'` — see "Unlimited" below for why `'unlimited'` stops being a period value). Existing check constraint and TypeScript union both update; migration needed for existing `'unlimited'` rows (see Migration section).

### Cycle length per type

- **`daily`**: 1 calendar day (UTC midnight to midnight, consistent with every other date boundary already used in this codebase).
- **`weekly`**: 7 days, starting on a **configurable** day of week (new field, see below) — not hardcoded to Monday. Calendar-aligned to that configured day, same way the current implementation is calendar-aligned to Monday (a week "belongs" to whichever 7-day block, starting on the configured weekday, contains it — independent of the contract's own start weekday).
- **`monthly`**: a **fixed 30-day rolling window** from the contract start date — replaces today's calendar-month behavior (1st-to-last-day-of-month, variable 28-31 day length, `addMonthClamped`'s day-of-month clamping logic) entirely. Period 0 is days 1-30 from `contractStartDate`, period 1 is days 31-60, etc. This is simpler than calendar-month (no clamping edge cases at all — every period is exactly 30 days) and matches how real rental contracts more often define a "month" for billing purposes.

### New field: configurable week start day

```sql
alter table public.vehicles
  add column rental_week_start_day smallint;
  -- 0=Sunday .. 6=Saturday, matching JS/Postgres getUTCDay() convention already
  -- used elsewhere in this codebase. NULL unless rental_km_allowance_period='weekly'.
  -- Default when the driver doesn't set one explicitly: 1 (Monday), matching the
  -- app's existing dashboard week convention and every rental contract seen so far.
alter table public.vehicles
  add constraint rental_week_start_day_range check (rental_week_start_day between 0 and 6);
```

Shown in the vehicle registration/edit form **only when `rental_km_allowance_period = 'weekly'`** — a day-of-week picker, defaulting to Monday, labeled something like "Em que dia da semana sua franquia reinicia?" (distinct from asking about the contract's own start date — the Localiza contract itself demonstrates these are independent: started Wednesday, resets Monday).

### Unlimited (no cap, informational only)

There is no `'unlimited'` period value anymore. Instead: **`rental_km_allowance_amount` becomes the signal.** A vehicle can have `rental_km_allowance_period` set (daily/weekly/monthly — the cycle the driver wants to see their km grouped by) with `rental_km_allowance_amount` left `null` — this means "track and display km per cycle, but there's no cap": no balance, no `isNearLimit`/`isOverLimit`, no overage cost, no alert banner. Just an informational figure — "127 km rodados hoje" / "esta semana" / "este mês" — computed the same way (gap-inclusive, cycle-boundary-aware) as the capped case, minus everything allowance-related.

This reads as more natural than a 4th period enum value requiring its own "which cycle to group by" sub-question — the cycle question ("daily/weekly/monthly") is already being asked regardless of whether there's a cap; whether there's a cap is a separate, orthogonal yes/no (does the driver know/have a km limit or not).

`rental_km_allowance_period` itself can still be entirely `null` — that's "rental km tracking not configured for this vehicle at all" (today's actual default for a freshly-added rental vehicle before the driver fills in the allowance section, or any non-rental vehicle) — nothing is shown, same as today.

## Part B — corrected calculation

### Cycle bounds

Generalizes `getPeriodBounds`'s job, but **as a new, separate function** — `getPeriodBounds`/`PeriodBounds` in `rentalKmAllowanceUtils.ts` stay completely untouched (confirmed 2026-08-18: `recurringExpenseAllocationUtils.ts` depends on them for an unrelated feature, and that feature's week is always Monday-Sunday/calendar-month, not configurable — it must keep working exactly as today). The km-allowance feature gets its own cycle-bounds function, e.g. `getAllowanceCycleBounds`:

```ts
export type AllowanceCycleType = 'daily' | 'weekly' | 'monthly';

export interface CycleBounds {
  cycleStart: Date;
  cycleEnd: Date;      // exclusive
  cycleIndex: number;  // 0-based, the cycle containing contractStartDate is 0
}

export function getAllowanceCycleBounds(
  contractStartDate: string,
  cycleType: AllowanceCycleType,
  weekStartDay: number | null, // 0-6, only meaningful/required for 'weekly'
  now: Date,
): CycleBounds {
  const cycleLengthDays = cycleType === 'daily' ? 1 : cycleType === 'weekly' ? 7 : 30;
  const contractStart = new Date(`${contractStartDate}T00:00:00.000Z`);

  if (cycleType === 'weekly') {
    const startDay = weekStartDay ?? 1; // default Monday
    const cycleStart = alignToWeekStart(now, startDay);       // most recent date <= now whose UTC day-of-week == startDay
    const anchorCycleStart = alignToWeekStart(contractStart, startDay);
    const cycleIndex = Math.round((cycleStart.getTime() - anchorCycleStart.getTime()) / (cycleLengthDays * DAY_MS));
    return { cycleStart, cycleEnd: addDays(cycleStart, 7), cycleIndex };
  }

  // daily and monthly are both fixed-length rolling windows from contractStart --
  // no calendar alignment needed (unlike weekly, which aligns to a specific
  // weekday regardless of contract start), so both reduce to the same simple
  // "how many whole cycleLengthDays-day blocks have elapsed" arithmetic.
  const daysSinceStart = Math.floor((truncateToUTCMidnight(now).getTime() - contractStart.getTime()) / DAY_MS);
  const cycleIndex = Math.floor(daysSinceStart / cycleLengthDays);
  const cycleStart = addDays(contractStart, cycleIndex * cycleLengthDays);
  return { cycleStart, cycleEnd: addDays(cycleStart, cycleLengthDays), cycleIndex };
}
```

(`alignToWeekStart`/`addDays`/`truncateToUTCMidnight`/`DAY_MS` are small new helpers; `daily`'s `cycleLengthDays=1` naturally makes `cycleIndex` just "days elapsed" and every cycle exactly 1 day, no special-casing needed beyond the shared formula.)

### Balance calculation

Replaces `computeRentalAllowanceStatus`'s current (2026-08-18) body. Core change: cycle-by-cycle block accrual with carryover, where **a cycle's own usage extends up to the first reading of the *next* cycle**, not its own last reading:

```
cumulativeAllowanceKm = firstCycleAllowanceKm + allowanceAmountKm * cycleIndex
  where firstCycleAllowanceKm = allowanceAmountKm * (cycleLengthDays covered by contract in cycle 0) / cycleLengthDays
  -- prorated only when cycle 0 is genuinely partial (weekly with a
  -- non-matching week-start-day relative to contractStartDate; monthly and
  -- daily are NEVER partial, since their cycles are anchored exactly to
  -- contractStartDate itself -- see "What's simpler now" below)

cumulativeUsageKm = (currentOdometerMeters - baselineMeters) / 1000
  -- UNCHANGED formula/meaning from every prior pass; this is always just
  -- current minus contract-start baseline, gap-inclusive by construction,
  -- regardless of cycle bucketing. Verified 2026-08-19: summing the 3
  -- weeks' individual usage (896+1625+519=3040) equals current(21372)-
  -- baseline(18332)=3040 exactly -- the per-cycle bucketing choice below
  -- affects DISPLAY (which cycle "gets" a gap) but never this total.

balanceKm = cumulativeAllowanceKm - cumulativeUsageKm   -- UNCHANGED formula
```

`overageKm`/`overageCostCents`/`remainingKm`/`isNearLimit`/`isOverLimit` — all unchanged formulas from 2026-08-18, just fed by the corrected `cumulativeAllowanceKm`. When `allowanceAmountKm` is `null` (unlimited/informational mode — see Part A), all of these become `null`/absent rather than computed; only `cumulativeUsageKm` and the current cycle's own usage are meaningful.

### Current cycle's own usage (for the bar's headline, e.g. "current week: 519 km")

```
currentCycleBaselineMeters = odometer of the first reading with `at >= cycleStart`
  (falls back to contractStartOdometerMeters, or the earliest reading ever,
  for cycle 0 specifically -- same baseline rule as before, just no longer
  needs a "bridge to reading before cycleStart" special case, because that
  bridging is exactly what caused the 2026-08-17 "387 km" bug: it attributed
  a trailing gap FORWARD into the new cycle instead of back into the one it
  actually happened in)

currentCycleUsageKm = (currentOdometerMeters - currentCycleBaselineMeters) / 1000
```

This is deliberately the *simple, un-bridged* "first reading actually in this cycle" rule (same as the original pre-2026-08-15 behavior) — because the gap-attribution problem it used to cause is now solved differently and correctly: a closed cycle's stored/historical usage (for the ledger table, for `km_gaps` display, for anything backward-looking) is computed as *next cycle's first reading − this cycle's first reading*, which pulls trailing gaps backward into the cycle that actually contained them. Only the **currently open** cycle (no "next cycle" data exists yet) uses the simple current-minus-own-start-reading form above, because there's nothing to bridge to yet — by the time the next cycle opens and reveals a trailing gap, this cycle's stored usage figure updates retroactively to absorb it (exactly the 1511→1625 correction the owner's ledger demonstrates for week 2, once week 3's first reading existed).

### What's simpler now

- Monthly no longer needs `addMonthClamped`'s day-of-month clamping (the 29th/30th/31st edge cases documented in the current `getPeriodBounds`) — a fixed 30-day window has no variable-length-month edge cases at all.
- Monthly and daily cycle 0 is never partial (both anchor exactly to `contractStartDate`, unlike weekly's independent week-start-day) — proration only applies to weekly.

## Migration

```sql
-- 1. Add the new column.
alter table public.vehicles add column rental_week_start_day smallint;
alter table public.vehicles add constraint rental_week_start_day_range
  check (rental_week_start_day is null or rental_week_start_day between 0 and 6);

-- 2. Backfill existing weekly contracts to Monday (today's only supported
--    behavior), so nothing silently changes for contracts already tracked.
update public.vehicles
  set rental_week_start_day = 1
  where rental_km_allowance_period = 'weekly';

-- 3. Widen the period check constraint to drop 'unlimited' and add 'daily'.
--    Existing 'unlimited' rows: per Part A, "unlimited" is now expressed as
--    a null rental_km_allowance_amount, not a period value. Check what
--    period those rows should report as -- if they have no amount AND no
--    period today makes semantic sense for them, defaulting to 'weekly' is
--    reasonable (matches the app's own dashboard week grouping) but this
--    should be confirmed against real data (how many rows, whose) before
--    picking a default -- flag as a required check in the implementation
--    plan, not an assumption to bake into the migration blindly.
alter table public.vehicles drop constraint if exists <existing_constraint_name>;
alter table public.vehicles add constraint rental_km_allowance_period_check
  check (rental_km_allowance_period in ('daily', 'weekly', 'monthly'));
```

(Exact existing constraint name to be confirmed by the implementer via `\d vehicles` or `information_schema` before writing the `drop constraint` line — not guessed here.)

### Vehicle registration/edit form

- The existing "franquia" section gains: a cycle-type selector (Diária / Semanal / Mensal — no "Ilimitada" option anymore as a distinct choice; instead...), and the km-amount field becomes explicitly optional with helper copy along the lines of "Deixe em branco se seu contrato não tem limite de km — ainda mostraremos quanto você rodou por período." When cycle-type is "Semanal", reveal the week-start-day picker (default Monday).

## Out of scope for this pass

- Any change to `km_gaps` (Part B/C of the 2026-08-18 spec) — the gap-detection/recompute trigger already operates purely on odometer readings and doesn't know or care about allowance cycles; unaffected.
- Retroactively recomputing historical `km_gaps` categorization based on which cycle they now "belong" to for display purposes — `km_gaps` rows are dated by their own `start_at`/`end_at`, independent of any allowance-cycle bucketing; the day-detail line item (Part C) already places a gap on the calendar day(s) it spans, which doesn't change here.
- A UI for switching an existing vehicle's cycle type or week-start-day after the fact and reconciling historical balance — changing these fields takes effect only for cycle-bounds computed going forward; no retroactive rebalancing logic in this pass.
