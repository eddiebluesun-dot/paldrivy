import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { createRef } from 'react';
import { View } from 'react-native';
import { TourOverlay } from '@/src/components/TourOverlay';
import { registerTourTarget, unregisterTourTarget } from '@/src/tour/tourRegistry';
import type { TourStep } from '@/src/tour/steps';

const STEPS: TourStep[] = [
  { id: 'a', targetId: 'target-a', titleKey: 'tour.a_title', descriptionKey: 'tour.a_desc' },
  { id: 'missing', targetId: 'not-registered', titleKey: 'tour.missing_title', descriptionKey: 'tour.missing_desc' },
  { id: 'b', targetId: 'target-b', titleKey: 'tour.b_title', descriptionKey: 'tour.b_desc' },
];

describe('TourOverlay', () => {
  beforeEach(() => {
    const refA = createRef<View>();
    (refA as any).current = { measureInWindow: (cb: any) => cb(10, 20, 100, 40) };
    registerTourTarget('target-a', refA);
    const refB = createRef<View>();
    (refB as any).current = { measureInWindow: (cb: any) => cb(10, 200, 100, 40) };
    registerTourTarget('target-b', refB);
  });
  afterEach(() => { unregisterTourTarget('target-a'); unregisterTourTarget('target-b'); });

  it('renders nothing when not visible', () => {
    const { toJSON } = render(<TourOverlay visible={false} steps={STEPS} onFinish={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('shows the first step title when visible', async () => {
    render(<TourOverlay visible steps={STEPS} onFinish={jest.fn()} />);
    expect(await screen.findByText('tour.a_title')).toBeTruthy();
  });

  it('skips a step whose target is not registered (unmounted), landing on the next valid step', async () => {
    render(<TourOverlay visible steps={STEPS} onFinish={jest.fn()} />);
    // advance past step "a"
    const next = await screen.findByRole('button', { name: /next|próximo/i });
    await act(async () => { fireEvent.press(next); });
    // "missing" has no registered target -> auto-skipped to "b"
    expect(await screen.findByText('tour.b_title')).toBeTruthy();
  });

  it('calls onFinish after the last step', async () => {
    const onFinish = jest.fn();
    render(<TourOverlay visible steps={[STEPS[0], STEPS[2]]} onFinish={onFinish} />);
    const next = await screen.findByRole('button', { name: /next|próximo|concluir|finish/i });
    await act(async () => { fireEvent.press(next); });
    const finish = await screen.findByRole('button', { name: /concluir|finish/i });
    await act(async () => { fireEvent.press(finish); });
    expect(onFinish).toHaveBeenCalled();
  });

  it('calls onFinish when skipped', async () => {
    const onFinish = jest.fn();
    render(<TourOverlay visible steps={STEPS} onFinish={onFinish} />);
    const skip = await screen.findByRole('button', { name: /pular|skip/i });
    await act(async () => { fireEvent.press(skip); });
    expect(onFinish).toHaveBeenCalled();
  });
});
