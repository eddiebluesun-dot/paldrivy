import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Platform, SafeAreaView, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { getMessages, sendMessage, subscribeToConversation, type ChatMessage } from '@/src/services/communityChat';

export default function ChatScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    if (!conversationId) return;
    supabase.auth.getUser().then(async ({ data }) => {
      setUserId(data.user?.id ?? null);
      setMessages(await getMessages(conversationId));
    });

    const unsubscribe = subscribeToConversation(conversationId, (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    return unsubscribe;
  }, [conversationId]);

  async function handleSend() {
    if (!conversationId || !userId || !text.trim()) return;
    const body = text.trim();
    setText('');
    await sendMessage(conversationId, userId, { body });
  }

  async function handlePickImage() {
    if (!conversationId || !userId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) await sendMessage(conversationId, userId, { imageUri: result.assets[0].uri });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color={Colors.textPrimary} /></TouchableOpacity>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: Spacing.md }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.sender_id === userId ? styles.bubbleMine : styles.bubbleTheirs]}>
              {item.image_url && <Image source={{ uri: item.image_url }} style={styles.bubbleImage} />}
              {item.body && <Text style={styles.bubbleText}>{item.body}</Text>}
            </View>
          )}
        />

        <View style={styles.inputRow}>
          <TouchableOpacity onPress={handlePickImage}><Ionicons name="image-outline" size={22} color={Colors.textSecondary} /></TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder={t('community.chat_placeholder')}
            placeholderTextColor={Colors.textSecondary}
            value={text}
            onChangeText={setText}
          />
          <TouchableOpacity onPress={handleSend}><Ionicons name="send" size={20} color={Colors.accent} /></TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  bubble: { maxWidth: '75%', borderRadius: Radius.input, padding: Spacing.sm, marginBottom: Spacing.sm },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: Colors.accent },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: Colors.surfaceAlt },
  bubbleText: { color: Colors.textPrimary, fontSize: 14 },
  bubbleImage: { width: 180, height: 180, borderRadius: Radius.input, marginBottom: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border },
  input: { flex: 1, color: Colors.textPrimary, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.button, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
});
