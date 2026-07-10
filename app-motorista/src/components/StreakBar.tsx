import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius } from '../theme';

interface StreakBarProps {
  streak: number;
}

export function StreakBar({ streak }: StreakBarProps) {
  if (streak === 0) return null;
  return (
    <View style={styles.bar}>
      <Text style={styles.fire}>🔥</Text>
      <Text style={styles.text}>
        <Text style={styles.count}>{streak}</Text>
        {' '}
        {streak === 1 ? 'dia registrando dados' : 'dias registrando dados'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.15)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
    alignSelf: 'flex-start',
  },
  fire: { fontSize: 14 },
  count: { color: Colors.accent, fontWeight: '800', fontSize: 14 },
  text: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' },
});
