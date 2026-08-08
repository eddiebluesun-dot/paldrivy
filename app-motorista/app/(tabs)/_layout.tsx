import React, { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Colors } from '@/src/theme';
import { BiometricGate } from '@/src/components/BiometricGate';
import { TourOverlay } from '@/src/components/TourOverlay';
import { TOUR_STEPS } from '@/src/tour/steps';
import { markTourSeen, getProfile } from '@/src/services/profile';
import { supabase } from '@/src/lib/supabase';
import { QuickAddSheet } from '@/src/components/QuickAddSheet';
import { EmailVerificationBanner } from '@/src/components/EmailVerificationBanner';
import { TourTarget } from '@/src/tour/TourTarget';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<string, [IoniconName, IoniconName]> = {
  index:     ['home-outline',    'home'],
  shifts:    ['time-outline',    'time'],
  community: ['people-outline',  'people'],
  more:      ['ellipsis-horizontal-circle-outline', 'ellipsis-horizontal-circle'],
};

// Tab bar icons are produced by the shared tabBarIcon render prop below, not
// by JSX directly in this file's tree, so they can't be wrapped with
// <TourTarget> the normal declarative way. Wrapping the returned icon
// element per-route (keyed off route.name) achieves the same effect: React
// still reconciles it as a stable element type at that tab's position, so
// TourTarget's mount/unmount effect fires once per tab, not on every
// tabBarIcon call.
const TAB_TOUR_TARGET_IDS: Record<string, string> = {
  shifts:    'tab-shifts',
  community: 'tab-community',
  more:      'tab-more',
};

export default function TabLayout() {
  const { t } = useTranslation();
  const [tourVisible, setTourVisible] = useState(false);
  const [quickAddVisible, setQuickAddVisible] = useState(false);

  useEffect(() => {
    let showTourTimeout: ReturnType<typeof setTimeout> | undefined;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const profile = await getProfile(data.user.id);
      if (profile && !profile.tour_seen) {
        // Delay slightly so the dashboard has painted and TourTarget refs
        // are registered before the first measureInWindow call.
        showTourTimeout = setTimeout(() => setTourVisible(true), 500);
      }
    }).catch(() => {});
    return () => { if (showTourTimeout) clearTimeout(showTourTimeout); };
  }, []);

  async function handleTourFinish() {
    setTourVisible(false);
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      markTourSeen(data.user.id).catch((err) => {
        // Fire-and-forget by design (don't block the UI on the persist
        // call) -- but a failure here means tour_seen never flips, so the
        // tour would silently re-fire on every future launch. Surface it.
        console.error('[tour] failed to persist tour_seen', err);
      });
    }
  }

  return (
    <BiometricGate>
      <EmailVerificationBanner />
      <Tabs
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: {
            backgroundColor: Colors.surface,
            borderTopColor: Colors.border,
          },
          tabBarActiveTintColor: Colors.accent,
          tabBarInactiveTintColor: Colors.textSecondary,
          tabBarLabelStyle: { fontSize: 9 },
          tabBarIcon: ({ focused, color, size }) => {
            const [outline, filled] = TAB_ICONS[route.name] ?? ['help-circle-outline', 'help-circle'];
            const icon = <Ionicons name={focused ? filled : outline} size={size} color={color} />;
            const targetId = TAB_TOUR_TARGET_IDS[route.name];
            return targetId ? <TourTarget id={targetId}>{icon}</TourTarget> : icon;
          },
        })}
      >
        <Tabs.Screen name="index"     options={{ title: t('tabs.dashboard') }} />
        <Tabs.Screen name="shifts"    options={{ title: t('tabs.shifts') }} />
        <Tabs.Screen
          name="quickadd"
          options={{
            title: '',
            tabBarButton: () => (
              <View style={{ top: -14, alignItems: 'center', justifyContent: 'center' }}>
                <TourTarget id="quickadd-button">
                  <Pressable
                    onPress={() => setQuickAddVisible(true)}
                    style={{
                      width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.accent,
                      alignItems: 'center', justifyContent: 'center',
                      shadowColor: Colors.accent, shadowOpacity: 0.6, shadowRadius: 10, elevation: 8,
                    }}
                  >
                    <Ionicons name="add" size={28} color={Colors.onAccent} />
                  </Pressable>
                </TourTarget>
              </View>
            ),
          }}
          listeners={{ tabPress: (e) => { e.preventDefault(); setQuickAddVisible(true); } }}
        />
        <Tabs.Screen name="community" options={{ title: t('tabs.community', { defaultValue: 'Comunidade' }) }} />
        <Tabs.Screen name="more"      options={{ title: t('tabs.more') }} />
        <Tabs.Screen name="fuel"      options={{ href: null }} />
        <Tabs.Screen name="expenses"  options={{ href: null }} />
        <Tabs.Screen name="two"       options={{ href: null }} />
      </Tabs>
      <TourOverlay visible={tourVisible} steps={TOUR_STEPS} onFinish={handleTourFinish} />
      <QuickAddSheet visible={quickAddVisible} onClose={() => setQuickAddVisible(false)} />
    </BiometricGate>
  );
}
