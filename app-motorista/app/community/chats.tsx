import React, { useEffect, useState } from 'react';
import { FlatList, Image, SafeAreaView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Spacing } from '@/src/theme';
import { getConversations, type ChatConversation } from '@/src/services/communityChat';

export default function ChatsListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      setConversations(await getConversations(uid));
    });
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color={Colors.textPrimary} /></TouchableOpacity>
        <Text style={styles.topBarTitle}>{t('community.chat_title')}</Text>
        <View style={{ width: 24 }} />
      </View>
      <FlatList
        data={conversations}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: Spacing.md }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => router.push(`/community/chat/${item.id}`)}>
            {item.other_avatar_url ? (
              <Image source={{ uri: item.other_avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarInitial}>{item.other_name.charAt(0).toUpperCase()}</Text></View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.other_name}</Text>
              <Text style={styles.lastMessage} numberOfLines={1}>{item.last_message ?? ''}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  topBarTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: Colors.onAccent, fontWeight: '700' },
  name: { color: Colors.textPrimary, fontWeight: '700', fontSize: 14 },
  lastMessage: { color: Colors.textSecondary, fontSize: 12 },
});
