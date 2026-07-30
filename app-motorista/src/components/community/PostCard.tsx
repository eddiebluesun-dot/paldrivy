import React, { useEffect, useState } from 'react';
import { Alert, Image, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../../theme';
import { toggleLike, recordView, getTranslatedCaption, type CommunityPost } from '../../services/communityPosts';
import { pickTranslationTargetLang } from '../../utils/communityTranslation';

export function PostCard({
  post, viewerId, viewerLocale, onPress, onAuthorPress, onEdit, onDelete,
}: {
  post: CommunityPost;
  viewerId: string;
  viewerLocale: string;
  onPress: () => void;
  onAuthorPress: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const isOwnPost = post.user_id === viewerId;

  function handleOpenPostMenu() {
    Alert.alert(post.author.name, undefined, [
      { text: t('community.edit_post'), onPress: onEdit },
      { text: t('community.delete_post'), style: 'destructive', onPress: confirmDelete },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  function confirmDelete() {
    Alert.alert(t('community.confirm_delete_post_title'), t('community.confirm_delete_post_body'), [
      { text: 'Cancelar', style: 'cancel' },
      { text: t('community.delete_post'), style: 'destructive', onPress: onDelete },
    ]);
  }

  const [liked, setLiked] = useState(post.liked_by_me);
  const [likeCount, setLikeCount] = useState(post.likes_count);
  const [translated, setTranslated] = useState<string | null>(null);
  const [showingTranslation, setShowingTranslation] = useState(false);

  const targetLang = pickTranslationTargetLang(post.author.locale, viewerLocale);

  useEffect(() => {
    recordView(viewerId, post.id).catch(() => {});
  }, [post.id, viewerId]);

  async function handleLike() {
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    try {
      await toggleLike(viewerId, post.id, next);
    } catch {
      setLiked(!next);
      setLikeCount((c) => c + (next ? -1 : 1));
    }
  }

  async function handleToggleTranslation() {
    if (!targetLang) return;
    if (!showingTranslation && translated === null) {
      const text = await getTranslatedCaption(post.id, targetLang);
      setTranslated(text);
    }
    setShowingTranslation((v) => !v);
  }

  const { platforms, metrics } = post.stats_snapshot;
  const displayedCaption = showingTranslation && translated !== null ? translated : post.caption;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.header} onPress={onAuthorPress} activeOpacity={0.8}>
          {post.author.avatar_url ? (
            <Image source={{ uri: post.author.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{post.author.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.authorName}>{post.author.name}</Text>
            <Text style={styles.authorLocation}>
              {[post.author.city, post.author.state, post.author.country].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </TouchableOpacity>

        {isOwnPost && (onEdit || onDelete) && (
          <TouchableOpacity onPress={handleOpenPostMenu} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
        {!!displayedCaption && <Text style={styles.caption}>{displayedCaption}</Text>}
        {!!targetLang && (
          <TouchableOpacity onPress={handleToggleTranslation}>
            <Text style={styles.translateLink}>
              {showingTranslation ? t('community.see_original') : t('community.see_translation')}
            </Text>
          </TouchableOpacity>
        )}

        {post.photo_url && <Image source={{ uri: post.photo_url }} style={styles.photo} />}

        <View style={styles.statsRow}>
          {platforms.map((p) => (
            <View key={p.name} style={styles.statBox}>
              <Text style={styles.statLabel}>{p.name}</Text>
              <Text style={styles.statValue}>{(p.gross_cents / 100).toFixed(2)}</Text>
              <Text style={styles.statPct}>{p.pct.toFixed(2)}%</Text>
            </View>
          ))}
        </View>

        <View style={styles.metricsGrid}>
          <Metric label="R$/h" value={(metrics.avg_per_hour_cents / 100).toFixed(2)} />
          <Metric label="R$/km" value={(metrics.avg_per_km_cents / 100).toFixed(2)} />
          <Metric label="Corridas" value={String(metrics.rides_count)} />
        </View>
      </TouchableOpacity>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.action} onPress={handleLike}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? Colors.error : Colors.textSecondary} />
          <Text style={styles.actionText}>{likeCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={onPress}>
          <Ionicons name="chatbubble-outline" size={18} color={Colors.textSecondary} />
          <Text style={styles.actionText}>{post.comments_count}</Text>
        </TouchableOpacity>
        <View style={styles.action}>
          <Ionicons name="eye-outline" size={18} color={Colors.textSecondary} />
          <Text style={styles.actionText}>{post.views_count}</Text>
        </View>
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  header: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: Colors.onAccent, fontWeight: '700' },
  authorName: { color: Colors.textPrimary, fontWeight: '700', fontSize: 14 },
  authorLocation: { color: Colors.textSecondary, fontSize: 11 },
  caption: { color: Colors.textPrimary, fontSize: 14, marginBottom: Spacing.xs },
  translateLink: { color: Colors.brandBlue, fontSize: 12, marginBottom: Spacing.sm },
  photo: { width: '100%', height: 200, borderRadius: Radius.input, marginBottom: Spacing.sm },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  statBox: { backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.sm, minWidth: 90 },
  metricsGrid: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  metricBox: { flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.sm, alignItems: 'center' },
  statLabel: { color: Colors.textSecondary, fontSize: 11 },
  statValue: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  statPct: { color: Colors.success, fontSize: 11 },
  actionsRow: { flexDirection: 'row', gap: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { color: Colors.textSecondary, fontSize: 12 },
});
