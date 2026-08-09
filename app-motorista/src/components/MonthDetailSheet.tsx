import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../lib/supabase';
import { Colors, Radius, Spacing } from '../theme';
import { formatMoney } from '../utils/currency';
import type { MonthHistoryItem } from '../services/cockpit';
import { getMonthlyBucketsForMonth, type MonthBucket } from '../services/dashboard';

const MONTH_NAMES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];

type CatIcon =
  | 'car-outline' | 'shield-outline' | 'wifi-outline' | 'location-outline'
  | 'water-outline' | 'restaurant-outline' | 'medical-outline' | 'home-outline'
  | 'build-outline' | 'receipt-outline' | 'ellipsis-horizontal-outline';

const CAT_ICON: Record<string, CatIcon> = {
  fuel:             'water-outline',
  car_wash:         'car-outline',
  maintenance:      'build-outline',
  oil_change:       'build-outline',
  tires:            'build-outline',
  insurance:        'shield-outline',
  internet:         'wifi-outline',
  tracker:          'location-outline',
  tolls:            'location-outline',
  parking:          'location-outline',
  food:             'restaurant-outline',
  health_insurance: 'medical-outline',
  rent:             'home-outline',
  financing:        'home-outline',
  licensing:        'receipt-outline',
  taxi_license:     'receipt-outline',
  taxes:            'receipt-outline',
  other:            'ellipsis-horizontal-outline',
};

const CAT_LABEL: Record<string, string> = {
  fuel:             'Combustível',
  car_wash:         'Lavagem',
  maintenance:      'Manutenção',
  oil_change:       'Troca de óleo',
  tires:            'Pneus',
  insurance:        'Seguro',
  internet:         'Internet',
  tracker:          'Rastreador',
  tolls:            'Pedágios',
  parking:          'Estacionamento',
  food:             'Alimentação',
  health_insurance: 'Plano de saúde',
  rent:             'Aluguel',
  financing:        'Financiamento',
  licensing:        'Licenciamento',
  taxi_license:     'Alvará',
  taxes:            'Impostos',
  other:            'Outros',
};

interface CategoryTotal {
  category: string;
  amount_cents: number;
}

interface MonthDetailSheetProps {
  visible: boolean;
  item: MonthHistoryItem | null;
  userId: string;
  currencyCode: string;
  locale: string;
  onClose: () => void;
  onDayPress?: (dateStr: string) => void;
}

