import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';

export function QuickAddSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();

  function go(path: '/fuel' | '/expenses') {
    onClose();
    router.push(path);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <TouchableOpacity style={styles.row} onPress={() => go('/fuel')} activeOpacity={0.8}>
            <View style={[styles.icon, { backgroundColor: Colors.error }]}>
              <Ionicons name="flame" size={16} color="#fff" />
            </View>
            <Text style={styles.label}>{t('tabs.fuel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => go('/expenses')} activeOpacity={0.8}>
            <View style={[styles.icon, { backgroundColor: Colors.success }]}>
              <Ionicons name="wallet" size={16} color="#fff" />
            </View>
            <Text style={styles.label}>{t('tabs.expenses')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.background, borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card,
    borderTopWidth: 1, borderTopColor: Colors.accent, padding: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.sm,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceAlt, padding: Spacing.md, borderRadius: Radius.input,
  },
  icon: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  label: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
});
