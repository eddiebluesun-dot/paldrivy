import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { Colors } from '@/src/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<string, [IoniconName, IoniconName]> = {
  index:    ['home-outline',    'home'],
  shifts:   ['time-outline',    'time'],
  fuel:     ['flame-outline',   'flame'],
  expenses: ['wallet-outline',  'wallet'],
  more:     ['ellipsis-horizontal-circle-outline', 'ellipsis-horizontal-circle'],
};

export default function TabLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
        },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarIcon: ({ focused, color, size }) => {
          const [outline, filled] = TAB_ICONS[route.name] ?? ['help-circle-outline', 'help-circle'];
          return <Ionicons name={focused ? filled : outline} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="index"    options={{ title: t('tabs.dashboard') }} />
      <Tabs.Screen name="shifts"   options={{ title: t('tabs.shifts') }} />
      <Tabs.Screen name="fuel"     options={{ title: t('tabs.fuel') }} />
      <Tabs.Screen name="expenses" options={{ title: t('tabs.expenses') }} />
      <Tabs.Screen name="more"     options={{ title: t('tabs.more') }} />
      <Tabs.Screen name="two"      options={{ href: null }} />
    </Tabs>
  );
}
