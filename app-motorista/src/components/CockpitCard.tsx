import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Radius, Spacing } from '../theme';
import { formatMoney } from '../utils/currency';
import { metersToDisplay } from '../utils/units';
import { useTranslation } from 'react-i18next';

const DONUT_SIZE = 112;
const CX = DONUT_SIZE / 2;
const CY = DONUT_SIZE / 2;
const R = 44;
const CIRC = 2 * Math.PI * R;
const OFFSET = CIRC * 0.25;

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
  dateLabel?: string;
  onResetToday?: () => void;
  odometerStartMeters?: number | null;
  odometerEndMeters?: number | null;
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
  dateLabel,
  onResetToday,
  odometerStartMeters,
  odometerEndMeters,
}: CockpitCardProps) {
  const { t } = useTranslation();

  const hasGoal = dailyGoalCents > 0;
  const pct = hasGoal ? Math.min(todayGrossCents / dailyGoalCents, 1) : 0;
  const metGoal = todayGrossCents >= dailyGoalCents && hasGoal;
  const aboveGoalCents = todayGrossCents - dailyGoalCents;
  const remainCents = Math.max(dailyGoalCents - todayGrossCents, 0);

  const dashFill = Math.max(CIRC * pct - 2, 0);
  const dashEmpty = CIRC * (1 - pct) + 10;

  const arcColor =
    metGoal        ? Colors.success :
    !hasGoal || pct <= 0 ? 'rgba(255,255,255,0.12)' :
    pct < 0.35     ? Colors.error :
    pct < 0.70     ? '#F97316' :
                     Colors.accent;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={onResetToday}
          disabled={!onResetToday}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.sectionLabel, !!dateLabel && { color: Colors.accent }]}>
            {dateLabel ?? t('dashboard.today')}
          </Text>
        </TouchableOpacity>

        {/* "Days active this month" already lives at the top of the
            dashboard (StreakBar) — showing it again here just duplicated
            that figure and, worse, drifted out of sync with it. This is now
            a single, clearly-labeled edit-goal action instead. It also
            doubles as the only reachable edit-goal control for free users,
            since the other one (Resumo do Mês) is premium-gated. */}
        <TouchableOpacity
          onPress={onEditGoal}
          style={styles.editGoalPill}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="pencil-outline" size={12} color={Colors.accent} />
          <Text style={styles.editGoalText} numberOfLines={1}>{t('dashboard.edit_goal_btn')}</Text>
        </TouchableOpacity>
      </View>

      {/* 3-column body */}
      <View style={styles.bodyRow}>

        {/* LEFT — donut arc only, no text inside */}
        <View style={styles.donutCol}>
          <Svg width={DONUT_SIZE} height={DONUT_SIZE} viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}>
            {/* Track */}
            <Circle cx={CX} cy={CY} r={R} fill="none"
              stroke="rgba(255,255,255,0.07)" strokeWidth={10} />

            {pct > 0 && (
              <>
                {/* Outer glow */}
                <Circle cx={CX} cy={CY} r={R} fill="none" stroke={arcColor}
                  strokeWidth={22} opacity={0.07} strokeLinecap="round"
                  strokeDasharray={`${dashFill} ${dashEmpty}`} strokeDashoffset={OFFSET} />
                {/* Mid glow */}
                <Circle cx={CX} cy={CY} r={R} fill="none" stroke={arcColor}
                  strokeWidth={14} opacity={0.15} strokeLinecap="round"
                  strokeDasharray={`${dashFill} ${dashEmpty}`} strokeDashoffset={OFFSET} />
                {/* Main arc */}
                <Circle cx={CX} cy={CY} r={R} fill="none" stroke={arcColor}
                  strokeWidth={9} strokeLinecap="round"
                  strokeDasharray={`${dashFill} ${dashEmpty}`} strokeDashoffset={OFFSET} />
              </>
            )}
          </Svg>

          {/* % badge overlaid at center */}
          <View style={styles.donutCenter} pointerEvents="none">
            <Text style={[styles.donutPct, { color: arcColor }]}>
              {hasGoal ? `${Math.round(pct * 100)}%` : '—'}
            </Text>
          </View>
        </View>

        {/* CENTER — earnings text */}
        <View style={styles.centerCol}>
          {metGoal ? (
            <Text style={styles.metaLabel}>{t('dashboard.cockpit_daily_goal_met', {
              goal: formatMoney(dailyGoalCents, currencyCode, locale),
            })}</Text>
          ) : hasGoal ? (
            <Text style={styles.metaLabel}>{t('dashboard.cockpit_daily_goal', {
              goal: formatMoney(dailyGoalCents, currencyCode, locale),
              remaining: formatMoney(remainCents, currencyCode, locale),
            })}</Text>
          ) : (
            <Text style={styles.metaLabel}>{t('dashboard.cockpit_no_goal')}</Text>
          )}

          <Text style={[styles.earningsValue, metGoal && { color: Colors.success }]}
            numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {formatMoney(todayGrossCents, currencyCode, locale)}
          </Text>

          <Text style={styles.earningsLabel}>{t('dashboard.cockpit_earnings_today')}</Text>

          {metGoal && aboveGoalCents > 0 && (
            <View style={styles.aboveGoalRow}>
              <Text style={styles.aboveGoalText}>
                +{formatMoney(aboveGoalCents, currencyCode, locale)} {t('dashboard.cockpit_above_goal_short')} ✓
              </Text>
              <Ionicons name="trending-up" size={11} color={Colors.success} />
            </View>
          )}

          {(odometerStartMeters != null || odometerEndMeters != null) && (
            <View style={styles.odomRow}>
              <Ionicons name="speedometer-outline" size={10} color={Colors.textSecondary} />
              <Text style={styles.odomText}>
                {odometerStartMeters != null ? `${metersToDisplay(odometerStartMeters, distanceUnit).toFixed(0)}` : '?'}
                {' → '}
                {odometerEndMeters != null ? `${metersToDisplay(odometerEndMeters, distanceUnit).toFixed(0)} ${distanceUnit}` : '?'}
                {odometerStartMeters != null && odometerEndMeters != null && odometerEndMeters > odometerStartMeters
                  ? ` (${metersToDisplay(odometerEndMeters - odometerStartMeters, distanceUnit).toFixed(0)} ${distanceUnit} ${t('dashboard.cockpit_distance_driven')})`
                  : ''}
              </Text>
            </View>
          )}
        </View>

        {/* RIGHT — expenses card */}
        <View style={styles.expensesCol}>
          <View style={styles.expensesCard}>
            <Ionicons name="receipt-outline" size={18} color={Colors.error} style={{ marginBottom: 6 }} />
            {/* adjustsFontSizeToFit/minimumFontScale have no react-native-web
                implementation -- on web numberOfLines alone was left to
                truncate with an ellipsis instead of shrinking, cutting off
                any value at or past R$ 100,00. Sized the box for the full
                "R$ xx.xxx,xx" range instead and allowed a 2-line wrap, which
                works identically on both platforms. */}
            <Text style={styles.expensesValue} numberOfLines={2}>
              {formatMoney(expensesTodayCents, currencyCode, locale)}
            </Text>
            <Text style={styles.expensesLabel} numberOfLines={1}>DESPESAS</Text>
          </View>
        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12 },
      android: { elevation: 5 },
    }),
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    flexShrink: 0,
  },
  editGoalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.accentDim,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
    maxWidth: '68%',
  },
  editGoalText: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  donutCol: {
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    position: 'relative',
  },
  donutCenter: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutPct: {
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  centerCol: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 4,
  },
  metaLabel: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  earningsValue: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  earningsLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 8,
  },
  aboveGoalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  aboveGoalText: {
    color: Colors.success,
    fontSize: 11,
    fontWeight: '700',
  },
  odomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  odomText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
  expensesCol: {
    width: 92,
    alignItems: 'stretch',
  },
  expensesCard: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(239,68,68,0.30)',
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 98,
    ...Platform.select({
      ios: { shadowColor: Colors.error, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.25, shadowRadius: 8 },
      android: { elevation: 3 },
    }),
  },
  expensesValue: {
    color: Colors.error,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  expensesLabel: {
    color: Colors.error,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 3,
    opacity: 0.75,
  },
});
