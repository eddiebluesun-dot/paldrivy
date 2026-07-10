import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Radius, Spacing } from '../theme';
import { formatMoney } from '../utils/currency';
import { metersToDisplay } from '../utils/units';
import { useTranslation } from 'react-i18next';

function secondsToHHMM(s: number): string {
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

const GAUGE_R = 76;
const GAUGE_CX = 100;
const GAUGE_CY = 90;
// Upper semicircle: large-arc=0, sweep=1 (clockwise on screen = upward from left to right)
const TRACK_D = `M ${GAUGE_CX - GAUGE_R} ${GAUGE_CY} A ${GAUGE_R} ${GAUGE_R} 0 0 1 ${GAUGE_CX + GAUGE_R} ${GAUGE_CY}`;
const HALF_CIRC = Math.PI * GAUGE_R; // ≈ 238.76

interface MicroStat {
  icon: 'car-outline' | 'time-outline' | 'navigate-outline' | 'receipt-outline';
  label: string;
  value: string;
  valueColor?: string;
}

interface CockpitCardProps {
  todayGrossCents: number;
  dailyGoalCents: number;
  rides: number;
  durationSeconds: number;
  distanceMeters: number;
  expensesTodayCents: number;
  distanceUnit: 'km' | 'mi';
  currencyCode: string;
  locale: string;
  onEditGoal: () => void;
}

export function CockpitCard({
  todayGrossCents,
  dailyGoalCents,
  rides,
  durationSeconds,
  distanceMeters,
  expensesTodayCents,
  distanceUnit,
  currencyCode,
  locale,
  onEditGoal,
}: CockpitCardProps) {
  const { t } = useTranslation();

  const hasGoal = dailyGoalCents > 0;
  const pct = hasGoal ? Math.min(todayGrossCents / dailyGoalCents, 1) : 0;
  const metGoal = todayGrossCents >= dailyGoalCents && hasGoal;
  const remainCents = Math.max(dailyGoalCents - todayGrossCents, 0);

  const dashFill = HALF_CIRC * pct;
  const dashEmpty = HALF_CIRC * (1 - pct) + 10; // +10 so end doesn't bleed

  const microStats: MicroStat[] = [
    { icon: 'car-outline', label: t('dashboard.day_shifts'), value: String(rides) },
    { icon: 'time-outline', label: t('dashboard.hours_worked'), value: secondsToHHMM(durationSeconds) },
    {
      icon: 'navigate-outline',
      label: distanceUnit === 'km' ? t('dashboard.km') : 'Mi',
      value: metersToDisplay(distanceMeters, distanceUnit).toFixed(1),
    },
    {
      icon: 'receipt-outline',
      label: t('dashboard.expenses_label'),
      value: formatMoney(expensesTodayCents, currencyCode, locale),
      valueColor: expensesTodayCents > 0 ? Colors.error : undefined,
    },
  ];

  return (
    <View style={styles.card}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>{t('dashboard.today')}</Text>
        <TouchableOpacity onPress={onEditGoal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="pencil-outline" size={14} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* SVG Gauge */}
      <View style={styles.gaugeWrap}>
        <Svg width={200} height={130} viewBox="0 0 200 130">
          {/* Track */}
          <Path
            d={TRACK_D}
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={12}
            strokeLinecap="round"
          />

          {/* Fill arc — solid colors for cross-platform compatibility */}
          {pct > 0 && (
            <Path
              d={TRACK_D}
              fill="none"
              stroke={metGoal ? Colors.success : pct < 0.5 ? Colors.error : Colors.accent}
              strokeWidth={12}
              strokeLinecap="round"
              strokeDasharray={`${dashFill} ${dashEmpty}`}
            />
          )}

          {/* Percentage label */}
          <SvgText
            x={GAUGE_CX} y={GAUGE_CY - 10}
            textAnchor="middle" fontSize={11}
            fill={Colors.textSecondary} fontWeight="600"
          >
            {metGoal ? '✅ Meta!' : hasGoal ? `${Math.round(pct * 100)}%` : 'sem meta'}
          </SvgText>

          {/* Main value */}
          <SvgText
            x={GAUGE_CX} y={GAUGE_CY + 14}
            textAnchor="middle" fontSize={21}
            fill={metGoal ? Colors.success : Colors.textPrimary} fontWeight="800"
          >
            {formatMoney(todayGrossCents, currencyCode, locale)}
          </SvgText>

          {/* Sub-label */}
          <SvgText
            x={GAUGE_CX} y={GAUGE_CY + 30}
            textAnchor="middle" fontSize={9}
            fill={Colors.textSecondary}
          >
            ganhos hoje
          </SvgText>
        </Svg>
      </View>

      {/* Goal label */}
      {hasGoal && (
        <View style={styles.goalRow}>
          {metGoal ? (
            <Text style={[styles.goalLabel, { color: Colors.success }]}>
              +{formatMoney(todayGrossCents - dailyGoalCents, currencyCode, locale)} acima da meta ✓
            </Text>
          ) : (
            <Text style={styles.goalLabel}>
              Meta diária · {formatMoney(dailyGoalCents, currencyCode, locale)} · Faltam {formatMoney(remainCents, currencyCode, locale)}
            </Text>
          )}
        </View>
      )}

      {/* 4 micro-stats */}
      <View style={styles.statsRow}>
        {microStats.map(s => (
          <View key={s.label} style={styles.stat}>
            <Ionicons name={s.icon} size={14} color={Colors.textSecondary} />
            <Text style={[styles.statValue, s.valueColor ? { color: s.valueColor } : {}]}>
              {s.value}
            </Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const cardShadow = {
  shadowColor: '#94A3B8', shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.10, shadowRadius: 8, elevation: 2,
} as const;

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    ...cardShadow,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  gaugeWrap: { alignItems: 'center', marginVertical: Spacing.xs },
  goalRow: { alignItems: 'center', marginBottom: Spacing.sm },
  goalLabel: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center' },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.md,
    gap: 4,
  },
  stat: { flex: 1, alignItems: 'center', gap: 3 },
  statValue: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  statLabel: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});
