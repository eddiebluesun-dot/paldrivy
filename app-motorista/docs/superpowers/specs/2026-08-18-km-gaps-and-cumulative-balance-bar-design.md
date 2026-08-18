# KM Gaps table + cumulative-balance bar — Design

**Goal:** (A) make the "Franquia de km" bar visually represent the cumulative signed balance (never resets, can go negative) instead of "this period's usage only". (B) persist every automatically-detected personal-use odometer gap as its own auditable, editable database row, for every vehicle — not just an invisible component of a running total — and surface it on the day it happened.

This is a same-week follow-up to `2026-08-15-rental-km-allowance-cumulative-balance-design.md` — the underlying `balanceKm`/`cumulativeUsageKm`/`cumulativeAllowanceKm` math from that pass is unchanged and confirmed correct (re-verified by hand against production data during this brainstorm: a 3-week worked example the owner did by hand matched the shipped formula exactly). What changes here is what the UI does with those numbers, plus a wholly new persistence layer for the gaps themselves.

## Context

Real production case, 2026-08-17 (owner Eddie): Monday's first shift started at an odometer reading that already included ~114 km of unlogged weekend driving (no shift or fuel entry logged between Saturday's last reading and Monday's first). The existing card correctly included those 114 km in the cumulative balance, but displayed them baked into "this week's" 387 km usage figure, which read as wrong on a day where only 273 km of actual work had happened. Rather than trying to algorithmically guess which calendar day unlogged driving "really" happened on (the previous design's approach, and admitted at the time to be an unresolvable guess without finer-grained data), the owner wants the app to stop hiding this entirely: track every such gap as its own visible, editable record, and make the headline number the one that's always unambiguously correct — the running balance — rather than a period-scoped figure that requires guessing.

The owner independently re-derived the balance formula by hand across a 3-week example (1505 km/week nominal, week 1 under by 100 km, week 2 over by 195 km net of the carried surplus, week 3 starts at 1505 + 100 − 195 = 1310 available) — this is arithmetically identical to `cumulativeAllowanceKm − cumulativeUsageKm` from the existing implementation, confirming that formula doesn't need to change, only its role in the UI.

## Part A — Bar shows the cumulative balance

`RentalAllowanceExtractCard.tsx` currently fills its bar from `periodUsageKm / periodAllowanceKm` (this week/month only) and shows the cumulative `balanceKm` as a small text line underneath. This flips:

