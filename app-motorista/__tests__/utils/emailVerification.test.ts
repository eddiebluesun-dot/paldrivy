import { test, expect, describe } from '@jest/globals';
import { shouldShowEmailVerificationBanner } from '../../src/utils/emailVerification';

describe('shouldShowEmailVerificationBanner', () => {
  test('shows banner when email unconfirmed and never dismissed', () => {
    expect(shouldShowEmailVerificationBanner({
      emailConfirmedAt: null,
      userId: 'user-1',
      dismissedForUserId: null,
    })).toBe(true);
  });

  test('hides banner once email is confirmed, even if never dismissed', () => {
    expect(shouldShowEmailVerificationBanner({
      emailConfirmedAt: '2026-08-05T12:00:00Z',
      userId: 'user-1',
      dismissedForUserId: null,
    })).toBe(false);
  });

  test('hides banner when this user already dismissed it', () => {
    expect(shouldShowEmailVerificationBanner({
      emailConfirmedAt: null,
      userId: 'user-1',
      dismissedForUserId: 'user-1',
    })).toBe(false);
  });

  test('shows banner again for a different user on the same device', () => {
    expect(shouldShowEmailVerificationBanner({
      emailConfirmedAt: null,
      userId: 'user-2',
      dismissedForUserId: 'user-1',
    })).toBe(true);
  });

  test('treats undefined emailConfirmedAt as unconfirmed', () => {
    expect(shouldShowEmailVerificationBanner({
      emailConfirmedAt: undefined,
      userId: 'user-1',
      dismissedForUserId: null,
    })).toBe(true);
  });
});
