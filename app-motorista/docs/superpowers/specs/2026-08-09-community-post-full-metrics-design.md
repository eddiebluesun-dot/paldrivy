# Community Post — Full Metrics Design

**Goal:** Bring the community post card up to competitor parity (per Eddie's screenshot review) by showing the full financial picture per post: total + per-platform earnings, expenses by category, and 8 performance metrics — instead of today's 3 metrics with no expense breakdown at all.

**Architecture:** Almost all the underlying data already exists — `buildStatsSnapshotForDate` already calls `getDayDetail`, which already computes `expensesByCategory`. The gap is that this data isn't captured into `CommunityStatsSnapshot` at post-creation time, and `PostCard` only renders 3 of the available metrics. This is additive: extend the snapshot shape, extend the metrics calc, extend the card UI. No new tables, no new queries beyond what's already run.

## Data model changes

**`src/utils/communityStats.ts`**
- `CommunityMetrics` gains two fields: `shifts_count: number` and `avg_duration_per_shift_seconds: number` (computed as `total_duration_seconds / shifts_count`, `0` when `shifts_count` is `0`).
- `computeCommunityMetrics` takes `shifts_count` as an added input field and computes the new average.

**`src/services/communityPosts.ts`**
- `CommunityStatsSnapshot` gains `expenses_by_category: Array<{ category: string; amount_cents: number }>`.
- `buildStatsSnapshotForDate`: pass `detail.expensesByCategory` through into the snapshot, and pass `rows.length` (already computed, currently unused for this) as `shifts_count` into `computeCommunityMetrics`.

No migration needed — `stats_snapshot` is a JSONB column; old posts simply won't have the new fields (rendered conditionally, see below).

## UI changes — `src/components/community/PostCard.tsx`

New render order inside the card, replacing today's single `statsRow` + 3-tile `metricsGrid`:

1. **Ganho do Dia** — total (`metrics.earnings_today_cents`) in a highlighted green box, followed by the existing per-platform tiles (today's `statsRow`, unchanged) — satisfies "Total e Separado por Plataforma."
2. **Despesas por Categoria** — one bordered row per `expenses_by_category` entry (icon + label + amount + pct of `expenses_cents`), red-tinted matching the competitor's expense styling. A small local `CATEGORY_ICONS: Record<string, IoniconName>` lookup (fuel→flash, food→restaurant, maintenance→construct, tolls→cash, default→pricetag) — no existing shared mapping to reuse, this is the first one. Section omitted entirely when the category array is empty (legacy posts, or a day with genuinely zero expenses).
3. **Métricas de Performance** — 3-column grid, 8 tiles: R$/Hora, R$/Km, Total de Horas, Média de Horas, Total de Km, Corridas/Entregas, Média por Corrida/Entrega (this last one spans the full row — odd tile count). Colors follow the competitor's grouping: green for money-rate metrics, blue for time/distance, orange for ride-count metrics — reusing the same visual language already established in `metricsGrid`/`Metric`.
4. Actions row — unchanged (like, comment, view count). Share/report buttons are explicitly **out of scope** for this pass (Eddie asked for the data fields; the action buttons are a separate, smaller follow-up if he wants it).

**Backward compatibility:** posts created before this ships have `stats_snapshot` without `expenses_by_category`/`shifts_count`. The new sections render conditionally (`expenses_by_category?.length` check; metrics grid falls back to `0`/`—` for the two new derived fields via `?? 0` at the computation site, matching existing null-safety patterns elsewhere in this file).

## Testing

- `communityStats.test.ts` (existing, likely needs extending): `computeCommunityMetrics` — new `shifts_count`/`avg_duration_per_shift_seconds` cases, including `shifts_count: 0` (no division by zero).
- No new service-level test needed beyond confirming `buildStatsSnapshotForDate` passes the two new fields through (existing test file for `communityPosts.ts`, if any, gets one assertion added; otherwise this is thin enough to trust the type system + a manual check against real data, matching how the rest of this file's untested paths are handled today).
- Manual verification: create a post from a real day with 2+ shifts and 2+ expense categories, confirm all 8 tiles and the category rows render with correct values against the source `getDayDetail` data for that day.
