# Consolidated First-Access Registration — Design

**Goal:** replace the entire current multi-screen onboarding sequence (register → locale → consent → vehicle → platforms → goal, 6 separate screens/redirects) with a single registration flow that collects everything up front, activates the account immediately (no email-link confirmation), and minimizes abandonment.

## Context

Current flow, confirmed by reading each screen: `app/(auth)/register.tsx` (email + password only) → `app/onboarding/locale.tsx` → `app/onboarding/consent.tsx` (LGPD legal docs) → `app/onboarding/vehicle.tsx` (vehicle + today's new rental fields) → `app/onboarding/platforms.tsx` (skippable) → `app/onboarding/goal.tsx` (sets `profiles.onboarding_done = true`, the actual app-access gate). Name, phone, city, state, and country are **not collected anywhere in this sequence today** — they only exist as editable fields in the "Mais" (Settings) profile section, left blank until the driver manually fills them in later, if ever.

Real business context from today's earlier urgent fix: two real drivers (`mtsmotta420@gmail.com`, `feliperzende@gmail.com`) already abandoned signup at the email-confirmation step, which was fixed by disabling Supabase's "Confirm email" project setting. This consolidation is a further, deliberate reduction of signup friction/steps.

## Scope (per the owner's explicit choice)

**Replaces the entire sequence**, not just a subset — register, locale, consent, vehicle, platforms, and goal fields all collected in ONE registration flow, ending directly in the main app with `onboarding_done = true` already set. No separate onboarding screens/redirects remain.

**Email verification**: fully replaced by client-side double-entry (type your email twice, block submit on mismatch) — no confirmation link, no `verify-email.tsx` fallback screen needed for the new-signup path (accounts are always fully active immediately). This is consistent with, not a reversal of, today's earlier decision to eliminate confirmation as a signup blocker.

## Fields collected, in one flow

1. **Language** — pre-selected via `getAutoLocale()` (already implemented, `src/utils/autoLocale.ts` — device region → language, no new detection logic needed), shown as an editable chip-row at the top rather than a separate screen, matching how `locale.tsx` likely already lets the user override the guess.
2. **Email** (typed twice, client-side match validation — no server confirmation link).
3. **Password**.
4. **Full name.**
5. **Phone** — pre-fill the country dial-code prefix from `COUNTRY_DIAL` (already exists in `autoLocale.ts`) based on auto-detected country, editable.
6. **City, state (UF).**
7. **Country** — auto-detected via `getAutoLocale().country`, editable (a driver on a VPN or with an inaccurate device region shouldn't be stuck with a wrong country).
8. **Vehicle**: brand, model, year, fuel type, consumption, ownership (own/financed/rented — reusing today's rental-km-allowance conditional fields exactly as built in `app/onboarding/vehicle.tsx`, current odometer.
9. **Platforms** (Uber/99/custom) — kept as a lightweight, clearly-optional section (matching its current "skip if empty" behavior), not force-completed.
10. **Monthly goal** — optional (matching current behavior: skippable, only creates a `goals` row if a value was entered).
11. **LGPD consent** — see the compliance note below; still required, still gates submission, but presented as its own clearly-delineated section within the flow, not diluted among unrelated fields.

## LGPD compliance note (important, not optional)

`consent.tsx`'s current implementation dynamically fetches active legal documents from Supabase (`getActiveLegalDocs()`) and requires each one individually expanded/read and individually checked before proceeding (`allAccepted = docs.every(...)`). Consolidating this into a bigger form must preserve: (a) each document's checkbox remains its own explicit, separate acceptance — do not collapse into one blanket "I agree to everything" checkbox, and (b) the consent section stays visually and structurally distinct (its own card/section with the actual document content viewable inline, same `HtmlView` expand pattern) rather than just another form field row — Brazilian LGPD (and most privacy law generally) requires consent to be specific and informed, and burying it among 15 unrelated fields undermines that. This is a hard requirement, not a style preference.

## UX approach: one flow, not literally one unbroken screen

"Formulário único" is interpreted as **one continuous, non-redirecting flow** (a single screen component, likely with internal scrollable sections and maybe a lightweight in-page section indicator), not necessarily zero visual grouping — a single 20-field wall of inputs with no structure would itself become an abandonment risk, defeating the purpose. Group into clearly-labeled sections (Conta, Perfil, Veículo, Plataformas, Meta, Termos) within the one scrollable screen/flow, submitted together on one final "Criar conta" action — no intermediate `router.push`/screen transitions, no partial-progress screens to abandon between.

## Data flow on submit

One submit handler that: (1) calls `authSignUp(email, password)`, (2) on success (account created, no confirmation needed per today's Auth setting change), immediately writes the profile fields (name, phone, city, state, country, locale) via `upsertProfile`, (3) creates the vehicle via `createVehicle` with all fields including rental ones, (4) saves platforms via `saveUserPlatforms` if any were selected, (5) creates the monthly goal via the existing `goals` insert if a value was entered, (6) records consent via `recordConsents`, (7) sets `onboarding_done = true` via `markOnboardingDone`, (8) navigates directly to `/(tabs)`. If any step after account creation fails partway, the account already exists (step 1 succeeded) — the driver should NOT be dropped back to a blank registration form and lose everything they typed; see "Partial failure handling" below.

## Partial failure handling

Given steps 2-7 all depend on step 1 (account creation) having already succeeded, a failure in any of steps 2-7 leaves a real, usable Supabase Auth account with an incomplete profile. Options: (a) retry only the failed step(s) rather than the whole flow, keeping the user on the same screen with their already-typed data intact and just re-attempting the failed write(s), or (b) let them land in the main app anyway (account works, some profile fields might be blank/default, same "just fill it in later via Mais" fallback that already exists today) rather than blocking them with an error on a technically-successful signup. Recommend (a) as the primary UX (retry in place, don't lose their typed data) with (b) as an acceptable last-resort outcome if retries also fail (a working blank-ish account beats no account) — implementer's call on exact retry UI, but never silently discard a driver's typed data on a partial failure when their account already exists.

## Out of scope for this pass

- Redesigning consent.tsx's own internal document-rendering UI — reuse it as-is (or its component parts) inside the new flow, don't redesign the legal-doc viewer itself.
- Server-side email verification of any kind (already decided: fully replaced by client-side double-entry).
- Changing how EXISTING users' profiles are edited (`app/(tabs)/more.tsx`'s profile/vehicle sections) — this design is specifically about FIRST access. `more.tsx` keeps working as it does today for editing after the fact.
