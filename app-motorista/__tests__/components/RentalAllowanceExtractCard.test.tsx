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
    periodStart: new Date('2026-08-10'), periodEnd: new Date('2026-08-17'), periodIndex: 1,
    allowanceAmountKm: 1500, allowancePeriod: 'weekly',
    baselineMeters: 19228000, baselineIsEstimated: true, currentOdometerMeters: 20739000,
    periodUsageKm: 1358, periodAllowanceKm: 1500,
    cumulativeUsageKm: 2858, cumulativeAllowanceKm: 3000, balanceKm: 142,
    isNearLimit: true, isOverLimit: false,
    overageKm: 0, overageCostCents: 0, remainingKm: 142,
    ...overrides,
  };
}

describe('RentalAllowanceExtractCard', () => {
  it('renders nothing when status is null', () => {
    const { toJSON } = render(<RentalAllowanceExtractCard status={null} />);
    expect(toJSON()).toBeNull();
  });

  it('shows used/total km and percentage for THIS PERIOD, not the cumulative total', () => {
    render(<RentalAllowanceExtractCard status={makeStatus()} />);
    expect(screen.getByText('1358 / 1500 km usados')).toBeTruthy();
    expect(screen.getByText('91%')).toBeTruthy();
  });

  it('shows a positive balance as banked km', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({ balanceKm: 142 })} />);
    expect(screen.getByTestId('rental-allowance-balance').props.children).toBe('142 km de saldo');
  });

  it('shows a negative balance as debt, without a minus sign leaking into the label', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({
      periodUsageKm: 1520, isOverLimit: true, balanceKm: -11,
    })} />);
    expect(screen.getByTestId('rental-allowance-balance').props.children).toBe('11 km em débito');
  });
});
