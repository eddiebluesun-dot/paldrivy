import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { RentalAllowanceBanner } from '../../src/components/RentalAllowanceBanner';
import type { RentalAllowanceStatus } from '../../src/utils/rentalKmAllowanceUtils';

// Mock react-i18next with the real pt.json copy so assertions exercise the
// actual production strings, same convention as CockpitCard.test.tsx.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      const ptDict = require('../../locales/pt.json');
      const shortKey = key.replace('rental_allowance.', '');
      let str: string = ptDict.rental_allowance[shortKey] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{{${k}}}`, String(v));
        }
      }
      return str;
    },
  }),
}));

function makeStatus(overrides: Partial<RentalAllowanceStatus> = {}): RentalAllowanceStatus {
  return {
    periodStart: new Date('2026-08-05'), periodEnd: new Date('2026-08-12'),
    baselineMeters: 18332000, currentOdometerMeters: 18622000,
    usageKm: 290, percentUsed: 0.58, isNearLimit: false, isOverLimit: false,
    overageKm: 0, overageCostCents: 0,
    ...overrides,
  };
}

describe('RentalAllowanceBanner', () => {
  it('renders nothing when status is null', () => {
    const { toJSON } = render(<RentalAllowanceBanner status={null} onAddExpense={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing below the near-limit threshold', () => {
    const { toJSON } = render(<RentalAllowanceBanner status={makeStatus()} onAddExpense={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('shows a warning banner at >=90%', () => {
    render(<RentalAllowanceBanner status={makeStatus({ isNearLimit: true, percentUsed: 0.92 })} onAddExpense={jest.fn()} />);
    expect(screen.getByTestId('rental-allowance-warning')).toBeTruthy();
  });

  it('shows an over-limit banner with an add-expense button at >=100%', () => {
    const onAddExpense = jest.fn();
    render(<RentalAllowanceBanner
      status={makeStatus({ isNearLimit: true, isOverLimit: true, percentUsed: 1.04, overageKm: 20, overageCostCents: 3000 })}
      onAddExpense={onAddExpense}
    />);
    const button = screen.getByRole('button');
    fireEvent.press(button);
    expect(onAddExpense).toHaveBeenCalledWith(3000);
  });
});
