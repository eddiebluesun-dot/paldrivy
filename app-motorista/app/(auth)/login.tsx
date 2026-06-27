import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
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
    setEmailError('');
    setPasswordError('');
    setGeneralError('');
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo */}
          <View style={styles.logoBlock}>
            <Image
              source={require('../../assets/images/icon.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.appName}>{t('app_name')}</Text>
            <Text style={styles.tagline}>Controle financeiro para motoristas</Text>
          </View>

          {generalError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{generalError}</Text>
            </View>
          ) : null}

          {resetSent ? (
            <View style={styles.successBanner}>
              <Text style={styles.successBannerText}>{t('auth.reset_sent')}</Text>
            </View>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.email')}</Text>
            <TextInput
              style={[styles.input, emailError ? styles.inputError : null]}
              value={email}
              onChangeText={(v) => { setEmail(v); if (emailError) setEmailError(''); }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholderTextColor={Colors.textSecondary}
              placeholder="seu@email.com"
              accessibilityLabel={t('auth.email')}
            />
            {emailError ? <Text style={styles.fieldError}>{emailError}</Text> : null}
          </View>

          <View style={styles.fieldGroup}>
            <View style={styles.passwordHeader}>
              <Text style={styles.label}>{t('auth.password')}</Text>
              <TouchableOpacity onPress={handleForgotPassword} disabled={resetLoading}>
                {resetLoading
                  ? <ActivityIndicator size="small" color={Colors.brandBlue} />
                  : <Text style={styles.forgotLink}>{t('auth.forgot_password')}</Text>}
              </TouchableOpacity>
            </View>
            <View style={styles.passwordInputRow}>
              <TextInput
                style={[styles.input, styles.passwordInput, passwordError ? styles.inputError : null]}
                value={password}
                onChangeText={(v) => { setPassword(v); if (passwordError) setPasswordError(''); }}
                secureTextEntry={!showPassword}
                textContentType="password"
                placeholderTextColor={Colors.textSecondary}
                placeholder="••••••••"
                accessibilityLabel={t('auth.password')}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword((v) => !v)}
                accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            {passwordError ? <Text style={styles.fieldError}>{passwordError}</Text> : null}
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={t('auth.login')}
          >
            {loading
              ? <ActivityIndicator color={Colors.onBrand} />
              : <Text style={styles.primaryButtonText}>{t('auth.login')}</Text>}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.push('/(auth)/register')}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>{t('auth.no_account')}</Text>
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
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  logoBlock: {
    alignItems: 'center',
    marginBottom: Spacing.xxl,
  },
  logoImage: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: Spacing.sm,
  },
  appName: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  errorBanner: {
    backgroundColor: Colors.errorBg,
    borderRadius: Radius.input,
    padding: Spacing.sm + 4,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorBannerText: {
    color: Colors.error,
    fontSize: 14,
    textAlign: 'center',
  },
  successBanner: {
    backgroundColor: Colors.successBg,
    borderRadius: Radius.input,
    padding: Spacing.sm + 4,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  successBannerText: {
    color: Colors.success,
    fontSize: 14,
    textAlign: 'center',
  },
  fieldGroup: { marginBottom: Spacing.md },
  passwordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  label: { color: Colors.textSecondary, fontSize: 14, fontWeight: '500' },
  forgotLink: { color: Colors.brandBlue, fontSize: 13, fontWeight: '500' },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    fontSize: 16,
    color: Colors.textPrimary,
    minHeight: 48,
  },
  passwordInputRow: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 48,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 40,
  },
  inputError: { borderColor: Colors.error },
  fieldError: { color: Colors.error, fontSize: 12, marginTop: Spacing.xs },
  primaryButton: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: Spacing.sm,
    shadowColor: Colors.brandBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: Colors.onBrand, fontSize: 16, fontWeight: '700' },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.lg,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginHorizontal: Spacing.sm,
  },
  secondaryButton: {
    borderRadius: Radius.button,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryButtonText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
});
