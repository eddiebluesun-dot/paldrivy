import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { decimalToCents } from '@/src/utils/currency';
import { displayToMeters } from '@/src/utils/units';
import {
  endShift,
  getActiveShift,
  getRecentShifts,
  startShift,
} from '@/src/services/shifts';
import { useProfile } from '@/src/hooks/useProfile';
import type { EndShiftData, Shift, ShiftPlatform } from '@/src/types';

// ─── helpers ────────────────────────────────────────────────────────────────

function secondsToHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function formatDuration(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}

// ─── end-shift modal ─────────────────────────────────────────────────────────

interface EndShiftModalProps {
  visible: boolean;
  shiftId: string;
  distanceUnit: 'km' | 'mi';
  onClose: () => void;
  onSaved: (fuelMissing: boolean) => void;
}

function EndShiftModal({
  visible,
  shiftId,
  distanceUnit,
  onClose,
  onSaved,
}: EndShiftModalProps) {
  const { t } = useTranslation();
  const [odometer, setOdometer] = useState('');
  const [platforms, setPlatforms] = useState<{ name: string; amount: string }[]>([
    { name: '', amount: '' },
  ]);
  const [tolls, setTolls] = useState('');
  const [parking, setParking] = useState('');
  const [food, setFood] = useState('');
  const [tips, setTips] = useState('');
  const [bonuses, setBonuses] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addPlatformRow() {
    setPlatforms((prev) => [...prev, { name: '', amount: '' }]);
  }

  function updatePlatform(
    index: number,
    field: 'name' | 'amount',
    value: string
  ) {
    setPlatforms((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const odometerMeters =
        odometer.trim() !== ''
          ? displayToMeters(parseFloat(odometer), distanceUnit)
          : null;

      const platformRows: ShiftPlatform[] = platforms
        .filter((p) => p.name.trim() !== '' || p.amount.trim() !== '')
        .map((p) => ({
          platform_name: p.name.trim(),
          amount_cents: decimalToCents(parseFloat(p.amount) || 0),
        }));

      const payload: EndShiftData = {
        odometer_end_meters: odometerMeters,
        platforms: platformRows,
        tolls_cents: decimalToCents(parseFloat(tolls) || 0),
        parking_cents: decimalToCents(parseFloat(parking) || 0),
        food_cents: decimalToCents(parseFloat(food) || 0),
        tips_cents: decimalToCents(parseFloat(tips) || 0),
        bonuses_cents: decimalToCents(parseFloat(bonuses) || 0),
      };

      await endShift(shiftId, payload);

      const { data } = await supabase.functions.invoke('calculate-shift', {
        body: { shift_id: shiftId },
      });

      const fuelMissing =
        data != null &&
        typeof data === 'object' &&
        'fuel_price_missing' in data &&
        data.fuel_price_missing === true;

      onSaved(fuelMissing);
    } catch (e) {
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
      onRequestClose={onClose}
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
          <Text style={styles.modalTitle}>{t('shift.end')}</Text>

          {/* Odometer */}
          <Text style={styles.label}>{t('shift.odometer_end')}</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={odometer}
            onChangeText={setOdometer}
            placeholder={distanceUnit === 'km' ? 'km' : 'mi'}
            placeholderTextColor={Colors.textSecondary}
          />

          {/* Platforms */}
          <Text style={styles.label}>{t('shift.earnings')}</Text>
          {platforms.map((row, i) => (
            <View key={i} style={styles.platformRow}>
              <TextInput
                style={[styles.input, styles.platformName]}
                placeholder={t('shift.platform_name')}
                placeholderTextColor={Colors.textSecondary}
                value={row.name}
                onChangeText={(v) => updatePlatform(i, 'name', v)}
              />
              <TextInput
                style={[styles.input, styles.platformAmount]}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.textSecondary}
                value={row.amount}
                onChangeText={(v) => updatePlatform(i, 'amount', v)}
              />
            </View>
          ))}
          <Pressable onPress={addPlatformRow} style={styles.addRow}>
            <Text style={styles.addRowText}>{t('shift.add_platform')}</Text>
          </Pressable>

          {/* Optional costs */}
          <Text style={styles.label}>{t('shift.costs')}</Text>
          {[
            { label: t('shift.tolls'), value: tolls, onChange: setTolls },
            { label: t('shift.parking'), value: parking, onChange: setParking },
            { label: t('shift.food'), value: food, onChange: setFood },
            { label: t('shift.tips'), value: tips, onChange: setTips },
            { label: t('shift.bonuses'), value: bonuses, onChange: setBonuses },
          ].map(({ label, value, onChange }) => (
            <View key={label} style={styles.costRow}>
              <Text style={styles.costLabel}>{label}</Text>
              <TextInput
                style={[styles.input, styles.costInput]}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.textSecondary}
                value={value}
                onChangeText={onChange}
              />
            </View>
          ))}

          {error !== null && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryButton, saving && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={Colors.onBrand} />
            ) : (
              <Text style={styles.primaryButtonText}>{t('shift.save')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── shift list item ─────────────────────────────────────────────────────────

interface ShiftItemProps {
  shift: Shift;
}

function ShiftItem({ shift }: ShiftItemProps) {
  const { t } = useTranslation();
  const date = new Date(shift.started_at).toLocaleDateString();
  const dur =
    shift.duration_seconds != null
      ? secondsToHMS(shift.duration_seconds)
      : shift.ended_at != null
        ? secondsToHMS(
            Math.floor(
              (new Date(shift.ended_at).getTime() -
                new Date(shift.started_at).getTime()) /
                1000
            )
          )
        : '--:--:--';

  return (
    <View style={styles.shiftItem}>
      <Text style={styles.shiftDate}>{date}</Text>
      <View style={styles.shiftMeta}>
        <Text style={styles.shiftMetaLabel}>{t('shift.duration')}</Text>
        <Text style={styles.shiftMetaValue}>{dur}</Text>
      </View>
      <View style={styles.shiftMeta}>
        <Text style={styles.shiftMetaLabel}>{t('shift.gross')}</Text>
        <Text style={styles.shiftMetaValue}>
          {shift.gross_cents != null ? (shift.gross_cents / 100).toFixed(2) : '--'}
        </Text>
      </View>
      <View style={styles.shiftMeta}>
        <Text style={styles.shiftMetaLabel}>{t('shift.net')}</Text>
        <Text style={styles.shiftMetaValue}>
          {shift.net_cents != null ? (shift.net_cents / 100).toFixed(2) : '--'}
        </Text>
      </View>
    </View>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────

export default function ShiftsScreen() {
  const { t } = useTranslation();
  const { profile } = useProfile();

  const [userId, setUserId] = useState<string | null>(null);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [recentShifts, setRecentShifts] = useState<Shift[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resolve user ID once
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // Load data whenever userId is known
  const refresh = useCallback(async () => {
    if (!userId) return;
    setScreenError(null);
    try {
      const [active, recent] = await Promise.all([
        getActiveShift(userId),
        getRecentShifts(userId, 7),
      ]);
      setActiveShift(active);
      setRecentShifts(recent);
      if (active) {
        setElapsed(formatDuration(active.started_at));
      }
    } catch {
      setScreenError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    if (userId) {
      refresh();
    }
  }, [userId, refresh]);

  // Live timer
  useEffect(() => {
    if (activeShift) {
      timerRef.current = setInterval(() => {
        setElapsed(formatDuration(activeShift.started_at));
      }, 1000);
    } else {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeShift]);

  async function handleStartShift() {
    if (!userId) return;
    setStarting(true);
    setScreenError(null);
    try {
      const shift = await startShift(userId, profile?.vehicle_id ?? null);
      setActiveShift(shift);
      setElapsed(0);
    } catch {
      setScreenError(t('common.error'));
    } finally {
      setStarting(false);
    }
  }

  function handleEndShiftPress() {
    setModalVisible(true);
  }

  async function handleShiftSaved(fuelMissing: boolean) {
    setModalVisible(false);
    setActiveShift(null);
    if (fuelMissing) {
      setNotice(t('shift.fuel_missing_notice'));
    }
    await refresh();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.brandBlue} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {notice !== null && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
          <Pressable onPress={() => setNotice(null)}>
            <Text style={styles.noticeDismiss}>×</Text>
          </Pressable>
        </View>
      )}

      {screenError !== null && (
        <Text style={styles.errorText}>{screenError}</Text>
      )}

      {activeShift !== null ? (
        <View style={styles.activeSection}>
          <Text style={styles.timerLabel}>{t('dashboard.active_shift')}</Text>
          <Text style={styles.timer}>{secondsToHMS(elapsed)}</Text>
          <TouchableOpacity
            style={styles.endButton}
            onPress={handleEndShiftPress}
          >
            <Text style={styles.primaryButtonText}>{t('shift.end')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.primaryButton, starting && styles.buttonDisabled]}
          onPress={handleStartShift}
          disabled={starting}
        >
          {starting ? (
            <ActivityIndicator color={Colors.onBrand} />
          ) : (
            <Text style={styles.primaryButtonText}>{t('shift.start')}</Text>
          )}
        </TouchableOpacity>
      )}

      <Text style={styles.sectionTitle}>{t('tabs.shifts')}</Text>

      {recentShifts.length === 0 ? (
        <Text style={styles.emptyText}>{t('shift.no_shifts')}</Text>
      ) : (
        <FlatList
          data={recentShifts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ShiftItem shift={item} />}
          style={styles.list}
        />
      )}

      {activeShift !== null && (
        <EndShiftModal
          visible={modalVisible}
          shiftId={activeShift.id}
          distanceUnit={profile?.distance_unit ?? 'km'}
          onClose={() => setModalVisible(false)}
          onSaved={handleShiftSaved}
        />
      )}
    </View>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
  activeSection: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  timerLabel: {
    color: Colors.textSecondary,
    fontSize: 14,
    marginBottom: Spacing.xs,
  },
  timer: {
    color: Colors.textPrimary,
    fontSize: 48,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
    marginBottom: Spacing.md,
    ...Platform.select({
      ios: { fontFamily: 'Menlo' },
      android: { fontFamily: 'monospace' },
    }),
  },
  primaryButton: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.button,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  endButton: {
    backgroundColor: Colors.error,
    borderRadius: Radius.button,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
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
    marginTop: Spacing.sm,
  },
  cancelButtonText: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  emptyText: {
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
  list: {
    flex: 1,
  },
  shiftItem: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  shiftDate: {
    color: Colors.textPrimary,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  shiftMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  shiftMetaLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
  shiftMetaValue: {
    color: Colors.textPrimary,
    fontSize: 13,
  },
  notice: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.input,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 3,
    borderLeftColor: Colors.brandBlue,
  },
  noticeText: {
    color: Colors.textPrimary,
    flex: 1,
    fontSize: 13,
  },
  noticeDismiss: {
    color: Colors.textSecondary,
    fontSize: 20,
    marginLeft: Spacing.sm,
  },
  errorText: {
    color: Colors.error,
    marginBottom: Spacing.sm,
    textAlign: 'center',
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
  platformRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  platformName: {
    flex: 1,
    marginBottom: 0,
  },
  platformAmount: {
    width: 100,
    marginBottom: 0,
  },
  addRow: {
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  addRowText: {
    color: Colors.brandBlue,
    fontSize: 14,
    fontWeight: '600',
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
    gap: Spacing.sm,
  },
  costLabel: {
    color: Colors.textSecondary,
    fontSize: 14,
    flex: 1,
  },
  costInput: {
    width: 110,
    marginBottom: 0,
  },
});
