import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { useTranslation } from 'react-i18next';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { decimalToCents } from '@/src/utils/currency';
import { displayToMeters, displayToMl, mlToDisplay } from '@/src/utils/units';
import { addFuelEntry, getFuelEntries } from '@/src/services/fuel';
import { useProfile } from '@/src/hooks/useProfile';
import type { FuelEntry } from '@/src/services/fuel';

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

// ─── add-fuel modal ───────────────────────────────────────────────────────────

interface AddFuelModalProps {
  visible: boolean;
  userId: string;
  vehicleId: string | null;
  distanceUnit: 'km' | 'mi';
  volumeUnit: 'liters' | 'gallons';
  onClose: () => void;
  onSaved: () => void;
}

function AddFuelModal({
  visible,
  userId,
  vehicleId,
  distanceUnit,
  volumeUnit,
  onClose,
  onSaved,
}: AddFuelModalProps) {
  const { t } = useTranslation();

  const [odometer, setOdometer] = useState('');
  const [volume, setVolume] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [fullTank, setFullTank] = useState(false);
  const [station, setStation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setOdometer('');
    setVolume('');
    setTotalAmount('');
    setFullTank(false);
    setStation('');
    setError(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  const volumeDisplay = parseFloat(volume.replace(',', '.')) || 0;
  const totalCents = decimalToCents(parseFloat(totalAmount.replace(',', '.')) || 0);
  const pricePerUnitCents =
    volumeDisplay > 0 ? Math.round(totalCents / volumeDisplay) : 0;
  const pricePerUnitLabel =
    volumeUnit === 'gallons'
      ? t('fuel.price_per_unit_gal')
      : t('fuel.price_per_unit');
  const volumeLabel =
    volumeUnit === 'gallons' ? t('onboarding.vol_gallons') : t('onboarding.vol_liters');

  async function handleSave() {
    setError(null);

    const volumeNum = parseFloat(volume);
    const totalNum = parseFloat(totalAmount);

    if (!volume.trim() || isNaN(volumeNum) || volumeNum <= 0) {
      setError(t('common.required'));
      return;
    }
    if (!totalAmount.trim() || isNaN(totalNum) || totalNum <= 0) {
      setError(t('common.required'));
      return;
    }

    setSaving(true);
    try {
      const odometerMeters =
        odometer.trim() !== ''
          ? displayToMeters(parseFloat(odometer), distanceUnit)
          : null;

      const volumeMl = displayToMl(volumeNum, volumeUnit);
      const totalCostCents = decimalToCents(totalNum);
      const pricePerUnit =
        volumeNum > 0 ? Math.round(totalCostCents / volumeNum) : 0;

      await addFuelEntry({
        user_id: userId,
        vehicle_id: vehicleId,
        odometer_meters: odometerMeters,
        volume_ml: volumeMl,
        total_cost_cents: totalCostCents,
        price_per_unit_cents: pricePerUnit,
        full_tank: fullTank,
        station: station.trim() !== '' ? station.trim() : null,
        filled_at: new Date().toISOString(),
      });

      resetForm();
      onSaved();
    } catch (e) {
      console.error('addFuelEntry failed:', e);
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalWrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.modalTitle}>{t('fuel.add')}</Text>

          {/* Odometer */}
          <Text style={styles.label}>{t('fuel.odometer')}</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={odometer}
            onChangeText={setOdometer}
            placeholder={distanceUnit === 'km' ? 'km' : 'mi'}
            placeholderTextColor={Colors.textSecondary}
          />

          {/* Volume */}
          <Text style={styles.label}>{volumeLabel}</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={volume}
            onChangeText={setVolume}
            placeholder="0.00"
            placeholderTextColor={Colors.textSecondary}
          />

          {/* Total amount */}
          <Text style={styles.label}>{t('fuel.total')}</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={totalAmount}
            onChangeText={setTotalAmount}
            placeholder="0.00"
            placeholderTextColor={Colors.textSecondary}
          />

          {/* Price per unit (calculated, display-only) */}
          <Text style={styles.label}>{pricePerUnitLabel}</Text>
          <View style={styles.readonlyInput}>
            <Text style={styles.readonlyText}>
              {pricePerUnitCents > 0
                ? (pricePerUnitCents / 100).toFixed(3)
                : '--'}
            </Text>
          </View>

          {/* Full tank toggle */}
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('fuel.full_tank')}</Text>
            <Switch
              value={fullTank}
              onValueChange={setFullTank}
              trackColor={{ true: Colors.brandBlue, false: Colors.border }}
              thumbColor={Colors.onBrand}
            />
          </View>

          {/* Station name */}
          <Text style={styles.label}>{t('fuel.station')}</Text>
          <TextInput
            style={styles.input}
            value={station}
            onChangeText={setStation}
            placeholder={t('fuel.station')}
            placeholderTextColor={Colors.textSecondary}
          />

          {error !== null && (
            <Text style={styles.errorText}>{error}</Text>
          )}

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

          <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── fuel entry list item ─────────────────────────────────────────────────────

interface FuelItemProps {
  entry: FuelEntry;
  volumeUnit: 'liters' | 'gallons';
}

function FuelItem({ entry, volumeUnit }: FuelItemProps) {
  const { t } = useTranslation();
  const volumeDisplay = mlToDisplay(entry.volume_ml, volumeUnit).toFixed(2);
  const pricePerUnitLabel =
    volumeUnit === 'gallons'
      ? t('fuel.price_per_unit_gal')
      : t('fuel.price_per_unit');
  const pricePerUnit = (entry.price_per_unit_cents / 100).toFixed(3);
  const total = (entry.total_cost_cents / 100).toFixed(2);
  const date = formatDate(entry.filled_at);

  return (
    <View style={styles.entryItem}>
      <View style={styles.entryHeader}>
        <Text style={styles.entryDate}>{date}</Text>
        {entry.station !== null && entry.station !== '' && (
          <Text style={styles.entryStation}>{entry.station}</Text>
        )}
      </View>
      <View style={styles.entryRow}>
        <Text style={styles.entryLabel}>{t('fuel.volume')}</Text>
        <Text style={styles.entryValue}>{volumeDisplay}</Text>
      </View>
      <View style={styles.entryRow}>
        <Text style={styles.entryLabel}>{pricePerUnitLabel}</Text>
        <Text style={styles.entryValue}>{pricePerUnit}</Text>
      </View>
      <View style={styles.entryRow}>
        <Text style={styles.entryLabel}>{t('fuel.total')}</Text>
        <Text style={styles.entryValue}>{total}</Text>
      </View>
    </View>
  );
}

// ─── main screen ──────────────────────────────────────────────────────────────

export default function FuelScreen() {
  const { t } = useTranslation();
  const { profile } = useProfile();

  const [userId, setUserId] = useState<string | null>(null);
  const [entries, setEntries] = useState<FuelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  const loadEntries = useCallback(async () => {
    if (!userId) return;
    setScreenError(null);
    try {
      const data = await getFuelEntries(userId, 30);
      setEntries(data);
    } catch (e) {
      console.error('getFuelEntries failed:', e);
      setScreenError(t('common.error'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, t]);

  useEffect(() => {
    if (userId) {
      loadEntries();
    }
  }, [userId, loadEntries]);

  function handleRefresh() {
    setRefreshing(true);
    loadEntries();
  }

  function handleSaved() {
    setModalVisible(false);
    loadEntries();
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
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setModalVisible(true)}
          >
            <Text style={styles.addButtonText}>{t('fuel.add')}</Text>
          </TouchableOpacity>
        </View>

        {screenError !== null && (
          <Text style={styles.errorText}>{screenError}</Text>
        )}

        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FuelItem entry={item} volumeUnit={volumeUnit} />
          )}
          style={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.brandBlue}
            />
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>{t('fuel.no_entries')}</Text>
          }
        />

        {userId !== null && (
          <AddFuelModal
            visible={modalVisible}
            userId={userId}
            vehicleId={profile?.vehicle_id ?? null}
            distanceUnit={distanceUnit}
            volumeUnit={volumeUnit}
            onClose={() => setModalVisible(false)}
            onSaved={handleSaved}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.md,
  },
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
  title: {
    color: Colors.textPrimary,
    fontSize: 22,
    fontWeight: 'bold',
  },
  addButton: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.button,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  addButtonText: {
    color: Colors.onBrand,
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: Colors.error,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  emptyText: {
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
  entryItem: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  entryDate: {
    color: Colors.textPrimary,
    fontWeight: '600',
    fontSize: 14,
  },
  entryStation: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  entryLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
  entryValue: {
    color: Colors.textPrimary,
    fontSize: 13,
  },
  // Modal styles
  modalWrapper: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalScroll: {
    flex: 1,
  },
  modalContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
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
  readonlyText: {
    color: Colors.textSecondary,
    fontSize: 15,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  switchLabel: {
    color: Colors.textPrimary,
    fontSize: 15,
  },
  primaryButton: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.button,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: Colors.onBrand,
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
});
