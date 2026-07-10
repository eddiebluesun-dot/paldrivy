import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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
      <Ionicons name="car-sport-outline" size={15} color={Colors.brandBlue} />
      <Text style={styles.name} numberOfLines={1}>
        {brand} {model} · {year}
      </Text>
      <View style={styles.tags}>
        <Text style={styles.tag}>{FUEL_LABELS[fuelType] ?? fuelType}</Text>
        {kmPerL != null && (
          <Text style={styles.tag}>{kmPerL.toFixed(1)} km/L</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={13} color={Colors.brandBlue} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.brandBlueLight,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.2)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    marginBottom: Spacing.md,
  },
  name: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  tags: {
    flexDirection: 'row',
    gap: 6,
  },
  tag: {
    color: Colors.brandBlue,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(139,92,246,0.12)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
});
