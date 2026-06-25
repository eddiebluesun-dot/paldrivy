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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/hooks/useAuth';
import { Colors, Radius, Spacing } from '../../src/theme';
import '../../src/lib/i18n';

export default function LoginScreen() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = (): boolean => {
    let valid = true;
    setEmailError('');
    setPasswordError('');
    setGeneralError('');

    if (!email.trim()) {
      setEmailError(t('common.required'));
      valid = false;
    }
    if (!password) {
      setPasswordError(t('common.required'));
      valid = false;
    }
    return valid;
  };

  const handleLogin = async () => {
    if (!validate()) return;

    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);

    if (error) {
      setGeneralError(error.message);
    }
    // On success, root layout auth guard redirects to /(tabs)
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
          <Text style={styles.appName}>{t('app_name')}</Text>

          {generalError ? (
            <Text style={styles.generalError}>{generalError}</Text>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.email')}</Text>
            <TextInput
              style={[styles.input, emailError ? styles.inputError : null]}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (emailError) setEmailError('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholderTextColor={Colors.textSecondary}
              placeholder={t('auth.email')}
              accessibilityLabel={t('auth.email')}
            />
            {emailError ? (
              <Text style={styles.fieldError}>{emailError}</Text>
            ) : null}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.password')}</Text>
            <TextInput
              style={[styles.input, passwordError ? styles.inputError : null]}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (passwordError) setPasswordError('');
              }}
              secureTextEntry
              textContentType="password"
              placeholderTextColor={Colors.textSecondary}
              placeholder={t('auth.password')}
              accessibilityLabel={t('auth.password')}
            />
            {passwordError ? (
              <Text style={styles.fieldError}>{passwordError}</Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={t('auth.login')}
          >
            {loading ? (
              <ActivityIndicator color={Colors.onBrand} />
            ) : (
              <Text style={styles.primaryButtonText}>{t('auth.login')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.push('/(auth)/register')}
            accessibilityRole="button"
            accessibilityLabel={t('auth.no_account')}
          >
            <Text style={styles.secondaryButtonText}>{t('auth.no_account')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  appName: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
    ...Platform.select({
      ios: { fontFamily: 'IBM Plex Sans' },
      android: { fontFamily: 'IBMPlexSans-Bold' },
    }),
  },
  generalError: {
    color: Colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceAlt,
    padding: Spacing.sm,
    borderRadius: Radius.input,
  },
  fieldGroup: {
    marginBottom: Spacing.md,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 14,
    marginBottom: Spacing.xs,
  },
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
  inputError: {
    borderColor: Colors.error,
  },
  fieldError: {
    color: Colors.error,
    fontSize: 12,
    marginTop: Spacing.xs,
  },
  primaryButton: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: Colors.onBrand,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: Spacing.sm,
  },
  secondaryButtonText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
});
