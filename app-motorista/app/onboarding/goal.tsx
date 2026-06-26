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
import { supabase } from '../../src/lib/supabase';
import { markOnboardingDone } from '../../src/services/profile';
import { decimalToCents } from '../../src/utils/currency';
import { Colors, Radius, Spacing } from '../../src/theme';

export default function GoalScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFinish = async () => {
    setError('');
    setLoading(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setError(t('common.error'));
        return;
      }
      const parsedGoal = parseFloat(goal);
      if (goal && !isNaN(parsedGoal) && parsedGoal > 0) {
        await supabase.from('goals').insert({
          user_id: data.user.id,
          type: 'monthly',
          target_amount_cents: decimalToCents(parsedGoal),
          starts_at: new Date().toISOString().split('T')[0],
        });
      }
      await markOnboardingDone(data.user.id);
      router.replace('/(tabs)');
    } catch {
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Text style={s.title}>{t('onboarding.goal_title')}</Text>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <TextInput
            style={s.input}
            placeholder={t('onboarding.goal_placeholder')}
            placeholderTextColor={Colors.textSecondary}
            value={goal}
            onChangeText={setGoal}
            keyboardType="decimal-pad"
            accessibilityLabel={t('onboarding.goal_title')}
          />

          <View style={s.actions}>
            <TouchableOpacity
              style={[s.button, loading && s.buttonDisabled]}
              onPress={handleFinish}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.finish')}
            >
              {loading ? (
                <ActivityIndicator color={Colors.onBrand} />
              ) : (
                <Text style={s.buttonText}>{t('onboarding.finish')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.secondaryButton, loading && s.buttonDisabled]}
              onPress={handleFinish}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.skip')}
            >
              <Text style={s.secondaryButtonText}>{t('onboarding.skip')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
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
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xl,
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
    marginBottom: Spacing.lg,
  },
  error: {
    color: Colors.error,
    fontSize: 14,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceAlt,
    padding: Spacing.sm,
    borderRadius: Radius.input,
  },
  actions: {
    gap: Spacing.sm,
  },
  button: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: Colors.onBrand,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryButtonText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
});
