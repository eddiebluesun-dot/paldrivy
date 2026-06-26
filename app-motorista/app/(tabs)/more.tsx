import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { SymbolView } from 'expo-symbols';
import { supabase } from '@/src/lib/supabase';
import { authSignOut } from '@/src/hooks/useAuth';
import { useProfile } from '@/src/hooks/useProfile';
import { Colors, Radius, Spacing } from '@/src/theme';

// ─── setting row ─────────────────────────────────────────────────────────────

interface SettingRowProps {
  label: string;
  value: string;
}

function SettingRow({ label, value }: SettingRowProps) {
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        tintColor={Colors.textSecondary}
        size={16}
      />
    </TouchableOpacity>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────

export default function MoreScreen() {
  const { t, i18n } = useTranslation();
  const { profile } = useProfile();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  const handleSignOut = () => {
    authSignOut().catch(() => {
      // sign-out errors are transient; nothing the user can do
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.screenTitle}>{t('more.title')}</Text>

        {/* Profile section */}
        <Text style={styles.sectionHeader}>{t('more.profile')}</Text>
        <View style={styles.card}>
          <Text style={styles.emailLabel}>{email ?? '—'}</Text>
        </View>

        {/* Settings section */}
        <Text style={styles.sectionHeader}>{t('more.settings')}</Text>
        <View style={styles.card}>
          <SettingRow
            label={t('more.language')}
            value={i18n.language}
          />
          <View style={styles.divider} />
          <SettingRow
            label={t('more.currency')}
            value={profile?.currency_code ?? '—'}
          />
          <View style={styles.divider} />
          <SettingRow
            label={t('more.distance_unit')}
            value={profile?.distance_unit ?? '—'}
          />
          <View style={styles.divider} />
          <SettingRow
            label={t('more.volume_unit')}
            value={profile?.volume_unit ?? '—'}
          />
        </View>

        {/* Sign out */}
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <Text style={styles.signOutText}>{t('more.sign_out')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  screenTitle: {
    color: Colors.textPrimary,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: Spacing.md,
  },
  sectionHeader: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
    marginTop: Spacing.xs,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  emailLabel: {
    color: Colors.textPrimary,
    fontSize: 14,
    padding: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: Spacing.sm,
  },
  rowLabel: {
    color: Colors.textPrimary,
    fontSize: 14,
  },
  rowValue: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.md,
  },
  signOutButton: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.error,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  signOutText: {
    color: Colors.error,
    fontSize: 16,
    fontWeight: '600',
  },
});
