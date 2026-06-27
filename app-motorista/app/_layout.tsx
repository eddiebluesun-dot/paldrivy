import '../src/lib/i18n';
import { useFonts } from 'expo-font';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useAuth } from '../src/hooks/useAuth';
import { getProfile } from '../src/services/profile';

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

  if (!fontsLoaded) return null;

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const topSegment = segments[0] as string | undefined;

  useEffect(() => {
    if (authLoading) return;
    if (!topSegment) return;

    let cancelled = false;
    const inAuth = topSegment === '(auth)';
    const inOnboarding = topSegment === 'onboarding';

    if (!session) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }

    // While in onboarding, let the screens handle their own navigation
    if (inOnboarding) return;

    // Fetch profile fresh so we always see the latest onboarding_done state
    getProfile(session.user.id).then((profile) => {
      if (cancelled) return;
      if (!profile || !profile.onboarding_done) {
        router.replace('/onboarding/locale');
      } else if (inAuth) {
        router.replace('/(tabs)');
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [session, authLoading, topSegment]);

  return <Slot />;
}
