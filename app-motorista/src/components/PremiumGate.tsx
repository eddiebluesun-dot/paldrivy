import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Radius, Spacing } from '../theme';
import { UpgradeModal, type UpgradeReason } from './UpgradeModal';

interface PremiumGateProps {
  isPremium: boolean;
  reason: UpgradeReason;
  children: React.ReactNode;
}

export function PremiumGate({ isPremium, reason, children }: PremiumGateProps) {
  const { t } = useTranslation();
  const [modalVisible, setModalVisible] = useState(false);

  if (isPremium) return <>{children}</>;

  return (
    <>
      <TouchableOpacity style={styles.lockedCard} onPress={() => setModalVisible(true)} activeOpacity={0.8}>
        <Ionicons name="lock-closed-outline" size={22} color={Colors.accent} />
        <Text style={styles.lockedTitle}>{t(`premium.${reason}_title`)}</Text>
        <Text style={styles.lockedBody}>{t(`premium.${reason}_body`)}</Text>
      </TouchableOpacity>
      <UpgradeModal visible={modalVisible} reason={reason} onClose={() => setModalVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  lockedCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.lg,
    marginBottom: Spacing.md, alignItems: 'center', gap: Spacing.xs,
    borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed',
  },
  lockedTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  lockedBody: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center' },
});
