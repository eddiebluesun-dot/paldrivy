import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../../src/lib/supabase';
import { PRESET_PLATFORMS, saveUserPlatforms } from '../../src/services/platforms';
import { Colors, Radius, Spacing } from '../../src/theme';

export default function PlatformsScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customInput, setCustomInput] = useState('');
  const [customList, setCustomList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function togglePreset(name: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function addCustom() {
    const name = customInput.trim();
    if (!name) return;
    setCustomList(prev => prev.includes(name) ? prev : [...prev, name]);
    setCustomInput('');
  }

  function removeCustom(name: string) {
    setCustomList(prev => prev.filter(n => n !== name));
  }

  async function handleSave() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    setLoading(true); setError('');
    const names = [...Array.from(selected), ...customList];
    try {
      await saveUserPlatforms(data.user.id, names);
      router.push('/onboarding/goal');
    } catch {
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }

  const allNames = [...Array.from(selected), ...customList];

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{t('onboarding.platforms_title')}</Text>
        <Text style={s.subtitle}>{t('onboarding.platforms_subtitle')}</Text>

        {error ? <Text style={s.error}>{error}</Text> : null}

        {/* Preset platforms grid */}
        <View style={s.grid}>
          {PRESET_PLATFORMS.map(name => {
            const active = selected.has(name);
            return (
              <TouchableOpacity
                key={name}
                style={[s.chip, active && s.chipActive]}
                onPress={() => togglePreset(name)}
                activeOpacity={0.7}
              >
                {active && <Ionicons name="checkmark" size={14} color={Colors.accent} style={{ marginRight: 4 }} />}
                <Text style={[s.chipText, active && s.chipTextActive]}>{name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Custom entries */}
        {customList.map(name => (
          <View key={name} style={s.customRow}>
            <Ionicons name="apps-outline" size={14} color={Colors.accent} style={{ marginRight: 6 }} />
            <Text style={s.customName}>{name}</Text>
            <TouchableOpacity onPress={() => removeCustom(name)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ))}

        {/* Add custom */}
        <Text style={s.label}>{t('onboarding.platforms_other')}</Text>
        <View style={s.addRow}>
          <TextInput
            style={s.input}
            value={customInput}
            onChangeText={setCustomInput}
            placeholder={t('onboarding.platforms_add_placeholder')}
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="words"
            onSubmitEditing={addCustom}
            returnKeyType="done"
          />
          <TouchableOpacity style={s.addBtn} onPress={addCustom}>
            <Ionicons name="add" size={20} color={Colors.onAccent} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[s.button, loading && s.buttonDisabled]}
          onPress={handleSave}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={Colors.onAccent} />
            : <Text style={s.buttonText}>
                {allNames.length > 0 ? t('onboarding.next') : t('onboarding.skip')}
              </Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xl },
  title: { fontSize: 26, fontWeight: '700', color: Colors.textPrimary, marginBottom: Spacing.sm },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginBottom: Spacing.xl },
  label: { fontSize: 14, color: Colors.textSecondary, marginTop: Spacing.lg, marginBottom: Spacing.xs },
  error: { color: Colors.error, fontSize: 14, marginBottom: Spacing.md, backgroundColor: Colors.surfaceAlt, padding: Spacing.sm, borderRadius: Radius.input },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: Spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface },
  chipActive: { borderColor: Colors.accent, backgroundColor: Colors.accentDim },
  chipText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: Colors.accent },
  customRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.input, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, marginBottom: Spacing.xs },
  customName: { flex: 1, color: Colors.textPrimary, fontSize: 14 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.input, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 4, fontSize: 15, color: Colors.textPrimary, minHeight: 48 },
  addBtn: { width: 48, height: 48, borderRadius: Radius.input, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  button: { backgroundColor: Colors.accent, borderRadius: Radius.button, alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: Spacing.xl, marginBottom: Spacing.lg },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: Colors.onAccent, fontSize: 16, fontWeight: '600' },
});
