import '../src/lib/i18n';
import { useFonts } from 'expo-font';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useAuth } from '../src/hooks/useAuth';
import { useProfile } from '../src/hooks/useProfile';

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
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const { session, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (authLoading || (session && profileLoading)) return;

    const inAuth = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';

    if (!session && !inAuth) {
      router.replace('/(auth)/login');
    } else if (session && inAuth) {
      if (!profile || !profile.onboarding_done) {
        router.replace('/onboarding/locale');
      } else {
        router.replace('/(tabs)');
      }
    } else if (session && !inAuth && !inOnboarding && (!profile || !profile.onboarding_done)) {
      router.replace('/onboarding/locale');
    }
  }, [session, authLoading, profile, profileLoading, segments]);

  return <Slot />;
}
