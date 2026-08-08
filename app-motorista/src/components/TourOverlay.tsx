import { useEffect, useState, useCallback, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet, Dimensions, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';
import { getTourTarget } from '../tour/tourRegistry';
import type { TourStep } from '../tour/steps';

interface Rect { x: number; y: number; width: number; height: number; }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Always returns a `top` that keeps the whole tooltip inside the viewport,
// regardless of where (or whether) the target itself is on-screen. The
// tooltip carries the only touch controls (Skip/Back/Next), so it must
// never be pushed off-screen -- e.g. by a target several cards down a
// scrolling dashboard, whose measureInWindow y can be far past screenHeight.
export function computeTooltipTop(rect: Rect | null, screenHeight: number, tooltipHeight: number): number {
  const margin = Spacing.lg;
  const minTop = margin;
  const maxTop = Math.max(margin, screenHeight - tooltipHeight - margin);
  if (!rect) {
    return clamp((screenHeight - tooltipHeight) / 2, minTop, maxTop);
  }
  const below = rect.y < screenHeight / 2;
  const desired = below
    ? rect.y + rect.height + 16
    : rect.y - 16 - tooltipHeight;
  return clamp(desired, minTop, maxTop);
}

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
  const [tooltipHeight, setTooltipHeight] = useState(0);
  // Tracks which direction the user was navigating (Next vs Back) so that
  // auto-skipping an unmounted/unregistered step continues the same way
  // the user was already moving, instead of always bouncing forward.
  const directionRef = useRef<1 | -1>(1);

  const measureCurrent = useCallback((i: number) => {
    const step = steps[i];
    if (!step) { onFinish(); return; }
    const ref = getTourTarget(step.targetId);
    const node = ref?.current;
    if (!node || typeof (node as any).measureInWindow !== 'function') {
      // Target not mounted/registered right now -- skip in the direction
      // the user was already navigating, rather than spotlighting nothing.
      setIndex(i + directionRef.current);
      return;
    }
    (node as any).measureInWindow((x: number, y: number, width: number, height: number) => {
      setRect({ x, y, width, height });
    });
  }, [steps, onFinish]);

  useEffect(() => {
    if (!visible) return;
    directionRef.current = 1;
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
    directionRef.current = 1;
    if (isLast) onFinish();
    else setIndex(i => i + 1);
  }
  function handleBack() {
    directionRef.current = -1;
    if (index > 0) setIndex(i => i - 1);
  }
  function handleTooltipLayout(e: LayoutChangeEvent) {
    const h = e.nativeEvent.layout.height;
    if (h && h !== tooltipHeight) setTooltipHeight(h);
  }

  const { height: screenHeight } = Dimensions.get('window');
  const tooltipTop = computeTooltipTop(rect, screenHeight, tooltipHeight);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onFinish}>
      <Pressable style={s.overlay} onPress={onFinish} testID="tour-overlay-backdrop">
        {rect ? (
          <View
            pointerEvents="none"
            style={[s.spotlight, { left: rect.x - 6, top: rect.y - 6, width: rect.width + 12, height: rect.height + 12 }]}
          />
        ) : null}

        <Pressable
          testID="tour-tooltip"
          onLayout={handleTooltipLayout}
          onPress={() => {}}
          style={[s.tooltip, { top: tooltipTop }]}
        >
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
        </Pressable>
      </Pressable>
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
