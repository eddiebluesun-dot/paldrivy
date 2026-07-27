import React, { useState } from 'react';
import {
  Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Radius, Spacing } from '../theme';

export interface SelectItem<T extends string = string> {
  label: string;
  value: T;
}

interface Props<T extends string> {
  value: T;
  items: SelectItem<T>[];
  onValueChange: (value: T) => void;
  placeholder?: string;
  searchable?: boolean;
}

export function Select<T extends string>({ value, items, onValueChange, placeholder, searchable }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = items.find(i => i.value === value);
  const filtered = searchable && search.length > 0
    ? items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
    : items;

  function handleClose() { setSearch(''); setOpen(false); }
  function handleSelect(v: T) { onValueChange(v); handleClose(); }

  return (
    <>
      <TouchableOpacity style={s.trigger} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={[s.triggerText, !selected && s.placeholder]} numberOfLines={1}>
          {selected?.label ?? placeholder ?? value}
        </Text>
        <Ionicons name="chevron-down" size={16} color={Colors.textSecondary} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
        <SafeAreaView style={s.modal} edges={['top', 'bottom']}>
          <View style={s.header}>
            <Text style={s.headerTitle}>{placeholder ?? 'Selecionar'}</Text>
            <TouchableOpacity onPress={handleClose} style={s.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {searchable && (
            <View style={s.searchRow}>
              <Ionicons name="search-outline" size={16} color={Colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                style={s.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar..."
                placeholderTextColor={Colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          )}
          <ScrollView keyboardShouldPersistTaps="handled">
            {filtered.length === 0 && (
              <Text style={s.empty}>Nenhum resultado</Text>
            )}
            {filtered.map((item, idx) => (
              <TouchableOpacity
                key={item.value}
                style={[s.option, idx < filtered.length - 1 && s.optionBorder]}
                activeOpacity={0.7}
                onPress={() => handleSelect(item.value as T)}
              >
                <Text style={[s.optionText, item.value === value && s.optionActive]}>
                  {item.label}
                </Text>
                {item.value === value && <Ionicons name="checkmark" size={18} color={Colors.accent} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.input, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2, marginBottom: Spacing.xs,
  },
  triggerText: { color: Colors.textPrimary, fontSize: 15, flex: 1 },
  placeholder: { color: Colors.textSecondary },
  modal: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  headerTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700' },
  closeBtn: { padding: 4 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    margin: Spacing.sm, paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.input,
    borderWidth: 1, borderColor: Colors.border, height: 44,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 15 },
  option: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, minHeight: 50 },
  optionBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  optionText: { flex: 1, color: Colors.textPrimary, fontSize: 16 },
  optionActive: { color: Colors.accent, fontWeight: '700' },
  empty: { color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xl, fontSize: 14 },
});
