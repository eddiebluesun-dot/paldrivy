import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Localization from 'expo-localization';
import { supabase } from '../../src/lib/supabase';
import { upsertProfile } from '../../src/services/profile';
import { Colors, Radius, Spacing } from '../../src/theme';

const CURRENCIES = [
  { code: 'BRL', label: 'R$ — Real brasileiro' },
  { code: 'USD', label: '$ — Dólar americano' },
  { code: 'EUR', label: '€ — Euro' },
  { code: 'ARS', label: '$ — Peso argentino' },
  { code: 'CLP', label: '$ — Peso chileno' },
  { code: 'COP', label: '$ — Peso colombiano' },
  { code: 'MXN', label: '$ — Peso mexicano' },
] as const;

type LangCode = 'pt' | 'en' | 'es';
type CurrencyCode = (typeof CURRENCIES)[number]['code'];
type DistUnit = 'km' | 'mi';
type VolUnit = 'liters' | 'gallons';

const localeMap: Record<LangCode, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-419',
};

export default function LocaleScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const detectedLang = Localization.getLocales()[0]?.languageCode ?? 'pt';
  const initialLang: LangCode = detectedLang === 'pt' || detectedLang === 'en' || detectedLang === 'es'
    ? detectedLang
    : 'pt';

  const [lang, setLang] = useState<LangCode>(initialLang);
  const [currency, setCurrency] = useState<CurrencyCode>('BRL');
  const [distUnit, setDistUnit] = useState<DistUnit>('km');
  const [volUnit, setVolUnit] = useState<VolUnit>('liters');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleNext = async () => {
    setError('');
    setLoading(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setError(t('common.error'));
        return;
      }
      await upsertProfile({
        id: data.user.id,
        currency_code: currency,
        distance_unit: distUnit,
        volume_unit: volUnit,
        locale: localeMap[lang],
        name: data.user.email ?? '',
        country: currency === 'BRL' ? 'BR' : currency === 'USD' ? 'US' : currency === 'EUR' ? 'EU' : 'BR',
        timezone: Localization.getCalendars()[0]?.timeZone ?? 'America/Sao_Paulo',
        onboarding_done: false,
      });
      await i18n.changeLanguage(lang);
      router.push('/onboarding/vehicle');
    } catch {
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{t('onboarding.language_title')}</Text>

        {error ? <Text style={s.error}>{error}</Text> : null}

        <Text style={s.label}>{t('onboarding.country')}</Text>
        <View style={s.pickerWrap}>
          <Picker
            selectedValue={lang}
            onValueChange={(v) => setLang(v as LangCode)}
            dropdownIconColor={Colors.textSecondary}
            style={s.picker}
          >
            <Picker.Item label="Português" value="pt" color={Platform.OS === 'android' ? Colors.textPrimary : undefined} />
            <Picker.Item label="English" value="en" color={Platform.OS === 'android' ? Colors.textPrimary : undefined} />
            <Picker.Item label="Español" value="es" color={Platform.OS === 'android' ? Colors.textPrimary : undefined} />
          </Picker>
        </View>

        <Text style={s.label}>{t('onboarding.currency')}</Text>
        <View style={s.pickerWrap}>
          <Picker
            selectedValue={currency}
            onValueChange={(v) => setCurrency(v as CurrencyCode)}
            dropdownIconColor={Colors.textSecondary}
            style={s.picker}
          >
            {CURRENCIES.map((c) => (
              <Picker.Item
                key={c.code}
                label={c.label}
                value={c.code}
                color={Platform.OS === 'android' ? Colors.textPrimary : undefined}
              />
            ))}
          </Picker>
        </View>

        <Text style={s.label}>{t('onboarding.distance_unit')}</Text>
        <View style={s.pickerWrap}>
          <Picker
            selectedValue={distUnit}
            onValueChange={(v) => setDistUnit(v as DistUnit)}
            dropdownIconColor={Colors.textSecondary}
            style={s.picker}
          >
            <Picker.Item label={t('onboarding.dist_km')} value="km" color={Platform.OS === 'android' ? Colors.textPrimary : undefined} />
            <Picker.Item label={t('onboarding.dist_mi')} value="mi" color={Platform.OS === 'android' ? Colors.textPrimary : undefined} />
          </Picker>
        </View>

        <Text style={s.label}>{t('onboarding.volume_unit')}</Text>
        <View style={s.pickerWrap}>
          <Picker
            selectedValue={volUnit}
            onValueChange={(v) => setVolUnit(v as VolUnit)}
            dropdownIconColor={Colors.textSecondary}
            style={s.picker}
          >
            <Picker.Item label={t('onboarding.vol_liters')} value="liters" color={Platform.OS === 'android' ? Colors.textPrimary : undefined} />
            <Picker.Item label={t('onboarding.vol_gallons')} value="gallons" color={Platform.OS === 'android' ? Colors.textPrimary : undefined} />
          </Picker>
        </View>

        <TouchableOpacity
          style={[s.button, loading && s.buttonDisabled]}
          onPress={handleNext}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.next')}
        >
          {loading ? (
            <ActivityIndicator color={Colors.onBrand} />
          ) : (
            <Text style={s.buttonText}>{t('onboarding.next')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xl,
  },
  label: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  pickerWrap: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    overflow: 'hidden',
  },
  picker: {
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  error: {
    color: Colors.error,
    fontSize: 14,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceAlt,
    padding: Spacing.sm,
    borderRadius: Radius.input,
  },
  button: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: Spacing.xl,
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
});
