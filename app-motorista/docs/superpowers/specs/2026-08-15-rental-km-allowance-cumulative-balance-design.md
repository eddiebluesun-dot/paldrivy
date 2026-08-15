# Rental KM Allowance — Cumulative Balance (Rollover) — Design

**Goal:** replace the per-period reset in the rental km-allowance tracker (`src/services/rentalAllowance.ts` + `src/utils/rentalKmAllowanceUtils.ts`) with a running balance that never resets across the life of the rental contract, so km driven between periods is never silently lost and unused/overused km rolls forward automatically.

This is a revision of `2026-08-07-rental-km-allowance-design.md` — read that first for the original data model (`vehicles.rental_contract_start_date`/`rental_contract_start_odometer`/`rental_km_allowance_period`/`rental_km_allowance_amount`/`rental_km_excess_rate_cents`, all unchanged by this pass) and the original alert/expense UX being replaced here.

## Context

Real production case, 2026-08-15 (owner Eddie): a shift ended Saturday at odometer 20739. Between then and the next shift starting Monday, the car was driven ~111 km privately (spouse). Under the current design, the weekly period resets its baseline to "the first in-period reading" — so Monday's shift-start reading (20850) becomes the NEW week's baseline instead of adding to the closed week's usage. The 111 km is attributed to neither week: it's after week N's last reading and *becomes* week N+1's starting point, so it never counts as usage anywhere. Since the whole point of this feature is auditing total odometer use (not just work km — see the original design's context section), a boundary gap that vanishes defeats the purpose.

Separately, the owner wants the allowance itself to work like a rollover data plan: unused km in a light week should carry forward as bonus allowance, and an overage in a heavy week should be payable by driving less next week, rather than triggering an immediate one-off expense.

Decisions made in brainstorming (2026-08-15):
1. The balance accumulates for the entire life of the contract — it never resets on its own (no monthly/weekly settlement point).
2. The automatic "log as expense" button on the over-limit banner is removed. Manual expense logging via the Despesas tab is untouched.
3. The dashboard keeps its current per-week bar (used/limit this week) and gains a new balance line below it.
4. The 90%/100% alert thresholds move from "this week alone" to "cumulative balance" — a single bad week no longer alerts if there's enough banked balance to cover it.

## Calculation model

### Two numbers instead of one

Today `computeRentalAllowanceStatus` produces a single usage number per period, reset at each period boundary. This pass splits that into:

- **`periodUsageKm`** — km driven so far in the *current* period only. Display-only (drives the existing weekly bar's "used" label). Never drives alerts anymore.
- **`cumulativeUsageKm`** / **`cumulativeAllowanceKm`** / **`balanceKm`** — the running total since the contract began. This is the audit number and now drives every alert.

### Period indexing

`PeriodBounds` (in `rentalKmAllowanceUtils.ts`) gains a third field, `periodIndex` (0-based: the first period of the contract is index 0, the next is 1, etc.):

- **Weekly** (calendar Monday-Sunday, unchanged alignment): `periodIndex = round((mondayOf(periodStart) - mondayOf(contractStartDate)) / 7 days)`, where `mondayOf(d)` subtracts `(d.getUTCDay() + 6) % 7` days from `d`, matching the existing Monday-alignment math in `getPeriodBounds`.
- **Monthly**: the existing `while (periodEnd <= now) { n += 1; ... }` loop already produces this — `periodIndex = n` directly, just expose it instead of discarding it.

### Cumulative allowance

`cumulativeAllowanceKm = allowanceAmountKm * (periodIndex + 1)` — each period (including the current, not-yet-finished one) grants its full nominal allowance upfront, matching how the per-period allowance already worked before this change (no proration within a period).

### Cumulative usage (the fix for the boundary gap)

`cumulativeUsageKm = (currentOdometerMeters - baselineMeters) / 1000`, where `baselineMeters` is the SAME contract-lifetime baseline used today for period 0: `rental_contract_start_odometer` if set, else the earliest known reading. Critically, this baseline is established once, at contract start, and never recomputed at later period boundaries — so it already includes every gap, by construction. No special-casing of "the boundary" is needed; the boundary-gap bug disappears because there's no longer a reset to lose it at.

`balanceKm = cumulativeAllowanceKm - cumulativeUsageKm` (signed: positive = banked surplus, negative = debt).

### This-period usage (display only, also fixes the gap for the weekly bar)

For `periodUsageKm`, baseline can no longer be "first reading inside this period" (that's exactly what created the invisible-gap bug for the weekly bar too). Instead:

- `periodBaselineMeters` = the odometer of the most recent reading with `at <= periodStart` (i.e., the last reading known *before this period began* — which correctly attributes weekend/gap driving to the period it actually happened in, since that reading might itself be mid-way through the gap).
- If no such reading exists (period 0, or a period with zero prior activity — e.g. first period after install with no baseline reading yet), fall back to today's existing rule: explicit `rental_contract_start_odometer` if this is period 0, else the first in-period reading.
- `periodUsageKm = max(0, currentOdometerMeters - periodBaselineMeters) / 1000`.

This is independent of the cumulative calculation — `periodUsageKm` is purely for the "1511 / 1500 usado essa semana"-style label, `cumulativeUsageKm` is the audit source of truth.

### Updated `RentalAllowanceStatus` shape

```ts
export interface RentalAllowanceStatus {
  periodStart: Date;
  periodEnd: Date;
  periodIndex: number; // NEW

  allowanceAmountKm: number; // nominal per-period amount, unchanged meaning
  allowancePeriod: RentalAllowancePeriod;

  baselineMeters: number; // contract-lifetime baseline, unchanged meaning
  baselineIsEstimated: boolean; // unchanged meaning

  currentOdometerMeters: number;

  periodUsageKm: number; // NEW — replaces old `usageKm`'s per-period meaning, for the weekly bar
  periodAllowanceKm: number; // NEW — alias of allowanceAmountKm, for display symmetry with periodUsageKm

  cumulativeUsageKm: number; // NEW
  cumulativeAllowanceKm: number; // NEW
  balanceKm: number; // NEW — signed; positive = banked, negative = debt

  isNearLimit: boolean; // REDEFINED: cumulative percent used >= 90% (was per-period)
  isOverLimit: boolean; // REDEFINED: balanceKm < 0 (was per-period)
  overageKm: number; // REDEFINED: max(0, -balanceKm) (was per-period)
  overageCostCents: number; // unchanged formula, now applied to the redefined overageKm
  remainingKm: number; // REDEFINED: max(0, balanceKm) (was per-period)
}
```

`percentUsed` (old field, drove the near-limit copy's "X% usado") is replaced by computing it from cumulative numbers where needed: `cumulativeUsageKm / cumulativeAllowanceKm`.

`usageKm` is removed (renamed/split into `periodUsageKm` and `cumulativeUsageKm` — no call site should reference the old ambiguous name).

## Dashboard card (`RentalAllowanceExtractCard.tsx` — or wherever the weekly bar lives)

Unchanged: bar shows `periodUsageKm / periodAllowanceKm` with the existing percentage styling.

New: a line below the bar showing the cumulative balance, e.g.:
- Balance ≥ 0: "+89 km de saldo" (existing "positive/ok" text color).
- Balance < 0: "-11 km em débito" (existing "over" text color).

## Alerts (`RentalAllowanceBanner.tsx`)

- Trigger condition unchanged in shape (`!status.isNearLimit` early-return) but the underlying `isNearLimit`/`isOverLimit` are now cumulative, per the redefinition above — so the banner only appears when the cumulative balance is actually tight or negative, not just because this week ran hot.
- **Over-limit banner** (`isOverLimit`, i.e. `balanceKm < 0`): keeps the existing copy showing `overageKm`/`overageCostCents` (now cumulative), but the **"Adicionar como despesa" / "Despesa já adicionada" button is removed entirely** — this becomes a plain informational banner (no `onPress`, no action row). The `onAddExpense`/`alreadyLogged` props are removed from the component; callers stop passing them.
- **Near-limit banner** (`isNearLimit && !isOverLimit`): unchanged shape, copy now reflects cumulative `remainingKm`/percent.
- `baselineIsEstimated` disclosure line: unchanged.

## Code removed as dead weight

Once the banner no longer has an action button, these become unused and should be deleted rather than left half-wired:
- `app/(tabs)/index.tsx`: `handleAddOverageExpense`, the `hasExpenseSince(uid, 'km_excedente', ...)` check used only to compute the banner's `alreadyLogged` prop, and the `onAddExpense`/`alreadyLogged` props passed to `<RentalAllowanceBanner>`.
- The `km_excedente` expense category itself is NOT removed — a driver can still manually log an expense with that category from the Despesas tab if they want to; only the automatic one-tap flow from the banner goes away.

## Out of scope for this pass

- Any UI for manually adjusting/correcting the balance (e.g. "I know I actually drove less than the odometer implies because I lent the car and it wasn't really me").
- Editing `vehicles.rental_contract_start_odometer` after the fact if the owner realizes it was wrong — normal vehicle-edit form already allows this, no special handling needed.
- Notifications/push for balance changes — in-app banner only, same as the original design.
