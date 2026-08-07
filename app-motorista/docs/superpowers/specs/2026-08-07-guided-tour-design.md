# Interactive Guided Tour — Design

**Goal:** a complete, interactive walkthrough of the app's main screens, auto-shown to new users on first login and re-playable anytime from the "Mais" tab.

## Architecture

Build a custom, dependency-free spotlight overlay rather than adopting a third-party tour library. Rationale: this app's Expo SDK (56, very recent) makes third-party tour libraries a real compatibility risk — the exact class of problem this project already lost hours to today with a Node version mismatch. A small custom component is easy to keep working across Expo/RN upgrades.

- **`TourOverlay` component**: a full-screen `Modal` (or absolutely-positioned View above everything) that:
  1. Measures the current step's target element via `ref.measureInWindow()`.
  2. Darkens the rest of the screen, cuts out (or rings) the target element's bounding box.
  3. Shows a tooltip card near the target with title + description text and Next/Back/Skip controls.
  4. Advances through an ordered list of steps; on the last step, "Concluir" replaces "Próximo."
- **Step definition**: a plain array of `{ id, screen, targetRef, titleKey, descriptionKey }` objects — no engine/DSL needed, just data driving the same overlay component. Steps that belong to a screen other than the one currently mounted trigger a navigation to that screen before measuring (the tour is a guided sequence across the 4 main tabs, not a single-screen thing).
- **Conditional steps**: some target elements only render conditionally (e.g. the "turno em andamento" banner only exists if a shift is active; the rental km-allowance alert only exists for rental vehicles near/over their limit). If a step's target isn't currently mounted/measurable, skip that step automatically rather than showing a broken spotlight on nothing.

## Trigger logic

- **Auto-start for new users**: verified during planning that `profiles.onboarding_done` is ALREADY fully consumed by `app/_layout.tsx`'s routing (redirects to `/onboarding/locale` when false, to the main app when true) — by the time any user reaches the dashboard, it's already `true`, so reusing it here would mean the tour trigger could never fire. Add a new, separate `profiles.tour_seen` boolean column (default `false`) instead. On the dashboard's mount, if `tour_seen === false`, start the tour automatically (after the screen's first paint, so there's something real to spotlight). On tour completion OR skip, set `tour_seen = true`.
- **Manual replay**: new "Mais" menu item ("Tutorial do app" / "Como usar") that starts the same tour on demand, regardless of `tour_seen`'s value. Replaying does NOT reset `tour_seen` — it's already `true` for anyone who has already seen it once, and setting it again is a harmless no-op.

## Coverage (first version, per the owner's scope choice)

Main tabs only — what each one does and the primary elements on the dashboard, not deep multi-step flows (starting a shift, logging fuel, etc. are out of scope for this pass):

1. **Início (dashboard)**: the vehicle picker pill, the "Hoje" goal card (and its "Editar meta mensal" button), the revenue/expense/profit summary cards, the "+" floating quick-add button.
2. **Turnos**: what this tab is for (shift history).
3. **Comunidade**: what this tab is for (driver community feed).
4. **Mais**: what this tab is for (settings, vehicle management, and — meta — where to find this tour again).

## i18n

All tour copy needs entries in all 5 locale files (pt/en/es/fr/zh), matching this app's existing convention.

## Out of scope for this pass

- Deep flow walkthroughs (shift start/end, fuel entry, expense entry) — noted as a possible "Principais + fluxos-chave" follow-up if this first version proves useful.
- Video content.
- Third-party tour libraries.
