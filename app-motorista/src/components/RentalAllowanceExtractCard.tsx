import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import type { RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';

// Always-visible "how much of my km allowance have I used" card for a
// rental vehicle. The top line (current-cycle usage) always shows,
// capped or not. The bar/balance/percentage below it are the CUMULATIVE,
// never-resets figures and only render when there's an actual cap
// (cumulativeAllowanceKm/balanceKm non-null) -- see
// docs/superpowers/specs/2026-08-19-km-allowance-cycle-generalization-design.md.
export function RentalAllowanceExtractCard({ status }: { status: RentalAllowanceStatus | null }) {
  const { t } = useTranslation();
  if (!status) return null;

  const periodLabel = status.allowancePeriod === 'monthly'
    ? t('rental_allowance.period_monthly')
    : status.allowancePeriod === 'daily'
      ? t('rental_allowance.period_daily')
      : t('rental_allowance.period_weekly');

  const isCapped = status.cumulativeAllowanceKm != null && status.balanceKm != null;
  const pct = isCapped ? Math.min(status.cumulativeUsageKm / status.cumulativeAllowanceKm!, 1) : 0;
  const pctLabel = Math.round(pct * 100);
  const barColor = status.isOverLimit ? Colors.error : status.isNearLimit ? Colors.accent : Colors.success;
  const isBalancePositive = (status.balanceKm ?? 0) >= 0;
  const balanceKey = isBalancePositive
    ? 'rental_allowance.extract_balance_positive'
    : 'rental_allowance.extract_balance_negative';
  const balanceColor = isBalancePositive ? Colors.success : Colors.error;

  return (
    <View style={s.card} testID="rental-allowance-extract">
      <View style={s.headerRow}>
        <Text style={s.title}>{t('rental_allowance.extract_title')}</Text>
        <Text style={s.period}>{periodLabel}</Text>
      </View>

      <Text style={s.usageText}>
        {t('rental_allowance.current_cycle', {
          km: status.currentCycleUsageKm.toFixed(0),
          period: periodLabel,
        })}
      </Text>

      {isCapped ? (
        <>
          <Text style={s.cumulativeText}>
            {t('rental_allowance.extract_usage', {
              used: status.cumulativeUsageKm.toFixed(0),
              total: status.cumulativeAllowanceKm!.toFixed(0),
            })}
          </Text>

          <View style={s.track}>
            <View
              testID="rental-allowance-fill"
              style={[s.fill, { width: `${pct * 100}%`, backgroundColor: barColor }]}
            />
          </View>

          <View style={s.footerRow}>
            <Text style={[s.balanceText, { color: balanceColor }]} testID="rental-allowance-balance">
              {t(balanceKey, { km: Math.abs(status.balanceKm!).toFixed(0) })}
            </Text>
            <Text style={[s.pctText, { color: barColor }]}>{pctLabel}%</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md,
    marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  title: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  period: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  usageText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: Spacing.sm },
  cumulativeText: { color: Colors.textSecondary, fontSize: 12, marginBottom: Spacing.xs },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  balanceText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  pctText: { fontSize: 12, fontWeight: '700' },
});
