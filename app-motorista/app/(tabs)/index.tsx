import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Svg, { Circle } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { useProfile } from '@/src/hooks/useProfile';
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { PremiumGate } from '@/src/components/PremiumGate';
import { metersToDisplay } from '@/src/utils/units';
import { decimalToCents, formatMoney } from '@/src/utils/currency';
import { getActiveShift } from '@/src/services/shifts';
import { getConsumptionTrend, type ConsumptionTrend } from '@/src/services/fuelConsumption';
import {
  getActiveGoal, getDayDetail, getMonthlyBuckets, getMonthlyTotals, getMonthMoodStats,
  getMonthPlatformBreakdown, getPreviousMonthGross,
  getTodaySummary, getWeekBuckets, getWeekTotals, upsertMonthlyGoal,
  type ActiveGoal, type DailySummary, type DayBucket, type DayDetail, type MonthBucket,
  type MonthlyTotals, type MonthMoodStats, type PlatformItem,
} from '@/src/services/dashboard';
import {
  getInAppNotifications, deleteInAppNotification, clearInAppNotifications,
  type InAppNotification,
} from '@/src/services/notifications';
import {
  getMonthHistory, getStreak, type MonthHistoryItem,
} from '@/src/services/cockpit';
import { getAdaptiveDailyGoalCents } from '@/src/utils/cockpitUtils';
import { VehiclePill } from '@/src/components/VehiclePill';
import { StreakBar } from '@/src/components/StreakBar';
import { CockpitCard } from '@/src/components/CockpitCard';
import { MonthHistoryCard } from '@/src/components/MonthHistoryCard';
import { MonthDetailSheet } from '@/src/components/MonthDetailSheet';
import type { Shift } from '@/src/types';

function secondsToHHMM(s: number): string {
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}
function elapsedSeconds(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}
function daysInCurrentMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}
function durationFromShift(sh: DayDetail['shifts'][number]): number {
  if (sh.duration_seconds != null) return sh.duration_seconds;
  if (sh.started_at && sh.ended_at)
    return Math.round((new Date(sh.ended_at).getTime() - new Date(sh.started_at).getTime()) / 1000);
  return 0;
}
function fuelTypeLabel(type: string): string {
  const map: Record<string, string> = { gasoline: 'Gasolina', ethanol: 'Etanol', diesel: 'Diesel', gnv: 'GNV', electric: 'Elétrico', hybrid: 'Híbrido' };
  return map[type] ?? type;
}
function workingDaysLeft(workingDays: number[]): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let count = 0;
  for (let d = now.getDate(); d <= lastDay; d++) {
    const dow = new Date(now.getFullYear(), now.getMonth(), d).getDay();
    if (workingDays.includes(dow === 0 ? 7 : dow)) count++;
  }
  return Math.max(count, 1);
}

// ─── vehicle card ─────────────────────────────────────────────────────────────

type VehicleInfo = { brand: string; model: string; year: number; fuel_type: string; avg_consumption_per_100: number };

function VehicleCard({ info, realKmPerL }: { info: VehicleInfo; realKmPerL: number | null }) {
  // avg_consumption_per_100 is stored as ml/100km (onboarding: kmPerL → Math.round(100/kmPerL*1000))
  const reported = info.avg_consumption_per_100 > 0 ? 100000 / info.avg_consumption_per_100 : null;
  const kmL = realKmPerL ?? reported;
  return (
    <View style={styles.vehicleCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Spacing.xs }}>
        <Ionicons name="car-sport-outline" size={16} color={Colors.accent} />
        <Text style={styles.vehicleName}>{info.brand} {info.model} • {info.year}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Text style={styles.vehicleTag}>{fuelTypeLabel(info.fuel_type)}</Text>
        {kmL != null && <Text style={styles.vehicleTag}>{kmL.toFixed(1)} km/L{realKmPerL ? ' (real)' : ''}</Text>}
      </View>
    </View>
  );
}

// ─── active shift banner ──────────────────────────────────────────────────────

function ActiveShiftBanner({ shift }: { shift: Shift }) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(elapsedSeconds(shift.started_at));
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    ref.current = setInterval(() => setElapsed(elapsedSeconds(shift.started_at)), 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [shift.started_at]);
  return (
    <View style={styles.activeBanner}>
      <View style={styles.activeDotRow}>
        <View style={styles.activeDot} />
        <Text style={styles.activeBannerLabel}>{t('dashboard.active_shift')}</Text>
      </View>
      <Text style={styles.activeBannerTimer}>{secondsToHHMM(elapsed)}</Text>
    </View>
  );
}

// ─── today stats ──────────────────────────────────────────────────────────────

function TodayCard({ summary, currencyCode, distanceUnit, locale }: {
  summary: DailySummary; currencyCode: string; distanceUnit: 'km' | 'mi'; locale: string;
}) {
  const { t } = useTranslation();
  const totalExpenses = summary.expenses_cents + summary.fuel_cents;
  const realNet = summary.gross_cents - totalExpenses;
  const netColor = realNet >= 0 ? Colors.success : Colors.error;

  return (
    <View style={styles.todayHero}>
      <Text style={styles.sectionLabel}>{t('dashboard.today')}</Text>
      <View style={styles.todayTopRow}>
        <View style={styles.todayMainStat}>
          <View style={styles.todayStatBadge}>
            <Ionicons name="trending-up" size={10} color={Colors.success} />
            <Text style={styles.todayBadgeText}>{t('dashboard.gross')}</Text>
          </View>
          <Text style={styles.todayBigValue}>{formatMoney(summary.gross_cents, currencyCode, locale)}</Text>
        </View>
        <View style={[styles.todayMainStat, styles.todayMainStatRight]}>
          <View style={[styles.todayStatBadge, { backgroundColor: Colors.accentDim }]}>
            <Ionicons name="wallet" size={10} color={Colors.accent} />
            <Text style={[styles.todayBadgeText, { color: Colors.accent }]}>{t('dashboard.net_real')}</Text>
          </View>
          <Text style={[styles.todayBigValue, { color: netColor }]}>{formatMoney(realNet, currencyCode, locale)}</Text>
        </View>
      </View>
      <View style={styles.todayBottomRow}>
        <View style={styles.todayMiniStat}>
          <Ionicons name="flame-outline" size={13} color={Colors.error} />
          <Text style={styles.todayMiniLabel}>{t('dashboard.expenses_label')}</Text>
          <Text style={[styles.todayMiniValue, { color: Colors.error }]}>{formatMoney(totalExpenses, currencyCode, locale)}</Text>
        </View>
        <View style={styles.todayMiniStat}>
          <Ionicons name="time-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.todayMiniLabel}>{t('dashboard.hours_worked')}</Text>
          <Text style={styles.todayMiniValue}>{secondsToHHMM(summary.duration_seconds)}</Text>
        </View>
        <View style={styles.todayMiniStat}>
          <Ionicons name="navigate-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.todayMiniLabel}>{t('dashboard.km_driven')}</Text>
          <Text style={styles.todayMiniValue}>{metersToDisplay(summary.distance_meters, distanceUnit).toFixed(1)} {t('dashboard.km')}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── goal progress ────────────────────────────────────────────────────────────

function GoalProgress({ netTodayCents, grossMonthCents, targetCents, workingDays, currencyCode, locale, onEdit }: {
  netTodayCents: number; grossMonthCents: number; targetCents: number; workingDays: number[];
  currencyCode: string; locale: string; onEdit: () => void;
}) {
  const { t } = useTranslation();
  const monthPct = Math.round(Math.min(targetCents > 0 ? (grossMonthCents / targetCents) * 100 : 0, 100));
  const barColor = monthPct >= 100 ? Colors.success : monthPct >= 60 ? Colors.accent : Colors.brandBlue;
  const wdLeft = workingDaysLeft(workingDays);
  const remaining = Math.max(targetCents - grossMonthCents, 0);
  const dailyNeeded = remaining > 0 ? Math.round(remaining / wdLeft) : 0;
  return (
    <View style={styles.card}>
      <View style={styles.cardRowBetween}>
        <Text style={styles.cardTitle}>{t('dashboard.goal_progress')}</Text>
        <TouchableOpacity onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.goalPct, { color: barColor }]}>{monthPct}%</Text>
          <Ionicons name="pencil-outline" size={14} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <Text style={styles.goalOf}>{t('dashboard.goal_of')}{formatMoney(targetCents, currencyCode, locale)}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressBar, { width: `${monthPct}%` as any, backgroundColor: barColor }]} />
      </View>
      {dailyNeeded > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.sm }}>
          <View style={{ backgroundColor: Colors.accentDim, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="calendar-outline" size={11} color={Colors.accent} />
            <Text style={{ color: Colors.accent, fontSize: 12, fontWeight: '700' }}>{formatMoney(dailyNeeded, currencyCode, locale)}{t('dashboard.per_day')}</Text>
          </View>
          <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>{t('dashboard.working_days_left', { n: wdLeft })}</Text>
        </View>
      )}
      {remaining === 0 && grossMonthCents > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm }}>
          <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
          <Text style={{ color: Colors.success, fontSize: 13, fontWeight: '700' }}>{t('dashboard.goal_reached')}</Text>
        </View>
      )}
    </View>
  );
}

