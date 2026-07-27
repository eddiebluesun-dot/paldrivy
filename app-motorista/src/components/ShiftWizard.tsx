import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { Colors, Radius, Spacing } from '../theme';
import { decimalToCents } from '../utils/currency';
import { displayToMeters } from '../utils/units';
import { getUserPlatforms } from '../services/platforms';
import { createManualShift, FreeLimitError } from '../services/shifts';
import type { EndShiftData, MoodRating } from '../types';

// ─── helpers ────────────────────────────────────────────────────────────────

function parse(s: string): number {
  return parseFloat(s.replace(',', '.')) || 0;
}

function todayDMY(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dmyHhmToIso(date: string, time: string): string | null {
  const dm = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const tm = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const d = new Date(
    parseInt(dm[3]), parseInt(dm[2]) - 1, parseInt(dm[1]),
    parseInt(tm[1]), parseInt(tm[2]),
  );
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── types ───────────────────────────────────────────────────────────────────

interface WizardState {
  date: string;
  startTime: string;
  endTime: string;
  odomStart: string;
  odomEnd: string;
  platforms: { name: string; amount: string; rides: string }[];
  fuelCost: string;
  foodCost: string;
  mood: MoodRating | null;
  notes: string;
}

// ─── step definitions ────────────────────────────────────────────────────────

const STEP_ICONS = ['📅', '⏰', '🛣️', '💰', '⛽', '🍔', '😊', '📝', '✅'];
const TOTAL_STEPS = STEP_ICONS.length;

// ─── sub-components ──────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  const pct = Math.round((step / TOTAL_STEPS) * 100);
  return (
    <View style={s.progressWrap}>
      <View style={[s.progressFill, { width: `${pct}%` as any }]} />
    </View>
  );
}

function StepHeader({ step, title, subtitle }: { step: number; title: string; subtitle: string }) {
  return (
    <View style={s.stepHeader}>
      <Text style={s.stepEmoji}>{STEP_ICONS[step - 1]}</Text>
      <Text style={s.stepTitle}>{title}</Text>
      <Text style={s.stepSubtitle}>{subtitle}</Text>
    </View>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

export interface ShiftWizardProps {
  visible: boolean;
  distanceUnit: 'km' | 'mi';
  vehicleId: string | null;
  isPremium: boolean;
  onClose: () => void;
  onSaved: () => void;
  onUpgradeNeeded: () => void;
}

export function ShiftWizard({ visible, distanceUnit, vehicleId, isPremium, onClose, onSaved, onUpgradeNeeded }: ShiftWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>({
    date: todayDMY(),
    startTime: '08:00',
    endTime: nowHHMM(),
    odomStart: '',
    odomEnd: '',
    platforms: [{ name: '', amount: '', rides: '' }],
    fuelCost: '',
    foodCost: '',
    mood: null,
    notes: '',
  });

  // load saved platforms on open
  useEffect(() => {
    if (!visible) return;
    setStep(1);
    setError(null);
    setState({
      date: todayDMY(),
      startTime: '08:00',
      endTime: nowHHMM(),
      odomStart: '',
      odomEnd: '',
      platforms: [{ name: '', amount: '', rides: '' }],
      fuelCost: '',
      foodCost: '',
      mood: null,
      notes: '',
    });
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      getUserPlatforms(data.user.id).then(saved => {
        if (saved.length > 0) {
          setState(prev => ({ ...prev, platforms: saved.map(p => ({ name: p.platform_name, amount: '', rides: '' })) }));
        }
      }).catch(() => {});
    });
  }, [visible]);

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState(prev => ({ ...prev, [key]: value }));
  }

  function updatePlatform(i: number, field: 'name' | 'amount' | 'rides', value: string) {
    setState(prev => ({
      ...prev,
      platforms: prev.platforms.map((p, idx) => idx === i ? { ...p, [field]: value } : p),
    }));
  }

  function canProceed(): boolean {
    if (step === 1) return state.date.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/) !== null;
    if (step === 2) return state.startTime.match(/^\d{1,2}:\d{2}$/) !== null && state.endTime.match(/^\d{1,2}:\d{2}$/) !== null;
    if (step === 4) return state.platforms.some(p => p.name.trim() && parse(p.amount) > 0);
    return true;
  }

  function next() {
    setError(null);
    if (!canProceed()) {
      if (step === 1) setError(t('shift.time_format_hint'));
      else if (step === 4) setError(t('shift.validation_platform_required'));
      return;
    }
    if (step < TOTAL_STEPS) setStep(s => s + 1);
    else handleConfirm();
  }

  function back() {
    setError(null);
    if (step > 1) setStep(s => s - 1);
    else onClose();
  }

  function skip() {
    setError(null);
    if (step < TOTAL_STEPS) setStep(s => s + 1);
  }

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('no user');

      const startedAt = dmyHhmToIso(state.date, state.startTime);
      const endedAt   = dmyHhmToIso(state.date, state.endTime);
      if (!startedAt || !endedAt) throw new Error('invalid times');

      const validPlatforms = state.platforms.filter(p => p.name.trim() && parse(p.amount) > 0);
      const totalRides = validPlatforms.reduce((s, p) => s + (parseInt(p.rides) || 0), 0);

      const div = distanceUnit === 'km' ? 1000 : 1609.344;
      const odomStartM = state.odomStart.trim() ? Math.round(parse(state.odomStart) * div) : null;
      const odomEndM   = state.odomEnd.trim()   ? Math.round(parse(state.odomEnd)   * div) : null;

      const payload: EndShiftData = {
        odometer_start_meters: odomStartM,
        odometer_end_meters: odomEndM,
        platforms: validPlatforms.map(p => ({ platform_name: p.name.trim(), amount_cents: decimalToCents(parse(p.amount)) })),
        tolls_cents: 0,
        parking_cents: 0,
        food_cents: state.foodCost.trim() ? decimalToCents(parse(state.foodCost)) : 0,
        tips_cents: 0,
        bonuses_cents: 0,
        rides_count: totalRides > 0 ? totalRides : null,
        mood_rating: state.mood,
        notes: state.notes.trim() || null,
      };

      if (state.fuelCost.trim()) {
        payload.tolls_cents = decimalToCents(parse(state.fuelCost));
      }

      const shiftId = await createManualShift(user.id, vehicleId, startedAt, endedAt, payload, isPremium);

      // enrich with fuel cost calculation
      supabase.functions.invoke('calculate-shift', { body: { shift_id: shiftId } }).catch(() => {});

      onSaved();
    } catch (err) {
      if (err instanceof FreeLimitError) {
        onUpgradeNeeded();
        onClose();
      } else {
        setError(t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  }

  const canSkip = [3, 5, 6, 7, 8].includes(step);
  const isLast  = step === TOTAL_STEPS;

  // ─── summary values ──────────────────────────────────────────────────────

  const validPlatforms = state.platforms.filter(p => p.name.trim() && parse(p.amount) > 0);
  const grossCents = validPlatforms.reduce((s, p) => s + decimalToCents(parse(p.amount)), 0);
  const foodCents  = state.foodCost.trim() ? decimalToCents(parse(state.foodCost)) : 0;
  const fuelCents  = state.fuelCost.trim() ? decimalToCents(parse(state.fuelCost)) : 0;
  const netCents   = Math.max(grossCents - foodCents - fuelCents, 0);

  function fmt(cents: number): string {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // ─── render step content ─────────────────────────────────────────────────

  function renderStepContent() {
    switch (step) {
      case 1:
        return (
          <>
            <StepHeader step={1} title="Data do expediente" subtitle="Qual foi a data do seu dia de trabalho?" />
            <TextInput
              style={s.input}
              value={state.date}
              onChangeText={v => update('date', v)}
              placeholder="DD/MM/AAAA"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="numbers-and-punctuation"
              autoFocus
            />
          </>
        );

      case 2:
        return (
          <>
            <StepHeader step={2} title="Horário" subtitle="Que horas você começou e terminou?" />
            <Text style={s.fieldLabel}>Início</Text>
            <TextInput
              style={s.input}
              value={state.startTime}
              onChangeText={v => update('startTime', v)}
              placeholder="HH:MM"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="numbers-and-punctuation"
              autoFocus
            />
            <Text style={s.fieldLabel}>Término</Text>
            <TextInput
              style={s.input}
              value={state.endTime}
              onChangeText={v => update('endTime', v)}
              placeholder="HH:MM"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="numbers-and-punctuation"
            />
          </>
        );

      case 3:
        return (
          <>
            <StepHeader step={3} title="Quilômetros" subtitle={`Odômetro em ${distanceUnit} — opcional`} />
            <Text style={s.fieldLabel}>KM inicial (odômetro)</Text>
            <TextInput
              style={s.input}
              value={state.odomStart}
              onChangeText={v => update('odomStart', v)}
              placeholder={`Ex: 45200`}
              placeholderTextColor={Colors.textSecondary}
              keyboardType="decimal-pad"
              autoFocus
            />
            <Text style={s.fieldLabel}>KM final (odômetro)</Text>
            <TextInput
              style={s.input}
              value={state.odomEnd}
              onChangeText={v => update('odomEnd', v)}
              placeholder={`Ex: 45380`}
              placeholderTextColor={Colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </>
        );

      case 4:
        return (
          <>
            <StepHeader step={4} title="Receita" subtitle="Quanto você ganhou por plataforma?" />
            {state.platforms.map((p, i) => (
              <View key={i} style={s.platformRow}>
                <TextInput
                  style={[s.input, s.platformName]}
                  placeholder="Plataforma"
                  placeholderTextColor={Colors.textSecondary}
                  value={p.name}
                  onChangeText={v => updatePlatform(i, 'name', v)}
                />
                <TextInput
                  style={[s.input, s.platformAmount]}
                  keyboardType="decimal-pad"
                  placeholder="R$ 0,00"
                  placeholderTextColor={Colors.textSecondary}
                  value={p.amount}
                  onChangeText={v => updatePlatform(i, 'amount', v)}
                />
                <TextInput
                  style={[s.input, s.platformRides]}
                  keyboardType="number-pad"
                  placeholder="Cor."
                  placeholderTextColor={Colors.textSecondary}
                  value={p.rides}
                  onChangeText={v => updatePlatform(i, 'rides', v)}
                />
              </View>
            ))}
            <Pressable onPress={() => setState(prev => ({ ...prev, platforms: [...prev.platforms, { name: '', amount: '', rides: '' }] }))} style={s.addRow}>
              <Ionicons name="add-circle-outline" size={16} color={Colors.accent} />
              <Text style={s.addRowText}>{t('shift.add_platform')}</Text>
            </Pressable>
          </>
        );

      case 5:
        return (
          <>
            <StepHeader step={5} title="Combustível" subtitle="Gastou com combustível hoje? (opcional)" />
            <TextInput
              style={s.input}
              value={state.fuelCost}
              onChangeText={v => update('fuelCost', v)}
              placeholder="R$ 0,00"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="decimal-pad"
              autoFocus
            />
          </>
        );

      case 6:
        return (
          <>
            <StepHeader step={6} title="Alimentação" subtitle="Gastou com alimentação hoje? (opcional)" />
            <TextInput
              style={s.input}
              value={state.foodCost}
              onChangeText={v => update('foodCost', v)}
              placeholder="R$ 0,00"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="decimal-pad"
              autoFocus
            />
          </>
        );

      case 7:
        return (
          <>
            <StepHeader step={7} title="Como foi o dia?" subtitle="Avalie seu expediente de hoje" />
            <View style={s.moodRow}>
              {([
                { key: 'good' as MoodRating, label: t('shift.mood_good') },
                { key: 'ok'   as MoodRating, label: t('shift.mood_ok') },
                { key: 'bad'  as MoodRating, label: t('shift.mood_bad') },
              ]).map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[s.moodCard, state.mood === key && s.moodCardSelected]}
                  onPress={() => setState(prev => ({ ...prev, mood: prev.mood === key ? null : key }))}
                >
                  <Text style={[s.moodText, state.mood === key && s.moodTextSelected]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        );

      case 8:
        return (
          <>
            <StepHeader step={8} title="Observações" subtitle="Diário do dia — opcional (0/1000 chars)" />
            <TextInput
              style={[s.input, s.notesInput]}
              value={state.notes}
              onChangeText={v => update('notes', v)}
              placeholder={t('shift.notes_placeholder')}
              placeholderTextColor={Colors.textSecondary}
              multiline
              numberOfLines={5}
              maxLength={1000}
              autoFocus
            />
            <Text style={s.charCount}>{state.notes.length}/1000</Text>
          </>
        );

      case 9:
        return (
          <>
            <StepHeader step={9} title="Resumo" subtitle="Confirme os dados do seu expediente" />
            <View style={s.summaryCard}>
              <SummaryRow label="Data" value={state.date} />
              <SummaryRow label="Horário" value={`${state.startTime} – ${state.endTime}`} />
              {(state.odomStart || state.odomEnd) && (
                <SummaryRow label={`KM (${distanceUnit})`} value={`${state.odomStart || '—'} → ${state.odomEnd || '—'}`} />
              )}
              {validPlatforms.map(p => (
                <SummaryRow key={p.name} label={p.name} value={fmt(decimalToCents(parse(p.amount)))} accent />
              ))}
              {fuelCents > 0  && <SummaryRow label="Combustível" value={`− ${fmt(fuelCents)}`} red />}
              {foodCents > 0  && <SummaryRow label="Alimentação" value={`− ${fmt(foodCents)}`} red />}
              <View style={s.summaryDivider} />
              <SummaryRow label="Receita bruta" value={fmt(grossCents)} accent />
              <SummaryRow label="Lucro líquido" value={fmt(netCents)} accent bold />
              {state.mood && <SummaryRow label="Dia" value={state.mood === 'good' ? '🤑 Excelente' : state.mood === 'ok' ? '😐 Normal' : '😫 Ruim'} />}
            </View>
          </>
        );

      default:
        return null;
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.wrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* header */}
        <View style={s.topBar}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
          <Text style={s.stepCounter}>Etapa {step} de {TOTAL_STEPS}</Text>
          {canSkip
            ? <TouchableOpacity onPress={skip} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.skipText}>Pular →</Text>
              </TouchableOpacity>
            : <View style={{ width: 50 }} />
          }
        </View>

        <ProgressBar step={step} />

        <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {renderStepContent()}
          {error && <Text style={s.errorText}>{error}</Text>}
        </ScrollView>

        {/* footer nav */}
        <View style={s.footer}>
          <TouchableOpacity style={s.backBtn} onPress={back}>
            <Ionicons name="chevron-back" size={18} color={Colors.textSecondary} />
            <Text style={s.backBtnText}>Anterior</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.nextBtn, (!canProceed() || saving) && s.btnDisabled]}
            onPress={next}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color={Colors.onAccent} size="small" />
              : <>
                  <Text style={s.nextBtnText}>{isLast ? 'Confirmar' : 'Próximo'}</Text>
                  {!isLast && <Ionicons name="chevron-forward" size={18} color={Colors.onAccent} />}
                  {isLast  && <Ionicons name="checkmark-circle" size={18} color={Colors.onAccent} />}
                </>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── summary row ──────────────────────────────────────────────────────────────

function SummaryRow({ label, value, accent, red, bold }: { label: string; value: string; accent?: boolean; red?: boolean; bold?: boolean }) {
  return (
    <View style={s.summaryRow}>
      <Text style={s.summaryLabel}>{label}</Text>
      <Text style={[s.summaryValue, accent && { color: Colors.accent }, red && { color: Colors.error }, bold && { fontSize: 16, fontWeight: '900' }]}>
        {value}
      </Text>
    </View>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
  },
  stepCounter: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  skipText: { color: Colors.accent, fontSize: 13, fontWeight: '700', textAlign: 'right', width: 50 },
  progressWrap: {
    height: 3, backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: Spacing.md, borderRadius: 2, marginBottom: Spacing.sm,
  },
  progressFill: { height: 3, backgroundColor: Colors.accent, borderRadius: 2 },
  scroll: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  stepHeader: { alignItems: 'center', marginBottom: Spacing.xl, paddingTop: Spacing.md },
  stepEmoji: { fontSize: 56, marginBottom: Spacing.sm },
  stepTitle: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  stepSubtitle: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  fieldLabel: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.xs, marginTop: Spacing.md,
  },
  input: {
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input,
    borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2, fontSize: 16, marginBottom: Spacing.xs, minHeight: 52,
  },
  platformRow: { flexDirection: 'row', gap: 8, marginBottom: Spacing.xs },
  platformName: { flex: 1, marginBottom: 0 },
  platformAmount: { width: 90, marginBottom: 0 },
  platformRides: { width: 54, marginBottom: 0 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.sm },
  addRowText: { color: Colors.accent, fontSize: 14, fontWeight: '600' },
  moodRow: { flexDirection: 'row', gap: 12, marginTop: Spacing.md },
  moodCard: {
    flex: 1, alignItems: 'center', paddingVertical: 18, borderRadius: 16,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surfaceAlt,
  },
  moodCardSelected: { borderColor: Colors.accent, backgroundColor: 'rgba(245,158,11,0.12)' },
  moodText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  moodTextSelected: { color: Colors.accent, fontWeight: '800' },
  notesInput: { minHeight: 120, textAlignVertical: 'top', paddingTop: Spacing.sm },
  charCount: { color: Colors.textSecondary, fontSize: 11, textAlign: 'right', marginTop: 4 },
  summaryCard: {
    backgroundColor: Colors.surfaceAlt, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: 2,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  summaryLabel: { color: Colors.textSecondary, fontSize: 13 },
  summaryValue: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  summaryDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 6 },
  errorText: { color: Colors.error, fontSize: 13, textAlign: 'center', marginTop: Spacing.sm },
  footer: {
    flexDirection: 'row', gap: Spacing.sm, padding: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 14, paddingHorizontal: Spacing.md,
    borderRadius: Radius.button, borderWidth: 1.5, borderColor: Colors.border,
  },
  backBtnText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  nextBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.accent, borderRadius: Radius.button, minHeight: 52,
  },
  nextBtnText: { color: Colors.onAccent, fontSize: 16, fontWeight: '800' },
  btnDisabled: { opacity: 0.6 },
});
