import React from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Radius, Spacing } from '../theme';
import { formatMoney } from '../utils/currency';
import type { MonthHistoryItem } from '../services/cockpit';

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function netForItem(item: MonthHistoryItem): number {
  return item.gross_cents - item.expenses_cents - item.fuel_cents;
}

interface MonthHistoryCardProps {
  items: MonthHistoryItem[];
  currencyCode: string;
  locale: string;
  onMonthPress?: (item: MonthHistoryItem) => void;
}

export function MonthHistoryCard({ items, currencyCode, locale, onMonthPress }: MonthHistoryCardProps) {
  if (items.length === 0) return null;

  const now = new Date();
  const bestGross = Math.max(...items.map(i => i.gross_cents));

  return (
    <View style={styles.card}>
      <Text style={styles.title}>HISTÓRICO MENSAL</Text>
      <FlatList
        data={items}
        keyExtractor={item => `${item.year}-${item.month}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: Spacing.sm, paddingRight: Spacing.sm }}
        renderItem={({ item }) => {
          const net = netForItem(item);
          const isCurrentMonth =
            item.year === now.getFullYear() && item.month === now.getMonth() + 1;
          const isBest = item.gross_cents === bestGross && item.gross_cents > 0;
          const netColor = net >= 0 ? Colors.success : Colors.error;

          return (
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => onMonthPress?.(item)}
              disabled={!onMonthPress}
            >
            <View style={[styles.monthCard, isCurrentMonth && styles.monthCardCurrent]}>
              {isCurrentMonth && (
                <View style={styles.badgeCurrent}>
                  <Text style={styles.badgeText}>atual</Text>
                </View>
              )}
              {isBest && !isCurrentMonth && (
                <View style={styles.badgeBest}>
                  <Text style={styles.badgeText}>⭐ melhor</Text>
                </View>
              )}

              <Text style={styles.monthLabel}>
                {MONTH_NAMES[item.month - 1]} {item.year}
              </Text>

              <Text style={styles.gross}>
                {formatMoney(item.gross_cents, currencyCode, locale)}
              </Text>
              <Text style={styles.subLabel}>bruto</Text>

              <Text style={[styles.net, { color: netColor }]}>
                {formatMoney(net, currencyCode, locale)}
              </Text>
              <Text style={styles.subLabel}>líquido</Text>

              <View style={styles.pills}>
                {item.rides > 0 && (
                  <Text style={styles.pill}>🚗 {item.rides}</Text>
                )}
                {item.km_meters > 0 && (
                  <Text style={styles.pill}>{(item.km_meters / 1000).toFixed(0)} km</Text>
                )}
              </View>

              {item.gross_cents > 0 && (
                <View style={styles.expenseBarTrack}>
                  <View
                    style={[
                      styles.expenseBarFill,
                      {
                        width: `${Math.min(
                          ((item.expenses_cents + item.fuel_cents) / item.gross_cents) * 100,
                          100,
                        )}%` as any,
                      },
                    ]}
                  />
                </View>
              )}
            </View>
            </TouchableOpacity>
          );
        }}
      />
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
  title: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: Spacing.sm,
  },
  monthCard: {
    width: 130,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.card,
    padding: Spacing.sm + 2,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  monthCardCurrent: {
    borderColor: Colors.accent,
    borderWidth: 1.5,
  },
  badgeCurrent: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: Colors.accentDim,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  badgeBest: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: 'rgba(245,158,11,0.15)',
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6,
  },
  badgeText: { color: Colors.accent, fontSize: 9, fontWeight: '700' },
  monthLabel: {
    color: Colors.textSecondary, fontSize: 10, fontWeight: '700',
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  gross: {
    color: Colors.accent, fontSize: 15, fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  net: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  subLabel: { color: Colors.textSecondary, fontSize: 9, marginBottom: 6 },
  pills: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginBottom: 6, marginTop: 2 },
  pill: {
    color: Colors.textSecondary, fontSize: 9, fontWeight: '600',
    backgroundColor: Colors.surface, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5,
  },
  expenseBarTrack: { height: 3, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  expenseBarFill: { height: 3, backgroundColor: Colors.error, borderRadius: 2 },
});
