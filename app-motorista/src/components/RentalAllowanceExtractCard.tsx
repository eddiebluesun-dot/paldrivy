import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import type { RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';

// Always-visible "how much of my km allowance have I used" card for a
// rental vehicle -- distinct from RentalAllowanceBanner, which stays
// silent until 90% used (that one is a warning, this one is a standing
// extract/statement, shown regardless of how close the driver is to the
// limit). Renders nothing for a non-rental vehicle (status === null).
export function RentalAllowanceExtractCard({ status }: { status: RentalAllowanceStatus | null }) {
  const { t } = useTranslation();
  if (!status) return null;

  const pct = Math.min(status.percentUsed, 1);
  const pctLabel = Math.round(status.percentUsed * 100);
  const barColor = status.isOverLimit ? Colors.error : status.isNearLimit ? Colors.accent : Colors.success;
  const periodLabel = status.allowancePeriod === 'monthly'
    ? t('rental_allowance.period_monthly')
    : t('rental_allowance.period_weekly');

  return (
    <View style={s.card} testID="rental-allowance-extract">
      <View style={s.headerRow}>
        <Text style={s.title}>{t('rental_allowance.extract_title')}</Text>
        <Text style={s.period}>{periodLabel}</Text>
      </View>

      <Text style={s.usageText}>
        {t('rental_allowance.extract_usage', {
          used: status.usageKm.toFixed(0),
          total: status.allowanceAmountKm.toFixed(0),
        })}
      </Text>

      <View style={s.track}>
        <View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
      </View>

      <Text style={[s.pctText, { color: barColor }]}>{pctLabel}%</Text>
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
  pctText: { fontSize: 12, fontWeight: '700', marginTop: 4, textAlign: 'right' },
});
