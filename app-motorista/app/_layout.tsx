import '../src/lib/i18n';
import i18n from '../src/lib/i18n';
import { useFonts } from 'expo-font';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useAuth } from '../src/hooks/useAuth';
import { getProfile } from '../src/services/profile';
import { scheduleAllNotifications, addInAppNotification } from '../src/services/notifications';

function localeToLang(locale: string): string {
  if (locale.startsWith('pt'))    return 'pt';
  if (locale.startsWith('es'))    return 'es';
  if (locale.startsWith('en-GB')) return 'en-GB';
  if (locale.startsWith('en'))    return 'en';
  return 'en'; // unsupported stored locale → English UI
}

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (fontError) throw fontError;
  }, [fontError]);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // Store foreground notifications in local in-app inbox
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(notification => {
      const title = notification.request.content.title ?? '';
      const body  = notification.request.content.body  ?? '';
      addInAppNotification(title, body).catch(() => {});
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded) return null;

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const topSegment = segments[0] as string | undefined;
  const subSegment = segments[1] as string | undefined;

  // Derived OUTSIDE the effect on purpose, and depended on INSTEAD of the raw
  // `subSegment`. Inside /(tabs)/* `subSegment` is the active tab name
  // (index/shifts/community/more), so depending on it directly re-ran this
  // entire effect on every tab tap — a getProfile() round-trip plus, whenever
  // the profile has a locale, scheduleAllNotifications() (permission check +
  // up to 9 scheduleNotificationAsync calls + several AsyncStorage reads).
  // It also multiplied the blast radius of getProfile()'s null-on-error
  // behaviour: one transient network blip on any tab tap would have bounced a
  // fully onboarded driver into the retired /onboarding flow.
  //
  // These three booleans are all stable `false` for the whole time the driver
  // is inside the tab group, so the effect now only re-runs when the route
  // group actually changes — while still reacting correctly when it does.
  const inAuth       = topSegment === '(auth)';
  const inOnboarding = topSegment === 'onboarding';
  const inRegister   = inAuth && subSegment === 'register';

  useEffect(() => {
    if (authLoading) return;
    if (!topSegment) return;

    let cancelled = false;

    if (!session) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }

    // The onboarding screens and the consolidated registration screen own their
    // own navigation — this guard must not race ahead of them.
    //
    // register.tsx drives ~6 sequential writes through completeRegistration().
    // Supabase fires SIGNED_IN on the very first one (sign-up), which flips
    // `session` here long before markOnboardingDone() sets onboarding_done.
    // Without this exemption the guard needs only one round-trip to win that
    // race: it would fetch a profile that either does not exist yet or still
    // has onboarding_done:false, replace the route with the old /onboarding
    // flow, and unmount register.tsx mid-submit. register.tsx does its own
    // router.replace('/(tabs)') once completeRegistration() returns success.
    //
    // Deliberately scoped to `register`, NOT to all of (auth): login.tsx does
    // not navigate itself — it relies on the `else if (inAuth)` branch below to
    // reach /(tabs) after a successful sign-in — so exempting the whole group
    // would strand every returning driver on the login screen. verify-email.tsx
    // is only ever reached without a session and is handled by the `!session`
    // branch above, so it is unaffected either way.
    if (inOnboarding || inRegister) return;

    // Fetch profile fresh so we always see the latest onboarding_done state
    getProfile(session.user.id).then((profile) => {
      if (cancelled) return;
      // Apply saved language preference
      if (profile?.locale) {
        const lang = localeToLang(profile.locale);
        if (lang !== i18n.language) i18n.changeLanguage(lang);
        scheduleAllNotifications(lang).catch(() => {});
      }
      if (!profile || !profile.onboarding_done) {
        router.replace('/onboarding/locale');
      } else if (inAuth) {
        router.replace('/(tabs)');
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [session, authLoading, topSegment, inAuth, inOnboarding, inRegister]);

  return <Slot />;
}
