import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Image, SafeAreaView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { getCommunityProfile, isFollowing, followUser, unfollowUser, isBlocked, blockUser, unblockUser, type CommunityProfile } from '@/src/services/community';
import { getUserPosts, deletePost, type CommunityPost } from '@/src/services/communityPosts';
import { getOrCreateConversation } from '@/src/services/communityChat';
import { getProfile } from '@/src/services/profile';
import { PostCard } from '@/src/components/community/PostCard';
import { RoleBadge } from '@/src/components/community/RoleBadge';

export default function UserProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { userId: targetUserId } = useLocalSearchParams<{ userId: string }>();
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerLocale, setViewerLocale] = useState('pt-BR');
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [following, setFollowing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [posts, setPosts] = useState<CommunityPost[]>([]);

  const isOwnProfile = !!viewerId && viewerId === targetUserId;

  async function loadPosts(uid: string) {
    if (!targetUserId) return;
    setPosts(await getUserPosts(uid, targetUserId));
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid || !targetUserId) return;
      setViewerId(uid);
      const [viewerProfile, p, isFollow, isBlock, userPosts] = await Promise.all([
        getProfile(uid),
        getCommunityProfile(targetUserId),
        isFollowing(uid, targetUserId),
        isBlocked(uid, targetUserId),
        getUserPosts(uid, targetUserId),
      ]);
      setViewerLocale(viewerProfile?.locale ?? 'pt-BR');
      setProfile(p);
      setFollowing(isFollow);
      setBlocked(isBlock);
      setPosts(userPosts);
    });
  }, [targetUserId]);

  async function handleDeletePost(postId: string) {
    await deletePost(postId);
    if (viewerId) await loadPosts(viewerId);
  }

  async function handleFollowToggle() {
    if (!viewerId || !targetUserId) return;
    if (following) { await unfollowUser(viewerId, targetUserId); setFollowing(false); }
    else { await followUser(viewerId, targetUserId); setFollowing(true); }
  }

  async function handleMessage() {
    if (!viewerId || !targetUserId) return;
    const conversationId = await getOrCreateConversation(viewerId, targetUserId);
    router.push(`/community/chat/${conversationId}`);
  }

  function handleBlockToggle() {
    if (!viewerId || !targetUserId) return;
    if (blocked) { unblockUser(viewerId, targetUserId).then(() => setBlocked(false)); return; }
    Alert.alert(t('community.confirm_block_title'), t('community.confirm_block_body'), [
      { text: 'Cancelar', style: 'cancel' },
      { text: t('community.block'), style: 'destructive', onPress: () => blockUser(viewerId, targetUserId).then(() => setBlocked(true)) },
    ]);
  }

  if (!profile) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color={Colors.textPrimary} /></TouchableOpacity>
        <Text style={styles.topBarTitle}>{profile.name}</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: Spacing.md }}
        ListHeaderComponent={
          <View style={{ marginBottom: Spacing.md }}>
            {profile.cover_url && <Image source={{ uri: profile.cover_url }} style={styles.cover} />}
            <View style={styles.profileHeader}>
              {profile.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarInitial}>{profile.name.charAt(0).toUpperCase()}</Text></View>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.name}>{profile.name}</Text>
                <RoleBadge role={profile.role} />
              </View>
              <Text style={styles.location}>{[profile.city, profile.state, profile.country].filter(Boolean).join(' · ')}</Text>
              <View style={styles.countsRow}>
                <Text style={styles.count}>{profile.followers_count} {t('community.followers')}</Text>
                <Text style={styles.count}>{profile.following_count} {t('community.following')}</Text>
              </View>
              <View style={styles.actionsRow}>
                {isOwnProfile ? (
                  <TouchableOpacity style={styles.followBtn} onPress={() => router.push('/community/edit-profile')}>
                    <Text style={styles.followBtnText}>{t('community.edit_profile')}</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity style={[styles.followBtn, following && styles.followingBtn]} onPress={handleFollowToggle}>
                      <Text style={styles.followBtnText}>{following ? t('community.unfollow') : t('community.follow')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconBtn} onPress={handleMessage}>
                      <Ionicons name="paper-plane-outline" size={18} color={Colors.textPrimary} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconBtn} onPress={handleBlockToggle}>
                      <Ionicons name={blocked ? 'checkmark-circle-outline' : 'ban-outline'} size={18} color={Colors.error} />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            viewerId={viewerId ?? ''}
            viewerLocale={viewerLocale}
            onPress={() => router.push(`/community/post/${item.id}`)}
            onAuthorPress={() => {}}
            onEdit={isOwnProfile ? () => router.push(`/community/edit-post/${item.id}`) : undefined}
            onDelete={isOwnProfile ? () => handleDeletePost(item.id) : undefined}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  topBarTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: 15 },
  cover: { width: '100%', height: 120, borderRadius: Radius.card, marginBottom: -30 },
  profileHeader: { alignItems: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: Colors.accent },
  avatarFallback: { backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: Colors.onAccent, fontSize: 24, fontWeight: '700' },
  name: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700', marginTop: Spacing.sm },
  location: { color: Colors.textSecondary, fontSize: 12 },
  countsRow: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.sm },
  count: { color: Colors.textSecondary, fontSize: 12 },
  actionsRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  followBtn: { backgroundColor: Colors.success, borderRadius: Radius.button, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  followingBtn: { backgroundColor: Colors.surfaceAlt },
  followBtnText: { color: Colors.textPrimary, fontWeight: '700' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
});
