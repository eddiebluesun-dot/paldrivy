import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Select } from '@/src/components/Select';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { decimalToCents, formatMoney } from '@/src/utils/currency';
import { displayToMl } from '@/src/utils/units';
import { addExpense, deleteExpense, getExpenses, updateExpense } from '@/src/services/expenses';
import { addFuelEntry } from '@/src/services/fuel';
import type { FuelType } from '@/src/services/fuel';
import { getVehicles } from '@/src/services/vehicles';
import { useProfile } from '@/src/hooks/useProfile';
import type { Expense } from '@/src/services/expenses';
import { getCalendarHeatmap } from '@/src/services/cockpit';
import type { HeatmapDay } from '@/src/services/cockpit';
import { CalendarHeatmapView } from '@/src/components/CalendarHeatmapView';
import { ExpenseDaySheet } from '@/src/components/ExpenseDaySheet';

// ─── constants ────────────────────────────────────────────────────────────────

const FUEL_TYPES: FuelType[] = ['gasoline', 'ethanol', 'diesel', 'gnv', 'electric', 'hybrid'];

const EXPENSE_CATEGORIES = [
  'rent', 'financing', 'insurance', 'internet', 'tracker',
  'licensing', 'taxi_license', 'fuel', 'car_wash', 'maintenance',
  'tires', 'oil_change', 'tolls', 'parking', 'food',
  'taxes', 'health_insurance', 'other',
] as const;

const RECURRING_FREQUENCIES = [
  'weekly', 'monthly', 'quarterly', 'semiannual', 'annual',
] as const;

type RecurringFrequency = typeof RECURRING_FREQUENCIES[number];

// ─── helpers ─────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
function addMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

// Categories that auto-suggest installments
const ANNUAL_CATEGORIES = new Set(['licensing', 'insurance', 'taxes', 'taxi_license']);
const MAINTENANCE_CATEGORIES = new Set(['maintenance', 'oil_change', 'tires']);
function suggestedInstallments(cat: string): number {
  if (ANNUAL_CATEGORIES.has(cat)) return 12;
  if (MAINTENANCE_CATEGORIES.has(cat)) return 3;
  return 1;
}

// ─── expense form (shared by add + edit) ─────────────────────────────────────

interface ExpenseFormProps {
  title: string;
  initialValues?: Partial<Expense>;
  isFuelOnly?: boolean;   // true when editing a "fuel" category expense (no fuel-entry sync)
  userId: string;
  vehicleId: string | null;
  volumeUnit: 'liters' | 'gallons';
  currencyCode: string;
  locale: string;
  saving: boolean;
  error: string | null;
  onSave: (patch: Partial<Omit<Expense, 'id' | 'user_id'>>) => void;
  onClose: () => void;
}

