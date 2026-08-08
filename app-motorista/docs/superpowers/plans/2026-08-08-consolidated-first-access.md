# Consolidated First-Access Registration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace the 6-screen onboarding sequence (register → locale → consent → vehicle → platforms → goal) with one continuous, section-grouped flow ending directly in the main app.

**Architecture:** a single new screen (`app/(auth)/register.tsx`, replacing its current email+password-only content) holding all sections, backed by one orchestration function that runs the existing per-field save calls (`upsertProfile`, `createVehicle`, `saveUserPlatforms`, the `goals` insert, `recordConsents`, `markOnboardingDone`) in sequence with retry-in-place on partial failure. Almost every field's collection UI and save call already exists and works today, scattered across 5 screens — this plan's job is consolidation and reuse, not new data-collection logic.

**Tech Stack:** React Native/Expo (SDK 56), TypeScript, Supabase Auth + Postgres, react-i18next, Jest + Testing Library.

## Global Constraints

- **LGPD consent stays specific and informed**: each legal document keeps its own individual checkbox (never one blanket "I agree to everything"), and the consent section remains visually/structurally distinct — its own card with the document content viewable inline via the existing `HtmlView` expand pattern from `consent.tsx`. This is a compliance requirement, not a style choice.
- **No server-side email confirmation** — email is validated only by typed-twice match on the client. Accounts are always fully active immediately after successful signup (consistent with today's earlier "Confirm email" project-setting change).
- **Partial-failure handling**: once `authSignUp` succeeds, a real account exists. A failure in any LATER step (profile, vehicle, platforms, goal, consent) must retry in place, preserving everything the driver already typed — never drop them back to a blank form after their account was already created.
- **Platforms and monthly goal remain optional/skippable**, matching their current behavior exactly.
- **Don't touch `app/(tabs)/more.tsx`'s profile/vehicle editing** — this plan is first-access only; editing after the fact keeps working as it does today.
- **Country becomes a visible, editable field** — currently only used internally by `locale.tsx` to build `locale`/pre-fill phone, with no field of its own; this plan adds one.

---

### Task 1: Email double-entry validation

**Files:**
- Create: `src/utils/emailConfirmationUtils.ts`
- Test: `__tests__/utils/emailConfirmationUtils.test.ts`

**Interfaces:**
- Produces: `emailsMatch(email: string, emailConfirm: string): boolean` — trims and case-normalizes both before comparing (case-insensitive per email spec convention already likely followed elsewhere in this app's auth — check `login.tsx`/`resolveLoginEmail`-equivalent if one exists for the established normalization convention, match it rather than inventing a new one). Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

```ts
import { emailsMatch } from '@/src/utils/emailConfirmationUtils';

describe('emailsMatch', () => {
  it('matches identical emails', () => {
    expect(emailsMatch('driver@example.com', 'driver@example.com')).toBe(true);
  });
  it('matches case-insensitively', () => {
    expect(emailsMatch('Driver@Example.com', 'driver@example.com')).toBe(true);
  });
  it('matches with surrounding whitespace trimmed', () => {
    expect(emailsMatch('  driver@example.com  ', 'driver@example.com')).toBe(true);
  });
  it('does not match different emails', () => {
    expect(emailsMatch('driver@example.com', 'driver@exemple.com')).toBe(false);
  });
  it('does not match when either field is empty', () => {
    expect(emailsMatch('', '')).toBe(false);
    expect(emailsMatch('driver@example.com', '')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/utils/emailConfirmationUtils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export function emailsMatch(email: string, emailConfirm: string): boolean {
  const a = email.trim().toLowerCase();
  const b = emailConfirm.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/utils/emailConfirmationUtils.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/emailConfirmationUtils.ts __tests__/utils/emailConfirmationUtils.test.ts
git commit -m "feat: pure email double-entry match validation"
```

---

### Task 2: Submit orchestration function

**Files:**
- Create: `src/services/completeRegistration.ts`
- Test: `__tests__/services/completeRegistration.test.ts`

**Interfaces:**
- Consumes: `authSignUp` (`src/hooks/useAuth.ts`), `upsertProfile` (`src/services/profile.ts`), `createVehicle` (`src/services/vehicles.ts`), `saveUserPlatforms` (`src/services/platforms.ts`), `recordConsents` (`src/services/legal.ts`, takes `LegalDoc[]`), `markOnboardingDone` (`src/services/profile.ts`), Supabase client directly for the `goals` insert (matching `goal.tsx`'s existing inline `supabase.from('goals').insert(...)` — no dedicated service function exists for this yet, don't invent one beyond what's needed here).
- Produces: `completeRegistration(input: RegistrationInput): Promise<RegistrationResult>` — consumed by Task 3.

This is the highest-risk task in the plan (money/data-integrity-adjacent: a half-created account with a lost vehicle or consent record is a real support burden) — read it carefully.

- [ ] **Step 1: Write the failing tests**

```ts
import { completeRegistration } from '@/src/services/completeRegistration';
import { authSignUp } from '@/src/hooks/useAuth';
import { upsertProfile, markOnboardingDone } from '@/src/services/profile';
import { createVehicle } from '@/src/services/vehicles';
import { saveUserPlatforms } from '@/src/services/platforms';
import { recordConsents } from '@/src/services/legal';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/hooks/useAuth', () => ({ authSignUp: jest.fn() }));
jest.mock('@/src/services/profile', () => ({ upsertProfile: jest.fn(), markOnboardingDone: jest.fn() }));
jest.mock('@/src/services/vehicles', () => ({ createVehicle: jest.fn() }));
jest.mock('@/src/services/platforms', () => ({ saveUserPlatforms: jest.fn() }));
jest.mock('@/src/services/legal', () => ({ recordConsents: jest.fn() }));
jest.mock('@/src/lib/supabase', () => ({ supabase: { from: jest.fn(() => ({ insert: jest.fn().mockResolvedValue({ error: null }) })) } }));

const baseInput = {
  email: 'driver@example.com', password: 'senha123',
  profile: { name: 'Driver', phone: '+5511999999999', city: 'São Paulo', state: 'SP', country: 'BR', locale: 'pt-BR', currency_code: 'BRL', distance_unit: 'km' as const, volume_unit: 'liters' as const, timezone: 'America/Sao_Paulo', worker_type: 'driver' as const },
  vehicle: { brand: 'Renault', model: 'Kwid', year: 2026, fuel_type: 'ethanol' as const, avg_consumption_per_100: 1100, ownership_type: 'own' as const, monthly_cost_cents: 0, monthly_insurance_cents: 0, current_odometer: 0, is_taxi: false, taxi_license_monthly_cents: 0 },
  platforms: ['Uber'],
  monthlyGoalCents: 800000,
  legalDocs: [{ id: 'doc-1', type: 'privacy_policy' as const, version: '1', title: 'Privacidade', content: '...' }],
};

beforeEach(() => jest.clearAllMocks());

describe('completeRegistration', () => {
  it('runs every step in order and returns success', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });

    const result = await completeRegistration(baseInput);

    expect(result.status).toBe('success');
    expect(authSignUp).toHaveBeenCalledWith('driver@example.com', 'senha123');
    expect(upsertProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', name: 'Driver' }));
    expect(createVehicle).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', brand: 'Renault' }));
    expect(saveUserPlatforms).toHaveBeenCalledWith('u1', ['Uber']);
    expect(recordConsents).toHaveBeenCalledWith(baseInput.legalDocs);
    expect(markOnboardingDone).toHaveBeenCalledWith('u1');
  });

  it('skips the platforms save when none were selected', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });
    await completeRegistration({ ...baseInput, platforms: [] });
    expect(saveUserPlatforms).not.toHaveBeenCalled();
  });

  it('skips the goal insert when no amount was entered', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });
    await completeRegistration({ ...baseInput, monthlyGoalCents: null });
    expect(supabase.from).not.toHaveBeenCalledWith('goals');
  });

  it('returns an account-creation failure without attempting any later step', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Email already registered' } });
    const result = await completeRegistration(baseInput);
    expect(result.status).toBe('account_creation_failed');
    expect(upsertProfile).not.toHaveBeenCalled();
  });

  it('returns a resumable partial-failure result identifying the failed step and the created user id, without retrying automatically', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (upsertProfile as jest.Mock).mockRejectedValue(new Error('network'));

    const result = await completeRegistration(baseInput);

    expect(result.status).toBe('partial_failure');
    if (result.status === 'partial_failure') {
      expect(result.userId).toBe('u1');
      expect(result.failedStep).toBe('profile');
    }
    // later steps never attempted after the first failure
    expect(createVehicle).not.toHaveBeenCalled();
  });

  it('resumes from a given step on retry, skipping already-completed steps', async () => {
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });
    // resuming after a profile failure: userId already known, don't call authSignUp/upsertProfile again
    const result = await completeRegistration(baseInput, { resumeUserId: 'u1', resumeFromStep: 'vehicle' });
    expect(authSignUp).not.toHaveBeenCalled();
    expect(upsertProfile).not.toHaveBeenCalled();
    expect(createVehicle).toHaveBeenCalled();
    expect(result.status).toBe('success');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/services/completeRegistration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { authSignUp } from '../hooks/useAuth';
import { upsertProfile, markOnboardingDone } from './profile';
import { createVehicle } from './vehicles';
import { saveUserPlatforms } from './platforms';
import { recordConsents } from './legal';
import { supabase } from '../lib/supabase';
import type { Profile, Vehicle, WorkerType } from '../types';
import type { LegalDoc } from './legal';

export type RegistrationStep = 'account' | 'profile' | 'vehicle' | 'platforms' | 'goal' | 'consent' | 'finish';

export interface RegistrationInput {
  email: string;
  password: string;
  profile: Pick<Profile, 'name' | 'phone' | 'city' | 'state' | 'country' | 'locale' | 'currency_code' | 'distance_unit' | 'volume_unit' | 'timezone' | 'worker_type'>;
  vehicle: Omit<Vehicle, 'id' | 'user_id' | 'created_at' | 'name'>;
  platforms: string[];
  monthlyGoalCents: number | null;
  legalDocs: LegalDoc[];
}

export type RegistrationResult =
  | { status: 'success' }
  | { status: 'account_creation_failed'; message: string }
  | { status: 'partial_failure'; userId: string; failedStep: RegistrationStep; message: string };

const STEP_ORDER: RegistrationStep[] = ['account', 'profile', 'vehicle', 'platforms', 'goal', 'consent', 'finish'];

export async function completeRegistration(
  input: RegistrationInput,
  resume?: { resumeUserId: string; resumeFromStep: RegistrationStep },
): Promise<RegistrationResult> {
  let userId = resume?.resumeUserId ?? null;
  const startIndex = resume ? STEP_ORDER.indexOf(resume.resumeFromStep) : 0;

  try {
    if (startIndex <= STEP_ORDER.indexOf('account')) {
      const { data, error } = await authSignUp(input.email, input.password);
      if (error || !data.user) {
        return { status: 'account_creation_failed', message: error?.message ?? 'Sign-up failed' };
      }
      userId = data.user.id;
    }
    if (!userId) throw new Error('completeRegistration: missing userId after account step');

    if (startIndex <= STEP_ORDER.indexOf('profile')) {
      await upsertProfile({ id: userId, ...input.profile, onboarding_done: false });
    }
    if (startIndex <= STEP_ORDER.indexOf('vehicle')) {
      await createVehicle({ ...input.vehicle, user_id: userId, name: `${input.vehicle.brand} ${input.vehicle.model}` });
    }
    if (startIndex <= STEP_ORDER.indexOf('platforms') && input.platforms.length > 0) {
      await saveUserPlatforms(userId, input.platforms);
    }
    if (startIndex <= STEP_ORDER.indexOf('goal') && input.monthlyGoalCents != null && input.monthlyGoalCents > 0) {
      const { error } = await supabase.from('goals').insert({
        user_id: userId, type: 'monthly',
        target_amount_cents: input.monthlyGoalCents,
        starts_at: new Date().toISOString().split('T')[0],
      });
      if (error) throw error;
    }
    if (startIndex <= STEP_ORDER.indexOf('consent') && input.legalDocs.length > 0) {
      await recordConsents(input.legalDocs);
    }
    await markOnboardingDone(userId);
    return { status: 'success' };
  } catch (err) {
    // Determine which step we were on when it threw -- STEP_ORDER lookup by
    // catching at each stage would be more precise; simplest correct
    // implementation: re-derive from whichever await line is currently
    // "active" isn't directly knowable from a generic catch, so structure
    // the try block with per-step try/catch instead of one outer catch if
    // that's needed for an exact failedStep -- see note below.
    if (!userId) return { status: 'account_creation_failed', message: (err as Error).message };
    return { status: 'partial_failure', userId, failedStep: 'profile', message: (err as Error).message };
  }
}
```

**Flag for the implementer:** the outer `try/catch`'s generic error handling above cannot actually determine WHICH step failed (`failedStep` is hardcoded to `'profile'` as a placeholder, which is wrong for any other step) — this is the one deliberately incomplete piece of the sample code, called out rather than silently shipped wrong. Restructure so each step's failure is caught individually and returns the correct `failedStep` value (e.g. wrap each `if (startIndex <= ...)` block in its own try/catch that returns immediately with the right step name, or track "current step" in a variable updated before each call and read it in the outer catch). The test `'returns a resumable partial-failure result identifying the failed step'` specifically asserts `failedStep === 'profile'` for a profile-step failure — extend that test (or add siblings) to also cover a vehicle-step failure asserting `failedStep === 'vehicle'`, proving the mechanism actually discriminates between steps, not just hardcoded to always report one value correctly by coincidence.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/services/completeRegistration.test.ts`
Expected: PASS (7 tests including your added vehicle-step-failure case)

- [ ] **Step 5: Commit**

```bash
git add src/services/completeRegistration.ts __tests__/services/completeRegistration.test.ts
git commit -m "feat: sequential registration orchestration with resumable partial-failure handling"
```

---

### Task 3: Build the consolidated registration screen

**Files:**
- Modify: `app/(auth)/register.tsx` (replace entirely — current content is email+password only)
- Delete (after Task 5 confirms nothing else references them): none yet, just build the new screen first

**Interfaces:**
- Consumes: `emailsMatch` (Task 1), `completeRegistration`, `RegistrationInput`, `RegistrationResult` (Task 2), `getAutoLocale`/`COUNTRY_DIAL`/`buildLocale` (`src/utils/autoLocale.ts`), `getActiveLegalDocs` (`src/services/legal.ts`), `PRESET_PLATFORMS` (`src/services/platforms.ts`), `Select` component (`src/components/Select.tsx`).

This task reuses field UI already written and working in `locale.tsx`, `vehicle.tsx`, `platforms.tsx`, `goal.tsx` — read each of those files in full before starting (they're all under 310 lines each) and port their JSX/state/styles into sections of the new combined screen, adapting only what's needed for the combined-submit flow (removing each screen's own individual `handleSave`/`router.push` calls, replacing with shared state feeding one final submit).

- [ ] **Step 1: Scaffold the screen with section structure**

Build `app/(auth)/register.tsx` as a single `ScrollView` with these sections in order, each visually delineated (card/divider, matching this app's existing section-grouping patterns — e.g. `consent.tsx`'s `s.card` style):
1. **Conta** — email (typed twice — new `TextInput` pair, validated via `emailsMatch` on blur/submit, inline error if mismatched), password (reuse `register.tsx`'s existing password field + show/hide toggle exactly as-is).
2. **Perfil** — port `locale.tsx`'s full field set (language `Select`, currency `Select`, distance/volume unit `Select`s, worker type pill-row, full name, phone pre-filled via `COUNTRY_DIAL`, city, state) plus one NEW field: country (`TextInput` or `Select`, pre-filled from `getAutoLocale().country`, editable — this is the one genuinely new field per the design spec).
3. **Veículo** — port `vehicle.tsx`'s full field set verbatim, including today's rental-conditional fields.
4. **Plataformas** — port `platforms.tsx`'s preset-chip-grid + custom-entry UI verbatim (local state only here, no `handleSave`/`router.push` — the selections feed the final submit).
5. **Meta mensal** — port `goal.tsx`'s single amount field (local state only, optional).
6. **Termos** — port `consent.tsx`'s per-document expand/accept-checkbox UI verbatim, fetching `getActiveLegalDocs()` on mount same as today.

- [ ] **Step 2: Wire the final submit**

One "Criar conta" button at the bottom, disabled until all REQUIRED fields across all sections are filled (email+confirm matching, password, name, phone, city, state, country, vehicle brand+model+year+fuel+consumption+ownership[+rental fields if ownership is 'rent'], every legal doc's checkbox checked) — platforms and monthly goal remain optional and don't gate the button. On press, assemble a `RegistrationInput` from all the section state and call `completeRegistration`.

- [ ] **Step 3: Handle the result**

- `{ status: 'success' }`: `router.replace('/(tabs)')` — no `markOnboardingDone`/redirect dance needed, `completeRegistration` already called it.
- `{ status: 'account_creation_failed' }`: show the error inline (e.g. "email already registered"), keep all fields as-typed, let the driver correct and resubmit — nothing was created yet, safe to just retry from scratch.
- `{ status: 'partial_failure', userId, failedStep }`: show a distinct message (e.g. "Sua conta foi criada, mas houve um problema ao salvar [step] — toque para tentar novamente") with a retry button that calls `completeRegistration(input, { resumeUserId: userId, resumeFromStep: failedStep })` — do NOT show the generic account-creation error copy here, and do NOT let the driver re-trigger full account creation (which would fail with "already registered" against the account that already exists).

- [ ] **Step 4: Manual verification**

No existing test file/pattern covers `app/(auth)/register.tsx` or any of the 5 onboarding screens today (confirmed absence of `__tests__/**/register*`/`__tests__/**/onboarding*` in earlier investigation this session) — this is consistent with the codebase's existing convention of not unit-testing top-level screen components. Run the app (`npx expo start`) and walk through the full flow at least twice: once with a fully valid submission end-to-end, once deliberately triggering a partial failure (e.g. temporarily break one Supabase call) to confirm the retry-in-place UX actually works and doesn't lose typed data.

- [ ] **Step 5: Run full suite, typecheck, commit**

```bash
npx jest && npx tsc --noEmit
git add "app/(auth)/register.tsx"
git commit -m "feat: consolidate onboarding into one first-access registration screen"
```

---

### Task 4: Retire the old onboarding sequence

**Files:**
- Delete: `app/onboarding/locale.tsx`, `app/onboarding/consent.tsx`, `app/onboarding/vehicle.tsx`, `app/onboarding/platforms.tsx`, `app/onboarding/goal.tsx`
- Modify: `app/onboarding/_layout.tsx`, `app/_layout.tsx`, `app/(auth)/verify-email.tsx` (or delete it too — check if anything else references it first)

**Interfaces:**
- None new — this task removes dead code and fixes routing now that `onboarding_done` is always `true` immediately after `register.tsx`'s flow completes.

- [ ] **Step 1: Update root routing**

In `app/_layout.tsx`, the existing redirect logic (`if (!profile || !profile.onboarding_done) router.replace('/onboarding/locale')`) needs updating — since Task 3's flow always sets `onboarding_done = true` as its last step, no NEW account should ever reach this branch. But existing accounts created BEFORE this change may still have `onboarding_done = false` (e.g., anyone who signed up but abandoned partway through the old flow) — decide how to handle them: the simplest safe option is redirecting such accounts straight to `/(tabs)` anyway (treating "has an account" as sufficient, since the old onboarding screens no longer exist to redirect them to) rather than leaving a route to a now-deleted screen. Flag this as a real migration consideration, not just delete-and-forget — check whether any current accounts actually have `onboarding_done = false` in production before finalizing this decision (query the `profiles` table).

- [ ] **Step 2: Remove the onboarding directory's now-dead screens**

Delete the 5 files listed above via `git rm`. Check `app/onboarding/_layout.tsx` for what it does (likely just a stack navigator wrapper) — if nothing else references it once the 5 screens are gone, delete it too; if it's still needed for something else, leave it and just remove the deleted screens' registrations from it.

- [ ] **Step 3: Check `verify-email.tsx`'s remaining relevance**

`app/(auth)/verify-email.tsx` was built as `register.tsx`'s fallback for when Supabase's "Confirm email" setting was still on. Since this plan's flow never expects/needs that path (accounts are always fully active immediately), confirm nothing else navigates to `verify-email.tsx` (grep the whole repo for references to it) before deciding whether to delete it or leave it as unreachable-but-harmless dead code — implementer's call, but state which you chose and why in the report.

- [ ] **Step 4: Grep for other references to the deleted screens**

Search the whole repo for `/onboarding/locale`, `/onboarding/consent`, `/onboarding/vehicle`, `/onboarding/platforms`, `/onboarding/goal` (router paths) to confirm nothing else (deep links, notification handlers, etc.) still points at them.

- [ ] **Step 5: Run full suite, typecheck, commit**

```bash
npx jest && npx tsc --noEmit
git add -A app/onboarding app/_layout.tsx "app/(auth)"
git commit -m "chore: remove the retired multi-screen onboarding sequence"
```

---

### Task 5: Full-flow verification

- [ ] **Step 1: Run the full test suite and typecheck**

Run: `npx jest && npx tsc --noEmit`
Expected: all suites pass, no new errors vs. the established pre-existing baseline.

- [ ] **Step 2: Confirm no dangling references**

Re-run Task 4 Step 4's grep one more time at the end of the whole plan to catch anything a later task's edits might have reintroduced.

- [ ] **Step 3: Manual end-to-end check**

Fresh test account through the ENTIRE new flow (not resuming an existing partial one), confirming: account created, profile/vehicle/platforms/goal/consent all actually persisted correctly in Supabase (spot-check via a direct query), and the driver lands in `/(tabs)` with a fully-populated profile — no more "fill it in later via Mais" gap for a driver who completed this flow.

- [ ] **Step 4: Report status**

Do not deploy/build an AAB from this plan alone. Report completion and hold for the owner's release-bundling decision.
