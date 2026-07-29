import React, { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import * as SecureStore from 'expo-secure-store';
import { View } from 'react-native';
import { Colors } from '@/src/theme';
import { BiometricGate } from '@/src/components/BiometricGate';
import { TutorialModal } from '@/src/components/TutorialModal';
import { QuickAddSheet } from '@/src/components/QuickAddSheet';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<string, [IoniconName, IoniconName]> = {
  index:     ['home-outline',    'home'],
  shifts:    ['time-outline',    'time'],
  community: ['people-outline',  'people'],
  more:      ['ellipsis-horizontal-circle-outline', 'ellipsis-horizontal-circle'],
};

const TUTORIAL_KEY = 'paldrivy_tutorial_done';

export default function TabLayout() {
  const { t } = useTranslation();
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [quickAddVisible, setQuickAddVisible] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(TUTORIAL_KEY).then(done => {
      if (!done) setTutorialVisible(true);
    }).catch(() => {});
  }, []);

  function handleTutorialClose() {
    setTutorialVisible(false);
    SecureStore.setItemAsync(TUTORIAL_KEY, '1').catch(() => {});
  }

  return (
    <BiometricGate>
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
            return <Ionicons name={focused ? filled : outline} size={size} color={color} />;
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
                <View
                  onTouchEnd={() => setQuickAddVisible(true)}
                  style={{
                    width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.accent,
                    alignItems: 'center', justifyContent: 'center',
                    shadowColor: Colors.accent, shadowOpacity: 0.6, shadowRadius: 10, elevation: 8,
                  }}
                >
                  <Ionicons name="add" size={28} color={Colors.onAccent} />
                </View>
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
      <TutorialModal visible={tutorialVisible} onClose={handleTutorialClose} />
      <QuickAddSheet visible={quickAddVisible} onClose={() => setQuickAddVisible(false)} />
    </BiometricGate>
  );
}
