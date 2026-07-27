import { useMemo, useEffect, useState } from 'react';
import {
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Select } from '../../src/components/Select';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { upsertProfile } from '../../src/services/profile';
import { Colors, Radius, Spacing } from '../../src/theme';
import { getAutoLocale, buildLocale, COUNTRY_DIAL, type SupportedLang } from '../../src/utils/autoLocale';
import type { WorkerType } from '../../src/types';

// ─── Currency list (covers all major world regions) ───────────────────────────
const CURRENCIES_BASE = [
  // Americas
  { code: 'BRL', label: 'R$ — Real brasileiro' },
  { code: 'USD', label: '$ — US Dollar' },
  { code: 'CAD', label: 'C$ — Canadian Dollar' },
  { code: 'MXN', label: '$ — Peso mexicano' },
  { code: 'ARS', label: '$ — Peso argentino' },
  { code: 'CLP', label: '$ — Peso chileno' },
  { code: 'COP', label: '$ — Peso colombiano' },
  { code: 'PEN', label: 'S/ — Sol peruano' },
  // Europe
  { code: 'EUR', label: '€ — Euro' },
  { code: 'GBP', label: '£ — British Pound' },
  { code: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'SEK', label: 'kr — Swedish Krona' },
  { code: 'NOK', label: 'kr — Norwegian Krone' },
  { code: 'DKK', label: 'kr — Danish Krone' },
  { code: 'PLN', label: 'zł — Polish Zloty' },
  { code: 'CZK', label: 'Kč — Czech Koruna' },
  { code: 'HUF', label: 'Ft — Hungarian Forint' },
  { code: 'RUB', label: '₽ — Russian Ruble' },
  { code: 'TRY', label: '₺ — Turkish Lira' },
  { code: 'UAH', label: '₴ — Ukrainian Hryvnia' },
  // Asia-Pacific
  { code: 'JPY', label: '¥ — Japanese Yen' },
  { code: 'CNY', label: '¥ — Chinese Yuan' },
  { code: 'KRW', label: '₩ — South Korean Won' },
  { code: 'INR', label: '₹ — Indian Rupee' },
  { code: 'AUD', label: 'A$ — Australian Dollar' },
  { code: 'NZD', label: 'NZ$ — New Zealand Dollar' },
  { code: 'SGD', label: 'S$ — Singapore Dollar' },
  { code: 'HKD', label: 'HK$ — Hong Kong Dollar' },
  { code: 'IDR', label: 'Rp — Indonesian Rupiah' },
  { code: 'THB', label: '฿ — Thai Baht' },
  { code: 'MYR', label: 'RM — Malaysian Ringgit' },
  { code: 'PHP', label: '₱ — Philippine Peso' },
  { code: 'PKR', label: '₨ — Pakistani Rupee' },
  { code: 'BDT', label: '৳ — Bangladeshi Taka' },
  // Middle East & Africa
  { code: 'AED', label: 'د.إ — UAE Dirham' },
  { code: 'SAR', label: '﷼ — Saudi Riyal' },
  { code: 'ILS', label: '₪ — Israeli Shekel' },
  { code: 'EGP', label: 'E£ — Egyptian Pound' },
  { code: 'ZAR', label: 'R — South African Rand' },
  { code: 'NGN', label: '₦ — Nigerian Naira' },
  { code: 'KES', label: 'KSh — Kenyan Shilling' },
  { code: 'GHS', label: 'GH₵ — Ghanaian Cedi' },
];

const LANG_ITEMS = [
  { label: 'Português (BR)', value: 'pt' },
  { label: 'English (US)',   value: 'en' },
  { label: 'English (UK)',   value: 'en-GB' },
  { label: 'Español',        value: 'es' },
];

const WORKER_TYPES: { value: WorkerType; icon: string; labelKey: string }[] = [
  { value: 'driver',  icon: '🚗', labelKey: 'onboarding.worker_type_driver' },
  { value: 'motoboy', icon: '🛵', labelKey: 'onboarding.worker_type_motoboy' },
];

