import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing } from '../theme';

const FUEL_LABELS: Record<string, string> = {
  gasoline: 'Gasolina', ethanol: 'Etanol', diesel: 'Diesel',
  gnv: 'GNV', electric: 'Elétrico', hybrid: 'Híbrido',
};

interface VehiclePillProps {
  brand: string;
  model: string;
  year: number;
  fuelType: string;
  kmPerL: number | null;
}

export function VehiclePill({ brand, model, year, fuelType, kmPerL }: VehiclePillProps) {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={styles.pill}
      onPress={() => router.push('/(tabs)/more')}
      activeOpacity={0.75}
    >
      <Ionicons name="search-outline" size={14} color={Colors.brandBlue} />
      <Text style={styles.name} numberOfLines={1}>
        {brand} {model} · {year}
      </Text>
      <View style={styles.divider} />
      <Text style={styles.tag}>{FUEL_LABELS[fuelType] ?? fuelType}</Text>
      {kmPerL != null && (
        <>
          <View style={styles.divider} />
          <Text style={styles.tag}>{kmPerL.toFixed(1)} km/L</Text>
        </>
      )}
      <View style={styles.flameBtn}>
        <Ionicons name="flame" size={15} color={Colors.accent} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(139,92,246,0.08)',
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: 'rgba(139,92,246,0.40)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    marginBottom: Spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: Colors.brandBlue,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.45,
        shadowRadius: 10,
      },
      android: { elevation: 4 },
    }),
  },
  name: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  divider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(139,92,246,0.30)',
  },
  tag: {
    color: Colors.brandBlue,
    fontSize: 12,
    fontWeight: '700',
  },
  flameBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
