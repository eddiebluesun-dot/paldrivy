import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { decimalToCents } from '@/src/utils/currency';
import { displayToMeters } from '@/src/utils/units';
import {
  deleteShift,
  endShift,
  FreeLimitError,
  getActiveShift,
  getRecentShifts,
  pauseShift,
  resumeShift,
  startShift,
  updateShift,
} from '@/src/services/shifts';
import { getUserPlatforms } from '@/src/services/platforms';
import { getEffectiveVehicleId } from '@/src/services/vehicles';
import { reconcileShiftPlatforms } from '@/src/utils/shiftReconciliationUtils';
import type { ShiftPause } from '@/src/types';
import { useProfile } from '@/src/hooks/useProfile';
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { useCumulativeDayTotalDefault } from '@/src/hooks/useCumulativeDayTotalDefault';
import { UpgradeModal } from '@/src/components/UpgradeModal';
import type { EndShiftData, MoodRating, Shift, ShiftPlatform } from '@/src/types';

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

function pausedSeconds(pauses: ShiftPause[]): number {
  return pauses.reduce((sum, p) => {
    const end = p.ended_at ? new Date(p.ended_at) : new Date();
    return sum + Math.floor((end.getTime() - new Date(p.started_at).getTime()) / 1000);
  }, 0);
}

function activeDuration(startedAt: string, pauses: ShiftPause[]): number {
  return Math.max(formatDuration(startedAt) - pausedSeconds(pauses), 0);
}

function parse(s: string): number {
  return parseFloat(s.replace(',', '.')) || 0;
}

// ─── start shift modal ────────────────────────────────────────────────────────

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
            style={styles.input} keyboardType="decimal-pad"
            value={odometer} onChangeText={setOdometer}
            placeholder={distanceUnit === 'km' ? 'km' : 'mi'}
            placeholderTextColor={Colors.textSecondary} autoFocus
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

// ─── shift form modal (end + edit) ───────────────────────────────────────────

interface ShiftFormModalProps {
  visible: boolean;
  mode: 'end' | 'edit';
  shiftId: string;
  startedAt?: string;
  existingShift?: Shift;
  distanceUnit: 'km' | 'mi';
  pauses?: ShiftPause[];
  // Other shifts loaded on screen (recent + active), used to detect whether
  // there's already an earlier completed shift the same day — see
  // shiftReconciliationUtils.ts for why that matters.
  otherShifts?: Shift[];
  onClose: () => void;
  onSaved: () => void;
}