- **Bar fill** = `min(cumulativeUsageKm / cumulativeAllowanceKm, 1)`. Same color ladder as today (success → accent → error as it approaches/passes 100%).
- **When `balanceKm < 0`** (over the cumulative allowance): bar renders fully filled, in the error color, regardless of how far over — a driver 5 km over and a driver 500 km over both see a full red bar; the exact debt is in the number, not the fill amount (an unbounded negative doesn't have a meaningful "how full" reading).
- **Headline text**: replace the current "`periodUsageKm` / `periodAllowanceKm` km usados" line with the cumulative figures — "`cumulativeUsageKm` / `cumulativeAllowanceKm` km usados" (both already rounded the same way as today).
- **Balance line** (already exists): keeps showing signed `balanceKm` — "X km de saldo" (positive, success color) or "X km em débito" (negative, error color) — this line doesn't change, it's already the cumulative number; only the bar and headline above it change to match.
- `periodUsageKm`/`periodAllowanceKm` remain on `RentalAllowanceStatus` (still computed, still correct) but this card stops reading them. No other call site uses them today (confirmed: `RentalAllowanceBanner` already uses only the cumulative fields). Leave the fields in place rather than ripping them out — a future card may want the period-scoped view again, and the computation is cheap and already tested.
- `RentalAllowanceBanner.tsx`: no change. It already alerts on cumulative `isNearLimit`/`isOverLimit`.

## Part B — `km_gaps` table

### Schema

New migration, `supabase/migrations/20260818_km_gaps.sql`:

```sql
create table public.km_gaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  start_odometer_meters integer not null,
  end_odometer_meters integer not null,
  gap_meters integer generated always as (end_odometer_meters - start_odometer_meters) stored,
  start_at timestamptz not null,  -- timestamp of the reading right before the gap (the last known odometer value before it)
  end_at timestamptz not null,    -- timestamp of the reading that revealed the gap (the first reading after it)
  category text not null default 'personal_use'
    check (category in ('personal_use', 'other')),
  note text,
  is_edited boolean not null default false, -- true once the driver changes category/note; excludes this row from future auto-recompute
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint km_gaps_positive check (gap_meters > 0)
);

create index km_gaps_vehicle_idx on public.km_gaps (vehicle_id, start_at);

alter table public.km_gaps enable row level security;

create policy "km_gaps: usuario ve os proprios" on public.km_gaps
  for select using (user_id = auth.uid() or is_admin());
create policy "km_gaps: usuario edita os proprios" on public.km_gaps
  for update using (user_id = auth.uid() or is_admin());
create policy "km_gaps: usuario deleta os proprios" on public.km_gaps
  for delete using (user_id = auth.uid() or is_admin());
-- No user-facing INSERT policy: rows are only ever created by the
-- SECURITY DEFINER trigger function below, never directly by the app.

comment on table public.km_gaps is
  'Auto-detected odometer jumps between two consecutive readings (shift start/end, fuel fill-up) for a vehicle, with nothing logged in between -- almost always personal/leisure driving. Fully recomputed (see recompute_km_gaps()) on every shift/fuel_entries write for that vehicle, EXCEPT rows with is_edited=true, which the driver has manually recategorized and which recompute leaves untouched. See docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md.';
```

Applies to **every vehicle**, not just ones with an active km-allowance — the owner wants personal-use history available regardless of whether there's a contractual cap to compare it against.

### Recompute function (full rebuild per vehicle, not incremental)

An incremental "diff against the previous row" trigger breaks the moment a driver backfills a shift out of chronological order (e.g. logs a forgotten shift dated two days ago) — the naive version would need to split/merge/delete neighboring gap rows it has no way to find reliably. Instead, recompute derives the full gap set for one vehicle from scratch every time, which is trivially correct by construction and cheap at this data volume (a vehicle accumulates dozens to a few hundred odometer readings over a contract's life, not more):

```sql
create or replace function public.recompute_km_gaps(p_vehicle_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  readings record;
  prev_odometer integer;
  prev_at timestamptz;
begin
  -- Wipe only the auto-generated, untouched rows for this vehicle -- rows
  -- the driver has edited (is_edited=true) are preserved as-is, even if
  -- they no longer exactly match a gap the fresh scan below would find.
  delete from public.km_gaps
    where vehicle_id = p_vehicle_id and is_edited = false;

  prev_odometer := null;
  prev_at := null;

  for readings in (
    select odometer_start_meters as odometer, started_at as at
      from public.shifts
      where vehicle_id = p_vehicle_id and odometer_start_meters is not null
    union all
    select odometer_end_meters, ended_at
      from public.shifts
      where vehicle_id = p_vehicle_id and odometer_end_meters is not null and ended_at is not null
    union all
    select odometer_meters, filled_at
      from public.fuel_entries
      where vehicle_id = p_vehicle_id and odometer_meters is not null
    order by at
  )
  loop
    if prev_odometer is not null and readings.odometer > prev_odometer then
      insert into public.km_gaps (
        user_id, vehicle_id, start_odometer_meters, end_odometer_meters, start_at, end_at
      ) values (
        p_user_id, p_vehicle_id, prev_odometer, readings.odometer, prev_at, readings.at
      );
    end if;
    -- Always advance to the latest reading seen, even if this one didn't
    -- produce a gap (odometer went backwards or stayed flat -- data entry
    -- noise, not a gap) -- otherwise a single bad row would poison every
    -- gap computed after it.
    if prev_odometer is null or readings.odometer >= prev_odometer then
      prev_odometer := readings.odometer;
      prev_at := readings.at;
    end if;
  end loop;
end;
$$;
```

This intentionally mirrors the exact reading-set construction already used client-side in `getRentalAllowanceStatus` (`src/services/rentalAllowance.ts`) — same two source tables, same union — so the gaps this produces are consistent with what the balance calculation already implies, just now materialized instead of implicit.

### Triggers

```sql
create or replace function public.trg_recompute_km_gaps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.vehicle_id is not null then
      perform public.recompute_km_gaps(old.vehicle_id, old.user_id);
    end if;
    return old;
  end if;
  if new.vehicle_id is not null then
    perform public.recompute_km_gaps(new.vehicle_id, new.user_id);
  end if;
  -- A vehicle_id change (rare, but the column is nullable/updatable) needs
  -- the OLD vehicle's gaps recomputed too, or a stale gap can outlive the
  -- reading that justified it.
  if tg_op = 'UPDATE' and old.vehicle_id is not null and old.vehicle_id is distinct from new.vehicle_id then
    perform public.recompute_km_gaps(old.vehicle_id, old.user_id);
  end if;
  return new;
end;
$$;

create trigger shifts_recompute_km_gaps
  after insert or update or delete on public.shifts
  for each row execute function public.trg_recompute_km_gaps();

create trigger fuel_entries_recompute_km_gaps
  after insert or update or delete on public.fuel_entries
  for each row execute function public.trg_recompute_km_gaps();

-- SECURITY: recompute_km_gaps is SECURITY DEFINER (needs to write km_gaps
-- despite the table having no INSERT policy), which means if any
-- authenticated user could call it directly via RPC, they could pass an
-- arbitrary vehicle_id/user_id and force a recompute against a vehicle they
-- don't own -- not a data-modification risk (the function only ever
-- derives gap rows from that vehicle's own real shifts/fuel_entries, it
-- can't fabricate arbitrary data), but it would let one user trigger
-- unwanted writes/load against another user's rows. Revoke direct execute
-- access; only the trigger functions (which run with the privileges of
-- their own SECURITY DEFINER, not the calling user's grants) may invoke it.
revoke execute on function public.recompute_km_gaps(uuid, uuid) from public, authenticated, anon;
```

Both `recompute_km_gaps` and `trg_recompute_km_gaps` are `security definer` so they can write to `km_gaps` despite the table having no direct user-facing INSERT policy — the trigger is the only writer of new rows; the driver can only UPDATE (recategorize) or DELETE existing ones via the two RLS policies above.

### Reclassification is metadata-only

Setting `category`/`note` on an existing gap (and thereby `is_edited = true`) never changes `gap_meters`, `start_odometer_meters`, or `end_odometer_meters` — those came from real odometer readings and stay fixed. It also never touches `cumulativeUsageKm`/`balanceKm`, which are computed straight from the odometer readings themselves (see the original 2026-08-07 design's rationale: rental caps total km driven, work or personal, so a gap's category is informational for the driver, not part of the allowance math). If a driver realizes a "gap" was actually a forgotten shift, the fix is logging that shift normally through the existing shift-entry flow — once a real shift bridges the two readings, the next recompute naturally removes the now-explained gap (assuming it wasn't separately marked `is_edited`; if it was, the stale edited row is simply left orphaned/no longer matching any real gap — acceptable, the driver edited it because they were already looking at it, they can delete it manually too).

## Part C — Day-detail line item

The day-detail sheet (source of the "Km rodados / Km inicial / Km final" screenshot) gains a line when a gap's `start_at`/`end_at` window overlaps that calendar day:

> Uso pessoal detectado: **17 km**

Placed directly under the existing "Produtividade" block's km rows, same visual weight as the other secondary stat lines. Tapping it opens a small inline editor (category picker: Uso pessoal / Outro, plus a free-text note field) — this is the reclassification UI from Part B. A day can show more than one gap line if more than one was detected inside it (rare, but two vehicle swaps or two missed-logging windows in one day are possible).

A gap whose `start_at`/`end_at` window spans midnight (like the real 2026-08-17 case — the 114 km could have happened Saturday night or Sunday, no reading tells us which) is shown on **both** overlapping days, each showing the full `gap_meters` value with a note that it's an estimated window, not split proportionally between them — splitting would imply a precision the data doesn't support, and the underlying `km_gaps` row is unambiguous (a single row, two display appearances) so there's no double-counting in the actual balance math, only in this display.

## Out of scope for this pass

- Auto-converting a reclassified "actually a missed shift" gap into a real `shifts` row — the driver logs that manually; see Part B.
- A dedicated full-history "gaps" screen (Part C only adds the day-detail line item, per the owner's choice in brainstorming).
- Any change to `computeRentalAllowanceStatus`'s math itself — confirmed correct, unchanged by this pass.
- Retroactively backfilling `km_gaps` for the vehicle's entire history before this migration runs. The first recompute triggered by the next shift/fuel_entries write will naturally populate everything from the vehicle's full reading history (the recompute function scans ALL of that vehicle's readings, not just new ones) — so a one-time manual `select recompute_km_gaps(id, user_id) from vehicles` for existing vehicles is enough to backfill immediately rather than waiting for the next organic write; call this out as a required one-time step in the implementation plan, not a new migration concern.
