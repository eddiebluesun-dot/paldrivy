import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { authSignIn } from '../../src/hooks/useAuth';
import { supabase } from '../../src/lib/supabase';
import { Colors, Radius, Spacing } from '../../src/theme';

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const validate = (): boolean => {
    let valid = true;
    setEmailError(''); setPasswordError(''); setGeneralError('');
    if (!email.trim()) { setEmailError(t('common.required')); valid = false; }
    if (!password) { setPasswordError(t('common.required')); valid = false; }
    return valid;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);
    const { error } = await authSignIn(email.trim(), password);
    setLoading(false);
    if (error) setGeneralError(error.message);
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) { setEmailError(t('common.required')); return; }
    setResetLoading(true);
    await supabase.auth.resetPasswordForEmail(email.trim());
    setResetLoading(false);
    setResetSent(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Hero */}
          <View style={styles.hero}>
            <Image source={require('../../assets/images/logo.png')} style={styles.logoImg} resizeMode="contain" />
            <Text style={styles.tagline}>Controle financeiro para motoristas</Text>
          </View>

          {/* Banners */}
          {generalError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
              <Text style={styles.errorBannerText}>{generalError}</Text>
            </View>
          ) : null}
          {resetSent ? (
            <View style={styles.successBanner}>
              <Ionicons name="checkmark-circle-outline" size={16} color={Colors.success} />
              <Text style={styles.successBannerText}>{t('auth.reset_sent')}</Text>
            </View>
          ) : null}

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.email')}</Text>
            <TextInput
              style={[styles.input, emailError ? styles.inputErr : null]}
              value={email}
              onChangeText={v => { setEmail(v); if (emailError) setEmailError(''); }}
              autoCapitalize="none" autoCorrect={false}
              keyboardType="email-address" textContentType="emailAddress"
              placeholderTextColor={Colors.textSecondary} placeholder="seu@email.com"
              accessibilityLabel={t('auth.email')}
            />
            {emailError ? <Text style={styles.fieldError}>{emailError}</Text> : null}
          </View>

          {/* Password */}
          <View style={styles.fieldGroup}>
            <View style={styles.passwordHeader}>
              <Text style={styles.label}>{t('auth.password')}</Text>
              <TouchableOpacity onPress={handleForgotPassword} disabled={resetLoading}>
                {resetLoading
                  ? <ActivityIndicator size="small" color={Colors.accent} />
                  : <Text style={styles.forgotLink}>{t('auth.forgot_password')}</Text>}
              </TouchableOpacity>
            </View>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput, passwordError ? styles.inputErr : null]}
                value={password}
                onChangeText={v => { setPassword(v); if (passwordError) setPasswordError(''); }}
                secureTextEntry={!showPassword} textContentType="password"
                placeholderTextColor={Colors.textSecondary} placeholder="••••••••"
                accessibilityLabel={t('auth.password')}
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(v => !v)}
                accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {passwordError ? <Text style={styles.fieldError}>{passwordError}</Text> : null}
          </View>

          {/* Primary CTA */}
          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            onPress={handleLogin} disabled={loading} accessibilityRole="button"
          >
            {loading
              ? <ActivityIndicator color={Colors.onAccent} />
              : <Text style={styles.primaryBtnText}>{t('auth.login')}</Text>}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/(auth)/register')} accessibilityRole="button">
            <Text style={styles.secondaryBtnText}>{t('auth.no_account')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1, justifyContent: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xl,
    maxWidth: 480, alignSelf: 'center', width: '100%',
  },

  hero: { alignItems: 'center', marginBottom: Spacing.xl },
  logoImg: {
    width: 200, height: 200, borderRadius: 28, marginBottom: Spacing.xs,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 20, elevation: 10,
  },
  tagline: { fontSize: 13, color: Colors.textSecondary },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.errorBg, borderRadius: Radius.input,
    padding: Spacing.sm + 4, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
  },
  errorBannerText: { color: Colors.error, fontSize: 14, flex: 1 },
  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.successBg, borderRadius: Radius.input,
    padding: Spacing.sm + 4, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)',
  },
  successBannerText: { color: Colors.success, fontSize: 14, flex: 1 },

  fieldGroup: { marginBottom: Spacing.md },
  passwordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  label: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.xs,
  },
  forgotLink: { color: Colors.accent, fontSize: 13, fontWeight: '500' },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.input, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4, fontSize: 16, color: Colors.textPrimary, minHeight: 52,
  },
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 48 },
  eyeBtn: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', width: 44 },
  inputErr: { borderColor: Colors.error },
  fieldError: { color: Colors.error, fontSize: 12, marginTop: Spacing.xs },

  primaryBtn: {
    backgroundColor: Colors.accent, borderRadius: Radius.button,
    alignItems: 'center', justifyContent: 'center', minHeight: 56,
    marginTop: Spacing.sm,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: Colors.onAccent, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: Spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { color: Colors.textSecondary, fontSize: 13, marginHorizontal: Spacing.sm },

  secondaryBtn: {
    borderRadius: Radius.button, borderWidth: 1.5, borderColor: Colors.borderBright,
    alignItems: 'center', justifyContent: 'center', minHeight: 52,
  },
  secondaryBtnText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
});