export default function LocaleScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  // Auto-detect all settings from device locale — computed once on mount
  const auto = useMemo(() => getAutoLocale(), []);

  const [lang, setLang]         = useState<SupportedLang>(auto.lang);
  const [currency, setCurrency] = useState<string>(auto.currency_code);
  const [distUnit, setDistUnit] = useState<'km' | 'mi'>(auto.distance_unit);
  const [volUnit, setVolUnit]   = useState<'liters' | 'gallons'>(auto.volume_unit);
  const [workerType, setWorkerType] = useState<WorkerType>('driver');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone]       = useState(() => {
    const code = COUNTRY_DIAL[auto.country] ?? '';
    return code ? code + ' ' : '';
  });
  const [city, setCity]   = useState('');
  const [state, setState] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  // Ensure auto-detected currency is always in the picker list
  const currencies = useMemo(() => {
    if (CURRENCIES_BASE.find(c => c.code === auto.currency_code)) return CURRENCIES_BASE;
    return [{ code: auto.currency_code, label: auto.currency_code }, ...CURRENCIES_BASE];
  }, [auto.currency_code]);

  // Live language preview — does NOT reset currency/units (those are country-based)
  useEffect(() => {
    i18n.changeLanguage(lang);
  }, [lang, i18n]);

  const handleNext = async () => {
    const nameTrimmed  = fullName.trim();
    const phoneTrimmed = phone.trim();
    const cityTrimmed  = city.trim();
    const stateTrimmed = state.trim();
    if (!nameTrimmed || !phoneTrimmed || !cityTrimmed || !stateTrimmed) {
      setError(t('common.required'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { setError(t('common.error')); return; }
      await upsertProfile({
        id: data.user.id,
        currency_code: currency,
        distance_unit: distUnit,
        volume_unit: volUnit,
        locale: buildLocale(lang, auto.country),
        name: nameTrimmed,
        phone: phoneTrimmed,
        country: auto.country,
        city: cityTrimmed,
        state: stateTrimmed,
        timezone: auto.timezone,
        onboarding_done: false,
        worker_type: workerType,
      });
      router.push('/onboarding/vehicle');
    } catch {
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const inp = [s.input, { color: Colors.textPrimary }];

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{t('onboarding.language_title')}</Text>

        {error ? <Text style={s.error}>{error}</Text> : null}

        {/* Full name */}
        <Text style={s.label}>
          {t('onboarding.full_name')}<Text style={s.required}> *</Text>
        </Text>
        <TextInput
          style={inp}
          value={fullName}
          onChangeText={setFullName}
          placeholder={t('onboarding.full_name_placeholder')}
          placeholderTextColor={Colors.textSecondary}
          autoCapitalize="words"
          autoComplete="name"
          returnKeyType="next"
        />

        {/* Phone */}
        <Text style={s.label}>
          {t('onboarding.phone')}<Text style={s.required}> *</Text>
        </Text>
        <TextInput
          style={inp}
          value={phone}
          onChangeText={setPhone}
          placeholder={(COUNTRY_DIAL[auto.country] ?? '') + ' ' + t('onboarding.phone_placeholder')}
          placeholderTextColor={Colors.textSecondary}
          keyboardType="phone-pad"
          autoComplete="tel"
          returnKeyType="next"
        />

        {/* Worker type */}
        <Text style={s.label}>{t('onboarding.worker_type_prompt')}</Text>
        <View style={s.pillRow}>
          {WORKER_TYPES.map(wt => (
            <TouchableOpacity
              key={wt.value}
              style={[s.pill, workerType === wt.value && s.pillActive]}
              onPress={() => setWorkerType(wt.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: workerType === wt.value }}
            >
              <Text style={s.pillIcon}>{wt.icon}</Text>
              <Text style={[s.pillText, workerType === wt.value && s.pillTextActive]}>
                {t(wt.labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Language */}
        <Text style={s.label}>{t('onboarding.country')}</Text>
        <Select
          value={lang}
          onValueChange={(v) => setLang(v as SupportedLang)}
          items={LANG_ITEMS}
        />

        {/* City */}
        <Text style={s.label}>
          {t('onboarding.city')}<Text style={s.required}> *</Text>
        </Text>
        <TextInput
          style={inp}
          value={city}
          onChangeText={setCity}
          placeholder={t('onboarding.city_placeholder')}
          placeholderTextColor={Colors.textSecondary}
          autoCapitalize="words"
          returnKeyType="next"
        />

        {/* State */}
        <Text style={s.label}>
          {t('onboarding.state')}<Text style={s.required}> *</Text>
        </Text>
        <TextInput
          style={inp}
          value={state}
          onChangeText={setState}
          placeholder={t('onboarding.state_placeholder')}
          placeholderTextColor={Colors.textSecondary}
          autoCapitalize="characters"
          returnKeyType="next"
        />

        {/* Currency */}
        <Text style={s.label}>{t('onboarding.currency')}</Text>
        <Select
          value={currency}
          onValueChange={(v) => setCurrency(v)}
          items={currencies.map((c) => ({ label: c.label, value: c.code }))}
        />

        <Text style={s.label}>{t('onboarding.distance_unit')}</Text>
        <Select
          value={distUnit}
          onValueChange={(v) => setDistUnit(v as 'km' | 'mi')}
          items={[
            { label: t('onboarding.dist_km'), value: 'km' },
            { label: t('onboarding.dist_mi'), value: 'mi' },
          ]}
        />

        <Text style={s.label}>{t('onboarding.volume_unit')}</Text>
        <Select
          value={volUnit}
          onValueChange={(v) => setVolUnit(v as 'liters' | 'gallons')}
          items={[
            { label: t('onboarding.vol_liters'), value: 'liters' },
            { label: t('onboarding.vol_gallons'), value: 'gallons' },
          ]}
        />

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
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xl },
  title: { fontSize: 26, fontWeight: '700', color: Colors.textPrimary, marginBottom: Spacing.xl },
  label: {
    fontSize: 14, color: Colors.textSecondary,
    marginTop: Spacing.md, marginBottom: Spacing.xs,
  },
  required: { color: Colors.error },
  error: {
    color: Colors.error, fontSize: 14, marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceAlt, padding: Spacing.sm, borderRadius: Radius.input,
  },
  pillRow: { flexDirection: 'row', gap: Spacing.sm },
  pill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.surface, borderWidth: 2, borderColor: Colors.border,
    borderRadius: Radius.card, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.md,
  },
  pillActive: { borderColor: Colors.accent, backgroundColor: Colors.accentDim },
  pillIcon: { fontSize: 22 },
  pillText: { flex: 1, fontSize: 13, color: Colors.textSecondary, flexWrap: 'wrap' },
  pillTextActive: { color: Colors.accent, fontWeight: '600' },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.input, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: 15, minHeight: 48,
  },
  button: {
    backgroundColor: Colors.accent, borderRadius: Radius.button,
    alignItems: 'center', justifyContent: 'center',
    minHeight: 48, marginTop: Spacing.xl, paddingHorizontal: Spacing.lg,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: Colors.onBrand, fontSize: 16, fontWeight: '600' },
});
