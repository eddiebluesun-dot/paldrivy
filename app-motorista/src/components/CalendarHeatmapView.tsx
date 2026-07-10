import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { Colors, Spacing, Radius } from '../theme';
import { intensityForCents, type HeatmapDay } from '../services/cockpit';

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const GOLD_ALPHA = [0, 0.12, 0.28, 0.50];
const RED_ALPHA  = [0, 0.12, 0.28, 0.50];

function goldBg(level: 0 | 1 | 2 | 3): string {
  if (level === 0) return 'rgba(255,255,255,0.03)';
  return `rgba(245,158,11,${GOLD_ALPHA[level]})`;
}
function redBg(level: 0 | 1 | 2 | 3): string {
  if (level === 0) return 'rgba(255,255,255,0.03)';
  return `rgba(239,68,68,${RED_ALPHA[level]})`;
}

interface CalendarHeatmapViewProps {
  year: number;
  month: number;
  days: HeatmapDay[];
  onDayPress: (day: number) => void;
}

export function CalendarHeatmapView({ year, month, days, onDayPress }: CalendarHeatmapViewProps) {
  const { width } = useWindowDimensions();
  // 7 cells + 6 gaps of Spacing.xs/2 each side + 2×Spacing.md padding
  const cellSize = Math.floor((width - Spacing.md * 2 - Spacing.xs * 7) / 7);

  const dayMap = new Map<number, HeatmapDay>();
  for (const d of days) dayMap.set(d.day, d);

  const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const totalDays = new Date(year, month, 0).getDate();

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const todayDay = isCurrentMonth ? today.getDate() : -1;

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <View>
      {/* Day-of-week headers */}
      <View style={styles.headerRow}>
        {DAY_LABELS.map(l => (
          <Text key={l} style={[styles.dayHeader, { width: cellSize }]}>{l}</Text>
        ))}
      </View>

      {/* Grid */}
      {rows.map((row, ri) => (
        <View key={ri} style={styles.gridRow}>
          {row.map((day, ci) => {
            if (day === null) {
              return (
                <View
                  key={ci}
                  style={{ width: cellSize, height: cellSize, margin: Spacing.xs / 2 }}
                />
              );
            }

            const hd = dayMap.get(day);
            const incLevel = hd ? intensityForCents(hd.income_cents) : 0;
            const expLevel = hd ? intensityForCents(hd.expense_cents) : 0;
            const hasBoth = incLevel > 0 && expLevel > 0;
            const isToday = day === todayDay;

            return (
              <TouchableOpacity
                key={ci}
                style={[
                  styles.cell,
                  { width: cellSize, height: cellSize },
                  !hasBoth && incLevel > 0 && { backgroundColor: goldBg(incLevel) },
                  !hasBoth && expLevel > 0 && { backgroundColor: redBg(expLevel) },
                  hasBoth && { backgroundColor: 'transparent' },
                  isToday && styles.cellToday,
                ]}
                onPress={() => onDayPress(day)}
                activeOpacity={0.7}
              >
                {hasBoth && (
                  <Svg
                    style={StyleSheet.absoluteFill}
                    width={cellSize}
                    height={cellSize}
                  >
                    <Polygon
                      points={`0,0 ${cellSize},0 0,${cellSize}`}
                      fill={`rgba(245,158,11,${GOLD_ALPHA[incLevel]})`}
                    />
                    <Polygon
                      points={`${cellSize},0 ${cellSize},${cellSize} 0,${cellSize}`}
                      fill={`rgba(239,68,68,${RED_ALPHA[expLevel]})`}
                    />
                  </Svg>
                )}
                <Text style={[styles.dayNum, isToday && styles.dayNumToday]}>
                  {day}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    marginBottom: Spacing.xs,
  },
  dayHeader: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    textAlign: 'center',
    marginHorizontal: Spacing.xs / 2,
  },
  gridRow: { flexDirection: 'row' },
  cell: {
    borderRadius: Radius.input / 2,
    margin: Spacing.xs / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  cellToday: {
    borderWidth: 1.5,
    borderColor: 'rgba(245,158,11,0.45)',
  },
  dayNum: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  dayNumToday: {
    color: Colors.accent,
    fontWeight: '800',
  },
});
