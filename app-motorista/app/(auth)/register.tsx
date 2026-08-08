import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Switch,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Select } from '../../src/components/Select';
import { HtmlView } from '../../src/components/HtmlView';
import { getActiveLegalDocs, type LegalDoc } from '../../src/services/legal';
import { PRESET_PLATFORMS } from '../../src/services/platforms';
import {
  completeRegistration,
  type RegistrationInput,
  type RegistrationStep,
} from '../../src/services/completeRegistration';
import { emailsMatch } from '../../src/utils/emailConfirmationUtils';
import { decimalToCents } from '../../src/utils/currency';
import { displayToMeters } from '../../src/utils/units';
import { getAutoLocale, buildLocale, COUNTRY_DIAL, type SupportedLang } from '../../src/utils/autoLocale';
import { Colors, Radius, Spacing } from '../../src/theme';
import type { FuelType, OwnershipType, RentalAllowancePeriod, WorkerType } from '../../src/types';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// ─── Currency list (covers all major world regions) — ported from onboarding/locale.tsx
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

const COUNTRY_RE = /^[A-Za-z]{2}$/;

interface PartialFailure {
  userId: string;
  failedStep: RegistrationStep;
}

/**
 * Consolidated first-access registration.
 *
 * Replaces the old email+password-only screen AND the five sequential
 * `app/onboarding/*` steps with one form. Every field below is ported from the
 * screen named in its section comment; nothing is re-derived. Each section's
 * own `handleSave`/`router.push` is gone — all state feeds a single
 * `completeRegistration()` call at the bottom.
 */
