import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { useProfile } from '@/src/hooks/useProfile';
import { metersToDisplay } from '@/src/utils/units';
import { formatMoney } from '@/src/utils/currency';
import { getActiveShift } from '@/src/services/shifts';
import {
  getActiveGoal,
  getMonthlyBuckets,
  getTodaySummary,
  getWeekBuckets,
} from '@/src/services/dashboard';
import type { DailySummary, DayBucket, MonthBucket } from '@/src/services/dashboard';
import type { Shift } from '@/src/types';

// ─── helpers ────────────────────────────────────────────────────────────────

function secondsToHHMM(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDurationLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function elapsedSeconds(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}

function daysInCurrentMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

// ─── active shift banner ─────────────────────────────────────────────────────

interface ActiveBannerProps {
  shift: Shift;
}

function ActiveShiftBanner({ shift }: ActiveBannerProps) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(elapsedSeconds(shift.started_at));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(elapsedSeconds(shift.started_at));
    }, 1000);
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
      }
    };
  }, [shift.started_at]);

  return (
    <View style={styles.activeBanner}>
      <Text style={styles.activeBannerLabel}>{t('dashboard.active_shift')}</Text>
      <Text style={styles.activeBannerTimer}>{secondsToHHMM(elapsed)}</Text>
    </View>
  );
}

// ─── today card ─────────────────────────────────────────────────────────────

interface TodayCardProps {
  summary: DailySummary;
  currencyCode: string;
  distanceUnit: 'km' | 'mi';
  locale: string;
}

