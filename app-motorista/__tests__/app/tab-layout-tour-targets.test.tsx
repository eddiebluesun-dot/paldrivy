import React from 'react';
import { render } from '@testing-library/react-native';
import { getTourTarget, unregisterTourTarget } from '@/src/tour/tourRegistry';

// TabLayout wraps BiometricGate / EmailVerificationBanner / TourOverlay /
// QuickAddSheet around the tab navigator. None of their internal behavior
// (biometric prompts, Supabase auth) is relevant to what this
// test checks — only that the tab-bar tour targets register — so they're
// replaced with inert passthroughs/no-ops to keep the render surface small
// and avoid bootstrapping unrelated native modules.
jest.mock('@/src/components/BiometricGate', () => ({
  BiometricGate: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/src/components/TourOverlay', () => ({ TourOverlay: () => null }));
jest.mock('@/src/components/QuickAddSheet', () => ({ QuickAddSheet: () => null }));
jest.mock('@/src/components/EmailVerificationBanner', () => ({ EmailVerificationBanner: () => null }));

jest.mock('@/src/tour/steps', () => ({
  TOUR_STEPS: [],
}));

jest.mock('@/src/services/profile', () => ({
  getProfile: jest.fn().mockResolvedValue(null),
  markTourSeen: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
    },
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

// _layout.tsx declares its tab config the normal expo-router/react-navigation
// way: <Tabs screenOptions={...}><Tabs.Screen name=... options=... /></Tabs>.
// Real react-navigation never mounts <Tabs.Screen> as a component either —
// the Navigator reads each Screen's props to build route config, then calls
// screenOptions({ route }) and the returned tabBarIcon/tabBarButton itself
// to produce the tab bar. This mock reproduces exactly that contract so
// _layout.tsx's real tabBarIcon closure (the TAB_TOUR_TARGET_IDS branch
// under test) executes unmodified, without needing a full NavigationContainer
// — which is what the task-4 review flagged as unexercised.
jest.mock('expo-router', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');

  function Tabs({ screenOptions, children }: any) {
    return (
      <View>
        {ReactActual.Children.toArray(children).map((child: any) => {
          const route = { name: child.props.name };
          const options = typeof screenOptions === 'function' ? screenOptions({ route }) : screenOptions;
          const merged = { ...options, ...child.props.options };
          return (
            <View key={route.name}>
              {typeof merged.tabBarIcon === 'function'
                ? merged.tabBarIcon({ focused: false, color: '#000', size: 24 })
                : null}
              {typeof merged.tabBarButton === 'function' ? merged.tabBarButton() : null}
            </View>
          );
        })}
      </View>
    );
  }
  Tabs.Screen = function TabsScreen() { return null; };

  return {
    Tabs,
    useRouter: () => ({ push: jest.fn() }),
  };
});

import TabLayout from '@/app/(tabs)/_layout';

const TAB_TARGET_IDS = ['tab-shifts', 'tab-community', 'tab-more', 'quickadd-button'];

describe('TabLayout — tab-bar tour targets register after render', () => {
  afterEach(() => {
    TAB_TARGET_IDS.forEach(unregisterTourTarget);
  });

  it('resolves getTourTarget for each tab icon and the quick-add button to a mounted node', () => {
    render(<TabLayout />);

    for (const id of TAB_TARGET_IDS) {
      const ref = getTourTarget(id);
      expect(ref).toBeDefined();
      expect(ref?.current).not.toBeNull();
    }
  });

  it('does not register a tour target for the dashboard tab, which has no entry in TAB_TOUR_TARGET_IDS', () => {
    render(<TabLayout />);
    expect(getTourTarget('tab-index')).toBeUndefined();
  });
});
