// Pure decision logic for the dismissible "confirm your email" nudge.
// Email confirmation is never a blocker (see docs/superpowers/specs/2026-08-05-signup-soft-gate-design.md) —
// this only decides whether to show a soft, dismissible banner.

export interface EmailVerificationState {
  /** session.user.email_confirmed_at — undefined/null means unconfirmed */
  emailConfirmedAt: string | null | undefined;
  /** session.user.id */
  userId: string;
  /** last user id this banner was dismissed for (persisted in AsyncStorage), or null */
  dismissedForUserId: string | null;
}

export function shouldShowEmailVerificationBanner(state: EmailVerificationState): boolean {
  if (state.emailConfirmedAt) return false;
  if (state.dismissedForUserId === state.userId) return false;
  return true;
}
