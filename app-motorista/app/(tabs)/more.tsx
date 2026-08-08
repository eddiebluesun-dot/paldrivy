import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/src/lib/supabase';
import { authSignOut } from '@/src/hooks/useAuth';
import { useProfile } from '@/src/hooks/useProfile';
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { upsertProfile } from '@/src/services/profile';
import { createVehicle, updateVehicle } from '@/src/services/vehicles';
import { createStripeCheckout } from '@/src/services/stripe';
import { centsToDecimal, decimalToCents } from '@/src/utils/currency';
import { displayToMeters, metersToDisplay } from '@/src/utils/units';
import { Colors, Radius, Spacing } from '@/src/theme';
import type { FuelType, OwnershipType, RentalAllowancePeriod, Vehicle, WorkerType } from '@/src/types';
import {
  getNotificationsEnabled, setNotificationsEnabled,
  getDailyReminderTime, saveDailyReminderTime,
  getNotifWeekdays, saveNotifWeekdays,
  scheduleAllNotifications, cancelAllNotifications,
  scheduleDailyReminder, registerPushToken,
} from '@/src/services/notifications';
import { getUserPlatforms, saveUserPlatforms, PRESET_PLATFORMS } from '@/src/services/platforms';
import { exportShiftsCSV, exportLGPDJson } from '@/src/services/export';
import {
  useBiometricAvailable,
  getBiometricEnabled, setBiometricEnabled,
} from '@/src/hooks/useBiometric';
import {
  getCreditCards, createCreditCard, updateCreditCard, deleteCreditCard,
  nextOccurrence, type CreditCard, type CreditCardInput,
} from '@/src/services/creditCards';
import { TourOverlay } from '@/src/components/TourOverlay';
import { TOUR_STEPS } from '@/src/tour/steps';

// ─── Constants ────────────────────────────────────────────────────────────────

const CURRENCIES = [
  // Américas
  { code: 'BRL', label: 'BRL — Real brasileiro (R$)' },
  { code: 'USD', label: 'USD — US Dollar ($)' },
  { code: 'CAD', label: 'CAD — Canadian Dollar (CA$)' },
  { code: 'MXN', label: 'MXN — Peso mexicano ($)' },
  { code: 'ARS', label: 'ARS — Peso argentino ($)' },
  { code: 'CLP', label: 'CLP — Peso chileno ($)' },
  { code: 'COP', label: 'COP — Peso colombiano ($)' },
  { code: 'PEN', label: 'PEN — Sol peruano (S/)' },
  { code: 'UYU', label: 'UYU — Peso uruguayo ($U)' },
  { code: 'PYG', label: 'PYG — Guaraní paraguayo (₲)' },
  { code: 'BOB', label: 'BOB — Boliviano (Bs.)' },
  { code: 'DOP', label: 'DOP — Peso dominicano (RD$)' },
  { code: 'GTQ', label: 'GTQ — Quetzal guatemalteco (Q)' },
  { code: 'CRC', label: 'CRC — Colón costarricense (₡)' },
  { code: 'HNL', label: 'HNL — Lempira hondureño (L)' },
  { code: 'NIO', label: 'NIO — Córdoba nicaragüense (C$)' },
  { code: 'PAB', label: 'PAB — Balboa panameño (B/.)' },
  // Europa
  { code: 'EUR', label: 'EUR — Euro (€)' },
  { code: 'GBP', label: 'GBP — British Pound (£)' },
  { code: 'CHF', label: 'CHF — Swiss Franc (CHF)' },
  { code: 'NOK', label: 'NOK — Norwegian Krone (kr)' },
  { code: 'SEK', label: 'SEK — Swedish Krona (kr)' },
  { code: 'DKK', label: 'DKK — Danish Krone (kr)' },
  { code: 'PLN', label: 'PLN — Polish Zloty (zł)' },
  { code: 'CZK', label: 'CZK — Czech Koruna (Kč)' },
  { code: 'HUF', label: 'HUF — Hungarian Forint (Ft)' },
  { code: 'RON', label: 'RON — Romanian Leu (lei)' },
  { code: 'TRY', label: 'TRY — Turkish Lira (₺)' },
  { code: 'RUB', label: 'RUB — Russian Ruble (₽)' },
  { code: 'UAH', label: 'UAH — Ukrainian Hryvnia (₴)' },
  // Ásia / Oceania
  { code: 'JPY', label: 'JPY — Japanese Yen (¥)' },
  { code: 'CNY', label: 'CNY — Chinese Yuan (¥)' },
  { code: 'INR', label: 'INR — Indian Rupee (₹)' },
  { code: 'KRW', label: 'KRW — South Korean Won (₩)' },
  { code: 'SGD', label: 'SGD — Singapore Dollar (S$)' },
  { code: 'HKD', label: 'HKD — Hong Kong Dollar (HK$)' },
  { code: 'AUD', label: 'AUD — Australian Dollar (A$)' },
  { code: 'NZD', label: 'NZD — New Zealand Dollar (NZ$)' },
  { code: 'THB', label: 'THB — Thai Baht (฿)' },
  { code: 'IDR', label: 'IDR — Indonesian Rupiah (Rp)' },
  { code: 'MYR', label: 'MYR — Malaysian Ringgit (RM)' },
  { code: 'PHP', label: 'PHP — Philippine Peso (₱)' },
  { code: 'VND', label: 'VND — Vietnamese Dong (₫)' },
  { code: 'TWD', label: 'TWD — New Taiwan Dollar (NT$)' },
  { code: 'PKR', label: 'PKR — Pakistani Rupee (₨)' },
  { code: 'BDT', label: 'BDT — Bangladeshi Taka (৳)' },
  // Oriente Médio / África
  { code: 'AED', label: 'AED — UAE Dirham (د.إ)' },
  { code: 'SAR', label: 'SAR — Saudi Riyal (﷼)' },
  { code: 'QAR', label: 'QAR — Qatari Riyal (﷼)' },
  { code: 'ILS', label: 'ILS — Israeli Shekel (₪)' },
  { code: 'ZAR', label: 'ZAR — South African Rand (R)' },
  { code: 'NGN', label: 'NGN — Nigerian Naira (₦)' },
  { code: 'EGP', label: 'EGP — Egyptian Pound (£)' },
  { code: 'KES', label: 'KES — Kenyan Shilling (Ksh)' },
  { code: 'GHS', label: 'GHS — Ghanaian Cedi (₵)' },
  { code: 'MAD', label: 'MAD — Moroccan Dirham (MAD)' },
];

type LangCode = 'pt' | 'en' | 'en-GB' | 'es' | 'fr' | 'zh';

const LANG_ITEMS = [
  { label: 'Português (BR)', value: 'pt' },
  { label: 'English (US)',   value: 'en' },
  { label: 'English (UK)',   value: 'en-GB' },
  { label: 'Español',        value: 'es' },
  { label: 'Français',       value: 'fr' },
  { label: '中文 (简体)',      value: 'zh' },
];


const FUEL_TYPES: FuelType[] = ['gasoline', 'ethanol', 'diesel', 'gnv', 'electric', 'hybrid'];
const OWNERSHIP_TYPES: OwnershipType[] = ['own', 'rent', 'financed'];
const ALLOWANCE_PERIODS: RentalAllowancePeriod[] = ['weekly', 'monthly', 'unlimited'];

// ─── Quick Picker Modal ───────────────────────────────────────────────────────

