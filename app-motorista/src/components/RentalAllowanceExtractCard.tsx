import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import type { RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';

// Always-visible "how much of my km allowance have I used" card for a
// rental vehicle -- distinct from RentalAllowanceBanner, which stays
// silent until 90% used (that one is a warning, this one is a standing
// extract/statement, shown regardless of how close the driver is to the
// limit). Renders nothing for a non-rental vehicle (status === null).
//
// The bar/percentage above the fold are THIS PERIOD only (periodUsageKm /
// periodAllowanceKm) -- the familiar weekly/monthly habit. The balance line
// below it is the cumulative, never-resets number (balanceKm) that also
// drives isNearLimit/isOverLimit and therefore the bar's color, so a card
// can show e.g. a modest-looking period fill in amber/red if the banked
// balance is what's actually tight.
export function RentalAllowanceExtractCard({ status }: { status: RentalAllowanceStatus | null }) {
  const { t } = useTranslation();
  if (!status) return null;

  const periodPct = Math.min(status.periodUsageKm / status.periodAllowanceKm, 1);
  const periodPctLabel = Math.round(periodPct * 100);
  const barColor = status.isOverLimit ? Colors.error : status.isNearLimit ? Colors.accent : Colors.success;
  const periodLabel = status.allowancePeriod === 'monthly'
    ? t('rental_allowance.period_monthly')
    : t('rental_allowance.period_weekly');
  const isBalancePositive = status.balanceKm >= 0;
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
        {t('rental_allowance.extract_usage', {
          used: status.periodUsageKm.toFixed(0),
          total: status.periodAllowanceKm.toFixed(0),
        })}
      </Text>

      <View style={s.track}>
        <View style={[s.fill, { width: `${periodPct * 100}%`, backgroundColor: barColor }]} />
      </View>

      <View style={s.footerRow}>
        <Text style={[s.balanceText, { color: balanceColor }]} testID="rental-allowance-balance">
          {t(balanceKey, { km: Math.abs(status.balanceKm).toFixed(0) })}
        </Text>
        <Text style={[s.pctText, { color: barColor }]}>{periodPctLabel}%</Text>
      </View>
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
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  balanceText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  pctText: { fontSize: 12, fontWeight: '700' },
});
