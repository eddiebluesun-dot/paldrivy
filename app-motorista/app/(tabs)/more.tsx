import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { authSignOut } from '@/src/hooks/useAuth';
import { useProfile } from '@/src/hooks/useProfile';
import { upsertProfile } from '@/src/services/profile';
import { Colors, Radius, Spacing } from '@/src/theme';

// ─── password modal ───────────────────────────────────────────────────────────

interface PasswordModalProps {
  visible: boolean;
  onClose: () => void;
}

function PasswordModal({ visible, onClose }: PasswordModalProps) {
  const { t } = useTranslation();
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  function reset() {
    setNewPw('');
    setConfirmPw('');
    setError('');
    setSuccess(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSave() {
    setError('');
    if (newPw.length < 6) { setError(t('more.password_min')); return; }
    if (newPw !== confirmPw) { setError(t('more.passwords_mismatch')); return; }
    setSaving(true);
    const { error: err } = await supabase.auth.updateUser({ password: newPw });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSuccess(true);
    setTimeout(() => { handleClose(); }, 1500);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalFlex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.modalTitle}>{t('more.change_password')}</Text>

          {success ? (
            <View style={styles.successBanner}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              <Text style={styles.successText}>{t('more.password_changed')}</Text>
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.fieldLabel}>{t('more.new_password')}</Text>
          <TextInput
            style={styles.fieldInput}
            value={newPw}
            onChangeText={setNewPw}
            secureTextEntry
            textContentType="newPassword"
            placeholderTextColor={Colors.textSecondary}
            placeholder="••••••••"
          />

          <Text style={styles.fieldLabel}>{t('more.confirm_password')}</Text>
          <TextInput
            style={styles.fieldInput}
            value={confirmPw}
            onChangeText={setConfirmPw}
            secureTextEntry
            textContentType="newPassword"
            placeholderTextColor={Colors.textSecondary}
            placeholder="••••••••"
          />

          <TouchableOpacity
            style={[styles.saveButton, saving && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color={Colors.onBrand} />
              : <Text style={styles.saveButtonText}>{t('more.change_password')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── setting row ─────────────────────────────────────────────────────────────

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.6}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={styles.rowValue}>{value}</Text>
        <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
      </View>
    </TouchableOpacity>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────

export default function MoreScreen() {
  const { t, i18n } = useTranslation();
  const { profile } = useProfile();

  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [pwModalVisible, setPwModalVisible] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setUserId(data.user?.id ?? null);
      setName(data.user?.user_metadata?.name ?? profile?.name ?? '');
      setPhone(data.user?.user_metadata?.phone ?? '');
    });
  }, [profile]);

  async function handleSaveProfile() {
    if (!userId) return;
    setProfileSaving(true);
    setProfileSaved(false);
    try {
      await Promise.all([
        upsertProfile({ id: userId, name: name.trim() || undefined }),
        supabase.auth.updateUser({ data: { name: name.trim(), phone: phone.trim() } }),
      ]);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch (e) {
      console.error('profile save failed:', e);
    } finally {
      setProfileSaving(false);
    }
  }

  const initials = (name || email || '?').charAt(0).toUpperCase();
  const profileChanged =
    name !== (profile?.name ?? '') || phone !== '';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.screenTitle}>{t('more.title')}</Text>

        {/* Avatar + Profile */}
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.avatarInfo}>
            <Text style={styles.avatarName}>{name || '—'}</Text>
            <Text style={styles.avatarEmail}>{email ?? '—'}</Text>
          </View>
        </View>

        {/* Profile fields */}
        <Text style={styles.sectionHeader}>{t('more.profile')}</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>{t('more.name')}</Text>
          <TextInput
            style={styles.fieldInput}
            value={name}
            onChangeText={setName}
            placeholder="Seu nome completo"
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="words"
          />

          <View style={styles.cardDivider} />

          <Text style={styles.fieldLabel}>{t('more.phone')}</Text>
          <TextInput
            style={styles.fieldInput}
            value={phone}
            onChangeText={setPhone}
            placeholder="(11) 99999-9999"
            placeholderTextColor={Colors.textSecondary}
            keyboardType="phone-pad"
          />

          <View style={styles.cardDivider} />

          <Text style={styles.fieldLabel}>{t('more.email_label')}</Text>
          <View style={styles.readonlyField}>
            <Text style={styles.readonlyText}>{email ?? '—'}</Text>
          </View>
        </View>

        {profileSaved ? (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.successText}>{t('more.profile_saved')}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.saveButton, profileSaving && styles.buttonDisabled]}
          onPress={handleSaveProfile}
          disabled={profileSaving}
        >
          {profileSaving
            ? <ActivityIndicator color={Colors.onBrand} />
            : <Text style={styles.saveButtonText}>{t('more.save_profile')}</Text>}
        </TouchableOpacity>

        {/* Security */}
        <Text style={styles.sectionHeader}>{t('more.security')}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.6}
            onPress={() => setPwModalVisible(true)}
          >
            <View style={styles.rowIconLabel}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.brandBlue} style={styles.rowIcon} />
              <Text style={styles.rowLabel}>{t('more.change_password')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Settings */}
        <Text style={styles.sectionHeader}>{t('more.settings')}</Text>
        <View style={styles.card}>
          <SettingRow label={t('more.language')} value={i18n.language.toUpperCase()} />
          <View style={styles.divider} />
          <SettingRow label={t('more.currency')} value={profile?.currency_code ?? '—'} />
          <View style={styles.divider} />
          <SettingRow label={t('more.distance_unit')} value={profile?.distance_unit ?? '—'} />
          <View style={styles.divider} />
          <SettingRow label={t('more.volume_unit')} value={profile?.volume_unit ?? '—'} />
        </View>

        {/* Sign out */}
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={() => authSignOut().catch(console.warn)}
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={18} color={Colors.error} style={{ marginRight: 6 }} />
          <Text style={styles.signOutText}>{t('more.sign_out')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <PasswordModal
        visible={pwModalVisible}
        onClose={() => setPwModalVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },

  screenTitle: {
    color: Colors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    marginBottom: Spacing.lg,
    letterSpacing: -0.5,
  },

  // Avatar block
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.brandBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  avatarText: { color: Colors.onBrand, fontSize: 22, fontWeight: '700' },
  avatarInfo: { flex: 1 },
  avatarName: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700' },
  avatarEmail: { color: Colors.textSecondary, fontSize: 13, marginTop: 2 },

  // Section headers
  sectionHeader: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: Spacing.sm,
    marginTop: Spacing.xs,
  },

  // Card
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  cardDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: Spacing.md },

  // Fields inside card
  fieldLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: 4,
  },
  fieldInput: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    fontSize: 15,
    color: Colors.textPrimary,
    minHeight: 40,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: 4,
  },
  readonlyField: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    paddingVertical: 4,
  },
  readonlyText: { color: Colors.textSecondary, fontSize: 15 },

  // Feedback banners
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.successBg,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    gap: 6,
  },
  successText: { color: Colors.success, fontSize: 14, fontWeight: '500' },
  errorBanner: {
    backgroundColor: Colors.errorBg,
    borderRadius: Radius.input,
    padding: Spacing.sm + 4,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorBannerText: { color: Colors.error, fontSize: 14 },

  // Save profile button
  saveButton: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginBottom: Spacing.lg,
  },
  saveButtonText: { color: Colors.onBrand, fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },

  // Setting rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  rowIconLabel: { flexDirection: 'row', alignItems: 'center' },
  rowIcon: { marginRight: Spacing.sm },
  rowLabel: { color: Colors.textPrimary, fontSize: 15 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowValue: { color: Colors.textSecondary, fontSize: 14 },
  divider: { height: 1, backgroundColor: Colors.border, marginHorizontal: Spacing.md },

  // Sign out
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.button,
    borderWidth: 1.5,
    borderColor: '#FECACA',
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  signOutText: { color: Colors.error, fontSize: 15, fontWeight: '600' },

  // Password modal
  modalFlex: { flex: 1, backgroundColor: Colors.background },
  modalScroll: { flex: 1 },
  modalContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  modalTitle: {
    color: Colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: Spacing.lg,
  },
  cancelButton: { paddingVertical: Spacing.md, alignItems: 'center' },
  cancelButtonText: { color: Colors.textSecondary, fontSize: 15 },
});
