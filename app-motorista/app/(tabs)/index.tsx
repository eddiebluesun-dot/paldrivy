import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { useProfile } from '@/src/hooks/useProfile';
import { metersToDisplay } from '@/src/utils/units';
import { decimalToCents, formatMoney } from '@/src/utils/currency';
import { getActiveShift } from '@/src/services/shifts';
import { getConsumptionTrend, type ConsumptionTrend } from '@/src/services/fuelConsumption';
import {
  getActiveGoal, getDayDetail, getMonthlyBuckets, getMonthlyTotals, getTodaySummary, getWeekBuckets, getWeekTotals, upsertMonthlyGoal,
  type ActiveGoal, type DailySummary, type DayBucket, type DayDetail, type MonthBucket, type MonthlyTotals,
} from '@/src/services/dashboard';
import {
  getMonthHistory, getStreak, type MonthHistoryItem,
} from '@/src/services/cockpit';
import { getDailyGoalCents } from '@/src/utils/cockpitUtils';
import { VehiclePill } from '@/src/components/VehiclePill';
import { StreakBar } from '@/src/components/StreakBar';
import { CockpitCard } from '@/src/components/CockpitCard';
import { MonthHistoryCard } from '@/src/components/MonthHistoryCard';
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

function ProfitCard({ totals, currencyCode, locale }: { totals: MonthlyTotals; currencyCode: string; locale: string }) {
  const { t } = useTranslation();
  const totalExpenses = totals.expenses_cents + totals.fuel_cents;
  const profit = totals.gross_cents - totalExpenses;
  const g = totals.gross_cents;
  const margin  = g > 0 ? Math.round((profit              / g) * 100) : 0;
  const fuelPct = g > 0 ? Math.round((totals.fuel_cents   / g) * 100) : 0;
  const expPct  = g > 0 ? Math.round((totals.expenses_cents / g) * 100) : 0;
  const color = margin >= 60 ? Colors.success : margin >= 40 ? Colors.accent : Colors.error;

  const profitColor = margin >= 50 ? Colors.success : margin >= 25 ? Colors.accent : Colors.error;
  const pctItems = [
    { icon: 'water-outline' as const,   label: t('dashboard.fuel_pct'),      pct: fuelPct,  color: '#F59E0B' },
    { icon: 'receipt-outline' as const, label: t('dashboard.other_expenses'), pct: expPct,  color: Colors.error },
    { icon: 'trending-up' as const,     label: t('dashboard.real_profit'),    pct: margin,   color: profitColor },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('dashboard.earnings_expenses_month')}</Text>

      {/* Values row */}
      <View style={{ flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm }}>
        {([
          { label: t('dashboard.revenue_label'),   value: g,             c: Colors.accent },
          { label: t('dashboard.expenses_label'),  value: totalExpenses, c: Colors.error  },
          { label: t('dashboard.real_profit'),     value: profit,        c: profitColor   },
        ] as const).map(item => (
          <View key={item.label} style={{ flex: 1, borderTopWidth: 2, borderTopColor: item.c, paddingTop: Spacing.xs, alignItems: 'center' }}>
            <Text style={styles.consumptionUnit}>{item.label}</Text>
            <Text style={{ color: item.c, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {formatMoney(item.value, currencyCode, locale)}
            </Text>
          </View>
        ))}
      </View>

      {/* Margin progress bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Spacing.md }}>
        <View style={{ flex: 1, height: 6, backgroundColor: Colors.surfaceAlt, borderRadius: 3, overflow: 'hidden' }}>
          <View style={{ width: `${Math.max(0, Math.min(margin, 100))}%` as any, height: 6, backgroundColor: color, borderRadius: 3 }} />
        </View>
        <Text style={{ color, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] }}>{margin}{t('dashboard.margin_pct')}</Text>
      </View>

      {/* % breakdown pills */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {pctItems.map(item => (
          <View key={item.label} style={{ flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: Spacing.sm, alignItems: 'center', gap: 3 }}>
            <Ionicons name={item.icon} size={13} color={item.color} />
            <Text style={{ color: item.color, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{item.pct}%</Text>
            <Text style={{ color: Colors.textSecondary, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.3 }}>{item.label}</Text>
          </View>
        ))}
      </View>
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

const CHART_H = 180, BAR_W = 10, BAR_GAP = 6, LABEL_H = 18, TOTAL_H = CHART_H + LABEL_H;

function MonthlyChart({ buckets, goalCents, currencyCode, locale }: {
  buckets: MonthBucket[]; goalCents: number | null; currencyCode: string; locale: string;
}) {
  const { t } = useTranslation();
  const today = new Date().getDate();
  const monthlyTotal = buckets.reduce((s, b) => s + b.net_cents, 0);
  const remaining = goalCents != null ? Math.max(goalCents - monthlyTotal, 0) : null;
  const dailyGoal = goalCents != null ? Math.ceil(goalCents / daysInCurrentMonth()) : 0;
  const maxVal = Math.max(...buckets.map(b => b.net_cents), dailyGoal, 1);
  const svgW = buckets.length * (BAR_W + BAR_GAP);
  const goalY = goalCents != null ? CHART_H - (dailyGoal / maxVal) * CHART_H : null;
  return (
    <View style={styles.card}>
      <View style={styles.cardRowBetween}>
        <Text style={styles.cardTitle}>{t('dashboard.monthly_chart')}</Text>
        <Text style={[styles.goalPct, { color: Colors.success }]}>{formatMoney(monthlyTotal, currencyCode, locale)}</Text>
      </View>
      {remaining !== null && remaining > 0 && <Text style={styles.goalRemaining}>{t('dashboard.goal_remaining', { amount: formatMoney(remaining, currencyCode, locale) })}</Text>}
      {remaining !== null && remaining === 0 && <Text style={[styles.goalRemaining, { color: Colors.success }]}>{t('dashboard.goal_reached')}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={svgW} height={TOTAL_H}>
          {goalY != null && <Line x1={0} y1={goalY} x2={svgW} y2={goalY} stroke={Colors.accent} strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />}
          {buckets.map((b, i) => {
            const x = i * (BAR_W + BAR_GAP);
            const barH = b.net_cents > 0 ? Math.max((b.net_cents / maxVal) * CHART_H, 3) : 2;
            const isToday = b.day === today;
            return (
              <React.Fragment key={b.day}>
                <Rect x={x} y={CHART_H - barH} width={BAR_W} height={barH} rx={3} fill={isToday ? Colors.accent : b.net_cents > 0 ? Colors.success : Colors.surfaceAlt} opacity={isToday ? 1 : 0.85} />
                {(b.day % 5 === 0 || b.day === 1 || isToday) && (
                  <SvgText x={x + BAR_W / 2} y={TOTAL_H - 2} fontSize={9} fill={isToday ? Colors.accent : Colors.textSecondary} textAnchor="middle" fontWeight={isToday ? '700' : '400'}>{b.day}</SvgText>
                )}
              </React.Fragment>
            );
          })}
        </Svg>
      </ScrollView>
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

  const label = dateStr ? new Date(dateStr + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const shifts = detail?.shifts ?? [];
  const totalGross = shifts.reduce((s, sh) => s + (sh.gross_cents ?? 0), 0);
  const totalNet = shifts.reduce((s, sh) => s + (sh.net_cents ?? 0), 0);
  const totalDur = shifts.reduce((s, sh) => s + durationFromShift(sh), 0);
  const totalKm = shifts.reduce((s, sh) => sh.odometer_start_meters != null && sh.odometer_end_meters != null ? s + (sh.odometer_end_meters - sh.odometer_start_meters) : s, 0);
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

const WBAR_H = 160;

function BreakdownPills({ totals }: { totals: MonthlyTotals }) {
  const { t } = useTranslation();
  const g = totals.gross_cents;
  if (g === 0) return null;
  const fuelPct = Math.round((totals.fuel_cents / g) * 100);
  const expPct  = Math.round((totals.expenses_cents / g) * 100);
  const profit  = g - totals.fuel_cents - totals.expenses_cents;
  const margin  = Math.round((profit / g) * 100);
  const profitColor = margin >= 50 ? Colors.success : margin >= 25 ? Colors.accent : Colors.error;
  const pills = [
    { icon: 'water-outline' as const,   label: t('dashboard.day_fuel_pct'),     pct: fuelPct, color: '#F59E0B' },
    { icon: 'receipt-outline' as const, label: t('dashboard.day_expenses_pct'), pct: expPct,  color: Colors.error },
    { icon: 'trending-up' as const,     label: t('dashboard.day_profit_pct'),   pct: margin,  color: profitColor },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: Spacing.sm }}>
      {pills.map(item => (
        <View key={item.label} style={{ flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: Spacing.sm, alignItems: 'center', gap: 2 }}>
          <Ionicons name={item.icon} size={11} color={item.color} />
          <Text style={{ color: item.color, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{item.pct}%</Text>
          <Text style={{ color: Colors.textSecondary, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.3 }}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function WeekBarChart({ buckets, weekTotals, currencyCode, locale, language, onPress }: {
  buckets: DayBucket[]; weekTotals: MonthlyTotals | null; currencyCode: string; locale: string; language: string; onPress: (d: string) => void;
}) {
  const { t } = useTranslation();
  const maxVal = Math.max(...buckets.map(b => b.net_cents), 1);
  const today = new Date().toISOString().slice(0, 10);
  const weekTotal = buckets.reduce((s, b) => s + b.net_cents, 0);

  return (
    <View style={styles.card}>
      <View style={styles.cardRowBetween}>
        <Text style={styles.cardTitle}>{t('dashboard.weekly_title')}</Text>
        {weekTotal > 0 && (
          <Text style={{ color: Colors.success, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
            {formatMoney(weekTotal, currencyCode, locale)}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {buckets.map(b => {
          const isToday = b.date === today;
          const hasData = b.net_cents > 0;
          const barPct = hasData ? Math.max(b.net_cents / maxVal, 0.06) : 0.04;
          const dayLabel = new Date(b.date + 'T12:00:00').toLocaleDateString(language, { weekday: 'short' }).replace('.', '').toUpperCase().slice(0, 3);
          const dayNum = new Date(b.date + 'T12:00:00').getDate();
          return (
            <TouchableOpacity key={b.date} onPress={() => onPress(b.date)} style={{ flex: 1, alignItems: 'center' }} activeOpacity={0.7}>
              <Text style={{ fontSize: 8, color: isToday ? Colors.accent : Colors.textSecondary, fontVariant: ['tabular-nums'], fontWeight: isToday ? '700' : '400', marginBottom: 4, minHeight: 13, textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
                {hasData ? formatMoney(b.net_cents, currencyCode, locale) : ''}
              </Text>
              <View style={{ width: '100%', height: WBAR_H, backgroundColor: Colors.surfaceAlt, borderRadius: 8, justifyContent: 'flex-end', overflow: 'hidden' }}>
                <View style={{ width: '100%', height: WBAR_H * barPct, backgroundColor: isToday ? Colors.accent : Colors.success, borderRadius: 8, opacity: isToday ? 1 : 0.65 }} />
              </View>
              <Text style={{ fontSize: 10, color: isToday ? Colors.accent : Colors.textSecondary, fontWeight: isToday ? '700' : '500', marginTop: 6 }}>{dayLabel}</Text>
              <Text style={{ fontSize: 12, color: isToday ? Colors.accent : Colors.textPrimary, fontWeight: isToday ? '800' : '600', marginTop: 1 }}>{dayNum}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {weekTotals !== null && <BreakdownPills totals={weekTotals} />}
    </View>
  );
}

// ─── main screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { t, i18n } = useTranslation();
  const { profile } = useProfile();
  const [userId, setUserId] = useState<string | null>(null);
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
  const [streak, setStreak] = useState(0);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);

  const loadData = useCallback(async (uid: string) => {
    const vehicleP = profile?.vehicle_id
      ? supabase.from('vehicles').select('brand, model, year, fuel_type, avg_consumption_per_100')
          .eq('id', profile.vehicle_id).maybeSingle().then(r => r.data, () => null)
      : supabase.from('vehicles').select('brand, model, year, fuel_type, avg_consumption_per_100')
          .eq('user_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle().then(r => r.data, () => null);
    const [todaySummary, buckets, monthly, active, goalData, consumption, vehicleData, mTotals, wTotals, history, streakCount] = await Promise.all([
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

  const currencyCode = profile?.currency_code ?? 'BRL';
  const distanceUnit = profile?.distance_unit ?? 'km';
  const locale = profile?.locale ?? i18n.language;

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.accent} size="large" /></View>;

  const now = new Date();
  const dailyGoalCents = goal != null
    ? getDailyGoalCents(
        goal.target_amount_cents,
        goal.working_days ?? [1, 2, 3, 4, 5, 6],
        now.getFullYear(),
        now.getMonth() + 1,
      )
    : 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.accent} />}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerGreeting}>
                {profile?.name ? t('dashboard.greeting_named', { name: profile.name.split(' ')[0] }) : t('dashboard.greeting_anon')}
              </Text>
              <Text style={styles.headerSub}>{new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity onPress={handleRefresh} disabled={refreshing} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="refresh-outline" size={20} color={refreshing ? Colors.borderBright : Colors.textSecondary} />
              </TouchableOpacity>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{profile?.name ? profile.name.charAt(0).toUpperCase() : 'D'}</Text>
              </View>
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
          todayGrossCents={summary?.gross_cents ?? 0}
          dailyGoalCents={dailyGoalCents}
          rides={0}
          durationSeconds={summary?.duration_seconds ?? 0}
          distanceMeters={summary?.distance_meters ?? 0}
          expensesTodayCents={(summary?.expenses_cents ?? 0) + (summary?.fuel_cents ?? 0)}
          distanceUnit={distanceUnit}
          currencyCode={currencyCode}
          locale={locale}
          onEditGoal={() => setGoalModalVisible(true)}
        />

        {monthlyBuckets.length > 0 && <MonthlyChart buckets={monthlyBuckets} goalCents={goal?.target_amount_cents ?? null} currencyCode={currencyCode} locale={locale} />}
        {consumptionTrend !== null && <FuelConsumptionCard trend={consumptionTrend} />}

        {monthlyTotals !== null && monthlyTotals.gross_cents > 0 && (
          <ProfitCard totals={monthlyTotals} currencyCode={currencyCode} locale={locale} />
        )}

        {weekBuckets.length > 0 && (
          <WeekBarChart buckets={weekBuckets} weekTotals={weekTotals} currencyCode={currencyCode} locale={locale} language={i18n.language} onPress={setSelectedDay} />
        )}

        <MonthHistoryCard items={monthHistory} currencyCode={currencyCode} locale={locale} />
      </ScrollView>

      <DayDetailModal visible={selectedDay !== null} dateStr={selectedDay} userId={userId} onClose={() => setSelectedDay(null)} distanceUnit={distanceUnit} currencyCode={currencyCode} locale={locale} />
      <GoalEditModal visible={goalModalVisible} currentGoal={goal?.target_amount_cents ?? null} goalWorkingDays={goal?.working_days ?? null} userId={userId} onSaved={handleGoalSaved} onClose={() => setGoalModalVisible(false)} currencyCode={currencyCode} locale={locale} />
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
