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
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { decimalToCents } from '@/src/utils/currency';
import { displayToMeters, displayToMl, metersToDisplay, mlToDisplay } from '@/src/utils/units';
import { addFuelEntry, deleteFuelEntry, getFuelEntries, updateFuelEntry } from '@/src/services/fuel';
import { getWeeklyConsumption, WeeklyStats } from '@/src/services/fuelConsumption';
import { getVehicles, getEffectiveVehicleId } from '@/src/services/vehicles';
import { Select } from '@/src/components/Select';
import { useProfile } from '@/src/hooks/useProfile';
import type { FuelEntry, FuelType } from '@/src/services/fuel';

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

// ─── shared fuel form ─────────────────────────────────────────────────────────

const FUEL_TYPES: FuelType[] = ['gasoline', 'ethanol', 'diesel', 'gnv', 'electric', 'hybrid'];

interface FuelFormProps {
  title: string;
  initialValues?: Partial<FuelEntry>;
  userId: string;
  vehicleId: string | null;
  distanceUnit: 'km' | 'mi';
  volumeUnit: 'liters' | 'gallons';
  defaultFuelType?: FuelType;
  saving: boolean;
  error: string | null;
  onSave: (data: Omit<FuelEntry, 'id' | 'user_id'>) => void;
  onClose: () => void;
}