export default function RegisterScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  // Auto-detect all settings from device locale — computed once on mount
  const auto = useMemo(() => getAutoLocale(), []);

  // ── Section 1: Conta ────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [emailConfirm, setEmailConfirm] = useState('');
  const [emailConfirmTouched, setEmailConfirmTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // ── Section 2: Perfil (ported from onboarding/locale.tsx) ───────────────
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
  // NEW field (per design spec): country was computed internally by locale.tsx
  // but never shown. Now visible + editable, pre-filled from the device locale.
  const [country, setCountry] = useState(auto.country);
  const [countryTouched, setCountryTouched] = useState(false);

  // ── Section 3: Veículo (ported from onboarding/vehicle.tsx) ─────────────
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('2020');
  const [fuelType, setFuelType] = useState<FuelType>('gasoline');
  const [consumption, setConsumption] = useState('12');
  const [consumptionTouched, setConsumptionTouched] = useState(false);
  const [ownership, setOwnership] = useState<OwnershipType>('own');
  const [monthlyCost, setMonthlyCost] = useState('0');
  const [insurance, setInsurance] = useState('0');
  const [isTaxi, setIsTaxi] = useState(false);
  const [taxiLicense, setTaxiLicense] = useState('0');
  const [odometer, setOdometer] = useState('0');
  const [rentalStartDate, setRentalStartDate] = useState('');
  const [rentalStartOdometer, setRentalStartOdometer] = useState('');
  const [allowancePeriod, setAllowancePeriod] = useState<RentalAllowancePeriod>('unlimited');
  const [allowanceAmount, setAllowanceAmount] = useState('');
  const [excessRate, setExcessRate] = useState('');

  // ── Section 4: Plataformas (ported from onboarding/platforms.tsx) ───────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customInput, setCustomInput] = useState('');
  const [customList, setCustomList] = useState<string[]>([]);

  // ── Section 5: Meta mensal (ported from onboarding/goal.tsx) ────────────
  const [goal, setGoal] = useState('');

  // ── Section 6: Termos (ported from onboarding/consent.tsx) ──────────────
  const [docs, setDocs] = useState<LegalDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsFailed, setDocsFailed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  // ── Submit / result ─────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const [partial, setPartial] = useState<PartialFailure | null>(null);

  const isMotoboy = workerType === 'motoboy';

  // Ensure auto-detected currency is always in the picker list
  const currencies = useMemo(() => {
    if (CURRENCIES_BASE.find(c => c.code === auto.currency_code)) return CURRENCIES_BASE;
    return [{ code: auto.currency_code, label: auto.currency_code }, ...CURRENCIES_BASE];
  }, [auto.currency_code]);

  // Live language preview — does NOT reset currency/units (those are country-based)
  useEffect(() => {
    i18n.changeLanguage(lang);
  }, [lang, i18n]);

  // vehicle.tsx read worker_type back from the DB to default a motoboy's
  // consumption to 30 km/L. Here worker type is chosen in the same form, so it
  // is wired directly — but never clobbers a value the driver already typed.
  useEffect(() => {
    if (consumptionTouched) return;
    setConsumption(workerType === 'motoboy' ? '30' : '12');
  }, [workerType, consumptionTouched]);

  // Deliberately NOT dependent on `t`/`i18n` — the language Select re-renders
  // this screen, and refetching here would reset the acceptance checkboxes.
  const loadDocs = useCallback(() => {
    setDocsLoading(true);
    setDocsFailed(false);
    getActiveLegalDocs()
      .then(d => {
        setDocs(d);
        // Preserve any acceptance the driver already gave across a reload.
        setAccepted(prev => {
          const next: Record<string, boolean> = {};
          d.forEach(doc => { next[doc.id] = prev[doc.id] ?? false; });
          return next;
        });
        // No active documents == nothing to consent to. Submitting in that
        // state would send an empty `legalDocs` array, which
        // completeRegistration silently skips — an LGPD hole. Treat it as a
        // load failure so the CTA stays disabled and the driver can retry.
        if (d.length === 0) setDocsFailed(true);
      })
      .catch(() => setDocsFailed(true))
      .finally(() => setDocsLoading(false));
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  // ── Platform helpers (ported verbatim from platforms.tsx) ───────────────
  function togglePreset(name: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function addCustom() {
    const name = customInput.trim();
    if (!name) return;
    setCustomList(prev => prev.includes(name) ? prev : [...prev, name]);
    setCustomInput('');
  }

  function removeCustom(name: string) {
    setCustomList(prev => prev.filter(n => n !== name));
  }

  // ── Consent helpers (ported verbatim from consent.tsx) ──────────────────
  function toggleExpand(id: string) {
    setExpanded(p => ({ ...p, [id]: !p[id] }));
  }

  function toggleAccept(id: string) {
    setAccepted(p => ({ ...p, [id]: !p[id] }));
  }

  // ── Validation ──────────────────────────────────────────────────────────
  const emailOk       = emailsMatch(email, emailConfirm);
  const passwordOk    = password.length >= 6;
  const countryOk     = COUNTRY_RE.test(country.trim());
  const profileOk     = !!fullName.trim() && !!phone.trim() && !!city.trim() && !!state.trim() && countryOk;
  const rentalOk      = ownership !== 'rent'
    ? true
    : !!rentalStartDate.trim() && !!rentalStartOdometer.trim()
      && (allowancePeriod === 'unlimited' || (!!allowanceAmount.trim() && !!excessRate.trim()));
  const vehicleOk     = !!brand.trim() && !!model.trim() && !!year.trim()
    && !!fuelType && !!consumption.trim() && !!ownership && rentalOk;
  // LGPD: every active legal document must be individually accepted. This is
  // the gate that guarantees `legalDocs` is neither empty nor partial by the
  // time completeRegistration() runs (its own consent step is skippable on an
  // empty array, so the UI is the only enforcement point).
  const allDocsAccepted = docs.length > 0 && docs.every(d => accepted[d.id] === true);

  const canSubmit = emailOk && passwordOk && profileOk && vehicleOk && allDocsAccepted;

  const showEmailMismatch = emailConfirmTouched && emailConfirm.length > 0 && !emailOk;
  const showPasswordError = password.length > 0 && !passwordOk;
  const showCountryError  = countryTouched && !countryOk;

  // ── Submit ──────────────────────────────────────────────────────────────
  function buildInput(): RegistrationInput {
    // Parsing below is copied verbatim from vehicle.tsx / goal.tsx, including
    // which fields do (and do not) accept a comma decimal separator.
    const kmPerLiter = parseFloat(consumption) || 1;
    const mlPer100km = Math.round((100 / kmPerLiter) * 1000);
    const parsedGoal = parseFloat(goal);
    const countryCode = country.trim().toUpperCase();

    return {
      email: email.trim(),
      password,
      profile: {
        name: fullName.trim(),
        phone: phone.trim(),
        city: city.trim(),
        state: state.trim(),
        country: countryCode,
        locale: buildLocale(lang, countryCode),
        currency_code: currency,
        distance_unit: distUnit,
        volume_unit: volUnit,
        timezone: auto.timezone,
        worker_type: workerType,
      },
      vehicle: {
        brand: brand.trim(),
        model: model.trim(),
        year: parseInt(year, 10) || new Date().getFullYear(),
        fuel_type: fuelType,
        avg_consumption_per_100: mlPer100km,
        ownership_type: ownership,
        monthly_cost_cents: decimalToCents(parseFloat(monthlyCost) || 0),
        monthly_insurance_cents: decimalToCents(parseFloat(insurance) || 0),
        current_odometer: displayToMeters(parseFloat(odometer) || 0, 'km'),
        is_taxi: isTaxi,
        taxi_license_monthly_cents: isTaxi ? decimalToCents(parseFloat(taxiLicense) || 0) : 0,
        rental_contract_start_date: ownership === 'rent' && rentalStartDate ? rentalStartDate : null,
        rental_contract_start_odometer: ownership === 'rent' && rentalStartOdometer
          ? displayToMeters(parseFloat(rentalStartOdometer.replace(',', '.')) || 0, 'km') : null,
        rental_km_allowance_period: ownership === 'rent' ? allowancePeriod : null,
        rental_km_allowance_amount: ownership === 'rent' && allowancePeriod !== 'unlimited' && allowanceAmount
          ? parseInt(allowanceAmount.replace(',', '.'), 10) : null,
        rental_km_excess_rate_cents: ownership === 'rent' && allowancePeriod !== 'unlimited' && excessRate
          ? decimalToCents(parseFloat(excessRate.replace(',', '.')) || 0) : null,
      },
      platforms: [...Array.from(selected), ...customList],
      monthlyGoalCents: goal && !isNaN(parsedGoal) && parsedGoal > 0 ? decimalToCents(parsedGoal) : null,
      // LGPD: only documents the driver individually checked are ever recorded.
      // Combined with the `allDocsAccepted` gate on both CTAs this can never be
      // empty nor a subset at call time.
      legalDocs: docs.filter(d => accepted[d.id] === true),
    };
  }

  async function runRegistration(resume?: { resumeUserId: string; resumeFromStep: RegistrationStep }) {
    setGeneralError('');
    setSubmitting(true);
    try {
      // On retry the input is rebuilt from CURRENT state, which is exactly the
      // state the driver left behind (nothing is cleared on failure). If they
      // corrected a field in the meantime the correction is picked up, which is
      // safe: resume only re-runs steps from `resumeFromStep` onward.
      const result = await completeRegistration(buildInput(), resume);

      if (result.status === 'success') {
        setPartial(null);
        router.replace('/(tabs)');
        return;
      }
      if (result.status === 'account_creation_failed') {
        // Nothing was created — safe to correct and resubmit from scratch.
        setPartial(null);
        setGeneralError(result.message);
        return;
      }
      // partial_failure: the account EXISTS. Never offer the plain submit path
      // again (it would re-run sign-up and fail with "already registered").
      setPartial({ userId: result.userId, failedStep: result.failedStep });
    } catch (err) {
      // completeRegistration is contractually non-throwing, but a bad parse in
      // buildInput() must not surface as an unhandled rejection.
      setGeneralError((err as Error)?.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  const handleSubmit = () => { if (canSubmit && !submitting) void runRegistration(); };
  // Retry re-checks the SAME gate as the first submit — the driver can keep
  // editing after a partial failure, so acceptance/required fields must still
  // hold before we resume.
  const handleRetry = () => {
    if (!partial || submitting || !canSubmit) return;
    void runRegistration({ resumeUserId: partial.userId, resumeFromStep: partial.failedStep });
  };

  const inp = s.input;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          {/* Hero — kept from the previous register.tsx */}
          <View style={s.hero}>
            <Image source={require('../../assets/images/icon.png')} style={s.logoImg} resizeMode="contain" />
            <Text style={s.wordmark}>PalDrivy</Text>
            <Text style={s.tagline}>{t('auth.register')}</Text>
          </View>

          {generalError ? (
            <View style={s.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
              <Text style={s.errorBannerText}>{generalError}</Text>
            </View>
          ) : null}

          {/* ── 1. Conta ───────────────────────────────────────────────── */}
          <Section icon="person-circle-outline" title={t('register.section_account')}>
            <Text style={s.label}>{t('auth.email')}<Text style={s.required}> *</Text></Text>
            <TextInput
              style={inp}
              value={email}
              onChangeText={setEmail}
              editable={!partial}
              autoCapitalize="none" autoCorrect={false}
              keyboardType="email-address" textContentType="emailAddress"
              placeholderTextColor={Colors.textSecondary} placeholder="seu@email.com"
              accessibilityLabel={t('auth.email')}
            />

            <Text style={s.label}>{t('register.email_confirm')}<Text style={s.required}> *</Text></Text>
            <TextInput
              style={[inp, showEmailMismatch ? s.inputErr : null]}
              value={emailConfirm}
              onChangeText={setEmailConfirm}
              onBlur={() => setEmailConfirmTouched(true)}
              editable={!partial}
              autoCapitalize="none" autoCorrect={false}
              keyboardType="email-address" textContentType="emailAddress"
              placeholderTextColor={Colors.textSecondary} placeholder="seu@email.com"
              accessibilityLabel={t('register.email_confirm')}
            />
            {showEmailMismatch ? <Text style={s.fieldError}>{t('register.email_mismatch')}</Text> : null}

            <Text style={s.label}>{t('auth.password')}<Text style={s.required}> *</Text></Text>
            <View style={s.passwordRow}>
              <TextInput
                style={[inp, s.passwordInput, showPasswordError ? s.inputErr : null]}
                value={password}
                onChangeText={setPassword}
                editable={!partial}
                secureTextEntry={!showPassword} textContentType="newPassword"
                placeholderTextColor={Colors.textSecondary} placeholder={t('auth.password_min')}
                accessibilityLabel={t('auth.password')}
              />
              <TouchableOpacity
                style={s.eyeBtn}
                onPress={() => setShowPassword(v => !v)}
                accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {showPasswordError ? <Text style={s.fieldError}>{t('auth.password_min')}</Text> : null}
          </Section>

          {/* ── 2. Perfil ──────────────────────────────────────────────── */}
          <Section icon="id-card-outline" title={t('register.section_profile')}>
            <Text style={s.label}>{t('onboarding.full_name')}<Text style={s.required}> *</Text></Text>
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

            <Text style={s.label}>{t('onboarding.phone')}<Text style={s.required}> *</Text></Text>
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

            <Text style={s.label}>{t('onboarding.country')}</Text>
            <Select
              value={lang}
              onValueChange={(v) => setLang(v as SupportedLang)}
              items={LANG_ITEMS}
            />

            {/* NEW field — country (ISO 3166-1 alpha-2), pre-filled + editable */}
            <Text style={s.label}>{t('register.country')}<Text style={s.required}> *</Text></Text>
            <TextInput
              style={[inp, showCountryError ? s.inputErr : null]}
              value={country}
              onChangeText={v => setCountry(v.toUpperCase())}
              onBlur={() => setCountryTouched(true)}
              placeholder={auto.country}
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={2}
              returnKeyType="next"
              accessibilityLabel={t('register.country')}
            />
            <Text style={showCountryError ? s.fieldError : s.hint}>
              {showCountryError ? t('register.country_invalid') : t('register.country_hint')}
            </Text>

            <Text style={s.label}>{t('onboarding.city')}<Text style={s.required}> *</Text></Text>
            <TextInput
              style={inp}
              value={city}
              onChangeText={setCity}
              placeholder={t('onboarding.city_placeholder')}
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="words"
              returnKeyType="next"
            />

            <Text style={s.label}>{t('onboarding.state')}<Text style={s.required}> *</Text></Text>
            <TextInput
              style={inp}
              value={state}
              onChangeText={setState}
              placeholder={t('onboarding.state_placeholder')}
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="characters"
              returnKeyType="next"
            />

            <Text style={s.label}>{t('onboarding.currency')}</Text>
            <Select
              value={currency}
              onValueChange={(v) => setCurrency(v)}
              items={currencies.map((c) => ({ label: c.label, value: c.code }))}
              searchable
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
          </Section>

          {/* ── 3. Veículo ─────────────────────────────────────────────── */}
          <Section
            icon={isMotoboy ? 'bicycle-outline' : 'car-outline'}
            title={t('register.section_vehicle')}
            subtitle={isMotoboy ? t('onboarding.moto_title') : t('onboarding.vehicle_title')}
          >
            <Text style={s.label}>{t('onboarding.brand')}<Text style={s.required}> *</Text></Text>
            <TextInput
              style={inp}
              value={brand}
              onChangeText={setBrand}
              autoCapitalize="words"
              placeholderTextColor={Colors.textSecondary}
              placeholder={isMotoboy ? 'Honda, Yamaha, Shineray...' : 'Toyota, Volkswagen, Fiat...'}
              accessibilityLabel={t('onboarding.brand')}
            />

            <Text style={s.label}>{t('onboarding.model')}<Text style={s.required}> *</Text></Text>
            <TextInput
              style={inp}
              value={model}
              onChangeText={setModel}
              autoCapitalize="words"
              placeholderTextColor={Colors.textSecondary}
              placeholder={isMotoboy ? 'Pop, Titan, Factor, Fazer...' : 'HB20, Argo, Gol, Onix...'}
              accessibilityLabel={t('onboarding.model')}
            />

            <Text style={s.label}>{t('onboarding.year')}<Text style={s.required}> *</Text></Text>
            <TextInput
              style={inp}
              value={year}
              onChangeText={setYear}
              keyboardType="numeric"
              placeholderTextColor={Colors.textSecondary}
              accessibilityLabel={t('onboarding.year')}
            />

            <Text style={s.label}>{t('onboarding.fuel_type')}<Text style={s.required}> *</Text></Text>
            <Select
              value={fuelType}
              onValueChange={(v) => setFuelType(v as FuelType)}
              items={[
                { label: t('onboarding.fuel_gasoline'), value: 'gasoline' },
                { label: t('onboarding.fuel_ethanol'), value: 'ethanol' },
                { label: t('onboarding.fuel_diesel'), value: 'diesel' },
                { label: t('onboarding.fuel_gnv'), value: 'gnv' },
                { label: t('onboarding.fuel_electric'), value: 'electric' },
                { label: t('onboarding.fuel_hybrid'), value: 'hybrid' },
              ]}
            />

            <Text style={s.label}>{t('onboarding.consumption')}<Text style={s.required}> *</Text></Text>
            <TextInput
              style={inp}
              value={consumption}
              onChangeText={v => { setConsumptionTouched(true); setConsumption(v); }}
              keyboardType="decimal-pad"
              placeholderTextColor={Colors.textSecondary}
              accessibilityLabel={t('onboarding.consumption')}
            />

            <Text style={s.label}>{t('onboarding.ownership')}<Text style={s.required}> *</Text></Text>
            <Select
              value={ownership}
              onValueChange={(v) => setOwnership(v as OwnershipType)}
              items={[
                { label: t('onboarding.ownership_own'), value: 'own' },
                { label: t('onboarding.ownership_rent'), value: 'rent' },
                { label: t('onboarding.ownership_financed'), value: 'financed' },
              ]}
            />

            {ownership === 'rent' ? (
              <>
                <Text style={s.label}>{t('onboarding.rental_start_date')}<Text style={s.required}> *</Text></Text>
                <TextInput
                  style={inp}
                  value={rentalStartDate}
                  onChangeText={setRentalStartDate}
                  placeholder="AAAA-MM-DD"
                  placeholderTextColor={Colors.textSecondary}
                  accessibilityLabel={t('onboarding.rental_start_date')}
                />

                <Text style={s.label}>{t('onboarding.rental_start_odometer')}<Text style={s.required}> *</Text></Text>
                <TextInput
                  style={inp}
                  value={rentalStartOdometer}
                  onChangeText={setRentalStartOdometer}
                  keyboardType="numeric"
                  placeholder={t('onboarding.rental_start_odometer_placeholder')}
                  placeholderTextColor={Colors.textSecondary}
                  accessibilityLabel={t('onboarding.rental_start_odometer')}
                />

                <Text style={s.label}>{t('onboarding.allowance_period')}</Text>
                <Select
                  value={allowancePeriod}
                  onValueChange={(v) => setAllowancePeriod(v as RentalAllowancePeriod)}
                  items={[
                    { label: t('onboarding.allowance_weekly'), value: 'weekly' },
                    { label: t('onboarding.allowance_monthly'), value: 'monthly' },
                    { label: t('onboarding.allowance_unlimited'), value: 'unlimited' },
                  ]}
                />

                {allowancePeriod !== 'unlimited' ? (
                  <>
                    <Text style={s.label}>{t('onboarding.allowance_amount')}<Text style={s.required}> *</Text></Text>
                    <TextInput
                      style={inp}
                      value={allowanceAmount}
                      onChangeText={setAllowanceAmount}
                      keyboardType="numeric"
                      placeholderTextColor={Colors.textSecondary}
                      accessibilityLabel={t('onboarding.allowance_amount')}
                    />

                    <Text style={s.label}>{t('onboarding.excess_rate')}<Text style={s.required}> *</Text></Text>
                    <TextInput
                      style={inp}
                      value={excessRate}
                      onChangeText={setExcessRate}
                      keyboardType="decimal-pad"
                      placeholderTextColor={Colors.textSecondary}
                      accessibilityLabel={t('onboarding.excess_rate')}
                    />
                  </>
                ) : null}
              </>
            ) : null}

            <Text style={s.label}>{t('onboarding.monthly_cost')}</Text>
            <TextInput
              style={inp}
              value={monthlyCost}
              onChangeText={setMonthlyCost}
              keyboardType="decimal-pad"
              placeholderTextColor={Colors.textSecondary}
              accessibilityLabel={t('onboarding.monthly_cost')}
            />

            <Text style={s.label}>{t('onboarding.insurance')}</Text>
            <TextInput
              style={inp}
              value={insurance}
              onChangeText={setInsurance}
              keyboardType="decimal-pad"
              placeholderTextColor={Colors.textSecondary}
              accessibilityLabel={t('onboarding.insurance')}
            />

            <Text style={s.label}>{t('onboarding.odometer_current')}</Text>
            <TextInput
              style={inp}
              value={odometer}
              onChangeText={setOdometer}
              keyboardType="numeric"
              placeholderTextColor={Colors.textSecondary}
              accessibilityLabel={t('onboarding.odometer_current')}
            />

            <View style={s.switchRow}>
              <Text style={[s.label, s.switchLabel]}>{t('onboarding.is_taxi')}</Text>
              <Switch
                value={isTaxi}
                onValueChange={setIsTaxi}
                trackColor={{ false: Colors.border, true: Colors.brandBlue }}
                thumbColor={Colors.onBrand}
              />
            </View>

            {isTaxi ? (
              <>
                <Text style={s.label}>{t('onboarding.taxi_license')}</Text>
                <TextInput
                  style={inp}
                  value={taxiLicense}
                  onChangeText={setTaxiLicense}
                  keyboardType="decimal-pad"
                  placeholderTextColor={Colors.textSecondary}
                  accessibilityLabel={t('onboarding.taxi_license')}
                />
              </>
            ) : null}
          </Section>

          {/* ── 4. Plataformas (optional) ──────────────────────────────── */}
          <Section
            icon="apps-outline"
            title={t('register.section_platforms')}
            subtitle={t('onboarding.platforms_subtitle')}
          >
            <View style={s.grid}>
              {PRESET_PLATFORMS.map(name => {
                const active = selected.has(name);
                return (
                  <TouchableOpacity
                    key={name}
                    style={[s.chip, active && s.chipActive]}
                    onPress={() => togglePreset(name)}
                    activeOpacity={0.7}
                  >
                    {active && <Ionicons name="checkmark" size={14} color={Colors.accent} style={{ marginRight: 4 }} />}
                    <Text style={[s.chipText, active && s.chipTextActive]}>{name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {customList.map(name => (
              <View key={name} style={s.customRow}>
                <Ionicons name="apps-outline" size={14} color={Colors.accent} style={{ marginRight: 6 }} />
                <Text style={s.customName}>{name}</Text>
                <TouchableOpacity onPress={() => removeCustom(name)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ))}

            <Text style={s.label}>{t('onboarding.platforms_other')}</Text>
            <View style={s.addRow}>
              <TextInput
                style={[inp, s.addInput]}
                value={customInput}
                onChangeText={setCustomInput}
                placeholder={t('onboarding.platforms_add_placeholder')}
                placeholderTextColor={Colors.textSecondary}
                autoCapitalize="words"
                onSubmitEditing={addCustom}
                returnKeyType="done"
              />
              <TouchableOpacity style={s.addBtn} onPress={addCustom}>
                <Ionicons name="add" size={20} color={Colors.onAccent} />
              </TouchableOpacity>
            </View>
          </Section>

          {/* ── 5. Meta mensal (optional) ──────────────────────────────── */}
          <Section icon="flag-outline" title={t('register.section_goal')}>
            <Text style={s.label}>{t('onboarding.goal_title')}</Text>
            <TextInput
              style={inp}
              placeholder={t('onboarding.goal_placeholder')}
              placeholderTextColor={Colors.textSecondary}
              value={goal}
              onChangeText={setGoal}
              keyboardType="decimal-pad"
              accessibilityLabel={t('onboarding.goal_title')}
            />
          </Section>

          {/* ── 6. Termos — LGPD: one explicit checkbox per document ───── */}
          <View style={[s.section, s.sectionLegal]}>
            <View style={s.sectionHeader}>
              <View style={[s.sectionIcon, s.sectionIconLegal]}>
                <Ionicons name="shield-checkmark-outline" size={18} color={Colors.accent} />
              </View>
              <View style={s.sectionHeaderText}>
                <Text style={s.sectionTitle}>{t('register.section_terms')}</Text>
                <Text style={s.sectionSubtitle}>{t('consent.subtitle')}</Text>
              </View>
            </View>

            <View style={s.sectionBody}>
              {docsLoading ? (
                <ActivityIndicator color={Colors.accent} style={{ marginVertical: Spacing.md }} />
              ) : docsFailed ? (
                <>
                  <View style={s.errorBanner}>
                    <Ionicons name="alert-circle-outline" size={15} color={Colors.error} />
                    <Text style={s.errorBannerText}>{t('consent.error')}</Text>
                  </View>
                  <TouchableOpacity style={s.reloadBtn} onPress={loadDocs} accessibilityRole="button">
                    <Ionicons name="refresh-outline" size={16} color={Colors.accent} />
                    <Text style={s.reloadText}>{t('register.docs_reload')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                docs.map(doc => (
                  <View key={doc.id} style={s.docCard}>
                    <TouchableOpacity
                      style={s.docHeader}
                      onPress={() => toggleExpand(doc.id)}
                      accessibilityRole="button"
                    >
                      <Ionicons
                        name={doc.type === 'privacy_policy' ? 'lock-closed-outline' : 'document-text-outline'}
                        size={18} color={Colors.accent}
                      />
                      <Text style={s.docTitle}>{doc.title}</Text>
                      <Text style={s.docVersion}>v{doc.version}</Text>
                      <Ionicons
                        name={expanded[doc.id] ? 'chevron-up' : 'chevron-down'}
                        size={16} color={Colors.textSecondary}
                        style={{ marginLeft: 'auto' }}
                      />
                    </TouchableOpacity>

                    {expanded[doc.id] && (
                      <View style={s.docContent}>
                        <HtmlView html={doc.content} maxHeight={Platform.OS === 'web' ? 260 : 220} />
                      </View>
                    )}

                    <TouchableOpacity
                      style={s.checkRow}
                      onPress={() => toggleAccept(doc.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: !!accepted[doc.id] }}
                    >
                      <View style={[s.checkbox, accepted[doc.id] && s.checkboxChecked]}>
                        {accepted[doc.id] && <Ionicons name="checkmark" size={14} color={Colors.onAccent} />}
                      </View>
                      <Text style={s.checkLabel}>
                        {doc.type === 'privacy_policy' ? t('consent.accept_privacy') : t('consent.accept_terms')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}

              {!docsLoading && !docsFailed && !allDocsAccepted ? (
                <Text style={s.hint}>{t('consent.must_accept')}</Text>
              ) : null}
            </View>
          </View>

          {/* ── Partial failure: the account already exists ────────────── */}
          {partial ? (
            <View style={s.partialBanner}>
              <Ionicons name="sync-outline" size={18} color={Colors.brandBlue} />
              <Text style={s.partialText}>
                {t('register.partial_failure', { step: t(`register.step_${partial.failedStep}`) })}
              </Text>
            </View>
          ) : null}

          {/* ── Submit / Retry ─────────────────────────────────────────── */}
          {partial ? (
            <>
              <TouchableOpacity
                style={[s.cta, (!canSubmit || submitting) && s.ctaDisabled]}
                onPress={handleRetry}
                disabled={!canSubmit || submitting}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit || submitting }}
                accessibilityLabel={t('register.retry')}
              >
                {submitting
                  ? <ActivityIndicator color={Colors.onAccent} />
                  : <Text style={s.ctaText}>{t('register.retry')}</Text>}
              </TouchableOpacity>
              {!canSubmit ? <Text style={s.ctaHint}>{t('register.missing_required')}</Text> : null}
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[s.cta, (!canSubmit || submitting) && s.ctaDisabled]}
                onPress={handleSubmit}
                disabled={!canSubmit || submitting}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit || submitting }}
                accessibilityLabel={t('auth.register')}
              >
                {submitting
                  ? <ActivityIndicator color={Colors.onAccent} />
                  : <Text style={s.ctaText}>{t('auth.register')}</Text>}
              </TouchableOpacity>
              {!canSubmit ? <Text style={s.ctaHint}>{t('register.missing_required')}</Text> : null}
            </>
          )}

          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>ou</Text>
            <View style={s.dividerLine} />
          </View>

          <TouchableOpacity style={s.secondaryBtn} onPress={() => router.back()} accessibilityRole="button">
            <Text style={s.secondaryBtnText}>{t('auth.have_account')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ icon, title, subtitle, children }: {
  icon: IoniconName;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <View style={s.sectionIcon}>
          <Ionicons name={icon} size={18} color={Colors.accent} />
        </View>
        <View style={s.sectionHeaderText}>
          <Text style={s.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={s.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      <View style={s.sectionBody}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xl,
    maxWidth: 520, alignSelf: 'center', width: '100%',
  },

  hero: { alignItems: 'center', marginBottom: Spacing.xl },
  logoImg: { width: 96, height: 96, borderRadius: 22, marginBottom: Spacing.sm },
  wordmark: {
    color: Colors.textPrimary, fontSize: 28, fontWeight: '800',
    letterSpacing: -0.5, marginBottom: 4,
  },
  tagline: { fontSize: 14, color: Colors.textSecondary },

  // Section cards
  section: {
    backgroundColor: Colors.surface, borderRadius: Radius.card,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: Spacing.md, overflow: 'hidden',
  },
  sectionLegal: { borderColor: Colors.accent, borderWidth: 1.5 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  sectionHeaderText: { flex: 1 },
  sectionIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.accentDim,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionIconLegal: { backgroundColor: Colors.accentGlow },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  sectionSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  sectionBody: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },

  label: {
    fontSize: 14, color: Colors.textSecondary,
    marginTop: Spacing.md, marginBottom: Spacing.xs,
  },
  required: { color: Colors.error },
  hint: { fontSize: 12, color: Colors.textSecondary, marginTop: Spacing.xs },
  input: {
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.input, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4, fontSize: 16, color: Colors.textPrimary, minHeight: 48,
  },
  inputErr: { borderColor: Colors.error },
  fieldError: { color: Colors.error, fontSize: 12, marginTop: Spacing.xs },

  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 48 },
  eyeBtn: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', width: 44 },

  pillRow: { flexDirection: 'row', gap: Spacing.sm },
  pill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.background, borderWidth: 2, borderColor: Colors.border,
    borderRadius: Radius.card, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.md,
  },
  pillActive: { borderColor: Colors.accent, backgroundColor: Colors.accentDim },
  pillIcon: { fontSize: 22 },
  pillText: { flex: 1, fontSize: 13, color: Colors.textSecondary, flexWrap: 'wrap' },
  pillTextActive: { color: Colors.accent, fontWeight: '600' },

  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
  switchLabel: { marginTop: 0, marginBottom: 0 },

  // Platforms
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: Spacing.md, marginBottom: Spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  chipActive: { borderColor: Colors.accent, backgroundColor: Colors.accentDim },
  chipText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: Colors.accent },
  customRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.background,
    borderRadius: Radius.input, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, marginBottom: Spacing.xs,
  },
  customName: { flex: 1, color: Colors.textPrimary, fontSize: 14 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addInput: { flex: 1 },
  addBtn: {
    width: 48, height: 48, borderRadius: Radius.input, backgroundColor: Colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },

  // Legal docs (structure ported from consent.tsx)
  docCard: {
    backgroundColor: Colors.background, borderRadius: Radius.card,
    borderWidth: 1, borderColor: Colors.border,
    marginTop: Spacing.md, overflow: 'hidden',
  },
  docHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  docTitle: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary, flex: 1 },
  docVersion: {
    fontSize: 11, color: Colors.textSecondary,
    backgroundColor: Colors.surfaceAlt, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  docContent: {
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingTop: Spacing.md,
  },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.accentGlow,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    borderColor: Colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  checkLabel: { fontSize: 14, color: Colors.textPrimary, flex: 1 },
  reloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    borderWidth: 1, borderColor: Colors.accent, borderRadius: Radius.button,
    minHeight: 44, marginTop: Spacing.xs,
  },
  reloadText: { color: Colors.accent, fontSize: 14, fontWeight: '600' },

  // Banners
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.errorBg, borderRadius: Radius.input,
    padding: Spacing.sm + 4, marginBottom: Spacing.md, marginTop: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
  },
  errorBannerText: { color: Colors.error, fontSize: 14, flex: 1 },
  partialBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.brandBlueLight, borderRadius: Radius.input,
    padding: Spacing.sm + 4, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.brandBlue,
  },
  partialText: { color: Colors.textPrimary, fontSize: 14, flex: 1 },

  // CTA
  cta: {
    backgroundColor: Colors.accent, borderRadius: Radius.button,
    alignItems: 'center', justifyContent: 'center', minHeight: 56,
    marginTop: Spacing.sm,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: Colors.onAccent, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  ctaHint: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: Spacing.sm },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: Spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { color: Colors.textSecondary, fontSize: 13, marginHorizontal: Spacing.sm },

  secondaryBtn: {
    borderRadius: Radius.button, borderWidth: 1.5, borderColor: Colors.borderBright,
    alignItems: 'center', justifyContent: 'center', minHeight: 52,
  },
  secondaryBtnText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
});
