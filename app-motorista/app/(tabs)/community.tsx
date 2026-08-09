import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, SafeAreaView, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { getFeed, deletePost, type CommunityPost } from '@/src/services/communityPosts';
import { searchUsers, type CommunityProfile } from '@/src/services/community';
import { getProfile } from '@/src/services/profile';
import { PostCard } from '@/src/components/community/PostCard';

export default function CommunityScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [locale, setLocale] = useState('pt-BR');
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CommunityProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id ?? null;
    setUserId(uid);
    if (!uid) return;
    const profile = await getProfile(uid);
    setLocale(profile?.locale ?? 'pt-BR');
    const feed = await getFeed(uid);
    setPosts(feed);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDeletePost(postId: string) {
    await deletePost(postId);
    await load();
  }

  useEffect(() => {
    if (!userId || query.trim().length < 2) { setResults([]); return; }
    const handle = setTimeout(() => {
      searchUsers(query, userId).then(setResults).catch(() => {});
    }, 300);
    return () => clearTimeout(handle);
  }, [query, userId]);

  if (!userId) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('community.feed_title')}</Text>
        <View style={{ flexDirection: 'row', gap: Spacing.md, alignItems: 'center' }}>
          <TouchableOpacity onPress={() => router.push(`/community/${userId}`)}>
            <Ionicons name="person-circle-outline" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/community/chats')}>
            <Ionicons name="paper-plane-outline" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('community.search_users_placeholder')}
          placeholderTextColor={Colors.textSecondary}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(u) => u.user_id}
          horizontal
          style={{ maxHeight: 90, marginBottom: Spacing.sm }}
          contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: Spacing.md }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.resultItem} onPress={() => router.push(`/community/${item.user_id}`)}>
              <View style={styles.resultAvatar}><Text style={styles.resultInitial}>{item.name.charAt(0).toUpperCase()}</Text></View>
              <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity style={styles.publishRow} onPress={() => router.push('/community/create-post')}>
        <Ionicons name="add-circle" size={20} color={Colors.accent} />
        <Text style={styles.publishText}>{t('community.publish')}</Text>
      </TouchableOpacity>

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: Spacing.md }}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            viewerId={userId}
            viewerLocale={locale}
            onPress={() => router.push(`/community/post/${item.id}`)}
            onAuthorPress={() => router.push(`/community/${item.user_id}`)}
            onEdit={item.user_id === userId ? () => router.push(`/community/edit-post/${item.id}`) : undefined}
            onDelete={item.user_id === userId ? () => handleDeletePost(item.id) : undefined}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.input, margin: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 14 },
  resultItem: { alignItems: 'center', width: 64 },
  resultAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  resultInitial: { color: Colors.onAccent, fontWeight: '700' },
  resultName: { color: Colors.textPrimary, fontSize: 11, marginTop: 4 },
  publishRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.md, marginBottom: Spacing.sm,
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.md,
  },
  publishText: { color: Colors.textPrimary, fontWeight: '600', fontSize: 14 },
});
