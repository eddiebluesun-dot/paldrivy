import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import {
  getCommunityProfile, updateCommunityProfile, type CommunityProfile, type CommentsPermission,
} from '@/src/services/community';
import { uploadCommunityImage } from '@/src/services/communityStorage';

const PERMISSION_OPTIONS: CommentsPermission[] = ['everyone', 'followers', 'nobody'];

export default function EditProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [permission, setPermission] = useState<CommentsPermission>('everyone');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      setUserId(uid);
      const p = await getCommunityProfile(uid);
      setProfile(p);
      setBio(p?.bio ?? '');
      setAvatarUrl(p?.avatar_url ?? null);
      setCoverUrl(p?.cover_url ?? null);
      setPermission(p?.comments_permission ?? 'everyone');
    });
  }, []);

  async function pickImage(kind: 'avatar' | 'cover') {
    if (!userId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled) return;
    const url = await uploadCommunityImage(userId, result.assets[0].uri, kind);
    if (kind === 'avatar') setAvatarUrl(url);
    else setCoverUrl(url);
  }

  async function handleSave() {
    if (!userId) return;
    setSaving(true);
    try {
      await updateCommunityProfile(userId, {
        bio,
        avatar_url: avatarUrl ?? undefined,
        cover_url: coverUrl ?? undefined,
        comments_permission: permission,
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
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
        <Text style={styles.headerTitle}>{t('community.edit_profile')}</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={Colors.accent} /> : <Text style={styles.saveBtn}>{t('community.save')}</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView>
        <TouchableOpacity style={styles.coverWrap} onPress={() => pickImage('cover')} activeOpacity={0.85}>
          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverEmpty]} />
          )}
          <View style={styles.coverEditBadge}>
            <Ionicons name="camera" size={14} color={Colors.textPrimary} />
            <Text style={styles.coverEditText}>{t('community.edit_cover')}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.avatarWrap} onPress={() => pickImage('avatar')} activeOpacity={0.85}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{profile.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.avatarEditBadge}>
            <Ionicons name="camera" size={12} color={Colors.onAccent} />
          </View>
        </TouchableOpacity>

        <View style={{ padding: Spacing.md }}>
          <TextInput
            style={styles.bioInput}
            placeholder={t('community.bio_placeholder')}
            placeholderTextColor={Colors.textSecondary}
            value={bio}
            onChangeText={setBio}
            multiline
          />

          <Text style={styles.sectionLabel}>{t('community.comments_permission_title')}</Text>
          <View style={styles.permissionGroup}>
            {PERMISSION_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.permissionRow, permission === opt && styles.permissionRowActive]}
                onPress={() => setPermission(opt)}
              >
                <Ionicons
                  name={permission === opt ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={permission === opt ? Colors.accent : Colors.textSecondary}
                />
                <Text style={styles.permissionText}>{t(`community.comments_permission_${opt}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: 15 },
  saveBtn: { color: Colors.accent, fontWeight: '700' },
  coverWrap: { position: 'relative' },
  cover: { width: '100%', height: 140 },
  coverEmpty: { backgroundColor: Colors.surfaceAlt },
  coverEditBadge: {
    position: 'absolute', right: Spacing.sm, bottom: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: Radius.button, paddingHorizontal: 10, paddingVertical: 5,
  },
  coverEditText: { color: Colors.textPrimary, fontSize: 11, fontWeight: '600' },
  avatarWrap: { alignSelf: 'center', marginTop: -36 },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: Colors.background },
  avatarFallback: { backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: Colors.onAccent, fontSize: 24, fontWeight: '700' },
  avatarEditBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.background,
  },
  bioInput: {
    color: Colors.textPrimary, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input,
    padding: Spacing.md, minHeight: 70, textAlignVertical: 'top', marginTop: Spacing.md, marginBottom: Spacing.lg,
  },
  sectionLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.sm },
  permissionGroup: { gap: Spacing.xs },
  permissionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.md },
  permissionRowActive: { borderWidth: 1, borderColor: Colors.accent },
  permissionText: { color: Colors.textPrimary, fontSize: 14 },
});
