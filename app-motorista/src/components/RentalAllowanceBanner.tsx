import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import { formatMoney } from '../utils/currency';
import type { RentalAllowanceStatus } from '../utils/rentalKmAllowanceUtils';

// Dashboard hero banner for rental-vehicle km allowance: silent until 90%
// used, then a warning; at 100%+ an over-limit banner with a one-tap
// "log as expense" action. currencyCode/locale are optional (default to
// this app's BRL/pt-BR fallback, matching the dashboard screen's own
// defaults) so callers that only track odometer math, not money display,
// don't need to thread them through.
export function RentalAllowanceBanner({
  status, onAddExpense, currencyCode = 'BRL', locale = 'pt-BR',
}: {
  status: RentalAllowanceStatus | null;
  onAddExpense: (overageCostCents: number) => void;
  currencyCode?: string;
  locale?: string;
}) {
  const { t } = useTranslation();
  if (!status || !status.isNearLimit) return null;

  if (status.isOverLimit) {
    return (
      <View style={[s.banner, s.over]} testID="rental-allowance-over">
        <Text style={s.text}>
          {t('rental_allowance.over_limit', {
            km: status.overageKm.toFixed(0),
            cost: formatMoney(status.overageCostCents, currencyCode, locale),
          })}
        </Text>
        <TouchableOpacity
          style={s.button}
          onPress={() => onAddExpense(status.overageCostCents)}
          accessibilityRole="button"
          accessibilityLabel={t('rental_allowance.add_expense')}
        >
          <Text style={s.buttonText}>{t('rental_allowance.add_expense')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.banner, s.warning]} testID="rental-allowance-warning">
      <Text style={s.text}>
        {t('rental_allowance.near_limit', { percent: String(Math.round(status.percentUsed * 100)) })}
      </Text>
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
  text: { color: Colors.textPrimary, fontSize: 14, flexShrink: 1 },
  button: { backgroundColor: Colors.accent, borderRadius: Radius.button, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  buttonText: { color: Colors.onAccent, fontSize: 13, fontWeight: '600' },
});
