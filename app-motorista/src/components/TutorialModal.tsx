import React, { useState } from 'react';
import {
  Modal, Pressable, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Radius, Spacing } from '../theme';

const STEPS = [
  {
    emoji: '👋',
    title: 'Bem-vindo ao PalDrivy!',
    body: 'Controle financeiro feito para motoristas de app. Vamos te mostrar as principais funcionalidades em menos de 1 minuto.',
  },
  {
    emoji: '📊',
    title: 'Dashboard — sua visão geral',
    body: 'Aqui você vê seus ganhos de hoje, a meta mensal em tempo real, e o histórico de turnos em gráficos. Tudo centralizado.',
  },
  {
    emoji: '⚡',
    title: 'Lançamento rápido',
    body: 'Toque no botão ⚡ na aba Turnos para abrir o wizard guiado. Em 9 etapas, você registra um dia completo de trabalho — com receita, combustível, km e mood.',
  },
  {
    emoji: '🎯',
    title: 'Meta mensal',
    body: 'Defina quanto quer ganhar no mês e acompanhe o progresso com o anel dourado no dashboard. Quanto falta, quantos dias úteis restam.',
  },
  {
    emoji: '😊',
    title: 'Como foi o seu dia?',
    body: 'Ao encerrar um turno, avalie seu dia: Excelente 🤑, Normal 😐 ou Ruim 😫. No final do mês, você vê o balanço emocional do período.',
  },
  {
    emoji: '🚀',
    title: 'Pronto para começar!',
    body: 'Registre seu primeiro turno tocando em "Iniciar turno" ou use o ⚡ para um lançamento manual retroativo. PalDrivy — 30× mais barato que a concorrência.',
  },
];

interface TutorialModalProps {
  visible: boolean;
  onClose: () => void;
}

export function TutorialModal({ visible, onClose }: TutorialModalProps) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  function handleNext() {
    if (isLast) { setStep(0); onClose(); }
    else setStep(s => s + 1);
  }

  function handleBack() {
    if (step > 0) setStep(s => s - 1);
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          {/* close */}
          <TouchableOpacity style={s.closeBtn} onPress={() => { setStep(0); onClose(); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>

          {/* dots */}
          <View style={s.dots}>
            {STEPS.map((_, i) => (
              <View key={i} style={[s.dot, i === step && s.dotActive]} />
            ))}
          </View>

          {/* content */}
          <Text style={s.emoji}>{current.emoji}</Text>
          <Text style={s.title}>{current.title}</Text>
          <Text style={s.body}>{current.body}</Text>

          {/* navigation */}
          <View style={s.nav}>
            {step > 0
              ? <TouchableOpacity style={s.backBtn} onPress={handleBack}>
                  <Ionicons name="chevron-back" size={18} color={Colors.textSecondary} />
                  <Text style={s.backText}>Anterior</Text>
                </TouchableOpacity>
              : <View style={{ flex: 1 }} />
            }
            <TouchableOpacity style={s.nextBtn} onPress={handleNext}>
              <Text style={s.nextText}>{isLast ? 'Começar!' : 'Próximo'}</Text>
              {!isLast && <Ionicons name="chevron-forward" size={18} color={Colors.onAccent} />}
              {isLast  && <Ionicons name="rocket" size={18} color={Colors.onAccent} />}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center', justifyContent: 'center', padding: Spacing.xl,
  },
  card: {
    backgroundColor: Colors.surface, borderRadius: 24, padding: Spacing.lg,
    width: '100%', maxWidth: 380, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center',
  },
  closeBtn: { position: 'absolute', top: 16, right: 16 },
  dots: { flexDirection: 'row', gap: 6, marginBottom: Spacing.lg, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.accent, width: 18 },
  emoji: { fontSize: 56, marginBottom: Spacing.md },
  title: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: Spacing.sm },
  body: { color: Colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: Spacing.xl },
  nav: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, width: '100%' },
  backBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 12, borderRadius: Radius.button, borderWidth: 1.5, borderColor: Colors.border,
    justifyContent: 'center',
  },
  backText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  nextBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.accent, paddingVertical: 14, borderRadius: Radius.button,
    justifyContent: 'center',
  },
  nextText: { color: Colors.onAccent, fontSize: 15, fontWeight: '800' },
});
