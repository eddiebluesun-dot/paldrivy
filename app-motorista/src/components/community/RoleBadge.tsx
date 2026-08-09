import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius } from '../../theme';
import type { CommunityRole } from '../../services/community';

export function RoleBadge({ role }: { role: CommunityRole }) {
  const { t } = useTranslation();
  const isFounder = role === 'founder';
  return (
    <View style={[styles.badge, isFounder ? styles.founder : styles.member]}>
      <Text style={[styles.text, isFounder ? styles.founderText : styles.memberText]}>
        {isFounder ? t('community.role_founder') : t('community.role_member')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: Radius.button, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1 },
  founder: { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: Colors.accent },
  member: { backgroundColor: 'transparent', borderColor: Colors.border },
  text: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  founderText: { color: Colors.accent },
  memberText: { color: Colors.textSecondary },
});