function FuelForm({
  title,
  initialValues,
  distanceUnit,
  volumeUnit,
  defaultFuelType = 'gasoline',
  saving,
  error,
  onSave,
  onClose,
}: FuelFormProps) {
  const { t } = useTranslation();

  const [fuelType, setFuelType] = useState<FuelType>(
    (initialValues?.fuel_type as FuelType) ?? defaultFuelType
  );
  const [odometer, setOdometer] = useState(() => {
    if (initialValues?.odometer_meters != null) {
      return metersToDisplay(initialValues.odometer_meters, distanceUnit).toFixed(1);
    }
    return '';
  });
  const [totalStr, setTotalStr] = useState(() =>
    initialValues?.total_cost_cents != null
      ? (initialValues.total_cost_cents / 100).toFixed(2)
      : ''
  );
  const [unitPrice, setUnitPrice] = useState(() =>
    initialValues?.price_per_unit_cents != null
      ? (initialValues.price_per_unit_cents / 100).toFixed(3)
      : ''
  );
  const [station, setStation] = useState(initialValues?.station ?? '');
  const [dateStr, setDateStr] = useState(() => {
    const iso = initialValues?.filled_at ?? new Date().toISOString();
    return iso.slice(0, 10); // YYYY-MM-DD
  });

  const isElectric = fuelType === 'electric';
  const qtyLabel = isElectric
    ? 'kWh'
    : volumeUnit === 'gallons'
    ? t('onboarding.vol_gallons')
    : t('onboarding.vol_liters');
  const priceLabel = isElectric
    ? t('fuel.price_per_kwh')
    : volumeUnit === 'gallons'
    ? t('fuel.price_per_unit_gal')
    : t('fuel.price_per_unit');

  const totalNum = parseFloat(totalStr.replace(',', '.')) || 0;
  const unitPriceNum = parseFloat(unitPrice.replace(',', '.')) || 0;
  const qtyNum = totalNum > 0 && unitPriceNum > 0 ? totalNum / unitPriceNum : 0;

  function handleSave() {
    if (!totalStr.trim() || totalNum <= 0) return;
    if (!unitPrice.trim() || unitPriceNum <= 0) return;

    const odometerMeters =
      odometer.trim() !== ''
        ? displayToMeters(parseFloat(odometer.replace(',', '.')), distanceUnit)
        : null;
    const volumeMl = isElectric
      ? Math.round(qtyNum * 1000)
      : displayToMl(qtyNum, volumeUnit);

    onSave({
      vehicle_id: null,
      fuel_type: fuelType,
      odometer_meters: odometerMeters,
      volume_ml: volumeMl,
      total_cost_cents: decimalToCents(totalNum),
      price_per_unit_cents: decimalToCents(unitPriceNum),
      full_tank: false,
      station: station.trim() !== '' ? station.trim() : null,
      filled_at: dateStr.trim().match(/^\d{4}-\d{2}-\d{2}$/)
        ? new Date(dateStr.trim() + 'T12:00:00').toISOString()
        : (initialValues?.filled_at ?? new Date().toISOString()),
    });
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

        <Text style={styles.label}>{t('fuel.fuel_type')}</Text>
        <Select
          value={fuelType}
          onValueChange={(v) => setFuelType(v as FuelType)}
          items={FUEL_TYPES.map((ft) => ({ label: t(`onboarding.fuel_${ft}`), value: ft }))}
        />

        <Text style={styles.label}>{t('fuel.odometer')}</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={odometer}
          onChangeText={setOdometer}
          placeholder={distanceUnit === 'km' ? 'km' : 'mi'}
          placeholderTextColor={Colors.textSecondary}
        />

        <Text style={styles.label}>{t('fuel.total')}</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={totalStr}
          onChangeText={setTotalStr}
          placeholder="0.00"
          placeholderTextColor={Colors.textSecondary}
        />

        <Text style={styles.label}>{priceLabel}</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={unitPrice}
          onChangeText={setUnitPrice}
          placeholder="0.000"
          placeholderTextColor={Colors.textSecondary}
        />

        <Text style={styles.label}>{qtyLabel}</Text>
        <View style={styles.readonlyInput}>
          <Text style={[styles.readonlyText, qtyNum > 0 && { color: Colors.accent }]}>
            {qtyNum > 0 ? qtyNum.toFixed(3) : '--'}
          </Text>
        </View>

        <Text style={styles.label}>{t('fuel.station')}</Text>
        <TextInput
          style={styles.input}
          value={station}
          onChangeText={setStation}
          placeholder={t('fuel.station')}
          placeholderTextColor={Colors.textSecondary}
        />

        <Text style={styles.label}>{t('fuel.entry_date')}</Text>
        <TextInput
          style={styles.input}
          value={dateStr}
          onChangeText={setDateStr}
          placeholder="AAAA-MM-DD"
          placeholderTextColor={Colors.textSecondary}
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
            <Text style={styles.primaryButtonText}>{t('fuel.save')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── add modal ────────────────────────────────────────────────────────────────

interface AddFuelModalProps {
  visible: boolean;
  userId: string;
  vehicleId: string | null;
  distanceUnit: 'km' | 'mi';
  volumeUnit: 'liters' | 'gallons';
  defaultFuelType?: FuelType;
  onClose: () => void;
  onSaved: () => void;
}

function AddFuelModal({
  visible,
  userId,
  vehicleId,
  distanceUnit,
  volumeUnit,
  defaultFuelType = 'gasoline',
  onClose,
  onSaved,
}: AddFuelModalProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  function handleClose() {
    setFormKey((k) => k + 1);
    setError(null);
    onClose();
  }

  async function handleSave(data: Omit<FuelEntry, 'id' | 'user_id'>) {
    setError(null);
    setSaving(true);
    try {
      await addFuelEntry({ ...data, user_id: userId, vehicle_id: vehicleId });
      setFormKey((k) => k + 1);
      onSaved();
    } catch (e) {
      console.error('addFuelEntry failed:', e);
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <FuelForm
        key={formKey}
        title={t('fuel.add')}
        userId={userId}
        vehicleId={vehicleId}
        distanceUnit={distanceUnit}
        volumeUnit={volumeUnit}
        defaultFuelType={defaultFuelType}
        saving={saving}
        error={error}
        onSave={handleSave}
        onClose={handleClose}
      />
    </Modal>
  );
}

// ─── edit modal ───────────────────────────────────────────────────────────────

interface EditFuelModalProps {
  entry: FuelEntry | null;
  distanceUnit: 'km' | 'mi';
  volumeUnit: 'liters' | 'gallons';
  onClose: () => void;
  onSaved: () => void;
}

function EditFuelModal({ entry, distanceUnit, volumeUnit, onClose, onSaved }: EditFuelModalProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(data: Omit<FuelEntry, 'id' | 'user_id'>) {
    if (!entry) return;
    setError(null);
    setSaving(true);
    try {
      await updateFuelEntry(entry.id, data);
      onSaved();
    } catch (e) {
      console.error('updateFuelEntry failed:', e);
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={entry !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <FuelForm
        key={entry?.id}
        title={t('fuel.edit')}
        initialValues={entry ?? undefined}
        userId={entry?.user_id ?? ''}
        vehicleId={entry?.vehicle_id ?? null}
        distanceUnit={distanceUnit}
        volumeUnit={volumeUnit}
        saving={saving}
        error={error}
        onSave={handleSave}
        onClose={onClose}
      />
    </Modal>
  );
}

// ─── fuel entry list item ─────────────────────────────────────────────────────

interface FuelItemProps {
  entry: FuelEntry;
  volumeUnit: 'liters' | 'gallons';
  onEdit: () => void;
  onDelete: () => void;
}

function FuelItem({ entry, volumeUnit, onEdit, onDelete }: FuelItemProps) {
  const { t } = useTranslation();
  const isElectric = entry.fuel_type === 'electric';
  const volumeDisplay = isElectric
    ? (entry.volume_ml / 1000).toFixed(2)
    : mlToDisplay(entry.volume_ml, volumeUnit).toFixed(2);
  const qtyUnit = isElectric ? 'kWh' : volumeUnit === 'gallons' ? 'gal' : 'L';
  const pricePerUnitLabel = isElectric
    ? t('fuel.price_per_kwh')
    : volumeUnit === 'gallons'
    ? t('fuel.price_per_unit_gal')
    : t('fuel.price_per_unit');
  const pricePerUnit = (entry.price_per_unit_cents / 100).toFixed(3);
  const total = (entry.total_cost_cents / 100).toFixed(2);

  return (
    <View style={styles.entryItem}>
      <View style={styles.entryHeader}>
        <Text style={styles.entryDate}>{formatDate(entry.filled_at)}</Text>
        <View style={styles.entryActions}>
          <TouchableOpacity
            onPress={onEdit}
            style={styles.actionBtn}
            accessibilityLabel={t('common.edit')}
          >
            <Ionicons name="pencil-outline" size={15} color={Colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDelete}
            style={styles.actionBtnDelete}
            accessibilityLabel={t('common.delete')}
          >
            <Ionicons name="trash-outline" size={15} color={Colors.error} />
          </TouchableOpacity>
        </View>
      </View>
      {entry.station !== null && entry.station !== '' && (
        <Text style={styles.entryStation}>{entry.station}</Text>
      )}
      <View style={styles.entryRow}>
        <Text style={styles.entryLabel}>{t('fuel.fuel_type')}</Text>
        <Text style={styles.entryValue}>{t(`onboarding.fuel_${entry.fuel_type}`)}</Text>
      </View>
      <View style={styles.entryRow}>
        <Text style={styles.entryLabel}>{t('fuel.volume')}</Text>
        <Text style={styles.entryValue}>{volumeDisplay} {qtyUnit}</Text>
      </View>
      <View style={styles.entryRow}>
        <Text style={styles.entryLabel}>{pricePerUnitLabel}</Text>
        <Text style={styles.entryValue}>{pricePerUnit}</Text>
      </View>
      <View style={styles.entryRow}>
        <Text style={styles.entryLabel}>{t('fuel.total')}</Text>
        <Text style={[styles.entryValue, styles.entryTotal]}>R$ {total}</Text>
      </View>
    </View>
  );
}

// ─── main screen ──────────────────────────────────────────────────────────────

export default function FuelScreen() {
  const { t } = useTranslation();
  const { profile } = useProfile();

  const [userId, setUserId] = useState<string | null>(null);
  const [vehicleFuelType, setVehicleFuelType] = useState<FuelType>('gasoline');
  const [effectiveVehicleId, setEffectiveVehicleId] = useState<string | null>(null);
  const [entries, setEntries] = useState<FuelEntry[]>([]);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FuelEntry | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);

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

  // Resolve which vehicle new entries get tagged with -- profile.vehicle_id if
  // explicitly set, otherwise the same fallback the dashboard uses. Without
  // this, a user who never explicitly picked a vehicle logs every fuel entry
  // with vehicle_id: null, breaking anything scoped per-vehicle (rental km
  // allowance tracking, fuel consumption trend).
  useEffect(() => {
    if (!userId) return;
    getEffectiveVehicleId(userId, profile?.vehicle_id ?? null).then(setEffectiveVehicleId).catch(() => {});
  }, [userId, profile?.vehicle_id]);

  const loadEntries = useCallback(async () => {
    if (!userId) return;
    setScreenError(null);
    try {
      const [data, weekly] = await Promise.all([
        getFuelEntries(userId, 30),
        getWeeklyConsumption(userId, profile?.vehicle_id),
      ]);
      setEntries(data);
      setWeeklyStats(weekly);
    } catch (e) {
      console.error('getFuelEntries failed:', e);
      setScreenError(t('common.error'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, t, profile?.vehicle_id]);

  useEffect(() => {
    if (userId) loadEntries();
  }, [userId, loadEntries]);

  function handleRefresh() {
    setRefreshing(true);
    loadEntries();
  }

  function handleDelete(entry: FuelEntry) {
    Alert.alert(
      t('fuel.delete_title'),
      t('fuel.delete_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteFuelEntry(entry.id);
              setEntries((prev) => prev.filter((e) => e.id !== entry.id));
            } catch {
              setScreenError(t('common.error'));
            }
          },
        },
      ]
    );
  }

  const volumeUnit = profile?.volume_unit ?? 'liters';
  const distanceUnit = profile?.distance_unit ?? 'km';

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.brandBlue} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('fuel.title')}</Text>
          <TouchableOpacity style={styles.addButton} onPress={() => setAddVisible(true)}>
            <Text style={styles.addButtonText}>{t('fuel.add')}</Text>
          </TouchableOpacity>
        </View>

        {screenError !== null && <Text style={styles.errorText}>{screenError}</Text>}

        {/* Weekly consumption */}
        {weeklyStats.length > 0 ? (
          <View style={styles.weeklyCard}>
            <Text style={styles.weeklyTitle}>{t('fuel.weekly_title')}</Text>
            {weeklyStats.slice(0, 6).map((w, idx) => {
              const isKm = distanceUnit === 'km';
              const isLiters = volumeUnit === 'liters';

              // Distance: km → mi if imperial
              const dist = isKm ? w.km_driven : w.km_driven * 0.621371;
              const distLabel = isKm ? 'km' : 'mi';

              // Volume & efficiency depends on fuel type
              let volDisplay: string;
              let effDisplay: string | null = null;

              if (w.is_electric) {
                // Electric: always kWh, efficiency in km/kWh or mi/kWh
                volDisplay = `${w.total_volume.toFixed(2)} kWh`;
                if (w.efficiency) {
                  const eff = isKm ? w.efficiency : w.efficiency * 0.621371;
                  effDisplay = `${eff.toFixed(2)} ${distLabel}/kWh`;
                }
              } else {
                // Thermal: convert liters → gallons if imperial
                const vol = isLiters ? w.total_volume : w.total_volume * 0.264172;
                const volLabel = isLiters ? 'L' : 'gal';
                volDisplay = `${vol.toFixed(1)} ${volLabel}`;
                if (w.efficiency) {
                  // km/L → mpg: multiply by 2.35215
                  const eff = isKm && isLiters
                    ? w.efficiency
                    : !isKm && !isLiters
                    ? w.efficiency * 2.35215
                    : w.efficiency; // mixed units edge case
                  const effLabel = isKm ? 'km/L' : 'mpg';
                  effDisplay = `${eff.toFixed(1)} ${effLabel}`;
                }
              }

              return (
                <View key={idx} style={[styles.weeklyRow, idx > 0 && styles.weeklyRowBorder]}>
                  <Text style={styles.weeklyLabel}>{w.week_label}</Text>
                  <View style={styles.weeklyValues}>
                    {dist > 0 ? (
                      <Text style={styles.weeklyChip}>{dist.toFixed(0)} {distLabel}</Text>
                    ) : null}
                    <Text style={styles.weeklyChip}>{volDisplay}</Text>
                    {effDisplay ? (
                      <Text style={[styles.weeklyChip, styles.weeklyChipAccent]}>{effDisplay}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FuelItem
              entry={item}
              volumeUnit={volumeUnit}
              onEdit={() => setEditingEntry(item)}
              onDelete={() => handleDelete(item)}
            />
          )}
          style={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.brandBlue}
            />
          }
          ListEmptyComponent={<Text style={styles.emptyText}>{t('fuel.no_entries')}</Text>}
        />

        {userId !== null && (
          <AddFuelModal
            visible={addVisible}
            userId={userId}
            vehicleId={effectiveVehicleId}
            distanceUnit={distanceUnit}
            volumeUnit={volumeUnit}
            defaultFuelType={vehicleFuelType}
            onClose={() => setAddVisible(false)}
            onSaved={() => { setAddVisible(false); loadEntries(); }}
          />
        )}

        <EditFuelModal
          entry={editingEntry}
          distanceUnit={distanceUnit}
          volumeUnit={volumeUnit}
          onClose={() => setEditingEntry(null)}
          onSaved={() => { setEditingEntry(null); loadEntries(); }}
        />
      </View>
    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, backgroundColor: Colors.background, padding: Spacing.md },
  center: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: 'bold', flex: 1, marginRight: Spacing.sm },
  addButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.button,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    flexShrink: 0,
  },
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
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  entryDate: { color: Colors.textPrimary, fontWeight: '600', fontSize: 14 },
  entryActions: { flexDirection: 'row', gap: Spacing.xs },
  actionBtn: {
    padding: 6,
    borderRadius: Radius.input,
    backgroundColor: Colors.accentDim,
  },
  actionBtnDelete: {
    padding: 6,
    borderRadius: Radius.input,
    backgroundColor: Colors.errorBg,
  },
  entryStation: { color: Colors.textSecondary, fontSize: 12, marginBottom: Spacing.xs },
  entryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  entryLabel: { color: Colors.textSecondary, fontSize: 13 },
  entryValue: { color: Colors.textPrimary, fontSize: 13 },
  entryTotal: { fontWeight: '600', color: Colors.accent },
  weeklyCard: { backgroundColor: Colors.surface, borderRadius: Radius.card, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.md },
  weeklyTitle: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.sm },
  weeklyRow: { paddingVertical: 8 },
  weeklyRowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  weeklyLabel: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  weeklyValues: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  weeklyChip: { backgroundColor: Colors.surfaceAlt, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
  weeklyChipAccent: { backgroundColor: Colors.accentDim, color: Colors.accent },
  // Modal
  modalWrapper: { flex: 1, backgroundColor: Colors.background },
  modalScroll: { flex: 1 },
  modalContent: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  modalTitle: {
    color: Colors.textPrimary,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: Spacing.lg,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.textPrimary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 15,
    marginBottom: Spacing.xs,
  },
  readonlyInput: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  readonlyText: { color: Colors.textSecondary, fontSize: 15 },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.button,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: Colors.onBrand, fontSize: 16, fontWeight: '600' },
  cancelButton: { paddingVertical: Spacing.md, alignItems: 'center' },
  cancelButtonText: { color: Colors.textSecondary, fontSize: 16 },
});