function TodayCard({ summary, currencyCode, distanceUnit, locale }: TodayCardProps) {
  const { t } = useTranslation();

  const distanceDisplay = metersToDisplay(summary.distance_meters, distanceUnit).toFixed(1);
  const distanceLabel = t('dashboard.km');

  const rows: Array<{ label: string; value: string }> = [
    {
      label: t('dashboard.gross'),
      value: formatMoney(summary.gross_cents, currencyCode, locale),
    },
    {
      label: t('dashboard.net'),
      value: formatMoney(summary.net_cents, currencyCode, locale),
    },
    {
      label: t('dashboard.hours_worked'),
      value: formatDurationLabel(summary.duration_seconds),
    },
    {
      label: t('dashboard.km_driven'),
      value: `${distanceDisplay} ${distanceLabel}`,
    },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('dashboard.today')}</Text>
      {rows.map((row) => (
        <View key={row.label} style={styles.metaRow}>
          <Text style={styles.metaLabel}>{row.label}</Text>
          <Text style={styles.metaValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── week bucket item ─────────────────────────────────────────────────────────

interface WeekBucketItemProps {
  bucket: DayBucket;
  currencyCode: string;
  locale: string;
  language: string;
}

function WeekBucketItem({ bucket, currencyCode, locale, language }: WeekBucketItemProps) {
  const { t } = useTranslation();
  const dayLabel = new Date(bucket.date + 'T12:00:00').toLocaleDateString(language, {
    weekday: 'short',
  });
  const hasData = bucket.net_cents > 0;

  return (
    <View style={styles.bucketItem}>
      <Text style={styles.bucketDay}>{dayLabel}</Text>
      <Text style={[styles.bucketNet, !hasData && styles.bucketNoData]}>
        {hasData ? formatMoney(bucket.net_cents, currencyCode, locale) : t('dashboard.no_data')}
      </Text>
    </View>
  );
}

// ─── goal progress ───────────────────────────────────────────────────────────

interface GoalProgressProps {
  netTodayCents: number;
  targetCents: number;
  currencyCode: string;
  locale: string;
}

function GoalProgress({ netTodayCents, targetCents, currencyCode, locale }: GoalProgressProps) {
  const { t } = useTranslation();
  const dailyTarget = targetCents / daysInCurrentMonth();
  const progress = dailyTarget > 0 ? Math.min(netTodayCents / dailyTarget, 1) : 0;
  const progressPct = Math.round(progress * 100);

  return (
    <View style={styles.card}>
      <View style={styles.goalHeader}>
        <Text style={styles.cardTitle}>{t('dashboard.goal_progress')}</Text>
        <Text style={styles.goalPct}>{progressPct}%</Text>
      </View>
      <Text style={styles.goalOf}>
        {t('dashboard.goal_of')}{formatMoney(targetCents, currencyCode, locale)}
      </Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressBar, { width: `${progressPct}%` }]} />
      </View>
    </View>
  );
}

// ─── monthly chart ───────────────────────────────────────────────────────────

interface MonthlyChartProps {
  buckets: MonthBucket[];
  goalCents: number | null;
  currencyCode: string;
  locale: string;
}

const CHART_H = 100;
const BAR_W = 10;
const BAR_GAP = 6;
const LABEL_H = 18;
const TOTAL_H = CHART_H + LABEL_H;

function MonthlyChart({ buckets, goalCents, currencyCode, locale }: MonthlyChartProps) {
  const { t } = useTranslation();
  const today = new Date().getDate();
  const maxVal = Math.max(...buckets.map(b => b.net_cents), goalCents ?? 0, 1);
  const svgW = buckets.length * (BAR_W + BAR_GAP);
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const dailyGoal = goalCents != null ? goalCents / daysInMonth : null;
  const goalY = dailyGoal != null ? CHART_H - (dailyGoal / maxVal) * CHART_H : null;

  return (
    <View style={styles.card}>
      <View style={styles.goalHeader}>
        <Text style={styles.cardTitle}>{t('dashboard.monthly_chart')}</Text>
        {goalCents != null && (
          <Text style={styles.goalPct}>{formatMoney(goalCents, currencyCode, locale)}</Text>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={svgW} height={TOTAL_H}>
          {goalY != null && (
            <Line
              x1={0} y1={goalY} x2={svgW} y2={goalY}
              stroke={Colors.accent} strokeWidth={1} strokeDasharray="4 3" opacity={0.5}
            />
          )}
          {buckets.map((b, i) => {
            const x = i * (BAR_W + BAR_GAP);
            const barH = b.net_cents > 0 ? Math.max((b.net_cents / maxVal) * CHART_H, 3) : 2;
            const y = CHART_H - barH;
            const isToday = b.day === today;
            const hasData = b.net_cents > 0;
            const barColor = isToday
              ? Colors.accent
              : hasData
                ? Colors.success
                : Colors.surfaceAlt;
            const showLabel = b.day % 5 === 0 || b.day === 1 || isToday;
            return (
              <React.Fragment key={b.day}>
                <Rect x={x} y={y} width={BAR_W} height={barH} rx={3} fill={barColor} opacity={isToday ? 1 : 0.85} />
                {showLabel && (
                  <SvgText
                    x={x + BAR_W / 2} y={TOTAL_H - 2}
                    fontSize={9} fill={isToday ? Colors.accent : Colors.textSecondary}
                    textAnchor="middle" fontWeight={isToday ? '700' : '400'}
                  >
                    {b.day}
                  </SvgText>
                )}
              </React.Fragment>
            );
          })}
        </Svg>
      </ScrollView>
    </View>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────

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
  const [goalTarget, setGoalTarget] = useState<number | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  const loadData = useCallback(async (uid: string) => {
    const [todaySummary, buckets, monthly, active, goal] = await Promise.all([
      getTodaySummary(uid),
      getWeekBuckets(uid),
      getMonthlyBuckets(uid),
      getActiveShift(uid),
      getActiveGoal(uid),
    ]);
    setSummary(todaySummary);
    setWeekBuckets(buckets);
    setMonthlyBuckets(monthly);
    setActiveShift(active);
    setGoalTarget(goal?.target_amount_cents ?? null);
  }, []);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setFetchError(false);
    loadData(userId)
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [userId, loadData]);

  const handleRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    setFetchError(false);
    await loadData(userId).catch(() => setFetchError(true));
    setRefreshing(false);
  }, [userId, loadData]);

  const currencyCode = profile?.currency_code ?? 'BRL';
  const distanceUnit = profile?.distance_unit ?? 'km';
  const locale = profile?.locale ?? i18n.language;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.brandBlue} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.brandBlue}
          />
        }
      >
        <Text style={styles.screenTitle}>{t('tabs.dashboard')}</Text>

        {fetchError && (
          <Text style={styles.errorBanner}>{t('common.error')}</Text>
        )}

        {activeShift !== null && <ActiveShiftBanner shift={activeShift} />}

        {summary !== null && (
          <TodayCard
            summary={summary}
            currencyCode={currencyCode}
            distanceUnit={distanceUnit}
            locale={locale}
          />
        )}

        {goalTarget !== null && summary !== null && (
          <GoalProgress
            netTodayCents={summary.net_cents}
            targetCents={goalTarget}
            currencyCode={currencyCode}
            locale={locale}
          />
        )}

        {monthlyBuckets.length > 0 && (
          <MonthlyChart
            buckets={monthlyBuckets}
            goalCents={goalTarget}
            currencyCode={currencyCode}
            locale={locale}
          />
        )}

        <Text style={styles.sectionTitle}>{t('dashboard.weekly')}</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.weekRow}
        >
          {weekBuckets.map((bucket) => (
            <WeekBucketItem
              key={bucket.date}
              bucket={bucket}
              currencyCode={currencyCode}
              locale={locale}
              language={i18n.language}
            />
          ))}
        </ScrollView>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  center: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: {
    color: Colors.textPrimary,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: Spacing.md,
    ...Platform.select({
      ios: { fontFamily: 'System' },
      android: { fontFamily: 'Roboto' },
    }),
  },
  errorBanner: {
    color: Colors.error,
    fontSize: 14,
    backgroundColor: Colors.surfaceAlt,
    padding: Spacing.sm,
    borderRadius: Radius.input,
    marginBottom: Spacing.md,
  },
  activeBanner: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.input,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeBannerLabel: {
    color: Colors.onBrand,
    fontSize: 14,
    fontWeight: '600',
  },
  activeBannerTimer: {
    color: Colors.onBrand,
    fontSize: 20,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
    ...Platform.select({
      ios: { fontFamily: 'Menlo' },
      android: { fontFamily: 'monospace' },
    }),
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  metaLabel: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  metaValue: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
    marginTop: Spacing.xs,
  },
  weekRow: {
    gap: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  bucketItem: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    minWidth: 90,
    alignItems: 'center',
  },
  bucketDay: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  bucketNet: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  bucketNoData: {
    color: Colors.textSecondary,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  goalOf: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginBottom: Spacing.sm,
  },
  goalPct: {
    color: Colors.brandBlue,
    fontSize: 14,
    fontWeight: '700',
  },
  progressTrack: {
    height: 6,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: 6,
    backgroundColor: Colors.brandBlue,
    borderRadius: 3,
  },
});
