import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import { formatMoney } from '../utils/currency';
import type { RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';

// Dashboard hero banner for rental-vehicle km allowance: silent until the
// CUMULATIVE balance hits 90% used, then a warning; once the balance goes
// negative, an over-limit banner showing the estimated cost of the
// accumulated debt. Informational only -- no action button, since (unlike
// the old per-period design) the debt can pay itself off automatically if a
// later period comes in under its own allowance; a driver who wants to log
// an out-of-pocket expense for it can still do so manually from the
// Despesas tab. currencyCode/locale are optional (default to this app's
// BRL/pt-BR fallback, matching the dashboard screen's own defaults) so
// callers that only track odometer math, not money display, don't need to
// thread them through.
export function RentalAllowanceBanner({
  status, currencyCode = 'BRL', locale = 'pt-BR',
}: {
  status: RentalAllowanceStatus | null;
  currencyCode?: string;
  locale?: string;
}) {
  const { t } = useTranslation();
  if (!status || !status.isNearLimit) return null;

  const baselineDisclosure = status.baselineIsEstimated ? (
    <Text style={s.subText} testID="rental-allowance-baseline-estimated">
      {t('rental_allowance.baseline_estimated')}
    </Text>
  ) : null;

  if (status.isOverLimit) {
    return (
      <View style={[s.banner, s.over]} testID="rental-allowance-over">
        <View style={s.textCol}>
          <Text style={s.text}>
            {t('rental_allowance.over_limit', {
              km: status.overageKm.toFixed(0),
              cost: formatMoney(status.overageCostCents, currencyCode, locale),
            })}
          </Text>
          {baselineDisclosure}
        </View>
      </View>
    );
  }

  const percent = Math.round((status.cumulativeUsageKm / status.cumulativeAllowanceKm) * 100);
  return (
    <View style={[s.banner, s.warning]} testID="rental-allowance-warning">
      <View style={s.textCol}>
        <Text style={s.text}>
          {t('rental_allowance.near_limit', {
            percent: String(percent),
            km: status.remainingKm.toFixed(0),
          })}
        </Text>
        {baselineDisclosure}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  warning: { backgroundColor: Colors.accentDim, borderColor: 'rgba(245,158,11,0.35)' },
  over: { backgroundColor: Colors.errorBg, borderColor: 'rgba(239,68,68,0.30)' },
  textCol: { flexShrink: 1, gap: 4 },
  text: { color: Colors.textPrimary, fontSize: 14, flexShrink: 1 },
  subText: { color: Colors.textSecondary, fontSize: 12, flexShrink: 1 },
});
