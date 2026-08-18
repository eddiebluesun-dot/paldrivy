import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors, Spacing } from '../theme';
import { metersToDisplay } from '../utils/units';
import type { KmGapForDay, KmGapCategory } from '../services/kmGaps';

// Presentational row for one detected odometer gap, shown on the day-detail
// sheet under the "Produtividade" block (see app/(tabs)/index.tsx's
// DayDetailModal). Tapping it expands an inline reclassification editor
// (category + free-text note) -- see
// docs/superpowers/specs/2026-08-18-km-gaps-and-cumulative-balance-bar-design.md
// Part C. Purely presentational: the actual Supabase write happens in
// `onSave`, supplied by the caller -- keeps this component unit-testable
// without mocking Supabase.
export function KmGapRow({ gap, distanceUnit, onSave }: {
  gap: KmGapForDay;
  distanceUnit: 'km' | 'mi';
  onSave: (category: KmGapCategory, note: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<KmGapCategory>(gap.category);
  const [note, setNote] = useState(gap.note ?? '');
  const [saving, setSaving] = useState(false);

  const km = metersToDisplay(gap.gap_meters, distanceUnit).toFixed(0);
  const categoryLabel = t(`km_gaps.category_${gap.category}`);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(category, note.trim() || null);
      setExpanded(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={s.wrap}>
      <TouchableOpacity style={s.row} onPress={() => setExpanded(e => !e)} testID="km-gap-row">
        <Ionicons name="alert-circle-outline" size={14} color={Colors.accent} />
        <Text style={s.label}>
          {t('km_gaps.row_label', { category: categoryLabel, km, unit: distanceUnit })}
        </Text>
      </TouchableOpacity>
      {gap.spansMultipleDays && (
        <Text style={s.subNote} testID="km-gap-spans-note">{t('km_gaps.spans_multiple_days')}</Text>
      )}
      {expanded && (
        <View style={s.editor} testID="km-gap-editor">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['personal_use', 'other'] as const).map(c => (
              <TouchableOpacity
                key={c}
                testID={`km-gap-category-${c}`}
                style={[s.pill, category === c && s.pillActive]}
                onPress={() => setCategory(c)}
              >
                <Text style={[s.pillText, category === c && s.pillTextActive]}>
                  {t(`km_gaps.category_${c}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={s.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder={t('km_gaps.note_placeholder')}
            placeholderTextColor={Colors.textSecondary}
            testID="km-gap-note-input"
          />
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
            <TouchableOpacity onPress={() => setExpanded(false)} testID="km-gap-cancel">
              <Text style={s.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} disabled={saving} testID="km-gap-save">
              <Text style={s.saveText}>{t('common.save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  label: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  subNote: { color: Colors.textSecondary, fontSize: 10, fontStyle: 'italic', marginLeft: 20 },
  editor: { marginTop: 6, marginLeft: 20, gap: 8 },
  pill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: Colors.border },
  pillActive: { backgroundColor: Colors.accentDim, borderColor: Colors.accent },
  pillText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  pillTextActive: { color: Colors.accent },
  noteInput: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 8, color: Colors.textPrimary, fontSize: 12 },
  cancelText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  saveText: { color: Colors.accent, fontSize: 12, fontWeight: '700' },
});
