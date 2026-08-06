import { test, expect, describe } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useCumulativeDayTotalDefault } from '../../src/hooks/useCumulativeDayTotalDefault';
import type { ShiftForReconciliation } from '../../src/utils/shiftReconciliationUtils';

// Regression coverage for the owner's explicit follow-up decision: the
// "this value is already the day's total" toggle must default to CHECKED
// automatically whenever a completed shift already exists earlier the same
// (start-day-attributed) calendar day — not just be available for the
// driver to opt into manually. This is hook-level wiring, distinct from
// shiftReconciliationUtils.test.ts, which only covers the reconciliation
// arithmetic itself.
describe('useCumulativeDayTotalDefault', () => {
  const priorShift: ShiftForReconciliation = {
    id: 'shift-1',
    started_at: '2026-08-03T08:00:00-03:00',
    ended_at: '2026-08-03T11:00:00-03:00',
    platforms: [{ platform_name: 'Uber', amount_cents: 20000 }],
  };

  test('defaults to CHECKED when a completed prior shift exists the same day', () => {
    const { result } = renderHook(() =>
      useCumulativeDayTotalDefault([priorShift], '2026-08-03T15:00:00-03:00', 'shift-2')
    );
    expect(result.current.hasPriorSameDayShift).toBe(true);
    expect(result.current.defaultChecked).toBe(true);
  });

  test('defaults to UNCHECKED for the first shift of the day (no prior shifts)', () => {
    const { result } = renderHook(() =>
      useCumulativeDayTotalDefault([], '2026-08-03T08:00:00-03:00', 'shift-1')
    );
    expect(result.current.hasPriorSameDayShift).toBe(false);
    expect(result.current.defaultChecked).toBe(false);
  });

  test('defaults to UNCHECKED when the only same-day shift is the one being edited (self-excluded)', () => {
    const { result } = renderHook(() =>
      useCumulativeDayTotalDefault([priorShift], '2026-08-03T08:00:00-03:00', 'shift-1')
    );
    expect(result.current.defaultChecked).toBe(false);
  });

  test('defaults to UNCHECKED when the only prior shift is on a different day', () => {
    const otherDayShift: ShiftForReconciliation = {
      ...priorShift,
      id: 'shift-0',
      started_at: '2026-08-02T08:00:00-03:00',
      ended_at: '2026-08-02T11:00:00-03:00',
    };
    const { result } = renderHook(() =>
      useCumulativeDayTotalDefault([otherDayShift], '2026-08-03T08:00:00-03:00', 'shift-2')
    );
    expect(result.current.defaultChecked).toBe(false);
  });

  test('defaults to UNCHECKED when there is no target started_at yet', () => {
    const { result } = renderHook(() =>
      useCumulativeDayTotalDefault([priorShift], undefined, 'shift-2')
    );
    expect(result.current.defaultChecked).toBe(false);
  });
});
