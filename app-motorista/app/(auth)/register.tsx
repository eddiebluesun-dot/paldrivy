import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { authSignUp } from '../../src/hooks/useAuth';
import { Colors, Radius, Spacing } from '../../src/theme';

export default function RegisterScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const validate = (): boolean => {
    let valid = true;
    setEmailError(''); setPasswordError(''); setGeneralError('');
    if (!email.trim()) { setEmailError(t('common.required')); valid = false; }
    if (!password) { setPasswordError(t('common.required')); valid = false; }
    else if (password.length < 6) { setPasswordError(t('auth.password_min')); valid = false; }
    return valid;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);
    const { data, error } = await authSignUp(email.trim(), password);
    if (error) { setLoading(false); setGeneralError(error.message); return; }

    // Soft-gate: when Supabase returns a session immediately (email
    // confirmation not required to sign in), let the user into the app right
    // away — the onAuthStateChange listener in useAuth() + RootLayoutNav's
    // existing redirect-to-onboarding logic carry them in from here, same as
    // login.tsx already relies on. Email confirmation becomes a dismissible
    // nudge (EmailVerificationBanner) instead of a blocker.
    //
    // If no session came back, Supabase still requires confirmation — fall
    // back to the verify-email screen so nothing breaks before that project
    // setting is changed.
    if (data.session) return;
    setLoading(false);
    router.replace({ pathname: '/(auth)/verify-email', params: { email: email.trim() } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Hero */}
          <View style={styles.hero}>
            <Image source={require('../../assets/images/icon.png')} style={styles.logoImg} resizeMode="contain" />
            <Text style={styles.wordmark}>PalDrivy</Text>
            <Text style={styles.tagline}>{t('auth.register')}</Text>
          </View>

          {generalError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
              <Text style={styles.errorBannerText}>{generalError}</Text>
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
            <Text style={styles.label}>{t('auth.password')}</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput, passwordError ? styles.inputErr : null]}
                value={password}
                onChangeText={v => { setPassword(v); if (passwordError) setPasswordError(''); }}
                secureTextEntry={!showPassword} textContentType="newPassword"
                placeholderTextColor={Colors.textSecondary} placeholder="Mínimo 6 caracteres"
                accessibilityLabel={t('auth.password')}
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(v => !v)}
                accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {passwordError ? <Text style={styles.fieldError}>{passwordError}</Text> : null}
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            onPress={handleRegister} disabled={loading} accessibilityRole="button"
          >
            {loading
              ? <ActivityIndicator color={Colors.onAccent} />
              : <Text style={styles.primaryBtnText}>{t('auth.register')}</Text>}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.secondaryBtnText}>{t('auth.have_account')}</Text>
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
  logoImg: { width: 96, height: 96, borderRadius: 22, marginBottom: Spacing.sm },
  wordmark: {
    color: Colors.textPrimary, fontSize: 28, fontWeight: '800',
    letterSpacing: -0.5, marginBottom: 4,
  },
  tagline: { fontSize: 14, color: Colors.textSecondary },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.errorBg, borderRadius: Radius.input,
    padding: Spacing.sm + 4, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
  },
  errorBannerText: { color: Colors.error, fontSize: 14, flex: 1 },

  fieldGroup: { marginBottom: Spacing.md },
  label: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.xs,
  },
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