// ─── goal edit modal ──────────────────────────────────────────────────────────

function getWeekDayLabels(locale: string) {
  const refMonday = new Date(2025, 0, 6); // Jan 6 2025 is a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(refMonday.getTime());
    d.setDate(6 + i);
    return { iso: i + 1, label: d.toLocaleDateString(locale, { weekday: 'short' }) };
  });
}

function GoalEditModal({ visible, currentGoal, goalWorkingDays, userId, onSaved, onClose, currencyCode, locale }: {
  visible: boolean; currentGoal: number | null; goalWorkingDays: number[] | null;
  userId: string | null; onSaved: () => void; onClose: () => void; currencyCode: string; locale: string;
}) {
  const { t } = useTranslation();
  const now = new Date();
  const monthName = now.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const weekDays = getWeekDayLabels(locale);
  const [amount, setAmount] = useState(currentGoal ? (currentGoal / 100).toFixed(2) : '');
  const [workingDays, setWorkingDays] = useState<number[]>(goalWorkingDays ?? [1, 2, 3, 4, 5, 6]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setAmount(currentGoal ? (currentGoal / 100).toFixed(2) : '');
      setWorkingDays(goalWorkingDays ?? [1, 2, 3, 4, 5, 6]);
    }
  }, [visible, currentGoal, goalWorkingDays]);

  function toggleDay(iso: number) {
    setWorkingDays(prev => prev.includes(iso) ? prev.filter(x => x !== iso) : [...prev, iso].sort((a, b) => a - b));
  }

  async function handleSave() {
    if (!userId) return;
    const value = parseFloat(amount.replace(',', '.'));
    if (!value || value <= 0) { setError(t('dashboard.goal_invalid')); return; }
    setSaving(true); setError(null);
    try {
      await upsertMonthlyGoal(userId, decimalToCents(value), workingDays);
      onSaved();
    } catch {
      setError(t('dashboard.goal_error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.detailModal} edges={['top', 'bottom']}>
        <View style={styles.detailHeader}>
          <Text style={styles.detailTitle}>{t('dashboard.goal_monthly_title')}</Text>
          <TouchableOpacity onPress={onClose} style={styles.detailClose}>
            <Ionicons name="close" size={24} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={{ padding: Spacing.md }}>
          <Text style={[styles.goalOf, { marginBottom: Spacing.xs }]}>
            {monthName.charAt(0).toUpperCase() + monthName.slice(1)}
          </Text>
          <Text style={styles.detailLabel}>{t('dashboard.goal_question')}</Text>
          <TextInput
            style={styles.goalInput} keyboardType="decimal-pad" autoFocus
            value={amount} onChangeText={setAmount}
            placeholder="Ex: 5000,00" placeholderTextColor={Colors.textSecondary}
          />
          <Text style={[styles.detailLabel, { marginBottom: Spacing.sm }]}>{t('dashboard.goal_working_days')}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: Spacing.md, flexWrap: 'wrap' }}>
            {weekDays.map(d => {
              const active = workingDays.includes(d.iso);
              return (
                <TouchableOpacity key={d.iso} onPress={() => toggleDay(d.iso)}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
                    borderColor: active ? Colors.accent : Colors.border,
                    backgroundColor: active ? Colors.accentDim : 'transparent' }}>
                  <Text style={{ color: active ? Colors.accent : Colors.textSecondary, fontWeight: '700', fontSize: 13 }}>{d.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {error && <Text style={{ color: Colors.error, fontSize: 13, marginBottom: Spacing.sm }}>{error}</Text>}
          <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={Colors.onAccent} /> : <Text style={styles.primaryBtnText}>{t('dashboard.goal_save')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={{ paddingVertical: Spacing.md, alignItems: 'center' }} onPress={onClose}>
            <Text style={{ color: Colors.textSecondary, fontSize: 15 }}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── profit card ─────────────────────────────────────────────────────────────

function ProfitCard({ totals, currencyCode, locale, distanceUnit }: {
  totals: MonthlyTotals; currencyCode: string; locale: string; distanceUnit: string;
}) {
  const { t } = useTranslation();
  const totalExpenses = totals.expenses_cents + totals.fuel_cents;
  const profit = totals.gross_cents - totalExpenses;
  const g = totals.gross_cents;
  const margin     = g > 0 ? Math.round((profit / g) * 100) : 0;
  const fuelPct    = g > 0 ? Math.round((totals.fuel_cents / g) * 100) : 0;
  const expPct     = g > 0 ? Math.round((totals.expenses_cents / g) * 100) : 0;
  const profitColor = margin >= 50 ? Colors.success : margin >= 25 ? Colors.accent : Colors.error;
  const distScale  = distanceUnit === 'km' ? 1000 : 1609.344;
  const distTotal  = totals.km_meters / distScale;
  const netKm      = distTotal > 0 && profit > 0 ? Math.round(profit / distTotal) : null;

  const neonBoxes = [
    { label: t('dashboard.fuel_pct'),      value: `${fuelPct}%`,  color: Colors.accent,  border: 'rgba(245,158,11,0.35)',  bg: 'rgba(245,158,11,0.08)' },
    { label: t('dashboard.other_expenses'), value: `${expPct}%`,  color: Colors.error,   border: 'rgba(239,68,68,0.35)',   bg: 'rgba(239,68,68,0.08)' },
    { label: t('dashboard.real_profit'),    value: `${margin}%`,  color: profitColor,
      border: profitColor === Colors.success ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)',
      bg:     profitColor === Colors.success ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)' },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('dashboard.earnings_expenses_month')}</Text>

      {/* Stacked values */}
      <View style={{ gap: 6, marginBottom: Spacing.md }}>
        {([
          { label: t('dashboard.revenue_label'),  value: g,             c: Colors.accent },
          { label: t('dashboard.expenses_label'), value: totalExpenses, c: Colors.error  },
          { label: t('dashboard.real_profit'),    value: profit,        c: profitColor   },
        ] as const).map(item => (
          <View key={item.label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: Colors.textSecondary, fontSize: 12, fontWeight: '500' }}>{item.label}</Text>
            <Text style={{ color: item.c, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {formatMoney(item.value, currencyCode, locale)}
            </Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 2 }}>
          <View style={{ backgroundColor: profitColor === Colors.success ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2, borderWidth: 1, borderColor: profitColor === Colors.success ? 'rgba(16,185,129,0.30)' : 'rgba(245,158,11,0.30)' }}>
            <Text style={{ color: profitColor, fontSize: 11, fontWeight: '800' }}>{margin}% {t('dashboard.margin_pct')}</Text>
          </View>
        </View>
      </View>

      {/* Neon breakdown boxes */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {neonBoxes.map(box => (
          <View key={box.label} style={{
            flex: 1, borderRadius: 12, padding: 8, alignItems: 'center', gap: 3,
            backgroundColor: box.bg, borderWidth: 1.5, borderColor: box.border,
            ...Platform.select({ ios: { shadowColor: box.color, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.28, shadowRadius: 6 }, android: { elevation: 3 } }),
          }}>
            <Text style={{ color: Colors.textSecondary, fontSize: 8, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' }}>{box.label}</Text>
            <Text style={{ color: box.color, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{box.value}</Text>
          </View>
        ))}
      </View>

      {netKm !== null && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm }}>
          <Ionicons name="trending-up" size={13} color={Colors.success} />
          <Text style={{ color: Colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('dashboard.net_per_km')}</Text>
          <Text style={{ color: Colors.success, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(netKm, currencyCode, locale)}/{distanceUnit}</Text>
        </View>
      )}
    </View>
  );
}

// ─── fuel consumption card ────────────────────────────────────────────────────

function FuelConsumptionCard({ trend }: { trend: ConsumptionTrend }) {
  const { t } = useTranslation();
  const changePct = trend.change_pct;
  const hasAlert = changePct !== null && Math.abs(changePct) >= 10;
  const improved = (changePct ?? 0) > 0;
  return (
    <View style={styles.card}>
      <View style={styles.cardRowBetween}>
        <Text style={styles.cardTitle}>{t('dashboard.fuel_consumption_title')}</Text>
        <Ionicons name="speedometer-outline" size={16} color={Colors.textSecondary} />
      </View>
      <View style={styles.consumptionRow}>
        <View style={styles.consumptionStat}>
          <Text style={styles.consumptionValue}>{trend.overall.km_per_l.toFixed(1)}</Text>
          <Text style={styles.consumptionUnit}>{t('dashboard.km_avg')}</Text>
        </View>
        <View style={styles.consumptionStat}>
          <Text style={styles.consumptionValue}>{trend.overall.total_km.toFixed(0)}</Text>
          <Text style={styles.consumptionUnit}>{t('dashboard.km_calculated')}</Text>
        </View>
        <View style={styles.consumptionStat}>
          <Text style={styles.consumptionValue}>{trend.overall.segments}</Text>
          <Text style={styles.consumptionUnit}>{t('dashboard.fueling_count')}</Text>
        </View>
      </View>
      {hasAlert && trend.recent && (
        <View style={[styles.consumptionAlert, { backgroundColor: improved ? Colors.successBg : Colors.accentDim }]}>
          <Ionicons name={improved ? 'trending-up-outline' : 'trending-down-outline'} size={14} color={improved ? Colors.success : Colors.accent} />
          <Text style={[styles.consumptionAlertText, { color: improved ? Colors.success : Colors.accent }]}>
            {improved ? t('dashboard.consumption_improved') : t('dashboard.consumption_worsened')}: {trend.overall.km_per_l.toFixed(1)} → {trend.recent.km_per_l.toFixed(1)} km/L ({changePct! > 0 ? '+' : ''}{changePct!.toFixed(1)}%)
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── monthly chart ────────────────────────────────────────────────────────────

function MonthlyChart({ buckets, goalCents, currencyCode, locale, onDayPress, selectedDay, consumptionTrend, onEditGoal }: {
  buckets: MonthBucket[]; goalCents: number | null; currencyCode: string; locale: string;
  onDayPress?: (day: number) => void; selectedDay?: number | null;
  consumptionTrend?: ConsumptionTrend | null;
  onEditGoal?: () => void;
}) {
  const { t } = useTranslation();
  const today = new Date().getDate();
  const monthlyTotal = buckets.reduce((s, b) => s + b.net_cents, 0);
  const hasGoal = goalCents != null && goalCents > 0;
  const pct = hasGoal ? Math.min(monthlyTotal / goalCents!, 1) : 0;
  const remaining = hasGoal ? Math.max(goalCents! - monthlyTotal, 0) : 0;

  // Donut math
  const D_SIZE = 130;
  const D_CX = D_SIZE / 2;
  const D_CY = D_SIZE / 2;
  const D_R = 50;
  const D_CIRC = 2 * Math.PI * D_R;
  const D_GAP = pct > 0 && pct < 1 ? 3 : 0;
  const achievedDash = Math.max(D_CIRC * pct - D_GAP, 0);
  const remainingDash = Math.max(D_CIRC * (1 - pct) - D_GAP, 0);

  const maxVal = Math.max(...buckets.map(b => b.net_cents), 1);
  const BAR_H = 52;

  const trendChangePct = consumptionTrend?.change_pct ?? null;
  const trendImproved = (trendChangePct ?? 0) > 0;
  const trendHasAlert = trendChangePct !== null && Math.abs(trendChangePct) >= 10;

  return (
    <View style={styles.card}>
      <View style={styles.cardRowBetween}>
        <Text style={styles.cardTitle}>{t('dashboard.monthly_chart')}</Text>
        {onEditGoal && (
          <TouchableOpacity onPress={onEditGoal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="pencil-outline" size={14} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* 2-column: donut left + stats right */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        {/* Donut with center overlay */}
        <View style={{ width: D_SIZE, height: D_SIZE, position: 'relative' }}>
          <Svg width={D_SIZE} height={D_SIZE} viewBox={`0 0 ${D_SIZE} ${D_SIZE}`}>
            <Circle cx={D_CX} cy={D_CY} r={D_R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={11} />
            {hasGoal && pct < 1 && remainingDash > 0 && (
              <>
                <Circle cx={D_CX} cy={D_CY} r={D_R} fill="none" stroke={Colors.error}
                  strokeWidth={22} opacity={0.07} strokeLinecap="butt"
                  strokeDasharray={`${remainingDash} ${D_CIRC}`} strokeDashoffset={D_CIRC * 0.25}
                  transform={`rotate(${pct * 360}, ${D_CX}, ${D_CY})`} />
                <Circle cx={D_CX} cy={D_CY} r={D_R} fill="none" stroke={Colors.error}
                  strokeWidth={14} opacity={0.15} strokeLinecap="butt"
                  strokeDasharray={`${remainingDash} ${D_CIRC}`} strokeDashoffset={D_CIRC * 0.25}
                  transform={`rotate(${pct * 360}, ${D_CX}, ${D_CY})`} />
                <Circle cx={D_CX} cy={D_CY} r={D_R} fill="none" stroke={Colors.error}
                  strokeWidth={9} strokeLinecap="butt"
                  strokeDasharray={`${remainingDash} ${D_CIRC}`} strokeDashoffset={D_CIRC * 0.25}
                  transform={`rotate(${pct * 360}, ${D_CX}, ${D_CY})`} />
              </>
            )}
            {hasGoal && pct > 0 && (
              <>
                <Circle cx={D_CX} cy={D_CY} r={D_R} fill="none" stroke={Colors.accent}
                  strokeWidth={22} opacity={0.07} strokeLinecap="butt"
                  strokeDasharray={`${achievedDash} ${D_CIRC}`} strokeDashoffset={D_CIRC * 0.25} />
                <Circle cx={D_CX} cy={D_CY} r={D_R} fill="none" stroke={Colors.accent}
                  strokeWidth={14} opacity={0.15} strokeLinecap="butt"
                  strokeDasharray={`${achievedDash} ${D_CIRC}`} strokeDashoffset={D_CIRC * 0.25} />
                <Circle cx={D_CX} cy={D_CY} r={D_R} fill="none" stroke={Colors.accent}
                  strokeWidth={9} strokeLinecap="butt"
                  strokeDasharray={`${achievedDash} ${D_CIRC}`} strokeDashoffset={D_CIRC * 0.25} />
              </>
            )}
          </Svg>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
            <Text style={{ color: hasGoal ? (pct >= 1 ? Colors.accent : Colors.textPrimary) : Colors.textSecondary, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {hasGoal ? `${Math.round(pct * 100)}%` : '—'}
            </Text>
            <Text style={{ color: Colors.textSecondary, fontSize: 8, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
              {pct >= 1 ? t('dashboard.goal_reached') : t('dashboard.donut_done')}
            </Text>
          </View>
        </View>

        {/* Right stats */}
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: Colors.textPrimary, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -0.5 }}
            numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {formatMoney(monthlyTotal, currencyCode, locale)}
          </Text>
          <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
            {t('dashboard.monthly_chart')}
          </Text>
          {hasGoal ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>{t('dashboard.donut_done')}</Text>
                <Text style={{ color: Colors.success, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(monthlyTotal, currencyCode, locale)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>{t('dashboard.donut_remaining')}</Text>
                <Text style={{ color: remaining > 0 ? Colors.error : Colors.success, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(remaining, currencyCode, locale)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>{t('dashboard.donut_goal')}</Text>
                <Text style={{ color: Colors.accent, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(goalCents!, currencyCode, locale)}</Text>
              </View>
            </>
          ) : (
            <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>{t('dashboard.cockpit_no_goal')}</Text>
          )}
        </View>
      </View>

      {/* Daily bars */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
        <View style={{ flexDirection: 'row', gap: 3, paddingHorizontal: 4 }}>
          {buckets.map(b => {
            const isToday = b.day === today;
            const isSelected = b.day === selectedDay;
            const hasData = b.net_cents > 0;
            const barPct = hasData ? Math.max(b.net_cents / maxVal, 0.07) : 0.04;
            const barColor = isSelected || isToday ? Colors.accent : Colors.success;
            return (
              <TouchableOpacity key={b.day} onPress={() => onDayPress?.(b.day)} activeOpacity={0.7}
                style={{ alignItems: 'center', width: 18 }}>
                <View style={{ width: 10, height: BAR_H, justifyContent: 'flex-end' }}>
                  <View style={{
                    width: 10, height: Math.max(BAR_H * barPct, hasData ? 4 : 2),
                    borderRadius: 3,
                    backgroundColor: hasData ? barColor : 'rgba(255,255,255,0.08)',
                    ...(hasData ? Platform.select({
                      ios: { shadowColor: barColor, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.75, shadowRadius: 4 },
                      android: { elevation: 2 },
                    }) : {}),
                  }} />
                </View>
                <Text style={{ fontSize: 7, color: isSelected || isToday ? Colors.accent : Colors.textSecondary, fontWeight: isSelected || isToday ? '700' : '400', marginTop: 3 }}>
                  {b.day}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Consumo Real — merged from FuelConsumptionCard */}
      {/* Scoped to the current month (mês em exercício), matching RESUMO DO
          MÊS above — not consumptionTrend.overall, which is lifetime. */}
      {consumptionTrend?.current_month && (
        <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Ionicons name="speedometer-outline" size={13} color={Colors.textSecondary} />
            <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 }}>{t('dashboard.fuel_consumption_title')}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[
              { value: consumptionTrend.current_month.km_per_l.toFixed(1), label: t('dashboard.km_avg'), color: Colors.success },
              { value: consumptionTrend.current_month.total_km.toFixed(0), label: t('dashboard.km_calculated'), color: Colors.textPrimary },
              { value: String(consumptionTrend.current_month.segments), label: t('dashboard.fueling_count'), color: Colors.accent },
            ].map(item => (
              <View key={item.label} style={{ flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: 8, alignItems: 'center', gap: 2 }}>
                <Text style={{ color: item.color, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{item.value}</Text>
                <Text style={{ color: Colors.textSecondary, fontSize: 8, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center' }}>{item.label}</Text>
              </View>
            ))}
          </View>
          {trendHasAlert && consumptionTrend.recent && (
            <View style={[styles.consumptionAlert, { marginTop: 8, backgroundColor: trendImproved ? Colors.successBg : Colors.accentDim }]}>
              <Ionicons name={trendImproved ? 'trending-up-outline' : 'trending-down-outline'} size={13} color={trendImproved ? Colors.success : Colors.accent} />
              <Text style={[styles.consumptionAlertText, { color: trendImproved ? Colors.success : Colors.accent }]}>
                {trendImproved ? t('dashboard.consumption_improved') : t('dashboard.consumption_worsened')}: {consumptionTrend.overall.km_per_l.toFixed(1)} → {consumptionTrend.recent.km_per_l.toFixed(1)} km/L ({trendChangePct! > 0 ? '+' : ''}{trendChangePct!.toFixed(1)}%)
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── mood stats card ──────────────────────────────────────────────────────────

function MoodStatsCard({ stats }: { stats: MonthMoodStats }) {
  const { t } = useTranslation();
  const total = stats.good + stats.ok + stats.bad;
  if (total === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={[styles.cardTitle, { letterSpacing: 1.5, textTransform: 'uppercase', fontSize: 11 }]}>
        {t('dashboard.mood_title')}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {([
          { count: stats.good, emoji: '🤑', label: t('dashboard.mood_good'), color: Colors.accent },
          { count: stats.ok,   emoji: '😐', label: t('dashboard.mood_ok'),   color: Colors.textSecondary },
          { count: stats.bad,  emoji: '😫', label: t('dashboard.mood_bad'),  color: Colors.error },
        ]).map(({ count, emoji, label, color }) => (
          <View key={label} style={{ flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: 12, paddingVertical: 12, alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 22 }}>{emoji}</Text>
            <Text style={{ color, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{count}</Text>
            <Text style={{ color: Colors.textSecondary, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── platform colors ──────────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  'Uber':      '#000000',
  'Uber Eats': '#000000',
  '99':        '#FFD700',
  '99Food':    '#FFD700',
  'iFood':     '#FF2C2C',
  'Lalamove':  '#FF6B00',
  'InDriver':  '#4CAF50',
  'Rappi':     '#FF441F',
  'Ifood':     '#FF2C2C',
  'Bolt':      '#34D058',
  'Heetch':    '#8B5CF6',
  'Outro':     '#6B7280',
};

function getPlatformColor(name: string): string {
  for (const [key, color] of Object.entries(PLATFORM_COLORS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return '#6B7280';
}

// ─── kill shot cards ──────────────────────────────────────────────────────────

function KillShotCards({ totals, prevGross, currencyCode, locale, distanceUnit }: {
  totals: MonthlyTotals; prevGross: number; currencyCode: string; locale: string; distanceUnit: string;
}) {
  const { t } = useTranslation();
  const totalExpenses = totals.expenses_cents + totals.fuel_cents;
  const profit        = totals.gross_cents - totalExpenses;
  const hours         = (totals.duration_seconds ?? 0) / 3600;
  const perHour       = hours > 0.5 ? Math.round(profit / hours) : null;
  const trendPct      = prevGross > 0 ? Math.round(((totals.gross_cents - prevGross) / prevGross) * 100) : null;
  const expPct        = totals.gross_cents > 0 ? Math.round((totalExpenses / totals.gross_cents) * 100) : 0;
  const marginPct     = totals.gross_cents > 0 ? Math.round((profit / totals.gross_cents) * 100) : 0;
  const profitColor   = marginPct >= 50 ? Colors.success : marginPct >= 25 ? Colors.accent : Colors.error;

  const glass = { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.10)', borderWidth: 1 } as const;

  const cards = [
    {
      title: 'Receita',
      value: formatMoney(totals.gross_cents, currencyCode, locale),
      sub: trendPct !== null
        ? `${trendPct >= 0 ? '+' : ''}${trendPct}% vs mês ant.`
        : undefined,
      subColor: trendPct !== null && trendPct >= 0 ? Colors.success : Colors.error,
      icon: 'trending-up' as const,
      iconColor: Colors.accent,
      accentBorder: Colors.accent,
    },
    {
      title: 'Despesas',
      value: formatMoney(totalExpenses, currencyCode, locale),
      sub: `${expPct}% da receita`,
      subColor: Colors.error,
      icon: 'flame-outline' as const,
      iconColor: Colors.error,
      accentBorder: Colors.error,
    },
    {
      title: 'Lucro',
      value: formatMoney(profit, currencyCode, locale),
      sub: `${marginPct}% margem`,
      subColor: profitColor,
      icon: 'wallet-outline' as const,
      iconColor: profitColor,
      accentBorder: profitColor,
    },
    {
      title: 'R$/hora',
      value: perHour !== null ? formatMoney(perHour, currencyCode, locale) : '—',
      sub: perHour !== null ? `${hours.toFixed(1)}h trabalhadas` : 'sem dados',
      subColor: Colors.textSecondary,
      icon: 'time-outline' as const,
      iconColor: Colors.brandBlue,
      accentBorder: Colors.brandBlue,
    },
  ];

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.md }}>
      {cards.map(c => (
        <View key={c.title} style={[{
          width: '48%', borderRadius: 14, padding: Spacing.md,
          borderTopWidth: 2, borderTopColor: c.accentBorder,
          ...Platform.select({
            ios: { shadowColor: c.accentBorder, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 8 },
            android: { elevation: 3 },
          }),
        }, glass]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 }}>
            <Ionicons name={c.icon} size={12} color={c.iconColor} />
            <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, flex: 1 }} numberOfLines={1}>
              {c.title}
            </Text>
          </View>
          <Text style={{ color: Colors.textPrimary, fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -0.5 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
            {c.value}
          </Text>
          {c.sub && (
            <Text style={{ color: c.subColor, fontSize: 10, fontWeight: '600', marginTop: 3 }} numberOfLines={1}>
              {c.sub}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

// ─── platform breakdown ───────────────────────────────────────────────────────

function PlatformBreakdownCard({ platforms, currencyCode, locale }: {
  platforms: PlatformItem[]; currencyCode: string; locale: string;
}) {
  if (platforms.length === 0) return null;
  const topN = platforms.slice(0, 5);
  return (
    <View style={[styles.card, { gap: 10 }]}>
      <Text style={styles.cardTitle}>RECEITA POR PLATAFORMA</Text>
      {topN.map(p => {
        const color = getPlatformColor(p.name);
        const isLight = color === '#FFD700';
        return (
          <View key={p.name}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '600' }}>{p.name}</Text>
                <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>{p.pct}%</Text>
              </View>
              <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {formatMoney(p.gross_cents, currencyCode, locale)}
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
              <View style={{
                height: 6, width: `${Math.max(p.pct, 3)}%` as any,
                borderRadius: 3, backgroundColor: color,
                opacity: isLight ? 0.9 : 1,
                ...Platform.select({
                  ios: { shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 4 },
                  android: { elevation: 2 },
                }),
              }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── equação visual (custo/km) ────────────────────────────────────────────────

function EquacaoCard({ totals, distanceUnit, currencyCode, locale }: {
  totals: MonthlyTotals; distanceUnit: string; currencyCode: string; locale: string;
}) {
  const totalExpenses = totals.expenses_cents + totals.fuel_cents;
  const distScale = distanceUnit === 'km' ? 1000 : 1609.344;
  const distTotal = totals.km_meters / distScale;
  if (distTotal < 1 || totalExpenses === 0) return null;

  const costPerKm   = Math.round(totalExpenses / distTotal);
  const grossPerKm  = Math.round(totals.gross_cents / distTotal);
  const netPerKm    = grossPerKm - costPerKm;
  const netColor    = netPerKm >= 0 ? Colors.success : Colors.error;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>IMPACTO NO SEU DIA A DIA</Text>
      {/* Equation: Receita/km  –  Custo/km  =  Lucro/km */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center', marginTop: 4 }}>
        {[
          { label: `Receita/${distanceUnit}`, value: formatMoney(grossPerKm, currencyCode, locale), color: Colors.accent, bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)' },
          { label: '—', value: undefined, color: Colors.textSecondary, bg: 'transparent', border: 'transparent' },
          { label: `Custo/${distanceUnit}`, value: formatMoney(costPerKm, currencyCode, locale), color: Colors.error, bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.30)' },
          { label: '=', value: undefined, color: Colors.textSecondary, bg: 'transparent', border: 'transparent' },
          { label: `Líquido/${distanceUnit}`, value: formatMoney(netPerKm, currencyCode, locale), color: netColor, bg: netColor === Colors.success ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)', border: netColor === Colors.success ? 'rgba(16,185,129,0.30)' : 'rgba(239,68,68,0.30)' },
        ].map((item, i) => (
          item.value !== undefined
            ? (
              <View key={i} style={{ flex: 1, backgroundColor: item.bg, borderRadius: 12, borderWidth: 1.5, borderColor: item.border, padding: 8, alignItems: 'center', gap: 3 }}>
                <Text style={{ color: item.color, fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                  {item.value}
                </Text>
                <Text style={{ color: Colors.textSecondary, fontSize: 8, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center' }}>
                  {item.label}
                </Text>
              </View>
            )
            : (
              <Text key={i} style={{ color: Colors.textSecondary, fontSize: 18, fontWeight: '300', marginHorizontal: 1 }}>
                {item.label}
              </Text>
            )
        ))}
      </View>
      <Text style={{ color: Colors.textSecondary, fontSize: 10, textAlign: 'center', marginTop: Spacing.sm, fontStyle: 'italic' }}>
        Baseado em {distTotal.toFixed(0)} {distanceUnit} rodados este mês
      </Text>
    </View>
  );
}

// ─── day detail modal ─────────────────────────────────────────────────────────

function DayDetailModal({ visible, dateStr, userId, onClose, distanceUnit, currencyCode, locale }: {
  visible: boolean; dateStr: string | null; userId: string | null;
  onClose: () => void; distanceUnit: 'km' | 'mi'; currencyCode: string; locale: string;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !dateStr || !userId) return;
    setLoading(true); setDetail(null);
    getDayDetail(userId, dateStr).then(setDetail).catch(() => setDetail(null)).finally(() => setLoading(false));
  }, [visible, dateStr, userId]);

  const label = dateStr ? (() => {
    const s = new Date(dateStr + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    return locale.startsWith('pt')
      ? s.replace(/([ -])([A-ZÁÉÍÓÚÃÕÂÊÔÀÜ])/g, (_, sep, c) => sep + c.toLowerCase())
      : s;
  })() : '';
  const shifts = detail?.shifts ?? [];
  const totalGross = shifts.reduce((s, sh) => s + (sh.gross_cents ?? 0), 0);
  const totalNet = shifts.reduce((s, sh) => s + (sh.net_cents ?? 0), 0);
  const totalDur = shifts.reduce((s, sh) => s + durationFromShift(sh), 0);
  const totalKm = shifts.reduce((s, sh) => sh.odometer_start_meters != null && sh.odometer_end_meters != null ? s + (sh.odometer_end_meters - sh.odometer_start_meters) : s, 0);
  const dayOdomStart = shifts.reduce<number | null>((min, sh) => {
    if (sh.odometer_start_meters == null) return min;
    return min == null ? sh.odometer_start_meters : Math.min(min, sh.odometer_start_meters);
  }, null);
  const dayOdomEnd = shifts.reduce<number | null>((max, sh) => {
    if (sh.odometer_end_meters == null) return max;
    return max == null ? sh.odometer_end_meters : Math.max(max, sh.odometer_end_meters);
  }, null);
  const totalExpensesCents = (detail?.expenses_cents ?? 0) + (detail?.fuel_cents ?? 0);
  const realNet = totalNet - totalExpensesCents;

  function Row({ label: l, value, color }: { label: string; value: string; color?: string }) {
    return (
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>{l}</Text>
        <Text style={[styles.detailValue, color ? { color } : {}]}>{value}</Text>
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.detailModal} edges={['top', 'bottom']}>
        <View style={styles.detailHeader}>
          <Text style={styles.detailTitle}>{label}</Text>
          <TouchableOpacity onPress={onClose} style={styles.detailClose}>
            <Ionicons name="close" size={24} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {loading ? <ActivityIndicator color={Colors.accent} style={{ marginTop: Spacing.xl }} /> : (
          <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>{t('dashboard.day_earnings_section')}</Text>
              <Row label={t('dashboard.day_gross')} value={formatMoney(totalGross, currencyCode, locale)} color={Colors.accent} />
              {totalGross !== totalNet && <Row label={t('dashboard.day_net_shifts')} value={formatMoney(totalNet, currencyCode, locale)} color={Colors.success} />}
            </View>
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>{t('dashboard.day_expenses_section')}</Text>
              {(detail?.fuel_cents ?? 0) > 0 && <Row label={t('dashboard.day_fuel')} value={formatMoney(detail!.fuel_cents, currencyCode, locale)} color={Colors.error} />}
              {(detail?.expenses_cents ?? 0) > 0 && <Row label={t('dashboard.day_other_expenses')} value={formatMoney(detail!.expenses_cents, currencyCode, locale)} color={Colors.error} />}
              <Row label={t('dashboard.day_total_expenses')} value={formatMoney(totalExpensesCents, currencyCode, locale)} color={Colors.error} />
              <Row label={t('dashboard.day_net_real')} value={formatMoney(realNet, currencyCode, locale)} color={realNet >= 0 ? Colors.success : Colors.error} />
              {totalGross > 0 && totalExpensesCents > 0 && (() => {
                const fuelPct = Math.round(((detail?.fuel_cents ?? 0) / totalGross) * 100);
                const expPct  = Math.round(((detail?.expenses_cents ?? 0) / totalGross) * 100);
                const margin  = Math.round((realNet / totalGross) * 100);
                const pc = margin >= 50 ? Colors.success : margin >= 25 ? Colors.accent : Colors.error;
                return (
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: Spacing.md }}>
                    {([
                      { icon: 'water-outline',   label: t('dashboard.day_fuel_pct'),     pct: fuelPct, c: '#F59E0B' },
                      { icon: 'receipt-outline', label: t('dashboard.day_expenses_pct'), pct: expPct,  c: Colors.error },
                      { icon: 'trending-up',     label: t('dashboard.day_profit_pct'),   pct: margin,  c: pc },
                    ] as const).map(item => (
                      <View key={item.label} style={{ flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: Spacing.sm, alignItems: 'center', gap: 2 }}>
                        <Ionicons name={item.icon} size={11} color={item.c} />
                        <Text style={{ color: item.c, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{item.pct}%</Text>
                        <Text style={{ color: Colors.textSecondary, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.3 }}>{item.label}</Text>
                      </View>
                    ))}
                  </View>
                );
              })()}
            </View>
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>{t('dashboard.day_productivity_section')}</Text>
              <Row label={t('dashboard.day_hours_worked')} value={secondsToHHMM(totalDur)} />
              <Row label={t(distanceUnit === 'km' ? 'dashboard.day_km_driven_km' : 'dashboard.day_km_driven_mi')} value={`${metersToDisplay(totalKm, distanceUnit).toFixed(1)} ${distanceUnit}`} />
              {dayOdomStart != null && (
                <Row label={t('dashboard.day_odometer_start')} value={`${(dayOdomStart / 1000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} km`} />
              )}
              {dayOdomEnd != null && (
                <Row label={t('dashboard.day_odometer_end')} value={`${(dayOdomEnd / 1000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} km`} />
              )}
              <Row label={t('dashboard.day_shifts')} value={String(shifts.length)} />
              {totalDur > 0 && totalGross > 0 && <Row label={t('dashboard.day_gross_per_hour')} value={formatMoney(Math.round((totalGross / totalDur) * 3600), currencyCode, locale)} />}
              {totalDur > 0 && realNet > 0 && <Row label={t('dashboard.day_net_real_per_hour')} value={formatMoney(Math.round((realNet / totalDur) * 3600), currencyCode, locale)} />}
            </View>
            {shifts.length === 0 && totalExpensesCents === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: Spacing.xl }}>
                <Ionicons name="calendar-outline" size={36} color={Colors.borderBright} style={{ marginBottom: Spacing.sm }} />
                <Text style={styles.detailEmpty}>{t('dashboard.day_no_data')}</Text>
              </View>
            )}
            {shifts.length === 0 && totalExpensesCents > 0 && (
              <Text style={styles.detailEmpty}>{t('dashboard.day_no_shifts')}</Text>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ─── week bucket ──────────────────────────────────────────────────────────────

function WeekBucketItem({ bucket, currencyCode, locale, language, onPress }: {
  bucket: DayBucket; currencyCode: string; locale: string; language: string; onPress: (d: string) => void;
}) {
  const { t } = useTranslation();
  const dayLabel = new Date(bucket.date + 'T12:00:00').toLocaleDateString(language, { weekday: 'short' }).toUpperCase();
  const dayNum = new Date(bucket.date + 'T12:00:00').getDate();
  const hasData = bucket.net_cents > 0;
  const isToday = bucket.date === new Date().toISOString().slice(0, 10);
  return (
    <TouchableOpacity style={[styles.bucketItem, hasData && styles.bucketItemActive, isToday && styles.bucketItemToday]} onPress={() => onPress(bucket.date)} activeOpacity={0.7}>
      <Text style={[styles.bucketDay, isToday && { color: Colors.accent }]}>{dayLabel}</Text>
      <Text style={[styles.bucketDate, isToday && { color: Colors.accent }]}>{dayNum}</Text>
      <Text style={[styles.bucketNet, hasData && { color: Colors.success }]}>
        {hasData ? formatMoney(bucket.net_cents, currencyCode, locale) : t('dashboard.no_data')}
      </Text>
    </TouchableOpacity>
  );
}

// ─── week bar chart ───────────────────────────────────────────────────────────

const WBAR_H = 120;

function WeekNeonBoxes({ totals, currencyCode, locale, distanceUnit }: {
  totals: MonthlyTotals; currencyCode: string; locale: string; distanceUnit: string;
}) {
  const { t } = useTranslation();
  const g = totals.gross_cents;
  if (g === 0) return null;
  const fuelPct  = Math.round((totals.fuel_cents / g) * 100);
  const expPct   = Math.round((totals.expenses_cents / g) * 100);
  const profit   = g - totals.fuel_cents - totals.expenses_cents;
  const profitColor = profit / g >= 0.5 ? Colors.success : profit / g >= 0.25 ? Colors.accent : Colors.error;
  const distScale = distanceUnit === 'km' ? 1000 : 1609.344;
  const distTotal = totals.km_meters / distScale;
  const netKm = distTotal > 0 && profit > 0 ? Math.round(profit / distTotal) : null;

  const boxes = [
    { label: t('dashboard.day_fuel_pct'),     value: `${fuelPct}%`,  sub: t('dashboard.day_fuel_pct'),     color: Colors.accent,  border: 'rgba(245,158,11,0.35)', bg: 'rgba(245,158,11,0.08)' },
    { label: t('dashboard.day_expenses_pct'), value: `${expPct}%`,   sub: t('dashboard.day_expenses_pct'), color: Colors.error,   border: 'rgba(239,68,68,0.35)',  bg: 'rgba(239,68,68,0.08)' },
    { label: '~ ' + t('dashboard.net_per_km').toUpperCase(), value: netKm ? `${formatMoney(netKm, currencyCode, locale)}/${distanceUnit}` : '—', sub: t('dashboard.net_per_km'), color: profitColor, border: profitColor === Colors.success ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)', bg: profitColor === Colors.success ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)' },
  ];

  return (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
      {boxes.map(box => (
        <View key={box.label} style={{
          flex: 1, borderRadius: 12, padding: 8, alignItems: 'center', gap: 3,
          backgroundColor: box.bg, borderWidth: 1.5, borderColor: box.border,
          ...Platform.select({ ios: { shadowColor: box.color, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.30, shadowRadius: 6 }, android: { elevation: 3 } }),
        }}>
          <Text style={{ color: Colors.textSecondary, fontSize: 8, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' }}>{box.label}</Text>
          <Text style={{ color: box.color, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'], textAlign: 'center' }}>{box.value}</Text>
        </View>
      ))}
    </View>
  );
}

function WeekBarChart({ buckets, weekTotals, currencyCode, locale, language, distanceUnit, onPress }: {
  buckets: DayBucket[]; weekTotals: MonthlyTotals | null; currencyCode: string; locale: string; language: string; distanceUnit: string; onPress: (d: string) => void;
}) {
  const { t } = useTranslation();
  const maxVal = Math.max(...buckets.map(b => b.net_cents), 1);
  const today = new Date().toISOString().slice(0, 10);
  const weekTotal = buckets.reduce((s, b) => s + b.net_cents, 0);
  const weekKm = weekTotals ? (weekTotals.km_meters / 1000).toFixed(1) : null;
  const distScale = distanceUnit === 'km' ? 1000 : 1609.344;
  const distTotal = weekTotals ? weekTotals.km_meters / distScale : 0;
  const profit = weekTotals ? weekTotals.gross_cents - weekTotals.fuel_cents - weekTotals.expenses_cents : 0;
  const netKm = distTotal > 0 && profit > 0 ? Math.round(profit / distTotal) : null;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.cardRowBetween}>
        <Text style={styles.cardTitle}>{t('dashboard.weekly_title')}</Text>
        {weekKm && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceAlt, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: Colors.border }}>
            <Text style={{ color: Colors.textSecondary, fontSize: 10 }}>~</Text>
            <Text style={{ color: Colors.textSecondary, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{weekKm} {distanceUnit}</Text>
          </View>
        )}
      </View>

      {/* 2-column body: bars + right summary */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {/* Bars */}
        <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
          {buckets.map(b => {
            const isToday = b.date === today;
            const hasData = b.net_cents > 0;
            const barPct = hasData ? Math.max(b.net_cents / maxVal, 0.06) : 0.04;
            const barColor = isToday ? Colors.accent : Colors.success;
            const dayLabel = new Date(b.date + 'T12:00:00').toLocaleDateString(language, { weekday: 'short' }).replace('.', '').toUpperCase().slice(0, 3);
            const dayNum = new Date(b.date + 'T12:00:00').getDate();
            return (
              <TouchableOpacity key={b.date} onPress={() => onPress(b.date)} style={{ flex: 1, alignItems: 'center' }} activeOpacity={0.7}>
                <Text style={{ fontSize: 7, color: isToday ? Colors.accent : Colors.textSecondary, fontVariant: ['tabular-nums'], fontWeight: isToday ? '700' : '400', marginBottom: 3, minHeight: 11, textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
                  {hasData ? formatMoney(b.net_cents, currencyCode, locale) : ''}
                </Text>
                <View style={{ width: '100%', height: WBAR_H, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 6, justifyContent: 'flex-end' }}>
                  {hasData ? (
                    <View style={{
                      width: '100%', height: WBAR_H * barPct,
                      borderRadius: 6, backgroundColor: barColor,
                      ...Platform.select({
                        ios: { shadowColor: barColor, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.80, shadowRadius: 8 },
                        android: { elevation: 4 },
                      }),
                    }} />
                  ) : (
                    <View style={{ width: '100%', height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)' }} />
                  )}
                </View>
                <Text style={{ fontSize: 9, color: isToday ? Colors.accent : Colors.textSecondary, fontWeight: isToday ? '700' : '500', marginTop: 5 }}>{dayLabel}</Text>
                <Text style={{ fontSize: 11, color: isToday ? Colors.accent : Colors.textPrimary, fontWeight: isToday ? '800' : '600', marginTop: 1 }}>{dayNum}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Right summary column */}
        {weekTotal > 0 && (
          <View style={{ width: 84, alignItems: 'flex-end', justifyContent: 'center', gap: 6 }}>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: Colors.textSecondary, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>SEMANA</Text>
              <Text style={{ color: Colors.accent, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] }}
                numberOfLines={1} adjustsFontSizeToFit>
                {formatMoney(weekTotal, currencyCode, locale)}
              </Text>
            </View>
            {netKm !== null && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: Colors.success, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  ~ {formatMoney(netKm, currencyCode, locale)}/{distanceUnit}
                </Text>
                <Text style={{ color: Colors.textSecondary, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 }}>{t('dashboard.net_per_km')}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {weekTotals !== null && <WeekNeonBoxes totals={weekTotals} currencyCode={currencyCode} locale={locale} distanceUnit={distanceUnit} />}
    </View>
  );
}

// ─── in-app notifications modal ───────────────────────────────────────────────

function NotificationsModal({ visible, onClose, onChanged }: {
  visible: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<InAppNotification[]>([]);

  useEffect(() => {
    if (visible) getInAppNotifications().then(setItems).catch(() => {});
  }, [visible]);

  async function handleDelete(id: string) {
    await deleteInAppNotification(id).catch(() => {});
    setItems(prev => prev.filter(n => n.id !== id));
    onChanged();
  }

  async function handleClearAll() {
    await clearInAppNotifications().catch(() => {});
    setItems([]);
    onChanged();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
          <Text style={{ color: Colors.textPrimary, fontSize: 18, fontWeight: '700' }}>{t('notifications.title')}</Text>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            {items.length > 0 && (
              <TouchableOpacity onPress={handleClearAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ color: Colors.error, fontSize: 13, fontWeight: '600' }}>{t('notifications.clear_all')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {items.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="notifications-off-outline" size={40} color={Colors.textSecondary} style={{ marginBottom: 12 }} />
            <Text style={{ color: Colors.textSecondary, fontSize: 15 }}>{t('notifications.empty')}</Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: Spacing.md }}>
            {items.map(item => (
              <View key={item.id} style={{ backgroundColor: Colors.surface, borderRadius: 12, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <Ionicons name="notifications-outline" size={18} color={Colors.accent} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: 2 }}>{item.title}</Text>
                  <Text style={{ color: Colors.textSecondary, fontSize: 13 }}>{item.body}</Text>
                  <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 4 }}>
                    {new Date(item.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => handleDelete(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="trash-outline" size={16} color={Colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ─── main screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { t, i18n } = useTranslation();
  const { profile } = useProfile();
  const [userId, setUserId] = useState<string | null>(null);
  const { isPremium } = usePremiumStatus(userId);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [weekBuckets, setWeekBuckets] = useState<DayBucket[]>([]);
  const [monthlyBuckets, setMonthlyBuckets] = useState<MonthBucket[]>([]);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [goal, setGoal] = useState<ActiveGoal | null>(null);
  const [consumptionTrend, setConsumptionTrend] = useState<ConsumptionTrend | null>(null);
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo | null>(null);
  const [monthlyTotals, setMonthlyTotals] = useState<MonthlyTotals | null>(null);
  const [weekTotals, setWeekTotals] = useState<MonthlyTotals | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [monthHistory, setMonthHistory] = useState<MonthHistoryItem[]>([]);
  const [monthDetailItem, setMonthDetailItem] = useState<MonthHistoryItem | null>(null);
  const [streak, setStreak] = useState(0);
  const [cockpitDateStr, setCockpitDateStr] = useState<string | null>(null);
  const [cockpitDetail, setCockpitDetail] = useState<DayDetail | null>(null);
  const [selectedMonthDay, setSelectedMonthDay] = useState<number | null>(null);
  const [notifModalVisible, setNotifModalVisible] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [moodStats, setMoodStats] = useState<MonthMoodStats | null>(null);
  const [prevMonthGross, setPrevMonthGross] = useState(0);
  const [platformBreakdown, setPlatformBreakdown] = useState<PlatformItem[]>([]);

  function refreshNotifCount() {
    getInAppNotifications().then(ns => setNotifCount(ns.length)).catch(() => {});
  }

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);
  useEffect(() => { refreshNotifCount(); }, []);

  const loadData = useCallback(async (uid: string) => {
    const vehicleP = profile?.vehicle_id
      ? supabase.from('vehicles').select('brand, model, year, fuel_type, avg_consumption_per_100')
          .eq('id', profile.vehicle_id).maybeSingle().then(r => r.data, () => null)
      : supabase.from('vehicles').select('brand, model, year, fuel_type, avg_consumption_per_100')
          .eq('user_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle().then(r => r.data, () => null);
    const [todaySummary, buckets, monthly, active, goalData, consumption, vehicleData, mTotals, wTotals, history, streakCount, mood, prevGross, platforms] = await Promise.all([
      getTodaySummary(uid),
      getWeekBuckets(uid),
      getMonthlyBuckets(uid),
      getActiveShift(uid),
      getActiveGoal(uid),
      getConsumptionTrend(uid, profile?.vehicle_id ?? null).catch(() => null),
      vehicleP,
      getMonthlyTotals(uid).catch(() => null),
      getWeekTotals(uid).catch(() => null),
      getMonthHistory(uid).catch(() => [] as MonthHistoryItem[]),
      getStreak(uid).catch(() => 0),
      getMonthMoodStats(uid).catch(() => null),
      getPreviousMonthGross(uid).catch(() => 0),
      getMonthPlatformBreakdown(uid).catch(() => [] as PlatformItem[]),
    ]);
    setSummary(todaySummary);
    setWeekBuckets(buckets);
    setMonthlyBuckets(monthly);
    setActiveShift(active);
    setGoal(goalData);
    setConsumptionTrend(consumption);
    setVehicleInfo(vehicleData as VehicleInfo | null);
    setMonthlyTotals(mTotals);
    setWeekTotals(wTotals);
    setMonthHistory(history);
    setStreak(streakCount);
    setMoodStats(mood);
    setPrevMonthGross(prevGross);
    setPlatformBreakdown(platforms);
  }, [profile?.vehicle_id]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true); setFetchError(false);
    loadData(userId).catch(() => setFetchError(true)).finally(() => setLoading(false));
  }, [userId, loadData]);

  const handleRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true); setFetchError(false);
    await loadData(userId).catch(() => setFetchError(true));
    setRefreshing(false);
  }, [userId, loadData]);

  async function handleGoalSaved() {
    setGoalModalVisible(false);
    if (userId) await loadData(userId).catch(() => {});
  }

  const handleMonthlyDayPress = useCallback((day: number) => {
    const todayDay = new Date().getDate();
    if (day === todayDay) {
      setCockpitDateStr(null);
      setCockpitDetail(null);
      setSelectedMonthDay(null);
      return;
    }
    const n = new Date();
    const d = new Date(n.getFullYear(), n.getMonth(), day);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setSelectedMonthDay(day);
    setCockpitDateStr(ds);
    setCockpitDetail(null);
    if (userId) getDayDetail(userId, ds).then(setCockpitDetail).catch(() => {});
  }, [userId]);

  const currencyCode = profile?.currency_code ?? 'BRL';
  const distanceUnit = profile?.distance_unit ?? 'km';
  const locale = profile?.locale ?? i18n.language;

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.accent} size="large" /></View>;

  const now = new Date();
  const dailyGoalCents = goal != null
    ? getAdaptiveDailyGoalCents(
        goal.target_amount_cents,
        goal.working_days ?? [1, 2, 3, 4, 5, 6],
        monthlyTotals?.gross_cents ?? 0,
        now.getFullYear(),
        now.getMonth() + 1,
        now.getDate(),
      )
    : 0;

  const cockpitIsToday = cockpitDateStr === null;
  const cockpitShifts = cockpitDetail?.shifts ?? [];
  const cockpitGrossCents = cockpitIsToday
    ? (summary?.gross_cents ?? 0)
    : cockpitShifts.reduce((s, sh) => s + (sh.gross_cents ?? 0), 0);
  const cockpitDurationSeconds = cockpitIsToday
    ? (summary?.duration_seconds ?? 0)
    : cockpitShifts.reduce((s, sh) => s + durationFromShift(sh), 0);
  const cockpitDistanceMeters = cockpitIsToday
    ? (summary?.distance_meters ?? 0)
    : cockpitShifts.reduce((s, sh) =>
        sh.odometer_start_meters != null && sh.odometer_end_meters != null
          ? s + (sh.odometer_end_meters - sh.odometer_start_meters)
          : s, 0);
  const cockpitRides = cockpitIsToday ? (summary?.shifts_count ?? 0) : cockpitShifts.length;
  const cockpitExpensesCents = cockpitIsToday
    ? ((summary?.expenses_cents ?? 0) + (summary?.fuel_cents ?? 0))
    : ((cockpitDetail?.expenses_cents ?? 0) + (cockpitDetail?.fuel_cents ?? 0));
  const cockpitOdomStart = cockpitIsToday
    ? (summary?.odometer_start_meters ?? null)
    : cockpitShifts.reduce<number | null>((min, sh) => {
        if (sh.odometer_start_meters == null) return min;
        return min == null ? sh.odometer_start_meters : Math.min(min, sh.odometer_start_meters);
      }, null);
  const cockpitOdomEnd = cockpitIsToday
    ? (summary?.odometer_end_meters ?? null)
    : cockpitShifts.reduce<number | null>((max, sh) => {
        if (sh.odometer_end_meters == null) return max;
        return max == null ? sh.odometer_end_meters : Math.max(max, sh.odometer_end_meters);
      }, null);
  const cockpitDateLabel = cockpitDateStr
    ? new Date(cockpitDateStr + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })
    : undefined;
  const resetCockpit = !cockpitIsToday
    ? () => { setCockpitDateStr(null); setCockpitDetail(null); setSelectedMonthDay(null); }
    : undefined;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.accent} />}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerGreeting}>
                {profile?.name ? t('dashboard.greeting_named', { name: profile.name.split(' ')[0] }) : t('dashboard.greeting_anon')}
                {' '}
                <Text style={{ color: Colors.brandBlue }}>💜</Text>
              </Text>
              <Text style={styles.headerSub}>{
                (() => {
                  const s = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
                  return locale.startsWith('pt')
                    ? s.replace(/([ -])([A-ZÁÉÍÓÚÃÕÂÊÔÀÜ])/g, (_, sep, c) => sep + c.toLowerCase())
                    : s;
                })()
              }</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity onPress={() => setNotifModalVisible(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <View>
                  <Ionicons name="notifications-outline" size={22} color={Colors.textSecondary} />
                  {notifCount > 0 && (
                    <View style={{ position: 'absolute', top: -3, right: -3, width: 14, height: 14, borderRadius: 7, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '800' }}>{notifCount > 9 ? '9+' : notifCount}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleRefresh} disabled={refreshing} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <View style={styles.flameBtn}>
                  <Ionicons name={refreshing ? 'sync-outline' : 'flame'} size={18} color={Colors.accent} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {fetchError && <Text style={styles.errorBanner}>{t('common.error')}</Text>}

        {vehicleInfo && (
          <VehiclePill
            brand={vehicleInfo.brand}
            model={vehicleInfo.model}
            year={vehicleInfo.year}
            fuelType={vehicleInfo.fuel_type}
            kmPerL={
              consumptionTrend?.overall.km_per_l ??
              (vehicleInfo.avg_consumption_per_100 > 0
                ? 100000 / vehicleInfo.avg_consumption_per_100
                : null)
            }
          />
        )}

        <StreakBar streak={streak} />

        {activeShift !== null && <ActiveShiftBanner shift={activeShift} />}

        <CockpitCard
          todayGrossCents={cockpitGrossCents}
          dailyGoalCents={dailyGoalCents}
          rides={cockpitRides}
          durationSeconds={cockpitDurationSeconds}
          distanceMeters={cockpitDistanceMeters}
          expensesTodayCents={cockpitExpensesCents}
          distanceUnit={distanceUnit}
          currencyCode={currencyCode}
          locale={locale}
          onEditGoal={() => setGoalModalVisible(true)}
          dateLabel={cockpitDateLabel}
          onResetToday={resetCockpit}
          odometerStartMeters={cockpitOdomStart}
          odometerEndMeters={cockpitOdomEnd}
          activeDaysThisMonth={monthlyBuckets.filter(b => b.net_cents > 0).length}
        />

        <PremiumGate isPremium={isPremium} reason="dashboard_locked">
          <>
            {/* Kill shot: 4 glassmorphism cards + platform breakdown + equação */}
            {monthlyTotals !== null && monthlyTotals.gross_cents > 0 && (
              <>
                <KillShotCards
                  totals={monthlyTotals}
                  prevGross={prevMonthGross}
                  currencyCode={currencyCode}
                  locale={locale}
                  distanceUnit={distanceUnit}
                />
                <PlatformBreakdownCard
                  platforms={platformBreakdown}
                  currencyCode={currencyCode}
                  locale={locale}
                />
                <EquacaoCard
                  totals={monthlyTotals}
                  distanceUnit={distanceUnit}
                  currencyCode={currencyCode}
                  locale={locale}
                />
              </>
            )}

            {weekBuckets.length > 0 && (
              <WeekBarChart buckets={weekBuckets} weekTotals={weekTotals} currencyCode={currencyCode} locale={locale} language={i18n.language} distanceUnit={distanceUnit} onPress={setSelectedDay} />
            )}

            {monthlyTotals !== null && monthlyTotals.gross_cents > 0 && (
              <ProfitCard totals={monthlyTotals} currencyCode={currencyCode} locale={locale} distanceUnit={distanceUnit} />
            )}
            {monthlyBuckets.length > 0 && (
              <MonthlyChart
                buckets={monthlyBuckets}
                goalCents={goal?.target_amount_cents ?? null}
                currencyCode={currencyCode}
                locale={locale}
                onDayPress={handleMonthlyDayPress}
                selectedDay={selectedMonthDay}
                consumptionTrend={consumptionTrend}
                onEditGoal={() => setGoalModalVisible(true)}
              />
            )}

            {moodStats !== null && <MoodStatsCard stats={moodStats} />}

            <MonthHistoryCard items={monthHistory} currencyCode={currencyCode} locale={locale} onMonthPress={setMonthDetailItem} />
          </>
        </PremiumGate>
      </ScrollView>

      <DayDetailModal visible={selectedDay !== null} dateStr={selectedDay} userId={userId} onClose={() => setSelectedDay(null)} distanceUnit={distanceUnit} currencyCode={currencyCode} locale={locale} />
      <MonthDetailSheet visible={monthDetailItem !== null} item={monthDetailItem} userId={userId ?? ''} currencyCode={currencyCode} locale={locale} onClose={() => setMonthDetailItem(null)} onDayPress={(dateStr) => { setMonthDetailItem(null); setTimeout(() => setSelectedDay(dateStr), 350); }} />
      <GoalEditModal visible={goalModalVisible} currentGoal={goal?.target_amount_cents ?? null} goalWorkingDays={goal?.working_days ?? null} userId={userId} onSaved={handleGoalSaved} onClose={() => setGoalModalVisible(false)} currencyCode={currencyCode} locale={locale} />
      <NotificationsModal visible={notifModalVisible} onClose={() => setNotifModalVisible(false)} onChanged={refreshNotifCount} />
    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const cardShadow = {
  shadowColor: '#94A3B8',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.10,
  shadowRadius: 8,
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  // layout
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  center: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  // header
  header: { marginBottom: Spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerGreeting: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  headerSub: { color: Colors.textSecondary, fontSize: 13, marginTop: 2, textTransform: 'capitalize' },
  flameBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(245,158,11,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: Colors.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 10 },
      android: { elevation: 5 },
    }),
  },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Colors.onAccent, fontSize: 17, fontWeight: '800' },
  // error
  errorBanner: { color: Colors.error, fontSize: 14, backgroundColor: Colors.errorBg, padding: Spacing.sm, borderRadius: Radius.input, marginBottom: Spacing.md },
  // active shift
  activeBanner: {
    backgroundColor: Colors.successBg, borderRadius: Radius.card, padding: Spacing.md,
    marginBottom: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: 'rgba(16,185,129,0.25)',
    ...cardShadow,
  },
  activeDotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  activeBannerLabel: { color: Colors.success, fontSize: 13, fontWeight: '700' },
  activeBannerTimer: {
    color: Colors.textPrimary, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'],
    ...Platform.select({ ios: { fontFamily: 'Menlo' }, android: { fontFamily: 'monospace' } }),
  },
  // today hero card
  todayHero: { backgroundColor: Colors.surface, borderRadius: Radius.card, marginBottom: Spacing.md, overflow: 'hidden', ...cardShadow },
  sectionLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  todayTopRow: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: Spacing.md },
  todayMainStat: { flex: 1 },
  todayMainStatRight: { borderLeftWidth: 1, borderLeftColor: Colors.border, paddingLeft: Spacing.md },
  todayStatBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.successBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 6 },
  todayBadgeText: { color: Colors.success, fontSize: 10, fontWeight: '700' },
  todayBigValue: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  todayBottomRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  todayMiniStat: { flex: 1, alignItems: 'center', gap: 3 },
  todayMiniLabel: { color: Colors.textSecondary, fontSize: 10, fontWeight: '500', textAlign: 'center' },
  todayMiniValue: { color: Colors.textPrimary, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'center' },
  // cards
  card: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, marginBottom: Spacing.md, ...cardShadow },
  cardTitle: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: Spacing.sm },
  cardRowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  // goal
  goalPct: { color: Colors.accent, fontSize: 16, fontWeight: '800' },
  goalOf: { color: Colors.textSecondary, fontSize: 12, marginBottom: Spacing.sm },
  goalRemaining: { color: Colors.accent, fontSize: 12, marginBottom: Spacing.sm },
  progressTrack: { height: 10, backgroundColor: Colors.surfaceAlt, borderRadius: 5, overflow: 'hidden' },
  progressBar: { height: 10, borderRadius: 5 },
  setGoalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.accentDim, borderRadius: Radius.card,
    padding: Spacing.md, marginBottom: Spacing.md,
    borderWidth: 1.5, borderColor: 'rgba(99,102,241,0.2)',
    ...cardShadow,
  },
  setGoalBtnText: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  // consumption
  consumptionRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  consumptionStat: { flex: 1, alignItems: 'center' },
  consumptionValue: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  consumptionUnit: { color: Colors.textSecondary, fontSize: 10, textAlign: 'center', marginTop: 2 },
  consumptionAlert: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: Spacing.sm, borderRadius: Radius.input },
  consumptionAlertText: { fontSize: 12, fontWeight: '600', flex: 1 },
  // section title (monthly chart label)
  sectionTitle: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: Spacing.sm, marginTop: Spacing.xs },
  // week grid (legacy compat, replaced by WeekBarChart)
  weekGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  bucketItem: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, flex: 1, minWidth: '45%', alignItems: 'center', ...cardShadow },
  bucketItemActive: { borderWidth: 1.5, borderColor: 'rgba(16,185,129,0.35)' },
  bucketItemToday: { borderWidth: 1.5, borderColor: 'rgba(99,102,241,0.4)' },
  bucketDay: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  bucketDate: { color: Colors.textPrimary, fontSize: 16, fontWeight: '800', marginVertical: 2 },
  bucketNet: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  // stat grid (legacy)
  todaySection: { marginBottom: Spacing.md },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statBox: { flex: 1, minWidth: '47%', backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, ...cardShadow },
  statBoxGross: { borderTopWidth: 3, borderTopColor: Colors.success },
  statBoxNet: { borderTopWidth: 3, borderTopColor: Colors.accent },
  statBoxLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.xs },
  statBoxValue: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  // goal modal input
  goalInput: {
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, borderWidth: 1.5, borderColor: Colors.border,
    color: Colors.textPrimary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
    fontSize: 22, fontWeight: '700', marginTop: Spacing.sm, marginBottom: Spacing.md, minHeight: 56,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accent, borderRadius: Radius.button, minHeight: 52, marginBottom: Spacing.sm,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 4,
  },
  primaryBtnText: { color: Colors.onAccent, fontSize: 16, fontWeight: '800' },
  // modals
  detailModal: { flex: 1, backgroundColor: Colors.background },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface },
  detailTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700', flex: 1, textTransform: 'capitalize' },
  detailClose: { padding: 4 },
  detailScroll: { flex: 1 },
  detailContent: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  detailSection: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, marginBottom: Spacing.md, ...cardShadow },
  detailSectionTitle: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: Spacing.sm },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.xs },
  detailLabel: { color: Colors.textSecondary, fontSize: 13 },
  detailValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  detailEmpty: { color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xl },
  // vehicle card
  vehicleCard: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, marginBottom: Spacing.md, borderLeftWidth: 3, borderLeftColor: Colors.accent, ...cardShadow },
  vehicleName: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', flex: 1 },
  vehicleTag: { color: Colors.accent, fontSize: 12, fontWeight: '600', backgroundColor: Colors.accentDim, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
});
