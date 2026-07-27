import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { Colors, Radius, Spacing } from '../theme';
import { formatMoney } from '../utils/currency';

interface DayShift {
  id: string;
  started_at: string;
  ended_at: string | null;
  gross_cents: number | null;
  platform: string | null;
}
interface DayExpense {
  id: string;
  category: string;
  amount_cents: number;
  description: string | null;
}
interface DayFuel {
  id: string;
  filled_at: string;
  total_cost_cents: number;
  fuel_type: string | null;
}

const CATEGORY_ICONS: Record<string, 'car-outline' | 'shield-outline' | 'wifi-outline' | 'location-outline' | 'water-outline' | 'restaurant-outline' | 'medical-outline' | 'ellipsis-horizontal-outline' | 'home-outline' | 'build-outline' | 'cart-outline' | 'receipt-outline'> = {
  fuel:           'water-outline',
  car_wash:       'car-outline',
  maintenance:    'build-outline',
  oil_change:     'build-outline',
  tires:          'build-outline',
  insurance:      'shield-outline',
  internet:       'wifi-outline',
  tracker:        'location-outline',
  tolls:          'location-outline',
  parking:        'location-outline',
  food:           'restaurant-outline',
  health_insurance: 'medical-outline',
  rent:           'home-outline',
  financing:      'home-outline',
  licensing:      'receipt-outline',
  taxi_license:   'receipt-outline',
  taxes:          'receipt-outline',
  other:          'ellipsis-horizontal-outline',
};