function QuickPickerModal({ visible, title, items, value, onSelect, onClose, searchable }: {
  visible: boolean;
  title: string;
  items: { label: string; value: string }[];
  value: string;
  onSelect: (val: string) => void;
  onClose: () => void;
  searchable?: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState('');
  React.useEffect(() => { if (!visible) setSearch(''); }, [visible]);

  const filtered = searchable && search.length > 0
    ? items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
        <View style={s.pickerHeader}>
          <Text style={s.pickerTitle}>{title}</Text>
        </View>
        {searchable && (
          <View style={s.searchRow}>
            <Ionicons name="search-outline" size={16} color={Colors.textSecondary} style={{ marginRight: 8 }} />
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={t('more.search_currency')}
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}
        <ScrollView keyboardShouldPersistTaps="handled">
          {filtered.length === 0 && (
            <Text style={{ color: Colors.textSecondary, textAlign: 'center', marginTop: 32, fontSize: 14 }}>{t('more.no_results')}</Text>
          )}
          {filtered.map((item, idx) => (
            <TouchableOpacity
              key={item.value}
              style={[s.pickerRow, idx < filtered.length - 1 && { borderBottomWidth: 1, borderBottomColor: Colors.border }]}
              activeOpacity={0.7}
              onPress={() => { onSelect(item.value); onClose(); }}
            >
              <Text style={[s.pickerRowLabel, value === item.value && { color: Colors.accent, fontWeight: '700' }]}>
                {item.label}
              </Text>
              {value === item.value ? <Ionicons name="checkmark" size={20} color={Colors.accent} /> : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
          <Text style={s.cancelBtnText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Location Modal ───────────────────────────────────────────────────────────

function LocationModal({ visible, profile, onSaved, onClose }: {
  visible: boolean;
  profile: any;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [city,    setCity]    = useState<string>(profile?.city  ?? '');
  const [state,   setState]   = useState<string>(profile?.state ?? '');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (visible) { setCity(profile?.city ?? ''); setState(profile?.state ?? ''); setError(''); }
  }, [visible, profile]);

  async function handleSave() {
    if (!city.trim() || !state.trim()) {
      setError(`${t('common.required')}: ${t('onboarding.city')} / ${t('onboarding.state')}`);
      return;
    }
    setSaving(true); setError('');
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error();
      await upsertProfile({ id: data.user.id, city: city.trim(), state: state.trim() });
      onSaved();
    } catch { setError(t('common.error')); }
    finally { setSaving(false); }
  }

  const inp = [s.fieldInput, { color: Colors.textPrimary }] as any;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.modalFlex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={s.modalScroll} contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={s.modalTitle}>{t('more.location')}</Text>
          {error ? <View style={s.errorBanner}><Text style={s.errorBannerText}>{error}</Text></View> : null}

          <Text style={s.fieldLabel}>{t('onboarding.city')}<Text style={s.required}> *</Text></Text>
          <TextInput style={inp} value={city} onChangeText={setCity}
            placeholder={t('onboarding.city_placeholder')} placeholderTextColor={Colors.textSecondary}
            autoCapitalize="words" />

          <Text style={s.fieldLabel}>{t('onboarding.state')}<Text style={s.required}> *</Text></Text>
          <TextInput style={inp} value={state} onChangeText={setState}
            placeholder={t('onboarding.state_placeholder')} placeholderTextColor={Colors.textSecondary}
            autoCapitalize="characters" />

          <TouchableOpacity style={[s.saveBtn, saving && s.btnDisabled]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={Colors.onAccent} /> : <Text style={s.saveBtnText}>{t('common.save')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelBtnText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Settings row helper ──────────────────────────────────────────────────────

function SettingsRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={onPress}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.rowRight}>
        <Text style={s.rowValue}>{value}</Text>
        <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Vehicle Modal ────────────────────────────────────────────────────────────

function VehicleModal({ visible, vehicle, userId, onSaved, onClose }: {
  visible: boolean; vehicle: Vehicle | null; userId: string | null; onSaved: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [brand, setBrand]           = useState('');
  const [model, setModel]           = useState('');
  const [year, setYear]             = useState('');
  const [fuel, setFuel]             = useState<FuelType>('gasoline');
  const [consumption, setConsumption] = useState('');
  const [ownership, setOwnership]   = useState<OwnershipType>('own');
  const [rentalStartDate, setRentalStartDate]         = useState('');
  const [rentalStartOdometer, setRentalStartOdometer] = useState('');
  const [allowancePeriod, setAllowancePeriod]         = useState<RentalAllowancePeriod>('unlimited');
  const [allowanceAmount, setAllowanceAmount]         = useState('');
  const [excessRate, setExcessRate]                   = useState('');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    if (visible && vehicle) {
      setBrand(vehicle.brand); setModel(vehicle.model);
      setYear(String(vehicle.year)); setFuel(vehicle.fuel_type);
      const kmPerL = vehicle.avg_consumption_per_100 > 0 ? (100000 / vehicle.avg_consumption_per_100).toFixed(1) : '';
      setConsumption(kmPerL);
      setOwnership(vehicle.ownership_type);
      setRentalStartDate(vehicle.rental_contract_start_date ?? '');
      setRentalStartOdometer(
        vehicle.rental_contract_start_odometer != null
          ? String(metersToDisplay(vehicle.rental_contract_start_odometer, 'km'))
          : ''
      );
      setAllowancePeriod(vehicle.rental_km_allowance_period ?? 'unlimited');
      setAllowanceAmount(vehicle.rental_km_allowance_amount != null ? String(vehicle.rental_km_allowance_amount) : '');
      setExcessRate(vehicle.rental_km_excess_rate_cents != null ? String(centsToDecimal(vehicle.rental_km_excess_rate_cents)) : '');
    } else if (visible && !vehicle) {
      setBrand(''); setModel(''); setYear(String(new Date().getFullYear()));
      setFuel('gasoline'); setConsumption('');
      setOwnership('own');
      setRentalStartDate(''); setRentalStartOdometer('');
      setAllowancePeriod('unlimited'); setAllowanceAmount(''); setExcessRate('');
    }
  }, [visible, vehicle]);

  async function handleSave() {
    if (!userId || !brand.trim() || !model.trim()) { setError(t('more.vehicle_required')); return; }
    if (ownership === 'rent' && allowancePeriod !== 'unlimited' && !rentalStartDate.trim()) { setError(t('more.vehicle_required')); return; }
    const kmPerLiter = parseFloat(consumption.replace(',', '.')) || 0;
    const mlPer100km = kmPerLiter > 0 ? Math.round((100 / kmPerLiter) * 1000) : 0;
    const rentalFields = {
      ownership_type: ownership,
      rental_contract_start_date: ownership === 'rent' && rentalStartDate ? rentalStartDate : null,
      rental_contract_start_odometer: ownership === 'rent' && rentalStartOdometer
        ? displayToMeters(parseFloat(rentalStartOdometer.replace(',', '.')) || 0, 'km') : null,
      rental_km_allowance_period: ownership === 'rent' ? allowancePeriod : null,
      rental_km_allowance_amount: ownership === 'rent' && allowancePeriod !== 'unlimited' && allowanceAmount
        ? parseInt(allowanceAmount.replace(',', '.'), 10) : null,
      rental_km_excess_rate_cents: ownership === 'rent' && allowancePeriod !== 'unlimited' && excessRate
        ? decimalToCents(parseFloat(excessRate.replace(',', '.')) || 0) : null,
    };
    setSaving(true); setError('');
    try {
      if (vehicle) {
        await updateVehicle(vehicle.id, { brand: brand.trim(), model: model.trim(), year: parseInt(year) || vehicle.year, fuel_type: fuel, avg_consumption_per_100: mlPer100km, ...rentalFields });
      } else {
        const newVehicle = await createVehicle({ user_id: userId, name: `${brand.trim()} ${model.trim()}`, brand: brand.trim(), model: model.trim(), year: parseInt(year) || new Date().getFullYear(), fuel_type: fuel, avg_consumption_per_100: mlPer100km, monthly_cost_cents: 0, monthly_insurance_cents: 0, current_odometer: 0, is_taxi: false, taxi_license_monthly_cents: 0, ...rentalFields });
        await upsertProfile({ id: userId, vehicle_id: newVehicle.id });
      }
      onSaved();
    } catch { setError(t('more.vehicle_error')); }
    finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.modalFlex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={s.modalScroll} contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={s.modalTitle}>{vehicle ? t('more.vehicle_edit') : t('more.vehicle_add')}</Text>
          {error ? <View style={s.errorBanner}><Text style={s.errorBannerText}>{error}</Text></View> : null}
          <Text style={s.fieldLabel}>{t('more.vehicle_brand')}</Text>
          <TextInput style={s.fieldInput} value={brand} onChangeText={setBrand} autoCapitalize="words" placeholderTextColor={Colors.textSecondary} placeholder="Ex: Toyota" />
          <Text style={s.fieldLabel}>{t('more.vehicle_model')}</Text>
          <TextInput style={s.fieldInput} value={model} onChangeText={setModel} autoCapitalize="words" placeholderTextColor={Colors.textSecondary} placeholder="Ex: Corolla" />
          <Text style={s.fieldLabel}>{t('more.vehicle_year')}</Text>
          <TextInput style={s.fieldInput} value={year} onChangeText={setYear} keyboardType="numeric" placeholderTextColor={Colors.textSecondary} placeholder="2020" />
          <Text style={s.fieldLabel}>{t('more.vehicle_fuel')}</Text>
          <View style={s.fuelGrid}>
            {FUEL_TYPES.map(fuelType => (
              <TouchableOpacity key={fuelType} style={[s.fuelOption, fuel === fuelType && s.fuelOptionActive]} onPress={() => setFuel(fuelType)}>
                <Text style={[s.fuelOptionText, fuel === fuelType && { color: Colors.accent }]}>{t(`onboarding.fuel_${fuelType}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.fieldLabel}>{t('more.vehicle_consumption')}</Text>
          <TextInput style={s.fieldInput} value={consumption} onChangeText={setConsumption} keyboardType="decimal-pad" placeholderTextColor={Colors.textSecondary} placeholder="Ex: 12,5" />

          <Text style={s.fieldLabel}>{t('onboarding.ownership')}</Text>
          <View style={s.fuelGrid}>
            {OWNERSHIP_TYPES.map(o => (
              <TouchableOpacity key={o} style={[s.fuelOption, ownership === o && s.fuelOptionActive]} onPress={() => setOwnership(o)}>
                <Text style={[s.fuelOptionText, ownership === o && { color: Colors.accent }]}>{t(`onboarding.ownership_${o}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {ownership === 'rent' ? (
            <>
              <Text style={s.fieldLabel}>{t('onboarding.rental_start_date')}</Text>
              <TextInput
                style={s.fieldInput}
                value={rentalStartDate}
                onChangeText={setRentalStartDate}
                placeholder="AAAA-MM-DD"
                placeholderTextColor={Colors.textSecondary}
                accessibilityLabel={t('onboarding.rental_start_date')}
              />

              <Text style={s.fieldLabel}>{t('onboarding.rental_start_odometer')}</Text>
              <TextInput
                style={s.fieldInput}
                value={rentalStartOdometer}
                onChangeText={setRentalStartOdometer}
                keyboardType="numeric"
                placeholder={t('onboarding.rental_start_odometer_placeholder')}
                placeholderTextColor={Colors.textSecondary}
                accessibilityLabel={t('onboarding.rental_start_odometer')}
              />

              <Text style={s.fieldLabel}>{t('onboarding.allowance_period')}</Text>
              <View style={s.fuelGrid}>
                {ALLOWANCE_PERIODS.map(p => (
                  <TouchableOpacity key={p} style={[s.fuelOption, allowancePeriod === p && s.fuelOptionActive]} onPress={() => setAllowancePeriod(p)}>
                    <Text style={[s.fuelOptionText, allowancePeriod === p && { color: Colors.accent }]}>{t(`onboarding.allowance_${p}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {allowancePeriod !== 'unlimited' ? (
                <>
                  <Text style={s.fieldLabel}>{t('onboarding.allowance_amount')}</Text>
                  <TextInput
                    style={s.fieldInput}
                    value={allowanceAmount}
                    onChangeText={setAllowanceAmount}
                    keyboardType="numeric"
                    placeholderTextColor={Colors.textSecondary}
                    accessibilityLabel={t('onboarding.allowance_amount')}
                  />

                  <Text style={s.fieldLabel}>{t('onboarding.excess_rate')}</Text>
                  <TextInput
                    style={s.fieldInput}
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

          <TouchableOpacity style={[s.saveBtn, saving && s.btnDisabled]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={Colors.onAccent} /> : <Text style={s.saveBtnText}>{t('more.vehicle_save')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelBtnText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Password Modal ───────────────────────────────────────────────────────────

function PasswordModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);

  function reset() { setNewPw(''); setConfirmPw(''); setError(''); setSuccess(false); }
  function handleClose() { reset(); onClose(); }

  async function handleSave() {
    setError('');
    if (newPw.length < 6) { setError(t('more.password_min')); return; }
    if (newPw !== confirmPw) { setError(t('more.passwords_mismatch')); return; }
    setSaving(true);
    const { error: err } = await supabase.auth.updateUser({ password: newPw });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSuccess(true);
    setTimeout(handleClose, 1500);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={s.modalFlex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={s.modalScroll} contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={s.modalTitle}>{t('more.change_password')}</Text>
          {success ? (
            <View style={s.successBanner}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              <Text style={s.successText}>{t('more.password_changed')}</Text>
            </View>
          ) : null}
          {error ? <View style={s.errorBanner}><Text style={s.errorBannerText}>{error}</Text></View> : null}
          <Text style={s.fieldLabel}>{t('more.new_password')}</Text>
          <TextInput style={s.fieldInput} value={newPw} onChangeText={setNewPw}
            secureTextEntry textContentType="newPassword" placeholderTextColor={Colors.textSecondary} placeholder="••••••••" />
          <Text style={s.fieldLabel}>{t('more.confirm_password')}</Text>
          <TextInput style={s.fieldInput} value={confirmPw} onChangeText={setConfirmPw}
            secureTextEntry textContentType="newPassword" placeholderTextColor={Colors.textSecondary} placeholder="••••••••" />
          <TouchableOpacity style={[s.saveBtn, saving && s.btnDisabled]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={Colors.onAccent} /> : <Text style={s.saveBtnText}>{t('more.change_password')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelBtn} onPress={handleClose}>
            <Text style={s.cancelBtnText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Platforms Modal ──────────────────────────────────────────────────────────

function PlatformsModal({ visible, userId, onSaved, onClose }: {
  visible: boolean; userId: string | null; onSaved: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [customList, setCustomList] = React.useState<string[]>([]);
  const [customInput, setCustomInput] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!visible || !userId) return;
    getUserPlatforms(userId).then(saved => {
      const presets = new Set<string>();
      const customs: string[] = [];
      for (const p of saved) {
        if (PRESET_PLATFORMS.includes(p.platform_name)) presets.add(p.platform_name);
        else customs.push(p.platform_name);
      }
      setSelected(presets);
      setCustomList(customs);
    }).catch(() => {});
  }, [visible, userId]);

  function togglePreset(name: string) {
    setSelected(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }
  function addCustom() {
    const name = customInput.trim();
    if (!name) return;
    setCustomList(prev => prev.includes(name) ? prev : [...prev, name]);
    setCustomInput('');
  }
  function removeCustom(name: string) { setCustomList(prev => prev.filter(n => n !== name)); }

  async function handleSave() {
    if (!userId) return;
    setSaving(true); setError('');
    const names = [...Array.from(selected), ...customList];
    try {
      await saveUserPlatforms(userId, names);
      onSaved();
    } catch { setError(t('common.error')); }
    finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.modalFlex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={s.modalScroll} contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={s.modalTitle}>{t('more.my_platforms')}</Text>
          {error ? <View style={s.errorBanner}><Text style={s.errorBannerText}>{error}</Text></View> : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: Spacing.md }}>
            {PRESET_PLATFORMS.map(name => {
              const active = selected.has(name);
              return (
                <TouchableOpacity
                  key={name}
                  style={[s.pill, active && s.pillActive]}
                  onPress={() => togglePreset(name)}
                  activeOpacity={0.7}
                >
                  {active && <Ionicons name="checkmark" size={14} color={Colors.accent} style={{ marginRight: 4 }} />}
                  <Text style={[s.pillText, active && s.pillTextActive]}>{name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {customList.map(name => (
            <View key={name} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.input, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, marginBottom: Spacing.xs }}>
              <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 14 }}>{name}</Text>
              <TouchableOpacity onPress={() => removeCustom(name)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ))}

          <Text style={s.fieldLabel}>{t('more.platforms_custom')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              style={[s.fieldInput, { flex: 1, marginHorizontal: 0 }]}
              value={customInput}
              onChangeText={setCustomInput}
              placeholder={t('more.platforms_custom_placeholder')}
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="words"
              onSubmitEditing={addCustom}
              returnKeyType="done"
            />
            <TouchableOpacity onPress={addCustom} style={{ width: 44, height: 44, borderRadius: Radius.input, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={20} color={Colors.onAccent} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[s.saveBtn, saving && s.btnDisabled]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={Colors.onAccent} /> : <Text style={s.saveBtnText}>{t('common.save')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelBtnText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Cartões Modal ────────────────────────────────────────────────────────────

function CartaoForm({ card, userId, onSaved, onCancel }: {
  card: CreditCard | null; userId: string; onSaved: () => void; onCancel: () => void;
}) {
  const [name, setName]             = useState(card?.name ?? '');
  const [lastFour, setLastFour]     = useState(card?.last_four ?? '');
  const [limitStr, setLimitStr]     = useState(card && card.limit_cents > 0 ? (card.limit_cents / 100).toFixed(2) : '');
  const [closingDay, setClosingDay] = useState(card ? String(card.closing_day) : '');
  const [dueDay, setDueDay]         = useState(card ? String(card.due_day) : '');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  async function handleSave() {
    if (!name.trim()) { setError('Nome do cartão é obrigatório'); return; }
    const limit   = Math.round(parseFloat(limitStr.replace(',', '.') || '0') * 100);
    const closing = Math.min(31, Math.max(1, parseInt(closingDay) || 1));
    const due     = Math.min(31, Math.max(1, parseInt(dueDay) || 10));
    setSaving(true); setError('');
    try {
      const input: CreditCardInput = {
        name: name.trim(),
        last_four: lastFour.trim() || null,
        limit_cents: limit,
        closing_day: closing,
        due_day: due,
      };
      if (card) await updateCreditCard(card.id, input);
      else      await createCreditCard(userId, input);
      onSaved();
    } catch { setError('Erro ao salvar cartão'); }
    finally { setSaving(false); }
  }

  return (
    <>
      {error ? <View style={s.errorBanner}><Text style={s.errorBannerText}>{error}</Text></View> : null}
      <Text style={s.fieldLabel}>NOME DO CARTÃO *</Text>
      <TextInput style={s.fieldInput} value={name} onChangeText={setName}
        placeholder="Ex: Nubank, Inter, Itaú" placeholderTextColor={Colors.textSecondary} autoCapitalize="words" />
      <Text style={s.fieldLabel}>4 ÚLTIMOS DÍGITOS</Text>
      <TextInput style={s.fieldInput} value={lastFour} onChangeText={setLastFour}
        placeholder="1234" placeholderTextColor={Colors.textSecondary} keyboardType="numeric" maxLength={4} />
      <Text style={s.fieldLabel}>LIMITE (R$)</Text>
      <TextInput style={s.fieldInput} value={limitStr} onChangeText={setLimitStr}
        placeholder="0,00" placeholderTextColor={Colors.textSecondary} keyboardType="decimal-pad" />
      <Text style={s.fieldLabel}>DIA DO FECHAMENTO</Text>
      <TextInput style={s.fieldInput} value={closingDay} onChangeText={setClosingDay}
        placeholder="Ex: 25" placeholderTextColor={Colors.textSecondary} keyboardType="numeric" maxLength={2} />
      <Text style={s.fieldLabel}>DIA DO VENCIMENTO</Text>
      <TextInput style={s.fieldInput} value={dueDay} onChangeText={setDueDay}
        placeholder="Ex: 10" placeholderTextColor={Colors.textSecondary} keyboardType="numeric" maxLength={2} />
      <TouchableOpacity style={[s.saveBtn, saving && s.btnDisabled]} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color={Colors.onAccent} /> : <Text style={s.saveBtnText}>Salvar cartão</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
        <Text style={s.cancelBtnText}>Cancelar</Text>
      </TouchableOpacity>
    </>
  );
}

function CartaoItem({ card, onEdit, onDelete }: { card: CreditCard; onEdit: () => void; onDelete: () => void }) {
  const nextClose = nextOccurrence(card.closing_day);
  const nextDue   = nextOccurrence(card.due_day);
  const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  return (
    <View style={{ backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Ionicons name="card-outline" size={18} color={Colors.accent} style={{ marginRight: 8 }} />
        <Text style={{ color: Colors.textPrimary, fontSize: 15, fontWeight: '700', flex: 1 }}>
          {card.name}{card.last_four ? ` •••• ${card.last_four}` : ''}
        </Text>
        <TouchableOpacity onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginRight: 8 }}>
          <Ionicons name="pencil-outline" size={16} color={Colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="trash-outline" size={16} color={Colors.error} />
        </TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', gap: Spacing.md }}>
        {card.limit_cents > 0 && (
          <Text style={{ color: Colors.textSecondary, fontSize: 12 }}>
            Limite: R$ {(card.limit_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </Text>
        )}
        <Text style={{ color: Colors.textSecondary, fontSize: 12 }}>Fecha: {fmt(nextClose)}</Text>
        <Text style={{ color: Colors.textSecondary, fontSize: 12 }}>Vence: {fmt(nextDue)}</Text>
      </View>
    </View>
  );
}

function CartõesModal({ visible, userId, onClose }: {
  visible: boolean; userId: string | null; onClose: () => void;
}) {
  const [cards, setCards]       = useState<CreditCard[]>([]);
  const [loading, setLoading]   = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editCard, setEditCard] = useState<CreditCard | null>(null);

  useEffect(() => {
    if (visible && userId) loadCards();
    if (!visible) { setShowForm(false); setEditCard(null); }
  }, [visible, userId]);

  async function loadCards() {
    if (!userId) return;
    setLoading(true);
    try { setCards(await getCreditCards(userId)); }
    catch { }
    finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    try { await deleteCreditCard(id); await loadCards(); }
    catch { }
  }

  function openEdit(card: CreditCard) { setEditCard(card); setShowForm(true); }
  function openAdd() { setEditCard(null); setShowForm(true); }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.modalFlex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={s.modalScroll} contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={s.modalTitle}>{showForm ? (editCard ? 'Editar cartão' : 'Novo cartão') : 'Meus Cartões'}</Text>

          {!showForm ? (
            <>
              {loading
                ? <ActivityIndicator color={Colors.accent} style={{ marginVertical: Spacing.lg }} />
                : cards.length === 0
                  ? <Text style={{ color: Colors.textSecondary, textAlign: 'center', marginVertical: Spacing.lg }}>
                      Nenhum cartão cadastrado
                    </Text>
                  : cards.map(c => (
                      <CartaoItem
                        key={c.id}
                        card={c}
                        onEdit={() => openEdit(c)}
                        onDelete={() => handleDelete(c.id)}
                      />
                    ))
              }
              <TouchableOpacity style={s.saveBtn} onPress={openAdd}>
                <Text style={s.saveBtnText}>+ Adicionar cartão</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
                <Text style={s.cancelBtnText}>Fechar</Text>
              </TouchableOpacity>
            </>
          ) : (
            userId ? (
              <CartaoForm
                card={editCard}
                userId={userId}
                onSaved={() => { setShowForm(false); loadCards(); }}
                onCancel={() => setShowForm(false)}
              />
            ) : null
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Feedback Modal ───────────────────────────────────────────────────────────

type FeedbackType = 'bug' | 'suggestion' | 'feature';

const FEEDBACK_TABS: { type: FeedbackType; label: string; icon: 'bug-outline' | 'bulb-outline' | 'rocket-outline' }[] = [
  { type: 'bug',        label: 'Bug',       icon: 'bug-outline' },
  { type: 'suggestion', label: 'Sugestão',  icon: 'bulb-outline' },
  { type: 'feature',    label: 'Feature',   icon: 'rocket-outline' },
];

function FeedbackModal({ visible, userId, onClose }: {
  visible: boolean; userId: string | null; onClose: () => void;
}) {
  const [type, setType]     = useState<FeedbackType>('bug');
  const [message, setMsg]   = useState('');
  const [sending, setSend]  = useState(false);
  const [done, setDone]     = useState(false);
  const [error, setError]   = useState('');

  function reset() { setMsg(''); setDone(false); setError(''); setType('bug'); }
  function handleClose() { reset(); onClose(); }

  async function handleSend() {
    if (!message.trim() || !userId) return;
    setSend(true); setError('');
    try {
      const { supabase: sb } = await import('@/src/lib/supabase');
      const { error: err } = await sb.from('app_feedback').insert({ user_id: userId, type, message: message.trim() });
      if (err) throw err;
      setDone(true);
      setTimeout(handleClose, 1800);
    } catch { setError('Erro ao enviar. Tente novamente.'); }
    finally { setSend(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={s.modalFlex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={s.modalScroll} contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={s.modalTitle}>Enviar Feedback</Text>

          {/* Tabs */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: Spacing.lg }}>
            {FEEDBACK_TABS.map(tab => (
              <TouchableOpacity
                key={tab.type}
                style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  paddingVertical: 10, borderRadius: 20, borderWidth: 1.5,
                  borderColor: type === tab.type ? Colors.accent : Colors.border,
                  backgroundColor: type === tab.type ? Colors.accentDim : 'transparent' }]}
                onPress={() => setType(tab.type)}
                activeOpacity={0.7}
              >
                <Ionicons name={tab.icon} size={14} color={type === tab.type ? Colors.accent : Colors.textSecondary} />
                <Text style={{ color: type === tab.type ? Colors.accent : Colors.textSecondary, fontSize: 13, fontWeight: '700' }}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {done ? (
            <View style={[s.successBanner, { justifyContent: 'center', paddingVertical: Spacing.lg }]}>
              <Ionicons name="checkmark-circle" size={24} color={Colors.success} />
              <Text style={[s.successText, { fontSize: 16, fontWeight: '700' }]}>Obrigado pelo feedback!</Text>
            </View>
          ) : (
            <>
              {error ? <View style={s.errorBanner}><Text style={s.errorBannerText}>{error}</Text></View> : null}
              <Text style={s.fieldLabel}>
                {type === 'bug' ? 'Descreva o bug' : type === 'suggestion' ? 'Sua sugestão' : 'Qual feature você quer?'}
              </Text>
              <TextInput
                style={[s.fieldInput, { height: 120, textAlignVertical: 'top', paddingTop: 8, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, borderBottomWidth: 1, paddingHorizontal: Spacing.sm }]}
                value={message}
                onChangeText={setMsg}
                placeholder="Descreva com detalhes..."
                placeholderTextColor={Colors.textSecondary}
                multiline
                maxLength={1000}
              />
              <Text style={{ color: Colors.textSecondary, fontSize: 11, textAlign: 'right', marginBottom: Spacing.md }}>
                {message.length}/1000
              </Text>
              <TouchableOpacity
                style={[s.saveBtn, (!message.trim() || sending) && s.btnDisabled]}
                onPress={handleSend}
                disabled={!message.trim() || sending}
              >
                {sending
                  ? <ActivityIndicator color={Colors.onAccent} />
                  : <Text style={s.saveBtnText}>Enviar</Text>
                }
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={s.cancelBtn} onPress={handleClose}>
            <Text style={s.cancelBtnText}>Fechar</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MoreScreen() {
  const { t, i18n } = useTranslation();
  const { profile, refetch } = useProfile();
  const router = useRouter();

  const [email, setEmail]           = useState<string | null>(null);
  const [userId, setUserId]         = useState<string | null>(null);
  const { isPremium, isTrial, periodEnd: premiumEnd } = usePremiumStatus(userId);
  const [name, setName]             = useState('');
  const [phone, setPhone]           = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved]   = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [pwModalVisible, setPwModalVisible]           = useState(false);
  const [vehicle, setVehicle]                         = useState<Vehicle | null>(null);
  const [vehicleModalVisible, setVehicleModalVisible] = useState(false);
  const [locationVisible, setLocationVisible]         = useState(false);
  const [pickerConfig, setPickerConfig]               = useState<{
    field: string; title: string; items: { label: string; value: string }[]; value: string; searchable?: boolean;
  } | null>(null);
  const [isSavingSetting, setIsSavingSetting]         = useState(false);
  const [settingSaved, setSettingSaved]               = useState(false);
  const [notifEnabled, setNotifEnabled]               = useState(true);
  const [dailyHour, setDailyHour]                     = useState(6);
  const [dailyMinute, setDailyMinute]                 = useState(0);
  const [notifWeekdays, setNotifWeekdays]             = useState<number[]>([2, 3, 4, 5, 6]);
  const [notifSaved, setNotifSaved]                   = useState(false);
  const notifSavedTimer                               = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [platformsModalVisible, setPlatformsModalVisible] = useState(false);
  const [userPlatformNames, setUserPlatformNames]     = useState<string[]>([]);
  const biometricAvailable                              = useBiometricAvailable();
  const [biometricEnabled, setBiometricEnabledState]  = useState(false);
  const [exportingCSV, setExportingCSV]               = useState(false);
  const [exportingJSON, setExportingJSON]             = useState(false);
  const [cartoesModalVisible, setCartoesModalVisible]   = useState(false);
  const [feedbackModalVisible, setFeedbackModalVisible] = useState(false);
  const [tourVisible, setTourVisible]                   = useState(false);

  useEffect(() => {
    getNotificationsEnabled().then(setNotifEnabled);
    getDailyReminderTime().then(({ hour, minute }) => { setDailyHour(hour); setDailyMinute(minute); });
    getNotifWeekdays().then(setNotifWeekdays);
    getBiometricEnabled().then(setBiometricEnabledState);
    return () => { if (notifSavedTimer.current) clearTimeout(notifSavedTimer.current); };
  }, []);

  async function handleNotifToggle(val: boolean) {
    setNotifEnabled(val);
    await setNotificationsEnabled(val);
    if (val) scheduleAllNotifications(i18n.language).catch(() => {});
    else cancelAllNotifications().catch(() => {});
    showNotifSaved();
  }

  async function handleDailyTimeChange(hour: number, minute: number) {
    setDailyHour(hour); setDailyMinute(minute);
    await saveDailyReminderTime(hour, minute);
    scheduleDailyReminder(i18n.language).catch(() => {});
    showNotifSaved();
  }

  async function handleWeekdayToggle(day: number) {
    const next = notifWeekdays.includes(day)
      ? notifWeekdays.filter(d => d !== day)
      : [...notifWeekdays, day].sort((a, b) => a - b);
    setNotifWeekdays(next);
    await saveNotifWeekdays(next);
    scheduleDailyReminder(i18n.language).catch(() => {});
    showNotifSaved();
  }

  function showNotifSaved() {
    setNotifSaved(true);
    if (notifSavedTimer.current) clearTimeout(notifSavedTimer.current);
    notifSavedTimer.current = setTimeout(() => setNotifSaved(false), 2500);
  }

  function loadVehicle(uid: string) {
    supabase.from('vehicles').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data: v }) => setVehicle(v as Vehicle | null));
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      setEmail(data.user?.email ?? null);
      setUserId(uid);
      setName(data.user?.user_metadata?.name ?? profile?.name ?? '');
      setPhone(data.user?.user_metadata?.phone ?? '');
      if (uid) {
        loadVehicle(uid);
        registerPushToken(uid).catch(() => {});
        getUserPlatforms(uid).then(saved => setUserPlatformNames(saved.map(p => p.platform_name))).catch(() => {});
      }
    });
  }, [profile]);

  async function handleSubscribe() {
    setCheckoutLoading(true);
    // On web, window.open must run synchronously inside the click handler or
    // the browser's popup blocker silently swallows it (no exception, no tab) —
    // so we open a blank tab here, before the await, and point it at the
    // checkout URL once createStripeCheckout() resolves.
    const popup = Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.open('', '_blank')
      : null;
    try {
      const { url } = await createStripeCheckout();
      if (popup) {
        popup.location.href = url;
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
    } catch (e: any) {
      popup?.close();
      console.error('checkout error:', e.message);
      const message = e.message || 'Tente novamente em alguns instantes. Se o problema continuar, fale com o suporte.';
      // react-native-web's Alert.alert() is a no-op stub — it never shows
      // anything on web, so fall back to window.alert there.
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(`Não foi possível abrir o checkout\n\n${message}`);
      } else {
        Alert.alert('Não foi possível abrir o checkout', message);
      }
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function handleSaveProfile() {
    if (!userId) return;
    setProfileSaving(true); setProfileSaved(false);
    try {
      await Promise.all([
        upsertProfile({ id: userId, name: name.trim() || undefined }),
        supabase.auth.updateUser({ data: { name: name.trim(), phone: phone.trim() } }),
      ]);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch (e) { console.error('profile save failed:', e); }
    finally { setProfileSaving(false); }
  }

  async function handleQuickSave(field: string, value: string) {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    setIsSavingSetting(true);
    try {
      if (field === 'lang') {
        const localeMap: Record<string, string> = { pt: 'pt-BR', en: 'en-US', 'en-GB': 'en-GB', es: 'es-419', fr: 'fr-FR', zh: 'zh-CN' };
        const countryMap: Record<string, string> = { pt: 'BR', en: 'US', 'en-GB': 'GB', es: 'MX', fr: 'FR', zh: 'CN' };
        const { error } = await supabase.from('profiles')
          .update({ locale: localeMap[value], country: countryMap[value] })
          .eq('id', data.user.id);
        if (error) throw error;
        i18n.changeLanguage(value);
      } else {
        const { error } = await supabase.from('profiles')
          .update({ [field]: value })
          .eq('id', data.user.id);
        if (error) throw error;
      }
      await refetch();
      setSettingSaved(true);
      setTimeout(() => setSettingSaved(false), 2000);
    } catch (e) {
      console.error('[settings save]', e);
    }
    finally { setIsSavingSetting(false); }
  }

  function openPicker(field: string, title: string, items: { label: string; value: string }[], value: string, searchable?: boolean) {
    setPickerConfig({ field, title, items, value, searchable });
  }

  async function handleExportCSV() {
    if (!userId) return;
    setExportingCSV(true);
    try { await exportShiftsCSV(userId, profile?.currency_code ?? 'BRL'); }
    catch { /* share sheet cancelled or error — silent */ }
    finally { setExportingCSV(false); }
  }

  async function handleExportJSON() {
    if (!userId) return;
    setExportingJSON(true);
    try { await exportLGPDJson(userId); }
    catch { }
    finally { setExportingJSON(false); }
  }

  async function handleBiometricToggle(val: boolean) {
    setBiometricEnabledState(val);
    await setBiometricEnabled(val);
  }

  const initials = (name || email || '?').charAt(0).toUpperCase();

  const currentLangCode = (): LangCode => {
    const l = i18n.language;
    if (l === 'en-GB') return 'en-GB';
    if (l.startsWith('en')) return 'en';
    if (l.startsWith('es')) return 'es';
    if (l.startsWith('fr')) return 'fr';
    if (l.startsWith('zh')) return 'zh';
    return 'pt';
  };

  const langLabel = LANG_ITEMS.find(l => l.value === currentLangCode())?.label ?? i18n.language;
  const workerLabel = profile?.worker_type === 'motoboy' ? `🛵 ${t('onboarding.worker_type_motoboy').split(' (')[0]}` : `🚗 ${t('onboarding.worker_type_driver').split(' (')[0]}`;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.screenTitle}>{t('more.title')}</Text>

        {/* Avatar */}
        <View style={s.avatarCard}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={s.avatarInfo}>
            <Text style={s.avatarName}>{name || '—'}</Text>
            <Text style={s.avatarEmail}>{email ?? '—'}</Text>
          </View>
        </View>

        {/* Profile */}
        <Text style={s.sectionHeader}>{t('more.profile')}</Text>
        <View style={s.card}>
          <Text style={s.fieldLabel}>{t('more.name')}</Text>
          <TextInput style={s.fieldInput} value={name} onChangeText={setName}
            placeholder="Seu nome completo" placeholderTextColor={Colors.textSecondary} autoCapitalize="words" />
          <View style={s.cardDivider} />
          <Text style={s.fieldLabel}>{t('more.phone')}</Text>
          <TextInput style={s.fieldInput} value={phone} onChangeText={setPhone}
            placeholder="(11) 99999-9999" placeholderTextColor={Colors.textSecondary} keyboardType="phone-pad" />
          <View style={s.cardDivider} />
          <Text style={s.fieldLabel}>{t('more.email_label')}</Text>
          <View style={s.readonlyField}>
            <Text style={s.readonlyText}>{email ?? '—'}</Text>
          </View>
        </View>

        {profileSaved ? (
          <View style={s.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={s.successText}>{t('more.profile_saved')}</Text>
          </View>
        ) : null}

        <TouchableOpacity style={[s.saveBtn, profileSaving && s.btnDisabled]} onPress={handleSaveProfile} disabled={profileSaving}>
          {profileSaving ? <ActivityIndicator color={Colors.onAccent} /> : <Text style={s.saveBtnText}>{t('more.save_profile')}</Text>}
        </TouchableOpacity>

        {/* Vehicle */}
        <Text style={s.sectionHeader}>MEU VEÍCULO</Text>
        <View style={s.card}>
          {vehicle ? (
            <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => setVehicleModalVisible(true)}>
              <View style={s.rowIconLabel}>
                <Ionicons name="car-sport-outline" size={18} color={Colors.accent} style={s.rowIcon} />
                <View>
                  <Text style={s.rowLabel}>{vehicle.brand} {vehicle.model} • {vehicle.year}</Text>
                  <Text style={[s.rowValue, { fontSize: 12 }]}>
                    {t(`onboarding.fuel_${vehicle.fuel_type}`)}{vehicle.avg_consumption_per_100 > 0 ? ` • ${(100000 / vehicle.avg_consumption_per_100).toFixed(1)} km/L` : ''}
                  </Text>
                </View>
              </View>
              <Ionicons name="pencil-outline" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => setVehicleModalVisible(true)}>
              <View style={s.rowIconLabel}>
                <Ionicons name="add-circle-outline" size={18} color={Colors.accent} style={s.rowIcon} />
                <Text style={s.rowLabel}>Adicionar veículo</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Platforms */}
        <Text style={s.sectionHeader}>{t('more.my_platforms')}</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => setPlatformsModalVisible(true)}>
            <View style={s.rowIconLabel}>
              <Ionicons name="apps-outline" size={18} color={Colors.accent} style={s.rowIcon} />
              <View>
                <Text style={s.rowLabel}>{t('more.my_platforms')}</Text>
                <Text style={[s.rowValue, { fontSize: 12 }]}>
                  {userPlatformNames.length > 0 ? userPlatformNames.join(', ') : t('more.platforms_empty')}
                </Text>
              </View>
            </View>
            <Ionicons name="pencil-outline" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Premium */}
        <Text style={s.sectionHeader}>ASSINATURA</Text>
        <View style={[s.card, s.premiumCard]}>
          {isPremium && !isTrial ? (
            <View style={s.premiumActive}>
              <Ionicons name="star" size={22} color="#F59E0B" />
              <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                <Text style={s.premiumTitle}>PalDrivy Premium ativo</Text>
                {premiumEnd ? (
                  <Text style={s.premiumSub}>
                    Válido até {new Date(premiumEnd).toLocaleDateString('pt-BR')}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : (
            <>
              <View style={s.premiumHeader}>
                <Ionicons name={isTrial ? 'star' : 'star-outline'} size={22} color="#F59E0B" />
                <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                  <Text style={s.premiumTitle}>
                    {isTrial ? 'Período de teste Premium' : 'Assine o Premium'}
                  </Text>
                  <Text style={s.premiumSub}>
                    {isTrial && premiumEnd
                      ? `Válido até ${new Date(premiumEnd).toLocaleDateString('pt-BR')} — assine para não perder o acesso`
                      : 'Relatórios completos, sem limites'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[s.premiumBtn, checkoutLoading && s.btnDisabled]}
                onPress={handleSubscribe}
                disabled={checkoutLoading}
                activeOpacity={0.8}
              >
                {checkoutLoading
                  ? <ActivityIndicator color="#0B1221" />
                  : <Text style={s.premiumBtnText}>Assinar agora — a partir de R$ 12/ano</Text>
                }
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Reports */}
        <Text style={s.sectionHeader}>RELATÓRIOS</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => router.push('/report')}>
            <View style={s.rowIconLabel}>
              <Ionicons name="document-text-outline" size={18} color={Colors.accent} style={s.rowIcon} />
              <View>
                <Text style={s.rowLabel}>DRE — Resultado do Mês</Text>
                <Text style={[s.rowValue, { fontSize: 12 }]}>Imprimir / salvar PDF para o contador</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Security */}
        <Text style={s.sectionHeader}>{t('more.security')}</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} activeOpacity={0.6} onPress={() => setPwModalVisible(true)}>
            <View style={s.rowIconLabel}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.accent} style={s.rowIcon} />
              <Text style={s.rowLabel}>{t('more.change_password')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Settings — individual rows */}
        <Text style={s.sectionHeader}>{t('more.settings')}</Text>
        <View style={[s.card, isSavingSetting && { opacity: 0.6 }]}>
          <SettingsRow
            label={t('more.worker_type')}
            value={workerLabel}
            onPress={() => openPicker('worker_type', t('more.worker_type'), [
              { label: `🚗 ${t('onboarding.worker_type_driver')}`, value: 'driver' },
              { label: `🛵 ${t('onboarding.worker_type_motoboy')}`, value: 'motoboy' },
            ], profile?.worker_type ?? 'driver')}
          />
          <View style={s.divider} />
          <SettingsRow
            label={t('more.language')}
            value={langLabel}
            onPress={() => openPicker('lang', t('more.language'), LANG_ITEMS, currentLangCode())}
          />
          <View style={s.divider} />
          <SettingsRow
            label={t('more.goal_type')}
            value={profile?.goal_type === 'liquido' ? t('more.goal_liquido') : t('more.goal_bruto')}
            onPress={() => openPicker('goal_type', t('more.goal_type'), [
              { label: t('more.goal_bruto'),   value: 'bruto'   },
              { label: t('more.goal_liquido'), value: 'liquido' },
            ], profile?.goal_type ?? 'bruto')}
          />
          <View style={s.divider} />
          <SettingsRow
            label={t('more.currency')}
            value={profile?.currency_code ?? 'BRL'}
            onPress={() => openPicker('currency_code', t('more.currency'),
              CURRENCIES.map(c => ({ label: c.label, value: c.code })),
              profile?.currency_code ?? 'BRL', true)}
          />
          <View style={s.divider} />
          <SettingsRow
            label={t('more.distance_unit')}
            value={profile?.distance_unit ?? 'km'}
            onPress={() => openPicker('distance_unit', t('more.distance_unit'), [
              { label: t('onboarding.dist_km'), value: 'km' },
              { label: t('onboarding.dist_mi'), value: 'mi' },
            ], profile?.distance_unit ?? 'km')}
          />
          <View style={s.divider} />
          <SettingsRow
            label={t('more.volume_unit')}
            value={profile?.volume_unit === 'gallons' ? t('onboarding.vol_gallons') : t('onboarding.vol_liters')}
            onPress={() => openPicker('volume_unit', t('more.volume_unit'), [
              { label: t('onboarding.vol_liters'),  value: 'liters'  },
              { label: t('onboarding.vol_gallons'), value: 'gallons' },
            ], profile?.volume_unit ?? 'liters')}
          />
          <View style={s.divider} />
          <SettingsRow
            label={t('more.location')}
            value={[profile?.city, profile?.state].filter(Boolean).join(', ') || '—'}
            onPress={() => setLocationVisible(true)}
          />
        </View>

        {settingSaved && (
          <View style={s.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={s.successText}>{t('more.settings_saved')}</Text>
          </View>
        )}

        {/* Notifications */}
        <Text style={s.sectionHeader}>{t('more.notifications')}</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.rowIconLabel}>
              <Ionicons name="notifications-outline" size={18} color={Colors.accent} style={s.rowIcon} />
              <Text style={s.rowLabel}>{t('more.notifications_enabled')}</Text>
            </View>
            <Switch
              value={notifEnabled}
              onValueChange={handleNotifToggle}
              trackColor={{ false: Colors.border, true: Colors.accentDim }}
              thumbColor={notifEnabled ? Colors.accent : Colors.textSecondary}
            />
          </View>
          {notifEnabled && (
            <>
              <View style={s.divider} />
              <View style={s.row}>
                <View style={s.rowIconLabel}>
                  <Ionicons name="alarm-outline" size={18} color={Colors.textSecondary} style={s.rowIcon} />
                  <View>
                    <Text style={s.rowLabel}>{t('more.daily_reminder')}</Text>
                    <Text style={[s.rowValue, { fontSize: 12 }]}>
                      {t('more.daily_time', {
                        hour: String(dailyHour).padStart(2, '0'),
                        minute: String(dailyMinute).padStart(2, '0'),
                      })}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flex: 1 }}>
                  {[6, 7, 8, 9, 18, 19, 20].map(h => (
                    <TouchableOpacity
                      key={h}
                      onPress={() => handleDailyTimeChange(h, 0)}
                      style={[s.hourPill, dailyHour === h && s.hourPillActive]}
                    >
                      <Text style={[s.hourPillText, dailyHour === h && { color: Colors.accent }]}>{h}h</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={s.divider} />
              <View style={[s.row, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                <View style={s.rowIconLabel}>
                  <Ionicons name="calendar-outline" size={18} color={Colors.textSecondary} style={s.rowIcon} />
                  <Text style={s.rowLabel}>{t('more.notif_weekdays')}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: Spacing.xs, paddingLeft: Spacing.lg + 4 }}>
                  {([1, 2, 3, 4, 5, 6, 7] as const).map((day, idx) => {
                    const labels = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
                    const active = notifWeekdays.includes(day);
                    return (
                      <TouchableOpacity
                        key={day}
                        onPress={() => handleWeekdayToggle(day)}
                        style={[s.hourPill, active && s.hourPillActive, { minWidth: 30, alignItems: 'center' }]}
                      >
                        <Text style={[s.hourPillText, active && { color: Colors.accent }]}>{labels[idx]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <View style={s.divider} />
              <View style={s.row}>
                <View style={s.rowIconLabel}>
                  <Ionicons name="calendar-outline" size={18} color={Colors.textSecondary} style={s.rowIcon} />
                  <Text style={s.rowLabel}>{t('more.weekly_summary')}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              </View>
              <View style={s.divider} />
              <View style={s.row}>
                <View style={s.rowIconLabel}>
                  <Ionicons name="bar-chart-outline" size={18} color={Colors.textSecondary} style={s.rowIcon} />
                  <Text style={s.rowLabel}>{t('more.monthly_summary')}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              </View>
              <View style={s.divider} />
              <View style={s.row}>
                <View style={s.rowIconLabel}>
                  <Ionicons name="trophy-outline" size={18} color={Colors.textSecondary} style={s.rowIcon} />
                  <Text style={s.rowLabel}>{t('more.goal_notification')}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              </View>
            </>
          )}
        </View>

        {notifSaved && (
          <View style={s.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={s.successText}>{t('more.notifications_saved')}</Text>
          </View>
        )}

        {/* Cartões */}
        <Text style={s.sectionHeader}>CARTÕES DE CRÉDITO</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => setCartoesModalVisible(true)}>
            <View style={s.rowIconLabel}>
              <Ionicons name="card-outline" size={18} color={Colors.accent} style={s.rowIcon} />
              <View>
                <Text style={s.rowLabel}>Meus cartões</Text>
                <Text style={[s.rowValue, { fontSize: 12 }]}>Gerencie limites, fechamento e vencimento</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Export */}
        <Text style={s.sectionHeader}>EXPORTAR DADOS</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={handleExportCSV} disabled={exportingCSV}>
            <View style={s.rowIconLabel}>
              <Ionicons name="document-outline" size={18} color={Colors.accent} style={s.rowIcon} />
              <View>
                <Text style={s.rowLabel}>Exportar CSV</Text>
                <Text style={[s.rowValue, { fontSize: 12 }]}>Todos os turnos — compatível com Excel</Text>
              </View>
            </View>
            {exportingCSV
              ? <ActivityIndicator size="small" color={Colors.accent} />
              : <Ionicons name="download-outline" size={18} color={Colors.textSecondary} />
            }
          </TouchableOpacity>
          <View style={s.divider} />
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={handleExportJSON} disabled={exportingJSON}>
            <View style={s.rowIconLabel}>
              <Ionicons name="code-slash-outline" size={18} color={Colors.accent} style={s.rowIcon} />
              <View>
                <Text style={s.rowLabel}>Baixar meus dados (LGPD)</Text>
                <Text style={[s.rowValue, { fontSize: 12 }]}>JSON completo — todos os seus dados</Text>
              </View>
            </View>
            {exportingJSON
              ? <ActivityIndicator size="small" color={Colors.accent} />
              : <Ionicons name="shield-checkmark-outline" size={18} color={Colors.textSecondary} />
            }
          </TouchableOpacity>
        </View>

        {/* Biometria */}
        {biometricAvailable && (
          <>
            <Text style={s.sectionHeader}>SEGURANÇA</Text>
            <View style={s.card}>
              <View style={s.row}>
                <View style={s.rowIconLabel}>
                  <Ionicons name="finger-print-outline" size={18} color={Colors.accent} style={s.rowIcon} />
                  <View>
                    <Text style={s.rowLabel}>Login Biométrico</Text>
                    <Text style={[s.rowValue, { fontSize: 12 }]}>Desbloquear com impressão digital / Face ID</Text>
                  </View>
                </View>
                <Switch
                  value={biometricEnabled}
                  onValueChange={handleBiometricToggle}
                  trackColor={{ false: Colors.border, true: Colors.accentDim }}
                  thumbColor={biometricEnabled ? Colors.accent : Colors.textSecondary}
                />
              </View>
            </View>
          </>
        )}

        {/* Feedback */}
        <Text style={s.sectionHeader}>FEEDBACK</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => setFeedbackModalVisible(true)}>
            <View style={s.rowIconLabel}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.accent} style={s.rowIcon} />
              <View>
                <Text style={s.rowLabel}>Enviar feedback</Text>
                <Text style={[s.rowValue, { fontSize: 12 }]}>Bug, sugestão ou nova feature</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Guia */}
        <Text style={s.sectionHeader}>GUIA</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => setTourVisible(true)}>
            <View style={s.rowIconLabel}>
              <Ionicons name="help-circle-outline" size={18} color={Colors.accent} style={s.rowIcon} />
              <View>
                <Text style={s.rowLabel}>{t('more.tour_replay')}</Text>
                <Text style={[s.rowValue, { fontSize: 12 }]}>Reveja o tutorial interativo do app</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={s.signOutBtn} onPress={() => authSignOut().catch(console.warn)} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color={Colors.error} style={{ marginRight: 6 }} />
          <Text style={s.signOutText}>{t('more.sign_out')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <PasswordModal visible={pwModalVisible} onClose={() => setPwModalVisible(false)} />

      <CartõesModal
        visible={cartoesModalVisible}
        userId={userId}
        onClose={() => setCartoesModalVisible(false)}
      />

      <FeedbackModal
        visible={feedbackModalVisible}
        userId={userId}
        onClose={() => setFeedbackModalVisible(false)}
      />

      <PlatformsModal
        visible={platformsModalVisible}
        userId={userId}
        onSaved={() => {
          setPlatformsModalVisible(false);
          if (userId) getUserPlatforms(userId).then(saved => setUserPlatformNames(saved.map(p => p.platform_name))).catch(() => {});
        }}
        onClose={() => setPlatformsModalVisible(false)}
      />

      <VehicleModal
        visible={vehicleModalVisible} vehicle={vehicle} userId={userId}
        onSaved={() => {
          setVehicleModalVisible(false);
          if (userId) loadVehicle(userId);
        }}
        onClose={() => setVehicleModalVisible(false)}
      />

      <LocationModal
        visible={locationVisible}
        profile={profile}
        onSaved={() => { setLocationVisible(false); refetch?.(); }}
        onClose={() => setLocationVisible(false)}
      />

      <QuickPickerModal
        visible={pickerConfig !== null}
        title={pickerConfig?.title ?? ''}
        items={pickerConfig?.items ?? []}
        value={pickerConfig?.value ?? ''}
        onSelect={val => pickerConfig && handleQuickSave(pickerConfig.field, val)}
        onClose={() => setPickerConfig(null)}
        searchable={pickerConfig?.searchable}
      />

      <TourOverlay
        visible={tourVisible}
        steps={TOUR_STEPS}
        onFinish={() => setTourVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  screenTitle: { color: Colors.textPrimary, fontSize: 26, fontWeight: '800', marginBottom: Spacing.lg, letterSpacing: -0.5 },

  avatarCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 16, padding: Spacing.md, marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.border },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
  avatarText: { color: Colors.onAccent, fontSize: 22, fontWeight: '800' },
  avatarInfo: { flex: 1 },
  avatarName: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700' },
  avatarEmail: { color: Colors.textSecondary, fontSize: 13, marginTop: 2 },

  sectionHeader: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: Spacing.sm, marginTop: Spacing.xs },

  card: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md, overflow: 'hidden' },
  cardDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: Spacing.md },

  fieldLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: Spacing.md, marginTop: Spacing.md, marginBottom: 4 },
  fieldInput: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm, fontSize: 15, color: Colors.textPrimary, minHeight: 40, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingVertical: 4 },
  readonlyField: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, paddingVertical: 4 },
  readonlyText: { color: Colors.textSecondary, fontSize: 15 },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  rowIconLabel: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  rowIcon: { marginRight: Spacing.sm },
  rowLabel: { color: Colors.textPrimary, fontSize: 15 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowValue: { color: Colors.textSecondary, fontSize: 14 },
  divider: { height: 1, backgroundColor: Colors.border, marginHorizontal: Spacing.md },

  successBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.successBg, borderRadius: Radius.input, padding: Spacing.sm, marginBottom: Spacing.sm, borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)' },
  successText: { color: Colors.success, fontSize: 14, fontWeight: '500' },
  errorBanner: { backgroundColor: Colors.errorBg, borderRadius: Radius.input, padding: Spacing.sm + 4, marginBottom: Spacing.md, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  errorBannerText: { color: Colors.error, fontSize: 14 },

  saveBtn: { backgroundColor: Colors.accent, borderRadius: Radius.button, alignItems: 'center', justifyContent: 'center', minHeight: 50, marginBottom: Spacing.lg, shadowColor: Colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  saveBtnText: { color: Colors.onAccent, fontSize: 15, fontWeight: '800' },
  btnDisabled: { opacity: 0.6 },

  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: Radius.button, borderWidth: 1.5, borderColor: 'rgba(239,68,68,0.35)', padding: Spacing.md, marginTop: Spacing.sm },
  signOutText: { color: Colors.error, fontSize: 15, fontWeight: '600' },

  modalFlex: { flex: 1, backgroundColor: Colors.background },
  modalScroll: { flex: 1 },
  modalContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  modalTitle: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: Spacing.lg },
  cancelBtn: { paddingVertical: Spacing.md, alignItems: 'center' },
  cancelBtnText: { color: Colors.textSecondary, fontSize: 15 },
  fuelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.md },
  fuelOption: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  fuelOptionActive: { borderColor: Colors.accent, backgroundColor: Colors.accentDim },
  fuelOptionText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },

  pillRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  pill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.surface, borderWidth: 2, borderColor: Colors.border, borderRadius: Radius.card, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.md },
  pillActive: { borderColor: Colors.accent, backgroundColor: Colors.accentDim },
  pillIcon: { fontSize: 20 },
  pillText: { flex: 1, fontSize: 12, color: Colors.textSecondary, flexWrap: 'wrap' },
  pillTextActive: { color: Colors.accent, fontWeight: '600' },
  required: { color: Colors.error },

  pickerHeader: { padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  pickerTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  pickerRow: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md },
  pickerRowLabel: { flex: 1, fontSize: 16, color: Colors.textPrimary },

  premiumCard: { borderColor: '#F59E0B', borderWidth: 1.5 },
  premiumHeader: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md },
  premiumActive: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md },
  premiumTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  premiumSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  premiumBtn: { backgroundColor: '#F59E0B', borderRadius: Radius.button, alignItems: 'center', justifyContent: 'center', minHeight: 46, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, marginHorizontal: Spacing.md, marginBottom: Spacing.md },
  premiumBtnText: { color: '#0B1221', fontSize: 14, fontWeight: '800', textAlign: 'center' },

  hourPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  hourPillActive: { borderColor: Colors.accent, backgroundColor: Colors.accentDim },
  hourPillText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
});
