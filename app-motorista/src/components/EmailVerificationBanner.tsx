import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { shouldShowEmailVerificationBanner } from '../utils/emailVerification';
import { Colors, Radius, Spacing } from '../theme';

const DISMISSED_KEY = 'paldrivy_email_banner_dismissed_user_id';

// Dismissible nudge shown when the signed-in user's email isn't confirmed
// yet. Never blocks anything — see docs/superpowers/specs/2026-08-05-signup-soft-gate-design.md.
export function EmailVerificationBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [dismissedForUserId, setDismissedForUserId] = useState<string | null>(null);
  const [dismissedLoaded, setDismissedLoaded] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(DISMISSED_KEY)
      .then(v => setDismissedForUserId(v))
      .finally(() => setDismissedLoaded(true));
  }, []);

  if (!session || !dismissedLoaded) return null;

  const visible = shouldShowEmailVerificationBanner({
    emailConfirmedAt: session.user.email_confirmed_at,
    userId: session.user.id,
    dismissedForUserId,
  });
  if (!visible) return null;

  function dismiss() {
    if (!session) return;
    setDismissedForUserId(session.user.id);
    AsyncStorage.setItem(DISMISSED_KEY, session.user.id).catch(() => {});
  }

  async function handleResend() {
    if (!session?.user.email || resending) return;
    setResending(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: session.user.email });
    setResending(false);
    if (!error) setResent(true);
  }

  return (
    <View style={[styles.banner, { marginTop: insets.top + Spacing.sm }]}>
      <Ionicons name="mail-outline" size={18} color={Colors.accent} />
      <View style={styles.textCol}>
        <Text style={styles.title}>{t('auth.email_banner_title')}</Text>
        <Text style={styles.body}>
          {resent ? t('auth.verify_email_resent') : t('auth.email_banner_body')}
        </Text>
      </View>
      <TouchableOpacity onPress={handleResend} disabled={resending} accessibilityRole="button">
        {resending
          ? <ActivityIndicator size="small" color={Colors.accent} />
          : <Text style={styles.resendLink}>{t('auth.email_banner_resend')}</Text>}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={t('auth.email_banner_dismiss')}
        style={styles.dismissBtn}
      >
        <Ionicons name="close" size={16} color={Colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.accentDim,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginHorizontal: Spacing.md,
  },
  textCol: { flex: 1 },
  title: { color: Colors.textPrimary, fontSize: 12, fontWeight: '700' },
  body: { color: Colors.textSecondary, fontSize: 11, marginTop: 1 },
  resendLink: { color: Colors.accent, fontSize: 12, fontWeight: '700' },
  dismissBtn: { padding: 4 },
});
