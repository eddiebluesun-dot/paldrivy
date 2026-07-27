import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { getActiveLegalDocs, recordConsents, type LegalDoc } from '../../src/services/legal';
import { HtmlView } from '../../src/components/HtmlView';
import { Colors, Radius, Spacing } from '../../src/theme';

export default function ConsentScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [docs, setDocs] = useState<LegalDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getActiveLegalDocs()
      .then(d => {
        setDocs(d);
        const initial: Record<string, boolean> = {};
        d.forEach(doc => { initial[doc.id] = false; });
        setAccepted(initial);
      })
      .catch(() => setError(t('consent.error')))
      .finally(() => setLoadingDocs(false));
  }, []);

  const allAccepted = docs.length > 0 && docs.every(d => accepted[d.id]);

  async function handleAccept() {
    if (!allAccepted) { setError(t('consent.must_accept')); return; }
    setError('');
    setSaving(true);
    try {
      await recordConsents(docs);
      router.replace('/onboarding/locale');
    } catch {
      setError(t('consent.error'));
    } finally {
      setSaving(false);
    }
  }

  function toggleExpand(id: string) {
    setExpanded(p => ({ ...p, [id]: !p[id] }));
  }

  function toggleAccept(id: string) {
    setAccepted(p => ({ ...p, [id]: !p[id] }));
    if (error) setError('');
  }

  if (loadingDocs) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        <View style={s.header}>
          <View style={s.iconWrap}>
            <Ionicons name="shield-checkmark-outline" size={36} color={Colors.accent} />
          </View>
          <Text style={s.title}>{t('consent.title')}</Text>
          <Text style={s.subtitle}>{t('consent.subtitle')}</Text>
        </View>

        {docs.map(doc => (
          <View key={doc.id} style={s.card}>
            <TouchableOpacity
              style={s.cardHeader}
              onPress={() => toggleExpand(doc.id)}
              accessibilityRole="button"
            >
              <Ionicons
                name={doc.type === 'privacy_policy' ? 'lock-closed-outline' : 'document-text-outline'}
                size={18} color={Colors.accent}
              />
              <Text style={s.cardTitle}>{doc.title}</Text>
              <Text style={s.cardVersion}>v{doc.version}</Text>
              <Ionicons
                name={expanded[doc.id] ? 'chevron-up' : 'chevron-down'}
                size={16} color={Colors.textSecondary}
                style={{ marginLeft: 'auto' }}
              />
            </TouchableOpacity>

            {expanded[doc.id] && (
              <View style={s.docContent}>
                <HtmlView html={doc.content} maxHeight={Platform.OS === 'web' ? 260 : 220} />
              </View>
            )}

            <TouchableOpacity
              style={s.checkRow}
              onPress={() => toggleAccept(doc.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accepted[doc.id] }}
            >
              <View style={[s.checkbox, accepted[doc.id] && s.checkboxChecked]}>
                {accepted[doc.id] && <Ionicons name="checkmark" size={14} color={Colors.onAccent} />}
              </View>
              <Text style={s.checkLabel}>
                {doc.type === 'privacy_policy' ? t('consent.accept_privacy') : t('consent.accept_terms')}
              </Text>
            </TouchableOpacity>
          </View>
        ))}

        {error ? (
          <View style={s.errorBanner}>
            <Ionicons name="alert-circle-outline" size={15} color={Colors.error} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[s.cta, (!allAccepted || saving) && s.ctaDisabled]}
          onPress={handleAccept}
          disabled={!allAccepted || saving}
          accessibilityRole="button"
        >
          {saving
            ? <ActivityIndicator color={Colors.onAccent} />
            : <Text style={s.ctaText}>{t('consent.cta')}</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    flexGrow: 1, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xl,
    maxWidth: 520, alignSelf: 'center', width: '100%',
  },

  header: { alignItems: 'center', marginBottom: Spacing.xl },
  iconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.accentDim,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: { fontSize: 24, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: Spacing.xs, textAlign: 'center' },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.card,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: Spacing.md, overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary, flex: 1 },
  cardVersion: {
    fontSize: 11, color: Colors.textSecondary,
    backgroundColor: Colors.surfaceAlt, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  docContent: {
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingTop: Spacing.md,
  },

  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.accentGlow,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    borderColor: Colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  checkLabel: { fontSize: 14, color: Colors.textPrimary, flex: 1 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.errorBg, borderRadius: Radius.input,
    padding: Spacing.sm + 4, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
  },
  errorText: { color: Colors.error, fontSize: 13, flex: 1 },

  cta: {
    backgroundColor: Colors.accent, borderRadius: Radius.button,
    alignItems: 'center', justifyContent: 'center', minHeight: 56,
    marginTop: Spacing.sm,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: Colors.onAccent, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
});
