import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { KmGapRow } from '../../src/components/KmGapRow';
import type { KmGapForDay } from '../../src/services/kmGaps';

// Generalized i18n mock (unlike RentalAllowanceExtractCard.test.tsx's, this
// component uses two namespaces: km_gaps.* and common.*), backed by the
// real pt.json copy so assertions exercise the actual production strings.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      const ptDict = require('../../locales/pt.json');
      const [ns, shortKey] = key.split('.');
      let str: string = ptDict[ns]?.[shortKey] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{{${k}}}`, String(v));
        }
      }
      return str;
    },
  }),
}));

function makeGap(overrides: Partial<KmGapForDay> = {}): KmGapForDay {
  return {
    id: 'g1', user_id: 'u1', vehicle_id: 'v1',
    start_odometer_meters: 20739000, end_odometer_meters: 20853000, gap_meters: 114000,
    start_at: '2026-08-15T15:46:00Z', end_at: '2026-08-17T12:44:39.292Z',
    category: 'personal_use', note: null, is_edited: false,
    created_at: '2026-08-18T00:00:00Z', updated_at: '2026-08-18T00:00:00Z',
    spansMultipleDays: true,
    ...overrides,
  };
}

describe('KmGapRow', () => {
  it('shows the detected personal-use gap in the configured distance unit', () => {
    render(<KmGapRow gap={makeGap()} distanceUnit="km" onSave={jest.fn()} />);
    expect(screen.getByText('Uso pessoal detectado: 114 km')).toBeTruthy();
  });

  it('converts gap_meters to miles when distanceUnit is mi', () => {
    render(<KmGapRow gap={makeGap({ gap_meters: 160934 })} distanceUnit="mi" onSave={jest.fn()} />);
    expect(screen.getByText('Uso pessoal detectado: 100 mi')).toBeTruthy();
  });

  it('shows a note when the gap window spans more than one calendar day', () => {
    render(<KmGapRow gap={makeGap({ spansMultipleDays: true })} distanceUnit="km" onSave={jest.fn()} />);
    expect(screen.getByTestId('km-gap-spans-note')).toBeTruthy();
  });

  it('does not show the multi-day note for a same-day gap', () => {
    render(<KmGapRow gap={makeGap({ spansMultipleDays: false })} distanceUnit="km" onSave={jest.fn()} />);
    expect(screen.queryByTestId('km-gap-spans-note')).toBeNull();
  });

  it('keeps the inline editor closed by default and opens it on tap', () => {
    render(<KmGapRow gap={makeGap()} distanceUnit="km" onSave={jest.fn()} />);
    expect(screen.queryByTestId('km-gap-editor')).toBeNull();
    fireEvent.press(screen.getByTestId('km-gap-row'));
    expect(screen.getByTestId('km-gap-editor')).toBeTruthy();
  });

  it('saves the selected category and trimmed note, then collapses', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<KmGapRow gap={makeGap()} distanceUnit="km" onSave={onSave} />);
    fireEvent.press(screen.getByTestId('km-gap-row'));
    fireEvent.press(screen.getByTestId('km-gap-category-other'));
    fireEvent.changeText(screen.getByTestId('km-gap-note-input'), '  foi buscar filho na escola  ');
    fireEvent.press(screen.getByTestId('km-gap-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('other', 'foi buscar filho na escola'));
    await waitFor(() => expect(screen.queryByTestId('km-gap-editor')).toBeNull());
  });

  it('cancels without calling onSave and collapses the editor', () => {
    const onSave = jest.fn();
    render(<KmGapRow gap={makeGap()} distanceUnit="km" onSave={onSave} />);
    fireEvent.press(screen.getByTestId('km-gap-row'));
    fireEvent.press(screen.getByTestId('km-gap-cancel'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('km-gap-editor')).toBeNull();
  });
});