function secondsToHHMM(start: string, end: string | null): string {
  if (!end) return '--';
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

interface ExpenseDaySheetProps {
  visible: boolean;
  day: number;
  month: number;
  year: number;
  userId: string;
  currencyCode: string;
  locale: string;
  onClose: () => void;
  onAddExpense: () => void;
}

export function ExpenseDaySheet({
  visible,
  day,
  month,
  year,
  userId,
  currencyCode,
  locale,
  onClose,
  onAddExpense,
}: ExpenseDaySheetProps) {
  const { t } = useTranslation();
  const [shifts, setShifts] = useState<DayShift[]>([]);
  const [expenses, setExpenses] = useState<DayExpense[]>([]);
  const [fuels, setFuels] = useState<DayFuel[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !userId) return;

    const dayStart = new Date(year, month - 1, day, 0, 0, 0);
    const dayEnd   = new Date(year, month - 1, day + 1, 0, 0, 0);
    const dateStr  = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const nextDateStr = (() => {
      const d = new Date(year, month - 1, day + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    setLoading(true);
    Promise.all([
      supabase
        .from('shifts')
        .select('id, started_at, ended_at, gross_cents, platform')
        .eq('user_id', userId)
        .gte('started_at', dayStart.toISOString())
        .lt('started_at', dayEnd.toISOString())
        .order('started_at'),
      supabase
        .from('expenses')
        .select('id, category, amount_cents, description')
        .eq('user_id', userId)
        .gte('expense_date', dateStr)
        .lt('expense_date', nextDateStr)
        .order('amount_cents', { ascending: false }),
      supabase
        .from('fuel_entries')
        .select('id, filled_at, total_cost_cents, fuel_type')
        .eq('user_id', userId)
        .gte('filled_at', dayStart.toISOString())
        .lt('filled_at', dayEnd.toISOString())
        .order('filled_at'),
    ]).then(([shiftsRes, expRes, fuelRes]) => {
      setShifts((shiftsRes.data ?? []) as DayShift[]);
      setExpenses((expRes.data ?? []) as DayExpense[]);
      setFuels((fuelRes.data ?? []) as DayFuel[]);
    }).finally(() => setLoading(false));
  }, [visible, userId, day, month, year]);

  const fuelAsExpenses: DayExpense[] = fuels.map(f => ({
    id: f.id,
    category: 'fuel',
    amount_cents: f.total_cost_cents,
    description: f.fuel_type ?? null,
  }));
  const allExpenses = [...expenses, ...fuelAsExpenses].sort((a, b) => b.amount_cents - a.amount_cents);

  const totalIncome   = shifts.reduce((s, r) => s + (r.gross_cents ?? 0), 0);
  const totalExpenses = allExpenses.reduce((s, r) => s + r.amount_cents, 0);
  const saldo         = totalIncome - totalExpenses;

  const dateLabel = new Date(year, month - 1, day).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerDate}>{dateLabel}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Saldo pill */}
            <View style={[styles.saldoPill, { borderColor: saldo >= 0 ? Colors.success : Colors.error }]}>
              <Text style={styles.saldoLabel}>Saldo do dia</Text>
              <Text style={[styles.saldoValue, { color: saldo >= 0 ? Colors.success : Colors.error }]}>
                {formatMoney(saldo, currencyCode, locale)}
              </Text>
            </View>

            {/* Shifts section */}
            {shifts.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>CORRIDAS</Text>
                {shifts.map(shift => (
                  <View key={shift.id} style={styles.row}>
                    <View style={[styles.rowIcon, { backgroundColor: Colors.successBg }]}>
                      <Ionicons name="car-outline" size={14} color={Colors.success} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowLabel}>
                        {shift.platform ?? 'Corrida'} · {secondsToHHMM(shift.started_at, shift.ended_at)}
                      </Text>
                      <Text style={styles.rowTime}>
                        {new Date(shift.started_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                        {shift.ended_at
                          ? ' – ' + new Date(shift.ended_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
                          : ''}
                      </Text>
                    </View>
                    <Text style={[styles.rowAmount, { color: Colors.success }]}>
                      {formatMoney(shift.gross_cents ?? 0, currencyCode, locale)}
                    </Text>
                  </View>
                ))}
                <View style={styles.subtotalRow}>
                  <Text style={styles.subtotalLabel}>Total corridas</Text>
                  <Text style={[styles.subtotalAmount, { color: Colors.success }]}>
                    {formatMoney(totalIncome, currencyCode, locale)}
                  </Text>
                </View>
              </View>
            )}

            {/* Expenses section */}
            {allExpenses.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>DESPESAS</Text>
                {allExpenses.map(exp => {
                  const iconName = CATEGORY_ICONS[exp.category] ?? 'ellipsis-horizontal-outline';
                  return (
                    <View key={exp.id} style={styles.row}>
                      <View style={[styles.rowIcon, { backgroundColor: Colors.errorBg }]}>
                        <Ionicons name={iconName} size={14} color={Colors.error} />
                      </View>
                      <View style={styles.rowBody}>
                        <Text style={styles.rowLabel}>
                          {t(`expense_category.${exp.category}`)}
                        </Text>
                        {exp.description != null && exp.description !== '' && (
                          <Text style={styles.rowTime}>{exp.description}</Text>
                        )}
                      </View>
                      <Text style={[styles.rowAmount, { color: Colors.error }]}>
                        –{formatMoney(exp.amount_cents, currencyCode, locale)}
                      </Text>
                    </View>
                  );
                })}
                <View style={styles.subtotalRow}>
                  <Text style={styles.subtotalLabel}>Total despesas</Text>
                  <Text style={[styles.subtotalAmount, { color: Colors.error }]}>
                    {formatMoney(totalExpenses, currencyCode, locale)}
                  </Text>
                </View>
              </View>
            )}

            {shifts.length === 0 && allExpenses.length === 0 && (
              <Text style={styles.emptyText}>Nenhum registro neste dia.</Text>
            )}
          </ScrollView>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.addBtn} onPress={onAddExpense}>
            <Ionicons name="add" size={18} color={Colors.onBrand} />
            <Text style={styles.addBtnText}>{t('expense.add')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerDate: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    textTransform: 'capitalize',
    flex: 1,
    marginRight: Spacing.sm,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  saldoPill: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: Radius.input,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    marginBottom: Spacing.lg,
    backgroundColor: Colors.surface,
  },
  saldoLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  saldoValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  section: { marginBottom: Spacing.lg },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm + 2,
    marginBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  rowBody: { flex: 1, marginRight: Spacing.xs },
  rowLabel: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600' },
  rowTime: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
    paddingTop: Spacing.xs,
    marginTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  subtotalLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  subtotalAmount: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  emptyText: {
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xl,
    fontSize: 14,
  },
  footer: {
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  addBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  addBtnText: {
    color: Colors.onBrand,
    fontSize: 15,
    fontWeight: '700',
  },
});
