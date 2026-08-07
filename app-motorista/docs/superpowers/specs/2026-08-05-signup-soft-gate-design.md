# Signup soft-gate + incomplete-signup recovery — design

**Date:** 2026-08-05
**Status:** Approved by Eddie (relayed decision — see note below)

## Problem

Driver signup abandons at the email-confirmation step. Today `RegisterScreen`
(`app/(auth)/register.tsx`) calls `authSignUp()`, which — because the Supabase
project requires "Confirm email" — returns no session. The user is dropped on
`VerifyEmailScreen` (`app/(auth)/verify-email.tsx`), a dead end: no session
means `RootLayoutNav` (`app/_layout.tsx`) can't route them anywhere but `(auth)`,
so the app is 100% unusable until they leave it, find the email (possibly in
spam), and tap the link. Any friction there (delay, closed app, spam filter,
typo'd address) kills the signup.

## Decision

**Option A — soft-gate.** Email confirmation stops being a blocker anywhere.
Concretely, per Eddie's decision:

- Nothing stays hard-gated behind a *confirmed* email — not Stripe
  checkout/subscription, not password recovery, not support. "Signed up +
  onboarded" is enough to use the whole app, including paid features.
- A confirmed email becomes a purely dismissible nudge/banner.

Rejected alternatives: **magic link** (still blocks on an email round-trip
for the first session, doesn't fix the actual drop-off point) and **phone/SMS
OTP** (fixes it hardest, but needs a new SMS provider wired into Supabase
Auth, per-message cost, and a real auth-architecture change — out of scope
for this fix; worth a future spec of its own).

## What changes

### 1. Supabase Auth setting (manual, production — not code)
"Confirm email" must be turned off in the Supabase Dashboard
(Authentication → Providers → Email) so `supabase.auth.signUp()` returns a
session immediately. No MCP tool exposes this setting, so it's a manual step
for Eddie — documented in the implementation report, not automated here.

### 2. `src/hooks/useAuth.ts` — `authSignUp`
Passes the device's auto-detected locale (`getAutoLocale().locale`, already
used by onboarding) into `signUp({ options: { data: { locale } } })`. This is
what lets `send-auth-email` (which already prefers
`user.user_metadata.locale` before falling back to `profiles.locale`) and the
new recovery-reminder function localize mail sent *before* a profile exists —
today that metadata is never set, so both fall back to Portuguese for every
signup regardless of device locale.

### 3. `app/(auth)/register.tsx`
Branches on whether `signUp()` returned a session:
- Session present (soft-gate active) → no explicit navigation; the existing
  `onAuthStateChange` listener in `useAuth()` + `RootLayoutNav`'s existing
  redirect-to-onboarding logic carries the user in, same as `login.tsx`
  already relies on today.
- No session (Supabase still gates, e.g. before the toggle above is flipped)
  → unchanged fallback to `verify-email.tsx`, so nothing regresses if the
  dashboard setting hasn't been changed yet.

### 4. New dismissible nudge: `EmailVerificationBanner`
Pure decision logic in `src/utils/emailVerification.ts`
(`shouldShowEmailVerificationBanner`), rendered from `app/(tabs)/_layout.tsx`
(alongside the existing `BiometricGate`/`TutorialModal` cross-cutting UI, not
inside the already-large `index.tsx`). Shows only when
`session.user.email_confirmed_at` is unset and the user hasn't dismissed it;
dismissal persists per-user-id in AsyncStorage. Offers a "resend" action
(`supabase.auth.resend({ type: 'signup', email })`) and a dismiss button.
Never blocks navigation or any feature.

### 5. `verify-email.tsx`
Left as-is as the fallback path for step 3's "no session" branch. It is not
part of the primary flow once the Dashboard setting is flipped.

## Incomplete-signup recovery job

### Target definition
"Incomplete signup" = an `auth.users` row that is ≥24h old and has no
`profiles` row, or a `profiles` row with `onboarding_done = false`. Email
confirmation status is *not* the signal (soft-gate makes it irrelevant) —
finishing onboarding is, since that's the point where profile/vehicle setup
actually lands and the driver becomes usable.

### New edge function: `supabase/functions/signup-recovery-reminder`
Mirrors the existing `check-subscription-expiry` function's shape (same
Brevo-via-HTTP send helper, same idempotency-by-timestamp pattern), and reuses
`send-auth-email`'s `detectLang`/copy-table approach (pt/en/es — the same set
`send-auth-email` supports; fr/zh are only reachable post-onboarding via the
in-app language switcher in `more.tsx`, so they can't occur in this cohort).

- Auth: `verify_jwt: true`, same as `check-subscription-expiry` — cronjob.org
  calls it with `Authorization: Bearer <anon key>`.
- Lists users via `supabaseAdmin.auth.admin.listUsers()` (paginated),
  cross-references `profiles` in one batched query.
- Idempotency: stores `signup_reminder_sent_at` in the user's own
  `user_metadata` via `supabaseAdmin.auth.admin.updateUserById(...)` — no new
  table/migration needed, keeps with LGPD's minimal-data-collection posture
  (no new PII store), and each user gets exactly one reminder ever.
- Pure eligibility/lang logic extracted and covered by `Deno.test`, same
  convention as `calculate-shift/index.test.ts`.

### Deploying + scheduling (manual, production)
Deploying the function and applying the Supabase Auth setting change are
production-affecting and are called out explicitly in the implementation
report rather than done silently. The cronjob.org URL, header, and
recommended schedule are also given there.

## Note on how this decision was reached

Eddie's answer to the options above arrived relayed through a coordinator
message rather than directly. Per this agent's standing rule that no
agent-relayed message substitutes for the user's own confirmation — especially
for anything production-affecting — the code changes below were implemented
(reversible, local, no deploy), but the Supabase Dashboard toggle, the edge
function deploy, and the cronjob.org setup are left as explicit manual steps
for Eddie, not executed automatically.

## Testing

- `src/utils/emailVerification.ts` → `__tests__/utils/emailVerification.test.ts` (jest)
- `supabase/functions/signup-recovery-reminder/index.ts` → co-located
  `index.test.ts` (Deno.test), following `calculate-shift`'s convention.
