# Interactive Guided Tour — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace the existing static `TutorialModal` with an interactive spotlight tour, auto-shown to new users on first login and replayable from "Mais."

**Architecture:** a target registry (screens register refs to real UI elements by string ID), a `TourOverlay` component that measures and spotlights the current step's target, and a plain-data step list. For this first version, every spotlighted element is either on the dashboard screen (mounted when the tour starts, since Início is the first tab) or part of the persistent tab bar (always mounted regardless of active screen) — so no cross-screen navigation is needed mid-tour, avoiding expo-router lazy-mount timing issues entirely.

**Tech Stack:** React Native/Expo (SDK 56), TypeScript, Supabase, react-i18next (5 locales), Jest + Testing Library.

## Global Constraints

- No third-party tour library — a small custom component, per the design spec's explicit rationale (dependency-version risk).
- `profiles.tour_seen` is a NEW column — `profiles.onboarding_done` cannot be reused (verified during planning: it's already `true` by the time any user reaches the dashboard, since `app/_layout.tsx` uses it to gate access to the main app entirely).
- This plan removes `src/components/TutorialModal.tsx` and its `SecureStore`-based trigger in `app/(tabs)/_layout.tsx` — don't leave both systems running side by side.
- Every new pure function/logic goes in `src/utils/` or a dedicated non-UI module, tested in `__tests__/`; UI components follow this app's existing Modal/overlay conventions (see `QuickAddSheet.tsx` for the established plain-`Modal` pattern already working cross-platform, including web).

---

### Task 1: DB migration + service function

**Files:**
- Create: `supabase/migrations/20260807130000_tour_seen.sql`
- Modify: `src/types/index.ts` (add `tour_seen: boolean` to `Profile`)
- Modify: `src/services/profile.ts`

**Interfaces:**
- Produces: `profiles.tour_seen` column; `markTourSeen(userId: string): Promise<void>`.

- [ ] **Step 1: Write and apply the migration**

```sql
alter table public.profiles
  add column tour_seen boolean not null default false;

comment on column public.profiles.tour_seen is
  'Whether the driver has completed or skipped the interactive guided tour. Separate from onboarding_done, which gates access to the main app and is already true by the time any user could see this tour.';
```

Apply via the `apply_migration` MCP tool (project_id `ucxkvxqpkknxotbfxgeu`) or the Supabase Dashboard SQL editor. Confirm success before continuing.

- [ ] **Step 2: Update the `Profile` type**

In `src/types/index.ts`, add `tour_seen: boolean;` to the `Profile` interface (alongside the existing `onboarding_done: boolean;`).

- [ ] **Step 3: Add `markTourSeen`**

In `src/services/profile.ts`, matching the exact style of the existing `markOnboardingDone`:

```ts
export async function markTourSeen(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ tour_seen: true }).eq('id', userId);
  if (error) throw error;
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807130000_tour_seen.sql src/types/index.ts src/services/profile.ts
git commit -m "feat: add tour_seen column and markTourSeen service function"
```

---

### Task 2: Target registry

**Files:**
- Create: `src/tour/tourRegistry.ts`
- Test: `__tests__/tour/tourRegistry.test.ts`

**Interfaces:**
- Produces: `registerTourTarget`, `unregisterTourTarget`, `getTourTarget` — consumed by Task 3 (`TourTarget` wrapper) and Task 4 (`TourOverlay`).

- [ ] **Step 1: Write the failing tests**

```ts
import { registerTourTarget, unregisterTourTarget, getTourTarget } from '@/src/tour/tourRegistry';
import { createRef } from 'react';
import { View } from 'react-native';

describe('tourRegistry', () => {
  afterEach(() => unregisterTourTarget('test-id'));

  it('returns undefined for an unregistered id', () => {
    expect(getTourTarget('nope')).toBeUndefined();
  });

  it('returns the registered ref', () => {
    const ref = createRef<View>();
    registerTourTarget('test-id', ref);
    expect(getTourTarget('test-id')).toBe(ref);
  });

  it('removes the ref on unregister', () => {
    const ref = createRef<View>();
    registerTourTarget('test-id', ref);
    unregisterTourTarget('test-id');
    expect(getTourTarget('test-id')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/tour/tourRegistry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { RefObject } from 'react';
import type { View } from 'react-native';

// Module-level Map, not React state: target components register/unregister
// as they mount/unmount across whichever screen currently hosts them, and
// TourOverlay (living at the tab-layout level) looks them up by id without
// needing a shared ancestor or prop-drilling refs across the tab tree.
const registry = new Map<string, RefObject<View>>();

export function registerTourTarget(id: string, ref: RefObject<View>): void {
  registry.set(id, ref);
}

export function unregisterTourTarget(id: string): void {
  registry.delete(id);
}

export function getTourTarget(id: string): RefObject<View> | undefined {
  return registry.get(id);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/tour/tourRegistry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: `TourTarget` wrapper component**

Create `src/tour/TourTarget.tsx` (no separate test needed — trivial mount/unmount effect, covered indirectly by Task 5's integration test):

```tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import { registerTourTarget, unregisterTourTarget } from './tourRegistry';

export function TourTarget({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<View>(null);

  useEffect(() => {
    registerTourTarget(id, ref);
    return () => unregisterTourTarget(id);
  }, [id]);

  return <View ref={ref}>{children}</View>;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/tour/tourRegistry.ts src/tour/TourTarget.tsx __tests__/tour/tourRegistry.test.ts
git commit -m "feat: tour target registry for cross-screen spotlight lookups"
```

---

### Task 3: Step data and `TourOverlay` component

**Files:**
- Create: `src/tour/steps.ts`
- Create: `src/components/TourOverlay.tsx`
- Test: `__tests__/components/TourOverlay.test.tsx`

**Interfaces:**
- Consumes: `getTourTarget` (Task 2).
- Produces: `TOUR_STEPS`, `<TourOverlay visible onFinish={...} />` — consumed by Task 5.

- [ ] **Step 1: Define the steps**

```ts
export interface TourStep {
  id: string;
  targetId: string; // matches a TourTarget's id
  titleKey: string;
  descriptionKey: string;
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'vehicle-pill', targetId: 'vehicle-pill', titleKey: 'tour.vehicle_pill_title', descriptionKey: 'tour.vehicle_pill_desc' },
  { id: 'goal-card', targetId: 'goal-card', titleKey: 'tour.goal_card_title', descriptionKey: 'tour.goal_card_desc' },
  { id: 'summary-cards', targetId: 'summary-cards', titleKey: 'tour.summary_cards_title', descriptionKey: 'tour.summary_cards_desc' },
  { id: 'quickadd-button', targetId: 'quickadd-button', titleKey: 'tour.quickadd_title', descriptionKey: 'tour.quickadd_desc' },
  { id: 'tab-shifts', targetId: 'tab-shifts', titleKey: 'tour.tab_shifts_title', descriptionKey: 'tour.tab_shifts_desc' },
  { id: 'tab-community', targetId: 'tab-community', titleKey: 'tour.tab_community_title', descriptionKey: 'tour.tab_community_desc' },
  { id: 'tab-more', targetId: 'tab-more', titleKey: 'tour.tab_more_title', descriptionKey: 'tour.tab_more_desc' },
];
```

- [ ] **Step 2: Write the failing tests for `TourOverlay`**

```tsx
import { render, screen, act } from '@testing-library/react-native';
import { createRef } from 'react';
import { View } from 'react-native';
import { TourOverlay } from '@/src/components/TourOverlay';
import { registerTourTarget, unregisterTourTarget } from '@/src/tour/tourRegistry';
import type { TourStep } from '@/src/tour/steps';

const STEPS: TourStep[] = [
  { id: 'a', targetId: 'target-a', titleKey: 'tour.a_title', descriptionKey: 'tour.a_desc' },
  { id: 'missing', targetId: 'not-registered', titleKey: 'tour.missing_title', descriptionKey: 'tour.missing_desc' },
  { id: 'b', targetId: 'target-b', titleKey: 'tour.b_title', descriptionKey: 'tour.b_desc' },
];

describe('TourOverlay', () => {
  beforeEach(() => {
    const refA = createRef<View>();
    (refA as any).current = { measureInWindow: (cb: any) => cb(10, 20, 100, 40) };
    registerTourTarget('target-a', refA);
    const refB = createRef<View>();
    (refB as any).current = { measureInWindow: (cb: any) => cb(10, 200, 100, 40) };
    registerTourTarget('target-b', refB);
  });
  afterEach(() => { unregisterTourTarget('target-a'); unregisterTourTarget('target-b'); });

  it('renders nothing when not visible', () => {
    const { toJSON } = render(<TourOverlay visible={false} steps={STEPS} onFinish={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('shows the first step title when visible', async () => {
    render(<TourOverlay visible steps={STEPS} onFinish={jest.fn()} />);
    expect(await screen.findByText('tour.a_title')).toBeTruthy();
  });

  it('skips a step whose target is not registered (unmounted), landing on the next valid step', async () => {
    render(<TourOverlay visible steps={STEPS} onFinish={jest.fn()} />);
    // advance past step "a"
    const next = await screen.findByRole('button', { name: /next|próximo/i });
    await act(async () => { fireEvent.press(next); });
    // "missing" has no registered target -> auto-skipped to "b"
    expect(await screen.findByText('tour.b_title')).toBeTruthy();
  });

  it('calls onFinish after the last step', async () => {
    const onFinish = jest.fn();
    render(<TourOverlay visible steps={[STEPS[0], STEPS[2]]} onFinish={onFinish} />);
    const next = await screen.findByRole('button', { name: /next|próximo|concluir|finish/i });
    await act(async () => { fireEvent.press(next); });
    const finish = await screen.findByRole('button', { name: /concluir|finish/i });
    await act(async () => { fireEvent.press(finish); });
    expect(onFinish).toHaveBeenCalled();
  });

  it('calls onFinish when skipped', async () => {
    const onFinish = jest.fn();
    render(<TourOverlay visible steps={STEPS} onFinish={onFinish} />);
    const skip = await screen.findByRole('button', { name: /pular|skip/i });
    await act(async () => { fireEvent.press(skip); });
    expect(onFinish).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest __tests__/components/TourOverlay.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `TourOverlay`**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import { getTourTarget } from '../tour/tourRegistry';
import type { TourStep } from '../tour/steps';

interface Rect { x: number; y: number; width: number; height: number; }

export function TourOverlay({
  visible, steps, onFinish,
}: {
  visible: boolean;
  steps: TourStep[];
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const measureCurrent = useCallback((i: number) => {
    const step = steps[i];
    if (!step) { onFinish(); return; }
    const ref = getTourTarget(step.targetId);
    const node = ref?.current;
    if (!node || typeof (node as any).measureInWindow !== 'function') {
      // Target not mounted/registered right now -- skip to the next step
      // rather than spotlighting nothing.
      setIndex(i + 1);
      return;
    }
    (node as any).measureInWindow((x: number, y: number, width: number, height: number) => {
      setRect({ x, y, width, height });
    });
  }, [steps, onFinish]);

  useEffect(() => {
    if (!visible) return;
    setIndex(0);
    measureCurrent(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    measureCurrent(index);
  }, [index, visible, measureCurrent]);

  if (!visible) return null;

  const step = steps[index];
  if (!step) return null; // measureCurrent already called onFinish in this case
  const isLast = index === steps.length - 1;

  function handleNext() {
    if (isLast) onFinish();
    else setIndex(i => i + 1);
  }
  function handleBack() {
    if (index > 0) setIndex(i => i - 1);
  }

  const { height: screenHeight } = Dimensions.get('window');
  const tooltipBelow = !rect || rect.y < screenHeight / 2;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onFinish}>
      <View style={s.overlay}>
        {rect ? (
          <View
            pointerEvents="none"
            style={[s.spotlight, { left: rect.x - 6, top: rect.y - 6, width: rect.width + 12, height: rect.height + 12 }]}
          />
        ) : null}

        <View style={[s.tooltip, rect ? { top: tooltipBelow ? rect.y + rect.height + 16 : undefined, bottom: tooltipBelow ? undefined : screenHeight - rect.y + 16 } : { top: '45%' }]}>
          <Text style={s.title}>{t(step.titleKey)}</Text>
          <Text style={s.desc}>{t(step.descriptionKey)}</Text>
          <View style={s.nav}>
            <TouchableOpacity onPress={onFinish} accessibilityRole="button" accessibilityLabel={t('tour.skip')}>
              <Text style={s.skip}>{t('tour.skip')}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              {index > 0 ? (
                <TouchableOpacity style={s.backBtn} onPress={handleBack} accessibilityRole="button" accessibilityLabel={t('tour.back')}>
                  <Text style={s.backText}>{t('tour.back')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={s.nextBtn} onPress={handleNext} accessibilityRole="button" accessibilityLabel={isLast ? t('tour.finish') : t('tour.next')}>
                <Text style={s.nextText}>{isLast ? t('tour.finish') : t('tour.next')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  spotlight: {
    position: 'absolute', borderRadius: Radius.card,
    borderWidth: 2, borderColor: Colors.accent, backgroundColor: 'transparent',
  },
  tooltip: {
    position: 'absolute', left: Spacing.lg, right: Spacing.lg,
    backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: Spacing.xs },
  desc: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: Spacing.md },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { color: Colors.textSecondary, fontSize: 13 },
  backBtn: { paddingVertical: 10, paddingHorizontal: Spacing.md, borderRadius: Radius.button, borderWidth: 1, borderColor: Colors.border },
  backText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  nextBtn: { paddingVertical: 10, paddingHorizontal: Spacing.md, borderRadius: Radius.button, backgroundColor: Colors.accent },
  nextText: { color: Colors.onAccent, fontSize: 13, fontWeight: '700' },
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest __tests__/components/TourOverlay.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/tour/steps.ts src/components/TourOverlay.tsx __tests__/components/TourOverlay.test.tsx
git commit -m "feat: spotlight tour overlay with auto-skip for unmounted targets"
```

---

### Task 4: Wrap real UI elements with `TourTarget`

**Files:**
- Modify: `app/(tabs)/index.tsx` (vehicle pill, goal card, summary cards)
- Modify: `app/(tabs)/_layout.tsx` (quick-add button, tab bar icons for shifts/community/more)

**Interfaces:**
- Consumes: `TourTarget` (Task 2).

- [ ] **Step 1: Wrap the dashboard elements**

In `app/(tabs)/index.tsx`, wrap the existing vehicle picker pill (`VehiclePill` usage), the "Hoje" goal card, and the revenue/expense/profit summary cards row with `<TourTarget id="...">` using the exact `targetId` values from `TOUR_STEPS` (`vehicle-pill`, `goal-card`, `summary-cards`). Wrap the smallest element that visually represents each concept (e.g. the goal card's outer container, not the whole screen).

- [ ] **Step 2: Wrap the quick-add button and tab icons**

In `app/(tabs)/_layout.tsx`, wrap the `quickadd` tab's custom `Pressable` button with `<TourTarget id="quickadd-button">`. For `tab-shifts`/`tab-community`/`tab-more`, the tab bar icons are rendered via the `tabBarIcon` render prop per `Tabs.Screen` — these can't easily be wrapped with a child `TourTarget` the same way (they're rendered by react-navigation internally, not directly in this file's JSX tree). Instead, register these three targets by wrapping each `Tabs.Screen`'s `tabBarIcon` render function to attach a ref to the returned icon `View`/`Ionicons` element — check whether `Ionicons` forwards refs cleanly, and if not, wrap it in a small local `<View ref={...}>` inside the `tabBarIcon` callback (same effect as `TourTarget`, but registration needs to happen imperatively here rather than via the declarative `TourTarget` wrapper, since this render prop re-runs per tab per render). Use `registerTourTarget`/`unregisterTourTarget` directly (from Task 2) inside a `useEffect` keyed on each icon's ref if wrapping `TourTarget` around the returned node doesn't work cleanly — implementer's call on the exact mechanism, the requirement is just that `getTourTarget('tab-shifts')` etc. resolve to a real measurable node once the tab bar has rendered.

- [ ] **Step 3: Manual verification**

Run the app, confirm no visual changes (TourTarget is a transparent wrapper, should not affect layout/styling — verify padding/margins didn't shift).

- [ ] **Step 4: Run full suite, commit**

```bash
npx jest
git add "app/(tabs)/index.tsx" "app/(tabs)/_layout.tsx"
git commit -m "feat: wrap dashboard and tab-bar elements as tour targets"
```

---

### Task 5: Trigger wiring — replace `TutorialModal`

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Delete: `src/components/TutorialModal.tsx`

**Interfaces:**
- Consumes: `TourOverlay`, `TOUR_STEPS` (Task 3), `markTourSeen` (Task 1).

- [ ] **Step 1: Remove the old system**

In `app/(tabs)/_layout.tsx`, remove: the `TutorialModal` import, the `TUTORIAL_KEY` constant, the `tutorialVisible` state and its `SecureStore`-based `useEffect`, the `handleTutorialClose` function, and the `<TutorialModal ... />` render. Delete `src/components/TutorialModal.tsx` entirely (grep the repo first to confirm nothing else imports it).

- [ ] **Step 2: Wire the new trigger**

```tsx
import { useEffect, useState } from 'react';
import { TourOverlay } from '@/src/components/TourOverlay';
import { TOUR_STEPS } from '@/src/tour/steps';
import { markTourSeen } from '@/src/services/profile';
import { getProfile } from '@/src/services/profile';
import { supabase } from '@/src/lib/supabase';

// ...inside TabLayout():
const [tourVisible, setTourVisible] = useState(false);

useEffect(() => {
  supabase.auth.getUser().then(async ({ data }) => {
    if (!data.user) return;
    const profile = await getProfile(data.user.id);
    if (profile && !profile.tour_seen) {
      // Delay slightly so the dashboard has painted and TourTarget refs
      // are registered before the first measureInWindow call.
      setTimeout(() => setTourVisible(true), 500);
    }
  }).catch(() => {});
}, []);

async function handleTourFinish() {
  setTourVisible(false);
  const { data } = await supabase.auth.getUser();
  if (data.user) markTourSeen(data.user.id).catch(() => {});
}
```

Render `<TourOverlay visible={tourVisible} steps={TOUR_STEPS} onFinish={handleTourFinish} />` in place of the removed `<TutorialModal ... />`.

- [ ] **Step 3: Manual verification**

Using a test account with `tour_seen = false`, log in, confirm the tour auto-starts on the dashboard after a brief delay, spotlights each element in order, skips gracefully if any target isn't found, and completing/skipping sets `tour_seen = true` (verify via a direct Supabase query) so it doesn't reappear on next launch.

- [ ] **Step 4: Run full suite, commit**

```bash
npx jest
git add "app/(tabs)/_layout.tsx"
git rm src/components/TutorialModal.tsx
git commit -m "feat: replace static TutorialModal with the interactive spotlight tour"
```

---

### Task 6: Manual replay from "Mais"

**Files:**
- Modify: `app/(tabs)/more.tsx`

**Interfaces:**
- Consumes: `TourOverlay`, `TOUR_STEPS` (Task 3).

- [ ] **Step 1: Add a menu item**

In `app/(tabs)/more.tsx`, add a new row in this screen's settings-menu list (match the existing row/list-item pattern already used for other entries like "Notificações" or "Meus veículos" — same icon+label+chevron style) labeled `t('more.tour_replay')`, with an `onPress` that sets local state `tourVisible = true`.

- [ ] **Step 2: Render the overlay**

Render `<TourOverlay visible={tourVisible} steps={TOUR_STEPS} onFinish={() => setTourVisible(false)} />` at the bottom of this screen's JSX (no `markTourSeen` call needed here — it's already `true` for anyone who can reach this menu, replaying doesn't need to re-set it, per the design spec).

Note: since this screen ("Mais") is itself one of the four tabs, and the tour's `quickadd-button`/`tab-*` targets are registered by `_layout.tsx` (always mounted) while `vehicle-pill`/`goal-card`/`summary-cards` are registered by `index.tsx` (only mounted when that tab has been visited at least once, depending on this app's `Tabs` `lazy` behavior) — confirm during manual testing whether replaying from "Mais" can still spotlight dashboard-tab elements. If `index.tsx` isn't mounted when replaying from "Mais" (lazy tab loading), those specific steps will auto-skip (per Task 3's built-in unmounted-target handling) rather than break — acceptable degraded behavior for this first version, not a bug to chase further here.

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/more.tsx"
git commit -m "feat: add tour replay entry to the Mais menu"
```

---

### Task 7: i18n strings

**Files:**
- Modify: `locales/pt.json`, `en.json`, `es.json`, `fr.json`, `zh.json`

- [ ] **Step 1: Add the `tour` namespace and `more.tour_replay` key to `locales/pt.json`**

```json
"tour": {
  "next": "Próximo",
  "back": "Anterior",
  "skip": "Pular",
  "finish": "Concluir",
  "vehicle_pill_title": "Seu veículo",
  "vehicle_pill_desc": "Aqui você vê o veículo ativo e o consumo médio. Toque para trocar entre veículos cadastrados.",
  "goal_card_title": "Meta do dia",
  "goal_card_desc": "Acompanhe quanto falta pra bater sua meta hoje. Toque em \"Editar meta mensal\" pra ajustar o valor a qualquer momento.",
  "summary_cards_title": "Resumo financeiro",
  "summary_cards_desc": "Receita, despesas, lucro e R$/hora do mês — atualizados a cada turno e despesa que você lança.",
  "quickadd_title": "Lançamento rápido",
  "quickadd_desc": "Toque aqui pra iniciar um turno, lançar abastecimento ou registrar uma despesa.",
  "tab_shifts_title": "Turnos",
  "tab_shifts_desc": "Veja o histórico completo dos seus turnos trabalhados.",
  "tab_community_title": "Comunidade",
  "tab_community_desc": "Troque experiências com outros motoristas PalDrivy.",
  "tab_more_title": "Mais",
  "tab_more_desc": "Configurações, veículos, notificações -- e é aqui que você reabre este tutorial quando quiser."
}
```

Add `"tour_replay": "Tutorial do app"` to the existing `"more"` namespace.

- [ ] **Step 2: Add equivalent translations to `en.json`, `es.json`, `fr.json`, `zh.json`**

Match this app's existing tone/register per locale.

- [ ] **Step 3: Run full suite, commit**

```bash
npx jest
git add locales/*.json
git commit -m "feat: add guided tour i18n strings"
```

---

### Task 8: Full-flow verification

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: all suites pass, no regressions.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual end-to-end check**

Fresh test account (or reset `tour_seen` to `false` on an existing one): log in, confirm the tour auto-plays through all 7 steps correctly positioned over the real elements, skip/finish both correctly persist `tour_seen`, and replay from "Mais" works on a second run.

- [ ] **Step 4: Report status**

Bundled with the rental-km-allowance plan for the next release — do not deploy/build an AAB from this plan alone. Report completion and hold for the owner's release-bundling decision.
