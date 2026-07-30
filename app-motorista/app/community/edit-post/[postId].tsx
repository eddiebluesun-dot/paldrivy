import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { getPostById, updatePost, type CommunityPost } from '@/src/services/communityPosts';

export default function EditPostScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const [userId, setUserId] = useState<string | null>(null);
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [caption, setCaption] = useState('');
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!postId) return;
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      setUserId(uid);
      const p = await getPostById(uid, postId);
      setPost(p);
      setCaption(p?.caption ?? '');
    });
  }, [postId]);

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  async function handleSave() {
    if (!userId || !postId) return;
    setSaving(true);
    try {
      await updatePost(postId, userId, { caption, photoUri });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  if (!post) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </SafeAreaView>
    );
  }

  const displayedPhoto = photoUri ?? post.photo_url ?? undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="close" size={24} color={Colors.textPrimary} /></TouchableOpacity>
        <Text style={styles.headerTitle}>{t('community.edit_post')}</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={Colors.accent} /> : <Text style={styles.saveBtn}>{t('community.save')}</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.md }}>
        <TextInput
          style={styles.captionInput}
          placeholder={t('community.caption_placeholder')}
          placeholderTextColor={Colors.textSecondary}
          value={caption}
          onChangeText={setCaption}
          multiline
        />

        <TouchableOpacity style={styles.photoPicker} onPress={pickPhoto}>
          {displayedPhoto ? (
            <Image source={{ uri: displayedPhoto }} style={styles.photoPreview} />
          ) : (
            <>
              <Ionicons name="camera-outline" size={22} color={Colors.textSecondary} />
              <Text style={{ color: Colors.textSecondary }}>Foto (opcional)</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.statsRow}>
          {post.stats_snapshot.platforms.map((p) => (
            <View key={p.name} style={styles.statBox}>
              <Text style={styles.statLabel}>{p.name}</Text>
              <Text style={styles.statValue}>{(p.gross_cents / 100).toFixed(2)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.previewNote}>
          Os números do turno não podem ser alterados aqui — só a legenda e a foto.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: 15 },
  saveBtn: { color: Colors.accent, fontWeight: '700' },
  captionInput: {
    color: Colors.textPrimary, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input,
    padding: Spacing.md, minHeight: 80, textAlignVertical: 'top', marginBottom: Spacing.md,
  },
  photoPicker: {
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.lg,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md, minHeight: 100,
  },
  photoPreview: { width: '100%', height: 160, borderRadius: Radius.input },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  statBox: { backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.sm, minWidth: 90 },
  statLabel: { color: Colors.textSecondary, fontSize: 11 },
  statValue: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  previewNote: { color: Colors.textSecondary, fontSize: 12 },
});
