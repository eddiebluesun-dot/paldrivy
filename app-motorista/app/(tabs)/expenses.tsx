import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Picker } from '@react-native-picker/picker';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { decimalToCents, formatMoney } from '@/src/utils/currency';
import { addExpense, getExpenses } from '@/src/services/expenses';
import { useProfile } from '@/src/hooks/useProfile';
import type { Expense } from '@/src/services/expenses';

// ─── constants ────────────────────────────────────────────────────────────────

const EXPENSE_CATEGORIES = [
  'rent',
  'financing',
  'insurance',
  'internet',
  'tracker',
  'licensing',
  'taxi_license',
  'fuel',
  'car_wash',
  'maintenance',
  'tires',
  'oil_change',
  'tolls',
  'parking',
  'food',
  'other',
] as const;

// ─── helpers ─────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

// ─── add-expense modal ────────────────────────────────────────────────────────

interface AddExpenseModalProps {
  visible: boolean;
  userId: string;
  currencyCode: string;
  locale: string;
  onClose: () => void;
  onSaved: () => void;
}

function AddExpenseModal({
  visible,
  userId,
  currencyCode,
  locale,
  onClose,
  onSaved,
}: AddExpenseModalProps) {
  const { t } = useTranslation();

  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso);
  const [description, setDescription] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setCategory(EXPENSE_CATEGORIES[0]);
    setAmount('');
    setDate(todayIso());
    setDescription('');
    setRecurring(false);
    setError(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSave() {
    setError(null);

    const amountNum = parseFloat(amount);
    if (!amount.trim() || isNaN(amountNum) || amountNum <= 0) {
      setError(t('common.required'));
      return;
    }

    const trimmedDate = date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      setError(t('common.required'));
      return;
    }

    setSaving(true);
    try {
      await addExpense({
        user_id: userId,
        category,
        amount_cents: decimalToCents(amountNum),
        expense_date: trimmedDate,
        description: description.trim() !== '' ? description.trim() : null,
        recurring,
      });

      resetForm();
      onSaved();
    } catch (e) {
      console.error('addExpense failed:', e);
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalWrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.modalTitle}>{t('expense.add')}</Text>

          {/* Category */}
          <Text style={styles.label}>{t('expense.category')}</Text>
          <View style={styles.pickerWrapper}>
            <Picker
              selectedValue={category}
              onValueChange={(val) => setCategory(val)}
              style={styles.picker}
              dropdownIconColor={Colors.textSecondary}
              itemStyle={styles.pickerItem}
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <Picker.Item
                  key={cat}
                  label={t(`expense_category.${cat}`)}
                  value={cat}
                  color={Platform.OS === 'android' ? Colors.textPrimary : undefined}
                />
              ))}
            </Picker>
          </View>

          {/* Amount */}
          <Text style={styles.label}>{t('expense.amount')}</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={Colors.textSecondary}
          />

          {/* Date */}
          <Text style={styles.label}>{t('expense.date')}</Text>
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={setDate}
            placeholder={t('expense.date_placeholder')}
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="none"
          />

          {/* Description */}
          <Text style={styles.label}>{t('expense.description')}</Text>
          <TextInput
            style={styles.input}
            value={description}
            onChangeText={setDescription}
            placeholder={t('expense.description')}
            placeholderTextColor={Colors.textSecondary}
          />

          {/* Recurring toggle */}
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('expense.recurring')}</Text>
            <Switch
              value={recurring}
              onValueChange={setRecurring}
              trackColor={{ true: Colors.brandBlue, false: Colors.border }}
              thumbColor={Colors.onBrand}
            />
          </View>

          {error !== null && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, saving && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={Colors.onBrand} />
            ) : (
              <Text style={styles.primaryButtonText}>{t('expense.save')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── expense list item ────────────────────────────────────────────────────────

interface ExpenseItemProps {
  item: Expense;
  currencyCode: string;
  locale: string;
}

function ExpenseItem({ item, currencyCode, locale }: ExpenseItemProps) {
  const { t } = useTranslation();
  const categoryLabel = t(`expense_category.${item.category}`);
  const amountFormatted = formatMoney(item.amount_cents, currencyCode, locale);
  const date = formatDate(item.expense_date);

  return (
    <View style={styles.entryItem}>
      <View style={styles.entryHeader}>
        <Text style={styles.entryDate}>{date}</Text>
        <Text style={styles.entryAmount}>{amountFormatted}</Text>
      </View>
      <Text style={styles.entryCategory}>{categoryLabel}</Text>
      {item.description !== null && item.description !== '' && (
        <Text style={styles.entryDescription}>{item.description}</Text>
      )}
    </View>
  );
}

// ─── main screen ──────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const { t } = useTranslation();
  const { profile } = useProfile();

  const [userId, setUserId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  const loadEntries = useCallback(async () => {
    if (!userId) return;
    setScreenError(null);
    try {
      const data = await getExpenses(userId, 60);
      setEntries(data);
    } catch (e) {
      console.error('getExpenses failed:', e);
      setScreenError(t('common.error'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, t]);

  useEffect(() => {
    if (userId) {
      loadEntries();
    }
  }, [userId, loadEntries]);

  function handleRefresh() {
    setRefreshing(true);
    loadEntries();
  }

  function handleSaved() {
    setModalVisible(false);
    loadEntries();
  }

  const currencyCode = profile?.currency_code ?? 'BRL';
  const locale = profile?.locale ?? 'pt-BR';

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.brandBlue} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('expense.title')}</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setModalVisible(true)}
          >
            <Text style={styles.addButtonText}>{t('expense.add')}</Text>
          </TouchableOpacity>
        </View>

        {screenError !== null && (
          <Text style={styles.errorText}>{screenError}</Text>
        )}

        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ExpenseItem
              item={item}
              currencyCode={currencyCode}
              locale={locale}
            />
          )}
          style={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.brandBlue}
            />
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>{t('expense.no_entries')}</Text>
          }
        />

        {userId !== null && (
          <AddExpenseModal
            visible={modalVisible}
            userId={userId}
            currencyCode={currencyCode}
            locale={locale}
            onClose={() => setModalVisible(false)}
            onSaved={handleSaved}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.md,
  },
  center: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: 22,
    fontWeight: 'bold',
  },
  addButton: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.button,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  addButtonText: {
    color: Colors.onBrand,
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: Colors.error,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  emptyText: {
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
  entryItem: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  entryDate: {
    color: Colors.textPrimary,
    fontWeight: '600',
    fontSize: 14,
  },
  entryAmount: {
    color: Colors.brandBlue,
    fontWeight: '700',
    fontSize: 14,
  },
  entryCategory: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
  entryDescription: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
    fontStyle: 'italic',
  },
  // Modal styles
  modalWrapper: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalScroll: {
    flex: 1,
  },
  modalContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  modalTitle: {
    color: Colors.textPrimary,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: Spacing.lg,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  pickerWrapper: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xs,
    overflow: 'hidden',
  },
  picker: {
    color: Colors.textPrimary,
  },
  pickerItem: {
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.textPrimary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 15,
    marginBottom: Spacing.xs,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  switchLabel: {
    color: Colors.textPrimary,
    fontSize: 15,
  },
  primaryButton: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.button,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: Colors.onBrand,
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
});
