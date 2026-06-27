import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { decimalToCents } from '@/src/utils/currency';
import { displayToMeters } from '@/src/utils/units';
import {
  deleteShift,
  endShift,
  getActiveShift,
  getRecentShifts,
  startShift,
} from '@/src/services/shifts';
import { useProfile } from '@/src/hooks/useProfile';
import type { EndShiftData, Shift, ShiftPlatform } from '@/src/types';

function platformConfirm(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Confirmar', style: 'destructive', onPress: onConfirm },
    ]);
  }
}

function secondsToHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function formatDuration(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}

// ─── start-shift modal ───────────────────────────────────────────────────────

interface StartShiftModalProps {
  visible: boolean;
  distanceUnit: 'km' | 'mi';
  onClose: () => void;
  onConfirm: (odometerMeters: number | null) => void;
}

function StartShiftModal({ visible, distanceUnit, onClose, onConfirm }: StartShiftModalProps) {
  const { t } = useTranslation();
  const [odometer, setOdometer] = useState('');

  function handleStart() {
    const raw = odometer.replace(',', '.').trim();
    const meters = raw !== '' ? displayToMeters(parseFloat(raw), distanceUnit) : null;
    onConfirm(meters);
    setOdometer('');
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalWrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalTitle}>{t('shift.start')}</Text>

          <Text style={styles.fieldLabel}>{t('shift.odometer_start')}</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={odometer}
            onChangeText={setOdometer}
            placeholder={distanceUnit === 'km' ? 'km' : 'mi'}
            placeholderTextColor={Colors.textSecondary}
            autoFocus
          />
          <Text style={styles.odometerHint}>{t('shift.odometer_start_hint')}</Text>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleStart}>
            <Ionicons name="play-circle-outline" size={20} color={Colors.onAccent} />
            <Text style={styles.primaryBtnText}>{t('shift.start_confirm')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── end-shift modal ──────────────────────────────────────────────────────────

interface EndShiftModalProps {
  visible: boolean;
  shiftId: string;
  distanceUnit: 'km' | 'mi';
  onClose: () => void;
  onSaved: (fuelMissing: boolean) => void;
}

function EndShiftModal({ visible, shiftId, distanceUnit, onClose, onSaved }: EndShiftModalProps) {
  const { t } = useTranslation();
  const [odometer, setOdometer] = useState('');
  const [platforms, setPlatforms] = useState<{ name: string; amount: string }[]>([{ name: '', amount: '' }]);
  const [tolls, setTolls] = useState('');
  const [parking, setParking] = useState('');
  const [food, setFood] = useState('');
  const [tips, setTips] = useState('');
  const [bonuses, setBonuses] = useState('');
  const [ridesCount, setRidesCount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addPlatformRow() { setPlatforms(prev => [...prev, { name: '', amount: '' }]); }

  function updatePlatform(index: number, field: 'name' | 'amount', value: string) {
    setPlatforms(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const odometerMeters = odometer.trim() !== ''
        ? displayToMeters(parseFloat(odometer), distanceUnit)
        : null;
      const platformRows: ShiftPlatform[] = platforms
        .filter(p => p.name.trim() !== '' || p.amount.trim() !== '')
        .map(p => ({ platform_name: p.name.trim(), amount_cents: decimalToCents(parseFloat(p.amount) || 0) }));
      const payload: EndShiftData = {
        odometer_end_meters: odometerMeters,
        platforms: platformRows,
        tolls_cents: decimalToCents(parseFloat(tolls) || 0),
        parking_cents: decimalToCents(parseFloat(parking) || 0),
        food_cents: decimalToCents(parseFloat(food) || 0),
        tips_cents: decimalToCents(parseFloat(tips) || 0),
        bonuses_cents: decimalToCents(parseFloat(bonuses) || 0),
        rides_count: ridesCount.trim() !== '' ? parseInt(ridesCount, 10) : null,
      };
      await endShift(shiftId, payload);
      const { data, error: calcError } = await supabase.functions.invoke('calculate-shift', { body: { shift_id: shiftId } });
      if (calcError) throw calcError;
      const fuelMissing = data != null && typeof data === 'object' && 'fuel_price_missing' in data && data.fuel_price_missing === true;
      onSaved(fuelMissing);
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalWrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalTitle}>{t('shift.end')}</Text>

          <Text style={styles.fieldLabel}>{t('shift.odometer_end')}</Text>
          <TextInput
            style={styles.input} keyboardType="decimal-pad"
            value={odometer} onChangeText={setOdometer}
            placeholder={distanceUnit === 'km' ? 'km' : 'mi'}
            placeholderTextColor={Colors.textSecondary}
          />

          <Text style={styles.fieldLabel}>{t('shift.earnings')}</Text>
          {platforms.map((row, i) => (
            <View key={i} style={styles.platformRow}>
              <TextInput
                style={[styles.input, styles.platformName]}
                placeholder={t('shift.platform_name')} placeholderTextColor={Colors.textSecondary}
                value={row.name} onChangeText={v => updatePlatform(i, 'name', v)}
              />
              <TextInput
                style={[styles.input, styles.platformAmount]}
                keyboardType="decimal-pad" placeholder="0.00"
                placeholderTextColor={Colors.textSecondary}
                value={row.amount} onChangeText={v => updatePlatform(i, 'amount', v)}
              />
            </View>
          ))}
          <Pressable onPress={addPlatformRow} style={styles.addRow}>
            <Ionicons name="add-circle-outline" size={16} color={Colors.accent} />
            <Text style={styles.addRowText}>{t('shift.add_platform')}</Text>
          </Pressable>

          <Text style={styles.fieldLabel}>{t('shift.rides_count_label')}</Text>
          <TextInput
            style={styles.input} keyboardType="number-pad"
            value={ridesCount} onChangeText={setRidesCount}
            placeholder="0" placeholderTextColor={Colors.textSecondary}
          />

          <Text style={styles.fieldLabel}>{t('shift.costs')}</Text>
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
                keyboardType="decimal-pad" placeholder="0.00"
                placeholderTextColor={Colors.textSecondary}
                value={value} onChangeText={onChange}
              />
            </View>
          ))}

          {error !== null && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, saving && styles.btnDisabled]}
            onPress={handleSave} disabled={saving}
          >
            {saving ? <ActivityIndicator color={Colors.onAccent} /> : <Text style={styles.primaryBtnText}>{t('shift.save')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── shift list item ──────────────────────────────────────────────────────────

interface ShiftItemProps {
  shift: Shift;
  onDelete: (id: string) => void;
}

function ShiftItem({ shift, onDelete }: ShiftItemProps) {
  const { t } = useTranslation();
  const { profile } = useProfile();
  const distUnit = profile?.distance_unit ?? 'km';
  const date = new Date(shift.started_at).toLocaleDateString('pt-BR');
  const dur = shift.duration_seconds != null
    ? secondsToHMS(shift.duration_seconds)
    : shift.ended_at != null
      ? secondsToHMS(Math.floor((new Date(shift.ended_at).getTime() - new Date(shift.started_at).getTime()) / 1000))
      : '--:--:--';
  const kmStart = shift.odometer_start_meters != null
    ? `${(shift.odometer_start_meters / (distUnit === 'km' ? 1000 : 1609.344)).toFixed(0)} ${distUnit}`
    : null;
  const kmEnd = shift.odometer_end_meters != null
    ? `${(shift.odometer_end_meters / (distUnit === 'km' ? 1000 : 1609.344)).toFixed(0)} ${distUnit}`
    : null;

  function confirmDelete() {
    platformConfirm(t('shift.delete_title'), t('shift.delete_confirm'), () => onDelete(shift.id));
  }

  return (
    <View style={styles.shiftCard}>
      <View style={styles.shiftAccent} />
      <View style={styles.shiftBody}>
        <View style={styles.shiftHeader}>
          <Text style={styles.shiftDate}>{date}</Text>
          <TouchableOpacity onPress={confirmDelete} style={styles.deleteBtn} accessibilityLabel={t('shift.delete_title')}>
            <Ionicons name="trash-outline" size={16} color={Colors.error} />
          </TouchableOpacity>
        </View>
        <View style={styles.shiftStats}>
          <View style={styles.shiftStat}>
            <Text style={styles.statLabel}>{t('shift.duration')}</Text>
            <Text style={styles.statValue}>{dur}</Text>
          </View>
          <View style={styles.shiftStat}>
            <Text style={styles.statLabel}>{t('shift.gross')}</Text>
            <Text style={[styles.statValue, { color: Colors.accent }]}>
              {shift.gross_cents != null ? (shift.gross_cents / 100).toFixed(2) : '--'}
            </Text>
          </View>
          <View style={styles.shiftStat}>
            <Text style={styles.statLabel}>{t('shift.net')}</Text>
            <Text style={[styles.statValue, { color: Colors.success }]}>
              {shift.net_cents != null ? (shift.net_cents / 100).toFixed(2) : '--'}
            </Text>
          </View>
        </View>
        {(kmStart != null || kmEnd != null) && (
          <View style={styles.kmRow}>
            <Ionicons name="speedometer-outline" size={12} color={Colors.textSecondary} />
            <Text style={styles.kmText}>
              {kmStart ?? '?'} → {kmEnd ?? '?'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── main screen ──────────────────────────────────────────────────────────────

export default function ShiftsScreen() {
  const { t } = useTranslation();
  const { profile } = useProfile();

  const [userId, setUserId] = useState<string | null>(null);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [recentShifts, setRecentShifts] = useState<Shift[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startModalVisible, setStartModalVisible] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setScreenError(null);
    try {
      const [active, recent] = await Promise.all([getActiveShift(userId), getRecentShifts(userId, 7)]);
      setActiveShift(active);
      setRecentShifts(recent);
      if (active) setElapsed(formatDuration(active.started_at));
    } catch {
      setScreenError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => { if (userId) refresh(); }, [userId, refresh]);

  useEffect(() => {
    if (activeShift) {
      timerRef.current = setInterval(() => setElapsed(formatDuration(activeShift.started_at)), 1000);
    } else {
      if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [activeShift]);

  async function handleStartShift(odometerMeters: number | null) {
    if (!userId) return;
    setStartModalVisible(false);
    setStarting(true);
    setScreenError(null);
    try {
      const shift = await startShift(userId, profile?.vehicle_id ?? null, odometerMeters);
      setActiveShift(shift);
      setElapsed(0);
    } catch {
      setScreenError(t('common.error'));
    } finally {
      setStarting(false);
    }
  }

  async function handleShiftSaved(fuelMissing: boolean) {
    setModalVisible(false);
    setActiveShift(null);
    if (fuelMissing) setNotice(t('shift.fuel_missing_notice'));
    await refresh();
  }

  function handleDiscardShift() {
    platformConfirm(t('shift.discard_title'), t('shift.discard_confirm'), async () => {
      if (!activeShift) return;
      try {
        await deleteShift(activeShift.id);
        setActiveShift(null);
        setElapsed(0);
      } catch {
        setScreenError(t('common.error'));
      }
    });
  }

  async function handleDeleteShift(shiftId: string) {
    try {
      await deleteShift(shiftId);
      setRecentShifts(prev => prev.filter(s => s.id !== shiftId));
    } catch {
      setScreenError(t('common.error'));
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.screenTitle}>{t('tabs.shifts')}</Text>

        {notice !== null && (
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.brandBlue} />
            <Text style={styles.noticeText}>{notice}</Text>
            <Pressable onPress={() => setNotice(null)} style={styles.noticeDismiss}>
              <Ionicons name="close" size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>
        )}

        {screenError !== null && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{screenError}</Text>
          </View>
        )}

        {activeShift !== null ? (
          <View style={styles.activeCard}>
            <View style={styles.activeCardTop}>
              <View style={styles.activeDotRow}>
                <View style={styles.activeDot} />
                <Text style={styles.activeLabel}>TURNO ATIVO</Text>
              </View>
            </View>
            <Text style={styles.timer}>{secondsToHMS(elapsed)}</Text>
            <TouchableOpacity style={styles.endBtn} onPress={() => setModalVisible(true)}>
              <Ionicons name="stop-circle-outline" size={20} color={Colors.onAccent} />
              <Text style={styles.endBtnText}>{t('shift.end')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.discardBtn} onPress={handleDiscardShift}>
              <Ionicons name="trash-outline" size={16} color={Colors.error} />
              <Text style={styles.discardBtnText}>{t('shift.discard')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.startBtn, starting && styles.btnDisabled]}
            onPress={() => setStartModalVisible(true)} disabled={starting}
          >
            {starting ? <ActivityIndicator color={Colors.onAccent} /> : (
              <>
                <Ionicons name="play-circle-outline" size={22} color={Colors.onAccent} />
                <Text style={styles.startBtnText}>{t('shift.start')}</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>{t('shift.recent')}</Text>

        {recentShifts.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="car-outline" size={40} color={Colors.borderBright} />
            <Text style={styles.emptyText}>{t('shift.no_shifts')}</Text>
          </View>
        ) : (
          recentShifts.map(item => (
            <ShiftItem key={item.id} shift={item} onDelete={handleDeleteShift} />
          ))
        )}
      </ScrollView>

      <StartShiftModal
        visible={startModalVisible}
        distanceUnit={profile?.distance_unit ?? 'km'}
        onClose={() => setStartModalVisible(false)}
        onConfirm={handleStartShift}
      />

      {activeShift !== null && (
        <EndShiftModal
          visible={modalVisible}
          shiftId={activeShift.id}
          distanceUnit={profile?.distance_unit ?? 'km'}
          onClose={() => setModalVisible(false)}
          onSaved={handleShiftSaved}
        />
      )}
    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  center: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },

  screenTitle: { color: Colors.textPrimary, fontSize: 26, fontWeight: '800', marginBottom: Spacing.lg, letterSpacing: -0.5 },

  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input,
    padding: Spacing.md, marginBottom: Spacing.md,
    borderLeftWidth: 3, borderLeftColor: Colors.brandBlue,
  },
  noticeText: { color: Colors.textPrimary, flex: 1, fontSize: 13 },
  noticeDismiss: { padding: 4 },

  errorBanner: {
    backgroundColor: Colors.errorBg, borderRadius: Radius.input,
    padding: Spacing.sm, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
  },
  errorText: { color: Colors.error, fontSize: 13, textAlign: 'center' },

  // Active shift card
  activeCard: {
    backgroundColor: Colors.surface, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
    padding: Spacing.lg, marginBottom: Spacing.lg, alignItems: 'center',
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2, shadowRadius: 20, elevation: 8,
  },
  activeCardTop: { width: '100%', marginBottom: Spacing.md },
  activeDotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  activeLabel: { color: Colors.success, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },

  timer: {
    fontSize: 56, fontWeight: '800', color: Colors.accent,
    fontVariant: ['tabular-nums'],
    letterSpacing: 2, marginBottom: Spacing.lg,
    ...Platform.select({
      ios: { fontFamily: 'Menlo' },
      android: { fontFamily: 'monospace' },
    }),
  },

  endBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: Radius.button, paddingVertical: 14, paddingHorizontal: Spacing.xl,
    width: '100%', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  endBtnText: { color: Colors.onAccent, fontSize: 16, fontWeight: '800' },

  discardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: Radius.button, paddingVertical: 12,
    paddingHorizontal: Spacing.xl, width: '100%', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(239,68,68,0.4)',
  },
  discardBtnText: { color: Colors.error, fontSize: 14, fontWeight: '600' },

  // Start button
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.accent, borderRadius: Radius.button,
    paddingVertical: 16, marginBottom: Spacing.lg,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  startBtnText: { color: Colors.onAccent, fontSize: 17, fontWeight: '800' },
  btnDisabled: { opacity: 0.6 },

  sectionTitle: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: Spacing.sm,
  },

  emptyState: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  emptyText: { color: Colors.textSecondary, fontSize: 14 },

  // Shift item card
  shiftCard: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderRadius: 14, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  shiftAccent: { width: 4, backgroundColor: Colors.accent },
  shiftBody: { flex: 1, padding: Spacing.md },
  shiftHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  shiftDate: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  deleteBtn: { padding: 6, marginRight: -4 },
  shiftStats: { flexDirection: 'row', gap: Spacing.md },
  shiftStat: { flex: 1 },
  statLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  statValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  kmRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.xs },
  kmText: { color: Colors.textSecondary, fontSize: 11, fontVariant: ['tabular-nums'] },

  // Modal
  modalWrapper: { flex: 1, backgroundColor: Colors.background },
  modalScroll: { flex: 1 },
  modalContent: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  modalTitle: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: Spacing.lg },
  fieldLabel: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginTop: Spacing.md, marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input,
    borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2, fontSize: 15, marginBottom: Spacing.xs, minHeight: 48,
  },
  platformRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xs },
  platformName: { flex: 1, marginBottom: 0 },
  platformAmount: { width: 100, marginBottom: 0 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.sm, marginBottom: Spacing.sm },
  addRowText: { color: Colors.accent, fontSize: 14, fontWeight: '600' },
  costRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.xs, gap: Spacing.sm },
  costLabel: { color: Colors.textSecondary, fontSize: 14, flex: 1 },
  costInput: { width: 110, marginBottom: 0 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.accent, borderRadius: Radius.button,
    minHeight: 52, marginTop: Spacing.sm,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  primaryBtnText: { color: Colors.onAccent, fontSize: 16, fontWeight: '800' },
  odometerHint: {
    color: Colors.textSecondary, fontSize: 12, marginTop: -Spacing.xs,
    marginBottom: Spacing.md, paddingHorizontal: 2,
  },
  cancelBtn: { paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.sm },
  cancelBtnText: { color: Colors.textSecondary, fontSize: 15 },
});
