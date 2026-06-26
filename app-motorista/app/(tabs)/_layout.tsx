import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Colors } from '@/src/theme';

export default function TabLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
        },
        tabBarActiveTintColor: Colors.brandBlue,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarIconStyle: { width: 24, height: 24 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.dashboard'),
          tabBarIcon: ({ focused, color }) => (
            <SymbolView
              name={{ ios: focused ? 'house.fill' : 'house', android: focused ? 'home_filled' : 'home', web: focused ? 'home_filled' : 'home' }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="shifts"
        options={{
          title: t('tabs.shifts'),
          tabBarIcon: ({ focused, color }) => (
            <SymbolView
              name={{ ios: focused ? 'clock.fill' : 'clock', android: focused ? 'access_time_filled' : 'schedule', web: focused ? 'access_time_filled' : 'schedule' }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="fuel"
        options={{
          title: t('tabs.fuel'),
          tabBarIcon: ({ focused, color }) => (
            <SymbolView
              name={{ ios: focused ? 'flame.fill' : 'flame', android: 'local_fire_department', web: 'local_fire_department' }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: t('tabs.expenses'),
          tabBarIcon: ({ focused, color }) => (
            <SymbolView
              name={{ ios: focused ? 'creditcard.fill' : 'creditcard', android: 'account_balance_wallet', web: 'account_balance_wallet' }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('tabs.more'),
          tabBarIcon: ({ focused, color }) => (
            <SymbolView
              name={{ ios: focused ? 'ellipsis.circle.fill' : 'ellipsis.circle', android: 'more_horiz', web: 'more_horiz' }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
    </Tabs>
  );
}