function ExpenseForm({
  title,
  initialValues,
  isFuelOnly = false,
  volumeUnit,
  saving,
  error,
  onSave,
  onClose,
}: ExpenseFormProps) {
  const { t } = useTranslation();

  const [category, setCategory] = useState<string>(initialValues?.category ?? EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState(
    initialValues?.amount_cents != null ? (initialValues.amount_cents / 100).toFixed(2) : ''
  );
  const [date, setDate] = useState(initialValues?.expense_date ?? todayIso());
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [recurring, setRecurring] = useState(initialValues?.recurring ?? false);
  const [frequency, setFrequency] = useState<RecurringFrequency>(
    (initialValues as any)?.recurring_frequency ?? 'monthly'
  );

  function handleSave() {
    const trimmedDate = date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) return;
    const amountNum = parseFloat(amount.replace(',', '.'));
    if (isNaN(amountNum) || amountNum <= 0) return;

    onSave({
      category,
      amount_cents: decimalToCents(amountNum),
      expense_date: trimmedDate,
      description: description.trim() !== '' ? description.trim() : null,
      recurring,
      recurring_frequency: recurring ? frequency : null,
    } as any);
  }

  return (
    <KeyboardAvoidingView
      style={styles.modalWrapper}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.modalScroll}
        contentContainerStyle={styles.modalContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.modalTitle}>{title}</Text>

        <Text style={styles.label}>{t('expense.category')}</Text>
        <Select
          value={category}
          onValueChange={setCategory}
          items={EXPENSE_CATEGORIES
            .map(cat => ({ label: t(`expense_category.${cat}`), value: cat }))
            .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))}
        />

        <Text style={styles.label}>{t('expense.amount')}</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          placeholderTextColor={Colors.textSecondary}
        />

        <Text style={styles.label}>{t('expense.description')}</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder={t('expense.description')}
          placeholderTextColor={Colors.textSecondary}
        />

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('expense.recurring')}</Text>
          <Switch
            value={recurring}
            onValueChange={setRecurring}
            trackColor={{ true: Colors.accent, false: Colors.border }}
            thumbColor={Colors.onBrand}
          />
        </View>

        {recurring && (
          <>
            <Text style={styles.label}>{t('expense.recurring_frequency')}</Text>
            <Select
              value={frequency}
              onValueChange={(v) => setFrequency(v as RecurringFrequency)}
              items={RECURRING_FREQUENCIES.map(f => ({
                label: t(`expense.frequency_${f}`),
                value: f,
              }))}
            />
          </>
        )}

        <Text style={styles.label}>{t('expense.date')}</Text>
        <TextInput
          style={styles.input}
          value={date}
          onChangeText={setDate}
          placeholder={t('expense.date_placeholder')}
          placeholderTextColor={Colors.textSecondary}
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />

        {error !== null && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.primaryButton, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.onBrand} />
          ) : (
            <Text style={styles.primaryButtonText}>{t('expense.save')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── add modal (keeps fuel-entry sync logic) ──────────────────────────────────

interface AddExpenseModalProps {
  visible: boolean;
  userId: string;
  vehicleId: string | null;
  volumeUnit: 'liters' | 'gallons';
  currencyCode: string;
  locale: string;
  defaultFuelType?: FuelType;
  onClose: () => void;
  onSaved: () => void;
}

function AddExpenseModal({
  visible,
  userId,
  vehicleId,
  volumeUnit,
  currencyCode,
  locale,
  defaultFuelType = 'gasoline',
  onClose,
  onSaved,
}: AddExpenseModalProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso);
  const [description, setDescription] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [installments, setInstallments] = useState('1');
  const [fuelType, setFuelType] = useState<FuelType>(defaultFuelType);
  const [fuelTotalStr, setFuelTotalStr] = useState('');
  const [fuelUnitPrice, setFuelUnitPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-suggest installments when category changes
  useEffect(() => {
    setInstallments(String(suggestedInstallments(category)));
  }, [category]);

  const isFuel = category === 'fuel';
  const isElectric = fuelType === 'electric';
  const qtyLabel = isElectric ? 'kWh' : volumeUnit === 'gallons' ? t('onboarding.vol_gallons') : t('onboarding.vol_liters');
  const priceLabel = isElectric ? t('fuel.price_per_kwh') : volumeUnit === 'gallons' ? t('fuel.price_per_unit_gal') : t('fuel.price_per_unit');
  const fuelTotalNum = parseFloat(fuelTotalStr.replace(',', '.')) || 0;
  const fuelUnitPriceNum = parseFloat(fuelUnitPrice.replace(',', '.')) || 0;
  const fuelQtyNum = fuelTotalNum > 0 && fuelUnitPriceNum > 0 ? fuelTotalNum / fuelUnitPriceNum : 0;

  function resetForm() {
    setCategory(EXPENSE_CATEGORIES[0]); setAmount(''); setDate(todayIso());
    setDescription(''); setRecurring(false); setFrequency('monthly');
    setInstallments('1');
    setFuelType(defaultFuelType); setFuelTotalStr(''); setFuelUnitPrice(''); setError(null);
  }
  function handleClose() { resetForm(); onClose(); }

  async function handleSave() {
    setError(null);
    const trimmedDate = date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) { setError(t('common.required')); return; }
    if (isFuel) {
      if (fuelTotalNum <= 0 || fuelUnitPriceNum <= 0) { setError(t('common.required')); return; }
    } else {
      const n = parseFloat(amount.replace(',', '.'));
      if (!amount.trim() || isNaN(n) || n <= 0) { setError(t('common.required')); return; }
    }
    setSaving(true);
    try {
      if (isFuel) {
        const totalCostCents = decimalToCents(fuelTotalNum);
        const volumeMl = isElectric ? Math.round(fuelQtyNum * 1000) : displayToMl(fuelQtyNum, volumeUnit);
        const unitLabel = isElectric ? 'kWh' : 'L';
        await Promise.all([
          addFuelEntry({ user_id: userId, vehicle_id: vehicleId, fuel_type: fuelType, odometer_meters: null, volume_ml: volumeMl, total_cost_cents: totalCostCents, price_per_unit_cents: decimalToCents(fuelUnitPriceNum), full_tank: false, station: null, filled_at: new Date(trimmedDate + 'T12:00:00').toISOString() }),
          addExpense({ user_id: userId, category, amount_cents: totalCostCents, expense_date: trimmedDate, description: `${t(`onboarding.fuel_${fuelType}`)} — ${fuelQtyNum.toFixed(3)} ${unitLabel} × R$${fuelUnitPriceNum.toFixed(3)}`, recurring: false }),
        ]);
      } else {
        const totalCents = decimalToCents(parseFloat(amount.replace(',', '.')));
        const n = Math.max(1, Math.min(60, parseInt(installments, 10) || 1));
        const desc = description.trim() || null;

        if (n === 1) {
          await addExpense({ user_id: userId, category, amount_cents: totalCents, expense_date: trimmedDate, description: desc, recurring, recurring_frequency: recurring ? frequency : null });
        } else {
          const perCents = Math.floor(totalCents / n);
          const remainder = totalCents - perCents * n;
          await Promise.all(
            Array.from({ length: n }, (_, i) => addExpense({
              user_id: userId,
              category,
              amount_cents: i === 0 ? perCents + remainder : perCents,
              expense_date: addMonths(trimmedDate, i),
              description: desc ? `${desc} (${i + 1}/${n})` : `${t(`expense_category.${category}`)} (${i + 1}/${n})`,
              recurring: false,
              recurring_frequency: null,
            }))
          );
        }
      }
      resetForm(); onSaved();
    } catch (e) {
      console.error('addExpense failed:', e);
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={styles.modalWrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalTitle}>{t('expense.add')}</Text>

          <Text style={styles.label}>{t('expense.category')}</Text>
          <Select value={category} onValueChange={setCategory}
            items={EXPENSE_CATEGORIES.map(cat => ({ label: t(`expense_category.${cat}`), value: cat })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))} />

          {isFuel ? (
            <>
              <Text style={styles.label}>{t('fuel.fuel_type')}</Text>
              <Select value={fuelType} onValueChange={v => setFuelType(v as FuelType)}
                items={FUEL_TYPES.map(ft => ({ label: t(`onboarding.fuel_${ft}`), value: ft }))} />
              <Text style={styles.label}>{t('fuel.total')}</Text>
              <TextInput style={styles.input} keyboardType="decimal-pad" value={fuelTotalStr} onChangeText={setFuelTotalStr} placeholder="0.00" placeholderTextColor={Colors.textSecondary} />
              <Text style={styles.label}>{priceLabel}</Text>
              <TextInput style={styles.input} keyboardType="decimal-pad" value={fuelUnitPrice} onChangeText={setFuelUnitPrice} placeholder="0.000" placeholderTextColor={Colors.textSecondary} />
              <Text style={styles.label}>{qtyLabel}</Text>
              <View style={[styles.input, styles.readonlyRow]}>
                <Text style={[styles.readonlyValue, fuelQtyNum > 0 && { color: Colors.accent }]}>{fuelQtyNum > 0 ? fuelQtyNum.toFixed(3) : '--'}</Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>{t('expense.amount')}</Text>
              <TextInput style={styles.input} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={Colors.textSecondary} />

              <Text style={styles.label}>{t('expense.installments')}</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={installments}
                onChangeText={v => setInstallments(v.replace(/[^0-9]/g, ''))}
                placeholder="1"
                placeholderTextColor={Colors.textSecondary}
              />
              {(() => {
                const n = parseInt(installments, 10) || 1;
                const total = parseFloat(amount.replace(',', '.')) || 0;
                if (n > 1 && total > 0) {
                  const perMonth = (total / n).toFixed(2);
                  return (
                    <Text style={styles.installmentHint}>
                      {t('expense.installments_hint', { n, per: perMonth })}
                    </Text>
                  );
                }
                return null;
              })()}

              <Text style={styles.label}>{t('expense.description')}</Text>
              <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder={t('expense.description')} placeholderTextColor={Colors.textSecondary} />

              {parseInt(installments, 10) <= 1 && (
                <>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>{t('expense.recurring')}</Text>
                    <Switch value={recurring} onValueChange={setRecurring} trackColor={{ true: Colors.accent, false: Colors.border }} thumbColor={Colors.onBrand} />
                  </View>
                  {recurring && (
                    <>
                      <Text style={styles.label}>{t('expense.recurring_frequency')}</Text>
                      <Select
                        value={frequency}
                        onValueChange={(v) => setFrequency(v as RecurringFrequency)}
                        items={RECURRING_FREQUENCIES.map(f => ({ label: t(`expense.frequency_${f}`), value: f }))}
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}

          <Text style={styles.label}>{t('expense.date')}</Text>
          <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder={t('expense.date_placeholder')} placeholderTextColor={Colors.textSecondary} autoCapitalize="none" keyboardType="numbers-and-punctuation" maxLength={10} />

          {error !== null && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity style={[styles.primaryButton, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={Colors.onBrand} /> : <Text style={styles.primaryButtonText}>{t('expense.save')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── edit modal ───────────────────────────────────────────────────────────────

interface EditExpenseModalProps {
  entry: Expense | null;
  volumeUnit: 'liters' | 'gallons';
  currencyCode: string;
  locale: string;
  onClose: () => void;
  onSaved: () => void;
}

function EditExpenseModal({ entry, volumeUnit, currencyCode, locale, onClose, onSaved }: EditExpenseModalProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(patch: Partial<Omit<Expense, 'id' | 'user_id'>>) {
    if (!entry) return;
    setError(null);
    setSaving(true);
    try {
      await updateExpense(entry.id, patch);
      onSaved();
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={entry !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ExpenseForm
        key={entry?.id}
        title={t('expense.edit')}
        initialValues={entry ?? undefined}
        userId={entry?.user_id ?? ''}
        vehicleId={null}
        volumeUnit={volumeUnit}
        currencyCode={currencyCode}
        locale={locale}
        saving={saving}
        error={error}
        onSave={handleSave}
        onClose={onClose}
      />
    </Modal>
  );
}

// ─── expense list item ────────────────────────────────────────────────────────

interface ExpenseItemProps {
  item: Expense;
  currencyCode: string;
  locale: string;
  onEdit: () => void;
  onDelete: () => void;
}

function ExpenseItem({ item, currencyCode, locale, onEdit, onDelete }: ExpenseItemProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.entryItem}>
      <View style={styles.entryHeader}>
        <Text style={styles.entryDate}>{formatDate(item.expense_date)}</Text>
        <View style={styles.entryActions}>
          <TouchableOpacity onPress={onEdit} style={styles.actionBtn} accessibilityLabel={t('common.edit')}>
            <Ionicons name="pencil-outline" size={15} color={Colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} style={styles.actionBtnDelete} accessibilityLabel={t('common.delete')}>
            <Ionicons name="trash-outline" size={15} color={Colors.error} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={styles.entryCategory}>{t(`expense_category.${item.category}`)}</Text>
        <Text style={styles.entryAmount}>{formatMoney(item.amount_cents, currencyCode, locale)}</Text>
      </View>
      {item.description !== null && item.description !== '' && (
        <Text style={styles.entryDescription}>{item.description}</Text>
      )}
      {item.recurring && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <Ionicons name="repeat-outline" size={11} color={Colors.textSecondary} />
          <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>
            {item.recurring_frequency
              ? t(`expense.frequency_${item.recurring_frequency}`)
              : t('expense.recurring')}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── main screen ──────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const { t } = useTranslation();
  const { profile } = useProfile();

  const [userId, setUserId] = useState<string | null>(null);
  const [vehicleFuelType, setVehicleFuelType] = useState<FuelType>('gasoline');
  const [entries, setEntries] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Expense | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);

  // Calendar heatmap state
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
  const [heatmapDays, setHeatmapDays] = useState<HeatmapDay[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [daySheetVisible, setDaySheetVisible] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        const vehicles = await getVehicles(uid);
        if (vehicles.length > 0) setVehicleFuelType(vehicles[0].fuel_type);
      }
    });
  }, []);

  const loadEntries = useCallback(async () => {
    if (!userId) return;
    setScreenError(null);
    try {
      setEntries(await getExpenses(userId, 60));
    } catch {
      setScreenError(t('common.error'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, t]);

  const loadHeatmap = useCallback(async (y: number, m: number) => {
    if (!userId) return;
    setHeatmapLoading(true);
    try {
      setHeatmapDays(await getCalendarHeatmap(userId, y, m));
    } catch {
      // silently ignore — heatmap is non-critical
    } finally {
      setHeatmapLoading(false);
    }
  }, [userId]);

  useEffect(() => { if (userId) loadEntries(); }, [userId, loadEntries]);
  useEffect(() => { if (userId) loadHeatmap(calYear, calMonth); }, [userId, calYear, calMonth, loadHeatmap]);

  function handleRefresh() { setRefreshing(true); loadEntries(); loadHeatmap(calYear, calMonth); }

  function prevMonth() {
    if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    const n = new Date();
    if (calYear > n.getFullYear() || (calYear === n.getFullYear() && calMonth >= n.getMonth() + 1)) return;
    if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1); }
    else setCalMonth(m => m + 1);
  }

  function handleDayPress(day: number) {
    setSelectedDay(day);
    setDaySheetVisible(true);
  }

  function handleDelete(entry: Expense) {
    Alert.alert(
      t('expense.delete_title'),
      t('expense.delete_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteExpense(entry.id);
              setEntries(prev => prev.filter(e => e.id !== entry.id));
            } catch {
              setScreenError(t('common.error'));
            }
          },
        },
      ]
    );
  }

  const currencyCode = profile?.currency_code ?? 'BRL';
  const locale = profile?.locale ?? 'pt-BR';
  const vehicleId = profile?.vehicle_id ?? null;
  const volumeUnit = profile?.volume_unit ?? 'liters';

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.accent} /></View>;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('expense.title')}</Text>
          <TouchableOpacity style={styles.addButton} onPress={() => setAddVisible(true)}>
            <Text style={styles.addButtonText}>{t('expense.add')}</Text>
          </TouchableOpacity>
        </View>

        {screenError !== null && <Text style={styles.errorText}>{screenError}</Text>}

        {/* Calendar heatmap card */}
        <View style={calStyles.card}>
          <View style={calStyles.navRow}>
            <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
            <Text style={calStyles.navLabel}>
              {new Date(calYear, calMonth - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
            </Text>
            <TouchableOpacity onPress={nextMonth} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {heatmapLoading ? (
            <ActivityIndicator color={Colors.accent} style={{ marginVertical: Spacing.lg }} />
          ) : (
            <CalendarHeatmapView
              year={calYear}
              month={calMonth}
              days={heatmapDays}
              onDayPress={handleDayPress}
            />
          )}
        </View>

        <FlatList
          data={entries}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <ExpenseItem
              item={item}
              currencyCode={currencyCode}
              locale={locale}
              onEdit={() => setEditingEntry(item)}
              onDelete={() => handleDelete(item)}
            />
          )}
          style={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.accent} />
          }
          ListEmptyComponent={<Text style={styles.emptyText}>{t('expense.no_entries')}</Text>}
        />

        {userId !== null && (
          <AddExpenseModal
            visible={addVisible}
            userId={userId}
            vehicleId={vehicleId}
            volumeUnit={volumeUnit}
            currencyCode={currencyCode}
            locale={locale}
            defaultFuelType={vehicleFuelType}
            onClose={() => setAddVisible(false)}
            onSaved={() => { setAddVisible(false); loadEntries(); }}
          />
        )}

        <EditExpenseModal
          entry={editingEntry}
          volumeUnit={volumeUnit}
          currencyCode={currencyCode}
          locale={locale}
          onClose={() => setEditingEntry(null)}
          onSaved={() => { setEditingEntry(null); loadEntries(); }}
        />

        {userId !== null && selectedDay !== null && (
          <ExpenseDaySheet
            visible={daySheetVisible}
            day={selectedDay}
            month={calMonth}
            year={calYear}
            userId={userId}
            currencyCode={currencyCode}
            locale={locale}
            onClose={() => setDaySheetVisible(false)}
            onAddExpense={() => {
              setDaySheetVisible(false);
              setAddVisible(true);
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, backgroundColor: Colors.background, padding: Spacing.md },
  center: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: 'bold', flex: 1, marginRight: Spacing.sm },
  addButton: { backgroundColor: Colors.accent, borderRadius: Radius.button, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, flexShrink: 0 },
  addButtonText: { color: Colors.onBrand, fontSize: 14, fontWeight: '600' },
  errorText: { color: Colors.error, marginBottom: Spacing.sm, textAlign: 'center' },
  list: { flex: 1 },
  emptyText: { color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xl },
  entryItem: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 2,
  },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  entryDate: { color: Colors.textSecondary, fontSize: 12 },
  entryActions: { flexDirection: 'row', gap: Spacing.xs },
  actionBtn: { padding: 6, borderRadius: Radius.input, backgroundColor: Colors.accentDim },
  actionBtnDelete: { padding: 6, borderRadius: Radius.input, backgroundColor: Colors.errorBg },
  entryCategory: { color: Colors.textPrimary, fontWeight: '600', fontSize: 14, flex: 1, marginRight: 8 },
  entryAmount: { color: Colors.accent, fontWeight: '800', fontSize: 15, fontVariant: ['tabular-nums'] },
  entryDescription: { color: Colors.textSecondary, fontSize: 12, marginTop: 2, fontStyle: 'italic' },
  // Modal
  modalWrapper: { flex: 1, backgroundColor: Colors.background },
  modalScroll: { flex: 1 },
  modalContent: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  modalTitle: { color: Colors.textPrimary, fontSize: 20, fontWeight: 'bold', marginBottom: Spacing.lg },
  label: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: Spacing.md, marginBottom: Spacing.xs },
  input: { backgroundColor: Colors.surface, borderRadius: Radius.input, borderWidth: 1, borderColor: Colors.border, color: Colors.textPrimary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: 15, marginBottom: Spacing.xs },
  readonlyRow: { justifyContent: 'center', backgroundColor: Colors.surfaceAlt },
  readonlyValue: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md, marginBottom: Spacing.xs },
  switchLabel: { color: Colors.textPrimary, fontSize: 15 },
  primaryButton: { backgroundColor: Colors.accent, borderRadius: Radius.button, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, alignItems: 'center', marginTop: Spacing.lg, marginBottom: Spacing.sm },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: Colors.onBrand, fontSize: 16, fontWeight: '600' },
  cancelButton: { paddingVertical: Spacing.md, alignItems: 'center' },
  cancelButtonText: { color: Colors.textSecondary, fontSize: 16 },
  installmentHint: { color: Colors.accent, fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 4 },
});

const calStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 2,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  navLabel: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
});
