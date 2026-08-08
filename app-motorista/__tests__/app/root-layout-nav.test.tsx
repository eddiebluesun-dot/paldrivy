import React from 'react';
import { render, act } from '@testing-library/react-native';

// RootLayoutNav is the app-wide routing guard. It has been rewritten twice and
// decides, for every user on every cold start, whether they land on /(tabs),
// /(auth)/login or the retired /onboarding flow — and it had no test coverage,
// which is why a previously-proposed "fix" that would have stranded every
// returning driver on the login screen was only caught by human review.
//
// It is not exported, so these tests drive it through the default RootLayout
// export (the real composition) with the native-only surface stubbed out.

const mockReplace = jest.fn();
let mockSegments: string[] = [];
let mockSession: { user: { id: string } } | null = null;
let mockAuthLoading = false;

jest.mock('expo-router', () => ({
  Slot: () => null,
  ErrorBoundary: () => null,
  useRouter: () => ({ replace: mockReplace }),
  useSegments: () => mockSegments,
}));

jest.mock('@/src/hooks/useAuth', () => ({
  useAuth: () => ({ session: mockSession, loading: mockAuthLoading, signOut: jest.fn() }),
}));

jest.mock('@/src/services/profile', () => ({
  getProfile: jest.fn(),
}));

// The two things the guard fires per run, and the exact reason a per-tab-switch
// re-run is expensive: scheduleAllNotifications does a permission check, up to
// nine scheduleNotificationAsync calls and several AsyncStorage reads.
jest.mock('@/src/services/notifications', () => ({
  scheduleAllNotifications: jest.fn().mockResolvedValue(undefined),
  addInAppNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/src/lib/i18n', () => ({
  __esModule: true,
  default: { language: 'pt', changeLanguage: jest.fn() },
}));

// Fonts/splash/notification-listener are pure app-shell concerns in RootLayout;
// stubbing them keeps the render surface to the guard under test. `useFonts`
// must report loaded, otherwise RootLayout returns null and never mounts
// RootLayoutNav at all.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
// _layout.tsx imports reanimated purely for its side effect (expo-router
// requires it at runtime). Nothing under test animates, and the real module
// throws in Jest because the Worklets native part is never initialized.
jest.mock('react-native-reanimated', () => ({}));

import RootLayout from '@/app/_layout';
import { getProfile } from '@/src/services/profile';
import { scheduleAllNotifications } from '@/src/services/notifications';

const ONBOARDED = { id: 'u1', locale: 'pt-BR', onboarding_done: true };

/** Lets the getProfile().then(...) chain inside the effect settle. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockReplace.mockReset();
  mockSegments = [];
  mockSession = null;
  mockAuthLoading = false;
  (getProfile as jest.Mock).mockReset().mockResolvedValue(null);
  (scheduleAllNotifications as jest.Mock).mockClear();
});

describe('RootLayoutNav — auth routing guard', () => {
  it('sends a signed-in, fully onboarded driver from the login screen to the tabs', async () => {
    // A returning driver: login.tsx does NOT navigate itself, it relies
    // entirely on this branch. If the (auth) group were ever exempted wholesale
    // from the guard, every returning driver would be stranded here.
    mockSegments = ['(auth)', 'login'];
    mockSession = { user: { id: 'u1' } };
    (getProfile as jest.Mock).mockResolvedValue(ONBOARDED);

    render(<RootLayout />);
    await flush();

    expect(getProfile).toHaveBeenCalledWith('u1');
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });

  it('redirects an unauthenticated driver outside the auth group to login', async () => {
    mockSegments = ['(tabs)', 'index'];
    mockSession = null;

    render(<RootLayout />);
    await flush();

    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('stays completely out of the way on the register screen mid-registration', async () => {
    // completeRegistration() drives ~6 sequential writes; Supabase fires
    // SIGNED_IN on the very first one, long before markOnboardingDone() runs.
    // The guard must neither fetch the (absent/incomplete) profile nor
    // navigate, or it unmounts register.tsx mid-submit.
    mockSegments = ['(auth)', 'register'];
    mockSession = { user: { id: 'u1' } };
    (getProfile as jest.Mock).mockResolvedValue(null);

    render(<RootLayout />);
    await flush();

    expect(getProfile).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('stays out of the way on the register screen even once a profile row exists with onboarding_done:false', async () => {
    mockSegments = ['(auth)', 'register'];
    mockSession = { user: { id: 'u1' } };
    (getProfile as jest.Mock).mockResolvedValue({ id: 'u1', onboarding_done: false });

    render(<RootLayout />);
    await flush();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not re-run the profile fetch or the notification scheduling when the driver merely switches tabs', async () => {
    // Regression guard: `segments[1]` is the active TAB name inside /(tabs)/*,
    // so depending on it directly re-ran the whole effect on every tab tap —
    // a Supabase round-trip plus scheduleAllNotifications() each time, and one
    // extra chance per tap for getProfile()'s null-on-error to bounce an
    // onboarded driver into /onboarding.
    mockSegments = ['(tabs)', 'index'];
    mockSession = { user: { id: 'u1' } };
    (getProfile as jest.Mock).mockResolvedValue(ONBOARDED);

    const { rerender } = render(<RootLayout />);
    await flush();

    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(scheduleAllNotifications).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    // Driver taps the "Turnos" tab: segments[1] changes, segments[0] does not.
    mockSegments = ['(tabs)', 'shifts'];
    rerender(<RootLayout />);
    await flush();

    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(scheduleAllNotifications).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('still redirects an onboarded-incomplete driver out of the tabs into onboarding', async () => {
    mockSegments = ['(tabs)', 'index'];
    mockSession = { user: { id: 'u1' } };
    (getProfile as jest.Mock).mockResolvedValue({ id: 'u1', onboarding_done: false });

    render(<RootLayout />);
    await flush();

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/locale');
  });

  it('defers entirely while auth is still loading', async () => {
    mockAuthLoading = true;
    mockSegments = ['(tabs)', 'index'];
    mockSession = null;

    render(<RootLayout />);
    await flush();

    expect(mockReplace).not.toHaveBeenCalled();
    expect(getProfile).not.toHaveBeenCalled();
  });
});