export function MonthDetailSheet({
  visible,
  item,
  userId,
  currencyCode,
  locale,
  onClose,
  onDayPress,
}: MonthDetailSheetProps) {
  const [categories, setCategories] = useState<CategoryTotal[]>([]);
  const [dayBuckets, setDayBuckets] = useState<MonthBucket[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !item || !userId) return;

    const monthStart = new Date(item.year, item.month - 1, 1);
    const monthEnd   = new Date(item.year, item.month, 1);
    const startStr   = `${item.year}-${String(item.month).padStart(2, '0')}-01`;
    const endStr     = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-01`;

    setLoading(true);
    Promise.all([
      supabase
        .from('expenses')
        .select('category, amount_cents')
        .eq('user_id', userId)
        .gte('expense_date', startStr)
        .lt('expense_date', endStr),
      supabase
        .from('fuel_entries')
        .select('total_cost_cents')
        .eq('user_id', userId)
        .gte('filled_at', monthStart.toISOString())
        .lt('filled_at', monthEnd.toISOString()),
      getMonthlyBucketsForMonth(userId, item.year, item.month),
    ]).then(([expRes, fuelRes, buckets]) => {
      const catMap = new Map<string, number>();
      for (const row of (expRes.data ?? []) as Array<{ category: string; amount_cents: number }>) {
        catMap.set(row.category, (catMap.get(row.category) ?? 0) + row.amount_cents);
      }
      const fuelTotal = ((fuelRes.data ?? []) as Array<{ total_cost_cents: number }>)
        .reduce((s, r) => s + r.total_cost_cents, 0);
      if (fuelTotal > 0) {
        catMap.set('fuel', (catMap.get('fuel') ?? 0) + fuelTotal);
      }
      setCategories(
        Array.from(catMap.entries())
          .map(([category, amount_cents]) => ({ category, amount_cents }))
          .sort((a, b) => b.amount_cents - a.amount_cents),
      );
      setDayBuckets(buckets);
    }).finally(() => setLoading(false));
  }, [visible, item, userId]);

  if (!item) return null;

  const totalExp   = item.expenses_cents + item.fuel_cents;
  const net        = item.gross_cents - totalExp;
  const monthName  = MONTH_NAMES[item.month - 1];

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
          <Text style={styles.headerTitle}>{monthName} {item.year}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Summary row */}
        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryAmount, { color: Colors.success }]}>
              {formatMoney(item.gross_cents, currencyCode, locale)}
            </Text>
            <Text style={styles.summaryLabel}>RECEITAS</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryAmount, { color: Colors.error }]}>
              {formatMoney(totalExp, currencyCode, locale)}
            </Text>
            <Text style={styles.summaryLabel}>DESPESAS</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryAmount, { color: net >= 0 ? Colors.accent : Colors.error }]}>
              {formatMoney(net, currencyCode, locale)}
            </Text>
            <Text style={styles.summaryLabel}>LÍQUIDO</Text>
          </View>
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
            {/* Stats pills */}
            {(item.rides > 0 || item.km_meters > 0 || item.liters_ml > 0) && (
              <View style={styles.statsRow}>
                {item.rides > 0 && (
                  <View style={styles.statItem}>
                    <Ionicons name="car-outline" size={14} color={Colors.textSecondary} />
                    <Text style={styles.statValue}>{item.rides}</Text>
                    <Text style={styles.statLabel}>corridas</Text>
                  </View>
                )}
                {item.km_meters > 0 && (
                  <View style={styles.statItem}>
                    <Ionicons name="navigate-outline" size={14} color={Colors.textSecondary} />
                    <Text style={styles.statValue}>{(item.km_meters / 1000).toFixed(0)}</Text>
                    <Text style={styles.statLabel}>km</Text>
                  </View>
                )}
                {item.liters_ml > 0 && (
                  <View style={styles.statItem}>
                    <Ionicons name="water-outline" size={14} color={Colors.textSecondary} />
                    <Text style={styles.statValue}>{(item.liters_ml / 1000).toFixed(1)}</Text>
                    <Text style={styles.statLabel}>litros</Text>
                  </View>
                )}
                {item.km_meters > 0 && item.liters_ml > 0 && (
                  <View style={styles.statItem}>
                    <Ionicons name="speedometer-outline" size={14} color={Colors.textSecondary} />
                    <Text style={styles.statValue}>
                      {((item.km_meters / 1000) / (item.liters_ml / 1000)).toFixed(1)}
                    </Text>
                    <Text style={styles.statLabel}>km/L</Text>
                  </View>
                )}
              </View>
            )}

            {/* Gross/km + Net/km pills */}
            {item.km_meters > 0 && (item.gross_cents > 0 || net > 0) && (
              <View style={{ flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg }}>
                {item.gross_cents > 0 && (
                  <View style={[styles.netKmRow, { flex: 1, marginBottom: 0, borderColor: 'rgba(245,158,11,0.30)' }]}>
                    <Ionicons name="trending-up" size={13} color={Colors.accent} />
                    <Text style={styles.netKmLabel}>Bruto/km</Text>
                    <Text style={[styles.netKmValue, { color: Colors.accent }]}>
                      {formatMoney(Math.round(item.gross_cents / (item.km_meters / 1000)), currencyCode, locale)}/km
                    </Text>
                  </View>
                )}
                {net > 0 && (
                  <View style={[styles.netKmRow, { flex: 1, marginBottom: 0 }]}>
                    <Ionicons name="trending-up" size={13} color={Colors.success} />
                    <Text style={styles.netKmLabel}>Líquido/km</Text>
                    <Text style={styles.netKmValue}>
                      {formatMoney(Math.round(net / (item.km_meters / 1000)), currencyCode, locale)}/km
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Daily bars */}
            {dayBuckets.length > 0 && (() => {
              const maxVal = Math.max(...dayBuckets.map(b => b.net_cents), 1);
              const BAR_H = 48;
              const now = new Date();
              const isCurrentMonth = item.year === now.getFullYear() && item.month === now.getMonth() + 1;
              const todayDay = isCurrentMonth ? now.getDate() : -1;
              return (
                <View style={{ marginBottom: Spacing.lg }}>
                  <Text style={styles.sectionTitle}>DIAS DO MÊS</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                    <View style={{ flexDirection: 'row', gap: 3, paddingHorizontal: 4 }}>
                      {dayBuckets.map(b => {
                        const isToday = b.day === todayDay;
                        const hasData = b.net_cents > 0;
                        const barPct = hasData ? Math.max(b.net_cents / maxVal, 0.07) : 0.04;
                        const barColor = isToday ? Colors.accent : Colors.success;
                        return (
                          <TouchableOpacity
                            key={b.day}
                            onPress={() => {
                              if (onDayPress) {
                                const mm = String(item.month).padStart(2, '0');
                                const dd = String(b.day).padStart(2, '0');
                                onDayPress(`${item.year}-${mm}-${dd}`);
                              }
                            }}
                            activeOpacity={0.7}
                            style={{ alignItems: 'center', width: 18 }}
                          >
                            <View style={{ width: 10, height: BAR_H, justifyContent: 'flex-end' }}>
                              <View style={{
                                width: 10,
                                height: Math.max(BAR_H * barPct, hasData ? 4 : 2),
                                borderRadius: 3,
                                backgroundColor: hasData ? barColor : 'rgba(255,255,255,0.08)',
                                ...(hasData ? Platform.select({
                                  ios: { shadowColor: barColor, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.75, shadowRadius: 4 },
                                  android: { elevation: 2 },
                                }) : {}),
                              }} />
                            </View>
                            <Text style={{ fontSize: 7, color: isToday ? Colors.accent : Colors.textSecondary, fontWeight: isToday ? '700' : '400', marginTop: 3 }}>
                              {b.day}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>
              );
            })()}

            {/* Expenses by category */}
            {categories.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>DESPESAS POR CATEGORIA</Text>
                {categories.map(cat => {
                  const icon  = CAT_ICON[cat.category]  ?? 'ellipsis-horizontal-outline';
                  const label = CAT_LABEL[cat.category] ?? cat.category;
                  const pct   = totalExp > 0 ? (cat.amount_cents / totalExp) * 100 : 0;
                  return (
                    <View key={cat.category} style={styles.catRow}>
                      <View style={[styles.catIcon, { backgroundColor: Colors.errorBg }]}>
                        <Ionicons name={icon} size={14} color={Colors.error} />
                      </View>
                      <View style={styles.catBody}>
                        <View style={styles.catHeader}>
                          <Text style={styles.catLabel}>{label}</Text>
                          <Text style={[styles.catAmount, { color: Colors.error }]}>
                            -{formatMoney(cat.amount_cents, currencyCode, locale)}
                          </Text>
                        </View>
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, { width: `${pct}%` as any }]} />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </>
            )}

            {categories.length === 0 && (
              <Text style={styles.emptyText}>Nenhuma despesa registrada neste mês.</Text>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
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
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  summary: {
    flexDirection: 'row',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  summaryItem:   { flex: 1, alignItems: 'center', gap: 4 },
  summaryDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 4 },
  summaryAmount: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  summaryLabel:  {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  statItem: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm + 2,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: Spacing.sm,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm + 2,
    marginBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  catBody:   { flex: 1 },
  catHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  catLabel:  { color: Colors.textPrimary, fontSize: 13, fontWeight: '600' },
  catAmount: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  barTrack:  { height: 3, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  barFill:   { height: 3, backgroundColor: Colors.error, borderRadius: 2 },
  emptyText: { color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xl, fontSize: 14 },
  netKmRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: Colors.surface, borderRadius: Radius.input,
    padding: Spacing.sm, marginBottom: Spacing.lg,
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)',
  },
  netKmLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  netKmValue: { color: Colors.success, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
