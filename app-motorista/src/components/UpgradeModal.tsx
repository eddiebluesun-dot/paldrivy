import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { Colors, Radius, Spacing } from '../theme';
import { createStripeCheckout } from '../services/stripe';

export type UpgradeReason = 'shifts_limit' | 'history_limit' | 'dashboard_locked';

interface UpgradeModalProps {
  visible: boolean;
  reason: UpgradeReason;
  onClose: () => void;
}

export function UpgradeModal({ visible, reason, onClose }: UpgradeModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    setLoading(true);
    try {
      const { url } = await createStripeCheckout();
      await WebBrowser.openBrowserAsync(url);
    } catch {
      // checkout failures are surfaced by the Stripe-hosted page itself
    } finally {
      setLoading(false);
      onClose();
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t(`premium.${reason}_title`)}</Text>
          <Text style={styles.body}>{t(`premium.${reason}_body`)}</Text>
          <TouchableOpacity style={styles.upgradeBtn} onPress={handleUpgrade} disabled={loading}>
            {loading ? <ActivityIndicator color={Colors.onAccent} /> : (
              <Text style={styles.upgradeBtnText}>{t('premium.upgrade_cta')}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.laterBtn} onPress={onClose} disabled={loading}>
            <Text style={styles.laterBtnText}>{t('premium.maybe_later')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.lg, width: '100%', maxWidth: 360 },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800', marginBottom: Spacing.sm },
  body: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: Spacing.lg },
  upgradeBtn: { backgroundColor: Colors.accent, borderRadius: Radius.card, paddingVertical: Spacing.md, alignItems: 'center', marginBottom: Spacing.sm },
  upgradeBtnText: { color: Colors.onAccent, fontSize: 15, fontWeight: '700' },
  laterBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  laterBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
});
