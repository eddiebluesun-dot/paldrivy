import React, { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, SafeAreaView, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { getPostById, getComments, addComment, deletePost, type CommunityPost, type PostComment } from '@/src/services/communityPosts';
import { hidePost } from '@/src/services/community';
import { getProfile } from '@/src/services/profile';
import { PostCard } from '@/src/components/community/PostCard';

export default function PostDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerLocale, setViewerLocale] = useState('pt-BR');
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentText, setCommentText] = useState('');

  async function loadComments() {
    if (!postId) return;
    setComments(await getComments(postId));
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid || !postId) return;
      setViewerId(uid);
      const [viewerProfile, foundPost] = await Promise.all([getProfile(uid), getPostById(uid, postId)]);
      setViewerLocale(viewerProfile?.locale ?? 'pt-BR');
      setPost(foundPost);
      await loadComments();
    });
  }, [postId]);

  async function handleDeletePost() {
    if (!postId) return;
    await deletePost(postId);
    router.back();
  }

  async function handleSendComment() {
    if (!viewerId || !postId || !commentText.trim()) return;
    await addComment(viewerId, postId, commentText.trim());
    setCommentText('');
    await loadComments();
  }

  function handleReport() {
    if (!viewerId || !postId) return;
    Alert.alert(t('community.confirm_report_title'), t('community.confirm_report_body'), [
      { text: 'Cancelar', style: 'cancel' },
      { text: t('community.report'), style: 'destructive', onPress: () => hidePost(viewerId, postId, 'reported').then(() => router.back()) },
    ]);
  }

  if (!post) return null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color={Colors.textPrimary} /></TouchableOpacity>
          <Text style={styles.topBarTitle}>{t('community.comments_title')}</Text>
          <TouchableOpacity onPress={handleReport}><Ionicons name="flag-outline" size={20} color={Colors.error} /></TouchableOpacity>
        </View>

        <FlatList
          data={comments}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: Spacing.md }}
          ListHeaderComponent={
            <PostCard
              post={post}
              viewerId={viewerId ?? ''}
              viewerLocale={viewerLocale}
              onPress={() => {}}
              onAuthorPress={() => router.push(`/community/${post.user_id}`)}
              onEdit={post.user_id === viewerId ? () => router.push(`/community/edit-post/${post.id}`) : undefined}
              onDelete={post.user_id === viewerId ? handleDeletePost : undefined}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.commentRow}>
              <Text style={styles.commentAuthor}>{item.author_name}</Text>
              <Text style={styles.commentBody}>{item.body}</Text>
            </View>
          )}
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder={t('community.add_comment_placeholder')}
            placeholderTextColor={Colors.textSecondary}
            value={commentText}
            onChangeText={setCommentText}
          />
          <TouchableOpacity onPress={handleSendComment}><Ionicons name="send" size={20} color={Colors.accent} /></TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  topBarTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: 15 },
  commentRow: { backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.sm, marginBottom: Spacing.sm },
  commentAuthor: { color: Colors.textPrimary, fontWeight: '700', fontSize: 12 },
  commentBody: { color: Colors.textPrimary, fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border },
  input: { flex: 1, color: Colors.textPrimary, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.button, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
});
