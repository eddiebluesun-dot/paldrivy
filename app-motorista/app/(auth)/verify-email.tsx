import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../../src/lib/supabase';
import { Colors, Radius, Spacing } from '../../src/theme';

const RESEND_COOLDOWN_SECONDS = 45;

export default function VerifyEmailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();

  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleResend() {
    if (!email || cooldown > 0) return;
    setResending(true);
    setError('');
    setResent(false);
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
    setResending(false);
    if (resendError) { setError(resendError.message); return; }
    setResent(true);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.hero}>
          <Image source={require('../../assets/images/icon.png')} style={styles.logoImg} resizeMode="contain" />
          <Text style={styles.wordmark}>PalDrivy</Text>
        </View>

        <View style={styles.iconWrap}>
          <Ionicons name="mail-unread-outline" size={40} color={Colors.accent} />
        </View>

        <Text style={styles.title}>{t('auth.verify_email_title')}</Text>
        <Text style={styles.body}>
          {t('auth.verify_email_body', { email })}
        </Text>

        {resent ? (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle-outline" size={16} color={Colors.success} />
            <Text style={styles.successBannerText}>{t('auth.verify_email_resent')}</Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.replace({ pathname: '/(auth)/login', params: { email: email ?? '' } })}
          accessibilityRole="button"
        >
          <Text style={styles.primaryBtnText}>{t('auth.verify_email_already_confirmed')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, (cooldown > 0 || resending) && styles.btnDisabled]}
          onPress={handleResend}
          disabled={cooldown > 0 || resending}
          accessibilityRole="button"
        >
          {resending ? (
            <ActivityIndicator color={Colors.textPrimary} />
          ) : (
            <Text style={styles.secondaryBtnText}>
              {cooldown > 0
                ? t('auth.verify_email_resend_wait', { seconds: cooldown })
                : t('auth.verify_email_resend')}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => router.replace('/(auth)/register')}
          accessibilityRole="button"
        >
          <Text style={styles.linkBtnText}>{t('auth.verify_email_wrong_email')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: {
    flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg,
    maxWidth: 480, alignSelf: 'center', width: '100%',
  },
  hero: { alignItems: 'center', marginBottom: Spacing.lg },
  logoImg: { width: 72, height: 72, borderRadius: 18, marginBottom: Spacing.sm },
  wordmark: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  iconWrap: {
    alignSelf: 'center', width: 76, height: 76, borderRadius: 38,
    backgroundColor: Colors.accentDim, alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: Spacing.sm },
  body: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: Spacing.lg },
  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
    backgroundColor: Colors.successBg, borderRadius: Radius.input,
    padding: Spacing.sm + 4, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)',
  },
  successBannerText: { color: Colors.success, fontSize: 14 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
    backgroundColor: Colors.errorBg, borderRadius: Radius.input,
    padding: Spacing.sm + 4, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
  },
  errorBannerText: { color: Colors.error, fontSize: 14, flex: 1 },
  primaryBtn: {
    backgroundColor: Colors.accent, borderRadius: Radius.button,
    alignItems: 'center', justifyContent: 'center', minHeight: 56,
    marginBottom: Spacing.sm,
  },
  primaryBtnText: { color: Colors.onAccent, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  secondaryBtn: {
    borderRadius: Radius.button, borderWidth: 1.5, borderColor: Colors.borderBright,
    alignItems: 'center', justifyContent: 'center', minHeight: 52,
    marginBottom: Spacing.md,
  },
  secondaryBtnText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  linkBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  linkBtnText: { color: Colors.accent, fontSize: 14, fontWeight: '600' },
});
