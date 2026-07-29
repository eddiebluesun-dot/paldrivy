import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { buildStatsSnapshotForDate, createPost, type CommunityStatsSnapshot } from '@/src/services/communityPosts';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CreatePostScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<CommunityStatsSnapshot | null>(null);
  const [caption, setCaption] = useState('');
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      setUserId(uid);
      const snap = await buildStatsSnapshotForDate(uid, todayStr());
      setSnapshot(snap);
    });
  }, []);

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  async function handlePublish() {
    if (!userId) return;
    setPublishing(true);
    try {
      await createPost(userId, { dateStr: todayStr(), caption, photoUri });
      router.back();
    } finally {
      setPublishing(false);
    }
  }

  if (!snapshot) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="close" size={24} color={Colors.textPrimary} /></TouchableOpacity>
        <Text style={styles.headerTitle}>{t('community.publish')}</Text>
        <TouchableOpacity onPress={handlePublish} disabled={publishing}>
          {publishing ? <ActivityIndicator color={Colors.accent} /> : <Text style={styles.publishBtn}>{t('community.publish')}</Text>}
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
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
          ) : (
            <>
              <Ionicons name="camera-outline" size={22} color={Colors.textSecondary} />
              <Text style={{ color: Colors.textSecondary }}>Foto (opcional)</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.statsRow}>
          {snapshot.platforms.map((p) => (
            <View key={p.name} style={styles.statBox}>
              <Text style={styles.statLabel}>{p.name}</Text>
              <Text style={styles.statValue}>{(p.gross_cents / 100).toFixed(2)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.previewNote}>
          Ganho do dia: R$ {(snapshot.metrics.earnings_today_cents / 100).toFixed(2)} · {snapshot.metrics.rides_count} corridas
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: 15 },
  publishBtn: { color: Colors.accent, fontWeight: '700' },
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