function ShiftFormModal({ visible, mode, shiftId, startedAt, existingShift, distanceUnit, pauses, otherShifts, onClose, onSaved }: ShiftFormModalProps) {
  const { t } = useTranslation();
  const [odometer, setOdometer] = useState('');
  const [platforms, setPlatforms] = useState<{ name: string; amount: string; rides: string }[]>([{ name: '', amount: '', rides: '' }]);
  const [tips, setTips] = useState('');
  const [bonuses, setBonuses] = useState('');
  const [mood, setMood] = useState<MoodRating | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editStartedAt, setEditStartedAt] = useState('');
  const [editEndedAt, setEditEndedAt] = useState('');
  // Confirms the amounts just entered are the platform's cumulative total
  // for the whole day (what Uber/99/etc. show), not this shift's isolated
  // earnings. Auto-defaults to checked whenever a completed shift already
  // exists earlier the same day (see useCumulativeDayTotalDefault below) —
  // that's the common case this fix exists for — but the driver can still
  // uncheck it if they know the value they entered is genuinely isolated.
  const [isCumulativeDayTotal, setIsCumulativeDayTotal] = useState(false);

  const { priorSameDayPlatforms, hasPriorSameDayShift, defaultChecked: cumulativeDayTotalDefault } =
    useCumulativeDayTotalDefault(otherShifts, mode === 'end' ? startedAt : existingShift?.started_at, shiftId);

  // Load saved platforms to pre-fill the end-shift form
  useEffect(() => {
    if (!visible || mode !== 'end') return;
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      getUserPlatforms(data.user.id).then(saved => {
        if (saved.length > 0) {
          setPlatforms(saved.map(p => ({ name: p.platform_name, amount: '', rides: '' })));
        }
      }).catch(() => {});
    });
  }, [visible, mode]);

  function isoToDisplay(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function displayToIso(display: string): string | undefined {
    // expects DD/MM/YYYY HH:mm
    const m = display.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (!m) return undefined;
    const [, dd, mm, yyyy, hh, min] = m;
    const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd), parseInt(hh), parseInt(min));
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  useEffect(() => {
    if (!visible) return;
    if (mode === 'edit' && existingShift) {
      const div = distanceUnit === 'km' ? 1000 : 1609.344;
      setOdometer(existingShift.odometer_end_meters != null ? (existingShift.odometer_end_meters / div).toFixed(0) : '');
      setPlatforms(
        existingShift.platforms?.length
          ? existingShift.platforms.map((p) => ({
              name: p.platform_name,
              amount: (p.amount_cents / 100).toFixed(2),
              rides: p.rides_count != null ? String(p.rides_count) : '',
            }))
          : [{ name: '', amount: '', rides: '' }]
      );
      setTips(existingShift.tips_cents ? (existingShift.tips_cents / 100).toFixed(2) : '');
      setBonuses(existingShift.bonuses_cents ? (existingShift.bonuses_cents / 100).toFixed(2) : '');
      setMood(existingShift.mood_rating ?? null);
      setNotes(existingShift.notes ?? '');
      setEditStartedAt(isoToDisplay(existingShift.started_at));
      setEditEndedAt(isoToDisplay(existingShift.ended_at));
    } else {
      setOdometer('');
      setPlatforms([{ name: '', amount: '', rides: '' }]);
      setTips('');
      setBonuses('');
      setMood(null);
      setNotes('');
      setEditStartedAt('');
      setEditEndedAt('');
    }
    setIsCumulativeDayTotal(cumulativeDayTotalDefault);
    setError(null);
  }, [visible, shiftId, mode, distanceUnit, cumulativeDayTotalDefault]);

  function updatePlatform(index: number, field: 'name' | 'amount' | 'rides', value: string) {
    setPlatforms((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  async function handleSave() {
    setError(null);
    if (mode === 'end') {
      if (!odometer.trim()) {
        setError(t('shift.validation_odometer_required'));
        return;
      }
      const validPlatforms = platforms.filter(p => p.name.trim() && p.amount.trim() && parse(p.amount) > 0);
      if (validPlatforms.length === 0) {
        setError(t('shift.validation_platform_required'));
        return;
      }
      if (validPlatforms.some(p => !p.rides.trim() || parseInt(p.rides, 10) <= 0)) {
        setError(t('shift.validation_rides_required'));
        return;
      }
    }
    setSaving(true);
    try {
      const odometerMeters = odometer.trim() ? displayToMeters(parse(odometer), distanceUnit) : null;
      const rawPlatformRows: ShiftPlatform[] = platforms
        .filter((p) => p.name.trim() !== '' || p.amount.trim() !== '')
        .map((p) => ({
          platform_name: p.name.trim(),
          amount_cents: decimalToCents(parse(p.amount)),
          rides_count: p.rides.trim() ? parseInt(p.rides, 10) : undefined,
        }));
      // If the driver confirmed these amounts are the platform's cumulative
      // total for the day (not this shift alone), subtract what's already
      // logged earlier the same day per platform -- rides_count included,
      // same reconciliation rule as amount_cents. See
      // shiftReconciliationUtils.ts for the full rationale.
      const platformRows = reconcileShiftPlatforms(rawPlatformRows, priorSameDayPlatforms, isCumulativeDayTotal);
      // Shift-level rides_count is derived from the per-platform rows rather
      // than typed separately, so there's a single source of truth (matches
      // gross_cents, which is likewise derived from platforms elsewhere).
      const totalRides = platformRows.reduce((s, p) => s + (p.rides_count ?? 0), 0);
      const payload: EndShiftData = {
        odometer_end_meters: odometerMeters,
        platforms: platformRows,
        tolls_cents: 0,
        parking_cents: 0,
        food_cents: 0,
        tips_cents: decimalToCents(parse(tips)),
        bonuses_cents: decimalToCents(parse(bonuses)),
        rides_count: totalRides > 0 ? totalRides : null,
        mood_rating: mood,
        notes: notes.trim() || null,
      };
      if (mode === 'end') {
        await endShift(shiftId, payload, startedAt, pauses ?? []);
      } else {
        const parsedStart = editStartedAt.trim() ? displayToIso(editStartedAt) : existingShift?.started_at;
        const parsedEnd = editEndedAt.trim() ? displayToIso(editEndedAt) : existingShift?.ended_at;
        if ((editStartedAt.trim() && !parsedStart) || (editEndedAt.trim() && !parsedEnd)) {
          setError(t('shift.time_format_hint'));
          setSaving(false);
          return;
        }
        await updateShift(shiftId, payload, parsedStart, parsedEnd ?? undefined);
      }
      // Edge Function enriches with fuel cost — non-blocking
      supabase.functions.invoke('calculate-shift', { body: { shift_id: shiftId } }).catch(() => {});
      onSaved();
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  const title = mode === 'end' ? t('shift.end') : t('shift.edit');

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalWrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalTitle}>{title}</Text>

          {mode === 'edit' && (
            <>
              <Text style={styles.fieldLabel}>{t('shift.start_time')}</Text>
              <TextInput
                style={styles.input}
                value={editStartedAt}
                onChangeText={setEditStartedAt}
                placeholder={t('shift.time_format_hint')}
                placeholderTextColor={Colors.textSecondary}
                keyboardType="numbers-and-punctuation"
              />
              <Text style={styles.fieldLabel}>{t('shift.end_time')}</Text>
              <TextInput
                style={styles.input}
                value={editEndedAt}
                onChangeText={setEditEndedAt}
                placeholder={t('shift.time_format_hint')}
                placeholderTextColor={Colors.textSecondary}
                keyboardType="numbers-and-punctuation"
              />
            </>
          )}

          <Text style={styles.fieldLabel}>{t('shift.odometer_end')}</Text>
          <TextInput
            style={styles.input} keyboardType="decimal-pad"
            value={odometer} onChangeText={setOdometer}
            placeholder={distanceUnit} placeholderTextColor={Colors.textSecondary}
          />

          <Text style={styles.fieldLabel}>{t('shift.earnings')}</Text>
          {platforms.map((row, i) => (
            <View key={i} style={styles.platformRow}>
              <TextInput
                style={[styles.input, styles.platformName]}
                placeholder={t('shift.platform_name')} placeholderTextColor={Colors.textSecondary}
                value={row.name} onChangeText={(v) => updatePlatform(i, 'name', v)}
              />
              <TextInput
                style={[styles.input, styles.platformAmount]}
                keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={Colors.textSecondary}
                value={row.amount} onChangeText={(v) => updatePlatform(i, 'amount', v)}
              />
              <TextInput
                style={[styles.input, styles.platformRides]}
                keyboardType="number-pad" placeholder={t('shift.rides_count_short')} placeholderTextColor={Colors.textSecondary}
                value={row.rides} onChangeText={(v) => updatePlatform(i, 'rides', v)}
              />
            </View>
          ))}
          <Pressable onPress={() => setPlatforms((prev) => [...prev, { name: '', amount: '', rides: '' }])} style={styles.addRow}>
            <Ionicons name="add-circle-outline" size={16} color={Colors.accent} />
            <Text style={styles.addRowText}>{t('shift.add_platform')}</Text>
          </Pressable>

          {hasPriorSameDayShift && (
            <View style={styles.cumulativeToggleBox}>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t('shift.cumulative_day_total_label')}</Text>
                <Switch
                  value={isCumulativeDayTotal}
                  onValueChange={setIsCumulativeDayTotal}
                  trackColor={{ true: Colors.accent, false: Colors.border }}
                  thumbColor={Colors.onAccent}
                />
              </View>
              <Text style={styles.cumulativeToggleHint}>{t('shift.cumulative_day_total_hint')}</Text>
            </View>
          )}

          <View style={styles.costRow}>
            <Text style={styles.costLabel}>{t('shift.tips')}</Text>
            <TextInput style={[styles.input, styles.costInput]} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={Colors.textSecondary} value={tips} onChangeText={setTips} />
          </View>
          <View style={styles.costRow}>
            <Text style={styles.costLabel}>{t('shift.bonuses')}</Text>
            <TextInput style={[styles.input, styles.costInput]} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={Colors.textSecondary} value={bonuses} onChangeText={setBonuses} />
          </View>

          <Text style={styles.fieldLabel}>{t('shift.mood_label')}</Text>
          <View style={styles.moodRow}>
            {([
              { key: 'good' as MoodRating, label: t('shift.mood_good') },
              { key: 'ok' as MoodRating, label: t('shift.mood_ok') },
              { key: 'bad' as MoodRating, label: t('shift.mood_bad') },
            ]).map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[styles.moodCard, mood === key && styles.moodCardSelected]}
                onPress={() => setMood(prev => prev === key ? null : key)}
              >
                <Text style={[styles.moodCardText, mood === key && styles.moodCardTextSelected]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>{t('shift.notes_label')}</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder={t('shift.notes_placeholder')}
            placeholderTextColor={Colors.textSecondary}
            multiline
            numberOfLines={3}
            maxLength={1000}
          />

          {error !== null && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity style={[styles.primaryBtn, saving && styles.btnDisabled]} onPress={handleSave} disabled={saving}>
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
  onEdit: (shift: Shift) => void;
}

function ShiftItem({ shift, onDelete, onEdit }: ShiftItemProps) {
  const { t } = useTranslation();
  const { profile } = useProfile();
  const distUnit = profile?.distance_unit ?? 'km';
  const date = new Date(shift.started_at).toLocaleDateString('pt-BR');
  const dur =
    shift.duration_seconds != null
      ? secondsToHMS(shift.duration_seconds)
      : shift.ended_at != null
        ? secondsToHMS(Math.floor((new Date(shift.ended_at).getTime() - new Date(shift.started_at).getTime()) / 1000))
        : '--:--:--';
  const div = distUnit === 'km' ? 1000 : 1609.344;
  const kmStart = shift.odometer_start_meters != null ? `${(shift.odometer_start_meters / div).toFixed(0)} ${distUnit}` : null;
  const kmEnd = shift.odometer_end_meters != null ? `${(shift.odometer_end_meters / div).toFixed(0)} ${distUnit}` : null;

  return (
    <View style={styles.shiftCard}>
      <View style={styles.shiftAccent} />
      <View style={styles.shiftBody}>
        <View style={styles.shiftHeader}>
          <Text style={styles.shiftDate}>{date}</Text>
          <View style={styles.shiftActions}>
            <TouchableOpacity onPress={() => onEdit(shift)} style={styles.actionBtn} accessibilityLabel={t('shift.edit')}>
              <Ionicons name="pencil-outline" size={15} color={Colors.brandBlue} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => platformConfirm(t('shift.delete_title'), t('shift.delete_confirm'), () => onDelete(shift.id))}
              style={styles.actionBtn} accessibilityLabel={t('shift.delete_title')}
            >
              <Ionicons name="trash-outline" size={15} color={Colors.error} />
            </TouchableOpacity>
          </View>
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
            <Text style={styles.kmText}>{kmStart ?? '?'} → {kmEnd ?? '?'}</Text>
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
  const { isPremium } = usePremiumStatus(userId);
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [recentShifts, setRecentShifts] = useState<Shift[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startModalVisible, setStartModalVisible] = useState(false);
  const [endModalVisible, setEndModalVisible] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  useEffect(() => {
    if (activeShift) {
      const pauses = activeShift.pauses ?? [];
      const isPaused = pauses.length > 0 && !pauses[pauses.length - 1].ended_at;
      if (!isPaused) {
        timerRef.current = setInterval(() => setElapsed(activeDuration(activeShift.started_at, activeShift.pauses ?? [])), 1000);
      } else {
        setElapsed(activeDuration(activeShift.started_at, pauses));
        if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null; }
      }
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
      const vehicleId = await getEffectiveVehicleId(userId, profile?.vehicle_id ?? null);
      const shift = await startShift(userId, vehicleId, odometerMeters, isPremium);
      setActiveShift(shift);
      setElapsed(0);
    } catch (e) {
      if (e instanceof FreeLimitError) {
        setUpgradeModalVisible(true);
      } else {
        setScreenError(t('common.error'));
      }
    } finally {
      setStarting(false);
    }
  }

  async function handleShiftSaved() {
    setEndModalVisible(false);
    setActiveShift(null);
    await refresh();
  }

  async function handleEditSaved() {
    setEditingShift(null);
    await refresh();
  }

  async function handlePauseShift() {
    if (!activeShift) return;
    try {
      await pauseShift(activeShift.id, activeShift.pauses ?? []);
      await refresh();
    } catch { setScreenError(t('common.error')); }
  }

  async function handleResumeShift() {
    if (!activeShift) return;
    try {
      await resumeShift(activeShift.id, activeShift.pauses ?? []);
      await refresh();
    } catch { setScreenError(t('common.error')); }
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
      setRecentShifts((prev) => prev.filter((s) => s.id !== shiftId));
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
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.accent} />}
      >
        <Text style={styles.screenTitle}>{t('tabs.shifts')}</Text>

        {screenError !== null && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{screenError}</Text>
          </View>
        )}

        {activeShift !== null ? (() => {
          const pauses = activeShift.pauses ?? [];
          const isPaused = pauses.length > 0 && !pauses[pauses.length - 1].ended_at;
          return (
            <View style={styles.activeCard}>
              <View style={styles.activeDotRow}>
                <View style={[styles.activeDot, isPaused && { backgroundColor: Colors.accent }]} />
                <Text style={styles.activeLabel}>{isPaused ? 'TURNO PAUSADO' : 'TURNO ATIVO'}</Text>
              </View>
              <Text style={[styles.timer, isPaused && { color: Colors.accent }]}>{secondsToHMS(elapsed)}</Text>
              <View style={styles.activeActions}>
                {isPaused ? (
                  <TouchableOpacity style={styles.resumeBtn} onPress={handleResumeShift}>
                    <Ionicons name="play-outline" size={18} color={Colors.success} />
                    <Text style={styles.resumeBtnText}>Retomar</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.pauseBtn} onPress={handlePauseShift}>
                    <Ionicons name="pause-outline" size={18} color={Colors.accent} />
                    <Text style={styles.pauseBtnText}>Pausar</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.endBtn} onPress={() => setEndModalVisible(true)}>
                  <Ionicons name="stop-circle-outline" size={18} color={Colors.onAccent} />
                  <Text style={styles.endBtnText}>{t('shift.end')}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.discardBtn} onPress={handleDiscardShift}>
                <Ionicons name="trash-outline" size={16} color={Colors.error} />
                <Text style={styles.discardBtnText}>{t('shift.discard')}</Text>
              </TouchableOpacity>
            </View>
          );
        })() : (
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
          recentShifts.map((item) => (
            <ShiftItem key={item.id} shift={item} onDelete={handleDeleteShift} onEdit={setEditingShift} />
          ))
        )}
      </ScrollView>

      <StartShiftModal
        visible={startModalVisible}
        distanceUnit={profile?.distance_unit ?? 'km'}
        onClose={() => setStartModalVisible(false)}
        onConfirm={handleStartShift}
      />

      <UpgradeModal
        visible={upgradeModalVisible}
        reason="shifts_limit"
        onClose={() => setUpgradeModalVisible(false)}
      />

      {activeShift !== null && (
        <ShiftFormModal
          visible={endModalVisible}
          mode="end"
          shiftId={activeShift.id}
          startedAt={activeShift.started_at}
          pauses={activeShift.pauses}
          distanceUnit={profile?.distance_unit ?? 'km'}
          otherShifts={recentShifts}
          onClose={() => setEndModalVisible(false)}
          onSaved={handleShiftSaved}
        />
      )}

      {editingShift !== null && (
        <ShiftFormModal
          visible={true}
          mode="edit"
          shiftId={editingShift.id}
          existingShift={editingShift}
          distanceUnit={profile?.distance_unit ?? 'km'}
          otherShifts={recentShifts}
          onClose={() => setEditingShift(null)}
          onSaved={handleEditSaved}
        />
      )}

    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: 100 },
  center: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },

  screenTitle: { color: Colors.textPrimary, fontSize: 26, fontWeight: '800', marginBottom: Spacing.lg, letterSpacing: -0.5 },

  errorBanner: {
    backgroundColor: Colors.errorBg, borderRadius: Radius.input,
    padding: Spacing.sm, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
  },
  errorText: { color: Colors.error, fontSize: 13, textAlign: 'center' },

  activeCard: {
    backgroundColor: Colors.surface, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
    padding: Spacing.lg, marginBottom: Spacing.lg, alignItems: 'center',
  },
  activeDotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginBottom: Spacing.md },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  activeLabel: { color: Colors.success, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  timer: {
    fontSize: 56, fontWeight: '800', color: Colors.accent,
    fontVariant: ['tabular-nums'], letterSpacing: 2, marginBottom: Spacing.lg,
    ...Platform.select({ ios: { fontFamily: 'Menlo' }, android: { fontFamily: 'monospace' } }),
  },
  activeActions: { flexDirection: 'row', gap: Spacing.sm, width: '100%', marginBottom: Spacing.sm },
  pauseBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: Radius.button, paddingVertical: 14,
    borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.5)',
  },
  pauseBtnText: { color: Colors.accent, fontSize: 15, fontWeight: '700' },
  resumeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: Radius.button, paddingVertical: 14,
    borderWidth: 1.5, borderColor: 'rgba(16,185,129,0.5)',
  },
  resumeBtnText: { color: Colors.success, fontSize: 15, fontWeight: '700' },
  endBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.accent, borderRadius: Radius.button,
    paddingVertical: 14, paddingHorizontal: Spacing.md,
    justifyContent: 'center',
  },
  endBtnText: { color: Colors.onAccent, fontSize: 15, fontWeight: '800' },
  discardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: Radius.button, paddingVertical: 12, paddingHorizontal: Spacing.xl,
    width: '100%', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(239,68,68,0.4)',
  },
  discardBtnText: { color: Colors.error, fontSize: 14, fontWeight: '600' },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.accent, borderRadius: Radius.button,
    paddingVertical: 18, marginBottom: Spacing.lg,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  startBtnText: { color: Colors.onAccent, fontSize: 17, fontWeight: '800' },
  btnDisabled: { opacity: 0.6 },

  sectionTitle: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: Spacing.sm,
  },
  emptyState: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  emptyText: { color: Colors.textSecondary, fontSize: 14 },

  shiftCard: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderRadius: Radius.card, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  shiftAccent: { width: 4, backgroundColor: Colors.accent },
  shiftBody: { flex: 1, padding: Spacing.md },
  shiftHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  shiftDate: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  shiftActions: { flexDirection: 'row', gap: Spacing.xs },
  actionBtn: { padding: 8 },
  shiftStats: { flexDirection: 'row', gap: Spacing.md },
  shiftStat: { flex: 1 },
  statLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  statValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  kmRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.xs },
  kmText: { color: Colors.textSecondary, fontSize: 11, fontVariant: ['tabular-nums'] },

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
  platformAmount: { width: 90, marginBottom: 0 },
  platformRides: { width: 56, marginBottom: 0, textAlign: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.sm, marginBottom: Spacing.sm },
  addRowText: { color: Colors.accent, fontSize: 14, fontWeight: '600' },
  cumulativeToggleBox: {
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.sm, marginBottom: Spacing.sm,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  switchLabel: { color: Colors.textPrimary, fontSize: 14, flex: 1 },
  cumulativeToggleHint: { color: Colors.textSecondary, fontSize: 12, marginTop: Spacing.xs },
  costRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.xs, gap: Spacing.sm },
  costLabel: { color: Colors.textSecondary, fontSize: 14, flex: 1 },
  costInput: { width: 110, marginBottom: 0 },
  moodRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  moodCard: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14,
    borderRadius: Radius.input, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  moodCardSelected: { borderColor: Colors.accent, backgroundColor: 'rgba(245,158,11,0.12)' },
  moodCardText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  moodCardTextSelected: { color: Colors.accent, fontWeight: '800' },
  notesInput: { minHeight: 80, textAlignVertical: 'top', paddingTop: Spacing.sm },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.accent, borderRadius: Radius.button,
    minHeight: 52, marginTop: Spacing.sm,
  },
  primaryBtnText: { color: Colors.onAccent, fontSize: 16, fontWeight: '800' },
  odometerHint: { color: Colors.textSecondary, fontSize: 12, marginTop: -Spacing.xs, marginBottom: Spacing.md, paddingHorizontal: 2 },
  cancelBtn: { paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.sm },
  cancelBtnText: { color: Colors.textSecondary, fontSize: 15 },
});
