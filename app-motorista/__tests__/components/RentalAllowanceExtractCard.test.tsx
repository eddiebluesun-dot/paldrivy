import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { RentalAllowanceExtractCard } from '../../src/components/RentalAllowanceExtractCard';
import type { RentalAllowanceStatus } from '../../src/utils/rentalKmAllowanceUtils';

// Same convention as RentalAllowanceBanner.test.tsx: mock react-i18next with
// the real pt.json copy so assertions exercise the actual production strings.
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
    periodStart: new Date('2026-08-10'), periodEnd: new Date('2026-08-17'),
    allowanceAmountKm: 1500, allowancePeriod: 'weekly',
    baselineMeters: 19228000, baselineIsEstimated: true, currentOdometerMeters: 20739000,
    usageKm: 1358, percentUsed: 1358 / 1500, isNearLimit: true, isOverLimit: false,
    overageKm: 0, overageCostCents: 0, remainingKm: 142,
    ...overrides,
  };
}

describe('RentalAllowanceExtractCard', () => {
  it('renders nothing when status is null', () => {
    const { toJSON } = render(<RentalAllowanceExtractCard status={null} />);
    expect(toJSON()).toBeNull();
  });

  it('shows used/total km and percentage', () => {
    render(<RentalAllowanceExtractCard status={makeStatus()} />);
    expect(screen.getByText('1358 / 1500 km usados')).toBeTruthy();
    expect(screen.getByText('91%')).toBeTruthy();
  });

  it('also shows the remaining km, not just used/total and percentage', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({ remainingKm: 142 })} />);
    expect(screen.getByTestId('rental-allowance-remaining').props.children).toBe('142 km restantes');
  });

  it('shows 0 km remaining, not a negative number, once the allowance is exceeded', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({
      usageKm: 1520, percentUsed: 1520 / 1500, isOverLimit: true, remainingKm: 0,
    })} />);
    expect(screen.getByTestId('rental-allowance-remaining').props.children).toBe('0 km restantes');
  });
});
