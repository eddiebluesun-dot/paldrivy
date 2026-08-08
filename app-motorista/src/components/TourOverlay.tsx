import { useEffect, useState, useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import { getTourTarget } from '../tour/tourRegistry';
import type { TourStep } from '../tour/steps';

interface Rect { x: number; y: number; width: number; height: number; }

export function TourOverlay({
  visible, steps, onFinish,
}: {
  visible: boolean;
  steps: TourStep[];
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const measureCurrent = useCallback((i: number) => {
    const step = steps[i];
    if (!step) { onFinish(); return; }
    const ref = getTourTarget(step.targetId);
    const node = ref?.current;
    if (!node || typeof (node as any).measureInWindow !== 'function') {
      // Target not mounted/registered right now -- skip to the next step
      // rather than spotlighting nothing.
      setIndex(i + 1);
      return;
    }
    (node as any).measureInWindow((x: number, y: number, width: number, height: number) => {
      setRect({ x, y, width, height });
    });
  }, [steps, onFinish]);

  useEffect(() => {
    if (!visible) return;
    setIndex(0);
    measureCurrent(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    measureCurrent(index);
  }, [index, visible, measureCurrent]);

  if (!visible) return null;

  const step = steps[index];
  if (!step) return null; // measureCurrent already called onFinish in this case
  const isLast = index === steps.length - 1;

  function handleNext() {
    if (isLast) onFinish();
    else setIndex(i => i + 1);
  }
  function handleBack() {
    if (index > 0) setIndex(i => i - 1);
  }

  const { height: screenHeight } = Dimensions.get('window');
  const tooltipBelow = !rect || rect.y < screenHeight / 2;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onFinish}>
      <View style={s.overlay}>
        {rect ? (
          <View
            pointerEvents="none"
            style={[s.spotlight, { left: rect.x - 6, top: rect.y - 6, width: rect.width + 12, height: rect.height + 12 }]}
          />
        ) : null}

        <View style={[s.tooltip, rect ? { top: tooltipBelow ? rect.y + rect.height + 16 : undefined, bottom: tooltipBelow ? undefined : screenHeight - rect.y + 16 } : { top: '45%' }]}>
          <Text style={s.title}>{t(step.titleKey)}</Text>
          <Text style={s.desc}>{t(step.descriptionKey)}</Text>
          <View style={s.nav}>
            <TouchableOpacity onPress={onFinish} accessibilityRole="button" accessibilityLabel={t('tour.skip')}>
              <Text style={s.skip}>{t('tour.skip')}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              {index > 0 ? (
                <TouchableOpacity style={s.backBtn} onPress={handleBack} accessibilityRole="button" accessibilityLabel={t('tour.back')}>
                  <Text style={s.backText}>{t('tour.back')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={s.nextBtn} onPress={handleNext} accessibilityRole="button" accessibilityLabel={isLast ? t('tour.finish') : t('tour.next')}>
                <Text style={s.nextText}>{isLast ? t('tour.finish') : t('tour.next')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  spotlight: {
    position: 'absolute', borderRadius: Radius.card,
    borderWidth: 2, borderColor: Colors.accent, backgroundColor: 'transparent',
  },
  tooltip: {
    position: 'absolute', left: Spacing.lg, right: Spacing.lg,
    backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: Spacing.xs },
  desc: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: Spacing.md },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { color: Colors.textSecondary, fontSize: 13 },
  backBtn: { paddingVertical: 10, paddingHorizontal: Spacing.md, borderRadius: Radius.button, borderWidth: 1, borderColor: Colors.border },
  backText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  nextBtn: { paddingVertical: 10, paddingHorizontal: Spacing.md, borderRadius: Radius.button, backgroundColor: Colors.accent },
  nextText: { color: Colors.onAccent, fontSize: 13, fontWeight: '700' },
});
